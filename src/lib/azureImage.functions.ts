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
// ====================================================================

import "./loadEnv";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DEFAULT_BASE_URL = "https://ywkjpolandcentral.cognitiveservices.azure.com";
const T2I_API_VERSION = "2025-04-01-preview";
const I2I_API_VERSION = "2025-04-01-preview";
const IMAGE_REQUEST_TIMEOUT_MS = 400_000;
const AZURE_PREFIX = "azure/";

export function isAzureModel(modelId: string | null | undefined): boolean {
  return !!modelId && modelId.toLowerCase().startsWith(AZURE_PREFIX);
}

export function stripAzurePrefix(modelId: string): string {
  return modelId.replace(/^azure\//i, "");
}

function getAzureConfig() {
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
  const { apiKey, baseUrl } = getAzureConfig();
  const deployment = stripAzurePrefix(input.model) || "gpt-image-2";
  const hasRefs = !!input.referenceImages?.length;
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

    const azureRequestId =
      res?.headers.get("apim-request-id") || res?.headers.get("x-request-id") || undefined;
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
          region,
          processingMs,
        },
      };
    }
    const dur = Date.now() - t0;
    console.log(
      `[azure✓] rid=${requestId} azureRid=${azureRequestId ?? "-"} region=${region ?? "-"} deployment=${deployment} images=${urls.length} dur=${dur}ms procMs=${processingMs ?? "-"} retries=${retries}`,
    );
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
