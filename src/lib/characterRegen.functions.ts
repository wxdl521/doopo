import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

/**
 * 角色形象"按意见重生"接口 — **真 I2I**(Qwen multimodal-generation 端点)
 *
 * 客户端传:当前选中的图片 URL + 用户修改意见 + 形象描述(face/body/outfit)
 * 服务端调:Qwen 的 multimodal-generation/generation 端点
 *   - 端点:https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
 *   - 模型:qwen-image-2.0-pro(I2I;同步返回)
 *   - 消息格式:messages[0].content = [{image: url}, {text: instruction}]
 *   - 支持 negative_prompt(显式排除不想要的变化)
 *
 * 因为模型**能看见**原图,所以 prompt 不用重建整个描述,只需要:
 *   1) 把用户意见放在最显眼位置
 *   2) 一句话"保持其他不变"(脸/姿势/背景/风格)
 *   3) negative_prompt 显式排除"风格漂移 / 角度变化 / 表情出现 / 背景变化"
 *
 * 之前走 generateImage(T2I) 实际上不传图,只能靠文本描述锁脸。改用 I2I 后,
 * 模型直接看到原图,脸/构图/风格能精确保持,只改用户说的那一点。
 */

const QWEN_I2I_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'

const Input = z.object({
  referenceImageUrl: z.string().url(),  // 必填,重生必须看原图
  userInstruction: z.string().min(1).max(2000),
  faceDescription: z.string().max(4000),
  bodyDescription: z.string().max(4000),
  clothingDescription: z.string().max(4000),
  characterName: z.string().min(1).max(100),
  characterRoleLabel: z.string().min(1).max(200),
  characterAge: z.number().int().min(0).max(200),
  lookLabel: z.string().min(1).max(100),
  palette: z.array(z.string()).max(8).optional(),
  projectStyle: z.string().max(50).optional(),
  model: z.string().max(100).optional(),
  /**
   * 生成模式:
   *   - 'modify'      : 用户给修改意见,在原图基础上改。单图、严格约束
   *                    (正视/纯白/全身/无表情)
   *   - 'three-view'  : 标准三视图(front / side / back)。一张图含 3 个面板,
   *                    脸/身材/衣服跨面板一致。**不是单图,所以允许多角度**
   *   - 'multi-asset' : 多维资产图(多姿态/多表情/多场景拼图)。脸/身材/衣服
   *                    跨面板一致。允许各种姿态和场景。
   *
   * 默认 'modify' 保持原有行为;三视图/多维资产由客户端按钮触发。
   */
  mode: z.enum(['modify', 'three-view', 'multi-asset']).default('modify'),
})

export type RegenerateInput = z.infer<typeof Input>

/**
 * 根据 mode 拼不同的 positive / negative prompt。
 * - modify: 单图,严守原约束
 * - three-view: 3 面板,允许不同角度
 * - multi-asset: 多面板,允许各种姿态
 */
function buildPromptsForMode(opts: {
  data: RegenerateInput
  styleSpec: { label: string; positive: string; negative: string }
  cardTitle: string
}): { positive: string; negative: string; size: string } {
  const { data, styleSpec, cardTitle } = opts

  if (data.mode === 'three-view') {
    // ---- 标准三视图:1 张图 = 3 面板(front / side / back)----
    const positive = [
      `[GOAL] Generate a STANDARD 3-VIEW CHARACTER REFERENCE SHEET of "${cardTitle}" based on the attached image.`,
      `Layout: 3 panels arranged horizontally in one image — LEFT panel = FRONT view, MIDDLE panel = SIDE (profile) view, RIGHT panel = BACK view. Each panel shows the SAME character from a different angle.`,
      `[LOCK — must be IDENTICAL across all 3 panels]`,
      `Same face (shape, eyes, nose, mouth, eyebrows, skin tone), same hairstyle, same body proportions, same outfit ("${data.clothingDescription}"), same age appearance.`,
      `[Subject] ${cardTitle} — ${data.characterRoleLabel}, age ${data.characterAge}.`,
      `[Style] ${styleSpec.label} — ${styleSpec.positive}.`,
      `[Background] neutral light background (off-white or very light grey is OK here since this is a reference sheet, NOT a final product). NO scenery, NO floor, NO props.`,
      `[Each panel] full body head-to-toe visible. NO expression on the face. Center the character in each panel.`,
    ].join('\n')
    const negative = [
      'different art style, style drift, different medium, different line treatment',
      'different face, different hairstyle, different skin tone, different body, different outfit, different age',
      'cropped at knees, cropped at waist, close-up, head cut off, feet cut off',
      'smile, smirk, frown, angry eyes, sad eyes, laughing, crying, emotional expression',
      'scenery, furniture, props, busy background, complex background',
      'watermark, logo, text, signature, extra limbs, deformed hands, extra people',
    ].join(', ')
    return { positive, negative, size: '2048*1024' }  // 横向画布放 3 个面板
  }

  if (data.mode === 'multi-asset') {
    // ---- 多维资产图:多姿态/多表情/多场景拼图 ----
    const positive = [
      `[GOAL] Generate a MULTI-ANGLE CHARACTER ASSET SHEET of "${cardTitle}" based on the attached image.`,
      `Layout: ONE image containing 4-6 panels showing the SAME character in different situations — different poses, different expressions (subtle ones), different angles. Suggested panels:`,
      `  - Panel 1: standing action pose (e.g. walking, looking at distance)`,
      `  - Panel 2: sitting / crouching pose`,
      `  - Panel 3: close-up expression sheet (3 small faces: neutral / slight smile / serious, all the same character)`,
      `  - Panel 4: full body in environment (light, suggested context only — no detailed scenery)`,
      `  - Panel 5 (optional): prop interaction or signature gesture`,
      `[LOCK — must be IDENTICAL across all panels]`,
      `Same face (shape, eyes, nose, mouth, eyebrows, skin tone), same hairstyle, same body proportions, same outfit ("${data.clothingDescription}"), same age appearance. The 4-6 panels are all the SAME person, just different moments.`,
      `[Subject] ${cardTitle} — ${data.characterRoleLabel}, age ${data.characterAge}.`,
      `[Style] ${styleSpec.label} — ${styleSpec.positive}.`,
      `[Background] light neutral background per panel (varying subtle scenes are OK but no detailed scenery).`,
    ].join('\n')
    const negative = [
      'different art style, style drift, different medium, different line treatment',
      'different face, different hairstyle, different skin tone, different body, different outfit, different age',
      'extreme expressions, exaggerated emotions, cartoonish faces',
      'detailed scenery, busy backgrounds, complex environments',
      'watermark, logo, text, signature, extra limbs, deformed hands, extra people',
    ].join(', ')
    return { positive, negative, size: '2048*2048' }  // 方形画布放 2x2 或 2x3 网格
  }

  // ---- 默认 'modify': 单图,严格原约束 ----
  const positive = [
    `[EDIT REQUEST — what to change in the attached image]`,
    data.userInstruction,
    ``,
    `[LOCK — everything else MUST stay identical to the source image]`,
    `Keep the same face, same body, same camera angle (front view, eye-level), same full-body head-to-toe framing, same neutral expressionless face, same pure white #FFFFFF background, same visual style ("${styleSpec.label}"). Apply ONLY the change described above.`,
    ``,
    `[Subject] ${cardTitle} — ${data.characterRoleLabel}, age ${data.characterAge}.`,
  ].join('\n')
  const negative = [
    // 风格漂移
    'different art style, style drift, photorealistic when input is anime, anime when input is realistic, different medium, different line treatment, different color grading',
    // 角度漂移
    '3/4 view, side view, profile, back view, tilted head, looking up, looking down, top-down, bottom-up, hero shot, low angle, high angle, camera pan, camera tilt',
    // 构图漂移
    'cropped at knees, cropped at waist, cropped at chest, cropped at thighs, head cut off, feet cut off, close-up, medium shot, half body',
    // 表情漂移
    'smile, smirk, grin, frown, scowl, angry eyes, sad eyes, laughing, crying, pouting, raised eyebrow, eyes closed, eyes squinting, teeth showing, emotional expression',
    // 背景漂移
    'off-white background, cream background, ivory background, beige background, light grey background, gradient background, vignette, scenery, furniture, props, ground texture, horizon line, floor, wall, sky, shadow on background, floor reflection, color cast',
    // 脸漂移
    'different face, different face shape, different eye shape, different eye color, different nose, different mouth, different eyebrows, different skin tone, different hairstyle, different hair color, different hair length, different facial proportions, age change',
    // 杂项
    'watermark, logo, text, signature, extra limbs, deformed hands, extra fingers, extra people, blurred face, low quality',
  ].join(', ')
  return { positive, negative, size: '2048*2048' }
}

export const regenerateCharacterLook = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const { resolveProjectStyle, resolveI2IModel } = await import('./visualStyles')
    const styleSpec = resolveProjectStyle(data.projectStyle)
    const cardTitle = data.lookLabel === '默认'
      ? data.characterName
      : `${data.characterName} · ${data.lookLabel}`

    // 根据 mode 拼不同的 prompt 和画布尺寸
    const { positive, negative, size } = buildPromptsForMode({ data, styleSpec, cardTitle })

    // ---- 调 Qwen multimodal-generation 端点(同步返回) ----
    const apiKey = process.env.Qwen || process.env.DASHSCOPE_API_KEY
    if (!apiKey) {
      return { ok: false as const, error: 'Qwen API key not configured' }
    }
    // 强制 I2I-capable:有些 client 传来的 model(qwen-image-max 等)只支持 T2I,
    // DashScope multimodal-generation 端点会 400 "url error"。resolveI2IModel
    // 把这类 model 映射到订阅里 I2I 兼容的 qwen-image-2.0-pro。
    const model = resolveI2IModel(data.model)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    let res: Response
    try {
      res = await fetch(QWEN_I2I_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: {
            messages: [
              {
                role: 'user',
                content: [
                  // 真·图生图:把原图作为多模态 content 的 image 项
                  { image: data.referenceImageUrl },
                  { text: positive },
                ],
              },
            ],
          },
          parameters: {
            n: 1,
            negative_prompt: negative,
            prompt_extend: false,  // I2I 时关闭自动 prompt 扩展,严格按用户指令改
            watermark: false,
            size,  // 3-view 用 2048*1024,其他用 2048*2048(由 buildPromptsForMode 决定)
          },
        }),
        signal: controller.signal,
      })
    } catch (e) {
      clearTimeout(timeout)
      const msg = e instanceof Error ? e.message : 'unknown'
      const isAbort = e instanceof Error && e.name === 'AbortError'
      return { ok: false as const, error: isAbort ? 'AI 处理超时(>120s),请重试或换更简单的修改' : `请求失败: ${msg}` }
    }
    clearTimeout(timeout)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      // 把 dashscope 错误码转中文
      if (res.status === 401) return { ok: false as const, error: 'Qwen auth failed (401)' }
      if (res.status === 402) return { ok: false as const, error: 'no_credits' }
      if (res.status === 429) return { ok: false as const, error: 'rate_limit' }
      return { ok: false as const, error: `Qwen ${res.status}: ${text.slice(0, 300)}` }
    }

    const json = (await res.json()) as {
      output?: { choices?: Array<{ message?: { content?: Array<{ image?: string; type?: string }> } }> }
      message?: string
    }
    const url = json.output?.choices?.[0]?.message?.content?.[0]?.image
    if (!url) {
      return { ok: false as const, error: json.message || 'Qwen 未返回图片 URL' }
    }
    return { ok: true as const, url, model }
  })

