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

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const DEFAULT_MODEL = 'doubao-seedream-5-0-260128'
const RETRY_BACKOFF_MS = [1_000, 2_000, 4_000] as const
const REQUEST_TIMEOUT_MS = 50_000
const I2I_TIMEOUT_MS = 120_000
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
})

export const generateImage = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => GenerateImageInput.parse(d))
  .handler(async ({ data }) => {
    const requested = (data.model || '').trim()
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
      `LAYOUT — strict, no exceptions:
  Output ONE image with EXACTLY 3 horizontal panels, side-by-side, equal width:
    • LEFT   = FRONT view (the reference image's angle)
    • MIDDLE = SIDE profile (90° rotation, character's RIGHT side facing the camera)
    • RIGHT  = BACK view (180° rotation)
  NO 4th panel. NO diagonal panel. NO detail box. NO labels. NO captions. NO arrows. NO scale indicators. NO text inside the image.`,
      ``,
      `PER-PANEL SHOT TYPE: Each of the 3 panels is a FULL SHOT (FS) / LONG SHOT (LS) / FULL-LENGTH PORTRAIT — the same framing used in character turnaround sheets, model sheets, and costume reference sheets. The character in EACH panel is shown standing upright from head to feet.`,
      ``,
      `PER-PANEL GEOMETRY: Each panel is portrait-orientation. In each panel, the character occupies 85-95% of the panel's vertical extent — from the top of the head to the soles of the feet. Small white margin above the head AND below the feet in EACH panel. Both feet clearly visible at the bottom of EACH panel. The character does NOT touch the top or bottom edge of any panel.`,
      ``,
      `PER-PANEL COMPOSITION (apply in each of the 3 panels):
  1. Reserve a portrait-orientation panel.
  2. Place the character centered horizontally.
  3. Top of head at the top of the panel (with small margin).
  4. Soles of feet at the bottom of the panel (with small margin).
  5. Body fills the vertical axis of the panel — full body, no half-body.
  6. Both feet visible. Both hands visible at the sides.`,
      ``,
      `HARD CONSTRAINTS — the image is REJECTED if ANY of these is true in ANY of the 3 panels:
  • The panel is a half-body, waist-up, hip-up, chest-up, shoulder-up, knee-up, cowboy shot, or head-and-shoulders crop.
  • The head or top of the hair is cut off at the top of the panel.
  • The feet or shoes are cut off at the bottom of the panel.
  • The character is floating with no visible feet, or the lower body fades into the background.
  • The body extends beyond the panel edge.
  • The character occupies less than 80% of the panel's height.
  • The side or back panel is tighter than the front panel (this is the #1 most common failure mode — both side and back must be JUST AS FULL as the front).
  • The image contains 4+ panels, or fewer than 3 panels.`,
      ``,
      `CAMERA PER PANEL: standing upright, neutral A-pose (arms relaxed at the sides, feet slightly apart), expressionless face. The ONLY thing that changes between panels is the camera rotation around the vertical axis. NO 3/4 view, NO diagonal, NO action pose, NO walking, NO sitting, NO crouching, NO hands-on-hips, NO prop-holding.`,
      ``,
      `EXPRESSION IN ALL 3 PANELS: Neutral, expressionless, like a passport photo. No smile, no frown, no emotion, eyes open looking at the camera.`,
      ``,
      `IDENTITY LOCK ACROSS ALL 3 PANELS: Same face, same body, same outfit, same age, same hair, same skin tone, same accessories, same shoes. The ONLY difference between panels is the camera angle. The face must be PIXEL-IDENTICAL across all 3 panels.`,
      ``,
      `VISUAL STYLE (MUST match across all 3 panels — no style drift between panels):
  Style name: ${styleSpec.label}
  Style: ${styleSpec.positive}
  AVOID: ${styleSpec.negative}`,
      ``,
      `CHARACTER (source of truth, alongside the attached reference image):
  Name: ${cardTitle} (${data.characterRoleLabel}, age ${data.characterAge})
  Face (must remain identical in all 3 panels): ${data.faceDescription || '(use the face shown in the attached reference image)'}
  Body (must remain identical in all 3 panels): ${data.bodyDescription || '(use the body shown in the attached reference image)'}
  Outfit (must remain identical in all 3 panels — do NOT change the outfit between panels): ${data.clothingDescription || '(use the outfit shown in the attached reference image)'}`,
      ``,
      `BACKGROUND: Each panel has a uniform light neutral background (off-white #F5F5F5 / light grey #EEEEEE is OK — this IS a reference sheet, not a final product, so the strict pure-white rule is relaxed). NO scenery, NO floor, NO horizon, NO props, NO environment, NO shadow on the background, NO reflection.`,
      ``,
      `FINAL CHECK — verify every item before submitting. If any is false, REGENERATE the image:
  [ ] Output is ONE image with EXACTLY 3 panels (front / side / back) (yes)
  [ ] All 3 panels show FULL BODY head-to-toe (yes)
  [ ] All 3 panels show BOTH FEET at the bottom (yes)
  [ ] All 3 panels are equally full-body (side and back NOT tighter than front) (yes)
  [ ] Same face, body, outfit, age in all 3 panels (yes)
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
    // 官方角色资料卡(Official Character Profile Card)—— 2026 用户重做
    //
    // 风格:类似官方游戏 / 动漫设定集的角色资料卡,白底,插画风,有组织的布局。
    // 关键词:角色资料卡、官方设定、3 视图、表情变化、服装分解、装备详细、
    //        色板、世界观、白色背景、插画风格
    //
    // 布局:
    //   顶部 header strip —— 角色名 + 角色定位 + 世界观设定简要说明(2-3 句)
    //   Row 1 (3 格)—— 3 视图(front / side / back),角色比例完全一致
    //   Row 2 (3 格)—— 面部表情变化(中性 / 微笑 / 严肃)
    //   Row 3 (3 格)—— 服装分解 / 装备详细 / 色板
    // ====================================================================
    const positive = [
      `[MISSION] Generate an OFFICIAL-STYLE CHARACTER PROFILE CARD (官方角色资料卡 / Character Design Reference Page) for "${cardTitle}" — a ${data.characterRoleLabel}, age ${data.characterAge}. This is a single image designed to look like a page from a game / anime production art book / 官方设定集 — like a character design document handed to a 3D modeler or animator. PURE WHITE BACKGROUND, illustration-grade, organized layout, clean linework. NOT a finished illustration, NOT a poster, NOT a manga storyboard.`,

      `The document's purpose: a single image that gives a game / animation team all the information they need to faithfully reproduce this character in any future scene — 3 views for modeling, facial expression range for animation, clothing/equipment breakdown for rigging, color palette for consistency, world/lore context for tone.`,

      `You are given TWO sources of truth and BOTH must agree:`,
      `  (A) the attached REFERENCE IMAGE — the current approved front-view of "${cardTitle}", and`,
      `  (B) the FACE / BODY / OUTFIT text descriptions below (the source-of-truth for the locked character design).`,
      `If (A) and (B) ever disagree, follow (B) and treat (A) as a visual hint. The character identity MUST match (B) exactly.`,

      // ========== 整体视觉风格 ==========
      `[OVERALL VISUAL TREATMENT — strictly enforced]`,
      `- PURE WHITE BACKGROUND (#FFFFFF) for the entire page and all cells. Like a printed reference document. NO scenery, NO floor, NO horizon, NO environment, NO shadow on the background.`,
      `- Illustration style with clean linework, organized layout. NOT photoreal — illustration-grade (the kind of art you'd see in an official character art-book).`,
      `- Thin neutral dividers between cells (very light grey ~#E8E8E8 or so). No fancy borders, no gold filigree, no ornate decoration. Just clean grid lines.`,
      `- HD 2K resolution. Sharp, clean, professional-grade. Each cell should be detailed enough to be usable as a reference for production work.`,
      `- All text in the header strip rendered in clean typefaces (Songti / 思源宋体 / Times / similar) — no Comic Sans, no decorative fonts. Text is small and integrated into the layout.`,

      // ========== 布局:header strip + 3x3 grid ==========
      `[LAYOUT — a small "header strip" at the top, then a clean 3 columns × 3 rows grid (= 9 cells).]`,

      `[HEADER STRIP — top of the image, full width, ~10% of image height]`,
      `A small horizontal text-only header with:`,
      `  Left:   Character name in large Chinese characters ("${cardTitle}"), with a small English subtitle below ("Official Profile Card" or similar)`,
      `  Center: Role label (${data.characterRoleLabel}) in a small badge / chip`,
      `  Right:  A 2-3 sentence brief worldview / lore description for this character (in Chinese), explaining their role in the world, their personality archetype, and their key relationship/context. Tone should be epic / literario / inキャラクター. NO image, NO icon, just plain text.`,
      `The header is small and clean — the 3x3 grid below is the main attraction.`,

      `Row 1 — FULL-BODY 3-VIEW (front / side / back, identical proportions):`,
      `  Cell (1,1) = FRONT full body (front view, standing A-pose, expressionless face)`,
      `  Cell (1,2) = SIDE PROFILE full body (90° rotation, character's RIGHT side facing camera)`,
      `  Cell (1,3) = BACK full body (180° rotation, back facing camera)`,
      `All three views are the SAME character in standing A-pose (arms relaxed at the sides, feet slightly apart, expressionless face). Identical proportions, identical outfit, identical height across the three views. NO perspective distortion, NO foreshortening, NO 3/4 angles.`,
      `Each full-body cell shows the character head-to-toe, both feet clearly visible at the bottom, small margin above the head.`,

      `Row 2 — FACIAL EXPRESSION VARIATIONS (only the expression differs):`,
      `  Cell (2,1) = CALM / NEUTRAL expression (default passport-photo look, no emotion)`,
      `  Cell (2,2) = SMILING / HAPPY expression (subtle gentle smile, eyes slightly squinted with warmth, mouth corners up)`,
      `  Cell (2,3) = ANGRY / INTENSE expression (furrowed brow, serious piercing gaze, lips pressed or slightly downturned)`,
      `All three face cells show the SAME face shape, eye shape, nose, mouth, eyebrows, skin tone, hairstyle — only the EXPRESSION changes. Same head size, same camera angle (front view), same lighting.`,

      `Row 3 — CLOTHING BREAKDOWN / EQUIPMENT DETAIL / COLOR PALETTE:`,
      `  Cell (3,1) = CLOTHING BREAKDOWN (服装分解): a "flat lay" / disassembled view of the outfit — each garment (top, pants/skirt, etc.) shown separately and laid flat, with the actual fabric texture, pattern, color, and stitching visible. Like a sewing pattern reference. NO body wearing the clothes — just the clothes themselves, neatly arranged in the cell.`,
      `  Cell (3,2) = EQUIPMENT / ACCESSORIES DETAIL (装备详细部分): the key prop(s) / weapon(s) / accessory(ies) the character carries, each shown separately as a clean line-art illustration with shading. Multiple items arranged neatly. Include any visible texture / material / engraved detail.`,
      `  Cell (3,3) = COLOR PALETTE (色板): a clean horizontal grid of 4-6 small color swatches (rounded squares), each labeled with a tiny hex code below. The colors are the dominant colors of the character's design (skin, hair, primary outfit, secondary outfit, accent).`,

      // ========== 质量约束 ==========
      `[CRITICAL RULES — output is REJECTED if ANY of these is violated]`,

      `RULE 1 — PURE WHITE BACKGROUND: every cell AND the entire image background MUST be white / very-light off-white (#FFFFFF or #FAFAFA). NOT gray, NOT cream, NOT textured, NOT scenery. This is a "design document" with a clean white background.`,

      `RULE 2 — IDENTITY LOCK: the character depicted in all 9 cells MUST be pixel-identical (same face, body, outfit, hair, skin tone, accessories) where they appear. Only the framing / expression / angle changes between cells.`,

      `RULE 3 — CHARACTER PROPORTIONS CONSISTENT across the 3 full-body views. Same head size, same torso length, same arm length, same leg length. The character in the side and back views is the EXACT same height as the front view.`,

      `RULE 4 — NO DISTORTION / NO PERSPECTIVE ERRORS: all views are flat orthographic. No fish-eye, no wide-angle distortion, no hero/low angle, no 3/4 view (only allowed angles: 0° front, 90° side, 180° back for the full-body views).`,

      `RULE 5 — EXPRESSION ONLY: in Row 2, ONLY the expression changes. The face shape, eye shape, hairstyle, skin tone, lighting, camera angle MUST stay identical across the 3 expression cells. The viewer should be able to tell "these are 3 expressions of the SAME person".`,

      `RULE 6 — CLOTHING IS A FLAT LAY: in Cell (3,1), the clothing is shown DISASSEMBLED (top, pants, etc. laid out separately) — NOT worn by the character, NOT on a mannequin. Just the garments themselves, neatly arranged.`,
      `— EQUIPMENT IS INDIVIDUAL ITEMS: in Cell (3,2), each prop/weapon/accessory is shown separately — NOT held by the character, NOT in a scene. Just the items, neatly arranged.`,

      `RULE 7 — COLOR PALETTE: in Cell (3,3), 4-6 small color swatches with hex codes (e.g. "#E8C4A0") labeled below each. The swatches should reflect the dominant colors of the character.`,

      `RULE 8 — STYLE LOCK: all 9 cells + the header MUST be rendered in the project's selected visual style "${styleSpec.label}". Mixing anime and realistic, or mixing 3D and 2D, is forbidden.`,
      `— header text may be in a slightly different visual treatment (cleaner, more print-like) but should still feel cohesive with the rest of the page.`,

      `RULE 9 — NO UNRELATED CONTENT: no other characters, no random props, no scenery. Everything in the card must be traceable back to the character's face/body/outfit descriptions below.`,
      `— The header's lore text should reference the character by name and reflect their actual role / personality from the inputs.`,

      `RULE 10 — READABLE HEADER TEXT: the character name, role badge, and lore text in the header must be readable — large enough, in proper Chinese, no truncation. The lore text should be 2-3 sentences of refined literary Chinese.`,

      // ========== 风格 / 角色数据 ==========
      `[PROJECT VISUAL STYLE — must match the project's selected visual style across ALL 9 cells]`,
      `Style name: ${styleSpec.label}`,
      `Style: ${styleSpec.positive}`,
      `AVOID: ${styleSpec.negative}`,

      `[CHARACTER IDENTITY — copy into the image EXACTLY. Treat as the source of truth, alongside the attached reference image.]`,
      `Name: ${cardTitle} (${data.characterRoleLabel}, age ${data.characterAge})`,

      `=== FACE — must remain IDENTICAL across all cells that show the face ===`,
      data.faceDescription || '(no separate face description — use the face shown in the attached reference image)',
      `=== END FACE ===`,

      `=== BODY — must remain IDENTICAL across all cells ===`,
      data.bodyDescription || '(no separate body description — use the body shown in the attached reference image)',
      `=== END BODY ===`,

      `=== OUTFIT — must remain IDENTICAL across all cells. Do NOT change the outfit, do NOT add/remove any clothing item, accessory, or prop. ===`,
      data.clothingDescription || '(no separate outfit description — use the outfit shown in the attached reference image)',
      `=== END OUTFIT ===`,
      data.palette?.length ? `\n=== PALETTE (hex colors) — apply consistently across all cells ===\n${data.palette.join(', ')}\n=== END PALETTE ===` : '',

      `[FINAL CHECKLIST]`,
      `[ ] Output is ONE image with a header strip + a 3×3 grid (all 9 cells present)`,
      `[ ] Header strip contains: character name, role badge, 2-3 sentence Chinese lore text`,
      `[ ] Row 1 = full-body 3-view (front / side / back) with identical proportions`,
      `[ ] Row 2 = 3 facial expressions (neutral / happy / intense) — only expression differs`,
      `[ ] Row 3 = clothing flat-lay / equipment detail / color palette with hex labels`,
      `[ ] Pure white background throughout (#FFFFFF or near-white)`,
      `[ ] Same face, body, outfit in all cells where the character appears`,
      `[ ] Style matches "${styleSpec.label}" across all cells`,
      `[ ] No text inside Row 1 / Row 2 / Row 3 cells (text only in header strip)`,
      `[ ] No other characters, no extra limbs, no distortion, no perspective errors`,

      `Begin. Output the official character profile card.`,

    ].filter(Boolean).join('\n\n')
    const negative = [
      'different art style, style drift, photorealistic when input is anime, anime when input is realistic, different medium, different line treatment, different color grading, inconsistent rendering between cells',
      'different face, different face shape, different eye shape, different eye color, different nose, different mouth, different eyebrows, different skin tone, different hairstyle, different hair color, different hair length, different facial proportions, age change, different body, different body proportions, different height, different weight, different gender presentation, different outfit, different clothing color, different clothing style, different accessories, different hat, different glasses, different jewelry, different shoes, different makeup',
      'perspective distortion, fish-eye, wide-angle distortion, foreshortening, hero shot, low angle, high angle, 3/4 view, diagonal angle, three-quarter view, dutch angle, tilted camera',
      'cropped at knees, cropped at waist, cropped at chest, cropped at hips, cropped at shoulders, head cut off, feet cut off, body extending beyond frame, half-body, half-length, missing feet, missing hands, missing legs',
      'different proportions across the three views, character taller in front view, character shorter in side view, character shorter in back view, inconsistent body scale between panels',
      'extra people, bystander, multiple characters, extra limbs, deformed hands, extra fingers, deformed face, blurred face, low quality',
      'detailed scenery, busy backgrounds, complex environments, room interior, outdoor landscape, props cluttering the frame, floor, wall, sky, scenery, furniture, ground texture, horizon line, shadow on background, floor reflection, color cast, gradient background, vignette',
      'watermark, logo, text, signature, label, panel number, caption, annotation, arrow, callout, layout grid lines, dividers, visible borders between cells',
    ].join(', ')
    return { positive, negative, size: '2K' }
  }

  // ---- 默认 'modify' ----
  const positive = [
    `[EDIT REQUEST — what to change in the attached image]`,
    data.userInstruction,
    ``,
    `[LOCK — everything else MUST stay identical to the source image]`,
    `Keep the same face, same body, same camera angle (front view, eye-level), same full-body head-to-toe framing, same neutral expressionless face, same pure white #FFFFFF background, same visual style ("${styleSpec.label}"). Apply ONLY the change described above.`,
    ``,
    `[Subject] ${cardTitle} — ${data.characterRoleLabel}, age ${data.characterAge}.`,
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

    const { apiKey, baseUrl, model: defaultModel } = getArkConfig()
    if (!apiKey) return { ok: false as const, error: 'ARK_API_KEY not configured' }
    const model = data.model?.trim() || defaultModel
    const prompt = appendNegative(positive, negative)

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
      if (/timed out/i.test(result.error || '')) return { ok: false as const, error: 'AI 处理超时(>120s),请重试或换更简单的修改' }
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
})

export type ShotInputType = z.infer<typeof ShotInput>

function buildShotInstruction(data: ShotInputType, styleSpec: { label: string; positive: string }): string {
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
    `5. 风格必须匹配项目视觉风格:${styleSpec.label} —— ${styleSpec.positive}`,
    `6. 角色动作 / 表情 / 视线方向严格按本镜头的"${data.action}"执行。`,
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

    const { apiKey, baseUrl, model: defaultModel } = getArkConfig()
    if (!apiKey) return { ok: false as const, error: 'ARK_API_KEY not configured' }
    const model = data.model?.trim() || defaultModel
    const prompt = appendNegative(instruction, negative)

    const result = await callSeedreamImages(
      { model, prompt, image: images, size: '2K', output_format: 'png', watermark: false },
      apiKey,
      baseUrl,
      I2I_TIMEOUT_MS,
    )
    if (!result.url) {
      if (/401/i.test(result.error || '')) return { ok: false as const, error: 'Seedream auth failed (401)' }
      if (/402/i.test(result.error || '')) return { ok: false as const, error: 'no_credits' }
      if (/timed out/i.test(result.error || '')) return { ok: false as const, error: 'AI 处理超时(>120s)' }
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

function buildRegenShotInstruction(data: RegenShotInputType, styleSpec: { label: string; positive: string }, usedCharCount: number, hasScene: boolean): string {
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
    `6. 风格:${styleSpec.label} —— ${styleSpec.positive}`,
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

    const { apiKey, baseUrl, model: defaultModel } = getArkConfig()
    if (!apiKey) return { ok: false as const, error: 'ARK_API_KEY not configured' }
    const model = data.model?.trim() || defaultModel
    const prompt = appendNegative(instruction, negative)

    const result = await callSeedreamImages(
      { model, prompt, image: images, size: '2K', output_format: 'png', watermark: false },
      apiKey,
      baseUrl,
      I2I_TIMEOUT_MS,
    )
    if (!result.url) {
      if (/401/i.test(result.error || '')) return { ok: false as const, error: 'Seedream auth failed (401)' }
      if (/402/i.test(result.error || '')) return { ok: false as const, error: 'no_credits' }
      if (/timed out/i.test(result.error || '')) return { ok: false as const, error: 'AI 处理超时(>120s)' }
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
  characters: z.array(PitchDeckCharacterSchema).max(3).default([]),
  shots: z.array(PitchDeckShotSchema).max(3).default([]),
  characterImageUrl: z.string().url().optional(),
  sceneImageUrl: z.string().url().optional(),
  model: z.string().max(100).optional(),
})

export type PitchDeckInputType = z.infer<typeof PitchDeckInput>

/**
 * 把分镜数据翻译成"漫剧故事板"多格分镜 prompt。
 *
 * 设计思路(2026 用户指定 —— 从"Pitch Deck 7 段式"改成"漫剧多格分镜"):
 *   1) 整张图就是一个 manga/comic page,纯 6-8 格分镜网格
 *   2) 每格 = 1 个 shot:首帧画面 + 动态变化指示(motion lines / arrows) +
 *      顶部预留 caption box(留给后续文字标注)
 *   3) 剧情从左到右、从上到下递进
 *   4) 排版干净,格间留白(gutter),高清画质
 *   5) 角色在所有格子里保持一致(脸/身材/衣服)
 *   6) 风格锁到项目视觉风格
 */
function buildPitchDeckPrompt(opts: {
  data: PitchDeckInputType
  styleSpec: { label: string; positive: string; negative: string }
}): string {
  const { data, styleSpec } = opts
  const chars = data.characters || []
  const shots = data.shots || []
  const shotCount = shots.length
  // 漫剧故事板固定 6 格(2x3)或 8 格(2x4)。少于 6 个 shot 就补到 6,8 个以上截到 8。
  const TARGET_PANELS = shotCount >= 7 ? 8 : 6
  const panelsToShow = Math.min(shotCount, TARGET_PANELS)
  const needExtraPanels = Math.max(0, TARGET_PANELS - shotCount)

  // 计算网格布局(根据 panel 数选 2x3 或 2x4)
  const gridLayout = TARGET_PANELS === 8 ? '2 rows × 4 columns (horizontal manga page)' : '2 rows × 3 columns (standard manga page)'

  // 已有 shot 描述(模型据此填每个 panel)
  const shotLines = shots.map((s, i) => {
    const cam = s.camera ? ` | camera: ${s.camera}` : ''
    const dur = s.durationSec ? ` | duration: ${s.durationSec}s` : ''
    return `  Shot ${i + 1}: [${s.shotTypeLabel}] ${s.action}${cam}${dur}`
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
    `[MISSION] Generate a MANGA-STYLE STORYBOARD (漫剧故事板) page for the following storyboard sequence. This is a SINGLE image designed to look like ONE page from a manga / manhua / 漫剧 / comic — NOT a finished illustration, NOT a poster, NOT a production deck. The whole image is a multi-panel storyboard with ${TARGET_PANELS} panels arranged in a clean ${gridLayout}.`,

    `The page tells the story PROGRESSIVELY — reading order is left-to-right, top-to-bottom (or right-to-left for traditional manga style — your call, but be consistent). Each panel is one shot from the storyboard sequence. The viewer should be able to "read" the whole sequence by looking at this one image.`,

    // ========== 整体视觉风格 ==========
    `[OVERALL VISUAL TREATMENT — strictly enforced]`,
    `- Manga / 漫剧 / comic style. Clean linework, strong composition, deliberate visual storytelling.`,
    `- 2K HD resolution. The image should be sharp, high-contrast, professional-grade.`,
    `- Each panel: rectangular, equal size, separated by clean white gutters (~3-5% of panel width). No overlapping panels.`,
    `- Inside each panel: a manga-style illustration showing the shot's first frame. Background can be pure white (classic manga) or atmospheric (漫剧 with backgrounds) — match the project style.`,
    `- A reserved TEXT ANNOTATION SLOT at the top of each panel: a small rectangular caption box or speech-bubble slot, with a tiny dotted/dashed border. This is where narration or dialogue text will be inserted later. The slot should be EMPTY in the image (just a placeholder box) — the actual text will be added in post.`,
    `- Motion / dynamic indication: where appropriate, include motion lines (速度线), action arrows, slight blur trails, or dynamic composition angles to show the panel depicts a MOMENT IN MOTION (not a static pose). This is critical — the user wants each panel to convey "this is a moving scene, not a frozen photo".`,
    `- Reading flow: visual cues (panel size, character eye-line direction, action vectors) should guide the eye naturally from panel to panel. The story should be readable WITHOUT any text.`,
    `- Color palette: limited, consistent across all panels. Match the project visual style. Mood-appropriate saturation.`,
    `- All panels share the same VISUAL STYLE — same line weight, same rendering technique, same color treatment, same level of detail.`,
    `- Character consistency: any character appearing in multiple panels MUST look identical. Same face, same body, same outfit, same hair. This is non-negotiable.`,
    `- NO text overlays, NO panel numbers, NO "Shot 1" labels inside the image. The panels speak for themselves. (Text is added in post.)`,

    // ========== 网格布局 ==========
    `[LAYOUT — ${TARGET_PANELS} panels in a clean ${gridLayout}]`,
    TARGET_PANELS === 8
      ? `Row 1 (top): Panels 1, 2, 3, 4 (left to right).
Row 2 (bottom): Panels 5, 6, 7, 8 (left to right).`
      : `Row 1 (top): Panels 1, 2, 3 (left to right).
Row 2 (bottom): Panels 4, 5, 6 (left to right).`,

    `Each panel occupies an equal rectangular cell. Panels are separated by clean white gutters (gutter width ~3-5% of panel width). No panel overlaps any other. The outer margin (between panels and image edge) is ~2-3% of image size.`,

    // ========== 内容(模型据此填图)==========
    `[STORY PLOT — use this verbatim as the source of truth for what happens in each panel. The plot MUST be readable panel-by-panel.]`,
    data.plotText,

    `[SCENE — atmospheric context for all panels]`,
    sceneLine,

    `[CHARACTERS — full descriptions. Same character MUST look identical across all panels they appear in.]`,
    charLines || '  (no specific characters — the storyboard focuses on the environment and atmosphere)',

    `[SHOT BREAKDOWN — ${panelsToShow} of ${TARGET_PANELS} panels are explicitly defined. The remaining ${needExtraPanels} panel(s) should be inferred from the plot text above, maintaining the same style, character designs, and scene atmosphere. Each shot's first frame should be the panel's main illustration.]`,
    shotLines || `  (no explicit shots — infer all ${TARGET_PANELS} from the plot text above, in reading order)`,
    needExtraPanels > 0 ? `  Panel${needExtraPanels > 1 ? 's' : ''} ${shotCount + 1}–${TARGET_PANELS}: [INFER FROM PLOT — same visual style, character consistency, scene atmosphere.]` : '',

    // ========== 整体视觉风格(项目用户选)==========
    `[PROJECT VISUAL STYLE — must match the project's selected visual style across ALL ${TARGET_PANELS} panels]`,
    `Style name: ${styleSpec.label}`,
    `Style: ${styleSpec.positive}`,
    `AVOID: ${styleSpec.negative}`,

    // ========== 输出质量约束 ==========
    `[QUALITY RULES — output is REJECTED if ANY of these is violated]`,
    `RULE 1 — ${TARGET_PANELS} EXACT PANELS: the image must contain EXACTLY ${TARGET_PANELS} panels in a ${gridLayout}. Not 4, not 9, not 12. EXACTLY ${TARGET_PANELS}.`,
    `RULE 2 — CLEAN GUTTERS: panels must be separated by visible white space. No bleeding edges, no overlapping, no touching.`,
    `RULE 3 — RESERVED CAPTION SLOTS: each panel must have a small rectangular placeholder box at the top (or appropriate corner) for caption / speech-bubble text. The slot is EMPTY but the placeholder shape must be visible.`,
    `RULE 4 — MOTION / DYNAMIC: each panel should show a moment in motion (motion lines, action lines, dynamic angle, blur trail, etc.) — NOT a static standing pose. The viewer should feel the action is happening.`,
    `RULE 5 — CHARACTER CONSISTENCY: any character in multiple panels MUST be pixel-identical. Same face, same outfit, same body, same hair, same accessories.`,
    `RULE 6 — STYLE LOCK: all ${TARGET_PANELS} panels must be rendered in the same visual style. Mixing anime and realistic, or mixing 3D and 2D, is forbidden.`,
    `RULE 7 — STORY READABILITY: by looking at the ${TARGET_PANELS} panels in reading order (left-to-right, top-to-bottom), the viewer should be able to understand the story progression WITHOUT any text. Visual storytelling only.`,
    `RULE 8 — NO TEXT INSIDE PANELS: do not draw any text, labels, or numbers inside the actual panel content. The caption slots are PLACEHOLDERS (empty boxes), not pre-filled text.`,
    `RULE 9 — NO UNRELATED CONTENT: no characters not in the list, no random props, no scenery unrelated to the plot. Everything in the storyboard must be traceable back to the inputs above.`,
    `RULE 10 — HD QUALITY: 2K sharp, no blur, no low-res artifacts. Each panel is detailed enough that it could stand alone as a single storyboard frame.`,

    `Begin. Output the manga-style storyboard page.`,
  ].filter(Boolean).join('\n\n')
}

export const generateStoryboardPitchDeck = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => PitchDeckInput.parse(d))
  .handler(async ({ data }) => {
    const { resolveProjectStyle } = await import('./visualStyles')
    const styleSpec = resolveProjectStyle(data.projectStyle)
    const prompt = buildPitchDeckPrompt({ data, styleSpec })

    const { apiKey, baseUrl, model: defaultModel } = getArkConfig()
    if (!apiKey) return { ok: false as const, error: 'ARK_API_KEY not configured' }
    const model = data.model?.trim() || defaultModel

    // 2K 平衡清晰度与生成时间/费用;用户提到"8K"但 Seedream 最大 4K
    const result = await callSeedreamImages(
      {
        model,
        prompt,
        size: '2K',
        output_format: 'png',
        watermark: false,
        // 不用 image 字段 — 7 分区布局模型自主构图,塞图反而会干扰 layout
        // 可选视觉锚点(characterImageUrl / sceneImageUrl)暂不传入,保持纯 T2I 的清爽布局
      },
      apiKey,
      baseUrl,
      I2I_TIMEOUT_MS,
    )
    if (!result.url) {
      if (/401/i.test(result.error || '')) return { ok: false as const, error: 'Seedream auth failed (401)' }
      if (/402/i.test(result.error || '')) return { ok: false as const, error: 'no_credits' }
      if (/timed out/i.test(result.error || '')) return { ok: false as const, error: 'AI 处理超时(>120s),设定稿内容多,建议重试' }
      return { ok: false as const, error: result.error || 'Seedream 未返回图片' }
    }
    return { ok: true as const, url: result.url, model: result.model }
  })
