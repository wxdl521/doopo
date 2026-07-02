import { supabase } from "@/integrations/supabase/client";
import type { GenCharacter, GenScene, GenProp } from "@/data/workspaceGenerators";
import type { Tables, Json } from "@/integrations/supabase/types";

export type DbCharacter = Tables<"characters">;
export type DbScene = Tables<"scenes">;
export type DbProp = Tables<"props">;

export type CharacterImageEntry = {
  url: string;
  label: string;
};

export type PropImageEntry = {
  url: string;
  label: string;
};

type AssetTable = "characters" | "scenes" | "props";
type AssetRecord = Record<string, unknown> & { id: string; user_id: string };

/**
 * 资产库保存不要直接 upsert。
 * 根因:旧表曾以 id 做全局主键,不同用户/旧项目生成相同 id 时,upsert 会命中
 * 别人的旧行并尝试 UPDATE,随后被 RLS 的 USING 拒绝,报
 * "new row violates row-level security policy (USING expression)"。
 * 这里先只更新当前用户自己的行;没有命中再插入当前用户的新行,避免跨用户冲突。
 */
async function saveOwnAssetRecord(
  table: AssetTable,
  record: AssetRecord,
): Promise<{ ok: boolean; error?: string }> {
  const updateQuery = supabase.from(table) as any;
  const { data: updated, error: updateError } = await updateQuery
    .update(record)
    .eq("user_id", record.user_id)
    .eq("id", record.id)
    .select("id")
    .maybeSingle();

  if (updateError) return { ok: false, error: updateError.message };
  if (updated) return { ok: true };

  const insertQuery = supabase.from(table) as any;
  const { error: insertError } = await insertQuery.insert(record);
  if (!insertError) return { ok: true };

  // 同一用户快速重复点击时可能先后插入同一行;再按用户范围更新一次兜底。
  if (insertError.code === "23505") {
    const retryQuery = supabase.from(table) as any;
    const { error: retryError } = await retryQuery
      .update(record)
      .eq("user_id", record.user_id)
      .eq("id", record.id);
    if (!retryError) return { ok: true };
    return { ok: false, error: retryError.message };
  }

  return { ok: false, error: insertError.message };
}

/**
 * 把 GenCharacter 转换成 characters 表的 upsert 记录。
 * coverUrl 可选 —— 调用方传入角色的最新图片 URL(同步持久化到 assets 库)。
 * images 可选 —— 角色所有已生成的图片数组(含标签),详情页动态展示。
 */
function charToRecord(
  c: GenCharacter,
  userId: string,
  coverUrl?: string | null,
  images?: CharacterImageEntry[],
) {
  return {
    id: c.id,
    user_id: userId,
    name: c.name,
    role: c.role,
    role_label: c.roleLabel,
    age: c.age,
    look: [c.faceDescription, c.bodyDescription, c.clothingDescription].filter(Boolean).join(" / "),
    personality: c.personality,
    motivation: null,
    debut_shot: null,
    palette: c.palette,
    mbti: c.mbti ?? null,
    key_prop: c.keyProp ?? null,
    gradient: c.swatch,
    cover_url: coverUrl ?? null,
    images: (images ?? null) as Json | null,
  };
}

/**
 * 把 GenScene 转换成 scenes 表的 upsert 记录。
 */
function sceneToRecord(s: GenScene, userId: string, coverUrl?: string | null) {
  return {
    id: s.id,
    user_id: userId,
    name: s.slug.split("—")[0].trim() || s.location,
    location: s.location,
    time_of_day: s.timeOfDay,
    action: s.action,
    beats: s.beats,
    dialogue: s.dialogue as unknown as Json,
    gradient: null,
    cover_url: coverUrl ?? null,
  };
}

/** 批量保存(保留旧行为,cover_url 传 null) */
export async function saveCharacters(chars: GenCharacter[], userId: string) {
  const records = chars.map((c) => charToRecord(c, userId, null));
  for (const record of records) {
    const result = await saveOwnAssetRecord("characters", record);
    if (!result.ok) return { data: null, error: { message: result.error ?? "保存角色失败" } };
  }
  return { data: null, error: null };
}

export async function saveScenes(scenes: GenScene[], userId: string) {
  const records = scenes.map((s) => sceneToRecord(s, userId, null));
  for (const record of records) {
    const result = await saveOwnAssetRecord("scenes", record);
    if (!result.ok) return { data: null, error: { message: result.error ?? "保存场景失败" } };
  }
  return { data: null, error: null };
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
  const record = charToRecord(c, userId, coverUrl, images);
  return saveOwnAssetRecord("characters", record);
}

export async function saveOneScene(
  s: GenScene,
  userId: string,
  coverUrl?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const record = sceneToRecord(s, userId, coverUrl);
  return saveOwnAssetRecord("scenes", record);
}

/**
 * 把 GenProp 转换成 props 表的 upsert 记录。
 */
function propToRecord(
  p: GenProp,
  userId: string,
  coverUrl?: string | null,
  images?: PropImageEntry[],
) {
  return {
    id: p.id,
    user_id: userId,
    name: p.name,
    description: p.description,
    movement_description: p.movementDescription,
    key_moments: p.keyMoments,
    palette: p.palette,
    cover_url: coverUrl ?? null,
    images: (images ?? null) as Json | null,
  };
}

export async function saveOneProp(
  p: GenProp,
  userId: string,
  coverUrl?: string | null,
  images?: PropImageEntry[],
): Promise<{ ok: boolean; error?: string }> {
  const record = propToRecord(p, userId, coverUrl, images);
  return saveOwnAssetRecord("props", record);
}

export async function deleteProp(id: string, userId: string) {
  return supabase.from("props").delete().eq("id", id).eq("user_id", userId);
}

export async function loadProps(userId: string) {
  return supabase.from("props").select("*").eq("user_id", userId);
}

/** 从资产库移除单条角色/场景(per-item 删除按钮用) */
export async function deleteCharacter(id: string, userId: string) {
  return supabase.from("characters").delete().eq("id", id).eq("user_id", userId);
}

export async function deleteScene(id: string, userId: string) {
  return supabase.from("scenes").delete().eq("id", id).eq("user_id", userId);
}

export async function loadCharacters(userId: string) {
  return supabase.from("characters").select("*").eq("user_id", userId);
}

export async function loadScenes(userId: string) {
  return supabase.from("scenes").select("*").eq("user_id", userId);
}
