import { useEffect, useState } from "react";
import {
  Loader2,
  Sparkles,
  Send,
  Download,
  Palette,
  BookOpen,
  Star,
  Shirt,
  SmilePlus,
  Eye,
  FileText,
  Check,
  RefreshCw,
  ArrowLeft,
  Pencil,
  RotateCcw,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useLanguage } from "../i18n/LanguageContext";
import { generateScript } from "../lib/openrouter.functions";
import { generateImage } from "../lib/seedream.functions";
import { realImageModelOptions } from "../components/NewProjectDialog";
import { useListedModels } from "../hooks/useListedModels";
import {
  formatModelOptionLabel,
  resolveDefaultModel,
  sortListedModels,
} from "../hooks/modelOptions";
import { logImageMeta } from "../lib/logImageMeta";
import { ImageReviewBadge } from "../components/ImageReviewBadge";
import { toast } from "sonner";

type Tab = "front" | "side-left" | "side-right" | "back" | "expression" | "accessory";
type Step = "brief" | "profile" | "style" | "hero" | "sheet";

const VIEWS = ["front", "side-left", "side-right", "back", "expression", "accessory"] as Tab[];

// Style-specific prompt enhancers to ensure visual consistency across views
const STYLE_PROMPTS: Record<string, { positive: string; negative: string }> = {
  "Visual Novel": {
    positive:
      "visual novel CG style, soft cel-shading, clean line art, expressive eyes, anime-influenced lighting, painterly skin tones",
    negative: "photo-realistic, 3d render, low quality",
  },
  Chibi: {
    positive:
      "super-deformed chibi style, large head small body, cute proportions, bold outlines, pastel colors, kawaii",
    negative: "realistic proportions, gritty, dark",
  },
  "Ethereal Gothic": {
    positive:
      "ethereal gothic aesthetic, baroque costume, candle lighting, deep shadows, ornate details, moody desaturated palette",
    negative: "bright pastel, cartoon, chibi",
  },
  Realistic: {
    positive:
      "photorealistic portrait, real human skin texture with natural pores and skin grain, fine vellus hair on cheeks, subtle skin tone unevenness, minimal natural blemishes, natural makeup finish, natural sebum sheen, soft specular highlights, commercial photography grade, anatomically accurate, cinematic lighting, depth of field",
    negative:
      "cartoon, anime, flat shading, over-smoothing, plastic skin, airbrushed, wax figure, mannequin, AI beauty filter, excessive skin retouching, glass skin, poreless skin, doll-like skin",
  },
  Anime: {
    positive:
      "modern anime style, vibrant cel-shading, sharp line art, dynamic hair rendering, glossy highlights",
    negative: "photo, realistic, western comic",
  },
  Watercolor: {
    positive:
      "watercolor painting, soft washes, paper texture, gentle bleeding edges, delicate pastel palette",
    negative: "digital flat colors, 3d, sharp vector",
  },
  Cyberpunk: {
    positive:
      "cyberpunk style, neon-lit, holographic accents, futuristic streetwear, chromatic glow, night city ambience",
    negative: "medieval, pastoral, soft pastel",
  },
  "Pixel Art": {
    positive: "16-bit pixel art, limited palette, crisp pixels, dithering, retro JRPG aesthetic",
    negative: "smooth gradients, photo, 3d",
  },
  "Oil Painting": {
    positive:
      "classical oil painting, visible brush strokes, rich impasto, chiaroscuro lighting, museum quality",
    negative: "digital flat, pixel, anime",
  },
  "Ink Wash": {
    positive:
      "East Asian ink wash painting (sumi-e), expressive brushwork, monochrome with subtle color accents, rice paper texture",
    negative: "vibrant cgi, neon, photo",
  },
  "3D Render": {
    positive:
      "octane 3d render, physically based shading, subsurface scattering, studio HDRI lighting, ultra detailed",
    negative: "flat 2d, sketch, low poly",
  },
  "Western Comic": {
    positive:
      "western comic book style, bold ink outlines, halftone shading, dynamic poses, saturated primary colors",
    negative: "manga, photo, watercolor",
  },
};

const COMPOSITION_PROMPTS: Record<string, string> = {
  portrait: "tight head-and-shoulders portrait framing, eye-level, centered",
  half: "half-body composition from waist up, slight three-quarter angle",
  full: "full body composition, head-to-toe, balanced framing",
  action: "dynamic action pose, sense of motion, dramatic stance",
  dynamic: "dynamic camera angle, low or high perspective, cinematic depth",
};

const VIEW_PROMPTS: Record<Tab, string> = {
  front: "full body front view, T-pose reference sheet style",
  "side-left":
    "full body strict left side profile view, orthographic, character's LEFT side facing camera",
  "side-right":
    "full body strict right side profile view, orthographic, character's RIGHT side facing camera",
  back: "full body back view, orthographic, showing hairstyle and costume rear details",
  expression: "facial expression sheet, close-up portrait, multiple subtle expressions implied",
  accessory: "isolated character accessories and costume parts laid out as a design sheet",
};

export default function Characters() {
  const { t, lang } = useLanguage();
  const callGenerateText = useServerFn(generateScript);
  const callGenerateImage = useServerFn(generateImage);

  const [step, setStep] = useState<Step>("brief");
  const [brief, setBrief] = useState("");
  const [profile, setProfile] = useState("");
  const [editingProfile, setEditingProfile] = useState(false);
  const styles = [
    { key: "Visual Novel", label: t.char_style_vn },
    { key: "Chibi", label: t.char_style_chibi },
    { key: "Ethereal Gothic", label: t.char_style_gothic },
    { key: "Realistic", label: t.char_style_realistic },
    { key: "Anime", label: t.char_style_anime },
    { key: "Watercolor", label: t.char_style_watercolor },
    { key: "Cyberpunk", label: t.char_style_cyberpunk },
    { key: "Pixel Art", label: t.char_style_pixel },
    { key: "Oil Painting", label: t.char_style_oil },
    { key: "Ink Wash", label: t.char_style_ink },
    { key: "3D Render", label: t.char_style_3d },
    { key: "Western Comic", label: t.char_style_comic },
  ];
  const [selectedStyle, setSelectedStyle] = useState("Visual Novel");
  const compositions = [
    { key: "portrait", label: t.char_comp_portrait },
    { key: "half", label: t.char_comp_half },
    { key: "full", label: t.char_comp_full },
    { key: "action", label: t.char_comp_action },
    { key: "dynamic", label: t.char_comp_dynamic },
  ];
  const [selectedComposition, setSelectedComposition] = useState("full");
  const [imageModel, setImageModel] = useState<string>("");
  // 模型目录唯一数据源：已上架 + 启用；接口异常时回落静态列表（与
  // NewProjectDialog/转绘同一份 realImageModelOptions，替代重复的 IMAGE_MODELS）。
  const { models: listedImageModels } = useListedModels("image", realImageModelOptions);
  // 默认值链（全站统一）：库内 is_default 行 → sortOrder 最前 → 硬编码兜底
  const badgeLabels = {
    unpricedLabel: t.listed_model_unpriced,
    defaultLabel: t.restyle_setup_col_default,
  };
  useEffect(() => {
    if (!listedImageModels.length || listedImageModels.some((m) => m.id === imageModel)) return;
    setImageModel(resolveDefaultModel(listedImageModels, undefined, "doubao-seedream-5-0-260128"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listedImageModels]);
  const [generatedImages, setGeneratedImages] = useState<Record<Tab, string>>({
    front: "",
    "side-left": "",
    "side-right": "",
    back: "",
    expression: "",
    accessory: "",
  });
  const [promptPreview, setPromptPreview] = useState<Record<Tab, string>>({
    front: "",
    "side-left": "",
    "side-right": "",
    back: "",
    expression: "",
    accessory: "",
  });
  const [selectedImage, setSelectedImage] = useState<Tab>("front");
  const [activeTab, setActiveTab] = useState<Tab>("front");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");
  const buildPrompt = (v: Tab, desc: string) => {
    const styleConf = STYLE_PROMPTS[selectedStyle] || {
      positive: `${selectedStyle} style`,
      negative: "",
    };
    const compConf = COMPOSITION_PROMPTS[selectedComposition] || "";
    const consistencyAnchor = `consistent character design, same outfit and hairstyle across all views, neutral studio background, character sheet, master reference of: ${desc}`;
    const composition = v === "expression" || v === "accessory" ? "" : compConf;
    return [
      consistencyAnchor,
      styleConf.positive,
      composition,
      VIEW_PROMPTS[v],
      "high quality illustration, sharp focus, professional concept art",
      styleConf.negative ? `Avoid: ${styleConf.negative}.` : "",
    ]
      .filter(Boolean)
      .join(", ");
  };

  const generateProfile = async (b: string) => {
    setLoading(true);
    setError("");
    setLoadingMsg(t.char_step_profile);
    try {
      const userPrompt =
        lang === "zh"
          ? `作为资深艺术总监，根据以下导演简报，撰写完整的角色档案（外貌特征、性格气质、背景故事、服装配饰、关键道具）。用中文，结构化分点列出，约200字：\n${b}`
          : `As a senior art director, write a complete character profile (appearance, personality, background, costume, key props) based on this director brief. Structured bullet points, ~200 words:\n${b}`;
      const res = await callGenerateText({
        data: {
          messages: [
            { role: "system", content: t.char_system_designer },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 600,
          temperature: 0.85,
        },
      });
      if (res.error && !res.content) {
        setError(res.error);
        return;
      }
      setProfile(res.content || "");
      setStep("profile");
    } catch (e: any) {
      setError(e?.message || "Error");
    } finally {
      setLoading(false);
      setLoadingMsg("");
    }
  };

  const generateHero = async () => {
    setLoading(true);
    setError("");
    setLoadingMsg(t.char_step_hero);
    const v: Tab = "front";
    const prompt = buildPrompt(v, profile || brief);
    setPromptPreview((p) => ({ ...p, [v]: prompt }));
    try {
      const r = await callGenerateImage({ data: { prompt, model: imageModel || undefined } });
      logImageMeta("characters.hero", r);
      if (r.url) {
        setGeneratedImages((prev) => ({ ...prev, front: r.url }));
        setSelectedImage("front");
        setActiveTab("front");
        setStep("hero");
      } else {
        setError(r.error || t.char_image_generation_failed);
      }
    } catch (e: any) {
      setError(e?.message || "Error");
    } finally {
      setLoading(false);
      setLoadingMsg("");
    }
  };

  const generateSheet = async () => {
    setLoading(true);
    setError("");
    setLoadingMsg(t.char_step_sheet);
    const restViews: Tab[] = ["side-left", "side-right", "back", "expression", "accessory"];
    const previews = restViews.reduce(
      (acc, v) => {
        acc[v] = buildPrompt(v, profile || brief);
        return acc;
      },
      {} as Record<string, string>,
    );
    setPromptPreview((p) => ({ ...p, ...previews }));
    try {
      const results = await Promise.allSettled(
        restViews.map(async (v) => {
          const out = await callGenerateImage({
            data: { prompt: previews[v], model: imageModel || undefined },
          });
          logImageMeta(`characters.sheet.${v}`, out);
          return { v, ...out };
        }),
      );
      const next = { ...generatedImages };
      let imgError = "";
      results.forEach((r) => {
        if (r.status === "fulfilled") {
          if (r.value.url) {
            const view = r.value.v as Tab;
            next[view] = r.value.url;
          } else if (r.value.error) imgError = r.value.error;
        } else imgError = r.reason?.message || imgError;
      });
      setGeneratedImages(next);
      setStep("sheet");
      if (!Object.values(next).filter(Boolean).length && imgError) setError(imgError);
    } catch (e: any) {
      setError(e?.message || "Error");
    } finally {
      setLoading(false);
      setLoadingMsg("");
    }
  };

  const restart = () => {
    setStep("brief");
    setBrief("");
    setProfile("");
    setEditingProfile(false);
    setGeneratedImages({
      front: "",
      "side-left": "",
      "side-right": "",
      back: "",
      expression: "",
      accessory: "",
    });
    setPromptPreview({
      front: "",
      "side-left": "",
      "side-right": "",
      back: "",
      expression: "",
      accessory: "",
    });
    setError("");
  };

  const copyPalette = () => {
    const colors = ["#59C9D5", "#83CBA4", "#B5D684", "#e8f0f6", "#1a3530"];
    navigator.clipboard.writeText(colors.join(", "));
  };

  const stepsMeta: { key: Step; label: string }[] = [
    { key: "brief", label: t.char_step_brief },
    { key: "profile", label: t.char_step_profile },
    { key: "style", label: t.char_step_style },
    { key: "hero", label: t.char_step_hero },
    { key: "sheet", label: t.char_step_sheet },
  ];
  const stepIndex = stepsMeta.findIndex((s) => s.key === step);

  return (
    <div
      className="flex flex-col lg:flex-row gap-6 animate-fade-in"
      style={{ minHeight: "calc(100vh - 120px)" }}
    >
      {/* Left: Director workflow */}
      <div className="lg:w-[420px] flex flex-col panel p-4 md:p-5 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-emerald-500 flex items-center justify-center">
            <Sparkles size={18} className="text-white" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-text-primary">{t.characters_title}</h2>
            <p className="text-xs text-text-muted">{t.characters_subtitle}</p>
          </div>
          {step !== "brief" && (
            <button
              onClick={restart}
              className="text-xs text-text-muted hover:text-accent flex items-center gap-1"
              title={t.char_action_restart}
            >
              <RotateCcw size={12} /> {t.char_action_restart}
            </button>
          )}
        </div>

        {/* Stepper */}
        <ol className="flex flex-col gap-1.5">
          {stepsMeta.map((s, i) => {
            const state = i < stepIndex ? "done" : i === stepIndex ? "active" : "pending";
            return (
              <li
                key={s.key}
                className={`flex items-center gap-2.5 text-xs px-3 py-2 rounded-lg border transition ${
                  state === "active"
                    ? "border-accent/50 bg-accent-dim/30 text-text-primary"
                    : state === "done"
                      ? "border-border bg-bg-elevated text-text-secondary"
                      : "border-border/50 text-text-muted"
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 ${
                    state === "done"
                      ? "bg-emerald-500/80 text-white"
                      : state === "active"
                        ? "bg-accent text-white"
                        : "bg-bg-elevated border border-border"
                  }`}
                >
                  {state === "done" ? <Check size={11} /> : i + 1}
                </span>
                <span className="flex-1">{s.label}</span>
                {state === "active" && loading && (
                  <Loader2 size={12} className="animate-spin text-accent" />
                )}
              </li>
            );
          })}
        </ol>

        {/* Step body */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {step === "brief" && (
            <div className="space-y-3">
              <p className="text-xs text-text-muted">{t.char_step_brief_hint}</p>
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && brief.trim()) {
                    e.preventDefault();
                    generateProfile(brief);
                  }
                }}
                placeholder={t.char_desc_hint}
                rows={4}
                className="w-full rounded-xl bg-bg-elevated border border-border text-sm text-text-primary p-3 resize-none focus:outline-none focus:border-accent/50 transition placeholder:text-text-muted"
              />
              <button
                onClick={() => generateProfile(brief)}
                disabled={loading || !brief.trim()}
                className="w-full btn-primary justify-center disabled:opacity-40"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                {loading ? t.char_generating : t.char_action_confirm}
              </button>
            </div>
          )}

          {step === "profile" && (
            <div className="space-y-3">
              <p className="text-xs text-text-muted">{t.char_step_profile_hint}</p>
              {editingProfile ? (
                <textarea
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                  rows={10}
                  className="w-full rounded-xl bg-bg-elevated border border-border text-sm text-text-primary p-3 resize-none focus:outline-none focus:border-accent/50"
                />
              ) : (
                <div className="bg-bg-elevated rounded-xl p-3 text-sm text-text-secondary whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
                  {profile}
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => setEditingProfile((v) => !v)} className="btn-ghost text-xs">
                  <Pencil size={13} /> {editingProfile ? t.char_action_confirm : t.char_action_edit}
                </button>
                <button
                  onClick={() => generateProfile(brief)}
                  disabled={loading}
                  className="btn-ghost text-xs"
                >
                  <RefreshCw size={13} /> {t.char_action_regen}
                </button>
                <button onClick={() => setStep("brief")} className="btn-ghost text-xs">
                  <ArrowLeft size={13} /> {t.char_action_back}
                </button>
                <button
                  onClick={() => {
                    setEditingProfile(false);
                    setStep("style");
                  }}
                  className="btn-primary text-xs ml-auto"
                >
                  <Check size={13} /> {t.char_action_confirm}
                </button>
              </div>
            </div>
          )}

          {step === "style" && (
            <div className="space-y-3">
              <p className="text-xs text-text-muted">{t.char_step_style_hint}</p>
              <div>
                <label className="text-xs font-medium text-text-muted mb-2 block">
                  {t.char_style}
                </label>
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto pr-1">
                  {styles.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => setSelectedStyle(s.key)}
                      className={`chip text-xs ${selectedStyle === s.key ? "chip-active" : ""}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-text-muted mb-2 block">
                  {t.char_composition}
                </label>
                <div className="flex flex-wrap gap-2">
                  {compositions.map((c) => (
                    <button
                      key={c.key}
                      onClick={() => setSelectedComposition(c.key)}
                      className={`chip text-xs ${selectedComposition === c.key ? "chip-active" : ""}`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-text-muted mb-2 block">
                  Image Model
                </label>
                <select
                  value={imageModel}
                  onChange={(e) => setImageModel(e.target.value)}
                  className="w-full rounded-lg bg-bg-elevated border border-border text-xs text-text-primary px-3 py-2 focus:outline-none focus:border-accent/50"
                >
                  {sortListedModels(listedImageModels).map((m) => (
                    <option key={m.id} value={m.id}>
                      {formatModelOptionLabel(m, badgeLabels)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setStep("profile")} className="btn-ghost text-xs">
                  <ArrowLeft size={13} /> {t.char_action_back}
                </button>
                <button
                  onClick={generateHero}
                  disabled={loading}
                  className="btn-primary text-xs ml-auto justify-center"
                >
                  {loading ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Sparkles size={13} />
                  )}
                  {t.char_action_generate_hero}
                </button>
              </div>
            </div>
          )}

          {step === "hero" && (
            <div className="space-y-3">
              <p className="text-xs text-text-muted">{t.char_step_hero_hint}</p>
              <div className="flex gap-2 flex-wrap">
                <button onClick={generateHero} disabled={loading} className="btn-ghost text-xs">
                  <RefreshCw size={13} /> {t.char_action_regen}
                </button>
                <button onClick={() => setStep("style")} className="btn-ghost text-xs">
                  <ArrowLeft size={13} /> {t.char_action_back}
                </button>
                <button
                  onClick={generateSheet}
                  disabled={loading}
                  className="btn-primary text-xs ml-auto"
                >
                  {loading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  {t.char_action_generate_sheet}
                </button>
              </div>
            </div>
          )}

          {step === "sheet" && (
            <div className="space-y-3">
              <p className="text-xs text-text-muted">{t.char_step_sheet_hint}</p>
              <div className="flex gap-2 flex-wrap">
                <button onClick={generateSheet} disabled={loading} className="btn-ghost text-xs">
                  <RefreshCw size={13} /> {t.char_action_regen}
                </button>
                <button onClick={() => setStep("hero")} className="btn-ghost text-xs">
                  <ArrowLeft size={13} /> {t.char_action_back}
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}
          {loading && loadingMsg && (
            <p className="text-xs text-text-muted flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" />
              {loadingMsg}…
            </p>
          )}
        </div>
      </div>

      {/* Right: Canvas */}
      <div className="flex-1 panel p-6 space-y-5">
        {Object.values(generatedImages).some(Boolean) ? (
          <>
            {/* View Tabs */}
            <div className="flex gap-2 flex-wrap">
              {VIEWS.map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setActiveTab(v);
                    if (generatedImages[v]) setSelectedImage(v);
                  }}
                  className={`chip text-xs ${activeTab === v && generatedImages[v] ? "chip-active" : ""}`}
                >
                  {v === "front" && <Eye size={12} />}
                  {v === "side-left" && <Shirt size={12} />}
                  {v === "side-right" && <Shirt size={12} />}
                  {v === "back" && <BookOpen size={12} />}
                  {v === "expression" && <SmilePlus size={12} />}
                  {v === "accessory" && <Star size={12} />}
                  {t[`char_view_${v}` as keyof typeof t] ?? v}
                </button>
              ))}
            </div>

            {/* Main Image */}
            <div className="relative rounded-2xl overflow-hidden border border-border bg-bg-elevated corner-frame">
              {generatedImages[selectedImage] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <>
                  <img
                    src={generatedImages[selectedImage]}
                    alt={selectedImage}
                    className="w-full max-h-[480px] object-contain"
                  />
                  <ImageReviewBadge
                    unsupported
                    unsupportedMessage="请在项目工作区选择视频模型后上传素材库。"
                    onRequestReview={() => toast.info("请在项目工作区选择视频模型后上传素材库。")}
                  />
                </>
              ) : (
                <div className="w-full h-64 flex items-center justify-center text-text-muted text-sm">
                  {loading ? t.char_generating : t.char_no_generate}
                </div>
              )}
            </div>

            {/* Thumbnails */}
            <div className="flex gap-3">
              {VIEWS.map(
                (v) =>
                  generatedImages[v] && (
                    <button
                      key={v}
                      onClick={() => setSelectedImage(v)}
                      className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                        selectedImage === v
                          ? "border-accent scale-105"
                          : "border-border hover:border-accent/40"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={generatedImages[v]} alt={v} className="w-20 h-20 object-cover" />
                      <ImageReviewBadge
                        unsupported
                        unsupportedMessage="请在项目工作区选择视频模型后上传素材库。"
                        onRequestReview={() =>
                          toast.info("请在项目工作区选择视频模型后上传素材库。")
                        }
                      />
                    </button>
                  ),
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button onClick={copyPalette} className="btn-ghost text-xs">
                <Palette size={14} />
                {t.char_copy_palette}
              </button>
              {generatedImages[selectedImage] && (
                <a
                  href={generatedImages[selectedImage]}
                  download={`character-${selectedImage}.png`}
                  className="btn-ghost text-xs"
                >
                  <Download size={14} />
                  {t.char_download}
                </a>
              )}
            </div>

            {/* Color Palette */}
            <div>
              <p className="text-xs font-medium text-text-muted mb-2">{t.char_color_palette}</p>
              <div className="flex gap-2">
                {["#59C9D5", "#83CBA4", "#B5D684", "#e8f0f6", "#1a3530"].map((c) => (
                  <button
                    key={c}
                    onClick={() => navigator.clipboard.writeText(c)}
                    className="w-9 h-9 rounded-lg border border-border shadow-sm hover:scale-110 transition"
                    style={{ background: c }}
                    title={c}
                  />
                ))}
              </div>
            </div>

            {/* Description */}
            {profile && (
              <div className="bg-bg-elevated rounded-xl p-4">
                <p className="text-xs font-medium text-text-muted mb-2">{t.char_desc}</p>
                <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
                  {profile}
                </p>
              </div>
            )}

            {/* Prompt Preview */}
            {Object.values(promptPreview).some(Boolean) && (
              <div className="bg-bg-elevated rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-text-muted" />
                  <p className="text-xs font-medium text-text-muted">{t.char_prompt_preview}</p>
                </div>
                <p className="text-[11px] text-text-muted">{t.char_prompt_preview_hint}</p>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {VIEWS.map(
                    (v) =>
                      promptPreview[v] && (
                        <details
                          key={v}
                          open={v === selectedImage}
                          className="group rounded-lg border border-border bg-bg-base"
                        >
                          <summary className="flex items-center justify-between cursor-pointer px-3 py-2 text-xs text-text-secondary">
                            <span className="font-medium">
                              {t[`char_view_${v}` as keyof typeof t] ?? v}
                            </span>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                navigator.clipboard.writeText(promptPreview[v]);
                              }}
                              className="text-[10px] text-text-muted hover:text-accent transition"
                            >
                              Copy
                            </button>
                          </summary>
                          <pre className="px-3 pb-3 text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words font-mono">
                            {promptPreview[v]}
                          </pre>
                        </details>
                      ),
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-20 space-y-4">
            <div className="w-20 h-20 rounded-full bg-bg-elevated border border-border flex items-center justify-center">
              <BookOpen size={32} className="text-text-muted" />
            </div>
            <div className="space-y-1">
              <p className="text-text-secondary font-medium">{t.characters_title}</p>
              <p className="text-sm text-text-muted">{t.char_no_generate}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
