import { describe, expect, it } from "vitest";
import {
  assetLibraryVendorForModel,
  buildRestyleVideoContent,
  extractPollFailureDetail,
  getVideoAssetLibrarySupport,
  isR2vDurationError,
  isSensitiveContentError,
  parseRejectedContentIndexes,
  planRestyleFallback,
  r2vDurationRetryLadder,
  rejectedImageUrlsFromError,
  restyleAssetCacheKey,
  RESTYLE_FALLBACK_EXHAUSTED_MESSAGE,
} from "../videoAssetLibrary";

const ARK_400 =
  '[ark-seedance] submit 400: {"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation","message":"The request failed because the input image \'content[2]\' \'content[3]\' may contain real person.","param":"content[2]","type":"BadRequest"}}';

describe("getVideoAssetLibrarySupport", () => {
  it("topenrouter / 客易云 / 筷子丽帧模型支持素材库预审", () => {
    expect(getVideoAssetLibrarySupport("topenrouter-doubao-seedance-2-0-fast-260128").supported).toBe(
      true,
    );
    expect(getVideoAssetLibrarySupport("keyiyun-sd-2-0-fast-discount-720p").supported).toBe(true);
    expect(getVideoAssetLibrarySupport("kuaizi-lizhen-fast").supported).toBe(true);
  });

  it("ARK 原生与其它模型不支持，未选模型时给出提示", () => {
    expect(getVideoAssetLibrarySupport("doubao-seedance-2-0-fast-260128").supported).toBe(false);
    expect(getVideoAssetLibrarySupport("hongmeng-seedance2-fast").supported).toBe(false);
    expect(getVideoAssetLibrarySupport(undefined).supported).toBe(false);
    expect(getVideoAssetLibrarySupport("").message).toContain("视频模型");
  });

  it("assetLibraryVendorForModel 与支持判定保持一致", () => {
    expect(assetLibraryVendorForModel("topenrouter-doubao-seedance-2-0-260128")).toBe(
      "topenrouter",
    );
    expect(assetLibraryVendorForModel("keyiyun-sd-2-0-fast-discount-720p")).toBe("keyiyun");
    expect(assetLibraryVendorForModel("kuaizi-lizhen-pro")).toBe("kuaizi");
    expect(assetLibraryVendorForModel("doubao-seedance-2-0-260128")).toBeNull();
  });
});

describe("isSensitiveContentError", () => {
  it("识别上游真人风控报错", () => {
    expect(isSensitiveContentError(ARK_400)).toBe(true);
    expect(isSensitiveContentError("[topenrouter] asset xxx 入库失败 (Failed)")).toBe(false);
    expect(isSensitiveContentError("[ark-seedance] network: submit timeout (60s)")).toBe(false);
  });
});

describe("parseRejectedContentIndexes", () => {
  it("解析报错里的 content[n] 下标并去重升序", () => {
    expect(parseRejectedContentIndexes(ARK_400)).toEqual([2, 3]);
    expect(parseRejectedContentIndexes("content[5] then content[1] and content[5]")).toEqual([
      1, 5,
    ]);
    expect(parseRejectedContentIndexes("no index here")).toEqual([]);
  });
});

describe("buildRestyleVideoContent", () => {
  const base = {
    prompt: "保持剧情转绘",
    imageUrls: ["https://img/0.png", "https://img/1.png", "asset://abc"],
    referenceVideoUrl: "https://video/ref.mp4",
  };

  it("full：文本 + 首帧 + 参考图 + 参考视频", () => {
    const content = buildRestyleVideoContent({ ...base, stage: "full" });
    expect(content[0]).toEqual({ type: "text", text: "保持剧情转绘" });
    expect(content[1]).toMatchObject({ type: "image_url", role: "first_frame" });
    expect(content[2]).toMatchObject({ type: "image_url", role: "reference_image" });
    expect(content[3]).toMatchObject({ type: "image_url", role: "reference_image" });
    expect(content[4]).toMatchObject({ type: "video_url", role: "reference_video" });
  });

  it("first-frame：只保留首帧；text-video：仅文本 + 参考视频", () => {
    const firstFrame = buildRestyleVideoContent({ ...base, stage: "first-frame" });
    expect(firstFrame.filter((item) => item.type === "image_url")).toHaveLength(1);
    const textVideo = buildRestyleVideoContent({ ...base, stage: "text-video" });
    expect(textVideo.filter((item) => item.type === "image_url")).toHaveLength(0);
    expect(textVideo.at(-1)).toMatchObject({ type: "video_url" });
  });
});

describe("rejectedImageUrlsFromError", () => {
  it("把 content[n] 下标映射回图片 URL，文本与视频下标不算", () => {
    const content = buildRestyleVideoContent({
      prompt: "p",
      imageUrls: ["https://img/0.png", "https://img/1.png", "https://img/2.png"],
      referenceVideoUrl: "https://video/ref.mp4",
      stage: "full",
    });
    // content[2]/content[3] 是第 2、3 张图
    expect(rejectedImageUrlsFromError(ARK_400, content)).toEqual([
      "https://img/1.png",
      "https://img/2.png",
    ]);
    // content[4] 是参考视频，content[0] 是文本
    expect(
      rejectedImageUrlsFromError("input image 'content[0]' 'content[4]' may contain real person", content),
    ).toEqual([]);
  });
});

describe("planRestyleFallback", () => {
  const content = buildRestyleVideoContent({
    prompt: "p",
    imageUrls: ["https://img/0.png", "https://img/1.png"],
    referenceVideoUrl: "https://video/ref.mp4",
    stage: "full",
  });

  it("非风控错误不进入降级链", () => {
    expect(
      planRestyleFallback({
        stage: "full",
        error: "[ark-seedance] network: submit timeout (60s)",
        content,
        droppedUrls: [],
      }),
    ).toBeNull();
  });

  it("点名到新参考图时剔除重投，已剔除过的图不重复剔除", () => {
    const plan = planRestyleFallback({
      stage: "full",
      error: ARK_400,
      content,
      droppedUrls: [],
    });
    // ARK_400 点名 content[2] => 第二张图
    expect(plan).toMatchObject({ stage: "without-rejected", dropUrls: ["https://img/1.png"] });
    const again = planRestyleFallback({
      stage: "without-rejected",
      error: ARK_400,
      content,
      droppedUrls: ["https://img/1.png"],
    });
    expect(again).toMatchObject({ stage: "first-frame", dropUrls: [] });
  });

  it("降级链：without-rejected → first-frame → text-video → 穷尽", () => {
    const sensitive = "may contain real person";
    const toFirstFrame = planRestyleFallback({
      stage: "without-rejected",
      error: sensitive,
      content,
      droppedUrls: [],
    });
    expect(toFirstFrame?.stage).toBe("first-frame");
    const toTextVideo = planRestyleFallback({
      stage: "first-frame",
      error: sensitive,
      content,
      droppedUrls: [],
    });
    expect(toTextVideo?.stage).toBe("text-video");
    expect(
      planRestyleFallback({ stage: "text-video", error: sensitive, content, droppedUrls: [] }),
    ).toBeNull();
    expect(RESTYLE_FALLBACK_EXHAUSTED_MESSAGE).toContain("素材预审未通过");
  });
});

describe("restyleAssetCacheKey", () => {
  it("键带供应商前缀，跨渠道不复用", () => {
    const url = "https://img/0.png";
    expect(restyleAssetCacheKey("topenrouter", url)).not.toBe(
      restyleAssetCacheKey("keyiyun", url),
    );
    expect(restyleAssetCacheKey("topenrouter", url)).toContain(url);
  });
});


// --------------------------------------------------------------------
// r2vDurationRetryLadder（r2v duration 400 降档回归）
// --------------------------------------------------------------------

describe("r2vDurationRetryLadder", () => {
  it("参考片段时长优先（-0.3s 安全边距）：15s 段 + 8s 参考 → 7.7s 档在前，离散档随后", () => {
    expect(r2vDurationRetryLadder(15, 8)).toEqual([7.7, 10, 8, 6, 5, 4]);
  });

  it("边距档 0.1s 精度向下取整（整数取整会把 0.3s 边距抹掉）", () => {
    // 15.08s 参考 → 请求 ≤14.8（上游按元数据判定,名义区间可能虚高几百毫秒）
    expect(r2vDurationRetryLadder(15, 15.08)).toEqual([14.7, 10, 8, 6, 5, 4]);
    expect(r2vDurationRetryLadder(15, 8.4)).toEqual([8.1, 10, 8, 6, 5, 4]);
    expect(r2vDurationRetryLadder(15, 10)).toEqual([9.7, 10, 8, 6, 5, 4]);
  });

  it("参考与当前同长时,边距档仍严格更小可出（15s vs 15s → 14.7s 档）", () => {
    expect(r2vDurationRetryLadder(15, 15)).toEqual([14.7, 10, 8, 6, 5, 4]);
    // 远超上限的参考夹到 maxSec 后不小于 currentSec,仍不出现
    expect(r2vDurationRetryLadder(15, 30.2)).toEqual([10, 8, 6, 5, 4]);
  });

  it("无参考片段时长：纯离散安全档下探", () => {
    expect(r2vDurationRetryLadder(15)).toEqual([10, 8, 6, 5, 4]);
    expect(r2vDurationRetryLadder(12)).toEqual([10, 8, 6, 5, 4]);
  });

  it("当前时长 ≤4 时无档可降（交给移除参考视频重投）", () => {
    expect(r2vDurationRetryLadder(4)).toEqual([]);
    expect(r2vDurationRetryLadder(4, 3)).toEqual([2.7]);
    expect(r2vDurationRetryLadder(5, 4)).toEqual([3.7, 4]);
  });

  it("参考片段时长夹到 2-15s 合法域", () => {
    // 1s 参考片段被夹到 2s 下限
    expect(r2vDurationRetryLadder(15, 1)).toEqual([2, 10, 8, 6, 5, 4]);
  });
});


// --------------------------------------------------------------------
// isR2vDurationError / extractPollFailureDetail（轮询阶段失败明细回归）
// --------------------------------------------------------------------

describe("isR2vDurationError", () => {
  it("r2v + duration 特征命中", () => {
    expect(
      isR2vDurationError(
        "upstream_InvalidParameter: status_code=400, the parameter duration specified in the request is not valid for model doubao-seedance-2-0 in r2v",
      ),
    ).toBe(true);
  });

  it("只有 duration 没有 r2v：不命中（t2v 时长错误走原提交降档）", () => {
    expect(isR2vDurationError("Duration must be between 2 and 15")).toBe(false);
  });

  it("内容审核类不误判（不降档重投）", () => {
    expect(isR2vDurationError("视频包含敏感内容，duration 超限时长 r2v")).toBe(false);
    expect(isR2vDurationError("InputImageSensitiveContentDetected")).toBe(false);
  });

  it("普通失败/空值不命中", () => {
    expect(isR2vDurationError("视频任务失败")).toBe(false);
    expect(isR2vDurationError(undefined)).toBe(false);
    expect(isR2vDurationError("")).toBe(false);
  });
});

describe("extractPollFailureDetail", () => {
  it("error.message / fail_reason / message 各结构都能取到", () => {
    expect(extractPollFailureDetail({ error: { message: "upstream 400 detail" } })).toBe(
      "upstream 400 detail",
    );
    expect(extractPollFailureDetail({ fail_reason: "content rejected" })).toBe("content rejected");
    expect(extractPollFailureDetail({ message: "plain msg" })).toBe("plain msg");
    expect(extractPollFailureDetail({ data: { error_message: "nested" } })).toBe("nested");
    expect(extractPollFailureDetail({ error: "string error" })).toBe("string error");
  });

  it("深层嵌套（output.error_message / data.fail_reason）", () => {
    expect(extractPollFailureDetail({ output: { error_message: "deep reason" } })).toBe(
      "deep reason",
    );
    expect(extractPollFailureDetail({ data: { fail_reason: "deep fail" } })).toBe("deep fail");
  });

  it("无错误语义字段返回 undefined（调用方回退状态原文）", () => {
    expect(extractPollFailureDetail({ status: "failed", model: "m" })).toBeUndefined();
    expect(extractPollFailureDetail(null)).toBeUndefined();
    expect(extractPollFailureDetail("raw string")).toBeUndefined();
  });

  it("超长明细截断到 300 字符", () => {
    const detail = extractPollFailureDetail({ message: "x".repeat(500) });
    expect(detail).toHaveLength(300);
  });
});
