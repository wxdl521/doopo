import type { PipelineScene, PipelineAct, PipelineCharacter } from './scriptPipeline.functions'
import { supabase } from '@/integrations/supabase/client'

export type SavedScript = {
  id: string
  title: string
  plot: string
  type: string
  genre: string | string[]
  tone: string | string[]
  model?: string
  // legacy single-text fallback
  content?: string
  // structured pipeline output
  logline?: string
  premise?: string
  themes?: string[]
  acts?: PipelineAct[]
  scenes?: PipelineScene[]
  characters?: PipelineCharacter[]
  // ============= 剧本智能体（对话式 5 步流程）原始文本 =============
  synopsisText?: string
  episodesText?: {
    epIndex: number
    text: string
    versions?: { text: string; savedAt: string; label?: string }[]
  }[]
  charactersText?: string
  expectedEpisodes?: number
  totalMinutes?: number
  // local quality estimates
  quality?: {
    pacing: number
    conflict: number
    dialogueDensity: number
    suggestions: string[]
  }
  createdAt: string
  updatedAt: string
}

const KEY = 'doopoo_scripts'

export function loadScripts(): SavedScript[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) || '[]')
    return Array.isArray(raw) ? (raw as SavedScript[]) : []
  } catch {
    return []
  }
}

export function saveScripts(list: SavedScript[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KEY, JSON.stringify(list))
}

export function upsertScript(item: SavedScript): SavedScript[] {
  const { all, next } = writeScript(item)
  // fire-and-forget 云端持久化（登录后生效；未登录或离线则静默忽略）
  void cloudUpsert(next)
  return all
}

export async function upsertScriptAndCloud(item: SavedScript): Promise<SavedScript[]> {
  const { all, next } = writeScript(item)
  await cloudUpsert(next)
  return all
}

function writeScript(item: SavedScript): { all: SavedScript[]; next: SavedScript } {
  const all = loadScripts()
  const idx = all.findIndex((s) => s.id === item.id)
  const next: SavedScript = { ...item, updatedAt: new Date().toISOString() }
  if (idx >= 0) all[idx] = next
  else all.unshift(next)
  saveScripts(all)
  return { all, next }
}

export function removeScript(id: string): SavedScript[] {
  const all = loadScripts().filter((s) => s.id !== id)
  saveScripts(all)
  void cloudDelete(id)
  return all
}

export function findScript(id: string): SavedScript | null {
  return loadScripts().find((s) => s.id === id) ?? null
}

// ============= Cloud sync =============

async function hasSession(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  try {
    const { data } = await supabase.auth.getSession()
    return !!data.session?.access_token
  } catch {
    return false
  }
}

async function cloudUpsert(item: SavedScript): Promise<boolean> {
  if (!(await hasSession())) return false
  try {
    const { upsertScriptRemote } = await import('./scripts.functions')
    await upsertScriptRemote({ data: { script: item } })
    return true
  } catch (e) {
    // 未登录 / 网络异常 → 仅本地保存
    console.debug('[scripts] cloud upsert skipped:', e)
    return false
  }
}

async function cloudDelete(id: string) {
  if (!(await hasSession())) return
  try {
    const { deleteScriptRemote } = await import('./scripts.functions')
    await deleteScriptRemote({ data: { id } })
  } catch (e) {
    console.debug('[scripts] cloud delete skipped:', e)
  }
}

/**
 * 拉取云端剧本并与本地按 updatedAt 较新者合并，写回 localStorage。
 * 未登录时静默返回本地列表。
 */
export async function syncFromCloud(): Promise<SavedScript[]> {
  if (!(await hasSession())) return loadScripts()
  try {
    const { listScriptsRemote } = await import('./scripts.functions')
    const remote = (await listScriptsRemote()) as SavedScript[]
    const local = loadScripts()
    const map = new Map<string, SavedScript>()
    for (const s of local) map.set(s.id, s)
    for (const r of remote) {
      const existing = map.get(r.id)
      if (!existing) map.set(r.id, r)
      else {
        const lu = Date.parse(existing.updatedAt || '') || 0
        const ru = Date.parse(r.updatedAt || '') || 0
        map.set(r.id, ru >= lu ? r : existing)
      }
    }
    const merged = Array.from(map.values()).sort(
      (a, b) => (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0),
    )
    saveScripts(merged)
    return merged
  } catch (e) {
    console.debug('[scripts] cloud sync skipped:', e)
    return loadScripts()
  }
}

export async function findScriptWithCloud(id: string): Promise<SavedScript | null> {
  const local = findScript(id)
  if (!(await hasSession())) return local
  try {
    const { getScriptRemote } = await import('./scripts.functions')
    const remote = (await getScriptRemote({ data: { id } })) as SavedScript | null
    if (!remote) return local
    const lu = Date.parse(local?.updatedAt || '') || 0
    const ru = Date.parse(remote.updatedAt || '') || 0
    if (ru >= lu) {
      // 写回本地缓存，避免下次刷新还得拉云端
      const all = loadScripts()
      const idx = all.findIndex((s) => s.id === id)
      if (idx >= 0) all[idx] = remote
      else all.unshift(remote)
      saveScripts(all)
      return remote
    }
    return local
  } catch (e) {
    console.debug('[scripts] cloud get skipped:', e)
    return local
  }
}

// ============= Quality heuristics =============

export function computeQuality(scenes: PipelineScene[] | undefined): SavedScript['quality'] {
  if (!scenes || scenes.length === 0) {
    return { pacing: 0, conflict: 0, dialogueDensity: 0, suggestions: [] }
  }
  const totalScenes = scenes.length
  const allBeats = scenes.flatMap((s) => s.beats)
  const conflictHits = allBeats.filter((b) =>
    /冲突|反转|对峙|对抗|揭穿|崩溃|对立|逼问|争吵|conflict|fight|reveal|clash|twist|confront/i.test(b),
  ).length
  const conflict = Math.min(100, Math.round((conflictHits / Math.max(1, totalScenes)) * 70 + 20))

  const dialogueLines = scenes.reduce((sum, s) => sum + s.dialogue.length, 0)
  const actionLen = scenes.reduce((sum, s) => sum + s.action.length, 0)
  const dialogueDensity = Math.min(
    100,
    Math.round((dialogueLines * 35) / Math.max(1, dialogueLines + actionLen / 30)),
  )

  // Pacing: penalise scenes that are too long (action > 220 chars) or too short (< 40),
  // reward variety in scene lengths.
  const lens = scenes.map((s) => s.action.length)
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length
  const variance =
    lens.reduce((a, b) => a + (b - avg) ** 2, 0) / lens.length
  const stdev = Math.sqrt(variance)
  const ideal = 120
  const distance = Math.abs(avg - ideal)
  const pacing = Math.max(
    20,
    Math.min(100, Math.round(95 - distance * 0.3 + Math.min(stdev, 60) * 0.2)),
  )

  const suggestions: string[] = []
  if (conflict < 55) suggestions.push('每场强化一个明确冲突 beat（对抗/反转/揭穿）。')
  if (dialogueDensity < 30) suggestions.push('对白偏少，可加入更紧凑的来回交锋。')
  if (dialogueDensity > 75) suggestions.push('对白过密，考虑用动作/画面替代部分台词。')
  if (avg > 220) suggestions.push('单场动作描写偏长，建议拆场或精简。')
  if (avg < 50) suggestions.push('动作描写偏短，画面感不足，补充细节。')
  if (totalScenes < 4) suggestions.push('场次过少，建议扩展至 5 场以上以承载完整起承转合。')

  return { pacing, conflict, dialogueDensity, suggestions }
}

// ============= Export helpers (structured -> text) =============

export function scriptToPlainText(s: SavedScript): string {
  if (s.scenes?.length) {
    const lines: string[] = []
    lines.push(s.title)
    if (s.logline) lines.push('', `LOGLINE: ${s.logline}`)
    lines.push('', '═'.repeat(40), '')
    for (const sc of s.scenes) {
      lines.push(`【${sc.slug}】`)
      lines.push(sc.action)
      lines.push('')
      for (const d of sc.dialogue) {
        lines.push(`${d.role}${d.parenthetical ? `(${d.parenthetical})` : ''}：${d.line}`)
      }
      lines.push('')
    }
    return lines.join('\n')
  }
  return s.content || ''
}
