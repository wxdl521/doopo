// ====================================================================
//  Seedream (Doubao) 图像生成 —— 火山方舟 ARK
//
//  端点:POST {ARK_BASE_URL}/images/generations
//  模型:doubao-seedream-5-0-260128
//  文档:docs/seedream.md
//
//  覆盖 4 种图像生成模式:
//   1) generateImage            —— 文生图(T2I)
//   2) regenerateCharacterLook  —— 单图 I2I(角色重生,3 模式:modify / three-view / multi-asset)
//                                   multi-asset 模式 = Character Reference Sheet
//                                   (3 视图 + 6 细节特写, 3x3 网格)
//   3) generateStoryboardShotImage —— 多图融合 I2I(分镜)
//   4) regenerateStoryboardShot —— 多图融合 I2I(分镜按意见重生,图1 = 当前镜头)
//
//  所有调用走统一 helper `callSeedreamImages`,带 429 指数退避(1s/2s/4s)
//  + 50s AbortController timeout。返回 {url, error, model, size}。
//
//  Seedream 没有独立的 negative_prompt 字段,所以把 negative 当作一段
//  "FORBIDDEN: ..." 块追加到 positive prompt 末尾。
// ====================================================================

import "./loadEnv"; // ← 必须在所有 env 读取之前导入,触发 .env.local 加载
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { buildStyleLock, type VisualStyleSpec } from "./visualStyles";

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_MODEL = "doubao-seedream-5-0-260128";
const RETRY_BACKOFF_MS = [1_000, 2_000, 4_000] as const;
// 2026/06 修复:50_000 经常被 Seedream 5.0 多参考图融合 + 高分辨率 2K
// 出图流程超时报错。先提到 120s,后又因新 multi-asset(3 区域 + 13 子图概念)
// 和 16:9 故事板(6 section, ~3500 字 prompt)单图渲染负担更重,
// **2026/06 二次提到 180s**(3 分钟)给单次重活兜底。
// 极端情况 3+ 分钟的请求仍可能超,但 retry 1s/2s/4s 退避 + 用户体验上更平滑。
const REQUEST_TIMEOUT_MS = 180_000;
const I2I_TIMEOUT_MS = 180_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- 工具函数 ----------

function getArkConfig() {
  return {
    apiKey: process.env.ARK_API_KEY,
    baseUrl: (process.env.ARK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: process.env.ARK_IMAGE_MODEL || DEFAULT_MODEL,
  };
}

/** 是否 Seedream 模型 id */
export function isSeedreamModel(modelId: string | null | undefined): boolean {
  const m = (modelId || "").trim().toLowerCase();
  return m === "" || m.startsWith("doubao-seedream-") || m.startsWith("seedream-");
}

/**
 * 历史项目里可能残留裸 `openai/gpt-image-2`。它不是 ARK/Seedream 模型,
 * 必须归一到 Pixflow 前缀路由,否则会被错误 POST 到 ARK /images/generations 并 404。
 */
export function normalizeImageModelForRouting(modelId: string | null | undefined): string {
  const m = (modelId || "").trim();
  const lower = m.toLowerCase();
  if (lower === "openai/gpt-image-2" || lower === "gpt-image-2") return "pixflow/gpt-image-2";
  return m;
}

/**
 * Seedream 最小像素数限制(实测 2026/06):
 * 任何 size 的 WxH 必须 >= 3,686,400 像素,否则返回
 * `code: InvalidParameter, message: "image size must be at least 3686400 pixels"`。
 * 2K = 2048x2048 = 4,194,304 ✅
 * 2560x1280 = 3,276,800 ❌ (常见误用,3-view 模式之前的硬编码就是它)
 * 1104x1472 = 1,623,888 ❌ (legacy Qwen 尺寸,不该传给 Seedream)
 */
export const SEEDREAM_MIN_PIXELS = 3_686_400;

/**
 * 把 DashScope 风格的 size 规整成 Seedream 可接受的形态。
 * Seedream 接受: '1024x1024'... 一直到 '2K' / '3K' / '4K' 等。
 * 老代码用 '2048*2048' / '1328*1328' / '1104*1472' 这种 '数字*数字' 格式。
 *
 * 关键:如果换算出来的像素数 < SEEDREAM_MIN_PIXELS,自动 fallback 到 '2K'
 * (4,194,304 像素,稳过下限)。这避免了 2026 大量出现
 * "image size must be at least 3686400 pixels" 的硬错误。
 */
export function normalizeSeedreamSize(size: string | undefined): string {
  const fallback = "2K";
  if (!size) return fallback;
  const s = String(size).trim();
  if (!s) return fallback;
  // '2K' / '4K' / '1K' 直接透传(都已满足最小像素)
  if (/^\dK$/i.test(s)) return s.toUpperCase().replace("k", "K");
  // '2048*2048' → '2048x2048'
  const normalized = s.includes("*") ? s.replace(/\*/g, "x") : s;
  // 像素数校验:小尺寸自动升级
  const m = normalized.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (m) {
    const w = parseInt(m[1], 10);
    const h = parseInt(m[2], 10);
    if (w * h < SEEDREAM_MIN_PIXELS) {
      return fallback; // 自动升级到 2K,不让 Seedream 拒
    }
  }
  return normalized;
}

/** 把 negative prompt 拼到 positive 末尾 */
function appendNegative(positive: string, negative: string | undefined): string {
  if (!negative || !negative.trim()) return positive;
  return `${positive}\n\nFORBIDDEN (avoid these): ${negative}`;
}

// ---------- 内部 HTTP helper ----------

type SeedreamImageBody = {
  model: string;
  prompt: string;
  image?: string | string[];
  size?: string;
  sequential_image_generation?: "disabled" | "auto";
  sequential_image_generation_options?: { max_images?: number };
  output_format?: "png" | "jpeg" | "jpg" | "webp";
  watermark?: boolean;
};

type SeedreamImageResult = {
  url: string;
  error: string | null;
  model: string;
  size?: string;
};

/**
 * 统一 Seedream 图像生成调用。带 429 指数退避,网络异常转成 {error}。
 * 不抛异常 —— 调用方拿到的永远是结构化结果。
 */
async function callSeedreamImages(
  body: SeedreamImageBody,
  apiKey: string,
  baseUrl: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<SeedreamImageResult> {
  // 2026 诊断:把 Vite 实际传给 server function 的 env 嵌到所有错误里,
  // 用户在 UI 上能看到 "[seedream] ... env=[apiKey=...UNDEFINED, model=...]"。
  // 这次报 400 "Model not exist" —— 如果 model 字段是 "undefined" 或 "null",
  // 说明 process.env.ARK_IMAGE_MODEL 没被 Vite 加载,代码走了 DEFAULT_MODEL 兜底
  // 但某处被 string() 强制转了 → 这就是真根因。
  const envDebug = `[env: apiKey=${apiKey ? apiKey.slice(0, 12) + "..." : "UNDEFINED"}, baseUrl=${baseUrl}, model=${body.model}]`;

  let lastErr: string | null = null;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          // Seedream 全部必填默认值
          sequential_image_generation: "disabled",
          response_format: "url",
          stream: false,
          watermark: true,
          ...body,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          data?: Array<{ url?: string; size?: string }>;
          error?: { code?: string; message?: string };
          message?: string;
        };
        const first = json.data?.[0];
        const url = first?.url;
        if (!url) {
          return {
            url: "",
            error: `[seedream] ${body.model} 未返回 URL: ${json.error?.message || json.message || "no data"}`,
            model: body.model,
            size: first?.size,
          };
        }
        return { url, error: null, model: body.model, size: first.size };
      }
      const text = await res.text().catch(() => "");
      lastErr = `[seedream] ${body.model} ${res.status}: ${text.slice(0, 300)} ${envDebug}`;
      // 429 / 5xx 才重试,其他(400 鉴权 / 401 / 402 计费)立即返回
      const isRetryable = res.status === 429 || res.status >= 500;
      if (!isRetryable) {
        return { url: "", error: lastErr, model: body.model };
      }
    } catch (e) {
      clearTimeout(timeout);
      const msg =
        e instanceof Error ? (e.name === "AbortError" ? "timed out" : e.message) : "fetch failed";
      lastErr = `[seedream] ${body.model} network: ${msg}`;
    }
    if (attempt < RETRY_BACKOFF_MS.length) {
      await sleep(RETRY_BACKOFF_MS[attempt] ?? 1_000);
    }
  }
  return {
    url: "",
    error: (lastErr || `[seedream] ${body.model} failed after retries`) + " " + envDebug,
    model: body.model,
  };
}

// ====================================================================
// 1) generateImage —— 文生图(T2I)
//
//   委托策略:
//     - 空 model / Seedream model id → 走 Seedream
//     - 其他 model id(qwen-image-*, wan*, google/*, openai/*)→
//       走 openrouterImage.functions.ts:generateImage(legacy 兜底层,用户手动选)
//
//   返回 { url, error, model } —— 与 legacy 完全一致,UI 无需改。
// ====================================================================

const GenerateImageInput = z.object({
  prompt: z.string().min(1).max(8000),
  model: z.string().max(200).optional(),
  size: z.string().max(50).optional(),
  negativePrompt: z.string().max(4000).optional(),
  noFallback: z.boolean().optional(),
  // 2026/06:查看提示词模式
  previewOnly: z.boolean().default(false),
});

export const generateImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => GenerateImageInput.parse(d))
  .handler(async ({ data }) => {
    const requested = normalizeImageModelForRouting(data.model);
    // 委托给 Lovable AI Gateway(openai/gpt-image-*, google/gemini-*-image*)
    {
      const { isLovableGatewayImageModel, callLovableGatewayImage } =
        await import("./lovableImage.functions");
      if (isLovableGatewayImageModel(requested)) {
        const r = await callLovableGatewayImage({
          prompt: appendNegative(data.prompt, data.negativePrompt),
          model: requested,
          size: data.size,
        });
        return { url: r.url, error: r.error, model: r.model };
      }
    }
    // 委托给 Pixflow(OpenAI 兼容的 gpt-image-2 / gemini 系列)
    if (requested.toLowerCase().startsWith("pixflow/")) {
      const { callPixflowImage } = await import("./pixflow.functions");
      const r = await callPixflowImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      });
      return { url: r.url, error: r.error, model: r.model };
    }
    // 委托给 Claude360(OpenAI 兼容,claude360.xyz)
    if (requested.toLowerCase().startsWith("claude360/")) {
      const { callClaude360Image } = await import("./claude360Image.functions");
      const r = await callClaude360Image({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      });
      return { url: r.url, error: r.error, model: r.model };
    }
    // 委托给 Tokenflash(OpenAI 兼容,api.tokenflash.cn)
    if (requested.toLowerCase().startsWith("tokenflash/")) {
      const { callTokenflashImage } = await import("./tokenflash.functions");
      const r = await callTokenflashImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      });
      return { url: r.url, error: r.error, model: r.model };
    }
    // 委托给 Revora(OpenAI 兼容,api.revora.vip)
    if (requested.toLowerCase().startsWith("revora/")) {
      const { callRevoraImage } = await import("./revoraImage.functions");
      const r = await callRevoraImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      });
      return { url: r.url, error: r.error, model: r.model };
    }
    if (requested.toLowerCase().startsWith("aigcfamily/")) {
      const { callAigcfamilyImage } = await import("./aigcfamilyImage.functions");
      const r = await callAigcfamilyImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      });
      return { url: r.url, error: r.error, model: r.model };
    }
    if (requested.toLowerCase().startsWith("shuci/")) {
      const { callShuanciyuanImage } = await import("./shuanciyuan.functions");
      const r = await callShuanciyuanImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      });
      return { url: r.url, error: r.error, model: r.model };
    }
    if (
      requested.toLowerCase().startsWith("azure/") ||
      requested.toLowerCase().startsWith("azure2/")
    ) {
      const { callAzureImage } = await import("./azureImage.functions");
      const r = await callAzureImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      });
      return { url: r.url, error: r.error, model: r.model, meta: r.meta };
    }
    // 委托给 OneToken(OpenAI 兼容,api.onetoken.one)
    if (requested.toLowerCase().startsWith("onetoken/")) {
      const { callOnetokenImage } = await import("./onetokenImage.functions");
      const r = await callOnetokenImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      });
      return { url: r.url, error: r.error, model: r.model };
    }
    // 委托给 OTU(OpenAI 兼容)
    if (requested.toLowerCase().startsWith("otu/")) {
      const { callOtuImage } = await import("./otuImage.functions");
      const r = await callOtuImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      });
      return { url: r.url, error: r.error, model: r.model };
    }
    // 委托给 AI Tokenvibe(OpenAI 兼容)
    if (requested.toLowerCase().startsWith("aitokenvibe/")) {
      const { callAitokenvibeImage } = await import("./aitokenvibeImage.functions");
      const r = await callAitokenvibeImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      });
      return { url: r.url, error: r.error, model: r.model };
    }
    // 委托给天鸿智算(OpenAI 兼容)
    if (requested.toLowerCase().startsWith("thhtcloud/")) {
      const { callThhtcloudImage } = await import("./thhtcloudImage.functions");
      const r = await callThhtcloudImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      });
      return { url: r.url, error: r.error, model: r.model };
    }
    // 委托给 ailinzi(OpenAI 兼容)
    if (requested.toLowerCase().startsWith("ailinzi/")) {
      const { callAilinziImage } = await import("./ailinziImage.functions");
      const r = await callAilinziImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      });
      return { url: r.url, error: r.error, model: r.model };
    }
    // 委托给 vapeur(OpenAI 兼容)
    if (requested.toLowerCase().startsWith("vapeur/")) {
      const { callVapeurImage } = await import("./vapeurImage.functions");
      const r = await callVapeurImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      });
      return { url: r.url, error: r.error, model: r.model };
    }
    // 委托给 TokenHub(OpenAI 兼容,tokenhub.linkstor.com)
    if (requested.toLowerCase().startsWith("tokenhub/")) {
      const { callTokenhubImage } = await import("./tokenhubImage.functions");
      const r = await callTokenhubImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      });
      return { url: r.url, error: r.error, model: r.model };
    }
    // 委托给 nagora.ai(Azure 渠道 OpenAI 官方)
    if (requested.toLowerCase().startsWith("nagora/")) {
      const { callNagoraImage } = await import("./nagoraImage.functions");
      const r = await callNagoraImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      });
      return { url: r.url, error: r.error, model: r.model };
    }
    // 委托给 MeridianAI(OpenAI 兼容,www.meridiangolf.xyz)
    if (requested.toLowerCase().startsWith("meridian/")) {
      const { callMeridianImage } = await import("./meridianImage.functions");
      const r = await callMeridianImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      });
      return { url: r.url, error: r.error, model: r.model };
    }
    // 委托给 legacy(老 Qwen / OpenRouter 路径)
    if (requested && !isSeedreamModel(requested)) {
      // 动态 import 避免循环引用
      const { generateImage: legacy } = await import("./openrouterImage.functions");
      return legacy({
        data: {
          prompt: data.prompt,
          model: data.model,
          size: data.size,
          negativePrompt: data.negativePrompt,
          noFallback: data.noFallback,
        },
      } as any);
    }

    // Seedream 路径
    const { apiKey, baseUrl, model: defaultModel } = getArkConfig();
    if (!apiKey)
      return { url: "", error: "ARK_API_KEY not configured", model: requested || defaultModel };
    const model = requested || defaultModel;
    const size = normalizeSeedreamSize(data.size || "2K");
    const prompt = appendNegative(data.prompt, data.negativePrompt);

    // 2026/06:查看提示词模式
    if (data.previewOnly) {
      return {
        url: "",
        error: null,
        model,
        size,
        previewPrompt: prompt,
        negativePrompt: data.negativePrompt,
        promptSize: size,
        promptExtra: { model, route: "T2I (generateImage)" },
      } as any;
    }

    return callSeedreamImages(
      { model, prompt, size, output_format: "png", watermark: false },
      apiKey,
      baseUrl,
    );
  });

// ====================================================================
// 2) regenerateCharacterLook —— 单图 I2I(角色重生,3 模式)
//
//   三个模式的 prompt builder 从 characterRegen.functions.ts 平移过来。
//   Seedream 的 image 字段接受单个 URL 字符串,刚好对应这里的场景。
// ====================================================================

const RegenerateInput = z.object({
  referenceImageUrl: z.string().url(),
  userInstruction: z.string().min(1).max(2000),
  faceDescription: z.string().max(4000),
  bodyDescription: z.string().max(4000),
  clothingDescription: z.string().max(4000),
  characterName: z.string().min(1).max(100),
  characterRoleLabel: z.string().min(1).max(200),
  characterAge: z.number().int().min(0).max(200),
  lookLabel: z.string().min(1).max(100),
  palette: z.array(z.string()).max(8).optional(),
  projectStyle: z.string().max(50).optional(),
  model: z.string().max(100).optional(),
  mode: z.enum(["modify", "three-view", "multi-asset"]).default("modify"),
  // 2026/06:查看提示词模式
  previewOnly: z.boolean().default(false),
});

export type RegenerateInputType = z.infer<typeof RegenerateInput>;

/** 根据 mode 拼不同的 positive / negative prompt(平移自 characterRegen.functions.ts:61-278) */
function buildCharacterPrompts(opts: {
  data: RegenerateInputType;
  styleSpec: { label: string; positive: string; negative: string };
  cardTitle: string;
}): { positive: string; negative: string; size: string } {
  const { data, styleSpec, cardTitle } = opts;

  if (data.mode === "three-view") {
    const positive = [
      `Generate ONE standard 4-view character reference sheet of "${cardTitle}" — a ${data.characterRoleLabel}, age ${data.characterAge}. The output is a SINGLE image with EXACTLY 4 panels (panel 1 = front, panel 2 = LEFT side profile, panel 3 = RIGHT side profile, panel 4 = back).`,
      ``,
      `You are given TWO sources of truth and BOTH must agree:
  (A) the attached REFERENCE IMAGE — the current approved front-view of "${cardTitle}", and
  (B) the FACE / BODY / OUTFIT text descriptions below.
If (A) and (B) ever disagree, follow (B). The character identity MUST match (B) exactly.`,
      ``,
      `[PHYSICAL STATE — must be respected in ALL 4 panels]`,
      `The character's body description (bodyDescription) below is the SINGLE SOURCE OF TRUTH for their physical condition.`,
      `If the body description indicates a permanent physical trait (e.g. uses a wheelchair, missing limb, prosthetic, walking cane, blind, deaf), that trait MUST appear consistently in ALL 4 panels.`,
      `DO NOT force the character into a "standing upright" pose if they use a wheelchair — show them in their wheelchair in all 4 panels (front/left-side/right-side/back views of the person IN the wheelchair).`,
      `DO NOT add missing limbs back — if the description says they are missing an arm or leg, all 4 panels must show that limb missing.`,
      `The camera angle changes between panels (front → left side → right side → back), but the character's physical state, assistive devices, and permanent condition stay identical across all 4 panels.`,
      ``,
      `LAYOUT — strict, no exceptions:
  Output ONE image with EXACTLY 4 horizontal panels, side-by-side, equal width:
    • PANEL 1 (leftmost)  = FRONT view (the reference image's angle, character facing camera)
    • PANEL 2             = LEFT SIDE profile (-90° rotation, character's LEFT side facing the camera)
    • PANEL 3             = RIGHT SIDE profile (+90° rotation, character's RIGHT side facing the camera)
    • PANEL 4 (rightmost) = BACK view (180° rotation)
  NO 5th panel. NO diagonal panel. NO detail box. NO labels. NO captions. NO arrows. NO scale indicators. NO text inside the image.`,
      ``,
      `CRITICAL — LEFT/RIGHT SIDE SYMMETRY: The LEFT side profile (panel 2) and RIGHT side profile (panel 3) MUST show the EXACT SAME PERSON — identical face shape, identical hairstyle, identical body proportions, identical outfit details, identical accessories, identical physical condition. The ONLY difference between panel 2 and panel 3 is which side of the character faces the camera. If the character has asymmetrical features (e.g. an eyepatch on the right eye, a scar on the left cheek), those features MUST appear correctly on the appropriate side in each profile view.`,
      ``,
      `PER-PANEL SHOT TYPE: Each of the 4 panels is a FULL SHOT (FS) / LONG SHOT (LS) / FULL-LENGTH PORTRAIT — the same framing used in character turnaround sheets, model sheets, and costume reference sheets. The character in EACH panel is shown from head to toe (or the full extent of their body, including wheelchair/prosthetic if applicable).`,
      ``,
      `PER-PANEL GEOMETRY: Each panel is portrait-orientation. In each panel, the character occupies 85-95% of the panel's vertical extent — from the top of the head to the lowest point of the body (soles of feet, wheelchair bottom, prosthetic bottom, etc.). Small white margin above the head AND below the body in EACH panel. The character does NOT touch the top or bottom edge of any panel.`,
      ``,
      `PER-PANEL COMPOSITION (apply in each of the 4 panels):
  1. Reserve a portrait-orientation panel.
  2. Place the character centered horizontally.
  3. Top of head at the top of the panel (with small margin).
  4. Lowest body point at the bottom of the panel (with small margin).
  5. Body fills the vertical axis of the panel — full body, no half-body.
  6. Both feet visible (if applicable and the character has feet). Hands visible at the sides (if applicable).`,
      ``,
      `HARD CONSTRAINTS — the image is REJECTED if ANY of these is true in ANY of the 4 panels:
  • The panel is a half-body, waist-up, hip-up, chest-up, shoulder-up, knee-up, cowboy shot, or head-and-shoulders crop.
  • The head or top of the hair is cut off at the top of the panel.
  • The body or wheelchair/prosthetic is cut off at the bottom of the panel.
  • The body extends beyond the panel edge.
  • The character occupies less than 80% of the panel's height.
  • Any side or back panel is tighter than the front panel (this is the #1 most common failure mode — ALL side and back panels must be JUST AS FULL as the front).
  • The image contains 5+ panels, or fewer than 4 panels.
  • The character's physical condition (wheelchair, missing limb, etc.) differs between panels — it MUST be identical in all 4.
  • The LEFT and RIGHT side profiles show different face/body/outfit — they MUST show the exact same person, only the camera direction differs.`,
      ``,
      `CAMERA PER PANEL: Neutral front/left-side/right-side/back views. The ONLY thing that changes between panels is the camera rotation around the vertical axis. NO 3/4 view, NO diagonal, NO action pose, NO walking, NO running, NO hands-on-hips. The character stays in their natural/default state (sitting in wheelchair if applicable, standing if applicable, with their assistive devices as described).`,
      ``,
      `EXPRESSION IN ALL 4 PANELS: Neutral, expressionless, like a passport photo. No smile, no frown, no emotion, eyes open looking at the camera.`,
      ``,
      `IDENTITY LOCK ACROSS ALL 4 PANELS: Same face, same body, same physical condition, same outfit, same age, same hair, same skin tone, same accessories, same shoes, same wheelchair or prosthetic if applicable. The ONLY difference between panels is the camera angle. The LEFT and RIGHT side profiles (panels 2 and 3) must show the exact same person — mirror the face/hair/body shape, just from opposite sides.`,
      ``,
      `VISUAL STYLE (MUST match across all 4 panels — no style drift between panels):`,
      buildStyleLock(styleSpec, "reference"),
      ``,
      `CHARACTER (source of truth, alongside the attached reference image):
  Name: ${cardTitle} (${data.characterRoleLabel}, age ${data.characterAge})
  Face (must remain identical in all 4 panels): ${data.faceDescription || "(use the face shown in the attached reference image)"}
  Body (must remain identical in all 4 panels — includes physical condition, disabilities, assistive devices): ${data.bodyDescription || "(use the body shown in the attached reference image)"}
  Outfit (must remain identical in all 4 panels — do NOT change the outfit between panels): ${data.clothingDescription || "(use the outfit shown in the attached reference image)"}`,
      ``,
      `BACKGROUND: Each panel has a uniform light neutral background (off-white #F5F5F5 / light grey #EEEEEE is OK — this IS a reference sheet, not a final product, so the strict pure-white rule is relaxed). NO scenery, NO floor, NO horizon, NO props, NO environment, NO shadow on the background, NO reflection.`,
      ``,
      `FINAL CHECK — verify every item before submitting. If any is false, REGENERATE the image:
  [ ] Output is ONE image with EXACTLY 4 panels (front / left side / right side / back) (yes)
  [ ] All 4 panels show the FULL BODY (including wheelchair/prosthetic if applicable) (yes)
  [ ] All 4 panels are equally full-body (side and back NOT tighter than front) (yes)
  [ ] LEFT and RIGHT side profiles show identical character (face/body/outfit) (yes)
  [ ] Same face, body, physical condition, outfit, age in all 4 panels (yes)
  [ ] Physical disabilities/assistive devices are identical in all 4 panels (yes)
  [ ] Style matches "${styleSpec.label}" in all 4 panels (yes)
  [ ] Expression is neutral in all 4 panels (yes)
  [ ] No text, watermark, logo, labels, captions inside the image (yes)`,
      ``,
      `Begin. Output the 4-view full-body reference sheet.`,
    ]
      .filter(Boolean)
      .join("\n");
    const negative = [
      "medium shot, medium close-up, MCU, MS, mid-shot, mid close-up, half body, half-body, half-length, three-quarter body, 3/4 body, three-quarter length, cowboy shot, american shot, knee-up shot, knee-up, mid-thigh shot, thigh-up, hip-up, waist-up shot, waist-up, midriff-up, chest-up shot, chest-up, shoulder-up, head and shoulders, head-and-shoulders, head only, headshot, head shot, tight headshot, tight crop, tight framing, close-up, close up, CU, extreme close-up, ECU, bust shot, bust, portrait crop, portrait shot, passport photo, ID photo",
      "cropped at knees, cropped at calves, cropped at shins, cropped at ankles, cropped at waist, cropped at hips, cropped at thighs, cropped at chest, cropped at shoulders, cropped at neck, head cut off, top of head cut off, top of head clipped, hair cut off, feet cut off, shoes cut off, hands cut off, body extending beyond frame, body touching frame edge, body touching top of frame, body touching bottom of frame, figure touching top of frame, figure touching bottom of frame, half-body in side panel, half-body in back panel, half-body in any panel, 3/4 body in any panel, close-up of torso in side or back panel, tight framing in side panel, tight framing in back panel, side panel tighter than front, back panel tighter than front, side panel showing only upper body, back panel showing only upper body",
      "missing feet, missing shoes, missing head, missing legs, missing lower body, missing upper body, head only, torso only, legs only, partial body, incomplete body, amputated limbs, no legs, no feet, legless, feet-less, lower body cut off, lower body fading out, lower body blended with background, character floating with no feet, character shown only from the waist up, from waist up only, from chest up only, from hips up only, from knees up only",
      "low angle, low-angle shot, worm's eye view, worm eye view, hero shot, looking up at subject, upward camera, upward tilt, camera below subject, dutch angle, dutch tilt, tilted camera, canted angle, fisheye, wide-angle distortion, 3/4 view, three-quarter view, diagonal angle, perspective, action pose, walking, sitting, crouching, jumping, leaning, hands on hips, prop holding, dynamic pose, tilted head, looking up, looking down, top-down, bird's eye view, bottom-up",
      "different art style, style drift, photorealistic when input is anime, anime when input is realistic, different medium, different line treatment, different color grading, inconsistent rendering between panels, mixing anime and realistic, mixing 3D and 2D, mixing watercolor and cel-shading",
      "smile, smirk, grin, frown, scowl, angry eyes, sad eyes, laughing, crying, pouting, raised eyebrow, looking sideways, eyes closed, eyes squinting, teeth showing, emotional expression, character personality face",
      "different face, different face shape, different eye shape, different eye color, different nose, different mouth, different eyebrows, different skin tone, different hairstyle, different hair color, different hair length, different facial proportions, age change, different body, different body proportions, different height, different weight, different gender presentation, different outfit, different clothing color, different clothing style, different accessories, different hat, different glasses, different jewelry, different bag, different weapon, different shoes, different makeup, extra clothing item, missing clothing item, outfit change between panels",
      "asymmetric face between left and right side, different face in left vs right profile, inconsistent left vs right side views, left side and right side showing different person, different outfit in left vs right, mirrored incorrectly, face looks different in left profile vs right profile, left side profile mismatch, right side profile mismatch",
      "scenery, furniture, props, ground texture, horizon line, floor, wall, sky, busy background, complex background, detailed background, color cast, gradient background, vignette, shadow on background, floor reflection, environment, room, indoor, outdoor",
      "watermark, logo, text, signature, label, panel number, caption, annotation, arrow, callout, extra limbs, deformed hands, extra fingers, extra people, multiple characters, bystander, blurred face, low quality, 5 panels, 6 panels, more than 4 views, fewer than 4 views, single panel, 3 panels",
    ].join(", ");
    // Seedream 用 'x' 分隔画幅;四视图横向 4 面板 → 长方形画布
    // 4096x1280 = 5,242,880 像素,稳过 Seedream 3,686,400 的最小要求
    return { positive, negative, size: "4096x1280" };
  }

  if (data.mode === "multi-asset") {
    // ====================================================================
    // 角色多维资产图 —— 2026/06 用户二次扩展,2026/07 三视图→四视图
    //
    // 在原 3 区域(四视图/表情/姿势)基础上合并新需求:
    //   ① 大型主肖像(hero portrait,放整张图最显眼位置)
    //   ② 各种面部表情(开心/生气/困倦/惊讶等,融合原有 6 表情扩成 6-8 个)
    //   ③ 动作姿势(按角色个性自适应,不限定 4 个)
    //   ④ 小型物体图标(配饰/长期携带道具)
    //   ⑥ 简介条(名字 + 个性 / role 描述)
    //
    // 最终布局(从上到下):
    //   Section 0  简介条        — 名字 + 个性短描述
    //   Section 1  大型主肖像    — 整张图最显眼,半身或全身 hero shot
    //   Section 2  角色四视图    — 正/左/右/背
    //   Section 3  表情表        — 6-8 个面部特写(覆盖开心/生气/困倦/惊讶/悲伤/常态等)
    //   Section 4  动作姿势      — 4-6 个全身动作,按角色个性挑选
    //   Section 5  配饰/道具图标 — 小型物体行,展示长期携带的配饰/道具
    //
    // 硬约束:白色背景、中文标注、不限格数(按内容铺开)、跨 section 同一张脸/服装/特征
    // ====================================================================
    const positive = [
      `[MISSION] Generate a complete CHARACTER MULTI-ASSET SHEET (角色多维资产图) for "${cardTitle}" — a ${data.characterRoleLabel}, age ${data.characterAge}. ONE large image, PURE WHITE BACKGROUND (#FFFFFF). The image is divided into SIX clearly separated sections, top-to-bottom, with thin neutral dividers between sections. Illustration-grade, clean composition, like a page from an official character design document handed to an animation team or game studio.`,

      `You are given TWO sources of truth and BOTH must agree:`,
      `  (A) the attached REFERENCE IMAGE — the current approved look of "${cardTitle}", and`,
      `  (B) the FACE / BODY / OUTFIT text descriptions below.`,
      `If (A) and (B) ever disagree, follow (B) and treat (A) as a visual hint. The character identity MUST stay consistent across all sub-images.`,

      // ========== 整体视觉风格 ==========
      `[OVERALL VISUAL TREATMENT — strictly enforced]`,
      `- PURE WHITE BACKGROUND (#FFFFFF) for the entire page and every sub-image. NO scenery, NO floor, NO horizon, NO environment, NO shadow on the background. Like a printed reference document.`,
      `- Illustration style with clean linework. NOT photoreal — illustration-grade.`,
      `- Thin neutral dividers (~#E8E8E8) only between the six sections. No fancy borders, no gold filigree.`,
      `- HD resolution. Sharp, clean, professional.`,
      `- ALL TEXT IN SIMPLIFIED CHINESE (简体中文), readable size, clean font (Songti / 思源宋体 / sans-serif). Each section carries a Chinese title (with optional small English subtitle); each sub-image carries a short Chinese label.`,
      `- DO NOT IMPOSE A FIXED NUMBER OF GRID CELLS within sections. Section 1 is one big image. Sections 2-5 lay out sub-images naturally — content first, no padding for grid neatness.`,

      // ========== Section 0:简介条 ==========
      `[SECTION 0 — 简介 / PROFILE BAR (top strip, ~8% of image height)]`,
      `A horizontal text-only header at the very top of the image. From left to right:`,
      `  • Character name in larger Chinese characters: "${cardTitle}"`,
      `  • Small role badge (chip): "${data.characterRoleLabel}", age ${data.characterAge}`,
      `  • Brief personality / character description in 1-2 short Chinese sentences (refined, succinct — pulled from the role context). Example tone: "沉默寡言的天才剑士,行动果决,内心藏着旧伤。"`,
      `Layout: clean, print-document feel. Small but readable. NO illustration in this strip — text only.`,

      // ========== Section 1:大型主肖像 ==========
      `[SECTION 1 — 大型主肖像 / MAIN PORTRAIT (the visual centerpiece, ~25% of image height)]`,
      `Section title above it: "大型主肖像 / Main Portrait"`,
      `One LARGE hero portrait — half-body to 3/4-body framing, facing camera, in the character's most identity-defining pose (the look that best captures who they are). This is the centerpiece of the whole sheet — render it with the most attention to detail (lighting, expression, posture). White background.`,
      `Must show the character's complete identity-defining features: face, hairstyle, complete outfit visible, signature accessories. If the character has special traits (glasses, animal ears, wings, tail, horns, distinctive markings), ALL must be visible here.`,

      // ========== Section 2:四视图 ==========
      `[SECTION 2 — 角色四视图 / FOUR-VIEW]`,
      `Section title: "角色四视图 / Four-View"`,
      `Lay out FOUR FULL-BODY orthographic views side-by-side:`,
      `  • 正视图 (Front view) — character facing camera, expressionless face, in their natural/default state (standing if able, in wheelchair if they use one, with prosthetic/assistive device if applicable)`,
      `  • 左侧视图 (Left Side view) — -90° rotation, character's LEFT side facing camera, same state`,
      `  • 右侧视图 (Right Side view) — +90° rotation, character's RIGHT side facing camera, same state`,
      `  • 背视图 (Back view) — 180° rotation, back facing camera, same state`,
      `Each view is labeled in Chinese below it: "正视图" / "左侧视图" / "右侧视图" / "背视图".`,
      `CRITICAL — PRESERVE ALL CHARACTER FEATURES across all four views: any special trait (glasses, wings, animal ears, tail, horns, special hair accessory, distinctive eye color, tattoos) MUST appear consistently. Identical proportions, identical outfit, identical physical condition. NO perspective distortion, NO foreshortening, NO 3/4 angles. Standard orthographic.`,
      `CRITICAL — LEFT/RIGHT SIDE IDENTITY MATCH: The left side and right side profiles MUST show the EXACT SAME PERSON — identical face shape, hairstyle, body proportions, outfit details, and physical condition. The ONLY difference is which side faces the camera. Asymmetrical features (eyepatch, scar, etc.) must appear correctly on the appropriate side.`,
      `IMPORTANT — The body description (bodyDescription) below is the SINGLE SOURCE OF TRUTH for the character's physical condition. If they use a wheelchair, are missing a limb, or have any permanent physical trait, that MUST be shown identically in all four views. Do NOT force "standing A-pose" if the character uses a wheelchair.`,

      // ========== Section 3:表情表 ==========
      `[SECTION 3 — 表情表 / EXPRESSIONS]`,
      `Section title: "表情表 / Expressions"`,
      `Lay out 6-8 FACIAL CLOSE-UPS (大头照, head-and-shoulders, front-facing). Each is the SAME face as in Sections 1-2; ONLY the EXPRESSION changes. Each labeled in Chinese below it.`,
      `Required emotions (pick at least 6 from this set, all from the list must appear unless the character's nature truly excludes one):`,
      `  • 开心 / 喜悦 (Happy / Joy) — genuine smile, eyes warm`,
      `  • 生气 / 愤怒 (Angry) — brows pulled down and inward, mouth tight or bared`,
      `  • 困倦 (Sleepy) — eyes half-closed, slight head tilt, relaxed mouth`,
      `  • 惊讶 (Surprised) — eyes wide, brows raised, mouth slightly agape`,
      `  • 悲伤 (Sad) — mouth corners down, inner brows raised, eyes soft`,
      `  • 常态 / 平静 (Neutral / Calm) — default, face relaxed`,
      `Optional additions if 8 cells used:`,
      `  • 恐惧 (Fear) — eyes wide with tension, brows raised and pulled together`,
      `  • 思考 (Thoughtful) — slight eye narrowing, lips pressed, contemplative`,
      `CRITICAL — same face shape, eye shape, nose, mouth structure, hairstyle, skin tone, camera angle (front), lighting. Special features (glasses, ears, horns) consistent in every expression close-up.`,

      // ========== Section 4:动作姿势 ==========
      `[SECTION 4 — 动作姿势 / POSES (personality-driven, must respect physical condition)]`,
      `Section title: "动作姿势 / Poses"`,
      `Lay out 4-6 FULL-BODY dynamic poses, each labeled in Chinese below it. **Pick poses that fit THIS character's personality AND physical ability**, drawn from the role label (${data.characterRoleLabel}) and the body description below.`,
      `CRITICAL — If the character uses a wheelchair or has a physical disability, ALL poses MUST be consistent with that condition. A wheelchair user can wave, turn their head, reach for something, interact with objects, etc. — but NOT stand, walk, or run. A one-armed character should NOT use the missing arm.`,
      `Examples (pick what fits; invent better-matching ones freely):`,
      `  • 招手 (Waving) — for friendly characters (sitting or standing as applicable)`,
      `  • 思考 (Thinking) — for strategists / scholars`,
      `  • 微笑 (Smiling at camera) — gentle, approachable`,
      `  • 持物姿态 (Holding signature prop) — if the character has a signature item`,
      `  • 回头 (Turning back) — mysterious or guarded`,
      `  • 坐姿 (Sitting) — composed or contemplative (natural for wheelchair users)`,
      `  • 交流手势 (Gesturing while talking) — for expressive characters`,
      `  • 阅读 (Reading) — for bookish characters`,
      `Each pose is head-to-toe full body (including wheelchair/prosthetic if applicable). Outfit / hair / special features (ears, tail, wings, glasses, horns) MUST stay consistent in every pose. Physical condition (wheelchair, missing limb) MUST be identical in every pose.`,

      // ========== Section 5:配饰/道具图标 ==========
      `[SECTION 5 — 配饰 / 道具图标 / ACCESSORIES & PROPS]`,
      `Section title: "配饰 / 道具图标 / Accessories & Props"`,
      `Lay out a HORIZONTAL ROW of 4-8 SMALL OBJECT ICONS — each rendered as a clean isolated illustration on the white background, like an inventory icon. Each labeled in Chinese below it.`,
      `Pick items from the character's outfit / equipment / typical loadout — the accessories or props the character carries habitually or that define them. Examples (only include what actually fits THIS character):`,
      `  • Weapons (剑、弓、匕首、法杖…)`,
      `  • Jewelry / wearables (吊坠、戒指、耳环、项链、护身符…)`,
      `  • Tools / containers (背包、水壶、笔记本、地图、卷轴…)`,
      `  • Personal effects (信物、家传物件、护照、徽章…)`,
      `  • Headgear / handheld accessories (帽子、面具、手套、烟斗…)`,
      `Each icon is small but clear, showing its design detail. Items NOT held/worn by the character — just the items themselves, isolated. If the character has a signature pet / familiar that travels with them, include it here as well.`,

      // ========== 质量约束 ==========
      `[CRITICAL RULES — output is REJECTED if ANY of these is violated]`,
      `RULE 1 — PURE WHITE BACKGROUND (#FFFFFF) everywhere. NOT gray, NOT cream, NOT textured. No floor, no scenery.`,
      `RULE 2 — IDENTITY LOCK: every face shown across the entire image MUST be the SAME PERSON. Same face shape, eyes, nose, mouth, hairstyle, hair color, skin tone. Different person = REJECT.`,
      `RULE 3 — FEATURE PRESERVATION: any special trait (glasses, wings, animal ears, tail, horns, special accessories, distinctive markings) MUST appear in: the main portrait, all four views, every expression close-up, every pose. Missing in any one of these = REJECT.`,
      `RULE 4 — CHINESE TEXT LABELS: every section carries a Chinese title; every sub-image / icon carries a Chinese label. Text must be readable, simplified Chinese, no garbled characters, no English-only labels.`,
      `RULE 5 — NO RIGID GRID: do not force a fixed grid. Section 1 = one big hero portrait. Sections 2-5 lay items out by content (4 views in Section 2, 6-8 expressions in Section 3, 4-6 poses in Section 4, 4-8 accessory icons in Section 5).`,
      `RULE 6 — NO PERSPECTIVE ERRORS in Section 2 (four-view): orthographic only (0° / -90° (left) / +90° (right) / 180°).`,
      `RULE 7 — EXPRESSION ONLY in Section 3: only expression changes between close-ups. Same head size, camera angle, lighting.`,
      `RULE 8 — PERSONALITY-MATCHED POSES in Section 4: pose set should reflect this character's role and temperament. A reserved scholar should NOT get aggressive combat poses; a playful child should NOT get combat-ready poses.`,
      `RULE 9 — STYLE LOCK: all sub-images + labels rendered in the project's selected visual style "${styleSpec.label}". No mixing of anime + photoreal, no mixing of 2D + 3D.`,
      `RULE 10 — NO UNRELATED CONTENT: no other characters in any sub-image, no random scenery, no extra limbs, no deformed hands. Section 0 is text-only. Section 5 icons are isolated objects, not in-scene.`,
      `RULE 11 — SECTION SEPARATORS: only thin neutral dividers (~#E8E8E8) between the six sections. No fancy borders, no decorative frames.`,
      `RULE 12 — PROFILE BAR IS TEXT-ONLY: Section 0 contains only text (name, role badge, personality description). No portrait, no icon in this strip.`,

      // ========== 风格 / 角色数据 ==========
      `[PROJECT VISUAL STYLE — must match across all sub-images]`,
      buildStyleLock(styleSpec, "character"),

      `[CHARACTER IDENTITY — source of truth, copy into the image EXACTLY]`,
      `Name: ${cardTitle} (${data.characterRoleLabel}, age ${data.characterAge})`,

      `=== FACE — IDENTICAL across every face/head in the image ===`,
      data.faceDescription ||
        "(no separate face description — use the face shown in the attached reference image)",
      `=== END FACE ===`,

      `=== BODY — IDENTICAL across all full-body sub-images (includes physical condition / disabilities / assistive devices) ===`,
      data.bodyDescription ||
        "(no separate body description — use the body shown in the attached reference image)",
      `NOTE: The body description is the single source of truth for physical condition. If the character uses a wheelchair, missing a limb, or has any permanent physical trait, that MUST be shown identically in every sub-image. Do NOT force standing poses on wheelchair users.`,

      `=== OUTFIT — IDENTICAL across all sub-images, do NOT add/remove clothing or accessories ===`,
      data.clothingDescription ||
        "(no separate outfit description — use the outfit shown in the attached reference image)",
      `=== END OUTFIT ===`,
      data.palette?.length
        ? `\n=== PALETTE (hex colors) — apply consistently ===\n${data.palette.join(", ")}\n=== END PALETTE ===`
        : "",

      // 把用户在 instruction 里写的语义提示也带上(client 那边传简短中文 instruction,作为 EDIT REQUEST)
      `[USER REQUEST]`,
      data.userInstruction,

      `[FINAL CHECKLIST]`,
      `[ ] Pure white background throughout`,
      `[ ] Section 0: text-only profile bar (name, role chip, 1-2 Chinese sentences of personality)`,
      `[ ] Section 1: one large hero portrait — the visual centerpiece`,
      `[ ] Section 2: four full-body orthographic views (front/left-side/right-side/back) with Chinese labels`,
      `[ ] Section 3: 6-8 facial close-ups covering 开心/生气/困倦/惊讶/悲伤/常态 (at minimum) with Chinese labels`,
      `[ ] Section 4: 4-6 full-body poses matched to character personality, Chinese-labeled`,
      `[ ] Section 5: 4-8 small accessory/prop icons (isolated objects), Chinese-labeled`,
      `[ ] Same face, body, outfit, special features across the entire image`,
      `[ ] All text in simplified Chinese, readable`,
      `[ ] Style matches "${styleSpec.label}"`,
      `[ ] No other characters, no extra limbs, no perspective errors in the four-view`,

      `Begin. Output the character multi-asset sheet.`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const negative = [
      "different art style, style drift, photorealistic when input is anime, anime when input is realistic, inconsistent rendering between sub-images",
      "different face, different face shape, different eye shape, different eye color, different nose, different mouth, different eyebrows, different skin tone, different hairstyle, different hair color, different hair length, different facial proportions, age change, different body, different body proportions, different height, different gender presentation, different outfit, different clothing color, different clothing style, different accessories, different glasses, different jewelry, different shoes",
      "missing glasses when source has glasses, missing wings when source has wings, missing tail when source has tail, missing animal ears when source has them, missing horns when source has horns, missing distinctive feature, feature drift, lost accessory",
      "perspective distortion in four-view, fish-eye, wide-angle distortion, foreshortening, hero shot, low angle, 3/4 view in front/side/back, diagonal angle, left side and right side showing different face, asymmetric side profiles, inconsistent left vs right side view, different body in left vs right, mirrored incorrectly in side views",
      "cropped at knees, cropped at waist, cropped at chest, head cut off, feet cut off, body extending beyond frame, missing feet, missing hands, missing legs",
      "inconsistent proportions across the four views, taller in one view, shorter in another, scale mismatch between sub-images",
      "extra people, bystander, multiple characters, extra limbs, deformed hands, extra fingers, deformed face, blurred face, low quality",
      "detailed scenery, busy backgrounds, room interior, outdoor landscape, props cluttering the frame, floor, wall, sky, scenery, furniture, ground texture, horizon line, shadow on background, gradient background",
      "English-only labels, garbled Chinese, missing labels, illegible text, decorative borders, ornate frames, gold filigree",
      "rigid 3x3 grid template when content needs different layout, forced 4 panels, forced 5 panels, padding cells, blank cells",
      "profile bar with illustration, profile bar with icon, profile bar that is not text-only",
      "accessory icons held by the character, accessory icons worn by the character, accessory icons in a scene, accessory icons with background scenery",
      "main portrait too small, main portrait same size as thumbnails, no clear visual centerpiece, hero portrait demoted to side thumbnail",
      "combat poses for a peaceful character, scholarly poses for a child, mismatched poses for character personality",
    ].join(", ");
    return { positive, negative, size: "2160x2880" };
  }

  // ---- 默认 'modify' ----
  const positive = [
    `[EDIT REQUEST — what to change in the attached image]`,
    data.userInstruction,
    ``,
    `[LOCK — neutral structure MUST stay 100% identical to the source image]`,
    `• 脸型、脸轮廓、五官比例、肤色、骨骼结构 100% 继承图1`,
    `• 体型、身高、胖瘦、体态 100% 继承图1`,
    `• 发型轮廓(短/长/卷/直、刘海/鬓角)100% 继承图1`,
    `  ↳ 发色默认继承,但若用户 EDIT REQUEST 明确要换发色则按 EDIT`,
    `• 整体画面构图、视角、画幅、风格、光照、背景 100% 继承图1`,
    ``,
    `[LOCK — accessories / makeup / expression follow EDIT REQUEST only]`,
    `• 妆容(眼妆、唇色、腮红)默认继承;若 EDIT 提到妆容则按 EDIT`,
    `• 表情默认继承"无表情";若 EDIT 提到表情则按 EDIT`,
    `• 配饰(口罩/帽子/墨镜/项链/手套等)默认继承;若 EDIT 提到配饰则按 EDIT,否则保持图1 原样`,
    `• 整体服装默认继承;若 EDIT 提到服装则按 EDIT 改`,
    ``,
    `[HARD CONSTRAINT — 任何"中性结构"没在 EDIT 里明确说改的,一律按 LOCK 段保持]`,
    `If the user's EDIT REQUEST is vague (e.g. "好看点" / "年轻些" / "加个眼镜"),interpret minimally:
  • "好看点" / "完美些" → DO NOT change anything, return source image essentially unchanged
  • "年轻些" / "老一些" → change only the age cue, keep face shape / body 100%
  • "加个 X" / "换成 X" → only add/change X, nothing else`,
    `[Subject] ${cardTitle} — ${data.characterRoleLabel}, age ${data.characterAge}.`,
    ``,
    buildStyleLock(styleSpec, "regen"),
  ].join("\n");
  const negative = [
    "different art style, style drift, photorealistic when input is anime, anime when input is realistic, different medium, different line treatment, different color grading",
    "3/4 view, side view, profile, back view, tilted head, looking up, looking down, top-down, bottom-up, hero shot, low angle, high angle, camera pan, camera tilt",
    "cropped at knees, cropped at waist, cropped at chest, cropped at thighs, head cut off, feet cut off, close-up, medium shot, half body",
    "smile, smirk, grin, frown, scowl, angry eyes, sad eyes, laughing, crying, pouting, raised eyebrow, eyes closed, eyes squinting, teeth showing, emotional expression",
    "off-white background, cream background, ivory background, beige background, light grey background, gradient background, vignette, scenery, furniture, props, ground texture, horizon line, floor, wall, sky, shadow on background, floor reflection, color cast",
    "different face, different face shape, different eye shape, different eye color, different nose, different mouth, different eyebrows, different skin tone, different hairstyle, different hair color, different hair length, different facial proportions, age change",
    "watermark, logo, text, signature, extra limbs, deformed hands, extra fingers, extra people, blurred face, low quality",
  ].join(", ");
  return { positive, negative, size: "2K" };
}

export const regenerateCharacterLook = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => RegenerateInput.parse(d))
  .handler(async ({ data }) => {
    const { resolveProjectStyle } = await import("./visualStyles");
    const styleSpec = resolveProjectStyle(data.projectStyle);
    const cardTitle =
      data.lookLabel === "默认" ? data.characterName : `${data.characterName} · ${data.lookLabel}`;

    const { positive, negative, size } = buildCharacterPrompts({ data, styleSpec, cardTitle });
    const requested = normalizeImageModelForRouting(data.model);
    const prompt = appendNegative(positive, negative);

    // 2026/06:查看提示词模式 —— 不调 Seedream,直接把 prompt 返回
    if (data.previewOnly) {
      return {
        ok: true as const,
        previewPrompt: prompt,
        negativePrompt: negative,
        promptSize: normalizeSeedreamSize(size),
        promptExtra: {
          model: requested || DEFAULT_MODEL,
          mode: data.mode,
          referenceImage: data.referenceImageUrl,
        },
      };
    }

    if (requested.toLowerCase().startsWith("pixflow/")) {
      const { callPixflowImage } = await import("./pixflow.functions");
      const r = await callPixflowImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "Pixflow 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("claude360/")) {
      const { callClaude360Image } = await import("./claude360Image.functions");
      const r = await callClaude360Image({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      });
      if (!r.url) return { ok: false as const, error: r.error || "Claude360 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("tokenflash/")) {
      const { callTokenflashImage } = await import("./tokenflash.functions");
      const r = await callTokenflashImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "Tokenflash 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("revora/")) {
      const { callRevoraImage } = await import("./revoraImage.functions");
      const r = await callRevoraImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "Revora 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("aigcfamily/")) {
      const { callAigcfamilyImage } = await import("./aigcfamilyImage.functions");
      const r = await callAigcfamilyImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "AIGCFamily 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }

    if (requested.toLowerCase().startsWith("shuci/")) {
      const { callShuanciyuanImage } = await import("./shuanciyuan.functions");
      const r = await callShuanciyuanImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "数安词源 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (
      requested.toLowerCase().startsWith("azure/") ||
      requested.toLowerCase().startsWith("azure2/")
    ) {
      const { callAzureImage } = await import("./azureImage.functions");
      const r = await callAzureImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "Azure 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model, meta: r.meta };
    }
    if (requested.toLowerCase().startsWith("onetoken/")) {
      const { callOnetokenImage } = await import("./onetokenImage.functions");
      const r = await callOnetokenImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
      });
      if (!r.url) return { ok: false as const, error: r.error || "OneToken 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("otu/")) {
      const { callOtuImage } = await import("./otuImage.functions");
      const r = await callOtuImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      });
      if (!r.url) return { ok: false as const, error: r.error || "OTU 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("aitokenvibe/")) {
      const { callAitokenvibeImage } = await import("./aitokenvibeImage.functions");
      const r = await callAitokenvibeImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      });
      if (!r.url) return { ok: false as const, error: r.error || "AI Tokenvibe 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("thhtcloud/")) {
      const { callThhtcloudImage } = await import("./thhtcloudImage.functions");
      const r = await callThhtcloudImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      });
      if (!r.url) return { ok: false as const, error: r.error || "天鸿智算 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("ailinzi/")) {
      const { callAilinziImage } = await import("./ailinziImage.functions");
      const r = await callAilinziImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      });
      if (!r.url) return { ok: false as const, error: r.error || "ailinzi 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("vapeur/")) {
      const { callVapeurImage } = await import("./vapeurImage.functions");
      const r = await callVapeurImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      });
      if (!r.url) return { ok: false as const, error: r.error || "vapeur 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("tokenhub/")) {
      const { callTokenhubImage } = await import("./tokenhubImage.functions");
      const r = await callTokenhubImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      });
      if (!r.url) return { ok: false as const, error: r.error || "tokenhub 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("nagora/")) {
      const { callNagoraImage } = await import("./nagoraImage.functions");
      const r = await callNagoraImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      });
      if (!r.url) return { ok: false as const, error: r.error || "nagora 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("meridian/")) {
      const { callMeridianImage } = await import("./meridianImage.functions");
      const r = await callMeridianImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      });
      if (!r.url) return { ok: false as const, error: r.error || "meridian 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }

    const { apiKey, baseUrl, model: defaultModel } = getArkConfig();
    if (!apiKey) return { ok: false as const, error: "ARK_API_KEY not configured" };
    const model = requested || defaultModel;

    const result = await callSeedreamImages(
      {
        model,
        prompt,
        image: data.referenceImageUrl,
        size: normalizeSeedreamSize(size),
        output_format: "png",
        watermark: false,
      },
      apiKey,
      baseUrl,
      I2I_TIMEOUT_MS,
    );
    if (!result.url) {
      // 中文错误映射(保持跟原来一致的用户体验)
      if (/401/i.test(result.error || ""))
        return { ok: false as const, error: "Seedream auth failed (401)" };
      if (/402/i.test(result.error || "")) return { ok: false as const, error: "no_credits" };
      if (/timed out/i.test(result.error || ""))
        return { ok: false as const, error: "AI 处理超时(>180s),请重试或换更简单的修改" };
      return { ok: false as const, error: result.error || "Seedream 未返回图片" };
    }
    return { ok: true as const, url: result.url, model: result.model };
  });

// ====================================================================
// 3) generateStoryboardShotImage —— 多图融合 I2I(分镜)
//
//   Seedream 的 image 接受 string[]。参考图顺序:先所有角色,再场景。
//   prompt builder 平移自 storyboard.functions.ts:407-454。
// ====================================================================

const ShotInput = z.object({
  plotText: z.string().min(1).max(2000),
  shotType: z.enum(["WS", "MS", "CU", "ECU", "OTS"]),
  shotTypeLabel: z.string().min(1).max(20),
  action: z.string().min(1).max(400),
  camera: z.string().max(200).default(""),
  // Seedream 实际接受更多张(经验上 ≤4 稳定),这里跟老代码一样守住 ≤3 防意外
  characterImageUrls: z.array(z.string().url()).max(3).default([]),
  characterNames: z.array(z.string().max(50)).max(3).default([]),
  sceneImageUrl: z.string().url().optional(),
  sceneLocation: z.string().max(200).default(""),
  sceneTimeOfDay: z.string().max(50).default(""),
  projectStyle: z.string().max(50).optional(),
  model: z.string().max(100).optional(),
  // 2026/06:查看提示词模式
  previewOnly: z.boolean().default(false),
});

export type ShotInputType = z.infer<typeof ShotInput>;

function buildShotInstruction(data: ShotInputType, styleSpec: VisualStyleSpec): string {
  const charRefs = data.characterImageUrls.length
    ? data.characterImageUrls
        .map((_, i) => `图${i + 1} = 「${data.characterNames[i] || `角色${i + 1}`}」`)
        .join(", ")
    : "";
  const sceneRef = data.sceneImageUrl
    ? `图${data.characterImageUrls.length + 1} = 场景(${data.sceneLocation || "当前场景"}${data.sceneTimeOfDay ? " / " + data.sceneTimeOfDay : ""})`
    : "";

  return [
    `[任务] 生成一张「${data.shotTypeLabel}」分镜图,严格按下面的融合规则。`,
    ``,
    `[剧情上下文] ${data.plotText}`,
    `[本镜头] ${data.shotType} ${data.shotTypeLabel} —— ${data.action}`,
    data.camera ? `[机位] ${data.camera}` : "",
    ``,
    `[参考图清单(严格按下面的对应关系使用)]`,
    charRefs,
    sceneRef,
    ``,
    `[融合规则]`,
    data.characterImageUrls.length
      ? `1. 图1..N 是角色形象参考,这些角色的脸/身材/衣服必须与参考图保持一致,不得替换、不得"换脸"。`
      : `1. 本镜头没有角色,纯场景。`,
    data.sceneImageUrl
      ? `2. 场景构图、空间布局、光照氛围请以场景参考图为准,本镜头发生在这个场景内。`
      : `2. 没有场景参考,根据剧情推断合理的环境。`,
    `3. 这是 ${data.shotTypeLabel} 镜头:`,
    data.shotType === "WS"
      ? `   - 远景:人物在画面中占比较小,环境占据画面主体;展示空间感、地理关系、整体氛围。`
      : data.shotType === "MS"
        ? `   - 中景:人物从膝盖以上,展示肢体语言和主要动作;既能看到人物也能看到周围环境。`
        : data.shotType === "CU"
          ? `   - 近景:人物胸部以上,重点是表情、眼神、情绪;环境退到背景。`
          : data.shotType === "ECU"
            ? `   - 特写:画面聚焦在某个细节(眼睛、嘴唇、手、道具),情绪张力最强。`
            : `   - 过肩:从某人肩膀后面拍另一人,常用于对话场景,有空间纵深。`,
    `4. 画面必须是单张分镜图,不能有面板分割、文字、标号。`,
    `5. 角色动作 / 表情 / 视线方向严格按本镜头的"${data.action}"执行。`,
    `6. 固定机位,画面构图稳定平衡。`,
    ``,
    buildStyleLock(styleSpec, "panel"),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildShotNegative(): string {
  return [
    "different art style, style drift, photorealistic when input is anime, anime when input is realistic, different medium, different line treatment, different color grading",
    "multiple panels, panel, grid, storyboard template, before/after, comparison, text, watermark, logo, signature, label, caption, annotation, arrow, callout",
    "different face, different face shape, different eye shape, different eye color, different nose, different mouth, different eyebrows, different skin tone, different hairstyle, different hair color, different hair length, different outfit, different clothing color, different accessories, different age",
    "medium shot when shot type is full body, close-up when shot type is mid, headshot, bust, half body, cropped at feet, missing feet, missing legs",
    "extreme low angle, worm's eye view, hero shot, extreme dutch angle, fisheye, wide-angle distortion",
    "extra people, bystander, crowd, extra limbs, deformed hands, extra fingers, blurred face, low quality",
  ].join(", ");
}

export const generateStoryboardShotImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ShotInput.parse(d))
  .handler(async ({ data }) => {
    const { resolveProjectStyle } = await import("./visualStyles");
    const styleSpec = resolveProjectStyle(data.projectStyle);

    const images: string[] = [];
    data.characterImageUrls.forEach((url) => {
      if (url) images.push(url);
    });
    if (data.sceneImageUrl) images.push(data.sceneImageUrl);

    if (!images.length) {
      return { ok: false as const, error: "缺少参考图(至少需要一张角色图或场景图)" };
    }
    if (images.length > 10) {
      return {
        ok: false as const,
        error: `参考图过多(${images.length} 张,Seedream 最多 10 张)。请减少该分镜涉及的角色数。`,
      };
    }

    const instruction = buildShotInstruction(data, styleSpec);
    const negative = buildShotNegative();

    const requested = normalizeImageModelForRouting(data.model);
    // 委托给 Pixflow(gpt-image-2 / gemini 图像模型)。gpt-image-* 有参考图时
    // 在 pixflow.functions.ts 内部切到 /v1/images/edits,避免误走 ARK/Seedream。
    {
      const { isLovableGatewayImageModel, callLovableGatewayImage } =
        await import("./lovableImage.functions");
      if (isLovableGatewayImageModel(requested)) {
        const r = await callLovableGatewayImage({
          prompt: appendNegative(instruction, negative),
          model: requested,
          size: "2K",
          referenceImages: images,
        });
        if (!r.url) return { ok: false as const, error: r.error || "Lovable Gateway 未返回图片" };
        return { ok: true as const, url: r.url, model: r.model };
      }
    }
    if (requested.toLowerCase().startsWith("pixflow/")) {
      const { callPixflowImage } = await import("./pixflow.functions");
      const r = await callPixflowImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "Pixflow 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("claude360/")) {
      const { callClaude360Image } = await import("./claude360Image.functions");
      const r = await callClaude360Image({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "Claude360 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    // generateStoryboardShotImage: 委托给 Tokenflash(OpenAI 兼容,api.tokenflash.cn)
    if (requested.toLowerCase().startsWith("tokenflash/")) {
      const { callTokenflashImage } = await import("./tokenflash.functions");
      const r = await callTokenflashImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "Tokenflash 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("revora/")) {
      const { callRevoraImage } = await import("./revoraImage.functions");
      const r = await callRevoraImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "Revora 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("aigcfamily/")) {
      const { callAigcfamilyImage } = await import("./aigcfamilyImage.functions");
      const r = await callAigcfamilyImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "AIGCFamily 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }

    if (requested.toLowerCase().startsWith("shuci/")) {
      const { callShuanciyuanImage } = await import("./shuanciyuan.functions");
      const r = await callShuanciyuanImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "数安词源 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (
      requested.toLowerCase().startsWith("azure/") ||
      requested.toLowerCase().startsWith("azure2/")
    ) {
      const { callAzureImage } = await import("./azureImage.functions");
      const r = await callAzureImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "Azure 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model, meta: r.meta };
    }
    // generateStoryboardShotImage: 委托给 OneToken(OpenAI 兼容,api.onetoken.one)
    if (requested.toLowerCase().startsWith("onetoken/")) {
      const { callOnetokenImage } = await import("./onetokenImage.functions");
      const r = await callOnetokenImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
      });
      if (!r.url) return { ok: false as const, error: r.error || "OneToken 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    // generateStoryboardShotImage: 委托给 OTU(OpenAI 兼容)
    if (requested.toLowerCase().startsWith("otu/")) {
      const { callOtuImage } = await import("./otuImage.functions");
      const r = await callOtuImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "OTU 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("aitokenvibe/")) {
      const { callAitokenvibeImage } = await import("./aitokenvibeImage.functions");
      const r = await callAitokenvibeImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "AI Tokenvibe 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("thhtcloud/")) {
      const { callThhtcloudImage } = await import("./thhtcloudImage.functions");
      const r = await callThhtcloudImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "天鸿智算 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("ailinzi/")) {
      const { callAilinziImage } = await import("./ailinziImage.functions");
      const r = await callAilinziImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "ailinzi 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("vapeur/")) {
      const { callVapeurImage } = await import("./vapeurImage.functions");
      const r = await callVapeurImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "vapeur 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("tokenhub/")) {
      const { callTokenhubImage } = await import("./tokenhubImage.functions");
      const r = await callTokenhubImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "tokenhub 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("nagora/")) {
      const { callNagoraImage } = await import("./nagoraImage.functions");
      const r = await callNagoraImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "nagora 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("meridian/")) {
      const { callMeridianImage } = await import("./meridianImage.functions");
      const r = await callMeridianImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "meridian 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    // generateStoryboardShotImage: 委托给 legacy(Qwen / Wan / OpenRouter 等)
    if (
      requested &&
      !isSeedreamModel(requested) &&
      !requested.toLowerCase().startsWith("lovable/")
    ) {
      const { generateImage: legacy } = await import("./openrouterImage.functions");
      const r: any = await legacy({
        data: {
          prompt: appendNegative(instruction, negative),
          model: requested,
          size: "1328*1328",
          negativePrompt: negative,
        },
      } as any);
      if (!r?.url) return { ok: false as const, error: r?.error || "Legacy 模型未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }

    const { apiKey, baseUrl, model: defaultModel } = getArkConfig();
    if (!apiKey) return { ok: false as const, error: "ARK_API_KEY not configured" };
    const model = requested || defaultModel;
    const prompt = appendNegative(instruction, negative);

    // 2026/06:查看提示词模式
    if (data.previewOnly) {
      return {
        ok: true as const,
        previewPrompt: prompt,
        negativePrompt: negative,
        promptSize: "2K",
        promptExtra: { model, route: "I2I 分镜图", refImages: images.join(" / ") },
      } as any;
    }

    const result = await callSeedreamImages(
      { model, prompt, image: images, size: "2K", output_format: "png", watermark: false },
      apiKey,
      baseUrl,
      I2I_TIMEOUT_MS,
    );
    if (!result.url) {
      if (/401/i.test(result.error || ""))
        return { ok: false as const, error: "Seedream auth failed (401)" };
      if (/402/i.test(result.error || "")) return { ok: false as const, error: "no_credits" };
      if (/timed out/i.test(result.error || ""))
        return { ok: false as const, error: "AI 处理超时(>180s)" };
      return { ok: false as const, error: result.error || "Seedream 未返回图片" };
    }
    return { ok: true as const, url: result.url, model: result.model };
  });

// ====================================================================
// 4) regenerateStoryboardShot —— 多图融合 I2I(分镜按意见重生)
//
//   图 1 永远是 referenceImageUrl(当前镜头),后面是角色/场景参考。
//   Seedream 一次最多 10 张,这里守住 3 张(给 ref + 1 char + 1 scene)或
//   ref + 2 char,跟老代码逻辑一致。
// ====================================================================

const RegenShotInput = ShotInput.extend({
  referenceImageUrl: z.string().url(),
  userInstruction: z.string().min(1).max(500),
});

export type RegenShotInputType = z.infer<typeof RegenShotInput>;

function buildRegenShotInstruction(
  data: RegenShotInputType,
  styleSpec: VisualStyleSpec,
  usedCharCount: number,
  hasScene: boolean,
): string {
  const charRefs =
    usedCharCount > 0
      ? usedCharCount === 1
        ? `图2 = 「${data.characterNames[0] || "角色"}」(脸/衣服锁定)`
        : `图2..${1 + usedCharCount} = ${usedCharCount} 个角色(脸/衣服锁定)`
      : "";
  const sceneRef = hasScene
    ? `图${1 + usedCharCount + 1} = 场景(${data.sceneLocation || "当前场景"}${data.sceneTimeOfDay ? " / " + data.sceneTimeOfDay : ""})`
    : "";

  return [
    `[任务] 修改「图1」(当前分镜镜头),严格按下面的"修改意见"调整,只改用户提到的部分。`,
    ``,
    `[修改意见] ${data.userInstruction}`,
    ``,
    `[剧情上下文] ${data.plotText}`,
    `[本镜头] ${data.shotType} ${data.shotTypeLabel} —— ${data.action}`,
    data.camera ? `[机位] ${data.camera}` : "",
    ``,
    `[参考图清单(严格按下面的对应关系使用)]`,
    `图1 = 当前分镜镜头(要被修改的)`,
    charRefs,
    sceneRef,
    ``,
    `[修改规则 — 必须遵守]`,
    `1. 以图1为基础,在它的构图 / 景别 / 风格上修改,**不要重新构图或换景别**。`,
    `2. 只调整"修改意见"里明确提到的元素;没提到的部分(角色脸/衣服、场景、构图、视角、风格)全部保留图1的样子。`,
    `3. ${usedCharCount > 0 ? `图 2..N 的角色是参考,他们的脸/身材/衣服必须跟图1 一致(不能换脸)。` : "本镜头没有角色参考,只改场景/构图相关的部分。"}`,
    hasScene
      ? `4. 场景构图 / 光照沿用图1 当前的样子(场景参考图只是兜底,跟图1 冲突时以图1 为准)。`
      : "",
    `5. 保持单张分镜图,不能有面板分割、文字、标号。`,
    ``,
    buildStyleLock(styleSpec, "panel"),
  ]
    .filter(Boolean)
    .join("\n");
}

export const regenerateStoryboardShot = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => RegenShotInput.parse(d))
  .handler(async ({ data }) => {
    const { resolveProjectStyle } = await import("./visualStyles");
    const styleSpec = resolveProjectStyle(data.projectStyle);

    // 图 1 永远是 referenceImageUrl,后面再塞角色/场景参考。
    // Seedream 限 10 张,跟老代码一致守住 3 张上限。
    const hasScene = !!data.sceneImageUrl;
    const maxChars = Math.max(0, 3 - 1 - (hasScene ? 1 : 0));
    const usedCharCount = Math.min(data.characterImageUrls.length, maxChars);
    const images: string[] = [data.referenceImageUrl];
    for (let i = 0; i < usedCharCount; i++) {
      const url = data.characterImageUrls[i];
      if (url) images.push(url);
    }
    if (hasScene) images.push(data.sceneImageUrl!);

    if (images.length > 10) {
      return { ok: false as const, error: `参考图过多(${images.length} 张,Seedream 最多 10 张)。` };
    }

    const instruction = buildRegenShotInstruction(data, styleSpec, usedCharCount, hasScene);
    const negative = buildShotNegative();

    const requested = normalizeImageModelForRouting(data.model);
    {
      const { isLovableGatewayImageModel, callLovableGatewayImage } =
        await import("./lovableImage.functions");
      if (isLovableGatewayImageModel(requested)) {
        const r = await callLovableGatewayImage({
          prompt: appendNegative(instruction, negative),
          model: requested,
          size: "2K",
          referenceImages: images,
        });
        if (!r.url) return { ok: false as const, error: r.error || "Lovable Gateway 未返回图片" };
        return { ok: true as const, url: r.url, model: r.model };
      }
    }
    if (requested.toLowerCase().startsWith("pixflow/")) {
      const { callPixflowImage } = await import("./pixflow.functions");
      const r = await callPixflowImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "Pixflow 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("claude360/")) {
      const { callClaude360Image } = await import("./claude360Image.functions");
      const r = await callClaude360Image({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "Claude360 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("tokenflash/")) {
      const { callTokenflashImage } = await import("./tokenflash.functions");
      const r = await callTokenflashImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "Tokenflash 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("revora/")) {
      const { callRevoraImage } = await import("./revoraImage.functions");
      const r = await callRevoraImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "Revora 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("aigcfamily/")) {
      const { callAigcfamilyImage } = await import("./aigcfamilyImage.functions");
      const r = await callAigcfamilyImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "AIGCFamily 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }

    if (requested.toLowerCase().startsWith("shuci/")) {
      const { callShuanciyuanImage } = await import("./shuanciyuan.functions");
      const r = await callShuanciyuanImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "数安词源 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (
      requested.toLowerCase().startsWith("azure/") ||
      requested.toLowerCase().startsWith("azure2/")
    ) {
      const { callAzureImage } = await import("./azureImage.functions");
      const r = await callAzureImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "Azure 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model, meta: r.meta };
    }
    if (requested.toLowerCase().startsWith("onetoken/")) {
      const { callOnetokenImage } = await import("./onetokenImage.functions");
      const r = await callOnetokenImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
      });
      if (!r.url) return { ok: false as const, error: r.error || "OneToken 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("otu/")) {
      const { callOtuImage } = await import("./otuImage.functions");
      const r = await callOtuImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "OTU 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("aitokenvibe/")) {
      const { callAitokenvibeImage } = await import("./aitokenvibeImage.functions");
      const r = await callAitokenvibeImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "AI Tokenvibe 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("thhtcloud/")) {
      const { callThhtcloudImage } = await import("./thhtcloudImage.functions");
      const r = await callThhtcloudImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "天鸿智算 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("ailinzi/")) {
      const { callAilinziImage } = await import("./ailinziImage.functions");
      const r = await callAilinziImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "ailinzi 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("vapeur/")) {
      const { callVapeurImage } = await import("./vapeurImage.functions");
      const r = await callVapeurImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "vapeur 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("tokenhub/")) {
      const { callTokenhubImage } = await import("./tokenhubImage.functions");
      const r = await callTokenhubImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "tokenhub 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("nagora/")) {
      const { callNagoraImage } = await import("./nagoraImage.functions");
      const r = await callNagoraImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "nagora 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("meridian/")) {
      const { callMeridianImage } = await import("./meridianImage.functions");
      const r = await callMeridianImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: "2K",
        referenceImages: images,
      });
      if (!r.url) return { ok: false as const, error: r.error || "meridian 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested && !isSeedreamModel(requested)) {
      const { generateImage: legacy } = await import("./openrouterImage.functions");
      const r: any = await legacy({
        data: {
          prompt: appendNegative(instruction, negative),
          model: requested,
          size: "1328*1328",
          negativePrompt: negative,
        },
      } as any);
      if (!r?.url) return { ok: false as const, error: r?.error || "Legacy 模型未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }

    const { apiKey, baseUrl, model: defaultModel } = getArkConfig();
    if (!apiKey) return { ok: false as const, error: "ARK_API_KEY not configured" };
    const model = requested || defaultModel;
    const prompt = appendNegative(instruction, negative);

    // 2026/06:查看提示词模式
    if (data.previewOnly) {
      return {
        ok: true as const,
        previewPrompt: prompt,
        negativePrompt: negative,
        promptSize: "2K",
        promptExtra: {
          model,
          route: "I2I 分镜重生",
          userInstruction: data.userInstruction,
          refImages: images.join(" / "),
        },
      } as any;
    }

    const result = await callSeedreamImages(
      { model, prompt, image: images, size: "2K", output_format: "png", watermark: false },
      apiKey,
      baseUrl,
      I2I_TIMEOUT_MS,
    );
    if (!result.url) {
      if (/401/i.test(result.error || ""))
        return { ok: false as const, error: "Seedream auth failed (401)" };
      if (/402/i.test(result.error || "")) return { ok: false as const, error: "no_credits" };
      if (/timed out/i.test(result.error || ""))
        return { ok: false as const, error: "AI 处理超时(>180s)" };
      return { ok: false as const, error: result.error || "Seedream 未返回图片" };
    }
    return { ok: true as const, url: result.url, model: result.model };
  });

// ====================================================================
// 5) generateStoryboardPitchDeck —— 漫剧故事板(Manga-Style Storyboard)
//
//   2026 用户重做:从"7 段式 Pitch Deck"改成"漫剧多格分镜"风格。
//   整张图就是一个 manga / 漫剧 page,纯 6 格(2x3)或 8 格(2x4)分镜网格:
//     - 每格 = 1 个 shot 的首帧画面 + 动态变化指示(motion lines / 速度线 / 动作箭头)
//     - 每格顶部预留 caption box(给后续标注台词 / 旁白,实际为空)
//     - 剧情从左到右、从上到下递进,无文字也能读懂故事
//     - 排版干净,格间留白(gutter),高清画质(2K)
//
//   数据来源(全 T2I,不走 image 字段,让模型在 prompt 引导下画完所有格子):
//     - plotText            分镜组剧情摘要(模型用来推断缺失的 shot + 整体叙事)
//     - scene / characters  场景 + 角色档案(face/body/clothing,跨格一致)
//     - shots               已有的 1-3 个 shot(模型补到 6 或 8 格)
//
//   输出 2K(2048x2048)。用户提到"8K"但 Seedream 最大 4K,2K 平衡
//   清晰度与生成时间/费用。
// ====================================================================

const PitchDeckCharacterSchema = z.object({
  name: z.string().min(1).max(100),
  roleLabel: z.string().max(200).optional(),
  age: z.number().int().min(0).max(200).optional(),
  faceDescription: z.string().max(2000).optional(),
  bodyDescription: z.string().max(2000).optional(),
  clothingDescription: z.string().max(2000).optional(),
  palette: z.array(z.string()).max(8).optional(),
});

const PitchDeckShotSchema = z.object({
  shotType: z.enum(["WS", "MS", "CU", "ECU", "OTS"]),
  shotTypeLabel: z.string().min(1).max(20),
  action: z.string().min(1).max(400),
  camera: z.string().max(200).default(""),
  cameraMovement: z.string().max(300).optional(),
  characterBlocking: z.string().max(400).optional(),
  durationSec: z.number().optional(),
  // 2026/06 新增:用户要求每帧标注时长,把 shot 自身的时间区间也传过来
  startSec: z.number().optional(),
  endSec: z.number().optional(),
});

const PitchDeckInput = z.object({
  projectStyle: z.string().max(50).optional(),
  groupLabel: z.string().max(200).optional(),
  plotText: z.string().min(1).max(2000),
  scene: z
    .object({
      slug: z.string().max(200).optional(),
      location: z.string().max(200).optional(),
      timeOfDay: z.string().max(50).optional(),
      profile: z.string().max(2000).optional(),
    })
    .optional(),
  // 2026/06:之前 .max(3) 偷偷砍数据 —— 大场面组 4-6 角色会被丢一半。
  // 文字描述无 token 压力,放到 8;图片层面另有 .max(10) 上限(下面)
  characters: z.array(PitchDeckCharacterSchema).max(8).default([]),
  // 2026/06:之前 .max(3) 配合 normalizeGroup 的 .slice(0, 3)。后者已撤,
  // 这里也放到 20,避免 Zod 直接 reject 整个故事板请求
  shots: z.array(PitchDeckShotSchema).max(20).default([]),
  // 2026/06:故事板 I2I 参考图 —— 用户反映"故事板不按我设定的人物形象/场景画"。
  // 根因是之前不传 image 字段,纯 T2I。改成传入参考图(场景至少 1 张 + 角色若干)。
  // 客户端按 "场景必占 1 张,剩余给角色" 的优先级挑出最多 10 张(Seedream 上限),
  // 每张配一个 label,在 prompt 里说明"图 N 是 X"。
  referenceImages: z.array(z.string().url()).max(10).default([]),
  referenceImageLabels: z.array(z.string().max(120)).max(10).default([]),
  // 老字段保留向后兼容,不再实际使用
  characterImageUrl: z.string().url().optional(),
  sceneImageUrl: z.string().url().optional(),
  model: z.string().max(100).optional(),
  // 2026/06:查看提示词模式
  previewOnly: z.boolean().default(false),
});

export type PitchDeckInputType = z.infer<typeof PitchDeckInput>;

/**
 * 把分镜数据翻译成"漫剧故事板"多格分镜 prompt。
 *
 * 设计思路(2026/06 用户重做 —— 从"固定 6/8 格 + 顶部 caption"改成
 * "可变 4-10 格 + 每格首帧 + 首帧下方画面变化描述 + 右下角虚线 caption 框"):
 *   1) 整张图就是一个 manga/漫剧 page,分格数量自适应(根据情节密度 4-10)
 *   2) 每格 = 1 个 shot:
 *      - 主图区:首帧画面(用已提供的人物形象,脸/身/服/饰一致)
 *      - 主图下方:1-2 行小字,描述"相对于上一格的画面变化"(镜头推近 /
 *        角色由站转坐 / 光照亮转暗 等)
 *      - 右下角或底部右侧:虚线框 / 浅色底区域,内含占位文字
 *        `[音效/台词/转场]`,留给后期填充
 *   3) 剧情严格递进:每一格必须比上一格推进剧情,禁止重复角度或静态对话
 *   4) 9:16 / 4:5 竖屏比例,适合手机阅读
 *   5) 排版整齐、格间留白一致、高清
 *   6) 角色在所有格子里保持一致(脸/身材/服装/配饰)
 *   7) 风格锁到项目视觉风格
 */
function buildPitchDeckPrompt(opts: {
  data: PitchDeckInputType;
  styleSpec: { label: string; positive: string; negative: string };
}): string {
  const { data, styleSpec } = opts;
  const chars = data.characters || [];
  const shots = data.shots || [];
  const shotCount = shots.length;
  const SUGGESTED_PANELS = Math.min(10, Math.max(4, shotCount || 6));

  const refImgs = data.referenceImages || [];
  const refLabels = data.referenceImageLabels || [];
  const referenceImageBlock = refImgs.length
    ? [
        `[REFERENCE IMAGES — ${refImgs.length} 张视觉锚点,用于人物/场景身份锁定]`,
        ...refImgs.map((_, i) => `  Image ${i + 1}: ${refLabels[i] ?? "(no label)"}`),
        ``,
        `【身份锁定】同一角色在所有镜头中必须保持完全一致的面部特征、发型、体型、服装款式细节。参考图用于锁定"是谁"——脸型、五官比例、发型轮廓、身材比例、服装款式。`,
        `【风格转化】参考图是彩色/渲染图,但本故事板要求纯铅笔线稿。请将参考图人物转化为铅笔素描表达:提取轮廓线、结构线、服装褶皱线,忽略参考图的色彩、光影、材质渲染。不要因为参考图是彩色就在素描里加灰阶阴影渲染。`,
      ].join("\n")
    : "";

  const shotLines = shots
    .map((s, i) => {
      const cam = s.camera ? ` | camera: ${s.camera}` : "";
      const camMov = s.cameraMovement ? ` | camMovement: ${s.cameraMovement}` : "";
      const blocking = s.characterBlocking ? ` | blocking: ${s.characterBlocking}` : "";
      const dur =
        s.startSec != null && s.endSec != null
          ? ` | ${s.startSec.toFixed(0)}-${s.endSec.toFixed(0)}s (${(s.endSec - s.startSec).toFixed(0)}s)`
          : s.durationSec
            ? ` | duration: ${s.durationSec}s`
            : "";
      return `  Frame ${i + 1}: [${s.shotTypeLabel}] ${s.action}${cam}${camMov}${blocking}${dur}`;
    })
    .join("\n");

  const CHAR_DESC_MAX = 300;
  const charLines = chars
    .map((c, i) => {
      const role = c.roleLabel ? ` (${c.roleLabel}` : "";
      const age = c.age !== undefined ? `, age ${c.age}` : "";
      return [
        `  Character ${i + 1}: ${c.name}${role ? role : ""}${age ? age : ""}${c.roleLabel ? ")" : ""}`,
        c.faceDescription ? `    Face: ${c.faceDescription.slice(0, CHAR_DESC_MAX)}` : "",
        c.bodyDescription ? `    Body: ${c.bodyDescription.slice(0, CHAR_DESC_MAX)}` : "",
        c.clothingDescription ? `    Outfit: ${c.clothingDescription.slice(0, CHAR_DESC_MAX)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const sceneLine = data.scene
    ? [
        data.scene.location ? `  Location: ${data.scene.location}` : "",
        data.scene.timeOfDay ? `  Time: ${data.scene.timeOfDay}` : "",
        data.scene.profile ? `  Description: ${data.scene.profile.slice(0, 500)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "  (no specific scene)";

  return [
    `[MISSION] Create a professional FILM STORYBOARD in pure PENCIL LINE-ART / SKETCH style. ONE single 16:9 landscape image. The entire board must look like a hand-drawn storyboard by a professional film pre-production artist — pencil on paper, clean lines, no color, no cel-shading, no 3D render, no watercolor.`,
    `[ASPECT RATIO] Strictly 16:9 LANDSCAPE.`,

    `[LINE ART STYLE — strict, no exceptions]`,
    `- Pure pencil sketch / line-art style throughout. NO color rendering, NO photo-realism, NO watercolor, NO cel-shading, NO 3D rendering, NO oil painting, NO anime style.`,
    `- Lines must be clean, confident, with varying thickness (thicker contour lines, thinner detail lines).`,
    `- Shadows rendered with hatching / cross-hatching (parallel lines), NO smudging, NO gradients, NO airbrush.`,
    `- Characters drawn in realistic proportions (NOT chibi, NOT cartoon exaggerated).`,
    `- Backgrounds use simple lines to convey spatial relationships — no excessive detail.`,
    `- The overall feel: a professional storyboard artist's hand-drawn pencil board for film/TV pre-production.`,

    `[OVERALL LAYOUT — all on ONE page, 16:9 landscape]`,
    `Top area: title bar showing episode/group info and shot count (${SUGGESTED_PANELS} frames).`,
    `Main area: a grid of storyboard frames arranged left-to-right, top-to-bottom. Each frame is a pencil-sketch thumbnail of the corresponding shot.`,
    `Below each frame: a small caption strip with shot number, duration, and brief action note in clean handwritten-style text.`,
    `Bottom-right or side area: a small top-down scene layout diagram in simple linework showing character positions, movement arrows, and camera positions.`,

    `[STORYBOARD FRAMES — main content, most prominent]`,
    `A grid of ${SUGGESTED_PANELS} frames (adjust to fit layout). Each frame:`,
    `  • A pencil line-art thumbnail of the shot scene — characters, background, composition all in sketch style`,
    `  • Shot number clearly labeled (镜头 1, 镜头 2, ...)`,
    `  • Below the thumbnail: brief tags — duration, shot type, action — in small readable text`,
    `  • Frames are separated by thin clean borders / gutters`,

    `[CHARACTER CONSISTENCY — critical]`,
    `- Same character across ALL frames must have identical face features, hairstyle, body proportion, and clothing details.`,
    `- Adjacent frames must have visual continuity: action flow, line of sight, spatial logic.`,
    `- No character drift between frames — they must look like the same person drawn from different angles.`,

    `[TOP-DOWN DIAGRAM — mandatory, bottom-right area, at least 20% of page]`,
    `A clean overhead/floor-plan view of the scene in pencil linework. This diagram MUST follow these EXACT rules:`,
    ``,
    `【CAMERA MOVEMENT — SOLID lines + ARROWHEADS + SEQUENCE NUMBERS】`,
    `  • Each camera position is drawn as a 📷 icon`,
    `  • Camera positions are numbered in shooting order: ①, ②, ③ ...`,
    `  • Camera positions are connected by SOLID lines with ARROWHEADS (──▶)`,
    `  • The arrow direction MUST match the shot sequence (① ──▶ ② ──▶ ③)`,
    `  • Below each 📷, write the shot type label (WS/MS/CU/ECU/OTS) in small text`,
    `  • Draw a light V-shaped FOV cone from each 📷 to show the field of view`,
    ``,
    `【CHARACTER MOVEMENT — DASHED lines only】`,
    `  • Character starting position: hollow circle (○) with character name label`,
    `  • Character ending position: filled circle (●)`,
    `  • Movement path: DASHED line with arrowhead (- - -▶) connecting ○ → ●`,
    `  • Different characters = different dash density (sparse vs dense) + name labels`,
    `  • A character that does NOT move: single ● at their fixed position, NO line`,
    ``,
    `【LEGEND BOX (small, in corner of diagram)】`,
    `  ──▶  = Camera Movement (机位动线)`,
    `  - - -▶ = Character Movement (人物动线)`,
    ``,
    `【SELF-CHECK before output】`,
    `  • Arrow directions match the shot sequence (1→2→3), no reversed arrows`,
    `  • Character start/end positions match the blocking descriptions in [SHOT BREAKDOWN]`,
    `  • Number of 📷 = number of shots in this group`,
    `  • Solid lines = camera only, dashed lines = character only, never swapped`,

    referenceImageBlock,

    `[STORY PLOT]`,
    data.plotText,

    `[SCENE]`,
    sceneLine,

    `[CHARACTERS]`,
    charLines || "  (no specific characters)",

    `[SHOT BREAKDOWN]`,
    shotLines || `  (derive from plot)`,

    `[QUALITY RULES]`,
    `RULE 1 — PENCIL LINE-ART ONLY: No color, no rendering beyond hatching/cross-hatching. Pure sketch style.`,
    `RULE 2 — 16:9 LANDSCAPE: Strictly horizontal. No 9:16, no 1:1.`,
    `RULE 3 — CHARACTER LOCK: Same character = same face/body/clothes across all frames. No identity drift.`,
    `RULE 4 — STORY FAITHFULNESS: Frames strictly follow [STORY PLOT] and [SHOT BREAKDOWN]. No invented plots or characters.`,
    `RULE 5 — FRAME COUNT: ${SUGGESTED_PANELS} frames, one per shot.`,
    `RULE 6 — CLEAN SKETCH LINES: Confident strokes, varying line weight, hatching for shadows. No messy scribbles.`,
    `RULE 7 — READABLE TEXT: Captions must be legible. Short tags only (shot number, duration, action).`,

    `Begin. Output a 16:9 pencil line-art storyboard with ${SUGGESTED_PANELS} frames. Pure sketch style, no color.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const generateStoryboardPitchDeck = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => PitchDeckInput.parse(d))
  .handler(async ({ data }) => {
    const { resolveProjectStyle } = await import("./visualStyles");
    const styleSpec = resolveProjectStyle(data.projectStyle);
    // 2026/06:加 negative prompt 主攻 "文字乱码 / 文字模糊 / 伪手写"等
    // 文字渲染常见问题,呼应 prompt 里 RULE 3(文字最高优先级)。
    // **2026/06 二次强化**:加画风漂移 negative,防故事板插画跟参考图画风不一致
    const negative = [
      "garbled text, fake characters, pseudo Chinese, jumbled glyphs, broken strokes, illegible labels, blurry text, smeared text, distorted text, unreadable captions, mismatched font widths, comic font, decorative font, handwritten scribble",
      "color, colored rendering, full color, cel-shading, watercolor, oil painting, airbrush, gradient, photorealistic, 3D render, CGI, anime style, digital painting, thick paint, impasto, gouache, pastel, marker rendering, digital art",
      "cluttered layout, overlapping sections, missing dividers, off-grid placement, no white space, busy decorative borders, ornate frames, gold filigree",
      "wrong aspect ratio, vertical 9:16, square 1:1, 4:3, portrait orientation",
      "extra characters not in [CHARACTERS], scenery not in [SCENE], invented plot, frames unrelated to [SHOT BREAKDOWN]",
      "low resolution, blurry, pixelated, JPEG artifacts, low quality, soft focus",
      "missing top-down diagram, diagram without solid camera movement arrows, diagram without dashed character movement lines, camera positions without sequence numbers ①②③, character positions without start/end circles ○●, diagram without legend box, character movement drawn as solid line instead of dashed, camera movement drawn as dashed line instead of solid, movement paths without arrowheads, camera FOV cone missing, diagram too small to read labels, unlabeled camera positions, camera positions not in sequential order, character movement not shown in diagram",
      "frames without duration label, frames without shot number, frames without motion tag, frames without camera tag",
      // 画风漂移 / 不继承参考图
      "art style drift from reference images, inconsistent rendering across sections, anime when reference is realistic, realistic when reference is anime, cel-shading when reference is painterly, 3D render when reference is 2D, watercolor when reference is digital illustration, different line treatment from reference, different color saturation from reference, different shading style from reference, mixed art styles, inconsistent brush strokes between frames, mixing 2D and 3D, mixing photoreal and stylized",
    ].join(", ");
    const prompt = appendNegative(buildPitchDeckPrompt({ data, styleSpec }), negative);

    const requested = normalizeImageModelForRouting(data.model);
    if (requested.toLowerCase().startsWith("pixflow/")) {
      const { callPixflowImage } = await import("./pixflow.functions");
      const r = await callPixflowImage({
        prompt,
        model: requested,
        size: "3840x2160",
        referenceImages: data.referenceImages || [],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "Pixflow 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("claude360/")) {
      const { callClaude360Image } = await import("./claude360Image.functions");
      const r = await callClaude360Image({
        prompt,
        model: requested,
        size: "3840x2160",
        referenceImages: data.referenceImages || [],
      });
      if (!r.url) return { ok: false as const, error: r.error || "Claude360 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("tokenflash/")) {
      const { callTokenflashImage } = await import("./tokenflash.functions");
      const r = await callTokenflashImage({
        prompt,
        model: requested,
        size: "3840x2160",
        referenceImages: data.referenceImages || [],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "Tokenflash 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("revora/")) {
      const { callRevoraImage } = await import("./revoraImage.functions");
      const r = await callRevoraImage({
        prompt,
        model: requested,
        size: "3840x2160",
        referenceImages: data.referenceImages || [],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "Revora 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("aigcfamily/")) {
      const { callAigcfamilyImage } = await import("./aigcfamilyImage.functions");
      const r = await callAigcfamilyImage({
        prompt,
        model: requested,
        size: "3840x2160",
        referenceImages: data.referenceImages || [],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "AIGCFamily 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }

    if (requested.toLowerCase().startsWith("shuci/")) {
      const { callShuanciyuanImage } = await import("./shuanciyuan.functions");
      const r = await callShuanciyuanImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "数安词源 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (
      requested.toLowerCase().startsWith("azure/") ||
      requested.toLowerCase().startsWith("azure2/")
    ) {
      const { callAzureImage } = await import("./azureImage.functions");
      const r = await callAzureImage({
        prompt,
        model: requested,
        size: "3840x2160",
        referenceImages: data.referenceImages || [],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "Azure 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model, meta: r.meta };
    }
    if (requested.toLowerCase().startsWith("onetoken/")) {
      const { callOnetokenImage } = await import("./onetokenImage.functions");
      const r = await callOnetokenImage({
        prompt,
        model: requested,
        size: "3840x2160",
      });
      if (!r.url) return { ok: false as const, error: r.error || "OneToken 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("otu/")) {
      const { callOtuImage } = await import("./otuImage.functions");
      const r = await callOtuImage({
        prompt,
        model: requested,
        size: "3840x2160",
        referenceImages: data.referenceImages || [],
      });
      if (!r.url) return { ok: false as const, error: r.error || "OTU 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("aitokenvibe/")) {
      const { callAitokenvibeImage } = await import("./aitokenvibeImage.functions");
      const r = await callAitokenvibeImage({
        prompt,
        model: requested,
        size: "3840x2160",
        referenceImages: data.referenceImages || [],
      });
      if (!r.url) return { ok: false as const, error: r.error || "AI Tokenvibe 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("thhtcloud/")) {
      const { callThhtcloudImage } = await import("./thhtcloudImage.functions");
      const r = await callThhtcloudImage({
        prompt,
        model: requested,
        size: "3840x2160",
        referenceImages: data.referenceImages || [],
      });
      if (!r.url) return { ok: false as const, error: r.error || "天鸿智算 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("ailinzi/")) {
      const { callAilinziImage } = await import("./ailinziImage.functions");
      const r = await callAilinziImage({
        prompt,
        model: requested,
        size: "3840x2160",
        referenceImages: data.referenceImages || [],
      });
      if (!r.url) return { ok: false as const, error: r.error || "ailinzi 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("vapeur/")) {
      const { callVapeurImage } = await import("./vapeurImage.functions");
      const r = await callVapeurImage({
        prompt,
        model: requested,
        size: "3840x2160",
        referenceImages: data.referenceImages || [],
      });
      if (!r.url) return { ok: false as const, error: r.error || "vapeur 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("tokenhub/")) {
      const { callTokenhubImage } = await import("./tokenhubImage.functions");
      const r = await callTokenhubImage({
        prompt,
        model: requested,
        size: "3840x2160",
        referenceImages: data.referenceImages || [],
      });
      if (!r.url) return { ok: false as const, error: r.error || "tokenhub 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("nagora/")) {
      const { callNagoraImage } = await import("./nagoraImage.functions");
      const r = await callNagoraImage({
        prompt,
        model: requested,
        size: "3840x2160",
        referenceImages: data.referenceImages || [],
      });
      if (!r.url) return { ok: false as const, error: r.error || "nagora 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("meridian/")) {
      const { callMeridianImage } = await import("./meridianImage.functions");
      const r = await callMeridianImage({
        prompt,
        model: requested,
        size: "3840x2160",
        referenceImages: data.referenceImages || [],
      });
      if (!r.url) return { ok: false as const, error: r.error || "meridian 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }

    const { apiKey, baseUrl, model: defaultModel } = getArkConfig();
    if (!apiKey) return { ok: false as const, error: "ARK_API_KEY not configured" };
    const model = requested || defaultModel;

    // 2026/06:查看提示词模式 —— 跳过实际生成
    if (data.previewOnly) {
      return {
        ok: true as const,
        previewPrompt: prompt,
        negativePrompt: negative,
        promptSize: "3840x2160",
        promptExtra: {
          model,
          route: "故事板 (Pitch Deck)",
          refImages: (data.referenceImages || []).join(" / ") || "(none)",
          characters: (data.characters || []).map((c) => c.name).join(", ") || "(none)",
          shotCount: String((data.shots || []).length),
        },
      } as any;
    }

    // 2026/06 用户重写:从 9:16 竖屏漫剧分镜改成 16:9 横向导演预制作 pitch deck。
    // 起初 2560×1440 (3.69M pixels) 卡在 Seedream 最小像素门槛上;**2026/06 二次提升**
    // 到 **3840×2160** (16:9 4K, 8.29M pixels) —— 用户要求"文字可读性最高优先",
    // 高分辨率给中文文字 fidelity 留余量,小字/标签更不容易糊。
    //
    // 2026/06 三次改造:加 image 字段(场景 + 角色参考图,最多 10 张)。
    // 之前注释说"塞图会干扰 layout",实测不准 —— Seedream I2I 在多图 + 强 prompt
    // 引导下能正确把参考图融到 Section 2/3/5。客户端按"场景必占 1 张 +
    // 角色填剩余" 的顺序传 referenceImages,服务端透传到 image 字段。
    // 空数组时不传 image,退化回纯 T2I。
    const refImages = data.referenceImages || [];
    // 2026/07:服务端兜底 —— Seedream image 字段最多 4 张,base64 参考图过大
    // 会触发 API "too_big" 错误。客户端 REF_MAX=4 是第一道防线,这里守第二道。
    const MAX_REF_IMAGES = 4;
    if (refImages.length > MAX_REF_IMAGES) {
      return {
        ok: false as const,
        error: `参考图过多(${refImages.length} 张,最多 ${MAX_REF_IMAGES} 张)。请减少该组分镜的角色/场景数量。`,
      };
    }
    const result = await callSeedreamImages(
      {
        model,
        prompt,
        ...(refImages.length ? { image: refImages.length === 1 ? refImages[0] : refImages } : {}),
        size: "3840x2160",
        output_format: "png",
        watermark: false,
      },
      apiKey,
      baseUrl,
      I2I_TIMEOUT_MS,
    );
    if (!result.url) {
      if (/401/i.test(result.error || ""))
        return { ok: false as const, error: "Seedream auth failed (401)" };
      if (/402/i.test(result.error || "")) return { ok: false as const, error: "no_credits" };
      if (/timed out/i.test(result.error || ""))
        return { ok: false as const, error: "AI 处理超时(>180s),设定稿内容多,建议重试" };
      return { ok: false as const, error: result.error || "Seedream 未返回图片" };
    }
    return { ok: true as const, url: result.url, model: result.model };
  });

// ====================================================================
// 5b) regenerateStoryboardPitchDeck —— 故事板图按用户意见重生(2026/06 新增)
//
//   跟 regenerateStoryboardShot 语义对齐:用户对当前故事板图不满意,
//   输入"修改意见",AI 在保留 6-section 整体布局 / 字号层级 / 文字可读性
//   等结构的基础上,只改用户提到的部分(色板 / 标题文案 / 故事板帧内容
//   / 灯光情绪 / 关键词 等)。
//
//   **图像策略**(跟 regen 共享):
//     - 图 1 永远是 data.referenceImageUrl(当前故事板图,作为"画风 + 布局 +
//       文字位置 + section 比例"的真值)
//     - 图 2..N 是 data.referenceImages 里的角色/场景参考图,跟原 generate
//       路径同样的 10 张上限
//     - Seedream I2I 顺序 = [当前故事板, 场景, 角色1, 角色2]
//
//   **Prompt 策略**:
//     - 不复用 buildPitchDeckPrompt(那是首生成,模型自由构图)
//     - 改成"修改模式":以图1为底,只改用户提到的元素
//     - 仍然强制 6-section 布局 + 中文标题 + 字号层级(防止用户改完变成 4 格图)
//
//   **路由**:跟 generateStoryboardPitchDeck 保持完全一致(Seedream 主力,
//   Pixflow/Lovable 不支持 4K 8.3M pixels 故兜底走 Seedream)。
// ====================================================================

const RegeneratePitchDeckInput = PitchDeckInput.extend({
  referenceImageUrl: z.string().url(),
  userInstruction: z.string().min(1).max(500),
});

export type RegeneratePitchDeckInputType = z.infer<typeof RegeneratePitchDeckInput>;

function buildRegenPitchDeckPrompt(opts: {
  data: RegeneratePitchDeckInputType;
  styleSpec: VisualStyleSpec;
}): string {
  const { data, styleSpec } = opts;
  const chars = data.characters || [];
  const shots = data.shots || [];

  // 角色描述块(简化版,regen 主要靠参考图锁定)
  const charLines = chars.length
    ? chars
        .map(
          (c) =>
            `  · ${c.name}${c.roleLabel ? ` (${c.roleLabel})` : ""}: ${c.faceDescription || "(face from ref image)"}`,
        )
        .join("\n")
    : "  (no characters in this group)";

  const sceneLine = data.scene
    ? [
        data.scene.location ? `  Location: ${data.scene.location}` : "",
        data.scene.timeOfDay ? `  Time: ${data.scene.timeOfDay}` : "",
      ]
        .filter(Boolean)
        .join("\n") || "  (no scene info)"
    : "  (no specific scene)";

  return [
    // ========== 任务:在图 1 基础上按意见修改 ==========
    `[MISSION] You are MODIFYING an existing 16:9 director's pre-production guide (图1).`,
    `The user has feedback — apply ONLY the changes they describe. Preserve everything else from 图1: 6-section layout, section proportions, title hierarchy, character identities, scene environment, visual style.`,
    ``,
    `[USER FEEDBACK — the ONLY things to change]`,
    data.userInstruction,
    ``,
    `[CONTEXT — preserved unchanged from 图1]`,
    `Style: ${styleSpec.label} (${styleSpec.positive.slice(0, 80)}...)`,
    `Plot: ${data.plotText || "(no plot text)"}`,
    `Scene:`,
    sceneLine,
    `Characters (face/body must stay identical to 图1 unless user feedback says otherwise):`,
    charLines,
    `Shot count: ${shots.length} (do NOT change panel layout unless user feedback mentions it)`,
    ``,
    // ========== 6-SECTION 布局硬约束(防走样)==========
    `[LAYOUT — MUST PRESERVE]`,
    `1) Top strip · SHARED CREATIVE DIRECTION (~10% height)`,
    `2) Middle-left · CHARACTER & STYLE REFERENCE (~30% width)`,
    `3) Middle-center · ENVIRONMENT & SCENE DESIGN (~35% width)`,
    `4) Middle-right · LIGHTING/MOOD + MOOD KEYWORDS (~35% width)`,
    `5) Bottom · STORYBOARD FRAMES (full-width grid, ${shots.length} panels)`,
    `6) Bottom strip · AUDIO + CINEMATOGRAPHY NOTES (~12% height)`,
    `Each section has a LARGE Chinese title (with small English subtitle). Thin neutral dividers (#E8E8E8).`,
    ``,
    // ========== 文字可读性 ==========
    `[TEXT READABILITY — TOP PRIORITY]`,
    `- ALL Chinese text CRISP / SHARP / ACCURATE / READABLE. No garbled glyphs.`,
    `- Section titles, shot numbers, character angle labels MUST be visibly LARGE and BOLD.`,
    `- Each frame caption ≤ 1-2 short Chinese tags (e.g. "35mm 广角 · 跟拍 · 4s").`,
    `- High contrast: dark text on clean white / very light grey background.`,
    `- Clean printed font (思源宋体 / 思源黑体 / Noto Sans). NO decorative / pseudo-handwritten fonts.`,
    ``,
    // ========== 修改规则 ==========
    `[MODIFICATION RULES]`,
    `1. Treat 图1 as the structural source of truth — preserve its layout, proportions, fonts, color usage.`,
    `2. Apply ONLY what the user described in [USER FEEDBACK]. Everything else: identical to 图1.`,
    `3. If user feedback is vague ("好看点", "改改"), interpret MINIMALLY — small refinements only.`,
    `4. If user feedback contradicts 图1 layout (e.g. user says "改成 4 格"), DO follow user feedback but keep all other style consistency.`,
    `5. Do NOT change character faces / outfits / scene unless user feedback explicitly mentions them.`,
    `6. Do NOT introduce new characters, scenes, or styles that aren't in 图1 or in [CONTEXT].`,
    `7. Maintain the same aspect ratio (16:9) and section grid.`,
    `8. Same Shot count as listed in [CONTEXT], in same order.`,
    ``,
    // ========== 参考图风格转化说明(图1 是铅笔素描,图2..N 是彩色)==========
    `[REFERENCE IMAGES — 图 2..N are identity anchors only]`,
    `图 1 = 当前故事板(画风/布局/文字的真值,严格遵循)。`,
    `图 2..N = 角色/场景参考图(彩色),仅用于锁定人物身份——脸型、五官、发型、身材、服装款式。`,
    `【关键】图 2..N 的色彩和渲染风格不影响输出。输出必须保持图 1 的铅笔线稿风格。将图 2..N 的人物转化为与图 1 一致的铅笔素描表达——提取轮廓/结构/服装褶皱线,忽略参考图的色彩、光影、材质。`,
    ``,
    // ========== 风格指纹 ==========
    `[PROJECT VISUAL STYLE — must match 图1's rendered style]`,
    buildStyleLock(styleSpec, "deck"),
    ``,
    `[OUTPUT] Regenerate the entire 16:9 pre-production guide with the user's changes applied. One image, landscape.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export const regenerateStoryboardPitchDeck = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => RegeneratePitchDeckInput.parse(d))
  .handler(async ({ data }) => {
    const { resolveProjectStyle } = await import("./visualStyles");
    const styleSpec = resolveProjectStyle(data.projectStyle);

    const prompt = buildRegenPitchDeckPrompt({ data, styleSpec });

    // 图 1 = 当前故事板(图布局 / 风格 / 文字位置的真值),后面跟原 referenceImages
    // 里的角色/场景参考图 —— 跟原 generate 共享同样 10 张上限
    const images: string[] = [data.referenceImageUrl];
    const extraRefs = data.referenceImages || [];
    for (const url of extraRefs) {
      if (!url || url === data.referenceImageUrl) continue;
      if (images.length >= 4) break;
      images.push(url);
    }

    if (images.length > 4) {
      return { ok: false as const, error: `参考图过多(${images.length} 张,Seedream 最多 4 张)` };
    }

    // 路由:跟 generateStoryboardPitchDeck 完全对齐(Seedream 主力,
    // Pixflow/Lovable 不支持 4K 8.3M pixels 故跳过兜底)
    const requested = normalizeImageModelForRouting(data.model);
    if (requested && !isSeedreamModel(requested)) {
      return {
        ok: false as const,
        error: `故事板按意见重生目前只支持 Seedream 模型(用户选了 ${requested},Seedream 4K 是唯一能稳定输出 3840×2160 的)。`,
      };
    }

    const { apiKey, baseUrl, model: defaultModel } = getArkConfig();
    if (!apiKey) return { ok: false as const, error: "ARK_API_KEY not configured" };
    const model = requested || defaultModel;

    // 2026/06:查看提示词模式
    if (data.previewOnly) {
      return {
        ok: true as const,
        previewPrompt: prompt,
        negativePrompt: "",
        promptSize: "3840x2160",
        promptExtra: {
          model,
          route: "I2I 故事板按意见重生",
          userInstruction: data.userInstruction,
          refImages: images.join(" / "),
        },
      } as any;
    }

    const result = await callSeedreamImages(
      {
        model,
        prompt,
        image: images,
        size: "3840x2160",
        output_format: "png",
        watermark: false,
      },
      apiKey,
      baseUrl,
      I2I_TIMEOUT_MS,
    );
    if (!result.url) {
      if (/401/i.test(result.error || ""))
        return { ok: false as const, error: "Seedream auth failed (401)" };
      if (/402/i.test(result.error || "")) return { ok: false as const, error: "no_credits" };
      if (/timed out/i.test(result.error || ""))
        return { ok: false as const, error: "AI 处理超时(>180s)" };
      return { ok: false as const, error: result.error || "Seedream 未返回图片" };
    }
    return { ok: true as const, url: result.url, model: result.model };
  });

// ====================================================================
// 5) regenerateSceneImage —— 场景图按意见重生 / 场景三视图(2026/06 新增)
//
// 跟角色 regenerateCharacterLook 对称,但语义不同:
//   - 场景没有"脸/身材/服装"概念,也不需要 front/side/back 三视图
//   - 场景的"三视图"重新定义为 3 个景别变体:
//       · wide      = 远景 establishing shot(整场景全景,无人物)
//       · medium    = 中景(场景关键道具/中距离,氛围细节)
//       · close-up  = 近景/特写(局部纹理、招牌、天气细节、情绪氛围)
//
// 模式:
//   - 'modify'     : 用户给修改意见,在原场景图基础上改(构图/光照/地点保留)
//   - 'three-view' : 一次性输出 3 景别参考图(横向 3 面板)
//
// 风格锁:复用 buildStyleLock(styleSpec, 'scene'),跟 genSceneImage / 角色
// 重生 / 分镜 / 故事板保持同一段风格指纹。
// ====================================================================

const RegenerateSceneInput = z.object({
  referenceImageUrl: z.string().url(), // 当前场景主视图作 I2I anchor
  userInstruction: z.string().min(1).max(2000), // modify 模式必填;three-view 模式会被忽略
  sceneSlug: z.string().min(1).max(200), // e.g. "INT. CAFE - DAY"
  sceneLocation: z.string().max(200).default(""),
  sceneTimeOfDay: z.string().max(50).default(""),
  sceneAction: z.string().max(2000).default(""),
  projectStyle: z.string().max(50).optional(),
  model: z.string().max(100).optional(),
  mode: z.enum(["modify", "three-view", "directional-views"]).default("modify"),
  // 2026/06:查看提示词模式
  previewOnly: z.boolean().default(false),
});

export type RegenerateSceneInputType = z.infer<typeof RegenerateSceneInput>;

function buildScenePrompts(
  data: RegenerateSceneInputType,
  styleSpec: VisualStyleSpec,
): { positive: string; negative: string; size: string } {
  if (data.mode === "three-view") {
    // ----------------------------------------------------------------
    // 场景三视图(横向 3 面板,横向 3072x1280 ≈ 3.93M 像素,过 Seedream 最小门槛)
    // 语义:同一场景的 3 个景别变体,无人物,共用同一套构图 / 光照 / 风格
    //
    // 2026/06 加强稳定性:之前 prompt 只笼统说"同一地点/同一时段",Seedream I2I
    // 虽然传了 referenceImageUrl,但模型在生成 3 面板时容易各自"重新想象"出
    // 不同的色板 / 光照 / 建筑细节 —— 三个面板彼此漂移、跟原图也漂移。
    //
    // 现在明确"图1 是基线真值",3 个面板必须从同一基线衍生,并加 IDENTITY
    // LOCK 段枚举具体要锁住的视觉维度。
    // ----------------------------------------------------------------
    const positive = [
      `[STYLE LOCK — 场景三视图(3 景别变体),适用对象:scene]`,
      buildStyleLock(styleSpec, "scene"),
      ``,
      `[关键:这是 I2I 任务,图1 是当前主视图]`,
      `图1 是这个场景的"基线真值" —— 已经有确定的色板 / 光照方向 / 建筑或自然要素 / 装饰物 / 材质 / 时代风格。`,
      `本任务 = 在图1 的基础上,生成 3 个不同景别的变体(同一场景、不同距离)。`,
      `3 个面板**必须继承图1 的所有视觉元素**,只在景别/取景范围上变化。`,
      ``,
      `[任务] 生成一张「场景三视图」,3 个面板都是图1 同一地点的景别变体。`,
      ``,
      `[地点] ${data.sceneSlug}`,
      data.sceneLocation ? `[具体地点] ${data.sceneLocation}` : "",
      data.sceneTimeOfDay ? `[时段] ${data.sceneTimeOfDay}` : "",
      data.sceneAction ? `[场景动作] ${data.sceneAction}` : "",
      ``,
      `[画布] 一张横图,3 个等宽面板(左/中/右),格间干净留白(gutter ~3-5% panel 宽度)。`,
      ``,
      `[3 个景别变体 —— 仅取景距离变化,场景内容必须与图1 一致]`,
      `1) LEFT  · WIDE ESTABLISHING SHOT (远景):拉开看图1 描述的整场景全景,展示地点/空间关系。**所有建筑 / 自然要素 / 装饰物 / 招牌 / 桌椅 必须跟图1 完全相同**(只是更远更全)。`,
      `2) MIDDLE · MEDIUM SHOT (中景):走近到图1 中等距离,聚焦场景关键道具/门窗/标志物/桌椅/柜台等中景元素。**这些道具必须跟图1 中景里的同一物体一致**(同一张桌子、同一扇窗、同一面墙的颜色)。`,
      `3) RIGHT  · CLOSE-UP / DETAIL (近景特写):贴近图1 选一个局部(招牌字迹/墙砖纹理/灯光/材质/天气现象)做质感特写。**这个局部必须在图1 里能找到**(颜色、材质、文字内容跟图1 一致)。`,
      ``,
      `[IDENTITY LOCK —— 跟图1 锁死,不得漂移]`,
      `• 色板:3 个面板共用图1 的色板 —— 主色 / 辅色 / 强调色完全一致(不允许 LEFT 偏暖、MIDDLE 偏冷、RIGHT 偏紫这种漂移)。`,
      `• 光照方向:3 个面板共用图1 的主光源方向(左光 / 右光 / 顶光 / 逆光)和色温(暖 / 冷 / 中性)。`,
      `• 时代风格:3 个面板共用图1 的时代风格 —— 写实/动漫/水墨/赛博,不允许混搭。`,
      `• 关键物体:图1 里有的招牌、桌椅、建筑特征、自然要素(树/山/河)、装饰物 —— 3 个面板里出现时,数量、形状、颜色、位置感必须跟图1 一致。`,
      `• 人物状态:3 个面板都【无人物,无角色,无人形,无剪影,无背影】,纯环境。`,
      `• 文字 / 标识:如果图1 里有可读文字(招牌字、墙上的字),在面板里出现时,内容 / 字体 / 颜色保持一致。如果图1 没有文字,面板里也不要新加文字。`,
      ``,
      `[硬约束]`,
      `• 3 个面板之间绝对不允许互相矛盾:同一物体不能在不同面板里有不同颜色/形状。`,
      `• 3 个面板必须看起来像"同一个摄影师在同一天/同一光照下拍的 3 张照片",不是一个"概念图三联画"。`,
      `• 不要文字(除非图1 已有)、不要 logo、不要面板编号、不要分割线外的标注。`,
    ]
      .filter(Boolean)
      .join("\n");
    const negative = [
      "people, character, figure, silhouette, human, bystander",
      "different location, different time of day, different weather between panels",
      "different color palette between panels, color shift between panels, inconsistent lighting between panels",
      "style drift, mixing styles, different art style between panels, photorealistic when input is anime, anime when input is realistic",
      "different furniture, different furniture color, different furniture shape between panels",
      "different wall color, different floor color, different building shape between panels",
      "adding new objects not in 图1, inventing new details not in 图1, hallucinating extra elements",
      "changing the architecture, modifying the scene layout, redesigning the environment",
      "panel borders, separator lines, text, watermark, logo, panel number, label, caption, arrow, callout",
      "low quality, blurry, low resolution, jpeg artifacts",
    ].join(", ");
    return { positive, negative, size: "3072x1280" };
  }

  if (data.mode === "directional-views") {
    // ----------------------------------------------------------------
    // 场景方向多视角（2×2 四宫格，2048x2048）
    // 机位围绕场景旋转，场景内容锁定不变
    // 2D 布局示意：
    //   ┌────────────┬────────────┐
    //   │  FRONT     │   LEFT     │
    //   │  正面      │  左侧(90°) │
    //   ├────────────┼────────────┤
    //   │  RIGHT     │   BACK     │
    //   │  右侧(90°) │  背面(180°)│
    //   └────────────┴────────────┘
    // ----------------------------------------------------------------
    const positive = [
      `[STYLE LOCK — 场景四宫格方向多视角，适用对象:scene]`,
      buildStyleLock(styleSpec, "scene"),
      ``,
      `[关键规则：这是 I2I 任务，图1 = 基线真值]`,
      ``,
      `────────────────────────────────────────────────`,
      `【第一步：建立空间蓝图 —— 先理解场景的 3D 布局】`,
      `────────────────────────────────────────────────`,
      `在画任何一个视角之前，你必须先在脑子里构建这个场景的俯视图：`,
      ``,
      `想象你从正上方往下看这个场景（鸟瞰图），它是一个矩形的空间盒子。`,
      `图1 展示的是这个盒子的"南面"——你站在南边往北看。`,
      ``,
      `现在确定盒子四面分别有什么（从图1 推断）：`,
      `- 南面（你站的位置）：你身后是"摄像机"。南面可能什么都没有，也可能有柱子/栏杆，因为摄像机就在南面。`,
      `- 北面（图1 画面深处）：这是图1 里最远的那个面。它上面有什么？可能有后墙、远处的门、窗户、楼梯、走廊尽头。`,
      `- 西面（图1 画面左侧）：这是图1 里画面最左边能看到的那面墙/那个面。它上面有什么？可能有左侧墙面、左侧窗户、左侧的树/柱子、靠左的家具。`,
      `- 东面（图1 画面右侧）：这是图1 里画面最右边能看到的那面墙/那个面。它上面有什么？可能有右侧墙面、右侧的门、靠右的柜子/书架。`,
      ``,
      `场景中间有什么？如果有桌子、喷泉、楼梯、柜子等中心物体，它们的位置在盒子内部。`,
      ``,
      `这个空间蓝图是下面 4 个视角的共同基础。每个视角 = 你站到盒子的不同边上，往盒子里面看。`,
      `4 个视角必须共享同一个盒子——墙的位置、物体的位置、门窗的位置跨视角完全一致。`,
      ``,
      `────────────────────────────────────────────────`,
      `[地点] ${data.sceneSlug}`,
      data.sceneLocation ? `[具体地点] ${data.sceneLocation}` : "",
      data.sceneTimeOfDay ? `[时段] ${data.sceneTimeOfDay}` : "",
      ``,
      `[画布格式] 2048×2048 正方形，2×2 四宫格，格子间留极细空白线（~2px），无编号无标签。`,
      ``,
      `────────────────────────────────────────────────`,
      `【第二步：四个视角 —— 站到盒子的四条边上】`,
      `────────────────────────────────────────────────`,
      ``,
      `═══ 第一格：正面（南面 → 往北看）═══`,
      `你站在盒子的南边，往北看。这就是图1 的视角。`,
      `你看到的是：北面（远处）+ 西面（左边）+ 东面（右边）+ 中间物体。`,
      `画面内容与图1 一致。这是 4 格的锚点。`,
      ``,
      `═══ 第二格：左视角（西面 → 往东看）═══`,
      `你走到了盒子的西边，面朝东。`,
      `你正对着的是：原来在图1 画面最左边的那面墙/那些物体。`,
      `你右边远处是：原来在图1 画面深处的北面（现在变成你的右侧远景）。`,
      `你左边远处是：原来在你身后的南面（现在变成你的左侧远景，可能很空旷）。`,
      `中间物体（如果有）：你现在从它们的左侧看它们——它们的"左侧面"正对着你。`,
      ``,
      `关键：你看到的主要墙面和正面格的主要墙面是相邻但不相同的两面。`,
      `如果正面格左边有一扇窗——左视角里这扇窗应该在画面中央或偏右，因为你现在正对着它。`,
      ``,
      `═══ 第三格：右视角（东面 → 往西看）═══`,
      `你走到了盒子的东边，面朝西。`,
      `你正对着的是：原来在图1 画面最右边的那面墙/那些物体。`,
      `你左边远处是：北面（深处，现在变成你的左侧远景）。`,
      `你右边远处是：南面（摄像机原本的位置，现在变成你的右侧远景）。`,
      `中间物体（如果有）：你现在从它们的右侧看它们——它们的"右侧面"正对着你。`,
      ``,
      `关键：右视角正对的墙必须跟左视角正对的墙是两面不同的墙。`,
      `验证方法：正面格画面左侧的物体 → 左视角里放大。正面格画面右侧的物体 → 右视角里放大。`,
      ``,
      `═══ 第四格：背面（北面 → 往南看）═══`,
      `你走到了盒子的北边（原来在图1 画面最深处的那个面），转过身来面朝南。`,
      `你正对着的是：原来在你身后的那个面（南面，摄像机原本站的位置）。`,
      `你左边是：原来在图1 画面右边的东面（现在变成你的左侧）。`,
      `你右边是：原来在图1 画面左边的西面（现在变成你的右侧）。`,
      ``,
      `具体来说你看到了什么：`,
      `- 每个物体都有"正面"和"背面"。图1 画的是所有物体的正面。这一格画的是所有物体的背面。`,
      `- 如果图1 里有一张桌子，它的正面（桌沿/抽屉面）对着图1 的摄像机。背面格里，这张桌子的背面（后侧板/背板）对着你。`,
      `- 如果图1 里有一个柜台/吧台，正面能看到台面和服务区。背面格里，你看到的是柜台的内侧/背面——可能是储物架、操作台背面、后挡板。`,
      `- 如果图1 里有一扇门（朝内开），背面格里这扇门应该在你的"另一侧"——它的背面（没有门把手的一面，或者门把手在另一侧）对着你。`,
      `- 北面本身（图1 里远处的后墙）现在在你的"身后"，可能不在画面中，或者在画面边缘。`,
      ``,
      `简单来说：背面格 = 你走到场景的另一头，回头看。你看到的是图1 里所有物体的"后脑勺"。`,
      `光线：因为方向翻了 180°，光从原来的左侧来 → 现在从右侧来。但光的颜色、强度、时段不变。`,
      ``,
      `────────────────────────────────────────────────`,
      `【跨格一致性】`,
      `────────────────────────────────────────────────`,
      `- 4 格共用同一个盒子——墙和物体的位置关系跨格不矛盾。`,
      `- 同一物体（门/窗/桌/灯/树）在 4 格里颜色、形状、材质完全相同。`,
      `- 一套调色板、一套光照逻辑、一种艺术风格、同一个时刻。`,
      `- 纯环境，无人物。`,
      ``,
      `[绝对禁止]`,
      `- 右视角画出左视角的内容（两面墙不能相同）。`,
      `- 背面格画成正面格的复制品或镜像。`,
      `- 背面格只是换了个天空/背景，但建筑/物体结构跟正面一样。`,
      `- 格子内出现文字/编号/箭头/logo。`,
      `- 换天气、换时段、换色调。`,
      `- 加入人物、动物、剪影。`,
    ]
      .filter(Boolean)
      .join("\n");
    const negative = [
      "people, character, figure, silhouette, human, animal, bystander",
      "camera not moving, same angle in all 4 panels, no perspective change between panels",
      "left panel and right panel showing the same wall, left and right views identical",
      "right panel showing left-side content, right panel = left panel copy",
      "left panel being a minor variation of front panel, left panel = front panel with slight shift",
      "back panel looking like front panel, back panel = front panel mirrored or flipped",
      "back panel missing the rear wall, back panel showing a completely unrelated space",
      "back panel = front panel with a different sky, back panel = front panel but with objects removed",
      "back panel showing the front of objects instead of the back of objects",
      "different weather, different season, different time of day, different lighting between panels",
      "different color palette between panels, different wall color between panels",
      "changing architecture, different building, different room, different furniture layout",
      "adding objects, inventing furniture, hallucinating windows, creating new doors",
      "removing existing objects, deleting walls, removing windows or doors",
      "style drift, mixing art styles, photorealistic mixing with anime, different rendering quality",
      "panel labels, text, numbers, arrows, grid lines, visible borders, watermark, logo",
      "low quality, blurry, pixelated, distorted, jpeg artifacts",
      "2D flat look, no depth, isometric view, top-down, bird's-eye view",
      "four unrelated scenes, four different rooms, four different locations",
      "same wall painted differently, color shifted wall, texture changed wall",
    ].join(", ");
    return { positive, negative, size: "2048x2048" };
  }

  // ----------------------------------------------------------------
  // 'modify' 模式:在原图基础上按意见改,严约束构图/光照/地点/时段
  // ----------------------------------------------------------------
  const positive = [
    `[STYLE LOCK — 场景图按意见重生,适用对象:scene]`,
    buildStyleLock(styleSpec, "scene"),
    ``,
    `[任务] 修改「图1」(当前场景图),严格按下面的"修改意见"调整,只改用户提到的部分。`,
    ``,
    `[修改意见] ${data.userInstruction}`,
    ``,
    `[地点 / 时段] ${data.sceneSlug}${data.sceneTimeOfDay ? " / " + data.sceneTimeOfDay : ""}`,
    data.sceneAction ? `[场景动作参考] ${data.sceneAction}` : "",
    ``,
    `[修改规则 — 必须遵守]`,
    `1. 以图1为基础,在它的构图 / 光照 / 地点 / 时段上修改,**不要重新构图或换地点**。`,
    `2. 只调整"修改意见"里明确提到的元素;没提到的部分(构图、光照、地点、时段、视觉风格)全部保留图1 的样子。`,
    `3. 保持单张场景图,纯环境,无人物 / 无人形 / 无剪影。`,
    `4. 保持与图1 相同的视觉风格,严禁风格漂移。`,
  ]
    .filter(Boolean)
    .join("\n");
  const negative = [
    "people, character, figure, silhouette, human, crowd",
    "different art style, style drift, photorealistic when input is anime, anime when input is realistic, different medium, different color grading",
    "different location, different time of day, different camera angle, different aspect ratio",
    "watermark, logo, text, signature, label, panel number, caption, annotation, arrow, layout grid lines",
    "blurry, low quality, low resolution, jpeg artifacts",
  ].join(", ");
  return { positive, negative, size: "2K" };
}

export const regenerateSceneImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => RegenerateSceneInput.parse(d))
  .handler(async ({ data }) => {
    const { resolveProjectStyle } = await import("./visualStyles");
    const styleSpec = resolveProjectStyle(data.projectStyle);
    const { positive, negative, size } = buildScenePrompts(data, styleSpec);
    const requested = normalizeImageModelForRouting(data.model);
    const prompt = appendNegative(positive, negative);

    // 2026/06:查看提示词模式
    if (data.previewOnly) {
      return {
        ok: true as const,
        previewPrompt: prompt,
        negativePrompt: negative,
        promptSize: normalizeSeedreamSize(size),
        promptExtra: {
          model: requested || DEFAULT_MODEL,
          route: "场景图重生",
          mode: data.mode,
          referenceImage: data.referenceImageUrl,
        },
      } as any;
    }

    if (requested.toLowerCase().startsWith("pixflow/")) {
      const { callPixflowImage } = await import("./pixflow.functions");
      const r = await callPixflowImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "Pixflow 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("claude360/")) {
      const { callClaude360Image } = await import("./claude360Image.functions");
      const r = await callClaude360Image({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      });
      if (!r.url) return { ok: false as const, error: r.error || "Claude360 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("tokenflash/")) {
      const { callTokenflashImage } = await import("./tokenflash.functions");
      const r = await callTokenflashImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "Tokenflash 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("revora/")) {
      const { callRevoraImage } = await import("./revoraImage.functions");
      const r = await callRevoraImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "Revora 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("aigcfamily/")) {
      const { callAigcfamilyImage } = await import("./aigcfamilyImage.functions");
      const r = await callAigcfamilyImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "AIGCFamily 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }

    if (requested.toLowerCase().startsWith("shuci/")) {
      const { callShuanciyuanImage } = await import("./shuanciyuan.functions");
      const r = await callShuanciyuanImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "数安词源 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (
      requested.toLowerCase().startsWith("azure/") ||
      requested.toLowerCase().startsWith("azure2/")
    ) {
      const { callAzureImage } = await import("./azureImage.functions");
      const r = await callAzureImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: "high",
      });
      if (!r.url) return { ok: false as const, error: r.error || "Azure 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model, meta: r.meta };
    }
    if (requested.toLowerCase().startsWith("onetoken/")) {
      const { callOnetokenImage } = await import("./onetokenImage.functions");
      const r = await callOnetokenImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
      });
      if (!r.url) return { ok: false as const, error: r.error || "OneToken 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("otu/")) {
      const { callOtuImage } = await import("./otuImage.functions");
      const r = await callOtuImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      });
      if (!r.url) return { ok: false as const, error: r.error || "OTU 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("aitokenvibe/")) {
      const { callAitokenvibeImage } = await import("./aitokenvibeImage.functions");
      const r = await callAitokenvibeImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      });
      if (!r.url) return { ok: false as const, error: r.error || "AI Tokenvibe 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("thhtcloud/")) {
      const { callThhtcloudImage } = await import("./thhtcloudImage.functions");
      const r = await callThhtcloudImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      });
      if (!r.url) return { ok: false as const, error: r.error || "天鸿智算 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("ailinzi/")) {
      const { callAilinziImage } = await import("./ailinziImage.functions");
      const r = await callAilinziImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      });
      if (!r.url) return { ok: false as const, error: r.error || "ailinzi 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("vapeur/")) {
      const { callVapeurImage } = await import("./vapeurImage.functions");
      const r = await callVapeurImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      });
      if (!r.url) return { ok: false as const, error: r.error || "vapeur 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("tokenhub/")) {
      const { callTokenhubImage } = await import("./tokenhubImage.functions");
      const r = await callTokenhubImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      });
      if (!r.url) return { ok: false as const, error: r.error || "tokenhub 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("nagora/")) {
      const { callNagoraImage } = await import("./nagoraImage.functions");
      const r = await callNagoraImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      });
      if (!r.url) return { ok: false as const, error: r.error || "nagora 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }
    if (requested.toLowerCase().startsWith("meridian/")) {
      const { callMeridianImage } = await import("./meridianImage.functions");
      const r = await callMeridianImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      });
      if (!r.url) return { ok: false as const, error: r.error || "meridian 未返回图片" };
      return { ok: true as const, url: r.url, model: r.model };
    }

    const { apiKey, baseUrl, model: defaultModel } = getArkConfig();
    if (!apiKey) return { ok: false as const, error: "ARK_API_KEY not configured" };
    const model = requested || defaultModel;

    const result = await callSeedreamImages(
      {
        model,
        prompt,
        image: data.referenceImageUrl,
        size: normalizeSeedreamSize(size),
        output_format: "png",
        watermark: false,
      },
      apiKey,
      baseUrl,
      I2I_TIMEOUT_MS,
    );
    if (!result.url) {
      if (/401/i.test(result.error || ""))
        return { ok: false as const, error: "Seedream auth failed (401)" };
      if (/402/i.test(result.error || "")) return { ok: false as const, error: "no_credits" };
      if (/timed out/i.test(result.error || ""))
        return { ok: false as const, error: "AI 处理超时(>180s),请重试" };
      return { ok: false as const, error: result.error || "Seedream 未返回图片" };
    }
    return { ok: true as const, url: result.url, model: result.model };
  });
