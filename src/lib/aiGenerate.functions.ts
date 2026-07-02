import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const StageEnum = z.enum([
  "canvas",
  "script",
  "scene",
  "character",
  "character-extract",
  "storyboard",
  "timeline",
  "prop-extract",
]);

const InputSchema = z.object({
  stage: StageEnum,
  userPrompt: z.string().min(1).max(4000),
  // Lightweight context from the workspace so later stages can build on earlier ones.
  context: z
    .object({
      logline: z.string().optional(),
      acts: z.array(z.object({ title: z.string(), beats: z.array(z.string()) })).optional(),
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
      characters: z.array(z.object({ name: z.string(), roleLabel: z.string() })).optional(),
    })
    .optional(),
});

type Input = z.infer<typeof InputSchema>;

function stageSpec(stage: Input["stage"]) {
  switch (stage) {
    case "canvas":
      return {
        toolName: "emit_outline",
        system:
          '你是一名中文短剧编剧，负责把用户的一句话灵感扩展成"三幕剧本概要"。要求：基调贴合用户描述；logline 一句不超过 60 个汉字；每幕 3-4 个 beats；语言精炼、画面感强；只调用工具返回结构化数据，不要输出额外文字。',
        schema: {
          type: "object",
          properties: {
            logline: { type: "string" },
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
                    minItems: 3,
                    maxItems: 5,
                    items: { type: "string" },
                  },
                },
                required: ["title", "beats"],
                additionalProperties: false,
              },
            },
          },
          required: ["logline", "acts"],
          additionalProperties: false,
        },
      };
    case "script":
      return {
        toolName: "emit_scenes",
        system:
          "你是一名中文短剧编剧。基于已有的 logline / acts（如果提供）以及用户输入，写出 4 个连续的场次。每场需要：场次号、场标 INT./EXT. 中文 - 时间、动作描写（80-160 字）、3 个 beats、3-5 句对白（含可选括号情绪）。语言节奏紧凑，符合短剧。仅以工具调用返回结构化结果。",
        schema: {
          type: "object",
          properties: {
            scenes: {
              type: "array",
              minItems: 3,
              maxItems: 5,
              items: {
                type: "object",
                properties: {
                  index: { type: "number" },
                  slug: { type: "string", description: '如 "INT. 高三(2)班 自习室 — 黄昏"' },
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
                      additionalProperties: false,
                    },
                  },
                },
                required: ["index", "slug", "location", "timeOfDay", "action", "beats", "dialogue"],
                additionalProperties: false,
              },
            },
          },
          required: ["scenes"],
          additionalProperties: false,
        },
      };
    case "scene":
      return {
        toolName: "emit_scenes",
        system:
          "你是一名中文短剧场景提取师。基于用户提供的剧本文本（可能是小说、剧本或分集内容），**只做一件事：识别并提取文本中实际出现的所有主要场景/地点**。" +
          "要求：每个场景是物理空间（房间/街道/办公室/餐厅等），不是情节；" +
          'location 用简短中文名（2-6 字），slug 用"INT./EXT. 中文名 — 时间"格式；' +
          "timeOfDay 取 DAY/NIGHT/DUSK/DAWN；" +
          "action 用 30-60 字描写该场景的环境与氛围（不要重复剧本中的对白/动作）。" +
          "同一地点在不同时段出现算 1 个场景；只在文本中真实出现的场景才提取，不要编造。" +
          "若文本完全没有场景描写（例如纯对白），返回空数组。" +
          "仅以工具调用返回结构化结果。",
        schema: {
          type: "object",
          properties: {
            scenes: {
              type: "array",
              maxItems: 20,
              items: {
                type: "object",
                properties: {
                  index: { type: "number", description: "1-based 顺序号" },
                  slug: { type: "string", description: '如 "INT. 林家祠堂 — 黄昏"' },
                  location: { type: "string" },
                  timeOfDay: { type: "string", enum: ["DAY", "NIGHT", "DUSK", "DAWN"] },
                  action: { type: "string", description: "30-60 字的环境/氛围描写" },
                  beats: {
                    type: "array",
                    items: { type: "string" },
                    description: "可省略；提取时可填 1-2 个该场景的关键事件标签",
                  },
                },
                required: ["index", "slug", "location", "timeOfDay", "action"],
                additionalProperties: false,
              },
            },
          },
          required: ["scenes"],
          additionalProperties: false,
        },
      };
    case "character-extract":
      return {
        toolName: "emit_characters_extract",
        system:
          "你是一名中文短剧角色提取师。**只做一件事**:从用户提供的剧本文本中,识别并提取**实际出现**的所有角色。" +
          "要求:不创建虚构角色,只列文本里出现过的;有台词、有动作、有名字的都算;" +
          "role 尽量从 lead/supporting/villain 中选,如果出场少或身份模糊可标 supporting;" +
          "palette(3-4 个 hex 颜色)按角色整体气质推断(深色沉稳/亮色活泼等),不是必须从原文出现;" +
          "**faceDescription**:只写脸型/五官/肤色/发型发色等中性结构,**不要写任何表情/情绪/神态**。" +
          "**多形象拆分为多个独立角色(2026/06 用户诉求)**:如果同一角色在文本中明显换了不同身份/服装/造型(例:男主角在现代是医生、回忆里是学生时期),**拆分成多个独立角色**输出,不要在同一个角色里挂 looks 数组。" +
          'name 字段加身份后缀("林晚 · 医生"、"林晚 · 学生时期" / "陆深 · 医生" / "陆深 · 日常"),各自的 faceDescription / bodyDescription / clothingDescription 完全独立;' +
          "同一真人的不同形象,**脸和身材可以保持一致**(因为是同一个人),但**clothingDescription 必须按当前身份独立重新写**(白大褂 ≠ 校服)。" +
          '例:文本里男主有"医生装"和"学生装"两个形象 → 输出 `{name: "陆深 · 医生", faceDescription: "..." clothingDescription: "白大褂、听诊器..."}` 和 `{name: "陆深 · 学生时期", faceDescription: "..." clothingDescription: "蓝白校服、双肩书包..."}` 两个平级独立项。' +
          '**关键:siblingGroupId 锁脸/锁身材** —— 上述两个"陆深"是同一个人,必须在 siblingGroupId 字段输出**相同的 id**(例如 `g-陆深-7a2f`),让下游图片生成时第二个走 I2I 锁脸(以第一个的图为参考),保证脸一致。' +
          "**不同真人不要共享 groupId**;同一真人的所有形象共享同一个 groupId。命名建议:`g-<真名>-<短 hash>`(无需真做 hash,用任何稳定字符串即可,如 `g-陆深-1`)。" +
          "**只在真正不同的造型/身份时拆**,同一套衣服只输出 1 个角色(此时 siblingGroupId 不填)。" +
          "单集通常 1-8 个角色(多形象拆分后可能更多),不要为了凑数虚构。仅工具调用返回。" +
          "【跨集角色一致性 —— 2026/06】你被提供了一份【已有角色列表】(context.characters),每条有稳定的 matchKey。" +
          "你必须严格按以下规则输出 characters 数组:" +
          "1) 对【已有角色列表】里出现的真人,即使在新文本里换了服装/换了场景:复用他的 matchKey(原样复制,不要重命名),在 characters 数组里**只输出一份**(不要因为换装就拆成两个),把新描述写到该条目的 faceDescription/bodyDescription/clothingDescription。" +
          '2) 同一真人在新文本里如果明确"换了不同的身份/造型"(同真人多形象):拆成多个独立 character,共享同一个 matchKey + 共享同一个 siblingGroupId。例:"陆深 · 医生" 和 "陆深 · 学生时期" → matchKey 都是 "陆深-001"。' +
          '3) **新真人**(列表里没出现过的)→ 生成 matchKey,格式 `<真名>-<3位hex>`,如 "江野-a3f"。' +
          "4) **matchKey 永远不能空**,每条 character 输出必须有 matchKey 字段。" +
          '5) **不同形象必须用不同 name**(带 · 后缀,例如 "陆深 · 医生" vs "陆深 · 学生时期")。同形象跨集则用完全相同的 name(客户端按 name 精确匹配合并跨集记录,不同 name = 不同形象 = 独立卡片)。',
        schema: {
          type: "object",
          properties: {
            characters: {
              type: "array",
              minItems: 1,
              maxItems: 16,
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  role: { type: "string", enum: ["lead", "supporting", "villain"] },
                  roleLabel: { type: "string" },
                  age: { type: "number" },
                  gender: { type: "string" },
                  faceDescription: {
                    type: "string",
                    description: "面部结构(脸型/五官/肤色/发型发色),不要写任何表情/情绪",
                  },
                  bodyDescription: { type: "string" },
                  clothingDescription: { type: "string" },
                  personality: { type: "string" },
                  palette: {
                    type: "array",
                    minItems: 3,
                    maxItems: 4,
                    items: { type: "string" },
                  },
                  /**
                   * 2026/06:同真人的多个形象共享此 id(让下游 I2I 锁脸/锁身材)。
                   * 例:男主"陆深"有医生/学生两个形象 → 两个角色都填 "g-陆深-1"。
                   * 单形象角色不填。
                   */
                  siblingGroupId: {
                    type: "string",
                    description:
                      '同真人多形象共享的分组 id(如 "g-陆深-1"),用于 I2I 锁脸。不填 = 单形象',
                  },
                  /**
                   * 2026/06:跨集身份锚点 —— 同一真人在所有集、所有形象都共享。
                   * 命名: "<真名>-<3位hex>",如 "陆深-a3f"。
                   * 跨集复用 + 匹配都用这个字段。必填。
                   */
                  matchKey: {
                    type: "string",
                    description:
                      '跨集稳定 id,同一真人在所有集(ep1/ep2/ep3)和所有形象(医生/学生)都填相同。命名 "<真名>-<3位hex>"。必填。',
                    pattern: "^.{2,40}$",
                  },
                },
                required: [
                  "name",
                  "role",
                  "roleLabel",
                  "age",
                  "gender",
                  "faceDescription",
                  "bodyDescription",
                  "clothingDescription",
                  "personality",
                  "palette",
                  "matchKey",
                ],
                additionalProperties: false,
              },
            },
          },
          required: ["characters"],
          additionalProperties: false,
        },
      };
    case "character":
      return {
        toolName: "emit_characters",
        system:
          "你是一名动漫角色设计师 + 编剧。结合用户输入、logline / acts / scenes 提取或新建 3-5 位角色（至少 1 主角，可含配角与反派）。" +
          '**faceDescription 严格要求**:只写脸型/五官/肤色/发型发色等中性结构,**不要写任何表情、情绪、神态、动作**（如"微笑"、"皱眉"、"冷峻的眼神"都是禁止的）。生成图必须保持"无表情"中性状态。' +
          "**personality 字段**:可以填,但下游生成图 prompt 不会使用它,只在 UI 描述里展示。" +
          "**多形象拆分为多个独立角色(2026/06 用户诉求)**:如果同一角色在不同剧情阶段/身份下有明显不同的造型(医生 vs 穿越者 vs 学生时期),**拆分成多个独立角色**输出(不是 looks 数组里的子项)。" +
          'name 字段加身份后缀("林晚 · 医生" / "林晚 · 穿越" / "林晚 · 学生时期"),各自的 faceDescription / bodyDescription / clothingDescription 完全独立;' +
          "同一真人的不同形象,**脸和身材可以保持一致**(因为是同一个人),但**clothingDescription 必须按当前身份独立重新写**。" +
          "**关键:siblingGroupId 锁脸/锁身材** —— 同真人的多个形象必须共享同一个 siblingGroupId(例 `g-陆深-1`),让下游图片生成时后续形象走 I2I 锁脸(以首个图为参考)。" +
          "**不同真人不要共享 groupId**;同一真人的所有形象都共享一个 groupId。命名建议:`g-<真名>-<短 hash>`(无需真做 hash,用任何稳定字符串即可,如 `g-陆深-1`)。" +
          "**不要**为同一套衣服重复列。" +
          '每位需要：名字、role(lead/supporting/villain)、roleLabel(中文短描述如"女主 · 高冷学霸")、age、gender(性别)、faceDescription、bodyDescription、clothingDescription、personality(性格)、palette(3-4 个 hex 颜色，匹配角色调性)、**matchKey**(必填,跨集身份锚)。仅工具调用返回。' +
          "【跨集角色一致性 —— 2026/06】你被提供了一份【已有角色列表】(context.characters),每条有稳定的 matchKey。" +
          "你必须严格按以下规则输出 characters 数组:" +
          "1) 对【已有角色列表】里出现的真人:复用 matchKey,在 characters 数组里**只输出一份**,把新描述写到对应字段。" +
          '2) 同一真人在新文本里如果明确"换了不同的身份/造型":拆成多个独立 character,共享同一个 matchKey + 共享同一个 siblingGroupId。' +
          '3) **新真人** → 生成 matchKey,格式 `<真名>-<3位hex>`,如 "江野-a3f"。' +
          "4) **matchKey 永远不能空**,每条 character 输出必须有 matchKey 字段。" +
          '5) **不同形象必须用不同 name**(带 · 后缀,例如 "陆深 · 医生" vs "陆深 · 学生时期")。同形象跨集则用完全相同的 name(客户端按 name 精确匹配合并跨集记录,不同 name = 不同形象 = 独立卡片)。',
        schema: {
          type: "object",
          properties: {
            characters: {
              type: "array",
              minItems: 3,
              maxItems: 8,
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  role: { type: "string", enum: ["lead", "supporting", "villain"] },
                  roleLabel: { type: "string" },
                  age: { type: "number" },
                  gender: { type: "string" },
                  faceDescription: {
                    type: "string",
                    description: "面部结构(脸型/五官/肤色/发型发色),不要写任何表情/情绪",
                  },
                  bodyDescription: { type: "string", description: "身材体型描述" },
                  clothingDescription: { type: "string", description: "默认造型下的服装配饰描述" },
                  personality: { type: "string" },
                  palette: {
                    type: "array",
                    minItems: 3,
                    maxItems: 4,
                    items: { type: "string", description: "hex like #1e293b" },
                  },
                  /**
                   * 2026/06:同真人的多个形象共享此 id(让下游 I2I 锁脸/锁身材)。
                   * 例:男主"陆深"有医生/学生两个形象 → 两个角色都填 "g-陆深-1"。
                   * 单形象角色不填。
                   */
                  siblingGroupId: {
                    type: "string",
                    description:
                      '同真人多形象共享的分组 id(如 "g-陆深-1"),用于 I2I 锁脸。不填 = 单形象',
                  },
                  /**
                   * 2026/06:跨集身份锚点 —— 同一真人在所有集、所有形象都共享。
                   * 命名: "<真名>-<3位hex>",如 "陆深-a3f"。
                   * 跨集复用 + 匹配都用这个字段。必填。
                   */
                  matchKey: {
                    type: "string",
                    description:
                      '跨集稳定 id,同一真人在所有集(ep1/ep2/ep3)和所有形象(医生/学生)都填相同。命名 "<真名>-<3位hex>"。必填。',
                    pattern: "^.{2,40}$",
                  },
                },
                required: [
                  "name",
                  "role",
                  "roleLabel",
                  "age",
                  "gender",
                  "faceDescription",
                  "bodyDescription",
                  "clothingDescription",
                  "personality",
                  "palette",
                  "matchKey",
                ],
                additionalProperties: false,
              },
            },
          },
          required: ["characters"],
          additionalProperties: false,
        },
      };
    case "storyboard":
      return {
        toolName: "emit_storyboard",
        system:
          "你是一名分镜师。基于 scenes 设计 8-16 个分镜面板，覆盖每场关键节奏。每个 panel 需要：sceneIndex(对应场次号)、shot(WS/MS/CU/ECU/OTS)、camera(机位与镜头描述)、action(画面内容)、emotion(情绪关键词)、durationSec(1-5)。镜头组合需有节奏对比。仅工具调用返回。",
        schema: {
          type: "object",
          properties: {
            panels: {
              type: "array",
              minItems: 6,
              maxItems: 20,
              items: {
                type: "object",
                properties: {
                  sceneIndex: { type: "number" },
                  shot: { type: "string", enum: ["WS", "MS", "CU", "ECU", "OTS"] },
                  camera: { type: "string" },
                  action: { type: "string" },
                  emotion: { type: "string" },
                  durationSec: { type: "number" },
                },
                required: ["sceneIndex", "shot", "camera", "action", "emotion", "durationSec"],
                additionalProperties: false,
              },
            },
          },
          required: ["panels"],
          additionalProperties: false,
        },
      };
    case "timeline":
      return {
        toolName: "emit_timeline",
        system:
          "你是一名影视剪辑师。基于已有的分镜面板（panels）和剧本次序，设计完整的时间轴规划。包含视频轨（每张分镜对应一个视频片段）、音频轨（BGM/SFX 建议）、字幕轨（关键台词）、过渡点（场景切换位置）。每个视频片段 durationSec 需与分镜一致。仅工具调用返回。",
        schema: {
          type: "object",
          properties: {
            tracks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  kind: { type: "string", enum: ["video", "audio", "subtitle"] },
                  label: { type: "string" },
                  clips: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        startSec: { type: "number" },
                        durationSec: { type: "number" },
                        label: { type: "string" },
                        panelIndex: {
                          type: "number",
                          description: "对应分镜面板序号，仅 video 类型需要",
                        },
                      },
                      required: ["startSec", "durationSec", "label"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["kind", "label", "clips"],
                additionalProperties: false,
              },
            },
            transitionsAt: {
              type: "array",
              description: "过渡点时间轴位置（秒）",
              items: { type: "number" },
            },
          },
          required: ["tracks", "transitionsAt"],
          additionalProperties: false,
        },
      };
    case "prop-extract":
      return {
        toolName: "emit_props_extract",
        system:
          "你是一名中文短剧道具提取师。**只做一件事**:从用户提供的剧本文本中,识别并提取**在本集中会根据剧情进行移动的物体**。" +
          '要求:不创建虚构道具,只列文本里出现过的;一个物理上独立的物体算一个道具(如"钢笔"、"广播稿"、"便签条"、"资料夹");' +
          "道具的关键判断标准:该物体在剧情中被拿取、传递、使用、变化位置或产生情节作用 —— 只是背景装饰不提取;" +
          "name 用简短中文名(2-6 字);description 写外观描述(颜色/形状/材质等);" +
          "movementDescription 写该道具在本集中的移动/变化方式(谁拿走了它、它去了哪里、发生了什么变化);" +
          "keyMoments 写该道具在哪些重要时刻出现/被使用(2-4 条);" +
          "palette(3-4 个 hex 颜色)按道具本身颜色推断。" +
          "单集通常 0-6 个道具,没有道具返回空数组。仅工具调用返回。\n\n" +
          "## 重要:宁可多列不可遗漏\n" +
          "- 手术刀、手机、钥匙、硬币、笔、烟、打火机、眼镜、口罩、手表、戒指、领带等小物件**全部算道具**\n" +
          "- 任何被角色拿在手里、从口袋掏出、放在桌上的物品都算\n" +
          "- 任何被角色操作/按动的设备(开关、遥控器、键盘等)都算\n" +
          "- 任何在角色之间传递的物品(信件、文件、礼物、钞票等)都算\n" +
          "- 固定大型装饰(桌椅床柜门窗)不提取;角色常规服装(外套裤子鞋)不提取",
        schema: {
          type: "object",
          properties: {
            props: {
              type: "array",
              maxItems: 20,
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: '道具中文名,如"钢笔"' },
                  description: { type: "string", description: "外观描述(颜色/形状/材质)" },
                  movementDescription: { type: "string", description: "在本集中的移动/变化方式" },
                  keyMoments: {
                    type: "array",
                    minItems: 2,
                    maxItems: 4,
                    items: { type: "string" },
                  },
                  palette: {
                    type: "array",
                    minItems: 3,
                    maxItems: 4,
                    items: { type: "string", description: "hex like #1e293b" },
                  },
                },
                required: ["name", "description", "movementDescription", "keyMoments", "palette"],
                additionalProperties: false,
              },
            },
          },
          required: ["props"],
          additionalProperties: false,
        },
      };
  }
}

export const generateStageAi = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }) => {
    const spec = stageSpec(data.stage);
    const ctxParts: string[] = [];
    if (data.context?.logline) ctxParts.push(`【已有 logline】${data.context.logline}`);
    if (data.context?.acts?.length) {
      ctxParts.push(
        `【已有三幕】\n${data.context.acts
          .map((a) => `${a.title}\n- ${a.beats.join("\n- ")}`)
          .join("\n\n")}`,
      );
    }
    if (data.context?.scenes?.length) {
      ctxParts.push(
        `【已有场次】\n${data.context.scenes
          .map((s) => `SC${s.index} ${s.slug}\n${s.action}`)
          .join("\n\n")}`,
      );
    }
    if (data.context?.characters?.length) {
      ctxParts.push(
        `【已有角色】${data.context.characters.map((c) => `${c.name}(${c.roleLabel})`).join("、")}`,
      );
    }
    const userContent = [ctxParts.join("\n\n"), `【本次需求】\n${data.userPrompt}`]
      .filter(Boolean)
      .join("\n\n");

    // Use Qwen API
    const qwenKey = process.env.Qwen;
    if (qwenKey) {
      const qwenResult = await tryQwen(qwenKey, spec, userContent, data.stage);
      if (qwenResult.ok) return qwenResult;
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

    return { ok: false as const, error: "no API key available" };
  });

async function tryQwen(
  apiKey: string,
  spec: ReturnType<typeof stageSpec>,
  userContent: string,
  stage: string,
) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000);
    const res = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen-plus",
        messages: [
          { role: "system", content: spec.system },
          { role: "user", content: userContent },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: spec.toolName,
              description: `Return structured ${stage} data.`,
              parameters: spec.schema,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: spec.toolName } },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429) return { ok: false as const, error: "rate_limit" };
      if (res.status === 402) return { ok: false as const, error: "no_credits" };
      return { ok: false as const, error: `qwen ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = await res.json();
    const argsStr = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsStr) return { ok: false as const, error: "empty tool call" };
    let parsed: any;
    try {
      parsed = JSON.parse(argsStr);
    } catch {
      return { ok: false as const, error: "parse error" };
    }
    return { ok: true as const, stage, payload: parsed };
  } catch (e) {
    return {
      ok: false as const,
      error:
        e instanceof Error && e.name === "AbortError"
          ? "timeout"
          : e instanceof Error
            ? e.message
            : "unknown",
    };
  }
}

async function tryLovable(
  apiKey: string,
  spec: ReturnType<typeof stageSpec>,
  userContent: string,
  stage: string,
) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000);
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: spec.system },
          { role: "user", content: userContent },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: spec.toolName,
              description: `Return structured ${stage} data.`,
              parameters: spec.schema,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: spec.toolName } },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429) return { ok: false as const, error: "rate_limit" };
      if (res.status === 402) return { ok: false as const, error: "no_credits" };
      return { ok: false as const, error: `gateway ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = await res.json();
    const argsStr = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsStr) return { ok: false as const, error: "empty tool call" };
    let parsed: any;
    try {
      parsed = JSON.parse(argsStr);
    } catch {
      return { ok: false as const, error: "parse error" };
    }
    return { ok: true as const, stage, payload: parsed };
  } catch (e) {
    return {
      ok: false as const,
      error:
        e instanceof Error && e.name === "AbortError"
          ? "timeout"
          : e instanceof Error
            ? e.message
            : "unknown",
    };
  }
}

async function tryMiniMax(
  apiKey: string,
  spec: ReturnType<typeof stageSpec>,
  userContent: string,
  stage: string,
) {
  // MiniMax doesn't support tool calling, so we ask for JSON-only response
  const systemWithJson =
    spec.system +
    "\n\n重要：只返回 JSON 对象，不要输出任何其他文字，不要用 markdown 代码块包裹，直接输出纯 JSON。";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000);
    const res = await fetch("https://api.minimaxi.com/anthropic/v1/messages", {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "MiniMax-Text-01",
        messages: [
          { role: "system", content: systemWithJson },
          { role: "user", content: userContent },
        ],
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false as const, error: `minimax ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = await res.json();
    // MiniMax returns content[].type === "text"
    const textParts: string[] = [];
    for (const block of json.content ?? []) {
      if (block.type === "text") {
        textParts.push(block.text);
      }
    }
    const fullText = textParts.join("").trim();
    if (!fullText) return { ok: false as const, error: "minimax empty response" };

    // Try to extract JSON from the response
    let parsed: any;
    try {
      // Try direct parse first
      parsed = JSON.parse(fullText);
    } catch {
      // Try to extract JSON from potential markdown code blocks
      const jsonMatch = fullText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          return { ok: false as const, error: "minimax parse error" };
        }
      } else {
        return { ok: false as const, error: "minimax parse error" };
      }
    }
    return { ok: true as const, stage, payload: parsed };
  } catch (e) {
    return {
      ok: false as const,
      error:
        e instanceof Error && e.name === "AbortError"
          ? "timeout"
          : e instanceof Error
            ? e.message
            : "unknown",
    };
  }
}

// ==================================================================
// 2026/06:多形象拆分改造 ——
//
// 之前架构:一个角色下挂 looks[] 数组,每个 look 是变体造型(label + 服装)。
// 用户反馈:看起来像"同一个角色在切装",但实际是不同身份(医生 vs 日常),
// 应该拆成独立角色各自生成图,而不是共享一个角色主体。
//
// 改造后:AI 直接在 characters[] 里输出多个独立角色(用 " · 身份" 后缀区分),
// 各自独立 face/body/clothing 描述。looks 数组从 schema 移除,
// generateCharacterLookAi 也不再需要(整条 server fn 删除)。
//
// 历史:这里曾经有 LookInputSchema / LookOutputSchema / LOOK_SYSTEM_PROMPT
// / generateCharacterLookAi 4 个东西,全部随 looks 一起被移除。
// 客户端 enrichCharacterLooks / generateOneCharacterLook /
// generateAllCharacterLooksForCurrentEpisode 三个函数也对应删除。
// ==================================================================
