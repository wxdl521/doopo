// ====================================================================
// 新增 / 编辑资产弹窗。沿用资产库选择器的自建模态外壳
// （fixed inset-0 z-50 grid place-items-center bg-black/60 +
// rounded-2xl border bg-bg-surface shadow-2xl + 右上 X），
// 遮罩点击与 Esc 关闭。受控组件：open / initialValue / onSubmit /
// onClose，新增（initialValue 为空）与编辑已有资产复用。
// 目标名称 / 目标设定留空时自动同步原片名称 / 原片定位。
// ====================================================================

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Translations } from "../../i18n/zh";
import type { RestyleExtractedAsset } from "./restyleStorage";

type AssetKind = RestyleExtractedAsset["kind"];

const KINDS: AssetKind[] = ["character", "scene", "prop"];

const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent";

export function AssetEditDialog({
  open,
  initialValue,
  onSubmit,
  onClose,
  t,
}: {
  open: boolean;
  /** 传入即编辑该资产；为空则新增。 */
  initialValue?: RestyleExtractedAsset | null;
  onSubmit: (asset: RestyleExtractedAsset) => void;
  onClose: () => void;
  t: Translations;
}) {
  const [kind, setKind] = useState<AssetKind>("scene");
  const [sourceName, setSourceName] = useState("");
  const [sourceDescription, setSourceDescription] = useState("");
  const [targetName, setTargetName] = useState("");
  const [targetDescription, setTargetDescription] = useState("");
  const [shouldRestyle, setShouldRestyle] = useState(true);
  const [importance, setImportance] = useState<RestyleExtractedAsset["importance"]>("optional");

  // 每次打开都从 initialValue 重建表单，避免残留上一次的输入。
  useEffect(() => {
    if (!open) return;
    setKind(initialValue?.kind ?? "scene");
    setSourceName(initialValue?.sourceName ?? "");
    setSourceDescription(initialValue?.sourceDescription ?? "");
    setTargetName(initialValue?.targetName ?? "");
    setTargetDescription(initialValue?.targetDescription ?? "");
    setShouldRestyle(initialValue?.shouldRestyle ?? true);
    setImportance(initialValue?.importance ?? "optional");
  }, [open, initialValue]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const nameMissing = !sourceName.trim();

  function handleSubmit() {
    if (nameMissing) return;
    onSubmit({
      id: initialValue?.id ?? crypto.randomUUID(),
      kind,
      sourceName: sourceName.trim(),
      sourceDescription: sourceDescription.trim(),
      // 留空自动同步原片名称 / 原片定位。
      targetName: targetName.trim() || sourceName.trim(),
      targetDescription: targetDescription.trim() || sourceDescription.trim(),
      shouldRestyle,
      importance,
      promptOverride: initialValue?.promptOverride,
    });
    onClose();
  }

  const kindLabel = (value: AssetKind) =>
    value === "character"
      ? t.restyle_assets_characters
      : value === "scene"
        ? t.restyle_assets_scenes
        : t.restyle_assets_props;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-semibold text-text-primary">
            {initialValue ? t.restyle_asset_dialog_edit_title : t.restyle_asset_dialog_add_title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common_cancel}
            className="text-text-muted hover:text-text-primary"
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <span className="mb-1.5 block text-xs font-medium text-text-muted">
              {t.restyle_asset_type}
            </span>
            <div className="flex gap-1 rounded-lg border border-border bg-bg-elevated p-1">
              {KINDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={kind === value}
                  onClick={() => setKind(value)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs transition ${kind === value ? "bg-accent text-bg" : "text-text-muted hover:text-text-primary"}`}
                >
                  {kindLabel(value)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">
              {t.restyle_asset_source_name} <span className="text-destructive">*</span>
            </label>
            <input
              value={sourceName}
              onChange={(event) => setSourceName(event.target.value)}
              aria-label={t.restyle_asset_source_name}
              aria-invalid={nameMissing}
              className={FIELD_CLASS}
              autoFocus
            />
            {nameMissing ? (
              <p className="mt-1 text-[11px] text-destructive">
                {t.restyle_asset_dialog_name_required}
              </p>
            ) : null}
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">
              {t.restyle_asset_source_description}
            </label>
            <textarea
              value={sourceDescription}
              onChange={(event) => setSourceDescription(event.target.value)}
              aria-label={t.restyle_asset_source_description}
              rows={3}
              className={`${FIELD_CLASS} resize-y`}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">
              {t.restyle_asset_target_name}
            </label>
            <input
              value={targetName}
              onChange={(event) => setTargetName(event.target.value)}
              aria-label={t.restyle_asset_target_name}
              placeholder={t.restyle_asset_target_name_placeholder}
              className={FIELD_CLASS}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">
              {t.restyle_asset_target_description}
            </label>
            <textarea
              value={targetDescription}
              onChange={(event) => setTargetDescription(event.target.value)}
              aria-label={t.restyle_asset_target_description}
              placeholder={t.restyle_asset_target_description_placeholder}
              rows={3}
              className={`${FIELD_CLASS} resize-y`}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={shouldRestyle}
              onClick={() => setShouldRestyle((value) => !value)}
              className={`rounded-md border px-2 py-1 text-[11px] ${shouldRestyle ? "border-accent/40 bg-accent-dim text-accent" : "border-border text-text-muted"}`}
            >
              {shouldRestyle ? t.restyle_asset_should_restyle : t.restyle_asset_keep}
            </button>
            <button
              type="button"
              aria-pressed={importance === "required"}
              onClick={() =>
                setImportance((value) => (value === "required" ? "optional" : "required"))
              }
              className={`rounded-md border px-2 py-1 text-[11px] ${importance === "required" ? "border-amber-400/60 bg-amber-500/10 text-amber-500" : "border-border text-text-muted"}`}
            >
              {importance === "required" ? t.restyle_asset_required : t.restyle_asset_optional}
            </button>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
          >
            {t.common_cancel}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={nameMissing}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t.common_confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
