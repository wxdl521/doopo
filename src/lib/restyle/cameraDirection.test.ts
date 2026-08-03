// ====================================================================
// cameraDirection 纯函数测试：三层耦合、跳切红线、LUT、调度块、补镜
// ====================================================================
import { describe, expect, it } from "vitest";
import {
  buildDirectionBlock,
  EMOTION_MOVEMENT_MAP,
  findInsertShots,
  LIGHTING_LUTS,
  resolveCameraMovement,
  resolveSceneCut,
  type DirectionShot,
} from "./cameraDirection";

function makeShot(overrides: Partial<DirectionShot> = {}): DirectionShot {
  return {
    shotNo: "SC001",
    startMs: 0,
    endMs: 3000,
    scene: "天台",
    shotType: "中景",
    emotion: "中性",
    ...overrides,
  };
}

// --------------------------------------------------------------------
// resolveCameraMovement：情绪 → 运镜映射
// --------------------------------------------------------------------

describe("resolveCameraMovement 情绪映射", () => {
  it.each([
    ["愤怒", "手持晃动+急速推近"],
    ["暧昧", "缓慢环绕+呼吸感微动"],
    ["紧张", "缓推+短切"],
    ["舒缓", "横移+长镜头"],
    ["震惊", "急推+定帧"],
    ["悲伤", "缓降+固定"],
  ] as const)("%s → %s", (emotion, movement) => {
    // 用「近景」避开两类适配改写，验证纯映射
    const result = resolveCameraMovement({ emotion, shotType: "近景" });
    expect(result.movement).toBe(movement);
    expect(result.adjustedShotType).toBe("近景");
    expect(result.note).toBeUndefined();
    expect(EMOTION_MOVEMENT_MAP[emotion]).toBe(movement);
  });

  it("未知情绪兜底：保持原片运镜，景别原样", () => {
    const result = resolveCameraMovement({ emotion: "狂喜", shotType: "全景" });
    expect(result).toEqual({
      movement: "保持原片运镜",
      adjustedShotType: "全景",
    });
  });

  it("中性情绪同样走兜底", () => {
    const result = resolveCameraMovement({ emotion: "中性", shotType: "特写" });
    expect(result.movement).toBe("保持原片运镜");
    expect(result.adjustedShotType).toBe("特写");
  });
});

// --------------------------------------------------------------------
// resolveCameraMovement：景别适配性检查
// --------------------------------------------------------------------

describe("resolveCameraMovement 景别适配", () => {
  it("全景 + 急速推近（愤怒）→ 升级为中景并带 note", () => {
    const result = resolveCameraMovement({ emotion: "愤怒", shotType: "全景" });
    expect(result.movement).toBe("手持晃动+急速推近");
    expect(result.adjustedShotType).toBe("中景");
    expect(result.note).toBe("景别为运镜让路：全景升级为中景以承载推近");
  });

  it("远景 + 急推（震惊）→ 升级为中景", () => {
    const result = resolveCameraMovement({ emotion: "震惊", shotType: "远景" });
    expect(result.adjustedShotType).toBe("中景");
    expect(result.note).toContain("升级为中景以承载推近");
  });

  it("大特写 + 缓慢环绕（暧昧）→ 锁定为固定机位微移", () => {
    const result = resolveCameraMovement({ emotion: "暧昧", shotType: "大特写" });
    expect(result.movement).toBe("固定机位微移");
    expect(result.adjustedShotType).toBe("大特写");
    expect(result.note).toContain("锁定为固定机位微移");
  });

  it("特写 + 手持晃动（愤怒：晃动但非急速推近落宽景）→ 固定机位微移", () => {
    const result = resolveCameraMovement({ emotion: "愤怒", shotType: "特写" });
    expect(result.movement).toBe("固定机位微移");
    expect(result.adjustedShotType).toBe("特写");
  });

  it("中景 + 急速推近（愤怒）→ 无需改写", () => {
    const result = resolveCameraMovement({ emotion: "愤怒", shotType: "中景" });
    expect(result.movement).toBe("手持晃动+急速推近");
    expect(result.adjustedShotType).toBe("中景");
    expect(result.note).toBeUndefined();
  });

  it("近景 + 缓慢环绕（暧昧）→ 无需改写", () => {
    const result = resolveCameraMovement({ emotion: "暧昧", shotType: "近景" });
    expect(result.movement).toBe("缓慢环绕+呼吸感微动");
    expect(result.note).toBeUndefined();
  });
});

// --------------------------------------------------------------------
// resolveSceneCut：跳切红线
// --------------------------------------------------------------------

describe("resolveSceneCut", () => {
  it("同场景且戏未变 → continuous，禁止跳切（绝对红线）", () => {
    const result = resolveSceneCut({
      prevScene: "天台",
      scene: "天台",
      dramaChanged: false,
    });
    expect(result).toEqual({ type: "continuous", hint: "禁止跳切" });
  });

  it("场景变了 → transition，叠化或闪白保持动作连续", () => {
    const result = resolveSceneCut({
      prevScene: "天台",
      scene: "地下车库",
      dramaChanged: false,
    });
    expect(result).toEqual({
      type: "transition",
      method: "叠化或闪白，保持动作连续",
    });
  });

  it("场景变化优先于戏变（戏变标志不影响转场判定）", () => {
    const result = resolveSceneCut({
      prevScene: "天台",
      scene: "地下车库",
      dramaChanged: true,
    });
    expect(result.type).toBe("transition");
  });

  it("同场景但戏变 → llm_decide，交导演模型判断，禁止硬跳切", () => {
    const result = resolveSceneCut({
      prevScene: "天台",
      scene: "天台",
      dramaChanged: true,
    });
    expect(result).toEqual({
      type: "llm_decide",
      hint: "交导演模型判断抽帧加速或慢放加音效冲击，禁止硬跳切",
    });
  });
});

// --------------------------------------------------------------------
// LIGHTING_LUTS
// --------------------------------------------------------------------

describe("LIGHTING_LUTS", () => {
  it("韩剧：阿宝色调 + 柔光漫反射 + 圣光光晕 + 阴影加蓝", () => {
    expect(LIGHTING_LUTS.kr).toEqual([
      "阿宝色调",
      "柔光漫反射",
      "逆光位带圣光光晕",
      "阴影区加蓝",
    ]);
  });

  it("美剧：高对比度 + 硬光切边 + 暗部死黑 + 高光细节", () => {
    expect(LIGHTING_LUTS.us).toEqual([
      "高对比度",
      "硬光切边",
      "暗部死黑保留质感",
      "高光区保留细节（FilmLight 风格）",
    ]);
  });

  it("印度剧：高饱和暖黄 + 面部过曝半档 + 眼白牙齿提亮", () => {
    expect(LIGHTING_LUTS.in).toEqual([
      "高饱和暖黄",
      "面部过曝半档",
      "眼白与牙齿单独提亮",
    ]);
  });
});

// --------------------------------------------------------------------
// buildDirectionBlock
// --------------------------------------------------------------------

describe("buildDirectionBlock", () => {
  it("四段齐全且顺序固定：运镜调度 → 转场指令 → 光线语言 → 服装引导", () => {
    const block = buildDirectionBlock({
      shot: makeShot({ shotNo: "SC002", emotion: "愤怒", shotType: "全景" }),
      prevShot: makeShot({ shotNo: "SC001", scene: "办公室" }),
      market: "kr",
      clothingState: "黑色皮衣",
    });
    const lines = block.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^【运镜调度】/);
    expect(lines[1]).toMatch(/^【转场指令】/);
    expect(lines[2]).toMatch(/^【光线语言】/);
    expect(lines[3]).toMatch(/^【服装引导】/);
  });

  it("运镜调度段包含 adjustedShotType 与 note", () => {
    const block = buildDirectionBlock({
      shot: makeShot({ emotion: "愤怒", shotType: "全景" }),
      market: "us",
    });
    expect(block).toContain("景别：中景");
    expect(block).toContain("景别为运镜让路：全景升级为中景以承载推近");
  });

  it("无 prevShot（首镜）时省略转场指令段", () => {
    const block = buildDirectionBlock({
      shot: makeShot(),
      market: "in",
    });
    expect(block).not.toContain("【转场指令】");
    const lines = block.split("\n");
    expect(lines[0]).toMatch(/^【运镜调度】/);
    expect(lines[1]).toMatch(/^【光线语言】/);
  });

  it("转场指令段呈现 resolveSceneCut 结果", () => {
    const transitionBlock = buildDirectionBlock({
      shot: makeShot({ scene: "地下车库" }),
      prevShot: makeShot({ scene: "天台" }),
      market: "kr",
    });
    expect(transitionBlock).toContain("转场：叠化或闪白，保持动作连续");

    const continuousBlock = buildDirectionBlock({
      shot: makeShot({ scene: "天台" }),
      prevShot: makeShot({ scene: "天台" }),
      market: "kr",
    });
    expect(continuousBlock).toContain("禁止跳切");

    const dramaBlock = buildDirectionBlock({
      shot: makeShot({ scene: "天台" }),
      prevShot: makeShot({ scene: "天台" }),
      dramaChanged: true,
      market: "kr",
    });
    expect(dramaBlock).toContain("交导演模型判断");
  });

  it("光线语言段逐条列出目标市场 LUT", () => {
    const block = buildDirectionBlock({
      shot: makeShot(),
      market: "kr",
    });
    expect(block).toContain("阿宝色调；柔光漫反射；逆光位带圣光光晕；阴影区加蓝");
  });

  it("含 clothingState 时输出服装软引导句", () => {
    const block = buildDirectionBlock({
      shot: makeShot(),
      market: "us",
      clothingState: "黑色皮衣",
    });
    expect(block).toContain("角色仅锚定面部特征与体型骨架");
    expect(block).toContain("当前着装：黑色皮衣");
    expect(block).toContain("不锁定服装编号");
  });

  it("不传 clothingState 时省略服装引导段", () => {
    const block = buildDirectionBlock({
      shot: makeShot(),
      market: "us",
    });
    expect(block).not.toContain("【服装引导】");
  });
});

// --------------------------------------------------------------------
// findInsertShots：补镜触发点
// --------------------------------------------------------------------

describe("findInsertShots", () => {
  it("A 类：震惊 + 中景 → 情绪高点补特写，插在该镜之后 0.5s", () => {
    const inserts = findInsertShots([
      makeShot({ shotNo: "SC001", emotion: "震惊", shotType: "中景" }),
    ]);
    expect(inserts).toEqual([
      {
        kind: "closeup",
        afterShotNo: "SC001",
        reason: "情绪高点补特写",
        insertDurationSec: 0.5,
      },
    ]);
  });

  it("A 类：落泪 + 全景/远景 同样触发", () => {
    for (const shotType of ["全景", "远景"] as const) {
      const inserts = findInsertShots([
        makeShot({ emotion: "落泪", shotType }),
      ]);
      expect(inserts).toHaveLength(1);
      expect(inserts[0].kind).toBe("closeup");
    }
  });

  it("A 类不触发：中性情绪，或震惊落在特写/近景", () => {
    expect(
      findInsertShots([makeShot({ emotion: "中性", shotType: "中景" })]),
    ).toEqual([]);
    expect(
      findInsertShots([makeShot({ emotion: "震惊", shotType: "特写" })]),
    ).toEqual([]);
    expect(
      findInsertShots([makeShot({ emotion: "落泪", shotType: "近景" })]),
    ).toEqual([]);
  });

  it("B 类：相邻两镜场景不同 → 场景转换补空镜，插在后一镜之前 1s", () => {
    const inserts = findInsertShots([
      makeShot({ shotNo: "SC001", scene: "天台" }),
      makeShot({ shotNo: "SC002", scene: "地下车库", startMs: 3000, endMs: 6000 }),
    ]);
    expect(inserts).toEqual([
      {
        kind: "establishing",
        beforeShotNo: "SC002",
        reason: "场景转换补空镜",
        insertDurationSec: 1,
      },
    ]);
  });

  it("B 类不触发：相邻镜头同场景", () => {
    const inserts = findInsertShots([
      makeShot({ shotNo: "SC001", scene: "天台" }),
      makeShot({ shotNo: "SC002", scene: "天台", startMs: 3000, endMs: 6000 }),
    ]);
    expect(inserts).toEqual([]);
  });

  it("A/B 可同时命中同一镜（震惊中景且场景切换）", () => {
    const inserts = findInsertShots([
      makeShot({ shotNo: "SC001", scene: "天台" }),
      makeShot({
        shotNo: "SC002",
        scene: "地下车库",
        emotion: "震惊",
        shotType: "中景",
        startMs: 3000,
        endMs: 6000,
      }),
    ]);
    expect(inserts).toHaveLength(2);
    expect(inserts.map((i) => i.kind).sort()).toEqual([
      "closeup",
      "establishing",
    ]);
  });

  it("空序列返回空数组", () => {
    expect(findInsertShots([])).toEqual([]);
  });
});
