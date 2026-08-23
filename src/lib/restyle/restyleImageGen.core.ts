// ====================================================================
//  转绘 v2 阶段 B（第二步）· 造型化生图 + 换装区间 + 音色方案（核心）
//
//  四个编排入口：
//    1. planCharacterLooksCore   导演模型按角色+场景+时间线推导换装区间
//       （wardrobe-continuity skill），写 restyle_character_looks +
//       产物 stage="image_gen" node="looks"（确认关卡）。
//    2. planImagePromptsCore     looks 确认后，确定性组装「主图 + 三视图 +
//       逐 look 主图/正/背/侧」提示词列表，产物 node="prompts"
//       （提示词确认关卡：用户确认/修改后才允许真实生图）。
//    3. generateCharacterImagesCore  双闸门（asset_mapping + prompts 均
//       user_approved）过后才可调；逐张 ensureEnoughCredits → 生图 →
//       成功按张 chargeCredits（幂等键 img:{projectId}:{characterId}:
//       {lookId}:{scopeHash}），失败写 generation_error_logs 不中断整批。
//    4. planVoiceProfilesCore    按分镜数/分组数排角色重要度，导演模型产出
//       音色方案写 restyle_characters.voice_profile + 产物
//       stage="voice_plan"（确认关卡）；generateVoiceReferenceVideoCore
//       仅放行重点角色，调现有视频通道（默认视频模型，图生视频+出声）。
//
//  纯函数部分（normalizeLookPlan / buildXxxPrompt / rankCharacterImportance /
//  imageIdempotencyKey）不依赖 supabase，可单测；副作用全部走 deps 注入。
// ====================================================================

import { z } from "zod";
import { ensureEnoughCredits } from "../creditsGuard";
import { imageCost, videoCost } from "../creditsCost";
import { logGenerationError } from "../errorLogs.server";
import { resignMediaDeep } from "../mediaResign.server";
import {
  callLovableChat,
  INTERNAL_DIRECTOR_FALLBACK_MODEL,
  INTERNAL_DIRECTOR_MODEL,
  type ChatMessage,
  type GatewayChatResult,
} from "./lovableGateway";
import { composePrompt } from "./skills";
import { extractJson } from "./restyleVideoAnalysis.functions";
import {
  computeScopeHash,
  createInitialArtifact,
  transitionArtifact,
  type ArtifactState,
  type JsonValue,
} from "./artifactState";

type SupabaseContext = { supabase: any; userId: string };

// --------------------------------------------------------------------
// 常量与 zod 输入
// --------------------------------------------------------------------

export const IMAGE_GEN_STAGE = "image_gen";
export const LOOKS_NODE_KEY = "looks";
export const PROMPTS_NODE_KEY = "prompts";
export const VOICE_PLAN_STAGE = "voice_plan";
export const VOICE_NODE_KEY = "project";

const LOOKS_CREDIT_COST = 1;
const VOICE_PLAN_CREDIT_COST = 1;

/** 现有默认图像模型（seedream.functions.ts 的 DEFAULT_MODEL）。 */
export const RESTYLE_IMAGE_MODEL = "doubao-seedream-5-0-260128";
/** 现有默认视频模型（videoGenerate.functions.ts 的 ARK_DEFAULT_MODEL）。 */
export const RESTYLE_VIDEO_MODEL = "doubao-seedance-2-0-260128";
export const VOICE_REFERENCE_DURATION_SEC = 5;
export const VOICE_REFERENCE_RESOLUTION = "720P";

/** 分镜数达到该值即判为重点角色（竞品音色方案的口径）。 */
export const MAJOR_SHOT_THRESHOLD = 10;

export const PlanLooksInputSchema = z.object({
  projectId: z.string().min(1).max(128),
});

export const PlanPromptsInputSchema = z.object({
  projectId: z.string().min(1).max(128),
});

export const GenerateImagesInputSchema = z.object({
  projectId: z.string().min(1).max(128),
  characterIds: z.array(z.string().min(1).max(128)).max(100).optional(),
});

export const EstimateImagesInputSchema = GenerateImagesInputSchema;

export const PlanVoiceInputSchema = z.object({
  projectId: z.string().min(1).max(128),
});

export const GenerateVoiceVideoInputSchema = z.object({
  projectId: z.string().min(1).max(128),
  characterIds: z.array(z.string().min(1).max(128)).min(1).max(20),
});

export const ConfirmArtifactInputSchema = z.object({
  projectId: z.string().min(1).max(128),
  userContent: z.unknown().optional(),
});

export const ListImageGenInputSchema = z.object({
  projectId: z.string().min(1).max(128),
});

// --------------------------------------------------------------------
// 依赖注入（测试可替换 callChat / generateImage / generateVideo / 积分）
// --------------------------------------------------------------------

export interface GenerateImageResult {
  url: string;
  error: string | null;
  model?: string | null;
  code?: string;
}

export interface GenerateVideoResult {
  ok: boolean;
  error?: string;
  videoUrl?: string;
  taskId?: string;
  model?: string;
}

export interface ImageGenDeps {
  supabase: any;
  userId: string;
  callChat?: (opts: {
    model: string;
    messages: ChatMessage[];
    maxTokens?: number;
    timeoutMs?: number;
    jsonMode?: boolean;
  }) => Promise<GatewayChatResult>;
  generateImage?: (input: {
    prompt: string;
    model?: string;
    size?: string;
  }) => Promise<GenerateImageResult>;
  generateVideo?: (input: {
    prompt: string;
    imageUrl?: string;
    model?: string;
    ratio?: string;
    duration?: number;
    resolution?: string;
    generateAudio?: boolean;
  }) => Promise<GenerateVideoResult>;
  ensureCredits?: typeof ensureEnoughCredits;
  /** 单张生图计价（默认 creditsCost.imageCost）；测试注入以覆盖未计价模型。 */
  imageCostFn?: (model: string | undefined | null) => number | null;
  chargeCredits?: (params: {
    amount: number;
    model?: string;
    description: string;
    idempotencyKey?: string;
  }) => Promise<{ ok: boolean; balanceAfter: number | null; deduped?: boolean }>;
}

// --------------------------------------------------------------------
// 纯函数：换装区间规划解析
// --------------------------------------------------------------------

/** 一条换装区间（look）。字段名统一 camelCase，落库时再转 snake。 */
export interface LookPlanEntry {
  character: string;
  name: string;
  fromShot: string | null;
  toShot: string | null;
  redesignReason: string;
  reuseExisting: boolean;
  reuseSource: string;
  fullBodyFront: string;
  fullBodyBack: string;
  fullBodySide: string;
  identityNote: string;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      !!item && typeof item === "object" && !Array.isArray(item),
  );
}

function pickString(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * 归一化导演模型的换装方案输出。兼容三种包裹形态：
 * { looks: [...] } / { character_wardrobe: [...] }（竞品样本）/ 裸数组；
 * 条目字段兼容 snake_case（from_sc/to_sc/full_body_front…）与 camelCase。
 * 缺 character 或 name 的条目直接丢弃。
 */
export function normalizeLookPlan(parsed: unknown): LookPlanEntry[] {
  const root =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const list = Array.isArray(parsed)
    ? parsed
    : asRecordArray(root?.looks).length > 0
      ? (root?.looks as unknown[])
      : ((root?.character_wardrobe as unknown[]) ?? []);
  return asRecordArray(list)
    .map((row) => {
      const character = pickString(row, "character", "character_name");
      // 竞品样本用 name 字段承载角色名、另无 look 名；此时 look 名回落
      // redesign_reason 的截断在前端不友好，统一用「造型 N」由调用方补。
      const name = pickString(row, "look", "look_name", "label");
      const entry: LookPlanEntry = {
        character,
        name,
        fromShot: pickString(row, "from_sc", "from_shot", "fromShot") || null,
        toShot: pickString(row, "to_sc", "to_shot", "toShot") || null,
        redesignReason: pickString(row, "redesign_reason", "redesignReason", "reason"),
        reuseExisting: row.reuse_existing === true || row.reuseExisting === true,
        reuseSource: pickString(row, "reuse_source", "reuseSource"),
        fullBodyFront: pickString(row, "full_body_front", "fullBodyFront"),
        fullBodyBack: pickString(row, "full_body_back", "fullBodyBack"),
        fullBodySide: pickString(row, "full_body_side", "fullBodySide"),
        identityNote: pickString(row, "identity_note", "identityNote"),
      };
      // 兼容竞品样本：仅当条目带分镜区间字段（from_sc 等）且没有独立
      // look 名时，name 视为角色名（character），look 名留空待补。
      if (!entry.character && !name && (row.from_sc !== undefined || row.from_shot !== undefined || row.fromShot !== undefined)) {
        const rowName = pickString(row, "name");
        if (rowName) entry.character = rowName;
      }
      return entry;
    })
    .filter((entry) => entry.character.length > 0);
}

/** 同角色缺 look 名时按顺序补「造型 N」，保证 (character, name) 可键控。 */
export function fillLookNames(entries: LookPlanEntry[]): LookPlanEntry[] {
  const counter = new Map<string, number>();
  return entries.map((entry) => {
    if (entry.name) return entry;
    const next = (counter.get(entry.character) ?? 0) + 1;
    counter.set(entry.character, next);
    return { ...entry, name: `造型 ${next}` };
  });
}

export interface LookPlanIssue {
  severity: "major" | "minor";
  type: string;
  description: string;
}

/** 换装方案校验（写进产物 issues，不阻断落库，与 B1 关系表校验同口径）。 */
export function validateLookPlan(
  entries: LookPlanEntry[],
  knownCharacters: string[],
): LookPlanIssue[] {
  const issues: LookPlanIssue[] = [];
  const known = new Set(knownCharacters);
  const seenKeys = new Set<string>();
  for (const entry of entries) {
    if (!known.has(entry.character)) {
      issues.push({
        severity: "major",
        type: "unknown_character",
        description: `换装条目引用了不存在的目标角色「${entry.character}」（${entry.name}）。`,
      });
    }
    if (!entry.redesignReason) {
      issues.push({
        severity: "minor",
        type: "missing_reason",
        description: `「${entry.character} · ${entry.name}」缺换装理由 redesign_reason。`,
      });
    }
    if (entry.reuseExisting && !entry.reuseSource) {
      issues.push({
        severity: "minor",
        type: "missing_reuse_source",
        description: `「${entry.character} · ${entry.name}」标记复用但未给 reuse_source。`,
      });
    }
    const key = `${entry.character}::${entry.name}`;
    if (seenKeys.has(key)) {
      issues.push({
        severity: "major",
        type: "duplicate_look",
        description: `「${entry.character} · ${entry.name}」造型名重复。`,
      });
    }
    seenKeys.add(key);
  }
  return issues;
}

// --------------------------------------------------------------------
// 纯函数：生图提示词组装（identity_lock + clothing + styleBrief 注入）
// --------------------------------------------------------------------

export interface CharacterPromptSource {
  name: string;
  identityLock: string;
  description: string;
  clothing: string;
}

const DEFAULT_STYLE_FALLBACK = "保持原片整体质感，输出干净、统一、可复用的转绘资产图。";

function styleLine(styleBrief: string): string {
  return `【目标画风·必须严格遵守】${styleBrief.trim() || DEFAULT_STYLE_FALLBACK}`;
}

/** 角色主图提示词：身份锁定 + 默认服装 + 画风注入。 */
export function buildCharacterMainPrompt(
  character: CharacterPromptSource,
  styleBrief: string,
): string {
  return [
    styleLine(styleBrief),
    "【资产类型】角色主图（单人全身像）",
    `【角色】${character.name}`,
    `【身份锁定·不得改变】${character.identityLock || "严格保留角色脸模、脸型、五官比例、发型与体型。"}`,
    character.description ? `【角色设定】${character.description}` : "",
    character.clothing ? `【默认服装】${character.clothing}` : "",
    "【约束】只生成该单一角色，全身入镜，背景干净，不得出现其他人物、场景或道具；严格保留身份锁定中的脸模/脸型/五官比例与体型发型，整体色彩、材质、线条、光影、笔触与目标画风完全一致。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 角色三视图提示词：单图四栏（正/背/侧 + 正面特写），对齐竞品样本结构。 */
export function buildTurnaroundPrompt(
  character: CharacterPromptSource,
  styleBrief: string,
): string {
  return [
    styleLine(styleBrief),
    `【资产类型】角色三视图参考图（单张图内四栏横向排列）`,
    `【角色】${character.name}`,
    `【身份锁定·四栏必须一致】${character.identityLock || "严格保留角色脸模、脸型、五官比例、发型与体型。"}`,
    character.clothing ? `【默认服装】${character.clothing}` : "",
    "【画面结构】必须包含且只包含四个画面，横向并列、分布均匀：第1栏正面全身站立视图；第2栏背面全身站立视图；第3栏严格侧面全身视图；第4栏正面大特写肖像（头肩，清晰呈现五官、发型与面部配饰，必需项，不得省略）。",
    "【约束】不同视图中发型、配饰、上下装长短、鞋子等一切细节保持一致；人头与身体比例协调；白色干净背景；光影自然柔和；不得出现文字、标注、箭头或其他人物。",
  ]
    .filter(Boolean)
    .join("\n");
}

export type LookViewScope = "look_main" | "look_front" | "look_back" | "look_side";

const LOOK_VIEW_LABEL: Record<LookViewScope, { label: string; field: "fullBodyFront" | "fullBodyBack" | "fullBodySide" }> = {
  look_main: { label: "造型主图（正面全身）", field: "fullBodyFront" },
  look_front: { label: "正面全身视图", field: "fullBodyFront" },
  look_back: { label: "背面全身视图", field: "fullBodyBack" },
  look_side: { label: "侧面全身视图", field: "fullBodySide" },
};

/** 单个 look 的单视角提示词：身份锁定 + 该造型的三向描述 + 画风注入。 */
export function buildLookViewPrompt(
  character: CharacterPromptSource,
  look: LookPlanEntry,
  scope: LookViewScope,
  styleBrief: string,
): string {
  const view = LOOK_VIEW_LABEL[scope];
  const body = look[view.field] || look.fullBodyFront;
  return [
    styleLine(styleBrief),
    `【资产类型】角色换装 ${view.label}`,
    `【角色】${character.name} · 造型「${look.name}」`,
    `【身份锁定·不得改变】${character.identityLock || look.identityNote || "严格保留角色脸模、脸型、五官比例、发型与体型。"}`,
    look.identityNote ? `【身份锚点重申】${look.identityNote}` : "",
    `【服装与配饰（本视角）】${body}`,
    look.redesignReason ? `【换装背景】${look.redesignReason}` : "",
    "【约束】只生成该单一角色，全身入镜，背景干净，不得出现其他人物、场景或道具；只允许改变服装与配饰，身份锁定中的脸模/体型/发型必须与角色主图一致。",
  ]
    .filter(Boolean)
    .join("\n");
}

// --------------------------------------------------------------------
// 纯函数：提示词列表产物
// --------------------------------------------------------------------

export type ImageScope =
  | "character_main"
  | "character_turnaround"
  | "look_main"
  | "look_front"
  | "look_back"
  | "look_side";

export interface ImagePromptItem {
  scope: ImageScope;
  characterId: string;
  characterName: string;
  lookId: string | null;
  lookName: string | null;
  prompt: string;
}

export interface CharacterForPlan extends CharacterPromptSource {
  id: string;
}

export interface LookForPlan extends LookPlanEntry {
  id: string;
  characterId: string;
}

/**
 * 组装全量生图提示词列表：每角色主图 + 三视图；每个非复用 look
 * 主图 + 正/背/侧。reuse_existing 的 look 不生图（复用 reuse_source 产物）。
 */
export function buildImagePromptPlan(
  characters: CharacterForPlan[],
  looks: LookForPlan[],
  styleBrief: string,
): ImagePromptItem[] {
  const items: ImagePromptItem[] = [];
  const looksByCharacter = new Map<string, LookForPlan[]>();
  for (const look of looks) {
    const list = looksByCharacter.get(look.characterId) ?? [];
    list.push(look);
    looksByCharacter.set(look.characterId, list);
  }
  for (const character of characters) {
    items.push({
      scope: "character_main",
      characterId: character.id,
      characterName: character.name,
      lookId: null,
      lookName: null,
      prompt: buildCharacterMainPrompt(character, styleBrief),
    });
    items.push({
      scope: "character_turnaround",
      characterId: character.id,
      characterName: character.name,
      lookId: null,
      lookName: null,
      prompt: buildTurnaroundPrompt(character, styleBrief),
    });
    for (const look of looksByCharacter.get(character.id) ?? []) {
      if (look.reuseExisting) continue;
      for (const scope of ["look_main", "look_front", "look_back", "look_side"] as const) {
        items.push({
          scope,
          characterId: character.id,
          characterName: character.name,
          lookId: look.id,
          lookName: look.name,
          prompt: buildLookViewPrompt(character, look, scope, styleBrief),
        });
      }
    }
  }
  return items;
}

/** 单张生图的扣费幂等键：img:{projectId}:{characterId}:{lookId}:{scopeHash}。 */
export function imageIdempotencyKey(
  projectId: string,
  characterId: string,
  lookId: string | null,
  scopeHash: string,
): string {
  return `img:${projectId}:${characterId}:${lookId ?? "character"}:${scopeHash}`;
}

/** 单张图的 scope 指纹：提示词改动即产生新键（允许按修改后的提示词重跑）。 */
export function imageScopeHash(item: Pick<ImagePromptItem, "scope" | "prompt">): string {
  return computeScopeHash({ scope: item.scope, prompt: item.prompt });
}

// --------------------------------------------------------------------
// 纯函数：音色重要度排序
// --------------------------------------------------------------------

export interface CharacterVoiceStat {
  characterId: string;
  name: string;
  shotCount: number;
  groupCount: number;
}

export interface RankedVoiceStat extends CharacterVoiceStat {
  tier: "重点" | "次要";
  importanceRank: number;
}

/**
 * 按分镜数 → 分组数 → 角色名排重要度；分镜数 ≥ MAJOR_SHOT_THRESHOLD
 * 判重点（竞品音色方案口径），importanceRank 从 1 开始。
 */
export function rankCharacterImportance(stats: CharacterVoiceStat[]): RankedVoiceStat[] {
  const sorted = [...stats].sort(
    (a, b) =>
      b.shotCount - a.shotCount ||
      b.groupCount - a.groupCount ||
      a.name.localeCompare(b.name),
  );
  return sorted.map((stat, index) => ({
    ...stat,
    tier: stat.shotCount >= MAJOR_SHOT_THRESHOLD ? "重点" : "次要",
    importanceRank: index + 1,
  }));
}

export interface VoiceProfile {
  tier: "重点" | "次要";
  importanceRank: number;
  shotCount: number;
  groupCount: number;
  voiceDescription: string;
  referenceEmotion: string;
  /** reference_video=生成音色参考视频；upload_audio=用户上传音频；unfixed=不固定音色。 */
  plan: "reference_video" | "upload_audio" | "unfixed";
  referenceVideoUrl?: string | null;
  referenceVideoTaskId?: string | null;
}

/** 归一化导演模型的音色方案输出：{ voices: [{character, voice_description, reference_emotion}] }。 */
export function normalizeVoicePlan(parsed: unknown): Map<string, { voiceDescription: string; referenceEmotion: string }> {
  const root =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const rows = asRecordArray(root.voices ?? root.characters ?? root.profiles);
  const map = new Map<string, { voiceDescription: string; referenceEmotion: string }>();
  for (const row of rows) {
    const character = pickString(row, "character", "name");
    if (!character) continue;
    map.set(character, {
      voiceDescription: pickString(row, "voice_description", "voiceDescription", "voice"),
      referenceEmotion: pickString(row, "reference_emotion", "referenceEmotion", "emotion"),
    });
  }
  return map;
}

/** 音色参考视频提示词：角色按音色方案说一段台词（图生视频 + 出声）。 */
export function buildVoiceReferencePrompt(
  character: CharacterPromptSource,
  profile: Pick<VoiceProfile, "voiceDescription" | "referenceEmotion">,
): string {
  return [
    `角色「${character.name}」的音色参考视频。`,
    character.identityLock ? `形象严格保持：${character.identityLock}` : "",
    `音色要求：${profile.voiceDescription || "贴合角色人设的自然嗓音"}。`,
    `参考情绪：${profile.referenceEmotion || "平静自述"}。`,
    "角色面对镜头，用符合音色要求的声音做一段简短自我介绍式独白（2-3 句），口型与声音对齐，画面稳定，背景简洁。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 音色参考视频的预估积分（确认弹窗展示用；未计价返回 null）。 */
export function voiceReferenceVideoCost(): number | null {
  return videoCost(RESTYLE_VIDEO_MODEL, VOICE_REFERENCE_RESOLUTION, VOICE_REFERENCE_DURATION_SEC);
}

// --------------------------------------------------------------------
// 结果类型
// --------------------------------------------------------------------

export type GateFailure = { ok: false; code: "STAGE_NOT_APPROVED"; pending: string[] };

export type PlanLooksResult =
  | {
      ok: true;
      projectId: string;
      scopeHash: string;
      lookCount: number;
      validationIssues: LookPlanIssue[];
      model: string;
      usedFallback: boolean;
    }
  | GateFailure
  | { ok: false; code: string; error?: string };

export type PlanPromptsResult =
  | { ok: true; projectId: string; scopeHash: string; itemCount: number }
  | GateFailure
  | { ok: false; code: string; error?: string };

export interface ImageItemFailure {
  scope: ImageScope;
  characterId: string;
  characterName: string;
  lookId: string | null;
  error: string;
}

export type GenerateImagesResult =
  | {
      ok: true;
      projectId: string;
      total: number;
      generated: number;
      chargedCredits: number;
      failures: ImageItemFailure[];
    }
  | GateFailure
  | { ok: false; code: string; error?: string };

export type EstimateImagesResult =
  | {
      ok: true;
      totalImages: number;
      perImageCredits: number | null;
      totalCredits: number | null;
      promptsApproved: boolean;
    }
  | { ok: false; code: string; error?: string };

export type PlanVoiceResult =
  | {
      ok: true;
      projectId: string;
      scopeHash: string;
      profileCount: number;
      majorCount: number;
      model: string;
      usedFallback: boolean;
    }
  | GateFailure
  | { ok: false; code: string; error?: string };

export interface VoiceVideoFailure {
  characterId: string;
  characterName: string;
  error: string;
}

export type GenerateVoiceVideoResult =
  | {
      ok: true;
      projectId: string;
      generated: number;
      perVideoCredits: number | null;
      failures: VoiceVideoFailure[];
    }
  | GateFailure
  | { ok: false; code: string; error?: string };

export type ConfirmResult =
  | { ok: true; artifact: ArtifactState }
  | { ok: false; code: string; error: string };

// --------------------------------------------------------------------
// 读库 / 闸门 / 产物 helpers
// --------------------------------------------------------------------

interface CharacterRow {
  id: string;
  name: string;
  identity_lock: string | null;
  description: string | null;
  clothing: string | null;
  main_image_url: string | null;
  turnaround_url: string | null;
  voice_profile: JsonValue | null;
  status: string;
}

interface LookRow {
  id: string;
  character_id: string;
  name: string;
  from_shot: string | null;
  to_shot: string | null;
  redesign_reason: string | null;
  reuse_existing: boolean | null;
  reuse_source: string | null;
  front_url: string | null;
  back_url: string | null;
  side_url: string | null;
  image_url: string | null;
}

interface ArtifactRowLike {
  id: string;
  status: ArtifactState["status"];
  content: JsonValue;
  user_content: JsonValue;
  scope_hash: string | null;
  revision: number;
  verdict: string | null;
  issues: JsonValue[] | null;
}

/** 与 assertStageApprovedFn 同口径的阶段闸门。 */
async function checkStageGate(
  supabase: any,
  projectId: string,
  stage: string,
): Promise<{ ok: true } | { ok: false; pending: string[] }> {
  const { data: rows, error } = await supabase
    .from("restyle_artifacts")
    .select("node_key, status")
    .eq("project_id", projectId)
    .eq("stage", stage);
  if (error) return { ok: false, pending: [] };
  const list = (rows ?? []) as Array<{ node_key: string; status: string }>;
  const pending = list.filter((r) => r.status !== "user_approved").map((r) => r.node_key);
  if (list.length === 0 || pending.length > 0) return { ok: false, pending };
  return { ok: true };
}

async function fetchArtifactRow(
  supabase: any,
  projectId: string,
  stage: string,
  nodeKey: string,
): Promise<{ row?: ArtifactRowLike; error?: string }> {
  const { data, error } = await supabase
    .from("restyle_artifacts")
    .select("*")
    .eq("project_id", projectId)
    .eq("stage", stage)
    .eq("node_key", nodeKey)
    .maybeSingle();
  if (error) return { error: error.message };
  return { row: (data as ArtifactRowLike | null) ?? undefined };
}

function stateFromRow(row: ArtifactRowLike): ArtifactState {
  return {
    status: row.status,
    content: row.content,
    userContent: row.user_content ?? null,
    scopeHash: row.scope_hash ?? "",
    revision: row.revision,
    verdict: row.verdict,
    issues: row.issues ?? [],
  };
}

/** 产物 upsert（ai_write 状态机；与 upsertArtifactFn 同规则，永不覆写 user_content）。 */
async function upsertArtifact(
  supabase: any,
  userId: string,
  projectId: string,
  stage: string,
  nodeKey: string,
  content: JsonValue,
  scopeHash: string,
): Promise<{ state?: ArtifactState; error?: string }> {
  const existing = await fetchArtifactRow(supabase, projectId, stage, nodeKey);
  if (existing.error) return { error: existing.error };
  const row = existing.row;
  const now = new Date().toISOString();
  const state = row
    ? transitionArtifact(stateFromRow(row), { type: "ai_write", content, scopeHash })
    : createInitialArtifact(content, scopeHash);

  if (!row) {
    const { error } = await supabase.from("restyle_artifacts").insert({
      id: `art_${crypto.randomUUID()}`,
      user_id: userId,
      project_id: projectId,
      stage,
      node_key: nodeKey,
      content: state.content,
      user_content: state.userContent,
      status: state.status,
      verdict: state.verdict,
      issues: state.issues,
      scope_hash: state.scopeHash,
      revision: state.revision,
      created_at: now,
      updated_at: now,
    });
    if (error) return { error: error.message };
    return { state };
  }
  const { error } = await supabase
    .from("restyle_artifacts")
    .update({
      content: state.content,
      status: state.status,
      verdict: state.verdict,
      issues: state.issues,
      scope_hash: state.scopeHash,
      revision: state.revision,
      updated_at: now,
    })
    .eq("id", row.id);
  if (error) return { error: error.message };
  return { state };
}

/** 人工确认产物（approve 状态机推进，写 approved_by/at）。 */
async function approveArtifactRow(
  supabase: any,
  userId: string,
  projectId: string,
  stage: string,
  nodeKey: string,
  userContent: unknown,
): Promise<{ state?: ArtifactState; error?: string; notFound?: boolean }> {
  const existing = await fetchArtifactRow(supabase, projectId, stage, nodeKey);
  if (existing.error) return { error: existing.error };
  if (!existing.row) return { notFound: true };
  const state = transitionArtifact(stateFromRow(existing.row), {
    type: "approve",
    userContent: userContent as JsonValue | undefined,
  });
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("restyle_artifacts")
    .update({
      status: state.status,
      user_content: state.userContent,
      revision: state.revision,
      approved_by: userId,
      approved_at: now,
      updated_at: now,
    })
    .eq("id", existing.row.id);
  if (error) return { error: error.message };
  return { state };
}

async function readCharacters(
  supabase: any,
  projectId: string,
): Promise<{ rows?: CharacterRow[]; error?: string }> {
  const { data, error } = await supabase
    .from("restyle_characters")
    .select(
      "id, name, identity_lock, description, clothing, main_image_url, turnaround_url, voice_profile, status",
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) return { error: error.message };
  return { rows: (data ?? []) as CharacterRow[] };
}

/** 产物有效内容：下游只读 user_approved 的 userContent ?? content。 */
function approvedContent(row: ArtifactRowLike): JsonValue {
  return row.user_content ?? row.content;
}

function toCharacterPromptSource(row: CharacterRow): CharacterPromptSource {
  return {
    name: row.name,
    identityLock: row.identity_lock ?? "",
    description: row.description ?? "",
    clothing: row.clothing ?? "",
  };
}

async function defaultCharge(
  supabase: any,
  userId: string,
  params: { amount: number; model?: string; description: string; idempotencyKey?: string },
) {
  const { chargeCredits } = await import("../userCredits.functions");
  return chargeCredits(supabase, userId, params);
}

// --------------------------------------------------------------------
// 1) 换装区间规划
// --------------------------------------------------------------------

const LOOKS_USER_INSTRUCTION = `请基于 [CONTEXT] 中的目标角色（含 identity_lock / clothing）与分镜时间线，按 wardrobe-continuity 契约为每个有换装需求的角色推导造型（look）清单：
1. 每条 look 给出 character / name / from_sc / to_sc（分镜号闭区间，如 EP01_SC01）/ redesign_reason / reuse_existing / reuse_source / full_body_front / full_body_back / full_body_side / identity_note。
2. 同角色区间互不重叠、按时间线升序；换装必须有剧情动机；满足复用条件时优先 reuse_existing。
3. 无换装需求的角色不输出。
只输出一个 JSON 对象：{ "looks": [...] }。`;

interface ShotContextRow {
  episode_id: string;
  shot_no: string;
  characters: unknown;
  scene_type: string | null;
  emotion: string | null;
}

export async function planCharacterLooksCore(
  input: z.infer<typeof PlanLooksInputSchema>,
  deps: ImageGenDeps,
): Promise<PlanLooksResult> {
  const { supabase, userId } = deps;
  const callChat = deps.callChat ?? callLovableChat;
  const ensureCredits = deps.ensureCredits ?? ensureEnoughCredits;

  // ---- 1. 积分预校验（规划调用导演模型，1 分/次）----
  const guard = await ensureCredits(LOOKS_CREDIT_COST, {
    kind: "image",
    model: INTERNAL_DIRECTOR_MODEL,
  });
  if (!guard.ok) return { ok: false, code: "INSUFFICIENT_CREDITS", error: guard.error };

  // ---- 2. 阶段闸门：资产映射须已确认 ----
  const gate = await checkStageGate(supabase, input.projectId, "asset_mapping");
  if (!gate.ok) return { ok: false, code: "STAGE_NOT_APPROVED", pending: gate.pending };

  // ---- 3. 读项目画风 + 角色 + 分镜时间线 ----
  const { data: projectRow, error: projectError } = await supabase
    .from("restyle_projects")
    .select("id, style_brief")
    .eq("id", input.projectId)
    .maybeSingle();
  if (projectError) return { ok: false, code: "DB_ERROR", error: projectError.message };
  if (!projectRow) return { ok: false, code: "PROJECT_NOT_FOUND", error: "项目不存在。" };
  const styleBrief = (projectRow as { style_brief: string | null }).style_brief ?? "";

  const charactersResult = await readCharacters(supabase, input.projectId);
  if (charactersResult.error) return { ok: false, code: "DB_ERROR", error: charactersResult.error };
  const characters = charactersResult.rows!;
  if (characters.length === 0) {
    return { ok: false, code: "NO_CHARACTERS", error: "项目下没有目标角色，请先完成资产映射。" };
  }

  const { data: episodeRows, error: episodeError } = await supabase
    .from("restyle_episodes")
    .select("id, episode_no")
    .eq("project_id", input.projectId)
    .order("episode_no", { ascending: true });
  if (episodeError) return { ok: false, code: "DB_ERROR", error: episodeError.message };
  const episodes = (episodeRows ?? []) as Array<{ id: string; episode_no: number | null }>;
  const episodeIds = episodes.map((episode) => episode.id);
  const episodeNoById = new Map(episodes.map((episode) => [episode.id, episode.episode_no]));

  let shots: ShotContextRow[] = [];
  if (episodeIds.length > 0) {
    const { data: shotRows, error: shotError } = await supabase
      .from("restyle_shots")
      .select("episode_id, shot_no, characters, scene_type, emotion")
      .in("episode_id", episodeIds)
      .order("start_ms", { ascending: true });
    if (shotError) return { ok: false, code: "DB_ERROR", error: shotError.message };
    shots = (shotRows ?? []) as ShotContextRow[];
  }

  // ---- 4. scope 指纹（角色人设/时间线/画风变化即失效）----
  const scopeHash = computeScopeHash({
    projectId: input.projectId,
    styleBrief,
    characters: characters.map((row) => ({
      name: row.name,
      identityLock: row.identity_lock,
      clothing: row.clothing,
    })),
    shots: shots.map((shot) => ({
      ep: episodeNoById.get(shot.episode_id) ?? null,
      shotNo: shot.shot_no,
      characters: shot.characters,
    })),
  });

  // ---- 5. 调导演模型（wardrobe-continuity skill，主模型失败回退一次）----
  const context = {
    scope: { projectId: input.projectId },
    styleBrief: styleBrief || null,
    characters: characters.map((row) => ({
      name: row.name,
      identity_lock: row.identity_lock,
      description: row.description,
      clothing: row.clothing,
    })),
    timeline: episodes.map((episode) => ({
      episodeNo: episode.episode_no,
      shots: shots
        .filter((shot) => shot.episode_id === episode.id)
        .map((shot) => ({
          shotNo: `EP${String(episode.episode_no ?? 0).padStart(2, "0")}_${shot.shot_no}`,
          characters: Array.isArray(shot.characters) ? shot.characters : [],
          sceneType: shot.scene_type,
          emotion: shot.emotion,
        })),
    })),
  };
  const messages: ChatMessage[] = [
    { role: "system", content: composePrompt(["wardrobe-continuity"], JSON.stringify(context, null, 2)) },
    { role: "user", content: LOOKS_USER_INSTRUCTION },
  ];

  let aiResult = await callChat({
    model: INTERNAL_DIRECTOR_MODEL,
    messages,
    maxTokens: 16_000,
    timeoutMs: 300_000,
    jsonMode: true,
  });
  let usedFallback = false;
  if (!aiResult.ok) {
    usedFallback = true;
    aiResult = await callChat({
      model: INTERNAL_DIRECTOR_FALLBACK_MODEL,
      messages,
      maxTokens: 16_000,
      timeoutMs: 300_000,
      jsonMode: true,
    });
  }
  if (!aiResult.ok) {
    logGenerationError({
      kind: "image",
      provider: "lovable",
      model: INTERNAL_DIRECTOR_MODEL,
      errorMessage: `换装区间规划调用失败（含回退）: ${aiResult.error}`,
      requestPayload: { projectId: input.projectId, stage: IMAGE_GEN_STAGE, node: LOOKS_NODE_KEY },
      userId,
    });
    return { ok: false, code: "AI_CALL_FAILED", error: aiResult.error };
  }

  let parsed: unknown;
  try {
    parsed = extractJson(aiResult.text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logGenerationError({
      kind: "image",
      provider: "lovable",
      model: aiResult.model,
      errorMessage: `换装区间规划输出解析失败: ${msg}`,
      requestPayload: { projectId: input.projectId, stage: `${IMAGE_GEN_STAGE}_looks_parse` },
      responseBody: aiResult.text.slice(0, 2_000),
      userId,
    });
    return { ok: false, code: "AI_OUTPUT_INVALID", error: msg };
  }

  // ---- 6. 归一化 + 校验 + 写 restyle_character_looks ----
  const entries = fillLookNames(normalizeLookPlan(parsed));
  const idByName = new Map(characters.map((row) => [row.name, row.id]));
  const validationIssues = validateLookPlan(
    entries,
    characters.map((row) => row.name),
  );
  const knownEntries = entries.filter((entry) => idByName.has(entry.character));

  const characterIds = characters.map((row) => row.id);
  if (characterIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("restyle_character_looks")
      .delete()
      .in("character_id", characterIds);
    if (deleteError) return { ok: false, code: "DB_ERROR", error: deleteError.message };
  }
  const now = new Date().toISOString();
  if (knownEntries.length > 0) {
    const rows = knownEntries.map((entry) => ({
      id: `look_${crypto.randomUUID()}`,
      user_id: userId,
      character_id: idByName.get(entry.character)!,
      name: entry.name,
      from_shot: entry.fromShot,
      to_shot: entry.toShot,
      redesign_reason: entry.redesignReason || null,
      reuse_existing: entry.reuseExisting,
      reuse_source: entry.reuseSource || null,
      created_at: now,
    }));
    const { error: insertError } = await supabase.from("restyle_character_looks").insert(rows);
    if (insertError) return { ok: false, code: "DB_ERROR", error: insertError.message };
  }

  // ---- 7. 产物 upsert（stage="image_gen", node="looks"）----
  const artifactContent: JsonValue = {
    version: 1,
    generatedAt: now,
    model: aiResult.model,
    usedFallback,
    looks: knownEntries as unknown as JsonValue,
    validationIssues: validationIssues as unknown as JsonValue,
  };
  const upserted = await upsertArtifact(
    supabase, userId, input.projectId, IMAGE_GEN_STAGE, LOOKS_NODE_KEY, artifactContent, scopeHash,
  );
  if (upserted.error) return { ok: false, code: "DB_ERROR", error: upserted.error };

  // ---- 8. 成功扣费（1 分/次，幂等键防重复；扣失败不阻断）----
  const charge =
    deps.chargeCredits ?? ((params: { amount: number; model?: string; description: string; idempotencyKey?: string }) => defaultCharge(supabase, userId, params));
  await charge({
    amount: LOOKS_CREDIT_COST,
    model: aiResult.model,
    description: "转绘换装区间规划",
    idempotencyKey: `looks:${input.projectId}:${scopeHash}`,
  });

  return {
    ok: true,
    projectId: input.projectId,
    scopeHash,
    lookCount: knownEntries.length,
    validationIssues,
    model: aiResult.model,
    usedFallback,
  };
}

/** 确认换装方案：产物置 user_approved；userContent.looks 改写同步回写 looks 表。 */
export async function confirmCharacterLooksCore(
  input: z.infer<typeof ConfirmArtifactInputSchema>,
  deps: ImageGenDeps,
): Promise<ConfirmResult> {
  const { supabase, userId } = deps;
  const approved = await approveArtifactRow(
    supabase, userId, input.projectId, IMAGE_GEN_STAGE, LOOKS_NODE_KEY, input.userContent,
  );
  if (approved.error) return { ok: false, code: "DB_ERROR", error: approved.error };
  if (approved.notFound) {
    return { ok: false, code: "ARTIFACT_NOT_FOUND", error: "换装方案产物不存在，请先生成方案。" };
  }

  if (input.userContent !== undefined) {
    const root =
      input.userContent && typeof input.userContent === "object" && !Array.isArray(input.userContent)
        ? (input.userContent as Record<string, unknown>)
        : {};
    const editedLooks = asRecordArray(root.looks);
    if (editedLooks.length > 0) {
      const entries = fillLookNames(normalizeLookPlan({ looks: editedLooks }));
      const charactersResult = await readCharacters(supabase, input.projectId);
      if (charactersResult.error) return { ok: false, code: "DB_ERROR", error: charactersResult.error };
      const idByName = new Map(charactersResult.rows!.map((row) => [row.name, row.id]));
      const knownEntries = entries.filter((entry) => idByName.has(entry.character));
      const characterIds = charactersResult.rows!.map((row) => row.id);
      if (characterIds.length > 0) {
        const { error: deleteError } = await supabase
          .from("restyle_character_looks")
          .delete()
          .in("character_id", characterIds);
        if (deleteError) return { ok: false, code: "DB_ERROR", error: deleteError.message };
      }
      if (knownEntries.length > 0) {
        const now = new Date().toISOString();
        const rows = knownEntries.map((entry) => ({
          id: `look_${crypto.randomUUID()}`,
          user_id: userId,
          character_id: idByName.get(entry.character)!,
          name: entry.name,
          from_shot: entry.fromShot,
          to_shot: entry.toShot,
          redesign_reason: entry.redesignReason || null,
          reuse_existing: entry.reuseExisting,
          reuse_source: entry.reuseSource || null,
          created_at: now,
        }));
        const { error: insertError } = await supabase.from("restyle_character_looks").insert(rows);
        if (insertError) return { ok: false, code: "DB_ERROR", error: insertError.message };
      }
    }
  }
  return { ok: true, artifact: approved.state! };
}

// --------------------------------------------------------------------
// 2) 生图提示词列表（提示词确认关卡）
// --------------------------------------------------------------------

export async function planImagePromptsCore(
  input: z.infer<typeof PlanPromptsInputSchema>,
  deps: ImageGenDeps,
): Promise<PlanPromptsResult> {
  const { supabase } = deps;

  // ---- 1. 闸门：换装方案须已确认 ----
  const looksArtifact = await fetchArtifactRow(supabase, input.projectId, IMAGE_GEN_STAGE, LOOKS_NODE_KEY);
  if (looksArtifact.error) return { ok: false, code: "DB_ERROR", error: looksArtifact.error };
  if (!looksArtifact.row || looksArtifact.row.status !== "user_approved") {
    return { ok: false, code: "STAGE_NOT_APPROVED", pending: [LOOKS_NODE_KEY] };
  }

  // ---- 2. 读角色 + looks 表 + 已确认方案（含三向描述）----
  const { data: projectRow, error: projectError } = await supabase
    .from("restyle_projects")
    .select("id, style_brief")
    .eq("id", input.projectId)
    .maybeSingle();
  if (projectError) return { ok: false, code: "DB_ERROR", error: projectError.message };
  if (!projectRow) return { ok: false, code: "PROJECT_NOT_FOUND", error: "项目不存在。" };
  const styleBrief = (projectRow as { style_brief: string | null }).style_brief ?? "";

  const charactersResult = await readCharacters(supabase, input.projectId);
  if (charactersResult.error) return { ok: false, code: "DB_ERROR", error: charactersResult.error };
  const characters = charactersResult.rows!;
  if (characters.length === 0) {
    return { ok: false, code: "NO_CHARACTERS", error: "项目下没有目标角色。" };
  }
  const characterIds = characters.map((row) => row.id);

  const { data: lookRowsRaw, error: lookError } = await supabase
    .from("restyle_character_looks")
    .select(
      "id, character_id, name, from_shot, to_shot, redesign_reason, reuse_existing, reuse_source, front_url, back_url, side_url, image_url",
    )
    .in("character_id", characterIds)
    .order("created_at", { ascending: true });
  if (lookError) return { ok: false, code: "DB_ERROR", error: lookError.message };
  const lookRows = (lookRowsRaw ?? []) as LookRow[];

  // 三向描述在 looks 产物里（表里没有对应列）；按 角色名+造型名 合并回 look 行。
  const approvedLooks = approvedContent(looksArtifact.row);
  const root =
    approvedLooks && typeof approvedLooks === "object" && !Array.isArray(approvedLooks)
      ? (approvedLooks as Record<string, unknown>)
      : {};
  const planEntries = fillLookNames(normalizeLookPlan({ looks: asRecordArray(root.looks) }));
  const nameByCharacterId = new Map(characters.map((row) => [row.id, row.name]));
  const entryByKey = new Map(planEntries.map((entry) => [`${entry.character}::${entry.name}`, entry]));

  const looksForPlan: LookForPlan[] = lookRows.map((row) => {
    const characterName = nameByCharacterId.get(row.character_id) ?? "";
    const entry = entryByKey.get(`${characterName}::${row.name}`);
    return {
      id: row.id,
      characterId: row.character_id,
      character: characterName,
      name: row.name,
      fromShot: row.from_shot,
      toShot: row.to_shot,
      redesignReason: row.redesign_reason ?? entry?.redesignReason ?? "",
      reuseExisting: row.reuse_existing === true,
      reuseSource: row.reuse_source ?? entry?.reuseSource ?? "",
      fullBodyFront: entry?.fullBodyFront ?? "",
      fullBodyBack: entry?.fullBodyBack ?? "",
      fullBodySide: entry?.fullBodySide ?? "",
      identityNote: entry?.identityNote ?? "",
    };
  });

  // ---- 3. 组装提示词列表 + scope 指纹 + 产物 upsert ----
  const items = buildImagePromptPlan(
    characters.map((row) => ({ id: row.id, ...toCharacterPromptSource(row) })),
    looksForPlan,
    styleBrief,
  );
  const scopeHash = computeScopeHash({
    projectId: input.projectId,
    styleBrief,
    characters: characters.map((row) => ({
      id: row.id,
      identityLock: row.identity_lock,
      clothing: row.clothing,
    })),
    looks: looksForPlan.map((look) => ({
      id: look.id,
      reuseExisting: look.reuseExisting,
      fullBodyFront: look.fullBodyFront,
      fullBodyBack: look.fullBodyBack,
      fullBodySide: look.fullBodySide,
    })),
  });

  const artifactContent: JsonValue = {
    version: 1,
    generatedAt: new Date().toISOString(),
    imageModel: RESTYLE_IMAGE_MODEL,
    items: items as unknown as JsonValue,
  };
  const upserted = await upsertArtifact(
    supabase, deps.userId, input.projectId, IMAGE_GEN_STAGE, PROMPTS_NODE_KEY, artifactContent, scopeHash,
  );
  if (upserted.error) return { ok: false, code: "DB_ERROR", error: upserted.error };

  return { ok: true, projectId: input.projectId, scopeHash, itemCount: items.length };
}

// --------------------------------------------------------------------
// 3) 造型化生图（双闸门 + 逐张积分 + 幂等扣费）
// --------------------------------------------------------------------

/** 从 prompts 产物读取提示词列表（下游只读 user_approved 的 userContent ?? content）。 */
function readPromptItems(row: ArtifactRowLike): ImagePromptItem[] {
  const root = approvedContent(row);
  const record =
    root && typeof root === "object" && !Array.isArray(root)
      ? (root as Record<string, unknown>)
      : {};
  return asRecordArray(record.items)
    .map((item) => {
      const scope = pickString(item, "scope") as ImageScope;
      const characterId = pickString(item, "characterId", "character_id");
      const prompt = pickString(item, "prompt");
      if (!scope || !characterId || !prompt) return null;
      return {
        scope,
        characterId,
        characterName: pickString(item, "characterName", "character_name"),
        lookId: pickString(item, "lookId", "look_id") || null,
        lookName: pickString(item, "lookName", "look_name") || null,
        prompt,
      };
    })
    .filter((item): item is ImagePromptItem => item !== null);
}

export async function estimateCharacterImagesCore(
  input: z.infer<typeof EstimateImagesInputSchema>,
  deps: ImageGenDeps,
): Promise<EstimateImagesResult> {
  const { supabase } = deps;
  const promptsArtifact = await fetchArtifactRow(supabase, input.projectId, IMAGE_GEN_STAGE, PROMPTS_NODE_KEY);
  if (promptsArtifact.error) return { ok: false, code: "DB_ERROR", error: promptsArtifact.error };
  if (!promptsArtifact.row) {
    return { ok: false, code: "ARTIFACT_NOT_FOUND", error: "生图提示词尚未生成。" };
  }
  let items = readPromptItems(promptsArtifact.row);
  if (input.characterIds?.length) {
    const wanted = new Set(input.characterIds);
    items = items.filter((item) => wanted.has(item.characterId));
  }
  const perImageCredits = (deps.imageCostFn ?? imageCost)(RESTYLE_IMAGE_MODEL);
  return {
    ok: true,
    totalImages: items.length,
    perImageCredits,
    totalCredits: perImageCredits === null ? null : perImageCredits * items.length,
    promptsApproved: promptsArtifact.row.status === "user_approved",
  };
}

/** scope → 写库字段（角色主图/三视图 → characters；look 视角 → looks）。 */
const SCOPE_COLUMN: Record<ImageScope, { table: "restyle_characters" | "restyle_character_looks"; column: string }> = {
  character_main: { table: "restyle_characters", column: "main_image_url" },
  character_turnaround: { table: "restyle_characters", column: "turnaround_url" },
  look_main: { table: "restyle_character_looks", column: "image_url" },
  look_front: { table: "restyle_character_looks", column: "front_url" },
  look_back: { table: "restyle_character_looks", column: "back_url" },
  look_side: { table: "restyle_character_looks", column: "side_url" },
};

export async function generateCharacterImagesCore(
  input: z.infer<typeof GenerateImagesInputSchema>,
  deps: ImageGenDeps,
): Promise<GenerateImagesResult> {
  const { supabase, userId } = deps;
  const ensureCredits = deps.ensureCredits ?? ensureEnoughCredits;
  const costOf = deps.imageCostFn ?? imageCost;
  const charge =
    deps.chargeCredits ?? ((params: { amount: number; model?: string; description: string; idempotencyKey?: string }) => defaultCharge(supabase, userId, params));
  const generate =
    deps.generateImage ??
    (async (generateInput: { prompt: string; model?: string; size?: string }) => {
      const { generateImage } = await import("../seedream.functions");
      return (await generateImage({ data: generateInput })) as GenerateImageResult;
    });

  // ---- 1. 双闸门：资产映射 + 生图提示词均须 user_approved ----
  const mappingGate = await checkStageGate(supabase, input.projectId, "asset_mapping");
  if (!mappingGate.ok) return { ok: false, code: "STAGE_NOT_APPROVED", pending: mappingGate.pending };
  const promptsArtifact = await fetchArtifactRow(supabase, input.projectId, IMAGE_GEN_STAGE, PROMPTS_NODE_KEY);
  if (promptsArtifact.error) return { ok: false, code: "DB_ERROR", error: promptsArtifact.error };
  if (!promptsArtifact.row || promptsArtifact.row.status !== "user_approved") {
    // 提示词确认前禁止真实生图（需求文档第五节「提示词确认」）。
    return { ok: false, code: "STAGE_NOT_APPROVED", pending: [`${IMAGE_GEN_STAGE}/${PROMPTS_NODE_KEY}`] };
  }

  // ---- 2. 读提示词列表并按 characterIds 过滤 ----
  let items = readPromptItems(promptsArtifact.row);
  if (input.characterIds?.length) {
    const wanted = new Set(input.characterIds);
    items = items.filter((item) => wanted.has(item.characterId));
  }
  if (items.length === 0) {
    return { ok: false, code: "NO_PROMPTS", error: "没有待生成的图片提示词。" };
  }

  // ---- 3. 逐张生成（串行：生图通道自带 6 分钟超时与 429 退避，避免并发打满）----
  const perImageCredits = costOf(RESTYLE_IMAGE_MODEL);
  const failures: ImageItemFailure[] = [];
  let generated = 0;
  let chargedCredits = 0;

  for (const item of items) {
    // 逐张积分预校验：余额不足即中止整批（后续张必然同样不足）。
    const guard = await ensureCredits(perImageCredits, { kind: "image", model: RESTYLE_IMAGE_MODEL });
    if (!guard.ok) {
      failures.push({
        scope: item.scope,
        characterId: item.characterId,
        characterName: item.characterName,
        lookId: item.lookId,
        error: guard.error,
      });
      return {
        ok: false,
        code: "INSUFFICIENT_CREDITS",
        error: `已生成 ${generated} 张后余额不足：${guard.error}`,
      };
    }

    const result = await generate({
      prompt: item.prompt,
      model: RESTYLE_IMAGE_MODEL,
      size: "2K",
    });
    if (!result.url || result.error) {
      const message = result.error || "生图返回为空";
      logGenerationError({
        kind: "image",
        provider: "seedream",
        model: result.model ?? RESTYLE_IMAGE_MODEL,
        errorMessage: `转绘造型生图失败(${item.scope}): ${message}`,
        requestPayload: {
          projectId: input.projectId,
          characterId: item.characterId,
          lookId: item.lookId,
          scope: item.scope,
        },
        userId,
      });
      failures.push({
        scope: item.scope,
        characterId: item.characterId,
        characterName: item.characterName,
        lookId: item.lookId,
        error: message,
      });
      continue;
    }

    // ---- 成功：写 URL + 按张扣费（幂等键防重复扣）----
    const target = SCOPE_COLUMN[item.scope];
    const rowId = target.table === "restyle_characters" ? item.characterId : item.lookId;
    if (rowId) {
      const { error: updateError } = await supabase
        .from(target.table)
        .update({ [target.column]: result.url })
        .eq("id", rowId);
      if (updateError) {
        failures.push({
          scope: item.scope,
          characterId: item.characterId,
          characterName: item.characterName,
          lookId: item.lookId,
          error: `图片已生成但写库失败：${updateError.message}`,
        });
        continue;
      }
    }
    generated += 1;

    const cost = costOf(result.model ?? RESTYLE_IMAGE_MODEL);
    if (cost !== null) {
      const scopeHash = imageScopeHash(item);
      const chargeResult = await charge({
        amount: cost,
        model: result.model ?? RESTYLE_IMAGE_MODEL,
        description: `转绘造型生图（${item.scope}）`,
        idempotencyKey: imageIdempotencyKey(input.projectId, item.characterId, item.lookId, scopeHash),
      });
      if (chargeResult.ok && !chargeResult.deduped) chargedCredits += cost;
    }
  }

  return {
    ok: true,
    projectId: input.projectId,
    total: items.length,
    generated,
    chargedCredits,
    failures,
  };
}

// --------------------------------------------------------------------
// 4) 音色方案 + 音色参考视频
// --------------------------------------------------------------------

const VOICE_USER_INSTRUCTION = `请基于 [CONTEXT] 中的目标角色人设、分镜数/分组数统计与台词样本，为每个角色产出音色方案：
1. voice_description：音色描述（年龄段感/音高/质感/语速，一句话）。
2. reference_emotion：音色参考视频应呈现的参考情绪。
只输出一个 JSON 对象：{ "voices": [{ "character", "voice_description", "reference_emotion" }] }，character 必须与目标角色名一致。`;

export async function planVoiceProfilesCore(
  input: z.infer<typeof PlanVoiceInputSchema>,
  deps: ImageGenDeps,
): Promise<PlanVoiceResult> {
  const { supabase, userId } = deps;
  const callChat = deps.callChat ?? callLovableChat;
  const ensureCredits = deps.ensureCredits ?? ensureEnoughCredits;

  const guard = await ensureCredits(VOICE_PLAN_CREDIT_COST, {
    kind: "image",
    model: INTERNAL_DIRECTOR_MODEL,
  });
  if (!guard.ok) return { ok: false, code: "INSUFFICIENT_CREDITS", error: guard.error };

  const gate = await checkStageGate(supabase, input.projectId, "asset_mapping");
  if (!gate.ok) return { ok: false, code: "STAGE_NOT_APPROVED", pending: gate.pending };

  const charactersResult = await readCharacters(supabase, input.projectId);
  if (charactersResult.error) return { ok: false, code: "DB_ERROR", error: charactersResult.error };
  const characters = charactersResult.rows!;
  if (characters.length === 0) {
    return { ok: false, code: "NO_CHARACTERS", error: "项目下没有目标角色，请先完成资产映射。" };
  }

  // ---- 分镜数 / 分组数统计 ----
  const { data: episodeRows, error: episodeError } = await supabase
    .from("restyle_episodes")
    .select("id")
    .eq("project_id", input.projectId);
  if (episodeError) return { ok: false, code: "DB_ERROR", error: episodeError.message };
  const episodeIds = ((episodeRows ?? []) as Array<{ id: string }>).map((row) => row.id);

  const shotCountByName = new Map<string, number>();
  const shotIdsByName = new Map<string, Set<string>>();
  const dialogueSampleByName = new Map<string, string[]>();
  let allShotIds: string[] = [];
  if (episodeIds.length > 0) {
    const { data: shotRows, error: shotError } = await supabase
      .from("restyle_shots")
      .select("id, characters, dialogue")
      .in("episode_id", episodeIds);
    if (shotError) return { ok: false, code: "DB_ERROR", error: shotError.message };
    allShotIds = ((shotRows ?? []) as Array<{ id: string }>).map((row) => row.id);
    for (const shot of (shotRows ?? []) as Array<{ id: string; characters: unknown; dialogue: string | null }>) {
      const names = Array.isArray(shot.characters) ? (shot.characters as unknown[]).filter((n): n is string => typeof n === "string") : [];
      for (const name of names) {
        shotCountByName.set(name, (shotCountByName.get(name) ?? 0) + 1);
        const set = shotIdsByName.get(name) ?? new Set<string>();
        set.add(shot.id);
        shotIdsByName.set(name, set);
        if (shot.dialogue && (dialogueSampleByName.get(name)?.length ?? 0) < 3) {
          dialogueSampleByName.set(name, [...(dialogueSampleByName.get(name) ?? []), shot.dialogue]);
        }
      }
    }
  }

  // 分组数：restyle_groups 的 shot_ids 覆盖到该角色任一分镜即计入（阶段 B 后续步骤才有分组，通常为 0）。
  const groupCountByName = new Map<string, number>();
  if (episodeIds.length > 0 && allShotIds.length > 0) {
    const { data: groupRows, error: groupError } = await supabase
      .from("restyle_groups")
      .select("shot_ids")
      .in("episode_id", episodeIds);
    if (groupError) return { ok: false, code: "DB_ERROR", error: groupError.message };
    for (const group of (groupRows ?? []) as Array<{ shot_ids: string[] | null }>) {
      const shotIdSet = new Set(group.shot_ids ?? []);
      for (const [name, shotIds] of shotIdsByName) {
        if ([...shotIds].some((id) => shotIdSet.has(id))) {
          groupCountByName.set(name, (groupCountByName.get(name) ?? 0) + 1);
        }
      }
    }
  }

  const stats: CharacterVoiceStat[] = characters.map((row) => ({
    characterId: row.id,
    name: row.name,
    shotCount: shotCountByName.get(row.name) ?? 0,
    groupCount: groupCountByName.get(row.name) ?? 0,
  }));
  const ranked = rankCharacterImportance(stats);

  const scopeHash = computeScopeHash({
    projectId: input.projectId,
    characters: characters.map((row) => ({ name: row.name, description: row.description })),
    stats: ranked.map((stat) => ({ name: stat.name, shots: stat.shotCount, groups: stat.groupCount })),
  });

  // ---- 导演模型产出音色描述 ----
  const context = {
    scope: { projectId: input.projectId },
    characters: ranked.map((stat) => {
      const row = characters.find((character) => character.id === stat.characterId)!;
      return {
        name: row.name,
        description: row.description,
        shotCount: stat.shotCount,
        groupCount: stat.groupCount,
        dialogueSamples: dialogueSampleByName.get(row.name) ?? [],
      };
    }),
  };
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: composePrompt(["character-bible"], JSON.stringify(context, null, 2)),
    },
    { role: "user", content: VOICE_USER_INSTRUCTION },
  ];

  let aiResult = await callChat({
    model: INTERNAL_DIRECTOR_MODEL,
    messages,
    maxTokens: 8_000,
    timeoutMs: 300_000,
    jsonMode: true,
  });
  let usedFallback = false;
  if (!aiResult.ok) {
    usedFallback = true;
    aiResult = await callChat({
      model: INTERNAL_DIRECTOR_FALLBACK_MODEL,
      messages,
      maxTokens: 8_000,
      timeoutMs: 300_000,
      jsonMode: true,
    });
  }
  if (!aiResult.ok) {
    logGenerationError({
      kind: "image",
      provider: "lovable",
      model: INTERNAL_DIRECTOR_MODEL,
      errorMessage: `音色方案调用失败（含回退）: ${aiResult.error}`,
      requestPayload: { projectId: input.projectId, stage: VOICE_PLAN_STAGE },
      userId,
    });
    return { ok: false, code: "AI_CALL_FAILED", error: aiResult.error };
  }

  let parsed: unknown;
  try {
    parsed = extractJson(aiResult.text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logGenerationError({
      kind: "image",
      provider: "lovable",
      model: aiResult.model,
      errorMessage: `音色方案输出解析失败: ${msg}`,
      requestPayload: { projectId: input.projectId, stage: `${VOICE_PLAN_STAGE}_parse` },
      responseBody: aiResult.text.slice(0, 2_000),
      userId,
    });
    return { ok: false, code: "AI_OUTPUT_INVALID", error: msg };
  }

  const voiceByName = normalizeVoicePlan(parsed);
  const now = new Date().toISOString();

  // ---- 写 voice_profile + 产物 ----
  const profiles = ranked.map((stat) => {
    const voice = voiceByName.get(stat.name);
    const profile: VoiceProfile = {
      tier: stat.tier,
      importanceRank: stat.importanceRank,
      shotCount: stat.shotCount,
      groupCount: stat.groupCount,
      voiceDescription: voice?.voiceDescription ?? "",
      referenceEmotion: voice?.referenceEmotion ?? "",
      plan: stat.tier === "重点" ? "reference_video" : "unfixed",
    };
    return { characterId: stat.characterId, name: stat.name, profile };
  });

  for (const { characterId, profile } of profiles) {
    const { error } = await supabase
      .from("restyle_characters")
      .update({ voice_profile: profile, updated_at: now })
      .eq("id", characterId);
    if (error) return { ok: false, code: "DB_ERROR", error: error.message };
  }

  const artifactContent: JsonValue = {
    version: 1,
    generatedAt: now,
    model: aiResult.model,
    usedFallback,
    majorShotThreshold: MAJOR_SHOT_THRESHOLD,
    voiceReferenceVideo: {
      model: RESTYLE_VIDEO_MODEL,
      durationSec: VOICE_REFERENCE_DURATION_SEC,
      resolution: VOICE_REFERENCE_RESOLUTION,
      estimatedCreditsPerVideo: voiceReferenceVideoCost(),
    },
    profiles: profiles.map(({ name, profile }) => ({ character: name, ...profile })) as unknown as JsonValue,
  };
  const upserted = await upsertArtifact(
    supabase, userId, input.projectId, VOICE_PLAN_STAGE, VOICE_NODE_KEY, artifactContent, scopeHash,
  );
  if (upserted.error) return { ok: false, code: "DB_ERROR", error: upserted.error };

  const charge =
    deps.chargeCredits ?? ((params: { amount: number; model?: string; description: string; idempotencyKey?: string }) => defaultCharge(supabase, userId, params));
  await charge({
    amount: VOICE_PLAN_CREDIT_COST,
    model: aiResult.model,
    description: "转绘音色方案",
    idempotencyKey: `voice-plan:${input.projectId}:${scopeHash}`,
  });

  return {
    ok: true,
    projectId: input.projectId,
    scopeHash,
    profileCount: profiles.length,
    majorCount: profiles.filter((p) => p.profile.tier === "重点").length,
    model: aiResult.model,
    usedFallback,
  };
}

/** 确认音色方案：产物置 user_approved；userContent.profiles 改写同步回写 voice_profile。 */
export async function confirmVoicePlanCore(
  input: z.infer<typeof ConfirmArtifactInputSchema>,
  deps: ImageGenDeps,
): Promise<ConfirmResult> {
  const { supabase, userId } = deps;
  const approved = await approveArtifactRow(
    supabase, userId, input.projectId, VOICE_PLAN_STAGE, VOICE_NODE_KEY, input.userContent,
  );
  if (approved.error) return { ok: false, code: "DB_ERROR", error: approved.error };
  if (approved.notFound) {
    return { ok: false, code: "ARTIFACT_NOT_FOUND", error: "音色方案产物不存在，请先生成方案。" };
  }

  if (input.userContent !== undefined) {
    const root =
      input.userContent && typeof input.userContent === "object" && !Array.isArray(input.userContent)
        ? (input.userContent as Record<string, unknown>)
        : {};
    const edited = asRecordArray(root.profiles);
    if (edited.length > 0) {
      const charactersResult = await readCharacters(supabase, input.projectId);
      if (charactersResult.error) return { ok: false, code: "DB_ERROR", error: charactersResult.error };
      const idByName = new Map(charactersResult.rows!.map((row) => [row.name, row.id]));
      const now = new Date().toISOString();
      for (const row of edited) {
        const name = pickString(row, "character", "name");
        const characterId = idByName.get(name);
        if (!characterId) continue;
        const tier = pickString(row, "tier") === "重点" ? ("重点" as const) : ("次要" as const);
        const planRaw = pickString(row, "plan");
        const profile: VoiceProfile = {
          tier,
          importanceRank: typeof row.importanceRank === "number" ? row.importanceRank : 0,
          shotCount: typeof row.shotCount === "number" ? row.shotCount : 0,
          groupCount: typeof row.groupCount === "number" ? row.groupCount : 0,
          voiceDescription: pickString(row, "voiceDescription", "voice_description"),
          referenceEmotion: pickString(row, "referenceEmotion", "reference_emotion"),
          plan:
            planRaw === "reference_video" || planRaw === "upload_audio" || planRaw === "unfixed"
              ? planRaw
              : tier === "重点"
                ? "reference_video"
                : "unfixed",
        };
        const { error } = await supabase
          .from("restyle_characters")
          .update({ voice_profile: profile, updated_at: now })
          .eq("id", characterId);
        if (error) return { ok: false, code: "DB_ERROR", error: error.message };
      }
    }
  }
  return { ok: true, artifact: approved.state! };
}

/** 生成音色参考视频：仅重点角色，调现有视频通道（图生视频 + 出声）。 */
export async function generateVoiceReferenceVideoCore(
  input: z.infer<typeof GenerateVoiceVideoInputSchema>,
  deps: ImageGenDeps,
): Promise<GenerateVoiceVideoResult> {
  const { supabase, userId } = deps;
  const ensureCredits = deps.ensureCredits ?? ensureEnoughCredits;
  const generateVideoFn =
    deps.generateVideo ??
    (async (videoInput: {
      prompt: string;
      imageUrl?: string;
      model?: string;
      ratio?: string;
      duration?: number;
      resolution?: string;
      generateAudio?: boolean;
    }) => {
      const { generateVideo } = await import("../videoGenerate.functions");
      return (await generateVideo({ data: videoInput })) as GenerateVideoResult;
    });

  // ---- 1. 闸门：音色方案须已确认 ----
  const voiceArtifact = await fetchArtifactRow(supabase, input.projectId, VOICE_PLAN_STAGE, VOICE_NODE_KEY);
  if (voiceArtifact.error) return { ok: false, code: "DB_ERROR", error: voiceArtifact.error };
  if (!voiceArtifact.row || voiceArtifact.row.status !== "user_approved") {
    return { ok: false, code: "STAGE_NOT_APPROVED", pending: [`${VOICE_PLAN_STAGE}/${VOICE_NODE_KEY}`] };
  }

  // ---- 2. 校验角色范围：仅重点角色 + 已有主图 ----
  const charactersResult = await readCharacters(supabase, input.projectId);
  if (charactersResult.error) return { ok: false, code: "DB_ERROR", error: charactersResult.error };
  const wanted = new Set(input.characterIds);
  const targets = charactersResult.rows!.filter((row) => wanted.has(row.id));
  if (targets.length === 0) {
    return { ok: false, code: "NO_CHARACTERS", error: "所选角色不存在。" };
  }
  const failures: VoiceVideoFailure[] = [];
  const eligible: Array<{ row: CharacterRow; profile: VoiceProfile }> = [];
  for (const row of targets) {
    const profile = (row.voice_profile ?? null) as VoiceProfile | null;
    if (!profile || profile.tier !== "重点") {
      failures.push({
        characterId: row.id,
        characterName: row.name,
        error: "仅重点角色可生成音色参考视频（次要角色请上传音频或不固定音色）。",
      });
      continue;
    }
    if (!row.main_image_url) {
      failures.push({
        characterId: row.id,
        characterName: row.name,
        error: "该角色还没有主图，请先生成角色图片。",
      });
      continue;
    }
    eligible.push({ row, profile });
  }
  if (eligible.length === 0) {
    return { ok: false, code: "NO_ELIGIBLE_CHARACTERS", error: "所选角色均不满足生成条件。", };
  }

  // ---- 3. 积分预校验（总额；实际扣费由视频通道成功时按 taskId 幂等扣）----
  const perVideoCredits = voiceReferenceVideoCost();
  const guard = await ensureCredits(
    perVideoCredits === null ? null : perVideoCredits * eligible.length,
    { kind: "video", model: RESTYLE_VIDEO_MODEL },
  );
  if (!guard.ok) return { ok: false, code: "INSUFFICIENT_CREDITS", error: guard.error };

  // ---- 4. 逐角色生成（串行；视频通道内部自带轮询与成功扣费）----
  let generated = 0;
  for (const { row, profile } of eligible) {
    const result = await generateVideoFn({
      prompt: buildVoiceReferencePrompt(toCharacterPromptSource(row), profile),
      imageUrl: row.main_image_url!,
      model: RESTYLE_VIDEO_MODEL,
      ratio: "9:16",
      duration: VOICE_REFERENCE_DURATION_SEC,
      resolution: VOICE_REFERENCE_RESOLUTION,
      generateAudio: true,
    });
    if (!result.ok || !result.videoUrl) {
      const message = result.error || "视频生成失败";
      logGenerationError({
        kind: "video",
        provider: "ark",
        model: RESTYLE_VIDEO_MODEL,
        errorMessage: `音色参考视频生成失败(${row.name}): ${message}`,
        requestPayload: { projectId: input.projectId, characterId: row.id, stage: VOICE_PLAN_STAGE },
        userId,
      });
      failures.push({ characterId: row.id, characterName: row.name, error: message });
      continue;
    }
    const nextProfile: VoiceProfile = {
      ...profile,
      plan: "reference_video",
      referenceVideoUrl: result.videoUrl,
      referenceVideoTaskId: result.taskId ?? null,
    };
    const { error } = await supabase
      .from("restyle_characters")
      .update({
        voice_profile: nextProfile,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) {
      failures.push({ characterId: row.id, characterName: row.name, error: `视频已生成但写库失败：${error.message}` });
      continue;
    }
    generated += 1;
  }

  return {
    ok: true,
    projectId: input.projectId,
    generated,
    perVideoCredits,
    failures,
  };
}

// --------------------------------------------------------------------
// 读回（面板数据源）
// --------------------------------------------------------------------

export interface ImageGenCharacterRow {
  id: string;
  name: string;
  identity_lock: string | null;
  clothing: string | null;
  main_image_url: string | null;
  turnaround_url: string | null;
  voice_profile: JsonValue | null;
  status: string;
}

export interface ImageGenLookRow {
  id: string;
  character_id: string;
  name: string;
  from_shot: string | null;
  to_shot: string | null;
  redesign_reason: string | null;
  reuse_existing: boolean | null;
  reuse_source: string | null;
  front_url: string | null;
  back_url: string | null;
  side_url: string | null;
  image_url: string | null;
}

export interface ImageGenArtifactInfo {
  status: string;
  verdict: string | null;
  issues: JsonValue[] | null;
  content: JsonValue;
  user_content: JsonValue;
  revision: number;
  scope_hash: string | null;
}

export interface ImageGenData {
  characters: ImageGenCharacterRow[];
  looks: ImageGenLookRow[];
  looksArtifact: ImageGenArtifactInfo | null;
  promptsArtifact: ImageGenArtifactInfo | null;
  voiceArtifact: ImageGenArtifactInfo | null;
  voiceReferenceVideo: {
    model: string;
    durationSec: number;
    resolution: string;
    estimatedCreditsPerVideo: number | null;
  };
}

export type ListImageGenResult =
  | { ok: true; error: null; data: ImageGenData }
  | { ok: false; error: string };

async function fetchArtifactInfo(
  supabase: any,
  projectId: string,
  stage: string,
  nodeKey: string,
) {
  const { data, error } = await supabase
    .from("restyle_artifacts")
    .select("status, verdict, issues, content, user_content, revision, scope_hash")
    .eq("project_id", projectId)
    .eq("stage", stage)
    .eq("node_key", nodeKey)
    .maybeSingle();
  if (error) return { info: null as ImageGenArtifactInfo | null, error: error.message };
  return { info: (data as ImageGenArtifactInfo | null) ?? null, error: null };
}

export async function listImageGenCore(
  input: z.infer<typeof ListImageGenInputSchema>,
  deps: SupabaseContext,
): Promise<ListImageGenResult> {
  const { supabase } = deps;
  const charactersResult = await readCharacters(supabase, input.projectId);
  if (charactersResult.error) return { ok: false, error: charactersResult.error };
  const characters = charactersResult.rows!;
  const characterIds = characters.map((row) => row.id);

  let looks: ImageGenLookRow[] = [];
  if (characterIds.length > 0) {
    const { data: lookRows, error: lookError } = await supabase
      .from("restyle_character_looks")
      .select(
        "id, character_id, name, from_shot, to_shot, redesign_reason, reuse_existing, reuse_source, front_url, back_url, side_url, image_url",
      )
      .in("character_id", characterIds)
      .order("created_at", { ascending: true });
    if (lookError) return { ok: false, error: lookError.message };
    looks = (lookRows ?? []) as ImageGenLookRow[];
  }

  const [looksArtifact, promptsArtifact, voiceArtifact] = await Promise.all([
    fetchArtifactInfo(supabase, input.projectId, IMAGE_GEN_STAGE, LOOKS_NODE_KEY),
    fetchArtifactInfo(supabase, input.projectId, IMAGE_GEN_STAGE, PROMPTS_NODE_KEY),
    fetchArtifactInfo(supabase, input.projectId, VOICE_PLAN_STAGE, VOICE_NODE_KEY),
  ]);
  const firstError = looksArtifact.error ?? promptsArtifact.error ?? voiceArtifact.error;
  if (firstError) return { ok: false, error: firstError };

  // 读时重签：库里存的签名 URL 7 天过期，过期后前端裂图。
  const [resignedCharacters, resignedLooks] = await Promise.all([
    resignMediaDeep(supabase, characters as ImageGenCharacterRow[]),
    resignMediaDeep(supabase, looks),
  ]);

  return {
    ok: true,
    error: null,
    data: {
      characters: resignedCharacters,
      looks: resignedLooks,
      looksArtifact: looksArtifact.info,
      promptsArtifact: promptsArtifact.info,
      voiceArtifact: voiceArtifact.info,
      voiceReferenceVideo: {
        model: RESTYLE_VIDEO_MODEL,
        durationSec: VOICE_REFERENCE_DURATION_SEC,
        resolution: VOICE_REFERENCE_RESOLUTION,
        estimatedCreditsPerVideo: voiceReferenceVideoCost(),
      },
    },
  };
}
