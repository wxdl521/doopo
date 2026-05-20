import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { listCommunityPosts, type PostKind } from '@/lib/community.functions'
import CommunityCard, { type CommunityCardItem } from '@/components/community/CommunityCard'

export const Route = createFileRoute('/community/')({
  component: CommunityIndex,
})

type Sort = 'recent' | 'hot' | 'likes'
const SORTS: { value: Sort; label: string }[] = [
  { value: 'hot', label: '最热' },
  { value: 'recent', label: '最新' },
  { value: 'likes', label: '点赞最多' },
]
const KINDS: { value: PostKind | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'script', label: '剧本' },
  { value: 'character', label: '角色' },
  { value: 'scene', label: '场景' },
  { value: 'prop', label: '道具' },
  { value: 'comic', label: '漫剧' },
]

function CommunityIndex() {
  const [sort, setSort] = useState<Sort>('hot')
  const [kind, setKind] = useState<PostKind | 'all'>('all')
  const [items, setItems] = useState<CommunityCardItem[]>([])
  const [loading, setLoading] = useState(true)
  const list = useServerFn(listCommunityPosts)

  useEffect(() => {
    setLoading(true)
    list({ data: { sort, limit: 36, kind: kind === 'all' ? undefined : kind } })
      .then((data) => setItems(data as CommunityCardItem[]))
      .finally(() => setLoading(false))
  }, [sort, kind, list])

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="font-display text-3xl md:text-4xl font-bold">社区精选</h1>
        <p className="text-text-secondary mt-1">来自创作者们的剧本、角色、场景、道具与漫剧作品。</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {SORTS.map((s) => (
          <button key={s.value} onClick={() => setSort(s.value)}
                  className={`chip !py-2 !px-3.5 text-sm ${sort === s.value ? 'chip-active' : ''}`}>
            {s.label}
          </button>
        ))}
        <span className="mx-2 text-text-muted text-xs">·</span>
        {KINDS.map((k) => (
          <button key={k.value} onClick={() => setKind(k.value)}
                  className={`chip !py-2 !px-3.5 text-sm ${kind === k.value ? 'chip-active' : ''}`}>
            {k.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="panel p-10 text-center text-text-muted text-sm">加载中…</div>
      ) : items.length === 0 ? (
        <div className="panel p-10 text-center text-text-muted text-sm">还没有作品，做第一个分享者吧。</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((it) => (
            <CommunityCard key={it.id} item={it} />
          ))}
        </div>
      )}
    </div>
  )
}