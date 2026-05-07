import { useState, useRef } from 'react'
import { ArrowRight, ChevronDown, FileText, ImagePlus, Loader2, Plus, RefreshCw, Sparkles, X, MessageCircle } from 'lucide-react'

const AI_MODELS = [
  { id: 'deepseek/deepseek-chat-v3', label: 'DeepSeek Chat', desc: '快速·中文友好' },
  { id: 'mistralai/mistral-nemo', label: 'Mistral Nemo', desc: '均衡·多语言' },
  { id: 'meta-llama/llama-3.1-8b-instruct', label: 'Llama 3.1', desc: '开源·推理强' },
]

const PROXY_URL = 'http://43.130.52.57:8080/v1/chat/completions'

const placeholders = [
  '描述一个赛博朋克城市夜景，需要包含霓虹灯、雨后的街道和远处的广告牌 →',
  '写一段关于AI与人类情感的对话脚本 →',
  '解释量子计算的基本原理，用简单的比喻 →',
  '帮我写一篇关于可再生能源的科普文章开头 →',
]

export default function HeroPromptInput() {
  const [value, setValue] = useState('')
  const [selectedModel, setSelectedModel] = useState(AI_MODELS[0])
  const [showModels, setShowModels] = useState(false)
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState('')
  const [showResponse, setShowResponse] = useState(false)
  const [error, setError] = useState('')
  const [phIndex] = useState(() => Math.floor(Math.random() * placeholders.length))
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
      setResponse(data.choices?.[0]?.message?.content || '（无回复内容）')
    } catch (e: any) {
      setError(e.message || '请求失败')
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
            <button className="btn-ghost !px-3" title="附件"><Plus size={16} /></button>
            <button className="btn-ghost"><FileText size={15} /> 上传脚本</button>
            <button className="btn-ghost"><ImagePlus size={15} /> 上传故事板</button>

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
              <span className="hidden md:inline">{value.length} 字符</span>
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
                {loading ? '思考中…' : '创建'}
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
              <span>AI 回复</span>
              <span className="text-xs text-text-muted">· {selectedModel.label}</span>
            </div>
            <button onClick={closeResponse} className="btn-ghost !px-2 !py-1 text-xs">
              <X size={12} /> 关闭
            </button>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-text-muted text-sm">
              <Loader2 size={14} className="animate-spin" />
              正在生成回复…
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