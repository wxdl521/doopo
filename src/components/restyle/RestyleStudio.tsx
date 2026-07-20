import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  LayoutGrid,
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
  type RestyleProject,
} from "./restyleStorage";
import type { RestyleAsset, RestyleStage } from "./restyleTypes";

type AssetLibraryStatus = "idle" | "loading" | "ready" | "error";
type RestyleView = "workbench" | "canvas";
const stageOrder: RestyleStage[] = ["upload", "analysis", "assets", "plan", "render", "review"];

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
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [draftAttachmentIds, setDraftAttachmentIds] = useState<string[]>([]);
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const stageLabels: Record<RestyleStage, string> = {
    upload: t.restyle_stage_upload,
    analysis: t.restyle_stage_analysis,
    assets: t.restyle_stage_assets,
    plan: t.restyle_stage_plan,
    render: t.restyle_stage_render,
    review: t.restyle_stage_review,
  };
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const activeConversation = activeProject?.conversations.find(
    (conversation) => conversation.id === activeProject?.activeConversationId,
  );
  const draftAttachments =
    activeProject?.files.filter((file) => draftAttachmentIds.includes(file.id)) ?? [];
  const stage = activeProject?.stage ?? "upload";
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

  function createLocalProject() {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const conversation = createConversation(now);
    const project: RestyleProject = {
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
    };
    setProjects((current) => [project, ...current]);
    setActiveProjectId(id);
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
    if (!activeProject?.assetIds.includes(assetId)) return;
    updateProject(activeProject.id, (project) => ({
      ...project,
      confirmedAssetIds: project.confirmedAssetIds.includes(assetId)
        ? project.confirmedAssetIds.filter((id) => id !== assetId)
        : [...project.confirmedAssetIds, assetId],
    }));
  }

  function attachFiles(files: FileList | null, isFolder = false) {
    if (!activeProject || !files?.length) return;
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
    setFilePreviews((current) => ({ ...current, ...previews }));
    updateProject(activeProject.id, (project) => ({
      ...project,
      files: [...project.files, ...attachments],
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
    setDraftAttachmentIds((current) => current.filter((id) => id !== fileId));
    updateProject(activeProject.id, (project) => ({
      ...project,
      files: project.files.filter((file) => file.id !== fileId),
    }));
  }

  function sendChatMessage() {
    if (!activeProject || !activeConversation) return;
    const message = chatDraft.trim();
    const attachments = activeProject.files.filter((file) => draftAttachmentIds.includes(file.id));
    if (!message && !attachments.length) return;
    updateProject(activeProject.id, (project) => ({
      ...project,
      conversations: project.conversations.map((conversation) =>
        conversation.id === activeConversation.id
          ? {
              ...conversation,
              title: conversation.title || message.slice(0, 32) || attachments[0]?.name || "",
              updatedAt: new Date().toISOString(),
              messages: [
                ...conversation.messages,
                {
                  id: crypto.randomUUID(),
                  content: message,
                  createdAt: new Date().toISOString(),
                  attachments,
                },
              ],
            }
          : conversation,
      ),
    }));
    setChatDraft("");
    setDraftAttachmentIds([]);
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

  if (view === "canvas") {
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
        <div className="grid min-h-0 flex-1 gap-4 overflow-auto bg-[radial-gradient(var(--border-color)_1px,transparent_1px)] bg-[size:16px_16px] p-5 xl:grid-cols-[minmax(0,1fr)_260px]">
          <div className="relative min-h-[500px] overflow-hidden rounded-xl border border-border bg-bg/70">
            {assets.length ? (
              <div
                className="absolute left-1/2 top-1/2 grid w-[650px] max-w-[120%] -translate-x-1/2 -translate-y-1/2 grid-cols-3 gap-4 transition-transform"
                style={{ transform: `translate(-50%, -50%) scale(${zoom / 100})` }}
              >
                {assets.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => setSelectedAssetId(asset.id)}
                    className={`overflow-hidden rounded-xl border text-left shadow-lg ${selectedAssetId === asset.id ? "border-accent ring-2 ring-accent/30" : "border-white/10"}`}
                  >
                    <AssetVisual asset={asset} compact />
                    <div className="bg-bg-surface p-2">
                      <p className="truncate text-xs font-semibold text-text-primary">
                        {asset.name}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-text-muted">{asset.role}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState text={t.restyle_empty_assets} />
            )}
          </div>
          <aside className="rounded-xl border border-border bg-bg-surface p-4">
            <p className="text-xs text-text-muted">{t.restyle_selected_asset}</p>
            {selectedAsset ? (
              <>
                <h2 className="mt-1 font-semibold text-text-primary">{selectedAsset.name}</h2>
                <div className="mt-4 overflow-hidden rounded-xl">
                  <AssetVisual asset={selectedAsset} />
                </div>
                <p className="mt-3 text-sm leading-6 text-text-secondary">{selectedAsset.detail}</p>
              </>
            ) : (
              <p className="mt-3 text-sm leading-6 text-text-secondary">{t.restyle_empty_assets}</p>
            )}
            <div className="mt-5 flex gap-2">
              {[85, 100, 115].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setZoom(value)}
                  className={`rounded-md px-2 py-1 text-xs ${zoom === value ? "bg-accent-dim text-accent" : "bg-bg-elevated text-text-secondary"}`}
                >
                  {value}%
                </button>
              ))}
            </div>
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
      <header className="flex h-13 shrink-0 items-center justify-between border-b border-border bg-bg-surface px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-orange-400 text-xs font-bold text-white">
            Do
          </div>
          <span className="hidden font-display text-lg font-bold tracking-tight text-text-primary sm:inline">
            doopoo
          </span>
          <span className="h-5 w-px bg-border" />
          <p className="truncate text-sm font-semibold text-text-primary">{t.restyle_title}</p>
        </div>
        <button
          type="button"
          onClick={() => setView("canvas")}
          className="grid h-8 w-8 place-items-center rounded-md text-text-secondary hover:bg-bg-elevated hover:text-accent"
          aria-label={t.restyle_open_canvas}
        >
          <LayoutGrid size={16} />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[232px_minmax(0,1fr)_310px]">
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
            <span className="rounded-full border border-border bg-bg-elevated px-2.5 py-1.5 text-[11px] text-text-secondary">
              {stageLabels[stage]}
            </span>
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
                <div
                  key={message.id}
                  className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm leading-6 text-bg"
                >
                  {message.content}
                </div>
              ))}
              <div className="rounded-2xl border border-border bg-bg-surface p-3 shadow-card sm:p-4">
                <div
                  className="mb-3 flex min-w-0 items-center gap-2 overflow-x-auto"
                  role="tablist"
                  aria-label={t.restyle_workbench}
                >
                  {stageOrder.map((item, index) => (
                    <button
                      key={item}
                      type="button"
                      role="tab"
                      aria-label={stageLabels[item]}
                      aria-selected={stage === item}
                      onClick={() => setProjectStage(item)}
                      className={`shrink-0 rounded-full px-2.5 py-1.5 text-xs ${stage === item ? "bg-accent-dim font-semibold text-accent" : "text-text-muted hover:bg-bg-elevated hover:text-text-primary"}`}
                    >
                      <span className="mr-1 opacity-70">{index + 1}</span>
                      {stageLabels[item]}
                    </button>
                  ))}
                </div>
                <StagePanel
                  stage={stage}
                  assets={assets}
                  assetLibraryStatus={assetLibraryStatus}
                  selectedAsset={selectedAsset}
                  setSelectedAssetId={setSelectedAssetId}
                  activeProject={activeProject}
                  onToggleAsset={toggleAsset}
                  onToggleAssetConfirmation={toggleAssetConfirmation}
                  onSetStage={setProjectStage}
                  onRequestFiles={() => fileInputRef.current?.click()}
                  onPlanNoteChange={(planNote) => {
                    if (!activeProject) return;
                    updateProject(activeProject.id, (project) => ({ ...project, planNote }));
                  }}
                  t={t}
                />
              </div>
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
                      previewUrl={filePreviews[attachment.id]}
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
                <textarea
                  value={chatDraft}
                  onChange={(event) => setChatDraft(event.target.value)}
                  placeholder={t.restyle_chat_placeholder}
                  rows={1}
                  className="max-h-24 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-sm text-text-primary outline-none placeholder:text-text-muted"
                />
                <button
                  type="submit"
                  disabled={!activeConversation}
                  className="btn-primary !h-8 !w-8 !justify-center !rounded-lg !p-0"
                  aria-label={t.restyle_send}
                >
                  <Send size={15} />
                </button>
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
                  className="max-w-52 rounded-md bg-transparent px-2 py-1 text-text-secondary outline-none hover:bg-bg"
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
            <button
              type="button"
              onClick={() => setView("canvas")}
              className="grid h-7 w-7 place-items-center rounded-md text-text-muted hover:bg-bg-elevated hover:text-accent"
              aria-label={t.restyle_open_canvas}
            >
              <LayoutGrid size={15} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <AttachmentFileGroup
              label={t.restyle_source}
              files={activeProject?.files ?? []}
              onRemove={removeFile}
              removeLabel={t.restyle_remove_file}
            />
            {(["character", "scene", "prop"] as const).map((kind) => (
              <AssetFileGroup
                key={kind}
                label={
                  kind === "character"
                    ? t.restyle_assets_characters
                    : kind === "scene"
                      ? t.restyle_assets_scenes
                      : t.restyle_assets_props
                }
                assets={(assetsByKind[kind] ?? []).filter((asset) =>
                  activeProject?.assetIds.includes(asset.id),
                )}
                selectedAssetId={selectedAssetId}
                onSelect={setSelectedAssetId}
              />
            ))}
          </div>
          <div className="border-t border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">{t.restyle_inspector}</h3>
              {assetLibraryStatus === "loading" && (
                <span className="text-[10px] text-text-muted">{t.restyle_assets_syncing}</span>
              )}
            </div>
            {selectedAsset ? (
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
        </aside>
      </div>
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
  onRemove,
  removeLabel,
}: {
  attachment: RestyleAttachment;
  previewUrl?: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <div className="group relative w-20 overflow-hidden rounded-lg border border-border bg-bg-surface">
      <div className="grid h-16 place-items-center overflow-hidden bg-bg-elevated">
        {attachment.isFolder ? (
          <FolderOpen size={24} className="text-accent" />
        ) : previewUrl && attachment.type.startsWith("video/") ? (
          <video src={previewUrl} className="h-full w-full object-cover" muted />
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
            <p className="mt-1 text-sm text-text-secondary">{t.restyle_assets_description}</p>
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
        {assetLibraryStatus === "loading" ? (
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
