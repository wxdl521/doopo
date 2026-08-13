/**
 * Lovable AI 网关共享层（转绘 v2 使用）。
 *
 * 从 restyleAnalysis.functions.ts 抽出的 provider 解析/参数适配，新增
 * callLovableChat 便捷调用。Gemini（google/gemini-3.6-flash）仅作内部
 * skill 直调，不出现在用户下拉枚举。
 */
import {
  ARK_TEXT_MODEL,
  ARK_TEXT_THINKING_DISABLED,
  arkTextApiKey,
  arkTextEndpoint,
  jingmeiApiKey,
  jingmeiEndpoint,
  qwenApiKey,
} from "../arkText";

const QWEN_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const LOVABLE_ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type RestyleProviderConfig = {
  provider: "ark" | "qwen" | "lovable" | "jingmei";
  model: string;
  endpoint: string;
  apiKey: string | undefined;
  missingKeyError: string;
  label: string;
  /**
   * 是否支持 response_format=json_object。jingmei(Foundry v1 项目端点)未实测
   * 该参数（资产提炼不带它能正常出结果,方案生成带它 16 分钟无响应）——
   * 对 jingmei 省略,JSON 由 prompt 约束 + parseJson 容错解析兜底。
   */
  supportsJsonMode: boolean;
};

/** 把带前缀的模型 id 解析成上游 provider 配置。process.env 只在 handler 内读取。 */
export function resolveProvider(modelId: string): RestyleProviderConfig {
  if (modelId.startsWith("jingmei:")) {
    // jingmei(Azure AI Foundry 项目端点):v1 路径 + api-key 认证(非 Bearer)
    return {
      provider: "jingmei",
      model: modelId.slice(8),
      endpoint: jingmeiEndpoint(),
      apiKey: jingmeiApiKey(),
      missingKeyError: "jingmei 未配置：请设置 JINGMEI_API_KEY。",
      label: "jingmei",
      supportsJsonMode: false,
    };
  }
  if (modelId.startsWith("ark:")) {
    return {
      provider: "ark",
      model: modelId.slice(4) || ARK_TEXT_MODEL,
      endpoint: arkTextEndpoint(),
      apiKey: arkTextApiKey(),
      missingKeyError: "DeepSeek V4 Pro 未配置：请设置 ARK_API_KEY。",
      label: "DeepSeek",
      supportsJsonMode: true,
    };
  }
  if (modelId.startsWith("lovable:")) {
    return {
      provider: "lovable",
      model: modelId.slice(8),
      endpoint: LOVABLE_ENDPOINT,
      apiKey: process.env.LOVABLE_API_KEY,
      missingKeyError: "GPT-5.5 未配置：Lovable AI 网关缺少 LOVABLE_API_KEY。",
      label: "GPT-5.5",
      supportsJsonMode: true,
    };
  }
  return {
    provider: "qwen",
    model: modelId.slice(5),
    endpoint: QWEN_ENDPOINT,
    apiKey: qwenApiKey(),
    missingKeyError: "Qwen 未配置：请设置 Qwen、QWEN_API_KEY 或 DASHSCOPE_API_KEY。",
    label: "Qwen",
    supportsJsonMode: true,
  };
}

/**
 * 各家对采样/长度参数的要求不同：GPT-5 系列拒绝 temperature 和 max_tokens，
 * 只接受 max_completion_tokens；ARK 需要显式关闭 thinking。
 * jingmei(gpt-5.5/gpt-5.6-sol)同为推理模型:只发 max_completion_tokens,
 * 且预算不能给太小(reasoning token 会撞上限报错,实测 max_completion_tokens=1 即撞)。
 * opts.reasoningEffort：仅 lovable 网关透传 reasoning_effort（分窗调用压
 * 推理延迟用 "low"；缺省不传，保持网关默认行为）。
 */
export function providerTuning(
  config: RestyleProviderConfig,
  maxTokens: number,
  opts?: { reasoningEffort?: "none" | "low" },
): Record<string, unknown> {
  if (config.provider === "lovable") {
    return {
      max_completion_tokens: maxTokens,
      ...(opts?.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
    };
  }
  if (config.provider === "jingmei") {
    // 推理模型:只发 max_completion_tokens;分窗路径透传 reasoning_effort=low
    // 压推理耗时(全档推理跑 5k 输出预算会超过 90s 单窗超时,每窗都撞超时)。
    return {
      max_completion_tokens: maxTokens,
      ...(opts?.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
    };
  }
  return {
    ...(config.provider === "ark" ? { thinking: ARK_TEXT_THINKING_DISABLED } : {}),
    temperature: 0.2,
    max_tokens: maxTokens,
  };
}

/** 认证头组包:多数渠道 Bearer;jingmei(Azure AI Foundry)用 api-key(非 Bearer)。 */
export function providerAuthHeaders(config: RestyleProviderConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(config.provider === "jingmei"
      ? { "api-key": config.apiKey ?? "" }
      : { Authorization: `Bearer ${config.apiKey ?? ""}` }),
  };
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
};

export type GatewayChatResult =
  | { ok: true; text: string; model: string }
  | { ok: false; error: string };

type GatewayOptions = {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  timeoutMs?: number;
  jsonMode?: boolean;
  /** 默认 "none"：不让推理 token 吃掉输出预算（gemini 空正文根因）。 */
  reasoningEffort?: "none" | "low" | "medium" | "high";
};

async function postChat(opts: GatewayOptions, maxTokens: number, extraNote?: string) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return { ok: false as const, error: "Lovable AI 网关缺少 LOVABLE_API_KEY。" };
  }
  const messages = extraNote
    ? [...opts.messages, { role: "user" as const, content: extraNote }]
    : opts.messages;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 180_000);
  try {
    const response = await fetch(LOVABLE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: opts.model,
        max_completion_tokens: maxTokens,
        reasoning_effort: opts.reasoningEffort ?? "none",
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages,
      }),
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 300);
      return { ok: false as const, error: `网关 HTTP ${response.status}: ${body}` };
    }
    return { ok: true as const, json: (await response.json()) as Record<string, unknown> };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false as const, error: `网关调用失败: ${msg}` };
  } finally {
    clearTimeout(timeout);
  }
}

function extractChoice(json: Record<string, unknown>) {
  const choices = json.choices as
    | Array<{ finish_reason?: string; message?: { content?: string } }>
    | undefined;
  const usage = json.usage as
    | { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } }
    | undefined;
  return {
    text: choices?.[0]?.message?.content ?? "",
    finishReason: choices?.[0]?.finish_reason ?? "unknown",
    completionTokens: usage?.completion_tokens ?? 0,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

/**
 * 调 Lovable 网关 chat/completions（OpenAI 兼容）。
 * modelId 不带前缀（如 "openai/gpt-5.6-sol"、"google/gemini-3.6-flash"）。
 * GPT-5 系列只发 max_completion_tokens；不传 temperature。
 * 空正文（典型：gemini 把预算全花在 reasoning token）自动重试一次，
 * 重试抬高 token 上限并追加「直接输出 JSON」指令；仍空则带 token 诊断报错。
 */
export async function callLovableChat(opts: GatewayOptions): Promise<GatewayChatResult> {
  const maxTokens = opts.maxTokens ?? 12_000;
  const first = await postChat(opts, maxTokens);
  if (!first.ok) return { ok: false, error: first.error };
  let choice = extractChoice(first.json);

  if (!choice.text.trim()) {
    // 空正文重试：抬高输出预算并明确要求跳过思考过程
    const retry = await postChat(
      opts,
      Math.max(maxTokens * 2, 12_000),
      "直接输出 JSON 正文，不要输出任何思考过程。",
    );
    if (!retry.ok) return { ok: false, error: retry.error };
    choice = extractChoice(retry.json);
  }

  if (!choice.text.trim()) {
    return {
      ok: false,
      error:
        `网关返回为空（finish_reason=${choice.finishReason}，` +
        `completion_tokens=${choice.completionTokens}，其中 reasoning_tokens=${choice.reasoningTokens}）`,
    };
  }
  return { ok: true, text: choice.text, model: opts.model };
}

/** 内部 skill 模型 id（不进用户下拉）。 */
export const INTERNAL_DIRECTOR_MODEL = "openai/gpt-5.6-sol";
export const INTERNAL_DIRECTOR_FALLBACK_MODEL = "openai/gpt-5.5";
export const INTERNAL_VISION_MODEL = "google/gemini-3.6-flash";
