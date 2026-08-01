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
  qwenApiKey,
} from "../arkText";

const QWEN_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const LOVABLE_ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type RestyleProviderConfig = {
  provider: "ark" | "qwen" | "lovable";
  model: string;
  endpoint: string;
  apiKey: string | undefined;
  missingKeyError: string;
  label: string;
};

/** 把带前缀的模型 id 解析成上游 provider 配置。process.env 只在 handler 内读取。 */
export function resolveProvider(modelId: string): RestyleProviderConfig {
  if (modelId.startsWith("ark:")) {
    return {
      provider: "ark",
      model: modelId.slice(4) || ARK_TEXT_MODEL,
      endpoint: arkTextEndpoint(),
      apiKey: arkTextApiKey(),
      missingKeyError: "DeepSeek V4 Pro 未配置：请设置 ARK_API_KEY。",
      label: "DeepSeek",
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
    };
  }
  return {
    provider: "qwen",
    model: modelId.slice(5),
    endpoint: QWEN_ENDPOINT,
    apiKey: qwenApiKey(),
    missingKeyError: "Qwen 未配置：请设置 Qwen、QWEN_API_KEY 或 DASHSCOPE_API_KEY。",
    label: "Qwen",
  };
}

/**
 * 各家对采样/长度参数的要求不同：GPT-5 系列拒绝 temperature 和 max_tokens，
 * 只接受 max_completion_tokens；ARK 需要显式关闭 thinking。
 */
export function providerTuning(
  config: RestyleProviderConfig,
  maxTokens: number,
): Record<string, unknown> {
  if (config.provider === "lovable") {
    return { max_completion_tokens: maxTokens };
  }
  return {
    ...(config.provider === "ark" ? { thinking: ARK_TEXT_THINKING_DISABLED } : {}),
    temperature: 0.2,
    max_tokens: maxTokens,
  };
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
};

export type GatewayChatResult =
  | { ok: true; text: string; model: string }
  | { ok: false; error: string };

/**
 * 调 Lovable 网关 chat/completions（OpenAI 兼容）。
 * modelId 不带前缀（如 "openai/gpt-5.6-sol"、"google/gemini-3.6-flash"）。
 * GPT-5 系列只发 max_completion_tokens；不传 temperature。
 */
export async function callLovableChat(opts: {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  timeoutMs?: number;
  jsonMode?: boolean;
}): Promise<GatewayChatResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "Lovable AI 网关缺少 LOVABLE_API_KEY。" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 180_000);
  try {
    const response = await fetch(LOVABLE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: opts.model,
        max_completion_tokens: opts.maxTokens ?? 12_000,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages: opts.messages,
      }),
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 300);
      return { ok: false, error: `网关 HTTP ${response.status}: ${body}` };
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content;
    if (!text) return { ok: false, error: "网关返回为空" };
    return { ok: true, text, model: opts.model };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `网关调用失败: ${msg}` };
  } finally {
    clearTimeout(timeout);
  }
}

/** 内部 skill 模型 id（不进用户下拉）。 */
export const INTERNAL_DIRECTOR_MODEL = "openai/gpt-5.6-sol";
export const INTERNAL_DIRECTOR_FALLBACK_MODEL = "openai/gpt-5.5";
export const INTERNAL_VISION_MODEL = "google/gemini-3.6-flash";
