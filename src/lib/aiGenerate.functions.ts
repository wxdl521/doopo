import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const StageEnum = z.enum(['canvas', 'script', 'character', 'storyboard', 'timeline'])

const InputSchema = z.object({
  stage: StageEnum,
  userPrompt: z.string().min(1).max(4000),
  // Lightweight context from the workspace so later stages can build on earlier ones.
  context: z
    .object({
      logline: z.string().optional(),
      acts: z
        .array(z.object({ title: z.string(), beats: z.array(z.string()) }))
        .optional(),
      scenes: z
        .array(
          z.object({
            index: z.number(),
            slug: z.string(),
            action: z.string(),
            beats: z.array(z.string()).optional(),
          }),
        )
        .optional(),
      characters: z
        .array(z.object({ name: z.string(), roleLabel: z.string() }))
        .optional(),
    })
    .optional(),
})

type Input = z.infer<typeof InputSchema>

function stageSpec(stage: Input['stage']) {
  switch (stage) {
    case 'canvas':
      return {
        toolName: 'emit_outline',
        system:
          '你是一名中文短剧编剧，负责把用户的一句话灵感扩展成"三幕剧本概要"。要求：基调贴合用户描述；logline 一句不超过 60 个汉字；每幕 3-4 个 beats；语言精炼、画面感强；只调用工具返回结构化数据，不要输出额外文字。',
        schema: {
          type: 'object',
          properties: {
            logline: { type: 'string' },
            acts: {
              type: 'array',
              minItems: 3,
              maxItems: 3,
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  beats: {
                    type: 'array',
                    minItems: 3,
                    maxItems: 5,
                    items: { type: 'string' },
                  },
                },
                required: ['title', 'beats'],
                additionalProperties: false,
              },
            },
          },
          required: ['logline', 'acts'],
          additionalProperties: false,
        },
      }
    case 'script':
      return {
        toolName: 'emit_scenes',
        system:
          '你是一名中文短剧编剧。基于已有的 logline / acts（如果提供）以及用户输入，写出 4 个连续的场次。每场需要：场次号、场标 INT./EXT. 中文 - 时间、动作描写（80-160 字）、3 个 beats、3-5 句对白（含可选括号情绪）。语言节奏紧凑，符合短剧。仅以工具调用返回结构化结果。',
        schema: {
          type: 'object',
          properties: {
            scenes: {
              type: 'array',
              minItems: 3,
              maxItems: 5,
              items: {
                type: 'object',
                properties: {
                  index: { type: 'number' },
                  slug: { type: 'string', description: '如 "INT. 高三(2)班 自习室 — 黄昏"' },
                  location: { type: 'string' },
                  timeOfDay: { type: 'string', enum: ['DAY', 'NIGHT', 'DUSK', 'DAWN'] },
                  action: { type: 'string' },
                  beats: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
                  dialogue: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      properties: {
                        role: { type: 'string' },
                        line: { type: 'string' },
                        parenthetical: { type: 'string' },
                      },
                      required: ['role', 'line'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['index', 'slug', 'location', 'timeOfDay', 'action', 'beats', 'dialogue'],
                additionalProperties: false,
              },
            },
          },
          required: ['scenes'],
          additionalProperties: false,
        },
      }
    case 'character':
      return {
        toolName: 'emit_characters',
        system:
          '你是一名动漫角色设计师 + 编剧。结合用户输入、logline / acts / scenes 提取或新建 3-5 位角色（至少 1 主角，可含配角与反派）。每位需要：名字、role(lead/supporting/villain)、roleLabel(中文短描述如"女主 · 高冷学霸")、age、look(外形)、personality(性格)、motivation(动机)、debutShot(首场镜头描述)、palette(3-4 个 hex 颜色，匹配角色调性)。仅工具调用返回。',
        schema: {
          type: 'object',
          properties: {
            characters: {
              type: 'array',
              minItems: 3,
              maxItems: 6,
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  role: { type: 'string', enum: ['lead', 'supporting', 'villain'] },
                  roleLabel: { type: 'string' },
                  age: { type: 'number' },
                  look: { type: 'string' },
                  personality: { type: 'string' },
                  motivation: { type: 'string' },
                  debutShot: { type: 'string' },
                  palette: {
                    type: 'array',
                    minItems: 3,
                    maxItems: 4,
                    items: { type: 'string', description: 'hex like #1e293b' },
                  },
                },
                required: ['name', 'role', 'roleLabel', 'age', 'look', 'personality', 'motivation', 'debutShot', 'palette'],
                additionalProperties: false,
              },
            },
          },
          required: ['characters'],
          additionalProperties: false,
        },
      }
    case 'storyboard':
      return {
        toolName: 'emit_storyboard',
        system:
          '你是一名分镜师。基于 scenes 设计 8-16 个分镜面板，覆盖每场关键节奏。每个 panel 需要：sceneIndex(对应场次号)、shot(WS/MS/CU/ECU/OTS)、camera(机位与镜头描述)、action(画面内容)、emotion(情绪关键词)、durationSec(1-5)。镜头组合需有节奏对比。仅工具调用返回。',
        schema: {
          type: 'object',
          properties: {
            panels: {
              type: 'array',
              minItems: 6,
              maxItems: 20,
              items: {
                type: 'object',
                properties: {
                  sceneIndex: { type: 'number' },
                  shot: { type: 'string', enum: ['WS', 'MS', 'CU', 'ECU', 'OTS'] },
                  camera: { type: 'string' },
                  action: { type: 'string' },
                  emotion: { type: 'string' },
                  durationSec: { type: 'number' },
                },
                required: ['sceneIndex', 'shot', 'camera', 'action', 'emotion', 'durationSec'],
                additionalProperties: false,
              },
            },
          },
          required: ['panels'],
          additionalProperties: false,
        },
      }
    case 'timeline':
      return {
        toolName: 'emit_timeline',
        system:
          '你是一名影视剪辑师。基于已有的分镜面板（panels）和剧本次序，设计完整的时间轴规划。包含视频轨（每张分镜对应一个视频片段）、音频轨（BGM/SFX 建议）、字幕轨（关键台词）、过渡点（场景切换位置）。每个视频片段 durationSec 需与分镜一致。仅工具调用返回。',
        schema: {
          type: 'object',
          properties: {
            tracks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: ['video', 'audio', 'subtitle'] },
                  label: { type: 'string' },
                  clips: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        startSec: { type: 'number' },
                        durationSec: { type: 'number' },
                        label: { type: 'string' },
                        panelIndex: { type: 'number', description: '对应分镜面板序号，仅 video 类型需要' },
                      },
                      required: ['startSec', 'durationSec', 'label'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['kind', 'label', 'clips'],
                additionalProperties: false,
              },
            },
            transitionsAt: {
              type: 'array',
              description: '过渡点时间轴位置（秒）',
              items: { type: 'number' },
            },
          },
          required: ['tracks', 'transitionsAt'],
          additionalProperties: false,
        },
      }
  }
}

export const generateStageAi = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }) => {
    const spec = stageSpec(data.stage)
    const ctxParts: string[] = []
    if (data.context?.logline) ctxParts.push(`【已有 logline】${data.context.logline}`)
    if (data.context?.acts?.length) {
      ctxParts.push(
        `【已有三幕】\n${data.context.acts
          .map((a) => `${a.title}\n- ${a.beats.join('\n- ')}`)
          .join('\n\n')}`,
      )
    }
    if (data.context?.scenes?.length) {
      ctxParts.push(
        `【已有场次】\n${data.context.scenes
          .map((s) => `SC${s.index} ${s.slug}\n${s.action}`)
          .join('\n\n')}`,
      )
    }
    if (data.context?.characters?.length) {
      ctxParts.push(`【已有角色】${data.context.characters.map((c) => `${c.name}(${c.roleLabel})`).join('、')}`)
    }
    const userContent = [ctxParts.join('\n\n'), `【本次需求】\n${data.userPrompt}`]
      .filter(Boolean)
      .join('\n\n')

    // Use Qwen API
    const qwenKey = process.env.Qwen
    if (qwenKey) {
      const qwenResult = await tryQwen(qwenKey, spec, userContent, data.stage)
      if (qwenResult.ok) return qwenResult
    }

    // // Try Lovable first
    // const lovableKey = process.env.LOVABLE_API_KEY
    // if (lovableKey) {
    //   const lovableResult = await tryLovable(lovableKey, spec, userContent, data.stage)
    //   if (lovableResult.ok) return lovableResult
    // }

    // // Fallback to MiniMax
    // const minimaxKey = process.env.MINIMAX_API_KEY
    // if (minimaxKey) {
    //   const minimaxResult = await tryMiniMax(minimaxKey, spec, userContent, data.stage)
    //   if (minimaxResult.ok) return minimaxResult
    // }

    return { ok: false as const, error: 'no API key available' }
  })

async function tryQwen(apiKey: string, spec: ReturnType<typeof stageSpec>, userContent: string, stage: string) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 55_000)
    const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen-plus',
        messages: [
          { role: 'system', content: spec.system },
          { role: 'user', content: userContent },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: spec.toolName,
              description: `Return structured ${stage} data.`,
              parameters: spec.schema,
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: spec.toolName } },
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status === 429) return { ok: false as const, error: 'rate_limit' }
      if (res.status === 402) return { ok: false as const, error: 'no_credits' }
      return { ok: false as const, error: `qwen ${res.status}: ${text.slice(0, 200)}` }
    }
    const json = await res.json()
    const argsStr = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments
    if (!argsStr) return { ok: false as const, error: 'empty tool call' }
    let parsed: any
    try {
      parsed = JSON.parse(argsStr)
    } catch {
      return { ok: false as const, error: 'parse error' }
    }
    return { ok: true as const, stage, payload: parsed }
  } catch (e) {
    return {
      ok: false as const,
      error:
        e instanceof Error && e.name === 'AbortError'
          ? 'timeout'
          : e instanceof Error
            ? e.message
            : 'unknown',
    }
  }
}

async function tryLovable(apiKey: string, spec: ReturnType<typeof stageSpec>, userContent: string, stage: string) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 55_000)
    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: spec.system },
          { role: 'user', content: userContent },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: spec.toolName,
              description: `Return structured ${stage} data.`,
              parameters: spec.schema,
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: spec.toolName } },
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status === 429) return { ok: false as const, error: 'rate_limit' }
      if (res.status === 402) return { ok: false as const, error: 'no_credits' }
      return { ok: false as const, error: `gateway ${res.status}: ${text.slice(0, 200)}` }
    }
    const json = await res.json()
    const argsStr = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments
    if (!argsStr) return { ok: false as const, error: 'empty tool call' }
    let parsed: any
    try {
      parsed = JSON.parse(argsStr)
    } catch {
      return { ok: false as const, error: 'parse error' }
    }
    return { ok: true as const, stage, payload: parsed }
  } catch (e) {
    return {
      ok: false as const,
      error:
        e instanceof Error && e.name === 'AbortError'
          ? 'timeout'
          : e instanceof Error
            ? e.message
            : 'unknown',
    }
  }
}

async function tryMiniMax(apiKey: string, spec: ReturnType<typeof stageSpec>, userContent: string, stage: string) {
  // MiniMax doesn't support tool calling, so we ask for JSON-only response
  const systemWithJson = spec.system + '\n\n重要：只返回 JSON 对象，不要输出任何其他文字，不要用 markdown 代码块包裹，直接输出纯 JSON。'
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 55_000)
    const res = await fetch('https://api.minimaxi.com/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'MiniMax-Text-01',
        messages: [
          { role: 'system', content: systemWithJson },
          { role: 'user', content: userContent },
        ],
        max_tokens: 4096,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false as const, error: `minimax ${res.status}: ${text.slice(0, 200)}` }
    }
    const json = await res.json()
    // MiniMax returns content[].type === "text"
    const textParts: string[] = []
    for (const block of json.content ?? []) {
      if (block.type === 'text') {
        textParts.push(block.text)
      }
    }
    const fullText = textParts.join('').trim()
    if (!fullText) return { ok: false as const, error: 'minimax empty response' }

    // Try to extract JSON from the response
    let parsed: any
    try {
      // Try direct parse first
      parsed = JSON.parse(fullText)
    } catch {
      // Try to extract JSON from potential markdown code blocks
      const jsonMatch = fullText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0])
        } catch {
          return { ok: false as const, error: 'minimax parse error' }
        }
      } else {
        return { ok: false as const, error: 'minimax parse error' }
      }
    }
    return { ok: true as const, stage, payload: parsed }
  } catch (e) {
    return {
      ok: false as const,
      error:
        e instanceof Error && e.name === 'AbortError'
          ? 'timeout'
          : e instanceof Error
            ? e.message
            : 'unknown',
    }
  }
}
