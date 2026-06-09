// ====================================================================
//  Legacy image generation —— Qwen DashScope fallback tier
//
//  此文件**仅在用户手动选了非 Seedream 模型**时被 seedream.functions.ts 委派调用。
//  默认所有图像生成走 src/lib/seedream.functions.ts(火山方舟 ARK)。
//
//  这里保留 DashScope Qwen + Wanx T2I/I2I 调用路径,目的是当 Seedream 不可用时,
//  让用户能手动切到老模型继续工作(legacy 兜底层)。
//
//  ❌ 已删除(2026 Seedream 迁移):
//    - probeImageModels          OpenRouter 动态模型市场探针
//    - repaintCharacterImage     wanx-style-repaint-v1(0 UI 调用方,Seedream 无等价能力)
//    - callLovableGatewayImage   Lovable AI Gateway(无 OPENROUTER_API_KEY 启用)
//    - OpenRouter 整条路径       不再走 OpenRouter,Seedream 替代
//
//  ✅ 保留:
//    - callQwenSync / callQwenAsync / dashScopeAttempts  Qwen + Wanx 系列
//    - generateImage(legacy 委派)                        供 seedream.functions.ts 间接调用
// ====================================================================

import './loadEnv'  // 2026 修复:Vite 不自动加载 .env.local,显式拉起 loader
import { createServerFn } from "@tanstack/react-start";

type Input = {
  prompt: string
  model?: string
  size?: string
  /**
   * 显式 negative_prompt,作为 DashScope `parameters.negative_prompt` 字段单独下发。
   * 留空则不发送该字段。
   */
  negativePrompt?: string
  /**
   * 锁定用户选定的 model:被 rate-limit(429)时**只重试同一个 model**
   * (1s/2s/4s 退避,最多 3 次),不再降级到不同 model。
   * 仅在 seedream.functions.ts 内部"明确锁定 Seedream 但 key 失效"时使用。
   * legacy 兜底路径通常走 dashScopeAttempts 自动降级。
   */
  noFallback?: boolean
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
const RETRY_BACKOFF_MS = [1_000, 2_000, 4_000] as const
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function callQwenSync(model: string, prompt: string, size: string, apiKey: string, negativePrompt?: string) {
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

async function callQwenAsync(model: string, prompt: string, size: string, apiKey: string, negativePrompt?: string) {
  // ⚠️ 调用前要确保 model 真的支持 T2I(只吃 prompt)。
  // `qwen-image-2.0-pro` 是 I2I-only,打到这个端点会 400 "url error"——
  // 调用方(resolveT2IModel)负责把 -2.0-pro 替换成 `qwen-image-2.0`,
  // 这里只用 endpoint-acceptable 的最小 body。
  const isQwen = model.startsWith("qwen");
  const body = isQwen
    ? { model, input: { prompt }, parameters: { size, ...(negativePrompt ? { negative_prompt: negativePrompt } : {}) } }
    : {
        model,
        input: { prompt },
        parameters: { size, n: 1, prompt_extend: true, watermark: false, ...(negativePrompt ? { negative_prompt: negativePrompt } : {}) },
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
    const qwenKey = process.env.Qwen || process.env.DASHSCOPE_API_KEY;
    const requested = (data.model || "").trim();
    const noFallback = data.noFallback === true;

    if (!qwenKey) {
      return { url: "", error: "No Qwen API key configured (set Qwen or DASHSCOPE_API_KEY in .env.local)", model: requested };
    }

    const errors: string[] = [];
    // 默认 T2I model 是 `qwen-image-2.0`(真正支持 T2I 的 Qwen 模型)。
    // 不能默认 `qwen-image-2.0-pro` —— 它是 I2I-only,会 400 "url error"。
    const model = requested || "qwen-image-2.0";
    const size = data.size || "2048*2048";
    const negativePrompt = data.negativePrompt?.trim() || undefined;

    const callOnce = async (m: string, s: string): Promise<{ url: string; error: string | null }> => {
      try {
        return QWEN_ASYNC_MODELS.has(m)
          ? await callQwenAsync(m, data.prompt, s, qwenKey, negativePrompt)
          : await callQwenSync(m, data.prompt, s, qwenKey, negativePrompt)
      } catch (e) {
        return {
          url: "",
          error: `[${m}] network: ${e instanceof Error ? e.message : "fetch failed"}`,
        }
      }
    }

    // 同一 model 429/5xx 重试(指数退避)
    const result = await (async () => {
      let lastErr: string | null = null
      const attempts = [model, ...RETRY_BACKOFF_MS.map(() => model)]
      for (let i = 0; i < attempts.length; i++) {
        const r = await callOnce(model, size)
        if (r.url) return r
        lastErr = r.error
        const isRetryable = /429|502|503|504|timed out|aborted|ECONNRESET/i.test(r.error ?? "")
        if (!isRetryable) return r
        if (i < attempts.length - 1) {
          await sleep(RETRY_BACKOFF_MS[i] ?? 1_000)
        }
      }
      return { url: "", error: lastErr } as { url: string; error: string | null }
    })()

    if (result.url) return { ...result, model };
    if (result.error) errors.push(result.error);

    // Fallback models(只对 noFallback=false 走)
    if (!noFallback) {
      for (const fallback of dashScopeAttempts(requested)) {
        if (fallback === model) continue;
        const isWan = fallback.startsWith("wan");
        const defaultSize = isWan ? "1024*1024" : "1328*1328";
        const fallbackSize = normalizeDashScopeSize(fallback, data.size || defaultSize);
        let fbResult: { url: string; error: string | null } = { url: "", error: null }
        let fbLastErr: string | null = null
        for (let i = 0; i <= RETRY_BACKOFF_MS.length; i++) {
          const r = await (QWEN_ASYNC_MODELS.has(fallback)
            ? await callQwenAsync(fallback, data.prompt, fallbackSize, qwenKey, negativePrompt)
            : await callQwenSync(fallback, data.prompt, fallbackSize, qwenKey, negativePrompt))
          if (r.url) { fbResult = r; break }
          fbLastErr = r.error
          const isRetryable = /429|502|503|504|timed out|aborted|ECONNRESET/i.test(r.error ?? "")
          if (!isRetryable) { fbResult = r; break }
          if (i < RETRY_BACKOFF_MS.length) await sleep(RETRY_BACKOFF_MS[i] ?? 1_000)
        }
        if (fbResult.url) return { ...fbResult, model: fallback };
        if (fbResult.error) errors.push(fbResult.error);
        else if (fbLastErr) errors.push(fbLastErr);
      }
    }

    const lastErr = errors.join("；") || "Qwen image generation failed"
    return {
      url: "",
      error: noFallback
        ? `${lastErr} (model locked: ${model}, no fallback used)`
        : lastErr,
      model,
    };
  });
