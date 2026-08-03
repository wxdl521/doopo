import { describe, expect, it } from "vitest";
import { parseSttPayload } from "../restyleAudio.functions";

describe("parseSttPayload（STT 响应 → 台词句）", () => {
  it("segments 秒级时间码换算为毫秒并加整集偏移", () => {
    const sentences = parseSttPayload(
      {
        text: "整段文本",
        segments: [
          { start: 0.5, end: 2.0, text: " 你好 " },
          { start: 2.1, end: 2.2, text: "" },
        ],
      },
      45,
      45,
    );
    expect(sentences).toHaveLength(1);
    expect(sentences[0]).toEqual({ begin_ms: 45500, end_ms: 47000, text: "你好", speaker: "unknown" });
  });

  it("end 小于 begin 时压平为 begin", () => {
    const sentences = parseSttPayload({ segments: [{ start: 5, end: 4, text: "x" }] }, 0, 45);
    expect(sentences[0]!.end_ms).toBe(sentences[0]!.begin_ms);
  });

  it("只有整段 text 时兜底为覆盖本片的一句", () => {
    const sentences = parseSttPayload({ text: "全片台词" }, 10, 30);
    expect(sentences).toEqual([
      { begin_ms: 10_000, end_ms: 40_000, text: "全片台词", speaker: "unknown" },
    ]);
  });

  it("空响应 / 无文本 → 空数组（前端走无台词降级）", () => {
    expect(parseSttPayload(null, 0, 45)).toEqual([]);
    expect(parseSttPayload({ text: "  " }, 0, 45)).toEqual([]);
  });
});
