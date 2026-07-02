import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { wrapFictionSystem, wrapFictionUser } from "./promptSafety";
import { pickModel } from "./scriptAgent.functions";

// ============================================================
// 导入剧本：将用户粘贴/上传的剧本文本按"集"边界拆开。
// 与 streaming 创作流程（streamSynopsis / streamEpisodeScenes）解耦：
// - 输入是结构化 JSON 友好的 rawText
// - 输出也是结构化 JSON（synopsis + episodes 数组）
// - handler 改为 async generator：分阶段 yield 进度事件给客户端，
//   避免长任务下"球状 spinner 静止 60s+ 再抛 AbortError"的死等感
// ============================================================

const Lang = z.enum(["zh", "en"]);

const ParseInput = z.object({
  lang: Lang,
  rawText: z.string().min(20).max(500_000),
  model: z.string().optional(),
});

export type ImportedScriptResult = {
  /** 一句话故事简介，≤ 200 字 */
  synopsis: string;
  /** 按 epIndex 升序排列 */
  episodes: { epIndex: number; text: string }[];
};

/**
 * 流式事件：
 * - progress: 阶段状态更新（"正在分析文本…"、"正在请求 AI…" 等）
 * - done:     成功，result 为结构化剧本
 * - error:    失败，message 给用户看
 *
 * 使用 async generator 是为了 (1) 让客户端 modal 能边等边显示阶段文案，
 * 避免长任务下"球状 spinner 静止 60s"的死等感；(2) 与 streamSynopsis
 * 保持同一套消费模式（useServerFn + for-await）。
 */
export type ParseStreamEvent =
  | { kind: "progress"; message: string }
  | { kind: "done"; result: ImportedScriptResult }
  | { kind: "error"; message: string };

// ============= Provider fetch (non-streaming, single shot) =============

type Provider = "lovable" | "qwen" | "openrouter";

const QWEN_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const LOVABLE_ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const RETRYABLE_STATUSES = new Set([403, 404, 429, 500, 502, 503]);

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

async function fetchChat(opts: {
  provider: Provider;
  model: string;
  system: string;
  user: string;
  tool: ToolSpec;
  temperature?: number;
  // 整体超时（毫秒）。导入剧本是非流式整段返回，输入可达 500K 字符、
  // 输出 32K tokens，常见 60-90s；默认 180s 比 streamChat 用的 55s 宽松。
  timeoutMs?: number;
}): Promise<string> {
  const apiKey =
    opts.provider === "lovable"
      ? process.env.LOVABLE_API_KEY
      : opts.provider === "openrouter"
        ? process.env.OPENROUTER_API_KEY
        : process.env.Qwen;
  if (!apiKey) throw new Error(`${opts.provider} API key missing`);

  const endpoint =
    opts.provider === "lovable"
      ? LOVABLE_ENDPOINT
      : opts.provider === "openrouter"
        ? OPENROUTER_ENDPOINT
        : QWEN_ENDPOINT;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (opts.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://doopoo.app";
    headers["X-Title"] = "Doopoo";
  }

  const messages: ChatMsg[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: opts.model,
        // Lovable AI Gateway (GPT-5 family etc.) only accepts default temperature=1.
        ...(opts.provider === "lovable" ? {} : { temperature: opts.temperature ?? 0.2 }),
        messages,
        tools: [
          {
            type: "function",
            function: {
              name: opts.tool.name,
              description: opts.tool.description,
              parameters: opts.tool.parameters,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: opts.tool.name } },
        max_tokens: 32_000,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401) throw new Error(`${opts.provider} auth failed (401)`);
    if (res.status === 402) throw new Error("no_credits");
    if (res.status === 429) throw new Error("rate_limit");
    if (res.status === 403 && /terms of service|prohibited|policy|moderation/i.test(text)) {
      throw new Error("content_policy");
    }
    throw new Error(`${opts.provider} ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const argsStr =
    json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ??
    json?.choices?.[0]?.message?.content;
  if (!argsStr) throw new Error("Empty tool call response");
  return typeof argsStr === "string" ? argsStr : JSON.stringify(argsStr);
}

// ============= Prompts =============

const SYS_ZH = `你是一位资深的剧本结构化助手。你的唯一任务是：把用户给的长文本（可能是小说、剧本、或大纲）拆分成"按集"的内容，并生成一句简短的故事简介。

【输入语言检测】
- 如果用户文本主要是中文，输出中文 synopsis 和保留中文原文
- 如果是英文，输出英文
- 中英混合时跟随主语言

【集边界检测 — 多种格式都要识别】
请按以下优先级识别集数边界（以匹配到的第一个为准）：
1) 中文行首："第 1 集" / "第1集" / "第一集" / "第 一 集" / "第01集" / "第 1 章" / "第一章" / "第 1 话" / "第 1 回"
2) 中文行首："第一幕" / "第二幕" / "第三幕"（视为集 1/2/3）
3) 英文行首："Episode 1" / "Ep 1" / "Ep01" / "EP 1" / "Episode One" / "Chapter 1" / "Ch. 1" / "Act 1"
4) 数字标题独占一行："01" / "01." / "EP01" / "EP.01" / "Episode 01"
5) **回退**：若以上都不匹配，按"内景"/"INT."/"外景"/"EXT." 等场标粗略切分；但集数要保守——只在文本有明确分集标志时切分，否则整段视为 1 集

【synopsis 生成】
- 一句话故事简介，**不超过 200 字符**（含标点）
- 风格：什么题材 + 主角 + 核心冲突 + 一句话爽点
- 不要分点、不要 Markdown、不要 emoji
- 例："小职员意外获得预知未来的能力，靠一次次精准踩点逆袭成商界大佬，但每一次预言都在消耗身边人的寿命。"

【剧本文本保留】
- 每集 text 必须**完整保留原文内容**（含场景描写、对白、动作指示），不要改写、删减、提炼
- 保留原文的换行、缩进、对白格式
- 如果一集 text 超过 50 字符，应是完整段落或数段

【输出格式 — 严格 JSON】
调用工具 emit_imported_script 一次性返回结果，禁止任何额外文字、解释、前后缀。
epIndex 必须从 1 开始，按出现顺序递增。可以保留原始集号（如 epIndex=5 表示原文中的第 5 集），不必重排为 1,2,3。
如果整段文本没有集数边界（fallback 5），全部内容作为 epIndex=1 一集返回。`;

const SYS_EN = `You are a senior script-structuring assistant. Your ONLY job: split a long user-supplied text (novel, script, or outline) into per-episode segments, and produce a one-sentence synopsis.

【Input language detection】
- If the user's text is mostly Chinese, output a Chinese synopsis and preserve the original Chinese episode text.
- If mostly English, output English.
- For mixed-language input, follow the dominant language.

【Episode boundary detection — recognize many formats】
Use the first match by priority:
1) Chinese line-start: "第 1 集" / "第1集" / "第一集" / "第 1 章" / "第一章" / "第 1 话" / "第 1 回"
2) Chinese line-start: "第一幕" / "第二幕" / "第三幕" (treat as ep 1/2/3)
3) English line-start: "Episode 1" / "Ep 1" / "Ep01" / "EP 1" / "Episode One" / "Chapter 1" / "Ch. 1" / "Act 1"
4) Standalone numeric title on its own line: "01" / "01." / "EP01" / "EP.01" / "Episode 01"
5) **Fallback**: if none match, split on scene-heading markers ("INT." / "EXT."); be conservative — only split when there is a clear episode boundary, otherwise treat the whole text as 1 episode.

【Synopsis】
- One sentence, **≤ 200 characters** (including punctuation)
- Style: genre + protagonist + core conflict + one-line hook
- No bullets, no Markdown, no emoji
- Example: "An overlooked office worker gains the power to glimpse the future, but every prophecy drains a year from someone he loves."

【Episode text preservation】
- Each episode's text must preserve the **complete original content** (scenes, dialogue, action lines); do NOT rewrite, summarize, or trim
- Preserve original line breaks, indentation, and dialogue formatting
- Each episode's text should be > 50 chars (a full paragraph or several)

【Output format — strict JSON】
Call the tool emit_imported_script once. No extra prose, no preamble, no postscript.
epIndex must start at 1 and increment in appearance order. Keep the original episode number (e.g. epIndex=5 means episode 5 in the source); do not renumber to 1,2,3.
If no episode boundary is detected (fallback 5), return the whole text as epIndex=1.`;

// ============= Server fn =============

const IMPORT_TOOL = {
  name: "emit_imported_script",
  description:
    "Return the parsed script: a one-sentence synopsis and a list of episodes with verbatim text.",
  parameters: {
    type: "object",
    properties: {
      synopsis: { type: "string", maxLength: 400 },
      episodes: {
        type: "array",
        minItems: 1,
        maxItems: 500,
        items: {
          type: "object",
          properties: {
            epIndex: { type: "integer", minimum: 1, maximum: 999 },
            text: { type: "string", minLength: 1 },
          },
          required: ["epIndex", "text"],
        },
      },
    },
    required: ["synopsis", "episodes"],
  },
};

export const parseImportedScript = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ParseInput.parse(d))
  .handler(async function* ({ data }): AsyncGenerator<ParseStreamEvent> {
    // ===== Stage 1: pre-flight =====
    yield { kind: "progress", message: "正在分析输入文本…" };

    const picked = pickModel(data.model);
    const baseSys = data.lang === "zh" ? SYS_ZH : SYS_EN;
    const sys = wrapFictionSystem(data.lang, baseSys);
    const userRaw =
      data.lang === "zh"
        ? `【待拆分文本（长度 ${data.rawText.length} 字符）】\n${data.rawText}`
        : `[Input text (${data.rawText.length} chars)]\n${data.rawText}`;
    const user = wrapFictionUser(data.lang, userRaw);

    // ===== Stage 2: AI call (long-running, single shot) =====
    yield {
      kind: "progress",
      message:
        data.lang === "zh"
          ? `已提交给 ${picked.provider} / ${picked.model}，正在分析并切分集数…`
          : `Submitted to ${picked.provider} / ${picked.model}, analyzing and splitting…`,
    };

    let raw: string;
    try {
      raw = await fetchChat({
        provider: picked.provider,
        model: picked.model,
        system: sys,
        user,
        tool: IMPORT_TOOL,
        temperature: 0.2,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      // AbortError 来自我们自己的超时定时器，转成用户友好文案
      const isAbort = e instanceof Error && e.name === "AbortError";
      const userMsg = isAbort
        ? data.lang === "zh"
          ? "AI 处理超时（>180s），请尝试更小的剧本或换其他模型"
          : "AI processing timed out (>180s). Try a smaller script or another model."
        : msg;
      // Cross-provider fallback for ToS / moderation (mirror streamChat behaviour)
      if (
        msg === "content_policy" &&
        picked.provider !== "lovable" &&
        process.env.LOVABLE_API_KEY
      ) {
        yield {
          kind: "progress",
          message: data.lang === "zh" ? "切换到备用模型…" : "Falling back to backup model…",
        };
        try {
          raw = await fetchChat({
            provider: "lovable",
            model: "google/gemini-3-flash-preview",
            system: sys,
            user,
            tool: IMPORT_TOOL,
            temperature: 0.2,
          });
        } catch (e2) {
          const inner = e2 instanceof Error ? e2.message : "content_policy";
          yield { kind: "error", message: inner };
          return;
        }
      } else {
        yield { kind: "error", message: userMsg };
        return;
      }
    }

    // ===== Stage 3: parse + normalize =====
    yield {
      kind: "progress",
      message: data.lang === "zh" ? "AI 已返回，正在解析结果…" : "AI responded, parsing…",
    };

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      yield { kind: "error", message: "AI 返回的不是合法 JSON" };
      return;
    }

    const rawSynopsis = typeof parsed?.synopsis === "string" ? parsed.synopsis.trim() : "";
    const rawEpisodes = Array.isArray(parsed?.episodes) ? parsed.episodes : [];
    if (rawEpisodes.length === 0) {
      yield { kind: "error", message: "AI 未检测到任何集数，请检查文本是否包含分集标志" };
      return;
    }

    // Normalize episodes: filter empty, floor epIndex, sort, dedupe
    const cleaned = rawEpisodes
      .map((e: any, i: number) => {
        const idx =
          typeof e?.epIndex === "number" && Number.isFinite(e.epIndex)
            ? Math.floor(e.epIndex)
            : i + 1;
        const text = typeof e?.text === "string" ? e.text.trim() : "";
        return { epIndex: Math.max(1, idx), text };
      })
      .filter((e: { epIndex: number; text: string }) => e.text.length > 0);

    if (cleaned.length === 0) {
      yield { kind: "error", message: "解析后集数内容均为空" };
      return;
    }

    cleaned.sort((a: { epIndex: number }, b: { epIndex: number }) => a.epIndex - b.epIndex);

    const seen = new Set<number>();
    const deduped: { epIndex: number; text: string }[] = [];
    for (const e of cleaned) {
      if (seen.has(e.epIndex)) continue;
      seen.add(e.epIndex);
      deduped.push(e);
    }

    const synopsis = (rawSynopsis || `导入剧本（${deduped.length} 集）`).slice(0, 200);
    yield {
      kind: "progress",
      message:
        data.lang === "zh"
          ? `已识别 ${deduped.length} 集，正在写入…`
          : `Identified ${deduped.length} episodes, writing…`,
    };
    yield { kind: "done", result: { synopsis, episodes: deduped } };
  });
