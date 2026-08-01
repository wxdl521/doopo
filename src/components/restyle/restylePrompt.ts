/**
 * 转绘资产图的提示词组装。
 * 之前生图提示词只带资产名称与本轮消息，用户第一轮描述的目标画风
 * （例如“转成美式 3D 动画”）会在回复“确认”后彻底丢失，导致画风不跟随。
 */

import { isConfirmIntent } from "./restyleIntent";

export type AssetPromptInput = {
  kind: "character" | "scene" | "prop";
  sourceName: string;
  sourceDescription: string;
  targetName: string;
  targetDescription: string;
};

const KIND_LABEL: Record<AssetPromptInput["kind"], string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
};

/** 用户消息里是否包含明确的画风表述，可用于更新项目的目标画风。 */
export function looksLikeStyleBrief(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return /(风格|画风|转绘成|转成|改成.*风|漫改|3D|3d|二次元|写实|赛璐璐|水墨|美漫|日漫|韩漫|动画风|插画|厚涂|像素|皮克斯|吉卜力)/.test(
    text,
  );
}

/** 组装单张资产图的提示词，强制带上目标画风约束。 */
export function buildAssetImagePrompt(
  asset: AssetPromptInput,
  styleBrief: string,
  extraInstruction = "",
): string {
  const style = styleBrief.trim();
  const extra = extraInstruction.trim();
  // “确认 / 继续 / 按资产表生成全部资产图”这类流程指令不是画面要求，
  // 不能写进提示词，否则会挤掉真正的画风描述。
  const meaningfulExtra =
    extra && !isConfirmIntent(extra) && !/^按资产表生成/.test(extra) ? extra : "";

  const lines: string[] = [];
  // 本轮修正必须排在最前并声明最高优先级：追加在末尾时，模型仍会被前面
  // 已经跑偏的目标设定主导，导致“指正了也没变化”。
  if (meaningfulExtra) {
    lines.push(
      `【本次修正要求·优先级最高】${meaningfulExtra}（与下方任何设定冲突时，一律以本条为准）`,
    );
  }
  lines.push(
    `【目标画风·必须严格遵守】${style || "保持原片整体质感，输出干净、统一、可复用的转绘资产图。"}`,
    `【资产类型】${KIND_LABEL[asset.kind]}`,
    `【资产名称】${asset.targetName || asset.sourceName}`,
    `【原片定位】${asset.sourceDescription}`,
    `【目标设定】${asset.targetDescription}`,
    "【约束】只生成该单一资产，背景干净，不得出现其他人物、场景或道具；整体色彩、材质、线条、光影、笔触必须与上述目标画风完全一致，不得混入其他画风。",
  );
  return lines.join("\n");
}

/** 把目标画风拼进方案生成的指令，保证分段视频提示词同风格。 */
export function withStyleBrief(instruction: string, styleBrief: string): string {
  const style = styleBrief.trim();
  if (!style) return instruction;
  return `【目标画风·必须严格遵守】${style}\n${instruction}`.trim();
}

/**
 * 资产图最终提示词的来源：用户在「过程与提示词」面板里手工覆盖过（promptOverride）
 * 时优先使用覆盖内容，否则走 buildAssetImagePrompt 自动拼装。
 */
export function resolveAssetImagePrompt(
  asset: AssetPromptInput & { promptOverride?: string },
  styleBrief: string,
  extraInstruction = "",
): string {
  const override = asset.promptOverride?.trim() ?? "";
  if (override) {
    const extra = extraInstruction.trim();
    const meaningfulExtra =
      extra && !isConfirmIntent(extra) && !/^按资产表生成/.test(extra) ? extra : "";
    // 手工覆盖过的提示词不能吞掉本轮指正，否则用户说“生成不对，请重新生成”
    // 会永远拿到同一张图。
    if (!meaningfulExtra) return override;
    return `【本次修正要求·优先级最高】${meaningfulExtra}（与下方任何设定冲突时，一律以本条为准）\n${override}`;
  }
  return buildAssetImagePrompt(asset, styleBrief, extraInstruction);
}