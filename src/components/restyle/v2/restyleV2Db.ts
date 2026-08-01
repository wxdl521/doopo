// ====================================================================
//  转绘 v2 —— 项目 / 集的浏览器端读写
//
//  restyle_projects / restyle_episodes 尚未进生成的 Database 类型
//  （见 supabase/migrations/20260801120000_create_restyle_v2_tables.sql），
//  类型放宽集中在本文件，组件里不出现 as any。
//  RLS 为 owner-only（user_id = auth.uid()），浏览器端直连即可。
// ====================================================================

import { supabase } from "@/integrations/supabase/client";

export interface RestyleV2Project {
  id: string;
  title: string;
  style_brief: string | null;
  stage: string;
  created_at: string | null;
}

export interface RestyleV2Episode {
  id: string;
  project_id: string;
  episode_no: number;
  source_media_url: string | null;
  duration_sec: number | null;
  analysis_status: string;
  analysis_error: string | null;
  review_status: string;
  created_at: string | null;
}

export type DbResult<T> = { ok: true; data: T } | { ok: false; error: string };

// 表未进生成类型，统一在此放宽。
const db = supabase as any;

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

function errMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export async function listV2Projects(): Promise<DbResult<RestyleV2Project[]>> {
  const { data, error } = await db
    .from("restyle_projects")
    .select("id, title, style_brief, stage, created_at")
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: errMessage(error) };
  return { ok: true, data: (data ?? []) as RestyleV2Project[] };
}

export async function createV2Project(
  title: string,
  styleBrief: string,
): Promise<DbResult<RestyleV2Project>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "未登录，无法创建项目。" };
  const row = {
    id: `rp_${crypto.randomUUID()}`,
    user_id: userId,
    title: title.trim(),
    style_brief: styleBrief.trim() || null,
    stage: "analysis",
  };
  const { data, error } = await db.from("restyle_projects").insert(row).select().single();
  if (error) return { ok: false, error: errMessage(error) };
  return { ok: true, data: data as RestyleV2Project };
}

export async function listV2Episodes(
  projectId: string,
): Promise<DbResult<RestyleV2Episode[]>> {
  const { data, error } = await db
    .from("restyle_episodes")
    .select(
      "id, project_id, episode_no, source_media_url, duration_sec, analysis_status, analysis_error, review_status, created_at",
    )
    .eq("project_id", projectId)
    .order("episode_no", { ascending: true });
  if (error) return { ok: false, error: errMessage(error) };
  return { ok: true, data: (data ?? []) as RestyleV2Episode[] };
}

export async function createV2Episode(
  projectId: string,
  episodeNo: number,
): Promise<DbResult<RestyleV2Episode>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "未登录，无法创建集。" };
  const row = {
    id: `ep_${crypto.randomUUID()}`,
    user_id: userId,
    project_id: projectId,
    episode_no: episodeNo,
  };
  const { data, error } = await db.from("restyle_episodes").insert(row).select().single();
  if (error) return { ok: false, error: errMessage(error) };
  return { ok: true, data: data as RestyleV2Episode };
}

/** 集的单元状态（restyle_episodes.analysis_units，用于定位失败单元重跑）。 */
export interface EpisodeUnitState {
  unitId: string;
  status: string;
  error?: string | null;
}

export async function listV2EpisodeUnitStates(
  episodeId: string,
): Promise<DbResult<EpisodeUnitState[]>> {
  const { data, error } = await db
    .from("restyle_episodes")
    .select("analysis_units")
    .eq("id", episodeId)
    .maybeSingle();
  if (error) return { ok: false, error: errMessage(error) };
  const units = Array.isArray(data?.analysis_units) ? (data.analysis_units as EpisodeUnitState[]) : [];
  return { ok: true, data: units };
}

/** 媒体处理完成后回写源视频地址与时长。 */
export async function updateV2EpisodeMedia(
  episodeId: string,
  sourceMediaUrl: string,
  durationSec: number,
): Promise<DbResult<null>> {
  const { error } = await db
    .from("restyle_episodes")
    .update({
      source_media_url: sourceMediaUrl,
      duration_sec: durationSec,
      updated_at: new Date().toISOString(),
    })
    .eq("id", episodeId);
  if (error) return { ok: false, error: errMessage(error) };
  return { ok: true, data: null };
}
