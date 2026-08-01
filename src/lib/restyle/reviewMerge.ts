// ====================================================================
//  转绘 v2 阶段二 · 关卡 1（AI 自检）—— 纯函数与契约类型
//
//  不依赖 supabase / 网关，可单测。restyleReview.functions.ts 负责
//  鉴权、读库、调模型与落库，这里只做：
//    - ReviewResult 契约的宽容解析（validateReviewPayload）
//    - 多来源 issue 归并去重（mergeIssues）
//    - 台词朗读时长估算与分镜时长复核（dialogueDurationSec /
//      checkShotDialogueFit，对应 narrative-consistency-audit 表三）
//
//  枚举口径（本模块对外统一）：
//    verdict:  pass | pass_with_notes | fail
//    severity: high | medium | low
//  skills/*.md 里的旧口径（warn / blocker|major|minor、type/location
//  字段名）在解析时作为别名归一，不向外泄漏。
// ====================================================================

import type { JsonValue } from "./artifactState";

/** 中文朗读语速：字/秒（narrative-consistency-audit 表三口径）。 */
export const SPEECH_RATE_CPS = 4;
/** 英文朗读语速：词/秒。 */
export const SPEECH_RATE_WPS = 2.5;
/** 台词与分镜时长的安全余量：朗读时长须 ≤ shot 时长 − 0.5s。 */
export const DIALOGUE_FIT_MARGIN_SEC = 0.5;

export type ReviewVerdict = "pass" | "pass_with_notes" | "fail";
export type ReviewSeverity = "high" | "medium" | "low";

export interface ReviewIssue {
  issueType: string;
  severity: ReviewSeverity;
  description: string;
  suggestion: string;
  shotNo?: string;
  assetName?: string;
}

export interface ReviewResult {
  verdict: ReviewVerdict;
  issues: ReviewIssue[];
  /** AI 给出的机械修补产物（完整产物而非 diff），可选。 */
  patched?: JsonValue;
}

// --------------------------------------------------------------------
// 宽容解析
// --------------------------------------------------------------------

const SEVERITY_ALIASES: Record<string, ReviewSeverity> = {
  high: "high",
  medium: "medium",
  low: "low",
  // skills/*.md 旧口径别名
  blocker: "high",
  major: "medium",
  minor: "low",
};

const VERDICT_ALIASES: Record<string, ReviewVerdict> = {
  pass: "pass",
  pass_with_notes: "pass_with_notes",
  fail: "fail",
  // skills/*.md 旧口径别名
  warn: "pass_with_notes",
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseOneIssue(raw: unknown): ReviewIssue | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  // description 兼容 narrative-consistency-audit 表一的 current 字段。
  const description = asString(rec.description) ?? asString(rec.current) ?? "";
  const severityRaw = asString(rec.severity)?.toLowerCase() ?? "";
  const issue: ReviewIssue = {
    issueType: asString(rec.issueType) ?? asString(rec.issue_type) ?? asString(rec.type) ?? "other",
    severity: SEVERITY_ALIASES[severityRaw] ?? "low",
    description,
    suggestion: asString(rec.suggestion) ?? "",
  };
  const shotNo = asString(rec.shotNo) ?? asString(rec.shot_no);
  if (shotNo) issue.shotNo = shotNo;
  const assetName = asString(rec.assetName) ?? asString(rec.asset_name);
  if (assetName) issue.assetName = assetName;
  return issue;
}

/** 去掉 ```json 围栏，截取首个 { 到末个 } 之间的内容。 */
function stripToJson(text: string): string {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return cleaned;
  return cleaned.slice(start, end + 1);
}

/**
 * 宽容解析 AI 返回的审核结论：接受对象或 JSON 字符串（容忍围栏与杂散
 * 文本），缺字段补默认、非法枚举降级、非对象 issue 丢弃。永不抛错。
 */
export function validateReviewPayload(raw: unknown): ReviewResult {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(stripToJson(raw));
    } catch {
      return { verdict: "pass", issues: [] };
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { verdict: "pass", issues: [] };
  }
  const rec = parsed as Record<string, unknown>;
  const issues = (Array.isArray(rec.issues) ? rec.issues : [])
    .map(parseOneIssue)
    .filter((i): i is ReviewIssue => i !== null);

  const verdictRaw = asString(rec.verdict)?.toLowerCase() ?? "";
  let verdict = VERDICT_ALIASES[verdictRaw];
  if (!verdict) {
    // 非法/缺失 verdict：按 issues 推断一个保守结论。
    verdict = issues.some((i) => i.severity === "high")
      ? "fail"
      : issues.length > 0
        ? "pass_with_notes"
        : "pass";
  }

  const result: ReviewResult = { verdict, issues };
  if (rec.patched && typeof rec.patched === "object") {
    result.patched = rec.patched as JsonValue;
  }
  return result;
}

// --------------------------------------------------------------------
// issue 归并
// --------------------------------------------------------------------

const SEVERITY_RANK: Record<ReviewSeverity, number> = { high: 3, medium: 2, low: 1 };

/**
 * 多来源 issue 归并：按 issueType+description 去重，severity 取最高
 * （high > medium > low），其余字段保留先出现的、空缺由后出现的补齐。
 */
export function mergeIssues(issueLists: ReviewIssue[][]): ReviewIssue[] {
  const byKey = new Map<string, ReviewIssue>();
  for (const list of issueLists) {
    for (const issue of list) {
      const key = `${issue.issueType}|${issue.description}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...issue });
        continue;
      }
      if (SEVERITY_RANK[issue.severity] > SEVERITY_RANK[existing.severity]) {
        existing.severity = issue.severity;
      }
      existing.shotNo ??= issue.shotNo;
      existing.assetName ??= issue.assetName;
      if (!existing.suggestion && issue.suggestion) existing.suggestion = issue.suggestion;
    }
  }
  return [...byKey.values()];
}

// --------------------------------------------------------------------
// 台词时长复核（narrative-consistency-audit 表三的本地口径）
// --------------------------------------------------------------------

const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/g;
const WORD_RE = /[A-Za-z0-9]+(?:'[A-Za-z]+)?/g;

/**
 * 台词朗读时长估算（秒）：中英混排分开计费——中文字符按 cps（默认
 * SPEECH_RATE_CPS=4 字/秒），英文单词按 SPEECH_RATE_WPS=2.5 词/秒；
 * 标点与空白不计时。
 */
export function dialogueDurationSec(text: string, cps: number = SPEECH_RATE_CPS): number {
  if (!text) return 0;
  const cjkCount = (text.match(CJK_RE) ?? []).length;
  const wordCount = (text.replace(CJK_RE, " ").match(WORD_RE) ?? []).length;
  if (cps <= 0) cps = SPEECH_RATE_CPS;
  return cjkCount / cps + wordCount / SPEECH_RATE_WPS;
}

export interface ShotDialogueInput {
  shotNo: string;
  durationSec: number;
  dialogue?: string | null;
}

/**
 * 分镜时长与台词完整性复核：朗读时长 > shot 时长 − 0.5s 的产出超标
 * issue（severity medium）。恰好等于边界视为达标（不标红）。无台词
 * 的分镜跳过。
 */
export function checkShotDialogueFit(
  shots: ShotDialogueInput[],
  cps: number = SPEECH_RATE_CPS,
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  for (const shot of shots) {
    const text = shot.dialogue?.trim();
    if (!text) continue;
    const speechSec = dialogueDurationSec(text, cps);
    const limitSec = shot.durationSec - DIALOGUE_FIT_MARGIN_SEC;
    // 浮点边界容差：speech == limit 视为达标。
    if (speechSec > limitSec + 1e-9) {
      issues.push({
        issueType: "dialogue_overrun",
        severity: "medium",
        shotNo: shot.shotNo,
        description: `台词「${text.length > 30 ? text.slice(0, 30) + "…" : text}」朗读约 ${speechSec.toFixed(1)}s，超出分镜时长 ${shot.durationSec.toFixed(1)}s − 0.5s 安全余量（上限 ${limitSec.toFixed(1)}s）`,
        suggestion: "精简台词或延长该分镜时长",
      });
    }
  }
  return issues;
}
