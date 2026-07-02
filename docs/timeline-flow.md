# 时间轴拼接播放流程（2026/06）

## 概述

分镜流程生成的多个短视频（每组分镜 → 一个 10s 视频）可以在新的时间轴视图中**按顺序拼接播放**，并通过底部按帧时间轴进行**片段重排**和**进度拖拽**。

> 不需要真正的剪辑能力（无裁切、无转场、无调时长）；目标是"类似剪辑软件的播放 + 拖拽预览体验"。

---

## 入口

1. 打开任一 workspace，进入分镜 tab
2. 至少为 1 个分镜组生成视频
3. 在分镜行 header（位于"重新切分"按钮左边）点击 **"进入时间轴流程"** 按钮
4. ZopiaChatPanel 播放 5 步 timeline workflow 动画（tl_load → tl_align → tl_audio → tl_transition → tl_preview）
5. 动画结束后自动跳到 timeline tab，渲染 StoryboardTimeline 组件

也可以从顶部 Clock tab 图标直接进入 timeline tab（不经过动画）。

---

## 核心组件

### `src/components/workspace/StoryboardTimeline.tsx`

独立组件，约 380 行，包含所有播放 / 拖拽 / 重排逻辑。

#### Props

```ts
type Props = {
  groups: StoryboardGroup[]; // 全部分镜组
  groupVideos: Record<string, { url; status }>; // 已生成的视频
  clipOrder: string[]; // groupId 顺序（父组件管理）
  onClipReorder: (nextOrder: string[]) => void; // 重排回调
  clipDurationSec?: number; // 每段时长（默认 10s）
  i18n: {
    // 文案
    title;
    hint;
    play;
    pause;
    resetOrder;
    noVideo;
    generating;
    failed;
    empty;
    reorderChanged;
  };
};
```

#### 内部状态

| 状态              | 作用                                          |
| ----------------- | --------------------------------------------- |
| `activeClipIndex` | 当前正在播放的 clip 序号                      |
| `isPlaying`       | 是否在播放                                    |
| `currentSec`      | playhead 在整条时间轴上的秒数                 |
| `draggingClipId`  | 正在拖拽的 clip                               |
| `dragOverIndex`   | clip 拖拽时的目标落点 index（视觉预览用）     |
| `userReordered`   | 用户是否拖动过 clip（控制"重置顺序"按钮显隐） |

---

## 关键技术细节

### 1. 顺序无缝播放（多 video 串行）

每个已生成的视频创建一个 `<video>` 元素（始终 mount，仅切换 play/pause）：

- 当前 active 视频 `play()`，其余暂停
- `onEnded` → 把 `currentSec` 推进到下一段的起始位置
- 自动联动 `activeClipIndex` 切到下一个 clip
- 切换瞬间的短暂黑屏可接受（这是 10s 短视频切换的真实状态）

视频间没有真合并，每个 clip 还是独立的 URL。**视频 URL 24h 失效后需要重新生成**（与原 `groupVideos` 行为一致）。

### 2. Playhead 拖拽（Pointer Events，~50 行）

```tsx
onPointerDown  → setPointerCapture + 记录起始位置 → setIsPlaying(false)
onPointerMove  → 计算 dxSec = (dxPx / rect.width) * totalSec → seekTo(startSec + dxSec)
onPointerUp    → releasePointerCapture
```

**拖拽期间强制暂停视频**，松手后保持暂停状态（用户需点 ▶ 续播），避免拖拽过程中音画与拖动不同步。

### 3. Clip 重排序（Pointer Events，~100 行）

```tsx
onPointerDown  → setPointerCapture + 记录 fromIndex → setDraggingClipId
onPointerMove  → 计算 targetIndex = floor((relX + slotW/2) / slotW) → setDragOverIndex
onPointerUp    → releasePointerCapture + splice 重排 → onClipReorder(next)
```

**视觉规则**（`previewOffset(currentIndex)` 函数）：

- 拖拽 from→target 时，中间 clip 平移 1 槽，预演落点
- 被拖的 clip 自身半透明 + scale 1.02（z-10 浮起）
- 其他 clip 用 `transform: translateX(±100%)` 平移，`transition` 200ms ease

落点判定使用 clip **中心点**命中目标 slot（更符合剪辑软件直觉）。

### 4. 进度同步

- 播放：用 `requestAnimationFrame` 推进 `currentSec`，避免依赖 video.currentTime 的精度问题
- seek：根据 `floor(sec / clipDurationSec)` 重算 `activeClipIndex`，必要时切换 active video
- 自动切 clip：监听 `currentSec`，跨过 clip 边界时自动 `setActiveClipIndex`

---

## 数据流

```
分镜流程
  └─ data.storyboardGroups (持久化)
       └─ generateVideoForGroup → groupVideos[gid].url (会话内)

时间轴流程
  └─ clipOrder (会话内,不持久化)
       └─ 按顺序渲染 clips = clipOrder.map(id → group)
       └─ 用户拖拽 clip → onClipReorder(nextOrder) → setClipOrder
```

`clipOrder` 不持久化的原因：

1. 视频 URL 本身不持久化（24h 失效），顺序也跟着失效
2. 新生成的分镜组会自动追加到末尾
3. 切换集数 / 重新切分时通过 `useEffect` 自动同步清理

---

## 边界情况

| 场景                      | 行为                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------- |
| 0 个分镜组                | 显示 `i18n.empty` 空态文案                                                              |
| 有 group 但全部未生成视频 | 主视频区显示 `i18n.noVideo` 占位，时间轴显示未生成标记（Loader2/AlertCircle/Film 图标） |
| 部分组视频已生成          | 只播放已生成的 clip，未生成的 clip 显示灰色 + 跳过                                      |
| 拖 playhead 到末尾        | currentSec = totalSec，自动暂停                                                         |
| 拖 playhead 时视频在播    | 强制暂停，松手后保持暂停                                                                |
| 拖 clip 落点 = 原位置     | 不触发 onClipReorder（避免无意义 state 更新）                                           |

---

## 修改文件清单

| 动作 | 路径                                              |
| ---- | ------------------------------------------------- |
| 新建 | `src/components/workspace/StoryboardTimeline.tsx` |
| 修改 | `src/routes/workspace.$workspaceId.tsx`           |
| 修改 | `src/components/workspace/ZopiaChatPanel.tsx`     |
| 修改 | `src/i18n/zh.ts`                                  |
| 修改 | `src/i18n/en.ts`                                  |

---

## 未来可扩展点（未实现）

- [ ] 持久化 `clipOrder` 到 `WorkspaceData`（跟随视频 URL 转存一起做）
- [ ] 视频服务端合并：ffmpeg 拼接 → Supabase Storage → 返回永久 URL
- [ ] 转场预览（crossfade）
- [ ] 音频轨（背景音乐 + 配音）
- [ ] 字幕轨（与 audio 同步显示）
- [ ] 拖拽 clip 调整时长（左右把手 resize）
