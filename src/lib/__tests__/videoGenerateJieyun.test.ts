import { describe, expect, it } from "vitest";
import { videoCost, videoCostOrFallback } from "../creditsCost";
import { getVideoBackend, jieyunModelToUpstream } from "../videoGenerate.functions";

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
