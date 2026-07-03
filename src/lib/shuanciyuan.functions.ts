// ====================================================================
//  数安词源 AI Gateway —— OpenAI 兼容 (token.ds.cyberpeace.cn)
//
//  Base URL: http://token.ds.cyberpeace.cn
//  Auth:     Authorization: Bearer ${SHUANCIYUAN_API_KEY}
//
//  本模块负责数安词源的 OpenAI 兼容接口:
//    - 图像: gpt-image-2 (T2I / I2I)
//    - 视频: doubao-seedance-* (路由在 videoGenerate.functions.ts)
//
//  UI 选项约定:所有走数安词源的模型 id 都加 `shuci/` 前缀。
// ====================================================================

import "./loadEnv";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DEFAULT_BASE_URL = "http://token.ds.cyberpeace.cn";
const IMAGE_REQUEST_TIMEOUT_MS = 400_000;
const SHUCI_PREFIX = "shuci/";

export function isShuanciyuanModel(modelId: string | null | undefined): boolean {
  return !!modelId && modelId.toLowerCase().startsWith(SHUCI_PREFIX);
}

export function stripShuanciyuanPrefix(modelId: string): string {
  return modelId.replace(/^shuci\//i, "");
}

function getShuanciyuanConfig() {
  return {
    apiKey: process.env.SHUANCIYUAN_API_KEY,
    baseUrl: (process.env.SHUANCIYUAN_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

type ShuanciyuanImageInput = {
  prompt: string;
  model: string;
  size?: string;
  n?: number;
  quality?: "auto" | "low" | "high";
  referenceImages?: string[];
};

type ShuanciyuanImageResult = {
  url: string;
  urls: string[];
  error: string | null;
  model: string;
};

const GPT_IMAGE2_SIZES = new Set(["1024x1024", "1024x1792", "1792x1024"]);

function normalizeShuanciyuanSize(size: string | undefined, model: string): string {
  const s = (size || "").trim().toLowerCase().replace(/\*/g, "x");
  if (/^gpt-image-2$/i.test(model)) {
    if (GPT_IMAGE2_SIZES.has(s)) return s;
    const m = s.match(/^(\d+)x(\d+)$/);
    if (m) {
      const w = parseInt(m[1], 10), h = parseInt(m[2], 10);
      if (w > h * 1.3) return "1792x1024";
      if (h > w * 1.3) return "1024x1792";
      return "1024x1024";
    }
    return "1024x1024";
  }
  return s || "1024x1024";
}

export async function callShuanciyuanImage(
  input: ShuanciyuanImageInput,
): Promise<ShuanciyuanImageResult> {
  const { apiKey, baseUrl } = getShuanciyuanConfig();
  const model = stripShuanciyuanPrefix(input.model);
  const hasRefs = !!input.referenceImages?.length;
  const endpoint = hasRefs ? "/v1/images/edits" : "/v1/images/generations";
  const size = normalizeShuanciyuanSize(input.size, model);
  const t0 = Date.now();
  console.log(
    `[shuci→] model=${model} endpoint=${endpoint} refs=${input.referenceImages?.length ?? 0} size=${size}`,
  );

  if (!apiKey) {
    console.warn(`[shuci×] model=${model} missing SHUANCIYUAN_API_KEY`);
    return { url: "", urls: [], error: "SHUANCIYUAN_API_KEY not configured", model };
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
        const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
        form.append("image[]", blob, `ref_${i}.${ext}`);
      }
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
      };
      if (!/^gpt-image/i.test(model)) {
        body.response_format = "url";
      }
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
      console.warn(`[shuci⟳] model=${model} status=${res.status} retry in 1.5s`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    clearTimeout(timeout);

    if (!res || !res.ok) {
      const status = res?.status ?? 0;
      console.warn(
        `[shuci×] model=${model} status=${status} dur=${Date.now() - t0}ms body=${lastText.slice(0, 200)}`,
      );
      return {
        url: "", urls: [],
        error: `[shuci ${model}] ${status}: ${lastText.slice(0, 300)}`,
        model,
      };
    }

    const rawText = await res.text();
    let json: any = {};
    try { json = JSON.parse(rawText); } catch {}

    const items: Array<{ url?: string; b64_json?: string; image_url?: string; b64?: string }> =
      (Array.isArray(json?.data) && json.data) ||
      (Array.isArray(json?.data?.data) && json.data.data) ||
      (Array.isArray(json?.images) && json.images) ||
      (Array.isArray(json?.result?.data) && json.result.data) ||
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
        `[shuci×] model=${model} empty-data dur=${Date.now() - t0}ms err=${json?.error?.message ?? ""} raw=${rawText.slice(0, 400)}`,
      );
      return {
        url: "", urls: [],
        error: `[shuci ${model}] no image returned: ${json?.error?.message || rawText.slice(0, 200) || "empty data"}`,
        model,
      };
    }
    console.log(`[shuci✓] model=${model} images=${urls.length} dur=${Date.now() - t0}ms`);
    return { url: urls[0], urls, error: null, model };
  } catch (e) {
    clearTimeout(timeout);
    console.warn(
      `[shuci×] model=${model} network dur=${Date.now() - t0}ms err=${e instanceof Error ? e.message : "fetch failed"}`,
    );
    return {
      url: "", urls: [],
      error: `[shuci ${model}] network: ${e instanceof Error ? e.message : "fetch failed"}`,
      model,
    };
  }
}

// ---------- ServerFn ----------

const ShuanciyuanImageFnInput = z.object({
  prompt: z.string().min(1).max(8000),
  model: z.string().min(1).max(200),
  size: z.string().max(50).optional(),
  n: z.number().int().min(1).max(4).optional(),
  quality: z.enum(["auto", "low", "high"]).optional(),
  referenceImages: z.array(z.string().url()).max(16).optional(),
});

export const generateShuanciyuanImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ShuanciyuanImageFnInput.parse(d))
  .handler(async ({ data }) => {
    return callShuanciyuanImage(data);
  });
