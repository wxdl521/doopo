// ====================================================================
// 局部返工弹窗（替代原 window.prompt）。沿用 AssetEditDialog 的自建模态
// 外壳与交互（Esc / 遮罩点击 / 右上 X 关闭）。受控：
// open / segment / onSubmit(feedback) / onClose。
// ====================================================================

import { useEffect, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import type { Translations } from "../../i18n/zh";
import type { RestyleAttachment } from "./restyleStorage";

const QUICK_TAG_KEYS = [
  "restyle_rework_tag_character",
  "restyle_rework_tag_action",
  "restyle_rework_tag_ratio",
  "restyle_rework_tag_lipsync",
] as const;

export function SegmentRerunDialog({
  open,
  segment,
  onSubmit,
  onClose,
  t,
}: {
  open: boolean;
  segment: RestyleAttachment | null;
  onSubmit: (feedback: string) => void;
  onClose: () => void;
  t: Translations;
}) {
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (!open) return;
    setFeedback(
      segment ? `${segment.episode} ${segment.segmentId} ${t.restyle_rework_default_reason}` : "",
    );
  }, [open, segment, t]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !segment) return null;

  const submit = () => {
    const text = feedback.trim() || `${segment.episode} ${segment.segmentId} ${t.restyle_rework_default_reason}`;
    onSubmit(text);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[min(92vw,480px)] rounded-2xl border border-border bg-bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-base font-semibold text-text-primary">
              <RotateCcw size={15} className="text-accent" />
              {t.restyle_rework_dialog_title}
            </h3>
            <p className="mt-0.5 text-xs text-text-muted">
              {segment.episode} {segment.segmentId}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted hover:bg-bg-elevated hover:text-text-primary"
            aria-label="close"
          >
            <X size={16} />
          </button>
        </div>

        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={4}
          autoFocus
          placeholder={t.restyle_rework_dialog_placeholder}
          className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
        />

        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK_TAG_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFeedback((prev) => `${prev}${prev.endsWith("，") || prev === "" ? "" : "，"}${t[key]}`)}
              className="rounded-md border border-border px-2 py-0.5 text-[11px] text-text-secondary hover:border-accent/50 hover:text-accent"
            >
              {t[key]}
            </button>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:bg-bg-elevated"
          >
            {t.common_cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg-base hover:opacity-90"
          >
            {t.restyle_rework_dialog_submit}
          </button>
        </div>
      </div>
    </div>
  );
}
