import { useState } from "react";
import { X, Globe, Link2, Lock, Loader2, Check, Copy } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { publishPost, type PostKind, type PostVisibility } from "@/lib/community.functions";

type Props = {
  open: boolean;
  onClose: () => void;
  kind: PostKind;
  defaultTitle: string;
  defaultSummary?: string;
  coverGradient?: string;
  sourceId?: string | null;
  payload: unknown;
};

const VIS: { value: PostVisibility; label: string; desc: string; icon: typeof Globe }[] = [
  { value: "public", label: "公开", desc: "出现在社区精选与列表", icon: Globe },
  { value: "unlisted", label: "仅链接可见", desc: "不进入列表，知道链接者可看", icon: Link2 },
  { value: "private", label: "私有", desc: "仅自己可见，可稍后改公开", icon: Lock },
];

export default function ShareDialog(p: Props) {
  const [title, setTitle] = useState(p.defaultTitle);
  const [summary, setSummary] = useState(p.defaultSummary ?? "");
  const [visibility, setVisibility] = useState<PostVisibility>("public");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ id: string; visibility: PostVisibility } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publish = useServerFn(publishPost);

  if (!p.open) return null;

  const link = done ? `${window.location.origin}/community/${done.id}` : "";

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const post = await publish({
        data: {
          kind: p.kind,
          sourceId: p.sourceId ?? null,
          title: title.trim() || p.defaultTitle,
          summary: summary.trim() || null,
          coverGradient: p.coverGradient ?? null,
          payload: p.payload,
          visibility,
        },
      });
      setDone({ id: post.id, visibility: post.visibility });
    } catch (e) {
      setError((e as Error).message || "发布失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onBackdrop}
    >
      <div className="panel w-full max-w-lg p-6 relative" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={p.onClose}
          className="absolute top-3 right-3 p-1.5 rounded hover:bg-bg-elevated text-text-muted"
        >
          <X size={16} />
        </button>

        {!done ? (
          <>
            <h3 className="font-display text-xl font-bold mb-1">分享到社区</h3>
            <p className="text-xs text-text-muted mb-4">
              发布后将作为社区作品展示，其他用户可以查看并点赞。
            </p>

            <label className="block text-xs text-text-muted mb-1">标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input w-full mb-3"
              maxLength={200}
            />

            <label className="block text-xs text-text-muted mb-1">简介（可选）</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              maxLength={2000}
              className="input w-full mb-4 resize-none"
              placeholder="一句话介绍这部作品的亮点…"
            />

            <div className="space-y-2 mb-4">
              {VIS.map((v) => {
                const Icon = v.icon;
                const active = visibility === v.value;
                return (
                  <button
                    key={v.value}
                    onClick={() => setVisibility(v.value)}
                    className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition ${
                      active
                        ? "border-accent bg-accent-dim/40"
                        : "border-border hover:border-accent/40"
                    }`}
                  >
                    <Icon
                      size={16}
                      className={active ? "text-accent mt-0.5" : "text-text-muted mt-0.5"}
                    />
                    <div>
                      <div className="text-sm font-semibold">{v.label}</div>
                      <div className="text-xs text-text-muted">{v.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {error && <div className="text-xs text-red-400 mb-3">{error}</div>}

            <div className="flex justify-end gap-2">
              <button onClick={p.onClose} className="btn-ghost text-sm">
                取消
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                发布
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <Check size={18} className="text-emerald-400" />
              <h3 className="font-display text-xl font-bold">发布成功</h3>
            </div>
            <p className="text-sm text-text-secondary mb-4">
              {done.visibility === "public" && "作品已公开到社区精选。"}
              {done.visibility === "unlisted" && "作品仅通过链接可见。"}
              {done.visibility === "private" &&
                "作品已保存为私有，可稍后在「我的发布」中改为公开。"}
            </p>
            <div className="flex items-center gap-2 panel p-2 mb-4">
              <input
                readOnly
                value={link}
                className="input flex-1 !bg-transparent !border-0 text-xs"
              />
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch {}
                }}
                className="btn-ghost text-xs inline-flex items-center gap-1"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? "已复制" : "复制"}
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <a href={link} target="_blank" rel="noreferrer" className="btn-ghost text-sm">
                打开作品
              </a>
              <button onClick={p.onClose} className="btn-primary text-sm">
                完成
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  function onBackdrop(e: React.MouseEvent) {
    if (e.target === e.currentTarget) p.onClose();
  }
}
