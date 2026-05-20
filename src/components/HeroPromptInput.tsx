import { useState, useRef, useEffect } from 'react'
import { ArrowRight, ChevronDown, FileText, ImagePlus, Loader2, Plus, RefreshCw, Sparkles, X, MessageCircle, Film } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../hooks/useAuth'

const SCRIPT_TYPES = ['Micro', 'Short', 'Feature', 'Ad'] as const
const SCRIPT_GENRES = ['Sci-Fi', 'Romance', 'Thriller', 'Comedy', 'Drama', 'Horror', 'Fantasy', 'Historical'] as const
const SCRIPT_TONES = ['Serious', 'Comedy', 'Suspense', 'Romance', 'Horror'] as const

const PROXY_URL = 'http://43.130.52.57:8080/v1/chat/completions'

export default function HeroPromptInput() {
  const { t, lang } = useLanguage()
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const AI_MODELS = [
    { id: 'deepseek/deepseek-chat-v3', label: 'DeepSeek Chat', desc: lang === 'zh' ? '快速·中文友好' : 'Fast · Chinese-friendly' },
    { id: 'mistralai/mistral-nemo', label: 'Mistral Nemo', desc: lang === 'zh' ? '均衡·多语言' : 'Balanced · Multilingual' },
    { id: 'meta-llama/llama-3.1-8b-instruct', label: 'Llama 3.1', desc: lang === 'zh' ? '开源·推理强' : 'Open Source · Strong Reasoning' },
  ]
  const placeholders = [t.prompt_placeholder_1, t.prompt_placeholder_2, t.prompt_placeholder_3, t.prompt_placeholder_4]

  const [value, setValue] = useState('')
  const [selectedModel, setSelectedModel] = useState(AI_MODELS[0])
  const [showModels, setShowModels] = useState(false)
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState('')
  const [showResponse, setShowResponse] = useState(false)
  const [error, setError] = useState('')
  const [phIndex] = useState(() => Math.floor(Math.random() * placeholders.length))
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 剧本生成面板
  const [showScriptPanel, setShowScriptPanel] = useState(false)
  const [scriptType, setScriptType] = useState<string>('Short')
  const [scriptGenre, setScriptGenre] = useState<string>('Drama')
  const [scriptTone, setScriptTone] = useState<string>('Serious')
  const scriptPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showScriptPanel) return
    const onDown = (e: MouseEvent) => {
      if (scriptPanelRef.current && !scriptPanelRef.current.contains(e.target as Node)) {
        setShowScriptPanel(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showScriptPanel])

  const handleStartScript = () => {
    try {
      sessionStorage.setItem(
        'script_prefill',
        JSON.stringify({
          type: scriptType,
          genre: scriptGenre,
          tone: scriptTone,
          theme: '',
          plot: value.trim(),
        }),
      )
    } catch {}
    setShowScriptPanel(false)
    if (!isAuthenticated) {
      navigate({ to: '/login' })
    } else {
      navigate({ to: '/scripts' })
    }
  }

  const handleCreate = async () => {
    if (!value.trim() || loading) return
    setLoading(true)
    setError('')
    setResponse('')
    setShowResponse(true)

    try {
      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel.id,
          messages: [{ role: 'user', content: value.trim() }],
          max_tokens: 800,
          stream: false,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error?.message || `HTTP ${res.status}`)
      }

      const data = await res.json()
      setResponse(data.choices?.[0]?.message?.content || t.hero_no_reply)
    } catch (e: any) {
      setError(e.message || t.hero_request_failed)
    } finally {
      setLoading(false)
    }
  }

  const closeResponse = () => {
    setShowResponse(false)
    setResponse('')
    setError('')
  }

  return (
    <div className="space-y-4">
      {/* 输入区 */}
      <div className="relative">
        <div className="absolute -inset-4 bg-glow-orb opacity-70 blur-2xl pointer-events-none" />
        <div className="relative corner-frame panel p-5 md:p-6 animate-slide-up">
          <span className="c-tr" /><span className="c-bl" />

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholders[phIndex]}
            rows={3}
            className="w-full bg-transparent resize-none outline-none text-text-primary placeholder:text-text-muted
                       text-base md:text-lg leading-relaxed"
          />

          <div className="mt-4 flex flex-wrap items-center gap-2 md:gap-3">
            <button className="btn-ghost !px-3" title={t.hero_attach}><Plus size={16} /></button>
            <button className="btn-ghost"><FileText size={15} /> {t.hero_upload_script}</button>
            <button className="btn-ghost"><ImagePlus size={15} /> {t.hero_upload_storyboard}</button>

            {/* 剧本生成入口 */}
            <div className="relative" ref={scriptPanelRef}>
              <button
                onClick={() => setShowScriptPanel((s) => !s)}
                className="btn-ghost"
              >
                <Film size={14} className="text-accent" />
                {t.hero_script_entry}
                <ChevronDown size={14} className="opacity-60" />
              </button>
              {showScriptPanel && (
                <div className="absolute left-0 top-full mt-2 w-[22rem] panel p-3 z-30 animate-fade-in shadow-glow space-y-3">
                  <div className="text-xs font-medium text-text-secondary">{t.hero_script_panel_title}</div>
                  <ChipRow
                    label={t.hero_script_type}
                    options={SCRIPT_TYPES as readonly string[]}
                    value={scriptType}
                    onChange={setScriptType}
                  />
                  <ChipRow
                    label={t.hero_script_genre}
                    options={SCRIPT_GENRES as readonly string[]}
                    value={scriptGenre}
                    onChange={setScriptGenre}
                  />
                  <ChipRow
                    label={t.hero_script_tone}
                    options={SCRIPT_TONES as readonly string[]}
                    value={scriptTone}
                    onChange={setScriptTone}
                  />
                  <button
                    onClick={handleStartScript}
                    className="btn-primary w-full justify-center"
                  >
                    <Sparkles size={14} /> {t.hero_script_start}
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>

            {/* 模型选择器 */}
            <div className="relative">
              <button
                onClick={() => setShowModels((s) => !s)}
                className="btn-ghost"
              >
                <RefreshCw size={14} className="text-accent" />
                {selectedModel.label}
                <ChevronDown size={14} className="opacity-60" />
              </button>
              {showModels && (
                <div className="absolute left-0 top-full mt-2 w-64 panel p-1.5 z-20 animate-fade-in shadow-glow">
                  {AI_MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { setSelectedModel(m); setShowModels(false) }}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition
                        ${m.id === selectedModel.id
                          ? 'bg-accent-dim text-accent border border-accent/30'
                          : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'}`}
                    >
                      <div className="font-medium">{m.label}</div>
                      <div className="text-xs opacity-60 mt-0.5">{m.desc} · {m.id}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="ml-auto flex items-center gap-2 text-xs text-text-muted">
              <span className="hidden md:inline">{value.length} {t.hero_chars_suffix}</span>
              <button
                onClick={handleCreate}
                disabled={!value.trim() || loading}
                className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                {loading ? t.hero_thinking : t.hero_create}
                {!loading && <ArrowRight size={14} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* AI 回复区 */}
      {showResponse && (
        <div className="panel p-5 animate-slide-up border-accent/20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <MessageCircle size={14} className="text-accent" />
              <span>{t.hero_ai_reply}</span>
              <span className="text-xs text-text-muted">· {selectedModel.label}</span>
            </div>
            <button onClick={closeResponse} className="btn-ghost !px-2 !py-1 text-xs">
              <X size={12} /> {t.hero_close}
            </button>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-text-muted text-sm">
              <Loader2 size={14} className="animate-spin" />
              {t.hero_generating_reply}
            </div>
          )}

          {error && (
            <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3">
              ⚠️ {error}
            </div>
          )}

          {response && !loading && (
            <div className="text-text-primary text-sm leading-relaxed whitespace-pre-wrap bg-bg-elevated rounded-xl px-4 py-3 border border-border/50">
              {response}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ChipRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly string[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-text-muted mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = opt === value
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={`px-2.5 py-1 rounded-full text-xs border transition ${
                active
                  ? 'bg-accent text-bg-base border-accent font-medium'
                  : 'bg-bg-elevated text-text-secondary border-border hover:text-text-primary hover:border-accent/40'
              }`}
            >
              {opt}
            </button>
          )
        })}
      </div>
    </div>
  )
}