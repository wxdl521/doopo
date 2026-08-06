// ====================================================================
//  转绘 v2 阶段一 · 原视频分析 —— restyleVideoAnalysis.functions.ts
//
//  双通道流水线（参考需求文档「阶段一」与竞品样本「分析过程」）：
//    a) 视觉通道：关键帧 image_url parts → INTERNAL_VISION_MODEL，
//       输出构图/运镜/光影/色彩/节奏/概览/叙事/人物(含人设+成对关系)/
//       场景/道具(仅文字)/原片分镜 shots（单元内毫秒时间码）。
//    b) ASR 通道：audioUrl 拉取转 base64，以 OpenAI 兼容 input_audio
//       content part 喂同一视觉模型，输出逐句台词。
//  切片/抽帧/音频提取由前端完成后上传 workspace-media，本模块只消费 URL。
//  拼回/对齐的纯函数在 analysisMerge.ts；prompt 规约复用 skills/ 的
//  composePrompt（video-analysis-extract / audio-transcript-align）。
//
//  注意：skills/video-analysis-extract.md 里 shot 时间码口径是「秒」，
//  本模块在 outputContract 里显式覆盖为「单元内相对毫秒」，与
//  restyle_shots.start_ms/end_ms 列对齐。
// ====================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ensureEnoughCredits } from "../creditsGuard";
import { chargeCredits } from "../userCredits.functions";
import { logGenerationError } from "../errorLogs.server";
import { assertContentLengthWithin, assertPublicHttpsUrl } from "./ssrfGuard";
import {
  callLovableChat,
  INTERNAL_VISION_MODEL,
  type ChatMessage,
  type GatewayChatResult,
} from "./lovableGateway";
import { composePrompt } from "./skills";
import {
  alignTranscript,
  mergeUnitsByOffset,
  type AsrSentence,
  type MergedShot,
  type UnitAnalysisJson,
  type UnitAnalysisPart,
} from "./analysisMerge";

type SupabaseContext = { supabase: any; userId: string };

/** 单元分析并发上限（需求文档固定为 2，不引依赖自实现 promise 池）。 */
export const UNIT_ANALYSIS_CONCURRENCY = 2;

// --------------------------------------------------------------------
// 入参 schema
// --------------------------------------------------------------------

// 导出供 v1 单元化分析函数（restyleSourceUnits.functions.ts）复用同一契约。
export const UnitInputSchema = z.object({
  unitId: z.string().min(1).max(128),
  videoUrl: z.string().url(),
  audioUrl: z.string().url().optional(),
  unitStartOffsetSec: z.number().min(0),
  sourceStartSeconds: z.number().min(0),
  durationSec: z.number().positive(),
  frameUrls: z.array(z.string().url()).min(1).max(200),
});

const SubmitInputSchema = z.object({
  projectId: z.string().min(1).max(128),
  episodeId: z.string().min(1).max(128),
  units: z.array(UnitInputSchema).min(1).max(100),
  /** 仅重跑指定单元（失败单元重试）；缺省跑全部。 */
  unitIds: z.array(z.string().min(1)).max(100).optional(),
});

const ProgressInputSchema = z.object({
  projectId: z.string().min(1).max(128),
});

export type UnitMediaInput = z.infer<typeof UnitInputSchema>;

// --------------------------------------------------------------------
// 单元状态（写入 restyle_episodes.analysis_units）
// --------------------------------------------------------------------

export type UnitStatus = "pending" | "running" | "succeeded" | "failed";

export interface UnitState {
  unitId: string;
  unitStartOffsetSec: number;
  sourceStartSeconds: number;
  durationSec: number;
  status: UnitStatus;
  error: string | null;
  /** 降级标记：无音轨 / input_audio 被网关拒绝。 */
  degraded?: "no_audio" | "input_audio_rejected" | null;
}

// --------------------------------------------------------------------
// 视觉通道 prompt
// --------------------------------------------------------------------

/** 输出契约：显式覆盖 skill 的秒口径，统一为单元内相对毫秒。 */
const VISION_OUTPUT_CONTRACT = `输出 JSON 顶层字段（所有时间码为单元内相对毫秒整数，从 0 开始）：
- composition / camera / lighting / color / rhythm：五段视觉分析（字符串）
- overview：本单元整片理解摘要（不超过 120 字）
- narrative：{ "act": string, "events": string[], "causality": string }
- characters：[{ "name", "aliases": string[], "firstSeenSeconds", "lastSeenSeconds", "role", "appearance", "wardrobe", "description", "relationships": [{ "relatedName", "relation" }], "uncertainty": string[] }]（含人设与成对关系，仅文字）
- scenes：[{ "name", "description", "firstSeenSeconds", "lastSeenSeconds" }]
- props：[{ "name", "description", "firstSeenSeconds", "lastSeenSeconds" }]（仅文字，不生图）
- shots：[{ "shot_no"(SC001 起递增), "start_ms", "end_ms", "shot_type", "spatial_anchor", "end_state_action", "scene_type"(环境场面|对白场面|动作场面|高燃场面), "voice_type"(张嘴说话|内心os|旁白|无), "emotion", "characters": string[], "dialogue" }]`;

/** 降级路径追加字段：无独立音轨时由视觉通道顺带产出台词轨。 */
const DIALOGUE_FALLBACK_CONTRACT = `- dialogue_track：[{ "begin_ms", "end_ms", "text", "speaker" }]（降级路径：本单元无独立音轨，请从关键帧的口型/画面内字幕/上下文推断台词；听不清的片段用 … 占位）`;

function buildVisionMessages(unit: UnitMediaInput, includeDialogueTrack: boolean): ChatMessage[] {
  const context = {
    analysisUnitId: unit.unitId,
    unitTimeRange: {
      unitStartOffsetSec: unit.unitStartOffsetSec,
      sourceStartSeconds: unit.sourceStartSeconds,
      durationSec: unit.durationSec,
    },
    frameCount: unit.frameUrls.length,
    outputContract:
      VISION_OUTPUT_CONTRACT + (includeDialogueTrack ? `\n${DIALOGUE_FALLBACK_CONTRACT}` : ""),
  };
  const system = composePrompt(["video-analysis-extract"], JSON.stringify(context, null, 2));
  const userContent: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `以下是分析单元 ${unit.unitId} 的 ${unit.frameUrls.length} 张按时间顺序排列的关键帧（单元时长 ${unit.durationSec}s）。请按 system 中的输出契约输出本单元视觉分析 JSON，只输出 JSON。`,
    },
    ...unit.frameUrls.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
  return [
    { role: "system", content: system },
    { role: "user", content: userContent },
  ];
}

// --------------------------------------------------------------------
// ASR 通道 prompt
// --------------------------------------------------------------------

function buildAsrMessages(
  unit: UnitMediaInput,
  audio: { data: string; format: string },
): ChatMessage[] {
  const context = {
    analysisUnitId: unit.unitId,
    unitTimeRange: {
      unitStartOffsetSec: unit.unitStartOffsetSec,
      sourceStartSeconds: unit.sourceStartSeconds,
      durationSec: unit.durationSec,
    },
    note: "直接对输入音频做语音识别（本调用没有 asrSentences/shots 输入，与 shot 的对齐由系统完成）。只输出 JSON：{ \"sentences\": [{ \"begin_ms\", \"end_ms\", \"text\", \"speaker\", \"confidence\" }] }，时间码为单元内相对毫秒整数；说话人无法确定填 unknown。",
  };
  const system = composePrompt(["audio-transcript-align"], JSON.stringify(context, null, 2));
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        { type: "text", text: `请识别分析单元 ${unit.unitId} 的音频，按契约输出逐句台词 JSON。` },
        { type: "input_audio", input_audio: { data: audio.data, format: audio.format } },
      ],
    },
  ];
}

/**
 * ASR 降级路径：网关拒绝 input_audio（HTTP 400 且报错提及 input_audio）时，
 * 退回关键帧 + audio-transcript-align 规约，让视觉模型从画面推断台词轨。
 * 无 audioUrl 时不走这里——dialogue_track 要求已并入主视觉通道 prompt。
 */
function buildDegradedDialogueMessages(unit: UnitMediaInput): ChatMessage[] {
  const context = {
    analysisUnitId: unit.unitId,
    unitTimeRange: {
      unitStartOffsetSec: unit.unitStartOffsetSec,
      sourceStartSeconds: unit.sourceStartSeconds,
      durationSec: unit.durationSec,
    },
    degraded: "input_audio_rejected",
    note: "网关拒绝了 input_audio 音频输入，降级为从关键帧画面（口型/字幕/上下文）推断台词轨。只输出 JSON：{ \"sentences\": [{ \"begin_ms\", \"end_ms\", \"text\", \"speaker\" }] }，单元内相对毫秒整数；无法推断的留空数组，不猜测。",
  };
  const system = composePrompt(["audio-transcript-align"], JSON.stringify(context, null, 2));
  const userContent: Array<Record<string, unknown>> = [
    { type: "text", text: `以下是分析单元 ${unit.unitId} 的关键帧，请按契约推断台词轨 JSON。` },
    ...unit.frameUrls.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
  return [
    { role: "system", content: system },
    { role: "user", content: userContent },
  ];
}

// --------------------------------------------------------------------
// 工具函数
// --------------------------------------------------------------------

/** 自实现的并发池：最多 limit 个 worker 消费同一队列。 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

/** 从模型文本中提取 JSON（容忍 ```json 围栏与前后杂散文本）。 */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.search(/[{[]/);
  if (start === -1) throw new Error("模型输出中未找到 JSON");
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  const end = cleaned.lastIndexOf(close);
  if (end <= start) throw new Error("模型输出 JSON 不完整");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** 网关 HTTP 400 且报错提及 input_audio → 判定为音频输入不被接受。 */
export function isInputAudioRejected(error: string): boolean {
  return /HTTP 400/.test(error) && /input_audio/i.test(error);
}

function audioFormatFromUrl(url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  if (["wav", "mp3", "m4a", "aac", "ogg", "flac", "webm"].includes(ext)) return ext;
  return "mp3";
}

/** 网关对单条消息体积有限制，超过 25MB 的音频不内联 base64。 */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

async function fetchAudioBase64(
  fetchFn: typeof fetch,
  url: string,
): Promise<{ data: string; format: string }> {
  // SSRF 收敛：audioUrl 来自客户端，仅允许 https 公网地址，60s 超时。
  assertPublicHttpsUrl(url);
  const res = await fetchFn(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`音频拉取失败 HTTP ${res.status}`);
  // arrayBuffer 之前先按 Content-Length 预检，超限不下载。
  assertContentLengthWithin(res, MAX_AUDIO_BYTES);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_AUDIO_BYTES) {
    throw new Error(`音频体积 ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB 超过 25MB 上限`);
  }
  return { data: Buffer.from(buf).toString("base64"), format: audioFormatFromUrl(url) };
}

/** 宽松解析逐句台词：接受数组、{sentences:[...]} 或 {dialogue_track:[...]}。 */
function parseSentences(json: unknown): AsrSentence[] {
  const list = Array.isArray(json)
    ? json
    : ((json as { sentences?: unknown[]; dialogue_track?: unknown[] })?.sentences ??
      (json as { dialogue_track?: unknown[] })?.dialogue_track ??
      []);
  if (!Array.isArray(list)) return [];
  const out: AsrSentence[] = [];
  for (const raw of list) {
    const s = raw as Record<string, unknown>;
    const begin = Number(s.begin_ms ?? s.begin_time ?? 0);
    const end = Number(s.end_ms ?? s.end_time ?? begin);
    const text = typeof s.text === "string" ? s.text : "";
    if (!text || !Number.isFinite(begin) || !Number.isFinite(end)) continue;
    const sentence: AsrSentence = {
      begin_ms: Math.round(begin),
      end_ms: Math.round(end),
      text,
      speaker: typeof s.speaker === "string" ? s.speaker : "unknown",
    };
    if (typeof s.confidence === "number") sentence.confidence = s.confidence;
    out.push(sentence);
  }
  return out;
}

// --------------------------------------------------------------------
// 单单元双通道分析
// --------------------------------------------------------------------

export interface UnitRunResult {
  unitId: string;
  ok: boolean;
  analysis?: UnitAnalysisJson;
  /** 单元内相对毫秒的逐句台词。 */
  transcript?: AsrSentence[];
  degraded?: "no_audio" | "input_audio_rejected" | null;
  error?: string;
}

export interface AnalysisDeps {
  /** 默认 callLovableChat；测试可注入假实现。 */
  callChat?: (opts: {
    model: string;
    messages: ChatMessage[];
    maxTokens?: number;
    timeoutMs?: number;
    jsonMode?: boolean;
  }) => Promise<GatewayChatResult>;
  /** 拉音频用，默认全局 fetch。 */
  fetchFn?: typeof fetch;
  visionModel?: string;
}

/** 永不抛错：任何失败都收敛为 { ok:false, error }，由上层决定整集成败。 */
async function analyzeOneUnit(unit: UnitMediaInput, deps: AnalysisDeps): Promise<UnitRunResult> {
  const callChat = deps.callChat ?? callLovableChat;
  const fetchFn = deps.fetchFn ?? fetch;
  const visionModel = deps.visionModel ?? INTERNAL_VISION_MODEL;
  try {
    // a) 视觉通道。无 audioUrl 时把台词轨要求并入本 prompt（降级路径①）。
    const noAudio = !unit.audioUrl;
    const visionRes = await callChat({
      model: visionModel,
      messages: buildVisionMessages(unit, noAudio),
      maxTokens: 16_000,
      timeoutMs: 300_000,
      jsonMode: true,
    });
    if (!visionRes.ok) {
      return { unitId: unit.unitId, ok: false, error: `视觉通道失败: ${visionRes.error}` };
    }
    let analysis: UnitAnalysisJson;
    try {
      const parsed = extractJson(visionRes.text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("顶层不是 JSON 对象");
      }
      analysis = parsed as UnitAnalysisJson;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { unitId: unit.unitId, ok: false, error: `视觉通道输出解析失败: ${msg}` };
    }

    let transcript: AsrSentence[] = [];
    let degraded: UnitRunResult["degraded"] = null;

    // b) ASR 通道
    if (noAudio) {
      degraded = "no_audio";
      transcript = parseSentences(analysis.dialogue_track ?? []);
    } else {
      try {
        const audio = await fetchAudioBase64(fetchFn, unit.audioUrl!);
        const asrRes = await callChat({
          model: visionModel,
          messages: buildAsrMessages(unit, audio),
          maxTokens: 8_000,
          timeoutMs: 300_000,
          jsonMode: true,
        });
        if (asrRes.ok) {
          transcript = parseSentences(extractJson(asrRes.text));
        } else if (isInputAudioRejected(asrRes.error)) {
          // 降级路径②：input_audio 被拒 → 关键帧推断台词轨
          degraded = "input_audio_rejected";
          const fallbackRes = await callChat({
            model: visionModel,
            messages: buildDegradedDialogueMessages(unit),
            maxTokens: 8_000,
            timeoutMs: 300_000,
            jsonMode: true,
          });
          if (fallbackRes.ok) {
            transcript = parseSentences(extractJson(fallbackRes.text));
          } else {
            analysis.asr_warning = `台词轨降级调用失败: ${fallbackRes.error}`;
          }
        } else {
          // ASR 其他失败不判单元失败：台词可后补，记入分析 JSON 警告
          analysis.asr_warning = `ASR 通道失败: ${asrRes.error}`;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        analysis.asr_warning = `ASR 通道异常: ${msg}`;
      }
    }

    return { unitId: unit.unitId, ok: true, analysis, transcript, degraded };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { unitId: unit.unitId, ok: false, error: `单元分析异常: ${msg}` };
  }
}

/** 并发上限 2 逐单元跑双通道，返回与入参同序的结果数组。 */
export async function analyzeEpisodeUnits(
  units: UnitMediaInput[],
  deps: AnalysisDeps = {},
): Promise<UnitRunResult[]> {
  return runWithConcurrency(units, UNIT_ANALYSIS_CONCURRENCY, (unit) =>
    analyzeOneUnit(unit, deps),
  );
}

// --------------------------------------------------------------------
// 整集拼装（merge + 台词对齐 + 原片资产归并）
// --------------------------------------------------------------------

export type EpisodeSentence = AsrSentence & { unitId?: string; sentence_id?: string };
export type AlignedEpisodeSentence = EpisodeSentence & { shot_no: string | null };

export interface MergedSourceAsset {
  kind: "character" | "scene" | "prop";
  source_name: string;
  aliases: string[];
  first_seen_ms: number | null;
  last_seen_ms: number | null;
  appearance: string | null;
  wardrobe: string | null;
  description: string | null;
  relationships: unknown[];
  uncertainty: unknown[];
}

export interface EpisodeAnalysisAssembled {
  overview: string;
  shots: MergedShot[];
  transcript: AlignedEpisodeSentence[];
  orphanTranscript: AlignedEpisodeSentence[];
  assets: MergedSourceAsset[];
  warnings: string[];
}

type RawUnitAsset = {
  name?: string;
  sourceNameOrLabel?: string;
  aliases?: string[];
  aliasesObserved?: string[];
  firstSeenSeconds?: number;
  lastSeenSeconds?: number;
  firstSeenTimeRange?: { startSeconds?: number; endSeconds?: number };
  lastSeenTimeRange?: { startSeconds?: number; endSeconds?: number };
  appearance?: string;
  wardrobe?: string;
  description?: string;
  sourceRole?: string;
  storyFunction?: string;
  relationships?: unknown[];
  uncertainty?: unknown[];
};

function assetArray(analysis: UnitAnalysisJson, keys: string[]): RawUnitAsset[] {
  for (const key of keys) {
    const value = analysis[key];
    if (Array.isArray(value)) return value as RawUnitAsset[];
  }
  return [];
}

/** 跨单元归并原片资产：同名合并，首/末出现时间码换算为集级毫秒。 */
export function collectSourceAssets(parts: UnitAnalysisPart[]): MergedSourceAsset[] {
  const merged = new Map<string, MergedSourceAsset>();
  const ingest = (
    kind: MergedSourceAsset["kind"],
    raw: RawUnitAsset,
    offsetMs: number,
  ): void => {
    const name = (raw.name ?? raw.sourceNameOrLabel ?? "").trim();
    if (!name) return;
    const firstSec = raw.firstSeenTimeRange?.startSeconds ?? raw.firstSeenSeconds;
    const lastSec =
      raw.lastSeenTimeRange?.endSeconds ?? raw.lastSeenSeconds ?? raw.firstSeenTimeRange?.endSeconds;
    const firstMs = typeof firstSec === "number" ? Math.round(firstSec * 1000) + offsetMs : null;
    const lastMs = typeof lastSec === "number" ? Math.round(lastSec * 1000) + offsetMs : null;
    const key = `${kind}:${name}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        kind,
        source_name: name,
        aliases: raw.aliases ?? raw.aliasesObserved ?? [],
        first_seen_ms: firstMs,
        last_seen_ms: lastMs,
        appearance: raw.appearance ?? null,
        wardrobe: raw.wardrobe ?? null,
        description:
          raw.description ??
          ([raw.sourceRole, raw.storyFunction].filter(Boolean).join("；") || null),
        relationships: raw.relationships ?? [],
        uncertainty: raw.uncertainty ?? [],
      });
      return;
    }
    if (firstMs !== null && (existing.first_seen_ms === null || firstMs < existing.first_seen_ms)) {
      existing.first_seen_ms = firstMs;
    }
    if (lastMs !== null && (existing.last_seen_ms === null || lastMs > existing.last_seen_ms)) {
      existing.last_seen_ms = lastMs;
    }
    existing.aliases = [...new Set([...existing.aliases, ...(raw.aliases ?? raw.aliasesObserved ?? [])])];
    if (Array.isArray(raw.relationships) && raw.relationships.length > 0) {
      existing.relationships = raw.relationships;
    }
    existing.uncertainty = [...existing.uncertainty, ...(raw.uncertainty ?? [])];
  };

  for (const part of parts) {
    const offsetMs = Math.round(part.unitStartOffsetSec * 1000);
    for (const c of assetArray(part.analysis, ["characters", "sourceCharacters"])) {
      ingest("character", c, offsetMs);
    }
    for (const s of assetArray(part.analysis, ["scenes", "sourceScenes"])) {
      ingest("scene", s, offsetMs);
    }
    for (const p of assetArray(part.analysis, ["props", "sourceProps"])) {
      ingest("prop", p, offsetMs);
    }
  }
  return [...merged.values()];
}

/**
 * 把「本轮新跑 + 历史已成功」的单元分析拼成整集结果。
 * units 提供全部单元的偏移；analysisByUnit / transcriptByUnit 只含成功单元。
 */
export function assembleEpisodeAnalysis(
  units: Array<{ unitId: string; unitStartOffsetSec: number }>,
  analysisByUnit: ReadonlyMap<string, UnitAnalysisJson>,
  transcriptByUnit: ReadonlyMap<string, AsrSentence[]>,
): EpisodeAnalysisAssembled {
  const ordered = [...units].sort((a, b) => a.unitStartOffsetSec - b.unitStartOffsetSec);
  const parts: UnitAnalysisPart[] = ordered
    .filter((u) => analysisByUnit.has(u.unitId))
    .map((u) => ({
      unitId: u.unitId,
      unitStartOffsetSec: u.unitStartOffsetSec,
      analysis: analysisByUnit.get(u.unitId)!,
    }));

  const merged = mergeUnitsByOffset(parts);

  const sentences: EpisodeSentence[] = [];
  for (const u of ordered) {
    const offsetMs = Math.round(u.unitStartOffsetSec * 1000);
    const list = transcriptByUnit.get(u.unitId) ?? [];
    list.forEach((s, i) => {
      sentences.push({
        ...s,
        begin_ms: s.begin_ms + offsetMs,
        end_ms: s.end_ms + offsetMs,
        unitId: u.unitId,
        sentence_id: `${u.unitId}-S${String(i + 1).padStart(3, "0")}`,
      });
    });
  }
  const { aligned, orphans } = alignTranscript(sentences, merged.shots);

  const overview = parts
    .map((p) => (typeof p.analysis.overview === "string" ? p.analysis.overview.trim() : ""))
    .filter(Boolean)
    .join(" / ");

  return {
    overview,
    shots: merged.shots,
    transcript: aligned as AlignedEpisodeSentence[],
    orphanTranscript: orphans as AlignedEpisodeSentence[],
    assets: collectSourceAssets(parts),
    warnings: merged.warnings,
  };
}

// --------------------------------------------------------------------
// 写库
// --------------------------------------------------------------------

async function batchInsert(
  supabase: any,
  table: string,
  rows: Array<Record<string, unknown>>,
): Promise<string | null> {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + CHUNK));
    if (error) return error.message;
  }
  return null;
}

async function replaceEpisodeDerivedRows(
  supabase: any,
  userId: string,
  episodeId: string,
  assembled: EpisodeAnalysisAssembled,
): Promise<string | null> {
  // 2026-08 审计加固:先插后删 —— 新行带统一 created_at 作为批次标记,
  // 全部插入成功后才删除 created_at < 批次的旧行;中途失败回滚本批次新行,
  // 旧数据不丢(旧逻辑先删后插,插入失败会把该集派生数据清空)。
  const now = new Date().toISOString();
  const TABLES = ["restyle_shots", "restyle_transcripts", "restyle_source_assets"] as const;

  const shotRows = assembled.shots.map((s) => ({
    id: `shot_${crypto.randomUUID()}`,
    user_id: userId,
    episode_id: episodeId,
    shot_no: s.shot_no,
    start_ms: s.start_ms,
    end_ms: s.end_ms,
    shot_type: s.shot_type ?? null,
    spatial_anchor: s.spatial_anchor ?? null,
    end_state_action: s.end_state_action ?? null,
    scene_type: s.scene_type ?? null,
    voice_type: s.voice_type ?? null,
    emotion: s.emotion ?? null,
    characters: s.characters ?? [],
    dialogue: typeof s.dialogue === "string" ? s.dialogue : null,
    created_at: now,
  }));
  const transcriptRows = [...assembled.transcript, ...assembled.orphanTranscript].map((s) => ({
    id: `tr_${crypto.randomUUID()}`,
    user_id: userId,
    episode_id: episodeId,
    unit_id: s.unitId ?? null,
    sentence_id: s.sentence_id ?? null,
    begin_ms: s.begin_ms,
    end_ms: s.end_ms,
    text: s.text,
    speaker: s.speaker ?? null,
    confidence: s.confidence ?? null,
    created_at: now,
  }));
  const assetRows = assembled.assets.map((a) => ({
    id: `asset_${crypto.randomUUID()}`,
    user_id: userId,
    episode_id: episodeId,
    kind: a.kind,
    source_name: a.source_name,
    aliases: a.aliases,
    first_seen_ms: a.first_seen_ms,
    last_seen_ms: a.last_seen_ms,
    appearance: a.appearance,
    wardrobe: a.wardrobe,
    description: a.description,
    relationships: a.relationships,
    uncertainty: a.uncertainty,
    created_at: now,
  }));

  // 1) 插入新批次;任何一步失败,回滚已插入的本批次行,旧数据保持不动
  const inserts: Array<[(typeof TABLES)[number], Array<Record<string, unknown>>]> = [
    ["restyle_shots", shotRows],
    ["restyle_transcripts", transcriptRows],
    ["restyle_source_assets", assetRows],
  ];
  const insertedTables: Array<(typeof TABLES)[number]> = [];
  for (const [table, rows] of inserts) {
    const insertError = await batchInsert(supabase, table, rows);
    if (insertError) {
      for (const t of insertedTables) {
        await supabase
          .from(t)
          .delete()
          .eq("episode_id", episodeId)
          .gte("created_at", now);
      }
      return `写入 ${table} 失败: ${insertError}`;
    }
    insertedTables.push(table);
  }

  // 2) 新批次就位后再删旧行(created_at 早于本批次的即旧数据)
  for (const table of TABLES) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("episode_id", episodeId)
      .lt("created_at", now);
    if (error) return `清理 ${table} 旧数据失败: ${error.message}`;
  }

  return null;
}

// --------------------------------------------------------------------
// createServerFn
// --------------------------------------------------------------------

export type SubmitAnalysisResult =
  | {
      ok: true;
      episodeId: string;
      status: "succeeded" | "failed";
      unitsTotal: number;
      unitsSucceeded: number;
      unitsFailed: number;
      failedUnitIds: string[];
      warnings: string[];
    }
  | { ok: false; code: string; error: string };

/**
 * 提交整集原视频分析：并发 2 逐单元跑视觉+ASR 双通道，按偏移拼回整集，
 * 写 restyle_episodes / restyle_shots / restyle_transcripts / restyle_source_assets。
 * 单单元失败 → 整集标 failed 并保留已完成单元；传 unitIds 可仅重跑失败单元。
 */
export const submitEpisodeAnalysisFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SubmitInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<SubmitAnalysisResult> => {
    const { supabase, userId } = context as SupabaseContext;

    // 视觉分析积分预校验（内部视觉模型按图片类计费口径）
    const guard = await ensureEnoughCredits(2, { kind: "image", model: INTERNAL_VISION_MODEL });
    if (!guard.ok) return { ok: false, code: "INSUFFICIENT_CREDITS", error: guard.error };

    const { data: episode, error: episodeError } = await supabase
      .from("restyle_episodes")
      .select("id, project_id, analysis_json, analysis_units")
      .eq("id", data.episodeId)
      .eq("project_id", data.projectId)
      .maybeSingle();
    if (episodeError) return { ok: false, code: "DB_ERROR", error: episodeError.message };
    if (!episode) {
      return { ok: false, code: "EPISODE_NOT_FOUND", error: "集不存在或不属于该项目。" };
    }

    const runSet = data.unitIds ? new Set(data.unitIds) : null;
    const unitsToRun = data.units.filter((u) => !runSet || runSet.has(u.unitId));
    if (unitsToRun.length === 0) {
      return { ok: false, code: "NO_UNITS", error: "没有需要分析的单元。" };
    }

    const now = () => new Date().toISOString();

    try {
      // ---- 状态：running，并合并既有单元状态 ----
      const stateByUnit = new Map<string, UnitState>();
      if (Array.isArray(episode.analysis_units)) {
        for (const raw of episode.analysis_units as UnitState[]) {
          if (raw && typeof raw.unitId === "string") stateByUnit.set(raw.unitId, raw);
        }
      }
      for (const u of data.units) {
        const prev = stateByUnit.get(u.unitId);
        stateByUnit.set(u.unitId, {
          unitId: u.unitId,
          unitStartOffsetSec: u.unitStartOffsetSec,
          sourceStartSeconds: u.sourceStartSeconds,
          durationSec: u.durationSec,
          status: runSet && !runSet.has(u.unitId) ? (prev?.status ?? "pending") : "running",
          error: null,
          degraded: null,
        });
      }
      const snapshotStates = () =>
        [...stateByUnit.values()].sort((a, b) => a.unitStartOffsetSec - b.unitStartOffsetSec);

      const { error: runningError } = await supabase
        .from("restyle_episodes")
        .update({
          analysis_status: "running",
          analysis_error: null,
          analysis_units: snapshotStates(),
          updated_at: now(),
        })
        .eq("id", data.episodeId);
      if (runningError) return { ok: false, code: "DB_ERROR", error: runningError.message };

      // ---- 双通道分析（并发 2，单单元失败不中断其他单元）----
      const results = await analyzeEpisodeUnits(unitsToRun);

      for (const r of results) {
        const prev = stateByUnit.get(r.unitId);
        if (!prev) continue;
        stateByUnit.set(r.unitId, {
          ...prev,
          status: r.ok ? "succeeded" : "failed",
          error: r.error ?? null,
          degraded: r.degraded ?? null,
        });
      }

      // ---- 汇总：本轮成功结果 + 历史已成功且本轮未重跑的单元 ----
      const analysisByUnit = new Map<string, UnitAnalysisJson>();
      const transcriptByUnit = new Map<string, AsrSentence[]>();
      const priorJson = episode.analysis_json as
        | { units?: Array<{ unitId?: string; analysis?: UnitAnalysisJson; transcript?: AsrSentence[] }> }
        | null;
      for (const pu of priorJson?.units ?? []) {
        if (pu?.unitId && pu.analysis) {
          analysisByUnit.set(pu.unitId, pu.analysis);
          transcriptByUnit.set(pu.unitId, pu.transcript ?? []);
        }
      }
      for (const r of results) {
        if (r.ok && r.analysis) {
          analysisByUnit.set(r.unitId, r.analysis);
          transcriptByUnit.set(r.unitId, r.transcript ?? []);
        } else {
          // 重跑失败的单元：丢弃其旧结果，避免脏数据拼回整集
          analysisByUnit.delete(r.unitId);
          transcriptByUnit.delete(r.unitId);
        }
      }

      const assembled = assembleEpisodeAnalysis(
        data.units.map((u) => ({ unitId: u.unitId, unitStartOffsetSec: u.unitStartOffsetSec })),
        analysisByUnit,
        transcriptByUnit,
      );

      // ---- 派生行：先删旧再批量插入 ----
      const persistError = await replaceEpisodeDerivedRows(
        supabase,
        userId,
        data.episodeId,
        assembled,
      );
      if (persistError) {
        await supabase
          .from("restyle_episodes")
          .update({
            analysis_status: "failed",
            analysis_error: persistError,
            analysis_units: snapshotStates(),
            updated_at: now(),
          })
          .eq("id", data.episodeId);
        logGenerationError({
          kind: "image",
          provider: "lovable",
          model: INTERNAL_VISION_MODEL,
          errorMessage: persistError,
          requestPayload: { episodeId: data.episodeId, stage: "persist" },
          userId,
        });
        return { ok: false, code: "DB_ERROR", error: persistError };
      }

      // ---- 整集状态流转 ----
      const finalStates = snapshotStates();
      const failedUnits = finalStates.filter((u) => u.status === "failed");
      const status = failedUnits.length > 0 ? "failed" : "succeeded";
      const analysisError =
        failedUnits.length > 0
          ? `单元 ${failedUnits.map((u) => u.unitId).join(", ")} 分析失败：${failedUnits[0].error ?? "未知错误"}`
          : null;

      const analysisJson = {
        version: 2,
        episodeId: data.episodeId,
        projectId: data.projectId,
        generatedAt: now(),
        visionModel: INTERNAL_VISION_MODEL,
        overview: assembled.overview,
        units: finalStates.map((u) => ({
          ...u,
          analysis: analysisByUnit.get(u.unitId) ?? null,
          transcript: transcriptByUnit.get(u.unitId) ?? [],
        })),
        shots: assembled.shots,
        transcript: assembled.transcript,
        orphanTranscript: assembled.orphanTranscript,
        assets: assembled.assets,
        warnings: assembled.warnings,
      };

      const { error: finalError } = await supabase
        .from("restyle_episodes")
        .update({
          analysis_status: status,
          analysis_error: analysisError,
          analysis_json: analysisJson,
          analysis_units: finalStates,
          updated_at: now(),
        })
        .eq("id", data.episodeId);
      if (finalError) return { ok: false, code: "DB_ERROR", error: finalError.message };

      // ---- 扣费：按本轮新跑成功的单元数 ×2（与预校验口径一致）----
      // 幂等：历史已成功单元不重扣；失败单元不扣，重跑成功才计一次。
      // 扣费失败不阻断主流程（分析结果已落库，不收回）。
      const succeededThisRun = results.filter((r) => r.ok).length;
      if (succeededThisRun > 0) {
        await chargeCredits(supabase, userId, {
          amount: succeededThisRun * 2,
          model: INTERNAL_VISION_MODEL,
          description: `转绘原片分析（${succeededThisRun} 个单元）`,
        });
      }

      if (failedUnits.length > 0) {
        logGenerationError({
          kind: "image",
          provider: "lovable",
          model: INTERNAL_VISION_MODEL,
          errorMessage: analysisError,
          requestPayload: {
            episodeId: data.episodeId,
            failedUnits: failedUnits.map((u) => ({ unitId: u.unitId, error: u.error })),
          },
          userId,
        });
      }

      return {
        ok: true,
        episodeId: data.episodeId,
        status,
        unitsTotal: finalStates.length,
        unitsSucceeded: finalStates.filter((u) => u.status === "succeeded").length,
        unitsFailed: failedUnits.length,
        failedUnitIds: failedUnits.map((u) => u.unitId),
        warnings: assembled.warnings,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase
        .from("restyle_episodes")
        .update({ analysis_status: "failed", analysis_error: msg, updated_at: now() })
        .eq("id", data.episodeId);
      logGenerationError({
        kind: "image",
        provider: "lovable",
        model: INTERNAL_VISION_MODEL,
        errorMessage: msg,
        requestPayload: { episodeId: data.episodeId, stage: "unexpected" },
        userId,
      });
      return { ok: false, code: "INTERNAL_ERROR", error: msg };
    }
  });

export interface EpisodeProgress {
  episodeId: string;
  episodeNo: number | null;
  status: string;
  error: string | null;
  unitsTotal: number;
  unitsSucceeded: number;
  unitsFailed: number;
}

/** 前端轮询用：项目下各集的分析状态与单元完成数。 */
export const getEpisodeAnalysisProgressFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ProgressInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context as SupabaseContext;
    const { data: rows, error } = await supabase
      .from("restyle_episodes")
      .select("id, episode_no, analysis_status, analysis_error, analysis_units")
      .eq("project_id", data.projectId)
      .order("episode_no", { ascending: true });
    if (error) return { ok: false as const, error: error.message, episodes: [] };

    const episodes: EpisodeProgress[] = (rows ?? []).map(
      (row: {
        id: string;
        episode_no: number | null;
        analysis_status: string | null;
        analysis_error: string | null;
        analysis_units: unknown;
      }) => {
        const units = Array.isArray(row.analysis_units) ? (row.analysis_units as UnitState[]) : [];
        return {
          episodeId: row.id,
          episodeNo: row.episode_no ?? null,
          status: row.analysis_status ?? "pending",
          error: row.analysis_error ?? null,
          unitsTotal: units.length,
          unitsSucceeded: units.filter((u) => u?.status === "succeeded").length,
          unitsFailed: units.filter((u) => u?.status === "failed").length,
        };
      },
    );
    return { ok: true as const, error: null, episodes };
  });
