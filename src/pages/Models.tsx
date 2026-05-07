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
    id: 'minimax/minimax-i2v', name: 'MiniMax I2V', nameEn: 'MiniMax I2V',
    vendor: 'MiniMax', tagline: '图像转视频', taglineEn: 'Image to Video',
    gradient: 'from-fuchsia-500 to-pink-600', status: 'available',
  },
  {
    id: 'minimax/minimax-t2v', name: 'MiniMax T2V', nameEn: 'MiniMax T2V',
    vendor: 'MiniMax', tagline: '文字转视频', taglineEn: 'Text to Video',
    gradient: 'from-rose-500 to-orange-600', status: 'available',
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
    id: 'minimax/image-01', name: 'MiniMax Image-01', nameEn: 'MiniMax Image-01',
    vendor: 'MiniMax', tagline: '超清图像生成', taglineEn: 'Ultra HD Image Gen',
    gradient: 'from-amber-500 to-yellow-600', status: 'available',
  },
  {
    id: 'recraft/recraft-v3', name: 'Recraft V3', nameEn: 'Recraft V3',
    vendor: 'Recraft', tagline: '矢量图·风格化', taglineEn: 'Vector · Stylized',
    gradient: 'from-emerald-500 to-green-600', status: 'available',
  },
]

const filters = [
  { key: 'all', label: '全部' },
  { key: 'available', label: '在线' },
  { key: 'chat', label: '对话' },
  { key: 'image', label: '绘图' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
] as const

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
          { key: 'video', label: 'Video' },
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
            AI {t.nav_models}
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
            {t.models_filter_image}
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
            Video
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
