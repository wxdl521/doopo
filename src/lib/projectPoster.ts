// ====================================================================
// projectPoster —— 项目剧照(海报)自动生成:决策逻辑 + prompt 构建
//
// 背景(2026/08 需求):项目卡片缩略图用一张"剧照"——主角图 + 场景图融合的
// 横版海报;剧照未生成时封面默认用主角照片(不再是随机第一张角色图)。
//
// 本模块是纯函数,不依赖 React / server fn,决策逻辑可单测;
// 执行侧(调生图、入库、写 custom_cover)在 workspace 路由里。
// ====================================================================

import type { GenCharacter, GenScene } from "../data/workspaceGenerators";

/** 失败最多自动重试次数(内容审核拦截等永久失败不能每次保存都重试烧钱)。 */
export const MAX_POSTER_ATTEMPTS = 2;
/** 16:9 横版;像素 3,686,400 正好满足 Seedream 2K 下限(参照 4096x1280 先例)。 */
export const POSTER_SIZE = "2560x1440";

const MAX_LEAD_REFS = 4;
const MAX_SCENE_REFS = 3;

/** 剧照生成状态,持久化在 workspace_data.posterImage。 */
export type PosterState = {
  url: string | null;
  status: "running" | "succeeded" | "failed";
  attempts: number;
};

export type PosterAction =
  | {
      type: "generate";
      references: string[];
      leadNames: string[];
      sceneLocations: string[];
    }
  /** source: poster=剧照本身; lead=主角照片回退; fallback=分镜/故事板旧兜底 */
  | { type: "setCover"; url: string; source: "poster" | "lead" | "fallback" }
  | { type: "none" };

type ImageMaps = {
  images: Record<string, string[]>;
  pinned?: Record<string, string | null>;
};

function isHttpUrl(u: unknown): u is string {
  return typeof u === "string" && /^https?:\/\//.test(u);
}

/**
 * 判断两个图片 URL 是否指向同一对象(忽略 query)。
 * 私有 bucket 签名 URL 每次读取都会重签,query 里的签名/过期时间必然变化,
 * 直接全串比较会把"同一张图"误判成不同,导致每次加载都重复回写封面。
 */
export function sameImageUrl(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const strip = (u: string) => u.split(/[?#]/)[0];
  return strip(a) === strip(b);
}

/** 取某个 key 的展示图:用户钉选优先,否则最新一张;跳过 data: 临时值。 */
function pickLatestImage(key: string, maps: ImageMaps): string | null {
  const pinned = maps.pinned?.[key];
  if (isHttpUrl(pinned)) return pinned;
  const arr = maps.images[key];
  if (!Array.isArray(arr)) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (isHttpUrl(arr[i])) return arr[i]!;
  }
  return null;
}

/** 角色图 key 兼容 imageKey 形式:`${charId}` 或遗留的 `${charId}::${lookId}`。 */
function pickCharImageUrl(charId: string, maps: ImageMaps): string | null {
  const exact = pickLatestImage(charId, maps);
  if (exact) return exact;
  for (const key of Object.keys(maps.images)) {
    if (!key.startsWith(`${charId}::`)) continue;
    const url = pickLatestImage(key, maps);
    if (url) return url;
  }
  return null;
}

/** 主角优先的角色排序:lead 在前,其余保持原顺序。 */
function leadFirst(characters: GenCharacter[]): GenCharacter[] {
  const leads = characters.filter((c) => c.role === "lead");
  return leads.length > 0 ? [...leads, ...characters.filter((c) => c.role !== "lead")] : characters;
}

/** 主角照片:第一个 lead 角色的展示图;无 lead 时退回第一张可用角色图。 */
export function pickLeadImageUrl(input: {
  characters: GenCharacter[];
  charImages: Record<string, string[]>;
  selectedCharImages?: Record<string, string | null>;
}): string | null {
  const maps: ImageMaps = { images: input.charImages, pinned: input.selectedCharImages };
  for (const c of leadFirst(input.characters)) {
    const url = pickCharImageUrl(c.id, maps);
    if (url) return url;
  }
  return null;
}

/** 收集剧照融合参考图:主角图(≤4) + 场景图(≤3),顺序即 prompt 里的图序号。 */
export function collectPosterReferences(input: {
  characters: GenCharacter[];
  charImages: Record<string, string[]>;
  selectedCharImages?: Record<string, string | null>;
  scenes: GenScene[];
  sceneImages: Record<string, string[]>;
  selectedSceneImages?: Record<string, string | null>;
}): { references: string[]; leadNames: string[]; sceneLocations: string[] } {
  const references: string[] = [];
  const leadNames: string[] = [];
  const charMaps: ImageMaps = { images: input.charImages, pinned: input.selectedCharImages };
  for (const c of leadFirst(input.characters)) {
    if (leadNames.length >= MAX_LEAD_REFS) break;
    const url = pickCharImageUrl(c.id, charMaps);
    if (url) {
      references.push(url);
      leadNames.push(c.name);
    }
  }
  const sceneLocations: string[] = [];
  const sceneMaps: ImageMaps = { images: input.sceneImages, pinned: input.selectedSceneImages };
  for (const s of input.scenes) {
    if (sceneLocations.length >= MAX_SCENE_REFS) break;
    const url = pickLatestImage(s.id, sceneMaps);
    if (url) {
      references.push(url);
      sceneLocations.push(s.location);
    }
  }
  return { references, leadNames, sceneLocations };
}

/**
 * 决策:生成剧照 / 写封面 / 不动。
 *
 * 规则:
 *  1. 剧照已生成 → 用剧照做封面(只替换我们自己写的自动封面,不覆盖导入项目自带封面);
 *  2. 主角图+场景图都就绪且未超重试上限 → generate;
 *  3. 其余 → 回退封面:主角照片 → legacyFallback(分镜图/故事板图旧链);
 *  4. 封面归属判断:无封面 / 封面===autoCoverUrl(忽略签名 query) / 老项目
 *     (autoCoverUrl 与 poster 都未记录,封面视为当初自动挑的) → 允许写;
 *     否则(导入项目自带封面) → 一律 none。
 *  URL 比较一律走 sameImageUrl,签名 URL 重签不会造成重复回写。
 */
export function decidePosterAction(input: {
  poster?: PosterState | null;
  characters: GenCharacter[];
  charImages: Record<string, string[]>;
  selectedCharImages?: Record<string, string | null>;
  scenes: GenScene[];
  sceneImages: Record<string, string[]>;
  selectedSceneImages?: Record<string, string | null>;
  currentCover: string | null;
  autoCoverUrl?: string | null;
  legacyFallbackUrl?: string | null;
}): PosterAction {
  const coverIsOurs =
    !input.currentCover ||
    sameImageUrl(input.currentCover, input.autoCoverUrl) ||
    (input.autoCoverUrl == null && input.poster == null);

  // 1) 剧照已生成
  if (input.poster?.status === "succeeded" && isHttpUrl(input.poster.url)) {
    if (coverIsOurs && !sameImageUrl(input.currentCover, input.poster.url)) {
      return { type: "setCover", url: input.poster.url, source: "poster" };
    }
    return { type: "none" };
  }

  // 2) 素材就绪 → 生成(running 防重由执行侧 ref 兜底,这里也不重复发)
  const refs = collectPosterReferences(input);
  if (
    refs.leadNames.length > 0 &&
    refs.sceneLocations.length > 0 &&
    input.poster?.status !== "running" &&
    (input.poster?.attempts ?? 0) < MAX_POSTER_ATTEMPTS
  ) {
    return { type: "generate", ...refs };
  }

  // 3) 回退:主角照片 → legacy 兜底(只在封面空缺或封面是我们写的时才动)
  if (coverIsOurs) {
    const leadUrl = pickLeadImageUrl(input);
    if (leadUrl) {
      if (!sameImageUrl(input.currentCover, leadUrl)) {
        return { type: "setCover", url: leadUrl, source: "lead" };
      }
      return { type: "none" };
    }
    const legacy = input.legacyFallbackUrl;
    if (isHttpUrl(legacy) && !sameImageUrl(input.currentCover, legacy)) {
      return { type: "setCover", url: legacy, source: "fallback" };
    }
  }
  return { type: "none" };
}

/** 剧照融合 prompt:中文结构化指令,风格仿 buildShotInstruction。 */
export function buildPosterPrompt(input: {
  leadNames: string[];
  sceneLocations: string[];
  style?: string | null;
}): string {
  const charLines = input.leadNames.map((n, i) => `图${i + 1}=「${n}」(角色参考)`);
  const sceneLines = input.sceneLocations.map(
    (loc, i) => `图${input.leadNames.length + i + 1}=「${loc}」(场景参考)`,
  );
  return [
    "[任务] 生成一张电视剧横版剧照(剧集海报主视觉),16:9 宽幅电影构图。",
    "",
    "[参考图清单]",
    ...charLines,
    ...sceneLines,
    "",
    "[画面要求]",
    `- ${input.leadNames.join("、")} 同时出镜,置身于场景之中,人物为画面主体,站位有层次;`,
    "- 角色的脸部特征、发型、服装必须与角色参考图完全一致,不得换脸;",
    "- 场景的空间结构、色调、光线氛围与场景参考图一致;",
    "- 电影感打光,浅景深,剧照级质感,人物表情自然、有戏剧张力;",
    ...(input.style ? [`- 整体美术风格:${input.style}。`] : []),
    "",
    "[禁止] 不要任何文字、字幕、logo、水印;不要 Q 版/卡通化;不要改变角色长相与服装。",
  ].join("\n");
}
