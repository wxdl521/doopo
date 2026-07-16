// ====================================================================
//  灵梦 Lingmeng —— gpt-image-2 图像生成
//
//  Base URL: https://1189.xin (env: LINGMENG_BASE_URL 可覆盖)
//  Auth:     Authorization: Bearer ${LINGMENG_API_KEY}
//  Endpoints:
//    - POST /v1/images/generations  文生图(JSON)
//    - POST /v1/images/edits        图生图(multipart/form-data)
//
//  参考图使用 multipart 的重复 `image` 字段上传，和灵梦文档中的
//  image 数组参数对应；绝不在有参考图时退化为文生图。
// ====================================================================

import "./loadEnv";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DEFAULT_BASE_URL = "https://1189.xin";
const IMAGE_REQUEST_TIMEOUT_MS = 600_000;
const LINGMENG_PREFIX = "lingmeng/";
const GPT_IMAGE2_SIZES = new Set(["1024x1024", "1024x1536", "1536x1024"]);

export function isLingmengModel(modelId: string | null | undefined): boolean {
  return !!modelId && modelId.toLowerCase().startsWith(LINGMENG_PREFIX);
}

export function stripLingmengPrefix(modelId: string): string {
  return modelId.replace(/^lingmeng\//i, "");
}

function getLingmengConfig() {
  return {
    apiKey: process.env.LINGMENG_API_KEY,
    baseUrl: (process.env.LINGMENG_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

type LingmengImageInput = {
  prompt: string;
  model: string;
  size?: string;
  n?: number;
  quality?: "auto" | "low" | "medium" | "high";
  referenceImages?: string[];
};

type LingmengImageResult = {
  url: string;
  urls: string[];
  error: string | null;
  model: string;
};

function normalizeLingmengSize(size: string | undefined): string {
  const normalized = (size || "").trim().toLowerCase().replace(/\*/g, "x");
  if (GPT_IMAGE2_SIZES.has(normalized)) return normalized;

  const match = normalized.match(/^(\d+)x(\d+)$/);
  if (match) {
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width > height * 1.3) return "1536x1024";
    if (height > width * 1.3) return "1024x1536";
  }
  return "1024x1024";
}

/** 灵梦 gpt-image-2 文生图/图生图。 */
export async function callLingmengImage(input: LingmengImageInput): Promise<LingmengImageResult> {
  const { apiKey, baseUrl } = getLingmengConfig();
  const model = stripLingmengPrefix(input.model);
  const size = normalizeLingmengSize(input.size);
  const t0 = Date.now();

  if (!apiKey) {
    console.warn(`[lingmeng×] model=${model} missing LINGMENG_API_KEY`);
    return { url: "", urls: [], error: "LINGMENG_API_KEY not configured", model };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS);
  try {
    const hasRefs = !!input.referenceImages?.length;
    const endpoint = hasRefs ? "/v1/images/edits" : "/v1/images/generations";
    const quality = input.quality ?? "auto";
    let requestInit: RequestInit;

    if (hasRefs) {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", input.prompt);
      form.append("n", String(input.n ?? 1));
      form.append("size", size);
      form.append("quality", quality);

      for (let index = 0; index < input.referenceImages!.length; index++) {
        const referenceImage = input.referenceImages![index];
        let blob: Blob;
        let mime = "image/png";
        if (referenceImage.startsWith("data:")) {
          const match = referenceImage.match(/^data:([^;]+);base64,(.+)$/);
          if (!match) throw new Error(`invalid data URL for reference image ${index + 1}`);
          mime = match[1] || mime;
          blob = new Blob([Buffer.from(match[2], "base64")], { type: mime });
        } else {
          const response = await fetch(referenceImage);
          if (!response.ok) throw new Error(`fetch reference image ${index + 1} failed: ${response.status}`);
          mime = response.headers.get("content-type")?.split(";")[0] || mime;
          blob = await response.blob();
        }
        const extension = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
        form.append("image", blob, `reference_${index + 1}.${extension}`);
      }
      requestInit = {
        method: "POST",
        headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      };
    } else {
      requestInit = {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, prompt: input.prompt, n: input.n ?? 1, size, quality }),
        signal: controller.signal,
      };
    }

    console.log(
      `[lingmeng→] model=${model} endpoint=${endpoint} refs=${input.referenceImages?.length ?? 0} size=${size} quality=${quality}`,
    );
    const res = await fetch(`${baseUrl}${endpoint}`, requestInit);
    clearTimeout(timeout);

    const rawText = await res.text().catch(() => "");
    if (!res.ok) {
      console.warn(`[lingmeng×] model=${model} status=${res.status} body=${rawText.slice(0, 300)}`);
      return {
        url: "",
        urls: [],
        error: `[灵梦 ${model}] ${res.status}: ${rawText.slice(0, 300)}`,
        model,
      };
    }

    let json: any = {};
    try {
      json = JSON.parse(rawText);
    } catch {}
    const items: Array<{ url?: string; b64_json?: string; image_url?: string; b64?: string }> =
      (Array.isArray(json?.data) && json.data) ||
      (Array.isArray(json?.data?.data) && json.data.data) ||
      (Array.isArray(json?.images) && json.images) ||
      (Array.isArray(json?.result?.data) && json.result.data) ||
      (json?.url || json?.image_url || json?.b64_json
        ? [{ url: json.url, image_url: json.image_url, b64_json: json.b64_json }]
        : []);
    const urls = items
      .map((item) => {
        if (item.url) return item.url;
        if (item.image_url) return item.image_url;
        const b64 = item.b64_json || item.b64;
        return b64 ? `data:image/png;base64,${b64}` : "";
      })
      .filter(Boolean);

    if (!urls.length) {
      return {
        url: "",
        urls: [],
        error: `[灵梦 ${model}] no image returned: ${json?.error?.message || json?.message || rawText.slice(0, 200) || "empty data"}`,
        model,
      };
    }
    console.log(`[lingmeng✓] model=${model} images=${urls.length} dur=${Date.now() - t0}ms`);
    return { url: urls[0], urls, error: null, model };
  } catch (error) {
    clearTimeout(timeout);
    const message =
      error instanceof Error
        ? error.name === "AbortError"
          ? "timed out"
          : error.message
        : String(error || "fetch failed");
    return { url: "", urls: [], error: `[灵梦 ${model}] network: ${message}`, model };
  }
}

const LingmengImageFnInput = z.object({
  prompt: z.string().min(1),
  model: z.string().min(1).max(200),
  size: z.string().max(50).optional(),
  n: z.number().int().min(1).max(10).optional(),
  quality: z.enum(["auto", "low", "medium", "high"]).optional(),
  referenceImages: z.array(z.string().url()).max(16).optional(),
});

export const generateLingmengImage = createServerFn({ method: "POST" })
  .validator((data: unknown) => LingmengImageFnInput.parse(data))
  .handler(async ({ data }) => callLingmengImage(data));
