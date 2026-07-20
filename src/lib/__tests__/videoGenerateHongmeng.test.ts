import { describe, expect, it } from "vitest";
import {
  extractArkVideoUrl,
  getVideoBackend,
  seedanceStatusToProgress,
} from "../videoGenerate.functions";

describe("弘梦 ARK 兼容任务查询", () => {
  it("将中转常用 completed 完成态映射为 succeeded，避免无限轮询", () => {
    for (const status of ["completed", "success", "done", "finished"]) {
      expect(seedanceStatusToProgress(status)).toBe("succeeded");
    }
  });

  it("保留 ARK 原生 content.video_url 的解析", () => {
    expect(
      extractArkVideoUrl({
        status: "succeeded",
        content: { video_url: "https://cdn.example.com/ark-video.mp4" },
      }),
    ).toBe("https://cdn.example.com/ark-video.mp4");
  });

  it("兼容中转将完成任务包装在 data/result/output 中的响应", () => {
    for (const payload of [
      { data: { status: "completed", video_url: "https://cdn.example.com/data.mp4" } },
      { result: { status: "success", results: ["https://cdn.example.com/result.mp4"] } },
      { output: { status: "done", content: { videoUrl: "https://cdn.example.com/output.mp4" } } },
    ]) {
      expect(extractArkVideoUrl(payload)).toMatch(/^https:\/\/cdn\.example\.com\/.+\.mp4$/);
    }
  });

  it("兼容弘梦的 data.data.video_url 和外层 result_url", () => {
    const url = "https://cdn.example.com/hongmeng.mp4";
    expect(
      extractArkVideoUrl({
        code: "success",
        data: {
          status: "SUCCESS",
          result_url: url,
          data: { status: "succeeded", video_url: url },
        },
      }),
    ).toBe(url);
  });

  it("将客易云模型路由至其专用创建、素材和查询接口", () => {
    expect(getVideoBackend("keyiyun-sd-2-0-fast-discount-720p")).toBe("keyiyun");
  });
});
