// ====================================================================
// v1AnalysisAdapter 纯函数测试：字段映射 / 枚举归一 / 台词格式 / 证据包长度
// ====================================================================
import { describe, expect, it } from "vitest";
import type { AlignedSentence, MergedShot } from "./analysisMerge";
import {
  alignedSentencesToTranscript,
  buildEvidencePackage,
  formatShotBrief,
  MAX_EVIDENCE_PACKAGE_CHARS,
  mergedShotToDirectionShot,
  normalizeShotType,
} from "./v1AnalysisAdapter";

function makeMergedShot(overrides: Partial<MergedShot> = {}): MergedShot {
  return {
    shot_no: "SC001",
    source_shot_no: "S01",
    unitId: "part-001",
    start_ms: 0,
    end_ms: 4000,
    shot_type: "特写",
    spatial_anchor: "街角面馆",
    end_state_action: "男主摔门而出",
    emotion: "愤怒",
    dialogue: "你走吧",
    ...overrides,
  };
}

// --------------------------------------------------------------------
// normalizeShotType：六档中文枚举归一
// --------------------------------------------------------------------

describe("normalizeShotType", () => {
  it("合法六档原样透传", () => {
    for (const type of ["特写", "大特写", "近景", "中景", "全景", "远景"] as const) {
      expect(normalizeShotType(type)).toBe(type);
    }
  });

  it("v2 七档的「大远景」并入「远景」", () => {
    expect(normalizeShotType("大远景")).toBe("远景");
  });

  it("英文档位映射到最近中文档", () => {
    expect(normalizeShotType("close-up")).toBe("特写");
    expect(normalizeShotType("Extreme Close-Up")).toBe("大特写");
    expect(normalizeShotType("medium shot")).toBe("中景");
    expect(normalizeShotType("wide shot")).toBe("远景");
    expect(normalizeShotType("full shot")).toBe("全景");
  });

  it("完全无法识别的值归一到中性档「中景」，不丢弃镜头", () => {
    expect(normalizeShotType("某种运镜")).toBe("中景");
    expect(normalizeShotType(undefined)).toBe("中景");
    expect(normalizeShotType(42)).toBe("中景");
  });
});

// --------------------------------------------------------------------
// mergedShotToDirectionShot：字段映射
// --------------------------------------------------------------------

describe("mergedShotToDirectionShot", () => {
  it("字段改名：shot_no/start_ms/end_state_action → shotNo/startMs/action", () => {
    const shot = mergedShotToDirectionShot(makeMergedShot());
    expect(shot).toEqual({
      shotNo: "SC001",
      startMs: 0,
      endMs: 4000,
      scene: "街角面馆",
      shotType: "特写",
      emotion: "愤怒",
      action: "男主摔门而出",
      dialogue: "你走吧",
    });
  });

  it("scene ← spatial_anchor（v2 无物理场景名，用空间锚点近似）", () => {
    expect(mergedShotToDirectionShot(makeMergedShot({ spatial_anchor: "居民楼客厅" })).scene).toBe(
      "居民楼客厅",
    );
    expect(mergedShotToDirectionShot(makeMergedShot({ spatial_anchor: undefined })).scene).toBe("");
  });

  it("非法 shot_type 归一而非丢弃", () => {
    expect(mergedShotToDirectionShot(makeMergedShot({ shot_type: "大远景" })).shotType).toBe(
      "远景",
    );
    expect(mergedShotToDirectionShot(makeMergedShot({ shot_type: "???" })).shotType).toBe("中景");
  });

  it("可省略字段缺失时为 undefined / 空串", () => {
    const shot = mergedShotToDirectionShot(
      makeMergedShot({ end_state_action: undefined, dialogue: undefined, emotion: undefined }),
    );
    expect(shot.action).toBeUndefined();
    expect(shot.dialogue).toBeUndefined();
    expect(shot.emotion).toBe("");
  });
});

// --------------------------------------------------------------------
// alignedSentencesToTranscript：复刻 formatTranscript 的 [mm:ss] 角色：台词
// --------------------------------------------------------------------

describe("alignedSentencesToTranscript", () => {
  it("按 begin_ms 排序并输出 [mm:ss] 角色：台词", () => {
    const sentences: AlignedSentence[] = [
      { begin_ms: 65_000, end_ms: 67_000, text: "第二句", speaker: "角色B", shot_no: null },
      { begin_ms: 12_000, end_ms: 14_000, text: "第一句", speaker: "角色A", shot_no: "SC001" },
    ];
    const text = alignedSentencesToTranscript(sentences);
    expect(text).toBe("[00:12] 角色A：第一句\n[01:05] 角色B：第二句");
  });

  it("speaker 缺失或 unknown 时省略角色前缀", () => {
    const sentences: AlignedSentence[] = [
      { begin_ms: 1000, end_ms: 2000, text: "旁白句", speaker: "unknown", shot_no: null },
      { begin_ms: 3000, end_ms: 4000, text: "无说话人", shot_no: null },
    ];
    const text = alignedSentencesToTranscript(sentences);
    expect(text).toBe("[00:01] 旁白句\n[00:03] 无说话人");
  });

  it("空数组返回空串", () => {
    expect(alignedSentencesToTranscript([])).toBe("");
  });
});

// --------------------------------------------------------------------
// buildEvidencePackage：结构与长度硬上限
// --------------------------------------------------------------------

describe("buildEvidencePackage", () => {
  it("包含概览、资产线索、逐镜表与台词四个段落", () => {
    const text = buildEvidencePackage(
      {
        overview: "男女主在面馆决裂。",
        assets: [
          {
            kind: "character",
            source_name: "男主",
            aliases: [],
            first_seen_ms: 0,
            last_seen_ms: 4000,
            appearance: null,
            wardrobe: null,
            description: "短发青年",
            relationships: [],
            uncertainty: [],
          },
        ],
      },
      [
        {
          shotNo: "SC001",
          startMs: 0,
          endMs: 4000,
          scene: "街角面馆",
          shotType: "特写",
          emotion: "愤怒",
          action: "男主摔门而出",
        },
      ],
      "[00:01] 男主：你走吧",
    );
    expect(text).toContain("[整片概览]\n男女主在面馆决裂。");
    expect(text).toContain("角色：男主（短发青年）");
    expect(text).toContain("SC001 00:00-00:04 特写|街角面馆|男主摔门而出");
    expect(text).toContain("[全片台词]\n[00:01] 男主：你走吧");
  });

  it("超长输入（600 镜 + 长台词）总长不超过硬上限", () => {
    const shots = Array.from({ length: 600 }, (_, i) => ({
      shotNo: `SC${String(i + 1).padStart(3, "0")}`,
      startMs: i * 1000,
      endMs: i * 1000 + 900,
      scene: "场景名称比较长的那种物理空间",
      shotType: "中景" as const,
      emotion: "中性",
      action: "一段用来撑长度的动作描述文本，描述该镜头内人物的具体行为",
    }));
    const transcript = Array.from({ length: 300 }, (_, i) => `[00:${String(i % 60).padStart(2, "0")}] 角色A：${"长台词".repeat(20)}`).join("\n");
    const text = buildEvidencePackage({ overview: "概览", assets: [] }, shots, transcript);
    expect(text.length).toBeLessThanOrEqual(MAX_EVIDENCE_PACKAGE_CHARS);
    // 超预算时均匀抽稀而非截尾：首镜与末镜都必须保留
    expect(text).toContain("SC001 ");
    expect(text).toContain("SC600 ");
    expect(text).toContain("台词过长已截断");
  });

  it("空逐镜表与空台词时输出占位", () => {
    const text = buildEvidencePackage({ overview: "", assets: [] }, [], "");
    expect(text).toContain("（无）");
    expect(text).toContain("（未识别到具体资产）");
    expect(text).toContain("（无台词）");
  });
});

// --------------------------------------------------------------------
// formatShotBrief：压缩行 + 均匀抽稀
// --------------------------------------------------------------------

describe("formatShotBrief", () => {
  const shots = Array.from({ length: 100 }, (_, i) => ({
    shotNo: `SC${String(i + 1).padStart(3, "0")}`,
    startMs: i * 3000,
    endMs: i * 3000 + 2500,
    scene: "客厅",
    shotType: "近景" as const,
    emotion: "中性",
    action: "对话",
  }));

  it("预算充足时全量输出", () => {
    const text = formatShotBrief(shots, 100_000);
    expect(text.split("\n")).toHaveLength(100);
    expect(text).toContain("SC100 ");
  });

  it("超预算时均匀抽稀且不截尾", () => {
    const text = formatShotBrief(shots, 400);
    expect(text.length).toBeLessThanOrEqual(400);
    expect(text).toContain("SC001 ");
    expect(text).toContain("SC100 ");
  });
});


// --------------------------------------------------------------------
// shot_role / long_take 透传（台词轴确定性细分产出，为分组利用反应镜头铺路）
// --------------------------------------------------------------------

describe("mergedShotToDirectionShot · shot_role/long_take 透传", () => {
  it("合法 shot_role 与 long_take 透传", () => {
    const shot = mergedShotToDirectionShot(
      makeMergedShot({ shot_role: "reaction", long_take: true } as Partial<MergedShot>),
    );
    expect(shot.shotRole).toBe("reaction");
    expect(shot.longTake).toBe(true);
  });

  it("非法 shot_role 值丢弃；缺省字段为 undefined", () => {
    const bad = mergedShotToDirectionShot(
      makeMergedShot({ shot_role: "weird" } as Partial<MergedShot>),
    );
    expect(bad.shotRole).toBeUndefined();
    expect(bad.longTake).toBeUndefined();
    const plain = mergedShotToDirectionShot(makeMergedShot());
    expect(plain.shotRole).toBeUndefined();
    expect(plain.longTake).toBeUndefined();
  });
});
