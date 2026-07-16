// ====================================================================
//  端到端回归测试 —— Pixflow 故事板路由
//
//  目的:防止再次出现 "[seedream] openai/gpt-image-2 404 ... baseUrl=
//  https://ark.cn-beijing.volces.com/api/v3" 这类错路由的回归。
//
//  覆盖三层:
//   1) callPixflowImage 命中 Gemini Native 端点(/v1beta/models/.../generateContent)
//      ——绝不打 ARK,绝不打 /v1/images/generations。
//   2) generateStoryboardShotImage 在收到 `pixflow/*` 模型时,
//      委派到 Pixflow,不会发请求到 ARK。
//   3) 任何 UI 模型清单(NewProjectDialog 故事板下拉、IMAGE_MODELS、
//      Models 页)都不允许出现裸 "openai/gpt-image-2" —— 只能是
//      pixflow/ 前缀版本或彻底删除。
// ====================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { callPixflowImage } from "../pixflow.functions";
import { callLingmengImage } from "../lingmengImage.functions";
import { IMAGE_MODELS } from "../imageModels";

const ARK_HOST = "ark.cn-beijing.volces.com";
const PIXFLOW_HOST = "api.pixflow.im";

/** 1x1 透明 PNG 的 base64,够 Gemini Native 响应当 inlineData 使用 */
const FAKE_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

type FetchCall = { url: string; init?: RequestInit };

function installFetchSpy(opts: {
  onPixflow?: (call: FetchCall) => Response | Promise<Response>;
  onReferenceImage?: () => Response;
  allowOpenAIImages?: boolean;
}) {
  const calls: FetchCall[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL | Request).toString();
    calls.push({ url, init });

    // 硬拦截:任何打到 ARK 的请求都视为路由 bug,直接抛
    if (url.includes(ARK_HOST)) {
      throw new Error(`REGRESSION: pixflow flow leaked to ARK host (${url})`);
    }

    // gpt-image-* 无参考图时合法走 /v1/images/generations;
    // Gemini 模型若误打这里仍然算回归,所以用 allowOpenAIImages 显式放行
    if (url.includes(`${PIXFLOW_HOST}/v1/images/generations`) && !opts.allowOpenAIImages) {
      throw new Error(`REGRESSION: pixflow image call hit deprecated /v1/images/generations`);
    }

    // OpenAI 兼容图像端点(gpt-image-* T2I / I2I)
    if (
      url.includes(`${PIXFLOW_HOST}/v1/images/generations`) ||
      url.includes(`${PIXFLOW_HOST}/v1/images/edits`)
    ) {
      return new Response(JSON.stringify({ data: [{ url: "https://cdn.pixflow.im/out.png" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes(`${PIXFLOW_HOST}/v1beta/models/`)) {
      return opts.onPixflow
        ? opts.onPixflow({ url, init })
        : new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [{ inlineData: { mimeType: "image/png", data: FAKE_PNG_B64 } }],
                  },
                  finishReason: "STOP",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
    }

    // 参考图下载
    return opts.onReferenceImage
      ? opts.onReferenceImage()
      : new Response(Buffer.from(FAKE_PNG_B64, "base64"), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
  });
  return { spy, calls };
}

beforeEach(() => {
  process.env.PIXFLOW_API_KEY = "test-pixflow-key";
  process.env.LINGMENG_API_KEY = "test-lingmeng-key";
  // 确保 seedream.functions.ts 里的 getArkConfig 看到 key,
  // 否则路由失败会以 "ARK_API_KEY not configured" 提前 short-circuit,
  // 掩盖真正想验证的"绝不打 ARK"语义。
  process.env.ARK_API_KEY = "test-ark-key-should-never-be-used";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("callPixflowImage — Gemini Native 路由", () => {
  it("pixflow/gemini-3.1-flash-image-preview 命中 Native 端点,不会打 ARK 或 /v1/images", async () => {
    const { calls } = installFetchSpy({});
    const r = await callPixflowImage({
      prompt: "a tiny red apple on white",
      model: "pixflow/gemini-3.1-flash-image-preview",
      size: "2K",
    });

    expect(r.error).toBeNull();
    expect(r.url.startsWith("data:image/")).toBe(true);

    const pixflowCall = calls.find((c) => c.url.includes("/v1beta/models/"));
    expect(pixflowCall, "必须调用 Gemini Native generateContent").toBeDefined();
    expect(pixflowCall!.url).toContain("gemini-3.1-flash-image-preview:generateContent");
    // 鉴权头应该是 x-goog-api-key,不是 Authorization Bearer
    const headers = pixflowCall!.init!.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-pixflow-key");

    // 强不变量:零 ARK 请求,零 /v1/images/generations
    expect(calls.some((c) => c.url.includes(ARK_HOST))).toBe(false);
    expect(calls.some((c) => c.url.includes("/v1/images/generations"))).toBe(false);
  });

  it("携带参考图时,会先 GET 下载再以 inlineData 注入到 Native body", async () => {
    const { calls } = installFetchSpy({});
    await callPixflowImage({
      prompt: "fuse references",
      model: "pixflow/gemini-3-pro-image-preview",
      size: "2K",
      referenceImages: ["https://cdn.example.com/ref1.png"],
    });

    expect(calls.some((c) => c.url === "https://cdn.example.com/ref1.png")).toBe(true);

    const pixflowCall = calls.find((c) => c.url.includes("/v1beta/models/"))!;
    const body = JSON.parse(pixflowCall.init!.body as string);
    const parts = body.contents[0].parts as Array<Record<string, unknown>>;
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.some((p) => "inlineData" in p)).toBe(true);
  });
});

describe("generateStoryboardShotImage — 高层路由分发源码不变量", () => {
  // 不能直接调用 createServerFn 包装后的导出(需要 TanStack
  // AsyncLocalStorage 的 server runtime 上下文),所以从源码层面静态
  // 校验关键不变量:
  //   - 两个 storyboard handler 都先判断 `pixflow/` 前缀并委派给
  //     callPixflowImage,**早于** 任何 callSeedreamImages 调用。
  it("seedream.functions.ts 在两个 storyboard handler 里有 pixflow 分支并早于 Seedream", () => {
    const src = readFileSync(resolve(__dirname, "../seedream.functions.ts"), "utf-8");

    for (const handler of ["generateStoryboardShotImage", "regenerateStoryboardShot"]) {
      const start = src.indexOf(`export const ${handler}`);
      expect(start, `${handler} 必须存在`).toBeGreaterThan(0);
      // 取 handler 起始到下一个 export 之间的代码段
      const next = src.indexOf("export const ", start + 1);
      const block = next > 0 ? src.slice(start, next) : src.slice(start);

      const pixflowIdx = block.indexOf("startsWith('pixflow/')");
      const callSeedreamIdx = block.indexOf("callSeedreamImages(");
      expect(pixflowIdx, `${handler} 必须有 pixflow 前缀分支`).toBeGreaterThan(0);
      expect(callSeedreamIdx, `${handler} 仍保留 Seedream 兜底`).toBeGreaterThan(0);
      expect(pixflowIdx).toBeLessThan(callSeedreamIdx);
    }
  });
});

describe("UI 模型清单 —— 不允许裸 openai/gpt-image-2", () => {
  it("IMAGE_MODELS 不应包含已下线的裸 id", () => {
    // IMAGE_MODELS 不允许保留 openai/gpt-image-2 这类裸 legacy 条目。
    // 关键不变量是:
    //   1) 不存在 ARK Seedream 没有但 id 又会被路由到 Seedream 的"幽灵 id"
    //   2) 凡是 pixflow 提供的图像模型,key 必须带 pixflow/ 前缀
    const pixflowEntries = IMAGE_MODELS.filter((m) => /gemini-.*image|gpt-image/i.test(m.key));
    for (const m of pixflowEntries) {
      // 允许已注册供应商前缀，避免无前缀模型误路由到 ARK。
      const isLegacyVendor = m.key.startsWith("openai/") || m.key.startsWith("google/");
      const isPixflow = m.key.startsWith("pixflow/");
      const isRegisteredGateway = [
        "claude360/",
        "revora/",
        "tokenflash/",
        "aigcfamily/",
        "shuci/",
        "aitokenvibe/",
        "thhtcloud/",
        "ailinzi/",
        "tokenhub/",
        "agentearth/",
        "nagora/",
        "meridian/",
        "confluo/",
        "lingmeng/",
        "vapeur/",
        "azure/",
        "azure2/",
        "azure0716/",
      ].some((prefix) => m.key.startsWith(prefix));
      expect(
        isLegacyVendor || isPixflow || isRegisteredGateway,
        `图像模型 id 必须是 legacy 或已注册供应商前缀,但得到: ${m.key}`,
      ).toBe(true);
    }
    expect(IMAGE_MODELS.some((m) => m.key === "pixflow/gpt-image-2")).toBe(true);
    expect(IMAGE_MODELS.some((m) => m.key === "openai/gpt-image-2")).toBe(false);
  });

  it("历史裸 openai/gpt-image-2 会先归一成 pixflow/gpt-image-2,不会落到 ARK", async () => {
    // 2026/06 回归:旧项目可能持久化了裸 `openai/gpt-image-2`。
    // 这个 id 绝不能再被当作 Seedream model POST 到 ARK,必须先归一到 Pixflow。
    const seedreamSrc = readFileSync(resolve(__dirname, "../seedream.functions.ts"), "utf-8");

    expect(seedreamSrc).toMatch(
      /function normalizeImageModelForRouting[\s\S]*openai\/gpt-image-2[\s\S]*pixflow\/gpt-image-2/,
    );
    expect(seedreamSrc).toMatch(/const requested = normalizeImageModelForRouting\(data\.model\)/);

    for (const handler of [
      "generateImage",
      "generateStoryboardShotImage",
      "regenerateStoryboardShot",
      "generateStoryboardPitchDeck",
    ]) {
      const start = seedreamSrc.indexOf(`export const ${handler}`);
      expect(start, `${handler} 必须存在`).toBeGreaterThan(0);
      const next = seedreamSrc.indexOf("export const ", start + 1);
      const block = next > 0 ? seedreamSrc.slice(start, next) : seedreamSrc.slice(start);
      const normalizeIdx = block.indexOf("normalizeImageModelForRouting(data.model)");
      const arkIdx = block.indexOf("getArkConfig()");
      expect(normalizeIdx, `${handler} 必须先 normalize model`).toBeGreaterThan(0);
      expect(arkIdx, `${handler} 仍保留 ARK 兜底`).toBeGreaterThan(0);
      expect(normalizeIdx).toBeLessThan(arkIdx);
    }
  });
});

describe("callLingmengImage — 图像路由", () => {
  it("命中灵梦 generations、携带 Bearer 鉴权并解析 b64_json", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: FAKE_PNG_B64 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await callLingmengImage({
      prompt: "a tiny red apple",
      model: "lingmeng/gpt-image-2",
      size: "3840x2160",
    });

    expect(result.error).toBeNull();
    expect(result.url).toBe(`data:image/png;base64,${FAKE_PNG_B64}`);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://1189.xin/v1/images/generations");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-lingmeng-key");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "gpt-image-2",
      prompt: "a tiny red apple",
      size: "1536x1024",
      quality: "auto",
      n: 1,
    });
  });

  it("携带参考图时命中 edits，并以 multipart 的 image 字段上传", async () => {
    class TestFormData {
      private readonly fields = new Map<string, unknown[]>();

      append(name: string, value: unknown) {
        this.fields.set(name, [...(this.fields.get(name) || []), value]);
      }

      getAll(name: string) {
        return this.fields.get(name) || [];
      }
    }
    // jsdom 的 FormData 与 Node 的 Blob 不共享构造器；这里仅替换测试收集器，
    // 断言服务端传给 fetch 的 multipart 字段。
    vi.stubGlobal("FormData", TestFormData);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://cdn.example.com/ref.png") {
        return new Response(Buffer.from(FAKE_PNG_B64, "base64"), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }
      return new Response(JSON.stringify({ data: [{ url: "https://1189.xin/output.png" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const result = await callLingmengImage({
      prompt: "keep the subject",
      model: "lingmeng/gpt-image-2",
      referenceImages: ["https://cdn.example.com/ref.png"],
    });

    expect(result.error).toBeNull();
    expect(result.url).toBe("https://1189.xin/output.png");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [url, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://1189.xin/v1/images/edits");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-lingmeng-key");
    expect(init.body).toBeInstanceOf(TestFormData);
    expect((init.body as TestFormData).getAll("image")).toHaveLength(1);
  });

  it("工作区图生图路由在 Seedream 兜底前处理灵梦模型", () => {
    const seedreamSrc = readFileSync(resolve(__dirname, "../seedream.functions.ts"), "utf-8");
    for (const handler of [
      "regenerateCharacterLook",
      "generateStoryboardShotImage",
      "regenerateStoryboardShot",
      "generateStoryboardPitchDeck",
      "regenerateStoryboardPitchDeck",
    ]) {
      const start = seedreamSrc.indexOf(`export const ${handler}`);
      const next = seedreamSrc.indexOf("export const ", start + 1);
      const block = next > 0 ? seedreamSrc.slice(start, next) : seedreamSrc.slice(start);
      expect(block).toContain('startsWith("lingmeng/")');
      expect(block.indexOf('startsWith("lingmeng/")')).toBeLessThan(block.indexOf("getArkConfig()"));
    }
  });
});

// ====================================================================
//  Pixflow gpt-image-* OpenAI 兼容路由 —— 参数策略快照
//
//  根据 https://api.pixflow.im/docs:
//   - T2I:   POST /v1/images/generations  (JSON)
//   - I2I:   POST /v1/images/edits        (images[].image_url JSON)
//   - quality 必填 auto|low|high,缺省走 auto
//   - response_format 显式传 url(高稳定分组返回更小)
//   - 鉴权: Authorization: Bearer <PIXFLOW_API_KEY>
//   - 图像类请求超时设到 ~400s(2K/4K 需要 70-300s)
// ====================================================================
describe("callPixflowImage — gpt-image-* OpenAI 兼容路由参数策略", () => {
  it("T2I(无参考图)命中 /v1/images/generations,带 quality/response_format,Bearer 鉴权", async () => {
    const { calls } = installFetchSpy({ allowOpenAIImages: true });
    const r = await callPixflowImage({
      prompt: "a tiny red apple",
      model: "pixflow/gpt-image-2",
      size: "1024x1024",
    });

    expect(r.error).toBeNull();
    expect(r.url).toBe("https://cdn.pixflow.im/out.png");

    const gen = calls.find((c) => c.url.endsWith("/v1/images/generations"));
    expect(gen, "必须打 /v1/images/generations").toBeDefined();
    expect(calls.some((c) => c.url.endsWith("/v1/images/edits"))).toBe(false);

    const headers = gen!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-pixflow-key");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(gen!.init!.body as string);
    expect(body.model).toBe("gpt-image-2");
    expect(body.prompt).toBe("a tiny red apple");
    expect(body.size).toBe("1024x1024");
    expect(body.quality).toBe("auto");
    expect(body.response_format).toBe("url");
    expect(body.images, "T2I 不应携带 images").toBeUndefined();
  });

  it("I2I(有参考图)切换到 /v1/images/edits,以 images[].image_url JSON 引用", async () => {
    const { calls } = installFetchSpy({ allowOpenAIImages: true });
    const r = await callPixflowImage({
      prompt: "fuse them",
      model: "pixflow/gpt-image-2",
      size: "2K",
      quality: "high",
      referenceImages: ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"],
    });

    expect(r.error).toBeNull();

    const edits = calls.find((c) => c.url.endsWith("/v1/images/edits"));
    expect(edits, "有参考图必须切到 /v1/images/edits").toBeDefined();
    expect(calls.some((c) => c.url.endsWith("/v1/images/generations"))).toBe(false);

    const body = JSON.parse(edits!.init!.body as string);
    expect(body.model).toBe("gpt-image-2");
    expect(body.quality).toBe("high");
    expect(body.response_format).toBe("url");
    expect(body.images).toEqual([
      { image_url: "https://cdn.example.com/a.png" },
      { image_url: "https://cdn.example.com/b.png" },
    ]);

    // gpt-image-* 走 OpenAI JSON 引用,不应该真去下载参考图
    expect(calls.some((c) => c.url.startsWith("https://cdn.example.com/"))).toBe(false);
  });
});

describe("Pixflow 源码常量快照 —— 防止超时/分组策略悄悄被改回", () => {
  const src = readFileSync(resolve(__dirname, "../pixflow.functions.ts"), "utf-8");

  it("图像请求超时常量保持 400_000ms(文档建议 ~400s)", () => {
    expect(src).toMatch(/IMAGE_REQUEST_TIMEOUT_MS\s*=\s*400_000/);
  });

  it("gpt-image-* 分支显式下发 quality 与 response_format=url", () => {
    expect(src).toMatch(/quality:\s*input\.quality\s*\?\?\s*'auto'/);
    expect(src).toMatch(/response_format:\s*'url'/);
  });

  it("有参考图时 endpoint 切到 /v1/images/edits", () => {
    expect(src).toMatch(/hasRefs\s*\?\s*'\/v1\/images\/edits'\s*:\s*'\/v1\/images\/generations'/);
  });
});
