// ====================================================================
// 转绘 v1 资产表 skill 自检 · 纯函数层（客户端可安全引用）。
// system prompt 由服务端用 composePrompt(["ai-output-review",
// "character-bible"], context) 拼装，这里只负责输入契约、context 组装
// 与模型输出的容错解析。server fn 壳在 restyleAssetReview.functions.ts。
// ====================================================================

import { z } from "zod";

/** 与 restyleAnalysis.functions.ts 的分析模型清单保持一致。 */
export const ASSET_REVIEW_MODELS = [
  "ark:deepseek-v4-pro-260425",
  "ark:doubao-seed-2-1-pro-260628",
  "qwen:qwen3.6-plus",
  "qwen:qwen3.6-flash",
  "qwen:qwen3.7-max",
  "lovable:openai/gpt-5.5",
] as const;

export const AssetReviewAssetSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.enum(["character", "scene", "prop"]),
  sourceName: z.string().min(1).max(80),
  sourceDescription: z.string().min(1).max(500),
  targetName: z.string().min(1).max(80),
  targetDescription: z.string().min(1).max(500),
  importance: z.enum(["required", "optional"]),
  shouldRestyle: z.boolean(),
});

export const AssetReviewRelationSchema = z.object({
  id: z.string().min(1).max(120),
  /** 角色资产 id；context 里会还原成角色名再喂给模型。 */
  from: z.string().min(1).max(120),
  to: z.string().min(1).max(120),
  relation: z.string().min(1).max(120),
  note: z.string().max(240).optional(),
});

export const AssetReviewInputSchema = z.object({
  model: z.enum(ASSET_REVIEW_MODELS),
  assets: z.array(AssetReviewAssetSchema).min(1).max(60),
  relations: z.array(AssetReviewRelationSchema).max(120).default([]),
});

export type AssetReviewInput = z.infer<typeof AssetReviewInputSchema>;

export const ASSET_REVIEW_VERDICTS = ["pass", "pass_with_notes", "fail"] as const;
export type AssetReviewVerdict = (typeof ASSET_REVIEW_VERDICTS)[number];

export const AssetReviewIssueSchema = z.object({
  /** 资产 id；关系语义问题则为关系边 id（field 为 "relation"）。 */
  assetId: z.string().min(1).max(120),
  field: z.string().min(1).max(60),
  severity: z.enum(["low", "medium", "high"]),
  message: z.string().min(1).max(500),
  suggestion: z.string().max(500).default(""),
});

export type AssetReviewIssue = z.infer<typeof AssetReviewIssueSchema>;

export type AssetReviewResult = {
  verdict: AssetReviewVerdict;
  issues: AssetReviewIssue[];
};

/** 喂给模型的 [CONTEXT]：关系的 from/to 由资产 id 还原为角色名，模型不需要理解内部 id。 */
export function buildAssetReviewContext(
  input: Pick<AssetReviewInput, "assets" | "relations">,
): string {
  const nameOf = (assetId: string) =>
    input.assets.find((asset) => asset.id === assetId)?.sourceName ?? assetId;
  return JSON.stringify(
    {
      assets: input.assets,
      relations: input.relations.map((relation) => ({
        id: relation.id,
        from: nameOf(relation.from),
        to: nameOf(relation.to),
        relation: relation.relation,
        note: relation.note,
      })),
    },
    null,
    2,
  );
}

/** 复核任务说明（user 消息）；检查口径来自 ai-output-review 与 character-bible 两个 skill。 */
export const ASSET_REVIEW_INSTRUCTION = `请复核 [CONTEXT] 中的转绘资产表（assets）与人物关系表（relations），逐项检查：
1. 角色是否为具体个体（一人一条，不得为群体或泛称）；
2. 场景是否为具体、可定位的地点或空间；
3. 道具是否为单一、可单独识别的物件；
4. 同一资产是否重复出现；
5. 目标名称/目标说明是否符合用户的目标市场要求；
6. 必填字段（名称、定位、目标说明等）是否缺失或为空话；
7. 人物关系语义是否合理：关系文案与对应角色的原片定位是否矛盾、from/to 是否张冠李戴。
只输出一个 JSON 对象，不要 Markdown、不要解释：
{"verdict":"pass | pass_with_notes | fail","issues":[{"assetId":"资产 id；关系问题填关系 id","field":"出问题字段（sourceName/sourceDescription/targetName/targetDescription/kind/shouldRestyle/importance/relation）","severity":"low | medium | high","message":"问题说明","suggestion":"可直接写入该字段的修改建议；无建议留空字符串"}]}
没有问题时 verdict 为 pass 且 issues 为空数组；issues 最多 20 条，按严重程度排序。`;

/** 从模型输出中提取 JSON（容错 Markdown 代码块与前后杂讯）。 */
export function extractAssetReviewJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("自检结果中没有可解析的 JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * 解析模型复核结果：逐条容错（坏行丢弃而不是整体失败），
 * verdict 缺失时按 issues 是否为空推断。
 */
export function parseAssetReviewPayload(raw: unknown): AssetReviewResult {
  const record = (raw ?? {}) as Record<string, unknown>;
  const issues = (Array.isArray(record.issues) ? record.issues : []).flatMap((item) => {
    const parsed = AssetReviewIssueSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  const verdict: AssetReviewVerdict = (
    ASSET_REVIEW_VERDICTS as readonly string[]
  ).includes(record.verdict as string)
    ? (record.verdict as AssetReviewVerdict)
    : issues.length
      ? "pass_with_notes"
      : "pass";
  return { verdict, issues };
}
