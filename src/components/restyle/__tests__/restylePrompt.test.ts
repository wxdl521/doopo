import { describe, expect, it } from "vitest";
import {
  buildAssetImagePrompt,
  buildRelationBrief,
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

  it("injects character relations into character asset prompts", () => {
    const relations = [
      { fromName: "Director Hall", toName: "Nurse Lin", relation: "雇主", note: "EP01 对手戏" },
      { fromName: "Nurse Lin", toName: "Director Hall", relation: "雇员" },
      { fromName: "Driver Wang", toName: "Nurse Lin", relation: "兄妹" },
    ];
    const brief = buildRelationBrief(relations, "Director Hall");
    expect(brief).toContain("【人物关系·不得矛盾】");
    expect(brief).toContain("Director Hall → Nurse Lin：雇主（EP01 对手戏）");
    expect(brief).toContain("Nurse Lin → Director Hall：雇员");
    // focusName 之外的边不注入该角色的提示词。
    expect(brief).not.toContain("Driver Wang");

    const prompt = buildAssetImagePrompt(asset, "美式 3D 动画风格", "", brief);
    expect(prompt).toContain("【人物关系·不得矛盾】");
    // 非角色资产不带关系约束；空关系也不留空行。
    const scenePrompt = buildAssetImagePrompt(
      { ...asset, kind: "scene" as const },
      "美式 3D 动画风格",
      "",
      brief,
    );
    expect(scenePrompt).not.toContain("【人物关系");
    expect(buildRelationBrief([])).toBe("");
  });

  it("角色资产的服装描述降级为软引导（锚定面部/骨架，不硬锁），非角色资产不带", () => {
    const prompt = buildAssetImagePrompt(asset, "美式 3D 动画风格");
    expect(prompt).toContain("【服装引导】");
    expect(prompt).toContain("仅锚定面部特征与体型骨架");
    expect(prompt).toContain("不做像素级强制锁定");

    const scenePrompt = buildAssetImagePrompt(
      { ...asset, kind: "scene" as const },
      "美式 3D 动画风格",
    );
    expect(scenePrompt).not.toContain("【服装引导】");
  });
});