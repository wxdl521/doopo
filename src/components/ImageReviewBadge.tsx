import { CheckCircle2, Clock3, Upload, XCircle } from "lucide-react";

export type ImageReviewStatus = "pending" | "approved" | "rejected" | "error";

export function ImageReviewBadge({
  status,
  error,
  onRequestReview,
  unsupported,
  unsupportedMessage,
  position = "bottom-left",
}: {
  status?: ImageReviewStatus;
  error?: string;
  onRequestReview?: () => void;
  /** 当前视频渠道未接入可查询的素材库时，隐藏入库入口。 */
  unsupported?: boolean;
  unsupportedMessage?: string;
  position?: "bottom-left" | "bottom-right";
}) {
  // 只有筷子科技和 TopenRouter 接入了图片素材库；其他视频模型不显示入口。
  if (unsupported) return null;

  const content =
    !status
      ? {
          label: "未入库",
          className: "border-slate-300/40 bg-black/70 text-white hover:bg-black/85",
          icon: <Upload size={11} />,
          canRequest: true,
        }
      : status === "approved"
      ? {
          label: "已入库",
          className: "border-emerald-400/40 bg-emerald-500/90 text-white",
          icon: <CheckCircle2 size={11} />,
          canRequest: false,
        }
      : status === "rejected"
        ? {
            label: "入库失败",
            className: "border-rose-400/40 bg-rose-500/90 text-white",
            icon: <XCircle size={11} />,
            canRequest: false,
          }
        : status === "error"
          ? {
              label: "入库失败",
              className: "border-amber-400/40 bg-amber-500/90 text-white hover:bg-amber-500",
              icon: <XCircle size={11} />,
              canRequest: true,
            }
          : {
              label: "入库中",
              className: "border-slate-300/40 bg-black/70 text-white",
              icon: <Clock3 size={11} className="animate-pulse" />,
              canRequest: false,
            };

  const positionClassName =
    position === "bottom-right" ? "bottom-1.5 right-1.5" : "bottom-1.5 left-1.5";
  const className = `absolute ${positionClassName} z-20 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur-sm ${content.className}`;
  const title =
    content.canRequest && onRequestReview
      ? unsupportedMessage || "点击上传入库"
      : error || content.label;

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
