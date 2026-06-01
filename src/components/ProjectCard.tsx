import { Plus, MoreHorizontal, Pencil, Upload, Trash2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useLanguage } from '../i18n/LanguageContext'
import { NewProjectDialog } from './NewProjectDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

export function NewProjectCard({ label }: { to?: string; label?: string }) {
  const { t } = useLanguage()
  const text = label ?? t.projects_new
  return (
    <NewProjectDialog
      trigger={
        <button
          type="button"
          className="corner-frame card group flex flex-col items-center justify-center
                     aspect-[16/10] text-center hover:bg-accent-dim/30 w-full"
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
        </button>
      }
    />
  )
}

export type ProjectMeta = {
  id: string
  title: string
  thumbnail: string // Tailwind gradient classes OR absolute image URL (http/https)
  status?: 'draft' | 'rendering' | 'ready'
  updated?: string
}

export type ProjectMenuAction = 'rename' | 'export' | 'delete'

export function ProjectCard({
  project,
  onMenuAction,
}: {
  project: ProjectMeta
  onMenuAction?: (action: ProjectMenuAction, project: ProjectMeta) => void
}) {
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
    <div className="card group cursor-pointer relative">
      <Link to="/projects/$projectId" params={{ projectId: project.id }} className="block">
        <div className="relative aspect-[16/10] overflow-hidden bg-bg-elevated">
          {/^https?:\/\//.test(project.thumbnail) ? (
            <img
              src={project.thumbnail}
              alt={project.title}
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            <div className={`absolute inset-0 bg-gradient-to-br ${project.thumbnail}`}>
              <div className="absolute inset-0 opacity-30 mix-blend-overlay"
                   style={{
                     backgroundImage:
                       'linear-gradient(0deg, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
                     backgroundSize: '24px 24px',
                   }} />
            </div>
          )}
          {project.status && (
            <span className={`absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${statusColors[project.status]}`}>
              {statusLabels[project.status]}
            </span>
          )}
        </div>
        <div className="px-4 py-3 pr-10">
          <h4 className="font-semibold text-text-primary truncate">{project.title}</h4>
          {project.updated && (
            <p className="text-xs text-text-muted mt-0.5">{t.projects_updated_prefix} {project.updated}</p>
          )}
        </div>
      </Link>
      {onMenuAction && (
        <div className="absolute bottom-2 right-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
                className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated transition"
                aria-label="menu"
              >
                <MoreHorizontal size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onSelect={() => onMenuAction('rename', project)}>
                <Pencil size={14} className="mr-2" /> {t.projects_menu_rename}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onMenuAction('export', project)}>
                <Upload size={14} className="mr-2" /> {t.projects_menu_export}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onMenuAction('delete', project)}
                className="text-rose-400 focus:text-rose-400"
              >
                <Trash2 size={14} className="mr-2" /> {t.projects_menu_delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}
