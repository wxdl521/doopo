import { createServerFn } from "@tanstack/react-start";

type Input = { prompt: string; model?: string; size?: string };
type ImageModelInfo = { id?: unknown; architecture?: { output_modalities?: unknown } };

// ---------- Qwen (DashScope) image generation ----------
const QWEN_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const QWEN_ASYNC_CREATE =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis";
const WAN2_PRO_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation";
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
// Wan 2.7 Pro uses the new image-generation endpoint with messages format
const WAN2_PRO_MODELS = new Set<string>([
  "wan2.7-image-pro",
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

async function callQwenSync(model: string, prompt: string, size: string, apiKey: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50_000);
  const res = await fetch(QWEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: { messages: [{ role: "user", content: [{ text: prompt }] }] },
      parameters: { size, n: 1, prompt_extend: true, watermark: false },
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

async function callQwenAsync(model: string, prompt: string, size: string, apiKey: string) {
  // qwen-image-* async endpoint rejects extra params with "url error";
  // wan* accepts the full param set. Build a minimal body per family.
  const isQwen = model.startsWith("qwen");
  const body = isQwen
    ? { model, input: { prompt }, parameters: { size } }
    : {
        model,
        input: { prompt },
        parameters: { size, n: 1, prompt_extend: true, watermark: false },
      };

  // Retry create on 429 (DashScope per-account RPM is very low for qwen-image-max).
  let create: Response | null = null;
  let lastBody = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    create = await fetch(QWEN_ASYNC_CREATE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify(body),
    });
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

// async function callWan2Pro(prompt: string, size: string, apiKey: string) {
//   // Wan 2.7 Pro uses the new image-generation endpoint with messages format.
//   let create: Response | null = null;
//   let lastBody = "";
//   for (let attempt = 0; attempt < 3; attempt++) {
//     create = await fetch(WAN2_PRO_ENDPOINT, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${apiKey}`,
//         "X-DashScope-Async": "enable",
//       },
//       body: JSON.stringify({
//         model: "wan2.7-image-pro",
//         input: {
//           messages: [
//             {
//               role: "user",
//               content: [{ text: prompt }],
//             },
//           ],
//         },
//         parameters: { size, n: 1, watermark: false, thinking_mode: true },
//       }),
//     });
//     if (create.ok) break;
//     lastBody = await create.text().catch(() => "");
//     if (create.status !== 429) break;
//     await new Promise((r) => setTimeout(r, 4000 + attempt * 4000));
//   }
//   if (!create || !create.ok) {
//     return { url: "", error: `[wan2.7-image-pro] create ${create?.status ?? 0}: ${lastBody.slice(0, 200)}` };
//   }
//   const cj = (await create.json()) as { output?: { task_id?: string } };
//   const taskId: string = cj.output?.task_id || "";
//   if (!taskId) return { url: "", error: `[wan2.7-image-pro] missing task_id` };

//   const deadline = Date.now() + 50_000;
//   await new Promise((r) => setTimeout(r, 3000));
//   while (Date.now() < deadline) {
//     const q = await fetch(QWEN_TASK_GET + taskId, {
//       headers: { Authorization: `Bearer ${apiKey}` },
//     });
//     if (!q.ok) {
//       await new Promise((r) => setTimeout(r, 3000));
//       continue;
//     }
//     const qj = (await q.json()) as {
//       output?: { task_status?: string; results?: Array<{ url?: string }>; message?: string };
//       message?: string;
//     };
//     const status: string = qj.output?.task_status || "";
//     if (status === "SUCCEEDED") {
//       const url: string = qj.output?.results?.[0]?.url || "";
//       return url ? { url, error: null as string | null } : { url: "", error: `[wan2.7-image-pro] no url` };
//     }
//     if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
//       return {
//         url: "",
//         error: `[wan2.7-image-pro] ${status}: ${qj.output?.message || qj.message || ""}`,
//       };
//     }
//     await new Promise((r) => setTimeout(r, 3000));
//   }
//   return { url: "", error: `[wan2.7-image-pro] timed out (task ${taskId} still running)` };
// }

async function callWanxStyleRepaint(imageUrl: string, styleIndex: number, apiKey: string) {
  const WANX_STYLE_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation";
  let create: Response | null = null;
  let lastBody = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    create = await fetch(WANX_STYLE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model: "wanx-style-repaint-v1",
        input: {
          image_url: imageUrl,
          style_index: styleIndex,
        },
      }),
    });
    if (create.ok) break;
    lastBody = await create.text().catch(() => "");
    if (create.status !== 429) break;
    await new Promise((r) => setTimeout(r, 4000 + attempt * 4000));
  }
  if (!create || !create.ok) {
    return { url: "", error: `[wanx-style-repaint-v1] create ${create?.status ?? 0}: ${lastBody.slice(0, 200)}` };
  }
  const cj = (await create.json()) as { output?: { task_id?: string } };
  const taskId: string = cj.output?.task_id || "";
  if (!taskId) return { url: "", error: `[wanx-style-repaint-v1] missing task_id` };

  const deadline = Date.now() + 50_000;
  await new Promise((r) => setTimeout(r, 3000));
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
      return url ? { url, error: null as string | null } : { url: "", error: `[wanx-style-repaint-v1] no url` };
    }
    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      return {
        url: "",
        error: `[wanx-style-repaint-v1] ${status}: ${qj.output?.message || qj.message || ""}`,
      };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { url: "", error: `[wanx-style-repaint-v1] timed out (task ${taskId} still running)` };
}

function extractImageUrl(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.startsWith("data:image/") ? value : "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = extractImageUrl(item);
      if (url) return url;
    }
    return "";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const direct =
      (typeof obj.url === "string" && obj.url.startsWith("data:image/") ? obj.url : "") ||
      (typeof obj.image === "string" && obj.image.startsWith("data:image/") ? obj.image : "");
    if (direct) return direct;
    for (const key of ["image_url", "images", "content", "message", "delta", "choices"]) {
      const url = extractImageUrl(obj[key]);
      if (url) return url;
    }
  }
  return "";
}

async function callLovableGatewayImage(prompt: string) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return { url: "", error: "LOVABLE_API_KEY is not configured", model: "" };
  const model = "google/gemini-3.1-flash-image-preview";
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
      stream: true,
    }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) return { url: "", error: `[${model}] ${res.status}: ${text.slice(0, 180)}`, model };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const url = extractImageUrl(JSON.parse(payload));
      if (url) return { url, error: null as string | null, model };
    } catch {
      // Ignore non-JSON stream keepalive lines.
    }
  }
  const inlineUrl = text.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/)?.[0] || "";
  return inlineUrl
    ? { url: inlineUrl, error: null as string | null, model }
    : { url: "", error: `[${model}] returned no image`, model };
}

function isDashScopeModel(id: string) {
  return id.startsWith("qwen") || id.startsWith("wan");
}

// Preferred order — tried first if present in the live model list.
const PREFERRED_ORDER = ["google/gemini-3.1-flash-image-preview"];

// Models known to frequently reject normal creative prompts via TOS — skip them.
const BLOCKED_MODELS = new Set<string>([
  "openai/gpt-5-image",
  "openai/gpt-5-image-mini",
  "openai/gpt-5.4-image-2",
  "google/gemini-3-pro-image-preview",
  "google/gemini-2.5-flash-image",
]);

// Runtime block list, populated by health probe + 403 responses observed at runtime.
const runtimeBlocked = new Set<string>();
let probeState: { ts: number; healthy: string[]; blocked: string[] } | null = null;
const PROBE_CACHE_MS = 30 * 60 * 1000;
const PROBE_PROMPT = "a small red dot on white background";

const RETRYABLE_STATUSES = new Set([403, 404, 429, 502, 503]);

let cachedModels: { ids: string[]; ts: number } | null = null;
const MODEL_CACHE_MS = 10 * 60 * 1000;

async function fetchImageModels(apiKey: string): Promise<string[]> {
  if (cachedModels && Date.now() - cachedModels.ts < MODEL_CACHE_MS) return cachedModels.ids;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: ImageModelInfo[] };
    const ids: string[] = (json.data ?? [])
      .filter((m) => {
        const out = m.architecture?.output_modalities ?? [];
        return Array.isArray(out) && out.includes("image");
      })
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string")
      .filter((id: string) => id && !id.startsWith("openrouter/"));
    cachedModels = { ids, ts: Date.now() };
    return ids;
  } catch {
    return [];
  }
}

function buildAttempts(requested: string | undefined, available: string[]): string[] {
  const set = new Set<string>();
  if (requested?.trim()) set.add(requested.trim());
  for (const id of PREFERRED_ORDER) if (available.includes(id)) set.add(id);
  for (const id of available) set.add(id);
  if (set.size === 0) PREFERRED_ORDER.forEach((id) => set.add(id));
  return [...set].filter((id) => !BLOCKED_MODELS.has(id) && !runtimeBlocked.has(id));
}

async function probeModel(apiKey: string, model: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://doopoo.app",
        "X-Title": "Doopoo",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: PROBE_PROMPT }],
        modalities: ["image", "text"],
        max_tokens: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    // 403 / 404 = unusable; 401 = auth issue (don't blame the model); others = healthy enough.
    if (res.status === 403 || res.status === 404) return false;
    return true;
  } catch {
    // Network/timeout — give the benefit of the doubt; don't pre-block.
    return true;
  }
}

export const probeImageModels = createServerFn({ method: "POST" }).handler(async () => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { healthy: [], blocked: [], cached: false };
  if (probeState && Date.now() - probeState.ts < PROBE_CACHE_MS) {
    return { ...probeState, cached: true };
  }
  const available = await fetchImageModels(apiKey);
  const candidates = [...new Set([...PREFERRED_ORDER, ...available])]
    .filter((id) => !BLOCKED_MODELS.has(id))
    .slice(0, 6);
  const results = await Promise.all(
    candidates.map(async (id) => ({ id, ok: await probeModel(apiKey, id) })),
  );
  const healthy: string[] = [];
  const blocked: string[] = [];
  for (const r of results) {
    if (r.ok) healthy.push(r.id);
    else {
      blocked.push(r.id);
      runtimeBlocked.add(r.id);
    }
  }
  probeState = { ts: Date.now(), healthy, blocked };
  return { healthy, blocked, cached: false };
});

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

    // Use Qwen image generation API
    if (qwenKey) {
      const errors: string[] = [];
      // Default to qwen-image-2.0-pro for high quality
      const model = requested || "qwen-image-2.0-pro";
      const size = data.size || "2048*2048";
      const result = QWEN_ASYNC_MODELS.has(model)
        ? await callQwenAsync(model, data.prompt, size, qwenKey)
        : await callQwenSync(model, data.prompt, size, qwenKey);
      if (result.url) return { ...result, model };
      if (result.error) errors.push(result.error);

      // Try fallback models
      for (const fallback of dashScopeAttempts(requested)) {
        if (fallback === model) continue;
        const isWan = fallback.startsWith("wan");
        const defaultSize = isWan ? "1024*1024" : "1328*1328";
        const fallbackSize = normalizeDashScopeSize(fallback, data.size || defaultSize);
        const fbResult = QWEN_ASYNC_MODELS.has(fallback)
          ? await callQwenAsync(fallback, data.prompt, fallbackSize, qwenKey)
          : await callQwenSync(fallback, data.prompt, fallbackSize, qwenKey);
        if (fbResult.url) return { ...fbResult, model: fallback };
        if (fbResult.error) errors.push(fbResult.error);
      }

      return { url: "", error: errors.join("；") || "Qwen image generation failed", model };
    }

    // // Fallback to Lovable AI
    // if (process.env.LOVABLE_API_KEY) {
    //   const lovableResult = await callLovableGatewayImage(data.prompt);
    //   if (lovableResult.url) return lovableResult;
    // }

    // // Fallback to OpenRouter
    // const apiKey = process.env.OPENROUTER_API_KEY;
    // if (apiKey) {
    //   const available = await fetchImageModels(apiKey);
    //   const attempts = buildAttempts(requested, available);
    //   let lastError = "Image generation failed";
    //   for (const model of attempts) {
    //     try {
    //       const controller = new AbortController();
    //       const timeout = setTimeout(() => controller.abort(), 55_000);
    //       const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    //         method: "POST",
    //         headers: {
    //           Authorization: `Bearer ${apiKey}`,
    //           "Content-Type": "application/json",
    //           "HTTP-Referer": "https://doopoo.app",
    //           "X-Title": "Doopoo",
    //         },
    //         body: JSON.stringify({
    //           model,
    //           messages: [{ role: "user", content: data.prompt }],
    //           modalities: ["image", "text"],
    //         }),
    //         signal: controller.signal,
    //       });
    //       clearTimeout(timeout);
    //       if (!res.ok) {
    //         const text = await res.text().catch(() => "");
    //         lastError = `[${model}] ${res.status}: ${text.slice(0, 180)}`;
    //         if (RETRYABLE_STATUSES.has(res.status)) continue;
    //         return { url: "", error: lastError, model };
    //       }
    //       const json = (await res.json()) as {
    //         choices?: Array<{
    //           message?: { images?: Array<{ image_url?: { url?: string }; url?: string }> };
    //         }>;
    //       };
    //       const msg = json.choices?.[0]?.message;
    //       const url: string = msg?.images?.[0]?.image_url?.url || msg?.images?.[0]?.url || "";
    //       if (url) return { url, error: null as string | null, model };
    //       lastError = `[${model}] returned no image`;
    //     } catch (e) {
    //       lastError = e instanceof Error && e.name === "AbortError" ? `[${model}] timed out` : `[${model}] ${e instanceof Error ? e.message : "network error"}`;
    //     }
    //   }
    //   return { url: "", error: lastError, model: "" };
    // }

    return { url: "", error: "No Qwen API key configured", model: requested };
  });

export const repaintCharacterImage = createServerFn({ method: "POST" })
  .inputValidator((input: { imageUrl: string; styleIndex: number }) => {
    if (!input || typeof input.imageUrl !== "string" || !input.imageUrl.trim()) {
      throw new Error("imageUrl required");
    }
    if (typeof input.styleIndex !== "number" || input.styleIndex < 0) {
      throw new Error("styleIndex must be a non-negative number");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const qwenKey = process.env.Qwen || process.env.DASHSCOPE_API_KEY;
    if (!qwenKey) return { url: "", error: "Qwen (DashScope) API key is not configured" };
    return callWanxStyleRepaint(data.imageUrl, data.styleIndex, qwenKey);
  });
