// Centralized mock data for new front-end pages.
// All values are illustrative; safe to import from any client component.

export type TeamMember = {
  id: string
  name: string
  email: string
  role: 'admin' | 'member'
  status: 'active' | 'disabled' | 'pending'
  usage: number // API calls this month
  joined: string
  avatarColor: string
}

export const teamMembers: TeamMember[] = [
  { id: 'u1', name: '林墨', email: 'lin.mo@studio.com', role: 'admin',  status: 'active',   usage: 1280, joined: '2025-09-12', avatarColor: 'from-rose-400 to-fuchsia-500' },
  { id: 'u2', name: '陈昭',  email: 'chen.zhao@studio.com', role: 'member', status: 'active',   usage: 642,  joined: '2025-10-03', avatarColor: 'from-amber-400 to-orange-500' },
  { id: 'u3', name: '苏宁',  email: 'su.ning@studio.com',  role: 'member', status: 'active',   usage: 415,  joined: '2025-11-18', avatarColor: 'from-cyan-400 to-blue-500' },
  { id: 'u4', name: '何晚',  email: 'he.wan@studio.com',   role: 'member', status: 'pending',  usage: 0,    joined: '2026-04-22', avatarColor: 'from-emerald-400 to-teal-500' },
  { id: 'u5', name: '周漾',  email: 'zhou.yang@studio.com',role: 'member', status: 'disabled', usage: 78,   joined: '2025-08-01', avatarColor: 'from-purple-400 to-violet-500' },
]

export type AuditLog = {
  id: string
  user: string
  action: string
  target: string
  type: 'create' | 'edit' | 'delete' | 'export' | 'login' | 'invite'
  time: string
}

export const auditLogs: AuditLog[] = [
  { id: 'l1', user: '林墨', action: '生成剧本', target: '《晨星》第 3 集', type: 'create', time: '2026-05-12 09:21' },
  { id: 'l2', user: '陈昭', action: '导出资产', target: '角色 / 江月.png', type: 'export', time: '2026-05-12 09:04' },
  { id: 'l3', user: '苏宁', action: '编辑角色', target: '主角 - 林宴',     type: 'edit',   time: '2026-05-11 22:48' },
  { id: 'l4', user: '林墨', action: '邀请成员', target: 'he.wan@studio.com',type: 'invite', time: '2026-05-11 17:30' },
  { id: 'l5', user: '陈昭', action: '删除版本', target: '剧本 v3 草稿',     type: 'delete', time: '2026-05-11 11:12' },
  { id: 'l6', user: '林墨', action: '登录',     target: 'IP 36.110.x.x',   type: 'login',  time: '2026-05-11 09:00' },
]

export type Approval = {
  id: string
  applicant: string
  asset: string
  size: string
  thumb: string
  reason: string
  submitted: string
}

export const approvals: Approval[] = [
  { id: 'a1', applicant: '苏宁', asset: '角色三视图_林宴.zip', size: '12.4 MB', thumb: 'from-rose-500/40 via-fuchsia-700/30 to-zinc-900', reason: '客户提案使用', submitted: '2026-05-12 08:40' },
  { id: 'a2', applicant: '陈昭', asset: '剧本_晨星S01.pdf',    size: '480 KB', thumb: 'from-amber-500/40 via-orange-700/30 to-zinc-900', reason: '导演审阅',     submitted: '2026-05-11 21:02' },
  { id: 'a3', applicant: '苏宁', asset: '分镜_PV首发.mp4',     size: '86 MB',  thumb: 'from-cyan-500/40 via-blue-700/30 to-slate-900',  reason: '内部评审',     submitted: '2026-05-11 16:18' },
]

export type ScriptVersion = {
  id: string
  label: string
  author: string
  createdAt: string
  summary: string
  content: string
}

export const scriptVersions: ScriptVersion[] = [
  {
    id: 'v3', label: 'v3 · 当前',
    author: '林墨', createdAt: '2026-05-12 09:21',
    summary: '强化第二幕反转，补充配角动机。',
    content: `场景 12  内 - 老剧院后台 - 夜

  江月独自坐在化妆镜前，灯光忽明忽灭。

江月（轻声）
  我以为，舞台的尽头会有人等我。

  门外传来脚步声。

林宴（推门）
  你等的人，从未离开。`,
  },
  {
    id: 'v2', label: 'v2',
    author: '林墨', createdAt: '2026-05-11 22:10',
    summary: '调整开场节奏，删减过场。',
    content: `场景 12  内 - 老剧院后台 - 夜

  江月独自坐在化妆镜前。

江月
  舞台的尽头，会有人等我吗？

  脚步声由远及近。`,
  },
  {
    id: 'v1', label: 'v1 · 初稿',
    author: 'AI', createdAt: '2026-05-11 18:00',
    summary: '由 AI 基于一句话创意生成的首稿。',
    content: `场景 12  老剧院 - 夜

江月坐着发呆。

江月：会有人等我吗。`,
  },
]

export type Tenant = {
  id: string
  company: string
  contact: string
  seats: number
  plan: 'Studio' | 'Pro' | 'Trial'
  status: 'pending' | 'active' | 'rejected'
  applied: string
}

export const tenants: Tenant[] = [
  { id: 't1', company: '银河映画', contact: 'ops@galaxy.tv', seats: 12, plan: 'Studio', status: 'pending', applied: '2026-05-11' },
  { id: 't2', company: '木叶动画', contact: 'admin@konoha.cn', seats: 6,  plan: 'Pro',    status: 'active',  applied: '2026-04-22' },
  { id: 't3', company: '夜航 MCN', contact: 'biz@yehang.io',  seats: 24, plan: 'Studio', status: 'active',  applied: '2026-03-10' },
  { id: 't4', company: '青蓝工作室',contact: 'hi@qinglan.studio',seats: 3,plan: 'Trial',  status: 'rejected',applied: '2026-05-08' },
]

export type ModelEntry = {
  id: string
  name: string
  provider: string
  type: 'text' | 'image' | 'video'
  keyMasked: string
  enabled: boolean
  health: 'ok' | 'warn' | 'down'
  usage: number
}

export const modelEntries: ModelEntry[] = [
  { id: 'm1', name: 'gemini-2.5-flash',         provider: 'Google',   type: 'text',  keyMasked: 'sk-or-•••••••f24c', enabled: true,  health: 'ok',   usage: 18450 },
  { id: 'm2', name: 'gemini-2.5-pro',           provider: 'Google',   type: 'text',  keyMasked: 'sk-or-•••••••f24c', enabled: true,  health: 'ok',   usage: 4210 },
  { id: 'm3', name: 'gemini-3-pro-image-preview',provider: 'Google',  type: 'image', keyMasked: 'sk-or-•••••••f24c', enabled: false, health: 'down', usage: 0 },
  { id: 'm4', name: 'gpt-5',                    provider: 'OpenAI',   type: 'text',  keyMasked: 'sk-or-•••••••91ab', enabled: true,  health: 'warn', usage: 980 },
  { id: 'm5', name: 'kling-v3',                 provider: 'Kling',    type: 'video', keyMasked: 'sk-•••••••7c2',     enabled: true,  health: 'ok',   usage: 312 },
]

export type Invoice = {
  id: string
  period: string
  amount: number
  status: 'paid' | 'open' | 'void'
  pdf: string
}

export const invoices: Invoice[] = [
  { id: 'INV-2026-04', period: '2026/04', amount: 1980, status: 'paid', pdf: '#' },
  { id: 'INV-2026-03', period: '2026/03', amount: 1980, status: 'paid', pdf: '#' },
  { id: 'INV-2026-02', period: '2026/02', amount: 980,  status: 'paid', pdf: '#' },
]

export type RewardTask = {
  id: string
  title: string
  reward: number
  done: boolean
}

export const rewardTasks: RewardTask[] = [
  { id: 'r1', title: '每日登录', reward: 5,  done: true },
  { id: 'r2', title: '完成一次剧本生成', reward: 20, done: true },
  { id: 'r3', title: '发布一个角色到作品集', reward: 30, done: false },
  { id: 'r4', title: '邀请好友注册', reward: 50, done: false },
  { id: 'r5', title: '订阅专业版（一次性）', reward: 200, done: false },
]

export const rewardLevel = {
  current: 'Lv. 4 · 创作匠人',
  next: 'Lv. 5 · 影像导师',
  points: 1240,
  pointsToNext: 760,
  total: 2000,
}

export const creatorEarnings = [
  { month: '2026/01', amount: 412 },
  { month: '2026/02', amount: 580 },
  { month: '2026/03', amount: 760 },
  { month: '2026/04', amount: 1024 },
  { month: '2026/05', amount: 488 },
]

export type CharacterDetail = {
  id: string
  name: string
  archetype: string
  bible: { appearance: string; outfit: string; accessories: string; personality: string }
  views: { label: string; gradient: string }[]
  expressions: string[]
  relations: { from: string; to: string; label: string }[]
}

export const mockCharacterDetail: CharacterDetail = {
  id: 'c1',
  name: '林宴',
  archetype: '都市悬疑 / 男主',
  bible: {
    appearance: '身高 183cm，发色墨黑，眼神锐利。',
    outfit: '深灰大衣 + 高领毛衣，皮带扣有一处磨痕。',
    accessories: '左手银色机械腕表，右耳一枚黑色小耳钉。',
    personality: '冷静、克制、嘴硬心软；面对江月时会下意识放慢语速。',
  },
  views: [
    { label: '正面', gradient: 'from-cyan-500/40 via-blue-700/30 to-slate-900' },
    { label: '侧面', gradient: 'from-rose-500/40 via-fuchsia-700/30 to-zinc-900' },
    { label: '背面', gradient: 'from-amber-500/40 via-orange-700/30 to-zinc-900' },
  ],
  expressions: ['冷峻', '挑眉', '微笑', '愤怒', '错愕', '深思'],
  relations: [
    { from: '林宴', to: '江月', label: '青梅 / 暧昧' },
    { from: '林宴', to: '陈宿', label: '宿敌' },
    { from: '林宴', to: '苏师傅', label: '师承' },
  ],
}