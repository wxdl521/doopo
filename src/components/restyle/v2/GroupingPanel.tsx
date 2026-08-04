// ====================================================================
//  转绘 v2 阶段 B（第三步）—— 按集分组面板
//
//  每集一个分组集合（需求文档「阶段四 · 按集分组」）：
//   1. 「生成分组方案」→ generateGroupingFn（闸门 image_gen 全确认；
//      导演模型 shot-to-segment + packShotsIntoGroups 兜底 + ai-output-review
//      连贯性核对，结果进产物 issues）。
//   2. 分组卡片：组号 / 镜头范围 / 时长 / reason / 参与角色及造型；
//      点选 shot 后用「前移 / 后移」调整归属与顺序（跨组自动并入相邻组），
//      本地 validateGroups 实时校验（4–15s 硬约束高亮），「保存调整」
//      走 updateGroupingFn；scope 失效时高亮「需重新确认」并拒绝保存。
//   3. 确认走 ArtifactApprovalPanel（stage="grouping", node_key=episodeId）。
// ====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  generateGroupingFn,
  listGroupingFn,
  updateGroupingFn,
  type EpisodeGroupingData,
  type GroupingLookInfo,
  type ListGroupingResult,
} from "@/lib/restyle/restyleGrouping.functions";
import { approveArtifactFn, rejectArtifactFn } from "@/lib/restyle/restyleArtifacts.functions";
import {
  computeGroupStats,
  shotDurationSec,
  summarizeGroupCharacters,
  validateGroups,
  type GroupingShot,
} from "@/lib/restyle/grouping";
import ArtifactApprovalPanel, { type ArtifactIssue } from "./ArtifactApprovalPanel";

const GROUPING_STAGE = "grouping";

interface DraftGroup {
  shotIds: string[];
  reason: string;
}

interface GroupingData {
  episodes: EpisodeGroupingData[];
  looks: GroupingLookInfo[];
}

export interface GroupingPanelProps {
  projectId: string;
  /** 产物状态变化后回调（上层刷新阶段闸门）。 */
  onArtifactsChanged?: () => void;
}

function toGroupingShots(episode: EpisodeGroupingData): GroupingShot[] {
  return episode.shots.map((shot) => ({
    id: shot.id,
    shotNo: shot.shot_no,
    startMs: shot.start_ms,
    endMs: shot.end_ms,
    sceneType: shot.scene_type,
    characters: shot.characters,
    dialogue: shot.dialogue,
  }));
}

function draftFromEpisode(episode: EpisodeGroupingData): DraftGroup[] {
  return episode.groups.map((group) => ({
    shotIds: [...group.shot_ids],
    reason: group.reason ?? "",
  }));
}

function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px]",
        status === "user_approved"
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
          : status === "rejected"
            ? "border-red-500/40 bg-red-500/10 text-red-400"
            : "border-border bg-bg-elevated text-text-muted",
      )}
    >
      {status}
    </Badge>
  );
}

export default function GroupingPanel({ projectId, onArtifactsChanged }: GroupingPanelProps) {
  const callList = useServerFn(listGroupingFn);
  const callGenerate = useServerFn(generateGroupingFn);
  const callUpdate = useServerFn(updateGroupingFn);
  const callApprove = useServerFn(approveArtifactFn);
  const callReject = useServerFn(rejectArtifactFn);

  const [data, setData] = useState<GroupingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 每集手动调整草稿；仅在被编辑过时与 groups 行不同（dirty）。 */
  const [drafts, setDrafts] = useState<Record<string, DraftGroup[]>>({});
  const [selected, setSelected] = useState<{ episodeId: string; shotId: string } | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [artifactBusy, setArtifactBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result: ListGroupingResult = await callList({ data: { projectId } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setData(result.data);
      // 未编辑过的集跟随服务端分组；已编辑的草稿保留（避免冲掉未保存调整）。
      setDrafts((prev) => {
        const next: Record<string, DraftGroup[]> = {};
        for (const episode of result.data.episodes) {
          next[episode.episodeId] = prev[episode.episodeId] ?? draftFromEpisode(episode);
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  }, [callList, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const looksWithNames = useMemo(
    () =>
      (data?.looks ?? []).map((look) => ({
        characterId: look.characterId,
        characterName: look.characterName,
        name: look.name,
        fromShot: look.fromShot,
        toShot: look.toShot,
      })),
    [data],
  );

  // ------------------------------------------------------------------
  // 生成分组
  // ------------------------------------------------------------------

  const handleGenerate = async (episodeId: string) => {
    setGeneratingId(episodeId);
    try {
      const result = await callGenerate({ data: { projectId, episodeId } });
      if (!result.ok) {
        if (result.code === "STAGE_NOT_APPROVED" && "pending" in result) {
          toast.error(
            `前置阶段还有节点未确认：${result.pending.join("、") || "image_gen"}`,
          );
        } else {
          toast.error(`生成分组失败：${("error" in result && result.error) || result.code}`);
        }
        return;
      }
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[episodeId];
        return next;
      });
      toast.success(
        `已生成 ${result.groupCount} 组，共 ${result.totalDurationSeconds}s${
          result.usedPackerFallback ? "（AI 方案未通过校验，已按规则兜底重排）" : ""
        }。`,
      );
      await refresh();
      onArtifactsChanged?.();
    } finally {
      setGeneratingId(null);
    }
  };

  // ------------------------------------------------------------------
  // 手动调整（点选 shot + 前移/后移；跨组自动并入相邻组）
  // ------------------------------------------------------------------

  const draftFor = (episode: EpisodeGroupingData): DraftGroup[] =>
    drafts[episode.episodeId] ?? draftFromEpisode(episode);

  const isDirty = (episode: EpisodeGroupingData): boolean => {
    const draft = drafts[episode.episodeId];
    if (!draft) return false;
    return JSON.stringify(draft) !== JSON.stringify(draftFromEpisode(episode));
  };

  const moveSelectedShot = (episode: EpisodeGroupingData, direction: -1 | 1) => {
    if (!selected || selected.episodeId !== episode.episodeId) return;
    const draft = draftFor(episode).map((group) => ({
      shotIds: [...group.shotIds],
      reason: group.reason,
    }));
    const fromIndex = draft.findIndex((group) => group.shotIds.includes(selected.shotId));
    if (fromIndex < 0) return;
    const group = draft[fromIndex];
    const shotIndex = group.shotIds.indexOf(selected.shotId);
    const targetIndex = shotIndex + direction;
    if (targetIndex >= 0 && targetIndex < group.shotIds.length) {
      // 组内换序
      const next = [...group.shotIds];
      [next[shotIndex], next[targetIndex]] = [next[targetIndex], next[shotIndex]];
      group.shotIds = next;
    } else {
      // 跨组：并入相邻组（前组尾 / 后组首）
      const neighborIndex = fromIndex + direction;
      if (neighborIndex < 0 || neighborIndex >= draft.length) return;
      if (group.shotIds.length <= 1) return; // 单镜组不抽空
      group.shotIds = group.shotIds.filter((id) => id !== selected.shotId);
      const neighbor = draft[neighborIndex];
      neighbor.shotIds =
        direction === -1
          ? [...neighbor.shotIds, selected.shotId]
          : [selected.shotId, ...neighbor.shotIds];
    }
    setDrafts((prev) => ({ ...prev, [episode.episodeId]: draft }));
  };

  const updateReason = (episode: EpisodeGroupingData, groupIndex: number, reason: string) => {
    const draft = draftFor(episode).map((group, index) =>
      index === groupIndex ? { ...group, reason } : { ...group, shotIds: [...group.shotIds] },
    );
    setDrafts((prev) => ({ ...prev, [episode.episodeId]: draft }));
  };

  const handleReset = (episode: EpisodeGroupingData) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[episode.episodeId];
      return next;
    });
    setSelected(null);
  };

  const handleSave = async (episode: EpisodeGroupingData) => {
    const draft = draftFor(episode);
    setSavingId(episode.episodeId);
    try {
      const result = await callUpdate({
        data: {
          projectId,
          episodeId: episode.episodeId,
          groups: draft.map((group) => ({ shotIds: group.shotIds, reason: group.reason })),
        },
      });
      if (!result.ok) {
        if (result.code === "SCOPE_STALE") {
          toast.error("上游分镜已变化，请重新生成分组方案。");
          await refresh();
        } else {
          toast.error(`保存失败：${result.error ?? result.code}`);
        }
        return;
      }
      toast.success(`已保存 ${result.groupCount} 组调整，请重新确认分组记录。`);
      await refresh();
      onArtifactsChanged?.();
    } finally {
      setSavingId(null);
    }
  };

  // ------------------------------------------------------------------
  // 产物确认（ArtifactApprovalPanel）
  // ------------------------------------------------------------------

  const handleApprove = async (episode: EpisodeGroupingData, userContent?: unknown) => {
    if (isDirty(episode)) {
      toast.error("分组有未保存的调整，请先保存或重置。");
      return;
    }
    setArtifactBusy(true);
    try {
      // JSON 编辑提交：先把 groups 回写分组的归属/顺序（服务端再校验），再确认。
      if (userContent !== undefined) {
        const root =
          userContent && typeof userContent === "object" && !Array.isArray(userContent)
            ? (userContent as Record<string, unknown>)
            : null;
        const rows = Array.isArray(root?.groups) ? (root.groups as unknown[]) : null;
        if (rows && rows.length > 0) {
          const groups = rows.map((row) => {
            const record = (row ?? {}) as Record<string, unknown>;
            return {
              shotIds: Array.isArray(record.shotIds)
                ? (record.shotIds as unknown[]).filter((v): v is string => typeof v === "string")
                : [],
              reason: typeof record.reason === "string" ? record.reason : "",
            };
          });
          const updated = await callUpdate({
            data: { projectId, episodeId: episode.episodeId, groups },
          });
          if (!updated.ok) {
            toast.error(`修改未通过校验：${updated.error ?? updated.code}`);
            return;
          }
        }
      }
      const approved = await callApprove({
        data: { projectId, stage: GROUPING_STAGE, nodeKey: episode.episodeId },
      });
      if (!approved.ok) toast.error(approved.error ?? "确认失败。");
      else {
        toast.success(`第 ${episode.episodeNo ?? "?"} 集分组已确认。`);
        await refresh();
        onArtifactsChanged?.();
      }
    } finally {
      setArtifactBusy(false);
    }
  };

  const handleReject = async (episode: EpisodeGroupingData, feedback: string) => {
    setArtifactBusy(true);
    try {
      const result = await callReject({
        data: { projectId, stage: GROUPING_STAGE, nodeKey: episode.episodeId, feedback },
      });
      if (!result.ok) toast.error(result.error ?? "打回失败。");
      else {
        toast.success("已打回，可重新生成分组方案。");
        await refresh();
        onArtifactsChanged?.();
      }
    } finally {
      setArtifactBusy(false);
    }
  };

  // ------------------------------------------------------------------
  // 渲染
  // ------------------------------------------------------------------

  if (loading && !data) {
    return <p className="text-xs text-text-muted">分组数据加载中…</p>;
  }
  if (error) {
    return <p className="text-xs text-red-400">分组数据加载失败：{error}</p>;
  }
  if (!data || data.episodes.length === 0) {
    return <p className="text-xs text-text-muted">该项目还没有集，请先在分析阶段上传视频。</p>;
  }

  return (
    <div className="space-y-6">
      {data.episodes.map((episode) => {
        const shots = toGroupingShots(episode);
        const shotById = new Map(shots.map((shot) => [shot.id, shot]));
        const draft = draftFor(episode);
        const dirty = isDirty(episode);
        const validation = validateGroups(draft, shots);
        const stats = computeGroupStats(
          draft.map((group) => ({
            totalSeconds:
              Math.round(
                group.shotIds.reduce(
                  (sum, id) => sum + (shotById.get(id) ? shotDurationSec(shotById.get(id)!) : 0),
                  0,
                ) * 10,
              ) / 10,
          })),
        );
        const artifact = episode.artifact;
        const busy = generatingId === episode.episodeId || savingId === episode.episodeId;

        return (
          <Card key={episode.episodeId} className="border-border">
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-sm">第 {episode.episodeNo ?? "?"} 集</CardTitle>
                <StatusBadge status={artifact?.status} />
                {episode.stale && (
                  <Badge
                    variant="outline"
                    className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-400"
                  >
                    上游已变化 · 需重新确认
                  </Badge>
                )}
                {episode.groups.length > 0 && (
                  <span className="text-[11px] text-text-muted">
                    {stats.groupCount} 组 · 共 {stats.totalDurationSeconds}s
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {dirty && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => handleReset(episode)}
                    >
                      重置
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy || !validation.ok}
                      onClick={() => void handleSave(episode)}
                    >
                      {savingId === episode.episodeId ? "保存中…" : "保存调整"}
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant={episode.groups.length > 0 ? "outline" : "default"}
                  disabled={busy || dirty}
                  onClick={() => void handleGenerate(episode.episodeId)}
                >
                  {generatingId === episode.episodeId
                    ? "生成中…"
                    : episode.groups.length > 0
                      ? "重新生成分组"
                      : "生成分组方案"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 px-4 pb-4">
              {episode.groups.length === 0 ? (
                <p className="text-xs text-text-muted">
                  还没有分组方案。点击「生成分组方案」，由导演模型按 4–15s 规则分组并做连贯性核对。
                </p>
              ) : (
                <>
                  {!validation.ok && (
                    <ul className="space-y-1 rounded-md border border-red-500/30 bg-red-500/5 p-2">
                      {validation.errors.map((issue, index) => (
                        <li key={index} className="text-[11px] text-red-400">
                          {issue.description}
                        </li>
                      ))}
                    </ul>
                  )}
                  {selected?.episodeId === episode.episodeId && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-bg-elevated/60 p-2">
                      <span className="text-[11px] text-text-muted">
                        已选中 {shotById.get(selected.shotId)?.shotNo ?? selected.shotId}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => moveSelectedShot(episode, -1)}
                      >
                        ← 前移（到边界并入上一组）
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => moveSelectedShot(episode, 1)}
                      >
                        后移（到边界并入下一组）→
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => setSelected(null)}
                      >
                        取消选中
                      </Button>
                    </div>
                  )}
                  <div className="grid gap-3 md:grid-cols-2">
                    {draft.map((group, groupIndex) => {
                      const groupShots = group.shotIds
                        .map((id) => shotById.get(id))
                        .filter((shot): shot is GroupingShot => !!shot);
                      const total = Math.round(
                        groupShots.reduce((sum, shot) => sum + shotDurationSec(shot), 0) * 10,
                      ) / 10;
                      const outOfRange = total < 4 || total > 15;
                      const characters = summarizeGroupCharacters(
                        group,
                        shots,
                        looksWithNames,
                      );
                      return (
                        <div
                          key={groupIndex}
                          className={cn(
                            "space-y-2 rounded-md border p-3",
                            outOfRange
                              ? "border-red-500/40 bg-red-500/5"
                              : "border-border bg-bg-elevated/40",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-text-secondary">
                              第 {groupIndex + 1} 组
                              {groupShots.length > 0 &&
                                ` · ${groupShots[0].shotNo}–${groupShots[groupShots.length - 1].shotNo}`}
                            </span>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px]",
                                outOfRange
                                  ? "border-red-500/40 bg-red-500/10 text-red-400"
                                  : "border-border bg-bg-elevated text-text-muted",
                              )}
                            >
                              {total}s
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {group.shotIds.map((shotId) => {
                              const isSelected =
                                selected?.episodeId === episode.episodeId &&
                                selected.shotId === shotId;
                              return (
                                <button
                                  key={shotId}
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    setSelected(
                                      isSelected
                                        ? null
                                        : { episodeId: episode.episodeId, shotId },
                                    )
                                  }
                                  className={cn(
                                    "rounded border px-1.5 py-0.5 font-mono text-[10px]",
                                    isSelected
                                      ? "border-sky-500/60 bg-sky-500/15 text-sky-300"
                                      : "border-border bg-bg-elevated text-text-muted hover:text-text-secondary",
                                  )}
                                >
                                  {shotById.get(shotId)?.shotNo ?? shotId}
                                </button>
                              );
                            })}
                          </div>
                          {characters.length > 0 && (
                            <p className="text-[11px] text-text-muted">
                              角色：
                              {characters
                                .map((entry) => (entry.look ? `${entry.name}（${entry.look}）` : entry.name))
                                .join("、")}
                            </p>
                          )}
                          <Textarea
                            value={group.reason}
                            rows={2}
                            disabled={busy}
                            placeholder="分组理由（reason，必填）"
                            className="text-xs"
                            onChange={(event) =>
                              updateReason(episode, groupIndex, event.target.value)
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* 连贯性核对结论 + 确认关卡 */}
              {artifact && (
                <div className="border-t border-border pt-3">
                  <ArtifactApprovalPanel
                    title={`分组确认记录 · scope ${artifact.scope_hash?.slice(0, 8) ?? "-"}`}
                    verdict={artifact.verdict}
                    issues={(artifact.issues ?? []) as ArtifactIssue[]}
                    content={artifact.content}
                    userContent={artifact.user_content}
                    busy={artifactBusy || busy}
                    onApprove={(userContent) => handleApprove(episode, userContent)}
                    onReject={(feedback) => handleReject(episode, feedback)}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
