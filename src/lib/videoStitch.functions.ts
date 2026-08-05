/**
 * 分段视频合成剧集：调用外部转码服务做 concat（可选混入原片音轨）。
 * Cloudflare Worker 跑不了 ffmpeg，因此这里只负责下发任务与轮询状态。
 *
 * 需要的环境变量（在 handler 内读取）：
 *   TRANSCODE_API_URL —— 外部转码服务基地址，例如 https://transcode.example.com
 *   TRANSCODE_API_KEY —— 服务鉴权 Bearer Token
 * 契约：
 *   POST {base}/jobs   { clips: string[], audioUrl?: string, format: "mp4" } -> { jobId }
 *   GET  {base}/jobs/{jobId}                                                 -> { status, outputUrl?, error? }
 *
 * 参考视频裁剪（转绘分段参考片段，修复素材库 1.8–30.2s 时长 400）：
 *   POST {base}/trim   { url, startMs, endMs, format: "mp4" } -> { jobId }
 *   GET  {base}/jobs/{jobId}                                 -> { status, outputUrl?, error? }
 * 轮询与合成共用同一 /jobs/{jobId} 查询端点。
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "../integrations/supabase/auth-middleware";

const SubmitSchema = z.object({
  episode: z.string().min(1).max(120),
  /** 按播放顺序排列的分段视频 URL。 */
  clips: z.array(z.string().url().max(2_000)).min(1).max(120),
  /** 可选：整集音轨（原片抽出的 WAV/MP3），用于替换模型自造音轨。 */
  audioUrl: z.string().url().max(2_000).optional(),
});

const PollSchema = z.object({ jobId: z.string().min(1).max(200) });

export type StitchSubmitResult = { ok: true; jobId: string } | { ok: false; error: string };
export type StitchPollResult =
  | { ok: true; status: "queued" | "running" }
  | { ok: true; status: "succeeded"; videoUrl: string }
  | { ok: false; status: "failed"; error: string };

function readConfig(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = process.env["TRANSCODE_API_URL"];
  const apiKey = process.env["TRANSCODE_API_KEY"];
  if (!baseUrl || !apiKey) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

const MISSING_CONFIG =
  "外部转码服务未配置：请设置 TRANSCODE_API_URL 与 TRANSCODE_API_KEY 后再合成成片。";

/** 提交合成任务：分段按顺序 concat，可选混入整集音轨。 */
export const submitVideoStitchJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SubmitSchema.parse(input))
  .handler(async ({ data }): Promise<StitchSubmitResult> => {
    const config = readConfig();
    if (!config) return { ok: false, error: MISSING_CONFIG };
    try {
      const response = await fetch(`${config.baseUrl}/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          clips: data.clips,
          audioUrl: data.audioUrl,
          format: "mp4",
          label: data.episode,
        }),
      });
      if (!response.ok) {
        const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 240);
        return {
          ok: false,
          error: `转码服务提交失败（${response.status}）：${detail || "无详情"}`,
        };
      }
      const payload = (await response.json()) as { jobId?: string; id?: string };
      const jobId = payload.jobId ?? payload.id;
      if (!jobId) return { ok: false, error: "转码服务没有返回任务编号" };
      return { ok: true, jobId };
    } catch (error) {
      return {
        ok: false,
        error: `转码服务请求失败：${error instanceof Error ? error.message : "网络错误"}`,
      };
    }
  });

/** 轮询合成任务状态。轮询是幂等的，网络抖动由调用方重试。 */
export const pollVideoStitchJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => PollSchema.parse(input))
  .handler(async ({ data }): Promise<StitchPollResult> => {
    const config = readConfig();
    if (!config) return { ok: false, status: "failed", error: MISSING_CONFIG };
    return pollTranscodeJob(config, data.jobId);
  });

/** 合成与裁剪共用的任务状态查询（GET /jobs/{jobId}）。 */
async function pollTranscodeJob(
  config: { baseUrl: string; apiKey: string },
  jobId: string,
): Promise<StitchPollResult> {
  try {
    const response = await fetch(`${config.baseUrl}/jobs/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!response.ok) {
      const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 240);
      return {
        ok: false,
        status: "failed",
        error: `转码任务查询失败（${response.status}）：${detail || "无详情"}`,
      };
    }
    const payload = (await response.json()) as {
      status?: string;
      outputUrl?: string;
      url?: string;
      error?: string;
    };
    const status = (payload.status ?? "running").toLowerCase();
    if (status === "succeeded" || status === "success" || status === "done") {
      const videoUrl = payload.outputUrl ?? payload.url;
      if (!videoUrl) {
        return { ok: false, status: "failed", error: "转码任务完成但没有返回成片 URL" };
      }
      return { ok: true, status: "succeeded", videoUrl };
    }
    if (status === "failed" || status === "error" || status === "cancelled") {
      return { ok: false, status: "failed", error: payload.error ?? "转码任务失败" };
    }
    return { ok: true, status: status === "queued" || status === "pending" ? "queued" : "running" };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      error: `转码任务查询请求失败：${error instanceof Error ? error.message : "网络错误"}`,
    };
  }
}

const TrimSubmitSchema = z.object({
  /** 原片公网 URL。 */
  url: z.string().url().max(2_000),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
});

/**
 * 提交参考视频裁剪任务：把分钟级原片裁成分段对应的短片段，
 * 使参考视频时长落在素材库允许的 1.8–30 秒内（修复素材入库 400）。
 */
export const submitVideoTrimJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => TrimSubmitSchema.parse(input))
  .handler(async ({ data }): Promise<StitchSubmitResult> => {
    const config = readConfig();
    if (!config) {
      return {
        ok: false,
        error:
          "外部转码服务未配置：请设置 TRANSCODE_API_URL 与 TRANSCODE_API_KEY 后再裁剪参考视频。",
      };
    }
    try {
      const response = await fetch(`${config.baseUrl}/trim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          url: data.url,
          startMs: data.startMs,
          endMs: data.endMs,
          format: "mp4",
        }),
      });
      if (!response.ok) {
        const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 240);
        return {
          ok: false,
          error: `参考视频裁剪提交失败（${response.status}）：${detail || "无详情"}`,
        };
      }
      const payload = (await response.json()) as { jobId?: string; id?: string };
      const jobId = payload.jobId ?? payload.id;
      if (!jobId) return { ok: false, error: "转码服务没有返回裁剪任务编号" };
      return { ok: true, jobId };
    } catch (error) {
      return {
        ok: false,
        error: `参考视频裁剪请求失败：${error instanceof Error ? error.message : "网络错误"}`,
      };
    }
  });

/** 轮询参考视频裁剪任务状态（与合成共用 GET /jobs/{jobId}）。 */
export const pollVideoTrimJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => PollSchema.parse(input))
  .handler(async ({ data }): Promise<StitchPollResult> => {
    const config = readConfig();
    if (!config) {
      return {
        ok: false,
        status: "failed",
        error:
          "外部转码服务未配置：请设置 TRANSCODE_API_URL 与 TRANSCODE_API_KEY 后再裁剪参考视频。",
      };
    }
    return pollTranscodeJob(config, data.jobId);
  });
