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
import { getOptionalAuthCtx } from "./authContext";
import { chargeCredits } from "./userCredits.functions";
import { imageCost } from "./creditsCost";

const DEFAULT_BASE_URL = "https://ywkjpolandcentral.cognitiveservices.azure.com";
const T2I_API_VERSION = "2025-04-01-preview";
const I2I_API_VERSION = "2025-04-01-preview";
const IMAGE_REQUEST_TIMEOUT_MS = 400_000;
const AZURE_PREFIX = "azure/";
const AZURE2_PREFIX = "azure2/";
const AZURE3_PREFIX = "azure3/";

export function isAzureModel(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  const lower = modelId.toLowerCase();
  return (
    lower.startsWith(AZURE_PREFIX) ||
    lower.startsWith(AZURE2_PREFIX) ||
    lower.startsWith(AZURE3_PREFIX)
  );
}

export function stripAzurePrefix(modelId: string): string {
  return modelId.replace(/^(azure|azure2|azure3)\//i, "");
}

function isAzure2Model(modelId: string): boolean {
  return modelId.toLowerCase().startsWith(AZURE2_PREFIX);
}

function isAzure3Model(modelId: string): boolean {
  return modelId.toLowerCase().startsWith(AZURE3_PREFIX);
}

function getAzureConfig(modelId?: string) {
  if (modelId && isAzure3Model(modelId)) {
    // azure3 是 services.ai.azure.com 资源,endpoint 与 azure/azure2 不同;
    // 缺 AZURE3_BASE_URL 不能 fallback 到 DEFAULT_BASE_URL(会打到错的资源),留空让调用方报错
    return {
      apiKey: process.env.AZURE3_API_KEY,
      baseUrl: (process.env.AZURE3_BASE_URL || "").replace(/\/+$/, ""),
    };
  }
  if (modelId && isAzure2Model(modelId)) {
    // 同理,azure2 endpoint 与 azure/ 不同,缺配置留空报错
    return {
      apiKey: process.env.AZURE2_API_KEY,
      baseUrl: (process.env.AZURE2_BASE_URL || "").replace(/\/+$/, ""),
    };
  }
  return {
    apiKey: process.env.AZURE_API_KEY,
    baseUrl: (process.env.AZURE_OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

type AzureImageInput = {
  prompt: string;
  model: string;
  size?: string;
  n?: number;
  quality?: "auto" | "low" | "high";
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

const AZURE_GPT_IMAGE2_SIZES = new Set(["1024x1024", "1024x1792", "1792x1024"]);

function normalizeAzureSize(size: string | undefined): string {
  const s = (size || "").trim().toLowerCase().replace(/\*/g, "x");
  if (AZURE_GPT_IMAGE2_SIZES.has(s)) return s;
  const m = s.match(/^(\d+)x(\d+)$/);
  if (m) {
    const w = parseInt(m[1], 10),
      h = parseInt(m[2], 10);
    if (w > h * 1.3) return "1792x1024";
    if (h > w * 1.3) return "1024x1792";
    return "1024x1024";
  }
  return "1024x1024";
}

function normalizeAzureQuality(q: string | undefined): "low" | "medium" | "high" {
  if (q === "high") return "high";
  if (q === "low") return "low";
  return "medium";
}

export async function callAzureImage(input: AzureImageInput): Promise<AzureImageResult> {
  const { apiKey, baseUrl } = getAzureConfig(input.model);
  const deployment = stripAzurePrefix(input.model) || "gpt-image-2";
  const hasRefs = !!input.referenceImages?.length;
  // azure3 与 azure/azure2 一致,走 deployment 路径(/openai/deployments/{dep}/images/...?api-version=)。
  // services.ai.azure.com 虽也支持 /openai/v1/... 新路径,但只有 deployment 路径的调用进 Portal
  // 「Azure OpenAI Requests」指标——对方按该指标对账,v1 路径计量归属另一维度,对方查不到会误以为没调用。
  const apiVersion = hasRefs ? I2I_API_VERSION : T2I_API_VERSION;
  const path = hasRefs
    ? `/openai/deployments/${deployment}/images/edits`
    : `/openai/deployments/${deployment}/images/generations`;
  const url = `${baseUrl}${path}?api-version=${apiVersion}`;
  const size = normalizeAzureSize(input.size);
  const quality = normalizeAzureQuality(input.quality);
  const t0 = Date.now();
  const requestId = `azr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const endpoint: "generations" | "edits" = hasRefs ? "edits" : "generations";
  const baseMeta = { requestId, deployment, endpoint, apiVersion };
  console.log(
    `[azure→] rid=${requestId} deployment=${deployment} endpoint=${endpoint} apiVersion=${apiVersion} refs=${input.referenceImages?.length ?? 0} size=${size} quality=${quality}`,
  );

  if (!apiKey) {
    console.warn(`[azure×] rid=${requestId} deployment=${deployment} missing AZURE_API_KEY`);
    return {
      url: "",
      urls: [],
      error: "AZURE_API_KEY not configured",
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
  try {
    let requestInit: RequestInit;
    if (hasRefs) {
      const form = new FormData();
      form.append("prompt", input.prompt);
      form.append("n", String(input.n ?? 1));
      form.append("size", size);
      form.append("quality", quality);
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
        headers: { "api-key": apiKey },
        body: form,
        signal: controller.signal,
      };
    } else {
      const body: Record<string, unknown> = {
        prompt: input.prompt,
        n: input.n ?? 1,
        size,
        quality,
      };
      requestInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      };
    }

    let res: Response | null = null;
    let lastText = "";
    let retries = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
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

    const rawText = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(rawText);
    } catch {}

    const items: Array<{ url?: string; b64_json?: string }> =
      (Array.isArray(json?.data) && json.data) || [];
    const urls = items
      .map((d) => {
        if (d.url) return d.url;
        if (d.b64_json) return `data:image/png;base64,${d.b64_json}`;
        return "";
      })
      .filter(Boolean);

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
      `[azure×] rid=${requestId} deployment=${deployment} network dur=${dur}ms err=${e instanceof Error ? e.message : "fetch failed"}`,
    );
    return {
      url: "",
      urls: [],
      error: `[azure ${deployment}] network: ${e instanceof Error ? e.message : "fetch failed"} (rid=${requestId})`,
      model: deployment,
      meta: { ...baseMeta, durationMs: dur, status: 0, retries: 0 },
    };
  }
}

// ---------- ServerFn 入口 ----------
const AzureImageFnInput = z.object({
  prompt: z.string().min(1).max(8000),
  model: z.string().min(1).max(200),
  size: z.string().max(50).optional(),
  n: z.number().int().min(1).max(4).optional(),
  quality: z.enum(["auto", "low", "high"]).optional(),
  referenceImages: z.array(z.string().url()).max(16).optional(),
});

export const generateAzureImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => AzureImageFnInput.parse(d))
  .handler(async ({ data }) => {
    return callAzureImage(data);
  });
