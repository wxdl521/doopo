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

import './loadEnv'  // ← 必须在所有 env 读取之前导入,触发 .env.local 加载
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { buildStyleLock, type VisualStyleSpec } from './visualStyles'

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const DEFAULT_MODEL = 'doubao-seedream-5-0-260128'
const RETRY_BACKOFF_MS = [1_000, 2_000, 4_000] as const
// 2026/06 修复:50_000 经常被 Seedream 5.0 多参考图融合 + 高分辨率 2K
// 出图流程超时报错。先提到 120s,后又因新 multi-asset(3 区域 + 13 子图概念)
// 和 16:9 故事板(6 section, ~3500 字 prompt)单图渲染负担更重,
// **2026/06 二次提到 180s**(3 分钟)给单次重活兜底。
// 极端情况 3+ 分钟的请求仍可能超,但 retry 1s/2s/4s 退避 + 用户体验上更平滑。
const REQUEST_TIMEOUT_MS = 180_000
const I2I_TIMEOUT_MS = 180_000
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ---------- 工具函数 ----------

function getArkConfig() {
  return {
    apiKey: process.env.ARK_API_KEY,
    baseUrl: (process.env.ARK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: process.env.ARK_IMAGE_MODEL || DEFAULT_MODEL,
  }
}

/** 是否 Seedream 模型 id */
export function isSeedreamModel(modelId: string | null | undefined): boolean {
  const m = (modelId || '').trim().toLowerCase()
  return m === '' || m.startsWith('doubao-seedream-') || m.startsWith('seedream-')
}

/**
 * 历史项目里可能残留裸 `openai/gpt-image-2`。它不是 ARK/Seedream 模型,
 * 必须归一到 Pixflow 前缀路由,否则会被错误 POST 到 ARK /images/generations 并 404。
 */
export function normalizeImageModelForRouting(modelId: string | null | undefined): string {
  const m = (modelId || '').trim()
  const lower = m.toLowerCase()
  if (lower === 'openai/gpt-image-2' || lower === 'gpt-image-2') return 'pixflow/gpt-image-2'
  return m
}

/**
 * Seedream 最小像素数限制(实测 2026/06):
 * 任何 size 的 WxH 必须 >= 3,686,400 像素,否则返回
 * `code: InvalidParameter, message: "image size must be at least 3686400 pixels"`。
 * 2K = 2048x2048 = 4,194,304 ✅
 * 2560x1280 = 3,276,800 ❌ (常见误用,3-view 模式之前的硬编码就是它)
 * 1104x1472 = 1,623,888 ❌ (legacy Qwen 尺寸,不该传给 Seedream)
 */
export const SEEDREAM_MIN_PIXELS = 3_686_400

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
  const fallback = '2K'
  if (!size) return fallback
  const s = String(size).trim()
  if (!s) return fallback
  // '2K' / '4K' / '1K' 直接透传(都已满足最小像素)
  if (/^\dK$/i.test(s)) return s.toUpperCase().replace('k', 'K')
  // '2048*2048' → '2048x2048'
  const normalized = s.includes('*') ? s.replace(/\*/g, 'x') : s
  // 像素数校验:小尺寸自动升级
  const m = normalized.match(/^(\d+)\s*x\s*(\d+)$/i)
  if (m) {
    const w = parseInt(m[1], 10)
    const h = parseInt(m[2], 10)
    if (w * h < SEEDREAM_MIN_PIXELS) {
      return fallback  // 自动升级到 2K,不让 Seedream 拒
    }
  }
  return normalized
}

/** 把 negative prompt 拼到 positive 末尾 */
function appendNegative(positive: string, negative: string | undefined): string {
  if (!negative || !negative.trim()) return positive
  return `${positive}\n\nFORBIDDEN (avoid these): ${negative}`
}

// ---------- 内部 HTTP helper ----------

type SeedreamImageBody = {
  model: string
  prompt: string
  image?: string | string[]
  size?: string
  sequential_image_generation?: 'disabled' | 'auto'
  sequential_image_generation_options?: { max_images?: number }
  output_format?: 'png' | 'jpeg' | 'jpg' | 'webp'
  watermark?: boolean
}

type SeedreamImageResult = {
  url: string
  error: string | null
  model: string
  size?: string
}

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
  const envDebug = `[env: apiKey=${apiKey ? apiKey.slice(0, 12) + '...' : 'UNDEFINED'}, baseUrl=${baseUrl}, model=${body.model}]`

  let lastErr: string | null = null
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          // Seedream 全部必填默认值
          sequential_image_generation: 'disabled',
          response_format: 'url',
          stream: false,
          watermark: true,
          ...body,
        }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          data?: Array<{ url?: string; size?: string }>
          error?: { code?: string; message?: string }
          message?: string
        }
        const first = json.data?.[0]
        const url = first?.url
        if (!url) {
          return {
            url: '',
            error: `[seedream] ${body.model} 未返回 URL: ${json.error?.message || json.message || 'no data'}`,
            model: body.model,
            size: first?.size,
          }
        }
        return { url, error: null, model: body.model, size: first.size }
      }
      const text = await res.text().catch(() => '')
      lastErr = `[seedream] ${body.model} ${res.status}: ${text.slice(0, 300)} ${envDebug}`
      // 429 / 5xx 才重试,其他(400 鉴权 / 401 / 402 计费)立即返回
      const isRetryable = res.status === 429 || res.status >= 500
      if (!isRetryable) {
        return { url: '', error: lastErr, model: body.model }
      }
    } catch (e) {
      clearTimeout(timeout)
      const msg = e instanceof Error ? (e.name === 'AbortError' ? 'timed out' : e.message) : 'fetch failed'
      lastErr = `[seedream] ${body.model} network: ${msg}`
    }
    if (attempt < RETRY_BACKOFF_MS.length) {
      await sleep(RETRY_BACKOFF_MS[attempt] ?? 1_000)
    }
  }
  return { url: '', error: (lastErr || `[seedream] ${body.model} failed after retries`) + ' ' + envDebug, model: body.model }
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
})

export const generateImage = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => GenerateImageInput.parse(d))
  .handler(async ({ data }) => {
    const requested = normalizeImageModelForRouting(data.model)
    // 委托给 Lovable AI Gateway(openai/gpt-image-*, google/gemini-*-image*)
    {
      const { isLovableGatewayImageModel, callLovableGatewayImage } = await import('./lovableImage.functions')
      if (isLovableGatewayImageModel(requested)) {
        const r = await callLovableGatewayImage({
          prompt: appendNegative(data.prompt, data.negativePrompt),
          model: requested,
          size: data.size,
        })
        return { url: r.url, error: r.error, model: r.model }
      }
    }
    // 委托给 Pixflow(OpenAI 兼容的 gpt-image-2 / gemini 系列)
    if (requested.toLowerCase().startsWith('pixflow/')) {
      const { callPixflowImage } = await import('./pixflow.functions')
      const r = await callPixflowImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      })
      return { url: r.url, error: r.error, model: r.model }
    }
    // 委托给 Tokenflash(OpenAI 兼容,api.tokenflash.cn)
    if (requested.toLowerCase().startsWith('tokenflash/')) {
      const { callTokenflashImage } = await import('./tokenflash.functions')
      const r = await callTokenflashImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      })
      return { url: r.url, error: r.error, model: r.model }
    }
    if (requested.toLowerCase().startsWith('aigcfamily/')) {
      const { callAIGCFamilyImage } = await import('./aigcfamilyImage.functions')
      const r = await callAIGCFamilyImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      })
      return { url: r.url, error: r.error, model: r.model }
    }
    // 委托给 OneToken(OpenAI 兼容,api.onetoken.one)
    if (requested.toLowerCase().startsWith('onetoken/')) {
      const { callOnetokenImage } = await import('./onetokenImage.functions')
      const r = await callOnetokenImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      })
      return { url: r.url, error: r.error, model: r.model }
    }
    // 委托给 OTU(OpenAI 兼容)
    if (requested.toLowerCase().startsWith('otu/')) {
      const { callOtuImage } = await import('./otuImage.functions')
      const r = await callOtuImage({
        prompt: appendNegative(data.prompt, data.negativePrompt),
        model: requested,
        size: data.size,
      })
      return { url: r.url, error: r.error, model: r.model }
    }
    // 委托给 legacy(老 Qwen / OpenRouter 路径)
    if (requested && !isSeedreamModel(requested)) {
      // 动态 import 避免循环引用
      const { generateImage: legacy } = await import('./openrouterImage.functions')
      return legacy({
        data: {
          prompt: data.prompt,
          model: data.model,
          size: data.size,
          negativePrompt: data.negativePrompt,
          noFallback: data.noFallback,
        },
      } as any)
    }

    // Seedream 路径
    const { apiKey, baseUrl, model: defaultModel } = getArkConfig()
    if (!apiKey) return { url: '', error: 'ARK_API_KEY not configured', model: requested || defaultModel }
    const model = requested || defaultModel
    const size = normalizeSeedreamSize(data.size || '2K')
    const prompt = appendNegative(data.prompt, data.negativePrompt)

    // 2026/06:查看提示词模式
    if (data.previewOnly) {
      return {
        url: '',
        error: null,
        model,
        size,
        previewPrompt: prompt,
        negativePrompt: data.negativePrompt,
        promptSize: size,
        promptExtra: { model, route: 'T2I (generateImage)' },
      } as any
    }

    return callSeedreamImages(
      { model, prompt, size, output_format: 'png', watermark: false },
      apiKey,
      baseUrl,
    )
  })

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
  mode: z.enum(['modify', 'three-view', 'multi-asset']).default('modify'),
  // 2026/06:查看提示词模式
  previewOnly: z.boolean().default(false),
})

export type RegenerateInputType = z.infer<typeof RegenerateInput>

/** 根据 mode 拼不同的 positive / negative prompt(平移自 characterRegen.functions.ts:61-278) */
function buildCharacterPrompts(opts: {
  data: RegenerateInputType
  styleSpec: { label: string; positive: string; negative: string }
  cardTitle: string
}): { positive: string; negative: string; size: string } {
  const { data, styleSpec, cardTitle } = opts

  if (data.mode === 'three-view') {
    const positive = [
      `Generate ONE standard 3-view character reference sheet of "${cardTitle}" — a ${data.characterRoleLabel}, age ${data.characterAge}. The output is a SINGLE image with EXACTLY 3 panels (left = front, middle = side profile, right = back).`,
      ``,
      `You are given TWO sources of truth and BOTH must agree:
  (A) the attached REFERENCE IMAGE — the current approved front-view of "${cardTitle}", and
  (B) the FACE / BODY / OUTFIT text descriptions below.
If (A) and (B) ever disagree, follow (B). The character identity MUST match (B) exactly.`,
      ``,
      `[PHYSICAL STATE — must be respected in ALL 3 panels]`,
      `The character's body description (bodyDescription) below is the SINGLE SOURCE OF TRUTH for their physical condition.`,
      `If the body description indicates a permanent physical trait (e.g. uses a wheelchair, missing limb, prosthetic, walking cane, blind, deaf), that trait MUST appear consistently in ALL 3 panels.`,
      `DO NOT force the character into a "standing upright" pose if they use a wheelchair — show them in their wheelchair in all 3 panels (front/side/back views of the person IN the wheelchair).`,
      `DO NOT add missing limbs back — if the description says they are missing an arm or leg, all 3 panels must show that limb missing.`,
      `The camera angle changes between panels (front → side → back), but the character's physical state, assistive devices, and permanent condition stay identical across all 3 panels.`,
      ``,
      `LAYOUT — strict, no exceptions:
  Output ONE image with EXACTLY 3 horizontal panels, side-by-side, equal width:
    • LEFT   = FRONT view (the reference image's angle)
    • MIDDLE = SIDE profile (90° rotation, character's RIGHT side facing the camera)
    • RIGHT  = BACK view (180° rotation)
  NO 4th panel. NO diagonal panel. NO detail box. NO labels. NO captions. NO arrows. NO scale indicators. NO text inside the image.`,
      ``,
      `PER-PANEL SHOT TYPE: Each of the 3 panels is a FULL SHOT (FS) / LONG SHOT (LS) / FULL-LENGTH PORTRAIT — the same framing used in character turnaround sheets, model sheets, and costume reference sheets. The character in EACH panel is shown from head to toe (or the full extent of their body, including wheelchair/prosthetic if applicable).`,
      ``,
      `PER-PANEL GEOMETRY: Each panel is portrait-orientation. In each panel, the character occupies 85-95% of the panel's vertical extent — from the top of the head to the lowest point of the body (soles of feet, wheelchair bottom, prosthetic bottom, etc.). Small white margin above the head AND below the body in EACH panel. The character does NOT touch the top or bottom edge of any panel.`,
      ``,
      `PER-PANEL COMPOSITION (apply in each of the 3 panels):
  1. Reserve a portrait-orientation panel.
  2. Place the character centered horizontally.
  3. Top of head at the top of the panel (with small margin).
  4. Lowest body point at the bottom of the panel (with small margin).
  5. Body fills the vertical axis of the panel — full body, no half-body.
  6. Both feet visible (if applicable and the character has feet). Hands visible at the sides (if applicable).`,
      ``,
      `HARD CONSTRAINTS — the image is REJECTED if ANY of these is true in ANY of the 3 panels:
  • The panel is a half-body, waist-up, hip-up, chest-up, shoulder-up, knee-up, cowboy shot, or head-and-shoulders crop.
  • The head or top of the hair is cut off at the top of the panel.
  • The body or wheelchair/prosthetic is cut off at the bottom of the panel.
  • The body extends beyond the panel edge.
  • The character occupies less than 80% of the panel's height.
  • The side or back panel is tighter than the front panel (this is the #1 most common failure mode — both side and back must be JUST AS FULL as the front).
  • The image contains 4+ panels, or fewer than 3 panels.
  • The character's physical condition (wheelchair, missing limb, etc.) differs between panels — it MUST be identical in all 3.`,
      ``,
      `CAMERA PER PANEL: Neutral front/side/back views. The ONLY thing that changes between panels is the camera rotation around the vertical axis. NO 3/4 view, NO diagonal, NO action pose, NO walking, NO running, NO hands-on-hips. The character stays in their natural/default state (sitting in wheelchair if applicable, standing if applicable, with their assistive devices as described).`,
      ``,
      `EXPRESSION IN ALL 3 PANELS: Neutral, expressionless, like a passport photo. No smile, no frown, no emotion, eyes open looking at the camera.`,
      ``,
      `IDENTITY LOCK ACROSS ALL 3 PANELS: Same face, same body, same physical condition, same outfit, same age, same hair, same skin tone, same accessories, same shoes, same wheelchair or prosthetic if applicable. The ONLY difference between panels is the camera angle.`,
      ``,
      `VISUAL STYLE (MUST match across all 3 panels — no style drift between panels):`,
      buildStyleLock(styleSpec, 'reference'),
      ``,
      `CHARACTER (source of truth, alongside the attached reference image):
  Name: ${cardTitle} (${data.characterRoleLabel}, age ${data.characterAge})
  Face (must remain identical in all 3 panels): ${data.faceDescription || '(use the face shown in the attached reference image)'}
  Body (must remain identical in all 3 panels — includes physical condition, disabilities, assistive devices): ${data.bodyDescription || '(use the body shown in the attached reference image)'}
  Outfit (must remain identical in all 3 panels — do NOT change the outfit between panels): ${data.clothingDescription || '(use the outfit shown in the attached reference image)'}`,
      ``,
      `BACKGROUND: Each panel has a uniform light neutral background (off-white #F5F5F5 / light grey #EEEEEE is OK — this IS a reference sheet, not a final product, so the strict pure-white rule is relaxed). NO scenery, NO floor, NO horizon, NO props, NO environment, NO shadow on the background, NO reflection.`,
      ``,
      `FINAL CHECK — verify every item before submitting. If any is false, REGENERATE the image:
  [ ] Output is ONE image with EXACTLY 3 panels (front / side / back) (yes)
  [ ] All 3 panels show the FULL BODY (including wheelchair/prosthetic if applicable) (yes)
  [ ] All 3 panels are equally full-body (side and back NOT tighter than front) (yes)
  [ ] Same face, body, physical condition, outfit, age in all 3 panels (yes)
  [ ] Physical disabilities/assistive devices are identical in all 3 panels (yes)
  [ ] Style matches "${styleSpec.label}" in all 3 panels (yes)
  [ ] Expression is neutral in all 3 panels (yes)
  [ ] No text, watermark, logo, labels, captions inside the image (yes)`,
      ``,
      `Begin. Output the 3-view full-body reference sheet.`,
    ].filter(Boolean).join('\n')
    const negative = [
      'medium shot, medium close-up, MCU, MS, mid-shot, mid close-up, half body, half-body, half-length, three-quarter body, 3/4 body, three-quarter length, cowboy shot, american shot, knee-up shot, knee-up, mid-thigh shot, thigh-up, hip-up, waist-up shot, waist-up, midriff-up, chest-up shot, chest-up, shoulder-up, head and shoulders, head-and-shoulders, head only, headshot, head shot, tight headshot, tight crop, tight framing, close-up, close up, CU, extreme close-up, ECU, bust shot, bust, portrait crop, portrait shot, passport photo, ID photo',
      'cropped at knees, cropped at calves, cropped at shins, cropped at ankles, cropped at waist, cropped at hips, cropped at thighs, cropped at chest, cropped at shoulders, cropped at neck, head cut off, top of head cut off, top of head clipped, hair cut off, feet cut off, shoes cut off, hands cut off, body extending beyond frame, body touching frame edge, body touching top of frame, body touching bottom of frame, figure touching top of frame, figure touching bottom of frame, half-body in side panel, half-body in back panel, half-body in any panel, 3/4 body in any panel, close-up of torso in side or back panel, tight framing in side panel, tight framing in back panel, side panel tighter than front, back panel tighter than front, side panel showing only upper body, back panel showing only upper body',
      'missing feet, missing shoes, missing head, missing legs, missing lower body, missing upper body, head only, torso only, legs only, partial body, incomplete body, amputated limbs, no legs, no feet, legless, feet-less, lower body cut off, lower body fading out, lower body blended with background, character floating with no feet, character shown only from the waist up, from waist up only, from chest up only, from hips up only, from knees up only',
      'low angle, low-angle shot, worm\'s eye view, worm eye view, hero shot, looking up at subject, upward camera, upward tilt, camera below subject, dutch angle, dutch tilt, tilted camera, canted angle, fisheye, wide-angle distortion, 3/4 view, three-quarter view, diagonal angle, perspective, action pose, walking, sitting, crouching, jumping, leaning, hands on hips, prop holding, dynamic pose, tilted head, looking up, looking down, top-down, bird\'s eye view, bottom-up',
      'different art style, style drift, photorealistic when input is anime, anime when input is realistic, different medium, different line treatment, different color grading, inconsistent rendering between panels, mixing anime and realistic, mixing 3D and 2D, mixing watercolor and cel-shading',
      'smile, smirk, grin, frown, scowl, angry eyes, sad eyes, laughing, crying, pouting, raised eyebrow, looking sideways, eyes closed, eyes squinting, teeth showing, emotional expression, character personality face',
      'different face, different face shape, different eye shape, different eye color, different nose, different mouth, different eyebrows, different skin tone, different hairstyle, different hair color, different hair length, different facial proportions, age change, different body, different body proportions, different height, different weight, different gender presentation, different outfit, different clothing color, different clothing style, different accessories, different hat, different glasses, different jewelry, different bag, different weapon, different shoes, different makeup, extra clothing item, missing clothing item, outfit change between panels',
      'scenery, furniture, props, ground texture, horizon line, floor, wall, sky, busy background, complex background, detailed background, color cast, gradient background, vignette, shadow on background, floor reflection, environment, room, indoor, outdoor',
      'watermark, logo, text, signature, label, panel number, caption, annotation, arrow, callout, extra limbs, deformed hands, extra fingers, extra people, multiple characters, bystander, blurred face, low quality, 4 panels, 5 panels, more than 3 views, fewer than 3 views, single panel',
    ].join(', ')
    // Seedream 用 'x' 分隔画幅;三视图横向 3 面板 → 长方形画布
    // 3072x1280 = 3,932,160 像素,稳过 Seedream 3,686,400 的最小要求
    return { positive, negative, size: '3072x1280' }
  }

  if (data.mode === 'multi-asset') {
    // ====================================================================
    // 角色多维资产图 —— 2026/06 用户二次扩展
    //
    // 在原 3 区域(三视图/表情/姿势)基础上合并新需求:
    //   ① 大型主肖像(hero portrait,放整张图最显眼位置)
    //   ② 各种面部表情(开心/生气/困倦/惊讶等,融合原有 6 表情扩成 6-8 个)
    //   ③ 动作姿势(按角色个性自适应,不限定 4 个)
    //   ④ 小型物体图标(配饰/长期携带道具)
    //   ⑥ 简介条(名字 + 个性 / role 描述)
    //
    // 最终布局(从上到下):
    //   Section 0  简介条        — 名字 + 个性短描述
    //   Section 1  大型主肖像    — 整张图最显眼,半身或全身 hero shot
    //   Section 2  角色三视图    — 正/侧/背
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

      // ========== Section 2:三视图 ==========
      `[SECTION 2 — 角色三视图 / THREE-VIEW]`,
      `Section title: "角色三视图 / Three-View"`,
      `Lay out THREE FULL-BODY orthographic views side-by-side:`,
      `  • 正视图 (Front view) — character facing camera, expressionless face, in their natural/default state (standing if able, in wheelchair if they use one, with prosthetic/assistive device if applicable)`,
      `  • 侧视图 (Side view) — 90° rotation, character's RIGHT side facing camera, same state`,
      `  • 背视图 (Back view) — 180° rotation, back facing camera, same state`,
      `Each view is labeled in Chinese below it: "正视图" / "侧视图" / "背视图".`,
      `CRITICAL — PRESERVE ALL CHARACTER FEATURES across all three views: any special trait (glasses, wings, animal ears, tail, horns, special hair accessory, distinctive eye color, tattoos) MUST appear consistently. Identical proportions, identical outfit, identical physical condition. NO perspective distortion, NO foreshortening, NO 3/4 angles. Standard orthographic.`,
      `IMPORTANT — The body description (bodyDescription) below is the SINGLE SOURCE OF TRUTH for the character's physical condition. If they use a wheelchair, are missing a limb, or have any permanent physical trait, that MUST be shown identically in all three views. Do NOT force "standing A-pose" if the character uses a wheelchair.`,

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
      `RULE 3 — FEATURE PRESERVATION: any special trait (glasses, wings, animal ears, tail, horns, special accessories, distinctive markings) MUST appear in: the main portrait, all three views, every expression close-up, every pose. Missing in any one of these = REJECT.`,
      `RULE 4 — CHINESE TEXT LABELS: every section carries a Chinese title; every sub-image / icon carries a Chinese label. Text must be readable, simplified Chinese, no garbled characters, no English-only labels.`,
      `RULE 5 — NO RIGID GRID: do not force a fixed grid. Section 1 = one big hero portrait. Sections 2-5 lay items out by content (3 views in Section 2, 6-8 expressions in Section 3, 4-6 poses in Section 4, 4-8 accessory icons in Section 5).`,
      `RULE 6 — NO PERSPECTIVE ERRORS in Section 2 (three-view): orthographic only (0° / 90° / 180°).`,
      `RULE 7 — EXPRESSION ONLY in Section 3: only expression changes between close-ups. Same head size, camera angle, lighting.`,
      `RULE 8 — PERSONALITY-MATCHED POSES in Section 4: pose set should reflect this character's role and temperament. A reserved scholar should NOT get aggressive combat poses; a playful child should NOT get combat-ready poses.`,
      `RULE 9 — STYLE LOCK: all sub-images + labels rendered in the project's selected visual style "${styleSpec.label}". No mixing of anime + photoreal, no mixing of 2D + 3D.`,
      `RULE 10 — NO UNRELATED CONTENT: no other characters in any sub-image, no random scenery, no extra limbs, no deformed hands. Section 0 is text-only. Section 5 icons are isolated objects, not in-scene.`,
      `RULE 11 — SECTION SEPARATORS: only thin neutral dividers (~#E8E8E8) between the six sections. No fancy borders, no decorative frames.`,
      `RULE 12 — PROFILE BAR IS TEXT-ONLY: Section 0 contains only text (name, role badge, personality description). No portrait, no icon in this strip.`,

      // ========== 风格 / 角色数据 ==========
      `[PROJECT VISUAL STYLE — must match across all sub-images]`,
      buildStyleLock(styleSpec, 'character'),

      `[CHARACTER IDENTITY — source of truth, copy into the image EXACTLY]`,
      `Name: ${cardTitle} (${data.characterRoleLabel}, age ${data.characterAge})`,

      `=== FACE — IDENTICAL across every face/head in the image ===`,
      data.faceDescription || '(no separate face description — use the face shown in the attached reference image)',
      `=== END FACE ===`,

      `=== BODY — IDENTICAL across all full-body sub-images (includes physical condition / disabilities / assistive devices) ===`,
      data.bodyDescription || '(no separate body description — use the body shown in the attached reference image)',
      `NOTE: The body description is the single source of truth for physical condition. If the character uses a wheelchair, missing a limb, or has any permanent physical trait, that MUST be shown identically in every sub-image. Do NOT force standing poses on wheelchair users.`,

      `=== OUTFIT — IDENTICAL across all sub-images, do NOT add/remove clothing or accessories ===`,
      data.clothingDescription || '(no separate outfit description — use the outfit shown in the attached reference image)',
      `=== END OUTFIT ===`,
      data.palette?.length ? `\n=== PALETTE (hex colors) — apply consistently ===\n${data.palette.join(', ')}\n=== END PALETTE ===` : '',

      // 把用户在 instruction 里写的语义提示也带上(client 那边传简短中文 instruction,作为 EDIT REQUEST)
      `[USER REQUEST]`,
      data.userInstruction,

      `[FINAL CHECKLIST]`,
      `[ ] Pure white background throughout`,
      `[ ] Section 0: text-only profile bar (name, role chip, 1-2 Chinese sentences of personality)`,
      `[ ] Section 1: one large hero portrait — the visual centerpiece`,
      `[ ] Section 2: three full-body orthographic views (front/side/back) with Chinese labels`,
      `[ ] Section 3: 6-8 facial close-ups covering 开心/生气/困倦/惊讶/悲伤/常态 (at minimum) with Chinese labels`,
      `[ ] Section 4: 4-6 full-body poses matched to character personality, Chinese-labeled`,
      `[ ] Section 5: 4-8 small accessory/prop icons (isolated objects), Chinese-labeled`,
      `[ ] Same face, body, outfit, special features across the entire image`,
      `[ ] All text in simplified Chinese, readable`,
      `[ ] Style matches "${styleSpec.label}"`,
      `[ ] No other characters, no extra limbs, no perspective errors in the three-view`,

      `Begin. Output the character multi-asset sheet.`,
    ].filter(Boolean).join('\n\n')
    const negative = [
      'different art style, style drift, photorealistic when input is anime, anime when input is realistic, inconsistent rendering between sub-images',
      'different face, different face shape, different eye shape, different eye color, different nose, different mouth, different eyebrows, different skin tone, different hairstyle, different hair color, different hair length, different facial proportions, age change, different body, different body proportions, different height, different gender presentation, different outfit, different clothing color, different clothing style, different accessories, different glasses, different jewelry, different shoes',
      'missing glasses when source has glasses, missing wings when source has wings, missing tail when source has tail, missing animal ears when source has them, missing horns when source has horns, missing distinctive feature, feature drift, lost accessory',
      'perspective distortion in three-view, fish-eye, wide-angle distortion, foreshortening, hero shot, low angle, 3/4 view in front/side/back, diagonal angle',
      'cropped at knees, cropped at waist, cropped at chest, head cut off, feet cut off, body extending beyond frame, missing feet, missing hands, missing legs',
      'inconsistent proportions across the three views, taller in one view, shorter in another, scale mismatch between sub-images',
      'extra people, bystander, multiple characters, extra limbs, deformed hands, extra fingers, deformed face, blurred face, low quality',
      'detailed scenery, busy backgrounds, room interior, outdoor landscape, props cluttering the frame, floor, wall, sky, scenery, furniture, ground texture, horizon line, shadow on background, gradient background',
      'English-only labels, garbled Chinese, missing labels, illegible text, decorative borders, ornate frames, gold filigree',
      'rigid 3x3 grid template when content needs different layout, forced 4 panels, forced 5 panels, padding cells, blank cells',
      'profile bar with illustration, profile bar with icon, profile bar that is not text-only',
      'accessory icons held by the character, accessory icons worn by the character, accessory icons in a scene, accessory icons with background scenery',
      'main portrait too small, main portrait same size as thumbnails, no clear visual centerpiece, hero portrait demoted to side thumbnail',
      'combat poses for a peaceful character, scholarly poses for a child, mismatched poses for character personality',
    ].join(', ')
    return { positive, negative, size: '2160x2880' }
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
    buildStyleLock(styleSpec, 'regen'),
  ].join('\n')
  const negative = [
    'different art style, style drift, photorealistic when input is anime, anime when input is realistic, different medium, different line treatment, different color grading',
    '3/4 view, side view, profile, back view, tilted head, looking up, looking down, top-down, bottom-up, hero shot, low angle, high angle, camera pan, camera tilt',
    'cropped at knees, cropped at waist, cropped at chest, cropped at thighs, head cut off, feet cut off, close-up, medium shot, half body',
    'smile, smirk, grin, frown, scowl, angry eyes, sad eyes, laughing, crying, pouting, raised eyebrow, eyes closed, eyes squinting, teeth showing, emotional expression',
    'off-white background, cream background, ivory background, beige background, light grey background, gradient background, vignette, scenery, furniture, props, ground texture, horizon line, floor, wall, sky, shadow on background, floor reflection, color cast',
    'different face, different face shape, different eye shape, different eye color, different nose, different mouth, different eyebrows, different skin tone, different hairstyle, different hair color, different hair length, different facial proportions, age change',
    'watermark, logo, text, signature, extra limbs, deformed hands, extra fingers, extra people, blurred face, low quality',
  ].join(', ')
  return { positive, negative, size: '2K' }
}

export const regenerateCharacterLook = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => RegenerateInput.parse(d))
  .handler(async ({ data }) => {
    const { resolveProjectStyle } = await import('./visualStyles')
    const styleSpec = resolveProjectStyle(data.projectStyle)
    const cardTitle = data.lookLabel === '默认'
      ? data.characterName
      : `${data.characterName} · ${data.lookLabel}`

    const { positive, negative, size } = buildCharacterPrompts({ data, styleSpec, cardTitle })
    const requested = normalizeImageModelForRouting(data.model)
    const prompt = appendNegative(positive, negative)

    // 2026/06:查看提示词模式 —— 不调 Seedream,直接把 prompt 返回
    if (data.previewOnly) {
      return {
        ok: true as const,
        previewPrompt: prompt,
        negativePrompt: negative,
        promptSize: normalizeSeedreamSize(size),
        promptExtra: { model: requested || DEFAULT_MODEL, mode: data.mode, referenceImage: data.referenceImageUrl },
      }
    }

    if (requested.toLowerCase().startsWith('pixflow/')) {
      const { callPixflowImage } = await import('./pixflow.functions')
      const r = await callPixflowImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: 'high',
      })
      if (!r.url) return { ok: false as const, error: r.error || 'Pixflow 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    if (requested.toLowerCase().startsWith('tokenflash/')) {
      const { callTokenflashImage } = await import('./tokenflash.functions')
      const r = await callTokenflashImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: 'high',
      })
      if (!r.url) return { ok: false as const, error: r.error || 'Tokenflash 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    if (requested.toLowerCase().startsWith('aigcfamily/')) {
      const { callAIGCFamilyImage } = await import('./aigcfamilyImage.functions')
      const r = await callAIGCFamilyImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: 'high',
      })
      if (!r.url) return { ok: false as const, error: r.error || 'AIGCFamily 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    if (requested.toLowerCase().startsWith('onetoken/')) {
      const { callOnetokenImage } = await import('./onetokenImage.functions')
      const r = await callOnetokenImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
      })
      if (!r.url) return { ok: false as const, error: r.error || 'OneToken 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    if (requested.toLowerCase().startsWith('otu/')) {
      const { callOtuImage } = await import('./otuImage.functions')
      const r = await callOtuImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      })
      if (!r.url) return { ok: false as const, error: r.error || 'OTU 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }

    const { apiKey, baseUrl, model: defaultModel } = getArkConfig()
    if (!apiKey) return { ok: false as const, error: 'ARK_API_KEY not configured' }
    const model = requested || defaultModel

    const result = await callSeedreamImages(
      { model, prompt, image: data.referenceImageUrl, size: normalizeSeedreamSize(size), output_format: 'png', watermark: false },
      apiKey,
      baseUrl,
      I2I_TIMEOUT_MS,
    )
    if (!result.url) {
      // 中文错误映射(保持跟原来一致的用户体验)
      if (/401/i.test(result.error || '')) return { ok: false as const, error: 'Seedream auth failed (401)' }
      if (/402/i.test(result.error || '')) return { ok: false as const, error: 'no_credits' }
      if (/timed out/i.test(result.error || '')) return { ok: false as const, error: 'AI 处理超时(>180s),请重试或换更简单的修改' }
      return { ok: false as const, error: result.error || 'Seedream 未返回图片' }
    }
    return { ok: true as const, url: result.url, model: result.model }
  })

// ====================================================================
// 3) generateStoryboardShotImage —— 多图融合 I2I(分镜)
//
//   Seedream 的 image 接受 string[]。参考图顺序:先所有角色,再场景。
//   prompt builder 平移自 storyboard.functions.ts:407-454。
// ====================================================================

const ShotInput = z.object({
  plotText: z.string().min(1).max(2000),
  shotType: z.enum(['WS', 'MS', 'CU', 'ECU', 'OTS']),
  shotTypeLabel: z.string().min(1).max(20),
  action: z.string().min(1).max(400),
  camera: z.string().max(200).default(''),
  // Seedream 实际接受更多张(经验上 ≤4 稳定),这里跟老代码一样守住 ≤3 防意外
  characterImageUrls: z.array(z.string().url()).max(3).default([]),
  characterNames: z.array(z.string().max(50)).max(3).default([]),
  sceneImageUrl: z.string().url().optional(),
  sceneLocation: z.string().max(200).default(''),
  sceneTimeOfDay: z.string().max(50).default(''),
  projectStyle: z.string().max(50).optional(),
  model: z.string().max(100).optional(),
  // 2026/06:查看提示词模式
  previewOnly: z.boolean().default(false),
})

export type ShotInputType = z.infer<typeof ShotInput>

function buildShotInstruction(data: ShotInputType, styleSpec: VisualStyleSpec): string {
  const charRefs = data.characterImageUrls.length
    ? data.characterImageUrls
        .map((_, i) => `图${i + 1} = 「${data.characterNames[i] || `角色${i + 1}`}」`)
        .join(', ')
    : ''
  const sceneRef = data.sceneImageUrl
    ? `图${data.characterImageUrls.length + 1} = 场景(${data.sceneLocation || '当前场景'}${data.sceneTimeOfDay ? ' / ' + data.sceneTimeOfDay : ''})`
    : ''

  return [
    `[任务] 生成一张「${data.shotTypeLabel}」分镜图,严格按下面的融合规则。`,
    ``,
    `[剧情上下文] ${data.plotText}`,
    `[本镜头] ${data.shotType} ${data.shotTypeLabel} —— ${data.action}`,
    data.camera ? `[机位] ${data.camera}` : '',
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
    data.shotType === 'WS'
      ? `   - 远景:人物在画面中占比较小,环境占据画面主体;展示空间感、地理关系、整体氛围。`
      : data.shotType === 'MS'
        ? `   - 中景:人物从膝盖以上,展示肢体语言和主要动作;既能看到人物也能看到周围环境。`
        : data.shotType === 'CU'
          ? `   - 近景:人物胸部以上,重点是表情、眼神、情绪;环境退到背景。`
          : data.shotType === 'ECU'
            ? `   - 特写:画面聚焦在某个细节(眼睛、嘴唇、手、道具),情绪张力最强。`
            : `   - 过肩:从某人肩膀后面拍另一人,常用于对话场景,有空间纵深。`,
    `4. 画面必须是单张分镜图,不能有面板分割、文字、标号。`,
    `5. 角色动作 / 表情 / 视线方向严格按本镜头的"${data.action}"执行。`,
    ``,
    buildStyleLock(styleSpec, 'panel'),
  ].filter(Boolean).join('\n')
}

function buildShotNegative(): string {
  return [
    'different art style, style drift, photorealistic when input is anime, anime when input is realistic, different medium, different line treatment, different color grading',
    'multiple panels, panel, grid, storyboard template, before/after, comparison, text, watermark, logo, signature, label, caption, annotation, arrow, callout',
    'different face, different face shape, different eye shape, different eye color, different nose, different mouth, different eyebrows, different skin tone, different hairstyle, different hair color, different hair length, different outfit, different clothing color, different accessories, different age',
    'medium shot when shot type is full body, close-up when shot type is mid, headshot, bust, half body, cropped at feet, missing feet, missing legs',
    'extreme low angle, worm\'s eye view, hero shot, extreme dutch angle, fisheye, wide-angle distortion',
    'extra people, bystander, crowd, extra limbs, deformed hands, extra fingers, blurred face, low quality',
  ].join(', ')
}

export const generateStoryboardShotImage = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => ShotInput.parse(d))
  .handler(async ({ data }) => {
    const { resolveProjectStyle } = await import('./visualStyles')
    const styleSpec = resolveProjectStyle(data.projectStyle)

    const images: string[] = []
    data.characterImageUrls.forEach((url) => { if (url) images.push(url) })
    if (data.sceneImageUrl) images.push(data.sceneImageUrl)

    if (!images.length) {
      return { ok: false as const, error: '缺少参考图(至少需要一张角色图或场景图)' }
    }
    if (images.length > 4) {
      return { ok: false as const, error: `参考图过多(${images.length} 张,Seedream 最多 4 张)。请减少该分镜涉及的角色数。` }
    }

    const instruction = buildShotInstruction(data, styleSpec)
    const negative = buildShotNegative()

    const requested = normalizeImageModelForRouting(data.model)
    // 委托给 Pixflow(gpt-image-2 / gemini 图像模型)。gpt-image-* 有参考图时
    // 在 pixflow.functions.ts 内部切到 /v1/images/edits,避免误走 ARK/Seedream。
    {
      const { isLovableGatewayImageModel, callLovableGatewayImage } = await import('./lovableImage.functions')
      if (isLovableGatewayImageModel(requested)) {
        const r = await callLovableGatewayImage({
          prompt: appendNegative(instruction, negative),
          model: requested,
          size: '2K',
          referenceImages: images,
        })
        if (!r.url) return { ok: false as const, error: r.error || 'Lovable Gateway 未返回图片' }
        return { ok: true as const, url: r.url, model: r.model }
      }
    }
    if (requested.toLowerCase().startsWith('pixflow/')) {
      const { callPixflowImage } = await import('./pixflow.functions')
      const r = await callPixflowImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: '2K',
        referenceImages: images,
      })
      if (!r.url) return { ok: false as const, error: r.error || 'Pixflow 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    // generateStoryboardShotImage: 委托给 Tokenflash(OpenAI 兼容,api.tokenflash.cn)
    if (requested.toLowerCase().startsWith('tokenflash/')) {
      const { callTokenflashImage } = await import('./tokenflash.functions')
      const r = await callTokenflashImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: '2K',
        referenceImages: images,
      })
      if (!r.url) return { ok: false as const, error: r.error || 'Tokenflash 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    if (requested.toLowerCase().startsWith('aigcfamily/')) {
      const { callAIGCFamilyImage } = await import('./aigcfamilyImage.functions')
      const r = await callAIGCFamilyImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: '2K',
        referenceImages: images,
      })
      if (!r.url) return { ok: false as const, error: r.error || 'AIGCFamily 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    // generateStoryboardShotImage: 委托给 OneToken(OpenAI 兼容,api.onetoken.one)
    if (requested.toLowerCase().startsWith('onetoken/')) {
      const { callOnetokenImage } = await import('./onetokenImage.functions')
      const r = await callOnetokenImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: '2K',
      })
      if (!r.url) return { ok: false as const, error: r.error || 'OneToken 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    // generateStoryboardShotImage: 委托给 OTU(OpenAI 兼容)
    if (requested.toLowerCase().startsWith('otu/')) {
      const { callOtuImage } = await import('./otuImage.functions')
      const r = await callOtuImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: '2K',
        referenceImages: images,
      })
      if (!r.url) return { ok: false as const, error: r.error || 'OTU 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    // generateStoryboardShotImage: 委托给 legacy(Qwen / Wan / OpenRouter 等)
    if (requested && !isSeedreamModel(requested) && !requested.toLowerCase().startsWith('lovable/')) {
      const { generateImage: legacy } = await import('./openrouterImage.functions')
      const r: any = await legacy({
        data: {
          prompt: appendNegative(instruction, negative),
          model: requested,
          size: '1328*1328',
          negativePrompt: negative,
        },
      } as any)
      if (!r?.url) return { ok: false as const, error: r?.error || 'Legacy 模型未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }

    const { apiKey, baseUrl, model: defaultModel } = getArkConfig()
    if (!apiKey) return { ok: false as const, error: 'ARK_API_KEY not configured' }
    const model = requested || defaultModel
    const prompt = appendNegative(instruction, negative)

    // 2026/06:查看提示词模式
    if (data.previewOnly) {
      return {
        ok: true as const,
        previewPrompt: prompt,
        negativePrompt: negative,
        promptSize: '2K',
        promptExtra: { model, route: 'I2I 分镜图', refImages: images.join(' / ') },
      } as any
    }

    const result = await callSeedreamImages(
      { model, prompt, image: images, size: '2K', output_format: 'png', watermark: false },
      apiKey,
      baseUrl,
      I2I_TIMEOUT_MS,
    )
    if (!result.url) {
      if (/401/i.test(result.error || '')) return { ok: false as const, error: 'Seedream auth failed (401)' }
      if (/402/i.test(result.error || '')) return { ok: false as const, error: 'no_credits' }
      if (/timed out/i.test(result.error || '')) return { ok: false as const, error: 'AI 处理超时(>180s)' }
      return { ok: false as const, error: result.error || 'Seedream 未返回图片' }
    }
    return { ok: true as const, url: result.url, model: result.model }
  })

// ====================================================================
// 4) regenerateStoryboardShot —— 多图融合 I2I(分镜按意见重生)
//
//   图 1 永远是 referenceImageUrl(当前镜头),后面是角色/场景参考。
//   Seedream 一次最多 4 张,这里守住 3 张(给 ref + 1 char + 1 scene)或
//   ref + 2 char,跟老代码逻辑一致。
// ====================================================================

const RegenShotInput = ShotInput.extend({
  referenceImageUrl: z.string().url(),
  userInstruction: z.string().min(1).max(500),
})

export type RegenShotInputType = z.infer<typeof RegenShotInput>

function buildRegenShotInstruction(data: RegenShotInputType, styleSpec: VisualStyleSpec, usedCharCount: number, hasScene: boolean): string {
  const charRefs = usedCharCount > 0
    ? usedCharCount === 1
      ? `图2 = 「${data.characterNames[0] || '角色'}」(脸/衣服锁定)`
      : `图2..${1 + usedCharCount} = ${usedCharCount} 个角色(脸/衣服锁定)`
    : ''
  const sceneRef = hasScene
    ? `图${1 + usedCharCount + 1} = 场景(${data.sceneLocation || '当前场景'}${data.sceneTimeOfDay ? ' / ' + data.sceneTimeOfDay : ''})`
    : ''

  return [
    `[任务] 修改「图1」(当前分镜镜头),严格按下面的"修改意见"调整,只改用户提到的部分。`,
    ``,
    `[修改意见] ${data.userInstruction}`,
    ``,
    `[剧情上下文] ${data.plotText}`,
    `[本镜头] ${data.shotType} ${data.shotTypeLabel} —— ${data.action}`,
    data.camera ? `[机位] ${data.camera}` : '',
    ``,
    `[参考图清单(严格按下面的对应关系使用)]`,
    `图1 = 当前分镜镜头(要被修改的)`,
    charRefs,
    sceneRef,
    ``,
    `[修改规则 — 必须遵守]`,
    `1. 以图1为基础,在它的构图 / 景别 / 风格上修改,**不要重新构图或换景别**。`,
    `2. 只调整"修改意见"里明确提到的元素;没提到的部分(角色脸/衣服、场景、构图、视角、风格)全部保留图1的样子。`,
    `3. ${usedCharCount > 0 ? `图 2..N 的角色是参考,他们的脸/身材/衣服必须跟图1 一致(不能换脸)。` : '本镜头没有角色参考,只改场景/构图相关的部分。'}`,
    hasScene ? `4. 场景构图 / 光照沿用图1 当前的样子(场景参考图只是兜底,跟图1 冲突时以图1 为准)。` : '',
    `5. 保持单张分镜图,不能有面板分割、文字、标号。`,
    ``,
    buildStyleLock(styleSpec, 'panel'),
  ].filter(Boolean).join('\n')
}

export const regenerateStoryboardShot = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => RegenShotInput.parse(d))
  .handler(async ({ data }) => {
    const { resolveProjectStyle } = await import('./visualStyles')
    const styleSpec = resolveProjectStyle(data.projectStyle)

    // 图 1 永远是 referenceImageUrl,后面再塞角色/场景参考。
    // Seedream 限 4 张,跟老代码一致守住 3 张上限。
    const hasScene = !!data.sceneImageUrl
    const maxChars = Math.max(0, 3 - 1 - (hasScene ? 1 : 0))
    const usedCharCount = Math.min(data.characterImageUrls.length, maxChars)
    const images: string[] = [data.referenceImageUrl]
    for (let i = 0; i < usedCharCount; i++) {
      const url = data.characterImageUrls[i]
      if (url) images.push(url)
    }
    if (hasScene) images.push(data.sceneImageUrl!)

    if (images.length > 4) {
      return { ok: false as const, error: `参考图过多(${images.length} 张,Seedream 最多 4 张)。` }
    }

    const instruction = buildRegenShotInstruction(data, styleSpec, usedCharCount, hasScene)
    const negative = buildShotNegative()

    const requested = normalizeImageModelForRouting(data.model)
    {
      const { isLovableGatewayImageModel, callLovableGatewayImage } = await import('./lovableImage.functions')
      if (isLovableGatewayImageModel(requested)) {
        const r = await callLovableGatewayImage({
          prompt: appendNegative(instruction, negative),
          model: requested,
          size: '2K',
          referenceImages: images,
        })
        if (!r.url) return { ok: false as const, error: r.error || 'Lovable Gateway 未返回图片' }
        return { ok: true as const, url: r.url, model: r.model }
      }
    }
    if (requested.toLowerCase().startsWith('pixflow/')) {
      const { callPixflowImage } = await import('./pixflow.functions')
      const r = await callPixflowImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: '2K',
        referenceImages: images,
      })
      if (!r.url) return { ok: false as const, error: r.error || 'Pixflow 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    if (requested.toLowerCase().startsWith('tokenflash/')) {
      const { callTokenflashImage } = await import('./tokenflash.functions')
      const r = await callTokenflashImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: '2K',
        referenceImages: images,
      })
      if (!r.url) return { ok: false as const, error: r.error || 'Tokenflash 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    if (requested.toLowerCase().startsWith('aigcfamily/')) {
      const { callAIGCFamilyImage } = await import('./aigcfamilyImage.functions')
      const r = await callAIGCFamilyImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: '2K',
        referenceImages: images,
      })
      if (!r.url) return { ok: false as const, error: r.error || 'AIGCFamily 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    if (requested.toLowerCase().startsWith('onetoken/')) {
      const { callOnetokenImage } = await import('./onetokenImage.functions')
      const r = await callOnetokenImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: '2K',
      })
      if (!r.url) return { ok: false as const, error: r.error || 'OneToken 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    if (requested.toLowerCase().startsWith('otu/')) {
      const { callOtuImage } = await import('./otuImage.functions')
      const r = await callOtuImage({
        prompt: appendNegative(instruction, negative),
        model: requested,
        size: '2K',
        referenceImages: images,
      })
      if (!r.url) return { ok: false as const, error: r.error || 'OTU 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    if (requested && !isSeedreamModel(requested)) {
      const { generateImage: legacy } = await import('./openrouterImage.functions')
      const r: any = await legacy({
        data: {
          prompt: appendNegative(instruction, negative),
          model: requested,
          size: '1328*1328',
          negativePrompt: negative,
        },
      } as any)
      if (!r?.url) return { ok: false as const, error: r?.error || 'Legacy 模型未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }

    const { apiKey, baseUrl, model: defaultModel } = getArkConfig()
    if (!apiKey) return { ok: false as const, error: 'ARK_API_KEY not configured' }
    const model = requested || defaultModel
    const prompt = appendNegative(instruction, negative)

    // 2026/06:查看提示词模式
    if (data.previewOnly) {
      return {
        ok: true as const,
        previewPrompt: prompt,
        negativePrompt: negative,
        promptSize: '2K',
        promptExtra: { model, route: 'I2I 分镜重生', userInstruction: data.userInstruction, refImages: images.join(' / ') },
      } as any
    }

    const result = await callSeedreamImages(
      { model, prompt, image: images, size: '2K', output_format: 'png', watermark: false },
      apiKey,
      baseUrl,
      I2I_TIMEOUT_MS,
    )
    if (!result.url) {
      if (/401/i.test(result.error || '')) return { ok: false as const, error: 'Seedream auth failed (401)' }
      if (/402/i.test(result.error || '')) return { ok: false as const, error: 'no_credits' }
      if (/timed out/i.test(result.error || '')) return { ok: false as const, error: 'AI 处理超时(>180s)' }
      return { ok: false as const, error: result.error || 'Seedream 未返回图片' }
    }
    return { ok: true as const, url: result.url, model: result.model }
  })

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
})

const PitchDeckShotSchema = z.object({
  shotType: z.enum(['WS', 'MS', 'CU', 'ECU', 'OTS']),
  shotTypeLabel: z.string().min(1).max(20),
  action: z.string().min(1).max(400),
  camera: z.string().max(200).default(''),
  durationSec: z.number().optional(),
  // 2026/06 新增:用户要求每帧标注时长,把 shot 自身的时间区间也传过来
  startSec: z.number().optional(),
  endSec: z.number().optional(),
})

const PitchDeckInput = z.object({
  projectStyle: z.string().max(50).optional(),
  groupLabel: z.string().max(200).optional(),
  plotText: z.string().min(1).max(2000),
  scene: z.object({
    slug: z.string().max(200).optional(),
    location: z.string().max(200).optional(),
    timeOfDay: z.string().max(50).optional(),
    profile: z.string().max(2000).optional(),
  }).optional(),
  // 2026/06:之前 .max(3) 偷偷砍数据 —— 大场面组 4-6 角色会被丢一半。
  // 文字描述无 token 压力,放到 8;图片层面另有 .max(4) 上限(下面)
  characters: z.array(PitchDeckCharacterSchema).max(8).default([]),
  // 2026/06:之前 .max(3) 配合 normalizeGroup 的 .slice(0, 3)。后者已撤,
  // 这里也放到 20,避免 Zod 直接 reject 整个故事板请求
  shots: z.array(PitchDeckShotSchema).max(20).default([]),
  // 2026/06:故事板 I2I 参考图 —— 用户反映"故事板不按我设定的人物形象/场景画"。
  // 根因是之前不传 image 字段,纯 T2I。改成传入参考图(场景至少 1 张 + 角色若干)。
  // 客户端按 "场景必占 1 张,剩余给角色" 的优先级挑出最多 4 张(Seedream 上限),
  // 每张配一个 label,在 prompt 里说明"图 N 是 X"。
  referenceImages: z.array(z.string().url()).max(4).default([]),
  referenceImageLabels: z.array(z.string().max(120)).max(4).default([]),
  // 老字段保留向后兼容,不再实际使用
  characterImageUrl: z.string().url().optional(),
  sceneImageUrl: z.string().url().optional(),
  model: z.string().max(100).optional(),
  // 2026/06:查看提示词模式
  previewOnly: z.boolean().default(false),
})

export type PitchDeckInputType = z.infer<typeof PitchDeckInput>

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
  data: PitchDeckInputType
  styleSpec: { label: string; positive: string; negative: string }
}): string {
  const { data, styleSpec } = opts
  const chars = data.characters || []
  const shots = data.shots || []
  const shotCount = shots.length

  // ====================================================================
  // 2026/06 用户重写:从"9:16 竖屏漫剧多格分镜"改成"16:9 横向导演预制作指南"。
  // 整张图是一个 director's pre-production guide / pitch deck 风格,
  // 多个清晰分节(共享创意指导 / 角色与风格参考 / 环境与场景设计 / 故事板帧 /
  // 灯光情绪 / 关键词 / 音频音调 / 电影摄影笔记),
  // 简洁基于网格,电影化、专业、连贯,像递到导演手里的一页设定。
  //
  // 关键约束:
  //   - 故事板帧严格按本组剧情(plotText)+ AI 扩写的 shots 来展开,不允许
  //     模型自己虚构"另一个剧情"
  //   - 角色身份严格按 [CHARACTERS] 描述,允许细微变化(表情/姿态),
  //     不允许换脸/换服装
  //   - 不限制故事板帧数,根据 shots 数自调(SUGGESTED_PANELS)
  // ====================================================================

  // 推荐故事板帧数:shots 数 clamp 到 4-10
  const SUGGESTED_PANELS = Math.min(10, Math.max(4, shotCount || 6))

  // 2026/06:参考图说明块。客户端会按 "场景至少 1 张 + 角色若干 ≤ 4 总数" 传图,
  // 每张配 label(如 "场景: 教室,夜","角色: 陆深 主角")。在 prompt 里告诉
  // 模型每张图代表什么,让 Seedream 把它们正确融合到 Section 2(角色)/3(场景)。
  //
  // **2026/06 二次强化**:不只是 identity 锁定,还要**画风 / 渲染技法**继承。
  // 用户反映"故事板画风跟参考图对不上",所以这块加更狠的画风指令 —— 让模型把
  // 参考图当作 "this exact look" 的视觉真值,storyboard 内所有插画都要复现
  // 参考图的线条 / 笔触 / 色饱和度 / 阴影方式 / 渲染层次。
  const refImgs = data.referenceImages || []
  const refLabels = data.referenceImageLabels || []
  const referenceImageBlock = refImgs.length
    ? [
        `[REFERENCE IMAGES — ${refImgs.length} 张视觉锚点,**最高真值**,严格遵循]`,
        ...refImgs.map((_, i) => `  Image ${i + 1}: ${refLabels[i] ?? '(no label)'}`),
        ``,
        `【身份锁定 / IDENTITY LOCK】`,
        `Section 2(角色与风格参考):同一个角色出现在故事板里时,脸 / 身材 / 服装 / 发型 / 配饰必须严格复制对应"角色"参考图,不允许换脸 / 换服装 / 换发色。`,
        `Section 3(环境与场景设计):场景 establishing shot 和俯视示意图都基于"场景"参考图的地点、布局、关键道具、光照氛围,不允许虚构出参考图里没有的建筑或环境元素。`,
        `Section 5(故事板帧):每一帧里出现的角色按对应参考图来画;场景沿用参考图的环境基调。`,
        ``,
        `【画风继承 / STYLE INHERITANCE — 这是关键,跟身份锁定同等优先级】`,
        `整张故事板的**所有插画**(Section 2 角色卡、Section 3 establishing shot、Section 5 每一帧 storyboard thumbnail)必须复现参考图的视觉风格:`,
        `  • 线条质感(粗细 / 利落度 / 是否带轮廓线)`,
        `  • 上色技法(平涂 / cel-shading / 厚涂 / 水彩 / 数码插画)`,
        `  • 色彩饱和度与色温(暖 / 冷 / 高饱 / 低饱 / 退色感)`,
        `  • 阴影方式与层次(硬光 / 软光 / 单色阴影 / 多层渐变)`,
        `  • 整体写实程度(写实照片 / 半写实 / 卡通 / anime / 漫画)`,
        `如果参考图是 anime 风,故事板所有插画也必须 anime;如果参考图是写实风,所有插画必须写实。**绝对禁止**故事板出 cel-shading 风但参考图是写实风,或反之。每一格 thumbnail 看起来都要像"从同一张参考图里裁出来的角度"。`,
        `俯视示意图(Section 3b)是技术性线稿,允许用更简化的线条风格(但仍跟整体调色协调),不强制复现参考图的上色技法。`,
      ].join('\n')
    : '[REFERENCE IMAGES] (none provided — 按 [CHARACTERS] 文字描述 + [STYLE LOCK] 风格指纹生成,角色/场景细节可能不完全匹配项目设定)'

  // 已有 shot 描述(模型据此填每个 panel + 显示每帧时长)
  const shotLines = shots.map((s, i) => {
    const cam = s.camera ? ` | camera: ${s.camera}` : ''
    // 2026/06:每帧时长标注 —— 优先用 startSec/endSec 算精确时长,否则用 durationSec
    const dur = (s.startSec != null && s.endSec != null)
      ? ` | ${s.startSec.toFixed(0)}-${s.endSec.toFixed(0)}s (${(s.endSec - s.startSec).toFixed(0)}s)`
      : s.durationSec ? ` | duration: ${s.durationSec}s` : ''
    return `  Frame ${i + 1}: [${s.shotTypeLabel}] ${s.action}${cam}${dur}`
  }).join('\n')

  // 角色描述块
  const charLines = chars.map((c, i) => {
    const role = c.roleLabel ? ` (${c.roleLabel}` : ''
    const age = c.age !== undefined ? `, age ${c.age}` : ''
    const palette = c.palette?.length ? ` | palette: ${c.palette.join(', ')}` : ''
    return [
      `  Character ${i + 1}: ${c.name}${role ? role : ''}${age ? age : ''}${c.roleLabel ? ')' : ''}`,
      c.faceDescription ? `    Face: ${c.faceDescription}` : '',
      c.bodyDescription ? `    Body: ${c.bodyDescription}` : '',
      c.clothingDescription ? `    Outfit: ${c.clothingDescription}` : '',
      palette ? `    ${palette}` : '',
    ].filter(Boolean).join('\n')
  }).join('\n')

  // 场景描述块
  const sceneLine = data.scene
    ? [
        data.scene.location ? `  Location: ${data.scene.location}` : '',
        data.scene.timeOfDay ? `  Time: ${data.scene.timeOfDay}` : '',
        data.scene.profile ? `  Description: ${data.scene.profile}` : '',
      ].filter(Boolean).join('\n')
    : '  (no specific scene — use the plot context to infer)'

  return [
    // ========== 任务总述 ==========
    `[MISSION] Create a 16:9 STORYBOARD / DIRECTOR'S PRE-PRODUCTION GUIDE for the scene described below. ONE single image, landscape orientation, organized like a professional pitch deck page that a director hands to the production team. The layout is clean, grid-based, divided into clearly LABELED sections (Chinese-first with optional small English subtitles). It must feel cohesive, cinematic, and professionally designed — communicating tone, pacing, and visual storytelling at a glance.`,

    `[PRIMARY GOAL] This storyboard will be **directly consumed by a downstream video-generation model** as the structural & visual reference. Every shot, camera type, motion description, timing, mood note, and character anchor on this page must be unambiguous and machine-readable. Text descriptions stay TERSE but PERFECTLY LEGIBLE — short is good, garbled is fatal.`,

    `[ASPECT RATIO] Strictly 16:9 LANDSCAPE.`,

    // ========== 文字可读性(关键)==========
    `[TEXT READABILITY — TOP PRIORITY, this storyboard is text-readability-first]`,
    `- ALL Chinese text must be CRISP, SHARP, ACCURATE, IMMEDIATELY READABLE. No garbled glyphs, no fake/pseudo characters, no smeared strokes, no unreadable handwriting.`,
    `- 分区标题 (section titles), 镜头编号 (shot numbers), 角色角度标签 (character angle labels) MUST be visibly LARGE and BOLD — far larger than body text. Title hierarchy is OBVIOUS at a glance.`,
    `- 每个分镜帧的文字说明 ≤ 1–2 LINES of brief Chinese. NO long paragraphs inside frame captions. Density via short tags (e.g. "35mm 广角 · 跟拍 · 急促 · 4s"), not prose.`,
    `- High contrast: dark text on clean white / very light grey background. Plenty of white space.`,
    `- Use a clean printed font family (思源宋体 / 思源黑体 / Noto Sans / Songti). NEVER comic / decorative / pseudo-handwritten fonts. Print-grade typography only.`,

    // ========== 全局布局 ==========
    `[OVERALL LAYOUT — top to bottom, all on ONE page, grid-aligned]`,
    `1) 顶部栏 · SHARED CREATIVE DIRECTION (full-width strip, ~10% height)`,
    `2) 中部左 · CHARACTER & STYLE REFERENCE (~30% width)`,
    `3) 中部中 · ENVIRONMENT & SCENE DESIGN (~35% width)`,
    `4) 中部右 · LIGHTING / MOOD / STYLE NOTES + MOOD KEYWORDS (~35% width, stacked)`,
    `5) 下半区 · STORYBOARD FRAMES (full-width grid)`,
    `6) 底部栏 · AUDIO / TONE + CINEMATOGRAPHY NOTES (split, full width, ~12% height)`,
    `Each section has a clear LARGE Chinese title (with small English subtitle), thin neutral dividers (#E8E8E8) separating sections. No overlap, no clutter. Generous gutters.`,

    // ========== 1. 共享创意指导 ==========
    `[SECTION 1 — 共享创意指导 / SHARED CREATIVE DIRECTION (top bar)]`,
    `A horizontal strip carrying overall scene constraints (terse):`,
    `  • 镜头数量 / Shot count: ${SUGGESTED_PANELS} 帧 (depends on plot density)`,
    `  • 统一调色板 / Unified palette: 3–5 small color swatches with hex labels, derived from project visual style "${styleSpec.label}"`,
    `  • 一般环境背景 / General environmental backdrop: ONE short Chinese sentence (≤ 20 字) describing world / time / weather`,
    `Tone: confident, terse, director's opening note style.`,

    // ========== 2. 角色与风格参考 ==========
    `[SECTION 2 — 角色与风格参考 / CHARACTER & STYLE REFERENCE]`,
    `For each character in [CHARACTERS], a multi-angle reference grid:`,
    `  • 五个角度 / five angles per character: 正面 (front) · 背面 (back) · 侧面 (side) · 特写 (close-up face) · 放松姿态 (relaxed standing pose)`,
    `  • Each angle is a small thumbnail with a LARGE clear Chinese label below it ("正面" / "背面" / etc.)`,
    `  • A small "服装与配饰 / Costume & Accessories" callout box listing key clothing items and props in 1–2 brief Chinese lines`,
    `STRICT identity consistency — face / hair / outfit / accessories MUST 100% match [CHARACTERS] descriptions. Subtle expression / posture / angle variation allowed within the scene; identity drift NOT.`,

    // ========== 3. 环境与场景设计 ==========
    `[SECTION 3 — 环境与场景设计 / ENVIRONMENT & SCENE DESIGN]`,
    `Two parts stacked vertically:`,
    `  (3a) ESTABLISHING SHOT: A larger illustrated wide shot of the location, capturing its dramatic features (mountains / urban skyline / interior atmosphere / weather). No characters, environment only.`,
    `  (3b) 俯视示意图 / TOP-DOWN DIAGRAM: an overhead map view of the same location in clean simple linework + light shading. Includes:`,
    `       - Character(s) movement path through the space (dotted/dashed line with small arrows)`,
    `       - Numbered camera positions along the route (📷1, 📷2, … matching the storyboard frames below in Section 5)`,
    `       - Each camera position labeled with shot type (广角 WS / 中景 MS / 特写 CU / 过肩 OTS / 微距 ECU)`,
    `Layout the diagram below or beside the establishing shot. Both clearly labeled in Chinese.`,

    // ========== 4. 灯光/情绪/风格备注 + 关键词 ==========
    `[SECTION 4 — 灯光 / 情绪 / 风格备注 / LIGHTING · MOOD · STYLE NOTES]`,
    `Two stacked sub-blocks:`,
    `  (4a) 灯光与情绪 / LIGHTING & MOOD: 2–3 small visual swatches showing lighting conditions (e.g. 黄昏暖光 / 雨夜冷光 / 室内顶光) with **short** Chinese descriptions (≤ 15 字 each) covering:`,
    `       - 光线质量变化 / Light quality shifts (warm→cold / hard→soft / bright→dim)`,
    `       - 一天中不同时间过渡 / Time-of-day transitions if applicable`,
    `       - 环境变化 / Environmental shifts if applicable (下雨 rain / 着火 fire / 刮风 wind / 起雾 fog / 落雪 snow)`,
    `  (4b) 情绪与关键词 / MOOD & KEYWORDS: 4–7 concise Chinese mood / tone / theme tag chips (e.g. 孤独 / 紧张 / 温柔 / 悬疑 / 希望 / 危机 / 平静) arranged as small rounded chips on a light background.`,

    // ========== 5. 故事板帧 ==========
    `[SECTION 5 — 故事板帧 / STORYBOARD FRAMES (main grid, full-width, the most prominent section)]`,
    `A grid of numbered storyboard frames. **数量按 [SHOT BREAKDOWN] 决定 — one frame per shot listed below**. Frames laid out left-to-right, top-to-bottom, reading order obvious.`,
    `Each frame contains:`,
    `  • A CINEMATIC THUMBNAIL with the actual scene visualized (faithful to [STORY PLOT] + the corresponding shot's action)`,
    `  • A LARGE prominent shot number label: "镜头 1" / "镜头 2" / etc. — far bigger than body text`,
    `  • A tight info strip beneath the thumbnail with these tags (each ≤ 8 字, separated by " · "):`,
    `      ⏱ 时长 (duration in seconds, e.g. "4s")`,
    `      🎬 镜头类型 / lens (e.g. "35mm 广角" / "85mm 长焦" / "鱼眼")`,
    `      📐 景别 / shot size (广角 / 中景 / 特写 / 微距)`,
    `      🎥 运动 / motion (静态 / 跟拍 / 手持 / 推镜 / 摇镜 / 升降)`,
    `      🎭 动作+情绪 (1 short Chinese line ≤ 12 字: 什么人做什么 + 当下情绪)`,
    `**Each frame's caption is BRIEF (1–2 lines total in tag form)** — no prose. Frames must be derived from [STORY PLOT] and [SHOT BREAKDOWN] below — do NOT invent unrelated frames.`,

    // ========== 6. 音频/音调 + 电影摄影笔记 ==========
    `[SECTION 6 — 底部栏 BOTTOM BAR (two sub-blocks side-by-side)]`,
    `  (6a) 音频 / 音调 / AUDIO · TONE: ambient sounds (环境声), music style (音乐风格), overall sonic atmosphere (整体声音氛围) — a compact Chinese bullet list with small icons (🔊 / 🎵 / 🌀) next to each line. Each line ≤ 15 字.`,
    `  (6b) 电影摄影笔记 / CINEMATOGRAPHY NOTES: lens characteristics (镜头特性), motion style (运动风格), post-processing feel (后期处理感觉) — 3 short Chinese sentences (≤ 20 字 each) capturing visual philosophy.`,

    // ========== 内容(真值)==========
    // 2026/06 加入:参考图说明放在 [STORY PLOT] 之前,
    // 让模型把"图 N 是 X" 当成 identity lock 的硬约束读入
    referenceImageBlock,

    // 2026/06 二次强化:把 [STYLE LOCK] 提到紧邻 referenceImageBlock 下方,
    // 让"风格指纹 + 参考图画风继承"作为一个连贯块被模型先读到,
    // 而不是被埋在 13 条 rule 中间。
    `[PROJECT VISUAL STYLE — 风格指纹,跟 [REFERENCE IMAGES] 的画风继承指令配套使用]`,
    buildStyleLock(styleSpec, 'deck'),
    refImgs.length
      ? `**优先级**:当 [REFERENCE IMAGES] 的实际画风与本风格指纹有冲突时,以 [REFERENCE IMAGES] 为准(参考图是最高真值)。本风格指纹用于补全参考图没说的维度(例如参考图没标颜色饱和度,就按指纹推断)。`
      : `没有参考图时,本风格指纹是唯一的画风真值,所有插画严格按 5 维度执行。`,

    `[STORY PLOT — 真值来源,故事板每一帧必须从这段剧情扩写而来,不允许虚构其他剧情]`,
    data.plotText,

    `[SCENE — 场景氛围,所有 frames + Environment 区域共用]`,
    sceneLine,

    `[CHARACTERS — 已设定的人物形象。Section 2 + storyboard frames 里所有人脸/服装/配饰必须 100% 匹配这里描述]`,
    charLines || '  (no specific characters — focus on environment and atmosphere)',

    `[SHOT BREAKDOWN — 已有 ${shotCount} 个镜头(AI 扩写产生);Section 5 的故事板帧严格按这些镜头展开]`,
    shotLines || `  (no explicit shots — derive all frames from the plot text above, in narrative order)`,

    // ========== 项目视觉风格 ==========
    // ========== 质量约束 ==========
    `[QUALITY RULES — 违反任一条 = 重画]`,
    `RULE 1 — ASPECT 16:9 LANDSCAPE: 必须严格横向 16:9。不允许 9:16 / 1:1 / 4:3。`,
    `RULE 2 — SIX-SECTION LAYOUT: 必须包含上述 6 大 section(共享创意指导 / 角色与风格参考 / 环境与场景设计 / 灯光情绪与关键词 / 故事板帧 / 底部音频与电影摄影),布局清晰、网格对齐、有中文标题。`,
    `RULE 3 — TEXT MUST BE CRISP AND READABLE (最高优先级): 所有中文文字必须锐利、清晰、准确、可读。严禁乱码、伪文字、模糊笔画、伪手写。分区标题 / 镜头编号 / 角度标签明显放大(字号 ≫ 正文)。使用清晰印刷字体(思源宋体 / 黑体 / Noto Sans),严禁装饰字体。下游视频生成模型要直接读这些文字,可读性 = 视频质量。`,
    `RULE 4 — BRIEF FRAME CAPTIONS: Section 5 每帧的文字说明 ≤ 1–2 行(标签形式),严禁长段落、严禁堆段落文字。所有描述用 " · " 分隔的短 tag(如 "35mm · 跟拍 · 急促 · 4s")。`,
    `RULE 5 — STORY FAITHFULNESS: 故事板帧严格按 [STORY PLOT] 和 [SHOT BREAKDOWN] 展开,不允许出现剧本之外的剧情或人物。AI 扩写的 shot action 是真值,模型把它**视觉化**,不要"再编一遍"。`,
    `RULE 6 — CHARACTER LOCK: 任一角色在 Section 2 和故事板帧里出现,脸 / 身 / 服 / 发 / 饰必须严格按 [CHARACTERS] 描述,允许微小表情/姿态变化,不允许换脸/换服装/换发型。**若 [REFERENCE IMAGES] 里有对应"角色"参考图,该参考图是 identity 的最高真值,文字描述次之。**`,
    `RULE 7 — FRAME COUNT MATCHES SHOTS: Section 5 帧数 = [SHOT BREAKDOWN] 列表里的 shot 数量(${shotCount || SUGGESTED_PANELS} 个)。每帧严格对应一个 shot,顺序一致。`,
    `RULE 8 — PER-FRAME DURATION: 每个故事板帧必须在标签条里清晰显示该镜头时长(秒,如 "4s" / "时长 4s"),时长来自 [SHOT BREAKDOWN] 给出的值。下游视频生成需要这个时间信息。`,
    `RULE 9 — STYLE LOCK + 画风继承: 全图统一项目视觉风格 "${styleSpec.label}",严禁混搭(动漫+写实 / 3D+2D / 水彩+cel-shading)。**若有 [REFERENCE IMAGES],storyboard 内所有插画(角色卡 + establishing shot + 每帧 thumbnail)必须复现参考图的具体画风**(线条质感 / 上色技法 / 色饱和度 / 阴影方式 / 写实程度),让人一眼看出是同一套美术资产。参考图与文字风格指纹冲突时,以参考图为准。`,
    `RULE 10 — CLEAN GRID + WHITE SPACE: section 之间用细中性分隔线(~#E8E8E8)分隔,留白充足,无装饰边框、无 logo、无水印、无外加 panel 编号或签名。背景干净(白色或极浅灰),高对比度文字。`,
    `RULE 11 — TOP-DOWN DIAGRAM PRESENT: Section 3 必须包含俯视示意图,带移动路径(虚线/箭头)+ 编号摄像机位置 + 镜头类型标注。`,
    `RULE 12 — ENVIRONMENTAL DETAILS IN SECTION 4: Section 4 灯光与情绪区必须涵盖光线质量变化 / 一天中时间过渡(若适用)/ 环境变化(若适用:下雨 / 着火 / 刮风 / 起雾 / 落雪 等)。这些细节会直接影响下游视频生成的氛围。`,
    `RULE 13 — HD QUALITY: 锐利、无糊、无低分辨率伪影。文字尤其要清晰到可被 OCR 准确读取。`,

    `Begin. Output the 16:9 director's pre-production storyboard page (${shotCount || SUGGESTED_PANELS} frames in Section 5, one per shot in [SHOT BREAKDOWN]).`,
  ].filter(Boolean).join('\n\n')
}

export const generateStoryboardPitchDeck = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => PitchDeckInput.parse(d))
  .handler(async ({ data }) => {
    const { resolveProjectStyle } = await import('./visualStyles')
    const styleSpec = resolveProjectStyle(data.projectStyle)
    // 2026/06:加 negative prompt 主攻 "文字乱码 / 文字模糊 / 伪手写"等
    // 文字渲染常见问题,呼应 prompt 里 RULE 3(文字最高优先级)。
    // **2026/06 二次强化**:加画风漂移 negative,防故事板插画跟参考图画风不一致
    const negative = [
      'garbled text, fake characters, pseudo Chinese, jumbled glyphs, broken strokes, illegible labels, blurry text, smeared text, distorted text, unreadable captions, mismatched font widths, comic font, decorative font, handwritten scribble',
      'long paragraphs inside frame captions, dense block text in frames, prose inside storyboard frames, walls of text, paragraph dump',
      'cluttered layout, overlapping sections, missing dividers, off-grid placement, no white space, busy decorative borders, ornate frames, gold filigree',
      'wrong aspect ratio, vertical 9:16, square 1:1, 4:3, portrait orientation',
      'extra characters not in [CHARACTERS], scenery not in [SCENE], invented plot, frames unrelated to [SHOT BREAKDOWN]',
      'low resolution, blurry, pixelated, JPEG artifacts, low quality, soft focus on text',
      'missing top-down diagram in Section 3, missing camera position numbers, missing shot type labels in diagram',
      'frames without duration label, frames without shot number, frames without motion tag, frames without camera tag',
      // 画风漂移 / 不继承参考图
      'art style drift from reference images, inconsistent rendering across sections, anime when reference is realistic, realistic when reference is anime, cel-shading when reference is painterly, 3D render when reference is 2D, watercolor when reference is digital illustration, different line treatment from reference, different color saturation from reference, different shading style from reference, mixed art styles, inconsistent brush strokes between frames, mixing 2D and 3D, mixing photoreal and stylized',
    ].join(', ')
    const prompt = appendNegative(buildPitchDeckPrompt({ data, styleSpec }), negative)

    const requested = normalizeImageModelForRouting(data.model)
    if (requested.toLowerCase().startsWith('pixflow/')) {
      const { callPixflowImage } = await import('./pixflow.functions')
      const r = await callPixflowImage({
        prompt,
        model: requested,
        size: '3840x2160',
        referenceImages: data.referenceImages || [],
        quality: 'high',
      })
      if (!r.url) return { ok: false as const, error: r.error || 'Pixflow 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    if (requested.toLowerCase().startsWith('tokenflash/')) {
      const { callTokenflashImage } = await import('./tokenflash.functions')
      const r = await callTokenflashImage({
        prompt,
        model: requested,
        size: '3840x2160',
        referenceImages: data.referenceImages || [],
        quality: 'high',
      })
      if (!r.url) return { ok: false as const, error: r.error || 'Tokenflash 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    if (requested.toLowerCase().startsWith('aigcfamily/')) {
      const { callAIGCFamilyImage } = await import('./aigcfamilyImage.functions')
      const r = await callAIGCFamilyImage({
        prompt,
        model: requested,
        size: '3840x2160',
        referenceImages: data.referenceImages || [],
        quality: 'high',
      })
      if (!r.url) return { ok: false as const, error: r.error || 'AIGCFamily 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    if (requested.toLowerCase().startsWith('onetoken/')) {
      const { callOnetokenImage } = await import('./onetokenImage.functions')
      const r = await callOnetokenImage({
        prompt,
        model: requested,
        size: '3840x2160',
      })
      if (!r.url) return { ok: false as const, error: r.error || 'OneToken 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    if (requested.toLowerCase().startsWith('otu/')) {
      const { callOtuImage } = await import('./otuImage.functions')
      const r = await callOtuImage({
        prompt,
        model: requested,
        size: '3840x2160',
        referenceImages: data.referenceImages || [],
      })
      if (!r.url) return { ok: false as const, error: r.error || 'OTU 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }

    const { apiKey, baseUrl, model: defaultModel } = getArkConfig()
    if (!apiKey) return { ok: false as const, error: 'ARK_API_KEY not configured' }
    const model = requested || defaultModel

    // 2026/06:查看提示词模式 —— 跳过实际生成
    if (data.previewOnly) {
      return {
        ok: true as const,
        previewPrompt: prompt,
        negativePrompt: negative,
        promptSize: '3840x2160',
        promptExtra: {
          model,
          route: '故事板 (Pitch Deck)',
          refImages: (data.referenceImages || []).join(' / ') || '(none)',
          characters: (data.characters || []).map((c) => c.name).join(', ') || '(none)',
          shotCount: String((data.shots || []).length),
        },
      } as any
    }

    // 2026/06 用户重写:从 9:16 竖屏漫剧分镜改成 16:9 横向导演预制作 pitch deck。
    // 起初 2560×1440 (3.69M pixels) 卡在 Seedream 最小像素门槛上;**2026/06 二次提升**
    // 到 **3840×2160** (16:9 4K, 8.29M pixels) —— 用户要求"文字可读性最高优先",
    // 高分辨率给中文文字 fidelity 留余量,小字/标签更不容易糊。
    //
    // 2026/06 三次改造:加 image 字段(场景 + 角色参考图,最多 4 张)。
    // 之前注释说"塞图会干扰 layout",实测不准 —— Seedream I2I 在多图 + 强 prompt
    // 引导下能正确把参考图融到 Section 2/3/5。客户端按"场景必占 1 张 +
    // 角色填剩余" 的顺序传 referenceImages,服务端透传到 image 字段。
    // 空数组时不传 image,退化回纯 T2I。
    const refImages = data.referenceImages || []
    const result = await callSeedreamImages(
      {
        model,
        prompt,
        ...(refImages.length ? { image: refImages.length === 1 ? refImages[0] : refImages } : {}),
        size: '3840x2160',
        output_format: 'png',
        watermark: false,
      },
      apiKey,
      baseUrl,
      I2I_TIMEOUT_MS,
    )
    if (!result.url) {
      if (/401/i.test(result.error || '')) return { ok: false as const, error: 'Seedream auth failed (401)' }
      if (/402/i.test(result.error || '')) return { ok: false as const, error: 'no_credits' }
      if (/timed out/i.test(result.error || '')) return { ok: false as const, error: 'AI 处理超时(>180s),设定稿内容多,建议重试' }
      return { ok: false as const, error: result.error || 'Seedream 未返回图片' }
    }
    return { ok: true as const, url: result.url, model: result.model }
  })

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
//       路径同样的 4 张上限
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
})

export type RegeneratePitchDeckInputType = z.infer<typeof RegeneratePitchDeckInput>

function buildRegenPitchDeckPrompt(opts: {
  data: RegeneratePitchDeckInputType
  styleSpec: VisualStyleSpec
}): string {
  const { data, styleSpec } = opts
  const chars = data.characters || []
  const shots = data.shots || []

  // 角色描述块(简化版,regen 主要靠参考图锁定)
  const charLines = chars.length
    ? chars.map((c) => `  · ${c.name}${c.roleLabel ? ` (${c.roleLabel})` : ''}: ${c.faceDescription || '(face from ref image)'}`).join('\n')
    : '  (no characters in this group)'

  const sceneLine = data.scene
    ? [
        data.scene.location ? `  Location: ${data.scene.location}` : '',
        data.scene.timeOfDay ? `  Time: ${data.scene.timeOfDay}` : '',
      ].filter(Boolean).join('\n') || '  (no scene info)'
    : '  (no specific scene)'

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
    `Plot: ${data.plotText || '(no plot text)'}`,
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
    // ========== 风格指纹 ==========
    `[PROJECT VISUAL STYLE — must match 图1's rendered style]`,
    buildStyleLock(styleSpec, 'deck'),
    ``,
    `[OUTPUT] Regenerate the entire 16:9 pre-production guide with the user's changes applied. One image, landscape.`,
  ].filter(Boolean).join('\n')
}

export const regenerateStoryboardPitchDeck = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => RegeneratePitchDeckInput.parse(d))
  .handler(async ({ data }) => {
    const { resolveProjectStyle } = await import('./visualStyles')
    const styleSpec = resolveProjectStyle(data.projectStyle)

    const prompt = buildRegenPitchDeckPrompt({ data, styleSpec })

    // 图 1 = 当前故事板(图布局 / 风格 / 文字位置的真值),后面跟原 referenceImages
    // 里的角色/场景参考图 —— 跟原 generate 共享同样 4 张上限
    const images: string[] = [data.referenceImageUrl]
    const extraRefs = data.referenceImages || []
    for (const url of extraRefs) {
      if (!url || url === data.referenceImageUrl) continue
      if (images.length >= 4) break
      images.push(url)
    }

    if (images.length > 4) {
      return { ok: false as const, error: `参考图过多(${images.length} 张,Seedream 最多 4 张)` }
    }

    // 路由:跟 generateStoryboardPitchDeck 完全对齐(Seedream 主力,
    // Pixflow/Lovable 不支持 4K 8.3M pixels 故跳过兜底)
    const requested = normalizeImageModelForRouting(data.model)
    if (requested && !isSeedreamModel(requested)) {
      return {
        ok: false as const,
        error: `故事板按意见重生目前只支持 Seedream 模型(用户选了 ${requested},Seedream 4K 是唯一能稳定输出 3840×2160 的)。`,
      }
    }

    const { apiKey, baseUrl, model: defaultModel } = getArkConfig()
    if (!apiKey) return { ok: false as const, error: 'ARK_API_KEY not configured' }
    const model = requested || defaultModel

    // 2026/06:查看提示词模式
    if (data.previewOnly) {
      return {
        ok: true as const,
        previewPrompt: prompt,
        negativePrompt: '',
        promptSize: '3840x2160',
        promptExtra: {
          model,
          route: 'I2I 故事板按意见重生',
          userInstruction: data.userInstruction,
          refImages: images.join(' / '),
        },
      } as any
    }

    const result = await callSeedreamImages(
      {
        model,
        prompt,
        image: images,
        size: '3840x2160',
        output_format: 'png',
        watermark: false,
      },
      apiKey,
      baseUrl,
      I2I_TIMEOUT_MS,
    )
    if (!result.url) {
      if (/401/i.test(result.error || '')) return { ok: false as const, error: 'Seedream auth failed (401)' }
      if (/402/i.test(result.error || '')) return { ok: false as const, error: 'no_credits' }
      if (/timed out/i.test(result.error || '')) return { ok: false as const, error: 'AI 处理超时(>180s)' }
      return { ok: false as const, error: result.error || 'Seedream 未返回图片' }
    }
    return { ok: true as const, url: result.url, model: result.model }
  })

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
  referenceImageUrl: z.string().url(),          // 当前场景主视图作 I2I anchor
  userInstruction: z.string().min(1).max(2000), // modify 模式必填;three-view 模式会被忽略
  sceneSlug: z.string().min(1).max(200),        // e.g. "INT. CAFE - DAY"
  sceneLocation: z.string().max(200).default(''),
  sceneTimeOfDay: z.string().max(50).default(''),
  sceneAction: z.string().max(2000).default(''),
  projectStyle: z.string().max(50).optional(),
  model: z.string().max(100).optional(),
  mode: z.enum(['modify', 'three-view']).default('modify'),
  // 2026/06:查看提示词模式
  previewOnly: z.boolean().default(false),
})

export type RegenerateSceneInputType = z.infer<typeof RegenerateSceneInput>

function buildScenePrompts(
  data: RegenerateSceneInputType,
  styleSpec: VisualStyleSpec,
): { positive: string; negative: string; size: string } {
  if (data.mode === 'three-view') {
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
      buildStyleLock(styleSpec, 'scene'),
      ``,
      `[关键:这是 I2I 任务,图1 是当前主视图]`,
      `图1 是这个场景的"基线真值" —— 已经有确定的色板 / 光照方向 / 建筑或自然要素 / 装饰物 / 材质 / 时代风格。`,
      `本任务 = 在图1 的基础上,生成 3 个不同景别的变体(同一场景、不同距离)。`,
      `3 个面板**必须继承图1 的所有视觉元素**,只在景别/取景范围上变化。`,
      ``,
      `[任务] 生成一张「场景三视图」,3 个面板都是图1 同一地点的景别变体。`,
      ``,
      `[地点] ${data.sceneSlug}`,
      data.sceneLocation ? `[具体地点] ${data.sceneLocation}` : '',
      data.sceneTimeOfDay ? `[时段] ${data.sceneTimeOfDay}` : '',
      data.sceneAction ? `[场景动作] ${data.sceneAction}` : '',
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
      .join('\n')
    const negative = [
      'people, character, figure, silhouette, human, bystander',
      'different location, different time of day, different weather between panels',
      'different color palette between panels, color shift between panels, inconsistent lighting between panels',
      'style drift, mixing styles, different art style between panels, photorealistic when input is anime, anime when input is realistic',
      'different furniture, different furniture color, different furniture shape between panels',
      'different wall color, different floor color, different building shape between panels',
      'adding new objects not in 图1, inventing new details not in 图1, hallucinating extra elements',
      'changing the architecture, modifying the scene layout, redesigning the environment',
      'panel borders, separator lines, text, watermark, logo, panel number, label, caption, arrow, callout',
      'low quality, blurry, low resolution, jpeg artifacts',
    ].join(', ')
    return { positive, negative, size: '3072x1280' }
  }

  // ----------------------------------------------------------------
  // 'modify' 模式:在原图基础上按意见改,严约束构图/光照/地点/时段
  // ----------------------------------------------------------------
  const positive = [
    `[STYLE LOCK — 场景图按意见重生,适用对象:scene]`,
    buildStyleLock(styleSpec, 'scene'),
    ``,
    `[任务] 修改「图1」(当前场景图),严格按下面的"修改意见"调整,只改用户提到的部分。`,
    ``,
    `[修改意见] ${data.userInstruction}`,
    ``,
    `[地点 / 时段] ${data.sceneSlug}${data.sceneTimeOfDay ? ' / ' + data.sceneTimeOfDay : ''}`,
    data.sceneAction ? `[场景动作参考] ${data.sceneAction}` : '',
    ``,
    `[修改规则 — 必须遵守]`,
    `1. 以图1为基础,在它的构图 / 光照 / 地点 / 时段上修改,**不要重新构图或换地点**。`,
    `2. 只调整"修改意见"里明确提到的元素;没提到的部分(构图、光照、地点、时段、视觉风格)全部保留图1 的样子。`,
    `3. 保持单张场景图,纯环境,无人物 / 无人形 / 无剪影。`,
    `4. 保持与图1 相同的视觉风格,严禁风格漂移。`,
  ]
    .filter(Boolean)
    .join('\n')
  const negative = [
    'people, character, figure, silhouette, human, crowd',
    'different art style, style drift, photorealistic when input is anime, anime when input is realistic, different medium, different color grading',
    'different location, different time of day, different camera angle, different aspect ratio',
    'watermark, logo, text, signature, label, panel number, caption, annotation, arrow, layout grid lines',
    'blurry, low quality, low resolution, jpeg artifacts',
  ].join(', ')
  return { positive, negative, size: '2K' }
}

export const regenerateSceneImage = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => RegenerateSceneInput.parse(d))
  .handler(async ({ data }) => {
    const { resolveProjectStyle } = await import('./visualStyles')
    const styleSpec = resolveProjectStyle(data.projectStyle)
    const { positive, negative, size } = buildScenePrompts(data, styleSpec)
    const requested = normalizeImageModelForRouting(data.model)
    const prompt = appendNegative(positive, negative)

    // 2026/06:查看提示词模式
    if (data.previewOnly) {
      return {
        ok: true as const,
        previewPrompt: prompt,
        negativePrompt: negative,
        promptSize: normalizeSeedreamSize(size),
        promptExtra: { model: requested || DEFAULT_MODEL, route: '场景图重生', mode: data.mode, referenceImage: data.referenceImageUrl },
      } as any
    }

    if (requested.toLowerCase().startsWith('pixflow/')) {
      const { callPixflowImage } = await import('./pixflow.functions')
      const r = await callPixflowImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: 'high',
      })
      if (!r.url) return { ok: false as const, error: r.error || 'Pixflow 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    if (requested.toLowerCase().startsWith('tokenflash/')) {
      const { callTokenflashImage } = await import('./tokenflash.functions')
      const r = await callTokenflashImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: 'high',
      })
      if (!r.url) return { ok: false as const, error: r.error || 'Tokenflash 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    if (requested.toLowerCase().startsWith('aigcfamily/')) {
      const { callAIGCFamilyImage } = await import('./aigcfamilyImage.functions')
      const r = await callAIGCFamilyImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
        quality: 'high',
      })
      if (!r.url) return { ok: false as const, error: r.error || 'AIGCFamily 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    if (requested.toLowerCase().startsWith('onetoken/')) {
      const { callOnetokenImage } = await import('./onetokenImage.functions')
      const r = await callOnetokenImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
      })
      if (!r.url) return { ok: false as const, error: r.error || 'OneToken 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }
    if (requested.toLowerCase().startsWith('otu/')) {
      const { callOtuImage } = await import('./otuImage.functions')
      const r = await callOtuImage({
        prompt,
        model: requested,
        size: normalizeSeedreamSize(size),
        referenceImages: [data.referenceImageUrl],
      })
      if (!r.url) return { ok: false as const, error: r.error || 'OTU 未返回图片' }
      return { ok: true as const, url: r.url, model: r.model }
    }

    const { apiKey, baseUrl, model: defaultModel } = getArkConfig()
    if (!apiKey) return { ok: false as const, error: 'ARK_API_KEY not configured' }
    const model = requested || defaultModel

    const result = await callSeedreamImages(
      {
        model,
        prompt,
        image: data.referenceImageUrl,
        size: normalizeSeedreamSize(size),
        output_format: 'png',
        watermark: false,
      },
      apiKey,
      baseUrl,
      I2I_TIMEOUT_MS,
    )
    if (!result.url) {
      if (/401/i.test(result.error || '')) return { ok: false as const, error: 'Seedream auth failed (401)' }
      if (/402/i.test(result.error || '')) return { ok: false as const, error: 'no_credits' }
      if (/timed out/i.test(result.error || '')) return { ok: false as const, error: 'AI 处理超时(>180s),请重试' }
      return { ok: false as const, error: result.error || 'Seedream 未返回图片' }
    }
    return { ok: true as const, url: result.url, model: result.model }
  })
