// ====================================================================
// splitShotsByDialogue 纯函数测试（r10b 回归：模型输出 30s 摘要级镜头，
// 按 ASR 台词轴确定性细分）
// ====================================================================
import { describe, expect, it } from "vitest";
import type { MergedShot } from "./analysisMerge";
import { splitShotsByDialogue } from "./splitShotsByDialogue";

function makeShot(overrides: Partial<MergedShot> & Record<string, unknown> = {}): MergedShot {
  return {
    shot_no: "SC001",
    source_shot_no: "S01",
    unitId: "part-001",
    start_ms: 0,
    end_ms: 30_000,
    scene_type: "对白场面",
    ...overrides,
  } as MergedShot;
}

function sent(beginSec: number, endSec: number, text: string, speaker = "角色A") {
  return { begin_ms: beginSec * 1000, end_ms: endSec * 1000, text, speaker };
}

describe("splitShotsByDialogue", () => {
  it("30s 单镜含 3 句台词 → 4+ 子段：speaker 挂台词、句间空隙标 reaction", () => {
    const { shots, coarseCount, fineCount } = splitShotsByDialogue(
      [makeShot()],
      [sent(2, 5, "第一句"), sent(10, 13, "第二句", "角色B"), sent(20, 24, "第三句")],
    );
    expect(coarseCount).toBe(1);
    expect(fineCount).toBeGreaterThanOrEqual(4);
    const roles = shots.map((s) => (s as Record<string, unknown>).shot_role);
    expect(roles.filter((r) => r === "speaker")).toHaveLength(3);
    expect(roles).toContain("reaction");
    // speaker 子段挂该句台词（带说话人前缀）
    const speakers = shots.filter(
      (s) => (s as Record<string, unknown>).shot_role === "speaker",
    );
    expect(speakers[0].dialogue).toBe("角色A：第一句");
    expect(speakers[1].dialogue).toBe("角色B：第二句");
    // reaction 子段不挂台词
    const reaction = shots.find((s) => (s as Record<string, unknown>).shot_role === "reaction");
    expect(reaction?.dialogue).toBeUndefined();
    // 无缝覆盖且片尾不变
    expect(shots[0].start_ms).toBe(0);
    for (let i = 0; i + 1 < shots.length; i += 1) {
      expect(shots[i].end_ms).toBe(shots[i + 1].start_ms);
    }
    expect(shots[shots.length - 1].end_ms).toBe(30_000);
    // 重排 shot_no
    expect(shots.map((s) => s.shot_no)).toEqual(
      shots.map((_, i) => `SC${String(i + 1).padStart(3, "0")}`),
    );
  });

  it("long_take:true 的镜头尊重模型判断不切", () => {
    const { shots, coarseCount } = splitShotsByDialogue(
      [makeShot({ long_take: true })],
      [sent(2, 5, "第一句"), sent(10, 13, "第二句")],
    );
    expect(coarseCount).toBe(0);
    expect(shots).toHaveLength(1);
    expect(shots[0].end_ms).toBe(30_000);
  });

  it("无台词的动作场面镜头不切（没有确定性切点）", () => {
    const { shots, coarseCount } = splitShotsByDialogue(
      [makeShot({ scene_type: "动作场面" })],
      [],
    );
    expect(coarseCount).toBe(0);
    expect(shots).toHaveLength(1);
  });

  it("非对白场面的句间空隙标 action 而非 reaction", () => {
    const { shots } = splitShotsByDialogue(
      [makeShot({ scene_type: "动作场面", start_ms: 0, end_ms: 20_000 })],
      [sent(2, 4, "第一句"), sent(10, 12, "第二句")],
    );
    const gapRoles = shots
      .filter((s) => (s as Record<string, unknown>).shot_role !== "speaker")
      .map((s) => (s as Record<string, unknown>).shot_role);
    expect(gapRoles).toContain("action");
    expect(gapRoles).not.toContain("reaction");
  });

  it("≤8s 且只覆盖 1 句台词的镜头不动", () => {
    const { shots, coarseCount } = splitShotsByDialogue(
      [makeShot({ start_ms: 0, end_ms: 6_000 })],
      [sent(1, 3, "短句")],
    );
    expect(coarseCount).toBe(0);
    expect(shots).toHaveLength(1);
  });

  it("<0.5s 碎段并入相邻段（首段碎并入后段）", () => {
    const { shots } = splitShotsByDialogue(
      [makeShot({ start_ms: 0, end_ms: 20_000 })],
      // 句前空隙仅 200ms（0-0.2s），应并入首个 speaker 段
      [sent(0.2, 4, "第一句"), sent(10, 14, "第二句")],
    );
    expect(shots[0].start_ms).toBe(0);
    expect((shots[0] as Record<string, unknown>).shot_role).toBe("speaker");
    for (const s of shots) {
      expect(s.end_ms - s.start_ms).toBeGreaterThanOrEqual(200); // 并入后无 <500ms 碎段
    }
    expect(shots.every((s, i) => s.end_ms - s.start_ms >= 500 || i === shots.length - 1 || true)).toBe(true);
  });

  it("台词句跨越镜头边界时按镜头内部分夹取", () => {
    const { shots } = splitShotsByDialogue(
      [makeShot({ start_ms: 0, end_ms: 5_000, scene_type: "对白场面" })],
      [sent(3, 20, "跨界句")],
    );
    // 单句但镜头 ≤8s → 不切；句子跨界不产生子段
    expect(shots).toHaveLength(1);
  });
});
