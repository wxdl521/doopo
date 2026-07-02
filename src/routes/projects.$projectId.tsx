import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, Play, Share2, Settings } from "lucide-react";
import { useState } from "react";
import PageHeader from "../components/PageHeader";
import {
  mockProjectDetails,
  mockScripts,
  mockCharacters,
  type ProjectDetail as ProjectDetailType,
} from "../data/mock";
import { useLanguage } from "../i18n/LanguageContext";

export const Route = createFileRoute("/projects/$projectId")({
  head: ({ params }) => ({ meta: [{ title: `Project ${params.projectId} — Doopoo` }] }),
  loader: ({ params }): ProjectDetailType => {
    const p = mockProjectDetails.find((x) => x.id === params.projectId);
    if (!p) throw notFound();
    return p;
  },
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

function ProjectDetail() {
  const { t } = useLanguage();
  const p = Route.useLoaderData() as ProjectDetailType;
  const [tab, setTab] = useState<Tab>("overview");
  const scripts = mockScripts.filter((s) => p.scriptIds.includes(s.id));
  const chars = mockCharacters.filter((c) => p.characterIds.includes(c.id));
  const tabLabel: Record<Tab, string> = {
    overview: t.pjd_tab_overview,
    scripts: t.pjd_tab_scripts,
    characters: t.pjd_tab_characters,
    assets: t.pjd_tab_assets,
    activity: t.pjd_tab_activity,
  };

  return (
    <div className="animate-fade-in">
      <Link
        to="/projects"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-accent mb-4"
      >
        <ArrowLeft size={14} /> {t.pjd_back}
      </Link>
      <div className={`relative rounded-2xl overflow-hidden bg-gradient-to-br ${p.thumbnail} mb-6`}>
        <div className="aspect-[3/1] flex items-end p-6">
          <div className="text-white">
            <div className="text-xs uppercase tracking-wider opacity-80">{p.status}</div>
            <h1 className="font-display text-3xl md:text-4xl font-bold mt-1">{p.title}</h1>
            <p className="opacity-80 text-sm mt-1 max-w-xl">{p.description}</p>
          </div>
        </div>
        <div className="absolute top-4 right-4 flex gap-2">
          <button className="btn-ghost !bg-white/10 !border-white/20 !text-white">
            <Share2 size={14} /> {t.pjd_share}
          </button>
          <button className="btn-primary">
            <Play size={14} /> {t.pjd_open_editor}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="panel p-3">
          <div className="text-xs text-text-muted">{t.pjd_assets}</div>
          <div className="font-display font-bold text-xl">{p.assetCount}</div>
        </div>
        <div className="panel p-3">
          <div className="text-xs text-text-muted">{t.pjd_points_used}</div>
          <div className="font-display font-bold text-xl">{p.pointsUsed}</div>
        </div>
        <div className="panel p-3">
          <div className="text-xs text-text-muted">{t.pjd_collaborators}</div>
          <div className="font-display font-bold text-xl">{p.collaborators.length}</div>
        </div>
        <div className="panel p-3">
          <div className="text-xs text-text-muted">{t.pjd_updated}</div>
          <div className="font-display font-bold text-xl">{p.updated}</div>
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
            <p className="text-text-secondary text-sm">{p.description}</p>
          </section>
          <aside className="panel p-5">
            <h3 className="font-display font-bold mb-3">{t.pjd_collaborators}</h3>
            <ul className="space-y-2 text-sm">
              {p.collaborators.map((u) => (
                <li key={u} className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500" />
                  {u}
                </li>
              ))}
            </ul>
            <button className="btn-ghost mt-4 w-full">
              <Settings size={14} /> {t.common_settings}
            </button>
          </aside>
        </div>
      )}

      {tab === "scripts" && (
        <ul className="space-y-3">
          {scripts.map((s) => (
            <li key={s.id} className="panel p-4 flex items-center justify-between">
              <div>
                <Link
                  to="/scripts/$scriptId"
                  params={{ scriptId: s.id }}
                  className="font-semibold hover:text-accent"
                >
                  {s.title}
                </Link>
                <div className="text-xs text-text-muted mt-0.5">
                  {s.versions.length} {t.pjd_versions_suffix} · {s.scenes.length}{" "}
                  {t.pjd_scenes_suffix}
                </div>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-bg-elevated border border-border">
                {s.status}
              </span>
            </li>
          ))}
        </ul>
      )}

      {tab === "characters" && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {chars.map((c) => (
            <Link
              key={c.id}
              to="/characters/$characterId"
              params={{ characterId: c.id }}
              className="card overflow-hidden"
            >
              <div className="aspect-square" style={{ background: c.views.front }} />
              <div className="p-3">
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-text-muted">{c.role}</div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {tab === "assets" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: p.assetCount })
            .slice(0, 12)
            .map((_, i) => (
              <div key={i} className="card overflow-hidden">
                <div
                  className={`aspect-square bg-gradient-to-br ${p.thumbnail} opacity-${50 + (i % 5) * 10}`}
                />
                <div className="px-2 py-1 text-[10px] font-mono text-text-muted">
                  render-{(i + 1).toString().padStart(4, "0")}
                </div>
              </div>
            ))}
        </div>
      )}

      {tab === "activity" && (
        <ul className="space-y-2 text-sm">
          {[
            { ts: "09:14", txt: `Lin Wu generated ${p.title} — scene 2` },
            { ts: "08:51", txt: "Ada Reyes approved 1080p export" },
            { ts: t.common_yesterday, txt: "Tomás Vela uploaded reference image" },
          ].map((a, i) => (
            <li key={i} className="panel p-3 flex gap-3">
              <span className="font-mono text-xs text-text-muted w-20">{a.ts}</span>
              <span>{a.txt}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
