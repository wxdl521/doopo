import { CheckCircle2, Clock3, Upload, XCircle } from "lucide-react";

export type ImageReviewStatus = "pending" | "approved" | "rejected" | "error";

export function ImageReviewBadge({
  status,
  error,
  onRequestReview,
}: {
  status?: ImageReviewStatus;
  error?: string;
  onRequestReview?: () => void;
}) {
  const content =
    !status
      ? {
          label: "未审核",
          className: "border-slate-300/40 bg-black/70 text-white hover:bg-black/85",
          icon: <Upload size={11} />,
          canRequest: true,
        }
      : status === "approved"
      ? {
          label: "审核通过",
          className: "border-emerald-400/40 bg-emerald-500/90 text-white",
          icon: <CheckCircle2 size={11} />,
          canRequest: false,
        }
      : status === "rejected"
        ? {
            label: "审核未通过",
            className: "border-rose-400/40 bg-rose-500/90 text-white",
            icon: <XCircle size={11} />,
            canRequest: false,
          }
        : status === "error"
          ? {
              label: "检测失败",
              className: "border-amber-400/40 bg-amber-500/90 text-white hover:bg-amber-500",
              icon: <XCircle size={11} />,
              canRequest: true,
            }
          : {
              label: "审核中",
              className: "border-slate-300/40 bg-black/70 text-white",
              icon: <Clock3 size={11} className="animate-pulse" />,
              canRequest: false,
            };

  const className = `absolute bottom-1.5 left-1.5 z-20 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur-sm ${content.className}`;
  const title = content.canRequest && onRequestReview ? "点击上传审核" : error || content.label;

  if (content.canRequest && onRequestReview) {
    return (
      <button
        type="button"
        className={className}
        title={title}
        onClick={(event) => {
          event.stopPropagation();
          onRequestReview();
        }}
      >
        {content.icon}
        {content.label}
      </button>
    );
  }

  return (
    <span className={className} title={title}>
      {content.icon}
      {content.label}
    </span>
  );
}
