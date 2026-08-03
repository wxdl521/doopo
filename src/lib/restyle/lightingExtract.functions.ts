// ====================================================================
// lightingExtract —— 转绘「我的风格库」路径 A：参考图提取（一键迁移）
// 需求来源：《光线调度机制调整-20260804》第三节路径 A。
// 用户上传 1~3 张目标风格剧照，INTERNAL_VISION_MODEL 只提取「色调映射
// 关系」并拆解为 5 维光照参数 JSON；prompt 显式屏蔽纹理/背景图案/具体
// 物象，防止把参考图的猫/树当成光照迁移到短剧人物脸上。
// 解析（zod + ±100 钳制 + 脏数据兜底）为纯函数 parseLightingExtraction，
// 服务端壳只做鉴权、积分预校验（1 分/次，与资产表自检同口径）与调用。
// ====================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ensureEnoughCredits } from "../creditsGuard";
import { logGenerationError } from "../errorLogs.server";
import {
  callLovableChat,
  INTERNAL_VISION_MODEL,
  type ChatMessage,
} from "./lovableGateway";
import type { LightingParams } from "./cameraDirection";

// --------------------------------------------------------------------
// 提取 prompt：只取色调映射，显式屏蔽纹理/背景/物象
// --------------------------------------------------------------------

const EXTRACT_SYSTEM_PROMPT = `你是电影调色师，负责把参考剧照的视觉风格拆解为可调度的光照参数。

用户会给你 1~3 张参考剧照/电影截图。你的唯一任务：提取这些图片的「色调映射关系」，拆解为 5 维光照参数。

严格约束（防污染，最高优先级）：
- 只提取色调/影调层面的映射关系：光比、色温、阴影/中间调/高光的色相倾向、高光柔化与暗部裁剪阈值、肤色偏移。
- 显式屏蔽并忽略：画面纹理、材质细节、背景图案、具体物象（人物、动物、植物、建筑、道具、文字等）与构图内容。
- 禁止把画面主体（如猫、树、人脸）当作光照特征写入任何参数；palette / textureRollOff / skinToneOffset 只能写色彩与影调描述，不得出现具体物体名词。
- 多张参考图风格不一致时，取它们的共性色调，不逐图描述。

只输出 JSON（不要输出任何解释、不要用 Markdown 围栏），结构：
{
  "name": "风格名（不超过 12 字，如「冷调都市」「暖阳胶片」）",
  "contrastRatio": 整数 -100~+100，光比（主光与辅光强度差；正=硬朗高反差，负=柔和低反差）,
  "tempTint": 整数 -100~+100，色温偏移（正=暖，负=冷）,
  "palette": {
    "shadows": "阴影色相映射（如「加蓝，青蓝倾向」）",
    "midtones": "中间调色相映射",
    "highlights": "高光色相映射"
  },
  "textureRollOff": "质感衰减：高光柔化程度与暗部死黑裁剪阈值（决定胶片感或数字感）",
  "skinToneOffset": "肤色保护层：针对画面人群的肤色偏移（防变绿/变蜡黄）"
}`;

// --------------------------------------------------------------------
// 响应解析（纯函数，可测）：zod + ±100 钳制 + 脏数据兜底
// --------------------------------------------------------------------

const clamp100 = (value: number): number => Math.max(-100, Math.min(100, Math.round(value)));

/** 数值维：容忍字符串数字与越界值，钳到 ±100；完全不是数则归 0。 */
const DimSchema = z.coerce
  .number()
  .transform((value) => (Number.isFinite(value) ? clamp100(value) : 0))
  .catch(0);

/** 文本维：容忍缺失/非字符串，给影调兜底文案，最长 80 字。 */
const textDim = (fallback: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(80)
    .catch(fallback);

const PaletteSchema = z
  .object({
    shadows: textDim("自然过渡"),
    midtones: textDim("自然过渡"),
    highlights: textDim("保留细节不溢出"),
  })
  .catch({ shadows: "自然过渡", midtones: "自然过渡", highlights: "保留细节不溢出" });

const ExtractionSchema = z.object({
  name: z.string().trim().min(1).max(24).catch("自定义风格"),
  contrastRatio: DimSchema,
  tempTint: DimSchema,
  palette: PaletteSchema,
  textureRollOff: textDim("高光柔化，暗部不死黑"),
  skinToneOffset: textDim("中性，肤色防变绿变黄"),
});

export interface LightingExtraction {
  name: string;
  params: LightingParams;
}

export const LIGHTING_EXTRACT_PARSE_ERROR =
  "未能从参考图中识别出稳定的光照风格，请换用更清晰的剧照重试。";

/** 从模型文本中提取 JSON（容忍 ```json 围栏与前后杂散文本）。 */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.search(/\{/);
  if (start === -1) throw new Error("模型输出中未找到 JSON");
  const end = cleaned.lastIndexOf("}");
  if (end <= start) throw new Error("模型输出 JSON 不完整");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * 解析参考图提取的模型输出：容忍围栏/杂散文本/字符串数字/缺字段/越界值；
 * 顶层不是 JSON 对象（无法得出任何风格）时抛友好错误。
 */
export function parseLightingExtraction(text: string): LightingExtraction {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch {
    throw new Error(LIGHTING_EXTRACT_PARSE_ERROR);
  }
  const parsed = ExtractionSchema.safeParse(raw);
  if (!parsed.success) throw new Error(LIGHTING_EXTRACT_PARSE_ERROR);
  const { name, ...params } = parsed.data;
  return { name, params };
}

// --------------------------------------------------------------------
// server fn：extractLightingFromImages（1~3 张参考图，1 积分/次）
// --------------------------------------------------------------------

const ExtractInputSchema = z.object({
  imageUrls: z.array(z.string().url()).min(1).max(3),
});

export type ExtractLightingResult =
  | { ok: true; name: string; params: LightingParams }
  | { ok: false; code: string; error: string };

function buildExtractMessages(imageUrls: string[]): ChatMessage[] {
  const userContent: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `以下是 ${imageUrls.length} 张参考剧照。请按 system 的约束与输出契约，只提取它们的色调映射关系，输出 5 维光照参数 JSON。`,
    },
    ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
  return [
    { role: "system", content: EXTRACT_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}

/**
 * 路径 A：参考图提取风格。返回的 name/params 由前端写入
 * project.customLighting（source: "reference"），随后可在调色台继续微调。
 */
export const extractLightingFromImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ExtractInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ExtractLightingResult> => {
    const { userId } = context as { supabase: unknown; userId: string };

    // 积分预校验：1 分/次（与资产表自检同口径，按图片类计费）。
    const guard = await ensureEnoughCredits(1, { kind: "image", model: INTERNAL_VISION_MODEL });
    if (!guard.ok) return { ok: false, code: "INSUFFICIENT_CREDITS", error: guard.error };

    const res = await callLovableChat({
      model: INTERNAL_VISION_MODEL,
      messages: buildExtractMessages(data.imageUrls),
      maxTokens: 2_000,
      timeoutMs: 120_000,
      jsonMode: true,
    });
    if (!res.ok) {
      logGenerationError({
        kind: "image",
        provider: "lovable",
        model: INTERNAL_VISION_MODEL,
        errorMessage: res.error,
        requestPayload: { stage: "lighting-extract", imageCount: data.imageUrls.length },
        userId,
      });
      return { ok: false, code: "GATEWAY_ERROR", error: `风格提取失败：${res.error}` };
    }

    try {
      const { name, params } = parseLightingExtraction(res.text);
      return { ok: true, name, params };
    } catch (error) {
      const message = error instanceof Error ? error.message : LIGHTING_EXTRACT_PARSE_ERROR;
      logGenerationError({
        kind: "image",
        provider: "lovable",
        model: INTERNAL_VISION_MODEL,
        errorMessage: message,
        requestPayload: { stage: "lighting-extract-parse" },
        responseBody: res.text.slice(0, 500),
        userId,
      });
      return { ok: false, code: "PARSE_ERROR", error: message };
    }
  });
