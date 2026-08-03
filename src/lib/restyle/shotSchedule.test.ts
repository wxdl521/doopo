// ====================================================================
// shotSchedule 纯函数测试：逐镜表契约清洗、分段就近匹配、调度块注入
// ====================================================================
import { describe, expect, it, vi } from "vitest";
import { buildDirectionBlock, LIGHTING_PRESETS, resolveLighting, type DirectionShot } from "./cameraDirection";
import {
  matchShotForSegment,
  parseShotSchedule,
  segmentIndexFromId,
  withSegmentDirection,
} from "./shotSchedule";

function makeShot(overrides: Partial<DirectionShot> = {}): DirectionShot {
  return {
    shotNo: "SC001",
    startMs: 0,
    endMs: 3000,
    scene: "天台",
    shotType: "中景",
    emotion: "愤怒",
    ...overrides,
  };
}

// --------------------------------------------------------------------
// parseShotSchedule：契约清洗
// --------------------------------------------------------------------

describe("parseShotSchedule 逐镜表契约清洗", () => {
  it("合法逐镜表按 startMs 升序排序，类型对齐 DirectionShot", () => {
    const result = parseShotSchedule([
      makeShot({ shotNo: "SC002", startMs: 3000, endMs: 6500, emotion: "震惊" }),
      makeShot({ shotNo: "SC001", startMs: 0, endMs: 3000, action: "转身", dialogue: "你走吧" }),
    ]);
    expect(result?.map((shot) => shot.shotNo)).toEqual(["SC001", "SC002"]);
    expect(result?.[0]).toMatchObject({
      startMs: 0,
      endMs: 3000,
      scene: "天台",
      shotType: "中景",
      emotion: "愤怒",
      action: "转身",
      dialogue: "你走吧",
    });
  });

  it("shotType 非法枚举整条丢弃；emotion 非字符串归一为空串", () => {
    const result = parseShotSchedule([
      makeShot({ shotNo: "SC001", shotType: "大远景" as never }),
      makeShot({ shotNo: "SC002", startMs: 3000, endMs: 5000, emotion: 42 as never }),
    ]);
    expect(result).toHaveLength(1);
    expect(result?.[0].shotNo).toBe("SC002");
    expect(result?.[0].emotion).toBe("");
  });

  it("startMs >= endMs 或负数的镜头丢弃", () => {
    const result = parseShotSchedule([
      makeShot({ shotNo: "SC001", startMs: 3000, endMs: 3000 }),
      makeShot({ shotNo: "SC002", startMs: 5000, endMs: 4000 }),
      makeShot({ shotNo: "SC003", startMs: -100, endMs: 2000 }),
      makeShot({ shotNo: "SC004", startMs: 6000, endMs: 8000 }),
    ]);
    expect(result?.map((shot) => shot.shotNo)).toEqual(["SC004"]);
  });

  it("缺省 shotNo 自动补编号；非数组 / 全非法 / 空数组返回 undefined", () => {
    const [shot] = parseShotSchedule([{ startMs: 0, endMs: 2000, shotType: "近景" }]) ?? [];
    expect(shot.shotNo).toBe("SC001");
    expect(shot.scene).toBe("");
    expect(shot.emotion).toBe("");

    expect(parseShotSchedule(undefined)).toBeUndefined();
    expect(parseShotSchedule("not-an-array")).toBeUndefined();
    expect(parseShotSchedule([])).toBeUndefined();
    expect(parseShotSchedule([makeShot({ shotType: "特写镜头" as never })])).toBeUndefined();
  });
});

// --------------------------------------------------------------------
// segmentIndexFromId / matchShotForSegment：分段 ↔ 镜头就近匹配
// --------------------------------------------------------------------

describe("segmentIndexFromId", () => {
  it("U01 → 0，U12 → 11；无法解析返回 undefined", () => {
    expect(segmentIndexFromId("U01")).toBe(0);
    expect(segmentIndexFromId("U12")).toBe(11);
    expect(segmentIndexFromId("u02")).toBe(1);
    expect(segmentIndexFromId(undefined)).toBeUndefined();
    expect(segmentIndexFromId("EP01")).toBeUndefined();
    expect(segmentIndexFromId("")).toBeUndefined();
  });
});

describe("matchShotForSegment 就近匹配", () => {
  const shots = [
    makeShot({ shotNo: "SC001", startMs: 0, endMs: 10_000 }),
    makeShot({ shotNo: "SC002", startMs: 10_000, endMs: 20_000, scene: "病房" }),
    makeShot({ shotNo: "SC003", startMs: 20_000, endMs: 60_000, scene: "病房" }),
  ];

  it("时间窗重叠最多的镜头命中，prevShot 取前一镜", () => {
    // U02 = [15s, 30s)：与 SC003 重叠最多。
    const match = matchShotForSegment(shots, 1);
    expect(match?.shot.shotNo).toBe("SC003");
    expect(match?.prevShot?.shotNo).toBe("SC002");
  });

  it("首镜 prevShot 为 undefined；无重叠时按中点距离就近", () => {
    const first = matchShotForSegment(shots, 0);
    expect(first?.shot.shotNo).toBe("SC001");
    expect(first?.prevShot).toBeUndefined();

    // 远超逐镜表覆盖范围的分段：取中点最近的最后一镜。
    const far = matchShotForSegment(shots, 10);
    expect(far?.shot.shotNo).toBe("SC003");
  });

  it("空逐镜表返回 undefined", () => {
    expect(matchShotForSegment([], 0)).toBeUndefined();
  });
});

// --------------------------------------------------------------------
// withSegmentDirection：渲染提交前的调度块注入
// --------------------------------------------------------------------

describe("withSegmentDirection 调度块注入", () => {
  const shots = [
    makeShot({ shotNo: "SC001", startMs: 0, endMs: 10_000 }),
    makeShot({ shotNo: "SC002", startMs: 10_000, endMs: 20_000, scene: "病房", emotion: "悲伤" }),
  ];

  it("有逐镜表时调用 buildDirectionBlock 并把调度块拼在提示词前", () => {
    const buildBlock = vi.fn(() => "MOCK_BLOCK");
    const result = withSegmentDirection("原分段提示词", {
      shots,
      segmentId: "U02",
      market: "us",
      buildBlock,
    });
    expect(buildBlock).toHaveBeenCalledOnce();
    // 两镜场景不同（跨场景换光合法），不传 prevLighting
    expect(buildBlock).toHaveBeenCalledWith({
      shot: shots[1],
      prevShot: shots[0],
      market: "us",
      clothingState: undefined,
      prevLighting: undefined,
    });
    expect(result.prompt).toBe("MOCK_BLOCK\n原分段提示词");
  });

  it("真实调度块含【运镜调度】【转场指令】【光线语言】三段", () => {
    const result = withSegmentDirection("原分段提示词", {
      shots,
      segmentId: "U02",
      market: "kr",
    });
    expect(result.prompt).toContain("【运镜调度】");
    expect(result.prompt).toContain("【转场指令】");
    expect(result.prompt).toContain("【光线语言】光比+30");
    expect(result.prompt.endsWith("原分段提示词")).toBe(true);
    // 与直接调用 buildDirectionBlock 的产物一致。
    expect(result.prompt).toBe(
      `${buildDirectionBlock({ shot: shots[1], prevShot: shots[0], market: "kr" })}\n原分段提示词`,
    );
  });

  it("返回本镜实际光照参数（含情绪微调），供调用方写渲染日志", () => {
    const result = withSegmentDirection("原分段提示词", {
      shots,
      segmentId: "U02",
      market: "kr",
    });
    // SC002 情绪「悲伤」无微调 → 即 kr 预设参数
    expect(result.lighting).toEqual(LIGHTING_PRESETS.kr.params);

    const angry = withSegmentDirection("原分段提示词", {
      shots,
      segmentId: "U01",
      market: "kr",
    });
    // SC001 情绪「愤怒」→ 光比+10、色温-10
    expect(angry.lighting?.contrastRatio).toBe(LIGHTING_PRESETS.kr.params.contrastRatio + 10);
    expect(angry.lighting?.tempTint).toBe(LIGHTING_PRESETS.kr.params.tempTint - 10);
  });

  it("同一场戏内前一镜光照参与一致性校验（同场景传 prevLighting）", () => {
    const sameSceneShots = [
      makeShot({ shotNo: "SC001", startMs: 0, endMs: 10_000, emotion: "暧昧" }),
      makeShot({ shotNo: "SC002", startMs: 10_000, endMs: 20_000, emotion: "愤怒" }),
    ];
    const buildBlock = vi.fn(() => "MOCK_BLOCK");
    const result = withSegmentDirection("原分段提示词", {
      shots: sameSceneShots,
      segmentId: "U02",
      market: "kr",
      buildBlock,
    });
    // 前一镜同场景：prevLighting = 前一镜（暧昧微调后）的实际参数
    const expectedPrev = resolveLighting({
      preset: LIGHTING_PRESETS.kr,
      emotion: "暧昧",
    }).params;
    expect(buildBlock).toHaveBeenCalledWith({
      shot: sameSceneShots[1],
      prevShot: sameSceneShots[0],
      market: "kr",
      clothingState: undefined,
      prevLighting: expectedPrev,
    });
    // 同预设同场景不会翻转 → 不回滚，本镜愤怒微调生效
    expect(result.lighting?.contrastRatio).toBe(LIGHTING_PRESETS.kr.params.contrastRatio + 10);
  });

  it("无逐镜表 / 分段 id 无法解析时跳过注入，且不调用调度块组装", () => {
    const buildBlock = vi.fn(() => "MOCK_BLOCK");
    expect(
      withSegmentDirection("原分段提示词", { segmentId: "U01", market: "kr", buildBlock }),
    ).toEqual({ prompt: "原分段提示词" });
    expect(
      withSegmentDirection("原分段提示词", {
        shots: [],
        segmentId: "U01",
        market: "kr",
        buildBlock,
      }),
    ).toEqual({ prompt: "原分段提示词" });
    expect(
      withSegmentDirection("原分段提示词", { shots, segmentId: "EP01", market: "kr", buildBlock }),
    ).toEqual({ prompt: "原分段提示词" });
    expect(
      withSegmentDirection("原分段提示词", { shots, market: "kr", buildBlock }),
    ).toEqual({ prompt: "原分段提示词" });
    expect(buildBlock).not.toHaveBeenCalled();
  });
});
