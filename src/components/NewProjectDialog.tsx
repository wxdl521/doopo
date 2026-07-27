import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Grid3x3, GitBranch, Zap, Video, X, Check, Flame, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "./ui/dialog";
import { useLanguage } from "../i18n/LanguageContext";
import { IMAGE_MODELS } from "../lib/imageModels";
import { upsertProject } from "../lib/projects.functions";
import { loadUserPrefs, saveUserPrefs } from "../lib/userPreferences";
import { useAuth } from "../hooks/useAuth";
import { toast } from "sonner";
import style3dCg from "../assets/styles/3d-cg.jpg";
import styleAnimeJp from "../assets/styles/anime-jp.jpg";
import stylePixar from "../assets/styles/pixar.jpg";
import styleRealistic from "../assets/styles/realistic.jpg";
import styleWuxia from "../assets/styles/wuxia.jpg";
import styleChibi from "../assets/styles/chibi.jpg";
import styleShinkai from "../assets/styles/shinkai.jpg";
import styleHealing from "../assets/styles/healing.jpg";
import styleCyberpunk from "../assets/styles/cyberpunk.jpg";
import styleComic from "../assets/styles/comic.jpg";
import stylePixel from "../assets/styles/pixel.jpg";
import styleClay from "../assets/styles/clay.jpg";

const aspects = [
  { id: "16:9", label: "16:9", cost: 11 },
  { id: "9:16", label: "9:16", cost: 11 },
  { id: "1:1", label: "1:1", cost: 9 },
];
// Image models for storyboard / scene —— Seedream 优先,legacy 作为手动兜底层
// 2026 重构:默认走 Doubao Seedream(火山方舟 ARK),用户可手动切到 Qwen / Wan / Gemini 等
const imageModelOptions = [
  // ---- 主力:Seedream ----
  { id: "doubao-seedream-5-0-260128", label: "Doubao Seedream 5.0", sub: "默认 · 同步" },

  // ---- Legacy 兜底层(用户手动选;seedream 模块会委派到 openrouterImage)----
  { id: "__sep__", label: "—— Legacy 兜底层 ——", sub: "" },
  { id: "qwen-image-2.0", label: "Qwen Image 2.0", sub: "通义千问 · T2I 稳定" },
  { id: "qwen-image-2.0-pro", label: "Qwen Image 2.0 Pro", sub: "通义千问 · I2I" },
  { id: "qwen-image-plus", label: "Qwen Image Plus", sub: "通义千问 · 高清" },
  { id: "qwen-image", label: "Qwen Image", sub: "通义千问 · 基础" },
  { id: "wan2.6-t2i", label: "万相 2.6 文生图", sub: "Wan · 推荐" },
  { id: "wan2.5-t2i-preview", label: "万相 2.5 文生图 Preview", sub: "Wan · 自由尺寸" },
  { id: "wan2.2-t2i-flash", label: "万相 2.2 极速版", sub: "Wan · 速度优先" },
  { id: "wanx2.1-t2i-turbo", label: "万相 2.1 极速版", sub: "Wanx" },
  { id: "wanx2.1-t2i-plus", label: "万相 2.1 专业版", sub: "Wanx" },
  { id: "pixflow/gpt-image-2", label: "GPT Image 2", sub: "Pixflow · OpenAI · Image2" },
  { id: "claude360/gpt-image-2", label: "GPT Image 2", sub: "Claude360 · OpenAI · Image2" },
  {
    id: "pixflow/gemini-3-pro-image-preview",
    label: "Gemini 3 Pro Image",
    sub: "Pixflow · Google · 高质量",
  },
  {
    id: "pixflow/gemini-3.1-flash-image-preview",
    label: "Nano Banana 2",
    sub: "Pixflow · Google · 快速",
  },
  {
    id: "pixflow/gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash Image",
    sub: "Pixflow · Google · 通用",
  },
  {
    id: "tokenflash/gpt-image-2",
    label: "GPT Image 2 (Tokenflash)",
    sub: "5积分/张",
  },

  // ---- Revora(OpenAI 兼容)----
  { id: "__sep_revora__", label: "—— Revora(OpenAI 兼容)——", sub: "" },
  {
    id: "revora/gpt-image-2-high",
    label: "GPT Image 2 High (Revora)",
    sub: "高质量",
  },
  {
    id: "revora/gpt-image-2-medium",
    label: "GPT Image 2 Medium (Revora)",
    sub: "均衡",
  },
  {
    id: "revora/gpt-image-2-low",
    label: "GPT Image 2 Low (Revora)",
    sub: "快速",
  },

  // ---- OneToken(OpenAI 兼容)----
  { id: "__sep_onetoken__", label: "—— OneToken(OpenAI 兼容)——", sub: "" },
  {
    id: "onetoken/gpt-image-2",
    label: "GPT Image 2 (OneToken)",
    sub: "OneToken · OpenAI · Image2",
  },

  // ---- AIGC Family(OpenAI 兼容)----
  { id: "__sep_aigcfamily__", label: "—— AIGC Family(OpenAI 兼容)——", sub: "" },
  {
    id: "aigcfamily/gpt-image-2",
    label: "GPT Image 2 (AIGC Family)",
    sub: "仅 T2I",
  },
  {
    id: "aigcfamily/imagen-3.0-generate-001",
    label: "Google imagen3 (AIGC Family)",
    sub: "仅 T2I",
  },

  {
    id: "agentearth/image2",
    label: "GPT Image 2 (AgentEarth)",
    sub: "",
  },
  {
    id: "confluo/gpt-image-2",
    label: "GPT Image 2 (汇流)",
    sub: "",
  },

  {
    id: "azure2/gpt-image-2",
    label: "Azure-gpt-image-2 (终结点)",
    sub: "9积分/张",
  },
  {
    id: "azure0716/gpt-image-2",
    label: "Azure0716-gpt-image-2",
    sub: "9积分/张",
  },
];
// 图下拉只保留指定供应商，避免将未启用渠道展示给用户。
const VISIBLE_IMAGE_PREFIXES = [
  "doubao-seedream/", // 默认主力 Seedream
  "tokenflash/",
  "revora/",
  "azure2/",
  "azure0716/",
  "agentearth/",
  "confluo/",
  "aigcfamily/",
];
const isVisibleImage = (id: string) =>
  VISIBLE_IMAGE_PREFIXES.some((p) => id.toLowerCase().startsWith(p));
// 过滤掉"分隔符"项 + 非可见模型
export const realImageModelOptions = imageModelOptions.filter(
  (m) => !m.id.startsWith("__sep") && isVisibleImage(m.id),
);
void IMAGE_MODELS;
const storyboardModels = realImageModelOptions;
const sceneModels = realImageModelOptions;
// Video models —— 2026/06 接入双后端:火山方舟 Seedance(已开通,默认走 ARK) + 阿里 DashScope HappyHorse(备用)
// 详见 docs/seedream.md (Seedance) 和 docs/qwen.md (HappyHorse)
const videoModels = [
  // ---- AgentEarth (OpenAI-compatible gateway · Seedance 2.0) ----
  {
    id: "earth/seedance-2.0",
    label: "Doubao Seedance 2.0 (AgentEarth)",
    sub: "AgentEarth · 文本/图片/视频/音频生视频 · 4-15 秒",
  },
  {
    id: "earth/seedance-2.0-global",
    label: "Doubao Seedance 2.0 Global (AgentEarth)",
    sub: "AgentEarth · 海外版 · 文本/图片/视频/音频生视频 · 4-15 秒",
  },

  // ---- 主力:Seedance(火山方舟 ARK,多模态·支持参考图/视频/音频)----
  {
    id: "doubao-seedance-2-0-260128",
    label: "Doubao Seedance 2.0",
    sub: "多模态 · 237.6积分/10s",
  },
  {
    id: "doubao-seedance-2-0-fast-260128",
    label: "Doubao Seedance 2.0 Fast",
    sub: "快速版 · 192积分/10s",
  },
  { id: "doubao-seedance-1-0-pro-250528", label: "Doubao Seedance 1.0 Pro", sub: "T2V" },
  {
    id: "doubao-seedance-1-0-lite-i2v-250428",
    label: "Doubao Seedance 1.0 Lite",
    sub: "I2V",
  },

  // ---- SD Real Max（Dreamina Seedance 2.0，需 SD_REAL_MAX_API_KEY）----
  { id: "__video_sep_sdreal__", label: "—— SD Real Max（Dreamina Seedance 2.0）——", sub: "" },
  {
    id: "dreamina-seedance-2-0-fast-hc",
    label: "Dreamina Seedance 2.0 Fast",
    sub: "SD Real Max · 快速版",
  },
  {
    id: "dreamina-seedance-2-0-hc",
    label: "Dreamina Seedance 2.0",
    sub: "SD Real Max · 标准版",
  },
  {
    id: "dreamina-seedance-2-0-mini-hc",
    label: "Dreamina Seedance 2.0 Mini",
    sub: "SD Real Max · 轻量版",
  },

  // ---- 爻核云（Ycore Cloud，需 YCORE_API_KEY）----
  { id: "__video_sep_ycore__", label: "—— 爻核云（Seedance 2.0）——", sub: "" },
  { id: "ycore-seedance-2-0", label: "Seedance 2.0", sub: "爻核云 · 480p/720p/1080p/4k" },
  { id: "ycore-seedance-2-0-fast", label: "Seedance 2.0 Fast", sub: "爻核云 · 480p/720p" },
  { id: "ycore-seedance-2-0-mini", label: "Seedance 2.0 Mini", sub: "爻核云 · 480p/720p" },

  // ---- 内文（c/seedance-2.0，需 NEIWEN_API_KEY）----
  { id: "__video_sep_neiwen__", label: "—— 内文（Seedance 2.0）——", sub: "" },
  {
    id: "neiwen-c-seedance-2-0",
    label: "c/seedance-2.0",
    sub: "内文 · 图片/视频/音频参考 · 4-15 秒",
  },

  // ---- 客易云（Seedance 2.0 官方折扣版，完整模型编码固定 720p）----
  { id: "__video_sep_keyiyun__", label: "—— 客易云（Seedance 2.0）——", sub: "" },
  {
    id: "keyiyun-sd-2-0-fast-discount-720p",
    label: "Seedance 2.0 官方折扣版",
    sub: "客易云 · 快速 · 720p · 文本/图片参考",
  },

  // ---- 即梦 3.0 Pro(火山引擎视觉服务,需 AK/SK)----
  { id: "__video_sep_jimeng__", label: "—— 即梦 3.0 Pro(Volcengine 视觉服务)——", sub: "" },
  { id: "jimeng-3.0-pro", label: "即梦 3.0 Pro (文生视频)", sub: "需配置 JIMENG AK/SK" },
  { id: "jimeng-3.0-pro-i2v", label: "即梦 3.0 Pro (图生视频·首帧)", sub: "需配置 JIMENG AK/SK" },

  // ---- 筷子科技 丽帧(中转火山方舟 Seedance,需 KUAIZI_API_KEY)----
  { id: "__video_sep_kuaizi__", label: "—— 筷子科技 丽帧(中转 Seedance)——", sub: "" },
  {
    id: "kuaizi-lizhen-pro",
    label: "丽帧 Pro (1080p)",
    sub: "多模态 · 110.4-593积分/10s",
  },
  {
    id: "kuaizi-lizhen-fast",
    label: "丽帧 Fast (720p)",
    sub: "快速版 · 89-192积分/10s",
  },
  {
    id: "kuaizi-lizhen-mini",
    label: "丽帧 Mini",
    sub: "轻量版 · 56-120积分/10s",
  },

  // ---- ToAPIs(中转火山方舟 Seedance 2,需 TOAPIS_API_KEY)----
  { id: "__video_sep_toapis__", label: "—— ToAPIs(中转 Seedance 2)——", sub: "" },
  { id: "toapis-seedance-2", label: "Seedance 2 (ToAPIs)", sub: "多模态" },
  {
    id: "toapis-seedance-2-fast",
    label: "Seedance 2 Fast (ToAPIs)",
    sub: "快速版",
  },
  {
    id: "toapis-seedance-2-mini",
    label: "Seedance 2 Mini (ToAPIs)",
    sub: "多模态参考",
  },

  // ---- k99.tw(Sora 风格 API · 视频生成,需 K99_API_KEY)----
  { id: "__video_sep_k99__", label: "—— k99.tw ——", sub: "" },
  { id: "k99-fast-480p", label: "k99 快速 480p", sub: "k99.tw · 快速 · 480p" },
  { id: "k99-pro-1080p", label: "k99 高清 1080p", sub: "k99.tw · 高清 · 1080p" },

  // ---- 数安词源(中转 Seedance,需 SHUANCIYUAN_VIDEO_KEY)----
  { id: "__video_sep_shuci__", label: "—— 数安词源(中转 Seedance)——", sub: "" },
  { id: "shuci-seedance-2-0", label: "Seedance 2.0 (数安词源)", sub: "数安词源 · 1080p · 多模态" },
  {
    id: "shuci-seedance-2-0-fast",
    label: "Seedance 2.0 Fast (数安词源)",
    sub: "数安词源 · 720p · 快速版",
  },
  {
    id: "shuci-seedance-2-0-mini",
    label: "Seedance 2.0 Mini (数安词源)",
    sub: "数安词源 · 720p · 轻量版",
  },

  // ---- vapeur.ai(OpenAI 兼容 · Seedance 2.0,需 VAPEUR_API_KEY)----
  { id: "__video_sep_vapeur__", label: "—— vapeur.ai ——", sub: "" },
  {
    id: "vapeur-doubao-seedance-2-0-260128",
    label: "Seedance 2.0 (vapeur)",
    sub: "vapeur.ai · Seedance 2.0 · 1080p",
  },
  {
    id: "vapeur-doubao-seedance-2-0-fast-260128",
    label: "Seedance 2.0 Fast (vapeur)",
    sub: "vapeur.ai · Seedance 2.0 Fast · 720p",
  },

  // ---- 汇流 Confluo(OpenAI 兼容 · Seedance,需 CONFLUO_API_KEY)----
  { id: "__video_sep_confluo__", label: "—— 汇流 Confluo(中转 Seedance)——", sub: "" },
  {
    id: "confluo-doubao-seedance-2-0-260128",
    label: "Seedance 2.0 (汇流)",
    sub: "多模态",
  },
  {
    id: "confluo-doubao-seedance-2-0-fast-260128",
    label: "Seedance 2.0 Fast (汇流)",
    sub: "快速版",
  },
  {
    id: "confluo-doubao-seedance-2-0-mini-260615",
    label: "Seedance 2.0 Mini (汇流)",
    sub: "轻量版",
  },

  // ---- TopenRouter(中转火山方舟 Seedance,需 TOPENROUTER_API_KEY)----
  { id: "__video_sep_topenrouter__", label: "-- TopenRouter(中转 Seedance)--", sub: "" },
  {
    id: "topenrouter-doubao-seedance-2-0-260128",
    label: "Seedance 2.0 (TopenRouter)",
    sub: "多模态",
  },
  {
    id: "topenrouter-doubao-seedance-2-0-fast-260128",
    label: "Seedance 2.0 Fast (TopenRouter)",
    sub: "快速版",
  },
  {
    id: "topenrouter-doubao-seedance-2-0-mini-260615",
    label: "Seedance 2.0 Mini (TopenRouter)",
    sub: "轻量版",
  },

  // ---- 弘梦(中转 Seedance 2,需 HONGMENG_API_KEY)----
  { id: "__video_sep_hongmeng__", label: "-- 弘梦(中转 Seedance 2)--", sub: "" },
  {
    id: "hongmeng-seedance2-fast",
    label: "Seedance 2 Fast (弘梦)",
    sub: "快速版",
  },
  {
    id: "hongmeng-seedance2-mini",
    label: "Seedance 2 Mini (弘梦)",
    sub: "轻量版",
  },
  {
    id: "hongmeng-seedance2-pro",
    label: "Seedance 2 Pro (弘梦)",
    sub: "多模态",
  },

  // ---- 可灵 Kling AI(快手,需 KLING_API_KEY)----
  { id: "__video_sep_kling__", label: "—— 可灵 Kling AI ——", sub: "" },
  {
    id: "kling-v2-6",
    label: "Kling 2.6",
    sub: "最高画质 · 5/10s · 原生音频",
  },
  {
    id: "kling-v3",
    label: "Kling 3.0",
    sub: "旗舰 · 3-15s · 多镜头",
  },

  // ---- 备用:HappyHorse(阿里 DashScope)----
  { id: "__video_sep__", label: "—— 备用:HappyHorse(DashScope)——", sub: "" },
  { id: "happyhorse-1.0-r2v", label: "HappyHorse 1.0 (参考生视频)", sub: "DashScope · 多参考图" },
  { id: "happyhorse-1.0-i2v", label: "HappyHorse 1.0 (图生视频·首帧)", sub: "DashScope · I2V" },
  { id: "happyhorse-1.0-t2v", label: "HappyHorse 1.0 (文生视频)", sub: "DashScope · T2V" },
];
// 2026/07:视频下拉只保留指定供应商(星标 + 汇流 + ToAPIS + 可灵),
// 其余(即梦/k99/数安词源/vapeur/HappyHorse)不显示。
const VISIBLE_VIDEO_PREFIXES = [
  "earth/",
  "kuaizi-",
  "doubao-seedance-", // 星标
  "confluo-",
  "toapis-",
  "kling-", // 汇流 + ToAPIS + 可灵
  "topenrouter-", // TopenRouter 中转 Seedance
  "hongmeng-", // 弘梦 中转 Seedance 2
  "shuci-", // 数安词源
  "dreamina-seedance-", // SD Real Max
  "keyiyun-", // 客易云 Seedance 2.0 官方折扣版
  "ycore-", // 爻核云 Seedance 2.0
  "neiwen-", // 内文 c/seedance-2.0
];
const isVisibleVideo = (id: string) =>
  VISIBLE_VIDEO_PREFIXES.some((p) => id.toLowerCase().startsWith(p));
// 过滤掉"分隔符"项 + 非可见模型
export const realVideoModels = videoModels.filter(
  (m) => !m.id.startsWith("__video_sep") && isVisibleVideo(m.id),
);

// 视频分辨率档位 -- 仅丽帧 / Doubao Seedance 2.0 系列支持,按模型动态可选。
// ARK Seedance 标准版/Fast:480p、720p;丽帧 pro:480p、720p、1080p;丽帧 fast/mini:480p、720p。
// 其他视频模型不在此列 -> 选择器禁用,resolution 不传走各后端默认。
const VIDEO_RESOLUTIONS: Record<string, string[]> = {
  "earth/seedance-2.0": ["480P", "720P", "1080P"],
  "earth/seedance-2.0-global": ["480P", "720P", "1080P"],
  "doubao-seedance-2-0-260128": ["480P", "720P"],
  "doubao-seedance-2-0-fast-260128": ["480P", "720P"],
  "kuaizi-lizhen-pro": ["480P", "720P", "1080P"],
  "kuaizi-lizhen-fast": ["480P", "720P"],
  "kuaizi-lizhen-mini": ["480P", "720P"],
  "topenrouter-doubao-seedance-2-0-260128": ["480P", "720P"],
  "topenrouter-doubao-seedance-2-0-fast-260128": ["480P", "720P"],
  "hongmeng-seedance2-fast": ["480P", "720P"],
  "hongmeng-seedance2-mini": ["480P", "720P"],
  "hongmeng-seedance2-pro": ["480P", "720P", "1080P"],
  "dreamina-seedance-2-0-fast-hc": ["480P", "720P"],
  "dreamina-seedance-2-0-hc": ["480P", "720P"],
  "dreamina-seedance-2-0-mini-hc": ["480P", "720P"],
  "ycore-seedance-2-0": ["480P", "720P", "1080P"],
  "ycore-seedance-2-0-fast": ["480P", "720P"],
  "ycore-seedance-2-0-mini": ["480P", "720P"],
  "neiwen-c-seedance-2-0": ["480P", "720P", "1080P"],
};
function videoResolutionOptions(videoModel: string | undefined): string[] {
  if (!videoModel) return [];
  return VIDEO_RESOLUTIONS[videoModel] || [];
}

const workflows = [
  { id: "grid", icon: Grid3x3, key: "grid" },
  { id: "seq", icon: GitBranch, key: "seq" },
  { id: "concurrent", icon: Zap, key: "concurrent" },
  { id: "legacy", icon: Video, key: "legacy" },
] as const;

const styles = [
  { id: "3d-cg", label: "3D CG", hot: true, cover: style3dCg },
  { id: "anime-jp", label: "动漫-日韩", hot: true, cover: styleAnimeJp },
  { id: "pixar", label: "3D-皮克斯卡通", cover: stylePixar },
  { id: "realistic", label: "写实-真人", hot: true, cover: styleRealistic },
  { id: "wuxia", label: "武侠水墨", hot: true, cover: styleWuxia },
  { id: "chibi", label: "Q版萌系", cover: styleChibi },
  { id: "shinkai", label: "新海诚风", cover: styleShinkai },
  { id: "healing", label: "治愈手绘", cover: styleHealing },
  { id: "cyberpunk", label: "赛博朋克", hot: true, cover: styleCyberpunk },
  { id: "comic", label: "美漫风", cover: styleComic },
  { id: "pixel", label: "像素艺术", cover: stylePixel },
  { id: "clay", label: "黏土定格", cover: styleClay },
];

// ISO 3166-1 全部国家/地区；借助浏览器的本地化名称避免手工维护翻译表。
const countryCodes =
  `AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW`.split(
    " ",
  );
const countryNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });
const characterNationalities = countryCodes
  .map((code) => countryNames.of(code) ?? code)
  .sort((a, b) => a.localeCompare(b, "zh-CN"));
const orderedCharacterNationalities = [
  "中国",
  ...characterNationalities.filter((country) => country !== "中国"),
];

export type ProjectConfig = {
  aspect: string;
  storyboardModel: string;
  sceneModel: string;
  videoModel: string;
  resolution?: string;
  audio: "on" | "off";
  characterNationality: string;
  workflow: string;
  style: string;
  customCover?: string | null;
  /** 仅在选择「自定义风格」时使用的文字风格描述。 */
  customStyle?: string | null;
};

export function NewProjectDialog({
  trigger,
  open: openProp,
  onOpenChange,
  initial,
  onSaved,
  groupContext,
}: {
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * 从父组件传入的项目当前值。仅在用户还没有保存过个人偏好时作为 fallback；
   * 基础设置所有字段默认优先使用用户上一次成功保存的设置。
   *   - 传了 initial.id = 编辑模式,confirm 时 upsert 同 id,不 navigate
   */
  initial?: Partial<ProjectConfig> & { id?: string };
  /** 编辑模式保存成功后的回调(父组件可刷新 project state) */
  onSaved?: (saved: ProjectConfig & { id: string }) => void;
  /** 团队分组上下文:传入时新建项目归属该组(team_id + group_id),标题显示组名 */
  groupContext?: { teamId: string; groupId: string; groupName: string };
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id;
  const saveProject = useServerFn(upsertProject);
  const [openInner, setOpenInner] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? !!openProp : openInner;
  const setOpen = (v: boolean) => {
    if (!isControlled) setOpenInner(v);
    onOpenChange?.(v);
  };

  // 每个用户的最近一次「成功保存」设置。没有历史时才回退到当前项目或硬编码默认。
  const initialPrefs = useMemo(() => loadUserPrefs(userId), [userId]);
  const pickScene = () => {
    const candidates = [
      initialPrefs.lastSceneModel,
      initialPrefs.lastStoryboardModel,
      initialPrefs.lastImageModel,
      initial?.sceneModel,
      initial?.storyboardModel,
      "doubao-seedream-5-0-260128",
    ];
    for (const c of candidates) {
      if (c && isVisibleImage(c)) return c;
    }
    return realImageModelOptions[0]?.id ?? "doubao-seedream-5-0-260128";
  };
  const pickVideo = () => {
    const candidates = [
      initialPrefs.lastVideoModel,
      initial?.videoModel,
      "doubao-seedance-2-0-260128",
    ];
    for (const c of candidates) {
      if (c && isVisibleVideo(c)) return c;
    }
    return realVideoModels[0]?.id ?? "doubao-seedance-2-0-260128";
  };
  const pickStoryboard = () => {
    const candidates = [
      initialPrefs.lastStoryboardModel,
      initialPrefs.lastSceneModel,
      initialPrefs.lastImageModel,
      initial?.storyboardModel,
      initial?.sceneModel,
      "doubao-seedream-5-0-260128",
    ];
    for (const c of candidates) {
      if (c && isVisibleImage(c)) return c;
    }
    return realImageModelOptions[0]?.id ?? "doubao-seedream-5-0-260128";
  };
  const pickAspect = () => {
    const candidates = [initialPrefs.lastAspect, initial?.aspect, "16:9"];
    return candidates.find((candidate) => aspects.some((aspect) => aspect.id === candidate))!;
  };
  const pickNationality = () => {
    const candidates = [
      initialPrefs.lastCharacterNationality,
      initial?.characterNationality,
      "中国",
    ];
    return candidates.find((candidate) => orderedCharacterNationalities.includes(candidate!))!;
  };
  const pickWorkflow = () => {
    const candidates = [initialPrefs.lastWorkflow, initial?.workflow, "grid"];
    return candidates.find((candidate) => workflows.some((workflow) => workflow.id === candidate))!;
  };
  const pickStyle = () => {
    const candidates = [initialPrefs.lastStyle, initial?.style, "3d-cg"];
    return candidates.find(
      (candidate) => candidate === "custom" || styles.some((style) => style.id === candidate),
    )!;
  };
  const [aspect, setAspect] = useState(pickAspect);
  const [customCover] = useState<string | null>(() => initial?.customCover ?? null);
  const [customStyle, setCustomStyle] = useState(
    () => initialPrefs.lastCustomStyle ?? initial?.customStyle ?? "",
  );
  // 2026 重构:默认全走火山方舟 Seedream(图像) + 阿里 HappyHorse(视频,实测可用)
  const [storyboardModel, setStoryboardModel] = useState(pickStoryboard);
  // Seedream 统一支持 T2I + I2I,没有 qwen-image-2.0-pro 那样的"I2I-only"坑
  const [sceneModel, setSceneModel] = useState(pickScene);
  // 2026/06:视频默认走火山方舟 Seedance 2.0 —— ARK 账户已开通,cURL 已验证
  // generateVideo 自动按 model id 路由到 ARK,分镜流程点"生成整组视频"直接走火山引擎
  const [videoModel, setVideoModel] = useState(pickVideo);
  // 视频输出分辨率(480P/720P/1080P) -- 仅丽帧 / Seedance 2.0 系列可选,默认 720P
  const [resolution, setResolution] = useState(
    () => initialPrefs.lastResolution ?? initial?.resolution ?? "720P",
  );
  const [audio, setAudio] = useState<"on" | "off">(
    () => initialPrefs.lastAudio ?? initial?.audio ?? "on",
  );
  const [characterNationality, setCharacterNationality] = useState(pickNationality);
  const [workflow, setWorkflow] = useState(pickWorkflow);
  const [style, setStyle] = useState(pickStyle);

  // 弹窗本身常在页面首屏就挂载，此时认证信息可能尚未恢复。每次打开后再读取
  // 偏好，既能避开这个 race，也让用户每次都看到最近一次成功保存的完整配置。
  const initializedForOpenRef = useRef(false);
  // 切换视频模型时,若当前 resolution 不在新模型支持的档位内,回落到 720P。
  // 避免存了 1080P 后切到 fast/mini 触发后端"不支持该分辨率"报错。
  useEffect(() => {
    const allowed = videoResolutionOptions(videoModel);
    if (allowed.length > 0 && !allowed.includes(resolution)) {
      setResolution("720P");
    }
  }, [videoModel, resolution]);
  useEffect(() => {
    if (!open) {
      initializedForOpenRef.current = false;
      return;
    }
    if (authLoading || initializedForOpenRef.current) return;
    initializedForOpenRef.current = true;
    const prefs = loadUserPrefs(userId);
    const chooseImage = (...candidates: Array<string | undefined>) =>
      candidates.find((candidate) => candidate && isVisibleImage(candidate)) ??
      realImageModelOptions[0]?.id ??
      "doubao-seedream-5-0-260128";
    const chooseVideo = (...candidates: Array<string | undefined>) =>
      candidates.find((candidate) => candidate && isVisibleVideo(candidate)) ??
      realVideoModels[0]?.id ??
      "doubao-seedance-2-0-260128";
    setAspect(
      [prefs.lastAspect, initial?.aspect, "16:9"].find((value) =>
        aspects.some((item) => item.id === value),
      )!,
    );
    setStoryboardModel(
      chooseImage(
        prefs.lastStoryboardModel,
        prefs.lastSceneModel,
        prefs.lastImageModel,
        initial?.storyboardModel,
        initial?.sceneModel,
      ),
    );
    setSceneModel(
      chooseImage(
        prefs.lastSceneModel,
        prefs.lastStoryboardModel,
        prefs.lastImageModel,
        initial?.sceneModel,
        initial?.storyboardModel,
      ),
    );
    setVideoModel(chooseVideo(prefs.lastVideoModel, initial?.videoModel));
    setResolution(prefs.lastResolution ?? initial?.resolution ?? "720P");
    setAudio(prefs.lastAudio ?? initial?.audio ?? "on");
    setCharacterNationality(
      [prefs.lastCharacterNationality, initial?.characterNationality, "中国"].find((value) =>
        orderedCharacterNationalities.includes(value!),
      )!,
    );
    setWorkflow(
      [prefs.lastWorkflow, initial?.workflow, "grid"].find((value) =>
        workflows.some((item) => item.id === value),
      )!,
    );
    setStyle(
      [prefs.lastStyle, initial?.style, "3d-cg"].find(
        (value) => value === "custom" || styles.some((item) => item.id === value),
      )!,
    );
    setCustomStyle(prefs.lastCustomStyle ?? initial?.customStyle ?? "");
  }, [authLoading, initial, open, userId]);

  const estimate = aspects.find((a) => a.id === aspect)?.cost ?? 11;
  // 分辨率档位标签(480P/720P/1080P -> i18n) + 当前模型可选档位
  const resolutionLabel = (r: string) =>
    r === "480P"
      ? t.np_resolution_480p
      : r === "1080P"
        ? t.np_resolution_1080p
        : t.np_resolution_720p;
  const resolutionOptions = videoResolutionOptions(videoModel);

  // ====================================================================
  // 个性化模型选择 UX
  //   - 推荐项(命中下方 IMAGE/VIDEO_RECOMMENDED_PREFIXES)排最前,带 ✨ _recommended
  //     · 图片推荐:tokenflash / revora / Azure终结点
  //     · 视频推荐:丽帧(kuaizi)/ doubao-seedance / TopenRouter
  //   - "用户上次选的"(lastUsed)带 _pinned 标记(🕐);若不在推荐区,排到推荐区之后
  //   - 非法 id(用户 pref 里残留但当前 catalog 没了)静默忽略
  // ====================================================================
  type ModelOption = {
    id: string;
    label: string;
    sub?: string;
    _pinned?: boolean;
    _recommended?: boolean;
  };
  // 推荐名单:匹配这些前缀的模型排最前 + 带 ✨
  const IMAGE_RECOMMENDED_PREFIXES = ["tokenflash/", "revora/", "azure2/", "azure0716/"];
  const VIDEO_RECOMMENDED_PREFIXES = ["kuaizi-", "doubao-seedance-", "topenrouter-"];
  const isRecommendedModel = (id: string, prefixes: string[]): boolean =>
    prefixes.some((p) => id.startsWith(p));
  /**
   * 重排模型列表:
   *   1) 推荐项(命中 recommendedPrefixes)排最前,按 prefixes 顺序,带 _recommended
   *   2) 非推荐项保持原顺序在后
   *   3) lastUsed(最近使用)带 _pinned 标记;若它不在推荐区,排到推荐区之后(非推荐区最前)
   *   4) 不在合法 catalog 里的 lastUsed 静默忽略
   */
  function reorderModels<T extends { id: string; label: string; sub?: string }>(
    catalog: T[],
    lastUsedId: string | undefined,
    recommendedPrefixes: string[],
  ): ModelOption[] {
    const base: ModelOption[] = catalog.map((m) => ({
      ...m,
      _recommended: isRecommendedModel(m.id, recommendedPrefixes),
    }));
    // 推荐区:按 recommendedPrefixes 顺序收集(去重)
    const recommended: ModelOption[] = [];
    const seen = new Set<string>();
    for (const prefix of recommendedPrefixes) {
      for (const m of base) {
        if (m.id.startsWith(prefix) && !seen.has(m.id)) {
          recommended.push(m);
          seen.add(m.id);
        }
      }
    }
    const nonRecommended = base.filter((m) => !m._recommended);
    // lastUsed(_pinned):标记最近使用;非推荐项提到推荐区之后,推荐项保持位置
    if (lastUsedId) {
      const pinned = [...recommended, ...nonRecommended].find((m) => m.id === lastUsedId);
      if (pinned) {
        pinned._pinned = true;
        if (!pinned._recommended) {
          const i = nonRecommended.indexOf(pinned);
          if (i !== -1) nonRecommended.splice(i, 1);
          return [...recommended, pinned, ...nonRecommended];
        }
      }
    }
    return [...recommended, ...nonRecommended];
  }

  // 每次 render 都按"当前 storyboardModel/sceneModel/videoModel"
  // 倒推出"上次用的"用于 _pinned 标记 —— 也就是用户当前正在看 / 改的值就视为最近使用。
  const orderedStoryboardModels = useMemo(
    () => reorderModels(storyboardModels, storyboardModel, IMAGE_RECOMMENDED_PREFIXES),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storyboardModel],
  );
  const orderedSceneModels = useMemo(
    () => reorderModels(sceneModels, sceneModel, IMAGE_RECOMMENDED_PREFIXES),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sceneModel],
  );
  const orderedVideoModels = useMemo(
    () => reorderModels(realVideoModels, videoModel, VIDEO_RECOMMENDED_PREFIXES),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [videoModel],
  );

  async function confirm() {
    // 2026/06:编辑现有项目(initial.id 存在)时,upsert 同 id,不 navigate;
    // 新建项目时,生成新 id 并跳转到新 workspace。
    const isEdit = !!initial?.id;
    const id = initial?.id ?? `ws-${Date.now().toString(36)}`;
    if (authLoading) {
      toast.message("正在恢复登录状态，请稍后重试");
      return;
    }
    if (!user) {
      toast.error("请先登录后再保存项目配置");
      return;
    }
    try {
      const res = await saveProject({
        data: {
          id,
          aspect,
          storyboardModel,
          sceneModel,
          videoModel,
          resolution,
          audio,
          characterNationality,
          workflow,
          style,
          customCover: customCover ?? null,
          customStyle: style === "custom" ? customStyle.trim() || null : null,
          ...(groupContext && {
            teamId: groupContext.teamId,
            groupId: groupContext.groupId,
          }),
        },
      });
      if (!res.ok) {
        toast.error("保存项目配置失败: " + res.error);
        return;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(`保存项目配置失败${message ? `: ${message}` : "，请稍后重试"}`);
      return;
    }
    // 只在服务端持久化成功后更新默认值；取消弹窗、保存失败或仅试选都不会影响
    // 用户下次打开「基础设置」时看到的选择。
    saveUserPrefs(userId, {
      lastAspect: aspect,
      lastStoryboardModel: storyboardModel,
      lastSceneModel: sceneModel,
      lastImageModel: sceneModel,
      lastVideoModel: videoModel,
      lastResolution: resolution,
      lastAudio: audio,
      lastCharacterNationality: characterNationality,
      lastWorkflow: workflow,
      lastStyle: style,
      lastCustomStyle: customStyle,
    });
    if (isEdit) {
      // 编辑模式:仅关闭弹窗,把保存后的结果回传给父组件(刷新 project state)。
      onSaved?.({
        id,
        aspect,
        storyboardModel,
        sceneModel,
        videoModel,
        resolution,
        audio,
        characterNationality,
        workflow,
        style,
        customCover: customCover ?? null,
        customStyle: style === "custom" ? customStyle.trim() || null : null,
      });
      setOpen(false);
      return;
    }
    setOpen(false);
    navigate({ to: "/workspace/$workspaceId", params: { workspaceId: id } });
  }

  const wfLabel: Record<string, string> = {
    grid: t.np_workflow_grid,
    seq: t.np_workflow_seq,
    concurrent: t.np_workflow_concurrent,
    legacy: t.np_workflow_legacy,
  };
  const wfDesc: Record<string, string> = {
    grid: t.np_workflow_grid_desc,
    seq: t.np_workflow_seq_desc,
    concurrent: t.np_workflow_concurrent_desc,
    legacy: t.np_workflow_legacy_desc,
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-bg-surface border-border">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <h2 className="font-display text-xl font-bold">
            {groupContext ? `${t.team_groups_new_project} · ${groupContext.groupName}` : t.np_title}
          </h2>
          <div className="text-xs text-text-muted">
            {t.np_estimate_prefix} <span className="text-accent font-semibold">✦ {estimate}</span>
            {t.np_estimate_suffix}
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-4 pt-4">
          <FieldSelect
            label={t.np_aspect}
            hint={t.np_aspect_hint}
            value={aspect}
            onChange={setAspect}
            options={aspects.map((a) => ({ id: a.id, label: a.label }))}
          />
          <FieldSelect
            label={t.np_resolution}
            hint={resolutionOptions.length > 0 ? t.np_resolution_hint : t.np_resolution_unsupported}
            value={
              resolutionOptions.length > 0
                ? resolutionOptions.includes(resolution)
                  ? resolution
                  : "720P"
                : "default"
            }
            onChange={setResolution}
            options={
              resolutionOptions.length > 0
                ? resolutionOptions.map((r) => ({ id: r, label: resolutionLabel(r) }))
                : [{ id: "default", label: "720p" }]
            }
            disabled={resolutionOptions.length === 0}
          />
          <FieldSelect
            label={t.np_storyboard_model}
            hint={t.np_storyboard_model_hint}
            value={storyboardModel}
            onChange={setStoryboardModel}
            options={orderedStoryboardModels as any}
            pinnedLabel={t.np_model_recently_used}
            recommendedLabel={t.np_model_recommended}
          />
          <FieldSelect
            label={t.np_scene_model}
            hint={t.np_scene_model_hint}
            value={sceneModel}
            onChange={setSceneModel}
            options={orderedSceneModels as any}
            pinnedLabel={t.np_model_recently_used}
            recommendedLabel={t.np_model_recommended}
          />
        </div>

        <div className="grid md:grid-cols-[minmax(0,1.35fr)_180px_minmax(0,1fr)] gap-4 pt-3">
          <FieldSelect
            label={t.np_video_model}
            hintClassName="min-h-5"
            value={videoModel}
            onChange={setVideoModel}
            options={orderedVideoModels as any}
            pinnedLabel={t.np_model_recently_used}
            recommendedLabel={t.np_model_recommended}
          />
          <div className="w-full">
            <div className="text-sm font-semibold">{t.np_audio}</div>
            <div className="min-h-5 mb-1" aria-hidden="true" />
            <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2 flex items-center justify-between">
              <span className="text-sm">{audio === "on" ? t.np_audio_on : t.np_audio_off}</span>
              <div className="flex gap-1">
                {(["on", "off"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setAudio(m)}
                    className={`px-2 py-0.5 text-xs rounded-full border ${audio === m ? "bg-accent text-accent-foreground border-accent" : "border-border text-text-muted hover:text-text-primary"}`}
                  >
                    {m === "on" ? t.np_audio_on : t.np_audio_off}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <FieldSelect
            label={t.np_character_nationality}
            hintClassName="min-h-5"
            value={characterNationality}
            onChange={setCharacterNationality}
            options={orderedCharacterNationalities.map((nationality) => ({
              id: nationality,
              label: nationality,
            }))}
          />
        </div>

        <div className="pt-4">
          <div className="text-sm font-semibold mb-2">{t.np_workflow}</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {workflows.map((w) => {
              const Icon = w.icon;
              const active = workflow === w.id;
              return (
                <button
                  key={w.id}
                  onClick={() => setWorkflow(w.id)}
                  className={`text-left rounded-xl border p-3 flex gap-3 transition ${active ? "border-accent bg-accent-dim/30 shadow-glow" : "border-border bg-bg-elevated hover:border-border-glow"}`}
                >
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-accent text-accent-foreground" : "bg-bg-surface text-text-muted"}`}
                  >
                    <Icon size={18} />
                  </div>
                  <div>
                    <div className={`font-semibold text-sm ${active ? "text-accent" : ""}`}>
                      {wfLabel[w.id]}
                    </div>
                    <div className="text-xs text-text-muted leading-snug mt-0.5">
                      {wfDesc[w.id]}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-4">
          <div className="text-sm font-semibold mb-2">{t.np_style}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {styles.map((s) => {
              const active = style === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setStyle(s.id)}
                  className={`relative rounded-xl overflow-hidden border-2 text-left bg-bg-elevated transition group ${active ? "border-accent shadow-glow" : "border-transparent hover:border-border"}`}
                >
                  <div className="aspect-square overflow-hidden">
                    <img
                      src={s.cover}
                      alt={s.label}
                      loading="lazy"
                      width={512}
                      height={512}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                  {s.hot && (
                    <span className="absolute top-1.5 right-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-rose-500/90 text-white text-[10px]">
                      <Flame size={10} /> {t.np_style_hot}
                    </span>
                  )}
                  <div
                    className={`px-2 py-1.5 text-xs ${active ? "text-accent font-semibold" : "text-text-secondary"}`}
                  >
                    {s.label}
                  </div>
                  {active && (
                    <Check
                      className="absolute top-1.5 left-1.5 text-accent bg-bg-surface rounded-full p-0.5"
                      size={18}
                    />
                  )}
                </button>
              );
            })}
            <div
              onClick={() => setStyle("custom")}
              className={`col-span-2 sm:col-span-4 flex cursor-text items-center gap-2 rounded-xl border-2 bg-bg-elevated px-3 py-2 transition ${style === "custom" ? "border-accent shadow-glow" : "border-dashed border-border hover:border-accent/60"}`}
            >
              <Sparkles
                size={15}
                className={style === "custom" ? "text-accent" : "text-text-muted"}
              />
              <input
                value={customStyle}
                onFocus={() => setStyle("custom")}
                onChange={(e) => {
                  setStyle("custom");
                  setCustomStyle(e.target.value);
                }}
                maxLength={2000}
                placeholder="自定义风格，例如：水墨武侠、留白构图、青灰配色"
                className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
              />
              {style === "custom" && <Check className="shrink-0 text-accent" size={16} />}
            </div>
          </div>
        </div>

        <div className="flex justify-center pt-5">
          <button
            onClick={confirm}
            className="px-10 py-2.5 rounded-full bg-accent text-accent-foreground font-semibold hover:opacity-90 inline-flex items-center gap-2"
          >
            <Check size={16} /> {t.np_confirm}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="ml-2 px-4 py-2.5 rounded-full text-text-muted hover:text-text-primary inline-flex items-center gap-1"
          >
            <X size={14} /> {t.np_cancel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FieldSelect({
  label,
  hint,
  value,
  onChange,
  options,
  pinnedLabel,
  recommendedLabel,
  disabled,
  hintClassName,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string; sub?: string; _pinned?: boolean; _recommended?: boolean }[];
  pinnedLabel?: string;
  recommendedLabel?: string;
  disabled?: boolean;
  /** 需要紧凑布局的字段可缩短空说明区，仍保持同一行输入框对齐。 */
  hintClassName?: string;
}) {
  return (
    <div>
      <div className="text-sm font-semibold">{label}</div>
      <div className={`${hintClassName ?? "min-h-[2.75rem]"} mb-1 text-[11px] text-text-muted`}>
        {hint}
      </div>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`w-full appearance-none bg-bg-elevated border border-border rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-accent ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {options.map((o) => {
            // 原生 <option> 不支持复杂 markup,只能拼文本,但可以用
            // 前缀字符 (🕐 / ✨) 让用户在浏览器下拉里直观看到标记。
            // _pinned 优先于 _recommended —— 同一项是"最近使用 + 推荐"时只显示一个。
            const prefix = o._pinned ? "🕐 " : o._recommended ? "✨ " : "";
            return (
              <option key={o.id} value={o.id}>
                {prefix}
                {o.label}
                {o.sub ? ` — ${o.sub}` : ""}
              </option>
            );
          })}
        </select>
        {/* select 右侧的图标:被置顶的项显示"最近使用"提示(仅图标,label 走 title 悬浮),推荐的项显示 sparkle */}
        {options.find((o) => o.id === value)?._pinned ? (
          <span
            title={pinnedLabel}
            aria-label={pinnedLabel}
            className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 text-[10px] text-amber-400 pointer-events-none"
          >
            <Clock size={11} />
          </span>
        ) : options.find((o) => o.id === value)?._recommended ? (
          <span
            title={recommendedLabel}
            aria-label={recommendedLabel}
            className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 text-[10px] text-accent pointer-events-none"
          >
            <Sparkles size={11} />
            <span className="hidden lg:inline">{recommendedLabel}</span>
          </span>
        ) : (
          <Sparkles
            size={12}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
          />
        )}
      </div>
    </div>
  );
}
