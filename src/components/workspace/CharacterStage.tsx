import { useState, type ReactNode, type KeyboardEvent } from 'react'
import type { GenCharacter } from '../../data/workspaceGenerators'
import CharacterPortrait from './CharacterPortrait'

export type CharacterStageView = {
  key: 'front' | 'side' | 'back' | 'expression'
  label: string
}

type Mode = 'main' | 'multi'

type Props = {
  character: GenCharacter
  views: CharacterStageView[]
  onZoom?: () => void
}

export default function CharacterStage({ character, views }: Props) {
  const [mode, setMode] = useState<Mode>('main')
  const tabs: { value: Mode; label: string; aria: string }[] = [
    { value: 'main', label: '主视图', aria: `切换到 ${character.name} 主视图（正面全身）` },
    { value: 'multi', label: '多视图', aria: `切换到 ${character.name} 多视图（正面 / 侧面 / 背面 / 表情）` },
  ]

  const onTabsKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const idx = tabs.findIndex((t) => t.value === mode)
    let next = idx
    if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length
    else if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    const target = tabs[next]
    // Move focus first so it stays in sync even if React batches the state update.
    const btn = e.currentTarget.querySelector<HTMLButtonElement>(
      `[data-view-tab="${target.value}"]`,
    )
    btn?.focus()
    setMode(target.value)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col items-center">
      <div
        className="rounded-2xl border border-border bg-gradient-to-b from-bg-elevated/30 to-bg-surface/60 overflow-hidden relative shrink-0"
        role="region"
        aria-live="polite"
        aria-label={`${character.name} ${mode === 'main' ? '主视图' : '多视图'}`}
        style={{ width: 372, height: 498 }}
      >
        {mode === 'main' ? (
          <div className="relative w-full h-full">
            <CharacterPortrait character={character} view="front" className="w-full h-full block" />
          </div>
        ) : (
          <div className="grid grid-cols-2 grid-rows-2 gap-2 p-2 w-full h-full">
            {views.map((v) => (
              <div
                key={v.key}
                className="relative rounded-xl overflow-hidden border border-border bg-bg-elevated/30"
              >
                <CharacterPortrait character={character} view={v.key} className="w-full h-full block" />
                <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 text-[10px] leading-none rounded-md bg-black/55 text-white/95 backdrop-blur-sm border border-white/10 max-w-[calc(100%-12px)] truncate">
                  {v.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        className="mt-3 flex items-end shrink-0 w-full"
        role="tablist"
        aria-label="角色视图切换"
        onKeyDown={onTabsKeyDown}
        style={{ maxWidth: 372, gap: 'clamp(8px, 1.6vw, 14px)' }}
      >
        <ViewThumb
          active={mode === 'main'}
          onClick={() => setMode('main')}
          label="主视图"
          value="main"
          ariaLabel={tabs[0].aria}
        >
          <CharacterPortrait character={character} view="front" className="w-full h-full block" />
        </ViewThumb>
        <ViewThumb
          active={mode === 'multi'}
          onClick={() => setMode('multi')}
          label="多视图"
          value="multi"
          ariaLabel={tabs[1].aria}
        >
          <div className="grid grid-cols-2 grid-rows-2 w-full h-full gap-px bg-border" aria-hidden="true">
            {views.map((v) => (
              <div key={v.key} className="relative overflow-hidden">
                <CharacterPortrait character={character} view={v.key} className="w-full h-full block" />
              </div>
            ))}
          </div>
        </ViewThumb>
        <div
          className="ml-auto text-text-muted text-right hidden sm:block"
          aria-hidden="true"
          style={{
            fontSize: 'clamp(10px, 1.1vw, 12px)',
            lineHeight: 'clamp(12px, 1.4vw, 16px)',
          }}
        >
          点击缩略图 / 方向键<br />切换视图
        </div>
      </div>
      <p className="sr-only">使用左右方向键在主视图与多视图之间切换，回车或空格键确认。</p>
    </div>
  )
}

function ViewThumb({
  active,
  onClick,
  label,
  value,
  ariaLabel,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  value: Mode
  ariaLabel: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      style={{ gap: 'clamp(4px, 0.6vw, 8px)' }}
      role="tab"
      aria-selected={active}
      aria-label={ariaLabel}
      tabIndex={active ? 0 : -1}
      data-view-tab={value}
    >
      <span
        className={`relative block rounded-lg overflow-hidden border-2 transition-all ${
          active
            ? 'border-accent shadow-[0_0_0_3px_rgba(251,191,36,0.15)]'
            : 'border-border group-hover:border-text-muted'
        }`}
        style={{ width: 'clamp(64px, 7vw, 88px)', height: 'clamp(76px, 8.4vw, 104px)' }}
        aria-hidden="true"
      >
        {children}
      </span>
      <span
        className={`font-medium whitespace-nowrap transition-colors ${
          active ? 'text-accent' : 'text-text-muted group-hover:text-text-secondary'
        }`}
        style={{
          fontSize: 'clamp(10px, 1.05vw, 12px)',
          lineHeight: 'clamp(12px, 1.3vw, 15px)',
          letterSpacing: '0.02em',
        }}
        aria-hidden="true"
      >
        {label}
      </span>
    </button>
  )
}