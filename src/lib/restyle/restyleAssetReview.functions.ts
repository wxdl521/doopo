// ====================================================================
// 转绘 v1 资产表 skill 自检（服务端壳）。
// system prompt 复用 skills 全文：composePrompt(["ai-output-review",
// "character-bible"], context)，不新写规约；解析逻辑在 assetReview.ts。
// 与现有分析调用同一口径：ensureEnoughCredits 1 分/次。
// ====================================================================

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ensureEnoughCredits } from "../creditsGuard";
import { providerAuthHeaders, providerTuning, resolveProvider } from "./lovableGateway";
import { composePrompt } from "./skills";
import {
  ASSET_REVIEW_INSTRUCTION,
  AssetReviewInputSchema,
  buildAssetReviewContext,
  extractAssetReviewJson,
  parseAssetReviewPayload,
  type AssetReviewIssue,
  type AssetReviewVerdict,
} from "./assetReview";

export type { AssetReviewIssue, AssetReviewVerdict } from "./assetReview";

export type RestyleAssetReviewResponse =
  | {
      ok: true;
      verdict: AssetReviewVerdict;
      issues: AssetReviewIssue[];
      model: string;
    }
  | { ok: false; error: string };

/**
 * 资产表 + 人物关系表的 skill 自检。资产表生成后自动跑一次，
 * 手工编辑后由用户点「重新检查」触发（避免每次输入都消耗积分）。
 */
export const reviewRestyleAssetTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => AssetReviewInputSchema.parse(input))
  .handler(async ({ data }): Promise<RestyleAssetReviewResponse> => {
    const config = resolveProvider(data.model);
    if (!config.apiKey) {
      return { ok: false, error: config.missingKeyError };
    }
    const guard = await ensureEnoughCredits(1, { kind: "image", model: config.model });
    if (!guard.ok) {
      return { ok: false, error: guard.error };
    }

    const system = composePrompt(
      ["ai-output-review", "character-bible"],
      buildAssetReviewContext(data),
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        // jingmei 走 api-key 头,其余 Bearer(由 providerAuthHeaders 按 provider 组包)
        headers: providerAuthHeaders(config),
        signal: controller.signal,
        body: JSON.stringify({
          model: config.model,
          ...providerTuning(config, 4_000),
          messages: [
            { role: "system", content: system },
            { role: "user", content: ASSET_REVIEW_INSTRUCTION },
          ],
        }),
      });
      if (!response.ok) {
        const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 240);
        return {
          ok: false,
          error: `${config.label} 请求失败（${response.status}）：${detail || "上游未返回详情"}`,
        };
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        return { ok: false, error: `${config.label} 未返回自检结果。` };
      }
      const { verdict, issues } = parseAssetReviewPayload(extractAssetReviewJson(content));
      return { ok: true, verdict, issues, model: config.model };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error && error.name === "AbortError"
            ? "资产表自检超时，请稍后重试。"
            : `资产表自检失败：${error instanceof Error ? error.message : "未知错误"}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  });
