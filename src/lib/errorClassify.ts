// ====================================================================
// errorClassify —— 生成错误信息归类（工作区页面 toast 文案统一出口）
//
// 从 workspace.$workspaceId.tsx 抽出（原本是该组件内的 useCallback），
// 便于单测；调用方签名不变：classifyError(error, fallback)。
// ====================================================================

/**
 * 把上游/网络错误归类为用户可操作的简短提示。
 * 内容安全类（safety system / content policy / 400 + safety 特征）明确提示
 * 修改提示词,并保留 requestId 便于排查（2026-08 安全拒绝只显示「生成失败」
 * 的改进）；过长错误截断兜底。
 */
export function classifyError(error: string | null | undefined, fallback: string): string {
  if (!error) return fallback;
  const e = error.toLowerCase();
  if (e.includes("timed out") || e.includes("timeout") || e.includes("超时"))
    return "AI 处理超时，请重试";
  if (
    e.includes("401") ||
    e.includes("auth") ||
    e.includes("unauthorized") ||
    e.includes("认证失败")
  )
    return "AI 认证失败，请联系管理员";
  if (
    e.includes("402") ||
    e.includes("no_credits") ||
    e.includes("credits") ||
    e.includes("insufficient") ||
    e.includes("额度")
  )
    return "AI 额度不足，请充值";
  if (e.includes("429") || e.includes("rate limit") || e.includes("too many requests"))
    return "请求过于频繁，请稍后重试";
  // 内容安全系统拒绝（Azure/OpenAI content_policy、safety system、400+safety 特征）：
  // 明确引导改提示词;保留 requestId 便于对照渠道后台排查。
  const requestId = error.match(/request[\s_-]*id[:：\s]*([A-Za-z0-9-]+)/i)?.[1];
  if (
    e.includes("safety system") ||
    e.includes("content policy") ||
    e.includes("content_policy") ||
    e.includes("content management policy") ||
    e.includes("moderation") ||
    e.includes("内容安全") ||
    (e.includes("400") && (e.includes("safety") || e.includes("policy")))
  ) {
    return `提示词被内容安全系统拒绝，请修改敏感描述后重试${requestId ? `（requestId: ${requestId}）` : ""}`;
  }
  if (e.includes("upload failed")) return `存储上传失败: ${error}`;
  if (e.includes("upstream fetch") || e.includes("fetch failed") || e.includes("无法获取"))
    return "图片源已失效，无法转存到存储";
  if (e.includes("not found") || e.includes("404")) return "图片链接不存在(404)";
  // 截断过长错误信息(超过 60 字符截断)
  if (error.length > 60) return `${error.slice(0, 57)}...`;
  return error;
}
