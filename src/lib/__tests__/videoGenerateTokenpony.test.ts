import { describe, expect, it } from "vitest";
import { videoCost, videoCostOrFallback } from "../creditsCost";
import {
  assetLibraryVendorForModel,
  getVideoAssetLibrarySupport,
  referenceVideoLimitsForModel,
  r2vDurationLimitsForModel,
} from "../videoAssetLibrary";
import {
  getVideoBackend,
  parseTokenponyAssetResult,
  parseTokenponyTaskCreate,
  parseTokenponyTaskResult,
  tokenponyEnvelopeError,
  tokenponyMediaType,
  tokenponyResolution,
  tokenponyStatusToProgress,
} from "../videoGenerate.functions";

const MODEL = "tokenpony-doubao-seedance-2-5-260628";

describe("tokenpony(Seedance 2.5 中转)渠道", () => {
  it("tokenpony- 前缀路由到 tokenpony 后端", () => {
    expect(getVideoBackend(MODEL)).toBe("tokenpony");
    expect(getVideoBackend("TOKENPONY-doubao-seedance-2-5-260628")).toBe("tokenpony");
  });

  it("媒体角色映射:first/last_frame → first/last_image,reference_* 同名", () => {
    expect(tokenponyMediaType("first_frame")).toBe("first_image");
    expect(tokenponyMediaType("last_frame")).toBe("last_image");
    expect(tokenponyMediaType("reference_image")).toBe("reference_image");
    expect(tokenponyMediaType("reference_video")).toBe("reference_video");
    expect(tokenponyMediaType("reference_audio")).toBe("reference_audio");
  });

  it("resolution 小写档(720p 缺省)", () => {
    expect(tokenponyResolution("480P")).toBe("480p");
    expect(tokenponyResolution("1080P")).toBe("1080p");
    expect(tokenponyResolution(undefined)).toBe("720p");
  });

  it("task_status 状态映射:PENDING/RUNNING/COMPLETED/FAILED", () => {
    expect(tokenponyStatusToProgress("PENDING")).toBe("queued");
    expect(tokenponyStatusToProgress("RUNNING")).toBe("running");
    expect(tokenponyStatusToProgress("COMPLETED")).toBe("succeeded");
    expect(tokenponyStatusToProgress("FAILED")).toBe("failed");
    expect(tokenponyStatusToProgress(undefined)).toBe("queued");
  });

  it("信封错误:code 200 放行,非 200 提取 msg", () => {
    expect(tokenponyEnvelopeError({ code: 200, data: { id: "t1" } })).toBeNull();
    expect(tokenponyEnvelopeError({ code: 400, msg: "缺少参数" })).toBe("缺少参数");
    expect(tokenponyEnvelopeError({ code: 50001 })).toBe("服务返回错误码 50001");
    expect(tokenponyEnvelopeError(null)).toBeTruthy();
  });

  it("创建响应解析 data.id(兼容 task_id)", () => {
    expect(parseTokenponyTaskCreate({ code: 200, data: { id: "task-1", status: "PENDING" } })).toBe(
      "task-1",
    );
    expect(parseTokenponyTaskCreate({ code: 200, data: { task_id: "task-2" } })).toBe("task-2");
    expect(parseTokenponyTaskCreate({ code: 200, data: {} })).toBeNull();
  });

  it("轮询结果:COMPLETED 取 data.result.result;FAILED 读 task_status_msg", () => {
    expect(
      parseTokenponyTaskResult({
        data: { task_status: "COMPLETED", result: { result: "https://cdn/x.mp4" } },
      }),
    ).toEqual({ status: "COMPLETED", videoUrl: "https://cdn/x.mp4", error: "" });
    expect(
      parseTokenponyTaskResult({ data: { task_status: "FAILED", task_status_msg: "风控拒绝" } }),
    ).toEqual({ status: "FAILED", videoUrl: null, error: "风控拒绝" });
  });

  it("素材 Action 解析(大小写键兼容)", () => {
    expect(parseTokenponyAssetResult({ data: { Id: "asset-1", Status: "Processing" } })).toEqual({
      id: "asset-1",
      status: "Processing",
    });
    expect(parseTokenponyAssetResult({ data: { id: "a2", status: "Active" } })).toEqual({
      id: "a2",
      status: "Active",
    });
    expect(parseTokenponyAssetResult({ data: {} })).toBeNull();
  });

  it("价目:按 doubao-seedance-2-0 直连档 237.6/10s;前缀剥离兜底", () => {
    expect(videoCost(MODEL, "720P", 10)).toBe(237.6);
    const r = videoCostOrFallback("tokenpony-doubao-seedance-2-0-260128", "720P", 10);
    expect(r?.cost).toBe(237.6);
    expect(r?.warning).toContain("doubao-seedance-2-0-260128");
  });

  it("素材库注册:vendor=tokenpony;参考视频 2-15s;r2v 时长 4-15s", () => {
    expect(assetLibraryVendorForModel(MODEL)).toBe("tokenpony");
    expect(getVideoAssetLibrarySupport(MODEL).supported).toBe(true);
    expect(referenceVideoLimitsForModel(MODEL)).toEqual({ minMs: 2_000, maxMs: 15_000 });
    expect(r2vDurationLimitsForModel(MODEL)).toEqual({ minSec: 4, maxSec: 15 });
    // TopenRouter 既有口径不受影响
    expect(referenceVideoLimitsForModel("topenrouter-doubao-seedance-2-0-260128")).toEqual({
      minMs: 1_800,
      maxMs: 30_000,
    });
  });
});
