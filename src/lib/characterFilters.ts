// ====================================================================
//  跨集角色过滤 / 工具 (2026/06 多形象 + 跨集一致性 改造)
//
//  包含 4 个 util:
//    filterByEpisode(chars, ep)        — 原 c.episodeIndex === ep 替代品
//    groupByMatchKey(chars)             — 同 matchKey 折叠(全局视图用)
//    getEffectiveClothing(c, ep)        — 读 per-episode override,fallback 主字段
//    getEffectiveRoleLabel(c, ep)       — 同上,roleLabel 版
//
//  这些是纯函数,无 React 依赖,可在客户端组件 / server fn / 测试中复用。
// ====================================================================

import type { GenCharacter } from '../data/workspaceGenerators'

/** 单集过滤(替代旧的 `c.episodeIndex === ep` 写法) */
export function filterByEpisode(chars: GenCharacter[], ep: number): GenCharacter[] {
  return chars.filter((c) => c.episodes.includes(ep))
}

/**
 * 跨集聚合 —— 同 matchKey 折叠为一条。
 * 用于"全局视图"或合并旧数据时去重。
 * 字段合并策略:face/body/personality 取更详细的(非空优先),
 * episodes 取并集排序,siblingGroupId 取非空。
 */
export function groupByMatchKey(chars: GenCharacter[]): GenCharacter[] {
  const seen = new Map<string, GenCharacter>()
  for (const c of chars) {
    const exist = seen.get(c.matchKey)
    if (!exist) {
      seen.set(c.matchKey, c)
    } else {
      seen.set(c.matchKey, {
        ...exist,
        episodes: Array.from(new Set([...exist.episodes, ...c.episodes])).sort((a, b) => a - b),
        // 字段:优先用更长的(更详细)那个
        faceDescription: c.faceDescription || exist.faceDescription,
        bodyDescription: c.bodyDescription || exist.bodyDescription,
        clothingDescription: c.clothingDescription || exist.clothingDescription,
        personality: c.personality || exist.personality,
        // 其他元数据
        roleLabel: c.roleLabel || exist.roleLabel,
        palette: c.palette?.length ? c.palette : exist.palette,
        siblingGroupId: c.siblingGroupId ?? exist.siblingGroupId,
      })
    }
  }
  return Array.from(seen.values())
}

/** 读取"当集生效的 clothingDescription",有 override 用 override */
export function getEffectiveClothing(c: GenCharacter, ep: number): string {
  return c.perEpisodeClothingOverrides?.[ep]?.clothingDescription ?? c.clothingDescription
}

/** 读取"当集生效的 roleLabel",有 override 用 override */
export function getEffectiveRoleLabel(c: GenCharacter, ep: number): string {
  return c.perEpisodeClothingOverrides?.[ep]?.roleLabel ?? c.roleLabel
}
