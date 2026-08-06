// ====================================================================
// sourceUnitsMerge 纯函数测试：单元结果合并 / shotNo 全局重排 / 证据包截尾
// ====================================================================
import { describe, expect, it } from "vitest";
import type { DirectionShot } from "@/lib/restyle/cameraDirection";
import type { RestyleSourceUnitsFileResult } from "@/lib/restyleSourceUnits.functions";
import {
  MERGED_EVIDENCE_PACKAGE_MAX_CHARS,
  mergeSourceUnitResults,
  renumberShotSchedule,
} from "../sourceUnitsMerge";

function makeShot(shotNo: string, startMs: number, endMs: number): DirectionShot {
  return {
    shotNo,
    startMs,
    endMs,
    scene: "客厅",
    shotType: "中景",
    emotion: "中性",
  };
}

function makeUnitResult(
  overrides: Partial<RestyleSourceUnitsFileResult> = {},
): RestyleSourceUnitsFileResult {
  return {
    sourceId: "video-1",
    sourceName: "原片.mp4",
    shotSchedule: [makeShot("SC001", 0, 4000), makeShot("SC002", 4000, 8000)],
    transcript: "[00:01] 角色A：第一句",
    evidencePackage: "[整片概览]\n某单元概览",
    warnings: [],
    unitsTotal: 1,
    unitsSucceeded: 1,
    unitsFailed: 0,
    failedUnitIds: [],
    ...overrides,
  };
}

describe("renumberShotSchedule", () => {
  it("SC001 起全局重排，时间码与其余字段不动", () => {
    const shots = [makeShot("SC009", 1000, 2000), makeShot("SC003", 2000, 3000)];
    expect(renumberShotSchedule(shots)).toEqual([
      { ...shots[0], shotNo: "SC001" },
      { ...shots[1], shotNo: "SC002" },
    ]);
  });
});

describe("mergeSourceUnitResults", () => {
  it("多次单元调用结果拼接后 shotNo 全局重排、时间码保持集级毫秒", () => {
    const unit1 = makeUnitResult();
    const unit2 = makeUnitResult({
      shotSchedule: [makeShot("SC001", 120_000, 124_000), makeShot("SC002", 124_000, 128_000)],
      transcript: "[02:01] 角色B：第二单元第一句",
    });
    const merged = mergeSourceUnitResults([unit1, unit2]);
    expect(merged.shotSchedule.map((shot) => shot.shotNo)).toEqual([
      "SC001",
      "SC002",
      "SC003",
      "SC004",
    ]);
    expect(merged.shotSchedule[2]).toMatchObject({ startMs: 120_000, endMs: 124_000 });
  });

  it("transcript 直接拼接（集级毫秒时间码跨单元有序）", () => {
    const merged = mergeSourceUnitResults([
      makeUnitResult(),
      makeUnitResult({ transcript: "[02:01] 角色B：第二单元第一句" }),
    ]);
    expect(merged.transcript).toBe("[00:01] 角色A：第一句\n[02:01] 角色B：第二单元第一句");
  });

  it("evidencePackage 逐单元拼接；超长时在行边界截尾并标注", () => {
    const short = mergeSourceUnitResults([makeUnitResult(), makeUnitResult()]);
    expect(short.evidencePackage).toBe("[整片概览]\n某单元概览\n\n[整片概览]\n某单元概览");

    const longLine = "长证据行".repeat(100);
    const longPackage = Array.from({ length: 400 }, () => longLine).join("\n");
    const truncated = mergeSourceUnitResults([
      makeUnitResult({ evidencePackage: longPackage }),
      makeUnitResult({ evidencePackage: longPackage }),
      makeUnitResult({ evidencePackage: longPackage }),
    ]);
    expect(truncated.evidencePackage.length).toBeLessThanOrEqual(
      MERGED_EVIDENCE_PACKAGE_MAX_CHARS,
    );
    expect(truncated.evidencePackage).toContain("证据包过长已截尾");
    expect(truncated.evidencePackage.endsWith(longLine.slice(0, 3))).toBe(false);
  });

  it("warnings 与单元成败计数原样聚合", () => {
    const merged = mergeSourceUnitResults([
      makeUnitResult({ warnings: ["shot SC001 与 SC002 之间存在 1500ms 缺口"] }),
      makeUnitResult({
        shotSchedule: [],
        transcript: "",
        unitsSucceeded: 0,
        unitsFailed: 1,
        failedUnitIds: ["part-002"],
        warnings: ["单元 part-002 分析失败：视觉通道失败"],
      }),
    ]);
    expect(merged.warnings).toEqual([
      "shot SC001 与 SC002 之间存在 1500ms 缺口",
      "单元 part-002 分析失败：视觉通道失败",
    ]);
    expect(merged.unitsTotal).toBe(2);
    expect(merged.unitsSucceeded).toBe(1);
    expect(merged.unitsFailed).toBe(1);
    expect(merged.failedUnitIds).toEqual(["part-002"]);
  });

  it("空输入返回空结果", () => {
    const merged = mergeSourceUnitResults([]);
    expect(merged.shotSchedule).toEqual([]);
    expect(merged.transcript).toBe("");
    expect(merged.evidencePackage).toBe("");
    expect(merged.unitsTotal).toBe(0);
  });
});
