import { describe, expect, it } from "vitest";
import { verdictForSucceededPoll } from "../videoGenerate.functions";

describe("generateVideo 轮询成功分支 · 空 videoUrl 不扣费", () => {
  it("videoUrl 为空 / 空白 / 缺失时按失败处理（不进入扣费路径）", () => {
    for (const empty of [undefined, "", "   "]) {
      const verdict = verdictForSucceededPoll("ark", empty);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.error).toContain("ark");
        expect(verdict.error).toContain("没有返回可播放的结果 URL");
      }
    }
  });

  it("有可用 videoUrl 才放行（随后才允许扣费）", () => {
    const verdict = verdictForSucceededPoll("ark", "https://cdn.example.com/v.mp4");
    expect(verdict).toEqual({ ok: true, videoUrl: "https://cdn.example.com/v.mp4" });
  });

  it("放行时对 URL 做 trim", () => {
    const verdict = verdictForSucceededPoll("ark", "  https://cdn.example.com/v.mp4  ");
    expect(verdict).toEqual({ ok: true, videoUrl: "https://cdn.example.com/v.mp4" });
  });
});
