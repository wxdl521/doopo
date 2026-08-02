/**
 * 台词稿纯函数工具：分句 + 时间码估算 + SRT/TXT 导出。
 * 转写端点只返回整段文本，因此句级时间码按「片段起点 + 字符占比」线性估算。
 */

export interface TranscriptLine {
  id: string;
  beginMs: number;
  endMs: number;
  text: string;
  speaker: string;
}

export interface TranscribedChunk {
  text: string;
  offsetSeconds: number;
  durationSec: number;
}

/** 按中英文句末标点切句，保留标点；无标点时整体作为一句。 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const parts = normalized.match(/[^。！？!?…;；\n]+[。！？!?…;；]*/g);
  return (parts ?? [normalized]).map((s) => s.trim()).filter(Boolean);
}

/** 把一片转写文本展开成带估算时间码的句子。 */
export function chunkToLines(chunk: TranscribedChunk, indexPrefix: string): TranscriptLine[] {
  const sentences = splitSentences(chunk.text);
  if (sentences.length === 0) return [];
  const totalChars = sentences.reduce((sum, s) => sum + s.length, 0) || 1;
  const startMs = Math.round(chunk.offsetSeconds * 1000);
  const spanMs = Math.max(1000, Math.round(chunk.durationSec * 1000));
  let cursor = 0;
  return sentences.map((text, i) => {
    const beginMs = startMs + Math.round((cursor / totalChars) * spanMs);
    cursor += text.length;
    const endMs = startMs + Math.round((cursor / totalChars) * spanMs);
    return {
      id: `${indexPrefix}-${i}`,
      beginMs,
      endMs: Math.max(endMs, beginMs + 500),
      text,
      speaker: "",
    };
  });
}

/** 多片转写结果 → 全片台词行（时间码已累积偏移）。 */
export function buildTranscriptLines(chunks: TranscribedChunk[]): TranscriptLine[] {
  return chunks
    .flatMap((chunk, index) => chunkToLines(chunk, `c${index}`))
    .sort((a, b) => a.beginMs - b.beginMs);
}

export function formatTimecode(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function srtTime(ms: number): string {
  return `${formatTimecode(ms)},${String(Math.max(0, ms) % 1000).padStart(3, "0")}`;
}

export function toSrt(lines: TranscriptLine[]): string {
  return lines
    .map((line, i) => {
      const speaker = line.speaker ? `${line.speaker}：` : "";
      return `${i + 1}\n${srtTime(line.beginMs)} --> ${srtTime(line.endMs)}\n${speaker}${line.text}\n`;
    })
    .join("\n");
}

export function toPlainText(lines: TranscriptLine[]): string {
  return lines
    .map((line) => {
      const speaker = line.speaker ? `${line.speaker}：` : "";
      return `[${formatTimecode(line.beginMs)}] ${speaker}${line.text}`;
    })
    .join("\n");
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}