import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { ArrowLeft, Copy, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "../i18n/LanguageContext";
import type { AssetTab, CharacterAsset, SceneAsset, PropAsset } from "../data/assetTypes";
import { assetToMarkdown, downloadMarkdown } from "../lib/assetMarkdown";
import {
  loadCharacters,
  loadScenes,
  loadProps,
  type DbCharacter,
  type DbScene,
  type DbProp,
} from "../lib/assetsStorage";
import { useAuth } from "../hooks/useAuth";

export const Route = createFileRoute("/assets_/$tab/$id")({
  component: AssetDetailPage,
});

function AssetDetailPage() {
  const { tab, id } = Route.useParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user } = useAuth();

  const [dbAsset, setDbAsset] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        if (tab === "character") {
          const { data } = await loadCharacters(user.id);
          const found = data?.find((c: DbCharacter) => c.id === id);
          if (found) {
            const dbImages: { url: string; label: string }[] = Array.isArray((found as any).images)
              ? (found as any).images
              : [];
            setDbAsset({
              id: found.id,
              name: found.name,
              emoji: "👤",
              gradient: found.gradient || "from-blue-400/40 via-purple-300/30 to-pink-200/30",
              cover: found.cover_url || "",
              views: { front: "", side: "", back: "", expression: "" },
              images: dbImages.length > 0 ? dbImages : undefined,
              role: found.role_label || found.role || "",
              age: String(found.age ?? ""),
              personality: found.personality || "",
              style: "",
              costume: found.look || "",
              appearance: found.look || "",
              background: found.motivation || "",
              palette: Array.isArray(found.palette) ? found.palette : [],
              tags: [found.role || "", found.mbti ? `MBTI ${found.mbti}` : ""].filter(Boolean),
              summary: `${found.role_label || found.role || "角色"} · ${found.personality || ""}`,
            });
          }
        } else if (tab === "scene") {
          const { data } = await loadScenes(user.id);
          const found = data?.find((s: DbScene) => s.id === id);
          if (found) {
            setDbAsset({
              id: found.id,
              name: found.name || found.location,
              emoji: "🌄",
              gradient: found.gradient || "from-emerald-400/40 via-teal-300/30 to-sky-200/30",
              time: found.time_of_day || "",
              mood: found.mood || "",
              shot: found.shot || "",
              lighting: found.lighting || "",
              sound: found.sound || "",
              reference: found.reference || "",
              tags: [found.location, found.time_of_day].filter(Boolean),
              summary: found.action || "",
              cover: found.cover_url || "",
              images: Array.isArray((found as any).images) ? (found as any).images : undefined,
              location: found.location || "",
              action: found.action || "",
              beats: Array.isArray(found.beats) ? found.beats : [],
              dialogue: found.dialogue || "",
            });
          }
        } else if (tab === "prop") {
          const { data } = await loadProps(user.id);
          const found = data?.find((p: DbProp) => p.id === id);
          if (found) {
            setDbAsset({
              id: found.id,
              name: found.name,
              emoji: "📦",
              gradient: found.gradient || "from-teal-400/40 via-cyan-300/30 to-emerald-200/30",
              cover: found.cover_url || "",
              images: Array.isArray((found as any).images) ? (found as any).images : undefined,
              owner: found.owner || "",
              appearance: found.description || "",
              firstAppear: "",
              lastAppear: "",
              material: found.visual_style || "",
              symbol: found.key_moments || "",
              detail: found.movement_description || found.description || "",
              summary: found.description || "",
              tags: [found.visual_style, found.palette].filter(Boolean),
            });
          }
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    })();
  }, [tab, id, user]);

  const asset = dbAsset;

  if (loading) {
    return (
      <div className="animate-fade-in flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 size={24} className="animate-spin text-text-muted" />
        <p className="text-text-muted text-sm">加载中…</p>
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="animate-fade-in flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-text-muted">{t.asset_not_found}</p>
        <Link to="/assets" className="btn-ghost text-xs">
          <ArrowLeft size={14} /> {t.assets_back}
        </Link>
      </div>
    );
  }

  const labels = {
    role: t.assets_field_role,
    age: t.assets_field_age,
    personality: t.assets_field_personality,
    style: t.assets_field_style,
    costume: t.assets_field_costume,
    appearance: t.assets_field_appearance_desc,
    background: t.assets_field_background,
    palette: t.assets_field_palette,
    tags: t.assets_field_tags,
    summary: t.assets_field_summary,
    time: t.assets_field_time,
    mood: t.assets_field_mood,
    shot: t.assets_field_shot,
    lighting: t.assets_field_lighting,
    sound: t.assets_field_sound,
    reference: t.assets_field_reference,
    owner: t.assets_field_owner,
    symbol: t.assets_field_symbol,
    material: t.assets_field_material,
    firstAppear: t.assets_field_first_appear,
    lastAppear: t.assets_field_last_appear,
    detail: t.assets_field_detail,
  };

  const md = assetToMarkdown(tab as AssetTab, asset, labels);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(md);
      toast.success(t.assets_copied);
    } catch {
      toast.error(t.common_error);
    }
  };

  const handleExport = () => {
    downloadMarkdown(asset.name, md);
  };

  const tabLabel =
    tab === "character"
      ? t.assets_tab_character
      : tab === "scene"
        ? t.assets_tab_scene
        : t.assets_tab_prop;

  return (
    <div className="animate-fade-in flex flex-col gap-6">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate({ to: "/assets" })}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition"
          >
            <ArrowLeft size={14} /> {t.assets_back}
          </button>
          <span className="text-text-muted text-xs">/</span>
          <Link
            to="/assets"
            className="text-xs text-text-secondary hover:text-text-primary transition"
          >
            {t.assets_title}
          </Link>
          <span className="text-text-muted text-xs">/</span>
          <Link
            to="/assets"
            search={{ tab }}
            className="text-xs text-text-secondary hover:text-text-primary transition"
          >
            {tabLabel}
          </Link>
          <span className="text-text-muted text-xs">/</span>
          <span className="text-xs text-text-primary font-medium">{asset.name}</span>
        </div>
        {tab === "character" && (
          <div className="flex items-center gap-2">
            <button onClick={handleCopy} className="btn-ghost text-xs">
              <Copy size={14} /> {t.assets_copy_md}
            </button>
            <button onClick={handleExport} className="btn-primary text-xs">
              <Download size={14} /> {t.assets_export_md}
            </button>
          </div>
        )}
      </header>

      {tab === "character" && <CharacterDetail c={asset as CharacterAsset} />}
      {tab === "scene" && (
        <SceneDetail
          s={
            asset as SceneAsset & {
              cover?: string;
              location?: string;
              action?: string;
              beats?: string[];
              dialogue?: string;
            }
          }
        />
      )}
      {tab === "prop" && <PropDetail p={asset as PropAsset} />}
    </div>
  );
}

/* ---------------- Character ---------------- */
function CharacterDetail({ c }: { c: CharacterAsset }) {
  const { t } = useLanguage();
  // 优先使用 DB 中已生成的图片列表(动态),fallback 到 mock 固定 views
  const imageList =
    c.images && c.images.length > 0
      ? c.images.map((img, i) => ({ key: `img-${i}`, label: img.label, src: img.url }))
      : c.cover
        ? [{ key: "cover", label: t.assets_view_master, src: c.cover }]
        : [];
  const [active, setActive] = useState(imageList[0] || null);

  if (!imageList.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-text-muted">
        <p>{c.name}</p>
        <p className="text-sm">暂无已生成的图片</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left: hero image + thumbs */}
      <section className="lg:col-span-7 flex flex-col gap-3">
        <div
          className={`panel overflow-hidden bg-gradient-to-br ${c.gradient} aspect-[4/5] flex items-center justify-center`}
        >
          {active && (
            <img
              key={active.key}
              src={active.src}
              alt={`${c.name} - ${active.label}`}
              loading="lazy"
              className="w-full h-full object-contain animate-fade-in"
            />
          )}
        </div>
        {imageList.length > 1 && (
          <div className="grid grid-cols-5 gap-2">
            {imageList.map((v) => (
              <button
                key={v.key}
                onClick={() => setActive(v)}
                className={`relative panel overflow-hidden aspect-square flex flex-col items-center justify-center transition ${
                  active?.key === v.key
                    ? "ring-2 ring-accent border-accent/50"
                    : "hover:border-accent/40"
                }`}
              >
                {v.src ? (
                  <img
                    src={v.src}
                    alt={v.label}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-2xl opacity-30">?</span>
                )}
                <span className="absolute bottom-1 left-1 right-1 text-[10px] text-white bg-black/40 rounded px-1 text-center truncate">
                  {v.label}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Right: meta */}
      <section className="lg:col-span-5 flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-bold text-text-primary tracking-tight">{c.name}</h1>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {c.tags.map((tag) => (
              <span
                key={tag}
                className="text-[11px] px-2 py-0.5 rounded-full bg-bg-elevated border border-border text-text-secondary"
              >
                {tag}
              </span>
            ))}
          </div>
          <p className="text-sm text-text-secondary mt-3 leading-relaxed">{c.summary}</p>
        </div>

        <div className="panel p-4 flex flex-col gap-2">
          <Row label={t.assets_field_role} value={c.role} />
          <Row label={t.assets_field_age} value={c.age} />
          <Row label={t.assets_field_personality} value={c.personality} />
          <Row label={t.assets_field_style} value={c.style} />
          <Row label={t.assets_field_costume} value={c.costume} />
        </div>

        <Block title={t.assets_field_appearance_desc} body={c.appearance} />
        <Block title={t.assets_field_background} body={c.background} />

        <div className="panel p-4">
          <div className="text-xs text-text-muted mb-2">{t.assets_field_palette}</div>
          <div className="flex flex-wrap gap-2">
            {c.palette.map((hex) => (
              <div
                key={hex}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-elevated border border-border"
              >
                <span className="w-4 h-4 rounded" style={{ backgroundColor: hex }} />
                <span className="text-[11px] text-text-secondary font-mono">{hex}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

/* ---------------- Scene ---------------- */
function SceneDetail({
  s,
}: {
  s: SceneAsset & {
    cover?: string;
    location?: string;
    action?: string;
    beats?: string[];
    dialogue?: string;
  };
}) {
  const { t } = useLanguage();
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-5">
        <AssetImageGallery
          images={s.images}
          cover={s.cover}
          name={s.name}
          fallback={<span className="text-8xl drop-shadow-lg">{s.emoji}</span>}
          gradient={s.gradient}
          heightClass="aspect-[4/3] lg:aspect-square"
          imageClass="object-contain"
        />
      </div>
      <section className="lg:col-span-7 flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-bold text-text-primary tracking-tight">{s.name}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {s.tags.map((tag) => (
              <span
                key={tag}
                className="text-[11px] px-2 py-0.5 rounded-full bg-bg-elevated border border-border text-text-secondary"
              >
                {tag}
              </span>
            ))}
          </div>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary">{s.summary}</p>
        </div>
        <div className="panel p-4 flex flex-col gap-2">
          <Row label="地点" value={s.location || ""} />
          <Row label={t.assets_field_time} value={s.time} />
          <Row label="动作" value={s.action || ""} />
          <Row label={t.assets_field_mood} value={s.mood} />
          <Row label={t.assets_field_shot} value={s.shot} />
          <Row label={t.assets_field_lighting} value={s.lighting} />
          <Row label={t.assets_field_sound} value={s.sound} />
          <Row label={t.assets_field_reference} value={s.reference} />
        </div>
        {s.beats?.length ? <Block title="剧情节点" body={s.beats.join("\n")} /> : null}
      </section>
    </div>
  );
}

/* ---------------- Prop ---------------- */
function PropDetail({ p }: { p: PropAsset }) {
  const { t } = useLanguage();
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-5">
        <AssetImageGallery
          images={p.images}
          cover={(p as PropAsset & { cover?: string }).cover}
          name={p.name}
          fallback={<span className="text-9xl drop-shadow-lg">{p.emoji}</span>}
          gradient={p.gradient}
          heightClass="aspect-square"
          imageClass="object-contain"
        />
      </div>
      <section className="lg:col-span-7 flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-bold text-text-primary tracking-tight">{p.name}</h1>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {p.tags.map((tag) => (
              <span
                key={tag}
                className="text-[11px] px-2 py-0.5 rounded-full bg-bg-elevated border border-border text-text-secondary"
              >
                {tag}
              </span>
            ))}
          </div>
          <p className="text-sm text-text-secondary mt-3 leading-relaxed">{p.summary}</p>
        </div>
        <div className="panel p-4 flex flex-col gap-2">
          <Row label={t.assets_field_owner} value={p.owner} />
          <Row label={t.assets_field_appearance} value={p.appearance} />
          <Row label={t.assets_field_first_appear} value={p.firstAppear} />
          <Row label={t.assets_field_last_appear} value={p.lastAppear} />
          <Row label={t.assets_field_material} value={p.material} />
          <Row label={t.assets_field_symbol} value={p.symbol} />
        </div>
        <Block title={t.assets_field_detail} body={p.detail} />
      </section>
    </div>
  );
}

/* ---------------- Shared ---------------- */
function AssetImageGallery({
  images,
  cover,
  name,
  fallback,
  gradient,
  heightClass,
  imageClass = "object-cover",
}: {
  images?: { url: string; label: string }[];
  cover?: string;
  name: string;
  fallback: React.ReactNode;
  gradient: string;
  heightClass: string;
  imageClass?: string;
}) {
  const imageList = images?.length ? images : cover ? [{ url: cover, label: "主图" }] : [];
  const [active, setActive] = useState(imageList[0]);

  return (
    <div className="flex flex-col gap-3">
      <ImageStage
        initialUrl={active?.url}
        fallback={fallback}
        gradient={gradient}
        heightClass={heightClass}
        imageClass={imageClass}
      />
      {imageList.length > 1 && (
        <div className="grid grid-cols-5 gap-2">
          {imageList.map((image, index) => (
            <button
              key={`${image.url}-${index}`}
              onClick={() => setActive(image)}
              className={`relative panel overflow-hidden aspect-square transition ${
                active?.url === image.url
                  ? "ring-2 ring-accent border-accent/50"
                  : "hover:border-accent/40"
              }`}
            >
              <img
                src={image.url}
                alt={`${name} - ${image.label}`}
                loading="lazy"
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-1 left-1 right-1 text-[10px] text-white bg-black/40 rounded px-1 text-center truncate">
                {image.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ImageStage({
  fallback,
  gradient,
  heightClass,
  initialUrl = "",
  imageClass = "object-cover",
}: {
  fallback: React.ReactNode;
  gradient: string;
  heightClass: string;
  initialUrl?: string;
  imageClass?: string;
}) {
  return (
    <div>
      <div
        className={`panel overflow-hidden bg-gradient-to-br ${gradient} ${heightClass} flex items-center justify-center relative`}
      >
        {initialUrl ? (
          <img src={initialUrl} alt="" className={`w-full h-full ${imageClass} animate-fade-in`} />
        ) : (
          fallback
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="text-text-muted shrink-0 w-20">{label}</span>
      <span className="text-text-secondary">{value}</span>
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel p-4">
      <div className="text-xs text-text-muted mb-2">{title}</div>
      <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">{body}</p>
    </div>
  );
}
