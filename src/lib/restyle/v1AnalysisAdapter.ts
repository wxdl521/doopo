// ====================================================================
// v1AnalysisAdapter —— 转绘 v1 换 v2 单元化分析内核的契约适配层
//
// v2 单元化管线产出 MergedShot / AlignedSentence / EpisodeAnalysisAssembled，
// v1 下游（导演调度、方案生成、资产分析）消费的是 DirectionShot / 台词文本 /
// 证据包文本。本模块只做纯函数转换，不触网、不依赖 Supabase，可直接进 Vitest：
//   - mergedShotToDirectionShot：字段改名 + shot_type 六档中文枚举归一
//     （非法值映射到最近档而非丢弃）+ scene ← spatial_anchor（v2 无物理
//     场景名字段，用空间锚点近似，这是最大语义缺口）。
//   - alignedSentencesToTranscript：复刻 restyleTranscript.ts formatTranscript
//     的 `[mm:ss] 角色：台词` 格式。
//   - formatShotBrief：逐镜压缩行格式（SC001 00:00-00:04 特写|场景|动作），
//     超预算按原始顺序均匀抽稀（不截尾，保住全片两端镜头）。
//   - buildEvidencePackage：overview + 资产线索 + 全片逐镜表 + 台词，
//     喂给资产制片人（analyzeRestyleAssets 证据包模式），总长硬上限。
// ====================================================================

import type { DirectionShot, ShotType } from "./cameraDirection";
import type { AsrSentence, MergedShot } from "./analysisMerge";
import type { EpisodeAnalysisAssembled } from "./restyleVideoAnalysis.functions";

/** 调度层景别六档枚举（与 cameraDirection.ShotType / shotSchedule.ts 对齐）。 */
const SHOT_TYPES: ReadonlySet<string> = new Set<ShotType>([
  "特写",
  "大特写",
  "近景",
  "中景",
  "全景",
  "远景",
]);

/**
 * shot_type 归一到 v1 六档中文枚举。v2 视觉通道可能产出七档（多「大远景」）、
 * 英文档位或任意自由文本：合法值原样透传，可识别的非法值映射到最近档，
 * 完全无法识别的归一到中性档「中景」——不丢弃镜头，保证逐镜表时间轴完整。
 */
export function normalizeShotType(raw: unknown): ShotType {
  if (typeof raw !== "string") return "中景";
  const value = raw.trim();
  if (SHOT_TYPES.has(value)) return value as ShotType;
  // 中文包含匹配（「大远景」含「远景」，顺序保证「大特写」先于「特写」命中）
  if (value.includes("大特写")) return "大特写";
  if (value.includes("特写")) return "特写";
  if (value.includes("近景")) return "近景";
  if (value.includes("中景")) return "中景";
  if (value.includes("全景")) return "全景";
  if (value.includes("远景")) return "远景";
  // 英文档位别名
  const lower = value.toLowerCase();
  if (/extreme close|\becu\b/.test(lower)) return "大特写";
  if (/close/.test(lower)) return "特写";
  if (/medium close|\bmcu\b/.test(lower)) return "近景";
  if (/medium|\bmid\b/.test(lower)) return "中景";
  if (/full/.test(lower)) return "全景";
  if (/wide|long shot|establishing|extreme/.test(lower)) return "远景";
  return "中景";
}

/** MergedShot（v2 集级毫秒时间码）→ DirectionShot（v1 调度层契约）。 */
export function mergedShotToDirectionShot(shot: MergedShot): DirectionShot {
  return {
    shotNo: shot.shot_no,
    startMs: shot.start_ms,
    endMs: shot.end_ms,
    scene: typeof shot.spatial_anchor === "string" ? shot.spatial_anchor.trim() : "",
    shotType: normalizeShotType(shot.shot_type),
    emotion: typeof shot.emotion === "string" ? shot.emotion.trim() : "",
    action: typeof shot.end_state_action === "string" ? shot.end_state_action : undefined,
    dialogue: typeof shot.dialogue === "string" ? shot.dialogue : undefined,
  };
}

/** 毫秒 → `mm:ss`（与 restyleTranscript.ts 的 formatTimecode 同款口径）。 */
export function formatShotTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/**
 * AlignedSentence[] → v1 台词文本：复刻 restyleTranscript.ts formatTranscript
 * 的 `[mm:ss] 角色：台词` 格式（speaker 缺失或 unknown 时省略角色前缀）。
 */
export function alignedSentencesToTranscript(
  sentences: Array<Pick<AsrSentence, "begin_ms" | "text" | "speaker">>,
): string {
  return sentences
    .slice()
    .sort((a, b) => a.begin_ms - b.begin_ms)
    .map((sentence) => {
      const speaker =
        sentence.speaker && sentence.speaker !== "unknown" ? `${sentence.speaker}：` : "";
      return `[${formatShotTime(sentence.begin_ms)}] ${speaker}${sentence.text}`;
    })
    .join("\n");
}

/** 逐镜压缩行：`SC001 00:00-00:04 特写|场景|动作`（场景/动作为空时省略该段）。 */
export function formatShotLine(
  shot: Pick<DirectionShot, "shotNo" | "startMs" | "endMs" | "shotType" | "scene" | "action">,
): string {
  const parts = [shot.shotType, shot.scene, shot.action].filter(
    (part): part is string => Boolean(part && part.trim()),
  );
  return `${shot.shotNo} ${formatShotTime(shot.startMs)}-${formatShotTime(shot.endMs)} ${parts.join("|")}`;
}

/**
 * 逐镜摘要全量压缩行；总长度超 maxChars 时按原始顺序均匀抽稀
 * （不截尾，保住全片两端镜头），抽稀后仍超长则继续加大抽稀步长。
 */
export function formatShotBrief(
  shots: Array<Pick<DirectionShot, "shotNo" | "startMs" | "endMs" | "shotType" | "scene" | "action">>,
  maxChars: number,
): string {
  const lines = shots.map(formatShotLine);
  const total = lines.reduce((sum, line) => sum + line.length + 1, 0);
  if (total <= maxChars) return lines.join("\n");
  if (!lines.length || maxChars <= 0) return "";
  let keep = Math.max(1, Math.floor(lines.length * (maxChars / total)));
  let result = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    result = sampleEvenly(lines, keep).join("\n");
    if (result.length <= maxChars || keep <= 1) break;
    keep = Math.max(1, Math.floor(keep * 0.9));
  }
  return result;
}

/** 按原始顺序均匀抽取 keep 条（首尾必保留）。 */
function sampleEvenly<T>(items: T[], keep: number): T[] {
  if (keep >= items.length) return items;
  if (keep <= 1) return [items[0]];
  const picked: T[] = [];
  for (let i = 0; i < keep; i += 1) {
    picked.push(items[Math.round((i * (items.length - 1)) / (keep - 1))]);
  }
  return picked;
}

/** 证据包总长硬上限（字符）：喂给资产制片人的文本，过长会稀释资产提取质量。 */
export const MAX_EVIDENCE_PACKAGE_CHARS = 20_000;

/**
 * 组装喂给资产制片人（analyzeRestyleAssets 证据包模式）的文本：
 * 整片概览 + 原片资产线索 + 全片逐镜表（压缩行）+ 全片台词。
 * 总长超上限时逐镜表按均匀抽稀压缩（最多占六成预算）、台词截尾标注，
 * 保证返回文本不超过 MAX_EVIDENCE_PACKAGE_CHARS。
 */
export function buildEvidencePackage(
  assembled: Pick<EpisodeAnalysisAssembled, "overview" | "assets">,
  shots: DirectionShot[],
  transcript: string,
): string {
  const kindLabel = { character: "角色", scene: "场景", prop: "道具" } as const;
  const assetLines = assembled.assets.map(
    (asset) =>
      `- ${kindLabel[asset.kind]}：${asset.source_name}${asset.description ? `（${asset.description}）` : ""}`,
  );
  const head = [
    "[整片概览]",
    assembled.overview.trim() || "（无）",
    "",
    "[原片资产线索]",
    assetLines.length ? assetLines.join("\n") : "（未识别到具体资产）",
    "",
    "[全片逐镜表]",
    "",
  ].join("\n");
  const tail = "\n[全片台词]\n";
  const budget = MAX_EVIDENCE_PACKAGE_CHARS - head.length - tail.length;
  if (budget <= 0) return `${head}${tail}（无台词）`;

  // 逐镜表最多占 60% 预算，余量全部留给台词；逐镜表用不满时台词自动得满剩余空间
  const shotBudget = Math.floor(budget * 0.6);
  const shotSection = formatShotBrief(shots, shotBudget);
  const transcriptBudget = budget - shotSection.length;
  const transcriptSection =
    transcript.length <= transcriptBudget
      ? transcript
      : `${transcript.slice(0, Math.max(0, transcriptBudget - 24))}\n…（台词过长已截断）`;
  return `${head}${shotSection}${tail}${transcriptSection || "（无台词）"}`;
}
