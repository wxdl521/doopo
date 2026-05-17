import { useRef, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Sparkles, Grid3x3, GitBranch, Zap, Video, X, Check, Flame, Upload } from 'lucide-react'
import { Dialog, DialogContent, DialogTrigger } from './ui/dialog'
import { useLanguage } from '../i18n/LanguageContext'
import style3dCg from '../assets/styles/3d-cg.jpg'
import styleAnimeJp from '../assets/styles/anime-jp.jpg'
import stylePixar from '../assets/styles/pixar.jpg'
import styleRealistic from '../assets/styles/realistic.jpg'
import styleWuxia from '../assets/styles/wuxia.jpg'
import styleChibi from '../assets/styles/chibi.jpg'
import styleShinkai from '../assets/styles/shinkai.jpg'
import styleHealing from '../assets/styles/healing.jpg'
import styleCyberpunk from '../assets/styles/cyberpunk.jpg'
import styleComic from '../assets/styles/comic.jpg'
import stylePixel from '../assets/styles/pixel.jpg'
import styleClay from '../assets/styles/clay.jpg'

const aspects = [
  { id: '16:9', label: '16:9 · 1k · 720p', cost: 11 },
  { id: '9:16', label: '9:16 · 1k · 720p', cost: 11 },
  { id: '1:1', label: '1:1 · 1k', cost: 9 },
]
const storyboardModels = [
  { id: 'nano-2', label: 'Nano Banana 2', sub: 'Lightweight' },
  { id: 'gpt-image-2', label: 'GPT Image 2', sub: 'Premium' },
  { id: 'gemini-flash', label: 'Gemini Flash Image', sub: 'Fast' },
]
const sceneModels = storyboardModels
const videoModels = [
  { id: 'kling-o3', label: 'Kling O3', sub: '10s ≈ 112 ✦' },
  { id: 'sora-1', label: 'Sora 1.0', sub: '10s ≈ 220 ✦' },
  { id: 'veo-3', label: 'Veo 3', sub: '10s ≈ 180 ✦' },
]

const workflows = [
  { id: 'grid', icon: Grid3x3, key: 'grid' },
  { id: 'seq', icon: GitBranch, key: 'seq' },
  { id: 'concurrent', icon: Zap, key: 'concurrent' },
  { id: 'legacy', icon: Video, key: 'legacy' },
] as const

const styles = [
  { id: '3d-cg', label: '3D CG', hot: true, cover: style3dCg },
  { id: 'anime-jp', label: '动漫-日韩', hot: true, cover: styleAnimeJp },
  { id: 'pixar', label: '3D-皮克斯卡通', cover: stylePixar },
  { id: 'realistic', label: '写实-真人', hot: true, cover: styleRealistic },
  { id: 'wuxia', label: '武侠水墨', hot: true, cover: styleWuxia },
  { id: 'chibi', label: 'Q版萌系', cover: styleChibi },
  { id: 'shinkai', label: '新海诚风', cover: styleShinkai },
  { id: 'healing', label: '治愈手绘', cover: styleHealing },
  { id: 'cyberpunk', label: '赛博朋克', hot: true, cover: styleCyberpunk },
  { id: 'comic', label: '美漫风', cover: styleComic },
  { id: 'pixel', label: '像素艺术', cover: stylePixel },
  { id: 'clay', label: '黏土定格', cover: styleClay },
]

export type ProjectConfig = {
  aspect: string
  storyboardModel: string
  sceneModel: string
  videoModel: string
  audio: 'auto' | 'on' | 'off'
  workflow: string
  style: string
}

export function NewProjectDialog({ trigger }: { trigger: ReactNode }) {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const [aspect, setAspect] = useState('16:9')
  const [customCover, setCustomCover] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [storyboardModel, setStoryboardModel] = useState('nano-2')
  const [sceneModel, setSceneModel] = useState('gpt-image-2')
  const [videoModel, setVideoModel] = useState('kling-o3')
  const [audio, setAudio] = useState<'auto' | 'on' | 'off'>('auto')
  const [workflow, setWorkflow] = useState('grid')
  const [style, setStyle] = useState('3d-cg')

  const estimate = (aspects.find((a) => a.id === aspect)?.cost ?? 11)

  function confirm() {
    const id = `ws-${Date.now().toString(36)}`
    setOpen(false)
    navigate({ to: '/workspace/$workspaceId', params: { workspaceId: id } })
  }

  const wfLabel: Record<string, string> = {
    grid: t.np_workflow_grid, seq: t.np_workflow_seq, concurrent: t.np_workflow_concurrent, legacy: t.np_workflow_legacy,
  }
  const wfDesc: Record<string, string> = {
    grid: t.np_workflow_grid_desc, seq: t.np_workflow_seq_desc, concurrent: t.np_workflow_concurrent_desc, legacy: t.np_workflow_legacy_desc,
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-bg-surface border-border">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <h2 className="font-display text-xl font-bold">{t.np_title}</h2>
          <div className="text-xs text-text-muted">
            {t.np_estimate_prefix} <span className="text-accent font-semibold">✦ {estimate}</span>{t.np_estimate_suffix}
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4 pt-4">
          <FieldSelect label={t.np_aspect} hint={t.np_aspect_hint} value={aspect} onChange={setAspect} options={aspects.map((a) => ({ id: a.id, label: a.label }))} />
          <FieldSelect label={t.np_storyboard_model} hint={t.np_storyboard_model_hint} value={storyboardModel} onChange={setStoryboardModel} options={storyboardModels.map((m) => ({ id: m.id, label: `${m.label}` , sub: m.sub }))} />
          <FieldSelect label={t.np_scene_model} hint={t.np_scene_model_hint} value={sceneModel} onChange={setSceneModel} options={sceneModels.map((m) => ({ id: m.id, label: m.label, sub: m.sub }))} />
        </div>

        <div className="grid md:grid-cols-2 gap-4 pt-3">
          <FieldSelect label={t.np_video_model} value={videoModel} onChange={setVideoModel} options={videoModels.map((m) => ({ id: m.id, label: m.label, sub: m.sub }))} />
          <div>
            <div className="text-sm font-semibold mb-1">{t.np_audio}</div>
            <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2 flex items-center justify-between">
              <span className="text-sm">{audio === 'auto' ? t.np_audio_auto : audio === 'on' ? t.np_audio_on : t.np_audio_off}</span>
              <div className="flex gap-1">
                {(['auto', 'on', 'off'] as const).map((m) => (
                  <button key={m} onClick={() => setAudio(m)}
                    className={`px-2 py-0.5 text-xs rounded-full border ${audio === m ? 'bg-accent text-accent-foreground border-accent' : 'border-border text-text-muted hover:text-text-primary'}`}>
                    {m === 'auto' ? t.np_audio_auto : m === 'on' ? t.np_audio_on : t.np_audio_off}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4">
          <div className="text-sm font-semibold mb-2">{t.np_workflow}</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {workflows.map((w) => {
              const Icon = w.icon
              const active = workflow === w.id
              return (
                <button key={w.id} onClick={() => setWorkflow(w.id)}
                  className={`text-left rounded-xl border p-3 flex gap-3 transition ${active ? 'border-accent bg-accent-dim/30 shadow-glow' : 'border-border bg-bg-elevated hover:border-border-glow'}`}>
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${active ? 'bg-accent text-accent-foreground' : 'bg-bg-surface text-text-muted'}`}>
                    <Icon size={18} />
                  </div>
                  <div>
                    <div className={`font-semibold text-sm ${active ? 'text-accent' : ''}`}>{wfLabel[w.id]}</div>
                    <div className="text-xs text-text-muted leading-snug mt-0.5">{wfDesc[w.id]}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="pt-4">
          <div className="text-sm font-semibold mb-2">{t.np_style}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {styles.map((s) => {
              const active = style === s.id
              return (
                <button key={s.id} onClick={() => setStyle(s.id)}
                  className={`relative rounded-xl overflow-hidden border-2 text-left bg-bg-elevated transition group ${active ? 'border-accent shadow-glow' : 'border-transparent hover:border-border'}`}>
                  <div className="aspect-square overflow-hidden">
                    <img src={s.cover} alt={s.label} loading="lazy" width={512} height={512}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                  </div>
                  {s.hot && (
                    <span className="absolute top-1.5 right-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-rose-500/90 text-white text-[10px]">
                      <Flame size={10} /> {t.np_style_hot}
                    </span>
                  )}
                  <div className={`px-2 py-1.5 text-xs ${active ? 'text-accent font-semibold' : 'text-text-secondary'}`}>{s.label}</div>
                  {active && <Check className="absolute top-1.5 left-1.5 text-accent bg-bg-surface rounded-full p-0.5" size={18} />}
                </button>
              )
            })}
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`relative rounded-xl overflow-hidden border-2 text-left bg-bg-elevated transition ${style === 'custom' ? 'border-accent shadow-glow' : 'border-dashed border-border hover:border-accent/60'}`}>
              <div className="aspect-square flex items-center justify-center bg-gradient-to-br from-bg-elevated to-bg-surface">
                {customCover ? (
                  <img src={customCover} alt="custom" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-1.5 text-text-muted">
                    <div className="w-10 h-10 rounded-full bg-bg-surface border border-border flex items-center justify-center">
                      <Upload size={16} />
                    </div>
                    <span className="text-[11px]">{t.np_style_upload}</span>
                  </div>
                )}
              </div>
              <div className={`px-2 py-1.5 text-xs ${style === 'custom' ? 'text-accent font-semibold' : 'text-text-secondary'}`}>
                {t.np_style_custom}
              </div>
              {style === 'custom' && <Check className="absolute top-1.5 left-1.5 text-accent bg-bg-surface rounded-full p-0.5" size={18} />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                const url = URL.createObjectURL(f)
                setCustomCover(url)
                setStyle('custom')
              }} />
          </div>
        </div>

        <div className="flex justify-center pt-5">
          <button onClick={confirm} className="px-10 py-2.5 rounded-full bg-accent text-accent-foreground font-semibold hover:opacity-90 inline-flex items-center gap-2">
            <Check size={16} /> {t.np_confirm}
          </button>
          <button onClick={() => setOpen(false)} className="ml-2 px-4 py-2.5 rounded-full text-text-muted hover:text-text-primary inline-flex items-center gap-1">
            <X size={14} /> {t.np_cancel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FieldSelect({
  label, hint, value, onChange, options,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  options: { id: string; label: string; sub?: string }[]
}) {
  return (
    <div>
      <div className="text-sm font-semibold">{label}</div>
      {hint && <div className="text-[11px] text-text-muted mb-1">{hint}</div>}
      <div className="relative">
        <select value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent">
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.label}{o.sub ? ` — ${o.sub}` : ''}</option>
          ))}
        </select>
        <Sparkles size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
      </div>
    </div>
  )
}
