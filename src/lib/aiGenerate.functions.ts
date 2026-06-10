import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const StageEnum = z.enum(['canvas', 'script', 'scene', 'character', 'character-extract', 'storyboard', 'timeline'])

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
    case 'scene':
      return {
        toolName: 'emit_scenes',
        system:
          '你是一名中文短剧场景提取师。基于用户提供的剧本文本（可能是小说、剧本或分集内容），**只做一件事：识别并提取文本中实际出现的所有主要场景/地点**。' +
          '要求：每个场景是物理空间（房间/街道/办公室/餐厅等），不是情节；' +
          'location 用简短中文名（2-6 字），slug 用"INT./EXT. 中文名 — 时间"格式；' +
          'timeOfDay 取 DAY/NIGHT/DUSK/DAWN；' +
          'action 用 30-60 字描写该场景的环境与氛围（不要重复剧本中的对白/动作）。' +
          '同一地点在不同时段出现算 1 个场景；只在文本中真实出现的场景才提取，不要编造。' +
          '若文本完全没有场景描写（例如纯对白），返回空数组。' +
          '仅以工具调用返回结构化结果。',
        schema: {
          type: 'object',
          properties: {
            scenes: {
              type: 'array',
              maxItems: 20,
              items: {
                type: 'object',
                properties: {
                  index: { type: 'number', description: '1-based 顺序号' },
                  slug: { type: 'string', description: '如 "INT. 林家祠堂 — 黄昏"' },
                  location: { type: 'string' },
                  timeOfDay: { type: 'string', enum: ['DAY', 'NIGHT', 'DUSK', 'DAWN'] },
                  action: { type: 'string', description: '30-60 字的环境/氛围描写' },
                  beats: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '可省略；提取时可填 1-2 个该场景的关键事件标签',
                  },
                },
                required: ['index', 'slug', 'location', 'timeOfDay', 'action'],
                additionalProperties: false,
              },
            },
          },
          required: ['scenes'],
          additionalProperties: false,
        },
      }
    case 'character-extract':
      return {
        toolName: 'emit_characters_extract',
        system:
          '你是一名中文短剧角色提取师。**只做一件事**:从用户提供的剧本文本中,识别并提取**实际出现**的所有角色。' +
          '要求:不创建虚构角色,只列文本里出现过的;有台词、有动作、有名字的都算;' +
          'role 尽量从 lead/supporting/villain 中选,如果出场少或身份模糊可标 supporting;' +
          'palette(3-4 个 hex 颜色)按角色整体气质推断(深色沉稳/亮色活泼等),不是必须从原文出现;' +
          '**faceDescription**:只写脸型/五官/肤色/发型发色等中性结构,**不要写任何表情/情绪/神态**。' +
          '**looks 数组(变体造型)**:如果同一角色在文本中明显换了不同身份/服装(例:男主角在现代是医生、回忆里是学生),在 looks 里**额外**输出 1-3 个变体,每个有 label(短中文,如"医生"/"学生")和 clothingDescription。' +
          '只在**真正不同**的造型时才加 looks,同一套衣服不要重复列。' +
          '**关于 faceHint / bodyHint(可选)**:如果该变体下脸/五官有剧情明确的变化(例:疤痕、戴半脸面具、易容成他人),在 faceHint 字段中说明;如果身材/体型有剧情明确的变化(例:变胖、怀孕、变成小孩),在 bodyHint 字段中说明。**不写 hint = 默认脸/身材与主角色 100% 一致**。' +
          '单集通常 1-5 个角色,不要为了凑数虚构。仅工具调用返回。',
        schema: {
          type: 'object',
          properties: {
            characters: {
              type: 'array',
              minItems: 1,
              maxItems: 12,
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  role: { type: 'string', enum: ['lead', 'supporting', 'villain'] },
                  roleLabel: { type: 'string' },
                  age: { type: 'number' },
                  gender: { type: 'string' },
                  faceDescription: { type: 'string', description: '面部结构(脸型/五官/肤色/发型发色),不要写任何表情/情绪' },
                  bodyDescription: { type: 'string' },
                  clothingDescription: { type: 'string' },
                  personality: { type: 'string' },
                  palette: {
                    type: 'array',
                    minItems: 3,
                    maxItems: 4,
                    items: { type: 'string' },
                  },
                  looks: {
                    type: 'array',
                    description: '同角色不同造型/身份下的变体(可选)',
                    maxItems: 3,
                    items: {
                      type: 'object',
                      properties: {
                        label: { type: 'string' },
                        clothingDescription: { type: 'string' },
                        faceHint: { type: 'string', description: '可选:剧情明确提及该变体下脸/五官有变化(疤痕/面具/易容)时填写' },
                        bodyHint: { type: 'string', description: '可选:剧情明确提及该变体下身材/体型有变化(变胖/怀孕/变小)时填写' },
                      },
                      required: ['label', 'clothingDescription'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['name', 'role', 'roleLabel', 'age', 'gender', 'faceDescription', 'bodyDescription', 'clothingDescription', 'personality', 'palette'],
                additionalProperties: false,
              },
            },
          },
          required: ['characters'],
          additionalProperties: false,
        },
      }
    case 'character':
      return {
        toolName: 'emit_characters',
        system:
          '你是一名动漫角色设计师 + 编剧。结合用户输入、logline / acts / scenes 提取或新建 3-5 位角色（至少 1 主角，可含配角与反派）。' +
          '**faceDescription 严格要求**:只写脸型/五官/肤色/发型发色等中性结构,**不要写任何表情、情绪、神态、动作**（如"微笑"、"皱眉"、"冷峻的眼神"都是禁止的）。生成图必须保持"无表情"中性状态。' +
          '**personality 字段**:可以填,但下游生成图 prompt 不会使用它,只在 UI 描述里展示。' +
          '**looks 数组(变体造型)**:如果同一角色在不同剧情阶段/身份下有明显不同的造型(医生 vs 穿越者 vs 学生时期),请在 looks 里**额外**输出 1-3 个变体,每个变体有独立的 label(短中文,如"医生"/"穿越"/"学生")和 clothingDescription(只改这个,脸和身材沿用主条目)。' +
          '**不要**为同一套衣服重复列 looks。只有造型明显不同时才加。' +
          '**关于 faceHint / bodyHint(可选)**:如果该变体下脸/五官有剧情明确的变化(例:疤痕、戴半脸面具、易容成他人),在 faceHint 字段中说明;如果身材/体型有剧情明确的变化(例:变胖、怀孕、变成小孩),在 bodyHint 字段中说明。**不写 hint = 默认脸/身材与主角色 100% 一致**。' +
          '每位需要：名字、role(lead/supporting/villain)、roleLabel(中文短描述如"女主 · 高冷学霸")、age、gender(性别)、faceDescription、bodyDescription、clothingDescription、personality(性格)、palette(3-4 个 hex 颜色，匹配角色调性)、可选 looks。仅工具调用返回。',
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
                  gender: { type: 'string' },
                  faceDescription: { type: 'string', description: '面部结构(脸型/五官/肤色/发型发色),不要写任何表情/情绪' },
                  bodyDescription: { type: 'string', description: '身材体型描述' },
                  clothingDescription: { type: 'string', description: '默认造型下的服装配饰描述' },
                  personality: { type: 'string' },
                  palette: {
                    type: 'array',
                    minItems: 3,
                    maxItems: 4,
                    items: { type: 'string', description: 'hex like #1e293b' },
                  },
                  looks: {
                    type: 'array',
                    description: '同角色不同造型/身份下的变体(可选)。每个变体走独立图片生成 call。',
                    maxItems: 3,
                    items: {
                      type: 'object',
                      properties: {
                        label: { type: 'string', description: '短中文标签,如 "医生" / "穿越" / "学生时期"' },
                        clothingDescription: { type: 'string', description: '该变体的服装配饰描述;脸和身材沿用主条目' },
                        faceHint: { type: 'string', description: '可选:剧情明确提及该变体下脸/五官有变化(疤痕/面具/易容)时填写' },
                        bodyHint: { type: 'string', description: '可选:剧情明确提及该变体下身材/体型有变化(变胖/怀孕/变小)时填写' },
                      },
                      required: ['label', 'clothingDescription'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['name', 'role', 'roleLabel', 'age', 'gender', 'faceDescription', 'bodyDescription', 'clothingDescription', 'personality', 'palette'],
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

// ==================================================================
// Per-look 独立描述生成
// ------------------------------------------------------------------
// generateStageAi 把一整集所有角色一次提取,looks[] 里每个变体只能
// 给 label + clothingDescription;face/body 默认沿用主条目。这导致
// 同一角色的"医生 / 穿越 / 学生"三张图共用一份脸/身体描述。
//
// 本 server fn 是【单角色 + 单变体】粒度:把主条目的脸/身体/服装
// 作为 anchor 喂给 Qwen,严格指令"脸/身体 100% 继承,除非 hint
// 明示有变化",输出 standalone 完整的 face/body/clothing 三字段,
// 用于覆盖原 looks。
// 客户端 enrichCharacterLooks 在 extract 完后并行调本 fn(per-look),
// 失败 fallback 沿用主条目 + console.warn,不阻塞流程。
// ==================================================================

const LookInputSchema = z.object({
  characterName: z.string().min(1),
  age: z.number().int().min(0).max(150),
  gender: z.string(),
  anchorFaceDescription: z.string(),
  anchorBodyDescription: z.string(),
  anchorClothingDescription: z.string(),
  lookLabel: z.string().min(1),
  lookClothingDescription: z.string(),
  faceHint: z.string().optional(),
  bodyHint: z.string().optional(),
  episodeContext: z.string().optional(),
})

const LookOutputSchema = {
  type: 'object',
  properties: {
    faceDescription: { type: 'string', description: '面部结构(脸型/五官/肤色/发型发色),不要写任何表情' },
    bodyDescription: { type: 'string', description: '身材体型描述' },
    clothingDescription: { type: 'string', description: '该变体的完整服装配饰描述(独立完整,不要引用主条目)' },
  },
  required: ['faceDescription', 'bodyDescription', 'clothingDescription'],
  additionalProperties: false,
}

const LOOK_SYSTEM_PROMPT = `你是一名中文短剧角色一致性维护助手。任务是:为同一个角色的【不同造型/身份/变体】,生成一组【独立、完整、可直接喂给图像生成模型】的描述。

硬规则(违反 = 任务失败):
1. faceDescription 严格继承主条目 —— 脸型、五官、肤色、脸型轮廓 100% 一致,不能换脸、不能微调、不能写"和主角色一样"。
   - 唯一例外:如果用户在 hint 里【明确说】该变体下脸/五官有变化(例如戴半脸面具、脸上多了疤痕、易容成他人),则按 hint 写脸,否则照搬主条目脸。
2. bodyDescription 严格继承主条目 —— 体型、身高、体态 100% 一致。
   - 唯一例外:如果用户在 hint 里【明确说】该变体下身材/体型有变化(例如变胖了、怀孕、变成小孩),则按 hint 写身体,否则照搬主条目身体。
3. clothingDescription 必须完全独立重新写 —— 这是该变体独有的服装/配饰,不要照搬主条目 clothing,也不要写"换一套衣服"这种空话。写出具体的款式、颜色、材质、配饰。
4. 所有三个字段都是 standalone 完整句子 —— 不得使用"同主角色"、"沿用"、"参考主条目"、"同上"这种引用。图像模型看不到引用,只会看到字符串。
5. 不要写任何表情、情绪、神态、动作、姿势 —— 脸/身体字段必须是中性结构描述。
6. 输出语言:中文,简洁,每字段 20-80 字。

工作流程:
A) 先把 anchorFaceDescription / anchorBodyDescription 的内容基本照搬到 faceDescription / bodyDescription(只做轻量措辞调整,不要改实质内容)。
B) 检查 faceHint / bodyHint:如果 hint 提到脸或身体有变化,只修改对应字段的具体内容,未提及的字段保持 anchor。
C) clothingDescription 完全独立写:基于 lookLabel 和 lookClothingDescription 扩写出一个完整、有画面感的服装描述。

仅以工具调用返回结构化结果。`

export const generateCharacterLookAi = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => LookInputSchema.parse(d))
  .handler(async ({ data }) => {
    const qwenKey = process.env.Qwen
    if (!qwenKey) return { ok: false as const, error: 'no API key available' }

    const ctxParts: string[] = [
      `【主角色基础描述(anchor)】`,
      `姓名:${data.characterName}  年龄:${data.age}  性别:${data.gender}`,
      `face: ${data.anchorFaceDescription}`,
      `body: ${data.anchorBodyDescription}`,
      `default clothing: ${data.anchorClothingDescription}`,
      ``,
      `【本次要生成的变体】`,
      `label: ${data.lookLabel}`,
      `clothing(初稿): ${data.lookClothingDescription}`,
    ]
    if (data.faceHint) ctxParts.push(`face hint(剧情明确提及): ${data.faceHint}`)
    if (data.bodyHint) ctxParts.push(`body hint(剧情明确提及): ${data.bodyHint}`)
    if (data.episodeContext) ctxParts.push(`【当集剧情摘要】\n${data.episodeContext}`)

    // spec 结构(toolName/system/schema)与 stageSpec 各 case 字面量一致,
    // 但 TS 推断 ReturnType<typeof stageSpec> 是 union,字面值不在其中 →
    // 走 cast。tryQwen 内部只读这 3 个字段,运行时完全兼容。
    const spec = {
      toolName: 'emit_character_look',
      system: LOOK_SYSTEM_PROMPT,
      schema: LookOutputSchema,
    } as unknown as ReturnType<typeof stageSpec>

    const result = await tryQwen(qwenKey, spec, ctxParts.join('\n'), 'character-look')
    if (!result.ok) return result

    const p = result.payload as any
    if (!p?.faceDescription || !p?.bodyDescription || !p?.clothingDescription) {
      return { ok: false as const, error: 'incomplete tool call payload' }
    }
    return {
      ok: true as const,
      payload: {
        faceDescription: String(p.faceDescription),
        bodyDescription: String(p.bodyDescription),
        clothingDescription: String(p.clothingDescription),
      },
    }
  })
