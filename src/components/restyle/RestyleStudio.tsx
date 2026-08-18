import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactEventHandler,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  ChevronDown,
  Download,
  FileText,
  Folder,
  FolderOpen,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useLanguage } from "../../i18n/LanguageContext";
import { SegmentRerunDialog } from "./SegmentRerunDialog";
import type { Translations } from "../../i18n/zh";
import { useAuth } from "../../hooks/useAuth";
import { loadCharacters, loadProps, loadScenes } from "../../lib/assetsStorage";
import { libraryAssetsFromRows } from "./restyleAssetLibrary";
import {
  loadRestyleProjects,
  saveRestyleProjects,
  type RestyleAttachment,
  type RestyleAnalysisSections,
  type RestyleCharacterRelation,
  type RestyleConversation,
  type RestyleExtractedAsset,
  type RestyleProject,
  type RestyleRenderStatus,
} from "./restyleStorage";
import type { RestyleAsset, RestyleStage } from "./restyleTypes";
import { analyzeRestyleAssets, generateRestylePlan } from "../../lib/restyleAnalysis.functions";
import { finalizeRestylePlanCoverage } from "../../lib/restyleAnalysis.functions";
import {
  analyzeRestyleSourceUnits,
  type RestyleSourceUnitsFileResult,
} from "../../lib/restyleSourceUnits.functions";
import { runWithConcurrency } from "../../lib/restyle/restyleVideoAnalysis.functions";
import {
  isRetryableUploadError,
  prepareEpisodeMedia,
  withUploadRetry,
  type UnitProgressEvent,
} from "./v2/mediaSlicing";
import { mergeSourceUnitResults, renumberShotSchedule } from "./sourceUnitsMerge";
import {
  buildPlanWindowJobs,
  PLAN_WINDOW_SEC,
  resolvePlanWindowDurationMs,
  restylePlanWindowChargeKey,
} from "../../lib/restyle/planWindows";
import { driveWindowedPlanCalls } from "./planWindowDriver";
import { isSupersededClipAttachment, withoutSupersededClips } from "./rerunAttachments";
import {
  applyRunOutcomesToFiles,
  collectRerunEpisodes,
  dedupeClipsBySegment,
  episodeRestitchEligibility,
  outcomeLabel,
  summarizeRenderRun,
  type RenderRunOutcome,
} from "./renderRunSummary";
import { createRunOutcomeLedger } from "./runOutcomeLedger";
import { isPendingRerun, shiftPendingRerun } from "./pendingReruns";
import {
  imageModelFallbackCandidates,
  isQuotaLikeImageError,
  isTransientNetworkImageError,
} from "./imageModelFallback";
import { segmentIndexFromId, withSegmentDirection } from "../../lib/restyle/shotSchedule";
import { formatLightingParams, type DirectionShot } from "../../lib/restyle/cameraDirection";
import {
  mergeInsertClips,
  planInsertJobs,
  runInsertJobs,
  type AnchoredInsert,
  type InsertClipResult,
  type InsertJob,
} from "./restyleInserts";
import { transcribeRestyleAudio } from "../../lib/restyleAudio.functions";
import {
  pollVideoStitchJob,
  pollVideoTrimJob,
  submitVideoStitchJob,
  submitVideoTrimJob,
} from "../../lib/videoStitch.functions";
import {
  ensureSegmentReferenceClip,
  estimateSourceDurationMs,
  rangesFromSceneGroups,
  resolveSegmentTimeRange,
  trimCacheKey,
  withBackoffRetry,
} from "../../lib/restyle/segmentReference";
import { transcribeSourceVideo } from "./restyleTranscript";
import { reviewRestyleAssetTable } from "../../lib/restyle/restyleAssetReview.functions";
import type { AssetReviewIssue, AssetReviewVerdict } from "../../lib/restyle/assetReview";
import {
  validateCharacterRelations,
  withCompletedReverseRelations,
} from "../../lib/restyle/relationValidate";
import { generateImage, generateImageWithReferences } from "../../lib/seedream.functions";
import {
  pollVideoTaskFn,
  submitVideoTaskFn,
  uploadJieyunAsset,
  uploadKeyiyunAsset,
  uploadTokenponyAsset,
  uploadTopenrouterAsset,
} from "../../lib/videoGenerate.functions";
import {
  assetLibraryVendorForModel,
  buildRestyleVideoContent,
  getVideoAssetLibrarySupport,
  isR2vDurationError,
  isSensitiveContentError,
  planRestyleFallback,
  referenceVideoLimitsForModel,
  RESTYLE_FALLBACK_EXHAUSTED_MESSAGE,
  restyleAssetCacheKey,
  r2vDurationLimitsForModel,
  r2vDurationRetryLadder,
  type RestyleFallbackStage,
} from "../../lib/videoAssetLibrary";
import { uploadLocalImage } from "../../lib/uploadImage.functions";
import { refundChargedCredits } from "../../lib/userCredits.functions";
import { reportGenerationError } from "../../lib/errorLogs.functions";
import { createMediaUploadUrl, signMediaReadUrl } from "../../lib/restyleMedia.functions";
import { persistAssetImage } from "../../lib/workspaceMedia.functions";
import { persistRestyleVideo } from "../../lib/restyleMedia.functions";
import { realImageModelOptions, realVideoModels } from "../NewProjectDialog";
import { useListedModels } from "../../hooks/useListedModels";
import {
  formatModelOptionLabel,
  resolveDefaultModel,
  sortListedModels,
} from "../../hooks/modelOptions";
import {
  busyMessageAction,
  isConfirmIntent,
  isReanalyzeIntent,
  isAssetImageIntent,
  isRegenerateIntent,
  isReplanIntent,
  isVideoRenderIntent,
  parseSegmentRerunIntent,
  type SegmentRerunIntent,
} from "./restyleIntent";
import {
  buildRelationBrief,
  looksLikeStyleBrief,
  resolveAssetImagePrompt,
  withStyleBrief,
  withTranscript,
  type CharacterRelationBrief,
} from "./restylePrompt";
import {
  ActionCallout,
  AssetConfirmationGuide,
  ImageGenerationModeGuide,
  extractActionPhrases,
  findPendingActionPhrase,
} from "./ActionCallout";
import { ExtractedAssetTable } from "./ExtractedAssetTable";
import { CharacterRelationTable } from "./CharacterRelationTable";
import { RestyleProcessPanel, type RestyleAssetRunStatus } from "./RestyleProcessPanel";
import {
  isSourceVideoFile,
  nextEpisodeLabels,
  shouldUseDirectUpload,
  uploadFileDirect,
  attachmentReadSource,
  type DirectUploadState,
} from "./restyleUpload";
import { probeVideoDuration } from "./v2/mediaSlicing";
import {
  buildMentionables,
  resolveMentionedAttachmentIds,
  type MentionableAttachment,
} from "./restyleMentions";
import { toast } from "sonner";
import { listModelPricing } from "../../lib/modelPricing.functions";
import type { ModelPricingRow } from "../../lib/modelPricingCache";
import {
  RestyleSetupPanel,
  RestyleSpecCard,
  pricingForVideoModel,
  type RestyleSetupPatch,
} from "./RestyleSetupPanel";
import {
  isInsufficientCreditsError,
  isOverBudget,
  resolveExecutionConfig,
  shouldPauseAt,
  type RestyleAspect,
  type RestyleExecutionConfig,
  type RestyleGateId,
} from "./restyleExecution";

type AssetLibraryStatus = "idle" | "loading" | "ready" | "error";
type RestyleView = "workbench" | "canvas";

/** 右栏分段 Tab：设置 / 流程 / 文件，每次只渲染一块内容。 */
type RestyleRailTab = "setup" | "process" | "files";
const RESTYLE_RAIL_TAB_STORAGE_KEY = "doopoo:restyle:rail-tab";

/** 读出按 projectId 记忆的右栏 Tab；非法条目丢弃，localStorage 不可用（SSR）时返回空表。 */
function readRestyleRailTabs(): Record<string, RestyleRailTab> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(RESTYLE_RAIL_TAB_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const tabs: Record<string, RestyleRailTab> = {};
    for (const [projectId, tab] of Object.entries(parsed as Record<string, unknown>)) {
      if (tab === "setup" || tab === "process" || tab === "files") tabs[projectId] = tab;
    }
    return tabs;
  } catch {
    return {};
  }
}

/** 单个执行步骤：用于把 Agent 的处理过程直接呈现在对话流里。 */
type RestyleRunStep = {
  id: string;
  label: string;
  detail?: string;
  status: "running" | "done" | "failed";
  at: number;
};

/** 项目级执行态。以项目 id 为键存放，实现多项目并发与独立停止。 */
type RestyleRunState = {
  running: boolean;
  startedAt: number;
  endedAt?: number;
  stopped?: boolean;
  steps: RestyleRunStep[];
};

// Older restyle projects stored the raw database id while newer projects use
// the kind-prefixed id (for example, `character:<uuid>`). Treat both forms as
// the same asset so existing projects do not render an empty canvas.
function isRestyleAssetLinked(assetId: string, linkedIds: string[]): boolean {
  if (linkedIds.includes(assetId)) return true;
  const rawId = assetId.replace(/^[^:]+:/, "");
  return rawId !== assetId && linkedIds.includes(rawId);
}
const RESTYLE_MODELS = [
  { id: "ark:deepseek-v4-pro-260425", label: "DeepSeek V4 Pro" },
  { id: "ark:doubao-seed-2-1-pro-260628", label: "Doubao Seed 2.1 Pro" },
  { id: "qwen:qwen3.6-plus", label: "Qwen 3.6 Plus · 视觉" },
  { id: "qwen:qwen3.6-flash", label: "Qwen 3.6 Flash · 视觉" },
  { id: "qwen:qwen3.7-max", label: "Qwen 3.7 Max" },
  { id: "lovable:openai/gpt-5.5", label: "GPT-5.5 · 视觉" },
  { id: "jingmei:gpt-5.5", label: "GPT-5.5 (jingmei)" },
  { id: "jingmei:gpt-5.6-sol", label: "GPT-5.6 Sol (jingmei)" },
] as const;

function relabelRestyleError(error: string, model: RestyleModel): string {
  const label = RESTYLE_MODELS.find((item) => item.id === model)?.label ?? model;
  return error.replace("DeepSeek V4 Pro", label).replace("DeepSeek", label);
}

type RestyleModel = (typeof RESTYLE_MODELS)[number]["id"];

// 支持素材库预审（真人素材审核）的视频模型排最前：真人参考图直接以
// 公网 URL 提交会触发上游风控，素材库通道（asset:// 引用）是官方规避路径。
const RESTYLE_VIDEO_MODELS = [...realVideoModels].sort(
  (a, b) =>
    Number(getVideoAssetLibrarySupport(b.id).supported) -
    Number(getVideoAssetLibrarySupport(a.id).supported),
);
// 默认视频模型：TopenRouter 中转的 Seedance 2.0（支持素材库预审，真人参考图的
// 官方规避路径）；取不到时回退任意支持素材库的模型。
const DEFAULT_RESTYLE_VIDEO_MODEL =
  RESTYLE_VIDEO_MODELS.find((model) => model.id === "topenrouter-doubao-seedance-2-0-260128")?.id ??
  RESTYLE_VIDEO_MODELS.find((model) => getVideoAssetLibrarySupport(model.id).supported)?.id ??
  realVideoModels[0]?.id ??
  "doubao-seedance-2-0-260128";
// 默认生图模型：Azure gpt-image-2 终结点。tokenflash 渠道曾余额归零导致全量 403，
// Azure 渠道实测稳定（配额类失败另有 imageModelFallback 自动换渠道兜底）。
const DEFAULT_RESTYLE_IMAGE_MODEL = realImageModelOptions.some(
  (model) => model.id === "azure2/gpt-image-2",
)
  ? "azure2/gpt-image-2"
  : (realImageModelOptions[0]?.id ?? "azure2/gpt-image-2");
type RestyleFilePreview =
  | {
      kind: "attachment";
      key: string;
      title: string;
      attachment: RestyleAttachment;
      /** 预览归属的项目：渲染前校验，归属不符一律不显示，防止串项目。 */
      projectId?: string | null;
    }
  | {
      kind: "virtual";
      key: string;
      title: string;
      mime: "application/json" | "text/markdown" | "text/plain";
      content: string;
      /** 预览归属的项目：渲染前校验，归属不符一律不显示，防止串项目。 */
      projectId?: string | null;
    };

type RestyleFileTreeNode = {
  id: string;
  label: string;
  kind: "folder" | "file";
  count?: number;
  size?: number;
  children?: RestyleFileTreeNode[];
  preview?: RestyleFilePreview;
};

type RestyleFileDropPosition = "before" | "inside" | "after";

type RestyleFileDropTarget = {
  nodeId: string;
  position: RestyleFileDropPosition;
};

type RestyleFileDropRequest = {
  targetNode: RestyleFileTreeNode;
  parentNodeId: string | null;
  position: RestyleFileDropPosition;
};

type RestyleVideoPair = {
  source: RestyleAttachment;
  result: RestyleAttachment;
  sourceUrl?: string;
  resultUrl?: string;
};

/** 一次局部/整集返工请求：聊天点名与右侧「返工/重试」按钮共用。 */
type RestyleRerunRequest = {
  episode: string;
  segmentId?: string;
  feedback: string;
  sourceAttachmentId?: string;
  rerunOfAttachmentId?: string;
  referenceAssetIds?: string[];
};

function formatFileSize(size?: number): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function countTreeLeaves(nodes: RestyleFileTreeNode[] = []): number {
  return nodes.reduce(
    (total, node) => total + (node.kind === "file" ? 1 : countTreeLeaves(node.children ?? [])),
    0,
  );
}

function renderStatusLabel(status?: RestyleRenderStatus): string {
  if (status === "queued") return "排队中";
  if (status === "running") return "生成中";
  if (status === "succeeded") return "已完成";
  if (status === "failed") return "失败";
  return "未开始";
}

function makeRenderTaskId(videoId: string, segmentId?: string): string {
  const suffix = segmentId ? `${videoId}-${segmentId}` : `${videoId}-final`;
  return `render-${suffix}-${crypto.randomUUID().slice(0, 8)}`;
}

function stableVideoUrlFor(file: RestyleAttachment): string | undefined {
  return file.resultUrl || file.url;
}

function makeVirtualPreview(
  key: string,
  title: string,
  mime: "application/json" | "text/markdown" | "text/plain",
  content: string,
): Extract<RestyleFilePreview, { kind: "virtual" }> {
  return { kind: "virtual", key, title, mime, content };
}

/** 给文件树里的预览统一打上项目归属，渲染前按 activeProjectId 校验。 */
function stampPreviewProjectId(
  nodes: RestyleFileTreeNode[],
  projectId: string | null,
): RestyleFileTreeNode[] {
  return nodes.map((node) => ({
    ...node,
    preview: node.preview ? { ...node.preview, projectId } : node.preview,
    children: node.children ? stampPreviewProjectId(node.children, projectId) : node.children,
  }));
}

function AssetVisual({ asset, compact = false }: { asset: RestyleAsset; compact?: boolean }) {
  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br ${asset.color} ${compact ? "h-16" : "h-32"}`}
    >
      {asset.imageUrl ? (
        <img src={asset.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute -bottom-8 left-1/2 h-28 w-20 -translate-x-1/2 rounded-t-[44%] border border-white/20 bg-white/10 backdrop-blur-sm" />
      )}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_18%,rgba(255,255,255,.25),transparent_28%),linear-gradient(135deg,transparent_40%,rgba(0,0,0,.34))]" />
    </div>
  );
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  event: "loadedmetadata" | "seeked",
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("读取视频关键帧超时"));
    }, 12_000);
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("无法读取视频内容"));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener(event, onSuccess);
      video.removeEventListener("error", onError);
    };
    video.addEventListener(event, onSuccess, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

/**
 * Build a timeline sample across the whole source, rather than only a handful of
 * keyframes.  The source video remains local; compact frames give the analysis
 * model coverage of plot changes, dialogue beats and continuity.
 */
async function extractVideoKeyFrames(file: File): Promise<string[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "metadata";
  video.src = url;
  try {
    await waitForVideoEvent(video, "loadedmetadata");
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.videoWidth <= 0) return [];
    const scale = Math.min(1, 480 / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return [];
    // Keep the server-function payload small enough for vision requests. The
    // source video is still covered from beginning to end, but eight compact
    // frames are more reliable than sending a 10+ MB base64 payload.
    const sampleCount = Math.min(8, Math.max(4, Math.ceil(video.duration / 20)));
    const positions = Array.from({ length: sampleCount }, (_, index) =>
      Math.min(
        Math.max(0.05, video.duration * ((index + 0.5) / sampleCount)),
        Math.max(0, video.duration - 0.05),
      ),
    );
    const frames: string[] = [];
    for (const position of positions) {
      video.currentTime = Math.min(position, Math.max(0, video.duration - 0.05));
      await waitForVideoEvent(video, "seeked");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL("image/jpeg", 0.32);
      if (image.length <= 180_000) frames.push(image);
    }
    return frames;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * 重跑分析时取回源视频 File：优先命中内存映射（同一会话），
 * 未命中则通过持久 URL（ensureReferenceVideoUrl 已写回 project.files[].url）
 * fetch 回 Blob 重建 File，并回填内存映射供后续转写/重跑直接命中。
 */
export async function resolveSourceVideoFile(
  attachment: RestyleAttachment,
  fileObjects: Record<string, File | undefined>,
  ensureUrl: (
    file: RestyleAttachment,
  ) => Promise<{ ok: true; url: string } | { ok: false; error: string }>,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; file: File; restored: boolean } | { ok: false; error: string }> {
  const local = fileObjects[attachment.id];
  if (local) return { ok: true, file: local, restored: false };
  const ensured = await ensureUrl(attachment);
  if (!ensured.ok) return { ok: false, error: ensured.error };
  try {
    const response = await fetchImpl(ensured.url);
    if (!response.ok) {
      return { ok: false, error: `原片取回失败（HTTP ${response.status}）。` };
    }
    const blob = await response.blob();
    const file = new File([blob], attachment.name, {
      type: attachment.type || blob.type,
      lastModified: attachment.lastModified || Date.now(),
    });
    fileObjects[attachment.id] = file;
    return { ok: true, file, restored: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "原片取回失败。" };
  }
}

/**
 * 三级回退：原片取不回时，复用首轮分析持久化的 analysisFrame 关键帧附件 url
 * 作为 frameImages（仅限 episodeKeys 对应的源视频）。
 */
export function cachedAnalysisFrames(files: RestyleAttachment[], episodeKeys: string[]): string[] {
  const wanted = new Set(episodeKeys);
  return files
    .filter(
      (file) =>
        file.analysisFrame === true &&
        typeof file.url === "string" &&
        wanted.has(file.analysisEpisode ?? ""),
    )
    .map((file) => file.url as string)
    .slice(0, 8);
}

async function extractVideoThumbnail(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "metadata";
  video.playsInline = true;
  video.src = url;
  try {
    await waitForVideoEvent(video, "loadedmetadata");
    if (!Number.isFinite(video.duration) || video.videoWidth <= 0) return "";
    const scale = Math.min(1, 640 / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return "";
    video.currentTime = Math.min(
      Math.max(0.05, video.duration * 0.08),
      Math.max(0, video.duration - 0.05),
    );
    await waitForVideoEvent(video, "seeked");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("无法读取参考图"));
    reader.readAsDataURL(file);
  });
}

function assetMarkdownTable(assets: RestyleExtractedAsset[]): string {
  if (!assets.length) return "# 资产确认表\n\n暂无资产。";
  const rows = assets.map(
    (asset) =>
      `| ${asset.kind} | ${asset.sourceName} | ${asset.sourceDescription} | ${asset.targetName} | ${asset.targetDescription} | ${asset.importance} | ${asset.shouldRestyle ? "是" : "否"} |`,
  );
  return [
    "# 资产确认表",
    "",
    "| 类型 | 原片名称 | 原片定位 | 目标名称 | 目标说明 | 重要性 | 需要转绘 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function groupedAttachmentNodes(files: RestyleAttachment[]): RestyleFileTreeNode[] {
  const sourceFiles = files.filter(
    (file) => !file.generatedKind && !file.analysisFrame && !file.isFolder,
  );
  const folders = files.filter(
    (file) => !file.generatedKind && !file.analysisFrame && file.isFolder,
  );
  const fileNode = (file: RestyleAttachment): RestyleFileTreeNode => ({
    id: `source/${file.id}`,
    label: file.name,
    kind: "file" as const,
    size: file.size,
    preview: {
      kind: "attachment" as const,
      key: `attachment:${file.id}`,
      title: file.name,
      attachment: file,
    },
  });
  const sourceVideos = sourceFiles.filter((file) => file.type.startsWith("video/"));
  const sourceOtherFiles = sourceFiles.filter((file) => !file.type.startsWith("video/"));
  const episodeNodes = sourceVideos.reduce<RestyleFileTreeNode[]>((nodes, file, index) => {
    const episode = file.episode ?? `EP${String(index + 1).padStart(2, "0")}`;
    const existing = nodes.find((node) => node.id === `source/${episode}`);
    const child = fileNode(file);
    if (existing) {
      existing.children = [...(existing.children ?? []), child];
      existing.count = existing.children.length;
      return nodes;
    }
    nodes.push({
      id: `source/${episode}`,
      label: episode,
      kind: "folder",
      count: 1,
      children: [child],
    });
    return nodes;
  }, []);
  return [
    ...episodeNodes,
    ...sourceOtherFiles.map(fileNode),
    ...folders.map((file) => {
      if (file.isFolder) {
        return {
          id: `source/${file.id}`,
          label: file.name,
          kind: "folder" as const,
          count: file.fileCount ?? 0,
          children: [],
        };
      }
      return fileNode(file);
    }),
  ];
}

/**
 * 同一 episode + segmentId 只保留最新一条渲染附件：每次返工都会新建一份
 * video_clip / final_video 附件，结果目录与右侧「分段返工」列表只展示最新那份，
 * 旧记录统一留在「生成状态」里。lastModified 相同时取列表靠后的（后追加的更新）。
 */
function latestRenderAttachments(files: RestyleAttachment[]): RestyleAttachment[] {
  const bySegment = new Map<string, RestyleAttachment>();
  for (const file of files) {
    const key = `${file.episode ?? ""}/${file.segmentId ?? ""}`;
    const existing = bySegment.get(key);
    if (!existing || file.lastModified >= existing.lastModified) bySegment.set(key, file);
  }
  return [...bySegment.values()];
}

function buildRestyleFileTree(
  project: RestyleProject | undefined,
  linkedAssets: RestyleAsset[],
  t: Translations,
): RestyleFileTreeNode[] {
  const extractedAssets = project?.extractedAssets ?? [];
  const sourceChildren = groupedAttachmentNodes(project?.files ?? []);
  const generatedFiles = (project?.files ?? []).filter((file) => file.generatedKind && file.url);
  // 「成片 / 视频片段」只收渲染成功且有结果链接的附件：渲染附件在入队时就以原片的
  // 名字与体积创建，未完成/失败的占位不进结果目录（统一在右侧「生成状态」展示）；
  // 同一 episode + segmentId 只保留最新一条，避免返工后出现重复行。
  const isFinishedRender = (file: RestyleAttachment) =>
    file.renderStatus === "succeeded" && Boolean(file.resultUrl ?? file.url);
  const finalVideoFiles = latestRenderAttachments(
    (project?.files ?? []).filter(
      (file) => file.generatedKind === "final_video" && isFinishedRender(file),
    ),
  );
  const videoClipFiles = latestRenderAttachments(
    (project?.files ?? []).filter(
      (file) => file.generatedKind === "video_clip" && isFinishedRender(file),
    ),
  );
  const sourceCandidates = makeVirtualPreview(
    "analysis/global/source_asset_candidates.json",
    "source_asset_candidates.json",
    "application/json",
    JSON.stringify(
      extractedAssets.map(({ id: _id, ...asset }) => asset),
      null,
      2,
    ),
  );
  const assetConfirmationJson = makeVirtualPreview(
    "plan/global/asset_confirmation.json",
    "asset_confirmation.json",
    "application/json",
    JSON.stringify(
      {
        summary: project?.analysisSummary ?? "",
        assets: extractedAssets.map(({ id: _id, ...asset }) => asset),
        confirmedAssetIds: project?.confirmedAssetIds ?? [],
      },
      null,
      2,
    ),
  );
  const assetConfirmationMd = makeVirtualPreview(
    "plan/global/资产确认表.md",
    "资产确认表.md",
    "text/markdown",
    assetMarkdownTable(extractedAssets),
  );
  const linkedAssetNodes = (kind: RestyleAsset["kind"], label: string) => {
    const kindAssets = linkedAssets.filter((asset) => asset.kind === kind);
    const generated = generatedFiles.filter((file) => file.generatedKind === kind);
    return {
      id: `results/assets/${kind}`,
      label,
      kind: "folder" as const,
      count: kindAssets.length + generated.length,
      children: [
        ...kindAssets.map((asset) => ({
          id: `results/assets/${kind}/${asset.id}`,
          label: `${asset.name}.md`,
          kind: "file" as const,
          preview: makeVirtualPreview(
            `asset:${asset.id}`,
            `${asset.name}.md`,
            "text/markdown",
            [`# ${asset.name}`, "", asset.detail, "", `类型：${asset.role}`].join("\n"),
          ),
        })),
        ...generated.map((file) => ({
          id: `results/assets/${kind}/${file.id}`,
          label: file.name,
          kind: "file" as const,
          size: file.size,
          preview: {
            kind: "attachment" as const,
            key: `attachment:${file.id}`,
            title: file.name,
            attachment: file,
          },
        })),
      ],
    };
  };
  const sourceEpisodes = (project?.files ?? [])
    .filter((file) => file.type.startsWith("video/") && !file.isFolder)
    .map((file, index) => ({
      label: file.episode ?? `EP${String(index + 1).padStart(2, "0")}`,
      file,
    }));
  const frameFiles = (project?.files ?? []).filter((file) => file.analysisFrame && file.url);
  const analysisChildren: RestyleFileTreeNode[] = sourceEpisodes.length
    ? [
        {
          id: "analysis/global",
          label: "全剧",
          kind: "folder" as const,
          count: 1,
          children: [
            {
              id: "analysis/global/source_asset_candidates.json",
              label: "source_asset_candidates.json",
              kind: "file" as const,
              size: sourceCandidates.content.length,
              preview: sourceCandidates,
            },
          ],
        },
        ...sourceEpisodes.map((episode) => ({
          id: `analysis/${episode.label}`,
          label: episode.label,
          kind: "folder" as const,
          count: 4,
          children: [
            {
              id: `analysis/${episode.label}/抽帧`,
              label: "抽帧",
              kind: "folder" as const,
              count: frameFiles.filter((file) => file.analysisEpisode === episode.label).length,
              children: frameFiles
                .filter((file) => file.analysisEpisode === episode.label)
                .map((file) => ({
                  id: `analysis/${episode.label}/抽帧/${file.id}`,
                  label: file.name,
                  kind: "file" as const,
                  size: file.size,
                  preview: {
                    kind: "attachment" as const,
                    key: `attachment:${file.id}`,
                    title: file.name,
                    attachment: file,
                  },
                })),
            },
            ...["剧情", "视觉理解", "台词"].map((label) => ({
              id: `analysis/${episode.label}/${label}`,
              label,
              kind: "folder" as const,
              count: 0,
              children: [],
            })),
          ],
        })),
      ]
    : [];
  analysisChildren.forEach((node) => {
    const episode = sourceEpisodes.find((item) => item.label === node.label);
    const sections = episode ? project?.analysisSections?.[episode.label] : undefined;
    if (!episode || !sections || !node.children) return;
    const sectionContent: Record<string, string> = {
      剧情: sections.plot,
      视频理解: sections.videoUnderstanding,
      台词: sections.dialogue,
    };
    node.children = node.children.map((child) => {
      const content = sectionContent[child.label];
      if (!content) return child;
      const preview = makeVirtualPreview(
        `${child.id}/${episode.label}_${child.label}.md`,
        `${episode.label}_${child.label}.md`,
        "text/markdown",
        content,
      );
      return {
        ...child,
        count: 1,
        children: [
          {
            id: preview.key,
            label: preview.title,
            kind: "file" as const,
            size: preview.content.length,
            preview,
          },
        ],
      };
    });
  });
  const planChildren: RestyleFileTreeNode[] = extractedAssets.length
    ? [
        {
          id: "plan/global",
          label: "全剧",
          kind: "folder" as const,
          count: 2,
          children: [
            {
              id: "plan/global/资产确认表.md",
              label: "资产确认表.md",
              kind: "file" as const,
              size: assetConfirmationMd.content.length,
              preview: assetConfirmationMd,
            },
            {
              id: "plan/global/asset_confirmation.json",
              label: "asset_confirmation.json",
              kind: "file" as const,
              size: assetConfirmationJson.content.length,
              preview: assetConfirmationJson,
            },
          ],
        },
      ]
    : [];
  const planGlobalNode = planChildren[0];
  if (planGlobalNode?.children) {
    const generatedAssetFiles = generatedFiles.filter((file) =>
      ["character", "scene", "prop"].includes(file.generatedKind ?? ""),
    );
    planGlobalNode.children.push({
      id: "plan/global/图片生成",
      label: "图片生成",
      kind: "folder",
      count: generatedAssetFiles.length,
      children: generatedAssetFiles.map((file) => ({
        id: `plan/global/图片生成/${file.id}`,
        label: file.name,
        kind: "file" as const,
        size: file.size,
        preview: {
          kind: "attachment" as const,
          key: `attachment:${file.id}`,
          title: file.name,
          attachment: file,
        },
      })),
    });
    const registryFiles = [
      ["character_confirmation.json", "角色确认表与角色图片绑定。"],
      ["target_asset_conversion.json", "目标资产转换登记与本项目资产绑定。"],
      ["target_localization_contract.json", "目标市场、本地化风格和一致性约束。"],
      ["series_character_registry.json", "角色注册表与跨视频一致性记录。"],
      ["series_scene_registry.json", "场景注册表与跨视频一致性记录。"],
      ["series_prop_registry.json", "道具注册表与跨视频一致性记录。"],
    ] as const;
    planGlobalNode.children.push(
      ...registryFiles.map(([name, content]) => {
        const preview = makeVirtualPreview(
          `plan/global/${name}`,
          name,
          "application/json",
          content,
        );
        return {
          id: preview.key,
          label: preview.title,
          kind: "file" as const,
          size: preview.content.length,
          preview,
        };
      }),
    );
    planGlobalNode.count = planGlobalNode.children.length;
  }
  const episodePlanNodes: RestyleFileTreeNode[] = (project?.planEpisodes ?? []).map((plan) => {
    const episode = plan.episode;
    const sourceName =
      project?.files.find((file) => file.id === episode || file.episode === episode)?.name ??
      episode;
    return {
      id: `plan/${episode}`,
      label: sourceName,
      kind: "folder" as const,
      count: plan.segments.length,
      children: [
        {
          id: `plan/${episode}/提示词`,
          label: "提示词",
          kind: "folder" as const,
          count: plan.segments.length,
          children: [
            {
              id: `plan/${episode}/提示词/final`,
              label: "final",
              kind: "folder" as const,
              count: plan.segments.length,
              children: plan.segments.map((segment) => {
                const promptPreview = makeVirtualPreview(
                  `plan/${episode}/提示词/final/${episode}_${segment.id}.prompt.txt`,
                  `${episode}_${segment.id}.prompt.txt`,
                  "text/plain",
                  segment.prompt,
                );
                return {
                  id: promptPreview.key,
                  label: promptPreview.title,
                  kind: "file" as const,
                  size: promptPreview.content.length,
                  preview: promptPreview,
                };
              }),
            },
          ],
        },
      ],
    };
  });
  episodePlanNodes.forEach((node) => {
    const episode = node.id.replace(/^plan\//, "");
    const plan = project?.planEpisodes?.find((item) => item.episode === episode);
    if (!plan) return;
    const sectionFiles = [
      [
        "分段",
        `${episode}_segments.json`,
        JSON.stringify({ episode, segments: plan.segments }, null, 2),
      ],
      [
        "分镜",
        `${episode}_storyboard.md`,
        plan.segments.map((segment) => `## ${segment.id}\n\n${segment.prompt}`).join("\n\n"),
      ],
      [
        "连续性",
        `${episode}_continuity.md`,
        "角色、场景、道具、画面比例和声音要求将在本视频分段之间保持一致。",
      ],
      ["确认", `${episode}_confirmation.md`, "请检查分段提示词、资产引用和原片剧情还原度。"],
    ] as const;
    const promptFolder = node.children?.find((child) => child.id.endsWith("/提示词"));
    const extraFolders = sectionFiles.map(([label, name, content]) => {
      const preview = makeVirtualPreview(
        `plan/${episode}/${label}/${name}`,
        name,
        name.endsWith(".json") ? "application/json" : "text/markdown",
        content,
      );
      return {
        id: `plan/${episode}/${label}`,
        label,
        kind: "folder" as const,
        count: 1,
        children: [
          {
            id: preview.key,
            label: preview.title,
            kind: "file" as const,
            size: preview.content.length,
            preview,
          },
        ],
      };
    });
    node.children = [
      ...extraFolders,
      ...(node.children ?? []).filter((child) => child !== promptFolder),
      ...(promptFolder ? [promptFolder] : []),
    ];
    node.count = node.children.length;
  });
  if (episodePlanNodes.length) {
    planChildren.push(...episodePlanNodes);
  }
  const resultChildren = [
    {
      id: "results/final",
      label: "成片",
      kind: "folder" as const,
      count: finalVideoFiles.length,
      children: finalVideoFiles.map((file) => ({
        id: `results/final/${file.id}`,
        label: file.name,
        kind: "file" as const,
        // 不显示体积：附件上记录的是原片大小，结果文件体积当前没有落库，显示会误导。
        preview: {
          kind: "attachment" as const,
          key: `attachment:${file.id}`,
          title: file.name,
          attachment: file,
        },
      })),
    },
    {
      id: "results/clips",
      label: "视频片段",
      kind: "folder" as const,
      count: videoClipFiles.length,
      children: videoClipFiles.map((file) => ({
        id: `results/clips/${file.id}`,
        label: file.name,
        kind: "file" as const,
        // 不显示体积：附件上记录的是原片大小，结果文件体积当前没有落库，显示会误导。
        preview: {
          kind: "attachment" as const,
          key: `attachment:${file.id}`,
          title: file.name,
          attachment: file,
        },
      })),
    },
    {
      id: "results/assets",
      label: t.restyle_assets,
      kind: "folder" as const,
      count: linkedAssets.length + generatedFiles.length,
      children: [
        linkedAssetNodes("scene", t.restyle_assets_scenes),
        linkedAssetNodes("prop", t.restyle_assets_props),
        linkedAssetNodes("character", t.restyle_assets_characters),
      ],
    },
  ];

  return [
    {
      id: "source",
      label: t.restyle_source,
      kind: "folder",
      count: countTreeLeaves(sourceChildren),
      children: sourceChildren,
    },
    {
      id: "analysis",
      label: "原片分析",
      kind: "folder",
      count: countTreeLeaves(analysisChildren),
      children: analysisChildren,
    },
    {
      id: "plan",
      label: "转绘方案",
      kind: "folder",
      count: countTreeLeaves(planChildren),
      children: planChildren,
    },
    {
      id: "results",
      label: "结果",
      kind: "folder",
      count: countTreeLeaves(resultChildren),
      children: resultChildren,
    },
  ];
}

/**
 * 原附件 blob 失效时的兜底选择：在同一份文件列表里找另一个已有持久
 * http(s) URL 的源视频（如同集刚重传的那份）。
 */
export function pickEpisodeSourceFallback(
  files: RestyleAttachment[],
  source: RestyleAttachment,
): RestyleAttachment | undefined {
  return files.find(
    (file) =>
      file.id !== source.id &&
      file.type.startsWith("video/") &&
      Boolean(file.url) &&
      /^https?:\/\//i.test(file.url!) &&
      (!source.episode || !file.episode || file.episode === source.episode),
  );
}

export default function RestyleStudio() {
  const { t } = useLanguage();
  const { user, isAuthenticated } = useAuth();
  const [view, setView] = useState<RestyleView>("workbench");
  const [assets, setAssets] = useState<RestyleAsset[]>([]);
  const [assetLibraryStatus, setAssetLibraryStatus] = useState<AssetLibraryStatus>("idle");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [projects, setProjects] = useState<RestyleProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectQuery, setProjectQuery] = useState("");
  // 输入草稿按项目归档：在 A 打字打一半切到 B，各自草稿互不污染，切回 A 还在。
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [canvasKind, setCanvasKind] = useState<RestyleAsset["kind"] | "all">("all");
  const [canvasPrompt, setCanvasPrompt] = useState("");
  const [selectedCanvasAttachmentId, setSelectedCanvasAttachmentId] = useState<string | null>(null);
  const [referencedCanvasAttachmentIds, setReferencedCanvasAttachmentIds] = useState<string[]>([]);
  const [assetPickerFor, setAssetPickerFor] = useState<string | null>(null);
  const [assetPickerKind, setAssetPickerKind] = useState<RestyleAsset["kind"] | null>(null);
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });
  const canvasDragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(
    null,
  );
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  // 草稿附件按项目归档：A 选好的附件不会带进 B 的输入框，也不会在 B 发送时被合并。
  const [draftAttachmentIdsByProject, setDraftAttachmentIdsByProject] = useState<
    Record<string, string[]>
  >({});
  // 附件直传状态（上传中/已完成/失败），按 attachmentId 归档，仅组件内可见。
  const [attachmentUploads, setAttachmentUploads] = useState<Record<string, DirectUploadState>>({});
  // 外部文件拖入工作区时显示「松开即上传」遮罩。
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>({});
  const [fileThumbnails, setFileThumbnails] = useState<Record<string, string>>({});
  const [closedFileTreePaths, setClosedFileTreePaths] = useState<string[]>([]);
  const [selectedFilePreview, setSelectedFilePreview] = useState<RestyleFilePreview | null>(null);
  const [previewDialog, setPreviewDialog] = useState<RestyleFilePreview | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [fileContextMenu, setFileContextMenu] = useState<{
    x: number;
    y: number;
    preview: RestyleFilePreview;
  } | null>(null);
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null);
  const [fileDropTarget, setFileDropTarget] = useState<RestyleFileDropTarget | null>(null);
  const [selectedModel, setSelectedModel] = useState<RestyleModel>("lovable:openai/gpt-5.5");
  const [selectedImageModel, setSelectedImageModel] = useState(DEFAULT_RESTYLE_IMAGE_MODEL);
  const [selectedVideoModel, setSelectedVideoModel] = useState(DEFAULT_RESTYLE_VIDEO_MODEL);
  // 模型定价（model_pricing 表）：视频档给工作台选项区与成本预估用，图像档给生图成本预估用。
  const [pricingRows, setPricingRows] = useState<ModelPricingRow[]>([]);
  const pricingRowsRef = useRef<ModelPricingRow[]>([]);
  pricingRowsRef.current = pricingRows;
  // 自动执行累计消耗（积分），按项目归档；达到 autoBudget 上限即强制暂停。
  const spendRef = useRef<Record<string, number>>({});
  // 每个转绘项目独立的执行态：切换项目不再互相阻塞，可多项目并发。
  const [projectRuns, setProjectRuns] = useState<Record<string, RestyleRunState>>({});
  // projectRuns 的 ref 镜像：渲染队列收尾（同一闭包内）紧接着发起下一个任务时，
  // useState 快照还是旧的 running=true，会误判项目仍在忙；ref 读写即时生效。
  const projectRunningRef = useRef<Record<string, boolean>>({});
  const runAbortRef = useRef<Record<string, AbortController>>({});
  // 返工待办队列：项目忙时点名的局部返工（聊天/按钮重试）按项目排队，
  // 渲染队列收尾后自动取出下一个开跑；点击「停止」时清空。
  const pendingRerunsRef = useRef<
    Map<string, Array<{ conversationId: string; rerun: RestyleRerunRequest }>>
  >(new Map());
  /**
   * 本轮渲染 run 的成败台账（runOutcomeLedger，同步读写，不经过 React 状态）：
   * 队列收尾播报必须按本轮实际成败判定——读 projectsRef 里的 renderStatus 会
   * 拿到上一个事件循环的旧状态。记账必须直接调 record（禁止放进 setState
   * updater：updater 由 React 延迟到渲染阶段执行，收尾同步读取会读空，
   * 772bbb2「本轮台账：空」根因）。每个 run 在 generateRenderedVideos 里
   * reset，drain 的下一轮各自独立。
   */
  const renderRunOutcomesRef = useRef(createRunOutcomeLedger());
  const [analysisError, setAnalysisError] = useState("");
  // 资产表 skill 自检结果（reviewRestyleAssetTable）：仅组件内状态，不落盘。
  const [assetReview, setAssetReview] = useState<{
    verdict: AssetReviewVerdict;
    issues: AssetReviewIssue[];
  } | null>(null);
  const [assetReviewRunning, setAssetReviewRunning] = useState(false);
  // 手工编辑后置 true：自检结果可能过期，靠「重新检查」手动刷新。
  const [assetReviewStale, setAssetReviewStale] = useState(false);
  // 「过程与提示词」面板的逐项资产生成进度，键为 extractedAsset.id。
  const [assetRunStatus, setAssetRunStatus] = useState<Record<string, RestyleAssetRunStatus>>({});
  // 右栏分段 Tab：按 projectId 记忆最近一次选择，localStorage 持久化（刷新/切项目恢复）。
  const [railTabs, setRailTabs] = useState<Record<string, RestyleRailTab>>(() =>
    readRestyleRailTabs(),
  );
  // 待确认关卡自动跳到「流程」Tab 后的高亮提示，用户手动点任意 Tab 即清除。
  const [processTabAttention, setProcessTabAttention] = useState(false);
  const railTab: RestyleRailTab = railTabs[activeProjectId ?? ""] ?? "setup";

  function selectRailTab(tab: RestyleRailTab) {
    setProcessTabAttention(false);
    const key = activeProjectId ?? "";
    setRailTabs((current) => {
      if (current[key] === tab) return current;
      const next = { ...current, [key]: tab };
      try {
        window.localStorage.setItem(RESTYLE_RAIL_TAB_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // localStorage 不可用时仅保留组件内记忆。
      }
      return next;
    });
  }
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const reuploadInputRef = useRef<HTMLInputElement>(null);
  const reuploadTargetRef = useRef<{ projectId: string; attachmentId: string } | null>(null);
  const fileObjectsRef = useRef<Record<string, File>>({});
  // filePreviews 的 ref 镜像：卸载清理与 deleteProject 批量 revoke 时取最新快照用。
  const filePreviewsRef = useRef<Record<string, string>>({});
  filePreviewsRef.current = filePreviews;
  const sourceVideoUploadRef = useRef<
    Record<string, Promise<{ ok: true; url: string } | { ok: false; error: string }>>
  >({});
  // 智能补镜产物：`${projectId}:${episode}` → 已生成的补镜片段（含锚点分段），
  // 由 stitchFinalEpisodes 在拼接前并入序列；不落 localStorage，刷新后补镜不补跑。
  const insertClipsRef = useRef<Record<string, InsertClipResult[]>>({});
  // 逐镜表缺失的一次性对话提示：按 projectId 去重，每个项目每次会话只提示一次。
  const shotScheduleHintRef = useRef<Set<string>>(new Set());
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const callAnalyzeRestyleAssets = useServerFn(analyzeRestyleAssets);
  const callAnalyzeRestyleSourceUnits = useServerFn(analyzeRestyleSourceUnits);
  const callGenerateRestylePlan = useServerFn(generateRestylePlan);
  const callFinalizeRestylePlanCoverage = useServerFn(finalizeRestylePlanCoverage);
  const callGenerateImage = useServerFn(generateImage);
  const callGenerateImageWithReferences = useServerFn(generateImageWithReferences);
  const callSubmitVideoTask = useServerFn(submitVideoTaskFn);
  const callPollVideoTask = useServerFn(pollVideoTaskFn);
  const callUploadTopenrouterAsset = useServerFn(uploadTopenrouterAsset);
  const callUploadKeyiyunAsset = useServerFn(uploadKeyiyunAsset);
  const callUploadJieyunAsset = useServerFn(uploadJieyunAsset);
  const callUploadTokenponyAsset = useServerFn(uploadTokenponyAsset);
  const callUploadLocalMedia = useServerFn(uploadLocalImage);
  const callCreateMediaUploadUrl = useServerFn(createMediaUploadUrl);
  const callSignMediaReadUrl = useServerFn(signMediaReadUrl);
  const callPersistAssetImage = useServerFn(persistAssetImage);
  const callPersistRestyleVideo = useServerFn(persistRestyleVideo);
  const callReportGenerationError = useServerFn(reportGenerationError);
  const callRefundChargedCredits = useServerFn(refundChargedCredits);
  const callReviewRestyleAssetTable = useServerFn(reviewRestyleAssetTable);
  const callTranscribeRestyleAudio = useServerFn(transcribeRestyleAudio);
  const callSubmitVideoStitchJob = useServerFn(submitVideoStitchJob);
  const callPollVideoStitchJob = useServerFn(pollVideoStitchJob);
  const callSubmitVideoTrimJob = useServerFn(submitVideoTrimJob);
  const callPollVideoTrimJob = useServerFn(pollVideoTrimJob);
  const callListModelPricing = useServerFn(listModelPricing);

  const activeProject = projects.find((project) => project.id === activeProjectId);
  // 模型目录唯一数据源：已上架 + 启用（60s 缓存）；接口异常时回落静态列表
  const { models: listedImageModels } = useListedModels("image", realImageModelOptions);
  const { models: listedVideoModels } = useListedModels("video", realVideoModels);
  // 分析（文本）模型目录：服务端已支持 text kind；zod 枚举约束见下
  const { models: catalogTextModels } = useListedModels("text", [...RESTYLE_MODELS]);
  // 全站统一展示规格（2026/08）：徽标优先级 暂未计费 > 默认 > 素材库预审（转绘视频专属）
  const modelBadgeLabels = {
    unpricedLabel: t.listed_model_unpriced,
    defaultLabel: t.restyle_setup_col_default,
    assetLibraryLabel: t.restyle_video_model_asset_review,
  };
  const sortedImageModels = sortListedModels(listedImageModels);
  // 排序（全站统一）：素材库预审支持排前（转绘专属附加优先级）→ isDefault 靠前 → sortOrder
  const sortedVideoModels = sortListedModels(listedVideoModels, (model) =>
    Number(getVideoAssetLibrarySupport(model.id).supported),
  );
  // 分析模型选项：文本目录中被服务端 zod 枚举接受的项（restyleAnalysis.functions.ts
  // 的 model 枚举是固定 6 个 id，目录其它条目提交会被拒），目录未覆盖时回落静态列表。
  const analysisModelOptions = useMemo(() => {
    const validIds = new Set<string>(RESTYLE_MODELS.map((model) => model.id));
    const listed = catalogTextModels.filter((model) => validIds.has(model.id));
    return listed.length ? listed : [...RESTYLE_MODELS];
  }, [catalogTextModels]);
  // projects 的最新快照：异步回调按 projectId 取自己项目的字段（如目标画风），
  // 不被「切换到其他项目」影响。渲染期只维护全量快照，不再按激活项目覆盖单份 ref。
  const projectsRef = useRef<RestyleProject[]>(projects);
  projectsRef.current = projects;
  const activeConversation = activeProject?.conversations.find(
    (conversation) => conversation.id === activeProject?.activeConversationId,
  );
  // 草稿与草稿附件读写都带当前项目 id；无项目时用 "" 兜底键，输入框仍可编辑。
  const chatDraft = chatDrafts[activeProjectId ?? ""] ?? "";
  const draftAttachmentIds = draftAttachmentIdsByProject[activeProjectId ?? ""] ?? [];

  function setChatDraft(update: string | ((current: string) => string)) {
    const key = activeProjectId ?? "";
    setChatDrafts((current) => ({
      ...current,
      [key]: typeof update === "function" ? update(current[key] ?? "") : update,
    }));
  }

  function setDraftAttachmentIds(update: string[] | ((current: string[]) => string[])) {
    const key = activeProjectId ?? "";
    setDraftAttachmentIdsByProject((current) => ({
      ...current,
      [key]: typeof update === "function" ? update(current[key] ?? []) : update,
    }));
  }

  /** 按项目取目标画风：异步生成回调只认任务自己的 projectId，不读激活项目的全局值。 */
  function styleBriefForProject(projectId: string): string {
    return projectsRef.current.find((project) => project.id === projectId)?.styleBrief ?? "";
  }

  const sourceVideoLabel = (videoId: string): string =>
    activeProject?.files.find((file) => file.id === videoId || file.episode === videoId)?.name ??
    videoId;
  const draftAttachments =
    activeProject?.files.filter((file) => draftAttachmentIds.includes(file.id)) ?? [];
  // @ 可引用的素材：当前项目全部已上传图片与视频（不限于本轮草稿），按类型分别编号。
  const mentionableAttachments = useMemo(
    () => buildMentionables(activeProject?.files ?? []),
    [activeProject?.files],
  );
  const mentionQuery = chatDraft.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/);
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? assets[0];
  const matchingProjects = useMemo(
    () =>
      projects.filter((project) =>
        project.title.toLowerCase().includes(projectQuery.toLowerCase()),
      ),
    [projectQuery, projects],
  );
  const assetsByKind = useMemo(
    () => ({
      character: assets.filter((asset) => asset.kind === "character"),
      scene: assets.filter((asset) => asset.kind === "scene"),
      prop: assets.filter((asset) => asset.kind === "prop"),
    }),
    [assets],
  );
  const linkedProjectAssets = useMemo(
    () => assets.filter((asset) => isRestyleAssetLinked(asset.id, activeProject?.assetIds ?? [])),
    [activeProject?.assetIds, assets],
  );
  const projectFileTree = useMemo(
    () =>
      stampPreviewProjectId(
        buildRestyleFileTree(activeProject, linkedProjectAssets, t),
        activeProject?.id ?? null,
      ),
    [activeProject, linkedProjectAssets, t],
  );
  // 预览归属校验：即使某条重置路径漏掉，也不把上一个项目的媒体渲染到当前项目。
  const visibleFilePreview =
    selectedFilePreview && (selectedFilePreview.projectId ?? null) === activeProjectId
      ? selectedFilePreview
      : null;
  const visiblePreviewDialog =
    previewDialog && (previewDialog.projectId ?? null) === activeProjectId ? previewDialog : null;
  const visibleFileContextMenu =
    fileContextMenu && (fileContextMenu.preview.projectId ?? null) === activeProjectId
      ? fileContextMenu
      : null;

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      setAssets([]);
      setAssetLibraryStatus("idle");
      return;
    }
    let active = true;
    setAssetLibraryStatus("loading");
    void Promise.all([
      loadCharacters(user.id, 0, 200),
      loadScenes(user.id, 0, 200),
      loadProps(user.id, 0, 200),
    ])
      .then(([characters, scenes, props]) => {
        if (!active) return;
        if (characters.error || scenes.error || props.error) throw new Error();
        setAssets(
          libraryAssetsFromRows(characters.data ?? [], scenes.data ?? [], props.data ?? []),
        );
        setAssetLibraryStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setAssets([]);
        setAssetLibraryStatus("error");
      });
    return () => {
      active = false;
    };
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setProjects([]);
      setActiveProjectId(null);
      setStorageReady(false);
      return;
    }
    const stored = loadRestyleProjects(user.id);
    setProjects(stored);
    setActiveProjectId((current) => current ?? stored[0]?.id ?? null);
    setStorageReady(true);
  }, [user?.id]);

  useEffect(() => {
    if (!storageReady || !user?.id) return;
    saveRestyleProjects(user.id, projects);
  }, [projects, storageReady, user?.id]);

  useEffect(() => {
    if (selectedAssetId && assets.some((asset) => asset.id === selectedAssetId)) return;
    setSelectedAssetId(assets[0]?.id ?? null);
  }, [assets, selectedAssetId]);

  // 模型定价入库读取：登录后拉一次（服务端模块级缓存 60s），工作台选项区与成本预估共用。
  useEffect(() => {
    if (!isAuthenticated) {
      setPricingRows([]);
      return;
    }
    let active = true;
    void callListModelPricing({ data: {} })
      .then((result) => {
        if (active && result?.rows) setPricingRows(result.rows);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // 卸载时释放全部本地预览 blob 并丢弃 File 对象引用，避免泄漏。
  useEffect(
    () => () => {
      for (const url of Object.values(filePreviewsRef.current)) URL.revokeObjectURL(url);
      filePreviewsRef.current = {};
      fileObjectsRef.current = {};
    },
    [],
  );

  const videoPricingRows = useMemo(
    () => pricingRows.filter((row) => row.kind === "video" && row.enabled),
    [pricingRows],
  );
  // 默认值链（全站统一）：项目/用户已保存值 → 库内 is_default 行 → sortOrder 最前 →
  // 硬编码常量兜底（DEFAULT_RESTYLE_* 仅作最终兜底，不再直接当默认）。
  const defaultRestyleVideoModel = useMemo(
    () => resolveDefaultModel(sortedVideoModels, undefined, DEFAULT_RESTYLE_VIDEO_MODEL),
    [sortedVideoModels],
  );
  const defaultRestyleImageModel = useMemo(
    () => resolveDefaultModel(sortedImageModels, undefined, DEFAULT_RESTYLE_IMAGE_MODEL),
    [sortedImageModels],
  );

  // 模型选择随项目走：项目没设过模型时无条件回落默认值，绝不沿用上一个项目的选择。
  // 用户在下拉里改模型时会写回 project.imageModel/videoModel，选择随项目持久化。
  useEffect(() => {
    setSelectedImageModel(
      resolveDefaultModel(
        sortedImageModels,
        activeProject?.imageModel,
        DEFAULT_RESTYLE_IMAGE_MODEL,
      ),
    );
    setSelectedVideoModel(
      resolveDefaultModel(
        sortedVideoModels,
        activeProject?.videoModel,
        DEFAULT_RESTYLE_VIDEO_MODEL,
      ),
    );
  }, [
    activeProject?.id,
    activeProject?.imageModel,
    activeProject?.videoModel,
    defaultRestyleVideoModel,
    defaultRestyleImageModel,
    sortedImageModels,
    sortedVideoModels,
  ]);

  // 当前生效的视频模型：项目持久化值优先，未设置时用下拉当前值（已按默认值兜底）。
  const currentVideoModel = activeProject?.videoModel ?? selectedVideoModel;

  // 切换项目时统一重置与项目绑定的视图态：预览、画布选中、菜单、错误提示等不跨项目残留。
  // 输入草稿与草稿附件按项目归档（见 chatDrafts / draftAttachmentIdsByProject），无需清空。
  useEffect(() => {
    setSelectedFilePreview(null);
    setPreviewDialog(null);
    setFileContextMenu(null);
    setSelectedCanvasAttachmentId(null);
    setReferencedCanvasAttachmentIds([]);
    setCanvasPrompt("");
    setCanvasOffset({ x: 0, y: 0 });
    setSelectedAssetId(null);
    setAttachmentMenuOpen(false);
    setAnalysisError("");
  }, [activeProjectId]);

  const activeRun = activeProjectId ? projectRuns[activeProjectId] : undefined;
  // 当前项目是否在执行。其他项目的任务不会影响这里，因此可以并发发送。
  const isAnalyzing = Boolean(activeRun?.running);

  // 右栏 Tab 角标：流程栏在分析/生图/渲染进行中亮小圆点，文件栏显示文件树节点数。
  const processTabRunning =
    isAnalyzing || Object.values(assetRunStatus).some((run) => run.status === "running");
  const filesTabCount = activeProject ? countTreeLeaves(projectFileTree) : 0;

  // ---- 人物关系：表格与画布共用 project.characterRelations 一份数据 ----
  const characterAssets = useMemo(
    () => (activeProject?.extractedAssets ?? []).filter((asset) => asset.kind === "character"),
    [activeProject?.extractedAssets],
  );
  const relationCharacters = useMemo(
    () =>
      characterAssets.map((asset) => ({
        id: asset.id,
        name: asset.targetName || asset.sourceName,
      })),
    [characterAssets],
  );
  const characterRelations = useMemo(
    () => activeProject?.characterRelations ?? [],
    [activeProject?.characterRelations],
  );
  // 本地校验实时跑：悬空引用 / 自指 / 重复边 / 缺失反向边。
  const relationIssues = useMemo(
    () =>
      validateCharacterRelations(
        characterRelations,
        characterAssets.map((asset) => asset.id),
      ),
    [characterRelations, characterAssets],
  );
  // 注入生图/方案提示词的关系文本（id 还原为角色名）。
  const relationBriefs = useMemo<CharacterRelationBrief[]>(() => {
    const byId = new Map((activeProject?.extractedAssets ?? []).map((asset) => [asset.id, asset]));
    return characterRelations.flatMap((relation) => {
      const from = byId.get(relation.from);
      const to = byId.get(relation.to);
      if (!from || !to) return [];
      return [
        {
          fromName: from.targetName || from.sourceName,
          toName: to.targetName || to.sourceName,
          relation: relation.relation,
          note: relation.note,
        },
      ];
    });
  }, [activeProject?.extractedAssets, characterRelations]);
  // 异步生图/方案流程里读最新关系文本，用 ref 避免闭包拿到旧 state。
  const relationBriefsRef = useRef<CharacterRelationBrief[]>([]);
  relationBriefsRef.current = relationBriefs;

  // 最新一条未响应的待确认口令：驱动输入框高亮与占位文案。
  const pendingActionPhrase = useMemo(
    () => findPendingActionPhrase(activeConversation?.messages ?? []),
    [activeConversation?.messages],
  );
  // 出现待确认关卡（分步护航/自定义干预的暂停点）时自动切到「流程」Tab 并高亮，
  // 避免用户停在「设置」页错过确认。只在口令「新出现」时触发，不拦用户之后手动切走。
  const seenPendingPhraseRef = useRef<string | null>(null);
  useEffect(() => {
    const key = pendingActionPhrase ? `${activeProjectId ?? ""}:${pendingActionPhrase}` : null;
    const seen = seenPendingPhraseRef.current;
    seenPendingPhraseRef.current = key;
    if (key && key !== seen) {
      selectRailTab("process");
      setProcessTabAttention(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅响应口令变化，railTab 用最新闭包即可。
  }, [pendingActionPhrase, activeProjectId]);
  // 关系表只挂在最新一条资产表消息下面，避免历史消息里重复出现。
  const lastAssetTableMessageId = useMemo(() => {
    const messages = activeConversation?.messages ?? [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.assetTable?.length) return messages[index]!.id;
    }
    return null;
  }, [activeConversation?.messages]);

  // 切换项目时清空自检结果（状态按项目隔离，不落盘）。
  useEffect(() => {
    setAssetReview(null);
    setAssetReviewStale(false);
  }, [activeProjectId]);

  function isProjectRunning(projectId: string) {
    return Boolean(projectRunningRef.current[projectId]);
  }

  function isRunAborted(projectId: string) {
    return Boolean(runAbortRef.current[projectId]?.signal.aborted);
  }

  /** 开启一次执行，并写入第一个步骤。返回 AbortController 供停止使用。 */
  function beginRun(projectId: string, label: string) {
    const controller = new AbortController();
    runAbortRef.current[projectId] = controller;
    projectRunningRef.current[projectId] = true;
    setProjectRuns((current) => ({
      ...current,
      [projectId]: {
        running: true,
        startedAt: Date.now(),
        stopped: false,
        steps: [{ id: crypto.randomUUID(), label, status: "running", at: Date.now() }],
      },
    }));
    return controller;
  }

  /** 推进到下一个步骤：上一个进行中的步骤标记完成。 */
  function markRunStep(projectId: string, label: string, detail?: string) {
    setProjectRuns((current) => {
      const run = current[projectId];
      if (!run?.running) return current;
      return {
        ...current,
        [projectId]: {
          ...run,
          steps: [
            ...run.steps.map((step) =>
              step.status === "running" ? { ...step, status: "done" as const } : step,
            ),
            { id: crypto.randomUUID(), label, detail, status: "running" as const, at: Date.now() },
          ],
        },
      };
    });
  }

  function finishRun(
    projectId: string,
    status: "done" | "failed" | "stopped" = "done",
    detail?: string,
  ) {
    projectRunningRef.current[projectId] = false;
    setProjectRuns((current) => {
      const run = current[projectId];
      if (!run) return current;
      return {
        ...current,
        [projectId]: {
          ...run,
          running: false,
          endedAt: Date.now(),
          stopped: status === "stopped",
          steps: run.steps.map((step) =>
            step.status === "running"
              ? {
                  ...step,
                  status: status === "failed" ? ("failed" as const) : ("done" as const),
                  detail: detail ?? step.detail,
                }
              : step,
          ),
        },
      };
    });
    // 任一 run 收尾都尝试拉起排队的返工待办（此前只有渲染类 run 的收尾
    // 才 drain——方案/生图 run 结束后队列无人唤醒，返工待办 25 分钟不启动）。
    // 防重入：drain 内 generateRenderedVideos 会重新 beginRun，但其 finishRun
    // 触发的是下一个待办（队列 FIFO 递减，链式推进不递归）。
    // stopRun / 预算暂停已在各自路径先清空队列，这里自然空转。
    drainPendingReruns(projectId);
  }

  /** 用户点击停止：中断进行中的请求，并在对话里留下明确说明。 */
  function stopRun(projectId: string) {
    if (!isProjectRunning(projectId)) return;
    runAbortRef.current[projectId]?.abort();
    // 停止同时清空该项目排队中的返工待办，避免停止后又被自动拉起。
    pendingRerunsRef.current.delete(projectId);
    finishRun(projectId, "stopped", t.restyle_run_stopped_step);
    const project = projectsRef.current.find((item) => item.id === projectId);
    const conversationId = project?.activeConversationId;
    if (project && conversationId) {
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: t.restyle_run_stopped_message,
      });
    }
  }

  /** 渲染队列收尾后取出下一个返工待办自动开跑；没有待办则什么都不做。 */
  function drainPendingReruns(projectId: string) {
    const queue = pendingRerunsRef.current.get(projectId);
    const { item: next, rest } = shiftPendingRerun(queue);
    if (!next) return;
    if (rest.length) pendingRerunsRef.current.set(projectId, rest);
    else pendingRerunsRef.current.delete(projectId);
    generateRenderedVideos(projectId, next.conversationId, next.rerun);
  }

  // Conversations are persisted locally. Always restore the view at the newest message,
  // and keep it there while new user or assistant messages are appended.
  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    const frame = window.requestAnimationFrame(() => {
      if (typeof container.scrollTo === "function") {
        container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
      } else {
        container.scrollTop = container.scrollHeight;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeProject,
    activeProjectId,
    activeConversation?.id,
    activeConversation?.messages.length,
    isAnalyzing,
  ]);

  function createLocalProject() {
    const project = createProjectRecord();
    setProjects((current) => [project, ...current]);
    setActiveProjectId(project.id);
  }

  function createProjectRecord(): RestyleProject {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const conversation = createConversation(now);
    return {
      id,
      title: `${t.restyle_untitled_project} ${projects.length + 1}`,
      createdAt: now,
      updatedAt: now,
      stage: "upload",
      assetIds: [],
      confirmedAssetIds: [],
      files: [],
      conversations: [conversation],
      activeConversationId: conversation.id,
      planNote: "",
      styleBrief: "",
      extractedAssets: [],
      analysisSummary: "",
    };
  }

  function createConversation(createdAt = new Date().toISOString()): RestyleConversation {
    return {
      id: crypto.randomUUID(),
      title: "",
      createdAt,
      updatedAt: createdAt,
      messages: [],
    };
  }

  function updateProject(projectId: string, update: (project: RestyleProject) => RestyleProject) {
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? { ...update(project), updatedAt: new Date().toISOString() }
          : project,
      ),
    );
  }

  // ---- 视频转绘工作台：执行配置 / 预算 / 自动推进 ----

  /** 右侧选项区与聊天规格表共用的回写入口：两侧读写同一份项目状态。 */
  function updateProjectSetup(patch: RestyleSetupPatch) {
    if (!activeProject) return;
    updateProject(activeProject.id, (project) => ({ ...project, ...patch }));
  }

  /** 目标项目的执行配置（填充默认值）；异步回调里一律按 projectId 取，不读激活项目。 */
  function executionConfigFor(projectId: string): Required<RestyleExecutionConfig> {
    const project = projectsRef.current.find((item) => item.id === projectId);
    return resolveExecutionConfig(project);
  }

  function pauseAtGate(projectId: string, gate: RestyleGateId): boolean {
    return shouldPauseAt(executionConfigFor(projectId), gate);
  }

  function spentFor(projectId: string): number {
    return spendRef.current[projectId] ?? 0;
  }

  function chargeSpend(projectId: string, credits: number) {
    spendRef.current[projectId] = spentFor(projectId) + credits;
  }

  /** 预算校验：任何模式下累计消耗达上限都强制暂停。 */
  function budgetExceeded(projectId: string, extra = 0): boolean {
    return isOverBudget(spentFor(projectId) + extra, executionConfigFor(projectId).autoBudget);
  }

  function pauseForBudget(projectId: string, conversationId: string) {
    // 预算暂停 = 等人充值/调预算：冻结返工待办（清空队列），
    // 否则 finishRun 统一 drain 会形成「暂停 → 拉起 → 再预算暂停」循环。
    pendingRerunsRef.current.delete(projectId);
    appendConversationMessage(projectId, conversationId, {
      role: "assistant",
      content: t.restyle_setup_budget_pause,
    });
  }

  /** 单张资产图成本预估：图像档按前缀匹配生图模型，查不到回落 5 积分。 */
  function imageJobCost(imageModel: string): number {
    const row = pricingRowsRef.current.find(
      (item) => item.kind === "image" && item.enabled && imageModel.startsWith(item.modelId),
    );
    return row?.credits ?? 5;
  }

  /** 单段视频成本预估：视频档每 10 秒单价 × 分段时长（5s）。 */
  function videoJobCost(videoModel: string): number {
    const row = pricingForVideoModel(pricingRowsRef.current, videoModel);
    return ((row?.credits ?? 240) * 5) / 10;
  }

  /** 聊天规格表确认按钮：状态已由双向联动即时回写，这里播报并引导进入下一步。 */
  function confirmProductionSpecs() {
    if (!activeProject || !activeConversation) return;
    appendConversationMessage(activeProject.id, activeConversation.id, {
      role: "assistant",
      content: t.restyle_setup_spec_confirmed_msg,
    });
  }

  /**
   * 资产表产出后的执行模式联动：
   * - 环节「目标资产设定」需人工审核 → 维持现状暂停（等用户确认）
   * - 资产图片来源 = 用户上传 → 跳过 AI 生图，挂待办卡片等上传
   * - 其余（极速 / 自定义未勾选）→ 自动生成全部资产图，后续环节继续按模式推进
   */
  async function autoAdvanceAfterAssetTable(projectId: string, conversationId: string) {
    if (pauseAtGate(projectId, "asset_setting")) return;
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project?.extractedAssets.length) return;
    const config = executionConfigFor(projectId);
    if (config.voiceSource !== "auto") {
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: t.restyle_setup_voice_todo,
      });
    }
    if (config.assetImageSource === "upload") {
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: t.restyle_setup_upload_todo,
      });
      return;
    }
    if (budgetExceeded(projectId)) {
      pauseForBudget(projectId, conversationId);
      return;
    }
    await generateAssetImages(
      projectId,
      conversationId,
      "",
      project.extractedAssets,
      [],
      project.styleBrief ?? "",
    );
  }

  /**
   * 方案生成的统一入口：短片（全部集 ≤PLAN_WINDOW_SEC）单次调用原逻辑；
   * 任一集权威时长超窗长时，客户端逐窗循环调 generateRestylePlan(window)
   * （每窗一个请求 30-60s，避开平台 ~100s 零字节断连；服务端单请求内跑
   * 全部窗已证明不可行）→ mergeWindowSegments 合并重排 →
   * finalizeRestylePlanCoverage 覆盖兜底（纯计算、不扣费）。
   * 只负责产出 episodes + warnings，播报与收尾由调用方处理。
   */
  async function requestPlanEpisodes(input: {
    projectId: string;
    project: RestyleProject;
    sourceFiles: RestyleAttachment[];
    instruction: string;
    episodeCount: number;
    existingEpisodes?: NonNullable<RestyleProject["planEpisodes"]>;
  }): Promise<
    | { ok: true; episodes: NonNullable<RestyleProject["planEpisodes"]>; warnings: string[] }
    | { ok: false; error: string }
  > {
    const { projectId, project, sourceFiles, instruction, episodeCount, existingEpisodes } = input;
    const effectiveFiles = sourceFiles.length ? sourceFiles : project.files;
    // 权威时长解析：durationSec 优先，该集自己的逐镜表估算兜底（不得用整表——
    // 多集项目整表时间轴混算会把别集时长算进本集窗数，「6 窗变 10 窗」回归）。
    const durationMsOfFile = (file: RestyleAttachment): number | undefined =>
      resolvePlanWindowDurationMs({
        durationSec: file.durationSec,
        episodeShots: project.shotScheduleByEpisode?.[file.episode ?? file.id],
        fallbackShots: project.shotSchedule,
      });
    const windowJobs = buildPlanWindowJobs(
      effectiveFiles.map((file) => ({
        videoId: file.episode ?? file.id,
        durationMs: durationMsOfFile(file),
      })),
    );
    const planFilePayload = (file: RestyleAttachment) => ({
      id: file.episode ?? file.id,
      name: file.name,
      type: file.type,
      size: file.size,
      // 权威总时长透传：服务端据此输出全片覆盖硬要求并做覆盖兜底。
      durationSec: file.durationSec,
    });
    const assets = project.extractedAssets.map(({ id: _id, ...asset }) => asset);
    // 按集取逐镜表：分窗生成与 finalize 都必须只传该集自己的 shots（整表
    // 无集归属、时间码都是集内相对值，跨集借用会污染他集分段边界，D1 回归）。
    // 旧项目没有按集字段时回落整表（单集项目等价）；按集字段存在但该集
    // 缺失（分析降级）时传空数组，缺口按 ≤15s 直接切补，禁止借用他集镜头。
    const shotsForEpisode = (videoId: string): DirectionShot[] => {
      const byEpisode = project.shotScheduleByEpisode;
      if (!byEpisode) return project.shotSchedule ?? [];
      return byEpisode[videoId] ?? [];
    };

    // ===== 长片分窗：客户端逐窗循环（与分析单元循环同一范式） =====
    if (windowJobs.some((job) => job.windowCount > 1)) {
      const driven = await driveWindowedPlanCalls({
        jobs: windowJobs,
        isAborted: () => isRunAborted(projectId),
        onProgress: (done, total) =>
          markRunStep(projectId, `${t.restyle_run_step_plan} 第 ${done}/${total} 窗`),
        callWindow: async (job) => {
          const file = effectiveFiles.find((item) => (item.episode ?? item.id) === job.videoId);
          if (!file) return { ok: false as const, error: `找不到源视频 ${job.videoId}` };
          try {
            const res = await callGenerateRestylePlan({
              data: {
                model: selectedModel,
                instruction,
                sourceFiles: [planFilePayload(file)],
                assets,
                episodeCount: 1,
                existingEpisodes: existingEpisodes ?? [],
                // 按集隔离：只传该窗所属集的逐镜表，杜绝跨集镜头泄漏（D1）。
                shotSchedule: shotsForEpisode(job.videoId),
                targetMarket: project.targetMarket ?? "kr",
                projectName: project.title,
                window: {
                  startMs: job.window.startMs,
                  endMs: job.window.endMs,
                  index: job.window.index,
                  total: job.windowCount,
                },
              },
            });
            if (!res.ok) {
              return { ok: false as const, error: relabelRestyleError(res.error, selectedModel) };
            }
            return { ok: true as const, segments: res.episodes[0]?.segments ?? [] };
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : "网络异常",
            };
          }
        },
      });
      if (isRunAborted(projectId)) return { ok: false, error: "已中止" };
      if (!driven.ok) return { ok: false, error: driven.error };
      const planWarnings = [
        `长片分 ${windowJobs.length} 窗生成（单窗 ${PLAN_WINDOW_SEC}s，避开平台约 100s 断连上限）。`,
        ...driven.warnings,
      ];
      // 断连补偿（D6）：重试后仍失败的窗，服务端那次调用可能已滞后扣费——
      // 按同幂等键退款（只退已扣的；滞后入账本轮查不到则由后续重试收敛）。
      const shotsCount = (project.shotSchedule ?? []).length;
      for (const failedJob of driven.failedJobs) {
        const refund = await callRefundChargedCredits({
          data: {
            chargeIdempotencyKey: restylePlanWindowChargeKey({
              videoId: failedJob.videoId,
              windowIndex: failedJob.window.index,
              instructionLength: instruction.length,
              assetsCount: assets.length,
              shotsCount,
            }),
            amount: 1,
            description: `转绘方案分窗退款（${failedJob.videoId} 第 ${failedJob.window.index + 1}/${failedJob.windowCount} 窗）`,
          },
        });
        if (refund.ok && refund.refunded) {
          planWarnings.push(
            `「${failedJob.videoId}」第 ${failedJob.window.index + 1} 窗生成失败，该窗已退款。`,
          );
        }
      }
      // 合并：某集全部窗失败（或无权威时长未参与分窗）时回落占位分段，
      // 缺口由 finalize 的 ensureFullCoverage 补段。
      const mergedEpisodes = effectiveFiles.map((file) => {
        const videoId = file.episode ?? file.id;
        const segments = driven.segmentsByVideo[videoId];
        return {
          episode: videoId,
          segments: segments?.length
            ? segments
            : [
                {
                  id: "U01",
                  prompt: "保持原视频剧情、动作、站位与音频节奏，结合已确认资产完成转绘。",
                },
              ],
        };
      });
      // finalize：合并后分段做覆盖兜底（纯计算、无 LLM、不扣费，秒级返回）。
      // 按集隔离：逐集调 finalize，只传该集分段与该集自己的 shots（D1 回归——
      // 整表调用时 ensureFullCoverage 无法区分镜头归属，降级集的缺口补段会
      // 借用他集镜头边界，分段跨集污染/重叠）。
      try {
        const finalizeWarnings: string[] = [];
        const finalizedEpisodes = await Promise.all(
          mergedEpisodes.map(async (episode, index) => {
            const res = await callFinalizeRestylePlanCoverage({
              data: {
                sourceFiles: [planFilePayload(effectiveFiles[index])],
                episodes: [episode],
                shotSchedule: shotsForEpisode(episode.episode),
              },
            });
            if (!res.ok) throw new Error(res.error);
            finalizeWarnings.push(...(res.warnings ?? []));
            return res.episodes[0] ?? episode;
          }),
        );
        return {
          ok: true,
          episodes: finalizedEpisodes,
          warnings: [...planWarnings, ...finalizeWarnings],
        };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "网络异常" };
      }
    }

    // ===== 短片单次调用（原逻辑） =====
    try {
      const result = await callGenerateRestylePlan({
        data: {
          model: selectedModel,
          instruction,
          sourceFiles: effectiveFiles.map(planFilePayload),
          assets,
          episodeCount,
          existingEpisodes: existingEpisodes ?? [],
          shotSchedule: project.shotSchedule ?? [],
          targetMarket: project.targetMarket ?? "kr",
          projectName: project.title,
        },
      });
      if (!result.ok) {
        return { ok: false, error: relabelRestyleError(result.error, selectedModel) };
      }
      return { ok: true, episodes: result.episodes, warnings: result.warnings ?? [] };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "网络异常" };
    }
  }

  /**
   * 生成转绘方案（目标分镜）。返回是否成功。
   * 成功后按执行模式决定：分步护航 / 自定义勾选环节 → 暂停等确认；
   * 极速全自动（且未勾选视频分组 / 报价环节）→ 直接提交视频生成。
   */
  async function runPlanGeneration(
    projectId: string,
    conversationId: string,
    styleBrief: string,
  ): Promise<boolean> {
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project || !project.extractedAssets.length) return false;
    beginRun(projectId, t.restyle_run_step_plan);
    // 只取原始上传源片：渲染产物（video_clip / final_video）也是 video/*，
    // 混进来会被当成「源视频」生成窗任务与方案集（窗数虚高回归）。
    const sourceFiles = project.files.filter(isSourceVideoFile);
    const episodeCount = sourceFiles.length || 1;
    // 分窗/单次统一入口内部已兜底网络异常，失败必然收敛为可读错误，
    // 否则 running 态永远清不掉、聊天区无失败提示（历史事故）。
    const result = await requestPlanEpisodes({
      projectId,
      project,
      sourceFiles,
      instruction: withTranscript(
        withRelationBrief(withStyleBrief(project.planNote, styleBrief)),
        project.transcript,
      ),
      episodeCount,
    });
    if (!result.ok) {
      if (isRunAborted(projectId)) return false;
      finishRun(projectId, "failed", result.error);
      setAnalysisError(result.error);
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: `转绘方案生成失败：${result.error}`,
      });
      return false;
    }
    if (isRunAborted(projectId)) return false;
    // 覆盖兜底提示：ensureFullCoverage 自动补段的区间数随方案播报透出。
    const coverageFillCount = result.warnings.filter((warning) =>
      warning.includes("已自动补齐未覆盖区间"),
    ).length;
    const coverageNote = coverageFillCount ? `已自动补齐 ${coverageFillCount} 个未覆盖区间。` : "";
    const episodeLinks = result.episodes.map((episode) => episode.episode);
    const sourceVideoNames = episodeLinks.map(sourceVideoLabel);
    updateProject(projectId, (current) => ({
      ...current,
      stage: "plan",
      planEpisodes: result.episodes,
    }));
    finishRun(projectId);
    if (
      pauseAtGate(projectId, "storyboard") ||
      pauseAtGate(projectId, "video_grouping") ||
      pauseAtGate(projectId, "video_quote")
    ) {
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: `已确认资产图片，已生成 ${sourceVideoNames.join("、")} 的转绘方案。${coverageNote}点击视频文件可打开右侧对应提示词。需要微调时，请直接说明视频和分段，例如“请将第一个视频的 U01 光影调整为冷白色调”。调整完成后回复“确认生成视频”。`,
        episodeLinks,
      });
      return true;
    }
    if (budgetExceeded(projectId)) {
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: `已生成 ${sourceVideoNames.join("、")} 的转绘方案。${coverageNote}`,
        episodeLinks,
      });
      pauseForBudget(projectId, conversationId);
      return true;
    }
    // 极速全自动路径没有方案确认播报，覆盖兜底提示单独补一条。
    if (coverageNote) {
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: `已生成 ${sourceVideoNames.join("、")} 的转绘方案。${coverageNote}`,
        episodeLinks,
      });
    }
    const latest = projectsRef.current.find((item) => item.id === projectId) ?? project;
    submitVideoRender(latest, conversationId);
    return true;
  }

  function setProjectStage(nextStage: RestyleStage) {
    if (!activeProject) return;
    updateProject(activeProject.id, (project) => ({ ...project, stage: nextStage }));
  }

  function startRename(project: RestyleProject) {
    setEditingProjectId(project.id);
    setEditingTitle(project.title);
  }

  function saveRename() {
    if (!editingProjectId) return;
    const title = editingTitle.trim();
    if (title) updateProject(editingProjectId, (project) => ({ ...project, title }));
    setEditingProjectId(null);
  }

  function deleteProject(projectId: string) {
    // 删除项目时按文件列表批量释放本地预览 blob，并清掉缩略图 / File 对象引用。
    const target = projectsRef.current.find((project) => project.id === projectId);
    if (target) releaseFileBlobs(target.files.map((file) => file.id));
    setProjects((current) => current.filter((project) => project.id !== projectId));
    if (activeProjectId === projectId) setActiveProjectId(null);
  }

  /** 批量释放附件本地资源：revoke 预览 blob、清缩略图与 fileObjectsRef 对应键。 */
  function releaseFileBlobs(fileIds: string[]) {
    for (const id of fileIds) {
      const url = filePreviewsRef.current[id];
      if (url) URL.revokeObjectURL(url);
      delete filePreviewsRef.current[id];
      delete fileObjectsRef.current[id];
    }
    const dropKeys = (current: Record<string, string>) => {
      const next = { ...current };
      for (const id of fileIds) delete next[id];
      return next;
    };
    setFilePreviews(dropKeys);
    setFileThumbnails(dropKeys);
  }

  function toggleAsset(assetId: string) {
    if (!activeProject) return;
    updateProject(activeProject.id, (project) => {
      const linked = isRestyleAssetLinked(assetId, project.assetIds);
      const rawId = assetId.replace(/^[^:]+:/, "");
      return {
        ...project,
        assetIds: linked
          ? project.assetIds.filter((id) => id !== assetId && id !== rawId)
          : [...project.assetIds, assetId],
        confirmedAssetIds: linked
          ? project.confirmedAssetIds.filter((id) => id !== assetId)
          : project.confirmedAssetIds,
      };
    });
  }

  function toggleAssetConfirmation(assetId: string) {
    if (!activeProject) return;
    updateProject(activeProject.id, (project) => ({
      ...project,
      confirmedAssetIds: project.confirmedAssetIds.includes(assetId)
        ? project.confirmedAssetIds.filter((id) => id !== assetId)
        : [...project.confirmedAssetIds, assetId],
    }));
  }

  function attachFiles(files: FileList | File[] | null, isFolder = false) {
    if (!files?.length) return;
    const project = activeProject ?? createProjectRecord();
    if (!activeProject) {
      setProjects((current) => [project, ...current]);
      setActiveProjectId(project.id);
    }
    const selectedFiles = Array.from(files);
    // 集号按现有 EP\d+ 最大序号续排：删除中间集后新上传取 max+1，不与存量集撞号。
    const episodeLabels = nextEpisodeLabels(
      project.files,
      isFolder ? 0 : selectedFiles.filter((file) => file.type.startsWith("video/")).length,
    );
    let episodeCursor = 0;
    const attachments: RestyleAttachment[] = isFolder
      ? [
          {
            id: crypto.randomUUID(),
            name:
              selectedFiles[0]?.webkitRelativePath.split("/")[0] || selectedFiles[0]?.name || "",
            size: selectedFiles.reduce((total, file) => total + file.size, 0),
            type: "",
            lastModified: selectedFiles[0]?.lastModified ?? 0,
            isFolder: true,
            fileCount: selectedFiles.length,
          },
        ]
      : selectedFiles.map((file) => ({
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
          episode: file.type.startsWith("video/") ? episodeLabels[episodeCursor++] : undefined,
        }));
    const previews = attachments.reduce<Record<string, string>>((current, attachment, index) => {
      const file = selectedFiles[index];
      if (!attachment.isFolder && file && /^(image|video)\//.test(file.type)) {
        current[attachment.id] = URL.createObjectURL(file);
      }
      return current;
    }, {});
    attachments.forEach((attachment, index) => {
      const file = selectedFiles[index];
      if (file && !attachment.isFolder) {
        fileObjectsRef.current[attachment.id] = file;
        if (file.type.startsWith("video/")) {
          // 探测真实媒体时长并持久化（素材库时长校验的权威依据，
          // 不能用逐镜表覆盖时长代替）
          void probeVideoDuration(file)
            .then((sec) => {
              updateProject(project.id, (current) => ({
                ...current,
                files: current.files.map((f) =>
                  f.id === attachment.id ? { ...f, durationSec: sec } : f,
                ),
              }));
            })
            .catch(() => {});
          void extractVideoThumbnail(file)
            .then((thumbnail) => {
              if (!thumbnail) return;
              setFileThumbnails((current) => ({ ...current, [attachment.id]: thumbnail }));
            })
            .catch(() => {});
        }
      }
    });
    setFilePreviews((current) => ({ ...current, ...previews }));
    updateProject(project.id, (currentProject) => ({
      ...currentProject,
      files: [...currentProject.files, ...attachments],
    }));
    // 选中即后台异步上传：视频与 >4MB 文件走签名地址二进制直传，不做 base64。
    attachments
      .filter(
        (attachment) =>
          !attachment.isFolder &&
          shouldUseDirectUpload({ type: attachment.type, size: attachment.size }),
      )
      .forEach((attachment) => {
        void ensureReferenceVideoUrl(project.id, attachment);
      });
    // 直接按目标项目 id 归档：项目刚创建时 activeProjectId 尚未生效，不能用当前项目键。
    setDraftAttachmentIdsByProject((current) => ({
      ...current,
      [project.id]: [
        ...(current[project.id] ?? []),
        ...attachments.map((attachment) => attachment.id),
      ],
    }));
    setAttachmentMenuOpen(false);
  }

  function removeFile(fileId: string) {
    if (!activeProject) return;
    const previewUrl = filePreviews[fileId];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFilePreviews((current) => {
      const { [fileId]: _removed, ...next } = current;
      return next;
    });
    setFileThumbnails((current) => {
      const { [fileId]: _removed, ...next } = current;
      return next;
    });
    setDraftAttachmentIds((current) => current.filter((id) => id !== fileId));
    setAttachmentUploads((current) => {
      const { [fileId]: _removed, ...next } = current;
      return next;
    });
    delete fileObjectsRef.current[fileId];
    delete sourceVideoUploadRef.current[fileId];
    updateProject(activeProject.id, (project) => ({
      ...project,
      files: project.files.filter((file) => file.id !== fileId),
    }));
  }

  function appendConversationMessage(
    projectId: string,
    conversationId: string,
    message: {
      content: string;
      role: "user" | "assistant";
      attachments?: RestyleAttachment[];
      assetTable?: RestyleExtractedAsset[];
      assetCategoryLinks?: Array<"character" | "scene" | "prop">;
      episodeLinks?: string[];
      finalEpisodeLinks?: string[];
    },
  ) {
    updateProject(projectId, (project) => ({
      ...project,
      conversations: project.conversations.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              title:
                conversation.title ||
                message.content.slice(0, 32) ||
                message.attachments?.[0]?.name ||
                "",
              updatedAt: new Date().toISOString(),
              messages: [
                ...conversation.messages,
                { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...message },
              ],
            }
          : conversation,
      ),
    }));
  }

  function attachmentPreview(attachment: RestyleAttachment): RestyleFilePreview {
    return {
      kind: "attachment",
      key: `attachment:${attachment.id}`,
      title: attachment.name,
      attachment,
      projectId: activeProject?.id ?? null,
    };
  }

  function openFilePreview(preview: RestyleFilePreview) {
    setFileContextMenu(null);
    setSelectedFilePreview(preview);
    setInspectorOpen(true);
    if (preview.kind === "attachment" && preview.attachment.type.startsWith("video/")) {
      setPreviewDialog(preview);
    }
  }

  function downloadFilePreview(preview: RestyleFilePreview) {
    const attachment = preview.kind === "attachment" ? preview.attachment : null;
    const localFile = attachment ? fileObjectsRef.current[attachment.id] : undefined;
    const source = localFile
      ? URL.createObjectURL(localFile)
      : attachment
        ? filePreviews[attachment.id]
        : preview.kind === "virtual"
          ? URL.createObjectURL(new Blob([preview.content], { type: preview.mime }))
          : undefined;
    if (!source) return;
    const link = document.createElement("a");
    link.href = source;
    link.download = preview.title;
    link.click();
    if (localFile || preview.kind === "virtual") {
      window.setTimeout(() => URL.revokeObjectURL(source), 0);
    }
    setFileContextMenu(null);
  }

  function deleteFilePreview(preview: RestyleFilePreview) {
    if (preview.kind !== "attachment" || !activeProject) return;
    removeFile(preview.attachment.id);
    setSelectedFilePreview(null);
    setPreviewDialog(null);
    setFileContextMenu(null);
  }

  function toggleFileTreePath(path: string) {
    setClosedFileTreePaths((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    );
  }

  function expandFileTreePath(path: string) {
    setClosedFileTreePaths((current) => current.filter((item) => item !== path));
  }

  function openAssetCategoryFolder(kind: "character" | "scene" | "prop") {
    expandFileTreePath("results");
    expandFileTreePath("results/assets");
    expandFileTreePath(`results/assets/${kind}`);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-file-tree-path="results/assets/${kind}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function previewUrlForAttachment(attachment: RestyleAttachment): string | undefined {
    if (attachment.generatedKind === "final_video" || attachment.generatedKind === "video_clip") {
      return filePreviews[attachment.id] ?? stableVideoUrlFor(attachment);
    }
    return (
      filePreviews[attachment.id] ??
      stableVideoUrlFor(attachment) ??
      (attachment.sourceAttachmentId ? filePreviews[attachment.sourceAttachmentId] : undefined)
    );
  }

  function videoPairForAttachment(attachment: RestyleAttachment): RestyleVideoPair | null {
    if (attachment.generatedKind !== "final_video" && attachment.generatedKind !== "video_clip") {
      return null;
    }
    const source = activeProject?.files.find((file) => file.id === attachment.sourceAttachmentId);
    if (!source) return null;
    return {
      source,
      result: attachment,
      sourceUrl: previewUrlForAttachment(source),
      resultUrl: previewUrlForAttachment(attachment),
    };
  }

  function renderSegmentsForAttachment(attachment: RestyleAttachment): RestyleAttachment[] {
    if (!activeProject) return [];
    const episode = attachment.episode;
    if (!episode) return [];
    // 与结果目录同一处 dedupe：同一分段多次返工只展示最新一条。
    return latestRenderAttachments(
      activeProject.files.filter(
        (file) => file.generatedKind === "video_clip" && file.episode === episode,
      ),
    ).sort((a, b) => (a.segmentId ?? "").localeCompare(b.segmentId ?? ""));
  }

  function openFinalEpisode(episode: string) {
    expandFileTreePath("results");
    expandFileTreePath("results/final");
    const file = activeProject?.files.find(
      (item) => item.generatedKind === "final_video" && item.episode === episode,
    );
    if (!file) return;
    const preview = attachmentPreview(file);
    setSelectedFilePreview(preview);
    setInspectorOpen(true);
  }

  function openPlanEpisode(episode: string) {
    expandFileTreePath("plan");
    expandFileTreePath(`plan/${episode}`);
    expandFileTreePath(`plan/${episode}/提示词`);
    expandFileTreePath(`plan/${episode}/提示词/final`);
    const plan = activeProject?.planEpisodes?.find((item) => item.episode === episode);
    const segment = plan?.segments[0];
    if (segment) {
      const preview = makeVirtualPreview(
        `plan/${episode}/提示词/final/${episode}_${segment.id}.prompt.txt`,
        `${episode}_${segment.id}.prompt.txt`,
        "text/plain",
        segment.prompt,
      );
      setSelectedFilePreview({ ...preview, projectId: activeProject?.id ?? null });
      setInspectorOpen(true);
    }
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-file-tree-path="plan/${episode}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function buildRenderStatusPreview(project: RestyleProject): RestyleFilePreview {
    const renderFiles = project.files.filter(
      (file) => file.generatedKind === "final_video" || file.generatedKind === "video_clip",
    );
    const lines = [
      "# 生成状态",
      "",
      "| 类型 | 集数 | 段落 | 状态 | 进度 | 任务 ID | 结果 URL |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...renderFiles.map((file) =>
        [
          file.generatedKind === "final_video" ? "成片" : "片段",
          file.episode ?? "-",
          file.segmentId ?? "-",
          renderStatusLabel(file.renderStatus),
          `${file.renderProgress ?? 0}%`,
          file.renderTaskId ?? "-",
          file.resultUrl ?? file.url ?? file.renderError ?? "-",
        ].join(" | "),
      ),
      "",
      "## 任务日志",
      ...renderFiles.flatMap((file) => [
        `### ${file.episode ?? "-"} ${file.segmentId ?? "成片"}`,
        ...(file.renderLog?.length ? file.renderLog.map((entry) => `- ${entry}`) : ["- 暂无日志"]),
      ]),
    ];
    return makeVirtualPreview(
      "results/status/render-status.md",
      "render-status.md",
      "text/markdown",
      lines.join("\n"),
    );
  }

  function openRenderStatus() {
    if (!activeProject) return;
    expandFileTreePath("results");
    setSelectedFilePreview({
      ...buildRenderStatusPreview(activeProject),
      projectId: activeProject.id,
    });
    setInspectorOpen(true);
  }

  function updateRenderAttachments(
    projectId: string,
    predicate: (file: RestyleAttachment) => boolean,
    patcher: (file: RestyleAttachment) => RestyleAttachment,
    nextStage?: RestyleStage,
  ) {
    updateProject(projectId, (project) => ({
      ...project,
      stage: nextStage ?? project.stage,
      files: project.files.map((file) => (predicate(file) ? patcher(file) : file)),
    }));
  }

  function appendRenderLog(projectId: string, attachmentId: string, message: string) {
    const entry = `${new Date().toLocaleTimeString("zh-CN", { hour12: false })} ${message}`;
    updateRenderAttachments(
      projectId,
      (file) => file.id === attachmentId,
      (file) => ({ ...file, renderLog: [...(file.renderLog ?? []), entry].slice(-80) }),
    );
  }

  function completeRenderAttachment(
    projectId: string,
    attachmentId: string,
    resultUrl: string,
    taskId?: string,
  ) {
    // 台账同步记账（先于 setState 直接调 record）：updater 内记账会延迟到
    // 渲染阶段执行,收尾同步读取读空（772bbb2 根因）。集/段坐标读 projectsRef
    // （渲染帧滞后读不到新附件时退化为仅 id 记录,id 主键覆盖仍可靠）。
    const completedNow = projectsRef.current
      .find((item) => item.id === projectId)
      ?.files.find((file) => file.id === attachmentId);
    renderRunOutcomesRef.current.record(projectId, {
      attachmentId,
      generatedKind: completedNow?.generatedKind,
      episode: completedNow?.episode,
      segmentId: completedNow?.segmentId,
      ok: true,
      resultUrl,
    });
    updateProject(projectId, (project) => {
      const completed = project.files.find((file) => file.id === attachmentId);
      if (!completed) return project;
      return {
        ...project,
        // 新产物成功写回：同 (episode, segmentId) 的其余片段附件（旧成功产物
        // 与失败占位）从此刻让位移除——成功产物在返工开始时是特意保留的，
        // 只有新片子真正生成成功后才取代（失败重试不丢已有产物）。
        files: withoutSupersededClips(project.files, completed).map((file) => {
          if (file.id === attachmentId) {
            return {
              ...file,
              url: resultUrl,
              resultUrl,
              renderTaskId: taskId ?? file.renderTaskId,
              renderStatus: "succeeded" as const,
              renderProgress: 100,
              renderError: undefined,
              renderLog: [
                ...(file.renderLog ?? []),
                `${new Date().toLocaleTimeString("zh-CN", { hour12: false })} 模型已返回真实视频 URL。`,
              ].slice(-80),
            };
          }
          return file;
        }),
      };
    });
  }

  function failRenderAttachment(
    projectId: string,
    attachmentId: string,
    error: string,
    taskId?: string,
  ) {
    // 台账同步记账（同 completeRenderAttachment：禁止放进 setState updater）
    const failedNow = projectsRef.current
      .find((item) => item.id === projectId)
      ?.files.find((file) => file.id === attachmentId);
    renderRunOutcomesRef.current.record(projectId, {
      attachmentId,
      generatedKind: failedNow?.generatedKind,
      episode: failedNow?.episode,
      segmentId: failedNow?.segmentId,
      ok: false,
      error,
    });
    updateRenderAttachments(
      projectId,
      (file) => file.id === attachmentId,
      (file) => {
        return {
          ...file,
          renderTaskId: taskId ?? file.renderTaskId,
          renderStatus: "failed" as const,
          renderError: error,
          renderProgress: 0,
          renderLog: [
            ...(file.renderLog ?? []),
            `${new Date().toLocaleTimeString("zh-CN", { hour12: false })} 任务失败：${error}`,
          ].slice(-80),
        };
      },
    );
  }

  /** 单段失败的建议动作：按已知上游错误归类文案，其它错误原样提示重试并附 requestId（若有）。 */
  function renderFailureAdvice(error: string): string {
    if (/Duration must be between|duration|时长/i.test(error)) {
      return t.restyle_render_advice_duration;
    }
    if (/资产图|参考图|reference\s*image/i.test(error)) {
      return t.restyle_render_advice_assets;
    }
    const requestId = error.match(/request[\s_-]*id[:：\s]*([A-Za-z0-9-]+)/i)?.[1];
    return requestId
      ? `${t.restyle_render_advice_retry}${t.restyle_render_advice_request_id.replace("{requestId}", requestId)}`
      : t.restyle_render_advice_retry;
  }

  /** 单段失败的对话播报：集号 + 分段号 + 原始错误文本 + 建议动作。 */
  function reportRenderSegmentFailure(
    projectId: string,
    conversationId: string,
    job: { episode?: string; segmentId?: string },
    error: string,
  ) {
    const label = [job.episode, job.segmentId].filter(Boolean).join(" ") || "该分段";
    appendConversationMessage(projectId, conversationId, {
      role: "assistant",
      content: t.restyle_render_segment_failed
        .replace("{label}", label)
        .replace("{error}", error)
        .replace("{advice}", renderFailureAdvice(error)),
    });
  }

  function setAttachmentUpload(attachmentId: string, state: DirectUploadState) {
    setAttachmentUploads((current) => ({ ...current, [attachmentId]: state }));
  }

  /** 上传失败后允许从附件卡片重试：清掉去重缓存再走一次上传通道。 */
  function retryAttachmentUpload(attachment: RestyleAttachment) {
    if (!activeProject) return;
    delete sourceVideoUploadRef.current[attachment.id];
    void ensureReferenceVideoUrl(activeProject.id, attachment);
  }

  async function ensureReferenceVideoUrl(
    projectId: string,
    source: RestyleAttachment,
  ): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
    // 读取来源决策：storageKey（对象 key 永不过期）优先现签；存量签名 URL 照用。
    const readSource = attachmentReadSource(source);
    if (readSource?.type === "storageKey") {
      const signed = await callSignMediaReadUrl({ data: { path: readSource.key } });
      if (signed.ok && signed.url) return { ok: true, url: signed.url };
      // 现签失败（对象被删/网关异常）：回退存量 URL 试一次，再走上传/回退链。
      if (readSource && source.url && /^https?:\/\//i.test(source.url)) {
        return { ok: true, url: source.url };
      }
    } else if (readSource?.type === "url") {
      return { ok: true, url: readSource.url };
    }
    const cached = sourceVideoUploadRef.current[source.id];
    if (cached) return await cached;
    const localFile = fileObjectsRef.current[source.id];
    if (!localFile) {
      // 本地预览已失效：优先回绑到同集重传后的持久 URL 源片，而不是直接报错
      const fallback = pickEpisodeSourceFallback(
        projectsRef.current.find((item) => item.id === projectId)?.files ?? [],
        source,
      );
      if (fallback?.url) {
        updateProject(projectId, (project) => ({
          ...project,
          files: project.files.map((file) =>
            file.id === source.id
              ? { ...file, url: fallback.url, storageKey: fallback.storageKey }
              : file,
          ),
        }));
        return { ok: true, url: fallback.url };
      }
      return { ok: false, error: "原视频只存在于已失效的本地预览中，请重新上传后再生成。" };
    }
    // 视频与 >4MB 文件走签名地址二进制直传（不做 base64）；小图片保留 base64 旧路径。
    const useDirect = shouldUseDirectUpload(localFile);
    if (useDirect) setAttachmentUpload(source.id, { status: "uploading", progress: 0 });
    const upload = (async () => {
      try {
        let url: string;
        let storageKey: string | undefined;
        if (useDirect) {
          const direct = await uploadFileDirect(
            localFile,
            source.id,
            (input) => callCreateMediaUploadUrl({ data: input }),
            (input) => callSignMediaReadUrl({ data: input }),
            (percent) => setAttachmentUpload(source.id, { status: "uploading", progress: percent }),
          );
          if (!direct.ok) return direct;
          url = direct.url;
          storageKey = direct.path;
        } else {
          const base64 = await fileToDataUrl(localFile);
          const result = await callUploadLocalMedia({
            data: { base64, id: source.id, kind: "video" },
          });
          if (!result.ok || !result.url) {
            return {
              ok: false as const,
              error: result.ok ? "原视频上传后没有返回访问地址。" : result.error,
            };
          }
          url = result.url;
        }
        // readUrl + 对象 key 写回 project.files 并随 projects 持久化：url 供展示/缓存，
        // storageKey 供 7 天签名过期后现签（key 永不过期）。
        updateProject(projectId, (project) => ({
          ...project,
          files: project.files.map((file) =>
            file.id === source.id ? { ...file, url, ...(storageKey ? { storageKey } : {}) } : file,
          ),
        }));
        if (useDirect) setAttachmentUpload(source.id, { status: "done", progress: 100 });
        return { ok: true as const, url };
      } catch (error) {
        const message = error instanceof Error ? error.message : "原视频上传失败。";
        if (useDirect) {
          setAttachmentUpload(source.id, { status: "error", progress: 0, error: message });
        }
        return { ok: false as const, error: message };
      }
    })();
    sourceVideoUploadRef.current[source.id] = upload;
    // 失败结果不缓存，后续调用（卡片重试 / 重新生成）可以再次发起上传。
    void upload.then((result) => {
      if (!result.ok) delete sourceVideoUploadRef.current[source.id];
    });
    return await upload;
  }

  /**
   * 分段参考视频：素材库通道（TopenRouter / 客易云 / 筷子）限制参考视频 1.8–30.2 秒，
   * ARK Seedance 直连（r2v）限制 2–15 秒；分钟级原片直接提交会 400。
   * 这里按分段时间区间把原片裁成通道允许时长内的片段再提交：
   * 1. 沿用 ensureReferenceVideoUrl 取回原片持久 URL；
   * 2. 无时长约束的后端、或原片本身不超上限 → 维持整片提交的旧行为；
   * 3. 分段区间 = 模型显式区间 → 场景分组区间（场景优先，不再均分时长）；
   *    逐镜表缺失/无法判定场景时在对话区一次性提示先做原片分析；
   * 4. 有区间 → 提交裁剪任务并轮询取回片段 URL（项目级缓存，同一片段只裁一次）；
   * 5. 无区间 / 裁剪未配置 / 失败 → 降级为不带参考视频提交（url 为 undefined），
   *    不再把整片作为旧行为回退，也不让整段失败。
   */
  async function ensureSegmentReferenceVideoUrl(
    projectId: string,
    job: { attachmentId: string; source: RestyleAttachment; episode?: string; segmentId?: string },
    videoModel: string,
    conversationId: string,
  ): Promise<{ ok: true; url?: string; durationSec?: number } | { ok: false; error: string }> {
    const source = await ensureReferenceVideoUrl(projectId, job.source);
    if (!source.ok) return source;
    // 参考视频时长约束按通道区分：素材库通道 1.8–30s；ARK Seedance 直连
    // （r2v）2–15s；其它后端无约束，维持整片提交的旧行为。
    const referenceLimits = referenceVideoLimitsForModel(videoModel);
    if (!referenceLimits) {
      return { ok: true, url: source.url, durationSec: job.source.durationSec };
    }
    const project = projectsRef.current.find((item) => item.id === projectId);
    const episode = project?.planEpisodes?.find((item) => item.episode === job.episode);
    const segment = episode?.segments.find((item) => item.id === job.segmentId);
    // 合规判定只认浏览器探测的真实媒体时长（持久化在附件上）；
    // 逐镜表覆盖时长只是参考（可能只覆盖部分原片），不得用于直传判定。
    const realDurationMs =
      job.source.durationSec != null ? job.source.durationSec * 1000 : undefined;
    const shotCoverageMs = estimateSourceDurationMs(project?.shotSchedule);
    if (realDurationMs !== undefined && realDurationMs <= referenceLimits.maxMs) {
      appendRenderLog(
        projectId,
        job.attachmentId,
        `原片真实时长 ${(realDurationMs / 1000).toFixed(1)}s 在参考视频时长限制内（真实原片合规），直接作为参考视频。`,
      );
      return { ok: true, url: source.url, durationSec: realDurationMs / 1000 };
    }
    if (realDurationMs === undefined) {
      appendRenderLog(
        projectId,
        job.attachmentId,
        `原片真实时长未知${shotCoverageMs !== undefined ? `（逐镜表覆盖 ${(shotCoverageMs / 1000).toFixed(1)}s，仅供参考不作合规判定）` : ""}，不直接整片上传。`,
      );
    }
    // 逐镜表缺失或完全没有场景信息：无法按场景判定分段边界，在对话区
    // 一次性提示先做原片分析（不打断渲染），参考视频照旧安全降级。
    const shots = project?.shotSchedule ?? [];
    const scenesUndecidable = !shots.length || shots.every((shot) => !shot.scene?.trim());
    if (scenesUndecidable && !shotScheduleHintRef.current.has(projectId)) {
      shotScheduleHintRef.current.add(projectId);
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content:
          "提示：本项目缺少可用的逐镜表（或逐镜表没有场景信息），分段区间无法按场景精确判定，涉及分段将按现有方案处理并安全降级参考视频。建议先完成原片分析生成逐镜表，分段将更准确。",
      });
    }
    const segmentCount = episode?.segments.length ?? 1;
    const range = resolveSegmentTimeRange({
      segmentId: job.segmentId,
      explicit: { startMs: segment?.startMs, endMs: segment?.endMs },
      shots: project?.shotSchedule,
      segmentCount,
      limits: referenceLimits,
    });
    // 推算不出区间（旧项目无逐镜表）：绝不把超长整片回退提交
    // （素材库会 400），降级为不带参考视频。
    if (!range) {
      appendRenderLog(
        projectId,
        job.attachmentId,
        "无法确定该段的原片时间区间（无区间而省略），本段不带参考视频提交（避免整片超长被素材库拒绝）。",
      );
      return { ok: true };
    }
    // 分段依据日志：所属场景名 + 覆盖镜头范围 + 参考区间时长。
    const segmentIndex = segmentIndexFromId(job.segmentId);
    const groupInfo =
      segmentIndex === undefined
        ? undefined
        : rangesFromSceneGroups(shots, segmentCount, referenceLimits)[segmentIndex];
    const rangeSeconds = ((range.endMs - range.startMs) / 1000).toFixed(1);
    appendRenderLog(
      projectId,
      job.attachmentId,
      groupInfo
        ? `分段依据：场景「${groupInfo.scene || "未命名场景"}」，覆盖镜头 ${groupInfo.firstShotNo}–${groupInfo.lastShotNo}，参考区间 ${rangeSeconds}s。`
        : `分段依据：方案显式时间区间（逐镜表不可用），参考区间 ${rangeSeconds}s。`,
    );
    const cacheKey = trimCacheKey(job.source.id, range.startMs, range.endMs);
    const clip = await ensureSegmentReferenceClip({
      sourceUrl: source.url,
      range,
      cachedUrl: project?.trimCacheMap?.[cacheKey],
      submitTrim: (trim) => withBackoffRetry(() => callSubmitVideoTrimJob({ data: trim })),
      pollTrim: (jobId) => withBackoffRetry(() => callPollVideoTrimJob({ data: { jobId } })),
    });
    if (!clip.ok) {
      appendRenderLog(
        projectId,
        job.attachmentId,
        `参考视频裁剪不可用（裁剪失败而省略：${clip.error}），本段不带参考视频提交。`,
      );
      return { ok: true };
    }
    appendRenderLog(
      projectId,
      job.attachmentId,
      clip.fromCache
        ? `命中裁剪缓存的 ${rangeSeconds}s 参考片段。`
        : `已裁剪 ${rangeSeconds}s 参考片段（裁剪成功）。`,
    );
    if (!clip.fromCache) {
      updateProject(projectId, (current) => ({
        ...current,
        trimCacheMap: { ...current.trimCacheMap, [cacheKey]: clip.url },
      }));
    }
    // 参考片段时长按请求区间（endMs-startMs）的名义值返回——不是转码产物的
    // 实测时长；r2v 降档阶梯的贴齐档为此预留 0.3s 安全边距
    // （上游按产物元数据 nb_frames 判定,名义区间与元数据可能差几百毫秒,
    //  旧流复制 bug 片段偏差更大,见 trimCacheKey 的 v2 注释）。
    return { ok: true, url: clip.url, durationSec: (range.endMs - range.startMs) / 1000 };
  }

  /**
   * 分段全部跑完后合成整集成片：按 segmentId 顺序取本集 video_clip 的结果 URL，
   * 交给外部转码服务 concat（原片音轨随分段视频自带，不做二次混音）。
   * 任一分段缺结果就把成片标记为失败并说明缺哪些段，不做静默拼接。
   */
  async function stitchFinalEpisodes(projectId: string, episodes: string[], conversationId?: string) {
    // 合成结果播报（2026-08：此前只写 renderStatus/渲染日志，失败完全静默）
    const report = (content: string) => {
      if (conversationId) {
        appendConversationMessage(projectId, conversationId, { role: "assistant", content });
      }
    };
    for (const episode of episodes) {
      const project = projectsRef.current.find((item) => item.id === projectId);
      // projectsRef 可能滞后一个渲染帧（本轮最后一段的成功写回尚未进 ref）——
      // 用同步台账覆盖后再找占位/校验缺段,避免刚补齐的分段被误判缺失。
      const episodeFiles = applyRunOutcomesToFiles(
        project?.files ?? [],
        renderRunOutcomesRef.current.snapshot(projectId),
      );
      const finalAttachment = episodeFiles.find(
        (file) => file.generatedKind === "final_video" && file.episode === episode,
      );
      if (!finalAttachment) continue;
      const clips = dedupeClipsBySegment(
        episodeFiles
          .filter((file) => file.generatedKind === "video_clip" && file.episode === episode)
          .sort((a, b) => (a.segmentId ?? "").localeCompare(b.segmentId ?? "", "zh-Hans-CN")),
      );
      // 可用产物判定 url ?? resultUrl（旧路径/持久化数据可能只写 resultUrl）
      const clipUrl = (clip: (typeof clips)[number]) => clip.url ?? clip.resultUrl;
      const missing = clips.filter((clip) => !clipUrl(clip) || !/^https?:\/\//i.test(clipUrl(clip)!));
      if (!clips.length || missing.length) {
        const reason = clips.length
          ? `以下分段还没有可用视频，成片未合成：${missing.map((clip) => clip.segmentId ?? clip.name).join("、")}`
          : "本集没有已生成的分段视频，成片未合成。";
        failRenderAttachment(projectId, finalAttachment.id, reason);
        report(`「${episode}」成片合成失败：${reason}`);
        continue;
      }
      // 智能补镜并入：补镜片段按锚点分段插入拼接序列，原片分段顺序与剪辑点不变；
      // 缺结果校验只针对原片分段（补镜产物必有 url，锚点缺失的补镜已被 merge 丢弃）。
      const insertResults = insertClipsRef.current[`${projectId}:${episode}`] ?? [];
      const insertAnchors: Array<AnchoredInsert<RestyleAttachment>> = insertResults.map(
        (insert, index) => ({
          anchorSegmentId: insert.anchorSegmentId,
          position: insert.position,
          item: {
            id: `insert-${episode}-${index + 1}`,
            name: `补镜_${insert.kind === "closeup" ? "情绪特写" : "空镜"}_${index + 1}.mp4`,
            size: 0,
            type: "video/mp4",
            lastModified: Date.now(),
            url: insert.url,
          },
        }),
      );
      const mergedClips = mergeInsertClips(clips, insertAnchors);
      updateRenderAttachments(
        projectId,
        (file) => file.id === finalAttachment.id,
        (file) => ({ ...file, renderStatus: "running", renderProgress: 20 }),
      );
      appendRenderLog(
        projectId,
        finalAttachment.id,
        insertResults.length
          ? `开始按顺序合成 ${mergedClips.length} 个片段（含 ${insertResults.length} 个补镜）：${mergedClips.map((clip) => clip.segmentId ?? clip.name).join(" → ")}`
          : `开始按顺序合成 ${mergedClips.length} 个分段：${mergedClips.map((clip) => clip.segmentId ?? clip.name).join(" → ")}`,
      );
      try {
        const submitted = await callSubmitVideoStitchJob({
          data: {
            episode,
            clips: mergedClips.map((clip) => (clip.url ?? clip.resultUrl) as string),
          },
        });
        if (!submitted.ok) {
          failRenderAttachment(projectId, finalAttachment.id, submitted.error);
          report(`「${episode}」成片合成失败：${submitted.error}`);
          continue;
        }
        const jobId = submitted.jobId;
        let stitched = "";
        let lastError = "合成服务未在预期时间内返回成片。";
        for (let attempt = 0; attempt < 120; attempt += 1) {
          if (isRunAborted(projectId)) return;
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          const polled = await callPollVideoStitchJob({ data: { jobId } });
          if (!polled.ok) {
            lastError = polled.error;
            break;
          }
          if (polled.status === "succeeded") {
            stitched = polled.videoUrl;
            break;
          }
          updateRenderAttachments(
            projectId,
            (file) => file.id === finalAttachment.id,
            (file) => ({
              ...file,
              renderProgress: Math.min(95, (file.renderProgress ?? 20) + 2),
            }),
          );
        }
        if (stitched) {
          // 转码服务的结果同样是临时链接，先转存到自己的桶再落成最终 URL
          const persisted = await callPersistRestyleVideo({
            data: { url: stitched, id: finalAttachment.id },
          });
          const finalUrl = persisted.ok ? persisted.url : stitched;
          if (!persisted.ok) {
            appendRenderLog(
              projectId,
              finalAttachment.id,
              `成片转存素材库失败（链接可能 24h 后失效）：${persisted.error}`,
            );
          }
          completeRenderAttachment(projectId, finalAttachment.id, finalUrl, jobId);
          report(`「${episode}」成片已合成。`);
        } else {
          failRenderAttachment(projectId, finalAttachment.id, lastError, jobId);
          report(`「${episode}」成片合成失败：${lastError}`);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "成片合成请求失败。";
        failRenderAttachment(projectId, finalAttachment.id, reason);
        report(`「${episode}」成片合成失败：${reason}`);
      }
    }
  }

  async function completeRenderQueue(
    projectId: string,
    conversationId: string,
    finalEpisodes: string[],
    videoModel: string,
    // 局部返工 run 涉及的分段所属集（finalEpisodes 为空时用于补触发合成判定）
    rerunEpisodes: string[] = [],
  ) {
    try {
      if (finalEpisodes.length) {
        // 智能补镜（P2）：基础分段全部渲染完成后、整集 stitch 前执行；
        // 任何补镜失败都只跳过该补镜，不影响主片拼接。
        await runSmartInserts(projectId, finalEpisodes, videoModel);
        await stitchFinalEpisodes(projectId, finalEpisodes, conversationId);
      } else if (
        rerunEpisodes.length &&
        // 还有排队返工时不抢着合成——drain 在 finishRun 后拉起下一批,
        // 只有最后一批的收尾看到空队列,合成在这里才真正触发。
        !(pendingRerunsRef.current.get(projectId)?.length)
      ) {
        // 局部返工收尾补合成（2026-08 线上缺口：返工补齐分段后 finalEpisodes
        // 为空,首轮失败的成片永远停在 failed 且无播报）。逐集判定「分段已齐
        // 且无可用成片」,命中才重触发 stitch;合成中/已有成片的集不重复触发。
        const baseFiles =
          projectsRef.current.find((item) => item.id === projectId)?.files ?? [];
        // projectsRef 滞后一个渲染帧（本轮最后一段的成功写回只走了 setProjects），
        // 直接读会把刚补齐的分段判成「分段未齐」（78577c8 实证不命中根因）——
        // 用同步台账覆盖后再判定。
        const currentFiles = applyRunOutcomesToFiles(
          baseFiles,
          renderRunOutcomesRef.current.snapshot(projectId),
        );
        const eligible = rerunEpisodes.filter(
          (episode) => episodeRestitchEligibility(currentFiles, episode).eligible,
        );
        for (const episode of eligible) {
          // 成片占位缺失时补建（stitch 以占位附件落结果;首轮没整集跑过该集
          // 的边角情形下占位不存在,不补建会被 stitch 静默跳过）。
          const filesNow =
            projectsRef.current.find((item) => item.id === projectId)?.files ?? [];
          if (
            filesNow.some(
              (file) => file.generatedKind === "final_video" && file.episode === episode,
            )
          ) {
            continue;
          }
          const anyClip = filesNow.find(
            (file) => file.generatedKind === "video_clip" && file.episode === episode,
          );
          const source = filesNow.find((file) => file.id === anyClip?.sourceAttachmentId);
          const sourceStem = source?.name.replace(/\.[^.]+$/, "") || "转绘视频";
          updateProject(projectId, (project) => ({
            ...project,
            files: [
              ...project.files,
              {
                id: crypto.randomUUID(),
                name: `${sourceStem}_转绘.mp4`,
                size: source?.size ?? 0,
                type: "video/mp4",
                lastModified: Date.now(),
                generatedKind: "final_video" as const,
                sourceAttachmentId: source?.id,
                episode,
                renderTaskId: makeRenderTaskId(episode),
                renderStatus: "queued" as const,
                renderProgress: 0,
              },
            ],
          }));
        }
        if (eligible.length) {
          appendConversationMessage(projectId, conversationId, {
            role: "assistant",
            content: `返工分段已补齐，正在重新合成整集成片：${eligible.join("、")}。`,
          });
          await stitchFinalEpisodes(projectId, eligible, conversationId);
        } else {
          // 诊断播报：进入返工收尾分支但没有集被触发时给出逐集原因,
          // 并附本轮台账的 (集/段) 成败清单——id 错位类假阴性一次复跑即可定论。
          const reasons = rerunEpisodes.map(
            (episode) =>
              `${episode}：${episodeRestitchEligibility(currentFiles, episode).reason ?? "未知"}`,
          );
          const outcomeTags = renderRunOutcomesRef.current
            .snapshot(projectId)
            .map(
              (outcome) =>
                `${outcome.episode ?? "?"}/${outcome.segmentId ?? outcome.generatedKind ?? "?"}${outcome.ok ? "✓" : "×"}`,
            )
            .join(" ");
          appendConversationMessage(projectId, conversationId, {
            role: "assistant",
            content: `局部返工收尾：未触发成片合成（${reasons.join("；")}）。本轮台账：${outcomeTags || "空"}。`,
          });
        }
      }
      if (isRunAborted(projectId)) return;
      updateProject(projectId, (project) => ({ ...project, stage: "review" }));
      const hasFinalVideos = finalEpisodes.length > 0;
      // 成败判定只认本轮台账（renderRunOutcomesRef，同步记录）：读 files 的
      // renderStatus 会拿到旧事件循环的状态——本轮失败不可见（误报「全部完成」）、
      // 上一轮失败残留可见（跨 run 串「首个失败原因」），均已在此回归实证。
      const summary = summarizeRenderRun(renderRunOutcomesRef.current.snapshot(projectId), {
        hasFinalVideos,
      });
      const failedSegments = summary.failedOutcomes;
      const finalOk = summary.finalOk;
      // 失败分段的首条错误摘要直接拼进播报（只取本轮 run 产生的错误）。
      const firstFailed = failedSegments[0];
      const firstErrorSummary = firstFailed?.error
        ? t.restyle_render_queue_first_error
            .replace("{label}", outcomeLabel(firstFailed))
            .replace("{error}", firstFailed.error.slice(0, 160))
        : "";
      const failureLabel = (f: (typeof failedSegments)[number]) =>
        `${f.episode ?? ""}${f.segmentId ? ` ${f.segmentId}` : ""}`;
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: hasFinalVideos
          ? summary.status === "failed"
            ? `渲染结束：${failedSegments.length ? `${failedSegments.map(failureLabel).join("、")} 失败` : "成片合成未成功"}。请在右侧“生成状态”查看原因，可对失败分段点「重试」。${firstErrorSummary}`
            : `${finalEpisodes.join("、")} 的分段视频已生成，并按顺序合成整集成片（保留分段自带音轨）。`
          : // 局部返工（无整集合成）：完成播报同样必须看实际成败——
            // 有失败时报失败原因，不报「全部完成」（D4 残留）。
            failedSegments.length
            ? `局部返工结束：${failedSegments.map(failureLabel).join("、")} 生成失败。请在右侧“生成状态”查看原因，可对失败分段点「重试」。${firstErrorSummary}`
            : "局部返工片段已按队列逐个生成完成。只更新了问题片段，没有重跑整集或整部剧。",
        finalEpisodeLinks: hasFinalVideos ? finalEpisodes : undefined,
      });
    } finally {
      // 渲染队列状态机收尾：无论拼接/播报是否抛错都结束本次 run；
      // 用户主动停止时 stopRun 已收尾，这里不重复。
      // 返工待办由 finishRun 统一 drain（不再手动调用，避免双重拉起）。
      if (!isRunAborted(projectId)) finishRun(projectId);
    }
  }

  /**
   * 补镜静帧 → 首帧模式短视频：静帧作首帧（role=first_frame），无参考视频，
   * duration 取档内最小值（0.5s 特写按 1s 提交），关闭模型自造音轨避免污染
   * 主片音轨。成功后再转存素材库（临时链接约 24h 过期），转存失败沿用原链接。
   */
  async function generateInsertVideo(input: {
    projectId: string;
    job: InsertJob;
    stillUrl: string;
    durationSec: number;
    videoModel: string;
    aspect: RestyleAspect;
  }): Promise<{ ok: boolean; url?: string; error?: string }> {
    try {
      // 渠道时长钳制：诘云等后端低于 4s 也拒（invalid_seconds），
      // 补镜「档内最小值 1s」必须先抬到渠道下限；扣费口径与提交一致。
      const insertDurationLimits = r2vDurationLimitsForModel(input.videoModel);
      const durationSec = Math.min(
        insertDurationLimits.maxSec,
        Math.max(insertDurationLimits.minSec, input.durationSec),
      );
      const content = [
        { type: "text", text: input.job.prompt },
        {
          type: "image_url",
          image_url: { url: input.stillUrl },
          role: "first_frame" as const,
        },
      ];
      const submitted = await callSubmitVideoTask({
        data: {
          content,
          model: input.videoModel,
          ratio: input.aspect,
          resolution: "720P",
          duration: durationSec,
          generateAudio: false,
          watermark: false,
        },
      });
      if (!submitted.ok || !submitted.taskId) {
        return { ok: false, error: submitted.ok ? "视频模型没有返回任务编号" : submitted.error };
      }
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (isRunAborted(input.projectId)) return { ok: false, error: "任务已中止" };
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        let polled: Awaited<ReturnType<typeof callPollVideoTask>>;
        try {
          polled = await callPollVideoTask({
            data: {
              taskId: submitted.taskId,
              backend: submitted.backend,
              model: submitted.model,
              // 与主渲染链同口径：succeeded 时刻服务端按价目扣费（幂等键 taskId）。
              resolution: "720P",
              duration: durationSec,
              label: `补镜 ${input.job.anchorShotNo}`,
              projectName: projectsRef.current.find((item) => item.id === input.projectId)?.title,
            },
          });
        } catch {
          // 轮询幂等，短暂网络抖动不判失败。
          continue;
        }
        if (!polled.ok) {
          if (polled.status === "failed" || polled.status === "cancelled") {
            return { ok: false, error: polled.error };
          }
          continue;
        }
        if (polled.status === "succeeded") {
          if (!polled.videoUrl) {
            return { ok: false, error: "视频任务已完成但没有返回可播放的结果 URL" };
          }
          const persisted = await callPersistRestyleVideo({
            data: { url: polled.videoUrl, id: `insert-${input.job.anchorShotNo}` },
          });
          return { ok: true, url: persisted.ok ? persisted.url : polled.videoUrl };
        }
        if (polled.status === "failed" || polled.status === "cancelled") {
          return {
            ok: false,
            error: `补镜视频任务${polled.status === "cancelled" ? "已取消" : "失败"}`,
          };
        }
      }
      return { ok: false, error: "补镜视频生成超时" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "补镜视频请求失败" };
    }
  }

  /**
   * 智能补镜执行链（仅在 project.smartInsert 开启且有逐镜表时运行）：
   * planInsertJobs 规划触发点 → A 类带同场角色资产图走 I2I 出大特写静帧
   * （光线 +20% 破格写入 prompt），B 类文生图出空镜静帧 → 静帧转短视频 →
   * 结果存 insertClipsRef，由 stitchFinalEpisodes 并入拼接序列。
   * 日志逐条写在该集成片的任务日志里；整体不抛错，失败只跳过对应补镜。
   */
  async function runSmartInserts(projectId: string, episodes: string[], videoModel: string) {
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project?.smartInsert || !project.shotSchedule?.length) return;
    const market = project.targetMarket ?? "kr";
    const imageModel = project.imageModel ?? selectedImageModel;
    // A 类面部锚定参考：同项目角色资产图（面部特征 + 服装风格 Tag 软引导，不强锁）。
    const characterRefs = project.files
      .filter(
        (file) => file.generatedKind === "character" && file.url && /^https?:\/\//i.test(file.url),
      )
      .map((file) => file.url as string)
      .slice(0, 4);
    const jobs = planInsertJobs({
      shots: project.shotSchedule,
      smartInsert: project.smartInsert,
      market,
      styleBrief: project.styleBrief,
      characterReferenceImages: characterRefs,
      customLighting: project.customLighting,
    });
    for (const episode of episodes) {
      if (isRunAborted(projectId)) return;
      const current = projectsRef.current.find((item) => item.id === projectId);
      const finalAttachment = current?.files.find(
        (file) => file.generatedKind === "final_video" && file.episode === episode,
      );
      if (!finalAttachment) continue;
      const logId = finalAttachment.id;
      if (!jobs.length) {
        appendRenderLog(projectId, logId, t.restyle_insert_log_none);
        continue;
      }
      if (budgetExceeded(projectId, videoJobCost(videoModel))) {
        appendRenderLog(projectId, logId, t.restyle_insert_log_budget);
        continue;
      }
      appendRenderLog(
        projectId,
        logId,
        t.restyle_insert_log_start.replace("{count}", String(jobs.length)),
      );
      const results = await runInsertJobs(jobs, {
        generateImage: async ({ prompt }) => {
          const result = await callGenerateImage({
            data: { prompt, model: imageModel, size: "2K" },
          });
          return { url: result.url || undefined, error: result.error };
        },
        generateImageWithReferences: async ({ prompt, referenceImages }) => {
          const result = await callGenerateImageWithReferences({
            data: { prompt, model: imageModel, size: "2K", referenceImages },
          });
          return { url: result.url || undefined, error: result.error };
        },
        stillToVideo: ({ job, stillUrl, durationSec }) =>
          generateInsertVideo({
            projectId,
            job,
            stillUrl,
            durationSec,
            videoModel,
            aspect: current?.aspect ?? "9:16",
          }),
        onJobStart: (job) =>
          appendRenderLog(
            projectId,
            logId,
            job.kind === "closeup"
              ? t.restyle_insert_log_closeup_generating
              : t.restyle_insert_log_establishing_generating,
          ),
        onJobDone: () => appendRenderLog(projectId, logId, t.restyle_insert_log_done),
        onJobSkipped: (_job, reason) =>
          appendRenderLog(projectId, logId, `${t.restyle_insert_log_skipped}${reason}`),
        isAborted: () => isRunAborted(projectId),
      });
      insertClipsRef.current[`${projectId}:${episode}`] = results;
      if (results.length) {
        chargeSpend(projectId, videoJobCost(videoModel) * results.length);
        appendRenderLog(
          projectId,
          logId,
          t.restyle_insert_log_merge.replace("{count}", String(results.length)),
        );
      }
    }
  }

  /**
   * 渲染前素材预审：把首帧图与全部参考图登记进当前视频模型的素材库，
   * 审核通过后改用 asset:// 引用提交，规避 InputImageSensitiveContentDetected 风控。
   * 结果按 url -> assetUrl 缓存到项目级 assetReviewMap（restyleStorage 持久化），
   * 同一张图跨集/跨段只审一次。被拒的图放入 rejected，由调用方剔除后重投；
   * 网络/配置类错误保留原始链接，由服务端转存兜底。
   */
  async function ensureRestyleAssets(input: {
    projectId: string;
    attachmentId: string;
    urls: string[];
    videoModel: string;
  }): Promise<{ assetUrls: Record<string, string>; rejected: string[] }> {
    const result: { assetUrls: Record<string, string>; rejected: string[] } = {
      assetUrls: {},
      rejected: [],
    };
    const vendor = assetLibraryVendorForModel(input.videoModel);
    // 筷子丽帧以公网 URL 作为视频输入，无需替换 asset://；不支持素材库的模型维持原样提交。
    if (!vendor || vendor === "kuaizi") return result;
    const cache =
      projectsRef.current.find((item) => item.id === input.projectId)?.assetReviewMap ?? {};
    const pending: Array<{ url: string; index: number }> = [];
    input.urls.forEach((url, index) => {
      // 素材接口只接受公网 HTTP(S) URL；blob:/data: 交给服务端转存。
      if (!/^https?:\/\//i.test(url)) return;
      const cached = cache[restyleAssetCacheKey(vendor, url)];
      if (cached) result.assetUrls[url] = cached;
      else pending.push({ url, index });
    });
    for (const { url, index } of pending) {
      const label = index === 0 ? "首帧图" : `参考图 ${index + 1}`;
      appendRenderLog(input.projectId, input.attachmentId, `${label}素材入库中…`);
      const name = `doopoo-restyle-${Date.now()}-${index + 1}`.slice(0, 200);
      try {
        // 素材入库加一次退避 2 秒重试，治 Failed to fetch 这类瞬时网络错误。
        type AssetUploadResult =
          | Awaited<ReturnType<typeof callUploadKeyiyunAsset>>
          | Awaited<ReturnType<typeof callUploadJieyunAsset>>
          | Awaited<ReturnType<typeof callUploadTokenponyAsset>>
          | Awaited<ReturnType<typeof callUploadTopenrouterAsset>>;
        const uploaded = await withBackoffRetry(
          (): Promise<AssetUploadResult> =>
            vendor === "keyiyun"
              ? callUploadKeyiyunAsset({ data: { url, assetType: "Image", name } })
              : vendor === "jieyun"
                ? callUploadJieyunAsset({ data: { url, assetType: "Image", name } })
                : vendor === "tokenpony"
                  ? callUploadTokenponyAsset({ data: { url, assetType: "Image", name } })
                  : callUploadTopenrouterAsset({
                      data: { url, assetType: "Image", name, model: input.videoModel },
                    }),
        );
        if (uploaded.ok && uploaded.assetUrl) {
          const assetUrl = uploaded.assetUrl;
          result.assetUrls[url] = assetUrl;
          appendRenderLog(input.projectId, input.attachmentId, `${label}素材已通过审核入库。`);
          const cacheKey = restyleAssetCacheKey(vendor, url);
          updateProject(input.projectId, (project) => ({
            ...project,
            assetReviewMap: { ...project.assetReviewMap, [cacheKey]: assetUrl },
          }));
        } else {
          const error = uploaded.ok ? "素材入库未返回素材引用" : uploaded.error;
          if (/status\s*=\s*failed|入库失败|sensitive|real person/i.test(error)) {
            result.rejected.push(url);
            appendRenderLog(input.projectId, input.attachmentId, `${label}素材被拒：${error}`);
          } else {
            appendRenderLog(
              input.projectId,
              input.attachmentId,
              `${label}素材入库失败，改用原始链接提交：${error}`,
            );
          }
        }
      } catch (error) {
        appendRenderLog(
          input.projectId,
          input.attachmentId,
          `${label}素材入库请求失败，改用原始链接提交：${error instanceof Error ? error.message : "网络错误"}`,
        );
      }
    }
    return result;
  }

  async function runRenderQueue(
    projectId: string,
    conversationId: string,
    jobs: Array<{
      attachmentId: string;
      prompt: string;
      referenceImages: string[];
      source: RestyleAttachment;
      episode?: string;
      segmentId?: string;
    }>,
    finalEpisodes: string[],
    videoModel: string,
    index = 0,
  ): Promise<void> {
    // 用户停止后不再推进后续分段（stopRun 已负责收尾 run 状态）。
    if (isRunAborted(projectId)) return;
    const job = jobs[index];
    if (!job) {
      // 队列穷尽收尾;局部返工 run 把涉及的分段所属集传下去,供补触发合成判定
      // （聊天点名返工的 jobs 带 file.episode,提取纯函数已测）
      const rerunEpisodes = collectRerunEpisodes(jobs);
      completeRenderQueue(projectId, conversationId, finalEpisodes, videoModel, rerunEpisodes);
      return;
    }
    // 单段失败统一出口：除写 renderError 外，向对话播报集号+分段号+原始错误+建议动作。
    // alreadyLogged：submit 阶段失败已由 submitVideoTaskFn 服务端记入 errorLogs
    // （响应带 logged 标记，episode/segmentId 已并入该行），客户端不再重复上报；
    // 仅「提交成功后的轮询/超时失败」由客户端补报。
    const failJob = (error: string, taskId?: string, alreadyLogged = false) => {
      failRenderAttachment(projectId, job.attachmentId, error, taskId);
      reportRenderSegmentFailure(projectId, conversationId, job, error);
      // 视频任务失败接入 errorLogs（fire-and-forget 客户端上报通道，不阻断队列
      // 推进）：submit/poll 请求本身成功、失败是任务终态时服务端无从记录，
      // 上游错误细节（含 provider 返回的原始 error）随 errorMessage 写入。
      // 上报失败写渲染日志可诊断（此前插入静默丢失无从排查）。
      if (alreadyLogged) return;
      void callReportGenerationError({
        data: {
          kind: "video",
          provider: submittedBackend ?? videoModel,
          model: videoModel,
          errorMessage: error,
          durationMs: Date.now() - startedAt,
          requestPayload: {
            episode: job.episode ?? null,
            segmentId: job.segmentId ?? null,
            taskId: taskId ?? null,
            prompt: directedPrompt.slice(0, 240),
          },
        },
      }).then((reported) => {
        if (reported && typeof reported === "object" && "ok" in reported && !reported.ok) {
          appendRenderLog(
            projectId,
            job.attachmentId,
            `错误日志上报失败（不影响本次失败记录）：${(reported as { error?: string }).error ?? "未知错误"}`,
          );
        }
      });
    };
    /** 提交成功后记录的后端名（errorLogs 的 provider 字段；未提交成功时用模型 id）。 */
    let submittedBackend: string | undefined;
    // 预算校验：任何模式下累计消耗达上限即强制暂停，不再提交后续分段。
    const estimatedCost = videoJobCost(videoModel);
    if (budgetExceeded(projectId, estimatedCost)) {
      failRenderAttachment(projectId, job.attachmentId, t.restyle_setup_budget_pause);
      pauseForBudget(projectId, conversationId);
      finishRun(projectId, "failed", t.restyle_setup_budget_pause);
      return;
    }
    const queueProject = projectsRef.current.find((item) => item.id === projectId);
    // 项目画幅：转绘右栏选项区配置（默认 9:16），随项目持久化。
    const projectAspect = queueProject?.aspect ?? "9:16";
    // 导演镜头调度注入：按分段就近匹配逐镜表生成调度块前缀；无逐镜表时原样提交。
    // 自定义光照风格（我的风格库）存在时优先于 targetMarket 地域预设。
    const directed = withSegmentDirection(job.prompt, {
      shots: queueProject?.shotSchedule,
      segmentId: job.segmentId,
      market: queueProject?.targetMarket ?? "kr",
      customLighting: queueProject?.customLighting,
    });
    const directedPrompt = directed.prompt;
    // 光线调度主路径：本镜实际光照参数写渲染日志，供用户下次微调参考。
    if (directed.lighting) {
      appendRenderLog(
        projectId,
        job.attachmentId,
        `光照参数：${formatLightingParams(directed.lighting)}` +
          (directed.lightingNote ? `；${directed.lightingNote}` : ""),
      );
    }
    updateRenderAttachments(
      projectId,
      (file) => file.id === job.attachmentId,
      (file) => ({ ...file, renderStatus: "running", renderProgress: 15 }),
    );
    appendRenderLog(projectId, job.attachmentId, `已提交 ${videoModel}，正在等待模型创建任务。`);
    const startedAt = Date.now();
    const heartbeat = window.setInterval(() => {
      const seconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      appendRenderLog(projectId, job.attachmentId, `模型仍在生成中，已等待 ${seconds} 秒。`);
    }, 20_000);
    try {
      appendRenderLog(projectId, job.attachmentId, "正在上传原视频，作为动作、镜头和节奏参考。");
      const referenceVideo = await ensureSegmentReferenceVideoUrl(
        projectId,
        job,
        videoModel,
        conversationId,
      );
      if (!referenceVideo.ok) {
        failJob(referenceVideo.error);
      } else {
        appendRenderLog(
          projectId,
          job.attachmentId,
          referenceVideo.url
            ? "参考视频已就绪，正在提交转绘任务。"
            : "本段不带参考视频，正在提交转绘任务。",
        );
        // 素材库预审：首帧图 + 全部参考图先登记为 asset:// 引用（同图跨集/跨段只审一次）；
        // 预审被拒的图直接剔除，从 without-rejected 阶段开始。
        const preChecked = await ensureRestyleAssets({
          projectId,
          attachmentId: job.attachmentId,
          urls: job.referenceImages,
          videoModel,
        });
        const dropped: string[] = [...preChecked.rejected];
        let stage: RestyleFallbackStage = dropped.length ? "without-rejected" : "full";
        // 时长按分段的场景区间计算（按渠道分档夹取，缺省 2~15s；
        // 诘云实测 invalid_seconds 要求 4-15s），不再硬编码 5s——
        // 否则 110s 原片只能产出 8×5s=40s。
        const durationLimits = r2vDurationLimitsForModel(videoModel);
        const segmentForDuration = projectsRef.current
          .find((item) => item.id === projectId)
          ?.planEpisodes?.find((item) => item.episode === job.episode)
          ?.segments.find((item) => item.id === job.segmentId);
        const segmentDurationSec =
          segmentForDuration?.endMs != null && segmentForDuration?.startMs != null
            ? Math.min(
                durationLimits.maxSec,
                Math.max(
                  durationLimits.minSec,
                  Math.round((segmentForDuration.endMs - segmentForDuration.startMs) / 1000),
                ),
              )
            : 5;
        // 上游时长校验拒绝（如 r2v 模式 duration 档位与 t2v 不同、或时长超过
        // 参考视频实际时长）时的自适应降级：先按降档序列重投（贴参考片段实际
        // 时长优先，再按安全离散档下探，部分网关只收离散档），降档穷尽后
        // 移除参考视频再重投一次（r2v 校验随之消失）。
        let durationSec = segmentDurationSec;
        // 降档序列:贴参考时长(-0.3s 边距)优先,离散档随后;TopenRouter 末尾
        // 还有 -1 智能档兜底(上游自选时长,r2vDurationLimitsForModel 标注)。
        const durationRetries: number[] = r2vDurationRetryLadder(
          segmentDurationSec,
          referenceVideo.ok ? referenceVideo.durationSec : undefined,
          durationLimits,
        );
        let referenceDroppedForDuration = false;

        /** 单个任务的轮询：返回终态（成功 URL / 带明细的失败 / 中止标记）。 */
        const pollRenderTask = async (task: {
          taskId: string;
          backend: typeof submittedBackend & string;
          model: string;
        }): Promise<
          { ok: true; videoUrl: string } | { ok: false; error: string; aborted?: boolean }
        > => {
          // 轮询上限 120 次 × 5s：超限判失败，避免后端任务卡死时前端永久轮询；
          // 中止时立即退出（由调用方收尾，不播报失败）。
          let pollCount = 0;
          while (true) {
            if (isRunAborted(projectId)) return { ok: false, error: "", aborted: true };
            pollCount += 1;
            if (pollCount > 120) {
              return {
                ok: false,
                error: "视频生成超时：已等待约 10 分钟仍未完成，请稍后重试该分段。",
              };
            }
            await new Promise<void>((resolve) => window.setTimeout(resolve, 5_000));
            let polled: Awaited<ReturnType<typeof callPollVideoTask>>;
            try {
              polled = await callPollVideoTask({
                data: {
                  taskId: task.taskId,
                  backend: task.backend,
                  model: task.model,
                  // 成功扣费参数：提交时的分辨率与最终时长（降档重投后为准）；
                  // 服务端在 succeeded 时刻按价目扣费（幂等键 taskId）。
                  resolution: "720P",
                  duration: durationSec,
                  label: [job.episode, job.segmentId].filter(Boolean).join(" ") || undefined,
                  // 项目维度（后台按项目名查明细）;取当前项目标题
                  projectName: projectsRef.current.find((item) => item.id === projectId)?.title,
                },
              });
            } catch (error) {
              // 轮询是幂等的，短暂的 502/网络抖动不应直接把已提交的任务标记失败。
              appendRenderLog(
                projectId,
                job.attachmentId,
                `任务查询暂时不可用，将自动重试：${error instanceof Error ? error.message : "网络错误"}`,
              );
              continue;
            }
            if (!polled.ok) {
              if (polled.status === "failed" || polled.status === "cancelled") {
                return { ok: false, error: polled.error };
              }
              appendRenderLog(
                projectId,
                job.attachmentId,
                `任务查询失败，将自动重试：${polled.error}`,
              );
              continue;
            }
            if (polled.status === "succeeded") {
              // 计费兜底提示（剥前缀/默认档计价）写渲染日志，可观测不静默。
              if ("chargeWarning" in polled && polled.chargeWarning) {
                appendRenderLog(projectId, job.attachmentId, `计费提示：${polled.chargeWarning}`);
              }
              if (!polled.videoUrl) {
                return { ok: false, error: "视频任务已完成但没有返回可播放的结果 URL" };
              }
              appendRenderLog(projectId, job.attachmentId, `模型任务 ${task.taskId} 返回成功。`);
              return { ok: true, videoUrl: polled.videoUrl };
            }
            if (polled.status === "failed" || polled.status === "cancelled") {
              // 执行阶段失败：上游明细由服务端从 raw 提取（errorDetail），
              // 取不到回退状态原文（此前只有「视频任务失败」占位）。
              return {
                ok: false,
                error:
                  ("errorDetail" in polled && polled.errorDetail) ||
                  `视频任务${polled.status === "cancelled" ? "已取消" : "失败"}`,
              };
            }
            const progress = polled.status === "running" ? 65 : 40;
            updateRenderAttachments(
              projectId,
              (file) => file.id === job.attachmentId,
              (file) => ({ ...file, renderStatus: "running" as const, renderProgress: progress }),
            );
            appendRenderLog(
              projectId,
              job.attachmentId,
              polled.status === "running" ? "模型正在生成视频。" : "任务正在队列中等待执行。",
            );
          }
        };

        let finalTask: Extract<
          Awaited<ReturnType<typeof callSubmitVideoTask>>,
          { ok: true }
        > | null = null;
        let finalVideoUrl: string | null = null;
        let submitFailure: string | null = null;
        // submit 阶段失败是否已被服务端记入 errorLogs（响应 logged 标记）：
        // 已记则 failJob 不再重复上报（轮询/超时失败不受影响，仍由客户端补报）。
        let submitFailureLogged = false;
        let pollFailure: { error: string; taskId?: string } | null = null;
        let runAborted = false;
        // 统一「提交 + 执行」重试入口：提交失败与轮询（执行）阶段失败共用同一条
        // 时长降档链（执行阶段才爆 r2v duration 400 的回归），9 次硬上限防死循环；
        // 内容审核类错误不匹配 r2v 特征（isR2vDurationError 排除），只透传原因。
        for (let attempt = 0; attempt < 9; attempt++) {
          const keptImages = job.referenceImages.filter((url) => !dropped.includes(url));
          const content = buildRestyleVideoContent({
            prompt: directedPrompt,
            imageUrls: keptImages.map((url) => preChecked.assetUrls[url] ?? url),
            referenceVideoUrl: referenceDroppedForDuration ? undefined : referenceVideo.url,
            stage,
          });
          const result = await callSubmitVideoTask({
            data: {
              content,
              model: videoModel,
              ratio: projectAspect,
              resolution: "720P",
              duration: durationSec,
              generateAudio: true,
              watermark: false,
              // 转绘链上下文：submit 失败时并入服务端 errorLogs 行（配合 logged 标记）
              episode: job.episode,
              segmentId: job.segmentId,
            },
          });
          if (result.ok && result.taskId) {
            submittedBackend = result.backend ?? undefined;
            appendRenderLog(
              projectId,
              job.attachmentId,
              `模型任务 ${result.taskId} 已创建，正在后台生成。`,
            );
            // 任务提交成功即计入预算消耗（按提交时的单价预估）。
            chargeSpend(projectId, estimatedCost);
            updateRenderAttachments(
              projectId,
              (file) => file.id === job.attachmentId,
              (file) => ({
                ...file,
                renderTaskId: result.taskId,
                renderStatus: "running" as const,
                renderProgress: 25,
              }),
            );
            const polled = await pollRenderTask({
              taskId: result.taskId,
              backend: result.backend as typeof submittedBackend & string,
              model: result.model,
            });
            if (polled.ok) {
              finalTask = result as Extract<typeof result, { ok: true }>;
              finalVideoUrl = polled.videoUrl;
              break;
            }
            if (polled.aborted) {
              runAborted = true;
              break;
            }
            // 执行阶段失败的 r2v 时长特征：与提交失败同一降档链（贴参考片段
            // 实际时长优先，降档穷尽移除参考视频转 t2v）。
            if (isR2vDurationError(polled.error)) {
              const nextDuration = durationRetries.find((d) => d < durationSec);
              if (nextDuration !== undefined) {
                appendRenderLog(
                  projectId,
                  job.attachmentId,
                  `执行阶段时长校验未通过（${polled.error.slice(0, 120)}），降为 ${nextDuration}s 重投。`,
                );
                durationSec = nextDuration;
                continue;
              }
              if (!referenceDroppedForDuration && referenceVideo.url) {
                referenceDroppedForDuration = true;
                appendRenderLog(
                  projectId,
                  job.attachmentId,
                  "执行阶段时长校验未通过，已移除参考视频后重投。",
                );
                continue;
              }
            }
            pollFailure = { error: polled.error, taskId: result.taskId };
            break;
          }
          const error = result.ok ? "视频模型没有返回任务编号" : result.error;
          // submit 阶段失败且服务端已记 errorLogs（logged 标记）时,最终 failJob 不再重复上报
          const resultLogged = !result.ok && (result as { logged?: boolean }).logged === true;
          // 余额不足（creditsGuard INSUFFICIENT_CREDITS）：不走进降级重投链，强制暂停等用户处理。
          const resultCode = "code" in result ? (result as { code?: string }).code : undefined;
          if (resultCode === "INSUFFICIENT_CREDITS" || isInsufficientCreditsError(error)) {
            submitFailure = error;
            break;
          }
          // 上游时长校验拒绝（提交阶段）：与真人降级链独立。先降档重投，
          // 降档穷尽后移除参考视频重投一次。
          if (/Duration must be between|duration|时长/i.test(error ?? "")) {
            const nextDuration = durationRetries.find((d) => d < durationSec);
            if (nextDuration !== undefined) {
              appendRenderLog(
                projectId,
                job.attachmentId,
                `时长 ${durationSec}s 未通过上游校验，降为 ${nextDuration}s 重投。`,
              );
              durationSec = nextDuration;
              continue;
            }
            if (!referenceDroppedForDuration && referenceVideo.url) {
              referenceDroppedForDuration = true;
              appendRenderLog(
                projectId,
                job.attachmentId,
                "参考视频/时长组合未通过上游校验，已移除参考视频后重投。",
              );
              continue;
            }
          }
          const plan = planRestyleFallback({
            stage,
            error,
            content,
            droppedUrls: dropped.map((url) => preChecked.assetUrls[url] ?? url),
          });
          if (!plan) {
            submitFailure = isSensitiveContentError(error)
              ? RESTYLE_FALLBACK_EXHAUSTED_MESSAGE
              : error;
            submitFailureLogged = resultLogged;
            break;
          }
          appendRenderLog(projectId, job.attachmentId, plan.message);
          // content 里的 URL 可能已被映射成 asset://，剔除时映射回原始 URL 口径。
          for (const submittedUrl of plan.dropUrls) {
            const original =
              keptImages.find((url) => (preChecked.assetUrls[url] ?? url) === submittedUrl) ??
              submittedUrl;
            if (!dropped.includes(original)) dropped.push(original);
          }
          stage = plan.stage;
        }
        if (!runAborted && (!finalTask || !finalVideoUrl)) {
          if (!pollFailure && isInsufficientCreditsError(submitFailure)) {
            // 余额不足走专属播报（不重复发单段失败消息），任务不再自动推进。
            failRenderAttachment(
              projectId,
              job.attachmentId,
              submitFailure ?? RESTYLE_FALLBACK_EXHAUSTED_MESSAGE,
            );
            appendConversationMessage(projectId, conversationId, {
              role: "assistant",
              content: submitFailure ?? "",
            });
          } else {
            failJob(
              pollFailure?.error ?? submitFailure ?? RESTYLE_FALLBACK_EXHAUSTED_MESSAGE,
              pollFailure?.taskId,
              // submit 阶段失败服务端已记 errorLogs 的不再重复上报；轮询/超时失败仍补报
              !pollFailure && submitFailureLogged,
            );
          }
        } else if (finalTask && finalVideoUrl) {
          appendRenderLog(projectId, job.attachmentId, "正在转存视频到素材库…");
          // 模型 TOS 链接约 24h 过期，先转存素材库再写回
          const persisted = await callPersistRestyleVideo({
            data: { url: finalVideoUrl, id: job.attachmentId },
          });
          const finalUrl = persisted.ok ? persisted.url : finalVideoUrl;
          appendRenderLog(
            projectId,
            job.attachmentId,
            persisted.ok
              ? "已转存素材库，链接长期有效。"
              : `转存失败（链接可能 24h 后失效）：${persisted.error}`,
          );
          completeRenderAttachment(projectId, job.attachmentId, finalUrl, finalTask.taskId);
        }
      }
    } catch (error) {
      failJob(error instanceof Error ? error.message : "视频生成请求失败");
    } finally {
      window.clearInterval(heartbeat);
    }
    await runRenderQueue(projectId, conversationId, jobs, finalEpisodes, videoModel, index + 1);
  }

  function generateRenderedVideos(
    projectId: string,
    conversationId: string,
    rerun?: RestyleRerunRequest,
  ) {
    // 必须用 projectsRef 取最新项目：本函数常在多次 await（分析→方案→确认）之后
    // 执行，渲染闭包里的 projects 是发起时的旧快照，可能没有刚写入的源片，
    // 会误报「没有找到可用于生成的视频源文件」。
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project) return;
    // 渲染队列状态机：同一项目同时只允许一个活跃队列。
    // 局部返工（rerun 指定 segmentId，含聊天点名与按钮重试）忙时进待办队列而不是
    // 拒绝，渲染队列收尾后自动开跑；整集/全量生成仍保留原来的拒绝提示。
    if (isProjectRunning(projectId)) {
      if (!rerun?.segmentId) {
        appendConversationMessage(projectId, conversationId, {
          role: "assistant",
          content: "该项目已有任务正在进行中，请等待完成（或点击停止）后再发起新的生成。",
        });
        return;
      }
      const pending = pendingRerunsRef.current.get(projectId) ?? [];
      // 队列去重：同 episode + segmentId 已在队列或正在跑时，不重复入队。
      const alreadyPending = isPendingRerun(pending, rerun);
      const alreadyRendering = project.files.some(
        (file) =>
          file.generatedKind === "video_clip" &&
          file.episode === rerun.episode &&
          file.segmentId === rerun.segmentId &&
          (file.renderStatus === "queued" || file.renderStatus === "running"),
      );
      if (alreadyPending || alreadyRendering) {
        appendConversationMessage(projectId, conversationId, {
          role: "assistant",
          content: `${rerun.episode} ${rerun.segmentId} 该片段已在队列中。`,
        });
        return;
      }
      pendingRerunsRef.current.set(projectId, [...pending, { conversationId, rerun }]);
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: `已加入队列，前面还有 ${pending.length} 个任务，完成后自动开始。`,
      });
      // 把对应片段卡片置为「排队中」，让用户在右侧看到它已排上（仅改失败状态的卡片，
      // 正在跑的片段不动）。
      updateRenderAttachments(
        projectId,
        (file) =>
          file.generatedKind === "video_clip" &&
          file.episode === rerun.episode &&
          file.segmentId === rerun.segmentId &&
          file.renderStatus === "failed",
        (file) => ({ ...file, renderStatus: "queued" as const, renderError: undefined }),
      );
      return;
    }
    beginRun(projectId, t.restyle_run_step_render);
    // 视频模型按目标项目取：持久化值优先；同项目用当前下拉值；跨项目回落默认，
    // 避免切换项目后 A 的渲染误用 B 的模型。
    const videoModel =
      project.videoModel ??
      (projectId === activeProjectId ? selectedVideoModel : defaultRestyleVideoModel);
    const sourceFiles = project.files.filter(
      (file) => file.type.startsWith("video/") && !file.isFolder,
    );
    const allPlanEpisodes = project.planEpisodes?.length
      ? project.planEpisodes
      : sourceFiles.map((file) => ({
          episode: file.episode ?? file.id,
          segments: [{ id: "U01", prompt: "保持原片剧情、动作、站位与音频节奏完成转绘。" }],
        }));
    const planEpisodes = rerun
      ? allPlanEpisodes
          .filter((episode) => episode.episode === rerun.episode)
          .map((episode) => ({
            ...episode,
            segments: rerun.segmentId
              ? episode.segments.filter((segment) => segment.id === rerun.segmentId)
              : episode.segments,
          }))
      : allPlanEpisodes;
    const allReferenceImages = project.files
      .filter(
        (file) =>
          (file.generatedKind === "character" ||
            file.generatedKind === "scene" ||
            file.generatedKind === "prop") &&
          Boolean(file.url),
      )
      .map((file) => file.url as string)
      .slice(0, 9);
    const referenceImages = rerun?.referenceAssetIds?.length
      ? project.files
          .filter(
            (file) =>
              rerun.referenceAssetIds?.includes(file.id) &&
              (file.generatedKind === "character" ||
                file.generatedKind === "scene" ||
                file.generatedKind === "prop") &&
              Boolean(file.url),
          )
          .map((file) => file.url as string)
          .slice(0, 9)
      : allReferenceImages;
    if (!referenceImages.length) {
      const missing = [...new Set(project.extractedAssets.map((asset) => asset.kind))]
        .map((kind) => (kind === "character" ? "角色" : kind === "scene" ? "场景" : "道具"))
        .join("、");
      finishRun(projectId, "failed", "缺少可用的转绘资产图");
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: `还没有可用的转绘资产图${missing ? `（资产表里待生成：${missing}）` : ""}。请直接回复“生成资产图片”，我会按资产表逐张生成；确认无误后再回复“确认生成视频”。`,
      });
      // 本次返工提前失败也要继续推进待办队列（finishRun 统一 drain，
      // 不再手动调用，避免双重拉起），避免后续排队片段被卡死。
      return;
    }
    const attachments: RestyleAttachment[] = planEpisodes.flatMap((episode, episodeIndex) => {
      const source =
        (rerun?.sourceAttachmentId
          ? sourceFiles.find((file) => file.id === rerun.sourceAttachmentId)
          : undefined) ??
        sourceFiles.find(
          (file) => file.id === episode.episode || file.episode === episode.episode,
        ) ??
        sourceFiles[episodeIndex] ??
        sourceFiles[0];
      if (!source) return [];
      const sourceStem = source.name.replace(/\.[^.]+$/, "") || "转绘视频";
      const clips = episode.segments.map((segment) => ({
        id: crypto.randomUUID(),
        name: `${sourceStem}_${segment.id}.mp4`,
        size: source.size,
        type: "video/mp4",
        lastModified: Date.now(),
        generatedKind: "video_clip" as const,
        sourceAttachmentId: source.id,
        episode: episode.episode,
        segmentId: segment.id,
        renderTaskId: makeRenderTaskId(episode.episode, segment.id),
        renderStatus: "queued" as const,
        renderProgress: 0,
        rerunOfAttachmentId: rerun?.rerunOfAttachmentId,
        feedback: rerun?.feedback,
      }));
      if (rerun?.segmentId) return clips;
      return [
        ...clips,
        {
          id: crypto.randomUUID(),
          name: `${sourceStem}_转绘.mp4`,
          size: source.size,
          type: "video/mp4",
          lastModified: Date.now(),
          generatedKind: "final_video" as const,
          sourceAttachmentId: source.id,
          episode: episode.episode,
          renderTaskId: makeRenderTaskId(episode.episode),
          renderStatus: "queued" as const,
          renderProgress: 0,
          rerunOfAttachmentId: rerun?.rerunOfAttachmentId,
          feedback: rerun?.feedback,
        },
      ];
    });
    if (!attachments.length) {
      // 区分「真的没上传」与「上传还在进行中（url 尚未写回持久地址）」，避免用户误以为源片丢失。
      const hasUploadingVideo = sourceFiles.some(
        (file) => !file.url || file.url.startsWith("blob:"),
      );
      finishRun(
        projectId,
        "failed",
        hasUploadingVideo ? "原片仍在上传中" : "没有找到可用于生成的视频源文件",
      );
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: hasUploadingVideo
          ? "原片仍在上传中，请等待上传完成后再确认生成。"
          : "没有找到可用于生成的视频源文件，请先上传原片后再确认生成。",
      });
      // 本次返工提前失败也要继续推进待办队列（finishRun 统一 drain，
      // 不再手动调用，避免双重拉起），避免后续排队片段被卡死。
      return;
    }
    const finalEpisodes = attachments
      .filter((file) => file.generatedKind === "final_video")
      .map((file) => file.episode)
      .filter((episode): episode is string => Boolean(episode));
    const jobs = attachments
      // 成片不再交给视频模型整集重跑：分段跑完后由外部转码服务按顺序拼接（见 stitchFinalEpisodes）。
      .filter((file) => file.generatedKind === "video_clip")
      .map((file) => {
        const episode = planEpisodes.find((item) => item.episode === file.episode);
        const segment = episode?.segments.find((item) => item.id === file.segmentId);
        const source = sourceFiles.find((item) => item.id === file.sourceAttachmentId);
        if (!source) return null;
        return {
          attachmentId: file.id,
          prompt:
            segment?.prompt ||
            "保持角色、场景、动作、镜头与节奏一致，生成符合已确认转绘资产的短视频。",
          referenceImages,
          source,
          episode: file.episode,
          segmentId: file.segmentId,
        };
      })
      .filter(
        (
          job,
        ): job is {
          attachmentId: string;
          prompt: string;
          referenceImages: string[];
          source: RestyleAttachment;
          episode: string | undefined;
          segmentId: string | undefined;
        } => Boolean(job),
      );
    updateProject(projectId, (item) => ({
      ...item,
      stage: "render",
      // 返工开始时移除被取代的旧片段附件（含上一轮失败残留），否则同
      // (episode, segmentId) 新旧附件并存：汇总播报出现重复条目，且首条
      // 失败原因会抓到旧附件上的历史错误（本轮失败原因必须只看本轮）。
      files: [
        ...item.files.filter((file) =>
          rerun
            ? !isSupersededClipAttachment(file, rerun)
            : file.generatedKind !== "final_video" && file.generatedKind !== "video_clip",
        ),
        ...attachments,
      ],
    }));
    // 新一轮渲染 run 开始：重置成败台账（队列收尾播报只认本轮成败，
    // 跨 run 不串历史失败原因）。
    renderRunOutcomesRef.current.reset(projectId);
    void runRenderQueue(projectId, conversationId, jobs, [...new Set(finalEpisodes)], videoModel);
  }

  /** 失败任务一键重试：沿用原提示词与参考素材重新提交，不再追问返工原因。 */
  function retryVideoSegment(segment: RestyleAttachment) {
    if (!activeProject || !activeConversation || !segment.episode || !segment.segmentId) return;
    appendConversationMessage(activeProject.id, activeConversation.id, {
      role: "assistant",
      content: `已重试 ${segment.episode} ${segment.segmentId}，沿用原提示词与参考素材重新提交。`,
    });
    generateRenderedVideos(activeProject.id, activeConversation.id, {
      episode: segment.episode,
      segmentId: segment.segmentId,
      feedback: segment.feedback || `${segment.episode} ${segment.segmentId} 重试`,
      sourceAttachmentId: segment.sourceAttachmentId,
      rerunOfAttachmentId: segment.id,
    });
  }

  /** 本地预览失效的原视频：就地替换文件并立即后台上传换持久 URL。 */
  function requestReuploadSourceVideo(attachment: RestyleAttachment) {
    if (!activeProject) return;
    reuploadTargetRef.current = { projectId: activeProject.id, attachmentId: attachment.id };
    reuploadInputRef.current?.click();
  }

  async function handleReuploadSourceVideo(file: File | undefined) {
    const target = reuploadTargetRef.current;
    reuploadTargetRef.current = null;
    if (!target || !file) return;
    // 保留原 attachment id 就地替换：失败任务的 sourceAttachmentId 不变，重试即可复用新链接。
    fileObjectsRef.current[target.attachmentId] = file;
    delete sourceVideoUploadRef.current[target.attachmentId];
    setFilePreviews((current) => ({
      ...current,
      [target.attachmentId]: URL.createObjectURL(file),
    }));
    updateProject(target.projectId, (project) => ({
      ...project,
      files: project.files.map((item) =>
        item.id === target.attachmentId
          ? {
              ...item,
              size: file.size,
              type: file.type || item.type,
              lastModified: file.lastModified,
              url: undefined,
            }
          : item,
      ),
    }));
    void extractVideoThumbnail(file)
      .then((thumbnail) => {
        if (!thumbnail) return;
        setFileThumbnails((current) => ({ ...current, [target.attachmentId]: thumbnail }));
      })
      .catch(() => {});
    const attachment = projects
      .find((item) => item.id === target.projectId)
      ?.files.find((item) => item.id === target.attachmentId);
    if (!attachment) return;
    const uploaded = await ensureReferenceVideoUrl(target.projectId, {
      ...attachment,
      url: undefined,
    });
    const conversationId = activeConversation?.id;
    if (conversationId) {
      appendConversationMessage(target.projectId, conversationId, {
        role: "assistant",
        content: uploaded.ok
          ? "原视频已重新上传并换取持久链接。该集失败的片段可在“生成状态”中点“重试”单独重跑。"
          : `原视频重新上传失败：${uploaded.error}`,
      });
    }
  }

  const [rerunTarget, setRerunTarget] = useState<RestyleAttachment | null>(null);

  function rerunVideoSegment(segment: RestyleAttachment) {
    if (!segment.episode || !segment.segmentId) return;
    setRerunTarget(segment);
  }

  /**
   * 聊天里的「按集/按片段重跑」入口，等价于右侧「返工」按钮。
   * 返回 false 表示项目还没有方案也没有渲染产物，交给后续路由分支处理。
   */
  function handleSegmentRerunIntent(
    projectId: string,
    conversationId: string,
    intent: SegmentRerunIntent,
  ): boolean {
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project) return false;
    const hasRendered = project.files.some(
      (file) => file.generatedKind === "video_clip" || file.generatedKind === "final_video",
    );
    if (!project.planEpisodes?.length && !hasRendered) return false;
    // 与 generateRenderedVideos 相同的回落：无方案时每条源片视作一集一段（U01）。
    const episodes = project.planEpisodes?.length
      ? project.planEpisodes
      : project.files
          .filter((file) => file.type.startsWith("video/") && !file.isFolder)
          .map((file) => ({
            episode: file.episode ?? file.id,
            segments: [{ id: "U01", prompt: "" }],
          }));
    if (!episodes.length) return false;
    const availableList = episodes
      .map(
        (item, index) =>
          `第${index + 1}集（${item.segments.map((segment) => segment.id).join("、")}）`,
      )
      .join("；");
    // 目标集：点名几集就处理几集；未点名时沿用「唯一集直接用 / 唯一包含该片段的集」推断。
    const targets: Array<{ index: number; episode: (typeof episodes)[number] }> = [];
    if (intent.episodes.length) {
      for (const episodeNumber of intent.episodes) {
        const target = episodes[episodeNumber - 1];
        // 命中集号但项目没有该集：单独提示并列出可用的集与分段编号，继续处理其余点名的集。
        if (!target) {
          appendConversationMessage(projectId, conversationId, {
            role: "assistant",
            content: t.restyle_rerun_episode_not_found
              .replace("{episode}", String(episodeNumber))
              .replace("{list}", availableList),
          });
          continue;
        }
        targets.push({ index: episodeNumber - 1, episode: target });
      }
    } else {
      let target: (typeof episodes)[number] | undefined;
      if (episodes.length === 1) {
        target = episodes[0];
      } else if (intent.segmentId) {
        const candidates = episodes.filter((item) =>
          item.segments.some((segment) => segment.id === intent.segmentId),
        );
        if (candidates.length === 1) target = candidates[0];
      }
      if (!target) {
        appendConversationMessage(projectId, conversationId, {
          role: "assistant",
          content: t.restyle_rerun_which_episode
            .replace("{segment}", intent.segmentId ? `的 ${intent.segmentId}` : "")
            .replace("{list}", availableList),
        });
        return true;
      }
      targets.push({ index: episodes.indexOf(target), episode: target });
    }
    for (const { index, episode: target } of targets) {
      const episodeLabel = `第${index + 1}集`;
      // 未点名片段：整集重跑。
      if (!intent.segments.length) {
        appendConversationMessage(projectId, conversationId, {
          role: "assistant",
          content: t.restyle_rerun_episode_submitted.replace("{episode}", episodeLabel),
        });
        generateRenderedVideos(projectId, conversationId, {
          episode: target.episode,
          feedback: intent.feedback,
        });
        continue;
      }
      // 逐片段校验：该集不存在的分段单独提示；全部合法片段一次性提交——
      // 首个立即开跑，其余进返工待办队列（见 generateRenderedVideos 的排队逻辑）。
      const validSegments: string[] = [];
      for (const segmentId of intent.segments) {
        if (target.segments.some((segment) => segment.id === segmentId)) {
          validSegments.push(segmentId);
        } else {
          appendConversationMessage(projectId, conversationId, {
            role: "assistant",
            content: t.restyle_rerun_segment_not_found
              .replace("{segment}", segmentId)
              .replace("{list}", availableList),
          });
        }
      }
      if (!validSegments.length) continue;
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: `已提交 ${episodeLabel} ${validSegments.join("、")} 局部返工，将按队列逐个重跑。`,
      });
      for (const segmentId of validSegments) {
        generateRenderedVideos(projectId, conversationId, {
          episode: target.episode,
          segmentId,
          feedback: intent.feedback,
        });
      }
    }
    return true;
  }

  function submitSegmentRerun(segment: RestyleAttachment, feedback: string) {
    if (!activeProject || !activeConversation || !segment.episode || !segment.segmentId) return;
    appendConversationMessage(activeProject.id, activeConversation.id, {
      role: "user",
      content: `${segment.episode} ${segment.segmentId} ${feedback}`,
    });
    appendConversationMessage(activeProject.id, activeConversation.id, {
      role: "assistant",
      content: `已提交 ${segment.episode} ${segment.segmentId} 局部返工，只重跑这一段，不重跑整集。`,
    });
    generateRenderedVideos(activeProject.id, activeConversation.id, {
      episode: segment.episode,
      segmentId: segment.segmentId,
      feedback,
      sourceAttachmentId: segment.sourceAttachmentId,
      rerunOfAttachmentId: segment.id,
    });
  }

  function submitVideoRender(project: RestyleProject, conversationId: string) {
    // 播报也用最新项目与目标项目模型，避免与 generateRenderedVideos 实际下发不一致。
    const latest = projectsRef.current.find((item) => item.id === project.id) ?? project;
    const reportModel =
      latest.videoModel ??
      (latest.id === activeProjectId ? selectedVideoModel : defaultRestyleVideoModel);
    updateProject(project.id, (current) => ({ ...current, stage: "render" }));
    appendConversationMessage(project.id, conversationId, {
      role: "assistant",
      content: `已提交 ${latest.planEpisodes?.length || latest.files.filter((file) => file.type.startsWith("video/") && !file.isFolder).length || 1} 集正式视频生成，任务已进入队列。模型：${reportModel}。系统会按分段 1 个 1 个生成，全部完成后再合成为成片并返还验收链接。`,
    });
    generateRenderedVideos(project.id, conversationId);
  }

  function folderIdForDrop(request: RestyleFileDropRequest): string | null {
    if (request.position === "inside" && request.targetNode.kind === "folder") {
      return request.targetNode.id;
    }
    return request.parentNodeId;
  }

  function episodeForAttachment(file: RestyleAttachment): string {
    return file.episode ?? file.id;
  }

  function attachmentBelongsToFolder(file: RestyleAttachment, folderId: string): boolean {
    if (folderId === "source") {
      return !file.generatedKind && !file.analysisFrame && !file.isFolder;
    }
    const sourceEpisode = folderId.match(/^source\/(EP\d+)$/)?.[1];
    if (sourceEpisode) {
      return (
        !file.generatedKind &&
        !file.analysisFrame &&
        !file.isFolder &&
        file.episode === sourceEpisode
      );
    }
    if (folderId === "results/final") return file.generatedKind === "final_video";
    if (folderId === "results/clips") return file.generatedKind === "video_clip";
    if (folderId === "results/assets") {
      return (
        file.generatedKind === "character" ||
        file.generatedKind === "scene" ||
        file.generatedKind === "prop"
      );
    }
    const assetKind = folderId.match(/^results\/assets\/(character|scene|prop)$/)?.[1] as
      | RestyleAttachment["generatedKind"]
      | undefined;
    if (assetKind) return file.generatedKind === assetKind;
    return false;
  }

  function applyDropFolderMetadata(file: RestyleAttachment, folderId: string): RestyleAttachment {
    const sourceEpisode = folderId.match(/^source\/(EP\d+)$/)?.[1];
    if (sourceEpisode) {
      return {
        ...file,
        generatedKind: undefined,
        analysisFrame: undefined,
        analysisEpisode: undefined,
        episode: sourceEpisode,
      };
    }
    if (folderId === "source") {
      return {
        ...file,
        generatedKind: undefined,
        analysisFrame: undefined,
        analysisEpisode: undefined,
        episode: episodeForAttachment(file),
      };
    }
    if (folderId === "results/final") {
      return { ...file, generatedKind: "final_video", episode: episodeForAttachment(file) };
    }
    if (folderId === "results/clips") {
      return {
        ...file,
        generatedKind: "video_clip",
        episode: episodeForAttachment(file),
        segmentId: file.segmentId ?? "U01",
      };
    }
    const assetKind = folderId.match(/^results\/assets\/(character|scene|prop)$/)?.[1] as
      | "character"
      | "scene"
      | "prop"
      | undefined;
    if (assetKind) return { ...file, generatedKind: assetKind };
    return file;
  }

  function canDropProjectFile(request: RestyleFileDropRequest): boolean {
    const folderId = folderIdForDrop(request);
    if (!folderId) return false;
    return (
      folderId === "source" ||
      /^source\/EP\d+$/.test(folderId) ||
      folderId === "results/final" ||
      folderId === "results/clips" ||
      folderId === "results/assets" ||
      /^results\/assets\/(character|scene|prop)$/.test(folderId)
    );
  }

  function moveProjectFile(request: RestyleFileDropRequest) {
    if (!activeProject || !draggedFileId || !canDropProjectFile(request)) return;
    const folderId = folderIdForDrop(request);
    if (!folderId) return;
    updateProject(activeProject.id, (project) => {
      const moving = project.files.find((file) => file.id === draggedFileId);
      if (!moving) return project;
      if (
        request.targetNode.preview?.kind === "attachment" &&
        request.targetNode.preview.attachment.id === moving.id
      ) {
        return project;
      }
      const moved = applyDropFolderMetadata(moving, folderId);
      const files = project.files.filter((file) => file.id !== moving.id);
      const targetFileId =
        request.targetNode.preview?.kind === "attachment"
          ? request.targetNode.preview.attachment.id
          : null;
      let insertIndex = files.length;
      if (targetFileId && request.position !== "inside") {
        const targetIndex = files.findIndex((file) => file.id === targetFileId);
        if (targetIndex >= 0)
          insertIndex = request.position === "before" ? targetIndex : targetIndex + 1;
      } else {
        const lastInFolderIndex = files.reduce(
          (lastIndex, file, index) =>
            attachmentBelongsToFolder(file, folderId) ? index : lastIndex,
          -1,
        );
        insertIndex = lastInFolderIndex >= 0 ? lastInFolderIndex + 1 : files.length;
      }
      files.splice(insertIndex, 0, moved);
      return { ...project, files };
    });
    setDraggedFileId(null);
    setFileDropTarget(null);
  }

  function insertMention(item: MentionableAttachment) {
    setChatDraft((current) => current.replace(/(^|\s)@[a-zA-Z0-9_]*$/, `$1${item.alias} `));
    setDraftAttachmentIds((current) =>
      current.includes(item.attachment.id) ? current : [...current, item.attachment.id],
    );
  }

  /** 外部文件拖入（dataTransfer 含 Files）；文件树内部排序拖拽只有 text/plain，直接跳过。 */
  function isExternalFileDrag(event: ReactDragEvent): boolean {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleWorkspaceDragOver(event: ReactDragEvent) {
    if (!isExternalFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsFileDragActive(true);
  }

  function handleWorkspaceDragLeave(event: ReactDragEvent) {
    if (!isExternalFileDrag(event)) return;
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setIsFileDragActive(false);
  }

  function handleWorkspaceDrop(event: ReactDragEvent) {
    if (!isExternalFileDrag(event)) return;
    event.preventDefault();
    setIsFileDragActive(false);
    const dropped = Array.from(event.dataTransfer.files);
    const accepted = dropped.filter((file) => /^(image|video)\//.test(file.type));
    if (accepted.length < dropped.length) toast.error(t.restyle_drop_unsupported_type);
    if (accepted.length) attachFiles(accepted);
  }

  function getRequestedAssetKinds(message: string): Array<"character" | "scene" | "prop"> {
    const kinds: Array<"character" | "scene" | "prop"> = [];
    if (/角色|人物|人像/.test(message)) kinds.push("character");
    if (/场景|环境|背景/.test(message)) kinds.push("scene");
    if (/道具|物件/.test(message)) kinds.push("prop");
    return kinds;
  }

  function handleAgentFileCommand(
    project: RestyleProject,
    conversationId: string,
    message: string,
  ): boolean {
    const normalized = message.trim();
    const file = project.files.find(
      (item) => normalized.includes(item.name) || normalized.includes(item.id),
    );
    const target = normalized.match(
      /EP\d+|原片|原片分析|转绘方案|结果|资产|角色|场景|道具|成片|视频片段/i,
    )?.[0];
    const targetFolder = target
      ? target.match(/^EP\d+$/i)
        ? `source/${target.toUpperCase()}`
        : target.includes("原片分析")
          ? "analysis"
          : target.includes("转绘方案")
            ? "plan"
            : target.includes("结果")
              ? "results"
              : target.includes("成片")
                ? "results/final"
                : target.includes("视频片段")
                  ? "results/clips"
                  : target.includes("资产")
                    ? "results/assets"
                    : target.includes("角色")
                      ? "results/assets/character"
                      : target.includes("场景")
                        ? "results/assets/scene"
                        : target.includes("道具")
                          ? "results/assets/prop"
                          : "source"
      : null;
    if (/打开|查看|定位|跳转/.test(normalized) && targetFolder) {
      expandFileTreePath(targetFolder);
      if (targetFolder.startsWith("source/EP")) expandFileTreePath("source");
      if (targetFolder === "plan") expandFileTreePath("plan");
      appendConversationMessage(project.id, conversationId, {
        role: "assistant",
        content: `已打开项目文件中的 ${target ?? "目标文件夹"}。`,
      });
      return true;
    }
    if (/删除|移除/.test(normalized) && file) {
      removeFile(file.id);
      appendConversationMessage(project.id, conversationId, {
        role: "assistant",
        content: `已删除文件：${file.name}。`,
      });
      return true;
    }
    const renameMatch = normalized.match(/(?:重命名|改名)\s*(.+?)\s*(?:为|成)\s*(.+)$/);
    if (renameMatch) {
      const source = project.files.find(
        (item) => item.name === renameMatch[1].trim() || normalized.includes(item.name),
      );
      const nextName = renameMatch[2].trim().replace(/[。！!]+$/, "");
      if (source && nextName) {
        updateProject(project.id, (current) => ({
          ...current,
          files: current.files.map((item) =>
            item.id === source.id ? { ...item, name: nextName } : item,
          ),
        }));
        appendConversationMessage(project.id, conversationId, {
          role: "assistant",
          content: `已将 ${source.name} 重命名为 ${nextName}。`,
        });
        return true;
      }
    }
    if (/移动|移到|放到|归档/.test(normalized) && file && targetFolder) {
      const moved = applyDropFolderMetadata(file, targetFolder);
      updateProject(project.id, (current) => ({
        ...current,
        files: current.files.map((item) => (item.id === file.id ? moved : item)),
      }));
      expandFileTreePath(targetFolder);
      appendConversationMessage(project.id, conversationId, {
        role: "assistant",
        content: `已将 ${file.name} 移动到 ${target ?? targetFolder}。`,
      });
      return true;
    }
    return false;
  }

  /**
   * 首轮分析与「重新分析原片」共用的分析主体：抽帧 → 台词转写 → 资产表/关系表重建 → skill 自检。
   * keepAssets=true（「补充分析 / 漏了 X」）时继续传 existingAssets 增量补全；
   * 用户明说「重新提取 / 重跑」时传空数组全量重建。
   * 素材三级回退：fileObjectsRef 命中 → ensureReferenceVideoUrl 持久 URL 回源重建 File →
   * 复用首轮 analysisFrame 附件 url 与 project.transcript；三级都没有才报错要求重新上传。
   */
  async function runSourceAnalysis(
    projectId: string,
    conversationId: string,
    instruction: string,
    options: { keepAssets: boolean; sourceFiles?: RestyleAttachment[] },
  ): Promise<boolean> {
    const snapshot = projectsRef.current.find((item) => item.id === projectId);
    if (!snapshot) return false;
    // 只分析原始上传：渲染产物（video_clip / final_video）也是 video/*，必须排除。
    const projectVideoFiles = snapshot.files.filter(isSourceVideoFile);
    const sourceFiles = options.sourceFiles?.length ? options.sourceFiles : projectVideoFiles;
    if (!sourceFiles.length) return false;
    const isRerun = snapshot.extractedAssets.length > 0;

    updateProject(projectId, (project) => ({ ...project, stage: "analysis" }));
    beginRun(projectId, t.restyle_run_step_read_source);
    setAnalysisError("");
    let analysisCompleted = false;
    // 每次用户触发的分析 run 一个 runId，拼进扣费幂等键——跨 run 复用同一键会
    // 被 RPC 幂等去重成「重分析永远零扣费」（账目看不出执行）；同一 run 内的
    // 重试/断连重发仍按同键去重（防重复扣费语义不变）。
    const analysisRunId = Date.now().toString(36);
    try {
      // 内存映射未命中（页面刷新后）时，先取回持久 URL 上的原片重建 File 再抽帧。
      if (sourceFiles.some((file) => !fileObjectsRef.current[file.id])) {
        markRunStep(projectId, t.restyle_run_step_fetch_source);
      }
      // 单元化分析管线（v2 内核）：逐集 prepareEpisodeMedia（120s 切片、每单元 4 帧、
      // 单元音频，全部上传 workspace-media 得 URL），再逐单元循环调
      // analyzeRestyleSourceUnits（每请求 1 单元，避开平台约 100s 无字节断连）。
      // 任一集失败回退旧「8 帧 + STT」快速分析路径，并在对话中标注降级。
      const pipelineAnalyses: Array<{
        file: RestyleAttachment;
        unitResults: RestyleSourceUnitsFileResult[];
        frameUrls: string[];
        durationSec: number;
      }> = [];
      const fallbackFiles: RestyleAttachment[] = [];
      for (const file of sourceFiles) {
        const episode = file.episode ?? file.id;
        const resolved = await resolveSourceVideoFile(file, fileObjectsRef.current, (target) =>
          ensureReferenceVideoUrl(projectId, target),
        );
        if (!resolved.ok) {
          fallbackFiles.push(file);
          continue;
        }
        try {
          // 帧图/单元音频上传包指数退避重试（网络错误/5xx 才重试，4xx 不重试）；
          // 视频二进制直传不经 upload 依赖，整调用级对可重试错误再退避重试一次，
          // 都不成功才整集降级旧 8 帧路径。
          const prepareOptions = {
            episodeId: episode,
            upload: withUploadRetry((input) => callUploadLocalMedia({ data: input })),
            createUploadUrl: (input: { id: string; kind: "video" | "audio"; ext: string }) =>
              callCreateMediaUploadUrl({ data: input }),
            signReadUrl: (input: { path: string }) => callSignMediaReadUrl({ data: input }),
            onProgress: (event: UnitProgressEvent) =>
              markRunStep(
                projectId,
                `${t.restyle_run_step_read_source}${event.unitIndex >= 0 ? ` 单元 ${event.unitIndex + 1}` : ""}${event.detail ? `：${event.detail}` : ""}`,
              ),
          };
          let prepared: Awaited<ReturnType<typeof prepareEpisodeMedia>>;
          try {
            prepared = await prepareEpisodeMedia(resolved.file, prepareOptions);
          } catch (firstError) {
            const message = firstError instanceof Error ? firstError.message : String(firstError);
            if (!isRetryableUploadError(message)) throw firstError;
            markRunStep(projectId, `${t.restyle_run_step_read_source}：网络错误，退避重试`);
            prepared = await prepareEpisodeMedia(resolved.file, prepareOptions);
          }
          // 源视频持久 URL + 对象 key 写回（D5）：单元管线内部已把原片直传
          // workspace-media 并签发读地址，立即写回附件 url 与 storageKey
          // （key 永不过期，7 天签名过期后读取时现签）；刷新后三级回退
          // （内存 File → 持久 URL/对象 key → 缓存帧）才能走到第二级。
          if (
            file.url !== prepared.videoUrl ||
            (prepared.videoKey && file.storageKey !== prepared.videoKey)
          ) {
            updateProject(projectId, (project) => ({
              ...project,
              files: project.files.map((item) =>
                item.id === file.id
                  ? {
                      ...item,
                      url: prepared.videoUrl,
                      ...(prepared.videoKey ? { storageKey: prepared.videoKey } : {}),
                    }
                  : item,
              ),
            }));
          }
          // 逐单元分析：幂等键按项目+集派生（服务端再拼 unitId 到单元粒度），
          // 同一单元重复成功调用不重复扣费；单单元失败记 warning 继续后续单元
          // （部分失败用成功单元继续）。
          // 2026-08 提速：串行循环改并发池（每请求仍是 1 单元，守住平台 ~100s
          // 无字节断连约束；只把浏览器侧并发上调到 3）。进度按完成数播报。
          let completedUnits = 0;
          const unitOutcomes = await runWithConcurrency(
            prepared.units,
            3,
            async (unit): Promise<{ unitId: string; fileResult?: RestyleSourceUnitsFileResult; error?: string }> => {
              if (isRunAborted(projectId)) return { unitId: unit.unitId, error: "已中止" };
              try {
                const unitResult = await callAnalyzeRestyleSourceUnits({
                  data: {
                    sourceFiles: [{ id: episode, name: file.name, units: [unit] }],
                    idempotencyKey: `${projectId}:${episode}:${analysisRunId}`,
                    // 项目维度（后台按项目名查明细）
                    projectName: snapshot.title,
                  },
                });
                const fileResult = unitResult.ok ? unitResult.files[0] : undefined;
                if (fileResult && fileResult.unitsSucceeded > 0) {
                  return { unitId: unit.unitId, fileResult };
                }
                return {
                  unitId: unit.unitId,
                  error: unitResult.ok ? "分析失败。" : `分析请求失败：${unitResult.error}`,
                };
              } catch (error) {
                // serverFn 调用本身的网络异常也收敛为单单元失败,不拖死整集
                return {
                  unitId: unit.unitId,
                  error: `分析请求异常：${error instanceof Error ? error.message : "网络错误"}`,
                };
              } finally {
                completedUnits += 1;
                markRunStep(
                  projectId,
                  `${t.restyle_run_step_analyze} 单元 ${completedUnits}/${prepared.units.length}`,
                );
              }
            },
          );
          if (isRunAborted(projectId)) return false;
          const unitResults: RestyleSourceUnitsFileResult[] = unitOutcomes.map((outcome, index) =>
            outcome.fileResult
              ? outcome.fileResult
              : {
                  sourceId: episode,
                  sourceName: file.name,
                  shotSchedule: [],
                  transcript: "",
                  evidencePackage: "",
                  warnings: [`单元 ${outcome.unitId} ${outcome.error ?? "分析失败。"}`],
                  unitsTotal: 1,
                  unitsSucceeded: 0,
                  unitsFailed: 1,
                  failedUnitIds: [prepared.units[index].unitId],
                },
          );
          if (!unitResults.some((result) => result.unitsSucceeded > 0)) {
            throw new Error("全部单元分析失败");
          }
          pipelineAnalyses.push({
            file,
            unitResults,
            frameUrls: prepared.units.flatMap((unit) => unit.frameUrls),
            durationSec: prepared.durationSec,
          });
        } catch (error) {
          if (isRunAborted(projectId)) return false;
          // 该集整体回退旧 8 帧 + STT 快速分析路径。
          fallbackFiles.push(file);
          appendConversationMessage(projectId, conversationId, {
            role: "assistant",
            content: `${file.name} 单元化分析未完成（${error instanceof Error ? error.message : "未知错误"}），已降级为快速分析，长片覆盖可能不完整。`,
          });
        }
      }
      // 旧快速分析路径（降级）：8 帧抽帧，仅对降级集执行。
      const frameBatches = await Promise.all(
        fallbackFiles.map(async (file) => {
          const resolved = await resolveSourceVideoFile(file, fileObjectsRef.current, (target) =>
            ensureReferenceVideoUrl(projectId, target),
          );
          return {
            file,
            frames: resolved.ok ? await extractVideoKeyFrames(resolved.file).catch(() => []) : [],
          };
        }),
      );
      // Keep chronological coverage for the full upload, including multi-episode uploads.
      let frameImages = frameBatches.flatMap((batch) => batch.frames).slice(0, 8);
      // 原片取不回时退化为复用首轮持久化的关键帧附件。
      let usedCachedFrames = false;
      if (!frameImages.length && isRerun && fallbackFiles.length) {
        const cached = cachedAnalysisFrames(
          snapshot.files,
          fallbackFiles.map((file) => file.episode ?? file.id),
        );
        if (cached.length) {
          frameImages = cached;
          usedCachedFrames = true;
        }
      }
      if (isRunAborted(projectId)) return false;
      // 音频通道（仅降级集）：抽 16k 单声道 WAV 分片走网关 ASR，台词作为分析与方案的
      // 可信证据；新管线的台词已由单元内嵌 ASR 产出，不走这里。
      // 无音轨 / 源片过大 / 网关拒绝 input_audio 时返回空台词并继续，不阻断分析。
      let fallbackTranscript = "";
      if (fallbackFiles.length) {
        const transcriptSource = fileObjectsRef.current[fallbackFiles[0].id];
        if (transcriptSource) {
          markRunStep(projectId, t.restyle_run_step_transcribe);
          const transcript = await transcribeSourceVideo(
            transcriptSource,
            (input) => callTranscribeRestyleAudio(input),
            {
              isAborted: () => isRunAborted(projectId),
              onProgress: (done, total) =>
                markRunStep(projectId, `${t.restyle_run_step_transcribe} ${done}/${total}`),
            },
          );
          fallbackTranscript = transcript.text;
          if (!fallbackTranscript && transcript.degradedReason) {
            appendConversationMessage(projectId, conversationId, {
              role: "assistant",
              content: `原片台词识别未产出结果：${transcript.degradedReason} 分析将只依据画面进行，台词相关设定请人工补充。`,
            });
          }
        }
      }
      // 单元化结果合并：shotNo 跨单元、跨集全局重排；台词直接拼接（集级毫秒时间码）。
      const perFileMerged = pipelineAnalyses.map((analysis) => ({
        file: analysis.file,
        merged: mergeSourceUnitResults(analysis.unitResults),
      }));
      const pipelineShotSchedule = renumberShotSchedule(
        perFileMerged.flatMap(({ merged }) => merged.shotSchedule),
      );
      const pipelineWarnings = perFileMerged.flatMap(({ merged }) => merged.warnings);
      // 混合降级：降级集不在全片逐镜表中（资产模型的 result.shots 无集归属，
      // 无法可靠回补），标注 warning；这些集的分段区间由场景分组推算兜底。
      if (fallbackFiles.length && pipelineShotSchedule.length) {
        pipelineWarnings.push(
          `${fallbackFiles.map((file) => file.name).join("、")} 已降级为快速分析，未纳入全片逐镜表；这些集的分段时间区间将按场景分组推算，长片覆盖可能不完整。`,
        );
      }
      let transcriptText = [
        ...perFileMerged.map(({ merged }) => merged.transcript),
        fallbackTranscript,
      ]
        .filter(Boolean)
        .join("\n");
      // 转写不可用（如基于缓存关键帧重跑）时沿用首轮台词。
      if (!transcriptText) transcriptText = snapshot.transcript ?? "";
      if (isRunAborted(projectId)) return false;
      if (!pipelineAnalyses.length && !frameImages.length && !transcriptText) {
        // 三级都拿不到画面：不静默产出空输入分析，提示重新上传。
        const detail = t.restyle_reanalyze_no_source;
        setAnalysisError(detail);
        finishRun(projectId, "failed", detail);
        appendConversationMessage(projectId, conversationId, {
          role: "assistant",
          content: `${t.restyle_analysis_failed} ${detail}`,
        });
        return false;
      }
      // 资产提炼：有新管线结果走证据包模式（证据包含全片逐镜表与台词）；
      // 降级集的关键帧与 STT 台词仍按旧契约一并传入，服务端兼容混合输入。
      const evidenceParts = perFileMerged
        .filter(({ merged }) => merged.evidencePackage.trim())
        .map(({ file, merged }) => `【${file.name}】\n${merged.evidencePackage}`);
      if (fallbackTranscript && evidenceParts.length) {
        evidenceParts.push(`【降级源视频的台词（快速分析通道）】\n${fallbackTranscript}`);
      }
      // evidencePackage schema 上限 60,000 字符，超长截尾（逐单元包内已各有长度控制）。
      let evidencePackage = evidenceParts.join("\n\n");
      if (evidencePackage.length > 58_000) {
        evidencePackage = `${evidencePackage.slice(0, 58_000)}\n…（证据包过长已截尾）`;
      }
      const pipelineDurationSec =
        pipelineAnalyses.reduce(
          (sum, analysis) => sum + (analysis.durationSec || analysis.file.durationSec || 0),
          0,
        ) || undefined;
      markRunStep(projectId, t.restyle_run_step_analyze, selectedModel);
      const result = await callAnalyzeRestyleAssets({
        data: {
          instruction,
          model: selectedModel,
          sourceFiles: sourceFiles.map((file) => ({
            id: file.episode ?? file.id,
            name: file.name,
            type: file.type,
            size: file.size,
            durationSec: file.durationSec,
          })),
          frameImages,
          transcript: transcriptText,
          ...(evidencePackage ? { evidencePackage, durationSec: pipelineDurationSec } : {}),
          existingAssets: options.keepAssets
            ? snapshot.extractedAssets.map(({ id: _id, ...asset }) => asset)
            : [],
        },
      });
      if (isRunAborted(projectId)) return false;
      if (!result.ok) {
        result.error = relabelRestyleError(result.error, selectedModel);
        setAnalysisError(result.error);
        finishRun(projectId, "failed", result.error);
        appendConversationMessage(projectId, conversationId, {
          role: "assistant",
          content: `${t.restyle_analysis_failed} ${result.error}`,
        });
        return false;
      }
      markRunStep(projectId, t.restyle_run_step_asset_table);
      const extractedAssets: RestyleExtractedAsset[] = result.assets.map((asset) => ({
        id: crypto.randomUUID(),
        ...asset,
      }));
      // analysis 的 relationships 按角色名对齐到资产 id：改名后关系表自动跟随。
      const newCharacterAssets = extractedAssets.filter((asset) => asset.kind === "character");
      const relationEdges: RestyleCharacterRelation[] = (result.relationships ?? []).flatMap(
        (relation) => {
          const match = (name: string) =>
            newCharacterAssets.find(
              (asset) => asset.sourceName === name || asset.targetName === name,
            );
          const from = match(relation.from);
          const to = match(relation.to);
          if (!from || !to || from.id === to.id) return [];
          return [
            {
              id: crypto.randomUUID(),
              from: from.id,
              to: to.id,
              relation: relation.relation,
              note: relation.note,
            },
          ];
        },
      );
      const frameAttachments: RestyleAttachment[] = [
        // 单元化管线的单元帧：已上传 workspace-media，附件存 URL 形式（体积未知记 0）。
        ...pipelineAnalyses.flatMap(({ file, frameUrls }) => {
          const episode = file.episode ?? file.id;
          const videoName = file.name.replace(/\.[^.]+$/, "") || episode;
          return frameUrls.map((url, index) => ({
            id: crypto.randomUUID(),
            name: `${videoName}_frame_${String(index + 1).padStart(2, "0")}.jpg`,
            size: 0,
            type: "image/jpeg",
            lastModified: Date.now(),
            url,
            analysisFrame: true,
            analysisEpisode: episode,
          }));
        }),
        // 降级集的 8 帧：仍是 dataURL（体积按 base64 长度估算）。
        ...frameBatches.flatMap(({ file, frames }) => {
          const episode = file.episode ?? file.id;
          const videoName = file.name.replace(/\.[^.]+$/, "") || episode;
          return frames.map((url, index) => ({
            id: crypto.randomUUID(),
            name: `${videoName}_frame_${String(index + 1).padStart(2, "0")}.jpg`,
            size: Math.round(url.length * 0.75),
            type: "image/jpeg",
            lastModified: Date.now(),
            url,
            analysisFrame: true,
            analysisEpisode: episode,
          }));
        }),
      ];
      updateProject(projectId, (project) => ({
        ...project,
        stage: "assets",
        extractedAssets,
        analysisSummary: result.summary,
        transcript: transcriptText || project.transcript,
        analysisSections: Object.fromEntries(
          sourceFiles.map((file) => [file.episode ?? file.id, result.analysis]),
        ) as Record<string, RestyleAnalysisSections>,
        // 逐镜表随本轮分析重建（重分析/增量分析同路径）：单元化管线产出的全片
        // 逐镜表优先（跨单元/跨集已全局重排），缺失时回落资产模型的 shots。
        shotSchedule: pipelineShotSchedule.length
          ? pipelineShotSchedule
          : result.shots?.length
            ? result.shots
            : undefined,
        // 按集分开的逐镜表（集内相对毫秒）：分窗方案生成与 finalize 覆盖兜底
        // 必须按集传 shots，整表无集归属、跨集借用会污染他集分段边界（D1 回归）。
        shotScheduleByEpisode: perFileMerged.length
          ? Object.fromEntries(
              perFileMerged.map(({ file, merged }) => [
                file.episode ?? file.id,
                merged.shotSchedule,
              ]),
            )
          : undefined,
        confirmedAssetIds: [],
        // 关系表随新一轮资产表重建（角色 id 重新生成，旧边全部失效）。
        characterRelations: relationEdges.length ? relationEdges : undefined,
        // 基于缓存关键帧重跑时没有新帧附件，保留首轮的 analysisFrame 附件。
        files: usedCachedFrames
          ? project.files
          : [...project.files.filter((file) => !file.analysisFrame), ...frameAttachments],
      }));
      // §4.6 计费口径变化与单元化分析 warnings 随确认播报透传（最多列 3 条）。
      const pipelineNotes = [
        perFileMerged.length
          ? // 资产提炼扣分与服务端口径一致：有降级集走帧模式（frameImages 非空）2 分，纯证据包模式 1 分
            `分析计费口径：2 分/单元（含 ASR）+ ${frameImages.length ? 2 : 1} 分资产提炼。`
          : "",
        ...pipelineWarnings.slice(0, 3),
        pipelineWarnings.length > 3 ? `另有 ${pipelineWarnings.length - 3} 条分析提示。` : "",
      ]
        .filter(Boolean)
        .join(" ");
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: `${result.summary}${result.usedFrames ? ` ${t.restyle_frames_analyzed}` : ""}${pipelineNotes ? ` ${pipelineNotes}` : ""}${usedCachedFrames ? ` ${t.restyle_reanalyze_cached_frames}` : ""}${isRerun && snapshot.planEpisodes?.length ? ` ${t.restyle_reanalyze_suggest_replan}` : ""}`,
        assetTable: extractedAssets,
      });
      // 资产表生成后自动跑一次 skill 自检（1 分/次，与旧分析调用同口径）。
      void runAssetTableReview(extractedAssets, relationEdges);
      analysisCompleted = true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : t.restyle_analysis_unknown_error;
      if (isRunAborted(projectId)) return false;
      setAnalysisError(detail);
      finishRun(projectId, "failed", detail);
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: `${t.restyle_analysis_failed} ${detail}`,
      });
    } finally {
      if (!isRunAborted(projectId)) finishRun(projectId);
    }
    // 执行模式联动：资产表产出后，极速 / 自定义（未勾选「目标资产设定」）自动推进下一步；
    // 分步护航维持现状暂停等确认。放在 finally 之后，避免新任务被上一个 run 的收尾标记覆盖。
    if (analysisCompleted && !isRunAborted(projectId)) {
      await autoAdvanceAfterAssetTable(projectId, conversationId);
    }
    return analysisCompleted;
  }

  /**
   * 全局兜底：任何分支未预期的异常都落到失败态并提示，
   * 防止新增分支再次出现「静默卡死」（running 永远清不掉）。
   */
  async function sendChatMessage(overrideMessage?: string) {
    try {
      await sendChatMessageInner(overrideMessage);
    } catch (error) {
      const pid = activeProjectId;
      const detail = error instanceof Error ? error.message : "未知异常";
      if (pid) {
        finishRun(pid, "failed", detail);
        const convId = projectsRef.current.find((item) => item.id === pid)?.activeConversationId;
        if (convId) {
          appendConversationMessage(pid, convId, {
            role: "assistant",
            content: `操作失败：${detail}。可重试或换种说法。`,
          });
        }
      }
      setAnalysisError(detail);
    }
  }

  async function sendChatMessageInner(overrideMessage?: string) {
    if (!activeProject || !activeConversation) return;
    const message = (overrideMessage ?? chatDraft).trim();
    // 发送时解析文本中的 @imageN / @videoN，把被 @ 的素材一并带上（即使不在附件条里）。
    const mentionedAttachmentIds = resolveMentionedAttachmentIds(message, mentionableAttachments);
    const outgoingAttachmentIds = [...new Set([...draftAttachmentIds, ...mentionedAttachmentIds])];
    const attachments = activeProject.files.filter((file) =>
      outgoingAttachmentIds.includes(file.id),
    );
    const referenceAttachments = attachments.filter((file) => file.type.startsWith("image/"));
    const projectVideoFiles = activeProject.files.filter(isSourceVideoFile);
    if (!message && !attachments.length) return;
    const projectId = activeProject.id;
    const conversationId = activeConversation.id;
    // 本次生成任务的入口快照：后续 await 之后只用快照 + updateProject(projectId, ...) 回写，
    // 不再读激活项目的全局画风/模型，切换项目不会串到本次任务。
    let styleBrief = activeProject.styleBrief ?? "";
    const generatedAssetFiles = activeProject.files.filter(
      (file) =>
        (file.generatedKind === "character" ||
          file.generatedKind === "scene" ||
          file.generatedKind === "prop") &&
        file.url,
    );
    // 只要资产表已经存在，任何口语化的“确认 / 继续 / 下一步”都应推进流程，
    // 不再要求资产图片必须已经生成，也不再要求消息全等于“确认”。
    const shouldContinueToPlan = isConfirmIntent(message);
    const analysisInstruction =
      message || "请分析上传的视频，提取真正需要转绘的具体角色、场景和道具。";
    const messageAttachments =
      attachments.length || activeProject.extractedAssets.length ? attachments : projectVideoFiles;
    appendConversationMessage(projectId, conversationId, {
      content: message,
      role: "user",
      attachments: messageAttachments,
    });
    setChatDraft("");
    setDraftAttachmentIds([]);

    // 同一项目内串行；不同项目各自独立，可并发执行。忙时不吞消息：
    // 用户消息已照常上屏并持久化——片段返工走既有排队机制（pendingRerunsRef，
    // 队列收尾自动开跑）；非返工消息明确回复当前执行步骤。
    if (isProjectRunning(projectId)) {
      const action = busyMessageAction(
        message,
        [...(projectRuns[projectId]?.steps ?? [])]
          .reverse()
          .find((step) => step.status === "running")?.label,
      );
      if (action.kind === "queue_rerun") {
        // 能进排队机制就排队（含集/段不存在的引导提示）；无法处理时退化为忙态回复，不静默。
        if (handleSegmentRerunIntent(projectId, conversationId, action.intent)) return;
        appendConversationMessage(projectId, conversationId, {
          role: "assistant",
          content: "正在执行：当前任务。可点击「停止」后重发，或等本步完成后再继续。",
        });
        return;
      }
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: action.content,
      });
      return;
    }
    // 记住用户描述的目标画风：首轮转绘要求自动沿用，之后再次提到画风则覆盖。
    if (message && (!styleBrief || looksLikeStyleBrief(message))) {
      if (looksLikeStyleBrief(message) || !activeProject.extractedAssets.length) {
        styleBrief = message;
        updateProject(projectId, (project) => ({ ...project, styleBrief: message }));
      }
    }

    if (handleAgentFileCommand(activeProject, conversationId, message)) return;

    if (isVideoRenderIntent(message)) {
      submitVideoRender(activeProject, conversationId);
      return;
    }

    // ===== 具体意图优先，泛化确认兜底（顺序即优先级；裸「继续/下一步」
    // 点名具体对象时已被确认意图排除，会落到对应的具体分支） =====
    if (isVideoRenderIntent(message)) {
      submitVideoRender(activeProject, conversationId);
      return;
    }

    // 「重新生成第一集01片段」这类按集/按片段的局部返工：必须排在方案微调
    // 分支（/U\d+|提示词|…/）与重分析/生图纠错分支之前——点名 U02 会命中
    // 方案微调分支的 U\d+ 正则而触发全量方案重生成（D4 回归），「重跑」会
    // 命中 isReanalyzeIntent，「重新生成」在已有资产图时会被 isCorrection
    // 当成整表重画。命中即等价右侧「返工」，只重跑目标片段；点名的集/段
    // 不存在时由 handleSegmentRerunIntent 给出提示，同样不落全量重生成。
    const segmentRerunIntent = parseSegmentRerunIntent(message);
    if (
      segmentRerunIntent &&
      handleSegmentRerunIntent(projectId, conversationId, segmentRerunIntent)
    ) {
      return;
    }

    // 资产表已产出后的「重做」入口：重新分析原片 / 整套重做方案。
    // 必须排在生图纠错分支之前，否则「资产表不对，重新分析」会被 isRegenerateIntent
    // 当成资产图片重生成而走错分支。
    if (activeProject.extractedAssets.length > 0 && isReanalyzeIntent(message)) {
      // 「补充分析 / 漏了 X」增量补全（传 existingAssets）；明说「重新 / 重跑」则全量重建。
      const keepAssets =
        /(补充|漏了|遗漏|少了|缺少)/.test(message) && !/重新|重跑|全量|全部/.test(message);
      // 用户的原话就是最高优先级证据，直接作为分析 instruction。
      await runSourceAnalysis(projectId, conversationId, message || analysisInstruction, {
        keepAssets,
      });
      return;
    }

    if (activeProject.extractedAssets.length > 0 && isReplanIntent(message)) {
      await runPlanGeneration(projectId, conversationId, styleBrief);
      return;
    }

    const requestedAssetKinds = getRequestedAssetKinds(message);
    // 方案微调（plan 阶段 U01/提示词/光影…且未点名图片对象）优先于生图纠错——
    // 「调整 U01 光影」含「调整」会被 isRegenerateIntent 误判成生图纠错；
    // 点名了图片对象（「把 U01 的图片重新生成」）仍走生图分支。
    const isPlanTweak =
      activeProject.stage === "plan" &&
      /U\d+|提示词|光影|镜头|台词|节奏/.test(message) &&
      !/(资产图|生图|图片)/.test(message);
    // 纠错语句（“场景图片生成不对，请重新生成”）也要进入生图分支，
    // 否则只会得到一句“已理解…”，用户看到的就是“指正无效”。
    const isCorrection =
      !isPlanTweak && generatedAssetFiles.length > 0 && isRegenerateIntent(message);
    // 资产生图意图（含「继续生成资产图片」——裸继续已被确认意图排除到这里）。
    const isAssetImageRequest =
      activeProject.extractedAssets.length > 0 &&
      !isPlanTweak &&
      (isAssetImageIntent(message) ||
        /全部由\s*AI\s*生成|生成(?:全部|这些|资产)?(?:图片|图)|生图/i.test(message) ||
        (requestedAssetKinds.length > 0 && /生成|图片|图/.test(message)) ||
        isCorrection ||
        (generatedAssetFiles.length > 0 && /修改|调整|请将|变得|改成|换成/i.test(message)));
    if (isAssetImageRequest) {
      // @imageN 现在按项目内图片统一编号，按解析出的附件 id 过滤参考图。
      const mentionedImageIds = mentionedAttachmentIds;
      const uploadedReferenceImages = (
        await Promise.all(
          referenceAttachments
            .filter((file) => !mentionedImageIds.length || mentionedImageIds.includes(file.id))
            .map((file) => {
              const local = fileObjectsRef.current[file.id];
              return local ? fileToDataUrl(local) : Promise.resolve(file.url ?? "");
            }),
        )
      ).filter(Boolean);
      const generatedReferenceImages = generatedAssetFiles
        .filter((file) =>
          activeProject.extractedAssets.some(
            (asset) => message.includes(asset.targetName) && file.name.includes(asset.targetName),
          ),
        )
        .map((file) => file.url as string);
      const referenceImages = uploadedReferenceImages.length
        ? uploadedReferenceImages
        : generatedReferenceImages;
      // 指名了资产名时只重生成该资产；其次按类型（角色/场景/道具）过滤；
      // 都没提到才整表补齐，避免一句“场景不对”把角色和道具也重画一遍。
      const namedAssets = activeProject.extractedAssets.filter(
        (asset) =>
          (asset.targetName && message.includes(asset.targetName)) ||
          (asset.sourceName && message.includes(asset.sourceName)),
      );
      const requestedAssets = namedAssets.length
        ? namedAssets
        : requestedAssetKinds.length
          ? activeProject.extractedAssets.filter((asset) =>
              requestedAssetKinds.includes(asset.kind),
            )
          : activeProject.extractedAssets;
      if (!requestedAssets.length) {
        appendConversationMessage(projectId, conversationId, {
          role: "assistant",
          content: "当前资产表中没有匹配的角色、场景或道具，暂不生成图片。",
        });
        return;
      }
      await generateAssetImages(
        projectId,
        conversationId,
        message,
        requestedAssets,
        referenceImages,
        styleBrief,
      );
      return;
    }

    if (activeProject.stage === "plan" && /U\d+|提示词|光影|镜头|台词|节奏/.test(message)) {
      beginRun(projectId, t.restyle_run_step_prompt_update);
      // 同 runPlanGeneration：只取原始上传源片，排除渲染产物（窗数虚高回归）。
      const sourceFiles = activeProject.files.filter(isSourceVideoFile);
      // 分窗/单次统一入口：长片逐窗循环（每窗一个请求），短片单次调用。
      const result = await requestPlanEpisodes({
        projectId,
        project: activeProject,
        sourceFiles,
        instruction: withTranscript(
          withRelationBrief(withStyleBrief(message, styleBrief)),
          activeProject.transcript,
        ),
        episodeCount: activeProject.planEpisodes?.length || sourceFiles.length || 1,
        existingEpisodes: activeProject.planEpisodes ?? [],
      });
      if (result.ok) {
        const updatedVideoNames = result.episodes.map((episode) =>
          sourceVideoLabel(episode.episode),
        );
        // 覆盖兜底提示：ensureFullCoverage 自动补段的区间数随方案播报透出。
        const rerunFillCount = result.warnings.filter((warning) =>
          warning.includes("已自动补齐未覆盖区间"),
        ).length;
        const rerunCoverageNote = rerunFillCount
          ? `已自动补齐 ${rerunFillCount} 个未覆盖区间。`
          : "";
        updateProject(projectId, (project) => ({
          ...project,
          planEpisodes: result.episodes,
          stage: "plan",
        }));
        appendConversationMessage(projectId, conversationId, {
          role: "assistant",
          content: `已根据你的要求更新方案：${result.episodes.map((episode, index) => `${updatedVideoNames[index] ?? episode.episode}（${episode.segments.length} 段）`).join("、")}。${rerunCoverageNote}请点击对话中的视频文件名检查右侧提示词。`,
          episodeLinks: result.episodes.map((episode) => episode.episode),
        });
      } else {
        appendConversationMessage(projectId, conversationId, {
          role: "assistant",
          content: `提示词修改失败：${result.error}`,
        });
      }
      finishRun(projectId, result.ok ? "done" : "failed");
      return;
    }

    // 泛化确认（推进下一步）：方案阶段的「确认/继续」等价确认生成视频；
    // 没有资产图先补图；其余进入方案生成。
    if (
      shouldContinueToPlan &&
      activeProject.stage === "plan" &&
      activeProject.planEpisodes?.length
    ) {
      submitVideoRender(activeProject, conversationId);
      return;
    }

    // 资产表已就绪但还没有任何资产图：先补生成资产图，再让用户确认进入方案。
    if (
      shouldContinueToPlan &&
      activeProject.extractedAssets.length > 0 &&
      generatedAssetFiles.length === 0
    ) {
      await generateAssetImages(
        projectId,
        conversationId,
        message || "按资产表生成全部资产图",
        activeProject.extractedAssets,
        [],
        styleBrief,
      );
      return;
    }

    if (shouldContinueToPlan && activeProject.extractedAssets.length > 0) {
      await runPlanGeneration(projectId, conversationId, styleBrief);
      return;
    }

    // Once a project has been analysed, ordinary conversation must not restart
    // analysis or blindly ask for the same asset confirmation. Keep the user's
    // intent in context and tell them the next concrete operation we can perform.
    if (activeProject.extractedAssets.length > 0) {
      const stageHint =
        activeProject.stage === "plan"
          ? "我会保留当前方案；请指出集数、分段或要调整的提示词，我会只更新对应部分。也可以回复“重新分析原片”重跑资产提取，或“重做方案”整套重出方案。"
          : generatedAssetFiles.length
            ? "转绘资产已经就绪。下一步可回复：“继续下一步”生成转绘方案，或“确认生成视频”开始出片；资产表有问题可回复“重新分析原片”，方案要整套重出可回复“重做方案”。"
            : "资产表已就绪但还没有资产图。下一步可回复：“生成资产图片”按资产表逐张生成，或指定某个角色/场景/道具单独生成；资产表有问题可回复“重新分析原片”。";
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: `已理解：${message || "继续当前转绘任务"}。${stageHint}`,
      });
      return;
    }

    const selectedVideoFiles = attachments.filter(isSourceVideoFile);
    const sourceFiles = selectedVideoFiles.length ? selectedVideoFiles : projectVideoFiles;
    if (!sourceFiles.length) return;

    // 首轮分析与重跑共用同一条链路（含台词转写、skill 自检、关系表重建）。
    await runSourceAnalysis(projectId, conversationId, analysisInstruction, {
      keepAssets: false,
      sourceFiles,
    });
  }

  async function generateAssetImages(
    projectId: string,
    conversationId: string,
    instruction: string,
    extractedAssets: RestyleExtractedAsset[],
    referenceImages: string[] = [],
    // 发起时快照的目标画风与图片模型：逐张生成的 await 循环里只用快照，
    // 中途切换项目不会把别的项目的画风/模型带进本次任务。
    styleBrief: string,
    imageModel: string = selectedImageModel,
  ) {
    beginRun(projectId, t.restyle_run_step_asset_images);
    setAnalysisError("");
    setAssetRunStatus({});
    appendConversationMessage(projectId, conversationId, {
      role: "assistant",
      content: "开始生成资产图片，将按角色、场景、道具逐张处理。",
    });
    const generatedKinds: Array<"character" | "scene" | "prop"> = [];
    let budgetStopped = false;
    let advanceToPlan = false;
    try {
      // 渠道自动降级：当前生图模型配额/余额类失败时，按上架模型列表顺序换渠道
      // 重试；切换成功后续资产沿用新渠道，死渠道记入 deadImageModels 不再重试。
      const availableImageModelIds = listedImageModels.map((model) => model.id);
      let activeImageModel = imageModel;
      const deadImageModels = new Set<string>();
      let assetIndex = 0;
      for (const asset of extractedAssets) {
        if (isRunAborted(projectId)) return;
        // 预算校验：任何模式下累计消耗达上限即强制暂停（极速/自定义同样生效）。
        if (budgetExceeded(projectId, imageJobCost(activeImageModel))) {
          budgetStopped = true;
          pauseForBudget(projectId, conversationId);
          break;
        }
        assetIndex += 1;
        markRunStep(
          projectId,
          `${t.restyle_run_step_asset_image_one}${asset.targetName || asset.sourceName}`,
          `${assetIndex}/${extractedAssets.length}`,
        );
        setAssetRunStatus((current) => ({ ...current, [asset.id]: { status: "running" } }));
        // 面板里手工覆盖过提示词时直接用覆盖内容，否则按目标画风自动拼装。
        // 角色资产附带人物关系约束，同框/互动不跑偏。
        const relationBrief = buildRelationBrief(
          relationBriefsRef.current,
          asset.targetName || asset.sourceName,
        );
        const prompt = resolveAssetImagePrompt(asset, styleBrief, instruction, relationBrief);
        // 配额/余额/权限类失败按可用模型列表顺序自动换渠道重试该资产；
        // 内容审核类失败不换渠道（各渠道审核口径趋同，换了也是同样失败）。
        const tryGenerate = (model: string) =>
          referenceImages.length
            ? callGenerateImageWithReferences({
                data: { prompt, model, size: "2K", referenceImages },
              })
            : callGenerateImage({ data: { prompt, model, size: "2K" } });
        // 网络/网关瞬时失败（含 serverFn 调用本身抛 Failed to fetch）同渠道
        // 退避重试 2 次；仍失败归一为失败结果，由下方只标记该资产、继续后续
        // 资产——单资产网络故障不得拖死整个出图阶段（2026-08-14 线上事故：
        // 裸 await 抛 Failed to fetch 直接跳出循环，整阶段停摆）。
        type GenerateOutcome = Awaited<ReturnType<typeof tryGenerate>>;
        const tryGenerateResilient = async (model: string): Promise<GenerateOutcome> => {
          let lastError = "未知错误";
          for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
              const outcome = await tryGenerate(model);
              if (outcome.url || !isTransientNetworkImageError(outcome.error)) return outcome;
              lastError = outcome.error || lastError;
            } catch (error) {
              lastError = error instanceof Error ? error.message : "网络错误";
              // 非网络类异常重试无意义，直接判该资产失败
              if (!isTransientNetworkImageError(lastError)) break;
            }
            if (attempt < 3) {
              await new Promise<void>((resolve) => window.setTimeout(resolve, attempt * 2_000));
            }
          }
          return { url: "", error: lastError } as GenerateOutcome;
        };
        let result = await tryGenerateResilient(activeImageModel);
        while (!result.url && isQuotaLikeImageError(result.error)) {
          deadImageModels.add(activeImageModel);
          const [nextModel] = imageModelFallbackCandidates(
            activeImageModel,
            availableImageModelIds,
            deadImageModels,
          );
          if (!nextModel) break;
          appendConversationMessage(projectId, conversationId, {
            role: "assistant",
            content: `生图渠道 ${activeImageModel} 不可用（${(result.error || "配额/权限错误").slice(0, 80)}），已切换到 ${nextModel} 重试。`,
          });
          activeImageModel = nextModel;
          result = await tryGenerateResilient(activeImageModel);
        }
        if (!result.url) {
          setAssetRunStatus((current) => ({
            ...current,
            [asset.id]: { status: "failed", error: result.error || "请稍后重试。" },
          }));
          appendConversationMessage(projectId, conversationId, {
            role: "assistant",
            content: `资产图片生成失败：${asset.targetName || asset.sourceName}。${result.error || "请稍后重试。"}`,
          });
          continue;
        }
        let durableUrl = result.url;
        try {
          const persisted = await callPersistAssetImage({
            data: {
              url: result.url,
              userId: user?.id ?? "",
              kind: asset.kind,
              id: `restyle-${projectId}-${asset.id}`,
            },
          });
          if (!persisted.ok || !persisted.url) {
            setAssetRunStatus((current) => ({
              ...current,
              [asset.id]: { status: "failed", error: "保存到长期存储失败" },
            }));
            appendConversationMessage(projectId, conversationId, {
              role: "assistant",
              content: `资产图片已生成，但保存到长期存储失败：${asset.targetName || asset.sourceName}。请重试后再继续转绘。`,
            });
            continue;
          }
          durableUrl = persisted.url;
        } catch (error) {
          setAssetRunStatus((current) => ({
            ...current,
            [asset.id]: {
              status: "failed",
              error: error instanceof Error ? error.message : "未知错误",
            },
          }));
          appendConversationMessage(projectId, conversationId, {
            role: "assistant",
            content: `资产图片已生成，但保存到长期存储失败：${error instanceof Error ? error.message : "未知错误"}。`,
          });
          continue;
        }
        const attachment: RestyleAttachment = {
          id: crypto.randomUUID(),
          name: `${asset.kind}_${(asset.targetName || asset.sourceName).replace(/[^\w\u4e00-\u9fff-]+/g, "_")}.png`,
          size: 0,
          type: "image/png",
          lastModified: Date.now(),
          url: durableUrl,
          generatedKind: asset.kind,
          sourceAssetId: asset.id,
          prompt,
        };
        updateProject(projectId, (project) => ({
          ...project,
          // Regeneration replaces the prior rendition of the same restyle asset.
          // This gives every asset one stable canvas position instead of piling up variants.
          files: [
            ...project.files.filter(
              (file) => !(file.generatedKind === asset.kind && file.sourceAssetId === asset.id),
            ),
            attachment,
          ],
        }));
        generatedKinds.push(asset.kind);
        chargeSpend(projectId, imageJobCost(activeImageModel));
        setAssetRunStatus((current) => ({ ...current, [asset.id]: { status: "done" } }));
        appendConversationMessage(projectId, conversationId, {
          role: "assistant",
          content: `已生成：${asset.targetName || asset.sourceName}`,
          attachments: [attachment],
        });
      }
      const assetCategoryLinks = [...new Set(generatedKinds)];
      if (assetCategoryLinks.length && !budgetStopped) {
        updateProject(projectId, (project) => ({ ...project, stage: "plan" }));
        // 环节「全部目标资产图片 / 角色主图与三视图」需人工审核 → 暂停等确认（现状行为）；
        // 否则按当前执行模式继续生成转绘方案（在 finally 收尾后推进）。
        if (
          pauseAtGate(projectId, "all_asset_images") ||
          pauseAtGate(projectId, "character_images")
        ) {
          appendConversationMessage(projectId, conversationId, {
            role: "assistant",
            content:
              "资产图片已生成并归档到右侧“项目文件 > 结果 > 资产”。请按分类检查图片；确认无误后回复“继续下一步”，即可生成转绘方案。",
            assetCategoryLinks,
          });
        } else {
          appendConversationMessage(projectId, conversationId, {
            role: "assistant",
            content:
              "资产图片已生成并归档到右侧“项目文件 > 结果 > 资产”。按当前执行模式继续生成转绘方案。",
            assetCategoryLinks,
          });
          advanceToPlan = true;
        }
      } else if (!assetCategoryLinks.length && !budgetStopped && extractedAssets.length) {
        // 全败引导：渠道自动降级也用尽时给出可操作指引。阶段停在 assets
        // （可恢复点），用户切换生图模型后回复「生成资产图片」即可重试，
        // 不再静默卡死。
        appendConversationMessage(projectId, conversationId, {
          role: "assistant",
          content:
            "生图渠道均不可用（余额不足或被拒绝），本次没有产出任何资产图片。请在设置中切换生图模型后回复“生成资产图片”重试；资产表与已确认内容都会保留。",
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      if (isRunAborted(projectId)) return;
      setAnalysisError(`资产图片生成失败：${detail}`);
      finishRun(projectId, "failed", detail);
    } finally {
      if (!isRunAborted(projectId)) finishRun(projectId);
    }
    if (advanceToPlan && !isRunAborted(projectId)) {
      await runPlanGeneration(projectId, conversationId, styleBrief);
    }
  }

  function startNewConversation() {
    if (!activeProject) return;
    const conversation = createConversation();
    updateProject(activeProject.id, (project) => ({
      ...project,
      conversations: [conversation, ...project.conversations],
      activeConversationId: conversation.id,
    }));
  }

  function selectProject(project: RestyleProject) {
    setActiveProjectId(project.id);
  }

  function linkLibraryAsset(assetId: string) {
    if (!activeProject) return;
    updateProject(activeProject.id, (project) => ({
      ...project,
      assetIds: isRestyleAssetLinked(assetId, project.assetIds)
        ? project.assetIds
        : [...project.assetIds, assetId],
    }));
    setAssetPickerFor(null);
    setAssetPickerKind(null);
  }

  function updateExtractedAssets(
    mutator: (assets: RestyleExtractedAsset[]) => RestyleExtractedAsset[],
  ) {
    if (!activeProject) return;
    updateProject(activeProject.id, (project) => {
      const extractedAssets = mutator(project.extractedAssets);
      return {
        ...project,
        extractedAssets,
        confirmedAssetIds: project.confirmedAssetIds.filter((id) =>
          extractedAssets.some((asset) => asset.id === id),
        ),
        conversations: project.conversations.map((conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.assetTable ? { ...message, assetTable: extractedAssets } : message,
          ),
        })),
      };
    });
  }

  function updateCharacterRelations(
    mutator: (current: RestyleCharacterRelation[]) => RestyleCharacterRelation[],
  ) {
    if (!activeProject) return;
    updateProject(activeProject.id, (project) => {
      const next = mutator(project.characterRelations ?? []);
      // 空关系表不保留该字段（简单剧集自然不出现关系表）。
      return { ...project, characterRelations: next.length ? next : undefined };
    });
  }

  function handleRelationsChange(relations: RestyleCharacterRelation[]) {
    updateCharacterRelations(() => relations);
  }

  /** 「补全反向关系」一键修复：为每条单边补上反向边。 */
  function handleFixReverseRelations() {
    if (!activeProject) return;
    const characterIds = activeProject.extractedAssets
      .filter((asset) => asset.kind === "character")
      .map((asset) => asset.id);
    updateCharacterRelations((current) => withCompletedReverseRelations(current, characterIds));
  }

  /** 资产表 skill 自检：生成后自动跑一次，手工编辑后由「重新检查」触发。 */
  async function runAssetTableReview(
    assets: RestyleExtractedAsset[],
    relations: RestyleCharacterRelation[],
  ) {
    // 名称为空的行不送检（弹窗已必填原片名称，此处为防御性过滤），
    // server 端 schema 也要求名称非空。
    const reviewable = assets.filter((asset) => asset.sourceName.trim());
    if (!reviewable.length) return;
    setAssetReviewRunning(true);
    try {
      const result = await callReviewRestyleAssetTable({
        data: { model: selectedModel, assets: reviewable, relations },
      });
      if (result.ok) {
        setAssetReview({ verdict: result.verdict, issues: result.issues });
        setAssetReviewStale(false);
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "资产表自检失败");
    } finally {
      setAssetReviewRunning(false);
    }
  }

  /** 把人物关系文本拼进方案生成指令，分段提示词中的人物互动不得与关系矛盾。 */
  function withRelationBrief(instruction: string): string {
    const brief = buildRelationBrief(relationBriefsRef.current);
    return brief
      ? `${instruction}\n${brief}（分段提示词中的人物互动必须与上述关系一致）`
      : instruction;
  }

  /** 「采纳建议」一键写入：仅文本字段可直接写回。 */
  function handleAdoptReviewIssue(issue: AssetReviewIssue) {
    if (
      !["sourceName", "sourceDescription", "targetName", "targetDescription"].includes(issue.field)
    ) {
      return;
    }
    updateExtractedAssets((assets) =>
      assets.map((asset) =>
        asset.id === issue.assetId ? { ...asset, [issue.field]: issue.suggestion } : asset,
      ),
    );
    setAssetReview((current) =>
      current ? { ...current, issues: current.issues.filter((item) => item !== issue) } : current,
    );
  }

  // ---- 「过程与提示词」面板的回调：状态全部提升在 activeProject 上，面板保持无状态 ----

  function handleStyleBriefChange(next: string) {
    if (!activeProject) return;
    updateProject(activeProject.id, (project) => ({ ...project, styleBrief: next }));
  }

  function handleAssetPromptOverride(assetId: string, prompt: string) {
    updateExtractedAssets((assets) =>
      assets.map((asset) => (asset.id === assetId ? { ...asset, promptOverride: prompt } : asset)),
    );
  }

  function handleAssetPromptReset(assetId: string) {
    updateExtractedAssets((assets) =>
      assets.map((asset) =>
        asset.id === assetId ? { ...asset, promptOverride: undefined } : asset,
      ),
    );
  }

  function handleSegmentPromptChange(episode: string, segmentId: string, prompt: string) {
    if (!activeProject) return;
    updateProject(activeProject.id, (project) => ({
      ...project,
      planEpisodes: project.planEpisodes?.map((plan) =>
        plan.episode !== episode
          ? plan
          : {
              ...plan,
              segments: plan.segments.map((segment) =>
                segment.id === segmentId ? { ...segment, prompt } : segment,
              ),
            },
      ),
    }));
  }

  function regenerateAssetWithCurrentPrompt(asset: RestyleExtractedAsset) {
    if (!activeProject || !activeConversation) return;
    // 覆盖内容已在编辑时写进 asset.promptOverride，生成时由 resolveAssetImagePrompt 取用。
    void generateAssetImages(
      activeProject.id,
      activeConversation.id,
      "",
      [asset],
      [],
      styleBriefForProject(activeProject.id),
    );
  }

  function canvasAttachmentPrompt(attachment: RestyleAttachment): string {
    if (attachment.prompt) return attachment.prompt;
    const plan = activeProject?.planEpisodes?.find((item) => item.episode === attachment.episode);
    if (attachment.segmentId) {
      return plan?.segments.find((segment) => segment.id === attachment.segmentId)?.prompt ?? "";
    }
    return plan?.segments.map((segment) => `${segment.id}: ${segment.prompt}`).join("\n\n") ?? "";
  }

  function canvasAttachmentUrl(attachment: RestyleAttachment): string | undefined {
    return attachment.resultUrl ?? attachment.url ?? filePreviews[attachment.id];
  }

  function regenerateCanvasAttachment(attachment: RestyleAttachment) {
    if (!activeProject || !activeConversation) return;
    const prompt = canvasPrompt.trim() || canvasAttachmentPrompt(attachment);
    if (attachment.generatedKind === "video_clip" || attachment.generatedKind === "final_video") {
      if (!attachment.episode) return;
      appendConversationMessage(activeProject.id, activeConversation.id, {
        role: "user",
        content: `重新生成 ${attachment.name}：${prompt}`,
      });
      generateRenderedVideos(activeProject.id, activeConversation.id, {
        episode: attachment.episode,
        segmentId: attachment.segmentId,
        feedback: prompt || "请根据当前提示词重新生成。",
        sourceAttachmentId: attachment.sourceAttachmentId,
        rerunOfAttachmentId: attachment.id,
        referenceAssetIds: referencedCanvasAttachmentIds,
      });
      return;
    }
    if (
      attachment.generatedKind !== "character" &&
      attachment.generatedKind !== "scene" &&
      attachment.generatedKind !== "prop"
    )
      return;
    // 优先用 sourceAssetId 精确定位；名称匹配只作为旧数据兼容降级，
    // 否则改名或同名时指正会落到别的资产上。
    const extracted =
      activeProject.extractedAssets.find((asset) => asset.id === attachment.sourceAssetId) ??
      activeProject.extractedAssets.find(
        (asset) => asset.targetName && attachment.name.includes(asset.targetName),
      );
    if (!extracted) return;
    void generateAssetImages(
      activeProject.id,
      activeConversation.id,
      prompt,
      [extracted],
      [],
      styleBriefForProject(activeProject.id),
    );
  }

  if (view === "canvas") {
    // Keep project-library assets separate from generated restyle assets.
    const canvasProjectAssets = linkedProjectAssets;
    const canvasAssets =
      canvasKind === "all"
        ? canvasProjectAssets
        : canvasProjectAssets.filter((asset) => asset.kind === canvasKind);
    const canvasSelectedAsset =
      selectedAsset && canvasAssets.some((asset) => asset.id === selectedAsset.id)
        ? selectedAsset
        : canvasAssets[0];
    const canvasGeneratedAttachments = (activeProject?.files ?? []).filter(
      (file) =>
        Boolean(canvasAttachmentUrl(file)) &&
        ["character", "scene", "prop", "video_clip", "final_video"].includes(
          file.generatedKind ?? "",
        ),
    );
    const canvasSelectedAttachment = canvasGeneratedAttachments.find(
      (file) => file.id === selectedCanvasAttachmentId,
    );
    const canvasEpisodes = (activeProject?.planEpisodes ?? []).map((episode) => episode.episode);
    return (
      <section
        className="flex h-[100dvh] min-h-[640px] flex-col overflow-hidden bg-bg"
        data-testid="restyle-canvas"
      >
        <CanvasHeader
          title={t.restyle_canvas}
          backLabel={t.restyle_workbench}
          onClose={() => setView("workbench")}
        />
        <div className="grid min-h-0 flex-1 gap-4 overflow-auto bg-[radial-gradient(var(--border-color)_1px,transparent_1px)] bg-[size:16px_16px] p-5 xl:grid-cols-[220px_minmax(0,1fr)_300px]">
          <aside className="rounded-xl border border-border bg-bg-surface p-3">
            <p className="mb-2 text-xs font-semibold text-text-primary">项目资产</p>
            {(["all", "character", "scene", "prop"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setCanvasKind(kind)}
                className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs ${canvasKind === kind ? "bg-accent-dim text-accent" : "text-text-secondary hover:bg-bg-elevated"}`}
              >
                <span>
                  {kind === "all"
                    ? "全部资产"
                    : kind === "character"
                      ? "角色"
                      : kind === "scene"
                        ? "场景"
                        : "道具"}
                </span>
                <span>
                  {kind === "all"
                    ? canvasProjectAssets.length
                    : canvasProjectAssets.filter((asset) => asset.kind === kind).length}
                </span>
              </button>
            ))}
            <div className="mt-4 space-y-1 border-t border-border pt-3">
              {canvasAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => {
                    setSelectedAssetId(asset.id);
                    setSelectedCanvasAttachmentId(null);
                    setCanvasPrompt(asset.detail);
                  }}
                  className={`w-full truncate rounded-lg px-3 py-2 text-left text-xs ${canvasSelectedAsset?.id === asset.id ? "bg-bg-elevated text-text-primary" : "text-text-muted hover:bg-bg-elevated"}`}
                >
                  {asset.name}
                </button>
              ))}
            </div>
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-2 px-3 text-[11px] font-semibold text-text-muted">
                转绘资产（可引用）
              </p>
              {canvasGeneratedAttachments.map((attachment) => (
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => {
                    setSelectedCanvasAttachmentId(attachment.id);
                    setSelectedAssetId(null);
                    setCanvasPrompt(canvasAttachmentPrompt(attachment));
                  }}
                  className={`mb-1 flex w-full items-center gap-2 truncate rounded-lg px-3 py-2 text-left text-xs ${canvasSelectedAttachment?.id === attachment.id ? "bg-bg-elevated text-text-primary" : "text-text-muted hover:bg-bg-elevated"}`}
                >
                  <span className="shrink-0 text-accent">
                    {attachment.generatedKind?.includes("video") ? "视频" : "图片"}
                  </span>
                  <span className="truncate">{attachment.name}</span>
                  {!["video_clip", "final_video"].includes(attachment.generatedKind ?? "") ? (
                    <span className="ml-auto text-[10px] text-accent">
                      {referencedCanvasAttachmentIds.includes(attachment.id) ? "已引用" : "引用"}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-2 px-3 text-[11px] font-semibold text-text-muted">视频分集</p>
              {canvasEpisodes.map((episode) => (
                <button
                  key={episode}
                  type="button"
                  onClick={() => expandFileTreePath(`plan/${episode}`)}
                  className="mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-text-secondary hover:bg-bg-elevated"
                >
                  <span className="text-accent">▣</span>
                  {sourceVideoLabel(episode)}
                </button>
              ))}
            </div>
          </aside>
          <div
            className="relative min-h-[620px] overflow-hidden rounded-xl border border-border bg-[radial-gradient(var(--border-color)_1px,transparent_1px)] bg-[size:16px_16px]"
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest("button")) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              canvasDragRef.current = {
                x: event.clientX,
                y: event.clientY,
                offsetX: canvasOffset.x,
                offsetY: canvasOffset.y,
              };
            }}
            onPointerMove={(event) => {
              const drag = canvasDragRef.current;
              if (!drag) return;
              setCanvasOffset({
                x: drag.offsetX + event.clientX - drag.x,
                y: drag.offsetY + event.clientY - drag.y,
              });
            }}
            onPointerUp={(event) => {
              canvasDragRef.current = null;
              event.currentTarget.releasePointerCapture?.(event.pointerId);
            }}
            onPointerCancel={() => {
              canvasDragRef.current = null;
            }}
          >
            <div className="absolute left-4 top-4 z-10 rounded-lg border border-border bg-bg-surface/95 px-3 py-2 text-xs text-text-muted">
              引用资产 <span className="ml-1 text-accent">{canvasAssets.length}</span>
            </div>
            <div
              className="absolute inset-0"
              style={{
                transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${zoom / 100})`,
                transformOrigin: "0 0",
              }}
            >
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full opacity-40"
                aria-hidden="true"
              >
                {canvasAssets.slice(0, 8).map((asset, index) => (
                  <line
                    key={asset.id}
                    x1={`${230 + index * 95}px`}
                    y1="180"
                    x2="78%"
                    y2={`${150 + index * 38}px`}
                    stroke="currentColor"
                    strokeDasharray="5 5"
                  />
                ))}
              </svg>
              <div className="absolute left-8 right-[28%] top-24 flex flex-wrap gap-4">
                {canvasAssets.slice(0, 12).map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => {
                      setSelectedAssetId(asset.id);
                      setCanvasPrompt(asset.detail);
                    }}
                    className={`w-[132px] overflow-hidden rounded-lg border bg-bg-surface text-left shadow-xl ${canvasSelectedAsset?.id === asset.id ? "border-accent ring-2 ring-accent/30" : "border-border"}`}
                  >
                    <div className="relative h-24 overflow-hidden">
                      <AssetVisual asset={asset} compact />
                      <span className="absolute left-2 top-2 rounded bg-bg/80 px-1.5 py-0.5 text-[9px] text-text-primary">
                        {asset.kind === "character"
                          ? "角色"
                          : asset.kind === "scene"
                            ? "场景"
                            : "道具"}
                      </span>
                    </div>
                    <p className="truncate px-2 py-2 text-[11px] font-medium text-text-primary">
                      {asset.name}
                    </p>
                  </button>
                ))}
              </div>
              <div className="absolute left-8 right-[28%] top-[28rem] flex flex-wrap gap-4">
                {canvasGeneratedAttachments.map((attachment) => {
                  const url = canvasAttachmentUrl(attachment);
                  return (
                    <button
                      key={attachment.id}
                      type="button"
                      onClick={() => {
                        setSelectedCanvasAttachmentId(attachment.id);
                        setCanvasPrompt(canvasAttachmentPrompt(attachment));
                      }}
                      className={`w-[180px] overflow-hidden rounded-lg border bg-bg-surface text-left shadow-xl ${canvasSelectedAttachment?.id === attachment.id ? "border-accent ring-2 ring-accent/30" : "border-border"}`}
                    >
                      <div className="relative h-28 overflow-hidden bg-bg-elevated">
                        {url && attachment.generatedKind?.includes("video") ? (
                          <video
                            src={url}
                            muted
                            preload="metadata"
                            className="h-full w-full object-cover"
                          />
                        ) : url ? (
                          <img src={url} alt="" className="h-full w-full object-cover" />
                        ) : null}
                        <span className="absolute left-2 top-2 rounded bg-bg/80 px-1.5 py-0.5 text-[9px] text-text-primary">
                          {attachment.generatedKind?.includes("video") ? "视频" : "图片"}
                        </span>
                      </div>
                      <p className="truncate px-2 py-2 text-[11px] font-medium text-text-primary">
                        {attachment.name}
                      </p>
                    </button>
                  );
                })}
              </div>
              <div className="absolute right-5 top-24 w-[150px] space-y-3">
                {canvasEpisodes.length ? (
                  canvasEpisodes.map((episode) => (
                    <button
                      key={episode}
                      type="button"
                      className="w-full rounded-lg border border-border bg-bg-surface p-2 text-left shadow-xl"
                      onClick={() => {
                        expandFileTreePath("plan");
                        expandFileTreePath(`plan/${episode}`);
                      }}
                    >
                      <p className="text-[10px] text-text-muted">视频</p>
                      <p className="mt-1 text-xs font-semibold text-text-primary">
                        {sourceVideoLabel(episode)}
                      </p>
                      <p className="mt-1 text-[10px] text-text-muted">
                        {activeProject?.planEpisodes?.find((item) => item.episode === episode)
                          ?.segments.length ?? 0}{" "}
                        段
                      </p>
                    </button>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-border p-3 text-[10px] text-text-muted">
                    方案生成后显示每集视频
                  </div>
                )}
              </div>
            </div>
            <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-bg-surface/95 px-3 py-2 shadow-xl">
              <button
                type="button"
                onClick={() => setZoom(Math.max(50, zoom - 15))}
                className="rounded px-2 text-sm text-text-secondary"
              >
                −
              </button>
              <span className="min-w-10 text-center text-xs text-text-primary">{zoom}%</span>
              <button
                type="button"
                onClick={() => setZoom(Math.min(150, zoom + 15))}
                className="rounded px-2 text-sm text-text-secondary"
              >
                +
              </button>
              <span className="mx-1 h-4 w-px bg-border" />
              <button
                type="button"
                onClick={() => {
                  setZoom(100);
                  setCanvasOffset({ x: 0, y: 0 });
                }}
                className="rounded px-2 text-xs text-text-secondary"
              >
                重置
              </button>
              <button
                type="button"
                onClick={() => document.documentElement.requestFullscreen?.()}
                className="rounded px-2 text-xs text-text-secondary"
              >
                全屏
              </button>
            </div>
          </div>
          <aside className="rounded-xl border border-border bg-bg-surface p-4">
            <p className="text-xs text-text-muted">资产编辑</p>
            {canvasSelectedAttachment ? (
              <>
                <h2 className="mt-1 truncate font-semibold text-text-primary">
                  {canvasSelectedAttachment.name}
                </h2>
                <div className="mt-3 overflow-hidden rounded-lg bg-bg-elevated">
                  {canvasAttachmentUrl(canvasSelectedAttachment) &&
                  canvasSelectedAttachment.generatedKind?.includes("video") ? (
                    <video
                      src={canvasAttachmentUrl(canvasSelectedAttachment)}
                      controls
                      className="max-h-48 w-full"
                    />
                  ) : canvasAttachmentUrl(canvasSelectedAttachment) ? (
                    <img
                      src={canvasAttachmentUrl(canvasSelectedAttachment)}
                      alt=""
                      className="max-h-48 w-full object-contain"
                    />
                  ) : null}
                </div>
                <label className="mt-4 block text-xs text-text-muted">
                  编辑提示词
                  <textarea
                    value={canvasPrompt || canvasAttachmentPrompt(canvasSelectedAttachment)}
                    onChange={(event) => setCanvasPrompt(event.target.value)}
                    rows={8}
                    className="mt-2 w-full resize-y rounded-lg border border-border bg-bg-elevated p-3 text-xs leading-5 text-text-primary outline-none focus:border-accent"
                  />
                </label>
                {!["video_clip", "final_video"].includes(
                  canvasSelectedAttachment.generatedKind ?? "",
                ) ? (
                  <button
                    type="button"
                    onClick={() =>
                      setReferencedCanvasAttachmentIds((ids) =>
                        ids.includes(canvasSelectedAttachment.id)
                          ? ids.filter((id) => id !== canvasSelectedAttachment.id)
                          : [...ids, canvasSelectedAttachment.id],
                      )
                    }
                    className="btn-ghost mt-3 w-full text-xs"
                  >
                    {referencedCanvasAttachmentIds.includes(canvasSelectedAttachment.id)
                      ? "取消引用到视频"
                      : "引用到下次视频生成"}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={isAnalyzing || !activeProject || !activeConversation}
                  onClick={() => regenerateCanvasAttachment(canvasSelectedAttachment)}
                  className="btn-primary mt-4 w-full text-xs"
                >
                  {isAnalyzing ? "生成中…" : "重新生成"}
                </button>
              </>
            ) : canvasSelectedAsset ? (
              <>
                <h2 className="mt-1 font-semibold text-text-primary">{canvasSelectedAsset.name}</h2>
                <p className="mt-3 text-xs leading-5 text-text-secondary">
                  {canvasSelectedAsset.detail}
                </p>
                <label className="mt-4 block text-xs text-text-muted">
                  生成/修改提示词
                  <textarea
                    value={canvasPrompt || canvasSelectedAsset.detail}
                    onChange={(event) => setCanvasPrompt(event.target.value)}
                    rows={7}
                    className="mt-2 w-full resize-y rounded-lg border border-border bg-bg-elevated p-3 text-xs leading-5 text-text-primary outline-none focus:border-accent"
                  />
                </label>
                <button
                  type="button"
                  disabled={isAnalyzing || !activeProject || !activeConversation}
                  onClick={() =>
                    activeProject &&
                    activeConversation &&
                    generateAssetImages(
                      activeProject.id,
                      activeConversation.id,
                      canvasPrompt || canvasSelectedAsset.detail,
                      [
                        activeProject.extractedAssets.find(
                          (asset) => asset.targetName === canvasSelectedAsset.name,
                        ) ?? {
                          id: canvasSelectedAsset.id,
                          kind: canvasSelectedAsset.kind,
                          sourceName: canvasSelectedAsset.name,
                          sourceDescription: canvasSelectedAsset.detail,
                          targetName: canvasSelectedAsset.name,
                          targetDescription: canvasPrompt || canvasSelectedAsset.detail,
                          importance: "required",
                          shouldRestyle: true,
                        },
                      ],
                      [],
                      styleBriefForProject(activeProject.id),
                    )
                  }
                  className="btn-primary mt-4 w-full text-xs"
                >
                  {isAnalyzing ? "生成中…" : "生成新版本"}
                </button>
              </>
            ) : (
              <p className="mt-3 text-sm text-text-secondary">请选择一个资产开始编辑。</p>
            )}
          </aside>
        </div>
      </section>
    );
  }

  return (
    <section
      className="relative flex h-[100dvh] min-h-[640px] flex-col overflow-hidden bg-bg"
      data-testid="restyle-workbench"
      onDragOver={handleWorkspaceDragOver}
      onDragLeave={handleWorkspaceDragLeave}
      onDrop={handleWorkspaceDrop}
    >
      {isFileDragActive ? (
        <div
          className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-bg/70"
          data-testid="restyle-drop-overlay"
        >
          <div className="grid h-[calc(100%-2rem)] w-[calc(100%-2rem)] place-items-center rounded-2xl border-2 border-dashed border-accent bg-accent-dim/40">
            <p className="text-sm font-medium text-accent">{t.restyle_drop_upload_hint}</p>
          </div>
        </div>
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[232px_minmax(0,1fr)_310px]">
        {assetPickerFor || assetPickerKind ? (
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6"
            role="dialog"
            aria-modal="true"
          >
            <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-bg-surface shadow-2xl">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div>
                  <h2 className="font-semibold text-text-primary">从资产库选择</h2>
                  <p className="mt-1 text-xs text-text-muted">
                    选择后绑定到当前项目，并可作为参考图使用。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAssetPickerFor(null);
                    setAssetPickerKind(null);
                  }}
                  className="text-text-muted hover:text-text-primary"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto p-5 sm:grid-cols-3">
                {assets
                  .filter(
                    (asset) =>
                      asset.kind ===
                      (assetPickerKind ??
                        activeProject?.extractedAssets.find((item) => item.id === assetPickerFor)
                          ?.kind),
                  )
                  .map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => linkLibraryAsset(asset.id)}
                      className="overflow-hidden rounded-xl border border-border text-left hover:border-accent"
                    >
                      <div className="aspect-[4/3] overflow-hidden">
                        <AssetVisual asset={asset} compact />
                      </div>
                      <div className="p-2">
                        <p className="truncate text-xs font-medium text-text-primary">
                          {asset.name}
                        </p>
                        <p className="truncate text-[10px] text-text-muted">{asset.role}</p>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        ) : null}
        <aside className="hidden min-h-0 flex-col border-r border-border bg-bg-surface xl:flex">
          <div className="space-y-1 border-b border-border p-3">
            <button
              type="button"
              onClick={startNewConversation}
              disabled={!activeProject}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
            >
              <MessageSquare size={15} className="text-accent" /> {t.restyle_new_conversation}
            </button>
            <button
              type="button"
              onClick={createLocalProject}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
            >
              <Plus size={15} className="text-accent" /> {t.restyle_new_project}
            </button>
            <label className="relative mt-2 block">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
              />
              <input
                value={projectQuery}
                onChange={(event) => setProjectQuery(event.target.value)}
                placeholder={t.restyle_search}
                className="w-full rounded-lg border border-border bg-bg-elevated py-2 pl-8 pr-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
              />
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <p className="mb-2 flex items-center gap-1.5 px-2 text-xs font-medium text-text-muted">
              <ChevronDown size={13} /> {t.restyle_project_conversations}
            </p>
            {matchingProjects.length ? (
              <div className="space-y-1">
                {matchingProjects.map((project) => (
                  <div key={project.id} className="group rounded-lg">
                    <div
                      className={`flex items-center gap-1 pr-1 ${activeProjectId === project.id ? "bg-accent-dim text-accent" : "text-text-secondary hover:bg-bg-elevated"}`}
                    >
                      {editingProjectId === project.id ? (
                        <input
                          autoFocus
                          value={editingTitle}
                          onChange={(event) => setEditingTitle(event.target.value)}
                          onBlur={saveRename}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") saveRename();
                            if (event.key === "Escape") setEditingProjectId(null);
                          }}
                          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
                          aria-label={t.restyle_rename_project}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => selectProject(project)}
                          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
                        >
                          <Folder size={14} />
                          <span className="min-w-0 flex-1 truncate">{project.title}</span>
                          {isProjectRunning(project.id) ? (
                            <Loader2
                              size={12}
                              className="shrink-0 animate-spin text-accent"
                              aria-label={t.restyle_run_busy}
                            />
                          ) : null}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => startRename(project)}
                        className="grid h-6 w-6 place-items-center rounded text-text-muted opacity-0 hover:bg-bg-surface hover:text-accent group-hover:opacity-100 focus:opacity-100"
                        aria-label={t.restyle_rename_project}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteProject(project.id)}
                        className="grid h-6 w-6 place-items-center rounded text-text-muted opacity-0 hover:bg-bg-surface hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                        aria-label={t.restyle_delete_project}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="ml-5 border-l border-border/70 py-1 pl-2">
                      {project.conversations.map((conversation) => (
                        <button
                          key={conversation.id}
                          type="button"
                          onClick={() => {
                            selectProject(project);
                            updateProject(project.id, (current) => ({
                              ...current,
                              activeConversationId: conversation.id,
                            }));
                          }}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${project.id === activeProjectId && project.activeConversationId === conversation.id ? "bg-bg-elevated text-text-primary" : "text-text-muted hover:bg-bg-elevated hover:text-text-secondary"}`}
                        >
                          <MessageSquare size={12} />
                          <span className="truncate">
                            {conversation.title || t.restyle_untitled_conversation}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-3 py-5 text-xs leading-5 text-text-muted">
                {t.restyle_empty_projects}
              </p>
            )}
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col bg-bg">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-bg-surface/60 px-4 py-2.5 sm:px-5">
            <div className="min-w-0">
              <p className="text-[11px] text-text-muted">
                {activeProject?.title ?? t.restyle_no_project}
              </p>
              <h1 className="truncate text-sm font-semibold text-text-primary">
                {activeConversation?.title ?? t.restyle_untitled_conversation}
              </h1>
            </div>
          </div>
          <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            <div className="mx-auto max-w-4xl space-y-5">
              <div className="flex gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-dim text-accent">
                  <Sparkles size={15} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">{t.restyle_assistant}</p>
                  <p className="mt-1 text-sm leading-6 text-text-secondary">
                    {activeProject ? t.restyle_assistant_ready : t.restyle_select_project_hint}
                  </p>
                </div>
              </div>
              {activeProject ? (
                // 「请先确认这 3 项制作规格」表：与右侧选项区读写同一份项目状态，双向即时同步。
                <RestyleSpecCard
                  project={activeProject}
                  videoPricing={videoPricingRows}
                  listedVideoModels={listedVideoModels}
                  currentVideoModel={currentVideoModel}
                  onPatch={updateProjectSetup}
                  onConfirm={confirmProductionSpecs}
                  t={t}
                />
              ) : null}
              {(activeConversation?.messages ?? []).map((message) => (
                <div
                  key={message.id}
                  className={message.role === "assistant" ? "space-y-3" : "flex flex-col items-end"}
                >
                  {message.attachments?.length ? (
                    <div
                      className={`flex max-w-[80%] flex-wrap gap-2 ${message.role === "assistant" ? "" : "justify-end"}`}
                    >
                      {message.attachments.map((attachment) => (
                        <MessageAttachmentCard
                          key={attachment.id}
                          attachment={attachment}
                          previewUrl={filePreviews[attachment.id] ?? attachment.url}
                          thumbnailUrl={fileThumbnails[attachment.id]}
                          onOpen={() => {
                            const preview = attachmentPreview(attachment);
                            setSelectedFilePreview(preview);
                            setPreviewDialog(preview);
                          }}
                        />
                      ))}
                    </div>
                  ) : null}
                  {message.assetCategoryLinks?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {message.assetCategoryLinks.map((kind) => {
                        const label =
                          kind === "character"
                            ? t.restyle_assets_characters
                            : kind === "scene"
                              ? t.restyle_assets_scenes
                              : t.restyle_assets_props;
                        return (
                          <button
                            key={kind}
                            type="button"
                            onClick={() => openAssetCategoryFolder(kind)}
                            className="rounded-md px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-dim"
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {message.episodeLinks?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {message.episodeLinks.map((episode) => (
                        <button
                          key={episode}
                          type="button"
                          onClick={() => openPlanEpisode(episode)}
                          className="rounded-md px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-dim"
                        >
                          {sourceVideoLabel(episode)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {message.finalEpisodeLinks?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {message.finalEpisodeLinks.map((episode) => (
                        <button
                          key={episode}
                          type="button"
                          onClick={() => openFinalEpisode(episode)}
                          className="rounded-md px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-dim"
                        >
                          {sourceVideoLabel(episode)} 成片
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          expandFileTreePath("results");
                          expandFileTreePath("results/clips");
                        }}
                        className="rounded-md px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-dim"
                      >
                        视频片段
                      </button>
                      <button
                        type="button"
                        onClick={openRenderStatus}
                        className="rounded-md px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-dim"
                      >
                        生成状态
                      </button>
                    </div>
                  ) : null}
                  {message.content ? (
                    message.role === "assistant" && extractActionPhrases(message.content).length ? (
                      // 含动作口令的助手消息升级为待办卡片：口令 chip 点击即发送。
                      <ActionCallout
                        content={message.content}
                        phrases={extractActionPhrases(message.content)}
                        disabled={isAnalyzing || !activeConversation}
                        onRun={(phrase) => void sendChatMessage(phrase)}
                        t={t}
                      />
                    ) : (
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-6 ${message.role === "assistant" ? "rounded-bl-md border border-border bg-bg-surface text-text-secondary" : "rounded-br-md bg-accent text-bg"}`}
                      >
                        {message.content}
                      </div>
                    )
                  ) : null}
                  {message.assetTable?.length ? (
                    <div className="w-full rounded-2xl border border-border bg-bg-surface p-3 shadow-card">
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-text-primary">
                        <FileText size={14} className="text-accent" />
                        {t.restyle_stage_assets}
                        {message.id === lastAssetTableMessageId ? (
                          <button
                            type="button"
                            // 等价于在对话里发送「重新分析原片」指令，免猜关键词。
                            onClick={() => void sendChatMessage(t.restyle_reanalyze_button)}
                            disabled={isAnalyzing || !activeConversation}
                            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent-dim disabled:opacity-50"
                          >
                            <RotateCcw size={12} />
                            {t.restyle_reanalyze_button}
                          </button>
                        ) : null}
                      </div>
                      <ExtractedAssetTable
                        assets={message.assetTable}
                        t={t}
                        linkedAssetIds={activeProject?.assetIds ?? []}
                        onChooseLibraryAsset={setAssetPickerFor}
                        onDeleteAsset={(assetId) =>
                          updateExtractedAssets((assets) =>
                            assets.filter((asset) => asset.id !== assetId),
                          )
                        }
                        onChange={(next) => {
                          // 手工编辑后自检结果可能过期，提示用户手动「重新检查」。
                          setAssetReviewStale(true);
                          updateExtractedAssets(() => next);
                        }}
                        reviewIssues={(assetReview?.issues ?? []).filter(
                          (issue) => issue.field !== "relation",
                        )}
                        onAdoptIssue={handleAdoptReviewIssue}
                        onRecheck={() =>
                          void runAssetTableReview(
                            activeProject?.extractedAssets ?? [],
                            characterRelations,
                          )
                        }
                        reviewRunning={assetReviewRunning}
                        reviewStale={assetReviewStale}
                      />
                      {message.id === lastAssetTableMessageId ? (
                        <CharacterRelationTable
                          characters={relationCharacters}
                          relations={characterRelations}
                          issues={relationIssues}
                          reviewIssues={(assetReview?.issues ?? []).filter(
                            (issue) => issue.field === "relation",
                          )}
                          onChange={handleRelationsChange}
                          onFixReverse={handleFixReverseRelations}
                          t={t}
                        />
                      ) : null}
                      <ImageGenerationModeGuide t={t} />
                    </div>
                  ) : null}
                </div>
              ))}
              {activeRun && activeProjectId ? (
                <RunProgressCard run={activeRun} t={t} onStop={() => stopRun(activeProjectId)} />
              ) : null}
              {analysisError && !isAnalyzing && (
                <p className="text-xs text-destructive" role="alert">
                  {analysisError}
                </p>
              )}
            </div>
          </div>
          <form
            className="shrink-0 border-t border-border bg-bg-surface p-3 sm:px-5"
            onSubmit={(event) => {
              event.preventDefault();
              sendChatMessage();
            }}
          >
            <div
              className={`mx-auto max-w-4xl rounded-xl border bg-bg-elevated p-2 focus-within:border-accent ${pendingActionPhrase ? "border-accent/60" : "border-border"}`}
            >
              {draftAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 px-1 pb-2">
                  {draftAttachments.map((attachment) => (
                    <AttachmentPreview
                      key={attachment.id}
                      attachment={attachment}
                      previewUrl={filePreviews[attachment.id] ?? attachment.url}
                      thumbnailUrl={fileThumbnails[attachment.id]}
                      uploadState={attachmentUploads[attachment.id]}
                      onRetryUpload={() => retryAttachmentUpload(attachment)}
                      uploadLabels={{
                        uploading: t.restyle_upload_uploading,
                        done: t.restyle_upload_done,
                        failed: t.restyle_upload_failed,
                        retry: t.restyle_upload_retry,
                      }}
                      onRemove={() => removeFile(attachment.id)}
                      removeLabel={t.restyle_remove_file}
                    />
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setAttachmentMenuOpen((open) => !open)}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-muted hover:bg-bg hover:text-accent"
                    aria-label={t.restyle_attach}
                    aria-expanded={attachmentMenuOpen}
                  >
                    <Plus size={17} />
                  </button>
                  {attachmentMenuOpen && (
                    <div className="absolute bottom-10 left-0 z-20 w-44 rounded-xl border border-border bg-bg-surface p-1.5 shadow-card">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-elevated"
                      >
                        <FileText size={15} /> {t.restyle_attach_file}
                      </button>
                      <button
                        type="button"
                        onClick={() => folderInputRef.current?.click()}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-elevated"
                      >
                        <FolderOpen size={15} /> {t.restyle_attach_folder}
                      </button>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="sr-only"
                  data-testid="restyle-file-input"
                  onChange={(event) => {
                    attachFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
                <input
                  ref={reuploadInputRef}
                  type="file"
                  accept="video/*"
                  className="sr-only"
                  data-testid="restyle-reupload-input"
                  onChange={(event) => {
                    void handleReuploadSourceVideo(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                <input
                  ref={(node) => {
                    folderInputRef.current = node;
                    if (node) {
                      node.setAttribute("webkitdirectory", "");
                      node.setAttribute("directory", "");
                    }
                  }}
                  type="file"
                  multiple
                  className="sr-only"
                  data-testid="restyle-folder-input"
                  onChange={(event) => {
                    attachFiles(event.target.files, true);
                    event.target.value = "";
                  }}
                />
                <div className="relative min-w-0 flex-1">
                  {mentionQuery && mentionableAttachments.length ? (
                    <div className="absolute bottom-10 left-0 z-30 w-full max-w-md rounded-xl border border-border bg-bg-surface p-1.5 shadow-2xl">
                      <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-text-muted">
                        {t.restyle_mention_panel_title}
                      </p>
                      {mentionableAttachments.map((item) => {
                        const thumb =
                          fileThumbnails[item.attachment.id] ??
                          (item.kind === "image"
                            ? (filePreviews[item.attachment.id] ?? item.attachment.url)
                            : undefined);
                        return (
                          <button
                            key={item.attachment.id}
                            type="button"
                            onClick={() => insertMention(item)}
                            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-bg-elevated"
                          >
                            <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md bg-bg-elevated text-text-muted">
                              {thumb ? (
                                <img src={thumb} alt="" className="h-full w-full object-cover" />
                              ) : item.kind === "video" ? (
                                <Play size={14} />
                              ) : (
                                <FileText size={14} />
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-text-primary">
                                {item.alias}
                              </span>
                              <span className="block truncate text-xs text-text-muted">
                                {item.attachment.name}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  <textarea
                    value={chatDraft}
                    onChange={(event) => setChatDraft(event.target.value)}
                    onKeyDown={(event) => {
                      // 执行中按 Esc 直接停止当前项目的任务。
                      if (event.key === "Escape" && isAnalyzing && activeProjectId) {
                        event.preventDefault();
                        stopRun(activeProjectId);
                        return;
                      }
                      // Enter 发送、Shift+Enter 换行；中文输入法拼字中（isComposing）不触发发送。
                      // 执行中也允许发送：由 sendChatMessageInner 的忙态分支上屏 +
                      // 排队/忙态回复（此前这里 isAnalyzing 直接 return，消息被静默丢弃）。
                      if (event.key !== "Enter" || event.shiftKey) return;
                      if (event.nativeEvent.isComposing) return;
                      event.preventDefault();
                      if (!activeConversation) return;
                      void sendChatMessage();
                    }}
                    placeholder={
                      pendingActionPhrase
                        ? `${t.restyle_pending_confirm_prefix}${pendingActionPhrase}`
                        : activeProject?.extractedAssets.length
                          ? t.restyle_chat_feedback_placeholder
                          : t.restyle_chat_placeholder
                    }
                    rows={1}
                    className="max-h-24 min-h-8 w-full resize-none bg-transparent py-1.5 text-sm text-text-primary outline-none placeholder:text-text-muted"
                  />
                </div>
              </div>
              <p className="mt-1.5 px-1 text-[11px] text-text-muted">{t.restyle_chat_enter_hint}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/70 pt-2 text-xs">
                <label className="sr-only" htmlFor="restyle-feature">
                  {t.restyle_select_feature}
                </label>
                <select
                  id="restyle-feature"
                  defaultValue="video-restyle"
                  className="rounded-md bg-transparent px-2 py-1 text-text-secondary outline-none hover:bg-bg"
                >
                  <option value="video-restyle">{t.restyle_video_restyle}</option>
                </select>
                <span className="h-4 w-px bg-border" />
                <label className="sr-only" htmlFor="restyle-project-select">
                  {t.restyle_select_project}
                </label>
                <select
                  id="restyle-project-select"
                  value={activeProjectId ?? ""}
                  onChange={(event) => {
                    if (event.target.value === "__create__") {
                      createLocalProject();
                      return;
                    }
                    setActiveProjectId(event.target.value || null);
                  }}
                  className="max-w-40 rounded-md bg-transparent px-2 py-1 text-text-secondary outline-none hover:bg-bg"
                >
                  <option value="" disabled>
                    {t.restyle_select_project}
                  </option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
                  <option value="__create__">{t.restyle_create_project}</option>
                </select>
                <select
                  id="restyle-image-model"
                  value={selectedImageModel}
                  onChange={(event) => {
                    setSelectedImageModel(event.target.value);
                    if (activeProject) {
                      updateProject(activeProject.id, (project) => ({
                        ...project,
                        imageModel: event.target.value,
                      }));
                    }
                  }}
                  className="max-w-40 rounded-md bg-transparent px-2 py-1 text-xs text-text-secondary outline-none hover:bg-bg"
                  aria-label={t.restyle_image_model}
                >
                  {sortedImageModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {formatModelOptionLabel(model, modelBadgeLabels)}
                    </option>
                  ))}
                </select>
                <select
                  id="restyle-video-model"
                  value={selectedVideoModel}
                  onChange={(event) => {
                    setSelectedVideoModel(event.target.value);
                    if (activeProject) {
                      updateProject(activeProject.id, (project) => ({
                        ...project,
                        videoModel: event.target.value,
                      }));
                    }
                  }}
                  className="max-w-40 rounded-md bg-transparent px-2 py-1 text-xs text-text-secondary outline-none hover:bg-bg"
                  aria-label={t.restyle_video_model}
                >
                  {sortedVideoModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {formatModelOptionLabel(model, modelBadgeLabels, {
                        assetLibrarySupported: getVideoAssetLibrarySupport(model.id).supported,
                      })}
                    </option>
                  ))}
                </select>
                <select
                  id="restyle-model"
                  value={selectedModel}
                  onChange={(event) => setSelectedModel(event.target.value as RestyleModel)}
                  disabled={isAnalyzing}
                  className="ml-auto max-w-44 rounded-md bg-transparent px-2 py-1 text-xs text-text-secondary outline-none hover:bg-bg disabled:cursor-not-allowed"
                  aria-label={t.restyle_select_model}
                  title={t.restyle_analysis_model_hint}
                >
                  {analysisModelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {formatModelOptionLabel(model, modelBadgeLabels)}
                    </option>
                  ))}
                </select>
                {isAnalyzing ? (
                  // 执行中：发送键保留（走忙态分支上屏 + 排队/忙态回复），
                  // 停止键独立并列（此前发送键直接变成停止键，忙时消息无从发出）。
                  <>
                    <button
                      type="submit"
                      disabled={!activeConversation}
                      className="btn-primary !h-8 !w-8 !justify-center !rounded-lg !p-0"
                      aria-label={t.restyle_send}
                      title={t.restyle_send}
                    >
                      <Send size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => activeProjectId && stopRun(activeProjectId)}
                      disabled={!activeProjectId}
                      className="btn-primary !h-8 !w-8 !justify-center !rounded-lg !p-0"
                      aria-label={t.restyle_run_stop}
                      title={t.restyle_run_stop}
                    >
                      <Square size={13} fill="currentColor" />
                    </button>
                  </>
                ) : (
                  <button
                    type="submit"
                    disabled={!activeConversation}
                    className="btn-primary !h-8 !w-8 !justify-center !rounded-lg !p-0"
                    aria-label={t.restyle_send}
                    title={t.restyle_send}
                  >
                    <Send size={15} />
                  </button>
                )}
              </div>
              {!getVideoAssetLibrarySupport(selectedVideoModel).supported && (
                <p className="mt-2 rounded-md border border-amber-300/70 bg-amber-50 px-2 py-1 text-[11px] leading-4 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                  {t.restyle_video_model_no_review_warning}
                </p>
              )}
            </div>
          </form>
        </main>

        <aside className="hidden min-h-0 flex-col border-l border-border bg-bg-surface xl:flex">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold text-text-primary truncate">
                {t.restyle_workbench}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="grid h-7 w-7 place-items-center rounded-md text-text-muted hover:bg-bg-elevated hover:text-accent"
                aria-label="上传项目文件"
                title="上传项目文件"
              >
                <Upload size={15} />
              </button>
              <button
                type="button"
                onClick={() => setView("canvas")}
                className="grid h-7 w-7 place-items-center rounded-md text-text-muted hover:bg-bg-elevated hover:text-accent"
                aria-label={t.restyle_open_canvas}
              >
                <LayoutGrid size={15} />
              </button>
            </div>
          </div>
          <div
            className="flex gap-1 border-b border-border p-2"
            role="tablist"
            aria-label="右栏面板切换"
          >
            {(
              [
                { id: "setup", label: t.restyle_tab_setup },
                { id: "process", label: t.restyle_tab_process },
                { id: "files", label: t.restyle_tab_files },
              ] as const
            ).map((tab) => {
              const selected = railTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectRailTab(tab.id)}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
                    selected
                      ? "bg-accent text-bg"
                      : "text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
                  } ${tab.id === "process" && processTabAttention ? "animate-pulse" : ""}`}
                >
                  {tab.label}
                  {tab.id === "process" && processTabRunning && (
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full ${selected ? "bg-bg" : "bg-accent"}`}
                    />
                  )}
                  {tab.id === "files" && filesTabCount > 0 && (
                    <span
                      aria-hidden="true"
                      className={`rounded-full px-1 text-[10px] leading-4 ${
                        selected ? "bg-bg/20 text-bg" : "bg-accent-dim text-accent"
                      }`}
                    >
                      {filesTabCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {railTab === "setup" && (
              <RestyleSetupPanel
                project={activeProject}
                videoPricing={videoPricingRows}
                listedVideoModels={listedVideoModels}
                currentVideoModel={currentVideoModel}
                onPatch={updateProjectSetup}
                t={t}
              />
            )}
            {railTab === "process" && (
              <RestyleProcessPanel
                project={activeProject}
                isAnalyzing={isAnalyzing}
                assetRunStatus={assetRunStatus}
                onStyleBriefChange={handleStyleBriefChange}
                onAssetPromptChange={handleAssetPromptOverride}
                onAssetPromptReset={handleAssetPromptReset}
                onRegenerateAsset={regenerateAssetWithCurrentPrompt}
                onSegmentPromptChange={handleSegmentPromptChange}
                t={t}
              />
            )}
            {railTab === "files" && (
              <div className="p-3">
                {activeProject ? (
                  <div>
                    <div className="mb-2 flex items-center gap-2 px-1 text-xs">
                      <span className="truncate font-semibold text-text-primary">
                        {activeProject.title}
                      </span>
                      <span className="shrink-0 text-[11px] text-accent">跟转绘步骤一一对应</span>
                    </div>
                    <ProjectFileTree
                      nodes={projectFileTree}
                      closedPaths={closedFileTreePaths}
                      selectedPreviewKey={visibleFilePreview?.key ?? ""}
                      onToggleFolder={toggleFileTreePath}
                      onOpenFile={openFilePreview}
                      onDragFile={setDraggedFileId}
                      dropTarget={fileDropTarget}
                      onDropTarget={setFileDropTarget}
                      onCanDropFile={canDropProjectFile}
                      onDropFile={moveProjectFile}
                      onContextMenu={(event, preview) => {
                        event.preventDefault();
                        setFileContextMenu({ x: event.clientX, y: event.clientY, preview });
                      }}
                      onContextMenuFolder={() => undefined}
                      onChooseFolderAsset={(node) => {
                        const kind = node.id.match(
                          /^results\/assets\/(character|scene|prop)$/,
                        )?.[1] as RestyleAsset["kind"] | undefined;
                        if (kind) setAssetPickerKind(kind);
                      }}
                    />
                  </div>
                ) : (
                  <p className="px-2 py-4 text-xs leading-5 text-text-muted">
                    {t.restyle_select_project_hint}
                  </p>
                )}
              </div>
            )}
          </div>
          {inspectorOpen ? (
            <div className="border-t border-border p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-text-primary">{t.restyle_inspector}</h3>
                <div className="flex items-center gap-1">
                  {assetLibraryStatus === "loading" && (
                    <span className="text-[10px] text-text-muted">{t.restyle_assets_syncing}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setInspectorOpen(false)}
                    className="grid h-7 w-7 place-items-center rounded-md text-text-muted hover:bg-bg-elevated hover:text-text-primary"
                    aria-label="关闭检查器"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              {visibleFilePreview ? (
                <FilePreviewInspector
                  preview={visibleFilePreview}
                  previewUrl={
                    visibleFilePreview.kind === "attachment"
                      ? previewUrlForAttachment(visibleFilePreview.attachment)
                      : undefined
                  }
                  thumbnailUrl={
                    visibleFilePreview.kind === "attachment"
                      ? fileThumbnails[visibleFilePreview.attachment.id]
                      : undefined
                  }
                  videoPair={
                    visibleFilePreview.kind === "attachment"
                      ? videoPairForAttachment(visibleFilePreview.attachment)
                      : null
                  }
                  renderSegments={
                    visibleFilePreview.kind === "attachment"
                      ? renderSegmentsForAttachment(visibleFilePreview.attachment)
                      : []
                  }
                  onRerunSegment={rerunVideoSegment}
                  onRetrySegment={retryVideoSegment}
                  onReuploadSourceVideo={requestReuploadSourceVideo}
                  onOpen={() => setPreviewDialog(visibleFilePreview)}
                  t={t}
                />
              ) : selectedAsset ? (
                <div className="flex gap-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg">
                    <AssetVisual asset={selectedAsset} compact />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-primary">
                      {selectedAsset.name}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-secondary">
                      {selectedAsset.detail}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs leading-5 text-text-muted">
                  {assetLibraryStatus === "error" ? t.restyle_assets_error : t.restyle_empty_assets}
                </p>
              )}
            </div>
          ) : (
            <div className="border-t border-border p-3">
              <button
                type="button"
                onClick={() => setInspectorOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
                aria-label="打开检查器"
              >
                <Search size={13} />
                打开检查器
              </button>
            </div>
          )}
        </aside>
        {visibleFileContextMenu ? (
          <div
            className="fixed z-[60] min-w-36 rounded-lg border border-border bg-bg-surface p-1 shadow-2xl"
            style={{ left: visibleFileContextMenu.x, top: visibleFileContextMenu.y }}
            role="menu"
            onMouseLeave={() => setFileContextMenu(null)}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => downloadFilePreview(visibleFileContextMenu.preview)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
            >
              <Download size={14} /> 下载文件
            </button>
            {visibleFileContextMenu.preview.kind === "attachment" ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => deleteFilePreview(visibleFileContextMenu.preview)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/10"
              >
                <Trash2 size={14} /> 删除文件
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {visiblePreviewDialog ? (
        <FilePreviewDialog
          preview={visiblePreviewDialog}
          previewUrl={
            visiblePreviewDialog.kind === "attachment"
              ? previewUrlForAttachment(visiblePreviewDialog.attachment)
              : undefined
          }
          thumbnailUrl={
            visiblePreviewDialog.kind === "attachment"
              ? fileThumbnails[visiblePreviewDialog.attachment.id]
              : undefined
          }
          videoPair={
            visiblePreviewDialog.kind === "attachment"
              ? videoPairForAttachment(visiblePreviewDialog.attachment)
              : null
          }
          renderSegments={
            visiblePreviewDialog.kind === "attachment"
              ? renderSegmentsForAttachment(visiblePreviewDialog.attachment)
              : []
          }
          onRerunSegment={rerunVideoSegment}
          onClose={() => setPreviewDialog(null)}
        />
      ) : null}
      <SegmentRerunDialog
        open={rerunTarget !== null}
        segment={rerunTarget}
        onSubmit={(feedback) => {
          if (rerunTarget) submitSegmentRerun(rerunTarget, feedback);
        }}
        onClose={() => setRerunTarget(null)}
        t={t}
      />
    </section>
  );
}

function CanvasHeader({
  title,
  backLabel,
  onClose,
}: {
  title: string;
  backLabel: string;
  onClose: () => void;
}) {
  return (
    <header className="flex h-13 shrink-0 items-center justify-between border-b border-border bg-bg-surface px-4">
      <h1 className="font-semibold text-text-primary">{title}</h1>
      <button
        type="button"
        onClick={onClose}
        className="btn-ghost !px-3 !py-2 text-xs"
        aria-label={backLabel}
      >
        ←
      </button>
    </header>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="grid h-full min-h-[220px] place-items-center p-8 text-center text-sm text-text-muted">
      {text}
    </div>
  );
}

function ProjectFileTree({
  nodes,
  closedPaths,
  selectedPreviewKey,
  onToggleFolder,
  onOpenFile,
  onDragFile,
  dropTarget,
  onDropTarget,
  onCanDropFile,
  onDropFile,
  onContextMenu,
  onContextMenuFolder,
  onChooseFolderAsset,
}: {
  nodes: RestyleFileTreeNode[];
  closedPaths: string[];
  selectedPreviewKey: string;
  onToggleFolder: (path: string) => void;
  onOpenFile: (preview: RestyleFilePreview) => void;
  onDragFile: (fileId: string | null) => void;
  dropTarget: RestyleFileDropTarget | null;
  onDropTarget: (target: RestyleFileDropTarget | null) => void;
  onCanDropFile: (request: RestyleFileDropRequest) => boolean;
  onDropFile: (request: RestyleFileDropRequest) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, preview: RestyleFilePreview) => void;
  onContextMenuFolder: (
    event: ReactMouseEvent<HTMLButtonElement>,
    node: RestyleFileTreeNode,
  ) => void;
  onChooseFolderAsset: (node: RestyleFileTreeNode) => void;
}) {
  if (!nodes.length) return <p className="px-2 py-1 text-xs text-text-muted">—</p>;
  return (
    <div className="space-y-0.5" data-testid="restyle-project-file-tree">
      {nodes.map((node) => (
        <ProjectFileTreeItem
          key={node.id}
          node={node}
          depth={0}
          parentNodeId={null}
          closedPaths={closedPaths}
          selectedPreviewKey={selectedPreviewKey}
          onToggleFolder={onToggleFolder}
          onOpenFile={onOpenFile}
          onDragFile={onDragFile}
          dropTarget={dropTarget}
          onDropTarget={onDropTarget}
          onCanDropFile={onCanDropFile}
          onDropFile={onDropFile}
          onContextMenu={onContextMenu}
          onContextMenuFolder={onContextMenuFolder}
          onChooseFolderAsset={onChooseFolderAsset}
        />
      ))}
    </div>
  );
}

function ProjectFileTreeItem({
  node,
  depth,
  parentNodeId,
  closedPaths,
  selectedPreviewKey,
  onToggleFolder,
  onOpenFile,
  onDragFile,
  dropTarget,
  onDropTarget,
  onCanDropFile,
  onDropFile,
  onContextMenu,
  onContextMenuFolder,
  onChooseFolderAsset,
}: {
  node: RestyleFileTreeNode;
  depth: number;
  parentNodeId: string | null;
  closedPaths: string[];
  selectedPreviewKey: string;
  onToggleFolder: (path: string) => void;
  onOpenFile: (preview: RestyleFilePreview) => void;
  onDragFile: (fileId: string | null) => void;
  dropTarget: RestyleFileDropTarget | null;
  onDropTarget: (target: RestyleFileDropTarget | null) => void;
  onCanDropFile: (request: RestyleFileDropRequest) => boolean;
  onDropFile: (request: RestyleFileDropRequest) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, preview: RestyleFilePreview) => void;
  onContextMenuFolder: (
    event: ReactMouseEvent<HTMLButtonElement>,
    node: RestyleFileTreeNode,
  ) => void;
  onChooseFolderAsset: (node: RestyleFileTreeNode) => void;
}) {
  const isFolder = node.kind === "folder";
  const isOpen = isFolder && !closedPaths.includes(node.id);
  const selected = Boolean(node.preview && node.preview.key === selectedPreviewKey);
  const label = isFolder ? `切换文件夹：${node.label}` : `预览文件：${node.label}`;
  const canDrag = node.preview?.kind === "attachment";
  const activeDropPosition = dropTarget?.nodeId === node.id ? dropTarget.position : null;
  const dropClass =
    activeDropPosition === "before"
      ? "border-t-2 border-accent"
      : activeDropPosition === "after"
        ? "border-b-2 border-accent"
        : activeDropPosition === "inside"
          ? "bg-accent-dim text-accent ring-1 ring-accent/50"
          : "";

  function dropPositionForEvent(event: ReactDragEvent<HTMLElement>): RestyleFileDropPosition {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
    if (isFolder) {
      if (ratio < 0.24) return "before";
      if (ratio > 0.76) return "after";
      return "inside";
    }
    return ratio < 0.5 ? "before" : "after";
  }

  function handleDragOver(event: ReactDragEvent<HTMLElement>) {
    const position = dropPositionForEvent(event);
    if (!onCanDropFile({ targetNode: node, parentNodeId, position })) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    onDropTarget({ nodeId: node.id, position });
  }

  function handleDrop(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    const position = activeDropPosition ?? dropPositionForEvent(event);
    if (!onCanDropFile({ targetNode: node, parentNodeId, position })) return;
    onDropFile({ targetNode: node, parentNodeId, position });
    onDropTarget(null);
  }

  return (
    <div>
      <button
        type="button"
        draggable={canDrag}
        onDragStart={(event) => {
          if (!canDrag || node.preview?.kind !== "attachment") return;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", node.preview.attachment.id);
          onDragFile(node.preview.attachment.id);
        }}
        onDragEnd={() => {
          onDragFile(null);
          onDropTarget(null);
        }}
        onDragOver={handleDragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            onDropTarget(null);
          }
        }}
        onDrop={handleDrop}
        onClick={() => {
          if (isFolder) onToggleFolder(node.id);
          else if (node.preview) onOpenFile(node.preview);
        }}
        onContextMenu={(event) => {
          if (node.preview) onContextMenu(event, node.preview);
          else if (isFolder) onContextMenuFolder(event, node);
        }}
        className={`flex w-full items-center gap-1.5 rounded-md border border-transparent py-1.5 pr-2 text-left text-xs ${selected ? "bg-bg-elevated text-text-primary" : "text-text-secondary hover:bg-bg-elevated/70 hover:text-text-primary"} ${dropClass} ${canDrag ? "cursor-grab active:cursor-grabbing" : ""}`}
        style={{ paddingLeft: depth * 16 + 4 }}
        aria-label={label}
        aria-expanded={isFolder ? isOpen : undefined}
        data-file-tree-path={node.id}
      >
        {isFolder ? (
          <ChevronDown
            size={13}
            className={`shrink-0 text-text-muted transition ${isOpen ? "" : "-rotate-90"}`}
          />
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        {isFolder ? (
          <Folder size={14} className="shrink-0 text-accent" />
        ) : (
          <FileText size={13} className="shrink-0 text-text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
        {isFolder && node.id.startsWith("results/assets/") && node.id.split("/").length === 3 ? (
          <span
            role="button"
            tabIndex={0}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-muted hover:bg-accent-dim hover:text-accent"
            title="从资产库添加"
            aria-label={`向${node.label}添加资产`}
            onClick={(event) => {
              event.stopPropagation();
              onChooseFolderAsset(node);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onChooseFolderAsset(node);
              }
            }}
          >
            <Upload size={12} />
          </span>
        ) : null}
        <span className="shrink-0 text-[11px] text-text-muted">
          {isFolder
            ? (node.count ?? countTreeLeaves(node.children)) || ""
            : formatFileSize(node.size)}
        </span>
      </button>
      {isFolder && isOpen && node.children?.length ? (
        <div>
          {node.children.map((child) => (
            <ProjectFileTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              parentNodeId={node.id}
              closedPaths={closedPaths}
              selectedPreviewKey={selectedPreviewKey}
              onToggleFolder={onToggleFolder}
              onOpenFile={onOpenFile}
              onDragFile={onDragFile}
              dropTarget={dropTarget}
              onDropTarget={onDropTarget}
              onCanDropFile={onCanDropFile}
              onDropFile={onDropFile}
              onContextMenu={onContextMenu}
              onContextMenuFolder={onContextMenuFolder}
              onChooseFolderAsset={onChooseFolderAsset}
            />
          ))}
        </div>
      ) : null}
      {isFolder && isOpen && !node.children?.length ? (
        <div
          role="button"
          tabIndex={-1}
          className={`rounded-md px-2 py-1 text-xs text-text-muted ${activeDropPosition === "inside" ? "bg-accent-dim text-accent ring-1 ring-accent/50" : ""}`}
          style={{ paddingLeft: (depth + 1) * 16 + 22 }}
          onDragOver={(event) => {
            const position: RestyleFileDropPosition = "inside";
            if (!onCanDropFile({ targetNode: node, parentNodeId, position })) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            onDropTarget({ nodeId: node.id, position });
          }}
          onDrop={(event) => {
            const position: RestyleFileDropPosition = "inside";
            if (!onCanDropFile({ targetNode: node, parentNodeId, position })) return;
            event.preventDefault();
            onDropFile({ targetNode: node, parentNodeId, position });
            onDropTarget(null);
          }}
        >
          拖到这里
        </div>
      ) : null}
    </div>
  );
}

function FilePreviewInspector({
  preview,
  previewUrl,
  thumbnailUrl,
  videoPair,
  renderSegments,
  onRerunSegment,
  onRetrySegment,
  onReuploadSourceVideo,
  onOpen,
  t,
}: {
  preview: RestyleFilePreview;
  previewUrl?: string;
  thumbnailUrl?: string;
  videoPair?: RestyleVideoPair | null;
  renderSegments: RestyleAttachment[];
  onRerunSegment: (segment: RestyleAttachment) => void;
  onRetrySegment: (segment: RestyleAttachment) => void;
  onReuploadSourceVideo: (attachment: RestyleAttachment) => void;
  onOpen: () => void;
  t: Translations;
}) {
  if (preview.kind === "attachment") {
    const isVideo = preview.attachment.type.startsWith("video/");
    const isDeadSourceVideo =
      isVideo &&
      !preview.attachment.generatedKind &&
      !preview.attachment.analysisFrame &&
      !previewUrl;
    if (videoPair) {
      return (
        <div className="space-y-3">
          <VideoComparePanel pair={videoPair} compact />
          <div>
            <p className="truncate text-sm font-medium text-text-primary">
              结果/成片/{preview.title}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {renderStatusLabel(preview.attachment.renderStatus)} ·{" "}
              {preview.attachment.renderProgress ?? 0}% ·{" "}
              {formatFileSize(preview.attachment.size) || "大小未知"}
            </p>
          </div>
          <RenderSegmentList
            segments={renderSegments}
            onRerunSegment={onRerunSegment}
            onRetrySegment={onRetrySegment}
            t={t}
          />
          <ReviewChecklist segments={renderSegments} onRerunSegment={onRerunSegment} />
          <button type="button" onClick={onOpen} className="btn-ghost !px-3 !py-2 text-xs">
            打开大预览
          </button>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={onOpen}
          className="grid aspect-video w-full place-items-center overflow-hidden rounded-lg border border-border bg-bg-elevated"
          aria-label={`打开预览：${preview.title}`}
        >
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : previewUrl && isVideo ? (
            <video
              src={previewUrl}
              className="h-full w-full object-cover"
              muted
              playsInline
              preload="metadata"
            />
          ) : previewUrl ? (
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <FileText size={26} className="text-text-muted" />
          )}
        </button>
        <div>
          <p className="truncate text-sm font-medium text-text-primary">{preview.title}</p>
          <p className="mt-1 text-xs text-text-muted">
            {isVideo ? "本地视频" : "本地文件"} ·{" "}
            {formatFileSize(preview.attachment.size) || "大小未知"}
          </p>
        </div>
        {isDeadSourceVideo ? (
          <p className="rounded-md border border-amber-300/70 bg-amber-50 px-2 py-1 text-[11px] leading-4 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
            本地预览已失效，渲染前需重新上传原视频换取持久链接。
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onOpen} className="btn-ghost !px-3 !py-2 text-xs">
            打开预览
          </button>
          {isDeadSourceVideo ? (
            <button
              type="button"
              onClick={() => onReuploadSourceVideo(preview.attachment)}
              className="btn-ghost !px-3 !py-2 text-xs text-accent"
            >
              {t.restyle_reupload_source_video}
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-bg-elevated p-3">
        <p className="truncate text-sm font-medium text-text-primary">{preview.title}</p>
        <p className="mt-1 text-xs text-text-muted">{preview.mime}</p>
      </div>
      <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-bg px-3 py-2 text-[11px] leading-5 text-text-secondary">
        {preview.content}
      </pre>
      <button type="button" onClick={onOpen} className="btn-ghost !px-3 !py-2 text-xs">
        打开预览
      </button>
    </div>
  );
}

function FilePreviewDialog({
  preview,
  previewUrl,
  thumbnailUrl,
  videoPair,
  renderSegments,
  onRerunSegment,
  onClose,
}: {
  preview: RestyleFilePreview;
  previewUrl?: string;
  thumbnailUrl?: string;
  videoPair?: RestyleVideoPair | null;
  renderSegments: RestyleAttachment[];
  onRerunSegment: (segment: RestyleAttachment) => void;
  onClose: () => void;
}) {
  const isAttachment = preview.kind === "attachment";
  const isVideo = isAttachment && preview.attachment.type.startsWith("video/");
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-primary">{preview.title}</p>
            <p className="mt-0.5 text-xs text-text-muted">
              {preview.kind === "virtual"
                ? preview.mime
                : `${isVideo ? "视频" : "附件"} · ${formatFileSize(preview.attachment.size) || "大小未知"}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-muted hover:bg-bg-elevated hover:text-text-primary"
            aria-label="关闭预览"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-bg p-4">
          {preview.kind === "virtual" ? (
            <pre className="min-h-[360px] whitespace-pre-wrap rounded-xl border border-border bg-bg-surface p-4 text-xs leading-6 text-text-secondary">
              {preview.content}
            </pre>
          ) : videoPair ? (
            <div className="mx-auto max-w-5xl">
              <VideoComparePanel pair={videoPair} />
              <div className="mt-4 rounded-xl border border-border bg-bg-surface p-4">
                <ReviewChecklist segments={renderSegments} onRerunSegment={onRerunSegment} />
              </div>
            </div>
          ) : previewUrl && isVideo ? (
            <video
              src={previewUrl}
              poster={thumbnailUrl}
              controls
              playsInline
              className="mx-auto max-h-[70vh] w-full rounded-xl bg-black object-contain"
            />
          ) : previewUrl ? (
            <img
              src={previewUrl}
              alt=""
              className="mx-auto max-h-[70vh] rounded-xl object-contain"
            />
          ) : (
            <div className="grid min-h-[360px] place-items-center rounded-xl border border-dashed border-border bg-bg-surface text-center">
              <div>
                <FileText className="mx-auto text-text-muted" size={30} />
                <p className="mt-3 text-sm text-text-secondary">{preview.title}</p>
                <p className="mt-1 text-xs text-text-muted">
                  本地预览已不可用，请重新上传文件后查看。
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VideoComparePanel({
  pair,
  compact = false,
}: {
  pair: RestyleVideoPair;
  compact?: boolean;
}) {
  const sourceRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef<HTMLVideoElement>(null);
  const syncingRef = useRef(false);
  const canPreview = Boolean(pair.sourceUrl && pair.resultUrl);

  function withSyncLock(action: () => void) {
    syncingRef.current = true;
    action();
    window.setTimeout(() => {
      syncingRef.current = false;
    }, 120);
  }

  function peersFor(video: HTMLVideoElement): HTMLVideoElement[] {
    return [sourceRef.current, resultRef.current].filter((item): item is HTMLVideoElement =>
      Boolean(item && item !== video),
    );
  }

  function playPair(anchor = sourceRef.current) {
    const source = anchor ?? sourceRef.current;
    if (!source) return;
    withSyncLock(() => {
      [sourceRef.current, resultRef.current].forEach((video) => {
        if (!video) return;
        video.currentTime = source.currentTime;
        video.playbackRate = source.playbackRate;
        void video.play().catch(() => {});
      });
    });
  }

  function pausePeers(anchor: HTMLVideoElement) {
    if (syncingRef.current) return;
    withSyncLock(() => {
      peersFor(anchor).forEach((video) => video.pause());
    });
  }

  function syncTime(anchor: HTMLVideoElement, force = false) {
    if (syncingRef.current) return;
    withSyncLock(() => {
      peersFor(anchor).forEach((video) => {
        if (force || Math.abs(video.currentTime - anchor.currentTime) > 0.35) {
          video.currentTime = anchor.currentTime;
        }
      });
    });
  }

  function syncRate(anchor: HTMLVideoElement) {
    if (syncingRef.current) return;
    withSyncLock(() => {
      peersFor(anchor).forEach((video) => {
        video.playbackRate = anchor.playbackRate;
      });
    });
  }

  function syncPlayEvent(anchor: HTMLVideoElement) {
    if (syncingRef.current) return;
    playPair(anchor);
  }

  function syncDrift(anchor: HTMLVideoElement) {
    if (syncingRef.current || anchor.paused) return;
    peersFor(anchor).forEach((video) => {
      if (Math.abs(video.currentTime - anchor.currentTime) > 0.45) {
        video.currentTime = anchor.currentTime;
      }
      if (video.paused) {
        void video.play().catch(() => {});
      }
    });
  }

  function handleSyncPlaybackClick() {
    const source = sourceRef.current;
    const result = resultRef.current;
    if (!source || !result) return;
    if (!source.paused || !result.paused) {
      withSyncLock(() => {
        source.pause();
        result.pause();
      });
      return;
    }
    playPair(source);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-text-muted">原片和转绘结果上下对比。</p>
        <button
          type="button"
          onClick={handleSyncPlaybackClick}
          disabled={!canPreview}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-text-secondary hover:bg-bg-elevated hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="同步播放"
        >
          <Play size={13} />
          同步播放
        </button>
      </div>
      <VideoCompareSlot
        label="原片"
        path={`原片/${pair.source.name}`}
        src={pair.sourceUrl}
        ref={sourceRef}
        compact={compact}
        onPlay={(event) => syncPlayEvent(event.currentTarget)}
        onPause={(event) => pausePeers(event.currentTarget)}
        onSeeked={(event) => syncTime(event.currentTarget, true)}
        onRateChange={(event) => syncRate(event.currentTarget)}
        onTimeUpdate={(event) => syncDrift(event.currentTarget)}
      />
      <VideoCompareSlot
        label="转绘结果"
        path={`结果/成片/${pair.result.name}`}
        src={pair.resultUrl}
        ref={resultRef}
        compact={compact}
        onPlay={(event) => syncPlayEvent(event.currentTarget)}
        onPause={(event) => pausePeers(event.currentTarget)}
        onSeeked={(event) => syncTime(event.currentTarget, true)}
        onRateChange={(event) => syncRate(event.currentTarget)}
        onTimeUpdate={(event) => syncDrift(event.currentTarget)}
      />
    </div>
  );
}

const VideoCompareSlot = forwardRef<
  HTMLVideoElement,
  {
    label: string;
    path: string;
    src?: string;
    compact?: boolean;
    onSeeked: ReactEventHandler<HTMLVideoElement>;
    onPlay: ReactEventHandler<HTMLVideoElement>;
    onPause: ReactEventHandler<HTMLVideoElement>;
    onRateChange: ReactEventHandler<HTMLVideoElement>;
    onTimeUpdate: ReactEventHandler<HTMLVideoElement>;
  }
>(({ label, path, src, compact, onSeeked, onPlay, onPause, onRateChange, onTimeUpdate }, ref) => (
  <div>
    <div className="mb-2 flex items-center justify-between gap-2 text-xs">
      <span className="font-semibold text-text-primary">{label}</span>
      <span className="truncate text-text-muted">{path}</span>
    </div>
    {src ? (
      <video
        ref={ref}
        src={src}
        controls
        playsInline
        preload="metadata"
        onPlay={onPlay}
        onPause={onPause}
        onSeeked={onSeeked}
        onRateChange={onRateChange}
        onTimeUpdate={onTimeUpdate}
        className={`w-full rounded-lg bg-black object-contain ${compact ? "max-h-44" : "max-h-[42vh]"}`}
      />
    ) : (
      <div
        className={`grid place-items-center rounded-lg border border-dashed border-border bg-bg-elevated text-center ${compact ? "min-h-32" : "min-h-56"}`}
      >
        <div className="px-4">
          <FileText className="mx-auto text-text-muted" size={26} />
          <p className="mt-2 text-xs text-text-secondary">本地视频预览已不可用</p>
        </div>
      </div>
    )}
  </div>
));
VideoCompareSlot.displayName = "VideoCompareSlot";

function RenderSegmentList({
  segments,
  onRerunSegment,
  onRetrySegment,
  t,
}: {
  segments: RestyleAttachment[];
  onRerunSegment: (segment: RestyleAttachment) => void;
  onRetrySegment: (segment: RestyleAttachment) => void;
  t: Translations;
}) {
  if (!segments.length) return null;
  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-2">
      <p className="mb-2 text-xs font-semibold text-text-primary">分段返工</p>
      <div className="space-y-1.5">
        {segments.map((segment) => (
          <div
            key={segment.id}
            className="flex items-center gap-2 rounded-md bg-bg-surface px-2 py-1.5 text-[11px]"
          >
            <span className="font-medium text-text-primary">
              {segment.episode} {segment.segmentId}
            </span>
            <span className="text-text-muted">{renderStatusLabel(segment.renderStatus)}</span>
            <span className="text-text-muted">{segment.renderProgress ?? 0}%</span>
            <span className="min-w-0 flex-1 truncate text-text-muted">
              {segment.renderLog?.at(-1) ??
                (segment.resultUrl
                  ? "结果 URL 已写入"
                  : segment.renderTaskId || segment.renderError || "等待任务")}
            </span>
            {segment.renderStatus === "failed" ? (
              <button
                type="button"
                onClick={() => onRetrySegment(segment)}
                className="shrink-0 rounded border border-border px-2 py-1 text-accent hover:bg-accent-dim"
              >
                {t.restyle_retry_render}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onRerunSegment(segment)}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-accent/50 bg-accent-dim px-2 py-1 text-accent transition hover:bg-accent/15"
            >
              <RotateCcw size={11} />
              重跑这一段
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewChecklist({
  segments,
  onRerunSegment,
}: {
  segments: RestyleAttachment[];
  onRerunSegment: (segment: RestyleAttachment) => void;
}) {
  const checks = ["角色一致性", "剧情还原度", "画面还原度", "音频与台词", "画面比例", "画面清洁度"];
  return (
    <div>
      <p className="text-xs font-semibold text-text-primary">成片验收清单</p>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {checks.map((check) => (
          <span
            key={check}
            className="inline-flex items-center gap-1.5 rounded-md bg-bg-elevated px-2 py-1 text-[11px] text-text-secondary"
          >
            <Check size={11} className="text-accent" />
            {check}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-5 text-text-muted">
        局部问题请点名集数和段落返工，例如“EP02 第3段人物不像 Grace Hart，请重跑这一段”。
      </p>
      {segments.length ? (
        <>
          <p className="mt-2 text-[11px] font-medium text-text-secondary">
            直接点击下面按钮即可对指定段落返工：
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {segments.map((segment) => (
              <button
                key={segment.id}
                type="button"
                onClick={() => onRerunSegment(segment)}
                className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-bg-base shadow-sm transition hover:opacity-90"
              >
                <RotateCcw size={12} />
                {segment.episode} {segment.segmentId} 返工
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function AssetFileGroup({
  label,
  assets,
  selectedAssetId,
  onSelect,
}: {
  label: string;
  assets: RestyleAsset[];
  selectedAssetId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 flex items-center gap-1.5 px-2 text-xs font-medium text-text-secondary">
        <ChevronDown size={13} />
        <Folder size={14} className="text-accent" />
        {label}
      </p>
      {assets.length ? (
        assets.map((asset) => (
          <button
            key={asset.id}
            type="button"
            onClick={() => onSelect(asset.id)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${selectedAssetId === asset.id ? "bg-accent-dim text-accent" : "text-text-secondary hover:bg-bg-elevated"}`}
          >
            <FileText size={13} />
            <span className="min-w-0 flex-1 truncate">{asset.name}</span>
          </button>
        ))
      ) : (
        <p className="px-2 py-1 text-xs text-text-muted">—</p>
      )}
    </div>
  );
}

function AttachmentPreview({
  attachment,
  previewUrl,
  thumbnailUrl,
  uploadState,
  uploadLabels,
  onRetryUpload,
  onRemove,
  removeLabel,
}: {
  attachment: RestyleAttachment;
  previewUrl?: string;
  thumbnailUrl?: string;
  uploadState?: DirectUploadState;
  uploadLabels?: { uploading: string; done: string; failed: string; retry: string };
  onRetryUpload?: () => void;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <div className="group relative w-20 overflow-hidden rounded-lg border border-border bg-bg-surface">
      <div className="grid h-16 place-items-center overflow-hidden bg-bg-elevated">
        {attachment.isFolder ? (
          <FolderOpen size={24} className="text-accent" />
        ) : thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : previewUrl && attachment.type.startsWith("video/") ? (
          <video src={previewUrl} className="h-full w-full object-cover" muted preload="metadata" />
        ) : previewUrl ? (
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <FileText size={22} className="text-text-muted" />
        )}
      </div>
      <p className="truncate px-1.5 py-1 text-[10px] text-text-primary">{attachment.name}</p>
      {uploadState && uploadLabels ? (
        <div className="px-1.5 pb-1" data-testid={`upload-state-${attachment.id}`}>
          {uploadState.status === "uploading" ? (
            <div>
              <div className="h-1 w-full overflow-hidden rounded bg-bg-elevated">
                <div
                  className="h-1 rounded bg-accent transition-all"
                  style={{ width: `${uploadState.progress}%` }}
                />
              </div>
              <p className="mt-0.5 text-[9px] text-text-muted">
                {uploadLabels.uploading} {uploadState.progress}%
              </p>
            </div>
          ) : uploadState.status === "done" ? (
            <p className="text-[9px] text-accent">{uploadLabels.done}</p>
          ) : (
            <button
              type="button"
              onClick={onRetryUpload}
              title={uploadState.error}
              className="text-[9px] text-destructive underline"
            >
              {uploadLabels.failed} · {uploadLabels.retry}
            </button>
          )}
        </div>
      ) : null}
      {attachment.isFolder && attachment.fileCount ? (
        <span className="absolute bottom-5 right-1 rounded bg-black/55 px-1 text-[9px] text-white">
          {attachment.fileCount}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"
        aria-label={removeLabel}
      >
        <X size={12} />
      </button>
    </div>
  );
}

function MessageAttachmentCard({
  attachment,
  previewUrl,
  thumbnailUrl,
  onOpen,
}: {
  attachment: RestyleAttachment;
  previewUrl?: string;
  thumbnailUrl?: string;
  onOpen: () => void;
}) {
  const isVideo = attachment.type.startsWith("video/");
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-44 overflow-hidden rounded-xl border border-border bg-bg-surface text-left shadow-card transition hover:border-accent/60 hover:shadow-lg"
      aria-label={`打开附件：${attachment.name}`}
      title={attachment.name}
    >
      <div className="grid aspect-video place-items-center overflow-hidden bg-bg-elevated">
        {attachment.isFolder ? (
          <FolderOpen size={26} className="text-accent" />
        ) : thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : previewUrl && isVideo ? (
          <video
            src={previewUrl}
            className="h-full w-full object-cover"
            muted
            playsInline
            preload="metadata"
          />
        ) : previewUrl ? (
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <FileText size={24} className="text-text-muted" />
        )}
      </div>
      <div className="space-y-0.5 px-2.5 py-2">
        <p className="truncate text-xs font-medium text-text-primary">{attachment.name}</p>
        <p className="text-[10px] text-text-muted">
          {attachment.isFolder && attachment.fileCount
            ? `${attachment.fileCount} 个文件`
            : isVideo
              ? "视频"
              : "附件"}
        </p>
      </div>
    </button>
  );
}

function AttachmentFileGroup({
  label,
  files,
  onRemove,
  removeLabel,
}: {
  label: string;
  files: RestyleAttachment[];
  onRemove: (fileId: string) => void;
  removeLabel: string;
}) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 flex items-center gap-1.5 px-2 text-xs font-medium text-text-secondary">
        <ChevronDown size={13} />
        <Folder size={14} className="text-accent" />
        {label}
      </p>
      {files.length ? (
        files.map((file) => (
          <div
            key={file.id}
            className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-bg-elevated"
          >
            <FileText size={13} />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <button
              type="button"
              onClick={() => onRemove(file.id)}
              className="grid h-5 w-5 place-items-center rounded text-text-muted opacity-0 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
              aria-label={removeLabel}
            >
              <X size={12} />
            </button>
          </div>
        ))
      ) : (
        <p className="px-2 py-1 text-xs text-text-muted">—</p>
      )}
    </div>
  );
}

function StagePanel({
  stage,
  assets,
  assetLibraryStatus,
  selectedAsset,
  setSelectedAssetId,
  activeProject,
  extractedAssets,
  onToggleAsset,
  onToggleAssetConfirmation,
  onSetStage,
  onRequestFiles,
  onPlanNoteChange,
  t,
}: {
  stage: RestyleStage;
  assets: RestyleAsset[];
  assetLibraryStatus: AssetLibraryStatus;
  selectedAsset?: RestyleAsset;
  setSelectedAssetId: (id: string) => void;
  activeProject?: RestyleProject;
  extractedAssets: RestyleExtractedAsset[];
  onToggleAsset: (assetId: string) => void;
  onToggleAssetConfirmation: (assetId: string) => void;
  onSetStage: (stage: RestyleStage) => void;
  onRequestFiles: () => void;
  onPlanNoteChange: (planNote: string) => void;
  t: Translations;
}) {
  if (stage === "upload")
    return (
      <div className="grid min-h-[250px] place-items-center rounded-xl border-2 border-dashed border-accent/35 bg-accent-dim/15 p-6 text-center">
        <div>
          <Upload className="mx-auto text-accent" size={24} />
          <p className="mt-3 text-sm text-text-secondary">{t.restyle_upload_empty}</p>
          <button type="button" onClick={onRequestFiles} className="btn-primary mt-4 text-sm">
            <Upload size={15} />
            {t.restyle_attach}
          </button>
        </div>
      </div>
    );
  if (stage === "analysis")
    return (
      <div className="space-y-4">
        <EmptyState text={t.restyle_analysis_empty} />
        <button
          type="button"
          onClick={() => onSetStage("assets")}
          disabled={!activeProject?.files.length}
          className="btn-primary text-sm"
        >
          {t.restyle_continue_to_assets}
        </button>
      </div>
    );
  if (stage === "assets")
    return (
      <div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">{t.restyle_stage_assets}</h2>
            <p className="mt-1 text-sm text-text-secondary">
              {extractedAssets.length
                ? activeProject?.analysisSummary || t.restyle_assets_description
                : t.restyle_assets_description}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onSetStage("plan")}
            disabled={!activeProject?.assetIds.length}
            className="btn-primary text-sm"
          >
            <Check size={15} />
            {t.restyle_confirm}
          </button>
        </div>
        {extractedAssets.length > 0 && <AssetConfirmationGuide t={t} />}
        {extractedAssets.length ? (
          <ExtractedAssetTable assets={extractedAssets} t={t} />
        ) : assetLibraryStatus === "loading" ? (
          <EmptyState text={t.restyle_assets_syncing} />
        ) : assets.length ? (
          <div className="mt-5 overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-[92px_minmax(130px,1fr)_minmax(160px,2fr)_88px] gap-3 border-b border-border bg-bg-elevated px-4 py-2 text-[11px] font-medium text-text-muted">
              <span>{t.restyle_asset_type}</span>
              <span>{t.restyle_assets}</span>
              <span>{t.restyle_asset_description}</span>
              <span>{t.restyle_asset_action}</span>
            </div>
            {assets.map((asset) => {
              const linked = activeProject
                ? isRestyleAssetLinked(asset.id, activeProject.assetIds)
                : false;
              const confirmed = activeProject?.confirmedAssetIds.includes(asset.id) ?? false;
              return (
                <div
                  key={asset.id}
                  onClick={() => setSelectedAssetId(asset.id)}
                  className={`grid w-full grid-cols-[92px_minmax(130px,1fr)_minmax(160px,2fr)_88px] items-center gap-3 border-b border-border px-4 py-3 text-left last:border-0 ${selectedAsset?.id === asset.id ? "bg-accent-dim/50" : "hover:bg-bg-elevated/70"}`}
                >
                  <span className="text-xs text-accent">
                    {asset.kind === "character"
                      ? t.restyle_assets_characters
                      : asset.kind === "scene"
                        ? t.restyle_assets_scenes
                        : t.restyle_assets_props}
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-8 w-8 shrink-0 overflow-hidden rounded-md">
                      <AssetVisual asset={asset} compact />
                    </span>
                    <span className="truncate text-sm font-medium text-text-primary">
                      {asset.name}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-xs leading-5 text-text-secondary">
                    {asset.detail}
                  </span>
                  <span className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleAsset(asset.id);
                      }}
                      className={`rounded-md border px-2 py-1 text-[11px] ${linked ? "border-accent/40 bg-accent-dim text-accent" : "border-border text-text-muted"}`}
                    >
                      {linked ? t.restyle_asset_linked : t.restyle_asset_link}
                    </button>
                    {linked && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleAssetConfirmation(asset.id);
                        }}
                        className={`grid h-6 w-6 place-items-center rounded-md ${confirmed ? "bg-emerald-500/15 text-emerald-400" : "bg-bg-elevated text-text-muted"}`}
                        aria-label={t.restyle_asset_confirm}
                      >
                        <Check size={14} />
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            text={assetLibraryStatus === "error" ? t.restyle_assets_error : t.restyle_empty_assets}
          />
        )}
      </div>
    );
  if (stage === "plan")
    return (
      <div>
        <label className="block text-sm font-medium text-text-primary">
          {t.restyle_plan_note}
          <textarea
            value={activeProject?.planNote ?? ""}
            onChange={(event) => onPlanNoteChange(event.target.value)}
            disabled={!activeProject}
            rows={5}
            className="mt-2 w-full resize-y rounded-xl border border-border bg-bg-elevated p-3 text-sm text-text-primary outline-none focus:border-accent"
            placeholder={t.restyle_plan_placeholder}
          />
        </label>
        <button
          type="button"
          onClick={() => onSetStage("render")}
          disabled={!activeProject?.confirmedAssetIds.length}
          className="btn-primary mt-4 text-sm"
        >
          {t.restyle_confirm}
        </button>
      </div>
    );
  return <EmptyState text={stage === "render" ? t.restyle_render_empty : t.restyle_review_empty} />;
}

/**
 * 把 Agent 的处理过程直接展示在对话流里：每个步骤的状态、耗时与停止入口。
 * 完成后自动折叠成一行摘要，点击可展开回看全部步骤。
 */
function RunProgressCard({
  run,
  t,
  onStop,
}: {
  run: RestyleRunState;
  t: Translations;
  onStop: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!run.running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run.running]);

  useEffect(() => {
    if (!run.running) setExpanded(false);
  }, [run.running]);

  const elapsed = Math.max(0, Math.round(((run.endedAt ?? now) - run.startedAt) / 1000));

  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-3" role="status">
      <div className="flex items-center gap-2">
        {run.running ? (
          <Loader2 size={14} className="animate-spin text-accent" />
        ) : (
          <Check size={14} className="text-accent" />
        )}
        <span className="text-sm font-medium text-text-primary">{t.restyle_run_process_title}</span>
        <span className="text-[11px] text-text-muted">
          {run.steps.length}
          {t.restyle_run_steps_count} · {t.restyle_run_elapsed} {elapsed}
          {t.restyle_run_seconds}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="rounded-md px-2 py-1 text-[11px] text-text-secondary hover:bg-bg"
          >
            {expanded ? t.restyle_run_collapse : t.restyle_run_expand}
          </button>
          {run.running ? (
            <button
              type="button"
              onClick={onStop}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg hover:text-destructive"
              aria-label={t.restyle_run_stop}
            >
              <Square size={11} fill="currentColor" />
              {t.restyle_run_stop}
            </button>
          ) : null}
        </div>
      </div>
      {expanded ? (
        <ol className="mt-2 space-y-1.5">
          {run.steps.map((step) => (
            <li key={step.id} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5">
                {step.status === "running" ? (
                  <Loader2 size={12} className="animate-spin text-accent" />
                ) : step.status === "failed" ? (
                  <X size={12} className="text-destructive" />
                ) : (
                  <Check size={12} className="text-accent" />
                )}
              </span>
              <span className="min-w-0">
                <span
                  className={step.status === "failed" ? "text-destructive" : "text-text-secondary"}
                >
                  {step.label}
                </span>
                {step.detail ? (
                  <span className="ml-1 text-text-muted">（{step.detail}）</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {run.stopped ? (
        <p className="mt-2 text-[11px] text-text-muted">{t.restyle_run_stopped_step}</p>
      ) : null}
    </div>
  );
}
