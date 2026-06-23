计划如下：

1. 修复工作区刷新加载时序
   - 当前图片缓存（charImages / sceneImages / propImages / shotImages）是异步恢复的，但 dataLoaded 过早置为 true，自动生成 effect 可能在缓存 state 生效前判断“没有图”并重新调用模型。
   - 将工作区恢复改成一次性构建完整 restoredData / restored image maps 后再提交状态，最后再设置 dataLoaded=true，避免中间态触发生成。

2. 加强自动生成守卫
   - 角色、场景、道具、旧版分镜的 autoGen effect 统一增加 dataLoaded 判断。
   - 刷新恢复后，如果已存在图片缓存或 storyboard shot 的 imageUrl，就只展示缓存，不再重新生成。

3. 修复图片缓存保存链路
   - 当前保存前的后台入库 persistAllImagesInBackground 不会把返回的永久 URL 写回 state/workspace_data，且 data: base64 会被过滤，可能导致 Azure gpt-image-2 返回的 b64 图刷新后丢失。
   - 计划改为在生成成功后立即通过 persistAssetImage 持久化：角色/场景/道具/shot/旧版 panel 都把临时 URL 或 data URL 转成 backend storage URL 后写入对应 image cache。

4. 改善保存内容一致性
   - handleSaveWorkspace 写入 workspace_data 时读取最新 ref/state，确保已生成图片 URL、选中图片、storyboardGroups 中的 shot.imageUrl 一起保存。
   - 对无法持久化的临时 URL 保留展示，但不会因为刷新就自动重生；只在用户主动点击重新生成时才重新调用模型。

5. 验证
   - 用前端工作区流程检查：生成图片后等待自动保存，刷新页面，确认图片仍展示且控制台/网络不再出现新的 generateImage / Azure requestId 调用。