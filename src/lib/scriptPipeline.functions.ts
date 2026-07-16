import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { wrapFictionSystem, wrapFictionUser } from "./promptSafety";
import {
  ARK_TEXT_MODEL,
  ARK_TEXT_THINKING_DISABLED,
  arkTextApiKey,
  arkTextEndpoint,
  qwenApiKey,
} from "./arkText";

// ============= Shared types =============

const Lang = z.enum(["zh", "en"]);
const ScriptType = z.enum(["Micro", "Short", "Feature", "Ad"]);

const SceneSchema = z.object({
  index: z.number(),
  slug: z.string(),
  location: z.string(),
  timeOfDay: z.enum(["DAY", "NIGHT", "DUSK", "DAWN"]),
  action: z.string(),
  beats: z.array(z.string()).min(1).max(5),
  dialogue: z
    .array(
      z.object({
        role: z.string(),
        line: z.string(),
        parenthetical: z.string().optional(),
      }),
    )
    .min(1),
});
export type PipelineScene = z.infer<typeof SceneSchema>;

const ActSchema = z.object({
  title: z.string(),
  beats: z.array(z.string()).min(2).max(6),
});
export type PipelineAct = z.infer<typeof ActSchema>;

const CharacterSchema = z.object({
  name: z.string(),
  role: z.enum(["lead", "supporting", "villain"]),
  roleLabel: z.string(),
  age: z.union([z.number(), z.string()]).optional(),
  look: z.string(),
  personality: z.string(),
  motivation: z.string(),
  palette: z.array(z.string()).min(3).max(4),
});
export type PipelineCharacter = z.infer<typeof CharacterSchema>;

// ============= Provider dispatcher (OpenRouter + Lovable AI Gateway) =============

type Provider = "qwen" | "lovable" | "openrouter" | "ark";

// const OPENROUTER_FALLBACKS = [
//   'google/gemini-2.5-flash',
//   'deepseek/deepseek-chat-v3.1',
//   'meta-llama/llama-3.3-70b-instruct',
// ] as const

// const LOVABLE_FALLBACKS = [
//   'google/gemini-3-flash-preview',
//   'google/gemini-2.5-flash',
//   'openai/gpt-5-mini',
// ] as const

// const GEMINI_FALLBACKS = [
//   'gemini-3.5-flash',
//   'gemini-2.5-flash',
//   'gemini-2.5-pro',
// ] as const

const QWEN_FALLBACKS = ["qwen-plus", "qwen-max", "qwen-turbo"] as const;

const LOVABLE_FALLBACKS = [
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
] as const;

const OPENROUTER_FALLBACKS = [
  "google/gemini-2.5-flash",
  "deepseek/deepseek-chat-v3.1",
  "meta-llama/llama-3.3-70b-instruct",
] as const;

type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

// Model id syntax: "lovable:google/gemini-3-flash-preview" or "openrouter:google/gemini-2.5-flash".
// Bare ids (no provider prefix) default to OpenRouter for backward compatibility.
function parseModel(raw: string | undefined): { provider: Provider; model: string | undefined } {
  const v = raw?.trim();
  if (!v) return { provider: "qwen", model: undefined };
  if (v.startsWith("lovable:")) return { provider: "lovable", model: v.slice(8) };
  if (v.startsWith("openrouter:")) return { provider: "openrouter", model: v.slice(11) };
  if (v.startsWith("gemini:")) {
    const m = v.slice(7);
    return { provider: "lovable", model: m.includes("/") ? m : `google/${m}` };
  }
  if (v.startsWith("gpt:") || v.startsWith("openai:")) {
    const m = v.slice(v.indexOf(":") + 1);
    return { provider: "lovable", model: m.includes("/") ? m : `openai/${m}` };
  }
  if (v.startsWith("anthropic:") || v.startsWith("claude:")) {
    const m = v.slice(v.indexOf(":") + 1);
    return { provider: "openrouter", model: m.includes("/") ? m : `anthropic/${m}` };
  }
  if (v.startsWith("ark:")) return { provider: "ark", model: v.slice(4) || ARK_TEXT_MODEL };
  if (v.startsWith("deepseek:")) {
    // 历史前缀:以前 deepseek: 走 openrouter。2026/07 起改走 ARK(DeepSeek V4 Pro)。
    const m = v.slice(9);
    return { provider: "ark", model: m || ARK_TEXT_MODEL };
  }
  if (v.startsWith("meta:") || v.startsWith("llama:")) {
    const m = v.slice(v.indexOf(":") + 1);
    return { provider: "openrouter", model: m.includes("/") ? m : `meta-llama/${m}` };
  }
  if (v.startsWith("mistral:")) {
    const m = v.slice(8);
    return { provider: "openrouter", model: m.includes("/") ? m : `mistralai/${m}` };
  }
  if (v.startsWith("xai:") || v.startsWith("grok:")) {
    const m = v.slice(v.indexOf(":") + 1);
    return { provider: "openrouter", model: m.includes("/") ? m : `x-ai/${m}` };
  }
  if (v.startsWith("qwen:")) return { provider: "qwen", model: v.slice(5) };
  return { provider: "qwen", model: v };
}

async function callToolCall<T>(opts: {
  model: string | undefined;
  system: string;
  user: string;
  tool: ToolSpec;
  temperature: number;
}): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const { provider: pickedProvider, model: pickedModel } = parseModel(opts.model);

  // 2026/07:构建跨 provider 尝试序列。系统默认(无 model)走 ARK DeepSeek V4 Pro 为主、
  // Qwen 兜底;显式 provider 则只在该 provider 内 [model, ...fallbacks] 尝试。
  type Attempt = { provider: Provider; model: string };
  const attempts: Attempt[] = [];
  const pushSeq = (p: Provider, m: string | undefined, fb: readonly string[]) => {
    const seq = [...new Set([m, ...fb].filter(Boolean))] as string[];
    for (const mm of seq) attempts.push({ provider: p, model: mm });
  };
  const isDefault = pickedProvider === "qwen" && !pickedModel;
  if (isDefault) {
    if (arkTextApiKey()) attempts.push({ provider: "ark", model: ARK_TEXT_MODEL });
    pushSeq("qwen", pickedModel, QWEN_FALLBACKS);
  } else if (pickedProvider === "ark") {
    attempts.push({ provider: "ark", model: pickedModel || ARK_TEXT_MODEL });
  } else if (pickedProvider === "lovable") {
    pushSeq("lovable", pickedModel, LOVABLE_FALLBACKS);
  } else if (pickedProvider === "openrouter") {
    pushSeq("openrouter", pickedModel, OPENROUTER_FALLBACKS);
  } else {
    pushSeq("qwen", pickedModel, QWEN_FALLBACKS);
  }

  let lastError = "Generation failed";

  for (const attempt of attempts) {
    const p = attempt.provider;
    const m = attempt.model;
    const apiKey =
      p === "lovable"
        ? process.env.LOVABLE_API_KEY
        : p === "openrouter"
          ? process.env.OPENROUTER_API_KEY
          : p === "ark"
            ? arkTextApiKey()
            : qwenApiKey();
    if (!apiKey) {
      lastError = `${p} API key missing`;
      continue;
    }
    const endpoint =
      p === "lovable"
        ? "https://ai.gateway.lovable.dev/v1/chat/completions"
        : p === "openrouter"
          ? "https://openrouter.ai/api/v1/chat/completions"
          : p === "ark"
            ? arkTextEndpoint()
            : "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    if (p === "openrouter") {
      headers["HTTP-Referer"] = "https://doopoo.app";
      headers["X-Title"] = "Doopoo";
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 55_000);
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: m,
          // Lovable AI Gateway (GPT-5 family etc.) only accepts default temperature=1.
          ...(p === "lovable" ? {} : { temperature: opts.temperature }),
          // ark(DeepSeek V4 Pro):关闭深度思考,走通用对话快模式
          ...(p === "ark" ? { thinking: ARK_TEXT_THINKING_DISABLED } : {}),
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
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
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        if (res.status === 403 && /terms of service|prohibited|policy/i.test(txt)) {
          lastError = "content_policy";
        } else if (res.status === 429) {
          lastError = "rate_limit";
        } else if (res.status === 402) {
          lastError = "no_credits";
        } else {
          lastError = `${p} ${res.status}: ${txt.slice(0, 200)}`;
        }
        // 跨 provider 兜底:任何失败都继续下一个 attempt(可能换 key/换 provider 成功)
        continue;
      }

      const json = await res.json();
      const argsStr =
        json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ??
        json?.choices?.[0]?.message?.content;
      if (!argsStr) {
        lastError = "Empty tool call";
        continue;
      }
      try {
        return { ok: true, data: JSON.parse(argsStr) as T };
      } catch {
        lastError = "JSON parse error";
        continue;
      }
    } catch (e) {
      lastError =
        e instanceof Error && e.name === "AbortError"
          ? "Request timed out"
          : e instanceof Error
            ? e.message
            : "Network error";
    }
  }

  // Cross-provider fallback: if blocked by ToS / content policy on the chosen provider,
  // retry with Lovable Gateway Gemini which is more permissive for creative writing.
  if (
    lastError === "content_policy" &&
    pickedProvider !== "lovable" &&
    process.env.LOVABLE_API_KEY
  ) {
    const fallbackRes = await callToolCall<T>({
      ...opts,
      model: "lovable:google/gemini-3-flash-preview",
    });
    if (fallbackRes.ok) return fallbackRes;
    return { ok: false, error: "content_policy" };
  }

  return { ok: false, error: lastError };
}

// ============= System prompts =============

const SYS_ZH_BASE =
  "你是一位资深中文短剧编剧，擅长强冲突、强反转、强情绪的爆款短剧。所有产出必须以工具调用 JSON 返回，禁止输出额外解释。" +
  '硬性要求：1) 场标格式 "INT./EXT. 中文地点 — 时段"；2) 单句对白 ≤ 30 字，禁止说教；' +
  "3) 每场至少 1 个冲突 beat（人物之间或与环境）；4) 角色名稳定一致；5) 描写有画面感，避免空洞。";

const SYS_EN_BASE =
  "You are a seasoned short-drama screenwriter. Always return structured JSON via the tool call only. " +
  'Hard rules: 1) Scene heading "INT./EXT. LOCATION — TIME"; 2) Each dialogue line ≤ 14 words, no exposition dumps; ' +
  "3) Every scene has at least one conflict beat; 4) Character names stay consistent; 5) Vivid, visual action lines.";

const sysFor = (lang: "zh" | "en", extra: string) =>
  wrapFictionSystem(lang, (lang === "zh" ? SYS_ZH_BASE : SYS_EN_BASE) + "\n" + extra);

// ============= 1) Logline =============

const LoglineInput = z.object({
  lang: Lang,
  type: ScriptType,
  genre: z.string(),
  tone: z.string(),
  theme: z.string().min(1).max(200),
  plot: z.string().min(1).max(2000),
  model: z.string().optional(),
});

export const genLogline = createServerFn({ method: "POST" })
  .validator((d: unknown) => LoglineInput.parse(d))
  .handler(async ({ data }) => {
    const sys = sysFor(
      data.lang,
      data.lang === "zh"
        ? `本次任务：把用户灵感升级为爆款短剧的 logline 与核心前提。logline 一句 ≤ 50 字，必须含"主角 + 困境 + 反转钩子"。`
        : `Task: turn the idea into a hook-driven logline (<= 30 words) with subject + dilemma + twist.`,
    );

    const user =
      data.lang === "zh"
        ? `【类型】${data.type}\n【题材】${data.genre}\n【风格】${data.tone}\n【主题】${data.theme}\n【概要】${data.plot}`
        : `[Type] ${data.type}\n[Genre] ${data.genre}\n[Tone] ${data.tone}\n[Theme] ${data.theme}\n[Plot] ${data.plot}`;

    return callToolCall<{ logline: string; premise: string; themes: string[] }>({
      model: data.model,
      system: sys,
      user: wrapFictionUser(data.lang, user),
      temperature: 0.9,
      tool: {
        name: "emit_logline",
        description: "Return the polished logline, premise and themes.",
        parameters: {
          type: "object",
          properties: {
            logline: { type: "string" },
            premise: { type: "string" },
            themes: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
          },
          required: ["logline", "premise", "themes"],
        },
      },
    });
  });

// ============= 2) Outline (three acts) =============

const OutlineInput = z.object({
  lang: Lang,
  type: ScriptType,
  genre: z.string(),
  tone: z.string(),
  logline: z.string(),
  premise: z.string().optional(),
  model: z.string().optional(),
});

export const genOutline = createServerFn({ method: "POST" })
  .validator((d: unknown) => OutlineInput.parse(d))
  .handler(async ({ data }) => {
    const sys = sysFor(
      data.lang,
      data.lang === "zh"
        ? "本次任务：基于 logline 输出严格三幕结构，每幕 3-5 个 beats，节奏先抑后扬，第二幕含至少一次重大反转，第三幕含情绪高潮。"
        : "Task: write a strict 3-act outline, 3-5 beats per act, with a major twist in Act 2 and emotional climax in Act 3.",
    );
    const user =
      data.lang === "zh"
        ? `【类型】${data.type} / ${data.genre} / ${data.tone}\n【logline】${data.logline}\n${data.premise ? `【前提】${data.premise}` : ""}`
        : `[Type] ${data.type} / ${data.genre} / ${data.tone}\n[Logline] ${data.logline}\n${data.premise ? `[Premise] ${data.premise}` : ""}`;

    return callToolCall<{ acts: PipelineAct[] }>({
      model: data.model,
      system: sys,
      user: wrapFictionUser(data.lang, user),
      temperature: 0.8,
      tool: {
        name: "emit_outline",
        description: "Return a three-act outline.",
        parameters: {
          type: "object",
          properties: {
            acts: {
              type: "array",
              minItems: 3,
              maxItems: 3,
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  beats: {
                    type: "array",
                    items: { type: "string" },
                    minItems: 3,
                    maxItems: 5,
                  },
                },
                required: ["title", "beats"],
              },
            },
          },
          required: ["acts"],
        },
      },
    });
  });

// ============= 3) Scenes =============

const ScenesInput = z.object({
  lang: Lang,
  type: ScriptType,
  genre: z.string(),
  tone: z.string(),
  logline: z.string(),
  acts: z.array(ActSchema),
  sceneCount: z.number().min(3).max(12).default(5),
  knownCharacters: z.array(z.string()).optional(),
  model: z.string().optional(),
});

export const genScenes = createServerFn({ method: "POST" })
  .validator((d: unknown) => ScenesInput.parse(d))
  .handler(async ({ data }) => {
    const sys = sysFor(
      data.lang,
      data.lang === "zh"
        ? `本次任务：把三幕大纲分解为 ${data.sceneCount} 个连续场次。每场必须有：完整 slug、80-160 字动作描写、2-4 个 beats（其中至少 1 个为冲突/反转）、3-6 句对白（节奏紧凑可带括号情绪）。覆盖三幕节奏：开场钩子 → 升级冲突 → 高潮 → 余韵。`
        : `Task: break the outline into ${data.sceneCount} consecutive scenes. Each needs: full slug, 60-120 word action, 2-4 beats (>=1 conflict), 3-6 dialogue lines with optional parentheticals. Hit hook -> escalation -> climax -> coda.`,
    );

    const actsText = data.acts
      .map((a, i) => `Act ${i + 1} ${a.title}\n- ${a.beats.join("\n- ")}`)
      .join("\n\n");

    const user =
      data.lang === "zh"
        ? `【类型】${data.type} / ${data.genre} / ${data.tone}\n【logline】${data.logline}\n【三幕】\n${actsText}\n${data.knownCharacters?.length ? `【已知角色，请复用名字】${data.knownCharacters.join("、")}` : ""}`
        : `[Type] ${data.type} / ${data.genre} / ${data.tone}\n[Logline] ${data.logline}\n[Acts]\n${actsText}\n${data.knownCharacters?.length ? `[Reuse character names] ${data.knownCharacters.join(", ")}` : ""}`;

    return callToolCall<{ scenes: PipelineScene[] }>({
      model: data.model,
      system: sys,
      user: wrapFictionUser(data.lang, user),
      temperature: 0.75,
      tool: {
        name: "emit_scenes",
        description: "Return structured scenes.",
        parameters: {
          type: "object",
          properties: {
            scenes: {
              type: "array",
              minItems: Math.max(3, data.sceneCount - 1),
              maxItems: data.sceneCount + 1,
              items: {
                type: "object",
                properties: {
                  index: { type: "number" },
                  slug: { type: "string", description: "INT./EXT. LOCATION — TIME" },
                  location: { type: "string" },
                  timeOfDay: { type: "string", enum: ["DAY", "NIGHT", "DUSK", "DAWN"] },
                  action: { type: "string" },
                  beats: {
                    type: "array",
                    items: { type: "string" },
                    minItems: 2,
                    maxItems: 4,
                  },
                  dialogue: {
                    type: "array",
                    minItems: 1,
                    items: {
                      type: "object",
                      properties: {
                        role: { type: "string" },
                        line: { type: "string" },
                        parenthetical: { type: "string" },
                      },
                      required: ["role", "line"],
                    },
                  },
                },
                required: ["index", "slug", "location", "timeOfDay", "action", "beats", "dialogue"],
              },
            },
          },
          required: ["scenes"],
        },
      },
    });
  });

// ============= 4) Characters =============

const CharactersInput = z.object({
  lang: Lang,
  logline: z.string(),
  scenes: z.array(SceneSchema).optional(),
  model: z.string().optional(),
});

export const genCharacters = createServerFn({ method: "POST" })
  .validator((d: unknown) => CharactersInput.parse(d))
  .handler(async ({ data }) => {
    const sys = sysFor(
      data.lang,
      data.lang === "zh"
        ? "本次任务：提取/补全 3-5 位角色卡（至少 1 主角 + 1 反派/对手）。palette 给出 3-4 个匹配人物气质的 hex 颜色。"
        : "Task: extract/expand 3-5 character cards (>= 1 lead, 1 antagonist). palette: 3-4 hex colors matching their vibe.",
    );

    const scenesText = (data.scenes ?? [])
      .map(
        (s) =>
          `SC${s.index} ${s.slug}\n${s.action}\n${s.dialogue.map((d) => `${d.role}: ${d.line}`).join("\n")}`,
      )
      .join("\n\n")
      .slice(0, 6000);

    const user =
      data.lang === "zh"
        ? `【logline】${data.logline}\n${scenesText ? `【场次摘录】\n${scenesText}` : ""}`
        : `[Logline] ${data.logline}\n${scenesText ? `[Scene excerpts]\n${scenesText}` : ""}`;

    return callToolCall<{ characters: PipelineCharacter[] }>({
      model: data.model,
      system: sys,
      user: wrapFictionUser(data.lang, user),
      temperature: 0.85,
      tool: {
        name: "emit_characters",
        description: "Return character cards.",
        parameters: {
          type: "object",
          properties: {
            characters: {
              type: "array",
              minItems: 3,
              maxItems: 6,
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  role: { type: "string", enum: ["lead", "supporting", "villain"] },
                  roleLabel: { type: "string" },
                  age: { type: ["number", "string"] },
                  look: { type: "string" },
                  personality: { type: "string" },
                  motivation: { type: "string" },
                  palette: {
                    type: "array",
                    items: { type: "string" },
                    minItems: 3,
                    maxItems: 4,
                  },
                },
                required: [
                  "name",
                  "role",
                  "roleLabel",
                  "look",
                  "personality",
                  "motivation",
                  "palette",
                ],
              },
            },
          },
          required: ["characters"],
        },
      },
    });
  });

// ============= 5) Rewrite single scene =============

const RewriteSceneInput = z.object({
  lang: Lang,
  scene: SceneSchema,
  instruction: z.string().min(1),
  model: z.string().optional(),
});

export const rewriteScene = createServerFn({ method: "POST" })
  .validator((d: unknown) => RewriteSceneInput.parse(d))
  .handler(async ({ data }) => {
    const sys = sysFor(
      data.lang,
      data.lang === "zh"
        ? "本次任务：按指令重写下面这一场，保持 slug/index 不变，结构字段齐全。"
        : "Task: rewrite this single scene per the instruction. Keep slug and index, return the full schema.",
    );
    const user =
      data.lang === "zh"
        ? `【重写指令】${data.instruction}\n【原场次 JSON】\n${JSON.stringify(data.scene, null, 2)}`
        : `[Instruction] ${data.instruction}\n[Original scene JSON]\n${JSON.stringify(data.scene, null, 2)}`;

    return callToolCall<{ scene: PipelineScene }>({
      model: data.model,
      system: sys,
      user: wrapFictionUser(data.lang, user),
      temperature: 0.7,
      tool: {
        name: "emit_scene",
        description: "Return the rewritten scene.",
        parameters: {
          type: "object",
          properties: {
            scene: {
              type: "object",
              properties: {
                index: { type: "number" },
                slug: { type: "string" },
                location: { type: "string" },
                timeOfDay: { type: "string", enum: ["DAY", "NIGHT", "DUSK", "DAWN"] },
                action: { type: "string" },
                beats: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
                dialogue: {
                  type: "array",
                  minItems: 1,
                  items: {
                    type: "object",
                    properties: {
                      role: { type: "string" },
                      line: { type: "string" },
                      parenthetical: { type: "string" },
                    },
                    required: ["role", "line"],
                  },
                },
              },
              required: ["index", "slug", "location", "timeOfDay", "action", "beats", "dialogue"],
            },
          },
          required: ["scene"],
        },
      },
    });
  });
