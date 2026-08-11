import { useState, useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Trash2, MessageSquare, FileText, Cloud, LogIn, Share2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useLanguage } from "../i18n/LanguageContext";
import { useListedModels } from "../hooks/useListedModels";
import { formatModelOptionLabel, sortListedModels } from "../hooks/modelOptions";
import { TEXT_MODEL_FALLBACK } from "../lib/textModelOptions";
import ScriptComposer from "../components/scripts/ScriptComposer";
import {
  loadScripts,
  removeScript,
  syncFromCloud,
  ensureScriptCover,
  type SavedScript,
} from "../lib/scriptStorage";
import { uploadScriptCover } from "../lib/scripts.covers.functions";
import { useAuth } from "../hooks/useAuth";
import ShareDialog from "../components/community/ShareDialog";
import { ALL_SCRIPT_GENRES, SCRIPT_TONES } from "../lib/scriptTags";

const TYPES = [
  { value: "Micro", key: "script_type_micro" as const },
  { value: "Short", key: "script_type_short" as const },
  { value: "Feature", key: "script_type_feature" as const },
  { value: "Ad", key: "script_type_ad" as const },
];
const GENRES = ALL_SCRIPT_GENRES;
const TONES = SCRIPT_TONES;

export default function Scripts() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  // 文本模型目录：统一走 useListedModels("text")，label 用全站统一纯文本后缀
  // （废除原 🟠/🟣 手工 emoji 与本地硬编码列表，fallback 收敛到 textModelOptions）。
  const { models: catalogTextModels } = useListedModels("text", TEXT_MODEL_FALLBACK);
  const badgeLabels = {
    unpricedLabel: t.listed_model_unpriced,
    defaultLabel: t.restyle_setup_col_default,
  };
  const models = sortListedModels(catalogTextModels).map((m) => ({
    id: m.id,
    label: formatModelOptionLabel(m, badgeLabels),
  }));
  const [scripts, setScripts] = useState<SavedScript[]>([]);
  const { isAuthenticated, loading: authLoading, user, signOut } = useAuth();
  const [shareScript, setShareScript] = useState<SavedScript | null>(null);
  const callImage = useServerFn(uploadScriptCover);

  const refresh = () => setScripts(loadScripts());
  useEffect(() => {
    refresh();
    // 登录后从云端拉取并合并，未登录则静默跳过
    void syncFromCloud().then((merged) => setScripts(merged));
  }, [isAuthenticated]);

  // Backfill covers for any script that doesn't have one yet (old scripts saved
  // before this feature). One generation per id — the helper dedupes.
  useEffect(() => {
    const missing = scripts.filter((s) => !s.coverUrl && (s.title || s.synopsisText || s.plot));
    if (missing.length === 0) return;
    for (const s of missing) {
      void ensureScriptCover({
        script: s,
        uploadCover: callImage as any,
        onUpdate: () => refresh(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scripts.length, isAuthenticated]);

  const handleDelete = (id: string) => {
    setScripts(removeScript(id));
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="text-center">
        <h1 className="font-display text-4xl font-bold">{t.scripts_title}</h1>
        <p className="text-text-secondary mt-1">{t.sl_subtitle}</p>
      </div>

      {!authLoading && !isAuthenticated && (
        <div className="panel p-4 flex items-center justify-between gap-3 border border-accent/30 bg-accent-dim/40">
          <div className="flex items-center gap-3 text-sm">
            <Cloud size={18} className="text-accent shrink-0" />
            <div>
              <div className="font-semibold text-text-primary">{t.sl_login_to_sync}</div>
              <div className="text-text-secondary text-xs mt-0.5">{t.sl_login_sync_desc}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              to="/login"
              search={{ redirect: undefined }}
              className="btn-primary inline-flex items-center gap-1.5 text-sm"
            >
              <LogIn size={14} /> {t.sl_login}
            </Link>
            <Link to="/register" className="text-sm text-accent hover:underline">
              {t.sl_register}
            </Link>
          </div>
        </div>
      )}

      {!authLoading && isAuthenticated && (
        <div className="flex items-center justify-end gap-3 text-xs text-text-muted">
          <Cloud size={12} className="text-accent" />
          <span>{t.sl_logged_in.replace("{email}", user?.email ?? "")}</span>
          <button onClick={() => void signOut()} className="text-accent hover:underline">
            {t.sl_logout}
          </button>
        </div>
      )}

      <ScriptComposer
        types={TYPES}
        genres={GENRES}
        tones={TONES}
        models={models}
        onSaved={refresh}
      />

      <div className="space-y-3">
        <h2 className="font-display text-xl font-bold">
          {t.scripts_library} ({scripts.length})
        </h2>

        {scripts.length === 0 ? (
          <div className="panel py-16 text-center">
            <MessageSquare size={40} className="text-text-muted mx-auto mb-3" />
            <p className="text-text-muted text-sm">{t.script_no_content}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {scripts.map((s) => {
              const palette = s.characters?.[0]?.palette ?? ["#7c3aed", "#ec4899", "#f97316"];
              const bg = `linear-gradient(135deg, ${palette[0]}, ${palette[palette.length - 1]})`;
              const epCount = s.episodesText?.length ?? 0;
              const sceneCount = s.scenes?.length ?? 0;
              const preview =
                s.logline ||
                (s.synopsisText
                  ? s.synopsisText
                      .replace(/[#*`>_\-]/g, "")
                      .replace(/\s+/g, " ")
                      .trim()
                      .slice(0, 90)
                  : s.plot);
              return (
                <div key={s.id} className="panel overflow-hidden group">
                  <Link to="/scripts/$scriptId" params={{ scriptId: s.id }} className="block">
                    <div
                      className="h-24 relative overflow-hidden"
                      style={s.coverUrl ? undefined : { background: bg }}
                    >
                      {s.coverUrl ? (
                        <img
                          src={s.coverUrl}
                          alt={s.title}
                          loading="lazy"
                          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                        />
                      ) : (
                        <div
                          className="absolute inset-0 opacity-30 mix-blend-overlay"
                          style={{
                            backgroundImage:
                              "linear-gradient(0deg, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
                            backgroundSize: "20px 20px",
                          }}
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                      <span className="absolute top-2 left-2 chip chip-active text-[10px]">
                        {s.type}
                      </span>
                      <span className="absolute top-2 right-2 text-[10px] text-white/90 px-1.5 py-0.5 rounded bg-black/40 backdrop-blur-sm">
                        {epCount > 0
                          ? t.sl_ep_count.replace("{count}", String(epCount))
                          : t.sl_scene_count.replace("{count}", String(sceneCount))}
                      </span>
                    </div>
                    <div className="p-3 space-y-1.5">
                      <div className="font-semibold text-text-primary truncate">{s.title}</div>
                      <div className="text-xs text-text-muted truncate">
                        {Array.isArray(s.genre) ? s.genre.join("、") : s.genre} ·{" "}
                        {Array.isArray(s.tone) ? s.tone.join("、") : s.tone}
                      </div>
                      {preview && (
                        <div className="text-xs text-text-secondary line-clamp-2">{preview}</div>
                      )}
                      {s.quality ? (
                        <div className="flex gap-1 pt-1 text-[10px] text-text-muted">
                          <span>♥ {s.quality.pacing}</span>
                          <span>⚡ {s.quality.conflict}</span>
                          <span>💬 {s.quality.dialogueDensity}</span>
                        </div>
                      ) : (
                        <div className="text-[10px] text-text-muted pt-1">
                          {t.sl_updated.replace("{time}", new Date(s.updatedAt).toLocaleString())}
                        </div>
                      )}
                    </div>
                  </Link>
                  <div className="flex items-center justify-between px-3 pb-3">
                    <Link
                      to="/scripts/$scriptId"
                      params={{ scriptId: s.id }}
                      className="text-xs text-accent hover:underline inline-flex items-center gap-1"
                    >
                      <FileText size={12} /> {t.script_step_open_detail}
                    </Link>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          if (!isAuthenticated) {
                            toast(t.sl_share_login, {
                              action: {
                                label: t.auth_to_signin,
                                onClick: () =>
                                  navigate({ to: "/login", search: { redirect: undefined } }),
                              },
                            });
                            return;
                          }
                          setShareScript(s);
                        }}
                        title={t.share_title}
                        className="p-1.5 rounded hover:bg-bg-elevated text-text-muted hover:text-accent"
                      >
                        <Share2 size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="p-1.5 rounded hover:bg-bg-elevated text-text-muted hover:text-red-400"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {shareScript && (
        <ShareDialog
          open
          onClose={() => setShareScript(null)}
          kind="script"
          sourceId={shareScript.id}
          defaultTitle={shareScript.title}
          defaultSummary={shareScript.logline || shareScript.premise || ""}
          coverGradient={(() => {
            const palette = shareScript.characters?.[0]?.palette ?? [
              "#7c3aed",
              "#ec4899",
              "#f97316",
            ];
            return `linear-gradient(135deg, ${palette[0]}, ${palette[palette.length - 1]})`;
          })()}
          payload={shareScript}
        />
      )}
    </div>
  );
}
