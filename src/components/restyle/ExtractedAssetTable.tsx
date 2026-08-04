// ====================================================================
// 资产表（可编辑版）。五列全部可编辑：类型下拉 / 名称单行 / 描述自适应
// 多行 / 需要转绘与重要性切换。编辑经 300ms 防抖走 onChange（父级即
// updateExtractedAssets：同步 project.extractedAssets、清理失效
// confirmedAssetIds、回写历史消息 assetTable 并持久化）。防抖提交按资产
// id 做字段级 merge：只回写用户编辑过的字段，防抖窗口内外部对其它字段的
// 变更（如「采纳建议」）不被旧快照覆盖。
// 「+ 新增」与行尾铅笔按钮打开 AssetEditDialog 弹窗，提交后立即落表。
// 自检结果（reviewRestyleAssetTable 的 issues）以行内警示呈现：
// 单元格警示描边 + 行尾 ⚠ 说明 + 「采纳建议」一键写入。
// ====================================================================

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { Translations } from "../../i18n/zh";
import type { AssetReviewIssue } from "../../lib/restyle/assetReview";
import { AssetEditDialog } from "./AssetEditDialog";
import type { RestyleExtractedAsset } from "./restyleStorage";

/** 可直接采纳建议写回的文本字段。 */
const ADOPTABLE_FIELDS = [
  "sourceName",
  "sourceDescription",
  "targetName",
  "targetDescription",
] as const;

const GRID_COLUMNS =
  "grid-cols-[92px_minmax(110px,1fr)_minmax(150px,1.4fr)_minmax(110px,1fr)_minmax(160px,1.5fr)_118px_128px]";

const CELL_INPUT_CLASS =
  "w-full rounded bg-transparent px-1 text-left outline-none transition read-only:cursor-default focus:bg-bg focus:ring-1 focus:ring-accent/40";
const CELL_WARN_CLASS = "ring-1 ring-amber-400/80 bg-amber-50/40 dark:bg-amber-500/10";

function fieldWarning(issues: AssetReviewIssue[] | undefined, field: string): boolean {
  return Boolean(issues?.some((issue) => issue.field === field));
}

/** 自适应多行输入：未聚焦保持单行紧凑排版，内容多时自动撑高。 */
function AutoGrowTextarea({
  value,
  onChange,
  readOnly,
  warn,
  ariaLabel,
}: {
  value: string;
  onChange?: (next: string) => void;
  readOnly?: boolean;
  warn?: boolean;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      readOnly={readOnly}
      aria-label={ariaLabel}
      onChange={(event) => onChange?.(event.target.value)}
      className={`${CELL_INPUT_CLASS} resize-none overflow-hidden text-xs leading-5 text-text-secondary ${warn ? CELL_WARN_CLASS : ""}`}
    />
  );
}

export function ExtractedAssetTable({
  assets,
  t,
  linkedAssetIds,
  onChooseLibraryAsset,
  onDeleteAsset,
  onChange,
  reviewIssues = [],
  onAdoptIssue,
  onRecheck,
  reviewRunning = false,
  reviewStale = false,
  highlightAssetId,
}: {
  assets: RestyleExtractedAsset[];
  t: Translations;
  linkedAssetIds?: string[];
  onChooseLibraryAsset?: (assetId: string) => void;
  onDeleteAsset?: (assetId: string) => void;
  /** 提供即进入可编辑模式；编辑经 300ms 防抖后回调整张表。 */
  onChange?: (next: RestyleExtractedAsset[]) => void;
  reviewIssues?: AssetReviewIssue[];
  onAdoptIssue?: (issue: AssetReviewIssue) => void;
  onRecheck?: () => void;
  reviewRunning?: boolean;
  /** 手工编辑后置为 true：提示当前自检结果已过期，需手动「重新检查」。 */
  reviewStale?: boolean;
  highlightAssetId?: string | null;
}) {
  const editable = Boolean(onChange);
  const [rows, setRows] = useState<RestyleExtractedAsset[]>(assets);
  const commitTimerRef = useRef<number | null>(null);
  const pendingRef = useRef<RestyleExtractedAsset[] | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // 最近一次外部 assets 快照：防抖提交以它为底做字段级 merge，
  // 保留外部（如「采纳建议」）对用户未编辑字段的变更。
  const assetsRef = useRef(assets);
  // 防抖窗口内用户逐字段编辑的累积补丁：assetId → 被编辑字段的子集。
  const dirtyRef = useRef<Map<string, Partial<RestyleExtractedAsset>>>(new Map());
  // 资产弹窗：null 关闭；{ asset: null } 新增；否则编辑该资产。
  const [dialogAsset, setDialogAsset] = useState<RestyleExtractedAsset | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // 外部变更（AI 自检写入 / 采纳建议 / 删除）合并进本地行：用户正在编辑的
  // 字段保留未提交击键，其余字段跟随外部；防抖回合的恒等回显不打断输入。
  useEffect(() => {
    assetsRef.current = assets;
    const dirty = dirtyRef.current;
    if (!dirty.size) {
      setRows(assets);
      return;
    }
    setRows(
      assets.map((asset) => {
        const patch = dirty.get(asset.id);
        return patch ? { ...asset, ...patch } : asset;
      }),
    );
  }, [assets]);

  useEffect(
    () => () => {
      // 卸载时把还在防抖窗口里的编辑落盘，避免切换视图丢失最后一击。
      if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
      flushPending();
    },
    [],
  );

  /** 提交防抖窗口里的编辑：按资产 id 把脏字段补丁打到最新外部快照上。 */
  function flushPending() {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    const dirty = dirtyRef.current;
    dirtyRef.current = new Map();
    // 以最新外部 assets 为底 merge：外部已删除的行随之丢弃，外部对未编辑
    // 字段的变更不被旧快照覆盖。
    const merged = assetsRef.current.map((asset) => {
      const patch = dirty.get(asset.id);
      return patch ? { ...asset, ...patch } : asset;
    });
    onChangeRef.current?.(merged);
  }

  function commit(next: RestyleExtractedAsset[], immediate = false) {
    setRows(next);
    if (!onChangeRef.current) return;
    pendingRef.current = next;
    if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
    if (immediate) {
      commitTimerRef.current = null;
      pendingRef.current = null;
      // 立即提交即落盘全部本地状态：脏补丁已随 next 提交，基线推进到 next。
      dirtyRef.current = new Map();
      assetsRef.current = next;
      onChangeRef.current(next);
      return;
    }
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      flushPending();
    }, 300);
  }

  function patchRow(assetId: string, patch: Partial<RestyleExtractedAsset>) {
    const dirty = new Map(dirtyRef.current);
    dirty.set(assetId, { ...dirty.get(assetId), ...patch });
    dirtyRef.current = dirty;
    commit(rows.map((row) => (row.id === assetId ? { ...row, ...patch } : row)));
  }

  /** 「+ 新增」打开资产弹窗；提交后立即落表（跳过防抖）。 */
  function openAddDialog() {
    setDialogAsset(null);
    setDialogOpen(true);
  }

  function openEditDialog(asset: RestyleExtractedAsset) {
    setDialogAsset(asset);
    setDialogOpen(true);
  }

  function handleDialogSubmit(asset: RestyleExtractedAsset) {
    const exists = rows.some((row) => row.id === asset.id);
    commit(exists ? rows.map((row) => (row.id === asset.id ? asset : row)) : [...rows, asset], true);
  }

  const kindLabel = (kind: RestyleExtractedAsset["kind"]) =>
    kind === "character"
      ? t.restyle_assets_characters
      : kind === "scene"
        ? t.restyle_assets_scenes
        : t.restyle_assets_props;

  const issuesByAsset = new Map<string, AssetReviewIssue[]>();
  for (const issue of reviewIssues) {
    const list = issuesByAsset.get(issue.assetId) ?? [];
    list.push(issue);
    issuesByAsset.set(issue.assetId, list);
  }

  return (
    <div className="mt-5 overflow-x-auto rounded-xl border border-border">
      <div className="min-w-[1080px] overflow-hidden">
        <div
          className={`grid ${GRID_COLUMNS} gap-3 border-b border-border bg-bg-elevated px-4 py-2 text-[11px] font-medium text-text-muted`}
        >
          <span>{t.restyle_asset_type}</span>
          <span>{t.restyle_asset_source_name}</span>
          <span>{t.restyle_asset_source_description}</span>
          <span>{t.restyle_asset_target_name}</span>
          <span>{t.restyle_asset_target_description}</span>
          <span>{t.restyle_asset_should_restyle}</span>
          <span className="flex items-center justify-end gap-2">
            {onRecheck ? (
              <button
                type="button"
                onClick={onRecheck}
                disabled={reviewRunning}
                className={`flex items-center gap-1 hover:text-text-primary disabled:opacity-50 ${reviewStale ? "text-amber-500" : "text-accent"}`}
                title={reviewStale ? t.restyle_asset_review_stale_hint : undefined}
              >
                {reviewRunning ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RefreshCw size={12} />
                )}
                {t.restyle_asset_review_recheck}
              </button>
            ) : null}
            {editable ? (
              <button
                type="button"
                onClick={openAddDialog}
                className="flex items-center gap-1 text-accent hover:text-text-primary"
              >
                <Plus size={12} />
                {t.restyle_asset_add}
              </button>
            ) : null}
          </span>
        </div>
        {rows.map((asset) => {
          const issues = issuesByAsset.get(asset.id);
          const readOnly = !editable;
          return (
            <div key={asset.id}>
              <div
                data-asset-id={asset.id}
                className={`grid ${GRID_COLUMNS} gap-3 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-bg-elevated/70 ${highlightAssetId === asset.id ? "bg-accent-dim/40 ring-1 ring-inset ring-accent/40" : ""}`}
              >
                <span>
                  <select
                    value={asset.kind}
                    disabled={readOnly}
                    aria-label={`${t.restyle_asset_type}：${asset.sourceName || asset.id}`}
                    onChange={(event) =>
                      patchRow(asset.id, {
                        kind: event.target.value as RestyleExtractedAsset["kind"],
                      })
                    }
                    className={`${CELL_INPUT_CLASS} text-xs text-accent disabled:opacity-100 ${fieldWarning(issues, "kind") ? CELL_WARN_CLASS : ""}`}
                  >
                    <option value="character">{t.restyle_assets_characters}</option>
                    <option value="scene">{t.restyle_assets_scenes}</option>
                    <option value="prop">{t.restyle_assets_props}</option>
                  </select>
                </span>
                <span>
                  <input
                    value={asset.sourceName}
                    readOnly={readOnly}
                    data-asset-id={asset.id}
                    aria-label={`${t.restyle_asset_source_name}：${asset.id}`}
                    onChange={(event) => patchRow(asset.id, { sourceName: event.target.value })}
                    className={`${CELL_INPUT_CLASS} text-sm font-medium text-text-primary ${fieldWarning(issues, "sourceName") ? CELL_WARN_CLASS : ""}`}
                  />
                </span>
                <span>
                  <AutoGrowTextarea
                    value={asset.sourceDescription}
                    readOnly={readOnly}
                    warn={fieldWarning(issues, "sourceDescription")}
                    ariaLabel={`${t.restyle_asset_source_description}：${asset.id}`}
                    onChange={(next) => patchRow(asset.id, { sourceDescription: next })}
                  />
                </span>
                <span>
                  <input
                    value={asset.targetName}
                    readOnly={readOnly}
                    aria-label={`${t.restyle_asset_target_name}：${asset.id}`}
                    onChange={(event) => patchRow(asset.id, { targetName: event.target.value })}
                    className={`${CELL_INPUT_CLASS} text-sm font-medium text-text-primary ${fieldWarning(issues, "targetName") ? CELL_WARN_CLASS : ""}`}
                  />
                </span>
                <span>
                  <AutoGrowTextarea
                    value={asset.targetDescription}
                    readOnly={readOnly}
                    warn={fieldWarning(issues, "targetDescription")}
                    ariaLabel={`${t.restyle_asset_target_description}：${asset.id}`}
                    onChange={(next) => patchRow(asset.id, { targetDescription: next })}
                  />
                  {!asset.shouldRestyle && (
                    <span className="mt-1 block text-[10px] text-text-muted">
                      {t.restyle_asset_keep_original}
                    </span>
                  )}
                </span>
                <span className="flex flex-col items-start gap-1.5">
                  <button
                    type="button"
                    disabled={readOnly}
                    aria-pressed={asset.shouldRestyle}
                    onClick={() => patchRow(asset.id, { shouldRestyle: !asset.shouldRestyle })}
                    className={`rounded-md border px-2 py-0.5 text-[11px] disabled:cursor-default ${asset.shouldRestyle ? "border-accent/40 bg-accent-dim text-accent" : "border-border text-text-muted"}`}
                  >
                    {asset.shouldRestyle ? t.restyle_asset_should_restyle : t.restyle_asset_keep}
                  </button>
                  <button
                    type="button"
                    disabled={readOnly}
                    aria-pressed={asset.importance === "required"}
                    onClick={() =>
                      patchRow(asset.id, {
                        importance: asset.importance === "required" ? "optional" : "required",
                      })
                    }
                    className={`rounded-md border px-2 py-0.5 text-[11px] disabled:cursor-default ${asset.importance === "required" ? "border-amber-400/60 bg-amber-500/10 text-amber-500" : "border-border text-text-muted"}`}
                  >
                    {asset.importance === "required"
                      ? t.restyle_asset_required
                      : t.restyle_asset_optional}
                  </button>
                </span>
                <span className="flex items-start justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => onChooseLibraryAsset?.(asset.id)}
                    className="h-fit rounded-md border border-border px-2 py-1 text-[11px] text-accent hover:bg-accent-dim"
                  >
                    {linkedAssetIds?.length ? "选择/更换" : "选择资产"}
                  </button>
                  {editable ? (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditDialog(asset)}
                        className="grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-accent-dim hover:text-accent"
                        aria-label={`${t.restyle_asset_dialog_edit_title}：${asset.sourceName || asset.id}`}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteAsset?.(asset.id)}
                        className="grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`删除资产：${asset.sourceName || asset.id}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  ) : null}
                </span>
              </div>
              {issues?.length ? (
                <div className="border-b border-border bg-amber-50/50 px-4 py-2 dark:bg-amber-500/5">
                  {issues.map((issue, index) => {
                    const adoptable =
                      Boolean(onAdoptIssue) &&
                      issue.suggestion.trim().length > 0 &&
                      (ADOPTABLE_FIELDS as readonly string[]).includes(issue.field);
                    return (
                      <div
                        key={`${issue.field}-${index}`}
                        className="flex items-start gap-2 py-0.5 text-[11px] leading-4 text-amber-700 dark:text-amber-300"
                      >
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{issue.field}</span>：{issue.message}
                        </span>
                        {adoptable ? (
                          <button
                            type="button"
                            onClick={() => onAdoptIssue?.(issue)}
                            className="shrink-0 rounded border border-amber-400/60 px-1.5 py-0.5 text-[10px] font-medium hover:bg-amber-100 dark:hover:bg-amber-500/20"
                          >
                            {t.restyle_asset_review_adopt}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <AssetEditDialog
        open={dialogOpen}
        initialValue={dialogAsset}
        onSubmit={handleDialogSubmit}
        onClose={() => setDialogOpen(false)}
        t={t}
      />
    </div>
  );
}
