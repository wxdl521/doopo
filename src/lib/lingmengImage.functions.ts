// ====================================================================
//  灵梦 Lingmeng —— gpt-image-2 文生图
//
//  Base URL: https://1189.xin (env: LINGMENG_BASE_URL 可覆盖)
//  Auth:     Authorization: Bearer ${LINGMENG_API_KEY}
//  Endpoint: POST /v1/images/generations
//
//  灵梦当前提供的文档只覆盖 images/generations；没有接入 edits，
//  因此传入参考图时必须明确失败，不能忽略参考图后改成文生图。
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

/** 灵梦 gpt-image-2 文生图。 */
export async function callLingmengImage(input: LingmengImageInput): Promise<LingmengImageResult> {
  const { apiKey, baseUrl } = getLingmengConfig();
  const model = stripLingmengPrefix(input.model);
  const size = normalizeLingmengSize(input.size);
  const t0 = Date.now();

  if (input.referenceImages?.length) {
    return {
      url: "",
      urls: [],
      error: "灵梦当前只接入文生图 /v1/images/generations，不支持参考图编辑",
      model,
    };
  }
  if (!apiKey) {
    console.warn(`[lingmeng×] model=${model} missing LINGMENG_API_KEY`);
    return { url: "", urls: [], error: "LINGMENG_API_KEY not configured", model };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS);
  try {
    const body = {
      model,
      prompt: input.prompt,
      n: input.n ?? 1,
      size,
      quality: input.quality ?? "auto",
    };
    console.log(`[lingmeng→] model=${model} size=${size} quality=${body.quality}`);
    const res = await fetch(`${baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
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
        : "fetch failed";
    return { url: "", urls: [], error: `[灵梦 ${model}] network: ${message}`, model };
  }
}

const LingmengImageFnInput = z.object({
  prompt: z.string().min(1).max(64_000),
  model: z.string().min(1).max(200),
  size: z.string().max(50).optional(),
  n: z.number().int().min(1).max(10).optional(),
  quality: z.enum(["auto", "low", "medium", "high"]).optional(),
  referenceImages: z.array(z.string().url()).max(16).optional(),
});

export const generateLingmengImage = createServerFn({ method: "POST" })
  .validator((data: unknown) => LingmengImageFnInput.parse(data))
  .handler(async ({ data }) => callLingmengImage(data));
