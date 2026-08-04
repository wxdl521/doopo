import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, Play, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { GenCharacter } from "../data/workspaceGenerators";
import {
  getProject,
  loadWorkspaceData,
  loadWorkspaceMedia,
  type ProjectConfigRow,
} from "../lib/projects.functions";
import { formatRelativeTime } from "../lib/utils";
import { useLanguage } from "../i18n/LanguageContext";

export const Route = createFileRoute("/projects/$projectId")({
  head: ({ params }) => ({ meta: [{ title: `Project ${params.projectId} — Doopoo` }] }),
  notFoundComponent: ProjectNotFound,
  errorComponent: ({ error, reset }) => (
    <div className="p-10 text-center text-text-muted">
      {error.message}
      <button onClick={reset} className="ml-2 text-accent">
        Retry
      </button>
    </div>
  ),
  component: ProjectDetail,
});

function ProjectNotFound() {
  const { t } = useLanguage();
  return <div className="p-10 text-center text-text-muted">{t.ui_project_not_found}</div>;
}

const tabKeys = ["overview", "scripts", "characters", "assets", "activity"] as const;
type Tab = (typeof tabKeys)[number];

type PageState = "loading" | "ready" | "notfound" | "error";

type EpisodeText = { epIndex: number; text: string };

/** 从 loadWorkspaceMedia 返回的媒体 map 里收集所有图片 URL(角色/分镜/场景/道具/故事板)。 */
function collectImageUrls(media: Record<string, any>): string[] {
  const urls: string[] = [];
  const push = (v: any) => {
    if (Array.isArray(v)) {
      for (const u of v) if (typeof u === "string" && u) urls.push(u);
    } else if (typeof v === "string" && v) {
      urls.push(v);
    }
  };
  for (const key of ["charImages", "shotImages", "sceneImages", "propImages", "panelImages"]) {
    const m = media[key];
    if (m && typeof m === "object") for (const k of Object.keys(m)) push(m[k]);
  }
  const sb = media.groupStoryboards;
  if (sb && typeof sb === "object") {
    for (const k of Object.keys(sb)) {
      const v = sb[k];
      if (v && typeof v.url === "string" && v.url) urls.push(v.url);
    }
  }
  return urls;
}

/** 收集已生成的视频 URL(groupVideos 兼容数组与单对象两种历史形态)。 */
function collectVideoUrls(media: Record<string, any>): string[] {
  const urls: string[] = [];
  const gv = media.groupVideos;
  if (gv && typeof gv === "object") {
    for (const k of Object.keys(gv)) {
      const v = gv[k];
      const entries = Array.isArray(v) ? v : [v];
      for (const e of entries) {
        if (e && typeof e.url === "string" && e.url) urls.push(e.url);
      }
    }
  }
  return urls;
}

function ProjectDetail() {
  const { t } = useLanguage();
  const { projectId } = Route.useParams();
  const callGetProject = useServerFn(getProject);
  const callLoadWorkspace = useServerFn(loadWorkspaceData);
  const callLoadMedia = useServerFn(loadWorkspaceMedia);

  const [state, setState] = useState<PageState>("loading");
  const [project, setProject] = useState<ProjectConfigRow | null>(null);
  const [completedStages, setCompletedStages] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [episodes, setEpisodes] = useState<EpisodeText[]>([]);
  const [characters, setCharacters] = useState<GenCharacter[]>([]);
  const [charImages, setCharImages] = useState<Record<string, string[]>>({});
  const [assetImages, setAssetImages] = useState<string[]>([]);
  const [assetVideos, setAssetVideos] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    callGetProject({ data: { id: projectId } })
      .then((r) => {
        if (cancelled) return;
        // 不存在或 RLS 判定无权限时 getProject 返回 project: null → notFound 语义
        if (r.error || !r.project) {
          setState("notfound");
          return;
        }
        setProject(r.project);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, callGetProject]);

  // 项目内容(剧本/角色/场景)与媒体(图/视频)分开加载,失败不阻塞页面主体。
  useEffect(() => {
    if (state !== "ready") return;
    let cancelled = false;
    callLoadWorkspace({ data: { id: projectId } })
      .then((r) => {
        if (cancelled || r.error || !r.workspaceData) return;
        const wd = r.workspaceData as Record<string, any>;
        setCompletedStages(Array.isArray(r.completedStages) ? r.completedStages : []);
        const outline = wd.outline as { logline?: unknown } | undefined;
        const synopsis = typeof wd.synopsisText === "string" ? wd.synopsisText : "";
        const logline = typeof outline?.logline === "string" ? outline.logline : "";
        setDescription(synopsis || logline);
        setEpisodes(
          Array.isArray(wd.episodeTexts)
            ? (wd.episodeTexts as any[]).filter(
                (e): e is EpisodeText =>
                  e && typeof e.epIndex === "number" && typeof e.text === "string",
              )
            : [],
        );
        setCharacters(Array.isArray(wd.characters) ? (wd.characters as GenCharacter[]) : []);
      })
      .catch(() => {});
    callLoadMedia({ data: { id: projectId } })
      .then((r) => {
        if (cancelled || r.error || !r.workspaceData) return;
        const media = r.workspaceData as Record<string, any>;
        if (media.charImages && typeof media.charImages === "object") {
          setCharImages(media.charImages as Record<string, string[]>);
        }
        setAssetImages(collectImageUrls(media));
        setAssetVideos(collectVideoUrls(media));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [state, projectId, callLoadWorkspace, callLoadMedia]);

  if (state === "loading") {
    return <div className="p-10 text-center text-text-muted text-sm">{t.common_loading}</div>;
  }
  if (state === "notfound") {
    return <ProjectNotFound />;
  }
  if (state === "error" || !project) {
    return <div className="p-10 text-center text-text-muted">{t.common_error}</div>;
  }

  const status =
    completedStages.length === 0 ? "draft" : completedStages.length >= 5 ? "ready" : "rendering";
  const coverUrl = project.customCover || assetImages[0] || null;
  const charImage = (c: GenCharacter): string | null => {
    const direct = charImages[c.id];
    if (Array.isArray(direct) && direct[0]) return direct[0];
    const key = Object.keys(charImages).find((k) => k.startsWith(`${c.id}::`));
    const arr = key ? charImages[key] : undefined;
    return Array.isArray(arr) && arr[0] ? arr[0] : null;
  };
  const assetCount = assetImages.length + assetVideos.length;

  const onShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const tabLabel: Record<Tab, string> = {
    overview: t.pjd_tab_overview,
    scripts: t.pjd_tab_scripts,
    characters: t.pjd_tab_characters,
    assets: t.pjd_tab_assets,
    activity: t.pjd_tab_activity,
  };

  const underConstruction = (
    <div className="panel p-10 text-center">
      <div className="font-semibold text-text-primary">{t.pjd_under_construction}</div>
      <p className="text-sm text-text-muted mt-1">{t.pjd_under_construction_desc}</p>
    </div>
  );

  return (
    <div className="animate-fade-in">
      <Link
        to="/projects"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-accent mb-4"
      >
        <ArrowLeft size={14} /> {t.pjd_back}
      </Link>
      <div className="relative rounded-2xl overflow-hidden mb-6">
        {coverUrl ? (
          <img src={coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : null}
        <div
          className={`relative bg-gradient-to-br from-accent/60 to-accent-mint/60 ${coverUrl ? "bg-bg/60 backdrop-blur-sm" : ""}`}
        >
          <div className="aspect-[3/1] flex items-end p-6">
            <div className="text-white drop-shadow">
              <div className="text-xs uppercase tracking-wider opacity-80">{status}</div>
              <h1 className="font-display text-3xl md:text-4xl font-bold mt-1">{project.name}</h1>
              {description ? (
                <p className="opacity-80 text-sm mt-1 max-w-xl line-clamp-2">{description}</p>
              ) : null}
            </div>
          </div>
          <div className="absolute top-4 right-4 flex gap-2">
            <button
              onClick={() => void onShare()}
              className="btn-ghost !bg-white/10 !border-white/20 !text-white"
            >
              {copied ? <Check size={14} /> : <Share2 size={14} />}
              {copied ? t.pjd_copied : t.pjd_share}
            </button>
            <Link
              to="/workspace/$workspaceId"
              params={{ workspaceId: project.id }}
              className="btn-primary"
            >
              <Play size={14} /> {t.pjd_open_editor}
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="panel p-3">
          <div className="text-xs text-text-muted">{t.pjd_assets}</div>
          <div className="font-display font-bold text-xl">{assetCount}</div>
        </div>
        <div className="panel p-3">
          <div className="text-xs text-text-muted">{t.pjd_tab_characters}</div>
          <div className="font-display font-bold text-xl">{characters.length}</div>
        </div>
        <div className="panel p-3">
          <div className="text-xs text-text-muted">{t.pjd_episodes}</div>
          <div className="font-display font-bold text-xl">{episodes.length}</div>
        </div>
        <div className="panel p-3">
          <div className="text-xs text-text-muted">{t.pjd_updated}</div>
          <div className="font-display font-bold text-xl">
            {formatRelativeTime(project.updatedAt)}
          </div>
        </div>
      </div>

      <div className="flex gap-2 border-b border-border mb-6">
        {tabKeys.map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${tab === k ? "border-accent text-accent font-semibold" : "border-transparent text-text-secondary hover:text-text-primary"}`}
          >
            {tabLabel[k]}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid lg:grid-cols-3 gap-6">
          <section className="panel p-5 lg:col-span-2">
            <h3 className="font-display font-bold mb-3">{t.pjd_description}</h3>
            <p className="text-text-secondary text-sm whitespace-pre-wrap">
              {description || t.pjd_no_description}
            </p>
          </section>
          <aside className="panel p-5">
            <h3 className="font-display font-bold mb-3">{t.pjd_config}</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-text-muted">{t.np_aspect}</dt>
                <dd>{project.aspect}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-text-muted">{t.np_video_model}</dt>
                <dd className="text-right break-all">{project.videoModel}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-text-muted">{t.np_storyboard_model}</dt>
                <dd className="text-right break-all">{project.storyboardModel}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-text-muted">{t.np_scene_model}</dt>
                <dd className="text-right break-all">{project.sceneModel}</dd>
              </div>
              {project.resolution ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-text-muted">{t.np_resolution}</dt>
                  <dd>{project.resolution}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-2">
                <dt className="text-text-muted">{t.common_type}</dt>
                <dd>{project.workflow}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-text-muted">{t.pjd_style}</dt>
                <dd>{project.style}</dd>
              </div>
            </dl>
            <Link
              to="/workspace/$workspaceId"
              params={{ workspaceId: project.id }}
              className="btn-ghost mt-4 w-full inline-flex items-center justify-center gap-1"
            >
              {t.pjd_open_editor}
            </Link>
          </aside>
        </div>
      )}

      {tab === "scripts" &&
        (episodes.length === 0 ? (
          <div className="panel p-10 text-center text-text-muted text-sm">{t.common_no_data}</div>
        ) : (
          <ul className="space-y-3">
            {episodes.map((e) => (
              <li key={e.epIndex} className="panel p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">
                    {t.pjd_episode_prefix}
                    {e.epIndex}
                    {t.pjd_episode_suffix}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-bg-elevated border border-border">
                    {e.text.length}
                    {t.pjd_chars_suffix}
                  </span>
                </div>
                {e.text ? (
                  <p className="text-xs text-text-muted mt-1 line-clamp-2">{e.text}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ))}

      {tab === "characters" &&
        (characters.length === 0 ? (
          <div className="panel p-10 text-center text-text-muted text-sm">{t.common_no_data}</div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {characters.map((c) => {
              const img = charImage(c);
              return (
                <div key={c.id} className="card overflow-hidden">
                  {img ? (
                    <img src={img} alt={c.name} className="aspect-square w-full object-cover" />
                  ) : (
                    <div className="aspect-square" style={{ background: c.swatch }} />
                  )}
                  <div className="p-3">
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-text-muted">{c.roleLabel || c.role}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

      {tab === "assets" &&
        (assetCount === 0 ? (
          <div className="panel p-10 text-center text-text-muted text-sm">{t.common_no_data}</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {assetImages.map((url, i) => (
              <div key={`img-${i}`} className="card overflow-hidden">
                <img src={url} alt="" className="aspect-square w-full object-cover" loading="lazy" />
              </div>
            ))}
            {assetVideos.map((url, i) => (
              <div key={`vid-${i}`} className="card overflow-hidden">
                <video src={url} className="aspect-square w-full object-cover" muted playsInline />
                <div className="px-2 py-1 text-[10px] font-mono text-text-muted inline-flex items-center gap-1">
                  <Play size={9} /> {t.pjd_video_label}
                </div>
              </div>
            ))}
          </div>
        ))}

      {tab === "activity" && underConstruction}
    </div>
  );
}
