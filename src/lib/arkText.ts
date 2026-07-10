// ====================================================================
//  arkText -- 火山方舟(ARK)文本模型共享配置
//
//  2026/07:系统内文本生成由 Qwen 改为「DeepSeek V4 Pro(ARK)为主、Qwen 兜底」。
//  本文件集中 ARK 文本调用的 model id / endpoint / key / thinking 开关,
//  避免散落在 aiGenerate / scriptAgent / scriptPipeline / storyboard /
//  parseImportedScript 5 个文件里硬编码漂移。
//
//  - 复用现有 process.env.ARK_API_KEY(图片/视频同 key,账号级通用)
//  - base url 复用 process.env.ARK_BASE_URL(默认 https://ark.cn-beijing.volces.com/api/v3)
//  - thinking 显式 disabled:走通用对话快模式,避免深度思考 30 分钟级超时,
//    与 Qwen 无思考行为对齐
// ====================================================================

/** DeepSeek V4 Pro,ARK 在线推理接入点 Model ID */
export const ARK_TEXT_MODEL = "deepseek-v4-pro-260425";

/** 关闭深度思考(通用对话模式,快) */
export const ARK_TEXT_THINKING_DISABLED = { type: "disabled" } as const;

/** ARK 文本 API key(账号级,与图片/视频共用)。未配置返回 undefined。 */
export function arkTextApiKey(): string | undefined {
  return process.env.ARK_API_KEY;
}

/** ARK Chat Completions 端点。 */
export function arkTextEndpoint(): string {
  const base = (process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3").replace(
    /\/+$/,
    "",
  );
  return `${base}/chat/completions`;
}

/**
 * Qwen/DashScope 文本 API key。兼容三种历史变量名:
 * process.env.Qwen(老代码)/ QWEN_API_KEY(.env.local)/ DASHSCOPE_API_KEY。
 * 2026/07:导入/流式等大输出任务回退 Qwen,需保证三种变量名都能取到 key。
 */
export function qwenApiKey(): string | undefined {
  return process.env.Qwen || process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY;
}
