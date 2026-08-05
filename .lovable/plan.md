# 修复转绘视频生成失败：参考视频裁成短片段

## 问题定位（已核实）

- 失败发生在每段提交的最后一步：`RestyleStudio.tsx` 的 `ensureReferenceVideoUrl` 把**整条原片**当参考视频，交给 `videoGenerate.functions.ts` 的 `topenrouterEnsureAsset({ assetType: "Video" })` 登记素材。
- TopenRouter 素材库限制参考视频时长 1.8–30.2 秒，原片是分钟级，所以每段都返回 `400 Duration must be between 1.8s and 30.2s`。
- 图片素材（首帧、参考图 2–5）全部通过审核，说明密钥、素材权限、网络都正常。
- 成片失败（「以下分段还没有可用视频」）是分段全失败的连带结果。
- `EP01 U02` 的 `Failed to fetch` 是另一类瞬时网络错误，单独加重试兜底。
- 现状：分段结构只有 `{ id, prompt }`，没有原片时间区间；但分析阶段已产出逐镜表 `shotSchedule`（带 `startMs`/`endMs`），可作为切分依据。

## 修复方案

按分段对应的时间区间，在服务端把原片裁成 30 秒以内的 mp4 片段，再登记为参考视频素材。

### 1. 分段时间区间（新增数据）

- `src/lib/restyleAnalysis.functions.ts`：`PlanEpisodeSchema` 的 segment 增加可选 `startMs` / `endMs`（旧项目缺字段不报错）；提示词要求导演模型对齐 `shotSchedule` 给出每段起止毫秒，并约束单段不超过 30 秒。
- 服务端后处理兜底：模型没给或区间非法时，用 `shotSchedule` 按分段序号就近推算；仍不可用时按分段数均分原片时长。
- 统一夹取到 1.8–30 秒，越界向后截断。
- `src/components/restyle/restyleStorage.ts` 的分段解析与持久化同步补上这两个字段。

### 2. 服务端裁剪（扩展现有转码服务）

- `src/lib/videoStitch.functions.ts` 新增 `submitVideoTrimJob` / `pollVideoTrimJob`：
  - `POST {TRANSCODE_API_URL}/trim  { url, startMs, endMs, format: "mp4" } -> { jobId }`
  - `GET  {TRANSCODE_API_URL}/jobs/{jobId} -> { status, outputUrl?, error? }`
  - 复用现有 `TRANSCODE_API_URL` / `TRANSCODE_API_KEY`，未配置时返回明确提示。
- 裁剪结果按 `sourceId|startMs|endMs` 做项目级缓存，同一片段跨集、重跑只裁一次。

### 3. 前端接线

- `src/components/restyle/RestyleStudio.tsx`：`runRenderQueue` 把 `ensureReferenceVideoUrl(projectId, job.source)` 换成新的 `ensureSegmentReferenceVideoUrl(projectId, job)`：
  1. 取回原片持久 URL（沿用现有逻辑）；
  2. 该段有时间区间且原片超过 30 秒 → 提交裁剪任务、轮询、取回片段 URL；
  3. 裁剪成功 → 用片段 URL 提交，日志写「已裁剪 12.4s 参考片段」；
  4. 裁剪不可用或失败 → 降级为**不带参考视频**提交，日志说明原因，不再让整段失败。
- 素材入库与裁剪轮询增加一次网络重试（退避 2 秒），修掉 `Failed to fetch` 这类瞬时失败。

### 4. 其它渠道

- `src/lib/videoAssetLibrary.ts` 增加时长约束常量；客易云 / 筷子丽帧走素材库时复用同一套裁剪与降级路径，避免同类 400。

## 部署前置

外部转码服务需要先支持 `/trim` 端点。未上线前代码走「不带参考视频」降级，保证仍能出片。

## 验证

- [ ] 分钟级原片 + 8 段 → 每段参考视频时长落在 1.8–30 秒，素材入库返回 200
- [ ] 转码服务未配置 → 分段仍成功（日志提示未使用参考视频）
- [ ] 同一区间重跑 → 命中缓存不重复裁剪
- [ ] 分段全部成功后 → 成片合成正常
