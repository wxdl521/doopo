// ====================================================================
// matchAssetImageRegen 纯函数测试（工作区聊天「重新生成 XX 的图片」指令）
// ====================================================================
import { describe, expect, it } from "vitest";
import { matchAssetImageRegen } from "../workspaceAgent.functions";

describe("matchAssetImageRegen", () => {
  it("点名资产的重新生成指令命中并取出资产名", () => {
    expect(matchAssetImageRegen("重新生成林晚的图片")).toBe("林晚");
    expect(matchAssetImageRegen("重新生成 陆深 的形象")).toBe("陆深");
    expect(matchAssetImageRegen("重画一张街角面馆的图")).toBe("街角面馆");
    expect(matchAssetImageRegen("请帮我重新生成女DJ的形象图")).toBe("女DJ");
  });

  it("非资产图指令不命中", () => {
    expect(matchAssetImageRegen("重新生成分镜")).toBeNull();
    expect(matchAssetImageRegen("重新生成方案")).toBeNull();
    expect(matchAssetImageRegen("重新分析原片")).toBeNull();
    expect(matchAssetImageRegen("")).toBeNull();
  });
});
