import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
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
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useLanguage } from "../../i18n/LanguageContext";
import type { Translations } from "../../i18n/zh";
import { useAuth } from "../../hooks/useAuth";
import { loadCharacters, loadProps, loadScenes } from "../../lib/assetsStorage";
import { libraryAssetsFromRows } from "./restyleAssetLibrary";
import {
  loadRestyleProjects,
  saveRestyleProjects,
  type RestyleAttachment,
  type RestyleConversation,
  type RestyleExtractedAsset,
  type RestyleProject,
} from "./restyleStorage";
import type { RestyleAsset, RestyleStage } from "./restyleTypes";
import { analyzeRestyleAssets, generateRestylePlan } from "../../lib/restyleAnalysis.functions";
import { generateImage, generateImageWithReferences } from "../../lib/seedream.functions";
import { realImageModelOptions, realVideoModels } from "../NewProjectDialog";

type AssetLibraryStatus = "idle" | "loading" | "ready" | "error";
type RestyleView = "workbench" | "canvas";
const RESTYLE_MODELS = [
  { id: "ark:deepseek-v4-pro-260425", label: "DeepSeek V4 Pro" },
  { id: "qwen:qwen3.6-plus", label: "Qwen 3.6 Plus · 视觉" },
  { id: "qwen:qwen3.6-flash", label: "Qwen 3.6 Flash · 视觉" },
  { id: "qwen:qwen3.7-max", label: "Qwen 3.7 Max" },
] as const;

type RestyleModel = (typeof RESTYLE_MODELS)[number]["id"];
type RestyleFilePreview =
  | {
      kind: "attachment";
      key: string;
      title: string;
      attachment: RestyleAttachment;
    }
  | {
      kind: "virtual";
      key: string;
      title: string;
      mime: "application/json" | "text/markdown" | "text/plain";
      content: string;
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

function formatFileSize(size?: number): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function countTreeLeaves(nodes: RestyleFileTreeNode[] = []): number {
  return nodes.reduce(
    (total, node) =>
      total + (node.kind === "file" ? 1 : countTreeLeaves(node.children ?? [])),
    0,
  );
}

function makeVirtualPreview(
  key: string,
  title: string,
  mime: "application/json" | "text/markdown" | "text/plain",
  content: string,
): Extract<RestyleFilePreview, { kind: "virtual" }> {
  return { kind: "virtual", key, title, mime, content };
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

function waitForVideoEvent(video: HTMLVideoElement, event: "loadedmetadata" | "seeked"): Promise<void> {
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

/** Extract up to four lightweight stills locally; the original video is never put in localStorage. */
async function extractVideoKeyFrames(file: File): Promise<string[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "metadata";
  video.src = url;
  try {
    await waitForVideoEvent(video, "loadedmetadata");
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.videoWidth <= 0) return [];
    const scale = Math.min(1, 960 / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return [];
    const positions = [...new Set([0.02, 0.28, 0.55, 0.82].map((ratio) => Math.max(0.05, video.duration * ratio)))];
    const frames: string[] = [];
    for (const position of positions) {
      video.currentTime = Math.min(position, Math.max(0, video.duration - 0.05));
      await waitForVideoEvent(video, "seeked");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL("image/jpeg", 0.62);
      if (image.length <= 1_400_000) frames.push(image);
    }
    return frames;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
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
    video.currentTime = Math.min(Math.max(0.05, video.duration * 0.08), Math.max(0, video.duration - 0.05));
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
  const sourceFiles = files.filter((file) => !file.generatedKind && !file.analysisFrame && !file.isFolder);
  const folders = files.filter((file) => !file.generatedKind && !file.analysisFrame && file.isFolder);
  const byEpisode = new Map<string, RestyleAttachment[]>();
  sourceFiles.forEach((file) => {
    const match = file.name.match(/ep\s*0*(\d+)/i);
    const episode = `EP${String(match ? Number(match[1]) : 1).padStart(2, "0")}`;
    byEpisode.set(episode, [...(byEpisode.get(episode) ?? []), file]);
  });
  const fileNode = (file: RestyleAttachment): RestyleFileTreeNode => ({
    id: `source/${file.id}`,
    label: file.name,
    kind: "file" as const,
    size: file.size,
    preview: { kind: "attachment" as const, key: `attachment:${file.id}`, title: file.name, attachment: file },
  });
  return [
    ...Array.from(byEpisode.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([episode, episodeFiles]) => ({
      id: `source/${episode}`,
      label: episode,
      kind: "folder" as const,
      count: episodeFiles.length,
      children: episodeFiles.map(fileNode),
    })),
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

function buildRestyleFileTree(
  project: RestyleProject | undefined,
  linkedAssets: RestyleAsset[],
  t: Translations,
): RestyleFileTreeNode[] {
  const extractedAssets = project?.extractedAssets ?? [];
  const sourceChildren = groupedAttachmentNodes(project?.files ?? []);
  const generatedFiles = (project?.files ?? []).filter((file) => file.generatedKind && file.url);
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
  const sourceEpisodes = groupedAttachmentNodes(project?.files ?? []).filter((node) => node.label.match(/^EP\d+$/));
  const frameFiles = (project?.files ?? []).filter((file) => file.analysisFrame && file.url);
  const analysisChildren = extractedAssets.length
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
          count: 5,
          children: [
            {
              id: `analysis/${episode.label}/抽帧`,
              label: "抽帧",
              kind: "folder" as const,
              count: frameFiles.filter((file) => file.analysisEpisode === episode.label).length,
              children: frameFiles.filter((file) => file.analysisEpisode === episode.label).map((file) => ({ id: `analysis/${episode.label}/抽帧/${file.id}`, label: file.name, kind: "file" as const, size: file.size, preview: { kind: "attachment" as const, key: `attachment:${file.id}`, title: file.name, attachment: file } })),
            },
            ...["剧情", "视觉理解", "台词", "资产"].map((label) => ({ id: `analysis/${episode.label}/${label}`, label, kind: "folder" as const, count: 0, children: [] })),
          ],
        })),
      ]
    : [];
  const planChildren = extractedAssets.length
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
  const episodePlanNodes = (project?.planEpisodes ?? []).map((plan) => {
    const episode = plan.episode;
    return {
      id: `plan/${episode}`,
      label: episode,
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
                return { id: promptPreview.key, label: promptPreview.title, kind: "file" as const, size: promptPreview.content.length, preview: promptPreview };
              }),
            },
          ],
        },
      ],
    };
  });
  if (episodePlanNodes.length) {
    planChildren.push(...episodePlanNodes);
  }
  const resultChildren = [
    { id: "results/final", label: "成片", kind: "folder" as const, count: 0, children: [] },
    { id: "results/clips", label: "视频片段", kind: "folder" as const, count: 0, children: [] },
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
  const [chatDraft, setChatDraft] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [canvasKind, setCanvasKind] = useState<RestyleAsset["kind"] | "all">("all");
  const [canvasPrompt, setCanvasPrompt] = useState("");
  const [assetPickerFor, setAssetPickerFor] = useState<string | null>(null);
  const [assetPickerKind, setAssetPickerKind] = useState<RestyleAsset["kind"] | null>(null);
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });
  const canvasDragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [draftAttachmentIds, setDraftAttachmentIds] = useState<string[]>([]);
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
  const [selectedModel, setSelectedModel] = useState<RestyleModel>("qwen:qwen3.6-plus");
  const [selectedImageModel, setSelectedImageModel] = useState(
    realImageModelOptions[0]?.id ?? "doubao-seedream-5-0-260128",
  );
  const [selectedVideoModel, setSelectedVideoModel] = useState(
    realVideoModels[0]?.id ?? "doubao-seedance-2-0-260128",
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileObjectsRef = useRef<Record<string, File>>({});
  const callAnalyzeRestyleAssets = useServerFn(analyzeRestyleAssets);
  const callGenerateRestylePlan = useServerFn(generateRestylePlan);
  const callGenerateImage = useServerFn(generateImage);

  const activeProject = projects.find((project) => project.id === activeProjectId);
  const activeConversation = activeProject?.conversations.find(
    (conversation) => conversation.id === activeProject?.activeConversationId,
  );
  const draftAttachments =
    activeProject?.files.filter((file) => draftAttachmentIds.includes(file.id)) ?? [];
  const imageDraftAttachments = draftAttachments.filter((file) => file.type.startsWith("image/"));
  const imageMentionQuery = chatDraft.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/);
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
    () => assets.filter((asset) => activeProject?.assetIds.includes(asset.id)),
    [activeProject?.assetIds, assets],
  );
  const projectFileTree = useMemo(
    () => buildRestyleFileTree(activeProject, linkedProjectAssets, t),
    [activeProject, linkedProjectAssets, t],
  );

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

  useEffect(() => {
    if (!activeProject) return;
    if (activeProject.imageModel) setSelectedImageModel(activeProject.imageModel);
    if (activeProject.videoModel) setSelectedVideoModel(activeProject.videoModel);
  }, [activeProjectId]);

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
    setProjects((current) => current.filter((project) => project.id !== projectId));
    if (activeProjectId === projectId) setActiveProjectId(null);
  }

  function toggleAsset(assetId: string) {
    if (!activeProject) return;
    updateProject(activeProject.id, (project) => {
      const linked = project.assetIds.includes(assetId);
      return {
        ...project,
        assetIds: linked
          ? project.assetIds.filter((id) => id !== assetId)
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

  function attachFiles(files: FileList | null, isFolder = false) {
    if (!files?.length) return;
    const project = activeProject ?? createProjectRecord();
    if (!activeProject) {
      setProjects((current) => [project, ...current]);
      setActiveProjectId(project.id);
    }
    const selectedFiles = Array.from(files);
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
    setDraftAttachmentIds((current) => [
      ...current,
      ...attachments.map((attachment) => attachment.id),
    ]);
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
    delete fileObjectsRef.current[fileId];
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
    },
  ) {
    updateProject(projectId, (project) => ({
      ...project,
      conversations: project.conversations.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              title:
                conversation.title || message.content.slice(0, 32) || message.attachments?.[0]?.name || "",
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
        : URL.createObjectURL(new Blob([preview.content], { type: preview.mime }));
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

  function reorderProjectFile(targetFileId: string) {
    if (!activeProject || !draggedFileId || draggedFileId === targetFileId) return;
    updateProject(activeProject.id, (project) => {
      const fromIndex = project.files.findIndex((file) => file.id === draggedFileId);
      const toIndex = project.files.findIndex((file) => file.id === targetFileId);
      if (fromIndex < 0 || toIndex < 0) return project;
      const files = [...project.files];
      const [moved] = files.splice(fromIndex, 1);
      files.splice(toIndex, 0, moved);
      return { ...project, files };
    });
    setDraggedFileId(null);
  }

  function insertImageMention(imageIndex: number) {
    setChatDraft((current) => current.replace(/(^|\s)@[a-zA-Z0-9_]*$/, `$1@image${imageIndex + 1} `));
  }

  function getRequestedAssetKinds(message: string): Array<"character" | "scene" | "prop"> {
    const kinds: Array<"character" | "scene" | "prop"> = [];
    if (/角色|人物|人像/.test(message)) kinds.push("character");
    if (/场景|环境|背景/.test(message)) kinds.push("scene");
    if (/道具|物件/.test(message)) kinds.push("prop");
    return kinds;
  }

  async function sendChatMessage() {
    if (!activeProject || !activeConversation) return;
    const message = chatDraft.trim();
    const attachments = activeProject.files.filter((file) => draftAttachmentIds.includes(file.id));
    const referenceAttachments = attachments.filter((file) => file.type.startsWith("image/"));
    const projectVideoFiles = activeProject.files.filter((file) => file.type.startsWith("video/"));
    if (!message && !attachments.length) return;
    const projectId = activeProject.id;
    const conversationId = activeConversation.id;
    const analysisInstruction = message || "请分析上传的视频，提取真正需要转绘的具体角色、场景和道具。";
    const messageAttachments =
      attachments.length || activeProject.extractedAssets.length ? attachments : projectVideoFiles;
    appendConversationMessage(projectId, conversationId, {
      content: message,
      role: "user",
      attachments: messageAttachments,
    });
    setChatDraft("");
    setDraftAttachmentIds([]);

    if (message === "确认" && activeProject.extractedAssets.length > 0) {
      setIsAnalyzing(true);
      const sourceFiles = activeProject.files.filter((file) => file.type.startsWith("video/") && !file.isFolder);
      const episodeCount = sourceFiles.length || 1;
      const result = await callGenerateRestylePlan({
        data: {
          model: selectedModel,
          instruction: activeProject.planNote,
          sourceFiles: (sourceFiles.length ? sourceFiles : activeProject.files).map(({ name, type, size }) => ({ name, type, size })),
          assets: activeProject.extractedAssets.map(({ id: _id, ...asset }) => asset),
          episodeCount,
        },
      });
      if (!result.ok) {
        setIsAnalyzing(false);
        appendConversationMessage(projectId, conversationId, { role: "assistant", content: `转绘方案生成失败：${result.error}` });
        return;
      }
      const episodeLinks = result.episodes.map((episode) => episode.episode);
      updateProject(projectId, (project) => ({ ...project, stage: "plan", planEpisodes: result.episodes }));
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: `已确认资产图片，已生成 ${episodeLinks.join("、")} 的转绘方案。点击集数可展开右侧对应目录，提示词位于“提示词/final”文件夹内。需要微调时，请直接说明集数和分段，例如“请将 EP01 的 U01 光影调整为冷白色调”。调整完成后回复“确认生成视频”。`,
        episodeLinks,
      });
      setIsAnalyzing(false);
      return;
    }

    if (activeProject.stage === "plan" && /EP\d+|U\d+|提示词|光影|镜头|台词|节奏/.test(message)) {
      setIsAnalyzing(true);
      const sourceFiles = activeProject.files.filter((file) => file.type.startsWith("video/") && !file.isFolder);
      const result = await callGenerateRestylePlan({
        data: {
          model: selectedModel,
          instruction: message,
          sourceFiles: (sourceFiles.length ? sourceFiles : activeProject.files).map(({ name, type, size }) => ({ name, type, size })),
          assets: activeProject.extractedAssets.map(({ id: _id, ...asset }) => asset),
          episodeCount: activeProject.planEpisodes?.length || sourceFiles.length || 1,
          existingEpisodes: activeProject.planEpisodes ?? [],
        },
      });
      if (result.ok) {
        updateProject(projectId, (project) => ({ ...project, planEpisodes: result.episodes, stage: "plan" }));
        appendConversationMessage(projectId, conversationId, {
          role: "assistant",
          content: `已根据你的要求更新方案：${result.episodes.map((episode) => `${episode.episode}（${episode.segments.length} 段）`).join("、")}。请点击右侧提示词文件检查修改结果。`,
          episodeLinks: result.episodes.map((episode) => episode.episode),
        });
      } else {
        appendConversationMessage(projectId, conversationId, { role: "assistant", content: `提示词修改失败：${result.error}` });
      }
      setIsAnalyzing(false);
      return;
    }

    const generatedAssetFiles = activeProject.files.filter((file) => file.generatedKind && file.url);
    const requestedAssetKinds = getRequestedAssetKinds(message);
    const isAssetImageRequest =
      activeProject.extractedAssets.length > 0 &&
      (/全部由\s*AI\s*生成|生成(?:全部|这些|资产)?(?:图片|图)|生图/i.test(message) ||
        (requestedAssetKinds.length > 0 && /生成|图片|图/.test(message)) ||
        (generatedAssetFiles.length > 0 && /修改|调整|请将|变得|改成|换成/i.test(message)));
    if (isAssetImageRequest) {
      const mentionedImages = message.match(/@image(\d+)/gi)?.map((mention) => Number(mention.replace(/\D/g, "")) - 1) ?? [];
      const uploadedReferenceImages = (await Promise.all(
        referenceAttachments
          .filter((_file, index) => !mentionedImages.length || mentionedImages.includes(index))
          .map((file) => {
            const local = fileObjectsRef.current[file.id];
            return local ? fileToDataUrl(local) : Promise.resolve(file.url ?? "");
          }),
      )).filter(Boolean);
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
      const requestedAssets = requestedAssetKinds.length
        ? activeProject.extractedAssets.filter((asset) => requestedAssetKinds.includes(asset.kind))
        : activeProject.extractedAssets;
      if (!requestedAssets.length) {
        appendConversationMessage(projectId, conversationId, {
          role: "assistant",
          content: "当前资产表中没有匹配的角色、场景或道具，暂不生成图片。",
        });
        return;
      }
      await generateAssetImages(projectId, conversationId, message, requestedAssets, referenceImages);
      return;
    }

    const selectedVideoFiles = attachments.filter((file) => file.type.startsWith("video/"));
    const sourceFiles = selectedVideoFiles.length ? selectedVideoFiles : projectVideoFiles;
    if (!sourceFiles.length) return;

    updateProject(projectId, (project) => ({ ...project, stage: "analysis" }));
    setIsAnalyzing(true);
    setAnalysisError("");
    try {
      const frameFile = sourceFiles
        .map((file) => fileObjectsRef.current[file.id])
        .find((file): file is File => Boolean(file));
      const frameImages = frameFile ? await extractVideoKeyFrames(frameFile).catch(() => []) : [];
      const result = await callAnalyzeRestyleAssets({
        data: {
          instruction: analysisInstruction,
          model: selectedModel,
          sourceFiles: sourceFiles.map(({ name, type, size }) => ({ name, type, size })),
          frameImages,
          existingAssets: activeProject.extractedAssets.map(({ id: _id, ...asset }) => asset),
        },
      });
      if (!result.ok) {
        setAnalysisError(result.error);
        appendConversationMessage(projectId, conversationId, {
          role: "assistant",
          content: `${t.restyle_analysis_failed} ${result.error}`,
        });
        return;
      }
      const extractedAssets: RestyleExtractedAsset[] = result.assets.map((asset) => ({
        id: crypto.randomUUID(),
        ...asset,
      }));
      const episodeMatch = sourceFiles[0]?.name.match(/ep\s*0*(\d+)/i);
      const analysisEpisode = `EP${String(episodeMatch ? Number(episodeMatch[1]) : 1).padStart(2, "0")}`;
      const frameAttachments: RestyleAttachment[] = frameImages.map((url, index) => ({
        id: crypto.randomUUID(),
        name: `${analysisEpisode}_frame_${String(index + 1).padStart(2, "0")}.jpg`,
        size: Math.round(url.length * 0.75),
        type: "image/jpeg",
        lastModified: Date.now(),
        url,
        analysisFrame: true,
        analysisEpisode,
      }));
      updateProject(projectId, (project) => ({
        ...project,
        stage: "assets",
        extractedAssets,
        analysisSummary: result.summary,
        confirmedAssetIds: [],
        files: [...project.files.filter((file) => !file.analysisFrame), ...frameAttachments],
      }));
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: `${result.summary}${result.usedFrames ? ` ${t.restyle_frames_analyzed}` : ""}`,
        assetTable: extractedAssets,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : t.restyle_analysis_unknown_error;
      setAnalysisError(detail);
      appendConversationMessage(projectId, conversationId, {
        role: "assistant",
        content: `${t.restyle_analysis_failed} ${detail}`,
      });
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function generateAssetImages(
    projectId: string,
    conversationId: string,
    instruction: string,
    extractedAssets: RestyleExtractedAsset[],
    referenceImages: string[] = [],
  ) {
    setIsAnalyzing(true);
    setAnalysisError("");
    const categoryLinks = [...new Set(extractedAssets.map((asset) => asset.kind))];
    appendConversationMessage(projectId, conversationId, {
      role: "assistant",
      content: "开始生成资产图片，将按角色、场景、道具逐张处理。",
      assetCategoryLinks: categoryLinks,
    });
    try {
      for (const asset of extractedAssets) {
        const prompt = [
          `为转绘项目生成一张${asset.kind === "character" ? "角色" : asset.kind === "scene" ? "场景" : "道具"}资产图。`,
          `资产名称：${asset.targetName || asset.sourceName}`,
          `原片定位：${asset.sourceDescription}`,
          `目标设定：${asset.targetDescription}`,
          "请只生成该单一资产，不要添加无关人物、场景或道具。",
          `用户要求：${instruction}`,
        ].join("\n");
        const result = referenceImages.length
          ? await callGenerateImageWithReferences({
              data: { prompt, model: selectedImageModel, size: "2K", referenceImages },
            })
          : await callGenerateImage({ data: { prompt, model: selectedImageModel, size: "2K" } });
        if (!result.url) {
          appendConversationMessage(projectId, conversationId, {
            role: "assistant",
            content: `资产图片生成失败：${asset.targetName || asset.sourceName}。${result.error || "请稍后重试。"}`,
          });
          continue;
        }
        const attachment: RestyleAttachment = {
          id: crypto.randomUUID(),
          name: `${asset.kind}_${(asset.targetName || asset.sourceName).replace(/[^\w\u4e00-\u9fff-]+/g, "_")}.png`,
          size: 0,
          type: "image/png",
          lastModified: Date.now(),
          url: result.url,
          generatedKind: asset.kind,
        };
        updateProject(projectId, (project) => ({
          ...project,
          stage: "review",
          files: [...project.files, attachment],
        }));
        appendConversationMessage(projectId, conversationId, {
          role: "assistant",
          content: `已生成：${asset.targetName || asset.sourceName}`,
          attachments: [attachment],
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setAnalysisError(`资产图片生成失败：${detail}`);
    } finally {
      setIsAnalyzing(false);
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
      assetIds: project.assetIds.includes(assetId) ? project.assetIds : [...project.assetIds, assetId],
    }));
    setAssetPickerFor(null);
    setAssetPickerKind(null);
  }

  function updateExtractedAssets(mutator: (assets: RestyleExtractedAsset[]) => RestyleExtractedAsset[]) {
    if (!activeProject) return;
    updateProject(activeProject.id, (project) => {
      const extractedAssets = mutator(project.extractedAssets);
      return {
        ...project,
        extractedAssets,
        confirmedAssetIds: project.confirmedAssetIds.filter((id) => extractedAssets.some((asset) => asset.id === id)),
        conversations: project.conversations.map((conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) => (message.assetTable ? { ...message, assetTable: extractedAssets } : message)),
        })),
      };
    });
  }

  function addExtractedAsset() {
    const sourceName = window.prompt("请输入资产名称");
    if (!sourceName?.trim()) return;
    const kindInput = window.prompt("请输入类型：角色、场景或道具", "场景")?.trim();
    const kind: RestyleExtractedAsset["kind"] = kindInput === "角色" ? "character" : kindInput === "道具" ? "prop" : "scene";
    const sourceDescription = window.prompt("请输入原片定位", "用户补充的具体资产") || "用户补充的具体资产";
    const targetName = window.prompt("请输入目标名称", sourceName) || sourceName;
    const targetDescription = window.prompt("请输入目标设定", sourceDescription) || sourceDescription;
    updateExtractedAssets((assets) => [...assets, { id: crypto.randomUUID(), kind, sourceName: sourceName.trim(), sourceDescription, targetName, targetDescription, importance: "optional", shouldRestyle: true }]);
  }

  if (view === "canvas") {
    const canvasAssets = canvasKind === "all" ? assets : assets.filter((asset) => asset.kind === canvasKind);
    const canvasSelectedAsset = selectedAsset && canvasAssets.some((asset) => asset.id === selectedAsset.id)
      ? selectedAsset
      : canvasAssets[0];
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
            <p className="mb-2 text-xs font-semibold text-text-primary">资产</p>
            {(["all", "character", "scene", "prop"] as const).map((kind) => (
              <button key={kind} type="button" onClick={() => setCanvasKind(kind)} className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs ${canvasKind === kind ? "bg-accent-dim text-accent" : "text-text-secondary hover:bg-bg-elevated"}`}>
                <span>{kind === "all" ? "全部资产" : kind === "character" ? "角色" : kind === "scene" ? "场景" : "道具"}</span>
                <span>{kind === "all" ? assets.length : assets.filter((asset) => asset.kind === kind).length}</span>
              </button>
            ))}
            <div className="mt-4 space-y-1 border-t border-border pt-3">
              {canvasAssets.map((asset) => (
                <button key={asset.id} type="button" onClick={() => { setSelectedAssetId(asset.id); setCanvasPrompt(asset.detail); }} className={`w-full truncate rounded-lg px-3 py-2 text-left text-xs ${canvasSelectedAsset?.id === asset.id ? "bg-bg-elevated text-text-primary" : "text-text-muted hover:bg-bg-elevated"}`}>{asset.name}</button>
              ))}
            </div>
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-2 px-3 text-[11px] font-semibold text-text-muted">视频分集</p>
              {canvasEpisodes.map((episode) => <button key={episode} type="button" onClick={() => expandFileTreePath(`plan/${episode}`)} className="mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-text-secondary hover:bg-bg-elevated"><span className="text-accent">▣</span>{episode}</button>)}
            </div>
          </aside>
          <div
            className="relative min-h-[620px] overflow-hidden rounded-xl border border-border bg-[radial-gradient(var(--border-color)_1px,transparent_1px)] bg-[size:16px_16px]"
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest("button")) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              canvasDragRef.current = { x: event.clientX, y: event.clientY, offsetX: canvasOffset.x, offsetY: canvasOffset.y };
            }}
            onPointerMove={(event) => {
              const drag = canvasDragRef.current;
              if (!drag) return;
              setCanvasOffset({ x: drag.offsetX + event.clientX - drag.x, y: drag.offsetY + event.clientY - drag.y });
            }}
            onPointerUp={(event) => {
              canvasDragRef.current = null;
              event.currentTarget.releasePointerCapture?.(event.pointerId);
            }}
            onPointerCancel={() => { canvasDragRef.current = null; }}
          >
            <div className="absolute left-4 top-4 z-10 rounded-lg border border-border bg-bg-surface/95 px-3 py-2 text-xs text-text-muted">引用资产 <span className="ml-1 text-accent">{canvasAssets.length}</span></div>
            <div className="absolute inset-0" style={{ transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${zoom / 100})`, transformOrigin: "0 0" }}>
            <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-40" aria-hidden="true">
              {canvasAssets.slice(0, 8).map((asset, index) => <line key={asset.id} x1={`${230 + index * 95}px`} y1="180" x2="78%" y2={`${150 + index * 38}px`} stroke="currentColor" strokeDasharray="5 5" />)}
            </svg>
            <div className="absolute left-8 right-[28%] top-24 flex flex-wrap gap-4">
              {canvasAssets.slice(0, 12).map((asset) => (
                <button key={asset.id} type="button" onClick={() => { setSelectedAssetId(asset.id); setCanvasPrompt(asset.detail); }} className={`w-[132px] overflow-hidden rounded-lg border bg-bg-surface text-left shadow-xl ${canvasSelectedAsset?.id === asset.id ? "border-accent ring-2 ring-accent/30" : "border-border"}`}>
                  <div className="relative h-24 overflow-hidden"><AssetVisual asset={asset} compact /><span className="absolute left-2 top-2 rounded bg-bg/80 px-1.5 py-0.5 text-[9px] text-text-primary">{asset.kind === "character" ? "角色" : asset.kind === "scene" ? "场景" : "道具"}</span></div>
                  <p className="truncate px-2 py-2 text-[11px] font-medium text-text-primary">{asset.name}</p>
                </button>
              ))}
            </div>
            <div className="absolute right-5 top-24 w-[150px] space-y-3">
              {canvasEpisodes.length ? canvasEpisodes.map((episode) => <button key={episode} type="button" className="w-full rounded-lg border border-border bg-bg-surface p-2 text-left shadow-xl" onClick={() => { expandFileTreePath("plan"); expandFileTreePath(`plan/${episode}`); }}><p className="text-[10px] text-text-muted">视频</p><p className="mt-1 text-xs font-semibold text-text-primary">{episode}</p><p className="mt-1 text-[10px] text-text-muted">{activeProject?.planEpisodes?.find((item) => item.episode === episode)?.segments.length ?? 0} 段</p></button>) : <div className="rounded-lg border border-dashed border-border p-3 text-[10px] text-text-muted">方案生成后显示每集视频</div>}
            </div>
            </div>
            <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-bg-surface/95 px-3 py-2 shadow-xl">
              <button type="button" onClick={() => setZoom(Math.max(50, zoom - 15))} className="rounded px-2 text-sm text-text-secondary">−</button><span className="min-w-10 text-center text-xs text-text-primary">{zoom}%</span><button type="button" onClick={() => setZoom(Math.min(150, zoom + 15))} className="rounded px-2 text-sm text-text-secondary">+</button><span className="mx-1 h-4 w-px bg-border" /><button type="button" onClick={() => { setZoom(100); setCanvasOffset({ x: 0, y: 0 }); }} className="rounded px-2 text-xs text-text-secondary">重置</button><button type="button" onClick={() => document.documentElement.requestFullscreen?.()} className="rounded px-2 text-xs text-text-secondary">全屏</button>
            </div>
          </div>
          <aside className="rounded-xl border border-border bg-bg-surface p-4">
            <p className="text-xs text-text-muted">资产编辑</p>
            {canvasSelectedAsset ? <>
              <h2 className="mt-1 font-semibold text-text-primary">{canvasSelectedAsset.name}</h2>
              <p className="mt-3 text-xs leading-5 text-text-secondary">{canvasSelectedAsset.detail}</p>
              <label className="mt-4 block text-xs text-text-muted">生成/修改提示词<textarea value={canvasPrompt || canvasSelectedAsset.detail} onChange={(event) => setCanvasPrompt(event.target.value)} rows={7} className="mt-2 w-full resize-y rounded-lg border border-border bg-bg-elevated p-3 text-xs leading-5 text-text-primary outline-none focus:border-accent" /></label>
              <button type="button" disabled={isAnalyzing || !activeProject || !activeConversation} onClick={() => activeProject && activeConversation && generateAssetImages(activeProject.id, activeConversation.id, canvasPrompt || canvasSelectedAsset.detail, [activeProject.extractedAssets.find((asset) => asset.targetName === canvasSelectedAsset.name) ?? { id: canvasSelectedAsset.id, kind: canvasSelectedAsset.kind, sourceName: canvasSelectedAsset.name, sourceDescription: canvasSelectedAsset.detail, targetName: canvasSelectedAsset.name, targetDescription: canvasPrompt || canvasSelectedAsset.detail, importance: "required", shouldRestyle: true }])} className="btn-primary mt-4 w-full text-xs">{isAnalyzing ? "生成中…" : "生成新版本"}</button>
            </> : <p className="mt-3 text-sm text-text-secondary">请选择一个资产开始编辑。</p>}
          </aside>
        </div>
      </section>
    );
  }

  return (
    <section
      className="flex h-[100dvh] min-h-[640px] flex-col overflow-hidden bg-bg"
      data-testid="restyle-workbench"
    >
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[232px_minmax(0,1fr)_310px]">
        {assetPickerFor || assetPickerKind ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6" role="dialog" aria-modal="true">
            <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-bg-surface shadow-2xl">
              <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-semibold text-text-primary">从资产库选择</h2><p className="mt-1 text-xs text-text-muted">选择后绑定到当前项目，并可作为参考图使用。</p></div><button type="button" onClick={() => { setAssetPickerFor(null); setAssetPickerKind(null); }} className="text-text-muted hover:text-text-primary"><X size={18} /></button></div>
              <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto p-5 sm:grid-cols-3">
                {assets.filter((asset) => asset.kind === (assetPickerKind ?? activeProject?.extractedAssets.find((item) => item.id === assetPickerFor)?.kind)).map((asset) => (
                  <button key={asset.id} type="button" onClick={() => linkLibraryAsset(asset.id)} className="overflow-hidden rounded-xl border border-border text-left hover:border-accent"><div className="aspect-[4/3] overflow-hidden"><AssetVisual asset={asset} compact /></div><div className="p-2"><p className="truncate text-xs font-medium text-text-primary">{asset.name}</p><p className="truncate text-[10px] text-text-muted">{asset.role}</p></div></button>
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
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
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
              {(activeConversation?.messages ?? []).map((message) => (
                <div key={message.id} className={message.role === "assistant" ? "space-y-3" : "flex flex-col items-end"}>
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
                            onClick={() => {
                              expandFileTreePath("results");
                              expandFileTreePath("results/assets");
                              expandFileTreePath(`results/assets/${kind}`);
                            }}
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
                          onClick={() => {
                            expandFileTreePath("plan");
                            expandFileTreePath(`plan/${episode}`);
                            expandFileTreePath(`plan/${episode}/提示词`);
                            expandFileTreePath(`plan/${episode}/提示词/final`);
                          }}
                          className="rounded-md px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-dim"
                        >
                          {episode}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {message.content ? (
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-6 ${message.role === "assistant" ? "rounded-bl-md border border-border bg-bg-surface text-text-secondary" : "rounded-br-md bg-accent text-bg"}`}
                    >
                      {message.content}
                    </div>
                  ) : null}
                  {message.assetTable?.length ? (
                    <div className="w-full rounded-2xl border border-border bg-bg-surface p-3 shadow-card">
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-text-primary">
                        <FileText size={14} className="text-accent" />
                        {t.restyle_stage_assets}
                      </div>
                      <ExtractedAssetTable
                        assets={message.assetTable}
                        t={t}
                        linkedAssetIds={activeProject?.assetIds ?? []}
                        onChooseLibraryAsset={setAssetPickerFor}
                        onDeleteAsset={(assetId) => updateExtractedAssets((assets) => assets.filter((asset) => asset.id !== assetId))}
                        onAddAsset={addExtractedAsset}
                      />
                      <ImageGenerationModeGuide t={t} />
                    </div>
                  ) : null}
                </div>
              ))}
              {isAnalyzing && (
                <div className="flex items-center gap-2 text-sm text-text-secondary" role="status">
                  <Loader2 size={15} className="animate-spin text-accent" />
                  {t.restyle_analysis_running}
                </div>
              )}
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
            <div className="mx-auto max-w-4xl rounded-xl border border-border bg-bg-elevated p-2 focus-within:border-accent">
              {draftAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 px-1 pb-2">
                  {draftAttachments.map((attachment) => (
                    <AttachmentPreview
                      key={attachment.id}
                      attachment={attachment}
                      previewUrl={filePreviews[attachment.id] ?? attachment.url}
                      thumbnailUrl={fileThumbnails[attachment.id]}
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
                  {imageMentionQuery && imageDraftAttachments.length ? (
                    <div className="absolute bottom-10 left-0 z-30 w-full max-w-md rounded-xl border border-border bg-bg-surface p-1.5 shadow-2xl">
                      {imageDraftAttachments.map((attachment, index) => (
                        <button
                          key={attachment.id}
                          type="button"
                          onClick={() => insertImageMention(index)}
                          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-bg-elevated"
                        >
                          <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md bg-bg-elevated text-text-muted">
                            {filePreviews[attachment.id] ? (
                              <img src={filePreviews[attachment.id]} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <FileText size={14} />
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-text-primary">@image{index + 1}</span>
                            <span className="block truncate text-xs text-text-muted">{attachment.name}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <textarea
                    value={chatDraft}
                    onChange={(event) => setChatDraft(event.target.value)}
                    placeholder={
                      activeProject?.extractedAssets.length
                        ? t.restyle_chat_feedback_placeholder
                        : t.restyle_chat_placeholder
                    }
                    rows={1}
                    className="max-h-24 min-h-8 w-full resize-none bg-transparent py-1.5 text-sm text-text-primary outline-none placeholder:text-text-muted"
                  />
                </div>
              </div>
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
                  {realImageModelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
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
                  {realVideoModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
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
                >
                  {RESTYLE_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={!activeConversation || isAnalyzing}
                  className="btn-primary !h-8 !w-8 !justify-center !rounded-lg !p-0"
                  aria-label={t.restyle_send}
                >
                  {isAnalyzing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                </button>
              </div>
            </div>
          </form>
        </main>

        <aside className="hidden min-h-0 flex-col border-l border-border bg-bg-surface xl:flex">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <FolderOpen size={16} className="text-accent" />
              <h2 className="text-sm font-semibold text-text-primary">{t.restyle_project_files}</h2>
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
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {activeProject ? (
              <div>
                <div className="mb-2 flex items-center gap-2 px-1 text-xs">
                  <span className="truncate font-semibold text-text-primary">{activeProject.title}</span>
                  <span className="shrink-0 text-[11px] text-accent">跟转绘步骤一一对应</span>
                </div>
                <ProjectFileTree
                  nodes={projectFileTree}
                  closedPaths={closedFileTreePaths}
                  selectedPreviewKey={selectedFilePreview?.key ?? ""}
                  onToggleFolder={toggleFileTreePath}
                  onOpenFile={openFilePreview}
                  onDragFile={setDraggedFileId}
                  onDropFile={reorderProjectFile}
                  onContextMenu={(event, preview) => {
                    event.preventDefault();
                    setFileContextMenu({ x: event.clientX, y: event.clientY, preview });
                  }}
                  onContextMenuFolder={() => undefined}
                  onChooseFolderAsset={(node) => {
                    const kind = node.id.match(/^results\/assets\/(character|scene|prop)$/)?.[1] as RestyleAsset["kind"] | undefined;
                    if (kind) setAssetPickerKind(kind);
                  }}
                />
              </div>
            ) : (
              <p className="px-2 py-4 text-xs leading-5 text-text-muted">{t.restyle_select_project_hint}</p>
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
              {selectedFilePreview ? (
              <FilePreviewInspector
                preview={selectedFilePreview}
                previewUrl={
                  selectedFilePreview.kind === "attachment"
                    ? filePreviews[selectedFilePreview.attachment.id] ?? selectedFilePreview.attachment.url
                    : undefined
                }
                thumbnailUrl={
                  selectedFilePreview.kind === "attachment"
                    ? fileThumbnails[selectedFilePreview.attachment.id]
                    : undefined
                }
                onOpen={() => setPreviewDialog(selectedFilePreview)}
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
        {fileContextMenu ? (
          <div
            className="fixed z-[60] min-w-36 rounded-lg border border-border bg-bg-surface p-1 shadow-2xl"
            style={{ left: fileContextMenu.x, top: fileContextMenu.y }}
            role="menu"
            onMouseLeave={() => setFileContextMenu(null)}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => downloadFilePreview(fileContextMenu.preview)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
            >
              <Download size={14} /> 下载文件
            </button>
            {fileContextMenu.preview.kind === "attachment" ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => deleteFilePreview(fileContextMenu.preview)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/10"
              >
                <Trash2 size={14} /> 删除文件
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {previewDialog ? (
        <FilePreviewDialog
          preview={previewDialog}
          previewUrl={
            previewDialog.kind === "attachment"
              ? filePreviews[previewDialog.attachment.id] ?? previewDialog.attachment.url
              : undefined
          }
          thumbnailUrl={
            previewDialog.kind === "attachment"
              ? fileThumbnails[previewDialog.attachment.id]
              : undefined
          }
          onClose={() => setPreviewDialog(null)}
        />
      ) : null}
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
  onDropFile: (fileId: string) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, preview: RestyleFilePreview) => void;
  onContextMenuFolder: (event: ReactMouseEvent<HTMLButtonElement>, node: RestyleFileTreeNode) => void;
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
          closedPaths={closedPaths}
          selectedPreviewKey={selectedPreviewKey}
          onToggleFolder={onToggleFolder}
          onOpenFile={onOpenFile}
          onDragFile={onDragFile}
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
  closedPaths,
  selectedPreviewKey,
  onToggleFolder,
  onOpenFile,
  onDragFile,
  onDropFile,
  onContextMenu,
  onContextMenuFolder,
  onChooseFolderAsset,
}: {
  node: RestyleFileTreeNode;
  depth: number;
  closedPaths: string[];
  selectedPreviewKey: string;
  onToggleFolder: (path: string) => void;
  onOpenFile: (preview: RestyleFilePreview) => void;
  onDragFile: (fileId: string | null) => void;
  onDropFile: (fileId: string) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, preview: RestyleFilePreview) => void;
  onContextMenuFolder: (event: ReactMouseEvent<HTMLButtonElement>, node: RestyleFileTreeNode) => void;
  onChooseFolderAsset: (node: RestyleFileTreeNode) => void;
}) {
  const isFolder = node.kind === "folder";
  const isOpen = isFolder && !closedPaths.includes(node.id);
  const selected = Boolean(node.preview && node.preview.key === selectedPreviewKey);
  const label = isFolder ? `切换文件夹：${node.label}` : `预览文件：${node.label}`;
  return (
    <div>
      <button
        type="button"
        draggable={Boolean(node.preview?.kind === "attachment")}
        onDragStart={(event) => {
          if (node.preview?.kind !== "attachment") return;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", node.preview.attachment.id);
          onDragFile(node.preview.attachment.id);
        }}
        onDragEnd={() => onDragFile(null)}
        onDragOver={(event) => {
          if (node.preview?.kind === "attachment") {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }
        }}
        onDrop={(event) => {
          if (node.preview?.kind === "attachment") {
            event.preventDefault();
            onDropFile(node.preview.attachment.id);
          }
        }}
        onClick={() => {
          if (isFolder) onToggleFolder(node.id);
          else if (node.preview) onOpenFile(node.preview);
        }}
        onContextMenu={(event) => {
          if (node.preview) onContextMenu(event, node.preview);
          else if (isFolder) onContextMenuFolder(event, node);
        }}
        className={`flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-xs ${selected ? "bg-bg-elevated text-text-primary" : "text-text-secondary hover:bg-bg-elevated/70 hover:text-text-primary"}`}
        style={{ paddingLeft: depth * 16 + 4 }}
        aria-label={label}
        aria-expanded={isFolder ? isOpen : undefined}
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
            onClick={(event) => { event.stopPropagation(); onChooseFolderAsset(node); }}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onChooseFolderAsset(node); } }}
          >
            <Upload size={12} />
          </span>
        ) : null}
        <span className="shrink-0 text-[11px] text-text-muted">
          {isFolder ? (node.count ?? countTreeLeaves(node.children)) || "" : formatFileSize(node.size)}
        </span>
      </button>
      {isFolder && isOpen && node.children?.length ? (
        <div>
          {node.children.map((child) => (
            <ProjectFileTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              closedPaths={closedPaths}
              selectedPreviewKey={selectedPreviewKey}
              onToggleFolder={onToggleFolder}
              onOpenFile={onOpenFile}
              onDragFile={onDragFile}
              onDropFile={onDropFile}
              onContextMenu={onContextMenu}
              onContextMenuFolder={onContextMenuFolder}
              onChooseFolderAsset={onChooseFolderAsset}
            />
          ))}
        </div>
      ) : null}
      {isFolder && isOpen && !node.children?.length ? (
        <p className="px-2 py-1 text-xs text-text-muted" style={{ paddingLeft: (depth + 1) * 16 + 22 }}>
          —
        </p>
      ) : null}
    </div>
  );
}

function FilePreviewInspector({
  preview,
  previewUrl,
  thumbnailUrl,
  onOpen,
}: {
  preview: RestyleFilePreview;
  previewUrl?: string;
  thumbnailUrl?: string;
  onOpen: () => void;
}) {
  if (preview.kind === "attachment") {
    const isVideo = preview.attachment.type.startsWith("video/");
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
            <video src={previewUrl} className="h-full w-full object-cover" muted playsInline preload="metadata" />
          ) : previewUrl ? (
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <FileText size={26} className="text-text-muted" />
          )}
        </button>
        <div>
          <p className="truncate text-sm font-medium text-text-primary">{preview.title}</p>
          <p className="mt-1 text-xs text-text-muted">
            {isVideo ? "本地视频" : "本地文件"} · {formatFileSize(preview.attachment.size) || "大小未知"}
          </p>
        </div>
        <button type="button" onClick={onOpen} className="btn-ghost !px-3 !py-2 text-xs">
          打开预览
        </button>
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
  onClose,
}: {
  preview: RestyleFilePreview;
  previewUrl?: string;
  thumbnailUrl?: string;
  onClose: () => void;
}) {
  const isAttachment = preview.kind === "attachment";
  const isVideo = isAttachment && preview.attachment.type.startsWith("video/");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true">
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
          ) : previewUrl && isVideo ? (
            <video
              src={previewUrl}
              poster={thumbnailUrl}
              controls
              playsInline
              className="mx-auto max-h-[70vh] w-full rounded-xl bg-black object-contain"
            />
          ) : previewUrl ? (
            <img src={previewUrl} alt="" className="mx-auto max-h-[70vh] rounded-xl object-contain" />
          ) : (
            <div className="grid min-h-[360px] place-items-center rounded-xl border border-dashed border-border bg-bg-surface text-center">
              <div>
                <FileText className="mx-auto text-text-muted" size={30} />
                <p className="mt-3 text-sm text-text-secondary">{preview.title}</p>
                <p className="mt-1 text-xs text-text-muted">本地预览已不可用，请重新上传文件后查看。</p>
              </div>
            </div>
          )}
        </div>
      </div>
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
  onRemove,
  removeLabel,
}: {
  attachment: RestyleAttachment;
  previewUrl?: string;
  thumbnailUrl?: string;
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
          <video src={previewUrl} className="h-full w-full object-cover" muted playsInline preload="metadata" />
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

function ExtractedAssetTable({
  assets,
  t,
  linkedAssetIds,
  onChooseLibraryAsset,
  onDeleteAsset,
  onAddAsset,
}: {
  assets: RestyleExtractedAsset[];
  t: Translations;
  linkedAssetIds: string[];
  onChooseLibraryAsset: (assetId: string) => void;
  onDeleteAsset: (assetId: string) => void;
  onAddAsset: () => void;
}) {
  const kindLabel = (kind: RestyleExtractedAsset["kind"]) =>
    kind === "character"
      ? t.restyle_assets_characters
      : kind === "scene"
        ? t.restyle_assets_scenes
        : t.restyle_assets_props;

  return (
    <div className="mt-5 overflow-x-auto rounded-xl border border-border">
      <div className="min-w-[1040px] overflow-hidden">
        <div className="grid grid-cols-[64px_minmax(140px,1fr)_minmax(180px,1.4fr)_minmax(140px,1fr)_minmax(190px,1.5fr)_112px] gap-3 border-b border-border bg-bg-elevated px-4 py-2 text-[11px] font-medium text-text-muted">
          <span>{t.restyle_asset_type}</span>
          <span>{t.restyle_asset_source_name}</span>
          <span>{t.restyle_asset_source_description}</span>
          <span>{t.restyle_asset_target_name}</span>
          <span>{t.restyle_asset_target_description}</span>
          <span>资产库</span>
          <button type="button" onClick={onAddAsset} className="flex items-center gap-1 text-accent hover:text-text-primary"><Plus size={12} />新增</button>
        </div>
        {assets.map((asset) => {
          return (
            <div
              key={asset.id}
              className="grid grid-cols-[64px_minmax(140px,1fr)_minmax(180px,1.4fr)_minmax(140px,1fr)_minmax(190px,1.5fr)_150px] gap-3 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-bg-elevated/70"
            >
              <span className="text-xs text-accent">{kindLabel(asset.kind)}</span>
              <span className="text-sm font-medium text-text-primary">
                {asset.sourceName}
              </span>
              <span className="text-xs leading-5 text-text-secondary">{asset.sourceDescription}</span>
              <span className="text-sm font-medium text-text-primary">{asset.targetName}</span>
              <span className="text-xs leading-5 text-text-secondary">
                {asset.targetDescription}
                {!asset.shouldRestyle && (
                  <span className="mt-1 block text-[10px] text-text-muted">{t.restyle_asset_keep_original}</span>
                )}
              </span>
              <span className="flex items-start gap-1.5">
                <button type="button" onClick={() => onChooseLibraryAsset(asset.id)} className="h-fit rounded-md border border-border px-2 py-1 text-[11px] text-accent hover:bg-accent-dim">{linkedAssetIds.length ? "选择/更换" : "选择资产"}</button>
                <button type="button" onClick={() => onDeleteAsset(asset.id)} className="grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-destructive/10 hover:text-destructive" aria-label={`删除资产：${asset.sourceName}`}><Trash2 size={13} /></button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ImageGenerationModeGuide({ t }: { t: Translations }) {
  return (
    <div className="mt-4 rounded-xl border border-accent/20 bg-accent-dim/15 p-3 text-xs leading-5 text-text-secondary">
      <p className="font-medium text-text-primary">{t.restyle_image_generation_title}</p>
      <p className="mt-1">{t.restyle_image_generation_ai}</p>
      <p>{t.restyle_image_generation_reference}</p>
      <p className="text-text-muted">{t.restyle_image_generation_example}</p>
    </div>
  );
}

function AssetConfirmationGuide({ t }: { t: Translations }) {
  return (
    <div className="mt-4 rounded-xl border border-accent/20 bg-accent-dim/20 p-3 text-sm text-text-secondary">
      <p className="font-medium text-text-primary">{t.restyle_assets_confirmation_intro}</p>
      <ul className="mt-2 grid gap-1 pl-4 text-xs leading-5 sm:grid-cols-2">
        <li>{t.restyle_assets_check_characters}</li>
        <li>{t.restyle_assets_check_scenes}</li>
        <li>{t.restyle_assets_check_props}</li>
        <li>{t.restyle_assets_check_market}</li>
      </ul>
      <p className="mt-2 text-xs leading-5">
        {t.restyle_assets_feedback_hint} <span className="text-text-muted">{t.restyle_assets_feedback_example}</span>
      </p>
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
              {extractedAssets.length ? activeProject?.analysisSummary || t.restyle_assets_description : t.restyle_assets_description}
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
          <ExtractedAssetTable
            assets={extractedAssets}
            confirmedAssetIds={activeProject?.confirmedAssetIds ?? []}
            onToggleConfirmation={onToggleAssetConfirmation}
            t={t}
          />
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
              const linked = activeProject?.assetIds.includes(asset.id) ?? false;
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
