// ====================================================================
//  转绘 v2 阶段二 —— 双关卡审核面板
//
//  关卡 1（AI 自检）：runAiSelfReviewFn → verdict / issues / patched；
//  三表 tab：叙事一致性（narrative_issues）/ 逐镜对照（shot_mapping）/
//  时长台词复核（dialogue_fit），severity 颜色区分。
//  关卡 2（人工）：审核阶段产物（restyle_artifacts stage="review"）逐节点
//  经 ArtifactApprovalPanel 确认；底部「通过审核」批量 approve，
//  「打回重审」批量 reject（附意见）。
//  STAGE_NOT_APPROVED 时展示待完成节点清单。
// ====================================================================

import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  approveArtifactFn,
  listArtifactsFn,
  rejectArtifactFn,
  type ArtifactRow,
} from "@/lib/restyle/restyleArtifacts.functions";
import ArtifactApprovalPanel, {
  IssueList,
  VerdictBadge,
  severityBadgeClass,
  type ArtifactIssue,
} from "./ArtifactApprovalPanel";
import {
  getReviewReportFn,
  runAiSelfReviewFn,
  type ReviewDocKind,
  type ReviewReportRow,
} from "@/lib/restyle/restyleReview.functions";

const REVIEW_STAGE = "review";

type ReviewDocs = Record<ReviewDocKind, ReviewReportRow[]>;

interface TableTab {
  key: ReviewDocKind;
  label: string;
  hint: string;
}

const TABLE_TABS: TableTab[] = [
  { key: "narrative_issues", label: "叙事一致性", hint: "EP / 问题类型 / 当前表现 / 风险 / 校准建议" },
  { key: "shot_mapping", label: "逐镜对照", hint: "原片分镜与产出的逐镜对照" },
  { key: "dialogue_fit", label: "时长台词复核", hint: "台词朗读时长 ≤ shot 时长 − 0.5s，超出标红" },
];

/** 宽松渲染一张「表」：对象数组 → 表格；其他 → JSON。 */
function ReportTable({ data }: { data: unknown }) {
  if (data === null || data === undefined) {
    return <p className="text-xs text-text-muted">暂无数据，先运行 AI 自检。</p>;
  }
  if (Array.isArray(data) && data.length > 0 && data.every((r) => r && typeof r === "object" && !Array.isArray(r))) {
    const rows = data as Array<Record<string, unknown>>;
    const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {columns.map((col) => (
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
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border/50 align-top">
                {columns.map((col) => {
                  const value = row[col];
                  return (
                    <td key={col} className="px-2 py-1.5 text-text-secondary">
                      {col === "severity" && typeof value === "string" ? (
                        <Badge
                          variant="outline"
                          className={cn("text-[10px]", severityBadgeClass(value))}
                        >
                          {value}
                        </Badge>
                      ) : typeof value === "string" || typeof value === "number" ? (
                        <span className="whitespace-pre-wrap">{String(value)}</span>
                      ) : value === null || value === undefined ? (
                        <span className="text-text-muted">—</span>
                      ) : (
                        <code className="text-[11px]">{JSON.stringify(value)}</code>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (Array.isArray(data) && data.length === 0) {
    return <p className="text-xs text-text-muted">无记录。</p>;
  }
  return (
    <pre className="max-h-80 overflow-auto rounded-md bg-bg-elevated/60 p-2 text-[11px] leading-5 text-text-secondary">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export interface ReviewPanelProps {
  projectId: string;
  episodeId?: string;
  /** 审核产物状态变化后回调（用于上层刷新阶段闸门）。 */
  onArtifactsChanged?: () => void;
}

export default function ReviewPanel({ projectId, episodeId, onArtifactsChanged }: ReviewPanelProps) {
  const callListArtifacts = useServerFn(listArtifactsFn);
  const callApprove = useServerFn(approveArtifactFn);
  const callReject = useServerFn(rejectArtifactFn);

  const [docs, setDocs] = useState<ReviewDocs | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [pendingNodes, setPendingNodes] = useState<string[]>([]);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [issues, setIssues] = useState<ArtifactIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [acting, setActing] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reportResult, artifactsResult] = await Promise.all([
        getReviewReportFn({ data: { projectId, episodeId } }),
        callListArtifacts({ data: { projectId, stage: REVIEW_STAGE } }),
      ]);
      if (reportResult.ok) {
        setDocs(reportResult.docs);
      } else {
        setDocs(null);
        setError(reportResult.error ?? "获取审核报告失败。");
      }
      if (artifactsResult.ok) {
        setArtifacts(artifactsResult.artifacts);
        const withVerdict = artifactsResult.artifacts.find((a) => a.verdict);
        if (withVerdict) {
          setVerdict(withVerdict.verdict);
          setIssues((withVerdict.issues ?? []) as ArtifactIssue[]);
        }
      } else {
        setError(artifactsResult.error ?? "获取审核产物失败。");
      }
    } finally {
      setLoading(false);
    }
  }, [callListArtifacts, projectId, episodeId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRunReview = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await runAiSelfReviewFn({ data: { projectId, episodeId } });
      if (result.ok) {
        setVerdict(result.verdict);
        setPendingNodes([]);
        toast.success(`AI 自检完成：${result.verdict}，${result.issueCount} 个问题。`);
        await refresh();
      } else if (result.code === "STAGE_NOT_APPROVED") {
        setPendingNodes(result.pending ?? []);
        setError("前置阶段尚未全部确认，无法运行 AI 自检。");
      } else {
        setError(result.error ?? "AI 自检失败。");
      }
    } finally {
      setRunning(false);
    }
  };

  const handleApproveArtifact = async (artifact: ArtifactRow, userContent?: unknown) => {
    setActing(true);
    try {
      const result = await callApprove({
        data: {
          projectId,
          stage: REVIEW_STAGE,
          nodeKey: artifact.node_key,
          ...(userContent !== undefined ? { userContent } : {}),
        },
      });
      if (!result.ok) {
        toast.error(result.error ?? "确认失败。");
        return;
      }
      toast.success(`节点 ${artifact.node_key} 已确认。`);
      await refresh();
      onArtifactsChanged?.();
    } finally {
      setActing(false);
    }
  };

  const handleRejectArtifact = async (artifact: ArtifactRow, feedback: string) => {
    setActing(true);
    try {
      const result = await callReject({
        data: { projectId, stage: REVIEW_STAGE, nodeKey: artifact.node_key, feedback },
      });
      if (!result.ok) {
        toast.error(result.error ?? "打回失败。");
        return;
      }
      toast.success(`节点 ${artifact.node_key} 已打回。`);
      await refresh();
      onArtifactsChanged?.();
    } finally {
      setActing(false);
    }
  };

  const pendingArtifacts = artifacts.filter((a) => a.status !== "user_approved");

  const handleApproveAll = async () => {
    setActing(true);
    try {
      for (const artifact of pendingArtifacts) {
        const result = await callApprove({
          data: { projectId, stage: REVIEW_STAGE, nodeKey: artifact.node_key },
        });
        if (!result.ok) {
          toast.error(`节点 ${artifact.node_key} 确认失败：${result.error}`);
          break;
        }
      }
      toast.success("审核阶段产物已全部通过。");
      await refresh();
      onArtifactsChanged?.();
    } finally {
      setActing(false);
    }
  };

  const handleRejectAll = async () => {
    setActing(true);
    try {
      for (const artifact of pendingArtifacts) {
        await callReject({
          data: {
            projectId,
            stage: REVIEW_STAGE,
            nodeKey: artifact.node_key,
            feedback: rejectFeedback.trim() || undefined,
          },
        });
      }
      toast.success("已打回重审。");
      setRejectOpen(false);
      setRejectFeedback("");
      await refresh();
      onArtifactsChanged?.();
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="space-y-4">
      {pendingNodes.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="px-4 py-3">
            <p className="text-xs font-medium text-amber-400">
              前置阶段还有 {pendingNodes.length} 个节点未确认（STAGE_NOT_APPROVED）：
            </p>
            <ul className="mt-1 list-inside list-disc text-xs text-text-secondary">
              {pendingNodes.map((node) => (
                <li key={node}>{node}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 左列：AI 问题清单（三表） */}
        <Card className="border-border">
          <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">AI 审核结论</CardTitle>
              <VerdictBadge verdict={verdict} />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={running || loading}
              onClick={() => void handleRunReview()}
            >
              {running ? "自检中…" : "运行 AI 自检"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 px-4 pb-4">
            {error && <p className="text-xs text-red-400">{error}</p>}
            <Tabs defaultValue={TABLE_TABS[0].key}>
              <TabsList className="h-8">
                {TABLE_TABS.map((tab) => (
                  <TabsTrigger key={tab.key} value={tab.key} className="px-2.5 text-xs">
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {TABLE_TABS.map((tab) => (
                <TabsContent key={tab.key} value={tab.key} className="space-y-2 pt-2">
                  <p className="text-[11px] text-text-muted">{tab.hint}</p>
                  <ReportTable data={docs?.[tab.key]} />
                </TabsContent>
              ))}
            </Tabs>
            {issues.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-text-secondary">AI 问题清单</p>
                <div className="max-h-64 overflow-y-auto pr-1">
                  <IssueList issues={issues} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 右列：审核产物编辑与确认 */}
        <Card className="border-border">
          <CardHeader className="px-4 py-3">
            <CardTitle className="text-sm">产物编辑（人设 / 关系 / 分镜）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-4 pb-4">
            {artifacts.length === 0 && (
              <p className="text-xs text-text-muted">
                暂无审核阶段产物。运行 AI 自检后，产物会出现在这里供编辑确认。
              </p>
            )}
            {artifacts.map((artifact) => (
              <div key={artifact.id} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-text-secondary">
                    {artifact.node_key}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      artifact.status === "user_approved"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                        : artifact.status === "rejected"
                          ? "border-red-500/40 bg-red-500/10 text-red-400"
                          : "border-border bg-bg-elevated text-text-muted",
                    )}
                  >
                    {artifact.status}
                  </Badge>
                </div>
                <ArtifactApprovalPanel
                  verdict={artifact.verdict}
                  issues={(artifact.issues ?? []) as ArtifactIssue[]}
                  content={artifact.content}
                  userContent={artifact.user_content}
                  busy={acting}
                  onApprove={(userContent) => handleApproveArtifact(artifact, userContent)}
                  onReject={(feedback) => handleRejectArtifact(artifact, feedback)}
                />
              </div>
            ))}

            {artifacts.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <Button
                  type="button"
                  size="sm"
                  disabled={acting || pendingArtifacts.length === 0}
                  onClick={() => void handleApproveAll()}
                >
                  通过审核{pendingArtifacts.length > 0 && `（剩余 ${pendingArtifacts.length} 节点）`}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={acting || pendingArtifacts.length === 0}
                  onClick={() => setRejectOpen((v) => !v)}
                >
                  打回重审
                </Button>
              </div>
            )}
            {rejectOpen && (
              <div className="space-y-2 rounded-md border border-red-500/30 bg-red-500/5 p-2">
                <Textarea
                  value={rejectFeedback}
                  rows={3}
                  placeholder="打回意见（追加进各节点 issues）"
                  className="text-xs"
                  disabled={acting}
                  onChange={(e) => setRejectFeedback(e.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={acting}
                  onClick={() => void handleRejectAll()}
                >
                  确认打回
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
