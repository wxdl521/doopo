// ====================================================================
// normalizeResult 逐镜表（shots）契约解析测试：
// 合法/非法枚举、startMs<endMs、按 startMs 排序、缺省兼容。
// ====================================================================
import { describe, expect, it } from "vitest";
import { normalizeResult } from "../restyleAnalysis.functions";

const VALID_SHOT = {
  shotNo: "SC001",
  startMs: 0,
  endMs: 3000,
  scene: "天台",
  shotType: "中景",
  emotion: "愤怒",
};

function contentWith(shots: unknown): string {
  return JSON.stringify({ summary: "ok", assets: [], relationships: [], shots });
}

describe("normalizeResult shots 契约解析", () => {
  it("合法逐镜表解析为 DirectionShot 并按 startMs 排序", () => {
    const result = normalizeResult(
      contentWith([
        { ...VALID_SHOT, shotNo: "SC002", startMs: 3000, endMs: 6000, emotion: "震惊" },
        VALID_SHOT,
      ]),
      "model-x",
      true,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shots?.map((shot) => shot.shotNo)).toEqual(["SC001", "SC002"]);
    expect(result.shots?.[0]).toMatchObject({
      startMs: 0,
      endMs: 3000,
      scene: "天台",
      shotType: "中景",
      emotion: "愤怒",
    });
  });

  it("非法枚举 / 非法时间区间的镜头被过滤", () => {
    const result = normalizeResult(
      contentWith([
        VALID_SHOT,
        { ...VALID_SHOT, shotNo: "SC002", startMs: 3000, endMs: 6000, shotType: "大远景" },
        { ...VALID_SHOT, shotNo: "SC003", startMs: 6000, endMs: 6000 },
      ]),
      "model-x",
      true,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shots?.map((shot) => shot.shotNo)).toEqual(["SC001"]);
  });

  it("模型未产出 shots 时缺省（undefined），不影响资产表解析", () => {
    const result = normalizeResult(
      JSON.stringify({ summary: "ok", assets: [], relationships: [] }),
      "model-x",
      false,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shots).toBeUndefined();
    expect(result.assets).toEqual([]);
  });

  it("shots 全部非法时视为未产出", () => {
    const result = normalizeResult(
      contentWith([{ ...VALID_SHOT, shotType: "超远景" }]),
      "model-x",
      true,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shots).toBeUndefined();
  });
});
