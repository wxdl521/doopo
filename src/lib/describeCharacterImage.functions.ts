// ====================================================================
//  describeCharacterImage —— 用 Qwen-VL 给一张角色图重新写文字描述
//
//  动机:
//    角色卡的"修改"按钮(modify)只生成新图,不更新 data.characters 的
//    faceDescription / bodyDescription / clothingDescription 字段。
//    后续点"三视图"/"多维资产"时,referenceImageUrl 是修改后的最新图(图层
//    一致),但传给 I2I 的文字描述仍是原始的(文字与图脱节)。
//
//    这个 server fn 接收一张新图 + 角色基本信息(名/年龄/角色名),让
//    Qwen-VL 重新观察图、输出 3 段中文描述,JSON 返回。客户端 submitModPanel
//    成功后调一次,把结果写回 data.characters 对应角色(或对应 look)。
//
//  API:
//    DashScope OpenAI 兼容多模态接口,跟其他 Qwen 调用共用 process.env.Qwen。
//    模型默认 qwen-vl-plus(便宜快),失败 fallback qwen-vl-max。
// ====================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  imageUrl: z.string().url(),
  characterName: z.string().min(1).max(100),
  characterRoleLabel: z.string().min(1).max(200),
  characterAge: z.number().int().min(0).max(200),
  lookLabel: z.string().min(1).max(100).default("默认"),
  model: z.string().max(100).optional(),
});

export type DescribeCharacterImageInput = z.infer<typeof Input>;

export type DescribeCharacterImageResult =
  | {
      ok: true;
      faceDescription: string;
      bodyDescription: string;
      clothingDescription: string;
      model: string;
    }
  | { ok: false; error: string };

export const describeCharacterImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<DescribeCharacterImageResult> => {
    const apiKey = process.env.Qwen || process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "Qwen API key 未配置(请设置 Qwen 或 DASHSCOPE_API_KEY)" };
    }

    const DASHSCOPE_CHAT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

    const systemPrompt = `你是一位专业的角色形象描述师。给定一张角色立绘图片和角色基本信息,你需要观察图片,用中文准确描述这个角色的 3 个方面:
1) faceDescription:面部特征(脸型、五官、肤色、发型/发色、眉眼细节、表情默认状态等),≤ 300 字
2) bodyDescription:身材特征(身高比例、体型、姿态、手脚特征等),≤ 200 字
3) clothingDescription:服装与配饰(上衣/下装/外套/鞋履、纹样、配色、配饰首饰、风格定位等),≤ 400 字

要求:
- **严格基于图片可见内容**描述,不能编造图里没有的东西
- 不写"看起来像"、"似乎"这种模糊措辞,直接陈述事实
- 不写镜头/构图/光照/背景(那些不属于角色本身)
- 不写主观评价(漂亮/帅气等),只写客观特征
- 不要 markdown,纯文本
- 只输出 JSON,不要任何解释或代码块标记`;

    const userText = `请观察下面这张图片,为角色"${data.characterName}"(${data.characterAge}岁,${data.characterRoleLabel})的"${data.lookLabel}"形象输出 JSON 描述。

输出格式:
{
  "faceDescription": "...",
  "bodyDescription": "...",
  "clothingDescription": "..."
}`;

    const MODEL_TIMEOUTS: Record<string, number> = {
      "qwen-vl-plus": 60_000,
      "qwen-vl-max": 90_000,
    };
    const modelAttempts = [data.model || "qwen-vl-plus", "qwen-vl-plus", "qwen-vl-max"].filter(
      Boolean,
    );
    const RETRYABLE = new Set([403, 404, 429, 500, 502, 503]);

    let lastError = "";
    for (const model of modelAttempts) {
      const timeoutMs = MODEL_TIMEOUTS[model] ?? 90_000;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(DASHSCOPE_CHAT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: [
                  { type: "image_url", image_url: { url: data.imageUrl } },
                  { type: "text", text: userText },
                ],
              },
            ],
            // qwen-vl 系列也支持 response_format JSON
            response_format: { type: "json_object" },
            temperature: 0.2,
            max_tokens: 1200,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          lastError = `[${model}] ${res.status}: ${text.slice(0, 200)}`;
          if (RETRYABLE.has(res.status)) continue;
          return { ok: false, error: lastError };
        }
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const raw = json?.choices?.[0]?.message?.content ?? "";
        const jsonText = extractJsonBlock(raw);
        if (!jsonText) {
          lastError = `[${model}] 空输出 (raw: ${raw.slice(0, 200)})`;
          continue;
        }
        try {
          const parsed = JSON.parse(jsonText) as {
            faceDescription?: string;
            bodyDescription?: string;
            clothingDescription?: string;
          };
          const face = (typeof parsed.faceDescription === "string" ? parsed.faceDescription : "")
            .trim()
            .slice(0, 1500);
          const body = (typeof parsed.bodyDescription === "string" ? parsed.bodyDescription : "")
            .trim()
            .slice(0, 1000);
          const cloth = (
            typeof parsed.clothingDescription === "string" ? parsed.clothingDescription : ""
          )
            .trim()
            .slice(0, 2000);
          if (!face && !body && !cloth) {
            lastError = `[${model}] 三段描述都为空 (raw: ${jsonText.slice(0, 200)})`;
            continue;
          }
          return {
            ok: true,
            faceDescription: face,
            bodyDescription: body,
            clothingDescription: cloth,
            model,
          };
        } catch (e) {
          lastError = `[${model}] JSON 解析失败: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
          continue;
        }
      } catch (e) {
        clearTimeout(timeout);
        lastError =
          e instanceof Error && e.name === "AbortError"
            ? `[${model}] 视觉模型超时(>${Math.round(timeoutMs / 1000)}s)`
            : `[${model}] ${e instanceof Error ? e.message : "网络错误"}`;
      }
    }
    return { ok: false, error: lastError || "视觉描述失败" };
  });

/** 容忍 ```json ... ``` 包裹 */
function extractJsonBlock(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) return trimmed.slice(first, last + 1);
  return "";
}
