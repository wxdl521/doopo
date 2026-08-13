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

// ---------- jingmei(Azure AI Foundry 项目端点) ----------
// OpenAI v1 兼容:`POST {base}/openai/v1/chat/completions`(无 api-version,
// /models 与旧版 Foundry 路径均不支持)。认证头 api-key(非 Bearer)。
// 实测可用模型:gpt-5.5 / gpt-6-sol(目录按用户口径登记 gpt-5.6-sol)。

const JINGMEI_DEFAULT_BASE_URL =
  "https://admin-1321-resource.services.ai.azure.com/api/projects/admin-1321";

/** jingmei 文本 API key(env: JINGMEI_API_KEY)。未配置返回 undefined。 */
export function jingmeiApiKey(): string | undefined {
  return process.env.JINGMEI_API_KEY;
}

/** jingmei Chat Completions 端点(v1 路径,env: JINGMEI_BASE_URL 可覆盖 base)。 */
export function jingmeiEndpoint(): string {
  const base = (process.env.JINGMEI_BASE_URL || JINGMEI_DEFAULT_BASE_URL).replace(/\/+$/, "");
  return `${base}/openai/v1/chat/completions`;
}
