import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  ARK_TEXT_MODEL,
  ARK_TEXT_THINKING_DISABLED,
  arkTextApiKey,
  arkTextEndpoint,
} from "./arkText";

const RefineVideoPromptInput = z.object({
  /** 完整原始视频提示词。模型可据此理解叙事与不可破坏的技术约束。 */
  basePrompt: z.string().min(1).max(24_000),
  /** 确认卡原本展示的可编辑核心提示词，失败时用作安全回退。 */
  previewPrompt: z.string().min(1).max(12_000),
  /** 用户在 Agent 对话里提出的视频生成要求。 */
  userRequirements: z.string().min(1).max(4_000),
});

/**
 * 将分镜视频的原始提示词和用户补充要求交给 ARK DeepSeek V4 Pro。
 *
 * 只返回确认卡应展示的“核心提示词”：视频生成时仍会由调用方拼回原有的
 * 风格锁、稳定性规则等技术块，避免洗词时弱化既有的 I2V 约束。
 */
export const refineStoryboardVideoPrompt = createServerFn({ method: "POST" })
  .validator(RefineVideoPromptInput)
  .handler(async ({ data }) => {
    const apiKey = arkTextApiKey();
    if (!apiKey) {
      return { prompt: data.previewPrompt, refined: false };
    }

    try {
      const response = await fetch(arkTextEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: ARK_TEXT_MODEL,
          thinking: ARK_TEXT_THINKING_DISABLED,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: `You are an expert image-to-video prompt editor. Rewrite the editable creative/core prompt for a storyboard video generation request.

The user may write Chinese; understand and apply their requirements precisely. Preserve the original plot, shot order, characters, actions, dialogue, timing, reference-image intent, and every compatible instruction. Integrate requests such as expressive acting, vivid facial expressions, or a locked background into concrete video-generation wording. Never invent new story events.

You receive the full base prompt so you can respect its hard constraints. Return ONLY the rewritten editable core prompt in English, with no title, explanation, Markdown, code fence, or labels. Do NOT repeat technical blocks such as style locks, stability/negative constraints, FPS, or reference-image boilerplate: the application will append those unchanged after your answer.`,
            },
            {
              role: "user",
              content: `[USER REQUIREMENTS]\n${data.userRequirements}\n\n[CURRENT EDITABLE CORE PROMPT]\n${data.previewPrompt}\n\n[FULL BASE VIDEO PROMPT — CONTEXT ONLY]\n${data.basePrompt}`,
            },
          ],
        }),
      });
      if (!response.ok) return { prompt: data.previewPrompt, refined: false };

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const prompt = payload.choices?.[0]?.message?.content
        ?.replace(/^```(?:text|markdown)?\s*|\s*```$/gi, "")
        .trim();
      if (!prompt) return { prompt: data.previewPrompt, refined: false };
      return { prompt: prompt.slice(0, 12_000), refined: true };
    } catch {
      // 洗词不可阻断原有视频确认流程，DeepSeek 异常时继续使用原始提示词。
      return { prompt: data.previewPrompt, refined: false };
    }
  });
