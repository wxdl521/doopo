// ====================================================================
//  nagora.ai Gateway —— OpenAI 兼容图像接口(Azure 渠道 OpenAI 官方)
//
//  Base URL: https://api.nagora.ai (env: NAGORA_BASE_URL 可覆盖)
//  Auth:     Authorization: Bearer ${NAGORA_API_KEY}
//  Endpoint: POST /v1/images/generations
//
//  当前已验证可用模型:
//    - gpt-image-2
//
//  说明:背后是 Azure 渠道的 OpenAI 官方接口,价格相比官方便宜 61.7%,
//  对接方式按 OpenAI 官方 API 文档,只需替换 base url 和 key。
//
//  UI 选项约定:所有走 nagora 的模型 id 都加 `nagora/` 前缀,
//  与 pixflow/ / tokenflash/ / thhtcloud/ 等命名空间互不冲突;
//  在调用时本模块会自动剥离前缀再发给上游。
// ====================================================================

import "./loadEnv";
import { isValidHighResImageSize } from "./imageSize";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DEFAULT_BASE_URL = "https://api.nagora.ai";
const IMAGE_REQUEST_TIMEOUT_MS = 600_000;
const NAGORA_PREFIX = "nagora/";

export function isNagoraModel(modelId: string | null | undefined): boolean {
  return !!modelId && modelId.toLowerCase().startsWith(NAGORA_PREFIX);
}

/** 剥离 `nagora/` 前缀,得到真正的 upstream model id */
export function stripNagoraPrefix(modelId: string): string {
  return modelId.replace(/^nagora\//i, "");
}

function getNagoraConfig() {
  return {
    apiKey: process.env.NAGORA_API_KEY,
    baseUrl: (process.env.NAGORA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

type NagoraImageInput = {
  prompt: string;
  model: string;
  size?: string;
  n?: number;
  quality?: "auto" | "low" | "high";
  /** I2I 参考图 URL 列表 */
  referenceImages?: string[];
};

type NagoraImageResult = {
  url: string;
  urls: string[];
  error: string | null;
  model: string;
};

/** gpt-image-2 支持的尺寸白名单 */
const NAGORA_GPT_IMAGE2_SIZES = new Set(["1024x1024", "1024x1792", "1792x1024"]);

/** 把任意 size 字符串折算成上游接受的尺寸 */
function normalizeNagoraSize(size: string | undefined, model: string): string {
  const s = (size || "").trim().toLowerCase().replace(/\*/g, "x");
  if (/^gpt-image-2$/i.test(model)) {
    if (isValidHighResImageSize(s)) return s;
    if (NAGORA_GPT_IMAGE2_SIZES.has(s)) return s;
    const m = s.match(/^(\d+)x(\d+)$/);
    if (m) {
      const w = parseInt(m[1], 10);
      const h = parseInt(m[2], 10);
      if (w > h * 1.3) return "1792x1024";
      if (h > w * 1.3) return "1024x1792";
      return "1024x1024";
    }
    return "1024x1024";
  }
  return s || "1024x1024";
}

/**
 * nagora.ai 图像生成 —— OpenAI 兼容路由(Azure 渠道)。
 * 返回与 Pixflow / Tokenflash / Seedream 一致的 { url, urls, error, model }。
 */
export async function callNagoraImage(input: NagoraImageInput): Promise<NagoraImageResult> {
  const { apiKey, baseUrl } = getNagoraConfig();
  const model = stripNagoraPrefix(input.model);
  const size = normalizeNagoraSize(input.size, model);
  const t0 = Date.now();
  console.log(`[nagora→] model=${model} size=${size} refs=${input.referenceImages?.length ?? 0}`);

  if (!apiKey) {
    console.warn(`[nagora×] model=${model} missing NAGORA_API_KEY`);
    return { url: "", urls: [], error: "NAGORA_API_KEY not configured", model };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS);
  try {
    const body: Record<string, unknown> = {
      model,
      prompt: input.prompt,
      n: input.n ?? 1,
      size,
      quality: input.quality ?? "auto",
    };

    // I2I: 有参考图时传入 image 字段(OpenAI 兼容格式)
    if (input.referenceImages && input.referenceImages.length > 0) {
      body.image =
        input.referenceImages.length === 1 ? input.referenceImages[0] : input.referenceImages;
    }

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
      console.warn(`[nagora⟳] model=${model} status=${res.status} retry in 1.5s`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    clearTimeout(timeout);

    if (!res || !res.ok) {
      const status = res?.status ?? 0;
      console.warn(
        `[nagora×] model=${model} status=${status} dur=${Date.now() - t0}ms body=${lastText.slice(0, 200)}`,
      );
      return {
        url: "",
        urls: [],
        error: `[nagora ${model}] ${status}: ${lastText.slice(0, 300)}`,
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
      (json?.url || json?.image_url || json?.b64_json
        ? [{ url: json.url, image_url: json.image_url, b64_json: json.b64_json }]
        : []);
    const urls = items
      .map((d) => {
        if (d.url) return d.url;
        if (d.image_url) return d.image_url;
        const b64 = d.b64_json || d.b64;
        if (b64) return `data:image/png;base64,${b64}`;
        return "";
      })
      .filter(Boolean);

    if (urls.length === 0) {
      console.warn(
        `[nagora×] model=${model} empty-data dur=${Date.now() - t0}ms raw=${rawText.slice(0, 400)}`,
      );
      return {
        url: "",
        urls: [],
        error: `[nagora ${model}] no image returned: ${rawText.slice(0, 200) || "empty data"}`,
        model,
      };
    }
    console.log(`[nagora✓] model=${model} images=${urls.length} dur=${Date.now() - t0}ms`);
    return { url: urls[0], urls, error: null, model };
  } catch (e) {
    clearTimeout(timeout);
    console.warn(
      `[nagora×] model=${model} network dur=${Date.now() - t0}ms err=${e instanceof Error ? e.message : "fetch failed"}`,
    );
    return {
      url: "",
      urls: [],
      error: `[nagora ${model}] network: ${e instanceof Error ? e.message : "fetch failed"}`,
      model,
    };
  }
}

// ---------- ServerFn 入口(供前端通过 useServerFn 调用)----------

const NagoraImageFnInput = z.object({
  prompt: z.string().min(1),
  model: z.string().min(1).max(200),
  size: z.string().max(50).optional(),
  n: z.number().int().min(1).max(4).optional(),
  referenceImages: z.array(z.string()).max(16).optional(),
});

export const generateNagoraImage = createServerFn({ method: "POST" })
  .validator((d: unknown) => NagoraImageFnInput.parse(d))
  .handler(async ({ data }) => {
    return callNagoraImage(data);
  });
