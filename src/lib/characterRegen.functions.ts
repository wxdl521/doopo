// ====================================================================
//  角色形象"按意见重生" —— 委托给 Seedream
//
//  客户端传:当前选中的图片 URL + 用户修改意见 + 形象描述(face/body/outfit)
//  服务端调:seedream.functions.ts:regenerateCharacterLook
//    - 端点: {ARK_BASE_URL}/images/generations
//    - 模型: doubao-seedream-5-0-260128(单图 I2I,image 字段 = URL)
//    - 3 个模式:modify(单图严约束) / three-view(三视图表) / multi-asset(角色设定稿 · 3视图+6特写)
//    - 提示词 builder 集中在 seedream.functions.ts
//
//  2026 重构:把 I2I 调用从 DashScope multimodal-generation 迁到 Seedream。
//  之前用 Qwen 时,negative_prompt 是显式字段;Seedream 没有,改成追加到
//  positive 末尾的 "FORBIDDEN: ..." 块。
// ====================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  referenceImageUrl: z.string().url(), // 必填,主视图(图1,要改的那张),重生必须看原图
  /**
   * 2026/07:额外参考图(图2..N),追加在主视图之后做多图融合。
   * 主视图(要改的那张)强制在图1,额外图仅作风格/细节参考,不得改主视图的身份特征。
   * 上限 4 张,加主视图总 5 张(Seedream 上限 10)。
   */
  extraReferenceImageUrls: z.array(z.string().url()).max(9).optional(),
  userInstruction: z.string().min(1).max(64_000),
  /**
   * 已完整展开的 API prompt；传入后服务端不再二次包裹编辑模板。
   * 分镜/角色的真实原始 prompt 可能很长，不能在外层 Server Function 提前截断。
   */
  rawPrompt: z.string().min(1).max(64_000).optional(),
  faceDescription: z.string().max(4000),
  bodyDescription: z.string().max(4000),
  clothingDescription: z.string().max(4000),
  characterName: z.string().min(1).max(100),
  characterRoleLabel: z.string().min(1).max(4_000),
  characterAge: z.number().int().min(0).max(200),
  lookLabel: z.string().min(1).max(100),
  palette: z.array(z.string()).max(8).optional(),
  projectStyle: z.string().max(50).optional(),
  characterNationality: z.string().min(1).max(100).optional(),
  model: z.string().max(1_000).optional(),
  /**
   * 生成模式:
   *   - 'modify'      : 用户给修改意见,在原图基础上改。单图、严格约束
   *                    (正视/纯白/全身/无表情)
   *   - 'three-view'  : 标准三视图(front / side / back)。一张图含 3 个面板,
   *                    脸/身材/衣服跨面板一致。**不是单图,所以允许多角度**
   *   - 'multi-asset' : 角色设定稿(Character Reference Sheet,专业游戏美术风格)。
   *                    一张图 = 3×3 网格:Row1 是 3 视图全身(front/side/back),
   *                    Row2-3 是 6 个细节特写(face/eyes/hair/clothing/belt/shoes)。
   *                    角色比例完全一致,无变形,无透视错误,适合作为后续分镜的锚点。
   *
   * 默认 'modify' 保持原有行为;三视图/角色设定稿由客户端按钮触发。
   */
  mode: z.enum(["modify", "three-view", "multi-asset"]).default("modify"),
  // 2026/06:查看提示词模式 —— true 时 server 只 build prompt 返回,不实际调 Seedream
  previewOnly: z.boolean().default(false),
});

export type RegenerateInput = z.infer<typeof Input>;

/**
 * 重导出 / 委托。
 *
 * 实际 prompt 构建和 Seedream 调用都搬到 seedream.functions.ts 里去了,
 * 这里只保留 Zod schema(客户端类型推导需要)和 server function 入口。
 */
export const regenerateCharacterLook = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const parsed = Input.safeParse(d);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join("; ");
      console.warn(`[character-regen×] invalid request: ${detail}`);
      throw parsed.error;
    }
    return parsed.data;
  })
  .handler(async ({ data }) => {
    // 动态 import 避免循环引用
    const { regenerateCharacterLook: seedreamImpl } = await import("./seedream.functions");
    return seedreamImpl({ data } as any);
  });
