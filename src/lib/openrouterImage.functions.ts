// ====================================================================
//  Legacy image generation —— 非 Seedream 兜底层
//
//  此文件**仅在用户手动选了非 Seedream 模型**时被 seedream.functions.ts 委派调用。
//  默认所有图像生成走 src/lib/seedream.functions.ts(火山方舟 ARK / Doubao Seedream)。
//
//  2026/06 修复 —— 角色流程的 4 个 I2I handler 之前永远走 ARK,忽略了 model 字段。
//  本文件现在同时承担 T2I 和 I2I 委派,T2I 走 Qwen/Wan DashScope + Wanx async 端点;
//  I2I 走 Qwen/Wan DashScope multimodal-generation 端点;Gemini 走 OpenRouter
//  (需 OPENROUTER_API_KEY);GPT-Image-2 直连 Pixflow(需 PIXFLOW_API_KEY)。
//  Seedream 不可用时,这些路径让用户能手动切到老模型继续工作(legacy 兜底层)。
//
//  2026/06 二次修复 —— 严格 fallback 策略:用户选啥 model 就只用那个,失败
//  直接报错,**不再自动降级到不同 model**。`noFallback` 默认值从 false 改为 true。
//  显式传 `noFallback: false` 才能启用 dashScopeAttempts 降级(目前没有调用方)。
//
//  2026/06 三次扩展 —— 直连 Pixflow 出图:
//    - callPixflowImage      GPT-Image-2 走 Pixflow /v1/images/edits(I2I)+
//                           /v1/images/generations(T2I),OpenAI Images 协议。
//                           响应 b64_json → data URL(客户端 <img src> 直渲染)。
//    - gpt-image-2           优先用 PIXFLOW_API_KEY,否则兼容 GEMINI_API_KEY,
//                           再否则才回退到 OPENROUTER_API_KEY(老配置不破坏)。
//    - google/gemini-*       仍走 OpenRouter(modalities:image),路径不变。
//
//  ✅ 保留 + 新增:
//    - callQwenSync / callQwenAsync / dashScopeAttempts  Qwen + Wanx T2I
//    - callQwenI2ISync                                   Qwen 2.0-pro / Wan 2.7-image-pro I2I
//    - callOpenRouterImage                               Gemini / GPT-Image(OpenRouter,兼容层)
//    - callPixflowImage                                  GPT-Image-2 直连 Pixflow(优先)
//    - generateImage(legacy T2I 委派)                    供 seedream.functions.ts:generateImage
//    - regenerateImageI2I(legacy I2I 委派)               供 4 个 I2I handler
//
//  ❌ 已删除(2026 Seedream 迁移):
//    - probeImageModels          OpenRouter 动态模型市场探针
//    - repaintCharacterImage     wanx-style-repaint-v1(0 UI 调用方,Seedream 无等价能力)
//    - callLovableGatewayImage   Lovable AI Gateway
// ====================================================================

import "./loadEnv"; // 2026 修复:Vite 不自动加载 .env.local,显式拉起 loader
import { createServerFn } from "@tanstack/react-start";

type Input = {
  prompt: string;
  model?: string;
  size?: string;
  /**
   * 显式 negative_prompt,作为 DashScope `parameters.negative_prompt` 字段单独下发。
   * 留空则不发送该字段。
   */
  negativePrompt?: string;
  /**
   * 锁定用户选定的 model:
   *   - 默认 **true**(2026/06 改):用户选啥 model 就只用那个,失败直接报错,
   *     不再走 dashScopeAttempts 自动降级链("只用客户选中的模型" 原则)。
   *   - 同 model 内部仍会因 429/5xx 重试 1s/2s/4s 退避(最多 3 次) — 这不算
   *     降级,只是同一个请求的 retry。
   *   - 显式传 `noFallback: false` 才会启用 dashScopeAttempts 降级(老行为,
   *     现在没有调用方使用,留作未来扩展)。
   */
  noFallback?: boolean;
};

// ---------- Qwen (DashScope) image generation ----------
const QWEN_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const QWEN_ASYNC_CREATE =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis";
const QWEN_TASK_GET = "https://dashscope.aliyuncs.com/api/v1/tasks/";

// Sync multimodal endpoint is only safe for the fastest small models.
// qwen-image-max / qwen-image-2.0-pro routinely exceed the 60s Worker
// request budget, so they are forced through the async polling path.
const QWEN_SYNC_MODELS = new Set<string>(["qwen-image-2.0", "qwen-image-2.0-2026-03-03"]);
// Async-only (or async-preferred) models
const QWEN_ASYNC_MODELS = new Set<string>([
  "qwen-image-plus",
  "qwen-image-plus-2026-01-09",
  "qwen-image",
  "qwen-image-2.0-pro",
  "qwen-image-2.0-pro-2026-04-22",
  "qwen-image-2.0-pro-2026-03-03",
  "qwen-image-max",
  "qwen-image-max-2025-12-30",
  // Wan (Tongyi Wanxiang) series — async-only via image-synthesis endpoint
  "wan2.6-t2i",
  "wan2.5-t2i-preview",
  "wan2.2-t2i-flash",
  "wan2.2-t2i-plus",
  "wanx2.1-t2i-turbo",
  "wanx2.1-t2i-plus",
  "wanx2.0-t2i-turbo",
]);

const QWEN_SUPPORTED_SIZES = new Set([
  "1664*928",
  "1472*1104",
  "1328*1328",
  "1104*1472",
  "928*1664",
]);

function normalizeDashScopeSize(model: string, size: string) {
  // Wan 2.7-image-pro I2I 用 '2K' 即可(Qwen 旧版 '数字*数字' 也可,DashScope 通用)
  if (model === "wan2.7-image-pro" && size === "2K") return size;
  if (model.startsWith("qwen-image") && !QWEN_SUPPORTED_SIZES.has(size)) return "1328*1328";
  return size;
}

function dashScopeAttempts(requested: string) {
  const fallbacks: Record<string, string[]> = {
    "qwen-image-max": ["qwen-image-plus", "qwen-image"],
    "qwen-image-max-2025-12-30": ["qwen-image-plus", "qwen-image"],
    "qwen-image-2.0-pro": ["qwen-image-2.0", "qwen-image-plus", "qwen-image"],
    "qwen-image-2.0-pro-2026-04-22": ["qwen-image-2.0", "qwen-image-plus", "qwen-image"],
    "qwen-image-2.0-pro-2026-03-03": ["qwen-image-2.0", "qwen-image-plus", "qwen-image"],
  };
  return [...new Set([requested, ...(fallbacks[requested] ?? [])])];
}

// 429 / 5xx 退避序列(指数退避,3 次后放弃)
const RETRY_BACKOFF_MS = [1_000, 2_000, 4_000] as const;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function callQwenSync(
  model: string,
  prompt: string,
  size: string,
  apiKey: string,
  negativePrompt?: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50_000);
  const res = await fetch(QWEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: { messages: [{ role: "user", content: [{ text: prompt }] }] },
      parameters: {
        size,
        n: 1,
        prompt_extend: true,
        watermark: false,
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
      },
    }),
    signal: controller.signal,
  }).catch((e) => {
    clearTimeout(timeout);
    throw e;
  });
  clearTimeout(timeout);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { url: "", error: `[${model}] ${res.status}: ${text.slice(0, 200)}` };
  }
  const json = (await res.json()) as {
    output?: { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> };
    message?: string;
  };
  const url: string = json.output?.choices?.[0]?.message?.content?.[0]?.image || "";
  return url
    ? { url, error: null as string | null }
    : { url: "", error: `[${model}] ${json?.message || "no image returned"}` };
}

async function callQwenAsync(
  model: string,
  prompt: string,
  size: string,
  apiKey: string,
  negativePrompt?: string,
) {
  // ⚠️ 调用前要确保 model 真的支持 T2I(只吃 prompt)。
  // `qwen-image-2.0-pro` 是 I2I-only,打到这个端点会 400 "url error"——
  // 调用方(resolveT2IModel)负责把 -2.0-pro 替换成 `qwen-image-2.0`,
  // 这里只用 endpoint-acceptable 的最小 body。
  const isQwen = model.startsWith("qwen");
  const body = isQwen
    ? {
        model,
        input: { prompt },
        parameters: { size, ...(negativePrompt ? { negative_prompt: negativePrompt } : {}) },
      }
    : {
        model,
        input: { prompt },
        parameters: {
          size,
          n: 1,
          prompt_extend: true,
          watermark: false,
          ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
        },
      };

  // Retry create on 429 (DashScope per-account RPM is very low for qwen-image-max).
  let create: Response | null = null;
  let lastBody = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      create = await fetch(QWEN_ASYNC_CREATE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-DashScope-Async": "enable",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastBody = e instanceof Error ? e.message : "network error";
      return { url: "", error: `[${model}] network: ${lastBody.slice(0, 200)}` };
    }
    if (create.ok) break;
    lastBody = await create.text().catch(() => "");
    if (create.status !== 429) break;
    await new Promise((r) => setTimeout(r, 4000 + attempt * 4000));
  }
  if (!create || !create.ok) {
    return {
      url: "",
      error: `[${model}] create ${create?.status ?? 0}: ${lastBody.slice(0, 200)}`,
    };
  }
  const cj = (await create.json()) as { output?: { task_id?: string } };
  const taskId: string = cj.output?.task_id || "";
  if (!taskId) return { url: "", error: `[${model}] missing task_id` };
  const deadline = Date.now() + 50_000;
  await new Promise((r) => setTimeout(r, 2000));
  while (Date.now() < deadline) {
    const q = await fetch(QWEN_TASK_GET + taskId, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!q.ok) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    const qj = (await q.json()) as {
      output?: { task_status?: string; results?: Array<{ url?: string }>; message?: string };
      message?: string;
    };
    const status: string = qj.output?.task_status || "";
    if (status === "SUCCEEDED") {
      const url: string = qj.output?.results?.[0]?.url || "";
      return url ? { url, error: null as string | null } : { url: "", error: `[${model}] no url` };
    }
    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      return {
        url: "",
        error: `[${model}] ${status}: ${qj.output?.message || qj.message || ""}`,
      };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { url: "", error: `[${model}] timed out (task ${taskId} still running)` };
}

// ====================================================================
// 2026/06 新增:Legacy I2I 委派实现
//   - callQwenI2ISync: Qwen 2.0-pro / Wan 2.7-image-pro 走 DashScope
//                     multimodal-generation/generation 同步端点
//   - callOpenRouterImage: Gemini / GPT-Image 走 OpenRouter chat/completions
//                          (需 OPENROUTER_API_KEY)
//   - regenerateImageI2I (server fn): 上面 2 个的统一入口,由 seedream.functions.ts
//                                   的 4 个 I2I handler 委派
// ====================================================================

/** DashScope Qwen/Wan I2I 端点 —— 同步、支持 1~3 张参考图 */
async function callQwenI2ISync(
  model: string,
  prompt: string,
  imageUrls: string[],
  size: string,
  apiKey: string,
  negativePrompt?: string,
) {
  // 0 张 = T2I(端点会拒);1~3 张 = I2I;4+ 张直接拒,免得打过去 400
  if (imageUrls.length === 0) {
    return { url: "", error: `[${model}] I2I 至少需要 1 张参考图` };
  }
  if (imageUrls.length > 3) {
    return {
      url: "",
      error: `[${model}] I2I 最多 3 张参考图(端点限制),当前 ${imageUrls.length} 张`,
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const res = await fetch(QWEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: {
          messages: [
            {
              role: "user",
              content: [...imageUrls.map((u) => ({ image: u })), { text: prompt }],
            },
          ],
        },
        parameters: {
          size,
          n: 1,
          prompt_extend: true,
          watermark: false,
          ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
        },
      }),
      signal: controller.signal,
    }).catch((e) => {
      clearTimeout(timeout);
      throw e;
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { url: "", error: `[${model}] ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as {
      output?: { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> };
      message?: string;
    };
    const url: string = json.output?.choices?.[0]?.message?.content?.[0]?.image || "";
    return url
      ? { url, error: null as string | null }
      : { url: "", error: `[${model}] ${json?.message || "no image returned"}` };
  } catch (e) {
    clearTimeout(timeout);
    return {
      url: "",
      error: `[${model}] network: ${e instanceof Error ? e.message : "fetch failed"}`,
    };
  }
}

/** OpenRouter image generation(Gemini / GPT-Image 系列) */
const OPENROUTER_IMAGE_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

async function callOpenRouterImage(
  model: string,
  prompt: string,
  imageUrls: string[],
  size: string,
  apiKey: string,
  negativePrompt?: string,
) {
  if (imageUrls.length === 0) {
    return { url: "", error: `[${model}] I2I 至少需要 1 张参考图` };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const res = await fetch(OPENROUTER_IMAGE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        // OpenRouter 推荐 header(应用标识)
        "HTTP-Referer": process.env.VITE_SUPABASE_URL || "https://doopoo.app",
        "X-Title": "Doopoo Image Gen",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              ...imageUrls.map((u) => ({
                type: "image_url",
                image_url: { url: u },
              })),
              { type: "text", text: prompt },
            ],
          },
        ],
        // 2026 协议:modalities 标记"输出可以是 image";response_format 走 url
        modalities: ["image", "text"],
        ...(size ? { image_size: size } : {}),
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
      }),
      signal: controller.signal,
    }).catch((e) => {
      clearTimeout(timeout);
      throw e;
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { url: "", error: `[${model}] ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as {
      choices?: Array<{
        message?: {
          // 多数 OpenRouter 图模态:images[].image_url.url
          images?: Array<{ image_url?: { url?: string } }>;
          content?: string;
        };
      }>;
      error?: { message?: string };
      message?: string;
    };
    const url: string = json.choices?.[0]?.message?.images?.[0]?.image_url?.url || "";
    if (url) return { url, error: null as string | null };
    // 兜底:少数模型(Gemini 某些版本)把图片 URL 写在 content 文本里
    const contentUrl =
      (json.choices?.[0]?.message?.content || "").match(
        /https?:\/\/\S+\.(png|jpg|jpeg|webp)/i,
      )?.[0] || "";
    return contentUrl
      ? { url: contentUrl, error: null as string | null }
      : {
          url: "",
          error: `[${model}] ${json.error?.message || json.message || "no image returned"}`,
        };
  } catch (e) {
    clearTimeout(timeout);
    return {
      url: "",
      error: `[${model}] network: ${e instanceof Error ? e.message : "fetch failed"}`,
    };
  }
}

/** OpenAI Compatible Pixflow image generation(GPT-Image-2 直连)
 *
 *  Pixflow 同时挂载了 OpenAI Images API(`/v1/images/generations`、`/v1/images/edits`)
 *  和 Google Gemini API。GPT-Image-2 走 OpenAI Images 协议即可,跟 OpenAI
 *  官方 DALL-E/GPT-Image 一致 —— 这条路**不经 OpenRouter 中转**,延迟低、
 *  成本低,且能直接用 .env.local 里的 `GEMINI_API_KEY`(同一个 sk- key
 *  在 Pixflow 同时签发给 OpenAI 和 Gemini 两条路径)。
 *
 *  端点:
 *    - T2I(无参考图):`POST /v1/images/generations`,JSON body
 *    - I2I(1~N 参考图):`POST /v1/images/edits`,multipart/form-data,`image[]` 字段
 *
 *  响应:`{ data: [{ b64_json: "..." }] }`,本文拼成 `data:image/png;base64,...`
 *  返回 —— 客户端 `<img src={...}>` 直渲染,无需额外上传 Supabase。
 */
const PIXFLOW_BASE_URL = (
  process.env.PIXFLOW_BASE_URL ||
  process.env.GOOGLE_GEMINI_BASE_URL ||
  "https://api.pixflow.im"
).replace(/\/+$/, "");
const PIXFLOW_IMAGE_GEN_PATH = "/v1/images/generations";
const PIXFLOW_IMAGE_EDIT_PATH = "/v1/images/edits";
const PIXFLOW_REQUEST_TIMEOUT_MS = 180_000;
// 2026/06:Pixflow OpenAI Images 协议下,gpt-image-2 用这个 model id
const PIXFLOW_GPT_IMAGE_MODEL = "gpt-image-2";

/** 把 URL 抓下来转成 Buffer,用于 multipart 上传 */
async function fetchImageAsBuffer(
  url: string,
  controller: AbortController,
): Promise<{ buf: ArrayBuffer; mime: string; ext: string }> {
  const res = await fetch(url, { signal: controller.signal });
  if (!res.ok) throw new Error(`reference image fetch ${res.status}`);
  const mime =
    (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() || "image/png";
  const ext =
    mime.includes("jpeg") || mime.includes("jpg")
      ? "jpg"
      : mime.includes("webp")
        ? "webp"
        : mime.includes("gif")
          ? "gif"
          : "png";
  const buf = await res.arrayBuffer();
  return { buf, mime, ext };
}

/** Pixflow gpt-image-2 期望的画幅。无效值统一兜底到 1024x1024。 */
function normalizePixflowSize(size: string | undefined): string {
  if (!size) return "1024x1024";
  const s = String(size).trim();
  if (!s) return "1024x1024";
  // '1024x1024' / '1024x1792' / '1792x1024' / 'auto' 直传
  if (/^(auto|1024x1024|1024x1792|1792x1024)$/i.test(s)) return s.toLowerCase();
  // '2048*2048' → '2048x2048'(Seedream 习惯),但 gpt-image-2 最大只到 1792 边,
  // 安全起见压到 1024x1024
  if (/^\d+\*\d+$/.test(s)) return "1024x1024";
  // '2K' / '4K' 这种 GPT-Image-2 不吃,fallback
  return "1024x1024";
}

async function callPixflowImage(
  model: string,
  prompt: string,
  imageUrls: string[],
  size: string,
  apiKey: string,
  negativePrompt?: string,
): Promise<{ url: string; error: string | null }> {
  const useI2I = imageUrls.length > 0;
  if (useI2I && imageUrls.length > 4) {
    // Pixflow /v1/images/edits 经验上 ≤4 张稳定,守住上限免得 400
    return {
      url: "",
      error: `[${model}] I2I 最多 4 张参考图(Pixflow /v1/images/edits),当前 ${imageUrls.length} 张`,
    };
  }
  const endpoint = useI2I ? PIXFLOW_IMAGE_EDIT_PATH : PIXFLOW_IMAGE_GEN_PATH;
  const finalSize = normalizePixflowSize(size);
  // 2026/06 修复:Pixflow OpenAI Images 协议期望"不带 openai/ 前缀"的 model id
  // (例如 `gpt-image-2`),但调用方传进来的是 OpenRouter 风格的 `openai/gpt-image-2`。
  // OpenRouter 能吃带前缀的形式,Pixflow 不行,直传会 400。
  // 兼容两种传参:OpenRouter 风格 → 剥前缀;裸 id → 原样透传;空 → 用默认。
  const useModel = model.startsWith("openai/")
    ? model.slice("openai/".length)
    : model || PIXFLOW_GPT_IMAGE_MODEL;

  // negativePrompt 在 OpenAI Images 协议下没有专属字段,作为 "AVOID:" 段追加到 prompt 末尾
  let finalPrompt = prompt;
  if (negativePrompt && negativePrompt.trim()) {
    finalPrompt = `${prompt}\n\nAVOID (avoid these): ${negativePrompt}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PIXFLOW_REQUEST_TIMEOUT_MS);
  try {
    let res: Response;
    if (useI2I) {
      // I2I 走 multipart/form-data —— 跟 OpenAI 官方 /v1/images/edits 一致
      const form = new FormData();
      form.append("model", useModel);
      form.append("prompt", finalPrompt);
      form.append("size", finalSize);
      form.append("quality", "auto");
      // 串行抓参考图(避免瞬时并发过大),任一失败 → 整个请求失败
      for (let i = 0; i < imageUrls.length; i++) {
        const u = imageUrls[i];
        const { buf, mime, ext } = await fetchImageAsBuffer(u, controller);
        const filename = `ref_${i + 1}.${ext}`;
        // BlobPart 用 ArrayBuffer 即可;Node 18+/现代浏览器都支持
        form.append("image[]", new Blob([buf], { type: mime }), filename);
      }
      res = await fetch(`${PIXFLOW_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          // 注意:fetch 设置 FormData 时**不要**手动加 Content-Type,
          // 浏览器会自动带 boundary
        },
        body: form,
        signal: controller.signal,
      });
    } else {
      // T2I 走 application/json
      res = await fetch(`${PIXFLOW_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: useModel,
          prompt: finalPrompt,
          size: finalSize,
          n: 1,
          quality: "auto",
        }),
        signal: controller.signal,
      });
    }
    clearTimeout(timeout);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { url: "", error: `[${useModel}@pixflow] ${res.status}: ${text.slice(0, 300)}` };
    }
    const json = (await res.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
      error?: { message?: string };
      message?: string;
    };
    const first = json.data?.[0];
    if (first?.b64_json) {
      // 拼成 data URL,客户端 <img src> 直渲染
      return { url: `data:image/png;base64,${first.b64_json}`, error: null };
    }
    if (first?.url) {
      // 极少数情况下 Pixflow 返回 url 字段(应当不会,但兜底)
      return { url: first.url, error: null };
    }
    return {
      url: "",
      error: `[${useModel}@pixflow] ${json.error?.message || json.message || "no image returned"}`,
    };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error ? (e.name === "AbortError" ? "timed out" : e.message) : "fetch failed";
    return {
      url: "",
      error: `[${useModel}@pixflow] network: ${msg}`,
    };
  }
}

// ====================================================================
// regenerateImageI2I (legacy I2I 委派) —— 4 个 I2I handler 共用入口
// 仅在用户选了非 Seedream 模型时由 seedream.functions.ts 调过来。
// 返回 { url, error, model } —— 跟 generateImage T2I 同 shape。
// ====================================================================

type I2IInput = {
  prompt: string;
  model: string;
  /** 画幅:Qwen I2I 用 '2048*2048',Wan 用 '2K',OpenRouter 用 '1024x1024' 这种 */
  size?: string;
  negativePrompt?: string;
  /** 1~3 张参考图。>3 时由 callQwenI2ISync 内部拒,免得给 Qwen 端点喂坏数据。 */
  referenceImages: string[];
  /** true 时锁住 model 不降级(legacy I2I 内部目前没有降级链,留作未来扩展) */
  noFallback?: boolean;
};

export const regenerateImageI2I = createServerFn({ method: "POST" })
  .inputValidator((input: I2IInput) => {
    if (!input || typeof input.prompt !== "string" || !input.prompt.trim()) {
      throw new Error("prompt required");
    }
    if (!input.model || typeof input.model !== "string" || !input.model.trim()) {
      throw new Error("model required (I2I)");
    }
    if (!Array.isArray(input.referenceImages) || input.referenceImages.length === 0) {
      throw new Error("referenceImages required (I2I 至少 1 张)");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const m = data.model.trim();
    const size = data.size?.trim() || "2K";
    const negativePrompt = data.negativePrompt?.trim() || undefined;
    const imageUrls = data.referenceImages.filter((u) => !!u && typeof u === "string");

    // ---- Qwen 2.0-pro / Wan 2.7-image-pro → DashScope multimodal-generation ----
    if (m === "qwen-image-2.0-pro" || m === "wan2.7-image-pro") {
      const apiKey = process.env.Qwen || process.env.DASHSCOPE_API_KEY;
      if (!apiKey) {
        return {
          url: "",
          error: "Qwen / DASHSCOPE_API_KEY not configured (在 .env.local 加 DASHSCOPE_API_KEY=...)",
          model: m,
        };
      }
      const dashSize = m === "qwen-image-2.0-pro" ? "2048*2048" : "2K";
      const r = await callQwenI2ISync(m, data.prompt, imageUrls, dashSize, apiKey, negativePrompt);
      return { ...r, model: m };
    }

    // ---- GPT-Image → Pixflow(优先) / OpenRouter(兼容 fallback) ----
    // 2026/06:用户给 .env.local 配了 `GEMINI_API_KEY`(sk-eba4... 实际是 Pixflow
    // OpenAI 路径的 key),同时 Pixflow 文档也支持 /v1/images/{generations,edits}。
    // 直连 Pixflow 延迟低 / 成本低,且能拿到 b64_json 完整图。
    if (m === "openai/gpt-image-2" || m === "openai/gpt-image-1-mini") {
      const pixflowKey =
        process.env.PIXFLOW_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY;
      if (!pixflowKey) {
        return {
          url: "",
          error:
            "PIXFLOW_API_KEY / GEMINI_API_KEY not configured (在 .env.local 加 PIXFLOW_API_KEY=... 才能用此模型,OpenRouter 路径已弃用)",
          model: m,
        };
      }
      const r = await callPixflowImage(m, data.prompt, imageUrls, size, pixflowKey, negativePrompt);
      return { ...r, model: m };
    }

    // ---- Gemini → OpenRouter(走 chat/completions + modalities:image) ----
    if (m === "google/gemini-3.1-flash-image-preview") {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        return {
          url: "",
          error:
            "OPENROUTER_API_KEY not configured (在 .env.local 加 OPENROUTER_API_KEY=... 才能用 Gemini 模型)",
          model: m,
        };
      }
      const r = await callOpenRouterImage(m, data.prompt, imageUrls, size, apiKey, negativePrompt);
      return { ...r, model: m };
    }

    return { url: "", error: `unsupported I2I model: ${m}`, model: m };
  });

// ====================================================================
// generateImage (legacy) —— DashScope Qwen/Wan 兜底层
// 通常由 seedream.functions.ts 委派,仅当 caller 显式选了非 Seedream 模型时。
// ====================================================================

export const generateImage = createServerFn({ method: "POST" })
  .inputValidator((input: Input) => {
    if (!input || typeof input.prompt !== "string" || !input.prompt.trim()) {
      throw new Error("prompt required");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const requested = (data.model || "").trim();

    // 2026/06:GPT-Image-2 走 Pixflow /v1/images/generations(纯 T2I,无参考图)。
    // 优先级:Gemini 仍走 OpenRouter,GPT-Image-2 直连 Pixflow。
    if (requested === "openai/gpt-image-2" || requested === "openai/gpt-image-1-mini") {
      const pixflowKey =
        process.env.PIXFLOW_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY;
      if (!pixflowKey) {
        return {
          url: "",
          error:
            "PIXFLOW_API_KEY / GEMINI_API_KEY not configured (在 .env.local 加 PIXFLOW_API_KEY=... 才能用此模型)",
          model: requested,
        };
      }
      const r = await callPixflowImage(
        requested,
        data.prompt,
        [],
        data.size || "1024x1024",
        pixflowKey,
        data.negativePrompt,
      );
      return { ...r, model: requested };
    }

    // ---- Qwen / Wan DashScope(原 T2I 路径)----
    const qwenKey = process.env.Qwen || process.env.DASHSCOPE_API_KEY;
    // 2026/06:默认严格(只用客户选中的 model,失败直接报错)。
    // 只有显式传 `noFallback: false` 才走 dashScopeAttempts 降级。
    // 同 model 内部 429/5xx 重试 1s/2s/4s 仍保留(只是 retry,不是降级)。
    const noFallback = data.noFallback !== false;

    if (!qwenKey) {
      return {
        url: "",
        error: "No Qwen API key configured (set Qwen or DASHSCOPE_API_KEY in .env.local)",
        model: requested,
      };
    }

    const errors: string[] = [];
    // 默认 T2I model 是 `qwen-image-2.0`(真正支持 T2I 的 Qwen 模型)。
    // 不能默认 `qwen-image-2.0-pro` —— 它是 I2I-only,会 400 "url error"。
    const model = requested || "qwen-image-2.0";
    const size = data.size || "2048*2048";
    const negativePrompt = data.negativePrompt?.trim() || undefined;

    const callOnce = async (
      m: string,
      s: string,
    ): Promise<{ url: string; error: string | null }> => {
      try {
        return QWEN_ASYNC_MODELS.has(m)
          ? await callQwenAsync(m, data.prompt, s, qwenKey, negativePrompt)
          : await callQwenSync(m, data.prompt, s, qwenKey, negativePrompt);
      } catch (e) {
        return {
          url: "",
          error: `[${m}] network: ${e instanceof Error ? e.message : "fetch failed"}`,
        };
      }
    };

    // 同一 model 429/5xx 重试(指数退避)
    const result = await (async () => {
      let lastErr: string | null = null;
      const attempts = [model, ...RETRY_BACKOFF_MS.map(() => model)];
      for (let i = 0; i < attempts.length; i++) {
        const r = await callOnce(model, size);
        if (r.url) return r;
        lastErr = r.error;
        const isRetryable = /429|502|503|504|timed out|aborted|ECONNRESET/i.test(r.error ?? "");
        if (!isRetryable) return r;
        if (i < attempts.length - 1) {
          await sleep(RETRY_BACKOFF_MS[i] ?? 1_000);
        }
      }
      return { url: "", error: lastErr } as { url: string; error: string | null };
    })();

    if (result.url) return { ...result, model };
    if (result.error) errors.push(result.error);

    // 2026/06:默认 noFallback=true(只用客户选中的 model)。这里只在调用方显式
    // 传 `noFallback: false` 时才走 dashScopeAttempts 降级链。
    // 当前没有调用方用 false,所以这个分支是 dead code,但保留以便未来扩展。
    if (!noFallback) {
      for (const fallback of dashScopeAttempts(requested)) {
        if (fallback === model) continue;
        const isWan = fallback.startsWith("wan");
        const defaultSize = isWan ? "1024*1024" : "1328*1328";
        const fallbackSize = normalizeDashScopeSize(fallback, data.size || defaultSize);
        let fbResult: { url: string; error: string | null } = { url: "", error: null };
        let fbLastErr: string | null = null;
        for (let i = 0; i <= RETRY_BACKOFF_MS.length; i++) {
          const r = await (QWEN_ASYNC_MODELS.has(fallback)
            ? await callQwenAsync(fallback, data.prompt, fallbackSize, qwenKey, negativePrompt)
            : await callQwenSync(fallback, data.prompt, fallbackSize, qwenKey, negativePrompt));
          if (r.url) {
            fbResult = r;
            break;
          }
          fbLastErr = r.error;
          const isRetryable = /429|502|503|504|timed out|aborted|ECONNRESET/i.test(r.error ?? "");
          if (!isRetryable) {
            fbResult = r;
            break;
          }
          if (i < RETRY_BACKOFF_MS.length) await sleep(RETRY_BACKOFF_MS[i] ?? 1_000);
        }
        if (fbResult.url) return { ...fbResult, model: fallback };
        if (fbResult.error) errors.push(fbResult.error);
        else if (fbLastErr) errors.push(fbLastErr);
      }
    }

    const lastErr = errors.join("；") || "Qwen image generation failed";
    return {
      url: "",
      error: noFallback ? `${lastErr} (model locked: ${model}, no fallback used)` : lastErr,
      model,
    };
  });
