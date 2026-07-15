// ====================================================================
//  AIGCFamily AI Gateway —— OpenAI 兼容 (api1.aigcfamily.top)
//
//  Base URL: https://api1.aigcfamily.top (env: AIGCFAMILY_BASE_URL 可覆盖)
//  Auth:     Authorization: Bearer ${AIGCFAMILY_API_KEY}
//
//  ⚠ 仅支持文生图(T2I):POST /v1/images/generations
//     网关不提供 /v1/images/edits,也不接受参考图/image 参数 → 不支持图生图(I2I)。
//     传入参考图时本模块直接返回错误,调用方应改用支持 I2I 的模型
//     (Seedream / tokenflash/gpt-image-2 / pixflow/gpt-image-2 等)。
//
//  文档明确参数:model / prompt / size(默认 1024x1024) / n
//  已接入模型:
//    - gpt-image-2                 (走 AIGCFAMILY_API_KEY)
//    - imagen-3.0-generate-001     (走 AIGCFAMILY_IMAGEN3_API_KEY,Vertex AI 后端)
//
//  UI 选项约定:所有走 AIGCFamily 的模型 id 都加 `aigcfamily/` 前缀,
//  调用时本模块会自动剥离前缀再发给上游。
// ====================================================================

import "./loadEnv";
import { isValidHighResImageSize } from "./imageSize";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DEFAULT_BASE_URL = "https://api1.aigcfamily.top";
const IMAGE_REQUEST_TIMEOUT_MS = 600_000;
const AIGCFAMILY_PREFIX = "aigcfamily/";

export function isAigcfamilyModel(modelId: string | null | undefined): boolean {
  return !!modelId && modelId.toLowerCase().startsWith(AIGCFAMILY_PREFIX);
}

/** 剥离 `aigcfamily/` 前缀,得到真正的 upstream model id */
export function stripAigcfamilyPrefix(modelId: string): string {
  return modelId.replace(/^aigcfamily\//i, "");
}

function getAigcfamilyConfig(model: string) {
  const isImagen3 = /imagen-?3/i.test(model);
  return {
    apiKey: isImagen3
      ? process.env.AIGCFAMILY_IMAGEN3_API_KEY || process.env.AIGCFAMILY_API_KEY
      : process.env.AIGCFAMILY_API_KEY,
    baseUrl: (process.env.AIGCFAMILY_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

type AigcfamilyImageInput = {
  prompt: string;
  model: string;
  size?: string;
  n?: number;
  quality?: "auto" | "low" | "high";
  referenceImages?: string[];
};

type AigcfamilyImageResult = {
  url: string;
  urls: string[];
  error: string | null;
  model: string;
};

/** AIGCFamily gpt-image-2 实测可用尺寸 */
const AIGCFAMILY_GPT_IMAGE2_SIZES = new Set(["1024x1024", "1024x1792", "1792x1024"]);

/**
 * 尺寸归一化。
 * - gpt-image-2:仅 1024x1024 / 1024x1792 / 1792x1024(OpenAI Images 协议固定档位)
 * - imagen-3.0-generate-001:网关文档仅明确 1024x1024,统一收敛到该尺寸,
 *   其他档位待上游确认后再放开(避免 3840x2160 等 4K 尺寸被拒)。
 */
function normalizeAigcfamilySize(size: string | undefined, model: string): string {
  const s = (size || "").trim().toLowerCase().replace(/\*/g, "x");
  if (/^gpt-image-2$/i.test(model)) {
    if (isValidHighResImageSize(s)) return s;
    if (AIGCFAMILY_GPT_IMAGE2_SIZES.has(s)) return s;
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
  if (/imagen-?3/i.test(model)) {
    return "1024x1024";
  }
  return s || "1024x1024";
}

/**
 * AIGCFamily 图像生成 —— 仅文生图(T2I)。
 * 网关不提供 /v1/images/edits,传入参考图将直接返回错误。
 * 返回与 Tokenflash / Pixflow / Seedream 一致的 { url, urls, error, model }。
 */
export async function callAigcfamilyImage(
  input: AigcfamilyImageInput,
): Promise<AigcfamilyImageResult> {
  const model = stripAigcfamilyPrefix(input.model);
  const { apiKey, baseUrl } = getAigcfamilyConfig(model);
  const size = normalizeAigcfamilySize(input.size, model);
  const t0 = Date.now();

  // 网关不支持图生图:有参考图直接拒绝,避免无意义的 404 / 空请求
  if (input.referenceImages && input.referenceImages.length > 0) {
    console.warn(
      `[aigcfamily×] model=${model} I2I not supported (refs=${input.referenceImages.length})`,
    );
    return {
      url: "",
      urls: [],
      error: "AIGC Family 暂不支持参考图",
      model,
    };
  }

  console.log(
    `[aigcfamily→] model=${model} endpoint=/v1/images/generations size=${size} n=${input.n ?? 1}`,
  );

  if (!apiKey) {
    console.warn(`[aigcfamily×] model=${model} missing AIGCFAMILY_API_KEY`);
    return { url: "", urls: [], error: "AIGCFAMILY_API_KEY not configured", model };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS);
  try {
    // 严格按网关文档:model / prompt / size / n
    const body: Record<string, unknown> = {
      model,
      prompt: input.prompt,
      n: input.n ?? 1,
      size,
    };
    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    };

    let res: Response | null = null;
    let lastText = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(`${baseUrl}/v1/images/generations`, requestInit);
      if (res.ok) break;
      lastText = await res.text().catch(() => "");
      const transient =
        res.status === 502 || res.status === 503 || res.status === 504 || res.status === 524;
      if (!transient || attempt === 1) break;
      console.warn(`[aigcfamily⟳] model=${model} status=${res.status} retry in 1.5s`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    clearTimeout(timeout);

    if (!res || !res.ok) {
      const status = res?.status ?? 0;
      console.warn(
        `[aigcfamily×] model=${model} status=${status} dur=${Date.now() - t0}ms body=${lastText.slice(0, 200)}`,
      );
      return {
        url: "",
        urls: [],
        error: `[aigcfamily ${model}] ${status}: ${lastText.slice(0, 300)}`,
        model,
      };
    }

    const rawText = await res.text();
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
    const rawUrls = items
      .map((d) => {
        if (d.url) return d.url;
        if (d.image_url) return d.image_url;
        const b64 = d.b64_json || d.b64;
        if (b64) return `data:image/png;base64,${b64}`;
        return "";
      })
      .filter(Boolean);

    if (rawUrls.length === 0) {
      console.warn(
        `[aigcfamily×] model=${model} empty-data dur=${Date.now() - t0}ms err=${json?.error?.message ?? ""} raw=${rawText.slice(0, 400)}`,
      );
      return {
        url: "",
        urls: [],
        error: `[aigcfamily ${model}] no image returned: ${json?.error?.message || rawText.slice(0, 200) || "empty data"}`,
        model,
      };
    }

    console.log(`[aigcfamily✓] model=${model} images=${rawUrls.length} dur=${Date.now() - t0}ms`);
    return { url: rawUrls[0], urls: rawUrls, error: null, model };
  } catch (e) {
    clearTimeout(timeout);
    console.warn(
      `[aigcfamily×] model=${model} network dur=${Date.now() - t0}ms err=${e instanceof Error ? e.message : "fetch failed"}`,
    );
    return {
      url: "",
      urls: [],
      error: `[aigcfamily ${model}] network: ${e instanceof Error ? e.message : "fetch failed"}`,
      model,
    };
  }
}

// ---------- ServerFn 入口(供前端通过 useServerFn 调用)----------

const AigcfamilyImageFnInput = z.object({
  prompt: z.string().min(1).max(8000),
  model: z.string().min(1).max(200),
  size: z.string().max(50).optional(),
  n: z.number().int().min(1).max(4).optional(),
  quality: z.enum(["auto", "low", "high"]).optional(),
  referenceImages: z.array(z.string().url()).max(16).optional(),
});

export const generateAigcfamilyImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => AigcfamilyImageFnInput.parse(d))
  .handler(async ({ data }) => {
    return callAigcfamilyImage(data);
  });
