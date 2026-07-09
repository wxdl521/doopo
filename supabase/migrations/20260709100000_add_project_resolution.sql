-- 为 projects 表新增 resolution 列,存储视频生成输出分辨率(480P/720P/1080P)。
-- 仅丽帧 / Doubao Seedance 2.0 系列模型在调用时可选;其他视频模型走各后端默认。
-- 存量项目自动得 '720P' 默认值,前端读取不报错。
ALTER TABLE projects ADD COLUMN IF NOT EXISTS resolution text DEFAULT '720P';
