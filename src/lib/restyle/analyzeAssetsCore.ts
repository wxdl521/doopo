// ====================================================================
// v1 资产分析核心：画面理解统一走内部 Gemini skill（video-analysis-extract），
// 导演模型（用户下拉）只用于方案/审核，不参与画面读取。
// 从 restyleAnalysis.functions.ts 拆出以便测试注入。
// ====================================================================

import {
  callLovableChat,
  INTERNAL_VISION_MODEL,
  type GatewayChatResult,
} from "./lovableGateway";
import { composePrompt } from "./skills";

export interface AssetAnalysisInput {
  instruction: string;
  model: string; // 用户下拉的导演模型（仅播报/记录用，不参与画面分析）
  sourceFiles: Array<{ id?: string; name: string; type: string; size: number }>;
  frameImages: string[];
  transcript: string;
  existingAssets: Array<{ sourceName?: string } & Record<string, unknown>>;
}

export interface AssetAnalysisDeps<T extends AssetAnalysisInput, R> {
  callChat?: typeof callLovableChat;
  userText: (data: T) => string;
  systemPrompt: (hasFrames: boolean, isRevision: boolean) => string;
  normalizeResult: (content: string, model: string, usedFrames: boolean, transcript?: string) => R;
}

/**
 * 执行资产分析：skill 规约（视觉分析口径）+ v1 资产表输出契约（CONTEXT 覆盖段），
 * 经 Lovable 网关调 google/gemini-3.6-flash。关键帧以 image_url 传入。
 */
export async function runAssetAnalysis<T extends AssetAnalysisInput, R>(
  data: T,
  deps: AssetAnalysisDeps<T, R>,
): Promise<R> {
  const callChat = deps.callChat ?? callLovableChat;
  const canReadFrames = data.frameImages.length > 0;

  // skill 管视觉纪律，CONTEXT 管 v1 资产表输出契约（显式覆盖 skill 自带的完整视觉 JSON 口径）
  const contract = [
    "本任务只要求输出下方资产表契约 JSON，不要输出 skill 中定义的完整视觉分析 JSON。",
    "",
    deps.systemPrompt(canReadFrames, data.existingAssets.length > 0),
  ].join("\n");
  const system = composePrompt(["video-analysis-extract"], contract);

  const userContent: Array<Record<string, unknown>> = [
    { type: "text", text: deps.userText(data) },
  ];
  if (canReadFrames) {
    data.frameImages.forEach((url, index) => {
      userContent.push({ type: "text", text: `关键帧 ${index + 1}：` });
      userContent.push({ type: "image_url", image_url: { url } });
    });
  }

  const result: GatewayChatResult = await callChat({
    model: INTERNAL_VISION_MODEL,
    maxTokens: 5_000,
    timeoutMs: 180_000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
  });
  if (!result.ok) return { ok: false, error: result.error } as R;
  return deps.normalizeResult(result.text, INTERNAL_VISION_MODEL, canReadFrames, data.transcript);
}
