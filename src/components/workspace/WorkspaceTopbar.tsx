import { useState } from 'react'
// no Link needed; Logo provides home link
import { ChevronDown, MoreHorizontal, Layers, FileText, Users, Grid3x3, Clock, Settings, Download, Save } from 'lucide-react'
import Logo from '../Logo'
import { useLanguage } from '../../i18n/LanguageContext'
import { NewProjectDialog } from '../NewProjectDialog'

export type WorkspaceTab = 'canvas' | 'script' | 'character' | 'storyboard' | 'timeline'

const tabs: { id: WorkspaceTab; icon: typeof Layers }[] = [
  { id: 'canvas', icon: Layers },
  { id: 'script', icon: FileText },
  { id: 'character', icon: Users },
  { id: 'storyboard', icon: Grid3x3 },
  { id: 'timeline', icon: Clock },
]

export default function WorkspaceTopbar({
  tab, onTabChange, episode, onEpisodeChange, onSaveAssets,
}: {
  tab: WorkspaceTab
  onTabChange: (t: WorkspaceTab) => void
  episode: number
  onEpisodeChange: (n: number) => void
  onSaveAssets?: () => void
}) {
  const { t, lang, toggleLang } = useLanguage()
  const [epOpen, setEpOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  const tabLabel: Record<WorkspaceTab, string> = {
    canvas: t.ws_tab_canvas,
    script: t.ws_tab_script,
    character: t.ws_tab_character,
    storyboard: t.ws_tab_storyboard,
    timeline: t.ws_tab_timeline,
  }

  return (
    <header className="h-14 border-b border-border bg-bg-surface/90 backdrop-blur flex items-center px-4 gap-3 shrink-0">
      <div className="shrink-0"><Logo size="sm" /></div>

      <div className="flex items-center gap-1 text-sm shrink-0">
        <span className="text-text-secondary">{t.ws_new_workspace}</span>
        <span className="text-text-muted">/</span>
        <div className="relative">
          <button onClick={() => { setEpOpen((v) => !v); setMoreOpen(false) }} className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-bg-elevated">
            <span className="font-semibold">{t.ws_episode_prefix}{episode}{t.ws_episode_suffix}</span>
            <ChevronDown size={14} />
          </button>
          {epOpen && (
            <div className="absolute top-full left-0 mt-1 min-w-[140px] bg-bg-surface border border-border rounded-lg shadow-card py-1 z-[100]">
              {[1, 2, 3].map((n) => (
                <button key={n} onClick={() => { onEpisodeChange(n); setEpOpen(false) }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-bg-elevated ${n === episode ? 'text-accent' : ''}`}>
                  {t.ws_episode_prefix}{n}{t.ws_episode_suffix}
                </button>
              ))}
              <div className="border-t border-border my-1" />
              <button className="w-full text-left px-3 py-1.5 text-sm text-text-muted hover:bg-bg-elevated">{t.ws_episode_new}</button>
            </div>
          )}
        </div>

        <div className="relative">
          <button onClick={() => { setMoreOpen((v) => !v); setEpOpen(false) }} className="p-1 rounded-md hover:bg-bg-elevated text-text-muted">
            <MoreHorizontal size={16} />
          </button>
          {moreOpen && (
            <div className="absolute top-full left-0 mt-1 min-w-[180px] bg-bg-surface border border-border rounded-lg shadow-card py-1 z-[100]" onMouseLeave={() => setMoreOpen(false)}>
              <NewProjectDialog
                trigger={
                  <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-elevated inline-flex items-center gap-2">
                    <Settings size={14} /> {t.ws_settings}
                  </button>
                }
              />
              <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-elevated inline-flex items-center gap-2">
                <Download size={14} /> {t.ws_export}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Workflow tabs */}
      <nav className="flex-1 flex items-center justify-center gap-1">
        {tabs.map((tt, i) => {
          const Icon = tt.icon
          const active = tab === tt.id
          return (
            <div key={tt.id} className="flex items-center gap-1">
              <button onClick={() => onTabChange(tt.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition border ${
                  active
                    ? 'bg-accent-dim text-accent border-accent shadow-glow font-semibold'
                    : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                }`}>
                <Icon size={14} /> {tabLabel[tt.id]}
              </button>
              {i < tabs.length - 1 && <span className="text-text-muted/40 text-xs">·····</span>}
            </div>
          )
        })}
      </nav>

      <div className="flex items-center gap-2 shrink-0">
        <button onClick={toggleLang} className="px-2 py-1 text-xs rounded-md border border-border text-text-secondary hover:text-text-primary inline-flex items-center gap-1">
          {lang === 'zh' ? '中文' : 'EN'} <ChevronDown size={12} />
        </button>
        <span className="px-2 py-1 text-xs rounded-full bg-bg-elevated border border-border text-accent font-semibold">✦ 73</span>
        <button className="px-3 py-1 text-xs rounded-full bg-gradient-to-r from-rose-500 to-orange-500 text-white font-semibold">{t.header_upgrade}</button>
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-accent-mint" />
      </div>
    </header>
  )
}
