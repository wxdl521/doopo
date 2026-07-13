import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  ARK_TEXT_MODEL,
  ARK_TEXT_THINKING_DISABLED,
  arkTextApiKey,
  arkTextEndpoint,
} from "./arkText";

const AgentActionSchema = z.enum([
  "produce_outline",
  "produce_script",
  "produce_episode",
  "produce_workspace_content",
  "extract_assets",
  "create_storyboard_groups",
  "modify_content",
  "click_ui",
  "navigate",
  "explain_capabilities",
  "clarify",
]);

const AgentPlanSchema = z.object({
  action: AgentActionSchema,
  targetStage: z.enum(["canvas", "script", "episodes", "character", "storyboard", "timeline"]),
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(240),
  executionPrompt: z.string().max(4000),
  requiresCredit: z.boolean(),
  uiActionId: z.string().min(1).max(80).optional(),
  uiActionLabel: z.string().min(1).max(120).optional(),
  /** 多步 UI 操作：例如先打开素材详情，再点删除。 */
  uiSteps: z
    .array(
      z.object({
        targetStage: z.enum(["canvas", "script", "episodes", "character", "storyboard", "timeline"]),
        uiActionId: z.string().min(1).max(80).optional(),
        uiActionLabel: z.string().min(1).max(120).optional(),
      }),
    )
    .min(2)
    .max(5)
    .optional(),
  clarification: z.string().max(240).optional(),
});

export type WorkspaceAgentPlan = z.infer<typeof AgentPlanSchema>;

const InputSchema = z.object({
  instruction: z.string().min(1).max(4000),
  stage: z.enum(["canvas", "script", "episodes", "character", "storyboard", "timeline"]),
  selectedEpisodeIndex: z.number().int().positive().optional(),
  context: z.object({
    episodeCount: z.number().int().nonnegative(),
    characterCount: z.number().int().nonnegative(),
    storyboardGroupCount: z.number().int().nonnegative(),
    hasSynopsis: z.boolean(),
  }),
  availableActions: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        label: z.string().min(1).max(120),
        hint: z.string().max(160).optional(),
        requiresCredit: z.boolean(),
      }),
    )
    .max(160)
    .optional(),
});

function fallbackPlan(input: z.infer<typeof InputSchema>): WorkspaceAgentPlan {
  const text = input.instruction.trim();
  const episode = input.selectedEpisodeIndex ?? 1;
  const stageMatch = text.match(/(?:在|到|去|打开|进入|切到)\s*(画布|剧本|分集|角色|场景|道具|分镜|故事板|时间轴|预览)/);
  const stageByName: Record<string, WorkspaceAgentPlan["targetStage"]> = {
    画布: "canvas", 剧本: "script", 分集: "episodes", 角色: "character", 场景: "character",
    道具: "character", 分镜: "storyboard", 故事板: "storyboard", 时间轴: "timeline", 预览: "timeline",
  };
  const requestedStage = stageMatch ? stageByName[stageMatch[1]] : undefined;
  const crossStageButton = [
    { test: /(?:新增|添加|新建).*(?:空)?角色|(?:空)?角色.*(?:新增|添加|新建)/, stage: "character" as const, label: "添加角色" },
    { test: /(?:新增|添加|新建).*(?:空)?场景|(?:空)?场景.*(?:新增|添加|新建)/, stage: "character" as const, label: "添加场景" },
    { test: /(?:新增|添加|新建).*(?:空)?道具|(?:空)?道具.*(?:新增|添加|新建)/, stage: "character" as const, label: "添加道具" },
    { test: /(?:渲染.*导出|导出.*视频)/, stage: "timeline" as const, label: "渲染并导出" },
  ].find((item) => item.test.test(text));
  if (crossStageButton) {
    return {
      action: "click_ui",
      targetStage: requestedStage ?? crossStageButton.stage,
      title: `执行：${crossStageButton.label}`,
      summary: `先进入目标阶段，再执行“${crossStageButton.label}”。`,
      executionPrompt: "",
      requiresCredit: /渲染|生成/.test(crossStageButton.label),
      uiActionLabel: crossStageButton.label,
    };
  }
  // “在角色阶段新增一个空角色”这类表达包含两个连续动作：先切换阶段，再点按钮。
  // 此时按钮尚不在当前 DOM，不能只依赖 availableActions 的即时快照。
  if (/(?:新增|添加|新建).*(?:空)?角色|(?:空)?角色.*(?:新增|添加|新建)/.test(text)) {
    return {
      action: "click_ui",
      targetStage: "character",
      title: "添加空角色",
      summary: "先进入角色阶段，再打开添加角色操作。",
      executionPrompt: "",
      requiresCredit: false,
      uiActionLabel: "添加角色",
    };
  }
  if (/(?:新增|添加|新建).*(?:空)?场景|(?:空)?场景.*(?:新增|添加|新建)/.test(text)) {
    return {
      action: "click_ui",
      targetStage: "character",
      title: "添加空场景",
      summary: "先进入角色与场景阶段，再打开添加场景操作。",
      executionPrompt: "",
      requiresCredit: false,
      uiActionLabel: "添加场景",
    };
  }
  if (/(?:新增|添加|新建).*(?:空)?道具|(?:空)?道具.*(?:新增|添加|新建)/.test(text)) {
    return {
      action: "click_ui",
      targetStage: "character",
      title: "添加空道具",
      summary: "先进入角色与场景阶段，再打开添加道具操作。",
      executionPrompt: "",
      requiresCredit: false,
      uiActionLabel: "添加道具",
    };
  }
  const normalized = text.replace(/(?:请|帮我|给我|我要|我想|点击|点一下|执行|帮忙)/g, "").trim();
  const matchedButton = input.availableActions?.find((item) =>
    normalized.includes(item.label) || item.label.includes(normalized),
  );
  if (matchedButton && normalized.length >= 2) {
    return {
      action: "click_ui",
      targetStage: input.stage,
      title: `执行：${matchedButton.label}`,
      summary: matchedButton.hint || "调用左侧页面中的对应操作。",
      executionPrompt: "",
      requiresCredit: matchedButton.requiresCredit,
      uiActionId: matchedButton.id,
      uiActionLabel: matchedButton.label,
    };
  }
  const isCapabilityQuestion = /能做什么|可以做什么|能干什么|功能|帮助|help|what can you do/i.test(text);
  if (isCapabilityQuestion) {
    return {
      action: "explain_capabilities",
      targetStage: input.stage,
      title: "Doopoo Agent 可以做什么",
      summary: "可生成故事梗概和分集剧本、提取角色/场景/道具、切分分镜组、修改剧本，并进入角色、分镜与时间轴阶段。图片和视频生成需在具体素材或分镜组卡片上发起，以便明确目标。",
      executionPrompt: "",
      requiresCredit: false,
      clarification: "你可以直接说“写一个校园悬疑短剧梗概”“生成下一集”“提取第 2 集角色场景”“把当前集切成分镜”。",
    };
  }
  const navigateMatch = text.match(/(?:去|打开|进入|切到)(?:一下)?\s*(剧本|分集|角色|场景|分镜|故事板|时间轴|预览)/);
  if (navigateMatch) {
    const targetMap: Record<string, WorkspaceAgentPlan["targetStage"]> = {
      剧本: "script", 分集: "episodes", 角色: "character", 场景: "character",
      分镜: "storyboard", 故事板: "storyboard", 时间轴: "timeline", 预览: "timeline",
    };
    const targetStage = targetMap[navigateMatch[1]] ?? input.stage;
    return { action: "navigate", targetStage, title: "切换工作阶段", summary: `进入${navigateMatch[1]}阶段。`, executionPrompt: "", requiresCredit: false };
  }
  if (/生成.*(?:视频|分镜图|故事板图)|(?:视频|分镜图|故事板图).*生成/.test(text)) {
    return {
      action: "clarify",
      targetStage: "storyboard",
      title: "需要选择具体分镜组",
      summary: "视频和分镜图会作用于某个分镜组，不能在未指定目标时批量覆盖生成。",
      executionPrompt: "",
      requiresCredit: false,
      clarification: "请进入分镜阶段，在目标分镜组的“生成分镜图”或“生成视频”按钮发起；该按钮会展示参考素材和积分确认。",
    };
  }
  if (/时间轴|预览|导出/.test(text)) {
    return {
      action: "navigate", targetStage: "timeline", title: "进入时间轴", summary: "切换到时间轴阶段。",
      executionPrompt: "", requiresCredit: false,
    };
  }
  if (/分镜|故事板/.test(text)) {
    if (!input.context.episodeCount || !input.context.characterCount) {
      return {
        action: "clarify", targetStage: "storyboard", title: "需要先补齐分镜前置内容",
        summary: "生成分镜前需要已有剧本和本集角色。", executionPrompt: "", requiresCredit: false,
        clarification: "请先生成剧本并提取本集角色、场景后，再让我切分分镜。",
      };
    }
    return {
      action: "create_storyboard_groups", targetStage: "storyboard", title: `切分第 ${episode} 集分镜`,
      summary: "根据当前剧本、角色和场景生成分镜组。", executionPrompt: "", requiresCredit: true,
    };
  }
  if (/提取.*(?:角色|场景|道具)|角色.*场景.*提取/.test(text)) {
    return {
      action: "extract_assets", targetStage: "character", title: `提取第 ${episode} 集素材`,
      summary: "从当前集剧本提取角色、场景和道具。", executionPrompt: `从第 ${episode} 集提取角色、场景和道具`, requiresCredit: true,
    };
  }
  if (/(?:生成|创建|设计).*(?:角色|场景|道具)/.test(text)) {
    if (!input.context.episodeCount) {
      return {
        action: "clarify", targetStage: "character", title: "需要先有剧本内容",
        summary: "角色、场景和道具需要从当前剧本提取，避免生成与剧情不一致的素材。",
        executionPrompt: "", requiresCredit: false,
        clarification: "请先生成剧本或导入剧本；完成后可说“提取当前集角色场景”。",
      };
    }
    return {
      action: "extract_assets", targetStage: "character", title: `提取第 ${episode} 集素材`,
      summary: "从当前集剧本提取角色、场景和道具。", executionPrompt: `从第 ${episode} 集提取角色、场景和道具`, requiresCredit: true,
    };
  }
  if (/下一集|本集|分场剧本|生成.*集/.test(text)) {
    return {
      action: "produce_episode", targetStage: "script", title: `生成第 ${episode + 1} 集剧本`,
      summary: "基于当前故事梗概和已生成剧集续写下一集。", executionPrompt: "生成本集分镜\n分镜数：15", requiresCredit: true,
    };
  }
  if (/^(?:(?:请|帮我|给我|我要|我想)\s*)?(?:写|创作|生成|做).{4,}/.test(text)) {
    if (input.stage === "canvas" || !input.context.hasSynopsis) {
      return {
        action: "produce_outline", targetStage: "canvas", title: "生成故事梗概",
        summary: "根据你的创意生成三幕故事梗概。", executionPrompt: text, requiresCredit: true,
      };
    }
    if (input.stage === "script" || input.stage === "episodes") {
      return {
        action: "produce_episode", targetStage: "script", title: "续写当前剧本",
        summary: "基于当前梗概与已有剧集继续生成内容。", executionPrompt: "生成本集分镜\n分镜数：15", requiresCredit: true,
      };
    }
  }
  if (/梗概|剧本/.test(text) && /生成|写|创作/.test(text)) {
    return {
      action: "produce_script", targetStage: "canvas", title: "生成故事梗概", summary: "根据你的要求生成剧本梗概。",
      executionPrompt: `生成剧本\n剧情：${text}`, requiresCredit: true,
    };
  }
  if (/修改|改成|调整|精简|加强|重写|润色/.test(text)) {
    if (input.stage === "character" || input.stage === "storyboard") {
      return {
        action: "clarify", targetStage: input.stage, title: "需要定位要修改的素材",
        summary: "素材和分镜修改需要先指定具体角色、场景、道具或分镜组，避免覆盖错误内容。",
        executionPrompt: "", requiresCredit: false,
        clarification: "请先点击对应卡片的“编辑/修改”入口，或告诉我具体名称和要修改的内容。",
      };
    }
    return {
      action: "modify_content", targetStage: input.stage, title: "修改当前内容", summary: "按你的要求修改当前阶段内容。",
      executionPrompt: text, requiresCredit: true,
    };
  }
  return {
    action: "clarify", targetStage: input.stage, title: "需要明确执行目标",
    summary: "我需要知道要作用在哪个内容上，才能安全执行。", executionPrompt: "", requiresCredit: false,
    clarification: "我可以处理创意写作、剧本续写、素材提取、分镜切分、内容修改和页面跳转。比如“写一个校园悬疑短剧”“生成下一集”“提取第 2 集角色场景”“切分当前集分镜”。",
  };
}

export const planWorkspaceAgentAction = createServerFn({ method: "POST" })
  .validator(InputSchema)
  .handler(async ({ data }): Promise<WorkspaceAgentPlan> => {
    const fallback = fallbackPlan(data);
    const apiKey = arkTextApiKey();
    if (!apiKey) return fallback;
    try {
      const response = await fetch(arkTextEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: ARK_TEXT_MODEL,
          thinking: ARK_TEXT_THINKING_DISABLED,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "你是 Doopoo 工作区执行规划器。只能返回 JSON，不要 markdown。可用 action: produce_outline, produce_script, produce_episode, produce_workspace_content, extract_assets, create_storyboard_groups, modify_content, click_ui, navigate, explain_capabilities, clarify。你是可执行的 Agent，不是命令匹配器：先理解用户意图、目标对象和所需页面，再把操作按依赖顺序执行。availableActions 仅是当前页面快照；若用户要操作其他阶段的左侧按钮，必须推断 targetStage，并返回 click_ui + 该按钮的准确 uiActionLabel（跨阶段 uiActionId 可为空，系统会先切页后重新定位）。需要连续点击时返回 uiSteps（2~5 步，每步包含 targetStage 与 uiActionId 或 uiActionLabel），例如先打开指定素材详情、等待弹窗出现后再点删除。不能仅因按钮不在当前页面就要求用户改用固定命令；只有对象确实缺失或操作有歧义时才 clarify。用户要求点击、打开、保存、编辑、删除、生成可见按钮时优先 click_ui。只有 navigate/explain_capabilities/clarify 不消耗积分；click_ui 的 requiresCredit 必须与所选操作一致，其他 AI 生成 action 必须为 true。上传本地文件需返回 clarify，说明需要用户在文件选择器中选择文件。图片和视频生成未指定具体素材或分镜组时返回 clarify。executionPrompt 必须是能交给现有工作流执行的中文指令。",
            },
            { role: "user", content: JSON.stringify(data) },
          ],
        }),
      });
      if (!response.ok) return fallback;
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) return fallback;
      const cleaned = content.replace(/^```(?:json)?\s*|\s*```$/g, "");
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start < 0 || end <= start) return fallback;
      const parsed = AgentPlanSchema.parse(JSON.parse(cleaned.slice(start, end + 1)));
      const selectedButton = data.availableActions?.find((item) => item.id === parsed.uiActionId);
      if (
        parsed.action === "click_ui" &&
        !selectedButton &&
        !parsed.uiActionLabel &&
        !parsed.uiSteps?.some((step) => step.uiActionId || step.uiActionLabel)
      ) return fallback;
      return {
        ...parsed,
        requiresCredit:
          parsed.action === "click_ui"
            ? (selectedButton?.requiresCredit ?? /生成|重生|提取|融合|连跑|切分|渲染|写剧本|开始创作/.test(parsed.uiActionLabel ?? ""))
            : !["navigate", "explain_capabilities", "clarify"].includes(parsed.action),
        uiActionLabel: selectedButton?.label ?? parsed.uiActionLabel,
      };
    } catch {
      return fallback;
    }
  });
