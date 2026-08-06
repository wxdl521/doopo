// ====================================================================
//  Azure OpenAI gpt-image-2 —— 官方 REST(b64_json 响应)
//
//  Base URL: https://ywkjpolandcentral.cognitiveservices.azure.com
//            (env: AZURE_OPENAI_BASE_URL 可覆盖)
//  Auth:     api-key: ${AZURE_API_KEY}
//
//  - T2I: POST /openai/deployments/gpt-image-2/images/generations
//         ?api-version=2024-02-01
//  - I2I: POST /openai/deployments/gpt-image-2/images/edits
//         ?api-version=2025-04-01-preview   (multipart/form-data)
//
//  UI 选项约定:模型 id 以 `azure/` 前缀,seedream.functions.ts 据此分发。
//
//  azure3 = services.ai.azure.com 资源,走 deployment 路径(与 azure/azure2 一致,非 /openai/v1/ 新路径):
//    仅 env 不同(AZURE3_API_KEY / AZURE3_BASE_URL)。services.ai.azure.com 虽也支持 /openai/v1/... 新路径,
//    但只有 deployment 路径的调用进 Azure Portal「Azure OpenAI Requests」指标,对方按该指标对账才看得到。
// ====================================================================

import "./loadEnv";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getOptionalAuthCtx } from "./authContext.server";
import { chargeCredits } from "./userCredits.functions";
import { imageCost } from "./creditsCost";

const DEFAULT_BASE_URL = "https://ywkjpolandcentral.cognitiveservices.azure.com";
const T2I_API_VERSION = "2025-04-01-preview";
const I2I_API_VERSION = "2025-04-01-preview";
// Azure0716 generation is provisioned on the stable API, while Azure exposes
// the image-edit route on the 2025-04-01-preview surface.
const AZURE0716_T2I_API_VERSION = "2024-02-01";
const AZURE0716_I2I_API_VERSION = "2025-04-01-preview";
const IMAGE_REQUEST_TIMEOUT_MS = 600_000;
const AZURE_PREFIX = "azure/";
const AZURE2_PREFIX = "azure2/";
const AZURE3_PREFIX = "azure3/";
const AZURE0716_PREFIX = "azure0716/";

export function isAzureModel(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  const lower = modelId.toLowerCase();
  return (
    lower.startsWith(AZURE_PREFIX) ||
    lower.startsWith(AZURE2_PREFIX) ||
    lower.startsWith(AZURE3_PREFIX) ||
    lower.startsWith(AZURE0716_PREFIX)
  );
}

export function stripAzurePrefix(modelId: string): string {
  return modelId.replace(/^(azure|azure2|azure3|azure0716)\//i, "");
}

function isAzure2Model(modelId: string): boolean {
  return modelId.toLowerCase().startsWith(AZURE2_PREFIX);
}

function isAzure3Model(modelId: string): boolean {
  return modelId.toLowerCase().startsWith(AZURE3_PREFIX);
}

function isAzure0716Model(modelId: string): boolean {
  return modelId.toLowerCase().startsWith(AZURE0716_PREFIX);
}

function getAzureConfig(modelId?: string) {
  if (modelId && isAzure0716Model(modelId)) {
    return {
      apiKey: process.env.AZURE0716_API_KEY,
      baseUrl: (process.env.AZURE0716_BASE_URL || "").replace(/\/+$/, ""),
      auth: "bearer" as const,
      t2iApiVersion: AZURE0716_T2I_API_VERSION,
      i2iApiVersion: AZURE0716_I2I_API_VERSION,
      supportsPartialImages: true,
      envName: "AZURE0716_API_KEY",
    };
  }
  if (modelId && isAzure3Model(modelId)) {
    // azure3 是 services.ai.azure.com 资源,endpoint 与 azure/azure2 不同;
    // 缺 AZURE3_BASE_URL 不能 fallback 到 DEFAULT_BASE_URL(会打到错的资源),留空让调用方报错
    return {
      apiKey: process.env.AZURE3_API_KEY,
      baseUrl: (process.env.AZURE3_BASE_URL || "").replace(/\/+$/, ""),
      auth: "api-key" as const,
      supportsPartialImages: true,
      envName: "AZURE3_API_KEY",
    };
  }
  if (modelId && isAzure2Model(modelId)) {
    // 同理,azure2 endpoint 与 azure/ 不同,缺配置留空报错
    return {
      apiKey: process.env.AZURE2_API_KEY,
      baseUrl: (process.env.AZURE2_BASE_URL || "").replace(/\/+$/, ""),
      auth: "api-key" as const,
      supportsPartialImages: true,
      envName: "AZURE2_API_KEY",
    };
  }
  return {
    apiKey: process.env.AZURE_API_KEY,
    baseUrl: (process.env.AZURE_OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    auth: "api-key" as const,
    supportsPartialImages: true,
    envName: "AZURE_API_KEY",
  };
}

type AzureImageInput = {
  prompt: string;
  model: string;
  size?: string;
  n?: number;
  quality?: "auto" | "low" | "medium" | "high";
  stream?: boolean;
  referenceImages?: string[];
};

type AzureImageResult = {
  url: string;
  urls: string[];
  error: string | null;
  model: string;
  meta?: AzureImageMeta;
};

export type AzureImageMeta = {
  requestId: string;
  azureRequestId?: string;
  apimRequestId?: string;
  region?: string;
  processingMs?: number;
  durationMs: number;
  status: number;
  deployment: string;
  endpoint: "generations" | "edits";
  apiVersion: string;
  retries: number;
};

const AZURE_LEGACY_IMAGE_SIZES = new Set([
  "1024x1024",
  "1024x1536",
  "1536x1024",
  "1024x1792",
  "1792x1024",
]);

function normalizeAzureSize(size: string | undefined, deployment: string): string {
  const s = (size || "").trim().toLowerCase().replace(/\*/g, "x");
  const m = s.match(/^(\d+)x(\d+)$/);
  // GPT-image-2 supports custom sizes: both edges are multiples of 16, the
  // long edge is <= 3840, aspect ratio is <= 3:1, and the area is bounded.
  // Keep valid requested dimensions intact instead of forcing legacy presets.
  if (/^gpt-image-2(?:$|[-_])/i.test(deployment) && m) {
    const w = parseInt(m[1], 10);
    const h = parseInt(m[2], 10);
    const pixels = w * h;
    const ratio = Math.max(w, h) / Math.min(w, h);
    if (
      w % 16 === 0 &&
      h % 16 === 0 &&
      Math.max(w, h) <= 3840 &&
      ratio <= 3 &&
      pixels >= 655_360 &&
      pixels <= 8_294_400
    ) {
      return `${w}x${h}`;
    }
  }
  if (AZURE_LEGACY_IMAGE_SIZES.has(s)) return s;
  if (m) {
    const w = parseInt(m[1], 10),
      h = parseInt(m[2], 10);
    if (w > h * 1.3) return "1792x1024";
    if (h > w * 1.3) return "1024x1792";
    // Older image deployments offer only preset dimensions. Large square
    // design sheets need more vertical room than a 1024px square can provide.
    if (w >= 1536 && h >= 1536) return "1024x1792";
    return "1024x1024";
  }
  return "1024x1024";
}

function normalizeAzureQuality(q: string | undefined): "low" | "medium" | "high" {
  if (q === "high") return "high";
  if (q === "low") return "low";
  return "medium";
}

type AzureImageItem = { url?: string; b64_json?: string };

/** 把 Azure / 兼容网关的图片字段统一成浏览器可用的 data URL。
 *
 * 官方 Azure 返回的是纯 base64；部分兼容网关却把完整 data URL 放进
 * b64_json。旧逻辑会在后者前面再拼一次 `data:image/png;base64,`，得到
 * 一个看似成功、实际无法解码的 src，前端遂显示裂图。
 */
function toImageDataUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";
  if (/^data:image\/[\w.+-]+;base64,/i.test(raw)) return raw;
  // SSE 代理偶尔会在 base64 中插入换行；没有空白时避免为高分辨率图复制整段 base64。
  const normalized = /\s/.test(raw) ? raw.replace(/\s/g, "") : raw;
  return `data:image/png;base64,${normalized}`;
}

function imageBytesAreValid(dataUrl: string): boolean {
  const prefix = dataUrl.match(/^data:image\/[\w.+-]+;base64,([A-Za-z0-9+/=]{16,32})/i);
  if (!prefix) return false;
  // 只解码文件头。此前会把 4K 图片的整段 base64 再解码一次，导致大图 I2I
  // 在返回阶段出现 RangeError/stack overflow；Azure 已对完整响应做过校验。
  const bytes = Buffer.from(prefix[1], "base64");
  // GPT Image 的输出是 PNG 或 JPEG；在这里拒绝 HTML/JSON 等误被当作图片的响应。
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return isPng || isJpeg;
}

/** Azure 在 stream=true 时返回 SSE；只优先取完成事件中的最终图，避免把中间预览当成成品。 */
function parseAzureImageItems(rawText: string): AzureImageItem[] {
  const payloads: any[] = [];
  const normalJson = (() => {
    try {
      return JSON.parse(rawText);
    } catch {
      return null;
    }
  })();
  if (normalJson) payloads.push(normalJson);

  // SSE event 中可能是 `data: { ... }`，也可能分成多行 data 字段。
  for (const block of rawText.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== "[DONE]")
      .join("\n");
    if (!data) continue;
    try {
      payloads.push(JSON.parse(data));
    } catch {
      // 非 JSON 心跳事件无需处理。
    }
  }

  const eventItems = payloads.map((payload) => ({
    type: String(payload?.type || payload?.event || ""),
    items:
      (Array.isArray(payload?.data) && payload.data) ||
      (payload?.b64_json || payload?.url ? [{ b64_json: payload.b64_json, url: payload.url }] : []),
  }));
  // 完成事件优先；若服务端仅发 partial 事件，最后一张仍是当前可用的最佳结果。
  const completed = eventItems.filter(
    ({ type, items }) => items.length && /completed|final|result|done/i.test(type),
  );
  const selected = completed.length
    ? completed.at(-1)!.items
    : eventItems.filter((x) => x.items.length).at(-1)?.items;
  return (selected ?? []) as AzureImageItem[];
}

export async function callAzureImage(input: AzureImageInput): Promise<AzureImageResult> {
  const { apiKey, baseUrl, auth, t2iApiVersion, i2iApiVersion, supportsPartialImages, envName } =
    getAzureConfig(input.model);
  const deployment = stripAzurePrefix(input.model) || "gpt-image-2";
  const hasRefs = !!input.referenceImages?.length;
  // azure3 与 azure/azure2 一致,走 deployment 路径(/openai/deployments/{dep}/images/...?api-version=)。
  // services.ai.azure.com 虽也支持 /openai/v1/... 新路径,但只有 deployment 路径的调用进 Portal
  // 「Azure OpenAI Requests」指标——对方按该指标对账,v1 路径计量归属另一维度,对方查不到会误以为没调用。
  const apiVersion = hasRefs ? i2iApiVersion || I2I_API_VERSION : t2iApiVersion || T2I_API_VERSION;
  const path = hasRefs
    ? `/openai/deployments/${deployment}/images/edits`
    : `/openai/deployments/${deployment}/images/generations`;
  const url = `${baseUrl}${path}?api-version=${apiVersion}`;
  const size = normalizeAzureSize(input.size, deployment);
  const quality = normalizeAzureQuality(input.quality);
  const streamPartialImages = supportsPartialImages && (input.stream ?? quality === "high");
  const t0 = Date.now();
  const requestId = `azr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const endpoint: "generations" | "edits" = hasRefs ? "edits" : "generations";
  const baseMeta = { requestId, deployment, endpoint, apiVersion };
  console.log(
    `[azure→] rid=${requestId} deployment=${deployment} endpoint=${endpoint} apiVersion=${apiVersion} refs=${input.referenceImages?.length ?? 0} size=${size} quality=${quality} stream=${streamPartialImages}`,
  );

  if (!apiKey) {
    console.warn(`[azure×] rid=${requestId} deployment=${deployment} missing ${envName}`);
    return {
      url: "",
      urls: [],
      error: `${envName} not configured`,
      model: deployment,
      meta: { ...baseMeta, durationMs: 0, status: 0, retries: 0 },
    };
  }
  if (!baseUrl) {
    console.warn(`[azure×] rid=${requestId} model=${input.model} missing AZURE_BASE_URL`);
    return {
      url: "",
      urls: [],
      error: `AZURE base url not configured for ${input.model}`,
      model: deployment,
      meta: { ...baseMeta, durationMs: 0, status: 0, retries: 0 },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS);
  let stage = hasRefs ? "prepare-edits" : "prepare-generations";
  try {
    let requestInit: RequestInit;
    if (hasRefs) {
      const form = new FormData();
      form.append("prompt", input.prompt);
      form.append("n", String(input.n ?? 1));
      form.append("size", size);
      form.append("quality", quality);
      if (streamPartialImages) {
        form.append("stream", "true");
        form.append("partial_images", "3");
      }
      const refs = input.referenceImages!;
      // Azure gpt-image-2 edits: 单图用 `image`，多图必须用 `image[]`（重复 `image` 会 400 Duplicate parameter）
      const fieldName = refs.length > 1 ? "image[]" : "image";
      for (let i = 0; i < refs.length; i++) {
        const refUrl = refs[i];
        let blob: Blob;
        let mime = "image/png";
        if (refUrl.startsWith("data:")) {
          const m = refUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (!m) throw new Error(`invalid data url for ref ${i}`);
          mime = m[1] || "image/png";
          const bin = Buffer.from(m[2], "base64");
          blob = new Blob([bin], { type: mime });
        } else {
          const r = await fetch(refUrl);
          if (!r.ok) throw new Error(`fetch ref ${i} failed: ${r.status}`);
          mime = r.headers.get("content-type") || "image/png";
          blob = await r.blob();
          // 某些 CDN/存储返回 application/octet-stream,Azure edits 只认 image/jpeg, image/png, image/webp
          if (!/^image\/(jpeg|png|webp)$/i.test(mime)) {
            mime = "image/png";
            blob = new Blob([await blob.arrayBuffer()], { type: mime });
          }
        }
        const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
        form.append(fieldName, blob, `ref_${i}.${ext}`);
      }
      requestInit = {
        method: "POST",
        headers: {
          ...(auth === "bearer" ? { Authorization: `Bearer ${apiKey}` } : { "api-key": apiKey }),
          ...(streamPartialImages ? { Accept: "text/event-stream" } : {}),
        },
        body: form,
        signal: controller.signal,
      };
    } else {
      const body: Record<string, unknown> = {
        prompt: input.prompt,
        n: input.n ?? 1,
        size,
        quality,
        ...(streamPartialImages ? { stream: true, partial_images: 3 } : {}),
      };
      requestInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth === "bearer" ? { Authorization: `Bearer ${apiKey}` } : { "api-key": apiKey }),
          ...(streamPartialImages ? { Accept: "text/event-stream" } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      };
    }

    let res: Response | null = null;
    let lastText = "";
    let retries = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      stage = `request-${endpoint}`;
      res = await fetch(url, requestInit);
      if (res.ok) break;
      lastText = await res.text().catch(() => "");
      const transient =
        res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
      if (!transient || attempt === 2) break;
      const wait = res.status === 429 ? 8000 : 1500;
      retries++;
      console.warn(
        `[azure⟳] rid=${requestId} deployment=${deployment} status=${res.status} retry#${retries} in ${wait}ms`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
    clearTimeout(timeout);

    // 对账用:x-request-id 是后端 Azure OpenAI/AI Foundry 服务侧 id,对方后台/诊断日志按它检索;
    // apim-request-id 是 APIM 网关侧 id,与后端 id 不同,单独留作网关侧备查。
    const azureRequestId =
      res?.headers.get("x-request-id") || res?.headers.get("apim-request-id") || undefined;
    const apimRequestId = res?.headers.get("apim-request-id") || undefined;
    const region = res?.headers.get("x-ms-region") || undefined;
    const processingMsHeader =
      res?.headers.get("openai-processing-ms") || res?.headers.get("x-ms-processing-time");
    const processingMs = processingMsHeader ? Number(processingMsHeader) : undefined;

    if (!res || !res.ok) {
      const status = res?.status ?? 0;
      const dur = Date.now() - t0;
      console.warn(
        `[azure×] rid=${requestId} azureRid=${azureRequestId ?? "-"} region=${region ?? "-"} deployment=${deployment} status=${status} dur=${dur}ms retries=${retries} body=${lastText.slice(0, 200)}`,
      );
      return {
        url: "",
        urls: [],
        error: `[azure ${deployment}] ${status}: ${lastText.slice(0, 300)} (rid=${requestId})`,
        model: deployment,
        meta: {
          ...baseMeta,
          durationMs: dur,
          status,
          retries,
          azureRequestId,
          apimRequestId,
          region,
          processingMs,
        },
      };
    }

    stage = "read-response";
    const rawText = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(rawText);
    } catch {}

    stage = "parse-response";
    const items = parseAzureImageItems(rawText);
    const urls = items
      .map((d) => {
        if (d.url) return d.url;
        if (d.b64_json) return toImageDataUrl(d.b64_json);
        return "";
      })
      .filter(Boolean)
      // URL 由 Azure 托管时不能在这里同步验证；base64 则必须先验证，避免将
      // SSE 事件、错误 JSON 或被二次包装的 data URL 误报为成功结果。
      .filter((value) => !value.startsWith("data:") || imageBytesAreValid(value));

    if (urls.length === 0) {
      const dur = Date.now() - t0;
      console.warn(
        `[azure×] rid=${requestId} azureRid=${azureRequestId ?? "-"} deployment=${deployment} empty-data dur=${dur}ms raw=${rawText.slice(0, 300)}`,
      );
      return {
        url: "",
        urls: [],
        error: `[azure ${deployment}] no image returned: ${json?.error?.message || rawText.slice(0, 200) || "empty data"} (rid=${requestId})`,
        model: deployment,
        meta: {
          ...baseMeta,
          durationMs: dur,
          status: res.status,
          retries,
          azureRequestId,
          apimRequestId,
          region,
          processingMs,
        },
      };
    }
    const dur = Date.now() - t0;
    console.log(
      `[azure✓] rid=${requestId} azureRid=${azureRequestId ?? "-"} apimRid=${apimRequestId ?? "-"} region=${region ?? "-"} deployment=${deployment} images=${urls.length} dur=${dur}ms procMs=${processingMs ?? "-"} retries=${retries}`,
    );
    // 成功才扣分(生图积分,按张)。未登录/不在价目表 -> 跳过;扣失败不阻断
    const __ctx = await getOptionalAuthCtx();
    const __cost = imageCost(input.model);
    if (__ctx && __cost != null) {
      await chargeCredits(__ctx.supabase, __ctx.userId, {
        amount: __cost,
        model: input.model,
        description: "生图 · azure",
      });
    }
    return {
      url: urls[0],
      urls,
      error: null,
      model: deployment,
      meta: {
        ...baseMeta,
        durationMs: dur,
        status: res.status,
        retries,
        azureRequestId,
        apimRequestId,
        region,
        processingMs,
      },
    };
  } catch (e) {
    clearTimeout(timeout);
    const dur = Date.now() - t0;
    console.warn(
      `[azure×] rid=${requestId} deployment=${deployment} stage=${stage} dur=${dur}ms err=${e instanceof Error ? e.message : "fetch failed"}`,
    );
    return {
      url: "",
      urls: [],
      error: `[azure ${deployment}] ${stage}: ${e instanceof Error ? e.message : "fetch failed"} (rid=${requestId})`,
      model: deployment,
      meta: { ...baseMeta, durationMs: dur, status: 0, retries: 0 },
    };
  }
}

// ---------- ServerFn 入口 ----------
const AzureImageFnInput = z.object({
  prompt: z.string().min(1),
  model: z.string().min(1).max(200),
  size: z.string().max(50).optional(),
  n: z.number().int().min(1).max(4).optional(),
  quality: z.enum(["auto", "low", "high"]).optional(),
  referenceImages: z.array(z.string().url()).max(16).optional(),
});

export const generateAzureImage = createServerFn({ method: "POST" })
  .validator((d: unknown) => AzureImageFnInput.parse(d))
  .handler(async ({ data }) => {
    return callAzureImage(data);
  });
