import videoAnalysisExtract from "./video-analysis-extract.md?raw";
import shotBoundaryExtract from "./shot-boundary-extract.md?raw";
import audioTranscriptAlign from "./audio-transcript-align.md?raw";
import aiOutputReview from "./ai-output-review.md?raw";
import narrativeConsistencyAudit from "./narrative-consistency-audit.md?raw";
import characterBible from "./character-bible.md?raw";
import wardrobeContinuity from "./wardrobe-continuity.md?raw";
import shotToSegment from "./shot-to-segment.md?raw";
import restylePromptContract from "./restyle-prompt-contract.md?raw";

/** 转绘 v2 的 9 个 prompt 规约 skill，key 与需求文档第六节清单一一对应。 */
export const SKILLS: Record<string, string> = {
  "video-analysis-extract": videoAnalysisExtract,
  "shot-boundary-extract": shotBoundaryExtract,
  "audio-transcript-align": audioTranscriptAlign,
  "ai-output-review": aiOutputReview,
  "narrative-consistency-audit": narrativeConsistencyAudit,
  "character-bible": characterBible,
  "wardrobe-continuity": wardrobeContinuity,
  "shot-to-segment": shotToSegment,
  "restyle-prompt-contract": restylePromptContract,
};

export type SkillId = keyof typeof SKILLS;

/**
 * 按序拼接指定 skill 全文与任务上下文，作为一次模型调用的 system prompt。
 * 未知 skill id 直接抛错，避免静默漏掉规约。
 */
export function composePrompt(skillIds: string[], context: string): string {
  const parts = skillIds.map((id) => {
    const skill = SKILLS[id];
    if (!skill) {
      throw new Error(`Unknown skill id: ${id}`);
    }
    return skill.trim();
  });
  return [...parts, "[CONTEXT]\n" + context.trim()].join("\n\n---\n\n");
}
