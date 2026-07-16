import { CheckCircle2, Clock3, XCircle } from "lucide-react";

export type ImageReviewStatus = "pending" | "approved" | "rejected" | "error";

export function ImageReviewBadge({
  status,
  error,
}: {
  status?: ImageReviewStatus;
  error?: string;
}) {
  if (!status) return null;

  const content =
    status === "approved"
      ? {
          label: "审核通过",
          className: "border-emerald-400/40 bg-emerald-500/90 text-white",
          icon: <CheckCircle2 size={11} />,
        }
      : status === "rejected"
        ? {
            label: "审核未通过",
            className: "border-rose-400/40 bg-rose-500/90 text-white",
            icon: <XCircle size={11} />,
          }
        : status === "error"
          ? {
              label: "检测失败",
              className: "border-amber-400/40 bg-amber-500/90 text-white",
              icon: <XCircle size={11} />,
            }
          : {
              label: "审核中",
              className: "border-slate-300/40 bg-black/70 text-white",
              icon: <Clock3 size={11} className="animate-pulse" />,
            };

  return (
    <span
      className={`absolute bottom-1.5 left-1.5 z-20 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur-sm ${content.className}`}
      title={error || content.label}
    >
      {content.icon}
      {content.label}
    </span>
  );
}
