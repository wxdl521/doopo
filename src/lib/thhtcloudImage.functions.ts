// ====================================================================
//  天鸿智算 (THHT Cloud) Gateway —— OpenAI 兼容图像接口
//
//  Base URL: https://api.thhtcloud.com (env: THHTCLOUD_BASE_URL 可覆盖)
//  Auth:     Authorization: Bearer ${THHTCLOUD_API_KEY}
//  Endpoint: POST /v1/images/generations
//
//  当前已验证可用模型:
//    - gpt-image-2
//
//  UI 选项约定:所有走天鸿智算的模型 id 都加 `thhtcloud/` 前缀,
//  与 pixflow/ / tokenflash/ / aitokenvibe/ 等命名空间互不冲突;
//  在调用时本模块会自动剥离前缀再发给上游。
// ====================================================================

import "./loadEnv";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DEFAULT_BASE_URL = "https://api.thhtcloud.com";
const IMAGE_REQUEST_TIMEOUT_MS = 300_000;
const THHTCLOUD_PREFIX = "thhtcloud/";

export function isThhtcloudModel(modelId: string | null | undefined): boolean {
  return !!modelId && modelId.toLowerCase().startsWith(THHTCLOUD_PREFIX);
}

/** 剥离 `thhtcloud/` 前缀,得到真正的 upstream model id */
export function stripThhtcloudPrefix(modelId: string): string {
  return modelId.replace(/^thhtcloud\//i, "");
}

function getThhtcloudConfig() {
  return {
    apiKey: process.env.THHTCLOUD_API_KEY,
    baseUrl: (process.env.THHTCLOUD_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

type ThhtcloudImageInput = {
  prompt: string;
  model: string;
  size?: string;
  n?: number;
  /** I2I 参考图 URL 列表 */
  referenceImages?: string[];
};

type ThhtcloudImageResult = {
  url: string;
  urls: string[];
  error: string | null;
  model: string;
};

/** gpt-image-2 支持的尺寸白名单 */
const THHTCLOUD_GPT_IMAGE2_SIZES = new Set(["1024x1024", "1024x1792", "1792x1024"]);

/** 把任意 size 字符串折算成上游接受的尺寸 */
function normalizeThhtcloudSize(size: string | undefined, model: string): string {
  const s = (size || "").trim().toLowerCase().replace(/\*/g, "x");
  if (/^gpt-image-2$/i.test(model)) {
    if (THHTCLOUD_GPT_IMAGE2_SIZES.has(s)) return s;
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
 * 天鸿智算图像生成 —— OpenAI 兼容路由。
 * 返回与 Pixflow / Tokenflash / Seedream 一致的 { url, urls, error, model }。
 */
export async function callThhtcloudImage(
  input: ThhtcloudImageInput,
): Promise<ThhtcloudImageResult> {
  const { apiKey, baseUrl } = getThhtcloudConfig();
  const model = stripThhtcloudPrefix(input.model);
  const size = normalizeThhtcloudSize(input.size, model);
  const t0 = Date.now();
  console.log(
    `[thhtcloud→] model=${model} size=${size} refs=${input.referenceImages?.length ?? 0}`,
  );

  if (!apiKey) {
    console.warn(`[thhtcloud×] model=${model} missing THHTCLOUD_API_KEY`);
    return { url: "", urls: [], error: "THHTCLOUD_API_KEY not configured", model };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS);
  try {
    const body: Record<string, unknown> = {
      model,
      prompt: input.prompt,
      n: input.n ?? 1,
      size,
    };

    // 天鸿智算 gpt-image-2 不支持 I2I（无 image 参数），仅 T2I

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
      console.warn(`[thhtcloud⟳] model=${model} status=${res.status} retry in 1.5s`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    clearTimeout(timeout);

    if (!res || !res.ok) {
      const status = res?.status ?? 0;
      console.warn(
        `[thhtcloud×] model=${model} status=${status} dur=${Date.now() - t0}ms body=${lastText.slice(0, 200)}`,
      );
      return {
        url: "",
        urls: [],
        error: `[thhtcloud ${model}] ${status}: ${lastText.slice(0, 300)}`,
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
        `[thhtcloud×] model=${model} empty-data dur=${Date.now() - t0}ms raw=${rawText.slice(0, 400)}`,
      );
      return {
        url: "",
        urls: [],
        error: `[thhtcloud ${model}] no image returned: ${rawText.slice(0, 200) || "empty data"}`,
        model,
      };
    }
    console.log(`[thhtcloud✓] model=${model} images=${urls.length} dur=${Date.now() - t0}ms`);
    return { url: urls[0], urls, error: null, model };
  } catch (e) {
    clearTimeout(timeout);
    console.warn(
      `[thhtcloud×] model=${model} network dur=${Date.now() - t0}ms err=${e instanceof Error ? e.message : "fetch failed"}`,
    );
    return {
      url: "",
      urls: [],
      error: `[thhtcloud ${model}] network: ${e instanceof Error ? e.message : "fetch failed"}`,
      model,
    };
  }
}

// ---------- ServerFn 入口(供前端通过 useServerFn 调用)----------

const ThhtcloudImageFnInput = z.object({
  prompt: z.string().min(1).max(8000),
  model: z.string().min(1).max(200),
  size: z.string().max(50).optional(),
  n: z.number().int().min(1).max(4).optional(),
  referenceImages: z.array(z.string()).max(16).optional(),
});

export const generateThhtcloudImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ThhtcloudImageFnInput.parse(d))
  .handler(async ({ data }) => {
    return callThhtcloudImage(data);
  });
