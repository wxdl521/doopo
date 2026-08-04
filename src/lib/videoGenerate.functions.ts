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

// ---------- AgentEarth (Seedance 2.0) ----------

const AGENTEARTH_DEFAULT_BASE_URL = "https://maas.agentearth.ai/v1";
const AGENTEARTH_SEEDANCE_MODEL = "earth/seedance-2.0";
const AGENTEARTH_SEEDANCE_GLOBAL_MODEL = "earth/seedance-2.0-global";

function isAgentEarthSeedanceModel(model: string): boolean {
  return model === AGENTEARTH_SEEDANCE_MODEL || model === AGENTEARTH_SEEDANCE_GLOBAL_MODEL;
}

function getAgentEarthVideoConfig() {
  return {
    apiKey: process.env.AGENTEARTH_API_KEY,
    baseUrl: (process.env.AGENTEARTH_BASE_URL || AGENTEARTH_DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

// ---------- Revora / NewAPI(Sora 兼容视频接口) ----------

const REVORA_VIDEO_DEFAULT_BASE_URL = "https://revora.vip";
const REVORA_VIDEO_DEFAULT_MODEL = "seedance-2.0";

export const REVORA_VIDEO_MODELS = {
  "revora-seedance-2-0": "Seedance 2.0 (Revora)",
} as const;

function isRevoraVideoModel(model: string): boolean {
  return model.toLowerCase().startsWith("revora-");
}

function getRevoraVideoConfig() {
  return {
    apiKey: process.env.REVORA_VIDEO_API_KEY,
    baseUrl: (process.env.REVORA_BASE_URL || REVORA_VIDEO_DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: process.env.REVORA_VIDEO_MODEL || REVORA_VIDEO_DEFAULT_MODEL,
  };
}

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
  | "sdreal"
  | "keyiyun"
  | "ycore"
  | "neiwen"
  | "agentearth"
  | "revora" {
  const m = (modelId || "").trim().toLowerCase();
  if (isRevoraVideoModel(m)) return "revora";
  if (isAgentEarthSeedanceModel(m)) return "agentearth";
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
  if (m.startsWith("keyiyun-")) return "keyiyun";
  if (m.startsWith("ycore-")) return "ycore";
  if (m.startsWith("neiwen-")) return "neiwen";
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
// 参考素材会先登记为 TopenRouter asset，待状态变为 Active 后再以
// asset://<id> 提交。真人图片走此路径可避免直接 URL 触发隐私风控。
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

// 客易云 Seedance 2.0 特价版。模型编码由上游完整指定，包含分辨率和套餐类型。
export const KEYYIYUN_VIDEO_MODELS = {
  "keyiyun-sd-2-0-fast-discount-720p": "Seedance 2.0 官方折扣版（客易云 · 720p）",
} as const;

export const YCORE_VIDEO_MODELS = {
  "ycore-seedance-2-0": "Seedance 2.0 (爻核云)",
  "ycore-seedance-2-0-fast": "Seedance 2.0 Fast (爻核云)",
  "ycore-seedance-2-0-mini": "Seedance 2.0 Mini (爻核云)",
} as const;

export const NEIWEN_VIDEO_MODELS = {
  "neiwen-c-seedance-2-0": "c/seedance-2.0 (内文)",
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
  ...KEYYIYUN_VIDEO_MODELS,
  ...YCORE_VIDEO_MODELS,
  ...NEIWEN_VIDEO_MODELS,
  ...KLING_VIDEO_MODELS,
  ...REVORA_VIDEO_MODELS,
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

// 数安词源的视频网关透传字节 ARK 的任务接口。
// 该域名当前 HTTPS 证书主机名不匹配，因此默认保留供应商可用的 HTTP 地址。
const SHUCIYUAN_DEFAULT_BASE_URL = "http://token.ds.cyberpeace.cn";
const SHUCIYUAN_VIDEO_MODEL_MAP: Record<string, string> = {
  "shuci-seedance-2-0": "doubao-seedance-2-0-260128",
  "shuci-seedance-2-0-fast": "doubao-seedance-2-0-fast-260128",
  "shuci-seedance-2-0-mini": "doubao-seedance-2-0-mini-260615",
};

/**
 * 数安词源配置可以是网关根地址、`/api/v3`，或完整的 tasks 地址。
 * 统一归一化为 ARK API 根地址，避免再次落回旧的 `/v1/videos` 协议。
 */
export function normalizeShuciVideoBaseUrl(value?: string): string {
  const raw = (value || SHUCIYUAN_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const withoutTaskPath = raw.replace(
    /\/contents\/generations\/tasks(?:\/[^/?#]+)?(?:[?#].*)?$/i,
    "",
  );
  const withoutApiVersion = withoutTaskPath.replace(/\/api\/v3$/i, "");
  return `${withoutApiVersion}/api/v3`;
}

function getShuciVideoConfig() {
  return {
    apiKey: process.env.SHUANCIYUAN_VIDEO_KEY,
    baseUrl: normalizeShuciVideoBaseUrl(process.env.SHUANCIYUAN_VIDEO_BASE_URL),
  };
}

async function shuciSubmit(input: {
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
  const firstFrameImageUrl = input.media.find((item) => item.type === "first_frame")?.url;
  const lastFrameImageUrl = input.media.find((item) => item.type === "last_frame")?.url;
  const referenceImageUrls = input.media
    .filter((item) => item.type === "reference_image")
    .map((item) => item.url);
  return arkSubmit({
    model: input.model,
    content: buildArkContent(input.prompt, {
      firstFrameImageUrl,
      lastFrameImageUrl,
      referenceImageUrls,
      referenceVideoUrl: input.referenceVideoUrl,
      referenceAudioUrl: input.referenceAudioUrl,
    }),
    ratio: input.ratio,
    resolution: input.resolution,
    duration: input.duration,
    generateAudio: input.generateAudio,
    watermark: input.watermark,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    label: "shuci",
  });
}

async function shuciPoll(input: {
  taskId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<PollResult> {
  return arkPoll({ ...input, label: "shuci" });
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
  | {
      type: "image_url";
      image_url: { url: string };
      role?: "first_frame" | "last_frame" | "reference_image";
    }
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

// 2026/08:submit 超时 30s→60s。上游创建任务偶发超过 30s（EP01 U01 曾因此
// 误报 submit timeout），60s 配合下面的网络类重试能覆盖绝大多数抖动。
const VIDEO_TASK_HTTP_TIMEOUT_MS = 60_000;
const SUBMIT_MAX_ATTEMPTS = 3;

type SubmitFetchResult =
  | { ok: true; status: number; text: string }
  | { ok: false; networkError: string };

/** 429 / 5xx 属于可重试的临时故障；业务 4xx（如风控 400）重投无意义。 */
function isRetryableSubmitStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * 视频任务提交共用的 POST 请求：60s 超时，对网络类错误（AbortError /
 * fetch failed / 429 / 5xx）做最多 3 次指数退避重试；业务 4xx 立即返回，
 * 由调用方按原格式包装错误。
 */
async function fetchSubmitWithRetry(input: {
  url: string;
  headers: Record<string, string>;
  body: string;
  /** 错误日志标签,如 "ark-seedance" / "topenrouter" */
  label: string;
}): Promise<SubmitFetchResult> {
  let lastNetworkError = "fetch failed";
  for (let attempt = 1; attempt <= SUBMIT_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VIDEO_TASK_HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(input.url, {
        method: "POST",
        headers: input.headers,
        body: input.body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const text = await res.text().catch(() => "");
      if (!res.ok && isRetryableSubmitStatus(res.status) && attempt < SUBMIT_MAX_ATTEMPTS) {
        console.warn(
          `[${input.label}] submit ${res.status} 可重试，第 ${attempt}/${SUBMIT_MAX_ATTEMPTS} 次后退避重投`,
        );
        await sleep(1_000 * 2 ** (attempt - 1));
        continue;
      }
      return { ok: true, status: res.status, text };
    } catch (e) {
      clearTimeout(timeout);
      lastNetworkError =
        e instanceof Error
          ? e.name === "AbortError"
            ? `submit timeout (${VIDEO_TASK_HTTP_TIMEOUT_MS / 1_000}s)`
            : e.message
          : "fetch failed";
      if (attempt < SUBMIT_MAX_ATTEMPTS) {
        console.warn(
          `[${input.label}] submit network=${lastNetworkError}，第 ${attempt}/${SUBMIT_MAX_ATTEMPTS} 次后退避重投`,
        );
        await sleep(1_000 * 2 ** (attempt - 1));
      }
    }
  }
  return { ok: false, networkError: lastNetworkError };
}

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

  const result = await fetchSubmitWithRetry({
    url: `${input.baseUrl}/contents/generations/tasks`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(body),
    label: tag,
  });
  if (!result.ok) return { ok: false, error: `[${tag}] network: ${result.networkError}` };
  const { status, text } = result;
  {
    if (status < 200 || status >= 300) {
      console.warn(`[${tag}] submit ${status} full body:`, text.slice(0, 2000));
      return { ok: false, error: `[${tag}] submit ${status}: ${text.slice(0, 500)}` };
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
  // 部分中转（弘梦）会返回 { data: { data: { video_url } } }，且外层还可能
  // 直接提供 result_url。沿着已知包装字段向下展开，避免成功任务被误判为空视频。
  const records: UnknownRecord[] = [];
  const queue: Array<{ record: UnknownRecord; depth: number }> = [{ record: root, depth: 0 }];
  while (queue.length) {
    const current = queue.shift()!;
    records.push(current.record);
    if (current.depth >= 3) continue;
    for (const key of ["content", "output", "data", "result", "task"]) {
      const child = asRecord(current.record[key]);
      if (child) queue.push({ record: child, depth: current.depth + 1 });
    }
  }
  const urls: unknown[] = [];
  for (const record of records) {
    urls.push(record.video_url, record.videoUrl, record.url, record.result_url, record.resultUrl);
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
  const timeout = setTimeout(() => controller.abort(), VIDEO_TASK_HTTP_TIMEOUT_MS);
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
          ? `poll timeout (${VIDEO_TASK_HTTP_TIMEOUT_MS / 1_000}s)`
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

  const result = await fetchSubmitWithRetry({
    url: DASHSCOPE_VIDEO_ENDPOINT,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify(body),
    label: "dashscope-video",
  });
  if (!result.ok) {
    return { ok: false, error: `[dashscope-video] network: ${result.networkError}` };
  }
  const { status, text } = result;
  {
    if (status < 200 || status >= 300)
      return { ok: false, error: `[dashscope-video] submit ${status}: ${text.slice(0, 300)}` };
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
  const timeout = setTimeout(() => controller.abort(), VIDEO_TASK_HTTP_TIMEOUT_MS);
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
          ? `poll timeout (${VIDEO_TASK_HTTP_TIMEOUT_MS / 1_000}s)`
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
  const topenrouterAssetApiKey = process.env.TOPENROUTER_ASSET_API_KEY;
  const topenrouterApiKey = process.env.TOPENROUTER_API_KEY;
  return {
    apiKey: topenrouterApiKey,
    // 素材接口和视频接口均由 TopenRouter 网关鉴权。若供应商分配了具备
    // 素材权益的专用 Key，可通过 TOPENROUTER_ASSET_API_KEY 显式覆盖。
    assetApiKey: topenrouterAssetApiKey || topenrouterApiKey,
    assetApiKeySource: topenrouterAssetApiKey
      ? "TOPENROUTER_ASSET_API_KEY"
      : topenrouterApiKey
        ? "TOPENROUTER_API_KEY"
        : undefined,
    baseUrl: (process.env.TOPENROUTER_BASE_URL || TOPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

/** 从 model id 剥离 `topenrouter-` 前缀,得到上游 model 名 */
function topenrouterModelToUpstream(modelId: string): string {
  return modelId.replace(/^topenrouter-/i, "");
}

type TopenrouterAssetType = "Image" | "Video" | "Audio";

type TopenrouterAsset = {
  id: string;
  name?: string;
  assetType?: TopenrouterAssetType;
  status?: string;
  url?: string;
  createTime?: string;
};

const TOPENROUTER_ASSET_READY_TIMEOUT_MS = 90_000;
const TOPENROUTER_ASSET_POLL_MS = 1_500;

function topenrouterAssetUrl(assetId: string): string {
  return `asset://${assetId}`;
}

function normalizeTopenrouterAsset(raw: unknown): TopenrouterAsset | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const id = value.Id ?? value.id;
  if (typeof id !== "string" || !id) return null;
  const assetType = value.AssetType ?? value.asset_type ?? value.assetType;
  return {
    id,
    name:
      typeof value.Name === "string"
        ? value.Name
        : typeof value.name === "string"
          ? value.name
          : undefined,
    assetType:
      assetType === "Image" || assetType === "Video" || assetType === "Audio"
        ? assetType
        : undefined,
    status:
      typeof value.Status === "string"
        ? value.Status
        : typeof value.status === "string"
          ? value.status
          : undefined,
    url:
      typeof value.URL === "string"
        ? value.URL
        : typeof value.url === "string"
          ? value.url
          : undefined,
    createTime:
      typeof value.CreateTime === "string"
        ? value.CreateTime
        : typeof value.create_time === "string"
          ? value.create_time
          : undefined,
  };
}

function topenrouterErrorBody(text: string): string {
  try {
    const json = JSON.parse(text) as {
      code?: string | number;
      error?: { code?: string | number; message?: string };
      message?: string;
    };
    const code = json.error?.code ?? json.code;
    const message = json.error?.message || json.message;
    if (code !== undefined && message) return `${code}: ${message}`;
    return message || (code !== undefined ? String(code) : text.slice(0, 300));
  } catch {
    return text.slice(0, 300);
  }
}

/** 将供应商的权限错误转成可操作的配置提示，避免把视频 Key 误当成素材 Key。 */
function topenrouterAssetUploadError(status: number, text: string, apiKeySource?: string): string {
  const upstreamError = topenrouterErrorBody(text);
  if (status === 403 && /无权使用素材|asset.*permission|permission.*asset/i.test(upstreamError)) {
    const configuredKey = apiKeySource ? `当前使用 ${apiKeySource}` : "当前未识别到素材密钥";
    return (
      "[topenrouter] 素材上传被拒绝（403：无权使用素材）。" +
      `${configuredKey}；请在 Cloudflare Secrets 或 .env.local 配置 ` +
      "TOPENROUTER_ASSET_API_KEY 为已开通素材权益的 TopenRouter Key。"
    );
  }
  return `[topenrouter] asset upload ${status}: ${upstreamError}`;
}

/** 将一个公网素材 URL 登记到 TopenRouter 上游素材库，返回稳定 asset_id。 */
async function topenrouterUploadAsset(input: {
  model: string;
  url: string;
  assetType: TopenrouterAssetType;
  name?: string;
  apiKey: string;
  apiKeySource?: string;
  baseUrl: string;
}): Promise<{ ok: true; asset: TopenrouterAsset } | { ok: false; error: string }> {
  const upstreamModel = topenrouterModelToUpstream(input.model);
  console.log(
    `[topenrouter asset→] model=${upstreamModel} type=${input.assetType} name=${input.name || "unnamed"}`,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(
      `${input.baseUrl}/v1/api/assets/upload?model=${encodeURIComponent(upstreamModel)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify({
          url: input.url,
          asset_type: input.assetType,
          ...(input.name ? { name: input.name } : {}),
        }),
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      console.warn(
        `[topenrouter asset×] upload status=${res.status} body=${topenrouterErrorBody(text)}`,
      );
      return {
        ok: false,
        error: topenrouterAssetUploadError(res.status, text, input.apiKeySource),
      };
    }
    let json: { code?: number | string; message?: string; data?: unknown } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    if (json.code !== undefined && json.code !== 0 && json.code !== "success") {
      console.warn(
        `[topenrouter asset×] upload code=${json.code} message=${json.message || "unknown"}`,
      );
      return {
        ok: false,
        error: `[topenrouter] asset upload failed: ${json.message || text.slice(0, 300)}`,
      };
    }
    const asset = normalizeTopenrouterAsset(json.data);
    if (!asset) {
      console.warn("[topenrouter asset×] upload returned no asset id");
      return {
        ok: false,
        error: `[topenrouter] asset upload returned no asset id: ${text.slice(0, 300)}`,
      };
    }
    console.log(
      `[topenrouter asset created] id=${asset.id} status=${asset.status || "Processing"}`,
    );
    return { ok: true, asset };
  } catch (e) {
    clearTimeout(timeout);
    const message =
      e instanceof Error && e.name === "AbortError"
        ? "upload timeout (30s)"
        : e instanceof Error
          ? e.message
          : "fetch failed";
    console.warn(`[topenrouter asset×] upload network=${message}`);
    return { ok: false, error: `[topenrouter] asset upload network: ${message}` };
  }
}

/** 查询 TopenRouter 素材状态；临时 URL 仅用于素材库展示，视频生成始终使用 asset://id。 */
async function topenrouterGetAsset(input: {
  model: string;
  assetId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<{ ok: true; asset: TopenrouterAsset } | { ok: false; error: string }> {
  const upstreamModel = topenrouterModelToUpstream(input.model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(
      `${input.baseUrl}/v1/api/assets/${encodeURIComponent(input.assetId)}?model=${encodeURIComponent(upstreamModel)}`,
      {
        headers: { Authorization: `Bearer ${input.apiKey}` },
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);
    const text = await res.text().catch(() => "");
    if (!res.ok)
      return {
        ok: false,
        error: `[topenrouter] asset get ${res.status}: ${topenrouterErrorBody(text)}`,
      };
    let json: { code?: number | string; message?: string; data?: unknown } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    if (json.code !== undefined && json.code !== 0 && json.code !== "success") {
      return {
        ok: false,
        error: `[topenrouter] asset get failed: ${json.message || text.slice(0, 300)}`,
      };
    }
    const asset = normalizeTopenrouterAsset(json.data);
    if (!asset)
      return {
        ok: false,
        error: `[topenrouter] asset get returned invalid data: ${text.slice(0, 300)}`,
      };
    return { ok: true, asset };
  } catch (e) {
    clearTimeout(timeout);
    const message =
      e instanceof Error && e.name === "AbortError"
        ? "get timeout (30s)"
        : e instanceof Error
          ? e.message
          : "fetch failed";
    return { ok: false, error: `[topenrouter] asset get network: ${message}` };
  }
}

/** 等待上游素材完成入库校验，只有 Active 的 asset 才可安全传给视频任务。 */
async function topenrouterWaitForAsset(input: {
  model: string;
  assetId: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
}): Promise<{ ok: true; asset: TopenrouterAsset } | { ok: false; error: string }> {
  const deadline = Date.now() + (input.timeoutMs ?? TOPENROUTER_ASSET_READY_TIMEOUT_MS);
  let lastStatus = "unknown";
  while (Date.now() < deadline) {
    const result = await topenrouterGetAsset(input);
    if (!result.ok) return result;
    const status = (result.asset.status || "").toLowerCase();
    lastStatus = result.asset.status || lastStatus;
    if (status === "active") {
      console.log(`[topenrouter asset✓] id=${input.assetId} status=Active`);
      return result;
    }
    if (status === "failed") {
      console.warn(`[topenrouter asset×] id=${input.assetId} status=Failed`);
      return { ok: false, error: `[topenrouter] asset ${input.assetId} 入库失败 (Failed)` };
    }
    console.log(
      `[topenrouter asset⟳] id=${input.assetId} status=${result.asset.status || "unknown"}`,
    );
    await sleep(TOPENROUTER_ASSET_POLL_MS);
  }
  return {
    ok: false,
    error: `[topenrouter] asset ${input.assetId} 等待入库超时，最后状态: ${lastStatus}`,
  };
}

/**
 * 将参考资源转换为 TopenRouter 的稳定素材引用。
 * 已是 asset:// 的引用不重复上传，便于调用方复用已审核通过的真人素材。
 */
async function topenrouterEnsureAsset(input: {
  model: string;
  url?: string;
  assetType: TopenrouterAssetType;
  name: string;
  apiKey: string;
  apiKeySource?: string;
  baseUrl: string;
}): Promise<{ ok: true; url?: string } | { ok: false; error: string }> {
  if (!input.url || input.url.startsWith("asset://")) return { ok: true, url: input.url };
  const uploaded = await topenrouterUploadAsset({
    model: input.model,
    url: input.url,
    assetType: input.assetType,
    name: input.name,
    apiKey: input.apiKey,
    apiKeySource: input.apiKeySource,
    baseUrl: input.baseUrl,
  });
  if (!uploaded.ok) return uploaded;
  const ready = await topenrouterWaitForAsset({
    model: input.model,
    assetId: uploaded.asset.id,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
  });
  if (!ready.ok) return ready;
  return { ok: true, url: topenrouterAssetUrl(ready.asset.id) };
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
  console.log(
    `[topenrouter video→] model=${upstreamModel} content=${input.content.length} ratio=${input.ratio || "default"} resolution=${body.resolution || "default"} duration=${input.duration ?? "default"}`,
  );

  const result = await fetchSubmitWithRetry({
    url: `${input.baseUrl}/v1/video/tasks`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(body),
    label: "topenrouter video",
  });
  if (!result.ok) {
    console.warn(`[topenrouter video×] submit network=${result.networkError}`);
    return { ok: false, error: `[topenrouter] network: ${result.networkError}` };
  }
  const { status, text } = result;
  {
    if (status < 200 || status >= 300) {
      const upstreamError = topenrouterErrorBody(text);
      console.warn(`[topenrouter video×] submit status=${status} body=${upstreamError}`);
      // 直接将供应商 code/message 返回给界面，避免包装错误掩盖上游实际原因。
      return { ok: false, error: upstreamError };
    }
    // 复用 arkSubmit 同款 bugfix:JSON.parse(text) 而非 res.json()(body 流已消费)
    let json: { id?: string; error?: { code?: string; message?: string }; message?: string } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    if (!json.id) {
      console.warn(
        `[topenrouter video×] submit missing task id: ${json.error?.message || json.message || "unknown"}`,
      );
      return {
        ok: false,
        error: `[topenrouter] no task id: ${json.error?.message || json.message || text.slice(0, 200)}`,
      };
    }
    console.log(`[topenrouter video✓] submitted taskId=${json.id}`);
    return { ok: true, taskId: json.id, model: input.model };
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

/**
 * AgentEarth Seedance 2.0 异步任务提交。
 *
 * 官方接口会立即返回 `queued` 任务；必须再查询 `/videos/{id}` 取得成品 URL。
 * 不要在 POST 上挂着等模型生成完成：这会让 Cloudflare/网关先断开浏览器请求，表现为
 * 无上下文的 502，即使上游任务最终已经成功。
 */
async function agentEarthSeedanceSubmit(input: {
  model: string;
  prompt: string;
  media: DashScopeMediaItem[];
  ratio?: SeedanceRatio;
  resolution?: string;
  duration?: number;
  generateAudio?: boolean;
  referenceVideoUrl?: string;
  referenceAudioUrl?: string;
  apiKey: string;
  baseUrl: string;
}): Promise<{ ok: true; taskId: string; model: string } | { ok: false; error: string }> {
  if (input.duration != null && (input.duration < 4 || input.duration > 15)) {
    return {
      ok: false,
      error: "[agentearth] Seedance 2.0 duration must be between 4 and 15 seconds",
    };
  }

  const imageInput =
    input.media.find((item) => item.type === "first_frame")?.url ||
    input.media.find((item) => item.type === "reference_image")?.url;
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    resolution: toArkResolution(input.resolution),
  };
  if (input.ratio) body.ratio = input.ratio;
  if (input.duration != null) body.duration = input.duration;
  if (typeof input.generateAudio === "boolean") body.generate_audio = input.generateAudio;
  if (imageInput) body.image_input = imageInput;
  if (input.referenceVideoUrl) body.video_input = input.referenceVideoUrl;
  if (input.referenceAudioUrl) body.audio_input = input.referenceAudioUrl;

  // AgentEarth 支持 Idempotency-Key；网络重试不会创建重复扣费任务。
  const idempotencyKey = `doopoo-video-${crypto.randomUUID()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${input.baseUrl}/videos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const responseText = await response.text().catch(() => "");
    if (!response.ok) {
      return {
        ok: false,
        error: `[agentearth] generate ${response.status}: ${responseText.slice(0, 500)}`,
      };
    }
    let payload: { id?: string; task_id?: string; error?: { message?: string } } = {};
    try {
      payload = JSON.parse(responseText);
    } catch {}
    const taskId = payload.id || payload.task_id;
    if (!taskId) {
      return {
        ok: false,
        error: `[agentearth] submit missing task id: ${payload.error?.message || responseText.slice(0, 300)}`,
      };
    }
    return { ok: true, taskId, model: input.model };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "submit timeout (30s)"
        : error instanceof Error
          ? error.message
          : "fetch failed";
    return { ok: false, error: `[agentearth] network: ${message}` };
  } finally {
    clearTimeout(timeout);
  }
}

/** 查询 AgentEarth 异步视频任务。 */
async function agentEarthSeedancePoll(input: {
  taskId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<PollResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${input.baseUrl}/videos/${encodeURIComponent(input.taskId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: controller.signal,
    });
    const responseText = await response.text().catch(() => "");
    let payload: RevoraVideoResponse = {};
    try {
      payload = JSON.parse(responseText) as RevoraVideoResponse;
    } catch {}
    if (!response.ok) {
      const detail = typeof payload.error === "string" ? payload.error : payload.error?.message;
      return {
        ok: false,
        error: `[agentearth] poll ${response.status}: ${detail || responseText.slice(0, 400)}`,
        status: response.status === 404 ? "failed" : undefined,
        raw: payload,
      };
    }
    return {
      ok: true,
      status: seedanceStatusToProgress(payload.status),
      videoUrl: revoraVideoUrl(payload),
      raw: payload,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "poll timeout (30s)"
        : error instanceof Error
          ? error.message
          : "fetch failed";
    return { ok: false, error: `[agentearth] poll network: ${message}` };
  } finally {
    clearTimeout(timeout);
  }
}

type RevoraVideoResponse = {
  id?: string;
  task_id?: string;
  status?: string;
  progress?: number;
  url?: string;
  video_url?: string;
  error?: { message?: string; code?: string } | string;
  data?:
    | { url?: string; video_url?: string; status?: string }
    | Array<{ url?: string; video_url?: string; status?: string }>;
  content?: { video_url?: string; url?: string };
  video?: { url?: string };
  output?: { url?: string; video_url?: string };
};

function revoraVideoUrl(payload: RevoraVideoResponse): string | null {
  const data = Array.isArray(payload.data) ? payload.data[0] : payload.data;
  return (
    payload.url ||
    payload.video_url ||
    payload.content?.video_url ||
    payload.content?.url ||
    payload.video?.url ||
    payload.output?.video_url ||
    payload.output?.url ||
    data?.url ||
    data?.video_url ||
    null
  );
}

function revoraVideoStatus(status: string | undefined): SeedanceProgress {
  const normalized = (status || "queued").toLowerCase();
  if (["completed", "complete", "succeeded", "success", "done"].includes(normalized))
    return "succeeded";
  if (["failed", "failure", "error"].includes(normalized)) return "failed";
  if (["cancelled", "canceled"].includes(normalized)) return "cancelled";
  if (["in_progress", "processing", "running", "generating"].includes(normalized))
    return "running";
  return "queued";
}

async function revoraSubmit(input: {
  model: string;
  prompt: string;
  media: DashScopeMediaItem[];
  ratio?: SeedanceRatio;
  resolution?: string;
  duration?: number;
  apiKey: string;
  baseUrl: string;
  upstreamModel: string;
}): Promise<
  { ok: true; taskId: string; model: string; videoUrl?: string } | { ok: false; error: string }
> {
  const form = new FormData();
  form.append("model", input.upstreamModel);
  form.append("prompt", input.prompt);
  if (input.duration != null) form.append("duration", String(input.duration));
  if (input.ratio) form.append("metadata", JSON.stringify({ ratio: input.ratio }));
  if (input.resolution) {
    const [width, height] = input.ratio === "9:16" ? [720, 1280] : [1280, 720];
    form.append("width", String(width));
    form.append("height", String(height));
  }
  const image =
    input.media.find((item) => item.type === "first_frame")?.url ||
    input.media.find((item) => item.type === "reference_image")?.url;
  if (image) form.append("image", image);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${input.baseUrl}/v1/videos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}` },
      body: form,
      signal: controller.signal,
    });
    const responseText = await response.text().catch(() => "");
    let payload: RevoraVideoResponse = {};
    try {
      payload = JSON.parse(responseText) as RevoraVideoResponse;
    } catch {
      // Keep the raw response available for a useful gateway error message.
    }
    if (!response.ok) {
      const detail = typeof payload.error === "string" ? payload.error : payload.error?.message;
      return {
        ok: false,
        error: `[revora] submit ${response.status}: ${detail || responseText.slice(0, 500)}`,
      };
    }
    const taskId = payload.id || payload.task_id;
    const videoUrl = revoraVideoUrl(payload) || undefined;
    if (!taskId && !videoUrl) {
      return {
        ok: false,
        error: `[revora] submit returned no task id: ${responseText.slice(0, 500)}`,
      };
    }
    return { ok: true, taskId: taskId || `revora-${Date.now()}`, model: input.model, videoUrl };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "submit timeout (60s)"
        : error instanceof Error
          ? error.message
          : "fetch failed";
    return { ok: false, error: `[revora] submit network: ${message}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function revoraPoll(input: {
  taskId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<PollResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${input.baseUrl}/v1/videos/${encodeURIComponent(input.taskId)}`, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: controller.signal,
    });
    const responseText = await response.text().catch(() => "");
    let payload: RevoraVideoResponse = {};
    try {
      payload = JSON.parse(responseText) as RevoraVideoResponse;
    } catch {
      // Keep the raw response available for a useful gateway error message.
    }
    if (!response.ok) {
      const detail = typeof payload.error === "string" ? payload.error : payload.error?.message;
      return {
        ok: false,
        error: `[revora] poll ${response.status}: ${detail || responseText.slice(0, 400)}`,
        status: response.status === 404 ? "failed" : undefined,
        raw: payload,
      };
    }
    const status = revoraVideoStatus(payload.status);
    return { ok: true, status, videoUrl: revoraVideoUrl(payload), raw: payload };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "poll timeout (30s)"
        : error instanceof Error
          ? error.message
          : "fetch failed";
    return { ok: false, error: `[revora] poll network: ${message}` };
  } finally {
    clearTimeout(timeout);
  }
}

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
  | "sdreal"
  | "keyiyun"
  | "ycore"
  | "neiwen"
  | "agentearth"
  | "revora";

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

// ====================================================================
// 客易云（Seedance 2.0 官方折扣版）
//
// 协议：先将参考素材登记为 asset，再以 asset://<assetId> 引用；
// 创建 POST /v1/seedance-special/videos，查询 GET /v1/result/{id}。
// 该套餐的完整模型编码内已包含 720p，不能再透传 resolution。
// ====================================================================

const KEYYIYUN_DEFAULT_BASE_URL = "https://zcbservice.aizfw.cn/kyyReactApiServer";
const KEYYIYUN_UPSTREAM_MODEL = "sd_2.0_fast_discount_720p";
// 素材提交后由客易云服务端拉取并入库公网资源。Supabase 签名 URL 的首个读取
// 可能超过一般 API 请求的 30 秒，给单张素材保留两分钟，避免本地过早中止。
const KEYYIYUN_ASSET_TIMEOUT_MS = 120_000;
const KEYYIYUN_ASSET_READY_TIMEOUT_MS = 90_000;
const KEYYIYUN_ASSET_POLL_MS = 2_000;

function getKeyiyunConfig() {
  return {
    apiKey: process.env.KEYYIYUN_API_KEY,
    baseUrl: (process.env.KEYYIYUN_BASE_URL || KEYYIYUN_DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

function keyiyunStatusToProgress(status: string | undefined): SeedanceProgress {
  return seedanceStatusToProgress(status);
}

type KeyiyunAssetType = "Image" | "Video" | "Audio";

type KeyiyunEnvelope<T> = {
  code?: number | string;
  msg?: string | null;
  message?: string;
  error?: string | { message?: string };
  data?: T;
};

function keyiyunEnvelopeError(envelope: KeyiyunEnvelope<unknown>): string | null {
  if (envelope.code === undefined || envelope.code === 0 || envelope.code === "0") return null;
  const error = typeof envelope.error === "string" ? envelope.error : envelope.error?.message || "";
  return error || envelope.msg || envelope.message || `服务返回错误码 ${envelope.code}`;
}

function isKeyiyunAssetUrl(url: string | undefined): boolean {
  return Boolean(url && /^(?:asset|assetId):\/\/[a-zA-Z0-9_-]+$/.test(url));
}

function extractKeyiyunError(payload: unknown, depth = 0): string | null {
  if (!payload || depth > 3 || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) return record.error;
  if (typeof record.message === "string" && record.message.trim()) return record.message;
  for (const key of ["error", "data", "result", "output"]) {
    const error = extractKeyiyunError(record[key], depth + 1);
    if (error) return error;
  }
  return null;
}

type KeyiyunAssetDetail = {
  assetId?: string;
  status?: string;
  error?: string | { message?: string };
};

async function keyiyunWaitForAsset(input: {
  assetId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const deadline = Date.now() + KEYYIYUN_ASSET_READY_TIMEOUT_MS;
  let lastStatus = "UNKNOWN";
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(`${input.baseUrl}/asset/seedance2/assetDetail`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify({ assetId: input.assetId }),
        signal: controller.signal,
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        return { ok: false, error: `[keyiyun] 查询素材 ${res.status}: ${text.slice(0, 300)}` };
      }
      let json: KeyiyunEnvelope<KeyiyunAssetDetail> & KeyiyunAssetDetail = {};
      try {
        json = JSON.parse(text);
      } catch {}
      const gatewayError = keyiyunEnvelopeError(json);
      if (gatewayError) return { ok: false, error: `[keyiyun] 查询素材失败: ${gatewayError}` };
      const asset = json.data || json;
      const status = (asset.status || "").toUpperCase();
      lastStatus = status || lastStatus;
      if (status === "ACTIVE") return { ok: true, url: `assetId://${input.assetId}` };
      if (["FAILED", "EXPIRED", "DELETED"].includes(status)) {
        return {
          ok: false,
          error: `[keyiyun] 素材 ${input.assetId} 入库失败 (${status}): ${extractKeyiyunError(asset) || "无详细原因"}`,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "fetch failed";
      return { ok: false, error: `[keyiyun] 查询素材网络错误: ${message}` };
    } finally {
      clearTimeout(timeout);
    }
    await sleep(KEYYIYUN_ASSET_POLL_MS);
  }
  return {
    ok: false,
    error: `[keyiyun] 素材 ${input.assetId} 在 ${KEYYIYUN_ASSET_READY_TIMEOUT_MS / 1_000}s 内未进入 ACTIVE 状态（当前 ${lastStatus}）`,
  };
}

async function keyiyunEnsureAsset(input: {
  url: string | undefined;
  assetType: KeyiyunAssetType;
  name: string;
  apiKey: string;
  baseUrl: string;
}): Promise<{ ok: true; url?: string } | { ok: false; error: string }> {
  if (!input.url) return { ok: true };
  if (isKeyiyunAssetUrl(input.url)) return { ok: true, url: input.url };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KEYYIYUN_ASSET_TIMEOUT_MS);
  try {
    const res = await fetch(`${input.baseUrl}/asset/seedance2/assetUpload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({ assetType: input.assetType, url: input.url, name: input.name }),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return { ok: false, error: `[keyiyun] 素材提交 ${res.status}: ${text.slice(0, 300)}` };
    }
    let json: KeyiyunEnvelope<{ assetId?: string }> & { assetId?: string } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    const gatewayError = keyiyunEnvelopeError(json);
    if (gatewayError) return { ok: false, error: `[keyiyun] 素材提交失败: ${gatewayError}` };
    const assetId = json.data?.assetId || json.assetId;
    if (!assetId) {
      return {
        ok: false,
        error: `[keyiyun] 素材提交未返回 assetId: ${json.msg || json.message || text.slice(0, 200)}`,
      };
    }
    // 接口文档称两种 scheme 都兼容，但实际 Seedance 上游更稳定地识别
    // assetId://。上传成功并不代表已同步到上游，必须等详情接口返回 READY。
    return keyiyunWaitForAsset({ assetId, apiKey: input.apiKey, baseUrl: input.baseUrl });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === "AbortError"
          ? `素材提交超时 (${KEYYIYUN_ASSET_TIMEOUT_MS / 1_000}s)`
          : error.message
        : "fetch failed";
    return { ok: false, error: `[keyiyun] 素材提交网络错误: ${message}` };
  } finally {
    clearTimeout(timeout);
  }
}

function buildKeyiyunContent(input: {
  prompt: string;
  firstFrameImageUrl?: string;
  lastFrameImageUrl?: string;
  referenceImageUrls: string[];
  referenceAudioUrl?: string;
}): ContentItem[] | { error: string } {
  const { firstFrameImageUrl, lastFrameImageUrl, referenceImageUrls, referenceAudioUrl } = input;
  if (
    (firstFrameImageUrl || lastFrameImageUrl) &&
    (referenceImageUrls.length || referenceAudioUrl)
  ) {
    return { error: "[keyiyun] 首帧/首尾帧场景不能与参考图片或音频混用，请只保留一种素材模式。" };
  }
  if (lastFrameImageUrl && !firstFrameImageUrl) {
    return { error: "[keyiyun] 尾帧图片必须与首帧图片一起使用。" };
  }
  if (referenceAudioUrl && !referenceImageUrls.length) {
    return { error: "[keyiyun] 参考音频不能单独使用，至少还需要一张参考图片。" };
  }
  const content: ContentItem[] = [{ type: "text", text: input.prompt }];
  if (firstFrameImageUrl) {
    content.push({
      type: "image_url",
      role: "first_frame",
      image_url: { url: firstFrameImageUrl },
    });
  }
  if (lastFrameImageUrl) {
    content.push({ type: "image_url", role: "last_frame", image_url: { url: lastFrameImageUrl } });
  }
  for (const url of referenceImageUrls) {
    content.push({ type: "image_url", role: "reference_image", image_url: { url } });
  }
  if (referenceAudioUrl) {
    content.push({
      type: "audio_url",
      role: "reference_audio",
      audio_url: { url: referenceAudioUrl },
    });
  }
  return content;
}

async function keyiyunSubmit(input: {
  prompt: string;
  media: DashScopeMediaItem[];
  ratio?: SeedanceRatio;
  duration?: number;
  generateAudio?: boolean;
  referenceAudioUrl?: string;
  apiKey: string;
  baseUrl: string;
}): Promise<{ ok: true; taskId: string; model: string } | { ok: false; error: string }> {
  const firstFrameUrl = input.media.find((item) => item.type === "first_frame")?.url;
  const lastFrameUrl = input.media.find((item) => item.type === "last_frame")?.url;
  const referenceImageUrls = input.media
    .filter((item) => item.type === "reference_image")
    .map((item) => item.url);
  const assetPrefix = `doopoo-${Date.now()}`;
  const firstFrameAsset = await keyiyunEnsureAsset({
    url: firstFrameUrl,
    assetType: "Image",
    name: `${assetPrefix}-first-frame`,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
  });
  if (!firstFrameAsset.ok) return firstFrameAsset;
  const lastFrameAsset = await keyiyunEnsureAsset({
    url: lastFrameUrl,
    assetType: "Image",
    name: `${assetPrefix}-last-frame`,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
  });
  if (!lastFrameAsset.ok) return lastFrameAsset;
  // 服务端会主动抓取每个公网 URL；并发上传多张大图会让其中一个请求在
  // 下载队列中饿死。顺序入库更慢一点，但对 3-9 张参考图更稳定。
  const referenceAssetUrls: string[] = [];
  for (const [index, url] of referenceImageUrls.entries()) {
    const asset = await keyiyunEnsureAsset({
      url,
      assetType: "Image",
      name: `${assetPrefix}-reference-image-${index + 1}`,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
    });
    if (!asset.ok) return asset;
    if (asset.url) referenceAssetUrls.push(asset.url);
  }
  const referenceAudioAsset = await keyiyunEnsureAsset({
    url: input.referenceAudioUrl,
    assetType: "Audio",
    name: `${assetPrefix}-reference-audio`,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
  });
  if (!referenceAudioAsset.ok) return referenceAudioAsset;
  const content = buildKeyiyunContent({
    prompt: input.prompt,
    firstFrameImageUrl: firstFrameAsset.url,
    lastFrameImageUrl: lastFrameAsset.url,
    referenceImageUrls: referenceAssetUrls,
    referenceAudioUrl: referenceAudioAsset.url,
  });
  if ("error" in content) return { ok: false, error: content.error };

  const body: Record<string, unknown> = { model: KEYYIYUN_UPSTREAM_MODEL, content };
  if (input.ratio) body.ratio = input.ratio;
  if (typeof input.duration === "number") body.duration = input.duration;
  if (typeof input.generateAudio === "boolean") body.generate_audio = input.generateAudio;

  const result = await fetchSubmitWithRetry({
    url: `${input.baseUrl}/v1/seedance-special/videos`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(body),
    label: "keyiyun",
  });
  if (!result.ok) {
    return { ok: false, error: `[keyiyun] 创建任务网络错误: ${result.networkError}` };
  }
  const { status, text } = result;
  {
    if (status < 200 || status >= 300)
      return { ok: false, error: `[keyiyun] 创建任务 ${status}: ${text.slice(0, 500)}` };
    let json: KeyiyunEnvelope<{ id?: string }> & { id?: string } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    const gatewayError = keyiyunEnvelopeError(json);
    if (gatewayError) return { ok: false, error: `[keyiyun] 创建任务失败: ${gatewayError}` };
    const taskId = json.data?.id || json.id;
    if (!taskId) {
      return {
        ok: false,
        error: `[keyiyun] 创建任务未返回 id: ${json.msg || json.message || text.slice(0, 200)}`,
      };
    }
    return { ok: true, taskId, model: KEYYIYUN_UPSTREAM_MODEL };
  }
}

async function keyiyunPoll(input: {
  taskId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<PollResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${input.baseUrl}/v1/result/${encodeURIComponent(input.taskId)}`, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    if (!res.ok)
      return { ok: false, error: `[keyiyun] 查询任务 ${res.status}: ${text.slice(0, 300)}` };
    type KeyiyunResult = {
      status?: string;
      video_url?: string;
      error?: string | { message?: string };
    };
    let json: KeyiyunEnvelope<KeyiyunResult> & KeyiyunResult = {};
    try {
      json = JSON.parse(text);
    } catch {}
    const gatewayError = keyiyunEnvelopeError(json);
    if (gatewayError) return { ok: false, error: `[keyiyun] 查询任务失败: ${gatewayError}` };
    const result = json.data || json;
    const errorMessage = extractKeyiyunError(result) || extractKeyiyunError(json) || "";
    return {
      ok: true,
      status: keyiyunStatusToProgress(result.status),
      videoUrl: result.video_url || null,
      raw: { error: { message: errorMessage }, ...result },
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === "AbortError"
          ? "查询任务超时 (30s)"
          : error.message
        : "fetch failed";
    return { ok: false, error: `[keyiyun] 查询任务网络错误: ${message}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function sdrealCreateImageAsset(input: {
  url: string;
  name: string;
  apiKey: string;
  baseUrl: string;
}): Promise<{ ok: true; assetId: string } | { ok: false; error: string }> {
  // SD Real 的素材表把 URL 设成 varchar(500)。在请求前给出可诊断的错误，
  // 避免上游只返回无字段名的 SQLSTATE 22001。
  if (input.url.length > 500) {
    return {
      ok: false,
      error: `[sdreal] asset URL too long (${input.url.length}/500); reference image must be rehosted`,
    };
  }
  console.log(`[sdreal asset→] urlChars=${input.url.length} nameChars=${input.name.length}`);
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
    let json: {
      data?: { Id?: string; base_resp?: { status_code?: number; status_msg?: string } };
    } = {};
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
    return {
      ok: false,
      error: `[sdreal] asset network: ${error instanceof Error ? error.message : "fetch failed"}`,
    };
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
    (item) =>
      item.type === "first_frame" || item.type === "last_frame" || item.type === "reference_image",
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
  // SD Real Max 要求小写分辨率，例如 480p；ARK 使用的 480P 会被该接口拒绝。
  if (input.resolution) body.resolution = input.resolution.toLowerCase();
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
    if (!res.ok)
      return { ok: false, error: `[sdreal] submit ${res.status}: ${text.slice(0, 300)}` };
    let json: { task?: { id?: string; error?: string } } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    if (!json.task?.id)
      return { ok: false, error: `[sdreal] no task id: ${json.task?.error || text.slice(0, 300)}` };
    return { ok: true, taskId: json.task.id, model: input.model };
  } catch (error) {
    return {
      ok: false,
      error: `[sdreal] submit network: ${error instanceof Error ? error.message : "fetch failed"}`,
    };
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
    return {
      ok: false,
      error: `[sdreal] poll network: ${error instanceof Error ? error.message : "fetch failed"}`,
    };
  }
}

// ====================================================================
// 爻核云（Ycore Cloud）—— Seedance 2.0 统一模型
// ====================================================================

const YCORE_DEFAULT_BASE_URL = "https://yaonic.ai/v1";
const YCORE_MODEL_MAP: Record<string, string> = {
  "ycore-seedance-2-0": "seedance-2.0",
  "ycore-seedance-2-0-fast": "seedance-2.0-fast",
  "ycore-seedance-2-0-mini": "seedance-2.0-mini",
};

function getYcoreConfig() {
  return {
    apiKey: process.env.YCORE_API_KEY,
    baseUrl: (process.env.YCORE_BASE_URL || YCORE_DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

async function ycoreSubmit(input: {
  model: string;
  prompt: string;
  media: DashScopeMediaItem[];
  ratio?: SeedanceRatio;
  resolution?: string;
  duration?: number;
  generateAudio?: boolean;
  referenceVideoUrl?: string;
  referenceAudioUrl?: string;
  apiKey: string;
  baseUrl: string;
}): Promise<{ ok: true; taskId: string; model: string } | { ok: false; error: string }> {
  const upstreamModel = YCORE_MODEL_MAP[input.model];
  if (!upstreamModel) return { ok: false, error: `[ycore] 未识别的模型：${input.model}` };
  const content = buildArkContent(input.prompt, {
    firstFrameImageUrl: input.media.find((item) => item.type === "first_frame")?.url,
    lastFrameImageUrl: input.media.find((item) => item.type === "last_frame")?.url,
    referenceImageUrls: input.media
      .filter((item) => item.type === "reference_image")
      .map((item) => item.url),
    referenceVideoUrl: input.referenceVideoUrl,
    referenceAudioUrl: input.referenceAudioUrl,
  });
  // 统一模型仅允许多素材 / 自适应比例走智能时长。固定时长只提交纯文本。
  const hasReference = content.length > 1;
  if (input.duration !== undefined && (input.duration < 4 || input.duration > 15)) {
    return { ok: false, error: "[ycore] Seedance 2.0 时长必须为 4-15 秒" };
  }
  const body: Record<string, unknown> = {
    model: upstreamModel,
    content,
    resolution: (input.resolution || "720P").toLowerCase(),
    ratio: input.ratio || "16:9",
    duration: hasReference ? -1 : (input.duration ?? 5),
    n: 1,
  };
  if (typeof input.generateAudio === "boolean") body.generate_audio = input.generateAudio;
  try {
    const res = await fetch(`${input.baseUrl}/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => "");
    let json: { id?: string; task_id?: string; error?: { message?: string } } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    if (!res.ok)
      return {
        ok: false,
        error: `[ycore] 创建任务 ${res.status}: ${json.error?.message || text.slice(0, 400)}`,
      };
    const taskId = json.id || json.task_id;
    return taskId
      ? { ok: true, taskId, model: upstreamModel }
      : { ok: false, error: `[ycore] 创建任务未返回 id: ${text.slice(0, 300)}` };
  } catch (error) {
    return {
      ok: false,
      error: `[ycore] 创建任务网络错误: ${error instanceof Error ? error.message : "fetch failed"}`,
    };
  }
}

async function ycorePoll(input: {
  taskId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<PollResult> {
  try {
    const res = await fetch(`${input.baseUrl}/videos/${encodeURIComponent(input.taskId)}`, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
    });
    const text = await res.text().catch(() => "");
    if (!res.ok)
      return { ok: false, error: `[ycore] 查询任务 ${res.status}: ${text.slice(0, 300)}` };
    const json = JSON.parse(text) as {
      status?: string;
      metadata?: { url?: string };
      error?: { message?: string };
    };
    const status = seedanceStatusToProgress(json.status);
    return {
      ok: true,
      status,
      videoUrl:
        status === "succeeded"
          ? json.metadata?.url ||
            `${input.baseUrl}/videos/${encodeURIComponent(input.taskId)}/content`
          : null,
      raw: json,
    };
  } catch (error) {
    return {
      ok: false,
      error: `[ycore] 查询任务网络错误: ${error instanceof Error ? error.message : "fetch failed"}`,
    };
  }
}

// ====================================================================
// 内文 —— c/seedance-2.0
// ====================================================================

const NEIWEN_DEFAULT_BASE_URL = "https://api.neiwen.cn";

function getNeiwenConfig() {
  return {
    apiKey: process.env.NEIWEN_API_KEY,
    baseUrl: (process.env.NEIWEN_BASE_URL || NEIWEN_DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

async function neiwenSubmit(input: {
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
  if (input.duration !== undefined && (input.duration < 4 || input.duration > 15))
    return { ok: false, error: "[neiwen] 时长必须为 4-15 秒" };
  const references = [
    ...input.media.map((item) => ({
      type: "image",
      url: item.url,
      role:
        item.type === "first_frame"
          ? "reference_image"
          : item.type === "last_frame"
            ? "reference_image"
            : "reference_image",
    })),
    ...(input.referenceVideoUrl
      ? [{ type: "video", url: input.referenceVideoUrl, role: "reference_video" }]
      : []),
    ...(input.referenceAudioUrl
      ? [{ type: "audio", url: input.referenceAudioUrl, role: "reference_audio" }]
      : []),
  ];
  if (references.length > 12) return { ok: false, error: "[neiwen] 参考素材最多 12 个" };
  const body: Record<string, unknown> = {
    model: "c/seedance-2.0",
    prompt: input.prompt,
    references,
  };
  if (input.duration !== undefined) body.duration = input.duration;
  if (input.resolution) body.resolution = input.resolution.toLowerCase();
  if (input.ratio) body.ratio = input.ratio;
  if (typeof input.generateAudio === "boolean") body.generate_audio = input.generateAudio;
  if (typeof input.watermark === "boolean") body.watermark = input.watermark;
  try {
    const res = await fetch(`${input.baseUrl}/seedance/v1/videos/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => "");
    let json: { task_id?: string; error?: { message?: string } } = {};
    try {
      json = JSON.parse(text);
    } catch {}
    return res.ok && json.task_id
      ? { ok: true, taskId: json.task_id, model: "c/seedance-2.0" }
      : {
          ok: false,
          error: `[neiwen] 创建任务 ${res.status}: ${json.error?.message || text.slice(0, 400)}`,
        };
  } catch (error) {
    return {
      ok: false,
      error: `[neiwen] 创建任务网络错误: ${error instanceof Error ? error.message : "fetch failed"}`,
    };
  }
}

async function neiwenPoll(input: {
  taskId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<PollResult> {
  try {
    const res = await fetch(
      `${input.baseUrl}/seedance/v1/videos/${encodeURIComponent(input.taskId)}`,
      { headers: { Authorization: `Bearer ${input.apiKey}` } },
    );
    const text = await res.text().catch(() => "");
    if (!res.ok)
      return { ok: false, error: `[neiwen] 查询任务 ${res.status}: ${text.slice(0, 300)}` };
    const json = JSON.parse(text) as {
      status?: string;
      videoUrl?: string;
      error?: { message?: string };
    };
    return {
      ok: true,
      status: seedanceStatusToProgress(json.status),
      videoUrl: json.videoUrl || null,
      raw: json,
    };
  } catch (error) {
    return {
      ok: false,
      error: `[neiwen] 查询任务网络错误: ${error instanceof Error ? error.message : "fetch failed"}`,
    };
  }
}

type SubmitResult =
  | { ok: true; taskId: string; model: string; backend: VideoBackend; videoUrl?: string }
  | { ok: false; error: string };

async function submitVideoTask(input: SubmitInput): Promise<SubmitResult> {
  const backend = getVideoBackend(input.model);
  if (backend === "revora") {
    const { apiKey, baseUrl, model: upstreamModel } = getRevoraVideoConfig();
    if (!apiKey) return { ok: false, error: "REVORA_VIDEO_API_KEY not configured" };
    const result = await revoraSubmit({
      model: input.model,
      prompt: input.prompt,
      media: input.media,
      ratio: input.ratio,
      resolution: input.resolution,
      duration: input.duration,
      apiKey,
      baseUrl,
      upstreamModel,
    });
    return result.ok
      ? {
          ok: true,
          taskId: result.taskId,
          model: input.model,
          backend: "revora",
          videoUrl: result.videoUrl,
        }
      : result;
  }
  if (backend === "agentearth") {
    const { apiKey, baseUrl } = getAgentEarthVideoConfig();
    if (!apiKey) return { ok: false, error: "AGENTEARTH_API_KEY not configured" };
    const result = await agentEarthSeedanceSubmit({
      model: input.model,
      prompt: input.prompt,
      media: input.media,
      ratio: input.ratio,
      resolution: input.resolution,
      duration: input.duration,
      generateAudio: input.generateAudio,
      referenceVideoUrl: input.referenceVideoUrl,
      referenceAudioUrl: input.referenceAudioUrl,
      apiKey,
      baseUrl,
    });
    return result.ok
      ? {
          ok: true,
          taskId: result.taskId,
          model: input.model,
          backend: "agentearth",
        }
      : result;
  }
  if (backend === "keyiyun") {
    const { apiKey, baseUrl } = getKeyiyunConfig();
    if (!apiKey) {
      return {
        ok: false,
        error:
          "[keyiyun] 缺少 KEYYIYUN_API_KEY，请在 Cloudflare Secrets 或 .env.local 中配置后再试。",
      };
    }
    // 当前接入的是不带 `_with_video_ref` 的折扣模型；参考视频必须改用
    // 带该后缀的上游模型，避免上游返回难懂的参数错误。参考音频可与参考图搭配。
    if (input.referenceVideoUrl) {
      return {
        ok: false,
        error:
          "[keyiyun] 当前 Seedance 2.0 官方折扣版不支持参考视频；请改用带 `_with_video_ref` 的模型。",
      };
    }
    const r = await keyiyunSubmit({
      prompt: input.prompt,
      media: input.media,
      ratio: input.ratio,
      duration: input.duration,
      generateAudio: input.generateAudio,
      referenceAudioUrl: input.referenceAudioUrl,
      apiKey,
      baseUrl,
    });
    return r.ok
      ? { ok: true, taskId: r.taskId, model: input.model, backend: "keyiyun" }
      : { ok: false, error: r.error };
  }
  if (backend === "ycore") {
    const { apiKey, baseUrl } = getYcoreConfig();
    if (!apiKey)
      return {
        ok: false,
        error: "[ycore] 缺少 YCORE_API_KEY，请在 Cloudflare Secrets 或 .env.local 中配置后再试。",
      };
    const r = await ycoreSubmit({
      model: input.model,
      prompt: input.prompt,
      media: input.media,
      ratio: input.ratio,
      resolution: input.resolution,
      duration: input.duration,
      generateAudio: input.generateAudio,
      referenceVideoUrl: input.referenceVideoUrl,
      referenceAudioUrl: input.referenceAudioUrl,
      apiKey,
      baseUrl,
    });
    return r.ok ? { ok: true, taskId: r.taskId, model: input.model, backend: "ycore" } : r;
  }
  if (backend === "neiwen") {
    const { apiKey, baseUrl } = getNeiwenConfig();
    if (!apiKey)
      return {
        ok: false,
        error: "[neiwen] 缺少 NEIWEN_API_KEY，请在 Cloudflare Secrets 或 .env.local 中配置后再试。",
      };
    const r = await neiwenSubmit({
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
    return r.ok ? { ok: true, taskId: r.taskId, model: input.model, backend: "neiwen" } : r;
  }
  if (backend === "sdreal") {
    const { apiKey, baseUrl } = getSdrealConfig();
    if (!apiKey) {
      return {
        ok: false,
        error:
          "[sdreal] 缺少 SD_REAL_MAX_API_KEY，请在 Cloudflare Secrets 或 .env.local 中配置后再试。",
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
    const { apiKey, assetApiKey, assetApiKeySource, baseUrl } = getTopenrouterConfig();
    if (!apiKey) {
      return {
        ok: false,
        error:
          "[topenrouter] 缺少 TOPENROUTER_API_KEY,请在 Cloudflare Secrets 或 .env.local 中配置后再试。",
      };
    }
    if (!assetApiKey) {
      return {
        ok: false,
        error:
          "[topenrouter] 缺少 TOPENROUTER_ASSET_API_KEY / TOPENROUTER_API_KEY，无法上传参考素材。",
      };
    }
    // 参考图/视频/音频先进入 TopenRouter 素材库。真人图片直接给视频接口会触发
    // InputImageSensitiveContentDetected.PrivacyInformation；使用审核为 Active 的
    // asset:// 引用是服务商提供的规避路径。
    const firstFrameImageUrl = input.media.find((m) => m.type === "first_frame")?.url;
    const lastFrameImageUrl = input.media.find((m) => m.type === "last_frame")?.url;
    const referenceImageUrls = input.media
      .filter((m) => m.type === "reference_image")
      .map((m) => m.url);
    const assetPrefix = `doopoo-${Date.now()}`;
    const firstFrameAsset = await topenrouterEnsureAsset({
      model: input.model,
      url: firstFrameImageUrl,
      assetType: "Image",
      name: `${assetPrefix}-first-frame`,
      apiKey: assetApiKey,
      apiKeySource: assetApiKeySource,
      baseUrl,
    });
    if (!firstFrameAsset.ok) return firstFrameAsset;
    const lastFrameAsset = await topenrouterEnsureAsset({
      model: input.model,
      url: lastFrameImageUrl,
      assetType: "Image",
      name: `${assetPrefix}-last-frame`,
      apiKey: assetApiKey,
      apiKeySource: assetApiKeySource,
      baseUrl,
    });
    if (!lastFrameAsset.ok) return lastFrameAsset;
    const referenceAssets = await Promise.all(
      referenceImageUrls.map((url, index) =>
        topenrouterEnsureAsset({
          model: input.model,
          url,
          assetType: "Image",
          name: `${assetPrefix}-reference-image-${index + 1}`,
          apiKey: assetApiKey,
          apiKeySource: assetApiKeySource,
          baseUrl,
        }),
      ),
    );
    const failedReferenceAsset = referenceAssets.find((result) => !result.ok);
    if (failedReferenceAsset && !failedReferenceAsset.ok) return failedReferenceAsset;
    const referenceVideoAsset = await topenrouterEnsureAsset({
      model: input.model,
      url: input.referenceVideoUrl,
      assetType: "Video",
      name: `${assetPrefix}-reference-video`,
      apiKey: assetApiKey,
      apiKeySource: assetApiKeySource,
      baseUrl,
    });
    if (!referenceVideoAsset.ok) return referenceVideoAsset;
    const referenceAudioAsset = await topenrouterEnsureAsset({
      model: input.model,
      url: input.referenceAudioUrl,
      assetType: "Audio",
      name: `${assetPrefix}-reference-audio`,
      apiKey: assetApiKey,
      apiKeySource: assetApiKeySource,
      baseUrl,
    });
    if (!referenceAudioAsset.ok) return referenceAudioAsset;
    const content = buildArkContent(input.prompt, {
      firstFrameImageUrl: firstFrameAsset.url,
      lastFrameImageUrl: lastFrameAsset.url,
      referenceImageUrls: referenceAssets.flatMap((result) =>
        result.ok && result.url ? [result.url] : [],
      ),
      referenceVideoUrl: referenceVideoAsset.url,
      referenceAudioUrl: referenceAudioAsset.url,
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
  if (input.backend === "revora") {
    const { apiKey, baseUrl } = getRevoraVideoConfig();
    if (!apiKey) return { ok: false, error: "REVORA_VIDEO_API_KEY not configured" };
    return revoraPoll({ taskId: input.taskId, apiKey, baseUrl });
  }
  if (input.backend === "agentearth") {
    const { apiKey, baseUrl } = getAgentEarthVideoConfig();
    if (!apiKey) return { ok: false, error: "AGENTEARTH_API_KEY not configured" };
    return agentEarthSeedancePoll({ taskId: input.taskId, apiKey, baseUrl });
  }
  if (input.backend === "keyiyun") {
    const { apiKey, baseUrl } = getKeyiyunConfig();
    if (!apiKey) return { ok: false, error: "[keyiyun] 缺少 KEYYIYUN_API_KEY" };
    return keyiyunPoll({ taskId: input.taskId, apiKey, baseUrl });
  }
  if (input.backend === "ycore") {
    const { apiKey, baseUrl } = getYcoreConfig();
    if (!apiKey) return { ok: false, error: "[ycore] 缺少 YCORE_API_KEY" };
    return ycorePoll({ taskId: input.taskId, apiKey, baseUrl });
  }
  if (input.backend === "neiwen") {
    const { apiKey, baseUrl } = getNeiwenConfig();
    if (!apiKey) return { ok: false, error: "[neiwen] 缺少 NEIWEN_API_KEY" };
    return neiwenPoll({ taskId: input.taskId, apiKey, baseUrl });
  }
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

const TopenrouterAssetUploadInput = z.object({
  // 文档要求素材必须是上游可下载的公网 HTTP(S) URL，拒绝 data: / 内网地址。
  url: z
    .string()
    .url()
    .max(4_000)
    .refine((value) => /^https?:\/\//i.test(value), "素材 URL 必须为公网 HTTP(S) 地址"),
  assetType: z.enum(["Image", "Video", "Audio"]),
  name: z.string().trim().min(1).max(200).optional(),
  model: z.string().trim().min(1).max(200).default("topenrouter-doubao-seedance-2-0-mini-260615"),
});

const KeyiyunAssetUploadInput = z.object({
  // 客易云素材接口同样只接受其服务端可拉取的公网 URL。
  url: z
    .string()
    .url()
    .max(4_000)
    .refine((value) => /^https?:\/\//i.test(value), "素材 URL 必须为公网 HTTP(S) 地址"),
  assetType: z.enum(["Image", "Video", "Audio"]),
  name: z.string().trim().min(1).max(200).optional(),
});

/**
 * 将一项素材提交至客易云的 Seedance 素材库。
 * 客易云在提交成功后直接返回可复用的 asset:// 引用；该步骤也会完成上游的真人脸审核。
 */
export const uploadKeyiyunAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => KeyiyunAssetUploadInput.parse(d))
  .handler(async ({ data }) => {
    const { apiKey, baseUrl } = getKeyiyunConfig();
    if (!apiKey) {
      return { ok: false as const, error: "[keyiyun] 缺少 KEYYIYUN_API_KEY" };
    }
    const uploaded = await keyiyunEnsureAsset({
      url: data.url,
      assetType: data.assetType,
      name: data.name || `doopoo-asset-${Date.now()}`,
      apiKey,
      baseUrl,
    });
    if (!uploaded.ok || !uploaded.url) {
      return {
        ok: false as const,
        error: uploaded.ok ? "[keyiyun] 素材提交未返回素材引用" : uploaded.error,
      };
    }
    return {
      ok: true as const,
      assetUrl: uploaded.url,
      assetId: uploaded.url.replace(/^(?:asset|assetId):\/\//, ""),
    };
  });

/**
 * 手动上传一项 TopenRouter 素材并等待审核/入库完成。
 * 返回 Active 才表示可将 `asset://assetId` 放进视频 content；调用者可保存 assetId
 * 供后续视频反复引用，避免每次生成重复上传。
 */
export const uploadTopenrouterAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => TopenrouterAssetUploadInput.parse(d))
  .handler(async ({ data }) => {
    const { assetApiKey, assetApiKeySource, baseUrl } = getTopenrouterConfig();
    if (!assetApiKey) {
      return {
        ok: false as const,
        error: "[topenrouter] 缺少 TOPENROUTER_ASSET_API_KEY / TOPENROUTER_API_KEY",
      };
    }
    const uploaded = await topenrouterUploadAsset({
      model: data.model,
      url: data.url,
      assetType: data.assetType,
      name: data.name,
      apiKey: assetApiKey,
      apiKeySource: assetApiKeySource,
      baseUrl,
    });
    if (!uploaded.ok) return { ok: false as const, error: uploaded.error };
    const ready = await topenrouterWaitForAsset({
      model: data.model,
      assetId: uploaded.asset.id,
      apiKey: assetApiKey,
      baseUrl,
    });
    if (!ready.ok) return { ok: false as const, error: ready.error, assetId: uploaded.asset.id };
    return {
      ok: true as const,
      assetId: ready.asset.id,
      assetUrl: topenrouterAssetUrl(ready.asset.id),
      status: ready.asset.status || "Active",
      name: ready.asset.name,
      assetType: ready.asset.assetType,
      previewUrl: ready.asset.url,
      createTime: ready.asset.createTime,
    };
  });

const TopenrouterAssetGetInput = z.object({
  assetId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/, "非法 asset_id")
    .max(200),
  model: z.string().trim().min(1).max(200).default("topenrouter-doubao-seedance-2-0-mini-260615"),
});

/** 查询已上传素材的入库状态和临时预览 URL。 */
export const getTopenrouterAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => TopenrouterAssetGetInput.parse(d))
  .handler(async ({ data }) => {
    const { assetApiKey, baseUrl } = getTopenrouterConfig();
    if (!assetApiKey) {
      return {
        ok: false as const,
        error: "[topenrouter] 缺少 TOPENROUTER_ASSET_API_KEY / TOPENROUTER_API_KEY",
      };
    }
    const result = await topenrouterGetAsset({
      model: data.model,
      assetId: data.assetId,
      apiKey: assetApiKey,
      baseUrl,
    });
    if (!result.ok) return { ok: false as const, error: result.error };
    return {
      ok: true as const,
      assetId: result.asset.id,
      assetUrl: topenrouterAssetUrl(result.asset.id),
      status: result.asset.status || "unknown",
      name: result.asset.name,
      assetType: result.asset.assetType,
      previewUrl: result.asset.url,
      createTime: result.asset.createTime,
    };
  });

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
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => SubmitServerInput.parse(d))
  .handler(async ({ data, context }) => {
    const __t0 = Date.now();
    // ---- 积分预校验:余额不足直接拒绝,避免向外部服务白扣任务额度 ----
    {
      const { ensureEnoughCredits } = await import("./creditsGuard");
      const __model = data.model || ARK_DEFAULT_MODEL;
      const __cost = videoCost(__model, data.resolution, data.duration ?? 10);
      const __guard = await ensureEnoughCredits(__cost, {
        kind: "video",
        model: __model,
      });
      if (!__guard.ok) {
        console.warn(
          `[video×] insufficient credits model=${__model} required=${__guard.required} balance=${__guard.balance}`,
        );
        return { ok: false as const, error: __guard.error, code: "INSUFFICIENT_CREDITS" };
      }
    }
    // 把 ARK 风格的 content 数组转成统一 media + ref 形式
    const media: DashScopeMediaItem[] = [];
    let referenceVideoUrl: string | undefined;
    let referenceAudioUrl: string | undefined;
    for (const item of data.content as any[]) {
      if (item?.type === "image_url" && item?.image_url?.url) {
        const type =
          item.role === "first_frame" || item.role === "last_frame" ? item.role : "reference_image";
        media.push({ type, url: item.image_url.url });
      } else if (item?.type === "video_url" && item?.video_url?.url) {
        referenceVideoUrl = item.video_url.url;
      } else if (item?.type === "audio_url" && item?.audio_url?.url) {
        referenceAudioUrl = item.audio_url.url;
      }
    }
    const prompt = (data.content as any[]).find((i) => i?.type === "text")?.text || "";
    const model = data.model || ARK_DEFAULT_MODEL;
    const backend = getVideoBackend(model);
    const { supabase, userId } = context as { supabase: any; userId: string };

    // 与 generateVideo 保持一致：浏览器 data URI 不能直接交给上游视频接口。
    const persistedMedia: DashScopeMediaItem[] = [];
    for (const item of media) {
      if (/^(?:asset|assetId):\/\//.test(item.url)) {
        persistedMedia.push(item);
        continue;
      }
      const persisted = await persistDataUriUrl(
        item.url,
        supabase,
        userId,
        backend === "sdreal",
      );
      if (!persisted.ok) return { ok: false as const, error: persisted.error };
      persistedMedia.push({ ...item, url: persisted.url });
    }
    if (referenceVideoUrl) {
      const persisted = await persistDataUriUrl(referenceVideoUrl, supabase, userId);
      if (!persisted.ok) return { ok: false as const, error: persisted.error };
      referenceVideoUrl = persisted.url;
    }
    if (referenceAudioUrl) {
      const persisted = await persistAudioUrl(referenceAudioUrl, supabase, userId);
      if (!persisted.ok) return { ok: false as const, error: persisted.error };
      referenceAudioUrl = persisted.url;
    }

    const r = await submitVideoTask({
      model,
      prompt,
      media: persistedMedia,
      ratio: data.ratio,
      resolution: data.resolution,
      duration: data.duration,
      generateAudio: data.generateAudio,
      watermark: data.watermark,
      referenceVideoUrl,
      referenceAudioUrl,
    });
    if (!r.ok) {
      const backend = getVideoBackend(model);
      import("./errorLogs.server").then(({ logGenerationError }) =>
        logGenerationError({
          kind: "video",
          provider: backend,
          model,
          durationMs: Date.now() - __t0,
          requestPayload: {
            model,
            prompt,
            ratio: data.ratio,
            resolution: data.resolution,
            duration: data.duration,
            generateAudio: data.generateAudio,
            watermark: data.watermark,
            media,
            referenceVideoUrl,
            referenceAudioUrl,
          },
          responseBody: r.error,
          errorMessage: r.error,
        }),
      );
      return { ok: false as const, error: r.error };
    }
    return {
      ok: true as const,
      taskId: r.taskId,
      model: r.model,
      backend: r.backend,
      ...(r.videoUrl && { videoUrl: r.videoUrl }),
    };
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
    "keyiyun",
    "agentearth",
    "revora",
    "ycore",
    "neiwen",
  ]),
});

export const pollVideoTaskFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => PollServerInput.parse(d))
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
 * 将参考素材重托管到 Supabase Storage `workspace-media`,返回公开对象 URL。
 *
 * 背景:生图函数(azure/lovable/openrouter/pixflow 等)常返回
 *   data:image/png;base64,... 形式的 URL,单条可达数 MB。前端把这些 data URI
 *   当参考图传给视频生成,会导致请求体过大(kuaizi 落库触发 22001)或被后端拒绝。
 *   在 generateVideo 入口统一转换,所有后端收到干净 https URL。
 *
 *   - data: URI → 上传 Storage → 公开 URL
 *   - http(s) URL 默认原样返回；SD Real Max 因素材 URL 仅支持 500 字符而强制重托管
 *   - 上传失败 → ok:false,由调用方中止流程(避免继续发大请求体)
 */
async function persistDataUriUrl(
  url: string,
  supabase: any,
  userId: string,
  forceRehost = false,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  // SD Real Max 将素材 URL 落入 varchar(500)。即使输入本身是 https（例如历史
  // Supabase 签名 URL 或第三方临时 URL），也必须重新托管为短的公开对象 URL。
  if (!url || (!url.startsWith("data:") && !forceRehost)) return { ok: true, url };
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
    // workspace-media 为私有 bucket：供应商只能拿到限时签名 URL（7 天），
    // 避免对象被任何知道路径的人无鉴权下载。
    const { data: signed, error: signErr } = await supabase.storage
      .from("workspace-media")
      .createSignedUrl(path, 604_800);
    if (signErr || !signed?.signedUrl)
      return { ok: false, error: "参考图上传失败: 未取到访问 URL" };
    const probe = await fetch(signed.signedUrl, {
      headers: { Range: "bytes=0-1" },
      redirect: "follow",
    });
    if (!probe.ok) {
      return {
        ok: false,
        error: `参考图转存后仍不可读取 (${probe.status})；请联系管理员检查 workspace-media 存储配置。`,
      };
    }
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
    const isDoopooHost = ["doopoo.ai", "www.doopoo.ai", "test.doopoo.ai"].includes(parsed.hostname);
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
    // workspace-media 为私有 bucket：下发 7 天有效期的签名 URL 供 ARK 拉取，
    // 过期后对象不再可被任意访问。
    const { data: signed, error: signErr } = await supabase.storage
      .from("workspace-media")
      .createSignedUrl(path, 604_800);
    if (signErr || !signed?.signedUrl)
      return { ok: false, error: "参考音频转存失败: 未取到访问 URL" };
    // 在发给 ARK 前以匿名请求验证签名对象确实可被下载。
    const probe = await fetch(signed.signedUrl, {
      headers: { Range: "bytes=0-1" },
      redirect: "follow",
    });
    if (!probe.ok) {
      return {
        ok: false,
        error: `参考音频转存后仍不可读取 (${probe.status})；请重试或联系管理员检查 workspace-media 存储配置。`,
      };
    }
    return { ok: true, url: signed.signedUrl };
  } catch (e: any) {
    return { ok: false, error: `参考音频转存失败: ${e?.message ?? String(e)}` };
  }
}

/**
 * Video generation accepts media returned by older image providers in the
 * `data:<mime>;base64,...` form. Do not put a character cap on it: a normal
 * image data URI is often several MB. `generateVideo` immediately rehosts it
 * before passing the request on to a video provider.
 */
function isBase64MediaDataUri(value: string): boolean {
  const comma = value.indexOf(",");
  if (comma <= 5 || comma === value.length - 1) return false;
  const metadata = value.slice(5, comma);
  return /^(?:image|video|audio)\/[a-z0-9.+-]+(?:;[^;,=]+=[^;,]+)*;base64$/i.test(metadata);
}

function isHttpMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * 轮询 succeeded 分支的裁决：有可用 videoUrl 才放行（随后才扣费）；
 * 空 URL 按失败处理，不进入扣费路径。导出供单测覆盖。
 */
export function verdictForSucceededPoll(
  backend: string,
  videoUrl: string | null | undefined,
): { ok: true; videoUrl: string } | { ok: false; error: string } {
  const url = typeof videoUrl === "string" ? videoUrl.trim() : "";
  if (!url) {
    return {
      ok: false,
      error: `[${backend}] 任务已完成但没有返回可播放的结果 URL`,
    };
  }
  return { ok: true, videoUrl: url };
}

const ExternalVideoMediaUrl = z
  .string()
  .min(1)
  .refine(
    (value) => isHttpMediaUrl(value) || isBase64MediaDataUri(value),
    "素材必须为公网 HTTP(S) URL 或 base64 data URI",
  );

const VideoMediaUrl = z
  .string()
  .min(1)
  .refine(
    (value) =>
      /^(?:asset|assetId):\/\/[a-zA-Z0-9_-]+$/.test(value) ||
      isHttpMediaUrl(value) ||
      isBase64MediaDataUri(value),
    "素材必须为公网 HTTP(S) URL、base64 data URI、asset://asset_id 或 assetId://asset_id",
  );

const GenerateVideoInput = z.object({
  prompt: z.string().min(1),
  // 单张图生视频(图作为首帧 / 参考图)
  imageUrl: VideoMediaUrl.optional(),
  // 尾帧图(仅 2 张分镜图生成时使用,首帧+尾帧模式)
  lastFrameImageUrl: VideoMediaUrl.optional(),
  referenceImageUrls: z.array(VideoMediaUrl).max(9).optional(),
  referenceVideoUrl: ExternalVideoMediaUrl.optional(),
  referenceAudioUrl: ExternalVideoMediaUrl.optional(),
  model: z.string().max(200).optional(),
  ratio: z.enum(SUPPORTED_RATIOS).default("16:9"),
  duration: z.number().int().min(1).max(60).default(5), // ARK 示例最大 11s,这里留余量到 60
  resolution: z.enum(["480P", "720P", "1080P"]).default("720P"),
  generateAudio: z.boolean().optional(),
  watermark: z.boolean().optional(),
  onProgress: z.function().optional(),
});

export type GenerateVideoInputType = z.infer<typeof GenerateVideoInput>;

export const generateVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => GenerateVideoInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const backend = getVideoBackend(data.model);
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
                : backend === "keyiyun"
                  ? "keyiyun-sd-2-0-fast-discount-720p"
                  : backend === "ycore"
                    ? "ycore-seedance-2-0-fast"
                    : backend === "neiwen"
                      ? "neiwen-c-seedance-2-0"
                      : "happyhorse-1.0-i2v");

    // ---- 积分预校验:与 submitVideoTaskFn 同口径,按最终路由 model 计费 ----
    {
      const { ensureEnoughCredits } = await import("./creditsGuard");
      const __cost = videoCost(model, data.resolution, data.duration);
      const __guard = await ensureEnoughCredits(__cost, {
        kind: "video",
        model,
      });
      if (!__guard.ok) {
        console.warn(
          `[video×] insufficient credits model=${model} required=${__guard.required} balance=${__guard.balance}`,
        );
        return {
          ok: false as const,
          error: __guard.error,
          code: "INSUFFICIENT_CREDITS",
          taskId: undefined,
          backend,
        };
      }
    }

    const media: DashScopeMediaItem[] = [];
    if (data.imageUrl) media.push({ type: "first_frame", url: data.imageUrl });
    if (data.lastFrameImageUrl) media.push({ type: "last_frame", url: data.lastFrameImageUrl });
    if (data.referenceImageUrls?.length) {
      for (const url of data.referenceImageUrls) media.push({ type: "reference_image", url });
    }

    // data: URI → 签名 URL:生图函数常返回 base64 data URI(单条数 MB),直接发给后端
    // 会撑爆请求体(kuaizi 落库 22001)或被后端拒绝。并行上传后替换成 https URL。
    const persistedMedia: DashScopeMediaItem[] = [];
    for (const m of media) {
      // asset:// 是同一渠道素材库的稳定引用，不能再下载或转存；也绝不允许跨渠道复用。
      if (/^(?:asset|assetId):\/\//.test(m.url)) {
        if (backend !== "topenrouter" && backend !== "keyiyun") {
          return {
            ok: false as const,
            error: `[${backend}] 不能使用其他渠道的 asset:// 素材引用`,
            taskId: undefined,
            backend,
          };
        }
        if (backend === "topenrouter" && m.url.startsWith("assetId://")) {
          return {
            ok: false as const,
            error: "[topenrouter] 不能使用客易云的 assetId:// 素材引用",
            taskId: undefined,
            backend,
          };
        }
        persistedMedia.push(m);
        continue;
      }
      const r = await persistDataUriUrl(m.url, supabase, userId, backend === "sdreal");
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

    console.log(
      `[video→] backend=${backend} model=${model} promptChars=${data.prompt.length} images=${persistedMedia.length} videoRef=${referenceVideoUrl ? 1 : 0} audioRef=${referenceAudioUrl ? 1 : 0} ratio=${data.ratio} resolution=${data.resolution} duration=${data.duration}`,
    );
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
      console.warn(`[video×] backend=${backend} model=${model} submit=${submit.error}`);
      return { ok: false as const, error: submit.error, taskId: undefined, backend };
    }
    console.log(
      `[video✓] queued backend=${submit.backend} taskId=${submit.taskId} model=${submit.model}`,
    );

    data.onProgress?.("queued", { taskId: submit.taskId, backend });

    // 少数旧后端会在提交时直接返回 MP4；AgentEarth 等正常走下面的异步轮询。
    if (submit.videoUrl) {
      data.onProgress?.("succeeded", {
        taskId: submit.taskId,
        videoUrl: submit.videoUrl,
        backend: submit.backend,
      });
      const cost = videoCost(submit.model, data.resolution, data.duration);
      if (cost != null) {
        await chargeCredits(supabase, userId, {
          amount: cost,
          model: submit.model,
          resolution: data.resolution,
          duration: data.duration,
          description: "视频生成",
        });
      }
      return {
        ok: true as const,
        taskId: submit.taskId,
        videoUrl: submit.videoUrl,
        model: submit.model,
        backend: submit.backend,
      };
    }

    // 2) 轮询
    // 视频任务统一每分钟查询一次，避免集中请求打满供应商任务接口。
    const pollInterval = 60_000;
    // 视频任务由供应商异步执行；只要不是明确失败/取消，就持续轮询，
    // 不再用本地 5 分钟 deadline 把仍在生成的任务错误标记为失败。
    while (true) {
      await sleep(pollInterval);
      const poll = await pollVideoTask({ taskId: submit.taskId, backend: submit.backend });
      if (!poll.ok) {
        console.warn(
          `[video×] poll backend=${submit.backend} taskId=${submit.taskId} status=${poll.status || "network"} error=${poll.error}`,
        );
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
      console.log(
        `[video⟳] backend=${submit.backend} taskId=${submit.taskId} status=${poll.status}`,
      );
      if (poll.status === "succeeded") {
        // 空 videoUrl 按失败处理：不扣费，返回明确错误。
        const verdict = verdictForSucceededPoll(submit.backend, poll.videoUrl);
        if (!verdict.ok) {
          console.warn(
            `[video×] backend=${submit.backend} taskId=${submit.taskId} succeeded but empty videoUrl`,
          );
          return {
            ok: false as const,
            error: verdict.error,
            taskId: submit.taskId,
            backend: submit.backend,
            lastStatus: poll.status,
          };
        }
        data.onProgress?.("succeeded", {
          taskId: submit.taskId,
          videoUrl: verdict.videoUrl,
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
        console.log(`[video✓] completed backend=${submit.backend} taskId=${submit.taskId}`);
        return {
          ok: true as const,
          taskId: submit.taskId,
          videoUrl: verdict.videoUrl,
          model: submit.model,
          backend: submit.backend,
        };
      }
      if (poll.status === "failed" || poll.status === "cancelled") {
        const raw = (poll as any).raw;
        const errMsg =
          raw?.error?.message || raw?.output?.error_message || `${poll.status} (no error detail)`;
        console.warn(
          `[video×] completed backend=${submit.backend} taskId=${submit.taskId} status=${poll.status} error=${errMsg}`,
        );
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
