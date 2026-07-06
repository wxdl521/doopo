import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Download,
  GitBranch,
  FileText,
  Sparkles,
  Activity,
  Zap,
  MessageCircle,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import PageHeader from "../components/PageHeader";
import { mockScripts, type ScriptItem } from "../data/mock";
import { useLanguage } from "../i18n/LanguageContext";
import {
  findScript,
  findScriptWithCloud,
  ensureScriptCover,
  type SavedScript,
} from "../lib/scriptStorage";
import { uploadScriptCover } from "../lib/scripts.covers.functions";

export const Route = createFileRoute("/scripts/$scriptId")({
  head: ({ params }) => ({ meta: [{ title: `Script ${params.scriptId} — Doopoo` }] }),
  // Loader is isomorphic; we only resolve mock items here. Local saved scripts
  // are fetched client-side after hydration.
  loader: ({ params }): ScriptItem | null => {
    return mockScripts.find((s) => s.id === params.scriptId) ?? null;
  },
  notFoundComponent: ScriptNotFound,
  errorComponent: ({ error, reset }) => (
    <div className="p-10 text-center text-text-muted">
      {error.message}
      <button onClick={reset} className="ml-2 text-accent">
        Retry
      </button>
    </div>
  ),
  component: ScriptDetail,
});

function ScriptNotFound() {
  const { t } = useLanguage();
  return <div className="p-10 text-center text-text-muted">{t.ui_script_not_found}</div>;
}

function ScriptDetail() {
  const { t } = useLanguage();
  const params = Route.useParams();
  const mock = Route.useLoaderData() as ScriptItem | null;
  const [saved, setSaved] = useState<SavedScript | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [cloudChecked, setCloudChecked] = useState(false);
  const callImage = useServerFn(uploadScriptCover);

  useEffect(() => {
    let alive = true;
    setSaved(findScript(params.scriptId));
    setHydrated(true);
    setCloudChecked(false);
    // 云端覆盖（登录后跨设备同步）
    void findScriptWithCloud(params.scriptId).then((s) => {
      if (!alive) return;
      if (s) setSaved(s);
      setCloudChecked(true);
    });
    return () => {
      alive = false;
    };
  }, [params.scriptId]);

  // Backfill: if this script has no coverUrl, kick off generation.
  // The helper dedupes — safe to call from list and detail page simultaneously.
  const coverTriedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!saved || saved.coverUrl) return;
    if (coverTriedRef.current === saved.id) return;
    coverTriedRef.current = saved.id;
    void ensureScriptCover({
      script: saved,
      uploadCover: callImage as any,
      onUpdate: (s) => setSaved(s),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved?.id, saved?.coverUrl]);

  if (!hydrated && !mock) {
    return <div className="p-10 text-center text-text-muted">…</div>;
  }

  if (hydrated && saved) return <SavedScriptView s={saved} t={t} />;
  if (mock) return <MockScriptView s={mock} t={t} />;
  if (hydrated && cloudChecked && !saved && !mock) {
    throw notFound();
  }
  return <div className="p-10 text-center text-text-muted">…</div>;
}

// ============= Saved (structured) view =============

function SavedScriptView({ s, t }: { s: SavedScript; t: ReturnType<typeof useLanguage>["t"] }) {
  const plainContent = s.content || s.premise || s.logline || "";
  const hasAgentText = !!(
    s.synopsisText ||
    plainContent ||
    s.episodesText?.length ||
    s.charactersText
  );
  const hasScenes = !!s.scenes?.length;
  const hasCharacters = !!s.characters?.length;
  const hasActs = !!s.acts?.length;
  const showSideBlocks = hasScenes || hasCharacters || hasActs;
  const episodeCount = s.episodesText?.length ?? 0;

  // 集数跳转
  const [focusedEpIdx, setFocusedEpIdx] = useState<number>(-1);
  const [collapsedEps, setCollapsedEps] = useState<Set<number>>(new Set());

  const toggleEpCollapse = (idx: number) => {
    setCollapsedEps((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  return (
    <div className="animate-fade-in">
      <Link
        to="/scripts"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-accent mb-4"
      >
        <ArrowLeft size={14} /> {t.scd_back}
      </Link>

      {s.coverUrl && (
        <div className="relative aspect-[21/9] rounded-2xl overflow-hidden border border-border mb-6">
          <img
            src={s.coverUrl}
            alt={s.title}
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        </div>
      )}

      <PageHeader
        title={s.title}
        subtitle={s.logline || s.plot || (s.synopsisText ? s.synopsisText.slice(0, 120) : "")}
        actions={
          <>
            <button className="btn-ghost" disabled>
              <Download size={14} /> {t.scd_pdf}
            </button>
            <button className="btn-ghost" disabled>
              <Download size={14} /> {t.scd_json}
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 text-sm">
        <Stat label={t.scd_type} value={s.type} />
        <Stat label={t.scd_genre} value={Array.isArray(s.genre) ? s.genre.join("、") : s.genre} />
        <Stat label={t.script_tone} value={Array.isArray(s.tone) ? s.tone.join("、") : s.tone} />
        <Stat
          label={episodeCount > 0 ? t.sd_episodes_generated : t.scd_scenes}
          value={
            episodeCount > 0
              ? t.sd_ep_count_short.replace("{count}", String(episodeCount))
              : String(s.scenes?.length ?? 0)
          }
        />
      </div>

      {s.quality && (
        <div className="panel p-4 mb-6">
          <div className="flex items-center gap-2 mb-3 font-display font-bold text-sm">
            <Sparkles size={14} className="text-accent" /> {t.script_quality_title}
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <QualityBar
              icon={<Activity size={12} />}
              label={t.script_quality_pacing}
              value={s.quality.pacing}
            />
            <QualityBar
              icon={<Zap size={12} />}
              label={t.script_quality_conflict}
              value={s.quality.conflict}
            />
            <QualityBar
              icon={<MessageCircle size={12} />}
              label={t.script_quality_dialogue}
              value={s.quality.dialogueDensity}
            />
          </div>
          {s.quality.suggestions.length > 0 && (
            <div className="text-xs text-text-secondary space-y-1">
              <div className="text-text-muted">{t.script_quality_suggestions}</div>
              {s.quality.suggestions.map((sg, i) => (
                <div key={i}>· {sg}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={`grid gap-6 ${showSideBlocks ? "lg:grid-cols-3" : "lg:grid-cols-1"}`}>
        {hasAgentText && (
          <section className={`panel p-5 space-y-5 ${showSideBlocks ? "lg:col-span-3" : ""}`}>
            {!s.synopsisText && plainContent && (
              <AgentTextBlock title={t.sd_saved_content} text={plainContent} />
            )}
            {s.synopsisText && <AgentTextBlock title={t.sd_synopsis_title} text={s.synopsisText} />}

            {/* 剧本集数跳转区 */}
            {episodeCount > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="font-display font-bold text-sm">{t.sd_storyboard}</span>
                  <span className="text-xs text-text-muted">
                    {t.sd_episode_total.replace("{count}", String(episodeCount))}
                  </span>
                  <label className="ml-auto flex items-center gap-1.5 text-xs text-text-muted">
                    <span>{t.sd_jump_to}</span>
                    <select
                      value={focusedEpIdx}
                      onChange={(e) => setFocusedEpIdx(Number(e.target.value))}
                      className="rounded-md bg-bg-elevated border border-border text-text-primary text-xs px-2 py-1 focus:outline-none focus:border-accent/50"
                    >
                      <option value={-1}>{t.sd_select_episode}</option>
                      {s.episodesText!.map((ep) => (
                        <option key={ep.epIndex} value={ep.epIndex}>
                          {t.sd_episode_n.replace("{n}", String(ep.epIndex))}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="space-y-2">
                  {s.episodesText!.map((ep) => {
                    const isFocused = ep.epIndex === focusedEpIdx;
                    const isCollapsed = collapsedEps.has(ep.epIndex) && !isFocused;
                    if (isCollapsed) {
                      return (
                        <div
                          key={ep.epIndex}
                          className="rounded-xl border border-border bg-bg-base/40 px-3 py-2 flex items-center gap-3 cursor-pointer hover:border-accent/50 transition-colors"
                          onClick={() => setFocusedEpIdx(ep.epIndex)}
                          title={t.sd_click_jump}
                        >
                          <span className="text-sm font-semibold text-text-primary">
                            {t.sd_episode_n.replace("{n}", String(ep.epIndex))}
                          </span>
                          <span className="text-xs text-text-muted truncate flex-1 min-w-0">
                            {ep.text
                              .slice(0, 60)
                              .replace(/[#*`>_\-]/g, "")
                              .replace(/\s+/g, " ")
                              .trim() || t.sd_empty}
                          </span>
                          <span className="text-[11px] text-text-muted shrink-0">
                            {t.sd_chars_n.replace("{count}", String(ep.text.length))}
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={ep.epIndex}
                        className="rounded-xl border border-border bg-bg-base/40 overflow-hidden"
                      >
                        <div className="flex items-center gap-2 px-3 py-2 bg-bg-elevated/40">
                          <span className="text-sm font-semibold text-text-primary">
                            {t.sd_episode_n.replace("{n}", String(ep.epIndex))}
                          </span>
                          <span className="text-[11px] text-text-muted">
                            {t.sd_chars_n.replace("{count}", String(ep.text.length))}
                          </span>
                          <div className="ml-auto flex items-center gap-1">
                            <button
                              onClick={() => toggleEpCollapse(ep.epIndex)}
                              className="text-text-muted hover:text-text-primary"
                              title={t.sd_collapse}
                            >
                              <ChevronUp size={12} />
                            </button>
                          </div>
                        </div>
                        {isFocused && <AgentTextBlock title="" text={ep.text} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {s.charactersText && (
              <AgentTextBlock title={t.sd_characters_card} text={s.charactersText} />
            )}
          </section>
        )}

        {hasScenes && (
          <section className="panel p-5 lg:col-span-2">
            <div className="flex items-center gap-2 mb-4 font-display font-bold">
              <FileText size={16} className="text-accent" /> {t.scd_scenes}
            </div>
            <ol className="space-y-5">
              {s.scenes!.map((sc) => (
                <li key={sc.index} className="border-l-2 border-accent/40 pl-4">
                  <div className="text-xs text-text-muted font-mono mb-1">
                    SC{sc.index} · {sc.timeOfDay}
                  </div>
                  <div className="font-semibold">{sc.slug}</div>
                  <div className="text-sm text-text-secondary mt-1 leading-relaxed">
                    {sc.action}
                  </div>
                  {sc.beats?.length > 0 && (
                    <ul className="mt-2 text-xs text-text-muted space-y-0.5">
                      {sc.beats.map((b, i) => (
                        <li key={i}>· {b}</li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 space-y-1">
                    {sc.dialogue.map((d, i) => (
                      <div key={i} className="text-sm">
                        <span className="font-mono text-xs text-accent">{d.role}</span>
                        {d.parenthetical && (
                          <span className="text-xs text-text-muted ml-1">({d.parenthetical})</span>
                        )}
                        <span className="text-text-primary">：{d.line}</span>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {(hasCharacters || hasActs) && (
          <aside className="panel p-5 space-y-4">
            {s.characters && s.characters.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3 font-display font-bold">
                  <GitBranch size={16} className="text-accent" /> {t.script_step_characters}
                </div>
                <ul className="space-y-3">
                  {s.characters.map((c, i) => (
                    <li key={i} className="border border-border rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-sm">{c.name}</div>
                          <div className="text-xs text-text-muted">{c.roleLabel}</div>
                        </div>
                        <div className="flex gap-1">
                          {c.palette.map((hex, pi) => (
                            <span
                              key={pi}
                              className="w-3 h-3 rounded-full border border-border"
                              style={{ background: hex }}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="text-xs text-text-secondary mt-1.5">{c.motivation}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {s.acts && s.acts.length > 0 && (
              <div>
                <div className="font-display font-bold text-sm mb-2">{t.script_step_outline}</div>
                <ol className="space-y-2 text-xs">
                  {s.acts.map((a, i) => (
                    <li key={i} className="border border-border rounded-lg p-2">
                      <div className="font-semibold text-text-primary">
                        {t.script_act_label} {i + 1} · {a.title}
                      </div>
                      <ul className="mt-1 text-text-secondary space-y-0.5">
                        {a.beats.map((b, bi) => (
                          <li key={bi}>· {b}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function AgentTextBlock({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <div className="font-display font-bold text-sm mb-2 text-accent">{title}</div>
      <div className="break-words text-sm leading-7 text-text-primary bg-bg-base/40 border border-border rounded-lg p-4 max-h-[640px] overflow-y-auto prose prose-invert prose-sm max-w-none prose-headings:mt-4 prose-headings:mb-2 prose-strong:text-accent">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    </div>
  );
}

function QualityBar({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-text-muted mb-1">
        {icon}
        <span>{label}</span>
        <span className="ml-auto text-text-primary font-mono">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-accent to-accent/60"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-3">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="font-semibold capitalize">{value}</div>
    </div>
  );
}

// ============= Legacy mock view (kept for built-in demo scripts) =============

function MockScriptView({ s, t }: { s: ScriptItem; t: ReturnType<typeof useLanguage>["t"] }) {
  return (
    <div className="animate-fade-in">
      <Link
        to="/scripts"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-accent mb-4"
      >
        <ArrowLeft size={14} /> {t.scd_back}
      </Link>
      <PageHeader
        title={s.title}
        subtitle={s.summary}
        actions={
          <>
            <button className="btn-ghost">
              <Download size={14} /> {t.scd_pdf}
            </button>
            <button className="btn-ghost">
              <Download size={14} /> {t.scd_fountain}
            </button>
            <button className="btn-ghost">
              <Download size={14} /> {t.scd_json}
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8 text-sm">
        <div className="panel p-3">
          <div className="text-xs text-text-muted">{t.scd_type}</div>
          <div className="font-semibold capitalize">{s.type}</div>
        </div>
        <div className="panel p-3">
          <div className="text-xs text-text-muted">{t.scd_genre}</div>
          <div className="font-semibold">{s.genre}</div>
        </div>
        <div className="panel p-3">
          <div className="text-xs text-text-muted">{t.scd_duration}</div>
          <div className="font-semibold">
            {s.durationSec}s · {s.episodes} {t.scd_episode_suffix}
          </div>
        </div>
        <div className="panel p-3">
          <div className="text-xs text-text-muted">{t.scd_dialogue_density}</div>
          <div className="font-semibold">{s.dialogueDensity}%</div>
        </div>
        <div className="panel p-3">
          <div className="text-xs text-text-muted">{t.scd_conflict_density}</div>
          <div className="font-semibold">{s.conflictDensity}%</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <section className="panel p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-4 font-display font-bold">
            <FileText size={16} className="text-accent" /> {t.scd_scenes}
          </div>
          {s.scenes.length === 0 ? (
            <div className="text-text-muted text-sm">{t.scd_no_scenes}</div>
          ) : (
            <ol className="space-y-5">
              {s.scenes.map((sc) => (
                <li key={sc.id} className="border-l-2 border-accent/40 pl-4">
                  <div className="text-xs text-text-muted font-mono mb-1">
                    {t.scd_scene} {sc.index} · {sc.timeOfDay}
                  </div>
                  <div className="font-semibold">{sc.title}</div>
                  <div className="text-sm text-text-secondary mt-1 italic">{sc.action}</div>
                  <div className="mt-2 space-y-1">
                    {sc.dialogue.map((d, i) => (
                      <div key={i} className="text-sm">
                        <span className="font-mono text-xs text-accent">{d.role}: </span>
                        <span>{d.line}</span>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="panel p-5">
          <div className="flex items-center gap-2 mb-4 font-display font-bold">
            <GitBranch size={16} className="text-accent" /> {t.scd_versions}
          </div>
          <ul className="space-y-3">
            {s.versions.map((v, i) => (
              <li key={v.id} className="border border-border rounded-lg p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{v.label}</span>
                  {i === 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-dim text-accent">
                      {t.scd_latest}
                    </span>
                  )}
                </div>
                <div className="text-xs text-text-muted mt-0.5">
                  {v.createdAt} · {v.author}
                </div>
                <div className="text-xs text-text-secondary mt-1">{v.note}</div>
                <div className="mt-2 flex gap-2">
                  <button className="text-xs text-accent hover:underline">{t.scd_view}</button>
                  <button className="text-xs text-text-muted hover:text-accent">
                    {t.scd_compare}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
