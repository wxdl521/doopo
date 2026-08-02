import { describe, expect, it } from "vitest";
import {
  buildTranscriptLines,
  chunkToLines,
  formatTimecode,
  splitSentences,
  toPlainText,
  toSrt,
} from "../transcriptFormat";

describe("splitSentences", () => {
  it("按中英文句末标点切句", () => {
    expect(splitSentences("你好。世界！ok?")).toEqual(["你好。", "世界！", "ok?"]);
  });

  it("无标点时整体成句，空串返回空数组", () => {
    expect(splitSentences("  一句没有标点的话 ")).toEqual(["一句没有标点的话"]);
    expect(splitSentences("   ")).toEqual([]);
  });
});

describe("chunkToLines", () => {
  it("时间码从片段偏移开始并按字符占比递增", () => {
    const lines = chunkToLines({ text: "abcd。efgh。", offsetSeconds: 45, durationSec: 40 }, "c1");
    expect(lines).toHaveLength(2);
    expect(lines[0].beginMs).toBe(45_000);
    expect(lines[1].beginMs).toBe(65_000);
    expect(lines[1].endMs).toBe(85_000);
  });
});

describe("buildTranscriptLines", () => {
  it("多片结果按累积时间码排序", () => {
    const lines = buildTranscriptLines([
      { text: "第二段。", offsetSeconds: 45, durationSec: 45 },
      { text: "第一段。", offsetSeconds: 0, durationSec: 45 },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["第一段。", "第二段。"]);
    expect(lines[1].beginMs).toBe(45_000);
  });
});

describe("导出格式", () => {
  const lines = buildTranscriptLines([{ text: "你好。", offsetSeconds: 3661, durationSec: 2 }]);

  it("时间码为 HH:MM:SS", () => {
    expect(formatTimecode(3_661_000)).toBe("01:01:01");
  });

  it("SRT 含序号与箭头", () => {
    const srt = toSrt(lines);
    expect(srt.startsWith("1\n01:01:01,000 --> ")).toBe(true);
    expect(srt).toContain("你好。");
  });

  it("TXT 带时间码前缀", () => {
    expect(toPlainText(lines)).toBe("[01:01:01] 你好。");
  });
});