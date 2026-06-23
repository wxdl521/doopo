import { createFileRoute } from '@tanstack/react-router'
import { Fragment, useState, useEffect, useRef, useCallback } from 'react'
import { useServerFn } from '@tanstack/react-start'
import ReactMarkdown from 'react-markdown'
import WorkspaceTopbar, { type WorkspaceTab } from '../components/workspace/WorkspaceTopbar'
import ZopiaChatPanel, { type ZopiaChatPanelHandle } from '../components/workspace/ZopiaChatPanel'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../hooks/useAuth'
import { saveOneCharacter, saveOneScene, saveOneProp } from '../lib/assetsStorage'
import {
  generateOutline, generateScript, generateCharacters, generateStoryboard, generateTimeline,
  type Outline, type GenScene, type GenCharacter, type GenCharacterLook, type GenProp, type StoryboardPanel, type TimelineData, type TimelineTrack, type TimelineClip,
  type StoryboardGroup, type StoryboardShot, type ShotType,
} from '../data/workspaceGenerators'
import { generateStageAi } from '../lib/aiGenerate.functions'
import { generateImage, regenerateSceneImage } from '../lib/seedream.functions'
import { uploadLocalImage, serverUrlToBase64 } from '../lib/uploadImage.functions'
import { regenerateCharacterLook } from '../lib/characterRegen.functions'
import { describeCharacterImage } from '../lib/describeCharacterImage.functions'
import { generateStoryboardFromPlot, generateStoryboardShotImage, regenerateStoryboardShot, regenerateStoryboardPitchDeck } from '../lib/storyboard.functions'
import { generateVideo } from '../lib/videoGenerate.functions'
import { generateStoryboardPitchDeck } from '../lib/seedream.functions'
import { getProject, upsertProject, saveWorkspaceData, loadWorkspaceData, type ProjectConfigRow } from '../lib/projects.functions'
import { persistWorkspaceMedia, saveOneStoryboard, saveOneVideo, persistAssetImage } from '../lib/workspaceMedia.functions'
import { urlToBase64 } from '../lib/imageToBase64'
import { streamSynopsis, streamEpisodeScenes, refineSynopsis, refineEpisodeScenes } from '../lib/scriptAgent.functions'
import type { ImportedScriptResult } from '../lib/parseImportedScript.functions'
import { resolveProjectStyle, resolveT2IModel, resolveI2IModel, buildStyleLock } from '../lib/visualStyles'
import { hashString } from '../lib/utils'
import { filterByEpisode, groupByMatchKey, getEffectiveClothing, getEffectiveRoleLabel } from '../lib/characterFilters'
import { Maximize2, FileText, Camera, Clock, Users, X, Loader2, Sparkles, Send, CheckCircle2, Pencil, Check, Image as ImageIcon, LayoutGrid, RefreshCw, Target, ChevronDown, BookmarkPlus, Plus, Upload } from 'lucide-react'
import CharacterPortrait from '../components/workspace/CharacterPortrait'
import StoryboardTimeline from '../components/workspace/StoryboardTimeline'
import { toast } from 'sonner'

export const Route = createFileRoute('/workspace/$workspaceId')({
  head: ({ params }) => ({ meta: [{ title: `Workspace ${params.workspaceId} — Doopoo` }] }),
  component: WorkspacePage,
})

type WorkspaceData = {
  outline: Outline | null
  scenes: GenScene[]
  characters: GenCharacter[]
  props: GenProp[]
  storyboard: StoryboardPanel[]
  /**
   * 由 AI 从当集剧情切分出来的分镜组(每组 1~3 个镜头)。这是新的"分镜编辑"
   * 流程的主数据,跟旧 storyboard 字段并存,UI 上替换了 storyboard 视图。
   */
  storyboardGroups: StoryboardGroup[]
  timeline: TimelineData | null
  synopsisText: string
  episodeTexts: { epIndex: number; text: string }[]
  nextEpIndex: number
  nextSceneCount: number
}

const emptyData: WorkspaceData = {
  outline: null,
  scenes: [],
  characters: [],
  props: [],
  storyboard: [],
  storyboardGroups: [],
  timeline: null,
  synopsisText: '',
  episodeTexts: [],
  nextEpIndex: 1,
  nextSceneCount: 15,
}

const ROLE_TONE: Record<GenCharacter['role'], string> = {
  lead: 'bg-accent/20 text-accent border-accent/40',
  supporting: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  villain: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
}

const ROLE_LABEL_FALLBACK: Record<GenCharacter['role'], string> = {
  lead: '主角', supporting: '配角', villain: '反派',
}

const sbGradient = (i: number) => {
  const palette = [
    'linear-gradient(135deg, #1e3a5f, #0f172a)',
    'linear-gradient(135deg, #7c2d12, #1e1b4b)',
    'linear-gradient(135deg, #0ea5e9, #1e293b)',
    'linear-gradient(135deg, #ec4899, #1e1b4b)',
    'linear-gradient(135deg, #fbbf24, #1e293b)',
    'linear-gradient(135deg, #10b981, #0f172a)',
  ]
  return palette[i % palette.length]
}

// 2026/06 提到模块顶层 —— 场景卡片网格 + 点击放大 lightbox 都要用。
// 之前在 character tab 的 IIFE 里 const,模态那边引用不到。
const SCENE_TIME_LABELS: Record<string, string> = { DAY: '日', NIGHT: '夜', DUSK: '黄昏', DAWN: '黎明' }

// 2026/06:把 ARK Seedance / DashScope 等视频模型返回的英文错误翻译成中文 + 解决建议。
// toast 直接弹服务端原始错误信息对用户不友好(尤其是 ARK 内容审核拦截)。
// 这里识别几个常见错误码,返回更可读的提示。
function explainVideoError(raw: string | undefined | null): string {
  const s = (raw || '').trim()
  if (!s) return '视频生成失败'
  // 1) ARK 内容审核拦截 —— 输入图被识别为含真实人物
  if (/InputImageSensitiveContentDetected\.PrivacyInformation/i.test(s)
      || /may contain real person/i.test(s)
      || /SensitiveContentDetected/i.test(s)) {
    return '火山方舟识别到参考图可能含真实人物,已拒绝生成。建议:① 把分镜/故事板切到插画/动漫风格再生成;② 或在「基础设置」把视频模型换成 happyhorse-1.0-i2v(走阿里 DashScope,审核更宽松)。'
  }
  // 2) 内容违规(其它类型)
  if (/ContentPolicyViolation|InvalidParameter\.Prompt|SensitiveWords/i.test(s)) {
    return '内容审核拦截:prompt 或图片可能含敏感信息,已拒绝生成。试试修改剧情 / 重生插画风格分镜图。'
  }
  // 3) 配额 / 限流
  if (/429|quota|rate.?limit/i.test(s)) {
    return '请求过于频繁或配额已用完,请稍后再试。'
  }
  // 4) 余额不足
  if (/balance|insufficient.?funds|account.*not enough/i.test(s)) {
    return '账户余额不足,请充值后再试。'
  }
  // 5) 任务超时
  if (/timed? ?out/i.test(s)) {
    return '任务处理超时,请稍后重试或缩短分镜组时长。'
  }
  // 6) 其它 —— 截断到 200 字避免 toast 太长
  return s.length > 200 ? `${s.slice(0, 200)}…` : s
}

// Module-scope: defined once, stable component identity across renders.
// Defining these inside WorkspacePage made them "new" components on every render,
// which caused React to unmount/remount and lose textarea cursor + IME state.
function ClampText({ text, label, maxLines = 3, threshold = 80 }: { text: string; label: string; maxLines?: number; threshold?: number }) {
  const [expanded, setExpanded] = useState(false)
  const clampable = text.length > threshold
  if (!clampable) return <span>{text}</span>
  return (
    <div>
      <p
        className={expanded ? '' : 'overflow-hidden'}
        style={expanded ? undefined : { display: '-webkit-box', WebkitLineClamp: maxLines, WebkitBoxOrient: 'vertical' as const }}
      >
        {text}
      </p>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`${expanded ? '收起' : '展开'} ${label}`}
        className="mt-1 text-[11px] text-text-muted hover:text-text-primary transition underline-offset-2 hover:underline"
      >
        {expanded ? '收起' : '展开全部'}
      </button>
    </div>
  )
}

function CharacterDossier({ character, cast }: { character: GenCharacter; cast: GenCharacter[] }) {
  const rows: { label: string; value: string }[] = [
    { label: '性别', value: character.gender },
    { label: '年龄', value: String(character.age) },
    { label: '面部', value: character.faceDescription },
    { label: '身材', value: character.bodyDescription },
    { label: '服装', value: character.clothingDescription },
    { label: '性格', value: character.personality },
  ].filter((r) => r.value)
  const nameOf = (id: string) => cast.find((x) => x.id === id)?.name ?? id
  const roleOf = (id: string) => cast.find((x) => x.id === id)?.role ?? 'supporting'
  const jumpTo = (id: string) => {
    const el = document.getElementById(id)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <div className="w-full md:max-h-[600px] md:overflow-y-auto rounded-2xl border border-border bg-bg-elevated/40 px-5 py-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-xs tracking-[0.18em] uppercase text-text-muted">角色档案</h3>
        <span className="text-[10px] text-text-muted">Character Bible</span>
      </div>
      <dl className="divide-y divide-border/60">
        {rows.map((r) => (
          <div key={r.label} className="flex gap-3 py-2.5">
            <dt className="text-xs text-text-muted shrink-0 w-10 pt-0.5 tracking-wide">{r.label}</dt>
            <dd className="text-sm text-text-secondary leading-relaxed flex-1 min-w-0 break-words">
              <ClampText text={r.value} label={r.label} />
            </dd>
          </div>
        ))}
      </dl>
      {character.relations && character.relations.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/60">
          <div className="flex items-baseline justify-between mb-2">
            <h4 className="text-xs tracking-[0.18em] uppercase text-text-muted">关系网</h4>
            <span className="text-[10px] text-text-muted">点击姓名跳转</span>
          </div>
          <ul role="list" className="space-y-2">
            {character.relations.map((r) => {
              const targetRole = roleOf(r.targetId)
              return (
                <li key={r.targetId} className="flex items-start gap-2 text-sm">
                  <span className="text-text-muted shrink-0 pt-0.5" aria-hidden>↔</span>
                  <button
                    type="button"
                    onClick={() => jumpTo(r.targetId)}
                    aria-label={`跳转到角色 ${nameOf(r.targetId)}`}
                    className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full border transition hover:opacity-80 ${ROLE_TONE[targetRole]}`}
                  >
                    {nameOf(r.targetId)}
                  </button>
                  <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded border border-border bg-bg-elevated/60 text-text-muted">
                    {r.label}
                  </span>
                  <span className="text-text-secondary text-[13px] leading-relaxed min-w-0 break-words">{r.summary}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * 2026/06:ShotMembershipEditor —— 分镜角色集合编辑器。
 * 显示该 shot 实际生效的角色列表(pickShotCharacterIds:shot 覆盖 group),
 * 每个角色可:
 *   - 点 look 缩略图 → 选该角色在该 shot 用的具体形象(imageKey)
 *   - 点 × → 把该角色从该 shot 移除(不影响 group)
 *   - 点「+ 加角色」 → 从 group.characterIds 里挑没在 shot 里的,添加进来
 *   - 点「恢复 group 默认」 → 清空 shot.characterIds,回到 fallback 行为
 */
function ShotMembershipEditor({
  group,
  shot,
  characters,
  charImages,
  onAdd,
  onRemove,
  onSetLook,
  onReset,
}: {
  group: StoryboardGroup
  shot: StoryboardShot
  characters: GenCharacter[]
  charImages: Record<string, string[]>
  onAdd: (characterId: string) => void
  onRemove: (characterId: string) => void
  onSetLook: (characterId: string, imageKey: string) => void
  onReset: () => void
}) {
  const effectiveIds = pickShotCharacterIds(shot, group)
  const groupIds = group.characterIds
  const isOverridden = shot.characterIds !== undefined
  const addable = groupIds.filter((cid: string) => !effectiveIds.includes(cid))
  return (
    <div className="pt-1">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-text-muted">本镜头角色</div>
        {isOverridden && (
          <button
            type="button"
            onClick={onReset}
            className="text-[9px] text-text-muted hover:text-accent underline-offset-2 hover:underline"
            title="清空 shot.characterIds,恢复 group 默认"
          >
            恢复 group 默认
          </button>
        )}
      </div>
      {effectiveIds.length === 0 ? (
        <div className="text-[10px] text-text-muted mt-1 italic">本镜头无角色(纯场景 / 空镜)</div>
      ) : (
        <div className="space-y-1.5 mt-1">
          {effectiveIds.map((cid: string) => {
            const ch = characters.find((c) => c.id === cid)
            const lookKeys: string[] = ch
              ? [ch.id, ...(ch.looks ?? []).map((lk) => `${ch.id}::${lk.id}`)]
              : [cid]
            const currentImageKey = shot.characterRefs?.[cid] ?? ch?.id ?? cid
            const currentImg = charImages[currentImageKey]?.at(-1)
            return (
              <div
                key={cid}
                className="flex items-center gap-1.5 p-1 rounded border border-border bg-bg-base"
              >
                {/* 当前选中的 look 缩略图 */}
                <div className="shrink-0 w-9 h-9 rounded overflow-hidden bg-bg-elevated border border-border">
                  {currentImg ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={currentImg}
                      alt={ch?.name ?? cid}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[8px] text-text-muted">N/A</div>
                  )}
                </div>
                {/* 角色名 */}
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold text-text-primary truncate">
                    {ch?.name ?? cid}
                  </div>
                  {/* look 切换缩略图条 */}
                  {lookKeys.length > 0 && (
                    <div className="flex gap-0.5 mt-0.5 overflow-x-auto">
                      {lookKeys.map((lk) => {
                        const url = charImages[lk]?.at(-1)
                        if (!url) return null
                        const active = lk === currentImageKey
                        return (
                          <button
                            key={lk}
                            type="button"
                            onClick={() => onSetLook(cid, lk)}
                            className={`shrink-0 w-5 h-5 rounded overflow-hidden border transition ${
                              active ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-accent/60'
                            }`}
                            title={lk === ch?.id ? '默认 look' : `变体 ${lk.split('::')[1] ?? lk}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                {/* 移除按钮 */}
                <button
                  type="button"
                  onClick={() => onRemove(cid)}
                  className="shrink-0 p-1 rounded text-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition"
                  title={`把 ${ch?.name ?? cid} 从本镜头移除(不影响 group 其他镜头)`}
                >
                  <X size={11} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      {addable.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] text-text-muted mb-1">从 group 加角色</div>
          <div className="flex flex-wrap gap-1">
            {addable.map((cid) => {
              const ch = characters.find((c) => c.id === cid)
              return (
                <button
                  key={cid}
                  type="button"
                  onClick={() => onAdd(cid)}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-dashed border-border text-[10px] text-text-secondary hover:border-accent hover:text-accent hover:bg-accent-dim/30 transition"
                  title={`点击把 ${ch?.name ?? cid} 加入本镜头`}
                >
                  <Plus size={9} /> {ch?.name ?? cid}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 2026/06:ShotSceneEditor —— 分镜场景选择器。
 * shot.sceneId 优先级 > group.sceneId。用户可:
 *   - 选另一个场景(切换)
 *   - 选"无场景"(空镜 / 抽象镜头)
 *   - 恢复默认(= group.sceneId,清掉 shot.sceneId)
 */
function ShotSceneEditor({
  group,
  shot,
  scenes,
  onSet,
  onReset,
}: {
  group: StoryboardGroup
  shot: StoryboardShot
  scenes: GenScene[]
  onSet: (sceneId: string | null) => void
  onReset: () => void
}) {
  const isOverridden = shot.sceneId !== undefined
  return (
    <div className="pt-2 border-t border-border/40">
      <div className="flex items-center justify-between mt-2">
        <div className="text-[10px] uppercase tracking-wide text-text-muted">本镜头场景</div>
        {isOverridden && (
          <button
            type="button"
            onClick={onReset}
            className="text-[9px] text-text-muted hover:text-accent underline-offset-2 hover:underline"
            title="清空 shot.sceneId,恢复 group 默认"
          >
            恢复 group 默认
          </button>
        )}
      </div>
      {scenes.length === 0 ? (
        <div className="text-[10px] text-text-muted mt-1 italic">项目还没有场景</div>
      ) : (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {scenes.map((s) => {
            const active = (shot.sceneId === undefined && group.sceneId === s.id)
              || shot.sceneId === s.id
            const label = s.location || s.slug || s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSet(s.id)}
                className={`px-1.5 py-0.5 rounded text-[10px] transition ${
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'border border-border text-text-secondary hover:border-accent hover:text-accent'
                }`}
                title={s.slug}
              >
                {label.slice(0, 12)}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => onSet(null)}
            className={`px-1.5 py-0.5 rounded text-[10px] transition ${
              shot.sceneId === null
                ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                : 'border border-dashed border-border text-text-muted hover:border-rose-500 hover:text-rose-400'
            }`}
            title="显式设置本镜头不带场景(空镜 / 抽象镜头)"
          >
            无场景
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * 2026/06:Module-level helpers(原在 WorkspacePage 内部 closure 里,导致 module-level
 * 组件 ShotMembershipEditor / ShotSceneEditor 拿不到,运行时直接报
 * ReferenceError: pickShotCharacterIds is not defined)。
 *
 * 这俩函数是 (shot, group) → string[] / string|null|undefined 的纯函数,无 state / hook,
 * 提到 module 级零副作用,所有 caller(WorkspacePage 内部 + ShotMembershipEditor
 * 这些 module-level 组件)都还能访问。
 */

/**
 * 取得该 shot 实际生效的角色 id 列表。
 *   - shot.characterIds 显式设值(非 undefined)→ 用 shot 的
 *   - shot.characterIds === undefined → fallback 到 group.characterIds
 *
 * 显式设 [] (空数组)→ 该 shot 不带任何角色(纯场景/空镜)。
 */
function pickShotCharacterIds(shot: StoryboardShot | undefined, group: StoryboardGroup | undefined): string[] {
  if (shot?.characterIds !== undefined) return shot.characterIds
  return group?.characterIds ?? []
}

/**
 * 取得该 shot 实际生效的场景 id。
 *   - shot.sceneId === null   → 显式无场景,返回 null
 *   - shot.sceneId === string → 用 shot 的
 *   - shot.sceneId === undefined → fallback 到 group.sceneId
 */
function pickShotSceneId(shot: StoryboardShot | undefined, group: StoryboardGroup | undefined): string | null | undefined {
  if (shot?.sceneId !== undefined) return shot.sceneId  // string | null 都被尊重
  return group?.sceneId
}

/** 重新编号所有分镜组 index，按当前数组顺序 */
function reindexGroups(groups: StoryboardGroup[]): StoryboardGroup[] {
  return groups.map((g, i) => ({ ...g, index: i + 1 }))
}

/** 创建一个空的 StoryboardGroup（含一个默认空 shot） */
function createEmptyGroup(episodeIndex: number): StoryboardGroup {
  const id = crypto.randomUUID()
  return {
    episodeIndex,
    id,
    index: 1, // 调用方 reindexGroups 后会覆盖
    plotText: '',
    startSec: 0,
    endSec: 5,
    characterIds: [],
    shots: [
      {
        id: crypto.randomUUID(),
        shotType: 'MS',
        shotTypeLabel: '中景',
        action: '',
        camera: '',
      },
    ],
  }
}

/**
 * 2026/06:GroupMembershipEditor —— 分镜组层级的"+ 加角色"按钮 + addable 下拉。
 *
 * 注意:这里**不**渲染当前的角色 chip 行 —— chip 行(含 look-switcher 逻辑)
 * 由父级在 5356-5450 那个位置渲染,这样能复用现有 look-menu 状态(openLookMenu)。
 * 本组件只暴露"添加"入口;移除走父级 chip 上的 × 按钮。
 *
 * addable 范围:data.characters 过滤
 *   c.episodes.includes(group.episodeIndex)  // 本集
 *   && !group.characterIds.includes(c.id)   // 未加入
 *
 * onClick 必须 stopPropagation:父级容器有"点非 look-menu 区关闭 dropdown"
 * 的全局 handler,不 stop 会让刚加的角色立即被关掉(实际是 + 按钮本身的 dropdown
 * 被关掉,不影响数据,但视觉上会闪烁)。
 */
function GroupMembershipEditor({
  group,
  characters,
  onAdd,
}: {
  group: StoryboardGroup
  characters: GenCharacter[]
  onAdd: (characterId: string) => void
}) {
  const [addOpen, setAddOpen] = useState(false)
  const addable = characters
    .filter((c) => c.episodes.includes(group.episodeIndex))
    .filter((c) => !group.characterIds.includes(c.id))
  return (
    <div className="relative inline-block">
      <button
        type="button"
        // 不 stopPropagation:让点击冒泡到父级 look-menu close handler,
        // 自动关掉可能还开着的 look 菜单,避免两个 popover 同时浮着。
        onClick={() => setAddOpen((v) => !v)}
        disabled={addable.length === 0}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-dashed border-border text-[10px] text-text-secondary hover:border-accent hover:text-accent hover:bg-accent-dim/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
        title={addable.length === 0 ? '本集角色已全部加入' : '从本集角色库挑选一个加进来'}
      >
        <Plus size={9} /> 加角色
      </button>
      {addOpen && addable.length > 0 && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute z-30 left-0 top-full mt-1 min-w-[200px] max-h-[260px] overflow-y-auto rounded-lg border border-border bg-bg-surface shadow-xl py-1"
        >
          {addable.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onAdd(c.id); setAddOpen(false) }}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-bg-elevated text-text-primary transition"
              title={`加入 ${c.name}`}
            >
              <Plus size={11} className="text-accent shrink-0" />
              <span className="flex-1 truncate">{c.name}</span>
              {c.roleLabel && <span className="text-[9px] text-text-muted shrink-0">{c.roleLabel}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 2026/06:GroupPropEditor —— 分镜组层级的道具选择器。
 * 与 GroupMembershipEditor 对称:虚线"+ 加道具"按钮 + 下拉列表。
 */
function GroupPropEditor({
  group,
  props,
  onAdd,
}: {
  group: StoryboardGroup
  props: GenProp[]
  onAdd: (propId: string) => void
}) {
  const [addOpen, setAddOpen] = useState(false)
  const addable = props
    .filter((p) => p.episodeIndex === group.episodeIndex)
    .filter((p) => !(group.propIds ?? []).includes(p.id))
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setAddOpen((v) => !v)}
        disabled={addable.length === 0}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-dashed border-border text-[10px] text-text-secondary hover:border-accent hover:text-accent hover:bg-accent-dim/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
        title={addable.length === 0 ? '本集道具已全部加入' : '从本集道具库挑选一个加进来'}
      >
        <Plus size={9} /> 加道具
      </button>
      {addOpen && addable.length > 0 && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute z-30 left-0 top-full mt-1 min-w-[180px] max-h-[260px] overflow-y-auto rounded-lg border border-border bg-bg-surface shadow-xl py-1"
        >
          {addable.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onAdd(p.id); setAddOpen(false) }}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-bg-elevated text-text-primary transition"
              title={`加入 ${p.name}`}
            >
              <Plus size={11} className="text-accent shrink-0" />
              <span className="flex-1 truncate">{p.name}</span>
              {p.description && <span className="text-[9px] text-text-muted truncate max-w-[80px]">{p.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 2026/06:GroupSceneEditor —— 分镜组层级的场景选择器(多选 chip 模式)。
 * 与 GroupMembershipEditor 对称:已选场景显示为 chip + × 移除,
 * "+ 加场景"按钮展开下拉列出本集可添加的场景。
 */
function GroupSceneEditor({
  group,
  scenes,
  onAdd,
  onRemove,
}: {
  group: StoryboardGroup
  scenes: GenScene[]
  onAdd: (sceneId: string) => void
  onRemove: (sceneId: string) => void
}) {
  const [addOpen, setAddOpen] = useState(false)
  const epScenes = scenes.filter((s) => s.episodeIndex === group.episodeIndex)
  const addable = epScenes.filter((s) => !(group.sceneIds ?? []).includes(s.id))
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setAddOpen((v) => !v)}
        disabled={addable.length === 0}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-dashed border-border text-[10px] text-text-secondary hover:border-accent hover:text-accent hover:bg-accent-dim/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
        title={addable.length === 0 ? '本集场景已全部加入' : '从本集场景库挑选一个加进来'}
      >
        <Plus size={9} /> 加场景
      </button>
      {addOpen && addable.length > 0 && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute z-30 left-0 top-full mt-1 min-w-[180px] max-h-[260px] overflow-y-auto rounded-lg border border-border bg-bg-surface shadow-xl py-1"
        >
          {addable.map((s) => {
            const label = s.location || s.slug || s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => { onAdd(s.id); setAddOpen(false) }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-bg-elevated text-text-primary transition"
                title={`加入 ${label}`}
              >
                <Plus size={11} className="text-accent shrink-0" />
                <span className="flex-1 truncate">{label}</span>
                <span className="text-[9px] text-text-muted">{s.timeOfDay}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function WorkspacePage() {
  const { t } = useLanguage()
  const { user } = useAuth()
  const [tab, setTab] = useState<WorkspaceTab>('canvas')
  const chatPanelRef = useRef<ZopiaChatPanelHandle>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [data, setData] = useState<WorkspaceData>(emptyData)
  const [flash, setFlash] = useState<WorkspaceTab | null>(null)
  // 预览态:记录角色 + 当前选中的 look(null 表示默认)。每个 look 是独立卡片,
  // 预览时也要展示对应 look 的图和服装描述。
  const [previewTarget, setPreviewTarget] = useState<{ character: GenCharacter; lookId: string | null } | null>(null)
  // 预览内"按意见重生"流程的本地状态(不持久化,关闭预览即清空)。
  //   selectedGenIdx: 当前看的是该 look 的第几代(0..history.length-1)
  //   regenInput: 用户输入的修改意见
  //   regenBusy: 正在调用 regenerateCharacterLook
  const [selectedGenIdx, setSelectedGenIdx] = useState(0)
  const [regenInput, setRegenInput] = useState('')
  const [regenBusy, setRegenBusy] = useState(false)

  // 右侧"修改形象"slide-in 面板:点卡片上的"修改"按钮打开,
  // 输入修改意见 → 发送 → 关闭面板,新图替换卡片封面(并加入历史)。
  //   modPanel: 当前要修改的 (角色, look);null 表示面板关闭
  //   modInput: 文本框
  //   modBusy: 正在调用 regenerateCharacterLook
  //   modError: 上次错误(显示在面板里)
  const [modPanel, setModPanel] = useState<
    | { character: GenCharacter; lookId: string | null; imageKey: string }
    | null
  >(null)
  // 2026/06:plot 下方圆圈点击弹出的"选形象下拉"打开状态。
  // key = `${groupId}::${characterId}`,null = 全部关闭
  const [openLookMenu, setOpenLookMenu] = useState<string | null>(null)
  const [modInput, setModInput] = useState('')
  const [modBusy, setModBusy] = useState(false)
  const [modError, setModError] = useState<string | null>(null)
  // 场景修改输入弹层(2026/06 跟角色修改对齐体验:打开直接输入,Enter 提交)。
  // 跟 modPanel 解耦:角色 modPanel 走的是"打开预览 + 内嵌输入",场景没
  // selectedGenIdx / 多图 history 概念,只需要"打开输入弹层"即可,不需要
  // 整个预览模态框。功能上跟角色对齐,实现上各走各的 state。
  const [sceneModOpen, setSceneModOpen] = useState<GenScene | null>(null)
  const [sceneModInput, setSceneModInput] = useState('')
  const [sceneModBusy, setSceneModBusy] = useState(false)
  const [sceneModError, setSceneModError] = useState<string | null>(null)
  // 2026/06:场景卡片点击放大(lightbox)用的 state。点卡片设上,关闭置空。
  // 比角色卡那个复杂的三栏 preview modal 简单 —— 用户明确说"点击后放大那种",
  // 就是大图 + 描述,不是完整的编辑面板(编辑输入已由底部「编辑」按钮触发)。
  const [scenePreview, setScenePreview] = useState<GenScene | null>(null)
  // 2026/06:道具的 state —— 与场景对称
  const [propImages, setPropImages] = useState<Record<string, string[]>>({})
  const propImagesRef = useRef<Record<string, string[]>>({})
  const updatePropImages = (updater: (m: Record<string, string[]>) => Record<string, string[]>) => {
    const next = updater(propImagesRef.current)
    propImagesRef.current = next
    setPropImages(next)
  }
  useEffect(() => { propImagesRef.current = propImages }, [propImages])
  const [selectedPropImages, setSelectedPropImages] = useState<Record<string, string | null>>({})
  const selectedPropImagesRef = useRef(selectedPropImages)
  useEffect(() => { selectedPropImagesRef.current = selectedPropImages }, [selectedPropImages])
  const [busyProp, setBusyProp] = useState<string | null>(null)
  const [propPreview, setPropPreview] = useState<GenProp | null>(null)
  const [propModOpen, setPropModOpen] = useState<GenProp | null>(null)
  const [propModInput, setPropModInput] = useState('')
  const [propModBusy, setPropModBusy] = useState(false)
  const [propModError, setPropModError] = useState<string | null>(null)
  const callAi = useServerFn(generateStageAi)
  const callImage = useServerFn(generateImage)
  const callUpsertProject = useServerFn(upsertProject)
  const callRegenCharacter = useServerFn(regenerateCharacterLook)
  const callDescribeCharImg = useServerFn(describeCharacterImage)
  const callRegenScene = useServerFn(regenerateSceneImage)
  const callGenerateStoryboard = useServerFn(generateStoryboardFromPlot)
  const callGenerateShotImage = useServerFn(generateStoryboardShotImage)
  const callRegenShot = useServerFn(regenerateStoryboardShot)
  const callGenVideo = useServerFn(generateVideo)
  const callGenStoryboard = useServerFn(generateStoryboardPitchDeck)
  const callRegenStoryboard = useServerFn(regenerateStoryboardPitchDeck)
  const callUploadImage = useServerFn(uploadLocalImage)
  const callUrlToBase64 = useServerFn(serverUrlToBase64)
  /** 带服务端兜底的 base64 转换:浏览器 fetch 失败时走服务端中转 */
  const toBase64WithFallback = useCallback(
    (url: string) => urlToBase64(url, (u) => callUrlToBase64({ data: { url: u } })),
    [callUrlToBase64],
  )
  const callSynopsis = useServerFn(streamSynopsis)
  const callEpisode = useServerFn(streamEpisodeScenes)
  const callRefine = useServerFn(refineSynopsis)
  const callRefineEpisode = useServerFn(refineEpisodeScenes)
  const loadProject = useServerFn(getProject)
  const callSaveWorkspace = useServerFn(saveWorkspaceData)
  const callLoadWorkspace = useServerFn(loadWorkspaceData)
  const callPersistMedia = useServerFn(persistWorkspaceMedia)
  const callPersistAsset = useServerFn(persistAssetImage)
  const callSaveOneStoryboard = useServerFn(saveOneStoryboard)
  const callSaveOneVideo = useServerFn(saveOneVideo)
  const [project, setProject] = useState<ProjectConfigRow | null>(null)
  const [savingWorkspace, setSavingWorkspace] = useState(false)
  const [savedWorkspace, setSavedWorkspace] = useState(false)
  const [dataLoaded, setDataLoaded] = useState(false)
  const autoSavedRef = useRef(false)
  const [charImages, setCharImages] = useState<Record<string, string[]>>({})
  // charImages 的镜像 ref:processCharacter 内部循环里要"看最新"以跳过已
  // 生成的图。React state 闭包是快照,useRef 才是实时的。
  // 2026/06 关键修复:useEffect 镜像有 race condition(下一个 processCharacter 跑时
  // 还没同步),所以也通过 updateCharImages 在 setCharImages 调用处同步写 ref。
  const charImagesRef = useRef<Record<string, string[]>>({})

  /**
   * 2026/06:替换 setCharImages,确保 state + ref 同步更新。
   *
   * 修法核心:不能把 ref 写操作放进 setState 的 updater 函数里 —— React
   * 是异步调用 updater 的(commit 时才跑),下一个 processCharacter 同步
   * 触发时 ref 还没更新。
   *
   * 正确做法:直接读 ref 当下值 → 算 next → 同步写 ref → 再 setState(只
   * 负责触发 re-render)。这样 ref 是同步的,state 和 ref 始终一致。
   */
  const updateCharImages = (updater: (m: Record<string, string[]>) => Record<string, string[]>) => {
    // 1) 同步算 + 写 ref(IIFE 链上的下个 processCharacter 立即可见)
    const next = updater(charImagesRef.current)
    charImagesRef.current = next
    // 2) 触发 re-render(把 ref 的当前值推给 state,React 不再二次调用 updater)
    setCharImages(next)
  }
  useEffect(() => { charImagesRef.current = charImages }, [charImages])

  /** 服务端持久化(下载临时 URL → 上传 Storage → 永久 URL) */
  async function persistAndSetImage(
    imageKey: string,
    tempUrl: string,
    kind: 'character' | 'scene' | 'prop',
    id: string,
    mode: 'overwrite' | 'append' = 'overwrite',
  ) {
    if (isPersistedUrl(tempUrl)) {
      if (mode === 'append') {
        updateCharImages((m) => ({ ...m, [imageKey]: [...(m[imageKey] ?? []), tempUrl] }))
      } else {
        updateCharImages((m) => ({ ...m, [imageKey]: [tempUrl] }))
      }
      return { ok: true as const, url: tempUrl }
    }
    if (user) {
      try {
        const r = await callPersistAsset({ data: { url: tempUrl, userId: user.id, kind, id } })
        if (r.ok && r.url) {
          if (mode === 'append') {
            updateCharImages((m) => ({ ...m, [imageKey]: [...(m[imageKey] ?? []), r.url] }))
          } else {
            updateCharImages((m) => ({ ...m, [imageKey]: [r.url] }))
          }
          return { ok: true as const, url: r.url }
        }
        console.warn('[persist] persistAssetImage failed:', r.error)
      } catch { /* 持久化失败 */ }
    }
    // 没有 base64 兜底,直接保留临时 URL(浏览器 CORS 可能拦截显示,但保存后 autoGen 跳过)
    if (mode === 'append') {
      updateCharImages((m) => ({ ...m, [imageKey]: [...(m[imageKey] ?? []), tempUrl] }))
    } else {
      updateCharImages((m) => ({ ...m, [imageKey]: [tempUrl] }))
    }
    return { ok: false as const, url: tempUrl }
  }

  /** 服务端持久化场景图片 */
  async function persistSceneImage(s: GenScene, tempUrl: string) {
    if (isPersistedUrl(tempUrl)) {
      setSceneImages((m) => ({ ...m, [s.id]: [...(m[s.id] ?? []), tempUrl] }))
      return { ok: true as const, url: tempUrl }
    }
    if (user) {
      try {
        const r = await callPersistAsset({ data: { url: tempUrl, userId: user.id, kind: 'scene', id: s.id } })
        if (r.ok && r.url) {
          setSceneImages((m) => ({ ...m, [s.id]: [...(m[s.id] ?? []), r.url] }))
          return { ok: true as const, url: r.url }
        }
      } catch { /* 持久化失败 */ }
    }
    setSceneImages((m) => ({ ...m, [s.id]: [...(m[s.id] ?? []), tempUrl] }))
    return { ok: false as const, url: tempUrl }
  }

  /** 服务端持久化道具图片 */
  async function persistPropImage(p: GenProp, tempUrl: string) {
    if (isPersistedUrl(tempUrl)) {
      setPropImages((m) => ({ ...m, [p.id]: [...(m[p.id] ?? []), tempUrl] }))
      return { ok: true as const, url: tempUrl }
    }
    if (user) {
      try {
        const r = await callPersistAsset({ data: { url: tempUrl, userId: user.id, kind: 'prop', id: p.id } })
        if (r.ok && r.url) {
          setPropImages((m) => ({ ...m, [p.id]: [...(m[p.id] ?? []), r.url] }))
          return { ok: true as const, url: r.url }
        }
      } catch { /* 持久化失败 */ }
    }
    setPropImages((m) => ({ ...m, [p.id]: [...(m[p.id] ?? []), tempUrl] }))
    return { ok: false as const, url: tempUrl }
  }
  // processCharacter 入口 ref 守卫(2026/06):防止 useEffect 多次触发
  // 同一角色并发跑 processCharacter。state 的 busyChars 已经做了同样防御,
  // 但 ref 更可靠(不会因 React batching 漏掉)。
  const processCharacterInFlightRef = useRef<Set<string>>(new Set())
  // 2026/06:autoGen 已处理过的角色 id 集合(无视 charImages 状态)。
  // 目的:老图已持久化在 supabase 时,useEffect 触发仍能跑 processCharacter
  // 重新覆盖默认 look(用户期望"第一次进入要自动生成");同时防止 enrich
  // 内部 setData 引起的 useEffect 重跑老角色。
  const autogenRanRef = useRef<Set<string>>(new Set())
  const [panelImages, setPanelImages] = useState<Record<string, string>>({})
  const [sceneImages, setSceneImages] = useState<Record<string, string[]>>({})
  const sceneImagesRef = useRef<Record<string, string[]>>({})
  const updateSceneImages = (updater: (m: Record<string, string[]>) => Record<string, string[]>) => {
    const next = updater(sceneImagesRef.current)
    sceneImagesRef.current = next
    setSceneImages(next)
  }
  useEffect(() => { sceneImagesRef.current = sceneImages }, [sceneImages])
  // 2026/06:跟角色 selectedCharImages 对称 —— 用户从历史里"选中"的某张
  // 场景图,作为分镜 / 故事板 / 按意见重生的 reference。
  // - 用 url 而不是 index 引用,避免新增图后被偏移
  // - 没设 → fallback 用 sceneImages[s.id] 的最新一张(.at(-1))
  // - 显式传 `null` 取消选中(回到用最新的逻辑)
  const [selectedSceneImages, setSelectedSceneImages] = useState<Record<string, string | null>>({})
  const selectedSceneImagesRef = useRef<Record<string, string | null>>({})
  useEffect(() => { selectedSceneImagesRef.current = selectedSceneImages }, [selectedSceneImages])

  /**
   * 2026/06:跟角色 pickShotCharImageUrl 对齐的 helper —— 选中的图优先,
   * 没选 / 选中的 url 已不在 history 里 → fallback 最新一张。
   * 用于:场景卡片封面 / 预览 modal / 按意见重生 / 作为分镜/故事板 reference。
   * 返回 string | undefined(没图时 undefined,跟 caller 的现有判断一致)。
   */
  function pickSceneImageUrl(sceneId: string): string | undefined {
    const history = sceneImages[sceneId] ?? []
    const pinned = selectedSceneImagesRef.current[sceneId]
    if (pinned && history.includes(pinned)) return pinned
    return history.at(-1)
  }

  // 2026/06:把生成的图片自动入库。
  // 监听 charImages / sceneImages 变化,每个 entry 的最后一张 URL 自动
  // upsert 到 characters.cover_url / scenes.cover_url。原先 saveAssets()
  // 只写文字字段(cover_url=null),用户得点"新对话" / "保存到资产库"才会
  // 触发,而且图片压根没进去 —— 现在改为"图稳定就入库"。
  //
  // 三个保证:
  //   1) 不重复写 —— lastAutoSavedUrlRef[key] 缓存上次成功写入的 URL,
  //      同一 URL 触发不了二次写。
  //   2) 失败可重试 —— 写库失败时,只有当 ref 仍指向我们刚设的 URL(没
  //      有更新的写入覆盖)才回滚,下次 URL 变化时再试。
  //   3) 不阻塞 UI —— 写库是 fire-and-forget,toast/console 仅在失败时打。
  //
  // 注意:同一个 character 的多个 look(如 ${c.id}::${look.id})共享
  // characters 表的 cover_url 字段,后写的覆盖先写的。这是 schema 限制,
  // 不是这个 effect 的 bug —— 想精确每个 look 各一张图,得加独立的
  // character_images 表。
  // 2026/06:自动持久化不再需要了 —— 每个生成点都同步 await persistAssetImage。
  // 保留这个 effect 仅做兜底:万一有 URL 没经过生成流程(比如旧数据迁移上来
  // 的)导致 charImages 里还有临时 URL,仍然尝试入库。
  const lastAutoSavedUrlRef = useRef<Record<string, string | undefined>>({})
  useEffect(() => {
    if (!user) return
    // 只处理没有 savedAssetKeys 标记的旧 URL(兜底)
    const tryAutoSave = (
      key: string,
      latestUrl: string,
      save: () => Promise<{ ok: boolean; error?: string }>,
      label: string,
    ) => {
      if (lastAutoSavedUrlRef.current[key] === latestUrl) return
      const previous = lastAutoSavedUrlRef.current[key]
      lastAutoSavedUrlRef.current[key] = latestUrl
      void save().then((r) => {
        if (r.ok) {
          setSavedAssetKeys((prev) => new Set(prev).add(key))
          return
        }
        if (lastAutoSavedUrlRef.current[key] === latestUrl) {
          if (previous === undefined) delete lastAutoSavedUrlRef.current[key]
          else lastAutoSavedUrlRef.current[key] = previous
        }
        console.warn(`自动入库 ${label} 失败:`, r.error)
        const userMsg = classifyError(r.error, '')
        if (userMsg) {
          // toast.warning(`「${label}」${userMsg}，临时链接 24h 内有效`)
        } else {
          // toast.warning(`「${label}」图片未持久化到存储，临时链接 24h 内有效`)
        }
      })
    }
    data.characters.forEach((c) => {
      if (savedAssetKeys.has(c.id)) return // 已成功入库过的跳过
      const latestUrl = charImages[c.id]?.at(-1)
      if (!latestUrl) return
      tryAutoSave(c.id, latestUrl, async () => {
        const base64Url = await toBase64WithFallback(latestUrl)
        const permUrl = base64Url ?? latestUrl
        if (permUrl !== latestUrl) {
          setCharImages((m) => {
            const arr = m[c.id]
            if (!arr || arr.at(-1) !== latestUrl) return m
            const copy = [...arr]
            copy[copy.length - 1] = permUrl
            return { ...m, [c.id]: copy }
          })
        }
        return saveOneCharacter(c, user!.id, permUrl)
      }, `角色 ${c.name}`)
    })
  }, [user])
  // 角色图片生成状态拆分:
  //   activeImageKey: 当前**正在生成**的那一张图(imageKey = c.id 或 c.id::lk.id)。
  //                   用于卡片显示 spinner(只有这一张是"生成中"状态)。
  //   busyChars:      任何"有未完成 work 的"角色 ID 集合。Set 用来支持
  //                   "不同角色并行,同一角色串行":一旦某个角色开始处理,
  //                   加入 Set;处理完所有 looks 后移出 Set。
  //   卡片判定:
  //     activeImageKey === imageKey        → spinner(此刻正在画这张)
  //     busyChars.has(c.id) && !active     → "排队中..."(同角色下一张,或别人正在画)
  //     hasImg                              → 显示图片
  //     其他                                → "点击生成形象" 或 "排队生成中..."
  const [activeImageKey, setActiveImageKey] = useState<string | null>(null)
  const [busyChars, setBusyChars] = useState<Set<string>>(new Set())
  const [busyPanel, setBusyPanel] = useState<string | null>(null)
  const [busyScene, setBusyScene] = useState<string | null>(null)
  // 新的"分镜组"流程:正在生成 StoryboardGroup(整集切分)的标识
  const [busyStoryboardGen, setBusyStoryboardGen] = useState(false)
  // 2026/06:查看提示词模式 —— 开启后所有生成按钮触发后只展示 prompt 不实际生成。
  // viewPromptsModeRef 镜像给 async 回调用,避免捕获到过期 state
  const [viewPromptsMode, setViewPromptsMode] = useState(false)
  const viewPromptsModeRef = useRef(false)
  useEffect(() => { viewPromptsModeRef.current = viewPromptsMode }, [viewPromptsMode])
  const [promptPreview, setPromptPreview] = useState<{
    title: string
    prompt: string
    negative?: string
    size?: string
    extra?: Record<string, string>  // 比如 model / imageUrls / referenceCount 之类
  } | null>(null)
  /**
   * 2026/06:统一的"预览模式拦截器"。所有生成路径在 await server fn 后调一次:
   *   - 如果开了 viewPromptsMode,**且** 响应里带 previewPrompt(server 端尊重了
   *     previewOnly 参数),弹 modal 展示 prompt,返回 true(告诉调用方"已拦截,
   *     别走 normal flow")
   *   - 否则什么都不做,返回 false,调用方继续正常处理结果
   *
   * 这样每个生成路径只需一行 if (interceptPromptPreview(...)) return / continue
   */
  function interceptPromptPreview(
    title: string,
    res: unknown,
  ): boolean {
    if (!res || typeof res !== 'object') return false
    const r = res as { previewPrompt?: string; negativePrompt?: string; promptSize?: string; promptExtra?: Record<string, string> }
    if (!r.previewPrompt) return false
    setPromptPreview({
      title,
      prompt: r.previewPrompt,
      negative: r.negativePrompt,
      size: r.promptSize,
      extra: r.promptExtra,
    })
    return true
  }
  // 正在跑"对某个分镜组的某张分镜图做多图融合"的 key,格式 `${groupId}::${shotId}`
  const [busyShotImages, setBusyShotImages] = useState<Set<string>>(new Set())
  // I2I 重生(按意见重生 / 三视图 / 多维资产)正在跑的卡片 imageKey → mode 映射。
  // 跟 activeImageKey(T2I 通道)是两套独立的状态,因为它们发生在不同时间窗口:
  //   T2I:首张图还没出,用户进不去 regen
  //   I2I:首张图已出,用户点三视图/多维资产/修改
  // 在 regen 期间给对应卡片加黑屏遮罩(spinner + "正在生成三视图" 等),
  // 防止用户重复点 / 让进度可感知。value 存 mode 用来显示对应的提示文字。
  const [regenBusyKeys, setRegenBusyKeys] = useState<Map<string, 'modify' | 'three-view' | 'multi-asset'>>(new Map())
  // 用户在角色卡片右上角点"选中"后,该 look(imageKey)被钉住指向哪张 url。
  // 用 url 而不是 index 引用,避免新增图后被偏移。
  // 没设 → fallback 用 charImages[imageKey] 的最新一张(.at(-1))
  const [selectedCharImages, setSelectedCharImages] = useState<Record<string, string | null>>({})
  // ref 镜像 —— doRegen 在 event handler / await 后访问,用 ref 避免闭包过期
  const selectedCharImagesRef = useRef<Record<string, string | null>>({})
  useEffect(() => { selectedCharImagesRef.current = selectedCharImages }, [selectedCharImages])
  const [autoGen, setAutoGen] = useState(true)
  void setAutoGen
  // 流式剧本生成状态
  const [synopsisText, setSynopsisText] = useState('')
  const [synopsisDraft, setSynopsisDraft] = useState('')
  const [synopsisEditing, setSynopsisEditing] = useState(false)
  const synopsisEditRef = useRef<HTMLTextAreaElement>(null)
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<number>>(new Set([1]))
  const [episodeEditing, setEpisodeEditing] = useState<number | null>(null)
  const [episodeDraft, setEpisodeDraft] = useState('')
  // 2026/06:分镜组 plotText 行内编辑(跟 synopsis / episode 同模式,Pencil→textarea→Check)。
  // 用 Record 存每个 group 的 draft(只一个 group 同时处于编辑态,editingGroupId 决定)。
  // runEnterStoryboard 重置 storyboardGroups 时会清空这两个 state,避免旧 id 的 draft 残留。
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [groupPlotDraft, setGroupPlotDraft] = useState<Record<string, string>>({})
  const episodeEditRef = useRef<HTMLTextAreaElement>(null)
  const [synopsisStreaming, setSynopsisStreaming] = useState(false)
  const [episodeStreaming, setEpisodeStreaming] = useState(false)
  const [synopsisBubbles, setSynopsisBubbles] = useState<{ id: string; text: string }[]>([])
  const [episodeBubbles, setEpisodeBubbles] = useState<{ id: string; text: string }[]>([])
  const synopsisPendingRef = useRef<Map<string, { buf: string; done: boolean }>>(new Map())
  const synopsisFlushRef = useRef<number | null>(null)
  const episodePendingRef = useRef<Map<string, { buf: string; done: boolean }>>(new Map())
  const episodeFlushRef = useRef<number | null>(null)
  const [streamingBubbleId, setStreamingBubbleId] = useState<string | null>(null)
  const episodeRefs = useRef<Record<number, HTMLDetailsElement | null>>({})
  const episodeCardRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const shownAutoCompleteToastRef = useRef(false)
  const autoRunTargetRef = useRef<number | null>(null)
  const [autoRunCompleteTarget, setAutoRunCompleteTarget] = useState<number | null>(null)
  const [selectedEpisodeIndex, setSelectedEpisodeIndex] = useState<number>(1)
  const [charViewTab, setCharViewTab] = useState<'characters' | 'scenes' | 'props'>('characters')
  // 顶部下拉「+ 新增集数」触发的对话框。AI 生成 / 导入剧本 两条路径都走这里。
  const [addEpisodeOpen, setAddEpisodeOpen] = useState(false)
  const [addEpisodeImporting, setAddEpisodeImporting] = useState(false)
  const addEpisodeFileInputRef = useRef<HTMLInputElement>(null)
  // 分镜图历史 + 预览/修改态(和人物卡片同一套思路)
  //   - shotImages:key = `${groupId}::${shotId}`,value 是按时间顺序的 URL 数组
  //     (首先生成的在最前,最新生成的或按意见重生的在末尾)。
  //   - shotPreview:当前正在预览哪张镜头(null = 关闭)。
  //   - shotSelectedGenIdx:预览里选中的第几代(和 selectedGenIdx 同语义)。
  //   - shotModInput / shotModBusy:修改意见的输入 + 是否在调 regenerateStoryboardShot。
  const [shotImages, setShotImages] = useState<Record<string, string[]>>({})
  // 2026/06:分镜图加载失败的 key 集合(`${groupId}::${shotId}`)。
  //   - Seedream / Pixflow 返回的 url 偶尔会失效(签名 24h 过期 / 浏览器侧 DNS
  //     不通 / 上游 bucket 临时 403 等)。state 里 imageUrl 还在,但 <img>
  //     渲染会 broken。
  //   - 用于 allShotsHaveImage、按钮文案、按钮 disabled 状态:
  //     "已生成" 这个 badge 不应该出现在图片实际打不开的镜头上。
  //   - 不持久化:刷新页面图片会重新尝试加载。
  const [brokenShotImages, setBrokenShotImages] = useState<Set<string>>(new Set())
  const markShotImageBroken = useCallback((key: string) => {
    setBrokenShotImages((s) => {
      if (s.has(key)) return s
      const next = new Set(s)
      next.add(key)
      return next
    })
  }, [])
  const clearShotImageBroken = useCallback((key: string) => {
    setBrokenShotImages((s) => {
      if (!s.has(key)) return s
      const next = new Set(s)
      next.delete(key)
      return next
    })
  }, [])
  // 2026/06:角色图加载失败的 imageKey 集合。
  // 与 brokenShotImages 对称，当角色图片 URL 过期/403 时标记 broken。
  // 注意:只有**已持久化的 Supabase 永久 URL** 加载失败才标记为 broken；
  //      Seedream 临时 URL 加载失败只是静默隐藏(不显示"已失效")，
  //      因为临时 URL 可能因 CORS/签名校验短暂失败，等自动持久化完成后会被替换。
  const [brokenCharImages, setBrokenCharImages] = useState<Set<string>>(new Set())
  const markCharImageBroken = useCallback((key: string, url: string) => {
    // 只有已持久化的 Supabase 永久 URL 加载失败才标记为"已失效"
    if (!isPersistedUrl(url)) return
    setBrokenCharImages((s) => {
      if (s.has(key)) return s
      const next = new Set(s)
      next.add(key)
      return next
    })
  }, [])
  const clearCharImageBroken = useCallback((key: string) => {
    setBrokenCharImages((s) => {
      if (!s.has(key)) return s
      const next = new Set(s)
      next.delete(key)
      return next
    })
  }, [])
  // 判断 URL 是否已持久化(Supabase Storage 永久 URL 或 base64 data URL)
  const isPersistedUrl = useCallback((url: string | undefined | null): boolean => {
    if (!url) return false
    // base64 视为已持久化(存在内存 state 中,显示用,但保存时会被过滤)
    if (url.startsWith('data:')) return true
    try {
      const u = new URL(url)
      const host = u.hostname.toLowerCase()
      if (host.endsWith('.supabase.co') && u.pathname.includes('/object/public/workspace-media/')) return true
      if (u.pathname.includes('/storage/v1/object/public/workspace-media/')) return true
      if (u.pathname.includes('/object/public/workspace-media/')) return true
      // 签名 URL
      if (u.pathname.includes('/storage/v1/object/sign/workspace-media/')) return true
      return false
    } catch { return false }
  }, [])
  // 错误消息分类:根据 error string 返回用户可读的中文提示
  const classifyError = useCallback((error: string | null | undefined, fallback: string): string => {
    if (!error) return fallback
    const e = error.toLowerCase()
    if (e.includes('timed out') || e.includes('timeout') || e.includes('超时')) return 'AI 处理超时，请重试'
    if (e.includes('401') || e.includes('auth') || e.includes('unauthorized') || e.includes('认证失败')) return 'AI 认证失败，请联系管理员'
    if (e.includes('402') || e.includes('no_credits') || e.includes('credits') || e.includes('insufficient') || e.includes('额度')) return 'AI 额度不足，请充值'
    if (e.includes('429') || e.includes('rate limit') || e.includes('too many requests')) return '请求过于频繁，请稍后重试'
    if (e.includes('upload failed')) return `存储上传失败: ${error}`
    if (e.includes('upstream fetch') || e.includes('fetch failed') || e.includes('无法获取')) return '图片源已失效，无法转存到存储'
    if (e.includes('not found') || e.includes('404')) return '图片链接不存在(404)'
    // 截断过长错误信息(超过 60 字符截断)
    if (error.length > 60) return `${error.slice(0, 57)}...`
    return error
  }, [])
  // 2026 视频生成:每个 storyboard group 一条短视频,key = groupId。
  // 视频用整组所有 shot 的图作 first_frame + reference_image,
  // 涵盖整个分镜组的镜头序列(不再每张分镜单独出视频)。
  // 不持久化(视频 URL 24h 有效)。
  const [groupVideos, setGroupVideos] = useState<Record<string, { url: string; status: 'running' | 'succeeded' | 'failed' }>>({})
  // 2026 Storyboard 接入:每个分镜组可以独立生成故事板图(Storyboard),
  // key = groupId。value 包含 storyboardUrl 和 status。不持久化(Seedream URL 24h 有效)。
  const [groupStoryboards, setGroupStoryboards] = useState<Record<string, { url: string; status: 'running' | 'succeeded' | 'failed' }>>({})
  // 2026/06:新建空分镜组的插入位置选择弹窗
  const [showNewGroupModal, setShowNewGroupModal] = useState(false)
  // 2026/06:故事板图加载失败的 groupId 集合。
  // 跟 brokenShotImages 同语义 —— Seedream TOS 24h 过期 / 上游 403 / 浏览器
  // 侧 DNS 不通时,state 里 url 还在,<img> 却 broken。徽章在 URL 真的"过
  // 期/坏"时改成"已过期",跟"已生成"区分开,让用户知道该重新生成或保存入库。
  const [brokenStoryboards, setBrokenStoryboards] = useState<Set<string>>(new Set())
  const markStoryboardBroken = useCallback((gid: string) => {
    setBrokenStoryboards((s) => {
      if (s.has(gid)) return s
      const next = new Set(s)
      next.add(gid)
      return next
    })
  }, [])
  const clearStoryboardBroken = useCallback((gid: string) => {
    setBrokenStoryboards((s) => {
      if (!s.has(gid)) return s
      const next = new Set(s)
      next.delete(gid)
      return next
    })
  }, [])

  // 2026/06:故事板图自动入库 —— 监听 groupStoryboards 变化,每个 succeeded
  // 且未入库的项自动调 saveOneStoryboard,把临时 TOS URL 替换成永久
  // Supabase Storage URL。**根本解决** Seedream TOS URL 24h 过期导致"故事板
  // 图突然打不开 / 显示已过期"的问题 —— 不再依赖用户点「保存」按钮。
  //
  // 行为对齐 character/scene 自动入库(同一个 useEffect 模式):
  //   - dedupeByUrlSet:同 url 已发起的请求会被 dedupe 掉,避免每个组件
  //     重渲染都重新下载上传
  //   - 失败不上 toast(避免每次刷新都刷错误),仅在 dev console 打 warn
  // 放在 brokenStoryboards 之后,确保 groupStoryboards 已经初始化完毕,
  // 避免 TDZ ReferenceError。
  // 2026/06 Storyboard → Timeline 拼接播放:用户在时间轴上可调整 clip 顺序,
  // 顺序仅在会话内有效(视频 URL 本身不持久化,顺序跟着重置即可)。
  const [clipOrder, setClipOrder] = useState<string[]>([])
  // 2026/06:外部触发"进入时间轴流程"对话动画的 signal。
  // 分镜 row header 按钮每点一次 +1,ZopiaChatPanel 收到变化就跑 workflow 动画。
  const [enterTimelineSignal, setEnterTimelineSignal] = useState(0)
  const triggerEnterTimeline = useCallback(() => {
    setEnterTimelineSignal((n) => n + 1)
  }, [])
  // 故事板图放大预览(2026/06 跟分镜图对齐):点图片打开全屏模态。
  // 故事板没有 history 多代概念(每个 group 只 1 张故事板图),模态最简。
  const [storyboardPreview, setStoryboardPreview] = useState<{ groupId: string } | null>(null)
  // 2026/06:故事板图按意见重生的输入 + busy 状态。
  // 跟 shotModInput/shotModBusy 对称,但故事板没有"多代"概念,所以一组只有 1 张。
  const [storyboardModInput, setStoryboardModInput] = useState('')
  const [storyboardModBusy, setStoryboardModBusy] = useState(false)
  const [shotPreview, setShotPreview] = useState<{ groupId: string; shotId: string } | null>(null)
  const [shotSelectedGenIdx, setShotSelectedGenIdx] = useState(0)
  const [shotModInput, setShotModInput] = useState('')
  const [shotModBusy, setShotModBusy] = useState(false)
  const workspaceId = Route.useParams().workspaceId
  useEffect(() => {
    let cancelled = false
    loadProject({ data: { id: workspaceId } })
      .then((r) => { if (!cancelled && r.project) setProject(r.project) })
      .catch(() => {})
    // Load persisted workspace data
    callLoadWorkspace({ data: { id: workspaceId } })
      .then((r: any) => {
        if (cancelled || r.error || !r.workspaceData) return
        const wd = r.workspaceData as Record<string, any>
        if (wd.outline) setData((d) => ({ ...d, outline: wd.outline as WorkspaceData['outline'] }))
        // 兼容旧数据:
        //   - scenes/storyboardGroups 仍单集,episodeIndex 字段保留
        //   - characters 2026/06 改造:episodeIndex(number) → episodes(number[])
        //     老数据没有 episodes 字段 → 转 [c.episodeIndex];matchKey 缺失 → 兜底 = c.id
        //     (老 id 自身就是稳定锚,这样 charImages[id] 全部健在)
        if (Array.isArray(wd.scenes) && wd.scenes.length) {
          const scenes: GenScene[] = (wd.scenes as any[]).map((s) => ({ ...s, episodeIndex: typeof s.episodeIndex === 'number' ? s.episodeIndex : 1 }))
          setData((d) => ({ ...d, scenes }))
        }
        if (Array.isArray(wd.characters) && wd.characters.length) {
          const characters: GenCharacter[] = (wd.characters as any[]).map((c) => {
            const legacyEp = typeof c.episodeIndex === 'number' ? c.episodeIndex : 1
            return {
              ...c,
              episodes: Array.isArray(c.episodes) && c.episodes.length ? c.episodes : [legacyEp],
              matchKey: typeof c.matchKey === 'string' && c.matchKey.trim() ? c.matchKey : c.id,
            }
          })
          setData((d) => ({ ...d, characters }))
        }
        if (Array.isArray(wd.storyboard) && wd.storyboard.length) setData((d) => ({ ...d, storyboard: wd.storyboard as StoryboardPanel[] }))
        if (Array.isArray(wd.storyboardGroups) && wd.storyboardGroups.length) {
          const storyboardGroups: StoryboardGroup[] = (wd.storyboardGroups as any[]).map((g) => ({ ...g, episodeIndex: typeof g.episodeIndex === 'number' ? g.episodeIndex : 1 }))
          setData((d) => ({ ...d, storyboardGroups }))
          // 老数据没有 shotImages 字段 —— 从每个 group.shots[i].imageUrl 一次性回填,
          // 这样旧项目的"分镜图历史"也能在打开预览时看到(至少有 1 张)。
          // 已经被新数据覆盖过(wd.shotImages 存在)的就不动。
          if (!wd.shotImages) {
            const migrated: Record<string, string[]> = {}
            for (const g of storyboardGroups) {
              for (const s of g.shots) {
                if (s.imageUrl) {
                  migrated[`${g.id}::${s.id}`] = [s.imageUrl]
                }
              }
            }
            if (Object.keys(migrated).length) setShotImages(migrated)
          }
        }
        if (wd.timeline) setData((d) => ({ ...d, timeline: wd.timeline as WorkspaceData['timeline'] }))
        if (typeof wd.synopsisText === 'string' && wd.synopsisText) {
          setSynopsisText(wd.synopsisText)
          setSynopsisDraft(wd.synopsisText)
        }
        if (Array.isArray(wd.episodeTexts) && wd.episodeTexts.length) {
          setData((d) => ({ ...d, episodeTexts: wd.episodeTexts as WorkspaceData['episodeTexts'] }))
        }
        if (wd.charImages) setCharImages(wd.charImages as Record<string, string[]>)
        if (wd.shotImages) setShotImages(wd.shotImages as Record<string, string[]>)
        if ((wd as any).selectedCharImages) setSelectedCharImages((wd as any).selectedCharImages as Record<string, string | null>)
        if (wd.panelImages) setPanelImages(wd.panelImages as Record<string, string>)
        if (wd.sceneImages) setSceneImages(wd.sceneImages as Record<string, string[]>)
        if ((wd as any).selectedSceneImages) setSelectedSceneImages((wd as any).selectedSceneImages as Record<string, string | null>)
        if (Array.isArray(wd.props) && wd.props.length) {
          setData((d) => ({ ...d, props: wd.props as GenProp[] }))
        }
        if (wd.propImages) setPropImages(wd.propImages as Record<string, string[]>)
        if ((wd as any).selectedPropImages) setSelectedPropImages((wd as any).selectedPropImages as Record<string, string | null>)
        // 2026/06:跨 session 恢复入库后的永久视频 / 故事板图 URL。
        // 这些字段是老数据没有的(2026/06 前不持久化),所以可选读。
        if (wd.groupVideos && typeof wd.groupVideos === 'object') {
          setGroupVideos(wd.groupVideos as Record<string, { url: string; status: 'running' | 'succeeded' | 'failed' }>)
        }
        if (wd.groupStoryboards && typeof wd.groupStoryboards === 'object') {
          setGroupStoryboards(wd.groupStoryboards as Record<string, { url: string; status: 'running' | 'succeeded' | 'failed' }>)
        }
        // 2026/06:恢复上次选中的集数
        if (typeof wd.selectedEpisodeIndex === 'number') {
          setSelectedEpisodeIndex(wd.selectedEpisodeIndex)
        }
        setDataLoaded(true)
      })
      .catch(() => { setDataLoaded(true) })
    return () => { cancelled = true }
  }, [workspaceId, loadProject, callLoadWorkspace])

  // 2026/06:首页直传剧本模式 —— 用户输入文本作为剧本直接导入
  useEffect(() => {
    if (!dataLoaded) return
    const mode = sessionStorage.getItem('workspace_prefill_mode')
    if (mode !== 'script') return
    const text = sessionStorage.getItem('workspace_prefill')
    sessionStorage.removeItem('workspace_prefill')
    sessionStorage.removeItem('workspace_prefill_mode')
    if (!text) return
    // 已有数据(老项目)不覆盖
    if (data.synopsisText || data.episodeTexts.length > 0) return
    setData((d) => ({
      ...d,
      synopsisText: text,
      episodeTexts: [{ epIndex: 1, text }],
    }))
    setSynopsisText(text)
    setSynopsisDraft(text)
    setTab('script')
    toast.success('剧本已导入，可在「剧本」标签编辑或生成分镜')
  }, [dataLoaded])

  // 2026/06:故事板图自动入库 —— 监听 groupStoryboards 变化,每个 succeeded
  // 且未入库的项自动调 saveOneStoryboard,把临时 TOS URL 替换成永久
  // Supabase Storage URL。**根本解决** Seedream TOS URL 24h 过期导致"故事板
  // 图突然打不开 / 显示已过期"的问题 —— 不再依赖用户点「保存」按钮。
  //
  // 必须放在 workspaceId 声明(line 596)之后,避免 TDZ ReferenceError。
  // 行为对齐 character/scene 自动入库(同一个 useEffect 模式):
  //   - dedupeByUrlSet:同 url 已发起的请求会被 dedupe 掉,避免每个组件
  //     重渲染都重新下载上传
  //   - 失败不上 toast(避免每次刷新都刷错误),仅在 dev console 打 warn
  const autoSavingStoryboardsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!user || !workspaceId) return
    const entries = Object.entries(groupStoryboards)
    for (const [gid, item] of entries) {
      if (item.status !== 'succeeded' || !item.url) continue
      // 已入库的跳过(URL 是 supabase.co / 自己的 storage 域名)
      if (
        item.url.startsWith('data:') ||
        item.url.includes('.supabase.co') ||
        item.url.includes('.supabase.in') ||
        item.url.includes('/storage/v1/object/public/workspace-media/') ||
        item.url.includes('/object/public/workspace-media/')
      ) continue
      // 同 url 已发起的请求跳过(防重)
      if (autoSavingStoryboardsRef.current.has(item.url)) continue
      autoSavingStoryboardsRef.current.add(item.url)
      void (async () => {
        try {
          const r = await callSaveOneStoryboard({
            data: { workspaceId, groupId: gid, url: item.url },
          })
          if (r.ok && r.persisted && r.url && r.url !== item.url) {
            // 替换为永久 URL
            setGroupStoryboards((m) => {
              const cur = m[gid]
              if (!cur || cur.url !== item.url) return m  // 用户已经又生成了
              return { ...m, [gid]: { ...cur, url: r.url } }
            })
          }
        } catch (e) {
          console.warn(`[storyboard auto-save] ${gid} 失败:`, e)
        } finally {
          autoSavingStoryboardsRef.current.delete(item.url)
        }
      })()
    }
  }, [groupStoryboards, user, workspaceId, callSaveOneStoryboard])

  // 2026/06:视频自动入库 —— 监听 groupVideos 变化,每个 succeeded
  // 且未入库的项自动调 saveOneVideo,把临时视频 URL 替换成永久
  // Supabase Storage URL。与故事板图自动入库对称。
  const autoSavingVideosRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!user || !workspaceId) return
    const entries = Object.entries(groupVideos)
    for (const [gid, item] of entries) {
      if (item.status !== 'succeeded' || !item.url) continue
      // 已入库的跳过
      if (
        item.url.includes('.supabase.co') ||
        item.url.includes('.supabase.in') ||
        item.url.includes('/storage/v1/object/public/workspace-media/') ||
        item.url.includes('/object/public/workspace-media/')
      ) continue
      // 去重:同 url 不重复提交
      if (autoSavingVideosRef.current.has(item.url)) continue
      autoSavingVideosRef.current.add(item.url)
      ;(async () => {
        try {
          const r = await callSaveOneVideo({
            data: { workspaceId, groupId: gid, url: item.url },
          })
          if (r.ok && r.persisted && r.url && r.url !== item.url) {
            setGroupVideos((m) => {
              const cur = m[gid]
              if (!cur || cur.url !== item.url) return m
              return { ...m, [gid]: { ...cur, url: r.url } }
            })
          }
        } catch (e) {
          console.warn(`[video auto-save] ${gid} 失败:`, e)
        } finally {
          autoSavingVideosRef.current.delete(item.url)
        }
      })()
    }
  }, [groupVideos, user, workspaceId, callSaveOneVideo])

  // 2026/06:同步 clipOrder 与 data.storyboardGroups。
  // - 新生成的分镜组自动追加到末尾
  // - 删除/重切的分组从顺序中清理
  // - 不持久化(视频 URL 24h 失效,顺序仅当前会话有效)
  useEffect(() => {
    setClipOrder((prev) => {
      const validIds = new Set(data.storyboardGroups.map((g) => g.id))
      const kept = prev.filter((id) => validIds.has(id))
      const existing = new Set(kept)
      const appended = data.storyboardGroups
        .map((g) => g.id)
        .filter((id) => !existing.has(id))
      return [...kept, ...appended]
    })
  }, [data.storyboardGroups])

  // Expand character visual description from script profiles before image generation
  async function expandCharacterLook(c: GenCharacter): Promise<string> {
    // Combine all detailed description fields
    const combined = [
      c.gender && `性别：${c.gender}`,
      `年龄：${c.age}`,
      c.faceDescription && `面部特征：${c.faceDescription}`,
      c.bodyDescription && `身材体型：${c.bodyDescription}`,
      c.clothingDescription && `服装配饰：${c.clothingDescription}`,
      c.palette?.length && `配色：${c.palette.join(', ')}`,
    ].filter(Boolean).join('\n')

    // If already detailed enough (>200 chars), use as-is
    if (combined.length > 200) return combined

    try {
      const res = await callAi({
        data: {
          stage: 'character',
          userPrompt: `基于以下角色信息，扩写一份详细的外形视觉描述（仅描述外貌、穿着、体态、发型、配饰等视觉元素，不要写性格和剧情）。控制在 300 字以内。\n\n角色名：${c.name}\n角色定位：${c.roleLabel}\n${combined}`,
          context: {},
        },
      })
      // The AI returns structured data; combine the description fields
      if (res?.ok && res.payload?.characters?.[0]) {
        const ch = res.payload.characters[0]
        const expanded = [
          ch.gender && `性别：${ch.gender}`,
          `年龄：${ch.age}`,
          ch.faceDescription && `面部特征：${ch.faceDescription}`,
          ch.bodyDescription && `身材体型：${ch.bodyDescription}`,
          ch.clothingDescription && `服装配饰：${ch.clothingDescription}`,
        ].filter(Boolean).join('\n')
        if (expanded.length > combined.length) {
          return expanded
        }
      }
    } catch {
      // Fall through to original
    }
    return combined
  }

  async function genSceneImage(s: GenScene) {
    if (busyScene) return
    setBusyScene(s.id)
    try {
      // 2026/06 修:场景图之前完全没注入项目视觉风格,导致场景 A/B/C
      // 跟角色画风漂移。现在统一走 buildStyleLock,跟角色 / 分镜 /
      // 故事板 / 多维资产共享同一段风格指纹。
      const styleSpec = resolveProjectStyle(project?.style)
      const prompt = [
        buildStyleLock(styleSpec, 'scene'),
        `---`,
        `Location: ${s.slug}`,
        s.location && `${s.location}`,
        `Time: ${s.timeOfDay === 'DAY' ? 'daytime' : s.timeOfDay === 'NIGHT' ? 'nighttime' : s.timeOfDay === 'DUSK' ? 'dusk, golden hour' : 'dawn'}`,
        'Empty scene, no people, no characters, no figures, no silhouettes.',
        'Cinematic environment photography, wide establishing shot, detailed architecture and props, atmospheric lighting, film still quality.',
      ].filter(Boolean).join('\n')
      const res = await callImage({ data: { prompt, model: project?.sceneModel } })
      if (res.url) {
        // 2026/06 修复:直接持久化到 Storage
        const permResult = await persistSceneImage(s, res.url)
        if (permResult.ok) {
          toast.success(`已生成场景图「${s.slug}」`)
        } else {
          toast.warning(`场景「${s.slug}」图片保存失败，临时链接 24h 内有效`)
        }
      } else {
        toast.error(classifyError(res.error, '场景图生成失败'))
      }
    } catch {
      toast.error(classifyError(undefined, '场景图生成失败'))
    } finally {
      setBusyScene(null)
    }
  }

  /**
   * 生成道具图片(2026/06 新增)——与 genSceneImage 对称。
   */
  async function genPropImage(p: GenProp) {
    if (busyProp) return
    setBusyProp(p.id)
    try {
      const styleSpec = resolveProjectStyle(project?.style)
      const prompt = [
        buildStyleLock(styleSpec, 'scene'),
        `---`,
        `Item: ${p.name}`,
        `Description: ${p.description}`,
        `Movement in plot: ${p.movementDescription}`,
        'Clean product photography style, solid neutral background, no people, no characters, no hands, no figures.',
        'Isolated object shot, well-lit, detailed texture and material, centered composition, high quality.',
      ].filter(Boolean).join('\n')
      const res = await callImage({ data: { prompt, model: project?.sceneModel } })
      if (res.url) {
        // 2026/06 修复:直接持久化到 Storage
        const permResult = await persistPropImage(p, res.url)
        if (permResult.ok) {
          toast.success(`已生成道具图「${p.name}」`)
        } else {
          toast.warning(`道具「${p.name}」图片保存失败，临时链接 24h 内有效`)
        }
      } else {
        toast.error(classifyError(res.error, '道具图生成失败'))
      }
    } catch {
      toast.error(classifyError(undefined, '道具图生成失败'))
    } finally {
      setBusyProp(null)
    }
  }

  // ============= 本地图片上传(2026/06 新增) =============

  async function handleUploadImage(
    kind: 'character' | 'scene' | 'prop' | 'panel' | 'shot' | 'storyboard',
    id: string,
    imageKey: string,
  ) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
        const res = await callUploadImage({ data: { base64, id, kind } })
        if (res.ok && res.url) {
          if (kind === 'character') {
            updateCharImages((m) => ({ ...m, [imageKey]: [...(m[imageKey] ?? []), res.url!] }))
          } else if (kind === 'scene') {
            updateSceneImages((m) => ({ ...m, [id]: [...(m[id] ?? []), res.url!] }))
          } else if (kind === 'prop') {
            updatePropImages((m) => ({ ...m, [id]: [...(m[id] ?? []), res.url!] }))
          } else if (kind === 'panel') {
            setPanelImages((m) => ({ ...m, [id]: res.url! }))
          } else if (kind === 'shot') {
            setShotImages((m) => ({ ...m, [imageKey]: [...(m[imageKey] ?? []), res.url!] }))
          } else if (kind === 'storyboard') {
            setGroupStoryboards((m) => ({ ...m, [id]: { url: res.url!, status: 'succeeded' } }))
          }
          toast.success('图片已上传')
          void handleSaveWorkspace()
        } else {
          toast.error(res?.error || '上传失败')
        }
      } catch {
        toast.error('上传失败')
      }
    }
    input.click()
  }

  /**
   * 处理单个角色的所有 look(默认 + looks[]),内部**串行**——同角色不同
   * 服装必须按顺序走,这样 LLM 看到前一张的"脸锁定"记忆时不会被打断。
   * 跨角色由 useEffect 通过 Promise.all 并行触发,实现"不同角色并行 / 同
   * 角色串行"的要求。
   */

  /**
   * Per-look 独立描述生成 —— 拿到主角色基础描述后,对每个 look 并行调一次
   * generateCharacterLookAi(Qwen),产出独立完整的 face/body/clothing,
   * 严格继承 anchor(主条目),除非 AI 在第 1 步已经标了 faceHint/bodyHint
   * 说该变体下脸/身体有剧情明确的变化。
   *
   * 行为:
   *   - 成功 → 覆盖原 looks[k].faceDescription / bodyDescription / clothingDescription
   *   - 失败 → 保留 fallback(主条目)+ console.warn,不阻塞流程
   *   - 同角色 looks 并行(Promise.all),跨角色由 processCharacter 调用方串行
   *
   * 用户诉求(2026/06):
   * "同一个角色的不同形象让 ai 单独生成描述,不要共用一个人物形象描述"
   * "严格按照传入的已经生成的形象生成,保证脸和身体的一致性"
   * 文字层与图像层共享同一个 anchor:主条目 = 第 1 个 look(图像层 I2I 也锚第 1 张)。
   */
  // ====================================================================
  // 跨集角色一致性 工具 (2026/06)
  // ====================================================================

  /**
   * 给 AI 返回的某条 character 派生一个稳定的 id。
   * 关键: 优先复用 existing 里"同 matchKey / 同 name / 同 siblingGroupId"的 id,
   * 这样 charImages[id] 老图全部健在(不会被新 hash id 算出的 imageKey 失效)。
   * 都没有命中 → 派生新 id `mc-<8hex>`。
   */
  function resolveStableId(ext: { matchKey?: string; name?: string; siblingGroupId?: string }, existing: GenCharacter[]): string {
    // 2026/06 修复:之前 P1 用 matchKey 折叠,导致"陆深·医生"和"陆深·学生时期"
    // 被 AI 给的相同 matchKey 折叠成同一个 id,charImages[id] 共享,
    // 任何一方生成都覆盖另一方图片(用户报告"当A生成B也展示A的图,
    // 当B生成时A被刷新成B的")。
    //
    // 正确语义:
    //   - 同 name(精确,含 · 后缀)+ 跨集 → 复用 id(同 look 跨集, charImages[id] 持续)
    //   - 同真人不同 look(不同 name,如 "陆深·医生" vs "陆深·学生")→ 派生新 id
    //     各自独立 charImages,独立生成
    //   - matchKey 相同但 name 不同 → 走"派生新 id"路径(关键修复)
    //
    // 优先级:
    //   P1: name 精确匹配 → 复用 id(同 look 跨集/legacy 兼容)
    //   P2: legacy 兼容 —— existing 是 "陆深"(无 ·),new 是 "陆深·医生"(有 ·)→ 复用 id
    //   P3: 任何其他情况 → 派生新 id(mc-<hash>)
    //      (包括 matchKey 命中但 name 不同 = 不同 look)
    const nm = (ext.name || '').trim()
    if (nm) {
      const byName = existing.find((e) => e.name === nm)
      if (byName) return byName.id
    }
    // P2: legacy 兼容(老数据无 · 后缀)。新 ext 有 · + existing 同 base name → 复用
    if (nm && nm.includes('·')) {
      const base = nm.split('·')[0].trim()
      const byLegacy = existing.find((e) => e.name === base)
      if (byLegacy) return byLegacy.id
    }
    // P3: 派生新 id(用 name 哈希,稳定可重现)
    const seed = nm || (ext.matchKey || '').trim() || Math.random().toString()
    return `mc-${hashString(seed).slice(0, 8)}`
  }

  /**
   * 把 AI 这次返回的 characters(extracted, 已有 episodes:[extractEpIndex])
   * 合并进已有 data.characters,做跨集去重。
   *
   * 匹配规则(优先级从高到低):
   *   1) matchKey 严格相等 → 合并(同一真人跨集出现)
   *   2) siblingGroupId 相等(且非空) → 合并(同真人多形象)
   *   3) name 前缀("林晚 · 医生" → "林晚")在已有角色里出现 → 启发式合并
   *   4) 全无 → 创建新 GenCharacter
   *
   * 合并后:
   *   - id 沿用已有(防止 charImages[id] 失效)
   *   - episodes 追加 extractEpIndex(去重 + 排序)
   *   - 描述字段: face/body 用 AI 新的(更准);clothing 走 per-episode override
   *   - roleLabel: 若跨集有变化,存到 override,主字段用最新
   */
  function mergeExtractedCharacters(
    existing: GenCharacter[],
    extracted: GenCharacter[],
    extractEpIndex: number,
  ): GenCharacter[] {
    // 2026/06 修复:之前用 matchKey 当 P1 合并条件,导致"陆深 · 医生"和
    // "陆深 · 学生时期"被错误合并(它们 matchKey 相同 → 合并 → 用户看到
    // 2 个不同形象却同步显示,违反"多形象独立卡片"的用户诉求)。
    //
    // 正确语义:
    //   - 同 look(精确 name 相同)+ 跨集 → 合并(episodes 追加,共享脸/身)
    //   - 同真人不同 look(name 不同,如 "陆深 · 医生" vs "陆深 · 学生")→
    //     **分开**(独立卡,各自独立生成),靠 siblingGroupId 串起来做 I2I 锁脸
    //   - matchKey 是"真人身份",不是"合并键";多个卡片可以共享 matchKey
    //
    // 合并优先级:
    //   P1: 精确 name 相等 → merge
    //   P2: legacy 兼容 —— existing 是 "陆深"(无 ·),ext 是 "陆深 · 医生"(有 ·)→ merge
    //   P3: 其他 → 创建新卡(matchKey 自动从同组继承,保持跨集身份)
    const byName = new Map(existing.map((c) => [c.name, c]))
    const result = [...existing]

    for (const ext of extracted) {
      let match = byName.get(ext.name)
      if (!match) {
        // P2:legacy 兼容(老数据无 · 后缀)
        const extBase = ext.name.split('·')[0].trim()
        if (extBase !== ext.name) {
          // ext 有 · 后缀 → 看 existing 是否有同名 base(legacy 单名)
          match = existing.find((c) => c.name === extBase)
          if (match) ext.matchKey = match.matchKey
        }
        // ext 无 · 后缀 + existing 也无 · 后缀 → byName.get 已处理
        // ext 无 · + existing 有 · 变体 → 故意不匹配(新 look)
      }

      if (match) {
        const idx = result.findIndex((c) => c.id === match!.id)
        const newEpisodes = Array.from(new Set([...match.episodes, extractEpIndex])).sort((a, b) => a - b)
        // clothing/roleLabel per-episode override 处理
        const overrides = { ...(match.perEpisodeClothingOverrides ?? {}) }
        const clothingChanged = ext.clothingDescription.trim() !== match.clothingDescription.trim()
        const roleLabelChanged = (ext.roleLabel ?? '').trim() !== (match.roleLabel ?? '').trim()
        if (clothingChanged || roleLabelChanged) {
          // 把"老集"的状态存到 override,新集用新的
          const oldState = overrides[match.episodes[0]] ?? {}
          for (const ep of match.episodes) {
            if (ep === extractEpIndex) continue
            if (overrides[ep]) continue
            overrides[ep] = {
              ...(clothingChanged ? { clothingDescription: match.clothingDescription } : {}),
              ...(roleLabelChanged ? { roleLabel: match.roleLabel } : {}),
              ...oldState,
            }
          }
        }
        result[idx] = {
          ...match,
          name: ext.name,
          episodes: newEpisodes,
          faceDescription: ext.faceDescription || match.faceDescription,
          bodyDescription: ext.bodyDescription || match.bodyDescription,
          clothingDescription: ext.clothingDescription,
          roleLabel: ext.roleLabel || match.roleLabel,
          personality: ext.personality || match.personality,
          palette: ext.palette?.length ? ext.palette : match.palette,
          siblingGroupId: ext.siblingGroupId ?? match.siblingGroupId,
          perEpisodeClothingOverrides: Object.keys(overrides).length > 0 ? overrides : undefined,
        }
      } else {
        // 创建新的 —— 已经是 [extractEpIndex] in episodes
        result.push({ ...ext })
      }
    }
    return result
  }

  async function enrichCharacterLooks(c: GenCharacter): Promise<GenCharacterLook[]> {
    return c.looks ?? []
  }

  async function processCharacter(c: GenCharacter) {
    // ===== 入口可观测性 + 防并发(2026/06 排查用)=====
    console.log(`[CHAR-AUTOGEN] processCharacter called: id=${c.id} name=${c.name} looks=${(c.looks ?? []).length}`)
    // ref 守卫:防止 useEffect 多次触发同角色并发跑。busyChars 已经被
    // auto-gen useEffect 用,但 processCharacter 自身在多入口也会被直接调
    // (genCharImage / processCharacter 内部 / 内部 IIFE),所以加 ref 兜底。
    const inFlight = processCharacterInFlightRef.current.has(c.id)
    if (inFlight) {
      console.log(`[CHAR-AUTOGEN] processCharacter SKIPPED: id=${c.id} already in flight`)
      return
    }
    processCharacterInFlightRef.current.add(c.id)

    // ===== Per-look 独立描述生成(一次性,extract 完后)=====
    // 检查:有 look 没自己的 face/body(或与主条目相同)→ 跑 enrich,否则跳过
    const hasUnenriched = (c.looks ?? []).some(
      (lk) =>
        !lk.faceDescription?.trim() ||
        !lk.bodyDescription?.trim() ||
        lk.faceDescription === c.faceDescription ||
        lk.bodyDescription === c.bodyDescription,
    )
    console.log(`[CHAR-AUTOGEN] hasUnenriched=${hasUnenriched} for id=${c.id}`)
    if (hasUnenriched) {
      const enriched = await enrichCharacterLooks(c)
      c = { ...c, looks: enriched }
      // 把 enriched looks 写回 workspaceData,让 UI 卡片 + 后续 I2I 都看见独立描述
      setData((prev) =>
        prev
          ? {
              ...prev,
              characters: prev.characters.map((x) =>
                x.id === c.id ? { ...x, looks: enriched } : x,
              ),
            }
          : prev,
      )
    }

    // 拉平成 lookSpecs。key 为图片存储 key(imageKey),label 用于 toast/标题。
    // 2026/06:用户最新诉求 —— autoGen 只跑默认 look 1 张。变体 look 留给
    // 用户主动触发(点虚线框 → generateOneCharacterLook / "修改"输入框 /
    // "三视图" / "多维资产"按钮)。
    // 同角色"不同形象"功能完整支持(数据 + UI + 主动生成链路都通),只
    // 是不在 autoGen 里一次跑全。
    // doRegen 的 replaceExisting 参数保留(供未来用),本路径暂不传。
    // 2026/06:多形象拆分后 lookSpecs 永远只有 1 个条目(默认),lookSpec 维度
    // 已经没意义。保留这个结构是为了让下方 I2I/T2I 分支代码能跑通(单点路径)。
    const lookSpecs: { imageKey: string; label: string; data: { faceDescription: string; bodyDescription: string; clothingDescription: string } }[] = [
      { imageKey: c.id, label: '默认', data: { faceDescription: c.faceDescription, bodyDescription: c.bodyDescription, clothingDescription: c.clothingDescription } },
    ]

    // ====================================================================
    // 关键修复(2026/06):多形象拆分为独立角色后,脸一致性靠这里保障。
    // 如果当前角色 c 有 siblingGroupId,就在 data.characters 里找同组的其他角色
    // 拿它已经生成的图,作为 I2I 的 reference —— 模型"看着"参考图改服装,
    // 脸/身材/姿势都被原图锚定,自然就一致了。
    // 同组其他角色都没有图 → 这是组里第一个,降级走 T2I 当锚图。
    // ====================================================================
    // 2026/06:返回整个 {url, sibling} 不只 url —— 后面拼 I2I 指令时要把
    // sibling 的 faceDescription / bodyDescription 作为"脸部/身材文字 oracle"
    // 一起喂给模型,防止参考图本身戴了口罩/墨镜/帽子等遮挡物时 AI 看不清脸。
    // 文字 oracle 是从原始 prompt 来的,免疫遮挡。
    const siblingAnchor: { url: string; sibling: GenCharacter } | undefined = (() => {
      if (!c.siblingGroupId) return undefined
      const sibling = data.characters.find(
        (x) => x.id !== c.id && x.siblingGroupId === c.siblingGroupId,
      )
      if (!sibling) return undefined
      const sibImgs = charImagesRef.current[sibling.id] ?? []
      const url = sibImgs[sibImgs.length - 1]
      return url ? { url, sibling } : undefined
    })()
    const usingSiblingAnchor = !!siblingAnchor
    console.log(
      `[CHAR-AUTOGEN] id=${c.id} name=${c.name} siblingGroup=${c.siblingGroupId ?? '(none)'} ` +
      `anchor=${siblingAnchor ? `I2I(sibling=${siblingAnchor.sibling.name}, url=${siblingAnchor.url.slice(0, 60)}...)` : 'T2I'}`
    )

    for (let i = 0; i < lookSpecs.length; i++) {
      const ls = lookSpecs[i]
      // 跳过已经生成过的(可能在并发期间被其他 useEffect 跑过)
      const currentImages = charImagesRef.current
      if (currentImages[ls.imageKey]?.length) continue

      setActiveImageKey(ls.imageKey)

      // ====================================================================
      // 关键修复(2026/06 改造后):脸/身材锁定的两种路径
      //   - 旧路径(looks[] 时代):默认 look T2I,后续 look I2I 用默认 look 图
      //   - 新路径(多形象拆分为独立角色):同组首个 T2I,后续 I2I 用同组首个的图
      //
      // 下方逻辑统一抽象为 "referenceImageUrl 是否存在":
      //   - 有 → 走 I2I 锁脸
      //   - 无 → 走 T2I
      // 新老路径共用同一段 I2I 指令(下方 instruction 模板)。
      // ====================================================================
      const isDefaultLook = i === 0
      const defaultLookImageKey = lookSpecs[0].imageKey
      const defaultLookImages = charImagesRef.current[defaultLookImageKey] ?? []
      // 三种"有参考图"的情况合并:
      //   1) 新架构下的兄弟锚图(同组其他角色已有图) → 用兄弟的 url
      //   2) 旧架构下的默认 look 图(同角色其他 look 已有图,理论上新架构下不会触发)
      //   3) 自己已有图(用户主动重生时 referenceOverride 走别的分支,这里只考虑 T2I 首次)
      const referenceImageUrl = usingSiblingAnchor
        ? siblingAnchor!.url
        : isDefaultLook
          ? undefined
          : defaultLookImages[defaultLookImages.length - 1]

      if (referenceImageUrl) {
        // ============== 后续 look 走 I2I(以默认 look 的图为视觉锚点)==============
        // 拼一条"中性结构锁脸 + 配饰按描述"指令(2026/06 用户诉求):
        //   - 脸型 / 五官 / 肤色 / 骨架 / 发型 等中性结构 → 跨 look 100% 一致
        //     (这是"看起来是同一个人"的本质)。
        //   - 妆容 / 表情 / 配饰(口罩 / 帽子 / 眼镜 / 项链等)→ 按当前形象的
        //     clothingDescription 生成。默认 look 的"裸脸"是基线,本新
        //     look 不强制继承参考图的面部配饰(除非本 look 描述明确要保留)。
        //   - 只有当前形象描述明确说"脸变了"/"胖了"/"受伤了"时,才允许
        //     改脸 / 改身材(对应 GenCharacterLook.faceHint / bodyHint)。
        // 用户的修改意见(若有)由 doRegen 的 userInstruction 通道处理,
        // 不在这里覆盖。
        // 锚图来源分两种:1) 新架构下 usingSiblingAnchor=true(同组其他角色);
        // 2) 旧架构下 usingSiblingAnchor=false(同角色其他 look)。文案略有不同。
        // 锚图来源分两种文案,新架构(同组 sibling)还会附上文字 oracle。
        // 关键:脸部/身材 100% 以"文字描述"为准 —— 因为参考图可能戴了口罩/
        // 墨镜/帽子/头饰等遮挡面部的配饰,AI 看不清会瞎猜。文字 oracle 是
        // 从生成该图时的原始 prompt 拿的,完全不受遮挡影响。
        const anchorDesc = usingSiblingAnchor
          ? '图1(同真人的其他形象,共享 siblingGroupId)'
          : `图1(同角色【${ls.label}】造型的默认图)`
        // 兄弟锚图时把兄弟的 face/body 描述作为"文字 oracle"附上;
        // 旧架构下没有兄弟概念,fallback 用 c 自己当前描述。
        const faceOracle = usingSiblingAnchor
          ? siblingAnchor!.sibling.faceDescription
          : c.faceDescription
        const bodyOracle = usingSiblingAnchor
          ? siblingAnchor!.sibling.bodyDescription
          : c.bodyDescription
        const instruction = [
          // ═══════ 【最优先级:脸部档案】放最前面,被模型加权最重 ═══════
          // 2026/06 修复:用户报告同真人 2/3 个形象 b 锁得不好。诊断认为:
          // 1) I2I 模型对 prompt 中后段内容权重低 → face oracle 放最前
          // 2) 参考图本身戴口罩/墨镜会让模型"反向带偏" → 文字档案优先级最高
          `【任务:同一个人,不同形象 —— 这是"脸锁"任务】`,
          ``,
          `你是给同一个真人(${siblingAnchor?.sibling.name ?? c.name}家族)生成新形象。` +
          `此人是同一个 DNA、同一个长相 —— 唯一允许变化的是当前形象描述里写的服装/配饰/妆容。`,
          `【脸部档案 · 文字 oracle · 100% 锁死】`,
          `  脸(face): ${faceOracle || '(无)'}`,
          `  身材(body): ${bodyOracle || '(无)'}`,
          `以上这两段文字描述是**绝对权威**,禁止从图1的视觉细节推断脸部信息(图1 可能戴口罩/墨镜/帽子/头饰/面具等遮挡,看图会瞎猜)。`,
          ``,
          `【视觉锚点】${anchorDesc}`,
          ``,
          `【从图1 继承的部分】`,
          `• 整体画面构图、视角、画幅、风格、光照、背景 100% 继承图1`,
          `• 发型轮廓(短/长/卷/直、刘海/鬓角)100% 继承图1`,
          `  ↳ 发色默认继承,但若当前形象描述明确要换发色则按描述`,
          `• 表情默认继承"无表情";若当前形象描述明确要某种表情则按描述`,
          ``,
          `【当前形象的服装/配饰描述】:${ls.data.clothingDescription || '保持参考图的服装不变'}`,
          ``,
          `【可按当前形象描述自由调整的部分】`,
          `• 妆容(眼妆、唇色、腮红)按当前形象描述生成`,
          `• 配饰(口罩/帽子/墨镜/项链/手套等)按当前形象描述生成 —— 不强制继承图1 的配饰,除非描述明确说要保留`,
          `• 整体服装按当前形象的 clothingDescription 完整替换`,
          ``,
          `【硬约束】`,
          `• 脸型、脸轮廓、五官比例、肤色、骨骼结构 100% 按 face 文字生成,**严禁被图1 的配饰/视角/光影"反向带偏"**`,
          `• 体型、身高、胖瘦、体态 100% 按 body 文字生成`,
          `• 除非当前形象描述里【明确写】"脸变了"/"胖了"/"受伤了"/"变年轻了"等,否则一律按 face 文字`,
          ``,
          `输出:一张全身正面图,新造型,看起来【明显是同一个人】(脸身材与图1 / 与同真人其他形象完全一致),但服装/妆容/配饰已经按当前形象描述替换。`,
        ].join('\n')

        // 找到 look 在 c.looks 里的 id(传给 doRegen 用于 imageKey 拼装)
        const lookDbId = ls.imageKey === c.id
          ? null  // 默认 look
          : (c.looks ?? []).find((x) => `${c.id}::${x.id}` === ls.imageKey)?.id ?? null

        // 复用 doRegen(它已经处理 I2I / busy 状态 / history push)。
        // 当前路径不再被执行(lookSpecs 只含默认 look),保留注释以备未来。
        await doRegen(c, lookDbId, 'modify', instruction, referenceImageUrl)
        continue
      }

      // ============== 默认 look 走原 T2I 路径(无参考图)==============
      try {
        // 解析项目视觉风格。每个 look 共享项目风格(项目级美术指导),但只换衣服/身份。
        const styleSpec = resolveProjectStyle(project?.style)
        const paletteLine = c.palette?.length
          ? `signature color palette (must appear in clothing / accessories): ${c.palette.join(', ')}`
          : ''
        const cardTitle = ls.label === '默认' ? c.name : `${c.name} · ${ls.label}`
        // ====================================================================
        // 角色主视图 prompt(v3 —— 强制版)
        //   设计要点(解决反复出现的"半身 / 切脚 / 无腿"问题):
        //   1) 用电影/摄影术语 "full shot / long shot / full-length portrait",
        //      这些词在模型训练数据里出现频率高,语义明确,比抽象的
        //      "head-to-toe" 触发全身构图的成功率更高。
        //   2) 用"character occupies 85-95% of canvas height"等比例语言,模型
        //      对百分比比绝对像素更敏感。
        //   3) 把画布几何用坐标 (y=80 head, y=1392 feet) 写出来,模型按此
        //      排版时几乎不会切脚。
        //   4) 用"step-by-step"让模型先生成画布再放人物,而不是默认塞中间。
        //   5) 末尾"FINAL CHECK"让模型生成前做一次自检,自检不通过就重画。
        //   6) negative_prompt 把"半身/切脚"近义词全覆盖,多写一份冗余。
        // ====================================================================
        const prompt = [
          // 任务一句话(强指令,放最前)
          `Generate ONE full-body head-to-toe character reference image of "${cardTitle}" — a ${c.roleLabel}, age ${c.age}.`,
          ``,
          // 摄影术语 + 镜头类型
          `SHOT TYPE: Full shot (FS) / long shot (LS) / full-length portrait — the same framing used in fashion catalog full-body shots, character design turnaround sheets, model sheets, and costume reference sheets.`,
          ``,
          // 画布几何(显式坐标)
          `CANVAS GEOMETRY: The image is a 3:4 portrait-orientation canvas (taller than wide), 1104 wide × 1472 tall. The character's full standing figure occupies 85-95% of the canvas height — from y≈80 (top of head) to y≈1392 (soles of feet). The remaining 5-15% is split as small white margin above the head AND below the feet. The figure does NOT touch the top or bottom edge of the frame.`,
          ``,
          // 构图步骤
          `COMPOSITION STEPS (apply in this order):
  1. Reserve a 3:4 portrait canvas (taller than wide).
  2. Place the character dead-center horizontally.
  3. Place the top of the head at y ≈ 80 pixels (5% margin from the top).
  4. Place the soles of the feet at y ≈ 1392 pixels (5% margin from the bottom).
  5. The character body is 1312 pixels tall — a full-body figure that fills the vertical axis.
  6. Both feet are clearly visible at the bottom of the frame. Both hands are visible at the sides.`,
          ``,
          // 硬约束(列出所有失败模式)
          `HARD CONSTRAINTS — the image is REJECTED if ANY of these is true:
  • The image is a half-body, waist-up, hip-up, chest-up, shoulder-up, knee-up, cowboy shot, or head-and-shoulders crop.
  • The head or top of the hair is cut off at the top of the frame.
  • The feet or shoes are cut off at the bottom of the frame.
  • The character is floating with no visible feet, or the lower body fades into the background.
  • The body extends beyond the frame edge.
  • The character occupies less than 80% of the canvas height.
  • The body touches the top or bottom edge of the image.`,
          ``,
          // 镜头角度
          `CAMERA: Dead-on front view, eye-level. Both eyes fully visible, looking at the camera. Arms relaxed at the sides, feet slightly apart. No low angle, no worm's-eye view, no high angle, no tilted camera.`,
          ``,
          // 表情
          `EXPRESSION: Neutral, expressionless, like a passport photo. No smile, no frown, no emotion, eyes open.`,
          ``,
          // 默认 look 必须露出完整的脸(2026/06 用户诉求)
          // 给后续 look 提供"脸"可以继承的视觉锚点 —— 口罩/墨镜/帽子等
          // 面部遮挡物属于服饰/配饰,由各变体 look 自己的描述决定是否佩戴,
          // 默认 look 不带任何面部遮挡,作为后续 look 的"裸脸"基线。
          `FACE REVEAL — the default look must show the COMPLETE UNCOVERED FACE:
  • No surgical mask, no dust mask, no cloth mask, no respirator
  • No sunglasses, no goggles, no tinted glasses
  • No hat, no cap, no hood covering the face
  • No hands, props, or hair blocking the face
  • Eyes, eyebrows, nose, mouth, jawline, skin tone all clearly visible
  If the character's later outfit variants need a mask or accessory, those
  variants add it themselves — the default look is the clean baseline face
  that every other look inherits from.`,
          ``,
          // 背景
          `BACKGROUND: 100% pure white #FFFFFF. No scenery, no floor, no shadow, no gradient, no vignette, no horizon line.`,
          ``,
          // 视觉风格(2026/06:统一 buildStyleLock,跨生成入口风格指纹一致)
          `[VISUAL STYLE — must follow the project's art direction]`,
          buildStyleLock(styleSpec, 'character'),
          ``,
          // 多 outfit 一致性
          `FACE / BODY LOCK: "${c.name}" has multiple outfit variants. The face and body MUST remain identical across all variants. Only the outfit changes. Treat the FACE / BODY descriptions below as the single source of truth.`,
          ``,
          // 角色描述
          `CHARACTER:
  Name: ${c.name} (${c.roleLabel}, age ${c.age})
  Variant: ${ls.label}
  ${paletteLine ? paletteLine + '\n  ' : ''}Face: ${ls.data.faceDescription}
  Body: ${ls.data.bodyDescription}
  Outfit (this variant): ${ls.data.clothingDescription}`,
          ``,
          // 终检
          `FINAL CHECK — before submitting the output, verify every item is true. If any is false, REGENERATE the image:
  [ ] Full body is visible from head to feet (yes)
  [ ] Both feet are clearly visible at the bottom of the frame (yes)
  [ ] Character occupies 85-95% of canvas height (yes)
  [ ] Nothing is cut off — no half-body, no waist-up, no knee-up, no close-up (yes)
  [ ] Style matches "${styleSpec.label}" (yes)
  [ ] Background is pure white #FFFFFF (yes)
  [ ] Expression is neutral (yes)
  [ ] Camera is dead-on front view, eye-level (yes)`,
          ``,
          `Begin. Output the full-body image.`,
        ].filter(Boolean).join('\n')

        // ====================================================================
        // 强 negative_prompt(显式下发到 DashScope parameters.negative_prompt)
        // 把"半身 / 切脚 / 浮空无脚"的所有近义词/同义词全部覆盖,冗余但有效。
        // 关键:用 cinematic / photography 术语模型识别度更高,比中文更稳。
        // ====================================================================
        const negativePrompt = [
          // —— 摄影 / 镜头(半身特写)——
          'medium shot, medium close-up, MCU, MS, mid-shot, mid close-up, half body, half-body, half-length, three-quarter body, 3/4 body, three-quarter length, cowboy shot, american shot, knee-up shot, knee-up, mid-thigh shot, thigh-up, hip-up, waist-up shot, waist-up, midriff-up, chest-up shot, chest-up, shoulder-up, head and shoulders, head-and-shoulders, head only, headshot, head shot, tight headshot, tight crop, tight framing, close-up, close up, CU, extreme close-up, ECU, bust shot, bust, portrait crop, portrait shot, passport photo, ID photo, avatar crop, profile picture crop, pfp crop',
          // —— 切边 / 切脚 / 切头——
          'cropped at knees, cropped at calves, cropped at shins, cropped at ankles, cropped at waist, cropped at hips, cropped at thighs, cropped at chest, cropped at shoulders, cropped at neck, head cut off, top of head cut off, top of head clipped, hair cut off, feet cut off, shoes cut off, hands cut off at frame edge, body extending beyond frame, body touching frame edge, body touching top of frame, body touching bottom of frame, figure touching top of frame, figure touching bottom of frame, out of frame on top, out of frame on bottom',
          // —— 部位缺失 / 浮空——
          'missing feet, missing shoes, missing head, missing legs, missing lower body, missing upper body, missing arms, missing hands, head only, torso only, legs only, partial body, incomplete body, amputated limbs, no legs, no feet, legless, feet-less, lower body cut off, lower body fading out, lower body blended with background, character floating with no feet, floating in air, character shown only from the waist up, from waist up only, from chest up only, from hips up only, from knees up only',
          // —— 摄像机角度(仰视 / 侧视)——
          'low angle, low-angle shot, worm\'s eye view, worm eye view, hero shot, looking up at subject, upward camera, upward tilt, camera below subject, dutch angle, dutch tilt, tilted camera, canted angle, fisheye, wide-angle distortion, 3/4 view, three-quarter view, side view, profile view, back view, rear view, over-the-shoulder, looking sideways, glance to the side, head turned, body turned, asymmetric pose, top-down, bird\'s eye view, bottom-up',
          // —— 画幅 / 比例(方形特写)——
          'square crop, square framing, 1:1 aspect, instagram portrait crop, tiktok portrait, headshot-style crop, landscape orientation, 16:9 widescreen',
          // —— 边缘人 / 多余元素——
          'two people, multiple people, extra person in background, bystander, crowd, two characters, three characters',
          // —— 风格漂移——
          'photorealistic when input is anime, anime when input is realistic, 3D render when input is 2D, different art style, style drift',
          // —— 杂项——
          'watermark, logo, text, signature, label, panel number, caption, annotation, extra limbs, deformed hands, extra fingers, blurred face, low quality',
        ].join(', ')

        // 显式传 portrait 画幅给 Seedream,锁死竖向构图(用 prompt 反复强调"全身"
        // 仍会偶发切脚,但 2:3 画幅从结构上让模型必须把人物铺满纵向画布)。
        // 2026 注意:Seedream 最小像素 3,686,400 —— 1104*1472=1,623,888 ❌(legacy Qwen 尺寸,
        // 旧代码直接传过去会被 Seedream 400 拒掉)。改用 1664x2496=4,153,344 ✅(2:3 竖版画幅)。
        const characterSize = '1664x2496'

        const res = await callImage({ data: { prompt, model: resolveT2IModel(project?.sceneModel), noFallback: true, negativePrompt, size: characterSize } })
        console.log(`[CHAR-AUTOGEN] callImage returned: id=${c.id} url=${res.url ? 'ok' : res.error}`)
        if (res.url) {
          // 2026/06 修复:直接服务端持久化到 Storage,避免 base64 超时
          const permResult = await persistAndSetImage(ls.imageKey, res.url, 'character', c.id, 'overwrite')
          if (permResult.ok) {
            toast.success(`已生成 ${cardTitle}（${styleSpec.label}）`)
          } else {
            toast.warning(`「${cardTitle}」图片保存失败，临时链接 24h 内有效`)
          }
        } else {
          toast.error(classifyError(res.error, '生成失败'))
        }
      } catch (e) {
        toast.error(classifyError(e instanceof Error ? e.message : String(e), '生成失败'))
      }
    }
    // 这个角色的所有 look 都处理完,从 busyChars 移除
    setActiveImageKey((cur) => (cur && cur.startsWith(c.id) ? null : cur))
    setBusyChars((s) => {
      if (!s.has(c.id)) return s
      const n = new Set(s)
      n.delete(c.id)
      return n
    })
    // 入口 ref 守卫:清掉
    processCharacterInFlightRef.current.delete(c.id)
    console.log(`[CHAR-AUTOGEN] processCharacter FINISHED: id=${c.id}`)
  }

  // Wrapper for "click on one card to regenerate": just trigger the whole
  // character through processCharacter (which is idempotent — it skips done looks).
  async function genCharImage(c: GenCharacter) {
    if (busyChars.has(c.id)) return
    setBusyChars((s) => new Set([...s, c.id]))
    await processCharacter(c)
  }

  /**
   * 一键生成所有形象(2026/06 角色 tab 顶部按钮) —— 遍历本集所有角色的所有
   * look(默认 + 变体),未生成的逐个跑:
   *   - 默认 look(没图)→ genCharImage 走 T2I
   *   - 变体 look(没图)→ generateOneCharacterLook 走 I2I(以默认图为锚,锁脸)
   * 串行避免并发。供用户**主动**触发"同角色不同形象都生成",与 autoGen
   * 默认只跑默认的克制策略并存。
   */
  async function generateAllCharacterLooksForCurrentEpisode() {
    const epChars = data.characters.filter((c) => c.episodes.includes(selectedEpisodeIndex))
    for (const c of epChars) {
      // 默认 look 没图 → 跑 T2I
      if (!charImages[c.id]?.length) {
        await genCharImage(c)
      }
      // 变体 look 没图 → 跑 I2I
      for (const lk of c.looks ?? []) {
        if (charImages[`${c.id}::${lk.id}`]?.length) continue
        if (!charImages[c.id]?.length) {
          toast.error(`默认 look 还没生成,无法生成「${lk.label}」`)
          continue
        }
        await generateOneCharacterLook(c, lk.id)
      }
    }
    toast.success('本集所有形象生成完成')
  }

  /**
   * 主动生成单个变体 look(2026/06) —— 角色 tab 变体 look 卡片虚线框
   * 点击触发。流程:
   *   1) 拿默认 look 最新图作 referenceImageUrl(无默认图则报错)
   *   2) 拼"中性结构锁脸 + 配饰按描述"instruction(同 processCharacter 后续
   *      look 走 I2I 的指令模板,保持一致)
   *   3) 调 callRegenCharacter regenerateCharacterLook mode='modify'
   *   4) push 到 charImages[`${c.id}::${lk.id}`] history 数组
   *
   * 不改 useEffect / processCharacter 行为,纯按用户点击触发的入口。
   */
  async function generateOneCharacterLook(c: GenCharacter, lookId: string) {
    const lk = c.looks?.find((x) => x.id === lookId)
    if (!lk) {
      toast.error('找不到该 look')
      return
    }
    const referenceUrl = charImages[c.id]?.at(-1)
    if (!referenceUrl) {
      toast.error('默认 look 还没生成,无法生成变体 look')
      return
    }
    const imageKey = `${c.id}::${lk.id}`
    if (charImages[imageKey]?.length) {
      toast.success(`${c.name} · ${lk.label} 已生成`)
      return  // 已生成过
    }
    setActiveImageKey(imageKey)
    setBusyChars((s) => new Set([...s, c.id]))
    const faceDesc = lk.faceDescription?.trim() || c.faceDescription
    const bodyDesc = lk.bodyDescription?.trim() || c.bodyDescription
    const clothingDesc = lk.clothingDescription?.trim() || c.clothingDescription
    const instruction = [
      `给【${c.name}】生成【${lk.label}】造型,视觉锚点是图1(同角色的默认 look):`,
      `新服装/配饰描述:${clothingDesc || '保持参考图的服装不变'}`,
      ``,
      `【中性结构锁(跨 look 必须 100% 一致)】`,
      `• 脸型、脸轮廓、五官比例、肤色、骨骼结构 100% 继承图1`,
      `• 体型、身高、胖瘦、体态 100% 继承图1`,
      `• 发型轮廓 100% 继承图1`,
      ``,
      `【可按本新 look 描述自由调整的部分】`,
      `• 妆容、表情、配饰(口罩/帽子/墨镜/项链等)按本新 look 描述生成`,
      `• 整体服装按本新 look 的服装描述完整替换`,
      ``,
      `【硬约束】`,
      `• 除非本新 look 描述里【明确写】"脸变了"/"胖了"/"受伤了"等,否则脸/身材一律按中性结构继承`,
      `• 整体画面构图、视角、画幅、风格、光照、背景 100% 继承图1`,
      ``,
      `输出:一张全身正面图,新造型,看起来【明显是同一个人】,但服装/妆容/配饰已按本新 look 描述替换。`,
    ].join('\n')
    try {
      const res = await callRegenCharacter({
        data: {
          referenceImageUrl: referenceUrl,
          userInstruction: instruction,
          faceDescription: faceDesc,
          bodyDescription: bodyDesc,
          clothingDescription: clothingDesc,
          characterName: c.name,
          characterRoleLabel: c.roleLabel,
          characterAge: c.age,
          lookLabel: lk.label,
          palette: c.palette,
          projectStyle: project?.style,
          model: resolveI2IModel(project?.sceneModel),
          mode: 'modify',
        },
      })
      if (res?.ok && res.url) {
        // 2026/06 修复:ARK TOS URL <img> 加载失败，先 await 转 base64
        const base64Url = await toBase64WithFallback(res.url)
        const displayUrl = base64Url ?? res.url
        updateCharImages((m) => ({ ...m, [imageKey]: [...(m[imageKey] ?? []), displayUrl] }))
        if (base64Url) {
          toast.success(`已生成 ${c.name} · ${lk.label}`)
        } else {
          toast.warning(`「${c.name} · ${lk.label}」图片持久化失败，临时链接 24h 内有效`)
        }
      } else {
        toast.error(classifyError(res?.error, '生成失败'))
      }
    } catch {
      toast.error(classifyError(undefined, '生成失败'))
    } finally {
      setActiveImageKey((cur) => (cur === imageKey ? null : cur))
      setBusyChars((s) => {
        if (!s.has(c.id)) return s
        const n = new Set(s)
        n.delete(c.id)
        return n
      })
    }
  }

  /**
   * 预览模态框里"按意见重生"——把:
   *   1) 当前选中的图片 URL(referenceImageUrl)
   *   2) 用户输入的修改意见
   *   3) 该形象的描述(face/body/outfit)
   *   4) 项目视觉风格 + 角色基本信息
   * 一起发给 regenerateCharacterLook server fn。返回新图后 push 到
   * charImages[imageKey] history 数组并自动选中。
   */
  async function handleRegenerate() {
    if (!previewTarget || regenBusy) return
    const c = previewTarget.character
    const lk = previewTarget.lookId == null
      ? null
      : c.looks?.find((x) => x.id === previewTarget.lookId) ?? null
    const imageKey = lk ? `${c.id}::${lk.id}` : c.id
    const generations = charImages[imageKey] ?? []
    const currentIdx = Math.min(selectedGenIdx, Math.max(0, generations.length - 1))
    const referenceUrl = generations[currentIdx]
    const instruction = regenInput.trim()
    if (!referenceUrl || !instruction) return

    setRegenBusy(true)
    try {
      const res = await callRegenCharacter({
        data: {
          referenceImageUrl: referenceUrl,
          userInstruction: instruction,
          faceDescription: lk?.faceDescription || c.faceDescription || '',
          bodyDescription: lk?.bodyDescription || c.bodyDescription || '',
          clothingDescription: lk?.clothingDescription || c.clothingDescription || '',
          characterName: c.name,
          characterRoleLabel: c.roleLabel,
          characterAge: c.age,
          lookLabel: lk?.label || '默认',
          palette: c.palette,
          projectStyle: project?.style,
          // 2026/06 修复:跟同文件 1167/1327/1510 三处保持一致,先过 resolveI2IModel
          // 防止把 T2I-only model id 直接打到 ARK 报 400
          model: resolveI2IModel(project?.sceneModel),
        },
      })
      if (res?.ok && res.url) {
        // 2026/06 修复:ARK TOS URL <img> 加载失败，先 await 转 base64
        const base64Url = await toBase64WithFallback(res.url)
        const displayUrl = base64Url ?? res.url
        updateCharImages((m) => ({ ...m, [imageKey]: [...(m[imageKey] ?? []), displayUrl] }))
        // 自动选中新生成的那张
        setSelectedGenIdx((charImages[imageKey]?.length ?? generations.length))
        setRegenInput('')
        toast.success('已按意见重生')
      } else {
        toast.error(res?.error || '重生失败')
      }
    } catch (e) {
      toast.error('重生失败')
    } finally {
      setRegenBusy(false)
    }
  }

  // ============= 卡片底部 3 个按钮的逻辑 =============
  // 打开预览模态框(2026/06 改造:把"修改"输入区直接嵌入预览,不再走
  // 独立的右侧 slide-in 面板)。从卡片点击 / 卡片底部"修改"按钮 / 预览
  // 内 look 切换 都会调到这里 —— 一次调用同时打开预览 + 修改 state。
  // 旧名 openModPanel 保留,避免在多个调用点批量重命名;语义上现在等价于
  // "打开这个角色卡片的预览+编辑"。
  function openModPanel(c: GenCharacter, lookId: string | null) {
    const imageKey = lookId == null ? c.id : `${c.id}::${lookId}`
    setModPanel({ character: c, lookId, imageKey })
    setPreviewTarget({ character: c, lookId })
    setSelectedGenIdx(0)
    setModInput('')
    setModError(null)
  }

  function closeModPanel() {
    // 即使正在生成也允许关闭,让用户在后台继续看其他内容
    setModPanel(null)
    setPreviewTarget(null)
    setModInput('')
    setModError(null)
  }

  /**
   * 通用"调一次 regen"的核心,把当前选中的图 + 用户 instruction + 描述发
   * 给 server fn。新图 push 到 history(自动替换卡片封面),失败弹 toast。
   */
  async function doRegen(
    c: GenCharacter,
    lookId: string | null,
    mode: 'modify' | 'three-view' | 'multi-asset',
    instruction: string,
    /**
     * 可选:直接指定 referenceImageUrl,绕过"从 history 取最新一张"的默认行为。
     * 用于 processCharacter 自动给后续 look 传默认 look 的图当参考,确保脸一致。
     */
    referenceOverride?: string,
    /**
     * 2026/06:可选。true 时 setCharImages 直接覆盖为 [res.url](只留 1 张,
     * 不堆历史),用于 processCharacter autoGen 跑后续 look —— "新生成替代
     * 旧历史"。false(默认)时维持 append 行为,保留用户主动 modify 堆的
     * 迭代历史。提交时也走 I2I,不影响人脸锁逻辑。
     */
    replaceExisting = false,
  ) {
    const lk = lookId == null ? null : c.looks?.find((x) => x.id === lookId) ?? null
    const imageKey = lk ? `${c.id}::${lk.id}` : c.id
    const generations = charImagesRef.current[imageKey] ?? []
    // 2026/06 改:reference 优先级
    //   1) referenceOverride(processCharacter autoGen 显式传)
    //   2) selectedCharImages[imageKey] —— 用户在卡片上"选中"的那张
    //      (前提是这张 url 还在 generations 里;否则忽略)
    //   3) 最新一张 generations[length-1]
    // 这样点"三视图"/"多维资产" 按用户选中的形象去 I2I,而不是机械地用最新。
    const pinned = selectedCharImagesRef.current[imageKey]
    const fallback = generations[generations.length - 1]
    const referenceUrl = referenceOverride
      ?? (pinned && generations.includes(pinned) ? pinned : fallback)
    if (!referenceUrl) {
      toast.error('该形象还没生成,无法重生')
      return
    }
    // 把这张卡标记为 regen 中,UI 那边会显示黑屏遮罩。结束时(成功/失败)一定清掉。
    setRegenBusyKeys((m) => new Map(m).set(imageKey, mode))
    try {
      const res = await callRegenCharacter({
        data: {
          referenceImageUrl: referenceUrl,
          userInstruction: instruction,
          faceDescription: lk?.faceDescription || c.faceDescription || '',
          bodyDescription: lk?.bodyDescription || c.bodyDescription || '',
          clothingDescription: lk?.clothingDescription || c.clothingDescription || '',
          characterName: c.name,
          characterRoleLabel: c.roleLabel,
          characterAge: c.age,
          lookLabel: lk?.label || '默认',
          palette: c.palette,
          projectStyle: project?.style,
          // I2I(model 必须支持 multimodal input)。qwen-image-max 等只支持 T2I 的
          // 模型会 400 "url error";用 resolveI2IModel 强制映射到订阅里 I2I 兼容的
          // model(qwen-image-2.0-pro)。
          model: resolveI2IModel(project?.sceneModel),
          mode,
          previewOnly: viewPromptsModeRef.current,
        },
      })
      // 2026/06:查看提示词模式 —— 拦截到 previewPrompt 就弹 modal 不写图
      if (interceptPromptPreview(
        mode === 'three-view' ? `${c.name} · 三视图` :
        mode === 'multi-asset' ? `${c.name} · 多维资产` :
        `${c.name} · 修改 (${instruction.slice(0, 30)}…)`,
        res,
      )) {
        return true  // 视为"成功",让上层关 modal/清错误状态
      }
      if (res?.ok && res.url) {
        // 2026/06 修复:ARK TOS URL <img> 加载失败，先 await 转 base64
        const base64Url = await toBase64WithFallback(res.url)
        const displayUrl = base64Url ?? res.url
        updateCharImages((m) => ({
          ...m,
          [imageKey]: replaceExisting ? [displayUrl] : [...(m[imageKey] ?? []), displayUrl],
        }))
        const modeLabel =
          mode === 'modify' ? '已按意见重生' :
          mode === 'three-view' ? '已生成三视图' :
          '已生成多维资产图'
        toast.success(modeLabel)
        return true
      }
      toast.error(classifyError(res?.error, '生成失败'))
      return false
    } catch (e) {
      toast.error(classifyError(undefined, '生成失败'))
      return false
    } finally {
      setRegenBusyKeys((m) => {
        if (!m.has(imageKey)) return m
        const n = new Map(m)
        n.delete(imageKey)
        return n
      })
    }
  }

  // 右侧面板的"发送"按钮:走 mode='modify' + 用户意见
  //
  // 2026/06 二次改造:doRegen 只生成新图、不更新角色文字描述,导致后续点
  // "三视图"/"多维资产" 时 I2I 收到的 face/body/clothing 文字仍是原始的,
  // 跟修改后的图脱节(image-anchor 主导出新形象,但文字残留可能拉偏一些细节)。
  // 改:成功后调 describeCharacterImage 让 Qwen-VL 看新图重写 3 段描述,
  // 写回 data.characters 对应字段(默认 look → 角色根字段;变体 look → c.looks[i])。
  // 失败不阻塞(只 console.warn),用户至少图已更新。
  async function submitModPanel() {
    if (!modPanel || modBusy) return
    const instruction = modInput.trim()
    if (!instruction) {
      setModError('请输入修改意见')
      return
    }
    setModBusy(true)
    setModError(null)
    const c = modPanel.character
    const lookId = modPanel.lookId
    const imageKey = modPanel.imageKey
    const ok = await doRegen(c, lookId, 'modify', instruction)
    if (ok) {
      // 2026/06:保留 AI 描述 + 追加用户意见。先调 describeCharacterImage 生成详细描述,
      // 然后把用户的修改意见作为补充说明追加到对应字段末尾,这样既有详细描述又体现用户意图。
      const newUrl = charImagesRef.current[imageKey]?.at(-1)
      const lk = lookId == null ? null : c.looks?.find((x) => x.id === lookId) ?? null
      const instr = instruction.toLowerCase()
      // 判断用户意见涉及哪些维度
      const touchFace = /脸|面容|五官|face/i.test(instr)
      const touchBody = /身材|体型|body/i.test(instr)
      const touchClothing = /衣服|服装|穿着|穿搭|clothing|outfit/i.test(instr)
      const touchAll = !touchFace && !touchBody && !touchClothing
      // 调 AI 看图生成详细描述
      if (newUrl) {
        try {
          const res = await callDescribeCharImg({
            data: {
              imageUrl: newUrl,
              characterName: c.name,
              characterRoleLabel: c.roleLabel,
              characterAge: c.age,
              lookLabel: lk?.label || '默认',
            },
          })
          if (res?.ok) {
            setData((prev) => {
              if (!prev) return prev
              return {
                ...prev,
                characters: prev.characters.map((x) => {
                  if (x.id !== c.id) return x
                  const append = (orig: string | undefined, userInstr: string) =>
                    orig ? `${orig}\n【用户要求】${userInstr}` : userInstr
                  if (lookId == null) {
                    return {
                      ...x,
                      faceDescription: touchAll || touchFace ? append(res.faceDescription || x.faceDescription, instruction) : x.faceDescription,
                      bodyDescription: touchAll || touchBody ? append(res.bodyDescription || x.bodyDescription, instruction) : x.bodyDescription,
                      clothingDescription: touchAll || touchClothing ? append(res.clothingDescription || x.clothingDescription, instruction) : x.clothingDescription,
                    }
                  }
                  return {
                    ...x,
                    looks: (x.looks ?? []).map((lk2) =>
                      lk2.id !== lookId
                        ? lk2
                        : {
                            ...lk2,
                            faceDescription: touchAll || touchFace ? append(res.faceDescription || lk2.faceDescription, instruction) : lk2.faceDescription,
                            bodyDescription: touchAll || touchBody ? append(res.bodyDescription || lk2.bodyDescription, instruction) : lk2.bodyDescription,
                            clothingDescription: touchAll || touchClothing ? append(res.clothingDescription || lk2.clothingDescription, instruction) : lk2.clothingDescription,
                          },
                    ),
                  }
                }),
              }
            })
            toast.success('文字描述已同步到新图')
            // 立即保存,避免刷新后数据丢失
            void handleSaveWorkspace({ silent: true })
          } else {
            console.warn('[describeCharacterImage] failed:', res?.error)
          }
        } catch (e) {
          console.warn('[describeCharacterImage] error:', e)
        }
      }
    }
    setModBusy(false)
    if (ok) {
      closeModPanel()
    } else {
      setModError('生成失败,请重试或换更简单的修改')
    }
  }

  /**
   * 2026/06:从右侧对话框引用消息提交角色修改(不打开 modal)。
   * 逻辑同 submitModPanel 但不需要 modPanel state。
   */
  async function submitModPanelRef(c: GenCharacter, lookId: string | null, instruction: string) {
    const imageKey = lookId == null ? c.id : `${c.id}::${lookId}`
    const coverUrl = charImages[imageKey]?.at(-1)
    if (!coverUrl) { toast.error('该角色还没有图片'); return }
    const ok = await doRegen(c, lookId, 'modify', instruction)
    if (ok) {
      // 同 submitModPanel:AI 看图描述 + 追加用户意见
      const newUrl = charImagesRef.current[imageKey]?.at(-1)
      const lk = lookId == null ? null : c.looks?.find((x) => x.id === lookId) ?? null
      if (newUrl) {
        try {
          const res = await callDescribeCharImg({
            data: {
              imageUrl: newUrl,
              characterName: c.name,
              characterRoleLabel: c.roleLabel,
              characterAge: c.age,
              lookLabel: lk?.label || '默认',
            },
          })
          if (res?.ok) {
            setData((prev) => {
              if (!prev) return prev
              const append = (orig: string | undefined, userInstr: string) =>
                orig ? `${orig}\n【用户要求】${userInstr}` : userInstr
              return {
                ...prev,
                characters: prev.characters.map((x) => {
                  if (x.id !== c.id) return x
                  if (lookId == null) {
                    return {
                      ...x,
                      faceDescription: append(res.faceDescription || x.faceDescription, instruction),
                      bodyDescription: append(res.bodyDescription || x.bodyDescription, instruction),
                      clothingDescription: append(res.clothingDescription || x.clothingDescription, instruction),
                    }
                  }
                  return {
                    ...x,
                    looks: (x.looks ?? []).map((lk2) =>
                      lk2.id !== lookId ? lk2 : {
                        ...lk2,
                        faceDescription: append(res.faceDescription || lk2.faceDescription, instruction),
                        bodyDescription: append(res.bodyDescription || lk2.bodyDescription, instruction),
                        clothingDescription: append(res.clothingDescription || lk2.clothingDescription, instruction),
                      },
                    ),
                  }
                }),
              }
            })
          }
        } catch { /* 描述更新失败不阻塞 */ }
      }
      toast.success('已按意见重生')
      // 立即保存,确保修改后的图片和描述不会丢失
      void handleSaveWorkspace({ silent: true })
    } else {
      toast.error('生成失败')
    }
  }

  /**
   * 2026/06:从右侧对话框引用消息提交场景修改(不打开 modal)。
   */
  async function submitSceneModPanelRef(s: GenScene, instruction: string) {
    const coverUrl = sceneImages[s.id]?.at(-1)
    if (!coverUrl) { toast.error('该场景还没有图片'); return }
    const ok = await doSceneRegen(s, 'modify', instruction)
    if (ok) {
      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          scenes: prev.scenes.map((x) =>
            x.id === s.id ? { ...x, action: instruction } : x,
          ),
        }
      })
      toast.success('已按意见重生')
      void handleSaveWorkspace({ silent: true })
    } else {
      toast.error('生成失败')
    }
  }

  /**
   * 2026/06:以用户意见更新角色描述字段(不调 AI)。
   */
  function updateDescriptionFromInstruction(c: GenCharacter, lookId: string | null, instruction: string) {
    const instr = instruction.toLowerCase()
    const updateFields: { face?: string; body?: string; clothing?: string } = {}
    if (/脸|面容|五官|face/i.test(instr)) updateFields.face = instruction
    if (/身材|体型|body/i.test(instr)) updateFields.body = instruction
    if (/衣服|服装|穿着|穿搭|clothing|outfit/i.test(instr)) updateFields.clothing = instruction
    if (!Object.keys(updateFields).length) {
      updateFields.face = instruction
      updateFields.body = instruction
      updateFields.clothing = instruction
    }
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        characters: prev.characters.map((x) => {
          if (x.id !== c.id) return x
          if (lookId == null) {
            return {
              ...x,
              ...(updateFields.face && { faceDescription: updateFields.face }),
              ...(updateFields.body && { bodyDescription: updateFields.body }),
              ...(updateFields.clothing && { clothingDescription: updateFields.clothing }),
            }
          }
          return {
            ...x,
            looks: (x.looks ?? []).map((lk2) =>
              lk2.id !== lookId
                ? lk2
                : {
                    ...lk2,
                    ...(updateFields.face && { faceDescription: updateFields.face }),
                    ...(updateFields.body && { bodyDescription: updateFields.body }),
                    ...(updateFields.clothing && { clothingDescription: updateFields.clothing }),
                  },
            ),
          }
        }),
      }
    })
  }

  // 卡片"三视图" / "多维资产图"按钮:无 user input,直接跑预定义指令
  //
  // 注意:multi-asset 模式的具体布局/格子数/中文标注/特征保留 等硬约束**全部
  // 写在 seedream.functions.ts 的 buildCharacterPrompts() 里**(2026/06 用户重写),
  // 不在这里。这里只传一个简短的 user-facing 指令作为 EDIT REQUEST 写到 prompt
  // 里(让 LLM 看到用户的语义),但实际渲染逻辑由 seedream 端的 mode='multi-asset'
  // 分支自包含决定。
  async function runPresetRegen(
    c: GenCharacter,
    lookId: string | null,
    mode: 'three-view' | 'multi-asset',
  ) {
    const instruction = mode === 'three-view'
      ? '根据此形象生成标准三视图:同一角色分别从前、正侧、背三个角度展示,头到脚全身,脸/身材/衣服在三个视图里完全一致。'
      : '生成完整的【角色多维资产图】:简介(名字+个性)+ 大型主肖像 + 全身三视图(正/侧/背)+ 6-8 种表情(开心/生气/困倦/惊讶/悲伤/常态…)+ 4-6 种动作姿势(按个性挑)+ 配饰/道具图标,白底,中文标注,保留角色全部特征。'
    await doRegen(c, lookId, mode, instruction)
  }

  /**
   * 场景图重生(2026/06 新增) —— 对称 doRegen。
   * 模式 'modify' / 'three-view'。三视图对场景来说 = wide/medium/close-up
   * 三个景别变体(不是 front/side/back),具体语义在 seedream.functions.ts
   * 的 buildScenePrompts。
   */
  async function doSceneRegen(
    s: GenScene,
    mode: 'modify' | 'three-view',
    instruction: string,
  ) {
    const history = sceneImages[s.id] ?? []
    // 2026/06:跟角色 selectedCharImages 对称 —— 优先用用户"选中"的那张作 reference,
    // 没选 / 选中的 url 已不在 history 里 → fallback 最新一张
    const pinned = selectedSceneImagesRef.current[s.id]
    const referenceUrl = (pinned && history.includes(pinned))
      ? pinned
      : history.at(-1)
    if (!referenceUrl) {
      toast.error('该场景还没生成,无法重生')
      return false
    }
    if (mode === 'modify' && !instruction.trim()) {
      toast.error('请输入修改意见')
      return false
    }
    setRegenBusyKeys((m) => {
      const n = new Map(m)
      n.set(s.id, mode)
      return n
    })
    try {
      const res = await callRegenScene({
        data: {
          referenceImageUrl: referenceUrl,
          userInstruction: instruction,
          mode,
          sceneSlug: s.slug,
          sceneLocation: s.location,
          sceneTimeOfDay: s.timeOfDay,
          sceneAction: s.action,
          projectStyle: project?.style,
          model: resolveI2IModel(project?.sceneModel),
          previewOnly: viewPromptsModeRef.current,
        },
      })
      // 2026/06:查看提示词模式拦截
      if (interceptPromptPreview(
        `场景 ${s.slug} · ${mode === 'three-view' ? '三视图' : '修改'}`,
        res,
      )) {
        return true
      }
      if (res?.ok && res.url) {
        // 2026/06 修复:ARK TOS URL <img> 加载失败，先 await 转 base64
        const base64Url = await toBase64WithFallback(res.url)
        const displayUrl = base64Url ?? res.url
        setSceneImages((m) => ({ ...m, [s.id]: [...(m[s.id] ?? []), displayUrl] }))
        toast.success(mode === 'three-view' ? '已生成场景三视图' : '已按意见重生')
        return true
      }
      toast.error(classifyError(res?.error, '生成失败'))
      return false
    } catch {
      toast.error(classifyError(undefined, '生成失败'))
      return false
    } finally {
      setRegenBusyKeys((m) => {
        if (!m.has(s.id)) return m
        const n = new Map(m)
        n.delete(s.id)
        return n
      })
    }
  }

  /** 场景"三视图"按钮:无 user input,直接跑预设指令(同角色 runPresetRegen 模式) */
  async function runScenePresetRegen(s: GenScene) {
    await doSceneRegen(
      s,
      'three-view',
      '基于该场景生成 3 景别参考图(wide establishing + medium + close-up detail),同一地点同一时段同一视觉风格,无人物,纯环境。',
    )
  }

  // ============= 道具图片操作(2026/06 新增,与场景对称) =============

  /**
   * 道具图重生 —— 对称于 doSceneRegen。
   */
  async function doPropRegen(
    p: GenProp,
    mode: 'modify' | 'three-view',
    instruction: string,
  ) {
    const history = propImages[p.id] ?? []
    const pinned = selectedPropImagesRef.current[p.id]
    const referenceUrl = (pinned && history.includes(pinned))
      ? pinned
      : history.at(-1)
    if (!referenceUrl) {
      toast.error('该道具还没生成,无法重生')
      return false
    }
    if (mode === 'modify' && !instruction.trim()) {
      toast.error('请输入修改意见')
      return false
    }
    setRegenBusyKeys((m) => {
      const n = new Map(m)
      n.set(p.id, mode)
      return n
    })
    try {
      const res = await callRegenScene({
        data: {
          referenceImageUrl: referenceUrl,
          userInstruction: instruction,
          mode,
          sceneSlug: p.name,
          sceneLocation: p.description,
          sceneTimeOfDay: 'DAY' as const,
          sceneAction: p.movementDescription,
          projectStyle: project?.style,
          model: resolveI2IModel(project?.sceneModel),
          previewOnly: viewPromptsModeRef.current,
        },
      })
      if (interceptPromptPreview(
        `道具 ${p.name} · ${mode === 'three-view' ? '三视图' : '修改'}`,
        res,
      )) {
        return true
      }
      if (res?.ok && res.url) {
        // 2026/06 修复:ARK TOS URL <img> 加载失败，先 await 转 base64
        const base64Url = await toBase64WithFallback(res.url)
        const displayUrl = base64Url ?? res.url
        setPropImages((m) => ({ ...m, [p.id]: [...(m[p.id] ?? []), displayUrl] }))
        toast.success(mode === 'three-view' ? '已生成道具三视图' : '已按意见重生')
        return true
      }
      toast.error(classifyError(res?.error, '生成失败'))
      return false
    } catch {
      toast.error(classifyError(undefined, '生成失败'))
      return false
    } finally {
      setRegenBusyKeys((m) => {
        if (!m.has(p.id)) return m
        const n = new Map(m)
        n.delete(p.id)
        return n
      })
    }
  }

  /** 道具"三视图"按钮:无 user input,直接跑预设指令 */
  async function runPropPresetRegen(p: GenProp) {
    await doPropRegen(
      p,
      'three-view',
      '基于该道具生成 3 个不同角度的展示图(正面/侧面/俯视或细节特写),纯色背景,无人物,同一道具在不同视角下外观一致。',
    )
  }

  // ============= 道具"修改"输入弹层(对齐场景) =============

  function openPropModPanel(p: GenProp) {
    setPropModOpen(p)
    setPropModInput('')
    setPropModError(null)
  }

  function closePropModPanel() {
    if (propModBusy) return
    setPropModOpen(null)
    setPropModInput('')
    setPropModError(null)
  }

  async function submitPropModPanel() {
    if (!propModOpen || propModBusy) return
    const instruction = propModInput.trim()
    if (!instruction) {
      setPropModError('请输入修改意见')
      return
    }
    setPropModBusy(true)
    setPropModError(null)
    const ok = await doPropRegen(propModOpen, 'modify', instruction)
    setPropModBusy(false)
    if (ok) {
      closePropModPanel()
    } else {
      setPropModError('生成失败,请重试或换更简单的修改')
    }
  }

  // ============= 场景"修改"输入弹层(对齐角色 openModPanel / closeModPanel / submitModPanel) =============

  function openSceneModPanel(s: GenScene) {
    setSceneModOpen(s)
    setSceneModInput('')
    setSceneModError(null)
  }

  function closeSceneModPanel() {
    if (sceneModBusy) return
    setSceneModOpen(null)
    setSceneModInput('')
    setSceneModError(null)
  }

  async function submitSceneModPanel() {
    if (!sceneModOpen || sceneModBusy) return
    const instruction = sceneModInput.trim()
    if (!instruction) {
      setSceneModError('请输入修改意见')
      return
    }
    setSceneModBusy(true)
    setSceneModError(null)
    const ok = await doSceneRegen(sceneModOpen, 'modify', instruction)
    setSceneModBusy(false)
    if (ok) {
      closeSceneModPanel()
    } else {
      setSceneModError('生成失败,请重试或换更简单的修改')
    }
  }


  async function genPanelImage(p: StoryboardPanel) {
    if (busyPanel) return
    setBusyPanel(p.id)
    try {
      const scene = data.scenes.find((s) => s.id === p.sceneId)
      // 分镜也跟随项目视觉风格,避免出现"角色是动漫风 / 分镜是写实"
      // 这种割裂。分镜不需要"纯白背景"(分镜本身有场景),所以只注入风格。
      const styleSpec = resolveProjectStyle(project?.style)
      const prompt = [
        `[VISUAL STYLE — must follow the project's art direction]`,
        buildStyleLock(styleSpec, 'panel'),
        `---`,
        scene?.slug && `Scene: ${scene.slug}`,
        `Shot ${p.shot}: ${p.camera}`,
        p.action, p.emotion && `mood: ${p.emotion}`,
        'cinematic storyboard panel, dramatic composition, film still, consistent with the character design established by the reference sheet',
      ].filter(Boolean).join('. ')
      const res = await callImage({ data: { prompt, model: project?.storyboardModel } })
      if (res.url) {
        // 2026/06 修复:ARK TOS URL <img> 加载失败,先 await 转 base64
        const base64Url = await toBase64WithFallback(res.url)
        setPanelImages((m) => ({ ...m, [p.id]: base64Url ?? res.url! }))
      } else {
        toast.error(classifyError(res.error, '生成失败'))
      }
    } catch {
      toast.error(classifyError(undefined, '生成失败'))
    } finally {
      setBusyPanel(null)
    }
  }

  // ====================================================================
  // 新的分镜流程 —— 两条 server function 入口
  //   1) runEnterStoryboard:把当集剧情发给 AI → 生成多组 StoryboardGroup
  //   2) generateShotImageForGroup:对单个 group 的某个 shot,做多图融合
  // ====================================================================

  /**
   * 从当集剧情生成多组 StoryboardGroup。
   * 流程:
   *  1) 取选中的 episode 文本(默认 selectedEpisodeIndex)
   *  2) 拼角色 / 场景摘要
   *  3) 调 generateStoryboardFromPlot server function
   *  4) 把返回的 groups 存到 data.storyboardGroups
   *  5) 切到 storyboard tab
   */
  function handleInsertGroup(anchor: 'first' | 'last' | string) {
    setData((d) => {
      const newGroup = createEmptyGroup(selectedEpisodeIndex)
      const groups = [...d.storyboardGroups]
      let insertPos: number
      if (anchor === 'first') {
        insertPos = 0
      } else if (anchor === 'last') {
        insertPos = groups.length
      } else {
        // anchor 是 groupId:插入到该组之后
        const idx = groups.findIndex((g) => g.id === anchor)
        insertPos = idx >= 0 ? idx + 1 : groups.length
      }
      groups.splice(insertPos, 0, newGroup)
      return { ...d, storyboardGroups: reindexGroups(groups) }
    })
    setShowNewGroupModal(false)
    toast.success('已添加空分镜组')
  }

  function handleDeleteGroup(groupId: string) {
    setData((d) => {
      const groups = d.storyboardGroups.filter((g) => g.id !== groupId)
      return { ...d, storyboardGroups: reindexGroups(groups) }
    })
    toast.success('已删除分镜组')
  }

  async function runEnterStoryboard() {
    if (busyStoryboardGen) return
    const ep = data.episodeTexts.find((e) => e.epIndex === selectedEpisodeIndex)
    const epText = ep?.text?.trim() ?? ''
    if (!epText) {
      toast.error('当集剧本为空,请先在"分集"标签生成剧本')
      return
    }
    // 只检查当集是否有角色(其他集的角色不能用来切分当集剧情)
    const epChars = data.characters.filter((c) => c.episodes.includes(selectedEpisodeIndex))
    if (!epChars.length) {
      toast.error(`第 ${selectedEpisodeIndex} 集还没有角色,请先在"角色"标签提取本集角色`)
      return
    }
    setBusyStoryboardGen(true)
    try {
      // 只用当集的角色/场景做切分(避免别集的角色污染剧情理解)
      const epChars = data.characters.filter((c) => c.episodes.includes(selectedEpisodeIndex))
      const epScenes = data.scenes.filter((s) => s.episodeIndex === selectedEpisodeIndex)
      const charSummaries = epChars.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.roleLabel,
        profile: [
          c.gender && `性别:${c.gender}`,
          `年龄:${c.age}`,
          c.faceDescription && `面部:${c.faceDescription.slice(0, 120)}`,
          c.clothingDescription && `服装:${c.clothingDescription.slice(0, 120)}`,
        ]
          .filter(Boolean)
          .join('; '),
      }))
      const sceneSummaries = epScenes.map((s) => ({
        id: s.id,
        slug: s.slug,
        location: s.location,
        timeOfDay: s.timeOfDay,
        profile: (s.action || '').slice(0, 200),
      }))
      // 前面所有集数作为上下文
      const prevEps = data.episodeTexts
        .filter((e) => e.epIndex < selectedEpisodeIndex)
        .sort((a, b) => a.epIndex - b.epIndex)
        .map((e) => `—— 第 ${e.epIndex} 集 ——\n${e.text}`)
        .join('\n\n')
      // 2026/06 流式改造:server fn 现在 yield 事件,每组就绪就立刻 push。
      //   - 先清掉当集老分镜,避免和流入的新组混着展示
      //   - **不**主动 setTab('storyboard'),等对话框 runWorkflowAnimation
      //     收尾后再 jumpAfter:true 自然跳过去(用户选 B,保留原动画完整感);
      //     这期间 stream 在后台跑、groups 静默 append,跳过去时已有不少组
      //   - 在 storyboard tab 空态按钮直接触发的场景没影响:用户已在分镜 tab
      //   - for-await 消费;group 事件 → 追加到 storyboardGroups
      //   - error / done 事件 → 终止 / 收尾
      setData((d) => ({
        ...d,
        storyboardGroups: d.storyboardGroups.filter((g) => g.episodeIndex !== selectedEpisodeIndex),
      }))
      // 2026/06:同步清掉 plotText 行内编辑的 draft —— 老 group id 已被 wipe,留着会占内存
      // 且下一次编辑同 id 的新 group 时可能误用旧草稿。
      setGroupPlotDraft({})
      setEditingGroupId(null)
      const stream = (await callGenerateStoryboard({
        data: {
          episodeText: epText,
          episodeIndex: selectedEpisodeIndex,
          characterSummaries: charSummaries,
          sceneSummaries: sceneSummaries,
          groupCount: 0, // 0 = 不设上限,让 AI 按剧情自行决定
          previousEpisodesText: prevEps || undefined,
          projectStyle: project?.style,
        },
      })) as AsyncIterable<
        | { kind: 'progress'; message: string }
        | { kind: 'group'; group: Omit<StoryboardGroup, 'episodeIndex' | 'sceneLocation'> }
        | { kind: 'done'; model: string; count: number }
        | { kind: 'error'; message: string }
      >
      let receivedCount = 0
      let lastError: string | null = null
      for await (const ev of stream) {
        if (ev.kind === 'group') {
          const sc = sceneSummaries.find((s) => s.id === ev.group.sceneId)
          const enriched: StoryboardGroup = {
            ...ev.group,
            episodeIndex: selectedEpisodeIndex,
            sceneLocation: sc?.location || sc?.slug,
          }
          // composePlotText 现在只剥老数据的【本组分镜】尾巴(不再覆盖 AI prose),
          // 保留 server 端 LLM 写的详细剧情扩写
          enriched.plotText = composePlotText(enriched)
          setData((d) => ({
            ...d,
            storyboardGroups: [...d.storyboardGroups, enriched],
          }))
          receivedCount++
          if (receivedCount === 1) {
            toast.success('第一组分镜已就绪,后续将陆续到达…')
          }
        } else if (ev.kind === 'error') {
          lastError = ev.message
          break
        } else if (ev.kind === 'done') {
          // 服务端正常结束
          break
        }
        // progress 事件目前只用于 console 调试,UI 上 busyStoryboardGen 已经显示"切分中…"
      }
      if (lastError) {
        toast.error(lastError)
      } else if (receivedCount > 0) {
        toast.success(`已生成 ${receivedCount} 组分镜`)
      } else {
        toast.error('未生成任何分镜,请重试')
      }
    } catch (e) {
      toast.error(e instanceof Error ? classifyError(e.message, '分镜生成失败') : '分镜生成失败')
    } finally {
      setBusyStoryboardGen(false)
    }
  }

  /**
   * 2026/06 二次改造:之前 composePlotText 把 AI 的 prose plotText 用机械的
   * "分镜N: 时段 · 景别 · 动作" 列表覆盖,导致用户看不到 LLM 输出的详细剧情。
   * 用户最新诉求:plotText 要详细扩写(状态/环境/动作/具体台词/后续),严格遵循
   * 剧本逻辑。server 端 prompt 已改成让 AI 输出 200~800 字详细 prose;
   * 客户端这里**不再覆盖**,直接保留 AI 的原文。
   *
   * shot 信息(景别/动作/机位)已经在每个 shot 卡片的 <details> 里独立展示,
   * 不需要塞回 plotText 顶部重复。
   *
   * 函数保留是为了:
   *   - 老数据兼容(plotText 历史上可能带 "【本组分镜】..." 尾巴,这里剥掉)
   *   - 三处调用点(streaming append / useEffect 同步 / 直接调)签名不变
   *
   * 返回:AI 的 plotText 剥掉历史尾巴后的原文。
   */
  function composePlotText(g: StoryboardGroup): string {
    const raw = g.plotText ?? ''
    // 老数据可能含 "【本组分镜】..." 尾巴(2026/06 之前 composePlotText 的产物),
    // 剥掉,只保留 AI 写的那部分;新数据没这尾巴,split 不影响。
    return raw.split(/\n\n【本组分镜】/)[0].trimEnd()
  }

  /**
   * 更新某个 shot 涉及某个角色的 reference look(imageKey)。
   * 用户在分镜卡片里通过下拉切换"该 shot 用角色的哪套形象" —— 数据落到
   * data.storyboardGroups[gIdx].shots[sIdx].characterRefs[cid]。
   *
   * 后续生成分镜图(generateShotImageForGroup)会读 s.characterRefs?.[cid]
   * 拼 imageKey,不再硬编码用默认 look。
   */
  function updateShotCharacterRef(groupId: string, shotId: string, characterId: string, imageKey: string) {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        storyboardGroups: prev.storyboardGroups.map((g) => {
          if (g.id !== groupId) return g
          return {
            ...g,
            shots: g.shots.map((s) => {
              if (s.id !== shotId) return s
              return {
                ...s,
                characterRefs: {
                  ...(s.characterRefs ?? {}),
                  [characterId]: imageKey,
                },
              }
            }),
          }
        }),
      }
    })
  }

  /**
   * 2026/06 改造:在 plot 下方的人物小圆圈点开下拉,选具体变体。
   * 下拉直接传 variantId(不再是"循环到下一个"),所有同组 shot 的
   * characterRefs[cid] 一起更新。
   */
  function setCharacterLookInGroup(groupId: string, characterId: string, variantId: string) {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        storyboardGroups: prev.storyboardGroups.map((g) => {
          if (g.id !== groupId) return g
          return {
            ...g,
            shots: g.shots.map((s) => ({
              ...s,
              characterRefs: {
                ...(s.characterRefs ?? {}),
                [characterId]: variantId,
              },
            })),
          }
        }),
      }
    })
  }

  /**
   * 取得"当前 group 给 characterId 选中的形象"的 character 对象。
   * 优先级:group shot 的 characterRefs[characterId] > characterId 本身。
   */
  function getGroupSelectedChar(groupId: string, characterId: string): GenCharacter | undefined {
    const group = data.storyboardGroups.find((g) => g.id === groupId)
    const firstShot = group?.shots[0]
    const selectedId = firstShot?.characterRefs?.[characterId] ?? characterId
    return data.characters.find((c) => c.id === selectedId)
  }

  /**
   * 决定"该 shot 涉及的角色 c"用哪张图作为 Seedream 融合的 reference。
   * 优先级:
   *   1) shot.characterRefs[c.id] 指定的 imageKey + 该 imageKey 被用户"选中"钉住的 url
   *   2) shot.characterRefs[c.id] 指定的 imageKey 的最新一张
   *   3) 角色默认 look(c.id)的"选中"url
   *   4) 角色默认 look(c.id)的最新一张
   * 老 group 没 characterRefs 字段 → 自动走到 3/4 分支,行为完全向后兼容。
   */
  function pickShotCharImageUrl(shot: StoryboardShot | undefined, characterId: string): string | undefined {
    const explicitKey = shot?.characterRefs?.[characterId]
    const keysToTry = explicitKey
      ? [explicitKey, characterId] // 用户在 shot 里选过:先试选过的,再 fallback 默认
      : [characterId]              // 没选过:直接用默认 look
    for (const k of keysToTry) {
      const pinned = selectedCharImages[k]
      if (pinned) return pinned
      const arr = charImages[k]
      const latest = arr?.[arr.length - 1]
      if (latest) return latest
    }
    return undefined
  }

  /**
   * 2026/06:在 shot 上加 / 减角色(写入 shot.characterIds,fallback 路径
   * 下同时也写 group.characterIds,避免减完角色后下次又因为 fallback 出现)。
   * 操作:
   *   - add:    shot.characterIds.push(cid);group.characterIds 也确保包含
   *   - remove: shot.characterIds 移除;group.characterIds 不动(其他 shot 可能还要)
   */
  function setShotCharacterMembership(groupId: string, shotId: string, characterId: string, action: 'add' | 'remove') {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        storyboardGroups: prev.storyboardGroups.map((g) => {
          if (g.id !== groupId) return g
          const newGroupCharIds = action === 'add' && !g.characterIds.includes(characterId)
            ? [...g.characterIds, characterId]
            : g.characterIds
          return {
            ...g,
            characterIds: newGroupCharIds,
            shots: g.shots.map((s) => {
              if (s.id !== shotId) return s
              // 该 shot 当前 effective 列表(决定从哪改)
              const current = pickShotCharacterIds(s, g)
              const next = action === 'add'
                ? (current.includes(characterId) ? current : [...current, characterId])
                : current.filter((c) => c !== characterId)
              return { ...s, characterIds: next }
            }),
          }
        }),
      }
    })
  }

  /** 2026/06:在 group 层级添加/移除道具(与 setGroupCharacterIds 对称) */
  function setGroupPropIds(groupId: string, propId: string, action: 'add' | 'remove') {
    setData((d) => ({
      ...d,
      storyboardGroups: d.storyboardGroups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              propIds: action === 'add'
                ? [...(g.propIds ?? []), propId]
                : (g.propIds ?? []).filter((id) => id !== propId),
            }
          : g,
      ),
    }))
  }

  /** 2026/06:在 group 层级添加/移除场景(多选,与 setGroupCharacterIds 对称) */
  function setGroupSceneIds(groupId: string, sceneId: string, action: 'add' | 'remove') {
    setData((d) => ({
      ...d,
      storyboardGroups: d.storyboardGroups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              sceneIds: action === 'add'
                ? [...(g.sceneIds ?? []), sceneId]
                : (g.sceneIds ?? []).filter((id) => id !== sceneId),
            }
          : g,
      ),
    }))
  }

  /** 2026/06:覆盖设置 shot 的场景 id(null = 显式无场景) */
  function setShotScene(groupId: string, shotId: string, sceneId: string | null) {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        storyboardGroups: prev.storyboardGroups.map((g) => {
          if (g.id !== groupId) return g
          return {
            ...g,
            // 同时把该场景加到 group 的 scene 选项里(如果 group 还没设这个场景,设为它)
            // 这样未来如果把 shot 的 sceneId 清掉,能 fallback 到一个合理的 group scene
            sceneId: g.sceneId ?? sceneId ?? undefined,
            shots: g.shots.map((s) =>
              s.id === shotId ? { ...s, sceneId } : s,
            ),
          }
        }),
      }
    })
  }

  /**
   * 2026/06:在 group 层级加 / 减角色(直接写 group.characterIds)。
   *   - add:    group.characterIds 追加(已存在则不重复)
   *   - remove: group.characterIds 移除(其他 group 不受影响)
   * 下游所有 pickShotCharacterIds(shot, group) / 一键生成 / 故事板图 / 按意见重生
   * 都会通过回退链路读到最新的 group.characterIds,无需后端改动。
   */
  function setGroupCharacterIds(groupId: string, characterId: string, action: 'add' | 'remove') {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        storyboardGroups: prev.storyboardGroups.map((g) => {
          if (g.id !== groupId) return g
          const next = action === 'add'
            ? (g.characterIds.includes(characterId) ? g.characterIds : [...g.characterIds, characterId])
            : g.characterIds.filter((c) => c !== characterId)
          return { ...g, characterIds: next }
        }),
      }
    })
  }

  /**
   * 2026/06:设置 group 层级场景 id。同步把 sceneLocation 写成该场景的
   * location/slug,跟 runEnterStoryboard 行 2204 的格式保持一致,这样 header
   * 那行 📍 sceneLocation 标签能立即跟着变(否则会出现 dropdown 选了新场景
   * 但 header 📍 不动的视觉割裂)。
   *   - sceneId: 切到指定场景
   *   - null:    清空(group.sceneId = undefined,sceneLocation = undefined)
   */
  function setGroupScene(groupId: string, sceneId: string | null) {
    setData((prev) => {
      if (!prev) return prev
      const target = sceneId ? prev.scenes.find((s) => s.id === sceneId) : undefined
      return {
        ...prev,
        storyboardGroups: prev.storyboardGroups.map((g) => {
          if (g.id !== groupId) return g
          return {
            ...g,
            sceneId: sceneId ?? undefined,
            sceneLocation: target ? (target.location || target.slug) : undefined,
          }
        }),
      }
    })
  }

  /**
   * 2026/06:把 group.plotText 写回。draft 与现有值相同则 bail out。
   * 不在 useEffect 里跑(避免在编辑过程中被 composePlotText 覆盖)。
   */
  function commitGroupPlot(groupId: string) {
    const draft = groupPlotDraft[groupId]
    if (draft === undefined) { setEditingGroupId(null); return }
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        storyboardGroups: prev.storyboardGroups.map((g) =>
          g.id === groupId && g.plotText !== draft ? { ...g, plotText: draft } : g,
        ),
      }
    })
    setEditingGroupId((cur) => (cur === groupId ? null : cur))
  }

  /** 把 shot 的 override 全部清掉,恢复到 group 的默认 */
  function resetShotOverrides(groupId: string, shotId: string) {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        storyboardGroups: prev.storyboardGroups.map((g) => {
          if (g.id !== groupId) return g
          return {
            ...g,
            shots: g.shots.map((s) => {
              if (s.id !== shotId) return s
              const next: StoryboardShot = { ...s }
              delete next.characterIds
              delete next.sceneId
              return next
            }),
          }
        }),
      }
    })
  }

  /**
   * 对某个 StoryboardGroup 的某个 shot 做多图融合,产出最终分镜图。
   * 策略:
   *  - 角色图:从 charImages[角色ID] / charImages[角色ID::lookId] 取最新一张
   *  - 场景图:从 sceneImages[sceneId] 取最新一张(.at(-1))
   *  - 串行调用(并发 1)避免 Qwen 429 / 跑偏
   */
  async function generateShotImageForGroup(groupId: string, shotId: string) {
    if (busyShotImages.has(`${groupId}::${shotId}`)) return
    const group = data.storyboardGroups.find((g) => g.id === groupId)
    if (!group) return
    const shot = group.shots.find((s) => s.id === shotId)
    if (!shot) return

    // 准备角色图(从 group.characterIds 取)
    // ⚠️ qwen-image-2.0-pro 端点限制:0 张图 = T2I,1~3 张图 = I2I。
    //    超过 3 张会报 400 "Model 'qwen-image-2.0-2in1' supports 0~3 image content items"。
    //    策略:有场景图 → 最多 2 张角色图;无场景图 → 最多 3 张角色图。
    // 2026/06:按 shot 覆盖 > group 默认 取角色列表和场景。
    const shotCharIds = pickShotCharacterIds(shot, group)
    const shotSceneId = pickShotSceneId(shot, group)
    const charImageUrls: string[] = []
    const charNames: string[] = []
    const hasScene = !!(shotSceneId && sceneImages[shotSceneId]?.length)
    const maxChars = hasScene ? 2 : 3
    for (const cid of shotCharIds) {
      if (charImageUrls.length >= maxChars) break
      // 用 pickShotCharImageUrl 取该 shot 选定的该角色图 —— 优先按 shot.characterRefs + 选中 url
      const url = pickShotCharImageUrl(shot, cid)
      if (url) {
        charImageUrls.push(url)
        const ch = data.characters.find((c) => c.id === cid)
        charNames.push(ch?.name ?? cid)
      }
    }
    // 准备场景图(优先用用户选中的那张)
    let sceneImageUrl: string | undefined
    if (shotSceneId) {
      sceneImageUrl = pickSceneImageUrl(shotSceneId)
    }
    // 场景描述
    const sceneObj = data.scenes.find((s) => s.id === shotSceneId)

    setBusyShotImages((s) => {
      const n = new Set(s)
      n.add(`${groupId}::${shotId}`)
      return n
    })
    try {
      const res = await callGenerateShotImage({
        data: {
          plotText: group.plotText,
          shotType: shot.shotType,
          shotTypeLabel: shot.shotTypeLabel,
          action: shot.action,
          camera: shot.camera,
          characterImageUrls: charImageUrls,
          characterNames: charNames,
          sceneImageUrl,
          sceneLocation: sceneObj?.location || group.sceneLocation || '',
          sceneTimeOfDay: sceneObj?.timeOfDay || '',
          projectStyle: project?.style,
          // 2026/06 修复:历史上从来不传 model,导致用户切了 sceneModel
          // 也不影响分镜图,默认走 ARK Seedream。现在补上委派路由。
          model: resolveI2IModel(project?.sceneModel),
          previewOnly: viewPromptsModeRef.current,
        },
      })
      // 2026/06:查看提示词模式拦截
      if (interceptPromptPreview(`第 ${group.index} 组 · 分镜 ${shot.shotType} ${shot.shotTypeLabel}`, res)) {
        return
      }
      // 2026/06 修复:之前只检查 !res.ok,没检查 res.url。如果 server 返回
      // {ok: true, url: ''} 这种异常体(目前没观察到但属于防御性兜底),
      // 会写入 imageUrl='' + push 空串到 shotImages + toast "已生成",
      // 后续 allShotsHaveImage(every(imageUrl)) 看到空串(JS 里 falsy)
      // 不会误判,但 generateAllShotsForGroup 里 `if (shot.imageUrl) continue`
      // 看到空串仍 falsy,导致同一张图永远过不了守卫一直被重新生成 —— 循环 bug。
      // 加 url 守卫,空 url 走失败分支。
      if (!res.ok || !res.url) {
        toast.error(classifyError(res.error, '分镜图生成失败'))
        return
      }
      const imageKey = `${groupId}::${shotId}`
      // 2026/06 修复:立刻显示临时 URL,再后台异步转 base64
      const tempUrl = res.url
      setData((d) => ({
        ...d,
        storyboardGroups: d.storyboardGroups.map((g) =>
          g.id === groupId
            ? {
                ...g,
                shots: g.shots.map((sh) => (sh.id === shotId ? { ...sh, imageUrl: tempUrl } : sh)),
              }
            : g,
        ),
      }))
      setShotImages((m) => ({ ...m, [imageKey]: [...(m[imageKey] ?? []), tempUrl] }))
      if (user) {
        void toBase64WithFallback(tempUrl).then((base64Url) => {
          if (base64Url) {
            setData((d) => ({
              ...d,
              storyboardGroups: d.storyboardGroups.map((g) =>
                g.id === groupId
                  ? { ...g, shots: g.shots.map((sh) => (sh.id === shotId ? { ...sh, imageUrl: base64Url } : sh)) }
                  : g,
              ),
            }))
            setShotImages((m) => {
              const arr = m[imageKey]
              if (!arr) return m
              const idx = arr.lastIndexOf(tempUrl)
              if (idx === -1) return m
              const copy = [...arr]
              copy[idx] = base64Url
              return { ...m, [imageKey]: copy }
            })
          }
        })
      }
      toast.success(`分镜图 ${shot.shotTypeLabel} 已生成`)
    } catch (e) {
      toast.error(e instanceof Error ? classifyError(e.message, '分镜图生成失败') : '分镜图生成失败')
    } finally {
      setBusyShotImages((s) => {
        const n = new Set(s)
        n.delete(`${groupId}::${shotId}`)
        return n
      })
    }
  }

  /**
   * 一键为整个 group 的所有 shot 生成图(串行,避免 Qwen 撞限速 / 跑偏)
   */
  async function generateAllShotsForGroup(groupId: string) {
    const group = data.storyboardGroups.find((g) => g.id === groupId)
    if (!group) return
    for (const shot of group.shots) {
      if (shot.imageUrl) continue
      // eslint-disable-next-line no-await-in-loop
      await generateShotImageForGroup(groupId, shot.id)
    }
  }

  /**
   * 按用户意见重生分镜图(和 regenerateCharacterLook 同语义)。
   *  1) 取 group / shot,以及当前要修改的 referenceImageUrl(从 shotImages 取最新一张)
   *  2) 拼角色 / 场景参考(server 端再按 qwen 3 张上限截断)
   *  3) 调 callRegenShot,新图 push 到 shotImages 历史 + 写回 g.shots[i].imageUrl
   *  4) 自动选中新生成的那张,关闭 modInput
   */
  async function handleRegenShot() {
    if (!shotPreview || shotModBusy) return
    const { groupId, shotId } = shotPreview
    const group = data.storyboardGroups.find((g) => g.id === groupId)
    if (!group) return
    const shot = group.shots.find((s) => s.id === shotId)
    if (!shot) return
    const imageKey = `${groupId}::${shotId}`
    const generations = shotImages[imageKey] ?? []
    const currentIdx = Math.min(shotSelectedGenIdx, Math.max(0, generations.length - 1))
    const referenceUrl = generations[currentIdx] ?? shot.imageUrl
    const instruction = shotModInput.trim()
    if (!referenceUrl || !instruction) return

    // 2026/06:按 shot 覆盖 > group 默认 取角色 + 场景(同 generateShotImageForGroup)。
    const shotCharIds = pickShotCharacterIds(shot, group)
    const shotSceneId = pickShotSceneId(shot, group)
    const charImageUrls: string[] = []
    const charNames: string[] = []
    const hasScene = !!(shotSceneId && sceneImages[shotSceneId]?.length)
    const maxChars = hasScene ? 2 : 3
    for (const cid of shotCharIds) {
      if (charImageUrls.length >= maxChars) break
      const url = pickShotCharImageUrl(shot, cid)
      if (url) {
        charImageUrls.push(url)
        const ch = data.characters.find((c) => c.id === cid)
        charNames.push(ch?.name ?? cid)
      }
    }
    const sceneImageUrl = shotSceneId ? pickSceneImageUrl(shotSceneId) : undefined
    const sceneObj = data.scenes.find((s) => s.id === shotSceneId)

    setShotModBusy(true)
    try {
      const res = await callRegenShot({
        data: {
          referenceImageUrl: referenceUrl,
          userInstruction: instruction,
          plotText: group.plotText,
          shotType: shot.shotType,
          shotTypeLabel: shot.shotTypeLabel,
          action: shot.action,
          camera: shot.camera,
          characterImageUrls: charImageUrls,
          characterNames: charNames,
          sceneImageUrl,
          sceneLocation: sceneObj?.location || group.sceneLocation || '',
          sceneTimeOfDay: sceneObj?.timeOfDay || '',
          projectStyle: project?.style,
          // 2026/06 修复:跟 shot generate 调用对称,补 model 字段
          model: resolveI2IModel(project?.sceneModel),
          previewOnly: viewPromptsModeRef.current,
        },
      })
      // 2026/06:查看提示词模式拦截
      if (interceptPromptPreview(`第 ${group.index} 组 · 分镜重生 (${instruction.slice(0, 24)}…)`, res)) {
        setShotModBusy(false)
        return
      }
      if (res?.ok && res.url) {
        // 2026/06 修复:立刻显示临时 URL,再后台异步转 base64
        const tempUrl = res.url
        const newLen = (shotImages[imageKey]?.length ?? 0) + 1
        setShotImages((m) => ({ ...m, [imageKey]: [...(m[imageKey] ?? []), tempUrl] }))
        setData((d) => ({
          ...d,
          storyboardGroups: d.storyboardGroups.map((g) =>
            g.id === groupId
              ? { ...g, shots: g.shots.map((sh) => (sh.id === shotId ? { ...sh, imageUrl: tempUrl } : sh)) }
              : g,
          ),
        }))
        if (user) {
          void toBase64WithFallback(tempUrl).then((base64Url) => {
            if (base64Url) {
              setData((d) => ({
                ...d,
                storyboardGroups: d.storyboardGroups.map((g) =>
                  g.id === groupId
                    ? { ...g, shots: g.shots.map((sh) => (sh.id === shotId ? { ...sh, imageUrl: base64Url } : sh)) }
                    : g,
                ),
              }))
              setShotImages((m) => {
                const arr = m[imageKey]
                if (!arr) return m
                const idx = arr.lastIndexOf(tempUrl)
                if (idx === -1) return m
                const copy = [...arr]
                copy[idx] = base64Url
                return { ...m, [imageKey]: copy }
              })
            }
          })
        }
        setShotSelectedGenIdx(newLen - 1)
        setShotModInput('')
        toast.success('已按意见重生')
      } else {
        toast.error(res?.error || '重生失败')
      }
    } catch (e) {
      toast.error('重生失败')
    } finally {
      setShotModBusy(false)
    }
  }

  /**
   * 对某个 StoryboardGroup 生成短视频(整组所有分镜合成一个视频)。
   *
   * 流程(2026 改造 —— 从"每张分镜一个视频"改成"每组一个完整视频"):
   *  1) 收集本组所有 shot 的最新图片(按 shot 顺序),排成镜头序列
   *  2) 第一张图作为 first_frame(视频起始画面)
   *  3) 后续图作为 reference_image(引导模型按这些参考图生成连贯镜头变化)
   *  4) 拼 prompt = 整组剧情 + 每个 shot 的景别/动作/机位,让模型理解整个镜头序列
   *  5) 调 generateVideo(server 端 submit + poll 4min)
   *  6) 存到 groupVideos[groupId],UI 在右侧"视频 · Video"面板渲染 <video>
   *
   * 注意:视频 URL 24h 有效(跟图片永久 URL 行为不同)。
   * 后续若要长期保存得在 server 端下载转存到 Supabase Storage。
   */
  async function generateVideoForGroup(groupId: string) {
    const group = data.storyboardGroups.find((g) => g.id === groupId)
    if (!group) return

    if (groupVideos[groupId]?.status === 'running') {
      toast.message('该组视频正在生成中…')
      return
    }

    // 收集本组所有 shot 的最新图片(按 shot 顺序)
    const shotImagesList: { shot: typeof group.shots[number]; url: string }[] = []
    for (const s of group.shots) {
      const key = `${groupId}::${s.id}`
      const gens = shotImages[key] ?? []
      const url = gens.length ? gens[gens.length - 1] : s.imageUrl
      if (url) shotImagesList.push({ shot: s, url })
    }
    if (shotImagesList.length === 0) {
      toast.error('需要先生成该组的分镜图,才能生成视频')
      return
    }

    setGroupVideos((m) => ({ ...m, [groupId]: { url: '', status: 'running' } }))

    const firstFrame = shotImagesList[0].url
    const referenceUrls = shotImagesList.slice(1).map((x) => x.url)

    // 拼整组镜头序列的 prompt
    const shotDescriptions = shotImagesList
      .map((x, i) => {
        const cam = x.shot.camera ? ` (camera: ${x.shot.camera})` : ''
        return `Shot ${i + 1} [${x.shot.shotTypeLabel}] ${x.shot.action}${cam}`
      })
      .join(' → ')
    const prompt = [
      `[Storyboard sequence: ${group.plotText || ''}]`,
      ``,
      `Shot breakdown: ${shotDescriptions}`,
      ``,
      `Render as a single continuous video clip that flows through all ${shotImagesList.length} shots in order.`,
      `Camera transitions, lighting continuity, and character appearance MUST stay consistent across all shots.`,
      `Cinematic motion, smooth camera movement, photorealistic, 24fps.`,
    ].filter(Boolean).join('\n')

    // 2026/06:查看提示词模式 —— 视频 prompt 完全 client 端拼,这里直接弹 modal
    if (viewPromptsModeRef.current) {
      setPromptPreview({
        title: `第 ${group.index} 组 · 按分镜图生成视频`,
        prompt,
        extra: {
          model: project?.videoModel || 'happyhorse-1.0-r2v',
          route: '视频(按分镜图)',
          first_frame: firstFrame,
          referenceImages: referenceUrls.join(' / ') || '(none)',
          duration: '10s (fixed)',
          ratio: project?.aspect ?? '16:9',
        },
      })
      // 清掉 running 状态
      setGroupVideos((m) => {
        const { [groupId]: _, ...rest } = m
        return rest
      })
      return
    }

    try {
      const res = await callGenVideo({
        data: {
          prompt,
          imageUrl: firstFrame,
          referenceImageUrls: referenceUrls.length ? referenceUrls : undefined,
          // 多参考图模型:happyhorse-1.0-r2v (DashScope, 实测可用)
          // 单图模型 (happyhorse-1.0-i2v / Seedance) 会自动退化成只取 first_frame
          model: project?.videoModel || 'happyhorse-1.0-r2v',
          ratio: project?.aspect === '9:16' ? '9:16' : project?.aspect === '1:1' ? '1:1' : '16:9',
          duration: 10,  // 多镜头序列需要更长时间(默认 5s 不够)
          generateAudio: project?.audio === 'on',
          watermark: false,
        },
      })
      if (res.ok && res.videoUrl) {
        setGroupVideos((m) => ({ ...m, [groupId]: { url: res.videoUrl!, status: 'succeeded' } }))
        toast.success(`分镜组视频已生成 (${shotImagesList.length} 个镜头,${res.videoUrl ? '已就绪' : ''})`)
      } else {
        setGroupVideos((m) => ({ ...m, [groupId]: { url: '', status: 'failed' } }))
        toast.error(explainVideoError(res?.error))
      }
    } catch (e) {
      setGroupVideos((m) => ({ ...m, [groupId]: { url: '', status: 'failed' } }))
      toast.error(explainVideoError(e instanceof Error ? e.message : '视频生成失败'))
    }
  }

  /**
   * 2026/06 新增:基于"故事板图"生成整组视频(跟 generateVideoForGroup 并列)。
   *
   * 跟传统 generateVideoForGroup 的差别:
   *   - 那个用每张分镜图按时间序列作 reference,first_frame=第一张分镜图
   *   - 这个**只用故事板图**作为视觉锚点(first_frame=storyboard image),
   *     剧情文字 plotText 作为叙事参考写进 prompt
   *   - 适合"还没逐张生成分镜图、但故事板已就绪"的场景,或想让 AI 按故事板
   *     的画面分布/节奏直接出片
   *
   * 前置条件:groupStoryboards[groupId] 已 succeeded 且有 url。
   * 复用 groupVideos 同一槽位,后生成覆盖前生成(用户在两种模式间切换)。
   */
  async function generateVideoFromStoryboardForGroup(groupId: string) {
    const group = data.storyboardGroups.find((g) => g.id === groupId)
    if (!group) return

    if (groupVideos[groupId]?.status === 'running') {
      toast.message('该组视频正在生成中…')
      return
    }

    const storyboard = groupStoryboards[groupId]
    if (storyboard?.status !== 'succeeded' || !storyboard.url) {
      toast.error('请先生成该组的故事板,才能用故事板生成视频')
      return
    }

    setGroupVideos((m) => ({ ...m, [groupId]: { url: '', status: 'running' } }))

    // 收集 shot 描述当作叙事提示(可选,无图也行,只是给文字 context)
    const shotDescriptions = group.shots
      .map((s, i) => {
        const cam = s.camera ? ` (camera: ${s.camera})` : ''
        const time = s.startSec != null && s.endSec != null
          ? ` [${s.startSec.toFixed(0)}-${s.endSec.toFixed(0)}s]`
          : ''
        return `Shot ${i + 1}${time} [${s.shotTypeLabel}] ${s.action}${cam}`
      })
      .join(' → ')

    const prompt = [
      `[STORYBOARD-DRIVEN VIDEO GENERATION]`,
      `The attached first-frame image is a complete director's storyboard / pitch deck for this scene. It contains: shared creative direction, character & style reference, environment + top-down camera diagram, multiple numbered storyboard frames showing the shot sequence, lighting/mood notes, and audio/cinematography notes.`,
      ``,
      `Your task: produce a single continuous video clip that **brings the storyboard to life** — following the shot sequence, camera positions, lighting transitions, and overall mood as laid out in the storyboard. Use the storyboard's frame breakdown as the structural guide for what happens when.`,
      ``,
      `[NARRATIVE REFERENCE — plot context, secondary]`,
      group.plotText || '(无剧情摘要)',
      ``,
      shotDescriptions ? `[SHOT BREAKDOWN — for additional sequence hints]\n${shotDescriptions}` : '',
      ``,
      `[CONSTRAINTS]`,
      `- Render as ONE continuous video that flows through the storyboard's shot sequence in order`,
      `- Character appearance, lighting continuity, and environment must stay consistent across the clip (follow the storyboard's reference panels)`,
      `- Cinematic motion, smooth camera movement, ${(group.endSec - group.startSec).toFixed(0)}s duration target`,
      `- Photorealistic if the storyboard is photorealistic; illustration-style if the storyboard is illustration`,
      `- 24fps, polished post-processing matching the storyboard's mood notes`,
    ].filter(Boolean).join('\n')

    // 2026/06:查看提示词模式 —— 直接弹 modal
    if (viewPromptsModeRef.current) {
      setPromptPreview({
        title: `第 ${group.index} 组 · 按故事板生成视频`,
        prompt,
        extra: {
          model: project?.videoModel || 'happyhorse-1.0-r2v',
          route: '视频(按故事板)',
          first_frame: storyboard.url,
          referenceImages: '(none)',
          duration: `${Math.min(10, Math.max(5, Math.round(group.endSec - group.startSec)))}s`,
          ratio: project?.aspect ?? '16:9',
        },
      })
      setGroupVideos((m) => {
        const { [groupId]: _, ...rest } = m
        return rest
      })
      return
    }

    try {
      const res = await callGenVideo({
        data: {
          prompt,
          // 故事板图作为 first_frame —— 多数视频模型把 first_frame 当成构图/调性
          // 的强 anchor;模型会按 storyboard 的 panel 布局推导镜头序列
          imageUrl: storyboard.url,
          // 不传 referenceImageUrls —— 故事板自己就是综合 reference;
          // 再塞分镜图会让 r2v 模型困惑(参考图太多 + 风格统一压力大)
          model: project?.videoModel || 'happyhorse-1.0-r2v',
          ratio: project?.aspect === '9:16' ? '9:16' : project?.aspect === '1:1' ? '1:1' : '16:9',
          duration: Math.min(10, Math.max(5, Math.round(group.endSec - group.startSec))),
          generateAudio: project?.audio === 'on',
          watermark: false,
        },
      })
      if (res.ok && res.videoUrl) {
        setGroupVideos((m) => ({ ...m, [groupId]: { url: res.videoUrl!, status: 'succeeded' } }))
        toast.success('按故事板的视频已生成')
      } else {
        setGroupVideos((m) => ({ ...m, [groupId]: { url: '', status: 'failed' } }))
        toast.error(explainVideoError(res?.error))
      }
    } catch (e) {
      setGroupVideos((m) => ({ ...m, [groupId]: { url: '', status: 'failed' } }))
      toast.error(explainVideoError(e instanceof Error ? e.message : '视频生成失败'))
    }
  }

  /**
   * 对某个 StoryboardGroup 生成漫剧故事板图(Manga-Style Storyboard)。
   *
   * 收集本组的所有上下文:
   *   - 剧情(plotText) — 故事板整体叙事的来源,模型用来推断缺失的 panel
   *   - 场景(scene 的 slug / location / timeOfDay / profile) — 漫剧所有 panel 的环境背景
   *   - 角色(从 data.characters 查名字 + face/body/clothing 描述,最多 3 个) — 跨 panel 保持一致
   *   - 镜头(本组已有的 shot 列表) — 每 panel 的首帧画面 + 景别 + 动作 + 机位
   * 调 seedream.functions.ts:generateStoryboardPitchDeck(全 T2I,模型自主构图 6/8 格)。
   * 把返回的 storyboardUrl 存到 groupStoryboards,UI 替换"故事板占位"。
   */
  async function generateMangaStoryboardForGroup(groupId: string) {
    const group = data.storyboardGroups.find((g) => g.id === groupId)
    if (!group) return
    if (groupStoryboards[groupId]?.status === 'running') {
      toast.message('该故事板正在生成中…')
      return
    }

    setGroupStoryboards((m) => ({ ...m, [groupId]: { url: '', status: 'running' } }))

    // 2026/06:故事板 pitch deck 是"组级"产物,代表整组的视觉摘要。
    //   - 角色:用各 shot 有效角色列表的并集(任一 shot 显式加的角色都会进 pitch deck)
    //   - 场景:取**第一个 shot** 的有效场景(因为 pitch deck 通常展示主镜头画面)
    //   - 没有 shot 的空 group 才 fallback 到 group.characterIds / group.sceneId
    const unionCharIds = (() => {
      if (group.shots.length === 0) return group.characterIds ?? []
      const set = new Set<string>()
      for (const s of group.shots) {
        for (const cid of pickShotCharacterIds(s, group)) set.add(cid)
      }
      // 如果所有 shot 都没 override,set 跟 group.characterIds 完全一致
      // 但有 override 时,union 可能超过 group(显式 add 的角色)
      return Array.from(set)
    })()
    const deckSceneId = group.shots.length > 0
      ? pickShotSceneId(group.shots[0], group) ?? group.sceneId
      : group.sceneId
    const sceneObj = data.scenes.find((s) => s.id === deckSceneId)
    const scene = sceneObj
      ? {
          slug: sceneObj.slug,
          location: sceneObj.location,
          timeOfDay: sceneObj.timeOfDay,
          // GenScene 用 `action` 描述场景氛围,跟 profile 语义接近 —— 用它即可
          profile: sceneObj.action,
        }
      : undefined

    // 收集角色档案(2026/06:撤掉 .slice(0, 3) 让文字描述层全员上;
    // 图片层另有 4 张总上限,在下面 referenceImages 收集时挑)
    const characters = (unionCharIds || [])
      .map((cid) => {
        const c = data.characters.find((x) => x.id === cid)
        if (!c) return null
        return {
          name: c.name,
          roleLabel: c.roleLabel,
          age: c.age,
          faceDescription: c.faceDescription,
          bodyDescription: c.bodyDescription,
          clothingDescription: c.clothingDescription,
          palette: c.palette,
        }
      })
      .filter(Boolean) as Array<{
        name: string
        roleLabel?: string
        age?: number
        faceDescription?: string
        bodyDescription?: string
        clothingDescription?: string
        palette?: string[]
      }>

    // 2026/06:故事板 I2I 参考图收集
    //   - Seedream image 字段最多 4 张
    //   - 优先级:场景必占 1 张(用户诉求) → 剩余 ≤3 给角色
    //   - 无场景图时:全部 4 张给角色
    //   - 角色取图:selectedCharImages 优先(用户钉住的"已选中"图),否则 charImages 最新
    //   - 每张图配 label,在 prompt 里说明"图 N 是 X"
    const REF_MAX = 4
    const referenceImages: string[] = []
    const referenceImageLabels: string[] = []
    // 场景图(2026/06:用用户选中的那张,fallback 最新一张)
    const sceneImgUrl = deckSceneId ? pickSceneImageUrl(deckSceneId) : undefined
    if (sceneImgUrl) {
      referenceImages.push(sceneImgUrl)
      const sLabel = sceneObj
        ? `场景: ${sceneObj.location || sceneObj.slug}${sceneObj.timeOfDay ? ` · ${sceneObj.timeOfDay}` : ''}`
        : '场景'
      referenceImageLabels.push(sLabel)
    }
    // 角色图:按 unionCharIds(各 shot 有效角色的并集)顺序填,直到 4 张上限
    for (const cid of unionCharIds || []) {
      if (referenceImages.length >= REF_MAX) break
      const c = data.characters.find((x) => x.id === cid)
      if (!c) continue
      // 选中图优先,否则最新
      const pinned = selectedCharImages[c.id]
      const generations = charImages[c.id] ?? []
      const url = (pinned && generations.includes(pinned) ? pinned : generations.at(-1))
      if (!url) continue
      referenceImages.push(url)
      referenceImageLabels.push(`角色: ${c.name}${c.roleLabel ? ` (${c.roleLabel})` : ''}`)
    }

    // 收集本组的 shots(2026/06:每 shot 自带 startSec/endSec,
    // 这里把 startSec/endSec 一起传给 I2I 生成 call,prompt 里用时间范围描述)
    const groupDuration = (group.endSec ?? 0) - (group.startSec ?? 0)
    const perShotSec = group.shots.length > 0 ? groupDuration / group.shots.length : 5
    const shots = group.shots.map((s) => ({
      shotType: s.shotType,
      shotTypeLabel: s.shotTypeLabel,
      action: s.action,
      camera: s.camera,
      // 优先用真实 startSec/endSec 算时长,fallback perShotSec
      durationSec: (s.startSec != null && s.endSec != null) ? (s.endSec - s.startSec) : perShotSec,
      // 2026/06:也把 startSec / endSec 透传到 server,prompt 里可用精确时间区间
      startSec: s.startSec,
      endSec: s.endSec,
    }))

    try {
      const res = await callGenStoryboard({
        data: {
          projectStyle: project?.style,
          groupLabel: group.plotText?.slice(0, 60),
          plotText: group.plotText || '(无剧情摘要)',
          scene,
          characters,
          shots,
          referenceImages,
          referenceImageLabels,
          model: project?.storyboardModel,
          previewOnly: viewPromptsModeRef.current,
        },
      })
      // 2026/06:查看提示词模式拦截 —— 把 running 状态清掉(也别标 failed)
      if (interceptPromptPreview(`第 ${group.index} 组 · 故事板`, res)) {
        setGroupStoryboards((m) => {
          const { [groupId]: _, ...rest } = m
          return rest
        })
        return
      }
      if (res.ok && res.url) {
        // 2026/06:和其他图片一致 —— 先 await 转 base64 确保立即可见,入库 Supabase 作为额外兜底
        const base64Url = await toBase64WithFallback(res.url)
        let finalUrl = base64Url ?? res.url
        if (base64Url) {
          if (user && workspaceId) {
            callSaveOneStoryboard({
              data: { workspaceId, groupId, url: res.url },
            }).then((r) => {
              if (r.ok && r.persisted && r.url) {
                setGroupStoryboards((m) => {
                  const cur = m[groupId]
                  if (!cur || cur.url !== finalUrl) return m
                  return { ...m, [groupId]: { ...cur, url: r.url } }
                })
              }
            }).catch(() => {})
          }
          toast.success('故事板已生成')
        } else {
          if (user && workspaceId) {
            try {
              const r = await callSaveOneStoryboard({ data: { workspaceId, groupId, url: res.url } })
              if (r.ok && r.persisted && r.url) {
                finalUrl = r.url
                toast.success('故事板已生成')
              } else {
                toast.warning('故事板图片保存失败，临时链接 24h 内有效')
              }
            } catch {
              toast.warning('故事板图片保存失败，临时链接 24h 内有效')
            }
          } else {
            toast.warning('故事板图片保存失败，临时链接 24h 内有效')
          }
        }
        setGroupStoryboards((m) => ({ ...m, [groupId]: { url: finalUrl, status: 'succeeded' } }))
      } else {
        setGroupStoryboards((m) => ({ ...m, [groupId]: { url: '', status: 'failed' } }))
        toast.error(classifyError(res?.error, '故事板生成失败'))
      }
    } catch (e) {
      setGroupStoryboards((m) => ({ ...m, [groupId]: { url: '', status: 'failed' } }))
      toast.error(e instanceof Error ? classifyError(e.message, '故事板生成失败') : '故事板生成失败')
    }
  }

  /**
   * 2026/06:对当前故事板图按用户意见重生。
   * 跟 generateMangaStoryboardForGroup 类似,但传 referenceImageUrl(当前故事板)
   * 作 image 1,server 端 buildRegenPitchDeckPrompt 会写明"以图1为基础,
   * 只改用户提到的部分"。
   */
  async function handleRegenStoryboard() {
    if (!storyboardPreview || storyboardModBusy) return
    const { groupId } = storyboardPreview
    const group = data.storyboardGroups.find((g) => g.id === groupId)
    if (!group) return
    const current = groupStoryboards[groupId]
    if (!current?.url) return
    const instruction = storyboardModInput.trim()
    if (!instruction) return

    // 2026/06:跟 generateMangaStoryboardForGroup 一致 —— 用各 shot 有效角色并集 +
    //   第一个 shot 的有效场景,体现 shot 级 override。
    const unionCharIds = (() => {
      if (group.shots.length === 0) return group.characterIds ?? []
      const set = new Set<string>()
      for (const s of group.shots) {
        for (const cid of pickShotCharacterIds(s, group)) set.add(cid)
      }
      return Array.from(set)
    })()
    const deckSceneId = group.shots.length > 0
      ? pickShotSceneId(group.shots[0], group) ?? group.sceneId
      : group.sceneId
    const sceneObj = data.scenes.find((s) => s.id === deckSceneId)
    const scene = sceneObj
      ? {
          slug: sceneObj.slug,
          location: sceneObj.location,
          timeOfDay: sceneObj.timeOfDay,
          profile: sceneObj.action,
        }
      : undefined

    const characters = (unionCharIds || [])
      .map((cid) => {
        const c = data.characters.find((x) => x.id === cid)
        if (!c) return null
        return {
          name: c.name,
          roleLabel: c.roleLabel,
          age: c.age,
          faceDescription: c.faceDescription,
          bodyDescription: c.bodyDescription,
          clothingDescription: c.clothingDescription,
          palette: c.palette,
        }
      })
      .filter(Boolean) as Array<{
        name: string
        roleLabel?: string
        age?: number
        faceDescription?: string
        bodyDescription?: string
        clothingDescription?: string
        palette?: string[]
      }>

    const groupDuration = (group.endSec ?? 0) - (group.startSec ?? 0)
    const perShotSec = group.shots.length > 0 ? groupDuration / group.shots.length : 5
    const shots = group.shots.map((s) => ({
      shotType: s.shotType,
      shotTypeLabel: s.shotTypeLabel,
      action: s.action,
      camera: s.camera,
      durationSec: (s.startSec != null && s.endSec != null) ? (s.endSec - s.startSec) : perShotSec,
      startSec: s.startSec,
      endSec: s.endSec,
    }))

    // 收集参考图:场景 1 张 + 角色 ≤3 张,Seedream 上限 4 张
    const REF_MAX = 4
    const referenceImages: string[] = []
    const referenceImageLabels: string[] = []
    const sceneImgUrl = deckSceneId ? pickSceneImageUrl(deckSceneId) : undefined
    if (sceneImgUrl) {
      referenceImages.push(sceneImgUrl)
      referenceImageLabels.push(
        sceneObj ? `场景: ${sceneObj.location || sceneObj.slug}${sceneObj.timeOfDay ? ` · ${sceneObj.timeOfDay}` : ''}` : '场景',
      )
    }
    for (const cid of unionCharIds || []) {
      if (referenceImages.length >= REF_MAX) break
      const c = data.characters.find((x) => x.id === cid)
      if (!c) continue
      const pinned = selectedCharImages[c.id]
      const generations = charImages[c.id] ?? []
      const url = (pinned && generations.includes(pinned) ? pinned : generations.at(-1))
      if (!url) continue
      referenceImages.push(url)
      referenceImageLabels.push(`角色: ${c.name}${c.roleLabel ? ` (${c.roleLabel})` : ''}`)
    }

    setStoryboardModBusy(true)
    try {
      const res = await callRegenStoryboard({
        data: {
          referenceImageUrl: current.url,
          userInstruction: instruction,
          projectStyle: project?.style,
          groupLabel: group.plotText?.slice(0, 60),
          plotText: group.plotText || '(无剧情摘要)',
          scene,
          characters,
          shots,
          referenceImages,
          referenceImageLabels,
          model: project?.storyboardModel,
          previewOnly: viewPromptsModeRef.current,
        },
      })
      if (interceptPromptPreview(`第 ${group.index} 组 · 故事板按意见重生`, res)) {
        return
      }
      if (res?.ok && res.url) {
        const base64Url = await toBase64WithFallback(res.url)
        let finalUrl = base64Url ?? res.url
        if (base64Url) {
          if (user && workspaceId) {
            callSaveOneStoryboard({ data: { workspaceId, groupId, url: res.url } })
              .then((r) => { if (r.ok && r.persisted && r.url) { setGroupStoryboards((m) => { const cur = m[groupId]; if (!cur || cur.url !== finalUrl) return m; return { ...m, [groupId]: { ...cur, url: r.url } } }) } })
              .catch(() => {})
          }
          toast.success('已按意见重生故事板')
        } else {
          if (user && workspaceId) {
            try {
              const r = await callSaveOneStoryboard({ data: { workspaceId, groupId, url: res.url } })
              if (r.ok && r.persisted && r.url) { finalUrl = r.url; toast.success('已按意见重生故事板') }
              else { toast.warning('故事板图片保存失败，临时链接 24h 内有效') }
            } catch { toast.warning('故事板图片保存失败，临时链接 24h 内有效') }
          } else { toast.warning('故事板图片保存失败，临时链接 24h 内有效') }
        }
        setGroupStoryboards((m) => ({ ...m, [groupId]: { url: finalUrl, status: 'succeeded' } }))
        setStoryboardModInput('')
      } else {
        toast.error(res?.error || '故事板重生失败')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '故事板重生失败')
    } finally {
      setStoryboardModBusy(false)
    }
  }

  // Auto-generate real images for newly produced characters / storyboard panels.
  //
  // ⚠️ 串行生成(并发上限 = 1,跨角色也排队)。
  //
  // 历史经验:
  //   - 完全无并发 = 2 的时候,Qwen 同时给 N 个 429,代码 fallback 到不同 model,
  //     产生风格/构图/背景不一致的图。
  //   - 改并发 = 2 后:撞 429 概率仍偏高,DashScope 高峰排队时返回的图在
  //     "正视图 / 全身" 这种构图约束上很容易跑偏(仰视、半身、切头切脚),
  //     而且失败次数上去后整批失败率上升(因为 noFallback 锁了主 model)。
  //   - 串行 = 1 是最稳的选择:每一张图独占 DashScope 的请求槽,model 在
  //     单一上下文里能更稳定地服从 prompt 约束。代价是耗时 = N 角色 × N look
  //     × ~30s/张,但对"角色一致性"是质量优先,值得。
  //
  // 同一角色的多个 look 在 processCharacter 里已经是串行(for 循环),
  // 这里只需要把"跨角色"也排队,实现端到端的"一张接一张"。
  useEffect(() => {
    console.log(`[CHAR-AUTOGEN] useEffect 触发: dataLoaded=${dataLoaded} autoGen=${autoGen} chars=${data.characters.length} charImagesKeys=${Object.keys(charImages).length} ranSet=${[...autogenRanRef.current].join(',')}`)
    if (!dataLoaded) return
    if (!autoGen) return
    // 找出"还没跑过 autoGen 默认 look"的角色(无视 charImages 是否有图)。
    // 用 ref 而非 charImages 长度,避免老图持久化时 useEffect 不跑 + 状态机乱。
    // 2026/06 修法:用 autogenRanRef 记录已处理角色 id,处理过的跳。
    const charactersToStart: GenCharacter[] = []
    for (const c of data.characters) {
      if (busyChars.has(c.id)) continue
      if (autogenRanRef.current.has(c.id)) continue
      // 2026/06 修复:已有图片(从 workspace_data 恢复的)跳过,不重新生成
      if (charImages[c.id]?.length) continue
      charactersToStart.push(c)
    }
    console.log(`[CHAR-AUTOGEN] useEffect: charactersToStart=${charactersToStart.length} ids=${charactersToStart.map(c => c.id).join(',')}`)
    if (!charactersToStart.length) return
    // 标记为已处理(进 ref 集合),后续 useEffect 重跑就跳过
    charactersToStart.forEach((c) => autogenRanRef.current.add(c.id))
    // 串行:一个角色跑完才跑下一个。即便用户觉得慢,也不要在角色之间开并发 —
    // 撞 429 / 构图跑偏 / 整批失败率上升 这三个问题都跟并发直接相关。
    void (async () => {
      for (const c of charactersToStart) {
        // eslint-disable-next-line no-await-in-loop
        await processCharacter(c)
      }
    })()
    // deps:[autoGen, dataLoaded, data.characters.length]
    //   - dataLoaded 翻 0→1 → 跑 1 次(workspace 首次 mount)
    //   - autoGen 翻 0→1(用户切开关)→ 跑
    //   - data.characters.length 变化(用户提取新角色)→ 跑(ref 过滤老角色)
    // enrich 内部 setData 引起的引用变化 length 没变 → useEffect 不重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGen, dataLoaded, data.characters.length])

  useEffect(() => {
    if (!autoGen) return
    const pending = data.storyboard.filter((p) => !panelImages[p.id])
    if (!pending.length || busyPanel) return
    void (async () => {
      for (const p of pending) {
        // eslint-disable-next-line no-await-in-loop
        await genPanelImage(p)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.storyboard, autoGen])

  // Auto-generate scene images for newly produced scenes
  useEffect(() => {
    if (!autoGen) return
    const pending = data.scenes.filter((s) => !sceneImages[s.id]?.length)
    if (!pending.length || busyScene) return
    void (async () => {
      for (const s of pending) {
        // eslint-disable-next-line no-await-in-loop
        await genSceneImage(s)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.scenes, autoGen])

  // Auto-generate prop images for newly produced props
  useEffect(() => {
    if (!autoGen) return
    const pending = data.props.filter((p) => !propImages[p.id]?.length)
    if (!pending.length || busyProp) return
    void (async () => {
      for (const p of pending) {
        // eslint-disable-next-line no-await-in-loop
        await genPropImage(p)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.props, autoGen])

  const [initialChatInput, setInitialChatInput] = useState<string>('')
  useEffect(() => {
    try {
      const v = sessionStorage.getItem('workspace_prefill')
      if (v) {
        setInitialChatInput(v)
        sessionStorage.removeItem('workspace_prefill')
      }
    } catch {}
  }, [])

  // ============= Import script handler =============
  // Wired to the ZopiaChatPanel "导入剧本" CTA. Writes the parsed synopsis + episode
  // list to the workspace state, then jumps to the per-episode view. Overwrites any
  // existing episodes (matches the "import" semantics).
  function handleImportScript(result: ImportedScriptResult) {
    const sortedEps = [...result.episodes].sort((a, b) => a.epIndex - b.epIndex)
    const firstEp = sortedEps[0]?.epIndex ?? 1

    // 1. Synopsis state
    setSynopsisText(result.synopsis)
    setSynopsisDraft(result.synopsis)
    setSynopsisEditing(false)
    setSynopsisBubbles([])

    // 2. Episode list + next index
    setData((d) => ({
      ...d,
      episodeTexts: sortedEps,
      nextEpIndex: sortedEps.length > 0
        ? Math.max(...sortedEps.map((e) => e.epIndex)) + 1
        : 1,
    }))

    // 3. Selection + expansion
    setSelectedEpisodeIndex(firstEp)
    setExpandedEpisodes(new Set([firstEp]))

    // 4. Clear any in-flight streaming
    setEpisodeStreaming(false)
    setEpisodeBubbles([])
    setStreamingBubbleId(null)
    setAutoRunCompleteTarget(null)

    // 5. Jump to per-episode view
    setTab('episodes')

    toast.success(t.zp_import_success.replace('{{count}}', String(sortedEps.length)))
  }

  // ============= 新增集数(下拉「+ 新增集数」入口) =============
  // 延续已有集数索引(取 max(epIndex)+1;空项目从 1 起),不重置 selectedEpisodeIndex。
  // 提供两条路径:
  //   1) AI 生成:在 data.episodeTexts 里塞一条空记录,切到 script tab,然后调
  //      runScriptEpisode 走流式生成;前端能看到"生成中…"实时更新。
  //   2) 导入剧本:读 .txt/.md/.docx 文件,把内容作为本集文本写入;docx 用 mammoth。
  // 两条路径都会:
  //   - 选中新建的 epIndex,setExpandedEpisodes 展开它
  //   - 切到 script tab
  //   - toast 提示
  function computeNextEpIndex(): number {
    if (data.episodeTexts.length === 0) return 1
    return Math.max(...data.episodeTexts.map((e) => e.epIndex)) + 1
  }

  function openAddEpisodeDialog() {
    setAddEpisodeOpen(true)
  }
  function closeAddEpisodeDialog() {
    if (addEpisodeImporting) return
    setAddEpisodeOpen(false)
  }

  /**
   * 路径 1:AI 生成新一集。
   * 先把空记录写入 episodeTexts(让 UI 立刻出现新卡片),再切到 script tab 让
   * 流式生成开始写文本。生成完成后,runScriptEpisode 的 'done' 分支会用真实
   * 文本覆盖那条空记录。
   */
  async function handleAddEpisodeAI() {
    if (episodeStreaming || synopsisStreaming) {
      toast.error('当前正在流式生成,稍后再试')
      return
    }
    const newEpIndex = computeNextEpIndex()
    // 写空记录(去重,避免重复点击)
    setData((d) => {
      if (d.episodeTexts.some((e) => e.epIndex === newEpIndex)) return d
      return {
        ...d,
        episodeTexts: [...d.episodeTexts, { epIndex: newEpIndex, text: '' }].sort((a, b) => a.epIndex - b.epIndex),
        nextEpIndex: newEpIndex + 1,
      }
    })
    setSelectedEpisodeIndex(newEpIndex)
    setExpandedEpisodes((prev) => new Set(prev).add(newEpIndex))
    setAddEpisodeOpen(false)
    setTab('script')
    if (!synopsisText && !synopsisDraft) {
      toast.warning('当前还没有故事梗概,AI 会以"通用剧情"理解,效果可能一般;生成完可在「剧本」标签补充梗概后重跑。')
    }
    // 流式生成(runScriptEpisode 内部会自动用 synopsisText + 前面所有集作为上下文)
    await runScriptEpisode({
      epIndex: newEpIndex,
      sceneCount: data.nextSceneCount || 15,
      lang: 'zh',
    })
  }

  /**
   * 路径 2:从文件导入当集剧本。
   * 支持 .txt/.md 直接读;.docx 用 mammoth(懒加载)。整个文件内容作为本集文本,
   * 不做分集边界检测(已有的「导入剧本」全量导入入口在 ZopiaChatPanel,语义不同)。
   */
  async function handleAddEpisodeFilePicked(file: File | null | undefined) {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      toast.error('文件过大(>10MB),请拆分后重试')
      return
    }
    const lower = file.name.toLowerCase()
    if (!/\.(txt|md|docx)$/i.test(file.name)) {
      toast.error('仅支持 .txt / .md / .docx 文件')
      return
    }
    setAddEpisodeImporting(true)
    try {
      let text = ''
      if (lower.endsWith('.docx')) {
        // 懒加载 mammoth,避免把 .docx 解析塞进首屏
        const mod: any = await import('mammoth')
        const mammoth = mod.default ?? mod
        const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
        text = (result?.value ?? '').trim()
      } else {
        text = (await file.text()).trim()
      }
      if (text.length < 5) {
        toast.error('文件内容过短,无法作为本集剧本')
        return
      }
      const newEpIndex = computeNextEpIndex()
      setData((d) => {
        if (d.episodeTexts.some((e) => e.epIndex === newEpIndex)) return d
        return {
          ...d,
          episodeTexts: [...d.episodeTexts, { epIndex: newEpIndex, text }].sort((a, b) => a.epIndex - b.epIndex),
          nextEpIndex: newEpIndex + 1,
        }
      })
      setSelectedEpisodeIndex(newEpIndex)
      setExpandedEpisodes((prev) => new Set(prev).add(newEpIndex))
      setAddEpisodeOpen(false)
      setTab('script')
      toast.success(`已从文件添加第 ${newEpIndex} 集剧本`)
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : '读取文件失败')
    } finally {
      setAddEpisodeImporting(false)
      if (addEpisodeFileInputRef.current) addEpisodeFileInputRef.current.value = ''
    }
  }

  // 2026/06:per-item 保存角色到资产库。
  // - imageKey 形如 `${characterId}`(默认)或 `${characterId}::${lookId}`(变体)
  // - 取该 imageKey 在 charImages 里的最后一张作为 cover_url(per-look 准确对应)
  async function saveCharacterToAssets(c: GenCharacter, lookId: string | null, imageKey: string) {
    if (!user) {
      toast.error('请先登录')
      return
    }
    const allImgs = charImages[imageKey] ?? []
    const coverUrl = allImgs.at(-1) ?? null
    // 收集所有已生成的图片(含标签),存到 assets 库的 images 字段,
    // 详情页动态展示(不再硬编码 front/side/back/expression)。
    const images = allImgs.length > 0
      ? allImgs.map((url) => ({ url, label: url === coverUrl ? '主图' : '生成图' }))
      : undefined
    // 2026/06 修复:URL 不是永久 URL 则先持久化到 Storage,避免 base64 太大导致超时
    let permCoverUrl = coverUrl
    if (coverUrl && !isPersistedUrl(coverUrl)) {
      try {
        const r = await callPersistAsset({ data: { url: coverUrl, userId: user.id, kind: 'character', id: c.id } })
        if (r.ok && r.url) permCoverUrl = r.url
        else toast.warning('图片保存失败，将以临时链接保存(24h 内有效)')
      } catch { toast.warning('图片保存失败，将以临时链接保存(24h 内有效)') }
    }
    const r = await saveOneCharacter(c, user.id, permCoverUrl, images)
    if (!r.ok) {
      toast.error(`保存角色失败:${r.error}`)
      return
    }
    setSavedAssetKeys((prev) => new Set(prev).add(imageKey))
    toast.success(`「${c.name}${lookId ? ` · ${c.looks?.find((l) => l.id === lookId)?.label ?? ''}` : ''}」已保存到资产库`)
  }

  // 2026/06:per-item 保存道具到资产库。
  async function savePropToAssets(p: GenProp, imageKey: string) {
    if (!user) {
      toast.error('请先登录')
      return
    }
    const allImgs = propImages[imageKey] ?? []
    const coverUrl = allImgs.at(-1) ?? null
    const images = allImgs.length > 0
      ? allImgs.map((url) => ({ url, label: url === coverUrl ? '主图' : '生成图' }))
      : undefined
    let permCoverUrl = coverUrl
    if (coverUrl && !isPersistedUrl(coverUrl)) {
      try {
        const r = await callPersistAsset({ data: { url: coverUrl, userId: user.id, kind: 'prop', id: p.id } })
        if (r.ok && r.url) permCoverUrl = r.url
        else toast.warning('道具图片保存失败，将以临时链接保存(24h 内有效)')
      } catch { toast.warning('道具图片保存失败，将以临时链接保存(24h 内有效)') }
    }
    const r = await saveOneProp(p, user.id, permCoverUrl, images)
    if (!r.ok) {
      toast.error(`保存道具失败:${r.error}`)
      return
    }
    setSavedAssetKeys((prev) => new Set(prev).add(imageKey))
    toast.success(`「${p.name}」已保存到资产库`)
  }

  // 2026/06:per-item 保存场景到资产库。
  async function saveSceneToAssets(s: GenScene, imageKey: string) {
    if (!user) {
      toast.error('请先登录')
      return
    }
    const allImgs = sceneImages[imageKey] ?? []
    const coverUrl = allImgs.at(-1) ?? null
    let permCoverUrl = coverUrl
    if (coverUrl && !isPersistedUrl(coverUrl)) {
      try {
        const r = await callPersistAsset({ data: { url: coverUrl, userId: user.id, kind: 'scene', id: s.id } })
        if (r.ok && r.url) permCoverUrl = r.url
        else toast.warning('场景图片保存失败，将以临时链接保存(24h 内有效)')
      } catch { toast.warning('场景图片保存失败，将以临时链接保存(24h 内有效)') }
    }
    const r = await saveOneScene(s, user.id, permCoverUrl)
    if (!r.ok) {
      toast.error(`保存场景失败:${r.error}`)
      return
    }
    setSavedAssetKeys((prev) => new Set(prev).add(imageKey))
    toast.success(`「${s.slug}」已保存到资产库`)
  }

  // 追踪哪些资产已保存(用于按钮显示"已保存"反馈)
  const [savedAssetKeys, setSavedAssetKeys] = useState<Set<string>>(new Set())

  // ===== Workspace data persistence =====
  const completedStages = (() => {
    const stages = new Set<WorkspaceTab>()
    if (data.outline && data.outline.acts.length > 0) stages.add('canvas')
    if (synopsisText || data.episodeTexts.length > 0) stages.add('script')
    if (data.characters.length > 0) stages.add('character')
    if (data.storyboard.length > 0) stages.add('storyboard')
    if (data.timeline) stages.add('timeline')
    return stages
  })()

  const ALL_STAGES: WorkspaceTab[] = ['canvas', 'script', 'character', 'storyboard', 'timeline']

  /**
   * 2026/06:后台并发入库所有图片,不阻塞保存主流程。
   * 并发 5,避免 serverless 函数超时。
   */
  async function persistAllImagesInBackground(
    charMap: Record<string, (string | undefined)[] | undefined>,
    shotMap: Record<string, (string | undefined)[] | undefined>,
    sceneMap: Record<string, (string | undefined)[] | undefined>,
    propMap: Record<string, (string | undefined)[] | undefined>,
    uid: string,
    persist: typeof callPersistAsset,
  ) {
    const CONCURRENCY = 5
    let done = 0; let fail = 0
    async function worker(queue: Array<() => Promise<void>>) {
      while (true) {
        const task = queue.shift()
        if (!task) break
        await task()
      }
    }
    const queue: Array<() => Promise<void>> = []
    const collect = (map: Record<string, (string | undefined)[] | undefined>, kind: string, prefix: string) => {
      for (const [key, arr] of Object.entries(map)) {
        if (!arr || !arr.length) continue
        for (const url of arr) {
          if (!url || url.startsWith('data:') || url.startsWith('blob:')) continue
          queue.push(async () => {
            try {
              const r = await persist({ data: { url, userId: uid, kind: kind as any, id: `${prefix}-${key}` } })
              if (r.ok && r.url) done++
              else fail++
            } catch { fail++ }
          })
        }
      }
    }
    collect(charMap, 'character', 'char')
    collect(shotMap, 'shot', 'shot')
    collect(sceneMap, 'scene', 'scene')
    collect(propMap, 'prop', 'prop')
    if (!queue.length) return
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker(queue))
    await Promise.all(workers)
    if (done > 0 || fail > 0) {
      toast.success(`图片入库完成:${done} 张成功${fail > 0 ? `,${fail} 张失败(已保留临时链接)` : ''}`)
    }
  }

  const pendingSaveRef = useRef(false)
  const scheduleSave = useCallback((opts?: { silent?: boolean }) => {
    if (savingWorkspace) {
      pendingSaveRef.current = true
      return
    }
    void handleSaveWorkspace(opts)
  }, [savingWorkspace])

  async function handleSaveWorkspace(opts?: { silent?: boolean }) {
    const silent = opts?.silent === true
    if (!user) {
      if (!silent) toast.error('请先登录')
      return
    }
    if (savingWorkspace) { pendingSaveRef.current = true; return } // 防并发:排队等下一次
    setSavingWorkspace(true)
    setSavedWorkspace(false)
    try {
      // 2026/06:入库 ephemeral 媒体(分镜视频 + 故事板图)。
      // ARK / DashScope / Seedream 三方 URL 24h 过期,服务端下载 → 上传
      // Supabase Storage → 返回永久 URL,替换后写回 workspace_data。
      // 已入库的会被服务端检测跳过(URL 已在自己的 bucket 里)。
      // 没有 ephemeral 项时这步基本零成本,直接返回原 map。
      let persistGroupVideos = groupVideos
      let persistGroupStoryboards = groupStoryboards
      const hasEphemeralMedia =
        Object.values(groupVideos).some((v) => v.status === 'succeeded' && v.url) ||
        Object.values(groupStoryboards).some((v) => v.status === 'succeeded' && v.url)
      if (hasEphemeralMedia) {
        const toastId = toast.loading('正在将视频 / 故事板图入库到你的存储…')
        try {
          const persistRes = await callPersistMedia({
            data: {
              workspaceId,
              groupVideos,
              groupStoryboards,
            },
          })
          // 用永久 URL 替换 client state —— 后续 <video src> 用新 URL
          persistGroupVideos = persistRes.groupVideos
          persistGroupStoryboards = persistRes.groupStoryboards
          setGroupVideos(persistGroupVideos)
          setGroupStoryboards(persistGroupStoryboards)
          toast.dismiss(toastId)
          if (persistRes.persistedCount > 0) {
            toast.success(
              `已入库 ${persistRes.persistedCount} 个文件` +
              (persistRes.failedCount > 0 ? `,${persistRes.failedCount} 个失败(已保留原临时链接)` : ''),
            )
          } else if (persistRes.failedCount > 0) {
            toast.warning(`入库失败 ${persistRes.failedCount} 个,临时链接仍可使用`)
          }
          if (persistRes.errors.length) {
            // 开发可见:详细错误打到 console,生产只 toast 概要
            console.warn('[persistWorkspaceMedia]', persistRes.errors)
          }
        } catch (e) {
          toast.dismiss(toastId)
          // 入库失败不阻断保存 —— 用 ephemeral URL 也能保存(后续 24h 后失效)
          console.error('[persistWorkspaceMedia]', e)
          toast.warning('媒体入库失败,将以临时链接保存(24h 内有效)')
        }
      }

      // 2026/06:后台异步入库所有图片(角色/分镜/场景/道具),不阻塞保存流程。
      // 并发池大小 5,避免 serverless 函数超时。结果不影响主流程。
      persistAllImagesInBackground(charImagesRef.current, shotImages, sceneImagesRef.current, propImagesRef.current, user!.id, callPersistAsset).catch(() => {})

      // 过滤 base64(太大无法写入),保留临时 ARK URL 和永久 Storage URL
      const keepNonB64 = (url: string) => url && !url.startsWith('data:') ? url : undefined
      const keepArr = (arr: string[] | undefined) => {
        if (!arr) return undefined
        const filtered = arr.map(keepNonB64).filter((u): u is string => !!u)
        return filtered.length > 0 ? filtered : undefined
      }
      const workspaceData: Record<string, unknown> = {
        outline: data.outline,
        scenes: data.scenes,
        characters: data.characters,
        props: data.props,
        storyboard: data.storyboard,
        storyboardGroups: data.storyboardGroups,
        timeline: data.timeline,
        synopsisText: synopsisText || synopsisDraft,
        episodeTexts: data.episodeTexts,
        // 2026/06 修复:从 ref 读取最新图片 URL(handleUploadImage 通过 setTimeout
        // 调 handleSaveWorkspace 时,React state 可能还没完成 batch update,ref 是最新的)
        charImages: Object.fromEntries(Object.entries(charImagesRef.current).map(([k, v]) => [k, keepArr(v)])),
        shotImages: Object.fromEntries(Object.entries(shotImages).map(([k, v]) => [k, keepArr(v)])),
        sceneImages: Object.fromEntries(Object.entries(sceneImagesRef.current).map(([k, v]) => [k, keepArr(v)])),
        propImages: Object.fromEntries(Object.entries(propImagesRef.current).map(([k, v]) => [k, keepArr(v)])),
        panelImages: Object.fromEntries(Object.entries(panelImages).map(([k, v]) => [k, keepNonB64(v)])),
        selectedCharImages,
        selectedSceneImages,
        selectedPropImages,
        selectedEpisodeIndex,
        groupVideos,
        groupStoryboards: Object.fromEntries(
          Object.entries(persistGroupStoryboards).map(([k, v]) => [k, { ...v, url: keepNonB64(v.url) ?? '' }]),
        ),
      }
      const res = await callSaveWorkspace({
        data: {
          id: workspaceId,
          workspaceData,
          completedStages: Array.from(completedStages),
        },
      })
      if (res.ok) {
        setSavedWorkspace(true)
        if (!silent) toast.success('工作区已保存')
        // 2026/06:保存时自动挑一张角色图作为项目封面(不覆盖用户手动设的 customCover)。
        // 优先级:charImages(角色图)→ shotImages(分镜图)→ groupStoryboards(故事板图)。
        if (!project?.customCover) {
          const pickCover = (): string | null => {
            const imgSrc = charImagesRef.current
            for (const k of Object.keys(imgSrc)) {
              const arr = imgSrc[k]
              if (Array.isArray(arr) && arr.length && arr[0] && !arr[0].startsWith('data:')) return arr[0]
            }
            const shots = shotImages
            for (const k of Object.keys(shots)) {
              const arr = shots[k]
              if (Array.isArray(arr) && arr.length && arr[0]) return arr[0]
            }
            for (const k of Object.keys(persistGroupStoryboards)) {
              const v = persistGroupStoryboards[k]
              if (v?.url && v.status === 'succeeded') return v.url
            }
            return null
          }
          const cover = pickCover()
          if (cover) {
            callUpsertProject({ data: { id: workspaceId, customCover: cover } }).catch(() => {})
          }
        }
        // Reset "saved" badge after 3 seconds
        setTimeout(() => setSavedWorkspace(false), 3000)
      } else {
        if (!silent) toast.error(res.error || '保存失败')
      }
    } catch {
      if (!silent) toast.error('保存失败')
    } finally {
      setSavingWorkspace(false)
      // 如果保存期间有新的保存请求排队,立即再跑一次
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false
        void handleSaveWorkspace({ silent: true })
      }
    }
  }

  // 阶段性内容自动持久化:剧本/角色/分镜/时间轴等任意改变,1.5s 防抖后静默保存到服务端,
  // 让用户刷新页面也能看到已生成内容。
  const autoSaveSignature = JSON.stringify({
    outline: data.outline ? 1 : 0,
    scenesN: data.scenes.length,
    scenesHash: data.scenes.map((s) => `${s.id}:${s.action?.length ?? 0}`).join('|'),
    charactersN: data.characters.length,
    // 2026/06:加入角色描述字段哈希,修改描述也能触发自动保存
    charsHash: data.characters.map((c) => `${c.id}:${(c.faceDescription?.length ?? 0)+(c.bodyDescription?.length ?? 0)+(c.clothingDescription?.length ?? 0)}`).join('|'),
    propsN: data.props.length,
    propsHash: data.props.map((p) => `${p.id}:${p.description?.length ?? 0}`).join('|'),
    groupsHash: data.storyboardGroups.map((g) => `${g.id}:${g.shots.length}:${g.shots.map((s) => s.imageUrl?.length ?? 0).join(',')}`).join('|'),
    timeline: data.timeline ? 1 : 0,
    synopsis: (data.synopsisText || '').length,
    episodes: data.episodeTexts.length,
    charImgs: Object.keys(charImages).length,
    charImgsHash: Object.values(charImages).map((arr) => (arr?.length ?? 0) + ':' + (arr?.at(-1)?.length ?? 0)).join('|'),
    shotImgs: Object.keys(shotImages).length,
    sceneImgs: Object.keys(sceneImages).length,
    propImgs: Object.keys(propImages).length,
    panelImgs: Object.keys(panelImages).length,
    groupVids: Object.keys(groupVideos).length,
    groupSbs: Object.keys(groupStoryboards).length,
  })
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!dataLoaded) return
    if (!user) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      if (savingWorkspace) return
      void handleSaveWorkspace({ silent: true })
    }, 1500)
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSaveSignature, dataLoaded])

  // Auto-save when all stages are complete (only trigger once)
  const completedKey = ALL_STAGES.map((s) => completedStages.has(s) ? '1' : '0').join('')
  useEffect(() => {
    if (autoSavedRef.current) return
    if (!dataLoaded) return
    if (completedKey === '11111') {
      autoSavedRef.current = true
      void handleSaveWorkspace()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedKey, dataLoaded])

  // 2026/06 二次改造:之前 shots 字段一变就调 composePlotText 重写 plotText,
  // 把 AI 写的详细剧情扩写覆盖成机械的 shot 列表。改 prompt 后 plotText 是
  // LLM 写的 prose,这里**不能再覆盖**。
  // 这个 useEffect 仍保留只是为了:对历史数据 composePlotText 会剥掉
  // "【本组分镜】..." 尾巴(老 prose),换上干净 prose;
  // 对新数据 composePlotText 返回原文,setState bail-out,无副作用。
  // 把 shots 字段序列化成 stable key 当 dep,shots 数组引用变化(新增/删除
  // shot)或任意 shot 字段(shotTypeLabel / action / camera)变化都触发。
  const storyboardShotsHash = data.storyboardGroups
    .map((g) => g.shots.map((s) => `${s.shotTypeLabel}|${s.action}|${s.camera}`).join(''))
    .join('')
  useEffect(() => {
    if (!dataLoaded) return
    setData((d) => {
      if (!d) return d
      const newGroups = d.storyboardGroups.map((g) => {
        const recomposed = composePlotText(g)
        return recomposed === g.plotText ? g : { ...g, plotText: recomposed }
      })
      // 如果所有 group plotText 都跟原一样,返回原 d(setState bail-out)
      if (newGroups.every((g, i) => g === d.storyboardGroups[i])) return d
      return { ...d, storyboardGroups: newGroups }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoaded, storyboardShotsHash])

  // EpisodesView: Auto-select latest episode when episodes change
  useEffect(() => {
    const episodes = data.episodeTexts
    if (tab === 'episodes' && episodes.length > 0 && !episodes.some((ep) => ep.epIndex === selectedEpisodeIndex)) {
      setSelectedEpisodeIndex(episodes[episodes.length - 1].epIndex)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.episodeTexts, selectedEpisodeIndex, tab])

  // EpisodesView: Scroll selected episode card into view when selectedEpisodeIndex changes
  useEffect(() => {
    if (tab === 'episodes') {
      const el = episodeCardRefs.current[selectedEpisodeIndex]
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
      }
    }
  }, [selectedEpisodeIndex, tab])

  async function tryAi(
    stage: 'canvas' | 'script' | 'scene' | 'character' | 'character-extract' | 'storyboard' | 'timeline' | 'prop-extract',
    userPrompt: string,
    currentData: WorkspaceData,
    // 2026/06:可选项,用于 character-extract / character 阶段给每条 GenCharacter 打 episodes 标签。
    // 不传时默认 1(老 canvas -> character 全量创建路径)。
    extractEpIndex?: number,
  ): Promise<Partial<WorkspaceData> | null> {
    try {
      const res = await callAi({
        data: {
          stage,
          userPrompt,
          context: {
            logline: currentData.outline?.logline,
            acts: currentData.outline?.acts,
            scenes: currentData.scenes.map((s) => ({ index: s.index, slug: s.slug, action: s.action, beats: s.beats })),
            // 2026/06:给 AI 更多上下文用于跨集识别 —— 含 id, matchKey, episodes, siblingGroupId
            characters: currentData.characters.map((c) => ({
              id: c.id,
              matchKey: c.matchKey,
              name: c.name,
              roleLabel: c.roleLabel,
              siblingGroupId: c.siblingGroupId ?? null,
              episodes: c.episodes,
            })),
          },
        },
      })
      if (!res.ok) {
        return null
      }
      const p = res.payload
      switch (stage) {
        case 'canvas':
          return { outline: { logline: String(p.logline ?? ''), acts: p.acts ?? [] } }
        case 'script': {
          const scenes: GenScene[] = (p.scenes ?? []).map((s: any, i: number) => ({
            episodeIndex: typeof s.episodeIndex === 'number' ? s.episodeIndex : 1,
            id: `ai-sc-${i + 1}-${Date.now()}`,
            index: s.index ?? i + 1,
            slug: s.slug ?? '',
            location: s.location ?? '',
            timeOfDay: s.timeOfDay ?? 'DAY',
            action: s.action ?? '',
            beats: Array.isArray(s.beats) ? s.beats : [],
            dialogue: Array.isArray(s.dialogue) ? s.dialogue : [],
          }))
          return { scenes }
        }
        case 'scene': {
          // 'scene' 阶段：AI 只做场景提取(轻量 prompt + 简化 schema),
          // 输出更干净的 GenScene[]。与 'script' 阶段的"写剧本"区别开。
          const rawScenes: any[] = Array.isArray(p.scenes) ? p.scenes : []
          // 兜底:AI 偶尔不返回 scenes 字段时不要 wipe 现有数据
          if (rawScenes.length === 0) return { scenes: currentData.scenes }
          const scenes: GenScene[] = rawScenes.map((s: any, i: number) => ({
            episodeIndex: typeof s.episodeIndex === 'number' ? s.episodeIndex : 1,
            id: `ai-sc-${i + 1}-${Date.now()}`,
            index: s.index ?? i + 1,
            slug: s.slug ?? '',
            location: s.location ?? '',
            timeOfDay: s.timeOfDay ?? 'DAY',
            action: s.action ?? '',
            beats: Array.isArray(s.beats) ? s.beats : [],
            dialogue: [],
          }))
          return { scenes }
        }
        case 'character-extract':
        case 'character': {
          const epForNew = extractEpIndex ?? 1
          const characters: GenCharacter[] = (p.characters ?? []).map((c: any, i: number) => {
            const palette: string[] = Array.isArray(c.palette) && c.palette.length ? c.palette : ['#1e293b', '#475569', '#fbbf24']
            // 2026/06:matchKey 兜底 —— AI 漏填时 client 派生
            const matchKey = (typeof c.matchKey === 'string' && c.matchKey.trim())
              ? c.matchKey.trim()
              : `auto-${(c.name ?? 'c-' + (i+1)).replace(/[\s·]+/g, '-')}-${hashString(String(c.name ?? i)).slice(0,4)}`
            // 2026/06:resolveStableId 优先复用 existing 里同 matchKey/name/sibling 的 id,
            // 防止 charImages[id] 老图全部失效
            const cid = resolveStableId({ ...c, matchKey }, currentData.characters)
            // 同角色不同造型(医生/穿越/学生 等),每个 look 走独立图片生成 call,
            // 脸和身材沿用主条目,clothingDescription 用 look 自己的。AI 字段
            // 是 string[] of { label, clothingDescription },转成 GenCharacterLook[]。
            const looks: GenCharacterLook[] = Array.isArray(c.looks)
              ? c.looks
                  .filter((lk: any) => lk && typeof lk.label === 'string' && lk.label.trim())
                  .map((lk: any, k: number) => ({
                    id: `ai-lk-${i + 1}-${k + 1}-${Date.now()}`,
                    label: lk.label.trim(),
                    // 优先 AI 在第 1 步给的,没有则 fallback 主条目(防御性);
                    // 正常路径下 enrichCharacterLooks 会立即覆盖成 per-look 独立描述。
                    faceDescription: (typeof lk.faceDescription === 'string' && lk.faceDescription.trim()) || c.faceDescription || '',
                    bodyDescription: (typeof lk.bodyDescription === 'string' && lk.bodyDescription.trim()) || c.bodyDescription || '',
                    clothingDescription: lk.clothingDescription ?? '',
                    // 透传 AI 给的 hint(如剧情明示该变体下脸/身体有变化),enrichCharacterLooks 会读
                    ...(typeof lk.faceHint === 'string' && lk.faceHint.trim() ? { faceHint: lk.faceHint.trim() } : {}),
                    ...(typeof lk.bodyHint === 'string' && lk.bodyHint.trim() ? { bodyHint: lk.bodyHint.trim() } : {}),
                  }))
              : []
            return {
              // 2026/06:episodes 数组替代原 episodeIndex
              episodes: [epForNew],
              id: cid,
              matchKey,
              name: c.name ?? `角色${i + 1}`,
              role: (['lead', 'supporting', 'villain'] as const).includes(c.role) ? c.role : 'supporting',
              roleLabel: c.roleLabel ?? ROLE_LABEL_FALLBACK[c.role as GenCharacter['role']] ?? '配角',
              age: typeof c.age === 'number' ? c.age : 18,
              gender: c.gender ?? '',
              faceDescription: c.faceDescription ?? '',
              bodyDescription: c.bodyDescription ?? '',
              clothingDescription: c.clothingDescription ?? '',
              personality: c.personality ?? '',
              palette,
              swatch: `linear-gradient(135deg, ${palette[0]}, ${palette[palette.length - 1]})`,
              looks: looks.length > 0 ? looks : undefined,
              ...(typeof c.siblingGroupId === 'string' && c.siblingGroupId.trim()
                ? { siblingGroupId: c.siblingGroupId.trim() }
                : {}),
            }
          })
          return { characters }
        }
        case 'prop-extract': {
          const epForNew = extractEpIndex ?? 1
          const props: GenProp[] = (p.props ?? []).map((pp: any, i: number) => {
            const palette: string[] = Array.isArray(pp.palette) && pp.palette.length ? pp.palette : ['#1e293b', '#475569', '#fbbf24']
            return {
              id: crypto.randomUUID(),
              episodeIndex: epForNew,
              name: pp.name ?? `道具${i + 1}`,
              description: pp.description ?? '',
              movementDescription: pp.movementDescription ?? '',
              keyMoments: Array.isArray(pp.keyMoments) ? pp.keyMoments : [],
              palette,
              swatch: `linear-gradient(135deg, ${palette[0]}, ${palette[palette.length - 1]})`,
            }
          })
          return { props }
        }
        case 'storyboard': {
          // Map AI panels back to UI shape; pair sceneIndex to existing scene id when possible.
          const sceneById = new Map(currentData.scenes.map((s) => [s.index, s.id]))
          const panels: StoryboardPanel[] = (p.panels ?? []).map((p2: any, i: number) => ({
            id: `ai-pn-${i + 1}-${Date.now()}`,
            index: i + 1,
            sceneId: sceneById.get(p2.sceneIndex) ?? currentData.scenes[0]?.id ?? `sc-${p2.sceneIndex}`,
            shot: ['WS', 'MS', 'CU', 'ECU', 'OTS'].includes(p2.shot) ? p2.shot : 'MS',
            camera: p2.camera ?? '',
            action: p2.action ?? '',
            emotion: p2.emotion ?? '',
            durationSec: typeof p2.durationSec === 'number' ? p2.durationSec : 3,
            gradient: sbGradient(i),
          }))
          return { storyboard: panels }
        }
        case 'timeline': {
          const tracks: TimelineTrack[] = (p.tracks ?? []).map((t: any) => ({
            kind: t.kind as 'video' | 'audio' | 'subtitle',
            label: t.label ?? '',
            clips: (t.clips ?? []).map((c: any, i: number): TimelineClip => ({
              id: `tl-${t.kind}-${i}-${Date.now()}`,
              startSec: typeof c.startSec === 'number' ? c.startSec : 0,
              durationSec: typeof c.durationSec === 'number' ? c.durationSec : 3,
              label: c.label ?? '',
              panelId: c.panelIndex ? currentData.storyboard.find((pan) => pan.index === c.panelIndex)?.id : undefined,
            })),
          }))
          const transitionsAt: number[] = Array.isArray(p.transitionsAt) ? p.transitionsAt : []
          const totalSec = tracks[0]?.clips.reduce((sum, c) => sum + (c.durationSec ?? 0), 0) ?? 0
          return { timeline: { totalSec, tracks, transitionsAt } }
        }
      }
      return null
    } catch (e) {
      console.error(e)
      return null
    }
  }

  // ===== 剧本流式生成辅助 =====
  function ensureSynopsisFlush() {
    if (synopsisFlushRef.current != null) return
    synopsisFlushRef.current = window.setInterval(() => {
      const map = synopsisPendingRef.current
      if (map.size === 0) {
        if (synopsisFlushRef.current != null) window.clearInterval(synopsisFlushRef.current)
        synopsisFlushRef.current = null
        return
      }
      setSynopsisBubbles((prev) =>
        prev.map((b) => {
          const slot = map.get(b.id)
          if (!slot) return b
          if (slot.buf.length === 0) {
            if (slot.done) { map.delete(b.id); return { ...b, text: b.text } }
            return b
          }
          const take = Math.min(slot.buf.length, Math.max(2, Math.ceil(slot.buf.length / 12)))
          const chunk = slot.buf.slice(0, take)
          slot.buf = slot.buf.slice(take)
          const next = { ...b, text: b.text + chunk }
          if (slot.buf.length === 0 && slot.done) { map.delete(b.id) }
          return next
        }),
      )
    }, 24) as unknown as number
  }

  function ensureEpisodeFlush() {
    if (episodeFlushRef.current != null) return
    episodeFlushRef.current = window.setInterval(() => {
      const map = episodePendingRef.current
      if (map.size === 0) {
        if (episodeFlushRef.current != null) window.clearInterval(episodeFlushRef.current)
        episodeFlushRef.current = null
        return
      }
      setEpisodeBubbles((prev) =>
        prev.map((b) => {
          const slot = map.get(b.id)
          if (!slot) return b
          if (slot.buf.length === 0) {
            if (slot.done) { map.delete(b.id); return { ...b, text: b.text } }
            return b
          }
          const take = Math.min(slot.buf.length, Math.max(2, Math.ceil(slot.buf.length / 12)))
          const chunk = slot.buf.slice(0, take)
          slot.buf = slot.buf.slice(take)
          const next = { ...b, text: b.text + chunk }
          if (slot.buf.length === 0 && slot.done) { map.delete(b.id) }
          return next
        }),
      )
    }, 24) as unknown as number
  }

  async function runScriptSynopsis(opts: {
    type: string; genre: string; tone: string; theme: string; plot: string
    expectedEpisodes: number; totalMinutes: number; lang: 'zh' | 'en'; model?: string
  }): Promise<void> {
    setSynopsisStreaming(true)
    setSynopsisBubbles([])
    setSynopsisText('')
    const id = `sn-${Date.now()}`
    setSynopsisBubbles([{ id, text: '' }])
    try {
      const stream = await callSynopsis({ data: { ...opts, lang: opts.lang ?? 'zh' } }) as AsyncIterable<{ delta?: string; done?: boolean; text?: string; error?: string }>
      for await (const chunk of stream) {
        if ('error' in chunk) { toast.error(chunk.error); break }
        if ('delta' in chunk && chunk.delta) {
          const map = synopsisPendingRef.current
          const slot = map.get(id) ?? { buf: '', done: false }
          slot.buf += chunk.delta
          map.set(id, slot)
          ensureSynopsisFlush()
        } else if ('done' in chunk) {
          const map = synopsisPendingRef.current
          const slot = map.get(id)
          if (slot) { slot.done = true; ensureSynopsisFlush() }
          else { setSynopsisBubbles((prev) => prev.map((b) => b.id === id ? { ...b, text: chunk.text ?? '' } : b)) }
          setSynopsisText(chunk.text ?? '')
          setSynopsisDraft(chunk.text ?? '')
        }
      }
    } catch (e) {
      toast.error(classifyError(undefined, '生成失败'))
    } finally {
      setSynopsisStreaming(false)
    }
  }

  async function runRefineSynopsis(opts: {
    instruction: string; lang: 'zh' | 'en'; model?: string
  }): Promise<void> {
    const currentSynopsis = synopsisDraft || synopsisText
    if (!currentSynopsis.trim()) {
      toast.error('请先生成故事梗概')
      return
    }
    setSynopsisStreaming(true)
    const id = `sn-${Date.now()}`
    setSynopsisBubbles([{ id, text: '' }])
    try {
      const stream = await callRefine({
        data: {
          currentSynopsis,
          instruction: opts.instruction,
          lang: opts.lang,
          model: opts.model,
        },
      }) as AsyncIterable<{ delta?: string; done?: boolean; text?: string; error?: string }>
      for await (const chunk of stream) {
        if ('error' in chunk) { toast.error(chunk.error); break }
        if ('delta' in chunk && chunk.delta) {
          const map = synopsisPendingRef.current
          const slot = map.get(id) ?? { buf: '', done: false }
          slot.buf += chunk.delta
          map.set(id, slot)
          ensureSynopsisFlush()
        } else if ('done' in chunk) {
          const map = synopsisPendingRef.current
          const slot = map.get(id)
          if (slot) { slot.done = true; ensureSynopsisFlush() }
          else { setSynopsisBubbles((prev) => prev.map((b) => b.id === id ? { ...b, text: chunk.text ?? '' } : b)) }
          setSynopsisText(chunk.text ?? '')
          setSynopsisDraft(chunk.text ?? '')
          toast.success('故事梗概已更新')
        }
      }
    } catch (e) {
      toast.error('修改失败')
    } finally {
      setSynopsisStreaming(false)
    }
  }

  async function runScriptEpisode(opts: {
    epIndex: number; sceneCount: number; lang: 'zh' | 'en'; model?: string; autoRunTarget?: number; expectedEpisodes?: number
  }): Promise<void> {
    const { autoRunTarget } = opts
    setEpisodeStreaming(true)
    const id = `ep-${Date.now()}`
    setStreamingBubbleId(id)
    setEpisodeBubbles([{ id, text: '' }])
    // Pre-expand so the episode is visible as soon as it appears
    setExpandedEpisodes((prev) => {
      const next = new Set(prev)
      next.add(opts.epIndex)
      return next
    })
    try {
      const stream = await callEpisode({ data: { ...opts, synopsisText: synopsisText || synopsisDraft } }) as AsyncIterable<{ delta?: string; done?: boolean; text?: string; error?: string }>
      for await (const chunk of stream) {
        if ('error' in chunk) { toast.error(chunk.error); break }
        if ('delta' in chunk && chunk.delta) {
          const map = episodePendingRef.current
          const slot = map.get(id) ?? { buf: '', done: false }
          slot.buf += chunk.delta
          map.set(id, slot)
          ensureEpisodeFlush()
        } else if ('done' in chunk) {
          const map = episodePendingRef.current
          const slot = map.get(id)
          if (slot) { slot.done = true; ensureEpisodeFlush() }
          else { setEpisodeBubbles((prev) => prev.map((b) => b.id === id ? { ...b, text: chunk.text ?? '' } : b)) }
          setData((d) => {
            const others = d.episodeTexts.filter((e) => e.epIndex !== opts.epIndex)
            return {
              ...d,
              episodeTexts: [...others, { epIndex: opts.epIndex, text: chunk.text ?? '' }].sort((a, b) => a.epIndex - b.epIndex),
              nextEpIndex: opts.epIndex + 1,
            }
          })
          // Auto-continue — use autoRunTarget from parameter (NOT data._autoRunTarget which is stale closure)
          if (autoRunTarget && opts.epIndex < autoRunTarget) {
            setTimeout(() => {
              runScriptEpisode({ epIndex: opts.epIndex + 1, sceneCount: opts.sceneCount, lang: opts.lang, autoRunTarget, expectedEpisodes: opts.expectedEpisodes })
            }, 500)
          } else if (autoRunTarget && opts.epIndex >= autoRunTarget && !shownAutoCompleteToastRef.current) {
            shownAutoCompleteToastRef.current = true
            toast.success(`已连续生成至第 ${autoRunTarget} 集，生成完毕`)
          }
          // Auto-scroll to the new episode card
          setTimeout(() => {
            const el = episodeRefs.current[opts.epIndex]
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }, 100)
          // Mark new episodes as expanded so they show content immediately
          setExpandedEpisodes((prev) => {
            const next = new Set(prev)
            next.add(opts.epIndex)
            return next
          })
        }
      }
    } catch (e) {
      toast.error(classifyError(undefined, '生成失败'))
    } finally {
      setEpisodeStreaming(false)
      setStreamingBubbleId(null)
      // When auto-run completes, set the completion target for the banner
      if (autoRunTarget && opts.epIndex >= autoRunTarget) {
        setAutoRunCompleteTarget(autoRunTarget)
        autoRunTargetRef.current = null
      }
    }
  }

  // Build concatenated text of all episodes before the given index (for context)
  function buildPreviousEpisodesText(epIndex: number): string {
    const prevEps = data.episodeTexts
      .filter((e) => e.epIndex < epIndex)
      .sort((a, b) => a.epIndex - b.epIndex)
    if (!prevEps.length) return ''
    return prevEps.map((e) => `—— 第 ${e.epIndex} 集 ——\n${e.text}`).join('\n\n')
  }

  async function runScriptModify(opts: {
    epIndex: number; instruction: string; currentText: string; synopsisText?: string; previousEpisodesText?: string; lang: 'zh' | 'en'; model?: string
  }): Promise<void> {
    setEpisodeStreaming(true)
    const id = `ep-${Date.now()}`
    setStreamingBubbleId(id)
    setEpisodeBubbles([{ id, text: '' }])
    try {
      const stream = await callRefineEpisode({ data: { ...opts } }) as AsyncIterable<{ delta?: string; done?: boolean; text?: string; error?: string }>
      for await (const chunk of stream) {
        if ('error' in chunk) { toast.error(chunk.error); break }
        if ('delta' in chunk && chunk.delta) {
          const map = episodePendingRef.current
          const slot = map.get(id) ?? { buf: '', done: false }
          slot.buf += chunk.delta
          map.set(id, slot)
          ensureEpisodeFlush()
        } else if ('done' in chunk) {
          const map = episodePendingRef.current
          const slot = map.get(id)
          if (slot) { slot.done = true; ensureEpisodeFlush() }
          else { setEpisodeBubbles((prev) => prev.map((b) => b.id === id ? { ...b, text: chunk.text ?? '' } : b)) }
          setData((d) => {
            const others = d.episodeTexts.filter((e) => e.epIndex !== opts.epIndex)
            const updated = { ...d, episodeTexts: [...others, { epIndex: opts.epIndex, text: chunk.text ?? '' }].sort((a, b) => a.epIndex - b.epIndex) }
            return updated
          })
          toast.success(`第 ${opts.epIndex} 集剧本已修改`)
        }
      }
    } catch (e) {
      toast.error('修改失败')
    } finally {
      setEpisodeStreaming(false)
      setStreamingBubbleId(null)
    }
  }

  // ============= 空模板创建函数(2026/06:手动添加角色/场景/道具) =============

  function createEmptyCharacter(episodeIndex: number): GenCharacter {
    const id = `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    return {
      episodes: [episodeIndex],
      id,
      name: '新角色',
      role: 'supporting',
      roleLabel: '',
      age: 20,
      gender: '',
      faceDescription: '',
      bodyDescription: '',
      clothingDescription: '',
      personality: '',
      palette: ['#6b7280', '#9ca3af', '#d1d5db'],
      swatch: 'linear-gradient(135deg, #6b7280, #d1d5db)',
      matchKey: id,
    }
  }

  function createEmptyScene(episodeIndex: number): GenScene {
    const id = `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    return {
      episodeIndex,
      id,
      index: 0,
      slug: '',
      location: '',
      timeOfDay: 'DAY',
      action: '',
      beats: [],
      dialogue: [],
    }
  }

  function createEmptyProp(episodeIndex: number): GenProp {
    const id = crypto.randomUUID()
    return {
      episodeIndex,
      id,
      name: '新道具',
      description: '',
      movementDescription: '',
      keyMoments: [],
      palette: ['#6b7280', '#9ca3af', '#d1d5db'],
      swatch: 'linear-gradient(135deg, #6b7280, #d1d5db)',
    }
  }

  async function produce(stage: WorkspaceTab, userPrompt?: string): Promise<unknown> {
    let aiPatch: Partial<WorkspaceData> | null = null
    const trimmed = (userPrompt ?? '').trim()
    const meaningful = trimmed.length >= 4

    // Compute nextEpIndex from existing episodes (survives page refresh)
    const nextEpIndex = data.episodeTexts.length > 0
      ? Math.max(...data.episodeTexts.map((e) => e.epIndex)) + 1
      : 1

    // Check if this is a streaming script generation request (bypass tryAi)
    const isGenerateScript = trimmed.includes('generate_script') || trimmed.includes('生成剧本')
    const isRefineSynopsis = trimmed.startsWith('修改剧本梗概') || trimmed.startsWith('修改梗概')
    // isModifyEpisodeScript: "修改第 X 集剧本" — must be checked before isScriptModify
    const isModifyEpisodeScript = /^修改第\s*\d+\s*集剧本/.test(trimmed)
    const isScriptEpisode = trimmed.includes('生成分镜') || trimmed.includes('生成本集') || trimmed.includes('script_episode') || trimmed.includes('【分场剧本】根据梗概')
    const isScriptContinue = trimmed.includes('连跑') || trimmed.includes('auto_run') || trimmed.includes('自动连跑')
    // isScriptModify must NOT match "修改剧本梗概" or "修改第 X 集剧本"
    const isScriptModify = !isRefineSynopsis && !isModifyEpisodeScript && (trimmed.startsWith('修改剧本') || trimmed.startsWith('修改脚本'))
    const isStreamingScript = isGenerateScript || isRefineSynopsis || isModifyEpisodeScript || isScriptEpisode || isScriptContinue || isScriptModify

    // Detect "从第 X 集提取角色和场景" pattern (used by episodes tab extract button)
    const isExtractFromEpisode = /^从第\s*\d+\s*集提取/.test(trimmed)
    const extractEpMatch = trimmed.match(/^从第\s*(\d+)\s*集提取/)
    const extractEpIndex = extractEpMatch ? Number(extractEpMatch[1]) : 0

    const snapshot = data

    // For streaming script generations, capture the promise before setState
    let scriptPromise: Promise<void> | undefined
    // Allow modify operations from both 'script' and 'episodes' tabs
    const isModifyOp = isModifyEpisodeScript || isRefineSynopsis
    if (isStreamingScript && (stage === 'script' || (isModifyOp && stage === 'episodes'))) {
      if (isGenerateScript) {
        const typeMatch = trimmed.match(/类型[：:]\s*([^\n，,]+)/) ?? trimmed.match(/Type[：:]\s*([^\n，,]+)/)
        const genreLineMatch = trimmed.match(/题材[：:]\s*([^\n]+)/) ?? trimmed.match(/Genre[：:]\s*([^\n]+)/)
        const toneLineMatch = trimmed.match(/风格[：:]\s*([^\n]+)/) ?? trimmed.match(/Tone[：:]\s*([^\n]+)/)
        const epMatch = trimmed.match(/预计集数[：:]\s*(\d+)/) ?? trimmed.match(/Expected episodes[：:]\s*(\d+)/)
        const minMatch = trimmed.match(/总时长[：:]\s*(\d+)/) ?? trimmed.match(/Total duration[：:]\s*(\d+)/)
        const themeMatch = trimmed.match(/主题[：:]\s*([^\n，,]+)/) ?? trimmed.match(/Theme[：:]\s*([^\n，,]+)/)
        const plotMatch = trimmed.match(/剧情[：:]\s*([^\n]+)/) ?? trimmed.match(/Plot[：:]\s*([^\n]+)/)
        scriptPromise = runScriptSynopsis({
          type: typeMatch?.[1] ?? 'Short',
          genre: genreLineMatch?.[1] ?? 'Drama',
          tone: toneLineMatch?.[1] ?? 'Serious',
          theme: themeMatch?.[1] ?? data.outline?.logline ?? '',
          plot: plotMatch?.[1] ?? trimmed,
          expectedEpisodes: Number(epMatch?.[1]) || 30,
          totalMinutes: Number(minMatch?.[1]) || 90,
          lang: 'zh',
        })
      } else if (isScriptEpisode) {
        const scMatch = trimmed.match(/分镜数[：:]\s*(\d+)/) ?? trimmed.match(/Storyboards[：:]\s*(\d+)/)
        const sceneCount = Number(scMatch?.[1]) || data.nextSceneCount
        scriptPromise = runScriptEpisode({ epIndex: nextEpIndex, sceneCount, lang: 'zh' })
      } else if (isModifyEpisodeScript) {
        const epMatch = trimmed.match(/^修改第\s*(\d+)\s*集剧本\n?/)
        const epIndex = Number(epMatch?.[1]) || selectedEpisodeIndex
        const instruction = trimmed.replace(/^修改第\s*\d+\s*集剧本\n?/, '')
        const currentEp = data.episodeTexts.find((e) => e.epIndex === epIndex)
        if (currentEp) {
          scriptPromise = runScriptModify({
            epIndex, instruction, currentText: currentEp.text,
            synopsisText: synopsisText || synopsisDraft,
            previousEpisodesText: buildPreviousEpisodesText(epIndex),
            lang: 'zh',
          })
        }
      } else if (isRefineSynopsis) {
        const instruction = trimmed.replace(/^修改剧本梗概\n?/, '').replace(/^修改梗概\n?/, '')
        scriptPromise = runRefineSynopsis({ instruction, lang: 'zh' })
      } else if (isScriptContinue) {
        shownAutoCompleteToastRef.current = false
        setAutoRunCompleteTarget(null) // Clear previous completion state
        const targetEpMatch = trimmed.match(/连跑至第?\s*(\d+)/) ?? trimmed.match(/targetEp[：:]\s*(\d+)/)
        const targetEp = Number(targetEpMatch?.[1]) || Math.min(nextEpIndex + 4, 30)
        // Extract scene count from prompt (e.g. "分镜数：5" or "分镜数: 5")
        const scMatch = trimmed.match(/分镜数[：:]\s*(\d+)/) ?? trimmed.match(/Storyboards[：:]\s*(\d+)/)
        const sceneCount = Number(scMatch?.[1]) || data.nextSceneCount
        // Store in ref so it can be read without stale closure
        autoRunTargetRef.current = targetEp
        // Pass autoRunTarget as parameter to avoid stale closure bug
        scriptPromise = runScriptEpisode({ epIndex: nextEpIndex, sceneCount, lang: 'zh', autoRunTarget: targetEp, expectedEpisodes: targetEp })
      } else if (isScriptModify) {
        const instruction = trimmed.replace(/^修改剧本\n?/, '').replace(/^修改脚本\n?/, '')
        const epIndex = nextEpIndex > 1 ? nextEpIndex - 1 : 1
        const currentEp = data.episodeTexts.find((e) => e.epIndex === epIndex)
        if (currentEp) {
          scriptPromise = runScriptModify({
            epIndex, instruction, currentText: currentEp.text,
            synopsisText: synopsisText || synopsisDraft,
            previousEpisodesText: buildPreviousEpisodesText(epIndex),
            lang: 'zh',
          })
        }
      }
    }

    // Skip tryAi for streaming script generations — those are handled separately above.
    // Also skip for 'character' stage when this is an extract-from-episode call,
    // because that branch below does its own dedicated character extraction with
    // the actual episode text in the prompt (vs. just "从第 X 集提取..." which
    // produces garbage from the AI).
    const skipTopLevelTryAi =
      isStreamingScript ||
      (stage === 'character' && isExtractFromEpisode)
    if (meaningful && !skipTopLevelTryAi && (stage === 'canvas' || stage === 'script' || stage === 'character' || stage === 'storyboard' || stage === 'timeline')) {
      aiPatch = await tryAi(stage, trimmed, snapshot)
    }

    // Extract characters + scenes from a specific episode (dual AI calls).
    // 'character-extract' stage: 放宽 schema (minItems: 1) 专门做单集角色提取,
    //   避免 'character' stage 的 minItems:3 在单集 1-2 角色时 tool call 失败。
    // 'scene' stage: 专门的场景提取(在 aiGenerate.functions.ts 新加)。
    if (isExtractFromEpisode && extractEpIndex > 0) {
      const epText = data.episodeTexts.find((e) => e.epIndex === extractEpIndex)?.text ?? ''
      if (epText) {
        const extractPrompt = `以下是第 ${extractEpIndex} 集的剧本内容，请只提取本集中出现的角色、主要场景和道具：\n\n${epText}`
        const [charResult, sceneResult, propResult] = await Promise.all([
          // 2026/06:传 extractEpIndex 让 tryAi 给每条 character 打 episodes:[extractEpIndex]
          tryAi('character-extract', extractPrompt, snapshot, extractEpIndex),
          tryAi('scene', extractPrompt, snapshot, extractEpIndex),
          tryAi('prop-extract', extractPrompt, snapshot, extractEpIndex),
        ])
        // 2026/06 跨集一致性:characters 走 mergeExtractedCharacters(在 setData 阶段处理),
        // 这里 aiPatch 直接放 charResult —— episodes 已由 tryAi 打好。
        const scenesWithEp = sceneResult?.scenes?.map((s) => ({ ...s, episodeIndex: extractEpIndex }))
        const propsWithEp = propResult?.props?.map((p) => ({ ...p, episodeIndex: extractEpIndex }))
        aiPatch = {
          ...(charResult ? { characters: charResult.characters } : {}),
          ...(sceneResult ? { scenes: scenesWithEp } : {}),
          ...(propResult ? { props: propsWithEp } : {}),
        }
      }
    }

    setData((d) => {
      switch (stage) {
        case 'canvas':
          return { ...d, outline: aiPatch?.outline ?? generateOutline() }
        case 'script': {
          if (isGenerateScript || isRefineSynopsis || isModifyEpisodeScript || isScriptEpisode || isScriptContinue || isScriptModify) {
            return d
          }
          return d
        }
        case 'episodes': {
          return d
        }
        case 'character': {
          // Extract from episode: 跨集合并 —— 同一真人在 ep1+ep2+... 共享一个 GenCharacter,
          // 改任一集的形象自动反映到所有集。场景仍按集硬替换(单集语义)。
          if (isExtractFromEpisode && aiPatch) {
            let characters = d.characters
            let scenes = d.scenes
            let props = d.props
            if (aiPatch.characters) {
              // 2026/06:跨集合并 —— 按 matchKey > siblingGroupId > name 前缀匹配,
              // 匹配的 GenCharacter 复用(episodes 追加,描述/override 刷新)。
              characters = mergeExtractedCharacters(
                d.characters,
                aiPatch.characters,
                extractEpIndex,
              )
            }
            if (aiPatch.scenes) {
              // 场景仍是单集语义,按集硬替换
              scenes = [
                ...d.scenes.filter((s) => s.episodeIndex !== extractEpIndex),
                ...aiPatch.scenes,
              ]
            }
            if (aiPatch.props) {
              // 道具也是单集语义,按集硬替换
              props = [
                ...d.props.filter((p) => p.episodeIndex !== extractEpIndex),
                ...aiPatch.props,
              ]
            }
            return { ...d, characters, scenes, props }
          }
          return { ...d, characters: aiPatch?.characters ?? (d.characters.length ? d.characters : generateCharacters()) }
        }
        case 'storyboard': {
          const scenes = d.scenes.length ? d.scenes : generateScript()
          const panels = aiPatch?.storyboard ?? generateStoryboard(scenes)
          return { ...d, scenes, storyboard: panels }
        }
        case 'timeline': {
          const scenes = d.scenes.length ? d.scenes : generateScript()
          const panels = d.storyboard.length ? d.storyboard : generateStoryboard(scenes)
          const timelineAi = aiPatch?.timeline ?? null
          return { ...d, scenes, storyboard: panels, timeline: timelineAi ?? generateTimeline(panels) }
        }
        default:
          return d
      }
    })
    setFlash(stage)
    setTimeout(() => setFlash((f) => (f === stage ? null : f)), 1500)

    return scriptPromise
  }

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      <WorkspaceTopbar
        tab={tab}
        onTabChange={setTab}
        episodeCount={data.episodeTexts.length}
        selectedEpisodeIndex={selectedEpisodeIndex}
        onEpisodeIndexChange={setSelectedEpisodeIndex}
        onSave={handleSaveWorkspace}
        saving={savingWorkspace}
        saved={savedWorkspace}
        completedStages={completedStages}
        onAddEpisode={openAddEpisodeDialog}
        viewPromptsMode={viewPromptsMode}
        onToggleViewPromptsMode={() => setViewPromptsMode((v) => !v)}
        currentProject={project ? {
          id: project.id,
          aspect: project.aspect,
          storyboardModel: project.storyboardModel,
          sceneModel: project.sceneModel,
          videoModel: project.videoModel,
          audio: project.audio,
          workflow: project.workflow,
          style: project.style,
          customCover: project.customCover,
        } : undefined}
        onProjectSaved={(saved) => setProject((p) => p ? { ...p, ...saved } : p)}
      />
      <div className="flex-1 flex min-h-0">
        <main className="flex-1 min-w-0 overflow-auto p-6">
          {tab === 'canvas' && (
            <div className="relative max-w-4xl mx-auto rounded-2xl border-2 border-dashed border-accent/50 bg-bg-surface p-6 min-h-[500px]">
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-bg-elevated text-xs border border-border">
                  <FileText size={12} /> {t.ws_tab_canvas}
                </span>
                <div className="flex items-center gap-2">
                  {completedStages.has('canvas') && <span className="inline-flex items-center gap-0.5 text-xs text-emerald-400"><CheckCircle2 size={12} /> 已完成</span>}
                  <button className="p-1 rounded-md hover:bg-bg-elevated text-text-muted"><Maximize2 size={14} /></button>
                </div>
              </div>
              {data.outline ? (
                <div className="space-y-5">
                  <div>
                    <div className="text-xs text-text-muted">Logline</div>
                    <p className="text-text-primary mt-1 leading-relaxed">{data.outline.logline}</p>
                  </div>
                  <div className="space-y-4">
                    {data.outline.acts.map((a, i) => (
                      <div key={i} className="rounded-xl border border-border bg-bg-elevated/40 p-4">
                        <h4 className="font-semibold text-text-primary mb-2">{a.title}</h4>
                        <ul className="space-y-1.5 text-sm text-text-secondary">
                          {a.beats.map((b, k) => (
                            <li key={k} className="flex gap-2"><span className="text-accent shrink-0">·</span><span>{b}</span></li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-bg-elevated/40 p-6 min-h-[380px]">
                  <p className="text-text-muted text-sm">{t.ws_canvas_placeholder}</p>
                </div>
              )}
            </div>
          )}
          {tab === 'script' && (() => {
            const hasSynopsis = synopsisText || synopsisDraft
            const hasEpisodes = data.episodeTexts.length > 0
            const isAutoRunning = autoRunCompleteTarget != null && !episodeStreaming
            const streamingBubble = streamingBubbleId ? episodeBubbles.find((b) => b.id === streamingBubbleId) : null

            if (!hasSynopsis && !hasEpisodes) {
              return (
                <div className="max-w-4xl mx-auto panel p-10 text-center">
                  <p className="text-text-muted text-sm">{t.ws_script_empty}</p>
                </div>
              )
            }

            return (
              <div className="max-w-5xl mx-auto space-y-6 pb-4">
                {hasSynopsis && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-lg font-bold">故事梗概</h3>
                      <div className="flex items-center gap-2">
                        {synopsisStreaming && (
                          <span className="inline-flex items-center gap-1.5 text-xs text-accent">
                            <Loader2 size={11} className="animate-spin" /> 生成中…
                          </span>
                        )}
                        <button
                          onClick={() => {
                            if (synopsisEditing) {
                              setSynopsisText(synopsisDraft)
                              setSynopsisEditing(false)
                            } else {
                              setSynopsisEditing(true)
                            }
                          }}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold transition ${
                            synopsisEditing
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                              : 'border border-border text-text-secondary hover:text-text-primary hover:border-accent hover:bg-bg-elevated'
                          }`}
                        >
                          {synopsisEditing ? <><Check size={13} /> 完成</> : <><Pencil size={13} /> 编辑</>}
                        </button>
                      </div>
                    </div>
                    {synopsisEditing ? (
                      <textarea
                        key="synopsis-edit-textarea"
                        ref={synopsisEditRef}
                        value={synopsisDraft}
                        onChange={(e) => setSynopsisDraft(e.target.value)}
                        rows={24}
                        className="w-full rounded-lg bg-bg-elevated border border-accent/50 text-sm text-text-primary p-3 leading-7 font-mono focus:outline-none focus:border-accent resize-y overflow-auto"
                        style={{ maxHeight: '70vh' }}
                        placeholder="编辑故事梗概…"
                      />
                    ) : (
                      <div className="rounded-lg bg-bg-elevated border border-border p-4 prose prose-invert prose-sm max-w-none text-text-primary whitespace-pre-wrap leading-relaxed text-sm">
                        <ReactMarkdown>{synopsisDraft}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}

                {isAutoRunning && autoRunCompleteTarget && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-accent/20 border border-accent/40 text-sm text-accent">
                    <Sparkles size={14} />
                    <span>已连续生成至第 {autoRunCompleteTarget} 集，生成完毕</span>
                  </div>
                )}

                {data.episodeTexts.map((ep) => {
                  const computedNextEp = data.episodeTexts.length > 0 ? Math.max(...data.episodeTexts.map((e) => e.epIndex)) + 1 : 1
                  const isThisStreaming = episodeStreaming && !!streamingBubble && ep.epIndex === computedNextEp - 1
                  const displayText = isThisStreaming && streamingBubble?.text
                    ? streamingBubble.text
                    : ep.text
                  const isExpanded = expandedEpisodes.has(ep.epIndex)
                  return (
                    <div
                      key={ep.epIndex}
                      ref={(el) => { episodeRefs.current[ep.epIndex] = el as HTMLDetailsElement | null }}
                      className="panel p-0"
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        className="flex items-center gap-2 px-5 py-4 cursor-pointer text-base font-semibold hover:bg-bg-elevated select-none"
                        onClick={() => {
                          setExpandedEpisodes((prev) => {
                            const next = new Set(prev)
                            if (next.has(ep.epIndex)) next.delete(ep.epIndex)
                            else next.add(ep.epIndex)
                            return next
                          })
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click() }}
                      >
                        <span className={`text-accent shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                        <span className="flex-1">第 {ep.epIndex} 集</span>
                        {isThisStreaming && (
                          <span className="inline-flex items-center gap-1 text-xs text-accent">
                            <Loader2 size={10} className="animate-spin" /> 生成中…
                          </span>
                        )}
                        {isExpanded && !isThisStreaming && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (episodeEditing === ep.epIndex) {
                                setData((d) => ({
                                  ...d,
                                  episodeTexts: d.episodeTexts.map((et) =>
                                    et.epIndex === ep.epIndex ? { ...et, text: episodeDraft } : et
                                  ),
                                }))
                                setEpisodeEditing(null)
                                setEpisodeDraft('')
                              } else {
                                setEpisodeEditing(ep.epIndex)
                                setEpisodeDraft(ep.text)
                              }
                            }}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold transition shrink-0 ${
                              episodeEditing === ep.epIndex
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                                : 'border border-border text-text-muted hover:text-text-primary hover:border-accent hover:bg-bg-elevated'
                            }`}
                          >
                            {episodeEditing === ep.epIndex ? <><Check size={11} /> 完成</> : <><Pencil size={11} /> 编辑</>}
                          </button>
                        )}
                        <span className="px-2 py-1 rounded-md bg-bg-elevated border border-border text-text-muted text-xs">
                          {isExpanded ? '折叠' : '展开'}
                        </span>
                      </div>
                      {isExpanded && displayText ? (
                        episodeEditing === ep.epIndex ? (
                          <div className="px-5 pb-5">
                            <textarea
                              key={`episode-edit-textarea-${ep.epIndex}`}
                              ref={episodeEditRef}
                              value={episodeDraft}
                              onChange={(e) => setEpisodeDraft(e.target.value)}
                              rows={20}
                              className="w-full rounded-lg bg-bg-elevated border border-accent/50 text-sm text-text-primary p-3 leading-7 font-mono focus:outline-none focus:border-accent resize-y overflow-auto"
                              style={{ maxHeight: '70vh' }}
                              placeholder="编辑剧本…"
                            />
                          </div>
                        ) : (
                          <div className="px-5 pb-5 prose prose-invert prose-sm max-w-none text-text-primary whitespace-pre-wrap leading-relaxed text-sm">
                            <ReactMarkdown>{displayText}</ReactMarkdown>
                          </div>
                        )
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )
          })()}
          {tab === 'episodes' && (() => {
            const episodes = data.episodeTexts
            if (!episodes.length) {
              return (
                <div className="max-w-4xl mx-auto panel p-10 text-center">
                  <p className="text-text-muted text-sm">{t.ws_episodes_empty}</p>
                </div>
              )
            }
            const selectedEp = episodes.find((ep) => ep.epIndex === selectedEpisodeIndex) ?? episodes[episodes.length - 1]

            return (
              <div className="max-w-5xl mx-auto space-y-6 pb-4">
                <div>
                  <h3 className="font-display text-lg font-bold mb-3">{t.ws_episodes_select}</h3>
                  <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
                    {episodes.map((ep) => {
                      const active = ep.epIndex === selectedEp.epIndex
                      const preview = ep.text.slice(0, 80)
                      return (
                        <button
                          key={ep.epIndex}
                          ref={(el) => { episodeCardRefs.current[ep.epIndex] = el }}
                          onClick={() => setSelectedEpisodeIndex(ep.epIndex)}
                          className={`min-w-[160px] max-w-[160px] p-3 rounded-xl border text-left transition shrink-0 ${
                            active
                              ? 'border-accent bg-accent-dim/40 shadow-glow'
                              : 'border-border bg-bg-elevated/60 hover:border-accent/50'
                          }`}
                        >
                          <div className="font-semibold text-sm mb-1">第 {ep.epIndex} 集</div>
                          <div className="text-xs text-text-muted line-clamp-3 leading-relaxed">{preview}…</div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {selectedEp && (
                  <div className="panel p-0">
                    <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
                      <span className="text-accent font-bold">▶</span>
                      <span className="flex-1 font-display text-base font-semibold">第 {selectedEp.epIndex} 集 · {t.ws_episodes_script}</span>
                      <button
                        onClick={() => {
                          if (episodeEditing === selectedEp.epIndex) {
                            setData((d) => ({
                              ...d,
                              episodeTexts: d.episodeTexts.map((et) =>
                                et.epIndex === selectedEp.epIndex ? { ...et, text: episodeDraft } : et
                              ),
                            }))
                            setEpisodeEditing(null)
                            setEpisodeDraft('')
                          } else {
                            setEpisodeEditing(selectedEp.epIndex)
                            setEpisodeDraft(selectedEp.text)
                          }
                        }}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold transition shrink-0 ${
                          episodeEditing === selectedEp.epIndex
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                            : 'border border-border text-text-secondary hover:text-text-primary hover:border-accent hover:bg-bg-elevated'
                        }`}
                      >
                        {episodeEditing === selectedEp.epIndex ? <><Check size={11} /> 完成</> : <><Pencil size={11} /> 编辑</>}
                      </button>
                    </div>
                    {episodeEditing === selectedEp.epIndex ? (
                      <div className="px-5 pb-5 pt-4">
                        <textarea
                          key={`episodes-view-edit-textarea-${selectedEp.epIndex}`}
                          ref={episodeEditRef}
                          value={episodeDraft}
                          onChange={(e) => setEpisodeDraft(e.target.value)}
                          rows={20}
                          className="w-full rounded-lg bg-bg-elevated border border-accent/50 text-sm text-text-primary p-3 leading-7 font-mono focus:outline-none focus:border-accent resize-y overflow-auto"
                          style={{ maxHeight: '70vh' }}
                          placeholder="编辑剧本…"
                        />
                      </div>
                    ) : (
                      <div className="px-5 pb-5 pt-4 prose prose-invert prose-sm max-w-none text-text-primary whitespace-pre-wrap leading-relaxed text-sm">
                        <ReactMarkdown>{selectedEp.text}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}
          {tab === 'character' && (() => {
            // 角色/场景 都按当前选中集数过滤 —— 一次只看一集。
            const epChars = data.characters.filter((c) => c.episodes.includes(selectedEpisodeIndex))
            const epScenes = data.scenes.filter((s) => s.episodeIndex === selectedEpisodeIndex)
            const hasChars = epChars.length > 0
            const hasScenes = epScenes.length > 0
            const epProps = data.props.filter((p) => p.episodeIndex === selectedEpisodeIndex)
            const hasProps = epProps.length > 0
            const hasAnyEp = data.episodeTexts.some((e) => e.epIndex === selectedEpisodeIndex)
            const extractPrompt = `从第 ${selectedEpisodeIndex} 集提取角色、场景和道具`

            if (!hasChars && !hasScenes && !hasProps) {
              // 当集没数据时,给出"提取本集角色"的入口(快捷路径),
              // 避免用户切到角色 tab 后看到一个空壳还要跑去 chat 里发命令。
              return (
                <div className="max-w-4xl mx-auto panel p-10 text-center space-y-3">
                  <Users size={36} className="mx-auto text-text-muted" />
                  <p className="text-text-secondary font-medium">第 {selectedEpisodeIndex} 集 还没有角色、场景和道具</p>
                  <p className="text-xs text-text-muted leading-relaxed">
                    {hasAnyEp
                      ? '点击下方按钮,AI 会从当集剧本里提取本集出现的角色、场景和道具,自动给角色生成形象参考图。'
                      : '请先在「分集」标签生成当集剧本,然后回到这里提取角色。'}
                  </p>
                  {hasAnyEp && (
                    <button
                      type="button"
                      onClick={() => { chatPanelRef.current?.triggerWorkflow('character', () => produce('character', extractPrompt), { jumpAfter: true, userMsg: extractPrompt }); }}
                      className="mt-2 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-accent-dim text-accent text-sm font-semibold hover:bg-accent hover:text-white transition disabled:opacity-40"
                    >
                      <Sparkles size={13} /> 提取第 {selectedEpisodeIndex} 集角色、场景和道具
                    </button>
                  )}
                  {!hasAnyEp && (
                    <button
                      type="button"
                      onClick={() => setTab('episodes')}
                      className="mt-2 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-accent-dim text-accent text-sm font-semibold hover:bg-accent hover:text-white transition"
                    >
                      切到分集剧本 →
                    </button>
                  )}
                </div>
              )
            }

            const order: Record<GenCharacter['role'], number> = { lead: 0, supporting: 1, villain: 2 }
            const sorted = [...epChars].sort((a, b) => order[a.role] - order[b.role])

            return (
              <div className="-m-6 h-[calc(100vh-3rem)] flex flex-col">
                <div className="flex items-center gap-2 px-6 pt-4 pb-2 shrink-0 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-accent-dim text-accent text-xs font-semibold border border-accent/40">
                    <Users size={12} /> 第 {selectedEpisodeIndex} 集
                  </span>
                  <button
                    onClick={() => setCharViewTab('characters')}
                    className={`px-4 py-1.5 rounded-full text-sm font-semibold transition border ${
                      charViewTab === 'characters'
                        ? 'bg-accent-dim text-accent border-accent'
                        : 'border-border text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                    }`}
                  >
                    角色 {hasChars && `(${epChars.length})`}
                  </button>
                  <button
                    onClick={() => setCharViewTab('scenes')}
                    className={`px-4 py-1.5 rounded-full text-sm font-semibold transition border ${
                      charViewTab === 'scenes'
                        ? 'bg-accent-dim text-accent border-accent'
                        : 'border-border text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                    }`}
                  >
                    场景 {hasScenes && `(${epScenes.length})`}
                  </button>
                  <button
                    onClick={() => setCharViewTab('props')}
                    className={`px-4 py-1.5 rounded-full text-sm font-semibold transition border ${
                      charViewTab === 'props'
                        ? 'bg-accent-dim text-accent border-accent'
                        : 'border-border text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                    }`}
                  >
                    道具 {hasProps && `(${epProps.length})`}
                  </button>
                  {hasAnyEp && (
                    <button
                      type="button"
                      onClick={() => { chatPanelRef.current?.triggerWorkflow('character', () => produce('character', extractPrompt), { jumpAfter: true, userMsg: extractPrompt }); }}
                      className="ml-auto text-[11px] px-2.5 py-1 rounded border border-border bg-bg-elevated text-text-secondary hover:border-accent hover:text-accent transition inline-flex items-center gap-1"
                      title={`重新从第 ${selectedEpisodeIndex} 集剧本提取(会覆盖本集已有角色/场景/道具)`}
                    >
                      <RefreshCw size={11} /> 重新提取本集
                    </button>
                  )}
                  {hasChars && charViewTab === 'characters' && (
                    <button
                      type="button"
                      onClick={() => void generateAllCharacterLooksForCurrentEpisode()}
                      className="text-[11px] px-2.5 py-1 rounded border border-accent/40 bg-accent/10 text-accent hover:bg-accent hover:text-accent-foreground transition inline-flex items-center gap-1"
                      title="遍历本集所有角色的所有 look(默认 + 变体),未生成的逐个生成(I2I 锁脸)。比 autoGen 只跑默认更彻底,适合用户主动'批量出图'"
                    >
                      <Sparkles size={11} /> 一键生成所有形象
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto min-h-0">
                  {charViewTab === 'scenes' ? (
                    hasScenes ? (
                      // 2026/06:场景 UI 跟角色 UI 对齐 —— 网格卡片,点击放大,
                      // 卡片底部只有「三视图」+「编辑」两个按钮。原详情面板里
                      // 的 action/beats/dialogue 移到点击后的放大 lightbox 里展示。
                      <><div className="px-6 py-3 flex items-center gap-2 border-b border-border/40">
                        <span className="text-xs text-text-muted">{epScenes.length} 个场景</span>
                        <button
                          type="button"
                          onClick={() => setData((d) => ({ ...d, scenes: [...d.scenes, createEmptyScene(selectedEpisodeIndex)] }))}
                          className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-border text-text-muted text-xs hover:border-accent hover:text-accent hover:bg-accent-dim transition"
                        >
                          <Plus size={12} /> 添加场景
                        </button>
                      </div>
                      <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        {epScenes.map((s) => {
                          const history = sceneImages[s.id] ?? []
                          const hasImg = history.length > 0
                          const sceneRegenMode = regenBusyKeys.get(s.id)
                          const isRegening = sceneRegenMode !== undefined
                          const sceneImgCount = history.length
                          // 2026/06:跟角色 selectedCharImages 对称 —— 选中的图作封面
                          const pinned = selectedSceneImages[s.id]
                          const coverUrl = (pinned && history.includes(pinned)) ? pinned : history.at(-1)
                          const isPinned = !!pinned && pinned === coverUrl
                          return (
                            <div
                              key={s.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => setScenePreview(s)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  setScenePreview(s)
                                }
                              }}
                              className={`group relative text-left rounded-xl border bg-bg-elevated/40 hover:border-accent hover:bg-bg-elevated/70 hover:-translate-y-0.5 transition-all overflow-hidden flex flex-col focus:outline-none focus:ring-2 focus:ring-accent/40 cursor-pointer ${
                                isPinned
                                  ? 'border-2 border-accent shadow-[0_0_0_3px_rgba(99,102,241,0.25)]'
                                  : 'border border-border'
                              }`}
                            >
                              {/* Image area — 16:9,跟场景图实际比例对齐 */}
                              <div className="relative w-full aspect-video bg-bg-base overflow-hidden">
                                {busyScene === s.id && !hasImg ? (
                                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-muted">
                                    <Loader2 size={20} className="animate-spin text-accent" />
                                    <span className="text-[10px]">生成中…</span>
                                  </div>
                                ) : hasImg ? (
                                  <img
                                    src={coverUrl!}
                                    alt={s.slug}
                                    loading="lazy"
                                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); genSceneImage(s) }}
                                    className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-text-muted hover:text-accent hover:bg-bg-elevated/40 transition cursor-pointer"
                                  >
                                    <ImageIcon size={22} className="opacity-50" />
                                    <span className="text-[10px]">点击生成场景图</span>
                                  </button>
                                )}
                                {sceneImgCount > 1 && (
                                  <span className="absolute top-1.5 left-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/60 text-white">
                                    {sceneImgCount} 张
                                  </span>
                                )}
                                {/* 2026/06:跟角色卡对齐 —— "已选为推荐" 角标 + 右上"选中"按钮 */}
                                {isPinned && (
                                  <div className="absolute top-1.5 right-1.5 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent text-accent-foreground text-[10px] font-bold shadow-md">
                                    <Target size={10} /> 已选为推荐
                                  </div>
                                )}
                                {hasImg && !isRegening && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      // 互斥:同 sceneId 只能选 1 张,这里选/取消切换
                                      if (isPinned) {
                                        setSelectedSceneImages((m) => {
                                          const { [s.id]: _omit, ...rest } = m
                                          return rest
                                        })
                                      } else {
                                        setSelectedSceneImages((m) => ({ ...m, [s.id]: coverUrl! }))
                                      }
                                    }}
                                    title={isPinned ? '已选中此图作为场景 reference,再点取消' : '把这张设为场景 reference(分镜/故事板/按意见重生都会用)'}
                                    className={`absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium backdrop-blur-sm transition ${
                                      isPinned
                                        ? 'bg-accent text-accent-foreground shadow-sm'
                                        : 'bg-black/70 text-white hover:bg-black/90'
                                    }`}
                                  >
                                    {isPinned ? (
                                      <><Check size={10} /> 已选中</>
                                    ) : (
                                      <><Target size={10} /> 设为推荐</>
                                    )}
                                  </button>
                                )}
                                {/* 上传本地图片按钮 */}
                                {!hasImg ? (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleUploadImage('scene', s.id, s.id) }}
                                    className="absolute bottom-1.5 right-1.5 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] hover:bg-accent hover:text-accent-foreground transition backdrop-blur-sm"
                                    title="上传本地图片"
                                  >
                                    <Upload size={10} /> 上传
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleUploadImage('scene', s.id, s.id) }}
                                    className="absolute bottom-1.5 right-1.5 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] hover:bg-accent hover:text-accent-foreground transition backdrop-blur-sm"
                                    title="上传本地图片覆盖"
                                  >
                                    <Upload size={10} /> 上传
                                  </button>
                                )}
                                {/* 保存到资产库按钮 */}
                                {hasImg && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); void saveSceneToAssets(s, s.id) }}
                                    title={savedAssetKeys.has(s.id) ? '已保存到资产库,点击重新保存当前封面图' : '把这张场景卡(含主图)保存到你的资产库'}
                                    className={`absolute bottom-1.5 left-1.5 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium backdrop-blur-sm transition ${
                                      savedAssetKeys.has(s.id)
                                        ? 'bg-emerald-500/85 text-white shadow-sm'
                                        : 'bg-black/70 text-white hover:bg-accent hover:text-accent-foreground'
                                    }`}
                                  >
                                    {savedAssetKeys.has(s.id) ? (
                                      <><Check size={10} /> 已保存</>
                                    ) : (
                                      <><BookmarkPlus size={10} /> 保存到资产</>
                                    )}
                                  </button>
                                )}
                              </div>

                              {/* Text area — 标题 + 时段 badge + action brief + 2 按钮 */}
                              <div className="p-2.5 flex flex-col flex-1 gap-1.5">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="font-mono text-[10px] text-text-muted shrink-0">SC {s.index}</span>
                                  <h3 className="font-display text-sm font-bold text-text-primary truncate">{s.slug}</h3>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border bg-bg-elevated text-text-muted shrink-0">
                                    {SCENE_TIME_LABELS[s.timeOfDay] ?? s.timeOfDay}
                                  </span>
                                </div>
                                {s.action && (
                                  <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-2">{s.action}</p>
                                )}
                                {/* 2 个操作按钮:三视图 + 编辑。mt-auto 让按钮行贴着卡片底部,
                                    不管 brief 长度如何,位置都一致(跟角色卡行为一致)。 */}
                                <div className="grid grid-cols-2 gap-1.5 pt-1 mt-auto" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    title="生成 3 景别参考图(wide + medium + close-up)"
                                    disabled={!hasImg || isRegening}
                                    onClick={() => void runScenePresetRegen(s)}
                                    className="px-1 py-1.5 rounded border border-border bg-bg-surface text-text-secondary text-[11px] leading-none hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition flex flex-col items-center justify-center gap-0.5"
                                  >
                                    <LayoutGrid size={12} />
                                    <span>三视图</span>
                                  </button>
                                  <button
                                    type="button"
                                    title="打开修改输入(右侧对话框)"
                                    disabled={!hasImg || isRegening}
                                    onClick={() => {
                                      const coverUrl = sceneImages[s.id]?.at(-1)
                                      if (coverUrl) {
                                        chatPanelRef.current?.setPendingRef('scene', s.id, s.slug || s.location || s.id, coverUrl)
                                      }
                                    }}
                                    className="px-1 py-1.5 rounded border border-border bg-bg-surface text-text-secondary text-[11px] leading-none hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition flex flex-col items-center justify-center gap-0.5"
                                  >
                                    <Pencil size={12} />
                                    <span>编辑</span>
                                  </button>
                                </div>
                              </div>

                              {/* I2I 重生遮罩:点了三视图/编辑后,整张卡盖住 spinner + 提示文字 */}
                              {isRegening && (
                                <div
                                  role="status"
                                  aria-live="polite"
                                  className="absolute inset-0 z-20 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center gap-3 text-white px-3 text-center"
                                >
                                  <Loader2 size={28} className="animate-spin text-accent" />
                                  <div className="text-sm font-medium leading-snug">
                                    {sceneRegenMode === 'three-view' ? '正在生成三视图…' : '正在重生…'}
                                  </div>
                                  <div className="text-[10px] text-white/60 leading-snug">生成中请勿关闭页面</div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div></>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full gap-2">
                        <p className="text-text-muted text-sm">第 {selectedEpisodeIndex} 集 暂无场景数据</p>
                        <div className="flex items-center gap-2">
                          {hasAnyEp && (
                            <button
                              type="button"
                              onClick={() => { chatPanelRef.current?.triggerWorkflow('character', () => produce('character', extractPrompt), { jumpAfter: true, userMsg: extractPrompt }); }}
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent-dim text-accent text-xs font-semibold hover:bg-accent hover:text-white transition"
                            >
                              <Sparkles size={11} /> 提取本集场景
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setData((d) => ({ ...d, scenes: [...d.scenes, createEmptyScene(selectedEpisodeIndex)] }))}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-dashed border-border text-text-muted text-xs hover:border-accent hover:text-accent hover:bg-accent-dim transition"
                          >
                            <Plus size={11} /> 添加空场景
                          </button>
                        </div>
                      </div>
                    )
                  ) : charViewTab === 'props' ? (
                    hasProps ? (
                      // 2026/06:道具 UI —— 与场景对称的网格卡片
                      <><div className="px-6 py-3 flex items-center gap-2 border-b border-border/40">
                        <span className="text-xs text-text-muted">{epProps.length} 个道具</span>
                        <button
                          type="button"
                          onClick={() => setData((d) => ({ ...d, props: [...d.props, createEmptyProp(selectedEpisodeIndex)] }))}
                          className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-border text-text-muted text-xs hover:border-accent hover:text-accent hover:bg-accent-dim transition"
                        >
                          <Plus size={12} /> 添加道具
                        </button>
                      </div>
                      <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        {epProps.map((p) => {
                          const history = propImages[p.id] ?? []
                          const hasImg = history.length > 0
                          const propRegenMode = regenBusyKeys.get(p.id)
                          const isRegening = propRegenMode !== undefined
                          const propImgCount = history.length
                          const pinned = selectedPropImages[p.id]
                          const coverUrl = (pinned && history.includes(pinned)) ? pinned : history.at(-1)
                          const isPinned = !!pinned && pinned === coverUrl
                          return (
                            <div
                              key={p.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => setPropPreview(p)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  setPropPreview(p)
                                }
                              }}
                              className={`group relative text-left rounded-xl border bg-bg-elevated/40 hover:border-accent hover:bg-bg-elevated/70 hover:-translate-y-0.5 transition-all overflow-hidden flex flex-col focus:outline-none focus:ring-2 focus:ring-accent/40 cursor-pointer ${
                                isPinned
                                  ? 'border-2 border-accent shadow-[0_0_0_3px_rgba(99,102,241,0.25)]'
                                  : 'border border-border'
                              }`}
                            >
                              {/* Image area — 4:3 道具图区 */}
                              <div className="relative w-full aspect-[4/3] bg-bg-base overflow-hidden">
                                {busyProp === p.id && !hasImg ? (
                                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-muted">
                                    <Loader2 size={20} className="animate-spin text-accent" />
                                    <span className="text-[10px]">生成中…</span>
                                  </div>
                                ) : hasImg ? (
                                  <img
                                    src={coverUrl!}
                                    alt={p.name}
                                    loading="lazy"
                                    className="absolute inset-0 w-full h-full object-contain p-4 group-hover:scale-[1.03] transition-transform duration-300"
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); genPropImage(p) }}
                                    className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-text-muted hover:text-accent hover:bg-bg-elevated/40 transition cursor-pointer"
                                  >
                                    <ImageIcon size={22} className="opacity-50" />
                                    <span className="text-[10px]">点击生成道具图</span>
                                  </button>
                                )}
                                {/* 上传本地图片按钮 */}
                                {!hasImg ? (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleUploadImage('prop', p.id, p.id) }}
                                    className="absolute bottom-1.5 right-1.5 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] hover:bg-accent hover:text-accent-foreground transition backdrop-blur-sm"
                                    title="上传本地图片"
                                  >
                                    <Upload size={10} /> 上传
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleUploadImage('prop', p.id, p.id) }}
                                    className="absolute bottom-1.5 right-1.5 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] hover:bg-accent hover:text-accent-foreground transition backdrop-blur-sm"
                                    title="上传本地图片覆盖"
                                  >
                                    <Upload size={10} /> 上传
                                  </button>
                                )}
                                {/* 保存到资产库按钮 */}
                                {hasImg && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); void savePropToAssets(p, p.id) }}
                                    title={savedAssetKeys.has(p.id) ? '已保存到资产库,点击重新保存当前封面图' : '把这张道具卡(含主图)保存到你的资产库'}
                                    className={`absolute bottom-1.5 left-1.5 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium backdrop-blur-sm transition ${
                                      savedAssetKeys.has(p.id)
                                        ? 'bg-emerald-500/85 text-white shadow-sm'
                                        : 'bg-black/70 text-white hover:bg-accent hover:text-accent-foreground'
                                    }`}
                                  >
                                    {savedAssetKeys.has(p.id) ? (
                                      <><Check size={10} /> 已保存</>
                                    ) : (
                                      <><BookmarkPlus size={10} /> 保存到资产</>
                                    )}
                                  </button>
                                )}
                                {propImgCount > 1 && (
                                  <span className="absolute top-1.5 left-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/60 text-white">
                                    {propImgCount} 张
                                  </span>
                                )}
                                {isPinned && (
                                  <div className="absolute top-1.5 right-1.5 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent text-accent-foreground text-[10px] font-bold shadow-md">
                                    <Target size={10} /> 已选为推荐
                                  </div>
                                )}
                                {hasImg && !isRegening && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (isPinned) {
                                        setSelectedPropImages((m) => {
                                          const { [p.id]: _omit, ...rest } = m
                                          return rest
                                        })
                                      } else {
                                        setSelectedPropImages((m) => ({ ...m, [p.id]: coverUrl! }))
                                      }
                                    }}
                                    title={isPinned ? '已选中,再点取消' : '把这张设为道具 reference'}
                                    className={`absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium backdrop-blur-sm transition ${
                                      isPinned
                                        ? 'bg-accent text-accent-foreground shadow-sm'
                                        : 'bg-black/70 text-white hover:bg-black/90'
                                    }`}
                                  >
                                    {isPinned ? (
                                      <><Check size={10} /> 已选中</>
                                    ) : (
                                      <><Target size={10} /> 设为推荐</>
                                    )}
                                  </button>
                                )}
                                {/* 上传本地图片按钮 */}
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleUploadImage('prop', p.id, p.id) }}
                                  className="absolute bottom-1.5 left-1.5 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] hover:bg-accent hover:text-accent-foreground transition backdrop-blur-sm"
                                  title="上传本地图片覆盖"
                                >
                                  <Upload size={10} /> 上传
                                </button>
                              </div>

                              {/* Text area */}
                              <div className="p-2.5 flex flex-col flex-1 gap-1.5">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <h3 className="font-display text-sm font-bold text-text-primary truncate">{p.name}</h3>
                                </div>
                                {p.description && (
                                  <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-2">{p.description}</p>
                                )}
                                {p.movementDescription && (
                                  <p className="text-[10px] text-text-muted leading-relaxed italic line-clamp-2">📦 {p.movementDescription}</p>
                                )}
                                {/* 2 个操作按钮 */}
                                <div className="grid grid-cols-2 gap-1.5 pt-1 mt-auto" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    title="生成 3 个不同角度的展示图"
                                    disabled={!hasImg || isRegening}
                                    onClick={() => void runPropPresetRegen(p)}
                                    className="px-1 py-1.5 rounded border border-border bg-bg-surface text-text-secondary text-[11px] leading-none hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition flex flex-col items-center justify-center gap-0.5"
                                  >
                                    <LayoutGrid size={12} />
                                    <span>三视图</span>
                                  </button>
                                  <button
                                    type="button"
                                    title="打开修改输入对话框"
                                    disabled={!hasImg || isRegening}
                                    onClick={() => {
                                      const coverUrl = propImages[p.id]?.at(-1)
                                      if (coverUrl) {
                                        chatPanelRef.current?.setPendingRef('prop', p.id, p.name, coverUrl)
                                      }
                                    }}
                                    className="px-1 py-1.5 rounded border border-border bg-bg-surface text-text-secondary text-[11px] leading-none hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition flex flex-col items-center justify-center gap-0.5"
                                  >
                                    <Pencil size={12} />
                                    <span>编辑</span>
                                  </button>
                                </div>
                              </div>

                              {/* I2I 重生遮罩 */}
                              {isRegening && (
                                <div
                                  role="status"
                                  aria-live="polite"
                                  className="absolute inset-0 z-20 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center gap-3 text-white px-3 text-center"
                                >
                                  <Loader2 size={28} className="animate-spin text-accent" />
                                  <div className="text-sm font-medium leading-snug">
                                    {propRegenMode === 'three-view' ? '正在生成三视图…' : '正在重生…'}
                                  </div>
                                  <div className="text-[10px] text-white/60 leading-snug">生成中请勿关闭页面</div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div></>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full gap-2">
                        <p className="text-text-muted text-sm">第 {selectedEpisodeIndex} 集 暂无道具数据</p>
                        <div className="flex items-center gap-2">
                          {hasAnyEp && (
                            <button
                              type="button"
                              onClick={() => { chatPanelRef.current?.triggerWorkflow('character', () => produce('character', extractPrompt), { jumpAfter: true, userMsg: extractPrompt }); }}
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent-dim text-accent text-xs font-semibold hover:bg-accent hover:text-white transition"
                            >
                              <Sparkles size={11} /> 提取本集道具
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setData((d) => ({ ...d, props: [...d.props, createEmptyProp(selectedEpisodeIndex)] }))}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-dashed border-border text-text-muted text-xs hover:border-accent hover:text-accent hover:bg-accent-dim transition"
                          >
                            <Plus size={11} /> 添加空道具
                          </button>
                        </div>
                      </div>
                    )
                  ) : hasChars ? (
                    <><div className="px-6 py-3 flex items-center gap-2 border-b border-border/40">
                      <span className="text-xs text-text-muted">{epChars.length} 个角色</span>
                      <button
                        type="button"
                        onClick={() => setData((d) => ({ ...d, characters: [...d.characters, createEmptyCharacter(selectedEpisodeIndex)] }))}
                        className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-border text-text-muted text-xs hover:border-accent hover:text-accent hover:bg-accent-dim transition"
                      >
                        <Plus size={12} /> 添加角色
                      </button>
                    </div>
                    <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                      {(() => {
                        // 把"每个角色每个 look"展平成"每张卡片一行",保证同角色
                        // 不同造型各自一张卡(男主角-医生 / 男主角-穿越 ...)。
                        type DisplayCard = {
                          character: GenCharacter
                          lookId: string | null  // null = 默认
                          lookLabel: string
                          imageKey: string
                        }
                        // 2026/06 新增:把"之前几集出现过但本集没用到"的角色,
                        // 在当集角色之后追加展示(只展示,不能编辑/参与当集)。
                        // 同角色按 episodes 列表区分:本集 = c.episodes.includes(sel);
                        // 之前几集 = !本集 && c.episodes.some(ep => ep < sel)
                        const prevEpsChars = data.characters.filter((c) =>
                          !c.episodes.includes(selectedEpisodeIndex)
                          && c.episodes.some((ep) => ep < selectedEpisodeIndex),
                        )
                        const prevSorted = [...prevEpsChars].sort((a, b) => order[a.role] - order[b.role])

                        function buildCardsFor(chars: GenCharacter[]): DisplayCard[] {
                          const arr: DisplayCard[] = []
                          for (const c of chars) {
                            arr.push({
                              character: c, lookId: null, lookLabel: '默认',
                              imageKey: c.id,
                            })
                            for (const lk of c.looks ?? []) {
                              arr.push({
                                character: c, lookId: lk.id, lookLabel: lk.label,
                                imageKey: `${c.id}::${lk.id}`,
                              })
                            }
                          }
                          return arr
                        }
                        const currentCards = buildCardsFor(sorted)
                        const prevCards = buildCardsFor(prevSorted)
                        function renderCard(card: DisplayCard) {
                          const { character: c, lookLabel, imageKey } = card
                          const hasImg = !!(charImages[imageKey] && charImages[imageKey].length > 0)
                          // 并行策略:不同角色同时跑,同角色串行。
                          //   activeImageKey === imageKey: 这张图**正在画**
                          //   busyChars.has(c.id) 但 activeImageKey 不是这张:同角色下一张在排队
                          //   都不在:没排上(其他角色在画、或本角色所有 look 都好了)
                          const isActive = activeImageKey === imageKey
                          const isQueued = !isActive && busyChars.has(c.id)
                          // I2I 重生(按意见 / 三视图 / 多维资产)是否在这张卡上跑,
                          // 跑了就显示黑屏遮罩 + 对应模式的提示文字。
                          const regenMode = regenBusyKeys.get(imageKey)
                          const isRegening = regenMode !== undefined
                          const regenLabel =
                            regenMode === 'three-view' ? '正在生成三视图…' :
                            regenMode === 'multi-asset' ? '正在生成多维资产图…' :
                            regenMode === 'modify' ? '正在按意见重生…' :
                            '正在生成…'
                          // 2026/06:per-episode roleLabel override —— ep 切换时若
                          // 该 GenCharacter 在该集有不同 roleLabel,这里会读到 override 后的版本
                          const effectiveRoleLabel = getEffectiveRoleLabel(c, selectedEpisodeIndex)
                          const [primary, ...rest] = effectiveRoleLabel.split('·').map((s) => s.trim()).filter(Boolean)
                          const archetype = rest.join(' · ')
                          const brief = c.personality?.trim() || ''
                          const cardTitle = card.lookId === null ? c.name : `${c.name} · ${lookLabel}`
                          return (
                            // 外层用 div role="button" 而不是 <button>:卡片内部还要
                            // 套 3 个真正的 <button>(修改 / 三视图 / 多维资产),
                            // <button> 不能嵌 <button>,会 hydration error。
                            // 2026/06:已选中时(同 imageKey 在 selectedCharImages 里有
                            // 值)整张卡片加 accent 边框 + 略放大 + 角标 —— 让"互斥
                            // 选中"状态在卡片层面即可见。同一 imageKey 的所有图
                            // (主视图/三视图/多维资产 history)互斥:只有最后被点
                            // "选中"的那张 url 存在 selectedCharImages 里。
                            <div
                              key={imageKey}
                              role="button"
                              tabIndex={0}
                              onClick={() => openModPanel(c, card.lookId)}
                              onKeyDown={(e) => {
                                // 键盘可达:Enter / Space 等价于点击
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  openModPanel(c, card.lookId)
                                }
                              }}
                              className={`group relative text-left rounded-xl border bg-bg-elevated/40 hover:border-accent hover:bg-bg-elevated/70 hover:-translate-y-0.5 transition-all overflow-hidden flex flex-col focus:outline-none focus:ring-2 focus:ring-accent/40 cursor-pointer ${
                                // 2026/06:已选中时(封面 === 选中图)整张卡片高亮。
                                // 边框变 accent + 略放大 + 暖色阴影,让"互斥选中"在
                                // 卡片层面即可见。同 imageKey 只能有 1 个 url 钉在
                                // selectedCharImages 里(Record<imageKey, string>
                                // 天然互斥),点新的会自动覆盖旧的。
                                // 判定"封面 === 选中":如果 selectedCharImages[imageKey]
                                // 存在,且等于 charImages 里任一张(被选中的那张,
                                // 可能不是最新),卡片就高亮。
                                selectedCharImages[imageKey] && charImages[imageKey]?.includes(selectedCharImages[imageKey])
                                  ? 'border-2 border-accent shadow-[0_0_0_3px_rgba(99,102,241,0.25)] -translate-y-0.5 bg-bg-elevated/70'
                                  : 'border border-border'
                              }`}
                            >
                              {/* Image area — portrait aspect, fills card top */}
                              <div className="relative w-full aspect-[3/4] bg-bg-base overflow-hidden">
                                {isActive && !hasImg ? (
                                  // 这张图**正在画**:spinner
                                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-muted">
                                    <Loader2 size={22} className="animate-spin text-accent" />
                                    <span className="text-[10px]">生成中…</span>
                                  </div>
                                ) : hasImg ? (
                                  <>
                                    {/* 2026/06:封面图加载失败的遮罩 + 追踪 */}
                                    {brokenCharImages.has(imageKey) && (
                                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-bg-base/70 backdrop-blur-[1px]">
                                        <div className="size-7 rounded-full bg-amber-500/20 flex items-center justify-center">
                                          <span className="text-amber-400 text-xs font-bold">!</span>
                                        </div>
                                        <span className="text-[10px] text-amber-400/90 font-medium">图片已失效</span>
                                      </div>
                                    )}
                                    {/* 2026/06:封面图 = 选中的那张(如果选了)否则最新一张。
                                        这让"点击选中 → 卡片封面变成选中的图"立即可见。 */}
                                    {(() => {
                                      const coverUrl = selectedCharImages[imageKey] || charImages[imageKey]!.at(-1)!
                                      return (
                                        <img
                                          src={coverUrl}
                                          alt={cardTitle}
                                          loading="lazy"
                                          onLoad={() => clearCharImageBroken(imageKey)}
                                          onError={(e) => markCharImageBroken(imageKey, (e.target as HTMLImageElement).src)}
                                          className={`absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300 ${
                                            brokenCharImages.has(imageKey) ? 'opacity-20' : ''
                                          }`}
                                        />
                                      )
                                    })()}
                                    {/* 2026/06:已选为推荐角标(左上) — 封面 === 选中时显示。
                                        同一 imageKey 只能有 1 个 url 钉在 selectedCharImages 里(互斥),
                                        再次点击"选中"按钮可取消(清掉 entry)。 */}
                                    {selectedCharImages[imageKey] && (() => {
                                      const coverUrl = selectedCharImages[imageKey] || charImages[imageKey]?.at(-1)
                                      return coverUrl === selectedCharImages[imageKey] ? (
                                        <div className="absolute top-1.5 left-1.5 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent text-accent-foreground text-[10px] font-bold shadow-md">
                                          <Target size={10} /> 已选为推荐
                                        </div>
                                      ) : null
                                    })()}
                                  </>
                                ) : isQueued ? (
                                  // 同角色下一张在排队(本角色在跑)
                                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-text-muted">
                                    <Loader2 size={14} className="opacity-50 animate-spin" />
                                    <span className="text-[10px]">同角色排队中…</span>
                                  </div>
                                ) : autoGen && busyChars.size > 0 ? (
                                  // 其他角色在画,这张在等
                                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-text-muted">
                                    <ImageIcon size={22} className="opacity-50" />
                                    <span className="text-[10px]">排队生成中…</span>
                                  </div>
                                ) : (
                                  // 没图:可点击生成(2026/06)
                                  //   默认 look → genCharImage → 走 processCharacter
                                  //   变体 look → generateOneCharacterLook → 走 I2I(以默认图为锚)
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (card.lookId === null) {
                                        void genCharImage(c)
                                      } else {
                                        void generateOneCharacterLook(c, card.lookId)
                                      }
                                    }}
                                    className="absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-1.5 text-text-muted hover:text-accent hover:bg-bg-elevated/40 transition cursor-pointer"
                                  >
                                    <ImageIcon size={22} className="opacity-50" />
                                    <span className="text-[10px]">
                                      {card.lookId === null
                                        ? '点击生成形象'
                                        : `点击生成「${lookLabel}」造型`}
                                    </span>
                                  </button>
                                )}
                                {/* 上传按钮:没图时显示在生成按钮下方,有图时显示在右下角 */}
                                {!hasImg ? (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleUploadImage('character', c.id, imageKey) }}
                                    className="absolute bottom-1.5 right-1.5 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] hover:bg-accent hover:text-accent-foreground transition backdrop-blur-sm"
                                    title="上传本地图片"
                                  >
                                    <Upload size={10} /> 上传
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleUploadImage('character', c.id, imageKey) }}
                                    className="absolute bottom-1.5 right-1.5 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] hover:bg-accent hover:text-accent-foreground transition backdrop-blur-sm"
                                    title="上传本地图片覆盖"
                                  >
                                    <Upload size={10} /> 上传
                                  </button>
                                )}
                                {/* "选中" 按钮(钉住当前展示图作为该 look 在分镜里的 reference)
                                    - 2026/06:始终可见(不再 opacity-70),让用户在不 hover
                                      的情况下也能直接看到/操作"选中"状态
                                    - 已选中时变成实心高亮 + "已选中" 文案
                                    - 点击调用 setSelectedCharImages,不再冒泡到卡片详情 modal
                                    - 预览模态右栏"修改形象"区也有一个对称的"选中"按钮 */}
                                {hasImg && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      const cur = charImages[imageKey]?.at(-1)
                                      if (!cur) return
                                      setSelectedCharImages((m) => {
                                        if (m[imageKey] === cur) {
                                          // 再点一次取消选中,回到"最新图"模式
                                          const { [imageKey]: _, ...rest } = m
                                          return rest
                                        }
                                        return { ...m, [imageKey]: cur }
                                      })
                                    }}
                                    title={
                                      selectedCharImages[imageKey]
                                        ? '已选中此图作为该 look 的 reference,再次点击取消'
                                        : '选中当前形象作为该 look 在分镜流程里的 reference'
                                    }
                                    className={`absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium backdrop-blur-sm transition ${
                                      selectedCharImages[imageKey]
                                        ? 'bg-accent text-accent-foreground shadow-sm'
                                        : 'bg-black/70 text-white hover:bg-black/90'
                                    }`}
                                  >
                                    {selectedCharImages[imageKey] ? (
                                      <>
                                        <Check size={10} /> 已选中
                                      </>
                                    ) : (
                                      <>
                                        <Target size={10} /> 选中
                                      </>
                                    )}
                                  </button>
                                )}
                                {/* 2026/06:per-item 「保存到资产」按钮 —— 钉在图片右下角,
                                    已保存状态显示「✓ 已保存」+ 绿色徽章。点击只存这一张卡
                                    的当前封面图(优先 selectedCharImages[imageKey],否则最新)。
                                    状态保存在 React state,刷新页面会重置(下次点重新入库)。 */}
                                {hasImg && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void saveCharacterToAssets(c, card.lookId, imageKey)
                                    }}
                                    title={savedAssetKeys.has(imageKey) ? '已保存到资产库,点击重新保存当前封面图' : '把这张角色卡(含主图)保存到你的资产库'}
                                    className={`absolute bottom-1.5 left-1.5 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium backdrop-blur-sm transition ${
                                      savedAssetKeys.has(imageKey)
                                        ? 'bg-emerald-500/85 text-white shadow-sm'
                                        : 'bg-black/70 text-white hover:bg-accent hover:text-accent-foreground'
                                    }`}
                                  >
                                    {savedAssetKeys.has(imageKey) ? (
                                      <>
                                        <Check size={10} /> 已保存
                                      </>
                                    ) : (
                                      <>
                                        <BookmarkPlus size={10} /> 保存到资产
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>

                              {/* Text area — flex column 拉伸,按钮用 mt-auto 钉到卡片底部,
                                  不管 brief 有多长 / 是否存在,3 个按钮始终贴底。 */}
                              <div className="p-2.5 flex flex-col flex-1 gap-1.5">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span
                                    className="w-0.5 h-4 rounded-full shrink-0"
                                    style={{ background: c.palette[0] ?? 'var(--accent)' }}
                                    aria-hidden
                                  />
                                  <h3 className="font-display text-sm font-bold text-text-primary truncate">{cardTitle}</h3>
                                  {/* 2026/06 跨集角标:同真人在多集出现时显示 ep1/2/3 等 */}
                                  {c.episodes.length > 1 && (
                                    <span
                                      className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30 font-mono shrink-0"
                                      title={`出现在第 ${c.episodes.join(', ')} 集`}
                                    >
                                      ep{c.episodes.join('/')}
                                    </span>
                                  )}
                                  <span className="ml-auto text-[10px] text-text-muted tabular-nums shrink-0">{c.age}岁</span>
                                </div>
                                <div className="flex items-center gap-1 flex-wrap">
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${ROLE_TONE[c.role]}`}>
                                    {primary || ROLE_LABEL_FALLBACK[c.role]}
                                  </span>
                                  {archetype && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border bg-bg-elevated/60 text-text-secondary truncate max-w-full">
                                      {archetype}
                                    </span>
                                  )}
                                </div>
                                {brief && (
                                  <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-2">{brief}</p>
                                )}
                                {/* 操作按钮:修改 / 标准三视图 / 多维资产图
                                    图标在上 / 文字在下(vertical stack),让 3 个按钮等宽,
                                    不会再因为"多维资产"4 字长度换行。mt-auto 让按钮行
                                    永远贴着卡片底部。注意 onClick 里 e.stopPropagation(),
                                    否则点按钮也会触发卡片整体的预览打开。 */}
                                <div className="grid grid-cols-3 gap-1.5 pt-1 mt-auto" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    title="基于此形象给出修改意见(右侧对话框输入)"
                                    disabled={!hasImg || isRegening}
                                    onClick={() => {
                                      const coverUrl = selectedCharImages[imageKey] || charImages[imageKey]?.at(-1)
                                      if (coverUrl) {
                                        chatPanelRef.current?.setPendingRef('character', c.id, cardTitle, coverUrl, card.lookId)
                                      }
                                    }}
                                    className="px-1 py-1.5 rounded border border-border bg-bg-surface text-text-secondary text-[11px] leading-none hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition flex flex-col items-center justify-center gap-0.5"
                                  >
                                    <Pencil size={12} />
                                    <span>修改</span>
                                  </button>
                                  <button
                                    type="button"
                                    title="生成标准三视图(front / side / back)"
                                    disabled={!hasImg || isRegening}
                                    onClick={() => void runPresetRegen(c, card.lookId, 'three-view')}
                                    className="px-1 py-1.5 rounded border border-border bg-bg-surface text-text-secondary text-[11px] leading-none hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition flex flex-col items-center justify-center gap-0.5"
                                  >
                                    <LayoutGrid size={12} />
                                    <span>三视图</span>
                                  </button>
                                  <button
                                    type="button"
                                    title="生成多维资产图(多姿态/表情/场景)"
                                    disabled={!hasImg || isRegening}
                                    onClick={() => void runPresetRegen(c, card.lookId, 'multi-asset')}
                                    className="px-1 py-1.5 rounded border border-border bg-bg-surface text-text-secondary text-[11px] leading-none hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition flex flex-col items-center justify-center gap-0.5"
                                  >
                                    <Sparkles size={12} />
                                    <span>多维资产</span>
                                  </button>
                                </div>
                              </div>
                              {/* I2I 重生遮罩:点了三视图/多维资产/按意见重生后,
                                  把整张卡盖住(spinner + 模式对应的提示文字),
                                  防止用户重复点 / 让进度可见。 */}
                              {isRegening && (
                                <div
                                  role="status"
                                  aria-live="polite"
                                  className="absolute inset-0 z-20 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center gap-3 text-white px-3 text-center"
                                >
                                  <Loader2 size={28} className="animate-spin text-accent" />
                                  <div className="text-sm font-medium leading-snug">{regenLabel}</div>
                                  <div className="text-[10px] text-white/60 leading-snug">生成中请勿关闭页面</div>
                                </div>
                              )}
                            </div>
                          )
                        }
                        // 渲染:当集角色 → 分隔标题(若有之前几集)→ 之前几集角色
                        return (
                          <>
                            {currentCards.map(renderCard)}
                            {prevCards.length > 0 && (
                              <>
                                <div className="col-span-full mt-2 pt-4 border-t border-border">
                                  <h3 className="text-sm text-text-secondary font-semibold inline-flex items-center gap-2">
                                    <Users size={14} className="text-text-muted" />
                                    之前几集出现过的角色 · {prevSorted.length} 位
                                    <span className="text-[11px] text-text-muted/70 font-normal">仅展示,不参与当集</span>
                                  </h3>
                                </div>
                                {prevCards.map(renderCard)}
                              </>
                            )}
                          </>
                        )
                      })()}
                    </div></>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-2">
                      <p className="text-text-muted text-sm">第 {selectedEpisodeIndex} 集 暂无角色数据</p>
                      {hasAnyEp && (
                        <button
                          type="button"
                          onClick={() => { chatPanelRef.current?.triggerWorkflow('character', () => produce('character', extractPrompt), { jumpAfter: true, userMsg: extractPrompt }); }}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent-dim text-accent text-xs font-semibold hover:bg-accent hover:text-white transition"
                        >
                          <Sparkles size={11} /> 提取本集角色
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })()}
          {tab === 'storyboard' && (() => {
            // ==============================================================
            //  新分镜编辑器视图(v2)
            //  - 列:左 plot 描述 / 中 AI 字段 + 分镜图 / 右 视频占位
            //  - 数据源:data.storyboardGroups(由"进入分镜"按钮从当集剧情 AI 切分)
            //  - 每行可单独重新生成,也可一键整组生成
            //  - 分镜组按集数过滤:只展示当前选中集的分镜。
            // ==============================================================
            const epGroups = data.storyboardGroups.filter((g) => g.episodeIndex === selectedEpisodeIndex)
            const hasAnyEp = data.episodeTexts.some((e) => e.epIndex === selectedEpisodeIndex)
            const hasEpChars = data.characters.some((c) => c.episodes.includes(selectedEpisodeIndex))
            if (epGroups.length === 0) {
              const needsChars = !hasEpChars && hasAnyEp
              return (
                <div className="max-w-4xl mx-auto panel p-10 text-center space-y-3">
                  <Camera size={36} className="mx-auto text-text-muted" />
                  <p className="text-text-secondary font-medium">第 {selectedEpisodeIndex} 集 还没有分镜</p>
                  {hasAnyEp ? (
                    <>
                      <p className="text-xs text-text-muted leading-relaxed">
                        {needsChars
                          ? '本集还没有角色。先切到「角色」标签提取本集角色(角色和场景是分镜的素材),再回来点击下方按钮切分本集剧情为分镜组。'
                          : '点击下方按钮,系统会把当集剧本发给 AI 切分成多组分镜,并按剧情 / 镜头自动生成多图融合的分镜图。'}
                      </p>
                      <button
                        type="button"
                      onClick={() => {
                        if (busyStoryboardGen || needsChars) return;
                        chatPanelRef.current?.triggerWorkflow('storyboard', () => runEnterStoryboard(), { jumpAfter: true, userMsg: `进入第 ${selectedEpisodeIndex} 集分镜` });
                      }}
                        disabled={busyStoryboardGen || needsChars}
                        className="mt-2 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-accent-dim text-accent text-sm font-semibold hover:bg-accent hover:text-white transition disabled:opacity-40"
                      >
                        {busyStoryboardGen
                          ? <><Loader2 size={13} className="animate-spin" /> AI 切分中…</>
                          : <><Sparkles size={13} /> 进入第 {selectedEpisodeIndex} 集分镜</>}
                      </button>
                      {needsChars && (
                        <button
                          type="button"
                          onClick={() => setTab('character')}
                          className="block mx-auto text-[11px] text-text-muted hover:text-accent transition"
                        >
                          → 先去提取本集角色
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-text-muted leading-relaxed">
                        请先在「分集」标签生成第 {selectedEpisodeIndex} 集剧本,然后回来切分分镜。
                      </p>
                      <button
                        type="button"
                        onClick={() => setTab('episodes')}
                        className="mt-2 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-accent-dim text-accent text-sm font-semibold hover:bg-accent hover:text-white transition"
                      >
                        切到分集剧本 →
                      </button>
                    </>
                  )}
                </div>
              )
            }
            return (
              <div className="max-w-6xl mx-auto space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="font-display text-lg font-bold inline-flex items-center gap-2">
                    <Camera size={16} /> 分镜 · 第 {selectedEpisodeIndex} 集 · {epGroups.length} 组
                  </h2>
                  <div className="flex items-center gap-2">
                    {busyStoryboardGen && (
                      <span className="inline-flex items-center gap-1 text-xs text-accent">
                        <Loader2 size={12} className="animate-spin" /> AI 切分中…
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={triggerEnterTimeline}
                      className="text-xs px-2.5 py-1 rounded border border-border bg-bg-elevated text-text-secondary hover:border-accent hover:text-accent transition inline-flex items-center gap-1"
                    >
                      <Clock size={11} /> {t.sb_enter_timeline}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (busyStoryboardGen) return;
                        chatPanelRef.current?.triggerWorkflow('storyboard', () => runEnterStoryboard(), { jumpAfter: false, userMsg: `重新切分第 ${selectedEpisodeIndex} 集分镜` });
                      }}
                      className="text-xs px-2.5 py-1 rounded border border-border bg-bg-elevated text-text-secondary hover:border-accent hover:text-accent transition inline-flex items-center gap-1 disabled:opacity-40"
                    >
                      <Sparkles size={11} /> 重新切分
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowNewGroupModal(true)}
                      className="text-xs px-2.5 py-1 rounded border border-accent bg-accent-dim text-accent hover:bg-accent hover:text-white transition inline-flex items-center gap-1"
                    >
                      <Plus size={11} /> 新建空分镜
                    </button>
                  </div>
                </div>
                {epGroups.map((g) => {
                  // 2026/06 修复:之前 `every(s => s.imageUrl)` 只看 state 里
                  // imageUrl 字段,不看图实际能不能加载。Seedream TOS 签名 URL
                  // 24h 过期 / 上游 403 时,state 里有 url 但 <img> 实际 broken,
                  // 按钮仍然显示"✓ 已生成"且 disabled,误导用户认为分镜已就绪。
                  // 这里把 brokenShotImages 也算上 —— 任何一个镜头图加载失败,
                  // 整个组就不算"全部已生成"。
                  const allShotsHaveImage = g.shots.every((s) => {
                    if (!s.imageUrl) return false
                    const key = `${g.id}::${s.id}`
                    return !brokenShotImages.has(key)
                  })
                  const anyBusy = g.shots.some((s) => busyShotImages.has(`${g.id}::${s.id}`))
                  return (
                    <div key={g.id} className="panel p-4 space-y-3">
                      {/* 行 header:序号 / 起始-结束秒 / 场景 / 角色 / 一键生成 */}
                      <div className="flex items-start gap-3 flex-wrap">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-accent-dim text-accent text-xs font-bold shrink-0">#{g.index}</span>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap text-[11px] text-text-muted">
                            <span className="font-mono px-1.5 py-0.5 rounded bg-bg-base border border-border">
                              {g.startSec.toFixed(0)}s → {g.endSec.toFixed(0)}s · {(g.endSec - g.startSec).toFixed(0)}s
                            </span>
                            {g.sceneLocation && (
                              <span className="px-1.5 py-0.5 rounded bg-bg-base border border-border">
                                📍 {g.sceneLocation}
                              </span>
                            )}
                            {g.characterIds.length > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-bg-base border border-border">
                                👥 {g.characterIds
                                  .map((cid) => data.characters.find((c) => c.id === cid)?.name ?? cid)
                                  .join('、')}
                              </span>
                            )}
                            {/* 2026/06:此组"已钉住选为推荐"的角色数(分镜将用这些图作 reference) */}
                            {g.characterIds.length > 0 && (() => {
                              const pinnedInGroup = g.characterIds.filter((cid) => {
                                const ch = data.characters.find((c) => c.id === cid)
                                if (!ch) return false
                                // 检查该角色的默认 look + 每个变体 look 是否有被选中
                                const hasDefault = !!selectedCharImages[ch.id]
                                const hasLooks = (ch.looks ?? []).some((lk) => !!selectedCharImages[`${ch.id}::${lk.id}`])
                                return hasDefault || hasLooks
                              })
                              if (pinnedInGroup.length === 0) return null
                              return (
                                <span className="px-1.5 py-0.5 rounded bg-accent/20 border border-accent/40 text-accent" title="已选为推荐,分镜将用此图作 reference">
                                  📌 {pinnedInGroup.length} 选为推荐
                                </span>
                              )
                            })()}
                          </div>
                          {/* 2026/06:plotText 现在自包含(场景变化+人物动作+台词),
                              UI 上只在 header 保留 group 时间范围 + 角色选择角标;
                              完整 plotText 移到左栏(下方),不再重复。 */}
                        </div>
                        <button
                          type="button"
                          onClick={() => void generateAllShotsForGroup(g.id)}
                          disabled={anyBusy || allShotsHaveImage}
                          className="text-[11px] px-2.5 py-1 rounded border border-accent text-accent bg-accent-dim hover:bg-accent hover:text-white transition disabled:opacity-40 inline-flex items-center gap-1 shrink-0"
                        >
                          {anyBusy ? <><Loader2 size={11} className="animate-spin" /> 生成中…</>
                            : allShotsHaveImage ? '✓ 已生成'
                            : <><Sparkles size={11} /> 一键生成全部</>}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`确定删除第 ${g.index} 组分镜？`)) {
                              handleDeleteGroup(g.id)
                            }
                          }}
                          className="text-[11px] px-2.5 py-1 rounded border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 transition inline-flex items-center gap-1 shrink-0"
                        >
                          <X size={11} /> 删除
                        </button>
                      </div>
                      {/* 四列:左 plot / 中-左 分镜图(2 列多行) / 中-右 故事板占位 / 右 视频占位
                          比例:1.2 / 2 / 1.5 / 1 —— 分镜图占大头(2 列多行天然把行拉高),
                          故事板留足未来空间,视频放最右。

                          2026/06 行高改造(二次压缩):cell max-h 从 420px 再降一半
                          到 220px,每个分镜组的可见高度约 ~半屏的 1/3。
                          内容超出由 cell 自身 overflow-y-auto 滑;故事板图片配套
                          缩到 max-h-28(112px)以匹配新行高。 */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {/* 左:plot 描述(可编辑)+ 角色列表(增/减 + look-switcher)+ 场景选择 */}
                        <div className="rounded-lg border border-border bg-bg-base/40 p-3 space-y-2 max-h-[280px] overflow-y-auto">
                          {/* 剧情 · Plot label + 编辑/完成 切换 */}
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] tracking-widest uppercase text-text-muted">剧情 · Plot</div>
                            {editingGroupId === g.id ? (
                              <button
                                type="button"
                                onClick={() => commitGroupPlot(g.id)}
                                className="inline-flex items-center gap-1 text-[10px] text-accent hover:text-accent/80 transition"
                                title="保存修改"
                              >
                                <Check size={11} /> 完成
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  // 切到其他 group 编辑时,先把上一个 group 的草稿落盘
                                  if (editingGroupId && editingGroupId !== g.id) {
                                    commitGroupPlot(editingGroupId)
                                  }
                                  setEditingGroupId(g.id)
                                  setGroupPlotDraft((prev) => ({ ...prev, [g.id]: g.plotText }))
                                }}
                                className="inline-flex items-center gap-1 text-[10px] text-text-muted hover:text-accent transition"
                                title="编辑剧情"
                              >
                                <Pencil size={11} /> 编辑
                              </button>
                            )}
                          </div>
                          {/* plotText:预读 <pre> / 编辑 <textarea> 切换 */}
                          {editingGroupId === g.id ? (
                            <textarea
                              value={groupPlotDraft[g.id] ?? g.plotText}
                              onChange={(e) => setGroupPlotDraft((prev) => ({ ...prev, [g.id]: e.target.value }))}
                              className="w-full text-[11px] text-text-secondary leading-relaxed font-mono p-2 rounded border border-accent/40 bg-bg-elevated/40 min-h-[80px] resize-y"
                              autoFocus
                            />
                          ) : (
                            // 2026/06 改造:plotText 改为按 shot 拆分的结构化列表,
                            // 每行格式: 分镜N: Xs-Xs · 景别 · 动作 · 镜头。
                            // 用 font-mono 等宽字体让排版对齐。
                            <pre className="text-[11px] text-text-secondary leading-relaxed font-mono whitespace-pre-wrap break-words m-0">
{g.plotText}
                            </pre>
                          )}
                          {/* 资产:角色 / 场景 / 道具 三列统一布局(2026/06) */}
                          <div className="pt-2 mt-1 border-t border-border/60 grid grid-cols-3 gap-2">
                            {/* ===== 角色列 ===== */}
                            <div
                              className="space-y-1.5 relative min-w-0"
                              onClick={(e) => {
                                if ((e.target as HTMLElement).closest('[data-look-menu]')) return
                                if ((e.target as HTMLElement).closest('[data-look-trigger]')) return
                                setOpenLookMenu(null)
                              }}
                            >
                              <div className="text-[9px] tracking-widest uppercase text-text-muted flex items-center justify-between">
                                <span>角色</span>
                                <span className="text-[8px]">{g.characterIds.length}</span>
                              </div>
                              {g.characterIds.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {g.characterIds.map((cid) => {
                                    const ch = data.characters.find((c) => c.id === cid)
                                    if (!ch) return null
                                    const selectedCh = getGroupSelectedChar(g.id, cid) ?? ch
                                    const baseName = ch.name.split('·')[0].trim()
                                    const variants = data.characters.filter((c) => c.name.split('·')[0].trim() === baseName)
                                    const variantIdx = Math.max(0, variants.findIndex((v) => v.id === selectedCh.id))
                                    const img = charImages[selectedCh.id]?.[charImages[selectedCh.id].length - 1]
                                    const hasVariants = variants.length > 1
                                    const menuKey = `${g.id}::${cid}`
                                    const menuOpen = openLookMenu === menuKey
                                    return (
                                      <div key={cid} className="relative">
                                        <div className="flex items-center gap-0.5">
                                          <button
                                            type="button"
                                            data-look-trigger
                                            onClick={() => {
                                              if (!hasVariants) return
                                              setOpenLookMenu(menuOpen ? null : menuKey)
                                            }}
                                            disabled={!hasVariants}
                                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded border transition ${
                                              hasVariants
                                                ? 'bg-bg-elevated border-border hover:border-accent cursor-pointer'
                                                : 'bg-bg-elevated/50 border-border/40 cursor-default'
                                            }`}
                                            title={hasVariants ? `切换形象 (${variantIdx + 1}/${variants.length})` : baseName}
                                          >
                                            <div className="w-4 h-4 rounded-full overflow-hidden bg-bg-base shrink-0">
                                              {img
                                                ? <img src={img} alt={selectedCh.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                                : <div className="w-full h-full flex items-center justify-center text-[7px] text-text-muted">N/A</div>}
                                            </div>
                                            <span className="text-[10px] text-text-primary truncate max-w-[50px]">{baseName}</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); setGroupCharacterIds(g.id, cid, 'remove') }}
                                            className="shrink-0 p-0.5 rounded text-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition"
                                            title={`移除 ${baseName}`}
                                          >
                                            <X size={8} />
                                          </button>
                                        </div>
                                        {menuOpen && hasVariants && (
                                          <div data-look-menu className="absolute z-30 left-0 top-full mt-1 min-w-[150px] rounded-lg border border-border bg-bg-surface shadow-xl py-1">
                                            {variants.map((v) => {
                                              const vImg = charImages[v.id]?.[charImages[v.id].length - 1]
                                              const isSelected = v.id === selectedCh.id
                                              return (
                                                <button
                                                  key={v.id}
                                                  type="button"
                                                  onClick={() => { setCharacterLookInGroup(g.id, cid, v.id); setOpenLookMenu(null) }}
                                                  className={`w-full flex items-center gap-2 px-2 py-1 text-left text-[10px] transition ${
                                                    isSelected ? 'bg-accent/15 text-accent' : 'hover:bg-bg-elevated text-text-primary'
                                                  }`}
                                                >
                                                  <div className="w-5 h-5 rounded-full overflow-hidden bg-bg-base shrink-0">
                                                    {vImg ? <img src={vImg} alt={v.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} /> : <div className="w-full h-full flex items-center justify-center text-[8px] text-text-muted">N/A</div>}
                                                  </div>
                                                  <span className="flex-1 truncate">{v.name}</span>
                                                  {isSelected && <Check size={10} className="text-accent shrink-0" />}
                                                </button>
                                              )
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              ) : (
                                <div className="text-[9px] text-text-muted italic">空</div>
                              )}
                              <GroupMembershipEditor
                                group={g}
                                characters={data.characters}
                                onAdd={(cid) => setGroupCharacterIds(g.id, cid, 'add')}
                              />
                            </div>

                            {/* ===== 场景列 ===== */}
                            <div className="space-y-1.5 min-w-0">
                              <div className="text-[9px] tracking-widest uppercase text-text-muted flex items-center justify-between">
                                <span>场景</span>
                                <span className="text-[8px]">{(g.sceneIds ?? []).length}</span>
                              </div>
                              {(g.sceneIds ?? []).length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {(g.sceneIds ?? []).map((sid) => {
                                    const s = data.scenes.find((x) => x.id === sid)
                                    if (!s) return null
                                    const label = s.location || s.slug || s.id
                                    const img = sceneImages[sid]?.at(-1)
                                    return (
                                      <div key={sid} className="flex items-center gap-0.5">
                                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-bg-elevated/50 max-w-[90px]">
                                          <div className="w-4 h-4 rounded overflow-hidden bg-bg-base shrink-0">
                                            {img
                                              ? <img src={img} alt={label} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                              : <div className="w-full h-full flex items-center justify-center text-[6px] text-text-muted">S</div>}
                                          </div>
                                          <span className="text-[9px] text-text-primary truncate">{label.slice(0, 8)}</span>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => setGroupSceneIds(g.id, sid, 'remove')}
                                          className="shrink-0 p-0.5 rounded text-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition"
                                          title={`移除 ${label}`}
                                        >
                                          <X size={8} />
                                        </button>
                                      </div>
                                    )
                                  })}
                                </div>
                              ) : (
                                <div className="text-[9px] text-text-muted italic">空</div>
                              )}
                              <GroupSceneEditor
                                group={g}
                                scenes={data.scenes}
                                onAdd={(sid) => setGroupSceneIds(g.id, sid, 'add')}
                                onRemove={(sid) => setGroupSceneIds(g.id, sid, 'remove')}
                              />
                            </div>

                            {/* ===== 道具列 ===== */}
                            <div className="space-y-1.5 min-w-0">
                              <div className="text-[9px] tracking-widest uppercase text-text-muted flex items-center justify-between">
                                <span>道具</span>
                                <span className="text-[8px]">{(g.propIds ?? []).length}</span>
                              </div>
                              {(g.propIds ?? []).length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {(g.propIds ?? []).map((pid) => {
                                    const p = data.props.find((x) => x.id === pid)
                                    if (!p) return null
                                    const img = propImages[pid]?.at(-1)
                                    return (
                                      <div key={pid} className="flex items-center gap-0.5">
                                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-bg-elevated/50 max-w-[90px]">
                                          <div className="w-4 h-4 rounded overflow-hidden bg-bg-base shrink-0">
                                            {img
                                              ? <img src={img} alt={p.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                              : <div className="w-full h-full flex items-center justify-center text-[6px] text-text-muted">P</div>}
                                          </div>
                                          <span className="text-[9px] text-text-primary truncate">{p.name.slice(0, 8)}</span>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => setGroupPropIds(g.id, pid, 'remove')}
                                          className="shrink-0 p-0.5 rounded text-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition"
                                          title={`移除 ${p.name}`}
                                        >
                                          <X size={8} />
                                        </button>
                                      </div>
                                    )
                                  })}
                                </div>
                              ) : (
                                <div className="text-[9px] text-text-muted italic">空</div>
                              )}
                              <GroupPropEditor
                                group={g}
                                props={data.props}
                                onAdd={(pid) => setGroupPropIds(g.id, pid, 'add')}
                              />
                            </div>
                          </div>
                        </div>
                        {/* 分镜图 */}
                        <div className="rounded-lg border border-border bg-bg-base/40 p-3 space-y-3 max-h-[280px] overflow-y-auto">
                          {/* 顶部:shots 标题 + 全部生成 */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <div className="text-[10px] tracking-widest uppercase text-text-muted">分镜图 · Shots ({g.shots.length})</div>
                              <div className="text-[10px] text-text-muted">多图融合</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void generateAllShotsForGroup(g.id)}
                              disabled={anyBusy || allShotsHaveImage}
                              className="text-[11px] px-2.5 py-1 rounded border border-accent text-accent bg-accent-dim hover:bg-accent hover:text-white transition disabled:opacity-40 inline-flex items-center gap-1 shrink-0"
                            >
                              {anyBusy ? <><Loader2 size={11} className="animate-spin" /> 生成中…</>
                                : allShotsHaveImage ? '✓ 已生成'
                                : <><Sparkles size={11} /> 一键生成全部</>}
                            </button>
                          </div>
                          {/* shots 网格:2 列,卡片更紧凑(描述折叠到 <details>)。
                              2026/06 行高改造:**去掉**之前的 max-h-72 + 内层
                              overflow-y-auto。原本 shots 单独滑、故事板单独显,导致
                              cell 内部出现两条滑块且行高仍被撑到 600+px。现在交给
                              外层 cell 统一 overflow,行高更可控、滑动也只有一条。 */}
                          <div className="grid grid-cols-1 gap-2">
                            {g.shots.map((s) => {
                              const isBusy = busyShotImages.has(`${g.id}::${s.id}`)
                              const shotImageKey = `${g.id}::${s.id}`
                              const generations = shotImages[shotImageKey]
                              const currentUrl = generations && generations.length > 0
                                ? generations[generations.length - 1]
                                : s.imageUrl
                              return (
                                <div key={s.id} className="rounded border border-border bg-bg-elevated overflow-hidden flex flex-col">
                                  <div className="relative aspect-[2/1] bg-bg-base group">
                                    {currentUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={currentUrl}
                                        alt={s.action}
                                        // 2026/06:追踪图片实际加载状态。Seedream TOS 签名 URL
                                        // 24h 过期 / 上游 403 时,<img> 会 broken,但 imageUrl
                                        // state 还在 → allShotsHaveImage / 按钮文案误判为"已生成"。
                                        // onError 把 key 加进 brokenShotImages,让上层逻辑
                                        // (按钮 disabled + 文案) 把这个镜头当作未生成。
                                        onLoad={() => clearShotImageBroken(shotImageKey)}
                                        onError={() => markShotImageBroken(shotImageKey)}
                                        className="absolute inset-0 w-full h-full object-cover"
                                      />
                                    ) : isBusy ? (
                                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-text-muted">
                                        <Loader2 size={20} className="animate-spin text-accent" />
                                        <span className="text-[10px]">融合中…</span>
                                      </div>
                                    ) : (
                                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-text-muted">
                                        <ImageIcon size={20} className="opacity-50" />
                                        <span className="text-[10px]">点击下方生成</span>
                                      </div>
                                    )}
                                    <span className="absolute top-1.5 left-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/60 text-white">
                                      {s.shotTypeLabel}
                                    </span>
                                    {s.startSec != null && s.endSec != null && (
                                      <span className="absolute top-1.5 right-1.5 text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/60 text-white tabular-nums">
                                        {s.startSec.toFixed(0)}-{s.endSec.toFixed(0)}s
                                      </span>
                                    )}
                                    {/* 放大按钮 */}
                                    {currentUrl && (
                                      <button
                                        type="button"
                                        aria-label="放大查看分镜图"
                                        onClick={() => {
                                          setShotSelectedGenIdx(generations ? generations.length - 1 : 0)
                                          setShotModInput('')
                                          setShotPreview({ groupId: g.id, shotId: s.id })
                                        }}
                                        className="absolute bottom-1.5 right-1.5 p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition hover:bg-black/80"
                                      >
                                        <Maximize2 size={12} />
                                      </button>
                                    )}
                                  </div>
                                  {/* 底部:分镜 N · 时间 · 景别 始终显示(2026/06 用户诉求);
                                      action + camera 也始终显示,不再藏在 details 折叠 */}
                                  <div className="p-1.5 space-y-1">
                                    <div className="flex items-center justify-between gap-1 text-[10px] font-mono tabular-nums">
                                      <span className="text-accent font-semibold">
                                        分镜 {g.shots.findIndex((x) => x.id === s.id) + 1}
                                      </span>
                                      {s.startSec != null && s.endSec != null && (
                                        <span className="text-text-secondary">
                                          {s.startSec.toFixed(0)}-{s.endSec.toFixed(0)}s
                                        </span>
                                      )}
                                      <span className="text-text-muted">{s.shotTypeLabel}</span>
                                    </div>
                                    <p className="text-[10px] leading-relaxed text-text-primary">{s.action || '(无描述)'}</p>
                                    {s.camera && (
                                      <p className="text-[10px] leading-relaxed text-text-muted">🎥 {s.camera}</p>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => void generateShotImageForGroup(g.id, s.id)}
                                      disabled={isBusy}
                                      className="w-full text-[10px] py-0.5 rounded border border-border bg-bg-surface text-text-secondary hover:border-accent hover:text-accent transition disabled:opacity-40 inline-flex items-center justify-center gap-1"
                                    >
                                      {isBusy
                                        ? <><Loader2 size={9} className="animate-spin" /> 生成中</>
                                        : s.imageUrl
                                          ? <><RefreshCw size={9} /> 重新生成</>
                                          : <><Sparkles size={9} /> 生成本镜头</>}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleUploadImage('shot', s.id, shotImageKey)}
                                      className="w-full text-[10px] py-0.5 rounded border border-border bg-bg-surface text-text-secondary hover:border-accent hover:text-accent transition inline-flex items-center justify-center gap-1 mt-1"
                                    >
                                      <Upload size={9} /> 上传图片
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                        {/* 中右:故事板 */}
                        <div className="rounded-lg border border-border bg-bg-base/40 p-3 space-y-2 max-h-[280px] overflow-y-auto">
                            <div className="flex items-center justify-between">
                              <div className="text-[10px] tracking-widest uppercase text-text-muted">故事板 · Storyboard</div>
                              {groupStoryboards[g.id]?.status === 'succeeded' ? (
                                brokenStoryboards.has(g.id) ? (
                                  <span
                                    className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 border border-amber-500/30"
                                    title="故事板图 URL 已过期 / 加载失败,点击重新生成或保存入库"
                                  >
                                    已过期 · 需重生成
                                  </span>
                                ) : (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30">已生成</span>
                                )
                              ) : groupStoryboards[g.id]?.status === 'running' ? (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-bg-elevated border border-border text-text-muted">生成中…</span>
                              ) : groupStoryboards[g.id]?.status === 'failed' ? (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-500 border border-rose-500/30">失败</span>
                              ) : (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-bg-elevated border border-border text-text-muted">未生成</span>
                              )}
                            </div>
                            {groupStoryboards[g.id]?.status === 'succeeded' && groupStoryboards[g.id]?.url ? (
                              <div className="relative group rounded border border-accent/30 overflow-hidden bg-bg-base max-h-28 flex items-center justify-center">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={groupStoryboards[g.id]!.url}
                                  alt="故事板"
                                  onLoad={() => clearStoryboardBroken(g.id)}
                                  onError={() => markStoryboardBroken(g.id)}
                                  onClick={() => setStoryboardPreview({ groupId: g.id })}
                                  className="max-h-28 w-auto block cursor-zoom-in object-contain"
                                />
                                <button
                                  type="button"
                                  onClick={() => void generateMangaStoryboardForGroup(g.id)}
                                  className="absolute top-1.5 right-1.5 p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition hover:bg-black/80"
                                  title="重新生成故事板"
                                >
                                  <RefreshCw size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUploadImage('storyboard', g.id, g.id)}
                                  className="absolute bottom-1.5 right-1.5 p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition hover:bg-black/80"
                                  title="上传图片"
                                >
                                  <Upload size={12} />
                                </button>
                              </div>
                            ) : groupStoryboards[g.id]?.status === 'running' ? (
                              <div className="max-h-28 h-20 rounded border border-border bg-bg-base flex flex-col items-center justify-center gap-1.5 text-text-muted">
                                <Loader2 size={20} className="animate-spin text-accent" />
                                <span className="text-[10px]">融合中…</span>
                              </div>
                            ) : (
                              <div className="max-h-28 h-20 rounded border border-dashed border-border bg-bg-base flex flex-col items-center justify-center gap-1.5 text-text-muted">
                                <LayoutGrid size={20} className="opacity-40" />
                                <span className="text-[10px]">故事板占位</span>
                                <span className="text-[9px] opacity-70">含剧情/角色/场景/分镜</span>
                              </div>
                            )}
                            {(!groupStoryboards[g.id] || groupStoryboards[g.id]?.status === 'failed') && (
                              <button
                                type="button"
                                onClick={() => void generateMangaStoryboardForGroup(g.id)}
                                className="w-full text-[10px] py-1 rounded border border-border bg-bg-surface text-text-secondary hover:border-accent hover:text-accent transition inline-flex items-center justify-center gap-1"
                              >
                                <Sparkles size={9} /> {groupStoryboards[g.id]?.status === 'failed' ? '重试生成' : '生成故事板'}
                              </button>
                            )}
                            <p className="text-[10px] text-text-muted leading-relaxed">
                              一张图 = 标题 + 故事概述 + 角色参考(3视图+特写+动作) +
                              场景全景(带细节) + 镜头调度 + 8 格分镜 + 技术设定。复古烫金边框,深色调背景。
                            </p>
                          </div>
                        </div>
                      {/* 视频换行占一整行 */}
                      <div className="md:col-span-3 rounded-lg border border-border bg-bg-base/40 p-3 space-y-2 max-h-[280px] overflow-y-auto">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] tracking-widest uppercase text-text-muted">视频 · Video</div>
                            {groupVideos[g.id]?.status === 'succeeded' ? (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30">已生成</span>
                            ) : groupVideos[g.id]?.status === 'running' ? (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-bg-elevated border border-border text-text-muted">生成中…</span>
                            ) : groupVideos[g.id]?.status === 'failed' ? (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-500 border border-rose-500/30">失败</span>
                            ) : (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-bg-elevated border border-border text-text-muted">未生成</span>
                            )}
                          </div>
                          {/* 视频区:成功 → 显示播放器;运行中 → spinner;未生成 → 虚线占位 */}
                          {groupVideos[g.id]?.status === 'succeeded' && groupVideos[g.id]?.url ? (
                            <div className="relative group rounded border border-accent/30 overflow-hidden bg-black">
                              <video
                                src={groupVideos[g.id]!.url}
                                controls
                                loop
                                playsInline
                                className="w-full h-auto block"
                              />
                              <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition flex gap-1">
                                <a
                                  href={groupVideos[g.id]!.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] hover:bg-black/90"
                                  title="在新标签页打开原视频"
                                >
                                  ↗
                                </a>
                                <button
                                  type="button"
                                  onClick={() => void generateVideoForGroup(g.id)}
                                  className="px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] hover:bg-black/90"
                                  title="重新生成视频"
                                >
                                  <RefreshCw size={9} className="inline -mt-0.5" />
                                </button>
                              </div>
                            </div>
                          ) : groupVideos[g.id]?.status === 'running' ? (
                            <div className="aspect-video rounded border border-border bg-bg-base flex flex-col items-center justify-center gap-1.5 text-text-muted">
                              <Loader2 size={20} className="animate-spin text-accent" />
                              <span className="text-[10px]">视频生成中…</span>
                              <span className="text-[9px] opacity-70">约 1-3 分钟</span>
                            </div>
                          ) : (
                            <div className="aspect-video rounded border border-dashed border-border bg-bg-base flex flex-col items-center justify-center gap-1.5 text-text-muted">
                              <Camera size={20} className="opacity-40" />
                              <span className="text-[10px]">视频占位</span>
                              <span className="text-[9px] opacity-70">整组合成 · {g.shots.length} 个镜头 · 约 {(g.endSec - g.startSec).toFixed(0)}s</span>
                            </div>
                          )}
                          {/* 触发按钮:只有当组里至少有一张分镜图时才点亮 */}
                          {(() => {
                            const hasAnyShotImage = g.shots.some((s) => {
                              const key = `${g.id}::${s.id}`
                              const gens = shotImages[key] ?? []
                              const hasUrl = !!(gens.length ? gens[gens.length - 1] : s.imageUrl)
                              // 同 allShotsHaveImage:url 存在但图加载失败 = 视为无图
                              return hasUrl && !brokenShotImages.has(key)
                            })
                            if (!hasAnyShotImage) {
                              return (
                                <p className="text-[10px] text-text-muted leading-relaxed">
                                  需先生成该组至少一张分镜图,才能按分镜图生成视频。
                                </p>
                              )
                            }
                            return (
                              <button
                                type="button"
                                onClick={() => void generateVideoForGroup(g.id)}
                                disabled={groupVideos[g.id]?.status === 'running'}
                                className="w-full text-[10px] py-1 rounded border border-border bg-bg-surface text-text-secondary hover:border-accent hover:text-accent transition disabled:opacity-40 inline-flex items-center justify-center gap-1"
                              >
                                {groupVideos[g.id]?.status === 'running'
                                  ? <><Loader2 size={9} className="animate-spin" /> 视频生成中…</>
                                  : groupVideos[g.id]?.status === 'succeeded'
                                    ? <><RefreshCw size={9} /> 按分镜图重新生成视频</>
                                    : <><Camera size={9} /> 按分镜图生成视频</>}
                              </button>
                            )
                          })()}
                          {/* 2026/06 新增:按故事板图生成视频(并列第二个按钮)。
                              用 storyboard image 作 first_frame,plot text 作叙事参考。
                              前置条件:故事板已生成。 */}
                          {(() => {
                            const sb = groupStoryboards[g.id]
                            const hasStoryboard = sb?.status === 'succeeded' && !!sb.url
                            if (!hasStoryboard) {
                              return (
                                <p className="text-[10px] text-text-muted leading-relaxed">
                                  需先生成该组的故事板,才能用故事板生成视频。
                                </p>
                              )
                            }
                            return (
                              <button
                                type="button"
                                onClick={() => void generateVideoFromStoryboardForGroup(g.id)}
                                disabled={groupVideos[g.id]?.status === 'running'}
                                className="w-full text-[10px] py-1 rounded border border-accent/60 bg-accent-dim/20 text-accent hover:border-accent hover:bg-accent-dim/40 transition disabled:opacity-40 inline-flex items-center justify-center gap-1"
                                title="基于故事板图(作为视觉锚)+ 剧情文字(作叙事参考)生成视频"
                              >
                                {groupVideos[g.id]?.status === 'running'
                                  ? <><Loader2 size={9} className="animate-spin" /> 视频生成中…</>
                                  : <><LayoutGrid size={9} /> 按故事板生成视频</>}
                              </button>
                            )
                          })()}
                          <input
                            type="file"
                            accept="video/mp4,video/webm,video/quicktime"
                            id={"video-upload-" + g.id}
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0]
                              if (!file) return
                              try {
                                const base64 = await new Promise<string>((resolve, reject) => {
                                  const reader = new FileReader()
                                  reader.onload = () => resolve(reader.result as string)
                                  reader.onerror = reject
                                  reader.readAsDataURL(file)
                                })
                                const res = await callUploadImage({ data: { base64, id: g.id, kind: 'video' } })
                                if (res.ok && res.url) {
                                  setGroupVideos((m) => ({ ...m, [g.id]: { url: res.url!, status: 'succeeded' } }))
                                  toast.success('视频已上传')
                                  void handleSaveWorkspace()
                                } else {
                                  toast.error(res?.error || '上传失败')
                                }
                              } catch {
                                toast.error('视频上传失败')
                              }
                            }}
                          />
                          <label
                            htmlFor={"video-upload-" + g.id}
                            className="w-full text-[10px] py-1 rounded border border-border bg-bg-surface text-text-secondary hover:border-accent hover:text-accent transition cursor-pointer inline-flex items-center justify-center gap-1"
                          >
                            <Upload size={9} /> 上传视频
                          </label>
                        </div>
                      </div>
                  )
                })}
              </div>
            )
          })()}
          {tab === 'timeline' && (
            <StoryboardTimeline
              groups={data.storyboardGroups}
              groupVideos={groupVideos}
              clipOrder={clipOrder}
              onClipReorder={setClipOrder}
              i18n={{
                title: t.ws_tab_timeline,
                hint: t.tl_drag_hint,
                play: t.tl_play,
                pause: t.tl_pause,
                resetOrder: t.tl_reset_order,
                noVideo: t.tl_no_video,
                generating: t.tl_generating,
                failed: t.tl_failed,
                empty: t.ws_timeline_empty,
                reorderChanged: t.tl_reorder_changed,
              }}
            />
          )}
        </main>
        <ZopiaChatPanel
          ref={chatPanelRef}
          workspaceId={workspaceId}
          stage={tab}
          onJumpStage={setTab}
          onProduce={produce}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((v) => !v)}
          initialInput={initialChatInput}
          locked={episodeStreaming && autoRunTargetRef.current != null}
          selectedEpisodeIndex={selectedEpisodeIndex}
          onImportScript={handleImportScript}
          streaming={synopsisStreaming || episodeStreaming}
          onEnterStoryboard={() => void runEnterStoryboard()}
          enterTimelineSignal={enterTimelineSignal}
          onEnterTimeline={() => setTab('timeline')}
          onModifyReference={(refType, refId, instruction, lookId) => {
            if (refType === 'character') {
              const c = data.characters.find((x) => x.id === refId)
              if (c) void submitModPanelRef(c, lookId ?? null, instruction)
            } else if (refType === 'scene') {
              const s = data.scenes.find((x) => x.id === refId)
              if (s) void submitSceneModPanelRef(s, instruction)
            } else {
              const p = data.props.find((x) => x.id === refId)
              if (p) void doPropRegen(p, 'modify', instruction)
            }
          }}
        />
      </div>
      {previewTarget && (() => {
        const c = previewTarget.character
        const lk = previewTarget.lookId == null
          ? null
          : c.looks?.find((x) => x.id === previewTarget.lookId) ?? null
        const imageKey = lk ? `${c.id}::${lk.id}` : c.id
        const generations = charImages[imageKey] ?? []
        const currentIdx = Math.min(selectedGenIdx, Math.max(0, generations.length - 1))
        const currentUrl = generations[currentIdx]
        const faceDesc = lk?.faceDescription || c.faceDescription
        const bodyDesc = lk?.bodyDescription || c.bodyDescription
        const clothDesc = lk?.clothingDescription || c.clothingDescription
        const lookLabelForCall = lk?.label || '默认'
        const cardTitle = lk ? `${c.name} · ${lk.label}` : c.name
        return (
          <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => { closeModPanel(); setRegenInput('') }}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="relative bg-bg-surface border border-border rounded-2xl overflow-hidden shadow-2xl w-full max-w-[1280px] h-[88vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Top bar */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
                <div className="min-w-0">
                  <div className="font-display text-base font-bold text-text-primary truncate">{cardTitle}</div>
                  <div className="text-xs text-text-muted">{c.roleLabel} · {c.age} 岁 · 共 {generations.length} 张</div>
                </div>
                <button
                  type="button"
                  onClick={() => { closeModPanel(); setRegenInput('') }}
                  className="p-1.5 rounded-md hover:bg-bg-elevated text-text-muted"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>

              {/* 3 列布局:左 thumbnails / 中 大图 / 右 描述+输入 */}
              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[120px_1fr_360px] gap-3 p-3">
                {/* === Left: thumbnails of the SAME look, all generations === */}
                <aside className="overflow-y-auto pr-1 space-y-2 min-h-0">
                  <div className="text-[10px] text-text-muted px-1 pb-1 sticky top-0 bg-bg-surface">
                    历史生成（{generations.length}）
                  </div>
                  {generations.length === 0 ? (
                    <div className="aspect-[3/4] rounded border border-dashed border-border flex items-center justify-center text-[10px] text-text-muted text-center px-1">
                      暂无图片
                    </div>
                  ) : (
                    generations.map((u, i) => (
                      // 2026/06:从 <button> 改成 <div role="button"> —— 因为里面
                      // 套了"设为推荐"星标按钮(button-in-button 会 hydration 警告)。
                      // 加 onKeyDown 让 Enter / Space 也能切图(键盘可达)。
                      <div
                        key={`${u}-${i}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedGenIdx(i)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setSelectedGenIdx(i)
                          }
                        }}
                        className={`block w-full rounded border-2 overflow-hidden transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                          i === currentIdx ? 'border-accent' : 'border-border hover:border-accent/60'
                        }`}
                        title={`第 ${i + 1} 张`}
                      >
                        <div className="relative w-full aspect-[3/4] bg-bg-base">
                          <img
                            src={u}
                            alt={`${cardTitle} #${i + 1}`}
                            loading="lazy"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                          {i === generations.length - 1 && (
                            <span className="absolute top-1 left-1 px-1 py-0.5 rounded bg-accent text-accent-foreground text-[9px] font-semibold">
                              NEW
                            </span>
                          )}
                          <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/60 text-white text-[9px] tabular-nums">
                            #{i + 1}
                          </span>
                          {/* 2026/06:每张历史缩略图可独立"设为推荐"。点星标把
                              这张 url 钉到 selectedCharImages[imageKey],作为分镜
                              流程的 reference。互斥:同 imageKey 只能选 1 张,
                              这里选了一张会自动覆盖前一次。 */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedCharImages((m) => {
                                if (m[imageKey] === u) {
                                  const { [imageKey]: _, ...rest } = m
                                  return rest
                                }
                                return { ...m, [imageKey]: u }
                              })
                            }}
                            className={`absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full transition ${
                              selectedCharImages[imageKey] === u
                                ? 'bg-accent text-accent-foreground shadow-md'
                                : 'bg-black/60 text-white hover:bg-black/90'
                            }`}
                            title={selectedCharImages[imageKey] === u ? '已是推荐 — 再点取消' : '把这张设为推荐(分镜 reference)'}
                          >
                            <Target size={10} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </aside>

                {/* === Center: large selected image, fills the box === */}
                <div className="relative bg-bg-base rounded-lg overflow-hidden flex items-center justify-center min-h-0">
                  {currentUrl ? (
                    <img
                      src={currentUrl}
                      alt={cardTitle}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-text-muted">
                      <ImageIcon size={40} className="opacity-50" />
                      <p className="text-sm">还没有生成形象，请到右侧输入修改意见</p>
                    </div>
                  )}
                  {regenBusy && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-2 text-white">
                        <Loader2 size={32} className="animate-spin" />
                        <span className="text-sm">正在按你的意见重生…</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* === Right top: description / Right bottom: input dialog === */}
                <div className="flex flex-col min-h-0 gap-3">
                  {/* Right TOP: 描述 */}
                  <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border bg-bg-elevated/40 p-3 space-y-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-text-muted">当前选中</div>
                      <div className="text-sm font-semibold text-text-primary mt-0.5">
                        {currentUrl ? `第 ${currentIdx + 1} / ${generations.length} 张` : '未生成'}
                      </div>
                    </div>
                    <dl className="space-y-1.5 text-xs">
                      <div><dt className="text-text-muted">性别</dt><dd className="text-text-secondary">{c.gender || '-'}</dd></div>
                      <div><dt className="text-text-muted">年龄</dt><dd className="text-text-secondary">{c.age} 岁</dd></div>
                      <div><dt className="text-text-muted">面部</dt><dd className="text-text-secondary">{faceDesc || '-'}</dd></div>
                      <div><dt className="text-text-muted">身材</dt><dd className="text-text-secondary">{bodyDesc || '-'}</dd></div>
                      <div>
                        <dt className="text-text-muted">服装{lk ? `（${lk.label}）` : ''}</dt>
                        <dd className="text-text-secondary">{clothDesc || '-'}</dd>
                      </div>
                    </dl>
                    {/* 如果角色有多个 look,展示 look 切换 */}
                    {(c.looks?.length ?? 0) > 0 && (
                      <div className="pt-1 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => openModPanel(c, null)}
                          className={`text-[10px] px-2 py-1 rounded-full border ${
                            previewTarget.lookId == null
                              ? 'border-accent bg-accent-dim/40 text-text-primary'
                              : 'border-border bg-bg-elevated/60 text-text-secondary hover:border-accent'
                          }`}
                        >
                          默认
                        </button>
                        {c.looks!.map((x) => (
                          <button
                            key={x.id}
                            type="button"
                            onClick={() => openModPanel(c, x.id)}
                            className={`text-[10px] px-2 py-1 rounded-full border ${
                              previewTarget.lookId === x.id
                                ? 'border-accent bg-accent-dim/40 text-text-primary'
                                : 'border-border bg-bg-elevated/60 text-text-secondary hover:border-accent'
                            }`}
                          >
                            {x.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-1 pt-1">
                      {c.palette.map((p) => (
                        <span key={p} className="w-5 h-5 rounded border border-border" style={{ background: p }} title={p} />
                      ))}
                    </div>
                    {/* 选中按钮(2026/06) — 跟卡片本体右上角的"选中"对称。
                        在预览模态里也能直接钉住当前选中的图,不用回卡片本体点。
                        镜像逻辑完全一致:imageKey → setSelectedCharImages。
                        2026/06 Bugfix:`cur` 必须跟随左栏缩略图选中的 currentUrl
                        (即 generations[currentIdx]),不能写 .at(-1) 否则永远钉最新。 */}
                    {(() => {
                      const imageKey = previewTarget.lookId == null
                        ? c.id
                        : `${c.id}::${previewTarget.lookId}`
                      const cur = currentUrl  // 跟随左栏选中的图,不是最新
                      if (!cur) return null
                      const isPinned = selectedCharImages[imageKey] === cur
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCharImages((m) => {
                              if (m[imageKey] === cur) {
                                const { [imageKey]: _, ...rest } = m
                                return rest
                              }
                              return { ...m, [imageKey]: cur }
                            })
                          }}
                          className={`mt-1 w-full text-[10px] py-1 rounded border inline-flex items-center justify-center gap-1 transition ${
                            isPinned
                              ? 'bg-accent border-accent text-accent-foreground'
                              : 'border-border bg-bg-surface text-text-secondary hover:border-accent hover:text-accent'
                          }`}
                        >
                          {isPinned ? (
                            <><Check size={10} /> 已选中此图作为 reference</>
                          ) : (
                            <><Target size={10} /> 选中此图作为 reference</>
                          )}
                        </button>
                      )
                    })()}
                  </div>

                  {/* Right BOTTOM: 修改意见输入区(2026/06 改造)
                      - 直接嵌入预览,不再弹独立 slide-in
                      - Enter 提交,Shift+Enter 换行
                      - 错误 / busy 状态内联展示 */}
                  <div className="shrink-0 rounded-lg border border-border bg-bg-elevated/40 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-text-secondary font-semibold">修改形象</div>
                      <span className="text-[10px] text-text-muted">Enter 发送 · Shift+Enter 换行</span>
                    </div>
                    <p className="text-[10px] text-text-muted leading-relaxed">
                      直接输入修改意见。AI 会保留这张形象的:脸、身材、视觉风格、正视角度、纯白 #FFFFFF 背景、无表情。只改你描述的部分。
                    </p>
                    <textarea
                      value={modInput}
                      onChange={(e) => setModInput(e.target.value)}
                      onKeyDown={(e) => {
                        // Enter 提交;Shift+Enter 换行(更符合"直接在对话框输入"的直觉)
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void submitModPanel()
                        }
                      }}
                      placeholder="例如:把头发改成黑色短发 / 加一副黑框眼镜 / 把外套换成红色风衣…"
                      rows={4}
                      disabled={modBusy}
                      className="w-full rounded-md bg-bg-base border border-border text-sm text-text-primary p-2 focus:border-accent focus:outline-none resize-none placeholder:text-text-muted disabled:opacity-50"
                    />
                    {modError && (
                      <div className="px-2.5 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-400">
                        {modError}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-text-muted">
                        {modBusy ? '生成中…' : `参考图:第 ${currentIdx + 1} / ${generations.length} 张`}
                      </span>
                      <button
                        type="button"
                        onClick={() => void submitModPanel()}
                        disabled={modBusy || !modInput.trim() || !currentUrl}
                        className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 inline-flex items-center gap-1.5"
                      >
                        {modBusy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                        {modBusy ? '生成中…' : '发送'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}


      {/* ============= 场景"修改"输入弹层(2026/06 跟角色 modPanel 对齐) =============
          角色修改走"打开预览模态框 + 内嵌 textarea"(2026/06 改造)。
          场景没有 selectedGenIdx / 多图 history 概念,只需要"打开输入弹层
          直接打字"—— 比角色更轻量。功能上跟角色对齐:点修改 → 弹输入 →
          Enter 提交 → 重生 → 关闭。 */}

      {/* ============= 场景卡片点击放大 lightbox(2026/06;二次扩展加历史) =============
          跟角色的"三栏 preview modal"不一样,这里按用户要求做轻量版:
          大图占左,描述(action / beats / dialogue)列在右。
          **2026/06 二次扩展**:左下加"历史缩略图条"(NEW + 已选角标 +
          "设为推荐"按钮),跟角色 preview 对齐 —— 用户能看到所有历史
          生成 + 选中其中一张作为后续 reference(分镜/故事板/按意见重生)。
          关闭走背景点击或 X 按钮。编辑输入由卡片底部「编辑」按钮 →
          openSceneModPanel 触发,不重复进 lightbox。 */}
      {scenePreview && (() => {
        const s = scenePreview
        const history = sceneImages[s.id] ?? []
        // 2026/06:选中优先,没选 fallback 最新一张
        const pinnedUrl = selectedSceneImages[s.id]
        const currentUrl = (pinnedUrl && history.includes(pinnedUrl))
          ? pinnedUrl
          : history.at(-1)
        const currentIdx = currentUrl ? Math.max(0, history.indexOf(currentUrl)) : -1
        return (
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
            onClick={() => setScenePreview(null)}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="relative bg-bg-surface border border-border rounded-2xl overflow-hidden shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Top bar */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                <div className="min-w-0">
                  <div className="text-[10px] font-mono text-text-muted">SC {s.index} · {SCENE_TIME_LABELS[s.timeOfDay] ?? s.timeOfDay}</div>
                  <div className="font-display text-base font-bold text-text-primary truncate">{s.slug}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setScenePreview(null)}
                  className="p-1.5 rounded-md hover:bg-bg-elevated text-text-muted"
                  aria-label="关闭"
                >
                  <X size={18} />
                </button>
              </div>
              {/* Body: 大图 + 描述,深色背景让大图更显质感 */}
              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[2fr_1fr]">
                <div className="relative bg-black flex items-center justify-center min-h-[300px] max-h-[calc(90vh-180px)]">
                  {currentUrl ? (
                    <img
                      src={currentUrl}
                      alt={s.slug}
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-text-muted p-8">
                      <ImageIcon size={40} className="opacity-50" />
                      <p className="text-sm">还没有生成场景图</p>
                    </div>
                  )}
                  {/* 历史缩略图条:贴着大图底部,跟角色 preview 的左栏对齐 */}
                  {history.length > 0 && (
                    <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5 overflow-x-auto py-1 px-1 rounded bg-black/50 backdrop-blur-sm">
                      <span className="text-[9px] font-mono text-white/70 shrink-0 pr-1">历史 ({history.length})</span>
                      {history.map((u, i) => {
                        const isPinned = selectedSceneImages[s.id] === u
                        return (
                          <button
                            key={`${u}-${i}`}
                            type="button"
                            onClick={() => {
                              // 点缩略图 = 选为推荐(reference)
                              setSelectedSceneImages((m) => {
                                if (isPinned) {
                                  const { [s.id]: _omit, ...rest } = m
                                  return rest
                                }
                                return { ...m, [s.id]: u }
                              })
                            }}
                            title={isPinned ? '已是推荐(reference) — 再点取消' : '把这张设为场景 reference'}
                            className={`relative shrink-0 w-12 h-9 rounded overflow-hidden border-2 transition ${
                              i === currentIdx
                                ? 'border-accent'
                                : isPinned
                                  ? 'border-emerald-400/70'
                                  : 'border-white/30 hover:border-white/70'
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt={`历史 #${i + 1}`} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                            {i === history.length - 1 && (
                              <span className="absolute top-0 left-0 px-1 text-[8px] font-bold bg-accent text-accent-foreground rounded-br">NEW</span>
                            )}
                            {isPinned && (
                              <span className="absolute bottom-0 right-0 px-1 text-[8px] font-bold bg-emerald-500 text-white rounded-tl inline-flex items-center gap-0.5">
                                <Target size={7} /> 选中
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div className="overflow-y-auto p-4 space-y-3 bg-bg-surface min-h-0">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">地点 / 时段</div>
                    <div className="text-sm text-text-primary">{s.location || '—'} · {SCENE_TIME_LABELS[s.timeOfDay] ?? s.timeOfDay}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">动作</div>
                    <p className="text-sm text-text-secondary leading-relaxed">{s.action || '—'}</p>
                  </div>
                  {s.beats.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">节拍</div>
                      <ul className="space-y-1 text-sm">
                        {s.beats.map((b, i) => (
                          <li key={i} className="flex gap-2 text-text-secondary">
                            <span className="text-accent shrink-0">·</span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {s.dialogue.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">对白</div>
                      <div className="space-y-1.5">
                        {s.dialogue.map((d, i) => (
                          <div key={i} className="text-sm">
                            <span className="font-semibold text-text-primary">{d.role}</span>
                            {d.parenthetical && <span className="text-text-muted text-xs ml-1">({d.parenthetical})</span>}
                            <span className="text-text-secondary">："{d.line}"</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 修改场景:嵌入预览右侧底部,和角色修改对齐 */}
                  <div className="shrink-0 rounded-lg border border-border bg-bg-elevated/40 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-text-secondary font-semibold">修改场景</div>
                      <span className="text-[10px] text-text-muted">Enter 发送</span>
                    </div>
                    <textarea
                      value={sceneModInput}
                      onChange={(e) => setSceneModInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          const p = sceneModOpen || s
                          setSceneModOpen(p)
                          void doSceneRegen(p, 'modify', sceneModInput.trim())
                        }
                      }}
                      placeholder="例如:把时间改成黄昏 / 增加下雨效果 / 改成室内暖光…"
                      rows={3}
                      disabled={sceneModBusy}
                      className="w-full rounded-md bg-bg-base border border-border text-sm text-text-primary p-2 focus:border-accent focus:outline-none resize-none placeholder:text-text-muted disabled:opacity-50"
                    />
                    {sceneModError && (
                      <div className="px-2.5 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-400">{sceneModError}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ============= 道具放大预览 lightbox(2026/06,与场景对称) ============= */}
      {propPreview && (() => {
        const p = propPreview
        const history = propImages[p.id] ?? []
        const pinnedUrl = selectedPropImages[p.id]
        const currentUrl = (pinnedUrl && history.includes(pinnedUrl))
          ? pinnedUrl
          : history.at(-1)
        const currentIdx = currentUrl ? Math.max(0, history.indexOf(currentUrl)) : -1
        return (
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
            onClick={() => setPropPreview(null)}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="relative bg-bg-surface border border-border rounded-2xl overflow-hidden shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Top bar */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                <div className="min-w-0">
                  <div className="text-[10px] font-mono text-text-muted">PROP</div>
                  <div className="font-display text-base font-bold text-text-primary truncate">{p.name}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setPropPreview(null)}
                  className="p-1.5 rounded-md hover:bg-bg-elevated text-text-muted"
                  aria-label="关闭"
                >
                  <X size={18} />
                </button>
              </div>
              {/* Body: large image + description */}
              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[2fr_1fr]">
                <div className="relative bg-black flex items-center justify-center min-h-[300px] max-h-[calc(90vh-180px)]">
                  {currentUrl ? (
                    <img
                      src={currentUrl}
                      alt={p.name}
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-text-muted p-8">
                      <ImageIcon size={40} className="opacity-50" />
                      <p className="text-sm">还没有生成道具图</p>
                    </div>
                  )}
                  {/* History thumbnails bar */}
                  {history.length > 0 && (
                    <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5 overflow-x-auto py-1 px-1 rounded bg-black/50 backdrop-blur-sm">
                      <span className="text-[9px] font-mono text-white/70 shrink-0 pr-1">历史 ({history.length})</span>
                      {history.map((u, i) => {
                        const isPinned = selectedPropImages[p.id] === u
                        return (
                          <button
                            key={`${u}-${i}`}
                            type="button"
                            onClick={() => {
                              if (isPinned) {
                                setSelectedPropImages((m) => {
                                  const { [p.id]: _omit, ...rest } = m
                                  return rest
                                })
                              } else {
                                setSelectedPropImages((m) => ({ ...m, [p.id]: u }))
                              }
                            }}
                            title={isPinned ? '已是推荐(reference) — 再点取消' : '把这张设为道具 reference'}
                            className={`relative shrink-0 w-12 h-9 rounded overflow-hidden border-2 transition ${
                              i === currentIdx
                                ? 'border-accent'
                                : isPinned
                                  ? 'border-emerald-400/70'
                                  : 'border-white/30 hover:border-white/70'
                            }`}
                          >
                            <img src={u} alt={`历史 #${i + 1}`} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                            {i === history.length - 1 && (
                              <span className="absolute top-0 left-0 px-1 text-[8px] font-bold bg-accent text-accent-foreground rounded-br">NEW</span>
                            )}
                            {isPinned && (
                              <span className="absolute bottom-0 right-0 px-1 text-[8px] font-bold bg-emerald-500 text-white rounded-tl inline-flex items-center gap-0.5">
                                <Target size={7} /> 选中
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div className="overflow-y-auto p-4 space-y-3 bg-bg-surface min-h-0">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">道具名称</div>
                    <div className="text-sm text-text-primary">{p.name}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">描述</div>
                    <p className="text-sm text-text-secondary leading-relaxed">{p.description || '—'}</p>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">剧情运动</div>
                    <p className="text-sm text-text-secondary leading-relaxed">{p.movementDescription || '—'}</p>
                  </div>
                  {p.keyMoments.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">关键节点</div>
                      <ul className="space-y-1 text-sm">
                        {p.keyMoments.map((m, i) => (
                          <li key={i} className="flex gap-2 text-text-secondary">
                            <span className="text-accent shrink-0">·</span>
                            <span>{m}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {p.palette.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">配色</div>
                      <div className="flex gap-1.5">
                        {p.palette.map((color, i) => (
                          <div key={i} className="w-6 h-6 rounded-full border border-border" style={{ background: color }} title={color} />
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 修改道具:嵌入预览右侧底部 */}
                  <div className="shrink-0 rounded-lg border border-border bg-bg-elevated/40 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-text-secondary font-semibold">修改道具</div>
                      <span className="text-[10px] text-text-muted">Enter 发送</span>
                    </div>
                    <textarea
                      value={propModInput}
                      onChange={(e) => setPropModInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void doPropRegen(p, 'modify', propModInput.trim())
                        }
                      }}
                      placeholder="例如:把颜色改成红色 / 加一个提手 / 缩小尺寸…"
                      rows={3}
                      disabled={propModBusy}
                      className="w-full rounded-md bg-bg-base border border-border text-sm text-text-primary p-2 focus:border-accent focus:outline-none resize-none placeholder:text-text-muted disabled:opacity-50"
                    />
                    {propModError && (
                      <div className="px-2.5 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-400">{propModError}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ============= 道具修改输入弹层(2026/06,与场景对称) ============= */}
      {propModOpen && (() => {
        const p = propModOpen
        const history = propImages[p.id] ?? []
        const pinnedUrl = selectedPropImages[p.id]
        const currentUrl = (pinnedUrl && history.includes(pinnedUrl))
          ? pinnedUrl
          : history.at(-1)
        return (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/40"
              onClick={closePropModPanel}
              aria-hidden
            />
            <aside
              className="fixed top-0 right-0 bottom-0 z-50 w-[400px] max-w-[90vw] bg-bg-surface border-l border-border shadow-2xl flex flex-col"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex items-start justify-between px-4 py-3 border-b border-border shrink-0">
                <div className="min-w-0">
                  <div className="text-xs text-text-muted">修改道具</div>
                  <div className="font-display text-base font-bold text-text-primary truncate">{p.name}</div>
                  <div className="text-[11px] text-text-muted">{p.description?.slice(0, 40) || ''}</div>
                </div>
                <button
                  type="button"
                  onClick={closePropModPanel}
                  disabled={propModBusy}
                  className="p-1.5 rounded-md hover:bg-bg-elevated text-text-muted disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">当前参考图(基于此图修改)</div>
                  <div className="relative w-full aspect-[4/3] bg-bg-base rounded-lg overflow-hidden border border-border">
                    {currentUrl ? (
                      <img src={currentUrl} alt={p.name} className="absolute inset-0 w-full h-full object-contain" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-text-muted text-xs">
                        该道具还没生成
                      </div>
                    )}
                  </div>
                </div>
                {history.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">
                      历史生成 ({history.length})
                    </div>
                    <div className="flex items-center gap-1.5 overflow-x-auto py-1">
                      {history.map((u, i) => {
                        const isPinned = selectedPropImages[p.id] === u
                        return (
                          <button
                            key={`${u}-${i}`}
                            type="button"
                            onClick={() => {
                              setSelectedPropImages((m) => {
                                if (isPinned) {
                                  const { [p.id]: _omit, ...rest } = m
                                  return rest
                                }
                                return { ...m, [p.id]: u }
                              })
                            }}
                            title={isPinned ? '已选为参考(reference),再点取消' : '把这张设为参考'}
                            className={`relative shrink-0 w-14 h-10 rounded overflow-hidden border-2 transition ${
                              u === currentUrl
                                ? 'border-accent'
                                : isPinned
                                  ? 'border-emerald-400/70'
                                  : 'border-border hover:border-accent/60'
                            }`}
                          >
                            <img src={u} alt={`历史 #${i + 1}`} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                            {i === history.length - 1 && (
                              <span className="absolute top-0 left-0 px-1 text-[8px] font-bold bg-accent text-accent-foreground rounded-br">NEW</span>
                            )}
                            {isPinned && (
                              <span className="absolute bottom-0 right-0 px-1 text-[8px] font-bold bg-emerald-500 text-white rounded-tl inline-flex items-center gap-0.5">
                                <Target size={7} /> 选中
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">修改意见</div>
                  <textarea
                    value={propModInput}
                    onChange={(e) => setPropModInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void submitPropModPanel()
                      }
                    }}
                    placeholder="例如:把颜色改成红色 / 增加金属质感 / 换成木纹材质…"
                    rows={5}
                    disabled={propModBusy}
                    className="w-full rounded-md bg-bg-elevated border border-border text-sm text-text-primary p-2 focus:border-accent focus:outline-none resize-none placeholder:text-text-muted disabled:opacity-50"
                  />
                  <p className="text-[10px] text-text-muted mt-1.5 leading-relaxed">
                    AI 会保留:道具本体、形状、基本构图、纯色背景、无人物。只改你描述的部分。
                  </p>
                </div>
                {propModError && (
                  <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-xs text-rose-400">
                    {propModError}
                  </div>
                )}
              </div>
              <div className="shrink-0 border-t border-border p-3 flex items-center justify-between gap-2">
                <span className="text-[10px] text-text-muted">Enter 发送 · Shift+Enter 换行</span>
                <button
                  type="button"
                  onClick={() => void submitPropModPanel()}
                  disabled={propModBusy || !propModInput.trim() || !currentUrl}
                  className="px-4 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 inline-flex items-center gap-1.5"
                >
                  {propModBusy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  {propModBusy ? '生成中…' : '发送修改'}
                </button>
              </div>
            </aside>
          </>
        )
      })()}

      {sceneModOpen && (() => {
        const s = sceneModOpen
        const history = sceneImages[s.id] ?? []
        // 2026/06:选中优先,跟角色 selectedCharImages 同语义
        const pinnedUrl = selectedSceneImages[s.id]
        const currentUrl = (pinnedUrl && history.includes(pinnedUrl))
          ? pinnedUrl
          : history.at(-1)
        return (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/40"
              onClick={closeSceneModPanel}
              aria-hidden
            />
            <aside
              className="fixed top-0 right-0 bottom-0 z-50 w-[400px] max-w-[90vw] bg-bg-surface border-l border-border shadow-2xl flex flex-col"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex items-start justify-between px-4 py-3 border-b border-border shrink-0">
                <div className="min-w-0">
                  <div className="text-xs text-text-muted">修改场景</div>
                  <div className="font-display text-base font-bold text-text-primary truncate">{s.slug}</div>
                  <div className="text-[11px] text-text-muted">{s.location || s.action?.slice(0, 40) || ''}</div>
                </div>
                <button
                  type="button"
                  onClick={closeSceneModPanel}
                  disabled={sceneModBusy}
                  className="p-1.5 rounded-md hover:bg-bg-elevated text-text-muted disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">当前参考图(基于此图修改)</div>
                  <div className="relative w-full aspect-video bg-bg-base rounded-lg overflow-hidden border border-border">
                    {currentUrl ? (
                      <img src={currentUrl} alt={s.slug} className="absolute inset-0 w-full h-full object-contain" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-text-muted text-xs">
                        该场景还没生成
                      </div>
                    )}
                  </div>
                </div>
                {/* 2026/06:历史缩略图条 —— 跟角色 preview 对齐,允许在修改前换 reference */}
                {history.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">
                      历史生成 ({history.length})
                    </div>
                    <div className="flex items-center gap-1.5 overflow-x-auto py-1">
                      {history.map((u, i) => {
                        const isPinned = selectedSceneImages[s.id] === u
                        return (
                          <button
                            key={`${u}-${i}`}
                            type="button"
                            onClick={() => {
                              setSelectedSceneImages((m) => {
                                if (isPinned) {
                                  const { [s.id]: _omit, ...rest } = m
                                  return rest
                                }
                                return { ...m, [s.id]: u }
                              })
                            }}
                            title={isPinned ? '已选为参考(reference),再点取消' : '把这张设为参考'}
                            className={`relative shrink-0 w-14 h-10 rounded overflow-hidden border-2 transition ${
                              u === currentUrl
                                ? 'border-accent'
                                : isPinned
                                  ? 'border-emerald-400/70'
                                  : 'border-border hover:border-accent/60'
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt={`历史 #${i + 1}`} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                            {i === history.length - 1 && (
                              <span className="absolute top-0 left-0 px-1 text-[8px] font-bold bg-accent text-accent-foreground rounded-br">NEW</span>
                            )}
                            {isPinned && (
                              <span className="absolute bottom-0 right-0 px-1 text-[8px] font-bold bg-emerald-500 text-white rounded-tl inline-flex items-center gap-0.5">
                                <Target size={7} /> 选中
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">修改意见</div>
                  <textarea
                    value={sceneModInput}
                    onChange={(e) => setSceneModInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void submitSceneModPanel()
                      }
                    }}
                    placeholder="例如:把光线调成夜晚霓虹 / 把天气改成下雨 / 加一些桌椅道具…"
                    rows={5}
                    disabled={sceneModBusy}
                    className="w-full rounded-md bg-bg-elevated border border-border text-sm text-text-primary p-2 focus:border-accent focus:outline-none resize-none placeholder:text-text-muted disabled:opacity-50"
                  />
                  <p className="text-[10px] text-text-muted mt-1.5 leading-relaxed">
                    AI 会保留:构图、光照、地点、时段、视觉风格、纯环境无人物。只改你描述的部分。
                  </p>
                </div>
                {sceneModError && (
                  <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-xs text-rose-400">
                    {sceneModError}
                  </div>
                )}
              </div>
              <div className="shrink-0 border-t border-border p-3 flex items-center justify-between gap-2">
                <span className="text-[10px] text-text-muted">Enter 发送 · Shift+Enter 换行</span>
                <button
                  type="button"
                  onClick={() => void submitSceneModPanel()}
                  disabled={sceneModBusy || !sceneModInput.trim() || !currentUrl}
                  className="px-4 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 inline-flex items-center gap-1.5"
                >
                  {sceneModBusy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  {sceneModBusy ? '生成中…' : '发送修改'}
                </button>
              </div>
            </aside>
          </>
        )
      })()}


      {/* ============= 新增集数 对话框 =============
          顶部下拉最底下的"+ 新增集数"触发。两条路径:
          - AI 生成:走 runScriptEpisode 流式生成(已有集数作为上下文)
          - 导入剧本:读 .txt/.md/.docx,内容直接当本集文本 */}
      {addEpisodeOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={closeAddEpisodeDialog}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="新增集数"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="pointer-events-auto w-full max-w-md rounded-2xl border border-border bg-bg-surface shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-muted tracking-wide uppercase">新增集数</div>
                  <div className="font-display text-base font-bold text-text-primary">
                    第 {computeNextEpIndex()} 集
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeAddEpisodeDialog}
                  disabled={addEpisodeImporting}
                  className="p-1.5 rounded-md hover:bg-bg-elevated text-text-muted disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-5 space-y-3">
                <p className="text-xs text-text-muted leading-relaxed">
                  {data.episodeTexts.length > 0
                    ? `将在已有 ${data.episodeTexts.length} 集基础上新增第 ${computeNextEpIndex()} 集,前面所有集数会作为 AI 生成的上下文。`
                    : '从第 1 集开始你的剧本。AI 会以"通用剧情"理解(尚未生成梗概),效果可能一般;生成完后可在「剧本」标签补充梗概后重跑。'}
                </p>
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => void handleAddEpisodeAI()}
                    disabled={addEpisodeImporting || episodeStreaming || synopsisStreaming}
                    className="rounded-xl border border-accent bg-accent-dim hover:bg-accent hover:text-white text-accent px-3 py-4 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-1.5"
                  >
                    <Sparkles size={18} />
                    <span>AI 生成</span>
                    <span className="text-[10px] font-normal opacity-80 leading-snug">按已有集数续写</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => addEpisodeFileInputRef.current?.click()}
                    disabled={addEpisodeImporting}
                    className="rounded-xl border border-border bg-bg-elevated hover:border-accent hover:text-accent text-text-secondary px-3 py-4 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-1.5"
                  >
                    {addEpisodeImporting ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
                    <span>{addEpisodeImporting ? '读取中…' : '导入剧本'}</span>
                    <span className="text-[10px] font-normal opacity-80 leading-snug">.txt / .md / .docx</span>
                  </button>
                </div>
                <input
                  ref={addEpisodeFileInputRef}
                  type="file"
                  accept=".txt,.md,.docx"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    void handleAddEpisodeFilePicked(file)
                  }}
                />
                <p className="text-[10px] text-text-muted leading-relaxed pt-1">
                  提示:多集剧本的统一导入(替换整季)在右侧 AI 助手的「导入剧本」入口,会把全部内容按集拆开。
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ============= 分镜图 预览 / 修改模态 =============
          跟人物卡片的 previewTarget 模态同一套思路:左侧历史缩略图、中间大图、
          右侧镜头描述 + 修改意见输入 + 发送按钮。
          触发:点 shot 缩略图右上角的"放大"按钮(generateShotImageForGroup 出图后
          才会出现这个按钮)。 */}
      {shotPreview && (() => {
        const { groupId, shotId } = shotPreview
        const group = data.storyboardGroups.find((gg) => gg.id === groupId)
        const shot = group?.shots.find((s) => s.id === shotId)
        if (!group || !shot) return null
        const imageKey = `${groupId}::${shotId}`
        const generations = shotImages[imageKey] ?? (shot.imageUrl ? [shot.imageUrl] : [])
        const currentIdx = Math.min(shotSelectedGenIdx, Math.max(0, generations.length - 1))
        const currentUrl = generations[currentIdx]
        const cardTitle = `${shot.shotTypeLabel} · ${shot.action.slice(0, 24)}${shot.action.length > 24 ? '…' : ''}`
        return (
          <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => { setShotPreview(null); setShotModInput('') }}
            role="dialog"
            aria-modal="true"
            aria-label="分镜图预览"
          >
            <div
              className="relative bg-bg-surface border border-border rounded-2xl overflow-hidden shadow-2xl w-full max-w-[1280px] h-[88vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Top bar */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
                <div className="min-w-0">
                  <div className="font-display text-base font-bold text-text-primary truncate">{cardTitle}</div>
                  <div className="text-xs text-text-muted">第 {group.index} 组 · {shot.shotType} · 共 {generations.length} 张</div>
                </div>
                <button
                  type="button"
                  onClick={() => { setShotPreview(null); setShotModInput('') }}
                  className="p-1.5 rounded-md hover:bg-bg-elevated text-text-muted"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[120px_1fr_360px] gap-3 p-3">
                {/* Left: history thumbnails */}
                <aside className="overflow-y-auto pr-1 space-y-2 min-h-0">
                  <div className="text-[10px] text-text-muted px-1 pb-1 sticky top-0 bg-bg-surface">
                    历史生成（{generations.length}）
                  </div>
                  {generations.length === 0 ? (
                    <div className="aspect-video rounded border border-dashed border-border flex items-center justify-center text-[10px] text-text-muted text-center px-1">
                      暂无图片
                    </div>
                  ) : (
                    generations.map((u, i) => (
                      <button
                        key={`${u}-${i}`}
                        type="button"
                        onClick={() => setShotSelectedGenIdx(i)}
                        className={`block w-full rounded border-2 overflow-hidden transition ${
                          i === currentIdx ? 'border-accent' : 'border-border hover:border-accent/60'
                        }`}
                        title={`第 ${i + 1} 张`}
                      >
                        <div className="relative w-full aspect-video bg-bg-base">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={u}
                            alt={`${cardTitle} #${i + 1}`}
                            loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                          {i === generations.length - 1 && (
                            <span className="absolute top-1 left-1 px-1 py-0.5 rounded bg-accent text-accent-foreground text-[9px] font-semibold">
                              NEW
                            </span>
                          )}
                          <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/60 text-white text-[9px] tabular-nums">
                            #{i + 1}
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </aside>

                {/* Center: large image */}
                <div className="relative bg-bg-base rounded-lg overflow-hidden flex items-center justify-center min-h-0">
                  {currentUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={currentUrl}
                      alt={cardTitle}
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-text-muted">
                      <ImageIcon size={40} className="opacity-50" />
                      <p className="text-sm">还没有分镜图</p>
                    </div>
                  )}
                  {shotModBusy && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-2 text-white">
                        <Loader2 size={32} className="animate-spin" />
                        <span className="text-sm">正在按你的意见重生…</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right: description + modify input */}
                <div className="flex flex-col min-h-0 gap-3">
                  <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border bg-bg-elevated/40 p-3 space-y-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-text-muted">当前选中</div>
                      <div className="text-sm font-semibold text-text-primary mt-0.5">
                        {currentUrl ? `第 ${currentIdx + 1} / ${generations.length} 张` : '未生成'}
                      </div>
                    </div>
                    <dl className="space-y-1.5 text-xs">
                      <div><dt className="text-text-muted">景别</dt><dd className="text-text-secondary">{shot.shotTypeLabel}（{shot.shotType}）</dd></div>
                      <div><dt className="text-text-muted">动作</dt><dd className="text-text-secondary">{shot.action || '-'}</dd></div>
                      {shot.camera && <div><dt className="text-text-muted">机位</dt><dd className="text-text-secondary">🎥 {shot.camera}</dd></div>}
                    </dl>
                    <div className="pt-1">
                      <div className="text-[10px] uppercase tracking-wide text-text-muted">剧情</div>
                      <p className="text-[11px] text-text-secondary leading-relaxed mt-0.5">{group.plotText}</p>
                    </div>
                    {/* 2026/06:本镜头的"实际生效角色列表"(shot 覆盖 group)。
                        UI 支持加 / 减 + 选 look + 恢复默认(group 全集)。 */}
                    <ShotMembershipEditor
                      group={group}
                      shot={shot}
                      characters={data.characters}
                      charImages={charImages}
                      onAdd={(cid) => setShotCharacterMembership(group.id, shot.id, cid, 'add')}
                      onRemove={(cid) => setShotCharacterMembership(group.id, shot.id, cid, 'remove')}
                      onSetLook={(cid, imageKey) => updateShotCharacterRef(group.id, shot.id, cid, imageKey)}
                      onReset={() => resetShotOverrides(group.id, shot.id)}
                    />
                    {/* 2026/06:本镜头的场景选择(shot 覆盖 group.sceneId) */}
                    <ShotSceneEditor
                      group={group}
                      shot={shot}
                      scenes={data.scenes}
                      onSet={(sid) => setShotScene(group.id, shot.id, sid)}
                      onReset={() => setShotScene(group.id, shot.id, null)}
                    />
                  </div>

                  <div className="shrink-0 rounded-lg border border-border bg-bg-elevated/40 p-3 space-y-2">
                    <div className="text-xs text-text-secondary font-semibold">修改分镜图</div>
                    <p className="text-[10px] text-text-muted leading-relaxed">
                      AI 会保留当前镜头的:景别、构图、视角、风格。只改你描述的部分(角色表情、道具、光照等)。
                    </p>
                    <textarea
                      value={shotModInput}
                      onChange={(e) => setShotModInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          void handleRegenShot()
                        }
                      }}
                      placeholder="例如:让角色表情更紧张 / 把背景换成雨天 / 加一束侧逆光…"
                      rows={4}
                      disabled={shotModBusy || !currentUrl}
                      className="w-full rounded-md bg-bg-elevated border border-border text-sm text-text-primary p-2 focus:border-accent focus:outline-none resize-none placeholder:text-text-muted disabled:opacity-50"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-text-muted">⌘/Ctrl + Enter 发送</span>
                      <button
                        type="button"
                        onClick={() => void handleRegenShot()}
                        disabled={shotModBusy || !shotModInput.trim() || !currentUrl}
                        className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 inline-flex items-center gap-1.5"
                      >
                        {shotModBusy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                        {shotModBusy ? '生成中…' : '发送修改'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ============= 故事板图放大模态(2026/06 跟分镜图对齐) =============
          2026/06 二次扩展:跟分镜图 preview 一样,加修改意见输入 + 发送按钮。
          故事板没有 history 多代概念(每个 group 只 1 张),所以模态结构比
          shot preview 简单:全屏黑底 + 左图 + 右修改输入。
          16:9 故事板图展示在左半,modify 区域在右半。
          背景点击只关闭(不重置 storyboardModInput,以防误触)。 */}
      {storyboardPreview && (() => {
        const url = groupStoryboards[storyboardPreview.groupId]?.url
        if (!url) return null
        const group = data.storyboardGroups.find((gg) => gg.id === storyboardPreview.groupId)
        const title = group ? `第 ${group.index} 组 · 故事板` : '故事板'
        const isRunning = groupStoryboards[storyboardPreview.groupId]?.status === 'running'
        return (
          <div
            className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setStoryboardPreview(null)}
            role="dialog"
            aria-modal="true"
            aria-label="故事板预览"
          >
            <div
              className="relative w-full max-w-[1280px] h-full max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 顶部 bar:标题 + 关闭 */}
              <div className="flex items-center justify-between px-1 pb-2 shrink-0">
                <div className="text-sm font-display font-semibold text-white/90 truncate">{title}</div>
                <button
                  type="button"
                  onClick={() => setStoryboardPreview(null)}
                  className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[1fr_360px] gap-3">
                {/* 左:故事板图(16:9,占左半) */}
                <div className="relative bg-bg-base rounded-lg overflow-hidden flex items-center justify-center min-h-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={title}
                    onLoad={() => clearStoryboardBroken(storyboardPreview.groupId)}
                    onError={() => markStoryboardBroken(storyboardPreview.groupId)}
                    className="max-w-full max-h-full object-contain rounded"
                  />
                  {storyboardModBusy && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-2 text-white">
                        <Loader2 size={32} className="animate-spin" />
                        <span className="text-sm">正在按你的意见重生故事板…</span>
                      </div>
                    </div>
                  )}
                  {isRunning && !storyboardModBusy && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-2 text-white">
                        <Loader2 size={32} className="animate-spin" />
                        <span className="text-sm">故事板生成中…</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 右:上下文 + 修改输入 */}
                <div className="flex flex-col min-h-0 gap-3">
                  <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border bg-bg-surface/95 text-text-primary p-3 space-y-2">
                    <div className="text-xs font-semibold">故事板上下文</div>
                    {group && (
                      <>
                        <dl className="space-y-1.5 text-xs">
                          <div>
                            <dt className="text-text-muted">剧情</dt>
                            <dd className="text-text-secondary leading-relaxed">{group.plotText || '-'}</dd>
                          </div>
                          {group.characterIds.length > 0 && (
                            <div>
                              <dt className="text-text-muted">涉及角色</dt>
                              <dd className="flex flex-wrap gap-1 mt-1">
                                {group.characterIds.map((cid) => {
                                  const ch = data.characters.find((c) => c.id === cid)
                                  return (
                                    <span key={cid} className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-bg-elevated text-text-secondary">
                                      {ch?.name ?? cid}
                                    </span>
                                  )
                                })}
                              </dd>
                            </div>
                          )}
                          {group.shots.length > 0 && (
                            <div>
                              <dt className="text-text-muted">镜头数</dt>
                              <dd className="text-text-secondary">{group.shots.length} 个</dd>
                            </div>
                          )}
                        </dl>
                      </>
                    )}
                  </div>

                  <div className="shrink-0 rounded-lg border border-border bg-bg-surface/95 text-text-primary p-3 space-y-2">
                    <div className="text-xs font-semibold">修改故事板</div>
                    <p className="text-[10px] text-text-muted leading-relaxed">
                      AI 会保留当前故事板的 6-section 布局、字号层级、文字可读性、角色身份和场景。只改你描述的部分(色板 / 标题 / 故事板帧内容 / 灯光情绪 / 关键词等)。
                    </p>
                    <textarea
                      value={storyboardModInput}
                      onChange={(e) => setStoryboardModInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          void handleRegenStoryboard()
                        }
                      }}
                      placeholder="例如:整体色调换成冷色 / 故事板第 3 格改成雨天 / 标题改成英文 / 加一个'孤独'情绪关键词…"
                      rows={4}
                      disabled={storyboardModBusy || isRunning || !url}
                      className="w-full rounded-md bg-bg-elevated border border-border text-sm text-text-primary p-2 focus:border-accent focus:outline-none resize-none placeholder:text-text-muted disabled:opacity-50"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-text-muted">⌘/Ctrl + Enter 发送</span>
                      <button
                        type="button"
                        onClick={() => void handleRegenStoryboard()}
                        disabled={storyboardModBusy || isRunning || !storyboardModInput.trim() || !url}
                        className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 inline-flex items-center gap-1.5"
                      >
                        {storyboardModBusy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                        {storyboardModBusy ? '生成中…' : '发送修改'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ============= 新建空分镜 — 插入位置选择弹窗 ============= */}
      {showNewGroupModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowNewGroupModal(false)}
        >
          <div
            className="bg-bg-surface border border-border rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-base font-bold">新建空分镜</h3>
            <p className="text-xs text-text-muted">选择一个插入位置：</p>
            <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
              <button
                onClick={() => handleInsertGroup('first')}
                className="w-full text-left px-3 py-2 rounded-lg border border-border hover:border-accent text-sm transition"
              >
                ↑ 添加到最前面
              </button>
              {data.storyboardGroups.filter((g) => g.episodeIndex === selectedEpisodeIndex).map((g) => (
                <button
                  key={g.id}
                  onClick={() => handleInsertGroup(g.id)}
                  className="w-full text-left px-3 py-2 rounded-lg border border-border hover:border-accent text-sm transition"
                >
                  添加到 # {g.index} 之后
                </button>
              ))}
              <button
                onClick={() => handleInsertGroup('last')}
                className="w-full text-left px-3 py-2 rounded-lg border border-accent bg-accent-dim text-accent text-sm transition"
              >
                ↓ 添加到最后面（默认）
              </button>
            </div>
            <button
              onClick={() => setShowNewGroupModal(false)}
              className="w-full py-2 rounded-lg border border-border text-xs text-text-muted hover:border-accent transition"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* ============= 查看提示词模态(2026/06) =============
          全局开关 viewPromptsMode 打开时,所有生成按钮触发后不真正生成,而是
          把 server fn 返回的 previewPrompt 弹到这个 modal 里展示。带复制按钮。 */}
      {promptPreview && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPromptPreview(null)}
          role="dialog"
          aria-modal="true"
          aria-label="查看提示词"
        >
          <div
            className="relative w-full max-w-3xl max-h-[85vh] bg-bg-surface border border-accent/40 rounded-2xl shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
              <h2 className="font-display text-base font-bold inline-flex items-center gap-2">
                <Sparkles size={16} className="text-accent" /> 提示词预览 · {promptPreview.title}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const text = [
                      `=== ${promptPreview.title} ===`,
                      promptPreview.size ? `Size: ${promptPreview.size}` : '',
                      promptPreview.extra ? Object.entries(promptPreview.extra).map(([k, v]) => `${k}: ${v}`).join('\n') : '',
                      '',
                      '--- POSITIVE PROMPT ---',
                      promptPreview.prompt,
                      promptPreview.negative ? '\n--- NEGATIVE PROMPT ---\n' + promptPreview.negative : '',
                    ].filter(Boolean).join('\n')
                    navigator.clipboard.writeText(text).then(() => toast.success('提示词已复制'))
                  }}
                  className="px-3 py-1 text-xs rounded-md border border-accent text-accent bg-accent-dim/30 hover:bg-accent-dim/60 transition"
                >
                  📋 复制
                </button>
                <button
                  type="button"
                  onClick={() => setPromptPreview(null)}
                  className="p-1.5 rounded-md hover:bg-bg-elevated text-text-muted"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0">
              {promptPreview.size && (
                <div className="text-[11px] text-text-muted">
                  Image size: <span className="font-mono text-text-secondary">{promptPreview.size}</span>
                </div>
              )}
              {promptPreview.extra && Object.entries(promptPreview.extra).length > 0 && (
                <div className="text-[11px] text-text-muted space-y-0.5">
                  {Object.entries(promptPreview.extra).map(([k, v]) => (
                    <div key={k}>
                      <span className="text-text-secondary">{k}:</span> <span className="font-mono">{v}</span>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <div className="text-[11px] uppercase tracking-widest text-accent mb-1">Positive Prompt</div>
                <pre className="whitespace-pre-wrap break-words text-[11px] text-text-secondary bg-bg-base border border-border rounded-md p-3 font-mono leading-relaxed">{promptPreview.prompt}</pre>
              </div>
              {promptPreview.negative && (
                <div>
                  <div className="text-[11px] uppercase tracking-widest text-rose-400 mb-1">Negative Prompt</div>
                  <pre className="whitespace-pre-wrap break-words text-[11px] text-text-secondary bg-bg-base border border-rose-500/20 rounded-md p-3 font-mono leading-relaxed">{promptPreview.negative}</pre>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-border shrink-0 flex items-center justify-between">
              <span className="text-[11px] text-text-muted">
                查看模式已开启 — 按钮不会真正生成,只展示提示词。再次点击顶部 toggle 关闭。
              </span>
              <button
                type="button"
                onClick={() => setPromptPreview(null)}
                className="px-3 py-1 text-xs rounded-md bg-accent text-accent-foreground font-semibold hover:opacity-90"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
