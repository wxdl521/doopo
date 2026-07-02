import { createServerFn } from "@tanstack/react-start";

type Message = { role: "system" | "user" | "assistant"; content: string };

type Input = {
  messages: Message[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
};

const FALLBACK_MODELS = [
  "google/gemini-2.5-flash",
  "deepseek/deepseek-chat-v3.1",
  "meta-llama/llama-3.3-70b-instruct",
] as const;

const RETRYABLE_STATUSES = new Set([403, 404, 429]);

const getModelAttempts = (requested?: string) => {
  const requestedModel = requested?.trim();
  return [...new Set([requestedModel, ...FALLBACK_MODELS].filter(Boolean))] as string[];
};

export const generateScript = createServerFn({ method: "POST" })
  .inputValidator((input: Input) => {
    if (!input || !Array.isArray(input.messages) || input.messages.length === 0) {
      throw new Error("messages required");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return { content: "", error: "OPENROUTER_API_KEY is not configured" };
    }

    let lastError = "Generation failed";

    for (const model of getModelAttempts(data.model)) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 55_000);
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://doopoo.app",
            "X-Title": "Doopoo",
          },
          body: JSON.stringify({
            model,
            messages: data.messages,
            max_tokens: data.max_tokens ?? 2000,
            temperature: data.temperature ?? 0.85,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          if (res.status === 401)
            return { content: "", error: "OpenRouter authentication failed (401)" };
          lastError = `OpenRouter error ${res.status}: ${text.slice(0, 200)}`;
          if (RETRYABLE_STATUSES.has(res.status)) continue;
          return { content: "", error: lastError };
        }

        const json = await res.json();
        const content = json?.choices?.[0]?.message?.content ?? "";
        if (content) return { content, error: null as string | null };
        lastError = "Model returned an empty response";
      } catch (e) {
        lastError =
          e instanceof Error && e.name === "AbortError"
            ? "Request timed out. Retried with backup models but none completed."
            : e instanceof Error
              ? e.message
              : "Network error";
      }
    }

    return { content: "", error: lastError };
  });
