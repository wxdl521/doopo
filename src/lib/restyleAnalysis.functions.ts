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

const AnalysisSectionsSchema = z.object({
  plot: z.string().max(4_000).default(""),
  videoUnderstanding: z.string().max(4_000).default(""),
  dialogue: z.string().max(4_000).default(""),
  assets: z.string().max(4_000).default(""),
});

const InputSchema = z.object({
  instruction: z.string().min(1).max(4_000),
  model: z.enum([
    "ark:deepseek-v4-pro-260425",
    "ark:doubao-seed-2-1-pro-260628",
    "qwen:qwen3.6-plus",
    "qwen:qwen3.6-flash",
    "qwen:qwen3.7-max",
  ]),
  sourceFiles: z
    .array(
      z.object({
        id: z.string().min(1).max(200).optional(),
        name: z.string().min(1).max(255),
        type: z.string().max(120),
        size: z.number().nonnegative().max(20_000_000_000),
      }),
    )
    .min(1)
    .max(30),
  /** Timeline samples spanning the complete source video. Qwen receives them as image_url parts. */
  frameImages: z.array(z.string().startsWith("data:image/").max(500_000)).max(24).default([]),
  existingAssets: z.array(AssetSchema).max(60).default([]),
});

export type RestyleAnalysisAsset = z.infer<typeof AssetSchema>;
export type RestyleAnalysisResult =
  | {
      ok: true;
      summary: string;
      assets: RestyleAnalysisAsset[];
      analysis: z.infer<typeof AnalysisSectionsSchema>;
      model: string;
      usedFrames: boolean;
    }
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
  return `你是面向短剧出海转绘的资产制片人。根据用户要求、上传源片信息${hasFrames ? "以及抽取的关键帧" : ""}，输出供用户确认的资产表。\n\n${isRevision ? "当前已存在资产表。用户这次是在自然语言中反馈修改；只修改受影响的资产、补上明确遗漏项、删除明确要求删除的项，其余保持一致。" : "这是首次分析。只提取剧情理解、光影、节奏和台词语境中真正影响转绘一致性的资产。"}\n\n重要规则：\n1. 角色、场景、道具都不是必选项；某一类不存在时，该类必须输出空，不得为了凑数添加。全部不存在时 assets 必须是空数组。\n2. 角色必须是画面中有明确剧情作用的某一个具体人物，一人一条；不要输出“居民”“市民”“人群”“表演者”“观众”“工作人员”“人物群体”等群体。\n3. 场景必须是一个具体、可定位的地点或空间，例如“街角面馆”“某栋居民楼的客厅”“嵊州古城城门”；不要输出“城市风光”“古城全景”“街景”“环境”“建筑群”等泛称。\n4. 道具必须是一个具体、可单独识别的物件，例如“一盏红灯笼”“一块写有店名的木招牌”“一口铁锅”；不要输出“招牌与灯笼”“器具与食物”等多个对象、类别或概念。\n5. 如果只能确认群体、远景、类别或模糊物件，就不要提取；宁可少提取或返回空数组，也不能猜测。\n6. 根据用户的目标市场、人种、地域、语言、风格要求，为每条具体资产填入目标名称与目标说明；未要求改名时可保留原名。\n7. ${hasFrames ? "关键帧是视觉依据。" : "没有可读取的关键帧时不得虚构视频中具体发生的情节；名称或描述不确定时直接省略该资产。"}\n8. sourceDescription 写该具体人物/地点/物件在原片中的定位；targetDescription 写目标市场版的对应设定。\n9. importance 只有 required 或 optional；shouldRestyle 表示这条是否需要独立转绘。最多 30 条，去重，不输出解释、Markdown 或代码块。\n\n只输出以下 JSON：\n{"summary":"不超过120字的确认提示","assets":[{"kind":"character|scene|prop","sourceName":"","sourceDescription":"","targetName":"","targetDescription":"","importance":"required|optional","shouldRestyle":true}]}`;
}

function userText(data: z.infer<typeof InputSchema>): string {
  const files = data.sourceFiles
    .map(
      (file) =>
        `- ${file.name} (${file.type || "unknown"}, ${(file.size / 1024 / 1024).toFixed(1)} MB)`,
    )
    .join("\n");
  const previous = data.existingAssets.length
    ? `\n\n[CURRENT ASSET TABLE]\n${JSON.stringify(data.existingAssets)}`
    : "";
  return `[USER INSTRUCTION]\n${data.instruction}\n\n[SOURCE VIDEO FILES]\n${files}${previous}\n\n[ANALYSIS SECTIONS]\nAlso return an analysis object with four concise strings: plot, videoUnderstanding, dialogue, and assets. Keep the asset table unchanged; do not invent dialogue when it cannot be confirmed.`;
}

function normalizeResult(
  content: string,
  model: string,
  usedFrames: boolean,
): RestyleAnalysisResult {
  try {
    const parsed = parseJson(content) as {
      summary?: unknown;
      assets?: unknown;
      analysis?: unknown;
    };
    const assets = z
      .array(AssetSchema)
      .max(30)
      .parse(parsed.assets ?? [])
      .filter((asset) => isConcreteAsset(asset));
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim().slice(0, 240)
        : "已完成资产提取，请逐项确认角色、场景、道具与目标市场设定。";
    const analysis = AnalysisSectionsSchema.parse(
      parsed.analysis ?? {
        plot: summary,
        videoUnderstanding: usedFrames
          ? "已结合关键帧完成画面、镜头和动作理解。"
          : "已完成原片结构分析；当前模型未读取关键帧。",
        dialogue: "未返回可确认的台词文本，请在原片分析中补充或校对。",
        assets: assets.length
          ? assets.map((asset) => asset.sourceName).join("、")
          : "未识别到需要单独转绘的资产。",
      },
    );
    return { ok: true, summary, assets, analysis, model, usedFrames };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "资产表解析失败" };
  }
}

const GENERIC_ASSET_TERMS =
  /居民|市民|人群|群众|表演者|观众|工作人员|人物群体|角色群体|城市风光|古城全景|街景|环境|建筑群|物品|道具|食物|场景概念/i;

function isConcreteAsset(asset: RestyleAnalysisAsset): boolean {
  const sourceName = asset.sourceName.trim();
  if (!sourceName || GENERIC_ASSET_TERMS.test(sourceName)) return false;
  // A conjunction or ampersand in a source name usually means the model
  // merged several people/places/objects into one row.
  if (/[与和及、/&]/.test(sourceName)) return false;
  return true;
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

    const canReadFrames =
      !isArk && data.model !== "qwen:qwen3.7-max" && data.frameImages.length > 0;
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
    // Vision requests include several keyframes and can legitimately take longer
    // than a text-only completion. Keep the client-side request alive for 3 min.
    const timeout = setTimeout(() => controller.abort(), 180_000);
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
            {
              role: "system",
              content: systemPrompt(canReadFrames, data.existingAssets.length > 0),
            },
            { role: "user", content: isArk ? userText(data) : userContent },
          ],
        }),
      });
      if (!response.ok) {
        const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 240);
        return {
          ok: false,
          error: `${isArk ? "DeepSeek" : "Qwen"} 请求失败（${response.status}）：${detail || "上游未返回详情"}`,
        };
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
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

const PlanEpisodeSchema = z.object({
  // Kept as `episode` for backward-compatible persisted projects. Its value is now the source video ID.
  episode: z.string().min(1).max(200),
  segments: z
    .array(z.object({ id: z.string().min(1).max(40), prompt: z.string().min(1).max(8_000) }))
    .min(1)
    .max(30),
});

export type RestylePlanEpisode = z.infer<typeof PlanEpisodeSchema>;

const PlanInputSchema = z.object({
  model: InputSchema.shape.model,
  instruction: z.string().max(4_000).default(""),
  sourceFiles: InputSchema.shape.sourceFiles,
  assets: z.array(AssetSchema).max(60),
  episodeCount: z.number().int().min(1).max(100),
  existingEpisodes: z.array(PlanEpisodeSchema).default([]),
});

export const generateRestylePlan = createServerFn({ method: "POST" })
  .validator((input: unknown) => PlanInputSchema.parse(input))
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true; episodes: RestylePlanEpisode[]; model: string } | { ok: false; error: string }
    > => {
      const isArk = data.model.startsWith("ark:");
      const model = isArk ? data.model.slice(4) || ARK_TEXT_MODEL : data.model.slice(5);
      const apiKey = isArk ? arkTextApiKey() : qwenApiKey();
      if (!apiKey)
        return {
          ok: false,
          error: isArk
            ? "DeepSeek V4 Pro 未配置：请设置 ARK_API_KEY。"
            : "Qwen 未配置：请设置 Qwen、QWEN_API_KEY 或 DASHSCOPE_API_KEY。",
        };
      const files = data.sourceFiles
        .map((file) => `- 视频 ID: ${file.id || file.name}; 文件名: ${file.name}`)
        .join("\n");
      const prompt = `用户要求：${data.instruction || "生成转绘方案"}\n视频数量：${data.episodeCount}\n源视频：\n${files}\n已确认资产：${JSON.stringify(data.assets)}\n已有方案（如有，请只修改用户点名的视频和分段，其余保持不变）：${JSON.stringify(data.existingEpisodes)}\n\n请为每一个源视频生成或修改分段视频提示词。只输出 JSON，不要 Markdown：{"episodes":[{"episode":"源视频 ID（必须原样使用上方的视频 ID）","segments":[{"id":"U01","prompt":"..."}]}]}。每段不超过15秒，提示词须包含人物、场景、动作、镜头、光影、节奏和对白/声音要求；不得虚构资产表中不存在的具体人物或地点。`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180_000);
      try {
        const response = await fetch(isArk ? arkTextEndpoint() : QWEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            ...(isArk ? { thinking: ARK_TEXT_THINKING_DISABLED } : {}),
            temperature: 0.2,
            max_tokens: 12_000,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "你是短剧转绘方案编剧。必须返回可解析的 JSON 对象，不要 Markdown，不要在字符串中使用未转义的双引号或换行。",
              },
              { role: "user", content: prompt },
            ],
          }),
        });
        if (!response.ok)
          return {
            ok: false,
            error: `方案生成请求失败（${response.status}）：${(await response.text()).slice(0, 240)}`,
          };
        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: unknown } }>;
        };
        const content = payload.choices?.[0]?.message?.content;
        if (typeof content !== "string") return { ok: false, error: "模型未返回转绘方案。" };
        const parsed = parseJson(content) as { episodes?: unknown };
        const parsedEpisodes = z.array(PlanEpisodeSchema).parse(parsed.episodes ?? []);
        const byVideoId = new Map(parsedEpisodes.map((episode) => [episode.episode, episode]));
        const episodes = data.sourceFiles.map((file) => {
          const videoId = file.id || file.name;
          return (
            byVideoId.get(videoId) ?? {
              episode: videoId,
              segments: [
                {
                  id: "U01",
                  prompt: "保持原视频剧情、动作、站位与音频节奏，结合已确认资产完成转绘。",
                },
              ],
            }
          );
        });
        return { ok: true, episodes, model };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error && error.name === "AbortError"
              ? "方案生成超时，请稍后重试。"
              : `方案生成失败：${error instanceof Error ? error.message : "未知错误"}`,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  );
