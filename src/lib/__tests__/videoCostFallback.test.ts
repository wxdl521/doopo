// ====================================================================
// videoCostOrFallback 测试（转绘渲染零扣费回归）：
// 精确命中 / topenrouter 前缀剥直连价目 / 无价目默认档兜底 + warning
// ====================================================================
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_VIDEO_UNIT_COST_FALLBACK,
  videoCostOrFallback,
} from "../creditsCost";
import {
  invalidateModelPricingCache,
  setModelPricingCache,
  type ModelPricingRow,
} from "../modelPricingCache";

function videoRow(partial: Partial<ModelPricingRow>): ModelPricingRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "video",
    modelId: "topenrouter-doubao-seedance-2-0-260128",
    label: "TopenRouter Seedance 2.0",
    resolution: "720P",
    credits: 200,
    note: null,
    isDefault: false,
    enabled: true,
    sortOrder: 1,
    ...partial,
  };
}

beforeEach(() => {
  invalidateModelPricingCache();
});

describe("videoCostOrFallback", () => {
  it("精确命中静态价目表：直连模型无 warning", () => {
    expect(videoCostOrFallback("doubao-seedance-2-0-260128", "720P", 15)).toEqual({
      cost: 356.4,
    });
  });

  it("精确命中库内价目（含 topenrouter 前缀行）：无 warning", () => {
    setModelPricingCache([videoRow({ credits: 200 })]);
    expect(videoCostOrFallback("topenrouter-doubao-seedance-2-0-260128", "720P", 15)).toEqual({
      cost: 300,
    });
  });

  it("topenrouter- 前缀模型无独立价目：剥前缀按同档直连模型计费并记 warning", () => {
    const result = videoCostOrFallback("topenrouter-doubao-seedance-2-0-260128", "720P", 15);
    // doubao-seedance-2-0-260128 直连价目 237.6/10s × 1.5
    expect(result?.cost).toBe(356.4);
    expect(result?.warning).toContain("按同档直连模型 doubao-seedance-2-0-260128 价目计费");
  });

  it("fast 档前缀模型同理命中直连 fast 价目", () => {
    const result = videoCostOrFallback("topenrouter-doubao-seedance-2-0-fast-260128", "720P", 10);
    expect(result?.cost).toBe(192);
    expect(result?.warning).toContain("doubao-seedance-2-0-fast-260128");
  });

  it("完全未知模型：默认档兜底并记 warning，不静默零扣", () => {
    const result = videoCostOrFallback("some-unknown-model", "720P", 15);
    expect(result?.cost).toBe((DEFAULT_VIDEO_UNIT_COST_FALLBACK * 15) / 10);
    expect(result?.warning).toContain("价目缺失");
    expect(result?.warning).toContain("默认档");
  });

  it("duration <= 0 按 10s 计；model 为空返回 null", () => {
    expect(videoCostOrFallback("some-unknown-model", "720P", 0)?.cost).toBe(
      DEFAULT_VIDEO_UNIT_COST_FALLBACK,
    );
    expect(videoCostOrFallback(null, "720P", 10)).toBeNull();
  });
});
