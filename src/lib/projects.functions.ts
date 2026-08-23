import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { getWorkspaceMediaPath, WORKSPACE_MEDIA_BUCKET } from "./mediaUrl";

/**
 * 封面自愈：workspace-media 是私有 bucket，库里存的签名 URL 7 天后过期会裂图。
 * 读取时按对象路径重新签发；解析不出路径的三方临时链接原样返回（前端自行回落）。
 */
async function resignCover(supabase: any, url: string | null): Promise<string | null> {
  const path = getWorkspaceMediaPath(url);
  if (!path) return url ?? null;
  try {
    const { data, error } = await supabase.storage
      .from(WORKSPACE_MEDIA_BUCKET)
      .createSignedUrl(path, 604_800);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl as string;
  } catch {
    return null;
  }
}


const ProjectInput = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200).optional(),
  aspect: z.string().max(20).optional(),
  storyboardModel: z.string().max(100).optional(),
  sceneModel: z.string().max(100).optional(),
  videoModel: z.string().max(100).optional(),
  resolution: z.string().max(10).optional(),
  audio: z.enum(["on", "off"]).optional(),
  characterNationality: z.string().min(1).max(100).optional(),
  workflow: z.string().max(50).optional(),
  style: z.string().max(50).optional(),
  customStyle: z.string().max(2000).nullable().optional(),
  customCover: z.string().max(2000).nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
});

export type ProjectConfigRow = {
  id: string;
  name: string;
  aspect: string;
  storyboardModel: string;
  sceneModel: string;
  videoModel: string;
  resolution: string | null;
  audio: "on" | "off";
  characterNationality: string;
  workflow: string;
  style: string;
  customStyle: string | null;
  customCover: string | null;
  createdAt: string;
  updatedAt: string;
};

export const upsertProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ProjectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const row = {
      id: data.id,
      user_id: userId,
      ...(data.name !== undefined && { name: data.name }),
      ...(data.aspect !== undefined && { aspect: data.aspect }),
      ...(data.storyboardModel !== undefined && { storyboard_model: data.storyboardModel }),
      ...(data.sceneModel !== undefined && { scene_model: data.sceneModel }),
      ...(data.videoModel !== undefined && { video_model: data.videoModel }),
      ...(data.resolution !== undefined && { resolution: data.resolution }),
      ...(data.audio !== undefined && { audio: data.audio }),
      ...(data.characterNationality !== undefined && {
        character_nationality: data.characterNationality,
      }),
      ...(data.workflow !== undefined && { workflow: data.workflow }),
      ...(data.style !== undefined && { style: data.style }),
      ...(data.customStyle !== undefined && { custom_style: data.customStyle }),
      ...(data.customCover !== undefined && { custom_cover: data.customCover }),
      ...(data.teamId !== undefined && { team_id: data.teamId }),
      ...(data.groupId !== undefined && { group_id: data.groupId }),
    };
    const { error } = await supabase.from("projects").upsert(row, { onConflict: "id" });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const getProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("projects")
      .select(
        "id,name,aspect,storyboard_model,scene_model,video_model,audio,character_nationality,workflow,style,custom_style,custom_cover,resolution,created_at,updated_at",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (error) return { project: null, error: error.message };
    if (!row) return { project: null, error: null as string | null };
    const project: ProjectConfigRow = {
      id: row.id,
      name: row.name,
      aspect: row.aspect,
      storyboardModel: row.storyboard_model,
      sceneModel: row.scene_model,
      videoModel: row.video_model,
      resolution: row.resolution ?? null,
      audio: row.audio as "on" | "off",
      characterNationality: row.character_nationality ?? "中国",
      workflow: row.workflow,
      style: row.style,
      customStyle: row.custom_style ?? null,
      customCover: await resignCover(supabase, row.custom_cover),

      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    return { project, error: null as string | null };
  });

// ====================================================================
// listMyProjects —— 当前用户的项目列表(只列 user_id = 自己 的)
// 用于 /projects 页和 Home 页"最近项目"区。
// 不返回 workspace_data 全文(可能很大),只返回摘要字段。
// status 推断:从 completed_stages 长度 + workspace_data 内容判断
// ====================================================================

export type ProjectListItem = {
  id: string;
  name: string;
  customCover: string | null;
  createdAt: string;
  updatedAt: string;
  completedStages: string[];
  /** 计算字段:draft / rendering / ready */
  status: "draft" | "rendering" | "ready";
  /**
   * 自动从 workspace_data 里挑出来的缩略图 URL(故事板图 → 分镜图 → 角色图)。
   * 客户端会优先用 customCover → thumbnail → 渐变占位 三级 fallback。
   */
  thumbnail: string | null;
};

const ALL_STAGES = ["canvas", "script", "character", "storyboard", "timeline"] as const;

function inferStatus(row: { completed_stages: string[] }): "draft" | "rendering" | "ready" {
  const done = (row.completed_stages ?? []).length;
  if (done >= ALL_STAGES.length) return "ready";
  if (done === 0) return "draft";
  return "rendering";
}

/**
 * 从 workspace_data JSON 里挑缩略图。
 * 优先级:
 *   1. groupStoryboards(漫剧故事板图,故事板流程生成) — groupId 任意取第 1 个 succeeded
 *   2. shotImages(分镜图) — `${groupId}::${shotId}` key,取第 1 个数组的第 1 张
 *   3. charImages(角色图) — imageKey,取第 1 个数组的第 1 张
 *   4. panelImages(旧版分镜) — 取第 1 个 value
 *   5. sceneImages(场景图) — 取第 1 个数组的第 1 张
 * 返回 URL 字符串,没有则 null。
 */
function pickThumbnail(ws: any): string | null {
  if (!ws || typeof ws !== "object") return null;
  // 1) 故事板图
  const sb = ws.groupStoryboards;
  if (sb && typeof sb === "object") {
    for (const gid of Object.keys(sb)) {
      const v = sb[gid];
      if (
        v &&
        typeof v === "object" &&
        v.status === "succeeded" &&
        typeof v.url === "string" &&
        v.url
      ) {
        return v.url;
      }
    }
  }
  // 2) 分镜图(shotImages 是 `${groupId}::${shotId}` → url[])
  const shots = ws.shotImages;
  if (shots && typeof shots === "object") {
    for (const k of Object.keys(shots)) {
      const arr = shots[k];
      if (Array.isArray(arr) && arr.length && typeof arr[0] === "string") return arr[0];
    }
  }
  // 3) 角色图
  const chars = ws.charImages;
  if (chars && typeof chars === "object") {
    for (const k of Object.keys(chars)) {
      const arr = chars[k];
      if (Array.isArray(arr) && arr.length && typeof arr[0] === "string") return arr[0];
    }
  }
  // 4) 旧版分镜图
  const panels = ws.panelImages;
  if (panels && typeof panels === "object") {
    for (const k of Object.keys(panels)) {
      const v = panels[k];
      if (typeof v === "string" && v) return v;
    }
  }
  // 5) 场景图
  const scenes = ws.sceneImages;
  if (scenes && typeof scenes === "object") {
    for (const k of Object.keys(scenes)) {
      const arr = scenes[k];
      if (Array.isArray(arr) && arr.length && typeof arr[0] === "string") return arr[0];
    }
  }
  return null;
}

export const listMyProjects = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async () => {
    const authorization = getRequestHeader("authorization");
    if (!authorization?.toLowerCase().startsWith("bearer ")) {
      return { projects: [] as ProjectListItem[], error: null as string | null };
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return { projects: [] as ProjectListItem[], error: "Backend configuration is missing" };
    }

    const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
      auth: {
        storage: undefined,
        persistSession: false,
        autoRefreshToken: false,
      },
      global: { headers: { Authorization: authorization } },
    });

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return { projects: [] as ProjectListItem[], error: null as string | null };
    }

    const { data, error } = await supabase
      .from("projects")
      // NOTE: workspace_data is intentionally NOT selected here — it's a large
      // JSONB blob and pulling it for every row caused Postgres statement_timeout
      // on accounts with many / heavy projects. Thumbnails fall back to
      // customCover → gradient on the client.
      .select("id,name,custom_cover,created_at,updated_at,completed_stages")
      // 不按 user_id 过滤:RLS 现在编码了可见性(个人项目 + 团队/组共享项目),
      // 团队/组成员能看到共享给自己的项目。
      .order("updated_at", { ascending: false });
    if (error) return { projects: [] as ProjectListItem[], error: error.message };
    const projects: ProjectListItem[] = (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      customCover: row.custom_cover,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedStages: row.completed_stages ?? [],
      status: inferStatus({ completed_stages: row.completed_stages ?? [] }),
      thumbnail: null,
    }));
    return { projects, error: null as string | null };
  });

// ====================================================================
// renameProject —— 改名。只允许改自己 user_id 的项目(RLS + 中间件双重保险)。
// ====================================================================

export const renameProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("projects")
      .update({ name: data.name, updated_at: new Date().toISOString() })
      .eq("id", data.id) // RLS 编码可见性:组内项目同组成员可改
      .select("id")
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!row) return { ok: false as const, error: "project not found or no permission" };
    return { ok: true as const, error: null as string | null };
  });

// ====================================================================
// deleteProject —— 删除项目(workspace_data / cover 等会一起被删)。
// 这里**不级联删 workspace-media bucket 里的文件**(用户可能想保留旧素材),
// 如果要彻底清理可以再加个 server fn 跑 supabase.storage.remove。
// ====================================================================

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error, count } = await supabase
      .from("projects")
      .delete({ count: "exact" })
      .eq("id", data.id); // RLS 编码可见性:组内项目同组成员可删
    if (error) return { ok: false as const, error: error.message };
    if (count === 0) return { ok: false as const, error: "project not found or no permission" };
    return { ok: true as const, error: null as string | null };
  });

// ====================================================================
// deleteAllMyProjects —— 清空当前用户所有项目。
// 这是破坏性操作,UI 端必须用强确认 modal(二次输入项目名 / 勾选框等)。
// RLS 自动按 user_id 过滤,不会误删别人的。
// 这里**不级联删 workspace-media bucket 里的文件**(老素材保留)。
// ====================================================================

export const deleteAllMyProjects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  // 客户端必须传 confirm: true 作为"二次确认",避免被误触发
  .validator((input: unknown) =>
    z
      .object({
        confirm: z.literal(true),
      })
      .parse(input),
  )
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error, count } = await supabase
      .from("projects")
      .delete({ count: "exact" })
      .eq("user_id", userId);
    if (error) return { ok: false as const, error: error.message, deletedCount: 0 };
    return { ok: true as const, error: null as string | null, deletedCount: count ?? 0 };
  });

// ===== Workspace data persistence =====

export const saveWorkspaceData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().min(1).max(64),
        workspaceData: z.record(z.string(), z.unknown()),
        completedStages: z.array(z.string()),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // 2026/08:字段级合并（merge_workspace_data RPC,jsonb || patch）——patch 里
    // 没有的键保留数据库旧值,杜绝「某段未加载 → 整列覆盖成空数组」的丢失。
    // SQL 在 supabase/manual/20260818060000_merge_workspace_data.sql,需手动执行;
    // 函数不存在(PGRST202/42883)时回退旧的整列覆盖,前端守卫此时仍阻断丢失。
    // 函数类型未进生成的 Database 类型(supabase/manual SQL 手动执行后才存在),
    // 与既有 (supabaseAdmin.from as any) 同款收窄。
    const merged = await (supabase.rpc as any)("merge_workspace_data", {
      p_project_id: data.id,
      p_patch: data.workspaceData as any,
      p_completed_stages: data.completedStages,
    }) as { error: { message: string } | null };
    if (!merged.error) return { ok: true as const, error: null as string | null };
    const rpcMissing = /PGRST202|42883|does not exist|could not find/i.test(merged.error.message);
    if (!rpcMissing) return { ok: false as const, error: merged.error.message };
    console.warn(
      "[saveWorkspaceData] merge_workspace_data RPC 不存在（SQL 未执行?）,回退整列覆盖",
    );
    const { error } = await supabase
      .from("projects")
      .update({
        workspace_data: data.workspaceData as any,
        completed_stages: data.completedStages,
      })
      .eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, error: null as string | null };
  });

export const loadWorkspaceData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // workspace_data may contain years of image/video history. Selecting the
    // whole JSONB document has timed out in Postgres, so fetch editable project
    // content first; media is restored by loadWorkspaceMedia below.
    const { data: row, error } = await supabase
      .from("projects")
      .select(
        "completed_stages,outline:workspace_data->outline,scenes:workspace_data->scenes,characters:workspace_data->characters,props:workspace_data->props,timeline:workspace_data->timeline,synopsisText:workspace_data->synopsisText,episodeTexts:workspace_data->episodeTexts,savedAssetKeys:workspace_data->savedAssetKeys,selectedEpisodeIndex:workspace_data->selectedEpisodeIndex,audioRoles:workspace_data->audioRoles",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (error)
      return {
        workspaceData: null as Record<string, string> | null,
        completedStages: null as string[] | null,
        error: error.message,
      };
    if (!row)
      return {
        workspaceData: null as Record<string, string> | null,
        completedStages: null as string[] | null,
        error: null as string | null,
      };
    const fields = row as unknown as Record<string, any>;
    return {
      workspaceData: {
        outline: fields.outline,
        scenes: fields.scenes,
        characters: fields.characters,
        props: fields.props,
        timeline: fields.timeline,
        synopsisText: fields.synopsisText,
        episodeTexts: fields.episodeTexts,
        savedAssetKeys: fields.savedAssetKeys,
        selectedEpisodeIndex: fields.selectedEpisodeIndex,
        // 画外音/旁白的音频角色（689a418 拆分）；缺失时 undefined 保持旧项目兼容
        audioRoles: fields.audioRoles,
      } as Record<string, any>,
      completedStages: (fields.completed_stages ?? []) as string[],
      error: null as string | null,
    };
  });

/**
 * Storyboard groups can carry historical image URLs and are therefore read
 * independently. A timeout here must never prevent scripts or assets from
 * opening in the workspace.
 */
export const loadWorkspaceStoryboardStructure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("projects")
      .select(
        "storyboard:workspace_data->storyboard,storyboardGroups:workspace_data->storyboardGroups",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (error) {
      return { workspaceData: null as Record<string, any> | null, error: error.message };
    }
    return {
      workspaceData: (row ?? {}) as Record<string, any>,
      error: null as string | null,
    };
  });

/**
 * Restore the large media maps separately so a single oversized JSONB value
 * cannot stop scripts, characters, or scenes from opening.
 */
export const loadWorkspaceMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("projects")
      .select(
        "charImages:workspace_data->charImages,charImagePrompts:workspace_data->charImagePrompts,shotImages:workspace_data->shotImages,sceneImages:workspace_data->sceneImages,sceneImagePrompts:workspace_data->sceneImagePrompts,propImages:workspace_data->propImages,propImagePrompts:workspace_data->propImagePrompts,panelImages:workspace_data->panelImages,selectedCharImages:workspace_data->selectedCharImages,selectedSceneImages:workspace_data->selectedSceneImages,selectedPropImages:workspace_data->selectedPropImages,groupVideos:workspace_data->groupVideos,groupStoryboards:workspace_data->groupStoryboards",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (error) {
      return { workspaceData: null as Record<string, any> | null, error: error.message };
    }
    if (!row) {
      return {
        workspaceData: null as Record<string, any> | null,
        error: null as string | null,
      };
    }
    const fields = row as unknown as Record<string, any>;
    return {
      workspaceData: fields,
      error: null as string | null,
    };
  });
