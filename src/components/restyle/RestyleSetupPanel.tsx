// ====================================================================
//  视频转绘工作台选项区（转绘右栏顶部）
//
//  - 执行模式三选一卡片 + 「应用执行模式」按钮
//  - 自定义干预联动区（仅选中展开；极速模式仍保留总预算）
//  - 项目画幅 / 目标市场（光照预设简述）/ ✨ 智能补镜开关 / 视频模型（单价来自 listModelPricing，弹窗选模型）
//  - RestyleSpecCard：聊天区「请先确认这 3 项制作规格」表，
//    与本面板读写同一份项目状态，任一侧改动即时同步
// ====================================================================

import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Clapperboard,
  Gauge,
  SlidersHorizontal,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import type { Translations } from "../../i18n/zh";
import type { ModelPricingRow } from "../../lib/modelPricingCache";
import { LIGHTING_LUTS, LIGHTING_PRESETS, type Market } from "../../lib/restyle/cameraDirection";
import { CustomLightingPanel } from "./CustomLightingPanel";
import type { RestyleProject } from "./restyleStorage";
import {
  DEFAULT_AUTO_BUDGET,
  GATES,
  RESTYLE_ASPECTS,
  resolveExecutionConfig,
  type RestyleAspect,
  type RestyleAssetImageSource,
  type RestyleExecutionMode,
  type RestyleGateId,
  type RestyleVoiceSource,
} from "./restyleExecution";

const GATE_LABEL_KEYS: Record<RestyleGateId, keyof Translations> = {
  asset_setting: "restyle_setup_gate_asset_setting",
  storyboard: "restyle_setup_gate_storyboard",
  storyboard_review: "restyle_setup_gate_storyboard_review",
  asset_image_source: "restyle_setup_gate_asset_image_source",
  character_images: "restyle_setup_gate_character_images",
  all_asset_images: "restyle_setup_gate_all_asset_images",
  voice_plan: "restyle_setup_gate_voice_plan",
  voice_files: "restyle_setup_gate_voice_files",
  video_grouping: "restyle_setup_gate_video_grouping",
  video_quote: "restyle_setup_gate_video_quote",
  subtitle_final: "restyle_setup_gate_subtitle_final",
};

const MODE_META: Array<{
  mode: RestyleExecutionMode;
  titleKey: keyof Translations;
  descKey: keyof Translations;
  icon: typeof Zap;
}> = [
  {
    mode: "auto",
    titleKey: "restyle_setup_mode_auto",
    descKey: "restyle_setup_mode_auto_desc",
    icon: Zap,
  },
  {
    mode: "guided",
    titleKey: "restyle_setup_mode_guided",
    descKey: "restyle_setup_mode_guided_desc",
    icon: Clapperboard,
  },
  {
    mode: "custom",
    titleKey: "restyle_setup_mode_custom",
    descKey: "restyle_setup_mode_custom_desc",
    icon: SlidersHorizontal,
  },
];

export type RestyleSetupPatch = Partial<
  Pick<
    RestyleProject,
    | "executionMode"
    | "autoBudget"
    | "assetImageSource"
    | "voiceSource"
    | "manualGates"
    | "aspect"
    | "videoModel"
    | "targetMarket"
    | "smartInsert"
    | "customLighting"
  >
>;

/** 目标市场六档（光照预设 + 俚语本土化口径），默认 kr；顺序与 LIGHTING_PRESETS 一致。 */
const MARKET_OPTIONS: Array<{ value: Market; labelKey: keyof Translations }> = (
  Object.keys(LIGHTING_PRESETS) as Market[]
).map((value) => ({
  value,
  labelKey: LIGHTING_PRESETS[value].nameKey as keyof Translations,
}));

/** 当前模型的单价档：优先 720P（渲染默认清晰度），取不到用该模型任意一档。 */
export function pricingForVideoModel(
  rows: ModelPricingRow[],
  modelId: string,
): ModelPricingRow | undefined {
  const candidates = rows.filter((row) => row.enabled && row.modelId === modelId);
  return candidates.find((row) => row.resolution === "720P") ?? candidates[0];
}

/** 库内默认视频模型（is_default 且启用）。 */
export function defaultVideoPricing(rows: ModelPricingRow[]): ModelPricingRow | undefined {
  return (
    rows.find((row) => row.enabled && row.isDefault && row.resolution === "720P") ??
    rows.find((row) => row.enabled && row.isDefault)
  );
}

function formatCredits(credits: number): string {
  return Number.isInteger(credits) ? String(credits) : credits.toFixed(1);
}

type PanelProps = {
  project: RestyleProject | undefined;
  /** listModelPricing(kind=video) 已启用行。 */
  videoPricing: ModelPricingRow[];
  /** 已上架视频目录（useListedModels）；未配价的模型以「暂未计费」徽标并入可选项。 */
  listedVideoModels?: { id: string; label: string; priced: boolean }[];
  /** 当前生效的视频模型 id（含默认值兜底后的结果）。 */
  currentVideoModel: string;
  onPatch: (patch: RestyleSetupPatch) => void;
  t: Translations;
};

function BudgetInput({
  value,
  onChange,
  t,
}: {
  value: number;
  onChange: (next: number) => void;
  t: Translations;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-text-muted">{t.restyle_setup_budget}</span>
      <input
        type="number"
        min={1}
        step={1000}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next) && next > 0) onChange(Math.floor(next));
        }}
        className="mt-1 w-full rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
        aria-label={t.restyle_setup_budget}
      />
      <span className="mt-1 block text-[10px] leading-4 text-text-muted">
        {t.restyle_setup_budget_hint}
      </span>
    </label>
  );
}

function OptionRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium text-text-muted">{label}</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={`rounded-md border px-2.5 py-1 text-[11px] ${
              value === option.value
                ? "border-accent bg-accent-dim text-accent"
                : "border-border text-text-secondary hover:bg-bg-elevated"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function RestyleSetupPanel({
  project,
  videoPricing,
  listedVideoModels,
  currentVideoModel,
  onPatch,
  t,
}: PanelProps) {
  const config = resolveExecutionConfig(project);
  // 模式卡片点击即生效（onPatch 直写项目状态），与聊天规格卡双向即时联动。
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const appliedMode = config.executionMode;
  const currentPricing = useMemo(
    () => pricingForVideoModel(videoPricing, currentVideoModel),
    [videoPricing, currentVideoModel],
  );
  // 已上架但还未配价的模型：并入选择弹窗，标注「暂未计费」（动态模型服务端会拒绝提交）
  const unpricedListed = useMemo(
    () =>
      (listedVideoModels ?? []).filter(
        (m) => !m.priced && !videoPricing.some((row) => row.modelId === m.id),
      ),
    [listedVideoModels, videoPricing],
  );
  const currentLabel =
    currentPricing?.label ??
    (currentVideoModel ? currentVideoModel : t.restyle_setup_model_unknown);

  return (
    <div className="border-b border-border p-3" data-testid="restyle-setup-panel">
      {/* 标题层已由右栏 Tab 承担，此处不再重复（Gauge 标题行已移除） */}

      {/* 1. 执行模式三选一卡片 + 应用按钮 */}
      <div className="space-y-1.5">
        {MODE_META.map(({ mode, titleKey, descKey, icon: Icon }) => {
          const selected = appliedMode === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => project && onPatch({ executionMode: mode })}
              aria-pressed={selected}
              className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left ${
                selected ? "border-accent bg-accent-dim/60" : "border-border hover:bg-bg-elevated"
              }`}
            >
              <Icon
                size={14}
                className={`mt-0.5 shrink-0 ${selected ? "text-accent" : "text-text-muted"}`}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
                  {t[titleKey]}
                  {appliedMode === mode ? (
                    <span className="rounded bg-accent-dim px-1 py-px text-[9px] text-accent">
                      {t.restyle_setup_applied}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[10px] leading-4 text-text-muted">
                  {t[descKey]}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* 极速模式：仍保留总预算输入（预算超限强制暂停） */}
      {appliedMode === "auto" ? (
        <div className="mt-2.5">
          <BudgetInput
            value={config.autoBudget}
            onChange={(autoBudget) => onPatch({ autoBudget })}
            t={t}
          />
        </div>
      ) : null}

      {/* 2. 自定义干预联动区（仅选中展开） */}
      {appliedMode === "custom" ? (
        <div className="mt-2.5 space-y-3 rounded-lg border border-border bg-bg-elevated/50 p-2.5">
          <BudgetInput
            value={config.autoBudget}
            onChange={(autoBudget) => onPatch({ autoBudget })}
            t={t}
          />
          <OptionRow<RestyleAssetImageSource>
            label={t.restyle_setup_asset_source}
            value={config.assetImageSource}
            onChange={(assetImageSource) => onPatch({ assetImageSource })}
            options={[
              { value: "system", label: t.restyle_setup_asset_source_system },
              { value: "upload", label: t.restyle_setup_asset_source_upload },
              { value: "mixed", label: t.restyle_setup_asset_source_mixed },
            ]}
          />
          <OptionRow<RestyleVoiceSource>
            label={t.restyle_setup_voice_source}
            value={config.voiceSource}
            onChange={(voiceSource) => onPatch({ voiceSource })}
            options={[
              { value: "auto", label: t.restyle_setup_voice_auto },
              { value: "voice_pick", label: t.restyle_setup_voice_pick },
              { value: "upload", label: t.restyle_setup_voice_upload },
            ]}
          />
          <div>
            <p className="text-[11px] font-medium text-text-muted">{t.restyle_setup_gates}</p>
            <div className="mt-1 grid grid-cols-1 gap-1">
              {GATES.map((gate) => {
                const checked = config.manualGates.includes(gate.id);
                return (
                  <label
                    key={gate.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[11px] text-text-secondary hover:bg-bg-elevated"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const manualGates = checked
                          ? config.manualGates.filter((id) => id !== gate.id)
                          : [...config.manualGates, gate.id];
                        onPatch({ manualGates });
                      }}
                      className="h-3.5 w-3.5 accent-[var(--accent)]"
                    />
                    {t[GATE_LABEL_KEYS[gate.id]]}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {/* 3. 项目画幅 */}
      <div className="mt-3">
        <OptionRow<RestyleAspect>
          label={t.restyle_setup_aspect}
          value={project?.aspect ?? "9:16"}
          onChange={(aspect) => onPatch({ aspect })}
          options={RESTYLE_ASPECTS.map((aspect) => ({ value: aspect, label: aspect }))}
        />
      </div>

      {/* 4. 目标市场（决定光照预设与俚语本土化口径） */}
      <div className="mt-3">
        <OptionRow<Market>
          label={t.restyle_setup_target_market}
          value={project?.targetMarket ?? "kr"}
          onChange={(targetMarket) => onPatch({ targetMarket })}
          options={MARKET_OPTIONS.map((option) => ({
            value: option.value,
            label: t[option.labelKey],
          }))}
        />
        <p className="mt-1 text-[10px] leading-4 text-text-muted" data-testid="market-preset-desc">
          {t[LIGHTING_PRESETS[project?.targetMarket ?? "kr"].descriptionKey as keyof Translations]}
        </p>
        <p className="mt-0.5 text-[10px] leading-4 text-text-muted" data-testid="market-lut-brief">
          {t.restyle_setup_market_lut}：{LIGHTING_LUTS[project?.targetMarket ?? "kr"].join(" · ")}
        </p>
      </div>

      {/* 4.5 我的风格库：自定义光照（路径 A 参考图提取 / 路径 B 调色台微调），优先于地域预设 */}
      <CustomLightingPanel project={project} onPatch={onPatch} t={t} />

      {/* 5. ✨ 智能补镜（当前版本只记录偏好，执行在下个迭代开放） */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => project && onPatch({ smartInsert: !(project.smartInsert ?? false) })}
          aria-pressed={project?.smartInsert ?? false}
          disabled={!project}
          className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left disabled:opacity-50 ${
            project?.smartInsert
              ? "border-accent bg-accent-dim/60"
              : "border-border hover:bg-bg-elevated"
          }`}
        >
          <Sparkles
            size={14}
            className={`mt-0.5 shrink-0 ${project?.smartInsert ? "text-accent" : "text-text-muted"}`}
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
              {t.restyle_setup_smart_insert}
              {project?.smartInsert ? (
                <span className="rounded bg-accent-dim px-1 py-px text-[9px] text-accent">
                  {t.restyle_setup_applied}
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block text-[10px] leading-4 text-text-muted">
              {t.restyle_setup_smart_insert_desc}
            </span>
          </span>
        </button>
      </div>

      {/* 6. 视频模型：当前值 + 单价，弹窗选择 */}
      <div className="mt-3">
        <p className="text-[11px] font-medium text-text-muted">{t.restyle_setup_video_model}</p>
        <div className="mt-1 flex items-center gap-2 rounded-lg border border-border bg-bg-elevated/50 px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-text-primary">{currentLabel}</p>
            <p className="text-[10px] text-text-muted">
              {currentPricing
                ? `${formatCredits(currentPricing.credits)} ${t.restyle_setup_price_unit}${currentPricing.resolution ? ` · ${currentPricing.resolution}` : ""}`
                : t.restyle_setup_no_pricing}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModelDialogOpen(true)}
            disabled={!project}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-elevated hover:text-accent disabled:opacity-50"
          >
            {t.restyle_setup_choose_model}
          </button>
        </div>
      </div>

      {modelDialogOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6"
          role="dialog"
          aria-modal="true"
          aria-label={t.restyle_setup_model_dialog_title}
        >
          <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-text-primary">
                {t.restyle_setup_model_dialog_title}
              </h2>
              <button
                type="button"
                onClick={() => setModelDialogOpen(false)}
                className="text-text-muted hover:text-text-primary"
                aria-label={t.restyle_setup_close}
              >
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-3">
              {videoPricing.length || unpricedListed.length ? (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[10px] text-text-muted">
                      <th className="px-2 py-1.5 font-medium">{t.restyle_setup_col_model}</th>
                      <th className="px-2 py-1.5 font-medium">{t.restyle_setup_col_resolution}</th>
                      <th className="px-2 py-1.5 font-medium">{t.restyle_setup_col_price}</th>
                      <th className="px-2 py-1.5 font-medium">{t.restyle_setup_col_note}</th>
                      <th className="px-2 py-1.5 font-medium">{t.restyle_setup_col_default}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {videoPricing.map((row) => {
                      const selected = row.modelId === currentVideoModel;
                      return (
                        <tr
                          key={row.id}
                          onClick={() => {
                            onPatch({ videoModel: row.modelId });
                            setModelDialogOpen(false);
                          }}
                          className={`cursor-pointer border-t border-border/60 ${
                            selected ? "bg-accent-dim/50" : "hover:bg-bg-elevated"
                          }`}
                        >
                          <td className="px-2 py-2 font-medium text-text-primary">
                            <span className="flex items-center gap-1.5">
                              {selected ? <Check size={12} className="text-accent" /> : null}
                              {row.label}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-text-secondary">{row.resolution ?? "—"}</td>
                          <td className="px-2 py-2 text-text-secondary">
                            {formatCredits(row.credits)} {t.restyle_setup_price_unit}
                          </td>
                          <td className="px-2 py-2 text-text-muted">{row.note ?? "—"}</td>
                          <td className="px-2 py-2">
                            {row.isDefault ? (
                              <span className="rounded bg-accent-dim px-1.5 py-0.5 text-[10px] text-accent">
                                {t.restyle_setup_col_default}
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                    {unpricedListed.map((m) => {
                      const selected = m.id === currentVideoModel;
                      return (
                        <tr
                          key={`unpriced-${m.id}`}
                          onClick={() => {
                            onPatch({ videoModel: m.id });
                            setModelDialogOpen(false);
                          }}
                          className={`cursor-pointer border-t border-border/60 ${
                            selected ? "bg-accent-dim/50" : "hover:bg-bg-elevated"
                          }`}
                        >
                          <td className="px-2 py-2 font-medium text-text-primary">
                            <span className="flex items-center gap-1.5">
                              {selected ? <Check size={12} className="text-accent" /> : null}
                              {m.label}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-text-secondary">—</td>
                          <td className="px-2 py-2">
                            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-500">
                              {t.listed_model_unpriced}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-text-muted">—</td>
                          <td className="px-2 py-2" />
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="px-2 py-6 text-center text-xs text-text-muted">
                  {t.restyle_setup_no_pricing}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 聊天区「请先确认这 3 项制作规格」表：与右侧选项区读写同一份项目状态。
 * 确认按钮由父级回写并推进阶段（onConfirm）。
 */
export function RestyleSpecCard({
  project,
  videoPricing,
  listedVideoModels,
  currentVideoModel,
  onPatch,
  onConfirm,
  t,
}: PanelProps & { onConfirm: () => void }) {
  const config = resolveExecutionConfig(project);
  const [open, setOpen] = useState(true);
  const currentPricing = pricingForVideoModel(videoPricing, currentVideoModel);
  const modeTitle = MODE_META.find((item) => item.mode === config.executionMode)?.titleKey;
  // 已上架但未配价的模型：并入可选项并标注「暂未计费」
  const unpricedListed = (listedVideoModels ?? []).filter(
    (m) => !m.priced && !videoPricing.some((row) => row.modelId === m.id),
  );

  return (
    <div
      className="w-full rounded-2xl border border-border bg-bg-surface p-3 shadow-card"
      data-testid="restyle-spec-card"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 text-left text-xs font-semibold text-text-primary"
      >
        <ChevronDown
          size={14}
          className={`text-accent transition-transform ${open ? "" : "-rotate-90"}`}
        />
        {t.restyle_setup_spec_title}
      </button>
      {open ? (
        <div className="mt-2 space-y-2.5">
          <OptionRow<RestyleExecutionMode>
            label={t.restyle_setup_mode_label}
            value={config.executionMode}
            onChange={(executionMode) => onPatch({ executionMode })}
            options={MODE_META.map((item) => ({ value: item.mode, label: t[item.titleKey] }))}
          />
          <OptionRow<RestyleAspect>
            label={t.restyle_setup_aspect}
            value={project?.aspect ?? "9:16"}
            onChange={(aspect) => onPatch({ aspect })}
            options={RESTYLE_ASPECTS.map((aspect) => ({ value: aspect, label: aspect }))}
          />
          <div>
            <p className="text-[11px] font-medium text-text-muted">{t.restyle_setup_video_model}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {videoPricing.length ? (
                // 每个模型取 720P 优先档作为可选项；同一模型多档只出现一次。
                videoPricing
                  .filter(
                    (row, index, rows) =>
                      rows.findIndex((item) => item.modelId === row.modelId) === index,
                  )
                  .map((row) => {
                    const pricing = pricingForVideoModel(videoPricing, row.modelId) ?? row;
                    const selected = row.modelId === currentVideoModel;
                    return (
                      <button
                        key={row.modelId}
                        type="button"
                        onClick={() => onPatch({ videoModel: row.modelId })}
                        aria-pressed={selected}
                        className={`rounded-md border px-2.5 py-1 text-[11px] ${
                          selected
                            ? "border-accent bg-accent-dim text-accent"
                            : "border-border text-text-secondary hover:bg-bg-elevated"
                        }`}
                      >
                        {pricing.label}
                        {` · ${formatCredits(pricing.credits)} ${t.restyle_setup_price_unit}`}
                        {pricing.isDefault ? ` · ${t.restyle_setup_col_default}` : ""}
                      </button>
                    );
                  })
              ) : (
                <span className="text-[11px] text-text-muted">
                  {currentPricing
                    ? `${currentPricing.label} · ${formatCredits(currentPricing.credits)} ${t.restyle_setup_price_unit}`
                    : t.restyle_setup_no_pricing}
                </span>
              )}
              {unpricedListed.map((m) => (
                <button
                  key={`unpriced-${m.id}`}
                  type="button"
                  onClick={() => onPatch({ videoModel: m.id })}
                  aria-pressed={m.id === currentVideoModel}
                  className={`rounded-md border px-2.5 py-1 text-[11px] ${
                    m.id === currentVideoModel
                      ? "border-accent bg-accent-dim text-accent"
                      : "border-border text-text-secondary hover:bg-bg-elevated"
                  }`}
                >
                  {m.label}
                  {` · ${t.listed_model_unpriced}`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-border/60 pt-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={!project}
              className="btn-primary !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.restyle_setup_spec_confirm}
            </button>
            <span className="text-[10px] text-text-muted">
              {modeTitle ? t[modeTitle] : ""}
              {config.executionMode !== "guided"
                ? ` · ${t.restyle_setup_budget} ${config.autoBudget || DEFAULT_AUTO_BUDGET}`
                : ""}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
