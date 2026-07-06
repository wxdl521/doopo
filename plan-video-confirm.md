# 视频生成确认卡片 — 实现计划

## 目标

分镜阶段点击「生成视频」按钮时,不再立即生成,而是把 **prompt + 参考图 + 确认按钮** 以卡片形式推到右侧 `ZopiaChatPanel` 对话框。用户点「确认生成」后才真正执行生成。

## 行为规则(已与用户确认)

- **开启「查看提示词」模式** + 点生成视频 → 仍弹原 `promptPreview` modal(**保留原行为,不改**)
- **关闭「查看提示词」模式** + 点生成视频 → 推确认卡片到对话框,等用户确认
- 确认卡片:**只读**(prompt + 参考图不可编辑),点「确认生成」后父组件重新 build payload 并生成

## 改动文件

1. `src/components/workspace/ZopiaChatPanel.tsx`
2. `src/routes/workspace.$workspaceId.tsx`
3. `src/i18n/zh.ts` + `src/i18n/en.ts`

---

## A. ZopiaChatPanel.tsx

### A1. Message union 新增 `video_confirm` 类型

```ts
| {
    id: string;
    kind: "video_confirm";
    groupId: string;
    method: "shots" | "storyboard";
    title: string;
    prompt: string;
    images: { url: string; label: string }[];
    extra?: Record<string, string>;
    status: "pending" | "generating" | "done" | "failed" | "cancelled";
  }
```

### A2. `ZopiaChatPanelHandle` 新增方法 `pushVideoConfirmCard`

```ts
pushVideoConfirmCard: (payload: {
  groupId: string;
  method: "shots" | "storyboard";
  title: string;
  prompt: string;
  images: { url: string; label: string }[];
  extra?: Record<string, string>;
}) => void;
```

实现:推一条 `status: "pending"` 的 `video_confirm` 消息,滚到底部(复用现有 scrollRef 滚动逻辑)。

### A3. 新增 prop `onConfirmVideoGen`

```ts
onConfirmVideoGen?: (groupId: string, method: "shots" | "storyboard") => Promise<boolean>;
```

返回 `true`=成功,`false`=失败(用于更新卡片 status,允许重试)。

### A4. 渲染 `video_confirm` 消息分支(在 `messages.map` 里加分支)

卡片内容:
- 标题 + extra 信息(model / route / duration / ratio)
- **prompt 折叠区**:用 `<details>` 默认折叠,避免长 prompt 占满屏幕;展开后 `<pre>` 等宽展示
- **参考图缩略图网格**:每张图带 label(首帧/尾帧/分镜图N/故事板/人物·名/场景·名/道具·名),点击可放大(复用现有 lightbox?或简单 title)
- 状态化按钮区:
  - `pending`:「确认生成」(主按钮 accent) + 「取消」(次按钮)
    - 点确认 → `setMessages` 改 `status=generating` → `await onConfirmVideoGen(groupId, method)` → 成功 `done` / 失败 `pending`(可重试)+ toast
    - 点取消 → `status=cancelled`
  - `generating`:spinner + 「生成中…」(按钮禁用)
  - `done`:✓「已生成」
  - `failed`:⚠「生成失败,可重试」+ 重新确认按钮
  - `cancelled`:「已取消」(灰)

### A5. 持久化处理

`saveStoredMessages` 里增加一步:把 `video_confirm` 消息的 `pending`/`generating` 状态重置为 `cancelled`(刷新页面后不可确认,但保留 prompt+图片历史供回看)。参考图 URL 是远程永久 URL(supabase),持久化安全(不像 user attachment 的 objectURL 会失效)。

---

## B. workspace.$workspaceId.tsx

### B1. 提取两个 build 函数(从现有 `generateVideoForGroup` / `generateVideoFromStoryboardForGroup` 提取「收集参考图 + 拼 prompt」逻辑)

```ts
type VideoGenPayload = {
  prompt: string;
  firstFrame?: string;       // shots 模式 1张/2张时有
  lastFrame?: string;        // shots 模式 2张时有
  referenceUrls: string[];   // shots 3+张 或 storyboard 模式时
  images: { url: string; label: string }[];  // 卡片展示用(带 label)
  extra: Record<string, string>;              // model/route/duration/ratio
  shotCount?: number;        // shots 模式镜头数(toast 用)
};

function buildVideoGenPayloadForShots(groupId: string): VideoGenPayload | null
function buildVideoGenPayloadForStoryboard(groupId: string): VideoGenPayload | null
```

- 返回 `null` 时内部已 toast 前置错误(无分镜图 / 故事板未成功)
- `images` = 参考图的 `{url, label}` 版本,在收集时同步记录 label:
  - shots 1张:`[{首帧}]`;2张:`[{首帧},{尾帧}]`;3+张:`[{分镜图1}...,{人物·名}...,{场景·名}...,{道具·名}...]`
  - storyboard:`[{故事板},{分镜图1}...,{人物·名}...,{场景·名}...,{道具·名}...]`

### B2. 新增 `executeVideoGen(groupId, method): Promise<boolean>`

```ts
async function executeVideoGen(groupId, method): Promise<boolean> {
  // 1. setGroupVideos running(原 4484 / 4700 逻辑)
  // 2. payload = method === "shots" ? buildVideoGenPayloadForShots : buildVideoGenPayloadForStoryboard
  //    if (!payload) { 清 running; return false; }
  // 3. callGenVideo(method 决定参数):
  //    - shots: imageUrl/lastFrameImageUrl/referenceImageUrls, duration=10
  //    - storyboard: 仅 referenceImageUrls, duration=clamp(group.endSec-group.startSec,5,10)
  // 4. 成功/失败更新 groupVideos(复用现有 4633-4669 / 4855-4893 逻辑)
  // 5. return res.ok && !!res.videoUrl
}
```

### B3. 修改 `generateVideoForGroup`(4462)

```ts
async function generateVideoForGroup(groupId: string) {
  // 前置检查(running/无图)— 保留
  if ((groupVideos[groupId] ?? []).at(-1)?.status === "running") { toast.message(...); return; }

  const payload = buildVideoGenPayloadForShots(groupId);
  if (!payload) return;  // build 内部已 toast

  // 1) 查看提示词模式 → 弹 modal(保留原拦截,原 4593 逻辑)
  if (viewPromptsModeRef.current) {
    setPromptPreview({ title: `第 ${group.index} 组 · 按分镜图生成视频`, prompt: payload.prompt, extra: payload.extra });
    return;
  }

  // 2) 正常模式 → 推确认卡片,等用户确认(不再 callGenVideo)
  chatPanelRef.current?.pushVideoConfirmCard({
    groupId, method: "shots",
    title: `第 ${group.index} 组 · 按分镜图生成视频`,
    prompt: payload.prompt, images: payload.images, extra: payload.extra,
  });
}
```

**移除**:原来的 `setGroupVideos running`(4484,移到 `executeVideoGen`)、原来的 `callGenVideo` + 状态更新(4619-4669,移到 `executeVideoGen`)。

### B4. 同样修改 `generateVideoFromStoryboardForGroup`(4685)

结构同 B3,`method: "storyboard"`,前置检查保留故事板 succeeded 校验。

### B5. ZopiaChatPanel 挂载处(9859)加 prop

```tsx
onConfirmVideoGen={async (groupId, method) => {
  return await executeVideoGen(groupId, method);
}}
```

---

## C. i18n(zh.ts + en.ts 同步新增)

| key | zh | en |
|-----|-----|-----|
| zp_video_confirm_title | 视频生成确认 | Video Generation |
| zp_video_confirm_gen | 确认生成 | Confirm Generate |
| zp_video_confirm_cancel | 取消 | Cancel |
| zp_video_confirm_generating | 生成中… | Generating… |
| zp_video_confirm_done | 已生成 | Generated |
| zp_video_confirm_failed | 生成失败,点击重试 | Failed — retry? |
| zp_video_confirm_cancelled | 已取消 | Cancelled |
| zp_video_confirm_refs | 参考图 | Reference Images |
| zp_video_confirm_show_prompt | 展开提示词 | Show prompt |
| zp_video_confirm_hide_prompt | 收起提示词 | Hide prompt |

---

## 边界处理

- **同一组重复点「生成视频」**:每次推新卡片(不阻塞),旧卡片可忽略。pending 卡片点确认时,若该组已有 running,`executeVideoGen` 内部 toast「正在生成中」并 `return false`,卡片回到 pending。
- **刷新页面**:pending/generating 卡片重置为 cancelled,用户需重新点「生成视频」。
- **确认前数据变化**(如删了分镜图):`executeVideoGen` 重新 build payload,用最新数据;若 build 失败则 toast + return false,卡片回 pending。
- **对话框折叠**:`pushVideoConfirmCard` 在 `collapsed` 时也能推(消息进 state),用户展开后可见。

## 不改动

- 图像生成的 `viewPromptsMode` 拦截(只动视频两条路径)
- `callGenVideo` / `videoGenerate.functions.ts`(server 端)
- 现有 `promptPreview` modal(视频路径在 viewPromptsMode 开时仍用它)
- 「查看提示词」按钮本身

## 验证

- `bun run lint && bun run format`
- 手动测试:
  1. 分镜阶段点「按分镜图生成视频」→ 对话框出现卡片(prompt + 参考图 + 确认按钮)→ 点确认 → 视频生成 → 卡片变「已生成」
  2. 点「按故事板生成视频」→ 同上(method=storyboard)
  3. 开「查看提示词」模式 → 点生成视频 → 仍弹 modal(行为不变)
  4. 点取消 → 卡片变「已取消」;刷新页面 → pending 卡片变「已取消」
  5. 生成失败 → 卡片变「生成失败,可重试」→ 点重试 → 重新生成
