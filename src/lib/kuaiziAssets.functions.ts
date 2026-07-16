// ====================================================================
// 筷子科技（丽帧）素材资产库
//
// OpenAPI 不接收文件二进制，只登记可从公网下载的 URL。因此调用方必须先把
// 生成图持久化到 COS/CDN 或 Supabase Storage，再调用本文件的 Server Function。
// 筷子账户由 KUAIZI_API_KEY 统一管理；ApiKey 永远不下发到浏览器。
// ====================================================================

import "./loadEnv";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const KUAIZI_DEFAULT_BASE_URL = "https://aiopenapi.kuaizi.cn";
const KUAIZI_ASSET_PATH = "/ai-open-platform-api/v1/asset";

type AssetKind = "character" | "scene" | "prop";
type KuaiziAsset = {
  id?: unknown;
  sync_status?: unknown;
  sync_error?: unknown;
};

function getKuaiziConfig() {
  return {
    apiKey: process.env.KUAIZI_API_KEY,
    baseUrl: (process.env.KUAIZI_BASE_URL || KUAIZI_DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

function assetGroupName(kind: AssetKind): string {
  const label = { character: "角色", scene: "场景", prop: "道具" }[kind];
  return `Doopoo · ${label}素材`;
}

/**
 * 筷子资产 ID 为 uint64，实际值已超过 JavaScript 的安全整数范围；必须保留为字符串。
 * 请求体序列化时会再将它写成未加引号的 JSON 数字，兼容接口的 uint64 参数定义。
 */
function toUint64Id(value: unknown): string | null {
  if (typeof value === "string" && /^[1-9]\d{0,19}$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}

function toSyncStatus(value: unknown): number {
  const status = typeof value === "number" ? value : Number(value);
  return Number.isInteger(status) && status >= 0 && status <= 4 ? status : 0;
}

async function kuaiziPost<T>(
  apiKey: string,
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ApiKey: apiKey },
      // `id` / `group_id` 是 uint64。JSON.stringify 会把字符串包上引号，而多数
      // Go 网关会严格要求 JSON number；先安全标记，再仅替换这两个受控字段。
      body: JSON.stringify(body, (key, value) =>
        (key === "id" || key === "group_id") &&
        typeof value === "string" &&
        /^[1-9]\d{0,19}$/.test(value)
          ? `__KUAIZI_UINT64__${value}`
          : value,
      ).replace(/"__KUAIZI_UINT64__(\d{1,20})"/g, "$1"),
      signal: controller.signal,
    });
    const text = await response.text().catch(() => "");
    let payload: { code?: unknown; message?: unknown; data?: T } = {};
    try {
      payload = JSON.parse(text);
    } catch {
      // 非 JSON 错误仍在下方以精简文本返回，避免把完整上游响应暴露给前端。
    }
    if (!response.ok) {
      return { ok: false, error: `[kuaizi] HTTP ${response.status}: ${text.slice(0, 200)}` };
    }
    if (payload.code !== 0) {
      const message = typeof payload.message === "string" ? payload.message : text.slice(0, 200);
      return { ok: false, error: `[kuaizi] ${message || "素材库请求失败"}` };
    }
    return { ok: true, data: (payload.data ?? {}) as T };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "请求超时（30 秒）"
        : error instanceof Error
          ? error.message
          : "网络请求失败";
    return { ok: false, error: `[kuaizi] ${message}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function findOrCreateGroup(
  apiKey: string,
  baseUrl: string,
  kind: AssetKind,
): Promise<{ ok: true; groupId: string } | { ok: false; error: string }> {
  const groupName = assetGroupName(kind);
  const listed = await kuaiziPost<{
    list?: Array<{ id?: unknown; group_name?: unknown; group_status?: unknown }>;
  }>(apiKey, baseUrl, `${KUAIZI_ASSET_PATH}/group/list`, {
    keyword: groupName,
    group_type: 1,
    page: 1,
    page_size: 100,
  });
  if (!listed.ok) return listed;

  const existing = (listed.data.list ?? []).find((group) => group.group_name === groupName);
  if (existing) {
    const groupId = toUint64Id(existing.id);
    if (!groupId) return { ok: false, error: "[kuaizi] 素材组 ID 无效" };
    if (Number(existing.group_status) !== 1) {
      return { ok: false, error: `[kuaizi] 素材组「${groupName}」当前不可用` };
    }
    return { ok: true, groupId };
  }

  const created = await kuaiziPost<{ id?: unknown }>(
    apiKey,
    baseUrl,
    `${KUAIZI_ASSET_PATH}/group/create`,
    { group_name: groupName, description: `Doopoo 工作区${groupName}`, group_type: 1 },
  );
  if (!created.ok) return created;
  const groupId = toUint64Id(created.data.id);
  return groupId
    ? { ok: true, groupId }
    : { ok: false, error: "[kuaizi] 创建素材组后未返回有效 ID" };
}

async function getAsset(
  apiKey: string,
  baseUrl: string,
  assetId: string,
): Promise<{ ok: true; asset: KuaiziAsset } | { ok: false; error: string }> {
  const result = await kuaiziPost<{ asset?: KuaiziAsset }>(
    apiKey,
    baseUrl,
    `${KUAIZI_ASSET_PATH}/get`,
    { id: assetId },
  );
  if (!result.ok) return result;
  return result.data.asset
    ? { ok: true, asset: result.data.asset }
    : { ok: false, error: "[kuaizi] 未返回素材详情" };
}

const KuaiziAssetUploadInput = z.object({
  url: z
    .string()
    .url()
    .max(4_000)
    .refine((value) => /^https?:\/\//i.test(value), "素材 URL 必须为公网 HTTP(S) 地址"),
  kind: z.enum(["character", "scene", "prop"]),
  name: z.string().trim().min(1).max(200),
});

/**
 * 将工作区中已持久化的角色、场景或道具图登记到筷子素材库。
 * 接口创建成功只代表已入库；syncStatus=2 才代表已同步到火山引擎。
 */
export const uploadKuaiziAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => KuaiziAssetUploadInput.parse(input))
  .handler(async ({ data }) => {
    const { apiKey, baseUrl } = getKuaiziConfig();
    if (!apiKey) return { ok: false as const, error: "[kuaizi] 缺少 KUAIZI_API_KEY" };

    const group = await findOrCreateGroup(apiKey, baseUrl, data.kind);
    if (!group.ok) return { ok: false as const, error: group.error };

    const created = await kuaiziPost<{ id?: unknown }>(
      apiKey,
      baseUrl,
      `${KUAIZI_ASSET_PATH}/create`,
      { group_id: group.groupId, url: data.url, asset_name: data.name, asset_type: 1 },
    );
    if (!created.ok) return { ok: false as const, error: created.error };
    const assetId = toUint64Id(created.data.id);
    if (!assetId) return { ok: false as const, error: "[kuaizi] 创建素材后未返回有效 ID" };

    // 创建后立即查询一次；查询暂时失败不影响“已登记”这一事实，前端会继续轮询。
    const detail = await getAsset(apiKey, baseUrl, assetId);
    if (!detail.ok) return { ok: true as const, assetId, syncStatus: 0, syncError: "" };
    return {
      ok: true as const,
      assetId,
      syncStatus: toSyncStatus(detail.asset.sync_status),
      syncError: typeof detail.asset.sync_error === "string" ? detail.asset.sync_error : "",
    };
  });

const KuaiziAssetGetInput = z.object({
  assetId: z.string().regex(/^[1-9]\d{0,19}$/, "非法筷子素材 ID"),
});

/** 查询筷子异步同步状态，供工作区在“入库中”时刷新。 */
export const getKuaiziAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => KuaiziAssetGetInput.parse(input))
  .handler(async ({ data }) => {
    const { apiKey, baseUrl } = getKuaiziConfig();
    if (!apiKey) return { ok: false as const, error: "[kuaizi] 缺少 KUAIZI_API_KEY" };
    const detail = await getAsset(apiKey, baseUrl, data.assetId);
    if (!detail.ok) return { ok: false as const, error: detail.error };
    return {
      ok: true as const,
      assetId: data.assetId,
      syncStatus: toSyncStatus(detail.asset.sync_status),
      syncError: typeof detail.asset.sync_error === "string" ? detail.asset.sync_error : "",
    };
  });
