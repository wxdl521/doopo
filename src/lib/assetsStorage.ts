import { supabase } from '@/integrations/supabase/client'
import type { GenCharacter, GenScene } from '@/data/workspaceGenerators'
import type { Tables, Json } from '@/integrations/supabase/types'

export type DbCharacter = Tables<'characters'>
export type DbScene = Tables<'scenes'>

export type CharacterImageEntry = {
  url: string
  label: string
}

/**
 * 把 GenCharacter 转换成 characters 表的 upsert 记录。
 * coverUrl 可选 —— 调用方传入角色的最新图片 URL(同步持久化到 assets 库)。
 * images 可选 —— 角色所有已生成的图片数组(含标签),详情页动态展示。
 */
function charToRecord(c: GenCharacter, userId: string, coverUrl?: string | null, images?: CharacterImageEntry[]) {
  return {
    id: c.id,
    user_id: userId,
    name: c.name,
    role: c.role,
    role_label: c.roleLabel,
    age: c.age,
    look: [c.faceDescription, c.bodyDescription, c.clothingDescription]
      .filter(Boolean)
      .join(' / '),
    personality: c.personality,
    motivation: null,
    debut_shot: null,
    palette: c.palette,
    mbti: c.mbti ?? null,
    key_prop: c.keyProp ?? null,
    gradient: c.swatch,
    cover_url: coverUrl ?? null,
    images: (images ?? null) as Json | null,
  }
}

/**
 * 把 GenScene 转换成 scenes 表的 upsert 记录。
 */
function sceneToRecord(s: GenScene, userId: string, coverUrl?: string | null) {
  return {
    id: s.id,
    user_id: userId,
    name: s.slug.split('—')[0].trim() || s.location,
    location: s.location,
    time_of_day: s.timeOfDay,
    action: s.action,
    beats: s.beats,
    dialogue: s.dialogue as unknown as Json,
    gradient: null,
    cover_url: coverUrl ?? null,
  }
}

/** 批量保存(保留旧行为,cover_url 传 null) */
export async function saveCharacters(chars: GenCharacter[], userId: string) {
  const records = chars.map((c) => charToRecord(c, userId, null))
  return supabase.from('characters').upsert(records)
}

export async function saveScenes(scenes: GenScene[], userId: string) {
  const records = scenes.map((s) => sceneToRecord(s, userId, null))
  return supabase.from('scenes').upsert(records)
}

/**
 * 2026/06 新增:per-item 保存单个角色到资产库。
 *  - c: GenCharacter
 *  - coverUrl: 当前角色的主图 URL(从 charImages 里挑)
 *  - images: 角色所有已生成的图片 URL + 标签数组,详情页动态展示
 * 成功时返回 { ok: true },失败返回错误信息。
 */
export async function saveOneCharacter(
  c: GenCharacter,
  userId: string,
  coverUrl?: string | null,
  images?: CharacterImageEntry[],
): Promise<{ ok: boolean; error?: string }> {
  const record = charToRecord(c, userId, coverUrl, images)
  const { error } = await supabase.from('characters').upsert(record)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function saveOneScene(
  s: GenScene,
  userId: string,
  coverUrl?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const record = sceneToRecord(s, userId, coverUrl)
  const { error } = await supabase.from('scenes').upsert(record)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** 从资产库移除单条角色/场景(per-item 删除按钮用) */
export async function deleteCharacter(id: string, userId: string) {
  return supabase.from('characters').delete().eq('id', id).eq('user_id', userId)
}

export async function deleteScene(id: string, userId: string) {
  return supabase.from('scenes').delete().eq('id', id).eq('user_id', userId)
}

export async function loadCharacters(userId: string) {
  return supabase.from('characters').select('*').eq('user_id', userId)
}

export async function loadScenes(userId: string) {
  return supabase.from('scenes').select('*').eq('user_id', userId)
}