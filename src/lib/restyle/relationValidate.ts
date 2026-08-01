// ====================================================================
// 人物关系表本地校验（零成本、编辑时实时跑）。
// 与 character-bible.md 的关系表闭合规则同口径：禁止悬空引用、自指、
// 重复边；A→B 必须存在 B→A 反向边。空关系表合法。
// ====================================================================

/** 关系边的最小结构；与 restyleStorage 的 RestyleCharacterRelation 结构兼容。 */
export type CharacterRelationLike = {
  id: string;
  /** 角色资产 id（extractedAssets 中 kind === "character" 的条目）。 */
  from: string;
  to: string;
  relation: string;
  note?: string;
};

export type RelationIssueType = "dangling" | "self" | "duplicate" | "missing_reverse";

export type RelationIssue = {
  type: RelationIssueType;
  /** 出问题的那条关系边 id。 */
  relationId: string;
  /** 涉及的另一条边（missing_reverse 时为缺失反向边的正向边）。 */
  relatedRelationId?: string;
};

/**
 * 校验人物关系表。characterIds 为当前角色资产 id 集合。
 * 返回的问题列表按边逐条给出，调用方据 relationId 标红对应行/边。
 */
export function validateCharacterRelations(
  relations: CharacterRelationLike[],
  characterIds: string[],
): RelationIssue[] {
  const issues: RelationIssue[] = [];
  if (!relations.length) return issues;
  const knownIds = new Set(characterIds);
  const pairIndex = new Map<string, CharacterRelationLike>();

  for (const relation of relations) {
    if (!knownIds.has(relation.from) || !knownIds.has(relation.to)) {
      issues.push({ type: "dangling", relationId: relation.id });
      continue;
    }
    if (relation.from === relation.to) {
      issues.push({ type: "self", relationId: relation.id });
      continue;
    }
    const pairKey = `${relation.from}→${relation.to}`;
    const existing = pairIndex.get(pairKey);
    if (existing) {
      issues.push({
        type: "duplicate",
        relationId: relation.id,
        relatedRelationId: existing.id,
      });
      continue;
    }
    pairIndex.set(pairKey, relation);
  }

  // 缺失反向边：只对本身合法（非悬空/自指）的边检查，避免级联报错。
  for (const relation of pairIndex.values()) {
    if (!pairIndex.has(`${relation.to}→${relation.from}`)) {
      issues.push({ type: "missing_reverse", relationId: relation.id });
    }
  }
  return issues;
}

/**
 * 「补全反向关系」一键修复：为每条缺失反向边的合法边补上反向边，
 * 关系文案原样复制（反向措辞由用户或模型再调整），备注标注来源。
 */
export function withCompletedReverseRelations<T extends CharacterRelationLike>(
  relations: T[],
  characterIds: string[],
  createId: () => string = () => crypto.randomUUID(),
): T[] {
  const knownIds = new Set(characterIds);
  const pairKeys = new Set(
    relations
      .filter(
        (relation) =>
          knownIds.has(relation.from) &&
          knownIds.has(relation.to) &&
          relation.from !== relation.to,
      )
      .map((relation) => `${relation.from}→${relation.to}`),
  );
  const additions: T[] = [];
  for (const relation of relations) {
    if (
      !knownIds.has(relation.from) ||
      !knownIds.has(relation.to) ||
      relation.from === relation.to
    ) {
      continue;
    }
    const reverseKey = `${relation.to}→${relation.from}`;
    if (pairKeys.has(reverseKey)) continue;
    pairKeys.add(reverseKey);
    additions.push({
      ...relation,
      id: createId(),
      from: relation.to,
      to: relation.from,
    });
  }
  return [...relations, ...additions];
}
