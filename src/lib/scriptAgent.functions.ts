import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { wrapFictionSystem, wrapFictionUser } from "./promptSafety";
import {
  ARK_TEXT_MODEL,
  ARK_TEXT_THINKING_DISABLED,
  arkTextApiKey,
  arkTextEndpoint,
  qwenApiKey,
} from "./arkText";

// ============================================================
// 剧本智能体 — 流式生成（Qwen API，async generator）
// 5 步：① 灵感 → ② 故事梗概 → ③ 第1集分镜 → ④ 多剧集（逐集生成） → ⑤ 完成
// 所有 prompt 要求输出"文章/小说式纯文本"，禁止 markdown 标题、表格、列表符号。
// 每个 step 服务器以 async function* 形式 yield { delta }，
// 流结束后再 yield { done: true, text }。客户端逐字追加渲染。
// ============================================================

const Lang = z.enum(["zh", "en"]);

// const LOVABLE_ENDPOINT = 'https://ai.gateway.lovable.dev/v1/chat/completions'
// const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
// const MINIMAX_ENDPOINT = 'https://api.minimaxi.com/anthropic/v1/messages'
const QWEN_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const LOVABLE_ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

type Provider = "lovable" | "qwen" | "openrouter" | "ark";

// 解析模型 id 并归一化为目标 provider：
//   "lovable:xxx"     → Lovable AI Gateway，model = xxx（前端已传完整路径）
//   "gemini:xxx"      → Lovable AI Gateway，自动补 "google/" 前缀
//   "gpt:xxx" / "openai:xxx" → Lovable AI Gateway，自动补 "openai/" 前缀
//   "openrouter:xxx"  → Lovable AI Gateway（向后兼容）
//   "qwen:xxx"        → 阿里 DashScope
//   裸 id             → Qwen 默认
export function pickModel(raw?: string): { provider: Provider; model: string } {
  // 2026/07:默认走 Qwen(流式梗概/分集/导入等大输出任务,DeepSeek V4 Pro ~50tok/s 太慢);
  // ark: / deepseek: 前缀可显式走 DeepSeek V4 Pro。分镜切分单独走 DeepSeek(storyboard.functions.ts)。
  const v = (raw ?? "").trim() || "qwen-plus";
  if (v.startsWith("lovable:")) return { provider: "lovable", model: v.slice(8) };
  if (v.startsWith("openrouter:")) return { provider: "openrouter", model: v.slice(11) };
  if (v.startsWith("gemini:")) {
    const m = v.slice(7);
    return { provider: "lovable", model: m.includes("/") ? m : `google/${m}` };
  }
  if (v.startsWith("gpt:") || v.startsWith("openai:")) {
    const m = v.slice(v.indexOf(":") + 1);
    return { provider: "lovable", model: m.includes("/") ? m : `openai/${m}` };
  }
  if (v.startsWith("anthropic:") || v.startsWith("claude:")) {
    const m = v.slice(v.indexOf(":") + 1);
    return { provider: "openrouter", model: m.includes("/") ? m : `anthropic/${m}` };
  }
  if (v.startsWith("ark:")) return { provider: "ark", model: v.slice(4) || ARK_TEXT_MODEL };
  if (v.startsWith("deepseek:")) {
    // 历史前缀:以前 deepseek: 走 openrouter。2026/07 起改走 ARK(DeepSeek V4 Pro)。
    const m = v.slice(9);
    return { provider: "ark", model: m || ARK_TEXT_MODEL };
  }
  if (v.startsWith("meta:") || v.startsWith("llama:")) {
    const m = v.slice(v.indexOf(":") + 1);
    return { provider: "openrouter", model: m.includes("/") ? m : `meta-llama/${m}` };
  }
  if (v.startsWith("mistral:")) {
    const m = v.slice(8);
    return { provider: "openrouter", model: m.includes("/") ? m : `mistralai/${m}` };
  }
  if (v.startsWith("xai:") || v.startsWith("grok:")) {
    const m = v.slice(v.indexOf(":") + 1);
    return { provider: "openrouter", model: m.includes("/") ? m : `x-ai/${m}` };
  }
  if (v.startsWith("qwen:")) return { provider: "qwen", model: v.slice(5) };
  return { provider: "qwen", model: v };
}

type StreamChunk = { delta: string } | { done: true; text: string } | { error: string };

async function* streamChat(opts: {
  model: { provider: Provider; model: string } | string;
  system: string;
  user: string;
}): AsyncGenerator<StreamChunk> {
  const picked = typeof opts.model === "string" ? pickModel(opts.model) : opts.model;
  // const apiKey =
  //   picked.provider === 'gemini'
  //     ? process.env.Default_Gemini_API_Key
  //     : picked.provider === 'minimax'
  //       ? process.env.MINIMAX_API_KEY
  //       : picked.provider === 'qwen'
  //         ? qwenApiKey()
  //         : process.env.LOVABLE_API_KEY
  const apiKey =
    picked.provider === "lovable"
      ? process.env.LOVABLE_API_KEY
      : picked.provider === "openrouter"
        ? process.env.OPENROUTER_API_KEY
        : picked.provider === "ark"
          ? arkTextApiKey()
          : qwenApiKey();
  if (!apiKey) {
    // 2026/07:ark(DeepSeek)为主但 key 缺失时,降级到 Qwen 而非直接报错
    if (picked.provider === "ark" && qwenApiKey()) {
      yield* streamChat({ ...opts, model: { provider: "qwen", model: "qwen-plus" } });
      return;
    }
    yield {
      error:
        picked.provider === "lovable"
          ? "LOVABLE_API_KEY 未配置"
          : picked.provider === "openrouter"
            ? "OPENROUTER_API_KEY 未配置"
            : picked.provider === "ark"
              ? "ARK_API_KEY 未配置"
              : "Qwen 密钥未配置",
    };
    return;
  }

  const controller = new AbortController();
  let upstream: Response;

  // // MiniMax 使用不同的 API 格式（非 SSE）
  // if (picked.provider === 'minimax') {
  //   try {
  //     upstream = await fetch(MINIMAX_ENDPOINT, {
  //       method: 'POST',
  //       headers: {
  //         'X-Api-Key': apiKey,
  //         'Content-Type': 'application/json',
  //       },
  //       body: JSON.stringify({
  //         model: picked.model,
  //         messages: [
  //           { role: 'system', content: opts.system },
  //           { role: 'user', content: opts.user },
  //         ],
  //         max_tokens: 4096,
  //       }),
  //       signal: controller.signal,
  //     })
  //   } catch (e) {
  //     yield { error: e instanceof Error ? e.message : '网络错误' }
  //     return
  //   }

  //   if (!upstream.ok) {
  //     const txt = await upstream.text().catch(() => '')
  //     yield { error: `MiniMax 错误 ${upstream.status}: ${txt.slice(0, 200)}` }
  //     return
  //   }

  //   try {
  //     const json = await upstream.json()
  //     // MiniMax 返回格式：content[].type === "text" 或 "thinking"
  //     const textParts: string[] = []
  //     for (const block of json.content ?? []) {
  //       if (block.type === 'text') {
  //         textParts.push(block.text)
  //       }
  //     }
  //     const fullText = textParts.join('')
  //     if (fullText) yield { delta: fullText }
  //     yield { done: true, text: fullText }
  //   } catch (e) {
  //     yield { error: 'MiniMax 响应解析失败' }
  //   }
  //   return
  // }

  // Qwen: OpenAI 兼容 SSE 流式响应
  // const endpoint =
  //   picked.provider === 'gemini'
  //     ? GEMINI_ENDPOINT
  //     : picked.provider === 'qwen'
  //       ? QWEN_ENDPOINT
  //       : LOVABLE_ENDPOINT
  const endpoint =
    picked.provider === "lovable"
      ? LOVABLE_ENDPOINT
      : picked.provider === "openrouter"
        ? OPENROUTER_ENDPOINT
        : picked.provider === "ark"
          ? arkTextEndpoint()
          : QWEN_ENDPOINT;
  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(picked.provider === "openrouter"
          ? { "HTTP-Referer": "https://doopoo.app", "X-Title": "Doopoo" }
          : {}),
      },
      body: JSON.stringify({
        model: picked.model,
        stream: true,
        // ark(DeepSeek V4 Pro):关闭深度思考,走通用对话快模式
        ...(picked.provider === "ark" ? { thinking: ARK_TEXT_THINKING_DISABLED } : {}),
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    // ark 请求抛错(网络等)且未开始流 -> 回退 Qwen
    if (picked.provider === "ark" && qwenApiKey()) {
      yield* streamChat({ ...opts, model: { provider: "qwen", model: "qwen-plus" } });
      return;
    }
    yield { error: e instanceof Error ? e.message : "网络错误" };
    return;
  }

  if (!upstream.ok) {
    const txt = await upstream.text().catch(() => "");
    // 403 ToS / 内容审核：跨服务商回退到 Lovable Gateway Gemini（对创作更宽松）
    if (
      upstream.status === 403 &&
      /terms of service|prohibited|policy|moderation/i.test(txt) &&
      picked.provider !== "lovable" &&
      process.env.LOVABLE_API_KEY
    ) {
      yield* streamChat({
        ...opts,
        model: { provider: "lovable", model: "google/gemini-3-flash-preview" },
      });
      return;
    }
    // 2026/07:ark(DeepSeek)为主,其余失败(限流/欠费/5xx/403 非审核等)回退 Qwen
    if (picked.provider === "ark" && qwenApiKey()) {
      yield* streamChat({ ...opts, model: { provider: "qwen", model: "qwen-plus" } });
      return;
    }
    if (upstream.status === 429) {
      yield { error: "rate_limit" };
      return;
    }
    if (upstream.status === 402) {
      yield { error: "no_credits" };
      return;
    }
    if (upstream.status === 403) {
      yield { error: "content_policy" };
      return;
    }
    yield { error: `网关错误 ${upstream.status}: ${txt.slice(0, 200)}` };
    return;
  }

  if (!upstream.body) {
    yield { error: "上游无响应体" };
    return;
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE：以双换行分隔事件
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta: string | undefined =
            json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.message?.content;
          if (delta) {
            fullText += delta;
            yield { delta };
          }
        } catch {
          // 忽略解析失败的心跳/注释
        }
      }
    }
  } catch (e) {
    yield { error: e instanceof Error ? e.message : "流读取失败" };
    return;
  } finally {
    try {
      controller.abort();
    } catch {
      /* noop */
    }
  }

  yield { done: true, text: fullText };
}

// ============= 1) 故事梗概 / 一句话剧情 =============

const SynopsisInput = z.object({
  lang: Lang,
  type: z.string(),
  genre: z.string(),
  tone: z.string(),
  theme: z.string().min(1).max(200),
  plot: z.string().min(1).max(2000),
  expectedEpisodes: z.number().min(1).max(200).default(100),
  totalMinutes: z.number().min(5).max(600).default(90),
  model: z.string().optional(),
});

const SYS_SYNOPSIS_ZH = `你是一位资深短剧爆款编剧。请基于用户给出的灵感，使用 Markdown 输出一份结构完整、信息不可缺失的"故事梗概 / 一句话剧情"。

【最重要的规则 —— 请务必遵守】
你必须先输出下方完整的梗概内容（从 # 📖 到 ## 6 全部小节），每个小节都要写满实质内容。确认问题只是全文末尾的一句附言，绝对不能用"确认"两个字代替整篇梗概！

严格要求（框架不可丢失）：
1) 必须使用 Markdown 标题与列表，按下面给出的"骨架"完整复刻每一个一级、二级标题和小节，不要省略任何一节；如需补充可在该标题下加段落或子列表；
2) 段落之间留空行；正文叙述要有画面感、节奏紧凑，每个标题下至少写满 1 段或 3 条要点；
3) 适度使用 emoji 作为一级标题点缀（如 📖 👥 🎬），但禁止生成 HTML 与表格代码块；
4) 对白与示例台词用中文引号"…"包裹。
5) **总时长限制**：全程控制在约 __TOTAL_MINUTES__ 分钟以内，合理分配每集时长，确保集数与总时长匹配。

请严格按下面的骨架输出（保留所有标题与小节顺序）：

# 📖 故事梗概 / 一句话剧情

## 1. 故事名称

《作品名》—— 一句话定位（题材 + 主角 + 核心爽点）

## 2. 故事核心

用 1~2 段写出核心冲突、情绪基调、目标受众、预计集数、爽点钩子。

## 3. 人物小传

- **主角：姓名（年龄）**
  - 表面身份：…
  - 真实身份：…
  - 性格底色：…
  - 经典台词："…"
- **核心反派：姓名（年龄）**
  - 表面身份：…
  - 真实身份：…
  - 性格特点：…
- **关键女配：姓名（年龄）**
  - 表面身份：…
  - 真实身份：…
  - 性格特点：…
- **关键男配：姓名**
  - 表面身份：…
  - 真实身份：…

## 4. 剧情梗概

- **起**：…
- **承**：…
- **转**：…
- **合**：…

## 5. 章节结构（按集数段）

__CHAPTER_RANGES__

## 6. 第 1 集钩子预告

用一段散文写出第 1 集结尾的"炸点 / 钩子"。

---

（全文输出完毕后，在最后一行附上：生成完成，你可以点击"生成下一集"继续。）`;

const SYS_SYNOPSIS_EN = `You are a seasoned short-drama writer. Output a full story brief in **Markdown**, strictly following this skeleton (do NOT drop any section):


**CRITICAL RULE — READ FIRST:**
You MUST output the complete story synopsis first (all sections from # 📖 through ## 6), with substantial content in every section. Only after you have finished the full synopsis, append a single line at the very end: "Generation complete. You can click 'Generate Next Episode' to continue." Never reply with just a number or "confirm" — the full synopsis must come first.
# 📖 Story Synopsis

## 1. Title
## 2. Core Concept
## 3. Characters (Protagonist / Antagonist / Female Lead / Male Supporting — each with surface identity, true identity, personality, signature line)
## 4. Plot Outline (Setup / Rising / Twist / Resolution)
## 5. Chapter Structure (per episode ranges: __CHAPTER_RANGES_EN__)
## 6. Episode 1 Cliffhanger

(After completing all sections above, append: "Generation complete. You can click 'Generate Next Episode' to continue.")`;

export const streamSynopsis = createServerFn({ method: "POST" })
  .validator((d: unknown) => SynopsisInput.parse(d))
  .handler(async function* ({ data }) {
    // Build chapter range buckets that fit the requested episode count,
    // instead of the previous hardcoded 100-episode template.
    const total = Math.max(1, Math.floor(data.expectedEpisodes));
    const buckets = total <= 15 ? 3 : total <= 30 ? 4 : total <= 60 ? 5 : 6;
    const size = Math.max(1, Math.ceil(total / buckets));
    const ranges: { start: number; end: number }[] = [];
    for (let i = 0; i < buckets; i++) {
      const start = i * size + 1;
      if (start > total) break;
      const end = i === buckets - 1 ? total : Math.min((i + 1) * size, total);
      ranges.push({ start, end });
    }
    const rangesZh = ranges.map((r) => `- **第 ${r.start}-${r.end} 集**：…`).join("\n");
    const rangesEn = ranges.map((r) => `Episodes ${r.start}-${r.end}`).join(", ");
    const rawSys = (data.lang === "zh" ? SYS_SYNOPSIS_ZH : SYS_SYNOPSIS_EN)
      .replace("__TOTAL_MINUTES__", String(data.totalMinutes))
      .replace("__CHAPTER_RANGES__", rangesZh)
      .replace("__CHAPTER_RANGES_EN__", rangesEn);
    const sys = wrapFictionSystem(data.lang, rawSys);
    // 题材/风格创作要点：把用户勾选的标签翻译成中文名，并附上该题材的写法要求，
    // 让模型真正按该题材的套路与节奏创作。
    const genreValues = data.genre
      .split(/[、,，\/]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const toneValues = data.tone
      .split(/[、,，\/]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const labelOf = (v: string) => scriptTagValueLabel(v, data.lang);
    const genreNames = genreValues.map(labelOf).join("、") || data.genre;
    const toneNames = toneValues.map(labelOf).join("、") || data.tone;
    const genreGuides = buildGuideBlock(genreValues, GENRE_GUIDES, labelOf, 4);
    const toneGuides = buildGuideBlock(toneValues, TONE_GUIDES, labelOf, 3);
    const guideBlock =
      genreGuides || toneGuides
        ? `\n【题材创作要点】\n${[genreGuides, toneGuides].filter(Boolean).join("\n")}`
        : "";
    const rawUser =
      data.lang === "zh"
        ? `【类型】${data.type}\n【题材】${genreNames}\n【风格】${toneNames}\n【主题/标题】${data.theme}\n【剧情概要】${data.plot}\n【预计集数】${data.expectedEpisodes} 集\n【总时长限制】约 ${data.totalMinutes} 分钟${guideBlock}`
        : `[Type] ${data.type}\n[Genre] ${genreNames}\n[Tone] ${toneNames}\n[Theme] ${data.theme}\n[Plot] ${data.plot}\n[Expected episodes] ${data.expectedEpisodes}\n[Total duration] ~${data.totalMinutes} min${guideBlock}`;
    const user = wrapFictionUser(data.lang, rawUser);
    yield* streamChat({ model: pickModel(data.model), system: sys, user });
  });

// ============= 2) 第 N 集分镜脚本 + 后续概要 =============

const EpisodeInput = z.object({
  lang: Lang,
  epIndex: z.number().min(1).max(200).default(1),
  sceneCount: z.number().min(3).max(40).default(16),
  synopsisText: z.string().min(20).max(20000),
  expectedEpisodes: z.number().min(1).max(200).optional(),
  model: z.string().optional(),
});

const SYS_EPISODE_ZH = `你是一位资深短剧分镜师，请基于已确认的故事梗概，写出第 N 集的完整分镜脚本。

严格要求：
1) 全文使用"文章式散文 + 剧本对白"，禁止使用任何 Markdown 符号（# / * / - / | 等），禁止使用表格、项目符号、emoji；
2) 开头用一段散文写出"第 N 集 ·《本集副标题》"以及本集情绪与目标（一段话）；
3) 然后依次写 X 个分镜，每个分镜独立成段，段首另起一行用"分镜 1 / 2 / 3 ..."加中文地点与时段（例如：分镜 1 ｜ 内景 · 林家祠堂 · 黄昏），紧接一段 80-160 字的动作/情绪/画面散文描写；
4) 对白单独成行，格式为：角色名（情绪）："台词"。每句对白不超过 30 字；
5) 节奏先抑后扬，至少一次重大反转，最后一个分镜留一个强钩子；
6) 全集结束后空一行，用一段散文写"后续走向预告"（不少于 100 字），自然提到 __NEXT_HINT_ZH__ 会发生的关键事件，不要用列表；
7) 文末另起一段，用一句确认引导（不加 Markdown，不加列表）：询问用户是否继续生成下一集，并欢迎对本集节奏/分镜数量/人设给出调整建议。`;

const SYS_EPISODE_EN = `You are a short-drama storyboarder. Write Episode N in prose paragraphs and screenplay dialogue lines only — no Markdown, no tables, no bullets, no emoji. Open with one paragraph for the episode's title and emotional goal, then X numbered storyboards, each one labeled on its own line ("Scene 1 | INT. ..."), followed by an 80-160-word prose description and dialogue lines formatted as "ROLE (emotion): \\"line\\"". End with a prose paragraph teasing __NEXT_HINT_EN__, then one prose sentence asking the user whether to continue and inviting adjustments.`;

export const streamEpisodeScenes = createServerFn({ method: "POST" })
  .validator((d: unknown) => EpisodeInput.parse(d))
  .handler(async function* ({ data }) {
    // Tailor the "next episodes to tease" hint to how many are actually left,
    // instead of always saying "3-5" even when the user is on/near the finale.
    const remaining =
      data.expectedEpisodes != null ? Math.max(0, data.expectedEpisodes - data.epIndex) : null;
    const nextHintZh =
      remaining === null
        ? "接下来 3-5 集"
        : remaining === 0
          ? '下一段（这是本季的收束，直接写"全集完"作结，不再预告后续）'
          : remaining === 1
            ? "接下来 1 集（大结局）"
            : remaining <= 3
              ? `接下来 ${remaining} 集`
              : "接下来 3-5 集";
    const nextHintEn =
      remaining === null
        ? "the next 3-5 episodes"
        : remaining === 0
          ? 'no further episodes (this is the season finale — end with "The End")'
          : remaining === 1
            ? "the final episode"
            : remaining <= 3
              ? `the final ${remaining} episodes`
              : "the next 3-5 episodes";
    const rawSys = (data.lang === "zh" ? SYS_EPISODE_ZH : SYS_EPISODE_EN)
      .replace(/第 N /g, `第 ${data.epIndex} `)
      .replace(/Episode N/g, `Episode ${data.epIndex}`)
      .replace(/X/g, String(data.sceneCount))
      .replace("__NEXT_HINT_ZH__", nextHintZh)
      .replace("__NEXT_HINT_EN__", nextHintEn);
    const sys = wrapFictionSystem(data.lang, rawSys);
    const rawUser =
      data.lang === "zh"
        ? `【目标集数】第 ${data.epIndex} 集\n【分镜数量】${data.sceneCount} 个\n【故事梗概参考】\n${data.synopsisText.slice(0, 8000)}`
        : `[Episode] ${data.epIndex}\n[Storyboards] ${data.sceneCount}\n[Synopsis]\n${data.synopsisText.slice(0, 8000)}`;
    const user = wrapFictionUser(data.lang, rawUser);
    yield* streamChat({ model: pickModel(data.model), system: sys, user });
  });

// 注：角色信息已并入故事梗概的"人物小传"段，不再单独成步。

// ============= 3) 修改指定集数（在现有剧本基础上修改）============

const RefineEpisodeInput = z.object({
  lang: Lang,
  epIndex: z.number().min(1).max(200).default(1),
  currentText: z.string().min(20).max(50000),
  instruction: z.string().min(1),
  synopsisText: z.string().max(20000).optional().default(""),
  previousEpisodesText: z.string().max(50000).optional().default(""),
  model: z.string().optional(),
});

const SYS_REFINE_EPISODE_ZH = `你是一位资深短剧分镜师，正在协助用户修改指定集数的剧本。

你将收到：故事梗概、前面若干集的剧本（如有）、当前集剧本、以及用户的修改要求。
修改时必须确保本集与故事梗概的人设/剧情一致，并与前序集数在剧情、人物状态、悬念钩子方面保持连贯。

严格规则：
1) 必须输出**完整的修改后剧本全文**，不能只输出 diff 或补丁；
2) 严格保留原文的分镜格式：分镜序号 + 地点时段，对白格式为"角色（情绪）：台词"，禁止使用 Markdown 符号；
3) 只针对"用户修改要求"做改动，其余内容尽量保留原文措辞；
4) 不写任何解释、前言，直接输出修改后的剧本正文。`;

const SYS_REFINE_EPISODE_EN = `You are a senior short-drama storyboarder helping the user revise a specific episode script.

You will receive: the story synopsis, previous episodes' scripts (if any), the current episode script, and the user's revision instruction.
Ensure the revised episode is consistent with the synopsis (characters/plot) and maintains continuity with previous episodes (plot progression, character states, cliffhangers).

Rules:
1) Output the FULL revised episode — never a diff or patch;
2) Preserve the original format: scene numbers + location/time, dialogue as "ROLE (emotion): line", no Markdown;
3) Make only changes implied by the user's instruction; keep other parts intact;
4) No preamble, start directly with the revised content.`;

export const refineEpisodeScenes = createServerFn({ method: "POST" })
  .validator((d: unknown) => RefineEpisodeInput.parse(d))
  .handler(async function* ({ data }) {
    const sys = (data.lang === "zh" ? SYS_REFINE_EPISODE_ZH : SYS_REFINE_EPISODE_EN)
      .replace(/第 N /g, `第 ${data.epIndex} `)
      .replace(/Episode N/g, `Episode ${data.epIndex}`);
    const synopsisBlock = data.synopsisText
      ? data.lang === "zh"
        ? `【故事梗概】\n${data.synopsisText.slice(0, 8000)}\n\n`
        : `[Synopsis]\n${data.synopsisText.slice(0, 8000)}\n\n`
      : "";
    const prevBlock = data.previousEpisodesText
      ? data.lang === "zh"
        ? `【前序剧集内容】（仅供理解上下文，不要输出这些内容）\n${data.previousEpisodesText.slice(0, 30000)}\n\n`
        : `[Previous episodes — for context only, do NOT output this]\n${data.previousEpisodesText.slice(0, 30000)}\n\n`
      : "";
    const user =
      data.lang === "zh"
        ? `${synopsisBlock}${prevBlock}【目标集数】第 ${data.epIndex} 集\n【当前剧本】\n${data.currentText}\n\n【用户修改要求】\n${data.instruction}\n\n请直接输出修改后的第 ${data.epIndex} 集剧本。`
        : `${synopsisBlock}${prevBlock}[Episode] ${data.epIndex}\n[Current script]\n${data.currentText}\n\n[User instruction]\n${data.instruction}\n\nOutput the full revised Episode ${data.epIndex} script.`;
    yield* streamChat({ model: pickModel(data.model), system: sys, user });
  });

// ============= 4) 梗概精修（基于当前梗概 + 用户指令 重写整份梗概）=============

const RefineInput = z.object({
  lang: Lang,
  currentSynopsis: z.string().min(20).max(20000),
  instruction: z.string().min(1),
  history: z
    .array(z.object({ role: z.enum(["user", "agent"]), content: z.string() }))
    .max(12)
    .optional()
    .default([]),
  model: z.string().optional(),
});

const SYS_REFINE_ZH = `你是一位资深短剧编剧，正在协助用户精修"故事梗概"。

严格规则：
1) 必须输出一份**完整的新版梗概全文**（Markdown），不能只输出 diff、补丁或仅写"已修改部分"；
2) 必须严格保留原梗概的 6 段一级/二级标题骨架：① 故事名称 ② 故事核心 ③ 人物小传 ④ 剧情梗概 ⑤ 章节结构 ⑥ 第 1 集钩子预告——一节都不能少；
3) 只针对"用户修改要求"做最小必要改动，其余段落尽量保留原文措辞；
4) 不写任何解释、前言、"以下是修改后的版本"等元话术，直接从一级标题开始输出；
5) 禁止生成 HTML、表格、代码块；对白仍用中文引号"…"包裹。`;

const SYS_REFINE_EN = `You are a senior short-drama writer helping the user refine an existing story synopsis.

Rules:
1) Output the FULL new synopsis in Markdown — never a diff, patch, or only the changed parts;
2) Preserve the original 6-section skeleton (Title / Core / Characters / Plot Outline / Chapter Structure / Episode 1 Cliffhanger) — do not drop any;
3) Make only the minimal necessary changes implied by the user's instruction; keep other paragraphs intact;
4) No preamble, no explanations like "here is the updated version" — start directly with the H1 heading;
5) No HTML, tables, or code fences.`;

export const refineSynopsis = createServerFn({ method: "POST" })
  .validator((d: unknown) => RefineInput.parse(d))
  .handler(async function* ({ data }) {
    const sys = wrapFictionSystem(data.lang, data.lang === "zh" ? SYS_REFINE_ZH : SYS_REFINE_EN);
    const histText =
      (data.history ?? [])
        .slice(-8)
        .map((h) => `${h.role === "user" ? "用户" : "助手"}：${h.content}`)
        .join("\n") || "（无）";
    const rawUser =
      data.lang === "zh"
        ? `【当前梗概】\n${data.currentSynopsis}\n\n【用户本轮修改要求】\n${data.instruction}\n\n【最近精修对话】\n${histText}\n\n请直接输出修改后的完整梗概。`
        : `[Current synopsis]\n${data.currentSynopsis}\n\n[User instruction]\n${data.instruction}\n\n[Recent dialogue]\n${histText}\n\nOutput the full revised synopsis directly.`;
    const user = wrapFictionUser(data.lang, rawUser);
    yield* streamChat({ model: pickModel(data.model), system: sys, user });
  });
