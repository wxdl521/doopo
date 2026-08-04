// ====================================================================
//  转绘 v2 阶段 B（第三步）· 按集分组 —— 纯函数
//
//  不依赖 supabase，可单测，也可直接进客户端图（GroupingPanel 用它做
//  本地校验/时长预览）。实现 shot-to-segment skill 的确定性部分：
//    - packShotsIntoGroups  按时间轴贪心分组（镜头边界优先、同场景
//      优先、4–15s 硬约束，minSec/maxSec 为可调参数，为更长时长预留）
//    - computeGroupStats    groupCount / totalDurationSeconds（确认记录）
//    - validateGroups       覆盖全集 / 无重叠 / 时长合规 / 归属合法
//    - normalizeGroupingPlan 解析导演模型输出（兼容竞品样本「第N组」形态）
//    - groupingScopeHash    上游指纹（shots + 换装区间），失效即需重新确认
// ====================================================================

import { computeScopeHash } from "./artifactState";

// --------------------------------------------------------------------
// 类型
// --------------------------------------------------------------------

/** 参与分组的最小分镜字段集（restyle_shots 行的子集）。 */
export interface GroupingShot {
  id: string;
  shotNo: string;
  startMs: number;
  endMs: number;
  sceneType?: string | null;
  characters?: string[];
  dialogue?: string | null;
  endStateAction?: string | null;
}

/** 一组的分组方案：shotIds 按时间线升序，totalSeconds 由分镜时长复算。 */
export interface GroupPlan {
  shotIds: string[];
  reason: string;
  totalSeconds: number;
}

export interface PackOptions {
  /** 单组最短时长（秒），默认 4。可调参数，为更长时长预留。 */
  minSec?: number;
  /** 单组最长时长（秒），默认 15。 */
  maxSec?: number;
}

export interface PackResult {
  groups: GroupPlan[];
  /** 无法同时满足硬约束时的人可读本说明（进产物 issues，不阻断）。 */
  warnings: string[];
}

/** 分组时长硬约束默认值（shot-to-segment 契约：视为可调参数）。 */
export const DEFAULT_MIN_GROUP_SEC = 4;
export const DEFAULT_MAX_GROUP_SEC = 15;

// --------------------------------------------------------------------
// 基础工具
// --------------------------------------------------------------------

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function shotDurationSec(shot: Pick<GroupingShot, "startMs" | "endMs">): number {
  return Math.max(0, (shot.endMs - shot.startMs) / 1000);
}

function sceneOf(shot: GroupingShot): string {
  return (shot.sceneType ?? "").trim();
}

/** 归一化分镜引用：AI 输出常带 EP 前缀（EP01_SC01），库里 shot_no 为 SC01。 */
export function normalizeShotRef(ref: string): string {
  return ref.trim().replace(/^EP\d+_/i, "").toUpperCase();
}

// --------------------------------------------------------------------
// packShotsIntoGroups：贪心分组
// --------------------------------------------------------------------

function packReason(shots: GroupingShot[], merged: boolean): string {
  const first = shots[0];
  const last = shots[shots.length - 1];
  const scene = sceneOf(first);
  const total = round1(shots.reduce((sum, shot) => sum + shotDurationSec(shot), 0));
  const base = scene
    ? `同处「${scene}」，连续镜头 ${first.shotNo}–${last.shotNo} 合成一段，总时长 ${total}s`
    : `连续镜头 ${first.shotNo}–${last.shotNo} 合成一段，总时长 ${total}s`;
  return merged ? `${base}（尾部不足最短时长的余量并入本组）` : base;
}

/**
 * 按 shot 时间轴贪心分组：
 *  1. 只在镜头边界切分，不截断单个 shot；一个 shot 不拆进两组。
 *  2. 硬约束 [minSec, maxSec]：再加一镜会超 maxSec 即切组；达到 minSec
 *     后优先在场景切换处切组（同场景优先不断组）。
 *  3. 单镜超过 maxSec 独立成组并给 warning（需人工预切分镜）。
 *  4. 尾部不足 minSec 的余量并入前一组（合并后仍须 ≤ maxSec），无法并入
 *     时保留独立成组并给 warning。
 */
export function packShotsIntoGroups(shots: GroupingShot[], options?: PackOptions): PackResult {
  const minSec = options?.minSec ?? DEFAULT_MIN_GROUP_SEC;
  const maxSec = options?.maxSec ?? DEFAULT_MAX_GROUP_SEC;
  const warnings: string[] = [];
  if (shots.length === 0) return { groups: [], warnings };

  const sorted = [...shots].sort(
    (a, b) => a.startMs - b.startMs || a.shotNo.localeCompare(b.shotNo),
  );

  const groups: GroupPlan[] = [];
  let current: GroupingShot[] = [];
  let currentSec = 0;

  const flush = () => {
    if (current.length === 0) return;
    groups.push({
      shotIds: current.map((shot) => shot.id),
      reason: packReason(current, false),
      totalSeconds: round1(currentSec),
    });
    current = [];
    currentSec = 0;
  };

  for (const shot of sorted) {
    const sec = shotDurationSec(shot);
    if (sec > maxSec) {
      // 超长单镜：不截断，独立成组，交给人工/复核处理。
      flush();
      groups.push({
        shotIds: [shot.id],
        reason: `单镜 ${shot.shotNo} 时长 ${round1(sec)}s 超过 ${maxSec}s 上限，独立成组待人工切分`,
        totalSeconds: round1(sec),
      });
      warnings.push(
        `镜头 ${shot.shotNo} 时长 ${round1(sec)}s 超过 ${maxSec}s 上限，已独立成组（需人工预切分镜）。`,
      );
      continue;
    }
    const wouldExceed = current.length > 0 && currentSec + sec > maxSec;
    const sceneBreak =
      current.length > 0 &&
      currentSec >= minSec &&
      sceneOf(current[current.length - 1]) !== sceneOf(shot);
    if (wouldExceed || sceneBreak) flush();
    current.push(shot);
    currentSec += sec;
  }
  flush();

  // 尾部余量并入前一组（合并后仍须 ≤ maxSec）。
  if (groups.length >= 2) {
    const last = groups[groups.length - 1];
    if (last.totalSeconds < minSec) {
      const prev = groups[groups.length - 2];
      if (round1(prev.totalSeconds + last.totalSeconds) <= maxSec) {
        const shotById = new Map(sorted.map((shot) => [shot.id, shot]));
        const mergedShots = [...prev.shotIds, ...last.shotIds].map(
          (id) => shotById.get(id)!,
        );
        prev.shotIds = mergedShots.map((shot) => shot.id);
        prev.totalSeconds = round1(prev.totalSeconds + last.totalSeconds);
        prev.reason = packReason(mergedShots, true);
        groups.pop();
      } else {
        warnings.push(
          `尾部组时长 ${last.totalSeconds}s 不足 ${minSec}s 且并入前一组会超过 ${maxSec}s，已保留独立成组，需人工复核。`,
        );
      }
    }
  }

  for (const group of groups) {
    if (group.totalSeconds < minSec) {
      warnings.push(
        `存在时长 ${group.totalSeconds}s 不足 ${minSec}s 的分组（${group.shotIds.join("、")}），需人工复核。`,
      );
    }
  }
  return { groups, warnings };
}

// --------------------------------------------------------------------
// computeGroupStats：确认记录的 groupCount / totalDurationSeconds
// --------------------------------------------------------------------

export interface GroupStats {
  groupCount: number;
  totalDurationSeconds: number;
}

export function computeGroupStats(groups: Array<Pick<GroupPlan, "totalSeconds">>): GroupStats {
  return {
    groupCount: groups.length,
    totalDurationSeconds: round1(groups.reduce((sum, group) => sum + group.totalSeconds, 0)),
  };
}

// --------------------------------------------------------------------
// validateGroups：覆盖全集 / 无重叠 / 时长合规 / shot 归属合法
// --------------------------------------------------------------------

export type GroupValidationErrorType =
  | "empty_group"
  | "unknown_shot"
  | "duplicate_shot"
  | "overlapping_shot"
  | "uncovered_shot"
  | "duration_out_of_range";

export interface GroupValidationError {
  type: GroupValidationErrorType;
  /** 组序号（从 1 开始）；与单组无关的错误（如 uncovered_shot）省略。 */
  groupNo?: number;
  shotId?: string;
  description: string;
}

export interface GroupValidationResult {
  ok: boolean;
  errors: GroupValidationError[];
}

/**
 * 校验分组方案：
 *  - 归属合法：shotIds 必须存在于分镜全集；组内不重复；组不为空；
 *  - 无重叠：同一 shot 不得出现在两组；
 *  - 覆盖全集：分镜全集每个 shot 恰好归属一组；
 *  - 时长合规：按分镜时长复算的总时长必须在 [minSec, maxSec]。
 */
export function validateGroups(
  groups: Array<Pick<GroupPlan, "shotIds">>,
  shots: GroupingShot[],
  options?: PackOptions,
): GroupValidationResult {
  const minSec = options?.minSec ?? DEFAULT_MIN_GROUP_SEC;
  const maxSec = options?.maxSec ?? DEFAULT_MAX_GROUP_SEC;
  const errors: GroupValidationError[] = [];
  const shotById = new Map(shots.map((shot) => [shot.id, shot]));
  const groupOfShot = new Map<string, number>();

  groups.forEach((group, index) => {
    const groupNo = index + 1;
    if (group.shotIds.length === 0) {
      errors.push({
        type: "empty_group",
        groupNo,
        description: `第 ${groupNo} 组没有任何分镜。`,
      });
      return;
    }
    const seen = new Set<string>();
    let knownSeconds = 0;
    let hasUnknown = false;
    for (const shotId of group.shotIds) {
      const shot = shotById.get(shotId);
      if (!shot) {
        hasUnknown = true;
        errors.push({
          type: "unknown_shot",
          groupNo,
          shotId,
          description: `第 ${groupNo} 组引用了不存在的分镜 ${shotId}。`,
        });
        continue;
      }
      if (seen.has(shotId)) {
        errors.push({
          type: "duplicate_shot",
          groupNo,
          shotId,
          description: `第 ${groupNo} 组内分镜 ${shot.shotNo} 重复出现。`,
        });
        continue;
      }
      seen.add(shotId);
      const holder = groupOfShot.get(shotId);
      if (holder !== undefined) {
        errors.push({
          type: "overlapping_shot",
          groupNo,
          shotId,
          description: `分镜 ${shot.shotNo} 同时出现在第 ${holder} 组与第 ${groupNo} 组。`,
        });
      } else {
        groupOfShot.set(shotId, groupNo);
      }
      knownSeconds += shotDurationSec(shot);
    }
    // 含未知分镜的组无法可靠复算时长，跳过时长校验（unknown_shot 已报）。
    if (!hasUnknown) {
      const total = round1(knownSeconds);
      if (total < minSec || total > maxSec) {
        errors.push({
          type: "duration_out_of_range",
          groupNo,
          description: `第 ${groupNo} 组总时长 ${total}s 超出 ${minSec}–${maxSec}s 硬约束。`,
        });
      }
    }
  });

  for (const shot of shots) {
    if (!groupOfShot.has(shot.id)) {
      errors.push({
        type: "uncovered_shot",
        shotId: shot.id,
        description: `分镜 ${shot.shotNo} 未归属任何组。`,
      });
    }
  }
  return { ok: errors.length === 0, errors };
}

// --------------------------------------------------------------------
// normalizeGroupingPlan：解析导演模型输出
// --------------------------------------------------------------------

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

function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export interface NormalizeGroupingResult {
  groups: GroupPlan[];
  /** 无法映射到现有分镜的引用（AI 幻觉 shot 号），交由调用方兜底。 */
  unknownRefs: string[];
}

/**
 * 归一化导演模型的分组输出。兼容三种形态：
 *  - 竞品样本：{ "第一组": { group: ["EP01_SC01", …], reason } , … }
 *  - { groups: [{ group | shot_ids | shots, reason }] }
 *  - 裸数组。
 * 分镜引用按 id / shot_no / 去 EP 前缀后的 shot_no 解析；解析失败的引用
 * 进 unknownRefs（不静默丢弃，供调用方判断走兜底）。
 */
export function normalizeGroupingPlan(
  parsed: unknown,
  shots: GroupingShot[],
): NormalizeGroupingResult {
  const shotByRef = new Map<string, GroupingShot>();
  for (const shot of shots) {
    shotByRef.set(shot.id, shot);
    shotByRef.set(shot.shotNo, shot);
    shotByRef.set(normalizeShotRef(shot.shotNo), shot);
  }

  const root =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  let rows: Array<Record<string, unknown>>;
  if (Array.isArray(parsed)) {
    rows = asRecordArray(parsed);
  } else if (root && Array.isArray(root.groups)) {
    rows = asRecordArray(root.groups);
  } else if (root) {
    // 竞品样本形态：按「第N组」键控，按对象键序排列。
    rows = asRecordArray(Object.values(root));
  } else {
    rows = [];
  }

  const unknownRefs: string[] = [];
  const groups: GroupPlan[] = [];
  for (const row of rows) {
    const refs = pickStringArray(row.group ?? row.shot_ids ?? row.shotIds ?? row.shots);
    if (refs.length === 0) continue;
    const shotIds: string[] = [];
    let seconds = 0;
    for (const ref of refs) {
      const shot = shotByRef.get(ref) ?? shotByRef.get(normalizeShotRef(ref));
      if (!shot) {
        unknownRefs.push(ref);
        continue;
      }
      shotIds.push(shot.id);
      seconds += shotDurationSec(shot);
    }
    groups.push({
      shotIds,
      reason: pickString(row, "reason", "group_reason", "groupReason"),
      totalSeconds: round1(seconds),
    });
  }
  return { groups, unknownRefs };
}

// --------------------------------------------------------------------
// scope 指纹：上游（分镜 + 换装区间）变化即失效，需重新确认
// --------------------------------------------------------------------

export interface GroupingScopeLook {
  characterId: string;
  name: string;
  fromShot: string | null;
  toShot: string | null;
}

/** 参与 scope 指纹的稳定输入（字段与键序无关，computeScopeHash 稳定序列化）。 */
export function groupingScopeInput(
  episodeId: string,
  shots: GroupingShot[],
  looks: GroupingScopeLook[],
): unknown {
  return {
    episodeId,
    shots: [...shots]
      .sort((a, b) => a.startMs - b.startMs || a.shotNo.localeCompare(b.shotNo))
      .map((shot) => ({
        id: shot.id,
        shotNo: shot.shotNo,
        startMs: shot.startMs,
        endMs: shot.endMs,
        sceneType: shot.sceneType ?? null,
        characters: shot.characters ?? [],
        dialogue: shot.dialogue ?? null,
        endStateAction: shot.endStateAction ?? null,
      })),
    looks: [...looks]
      .sort((a, b) => a.characterId.localeCompare(b.characterId) || a.name.localeCompare(b.name))
      .map((look) => ({
        characterId: look.characterId,
        name: look.name,
        fromShot: look.fromShot,
        toShot: look.toShot,
      })),
  };
}

/** 分镜/换装区间的上游指纹；与 restyle_groups.scope_hash、产物 scope_hash 同值。 */
export function groupingScopeHash(
  episodeId: string,
  shots: GroupingShot[],
  looks: GroupingScopeLook[],
): string {
  return computeScopeHash(groupingScopeInput(episodeId, shots, looks));
}

// --------------------------------------------------------------------
// 组摘要：参与角色及造型（面板展示 / 产物内容）
// --------------------------------------------------------------------

export interface GroupCharacterLook {
  name: string;
  look: string | null;
}

/** 换装区间是否覆盖某分镜（shot_no 字典序比较，先归一化 EP 前缀）。 */
export function lookCoversShot(
  look: Pick<GroupingScopeLook, "fromShot" | "toShot">,
  shotNo: string,
): boolean {
  const target = normalizeShotRef(shotNo);
  const from = look.fromShot ? normalizeShotRef(look.fromShot) : null;
  const to = look.toShot ? normalizeShotRef(look.toShot) : null;
  if (from && target < from) return false;
  if (to && target > to) return false;
  return true;
}

/**
 * 汇总一组的参与角色及造型：角色取自组内分镜的 characters 字段（去重、
 * 按出现顺序）；造型取该角色换装区间覆盖组内任一分镜的第一条 look 名，
 * 无覆盖则为 null。
 */
export function summarizeGroupCharacters(
  group: Pick<GroupPlan, "shotIds">,
  shots: GroupingShot[],
  looks: Array<GroupingScopeLook & { characterName?: string }>,
): GroupCharacterLook[] {
  const shotById = new Map(shots.map((shot) => [shot.id, shot]));
  const groupShots = group.shotIds
    .map((id) => shotById.get(id))
    .filter((shot): shot is GroupingShot => !!shot);
  const names: string[] = [];
  for (const shot of groupShots) {
    for (const name of shot.characters ?? []) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names.map((name) => {
    const look = looks.find(
      (entry) =>
        (entry.characterName ?? entry.characterId) === name &&
        groupShots.some((shot) => lookCoversShot(entry, shot.shotNo)),
    );
    return { name, look: look?.name ?? null };
  });
}
