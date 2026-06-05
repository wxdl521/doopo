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
    // 关键设计:同时下发**参考图 + 文字描述**,让模型在两路证据上对齐,
    // 任何一路"模糊"都被另一路补足,大幅减少换衣服 / 换脸 / 换形象的漂移。
    // v3 强化点:用 cinematic 摄影术语 + 显式画幅几何 + "per-panel"重复强调,
    // 解决反复出现的 side/back 面板被切脚 / 半身问题。
    const positive = [
      // 任务一句话
      `Generate ONE standard 3-view character reference sheet of "${cardTitle}" — a ${data.characterRoleLabel}, age ${data.characterAge}. The output is a SINGLE image with EXACTLY 3 panels (left = front, middle = side profile, right = back).`,
      ``,
      // 两路证据(参考图 + 文字)
      `You are given TWO sources of truth and BOTH must agree:
  (A) the attached REFERENCE IMAGE — the current approved front-view of "${cardTitle}", and
  (B) the FACE / BODY / OUTFIT text descriptions below.
If (A) and (B) ever disagree, follow (B). The character identity MUST match (B) exactly.`,
      ``,
      // 布局(强约束)
      `LAYOUT — strict, no exceptions:
  Output ONE image with EXACTLY 3 horizontal panels, side-by-side, equal width:
    • LEFT   = FRONT view (the reference image's angle)
    • MIDDLE = SIDE profile (90° rotation, character's RIGHT side facing the camera)
    • RIGHT  = BACK view (180° rotation)
  NO 4th panel. NO diagonal panel. NO detail box. NO labels. NO captions. NO arrows. NO scale indicators. NO text inside the image.`,
      ``,
      // 摄影术语(per-panel 重复)
      `PER-PANEL SHOT TYPE: Each of the 3 panels is a FULL SHOT (FS) / LONG SHOT (LS) / FULL-LENGTH PORTRAIT — the same framing used in character turnaround sheets, model sheets, and costume reference sheets. The character in EACH panel is shown standing upright from head to feet.`,
      ``,
      // 画幅几何(per-panel)
      `PER-PANEL GEOMETRY: Each panel is portrait-orientation. In each panel, the character occupies 85-95% of the panel's vertical extent — from the top of the head to the soles of the feet. Small white margin above the head AND below the feet in EACH panel. Both feet clearly visible at the bottom of EACH panel. The character does NOT touch the top or bottom edge of any panel.`,
      ``,
      // 构图步骤(per-panel 反复)
      `PER-PANEL COMPOSITION (apply in each of the 3 panels):
  1. Reserve a portrait-orientation panel.
  2. Place the character centered horizontally.
  3. Top of head at the top of the panel (with small margin).
  4. Soles of feet at the bottom of the panel (with small margin).
  5. Body fills the vertical axis of the panel — full body, no half-body.
  6. Both feet visible. Both hands visible at the sides.`,
      ``,
      // 硬约束(列出所有会让图被拒绝的失败模式)
      `HARD CONSTRAINTS — the image is REJECTED if ANY of these is true in ANY of the 3 panels:
  • The panel is a half-body, waist-up, hip-up, chest-up, shoulder-up, knee-up, cowboy shot, or head-and-shoulders crop.
  • The head or top of the hair is cut off at the top of the panel.
  • The feet or shoes are cut off at the bottom of the panel.
  • The character is floating with no visible feet, or the lower body fades into the background.
  • The body extends beyond the panel edge.
  • The character occupies less than 80% of the panel's height.
  • The side or back panel is tighter than the front panel (this is the #1 most common failure mode — both side and back must be JUST AS FULL as the front).
  • The image contains 4+ panels, or fewer than 3 panels.`,
      ``,
      // 镜头
      `CAMERA PER PANEL: standing upright, neutral A-pose (arms relaxed at the sides, feet slightly apart), expressionless face. The ONLY thing that changes between panels is the camera rotation around the vertical axis. NO 3/4 view, NO diagonal, NO action pose, NO walking, NO sitting, NO crouching, NO hands-on-hips, NO prop-holding.`,
      ``,
      // 表情
      `EXPRESSION IN ALL 3 PANELS: Neutral, expressionless, like a passport photo. No smile, no frown, no emotion, eyes open looking at the camera.`,
      ``,
      // 一致性
      `IDENTITY LOCK ACROSS ALL 3 PANELS: Same face, same body, same outfit, same age, same hair, same skin tone, same accessories, same shoes. The ONLY difference between panels is the camera angle. The face must be PIXEL-IDENTICAL across all 3 panels.`,
      ``,
      // 项目视觉风格
      `VISUAL STYLE (MUST match across all 3 panels — no style drift between panels):
  Style name: ${styleSpec.label}
  Style: ${styleSpec.positive}
  AVOID: ${styleSpec.negative}`,
      ``,
      // 角色描述
      `CHARACTER (source of truth, alongside the attached reference image):
  Name: ${cardTitle} (${data.characterRoleLabel}, age ${data.characterAge})
  Face (must remain identical in all 3 panels): ${data.faceDescription || '(use the face shown in the attached reference image)'}
  Body (must remain identical in all 3 panels): ${data.bodyDescription || '(use the body shown in the attached reference image)'}
  Outfit (must remain identical in all 3 panels — do NOT change the outfit between panels): ${data.clothingDescription || '(use the outfit shown in the attached reference image)'}`,
      ``,
      // 背景
      `BACKGROUND: Each panel has a uniform light neutral background (off-white #F5F5F5 / light grey #EEEEEE is OK — this IS a reference sheet, not a final product, so the strict pure-white rule is relaxed). NO scenery, NO floor, NO horizon, NO props, NO environment, NO shadow on the background, NO reflection.`,
      ``,
      // 终检
      `FINAL CHECK — verify every item before submitting. If any is false, REGENERATE the image:
  [ ] Output is ONE image with EXACTLY 3 panels (front / side / back) (yes)
  [ ] All 3 panels show FULL BODY head-to-toe (yes)
  [ ] All 3 panels show BOTH FEET at the bottom (yes)
  [ ] All 3 panels are equally full-body (side and back NOT tighter than front) (yes)
  [ ] Same face, body, outfit, age in all 3 panels (yes)
  [ ] Style matches "${styleSpec.label}" in all 3 panels (yes)
  [ ] Expression is neutral in all 3 panels (yes)
  [ ] No text, watermark, logo, labels, captions inside the image (yes)`,
      ``,
      `Begin. Output the 3-view full-body reference sheet.`,
    ].filter(Boolean).join('\n')
    const negative = [
      // —— 摄影 / 镜头(半身特写)——
      'medium shot, medium close-up, MCU, MS, mid-shot, mid close-up, half body, half-body, half-length, three-quarter body, 3/4 body, three-quarter length, cowboy shot, american shot, knee-up shot, knee-up, mid-thigh shot, thigh-up, hip-up, waist-up shot, waist-up, midriff-up, chest-up shot, chest-up, shoulder-up, head and shoulders, head-and-shoulders, head only, headshot, head shot, tight headshot, tight crop, tight framing, close-up, close up, CU, extreme close-up, ECU, bust shot, bust, portrait crop, portrait shot, passport photo, ID photo',
      // —— 切边 / 切脚 / 切头(per-panel 都要避免)——
      'cropped at knees, cropped at calves, cropped at shins, cropped at ankles, cropped at waist, cropped at hips, cropped at thighs, cropped at chest, cropped at shoulders, cropped at neck, head cut off, top of head cut off, top of head clipped, hair cut off, feet cut off, shoes cut off, hands cut off, body extending beyond frame, body touching frame edge, body touching top of frame, body touching bottom of frame, figure touching top of frame, figure touching bottom of frame, half-body in side panel, half-body in back panel, half-body in any panel, 3/4 body in any panel, close-up of torso in side or back panel, tight framing in side panel, tight framing in back panel, side panel tighter than front, back panel tighter than front, side panel showing only upper body, back panel showing only upper body',
      // —— 部位缺失 / 浮空——
      'missing feet, missing shoes, missing head, missing legs, missing lower body, missing upper body, head only, torso only, legs only, partial body, incomplete body, amputated limbs, no legs, no feet, legless, feet-less, lower body cut off, lower body fading out, lower body blended with background, character floating with no feet, character shown only from the waist up, from waist up only, from chest up only, from hips up only, from knees up only',
      // —— 摄像机角度(仰视 / 侧视)——
      'low angle, low-angle shot, worm\'s eye view, worm eye view, hero shot, looking up at subject, upward camera, upward tilt, camera below subject, dutch angle, dutch tilt, tilted camera, canted angle, fisheye, wide-angle distortion, 3/4 view, three-quarter view, diagonal angle, perspective, action pose, walking, sitting, crouching, jumping, leaning, hands on hips, prop holding, dynamic pose, tilted head, looking up, looking down, top-down, bird\'s eye view, bottom-up',
      // —— 风格漂移(在三视图里=失败)——
      'different art style, style drift, photorealistic when input is anime, anime when input is realistic, different medium, different line treatment, different color grading, inconsistent rendering between panels, mixing anime and realistic, mixing 3D and 2D, mixing watercolor and cel-shading',
      // —— 表情漂移——
      'smile, smirk, grin, frown, scowl, angry eyes, sad eyes, laughing, crying, pouting, raised eyebrow, looking sideways, eyes closed, eyes squinting, teeth showing, emotional expression, character personality face',
      // —— 身份漂移(三视图里=失败)——
      'different face, different face shape, different eye shape, different eye color, different nose, different mouth, different eyebrows, different skin tone, different hairstyle, different hair color, different hair length, different facial proportions, age change, different body, different body proportions, different height, different weight, different gender presentation, different outfit, different clothing color, different clothing style, different accessories, different hat, different glasses, different jewelry, different bag, different weapon, different shoes, different makeup, extra clothing item, missing clothing item, outfit change between panels',
      // —— 背景漂移——
      'scenery, furniture, props, ground texture, horizon line, floor, wall, sky, busy background, complex background, detailed background, color cast, gradient background, vignette, shadow on background, floor reflection, environment, room, indoor, outdoor',
      // —— 杂项——
      'watermark, logo, text, signature, label, panel number, caption, annotation, arrow, callout, extra limbs, deformed hands, extra fingers, extra people, multiple characters, bystander, blurred face, low quality, 4 panels, 5 panels, more than 3 views, fewer than 3 views, single panel',
    ].join(', ')
    return { positive, negative, size: '2048*1024' }  // 横向画布放 3 个面板
  }

  if (data.mode === 'multi-asset') {
    // ---- 多维资产图:多姿态/多表情/多场景拼图 ----
    // 关键设计:同时下发**参考图 + 文字描述**,跟 three-view 同款思路。
    const positive = [
      `[MISSION] Generate a MULTI-ANGLE CHARACTER ASSET SHEET of "${cardTitle}" — a ${data.characterRoleLabel}, age ${data.characterAge}.`,
      `You are given TWO sources of truth and BOTH must agree:`,
      `  (A) the attached REFERENCE IMAGE — the current approved front-view of "${cardTitle}", and`,
      `  (B) the FACE / BODY / OUTFIT text descriptions below, which are the source-of-truth for the locked character design.`,
      `If (A) and (B) ever disagree, follow (B) and treat (A) as a visual hint. The character identity MUST match (B) exactly.`,

      `[LAYOUT]`,
      `ONE image containing 4-6 panels showing the SAME character in different situations — different poses, different expressions (subtle ones), different angles. Suggested panels:`,
      `  - Panel 1: standing action pose (e.g. walking, looking into distance)`,
      `  - Panel 2: sitting / crouching pose`,
      `  - Panel 3: close-up expression sheet (3 small faces: neutral / slight smile / serious, all the same character)`,
      `  - Panel 4: full body in environment (light, suggested context only — no detailed scenery)`,
      `  - Panel 5 (optional): prop interaction or signature gesture`,

      `[CRITICAL RULES — output is REJECTED if ANY of these is violated.]`,

      `RULE 1 — IDENTITY LOCK: across all 4-6 panels, EVERY aspect of the character must be identical except the pose/expression. ` +
      `FORBIDDEN DRIFT: different face, different hairstyle, different skin tone, different body, different proportions, different age, different outfit, different clothing color, different accessories, different shoes, different gender presentation.`,

      `RULE 2 — HEAD-TO-TOE FRAMING (no exceptions): the FULL BODY must be visible in every full-body panel — head to feet, small margin above and below. ` +
      `FORBIDDEN CROPPING: cropping at knees / waist / chest / hips / shoulders, head cut off, feet cut off, body extending beyond frame. ` +
      `The expression sheet panel (Panel 3) is allowed to be close-up on the face only — this is the ONE exception.`,

      `RULE 3 — STYLE LOCK: all panels MUST be rendered in the project's selected visual style "${styleSpec.label}". ` +
      `FORBIDDEN STYLE DRIFT: mixing anime and realistic, mixing 3D and 2D, inconsistent line weight, inconsistent shading between panels.`,

      `RULE 4 — BACKGROUND: light neutral background per panel (varying subtle scenes are OK but no detailed scenery, no busy environments).`,

      `[VISUAL STYLE — REQUIRED, MANDATORY]`,
      `Style name: ${styleSpec.label}`,
      `Style: ${styleSpec.positive}`,
      `AVOID: ${styleSpec.negative}`,

      `[CHARACTER IDENTITY — copy into the image EXACTLY. Treat as the source of truth, alongside the attached reference image.]`,
      `Name: ${cardTitle} (${data.characterRoleLabel}, age ${data.characterAge})`,

      `=== FACE — must remain IDENTICAL across all panels ===`,
      data.faceDescription || '(no separate face description — use the face shown in the attached reference image)',
      `=== END FACE ===`,

      `=== BODY — must remain IDENTICAL across all panels ===`,
      data.bodyDescription || '(no separate body description — use the body shown in the attached reference image)',
      `=== END BODY ===`,

      `=== OUTFIT — must remain IDENTICAL across all panels. Do NOT change the outfit between panels, do NOT add/remove any clothing item, accessory, or prop. ===`,
      data.clothingDescription || '(no separate outfit description — use the outfit shown in the attached reference image)',
      `=== END OUTFIT ===`,

      `[FINAL CHECKLIST]`,
      `[ ] 4-6 panels showing the SAME character in different situations`,
      `[ ] Same face, same body, same outfit in every panel — no drift`,
      `[ ] Full body head-to-toe in every full-body panel (expression sheet panel may be close-up on face)`,
      `[ ] Style matches "${styleSpec.label}" across all panels`,
      `[ ] No text, no watermark, no logo, no labels inside the image`,

      `Begin.`,
    ].join('\n\n')
    const negative = [
      'different art style, style drift, photorealistic when input is anime, anime when input is realistic, different medium, different line treatment, different color grading, inconsistent rendering between panels',
      'cropped at knees, cropped at waist, cropped at chest, cropped at hips, cropped at shoulders, head cut off, feet cut off, body extending beyond frame',
      'extreme expressions, exaggerated emotions, cartoonish faces, open mouth screaming, eyes wide open, rage face',
      'different face, different face shape, different eye shape, different eye color, different nose, different mouth, different eyebrows, different skin tone, different hairstyle, different hair color, different hair length, different facial proportions, age change, different body, different body proportions, different height, different weight, different gender presentation, different outfit, different clothing color, different clothing style, different accessories, different hat, different glasses, different jewelry, different shoes, different makeup',
      'detailed scenery, busy backgrounds, complex environments, room interior, outdoor landscape, props cluttering the frame',
      'watermark, logo, text, signature, label, panel number, caption, extra limbs, deformed hands, extra fingers, extra people, bystander, multiple characters, blurred face, low quality',
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

