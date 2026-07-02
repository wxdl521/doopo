import { useState, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import PageHeader from "../components/PageHeader";
import { Image as ImageIcon, FileVideo, Loader2 } from "lucide-react";
import { useLanguage } from "../i18n/LanguageContext";
import { useAuth } from "../hooks/useAuth";
import { listMyProjects, type ProjectListItem } from "../lib/projects.functions";
import { loadCharacters, loadScenes, loadProps } from "../lib/assetsStorage";

export const Route = createFileRoute("/account/assets")({
  component: MyAssets,
});

function MyAssets() {
  const { t } = useLanguage();
  const { user, isAuthenticated } = useAuth();
  const callListMyProjects = useServerFn(listMyProjects);

  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [characters, setCharacters] = useState<any[]>([]);
  const [scenes, setScenes] = useState<any[]>([]);
  const [props, setProps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    setLoading(true);
    Promise.all([
      callListMyProjects({ data: {} }),
      loadCharacters(user.id),
      loadScenes(user.id),
      loadProps(user.id),
    ])
      .then(([projRes, charsRes, scenesRes, propsRes]) => {
        if (projRes.projects) setProjects(projRes.projects);
        if (charsRes.data) setCharacters(charsRes.data);
        if (scenesRes.data) setScenes(scenesRes.data);
        if (propsRes.data) setProps(propsRes.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAuthenticated, user, callListMyProjects]);

  const imageCount =
    characters.filter((c) => c.cover_url).length +
    scenes.filter((s) => s.cover_url).length +
    props.filter((p) => p.cover_url).length;

  if (loading) {
    return (
      <div className="animate-fade-in flex items-center justify-center min-h-[60vh]">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <>
      <PageHeader title={t.account_assets} subtitle={t.account_assets_sub} />

      {/* Projects section */}
      <h3 className="font-display font-bold mb-3">{t.account_projects_section}</h3>
      {projects.length === 0 ? (
        <p className="text-sm text-text-muted mb-8">暂无项目</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {projects.map((p) => (
            <Link
              key={p.id}
              to="/workspace/$workspaceId"
              params={{ workspaceId: p.id }}
              className="card group"
            >
              <div className="aspect-[16/10] bg-gradient-to-br from-indigo-700 via-violet-800 to-slate-950 relative flex items-center justify-center overflow-hidden">
                {p.customCover ? (
                  <img
                    src={p.customCover}
                    alt={p.name}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <span className="text-4xl drop-shadow-lg">🎬</span>
                )}
                <div className="absolute bottom-2 right-2 px-2 py-0.5 text-[10px] font-mono rounded-md bg-black/40 backdrop-blur text-white">
                  {p.completedStages.length} / 5
                </div>
              </div>
              <div className="p-3">
                <div className="font-semibold truncate">{p.name}</div>
                <div className="text-xs text-text-muted">
                  {new Date(p.updatedAt).toLocaleDateString("zh-CN")}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Characters section */}
      <h3 className="font-display font-bold mb-3">{t.account_characters_section}</h3>
      {characters.length === 0 ? (
        <p className="text-sm text-text-muted mb-8">暂无角色</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {characters.map((c) => (
            <Link
              key={c.id}
              to="/assets/$tab/$id"
              params={{ tab: "character", id: c.id }}
              className="card overflow-hidden"
            >
              <div className="aspect-square bg-gradient-to-br from-blue-400/40 via-purple-300/30 to-pink-200/30 relative flex items-center justify-center overflow-hidden">
                {c.cover_url ? (
                  <img
                    src={c.cover_url}
                    alt={c.name}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-5xl drop-shadow-lg">👤</span>
                )}
              </div>
              <div className="p-3">
                <div className="font-semibold truncate">{c.name}</div>
                <div className="text-xs text-text-muted truncate">
                  {c.role_label || c.role || ""}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="panel p-6 flex items-center gap-4">
          <ImageIcon className="text-accent" />
          <div>
            <div className="text-sm text-text-muted">{t.account_images_generated}</div>
            <div className="font-display text-xl font-bold">{imageCount}</div>
          </div>
        </div>
        <div className="panel p-6 flex items-center gap-4">
          <FileVideo className="text-accent" />
          <div>
            <div className="text-sm text-text-muted">{t.account_video_renders}</div>
            <div className="font-display text-xl font-bold">0</div>
          </div>
        </div>
      </div>
    </>
  );
}
