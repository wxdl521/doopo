import { useState } from "react";
import { BookOpen, Check, Loader2, RotateCcw, Wand2 } from "lucide-react";
import type { Translations } from "../../i18n/zh";
import type { RestyleExtractedAsset, RestyleProject } from "./restyleStorage";
import type { RestyleStage } from "./restyleTypes";
import { buildAssetImagePrompt } from "./restylePrompt";
import { SKILLS } from "@/lib/restyle/skills";

/** 单个资产图本轮生成的运行状态，由 RestyleStudio 在生成循环里逐项更新。 */
export type RestyleAssetRunStatus = {
  status: "running" | "done" | "failed";
  error?: string;
};

const TIMELINE_STAGES = ["upload", "analysis", "assets", "plan", "render"] as const satisfies
  readonly RestyleStage[];

const STAGE_LABEL_KEY: Record<(typeof TIMELINE_STAGES)[number], keyof Translations> = {
  upload: "restyle_stage_upload",
  analysis: "restyle_stage_analysis",
  assets: "restyle_stage_assets",
  plan: "restyle_stage_plan",
  render: "restyle_stage_render",
};

/** 各处理阶段实际调用/遵循的 skill（v2 skill 驱动流水线口径，对用户可见）。 */
const STAGE_SKILLS: Record<(typeof TIMELINE_STAGES)[number], string[]> = {
  upload: [],
  analysis: ["video-analysis-extract", "audio-transcript-align"],
  assets: ["character-bible", "wardrobe-continuity"],
  plan: ["shot-to-segment", "restyle-prompt-contract"],
  render: ["restyle-prompt-contract"],
};

const KIND_LABEL_KEY: Record<RestyleExtractedAsset["kind"], keyof Translations> = {
  character: "restyle_assets_characters",
  scene: "restyle_assets_scenes",
  prop: "restyle_assets_props",
};

type RestyleProcessPanelProps = {
  project: RestyleProject | undefined;
  isAnalyzing: boolean;
  assetRunStatus: Record<string, RestyleAssetRunStatus>;
  onStyleBriefChange: (next: string) => void;
  onAssetPromptChange: (assetId: string, prompt: string) => void;
  onAssetPromptReset: (assetId: string) => void;
  onRegenerateAsset: (asset: RestyleExtractedAsset) => void;
  onSegmentPromptChange: (episode: string, segmentId: string, prompt: string) => void;
  t: Translations;
};

/**
 * 「过程与提示词」面板：把转绘的处理阶段、逐项资产生成进度、以及所有真实提示词
 * （目标画风公共前缀、资产图最终提示词、分段视频提示词）摊开在工作区右侧，
 * 用户可就地修改并按修改后的提示词重新生成。
 */
export function RestyleProcessPanel({
  project,
  isAnalyzing,
  assetRunStatus,
  onStyleBriefChange,
  onAssetPromptChange,
  onAssetPromptReset,
  onRegenerateAsset,
  onSegmentPromptChange,
  t,
}: RestyleProcessPanelProps) {
  const [openSkill, setOpenSkill] = useState<string | null>(null);
  if (!project) return null;

  const styleBrief = project.styleBrief ?? "";
  const stageIndex =
    project.stage === "review" ? TIMELINE_STAGES.length : TIMELINE_STAGES.indexOf(project.stage);
  const showAssetProgress = project.extractedAssets.length > 0 && stageIndex >= 2;
  const planEpisodes = project.planEpisodes ?? [];

  return (
    <section className="shrink-0 border-b border-border" data-testid="restyle-process-panel">
      {/* 标题/折叠层已由右栏 Tab 承担，内容始终展开 */}
      {
        <div className="space-y-4 px-4 pb-4">
          <div>
            <p className="mb-2 text-xs font-semibold text-text-primary">
              {t.restyle_process_timeline}
            </p>
            <ol className="space-y-1">
              {TIMELINE_STAGES.map((stage, index) => {
                const done = index < stageIndex;
                const current = index === stageIndex;
                return (
                  <li
                    key={stage}
                    className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs ${
                      current
                        ? "bg-accent-dim font-medium text-accent"
                        : done
                          ? "text-text-secondary"
                          : "text-text-muted"
                    }`}
                    aria-current={current ? "step" : undefined}
                  >
                    {done ? (
                      <Check size={12} className="shrink-0 text-accent" />
                    ) : current && isAnalyzing ? (
                      <Loader2 size={12} className="shrink-0 animate-spin" />
                    ) : (
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${current ? "bg-accent" : "bg-border"}`}
                      />
                    )}
                    <span>{t[STAGE_LABEL_KEY[stage]]}</span>
                    {STAGE_SKILLS[stage].length > 0 && (
                      <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
                        {STAGE_SKILLS[stage].map((skillId) => (
                          <button
                            key={skillId}
                            type="button"
                            title={skillId}
                            onClick={() => setOpenSkill(openSkill === skillId ? null : skillId)}
                            className={`inline-flex items-center gap-0.5 rounded border px-1 py-px font-mono text-[10px] transition ${
                              openSkill === skillId
                                ? "border-accent bg-accent-dim text-accent"
                                : "border-border/70 text-text-muted hover:text-text-secondary"
                            }`}
                          >
                            <BookOpen size={9} />
                            {skillId}
                          </button>
                        ))}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
            {openSkill && SKILLS[openSkill] && (
              <div className="mt-2 rounded-md border border-border/70 bg-background/60 p-2">
                <p className="mb-1 font-mono text-[10px] text-accent">{openSkill}</p>
                <pre className="max-h-44 overflow-y-auto font-mono text-[10px] leading-4 whitespace-pre-wrap text-text-secondary">
                  {SKILLS[openSkill]}
                </pre>
              </div>
            )}
            {showAssetProgress && (
              <ul className="mt-2 space-y-1 border-l border-border/70 pl-3">
                {project.extractedAssets.map((asset) => {
                  const run = assetRunStatus[asset.id];
                  const hasImage = project.files.some(
                    (file) =>
                      file.sourceAssetId === asset.id &&
                      file.generatedKind === asset.kind &&
                      Boolean(file.url),
                  );
                  const state = run?.status ?? (hasImage ? "done" : "pending");
                  return (
                    <li key={asset.id} className="text-xs leading-5">
                      <span className="text-text-secondary">
                        {t[KIND_LABEL_KEY[asset.kind]]} {asset.targetName || asset.sourceName}
                      </span>
                      <span
                        className={`ml-1.5 ${
                          state === "failed"
                            ? "text-destructive"
                            : state === "done"
                              ? "text-accent"
                              : "text-text-muted"
                        }`}
                      >
                        —{" "}
                        {state === "running"
                          ? t.restyle_asset_run_running
                          : state === "done"
                            ? t.restyle_asset_run_done
                            : state === "failed"
                              ? `${t.restyle_asset_run_failed}${run?.error ? `：${run.error}` : ""}`
                              : t.restyle_asset_run_pending}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold text-text-primary">{t.restyle_prompts_title}</p>
            <label
              className="mb-1 block text-[11px] text-text-muted"
              htmlFor="restyle-style-brief"
            >
              {t.restyle_style_brief_label}
            </label>
            <textarea
              id="restyle-style-brief"
              value={styleBrief}
              onChange={(event) => onStyleBriefChange(event.target.value)}
              rows={2}
              placeholder={t.restyle_style_brief_placeholder}
              className="w-full resize-y rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-xs leading-5 text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
            />
            <p className="mt-1 break-all text-[11px] leading-4 text-text-muted">
              {t.restyle_style_brief_preview}：【目标画风·必须严格遵守】
              {styleBrief.trim() || "…"}
            </p>
          </div>

          {project.extractedAssets.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-text-primary">
                {t.restyle_asset_prompts_title}
              </p>
              <div className="space-y-3">
                {project.extractedAssets.map((asset) => {
                  const autoPrompt = buildAssetImagePrompt(asset, styleBrief);
                  const overridden = Boolean(asset.promptOverride?.trim());
                  return (
                    <div
                      key={asset.id}
                      className="rounded-lg border border-border bg-bg-elevated p-2"
                    >
                      <p className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate font-medium text-text-primary">
                          {t[KIND_LABEL_KEY[asset.kind]]} · {asset.targetName || asset.sourceName}
                        </span>
                        {overridden && (
                          <span className="shrink-0 rounded bg-accent-dim px-1.5 py-0.5 text-[10px] text-accent">
                            {t.restyle_prompt_overridden}
                          </span>
                        )}
                      </p>
                      <textarea
                        value={asset.promptOverride ?? autoPrompt}
                        onChange={(event) => onAssetPromptChange(asset.id, event.target.value)}
                        rows={6}
                        aria-label={`${asset.targetName || asset.sourceName} prompt`}
                        className="w-full resize-y rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-[11px] leading-4 text-text-secondary outline-none focus:border-accent"
                      />
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onRegenerateAsset(asset)}
                          disabled={isAnalyzing}
                          className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-bg disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Wand2 size={12} />
                          {t.restyle_regenerate_with_prompt}
                        </button>
                        {overridden && (
                          <button
                            type="button"
                            onClick={() => onAssetPromptReset(asset.id)}
                            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg"
                          >
                            <RotateCcw size={12} />
                            {t.restyle_reset_prompt_override}
                          </button>
                        )}
                      </div>
                      {overridden && (
                        <p className="mt-1 text-[10px] leading-4 text-text-muted">
                          {t.restyle_prompt_override_hint}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {planEpisodes.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-text-primary">
                {t.restyle_segment_prompts_title}
              </p>
              <div className="space-y-3">
                {planEpisodes.flatMap((plan) =>
                  plan.segments.map((segment) => (
                    <div
                      key={`${plan.episode}:${segment.id}`}
                      className="rounded-lg border border-border bg-bg-elevated p-2"
                    >
                      <p className="mb-1 text-[11px] font-medium text-text-primary">
                        {plan.episode} · {segment.id}
                      </p>
                      <textarea
                        value={segment.prompt}
                        onChange={(event) =>
                          onSegmentPromptChange(plan.episode, segment.id, event.target.value)
                        }
                        rows={4}
                        aria-label={`${plan.episode} ${segment.id} prompt`}
                        className="w-full resize-y rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-[11px] leading-4 text-text-secondary outline-none focus:border-accent"
                      />
                    </div>
                  )),
                )}
              </div>
            </div>
          )}
        </div>
      }
    </section>
  );
}
