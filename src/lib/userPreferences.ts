// ====================================================================
//  Per-user preferences (localStorage)
//
//  用途:记住每个用户最近一次在 NewProjectDialog 里选的模型 / 风格 /
//  工作流等,下次建项目自动恢复 + 置顶展示,**针对用户个人**(key 里带
//  Supabase user.id,跨浏览器不共享,跨账号不串)。
//
//  设计要点:
//    - 客户端 localStorage,无后端依赖,无需 RLS / 迁移
//    - 容错:localStorage 不可用(隐私模式 / quota)时 silently 退化
//    - patch 合并写入,避免一次写入覆盖其他维度
//    - 已知迁移:如果以后想存到 Supabase user_meta,只换 save/load 即可,
//      调用方零改动
//
//  写时机:NewProjectDialog 里用户改了 select 时调 saveUserPrefs
//  读时机:NewProjectDialog mount 时调 loadUserPrefs 取默认 + 置顶 id
// ====================================================================

const KEY_PREFIX = 'doopoo.userPrefs.'

export type UserPrefs = {
  /** 最近一次选的分镜图模型(sceneModel / storyboardModel) */
  lastSceneModel?: string
  /** 最近一次选的图像模型(目前和 sceneModel 同源,留作未来拆分) */
  lastImageModel?: string
  /** 最近一次选的视频模型 */
  lastVideoModel?: string
  /** 最近一次选的视觉风格 */
  lastStyle?: string
  /** 最近一次选的工作流 */
  lastWorkflow?: string
  /** 最近一次选的音频策略 */
  lastAudio?: 'on' | 'off'
  /** 上次更新 ISO 时间(用于审计 / 后续可能的"过期清理") */
  updatedAt?: string
}

function keyFor(userId: string): string {
  return KEY_PREFIX + userId
}

/** 读取某用户的所有偏好。未登录或读失败 → 空对象。 */
export function loadUserPrefs(userId: string | null | undefined): UserPrefs {
  if (!userId) return {}
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(keyFor(userId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as UserPrefs
    // 防御:只挑合法字段返回,防止 localStorage 被外部污染
    return {
      ...(typeof parsed.lastSceneModel === 'string' ? { lastSceneModel: parsed.lastSceneModel } : {}),
      ...(typeof parsed.lastImageModel === 'string' ? { lastImageModel: parsed.lastImageModel } : {}),
      ...(typeof parsed.lastVideoModel === 'string' ? { lastVideoModel: parsed.lastVideoModel } : {}),
      ...(typeof parsed.lastStyle === 'string' ? { lastStyle: parsed.lastStyle } : {}),
      ...(typeof parsed.lastWorkflow === 'string' ? { lastWorkflow: parsed.lastWorkflow } : {}),
      ...(parsed.lastAudio === 'on' || parsed.lastAudio === 'off'
        ? { lastAudio: parsed.lastAudio } : {}),
    }
  } catch {
    return {}
  }
}

/** 合并写入偏好。失败静默(localStorage 满了 / 隐私模式)。 */
export function saveUserPrefs(userId: string | null | undefined, patch: Partial<UserPrefs>): void {
  if (!userId) return
  if (typeof window === 'undefined') return
  try {
    const current = loadUserPrefs(userId)
    const next: UserPrefs = { ...current, ...patch, updatedAt: new Date().toISOString() }
    window.localStorage.setItem(keyFor(userId), JSON.stringify(next))
  } catch {
    // ignore — quota / disabled / SSR
  }
}

/** 清除某用户的偏好(注销账号 / 用户主动重置时用)。 */
export function clearUserPrefs(userId: string | null | undefined): void {
  if (!userId) return
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(keyFor(userId))
  } catch {
    // ignore
  }
}