import { describe, expect, it } from "vitest";
import { videoCost, videoCostOrFallback } from "../creditsCost";
import {
  assetLibraryVendorForModel,
  getVideoAssetLibrarySupport,
  referenceVideoLimitsForModel,
} from "../videoAssetLibrary";
import {
  getVideoBackend,
  jieyunAssetApiBase,
  jieyunAssetStatusKind,
  jieyunModelToUpstream,
  normalizeArkFamilyContent,
  normalizeJieyunAssetResult,
  parseJieyunActionError,
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

describe("诘云素材库（Action API 解析纯函数）", () => {
  it("jieyunAssetApiBase 剥掉视频 baseUrl 的 /api/v3 后缀", () => {
    expect(jieyunAssetApiBase("https://jieyun.cc/api/v3")).toBe("https://jieyun.cc");
    expect(jieyunAssetApiBase("https://jieyun.cc/api/v3/")).toBe("https://jieyun.cc");
    expect(jieyunAssetApiBase("https://jieyun.cc")).toBe("https://jieyun.cc");
  });

  it("parseJieyunActionError 提取 ResponseMetadata.Error 为 Code: Message", () => {
    expect(
      parseJieyunActionError({
        ResponseMetadata: { Error: { Code: "InvalidParameter", Message: "bad URL" } },
      }),
    ).toBe("InvalidParameter: bad URL");
    // 无错误返回 null
    expect(parseJieyunActionError({ Result: { Id: "asset-1" } })).toBeNull();
    expect(parseJieyunActionError(null)).toBeNull();
    // 只有 Message 时退化为单字段
    expect(
      parseJieyunActionError({ ResponseMetadata: { Error: { Message: "boom" } } }),
    ).toBe("boom");
  });

  it("normalizeJieyunAssetResult 解析 CreateAsset/GetAsset 的 Result", () => {
    expect(normalizeJieyunAssetResult({ Id: "asset-xxx", Status: "Processing" })).toEqual({
      id: "asset-xxx",
      status: "Processing",
    });
    // 小写键兼容
    expect(normalizeJieyunAssetResult({ id: "asset-y", status: "Active" })).toEqual({
      id: "asset-y",
      status: "Active",
    });
    // 无 Id 结构不符
    expect(normalizeJieyunAssetResult({ Status: "Active" })).toBeNull();
    expect(normalizeJieyunAssetResult(null)).toBeNull();
  });

  it("jieyunAssetStatusKind 归一状态：HTTP 200 也可能是 Failed", () => {
    expect(jieyunAssetStatusKind("Active")).toBe("active");
    expect(jieyunAssetStatusKind("Failed")).toBe("failed");
    expect(jieyunAssetStatusKind("Processing")).toBe("processing");
    expect(jieyunAssetStatusKind(undefined)).toBe("processing");
  });

  it("jieyun 模型进入素材库支持清单（vendor=jieyun）", () => {
    expect(assetLibraryVendorForModel("jieyun-doubao-seedance-2-0-260128")).toBe("jieyun");
    expect(getVideoAssetLibrarySupport("jieyun-doubao-seedance-2-0-260128").supported).toBe(true);
    // 素材库通道参考视频约束与 TopenRouter 同档（1.8-30s）
    expect(referenceVideoLimitsForModel("jieyun-doubao-seedance-2-0-260128")).toEqual({
      minMs: 1_800,
      maxMs: 30_000,
    });
  });
});
