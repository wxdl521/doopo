// ====================================================================
//  Image model catalog —— Seedream 优先,legacy 作为手动兜底层
//
//  2026 重构:默认走火山方舟 ARK 的 Doubao Seedream(详见 docs/seedream.md)。
//  用户仍可手动从下拉框选 legacy 模型(Qwen / Wan / Gemini / GPT Image)——
//  此时 seedream.functions.ts 会把调用委派到 openrouterImage.functions.ts。
//  Seedream 模型 id 以 'doubao-seedream-' 开头;其他都是 legacy 兜底层。
// ====================================================================

export type ImageModelOption = { key: string; label: string; sub?: string; legacy?: boolean };

export const IMAGE_MODELS: ImageModelOption[] = [
  // ====================================================================
  //  UI 标签格式: [中转] 模型说明
  //  中转 = 后台实际路由的 Gateway,与 seedream.functions.ts / pixflow.functions.ts
  //  / openrouterImage.functions.ts 的分发逻辑严格对齐。
  // ====================================================================

  // ---- [ARK] 火山方舟 · Seedream(默认主力)----
  {
    key: "doubao-seedream-5-0-260128",
    label: "Doubao Seedream 5.0 🌱",
    sub: "[ARK 火山方舟] 默认 · T2I/I2I/多图融合",
  },

  // ---- [Pixflow · Gemini Native] api.pixflow.im → /v1beta/models/{id}:generateContent ----
  { key: "", label: "—— [Pixflow · Gemini Native] ——", sub: undefined, legacy: true },
  {
    key: "pixflow/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro Preview",
    sub: "[Pixflow·Gemini] 高质量 · 文本/多模态",
  },
  {
    key: "pixflow/gemini-3-flash",
    label: "Gemini 3 Flash",
    sub: "[Pixflow·Gemini] 快速 · 文本/多模态",
  },
  {
    key: "pixflow/gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    sub: "[Pixflow·Gemini] 新版 Flash",
  },
  {
    key: "pixflow/gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash Image",
    sub: "[Pixflow·Gemini] 图像 · T2I/I2I",
  },

  // ---- [Pixflow · OpenAI 兼容] api.pixflow.im → /v1/images/generations|edits ----
  { key: "", label: "—— [Pixflow · OpenAI 兼容] ——", sub: undefined, legacy: true },
  { key: "pixflow/gpt-image-2", label: "GPT Image 2", sub: "[Pixflow·OpenAI] Image2 · T2I/I2I" },

  // ---- [Claude360 · OpenAI 兼容] claude360.xyz → /v1/images/generations ----
  { key: "", label: "—— [Claude360 · OpenAI 兼容] ——", sub: undefined, legacy: true },
  {
    key: "claude360/gpt-image-2",
    label: "GPT Image 2",
    sub: "[Claude360·OpenAI] Image2 · T2I/I2I",
  },

  // ---- [Revora · OpenAI 兼容] revora.vip → /v1/images/generations|edits ----
  //  2026/06 接入:OpenAI 兼容 gpt-image-2 中转
  { key: "", label: "—— [Revora · OpenAI 兼容] ——", sub: undefined, legacy: true },
  { key: "revora/gpt-image-2", label: "GPT Image 2", sub: "[Revora·OpenAI] Image2 · T2I/I2I" },

  // ---- [Tokenflash · OpenAI 兼容] tokenflash.cn → /v1/images/generations|edits ----
  //  2026/06 接入:实测 gpt-image-2 单次 ~45-55s,显著快于 pixflow,且未观测到 502
  { key: "", label: "—— [Tokenflash · OpenAI 兼容] ——", sub: undefined, legacy: true },
  {
    key: "tokenflash/gpt-image-2",
    label: "GPT Image 2",
    sub: "[Tokenflash·OpenAI] Image2 · T2I/I2I · 推荐",
  },

  // ---- [AIGCFamily · OpenAI 兼容] api1.aigcfamily.top → /v1/images/generations ----
  //  ⚠ 网关仅提供 T2I 端点(无 /v1/images/edits,不接受参考图)→ 仅文生图
  //  2026/06 接入:实测 gpt-image-2 单次 ≈ 50s
  //  2026/07 接入:imagen-3.0-generate-001,独立 API Key(AIGCFAMILY_IMAGEN3_API_KEY)
  { key: "", label: "—— [AIGCFamily · OpenAI 兼容] ——", sub: undefined, legacy: true },
  {
    key: "aigcfamily/gpt-image-2",
    label: "aigcfamily-image2",
    sub: "[AIGCFamily·OpenAI] Image2 · 仅 T2I",
  },
  {
    key: "aigcfamily/imagen-3.0-generate-001",
    label: "AIGC-imagen3",
    sub: "[AIGCFamily·OpenAI] Imagen3 · 仅 T2I",
  },

  // ---- [数安词源 · OpenAI 兼容] token.ds.cyberpeace.cn → /v1/images/generations|edits ----
  //  2026/07 接入:gpt-image-2
  { key: "", label: "—— [数安词源 · OpenAI 兼容] ——", sub: undefined, legacy: true },
  {
    key: "shuci/gpt-image-2",
    label: "数安词源-image2",
    sub: "[数安词源·OpenAI] Image2 · T2I/I2I",
  },

  // ---- [AI Tokenvibe · OpenAI 兼容] → /v1/images/generations ----
  { key: "", label: "—— [AI Tokenvibe · OpenAI 兼容] ——", sub: undefined, legacy: true },
  {
    key: "aitokenvibe/gpt-image-2",
    label: "GPT Image 2",
    sub: "[AI Tokenvibe·OpenAI] Image2 · T2I/I2I",
  },

  // ---- [天鸿智算 · OpenAI 兼容] → /v1/images/generations ----
  { key: "", label: "—— [天鸿智算 · OpenAI 兼容] ——", sub: undefined, legacy: true },
  { key: "thhtcloud/gpt-image-2", label: "GPT Image 2", sub: "[天鸿智算·OpenAI] Image2 · T2I/I2I" },

  // ---- [ailinzi · OpenAI 兼容] → /v1/images/generations ----
  { key: "", label: "—— [ailinzi · OpenAI 兼容] ——", sub: undefined, legacy: true },
  { key: "ailinzi/gpt-image-2", label: "GPT Image 2", sub: "[ailinzi·OpenAI] Image2 · T2I/I2I" },
  {
    key: "ailinzi/gpt-image-2-all",
    label: "GPT Image 2 All",
    sub: "[ailinzi·OpenAI] Image2 All · T2I",
  },

  // ---- [TokenHub · OpenAI 兼容] → /v1/images/generations ----
  { key: "", label: "—— [TokenHub · OpenAI 兼容] ——", sub: undefined, legacy: true },
  { key: "tokenhub/gpt-image-2", label: "GPT Image 2", sub: "[TokenHub·OpenAI] Image2 · T2I/I2I" },

  // ---- [nagora.ai · OpenAI 兼容 · Azure 渠道] → /v1/images/generations ----
  { key: "", label: "—— [nagora.ai · OpenAI 兼容 · Azure 渠道] ——", sub: undefined, legacy: true },
  { key: "nagora/gpt-image-2", label: "GPT Image 2", sub: "[nagora·Azure 渠道] Image2 · T2I/I2I" },

  // ---- [MeridianAI · OpenAI 兼容] www.meridiangolf.xyz → /v1/images/generations|edits ----
  //  2026/07 接入:OpenAI 兼容 gpt-image-2 中转
  { key: "", label: "—— [MeridianAI · OpenAI 兼容] ——", sub: undefined, legacy: true },
  {
    key: "meridian/gpt-image-2",
    label: "GPT Image 2",
    sub: "[MeridianAI·OpenAI] Image2 · T2I/I2I",
  },

  // ---- [汇流 Confluo · OpenAI 兼容] models.iystd.com → /v1/images/generations|edits ----
  //  2026/07 接入:OpenAI 兼容 gpt-image-2 中转
  { key: "", label: "—— [汇流 Confluo · OpenAI 兼容] ——", sub: undefined, legacy: true },
  { key: "confluo/gpt-image-2", label: "GPT Image 2", sub: "[汇流·OpenAI] Image2 · T2I/I2I" },

  // ---- [vapeur.ai · OpenAI 兼容] → /v1/images/generations ----
  { key: "", label: "—— [vapeur.ai · OpenAI 兼容] ——", sub: undefined, legacy: true },
  { key: "vapeur/gpt-image-2", label: "GPT Image 2", sub: "[vapeur·OpenAI] Image2 · T2I/I2I" },

  // ---- [Azure OpenAI] ywkjpolandcentral.cognitiveservices.azure.com ----
  { key: "", label: "—— [Azure · OpenAI] ——", sub: undefined, legacy: true },
  {
    key: "azure/gpt-image-2",
    label: "Azure-gpt-image-2",
    sub: "[Azure·OpenAI] gpt-image-2 · T2I/I2I",
  },

  // ---- [Azure OpenAI 终结点] 4-0528-aoai-eu2-bfe.openai.azure.com ----
  { key: "", label: "—— [Azure OpenAI 终结点] ——", sub: undefined, legacy: true },
  {
    key: "azure2/gpt-image-2",
    label: "Azure-gpt-image-2",
    sub: "[Azure OpenAI 终结点] gpt-image-2 · T2I/I2I",
  },

  // ---- [Azure AI Foundry · 测试] 0528-aoai-sc-87d.services.ai.azure.com ----
  //  2026/07 接入:AI Foundry 资源,走 deployment 路径(与 azure/azure2 一致,便于 Portal 对账)
  { key: "", label: "—— [Azure AI Foundry · 测试] ——", sub: undefined, legacy: true },
  {
    key: "azure3/gpt-image-2",
    label: "Azure（测试）",
    sub: "[Azure AI Foundry] gpt-image-2 · T2I/I2I",
  },

  // ---- [DashScope] 阿里百炼 · 通义千问 / 万相 ----
  { key: "", label: "—— [DashScope · 阿里百炼] ——", sub: undefined, legacy: true },
  { key: "qwen-image-2.0", label: "Qwen Image 2.0", sub: "[DashScope] 通义千问 · T2I 稳定" },
  {
    key: "qwen-image-2.0-pro",
    label: "Qwen Image 2.0 Pro",
    sub: "[DashScope] 通义千问 · I2I 专用",
  },
  { key: "qwen-image-plus", label: "Qwen Image Plus", sub: "[DashScope] 通义千问 · 高清" },
  { key: "qwen-image", label: "Qwen Image", sub: "[DashScope] 通义千问 · 基础" },
  { key: "wan2.6-t2i", label: "万相 2.6 文生图", sub: "[DashScope] Wan · 推荐" },
  {
    key: "wan2.5-t2i-preview",
    label: "万相 2.5 文生图 Preview",
    sub: "[DashScope] Wan · 自由尺寸",
  },
  { key: "wan2.2-t2i-flash", label: "万相 2.2 文生图 Flash", sub: "[DashScope] Wan · 快速" },
  { key: "wan2.2-t2i-plus", label: "万相 2.2 文生图 Plus", sub: "[DashScope] Wan · 高质量" },
  { key: "wanx2.1-t2i-turbo", label: "万相 2.1 极速版", sub: "[DashScope] Wanx · 极速" },
  { key: "wanx2.1-t2i-plus", label: "万相 2.1 专业版", sub: "[DashScope] Wanx · 专业" },
];
