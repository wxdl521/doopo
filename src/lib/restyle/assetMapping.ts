// ====================================================================
//  转绘 v2 阶段 B · 原片→目标资产映射 —— 纯函数层
//
//  不依赖 supabase / 网关，可单测。restyleAssetMapping.core.ts 负责
//  读库、调导演模型、写表，这里只做：
//  - buildIdentityLock：身份锁定句式（character-bible skill 模板）
//  - mapSourceToTarget：LLM 映射建议 + 原片资产合并/去重/跨集归并
//  - validateCharacterBible：关系表闭合校验（复用 relationValidate 口径）
//  - computeAssetScopeHash：产物 scope 指纹（复用 artifactState）
// ====================================================================

import { computeScopeHash } from "./artifactState";
import {
  validateCharacterRelations,
  type RelationIssueType,
} from "./relationValidate";

// --------------------------------------------------------------------
// 输入类型
// --------------------------------------------------------------------

/** restyle_source_assets 行的最小投影（跨集合并只依赖这些字段）。 */
export interface SourceAssetInput {
  episodeId: string;
  episodeNo?: number | null;
  kind: "character" | "scene" | "prop";
  sourceName: string;
  aliases: string[];
  appearance?: string | null;
  wardrobe?: string | null;
  description?: string | null;
  uncertainty?: string[];
}

/** 导演模型给出的单个人物映射建议（character-bible 契约）。 */
export interface LlmCharacterSuggestion {
  /** 目标市场角色名。 */
  name: string;
  /** 原片人物名（asset_origin.sourceAssetName）。 */
  sourceName: string;
  /** 合并进同一目标角色的其他原片人物名/别名。 */
  sourceAliases?: string[];
  description?: string | undefined;
  clothing?: string | undefined;
  /** LLM 可自带身份锁定文本；缺省时由 buildIdentityLock 兜底生成。 */
  identityLock?: string | undefined;
  sourceDescription?: string | undefined;
  uncertainty?: string[];
}

export interface LlmNamedAssetSuggestion {
  name: string;
  sourceName: string;
  description?: string | undefined;
  sourceDescription?: string | undefined;
}

export interface LlmRelationSuggestion {
  character: string;
  related: string;
  relation: string;
  evidence?: string | undefined;
}

export interface LlmIgnoredAssetSuggestion {
  kind: "character" | "scene" | "prop";
  name: string;
  reason?: string | undefined;
}

/** 导演模型一次调用的完整映射建议。 */
export interface LlmMappingSuggestions {
  characters?: LlmCharacterSuggestion[];
  relations?: LlmRelationSuggestion[];
  scenes?: LlmNamedAssetSuggestion[];
  props?: LlmNamedAssetSuggestion[];
  ignoredAssets?: LlmIgnoredAssetSuggestion[];
}

// --------------------------------------------------------------------
// 输出类型（目标资产草案）
// --------------------------------------------------------------------

export interface AssetOrigin {
  type: "source_asset_mapping";
  sourceAssetName: string;
  sourceAssetAliases?: string[];
}

export interface TargetCharacterDraft {
  name: string;
  identityLock: string;
  description: string;
  clothing: string;
  sourceDescription: string;
  assetOrigin: AssetOrigin;
  /** 参与合并的全部原片人物名（含跨集归并）。 */
  sourceNames: string[];
  uncertainty: string[];
}

export interface TargetNamedAssetDraft {
  name: string;
  description: string;
  sourceDescription: string;
  assetOrigin: AssetOrigin;
}

export interface IgnoredAssetDraft {
  kind: "character" | "scene" | "prop";
  name: string;
  reason: string;
}

export interface AssetMappingResult {
  characters: TargetCharacterDraft[];
  relations: LlmRelationSuggestion[];
  scenes: TargetNamedAssetDraft[];
  props: TargetNamedAssetDraft[];
  ignoredAssets: IgnoredAssetDraft[];
  /** 原片资产中未被任何映射/忽略覆盖的（提示人工补录）。 */
  unmappedSourceNames: string[];
}

// --------------------------------------------------------------------
// 身份锁定
// --------------------------------------------------------------------

/**
 * 身份锁定文本，句式遵循 character-bible skill 模板：
 * 「严格保留主图脸模、脸型、五官比例、发型与体型；所有换装、所有镜头中
 * 身份特征不得漂移。」并显式带上体型骨架锚定与发型锚定；sourceDescription
 * 非空时作为身份锚点原文附上。
 */
export function buildIdentityLock(characterName: string, sourceDescription?: string | null): string {
  const name = characterName.trim() || "该角色";
  const anchor = sourceDescription?.trim()
    ? `身份锚点（源片设定）：${sourceDescription.trim()}。`
    : "";
  return (
    "严格保留主图脸模、脸型、五官比例、眉眼鼻唇与面部辨识度，不改变这张脸；" +
    "体型骨架以主图为基准全程锚定，不因镜头或换装改变高矮胖瘦与体态比例；" +
    "发型发色以主图为准保持一致，换装只改服装与配饰；" +
    `所有换装、所有镜头、跨集出场中 ${name} 的身份特征不得漂移。` +
    anchor
  );
}

// --------------------------------------------------------------------
// 映射合并
// --------------------------------------------------------------------

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = normalizeName(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** 源资产检索索引：sourceName 与每个别名都指向同一资产（跨集同名即同角色）。 */
function indexSourceAssets(
  assets: SourceAssetInput[],
  kind: SourceAssetInput["kind"],
): Map<string, SourceAssetInput> {
  const index = new Map<string, SourceAssetInput>();
  for (const asset of assets) {
    if (asset.kind !== kind) continue;
    for (const key of [asset.sourceName, ...asset.aliases]) {
      const normalized = normalizeName(key);
      // 先到先得：跨集同名资产取首条做外观/描述来源，别名在合并时补齐。
      if (normalized && !index.has(normalized)) index.set(normalized, asset);
    }
  }
  return index;
}

/** 按 sourceName+别名跨集归并：返回同一原片人物在各集出现过的全部名字。 */
function collectMergedSourceNames(
  assets: SourceAssetInput[],
  kind: SourceAssetInput["kind"],
  seedNames: string[],
): string[] {
  const index = indexSourceAssets(assets, kind);
  const merged: string[] = [];
  const queue = [...seedNames];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const name = queue.shift()!;
    const key = normalizeName(name);
    if (!key || visited.has(key)) continue;
    visited.add(key);
    merged.push(name.trim());
    const asset = index.get(key);
    if (asset) {
      queue.push(asset.sourceName, ...asset.aliases);
    }
  }
  return uniqueStrings(merged);
}

function mergeCharacters(
  sourceAssets: SourceAssetInput[],
  suggestions: LlmCharacterSuggestion[],
): TargetCharacterDraft[] {
  const index = indexSourceAssets(sourceAssets, "character");
  const byTargetName = new Map<string, TargetCharacterDraft>();

  for (const suggestion of suggestions) {
    const targetName = suggestion.name.trim();
    if (!targetName) continue;
    const seedNames = uniqueStrings([suggestion.sourceName, ...(suggestion.sourceAliases ?? [])]);
    const sourceNames = collectMergedSourceNames(sourceAssets, "character", seedNames);
    const matched = seedNames
      .map((name) => index.get(normalizeName(name)))
      .find((asset): asset is SourceAssetInput => Boolean(asset));

    const sourceDescription =
      suggestion.sourceDescription?.trim() ||
      matched?.appearance?.trim() ||
      matched?.description?.trim() ||
      "";
    const uncertainty = uniqueStrings([
      ...(matched?.uncertainty ?? []),
      ...(suggestion.uncertainty ?? []),
    ]);
    const aliases = sourceNames.filter(
      (name) => normalizeName(name) !== normalizeName(seedNames[0] ?? suggestion.sourceName),
    );

    const draft: TargetCharacterDraft = {
      name: targetName,
      identityLock:
        suggestion.identityLock?.trim() || buildIdentityLock(targetName, sourceDescription),
      description: suggestion.description?.trim() || matched?.description?.trim() || "",
      clothing: suggestion.clothing?.trim() || matched?.wardrobe?.trim() || "",
      sourceDescription,
      assetOrigin: {
        type: "source_asset_mapping",
        sourceAssetName: (seedNames[0] ?? suggestion.sourceName).trim(),
        ...(aliases.length > 0 ? { sourceAssetAliases: aliases } : {}),
      },
      sourceNames,
      uncertainty,
    };

    const key = normalizeName(targetName);
    const existing = byTargetName.get(key);
    if (existing) {
      // 同一目标角色被建议两次：合并来源名与不确定项，其余字段先到先得。
      existing.sourceNames = uniqueStrings([...existing.sourceNames, ...draft.sourceNames]);
      existing.uncertainty = uniqueStrings([...existing.uncertainty, ...draft.uncertainty]);
      const mergedAliases = uniqueStrings([
        ...(existing.assetOrigin.sourceAssetAliases ?? []),
        ...(draft.assetOrigin.sourceAssetAliases ?? []),
      ]);
      existing.assetOrigin = {
        type: "source_asset_mapping",
        sourceAssetName: existing.assetOrigin.sourceAssetName,
        ...(mergedAliases.length > 0 ? { sourceAssetAliases: mergedAliases } : {}),
      };
      continue;
    }
    byTargetName.set(key, draft);
  }
  return [...byTargetName.values()];
}

function mergeNamedAssets(
  sourceAssets: SourceAssetInput[],
  kind: "scene" | "prop",
  suggestions: LlmNamedAssetSuggestion[],
): TargetNamedAssetDraft[] {
  const index = indexSourceAssets(sourceAssets, kind);
  const byTargetName = new Map<string, TargetNamedAssetDraft>();
  for (const suggestion of suggestions) {
    const targetName = suggestion.name.trim();
    if (!targetName) continue;
    const key = normalizeName(targetName);
    if (byTargetName.has(key)) continue;
    const matched = index.get(normalizeName(suggestion.sourceName));
    byTargetName.set(key, {
      name: targetName,
      description: suggestion.description?.trim() || matched?.description?.trim() || "",
      sourceDescription:
        suggestion.sourceDescription?.trim() || matched?.description?.trim() || "",
      assetOrigin: {
        type: "source_asset_mapping",
        sourceAssetName: suggestion.sourceName.trim(),
      },
    });
  }
  return [...byTargetName.values()];
}

/**
 * 合并 LLM 映射建议与原片资产：
 * - 按 sourceName+别名把跨集出现的同一原片人物归并为同一目标角色；
 * - 目标角色按目标名去重；identity_lock 缺省时按 character-bible 句式兜底；
 * - 未被映射也未被忽略的原片资产计入 unmappedSourceNames 提示人工处理。
 */
export function mapSourceToTarget(
  sourceAssets: SourceAssetInput[],
  llmSuggestions: LlmMappingSuggestions,
): AssetMappingResult {
  const characters = mergeCharacters(sourceAssets, llmSuggestions.characters ?? []);
  const scenes = mergeNamedAssets(sourceAssets, "scene", llmSuggestions.scenes ?? []);
  const props = mergeNamedAssets(sourceAssets, "prop", llmSuggestions.props ?? []);

  const ignoredAssets: IgnoredAssetDraft[] = [];
  const seenIgnored = new Set<string>();
  for (const item of llmSuggestions.ignoredAssets ?? []) {
    const name = item.name.trim();
    if (!name) continue;
    const key = `${item.kind}:${normalizeName(name)}`;
    if (seenIgnored.has(key)) continue;
    seenIgnored.add(key);
    ignoredAssets.push({ kind: item.kind, name, reason: item.reason?.trim() || "" });
  }

  // 覆盖集 = 已映射来源名 + 已忽略名（均按 kind 归一化）。
  const covered = new Set<string>();
  for (const character of characters) {
    for (const name of character.sourceNames) {
      covered.add(`character:${normalizeName(name)}`);
    }
  }
  for (const draft of scenes) {
    covered.add(`scene:${normalizeName(draft.assetOrigin.sourceAssetName)}`);
  }
  for (const draft of props) {
    covered.add(`prop:${normalizeName(draft.assetOrigin.sourceAssetName)}`);
  }
  for (const item of ignoredAssets) {
    covered.add(`${item.kind}:${normalizeName(item.name)}`);
  }

  const unmappedSourceNames = uniqueStrings(
    sourceAssets
      .filter((asset) => !covered.has(`${asset.kind}:${normalizeName(asset.sourceName)}`))
      .map((asset) => asset.sourceName),
  );

  return {
    characters,
    relations: (llmSuggestions.relations ?? []).filter(
      (relation) => relation.character.trim() && relation.related.trim(),
    ),
    scenes,
    props,
    ignoredAssets,
    unmappedSourceNames,
  };
}

// --------------------------------------------------------------------
// 关系表闭合校验
// --------------------------------------------------------------------

export interface CharacterBibleIssue {
  type: RelationIssueType;
  /** 出问题边的两端目标角色名。 */
  character: string;
  related: string;
  relation: string;
}

/**
 * 关系表闭合检查（与 character-bible skill 同口径，复用 relationValidate）：
 * A→B 必须存在 B→A 反向边（missing_reverse）、禁自指（self）、
 * 禁悬空（dangling，指向不存在的目标角色）、禁重复边（duplicate）。
 * characters 传目标角色名列表。
 */
export function validateCharacterBible(
  characters: Array<{ name: string }>,
  relations: LlmRelationSuggestion[],
): CharacterBibleIssue[] {
  const names = characters.map((character) => character.name);
  const like = relations.map((relation) => ({
    id: `${relation.character}→${relation.related}`,
    from: relation.character,
    to: relation.related,
    relation: relation.relation,
  }));
  return validateCharacterRelations(like, names).map((issue) => {
    const [character = "", related = ""] = issue.relationId.split("→");
    const relation =
      relations.find(
        (item) => item.character === character && item.related === related,
      )?.relation ?? "";
    return { type: issue.type, character, related, relation };
  });
}

// --------------------------------------------------------------------
// LLM 输出归一化（蛇形/驼峰字段名兼容）
// --------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return !!value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord).filter((item): item is Record<string, unknown> => item !== null);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/**
 * 把导演模型的原始 JSON 归一化为 LlmMappingSuggestions。
 * 兼容 snake_case（identity_lock / source_description / asset_origin /
 * ignored_assets）与 camelCase 两种字段名；非法条目静默丢弃。
 */
export function normalizeLlmSuggestions(raw: unknown): LlmMappingSuggestions {
  const root = asRecord(raw) ?? {};
  const characters = asRecordArray(root.characters)
    .map((row): LlmCharacterSuggestion | null => {
      const name = str(row.name);
      const origin = asRecord(row.asset_origin) ?? asRecord(row.assetOrigin);
      const sourceName = str(row.sourceName) ?? str(row.source_name) ?? str(origin?.sourceAssetName) ?? str(origin?.source_asset_name);
      if (!name || !sourceName) return null;
      return {
        name,
        sourceName,
        sourceAliases: [
          ...strList(row.sourceAliases ?? row.source_aliases),
          ...strList(origin?.sourceAssetAliases ?? origin?.source_asset_aliases),
        ],
        description: str(row.description),
        clothing: str(row.clothing),
        identityLock: str(row.identityLock ?? row.identity_lock),
        sourceDescription: str(row.sourceDescription ?? row.source_description),
        uncertainty: strList(row.uncertainty),
      };
    })
    .filter((item): item is LlmCharacterSuggestion => item !== null);

  const relations = asRecordArray(root.relations)
    .map((row): LlmRelationSuggestion | null => {
      const character = str(row.character);
      const related = str(row.related);
      const relation = str(row.relation);
      if (!character || !related || !relation) return null;
      return { character, related, relation, evidence: str(row.evidence) };
    })
    .filter((item): item is LlmRelationSuggestion => item !== null);

  const named = (value: unknown): LlmNamedAssetSuggestion[] =>
    asRecordArray(value)
      .map((row): LlmNamedAssetSuggestion | null => {
        const name = str(row.name);
        const origin = asRecord(row.asset_origin) ?? asRecord(row.assetOrigin);
        const sourceName = str(row.sourceName) ?? str(row.source_name) ?? str(origin?.sourceAssetName) ?? str(origin?.source_asset_name);
        if (!name || !sourceName) return null;
        return {
          name,
          sourceName,
          description: str(row.description),
          sourceDescription: str(row.sourceDescription ?? row.source_description),
        };
      })
      .filter((item): item is LlmNamedAssetSuggestion => item !== null);

  const ignoredAssets = asRecordArray(root.ignoredAssets ?? root.ignored_assets)
    .map((row): LlmIgnoredAssetSuggestion | null => {
      const kind = str(row.kind);
      const name = str(row.name);
      if (!name || (kind !== "character" && kind !== "scene" && kind !== "prop")) return null;
      return { kind, name, reason: str(row.reason) };
    })
    .filter((item): item is LlmIgnoredAssetSuggestion => item !== null);

  return {
    characters,
    relations,
    scenes: named(root.scenes),
    props: named(root.props),
    ignoredAssets,
  };
}

// --------------------------------------------------------------------
// scope 指纹
// --------------------------------------------------------------------

/**
 * 资产映射产物的 scope 指纹：同一批源资产/集范围/画风恒得同一 hash，
 * 用作幂等键与上游变更检测。复用 artifactState 的稳定序列化 + djb2。
 */
export function computeAssetScopeHash(input: unknown): string {
  return computeScopeHash(input);
}
