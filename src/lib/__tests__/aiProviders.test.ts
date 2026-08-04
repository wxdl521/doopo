// ====================================================================
//  供应商管理单元测试：
//   1) 密钥加解密往返（WebCrypto AES-256-GCM，v1:<iv_b64>:<ct_b64>）
//   2) 目录过滤（listed + enabled + 供应商启用）与 key 生成规则
//   3) code 与内置路由前缀冲突校验
//   4) 动态兜底路由：内置前缀不拦截 / 未登记返回 null / 未定价禁提交
// ====================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_SECRET = "test-provider-key-enc-secret-0123456789abcdef";

// ---- supabaseAdmin mock：内存表驱动 from(...) 链式查询 ----
type Row = Record<string, any>;

function makeQuery(rows: Row[]) {
  let filtered = rows;
  const q: any = {
    select: () => q,
    eq: (col: string, value: any) => {
      filtered = filtered.filter((r) => r[col] === value);
      return q;
    },
    ilike: (col: string, value: string) => {
      filtered = filtered.filter(
        (r) => String(r[col]).toLowerCase() === String(value).toLowerCase(),
      );
      return q;
    },
    order: () => q,
    limit: () => q,
    maybeSingle: async () => ({ data: filtered[0] ?? null, error: null }),
    then: (resolve: any) => resolve({ data: filtered, error: null }),
  };
  return q;
}

const db: { providers: Row[]; models: Row[]; pricing: Row[] } = {
  providers: [],
  models: [],
  pricing: [],
};

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => makeQuery(table === "ai_providers" ? db.providers : db.models),
  },
}));

vi.mock("../modelPricing.functions", () => ({
  fetchModelPricingFromDb: vi.fn(async () => {
    const { setModelPricingCache } = await import("../modelPricingCache");
    setModelPricingCache(db.pricing as any);
    return db.pricing;
  }),
}));

import { apiKeyHint, decryptProviderSecret, encryptProviderSecret } from "../providerSecret.server";
import {
  buildCatalogKey,
  imagePricingFor,
  invalidateListedModelsCache,
  isBuiltinRoutePrefix,
  pricingSummary,
  videoPricingFor,
} from "../aiProvidersCache";
import { invalidateModelPricingCache, type ModelPricingRow } from "../modelPricingCache";
import { fetchListedModelsFromDb } from "../aiProviders.functions";
import { tryDynamicProviderImage, UNPRICED_MODEL_ERROR } from "../dynamicProvider.functions";

function pricingRow(partial: Partial<ModelPricingRow>): ModelPricingRow {
  return {
    id: "00000000-0000-4000-8000-000000000009",
    kind: "image",
    modelId: "acme/",
    label: "Acme 生图",
    resolution: null,
    credits: 6,
    note: null,
    isDefault: false,
    enabled: true,
    sortOrder: 1,
    ...partial,
  };
}

beforeEach(() => {
  process.env.PROVIDER_KEY_ENC_SECRET = TEST_SECRET;
  db.providers = [];
  db.models = [];
  db.pricing = [];
  invalidateListedModelsCache();
  invalidateModelPricingCache();
});

describe("providerSecret 加解密", () => {
  it("加密 -> 解密往返一致，格式为 v1:<iv_b64>:<ct_b64>", async () => {
    const cipher = await encryptProviderSecret("sk-test-1234567890");
    const parts = cipher.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("v1");
    expect(await decryptProviderSecret(cipher)).toBe("sk-test-1234567890");
  });

  it("同一明文两次加密密文不同（随机 iv）", async () => {
    const a = await encryptProviderSecret("same-key");
    const b = await encryptProviderSecret("same-key");
    expect(a).not.toBe(b);
    expect(await decryptProviderSecret(a)).toBe("same-key");
    expect(await decryptProviderSecret(b)).toBe("same-key");
  });

  it("密钥错误 / 密文被篡改时解密失败", async () => {
    const cipher = await encryptProviderSecret("sk-secret");
    process.env.PROVIDER_KEY_ENC_SECRET = "another-secret-key-0123456789";
    await expect(decryptProviderSecret(cipher)).rejects.toThrow();
    process.env.PROVIDER_KEY_ENC_SECRET = TEST_SECRET;
    // 改密文中段一个字符（末位可能落在 base64 padding 位上，改了也解出同样字节）
    const parts = cipher.split(":");
    const ct = parts[2];
    const mid = Math.floor(ct.length / 2);
    const flipped = ct[mid] === "A" ? "B" : "A";
    const tampered = `${parts[0]}:${parts[1]}:${ct.slice(0, mid)}${flipped}${ct.slice(mid + 1)}`;
    await expect(decryptProviderSecret(tampered)).rejects.toThrow();
  });

  it("格式非法直接抛错", async () => {
    await expect(decryptProviderSecret("not-a-cipher")).rejects.toThrow(/格式非法/);
  });

  it("apiKeyHint 只保留尾 4 位", () => {
    expect(apiKeyHint("sk-abcdef1234")).toBe("****1234");
    expect(apiKeyHint("abc")).toBe("****");
  });
});

describe("内置路由前缀冲突校验", () => {
  it("图像/视频分发链前缀全部命中（小写归一）", () => {
    for (const code of [
      "ark",
      "qwen",
      "azure",
      "pixflow",
      "tokenflash",
      "revora",
      "otu",
      "confluo",
      "kuaizi",
      "kling",
      "topenrouter",
      "earth",
      "seedance",
      "PIXFLOW", // 大小写不敏感
    ]) {
      expect(isBuiltinRoutePrefix(code)).toBe(true);
    }
  });

  it("新供应商 code 不冲突", () => {
    for (const code of ["acme", "newapi-x", "my_gateway"]) {
      expect(isBuiltinRoutePrefix(code)).toBe(false);
    }
  });
});

describe("目录 key 生成与价目匹配", () => {
  it("builtin：key = 路由 id 原样；openai_compatible：key = <code>/<model_id>", () => {
    expect(buildCatalogKey({ code: "pixflow", kind: "builtin" }, "pixflow/gpt-image-2")).toBe(
      "pixflow/gpt-image-2",
    );
    expect(buildCatalogKey({ code: "dashscope", kind: "builtin" }, "qwen-image-2.0")).toBe(
      "qwen-image-2.0",
    );
    expect(buildCatalogKey({ code: "acme", kind: "openai_compatible" }, "flux-1")).toBe(
      "acme/flux-1",
    );
  });

  it("图像前缀最长匹配 / 视频精确匹配 / 未命中 priced=false", () => {
    const rows = [
      pricingRow({ modelId: "acme/", credits: 6 }),
      pricingRow({ modelId: "acme/flux-pro", credits: 12 }),
      pricingRow({ kind: "video", modelId: "acme/vid-1", resolution: "720P", credits: 100 }),
      pricingRow({ kind: "video", modelId: "acme/vid-1", resolution: "480P", credits: 50 }),
    ];
    expect(imagePricingFor(rows, "acme/flux-pro")).toBe(12);
    expect(imagePricingFor(rows, "acme/flux-1")).toBe(6);
    expect(imagePricingFor(rows, "other/x")).toBeNull();
    expect(videoPricingFor(rows, "acme/vid-1")).toEqual([100, 50]);
    expect(pricingSummary(rows, "video", "acme/vid-1")).toEqual({
      priced: true,
      range: "50-100积分/10s",
    });
    expect(pricingSummary(rows, "image", "other/none")).toEqual({ priced: false, range: null });
  });
});

describe("listListedModels 目录过滤（listed + enabled）", () => {
  function seedCatalog() {
    db.providers = [
      {
        id: "p-builtin",
        code: "ark",
        name: "ARK",
        kind: "builtin",
        enabled: true,
        sort_order: 1,
      },
      {
        id: "p-dynamic",
        code: "acme",
        name: "Acme",
        kind: "openai_compatible",
        enabled: true,
        sort_order: 2,
      },
      {
        id: "p-off",
        code: "off",
        name: "Off",
        kind: "openai_compatible",
        enabled: false,
        sort_order: 3,
      },
    ];
    const caps = { edits_protocol: "multipart", auth_header: "bearer" };
    db.models = [
      // 正常上架
      {
        provider_id: "p-builtin",
        model_id: "doubao-seedream-5-0-260128",
        label: "Seedream 5.0",
        kind: "image",
        capabilities: caps,
        listed: true,
        enabled: true,
        is_default: true,
        sort_order: 1,
        note: null,
      },
      // 未上架 -> 过滤
      {
        provider_id: "p-dynamic",
        model_id: "flux-unlisted",
        label: "Flux Unlisted",
        kind: "image",
        capabilities: caps,
        listed: false,
        enabled: true,
        is_default: false,
        sort_order: 2,
        note: null,
      },
      // 停用 -> 过滤
      {
        provider_id: "p-dynamic",
        model_id: "flux-disabled",
        label: "Flux Disabled",
        kind: "image",
        capabilities: caps,
        listed: true,
        enabled: false,
        is_default: false,
        sort_order: 3,
        note: null,
      },
      // 供应商停用 -> 过滤
      {
        provider_id: "p-off",
        model_id: "flux-off",
        label: "Flux Off",
        kind: "image",
        capabilities: caps,
        listed: true,
        enabled: true,
        is_default: false,
        sort_order: 4,
        note: null,
      },
      // 动态供应商正常上架
      {
        provider_id: "p-dynamic",
        model_id: "flux-1",
        label: "Flux 1",
        kind: "image",
        capabilities: caps,
        listed: true,
        enabled: true,
        is_default: false,
        sort_order: 5,
        note: null,
      },
    ];
    db.pricing = [pricingRow({ modelId: "acme/", credits: 6 })];
  }

  it("只返回已上架 + 启用 + 供应商启用的模型，key 规则正确且脱敏", async () => {
    seedCatalog();
    const rows = await fetchListedModelsFromDb();
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("doubao-seedream-5-0-260128");
    expect(keys).toContain("acme/flux-1");
    expect(keys).not.toContain("acme/flux-unlisted");
    expect(keys).not.toContain("acme/flux-disabled");
    expect(keys).not.toContain("off/flux-off");
    // 脱敏：不含 base_url / 密钥字段
    for (const row of rows) {
      expect(row).not.toHaveProperty("baseUrl");
      expect(row).not.toHaveProperty("apiKey");
    }
    // 定价范围：acme/flux-1 命中 acme/ 前缀价目
    const flux = rows.find((r) => r.key === "acme/flux-1");
    expect(flux?.pricing).toEqual({ priced: true, range: "6积分/张" });
    const seedream = rows.find((r) => r.key === "doubao-seedream-5-0-260128");
    expect(seedream?.pricing.priced).toBe(false);
  });
});

describe("动态供应商兜底路由", () => {
  it("内置前缀一律不拦截（不查库直接返回 null）", async () => {
    expect(await tryDynamicProviderImage({ model: "pixflow/gpt-image-2", prompt: "x" })).toBeNull();
    expect(await tryDynamicProviderImage({ model: "qwen-image-2.0", prompt: "x" })).toBeNull();
  });

  it("未登记的供应商前缀返回 null（继续走 legacy 链路）", async () => {
    expect(await tryDynamicProviderImage({ model: "ghost/model-1", prompt: "x" })).toBeNull();
  });

  it("上架但未定价的动态模型禁止提交（返回「该模型暂未定价」）", async () => {
    db.providers = [
      {
        id: "p-dynamic",
        code: "acme",
        name: "Acme",
        kind: "openai_compatible",
        enabled: true,
        base_url: "https://api.acme.example",
        api_key_cipher: null,
        env_key_name: "ACME_TEST_KEY",
      },
    ];
    db.models = [
      {
        provider_id: "p-dynamic",
        model_id: "flux-1",
        kind: "image",
        capabilities: { edits_protocol: "multipart", auth_header: "bearer" },
        enabled: true,
      },
    ];
    process.env.ACME_TEST_KEY = "sk-acme";
    db.pricing = []; // 无价目行

    const r = await tryDynamicProviderImage({ model: "acme/flux-1", prompt: "hello" });
    expect(r).not.toBeNull();
    expect(r!.url).toBe("");
    expect(r!.error).toBe(UNPRICED_MODEL_ERROR);
  });

  it("已定价的动态模型会真正发请求（mock fetch 返回图片）", async () => {
    db.providers = [
      {
        id: "p-dynamic",
        code: "acme",
        name: "Acme",
        kind: "openai_compatible",
        enabled: true,
        base_url: "https://api.acme.example",
        api_key_cipher: null,
        env_key_name: "ACME_TEST_KEY",
      },
    ];
    db.models = [
      {
        provider_id: "p-dynamic",
        model_id: "flux-1",
        kind: "image",
        capabilities: { edits_protocol: "multipart", auth_header: "bearer" },
        enabled: true,
      },
    ];
    process.env.ACME_TEST_KEY = "sk-acme";
    db.pricing = [pricingRow({ modelId: "acme/", credits: 6 })];

    const fetchMock = vi.fn(async (url: any, init: any) => {
      expect(String(url)).toBe("https://api.acme.example/v1/images/generations");
      // bearer 认证头按声明组装
      expect(init.headers.Authorization).toBe("Bearer sk-acme");
      const body = JSON.parse(init.body);
      expect(body.model).toBe("flux-1"); // 上游裸模型名
      return new Response(JSON.stringify({ data: [{ url: "https://cdn.acme.example/1.png" }] }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const r = await tryDynamicProviderImage({ model: "acme/flux-1", prompt: "hello" });
      expect(r!.url).toBe("https://cdn.acme.example/1.png");
      expect(r!.error).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
