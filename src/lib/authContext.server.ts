// ====================================================================
//  getOptionalAuthCtx -- 在非中间件位置(生图 helper)自助获取当前登录用户
//
//  背景:生图 server fn(generateImage 等)没有 requireSupabaseAuth 中间件,
//  callTokenflashImage / callRevoraImage / callAzureImage 这些 helper 拿不到
//  userId/supabase,无法直接扣分。本函数复用 requireSupabaseAuth 的鉴权逻辑
//  (getRequest + Bearer token + getClaims),但未登录/无效时返回 null 而非抛异常,
//  让 helper 能"有则扣、无则跳过"。
//
//  注意:依赖 TanStack Start 请求上下文在 server fn 调用链内可用 ——
//  requireSupabaseAuth 中间件同样用 getRequest(),helper 被同一请求链调用,可行。
// ====================================================================

import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type AuthCtx = { userId: string; supabase: ReturnType<typeof createClient<Database>> };

/** 获取当前请求的登录用户上下文。未登录/无效/异常 -> null(不抛) */
export async function getOptionalAuthCtx(): Promise<AuthCtx | null> {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;

    const request = getRequest();
    if (!request?.headers) return null;
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.replace("Bearer ", "");
    if (!token) return null;

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) return null;
    return { userId: data.claims.sub, supabase };
  } catch {
    return null;
  }
}
