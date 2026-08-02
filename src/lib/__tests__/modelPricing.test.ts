import { beforeEach, describe, expect, it } from "vitest";
import { imageCost, videoCost, videoCostRange } from "../creditsCost";
import {
  invalidateModelPricingCache,
  setModelPricingCache,
  type ModelPricingRow,
} from "../modelPricingCache";
import {
  fetchModelPricingFromDb,
  ModelPricingDeleteInput,
  ModelPricingListInput,
  ModelPricingUpsertInput,
} from "../modelPricing.functions";

function pricingRow(partial: Partial<ModelPricingRow>): ModelPricingRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "image",
    modelId: "tokenflash/",
    label: "TokenFlash 生图",
    resolution: null,
    credits: 7,
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

describe("creditsCost 查库优先", () => {
  it("生图:数据库有匹配前缀时用库内价格", () => {
    setModelPricingCache([pricingRow({ credits: 7 })]);
    expect(imageCost("tokenflash/seedream-4")).toBe(7);
  });

  it("生图:前缀最长匹配优先", () => {
    setModelPricingCache([
      pricingRow({ modelId: "azure/", credits: 9 }),
      pricingRow({ modelId: "azure2/", credits: 12 }),
    ]);
    expect(imageCost("azure2/some-model")).toBe(12);
  });

  it("视频:数据库有该模型+分辨率时按库内单价 × duration/10", () => {
    setModelPricingCache([
      pricingRow({
        kind: "video",
        modelId: "kuaizi-lizhen-fast",
        resolution: "720P",
        credits: 100,
      }),
    ]);
    expect(videoCost("kuaizi-lizhen-fast", "720P", 10)).toBe(100);
    expect(videoCost("kuaizi-lizhen-fast", "720P", 20)).toBe(200);
  });

  it("enabled=false 的行不参与计价,回落兜底表", () => {
    setModelPricingCache([pricingRow({ credits: 7, enabled: false })]);
    expect(imageCost("tokenflash/seedream-4")).toBe(5);
  });

  it("videoCostRange 优先用库内档位", () => {
    setModelPricingCache([
      pricingRow({ kind: "video", modelId: "m1", resolution: "480P", credits: 10 }),
      pricingRow({ kind: "video", modelId: "m1", resolution: "720P", credits: 30 }),
    ]);
    expect(videoCostRange("m1")).toBe("10-30积分/10s");
  });
});

describe("creditsCost 回落兜底", () => {
  it("无缓存时用静态价目表", () => {
    expect(imageCost("revora/x")).toBe(4);
    expect(imageCost("azure0716/y")).toBe(9);
    expect(videoCost("kuaizi-lizhen-mini", "480P", 10)).toBe(56);
    expect(videoCost("kuaizi-lizhen-pro", "1080P", 5)).toBe(296.5);
  });

  it("有缓存但模型不在库内时同样回落静态表", () => {
    setModelPricingCache([pricingRow({ modelId: "other/", credits: 1 })]);
    expect(imageCost("tokenflash/seedream-4")).toBe(5);
    expect(videoCost("kuaizi-lizhen-fast", "720P", 10)).toBe(192);
  });

  it("不在任何价目表内的模型返回 null(不扣分)", () => {
    expect(imageCost("unknown-model")).toBeNull();
    expect(videoCost("unknown-model", "720P", 10)).toBeNull();
    expect(videoCost("kuaizi-lizhen-fast", "1080P", 10)).toBeNull();
    expect(imageCost(null)).toBeNull();
    expect(videoCost(null, "720P", 10)).toBeNull();
  });
});

describe("fetchModelPricingFromDb(mock supabase)", () => {
  function mockSupabase(result: { data: any; error: any }) {
    const order = () => ({ order, then: undefined });
    const chain: any = {
      select: () => chain,
      order: () => chain,
      then: (resolve: any) => resolve(result),
    };
    return { from: () => chain };
  }

  it("读取并映射行、写入缓存,扣费立即按库内价格", async () => {
    const supabase = mockSupabase({
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          kind: "image",
          model_id: "tokenflash/",
          label: "TokenFlash 生图",
          resolution: null,
          credits: "8.5",
          note: null,
          is_default: false,
          enabled: true,
          sort_order: 1,
        },
      ],
      error: null,
    });
    const rows = await fetchModelPricingFromDb(supabase);
    expect(rows).toHaveLength(1);
    expect(rows[0].modelId).toBe("tokenflash/");
    expect(rows[0].credits).toBe(8.5);
    expect(imageCost("tokenflash/seedream-4")).toBe(8.5);
  });

  it("读库出错时抛异常", async () => {
    const supabase = mockSupabase({ data: null, error: { message: "boom" } });
    await expect(fetchModelPricingFromDb(supabase)).rejects.toThrow("boom");
  });
});

describe("modelPricing zod 校验", () => {
  it("upsert 合法输入通过并补默认值", () => {
    const parsed = ModelPricingUpsertInput.parse({
      kind: "video",
      modelId: "m1",
      label: "模型一",
      credits: 12.5,
    });
    expect(parsed.enabled).toBe(true);
    expect(parsed.isDefault).toBe(false);
    expect(parsed.sortOrder).toBe(0);
  });

  it("upsert 非法输入被拒绝", () => {
    expect(() =>
      ModelPricingUpsertInput.parse({ kind: "audio", modelId: "m1", label: "x", credits: 1 }),
    ).toThrow();
    expect(() =>
      ModelPricingUpsertInput.parse({ kind: "video", modelId: "", label: "x", credits: 1 }),
    ).toThrow();
    expect(() =>
      ModelPricingUpsertInput.parse({ kind: "video", modelId: "m1", label: "x", credits: -1 }),
    ).toThrow();
    expect(() =>
      ModelPricingUpsertInput.parse({ kind: "video", modelId: "m1", label: "x", credits: 1, sortOrder: 1.5 }),
    ).toThrow();
  });

  it("delete 要求 uuid", () => {
    expect(() => ModelPricingDeleteInput.parse({ id: "not-a-uuid" })).toThrow();
    expect(
      ModelPricingDeleteInput.parse({ id: "00000000-0000-4000-8000-000000000001" }).id,
    ).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("list 的 kind 可选但限定枚举", () => {
    expect(ModelPricingListInput.parse({}).kind).toBeUndefined();
    expect(ModelPricingListInput.parse({ kind: "image" }).kind).toBe("image");
    expect(() => ModelPricingListInput.parse({ kind: "audio" })).toThrow();
  });
});
