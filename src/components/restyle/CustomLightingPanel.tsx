// ====================================================================
// CustomLightingPanel —— 转绘「我的风格库」自定义光照面板
// 需求来源：《光线调度机制调整-20260804》第三节（路径 A/B）。
// - 路径 A：上传 1~3 张参考剧照 → extractLightingFromImages 提取 5 维
//   参数（只迁移色调映射，屏蔽纹理/背景/物象），写入 customLighting
//   （source: "reference"），参数随即暴露在下方调色台供微调。
// - 路径 B：5 维调色台（光比/色温 -100~+100 滑块；调色盘阴影/中间调/
//   高光文本；质感衰减与肤色保护 5 档选择），调整即写 customLighting
//   （source: "manual"）；「重置到地域预设」「清除自定义」一键回落。
// - 「生成标准色卡预览」按需手动触发（不随拖动自动生成），调生图通道
//   产一张含当前 5 维参数的色卡/灰阶测试图，失败友好提示。
// ====================================================================

import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Loader2, RotateCcw, Trash2 } from "lucide-react";
import type { Translations } from "../../i18n/zh";
import {
  formatLightingParams,
  LIGHTING_PRESETS,
  type LightingParams,
} from "../../lib/restyle/cameraDirection";
import { extractLightingFromImages } from "../../lib/restyle/lightingExtract.functions";
import { uploadLocalImage } from "../../lib/uploadImage.functions";
import { generateImage } from "../../lib/seedream.functions";
import type { RestyleProject } from "./restyleStorage";
import type { RestyleSetupPatch } from "./RestyleSetupPanel";

/** 质感衰减 5 档（值即写入 prompt 的影调描述，与内置预设同一口径）。 */
const TEXTURE_OPTIONS: Array<{ value: string; labelKey: keyof Translations }> = [
  { value: "高光奶油状扩散，暗部柔和不死黑", labelKey: "restyle_custom_texture_soft" },
  { value: "暗部死黑保留质感，高光锐化不溢出", labelKey: "restyle_custom_texture_hard" },
  { value: "整体低反差平滑，数字感干净", labelKey: "restyle_custom_texture_flat" },
  { value: "高光柔化漫反射，暗部轻提不死黑", labelKey: "restyle_custom_texture_diffuse" },
  { value: "暗部死黑，高光霓虹光晕柔化", labelKey: "restyle_custom_texture_neon" },
];

/** 肤色保护 5 档（同上：值即描述文本）。 */
const SKIN_OPTIONS: Array<{ value: string; labelKey: keyof Translations }> = [
  { value: "偏粉白，亚洲肤色保护防变绿变黄", labelKey: "restyle_custom_skin_asian" },
  { value: "偏古铜，欧美肤色保护", labelKey: "restyle_custom_skin_bronze" },
  { value: "偏暖金，深肤色提亮防变蜡黄", labelKey: "restyle_custom_skin_gold" },
  { value: "偏冷白，去饱和防红润", labelKey: "restyle_custom_skin_cool" },
  { value: "偏透明蓝，日系透明感保护", labelKey: "restyle_custom_skin_clear" },
];

const MAX_REFERENCE_IMAGES = 3;

const cloneParams = (params: LightingParams): LightingParams => ({
  ...params,
  palette: { ...params.palette },
});

/** 标准色卡/灰阶测试图 prompt：含当前 5 维参数，供预览色调映射畸变。 */
export function buildColorChartPrompt(params: LightingParams): string {
  return [
    "生成一张标准色卡/灰阶测试图：画面为排列整齐的灰阶阶梯条与标准色块（肤色、中性灰、三原色），无人物、无场景、无文字水印。",
    "该色卡用于预览以下光照风格参数的色调映射畸变（防止拉爆画面）：",
    formatLightingParams(params),
    "请按上述参数对整张色卡做统一的色调映射与影调处理，保持色卡网格布局清晰可读。",
  ].join("\n");
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

type PanelProps = {
  project: RestyleProject | undefined;
  onPatch: (patch: RestyleSetupPatch) => void;
  t: Translations;
};

export function CustomLightingPanel({ project, onPatch, t }: PanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const callExtract = useServerFn(extractLightingFromImages);
  const callUpload = useServerFn(uploadLocalImage);
  const callGenerateImage = useServerFn(generateImage);

  const market = project?.targetMarket ?? "kr";
  const custom = project?.customLighting;
  // 调色台展示基准：有自定义显示自定义，否则显示当前地域预设（首次调整即落为自定义）。
  const params = custom?.params ?? LIGHTING_PRESETS[market].params;
  const disabled = !project || extracting;

  /** 路径 B：任何微调即写 customLighting（source: "manual"）。 */
  function writeParams(next: LightingParams) {
    onPatch({
      customLighting: {
        name: custom?.name ?? t.restyle_custom_name_default,
        params: next,
        source: "manual",
      },
    });
  }

  function patchDim(patch: Partial<LightingParams>) {
    writeParams({ ...cloneParams(params), ...patch });
  }

  function patchPalette(key: keyof LightingParams["palette"], value: string) {
    writeParams({ ...cloneParams(params), palette: { ...params.palette, [key]: value } });
  }

  /** 路径 A：上传 1~3 张参考图 → 提取 5 维参数写入 customLighting（source: "reference"）。 */
  async function handleReferenceFiles(files: FileList | null) {
    if (!project || !files?.length) return;
    const picked = [...files].filter((file) => file.type.startsWith("image/")).slice(0, MAX_REFERENCE_IMAGES);
    if (!picked.length) return;
    setError(null);
    setExtracting(true);
    try {
      const urls: string[] = [];
      for (const file of picked) {
        const base64 = await readFileAsDataUrl(file);
        const uploaded = await callUpload({
          data: { base64, id: `lighting-ref-${crypto.randomUUID()}`, kind: "shot" },
        });
        if (!uploaded.ok || !uploaded.url) {
          throw new Error(uploaded.ok ? "上传失败：未返回图片地址" : `上传失败：${uploaded.error}`);
        }
        urls.push(uploaded.url);
      }
      const result = await callExtract({ data: { imageUrls: urls } });
      if (!result.ok) throw new Error(result.error);
      onPatch({
        customLighting: { name: result.name, params: result.params, source: "reference" },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /** 标准色卡预览：手动点击触发（不随滑块拖动自动生成）。 */
  async function handlePreview() {
    if (!project) return;
    setError(null);
    setPreviewing(true);
    try {
      const result = await callGenerateImage({
        data: { prompt: buildColorChartPrompt(params) },
      });
      if (!result.url) throw new Error(result.error || "色卡生成失败：未返回图片");
      setPreviewUrl(result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-bg-elevated/50 p-2.5" data-testid="custom-lighting-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-text-muted">{t.restyle_custom_title}</p>
        {custom ? (
          <span className="rounded bg-accent-dim px-1.5 py-px text-[9px] text-accent">
            {t.restyle_custom_active}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-[10px] leading-4 text-text-muted" data-testid="custom-lighting-status">
        {custom
          ? `${custom.name} · ${custom.source === "reference" ? t.restyle_custom_source_reference : t.restyle_custom_source_manual}`
          : t.restyle_custom_inactive}
      </p>

      {/* 路径 A：参考图提取 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        aria-label={t.restyle_custom_extract}
        onChange={(event) => void handleReferenceFiles(event.target.files)}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[11px] text-text-secondary hover:bg-bg-elevated hover:text-accent disabled:opacity-50"
      >
        {extracting ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
        {extracting ? t.restyle_custom_extracting : t.restyle_custom_extract}
      </button>
      <p className="mt-1 text-[10px] leading-4 text-text-muted">{t.restyle_custom_extract_hint}</p>

      {/* 路径 B：调色台（5 维） */}
      <div className="mt-2.5 space-y-2 border-t border-border/60 pt-2">
        <label className="block">
          <span className="text-[10px] text-text-muted">{t.restyle_custom_name}</span>
          <input
            type="text"
            value={custom?.name ?? ""}
            placeholder={t.restyle_custom_name_default}
            disabled={!project}
            onChange={(event) =>
              onPatch({
                customLighting: {
                  name: event.target.value || t.restyle_custom_name_default,
                  params: cloneParams(params),
                  source: custom?.source ?? "manual",
                },
              })
            }
            className="mt-0.5 w-full rounded-md border border-border bg-bg-elevated px-2 py-1 text-[11px] text-text-primary outline-none focus:border-accent disabled:opacity-50"
          />
        </label>

        {(
          [
            { key: "contrastRatio" as const, label: t.restyle_setup_lighting_dim_contrast },
            { key: "tempTint" as const, label: t.restyle_setup_lighting_dim_temp },
          ]
        ).map(({ key, label }) => (
          <label key={key} className="block">
            <span className="flex items-center justify-between text-[10px] text-text-muted">
              <span>{label}</span>
              <span data-testid={`custom-lighting-${key}-value`}>
                {params[key] > 0 ? `+${params[key]}` : params[key]}
              </span>
            </span>
            <input
              type="range"
              min={-100}
              max={100}
              step={1}
              value={params[key]}
              disabled={!project}
              aria-label={label}
              onChange={(event) => patchDim({ [key]: Number(event.target.value) })}
              className="mt-0.5 w-full accent-[var(--accent)] disabled:opacity-50"
            />
          </label>
        ))}

        <div>
          <p className="text-[10px] text-text-muted">{t.restyle_setup_lighting_dim_palette}</p>
          <div className="mt-0.5 space-y-1">
            {(
              [
                { key: "shadows" as const, label: t.restyle_custom_palette_shadows },
                { key: "midtones" as const, label: t.restyle_custom_palette_midtones },
                { key: "highlights" as const, label: t.restyle_custom_palette_highlights },
              ]
            ).map(({ key, label }) => (
              <label key={key} className="flex items-center gap-1.5">
                <span className="w-12 shrink-0 text-[10px] text-text-muted">{label}</span>
                <input
                  type="text"
                  value={params.palette[key]}
                  disabled={!project}
                  aria-label={`${t.restyle_setup_lighting_dim_palette}-${label}`}
                  onChange={(event) => patchPalette(key, event.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-border bg-bg-elevated px-2 py-1 text-[11px] text-text-primary outline-none focus:border-accent disabled:opacity-50"
                />
              </label>
            ))}
          </div>
        </div>

        {(
          [
            {
              label: t.restyle_setup_lighting_dim_texture,
              value: params.textureRollOff,
              options: TEXTURE_OPTIONS,
              onChange: (value: string) => patchDim({ textureRollOff: value }),
              testId: "custom-lighting-texture",
            },
            {
              label: t.restyle_setup_lighting_dim_skin,
              value: params.skinToneOffset,
              options: SKIN_OPTIONS,
              onChange: (value: string) => patchDim({ skinToneOffset: value }),
              testId: "custom-lighting-skin",
            },
          ]
        ).map(({ label, value, options, onChange, testId }) => (
          <label key={testId} className="block">
            <span className="text-[10px] text-text-muted">{label}</span>
            <select
              value={value}
              disabled={!project}
              aria-label={label}
              data-testid={testId}
              onChange={(event) => onChange(event.target.value)}
              className="mt-0.5 w-full rounded-md border border-border bg-bg-elevated px-2 py-1 text-[11px] text-text-primary outline-none focus:border-accent disabled:opacity-50"
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {t[option.labelKey]}
                </option>
              ))}
              {/* 提取/历史值不在档位内时原样展示，避免 select 值丢失。 */}
              {options.some((option) => option.value === value) ? null : (
                <option value={value}>{value}</option>
              )}
            </select>
          </label>
        ))}
      </div>

      {/* 操作：色卡预览 / 重置 / 清除 */}
      <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
        <button
          type="button"
          onClick={() => void handlePreview()}
          disabled={!project || previewing}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-elevated hover:text-accent disabled:opacity-50"
        >
          {previewing ? <Loader2 size={11} className="animate-spin" /> : null}
          {previewing ? t.restyle_custom_previewing : t.restyle_custom_preview}
        </button>
        <button
          type="button"
          onClick={() =>
            project &&
            onPatch({
              customLighting: {
                name: custom?.name ?? t.restyle_custom_name_default,
                params: cloneParams(LIGHTING_PRESETS[market].params),
                source: "manual",
              },
            })
          }
          disabled={!project}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-elevated hover:text-accent disabled:opacity-50"
        >
          <RotateCcw size={11} />
          {t.restyle_custom_reset_preset}
        </button>
        {custom ? (
          <button
            type="button"
            onClick={() => onPatch({ customLighting: undefined })}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-elevated hover:text-accent"
          >
            <Trash2 size={11} />
            {t.restyle_custom_clear}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-2 text-[10px] leading-4 text-red-400" role="alert" data-testid="custom-lighting-error">
          {error}
        </p>
      ) : null}
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={t.restyle_custom_preview}
          data-testid="custom-lighting-preview"
          className="mt-2 w-full rounded-md border border-border"
        />
      ) : null}
    </div>
  );
}
