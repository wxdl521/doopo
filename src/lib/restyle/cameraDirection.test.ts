// ====================================================================
// cameraDirection 纯函数测试：三层耦合、跳切红线、光照参数矩阵、调度块、补镜
// ====================================================================
import { describe, expect, it } from "vitest";
import {
  buildDirectionBlock,
  EMOTION_LIGHTING_MAX_DELTA,
  EMOTION_MOVEMENT_MAP,
  findInsertShots,
  LIGHTING_LUTS,
  LIGHTING_PRESETS,
  resolveCameraMovement,
  resolveLighting,
  resolveSceneCut,
  type DirectionShot,
  type LightingParams,
  type Market,
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
// LIGHTING_PRESETS：6 档预设的 5 维参数矩阵完整性
// --------------------------------------------------------------------

const MARKETS: Market[] = ["kr", "us", "in", "nordic", "hk", "jp"];

describe("LIGHTING_PRESETS 6 档预设完整性", () => {
  it("覆盖 6 个市场，id/nameKey/descriptionKey 齐全", () => {
    expect(Object.keys(LIGHTING_PRESETS).sort()).toEqual([...MARKETS].sort());
    for (const market of MARKETS) {
      const preset = LIGHTING_PRESETS[market];
      expect(preset.id).toBe(market);
      expect(preset.nameKey).toBe(`restyle_setup_market_${market}`);
      expect(preset.descriptionKey).toMatch(/^restyle_setup_lighting_\w+_desc$/);
    }
  });

  it.each(MARKETS)("%s：5 维参数完整，数值维在 -100~+100", (market) => {
    const { params } = LIGHTING_PRESETS[market];
    expect(params.contrastRatio).toBeGreaterThanOrEqual(-100);
    expect(params.contrastRatio).toBeLessThanOrEqual(100);
    expect(params.tempTint).toBeGreaterThanOrEqual(-100);
    expect(params.tempTint).toBeLessThanOrEqual(100);
    expect(params.palette.shadows).toBeTruthy();
    expect(params.palette.midtones).toBeTruthy();
    expect(params.palette.highlights).toBeTruthy();
    expect(params.textureRollOff).toBeTruthy();
    expect(params.skinToneOffset).toBeTruthy();
  });

  it("关键预设口径：kr 柔光偏暖阴影加蓝；nordic 低反差强冷调", () => {
    expect(LIGHTING_PRESETS.kr.params.contrastRatio).toBe(30);
    expect(LIGHTING_PRESETS.kr.params.tempTint).toBeGreaterThan(0);
    expect(LIGHTING_PRESETS.kr.params.palette.shadows).toContain("加蓝");
    expect(LIGHTING_PRESETS.kr.params.textureRollOff).toContain("奶油状扩散");
    expect(LIGHTING_PRESETS.kr.params.skinToneOffset).toContain("偏粉白");
    expect(LIGHTING_PRESETS.nordic.params.contrastRatio).toBeLessThan(0);
    expect(LIGHTING_PRESETS.nordic.params.tempTint).toBeLessThanOrEqual(-30);
  });
});

// --------------------------------------------------------------------
// resolveLighting：情绪微调（±10% 硬钳）+ 同场景一致性回滚
// --------------------------------------------------------------------

describe("resolveLighting 情绪微调", () => {
  it("未识别情绪：原样返回预设参数，无 note", () => {
    const result = resolveLighting({ preset: LIGHTING_PRESETS.kr, emotion: "中性" });
    expect(result.params).toEqual(LIGHTING_PRESETS.kr.params);
    expect(result.note).toBeUndefined();
  });

  it("愤怒 → 光比+10、色温-10（更冷更硬），附微调 note", () => {
    const result = resolveLighting({ preset: LIGHTING_PRESETS.kr, emotion: "愤怒" });
    expect(result.params.contrastRatio).toBe(LIGHTING_PRESETS.kr.params.contrastRatio + 10);
    expect(result.params.tempTint).toBe(LIGHTING_PRESETS.kr.params.tempTint - 10);
    expect(result.note).toBe("情绪「愤怒」微调：光比+10/色温-10");
  });

  it.each(["恐怖", "紧张"])("%s → 同愤怒：光比+10、色温-10", (emotion) => {
    const result = resolveLighting({ preset: LIGHTING_PRESETS.us, emotion });
    expect(result.params.contrastRatio).toBe(LIGHTING_PRESETS.us.params.contrastRatio + 10);
    expect(result.params.tempTint).toBe(LIGHTING_PRESETS.us.params.tempTint - 10);
  });

  it.each(["暧昧", "浪漫"])("%s → 色温+10、光比-10", (emotion) => {
    const result = resolveLighting({ preset: LIGHTING_PRESETS.nordic, emotion });
    expect(result.params.contrastRatio).toBe(LIGHTING_PRESETS.nordic.params.contrastRatio - 10);
    expect(result.params.tempTint).toBe(LIGHTING_PRESETS.nordic.params.tempTint + 10);
  });

  it("微调幅度硬钳 ±10%：任何情绪的数值偏移不超过 ±10", () => {
    for (const emotion of ["愤怒", "暧昧", "恐怖", "紧张", "浪漫"]) {
      const result = resolveLighting({ preset: LIGHTING_PRESETS.jp, emotion });
      expect(
        Math.abs(result.params.contrastRatio - LIGHTING_PRESETS.jp.params.contrastRatio),
      ).toBeLessThanOrEqual(EMOTION_LIGHTING_MAX_DELTA);
      expect(
        Math.abs(result.params.tempTint - LIGHTING_PRESETS.jp.params.tempTint),
      ).toBeLessThanOrEqual(EMOTION_LIGHTING_MAX_DELTA);
    }
  });

  it("微调不改动调色盘/质感/肤色三维", () => {
    const result = resolveLighting({ preset: LIGHTING_PRESETS.hk, emotion: "愤怒" });
    expect(result.params.palette).toEqual(LIGHTING_PRESETS.hk.params.palette);
    expect(result.params.textureRollOff).toBe(LIGHTING_PRESETS.hk.params.textureRollOff);
    expect(result.params.skinToneOffset).toBe(LIGHTING_PRESETS.hk.params.skinToneOffset);
  });
});

describe("resolveLighting 同场景一致性（硬规则）", () => {
  const warmPrev: LightingParams = {
    ...LIGHTING_PRESETS.kr.params,
    palette: { ...LIGHTING_PRESETS.kr.params.palette },
  };

  it("色温符号翻转 → 回滚为 prevLighting 并附回滚 note", () => {
    const coldPrev: LightingParams = {
      ...LIGHTING_PRESETS.nordic.params,
      palette: { ...LIGHTING_PRESETS.nordic.params.palette },
    };
    const result = resolveLighting({
      preset: LIGHTING_PRESETS.kr, // tempTint +20，与 nordic 的 -60 符号相反
      emotion: "中性",
      prevLighting: coldPrev,
    });
    expect(result.params).toEqual(coldPrev);
    expect(result.note).toBe("相邻镜头光照方向突变，已回滚保持缓变");
  });

  it("阴影色相大类改变（加蓝 → 偏橙红）→ 同样触发回滚", () => {
    const result = resolveLighting({
      preset: LIGHTING_PRESETS.in, // 阴影偏橙红，与 kr 的加蓝色相大类不同；色温同向不翻转
      emotion: "中性",
      prevLighting: warmPrev,
    });
    expect(result.params).toEqual(warmPrev);
    expect(result.note).toBe("相邻镜头光照方向突变，已回滚保持缓变");
  });

  it("同向缓变不触发回滚：情绪微调照常生效", () => {
    const result = resolveLighting({
      preset: LIGHTING_PRESETS.kr,
      emotion: "愤怒",
      prevLighting: warmPrev, // 同预设同场景：色温 +20 → +10 仍为正，阴影色相不变
    });
    expect(result.params.contrastRatio).toBe(LIGHTING_PRESETS.kr.params.contrastRatio + 10);
    expect(result.params.tempTint).toBe(LIGHTING_PRESETS.kr.params.tempTint - 10);
    expect(result.note).toBe("情绪「愤怒」微调：光比+10/色温-10");
  });

  it("prevLighting 缺省时不做一致性校验", () => {
    const result = resolveLighting({ preset: LIGHTING_PRESETS.kr, emotion: "愤怒" });
    expect(result.note).toBe("情绪「愤怒」微调：光比+10/色温-10");
  });
});

// --------------------------------------------------------------------
// LIGHTING_LUTS：兼容导出（由 params 生成的一行式简述）
// --------------------------------------------------------------------

describe("LIGHTING_LUTS 兼容导出", () => {
  it("6 个市场均有由 5 维参数生成的简述（供现有面板/提示词沿用）", () => {
    expect(Object.keys(LIGHTING_LUTS).sort()).toEqual([...MARKETS].sort());
    for (const market of MARKETS) {
      const brief = LIGHTING_LUTS[market];
      expect(brief.length).toBeGreaterThanOrEqual(4);
      expect(brief.every((item) => typeof item === "string" && item.length > 0)).toBe(true);
    }
  });

  it("简述内容与预设参数一致（kr：光比+30 / 色温偏暖 / 阴影加蓝 / 肤色偏粉白）", () => {
    expect(LIGHTING_LUTS.kr.join(" · ")).toContain("光比+30");
    expect(LIGHTING_LUTS.kr.join(" · ")).toContain("偏暖");
    expect(LIGHTING_LUTS.kr.join(" · ")).toContain("阴影加蓝");
    expect(LIGHTING_LUTS.kr.join(" · ")).toContain("肤色偏粉白");
    expect(LIGHTING_LUTS.us.join(" · ")).toContain("硬朗高反差");
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

  it("光线语言段逐条渲染 5 维参数（光比/色温/调色盘/质感衰减/肤色保护）", () => {
    const block = buildDirectionBlock({
      shot: makeShot(),
      market: "kr",
    });
    const line = block.split("\n").find((item) => item.startsWith("【光线语言】"))!;
    expect(line).toContain("光比+30");
    expect(line).toContain("色温+20");
    expect(line).toContain("调色盘[阴影加蓝");
    expect(line).toContain("质感衰减[");
    expect(line).toContain("肤色保护[");
  });

  it("光线语言段尾附情绪微调 note；一致性回滚时附回滚 note", () => {
    const tweaked = buildDirectionBlock({
      shot: makeShot({ emotion: "愤怒", shotType: "中景" }),
      market: "kr",
    });
    expect(tweaked).toContain("情绪「愤怒」微调：光比+10/色温-10");

    const rolledBack = buildDirectionBlock({
      shot: makeShot({ emotion: "中性" }),
      market: "kr",
      prevLighting: LIGHTING_PRESETS.nordic.params, // 色温符号翻转 → 强制回滚
    });
    expect(rolledBack).toContain("相邻镜头光照方向突变，已回滚保持缓变");
    expect(rolledBack).toContain("色温-60");
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
