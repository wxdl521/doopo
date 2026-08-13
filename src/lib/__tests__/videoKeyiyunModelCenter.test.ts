import { describe, expect, it } from "vitest";
import { imageCost, videoCost } from "../creditsCost";
import { isAzureModel, stripAzurePrefix, azureDeploymentImagePath } from "../azureImage.functions";
import { assetLibraryVendorForModel, getVideoAssetLibrarySupport } from "../videoAssetLibrary";
import {
  buildKeyiyunModelCenterBody,
  isKeyiyunModelCenterModel,
  keyiyunModelCenterAspect,
  keyiyunModelCenterDuration,
  keyiyunModelCenterResolution,
  keyiyunModelCenterUpstreamModel,
  parseKeyiyunModelCenterResult,
  parseKeyiyunModelCenterTaskId,
} from "../videoGenerate.functions";

describe("客易云 Seedance 2.5(model-center API)", () => {
  it("仅 keyiyun-seedance-2-5-c1 走 model-center,折扣版维持 seedance-special", () => {
    expect(isKeyiyunModelCenterModel("keyiyun-seedance-2-5-c1")).toBe(true);
    expect(isKeyiyunModelCenterModel("KEYIYUN-seedance-2-5-c1")).toBe(true);
    expect(isKeyiyunModelCenterModel("keyiyun-sd-2-0-fast-discount-720p")).toBe(false);
    expect(isKeyiyunModelCenterModel(null)).toBe(false);
  });

  it("resolution 必填小写档:480P→480p,缺省/其它→720p", () => {
    expect(keyiyunModelCenterResolution("480P")).toBe("480p");
    expect(keyiyunModelCenterResolution("720P")).toBe("720p");
    expect(keyiyunModelCenterResolution(undefined)).toBe("720p");
    expect(keyiyunModelCenterResolution("1080P")).toBe("720p");
  });

  it("aspect_ratio 仅收 9:16|16:9|1:1,其它省略", () => {
    expect(keyiyunModelCenterAspect("9:16")).toBe("9:16");
    expect(keyiyunModelCenterAspect("1:1")).toBe("1:1");
    expect(keyiyunModelCenterAspect("4:3")).toBeUndefined();
    expect(keyiyunModelCenterAspect(undefined)).toBeUndefined();
  });

  it("duration 夹取 4-30 秒", () => {
    expect(keyiyunModelCenterDuration(2)).toBe(4);
    expect(keyiyunModelCenterDuration(10)).toBe(10);
    expect(keyiyunModelCenterDuration(60)).toBe(30);
    expect(keyiyunModelCenterDuration(undefined)).toBeUndefined();
  });

  it("buildKeyiyunModelCenterBody 组包:模型 ID 必填、角色媒体拆数组", () => {
    const body = buildKeyiyunModelCenterBody({
      prompt: "p",
      media: [
        { type: "first_frame", url: "https://a/first.png" },
        { type: "reference_image", url: "https://a/r1.png" },
        { type: "reference_image", url: "https://a/r2.png" },
      ],
      ratio: "9:16",
      resolution: "720P",
      duration: 8,
      referenceVideoUrl: "https://a/ref.mp4",
    });
    expect(body.model).toBe("seedance-2.5-c1");
    expect(body.resolution).toBe("720p");
    expect(body.aspect_ratio).toBe("9:16");
    expect(body.duration).toBe(8);
    expect(body.first_image).toEqual(["https://a/first.png"]);
    expect(body.reference_images).toEqual(["https://a/r1.png", "https://a/r2.png"]);
    expect(body.reference_videos).toEqual(["https://a/ref.mp4"]);
    expect(body.last_image).toBeUndefined();
    expect(body.reference_audios).toBeUndefined();
  });

  it("上游模型名:默认 seedance-2.5-c1,KEYYIYUN_MODEL_CENTER_MODEL 可覆盖", () => {
    const original = process.env.KEYYIYUN_MODEL_CENTER_MODEL;
    try {
      delete process.env.KEYYIYUN_MODEL_CENTER_MODEL;
      expect(keyiyunModelCenterUpstreamModel()).toBe("seedance-2.5-c1");
      // 覆盖后组包跟着变(渠道方分组映射变更时免改代码)
      process.env.KEYYIYUN_MODEL_CENTER_MODEL = "video-2.5-pro";
      expect(keyiyunModelCenterUpstreamModel()).toBe("video-2.5-pro");
      expect(
        buildKeyiyunModelCenterBody({ prompt: "p", media: [] }).model,
      ).toBe("video-2.5-pro");
      // 显式入参优先于 env
      expect(
        buildKeyiyunModelCenterBody({ prompt: "p", media: [], upstreamModel: "m-x" }).model,
      ).toBe("m-x");
    } finally {
      if (original === undefined) delete process.env.KEYYIYUN_MODEL_CENTER_MODEL;
      else process.env.KEYYIYUN_MODEL_CENTER_MODEL = original;
    }
  });

  it("parseKeyiyunModelCenterTaskId 兼容 id / task_id / data 包装", () => {
    expect(parseKeyiyunModelCenterTaskId({ id: "t1" })).toBe("t1");
    expect(parseKeyiyunModelCenterTaskId({ data: { task_id: "t2" } })).toBe("t2");
    expect(parseKeyiyunModelCenterTaskId({ data: { id: "t3" } })).toBe("t3");
    expect(parseKeyiyunModelCenterTaskId({ msg: "缺少必填参数: prompt" })).toBeNull();
  });

  it("parseKeyiyunModelCenterResult 提取状态/result_url/错误", () => {
    expect(
      parseKeyiyunModelCenterResult({ status: "completed", result_url: "https://a/v.mp4" }),
    ).toEqual({ status: "completed", videoUrl: "https://a/v.mp4", error: "" });
    expect(
      parseKeyiyunModelCenterResult({ data: { status: "failed", error: "风控拒绝" } }),
    ).toEqual({ status: "failed", videoUrl: null, error: "风控拒绝" });
    expect(parseKeyiyunModelCenterResult(null)).toEqual({
      status: undefined,
      videoUrl: null,
      error: "",
    });
  });

  it("价目:keyiyun-seedance-2-5-c1 按 doubao-seedance-2-0 直连档 237.6/10s", () => {
    expect(videoCost("keyiyun-seedance-2-5-c1", "720P", 10)).toBe(237.6);
    expect(videoCost("keyiyun-seedance-2-5-c1", "480P", 5)).toBe(118.8);
  });

  it("2.5 不进素材库(直传公网 URL);2.0 折扣版维持 keyiyun 素材链", () => {
    expect(assetLibraryVendorForModel("keyiyun-seedance-2-5-c1")).toBeNull();
    expect(getVideoAssetLibrarySupport("keyiyun-seedance-2-5-c1").supported).toBe(false);
    expect(assetLibraryVendorForModel("keyiyun-sd-2-0-fast-discount-720p")).toBe("keyiyun");
  });
});

describe("azure-image2 并发生图网关", () => {
  it("azure-image2/ 前缀识别为 azure 渠道并剥前缀得 deployment", () => {
    expect(isAzureModel("azure-image2/gpt-image-2")).toBe(true);
    expect(stripAzurePrefix("azure-image2/gpt-image-2")).toBe("gpt-image-2");
    // 不被裸 azure/ 前缀误吞(azure-image2/ 不以 azure/ 开头)
    expect("azure-image2/gpt-image-2".startsWith("azure/")).toBe(false);
  });

  it("生图走经典 deployment 路径(2026-08-14 实测:v1 路径 404,已修正)", () => {
    const deployment = stripAzurePrefix("azure-image2/gpt-image-2");
    expect(azureDeploymentImagePath(deployment, false)).toBe(
      "/openai/deployments/gpt-image-2/images/generations",
    );
    // edits 路由实测存在(空 body 400),I2I 同构接上
    expect(azureDeploymentImagePath(deployment, true)).toBe(
      "/openai/deployments/gpt-image-2/images/edits",
    );
  });

  it("图像价目:azure-image2/ 与现有 gpt-image-2 档同价 9 积分/张", () => {
    expect(imageCost("azure-image2/gpt-image-2")).toBe(9);
  });
});
