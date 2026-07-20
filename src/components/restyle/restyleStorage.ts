import type { RestyleStage } from "./restyleTypes";

const STORAGE_PREFIX = "doopoo:restyle-projects:";

export type RestyleAttachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  isFolder?: boolean;
  fileCount?: number;
};

export type RestyleMessage = {
  id: string;
  content: string;
  createdAt: string;
  attachments?: RestyleAttachment[];
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
      attachments: Array.isArray(message.attachments)
        ? message.attachments
            .map(parseAttachment)
            .filter((file): file is RestyleAttachment => Boolean(file))
        : undefined,
    }));
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
  const files = Array.isArray(item.files)
    ? item.files.map(parseAttachment).filter((file): file is RestyleAttachment => Boolean(file))
    : [];
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
    ...item,
    files,
    conversations: migratedConversations,
    activeConversationId:
      typeof item.activeConversationId === "string" &&
      migratedConversations.some((conversation) => conversation.id === item.activeConversationId)
        ? item.activeConversationId
        : (migratedConversations[0]?.id ?? null),
    planNote: typeof item.planNote === "string" ? item.planNote : "",
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
    window.localStorage.setItem(keyFor(userId), JSON.stringify(projects));
  } catch {
    // Local persistence is best-effort while the restyle database model is not connected.
  }
}
