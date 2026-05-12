import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Lock, Unlock, Upload, Download, Smile, Link2, BookOpen, Users } from 'lucide-react'
import { mockCharacterDetail as c } from '../data/mock'
import { useLanguage } from '../i18n/LanguageContext'

export default function CharacterDetail({ id }: { id: string }) {
  const { lang } = useLanguage()
  const zh = lang === 'zh'
  const [locked, setLocked] = useState(true)

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="text-xs text-text-muted">#{id}</div>
          <h1 className="font-display text-3xl font-bold">{c.name}</h1>
          <p className="text-text-secondary mt-1">{c.archetype}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setLocked(!locked)} className={`btn-ghost text-sm ${locked ? '!text-accent !border-accent/40' : ''}`}>
            {locked ? <Lock size={14} /> : <Unlock size={14} />}
            {locked ? (zh ? '一致性已锁定' : 'Locked') : (zh ? '解锁' : 'Unlock')}
          </button>
          <button className="btn-ghost text-sm"><Download size={14} /> {zh ? '导出资产' : 'Export'}</button>
          <Link to="/characters" className="btn-ghost text-sm">{zh ? '返回' : 'Back'}</Link>
        </div>
      </div>

      {/* Three views */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {c.views.map(v => (
          <article key={v.label} className="card group">
            <div className={`relative aspect-[3/4] bg-gradient-to-br ${v.gradient}`}>
              <div className="absolute top-3 left-3 px-2 py-0.5 rounded-md text-[11px] bg-black/50 text-white font-mono">
                {v.label}
              </div>
              {locked && (
                <div className="absolute top-3 right-3 px-2 py-0.5 rounded-md text-[11px] bg-accent/80 text-white font-mono flex items-center gap-1">
                  <Lock size={10} /> {zh ? '一致性' : 'consistent'}
                </div>
              )}
            </div>
          </article>
        ))}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Character bible */}
        <div className="lg:col-span-2 panel p-5 space-y-3">
          <h2 className="font-semibold flex items-center gap-2"><BookOpen size={16} className="text-accent" /> {zh ? '角色圣经' : 'Character bible'}</h2>
          <BibleField label={zh ? '外貌' : 'Appearance'} value={c.bible.appearance} />
          <BibleField label={zh ? '服装' : 'Outfit'} value={c.bible.outfit} />
          <BibleField label={zh ? '配饰' : 'Accessories'} value={c.bible.accessories} />
          <BibleField label={zh ? '性格' : 'Personality'} value={c.bible.personality} />
        </div>

        {/* Reference upload */}
        <div className="panel p-5">
          <h2 className="font-semibold mb-3">{zh ? '参考图' : 'References'}</h2>
          <div className="border-2 border-dashed border-border rounded-xl p-6 text-center text-text-muted hover:border-accent/40 transition cursor-pointer">
            <Upload size={20} className="mx-auto mb-2" />
            <div className="text-xs">{zh ? '拖拽或点击上传参考图' : 'Drop or click to upload'}</div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            {[1,2,3].map(i => (
              <div key={i} className="aspect-square rounded-lg bg-gradient-to-br from-cyan-500/30 to-fuchsia-500/30 border border-border" />
            ))}
          </div>
        </div>
      </div>

      {/* Expressions */}
      <section className="panel p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-3"><Smile size={16} className="text-accent" /> {zh ? '表情 / 动作库' : 'Expression library'}</h2>
        <div className="flex flex-wrap gap-2">
          {c.expressions.map(e => <span key={e} className="chip">{e}</span>)}
        </div>
      </section>

      {/* Relations */}
      <section className="panel p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-4"><Users size={16} className="text-accent" /> {zh ? '关系图谱' : 'Relationships'}</h2>
        <div className="relative h-56 bg-bg-elevated rounded-xl overflow-hidden">
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 220">
            <line x1="200" y1="110" x2="80"  y2="50"  stroke="var(--color-accent)" strokeWidth="1" />
            <line x1="200" y1="110" x2="320" y2="60"  stroke="var(--color-accent)" strokeWidth="1" />
            <line x1="200" y1="110" x2="200" y2="195" stroke="var(--color-accent)" strokeWidth="1" />
          </svg>
          <Node x="50%" y="50%" main label={c.name} />
          <Node x="20%" y="22%" label={c.relations[0].to} hint={c.relations[0].label} />
          <Node x="80%" y="27%" label={c.relations[1].to} hint={c.relations[1].label} />
          <Node x="50%" y="86%" label={c.relations[2].to} hint={c.relations[2].label} />
        </div>
      </section>

      {/* Linked scenes/props */}
      <section className="panel p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-3"><Link2 size={16} className="text-accent" /> {zh ? '关联场景 / 道具' : 'Linked scenes & props'}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { t: '老剧院', sub: '场景' },
            { t: '银色腕表', sub: '道具' },
            { t: '雨夜天台', sub: '场景' },
            { t: '黑色风衣', sub: '道具' },
          ].map(x => (
            <div key={x.t} className="rounded-xl border border-border bg-bg-elevated p-3">
              <div className="aspect-video bg-gradient-to-br from-zinc-700 to-zinc-900 rounded-lg mb-2" />
              <div className="text-sm font-medium">{x.t}</div>
              <div className="text-[11px] text-text-muted">{x.sub}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function BibleField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-3">
      <div className="text-[11px] text-text-muted uppercase tracking-wider">{label}</div>
      <div className="text-sm text-text-primary mt-1">{value}</div>
    </div>
  )
}

function Node({ x, y, label, hint, main }: { x: string; y: string; label: string; hint?: string; main?: boolean }) {
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
      style={{ left: x, top: y }}
    >
      <div className={`mx-auto rounded-full flex items-center justify-center font-semibold ${
        main ? 'w-16 h-16 bg-accent text-white text-sm shadow-glow' : 'w-12 h-12 bg-bg-surface border border-border text-xs'
      }`}>{label}</div>
      {hint && <div className="text-[10px] text-text-muted mt-1">{hint}</div>}
    </div>
  )
}