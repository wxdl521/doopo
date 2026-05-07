import { useState, useEffect } from 'react'
import { Plus, Edit2, Trash2, Loader2, Sparkles, Save, X, ChevronDown, MessageSquare, ArrowUp, ArrowDown, Copy, Check, Download, FileText, FileType2 } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import { useServerFn } from '@tanstack/react-start'
import { generateScript } from '../lib/openrouter.functions'
import { exportScriptAsTxt, exportScriptAsDocx } from '../lib/exportScript'

type Script = {
  id: string
  title: string
  plot: string
  type: string
  genre: string
  tone: string
  content: string
  createdAt: string
}

const TYPES = [
  { value: 'Micro', key: 'script_type_micro' as const },
  { value: 'Short', key: 'script_type_short' as const },
  { value: 'Feature', key: 'script_type_feature' as const },
  { value: 'Ad', key: 'script_type_ad' as const },
]
const GENRES = [
  { value: 'Sci-Fi', key: 'script_genre_scifi' as const },
  { value: 'Romance', key: 'script_genre_romance' as const },
  { value: 'Thriller', key: 'script_genre_thriller' as const },
  { value: 'Comedy', key: 'script_genre_comedy' as const },
  { value: 'Drama', key: 'script_genre_drama' as const },
  { value: 'Horror', key: 'script_genre_horror' as const },
  { value: 'Fantasy', key: 'script_genre_fantasy' as const },
  { value: 'Historical', key: 'script_genre_historical' as const },
]
const TONES = [
  { value: 'Serious', key: 'script_tone_serious' as const },
  { value: 'Comedy', key: 'script_tone_comedy' as const },
  { value: 'Suspense', key: 'script_tone_suspense' as const },
  { value: 'Romance', key: 'script_tone_romance' as const },
  { value: 'Horror', key: 'script_tone_horror' as const },
]

const MODELS = [
  { id: 'deepseek/deepseek-chat-v3.1', label: 'DeepSeek V3.1' },
  { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1' },
  { id: 'google/gemini-2.0-flash-exp:free', label: 'Gemini 2.0 Flash (Free)' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
  { id: 'qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
  { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
]

const STORAGE_KEY = 'doopoo_scripts'

export default function Scripts() {
  const { t, lang } = useLanguage()
  const callGenerate = useServerFn(generateScript)
  const [scripts, setScripts] = useState<Script[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newPlot, setNewPlot] = useState('')
  const [selectedType, setSelectedType] = useState('Short')
  const [selectedGenre, setSelectedGenre] = useState('Drama')
  const [selectedTone, setSelectedTone] = useState('Serious')
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id)
  const [generating, setGenerating] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [exportMenuId, setExportMenuId] = useState<string | null>(null)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
      setScripts(saved)
    } catch { /* ignore */ }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts))
  }, [scripts, hydrated])

  const aiPrompt = `[${selectedType} Drama, ${selectedGenre}, ${selectedTone} tone]
Title: ${newTitle}
Plot: ${newPlot}

Please write a complete ${selectedType.toLowerCase()} drama script in ${lang === 'zh' ? 'Chinese' : 'English'} with proper scene headings, character names, dialogue, and action lines.`

  const handleGenerate = async () => {
    if (!newTitle.trim() || !newPlot.trim()) return
    setGenerating(true)

    const tempScript: Script = {
      id: Date.now().toString(),
      title: newTitle,
      plot: newPlot,
      type: selectedType,
      genre: selectedGenre,
      tone: selectedTone,
      content: '',
      createdAt: new Date().toISOString(),
    }
    setScripts(prev => [tempScript, ...prev])
    setExpandedId(tempScript.id)
    setNewTitle('')
    setNewPlot('')

    try {
      const result = await callGenerate({
        data: {
          messages: [
            { role: 'system', content: t.script_system_writer },
            { role: 'user', content: aiPrompt },
          ],
          model: selectedModel,
          max_tokens: 2000,
          temperature: 0.85,
        },
      })
      const content = result.error
        ? `${t.script_generation_failed}: ${result.error}`
        : (result.content || t.script_generation_failed)
      setScripts(prev => prev.map(s => s.id === tempScript.id ? { ...s, content } : s))
    } catch {
      setScripts(prev => prev.map(s => s.id === tempScript.id ? { ...s, content: t.script_network_error } : s))
    } finally {
      setGenerating(false)
    }
  }

  const handleOptimize = async (script: Script) => {
    if (!script.content) return
    setGenerating(true)
    try {
      const result = await callGenerate({
        data: {
          messages: [
            { role: 'system', content: t.script_system_optimizer },
            { role: 'user', content: `Optimize this ${script.type.toLowerCase()} drama script:\n\n${script.content}` },
          ],
          model: selectedModel,
          max_tokens: 2000,
          temperature: 0.8,
        },
      })
      const updated = result.error ? script.content : (result.content || script.content)
      setScripts(prev => prev.map(s => s.id === script.id ? { ...s, content: updated } : s))
    } finally {
      setGenerating(false)
    }
  }

  const handleDelete = (id: string) => {
    setScripts(prev => prev.filter(s => s.id !== id))
  }

  const handleCopy = (id: string, content: string) => {
    navigator.clipboard.writeText(content)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  const exportLabels = {
    type: t.script_type,
    genre: t.script_genre,
    tone: t.script_tone,
    createdAt: t.script_created_at,
    plot: t.script_plot_label,
    content: t.script_content_label,
  }

  const handleExport = async (script: Script, format: 'txt' | 'docx') => {
    setExportMenuId(null)
    if (format === 'txt') exportScriptAsTxt(script, exportLabels)
    else await exportScriptAsDocx(script, exportLabels)
  }

  return (
    <div className="animate-fade-in space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="font-display text-4xl font-bold">{t.scripts_title}</h1>
        <p className="text-text-secondary mt-1">{t.scripts_subtitle}</p>
      </div>

      {/* Create */}
      <div className="panel p-6 space-y-4">
        <h2 className="font-semibold text-text-primary flex items-center gap-2">
          <Sparkles size={16} className="text-accent" />
          {t.scripts_create_new}
        </h2>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-text-muted mb-1 block">{t.script_type}</label>
            <select
              value={selectedType}
              onChange={e => setSelectedType(e.target.value)}
              className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-3 py-2 focus:outline-none focus:border-accent/50"
            >
              {TYPES.map(tp => <option key={tp.value} value={tp.value}>{t[tp.key]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-text-muted mb-1 block">{t.script_genre}</label>
            <select
              value={selectedGenre}
              onChange={e => setSelectedGenre(e.target.value)}
              className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-3 py-2 focus:outline-none focus:border-accent/50"
            >
              {GENRES.map(g => <option key={g.value} value={g.value}>{t[g.key]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-text-muted mb-1 block">{t.script_tone}</label>
            <select
              value={selectedTone}
              onChange={e => setSelectedTone(e.target.value)}
              className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-3 py-2 focus:outline-none focus:border-accent/50"
            >
              {TONES.map(tn => <option key={tn.value} value={tn.value}>{t[tn.key]}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs text-text-muted mb-1 block">{t.script_model}</label>
          <select
            value={selectedModel}
            onChange={e => setSelectedModel(e.target.value)}
            className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-3 py-2 focus:outline-none focus:border-accent/50"
          >
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs text-text-muted mb-1 block">{t.script_theme}</label>
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder={t.script_theme_hint}
            className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-3 py-2 focus:outline-none focus:border-accent/50 placeholder:text-text-muted"
          />
        </div>

        <div>
          <label className="text-xs text-text-muted mb-1 block">{t.script_plot}</label>
          <textarea
            value={newPlot}
            onChange={e => setNewPlot(e.target.value)}
            placeholder={t.script_plot_hint}
            rows={3}
            className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary p-3 resize-none focus:outline-none focus:border-accent/50 placeholder:text-text-muted"
          />
        </div>

        <button
          onClick={handleGenerate}
          disabled={generating || !newTitle.trim() || !newPlot.trim()}
          className="w-full btn-primary justify-center disabled:opacity-40"
        >
          {generating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {generating ? t.common_loading : t.script_generate}
        </button>
      </div>

      {/* Scripts list */}
      <div className="space-y-3">
        <h2 className="font-display text-xl font-bold">
          {t.scripts_library} ({scripts.length})
        </h2>

        {scripts.length === 0 ? (
          <div className="panel py-16 text-center">
            <MessageSquare size={40} className="text-text-muted mx-auto mb-3" />
            <p className="text-text-muted text-sm">{t.script_no_content}</p>
          </div>
        ) : (
          scripts.map(script => (
            <div key={script.id} className="panel overflow-hidden">
              {/* Summary bar */}
              <button
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-bg-elevated/50 transition text-left"
                onClick={() => setExpandedId(expandedId === script.id ? null : script.id)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`chip-active chip text-xs flex-shrink-0`}>{script.type}</span>
                  <span className="font-medium text-text-primary truncate">{script.title}</span>
                  <span className="text-xs text-text-muted flex-shrink-0 hidden sm:inline">
                    {script.genre} · {script.tone}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                  <button
                    onClick={e => { e.stopPropagation(); handleCopy(script.id, script.content) }}
                    className="p-1.5 rounded-lg hover:bg-bg-elevated text-text-muted hover:text-accent transition"
                  >
                    {copiedId === script.id ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(script.id) }}
                    className="p-1.5 rounded-lg hover:bg-bg-elevated text-text-muted hover:text-red-400 transition"
                  >
                    <Trash2 size={14} />
                  </button>
                  <ChevronDown size={14} className={`text-text-muted transition-transform ${expandedId === script.id ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {/* Expanded content */}
              {expandedId === script.id && (
                <div className="px-5 pb-5 space-y-3 border-t border-border pt-4">
                  {script.content ? (
                    <>
                      <pre className="whitespace-pre-wrap text-sm text-text-secondary leading-relaxed font-mono bg-bg-elevated rounded-xl p-4 max-h-96 overflow-y-auto">
                        {script.content}
                      </pre>
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => handleOptimize(script)}
                          disabled={generating}
                          className="btn-ghost text-xs"
                        >
                          <Sparkles size={13} />
                          {t.script_optimize}
                        </button>
                        <button
                          onClick={() => handleCopy(script.id, script.content)}
                          className="btn-ghost text-xs"
                        >
                          <Copy size={13} />
                          {copiedId === script.id ? t.script_copied : t.script_copy}
                        </button>
                        <div className="relative">
                          <button
                            onClick={() => setExportMenuId(exportMenuId === script.id ? null : script.id)}
                            className="btn-ghost text-xs"
                          >
                            <Download size={13} />
                            {t.script_export}
                            <ChevronDown size={12} className={`transition-transform ${exportMenuId === script.id ? 'rotate-180' : ''}`} />
                          </button>
                          {exportMenuId === script.id && (
                            <div className="absolute z-10 mt-1 left-0 min-w-[180px] rounded-lg border border-border bg-bg-elevated shadow-lg overflow-hidden">
                              <button
                                onClick={() => handleExport(script, 'txt')}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-base text-left"
                              >
                                <FileText size={13} />
                                {t.script_export_txt}
                              </button>
                              <button
                                onClick={() => handleExport(script, 'docx')}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-base text-left"
                              >
                                <FileType2 size={13} />
                                {t.script_export_docx}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-center py-8 gap-2 text-text-muted text-sm">
                      <Loader2 size={16} className="animate-spin" />
                      {generating ? t.common_loading : t.script_no_content}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
