## 修复计划

1. **停止刷新后的兜底自动入库风暴**
   - 移除/禁用 `workspace.$workspaceId.tsx` 中监听角色图片并自动写入 `characters` 资产表的兜底 effect。
   - 原因：当前角色生成流程已经在生成成功后调用 `persistAssetImage` 保存图片，刷新恢复旧数据时再批量 upsert `characters` 会造成重复数据库写入，并触发 500 / statement timeout。

2. **把“图片缓存保存”限定到工作区数据**
   - 保留 `handleSaveWorkspace` 对 `charImages / sceneImages / propImages / shotImages` 的保存，让刷新后依然展示已生成内容。
   - 不再把恢复出来的角色图片自动写入资产库；只有用户主动点击“保存到资产库”时才写 `characters / scenes / props` 表。

3. **增强自动生成跳过逻辑**
   - 角色自动生成 effect 继续等待 `dataLoaded + imagesRestored`。
   - 用 `charImagesRef` 判断已有图片，避免 state/ref 同步时机导致误判为空。
   - 刷新后已有缓存图片的角色不再进入 `processCharacter`。

4. **减少数据库超时风险**
   - 将后台 `persistAllImagesInBackground` 的并发从 5 降低到 2，避免保存时同时上传/写入过多媒体。
   - 避免页面刷新后一边恢复、一边自动保存、一边自动入库造成数据库压力叠加。

5. **数据库性能补强**
   - 新增针对 `characters.user_id` 的索引；当前表只有主键，RLS 和资产库查询都会按 `user_id` 过滤，索引可降低后续查询/写入策略检查成本。
   - 同步检查并补齐 `scenes.user_id`、`props.user_id` 等资产表索引（如缺失则一并添加）。

6. **验证方式**
   - 打开已有工作区并刷新页面：控制台应只看到 `charactersToStart=0`，不再出现“自动入库角色失败”。
   - Network 不应再出现刷新后对 `/rest/v1/characters` 的自动 upsert 500。
   - 已生成图片仍从工作区缓存显示，不触发新的图片生成请求。