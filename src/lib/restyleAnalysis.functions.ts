import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "../integrations/supabase/auth-middleware";
import { providerTuning, resolveProvider, INTERNAL_VISION_MODEL } from "./restyle/lovableGateway";
import { runAssetAnalysis } from "./restyle/analyzeAssetsCore";
import { LIGHTING_LUTS, type DirectionShot, type Market } from "./restyle/cameraDirection";
import { parseShotSchedule } from "./restyle/shotSchedule";
import { estimateSourceDurationMs, resolveSegmentTimeRange } from "./restyle/segmentReference";

const AssetSchema = z.object({
  kind: z.enum(["character", "scene", "prop"]),
  sourceName: z.string().min(1).max(80),
  sourceDescription: z.string().min(1).max(500),
  targetName: z.string().min(1).max(80),
  targetDescription: z.string().min(1).max(500),
  importance: z.enum(["required", "optional"]),
  shouldRestyle: z.boolean(),
});

const RelationshipSchema = z.object({
  from: z.string().min(1).max(80),
  to: z.string().min(1).max(80),
  relation: z.string().min(1).max(120),
  note: z.string().max(240).optional(),
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
    "lovable:openai/gpt-5.5",
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
  /** ASR 通道产出的整集台词（带时间码）。为空表示无音轨或识别降级。 */
  transcript: z.string().max(20_000).default(""),
  existingAssets: z.array(AssetSchema).max(60).default([]),
});

export type RestyleAnalysisAsset = z.infer<typeof AssetSchema>;
export type RestyleAnalysisRelationship = z.infer<typeof RelationshipSchema>;
export type RestyleAnalysisResult =
  | {
      ok: true;
      summary: string;
      assets: RestyleAnalysisAsset[];
      relationships: RestyleAnalysisRelationship[];
      analysis: z.infer<typeof AnalysisSectionsSchema>;
      /** 轻量逐镜表（导演镜头调度机制第二阶段）；模型未产出时缺省。 */
      shots?: DirectionShot[];
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
  return `你是面向短剧出海转绘的资产制片人。根据用户要求、上传源片信息${hasFrames ? "以及抽取的关键帧" : ""}，输出供用户确认的资产表。\n\n${isRevision ? "当前已存在资产表。用户这次是在自然语言中反馈修改；只修改受影响的资产、补上明确遗漏项、删除明确要求删除的项，其余保持一致。" : "这是首次分析。只提取剧情理解、光影、节奏和台词语境中真正影响转绘一致性的资产。"}\n\n重要规则：\n1. 角色、场景、道具都不是必选项；某一类不存在时，该类必须输出空，不得为了凑数添加。全部不存在时 assets 必须是空数组。\n2. 角色必须是画面中有明确剧情作用的某一个具体人物，一人一条；不要输出“居民”“市民”“人群”“表演者”“观众”“工作人员”“人物群体”等群体。\n3. 场景必须是一个具体、可定位的地点或空间，例如“街角面馆”“某栋居民楼的客厅”“嵊州古城城门”；不要输出“城市风光”“古城全景”“街景”“环境”“建筑群”等泛称。\n4. 道具必须是一个具体、可单独识别的物件，例如“一盏红灯笼”“一块写有店名的木招牌”“一口铁锅”；不要输出“招牌与灯笼”“器具与食物”等多个对象、类别或概念。\n5. 如果只能确认群体、远景、类别或模糊物件，就不要提取；宁可少提取或返回空数组，也不能猜测。\n6. 根据用户的目标市场、人种、地域、语言、风格要求，为每条具体资产填入目标名称与目标说明；未要求改名时可保留原名。\n7. ${hasFrames ? "关键帧是视觉依据。" : "没有可读取的关键帧时不得虚构视频中具体发生的情节；名称或描述不确定时直接省略该资产。"}\n8. sourceDescription 写该具体人物/地点/物件在原片中的定位；targetDescription 写目标市场版的对应设定。\n9. importance 只有 required 或 optional；shouldRestyle 表示这条是否需要独立转绘。最多 30 条，去重，不输出解释、Markdown 或代码块。\n10. relationships 写人物之间的剧情关系，from/to 必须使用资产表中角色的 sourceName 原文。仅在画面或台词可以确认时输出；角色少于 2 人、或无法确认时返回空数组，禁止虚构、禁止凑数。存在 A→B 时必须同时给出 B→A 的反向边（relation 从对方视角改写）；不得输出指向群体或不存在角色的关系。\n11. shots 是从关键帧与台词产出的轻量逐镜表，供导演镜头调度使用：按原片时间顺序逐镜一条，shotNo 用 SC001 起递增编号；startMs/endMs 为该镜在原片中的起止毫秒（必须 startMs < endMs，按 startMs 升序）；scene 是物理空间命名，同一场景跨镜头必须保持一致；shotType 只能取「特写|大特写|近景|中景|全景|远景」；emotion 只能取「愤怒|暧昧|紧张|舒缓|震惊|悲伤」，无法识别时用「中性」；action/dialogue 为该镜动作与台词摘要（无则省略）。关键帧与台词都不足以判断镜头时 shots 返回空数组，禁止虚构。\n\n只输出以下 JSON：\n{"summary":"不超过120字的确认提示","assets":[{"kind":"character|scene|prop","sourceName":"","sourceDescription":"","targetName":"","targetDescription":"","importance":"required|optional","shouldRestyle":true}],"relationships":[{"from":"角色A sourceName","to":"角色B sourceName","relation":"A 对 B 的关系","note":"可选，剧情依据"}],"shots":[{"shotNo":"SC001","startMs":0,"endMs":3000,"scene":"场景名","shotType":"特写|大特写|近景|中景|全景|远景","emotion":"愤怒|暧昧|紧张|舒缓|震惊|悲伤","action":"可选","dialogue":"可选"}]}`;
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
  const transcript = data.transcript.trim()
    ? `\n\n[SOURCE DIALOGUE (ASR, 带时间码，来自原片音轨)]\n${data.transcript.trim().slice(0, 12_000)}\n台词是可信证据：角色身份、关系、场景与剧情理解优先依据台词，不得与台词冲突。`
    : "\n\n[SOURCE DIALOGUE]\n原片没有可用音轨或识别失败，不得虚构台词。";
  return `[USER INSTRUCTION]\n${data.instruction}\n\n[SOURCE VIDEO FILES]\n${files}${transcript}${previous}\n\n[ANALYSIS SECTIONS]\nAlso return an analysis object with four concise strings: plot, videoUnderstanding, dialogue, and assets. dialogue 必须基于上面的 ASR 台词做摘要（引用关键台词），没有台词时写明未识别到台词。Keep the asset table unchanged; do not invent dialogue when it cannot be confirmed.`;
}

// 导出供单测直接覆盖 shots 契约解析（合法/非法枚举、排序、缺省）。
export function normalizeResult(
  content: string,
  model: string,
  usedFrames: boolean,
  transcript = "",
): RestyleAnalysisResult {
  try {
    const parsed = parseJson(content) as {
      summary?: unknown;
      assets?: unknown;
      relationships?: unknown;
      analysis?: unknown;
      shots?: unknown;
    };
    const assets = z
      .array(AssetSchema)
      .max(30)
      .parse(parsed.assets ?? [])
      .filter((asset) => isConcreteAsset(asset));
    // 关系只允许引用资产表里的角色（按 sourceName 对齐），自指与重复边在这里就丢弃，
    // 从源头遵守「禁止虚构、少于 2 人返回空」的口径。
    const characterNames = new Set(
      assets.filter((asset) => asset.kind === "character").map((asset) => asset.sourceName),
    );
    const seenPairs = new Set<string>();
    const relationships = z
      .array(RelationshipSchema)
      .max(60)
      .parse(parsed.relationships ?? [])
      .filter((relation) => {
        if (!characterNames.has(relation.from) || !characterNames.has(relation.to)) return false;
        if (relation.from === relation.to) return false;
        const pairKey = `${relation.from}→${relation.to}`;
        if (seenPairs.has(pairKey)) return false;
        seenPairs.add(pairKey);
        return true;
      });
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
        dialogue: transcript
          ? transcript.slice(0, 4_000)
          : "未返回可确认的台词文本，请在原片分析中补充或校对。",
        assets: assets.length
          ? assets.map((asset) => asset.sourceName).join("、")
          : "未识别到需要单独转绘的资产。",
      },
    );
    // 模型没写 dialogue（或只回了占位）时，直接落 ASR 原文，保证台词不丢。
    if (transcript && (!analysis.dialogue.trim() || /未返回|无法确认|未识别/.test(analysis.dialogue))) {
      analysis.dialogue = transcript.slice(0, 4_000);
    }
    // 逐镜表契约清洗：非法枚举/时间区间整条丢弃，按 startMs 排序；无有效镜头则缺省。
    const shots = parseShotSchedule(parsed.shots);
    return { ok: true, summary, assets, relationships, analysis, shots, model, usedFrames };
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
/**
 * 转绘第一阶段（v1）：画面分析统一走内部 Gemini skill（video-analysis-extract），
 * 不再使用用户下拉的导演模型；导演模型只用于方案生成与资产审核。
 * 用户选择的 data.model 仍透传用于播报与结果记录。
 */
export const analyzeRestyleAssets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }): Promise<RestyleAnalysisResult> => {
    // 积分：视觉分析 2 分/次（含多关键帧），纯文本 1 分/次
    const __cost = data.frameImages.length > 0 ? 2 : 1;
    const { ensureEnoughCredits } = await import("./creditsGuard");
    const __guard = await ensureEnoughCredits(__cost, { kind: "image", model: INTERNAL_VISION_MODEL });
    if (!__guard.ok) {
      return { ok: false, error: __guard.error };
    }
    const result = await runAssetAnalysis(data, { userText, systemPrompt, normalizeResult });
    // 成功才扣费；扣费失败不阻断主流程（分析结果已产出，不收回）。
    if (result.ok) {
      const { supabase, userId } = context as { supabase: any; userId: string };
      const { chargeCredits } = await import("./userCredits.functions");
      await chargeCredits(supabase, userId, {
        amount: __cost,
        model: INTERNAL_VISION_MODEL,
        description: "转绘资产分析",
      });
    }
    return result;
  });

const PlanEpisodeSchema = z.object({
  // Kept as `episode` for backward-compatible persisted projects. Its value is now the source video ID.
  episode: z.string().min(1).max(200),
  segments: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        prompt: z.string().min(1).max(8_000),
        // 该段在原片中的时间区间（毫秒），用于裁剪 ≤30s 参考片段；旧项目缺字段兼容。
        startMs: z.number().nonnegative().optional(),
        endMs: z.number().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(30),
});

export type RestylePlanEpisode = z.infer<typeof PlanEpisodeSchema>;

const PlanShotSchema = z.object({
  shotNo: z.string().min(1).max(40),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  scene: z.string().max(120),
  shotType: z.enum(["特写", "大特写", "近景", "中景", "全景", "远景"]),
  emotion: z.string().max(40),
  action: z.string().max(240).optional(),
  dialogue: z.string().max(240).optional(),
});

const PlanInputSchema = z.object({
  model: InputSchema.shape.model,
  instruction: z.string().max(4_000).default(""),
  sourceFiles: InputSchema.shape.sourceFiles,
  assets: z.array(AssetSchema).max(60),
  episodeCount: z.number().int().min(1).max(100),
  existingEpisodes: z.array(PlanEpisodeSchema).default([]),
  /** 分析层产出的轻量逐镜表，供方案对齐镜头情绪与景别。 */
  shotSchedule: z.array(PlanShotSchema).max(200).default([]),
  /** 目标市场：决定光照预设与俚语本土化口径。 */
  targetMarket: z.enum(["kr", "us", "in", "nordic", "hk", "jp"]).default("kr"),
});

export const generateRestylePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => PlanInputSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<
      { ok: true; episodes: RestylePlanEpisode[]; model: string } | { ok: false; error: string }
    > => {
      const config = resolveProvider(data.model);
      const model = config.model;
      if (!config.apiKey) return { ok: false, error: config.missingKeyError };
      const { ensureEnoughCredits } = await import("./creditsGuard");
      const __guard = await ensureEnoughCredits(1, { kind: "image", model });
      if (!__guard.ok) {
        return { ok: false, error: __guard.error };
      }
      const files = data.sourceFiles
        .map((file) => `- 视频 ID: ${file.id || file.name}; 文件名: ${file.name}`)
        .join("\n");
      // 导演镜头调度：目标市场 LUT + 俚语本土化（禁直译），逐镜表摘要供分段对齐情绪与景别。
      const market = data.targetMarket as Market;
      const marketRequirement = `目标市场：${market}。光线必须体现该市场 LUT：${LIGHTING_LUTS[market].join("、")}；对白与字幕必须做目标市场俚语本土化转译，禁止直译。`;
      const shotBrief = data.shotSchedule.length
        ? `\n原片逐镜调度表（分段提示词的镜头、情绪与景别须与之对齐）：\n${data.shotSchedule
            .slice(0, 60)
            .map(
              (shot) =>
                `${shot.shotNo} ${shot.startMs}-${shot.endMs}ms ${shot.scene} ${shot.shotType} ${shot.emotion}${shot.action ? ` ${shot.action}` : ""}`,
            )
            .join("\n")}`
        : "";
      const prompt = `用户要求：${data.instruction || "生成转绘方案"}\n视频数量：${data.episodeCount}\n源视频：\n${files}\n已确认资产：${JSON.stringify(data.assets)}\n已有方案（如有，请只修改用户点名的视频和分段，其余保持不变）：${JSON.stringify(data.existingEpisodes)}\n${marketRequirement}${shotBrief}\n\n请为每一个源视频生成或修改分段视频提示词。只输出 JSON，不要 Markdown：{"episodes":[{"episode":"源视频 ID（必须原样使用上方的视频 ID）","segments":[{"id":"U01","prompt":"...","startMs":0,"endMs":12000}]}]}。每段不超过15秒，提示词须包含人物、场景、动作、镜头、光影、节奏和对白/声音要求；不得虚构资产表中不存在的具体人物或地点。每段必须给出 startMs/endMs：该段在原片中的起止毫秒，须与上方逐镜调度表的镜头区间对齐（覆盖该段对应的连续镜头），单段区间不得超过 30000 毫秒。`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90_000); // 平台约 100s 无字节断连，超时改由服务端返回可读错误
      try {
        const response = await fetch(config.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            ...providerTuning(config, 12_000),
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
        // 分段时间区间兜底：模型没给或区间非法时，按逐镜表就近推算，
        // 再不行按分段数均分原片时长；统一夹取到素材库允许的 1.8–30 秒。
        const sourceDurationMs = estimateSourceDurationMs(data.shotSchedule);
        const episodesWithRanges = episodes.map((episode) => ({
          ...episode,
          segments: episode.segments.map((segment) => {
            const range = resolveSegmentTimeRange({
              segmentId: segment.id,
              explicit: { startMs: segment.startMs, endMs: segment.endMs },
              shots: data.shotSchedule,
              segmentCount: episode.segments.length,
              sourceDurationMs,
            });
            return range ? { ...segment, startMs: range.startMs, endMs: range.endMs } : segment;
          }),
        }));
        // 成功才扣费（1 分/次，与预校验口径一致）；扣费失败不阻断主流程。
        {
          const { supabase, userId } = context as { supabase: any; userId: string };
          const { chargeCredits } = await import("./userCredits.functions");
          await chargeCredits(supabase, userId, {
            amount: 1,
            model,
            description: "转绘方案生成",
          });
        }
        return { ok: true, episodes: episodesWithRanges, model };
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
