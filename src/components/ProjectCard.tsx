import { Plus } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useLanguage } from '../i18n/LanguageContext'

export function NewProjectCard({ to = '/projects', label }: { to?: string; label?: string }) {
  const { t } = useLanguage()
  const text = label ?? t.projects_new
  return (
    <Link
      to={to}
      className="corner-frame card group flex flex-col items-center justify-center
                 aspect-[16/10] text-center hover:bg-accent-dim/30"
    >
      <span className="c-tr" /><span className="c-bl" />
      <div className="w-12 h-12 rounded-full bg-bg-elevated border border-border
                      flex items-center justify-center group-hover:border-accent
                      group-hover:text-accent transition">
        <Plus size={22} />
      </div>
      <span className="mt-3 font-medium text-text-secondary group-hover:text-text-primary">
        {text}
      </span>
    </Link>
  )
}

export type ProjectMeta = {
  id: string
  title: string
  thumbnail: string // gradient classes
  status?: 'draft' | 'rendering' | 'ready'
  updated?: string
}

export function ProjectCard({ project }: { project: ProjectMeta }) {
  const { t } = useLanguage()
  const statusColors: Record<NonNullable<ProjectMeta['status']>, string> = {
    draft: 'bg-amber-400/20 text-amber-300 border-amber-400/30',
    rendering: 'bg-accent-dim text-accent border-accent/30',
    ready: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30',
  }
  const statusLabels: Record<NonNullable<ProjectMeta['status']>, string> = {
    draft: t.projects_status_draft,
    rendering: t.projects_status_rendering,
    ready: t.projects_status_ready,
  }
  return (
    <div className="card group cursor-pointer">
      <div className={`relative aspect-[16/10] bg-gradient-to-br ${project.thumbnail}`}>
        <div className="absolute inset-0 opacity-30 mix-blend-overlay"
             style={{
               backgroundImage:
                 'linear-gradient(0deg, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
               backgroundSize: '24px 24px',
             }} />
        {project.status && (
          <span className={`absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${statusColors[project.status]}`}>
            {statusLabels[project.status]}
          </span>
        )}
      </div>
      <div className="px-4 py-3">
        <h4 className="font-semibold text-text-primary truncate">{project.title}</h4>
        {project.updated && (
          <p className="text-xs text-text-muted mt-0.5">{t.projects_updated_prefix} {project.updated}</p>
        )}
      </div>
    </div>
  )
}
