import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { ArrowLeft, Copy, Download, Sparkles, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useServerFn } from '@tanstack/react-start'
import { useLanguage } from '../i18n/LanguageContext'
import {
  type AssetTab,
  type CharacterAsset,
  type SceneAsset,
  type PropAsset,
  getAssetById,
} from '../data/assetsMock'
import { assetToMarkdown, downloadMarkdown } from '../lib/assetMarkdown'
import { generateImage } from '../lib/seedream.functions'
import { IMAGE_MODELS } from '../lib/imageModels'

export const Route = createFileRoute('/assets_/$tab/$id')({
  component: AssetDetailPage,
})

function AssetDetailPage() {
  const { tab, id } = Route.useParams()
  const navigate = useNavigate()
  const { t } = useLanguage()

  const asset = useMemo(() => getAssetById(tab as AssetTab, id), [tab, id])

  if (!asset) {
    return (
      <div className="animate-fade-in flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-text-muted">{t.asset_not_found}</p>
        <Link to="/assets" className="btn-ghost text-xs">
          <ArrowLeft size={14} /> {t.assets_back}
        </Link>
      </div>
    )
  }

  const labels = {
    role: t.assets_field_role, age: t.assets_field_age, personality: t.assets_field_personality,
    style: t.assets_field_style, costume: t.assets_field_costume,
    appearance: t.assets_field_appearance_desc, background: t.assets_field_background,
    palette: t.assets_field_palette, tags: t.assets_field_tags, summary: t.assets_field_summary,
    time: t.assets_field_time, mood: t.assets_field_mood, shot: t.assets_field_shot,
    lighting: t.assets_field_lighting, sound: t.assets_field_sound, reference: t.assets_field_reference,
    owner: t.assets_field_owner, symbol: t.assets_field_symbol,
    material: t.assets_field_material, firstAppear: t.assets_field_first_appear,
    lastAppear: t.assets_field_last_appear, detail: t.assets_field_detail,
  }

  const md = assetToMarkdown(tab as AssetTab, asset, labels)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(md)
      toast.success(t.assets_copied)
    } catch {
      toast.error(t.common_error)
    }
  }

  const handleExport = () => {
    downloadMarkdown(asset.name, md)
  }

  const tabLabel =
    tab === 'character' ? t.assets_tab_character
    : tab === 'scene' ? t.assets_tab_scene
    : t.assets_tab_prop

  return (
    <div className="animate-fade-in flex flex-col gap-6">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate({ to: '/assets' })}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition"
          >
            <ArrowLeft size={14} /> {t.assets_back}
          </button>
          <span className="text-text-muted text-xs">/</span>
          <span className="text-xs text-text-secondary">{t.assets_title}</span>
          <span className="text-text-muted text-xs">/</span>
          <span className="text-xs text-text-secondary">{tabLabel}</span>
          <span className="text-text-muted text-xs">/</span>
          <span className="text-xs text-text-primary font-medium">{asset.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleCopy} className="btn-ghost text-xs">
            <Copy size={14} /> {t.assets_copy_md}
          </button>
          <button onClick={handleExport} className="btn-primary text-xs">
            <Download size={14} /> {t.assets_export_md}
          </button>
        </div>
      </header>

      {tab === 'character' && <CharacterDetail c={asset as CharacterAsset} />}
      {tab === 'scene' && <SceneDetail s={asset as SceneAsset} />}
      {tab === 'prop' && <PropDetail p={asset as PropAsset} />}
    </div>
  )
}

/* ---------------- Character ---------------- */
function CharacterDetail({ c }: { c: CharacterAsset }) {
  const { t } = useLanguage()
  const views = [
    { key: 'master', label: t.assets_view_master, src: c.cover },
    { key: 'front', label: t.assets_view_front, src: c.views.front },
    { key: 'side', label: t.assets_view_side, src: c.views.side },
    { key: 'back', label: t.assets_view_back, src: c.views.back },
    { key: 'expression', label: t.assets_view_expression, src: c.views.expression },
  ]
  const [active, setActive] = useState(views[0])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left: hero image + thumbs */}
      <section className="lg:col-span-7 flex flex-col gap-3">
        <div className={`panel overflow-hidden bg-gradient-to-br ${c.gradient} aspect-[4/5] flex items-center justify-center`}>
          <img
            key={active.key}
            src={active.src}
            alt={`${c.name} - ${active.label}`}
            loading="lazy"
            className="w-full h-full object-contain animate-fade-in"
          />
        </div>
        <div className="grid grid-cols-5 gap-2">
          {views.map(v => (
            <button
              key={v.key}
              onClick={() => setActive(v)}
              className={`relative panel overflow-hidden aspect-square flex flex-col items-center justify-center transition ${
                active.key === v.key ? 'ring-2 ring-accent border-accent/50' : 'hover:border-accent/40'
              }`}
            >
              <img src={v.src} alt={v.label} loading="lazy" className="w-full h-full object-cover" />
              <span className="absolute bottom-1 left-1 right-1 text-[10px] text-white bg-black/40 rounded px-1 text-center">
                {v.label}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Right: meta */}
      <section className="lg:col-span-5 flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-bold text-text-primary tracking-tight">{c.name}</h1>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {c.tags.map(tag => (
              <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-bg-elevated border border-border text-text-secondary">
                {tag}
              </span>
            ))}
          </div>
          <p className="text-sm text-text-secondary mt-3 leading-relaxed">{c.summary}</p>
        </div>

        <div className="panel p-4 flex flex-col gap-2">
          <Row label={t.assets_field_role} value={c.role} />
          <Row label={t.assets_field_age} value={c.age} />
          <Row label={t.assets_field_personality} value={c.personality} />
          <Row label={t.assets_field_style} value={c.style} />
          <Row label={t.assets_field_costume} value={c.costume} />
        </div>

        <Block title={t.assets_field_appearance_desc} body={c.appearance} />
        <Block title={t.assets_field_background} body={c.background} />

        <div className="panel p-4">
          <div className="text-xs text-text-muted mb-2">{t.assets_field_palette}</div>
          <div className="flex flex-wrap gap-2">
            {c.palette.map(hex => (
              <div key={hex} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-elevated border border-border">
                <span className="w-4 h-4 rounded" style={{ backgroundColor: hex }} />
                <span className="text-[11px] text-text-secondary font-mono">{hex}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

/* ---------------- Scene ---------------- */
function SceneDetail({ s }: { s: SceneAsset }) {
  const { t } = useLanguage()
  const prompt = [
    `Cinematic scene illustration: ${s.name}.`,
    s.summary,
    s.time && `Time: ${s.time}.`,
    s.mood && `Mood: ${s.mood}.`,
    s.shot && `Shot: ${s.shot}.`,
    s.lighting && `Lighting: ${s.lighting}.`,
    s.tags?.length ? `Tags: ${s.tags.join(', ')}.` : '',
    'High detail, atmospheric, no text, no watermark.',
  ].filter(Boolean).join(' ')
  return (
    <div className="flex flex-col gap-6">
      <ImageStage
        prompt={prompt}
        fallback={<span className="text-8xl drop-shadow-lg">{s.emoji}</span>}
        gradient={s.gradient}
        heightClass="h-64 md:h-80"
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-bold text-text-primary tracking-tight">{s.name}</h1>
          <div className="flex flex-wrap gap-1.5">
            {s.tags.map(tag => (
              <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-bg-elevated border border-border text-text-secondary">
                {tag}
              </span>
            ))}
          </div>
          <p className="text-sm text-text-secondary leading-relaxed">{s.summary}</p>
        </div>
        <div className="panel p-4 flex flex-col gap-2">
          <Row label={t.assets_field_time} value={s.time} />
          <Row label={t.assets_field_mood} value={s.mood} />
          <Row label={t.assets_field_shot} value={s.shot} />
          <Row label={t.assets_field_lighting} value={s.lighting} />
          <Row label={t.assets_field_sound} value={s.sound} />
          <Row label={t.assets_field_reference} value={s.reference} />
        </div>
      </div>
    </div>
  )
}

/* ---------------- Prop ---------------- */
function PropDetail({ p }: { p: PropAsset }) {
  const { t } = useLanguage()
  const prompt = [
    `Product-style illustration of a prop: ${p.name}.`,
    p.summary,
    p.detail,
    p.material && `Material: ${p.material}.`,
    p.appearance && `Appearance: ${p.appearance}.`,
    p.tags?.length ? `Tags: ${p.tags.join(', ')}.` : '',
    'Centered composition, soft studio lighting, no text, no watermark.',
  ].filter(Boolean).join(' ')
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-5">
        <ImageStage
          prompt={prompt}
          fallback={<span className="text-9xl drop-shadow-lg">{p.emoji}</span>}
          gradient={p.gradient}
          heightClass="aspect-square"
        />
      </div>
      <section className="lg:col-span-7 flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-bold text-text-primary tracking-tight">{p.name}</h1>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {p.tags.map(tag => (
              <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-bg-elevated border border-border text-text-secondary">
                {tag}
              </span>
            ))}
          </div>
          <p className="text-sm text-text-secondary mt-3 leading-relaxed">{p.summary}</p>
        </div>
        <div className="panel p-4 flex flex-col gap-2">
          <Row label={t.assets_field_owner} value={p.owner} />
          <Row label={t.assets_field_appearance} value={p.appearance} />
          <Row label={t.assets_field_first_appear} value={p.firstAppear} />
          <Row label={t.assets_field_last_appear} value={p.lastAppear} />
          <Row label={t.assets_field_material} value={p.material} />
          <Row label={t.assets_field_symbol} value={p.symbol} />
        </div>
        <Block title={t.assets_field_detail} body={p.detail} />
      </section>
    </div>
  )
}

/* ---------------- Shared ---------------- */
function ImageStage({
  prompt,
  fallback,
  gradient,
  heightClass,
}: {
  prompt: string
  fallback: React.ReactNode
  gradient: string
  heightClass: string
}) {
  const callGenerateImage = useServerFn(generateImage)
  const [model, setModel] = useState<string>('')
  const [url, setUrl] = useState<string>('')
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (loading) return
    setLoading(true)
    try {
      const r = await callGenerateImage({ data: { prompt, model: model || undefined } })
      if (r?.url) {
        setUrl(r.url)
      } else {
        toast.error(r?.error || 'Image generation failed')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Image generation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className={`panel overflow-hidden bg-gradient-to-br ${gradient} ${heightClass} flex items-center justify-center relative`}>
        {url ? (
          <img src={url} alt="" className="w-full h-full object-cover animate-fade-in" />
        ) : (
          fallback
        )}
        {loading && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <Loader2 className="animate-spin text-white" size={28} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={loading}
          className="text-xs px-2 py-1.5 rounded-md bg-bg-elevated border border-border text-text-secondary focus:outline-none focus:border-accent"
        >
          {IMAGE_MODELS.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
        <button onClick={handleGenerate} disabled={loading} className="btn-primary text-xs">
          {loading ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
          {url ? 'Regenerate' : 'Generate image'}
        </button>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="text-text-muted shrink-0 w-20">{label}</span>
      <span className="text-text-secondary">{value}</span>
    </div>
  )
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel p-4">
      <div className="text-xs text-text-muted mb-2">{title}</div>
      <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">{body}</p>
    </div>
  )
}
