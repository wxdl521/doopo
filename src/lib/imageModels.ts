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
  // ---- 主力:Seedream(火山方舟)----
  { key: 'doubao-seedream-5-0-260128', label: 'Doubao Seedream 5.0 🌱', sub: '默认 · ARK · 同步' },

  // ---- Pixflow(api.pixflow.im · OpenAI 兼容)----
  { key: '', label: '—— Pixflow Gateway ——', sub: undefined, legacy: true },
  { key: 'pixflow/gpt-image-2', label: 'GPT Image 2', sub: 'Pixflow · OpenAI · Image2' },
  { key: 'pixflow/gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image', sub: 'Pixflow · Google · 高质量' },
  { key: 'pixflow/gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image (Nano Banana 2)', sub: 'Pixflow · Google · 快速' },
  { key: 'pixflow/gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image', sub: 'Pixflow · Google · 通用' },

  // ---- Legacy 兜底层(用户手动选;seedream 模块会委派)----
  { key: '', label: '—— Legacy 兜底层 ——', sub: undefined, legacy: true },
  { key: 'qwen-image-2.0', label: 'Qwen Image 2.0', sub: '通义千问 · T2I 稳定' },
  { key: 'qwen-image-2.0-pro', label: 'Qwen Image 2.0 Pro', sub: '通义千问 · I2I' },
  { key: 'qwen-image-plus', label: 'Qwen Image Plus', sub: '通义千问 · 高清' },
  { key: 'qwen-image', label: 'Qwen Image', sub: '通义千问 · 基础' },
  { key: 'wan2.6-t2i', label: '万相 2.6 文生图', sub: 'Wan · 推荐' },
  { key: 'wan2.5-t2i-preview', label: '万相 2.5 文生图 Preview', sub: 'Wan · 自由尺寸' },
  { key: 'wanx2.1-t2i-turbo', label: '万相 2.1 极速版', sub: 'Wanx' },
  { key: 'wanx2.1-t2i-plus', label: '万相 2.1 专业版', sub: 'Wanx' },
]
