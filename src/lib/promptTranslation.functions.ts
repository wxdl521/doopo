import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  ARK_TEXT_MODEL,
  ARK_TEXT_THINKING_DISABLED,
  arkTextApiKey,
  arkTextEndpoint,
} from "./arkText";

const PromptTranslationInput = z.object({
  text: z.string().min(1).max(24_000),
  target: z.enum(["zh", "en"]),
});

/**
 * Translates only the user-editable portion of an image prompt. Keeping this on
 * the server means the translation model and its API key never reach the browser.
 */
export const translateEditablePrompt = createServerFn({ method: "POST" })
  .validator(PromptTranslationInput)
  .handler(async ({ data }) => {
    const apiKey = arkTextApiKey();
    if (!apiKey) return { text: data.text, translated: false };

    const language = data.target === "zh" ? "Simplified Chinese" : "English";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(arkTextEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: ARK_TEXT_MODEL,
          thinking: ARK_TEXT_THINKING_DISABLED,
          temperature: 0,
          messages: [
            {
              role: "system",
              content: `Translate the following user-editable image-generation prompt into ${language}. Return ONLY the translated prompt, with no commentary, labels, Markdown fences, or quotation marks. Preserve its line breaks, list structure, field labels, @mentions, numbers, image references, and all intentional constraints. Do not add, remove, weaken, or reinterpret any instruction.`,
            },
            { role: "user", content: data.text },
          ],
        }),
      });
      if (!response.ok) return { text: data.text, translated: false };
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = payload.choices?.[0]?.message?.content
        ?.replace(/^```(?:text|markdown)?\s*|\s*```$/gi, "")
        .trim();
      return text
        ? { text: text.slice(0, 24_000), translated: true }
        : { text: data.text, translated: false };
    } catch {
      return { text: data.text, translated: false };
    } finally {
      clearTimeout(timeout);
    }
  });
