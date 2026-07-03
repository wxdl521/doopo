// ====================================================================
//  AIGCFamily AI Gateway —— OpenAI 兼容 (api1.aigcfamily.top)
//
//  Base URL: https://api1.aigcfamily.top (env: AIGCFAMILY_BASE_URL 可覆盖)
//  Auth:     Authorization: Bearer ${AIGCFAMILY_API_KEY}
//
//  本模块只负责 AIGCFamily 中转上的 OpenAI 兼容图像接口:
//    - 无参考图 (T2I): POST /v1/images/generations
//    - 有参考图 (I2I): POST /v1/images/edits  (multipart/form-data)
//
//  当前已验证可用模型:
//    - gpt-image-2   (T2I 单次 ≈ 50s,返回 data[0].url)
//
//  UI 选项约定:所有走 AIGCFamily 的模型 id 都加 `aigcfamily/` 前缀,
//  与其它命名空间互不冲突;在调用时本模块会自动剥离前缀再发给上游。
// ====================================================================

import "./loadEnv";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DEFAULT_BASE_URL = "https://api1.aigcfamily.top";
const IMAGE_REQUEST_TIMEOUT_MS = 400_000;
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

function normalizeAigcfamilySize(size: string | undefined, model: string): string {
  const s = (size || "").trim().toLowerCase().replace(/\*/g, "x");
  if (/^gpt-image-2$/i.test(model)) {
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
  return s || "1024x1024";
}

/**
 * AIGCFamily 图像生成 —— OpenAI 兼容路由。
 * 返回与 Tokenflash / Pixflow / Seedream 一致的 { url, urls, error, model }。
 */
export async function callAigcfamilyImage(
  input: AigcfamilyImageInput,
): Promise<AigcfamilyImageResult> {
  const model = stripAigcfamilyPrefix(input.model);
  const { apiKey, baseUrl } = getAigcfamilyConfig(model);
  const hasRefs = !!input.referenceImages?.length;
  const endpoint = hasRefs ? "/v1/images/edits" : "/v1/images/generations";
  const size = normalizeAigcfamilySize(input.size, model);
  const t0 = Date.now();
  console.log(
    `[aigcfamily→] model=${model} endpoint=${endpoint} refs=${input.referenceImages?.length ?? 0} size=${size} quality=${input.quality ?? "auto"}`,
  );

  if (!apiKey) {
    console.warn(`[aigcfamily×] model=${model} missing AIGCFAMILY_API_KEY`);
    return { url: "", urls: [], error: "AIGCFAMILY_API_KEY not configured", model };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS);
  try {
    let requestInit: RequestInit;
    if (hasRefs) {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", input.prompt);
      form.append("n", String(input.n ?? 1));
      form.append("size", size);
      form.append("quality", input.quality ?? "auto");
      form.append("response_format", "url");
      const MAX_REF_BYTES = 800_000; // AiGCfamily nginx 限制约 1MB，留余量
      let totalRefSize = 0;
      let skippedCount = 0;
      for (let i = 0; i < input.referenceImages!.length; i++) {
        const refUrl = input.referenceImages![i];
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
        if (blob.size > MAX_REF_BYTES) {
          console.warn(
            `[aigcfamily] skipping ref ${i}: ${(blob.size / 1e6).toFixed(2)}MB > 0.8MB limit`,
          );
          skippedCount++;
          continue;
        }
        totalRefSize += blob.size;
        const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
        form.append("image[]", blob, `ref_${i}.${ext}`);
      }
      const totalMB = (totalRefSize / 1_000_000).toFixed(2);
      console.log(
        `[aigcfamily] refs=${input.referenceImages!.length - skippedCount}/${input.referenceImages!.length} totalSize=${totalMB}MB`,
      );
      requestInit = {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      };
    } else {
      const body: Record<string, unknown> = {
        model,
        prompt: input.prompt,
        n: input.n ?? 1,
        size,
        quality: input.quality ?? "auto",
        response_format: "url",
      };
      requestInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      };
    }

    let res: Response | null = null;
    let lastText = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(`${baseUrl}${endpoint}`, requestInit);
      if (res.ok) break;
      lastText = await res.text().catch(() => "");
      const transient =
        res.status === 502 || res.status === 503 || res.status === 504 || res.status === 524;
      if (!transient || attempt === 1) break;
      console.warn(
        `[aigcfamily⟳] model=${model} endpoint=${endpoint} status=${res.status} retry in 1.5s`,
      );
      await new Promise((r) => setTimeout(r, 1500));
    }
    clearTimeout(timeout);

    if (!res || !res.ok) {
      const status = res?.status ?? 0;
      console.warn(
        `[aigcfamily×] model=${model} endpoint=${endpoint} status=${status} dur=${Date.now() - t0}ms body=${lastText.slice(0, 200)}`,
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
        `[aigcfamily×] model=${model} endpoint=${endpoint} empty-data dur=${Date.now() - t0}ms err=${json?.error?.message ?? ""} raw=${rawText.slice(0, 400)}`,
      );
      return {
        url: "",
        urls: [],
        error: `[aigcfamily ${model}] no image returned: ${json?.error?.message || rawText.slice(0, 200) || "empty data"}`,
        model,
      };
    }

    console.log(
      `[aigcfamily✓] model=${model} endpoint=${endpoint} images=${rawUrls.length} dur=${Date.now() - t0}ms`,
    );
    return { url: rawUrls[0], urls: rawUrls, error: null, model };
  } catch (e) {
    clearTimeout(timeout);
    console.warn(
      `[aigcfamily×] model=${model} endpoint=${endpoint} network dur=${Date.now() - t0}ms err=${e instanceof Error ? e.message : "fetch failed"}`,
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
