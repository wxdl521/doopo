import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Heart, Eye, Share2, Check } from "lucide-react";
import {
  getPost,
  recordView,
  toggleLike,
  isLiked,
  type CommunityPost,
} from "@/lib/community.functions";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/community/$postId")({
  head: ({ params }) => ({
    meta: [{ title: `社区作品 ${params.postId.slice(0, 8)} — Doopoo` }],
  }),
  component: PostPage,
});

function viewerKey(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const k = "doopoo_viewer_key";
    const cached = window.localStorage.getItem(k);
    if (cached) return cached;
    const fresh = window.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now();
    window.localStorage.setItem(k, fresh);
    return fresh;
  } catch {
    return "anon";
  }
}

function PostPage() {
  const { postId } = Route.useParams();
  const { isAuthenticated } = useAuth();
  const fetchPost = useServerFn(getPost);
  const view = useServerFn(recordView);
  const like = useServerFn(toggleLike);
  const checkLiked = useServerFn(isLiked);

  const [post, setPost] = useState<CommunityPost | null | "loading">("loading");
  const [likedState, setLiked] = useState(false);
  const [likes, setLikes] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchPost({ data: { id: postId } }).then((p) => {
      setPost(p);
      if (p) {
        setLikes(p.likes_count);
        void view({ data: { postId, viewerKey: viewerKey() } });
      }
    });
  }, [postId, fetchPost, view]);

  useEffect(() => {
    if (!isAuthenticated || !post || post === "loading") return;
    checkLiked({ data: { postId } })
      .then((r) => setLiked(r.liked))
      .catch(() => {});
  }, [isAuthenticated, post, postId, checkLiked]);

  if (post === "loading") {
    return <div className="p-10 text-center text-text-muted text-sm">加载中…</div>;
  }
  if (!post) {
    return (
      <div className="p-10 text-center text-text-muted">
        作品不存在或未公开。
        <Link to="/community" className="ml-2 text-accent">
          返回社区
        </Link>
      </div>
    );
  }

  const cover = post.cover_gradient;
  const onLike = async () => {
    if (!isAuthenticated) {
      alert("请先登录后再点赞");
      return;
    }
    setLiked((l) => !l);
    setLikes((n) => n + (likedState ? -1 : 1));
    try {
      const r = await like({ data: { postId } });
      setLiked(r.liked);
      setLikes(r.likesCount);
    } catch {
      setLiked((l) => !l);
      setLikes((n) => n + (likedState ? 1 : -1));
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="animate-fade-in max-w-4xl mx-auto">
      <Link
        to="/community"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-accent mb-4"
      >
        <ArrowLeft size={14} /> 返回社区
      </Link>
      <div
        className={`rounded-2xl overflow-hidden aspect-video mb-6 ${cover?.startsWith("bg-") ? cover : "bg-gradient-to-br from-indigo-700 via-violet-800 to-slate-950"}`}
        style={cover && !cover.startsWith("bg-") ? { background: cover } : undefined}
      />

      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div>
          <span className="chip chip-active text-[10px] uppercase">{post.kind}</span>
          <h1 className="font-display text-3xl font-bold mt-2">{post.title}</h1>
          <div className="text-xs text-text-muted mt-1 inline-flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Eye size={12} /> {post.views_count}
            </span>
            <span className="inline-flex items-center gap-1">
              <Heart size={12} /> {likes}
            </span>
            <span>{new Date(post.created_at).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onLike}
            className={`btn-ghost inline-flex items-center gap-1 ${likedState ? "!text-rose-500" : ""}`}
          >
            <Heart size={14} fill={likedState ? "currentColor" : "none"} /> {likes}
          </button>
          <button onClick={copyLink} className="btn-ghost inline-flex items-center gap-1">
            {copied ? <Check size={14} /> : <Share2 size={14} />} {copied ? "已复制链接" : "分享"}
          </button>
        </div>
      </div>

      {post.summary && <p className="text-text-secondary mb-6 max-w-3xl">{post.summary}</p>}

      <PostBody post={post} />
    </div>
  );
}

function PostBody({ post }: { post: CommunityPost }) {
  if (post.kind === "script") return <ScriptBody payload={post.payload} />;
  return <GenericBody payload={post.payload} />;
}

function ScriptBody({ payload }: { payload: unknown }) {
  const s = (payload ?? {}) as {
    logline?: string;
    premise?: string;
    synopsisText?: string;
    episodesText?: { epIndex: number; text: string }[];
    scenes?: { slug: string; action: string; dialogue?: { role: string; line: string }[] }[];
    content?: string;
  };
  return (
    <div className="space-y-4">
      {s.logline && (
        <div className="panel p-4">
          <div className="text-xs text-text-muted mb-1">Logline</div>
          <div className="text-sm">{s.logline}</div>
        </div>
      )}
      {s.synopsisText && (
        <div className="panel p-4 whitespace-pre-wrap text-sm leading-relaxed">
          {s.synopsisText}
        </div>
      )}
      {s.episodesText?.length ? (
        <div className="space-y-3">
          {s.episodesText.map((ep) => (
            <div key={ep.epIndex} className="panel p-4">
              <div className="text-xs text-text-muted mb-2">第 {ep.epIndex} 集</div>
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{ep.text}</pre>
            </div>
          ))}
        </div>
      ) : s.scenes?.length ? (
        <div className="space-y-3">
          {s.scenes.map((sc, i) => (
            <div key={i} className="panel p-4">
              <div className="font-semibold mb-1 text-sm">【{sc.slug}】</div>
              <div className="text-sm whitespace-pre-wrap mb-2">{sc.action}</div>
              {sc.dialogue?.map((d, j) => (
                <div key={j} className="text-sm">
                  <span className="font-semibold">{d.role}：</span>
                  {d.line}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : s.content ? (
        <pre className="panel p-4 whitespace-pre-wrap text-sm font-mono">{s.content}</pre>
      ) : (
        <div className="text-sm text-text-muted">作者未提供详细内容。</div>
      )}
    </div>
  );
}

function GenericBody({ payload }: { payload: unknown }) {
  const obj = (payload ?? {}) as Record<string, unknown>;
  const description = (obj.description ?? obj.bio ?? obj.note) as string | undefined;
  return (
    <div className="space-y-4">
      {description && <p className="panel p-4 whitespace-pre-wrap text-sm">{description}</p>}
      <pre className="panel p-4 text-xs font-mono overflow-x-auto">
        {JSON.stringify(obj, null, 2)}
      </pre>
    </div>
  );
}
