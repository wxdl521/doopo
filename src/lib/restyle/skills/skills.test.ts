import { describe, expect, it } from "vitest";
import { SKILLS, composePrompt } from "./index";

const EXPECTED_SKILL_IDS = [
  "video-analysis-extract",
  "shot-boundary-extract",
  "audio-transcript-align",
  "ai-output-review",
  "narrative-consistency-audit",
  "character-bible",
  "wardrobe-continuity",
  "shot-to-segment",
  "restyle-prompt-contract",
];

describe("SKILLS", () => {
  it("包含全部 9 个 skill，且每个都有非空内容", () => {
    expect(Object.keys(SKILLS).sort()).toEqual([...EXPECTED_SKILL_IDS].sort());
    for (const id of EXPECTED_SKILL_IDS) {
      expect(typeof SKILLS[id]).toBe("string");
      expect(SKILLS[id].length).toBeGreaterThan(0);
    }
  });
});

describe("composePrompt", () => {
  it("输出包含各 skill 标题与 context", () => {
    const prompt = composePrompt(
      ["video-analysis-extract", "shot-to-segment"],
      "分析 EP01_part-001，偏移 0s。",
    );
    expect(prompt).toContain("# video-analysis-extract");
    expect(prompt).toContain("# shot-to-segment");
    expect(prompt).not.toContain("# character-bible");
    expect(prompt).toContain("[CONTEXT]");
    expect(prompt).toContain("分析 EP01_part-001，偏移 0s。");
    // skill 顺序保持传入顺序
    expect(prompt.indexOf("# video-analysis-extract")).toBeLessThan(
      prompt.indexOf("# shot-to-segment"),
    );
  });

  it("未知 skill id 抛错", () => {
    expect(() => composePrompt(["not-a-skill"], "ctx")).toThrow("Unknown skill id");
  });

  it("restyle-prompt-contract 明写锁定区与可编辑区", () => {
    const contract = SKILLS["restyle-prompt-contract"];
    expect(contract).toContain("锁定区");
    expect(contract).toContain("可编辑区");
    expect(contract).toContain("参考图映射行");
    expect(contract).toContain("全局约束行");
    expect(contract).toContain("doopooShot");
  });

  it("shot-boundary-extract 明写三条铁律与 shot_role 契约", () => {
    const skill = SKILLS["shot-boundary-extract"];
    expect(skill).toContain("禁止摘要合并");
    expect(skill).toContain("反应镜头独立成镜");
    expect(skill).toContain("切在动作瞬间");
    expect(skill).toContain("speaker");
    expect(skill).toContain("reaction");
    expect(skill).toContain("insert");
    expect(skill).toContain("long_take");
  });
});
