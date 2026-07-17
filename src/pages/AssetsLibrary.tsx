import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import { ChevronDown, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "../i18n/LanguageContext";
import { useAuth } from "../hooks/useAuth";
import {
  loadCharacters,
  loadScenes,
  loadProps,
  deleteCharacter,
  deleteScene,
  deleteProp,
} from "../lib/assetsStorage";
import type { DbCharacter, DbProp, DbScene } from "../lib/assetsStorage";

type Scope = "personal" | "team";
type AssetTab = "character" | "scene" | "prop";
type AssetLoadStatus = "idle" | "loading" | "success" | "error";

const ASSET_PAGE_SIZE = 20;

const initialLoadStatus: Record<AssetTab, AssetLoadStatus> = {
  character: "idle",
  scene: "idle",
  prop: "idle",
};

const initialLoadMoreStatus: Record<AssetTab, boolean> = {
  character: false,
  scene: false,
  prop: false,
};

export default function AssetsLibrary() {
  const { t } = useLanguage();
  const { user, isAuthenticated } = useAuth();
  const { tab: requestedTab } = useSearch({ from: "/assets" });
  const [tab, setTab] = useState<AssetTab>("character");
  const [scope, setScope] = useState<Scope>("personal");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [dbCharacters, setDbCharacters] = useState<DbCharacter[]>([]);
  const [dbScenes, setDbScenes] = useState<DbScene[]>([]);
  const [dbProps, setDbProps] = useState<DbProp[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] =
    useState<Record<AssetTab, AssetLoadStatus>>(initialLoadStatus);
  const [hasMore, setHasMore] = useState<Record<AssetTab, boolean>>(initialLoadMoreStatus);
  const [loadingMore, setLoadingMore] = useState<Record<AssetTab, boolean>>(initialLoadMoreStatus);
  const [loadMoreError, setLoadMoreError] =
    useState<Record<AssetTab, boolean>>(initialLoadMoreStatus);
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef<Record<AssetTab, boolean>>(initialLoadMoreStatus);

  useEffect(() => {
    if (requestedTab) setTab(requestedTab);
  }, [requestedTab]);

  const refresh = useCallback(
    async (kind: AssetTab, userId = user?.id) => {
      if (!userId) return;

      setLoadStatus((current) => ({ ...current, [kind]: "loading" }));
      try {
        if (kind === "character") {
          const { data, error } = await loadCharacters(userId, 0, ASSET_PAGE_SIZE);
          if (error) throw error;
          setDbCharacters((data ?? []).slice(0, ASSET_PAGE_SIZE));
          setHasMore((current) => ({ ...current, [kind]: (data?.length ?? 0) > ASSET_PAGE_SIZE }));
        } else if (kind === "scene") {
          const { data, error } = await loadScenes(userId, 0, ASSET_PAGE_SIZE);
          if (error) throw error;
          setDbScenes((data ?? []).slice(0, ASSET_PAGE_SIZE));
          setHasMore((current) => ({ ...current, [kind]: (data?.length ?? 0) > ASSET_PAGE_SIZE }));
        } else {
          const { data, error } = await loadProps(userId, 0, ASSET_PAGE_SIZE);
          if (error) throw error;
          setDbProps((data ?? []).slice(0, ASSET_PAGE_SIZE));
          setHasMore((current) => ({ ...current, [kind]: (data?.length ?? 0) > ASSET_PAGE_SIZE }));
        }

        setLoadStatus((current) => ({ ...current, [kind]: "success" }));
      } catch (error) {
        // Includes Supabase query errors and network failures, which both need a retry path.
        console.warn(`[assets] Failed to load ${kind} assets:`, error);
        setLoadStatus((current) => ({ ...current, [kind]: "error" }));
      }
    },
    [user?.id],
  );

  async function handleDelete(kind: "character" | "scene" | "prop", id: string, label: string) {
    if (!user) return;
    if (!confirm(`确定要从资产库移除「${label}」吗?`)) return;
    setDeletingId(id);
    try {
      const r =
        kind === "character"
          ? await deleteCharacter(id, user.id)
          : kind === "scene"
            ? await deleteScene(id, user.id)
            : await deleteProp(id, user.id);
      if (r.error) {
        toast.error(`删除失败:${r.error}`);
        return;
      }
      toast.success("已从资产库移除");
      await refresh(kind);
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      void Promise.all([
        refresh("character", user.id),
        refresh("scene", user.id),
        refresh("prop", user.id),
      ]);
    }
  }, [isAuthenticated, user?.id, refresh]);

  const loadMore = useCallback(
    async (kind: AssetTab) => {
      const userId = user?.id;
      if (!userId || loadingMoreRef.current[kind]) return;

      loadingMoreRef.current[kind] = true;
      setLoadingMore((current) => ({ ...current, [kind]: true }));
      setLoadMoreError((current) => ({ ...current, [kind]: false }));
      try {
        if (kind === "character") {
          const { data, error } = await loadCharacters(
            userId,
            dbCharacters.length,
            dbCharacters.length + ASSET_PAGE_SIZE,
          );
          if (error) throw error;
          const next = data ?? [];
          setDbCharacters((current) => [...current, ...next.slice(0, ASSET_PAGE_SIZE)]);
          setHasMore((current) => ({ ...current, [kind]: next.length > ASSET_PAGE_SIZE }));
        } else if (kind === "scene") {
          const { data, error } = await loadScenes(
            userId,
            dbScenes.length,
            dbScenes.length + ASSET_PAGE_SIZE,
          );
          if (error) throw error;
          const next = data ?? [];
          setDbScenes((current) => [...current, ...next.slice(0, ASSET_PAGE_SIZE)]);
          setHasMore((current) => ({ ...current, [kind]: next.length > ASSET_PAGE_SIZE }));
        } else {
          const { data, error } = await loadProps(
            userId,
            dbProps.length,
            dbProps.length + ASSET_PAGE_SIZE,
          );
          if (error) throw error;
          const next = data ?? [];
          setDbProps((current) => [...current, ...next.slice(0, ASSET_PAGE_SIZE)]);
          setHasMore((current) => ({ ...current, [kind]: next.length > ASSET_PAGE_SIZE }));
        }
      } catch (error) {
        console.warn(`[assets] Failed to load more ${kind} assets:`, error);
        setLoadMoreError((current) => ({ ...current, [kind]: true }));
        toast.error(t.assets_load_failed);
      } finally {
        loadingMoreRef.current[kind] = false;
        setLoadingMore((current) => ({ ...current, [kind]: false }));
      }
    },
    [dbCharacters.length, dbProps.length, dbScenes.length, t.assets_load_failed, user?.id],
  );

  useEffect(() => {
    const target = loadMoreTriggerRef.current;
    if (!target || !hasMore[tab] || loadingMore[tab] || loadMoreError[tab]) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void loadMore(tab);
      },
      { rootMargin: "240px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadMore, loadingMore, loadMoreError, tab]);

  const tabs: { key: AssetTab; label: string }[] = [
    { key: "character", label: t.assets_tab_character },
    { key: "scene", label: t.assets_tab_scene },
    { key: "prop", label: t.assets_tab_prop },
  ];

  const renderCards = () => {
    if (loadStatus[tab] === "idle" || loadStatus[tab] === "loading") {
      return <Loading />;
    }

    if (loadStatus[tab] === "error") {
      return <LoadFailed onRetry={() => void refresh(tab)} />;
    }

    if (tab === "character") {
      const allChars = dbCharacters.map((c) => ({
        id: c.id,
        name: c.name,
        emoji: "👤",
        gradient: c.gradient || "from-blue-400/40 via-purple-300/30 to-pink-200/30",
        cover: c.cover_url || undefined,
        summary: `${c.role_label || c.role} · ${c.personality || ""}`,
        tags: [c.role, c.mbti ? `MBTI ${c.mbti}` : ""].filter(Boolean),
        role: c.role_label || c.role,
        age: String(c.age || ""),
        personality: c.personality || "",
        fromDb: true,
      }));
      if (!allChars.length) return <Empty />;
      return (
        <>
          <Grid>
            {allChars.map((c) => (
              <Card
                key={c.id}
                tab="character"
                id={c.id}
                title={c.name}
                emoji={c.emoji}
                gradient={c.gradient}
                cover={c.cover}
                summary={c.summary}
                tags={c.tags}
                onDelete={c.fromDb ? () => handleDelete("character", c.id, c.name) : undefined}
                deleting={deletingId === c.id}
              >
                <Field label={t.assets_field_role} value={c.role} />
                <Field label={t.assets_field_age} value={c.age} />
                <Field label={t.assets_field_personality} value={c.personality} />
              </Card>
            ))}
          </Grid>
          <LoadMore />
        </>
      );
    }
    if (tab === "scene") {
      const allScenes = dbScenes.map((s) => ({
        id: s.id,
        name: s.name,
        emoji: "🎬",
        gradient: s.gradient || "from-orange-400/40 via-amber-300/30 to-yellow-200/30",
        cover: s.cover_url || undefined,
        summary: s.action?.slice(0, 100) || s.location || "",
        tags: [s.time_of_day].filter(Boolean),
        time: s.time_of_day || "",
        mood: "",
        shot: "",
        fromDb: true,
      }));
      if (!allScenes.length) return <Empty />;
      return (
        <>
          <Grid>
            {allScenes.map((s) => (
              <Card
                key={s.id}
                tab="scene"
                id={s.id}
                title={s.name}
                emoji={s.emoji}
                gradient={s.gradient}
                cover={s.cover}
                summary={s.summary}
                tags={s.tags}
                onDelete={s.fromDb ? () => handleDelete("scene", s.id, s.name) : undefined}
                deleting={deletingId === s.id}
              >
                <Field label={t.assets_field_time} value={s.time} />
                <Field label={t.assets_field_mood} value={s.mood} />
                <Field label={t.assets_field_shot} value={s.shot} />
              </Card>
            ))}
          </Grid>
          <LoadMore />
        </>
      );
    }
    if (tab === "prop") {
      const allProps = dbProps.map((p) => ({
        id: p.id,
        name: p.name,
        emoji: "📦",
        gradient: p.gradient || "from-teal-400/40 via-cyan-300/30 to-emerald-200/30",
        cover: p.cover_url || undefined,
        summary: p.description?.slice(0, 100) || "",
        tags: [] as string[],
        owner: p.owner || "",
        appearance: p.description || "",
        symbol: p.key_moments || "",
        fromDb: true,
      }));
      if (!allProps.length) return <Empty />;
      return (
        <>
          <Grid>
            {allProps.map((p) => (
              <Card
                key={p.id}
                tab="prop"
                id={p.id}
                title={p.name}
                emoji={p.emoji}
                gradient={p.gradient}
                cover={p.cover}
                summary={p.summary}
                tags={p.tags}
                onDelete={p.fromDb ? () => handleDelete("prop", p.id, p.name) : undefined}
                deleting={deletingId === p.id}
              >
                <Field label={t.assets_field_owner} value={p.owner} />
                <Field label={t.assets_field_appearance} value={p.appearance} />
                <Field label={t.assets_field_symbol} value={p.symbol} />
              </Card>
            ))}
          </Grid>
          <LoadMore />
        </>
      );
    }
  };

  function Empty() {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh] text-sm text-text-muted">
        {t.assets_empty}
      </div>
    );
  }

  function Loading() {
    return (
      <div
        className="flex flex-1 min-h-[60vh] flex-col items-center justify-center gap-3 text-sm text-text-muted"
        role="status"
        aria-live="polite"
      >
        <Loader2 size={28} className="animate-spin text-accent" />
        <span>{t.assets_loading}</span>
      </div>
    );
  }

  function LoadFailed({ onRetry }: { onRetry: () => void }) {
    return (
      <div
        className="flex flex-1 min-h-[60vh] flex-col items-center justify-center gap-3 text-center text-sm text-text-muted"
        role="alert"
      >
        <span>{t.assets_load_failed}</span>
        <button type="button" onClick={onRetry} className="btn-ghost text-xs">
          {t.assets_retry}
        </button>
      </div>
    );
  }

  function LoadMore() {
    if (!hasMore[tab] && !loadingMore[tab] && !loadMoreError[tab]) return null;

    return (
      <div
        ref={loadMoreError[tab] ? undefined : loadMoreTriggerRef}
        className="flex min-h-12 items-center justify-center text-xs text-text-muted"
        role="status"
        aria-live="polite"
      >
        {loadingMore[tab] && (
          <span className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-accent" />
            {t.assets_loading_more}
          </span>
        )}
        {loadMoreError[tab] && !loadingMore[tab] && (
          <button type="button" onClick={() => void loadMore(tab)} className="btn-ghost text-xs">
            {t.assets_load_more_failed} {t.assets_retry}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="animate-fade-in flex flex-col gap-6 px-1">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-text-primary tracking-tight">
            {t.assets_title}
          </h1>
        </div>
        <div className="relative">
          <button
            onClick={() => setScopeOpen((o) => !o)}
            className="flex items-center justify-between gap-3 min-w-[140px] px-4 py-2.5 rounded-xl bg-bg-elevated border border-border text-sm text-text-primary hover:border-accent/50 transition"
          >
            <span>{scope === "personal" ? t.assets_scope_personal : t.assets_scope_team}</span>
            <ChevronDown
              size={14}
              className={`text-text-muted transition ${scopeOpen ? "rotate-180" : ""}`}
            />
          </button>
          {scopeOpen && (
            <div className="absolute right-0 mt-1 min-w-[140px] rounded-xl bg-bg-elevated border border-border shadow-lg overflow-hidden z-10">
              {(["personal", "team"] as Scope[]).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setScope(s);
                    setScopeOpen(false);
                  }}
                  className={`w-full px-4 py-2 text-sm text-left hover:bg-bg-soft transition ${scope === s ? "text-accent" : "text-text-secondary"}`}
                >
                  {s === "personal" ? t.assets_scope_personal : t.assets_scope_team}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Tabs + add */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-bg-elevated border border-border">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`px-4 py-1.5 rounded-lg text-sm transition ${
                tab === tb.key
                  ? "bg-accent text-white shadow-sm"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>
        <button onClick={() => toast.info(t.assets_add)} className="btn-ghost text-xs">
          <Plus size={14} /> {t.assets_add}
        </button>
      </div>

      {/* Body */}
      {renderCards()}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {children}
    </div>
  );
}

function Card({
  tab,
  id,
  title,
  emoji,
  gradient,
  cover,
  summary,
  tags,
  children,
  onDelete,
  deleting,
}: {
  tab: AssetTab;
  id: string;
  title: string;
  emoji: string;
  gradient: string;
  cover?: string;
  summary: string;
  tags: string[];
  children: React.ReactNode;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  return (
    <div className="relative panel overflow-hidden flex flex-col group hover:border-accent/40 hover:-translate-y-0.5 transition">
      {/* 删除按钮(DB 来源的卡片才有)—— 浮在右上角,不触发卡片点击 */}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete();
          }}
          disabled={deleting}
          title="从我的资产库移除"
          className="absolute top-2 right-2 z-20 p-1.5 rounded-md bg-black/55 text-white hover:bg-rose-500 hover:text-white backdrop-blur-sm transition disabled:opacity-50"
          aria-label="删除资产"
        >
          {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
        </button>
      )}
      <Link to="/assets/$tab/$id" params={{ tab, id }} className="flex flex-col flex-1">
        <div
          className={`relative h-40 bg-gradient-to-br ${gradient} flex items-center justify-center overflow-hidden`}
        >
          {cover ? (
            <img
              src={cover}
              alt={title}
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <span className="text-5xl drop-shadow-lg group-hover:scale-110 transition-transform">
              {emoji}
            </span>
          )}
        </div>
        <div className="p-4 flex flex-col gap-2 flex-1">
          <h3 className="font-semibold text-text-primary">{title}</h3>
          <p className="text-xs text-text-muted line-clamp-2 leading-relaxed">{summary}</p>
          <div className="flex flex-col gap-1 mt-1">{children}</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-2 py-0.5 rounded-full bg-bg-elevated border border-border text-text-secondary"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </Link>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="text-text-muted shrink-0">{label}</span>
      <span className="text-text-secondary truncate">{value}</span>
    </div>
  );
}
