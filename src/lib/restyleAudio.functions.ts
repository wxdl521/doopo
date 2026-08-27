/**
 * 转绘 v1 音频通道：客户端抽 16k 单声道 WAV 分片，这里走专用转写端点
 * （POST /v1/audio/transcriptions，gpt-4o-mini-transcribe，multipart/form-data）
 * 逐片识别为带时间码的台词句；说话人归属交给后续视觉通道补。
 * 端点 4xx（不支持音频/参数）时返回 degraded 标记，由前端走「无台词」降级口径。
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "../integrations/supabase/auth-middleware";

const STT_ENDPOINT = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const STT_MODEL = "openai/gpt-4o-mini-transcribe";

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

/** base64 → 字节。 */
function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

const MIME_BY_FORMAT: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  webm: "audio/webm",
  ogg: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
};

type SttVerbosePayload = {
  text?: unknown;
  segments?: Array<{ start?: unknown; end?: unknown; text?: unknown }>;
};

/**
 * 单片音频 → 带时间码的台词句（时间码已换算为整集绝对毫秒）。
 * 专用 STT 出台词文本与时间码；speaker 统一先填 unknown，由视觉通道结合画面补。
 */
export const transcribeRestyleAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }): Promise<RestyleAsrResult> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { ok: false, error: "LOVABLE_API_KEY 未配置，无法调用语音转写。", degraded: false };

    const { ensureEnoughCredits } = await import("./creditsGuard");
    const guard = await ensureEnoughCredits(1, { kind: "image", model: STT_MODEL });
    if (!guard.ok) return { ok: false, error: guard.error, degraded: false };

    const bytes = decodeBase64(data.audioBase64);
    if (bytes.byteLength < 2048) {
      return { ok: false, error: "这段音频为空，请重新选择文件。", degraded: false };
    }

    const form = new FormData();
    form.append("model", STT_MODEL);
    // 网关 STT（gpt-4o-mini-transcribe-api-ev3）不支持 verbose_json（400），
    // 只接受 json/text；句级时间码由 45s 分段偏移兜底（parseSttPayload 的 text 回退）。
    form.append("response_format", "json");
    form.append(
      "file",
      new Blob([bytes as unknown as BlobPart], { type: MIME_BY_FORMAT[data.format] ?? "audio/wav" }),
      `chunk.${data.format}`,
    );

    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(STT_ENDPOINT, {
        method: "POST",
        // multipart/form-data：不手动设 Content-Type，由 runtime 生成 boundary
        // 与 lovableGateway 一致走标准 Bearer 头（网关两种头都收，统一口径便于审计）
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "网络异常";
      const { logGenerationError } = await import("./errorLogs.server");
      await logGenerationError({
        kind: "image",
        provider: "lovable-ai-asr",
        model: STT_MODEL,
        durationMs: Date.now() - started,
        requestPayload: { unitId: data.unitId, durationSec: data.durationSec },
        errorMessage: message,
      });
      return { ok: false, error: `转写请求失败：${message}`, degraded: false };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const { logGenerationError } = await import("./errorLogs.server");
      await logGenerationError({
        kind: "image",
        provider: "lovable-ai-asr",
        model: STT_MODEL,
        status: response.status,
        durationMs: Date.now() - started,
        requestPayload: { unitId: data.unitId, durationSec: data.durationSec },
        responseBody: body,
        errorMessage: `ASR HTTP ${response.status}`,
      });
      // 4xx 视为该音频不被端点接受，走「无台词」降级；5xx 仍按错误上抛文案
      const degraded = response.status >= 400 && response.status < 500;
      return {
        ok: false,
        error: `语音转写失败（HTTP ${response.status}）：${body.replace(/\s+/g, " ").slice(0, 200)}`,
        degraded,
      };
    }

    const payload = (await response.json().catch(() => null)) as SttVerbosePayload | null;
    const sentences = parseSttPayload(payload, data.sourceStartSeconds, data.durationSec);
    // 成功才扣费（1 分/次，与预校验口径一致）；扣费失败不阻断主流程。
    {
      const { supabase, userId } = context as { supabase: any; userId: string };
      const { chargeCredits } = await import("./userCredits.functions");
      await chargeCredits(supabase, userId, {
        amount: 1,
        model: STT_MODEL,
        description: "转绘语音转写",
      });
    }
    return { ok: true, sentences };
  });

/** STT 响应（json 或 verbose_json 兼容解析）→ 整集绝对毫秒台词句（纯函数，可测）。 */
export function parseSttPayload(
  payload: SttVerbosePayload | null,
  sourceStartSeconds: number,
  durationSec: number,
): RestyleAsrSentence[] {
  const offset = Math.round(sourceStartSeconds * 1000);
  const segments = Array.isArray(payload?.segments) ? payload.segments : [];
  const sentences: RestyleAsrSentence[] = segments
      .map((seg) => {
        const begin = Math.round(Number(seg.start ?? 0) * 1000) + offset;
        const end = Math.round(Number(seg.end ?? 0) * 1000) + offset;
        return {
          begin_ms: begin,
          end_ms: Math.max(end, begin),
          text: String(seg.text ?? "").trim(),
          speaker: "unknown",
        };
      })
      .filter((sentence) => sentence.text.length > 0);

  // 端点只回了整段 text 时兜底为一句（覆盖本片时长）
  if (sentences.length === 0 && typeof payload?.text === "string" && payload.text.trim()) {
    sentences.push({
      begin_ms: offset,
      end_ms: offset + Math.round(durationSec * 1000),
      text: payload.text.trim(),
      speaker: "unknown",
    });
  }
  return sentences;
}
