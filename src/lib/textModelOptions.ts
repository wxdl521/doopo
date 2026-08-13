// ====================================================================
// textModelOptions —— 文本（剧本/创意）模型的统一静态兜底列表
//
// 供 useListedModels("text", ...) 的 fallback 使用（接口异常/未登录/目录为空
// 时回落）。此前 Scripts.tsx 与 HeroPromptInput.tsx 各维护一份带 emoji 的
// 硬编码（🟠/🟣），现收敛为一份、emoji 废除（徽标走 modelOptions 统一规格）。
// id 与 scriptAgent/storyboard 链路的模型路由（ark:/qwen: 前缀）保持一致。
// ====================================================================

export const TEXT_MODEL_FALLBACK: Array<{ id: string; label: string; sub?: string }> = [
  {
    id: "ark:deepseek-v4-pro-260425",
    label: "DeepSeek V4 Pro (ARK)",
    sub: "主力 · 剧本与创意生成",
  },
  {
    id: "qwen:qwen3-max",
    label: "Qwen3 Max",
    sub: "旗舰 · 长文本与复杂创作",
  },
  {
    id: "qwen:qwen-plus",
    label: "Qwen Plus",
    sub: "均衡 · 稳定备用",
  },
  {
    id: "qwen:qwen-turbo",
    label: "Qwen Turbo",
    sub: "高速 · 轻量任务",
  },
  {
    id: "jingmei:gpt-5.5",
    label: "GPT-5.5 (jingmei)",
    sub: "推理 · Azure AI Foundry",
  },
  {
    id: "jingmei:gpt-5.6-sol",
    label: "GPT-5.6 Sol (jingmei)",
    sub: "旗舰推理 · Azure AI Foundry",
  },
];
