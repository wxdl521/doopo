import { describe, expect, it } from "vitest";
import { videoCost, videoCostOrFallback } from "../creditsCost";
import {
  getVideoBackend,
  jieyunModelToUpstream,
  normalizeArkFamilyContent,
} from "../videoGenerate.functions";

describe("诘云(ARK 兼容网关)渠道", () => {
  it("jieyun- 前缀模型路由到 jieyun 后端", () => {
    expect(getVideoBackend("jieyun-doubao-seedance-2-0-260128")).toBe("jieyun");
    // 大小写不敏感
    expect(getVideoBackend("JIEYUN-doubao-seedance-2-0-260128")).toBe("jieyun");
  });

  it("jieyunModelToUpstream 剥离路由前缀得到上游 ARK 模型名", () => {
    expect(jieyunModelToUpstream("jieyun-doubao-seedance-2-0-260128")).toBe(
      "doubao-seedance-2-0-260128",
    );
    // 非 jieyun 模型原样返回
    expect(jieyunModelToUpstream("doubao-seedance-2-0-260128")).toBe(
      "doubao-seedance-2-0-260128",
    );
  });

  it("jieyun 模型按同档直连价目计费(237.6 积分/10s)", () => {
    expect(videoCost("jieyun-doubao-seedance-2-0-260128", "720P", 10)).toBe(237.6);
    expect(videoCost("jieyun-doubao-seedance-2-0-260128", "480P", 10)).toBe(237.6);
    // 按 duration 比例
    expect(videoCost("jieyun-doubao-seedance-2-0-260128", "720P", 5)).toBe(118.8);
  });

  it("未知 jieyun 变体剥前缀后命中直连价目", () => {
    const r = videoCostOrFallback("jieyun-doubao-seedance-2-0-fast-260128", "720P", 10);
    expect(r?.cost).toBe(192);
    expect(r?.warning).toContain("doubao-seedance-2-0-fast-260128");
  });
});

describe("normalizeArkFamilyContent（ARK 系 first/last frame 与参考媒体混用归一）", () => {
  it("含参考视频时 first_frame 降级为 reference_image（保持顺序）", () => {
    const content = [
      { type: "text", text: "p" },
      { type: "image_url", image_url: { url: "https://a/1.png" }, role: "first_frame" },
      { type: "image_url", image_url: { url: "https://a/2.png" }, role: "reference_image" },
      { type: "video_url", video_url: { url: "https://a/v.mp4" }, role: "reference_video" },
    ];
    const normalized = normalizeArkFamilyContent(content);
    expect(normalized.map((item) => (item as { role?: string }).role ?? null)).toEqual([
      null,
      "reference_image",
      "reference_image",
      "reference_video",
    ]);
    // 不改动原数组
    expect((content[1] as { role: string }).role).toBe("first_frame");
  });

  it("含参考视频时 last_frame 同样降级", () => {
    const content = [
      { type: "text", text: "p" },
      { type: "image_url", image_url: { url: "https://a/1.png" }, role: "first_frame" },
      { type: "image_url", image_url: { url: "https://a/2.png" }, role: "last_frame" },
      { type: "video_url", video_url: { url: "https://a/v.mp4" }, role: "reference_video" },
    ];
    const normalized = normalizeArkFamilyContent(content);
    expect((normalized[1] as { role: string }).role).toBe("reference_image");
    expect((normalized[2] as { role: string }).role).toBe("reference_image");
  });

  it("无参考视频时原样返回（首帧驱动 i2v 语义保留）", () => {
    const content = [
      { type: "text", text: "p" },
      { type: "image_url", image_url: { url: "https://a/1.png" }, role: "first_frame" },
    ];
    const normalized = normalizeArkFamilyContent(content);
    expect(normalized).toBe(content);
    expect((normalized[1] as { role: string }).role).toBe("first_frame");
  });

  it("空 content 安全返回", () => {
    expect(normalizeArkFamilyContent([])).toEqual([]);
  });
});
