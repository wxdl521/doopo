// ====================================================================
//  Kling AI (可灵) 视频生成 —— 快手旗下 AI 视频平台
//
//  Base URL: https://api-beijing.klingai.com
//  Auth:     Authorization: Bearer ${KLING_API_KEY}
//
//  异步模式: 提交 → 轮询 → 拿视频 URL
//    - T2V: POST /v1/videos/text2video
//    - I2V: POST /v1/videos/image2video
//    - 查询: GET  /v1/videos/text2video/{task_id}
//            GET  /v1/videos/image2video/{task_id}
//
//  UI 选项约定:所有走可灵的模型 id 都加 `kling-` 前缀。
// ====================================================================

import "./loadEnv";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DEFAULT_BASE_URL = "https://api-beijing.klingai.com";
const SUBMIT_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 30_000;

export const KLING_VIDEO_MODELS = {
  "kling-v2-6": "Kling 2.6 · 最高画质 · 5/10s · 原生音频",
  "kling-v3": "Kling 3.0 · 旗舰 · 3-15s · 多镜头",
} as const;

export function isKlingVideoModel(modelId: string | null | undefined): boolean {
  return !!modelId && modelId.toLowerCase().startsWith("kling-");
}

/** 剥离 `kling-` 前缀 */
export function stripKlingPrefix(modelId: string): string {
  return modelId.replace(/^kling-/i, "");
}

function getKlingConfig() {
  return {
    apiKey: process.env.KLING_API_KEY,
    baseUrl: (process.env.KLING_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

type KlingSubmitInput = {
  model: string;
  prompt: string;
  imageUrl?: string;
  lastFrameImageUrl?: string;
  duration?: number;
  ratio?: string;
  generateAudio?: boolean;
  apiKey: string;
  baseUrl: string;
};

type KlingSubmitResult =
  | { ok: true; taskId: string; endpoint: "text2video" | "image2video" }
  | { ok: false; error: string };

async function klingSubmit(input: KlingSubmitInput): Promise<KlingSubmitResult> {
  // Kling 模型名自带 kling- 前缀,和内部路由前缀一致,直接透传
  const upstreamModel = input.model || "kling-v2-6";
  // 有首帧图走 I2V,否则 T2V
  const isI2V = !!input.imageUrl;
  const endpoint = isI2V ? "/v1/videos/image2video" : "/v1/videos/text2video";

  const body: Record<string, unknown> = {
    model_name: upstreamModel,
    prompt: input.prompt.slice(0, 2500),
    duration: String(input.duration ?? 5),
    mode: "pro",
  };

  if (input.ratio) body.aspect_ratio = input.ratio;
  if (input.generateAudio) body.sound = "on";
  if (isI2V) {
    body.image = input.imageUrl;
    if (input.lastFrameImageUrl) body.image_tail = input.lastFrameImageUrl;
  }

  const t0 = Date.now();
  console.log(
    `[kling→] model=${upstreamModel} endpoint=${endpoint} i2v=${isI2V} duration=${body.duration}s`,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
  try {
    const res = await fetch(`${input.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      console.warn(`[kling×] submit ${res.status} full body:`, text.slice(0, 2000));
      return { ok: false, error: `[kling] submit ${res.status}: ${text.slice(0, 500)}` };
    }

    let json: { code?: number; message?: string; data?: { task_id?: string } } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    if (!json.data?.task_id) {
      console.warn(`[kling×] no task_id, full body:`, text.slice(0, 2000));
      return {
        ok: false,
        error: `[kling] no task_id: ${json.message || text.slice(0, 200)}`,
      };
    }
    console.log(`[kling✓] submit ok task_id=${json.data.task_id} dur=${Date.now() - t0}ms`);
    return { ok: true, taskId: json.data.task_id, endpoint: isI2V ? "image2video" : "text2video" };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error ? (e.name === "AbortError" ? "submit timeout" : e.message) : "fetch failed";
    return { ok: false, error: `[kling] network: ${msg}` };
  }
}

/** Kling 原始 status 映射到项目内 SeedanceProgress */
function klingStatusToProgress(s: string): "queued" | "running" | "succeeded" | "failed" | "cancelled" {
  const map: Record<string, "queued" | "running" | "succeeded" | "failed" | "cancelled"> = {
    submitted: "queued",
    processing: "running",
    succeed: "succeeded",
    failed: "failed",
    cancelled: "cancelled",
  };
  return map[s] || "running";
}

type KlingRawStatus = "submitted" | "processing" | "succeed" | "failed" | "cancelled";

type KlingPollResult =
  | {
      ok: true;
      status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
      rawStatus: KlingRawStatus;
      videoUrl: string | null;
      raw: any;
    }
  | { ok: false; error: string; status?: string; raw?: any };

async function klingPoll(input: {
  taskId: string;
  apiKey: string;
  baseUrl: string;
  /** 提交时用的 endpoint,决定查询路径 */
  endpoint: "text2video" | "image2video";
}): Promise<KlingPollResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
  try {
    const res = await fetch(`${input.baseUrl}/v1/videos/${input.endpoint}/${input.taskId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return { ok: false, error: `[kling] poll ${res.status}: ${text.slice(0, 300)}` };
    }

    let json: {
      code?: number;
      message?: string;
      data?: {
        task_id?: string;
        task_status?: string;
        task_status_msg?: string;
        task_result?: { videos?: Array<{ url?: string; watermark_url?: string }> };
      };
    } = {};
    try {
      json = JSON.parse(text);
    } catch {}

    const rawStatus = (json.data?.task_status || "").toLowerCase() as KlingRawStatus;
    const status = klingStatusToProgress(rawStatus);
    const videoUrl = json.data?.task_result?.videos?.[0]?.url || null;
    return { ok: true, status, rawStatus, videoUrl, raw: json };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error ? (e.name === "AbortError" ? "poll timeout" : e.message) : "fetch failed";
    return { ok: false, error: `[kling] poll network: ${msg}` };
  }
}

// ---------- 供 videoGenerate.functions.ts 内部调用 ----------

export async function callKlingVideoSubmit(input: {
  model: string;
  prompt: string;
  imageUrl?: string;
  lastFrameImageUrl?: string;
  duration?: number;
  ratio?: string;
  generateAudio?: boolean;
}): Promise<
  | { ok: true; taskId: string; endpoint: "text2video" | "image2video" }
  | { ok: false; error: string }
> {
  const { apiKey, baseUrl } = getKlingConfig();
  if (!apiKey) return { ok: false, error: "KLING_API_KEY not configured" };
  return klingSubmit({ ...input, apiKey, baseUrl });
}

export async function callKlingVideoPoll(input: {
  taskId: string;
  endpoint: "text2video" | "image2video";
}): Promise<KlingPollResult> {
  const { apiKey, baseUrl } = getKlingConfig();
  if (!apiKey) return { ok: false, error: "KLING_API_KEY not configured" };
  return klingPoll({ taskId: input.taskId, apiKey, baseUrl, endpoint: input.endpoint });
}

// ---------- ServerFn (独立调用) ----------

const KlingVideoInput = z.object({
  prompt: z.string().min(1).max(2500),
  model: z.string().min(1).max(100).optional(),
  imageUrl: z.string().url().optional(),
  lastFrameImageUrl: z.string().url().optional(),
  duration: z.number().int().min(3).max(15).optional(),
  ratio: z.enum(["16:9", "9:16", "1:1"]).optional(),
  generateAudio: z.boolean().optional(),
  deadlineMs: z.number().min(10_000).max(600_000).optional(),
  pollMs: z.number().min(2_000).max(30_000).optional(),
});

export const generateKlingVideo = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => KlingVideoInput.parse(d))
  .handler(async ({ data }) => {
    // 1) 提交
    const submit = await callKlingVideoSubmit({
      model: data.model || "kling-v2-6",
      prompt: data.prompt,
      imageUrl: data.imageUrl,
      lastFrameImageUrl: data.lastFrameImageUrl,
      duration: data.duration,
      ratio: data.ratio,
      generateAudio: data.generateAudio,
    });
    if (!submit.ok) return { ok: false as const, error: submit.error };

    // 2) 轮询
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const deadline = Date.now() + (data.deadlineMs ?? 300_000);
    const pollInterval = data.pollMs ?? 5_000;
    let lastStatus = "submitted";
    while (Date.now() < deadline) {
      await sleep(pollInterval);
      const poll = await callKlingVideoPoll({
        taskId: submit.taskId,
        endpoint: submit.endpoint,
      });
      if (!poll.ok) continue;
      lastStatus = poll.status;
      if (poll.status === "succeeded") {
        return {
          ok: true as const,
          taskId: submit.taskId,
          videoUrl: poll.videoUrl || "",
          model: data.model || "kling-v2-6",
          raw: poll.raw,
        };
      }
      if (poll.status === "failed") {
        const errMsg = (poll.raw as any)?.data?.task_status_msg || "failed (no error detail)";
        return { ok: false as const, error: `[kling] failed: ${errMsg}`, taskId: submit.taskId };
      }
    }
    return {
      ok: false as const,
      error: `[kling] timed out (last status: ${lastStatus})`,
      taskId: submit.taskId,
    };
  });
