import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Trash2, Globe, Lock, Link2 } from "lucide-react";
import {
  listMyPosts,
  updatePostVisibility,
  deletePost,
  type PostVisibility,
} from "@/lib/community.functions";

export const Route = createFileRoute("/account/posts")({
  head: () => ({ meta: [{ title: "我的发布 — Doopoo" }] }),
  component: MyPostsPage,
});

function MyPostsPage() {
  const list = useServerFn(listMyPosts);
  const setVis = useServerFn(updatePostVisibility);
  const del = useServerFn(deletePost);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof list>>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    list()
      .then((r) => setRows(r))
      .finally(() => setLoading(false));
  }, [list]);

  const changeVis = async (id: string, v: PostVisibility) => {
    await setVis({ data: { id, visibility: v } });
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, visibility: v } : r)));
  };
  const remove = async (id: string) => {
    if (!confirm("确定删除该作品？")) return;
    await del({ data: { id } });
    setRows((rs) => rs.filter((r) => r.id !== id));
  };

  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl font-bold">我的发布 ({rows.length})</h2>
      {loading ? (
        <div className="panel p-10 text-center text-text-muted text-sm">加载中…</div>
      ) : rows.length === 0 ? (
        <div className="panel p-10 text-center text-text-muted text-sm">
          还没有发布作品。前往
          <Link to="/scripts" className="text-accent mx-1">
            剧本库
          </Link>
          分享你的第一个作品。
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="panel p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <Link
                  to="/community/$postId"
                  params={{ postId: r.id }}
                  className="font-semibold truncate hover:text-accent"
                >
                  {r.title}
                </Link>
                <div className="text-xs text-text-muted mt-0.5">
                  {r.kind} · ♥ {r.likes_count} · 👁 {r.views_count} ·{" "}
                  {new Date(r.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs">
                <VisButton
                  active={r.visibility === "public"}
                  icon={Globe}
                  label="公开"
                  onClick={() => changeVis(r.id, "public")}
                />
                <VisButton
                  active={r.visibility === "unlisted"}
                  icon={Link2}
                  label="仅链接"
                  onClick={() => changeVis(r.id, "unlisted")}
                />
                <VisButton
                  active={r.visibility === "private"}
                  icon={Lock}
                  label="私有"
                  onClick={() => changeVis(r.id, "private")}
                />
              </div>
              <button
                onClick={() => remove(r.id)}
                className="p-1.5 rounded hover:bg-bg-elevated text-text-muted hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VisButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Globe;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded inline-flex items-center gap-1 transition ${
        active ? "bg-accent text-bg" : "bg-bg-elevated text-text-muted hover:text-text-primary"
      }`}
    >
      <Icon size={12} /> {label}
    </button>
  );
}
