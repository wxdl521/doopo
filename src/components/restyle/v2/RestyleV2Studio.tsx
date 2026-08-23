// ====================================================================
//  转绘 v2 工作台 —— /restyle/v2
//
//  流程骨架：项目选择/新建（标题 + 画风 style_brief）→ 集管理（多集上传，
//  浏览器端切片/抽帧/提音频/上传）→ 阶段导航（① 分析 → ② 审核 →
//  ③ 资产映射 → ④ 造型化生图，阶段 C 置灰待开放）。
//
//  阶段推进硬闸门：下一阶段按钮调 assertStageApprovedFn，未 user_approved
//  时置灰并在 tooltip 列出待确认节点（需求文档第五节「闸门硬约束」）。
// ====================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useMediaSelfHeal } from "../useMediaSelfHeal";
import { uploadLocalImage } from "@/lib/uploadImage.functions";
import { createMediaUploadUrl, signMediaReadUrl } from "@/lib/restyleMedia.functions";
import { submitEpisodeAnalysisFn } from "@/lib/restyle/restyleVideoAnalysis.functions";
import {
  approveArtifactFn,
  assertStageApprovedFn,
  listArtifactsFn,
  rejectArtifactFn,
  type ArtifactRow,
} from "@/lib/restyle/restyleArtifacts.functions";
import AnalysisProgressPanel from "./AnalysisProgressPanel";
import ArtifactApprovalPanel, { type ArtifactIssue } from "./ArtifactApprovalPanel";
import AssetMappingPanel from "./AssetMappingPanel";
import GroupingPanel from "./GroupingPanel";
import ImageGenPanel from "./ImageGenPanel";
import ReviewPanel from "./ReviewPanel";
import {
  MAX_SOURCE_FILE_BYTES,
  prepareEpisodeMedia,
  type PreparedUnit,
  type SlicingPhase,
  type UnitProgressEvent,
} from "./mediaSlicing";
import {
  createV2Episode,
  createV2Project,
  listV2EpisodeUnitStates,
  listV2Episodes,
  listV2Projects,
  updateV2EpisodeMedia,
  type RestyleV2Episode,
  type RestyleV2Project,
} from "./restyleV2Db";

// --------------------------------------------------------------------
// 阶段定义
// --------------------------------------------------------------------

type StageKey = "analysis" | "review" | "asset_mapping" | "image_gen" | "grouping";

interface StageNavItem {
  key: string;
  label: string;
  /** 进入该阶段前必须通过的前置闸门（artifact stage）。 */
  gateStage?: string;
  open: boolean;
  note?: string;
}

const STAGE_NAV: StageNavItem[] = [
  { key: "analysis", label: "① 分析", open: true },
  { key: "review", label: "② 审核", gateStage: "analysis", open: true },
  { key: "asset_mapping", label: "③ 资产映射", gateStage: "review", open: true },
  { key: "image_gen", label: "④ 造型化生图", gateStage: "asset_mapping", open: true },
  { key: "grouping", label: "⑤ 按集分组", gateStage: "image_gen", open: true },
  { key: "stage_c", label: "⑥ 阶段 C", open: false, note: "阶段 C 待开放" },
];

const PHASE_LABEL: Record<SlicingPhase, string> = {
  probe: "读取时长/切片",
  video_upload: "上传源视频",
  frames: "抽取关键帧",
  audio: "提取音频",
  upload: "上传单元媒体",
  done: "完成",
  error: "失败",
};

interface PrepJob {
  episodeId: string;
  episodeNo: number;
  fileName: string;
  status: "preparing" | "submitting" | "submitted" | "error";
  error?: string;
  /** unitIndex → 最新事件；-1 为整集级阶段。 */
  unitEvents: Record<number, UnitProgressEvent>;
}

interface GateState {
  checking: boolean;
  ok: boolean;
  pending: string[];
}

const INITIAL_GATE: GateState = { checking: false, ok: false, pending: [] };

export default function RestyleV2Studio() {
  // 媒体加载失败时先重签（workspace-media 签名 7 天过期）再判定失效。
  const rootRef = useRef<HTMLDivElement | null>(null);
  useMediaSelfHeal(rootRef);
  const callUpload = useServerFn(uploadLocalImage);
  const callCreateUploadUrl = useServerFn(createMediaUploadUrl);
  const callSignReadUrl = useServerFn(signMediaReadUrl);
  const callSubmitAnalysis = useServerFn(submitEpisodeAnalysisFn);
  const callAssertStage = useServerFn(assertStageApprovedFn);
  const callListArtifacts = useServerFn(listArtifactsFn);
  const callApprove = useServerFn(approveArtifactFn);
  const callReject = useServerFn(rejectArtifactFn);

  const [projects, setProjects] = useState<RestyleV2Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newStyleBrief, setNewStyleBrief] = useState("");
  const [creating, setCreating] = useState(false);

  const [episodes, setEpisodes] = useState<RestyleV2Episode[]>([]);
  const [stage, setStage] = useState<StageKey>("analysis");
  /** 按前置 stage 分别记录的闸门状态（analysis / review）。 */
  const [gates, setGates] = useState<Record<string, GateState>>({});

  const [prepJobs, setPrepJobs] = useState<PrepJob[]>([]);
  const [analysisRefreshKey, setAnalysisRefreshKey] = useState(0);
  const preparedUnitsRef = useRef<Record<string, PreparedUnit[]>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadQueueRef = useRef(Promise.resolve());

  const [analysisArtifacts, setAnalysisArtifacts] = useState<ArtifactRow[]>([]);
  const [artifactBusy, setArtifactBusy] = useState(false);

  const project = projects.find((p) => p.id === projectId) ?? null;

  // ------------------------------------------------------------------
  // 数据加载
  // ------------------------------------------------------------------

  useEffect(() => {
    void (async () => {
      const result = await listV2Projects();
      if (!result.ok) {
        setProjectsError(result.error);
        return;
      }
      setProjects(result.data);
      if (result.data.length > 0) setProjectId((prev) => prev ?? result.data[0].id);
    })();
  }, []);

  const refreshEpisodes = useCallback(async (pid: string) => {
    const result = await listV2Episodes(pid);
    if (result.ok) setEpisodes(result.data);
    else toast.error(`加载集列表失败：${result.error}`);
  }, []);

  useEffect(() => {
    if (projectId) void refreshEpisodes(projectId);
  }, [projectId, refreshEpisodes]);

  const refreshAnalysisArtifacts = useCallback(
    async (pid: string) => {
      const result = await callListArtifacts({ data: { projectId: pid, stage: "analysis" } });
      if (result.ok) setAnalysisArtifacts(result.artifacts);
    },
    [callListArtifacts],
  );

  useEffect(() => {
    if (projectId) void refreshAnalysisArtifacts(projectId);
  }, [projectId, refreshAnalysisArtifacts, analysisRefreshKey]);

  // ------------------------------------------------------------------
  // 阶段闸门
  // ------------------------------------------------------------------

  const checkGate = useCallback(
    async (pid: string, gateStage: string) => {
      setGates((prev) => ({
        ...prev,
        [gateStage]: { ...(prev[gateStage] ?? INITIAL_GATE), checking: true },
      }));
      try {
        const result = await callAssertStage({ data: { projectId: pid, stage: gateStage } });
        setGates((prev) => ({
          ...prev,
          [gateStage]: result.ok
            ? { checking: false, ok: true, pending: [] }
            : { checking: false, ok: false, pending: result.pending ?? [] },
        }));
        return result.ok;
      } catch {
        setGates((prev) => ({
          ...prev,
          [gateStage]: { checking: false, ok: false, pending: [] },
        }));
        return false;
      }
    },
    [callAssertStage],
  );

  const refreshGate = useCallback(() => {
    if (!projectId) return;
    void checkGate(projectId, "analysis");
    void checkGate(projectId, "review");
    void checkGate(projectId, "asset_mapping");
    void checkGate(projectId, "image_gen");
  }, [projectId, checkGate]);

  useEffect(() => {
    refreshGate();
  }, [refreshGate, analysisRefreshKey, analysisArtifacts]);

  // ------------------------------------------------------------------
  // 项目创建
  // ------------------------------------------------------------------

  const handleCreateProject = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const result = await createV2Project(newTitle, newStyleBrief);
      if (!result.ok) {
        toast.error(`创建项目失败：${result.error}`);
        return;
      }
      setProjects((prev) => [result.data, ...prev]);
      setProjectId(result.data.id);
      setCreateOpen(false);
      setNewTitle("");
      setNewStyleBrief("");
      toast.success("项目已创建。");
    } finally {
      setCreating(false);
    }
  };

  // ------------------------------------------------------------------
  // 上传 + 媒体处理 + 提交分析（串行队列，避免大文件并发占内存）
  // ------------------------------------------------------------------

  const updateJob = (episodeId: string, patch: Partial<PrepJob>) => {
    setPrepJobs((prev) => prev.map((j) => (j.episodeId === episodeId ? { ...j, ...patch } : j)));
  };

  const processFile = async (file: File, episodeNo: number) => {
    if (!projectId) return;
    if (file.size > MAX_SOURCE_FILE_BYTES) {
      toast.error(
        `${file.name} 超过 ${Math.round(MAX_SOURCE_FILE_BYTES / 1024 / 1024)}MB 上限，已跳过。`,
      );
      return;
    }
    const created = await createV2Episode(projectId, episodeNo);
    if (!created.ok) {
      toast.error(`创建第 ${episodeNo} 集失败：${created.error}`);
      return;
    }
    const episodeId = created.data.id;
    setPrepJobs((prev) => [
      ...prev,
      { episodeId, episodeNo, fileName: file.name, status: "preparing", unitEvents: {} },
    ]);
    void refreshEpisodes(projectId);

    try {
      const prepared = await prepareEpisodeMedia(file, {
        episodeId,
        upload: (input) => callUpload({ data: input }),
        createUploadUrl: (input) => callCreateUploadUrl({ data: input }),
        signReadUrl: (input) => callSignReadUrl({ data: input }),
        onProgress: (event) => {
          setPrepJobs((prev) =>
            prev.map((j) =>
              j.episodeId === episodeId
                ? { ...j, unitEvents: { ...j.unitEvents, [event.unitIndex]: event } }
                : j,
            ),
          );
        },
      });
      preparedUnitsRef.current[episodeId] = prepared.units;
      await updateV2EpisodeMedia(episodeId, prepared.videoUrl, prepared.durationSec);

      updateJob(episodeId, { status: "submitting" });
      const result = await callSubmitAnalysis({
        data: { projectId, episodeId, units: prepared.units },
      });
      if (!result.ok) {
        updateJob(episodeId, { status: "error", error: result.error });
        toast.error(`第 ${episodeNo} 集分析提交失败：${result.error}`);
      } else {
        updateJob(episodeId, { status: "submitted" });
        if (result.unitsFailed > 0) {
          toast.warning(
            `第 ${episodeNo} 集有 ${result.unitsFailed} 个单元分析失败，可在进度卡中重跑。`,
          );
        } else {
          toast.success(`第 ${episodeNo} 集分析完成。`);
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      updateJob(episodeId, { status: "error", error: message });
      toast.error(`第 ${episodeNo} 集处理失败：${message}`);
    } finally {
      setAnalysisRefreshKey((k) => k + 1);
      void refreshEpisodes(projectId);
    }
  };

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || !projectId) return;
    const list = Array.from(files);
    const baseNo = episodes.reduce((max, ep) => Math.max(max, ep.episode_no), 0);
    // 串行处理：大文件 base64 + 音频解码内存占用高
    uploadQueueRef.current = list.reduce(
      (queue, file, i) => queue.then(() => processFile(file, baseNo + i + 1)),
      uploadQueueRef.current,
    );
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ------------------------------------------------------------------
  // 失败单元重跑
  // ------------------------------------------------------------------

  const handleRetryFailed = async (episode: { episodeId: string }): Promise<string | null> => {
    if (!projectId) return "未选择项目。";
    const units = preparedUnitsRef.current[episode.episodeId];
    if (!units || units.length === 0) {
      return "该集的媒体信息不在当前会话中（页面刷新后丢失），请重新上传该集视频再分析。";
    }
    const states = await listV2EpisodeUnitStates(episode.episodeId);
    if (!states.ok) return states.error;
    const failedIds = states.data.filter((u) => u.status === "failed").map((u) => u.unitId);
    if (failedIds.length === 0) return "没有失败单元。";
    const result = await callSubmitAnalysis({
      data: { projectId, episodeId: episode.episodeId, units, unitIds: failedIds },
    });
    if (!result.ok) return result.error;
    setAnalysisRefreshKey((k) => k + 1);
    return null;
  };

  // ------------------------------------------------------------------
  // 分析阶段产物确认
  // ------------------------------------------------------------------

  const handleApproveArtifact = async (artifact: ArtifactRow, userContent?: unknown) => {
    if (!projectId) return;
    setArtifactBusy(true);
    try {
      const result = await callApprove({
        data: {
          projectId,
          stage: artifact.stage,
          nodeKey: artifact.node_key,
          ...(userContent !== undefined ? { userContent } : {}),
        },
      });
      if (!result.ok) toast.error(result.error ?? "确认失败。");
      else {
        toast.success(`节点 ${artifact.node_key} 已确认。`);
        await refreshAnalysisArtifacts(projectId);
      }
    } finally {
      setArtifactBusy(false);
    }
  };

  const handleRejectArtifact = async (artifact: ArtifactRow, feedback: string) => {
    if (!projectId) return;
    setArtifactBusy(true);
    try {
      const result = await callReject({
        data: { projectId, stage: artifact.stage, nodeKey: artifact.node_key, feedback },
      });
      if (!result.ok) toast.error(result.error ?? "打回失败。");
      else {
        toast.success(`节点 ${artifact.node_key} 已打回重生成。`);
        await refreshAnalysisArtifacts(projectId);
      }
    } finally {
      setArtifactBusy(false);
    }
  };

  // ------------------------------------------------------------------
  // 阶段导航
  // ------------------------------------------------------------------

  const handleEnterStage = async (item: StageNavItem) => {
    if (!item.open || !projectId) return;
    if (item.gateStage) {
      const ok = await checkGate(projectId, item.gateStage);
      if (!ok) {
        toast.error("前置阶段还有节点未确认，无法推进。");
        return;
      }
    }
    setStage(item.key as StageKey);
  };

  // ------------------------------------------------------------------
  // 渲染
  // ------------------------------------------------------------------

  const gateTooltipFor = (gateStage: string): string => {
    const state = gates[gateStage] ?? INITIAL_GATE;
    return state.ok
      ? "前置节点已全部确认"
      : state.pending.length > 0
        ? `待确认节点：${state.pending.join("、")}`
        : "该阶段暂无已确认产物";
  };
  const analysisGate = gates.analysis ?? INITIAL_GATE;

  return (
    <div ref={rootRef} className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      {/* 页头：项目选择 / 新建 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">转绘 v2 工作台</h1>
          <p className="text-xs text-text-muted">
            分析 → 审核 → 造型化生图 → 分组 → 分段生成，逐节点确认推进。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={projectId ?? undefined} onValueChange={setProjectId}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="选择项目" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            新建项目
          </Button>
        </div>
      </div>

      {projectsError && (
        <p className="text-xs text-red-400">项目列表加载失败：{projectsError}</p>
      )}

      {/* 阶段导航 */}
      <div className="flex flex-wrap items-center gap-2">
        {STAGE_NAV.map((item) => {
          const active = item.key === stage;
          const itemGate = item.gateStage ? (gates[item.gateStage] ?? INITIAL_GATE) : null;
          return (
            <Tooltip key={item.key}>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    disabled={!item.open || !projectId || (itemGate != null && !itemGate.ok)}
                    onClick={() => void handleEnterStage(item)}
                  >
                    {item.label}
                    {!item.open && item.note && (
                      <span className="ml-1 text-[10px] opacity-70">待开放</span>
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {!item.open
                  ? item.note
                  : item.gateStage && itemGate && !itemGate.ok
                    ? gateTooltipFor(item.gateStage)
                    : item.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {!project && (
        <Card className="border-border">
          <CardContent className="px-4 py-10 text-center text-sm text-text-muted">
            选择或新建一个转绘项目开始。
          </CardContent>
        </Card>
      )}

      {project && stage === "analysis" && (
        <div className="space-y-6">
          {/* 集管理：上传 */}
          <Card className="border-border">
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-sm">集管理</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  上传视频（可多集）
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFilesSelected(e.target.files)}
                />
                <span className="text-xs text-text-muted">
                  单文件 ≤ {Math.round(MAX_SOURCE_FILE_BYTES / 1024 / 1024)}MB；
                  上传后自动切片、抽帧、提取音频并提交分析。
                </span>
              </div>

              {episodes.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {episodes.map((ep) => {
                    const job = prepJobs.find((j) => j.episodeId === ep.id);
                    return (
                      <li key={ep.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm text-text-secondary">第 {ep.episode_no} 集</p>
                          {job && (
                            <p className="truncate text-xs text-text-muted">
                              {job.fileName} ·{" "}
                              {job.status === "preparing" &&
                                (job.unitEvents[-1]
                                  ? PHASE_LABEL[job.unitEvents[-1].phase]
                                  : (() => {
                                      const events = Object.values(job.unitEvents);
                                      const latest = events[events.length - 1];
                                      return latest
                                        ? `单元 ${latest.unitId}：${PHASE_LABEL[latest.phase]}`
                                        : "准备中";
                                    })())}
                              {job.status === "submitting" && "提交分析中…"}
                              {job.status === "submitted" && "已提交分析"}
                              {job.status === "error" && (
                                <span className="text-red-400">{job.error}</span>
                              )}
                            </p>
                          )}
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            "shrink-0 text-[10px]",
                            ep.analysis_status === "succeeded"
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                              : ep.analysis_status === "failed"
                                ? "border-red-500/40 bg-red-500/10 text-red-400"
                                : ep.analysis_status === "running"
                                  ? "border-sky-500/40 bg-sky-500/10 text-sky-400"
                                  : "border-border bg-bg-elevated text-text-muted",
                          )}
                        >
                          {ep.analysis_status}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* 逐集进度 */}
          <div>
            <h2 className="mb-2 text-sm font-medium text-text-secondary">分析进度</h2>
            <AnalysisProgressPanel
              projectId={project.id}
              onRetryFailed={handleRetryFailed}
              refreshKey={analysisRefreshKey}
            />
          </div>

          {/* 分析产物确认 */}
          <div>
            <h2 className="mb-2 text-sm font-medium text-text-secondary">分析产物确认</h2>
            {analysisArtifacts.length === 0 ? (
              <p className="text-xs text-text-muted">
                分析完成后，分析 JSON 产物会在这里列出；全部确认（user_approved）才能进入审核阶段。
              </p>
            ) : (
              <div className="space-y-3">
                {analysisArtifacts.map((artifact) => (
                  <Card key={artifact.id} className="border-border">
                    <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3">
                      <CardTitle className="text-sm">{artifact.node_key}</CardTitle>
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
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <ArtifactApprovalPanel
                        verdict={artifact.verdict}
                        issues={(artifact.issues ?? []) as ArtifactIssue[]}
                        content={artifact.content}
                        userContent={artifact.user_content}
                        busy={artifactBusy}
                        onApprove={(userContent) => handleApproveArtifact(artifact, userContent)}
                        onReject={(feedback) => handleRejectArtifact(artifact, feedback)}
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* 阶段闸门 */}
          <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
            {!analysisGate.ok && !analysisGate.checking && (
              <span className="text-xs text-text-muted">{gateTooltipFor("analysis")}</span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    type="button"
                    disabled={!analysisGate.ok || analysisGate.checking}
                    onClick={() => void handleEnterStage(STAGE_NAV[1])}
                  >
                    {analysisGate.checking ? "检查闸门中…" : "下一步：审核"}
                  </Button>
                </span>
              </TooltipTrigger>
              {!analysisGate.ok && (
                <TooltipContent>
                  <p>{gateTooltipFor("analysis")}</p>
                </TooltipContent>
              )}
            </Tooltip>
          </div>
        </div>
      )}

      {project && stage === "review" && (
        <ReviewPanel projectId={project.id} onArtifactsChanged={refreshGate} />
      )}

      {project && stage === "asset_mapping" && (
        <AssetMappingPanel projectId={project.id} onArtifactsChanged={refreshGate} />
      )}

      {project && stage === "image_gen" && (
        <ImageGenPanel projectId={project.id} onArtifactsChanged={refreshGate} />
      )}

      {project && stage === "grouping" && (
        <GroupingPanel projectId={project.id} onArtifactsChanged={refreshGate} />
      )}

      {/* 新建项目对话框 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建转绘项目</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="v2-project-title">标题</Label>
              <Input
                id="v2-project-title"
                value={newTitle}
                placeholder="如：都市爱情短剧 第一季"
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v2-project-style">画风（style_brief）</Label>
              <Textarea
                id="v2-project-style"
                value={newStyleBrief}
                rows={4}
                placeholder="如：日系赛璐璐、线条干净、配色低饱和、夜景偏蓝紫"
                onChange={(e) => setNewStyleBrief(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={creating || !newTitle.trim()}
              onClick={() => void handleCreateProject()}
            >
              {creating ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
