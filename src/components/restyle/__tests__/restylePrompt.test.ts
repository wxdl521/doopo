import { describe, expect, it } from "vitest";
import { buildAssetImagePrompt, looksLikeStyleBrief, withStyleBrief } from "../restylePrompt";

const asset = {
  kind: "character" as const,
  sourceName: "院长",
  sourceDescription: "医院院长，中年男性",
  targetName: "Director Hall",
  targetDescription: "美国郊区医院院长",
};

describe("restyle prompt", () => {
  it("always includes the style contract", () => {
    const prompt = buildAssetImagePrompt(asset, "美式 3D 动画风格", "");
    expect(prompt).toContain("【目标画风·必须严格遵守】美式 3D 动画风格");
    expect(prompt).toContain("Director Hall");
  });

  it("ignores confirmation-style messages as extra requirements", () => {
    for (const message of ["确认", "继续下一步", "按资产表生成全部资产图"]) {
      expect(buildAssetImagePrompt(asset, "日漫赛璐璐", message)).not.toContain("【本次补充要求】");
    }
  });

  it("keeps real revision requests", () => {
    const prompt = buildAssetImagePrompt(asset, "日漫赛璐璐", "把发色改成银白");
    expect(prompt).toContain("【本次补充要求】把发色改成银白");
  });

  it("detects style briefs and prefixes plan instructions", () => {
    expect(looksLikeStyleBrief("把整部剧转成美式3D动画风格")).toBe(true);
    expect(looksLikeStyleBrief("确认")).toBe(false);
    expect(withStyleBrief("生成转绘方案", "日漫赛璐璐")).toContain("【目标画风·必须严格遵守】");
    expect(withStyleBrief("生成转绘方案", "  ")).toBe("生成转绘方案");
  });
});