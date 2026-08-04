/**
 * 台词稿转写（配音/台词模块）：走 Lovable AI Gateway 官方语音转写端点
 * POST /v1/audio/transcriptions（multipart/form-data，模型 openai/gpt-4o-transcribe）。
 *
 * 与转绘模块的 transcribeRestyleAudio（chat + input_audio）互不影响：
 * 这里只做「音频 → 纯文本」，句级时间码由前端按片段起点 + 字符占比估算。
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const ASR_MODEL = "openai/gpt-4o-transcribe";

const InputSchema = z.object({
  /** 纯 base64（不带 data: 前缀），单片 ≤ 15MB。 */
  audioBase64: z.string().min(64).max(20_000_000),
  format: z.enum(["wav", "mp3", "m4a", "webm", "ogg", "aac", "flac"]).default("wav"),
  offsetSeconds: z.number().nonnegative().max(86_400).default(0),
  durationSec: z.number().positive().max(600),
  /** ISO-639-1，留空则自动检测。 */
  language: z
    .string()
    .regex(/^[a-z]{2}$/)
    .optional(),
});

export type TranscribeChunkResult =
  | { ok: true; text: string; offsetSeconds: number; durationSec: number }
  | { ok: false; error: string; status?: number };

const MIME_BY_FORMAT: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  webm: "audio/webm",
  ogg: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
};

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 把网关状态码翻译成用户能看懂的中文提示。 */
function friendlyError(status: number, body: string): string {
  if (status === 402) return "AI 额度已用尽，请在工作区补充额度后重试。";
  if (status === 429) return "转写请求过于频繁，请稍后再试。";
  if (status === 403 || status === 404) return "当前工作区未开启语音转写能力。";
  if (status === 400) return `音频不被接受（可能是格式或时长问题）：${body.slice(0, 300)}`;
  return `转写失败（HTTP ${status}）：${body.slice(0, 300)}`;
}

/** 单片音频 → 纯文本转写结果。 */
export const transcribeAudioChunk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<TranscribeChunkResult> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { ok: false, error: "LOVABLE_API_KEY 未配置，无法调用语音转写。" };

    const { ensureEnoughCredits } = await import("./creditsGuard");
    const guard = await ensureEnoughCredits(1, { kind: "image", model: ASR_MODEL });
    if (!guard.ok) return { ok: false, error: guard.error };

    const bytes = decodeBase64(data.audioBase64);
    if (bytes.byteLength < 2048) return { ok: false, error: "这段音频为空，请重新选择文件。" };

    const form = new FormData();
    form.append("model", ASR_MODEL);
    form.append(
      "file",
      new Blob([bytes as unknown as BlobPart], {
        type: MIME_BY_FORMAT[data.format] ?? "audio/wav",
      }),
      `chunk.${data.format}`,
    );
    if (data.language) form.append("language", data.language);

    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "网络异常";
      const { logGenerationError } = await import("./errorLogs.server");
      logGenerationError({
        kind: "image",
        provider: "lovable-ai-asr",
        model: ASR_MODEL,
        durationMs: Date.now() - started,
        requestPayload: { offsetSeconds: data.offsetSeconds, durationSec: data.durationSec },
        errorMessage: message,
      });
      return { ok: false, error: `转写请求失败：${message}` };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const { logGenerationError } = await import("./errorLogs.server");
      logGenerationError({
        kind: "image",
        provider: "lovable-ai-asr",
        model: ASR_MODEL,
        status: response.status,
        durationMs: Date.now() - started,
        requestPayload: { offsetSeconds: data.offsetSeconds, durationSec: data.durationSec },
        responseBody: body,
        errorMessage: `ASR HTTP ${response.status}`,
      });
      return { ok: false, error: friendlyError(response.status, body), status: response.status };
    }

    const payload = (await response.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    return { ok: true, text, offsetSeconds: data.offsetSeconds, durationSec: data.durationSec };
  });