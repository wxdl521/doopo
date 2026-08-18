/**
 * 视频素材库预审的共享纯函数。
 *
 * 背景：真人参考图直接以公网 URL 放进视频任务的 content[]，会触发上游
 * `InputImageSensitiveContentDetected.PrivacyInformation` 风控。官方规避路径是
 * 先把素材登记进渠道素材库，审核为 Active 后用 `asset://<id>` 引用提交。
 * 工作区（角色/场景/道具详情页）与转绘页共用这里的判定与降级逻辑。
 */

export type VideoAssetLibrarySupport = {
  supported: boolean;
  message: string;
};

/**
 * 判断视频模型对应的后端是否支持素材库预审。
 * 已接入素材登记通道的后端：TopenRouter / 客易云 / 筷子丽帧 / 诘云。
 */
export function getVideoAssetLibrarySupport(model: string | undefined): VideoAssetLibrarySupport {
  if (!model?.trim()) {
    return { supported: false, message: "请先在项目设置中选择视频模型。" };
  }
  if (
    model.startsWith("topenrouter-doubao-seedance-") ||
    model.startsWith("kuaizi-lizhen-") ||
    // Seedance 2.5(model-center)参考素材直传公网 URL,无 asset:// 素材体系
    (model.startsWith("keyiyun-") && !model.startsWith("keyiyun-seedance-2-5")) ||
    model.startsWith("jieyun-") ||
    model.startsWith("tokenpony-")
  ) {
    return { supported: true, message: "" };
  }
  return {
    supported: false,
    message: `${model} 暂不支持真人脸审核。`,
  };
}

export type VideoAssetVendor = "topenrouter" | "keyiyun" | "kuaizi" | "jieyun" | "tokenpony";

/**
 * 素材库参考视频时长约束：TopenRouter 素材库要求 1.8–30.2 秒，
 * 统一按 1.8–30 秒夹取（分钟级原片必须先裁片段再入库，否则 400）。
 * 客易云 / 筷子丽帧 / 诘云复用同一约束与裁剪降级路径。
 */
export const REFERENCE_VIDEO_MIN_SECONDS = 1.8;
export const REFERENCE_VIDEO_MAX_SECONDS = 30;
export const REFERENCE_VIDEO_MIN_MS = 1_800;
export const REFERENCE_VIDEO_MAX_MS = 30_000;

/**
 * ARK Seedance 直连（doubao-seedance-*，r2v 模式）参考视频限制 2–15 秒，
 * 与素材库通道（1.8–30 秒）不同：分钟级原片直传会触发上游
 * 「duration ... not valid ... in r2v」等校验失败，必须先裁片段。
 */
export const ARK_R2V_REFERENCE_VIDEO_MIN_MS = 2_000;
export const ARK_R2V_REFERENCE_VIDEO_MAX_MS = 15_000;

/** 返回模型对应的素材库供应商；不支持素材库时返回 null。 */
export function assetLibraryVendorForModel(model: string | undefined): VideoAssetVendor | null {
  if (!model?.trim()) return null;
  if (model.startsWith("topenrouter-doubao-seedance-")) return "topenrouter";
  // Seedance 2.5(model-center)直传公网 URL,不走素材库登记
  if (model.startsWith("keyiyun-") && !model.startsWith("keyiyun-seedance-2-5")) return "keyiyun";
  if (model.startsWith("kuaizi-lizhen-")) return "kuaizi";
  if (model.startsWith("jieyun-")) return "jieyun";
  if (model.startsWith("tokenpony-")) return "tokenpony";
  return null;
}

/** ARK Seedance 直连模型（doubao-seedance-* 无前缀），r2v 参考视频限 2–15 秒。 */
export function isArkSeedanceDirectModel(model: string | undefined): boolean {
  return !!model?.trim().startsWith("doubao-seedance-");
}

/**
 * 各通道参考视频时长约束：素材库通道 1.8–30s；诘云素材登记视频限 2–15s
 * （jieyun 文档,超过会被登记拒,2026-08 实测其 r2v 同口径）；ARK Seedance
 * 直连 2–15s；其它后端无约束（返回 null，维持整片提交的旧行为）。
 */
export function referenceVideoLimitsForModel(
  model: string | undefined,
): { minMs: number; maxMs: number } | null {
  // 诘云/tokenpony 特例必须先于素材库通用档（其文档约束 2-15s,严于 TopenRouter 的 1.8-30s）
  if (model?.trim().startsWith("jieyun-") || model?.trim().startsWith("tokenpony-")) {
    return { minMs: JIEYUN_REFERENCE_VIDEO_MIN_MS, maxMs: JIEYUN_REFERENCE_VIDEO_MAX_MS };
  }
  if (assetLibraryVendorForModel(model)) {
    return { minMs: REFERENCE_VIDEO_MIN_MS, maxMs: REFERENCE_VIDEO_MAX_MS };
  }
  if (isArkSeedanceDirectModel(model)) {
    return { minMs: ARK_R2V_REFERENCE_VIDEO_MIN_MS, maxMs: ARK_R2V_REFERENCE_VIDEO_MAX_MS };
  }
  return null;
}

// 诘云/tokenpony 参考视频约束：素材登记与 r2v 生成同口径 2-15s（文档/实测）。
const JIEYUN_REFERENCE_VIDEO_MIN_MS = 2_000;
const JIEYUN_REFERENCE_VIDEO_MAX_MS = 15_000;

/**
 * 各通道 r2v 生成时长约束（秒）：默认 2–15s（ARK 直连/TopenRouter 既有口径,
 * TopenRouter 15.2s 上限夹到 15 不受影响）；诘云实测 invalid_seconds 要求
 * 4–15s（低于 4 同样拒绝,比 TopenRouter 更严）。
 */
export function r2vDurationLimitsForModel(model: string | undefined): {
  minSec: number;
  maxSec: number;
} {
  if (model?.trim().startsWith("jieyun-")) return { minSec: 4, maxSec: 15 };
  // tokenpony Seedance 2.5:duration 4-15s(官方文档)
  if (model?.trim().startsWith("tokenpony-")) return { minSec: 4, maxSec: 15 };
  return { minSec: 2, maxSec: 15 };
}

/**
 * 转绘项目级素材审核缓存的键。asset:// 引用不能跨渠道复用，
 * 因此键里必须带供应商，同一 URL 换渠道后重新入库。
 */
export function restyleAssetCacheKey(vendor: VideoAssetVendor, url: string): string {
  return `${vendor}\n${url}`;
}

/** 上游真人风控/素材敏感类报错。 */
export function isSensitiveContentError(error: string): boolean {
  return (
    /InputImageSensitiveContentDetected/i.test(error) ||
    /PrivacyInformation/i.test(error) ||
    /may contain real person/i.test(error) ||
    /真实人物|真人|敏感内容/.test(error)
  );
}

/** 从上游报错中解析被点名的 content[n] 下标（去重、升序）。 */
export function parseRejectedContentIndexes(error: string): number[] {
  const indexes = new Set<number>();
  for (const match of error.matchAll(/content\[(\d+)\]/g)) {
    indexes.add(Number.parseInt(match[1], 10));
  }
  return [...indexes].sort((a, b) => a - b);
}

// ---------- 转绘提交内容与降级链 ----------

export type RestyleSubmitContentItem =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string };
      role?: "first_frame" | "reference_image";
    }
  | { type: "video_url"; video_url: { url: string }; role?: "reference_video" };

/**
 * 降级阶段：
 * - full：首帧 + 全部参考图 + 参考视频；
 * - without-rejected：剔除被风控/审核点名的参考图后重投（可重复）；
 * - first-frame：只保留首帧图；
 * - text-video：仅文本 + 参考视频。
 */
export type RestyleFallbackStage = "full" | "without-rejected" | "first-frame" | "text-video";

/**
 * 拼装转绘视频任务的 content 数组。约定 imageUrls[0] 充当首帧
 * （role=first_frame），其余为 reference_image；参考视频固定在末尾，
 * 因此 content[0] 是文本、content[1..n] 是图片 —— 与上游报错里的
 * content[n] 下标一致。
 */
export function buildRestyleVideoContent(input: {
  prompt: string;
  /** 已通过剔除与 asset:// 映射的图片 URL，首帧在 index 0。 */
  imageUrls: string[];
  referenceVideoUrl?: string;
  stage: RestyleFallbackStage;
}): RestyleSubmitContentItem[] {
  const images =
    input.stage === "text-video"
      ? []
      : input.stage === "first-frame"
        ? input.imageUrls.slice(0, 1)
        : input.imageUrls;
  const content: RestyleSubmitContentItem[] = [{ type: "text", text: input.prompt }];
  for (const [index, url] of images.entries()) {
    content.push({
      type: "image_url",
      image_url: { url },
      role: index === 0 ? "first_frame" : "reference_image",
    });
  }
  if (input.referenceVideoUrl) {
    content.push({
      type: "video_url",
      video_url: { url: input.referenceVideoUrl },
      role: "reference_video",
    });
  }
  return content;
}

/** 把报错里的 content[n] 下标映射回对应的图片 URL（按提交时的 content 顺序）。 */
export function rejectedImageUrlsFromError(
  error: string,
  content: RestyleSubmitContentItem[],
): string[] {
  const urls: string[] = [];
  for (const index of parseRejectedContentIndexes(error)) {
    const item = content[index];
    if (item?.type === "image_url" && !urls.includes(item.image_url.url)) {
      urls.push(item.image_url.url);
    }
  }
  return urls;
}

export type RestyleFallbackPlan = {
  stage: RestyleFallbackStage;
  /** 本次新剔除的图片 URL（按提交时 content 里的 URL 口径，调用方自行映射回原始 URL）。 */
  dropUrls: string[];
  /** 写入任务日志的说明。 */
  message: string;
};

/**
 * r2v 时长类错误（提交或轮询阶段通用判定）：
 * 「duration not valid ... in r2v」这类 400 在提交时未爆、执行阶段才爆的
 * 情况也进同一降档链；内容审核类错误不误判（审核类换时长重投无意义）。
 */
export function isR2vDurationError(error: string | undefined | null): boolean {
  if (!error) return false;
  if (isSensitiveContentError(error)) return false;
  return /r2v/i.test(error) && /duration|时长/i.test(error);
}

/**
 * 轮询原始 payload 的失败明细提取：各后端结构不同（TopenRouter/ARK/即梦），
 * 按错误语义键（fail_reason / error_message / message / error / msg / reason）
 * 逐层下探；取不到返回 undefined（调用方回退到任务状态原文）。
 */
export function extractPollFailureDetail(raw: unknown): string | undefined {
  const ERROR_KEYS = ["fail_reason", "failure_reason", "error_message", "message", "error", "msg", "reason"];
  const visit = (value: unknown, depth: number): string | undefined => {
    if (depth > 3 || !value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    for (const key of ERROR_KEYS) {
      const entry = record[key];
      if (typeof entry === "string" && entry.trim()) return entry;
      if (entry && typeof entry === "object") {
        const nested = visit(entry, depth + 1);
        if (nested) return nested;
      }
    }
    for (const entry of Object.values(record)) {
      if (entry && typeof entry === "object") {
        const nested = visit(entry, depth + 1);
        if (nested) return nested;
      }
    }
    return undefined;
  };
  const detail = visit(raw, 0);
  return detail ? detail.slice(0, 300) : undefined;
}

/**
 * r2v 时长类 400 的降档序列（TopenRouter 中转 ARK Seedance 的
 * 「duration not valid in r2v」回归）：
 * 1. 先贴参考片段实际时长——r2v 模式生成时长不得超过参考视频时长，
 *    分段时长（≤15s）可能大于裁剪后参考片段（如旧项目 30s 段被裁上限、
 *    或分段区间被场景分组压缩），贴齐参考时长是最可能合法的档；
 * 2. 再按安全离散档下探（部分网关只接受离散档，10s 也可能被拒）；
 * 3. 全部用尽后由调用方走「移除参考视频重投」（既有降级链）。
 * 返回去重后严格小于 currentSec 的降档序列（已按候选原序排好）。
 * limits 按渠道分档（r2vDurationLimitsForModel）：诘云 4-15s（低于 4 也拒），
 * 缺省 2-15s 保持 TopenRouter/ARK 直连既有口径。
 */
export function r2vDurationRetryLadder(
  currentSec: number,
  referenceSec?: number,
  limits: { minSec: number; maxSec: number } = { minSec: 2, maxSec: 15 },
): number[] {
  const clamp = (value: number) =>
    Math.max(limits.minSec, Math.min(limits.maxSec, Math.round(value)));
  const candidates = [referenceSec, 10, 8, 6, 5, 4]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .map(clamp)
    .filter((value) => value >= limits.minSec);
  return [...new Set(candidates.filter((value) => value < currentSec))];
}

/**
 * 提交被拒后决定下一步降级动作；返回 null 表示降级链已穷尽，应判失败。
 * 只有真人风控/素材敏感类错误才进入降级链，其它错误由调用方直接判失败。
 */
export function planRestyleFallback(input: {
  stage: RestyleFallbackStage;
  error: string;
  content: RestyleSubmitContentItem[];
  /** 已剔除过的图片 URL（与 content 里的 URL 同一口径）。 */
  droppedUrls: readonly string[];
}): RestyleFallbackPlan | null {
  if (!isSensitiveContentError(input.error)) return null;
  const newlyRejected = rejectedImageUrlsFromError(input.error, input.content).filter(
    (url) => !input.droppedUrls.includes(url),
  );
  // 还能点名到新的参考图：剔除后继续重投（无论当前处于哪个带图阶段）。
  if (newlyRejected.length > 0 && input.stage !== "text-video") {
    return {
      stage: "without-rejected",
      dropUrls: newlyRejected,
      message: `参考图被真人风控拦截，已剔除 ${newlyRejected.length} 张后重投。`,
    };
  }
  if (input.stage === "full" || input.stage === "without-rejected") {
    return {
      stage: "first-frame",
      dropUrls: [],
      message: "参考图仍被拦截，降级为只保留首帧图重投。",
    };
  }
  if (input.stage === "first-frame") {
    return {
      stage: "text-video",
      dropUrls: [],
      message: "首帧图仍被拦截，降级为仅文本 + 参考视频重投。",
    };
  }
  return null;
}

/** 降级链穷尽后的可操作失败文案。 */
export const RESTYLE_FALLBACK_EXHAUSTED_MESSAGE =
  "参考图被判定为真实人物且素材预审未通过，请把该角色图换成更风格化（非写实）的版本，或改用支持素材库的视频模型";
