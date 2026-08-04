// ====================================================================
//  转绘 v2 阶段 B（第一步）—— 资产映射面板
//
//  映射表：原片资产 → 目标角色（目标名/身份锁定/服装/来源描述），行内可
//  编辑（交互风格沿用 v1 ExtractedAssetTable：单元格直接编辑、失焦即更新
//  本地行，确认时整体作为 userContent 提交）。场景/道具/忽略清单只读。
//  确认流走 ArtifactApprovalPanel：采纳 AI 版本 / 保存修改并提交 /
//  打回重生成（附意见）；确认后产物置 user_approved，角色字段改写经
//  confirmAssetMappingFn 回写 restyle_characters。
// ====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  generateAssetMappingFn,
  confirmAssetMappingFn,
  listAssetMappingFn,
} from "@/lib/restyle/restyleAssetMapping.functions";
import { rejectArtifactFn } from "@/lib/restyle/restyleArtifacts.functions";
import ArtifactApprovalPanel, { type ArtifactIssue } from "./ArtifactApprovalPanel";

const ASSET_MAPPING_STAGE = "asset_mapping";
const ASSET_MAPPING_NODE_KEY = "project";

interface CharacterRow {
  id: string;
  name: string;
  identity_lock: string | null;
  description: string | null;
  clothing: string | null;
  source_description: string | null;
  asset_origin: {
    type?: string;
    sourceAssetName?: string;
    sourceAssetAliases?: string[];
  } | null;
  status: string;
}

interface NamedAssetRow {
  id: string;
  name: string;
  description: string | null;
  source_description: string | null;
  asset_origin: { sourceAssetName?: string } | null;
}

interface IgnoredRow {
  id: string;
  kind: string;
  name: string;
  reason: string | null;
}

interface MappingArtifact {
  status: string;
  verdict: string | null;
  issues: unknown;
  content: unknown;
  user_content: unknown;
  revision: number;
}

interface ValidationIssue {
  type: string;
  character: string;
  related: string;
  relation: string;
}

const VALIDATION_TYPE_LABEL: Record<string, string> = {
  dangling: "悬空引用",
  self: "自指",
  duplicate: "重复边",
  missing_reverse: "缺反向边",
};

const CELL_CLASS =
  "w-full rounded bg-transparent px-1 text-left outline-none transition read-only:cursor-default focus:bg-bg focus:ring-1 focus:ring-accent/40";

function sourceLabel(row: CharacterRow): string {
  const origin = row.asset_origin;
  if (!origin?.sourceAssetName) return "—";
  const aliases = origin.sourceAssetAliases ?? [];
  return aliases.length > 0
    ? `${origin.sourceAssetName}（合并：${aliases.join("、")}）`
    : origin.sourceAssetName;
}

export interface AssetMappingPanelProps {
  projectId: string;
  /** 产物状态变化后回调（上层刷新阶段闸门）。 */
  onArtifactsChanged?: () => void;
}

export default function AssetMappingPanel({ projectId, onArtifactsChanged }: AssetMappingPanelProps) {
  const callList = useServerFn(listAssetMappingFn);
  const callGenerate = useServerFn(generateAssetMappingFn);
  const callConfirm = useServerFn(confirmAssetMappingFn);
  const callReject = useServerFn(rejectArtifactFn);

  const [characters, setCharacters] = useState<CharacterRow[]>([]);
  const [scenes, setScenes] = useState<NamedAssetRow[]>([]);
  const [propsRows, setPropsRows] = useState<NamedAssetRow[]>([]);
  const [ignored, setIgnored] = useState<IgnoredRow[]>([]);
  const [artifact, setArtifact] = useState<MappingArtifact | null>(null);
  const [pendingNodes, setPendingNodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 行内编辑的角色字段补丁：id → 字段子集（确认时作为 userContent 提交）。 */
  const [edits, setEdits] = useState<Map<string, Partial<CharacterRow>>>(new Map());

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await callList({ data: { projectId } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCharacters(result.data.characters as unknown as CharacterRow[]);
      setScenes(result.data.scenes as unknown as NamedAssetRow[]);
      setPropsRows(result.data.props as unknown as NamedAssetRow[]);
      setIgnored(result.data.ignoredAssets as unknown as IgnoredRow[]);
      setArtifact((result.data.artifact as unknown as MappingArtifact | null) ?? null);
      setEdits(new Map());
    } finally {
      setLoading(false);
    }
  }, [callList, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const validationIssues = useMemo<ValidationIssue[]>(() => {
    const content = artifact?.content;
    if (content && typeof content === "object" && !Array.isArray(content)) {
      const list = (content as Record<string, unknown>).validationIssues;
      if (Array.isArray(list)) return list as ValidationIssue[];
    }
    return [];
  }, [artifact]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const result = await callGenerate({ data: { projectId } });
      if (result.ok) {
        setPendingNodes([]);
        toast.success(
          `资产映射完成：${result.counts.characters} 角色 / ${result.counts.scenes} 场景 / ${result.counts.props} 道具 / ${result.counts.ignored} 忽略。`,
        );
        if (result.unmappedSourceNames.length > 0) {
          toast.warning(`未映射原片资产：${result.unmappedSourceNames.join("、")}`);
        }
        await refresh();
        onArtifactsChanged?.();
      } else if (result.code === "STAGE_NOT_APPROVED") {
        setPendingNodes(result.pending ?? []);
        setError("分析阶段还有节点未确认，无法生成资产映射。");
      } else {
        setError(result.error ?? "资产映射生成失败。");
      }
    } finally {
      setGenerating(false);
    }
  };

  const patchRow = (id: string, field: keyof CharacterRow, value: string) => {
    setCharacters((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
    setEdits((prev) => {
      const next = new Map(prev);
      next.set(id, { ...next.get(id), [field]: value });
      return next;
    });
  };

  const handleApprove = async (userContent?: unknown) => {
    setActing(true);
    try {
      // 面板 JSON 编辑优先；否则把行内编辑作为 characters 改写提交。
      let payload = userContent;
      if (payload === undefined && edits.size > 0) {
        const edited = characters
          .filter((row) => edits.has(row.id))
          .map((row) => ({
            name: row.name,
            identityLock: row.identity_lock ?? undefined,
            description: row.description ?? undefined,
            clothing: row.clothing ?? undefined,
            sourceDescription: row.source_description ?? undefined,
          }));
        payload = { characters: edited };
      }
      const result = await callConfirm({
        data: { projectId, ...(payload !== undefined ? { userContent: payload } : {}) },
      });
      if (!result.ok) {
        toast.error(result.error ?? "确认失败。");
        return;
      }
      toast.success("资产映射已确认。");
      await refresh();
      onArtifactsChanged?.();
    } finally {
      setActing(false);
    }
  };

  const handleReject = async (feedback: string) => {
    setActing(true);
    try {
      const result = await callReject({
        data: {
          projectId,
          stage: ASSET_MAPPING_STAGE,
          nodeKey: ASSET_MAPPING_NODE_KEY,
          feedback,
        },
      });
      if (!result.ok) {
        toast.error(result.error ?? "打回失败。");
        return;
      }
      toast.success("已打回，可重新生成映射。");
      await refresh();
      onArtifactsChanged?.();
    } finally {
      setActing(false);
    }
  };

  const approved = artifact?.status === "user_approved";

  return (
    <div className="space-y-4">
      {pendingNodes.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="px-4 py-3">
            <p className="text-xs font-medium text-amber-400">
              分析阶段还有 {pendingNodes.length} 个节点未确认（STAGE_NOT_APPROVED）：
            </p>
            <ul className="mt-1 list-inside list-disc text-xs text-text-secondary">
              {pendingNodes.map((node) => (
                <li key={node}>{node}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="border-border">
        <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">原片 → 目标资产映射</CardTitle>
            {artifact && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px]",
                  approved
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : artifact.status === "rejected"
                      ? "border-red-500/40 bg-red-500/10 text-red-400"
                      : "border-border bg-bg-elevated text-text-muted",
                )}
              >
                {artifact.status}
              </Badge>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={generating || loading || acting}
            onClick={() => void handleGenerate()}
          >
            {generating ? "生成中…" : artifact ? "重新生成映射" : "生成资产映射"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 px-4 pb-4">
          {error && <p className="text-xs text-red-400">{error}</p>}
          {!artifact && !error && (
            <p className="text-xs text-text-muted">
              尚未生成映射。点击「生成资产映射」，由导演模型按 character-bible
              契约把原片角色/场景/道具映射为目标资产（含身份锁定）。
            </p>
          )}

          {characters.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {["原片资产", "目标角色", "身份锁定", "服装", "来源描述"].map((col) => (
                      <th
                        key={col}
                        className="border-b border-border px-2 py-1.5 text-left font-medium text-text-muted"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {characters.map((row) => (
                    <tr key={row.id} className="border-b border-border/50 align-top">
                      <td className="px-2 py-1.5 text-text-secondary">
                        <span className="whitespace-pre-wrap">{sourceLabel(row)}</span>
                      </td>
                      <td className="min-w-28 px-1 py-1">
                        <input
                          value={row.name}
                          readOnly={approved || acting}
                          aria-label="目标角色名"
                          onChange={(e) => patchRow(row.id, "name", e.target.value)}
                          className={cn(CELL_CLASS, "text-xs text-text-secondary")}
                        />
                      </td>
                      <td className="min-w-52 px-1 py-1">
                        <textarea
                          value={row.identity_lock ?? ""}
                          readOnly={approved || acting}
                          rows={2}
                          aria-label="身份锁定"
                          onChange={(e) => patchRow(row.id, "identity_lock", e.target.value)}
                          className={cn(CELL_CLASS, "resize-y text-xs leading-5 text-text-secondary")}
                        />
                      </td>
                      <td className="min-w-40 px-1 py-1">
                        <textarea
                          value={row.clothing ?? ""}
                          readOnly={approved || acting}
                          rows={2}
                          aria-label="服装"
                          onChange={(e) => patchRow(row.id, "clothing", e.target.value)}
                          className={cn(CELL_CLASS, "resize-y text-xs leading-5 text-text-secondary")}
                        />
                      </td>
                      <td className="min-w-40 px-2 py-1.5 text-text-muted">
                        <span className="whitespace-pre-wrap">{row.source_description ?? "—"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {validationIssues.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
              <p className="text-xs font-medium text-amber-400">
                关系表闭合校验 {validationIssues.length} 个问题：
              </p>
              <ul className="mt-1 list-inside list-disc text-xs text-text-secondary">
                {validationIssues.map((issue, i) => (
                  <li key={i}>
                    {VALIDATION_TYPE_LABEL[issue.type] ?? issue.type}：{issue.character} →{" "}
                    {issue.related}（{issue.relation}）
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(scenes.length > 0 || propsRows.length > 0 || ignored.length > 0) && (
            <div className="grid gap-3 md:grid-cols-3">
              {[
                { label: "场景", rows: scenes },
                { label: "道具", rows: propsRows },
              ].map(({ label, rows }) => (
                <div key={label} className="rounded-md border border-border p-2">
                  <p className="mb-1 text-xs font-medium text-text-secondary">
                    {label}（{rows.length}）
                  </p>
                  <ul className="space-y-1 text-xs text-text-muted">
                    {rows.map((row) => (
                      <li key={row.id}>
                        {row.asset_origin?.sourceAssetName ?? "—"} → {row.name}
                      </li>
                    ))}
                    {rows.length === 0 && <li>无</li>}
                  </ul>
                </div>
              ))}
              <div className="rounded-md border border-border p-2">
                <p className="mb-1 text-xs font-medium text-text-secondary">
                  忽略清单（{ignored.length}）
                </p>
                <ul className="space-y-1 text-xs text-text-muted">
                  {ignored.map((row) => (
                    <li key={row.id}>
                      [{row.kind}] {row.name}
                      {row.reason ? `：${row.reason}` : ""}
                    </li>
                  ))}
                  {ignored.length === 0 && <li>无</li>}
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {artifact && (
        <Card className="border-border">
          <CardHeader className="px-4 py-3">
            <CardTitle className="text-sm">产物确认（revision {artifact.revision}）</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <ArtifactApprovalPanel
              verdict={artifact.verdict}
              issues={(artifact.issues ?? []) as ArtifactIssue[]}
              content={artifact.content}
              userContent={artifact.user_content}
              busy={acting || generating}
              onApprove={(userContent) => handleApprove(userContent)}
              onReject={(feedback) => handleReject(feedback)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
