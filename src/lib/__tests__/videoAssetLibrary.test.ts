import { describe, expect, it } from "vitest";
import {
  assetLibraryVendorForModel,
  buildRestyleVideoContent,
  getVideoAssetLibrarySupport,
  isSensitiveContentError,
  parseRejectedContentIndexes,
  planRestyleFallback,
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
