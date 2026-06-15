// ====================================================================
//  Image model catalog —— Seedream 优先,legacy 作为手动兜底层
//
//  2026 重构:默认走火山方舟 ARK 的 Doubao Seedream(详见 docs/seedream.md)。
//  用户仍可手动从下拉框选 legacy 模型(Qwen / Wan / Gemini / GPT Image)——
//  此时 seedream.functions.ts 会把调用委派到 openrouterImage.functions.ts。
//  Seedream 模型 id 以 'doubao-seedream-' 开头;其他都是 legacy 兜底层。
// ====================================================================

export type ImageModelOption = { key: string; label: string; sub?: string; legacy?: boolean }

export const IMAGE_MODELS: ImageModelOption[] = [
  // ====================================================================
  //  UI 标签格式: [中转] 模型说明
  //  中转 = 后台实际路由的 Gateway,与 seedream.functions.ts / pixflow.functions.ts
  //  / openrouterImage.functions.ts 的分发逻辑严格对齐。
  // ====================================================================

  // ---- [ARK] 火山方舟 · Seedream(默认主力)----
  { key: 'doubao-seedream-5-0-260128', label: 'Doubao Seedream 5.0 🌱', sub: '[ARK 火山方舟] 默认 · T2I/I2I/多图融合' },

  // ---- [Pixflow · Gemini Native] api.pixflow.im → /v1beta/models/{id}:generateContent ----
  { key: '', label: '—— [Pixflow · Gemini Native] ——', sub: undefined, legacy: true },
  { key: 'pixflow/gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image', sub: '[Pixflow·Gemini] 高质量 · T2I/I2I' },
  { key: 'pixflow/gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image (Nano Banana 2)', sub: '[Pixflow·Gemini] 快速 · T2I/I2I' },
  { key: 'pixflow/gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image', sub: '[Pixflow·Gemini] 通用 · T2I/I2I' },

  // ---- [Pixflow · OpenAI 兼容] api.pixflow.im → /v1/images/generations|edits ----
  { key: '', label: '—— [Pixflow · OpenAI 兼容] ——', sub: undefined, legacy: true },
  { key: 'pixflow/gpt-image-2', label: 'GPT Image 2', sub: '[Pixflow·OpenAI] Image2 · T2I/I2I' },

  // ---- [DashScope] 阿里百炼 · 通义千问 / 万相 ----
  { key: '', label: '—— [DashScope · 阿里百炼] ——', sub: undefined, legacy: true },
  { key: 'qwen-image-2.0', label: 'Qwen Image 2.0', sub: '[DashScope] 通义千问 · T2I 稳定' },
  { key: 'qwen-image-2.0-pro', label: 'Qwen Image 2.0 Pro', sub: '[DashScope] 通义千问 · I2I 专用' },
  { key: 'qwen-image-plus', label: 'Qwen Image Plus', sub: '[DashScope] 通义千问 · 高清' },
  { key: 'qwen-image', label: 'Qwen Image', sub: '[DashScope] 通义千问 · 基础' },
  { key: 'wan2.6-t2i', label: '万相 2.6 文生图', sub: '[DashScope] Wan · 推荐' },
  { key: 'wan2.5-t2i-preview', label: '万相 2.5 文生图 Preview', sub: '[DashScope] Wan · 自由尺寸' },
  { key: 'wan2.2-t2i-flash', label: '万相 2.2 文生图 Flash', sub: '[DashScope] Wan · 快速' },
  { key: 'wan2.2-t2i-plus', label: '万相 2.2 文生图 Plus', sub: '[DashScope] Wan · 高质量' },
  { key: 'wanx2.1-t2i-turbo', label: '万相 2.1 极速版', sub: '[DashScope] Wanx · 极速' },
  { key: 'wanx2.1-t2i-plus', label: '万相 2.1 专业版', sub: '[DashScope] Wanx · 专业' },
]
