import { describe, expect, it } from "vitest";
import {
  buildAssetImagePrompt,
  looksLikeStyleBrief,
  resolveAssetImagePrompt,
  withStyleBrief,
} from "../restylePrompt";

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
    expect(prompt).toContain("【本次修正要求·优先级最高】把发色改成银白");
    // 修正必须排在目标设定之前，否则会被跑偏的旧设定压过去。
    expect(prompt.indexOf("【本次修正要求·优先级最高】")).toBeLessThan(
      prompt.indexOf("【目标设定】"),
    );
  });

  it("detects style briefs and prefixes plan instructions", () => {
    expect(looksLikeStyleBrief("把整部剧转成美式3D动画风格")).toBe(true);
    expect(looksLikeStyleBrief("确认")).toBe(false);
    expect(withStyleBrief("生成转绘方案", "日漫赛璐璐")).toContain("【目标画风·必须严格遵守】");
    expect(withStyleBrief("生成转绘方案", "  ")).toBe("生成转绘方案");
  });

  it("prefers the manual prompt override when present", () => {
    const prompt = resolveAssetImagePrompt(
      { ...asset, promptOverride: "用户手工改过的提示词" },
      "美式 3D 动画风格",
      "确认",
    );
    expect(prompt).toBe("用户手工改过的提示词");
  });

  it("prepends the current correction even when an override exists", () => {
    const prompt = resolveAssetImagePrompt(
      { ...asset, promptOverride: "用户手工改过的提示词" },
      "美式 3D 动画风格",
      "场景图片生成不对，请重新生成",
    );
    expect(prompt).toContain("场景图片生成不对，请重新生成");
    expect(prompt.indexOf("场景图片生成不对")).toBeLessThan(prompt.indexOf("用户手工改过的提示词"));
  });

  it("falls back to the auto-built prompt after the override is cleared", () => {
    const prompt = resolveAssetImagePrompt(
      { ...asset, promptOverride: undefined },
      "日漫赛璐璐",
    );
    expect(prompt).toBe(buildAssetImagePrompt(asset, "日漫赛璐璐"));
    expect(prompt).toContain("【目标画风·必须严格遵守】日漫赛璐璐");
  });

  it("treats a blank override as no override", () => {
    const prompt = resolveAssetImagePrompt({ ...asset, promptOverride: "   " }, "日漫赛璐璐");
    expect(prompt).toBe(buildAssetImagePrompt(asset, "日漫赛璐璐"));
  });
});