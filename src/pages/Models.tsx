import {
  Sparkles,
  Zap,
  ImageIcon,
  Music2,
  Video,
  Mic2,
  Globe,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useLanguage } from "../i18n/LanguageContext";

type AIModel = {
  id: string;
  name: string;
  nameEn: string;
  vendor: string;
  tagline: string;
  taglineEn: string;
  gradient: string;
  status: "available" | "used";
};

const AI_MODELS: AIModel[] = [
  {
    id: "deepseek/deepseek-chat-v3",
    name: "DeepSeek Chat",
    nameEn: "DeepSeek Chat",
    vendor: "DeepSeek",
    tagline: "快速·中文友好",
    taglineEn: "Fast · Chinese-friendly",
    gradient: "from-cyan-500 to-teal-600",
    status: "available",
  },
  {
    id: "jingmei:gpt-5.5",
    name: "GPT-5.5 (jingmei)",
    nameEn: "GPT-5.5 (jingmei)",
    vendor: "jingmei · Azure AI Foundry",
    tagline: "推理模型 · 转绘分析/剧本",
    taglineEn: "Reasoning · Restyle Analysis & Scripts",
    gradient: "from-indigo-500 to-blue-700",
    status: "available",
  },
  {
    id: "jingmei:gpt-5.6-sol",
    name: "GPT-5.6 Sol (jingmei)",
    nameEn: "GPT-5.6 Sol (jingmei)",
    vendor: "jingmei · Azure AI Foundry",
    tagline: "旗舰推理 · 转绘分析/剧本",
    taglineEn: "Flagship Reasoning · Restyle Analysis & Scripts",
    gradient: "from-blue-500 to-violet-700",
    status: "available",
  },
  {
    id: "mistralai/mistral-nemo",
    name: "Mistral Nemo",
    nameEn: "Mistral Nemo",
    vendor: "Mistral AI",
    tagline: "均衡·多语言",
    taglineEn: "Balanced · Multilingual",
    gradient: "from-violet-500 to-purple-700",
    status: "available",
  },
  {
    id: "meta-llama/llama-3.1-8b-instruct",
    name: "Llama 3.1",
    nameEn: "Llama 3.1",
    vendor: "Meta",
    tagline: "开源·推理强",
    taglineEn: "Open Source · Strong Reasoning",
    gradient: "from-orange-500 to-rose-700",
    status: "used",
  },
  // ---- Pixflow Gemini 全系列对话模型 ----
  {
    id: "pixflow/gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview",
    nameEn: "Gemini 3.1 Pro Preview",
    vendor: "Pixflow · Google",
    tagline: "次世代推理 · pixflow",
    taglineEn: "Next-gen reasoning · pixflow",
    gradient: "from-sky-500 to-indigo-600",
    status: "available",
  },
  {
    id: "pixflow/gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview",
    nameEn: "Gemini 3 Flash Preview",
    vendor: "Pixflow · Google",
    tagline: "快速通用 · pixflow",
    taglineEn: "Fast all-rounder · pixflow",
    gradient: "from-sky-400 to-blue-600",
    status: "available",
  },
  {
    id: "pixflow/gemini-3.1-flash-lite-preview",
    name: "Gemini 3.1 Flash Lite",
    nameEn: "Gemini 3.1 Flash Lite",
    vendor: "Pixflow · Google",
    tagline: "高吞吐低成本 · pixflow",
    taglineEn: "High-volume · pixflow",
    gradient: "from-cyan-400 to-sky-600",
    status: "available",
  },
  {
    id: "pixflow/gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    nameEn: "Gemini 2.5 Pro",
    vendor: "Pixflow · Google",
    tagline: "强多模态推理 · pixflow",
    taglineEn: "Strong multimodal · pixflow",
    gradient: "from-indigo-500 to-purple-700",
    status: "available",
  },
  {
    id: "pixflow/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    nameEn: "Gemini 2.5 Flash",
    vendor: "Pixflow · Google",
    tagline: "均衡 · pixflow",
    taglineEn: "Balanced · pixflow",
    gradient: "from-blue-500 to-indigo-600",
    status: "available",
  },
  {
    id: "pixflow/gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    nameEn: "Gemini 2.5 Flash Lite",
    vendor: "Pixflow · Google",
    tagline: "最低成本 · pixflow",
    taglineEn: "Lowest cost · pixflow",
    gradient: "from-teal-400 to-cyan-600",
    status: "available",
  },
];

type VideoModel = {
  id: string;
  name: string;
  nameEn: string;
  vendor: string;
  tagline: string;
  taglineEn: string;
  gradient: string;
  status: "available" | "used";
};

const VIDEO_MODELS: VideoModel[] = [
  {
    id: "earth/seedance-2.0",
    name: "Doubao Seedance 2.0 (AgentEarth)",
    nameEn: "Doubao Seedance 2.0 (AgentEarth)",
    vendor: "AgentEarth · OpenAI 兼容",
    tagline: "文本/图片/视频/音频生视频 · 4-15 秒",
    taglineEn: "Text, Image, Video & Audio to Video · 4-15s",
    gradient: "from-emerald-500 to-teal-600",
    status: "available",
  },
  {
    id: "earth/seedance-2.0-global",
    name: "Doubao Seedance 2.0 Global (AgentEarth)",
    nameEn: "Doubao Seedance 2.0 Global (AgentEarth)",
    vendor: "AgentEarth · OpenAI 兼容",
    tagline: "海外版 · 文本/图片/视频/音频生视频 · 4-15 秒",
    taglineEn: "Global · Text, Image, Video & Audio to Video · 4-15s",
    gradient: "from-cyan-500 to-blue-600",
    status: "available",
  },
  {
    id: "doubao-seedance-2-0-260128",
    name: "Doubao Seedance 2.0",
    nameEn: "Doubao Seedance 2.0",
    vendor: "火山方舟 · ARK",
    tagline: "多模态视频生成",
    taglineEn: "Multimodal Video",
    gradient: "from-fuchsia-500 to-pink-600",
    status: "available",
  },
  {
    id: "doubao-seedance-2-0-fast-260128",
    name: "Doubao Seedance 2.0 Fast",
    nameEn: "Doubao Seedance 2.0 Fast",
    vendor: "火山方舟 · ARK",
    tagline: "720p 快速版 · 多模态",
    taglineEn: "720p Fast · Multimodal",
    gradient: "from-pink-500 to-rose-600",
    status: "available",
  },
  {
    id: "doubao-seedance-1-0-pro-250528",
    name: "Doubao Seedance 1.0 Pro",
    nameEn: "Doubao Seedance 1.0 Pro",
    vendor: "火山方舟 · ARK",
    tagline: "文生视频",
    taglineEn: "Text to Video",
    gradient: "from-rose-500 to-orange-600",
    status: "available",
  },
  {
    id: "doubao-seedance-1-0-lite-i2v-250428",
    name: "Doubao Seedance 1.0 Lite",
    nameEn: "Doubao Seedance 1.0 Lite",
    vendor: "火山方舟 · ARK",
    tagline: "图生视频",
    taglineEn: "Image to Video",
    gradient: "from-violet-500 to-purple-700",
    status: "available",
  },
  {
    id: "dreamina-seedance-2-0-fast-hc",
    name: "Dreamina Seedance 2.0 Fast",
    nameEn: "Dreamina Seedance 2.0 Fast",
    vendor: "SD Real Max",
    tagline: "快速视频生成 · 支持文本和参考图",
    taglineEn: "Fast Video · Text and Reference Images",
    gradient: "from-cyan-500 to-blue-600",
    status: "available",
  },
  {
    id: "dreamina-seedance-2-0-hc",
    name: "Dreamina Seedance 2.0",
    nameEn: "Dreamina Seedance 2.0",
    vendor: "SD Real Max",
    tagline: "标准视频生成 · 支持文本和参考图",
    taglineEn: "Standard Video · Text and Reference Images",
    gradient: "from-sky-500 to-indigo-600",
    status: "available",
  },
  {
    id: "dreamina-seedance-2-0-mini-hc",
    name: "Dreamina Seedance 2.0 Mini",
    nameEn: "Dreamina Seedance 2.0 Mini",
    vendor: "SD Real Max",
    tagline: "轻量视频生成 · 支持文本和参考图",
    taglineEn: "Lightweight Video · Text and Reference Images",
    gradient: "from-violet-500 to-purple-700",
    status: "available",
  },
  {
    id: "keyiyun-sd-2-0-fast-discount-720p",
    name: "Seedance 2.0 官方折扣版",
    nameEn: "Seedance 2.0 Official Discount",
    vendor: "客易云",
    tagline: "720p 快速版 · 文本和图片参考",
    taglineEn: "720p Fast · Text and Image References",
    gradient: "from-amber-500 to-orange-600",
    status: "available",
  },
  {
    id: "keyiyun-seedance-2-5-c1",
    name: "Seedance 2.5（客易云）",
    nameEn: "Seedance 2.5 (Keyiyun)",
    vendor: "客易云 · model-center",
    tagline: "480p/720p · 4-30 秒 · 图片/视频/音频参考",
    taglineEn: "480p/720p · 4-30s · Image, Video & Audio References",
    gradient: "from-orange-500 to-red-600",
    status: "available",
  },
  {
    id: "tokenpony-doubao-seedance-2-5-260628",
    name: "Seedance 2.5（tokenpony）",
    nameEn: "Seedance 2.5 (tokenpony)",
    vendor: "tokenpony",
    tagline: "480p/720p · 4-15 秒 · 支持真人素材审核",
    taglineEn: "480p/720p · 4-15s · Asset Review Supported",
    gradient: "from-emerald-500 to-teal-600",
    status: "available",
  },
  {
    id: "ycore-seedance-2-0",
    name: "Seedance 2.0（爻核云）",
    nameEn: "Seedance 2.0 (Ycore Cloud)",
    vendor: "爻核云 · Ycore Cloud",
    tagline: "统一模型 · 480p/720p/1080p/4k",
    taglineEn: "Unified Model · 480p/720p/1080p/4k",
    gradient: "from-orange-500 to-amber-600",
    status: "available",
  },
  {
    id: "ycore-seedance-2-0-fast",
    name: "Seedance 2.0 Fast（爻核云）",
    nameEn: "Seedance 2.0 Fast (Ycore Cloud)",
    vendor: "爻核云 · Ycore Cloud",
    tagline: "快速版 · 480p/720p",
    taglineEn: "Fast · 480p/720p",
    gradient: "from-amber-500 to-yellow-600",
    status: "available",
  },
  {
    id: "ycore-seedance-2-0-mini",
    name: "Seedance 2.0 Mini（爻核云）",
    nameEn: "Seedance 2.0 Mini (Ycore Cloud)",
    vendor: "爻核云 · Ycore Cloud",
    tagline: "轻量版 · 480p/720p",
    taglineEn: "Mini · 480p/720p",
    gradient: "from-yellow-500 to-lime-600",
    status: "available",
  },
  {
    id: "neiwen-c-seedance-2-0",
    name: "c/seedance-2.0（内文）",
    nameEn: "c/seedance-2.0 (Neiwen)",
    vendor: "内文",
    tagline: "图片、视频、音频参考 · 4-15 秒",
    taglineEn: "Image, Video & Audio References · 4-15s",
    gradient: "from-violet-500 to-fuchsia-600",
    status: "available",
  },
  {
    id: "jieyun-doubao-seedance-2-0-260128",
    name: "Seedance 2.0（诘云）",
    nameEn: "Seedance 2.0 (Jieyun)",
    vendor: "诘云 · 火山方舟兼容",
    tagline: "多模态 · 480p/720p",
    taglineEn: "Multimodal · 480p/720p",
    gradient: "from-cyan-500 to-blue-600",
    status: "available",
  },
  {
    id: "jimeng-3.0-pro",
    name: "即梦 3.0 Pro",
    nameEn: "Jimeng 3.0 Pro",
    vendor: "火山引擎 · 视觉服务",
    tagline: "多镜头叙事 · 1080P",
    taglineEn: "Multi-shot · 1080P",
    gradient: "from-sky-500 to-indigo-600",
    status: "available",
  },
  {
    id: "jimeng-3.0-pro-i2v",
    name: "即梦 3.0 Pro (图生视频)",
    nameEn: "Jimeng 3.0 Pro (I2V)",
    vendor: "火山引擎 · 视觉服务",
    tagline: "首帧图生视频 · 1080P",
    taglineEn: "First-frame I2V · 1080P",
    gradient: "from-indigo-500 to-blue-700",
    status: "available",
  },
];

type ImageModel = {
  id: string;
  name: string;
  nameEn: string;
  vendor: string;
  tagline: string;
  taglineEn: string;
  gradient: string;
  status: "available" | "used";
};

const IMAGE_MODELS: ImageModel[] = [
  {
    id: "doubao-seedream-5-0-260128",
    name: "Doubao Seedream 5.0",
    nameEn: "Doubao Seedream 5.0",
    vendor: "火山方舟 · ARK",
    tagline: "文生图·图生图·多图融合",
    taglineEn: "T2I · I2I · Multi-Image Fusion",
    gradient: "from-amber-500 to-yellow-600",
    status: "available",
  },
  // ---- Pixflow 图像模型 ----
  {
    id: "pixflow/gemini-3-pro-image-preview",
    name: "Gemini 3 Pro Image",
    nameEn: "Gemini 3 Pro Image",
    vendor: "Pixflow · Google",
    tagline: "高质量图像 · pixflow",
    taglineEn: "High-quality · pixflow",
    gradient: "from-indigo-500 to-violet-700",
    status: "available",
  },
  {
    id: "pixflow/gemini-3.1-flash-image-preview",
    name: "Nano Banana 2",
    nameEn: "Nano Banana 2",
    vendor: "Pixflow · Google",
    tagline: "快速高质量 · pixflow",
    taglineEn: "Fast HQ · pixflow",
    gradient: "from-yellow-400 to-amber-600",
    status: "available",
  },
  {
    id: "pixflow/gemini-3.1-flash-image",
    name: "Gemini 3.1 Flash Image",
    nameEn: "Gemini 3.1 Flash Image",
    vendor: "Pixflow · Google",
    tagline: "通用图像生成/编辑 · pixflow",
    taglineEn: "General gen/edit · pixflow",
    gradient: "from-lime-400 to-emerald-600",
    status: "available",
  },
  // ---- Tokenflash / AIGCFamily 中转 ----
  {
    id: "revora/gpt-image-2-high",
    name: "GPT Image 2 High (Revora)",
    nameEn: "GPT Image 2 High (Revora)",
    vendor: "Revora · OpenAI 兼容",
    tagline: "Image2 高质量 · T2I/I2I",
    taglineEn: "Image2 high quality · T2I/I2I",
    gradient: "from-violet-500 to-purple-600",
    status: "available",
  },
  {
    id: "revora/gpt-image-2-medium",
    name: "GPT Image 2 Medium (Revora)",
    nameEn: "GPT Image 2 Medium (Revora)",
    vendor: "Revora · OpenAI 兼容",
    tagline: "Image2 均衡 · T2I/I2I",
    taglineEn: "Image2 balanced · T2I/I2I",
    gradient: "from-violet-500 to-purple-600",
    status: "available",
  },
  {
    id: "revora/gpt-image-2-low",
    name: "GPT Image 2 Low (Revora)",
    nameEn: "GPT Image 2 Low (Revora)",
    vendor: "Revora · OpenAI 兼容",
    tagline: "Image2 快速 · T2I/I2I",
    taglineEn: "Image2 fast · T2I/I2I",
    gradient: "from-violet-500 to-purple-600",
    status: "available",
  },
  {
    id: "tokenflash/gpt-image-2",
    name: "GPT Image 2 (Tokenflash)",
    nameEn: "GPT Image 2 (Tokenflash)",
    vendor: "Tokenflash · OpenAI 兼容",
    tagline: "Image2 · T2I/I2I · 推荐",
    taglineEn: "Image2 · T2I/I2I · recommended",
    gradient: "from-rose-500 to-pink-600",
    status: "available",
  },
  {
    id: "agentearth/image2",
    name: "AgentEarth Image2 (4K)",
    nameEn: "AgentEarth Image2 (4K)",
    vendor: "AgentEarth · OpenAI 兼容",
    tagline: "GPT Image 2 · T2I/I2I",
    taglineEn: "GPT Image 2 · T2I/I2I",
    gradient: "from-sky-500 to-indigo-600",
    status: "available",
  },
  {
    id: "aigcfamily/gpt-image-2",
    name: "aigcfamily-image2",
    nameEn: "aigcfamily-image2",
    vendor: "AIGCFamily · OpenAI 兼容",
    tagline: "Image2 · 仅 T2I · 中转",
    taglineEn: "Image2 · T2I only · gateway",
    gradient: "from-fuchsia-500 to-purple-600",
    status: "available",
  },
  {
    id: "aigcfamily/imagen-3.0-generate-001",
    name: "AIGC-imagen3",
    nameEn: "AIGC-imagen3",
    vendor: "AIGCFamily · OpenAI 兼容",
    tagline: "Imagen3 · 仅 T2I",
    taglineEn: "Imagen3 · T2I only",
    gradient: "from-cyan-500 to-blue-600",
    status: "available",
  },
  {
    id: "azure2/gpt-image-2",
    name: "Azure-gpt-image-2",
    nameEn: "Azure-gpt-image-2",
    vendor: "Azure OpenAI 终结点",
    tagline: "gpt-image-2 · T2I/I2I",
    taglineEn: "gpt-image-2 · T2I/I2I",
    gradient: "from-blue-500 to-cyan-600",
    status: "available",
  },
  {
    id: "azure0716/gpt-image-2",
    name: "Azure0716-gpt-image-2",
    nameEn: "Azure0716-gpt-image-2",
    vendor: "Azure OpenAI 终结点",
    tagline: "gpt-image-2 · T2I/I2I",
    taglineEn: "gpt-image-2 · T2I/I2I",
    gradient: "from-blue-500 to-cyan-600",
    status: "available",
  },
  {
    id: "azure-image2/gpt-image-2",
    name: "GPT Image 2（azure-image2 并发）",
    nameEn: "GPT Image 2 (azure-image2)",
    vendor: "晶美 APIM 并发网关",
    tagline: "gpt-image-2 · 并发 · T2I/I2I",
    taglineEn: "gpt-image-2 · Concurrent · T2I/I2I",
    gradient: "from-cyan-500 to-teal-600",
    status: "available",
  },
  {
    id: "qwen-image-2.0",
    name: "Qwen Image 2.0",
    nameEn: "Qwen Image 2.0",
    vendor: "通义千问 · Legacy",
    tagline: "T2I 兜底层",
    taglineEn: "T2I · Legacy Fallback",
    gradient: "from-emerald-500 to-green-600",
    status: "available",
  },
  {
    id: "wan2.6-t2i",
    name: "万相 2.6",
    nameEn: "Wan 2.6",
    vendor: "阿里万相 · Legacy",
    tagline: "文生图兜底层",
    taglineEn: "T2I · Legacy Fallback",
    gradient: "from-cyan-500 to-blue-600",
    status: "available",
  },
];

function ModelCard({ model, type, t, lang }: { model: any; type: string; t: any; lang: string }) {
  const [copied, setCopied] = useState(false);

  const copyId = () => {
    navigator.clipboard.writeText(model.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="card p-5 space-y-4 group">
      <div className="flex items-start justify-between">
        <div
          className={`w-11 h-11 rounded-xl bg-gradient-to-br ${model.gradient} flex items-center justify-center shadow-lg`}
        >
          {type === "chat" && <Sparkles size={20} className="text-white" />}
          {type === "image" && <ImageIcon size={20} className="text-white" />}
          {type === "video" && <Video size={20} className="text-white" />}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${model.status === "available" ? "bg-green-400" : "bg-yellow-400"}`}
          />
          <span className="text-xs text-text-muted">
            {model.status === "available" ? t.models_status_online : t.models_status_offline}
          </span>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-text-primary group-hover:text-accent transition-colors">
          {lang === "zh" ? model.name : model.nameEn}
        </h3>
        <p className="text-xs text-text-muted mt-0.5">{model.vendor}</p>
        <p className="text-sm text-text-secondary mt-1">
          {lang === "zh" ? model.tagline : model.taglineEn}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={copyId}
          title={t.models_copy_id}
          className="flex-1 py-2 rounded-lg text-xs font-semibold bg-bg-elevated border border-border text-text-secondary hover:text-accent hover:border-accent/40 transition"
        >
          {copied ? "✓" : "#"}
        </button>
        <button className="flex-1 py-2 rounded-lg text-xs font-semibold btn-primary">
          {t.models_try}
        </button>
      </div>
    </div>
  );
}

export default function Models() {
  const { t, lang } = useLanguage();
  const [active, setActive] = useState<string>("all");

  return (
    <div className="animate-fade-in space-y-8">
      <div className="text-center space-y-2">
        <h1 className="font-display text-4xl font-bold">{t.models_title}</h1>
        <p className="text-text-secondary">{t.models_subtitle}</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 justify-center">
        {[
          { key: "all", label: t.models_filter_all },
          { key: "chat", label: t.models_filter_chat },
          { key: "image", label: t.models_filter_image },
          { key: "video", label: t.models_filter_video },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setActive(f.key)}
            className={`chip ${active === f.key ? "chip-active" : ""}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* AI Models */}
      {(active === "all" || active === "chat") && (
        <section>
          <h2 className="font-display text-xl font-bold mb-4 flex items-center gap-2">
            <Sparkles size={18} className="text-accent" />
            {t.models_section_ai}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {AI_MODELS.map((m) => (
              <ModelCard key={m.id} model={m} type="chat" t={t} lang={lang} />
            ))}
          </div>
        </section>
      )}

      {/* Image Models */}
      {(active === "all" || active === "image") && (
        <section>
          <h2 className="font-display text-xl font-bold mb-4 flex items-center gap-2">
            <ImageIcon size={18} className="text-accent" />
            {t.models_section_image}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {IMAGE_MODELS.map((m) => (
              <ModelCard key={m.id} model={m} type="image" t={t} lang={lang} />
            ))}
          </div>
        </section>
      )}

      {/* Video Models */}
      {(active === "all" || active === "video") && (
        <section>
          <h2 className="font-display text-xl font-bold mb-4 flex items-center gap-2">
            <Video size={18} className="text-accent" />
            {t.models_section_video}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {VIDEO_MODELS.map((m) => (
              <ModelCard key={m.id} model={m} type="video" t={t} lang={lang} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
