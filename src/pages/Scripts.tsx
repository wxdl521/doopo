import { useState, useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { Trash2, MessageSquare, FileText } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import ScriptComposer from '../components/scripts/ScriptComposer'
import { loadScripts, removeScript, syncFromCloud, type SavedScript } from '../lib/scriptStorage'

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
  // Lovable AI Gateway — 推荐，速度更快、内置额度
  { id: 'lovable:google/gemini-3-flash-preview', label: '⚡ Lovable · Gemini 3 Flash (推荐)' },
  { id: 'lovable:google/gemini-2.5-flash', label: '⚡ Lovable · Gemini 2.5 Flash' },
  { id: 'lovable:google/gemini-2.5-pro', label: '⚡ Lovable · Gemini 2.5 Pro' },
  { id: 'lovable:openai/gpt-5-mini', label: '⚡ Lovable · GPT-5 Mini' },
  { id: 'lovable:openai/gpt-5', label: '⚡ Lovable · GPT-5' },
  { id: 'lovable:openai/gpt-5.5', label: '⚡ Lovable · GPT-5.5' },
]

export default function Scripts() {
  const { t } = useLanguage()
  const [scripts, setScripts] = useState<SavedScript[]>([])

  const refresh = () => setScripts(loadScripts())
  useEffect(() => {
    refresh()
    // 登录后从云端拉取并合并，未登录则静默跳过
    void syncFromCloud().then((merged) => setScripts(merged))
  }, [])

  const handleDelete = (id: string) => {
    setScripts(removeScript(id))
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="text-center">
        <h1 className="font-display text-4xl font-bold">{t.scripts_title}</h1>
        <p className="text-text-secondary mt-1">剧本智能体 · 5 步对话式创作：灵感 → 故事梗概 → 分镜脚本 → 多剧集（逐集生成 · 可中途保存）→ 完成</p>
      </div>

      <ScriptComposer
        types={TYPES}
        genres={GENRES}
        tones={TONES}
        models={MODELS}
        onSaved={refresh}
      />

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {scripts.map((s) => {
              const palette = s.characters?.[0]?.palette ?? ['#7c3aed', '#ec4899', '#f97316']
              const bg = `linear-gradient(135deg, ${palette[0]}, ${palette[palette.length - 1]})`
              return (
                <div key={s.id} className="panel overflow-hidden group">
                  <Link to="/scripts/$scriptId" params={{ scriptId: s.id }} className="block">
                    <div className="h-24 relative" style={{ background: bg }}>
                      <span className="absolute top-2 left-2 chip chip-active text-[10px]">{s.type}</span>
                      <span className="absolute top-2 right-2 text-[10px] text-white/80">
                        {s.scenes?.length ?? 0} 场
                      </span>
                    </div>
                    <div className="p-3 space-y-1.5">
                      <div className="font-semibold text-text-primary truncate">{s.title}</div>
                      <div className="text-xs text-text-muted truncate">
                        {s.genre} · {s.tone}
                      </div>
                      {s.logline && (
                        <div className="text-xs text-text-secondary line-clamp-2">{s.logline}</div>
                      )}
                      {s.quality && (
                        <div className="flex gap-1 pt-1 text-[10px] text-text-muted">
                          <span>♥ {s.quality.pacing}</span>
                          <span>⚡ {s.quality.conflict}</span>
                          <span>💬 {s.quality.dialogueDensity}</span>
                        </div>
                      )}
                    </div>
                  </Link>
                  <div className="flex items-center justify-between px-3 pb-3">
                    <Link to="/scripts/$scriptId" params={{ scriptId: s.id }}
                      className="text-xs text-accent hover:underline inline-flex items-center gap-1">
                      <FileText size={12} /> {t.script_step_open_detail}
                    </Link>
                    <button onClick={() => handleDelete(s.id)}
                      className="p-1.5 rounded hover:bg-bg-elevated text-text-muted hover:text-red-400">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
