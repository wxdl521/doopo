// ====================================================================
// 人物关系表（表格视图）。数据来自 analysis 的 relationships，落在
// project.characterRelations.relations；角色列为下拉（选项取自
// extractedAssets 中 kind === "character"，存资产 id，改名自动跟随）。
// 校验：本地 validateCharacterRelations 实时跑，问题行标红；
// 「补全反向关系」一键修复缺失的反向边。关系为空时整块不渲染。
// ====================================================================

import { AlertTriangle, Plus, Trash2, Wrench } from "lucide-react";
import type { Translations } from "../../i18n/zh";
import type { AssetReviewIssue } from "../../lib/restyle/assetReview";
import type { RelationIssue } from "../../lib/restyle/relationValidate";
import type { RestyleCharacterRelation } from "./restyleStorage";

export type RelationCharacterOption = { id: string; name: string };

export function CharacterRelationTable({
  characters,
  relations,
  issues,
  reviewIssues = [],
  onChange,
  onFixReverse,
  t,
}: {
  characters: RelationCharacterOption[];
  relations: RestyleCharacterRelation[];
  /** 本地校验（悬空/自指/重复/缺失反向边），编辑时实时跑。 */
  issues: RelationIssue[];
  /** 模型侧语义校验（reviewRestyleAssetTable 返回，assetId 为关系边 id）。 */
  reviewIssues?: AssetReviewIssue[];
  onChange: (relations: RestyleCharacterRelation[]) => void;
  onFixReverse: () => void;
  t: Translations;
}) {
  // 简单剧集没有关系：整块不出现，也不提供手动入口。
  if (!relations.length) return null;

  const issueRelationIds = new Set(issues.map((issue) => issue.relationId));
  const hasMissingReverse = issues.some((issue) => issue.type === "missing_reverse");
  const reviewByRelation = new Map<string, AssetReviewIssue[]>();
  for (const issue of reviewIssues) {
    const list = reviewByRelation.get(issue.assetId) ?? [];
    list.push(issue);
    reviewByRelation.set(issue.assetId, list);
  }

  function patchRelation(relationId: string, patch: Partial<RestyleCharacterRelation>) {
    onChange(
      relations.map((relation) =>
        relation.id === relationId ? { ...relation, ...patch } : relation,
      ),
    );
  }

  function addRelation() {
    const fallbackFrom = characters[0]?.id ?? "";
    const fallbackTo = characters.find((character) => character.id !== fallbackFrom)?.id ?? "";
    onChange([
      ...relations,
      {
        id: crypto.randomUUID(),
        from: fallbackFrom,
        to: fallbackTo,
        relation: "",
        note: "",
      },
    ]);
  }

  return (
    <div
      className="mt-4 overflow-x-auto rounded-xl border border-border"
      data-testid="character-relation-table"
    >
      <div className="min-w-[720px]">
        <div className="flex items-center gap-2 border-b border-border bg-bg-elevated px-4 py-2">
          <span className="text-[11px] font-semibold text-text-primary">
            {t.restyle_relation_table_title}
          </span>
          <span className="text-[11px] text-text-muted">{relations.length}</span>
          <span className="ml-auto flex items-center gap-2">
            {hasMissingReverse ? (
              <button
                type="button"
                onClick={onFixReverse}
                className="flex items-center gap-1 text-[11px] text-destructive hover:text-text-primary"
              >
                <Wrench size={12} />
                {t.restyle_relation_fix_reverse}
              </button>
            ) : null}
            <button
              type="button"
              onClick={addRelation}
              className="flex items-center gap-1 text-[11px] text-accent hover:text-text-primary"
            >
              <Plus size={12} />
              {t.restyle_relation_add}
            </button>
          </span>
        </div>
        <div className="grid grid-cols-[minmax(120px,1fr)_minmax(140px,1.2fr)_minmax(120px,1fr)_minmax(160px,1.4fr)_40px] gap-3 border-b border-border px-4 py-1.5 text-[11px] font-medium text-text-muted">
          <span>{t.restyle_relation_from}</span>
          <span>{t.restyle_relation_label}</span>
          <span>{t.restyle_relation_to}</span>
          <span>{t.restyle_relation_note}</span>
          <span />
        </div>
        {relations.map((relation) => {
          const hasIssue = issueRelationIds.has(relation.id);
          const semanticIssues = reviewByRelation.get(relation.id);
          const endpointSelect = (endpoint: "from" | "to", label: string) => (
            <select
              value={relation[endpoint]}
              aria-label={`${label}：${relation.id}`}
              onChange={(event) =>
                patchRelation(relation.id, { [endpoint]: event.target.value })
              }
              className="w-full rounded bg-transparent px-1 py-0.5 text-xs text-text-primary outline-none focus:bg-bg focus:ring-1 focus:ring-accent/40"
            >
              <option value="" disabled>
                —
              </option>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
          );
          return (
            <div key={relation.id}>
              <div
                data-relation-id={relation.id}
                className={`grid grid-cols-[minmax(120px,1fr)_minmax(140px,1.2fr)_minmax(120px,1fr)_minmax(160px,1.4fr)_40px] items-center gap-3 border-b border-border px-4 py-2 last:border-0 ${
                  hasIssue ? "bg-destructive/5 ring-1 ring-inset ring-destructive/40" : ""
                }`}
              >
                {endpointSelect("from", t.restyle_relation_from)}
                <input
                  value={relation.relation}
                  aria-label={`${t.restyle_relation_label}：${relation.id}`}
                  placeholder={t.restyle_relation_label}
                  onChange={(event) =>
                    patchRelation(relation.id, { relation: event.target.value })
                  }
                  className="w-full rounded bg-transparent px-1 py-0.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:bg-bg focus:ring-1 focus:ring-accent/40"
                />
                {endpointSelect("to", t.restyle_relation_to)}
                <input
                  value={relation.note ?? ""}
                  aria-label={`${t.restyle_relation_note}：${relation.id}`}
                  placeholder={t.restyle_relation_note}
                  onChange={(event) => patchRelation(relation.id, { note: event.target.value })}
                  className="w-full rounded bg-transparent px-1 py-0.5 text-xs text-text-secondary outline-none placeholder:text-text-muted focus:bg-bg focus:ring-1 focus:ring-accent/40"
                />
                <button
                  type="button"
                  onClick={() =>
                    onChange(relations.filter((item) => item.id !== relation.id))
                  }
                  className="grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`${t.restyle_relation_delete}：${relation.id}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              {semanticIssues?.length ? (
                <div className="border-b border-border bg-amber-50/50 px-4 py-1.5 dark:bg-amber-500/5">
                  {semanticIssues.map((issue, index) => (
                    <p
                      key={index}
                      className="flex items-start gap-1.5 text-[11px] leading-4 text-amber-700 dark:text-amber-300"
                    >
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      {issue.message}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
