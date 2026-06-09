// Visual style prompt fragments used by character / scene image generation.
//
// The `style` key matches the project's `style` field (see NewProjectDialog →
// styles array). Each entry contains:
//   - positive: a short English phrase describing the visual style to enforce
//   - negative: things that explicitly contradict the style (helps when the
//     upstream model supports negative prompts; otherwise we still include it
//     in the body as "AVOID:" so it acts as a soft negative)
//
// Keep phrases compact but specific (art medium + lighting + line treatment
// + palette). They're injected into genCharImage / genPanelImage prompts so
// every image in a project stays on-brand even across regenerations.

export type VisualStyleSpec = {
  positive: string
  negative: string
  /** Short Chinese label for UI display in toasts/logs */
  label: string
}

export const PROJECT_STYLE_PROMPTS: Record<string, VisualStyleSpec> = {
  // 3D CG / Pixar-style 3D cartoon
  '3d-cg': {
    positive:
      'high-end 3D CG render, octane/cycles shading, soft global illumination, physically based materials, smooth subsurface scattering on skin, slightly stylized proportions, cinematic studio lighting, ultra detailed',
    negative: '2D flat illustration, anime line art, photo, sketch, low poly',
    label: '3D CG',
  },
  // Anime / Japanese-Korean animation
  'anime-jp': {
    positive:
      'modern anime key visual style, vibrant cel-shading with soft gradient fill, sharp clean line art, large expressive eyes, glossy hair highlights, painterly anime background look, vivid color palette',
    negative: 'photorealistic, 3D render, western cartoon, low quality',
    label: '动漫-日韩',
  },
  // Pixar-style 3D cartoon
  pixar: {
    positive:
      'Pixar-style 3D character render, soft stylized proportions, large expressive eyes, warm cinematic lighting, subsurface scattering, rich color grading, family-friendly aesthetic',
    negative: 'realistic photo, anime, chibi, dark gritty',
    label: '3D-皮克斯卡通',
  },
  // Photorealistic
  realistic: {
    positive:
      'photorealistic portrait, anatomically accurate, natural skin texture with pores, cinematic Rembrandt lighting, shallow depth of field, high-end DSLR look, no over-smoothing',
    negative: 'cartoon, anime, illustration, CGI, chibi, painting',
    label: '写实-真人',
  },
  // Wuxia / Chinese ink
  wuxia: {
    positive:
      'Chinese wuxia xianxia ink painting, flowing silk robes, dramatic sword poses, ethereal mist, dynamic brushwork with subtle color accents, rice paper texture, golden-era martial arts aesthetic',
    negative: 'modern clothing, neon, photo, cute chibi',
    label: '武侠水墨',
  },
  // Chibi / super-deformed
  chibi: {
    positive:
      'super-deformed chibi style, oversized head on small body, 2-3 head tall proportions, huge sparkling eyes, bold clean outlines, pastel kawaii palette, soft shading',
    negative: 'realistic proportions, gritty, dark, mature',
    label: 'Q版萌系',
  },
  // Makoto Shinkai style
  shinkai: {
    positive:
      'Makoto Shinkai anime film style, hyper-detailed sky and atmospheric lighting, lens flare, soft focus depth, warm/cool color contrast, dreamy nostalgic mood, painterly background',
    negative: 'chibi, low detail, dark, gritty realism',
    label: '新海诚风',
  },
  // Healing hand-drawn
  healing: {
    positive:
      'healing hand-drawn illustration style, soft watercolor washes, gentle line art, warm pastel palette, plant and sunlight motifs, Studio Ghibli-adjacent feel, comforting and warm',
    negative: 'cyberpunk, dark, gritty, neon, horror',
    label: '治愈手绘',
  },
  // Cyberpunk
  cyberpunk: {
    positive:
      'cyberpunk character concept, neon-lit urban night, holographic accents on clothing, chromatic aberration glow, futuristic streetwear with cybernetic details, moody cinematic color grading',
    negative: 'medieval, pastoral, soft pastel, cute chibi',
    label: '赛博朋克',
  },
  // Western comic
  comic: {
    positive:
      'western comic book illustration, bold clean ink outlines, halftone shading, dynamic pose, saturated primary colors, Marvel/DC cover aesthetic',
    negative: 'manga, photo, watercolor, minimalist',
    label: '美漫风',
  },
  // Pixel art
  pixel: {
    positive:
      '16-bit pixel art sprite, limited 32-color palette, crisp non-anti-aliased pixels, dithering for shading, retro JRPG character portrait aesthetic',
    negative: 'smooth gradients, photo, 3D render, vector, high resolution',
    label: '像素艺术',
  },
  // Claymation / clay stop-motion
  clay: {
    positive:
      'claymation stop-motion style, hand-sculpted clay figure, visible fingerprint textures, soft plasticine surface, miniature diorama lighting, Aardman-style charm',
    negative: 'smooth digital, photoreal, anime line art',
    label: '黏土定格',
  },
}

/** Look up a project style, falling back to 'realistic' if the project style
 *  is empty / unknown. Returns the spec plus a stable label. */
export function resolveProjectStyle(projectStyle: string | null | undefined): VisualStyleSpec & { key: string } {
  const key = projectStyle || 'realistic'
  const spec = PROJECT_STYLE_PROMPTS[key] ?? PROJECT_STYLE_PROMPTS.realistic
  return { key, ...spec }
}

// ============================================================================
// 模型解析 —— 2026 Seedream 迁移后
// ============================================================================
//
// 历史背景(2026 之前):NewProjectDialog 早先把 sceneModel 默认值设成
// `qwen-image-max`,但用户订阅里没有 qwen-image-max(qwen.md 里可用的是
// qwen-image-2.0 / 2.0-pro / wan2.7-image / wan2.7-image-pro)。老项目里
// sceneModel 是 `qwen-image-max` 会直接被 DashScope 400 掉。
//
// 2026 之后:默认走火山方舟 ARK 的 Doubao Seedream(`doubao-seedream-5-0-260128`),
// 统一支持 T2I + I2I(没有 qwen-image-2.0-pro 那种"I2I-only"坑)。
// legacy Qwen / Wan 仍作为用户手动兜底层保留。
//
// `resolveImageModel` 在调用前把无效/已弃用的 model 映射到实际可用的等价物,
// 同时区分 T2I(只吃文本)和 I2I(吃图+文本)两种用途。
// ============================================================================

/** Seedream 默认 model(同时支持 T2I 和 I2I) */
const SEEDREAM_DEFAULT = 'doubao-seedream-5-0-260128'
const SEEDREAM_I2I_DEFAULT = 'doubao-seedream-5-0-260128'

/** 已知会 400 的旧/无效 T2I model 列表(Qwen 时期遗物) */
const DEPRECATED_T2I_MODELS = new Set<string>([
  'qwen-image-max',
  'qwen-image-max-2025-12-30',
  'qwen-image-2.0-pro',
  'qwen-image-2.0-pro-2026-04-22',
  'qwen-image-2.0-pro-2026-03-03',
])

/** 该用户的 T2I 可用 model(Seedream + Qwen/Wan 兜底) */
const VALID_T2I_MODELS = new Set<string>([
  SEEDREAM_DEFAULT,
  'qwen-image-2.0',
  'wan2.7-image',
  'wan2.7-image-pro',
])

/** I2I(图生图)可用的 model(Seedream 默认) */
const VALID_I2I_MODELS = new Set<string>([
  SEEDREAM_I2I_DEFAULT,
  'qwen-image-2.0-pro',
  'wan2.7-image-pro',
])

/**
 * 把 sceneModel 解析成 T2I 可用的 model。
 * 找不到 / 已知无效 / I2I-only → fallback 到 Seedream 默认。
 */
export function resolveT2IModel(sceneModel: string | null | undefined): string {
  const m = (sceneModel || '').trim()
  if (!m) return SEEDREAM_DEFAULT
  if (DEPRECATED_T2I_MODELS.has(m)) return SEEDREAM_DEFAULT
  if (VALID_T2I_MODELS.has(m)) return m
  // 未知 model:保守 fallback,不在服务器上乱试
  return SEEDREAM_DEFAULT
}

/**
 * 把 sceneModel 解析成 I2I 可用的 model。
 * 找不到 / 已知无效 / 只支持 T2I 的 → fallback 到 Seedream 默认(I2I 兼容)。
 */
export function resolveI2IModel(sceneModel: string | null | undefined): string {
  const m = (sceneModel || '').trim()
  if (VALID_I2I_MODELS.has(m)) return m
  return SEEDREAM_I2I_DEFAULT
}
