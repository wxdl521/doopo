import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Sparkles, Wand2, Upload, Lightbulb, Palette, ArrowRight, Clock, Layers } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'

const TEMPLATES = [
  { id: '30s', label: '30s · 闪剧', dur: 0.5, eps: 1 },
  { id: '1m',  label: '1min · 微短剧', dur: 1, eps: 6 },
  { id: '3m',  label: '3min · 短剧', dur: 3, eps: 12 },
  { id: '5m',  label: '5min · 中长剧', dur: 5, eps: 20 },
]

const MODES = [
  { id: 'scratch', icon: Wand2,      title: '从零创作', desc: '基于类型、时长与主题自动生成完整剧本' },
  { id: 'expand',  icon: Lightbulb,  title: '灵感扩写', desc: '一句话创意 → 完整故事线' },
  { id: 'style',   icon: Palette,    title: '风格迁移', desc: '模仿特定导演 / IP 的叙事语调' },
] as const

const SAMPLE = `场景 1  内 - 城市天台 - 黄昏

  江月独自站在栏杆边，城市灯火渐亮。

江月（轻声）
  这一次，我不会再回头了。

  风吹起她的发丝，远处汽笛长鸣。

林宴（画外）
  你确定吗？

  江月没有转身，握紧了手中的车票。`

export default function ScriptNew() {
  const { lang } = useLanguage()
  const zh = lang === 'zh'
  const [mode, setMode] = useState<typeof MODES[number]['id']>('scratch')
  const [tpl, setTpl] = useState('1m')
  const [duration, setDuration] = useState(1)
  const [episodes, setEpisodes] = useState(6)
  const [dialogue, setDialogue] = useState(40)
  const [conflict, setConflict] = useState(50)
  const [idea, setIdea] = useState('')

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl md:text-4xl font-bold">{zh ? '智能剧本生成' : 'Smart Script Generation'}</h1>
          <p className="text-text-secondary mt-1 max-w-2xl">{zh ? '从一句话创意到工业标准剧本，配置参数后一键生成。' : 'From a one-line idea to an industry-format script, in one click.'}</p>
        </div>
        <Link to="/scripts" className="btn-ghost text-sm self-start md:self-auto">{zh ? '返回剧本库' : 'Back to library'}</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Left: configuration */}
        <div className="lg:col-span-3 space-y-5">
          {/* Mode tabs */}
          <div className="panel p-5">
            <h3 className="font-semibold mb-3">{zh ? '创作模式' : 'Creation mode'}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {MODES.map(m => {
                const Icon = m.icon
                const active = mode === m.id
                return (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    className={`text-left rounded-xl border p-4 transition ${active
                      ? 'border-accent bg-accent-dim'
                      : 'border-border hover:border-accent/40 bg-bg-elevated'}`}
                  >
                    <Icon size={18} className={active ? 'text-accent' : 'text-text-muted'} />
                    <div className="font-semibold mt-2 text-sm">{m.title}</div>
                    <div className="text-xs text-text-muted mt-1 leading-relaxed">{m.desc}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Idea input */}
          <div className="panel p-5 space-y-3">
            <h3 className="font-semibold">{zh ? '创意输入' : 'Idea input'}</h3>
            <textarea
              value={idea}
              onChange={e => setIdea(e.target.value)}
              rows={4}
              placeholder={zh ? '例如：一位失忆的歌手在城市天台遇见自己十年前的影子…' : 'e.g. A singer with amnesia meets her 10-year-younger self on a rooftop…'}
              className="w-full rounded-lg bg-bg-elevated border border-border text-sm p-3 resize-none focus:outline-none focus:border-accent/50 placeholder:text-text-muted"
            />
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost text-xs"><Upload size={13} /> {zh ? '上传文本素材' : 'Upload text'}</button>
              <button className="btn-ghost text-xs"><Sparkles size={13} /> {zh ? '随机灵感' : 'Random spark'}</button>
            </div>
          </div>

          {/* Quick templates */}
          <div className="panel p-5">
            <h3 className="font-semibold mb-3">{zh ? '快速模板' : 'Quick template'}</h3>
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => { setTpl(t.id); setDuration(t.dur); setEpisodes(t.eps) }}
                  className={`chip ${tpl === t.id ? 'chip-active' : ''}`}
                >
                  <Clock size={12} /> {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Advanced */}
          <div className="panel p-5 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Layers size={15} className="text-accent" />
              {zh ? '高级参数' : 'Advanced parameters'}
            </h3>
            <Slider label={zh ? '单集时长 (分钟)' : 'Episode duration (min)'} value={duration} min={0.5} max={10} step={0.5} onChange={setDuration} />
            <Slider label={zh ? '目标集数' : 'Episodes'} value={episodes} min={1} max={30} step={1} onChange={setEpisodes} />
            <Slider label={zh ? '对话密度' : 'Dialogue density'} value={dialogue} min={10} max={70} step={5} onChange={setDialogue} suffix="%" />
            <Slider label={zh ? '冲突点密度' : 'Conflict density'} value={conflict} min={10} max={90} step={5} onChange={setConflict} suffix="%" />
          </div>
        </div>

        {/* Right: preview */}
        <div className="lg:col-span-2 space-y-3">
          <div className="panel p-5 sticky top-20">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">{zh ? '预览（示例）' : 'Preview (sample)'}</h3>
              <span className="text-xs text-text-muted">{duration} min · {episodes} ep</span>
            </div>
            <pre className="whitespace-pre-wrap text-xs text-text-secondary leading-relaxed font-mono bg-bg-elevated rounded-lg p-3 max-h-[420px] overflow-y-auto">
              {SAMPLE}
            </pre>
            <button className="btn-primary w-full justify-center mt-4">
              <Sparkles size={14} /> {zh ? '生成完整剧本' : 'Generate full script'}
              <ArrowRight size={14} />
            </button>
            <p className="text-[11px] text-text-muted mt-2 text-center">{zh ? '前端示例 · 实际生成将走 AI 后端' : 'Front-end demo · production routes to AI backend'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Slider({ label, value, min, max, step, onChange, suffix }: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; suffix?: string
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <label className="text-xs text-text-secondary">{label}</label>
        <span className="text-xs font-mono text-accent">{value}{suffix ?? ''}</span>
      </div>
      <input
        type="range"
        value={value} min={min} max={max} step={step}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-[--color-accent]"
      />
    </div>
  )
}