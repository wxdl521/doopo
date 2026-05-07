import { useMemo, useState } from 'react'
import { showcase, showcaseFilters, type ShowcaseFilter } from '../data/showcase'
import ShowcaseCard from './ShowcaseCard'
import { useLanguage } from '../i18n/LanguageContext'

export default function ShowcaseGrid({ initial = 'Featured', limit }: { initial?: ShowcaseFilter; limit?: number }) {
  const { t } = useLanguage()
  const [filter, setFilter] = useState<ShowcaseFilter>(initial)

  const items = useMemo(() => {
    const list = filter === 'All'
      ? showcase
      : filter === 'Featured'
        ? showcase.filter((s) => s.featured)
        : showcase.filter((s) => s.category === filter)
    return limit ? list.slice(0, limit) : list
  }, [filter, limit])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {showcaseFilters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`chip !py-2 !px-3.5 text-sm ${filter === f ? 'chip-active' : ''}`}
          >
            {f}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="panel p-10 text-center text-text-muted">
          {t.showcase_no_items}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((it, i) => (
            <div key={it.id} className="animate-slide-up" style={{ animationDelay: `${i * 50}ms` }}>
              <ShowcaseCard item={it} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
