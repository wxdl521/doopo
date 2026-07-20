import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  ARK_TEXT_MODEL,
  ARK_TEXT_THINKING_DISABLED,
  arkTextApiKey,
  arkTextEndpoint,
  qwenApiKey,
} from "./arkText";

const QWEN_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

const AssetSchema = z.object({
  kind: z.enum(["character", "scene", "prop"]),
  sourceName: z.string().min(1).max(80),
  sourceDescription: z.string().min(1).max(500),
  targetName: z.string().min(1).max(80),
  targetDescription: z.string().min(1).max(500),
  importance: z.enum(["required", "optional"]),
  shouldRestyle: z.boolean(),
});

const InputSchema = z.object({
  instruction: z.string().min(1).max(4_000),
  model: z.enum([
    "ark:deepseek-v4-pro-260425",
    "qwen:qwen3.6-plus",
    "qwen:qwen3.6-flash",
    "qwen:qwen3.7-max",
  ]),
  sourceFiles: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        type: z.string().max(120),
        size: z.number().nonnegative().max(20_000_000_000),
      }),
    )
    .min(1)
    .max(30),
  /** Browser-extracted stills. Qwen visual models receive them as image_url parts. */
  frameImages: z.array(z.string().startsWith("data:image/").max(1_500_000)).max(4).default([]),
  existingAssets: z.array(AssetSchema).max(60).default([]),
});

export type RestyleAnalysisAsset = z.infer<typeof AssetSchema>;
export type RestyleAnalysisResult =
  | { ok: true; summary: string; assets: RestyleAnalysisAsset[]; model: string; usedFrames: boolean }
  | { ok: false; error: string };

function parseJson(content: string): unknown {
  const cleaned = content.replace(/^```(?:json)?\s*|\s*```$/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("模型没有返回可读取的资产表 JSON");
  }
}

function systemPrompt(hasFrames: boolean, isRevision: boolean): string {
  return `你是面向短剧出海转绘的资产制片人。根据用户要求、上传源片信息${hasFrames ? "以及抽取的关键帧" : ""}，输出供用户确认的资产表。\n\n${isRevision ? "当前已存在资产表。用户这次是在自然语言中反馈修改；只修改受影响的资产、补上明确遗漏项、删除明确要求删除的项，其余保持一致。" : "这是首次分析。只提取剧情理解、光影、节奏和台词语境中真正影响转绘一致性的角色、主要场景、关键道具。"}\n\n重要规则：\n1. 角色、场景、道具均可出现；角色应覆盖有剧情作用的人物，场景只保留重要且需要转绘的地点，道具只保留叙事或视觉连续性关键物。\n2. 根据用户的目标市场、人种、地域、语言、风格要求，为每条资产填入目标名称与目标说明；未要求改名时可保留原名。\n3. ${hasFrames ? "关键帧是视觉依据。" : "没有可读取的关键帧时不得虚构视频中具体发生的情节；名称或描述不确定时使用“待用户核对”。"}\n4. sourceDescription 写原片中的身份/场景定位/关键视觉信息；targetDescription 写目标市场版的人设、地域风格或转绘保留要求。\n5. importance 只有 required 或 optional；shouldRestyle 表示这条是否需要独立转绘。\n6. 最多 30 条，去重，不输出解释、Markdown 或代码块。\n\n只输出以下 JSON：\n{"summary":"不超过120字的确认提示","assets":[{"kind":"character|scene|prop","sourceName":"","sourceDescription":"","targetName":"","targetDescription":"","importance":"required|optional","shouldRestyle":true}]}`;
}

function userText(data: z.infer<typeof InputSchema>): string {
  const files = data.sourceFiles
    .map((file) => `- ${file.name} (${file.type || "unknown"}, ${(file.size / 1024 / 1024).toFixed(1)} MB)`)
    .join("\n");
  const previous = data.existingAssets.length
    ? `\n\n[CURRENT ASSET TABLE]\n${JSON.stringify(data.existingAssets)}`
    : "";
  return `[USER INSTRUCTION]\n${data.instruction}\n\n[SOURCE VIDEO FILES]\n${files}${previous}`;
}

function normalizeResult(content: string, model: string, usedFrames: boolean): RestyleAnalysisResult {
  try {
    const parsed = parseJson(content) as { summary?: unknown; assets?: unknown };
    const assets = z.array(AssetSchema).min(1).max(30).parse(parsed.assets);
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim().slice(0, 240)
        : "已完成资产提取，请逐项确认角色、场景、道具与目标市场设定。";
    return { ok: true, summary, assets, model, usedFrames };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "资产表解析失败" };
  }
}

/**
 * 转绘第一阶段：服务端调用 ARK DeepSeek 或 DashScope Qwen，返回结构化资产表。
 * Qwen 3.6 Plus/Flash 支持视觉理解，客户端会将源视频的关键帧作为 image_url 传入。
 */
export const analyzeRestyleAssets = createServerFn({ method: "POST" })
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<RestyleAnalysisResult> => {
    const isArk = data.model.startsWith("ark:");
    const model = isArk ? data.model.slice(4) || ARK_TEXT_MODEL : data.model.slice(5);
    const apiKey = isArk ? arkTextApiKey() : qwenApiKey();
    if (!apiKey) {
      return {
        ok: false,
        error: isArk
          ? "DeepSeek V4 Pro 未配置：请设置 ARK_API_KEY。"
          : "Qwen 未配置：请设置 Qwen、QWEN_API_KEY 或 DASHSCOPE_API_KEY。",
      };
    }

    const canReadFrames = !isArk && data.model !== "qwen:qwen3.7-max" && data.frameImages.length > 0;
    const userContent: Array<Record<string, unknown>> = [{ type: "text", text: userText(data) }];
    if (canReadFrames) {
      data.frameImages.forEach((url, index) => {
        // Keep the label as a separate content part: OpenAI-compatible multimodal APIs
        // reject a part that mixes `text` and `image_url` fields.
        userContent.push({ type: "text", text: `关键帧 ${index + 1}：` });
        userContent.push({ type: "image_url", image_url: { url } });
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetch(isArk ? arkTextEndpoint() : QWEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          ...(isArk ? { thinking: ARK_TEXT_THINKING_DISABLED } : {}),
          temperature: 0.2,
          max_tokens: 5_000,
          messages: [
            { role: "system", content: systemPrompt(canReadFrames, data.existingAssets.length > 0) },
            { role: "user", content: isArk ? userText(data) : userContent },
          ],
        }),
      });
      if (!response.ok) {
        const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 240);
        return { ok: false, error: `${isArk ? "DeepSeek" : "Qwen"} 请求失败（${response.status}）：${detail || "上游未返回详情"}` };
      }
      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        return { ok: false, error: `${isArk ? "DeepSeek" : "Qwen"} 未返回资产表内容。` };
      }
      return normalizeResult(content, model, canReadFrames);
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error && error.name === "AbortError"
            ? "资产分析超时，请稍后重试或切换模型。"
            : `资产分析请求失败：${error instanceof Error ? error.message : "未知错误"}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  });
