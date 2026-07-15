import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  ARK_TEXT_MODEL,
  ARK_TEXT_THINKING_DISABLED,
  arkTextApiKey,
  arkTextEndpoint,
} from "./arkText";

const StoryboardVideoAgentInput = z.object({
  instruction: z.string().min(1).max(4_000),
  groups: z
    .array(
      z.object({
        index: z.number().int().positive(),
        hasShotImage: z.boolean(),
        hasStoryboard: z.boolean(),
      }),
    )
    .max(200),
});

const PrepareArgs = z.object({
  groupIndex: z.number().int().positive(),
  method: z.enum(["shots", "storyboard"]),
});

export type StoryboardVideoAgentResult =
  | { action: "prepare"; groupIndex: number; method: "shots" | "storyboard" }
  | { action: "clarify"; summary: string };

type AgentMessage = Record<string, unknown>;
type ToolCall = {
  id?: string;
  function?: { name?: string; arguments?: string };
};

const tools = [
  {
    type: "function",
    function: {
      name: "inspect_storyboard_groups",
      description:
        "Read the available image/storyboard source for each storyboard group before choosing a video flow.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "prepare_video_confirmation",
      description:
        "Prepare one exact storyboard group's video confirmation card with its valid source method.",
      parameters: {
        type: "object",
        properties: {
          groupIndex: { type: "integer", minimum: 1 },
          method: { type: "string", enum: ["shots", "storyboard"] },
        },
        required: ["groupIndex", "method"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clarify_video_target",
      description:
        "Ask a concise clarification when no valid target group or video source can be determined.",
      parameters: {
        type: "object",
        properties: { summary: { type: "string", minLength: 1, maxLength: 240 } },
        required: ["summary"],
        additionalProperties: false,
      },
    },
  },
] as const;

function fallback(input: z.infer<typeof StoryboardVideoAgentInput>): StoryboardVideoAgentResult {
  const match = input.instruction.match(
    /(?:第\s*(\d+)\s*(?:个)?\s*(?:分镜(?:[（(]?组[）)]?)?|镜头(?:[（(]?组[）)]?)?)|(?:分镜(?:[（(]?组[）)]?)?|镜头(?:[（(]?组[）)]?)?)\s*(?:第\s*)?(\d+))/,
  );
  const groupIndex = Number(match?.[1] ?? match?.[2]);
  const group = input.groups.find((item) => item.index === groupIndex);
  if (!group) {
    return {
      action: "clarify",
      summary: "请告诉我要生成视频的分镜组编号，例如“生成分镜组 4 的视频”。",
    };
  }
  const explicitlyStoryboard = /故事[板版]/.test(input.instruction);
  const explicitlyShots = /分镜图/.test(input.instruction);
  if (explicitlyStoryboard && group.hasStoryboard) {
    return { action: "prepare", groupIndex, method: "storyboard" };
  }
  if (explicitlyShots && group.hasShotImage) {
    return { action: "prepare", groupIndex, method: "shots" };
  }
  if (group.hasShotImage) return { action: "prepare", groupIndex, method: "shots" };
  if (group.hasStoryboard) return { action: "prepare", groupIndex, method: "storyboard" };
  return {
    action: "clarify",
    summary: `第 ${groupIndex} 分镜组还没有分镜图或故事板，暂时无法生成视频。`,
  };
}

/**
 * 分镜视频 Agent：DeepSeek 先通过 inspect 工具读取实时素材状态，再选择并调用
 * prepare 工具。真正生成仍由客户端的确认卡显式触发，模型没有直接扣费或生成权限。
 */
export const runStoryboardVideoAgent = createServerFn({ method: "POST" })
  .validator(StoryboardVideoAgentInput)
  .handler(async ({ data }): Promise<StoryboardVideoAgentResult> => {
    const apiKey = arkTextApiKey();
    if (!apiKey) return fallback(data);

    const messages: AgentMessage[] = [
      {
        role: "system",
        content: `You are Doopoo's storyboard-video agent. You must use tools, never answer with ordinary text.
First call inspect_storyboard_groups. Then identify the requested group and call prepare_video_confirmation with a valid method.
For an unspecified source, prefer shots when shot images exist; otherwise choose storyboard when a storyboard exists. If the user explicitly requests a storyboard or shot images, honor it only when that source exists. If no target or valid source exists, call clarify_video_target.
You cannot generate video or spend credits. Your only job is to select the safe confirmation-card action.`,
      },
      { role: "user", content: data.instruction },
    ];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      for (let step = 0; step < 3; step += 1) {
        const response = await fetch(arkTextEndpoint(), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
          body: JSON.stringify({
            model: ARK_TEXT_MODEL,
            thinking: ARK_TEXT_THINKING_DISABLED,
            temperature: 0,
            messages,
            tools,
            tool_choice: "auto",
          }),
        });
        if (!response.ok) return fallback(data);
        const payload = (await response.json()) as {
          choices?: Array<{ message?: AgentMessage & { tool_calls?: ToolCall[] } }>;
        };
        const message = payload.choices?.[0]?.message;
        const calls = message?.tool_calls ?? [];
        if (!message || calls.length === 0) return fallback(data);
        messages.push(message);

        for (const call of calls) {
          const name = call.function?.name;
          const argsText = call.function?.arguments ?? "{}";
          if (name === "inspect_storyboard_groups") {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({ groups: data.groups }),
            });
            continue;
          }
          if (name === "prepare_video_confirmation") {
            const parsed = PrepareArgs.safeParse(JSON.parse(argsText));
            if (!parsed.success) return fallback(data);
            const group = data.groups.find((item) => item.index === parsed.data.groupIndex);
            const valid =
              (parsed.data.method === "shots" && group?.hasShotImage) ||
              (parsed.data.method === "storyboard" && group?.hasStoryboard);
            return valid ? { action: "prepare", ...parsed.data } : fallback(data);
          }
          if (name === "clarify_video_target") {
            const args = JSON.parse(argsText) as { summary?: unknown };
            return {
              action: "clarify",
              summary:
                typeof args.summary === "string" && args.summary.trim()
                  ? args.summary.slice(0, 240)
                  : "请告诉我要生成视频的分镜组编号。",
            };
          }
        }
      }
      return fallback(data);
    } catch {
      return fallback(data);
    } finally {
      clearTimeout(timeout);
    }
  });
