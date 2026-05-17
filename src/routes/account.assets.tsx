import { createFileRoute, Link } from '@tanstack/react-router'
import PageHeader from '../components/PageHeader'
import { mockProjectDetails, mockCharacters } from '../data/mock'
import { Image as ImageIcon, FileVideo } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'

export const Route = createFileRoute('/account/assets')({
  component: MyAssets,
})

function MyAssets() {
  const { t } = useLanguage()
  return (
    <>
      <PageHeader title={t.account_assets} subtitle={t.account_assets_sub} />
      <h3 className="font-display font-bold mb-3">{t.account_projects_section}</h3>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {mockProjectDetails.map((p) => (
          <Link key={p.id} to="/projects/$projectId" params={{ projectId: p.id }} className="card group">
            <div className={`aspect-[16/10] bg-gradient-to-br ${p.thumbnail} relative`}>
              <div className="absolute bottom-2 right-2 px-2 py-0.5 text-[10px] font-mono rounded-md bg-black/40 backdrop-blur text-white">{p.assetCount} {t.account_assets_count}</div>
            </div>
            <div className="p-3">
              <div className="font-semibold">{p.title}</div>
              <div className="text-xs text-text-muted">{p.updated}</div>
            </div>
          </Link>
        ))}
      </div>

      <h3 className="font-display font-bold mb-3">{t.account_characters_section}</h3>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {mockCharacters.map((c) => (
          <Link key={c.id} to="/characters/$characterId" params={{ characterId: c.id }} className="card overflow-hidden">
            <div className="aspect-square" style={{ background: c.views.front }} />
            <div className="p-3">
              <div className="font-semibold">{c.name}</div>
              <div className="text-xs text-text-muted">{c.role}</div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="panel p-6 flex items-center gap-4">
          <ImageIcon className="text-accent" />
          <div>
            <div className="text-sm text-text-muted">{t.account_images_generated}</div>
            <div className="font-display text-xl font-bold">182</div>
          </div>
        </div>
        <div className="panel p-6 flex items-center gap-4">
          <FileVideo className="text-accent" />
          <div>
            <div className="text-sm text-text-muted">{t.account_video_renders}</div>
            <div className="font-display text-xl font-bold">26</div>
          </div>
        </div>
      </div>
    </>
  )
}
