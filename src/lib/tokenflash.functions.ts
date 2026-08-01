// ====================================================================
//  Tokenflash AI Gateway —— 纯 OpenAI 兼容(api: tokenflash.cn)
//
//  Base URL: https://tokenflash.cn (env: TOKENFLASH_BASE_URL 可覆盖)
//  Auth:     Authorization: Bearer ${TOKENFLASH_API_KEY}
//
//  本模块只负责 Tokenflash 中转上的 OpenAI 兼容图像接口:
//    - 无参考图(T2I): POST /v1/images/generations
//    - 有参考图(I2I): POST /v1/images/edits  (JSON, images[].image_url)
//
//  当前已验证可用模型:
//    - gpt-image-2   (T2I 单次 ≈ 45-55s,稳定性显著优于 pixflow)
//
//  UI 选项约定:所有走 Tokenflash 的模型 id 都加 `tokenflash/` 前缀,
//  与 pixflow/ / openai/ / google/ 等命名空间互不冲突;在调用时本模块
//  会自动剥离前缀再发给上游。
// ====================================================================

import "./loadEnv";
import { isValidHighResImageSize } from "./imageSize";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getOptionalAuthCtx } from "./authContext";
import { chargeCredits } from "./userCredits.functions";
import { imageCost } from "./creditsCost";

const DEFAULT_BASE_URL = "https://tokenflash.cn";
const IMAGE_REQUEST_TIMEOUT_MS = 600_000;
const TOKENFLASH_PREFIX = "tokenflash/";

export function isTokenflashModel(modelId: string | null | undefined): boolean {
  return !!modelId && modelId.toLowerCase().startsWith(TOKENFLASH_PREFIX);
}

/** 剥离 `tokenflash/` 前缀,得到真正的 upstream model id */
export function stripTokenflashPrefix(modelId: string): string {
  return modelId.replace(/^tokenflash\//i, "");
}

function getTokenflashConfig() {
  return {
    apiKey: process.env.TOKENFLASH_API_KEY,
    baseUrl: (process.env.TOKENFLASH_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

type TokenflashImageInput = {
  prompt: string;
  model: string;
  size?: string;
  n?: number;
  quality?: "auto" | "low" | "high";
  /** I2I 参考图 URL 列表(走 /v1/images/edits) */
  referenceImages?: string[];
};

type TokenflashImageResult = {
  url: string;
  urls: string[];
  error: string | null;
  model: string;
};

/** Tokenflash 当前 gpt-image-2 支持的尺寸白名单 */
const TOKENFLASH_GPT_IMAGE2_SIZES = new Set(["1024x1024", "1024x1792", "1792x1024"]);

/** 把任意 size 字符串(WxH / 2K / 1328*1328)折算成 Tokenflash 接受的尺寸 */
function normalizeTokenflashSize(size: string | undefined, model: string): string {
  const s = (size || "").trim().toLowerCase().replace(/\*/g, "x");
  if (/^gpt-image-2$/i.test(model)) {
    if (isValidHighResImageSize(s)) return s;
    if (TOKENFLASH_GPT_IMAGE2_SIZES.has(s)) return s;
    // 按宽高比就近 fallback
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
 * Tokenflash 图像生成 —— OpenAI 兼容路由。
 * 返回与 Pixflow / Seedream 一致的 { url, urls, error, model }。
 */
export async function callTokenflashImage(
  input: TokenflashImageInput,
): Promise<TokenflashImageResult> {
  const { apiKey, baseUrl } = getTokenflashConfig();
  const model = stripTokenflashPrefix(input.model);
  const hasRefs = !!input.referenceImages?.length;
  let endpoint = hasRefs ? "/v1/images/edits" : "/v1/images/generations";
  const size = normalizeTokenflashSize(input.size, model);
  const t0 = Date.now();
  console.log(
    `[tokenflash→] model=${model} endpoint=${endpoint} refs=${input.referenceImages?.length ?? 0} size=${size} quality=${input.quality ?? "auto"}`,
  );

  if (!apiKey) {
    console.warn(`[tokenflash×] model=${model} missing TOKENFLASH_API_KEY`);
    return { url: "", urls: [], error: "TOKENFLASH_API_KEY not configured", model };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS);
  try {
    // T2I 用 JSON;I2I 走 OpenAI 标准的 multipart/form-data,必须上传真实图片文件,
    // 不能用 image_url(tokenflash 上游会报 "image_url must point to an image")。
    let requestInit: RequestInit;
    // T2I(JSON /v1/images/generations)请求体构造器。
    // 当中转不支持 /v1/images/edits(405/404/501)时,用它降级重发。
    const buildT2IInit = (prompt: string): RequestInit => {
      const body: Record<string, unknown> = {
        model,
        prompt,
        n: input.n ?? 1,
        size,
        quality: input.quality ?? "auto",
      };
      if (!/^gpt-image/i.test(model)) {
        body.response_format = "url";
      }
      return {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      };
    };
    if (hasRefs) {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", input.prompt);
      form.append("n", String(input.n ?? 1));
      form.append("size", size);
      form.append("quality", input.quality ?? "auto");
      // gpt-image-* 不支持 response_format(T2I 同款守卫,否则 400 unknown_parameter)
      if (!/^gpt-image/i.test(model)) {
        form.append("response_format", "url");
      }
      // 下载每张参考图为 Blob 后以 image[] 文件字段上传
      for (let i = 0; i < input.referenceImages!.length; i++) {
        const refUrl = input.referenceImages![i];
        let blob: Blob;
        let filename = `ref_${i}.png`;
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
          if (!/^image\/(jpeg|png|webp)$/i.test(mime)) {
            mime = "image/png";
            blob = new Blob([await blob.arrayBuffer()], { type: mime });
          }
        }
        const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
        filename = `ref_${i}.${ext}`;
        form.append("image[]", blob, filename);
      }
      requestInit = {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      };
    } else {
      // gpt-image-* 系列只返回 b64_json,不支持 response_format=url(在 buildT2IInit 中已守卫)
      requestInit = buildT2IInit(input.prompt);
    }

    // 对 502/503/504/524 这种上游瞬时错误做一次重试(1.5s 退避)
    let res: Response | null = null;
    let lastText = "";
    let fellBackToT2I = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(`${baseUrl}${endpoint}`, requestInit);
      if (res.ok) break;
      lastText = await res.text().catch(() => "");
      // 中转不支持 edits 端点:降级为 T2I,把参考图语义并进 prompt。
      if (
        hasRefs &&
        !fellBackToT2I &&
        (res.status === 405 || res.status === 404 || res.status === 501)
      ) {
        console.warn(
          `[tokenflash⤵] model=${model} endpoint=${endpoint} status=${res.status} fallback=generations`,
        );
        fellBackToT2I = true;
        endpoint = "/v1/images/generations";
        requestInit = buildT2IInit(
          `${input.prompt}\n\n(参考图无法直接上传,请严格按上述文字描述还原角色/场景/道具的外形、配色与风格一致性。)`,
        );
        attempt = -1; // 降级后重新获得一次完整重试机会
        continue;
      }
      const transient =
        res.status === 502 || res.status === 503 || res.status === 504 || res.status === 524;
      if (!transient || attempt === 1) break;
      console.warn(
        `[tokenflash⟳] model=${model} endpoint=${endpoint} status=${res.status} retry in 1.5s`,
      );
      await new Promise((r) => setTimeout(r, 1500));
    }
    clearTimeout(timeout);

    if (!res || !res.ok) {
      const status = res?.status ?? 0;
      console.warn(
        `[tokenflash×] model=${model} endpoint=${endpoint} status=${status} dur=${Date.now() - t0}ms body=${lastText.slice(0, 200)}`,
      );
      if (hasRefs && (status === 405 || status === 404 || status === 501)) {
        return {
          url: "",
          urls: [],
          error: `[tokenflash ${model}] 该中转当前不支持图生图（/v1/images/edits 返回 ${status}）。请改用 Seedream 或 Azure gpt-image-2 生成带参考图的资产。`,
          model,
        };
      }
      return {
        url: "",
        urls: [],
        error: `[tokenflash ${model}] ${status}: ${lastText.slice(0, 300)}`,
        model,
      };
    }

    const rawText = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(rawText);
    } catch {}

    // 兼容多种返回形状:
    //   1) OpenAI 标准: { data: [{ url | b64_json }] }
    //   2) Tokenflash 包装: { data: { data: [...] } } 或 { result: {...} }
    //   3) 直接 { url } / { image_url } / { images: [...] }
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
        `[tokenflash×] model=${model} endpoint=${endpoint} empty-data dur=${Date.now() - t0}ms err=${json?.error?.message ?? ""} raw=${rawText.slice(0, 400)}`,
      );
      return {
        url: "",
        urls: [],
        error: `[tokenflash ${model}] no image returned: ${json?.error?.message || rawText.slice(0, 200) || "empty data"}`,
        model,
      };
    }
    console.log(
      `[tokenflash✓] model=${model} endpoint=${endpoint} images=${urls.length} dur=${Date.now() - t0}ms`,
    );
    // 成功才扣分(生图积分,按张)。未登录/不在价目表 -> 跳过;扣失败不阻断
    const __ctx = await getOptionalAuthCtx();
    const __cost = imageCost(input.model);
    if (__ctx && __cost != null) {
      await chargeCredits(__ctx.supabase, __ctx.userId, {
        amount: __cost,
        model: input.model,
        description: "生图 · tokenflash",
      });
    }
    return { url: urls[0], urls, error: null, model };
  } catch (e) {
    clearTimeout(timeout);
    console.warn(
      `[tokenflash×] model=${model} endpoint=${endpoint} network dur=${Date.now() - t0}ms err=${e instanceof Error ? e.message : "fetch failed"}`,
    );
    return {
      url: "",
      urls: [],
      error: `[tokenflash ${model}] network: ${e instanceof Error ? e.message : "fetch failed"}`,
      model,
    };
  }
}

// ---------- ServerFn 入口(供前端通过 useServerFn 调用)----------

const TokenflashImageFnInput = z.object({
  prompt: z.string().min(1),
  model: z.string().min(1).max(200),
  size: z.string().max(50).optional(),
  n: z.number().int().min(1).max(4).optional(),
  quality: z.enum(["auto", "low", "high"]).optional(),
  referenceImages: z.array(z.string().url()).max(16).optional(),
});

export const generateTokenflashImage = createServerFn({ method: "POST" })
  .validator((d: unknown) => TokenflashImageFnInput.parse(d))
  .handler(async ({ data }) => {
    return callTokenflashImage(data);
  });
