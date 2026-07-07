# 角色参考音频 — 实现计划

## 目标

在角色阶段的角色卡上增加「参考音频」按钮,弹出 Popover 管理面板,可上传/试听/替换/删除该角色的参考音频。视频生成时,在确认卡片上手选某个角色的参考音频(或不选),作为 `reference_audio` 传给火山方舟 Seedance,让生成视频的配音模仿该音色。

## 行为规则(已与用户确认)

- **角色级**:一段音频绑定到角色(不是 look/形象)。同一角色不同造型共用同一段声音。
- **按钮交互**:点击 → shadcn `Popover` 管理面板(上传 / 试听 / 替换 / 删除)。
- **多角色镜头**:Seedance 的 `reference_audio` 只能传一段 → 在视频生成确认卡片上**手选**一个角色音频,或不选。默认"不使用"。
- **存储**:复用 `workspace-media` 桶 + 10 年签名 URL,和角色图同一路线。不新建桶。
- **持久化**:工作区数据走 `projects.workspace_data` JSON,`handleSaveWorkspace` 直接序列化 `data.characters`,给 `GenCharacter` 加字段后 UI 写入即自动持久化;资产库 `characters` 表同步加列。

## 后端现状(基本就绪)

- `generateVideo` 的 zod schema 已暴露 `referenceAudioUrl`([videoGenerate.functions.ts:2051](src/lib/videoGenerate.functions.ts#L2051)),handler 已用 `persistDataUriUrl` 持久化为签名 URL([:2094-2099](src/lib/videoGenerate.functions.ts#L2094-L2099),已支持 audio/mpeg、audio/wav)
- ark / kuaizi / toapis / vapeur 四个分支都已传递 `referenceAudioUrl`
- **shuci 分支漏传**([:1791-1795](src/lib/videoGenerate.functions.ts#L1791-L1795))—— 顺手修
- 前端 `executeVideoGen` 的 `commonData`([:4931-4938](src/routes/workspace.$workspaceId.tsx#L4931-L4938))**从未传 `referenceAudioUrl`**

→ 后端不用动 schema,主要是前端打通 + 角色数据建模 + 一个 shuci 小修。

## 改动文件

1. `src/data/workspaceGenerators.ts` — `GenCharacter` 加字段
2. `src/lib/uploadImage.functions.ts` — 扩展正则支持 audio + kind 加项
3. `src/routes/workspace.$workspaceId.tsx` — 角色卡按钮/Popover、上传逻辑、build payload 收集音频候选、`executeVideoGen` 注入
4. `src/components/workspace/ZopiaChatPanel.tsx` — 确认卡片音频选择器 + 签名扩展
5. `src/lib/videoGenerate.functions.ts` — 修 shuci 分支
6. `src/lib/assetsStorage.ts` — `charToRecord` 加字段
7. `supabase/migrations/<新迁移>` — `characters` 表加列
8. `src/i18n/zh.ts` + `src/i18n/en.ts` — 文案

---

## A. 数据模型

### A1. `GenCharacter` 加字段([workspaceGenerators.ts:21](src/data/workspaceGenerators.ts#L21))

```ts
/** 角色参考音频签名 URL(供视频生成 reference_audio 用);角色级,与 look 无关 */
referenceAudioUrl?: string;
```

### A2. `characters` 表加列(新迁移,照搬 `20260616100000_add_character_images_column.sql` 模式)

```sql
ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS reference_audio_url text;
```

### A3. `charToRecord`([assetsStorage.ts:67-91](src/lib/assetsStorage.ts#L67-L91))加字段

```ts
reference_audio_url: c.referenceAudioUrl ?? null,
```

---

## B. 上传

### B1. 扩展 `uploadLocalImage`([uploadImage.functions.ts:11-38](src/lib/uploadImage.functions.ts#L11-L38))

- 正则 `/^data:(image\/\w+|video\/\w+);base64,(.+)$/` → 加 `|audio\/\w+`
- `kind` enum 加 `"character-audio"`
- ext 推断已基于 `mime.split("/")[1]`,audio/mpeg→mpeg 需特判为 `mp3`(参照 `persistDataUriUrl` [videoGenerate.functions.ts:2024-2025](src/lib/videoGenerate.functions.ts#L2024-L2025) 的写法)

### B2. workspace 新增 `handleUploadAudio(characterId)` — 仿 `handleUploadImage`([:1978-2026](src/routes/workspace.$workspaceId.tsx#L1978))

```ts
async function handleUploadAudio(characterId: string) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "audio/*";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { toast.error("音频不能超过 25MB"); return; }  // 上限实现时按 Seedance 文档核对
    const base64 = await readFileAsDataURL(file);
    const res = await callUploadImage({ data: { base64, id: characterId, kind: "character-audio" } });
    if (res.ok && res.url) {
      setData((d) => ({
        ...d,
        characters: d.characters.map((c) => (c.id === characterId ? { ...c, referenceAudioUrl: res.url! } : c)),
      }));
      toast.success("参考音频已上传");
      void handleSaveWorkspace();
    }
  };
  input.click();
}
```

### B3. 删除参考音频

清空 `c.referenceAudioUrl` → `handleSaveWorkspace()`。不删 Storage 文件(简单处理,避免影响历史引用)。

---

## C. 角色卡 UI(`renderCard`,[workspace.$workspaceId.tsx:8551](src/routes/workspace.$workspaceId.tsx#L8551))

### C1. 按钮位置

在角色卡按钮行(现有「上传图片/选中推荐/保存资产」附近,[:8730-8885](src/routes/workspace.$workspaceId.tsx#L8730))加一个「参考音频」按钮,带 `e.stopPropagation()`(避免触发卡片打开预览)。

- 图标:Lucide `AudioWaveform`(或 `Mic` / `Volume2`)
- 状态:未上传 → 灰色;已上传 → 高亮 + 小喇叭角标

### C2. Popover 管理面板(用 [components/ui/popover.tsx](src/components/ui/popover.tsx))

受控 state:`const [audioPopoverFor, setAudioPopoverFor] = useState<string | null>(null)`(存 characterId,同时只开一个)。

面板内容:
- **已有音频时**:`<audio controls src={c.referenceAudioUrl} />` 试听条 + 「替换」+「删除」按钮
- **未上传时**:「上传音频」按钮 → 触发 `handleUploadAudio(c.id)`
- 底部一行说明文字(`char_audio_hint`):这段音频作为该角色声音参考,视频生成时可在确认卡片上选用

### C3. 预览模态框([:10228](src/routes/workspace.$workspaceId.tsx#L10228))

右侧描述栏也加一个音频试听条(只读,展示用),与卡片 Popover 共用 `c.referenceAudioUrl`。

---

## D. 视频生成链路(确认卡片手选)

### D1. `VideoGenPayload`([:4510-4523](src/routes/workspace.$workspaceId.tsx#L4510))加字段

```ts
audioCandidates: { characterId: string; characterName: string; audioUrl: string }[];
```

### D2. `buildVideoGenPayloadForShots` / `buildVideoGenPayloadForStoryboard` 收集候选

在两个 build 函数现有的 `unionCharIds` 循环([:4553-4594](src/routes/workspace.$workspaceId.tsx#L4553) / [:4742-4750](src/routes/workspace.$workspaceId.tsx#L4742))里,遍历本组涉及的角色,取 `c.referenceAudioUrl`,有则推入 `audioCandidates`(按角色去重)。

### D3. `pushVideoConfirmCard` 入参([ZopiaChatPanel.tsx:290-297](src/components/workspace/ZopiaChatPanel.tsx#L290))加 `audioCandidates`

### D4. `video_confirm` 消息类型([:119-131](src/components/workspace/ZopiaChatPanel.tsx#L119))加字段

```ts
audioCandidates: { characterId: string; characterName: string; audioUrl: string }[];
selectedAudioUrl?: string;  // 用户在卡片上选的;undefined = 不使用参考音频
```

### D5. 确认卡片 UI([:1683-1702](src/components/workspace/ZopiaChatPanel.tsx#L1683) 参考图列表附近)加「参考音频」区

- **仅当 `audioCandidates.length > 0` 时渲染**
- 用 shadcn `RadioGroup`([components/ui/radio-group.tsx](src/components/ui/radio-group.tsx)):
  - 一项「不使用参考音频」(默认选中,`value=""`)
  - 每个候选一项:角色名 + 内嵌 `<audio controls>` 试听条(`value=audioUrl`)
- 选中变化 → `setMessages` 写回 `m.selectedAudioUrl`(空串视为不使用)

### D6. `handleConfirmVideo`([:1324-1351](src/components/workspace/ZopiaChatPanel.tsx#L1324))签名加 `selectedAudioUrl`

读卡片当前 `selectedAudioUrl`,随 `onConfirmVideoGen` 回传(空串转 `undefined`)。

### D7. `onConfirmVideoGen` prop([:329-333](src/components/workspace/ZopiaChatPanel.tsx#L329))签名扩展

```ts
onConfirmVideoGen?: (
  groupId: string,
  method: "shots" | "storyboard",
  editedPreviewPrompt: string,
  selectedAudioUrl?: string,
) => Promise<boolean>;
```

### D8. workspace 侧 `onConfirmVideoGen` 绑定(ZopiaChatPanel 挂载处)

透传 `selectedAudioUrl` 给 `executeVideoGen(groupId, method, previewPrompt, selectedAudioUrl)`。

### D9. `executeVideoGen`([:4870](src/routes/workspace.$workspaceId.tsx#L4870))签名加 `selectedAudioUrl?`

`commonData` 加:

```ts
referenceAudioUrl: selectedAudioUrl || undefined,
```

---

## E. 后端 shuci 修复([videoGenerate.functions.ts:1791-1795](src/lib/videoGenerate.functions.ts#L1791-L1795))

shuci 分支调 `buildArkContent` 时补传 `referenceAudioUrl: input.referenceAudioUrl`,与 ark 分支([:1632](src/lib/videoGenerate.functions.ts#L1632))一致。

---

## F. i18n(zh.ts + en.ts 同步新增)

| key | zh | en |
|-----|-----|-----|
| `char_audio` | 参考音频 | Reference Audio |
| `char_audio_add` | 上传音频 | Upload Audio |
| `char_audio_replace` | 替换音频 | Replace Audio |
| `char_audio_delete` | 删除 | Delete |
| `char_audio_empty` | 未设置参考音频 | No reference audio set |
| `char_audio_hint` | 上传一段音频作为该角色的声音参考,视频生成时可在确认卡片上选用 | Upload an audio clip as this character's voice reference; pick it on the video confirm card when generating. |
| `char_audio_too_large` | 音频不能超过 25MB | Audio must be under 25MB |
| `zp_video_confirm_audio` | 参考音频 | Reference Audio |
| `zp_video_confirm_audio_none` | 不使用参考音频 | No reference audio |
| `zp_video_confirm_audio_pick` | 选择角色声音 | Choose character voice |

---

## 边界处理

- **多角色镜头**:确认卡片默认「不使用参考音频」,用户主动单选一个角色音频;Seedance 只收一段 → RadioGroup 单选。
- **无任何角色音频**:`audioCandidates` 为空 → 确认卡片不渲染音频区,行为与现状完全一致。
- **音频大小**:前端 25MB 校验(实现时按 Seedance 参考音频时长/格式限制核对 `docs/`)。
- **刷新页面**:音频 URL 是 10 年签名 URL,`workspace_data` 持久化,刷新不丢;pending 确认卡片仍按现状重置为 cancelled。
- **删除音频**:只清 `referenceAudioUrl` 字段,不删 Storage 文件。
- **资产库同步**:点「保存到资产」时 `reference_audio_url` 随 `charToRecord` 入库,跨项目复用角色时声音一致。
- **generate_audio 项目级开关**:与 `reference_audio` 独立,二者可同时开启(模型生成音频 + 参考音色)或单独使用,行为互不影响。

## 不改动

- `CharacterStage.tsx`(未被 workspace 引用,纯展示组件)
- `generate_audio` 项目级开关(NewProjectDialog)
- Seedance 不做语调参数化(TTS 路线后续,本次不涉及)
- 不新建 Storage bucket(复用 `workspace-media`)
- `generateVideo` 的 zod schema(已支持)

## 验证

- `bun run lint && bun run format`
- 手动测试:
  1. 角色卡点「参考音频」→ Popover 弹出 → 上传 mp3 → 试听 → 关闭 → 刷新页面,音频仍在
  2. 替换音频、删除音频,状态正确更新
  3. 给 2 个角色各传音频 → 多角色镜头点「生成视频」→ 确认卡片出现「参考音频」选择区,列出 2 个候选 + 「不使用」→ 选某角色 → 确认生成 → 抓请求 body 含 `reference_audio`
  4. 选「不使用参考音频」→ 请求不含 `reference_audio`
  5. 镜头里所有角色都没音频 → 确认卡片不显示音频区(行为同现状)
  6. 「保存到资产」→ 资产库 `characters.reference_audio_url` 有值
