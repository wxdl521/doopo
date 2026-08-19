import { describe, expect, it } from "vitest";
import { videoCost, videoCostOrFallback } from "../creditsCost";
import {
  assetLibraryVendorForModel,
  getVideoAssetLibrarySupport,
  referenceVideoLimitsForModel,
  r2vDurationLimitsForModel,
} from "../videoAssetLibrary";
import {
  buildTokenponyVideoBody,
  getVideoBackend,
  formatTokenponyActionError,
  isTokenponyDuplicateGroupError,
  parseTokenponyAssetGroupList,
  parseTokenponyAssetResult,
  parseTokenponyError,
  parseTokenponyTaskCreate,
  parseTokenponyTaskResult,
  pickTokenponyConfig,
  TOKENPONY_VIDEO_BODY_FIELDS,
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

  it("resolution 大写档(720P 缺省)——实测小写会被 10108 拒", () => {
    expect(tokenponyResolution("480P")).toBe("480P");
    expect(tokenponyResolution("1080P")).toBe("1080P");
    expect(tokenponyResolution("720p")).toBe("720P");
    expect(tokenponyResolution(undefined)).toBe("720P");
  });

  it("10108 信封带 data.errors 字段明细", () => {
    const err = parseTokenponyError({
      code: 10108,
      message: "Invalid request: Parameter schema validation failed",
      data: { errors: [{ path: "params.resolution", message: "must be one of: '480P'" }] },
    });
    expect(err?.code).toBe("10108");
    expect(err?.message).toContain("params.resolution");
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

describe("tokenpony 配置解析（env 优先 → 后台登记回退）", () => {
  it("env 有 key 时直接用 env,不看 DB", () => {
    const config = pickTokenponyConfig(
      { apiKey: "env-key", baseUrl: "https://env.example.com/" },
      { apiKey: "db-key", baseUrl: "https://db.example.com" },
    );
    expect(config.apiKey).toBe("env-key");
    expect(config.baseUrl).toBe("https://env.example.com"); // 尾斜杠剥掉
  });

  it("env 缺 key 时回退后台登记（code='tokenpony' 的 builtin 行）", () => {
    const config = pickTokenponyConfig(
      { apiKey: undefined, baseUrl: undefined },
      { apiKey: "db-key", baseUrl: "https://db.example.com" },
    );
    expect(config.apiKey).toBe("db-key");
    expect(config.baseUrl).toBe("https://db.example.com");
  });

  it("env 与后台都缺 key → apiKey undefined（调用方报「缺少 TOKENPONY_API_KEY 或后台登记密钥」）", () => {
    const config = pickTokenponyConfig({}, { apiKey: null, baseUrl: null });
    expect(config.apiKey).toBeUndefined();
    expect(config.baseUrl).toBe("https://api.tokenpony.cn");
  });

  it("env 有 key 但无 baseUrl → baseUrl 仍走后台/默认回退", () => {
    const config = pickTokenponyConfig(
      { apiKey: "env-key" },
      { apiKey: null, baseUrl: "https://db.example.com" },
    );
    expect(config.apiKey).toBe("env-key");
    expect(config.baseUrl).toBe("https://db.example.com");
  });
});

describe("tokenpony 素材 Action 错误解析（2026-08 实证:200 业务错误被吞）", () => {
  it("火山 Action 风格 ResponseMetadata.Error{Code,Message}", () => {
    const err = parseTokenponyError({
      ResponseMetadata: { Error: { Code: "AuthorizationLetterNotSigned", Message: "请先签署授权函" } },
    });
    expect(err).toEqual({ code: "AuthorizationLetterNotSigned", message: "请先签署授权函" });
  });

  it("嵌套 {error:{code,message}} 与信封 {code,msg} 变体", () => {
    expect(parseTokenponyError({ error: { code: "1001", message: "配额不足" } })).toEqual({
      code: "1001",
      message: "配额不足",
    });
    expect(parseTokenponyError({ code: 400, msg: "缺少参数" })).toEqual({
      code: "400",
      message: "缺少参数",
    });
    // 成功形态不误判
    expect(parseTokenponyError({ code: 200, data: { Id: "g-1" } })).toBeNull();
    expect(parseTokenponyError({ code: 0 })).toBeNull();
    expect(parseTokenponyError({ data: {} })).toBeNull();
  });

  it("错误文案格式 + 授权函引导", () => {
    const text = formatTokenponyActionError(
      "CreateAssetGroup",
      { code: "AuthorizationLetterNotSigned", message: "not signed" },
      200,
      "{}",
    );
    expect(text).toContain("[tokenpony] asset CreateAssetGroup 失败: AuthorizationLetterNotSigned: not signed");
    expect(text).toContain("签署素材库授权函");
  });

  it("解析不出错误/无 message → 附原始响应体截 300 字符", () => {
    const text = formatTokenponyActionError("CreateAsset", null, 200, "x".repeat(400));
    expect(text).toContain("未知错误码");
    expect(text).toContain("原始响应: " + "x".repeat(300));
    expect(text).not.toContain("x".repeat(301));
    // HTTP 层错误用 HTTP 状态码占位
    expect(formatTokenponyActionError("GetAsset", null, 500, "boom")).toContain("HTTP 500");
    // 有完整 code+message 时不附 body
    expect(
      formatTokenponyActionError("GetAsset", { code: "404", message: "asset not found" }, 200, "{}"),
    ).not.toContain("原始响应");
  });
});

describe("tokenpony 素材 Action 的 Result 信封（2026-08 实证:素材库与视频接口信封不同）", () => {
  it("火山信封 Result{Id} 成功解析（CreateAssetGroup 实证形态）", () => {
    expect(
      parseTokenponyAssetResult({
        ResponseMetadata: { RequestId: "r1" },
        Result: { Id: "348161951014731776" },
      }),
    ).toEqual({ id: "348161951014731776", status: undefined, error: undefined });
  });

  it("Result{Id,Status,Error}:GetAsset 状态与业务失败原因透出", () => {
    expect(parseTokenponyAssetResult({ Result: { Id: "a1", Status: "Active" } })).toEqual({
      id: "a1",
      status: "Active",
      error: undefined,
    });
    expect(
      parseTokenponyAssetResult({ Result: { Id: "a2", Status: "Failed", Error: "真人审核未通过" } }),
    ).toEqual({ id: "a2", status: "Failed", error: "真人审核未通过" });
  });

  it("data 包裹形态兼容（回退）;Result 优先于 data", () => {
    expect(parseTokenponyAssetResult({ data: { Id: "d1", Status: "Processing" } })).toEqual({
      id: "d1",
      status: "Processing",
      error: undefined,
    });
    expect(
      parseTokenponyAssetResult({ Result: { Id: "r1" }, data: { Id: "d1" } })?.id,
    ).toBe("r1");
  });

  it("ResponseMetadata.Error 失败仍由 parseTokenponyError 拦截（成功判定三件套）", () => {
    // HTTP 200 + ResponseMetadata.Error 非空 → 业务失败(即便带 Result 也不算成功)
    expect(
      parseTokenponyError({
        ResponseMetadata: { Error: { Code: "InvalidParameter", Message: "GroupType 非法" } },
        Result: {},
      }),
    ).toEqual({ code: "InvalidParameter", message: "GroupType 非法" });
  });
});

describe("tokenpony 建组幂等与错误透出（2026-08 实证第二轮）", () => {
  it("素材组列表解析:Result.Items / Groups / data 数组兼容", () => {
    expect(
      parseTokenponyAssetGroupList({ Result: { Items: [{ Id: "348", Name: "doopoo" }] } }),
    ).toEqual([{ id: "348", name: "doopoo" }]);
    expect(
      parseTokenponyAssetGroupList({ Result: { Groups: [{ id: "g1", name: "doopoo" }] } }),
    ).toEqual([{ id: "g1", name: "doopoo" }]);
    expect(parseTokenponyAssetGroupList({ data: [{ Id: 123, Name: "x" }] })).toEqual([
      { id: "123", name: "x" },
    ]);
    expect(parseTokenponyAssetGroupList({ Result: {} })).toEqual([]);
    expect(parseTokenponyAssetGroupList(null)).toEqual([]);
  });

  it("建组 duplicate/已存在类错误识别为幂等复用信号", () => {
    expect(isTokenponyDuplicateGroupError("already exists")).toBe(true);
    expect(isTokenponyDuplicateGroupError("Duplicate group name")).toBe(true);
    expect(isTokenponyDuplicateGroupError("同名素材组已存在")).toBe(true);
    expect(isTokenponyDuplicateGroupError("AssetGroup name conflict")).toBe(true);
    expect(isTokenponyDuplicateGroupError("缺少参数")).toBe(false);
  });

  it("submit/poll 错误透出真实 Code:Message（旧「服务返回错误码 undefined」模板废弃）", () => {
    // 提交/查询统一走 parseTokenponyError:火山 Action 风格也能解出
    expect(
      parseTokenponyError({ ResponseMetadata: { Error: { Code: "E100", Message: "bad" } } }),
    ).toEqual({ code: "E100", message: "bad" });
    // 旧模板函数保留但已 deprecated（兼容期）,新代码不再调用
    expect(tokenponyEnvelopeError({ code: 200 })).toBeNull();
  });
});

describe("tokenpony 视频创建请求体契约（10108 schema 校验实证）", () => {
  it("组包字段与契约白名单完全一致（多一个字段即失败）", () => {
    const body = buildTokenponyVideoBody({
      prompt: "p",
      media: [{ type: "first_image", url: "asset://a1" }],
      ratio: "9:16",
      resolution: "720P",
      duration: 8,
      generateAudio: true,
    });
    expect(Object.keys(body).sort()).toEqual([...TOKENPONY_VIDEO_BODY_FIELDS].sort());
    // safety_identifier / callback_url / watermark 等契约外字段绝不允许出现
    for (const banned of ["safety_identifier", "callback_url", "watermark"]) {
      expect(body).not.toHaveProperty(banned);
    }
  });

  it("duration 必须是 int:小数（降档贴齐档 7.7）四舍五入、夹到 4-15s", () => {
    expect(buildTokenponyVideoBody({ prompt: "p", media: [], duration: 7.7 }).duration).toBe(8);
    expect(buildTokenponyVideoBody({ prompt: "p", media: [], duration: 2 }).duration).toBe(4);
    expect(buildTokenponyVideoBody({ prompt: "p", media: [], duration: 20 }).duration).toBe(15);
    // 非正数（如 -1 智能档,属 TopenRouter 专有）直接省略
    expect(buildTokenponyVideoBody({ prompt: "p", media: [], duration: -1 })).not.toHaveProperty(
      "duration",
    );
  });

  it("resolution 大写档;媒体走 content[]（ARK 风格带 role）;空 media 不带该字段", () => {
    const body = buildTokenponyVideoBody({ prompt: "p", media: [], resolution: "1080P" });
    expect(body.resolution).toBe("1080P");
    expect(body).not.toHaveProperty("content");
    const withMedia = buildTokenponyVideoBody({
      prompt: "p",
      media: [
        { type: "first_image", url: "asset://f1" },
        { type: "reference_video", url: "asset://v1" },
        { type: "reference_audio", url: "asset://a1" },
      ],
    });
    // asset:// 首帧必须保留 role（media[] 形态会被网关丢 role，curl 实证）
    expect(withMedia.content).toEqual([
      { type: "text", text: "p" },
      { type: "image_url", image_url: { url: "asset://f1" }, role: "first_frame" },
      { type: "video_url", video_url: { url: "asset://v1" }, role: "reference_video" },
      { type: "audio_url", audio_url: { url: "asset://a1" }, role: "reference_audio" },
    ]);
  });

  it("含首/尾帧时 ratio 强制 adaptive；纯参考媒体保留请求比例", () => {
    const withFirst = buildTokenponyVideoBody({
      prompt: "p",
      media: [{ type: "first_image", url: "https://a.com/f.png" }],
      ratio: "9:16",
    });
    expect(withFirst.ratio).toBe("adaptive");
    const refOnly = buildTokenponyVideoBody({
      prompt: "p",
      media: [{ type: "reference_image", url: "https://a.com/r.png" }],
      ratio: "9:16",
    });
    expect(refOnly.ratio).toBe("9:16");
    const noRatio = buildTokenponyVideoBody({ prompt: "p", media: [] });
    expect(noRatio.ratio).toBe("adaptive");
  });
});
