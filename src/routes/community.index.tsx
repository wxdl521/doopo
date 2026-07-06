import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listCommunityPosts, type PostKind } from "@/lib/community.functions";
import CommunityCard, { type CommunityCardItem } from "@/components/community/CommunityCard";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/community/")({
  component: CommunityIndex,
});

type Sort = "recent" | "hot" | "likes";
const SORTS: { value: Sort }[] = [{ value: "hot" }, { value: "recent" }, { value: "likes" }];
const KINDS: { value: PostKind | "all" }[] = [
  { value: "all" },
  { value: "script" },
  { value: "character" },
  { value: "scene" },
  { value: "prop" },
  { value: "comic" },
];

function CommunityIndex() {
  const { t } = useLanguage();
  const [sort, setSort] = useState<Sort>("hot");
  const [kind, setKind] = useState<PostKind | "all">("all");
  const [items, setItems] = useState<CommunityCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const list = useServerFn(listCommunityPosts);

  const sortLabels: Record<Sort, string> = {
    hot: t.community_sort_hot,
    recent: t.community_sort_recent,
    likes: t.community_sort_likes,
  };
  const kindLabels: Record<PostKind | "all", string> = {
    all: t.community_kind_all,
    script: t.community_kind_script,
    character: t.community_kind_character,
    scene: t.community_kind_scene,
    prop: t.community_kind_prop,
    comic: t.community_kind_comic,
  };

  useEffect(() => {
    setLoading(true);
    list({ data: { sort, limit: 36, kind: kind === "all" ? undefined : kind } })
      .then((data) => setItems(data as CommunityCardItem[]))
      .finally(() => setLoading(false));
  }, [sort, kind, list]);

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="font-display text-3xl md:text-4xl font-bold">{t.community_title}</h1>
        <p className="text-text-secondary mt-1">{t.community_subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {SORTS.map((s) => (
          <button
            key={s.value}
            onClick={() => setSort(s.value)}
            className={`chip !py-2 !px-3.5 text-sm ${sort === s.value ? "chip-active" : ""}`}
          >
            {sortLabels[s.value]}
          </button>
        ))}
        <span className="mx-2 text-text-muted text-xs">·</span>
        {KINDS.map((k) => (
          <button
            key={k.value}
            onClick={() => setKind(k.value)}
            className={`chip !py-2 !px-3.5 text-sm ${kind === k.value ? "chip-active" : ""}`}
          >
            {kindLabels[k.value]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="panel p-10 text-center text-text-muted text-sm">{t.community_loading}</div>
      ) : items.length === 0 ? (
        <div className="panel p-10 text-center text-text-muted text-sm">{t.community_empty}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((it) => (
            <CommunityCard key={it.id} item={it} />
          ))}
        </div>
      )}
    </div>
  );
}
