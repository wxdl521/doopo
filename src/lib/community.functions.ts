import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type PostKind = "script" | "character" | "scene" | "prop" | "comic";
export type PostVisibility = "public" | "unlisted" | "private";

type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type CommunityPost = {
  id: string;
  user_id: string;
  kind: PostKind;
  source_id: string | null;
  title: string;
  summary: string | null;
  cover_gradient: string | null;
  payload: Json;
  visibility: PostVisibility;
  likes_count: number;
  views_count: number;
  created_at: string;
  updated_at: string;
};

const PublishSchema = z.object({
  kind: z.enum(["script", "character", "scene", "prop", "comic"]),
  sourceId: z.string().max(128).optional().nullable(),
  title: z.string().min(1).max(200),
  summary: z.string().max(2000).optional().nullable(),
  coverGradient: z.string().max(200).optional().nullable(),
  payload: z.any(),
  visibility: z.enum(["public", "unlisted", "private"]).default("public"),
});

export const publishPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PublishSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("community_posts")
      .insert({
        user_id: userId,
        kind: data.kind,
        source_id: data.sourceId ?? null,
        title: data.title,
        summary: data.summary ?? null,
        cover_gradient: data.coverGradient ?? null,
        payload: JSON.parse(JSON.stringify(data.payload ?? {})),
        visibility: data.visibility,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row as unknown as CommunityPost;
  });

export const updatePostVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        visibility: z.enum(["public", "unlisted", "private"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("community_posts")
      .update({ visibility: data.visibility })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deletePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("community_posts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const listCommunityPosts = createServerFn({ method: "GET" })
  .inputValidator((input) =>
    z
      .object({
        sort: z.enum(["recent", "hot", "likes"]).default("recent"),
        limit: z.number().int().min(1).max(60).default(24),
        kind: z.enum(["script", "character", "scene", "prop", "comic"]).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    let q = supabaseAdmin
      .from("community_posts")
      .select(
        "id,user_id,kind,source_id,title,summary,cover_gradient,visibility,likes_count,views_count,created_at,updated_at",
      )
      .eq("visibility", "public");
    if (data.kind) q = q.eq("kind", data.kind);
    // Fetch a bit more for hot sort, then re-rank in app.
    const fetchLimit = data.sort === "hot" ? Math.min(120, data.limit * 4) : data.limit;
    if (data.sort === "likes") q = q.order("likes_count", { ascending: false });
    else q = q.order("created_at", { ascending: false });
    try {
      const { data: rows, error } = await q.limit(fetchLimit);
      if (error) {
        console.error("[listCommunityPosts] supabase error:", error.message?.slice(0, 200));
        return [];
      }
      let result = (rows ?? []) as unknown as Omit<CommunityPost, "payload">[];
      if (data.sort === "hot") {
        const now = Date.now();
        result = [...result].sort((a, b) => score(b, now) - score(a, now)).slice(0, data.limit);
      }
      return result;
    } catch (e) {
      // Backend transiently unreachable (e.g. Cloudflare 522 HTML page). Degrade
      // gracefully so the home/community page renders instead of blank-screening.
      console.error(
        "[listCommunityPosts] backend unreachable:",
        (e as Error)?.message?.slice(0, 200),
      );
      return [];
    }
  });

function score(p: { likes_count: number; views_count: number; created_at: string }, now: number) {
  const hours = Math.max(0, (now - Date.parse(p.created_at)) / 3_600_000);
  return (p.likes_count * 3 + p.views_count) / Math.pow(hours + 2, 1.2);
}

export const getPost = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("community_posts")
      .select()
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    if ((row as { visibility: string }).visibility === "private") return null;
    return row as unknown as CommunityPost;
  });

export const toggleLike = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ postId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("post_likes")
      .select("post_id")
      .eq("post_id", data.postId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase
        .from("post_likes")
        .delete()
        .eq("post_id", data.postId)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("post_likes")
        .insert({ post_id: data.postId, user_id: userId });
      if (error) throw new Error(error.message);
    }
    const { data: row } = await supabaseAdmin
      .from("community_posts")
      .select("likes_count")
      .eq("id", data.postId)
      .maybeSingle();
    return { liked: !existing, likesCount: row?.likes_count ?? 0 };
  });

export const isLiked = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ postId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("post_likes")
      .select("post_id")
      .eq("post_id", data.postId)
      .eq("user_id", userId)
      .maybeSingle();
    return { liked: !!row };
  });

export const recordView = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        postId: z.string().uuid(),
        viewerKey: z.string().min(4).max(128),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    // Use admin to bypass RLS for anonymous views; UNIQUE constraint enforces dedup per day.
    await supabaseAdmin
      .from("post_views")
      .insert({ post_id: data.postId, viewer_key: data.viewerKey })
      .select("id")
      .maybeSingle();
    return { ok: true as const };
  });

export const listMyPosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("community_posts")
      .select(
        "id,user_id,kind,source_id,title,summary,cover_gradient,visibility,likes_count,views_count,created_at,updated_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Omit<CommunityPost, "payload">[];
  });
