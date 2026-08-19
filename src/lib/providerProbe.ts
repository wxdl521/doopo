// ====================================================================
// providerProbe —— 后台「测试连接」的分型探测策略（纯函数,可单测）
//
// 根因（2026-08 误报泛滥）：testProviderConnection 固定探测
// GET {baseUrl}/v1/models——只适配 OpenAI 兼容网关。各家 base_url 约定
// 不同（jieyun 含 /api/v3 路径、jingmei 的 /models 根本不存在、jimeng 是
// AK/SK 签名无 REST 清单、Azure 系要 api-key 头）,正常供应商也报失败。
// 本模块按 provider code 给出探测 URL/认证方式;拿不准的回退 /v1/models
// 并在失败文案里提示人工确认。
// ====================================================================

export interface ProviderProbePlan {
  /** 完整探测 URL */
  url: string;
  /** true = AK/SK 签名或无 REST 清单的渠道:任何 HTTP 响应都算服务活着 */
  reachabilityOnly: boolean;
  /** 策略说明（实测/推断/回退）,失败文案用 */
  note?: string;
}

const stripTrailing = (url: string) => url.replace(/\/+$/, "");

/**
 * 按供应商 code 生成探测计划。base_url 约定见 ai_providers 种子
 * （20260805100000_create_ai_providers.sql）。
 */
export function probePlanFor(code: string, baseUrl: string): ProviderProbePlan {
  const c = (code || "").trim().toLowerCase();
  const base = stripTrailing(baseUrl);
  // jieyun:base 含 /api/v3（视频接口前缀）,models 在剥掉后的根下（实测）
  if (c === "jieyun") {
    return { url: `${base.replace(/\/api\/v3$/i, "")}/v1/models`, reachabilityOnly: false };
  }
  // tokenpony:{base}/v1/models 实测存在
  if (c === "tokenpony") {
    return { url: `${base}/v1/models`, reachabilityOnly: false };
  }
  // azure-image2（晶美 APIM）:/openai/v1/models 实测 393 个模型;api-key 认证
  if (c === "azure-image2") {
    return { url: `${base}/openai/v1/models`, reachabilityOnly: false };
  }
  // azure 系官方资源（azure/azure2/azure3/azure0716）:deployment 风格,
  // /openai/models 列表端点;api-key 认证（凭证头由调用方按 capabilities 带）
  if (c === "azure" || c === "azure2" || c === "azure3" || c === "azure0716") {
    return {
      url: `${base}/openai/models?api-version=2024-02-01`,
      reachabilityOnly: false,
    };
  }
  // jingmei（Azure AI Foundry 项目端点）:/models 列表实测不存在,
  // 只验端点可达（任何 HTTP 响应都算活着）
  if (c === "jingmei") {
    return {
      url: base,
      reachabilityOnly: true,
      note: "该端点不提供模型清单,仅验证连通性",
    };
  }
  // jimeng 等 AK/SK 签名渠道:无 REST 清单端点,只验可达
  if (c === "jimeng") {
    return {
      url: base,
      reachabilityOnly: true,
      note: "AK/SK 签名渠道无 REST 清单,仅验证连通性",
    };
  }
  // ARK 协议族(ark/shuci/vapeur/topenrouter 等):base 含或补 /api/v3,
  // GET {base}/models(OpenAI 兼容清单);topenrouter 清单端点未经实测,
  // 失败时按文案人工确认
  if (c === "ark" || c === "shuci" || c === "vapeur" || c === "topenrouter") {
    const apiBase = /\/api\/v3$/i.test(base) ? base : `${base}/api/v3`;
    return {
      url: `${apiBase}/models`,
      reachabilityOnly: false,
      note: c === "topenrouter" ? "清单端点未经实测,失败请人工确认" : undefined,
    };
  }
  // 回退:OpenAI 兼容默认路径,失败文案提示人工确认（不再笼统报失败）
  return {
    url: `${base}/v1/models`,
    reachabilityOnly: false,
    note: "该供应商可能不使用 OpenAI 兼容路径，请人工确认",
  };
}

export type ProbeOutcome = "ok" | "auth-fail" | "unreachable";

/**
 * 探测结果三分类:
 * - ok:2xx（或 reachabilityOnly 下任何 HTTP 响应=服务活着）;
 * - auth-fail:401/403（服务通、密钥问题）→ 引导检查密钥;
 * - unreachable:网络错误/404（地址问题）→ 引导检查地址。
 */
export function classifyProbeStatus(
  status: number | null,
  reachabilityOnly: boolean,
): { outcome: ProbeOutcome; message: string } {
  if (status == null) {
    return { outcome: "unreachable", message: "连接失败（网络/超时）,请检查接口地址" };
  }
  if (reachabilityOnly) {
    return { outcome: "ok", message: `端点可达（HTTP ${status},仅验证连通性）` };
  }
  if (status >= 200 && status < 300) {
    return { outcome: "ok", message: "" };
  }
  if (status === 401 || status === 403) {
    return {
      outcome: "auth-fail",
      message: `服务可达但认证失败（HTTP ${status}）——地址正常,请检查密钥`,
    };
  }
  return {
    outcome: "unreachable",
    message: `上游返回 HTTP ${status}——请检查接口地址`,
  };
}
