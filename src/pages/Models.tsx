import { Sparkles, Zap, ImageIcon, Music2, Video, Mic2, Globe, CheckCircle2, AlertCircle } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useLanguage } from '../i18n/LanguageContext'

type AIModel = {
  id: string
  name: string
  nameEn: string
  vendor: string
  tagline: string
  taglineEn: string
  gradient: string
  status: 'available' | 'used'
}

const AI_MODELS: AIModel[] = [
  {
    id: 'deepseek/deepseek-chat-v3', name: 'DeepSeek Chat', nameEn: 'DeepSeek Chat',
    vendor: 'DeepSeek', tagline: '快速·中文友好', taglineEn: 'Fast · Chinese-friendly',
    gradient: 'from-cyan-500 to-teal-600', status: 'available',
  },
  {
    id: 'mistralai/mistral-nemo', name: 'Mistral Nemo', nameEn: 'Mistral Nemo',
    vendor: 'Mistral AI', tagline: '均衡·多语言', taglineEn: 'Balanced · Multilingual',
    gradient: 'from-violet-500 to-purple-700', status: 'available',
  },
  {
    id: 'meta-llama/llama-3.1-8b-instruct', name: 'Llama 3.1', nameEn: 'Llama 3.1',
    vendor: 'Meta', tagline: '开源·推理强', taglineEn: 'Open Source · Strong Reasoning',
    gradient: 'from-orange-500 to-rose-700', status: 'used',
  },
]

type VideoModel = {
  id: string
  name: string
  nameEn: string
  vendor: string
  tagline: string
  taglineEn: string
  gradient: string
  status: 'available' | 'used'
}

const VIDEO_MODELS: VideoModel[] = [
  {
    id: 'doubao-seedance-2-0-260128', name: 'Doubao Seedance 2.0', nameEn: 'Doubao Seedance 2.0',
    vendor: '火山方舟 · ARK', tagline: '多模态视频生成', taglineEn: 'Multimodal Video',
    gradient: 'from-fuchsia-500 to-pink-600', status: 'available',
  },
  {
    id: 'doubao-seedance-2-0-fast-260128', name: 'Doubao Seedance 2.0 Fast', nameEn: 'Doubao Seedance 2.0 Fast',
    vendor: '火山方舟 · ARK', tagline: '720p 快速版 · 多模态', taglineEn: '720p Fast · Multimodal',
    gradient: 'from-pink-500 to-rose-600', status: 'available',
  },
  {
    id: 'doubao-seedance-1-0-pro-250528', name: 'Doubao Seedance 1.0 Pro', nameEn: 'Doubao Seedance 1.0 Pro',
    vendor: '火山方舟 · ARK', tagline: '文生视频', taglineEn: 'Text to Video',
    gradient: 'from-rose-500 to-orange-600', status: 'available',
  },
  {
    id: 'doubao-seedance-1-0-lite-i2v-250428', name: 'Doubao Seedance 1.0 Lite', nameEn: 'Doubao Seedance 1.0 Lite',
    vendor: '火山方舟 · ARK', tagline: '图生视频', taglineEn: 'Image to Video',
    gradient: 'from-violet-500 to-purple-700', status: 'available',
  },
  {
    id: 'jimeng-3.0-pro', name: '即梦 3.0 Pro', nameEn: 'Jimeng 3.0 Pro',
    vendor: '火山引擎 · 视觉服务', tagline: '多镜头叙事 · 1080P', taglineEn: 'Multi-shot · 1080P',
    gradient: 'from-sky-500 to-indigo-600', status: 'available',
  },
  {
    id: 'jimeng-3.0-pro-i2v', name: '即梦 3.0 Pro (图生视频)', nameEn: 'Jimeng 3.0 Pro (I2V)',
    vendor: '火山引擎 · 视觉服务', tagline: '首帧图生视频 · 1080P', taglineEn: 'First-frame I2V · 1080P',
    gradient: 'from-indigo-500 to-blue-700', status: 'available',
  },
]

type ImageModel = {
  id: string
  name: string
  nameEn: string
  vendor: string
  tagline: string
  taglineEn: string
  gradient: string
  status: 'available' | 'used'
}

const IMAGE_MODELS: ImageModel[] = [
  {
    id: 'doubao-seedream-5-0-260128', name: 'Doubao Seedream 5.0', nameEn: 'Doubao Seedream 5.0',
    vendor: '火山方舟 · ARK', tagline: '文生图·图生图·多图融合', taglineEn: 'T2I · I2I · Multi-Image Fusion',
    gradient: 'from-amber-500 to-yellow-600', status: 'available',
  },
  {
    id: 'qwen-image-2.0', name: 'Qwen Image 2.0', nameEn: 'Qwen Image 2.0',
    vendor: '通义千问 · Legacy', tagline: 'T2I 兜底层', taglineEn: 'T2I · Legacy Fallback',
    gradient: 'from-emerald-500 to-green-600', status: 'available',
  },
  {
    id: 'wan2.6-t2i', name: '万相 2.6', nameEn: 'Wan 2.6',
    vendor: '阿里万相 · Legacy', tagline: '文生图兜底层', taglineEn: 'T2I · Legacy Fallback',
    gradient: 'from-cyan-500 to-blue-600', status: 'available',
  },
]

function ModelCard({ model, type, t, lang }: { model: any; type: string; t: any; lang: string }) {
  const [copied, setCopied] = useState(false)

  const copyId = () => {
    navigator.clipboard.writeText(model.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="card p-5 space-y-4 group">
      <div className="flex items-start justify-between">
        <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${model.gradient} flex items-center justify-center shadow-lg`}>
          {type === 'chat' && <Sparkles size={20} className="text-white" />}
          {type === 'image' && <ImageIcon size={20} className="text-white" />}
          {type === 'video' && <Video size={20} className="text-white" />}
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${model.status === 'available' ? 'bg-green-400' : 'bg-yellow-400'}`} />
          <span className="text-xs text-text-muted">
            {model.status === 'available' ? t.models_status_online : t.models_status_offline}
          </span>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-text-primary group-hover:text-accent transition-colors">
          {lang === 'zh' ? model.name : model.nameEn}
        </h3>
        <p className="text-xs text-text-muted mt-0.5">{model.vendor}</p>
        <p className="text-sm text-text-secondary mt-1">
          {lang === 'zh' ? model.tagline : model.taglineEn}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={copyId}
          title={t.models_copy_id}
          className="flex-1 py-2 rounded-lg text-xs font-semibold bg-bg-elevated border border-border text-text-secondary hover:text-accent hover:border-accent/40 transition"
        >
          {copied ? '✓' : '#'}
        </button>
        <button className="flex-1 py-2 rounded-lg text-xs font-semibold btn-primary">
          {t.models_try}
        </button>
      </div>
    </div>
  )
}

export default function Models() {
  const { t, lang } = useLanguage()
  const [active, setActive] = useState<string>('all')

  return (
    <div className="animate-fade-in space-y-8">
      <div className="text-center space-y-2">
        <h1 className="font-display text-4xl font-bold">{t.models_title}</h1>
        <p className="text-text-secondary">{t.models_subtitle}</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 justify-center">
        {[
          { key: 'all', label: t.models_filter_all },
          { key: 'chat', label: t.models_filter_chat },
          { key: 'image', label: t.models_filter_image },
          { key: 'video', label: t.models_filter_video },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setActive(f.key)}
            className={`chip ${active === f.key ? 'chip-active' : ''}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* AI Models */}
      {(active === 'all' || active === 'chat') && (
        <section>
          <h2 className="font-display text-xl font-bold mb-4 flex items-center gap-2">
            <Sparkles size={18} className="text-accent" />
            {t.models_section_ai}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {AI_MODELS.map(m => (
              <ModelCard key={m.id} model={m} type="chat" t={t} lang={lang} />
            ))}
          </div>
        </section>
      )}

      {/* Image Models */}
      {(active === 'all' || active === 'image') && (
        <section>
          <h2 className="font-display text-xl font-bold mb-4 flex items-center gap-2">
            <ImageIcon size={18} className="text-accent" />
            {t.models_section_image}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {IMAGE_MODELS.map(m => (
              <ModelCard key={m.id} model={m} type="image" t={t} lang={lang} />
            ))}
          </div>
        </section>
      )}

      {/* Video Models */}
      {(active === 'all' || active === 'video') && (
        <section>
          <h2 className="font-display text-xl font-bold mb-4 flex items-center gap-2">
            <Video size={18} className="text-accent" />
            {t.models_section_video}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {VIDEO_MODELS.map(m => (
              <ModelCard key={m.id} model={m} type="video" t={t} lang={lang} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
