// ====================================================================
//  视频生成 —— 双后端统一调度
//
//  2026 接入:用户在 NewProjectDialog 里既可以选火山方舟 ARK 的 Seedance,
//  也可以选阿里 DashScope 的 HappyHorse / Wanx 系列。后端实现差异不小,
//  这里按 model id 自动路由到对应的提交/轮询端点。
//
//  ┌──────────────────────┬────────────────────────────────────────────┐
//  │ doubao-seedance-*    │ 火山方舟 ARK                               │
//  │ (或 seedance-*)      │  POST {ARK_BASE_URL}/contents/generations/tasks
//  │                      │  GET  {ARK_BASE_URL}/contents/generations/tasks/{id}
//  │                      │  返回结构:{status, content:{video_url}}     │
//  ├──────────────────────┼────────────────────────────────────────────┤
//  │ happyhorse-*         │ 阿里 DashScope                              │
//  │ wan2.*-i2v / t2v     │  POST dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis
//  │ wanx2.1-*            │  Header: X-DashScope-Async: enable
//  │ qwen-image 视频变体  │  GET  dashscope.aliyuncs.com/api/v1/tasks/{id}
//  │ (其他 legacy)        │  返回结构:{output:{task_status, video_url}}│
//  └──────────────────────┴────────────────────────────────────────────┘
//
//  三个 server function:
//   1) submitVideoTask       —— 立即返回 taskId
//   2) pollVideoTask         —— 单次轮询
//   3) generateVideo         —— 高层 helper(submit + poll + onProgress)
//
//  历史:这个文件的前身是 seedance.functions.ts(2026 6 月仅支持 ARK)。
//  用户在 docs/qwen.md 加了 HappyHorse 接口后,扩展成双后端 dispatcher。
// ====================================================================

import "./loadEnv"; // 2026 修复:必须最先导入,让 ARK/Qwen env 在读取前就绪
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash, createHmac } from "node:crypto";
import { KLING_VIDEO_MODELS } from "./klingVideo.functions";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchMedia } from "./workspaceMedia.functions";
import { chargeCredits } from "./userCredits.functions";
import { videoCost } from "./creditsCost";

// ---------- ARK (Seedance) 配置 ----------

const ARK_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const ARK_DEFAULT_MODEL = "doubao-seedance-2-0-260128";

// ---------- DashScope (HappyHorse / Wanx) 配置 ----------

const DASHSCOPE_VIDEO_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis";
const DASHSCOPE_TASK_GET = "https://dashscope.aliyuncs.com/api/v1/tasks/";

// ====================================================================
// 模型路由
// ====================================================================

/**
 * 模型 id 路由到对应后端。
 *  - ARK (Seedance):doubao-seedance-* 或 seedance-*
 *  - DashScope (HappyHorse / Wan / Wanx):其他视频模型 id 一律 fallback 到 DashScope
 */
export function getVideoBackend(
  modelId: string | null | undefined,
):
  | "ark"
  | "dashscope"
  | "jimeng"
  | "kuaizi"
  | "toapis"
  | "k99"
  | "vapeur"
  | "shuci"
  | "kling"
  | "confluo"
  | "topenrouter"
  | "hongmeng"
  | "sdreal" {
  const m = (modelId || "").trim().toLowerCase();
  if (m.startsWith("dreamina-seedance-")) return "sdreal";
  if (m.startsWith("doubao-seedance-") || m.startsWith("seedance-")) return "ark";
  if (m.startsWith("shuci-")) return "shuci";
  if (m.startsWith("jimeng-")) return "jimeng";
  if (m.startsWith("kuaizi-")) return "kuaizi";
  if (m.startsWith("toapis-")) return "toapis";
  if (m.startsWith("k99-")) return "k99";
  if (m.startsWith("vapeur-")) return "vapeur";
  if (m.startsWith("kling-")) return "kling";
  if (m.startsWith("confluo-")) return "confluo";
  if (m.startsWith("topenrouter-")) return "topenrouter";
  if (m.startsWith("hongmeng-")) return "hongmeng";
  return "dashscope";
}

export const SHUCIYUAN_VIDEO_MODELS = {
  "shuci-seedance-2-0": "Seedance 2.0 (数安词源)",
  "shuci-seedance-2-0-fast": "Seedance 2.0 Fast (数安词源)",
  "shuci-seedance-2-0-mini": "Seedance 2.0 Mini (数安词源)",
} as const;

// 汇流 Confluo(OpenAI 兼容聚合网关 models.iystd.com,中转 doubao-seedance)
export const CONFLUO_VIDEO_MODELS = {
  "confluo-doubao-seedance-2-0-260128": "Seedance 2.0 (汇流)",
  "confluo-doubao-seedance-2-0-fast-260128": "Seedance 2.0 Fast (汇流)",
  "confluo-doubao-seedance-2-0-mini-260615": "Seedance 2.0 Mini (汇流)",
} as const;

// TopenRouter(tp-api.chinadatapay.com,中转火山方舟 doubao-seedance)
export const TOPENROUTER_VIDEO_MODELS = {
  "topenrouter-doubao-seedance-2-0-260128": "Seedance 2.0 (TopenRouter)",
  "topenrouter-doubao-seedance-2-0-fast-260128": "Seedance 2.0 Fast (TopenRouter)",
  "topenrouter-doubao-seedance-2-0-mini-260615": "Seedance 2.0 Mini (TopenRouter)",
} as const;

// 弘梦(ai.kunagent.com,中转 Seedance 2 系列:fast/mini/pro)
export const HONGMENG_VIDEO_MODELS = {
  "hongmeng-seedance2-fast": "Seedance 2 Fast (弘梦)",
  "hongmeng-seedance2-mini": "Seedance 2 Mini (弘梦)",
  "hongmeng-seedance2-pro": "Seedance 2 Pro (弘梦)",
} as const;

// SD Real Max（service-inference.ai）—— Dreamina Seedance 2.0 系列。
// 该供应商要求先把公网素材登记为 asset，再以 asset://<id> 作为视频参考图。
export const SDREAL_VIDEO_MODELS = {
  "dreamina-seedance-2-0-fast-hc": "Dreamina Seedance 2.0 Fast (SD Real Max)",
  "dreamina-seedance-2-0-hc": "Dreamina Seedance 2.0 (SD Real Max)",
  "dreamina-seedance-2-0-mini-hc": "Dreamina Seedance 2.0 Mini (SD Real Max)",
} as const;

export const SEEDANCE_MODELS = {
  "doubao-seedance-2-0-260128": "Doubao Seedance 2.0",
  "doubao-seedance-2-0-fast-260128": "Doubao Seedance 2.0 Fast (720p)",
  "doubao-seedance-1-0-pro-250528": "Doubao Seedance 1.0 Pro (T2V)",
  "doubao-seedance-1-0-lite-i2v-250428": "Doubao Seedance 1.0 Lite (I2V)",
  ...SHUCIYUAN_VIDEO_MODELS,
  ...CONFLUO_VIDEO_MODELS,
  ...TOPENROUTER_VIDEO_MODELS,
  ...HONGMENG_VIDEO_MODELS,
  ...SDREAL_VIDEO_MODELS,
  ...KLING_VIDEO_MODELS,
} as const;

export const HAPPYHORSE_MODELS = {
  "happyhorse-1.0-t2v": "HappyHorse 1.0 (文生视频)",
  "happyhorse-1.0-i2v": "HappyHorse 1.0 (图生视频·首帧)",
  "happyhorse-1.0-r2v": "HappyHorse 1.0 (参考生视频)",
} as const;

export const JIMENG_MODELS = {
  "jimeng-3.0-pro": "即梦 3.0 Pro (文生视频)",
  "jimeng-3.0-pro-i2v": "即梦 3.0 Pro (图生视频·首帧)",
} as const;

export const KUAIZI_MODELS = {
  "kuaizi-lizhen-pro": "丽帧 Pro (1080p · 文/图/多模态)",
  "kuaizi-lizhen-fast": "丽帧 Fast (720p · 快速)",
  "kuaizi-lizhen-mini": "丽帧 Mini (轻量)",
} as const;

// 筷子科技"丽帧"配置 —— 中转火山方舟 Seedance,提供链式超分 / 版权放行等增值能力
const KUAIZI_DEFAULT_BASE_URL = "https://aiopenapi.kuaizi.cn";
const KUAIZI_CREATE_PATH = "/ai-open-platform-api/v1/lz/video/task/create";
const KUAIZI_STATUS_PATH = "/ai-open-platform-api/v1/lz/video/task/status";

export const TOAPIS_MODELS = {
  "toapis-seedance-2": "Seedance 2 (ToAPIs · 1080p/4k)",
  "toapis-seedance-2-fast": "Seedance 2 Fast (ToAPIs · 720p)",
  "toapis-seedance-2-mini": "Seedance 2 Mini (ToAPIs · 多模态参考)",
} as const;

// ToAPIs 配置 —— 中转火山方舟 Seedance 2 系列
const TOAPIS_DEFAULT_BASE_URL = "https://toapis.com";

export const K99_MODELS = {
  "k99-fast-480p": "k99 快速 480p",
  "k99-pro-1080p": "k99 高清 1080p",
} as const;

// k99.tw 配置 —— Sora 风格 API,中转视频生成
const K99_DEFAULT_BASE_URL = "https://k99.tw";
const K99_CREATE_PATH = "/v1/videos"; // POST 提交
const K99_STATUS_PATH = "/v1/videos"; // GET /v1/videos/{task_id}
const TOAPIS_CREATE_PATH = "/v1/videos/generations";

export const VAPEUR_MODELS = {
  "vapeur-doubao-seedance-2-0-260128": "Seedance 2.0 (vapeur)",
  "vapeur-doubao-seedance-2-0-fast-260128": "Seedance 2.0 Fast (vapeur)",
} as const;

// vapeur.ai 配置 —— OpenAI 兼容统一网关,中转火山方舟 Seedance 2.0
const VAPEUR_DEFAULT_BASE_URL = "https://api.vapeur.ai";
const VAPEUR_CREATE_PATH = "/v1/videos/generations"; // POST 提交(newapi 风格)
const VAPEUR_STATUS_PATH = "/v1/videos/generations"; // GET /v1/videos/generations/{id} 查询

// 数安词源配置。实测其网关是 New API / OpenAI video 兼容协议：
// POST /v1/videos、GET /v1/videos/{id}；不是 ARK 的 /contents/generations/tasks。
// 该域名当前 HTTPS 证书主机名不匹配，因此默认保留供应商可用的 HTTP 地址。
const SHUCIYUAN_DEFAULT_BASE_URL = "http://token.ds.cyberpeace.cn";
const SHUCIYUAN_VIDEO_MODEL_MAP: Record<string, string> = {
  "shuci-seedance-2-0": "doubao-seedance-2-0-260128",
  "shuci-seedance-2-0-fast": "doubao-seedance-2-0-fast-260128",
  "shuci-seedance-2-0-mini": "doubao-seedance-2-0-mini-260615",
};

function getShuciVideoConfig() {
  return {
    apiKey: process.env.SHUANCIYUAN_VIDEO_KEY,
    baseUrl: (process.env.SHUANCIYUAN_VIDEO_BASE_URL || SHUCIYUAN_DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    ),
  };
}

function shuciStatusToProgress(status: string | undefined): SeedanceProgress {
  const value = (status || "").toLowerCase();
  if (["completed", "succeeded", "success"].includes(value)) return "succeeded";
  if (["failed", "error"].includes(value)) return "failed";
  if (["cancelled", "canceled"].includes(value)) return "cancelled";
  if (["running", "processing", "in_progress"].includes(value)) return "running";
  return "queued";
}

async function shuciSubmit(input: {
  model: string;
  prompt: string;
  media: DashScopeMediaItem[];
  ratio?: SeedanceRatio;
  duration?: number;
  apiKey: string;
  baseUrl: string;
}): Promise<{ ok: true; taskId: string; model: string } | { ok: false; error: string }> {
  const body: Record<string, unknown> = { model: input.model, prompt: input.prompt };
  const firstFrame = input.media.find((item) => item.type === "first_frame")?.url;
  if (firstFrame) body.image = firstFrame;
  if (input.ratio) body.size = input.ratio;
  if (typeof input.duration === "number") body.duration = input.duration;
  try {
    const response = await fetch(`${input.baseUrl}/v1/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify(body),
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) return { ok: false, error: `[shuci] submit ${response.status}: ${text.slice(0, 300)}` };
    const json = JSON.parse(text) as { id?: string; task_id?: string; data?: { id?: string; task_id?: string }; error?: { message?: string }; message?: string };
    const taskId = json.id || json.task_id || json.data?.id || json.data?.task_id;
    return taskId
      ? { ok: true, taskId, model: input.model }
      : { ok: false, error: `[shuci] no task id: ${json.error?.message || json.message || text.slice(0, 200)}` };
  } catch (error) {
    return { ok: false, error: `[shuci] network: ${error instanceof Error ? error.message : "fetch failed"}` };
  }
}

async function shuciPoll(input: {
  taskId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<PollResult> {
  try {
    const response = await fetch(`${input.baseUrl}/v1/videos/${encodeURIComponent(input.taskId)}`, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) return { ok: false, error: `[shuci] poll ${response.status}: ${text.slice(0, 300)}` };
    const json = JSON.parse(text) as {
      status?: string; url?: string; video_url?: string; video?: { url?: string };
      output?: { url?: string; video_url?: string }; error?: { message?: string };
    };
    return {
      ok: true,
      status: shuciStatusToProgress(json.status),
      videoUrl: json.url || json.video_url || json.video?.url || json.output?.url || json.output?.video_url || null,
      raw: { error: { message: json.error?.message || "" }, ...json },
    };
  } catch (error) {
    return { ok: false, error: `[shuci] poll network: ${error instanceof Error ? error.message : "fetch failed"}` };
  }
}

// 即梦 3.0 Pro 文生/图生视频统一用同一个 req_key
const JIMENG_REQ_KEY = "jimeng_ti2v_v30_pro";
const JIMENG_HOST = "visual.volcengineapi.com";
const JIMENG_REGION = "cn-north-1";
const JIMENG_SERVICE = "cv";
const JIMENG_VERSION = "2022-08-31";

// ====================================================================
// 通用类型
// ====================================================================

type ContentItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string }; role?: "reference_image" }
  | { type: "video_url"; video_url: { url: string }; role?: "reference_video" }
  | { type: "audio_url"; audio_url: { url: string }; role?: "reference_audio" };

export type SeedanceProgress = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export const SUPPORTED_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"] as const;
export type SeedanceRatio = (typeof SUPPORTED_RATIOS)[number];

// ====================================================================
// ARK (Seedance) 端实现
// ====================================================================

function getArkConfig() {
  return {
    apiKey: process.env.ARK_API_KEY,
    baseUrl: (process.env.ARK_BASE_URL || ARK_DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: process.env.ARK_VIDEO_MODEL || ARK_DEFAULT_MODEL,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 项目内部 resolution('480P'/'720P'/'1080P' 大写)-> ARK Seedance 小写格式。
 *  ARK 协议 resolution 为顶层字段(与 ratio/duration 平级),取值小写。
 *  按需求不支持 4k,仅映射 480p/720p/1080p,其余兜底 720p。 */
function toArkResolution(r: string | undefined): "480p" | "720p" | "1080p" {
  const s = (r || "720P").trim().toLowerCase();
  if (s === "480p") return "480p";
  if (s === "1080p") return "1080p";
  return "720p";
}

async function arkSubmit(input: {
  model: string;
  content: ContentItem[];
  ratio?: SeedanceRatio;
  resolution?: string;
  duration?: number;
  generateAudio?: boolean;
  watermark?: boolean;
  apiKey: string;
  baseUrl: string;
  /** 错误日志标签,如 "ark-seedance" / "shuci" */
  label?: string;
}): Promise<{ ok: true; taskId: string; model: string } | { ok: false; error: string }> {
  const tag = input.label || "ark-seedance";
  const body: Record<string, unknown> = {
    model: input.model,
    content: input.content,
  };
  if (input.ratio) body.ratio = input.ratio;
  if (input.resolution) body.resolution = toArkResolution(input.resolution);
  if (typeof input.duration === "number") body.duration = input.duration;
  if (typeof input.generateAudio === "boolean") body.generate_audio = input.generateAudio;
  if (typeof input.watermark === "boolean") body.watermark = input.watermark;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${input.baseUrl}/contents/generations/tasks`, {
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
      console.warn(`[${tag}] submit ${res.status} full body:`, text.slice(0, 2000));
      return { ok: false, error: `[${tag}] submit ${res.status}: ${text.slice(0, 500)}` };
    }
    // 2026/06 Bugfix:res.text() 已经把 body 流消费了,res.json() 必然失败。
    // 改成 JSON.parse(text) 复用同一份 text,不再二次读 body。
    let json: { id?: string; error?: { code?: string; message?: string } } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    if (!json.id) {
      console.warn(`[${tag}] json parse failed / no id, full body:`, text.slice(0, 2000));
      return {
        ok: false,
        error: `[${tag}] no task_id: ${json.error?.message || text.slice(0, 500)}`,
      };
    }
    return { ok: true, taskId: json.id, model: input.model };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "submit timeout (30s)"
          : e.message
        : "fetch failed";
    return { ok: false, error: `[${tag}] network: ${msg}` };
  }
}

/** 把 Seedance status 字符串映射到项目内 SeedanceProgress
 *  适用于 ARK 官方 + vapeur 中转(都走 Seedance status 协议)。
 *  官方文档只示例了 succeeded,实际可能返回 queued/running/failed/cancelled
 *  以及 pending/processing/canceled(美式)等,统一映射避免非标准值静默卡死轮询 */
export function seedanceStatusToProgress(s: string | undefined): SeedanceProgress {
  const v = (s || "").toLowerCase();
  // 弘梦等 ARK 兼容中转并不总是透传 ARK 的 `succeeded`，常见的完成态还有
  // completed / success / done。未识别完成态会落入下面的 running，导致前端无限转圈。
  if (["succeeded", "completed", "complete", "success", "done", "finished"].includes(v)) {
    return "succeeded";
  }
  // expired:任务超时过期(TopenRouter / ARK 均可能返回),按失败终态处理,避免空转 deadline
  if (
    [
      "failed",
      "failure",
      "error",
      "expired",
      "rejected",
      "terminated",
      "aborted",
      "timeout",
    ].includes(v)
  ) {
    return "failed";
  }
  if (["cancelled", "canceled"].includes(v)) return "cancelled";
  if (["running", "processing", "in_progress", "generating"].includes(v)) return "running";
  if (["queued", "pending", "submitted", "created", "waiting"].includes(v)) return "queued";
  // 未知状态默认 running(继续轮询,不命中终态,避免空转 deadline)
  return "running";
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function firstNonEmptyString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/**
 * 中转服务的任务查询响应有两类：ARK 原生的 `content.video_url`，以及把任务
 * 包进 `data` / `result` / `output` 的兼容格式。统一提取，避免任务已完成却拿不到
 * 视频 URL。这里只读取已知的视频字段，不会把任意字符串误当成资源地址。
 */
export function extractArkVideoUrl(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root) return null;
  const nested = [root.content, root.output, root.data, root.result, root.task]
    .map(asRecord)
    .filter((value): value is UnknownRecord => Boolean(value));
  const records = [root, ...nested];
  const urls: unknown[] = [];
  for (const record of records) {
    urls.push(record.video_url, record.videoUrl, record.url);
    const content = asRecord(record.content);
    if (content) urls.push(content.video_url, content.videoUrl, content.url);
    const results = record.results;
    if (Array.isArray(results)) urls.push(results[0]);
  }
  return firstNonEmptyString(urls);
}

function extractArkTaskStatus(payload: unknown): string | undefined {
  const root = asRecord(payload);
  if (!root) return undefined;
  const nested = [root.data, root.result, root.output, root.task]
    .map(asRecord)
    .filter((value): value is UnknownRecord => Boolean(value));
  return firstNonEmptyString([root.status, ...nested.map((record) => record.status)]) || undefined;
}

async function arkPoll(input: {
  taskId: string;
  apiKey: string;
  baseUrl: string;
  /** 错误日志标签,如 "ark-seedance" / "shuci" */
  label?: string;
}): Promise<
  | { ok: true; status: SeedanceProgress; videoUrl: string | null; raw: any }
  | { ok: false; error: string; status?: SeedanceProgress; raw?: any }
> {
  const tag = input.label || "ark-seedance";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${input.baseUrl}/contents/generations/tasks/${input.taskId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await res.text().catch(() => "");
    if (!res.ok) return { ok: false, error: `[${tag}] poll ${res.status}: ${text.slice(0, 300)}` };
    // 2026/06 Bugfix:见 arkSubmit —— 改用 JSON.parse(text) 而不是 res.json()
    let json: unknown = {};
    try {
      json = JSON.parse(text);
    } catch {}
    const status = seedanceStatusToProgress(extractArkTaskStatus(json));
    const videoUrl = extractArkVideoUrl(json);
    return { ok: true, status, videoUrl, raw: json };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "poll timeout (30s)"
          : e.message
        : "fetch failed";
    return { ok: false, error: `[${tag}] poll network: ${msg}` };
  }
}

// ====================================================================
// DashScope (HappyHorse / Wanx) 端实现
//
//  提交:POST /api/v1/services/aigc/video-generation/video-synthesis
//        Header: X-DashScope-Async: enable
//        Body:
//          {
//            "model": "happyhorse-1.0-t2v" | "-i2v" | "-r2v",
//            "input": {
//              "prompt": "...",
//              "media": [                    ← 可选,首帧 / 参考图
//                { "type": "first_frame", "url": "..." },
//                { "type": "reference_image", "url": "..." },
//                ...
//              ]
//            },
//            "parameters": {
//              "resolution": "720P" | "1080P",
//              "ratio": "16:9" | "9:16" | ... ,
//              "duration": 5
//            }
//          }
//        返回:{ output: { task_id, task_status: "PENDING" } }
//
//  轮询:GET /api/v1/tasks/{task_id}
//        返回:{ output: { task_status, video_url, submit_time, ... } }
//        video_url 出现在 output.video_url(output.results 不存在,跟 image 任务不同)。
// ====================================================================

function getDashScopeConfig() {
  return {
    apiKey: process.env.Qwen || process.env.DASHSCOPE_API_KEY,
  };
}

type DashScopeMediaItem = { type: "first_frame" | "last_frame" | "reference_image"; url: string };

// ----- ARK 内容拼装 -----
type ArkReferences = {
  referenceImageUrls?: string[];
  firstFrameImageUrl?: string;
  lastFrameImageUrl?: string;
  referenceVideoUrl?: string;
  referenceAudioUrl?: string;
};

/**
 * 按 ARK 官方 cURL 示例拼 content 数组(text + 多个 image_url + 可选 video_url / audio_url)
 */
export function buildArkContent(prompt: string, refs: ArkReferences): ContentItem[] {
  const content: ContentItem[] = [{ type: "text", text: prompt }];
  if (refs.firstFrameImageUrl) {
    content.push({
      type: "image_url",
      image_url: { url: refs.firstFrameImageUrl },
      role: "reference_image",
    });
  }
  // ARK Seedance 没有显式 last_frame role,当 reference_image 处理(放第二张)
  if (refs.lastFrameImageUrl) {
    content.push({
      type: "image_url",
      image_url: { url: refs.lastFrameImageUrl },
      role: "reference_image",
    });
  }
  for (const url of refs.referenceImageUrls ?? []) {
    content.push({ type: "image_url", image_url: { url }, role: "reference_image" });
  }
  if (refs.referenceVideoUrl) {
    content.push({
      type: "video_url",
      video_url: { url: refs.referenceVideoUrl },
      role: "reference_video",
    });
  }
  if (refs.referenceAudioUrl) {
    content.push({
      type: "audio_url",
      audio_url: { url: refs.referenceAudioUrl },
      role: "reference_audio",
    });
  }
  return content;
}

async function dashscopeSubmit(input: {
  model: string;
  prompt: string;
  media: DashScopeMediaItem[];
  ratio?: string;
  resolution?: string;
  duration?: number;
  apiKey: string;
}): Promise<{ ok: true; taskId: string; model: string } | { ok: false; error: string }> {
  const body: Record<string, unknown> = {
    model: input.model,
    input: {
      prompt: input.prompt,
      ...(input.media.length > 0 ? { media: input.media } : {}),
    },
    parameters: {
      resolution: input.resolution || "720P",
      ...(input.ratio ? { ratio: input.ratio } : {}),
      ...(typeof input.duration === "number" ? { duration: input.duration } : {}),
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(DASHSCOPE_VIDEO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await res.text().catch(() => "");
    if (!res.ok)
      return { ok: false, error: `[dashscope-video] submit ${res.status}: ${text.slice(0, 300)}` };
    // 2026/06 Bugfix:见 arkSubmit —— 改用 JSON.parse(text) 而不是 res.json()
    let json: {
      output?: { task_id?: string; task_status?: string };
      error?: { code?: string; message?: string };
    } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    const taskId = json.output?.task_id;
    if (!taskId) {
      return {
        ok: false,
        error: `[dashscope-video] no task_id: ${json.error?.message || text.slice(0, 200)}`,
      };
    }
    return { ok: true, taskId, model: input.model };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "submit timeout (30s)"
          : e.message
        : "fetch failed";
    return { ok: false, error: `[dashscope-video] network: ${msg}` };
  }
}

/** 把 DashScope task_status 字符串映射到项目内 SeedanceProgress
 *  DashScope 视频任务状态:PENDING/RUNNING/SUCCEEDED/FAILED(大写),可能还有 UNKNOWN。
 *  映射避免 pending 等值塞给前端 onProgress,未知状态兜底 running 继续轮询 */
function dashscopeStatusToProgress(s: string | undefined): SeedanceProgress {
  const v = (s || "").toLowerCase();
  if (v === "succeeded") return "succeeded";
  if (v === "failed") return "failed";
  if (v === "cancelled" || v === "canceled") return "cancelled";
  if (v === "running") return "running";
  if (v === "pending" || v === "queued") return "queued";
  return "running";
}

async function dashscopePoll(input: {
  taskId: string;
  apiKey: string;
}): Promise<
  | { ok: true; status: SeedanceProgress; videoUrl: string | null; raw: any }
  | { ok: false; error: string; status?: SeedanceProgress; raw?: any }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(DASHSCOPE_TASK_GET + input.taskId, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await res.text().catch(() => "");
    if (!res.ok)
      return { ok: false, error: `[dashscope-video] poll ${res.status}: ${text.slice(0, 300)}` };
    // 2026/06 Bugfix:见 arkSubmit —— 改用 JSON.parse(text) 而不是 res.json()
    let json: {
      output?: {
        task_status?: string;
        video_url?: string;
        results?: Array<{ video_url?: string; url?: string }>;
      };
      error?: { code?: string; message?: string };
    } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    const status = dashscopeStatusToProgress(json.output?.task_status);
    // 成功时 video_url 在 output.video_url(DashScope 视频任务的字段);
    // 但有少数版本也用 output.results[0].video_url / .url,做一下兜底
    const videoUrl =
      json.output?.video_url ||
      json.output?.results?.[0]?.video_url ||
      json.output?.results?.[0]?.url ||
      null;
    return { ok: true, status, videoUrl, raw: json };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "poll timeout (30s)"
          : e.message
        : "fetch failed";
    return { ok: false, error: `[dashscope-video] poll network: ${msg}` };
  }
}

// ====================================================================
// 统一 submit / poll(根据 model id 派发)
// ====================================================================

// ====================================================================
// 即梦 (Volcengine Visual Service) —— Sigv4 签名 + submit/poll
//
//  签名算法跟 AWS Sigv4 同源(火山引擎自家版本),Header 鉴权:
//    1) Canonical Request:
//         METHOD\nURI\nQUERY\nCANONICAL_HEADERS\nSIGNED_HEADERS\nHEX(SHA256(BODY))
//    2) String to Sign:
//         HMAC-SHA256\nX-DATE\nCREDENTIAL_SCOPE\nHEX(SHA256(canonical_request))
//    3) Signing Key:
//         HMAC(HMAC(HMAC(HMAC(SK, date), region), service), "request")
//    4) Header:
//         Authorization: HMAC-SHA256 Credential=AK/SCOPE, SignedHeaders=..., Signature=HEX
// ====================================================================

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}
function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function volcSign(opts: {
  ak: string;
  sk: string;
  method: "GET" | "POST";
  host: string;
  path: string; // 始终 '/'
  query: string; // 已经按 RFC3986 编码 & 字典排序的 query string,不带前导 '?'
  body: string; // 原始请求体(JSON 字符串)
  region: string;
  service: string;
}): Record<string, string> {
  const now = new Date();
  // X-Date: 20240720T103939Z
  const pad = (n: number) => String(n).padStart(2, "0");
  const xDate =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const shortDate = xDate.slice(0, 8);

  const bodyHash = sha256Hex(opts.body);
  const headers: Record<string, string> = {
    host: opts.host,
    "x-date": xDate,
    "x-content-sha256": bodyHash,
    "content-type": "application/json",
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((k) => `${k}:${headers[k].trim()}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    opts.method,
    opts.path,
    opts.query,
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join("\n");

  const credentialScope = `${shortDate}/${opts.region}/${opts.service}/request`;
  const stringToSign = ["HMAC-SHA256", xDate, credentialScope, sha256Hex(canonicalRequest)].join(
    "\n",
  );

  const kDate = hmac(opts.sk, shortDate);
  const kRegion = hmac(kDate, opts.region);
  const kService = hmac(kRegion, opts.service);
  const kSigning = hmac(kService, "request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const authorization =
    `HMAC-SHA256 Credential=${opts.ak}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    Host: opts.host,
    "X-Date": xDate,
    "X-Content-Sha256": bodyHash,
    "Content-Type": "application/json",
    Authorization: authorization,
  };
}

function getJimengConfig() {
  return {
    ak: process.env.JIMENG_ACCESS_KEY || process.env.VOLC_ACCESSKEY,
    sk: process.env.JIMENG_SECRET_KEY || process.env.VOLC_SECRETKEY,
  };
}

/** frames = 24 * 秒数 + 1,且仅取 [121, 241](即 5s / 10s) */
function jimengFramesFromDuration(duration?: number): number {
  if (!duration) return 121;
  return duration >= 8 ? 241 : 121;
}

async function jimengCall(opts: {
  ak: string;
  sk: string;
  action: "CVSync2AsyncSubmitTask" | "CVSync2AsyncGetResult";
  body: Record<string, unknown>;
}): Promise<{ ok: true; json: any } | { ok: false; error: string }> {
  // Query 必须按字典序、RFC3986 编码,且不带前导 '?'
  // Action & Version 都不含特殊字符,直接拼即可
  const query = `Action=${opts.action}&Version=${JIMENG_VERSION}`;
  const bodyStr = JSON.stringify(opts.body);
  const headers = volcSign({
    ak: opts.ak,
    sk: opts.sk,
    method: "POST",
    host: JIMENG_HOST,
    path: "/",
    query,
    body: bodyStr,
    region: JIMENG_REGION,
    service: JIMENG_SERVICE,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`https://${JIMENG_HOST}/?${query}`, {
      method: "POST",
      headers,
      body: bodyStr,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await res.text().catch(() => "");
    let json: any = {};
    try {
      json = JSON.parse(text);
    } catch {}
    if (!res.ok && (json?.code ?? 0) !== 10000) {
      return {
        ok: false,
        error: `[jimeng] ${opts.action} HTTP ${res.status}: ${text.slice(0, 300)}`,
      };
    }
    return { ok: true, json };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? `${opts.action} timeout (30s)`
          : e.message
        : "fetch failed";
    return { ok: false, error: `[jimeng] network: ${msg}` };
  }
}

async function jimengSubmit(input: {
  ak: string;
  sk: string;
  prompt: string;
  firstFrameImageUrl?: string;
  aspectRatio?: string;
  duration?: number;
  seed?: number;
}): Promise<{ ok: true; taskId: string } | { ok: false; error: string }> {
  const body: Record<string, unknown> = {
    req_key: JIMENG_REQ_KEY,
    prompt: input.prompt,
    frames: jimengFramesFromDuration(input.duration),
    aspect_ratio:
      input.aspectRatio && input.aspectRatio !== "adaptive" ? input.aspectRatio : "16:9",
    seed: typeof input.seed === "number" ? input.seed : -1,
  };
  if (input.firstFrameImageUrl) body.image_urls = [input.firstFrameImageUrl];

  const r = await jimengCall({
    ak: input.ak,
    sk: input.sk,
    action: "CVSync2AsyncSubmitTask",
    body,
  });
  if (!r.ok) return r;
  const code = r.json?.code;
  const taskId = r.json?.data?.task_id;
  if (code !== 10000 || !taskId) {
    return {
      ok: false,
      error: `[jimeng] submit code=${code} msg=${r.json?.message || "no task_id"}`,
    };
  }
  return { ok: true, taskId };
}

async function jimengPoll(input: {
  ak: string;
  sk: string;
  taskId: string;
}): Promise<
  | { ok: true; status: SeedanceProgress; videoUrl: string | null; raw: any }
  | { ok: false; error: string; status?: SeedanceProgress; raw?: any }
> {
  const r = await jimengCall({
    ak: input.ak,
    sk: input.sk,
    action: "CVSync2AsyncGetResult",
    body: { req_key: JIMENG_REQ_KEY, task_id: input.taskId },
  });
  if (!r.ok) return { ok: false, error: r.error };
  const code = r.json?.code;
  const data = r.json?.data || {};
  // code != 10000 表示业务错误(审核 / 限流 / 内部错误等)
  if (code !== 10000) {
    return {
      ok: false,
      error: `[jimeng] poll code=${code} msg=${r.json?.message || "unknown"}`,
      status: "failed",
      raw: r.json,
    };
  }
  // status: in_queue / generating / done / not_found / expired
  const raw = (data.status || "").toLowerCase();
  let status: SeedanceProgress = "queued";
  if (raw === "in_queue") status = "queued";
  else if (raw === "generating") status = "running";
  else if (raw === "done") status = data.video_url ? "succeeded" : "failed";
  else if (raw === "not_found" || raw === "expired") status = "failed";
  return { ok: true, status, videoUrl: data.video_url || null, raw: r.json };
}

// ====================================================================
// Kuaizi (丽帧) 端实现 —— 筷子科技中转火山方舟 Seedance
//
//  鉴权:Header `ApiKey: <KUAIZI_API_KEY>`(注意是 ApiKey 不是 Authorization)
//  Base URL: https://aiopenapi.kuaizi.cn
//
//  提交:POST /ai-open-platform-api/v1/lz/video/task/create
//       成功响应(HTTP 200):{ code: 0, data: { task_id }, trace_id }
//       业务错误(HTTP 200 + code != 0):{ code, message, data: {} }
//       系统错误(HTTP 非 200):{ code, message, ... }
//       余额不足:HTTP 429,message 含 40001
//
//  查询:POST /ai-open-platform-api/v1/lz/video/task/status  (注意是 POST)
//       Body: { task_id }
//       返回 data.status: pending / submitted / running / succeeded / failed
//       成功时 data.video_url 返回成片
//
//  Model id 约定:`kuaizi-lizhen-{mode}`,mode ∈ {pro, fast, mini}
// ====================================================================

function getKuaiziConfig() {
  return {
    apiKey: process.env.KUAIZI_API_KEY,
    baseUrl: (process.env.KUAIZI_BASE_URL || KUAIZI_DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

/** 从 model id 提取丽帧 mode: pro / fast / mini */
function kuaiziModelToMode(modelId: string): "fast" | "pro" | "mini" {
  const m = modelId.toLowerCase();
  if (m.endsWith("-pro")) return "pro";
  if (m.endsWith("-mini")) return "mini";
  return "fast";
}

/** 项目内部 resolution('480P'/'720P'/'1080P' 大写)→ 筷子小写格式 */
function toKuaiziResolution(r: string | undefined): "480p" | "720p" | "1080p" | "4k" {
  const s = (r || "720P").trim().toLowerCase();
  if (s === "480p") return "480p";
  if (s === "1080p") return "1080p";
  if (s === "4k") return "4k";
  return "720p";
}

/** 把筷子 status 字符串映射到项目内 SeedanceProgress */
function kuaiziStatusToProgress(s: string | undefined): SeedanceProgress {
  const v = (s || "").toLowerCase();
  if (v === "succeeded") return "succeeded";
  if (v === "failed") return "failed";
  if (v === "cancelled") return "cancelled";
  if (v === "running") return "running";
  // pending / submitted / 未知 都按 queued 处理
  return "queued";
}

async function kuaiziSubmit(input: {
  model: string;
  prompt: string;
  media: DashScopeMediaItem[];
  ratio?: SeedanceRatio;
  resolution?: string;
  duration?: number;
  generateAudio?: boolean;
  watermark?: boolean;
  referenceVideoUrl?: string;
  referenceAudioUrl?: string;
  apiKey: string;
  baseUrl: string;
}): Promise<{ ok: true; taskId: string; model: string } | { ok: false; error: string }> {
  const mode = kuaiziModelToMode(input.model);
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    mode,
    resolution: toKuaiziResolution(input.resolution),
  };
  if (input.ratio) body.ratio = input.ratio;
  if (typeof input.duration === "number") body.duration = input.duration;
  if (typeof input.generateAudio === "boolean") body.generate_audio = input.generateAudio;
  if (typeof input.watermark === "boolean") body.watermark = input.watermark;

  // 素材:first_frame / last_frame / reference_image 都映射到 images 数组
  const images: Array<{ url: string; role: string }> = [];
  for (const m of input.media) {
    images.push({ url: m.url, role: m.type }); // 'first_frame' / 'last_frame' / 'reference_image'
  }
  if (images.length > 0) body.images = images.slice(0, 9);
  if (input.referenceVideoUrl)
    body.videos = [{ url: input.referenceVideoUrl, role: "reference_video" }];
  if (input.referenceAudioUrl)
    body.audios = [{ url: input.referenceAudioUrl, role: "reference_audio" }];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${input.baseUrl}${KUAIZI_CREATE_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ApiKey: input.apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await res.text().catch(() => "");
    // 余额不足:HTTP 429
    if (res.status === 429) {
      return { ok: false, error: `[kuaizi] 余额不足 (429): ${text.slice(0, 200)}` };
    }
    if (!res.ok) {
      // 诊断:把请求体各字段大小同时打到服务端日志和返回给前端的 error,定位 22001 元凶字段
      const bodyStr = JSON.stringify(body);
      const imgs = Array.isArray(body.images) ? (body.images as Array<{ url: string }>) : [];
      const imagesUrlLen = imgs.reduce((s, img) => s + (img.url?.length || 0), 0);
      const diag =
        `bodySize=${bodyStr.length} prompt=${(body.prompt as string).length} ` +
        `images=${imgs.length} imagesUrlLen=${imagesUrlLen} ` +
        `videos=${body.videos ? 1 : 0} audios=${body.audios ? 1 : 0}`;
      console.warn(`[kuaizi] submit ${res.status} ${diag}`);
      return {
        ok: false,
        error: `[kuaizi] submit ${res.status} ${diag}: ${text.slice(0, 200)}`,
      };
    }
    let json: { code?: number; message?: string; data?: { task_id?: string } } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    if (json.code !== 0) {
      return {
        ok: false,
        error: `[kuaizi] submit code=${json.code}: ${json.message || text.slice(0, 200)}`,
      };
    }
    const taskId = json.data?.task_id;
    if (!taskId) {
      return { ok: false, error: `[kuaizi] no task_id: ${text.slice(0, 200)}` };
    }
    return { ok: true, taskId, model: input.model };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "submit timeout (30s)"
          : e.message
        : "fetch failed";
    return { ok: false, error: `[kuaizi] network: ${msg}` };
  }
}

async function kuaiziPoll(input: {
  taskId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<
  | { ok: true; status: SeedanceProgress; videoUrl: string | null; raw: any }
  | { ok: false; error: string; status?: SeedanceProgress; raw?: any }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${input.baseUrl}${KUAIZI_STATUS_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ApiKey: input.apiKey,
      },
      body: JSON.stringify({ task_id: input.taskId }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await res.text().catch(() => "");
    if (!res.ok) return { ok: false, error: `[kuaizi] poll ${res.status}: ${text.slice(0, 300)}` };
    let json: {
      code?: number;
      message?: string;
      data?: { status?: string; video_url?: string; error?: string };
    } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    if (json.code !== 0) {
      // code!==0 是业务错误(task_id 缺失/不存在等,不可恢复),带 status:failed
      // 让 generateVideo 直接终止,不当网络抖动重试到 deadline
      return {
        ok: false,
        status: "failed",
        error: `[kuaizi] poll code=${json.code}: ${json.message || text.slice(0, 200)}`,
      };
    }
    const data = json.data || {};
    const status = kuaiziStatusToProgress(data.status);
    const videoUrl = data.video_url || null;
    // 失败时把筷子返回的 error 字段塞进 raw,让上层 generateVideo 能取出来
    return { ok: true, status, videoUrl, raw: { error: { message: data.error || "" }, ...data } };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "poll timeout (30s)"
          : e.message
        : "fetch failed";
    return { ok: false, error: `[kuaizi] poll network: ${msg}` };
  }
}

// ====================================================================
// ToAPIs 端实现 —— 中转火山方舟 Seedance 2 系列
//
//  鉴权:Header `Authorization: Bearer <TOAPIS_API_KEY>`
//  Base URL: https://toapis.com
//
//  提交:POST /v1/videos/generations
//       返回:{ id, object: "generation.task", model, status, progress, created_at }
//
//  查询:GET /v1/videos/generations/{task_id}
//       返回:{ id, status, progress, result: { type: "video", data: [{ url, format }] }, error: { code, message } }
//       status: queued / in_progress / completed / failed
//       成功时 result.data[0].url 返回成片(24 小时有效)
//
//  Model id 约定:`toapis-seedance-2` / `toapis-seedance-2-fast` / `toapis-seedance-2-mini`
//  对应上游 model:seedance-2 / seedance-2-fast / seedance-2-mini
// ====================================================================

function getToapisConfig() {
  return {
    apiKey: process.env.TOAPIS_API_KEY,
    baseUrl: (process.env.TOAPIS_BASE_URL || TOAPIS_DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

/** 从 model id 剥离 `toapis-` 前缀,得到上游 model 名 */
function toapisModelToUpstream(modelId: string): string {
  return modelId.replace(/^toapis-/i, "");
}

/** 项目内部 resolution('480P'/'720P'/'1080P' 大写)→ ToAPIs 小写格式 */
function toToapisResolution(r: string | undefined): "480p" | "720p" | "1080p" | "4k" {
  const s = (r || "720P").trim().toLowerCase();
  if (s === "480p") return "480p";
  if (s === "1080p") return "1080p";
  if (s === "4k") return "4k";
  return "720p";
}

/** 把 ToAPIs status 字符串映射到项目内 SeedanceProgress */
function toapisStatusToProgress(s: string | undefined): SeedanceProgress {
  const v = (s || "").toLowerCase();
  if (v === "completed") return "succeeded";
  if (v === "failed") return "failed";
  if (v === "cancelled") return "cancelled";
  if (v === "in_progress") return "running";
  // queued / 未知 都按 queued 处理
  return "queued";
}

async function toapisSubmit(input: {
  model: string;
  prompt: string;
  media: DashScopeMediaItem[];
  ratio?: SeedanceRatio;
  resolution?: string;
  duration?: number;
  generateAudio?: boolean;
  watermark?: boolean;
  referenceVideoUrl?: string;
  referenceAudioUrl?: string;
  apiKey: string;
  baseUrl: string;
}): Promise<{ ok: true; taskId: string; model: string } | { ok: false; error: string }> {
  const upstreamModel = toapisModelToUpstream(input.model);
  const body: Record<string, unknown> = {
    model: upstreamModel,
    prompt: input.prompt,
  };
  if (input.ratio) body.aspect_ratio = input.ratio;
  if (typeof input.duration === "number") body.duration = input.duration;
  if (input.resolution) body.resolution = toToapisResolution(input.resolution);
  if (typeof input.generateAudio === "boolean") body.generate_audio = input.generateAudio;

  // 素材:image_with_roles
  // ⚠️ toapis 三种模式互斥,不能混用:
  //    1) 首帧模式: first_frame (1张)
  //    2) 首尾帧模式: first_frame (1张) + last_frame (1张)
  //    3) 多模态参考模式: reference_image (≤9张)
  // 前端已按规则分好 mode,这里做安全守卫:有 reference_image 时只发 reference_image
  const hasReferenceImage = input.media.some((m) => m.type === "reference_image");
  const imageWithRoles: Array<{ url: string; role: string }> = [];
  for (const m of input.media) {
    if (hasReferenceImage && m.type !== "reference_image") continue; // 参考模式下跳过 frame
    imageWithRoles.push({ url: m.url, role: m.type }); // 'first_frame' / 'last_frame' / 'reference_image'
  }
  if (imageWithRoles.length > 0) body.image_with_roles = imageWithRoles;
  if (input.referenceVideoUrl)
    body.video_with_roles = [{ url: input.referenceVideoUrl, role: "reference_video" }];
  if (input.referenceAudioUrl)
    body.audio_with_roles = [{ url: input.referenceAudioUrl, role: "reference_audio" }];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${input.baseUrl}${TOAPIS_CREATE_PATH}`, {
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
      return { ok: false, error: `[toapis] submit ${res.status}: ${text.slice(0, 300)}` };
    }
    let json: { id?: string; status?: string; error?: { code?: string; message?: string } } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    const taskId = json.id;
    if (!taskId) {
      return {
        ok: false,
        error: `[toapis] no task id: ${json.error?.message || text.slice(0, 200)}`,
      };
    }
    return { ok: true, taskId, model: input.model };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "submit timeout (30s)"
          : e.message
        : "fetch failed";
    return { ok: false, error: `[toapis] network: ${msg}` };
  }
}

async function toapisPoll(input: {
  taskId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<
  | { ok: true; status: SeedanceProgress; videoUrl: string | null; raw: any }
  | { ok: false; error: string; status?: SeedanceProgress; raw?: any }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(
      `${input.baseUrl}${TOAPIS_CREATE_PATH}/${encodeURIComponent(input.taskId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
        },
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);
    const text = await res.text().catch(() => "");
    if (!res.ok) return { ok: false, error: `[toapis] poll ${res.status}: ${text.slice(0, 300)}` };
    let json: {
      id?: string;
      status?: string;
      progress?: number;
      result?: { type?: string; data?: Array<{ url?: string; format?: string }> };
      error?: { code?: string; message?: string };
    } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    const status = toapisStatusToProgress(json.status);
    const videoUrl = json.result?.data?.[0]?.url || null;
    return {
      ok: true,
      status,
      videoUrl,
      raw: { error: { message: json.error?.message || "" }, ...json },
    };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "poll timeout (30s)"
          : e.message
        : "fetch failed";
    return { ok: false, error: `[toapis] poll network: ${msg}` };
  }
}

// ====================================================================
// k99.tw 端实现 —— Sora 风格 API,中转视频生成
//
//  2026/06 修正:之前假设 k99 跟 ToAPIs 一样用 newapi 路径 /v1/videos/generations,
//  实测返回 404 Invalid URL。k99.tw 实际用 OpenAI Sora 风格路径:
//   - 提交:POST /v1/videos           → { id, task_id, status: "processing", ... }
//   - 查询:GET  /v1/videos/{task_id} → { id, status, url?, ... }
//
//  模型名也不是 "SD2.0",而是 video-fast-480p / video-pro-1080p 等。
//  不再复用 toapisSubmit/toapisPoll,改为独立实现。
// ====================================================================

function getK99Config() {
  return {
    apiKey: process.env.K99_API_KEY,
    baseUrl: (process.env.K99_BASE_URL || K99_DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

/** 项目 model id → k99 上游 model 名 */
function k99ModelToUpstream(modelId: string): string {
  const map: Record<string, string> = {
    "k99-fast-480p": "video-fast-480p",
    "k99-pro-1080p": "video-pro-1080p",
  };
  return map[modelId] || modelId.replace(/^k99-/i, "video-");
}

/** k99 status 字符串 → 项目内 SeedanceProgress */
function k99StatusToProgress(s: string | undefined): SeedanceProgress {
  const v = (s || "").toLowerCase();
  if (v === "completed" || v === "succeeded") return "succeeded";
  if (v === "failed") return "failed";
  if (v === "cancelled" || v === "canceled") return "cancelled";
  if (v === "processing" || v === "in_progress") return "running";
  return "queued"; // 未知 / queued
}

async function k99Submit(input: {
  model: string;
  prompt: string;
  media: DashScopeMediaItem[];
  ratio?: SeedanceRatio;
  duration?: number;
  apiKey: string;
  baseUrl: string;
}): Promise<{ ok: true; taskId: string; model: string } | { ok: false; error: string }> {
  const upstreamModel = k99ModelToUpstream(input.model);
  const body: Record<string, unknown> = {
    model: upstreamModel,
    prompt: input.prompt,
  };
  // 首帧图(Sora 风格用 image 字段)
  const firstFrame = input.media.find((m) => m.type === "first_frame")?.url;
  if (firstFrame) body.image = firstFrame;
  if (input.ratio) body.size = input.ratio;
  if (typeof input.duration === "number") body.duration = input.duration;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${input.baseUrl}${K99_CREATE_PATH}`, {
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
    if (!res.ok) return { ok: false, error: `[k99] submit ${res.status}: ${text.slice(0, 300)}` };
    let json: { id?: string; task_id?: string; error?: { message?: string } } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    const taskId = json.id || json.task_id;
    if (!taskId)
      return { ok: false, error: `[k99] no task id: ${json.error?.message || text.slice(0, 200)}` };
    return { ok: true, taskId, model: input.model };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "submit timeout (30s)"
          : e.message
        : "fetch failed";
    return { ok: false, error: `[k99] network: ${msg}` };
  }
}

async function k99Poll(input: {
  taskId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<
  | { ok: true; status: SeedanceProgress; videoUrl: string | null; raw: any }
  | { ok: false; error: string; status?: SeedanceProgress; raw?: any }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(
      `${input.baseUrl}${K99_STATUS_PATH}/${encodeURIComponent(input.taskId)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${input.apiKey}` },
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);
    const text = await res.text().catch(() => "");
    if (!res.ok) return { ok: false, error: `[k99] poll ${res.status}: ${text.slice(0, 300)}` };
    let json: {
      id?: string;
      status?: string;
      url?: string;
      video_url?: string;
      video?: { url?: string };
      output?: { url?: string };
      error?: { message?: string };
    } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    const status = k99StatusToProgress(json.status);
    // 视频 URL 多字段 fallback(Sora 风格主字段是 url)
    const videoUrl = json.url || json.video_url || json.video?.url || json.output?.url || null;
    return {
      ok: true,
      status,
      videoUrl,
      raw: { error: { message: json.error?.message || "" }, ...json },
    };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "poll timeout (30s)"
          : e.message
        : "fetch failed";
    return { ok: false, error: `[k99] poll network: ${msg}` };
  }
}

// ====================================================================
// 汇流 Confluo 端实现 —— OpenAI 兼容聚合网关,中转 doubao-seedance
//
//  统一调用地址 https://models.iystd.com/v1,所有模型共用同一密钥,
//  靠请求里的 model 字段区分。视频端点(实测 2026/07):
//   - 提交:POST /v1/videos        → 返回 { id | task_id | data:{id} }
//   - 查询:GET  /v1/videos/{id}   → 返回 { status, url | video_url | ... }
//  错误格式:{ code, message, data }
//
//  Model id 约定:`confluo-doubao-seedance-*`,剥离 `confluo-` 前缀后
//  upstream model = doubao-seedance-2-0-*(汇流模型名)。
// ====================================================================

const CONFLUO_DEFAULT_BASE_URL = "https://models.iystd.com";

function getConfluoVideoConfig() {
  return {
    apiKey: process.env.CONFLUO_API_KEY,
    baseUrl: (process.env.CONFLUO_BASE_URL || CONFLUO_DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

/** 从 model id 剥离 `confluo-` 前缀,得到上游 model 名 */
function confluoModelToUpstream(modelId: string): string {
  return modelId.replace(/^confluo-/i, "");
}

/** 汇流 status 字符串 → 项目内 SeedanceProgress */
function confluoStatusToProgress(s: string | undefined): SeedanceProgress {
  const v = (s || "").toLowerCase();
  if (v === "completed" || v === "succeeded" || v === "success") return "succeeded";
  if (v === "failed" || v === "error") return "failed";
  if (v === "cancelled" || v === "canceled") return "cancelled";
  if (v === "processing" || v === "in_progress" || v === "running") return "running";
  return "queued"; // 未知 / queued / pending
}

async function confluoSubmit(input: {
  model: string;
  prompt: string;
  media: DashScopeMediaItem[];
  ratio?: SeedanceRatio;
  duration?: number;
  apiKey: string;
  baseUrl: string;
}): Promise<{ ok: true; taskId: string; model: string } | { ok: false; error: string }> {
  const upstreamModel = confluoModelToUpstream(input.model);
  const body: Record<string, unknown> = {
    model: upstreamModel,
    prompt: input.prompt,
  };
  // 首帧图(Sora 风格用 image 字段)
  const firstFrame = input.media.find((m) => m.type === "first_frame")?.url;
  if (firstFrame) body.image = firstFrame;
  if (input.ratio) body.size = input.ratio;
  if (typeof input.duration === "number") body.duration = input.duration;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${input.baseUrl}/v1/videos`, {
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
    if (!res.ok)
      return { ok: false, error: `[confluo] submit ${res.status}: ${text.slice(0, 300)}` };
    let json: {
      id?: string;
      task_id?: string;
      data?: { id?: string; task_id?: string };
      error?: { message?: string };
      message?: string;
    } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    // 汇流可能用多种字段返回 task id:id / task_id / data.id / data.task_id
    const taskId = json.id || json.task_id || json.data?.id || json.data?.task_id;
    if (!taskId) {
      const errMsg = json.error?.message || json.message || text.slice(0, 200);
      return { ok: false, error: `[confluo] no task id: ${errMsg}` };
    }
    return { ok: true, taskId, model: input.model };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "submit timeout (30s)"
          : e.message
        : "fetch failed";
    return { ok: false, error: `[confluo] network: ${msg}` };
  }
}

async function confluoPoll(input: {
  taskId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<
  | { ok: true; status: SeedanceProgress; videoUrl: string | null; raw: any }
  | { ok: false; error: string; status?: SeedanceProgress; raw?: any }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${input.baseUrl}/v1/videos/${encodeURIComponent(input.taskId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await res.text().catch(() => "");
    if (!res.ok) return { ok: false, error: `[confluo] poll ${res.status}: ${text.slice(0, 300)}` };
    let json: any = {};
    try {
      json = JSON.parse(text);
    } catch {}
    const status = confluoStatusToProgress(json.status || json.data?.status);
    // 视频 URL 多字段 fallback(Sora 风格主字段 url;汇流也可能用 video_url /
    // content.video_url / result.data[0].url / data.url)
    const videoUrl =
      json.url ||
      json.video_url ||
      json.video?.url ||
      json.output?.url ||
      json.content?.video_url ||
      json.result?.data?.[0]?.url ||
      json.data?.url ||
      json.data?.video_url ||
      null;
    return {
      ok: true,
      status,
      videoUrl,
      raw: { error: { message: json.error?.message || json.message || "" }, ...json },
    };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "poll timeout (30s)"
          : e.message
        : "fetch failed";
    return { ok: false, error: `[confluo] poll network: ${msg}` };
  }
}

// ====================================================================
// TopenRouter 端实现 -- 中转火山方舟 doubao-seedance
//
//  统一调用地址 https://tp-api.chinadatapay.com:8000,OpenAI 兼容网关。
//  视频端点(文档 2026/07):
//   - 提交:POST /v1/video/tasks           -> 返回 { id }
//   - 查询:GET  /v1/video/tasks/{id}      -> 返回 { id, status, content:{video_url}, error }
//  content 结构与 ARK 原生一致(text/image_url/video_url/audio_url + role),
//  resolution 小写,状态比 ARK 多一个 expired(已映射 failed)。
//
//  Model id 约定:`topenrouter-doubao-seedance-*`,剥离 `topenrouter-` 前缀后
//  upstream model = doubao-seedance-2-0-*(用户指定带版本后缀的模型名)。
// ====================================================================

const TOPENROUTER_DEFAULT_BASE_URL = "https://tp-api.chinadatapay.com:8000";

function getTopenrouterConfig() {
  return {
    apiKey: process.env.TOPENROUTER_API_KEY,
    baseUrl: (process.env.TOPENROUTER_BASE_URL || TOPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

/** 从 model id 剥离 `topenrouter-` 前缀,得到上游 model 名 */
function topenrouterModelToUpstream(modelId: string): string {
  return modelId.replace(/^topenrouter-/i, "");
}

// ---------- 弘梦 (Hongmeng) 配置 ----------
// 弘梦中转 Seedance 2 系列(fast/mini/pro),接口为火山方舟 ARK 原生格式透传:
//   - 提交:POST {BASE}/contents/generations/tasks  -> { id }
//   - 查询:GET  {BASE}/contents/generations/tasks/{id}
//        -> { id, model, status, content:{video_url}, usage, created_at, updated_at }
//   - status: queued / running / succeeded / failed / cancelled(与 ARK 一致,
//     复用 arkSubmit / arkPoll + seedanceStatusToProgress,参照 shuci 接法)
//   - model: seedance2-fast / seedance2-mini / seedance2-pro(剥离 hongmeng- 前缀)
// 实测:文档写的 BASE_URL https://ai.kunagent.com 返回 404 "Cannot POST ..."(那是文档站);
// 真实 API 主机是 https://api.kunagent.com(用户给的网址),路径不变,仍带 /api/v3 前缀。
const HONGMENG_DEFAULT_BASE_URL = "https://api.kunagent.com/api/v3";

/**
 * 弘梦客服提供的是完整提交地址；环境变量则约定填写 API 根地址。
 * 两种写法都兼容，避免把完整 tasks 地址再次拼上 `/contents/generations/tasks`。
 */
function normalizeHongmengBaseUrl(value: string | undefined): string {
  const raw = (value || HONGMENG_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  return raw.replace(/\/contents\/generations\/tasks(?:\/[^/?#]+)?$/i, "");
}

function getHongmengConfig() {
  return {
    apiKey: process.env.HONGMENG_API_KEY,
    baseUrl: normalizeHongmengBaseUrl(process.env.HONGMENG_BASE_URL),
  };
}

/** 从 model id 剥离 `hongmeng-` 前缀,得到上游 model 名(seedance2-fast 等) */
function hongmengModelToUpstream(modelId: string): string {
  return modelId.replace(/^hongmeng-/i, "");
}

async function topenrouterSubmit(input: {
  model: string;
  content: ContentItem[];
  ratio?: SeedanceRatio;
  resolution?: string;
  duration?: number;
  generateAudio?: boolean;
  watermark?: boolean;
  apiKey: string;
  baseUrl: string;
}): Promise<{ ok: true; taskId: string; model: string } | { ok: false; error: string }> {
  const upstreamModel = topenrouterModelToUpstream(input.model);
  const body: Record<string, unknown> = {
    model: upstreamModel,
    content: input.content,
  };
  if (input.ratio) body.ratio = input.ratio;
  if (input.resolution) body.resolution = toArkResolution(input.resolution);
  if (typeof input.duration === "number") body.duration = input.duration;
  if (typeof input.generateAudio === "boolean") body.generate_audio = input.generateAudio;
  if (typeof input.watermark === "boolean") body.watermark = input.watermark;
  // 任务过期时间(秒),文档示例用 3600;视频生成通常数分钟,留足余量
  body.execution_expires_after = 3600;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${input.baseUrl}/v1/video/tasks`, {
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
    if (!res.ok)
      return { ok: false, error: `[topenrouter] submit ${res.status}: ${text.slice(0, 300)}` };
    // 复用 arkSubmit 同款 bugfix:JSON.parse(text) 而非 res.json()(body 流已消费)
    let json: { id?: string; error?: { code?: string; message?: string }; message?: string } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    if (!json.id) {
      return {
        ok: false,
        error: `[topenrouter] no task id: ${json.error?.message || json.message || text.slice(0, 200)}`,
      };
    }
    return { ok: true, taskId: json.id, model: input.model };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "submit timeout (30s)"
          : e.message
        : "fetch failed";
    return { ok: false, error: `[topenrouter] network: ${msg}` };
  }
}

async function topenrouterPoll(input: {
  taskId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<
  | { ok: true; status: SeedanceProgress; videoUrl: string | null; raw: any }
  | { ok: false; error: string; status?: SeedanceProgress; raw?: any }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${input.baseUrl}/v1/video/tasks/${encodeURIComponent(input.taskId)}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await res.text().catch(() => "");
    if (!res.ok)
      return { ok: false, error: `[topenrouter] poll ${res.status}: ${text.slice(0, 300)}` };
    let json: {
      id?: string;
      status?: string;
      content?: { video_url?: string };
      error?: { code?: string; message?: string };
    } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    const status = seedanceStatusToProgress(json.status);
    const videoUrl = json.content?.video_url || null;
    // 失败时把 error.message 塞进 raw,让上层 generateVideo 能取出错误文案
    return {
      ok: true,
      status,
      videoUrl,
      raw: { error: { message: json.error?.message || "" }, ...json },
    };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "poll timeout (30s)"
          : e.message
        : "fetch failed";
    return { ok: false, error: `[topenrouter] poll network: ${msg}` };
  }
}

type SubmitInput = {
  model: string;
  prompt: string;
  media: DashScopeMediaItem[]; // 同时给 ARK 和 DashScope 用
  ratio?: SeedanceRatio;
  resolution?: string;
  duration?: number;
  generateAudio?: boolean;
  watermark?: boolean;
  // 新增:ARK Seedance 完整参考素材(2026/06)
  referenceVideoUrl?: string;
  referenceAudioUrl?: string;
};

type VideoBackend =
  | "ark"
  | "dashscope"
  | "jimeng"
  | "kuaizi"
  | "toapis"
  | "k99"
  | "vapeur"
  | "shuci"
  | "kling"
  | "confluo"
  | "topenrouter"
  | "hongmeng"
  | "sdreal";

// ====================================================================
// vapeur.ai 端实现 —— 透传火山方舟 ARK Seedance 原生格式
//
//  2026/07 修正:此前推测为 newapi 风格(ToAPIs),实测返回 500。
//  查看 vapeur 文档后发现实际是 ARK 原生格式透传:
//   - 提交:POST /doubao/v1/videos/generations/submit
//   - 查询:GET  /doubao/v1/videos/generations/{taskId}
//   - 请求体:{ model, prompt, content, duration, image_url, ratio, resolution, watermark }
//   - 返回结构:ARK 原生 { id, status, content: { video_url } }
// ====================================================================

function getVapeurConfig() {
  return {
    apiKey: process.env.VAPEUR_API_KEY,
    baseUrl: (process.env.VAPEUR_BASE_URL || VAPEUR_DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

/** 从 model id 剥离 `vapeur-` 前缀,得到上游 model 名 */
function vapeurModelToUpstream(modelId: string): string {
  return modelId.replace(/^vapeur-/i, "");
}

async function vapeurSubmit(input: {
  model: string;
  prompt: string;
  content: ContentItem[];
  imageUrl?: string;
  ratio?: SeedanceRatio;
  resolution?: string;
  duration?: number;
  watermark?: boolean;
  apiKey: string;
  baseUrl: string;
}): Promise<{ ok: true; taskId: string; model: string } | { ok: false; error: string }> {
  const upstreamModel = vapeurModelToUpstream(input.model);
  const body: Record<string, unknown> = {
    model: upstreamModel,
    prompt: input.prompt,
    content: input.content,
  };
  if (input.imageUrl) body.image_url = input.imageUrl;
  if (input.ratio) body.ratio = input.ratio;
  if (typeof input.duration === "number") body.duration = input.duration;
  if (input.resolution) body.resolution = input.resolution;
  if (typeof input.watermark === "boolean") body.watermark = input.watermark;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${input.baseUrl}/doubao/v1/videos/generations/submit`, {
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
    if (!res.ok)
      return { ok: false, error: `[vapeur] submit ${res.status}: ${text.slice(0, 300)}` };
    let json: { id?: string; error?: { code?: string; message?: string } } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    if (!json.id)
      return {
        ok: false,
        error: `[vapeur] no task_id: ${json.error?.message || text.slice(0, 200)}`,
      };
    return { ok: true, taskId: json.id, model: input.model };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "submit timeout (30s)"
          : e.message
        : "fetch failed";
    return { ok: false, error: `[vapeur] network: ${msg}` };
  }
}

async function vapeurPoll(input: {
  taskId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<
  | { ok: true; status: SeedanceProgress; videoUrl: string | null; raw: any }
  | { ok: false; error: string; status?: SeedanceProgress; raw?: any }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(
      `${input.baseUrl}/doubao/v1/videos/generations/${encodeURIComponent(input.taskId)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.apiKey}`,
        },
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);
    const text = await res.text().catch(() => "");
    if (!res.ok) return { ok: false, error: `[vapeur] poll ${res.status}: ${text.slice(0, 300)}` };
    let json: {
      id?: string;
      status?: string;
      content?: { video_url?: string };
      error?: { code?: string; message?: string };
    } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    const status = seedanceStatusToProgress(json.status);
    const videoUrl = json.content?.video_url || null;
    return { ok: true, status, videoUrl, raw: json };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "poll timeout (30s)"
          : e.message
        : "fetch failed";
    return { ok: false, error: `[vapeur] poll network: ${msg}` };
  }
}

// ====================================================================
// SD Real Max —— Dreamina Seedance 2.0
//
// 协议：先 POST /v1/sd/assets 创建图片素材，再 POST /v1/video/generate；
// 任务查询为 GET /v1/video/tasks/{taskId}。素材接口只接受公网 URL，因此调用
// generateVideo 前的数据 URI 已由统一逻辑转存为可访问 URL。
// ====================================================================

const SDREAL_DEFAULT_BASE_URL = "https://model.service-inference.ai";

function getSdrealConfig() {
  return {
    apiKey: process.env.SD_REAL_MAX_API_KEY,
    baseUrl: (process.env.SD_REAL_MAX_BASE_URL || SDREAL_DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

async function sdrealCreateImageAsset(input: {
  url: string;
  name: string;
  apiKey: string;
  baseUrl: string;
}): Promise<{ ok: true; assetId: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${input.baseUrl}/v1/sd/assets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({ URL: input.url, Name: input.name, AssetType: "Image" }),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) return { ok: false, error: `[sdreal] asset ${res.status}: ${text.slice(0, 300)}` };
    let json: { data?: { Id?: string; base_resp?: { status_code?: number; status_msg?: string } } } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    const statusCode = json.data?.base_resp?.status_code;
    const assetId = json.data?.Id;
    if (statusCode !== 0 || !assetId) {
      return {
        ok: false,
        error: `[sdreal] asset creation failed: ${json.data?.base_resp?.status_msg || text.slice(0, 300)}`,
      };
    }
    return { ok: true, assetId };
  } catch (error) {
    return { ok: false, error: `[sdreal] asset network: ${error instanceof Error ? error.message : "fetch failed"}` };
  }
}

async function sdrealSubmit(input: {
  model: string;
  prompt: string;
  media: DashScopeMediaItem[];
  ratio?: SeedanceRatio;
  resolution?: string;
  duration?: number;
  generateAudio?: boolean;
  watermark?: boolean;
  apiKey: string;
  baseUrl: string;
}): Promise<{ ok: true; taskId: string; model: string } | { ok: false; error: string }> {
  const imageMedia = input.media.filter(
    (item) => item.type === "first_frame" || item.type === "last_frame" || item.type === "reference_image",
  );
  const assets = await Promise.all(
    imageMedia.map((item, index) =>
      sdrealCreateImageAsset({
        url: item.url,
        name: `doopoo-video-reference-${Date.now()}-${index + 1}`,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
      }),
    ),
  );
  const failedAsset = assets.find((asset) => !asset.ok);
  if (failedAsset && !failedAsset.ok) return failedAsset;

  const content: ContentItem[] = [{ type: "text", text: input.prompt }];
  for (const asset of assets) {
    if (asset.ok) {
      content.push({
        type: "image_url",
        image_url: { url: `asset://${asset.assetId}` },
        role: "reference_image",
      });
    }
  }
  const body: Record<string, unknown> = { model: input.model, content };
  if (input.ratio) body.ratio = input.ratio;
  if (input.resolution) body.resolution = toArkResolution(input.resolution);
  if (typeof input.duration === "number") body.duration = input.duration;
  if (typeof input.generateAudio === "boolean") body.generate_audio = input.generateAudio;
  if (typeof input.watermark === "boolean") body.watermark = input.watermark;

  try {
    const res = await fetch(`${input.baseUrl}/v1/video/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) return { ok: false, error: `[sdreal] submit ${res.status}: ${text.slice(0, 300)}` };
    let json: { task?: { id?: string; error?: string } } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    if (!json.task?.id) return { ok: false, error: `[sdreal] no task id: ${json.task?.error || text.slice(0, 300)}` };
    return { ok: true, taskId: json.task.id, model: input.model };
  } catch (error) {
    return { ok: false, error: `[sdreal] submit network: ${error instanceof Error ? error.message : "fetch failed"}` };
  }
}

async function sdrealPoll(input: {
  taskId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<PollResult> {
  try {
    const res = await fetch(`${input.baseUrl}/v1/video/tasks/${encodeURIComponent(input.taskId)}`, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) return { ok: false, error: `[sdreal] poll ${res.status}: ${text.slice(0, 300)}` };
    let json: { task?: { status?: string; outputs?: string[]; error?: unknown } } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    const task = json.task;
    if (!task) return { ok: false, error: `[sdreal] invalid task response: ${text.slice(0, 300)}` };
    return {
      ok: true,
      status: seedanceStatusToProgress(task.status),
      videoUrl: task.outputs?.[0] || null,
      raw: { error: { message: typeof task.error === "string" ? task.error : "" }, ...json },
    };
  } catch (error) {
    return { ok: false, error: `[sdreal] poll network: ${error instanceof Error ? error.message : "fetch failed"}` };
  }
}

type SubmitResult =
  | { ok: true; taskId: string; model: string; backend: VideoBackend }
  | { ok: false; error: string };

async function submitVideoTask(input: SubmitInput): Promise<SubmitResult> {
  const backend = getVideoBackend(input.model);
  if (backend === "sdreal") {
    const { apiKey, baseUrl } = getSdrealConfig();
    if (!apiKey) {
      return {
        ok: false,
        error: "[sdreal] 缺少 SD_REAL_MAX_API_KEY，请在 Cloudflare Secrets 或 .env.local 中配置后再试。",
      };
    }
    if (input.referenceVideoUrl || input.referenceAudioUrl) {
      return {
        ok: false,
        error: "[sdreal] 当前接口文档仅支持文本与图片参考素材，暂不支持参考视频或音频。",
      };
    }
    const r = await sdrealSubmit({
      model: input.model,
      prompt: input.prompt,
      media: input.media,
      ratio: input.ratio,
      resolution: input.resolution,
      duration: input.duration,
      generateAudio: input.generateAudio,
      watermark: input.watermark,
      apiKey,
      baseUrl,
    });
    return r.ok
      ? { ok: true, taskId: r.taskId, model: r.model, backend: "sdreal" }
      : { ok: false, error: r.error };
  }
  if (backend === "ark") {
    const { apiKey, baseUrl } = getArkConfig();
    if (!apiKey) return { ok: false, error: "ARK_API_KEY not configured" };
    // 构造 ARK content 数组 —— 按官方 cURL 示例:text + 多 reference_image + 可选 reference_video / reference_audio
    const firstFrameImageUrl = input.media.find((m) => m.type === "first_frame")?.url;
    const lastFrameImageUrl = input.media.find((m) => m.type === "last_frame")?.url;
    const referenceImageUrls = input.media
      .filter((m) => m.type === "reference_image")
      .map((m) => m.url);
    const content = buildArkContent(input.prompt, {
      firstFrameImageUrl,
      lastFrameImageUrl,
      referenceImageUrls,
      referenceVideoUrl: input.referenceVideoUrl,
      referenceAudioUrl: input.referenceAudioUrl,
    });
    const r = await arkSubmit({
      model: input.model,
      content,
      ratio: input.ratio,
      resolution: input.resolution,
      duration: input.duration,
      generateAudio: input.generateAudio,
      watermark: input.watermark,
      apiKey,
      baseUrl,
    });
    return r.ok
      ? { ok: true, taskId: r.taskId, model: r.model, backend: "ark" }
      : { ok: false, error: r.error };
  }
  if (backend === "jimeng") {
    const { ak, sk } = getJimengConfig();
    if (!ak || !sk) {
      return {
        ok: false,
        error:
          "[jimeng] 缺少 JIMENG_ACCESS_KEY / JIMENG_SECRET_KEY,请在 Project Settings → Secrets 添加后再试。",
      };
    }
    const firstFrameImageUrl =
      input.media.find((m) => m.type === "first_frame")?.url ||
      input.media.find((m) => m.type === "reference_image")?.url;
    const r = await jimengSubmit({
      ak,
      sk,
      prompt: input.prompt,
      firstFrameImageUrl,
      aspectRatio: input.ratio,
      duration: input.duration,
    });
    return r.ok
      ? { ok: true, taskId: r.taskId, model: input.model, backend: "jimeng" }
      : { ok: false, error: r.error };
  }
  if (backend === "kuaizi") {
    const { apiKey, baseUrl } = getKuaiziConfig();
    if (!apiKey) {
      return {
        ok: false,
        error: "[kuaizi] 缺少 KUAIZI_API_KEY,请在 Cloudflare Secrets 或 .env.local 中配置后再试。",
      };
    }
    const r = await kuaiziSubmit({
      model: input.model,
      prompt: input.prompt,
      media: input.media,
      ratio: input.ratio,
      resolution: input.resolution,
      duration: input.duration,
      generateAudio: input.generateAudio,
      watermark: input.watermark,
      referenceVideoUrl: input.referenceVideoUrl,
      referenceAudioUrl: input.referenceAudioUrl,
      apiKey,
      baseUrl,
    });
    return r.ok
      ? { ok: true, taskId: r.taskId, model: r.model, backend: "kuaizi" }
      : { ok: false, error: r.error };
  }
  if (backend === "toapis") {
    const { apiKey, baseUrl } = getToapisConfig();
    if (!apiKey) {
      return {
        ok: false,
        error: "[toapis] 缺少 TOAPIS_API_KEY,请在 Cloudflare Secrets 或 .env.local 中配置后再试。",
      };
    }
    const r = await toapisSubmit({
      model: input.model,
      prompt: input.prompt,
      media: input.media,
      ratio: input.ratio,
      resolution: input.resolution,
      duration: input.duration,
      generateAudio: input.generateAudio,
      watermark: input.watermark,
      referenceVideoUrl: input.referenceVideoUrl,
      referenceAudioUrl: input.referenceAudioUrl,
      apiKey,
      baseUrl,
    });
    return r.ok
      ? { ok: true, taskId: r.taskId, model: r.model, backend: "toapis" }
      : { ok: false, error: r.error };
  }
  if (backend === "k99") {
    const { apiKey, baseUrl } = getK99Config();
    if (!apiKey) {
      return {
        ok: false,
        error: "[k99] 缺少 K99_API_KEY,请在 Cloudflare Secrets 或 .env.local 中配置后再试。",
      };
    }
    const r = await k99Submit({
      model: input.model,
      prompt: input.prompt,
      media: input.media,
      ratio: input.ratio,
      duration: input.duration,
      apiKey,
      baseUrl,
    });
    return r.ok
      ? { ok: true, taskId: r.taskId, model: input.model, backend: "k99" }
      : { ok: false, error: r.error };
  }
  if (backend === "vapeur") {
    const { apiKey, baseUrl } = getVapeurConfig();
    if (!apiKey) {
      return {
        ok: false,
        error: "[vapeur] 缺少 VAPEUR_API_KEY,请在 Cloudflare Secrets 或 .env.local 中配置后再试。",
      };
    }
    // vapeur 豆包视频接口是 ARK 原生格式透传,用独立的 vapeurSubmit
    const firstFrameUrl = input.media.find((m) => m.type === "first_frame")?.url;
    const lastFrameUrl = input.media.find((m) => m.type === "last_frame")?.url;
    const referenceImageUrls = input.media
      .filter((m) => m.type === "reference_image")
      .map((m) => m.url);
    const content = buildArkContent(input.prompt, {
      firstFrameImageUrl: firstFrameUrl,
      lastFrameImageUrl: lastFrameUrl,
      referenceImageUrls,
      referenceVideoUrl: input.referenceVideoUrl,
      referenceAudioUrl: input.referenceAudioUrl,
    });
    const r = await vapeurSubmit({
      model: input.model,
      prompt: input.prompt,
      content,
      imageUrl: firstFrameUrl,
      ratio: input.ratio,
      resolution: input.resolution,
      duration: input.duration,
      watermark: input.watermark,
      apiKey,
      baseUrl,
    });
    return r.ok
      ? { ok: true, taskId: r.taskId, model: input.model, backend: "vapeur" }
      : { ok: false, error: r.error };
  }
  if (backend === "shuci") {
    const { apiKey, baseUrl } = getShuciVideoConfig();
    if (!apiKey) return { ok: false, error: "SHUANCIYUAN_VIDEO_KEY not configured" };
    const upstreamModel = SHUCIYUAN_VIDEO_MODEL_MAP[input.model] || "doubao-seedance-2-0-260128";
    const r = await shuciSubmit({
      model: upstreamModel,
      prompt: input.prompt,
      media: input.media,
      ratio: input.ratio,
      duration: input.duration,
      apiKey,
      baseUrl,
    });
    return r.ok
      ? { ok: true, taskId: r.taskId, model: input.model, backend: "shuci" }
      : { ok: false, error: r.error };
  }
  if (backend === "kling") {
    const { callKlingVideoSubmit } = await import("./klingVideo.functions");
    const firstFrameImageUrl = input.media.find((m) => m.type === "first_frame")?.url;
    const lastFrameImageUrl = input.media.find((m) => m.type === "last_frame")?.url;
    const r = await callKlingVideoSubmit({
      model: input.model,
      prompt: input.prompt,
      imageUrl: firstFrameImageUrl,
      lastFrameImageUrl,
      duration: input.duration,
      ratio: input.ratio,
      generateAudio: input.generateAudio,
    });
    return r.ok
      ? { ok: true, taskId: r.taskId, model: input.model, backend: "kling" }
      : { ok: false, error: r.error };
  }
  if (backend === "confluo") {
    const { apiKey, baseUrl } = getConfluoVideoConfig();
    if (!apiKey) {
      return {
        ok: false,
        error:
          "[confluo] 缺少 CONFLUO_API_KEY,请在 Cloudflare Secrets 或 .env.local 中配置后再试。",
      };
    }
    const r = await confluoSubmit({
      model: input.model,
      prompt: input.prompt,
      media: input.media,
      ratio: input.ratio,
      duration: input.duration,
      apiKey,
      baseUrl,
    });
    return r.ok
      ? { ok: true, taskId: r.taskId, model: input.model, backend: "confluo" }
      : { ok: false, error: r.error };
  }
  if (backend === "topenrouter") {
    const { apiKey, baseUrl } = getTopenrouterConfig();
    if (!apiKey) {
      return {
        ok: false,
        error:
          "[topenrouter] 缺少 TOPENROUTER_API_KEY,请在 Cloudflare Secrets 或 .env.local 中配置后再试。",
      };
    }
    // TopenRouter content 结构与 ARK 原生一致,复用 buildArkContent 拼装
    const firstFrameImageUrl = input.media.find((m) => m.type === "first_frame")?.url;
    const lastFrameImageUrl = input.media.find((m) => m.type === "last_frame")?.url;
    const referenceImageUrls = input.media
      .filter((m) => m.type === "reference_image")
      .map((m) => m.url);
    const content = buildArkContent(input.prompt, {
      firstFrameImageUrl,
      lastFrameImageUrl,
      referenceImageUrls,
      referenceVideoUrl: input.referenceVideoUrl,
      referenceAudioUrl: input.referenceAudioUrl,
    });
    const r = await topenrouterSubmit({
      model: input.model,
      content,
      ratio: input.ratio,
      resolution: input.resolution,
      duration: input.duration,
      generateAudio: input.generateAudio,
      watermark: input.watermark,
      apiKey,
      baseUrl,
    });
    return r.ok
      ? { ok: true, taskId: r.taskId, model: input.model, backend: "topenrouter" }
      : { ok: false, error: r.error };
  }
  if (backend === "hongmeng") {
    const { apiKey, baseUrl } = getHongmengConfig();
    if (!apiKey) {
      return {
        ok: false,
        error:
          "[hongmeng] 缺少 HONGMENG_API_KEY,请在 Cloudflare Secrets 或 .env.local 中配置后再试。",
      };
    }
    // 弘梦为 ARK 原生格式透传,复用 buildArkContent 拼装 content + arkSubmit 提交
    const firstFrameImageUrl = input.media.find((m) => m.type === "first_frame")?.url;
    const lastFrameImageUrl = input.media.find((m) => m.type === "last_frame")?.url;
    const referenceImageUrls = input.media
      .filter((m) => m.type === "reference_image")
      .map((m) => m.url);
    const content = buildArkContent(input.prompt, {
      firstFrameImageUrl,
      lastFrameImageUrl,
      referenceImageUrls,
      referenceVideoUrl: input.referenceVideoUrl,
      referenceAudioUrl: input.referenceAudioUrl,
    });
    const r = await arkSubmit({
      model: hongmengModelToUpstream(input.model),
      content,
      ratio: input.ratio,
      resolution: input.resolution,
      duration: input.duration,
      generateAudio: input.generateAudio,
      watermark: input.watermark,
      apiKey,
      baseUrl,
      label: "hongmeng",
    });
    return r.ok
      ? { ok: true, taskId: r.taskId, model: input.model, backend: "hongmeng" }
      : { ok: false, error: r.error };
  }
  // DashScope
  const { apiKey } = getDashScopeConfig();
  if (!apiKey) return { ok: false, error: "Qwen / DASHSCOPE_API_KEY not configured" };
  const r = await dashscopeSubmit({
    model: input.model,
    prompt: input.prompt,
    media: input.media,
    ratio: input.ratio,
    resolution: input.resolution,
    duration: input.duration,
    apiKey,
  });
  return r.ok
    ? { ok: true, taskId: r.taskId, model: r.model, backend: "dashscope" }
    : { ok: false, error: r.error };
}

type PollInput = { taskId: string; backend: VideoBackend };

type PollResult =
  | { ok: true; status: SeedanceProgress; videoUrl: string | null; raw: any }
  | { ok: false; error: string; status?: SeedanceProgress; raw?: any };

async function pollVideoTask(input: PollInput): Promise<PollResult> {
  if (input.backend === "sdreal") {
    const { apiKey, baseUrl } = getSdrealConfig();
    if (!apiKey) return { ok: false, error: "[sdreal] 缺少 SD_REAL_MAX_API_KEY" };
    return sdrealPoll({ taskId: input.taskId, apiKey, baseUrl });
  }
  if (input.backend === "ark") {
    const { apiKey, baseUrl } = getArkConfig();
    if (!apiKey) return { ok: false, error: "ARK_API_KEY not configured" };
    return arkPoll({ taskId: input.taskId, apiKey, baseUrl });
  }
  if (input.backend === "jimeng") {
    const { ak, sk } = getJimengConfig();
    if (!ak || !sk)
      return { ok: false, error: "[jimeng] 缺少 JIMENG_ACCESS_KEY / JIMENG_SECRET_KEY" };
    return jimengPoll({ ak, sk, taskId: input.taskId });
  }
  if (input.backend === "kuaizi") {
    const { apiKey, baseUrl } = getKuaiziConfig();
    if (!apiKey) return { ok: false, error: "[kuaizi] 缺少 KUAIZI_API_KEY" };
    return kuaiziPoll({ taskId: input.taskId, apiKey, baseUrl });
  }
  if (input.backend === "toapis") {
    const { apiKey, baseUrl } = getToapisConfig();
    if (!apiKey) return { ok: false, error: "[toapis] 缺少 TOAPIS_API_KEY" };
    return toapisPoll({ taskId: input.taskId, apiKey, baseUrl });
  }
  if (input.backend === "k99") {
    const { apiKey, baseUrl } = getK99Config();
    if (!apiKey) return { ok: false, error: "[k99] 缺少 K99_API_KEY" };
    return k99Poll({ taskId: input.taskId, apiKey, baseUrl });
  }
  if (input.backend === "vapeur") {
    const { apiKey, baseUrl } = getVapeurConfig();
    if (!apiKey) return { ok: false, error: "[vapeur] 缺少 VAPEUR_API_KEY" };
    return vapeurPoll({ taskId: input.taskId, apiKey, baseUrl });
  }
  if (input.backend === "shuci") {
    const { apiKey, baseUrl } = getShuciVideoConfig();
    if (!apiKey) return { ok: false, error: "[shuci] 缺少 SHUANCIYUAN_VIDEO_KEY" };
    return shuciPoll({ taskId: input.taskId, apiKey, baseUrl });
  }
  if (input.backend === "kling") {
    const { callKlingVideoPoll } = await import("./klingVideo.functions");
    // Kling I2V/T2V 查询端点不同,先试 image2video,404 就 fallback text2video
    const r = await callKlingVideoPoll({ taskId: input.taskId, endpoint: "image2video" });
    if (r.ok) return r as PollResult;
    return callKlingVideoPoll({
      taskId: input.taskId,
      endpoint: "text2video",
    }) as Promise<PollResult>;
  }
  if (input.backend === "confluo") {
    const { apiKey, baseUrl } = getConfluoVideoConfig();
    if (!apiKey) return { ok: false, error: "[confluo] 缺少 CONFLUO_API_KEY" };
    return confluoPoll({ taskId: input.taskId, apiKey, baseUrl });
  }
  if (input.backend === "topenrouter") {
    const { apiKey, baseUrl } = getTopenrouterConfig();
    if (!apiKey) return { ok: false, error: "[topenrouter] 缺少 TOPENROUTER_API_KEY" };
    return topenrouterPoll({ taskId: input.taskId, apiKey, baseUrl });
  }
  if (input.backend === "hongmeng") {
    const { apiKey, baseUrl } = getHongmengConfig();
    if (!apiKey) return { ok: false, error: "[hongmeng] 缺少 HONGMENG_API_KEY" };
    return arkPoll({ taskId: input.taskId, apiKey, baseUrl, label: "hongmeng" });
  }
  const { apiKey } = getDashScopeConfig();
  if (!apiKey) return { ok: false, error: "Qwen / DASHSCOPE_API_KEY not configured" };
  return dashscopePoll({ taskId: input.taskId, apiKey });
}

// ====================================================================
// 公开 server functions
// ====================================================================

// ---- 1) submitVideoTaskFn (server fn) ----

const SubmitServerInput = z.object({
  model: z.string().max(200).optional(),
  content: z.array(z.any()).min(1).max(20),
  ratio: z.enum(SUPPORTED_RATIOS).optional(),
  resolution: z.enum(["480P", "720P", "1080P"]).optional(),
  duration: z.number().int().min(1).max(60).optional(),
  generateAudio: z.boolean().optional(),
  watermark: z.boolean().optional(),
});

export const submitVideoTaskFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => SubmitServerInput.parse(d))
  .handler(async ({ data }) => {
    // 把 ARK 风格的 content 数组转成统一 media + ref 形式
    const media: DashScopeMediaItem[] = [];
    let referenceVideoUrl: string | undefined;
    let referenceAudioUrl: string | undefined;
    for (const item of data.content as any[]) {
      if (item?.type === "image_url" && item?.image_url?.url) {
        media.push({ type: "reference_image", url: item.image_url.url });
      } else if (item?.type === "video_url" && item?.video_url?.url) {
        referenceVideoUrl = item.video_url.url;
      } else if (item?.type === "audio_url" && item?.audio_url?.url) {
        referenceAudioUrl = item.audio_url.url;
      }
    }
    const prompt = (data.content as any[]).find((i) => i?.type === "text")?.text || "";
    const model = data.model || ARK_DEFAULT_MODEL;

    const r = await submitVideoTask({
      model,
      prompt,
      media,
      ratio: data.ratio,
      resolution: data.resolution,
      duration: data.duration,
      generateAudio: data.generateAudio,
      watermark: data.watermark,
      referenceVideoUrl,
      referenceAudioUrl,
    });
    if (!r.ok) return { ok: false as const, error: r.error };
    return { ok: true as const, taskId: r.taskId, model: r.model, backend: r.backend };
  });

// ---- 2) pollVideoTaskFn (server fn) ----

const PollServerInput = z.object({
  taskId: z.string().min(1).max(200),
  backend: z.enum([
    "ark",
    "dashscope",
    "jimeng",
    "kuaizi",
    "toapis",
    "k99",
    "vapeur",
    "shuci",
    "kling",
    "confluo",
    "topenrouter",
    "hongmeng",
    "sdreal",
  ]),
});

export const pollVideoTaskFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => PollServerInput.parse(d))
  .handler(async ({ data }) => {
    const r = await pollVideoTask({ taskId: data.taskId, backend: data.backend });
    if (!r.ok) return { ok: false as const, error: r.error, status: r.status };
    return { ok: true as const, status: r.status, videoUrl: r.videoUrl };
  });

// ====================================================================
// 3) generateVideo —— 高层 helper(根据 model id 自动派发到 ARK / DashScope)
//
//   把"提交 + 轮询 + 进度回调"打包成一次调用。客户端拿到的是统一返回:
//     { ok, videoUrl?, error?, taskId?, backend? }
// ====================================================================

/**
 * 把单个 data: URI 上传到 Supabase Storage `workspace-media`,返回 10 年签名 URL。
 *
 * 背景:生图函数(azure/lovable/openrouter/pixflow 等)常返回
 *   data:image/png;base64,... 形式的 URL,单条可达数 MB。前端把这些 data URI
 *   当参考图传给视频生成,会导致请求体过大(kuaizi 落库触发 22001)或被后端拒绝。
 *   在 generateVideo 入口统一转换,所有后端收到干净 https URL。
 *
 *   - data: URI → 上传 Storage → 签名 URL
 *   - http(s) URL / 已入库的 supabase URL → 原样返回(各后端本就支持)
 *   - 上传失败 → ok:false,由调用方中止流程(避免继续发大请求体)
 */
async function persistDataUriUrl(
  url: string,
  supabase: any,
  userId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!url || !url.startsWith("data:")) return { ok: true, url };
  try {
    const { buf, contentType } = await fetchMedia(url);
    const ct = (contentType || "image/png").toLowerCase();
    let ext = "png";
    if (ct.includes("jpeg") || ct.includes("jpg")) ext = "jpg";
    else if (ct.includes("webp")) ext = "webp";
    else if (ct.includes("gif")) ext = "gif";
    else if (ct.includes("mp4")) ext = "mp4";
    else if (ct.includes("webm")) ext = "webm";
    else if (ct.includes("audio/mpeg")) ext = "mp3";
    else if (ct.includes("audio/wav")) ext = "wav";
    const mime = contentType || "image/png";
    const path = `${userId}/video-gen/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    // 优先腾讯云 COS + CDN
    const { isCosConfigured, uploadToCos } = await import("./cosClient");
    if (isCosConfigured()) {
      const r = await uploadToCos(path, buf as ArrayBuffer, mime);
      if (r.ok) return { ok: true, url: r.url };
      if (!r.fallback) return { ok: false, error: `参考图上传失败: ${r.error}` };
    }
    const blob = new Blob([buf], { type: mime });
    const { error: uploadErr } = await supabase.storage
      .from("workspace-media")
      .upload(path, blob, { contentType: mime, upsert: true });
    if (uploadErr) return { ok: false, error: `参考图上传失败: ${uploadErr.message}` };
    const { data: signed } = await supabase.storage
      .from("workspace-media")
      .createSignedUrl(path, 315360000); // 10 年
    if (!signed?.signedUrl) return { ok: false, error: "参考图上传失败: 未取到签名 URL" };
    return { ok: true, url: signed.signedUrl };
  } catch (e: any) {
    return { ok: false, error: `参考图上传失败: ${e?.message ?? String(e)}` };
  }
}

/**
 * 把参考音频 URL 归一化为 ARK 云端可访问的 Supabase 公网 URL。
 *
 * - 所有来源(包括既有 Supabase URL)都重新转存，避免历史签名 URL 或私有对象
 *   被 ARK 侧下载失败。
 *
 * 预设音色的本地 URL 不能直接给 ARK：ARK 是云端服务，无法访问开发机的
 * localhost。这里将本地预设映射到测试站的同路径公开文件；线上则直接使用
 * Doopoo 域名的静态公开文件，二者均不经过 Supabase。
 */
async function persistAudioUrl(
  url: string,
  supabase: any,
  userId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!url) return { ok: true, url };
  // 预设音色已经由 Doopoo 的静态站点以公开 audio/mpeg 提供。开发时传来的
  // localhost 只对当前电脑可见，必须映射到 test.doopoo.ai 的同一静态资源；
  // 部署环境则保持现有公开 URL。两种情况都不应触发转存或数据库迁移提示。
  try {
    const parsed = new URL(url);
    const isDoopooHost = ["doopoo.ai", "www.doopoo.ai", "test.doopoo.ai"].includes(
      parsed.hostname,
    );
    const isPresetVoice = /^\/voice-styles\/[\w-]+\.mp3$/i.test(parsed.pathname);
    if (parsed.protocol === "http:" && parsed.hostname === "localhost" && isPresetVoice) {
      return { ok: true, url: `https://test.doopoo.ai${parsed.pathname}` };
    }
    if (parsed.protocol === "https:" && isDoopooHost && isPresetVoice) {
      return { ok: true, url };
    }
  } catch {
    // 非 URL 由后续 fetchMedia 给出标准错误。
  }
  try {
    const { buf, contentType } = await fetchMedia(url);
    const ct = (contentType || "audio/mpeg").toLowerCase();
    let ext = "mp3";
    if (ct.includes("audio/mpeg") || ct.includes("mp3")) ext = "mp3";
    else if (ct.includes("wav")) ext = "wav";
    else if (ct.includes("mp4") || ct.includes("m4a") || ct.includes("aac")) ext = "m4a";
    else if (ct.includes("webm")) ext = "webm";
    else if (ct.includes("ogg")) ext = "ogg";
    const mime = contentType || "audio/mpeg";
    const path = `${userId}/video-gen/audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    // 优先腾讯云 COS + CDN（公开 URL，ARK 云端可直接拉取）
    const { isCosConfigured, uploadToCos } = await import("./cosClient");
    if (isCosConfigured()) {
      const r = await uploadToCos(path, buf as ArrayBuffer, mime);
      if (r.ok) {
        const probe = await fetch(r.url, { headers: { Range: "bytes=0-1" }, redirect: "follow" });
        if (!probe.ok) {
          return {
            ok: false,
            error: `参考音频转存到 CDN 后仍不可公网读取 (${probe.status})；请检查 CDN/COS 公共读配置。`,
          };
        }
        return { ok: true, url: r.url };
      }
      if (!r.fallback) return { ok: false, error: `参考音频转存失败: ${r.error}` };
    }
    const blob = new Blob([buf], { type: mime });
    const { error: uploadErr } = await supabase.storage
      .from("workspace-media")
      .upload(path, blob, { contentType: mime, upsert: true });
    if (uploadErr) return { ok: false, error: `参考音频转存失败: ${uploadErr.message}` };
    // workspace-media 是公开 bucket。ARK 在拉取音频时对某些 Supabase 签名 URL
    // (特别是超长有效期 token)会报 resource download failed；使用公开对象 URL
    // 可避免网关重定向/签名校验差异，也不会暴露非公开资源。
    const { data: publicUrl } = supabase.storage.from("workspace-media").getPublicUrl(path);
    if (!publicUrl?.publicUrl) return { ok: false, error: "参考音频转存失败: 未取到公开 URL" };
    // 在发给 ARK 前以匿名请求验证对象确实可被公网下载。既有 bucket 若曾以私有
    // 模式创建，getPublicUrl 仍会拼出 URL，但 ARK 只能得到 resource download failed。
    const probe = await fetch(publicUrl.publicUrl, {
      headers: { Range: "bytes=0-1" },
      redirect: "follow",
    });
    if (!probe.ok) {
      return {
        ok: false,
        error: `参考音频转存后仍不可公网读取 (${probe.status})；请上传可公开访问的音频，或联系管理员检查 workspace-media 公开读权限。`,
      };
    }
    return { ok: true, url: publicUrl.publicUrl };
  } catch (e: any) {
    return { ok: false, error: `参考音频转存失败: ${e?.message ?? String(e)}` };
  }
}

const GenerateVideoInput = z.object({
  prompt: z.string().min(1).max(10000),
  // 单张图生视频(图作为首帧 / 参考图)
  imageUrl: z.string().url().optional(),
  // 尾帧图(仅 2 张分镜图生成时使用,首帧+尾帧模式)
  lastFrameImageUrl: z.string().url().optional(),
  referenceImageUrls: z.array(z.string().url()).max(8).optional(),
  referenceVideoUrl: z.string().url().optional(),
  referenceAudioUrl: z.string().url().optional(),
  model: z.string().max(200).optional(),
  ratio: z.enum(SUPPORTED_RATIOS).default("16:9"),
  duration: z.number().int().min(1).max(60).default(5), // ARK 示例最大 11s,这里留余量到 60
  resolution: z.enum(["480P", "720P", "1080P"]).default("720P"),
  generateAudio: z.boolean().optional(),
  watermark: z.boolean().optional(),
  onProgress: z.function().optional(),
  pollMs: z.number().int().min(1_000).max(30_000).optional(),
});

export type GenerateVideoInputType = z.infer<typeof GenerateVideoInput>;

export const generateVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GenerateVideoInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const backend = getVideoBackend(data.model);
    const media: DashScopeMediaItem[] = [];
    if (data.imageUrl) media.push({ type: "first_frame", url: data.imageUrl });
    if (data.lastFrameImageUrl) media.push({ type: "last_frame", url: data.lastFrameImageUrl });
    if (data.referenceImageUrls?.length) {
      for (const url of data.referenceImageUrls) media.push({ type: "reference_image", url });
    }

    // data: URI → 签名 URL:生图函数常返回 base64 data URI(单条数 MB),直接发给后端
    // 会撑爆请求体(kuaizi 落库 22001)或被后端拒绝。并行上传后替换成 https URL。
    const persistResults = await Promise.all(
      media.map((m) => persistDataUriUrl(m.url, supabase, userId).then((r) => ({ m, r }))),
    );
    const persistedMedia: DashScopeMediaItem[] = [];
    for (const { m, r } of persistResults) {
      if (!r.ok) return { ok: false as const, error: r.error, taskId: undefined, backend };
      persistedMedia.push({ type: m.type, url: r.url });
    }
    let referenceVideoUrl = data.referenceVideoUrl;
    if (referenceVideoUrl) {
      const r = await persistDataUriUrl(referenceVideoUrl, supabase, userId);
      if (!r.ok) return { ok: false as const, error: r.error, taskId: undefined, backend };
      referenceVideoUrl = r.url;
    }
    let referenceAudioUrl = data.referenceAudioUrl;
    if (referenceAudioUrl) {
      // 预设音频(dev 下是 localhost URL)必须转存成 Supabase 公网 URL,ARK 云端才拉得到;
      // 用户上传的已是 Supabase URL,persistAudioUrl 内部会直接放行。
      const r = await persistAudioUrl(referenceAudioUrl, supabase, userId);
      if (!r.ok) return { ok: false as const, error: r.error, taskId: undefined, backend };
      referenceAudioUrl = r.url;
    }

    const model =
      data.model ||
      (backend === "ark" || backend === "shuci"
        ? ARK_DEFAULT_MODEL
        : backend === "kling"
          ? "kling-v2-6"
          : backend === "confluo"
            ? "confluo-doubao-seedance-2-0-mini-260615"
            : backend === "topenrouter"
              ? "topenrouter-doubao-seedance-2-0-260128"
              : backend === "hongmeng"
                ? "hongmeng-seedance2-pro"
                : "happyhorse-1.0-i2v");

    // 1) 提交
    const submit = await submitVideoTask({
      model,
      prompt: data.prompt,
      media: persistedMedia,
      ratio: data.ratio,
      resolution: data.resolution,
      duration: data.duration,
      generateAudio: data.generateAudio,
      watermark: data.watermark,
      referenceVideoUrl,
      referenceAudioUrl,
    });
    if (!submit.ok) {
      return { ok: false as const, error: submit.error, taskId: undefined, backend };
    }

    data.onProgress?.("queued", { taskId: submit.taskId, backend });

    // 2) 轮询
    const pollInterval = data.pollMs ?? 5_000;
    // 视频任务由供应商异步执行；只要不是明确失败/取消，就持续轮询，
    // 不再用本地 5 分钟 deadline 把仍在生成的任务错误标记为失败。
    while (true) {
      await sleep(pollInterval);
      const poll = await pollVideoTask({ taskId: submit.taskId, backend: submit.backend });
      if (!poll.ok) {
        // 业务错误(poll 带 status: failed/cancelled,如丽帧 code!==0)不可恢复,直接终止;
        // 否则按网络抖动继续轮询
        if (poll.status === "failed" || poll.status === "cancelled") {
          return {
            ok: false as const,
            error: poll.error || `[${submit.backend}] ${poll.status}`,
            taskId: submit.taskId,
            backend: submit.backend,
            lastStatus: poll.status,
          };
        }
        continue;
      }
      if (poll.status === "succeeded") {
        data.onProgress?.("succeeded", {
          taskId: submit.taskId,
          videoUrl: poll.videoUrl,
          backend: submit.backend,
        });
        // 成功才扣分(视频积分,按 duration 比例)。不在价目表 -> 不扣;扣失败不阻断
        const __vCost = videoCost(submit.model, data.resolution, data.duration);
        if (__vCost != null) {
          await chargeCredits(supabase, userId, {
            amount: __vCost,
            model: submit.model,
            resolution: data.resolution,
            duration: data.duration,
            description: "视频生成",
          });
        }
        return {
          ok: true as const,
          taskId: submit.taskId,
          videoUrl: poll.videoUrl || "",
          model: submit.model,
          backend: submit.backend,
        };
      }
      if (poll.status === "failed" || poll.status === "cancelled") {
        const raw = (poll as any).raw;
        const errMsg =
          raw?.error?.message || raw?.output?.error_message || `${poll.status} (no error detail)`;
        return {
          ok: false as const,
          error: `[${submit.backend}] ${poll.status}: ${errMsg}`,
          taskId: submit.taskId,
          backend: submit.backend,
        };
      }
      data.onProgress?.(poll.status, { taskId: submit.taskId, backend: submit.backend });
    }
  });

// ====================================================================
// Backwards-compat alias —— 2026 早期版本叫 generateSeedanceVideo
// 老代码若还在 import 这个名字,会落到 ARK 后端(因为现在 model id 决定 backend)。
// 新代码请直接用 generateVideo。
// ====================================================================
export const generateSeedanceVideo = generateVideo;
