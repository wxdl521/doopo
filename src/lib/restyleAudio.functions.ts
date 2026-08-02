/**
 * 转绘 v1 音频通道：把 v2 的 ASR 链路（input_audio + audio-transcript-align skill）
 * 接到 v1 工作台。客户端抽 16k 单声道 WAV 分片，这里逐片识别为带时间码的台词句。
 * 网关拒绝 input_audio 时返回 degraded 标记，由前端走「无台词」降级口径。
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "../integrations/supabase/auth-middleware";
import { callLovableChat, INTERNAL_VISION_MODEL, type ChatMessage } from "./restyle/lovableGateway";
import { composePrompt } from "./restyle/skills";

const InputSchema = z.object({
  unitId: z.string().min(1).max(80),
  /** 纯 base64（不带 data: 前缀），单片建议 ≤ 45s 的 16k 单声道 WAV。 */
  audioBase64: z.string().min(64).max(16_000_000),
  format: z.enum(["wav", "mp3", "m4a", "webm", "ogg", "aac", "flac"]).default("wav"),
  sourceStartSeconds: z.number().nonnegative().max(86_400).default(0),
  durationSec: z.number().positive().max(600),
});

export interface RestyleAsrSentence {
  begin_ms: number;
  end_ms: number;
  text: string;
  speaker: string;
}

export type RestyleAsrResult =
  | { ok: true; sentences: RestyleAsrSentence[] }
  | { ok: false; error: string; degraded: boolean };

const SentenceSchema = z.object({
  begin_ms: z.coerce.number().nonnegative().default(0),
  end_ms: z.coerce.number().nonnegative().default(0),
  text: z.string().min(1).max(600),
  speaker: z.string().max(60).default("unknown"),
});

/** 从模型文本中提取 JSON（容忍 ```json 围栏与前后杂散文本）。 */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.search(/[{[]/);
  if (start === -1) throw new Error("模型输出中未找到 JSON");
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  const end = cleaned.lastIndexOf(close);
  if (end <= start) throw new Error("模型输出 JSON 不完整");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** 网关 HTTP 400 且报错提及 input_audio → 判定为音频输入不被接受。 */
function isInputAudioRejected(error: string): boolean {
  return /HTTP 400/.test(error) && /input_audio|audio/i.test(error);
}

function buildMessages(data: z.infer<typeof InputSchema>): ChatMessage[] {
  const context = {
    analysisUnitId: data.unitId,
    unitTimeRange: {
      sourceStartSeconds: data.sourceStartSeconds,
      durationSec: data.durationSec,
    },
    note: '直接对输入音频做语音识别。只输出 JSON：{ "sentences": [{ "begin_ms", "end_ms", "text", "speaker" }] }，时间码为本片段内相对毫秒整数；说话人无法确定填 unknown；听不清的片段用 … 占位，不得虚构台词。',
  };
  return [
    { role: "system", content: composePrompt(["audio-transcript-align"], JSON.stringify(context, null, 2)) },
    {
      role: "user",
      content: [
        { type: "text", text: `请识别片段 ${data.unitId} 的音频，按契约输出逐句台词 JSON。` },
        { type: "input_audio", input_audio: { data: data.audioBase64, format: data.format } },
      ],
    },
  ];
}

/** 单片音频 → 带时间码的台词句（时间码已换算为整集绝对毫秒）。 */
export const transcribeRestyleAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<RestyleAsrResult> => {
    const { ensureEnoughCredits } = await import("./creditsGuard");
    const guard = await ensureEnoughCredits(1, { kind: "image", model: INTERNAL_VISION_MODEL });
    if (!guard.ok) return { ok: false, error: guard.error, degraded: false };

    const result = await callLovableChat({
      model: INTERNAL_VISION_MODEL,
      messages: buildMessages(data),
      maxTokens: 6_000,
      timeoutMs: 180_000,
      jsonMode: true,
    });
    if (!result.ok) {
      return { ok: false, error: result.error, degraded: isInputAudioRejected(result.error) };
    }
    try {
      const parsed = extractJson(result.text) as { sentences?: unknown };
      const offset = Math.round(data.sourceStartSeconds * 1000);
      const sentences = z
        .array(SentenceSchema)
        .max(400)
        .parse(Array.isArray(parsed) ? parsed : (parsed.sentences ?? []))
        .map((sentence) => ({
          begin_ms: sentence.begin_ms + offset,
          end_ms: Math.max(sentence.end_ms, sentence.begin_ms) + offset,
          text: sentence.text.trim(),
          speaker: sentence.speaker || "unknown",
        }))
        .filter((sentence) => sentence.text.length > 0);
      return { ok: true, sentences };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "台词 JSON 解析失败",
        degraded: false,
      };
    }
  });
