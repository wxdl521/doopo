import { useState, useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { Trash2, MessageSquare, FileText, Cloud, LogIn, Share2 } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import ScriptComposer from '../components/scripts/ScriptComposer'
import { loadScripts, removeScript, syncFromCloud, type SavedScript } from '../lib/scriptStorage'
import { useAuth } from '../hooks/useAuth'
import ShareDialog from '../components/community/ShareDialog'

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
  // 直连 Google Gemini（使用 Default_Gemini_API_Key）
  { id: 'gemini:gemini-3.5-flash', label: '✨ Gemini 3.5 Flash (默认)' },
  { id: 'gemini:gemini-2.5-flash', label: '✨ Gemini 2.5 Flash' },
  { id: 'gemini:gemini-2.5-pro', label: '✨ Gemini 2.5 Pro' },
  // Lovable AI Gateway — 推荐，速度更快、内置额度
  { id: 'lovable:google/gemini-3-flash-preview', label: '⚡ Lovable · Gemini 3 Flash (推荐)' },
  { id: 'lovable:google/gemini-2.5-flash', label: '⚡ Lovable · Gemini 2.5 Flash' },
  { id: 'lovable:google/gemini-2.5-pro', label: '⚡ Lovable · Gemini 2.5 Pro' },
  { id: 'lovable:openai/gpt-5-mini', label: '⚡ Lovable · GPT-5 Mini' },
  { id: 'lovable:openai/gpt-5', label: '⚡ Lovable · GPT-5' },
  { id: 'lovable:openai/gpt-5.5', label: '⚡ Lovable · GPT-5.5' },
  // MiniMax（使用 MINIMAX_API_KEY）
  { id: 'minimax:MiniMax-M2.7', label: '🔵 MiniMax M2.7（备选）' },
  // 阿里通义千问（使用 Qwen 密钥，DashScope OpenAI 兼容接口）
  { id: 'qwen:qwen3-max', label: '🟣 Qwen3 Max（旗舰）' },
  { id: 'qwen:qwen3-plus', label: '🟣 Qwen3 Plus（均衡）' },
  { id: 'qwen:qwen3-turbo', label: '🟣 Qwen3 Turbo（高速）' },
  { id: 'qwen:qwen3-coder-plus', label: '🟣 Qwen3 Coder Plus（代码/结构化）' },
  { id: 'qwen:qwen-plus', label: '🟣 Qwen Plus（稳定）' },
  { id: 'qwen:qwen-turbo', label: '🟣 Qwen Turbo（轻量）' },
]

export default function Scripts() {
  const { t } = useLanguage()
  const [scripts, setScripts] = useState<SavedScript[]>([])
  const { isAuthenticated, loading: authLoading, user, signOut } = useAuth()
  const [shareScript, setShareScript] = useState<SavedScript | null>(null)

  const refresh = () => setScripts(loadScripts())
  useEffect(() => {
    refresh()
    // 登录后从云端拉取并合并，未登录则静默跳过
    void syncFromCloud().then((merged) => setScripts(merged))
  }, [isAuthenticated])

  const handleDelete = (id: string) => {
    setScripts(removeScript(id))
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="text-center">
        <h1 className="font-display text-4xl font-bold">{t.scripts_title}</h1>
        <p className="text-text-secondary mt-1">剧本智能体 · 5 步对话式创作：灵感 → 故事梗概 → 分镜脚本 → 多剧集（逐集生成 · 可中途保存）→ 完成</p>
      </div>

      {!authLoading && !isAuthenticated && (
        <div className="panel p-4 flex items-center justify-between gap-3 border border-accent/30 bg-accent-dim/40">
          <div className="flex items-center gap-3 text-sm">
            <Cloud size={18} className="text-accent shrink-0" />
            <div>
              <div className="font-semibold text-text-primary">请先登录以启用云同步</div>
              <div className="text-text-secondary text-xs mt-0.5">
                未登录时剧本仅保存在当前浏览器，登录后可在多设备间同步并防止数据丢失。
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link to="/login" className="btn-primary inline-flex items-center gap-1.5 text-sm">
              <LogIn size={14} /> 登录
            </Link>
            <Link to="/register" className="text-sm text-accent hover:underline">
              注册
            </Link>
          </div>
        </div>
      )}

      {!authLoading && isAuthenticated && (
        <div className="flex items-center justify-end gap-3 text-xs text-text-muted">
          <Cloud size={12} className="text-accent" />
          <span>已登录 {user?.email} · 云同步已启用</span>
          <button onClick={() => void signOut()} className="text-accent hover:underline">
            退出
          </button>
        </div>
      )}

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
              const epCount = s.episodesText?.length ?? 0
              const sceneCount = s.scenes?.length ?? 0
              const preview =
                s.logline ||
                (s.synopsisText
                  ? s.synopsisText.replace(/[#*`>_\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90)
                  : s.plot)
              return (
                <div key={s.id} className="panel overflow-hidden group">
                  <Link to="/scripts/$scriptId" params={{ scriptId: s.id }} className="block">
                    <div className="h-24 relative" style={{ background: bg }}>
                      <span className="absolute top-2 left-2 chip chip-active text-[10px]">{s.type}</span>
                      <span className="absolute top-2 right-2 text-[10px] text-white/80">
                        {epCount > 0 ? `${epCount} 集` : `${sceneCount} 场`}
                      </span>
                    </div>
                    <div className="p-3 space-y-1.5">
                      <div className="font-semibold text-text-primary truncate">{s.title}</div>
                      <div className="text-xs text-text-muted truncate">
                        {Array.isArray(s.genre) ? s.genre.join('、') : s.genre} · {Array.isArray(s.tone) ? s.tone.join('、') : s.tone}
                      </div>
                      {preview && (
                        <div className="text-xs text-text-secondary line-clamp-2">{preview}</div>
                      )}
                      {s.quality ? (
                        <div className="flex gap-1 pt-1 text-[10px] text-text-muted">
                          <span>♥ {s.quality.pacing}</span>
                          <span>⚡ {s.quality.conflict}</span>
                          <span>💬 {s.quality.dialogueDensity}</span>
                        </div>
                      ) : (
                        <div className="text-[10px] text-text-muted pt-1">
                          更新于 {new Date(s.updatedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </Link>
                  <div className="flex items-center justify-between px-3 pb-3">
                    <Link to="/scripts/$scriptId" params={{ scriptId: s.id }}
                      className="text-xs text-accent hover:underline inline-flex items-center gap-1">
                      <FileText size={12} /> {t.script_step_open_detail}
                    </Link>
                    <div className="flex items-center gap-1">
                      <button onClick={() => {
                        if (!isAuthenticated) { alert('请先登录后再分享到社区'); return }
                        setShareScript(s)
                      }}
                        title="分享到社区"
                        className="p-1.5 rounded hover:bg-bg-elevated text-text-muted hover:text-accent">
                        <Share2 size={13} />
                      </button>
                      <button onClick={() => handleDelete(s.id)}
                        className="p-1.5 rounded hover:bg-bg-elevated text-text-muted hover:text-red-400">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {shareScript && (
        <ShareDialog
          open
          onClose={() => setShareScript(null)}
          kind="script"
          sourceId={shareScript.id}
          defaultTitle={shareScript.title}
          defaultSummary={shareScript.logline || shareScript.premise || ''}
          coverGradient={(() => {
            const palette = shareScript.characters?.[0]?.palette ?? ['#7c3aed', '#ec4899', '#f97316']
            return `linear-gradient(135deg, ${palette[0]}, ${palette[palette.length - 1]})`
          })()}
          payload={shareScript}
        />
      )}
    </div>
  )
}
