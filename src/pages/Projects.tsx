import { Filter, Search, Loader2, Trash2 } from 'lucide-react'
import fileSaver from 'file-saver'
const { saveAs } = fileSaver
import { useEffect, useMemo, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { NewProjectCard, ProjectCard, type ProjectMeta, type ProjectMenuAction } from '../components/ProjectCard'
import { ImportProjectButton } from '../components/ImportProjectButton'
import {
  loadImportedProjects,
  removeImportedProject,
  saveImportedProject,
  type ImportedProject,
} from '../lib/projectImport'
import {
  listMyProjects,
  renameProject,
  deleteProject,
  deleteAllMyProjects,
  type ProjectListItem,
} from '../lib/projects.functions'
import { formatRelativeTime } from '../lib/utils'
import { useLanguage } from '../i18n/LanguageContext'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'

const TAB_KEYS = ['All', 'Rendering', 'Drafts', 'Ready'] as const
type TabKey = typeof TAB_KEYS[number]

/** 把 server 返回的 ProjectListItem 转成 ProjectCard 需要的 ProjectMeta */
function toMeta(p: ProjectListItem): ProjectMeta {
  // 三级 fallback:customCover(用户自定封面)→ 自动挑的图(故事板/分镜/角色/场景)→ 渐变色
  const thumbnail = p.customCover || p.thumbnail || 'from-accent to-accent-mint'
  return {
    id: p.id,
    title: p.name,
    thumbnail,
    status: p.status,
    updated: formatRelativeTime(p.updatedAt),
  }
}

export default function Projects() {
  const { t } = useLanguage()
  const tabLabels: Record<TabKey, string> = {
    All: t.projects_tab_all,
    Rendering: t.projects_tab_rendering,
    Drafts: t.projects_tab_drafts,
    Ready: t.projects_tab_ready,
  }
  const [tab, setTab] = useState<TabKey>('All')
  const [q, setQ] = useState('')
  const [imported, setImported] = useState<ImportedProject[]>([])
  const [remote, setRemote] = useState<ProjectListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [renaming, setRenaming] = useState<ProjectMeta | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<ProjectMeta | null>(null)
  const [busy, setBusy] = useState(false)

  const callList = useServerFn(listMyProjects)
  const callRename = useServerFn(renameProject)
  const callDelete = useServerFn(deleteProject)
  const callDeleteAll = useServerFn(deleteAllMyProjects)

  // 清空所有项目 —— 强确认态
  const [clearingAll, setClearingAll] = useState(false)
  const [clearAllConfirmText, setClearAllConfirmText] = useState('')
  const [clearAllConfirmed, setClearAllConfirmed] = useState(false)

  // 加载真实项目
  useEffect(() => {
    setImported(loadImportedProjects())
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    callList({ data: {} })
      .then((r) => {
        if (cancelled) return
        if (r.error) setError(r.error)
        else setRemote(r.projects ?? [])
      })
      .catch((e: any) => {
        if (cancelled) return
        // server fn 失败时 e 可能是 Response 对象(Response 没有 .message)
        // 把状态码 + 文本都打出来方便排查
        let msg = 'failed to load projects'
        if (e instanceof Error) msg = e.message
        else if (e && typeof e === 'object') {
          msg = e.message || e.statusText || JSON.stringify(e).slice(0, 200)
        } else if (typeof e === 'string') msg = e
        console.error('[listMyProjects] failed:', e)
        setError(msg)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [callList])

  const list = useMemo(() => {
    const remoteMetas = remote.map(toMeta)
    const combined: ProjectMeta[] = [...imported, ...remoteMetas]
    return combined.filter((p) => {
      if (tab === 'Rendering' && p.status !== 'rendering') return false
      if (tab === 'Drafts' && p.status !== 'draft') return false
      if (tab === 'Ready' && p.status !== 'ready') return false
      if (q && !p.title.toLowerCase().includes(q.toLowerCase())) return false
      return true
    })
  }, [tab, q, imported, remote])

  function isImported(id: string) {
    return imported.some((p) => p.id === id)
  }

  async function refresh() {
    const r = await callList({ data: {} })
    if (!r.error) setRemote(r.projects ?? [])
  }

  function handleMenu(action: ProjectMenuAction, project: ProjectMeta) {
    if (action === 'rename') {
      setRenameValue(project.title)
      setRenaming(project)
    } else if (action === 'delete') {
      setDeleting(project)
    } else if (action === 'export') {
      // 导出:对真实项目导出 workspace_data,导入项目导出 ImportedProject.data
      const imp = imported.find((p) => p.id === project.id)
      const payload = imp?.data ?? {
        id: project.id,
        title: project.title,
        status: project.status,
        thumbnail: project.thumbnail,
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      })
      const safe = (project.title || 'project').replace(/[\\/:*?"<>|\n\r\t]+/g, '_').slice(0, 60)
      saveAs(blob, `${safe}.json`)
    }
  }

  async function confirmRename() {
    if (!renaming) return
    const next = renameValue.trim()
    if (!next) return
    setBusy(true)
    try {
      if (isImported(renaming.id)) {
        // 本地导入项目走旧逻辑
        const imp = imported.find((p) => p.id === renaming.id)!
        const updated: ImportedProject = { ...imp, title: next }
        saveImportedProject(updated)
        setImported((prev) => prev.map((p) => (p.id === renaming.id ? updated : p)))
      } else {
        // 真实项目走 server
        const r = await callRename({ data: { id: renaming.id, name: next } })
        if (!r.ok) {
          toast.error(r.error || '改名失败')
          return
        }
        toast.success('已改名')
        await refresh()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '改名失败')
    } finally {
      setBusy(false)
      setRenaming(null)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      if (isImported(deleting.id)) {
        removeImportedProject(deleting.id)
        setImported((prev) => prev.filter((p) => p.id !== deleting.id))
        toast.success('已删除')
      } else {
        const r = await callDelete({ data: { id: deleting.id } })
        if (!r.ok) {
          toast.error(r.error || '删除失败')
          return
        }
        toast.success('已删除')
        await refresh()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    } finally {
      setBusy(false)
      setDeleting(null)
    }
  }

  async function confirmClearAll() {
    setBusy(true)
    try {
      const r = await callDeleteAll({ data: { confirm: true } })
      if (!r.ok) {
        toast.error(r.error || '清空失败')
        return
      }
      toast.success(`已清空 ${r.deletedCount} 个项目`)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '清空失败')
    } finally {
      setBusy(false)
      setClearingAll(false)
      setClearAllConfirmText('')
      setClearAllConfirmed(false)
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl md:text-4xl font-bold">{t.projects_title}</h1>
          <p className="text-text-secondary mt-1">{t.projects_subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t.projects_search}
              className="pl-9 pr-3 py-2 rounded-full bg-bg-elevated border border-border
                         text-sm text-text-primary placeholder:text-text-muted
                         focus:outline-none focus:border-accent/60 focus:shadow-glow w-56"
            />
          </div>
          <button className="btn-ghost"><Filter size={14} /> {t.projects_filter}</button>
          {remote.length > 0 && (
            <button
              type="button"
              onClick={() => setClearingAll(true)}
              className="btn-ghost text-rose-400 hover:text-rose-300"
              title="清空所有项目(不可恢复)"
            >
              <Trash2 size={14} /> 清空
            </button>
          )}
          <ImportProjectButton onImported={(p) => setImported((prev) => [p, ...prev.filter((x) => x.id !== p.id)])} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {TAB_KEYS.map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`chip ${tab === k ? 'chip-active' : ''}`}
          >
            {tabLabels[k]}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 panel p-3 text-sm text-rose-400">
          加载项目失败:{error}
        </div>
      )}

      {loading && remote.length === 0 ? (
        <div className="py-16 flex items-center justify-center text-text-muted">
          <Loader2 size={18} className="animate-spin mr-2" /> 加载项目…
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          <NewProjectCard />
          {list.length === 0 && !loading ? (
            <div className="col-span-full py-12 text-center text-text-muted text-sm">
              还没有项目,点上方「+ 新建项目」开始。
            </div>
          ) : (
            list.map((p) => (
              <ProjectCard key={p.id} project={p} onMenuAction={handleMenu} />
            ))
          )}
        </div>
      )}

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.projects_rename_title}</DialogTitle>
          </DialogHeader>
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void confirmRename() }}
            disabled={busy}
            placeholder={t.projects_rename_placeholder}
            className="w-full px-3 py-2 rounded-md bg-bg-elevated border border-border
                       text-sm text-text-primary placeholder:text-text-muted
                       focus:outline-none focus:border-accent/60"
          />
          <DialogFooter>
            <button className="btn-ghost" onClick={() => setRenaming(null)} disabled={busy}>{t.common_cancel}</button>
            <button className="btn-primary" onClick={() => void confirmRename()} disabled={busy}>
              {busy && <Loader2 size={13} className="animate-spin mr-1" />}
              {t.common_confirm}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.projects_delete_title}</DialogTitle>
            <DialogDescription>{t.projects_delete_confirm}</DialogDescription>
          </DialogHeader>
          {deleting && (
            <div className="text-sm text-text-secondary truncate">「{deleting.title}」</div>
          )}
          <DialogFooter>
            <button className="btn-ghost" onClick={() => setDeleting(null)} disabled={busy}>{t.common_cancel}</button>
            <button
              className="btn-primary bg-rose-500 hover:bg-rose-600 border-rose-500"
              onClick={() => void confirmDelete()}
              disabled={busy}
            >
              {busy && <Loader2 size={13} className="animate-spin mr-1" />}
              {t.projects_menu_delete}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 强确认 modal —— 清空所有项目。必须勾选 + 输入 CLEAR 才会激活按钮。 */}
      <Dialog open={clearingAll} onOpenChange={(o) => !o && !busy && setClearingAll(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-rose-400">清空所有项目?</DialogTitle>
            <DialogDescription>
              这将<strong>永久删除你账户下全部 {remote.length} 个项目</strong>(含 workspace_data)。
              <br />
              <span className="text-text-muted">已入库到 Supabase Storage 的视频 / 故事板图文件保留,但不再关联到任何项目。</span>
              <br />
              <span className="text-text-muted">本机导入的旧项目不受影响。</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs text-text-muted flex items-start gap-2">
              <input
                type="checkbox"
                checked={clearAllConfirmed}
                onChange={(e) => setClearAllConfirmed(e.target.checked)}
                className="mt-0.5"
              />
              <span>我已了解,确认要清空我账户下的全部项目(不可恢复)</span>
            </label>
            <input
              autoFocus
              value={clearAllConfirmText}
              onChange={(e) => setClearAllConfirmText(e.target.value)}
              placeholder='输入大写 "CLEAR" 以确认'
              className="w-full px-3 py-2 rounded-md bg-bg-elevated border border-border
                         text-sm text-text-primary placeholder:text-text-muted
                         focus:outline-none focus:border-rose-500/60"
            />
          </div>
          <DialogFooter>
            <button
              className="btn-ghost"
              onClick={() => { setClearingAll(false); setClearAllConfirmText(''); setClearAllConfirmed(false) }}
              disabled={busy}
            >
              {t.common_cancel}
            </button>
            <button
              className="btn-primary bg-rose-500 hover:bg-rose-600 border-rose-500 disabled:opacity-40"
              onClick={() => void confirmClearAll()}
              disabled={busy || !clearAllConfirmed || clearAllConfirmText !== 'CLEAR'}
            >
              {busy && <Loader2 size={13} className="animate-spin mr-1" />}
              永久删除 {remote.length} 个项目
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}