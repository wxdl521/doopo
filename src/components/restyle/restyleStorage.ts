import type { RestyleStage } from "./restyleTypes";

const STORAGE_PREFIX = "doopoo:restyle-projects:";

export type RestyleRenderStatus = "queued" | "running" | "succeeded" | "failed";

export type RestyleAnalysisSections = {
  plot: string;
  videoUnderstanding: string;
  dialogue: string;
  assets: string;
};

export type RestyleAttachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  isFolder?: boolean;
  fileCount?: number;
  url?: string;
  generatedKind?: "character" | "scene" | "prop" | "video_clip" | "final_video";
  sourceAttachmentId?: string;
  episode?: string;
  segmentId?: string;
  renderTaskId?: string;
  renderStatus?: RestyleRenderStatus;
  renderProgress?: number;
  resultUrl?: string;
  renderError?: string;
  renderLog?: string[];
  rerunOfAttachmentId?: string;
  feedback?: string;
  /** The extracted asset this generated image represents. Keeps one canvas slot per asset. */
  sourceAssetId?: string;
  /** Exact prompt used for this generated asset; used by the canvas inspector. */
  prompt?: string;
  analysisFrame?: boolean;
  analysisEpisode?: string;
};

export type RestyleMessage = {
  id: string;
  content: string;
  createdAt: string;
  role?: "user" | "assistant";
  attachments?: RestyleAttachment[];
  assetTable?: RestyleExtractedAsset[];
  assetCategoryLinks?: Array<"character" | "scene" | "prop">;
  episodeLinks?: string[];
  finalEpisodeLinks?: string[];
};

export type RestyleExtractedAsset = {
  id: string;
  kind: "character" | "scene" | "prop";
  sourceName: string;
  sourceDescription: string;
  targetName: string;
  targetDescription: string;
  importance: "required" | "optional";
  shouldRestyle: boolean;
};

export type RestylePlanEpisode = {
  episode: string;
  segments: Array<{ id: string; prompt: string }>;
};

export type RestyleConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: RestyleMessage[];
};

export type RestyleProject = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  stage: RestyleStage;
  assetIds: string[];
  confirmedAssetIds: string[];
  files: RestyleAttachment[];
  conversations: RestyleConversation[];
  activeConversationId: string | null;
  planNote: string;
  /** 用户描述的目标画风，所有资产图与方案提示词都必须沿用。 */
  styleBrief?: string;
  extractedAssets: RestyleExtractedAsset[];
  analysisSummary: string;
  analysisSections?: Record<string, RestyleAnalysisSections>;
  planEpisodes?: RestylePlanEpisode[];
  imageModel?: string;
  videoModel?: string;
};

function keyFor(userId: string): string {
  return STORAGE_PREFIX + userId;
}

function isStage(value: unknown): value is RestyleStage {
  return (
    value === "upload" ||
    value === "analysis" ||
    value === "assets" ||
    value === "plan" ||
    value === "render" ||
    value === "review"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRenderStatus(value: unknown): value is RestyleRenderStatus {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed";
}

function parseAttachment(value: unknown): RestyleAttachment | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<RestyleAttachment>;
  if (typeof item.id !== "string" || typeof item.name !== "string") return null;
  return {
    id: item.id,
    name: item.name,
    size: typeof item.size === "number" ? item.size : 0,
    type: typeof item.type === "string" ? item.type : "",
    lastModified: typeof item.lastModified === "number" ? item.lastModified : 0,
    isFolder: item.isFolder === true,
    fileCount: typeof item.fileCount === "number" ? item.fileCount : undefined,
    url: typeof item.url === "string" ? item.url : undefined,
    generatedKind: ["character", "scene", "prop", "video_clip", "final_video"].includes(
      item.generatedKind ?? "",
    )
      ? (item.generatedKind as RestyleAttachment["generatedKind"])
      : undefined,
    sourceAttachmentId:
      typeof item.sourceAttachmentId === "string" ? item.sourceAttachmentId : undefined,
    episode: typeof item.episode === "string" ? item.episode : undefined,
    segmentId: typeof item.segmentId === "string" ? item.segmentId : undefined,
    renderTaskId: typeof item.renderTaskId === "string" ? item.renderTaskId : undefined,
    renderStatus: isRenderStatus(item.renderStatus) ? item.renderStatus : undefined,
    renderProgress: typeof item.renderProgress === "number" ? item.renderProgress : undefined,
    resultUrl: typeof item.resultUrl === "string" ? item.resultUrl : undefined,
    renderError: typeof item.renderError === "string" ? item.renderError : undefined,
    renderLog: Array.isArray(item.renderLog)
      ? item.renderLog.filter((entry): entry is string => typeof entry === "string").slice(-80)
      : undefined,
    rerunOfAttachmentId:
      typeof item.rerunOfAttachmentId === "string" ? item.rerunOfAttachmentId : undefined,
    feedback: typeof item.feedback === "string" ? item.feedback : undefined,
    sourceAssetId: typeof item.sourceAssetId === "string" ? item.sourceAssetId : undefined,
    prompt: typeof item.prompt === "string" ? item.prompt : undefined,
    analysisFrame: item.analysisFrame === true,
    analysisEpisode: typeof item.analysisEpisode === "string" ? item.analysisEpisode : undefined,
  };
}

function parseMessages(value: unknown): RestyleMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (message): message is RestyleMessage =>
        Boolean(message) &&
        typeof message === "object" &&
        typeof (message as RestyleMessage).id === "string" &&
        typeof (message as RestyleMessage).content === "string" &&
        typeof (message as RestyleMessage).createdAt === "string",
    )
    .map((message) => ({
      ...message,
      role: message.role === "assistant" ? "assistant" : "user",
      attachments: Array.isArray(message.attachments)
        ? message.attachments
            .map(parseAttachment)
            .filter((file): file is RestyleAttachment => Boolean(file))
        : undefined,
      assetTable: Array.isArray(message.assetTable)
        ? parseExtractedAssets(message.assetTable)
        : undefined,
      assetCategoryLinks: Array.isArray(message.assetCategoryLinks)
        ? message.assetCategoryLinks.filter((kind): kind is "character" | "scene" | "prop" =>
            ["character", "scene", "prop"].includes(kind as string),
          )
        : undefined,
      episodeLinks: Array.isArray(message.episodeLinks)
        ? message.episodeLinks.filter((episode): episode is string => typeof episode === "string")
        : undefined,
      finalEpisodeLinks: Array.isArray(message.finalEpisodeLinks)
        ? message.finalEpisodeLinks.filter(
            (episode): episode is string => typeof episode === "string",
          )
        : undefined,
    }));
}

function parseExtractedAssets(value: unknown): RestyleExtractedAsset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((asset) => {
    if (!asset || typeof asset !== "object") return [];
    const item = asset as Partial<RestyleExtractedAsset>;
    if (
      typeof item.id !== "string" ||
      !["character", "scene", "prop"].includes(item.kind ?? "") ||
      typeof item.sourceName !== "string" ||
      typeof item.sourceDescription !== "string" ||
      typeof item.targetName !== "string" ||
      typeof item.targetDescription !== "string" ||
      !["required", "optional"].includes(item.importance ?? "") ||
      typeof item.shouldRestyle !== "boolean"
    ) {
      return [];
    }
    return [item as RestyleExtractedAsset];
  });
}

function parseProject(value: unknown): RestyleProject | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<RestyleProject>;
  if (
    typeof item.id !== "string" ||
    typeof item.title !== "string" ||
    typeof item.createdAt !== "string" ||
    typeof item.updatedAt !== "string" ||
    !isStage(item.stage) ||
    !isStringArray(item.assetIds) ||
    !isStringArray(item.confirmedAssetIds)
  ) {
    return null;
  }
  const rawFiles = Array.isArray(item.files)
    ? item.files.map(parseAttachment).filter((file): file is RestyleAttachment => Boolean(file))
    : [];
  const sourceEpisodeById = new Map<string, string>();
  let sourceVideoIndex = 0;
  const files = rawFiles
    .map((file) => {
      if (!file.type.startsWith("video/") || file.isFolder || file.generatedKind) return file;
      const episode = file.episode ?? `EP${String(++sourceVideoIndex).padStart(2, "0")}`;
      sourceEpisodeById.set(file.id, episode);
      sourceEpisodeById.set(file.episode ?? file.id, episode);
      return { ...file, episode };
    })
    .map((file) => {
      const episode = file.episode
        ? (sourceEpisodeById.get(file.episode) ?? file.episode)
        : undefined;
      return episode && file.episode !== episode ? { ...file, episode } : file;
    });
  const planEpisodes = Array.isArray(item.planEpisodes)
    ? item.planEpisodes.flatMap((episode) => {
        if (!episode || typeof episode !== "object") return [];
        const item = episode as Partial<RestylePlanEpisode>;
        if (typeof item.episode !== "string" || !Array.isArray(item.segments)) return [];
        const segments = item.segments.flatMap((segment) => {
          if (!segment || typeof segment !== "object") return [];
          const value = segment as { id?: unknown; prompt?: unknown };
          return typeof value.id === "string" && typeof value.prompt === "string"
            ? [{ id: value.id, prompt: value.prompt }]
            : [];
        });
        return [{ episode: sourceEpisodeById.get(item.episode) ?? item.episode, segments }];
      })
    : undefined;
  const analysisSections =
    item.analysisSections && typeof item.analysisSections === "object"
      ? Object.fromEntries(
          Object.entries(item.analysisSections).flatMap(([episode, value]) => {
            if (!value || typeof value !== "object") return [];
            const section = value as Partial<RestyleAnalysisSections>;
            return [
              [
                episode,
                {
                  plot: typeof section.plot === "string" ? section.plot : "",
                  videoUnderstanding:
                    typeof section.videoUnderstanding === "string"
                      ? section.videoUnderstanding
                      : "",
                  dialogue: typeof section.dialogue === "string" ? section.dialogue : "",
                  assets: typeof section.assets === "string" ? section.assets : "",
                },
              ],
            ];
          }),
        )
      : undefined;
  const conversations = Array.isArray(item.conversations)
    ? item.conversations
        .filter(
          (conversation): conversation is RestyleConversation =>
            Boolean(conversation) &&
            typeof conversation === "object" &&
            typeof (conversation as RestyleConversation).id === "string" &&
            typeof (conversation as RestyleConversation).title === "string" &&
            typeof (conversation as RestyleConversation).createdAt === "string" &&
            typeof (conversation as RestyleConversation).updatedAt === "string",
        )
        .map((conversation) => ({
          ...conversation,
          messages: parseMessages(conversation.messages),
        }))
    : [];
  const legacyMessages = parseMessages((item as { messages?: unknown }).messages);
  const migratedConversations =
    conversations.length || !legacyMessages.length
      ? conversations
      : [
          {
            id: `${item.id}:legacy`,
            title: "",
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            messages: legacyMessages,
          },
        ];
  return {
    id: item.id,
    title: item.title,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    stage: item.stage,
    assetIds: item.assetIds,
    confirmedAssetIds: item.confirmedAssetIds,
    files,
    conversations: migratedConversations,
    activeConversationId:
      typeof item.activeConversationId === "string" &&
      migratedConversations.some((conversation) => conversation.id === item.activeConversationId)
        ? item.activeConversationId
        : (migratedConversations[0]?.id ?? null),
    planNote: typeof item.planNote === "string" ? item.planNote : "",
    styleBrief: typeof item.styleBrief === "string" ? item.styleBrief : "",
    extractedAssets: parseExtractedAssets(item.extractedAssets),
    analysisSummary: typeof item.analysisSummary === "string" ? item.analysisSummary : "",
    analysisSections,
    planEpisodes,
    imageModel: typeof item.imageModel === "string" ? item.imageModel : undefined,
    videoModel: typeof item.videoModel === "string" ? item.videoModel : undefined,
  };
}

export function loadRestyleProjects(userId: string | null | undefined): RestyleProject[] {
  if (!userId || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseProject)
      .filter((project): project is RestyleProject => Boolean(project));
  } catch {
    return [];
  }
}

export function saveRestyleProjects(
  userId: string | null | undefined,
  projects: RestyleProject[],
): void {
  if (!userId || typeof window === "undefined") return;
  try {
    // Browser object URLs and extracted keyframe data URLs cannot survive a refresh and can
    // exceed localStorage's quota. Persist the workflow state, not transient preview bytes.
    const sanitizeAttachment = (file: RestyleAttachment): RestyleAttachment => {
      const transientUrl = (url: string | undefined) =>
        Boolean(url && (url.startsWith("blob:") || url.startsWith("data:")));
      return {
        ...file,
        url: transientUrl(file.url) ? undefined : file.url,
        resultUrl: transientUrl(file.resultUrl) ? undefined : file.resultUrl,
      };
    };
    const durableProjects = projects.map((project) => ({
      ...project,
      files: project.files.filter((file) => !file.analysisFrame).map(sanitizeAttachment),
      conversations: project.conversations.map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => ({
          ...message,
          attachments: message.attachments?.map(sanitizeAttachment),
        })),
      })),
    }));
    window.localStorage.setItem(keyFor(userId), JSON.stringify(durableProjects));
  } catch {
    // Local persistence is best-effort while the restyle database model is not connected.
  }
}
