import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Download, FileText, Code2, FileType2, GitBranch, Send, MessageSquare, Layers } from 'lucide-react'
import { scriptVersions } from '../data/mock'
import { useLanguage } from '../i18n/LanguageContext'

export default function ScriptDetail({ id }: { id: string }) {
  const { lang } = useLanguage()
  const zh = lang === 'zh'
  const [left, setLeft] = useState(scriptVersions[1].id)
  const [right, setRight] = useState(scriptVersions[0].id)

  const Lv = scriptVersions.find(v => v.id === left)!
  const Rv = scriptVersions.find(v => v.id === right)!

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="text-xs text-text-muted">#{id}</div>
          <h1 className="font-display text-3xl font-bold">{zh ? '《晨星》第 3 集' : 'Morning Star · Ep 3'}</h1>
          <p className="text-text-secondary mt-1">{zh ? '都市悬疑 · 短剧 · 12 集 · 共 3 个版本' : 'Urban thriller · Short · 12 ep · 3 versions'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost text-sm"><Download size={14} /> PDF</button>
          <button className="btn-ghost text-sm"><FileType2 size={14} /> Fountain</button>
          <button className="btn-ghost text-sm"><Code2 size={14} /> JSON</button>
          <Link to="/scripts" className="btn-ghost text-sm">{zh ? '返回' : 'Back'}</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: structure */}
        <aside className="lg:col-span-3 space-y-3">
          <div className="panel p-4">
            <h3 className="font-semibold text-sm flex items-center gap-2 mb-3"><Layers size={14} className="text-accent" /> {zh ? '幕 / 场景结构' : 'Acts / Scenes'}</h3>
            <ol className="space-y-2 text-sm">
              {[
                { act: '第一幕', scenes: ['1. 天台告别', '2. 老剧院重逢'] },
                { act: '第二幕', scenes: ['3. 雨夜对峙', '4. 真相浮现', '5. 江月的选择'] },
                { act: '第三幕', scenes: ['6. 终幕'] },
              ].map(a => (
                <li key={a.act}>
                  <div className="text-xs text-text-muted uppercase tracking-wider">{a.act}</div>
                  <ul className="ml-1 mt-1 space-y-1">
                    {a.scenes.map(s => (
                      <li key={s} className="text-text-secondary hover:text-accent cursor-pointer">{s}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
          <div className="panel p-4">
            <h3 className="font-semibold text-sm flex items-center gap-2 mb-3"><GitBranch size={14} className="text-accent" /> {zh ? '版本时间线' : 'Versions'}</h3>
            <ul className="space-y-2">
              {scriptVersions.map(v => (
                <li key={v.id} className="text-sm">
                  <div className="font-medium">{v.label}</div>
                  <div className="text-[11px] text-text-muted">{v.author} · {v.createdAt}</div>
                  <div className="text-xs text-text-secondary mt-1">{v.summary}</div>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Center: diff */}
        <section className="lg:col-span-6 space-y-3">
          <div className="panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="font-semibold">{zh ? '版本对比' : 'Compare versions'}</h3>
              <div className="flex items-center gap-2 text-xs">
                <select value={left} onChange={e => setLeft(e.target.value)} className="rounded-lg bg-bg-elevated border border-border px-2 py-1">
                  {scriptVersions.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
                <span className="text-text-muted">↔</span>
                <select value={right} onChange={e => setRight(e.target.value)} className="rounded-lg bg-bg-elevated border border-border px-2 py-1">
                  {scriptVersions.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <DiffPane title={Lv.label} content={Lv.content} side="left" />
              <DiffPane title={Rv.label} content={Rv.content} side="right" />
            </div>
          </div>
        </section>

        {/* Right: chat iteration */}
        <aside className="lg:col-span-3">
          <div className="panel p-4 flex flex-col h-[520px]">
            <h3 className="font-semibold text-sm flex items-center gap-2 mb-3"><MessageSquare size={14} className="text-accent" /> {zh ? '多轮迭代' : 'Iterate'}</h3>
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              <Bubble who="ai">{zh ? '已生成 v3，强化了第二幕反转。需要继续打磨哪一段？' : 'v3 generated. Anywhere you want to refine?'}</Bubble>
              <Bubble who="me">{zh ? '把江月的台词更克制一点。' : 'Make Jiang Yue\'s lines more restrained.'}</Bubble>
              <Bubble who="ai">{zh ? '收到。已重写 3 句台词，请查看左侧对比。' : 'Done. Rewrote 3 lines — see compare panel.'}</Bubble>
            </div>
            <div className="mt-3 flex gap-2">
              <input className="flex-1 rounded-lg bg-bg-elevated border border-border text-sm px-3 py-2" placeholder={zh ? '继续优化…' : 'Refine…'} />
              <button className="btn-primary"><Send size={14} /></button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function DiffPane({ title, content, side }: { title: string; content: string; side: 'left' | 'right' }) {
  return (
    <div className="rounded-lg border border-border bg-bg-elevated overflow-hidden">
      <div className={`px-3 py-1.5 text-xs font-semibold border-b border-border ${side === 'left' ? 'text-rose-400' : 'text-emerald-400'}`}>
        {title}
      </div>
      <pre className="whitespace-pre-wrap text-[11px] leading-relaxed font-mono p-3 max-h-[420px] overflow-y-auto text-text-secondary">
        {content}
      </pre>
    </div>
  )
}

function Bubble({ who, children }: { who: 'ai' | 'me'; children: React.ReactNode }) {
  return (
    <div className={`flex ${who === 'me' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
        who === 'me' ? 'bg-accent text-white' : 'bg-bg-elevated text-text-secondary'
      }`}>{children}</div>
    </div>
  )
}