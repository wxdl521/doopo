# 重构分镜组 -> 视频链路:1 组 = 1 段 ~10s 视频,1-3 个 shot

## 目标(用户诉求)

- 每个分镜组 = 一段视频,**不锁死 1 个 shot**,重要的是把那段剧情在 ~10s 视频里表达完。
- 每组按剧情生成 **1-3 个 shot,每个 2-5s,总和 ≤10s**。
- 分镜图数量与描述对应 shot(已是一图一 shot,无需改)。
- 故事板(组级合成图)严格按 shot 来;**机位动线/人物动线要做对,没动就不画,禁止无中生有**。
- 生成视频的 **duration = shot 时长总和,一般 ≤10s**。

## 根因 / 现状

1. 分镜生成 prompt 强制「1 group = 1 shot」([storyboard.functions.ts:135-349](src/lib/storyboard.functions.ts#L135-L349) 多处 `shots 数组长度 = 1`),所以每组只有 1 个 shot。
2. 组时长兜底是 5s([storyboard.functions.ts:654-657](src/lib/storyboard.functions.ts#L654-L657) `startSec + 5`),AI 不给时间就 5s。
3. 视频 duration 用 `min(10, max(5, group.endSec - group.startSec))`([workspace.$workspaceId.tsx:5169](src/routes/workspace.$workspaceId.tsx#L5169)),不是 shot 总和;按分镜图路径写死 10s([:5163](src/routes/workspace.$workspaceId.tsx#L5163))。
4. **故事板合成图拿不到动线数据**:workspace 调 `callGenStoryboard` 时 shots 只映射了 shotType/action/camera/durationSec/startSec/endSec,**漏传 `cameraMovement` / `characterBlocking`**([:5431-5441](src/routes/workspace.$workspaceId.tsx#L5431-L5441))。而 `buildPitchDeckPrompt` 本来就用这俩画动线([seedream.functions.ts:1976-1977](src/lib/seedream.functions.ts#L1976-L1977))。数据丢了 -> AI 无中生有。
5. 故事板面板数 `SUGGESTED_PANELS = min(12, max(4, shotCount))`([seedream.functions.ts:1942](src/lib/seedream.functions.ts#L1942)),shotCount=1-3 时也被拉到 4,与 shot 数不对应。

## 改动清单

### A. 分镜生成 prompt 重写 — `src/lib/storyboard.functions.ts`

`systemPrompt` + `userPrompt`(:135-349):

- 把「一个分镜 = 一个镜头,shots 长度 = 1」改为「**一个分镜组 = 一段 ~10s 视频,含 1-3 个 shot**」。
- 每个 shot **2-5s**,整组总和 **≤10s**;剧情段要能在 10s 内表达完(切分时按 ~10s 一段切,而不是每句台词切一组)。
- 剧情覆盖完整性(最高优先级)保留,但落到**组级**:所有组的 plotText 按序拼接覆盖整集;组内 1-3 个 shot 细分。
- 时间区间:组 startSec/endSec 跨度 ≈ shot 总和(≤10s);组内 shot 无缝衔接(分镜 N endSec == 分镜 N+1 startSec)。
- 强化动线字段:有运镜才写 cameraMovement(推/拉/摇/移/跟/环 + 方向幅度),**固定机位就写「固定机位,无运镜」**;有走位才写 characterBlocking,**静止就写「人物静止,无走位」**。
- JSON schema 示例改成 1 组含 1-3 个 shot;删掉「shots 数组长度 = 1」「每个分镜只有 1 个 shot」等硬约束。
- 最少分镜数:从「≥5 个分镜(每组 1 shot)」改为按集时长估算组数(每组 ~10s),保留「禁止整集 1 组」。

### B. normalize 兜底 — `src/lib/storyboard.functions.ts`

- `normalizeGroup`(:654-657):组时长兜底 `startSec + 5` -> `startSec + 10`(对齐 10s 模型;AI 给了就用 AI 的)。
- `normalizeShot`(:694-755):保持不变(AI 给时间就用,不给就按组区间均分 -- 10s / 1-3 个 shot 自然落到 2-5s/3.3-10s)。

### C. 视频时长 = shot 总和 — `src/routes/workspace.$workspaceId.tsx`

新增模块级 helper:

```ts
function groupVideoDurationSec(group: {
  startSec?: number; endSec?: number;
  shots: Array<{ startSec?: number; endSec?: number }>;
}): number {
  let sum = 0;
  for (const s of group.shots) {
    if (s.startSec != null && s.endSec != null && s.endSec > s.startSec) sum += s.endSec - s.startSec;
  }
  const span = sum > 0 ? sum : (group.endSec ?? 0) - (group.startSec ?? 0);
  if (span <= 0) return 10; // 无任何时长信息,fallback 10s
  return Math.min(10, Math.max(5, Math.round(span))); // 5s 下限(ARK 最小)+ 10s 上限
}
```

替换 4 处:
- [:4896](src/routes/workspace.$workspaceId.tsx#L4896) `buildVideoGenPayloadForShots` extra.duration(原 `"10s (fixed)"`)-> `${groupVideoDurationSec(group)}s`
- [:5072](src/routes/workspace.$workspaceId.tsx#L5072) `buildVideoGenPayloadForStoryboard` extra.duration(原 `min(10,max(5,span))`)-> `${groupVideoDurationSec(group)}s`
- [:5163](src/routes/workspace.$workspaceId.tsx#L5163) shots 分支实际 duration(原 `10`)-> `groupVideoDurationSec(group)`
- [:5169](src/routes/workspace.$workspaceId.tsx#L5169) storyboard 分支实际 duration(原 `min(10,max(5,span))`)-> `groupVideoDurationSec(group)`

> 保留 5s 下限(ARK Seedance 最小支持时长)+ 10s 上限。shot 总和 <5s 时按 5s,符合「一般不超过 10s」。

### D. 故事板拿到动线数据 — `src/routes/workspace.$workspaceId.tsx`

[:5431-5441](src/routes/workspace.$workspaceId.tsx#L5431-L5441) shots 映射补两个字段:

```ts
.map((s) => ({
  shotType: s.shotType,
  shotTypeLabel: s.shotTypeLabel,
  action: s.action,
  camera: s.camera,
  cameraMovement: s.cameraMovement,       // 新增
  characterBlocking: s.characterBlocking, // 新增
  durationSec: ...,
  startSec: s.startSec,
  endSec: s.endSec,
}));
```

`PitchDeckShotSchema` 已支持这两个字段([seedream.functions.ts:1873-1874](src/lib/seedream.functions.ts#L1873-L1874)),无需改 schema。

### E. 故事板合成图严格按 shot — `src/lib/seedream.functions.ts`

- `SUGGESTED_PANELS`(:1942):`Math.min(12, Math.max(4, shotCount || 6))` -> `Math.min(12, Math.max(1, shotCount || 6))`。1-3 个 shot -> 1-3 个面板(原 min 4 会多画)。
- `buildPitchDeckPrompt` 的 `[TOP-DOWN DIAGRAM]` 段(:2037-2046)+ `[OUTPUT RULES]` 6 条(:2071-2072):加显式约束 ——
  - 某 shot 的 cameraMovement 为「固定机位/无运镜」或缺失 -> **不画该 shot 的镜头运动线**。
  - 某 shot 的 characterBlocking 为「人物静止/无走位」或缺失 -> **不画该 shot 的人物动线**。
  - 「没有动就不画,严禁无中生有」。
  - (现有 prompt 已说"按 shot 描述画",但数据此前缺失,补数据 + 显式约束双保险。)

## 不改的地方

- 分镜图(shot image)生成 `buildShotInstruction`:单帧图不表现运动,且已按 shot 的 action/camera 生成,无需改。
- `groupCount`:客户端已传 `0`(AI 自定,[workspace.$workspaceId.tsx:3923](src/routes/workspace.$workspaceId.tsx#L3923)),prompt 引导 AI 按 ~10s 切组即可。
- 「按分镜图」视频路径的 first_frame/last_frame/多模态模式判定(1/2/3+ 张):1-3 shot 仍落在这些分支内,无需改。

## 影响面 / 兼容

- **只影响新生成的分镜**(prompt + normalize)。已存在的旧分镜组(1 shot)不变;旧组生成视频时 duration helper 会 fallback 到组区间或 10s,不会出错。
- 故事板面板数变化只影响新生成的故事板图。

## 验证

- 选一集生成分镜:每组 1-3 shot,每个 2-5s,组时长 ≤10s;组数 ≈ 集时长/10。
- 生成故事板:面板数 = shot 数;俯视图里固定机位的 shot 没有运镜线、静止的 shot 没有人物动线。
- 按故事板生成视频:duration = shot 总和(≤10s),不再是 5s。
- 按分镜图生成视频:duration 同样 = shot 总和,不再是写死 10s。
- `bun run lint && bunx tsc --noEmit` 0 新错误。
