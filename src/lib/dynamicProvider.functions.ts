// ====================================================================
//  动态供应商适配器 —— OpenAI 兼容通用通道
//
//  后台「供应商管理」登记的 kind='openai_compatible' 供应商，按模型
//  capabilities 声明的协议组请求（correction #4，不猜协议）：
//    - T2I:           POST {base_url}/v1/images/generations
//    - I2I json:      POST {base_url}/v1/images/edits      (参考图放 JSON body)
//    - I2I multipart: POST {base_url}/v1/images/edits      (OpenAI 风格表单)
//    - chat:          POST {base_url}/v1/chat/completions  (gemini 风格生图)
//    - 视频:          POST/GET {base_url}/v1/videos/generations (newapi 风格任务)
//    - 认证头:        bearer -> Authorization: Bearer；x-api-key -> api-key: <key>
//
//  路由兜底：seedream.functions.ts / videoGenerate.functions.ts 的内置分发链
//  全部未命中时调用本模块；前缀命中 BUILTIN_ROUTE_PREFIXES 的一律不拦截
//  （内置行为完全不变）。
//
//  免费漏洞防线（correction #2）：上架但未在 model_pricing 配价的动态模型
//  禁止提交生成，返回「该模型暂未定价」。
//
//  失败写 generation_error_logs；密钥只在本模块内解密使用，不进日志、
//  不进 requestPayload。
// ====================================================================

import "./loadEnv";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptProviderSecret } from "./providerSecret.server";
import {
  imagePricingFor,
  isBuiltinRoutePrefix,
  videoPricingFor,
  type ModelCapabilities,
} from "./aiProvidersCache";
import {
  getModelPricingRows,
  isModelPricingCacheStale,
  type ModelPricingRow,
} from "./modelPricingCache";
import { fetchModelPricingFromDb } from "./modelPricing.functions";

const DYNAMIC_REQUEST_TIMEOUT_MS = 180_000;
export const UNPRICED_MODEL_ERROR = "该模型暂未定价，请先在后台「模型定价」配置积分后再使用";

// --------------------------------------------------------------------
// 类型
// --------------------------------------------------------------------

export type DynamicTarget = {
  providerId: string;
  providerCode: string;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  /** 上游真实模型名（路由 key 去掉 <code>/ 前缀后的部分） */
  upstreamModel: string;
  /** 用户侧路由 key（<code>/<model_id>），用于定价匹配与日志 */
  routeKey: string;
  capabilities: ModelCapabilities;
};

export type DynamicImageResult = {
  provider: string;
  url: string;
  error: string | null;
  model: string;
};

// --------------------------------------------------------------------
// 凭据解析（密钥只在服务端解密，绝不外泄）
// --------------------------------------------------------------------

function authHeaders(caps: ModelCapabilities | undefined, apiKey: string): Record<string, string> {
  return caps?.auth_header === "x-api-key"
    ? { "api-key": apiKey }
    : { Authorization: `Bearer ${apiKey}` };
}

/**
 * 供 testProviderConnection 使用：按 provider id 解析 baseUrl + 认证头。
 * auth_header 取该供应商任一已登记模型的声明，缺省 bearer。
 */
export async function resolveProviderCredentials(
  providerId: string,
): Promise<
  { ok: true; baseUrl: string; headers: Record<string, string> } | { ok: false; error: string }
> {
  const { data: provider, error } = await (supabaseAdmin.from as any)("ai_providers")
    .select("id, code, name, kind, base_url, api_key_cipher, env_key_name, enabled")
    .eq("id", providerId)
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!provider) return { ok: false as const, error: "供应商不存在" };
  if (!provider.base_url) return { ok: false as const, error: "未配置接口地址 base_url" };

  const apiKey = await resolveApiKey(provider);
  if (!apiKey) {
    return {
      ok: false as const,
      error: provider.env_key_name
        ? `未读取到密钥（${provider.env_key_name} 未配置，且未登记密钥）`
        : "未登记 API 密钥",
    };
  }

  const { data: model } = await (supabaseAdmin.from as any)("ai_provider_models")
    .select("capabilities")
    .eq("provider_id", providerId)
    .limit(1)
    .maybeSingle();
  const caps = (model?.capabilities ?? undefined) as ModelCapabilities | undefined;

  return {
    ok: true as const,
    baseUrl: String(provider.base_url).replace(/\/+$/, ""),
    headers: authHeaders(caps, apiKey),
  };
}

/** 密钥优先级：登记的密文（PROVIDER_KEY_ENC_SECRET 解密） > env_key_name 指向的现有 Secret */
async function resolveApiKey(provider: any): Promise<string | null> {
  if (provider.api_key_cipher) {
    try {
      return await decryptProviderSecret(provider.api_key_cipher);
    } catch (error) {
      console.error(`[dynamicProvider] 密钥解密失败 provider=${provider.code}:`, error);
      return null;
    }
  }
  if (provider.env_key_name) {
    return process.env[provider.env_key_name] ?? null;
  }
  return null;
}

// --------------------------------------------------------------------
// 动态路由解析：路由 key -> 供应商 + 模型 + 凭据
// --------------------------------------------------------------------

const CODE_PATTERN = /^[a-z0-9][a-z0-9-_]*$/i;

/**
 * 解析动态供应商目标。返回 null 表示「不是动态模型」（前缀内置 / 未登记 /
 * 供应商或模型停用），调用方继续走原有内置/legacy 链路，行为不变。
 */
async function resolveDynamicTarget(
  routeKey: string,
  kind: "image" | "video",
): Promise<{ ok: true; target: DynamicTarget } | { ok: false; error: string } | null> {
  const key = (routeKey || "").trim();
  const slash = key.indexOf("/");
  if (slash <= 0 || slash === key.length - 1) return null;
  const code = key.slice(0, slash).toLowerCase();
  const upstreamModel = key.slice(slash + 1);
  // 内置前缀一律不拦截（双保险；upsertProvider 已阻止登记冲突 code）
  if (isBuiltinRoutePrefix(code)) return null;
  if (!CODE_PATTERN.test(code)) return null;

  const { data: provider, error: pErr } = await (supabaseAdmin.from as any)("ai_providers")
    .select("id, code, name, kind, base_url, api_key_cipher, env_key_name, enabled")
    .ilike("code", code)
    .eq("enabled", true)
    .eq("kind", "openai_compatible")
    .maybeSingle();
  if (pErr) {
    console.error("[dynamicProvider] provider lookup failed:", pErr);
    return null; // DB 异常时按未命中处理，不阻断内置链路
  }
  if (!provider) return null;

  const { data: model, error: mErr } = await (supabaseAdmin.from as any)("ai_provider_models")
    .select("model_id, kind, capabilities, enabled")
    .eq("provider_id", provider.id)
    .eq("model_id", upstreamModel)
    .eq("kind", kind)
    .eq("enabled", true)
    .maybeSingle();
  if (mErr) {
    console.error("[dynamicProvider] model lookup failed:", mErr);
    return null;
  }
  if (!model) {
    return {
      ok: false as const,
      error: `模型「${key}」未在供应商「${provider.name}」下登记或已停用`,
    };
  }

  if (!provider.base_url) {
    return { ok: false as const, error: `供应商「${provider.name}」未配置接口地址` };
  }
  const apiKey = await resolveApiKey(provider);
  if (!apiKey) {
    return { ok: false as const, error: `供应商「${provider.name}」未配置可用密钥` };
  }

  return {
    ok: true as const,
    target: {
      providerId: provider.id,
      providerCode: provider.code,
      providerName: provider.name,
      baseUrl: String(provider.base_url).replace(/\/+$/, ""),
      apiKey,
      upstreamModel,
      routeKey: `${String(provider.code).toLowerCase()}/${upstreamModel}`,
      capabilities: (model.capabilities ?? {}) as ModelCapabilities,
    },
  };
}

// --------------------------------------------------------------------
// 定价闸门（correction #2）：上架但未定价的动态模型禁止提交
// --------------------------------------------------------------------

async function ensurePricingRows(): Promise<ModelPricingRow[]> {
  const rows = getModelPricingRows();
  if (rows && !isModelPricingCacheStale()) return rows;
  try {
    return await fetchModelPricingFromDb(supabaseAdmin);
  } catch (error) {
    console.error("[dynamicProvider] pricing refresh failed:", error);
    return rows ?? [];
  }
}

// --------------------------------------------------------------------
// HTTP helpers
// --------------------------------------------------------------------

async function readErrorBody(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return `HTTP ${res.status}: ${text.slice(0, 300)}`;
}

/** 从 OpenAI images 响应里取图：优先 url，其次 b64_json 转 data URL */
function extractImageFromImagesResponse(json: any): string | null {
  const item = json?.data?.[0];
  if (!item) return null;
  if (typeof item.url === "string" && item.url) return item.url;
  if (typeof item.b64_json === "string" && item.b64_json) {
    return `data:image/png;base64,${item.b64_json}`;
  }
  return null;
}

/** 从 chat/completions 响应里提取图片（URL 或 base64），兼容字符串与分块 content */
function extractImageFromChatResponse(json: any): string | null {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    const md = content.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/);
    if (md) return md[1];
    const url = content.match(/https?:\/\/[^\s)"']+/);
    if (url) return url[0];
    return null;
  }
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === "image_url" && part?.image_url?.url) return part.image_url.url;
      if (part?.inline_data?.data) {
        const mime = part.inline_data.mime_type || "image/png";
        return `data:${mime};base64,${part.inline_data.data}`;
      }
    }
  }
  return null;
}

/** data: URI / http(s) URL -> Blob（multipart 表单用） */
async function refToBlob(ref: string): Promise<Blob> {
  if (ref.startsWith("data:")) {
    const [head, body] = ref.split(",", 2);
    const mime = head.match(/data:([^;,]+)/)?.[1] || "image/png";
    const buf = Buffer.from(body || "", "base64");
    return new Blob([buf], { type: mime });
  }
  const res = await fetch(ref, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`参考图拉取失败 HTTP ${res.status}`);
  return res.blob();
}

function logDynamicError(input: {
  kind: "image" | "video";
  target: DynamicTarget;
  durationMs: number;
  requestPayload: unknown;
  error: string;
}): void {
  import("./errorLogs.server").then(({ logGenerationError }) =>
    logGenerationError({
      kind: input.kind,
      provider: `dynamic:${input.target.providerCode}`,
      model: input.target.routeKey,
      durationMs: input.durationMs,
      requestPayload: input.requestPayload,
      responseBody: input.error,
      errorMessage: input.error,
    }),
  );
}

// --------------------------------------------------------------------
// 图像：T2I / I2I / chat 生图
// --------------------------------------------------------------------

async function callDynamicImage(
  target: DynamicTarget,
  input: {
    prompt: string;
    size?: string;
    referenceImages?: string[];
  },
): Promise<{ url: string; error: string | null }> {
  const caps = target.capabilities;
  const headers = {
    ...authHeaders(caps, target.apiKey),
  };
  const refs = (input.referenceImages ?? []).slice(0, caps.max_reference_images ?? 10);
  const isEdit = refs.length > 0 && caps.api !== "chat";

  try {
    if (caps.api === "chat") {
      // gemini 风格：/v1/chat/completions，文本 + 可选参考图
      const content: any[] = [{ type: "text", text: input.prompt }];
      for (const ref of refs) content.push({ type: "image_url", image_url: { url: ref } });
      const res = await fetch(`${target.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: target.upstreamModel,
          messages: [{ role: "user", content }],
        }),
        signal: AbortSignal.timeout(DYNAMIC_REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) return { url: "", error: await readErrorBody(res) };
      const json = await res.json();
      const url = extractImageFromChatResponse(json);
      return url
        ? { url, error: null }
        : { url: "", error: "上游未返回图片（chat/completions 响应无图像内容）" };
    }

    if (isEdit && caps.edits_protocol === "multipart") {
      // OpenAI 风格 /v1/images/edits：multipart 表单
      const form = new FormData();
      form.append("model", target.upstreamModel);
      form.append("prompt", input.prompt);
      if (input.size) form.append("size", input.size);
      for (const ref of refs) form.append("image", await refToBlob(ref), "reference.png");
      const res = await fetch(`${target.baseUrl}/v1/images/edits`, {
        method: "POST",
        headers, // 不要手动设 Content-Type，fetch 会带 boundary
        body: form,
        signal: AbortSignal.timeout(DYNAMIC_REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) return { url: "", error: await readErrorBody(res) };
      const url = extractImageFromImagesResponse(await res.json());
      return url ? { url, error: null } : { url: "", error: "上游未返回图片（edits 响应为空）" };
    }

    if (isEdit) {
      // json 协议：参考图放 JSON body（Seedream 风格 image 字段）
      const res = await fetch(`${target.baseUrl}/v1/images/edits`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: target.upstreamModel,
          prompt: input.prompt,
          image: refs.length === 1 ? refs[0] : refs,
          ...(input.size ? { size: input.size } : {}),
        }),
        signal: AbortSignal.timeout(DYNAMIC_REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) return { url: "", error: await readErrorBody(res) };
      const url = extractImageFromImagesResponse(await res.json());
      return url ? { url, error: null } : { url: "", error: "上游未返回图片（edits 响应为空）" };
    }

    // T2I：/v1/images/generations
    const res = await fetch(`${target.baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: target.upstreamModel,
        prompt: input.prompt,
        ...(input.size ? { size: input.size } : {}),
      }),
      signal: AbortSignal.timeout(DYNAMIC_REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return { url: "", error: await readErrorBody(res) };
    const url = extractImageFromImagesResponse(await res.json());
    return url
      ? { url, error: null }
      : { url: "", error: "上游未返回图片（generations 响应为空）" };
  } catch (error) {
    const message =
      (error as Error)?.name === "TimeoutError" || (error as Error)?.name === "AbortError"
        ? `生成超时（>${DYNAMIC_REQUEST_TIMEOUT_MS / 1000}s）`
        : `网络错误: ${(error as Error)?.message ?? "fetch failed"}`;
    return { url: "", error: message };
  }
}

/**
 * 图像动态兜底入口。返回 null = 非动态模型（调用方走原链路）；
 * 返回结果对象 = 已接管（成功或失败都直接返回给调用方）。
 */
export async function tryDynamicProviderImage(input: {
  model: string;
  prompt: string;
  size?: string;
  referenceImages?: string[];
}): Promise<DynamicImageResult | null> {
  const startedAt = Date.now();
  const resolved = await resolveDynamicTarget(input.model, "image");
  if (!resolved) return null;
  if (!resolved.ok) {
    return { provider: "dynamic", url: "", error: resolved.error, model: input.model };
  }
  const target = resolved.target;

  // 未定价禁提交（correction #2）
  const pricingRows = await ensurePricingRows();
  if (imagePricingFor(pricingRows, target.routeKey) == null) {
    return {
      provider: target.providerCode,
      url: "",
      error: UNPRICED_MODEL_ERROR,
      model: input.model,
    };
  }

  const r = await callDynamicImage(target, input);
  if (!r.url && r.error) {
    logDynamicError({
      kind: "image",
      target,
      durationMs: Date.now() - startedAt,
      requestPayload: {
        model: target.routeKey,
        prompt: input.prompt,
        size: input.size,
        refs: input.referenceImages?.length ?? 0,
      },
      error: r.error,
    });
  }
  return { provider: target.providerCode, url: r.url, error: r.error, model: input.model };
}

// --------------------------------------------------------------------
// 视频：newapi 风格任务接口（/v1/videos/generations）
// --------------------------------------------------------------------

export type DynamicVideoSubmitResult =
  | { ok: true; taskId: string; providerCode: string }
  | { ok: false; error: string };

export type DynamicVideoPollResult =
  | {
      ok: true;
      status: "succeeded" | "processing" | "failed";
      videoUrl: string | null;
      error?: string;
    }
  | { ok: false; error: string };

/** 视频动态兜底：提交任务。null = 非动态模型。 */
export async function tryDynamicProviderVideoSubmit(input: {
  model: string;
  prompt: string;
  imageUrl?: string;
  ratio?: string;
  resolution?: string;
  duration?: number;
}): Promise<DynamicVideoSubmitResult | null> {
  const startedAt = Date.now();
  const resolved = await resolveDynamicTarget(input.model, "video");
  if (!resolved) return null;
  if (!resolved.ok) return { ok: false as const, error: resolved.error };
  const target = resolved.target;

  // 未定价禁提交（correction #2）：需存在该模型任一启用价目档位
  const pricingRows = await ensurePricingRows();
  if (videoPricingFor(pricingRows, target.routeKey).length === 0) {
    return { ok: false as const, error: UNPRICED_MODEL_ERROR };
  }

  const caps = target.capabilities;
  try {
    const res = await fetch(`${target.baseUrl}/v1/videos/generations`, {
      method: "POST",
      headers: { ...authHeaders(caps, target.apiKey), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: target.upstreamModel,
        prompt: input.prompt,
        ...(input.imageUrl ? { image: input.imageUrl } : {}),
        ...(input.ratio ? { ratio: input.ratio } : {}),
        ...(input.resolution ? { resolution: input.resolution.toLowerCase() } : {}),
        ...(input.duration ? { duration: input.duration } : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const error = await readErrorBody(res);
      logDynamicError({
        kind: "video",
        target,
        durationMs: Date.now() - startedAt,
        requestPayload: {
          model: target.routeKey,
          prompt: input.prompt,
          resolution: input.resolution,
          duration: input.duration,
        },
        error,
      });
      return { ok: false as const, error };
    }
    const json: any = await res.json();
    const taskId = json?.id ?? json?.task_id ?? json?.data?.id ?? null;
    if (!taskId) return { ok: false as const, error: "上游未返回任务 id" };
    return { ok: true as const, taskId: String(taskId), providerCode: target.providerCode };
  } catch (error) {
    return {
      ok: false as const,
      error: `网络错误: ${(error as Error)?.message ?? "fetch failed"}`,
    };
  }
}

/** 视频动态兜底：轮询任务。null = 非动态模型（无法解析供应商）。 */
export async function tryDynamicProviderVideoPoll(input: {
  model?: string;
  taskId: string;
}): Promise<DynamicVideoPollResult | null> {
  if (!input.model) return { ok: false as const, error: "动态供应商轮询缺少 model 参数" };
  const resolved = await resolveDynamicTarget(input.model, "video");
  if (!resolved) return null;
  if (!resolved.ok) return { ok: false as const, error: resolved.error };
  const target = resolved.target;

  try {
    const res = await fetch(
      `${target.baseUrl}/v1/videos/generations/${encodeURIComponent(input.taskId)}`,
      {
        headers: authHeaders(target.capabilities, target.apiKey),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) return { ok: false as const, error: await readErrorBody(res) };
    const json: any = await res.json();
    const status = String(json?.status ?? "").toLowerCase();
    if (status === "succeeded" || status === "completed" || status === "success") {
      const videoUrl =
        json?.video_url ?? json?.data?.[0]?.url ?? json?.output?.url ?? json?.url ?? null;
      return { ok: true as const, status: "succeeded", videoUrl };
    }
    if (status === "failed" || status === "error" || status === "cancelled") {
      const message = json?.error?.message ?? json?.message ?? `任务${status}`;
      // 任务终态失败：ok:true + status:"failed"，由调用方终止轮询（区别于网络抖动）
      return { ok: true as const, status: "failed" as const, videoUrl: null, error: message };
    }
    return { ok: true as const, status: "processing", videoUrl: null };
  } catch (error) {
    return {
      ok: false as const,
      error: `网络错误: ${(error as Error)?.message ?? "fetch failed"}`,
    };
  }
}
