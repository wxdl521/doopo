import { createFileRoute } from '@tanstack/react-router'
import PageHeader from '../components/PageHeader'
import { mockCharacters, mockCharacterRelations } from '../data/mock'
import { useLanguage } from '../i18n/LanguageContext'

export const Route = createFileRoute('/characters/relations')({
  head: () => ({ meta: [{ title: 'Character Relations — Doopoo' }] }),
  component: Relations,
})

function Relations() {
  const { t } = useLanguage()
  const radius = 160
  const cx = 240
  const cy = 200
  const positions = mockCharacters.map((c, i) => {
    const angle = (i / mockCharacters.length) * Math.PI * 2 - Math.PI / 2
    return { id: c.id, name: c.name, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius }
  })
  const find = (id: string) => positions.find((p) => p.id === id)!
  return (
    <div className="animate-fade-in">
      <PageHeader title={t.chd_relations_title} subtitle={t.chd_relations_sub} />
      <section className="panel p-6 overflow-x-auto">
        <svg viewBox="0 0 480 400" className="w-full max-w-2xl mx-auto" style={{ minWidth: 480 }}>
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
              <path d="M0,0 L0,6 L9,3 z" fill="currentColor" className="text-accent" />
            </marker>
          </defs>
          {mockCharacterRelations.map((r, i) => {
            const a = find(r.from)
            const b = find(r.to)
            const mx = (a.x + b.x) / 2
            const my = (a.y + b.y) / 2
            return (
              <g key={i}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" className="text-accent/60" strokeWidth={1.5} markerEnd="url(#arrow)" />
                <text x={mx} y={my - 6} className="fill-text-muted" fontSize="10" textAnchor="middle">{r.label}</text>
              </g>
            )
          })}
          {positions.map((p) => (
            <g key={p.id}>
              <circle cx={p.x} cy={p.y} r={36} fill="currentColor" className="text-bg-elevated" stroke="currentColor" strokeWidth={2} />
              <text x={p.x} y={p.y + 4} fontSize="11" textAnchor="middle" className="fill-text-primary font-semibold">{p.name}</text>
            </g>
          ))}
        </svg>
      </section>
    </div>
  )
}
