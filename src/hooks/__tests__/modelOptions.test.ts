// ====================================================================
// modelOptions 纯函数测试（全站模型选择展示统一规格）
// ====================================================================
import { describe, expect, it } from "vitest";
import {
  formatModelOptionLabel,
  resolveDefaultModel,
  sortListedModels,
} from "../modelOptions";

const LABELS = {
  unpricedLabel: "暂未计费",
  defaultLabel: "默认推荐",
  assetLibraryLabel: "支持真人素材审核",
};

describe("formatModelOptionLabel", () => {
  it("已定价模型：label — sub · 价格区间", () => {
    expect(
      formatModelOptionLabel(
        { label: "Seedance 2.0", sub: "TopenRouter", priced: true, priceRange: "192-237.6积分/10s" },
        LABELS,
      ),
    ).toBe("Seedance 2.0 — TopenRouter · 192-237.6积分/10s");
  });

  it("未定价模型：价格段显示「暂未计费」，不再重复徽标", () => {
    expect(
      formatModelOptionLabel(
        { label: "动态模型A", priced: false, priceRange: null },
        LABELS,
      ),
    ).toBe("动态模型A · 暂未计费");
  });

  it("徽标只显示一个：默认 > 素材库预审；未定价盖过一切", () => {
    expect(
      formatModelOptionLabel(
        { label: "M", priced: true, isDefault: true },
        LABELS,
        { assetLibrarySupported: true },
      ),
    ).toBe("M · 默认推荐");
    expect(
      formatModelOptionLabel({ label: "M", priced: false, isDefault: true }, LABELS, {
        assetLibrarySupported: true,
      }),
    ).toBe("M · 暂未计费");
  });

  it("素材库预审徽标只在调用方声明支持时显示", () => {
    expect(
      formatModelOptionLabel({ label: "M", priced: true }, LABELS, {
        assetLibrarySupported: true,
      }),
    ).toBe("M · 支持真人素材审核");
    expect(formatModelOptionLabel({ label: "M", priced: true }, LABELS)).toBe("M");
  });

  it("无 sub 省略分隔符", () => {
    expect(
      formatModelOptionLabel({ label: "M", sub: undefined, priced: true, priceRange: "5积分/张" }, LABELS),
    ).toBe("M · 5积分/张");
  });

  it("sub 已含价格文本时不重复拼接 priceRange", () => {
    expect(
      formatModelOptionLabel(
        {
          label: "Doubao Seedance 2.0",
          sub: "多模态 · 237.6积分/10s",
          priced: true,
          priceRange: "237.6积分/10s",
          isDefault: true,
        },
        LABELS,
      ),
    ).toBe("Doubao Seedance 2.0 — 多模态 · 237.6积分/10s · 默认推荐");
  });
});

describe("sortListedModels", () => {
  const m = (id: string, isDefault = false, sortOrder = 0, priority = 0) => ({
    id,
    isDefault,
    sortOrder,
    priority,
  });

  it("isDefault 靠前，其余按 sortOrder 升序", () => {
    const sorted = sortListedModels([m("c", false, 30), m("a", true, 50), m("b", false, 10)]);
    expect(sorted.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("调用方附加优先级（素材库预审）优先于 isDefault 与 sortOrder", () => {
    const sorted = sortListedModels(
      [m("default-model", true, 0, 0), m("asset-lib", false, 99, 1)],
      (x) => x.priority,
    );
    expect(sorted.map((x) => x.id)).toEqual(["asset-lib", "default-model"]);
  });
});

describe("resolveDefaultModel", () => {
  const models = [
    { id: "b", isDefault: false, sortOrder: 20 },
    { id: "a", isDefault: true, sortOrder: 30 },
    { id: "c", isDefault: true, sortOrder: 10 },
  ];

  it("已保存值在列表中：优先使用", () => {
    expect(resolveDefaultModel(models, "b", "hard")).toBe("b");
  });

  it("已保存值失效：落库内 is_default（sortOrder 最前）", () => {
    expect(resolveDefaultModel(models, "gone", "hard")).toBe("c");
  });

  it("无 is_default：sortOrder 最前", () => {
    expect(
      resolveDefaultModel(
        [
          { id: "x", isDefault: false, sortOrder: 5 },
          { id: "y", isDefault: false, sortOrder: 1 },
        ],
        undefined,
        "hard",
      ),
    ).toBe("y");
  });

  it("空列表：硬编码常量兜底", () => {
    expect(resolveDefaultModel([], undefined, "hard")).toBe("hard");
  });
});
