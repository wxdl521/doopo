import { Link } from '@tanstack/react-router'
import { Heart, Eye, FileText, User, MapPin, Package, Film } from 'lucide-react'
import type { PostKind } from '@/lib/community.functions'

const KIND_META: Record<PostKind, { label: string; icon: typeof FileText; gradient: string }> = {
  script: { label: '剧本', icon: FileText, gradient: 'from-indigo-600 via-violet-700 to-slate-950' },
  character: { label: '角色', icon: User, gradient: 'from-rose-500 via-pink-700 to-zinc-950' },
  scene: { label: '场景', icon: MapPin, gradient: 'from-cyan-500 via-teal-700 to-slate-950' },
  prop: { label: '道具', icon: Package, gradient: 'from-amber-500 via-orange-700 to-zinc-950' },
  comic: { label: '漫剧', icon: Film, gradient: 'from-fuchsia-500 via-purple-700 to-indigo-950' },
}

export type CommunityCardItem = {
  id: string
  kind: PostKind
  title: string
  summary: string | null
  cover_gradient: string | null
  likes_count: number
  views_count: number
}

export default function CommunityCard({ item }: { item: CommunityCardItem }) {
  const meta = KIND_META[item.kind]
  const Icon = meta.icon
  const gradient = item.cover_gradient || `bg-gradient-to-br ${meta.gradient}`
  const isClass = gradient.startsWith('bg-')
  return (
    <Link to="/community/$postId" params={{ postId: item.id }}
          className="card group cursor-pointer block">
      <div className={`relative aspect-[16/10] overflow-hidden ${isClass ? gradient : ''}`}
           style={isClass ? undefined : { background: gradient }}>
        <div className="absolute inset-0 opacity-30 mix-blend-overlay"
             style={{
               backgroundImage:
                 'linear-gradient(0deg, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
               backgroundSize: '24px 24px',
             }} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute inset-0 flex flex-col justify-between p-4">
          <span className="self-start inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-black/50 text-white backdrop-blur">
            <Icon size={10} /> {meta.label}
          </span>
          <div>
            <h3 className="font-display text-lg md:text-xl font-bold text-white drop-shadow line-clamp-2">
              {item.title}
            </h3>
            {item.summary && (
              <p className="text-xs text-white/80 mt-1 line-clamp-2">{item.summary}</p>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between px-4 py-3 text-xs text-text-muted">
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><Heart size={12} /> {item.likes_count}</span>
          <span className="inline-flex items-center gap-1"><Eye size={12} /> {item.views_count}</span>
        </span>
        <span className="uppercase tracking-wider">社区</span>
      </div>
    </Link>
  )
}