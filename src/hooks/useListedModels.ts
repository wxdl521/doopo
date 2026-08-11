// ====================================================================
//  useListedModels —— 用户端模型目录唯一数据源
//
//  读服务端 listListedModels（已上架 + 启用，supabaseAdmin 脱敏目录），
//  React Query staleTime 60s 与服务端模块缓存同频。
//  接口异常 / 加载中回落调用方传入的静态列表，保证下拉不空白。
// ====================================================================

import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { useContext } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listListedModels } from "@/lib/aiProviders.functions";

export type ListedModelOption = {
  id: string;
  label: string;
  sub?: string;
  /** 是否已在「模型定价」配置有效价目行；未定价模型服务端禁止提交 */
  priced: boolean;
  /** 定价范围标注，如 "5积分/张" / "56-593积分/10s" */
  priceRange: string | null;
  /** 库内 is_default 行（默认值链的一档，见 modelOptions.resolveDefaultModel）。 */
  isDefault?: boolean;
  /** catalog 排序权重（升序）。 */
  sortOrder?: number;
};

// 无 QueryClientProvider 的环境（如未包 Provider 的组件单测）用的兜底 client，
// 避免 useQuery 直接抛 "No QueryClient set"。
let fallbackClient: QueryClient | null = null;
function getFallbackQueryClient(): QueryClient {
  if (!fallbackClient) fallbackClient = new QueryClient();
  return fallbackClient;
}

export function useListedModels(
  kind: "image" | "video" | "text",
  fallback: { id: string; label: string; sub?: string }[],
): { models: ListedModelOption[]; fromCatalog: boolean } {
  const callList = useServerFn(listListedModels);
  const contextClient = useContext(QueryClientContext);
  const query = useQuery(
    {
      queryKey: ["listed-models", kind],
      staleTime: 60_000,
      retry: 1,
      throwOnError: false,
      queryFn: async () => {
        // 未登录 / 网关 401 时服务端中间件会抛出 Response，这里吞掉并回落静态列表，
        // 否则 Response 会冒泡成 "Error: [object Response]" 导致整页白屏。
        let result: any;
        try {
          result = await callList({ data: { kind } });
        } catch {
          return [];
        }
        if (result?.error) return [];
        return (result?.models ?? []) as Array<{
          key: string;
          label: string;
          sub: string | null;
          isDefault?: boolean;
          sortOrder?: number;
          pricing: { priced: boolean; range: string | null };
        }>;
      },
    },
    contextClient ?? getFallbackQueryClient(),
  );

  if (query.data && query.data.length > 0) {
    return {
      models: query.data.map((m) => ({
        id: m.key,
        label: m.label,
        sub: m.sub ?? undefined,
        priced: m.pricing.priced,
        priceRange: m.pricing.range,
        isDefault: m.isDefault,
        sortOrder: m.sortOrder,
      })),
      fromCatalog: true,
    };
  }
  // 接口异常 / 加载中 / 目录为空：回落静态列表（视为已定价，保持现有行为）
  return {
    models: fallback.map((m) => ({ ...m, priced: true, priceRange: null })),
    fromCatalog: false,
  };
}
