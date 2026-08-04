// ====================================================================
//  grouping.ts 纯函数测试：
//   - packShotsIntoGroups 贪心分组（时长硬约束 / 场景边界优先 / 超长单镜
//     warning / 尾部余量并入 / minSec·maxSec 参数化，为更长时长预留）
//   - computeGroupStats 复算 groupCount / totalDurationSeconds
//   - validateGroups 四类错误（覆盖 / 重叠 / 时长 / 归属合法）
//   - normalizeGroupingPlan 兼容竞品样本「第N组」形态
//   - groupingScopeHash 上游变化失效检测
// ====================================================================

import { describe, expect, it } from "vitest";
import {
  computeGroupStats,
  groupingScopeHash,
  lookCoversShot,
  normalizeGroupingPlan,
  packShotsIntoGroups,
  summarizeGroupCharacters,
  validateGroups,
  type GroupingShot,
} from "./grouping";

/** 造 n 个连续分镜：id s1..sn，shotNo SC01..，每镜 durSec 秒。 */
function makeShots(
  durationsSec: number[],
  sceneType: string | null = "内景·办公室",
): GroupingShot[] {
  let cursor = 0;
  return durationsSec.map((dur, index) => {
    const shot: GroupingShot = {
      id: `s${index + 1}`,
      shotNo: `SC${String(index + 1).padStart(2, "0")}`,
      startMs: cursor,
      endMs: cursor + dur * 1000,
      sceneType,
      characters: ["MARA"],
      dialogue: null,
    };
    cursor += dur * 1000;
    return shot;
  });
}

describe("packShotsIntoGroups", () => {
  it("总时长不超上限时合成单组", () => {
    const shots = makeShots([2, 2, 2, 2, 2, 2]); // 12s
    const { groups, warnings } = packShotsIntoGroups(shots);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalSeconds).toBe(12);
    expect(groups[0].shotIds).toEqual(shots.map((s) => s.id));
    expect(warnings).toHaveLength(0);
  });

  it("超过 maxSec 即切组（贪心、镜头边界）", () => {
    const shots = makeShots(Array(10).fill(2)); // 20s
    const { groups, warnings } = packShotsIntoGroups(shots);
    expect(groups.map((g) => g.totalSeconds)).toEqual([14, 6]);
    expect(warnings).toHaveLength(0);
    // 覆盖全集、无重叠
    expect(validateGroups(groups, shots).ok).toBe(true);
  });

  it("达到 minSec 后优先在同场景切换处切组", () => {
    const a = makeShots([2, 2, 2], "天台"); // 6s
    const b = makeShots([2, 2], "KTV").map((s, i) => ({
      ...s,
      id: `k${i + 1}`,
      shotNo: `SC0${i + 4}`,
      startMs: 6000 + i * 2000,
      endMs: 8000 + i * 2000,
    }));
    const { groups } = packShotsIntoGroups([...a, ...b]);
    expect(groups).toHaveLength(2);
    expect(groups[0].shotIds).toEqual(a.map((s) => s.id));
    expect(groups[1].shotIds).toEqual(b.map((s) => s.id));
  });

  it("超长单镜独立成组并给 warning", () => {
    const shots = makeShots([2, 2, 20, 2, 2]);
    const { groups, warnings } = packShotsIntoGroups(shots);
    expect(groups).toHaveLength(3);
    expect(groups[1].shotIds).toEqual(["s3"]);
    expect(groups[1].totalSeconds).toBe(20);
    expect(warnings.some((w) => w.includes("SC03") && w.includes("上限"))).toBe(true);
  });

  it("尾部不足 minSec 的余量并入前一组（合并后 ≤ maxSec）", () => {
    // 场景切换先切出 9s 组，尾部 2s 不足 4s → 并入成 11s。
    const a = makeShots([3, 3, 3], "天台");
    const tail: GroupingShot = {
      id: "t1",
      shotNo: "SC04",
      startMs: 9000,
      endMs: 11000,
      sceneType: "街道",
    };
    const { groups, warnings } = packShotsIntoGroups([...a, tail]);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalSeconds).toBe(11);
    expect(groups[0].reason).toContain("并入");
    expect(warnings).toHaveLength(0);
  });

  it("尾部无法并入（会超 maxSec）时保留独立成组并给 warning", () => {
    const shots = makeShots([5, 5, 5, 1]);
    const { groups, warnings } = packShotsIntoGroups(shots);
    expect(groups).toHaveLength(2);
    expect(groups[1].totalSeconds).toBe(1);
    expect(warnings.some((w) => w.includes("人工复核"))).toBe(true);
  });

  it("minSec/maxSec 参数化：为更长时长预留", () => {
    const shots = makeShots(Array(10).fill(4)); // 40s
    const { groups, warnings } = packShotsIntoGroups(shots, { minSec: 8, maxSec: 30 });
    expect(groups.map((g) => g.totalSeconds)).toEqual([28, 12]);
    expect(warnings).toHaveLength(0);
    expect(validateGroups(groups, shots, { minSec: 8, maxSec: 30 }).ok).toBe(true);
    // 默认 4–15s 口径下同样的输入会被切成更细的组
    const strict = packShotsIntoGroups(shots);
    expect(strict.groups.length).toBeGreaterThan(groups.length);
  });

  it("空分镜列表返回空分组", () => {
    expect(packShotsIntoGroups([])).toEqual({ groups: [], warnings: [] });
  });
});

describe("computeGroupStats", () => {
  it("复算 groupCount 与 totalDurationSeconds（1 位小数）", () => {
    const stats = computeGroupStats([
      { totalSeconds: 10.5 },
      { totalSeconds: 7.2 },
      { totalSeconds: 4 },
    ]);
    expect(stats).toEqual({ groupCount: 3, totalDurationSeconds: 21.7 });
  });
});

describe("validateGroups", () => {
  const shots = makeShots([3, 3, 3, 3]); // s1..s4，共 12s

  it("合法方案通过", () => {
    const result = validateGroups([{ shotIds: ["s1", "s2", "s3", "s4"] }], shots);
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("覆盖全集：遗漏分镜报 uncovered_shot", () => {
    const result = validateGroups([{ shotIds: ["s1", "s2"] }], shots);
    expect(result.ok).toBe(false);
    const uncovered = result.errors.filter((e) => e.type === "uncovered_shot");
    expect(uncovered.map((e) => e.shotId).sort()).toEqual(["s3", "s4"]);
  });

  it("无重叠：同一分镜进两组报 overlapping_shot", () => {
    const result = validateGroups(
      [{ shotIds: ["s1", "s2"] }, { shotIds: ["s2", "s3", "s4"] }],
      shots,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.type === "overlapping_shot" && e.shotId === "s2")).toBe(
      true,
    );
  });

  it("时长合规：超出 4–15s 报 duration_out_of_range", () => {
    const long = makeShots([20]);
    const over = validateGroups([{ shotIds: ["s1"] }], long);
    expect(over.errors.some((e) => e.type === "duration_out_of_range")).toBe(true);
    // 可调参数：放宽到 30s 即合规
    expect(validateGroups([{ shotIds: ["s1"] }], long, { minSec: 4, maxSec: 30 }).ok).toBe(true);
  });

  it("归属合法：未知分镜 / 空组 / 组内重复", () => {
    const unknown = validateGroups(
      [{ shotIds: ["s1", "s2", "sX"] }, { shotIds: ["s3", "s4"] }],
      shots,
    );
    expect(unknown.errors.some((e) => e.type === "unknown_shot" && e.shotId === "sX")).toBe(true);

    const empty = validateGroups([{ shotIds: [] }, { shotIds: ["s1", "s2", "s3", "s4"] }], shots);
    expect(empty.errors.some((e) => e.type === "empty_group")).toBe(true);

    const dup = validateGroups(
      [{ shotIds: ["s1", "s1", "s2", "s3", "s4"] }],
      shots,
    );
    expect(dup.errors.some((e) => e.type === "duplicate_shot" && e.shotId === "s1")).toBe(true);
  });
});

describe("normalizeGroupingPlan", () => {
  const shots = makeShots([2, 2, 2, 2, 2]);

  it("兼容竞品样本「第N组」键控形态（EP 前缀引用）", () => {
    const parsed = {
      第一组: { group: ["EP01_SC01", "EP01_SC02", "EP01_SC03"], reason: "开场段" },
      第二组: { group: ["EP01_SC04", "EP01_SC05"], reason: "冲突段" },
    };
    const { groups, unknownRefs } = normalizeGroupingPlan(parsed, shots);
    expect(unknownRefs).toEqual([]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ shotIds: ["s1", "s2", "s3"], reason: "开场段", totalSeconds: 6 });
    expect(groups[1]).toMatchObject({ shotIds: ["s4", "s5"], totalSeconds: 4 });
  });

  it("兼容 { groups: [...] } 形态并收集未知引用", () => {
    const parsed = {
      groups: [
        { group: ["SC01", "SC02"], reason: "a" },
        { shots: ["SC99"], reason: "b" },
      ],
    };
    const { groups, unknownRefs } = normalizeGroupingPlan(parsed, shots);
    expect(groups).toHaveLength(2);
    expect(unknownRefs).toEqual(["SC99"]);
  });
});

describe("groupingScopeHash 失效检测", () => {
  const looks = [
    { characterId: "c1", name: "造型 1", fromShot: "EP01_SC01", toShot: "EP01_SC03" },
  ];

  it("同一输入恒得同一 hash；分镜变化即失效", () => {
    const shots = makeShots([2, 2, 2]);
    const hash1 = groupingScopeHash("ep1", shots, looks);
    const hash2 = groupingScopeHash("ep1", [...shots], [...looks]);
    expect(hash1).toBe(hash2);

    const changed = shots.map((s, i) => (i === 0 ? { ...s, dialogue: "新增台词" } : s));
    expect(groupingScopeHash("ep1", changed, looks)).not.toBe(hash1);
  });

  it("换装区间变化即失效；集不同 hash 不同", () => {
    const shots = makeShots([2, 2, 2]);
    const base = groupingScopeHash("ep1", shots, looks);
    const lookChanged = groupingScopeHash("ep1", shots, [
      { ...looks[0], toShot: "EP01_SC02" },
    ]);
    expect(lookChanged).not.toBe(base);
    expect(groupingScopeHash("ep2", shots, looks)).not.toBe(base);
  });
});

describe("summarizeGroupCharacters / lookCoversShot", () => {
  it("按出现顺序去重角色，造型取覆盖组内分镜的 look", () => {
    const shots: GroupingShot[] = [
      { id: "s1", shotNo: "SC01", startMs: 0, endMs: 2000, characters: ["MARA", "VICTORIA"] },
      { id: "s2", shotNo: "SC02", startMs: 2000, endMs: 4000, characters: ["MARA"] },
    ];
    const looks = [
      { characterId: "c1", characterName: "MARA", name: "职业装", fromShot: "EP01_SC01", toShot: "EP01_SC05" },
      { characterId: "c2", characterName: "VICTORIA", name: "晚礼服", fromShot: "EP01_SC10", toShot: "EP01_SC20" },
    ];
    const result = summarizeGroupCharacters({ shotIds: ["s1", "s2"] }, shots, looks);
    expect(result).toEqual([
      { name: "MARA", look: "职业装" },
      { name: "VICTORIA", look: null },
    ]);
  });

  it("lookCoversShot 归一化 EP 前缀后按区间判断", () => {
    const look = { fromShot: "EP01_SC02", toShot: "EP01_SC04" };
    expect(lookCoversShot(look, "SC01")).toBe(false);
    expect(lookCoversShot(look, "SC03")).toBe(true);
    expect(lookCoversShot(look, "EP01_SC05")).toBe(false);
  });
});
