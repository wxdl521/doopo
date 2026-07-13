// ====================================================================
//  分镜(server) —— 剧情 → 分镜组 → 多图融合 → 分镜图
//
//  包含三个 server function:
//
//  1) generateStoryboardFromPlot
//     - 输入:当集剧情文本 + 角色摘要 + 场景摘要 + 项目风格
//     - 输出:多组 StoryboardGroup(每组 1~3 个镜头,带 startSec/endSec/
//       shotType/action/camera 等字段)。**文本任务**,走 DashScope Qwen
//       (qwen3.6-flash,跟图片生成共用同一个 Qwen API key,稳定性高)。
//       之前用 OpenRouter + gemini-2.5-flash fallback,经常在 google 上
//       报 4xx / 5xx,改回 Qwen 之后稳定。
//
//  2) generateStoryboardShotImage
//     - 输入:单组 plot 文本 + 角色图片 URL 数组 + 场景图片 URL + 镜头信息
//     - 输出:多图融合生成的分镜图 URL(I2I)
//     - 关键:**2026 重构**走 seedream.functions.ts:generateStoryboardShotImage
//       (POST {ARK_BASE_URL}/images/generations,image 字段 = string[])
//       模型把多个参考图按文字指令融合成最终分镜。提示词 builder 已搬到
//       seedream.functions.ts,这里只保留 Zod schema 和委托入口。
//
//  3) regenerateStoryboardShot
//     - 跟 2) 同结构,但图 1 永远是当前分镜图(referenceImageUrl),
//       角色/场景参考随后。委托给 seedream.functions.ts:regenerateStoryboardShot。
//
//  这三个函数对应 workspace UI 的三个动作:
//   - "把当集剧情发给 AI,生成多行分镜组"
//   - "对每个镜头点击生成 / 自动生成,产出分镜图"
//   - "对已生成的镜头,按用户意见重生"
// ====================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  ARK_TEXT_MODEL,
  ARK_TEXT_THINKING_DISABLED,
  arkTextApiKey,
  arkTextEndpoint,
  qwenApiKey,
} from "./arkText";
import { estimateDialogueSpeechSec, MAX_VIDEO_DURATION_SEC } from "./dialogueDuration";

// --------------------------------------------------------------------
// 1) generateStoryboardFromPlot —— 文本任务
// --------------------------------------------------------------------

const PlotInput = z.object({
  episodeText: z.string().min(50), // 2026/07:去掉 max 上限,超长剧情交给模型 context window(超长易超时/截断,风险自负)
  episodeIndex: z.number().int().min(1).max(999),
  // 角色 / 场景摘要(从 workspace 现有 GenCharacter / GenScene 简化而来,
  // 不传整个对象,减少 token 消耗)
  characterSummaries: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        role: z.string().optional(),
        // 一句话形象描述(给 AI 锁定"是谁")
        profile: z.string().max(400),
      }),
    )
    .max(40)
    .default([]),
  sceneSummaries: z
    .array(
      z.object({
        id: z.string(),
        slug: z.string(),
        location: z.string().optional(),
        timeOfDay: z.string().optional(),
        profile: z.string().max(2000),
      }),
    )
    .max(40)
    .default([]),
  // 期望生成多少组分镜(客户端可调,默认 6,设为 0 表示不设上限让 AI 自己决定)
  groupCount: z.number().int().min(0).max(30).default(6),
  // 上一集剧情(可选),给 AI 提供上下文
  previousEpisodesText: z.string().optional(), // 2026/07:去掉 max 上限(同 episodeText)
  // 项目风格
  projectStyle: z.string().max(50).optional(),
  // 文本生成模型
  model: z.string().max(100).optional(),
});

export type GenerateStoryboardFromPlotInput = z.infer<typeof PlotInput>;

/**
 * 2026/06 改造:从一次性返回改为**流式输出**。
 *
 * AI 切分一集剧情通常要 30~120s,用户从点"进入分镜"到看到第一组分镜要等
 * 整段时间。改造后:
 *   - server fn 用 async generator yield 事件
 *   - 用 `stream: true` 调 Qwen,SSE delta 一边到一边攒
 *   - 用 StreamingGroupExtractor 监听 buffer,一旦某个 `{ ... }` group
 *     对象完整闭合,立刻 parse + normalize + yield 出去
 *   - 客户端边收边把组追加到 storyboardGroups,跳到分镜 tab 时第一组已可见
 *
 * 事件:
 *   - progress: 进度文案 (展示给 toast / loading 状态)
 *   - group:    单组已就绪 (normalized 后的 StoryboardGroup 雏形,
 *               还差 episodeIndex / sceneLocation,客户端补)
 *   - done:     流结束,带最终用的模型 + 累计组数
 *   - error:    任何阶段失败,客户端展示错误并停止
 */
export type StoryboardStreamEvent =
  | { kind: "progress"; message: string }
  | { kind: "group"; group: ReturnType<typeof normalizeGroup> }
  | { kind: "done"; model: string; count: number }
  | { kind: "error"; message: string };

export const generateStoryboardFromPlot = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => PlotInput.parse(d))
  .handler(async function* ({ data }): AsyncGenerator<StoryboardStreamEvent> {
    const { resolveProjectStyle } = await import("./visualStyles");
    const styleSpec = resolveProjectStyle(data.projectStyle);

    const charList = data.characterSummaries.length
      ? data.characterSummaries
          .map(
            (c) =>
              `- id="${c.id}" name="${c.name}"${c.role ? ` role="${c.role}"` : ""}: ${c.profile}`,
          )
          .join("\n")
      : "(无角色信息)";
    const sceneList = data.sceneSummaries.length
      ? data.sceneSummaries
          .map(
            (s) =>
              `- id="${s.id}" slug="${s.slug}"${s.location ? ` location="${s.location}"` : ""}${s.timeOfDay ? ` time=${s.timeOfDay}` : ""}: ${s.profile}`,
          )
          .join("\n")
      : "(无场景信息)";

    // 强制 JSON 输出,避免模型输出自然语言;prompt 里明确告诉模型输出 schema。
    const systemPrompt = `你是一名资深影视分镜师。你的任务是把一集剧本切成若干个**分镜组**,
每个分镜组 = 一段最长 ${MAX_VIDEO_DURATION_SEC} 秒的视频。**一个分镜组不锁死 1 个 shot**:根据这段剧情的节奏,
在组内生成 **1~3 个 shot**,每个 shot 2~8 秒,加起来不超过 ${MAX_VIDEO_DURATION_SEC} 秒,把这段剧情表现完整。
组分镜组级字段:该组覆盖的剧情描述(plotText)、场景(sceneId)、角色(characterIds)、
时间区间(startSec/endSec,整组 ≤${MAX_VIDEO_DURATION_SEC}s)。组内 shots 数组每个元素是一个镜头(shot):
景别(shotType)、动作(action)、机位(camera)、运镜(cameraMovement)、
走位(characterBlocking)、时间区间(startSec/endSec)。

═══════════════════════════════════════════════════════════
【第 0 条 —— 剧情覆盖完整性(最高优先级,压倒一切)】
═══════════════════════════════════════════════════════════
你必须保证:把所有分镜组的 plotText 按顺序拼接起来,**完整覆盖**原剧本的
全部内容,从第一个字到最后一个字,不跳过任何一段。

切分粒度按"一段最长 ${MAX_VIDEO_DURATION_SEC}s 视频"来切:把剧本按剧情节奏拆成若干段,
每段能在一段视频里讲完；时长首先由台词预算决定，而不是固定为 10 秒。

在输出 JSON 之前,强制执行以下自检:
1. 把原剧本按动作/台词/场景切换拆成若干段落，每段先计算台词时长再安排画面。
2. 为每段分配一个分镜组，组内再按节奏拆 1~3 个 shot(每个 2~8s,整组 ≤${MAX_VIDEO_DURATION_SEC}s)。
3. 逐个检查:段落 1 → 组[0] 的 plotText 覆盖了吗? 段落 2 → 组[1]? ... 直到结尾。
4. 任何段落没被覆盖 → **必须补组**,不能合并到相邻组。
5. 特别检查原剧本的**最后一段**(结尾),必须有专门一组覆盖它,
   不能因为 token 不够就省略结尾。

═══════════════════════════════════════════════════════════
【第 0.5 条 -- 台词可说完性(最高优先级,与第 0 条同级,压倒其余)】
═══════════════════════════════════════════════════════════
每个分镜组 = 一段 ≤${MAX_VIDEO_DURATION_SEC}s 的视频,视频里要把该组台词**说出来**(配音)。
中文 spoken 台词约 **4 字/秒**(正常稍快、含句间停顿、能清楚说完),即每字 ≈ 0.25 秒。
若一组塞的台词太多、${MAX_VIDEO_DURATION_SEC}s 说不完,视频就会漏台词 / 语序发音乱 -- 这是必须避免的。

硬性预算(每组都必须满足):
  每组的「spoken 台词总字数」× 0.25 秒 + 1 秒句间停顿  ≤  组内所有 shot 时长之和(= 该组视频时长)  ≤  ${MAX_VIDEO_DURATION_SEC} 秒

统计口径(只数"说出口的字"):
- 只统计**引号内**说出口的内容:「」『』""'' 或 ASCII " ... " 之内
- **不统计**:角色名标签(如 "陆深:")、动作描写、心理、旁白叙述、标点(，。！？…)
- 标点和句间停顿的余量已含在 4 字/秒里,不要再额外加秒数

由此推出拆组规则(台词驱动组时长,而不是先定 10s 再硬塞台词):
- **先算台词**:数该段 spoken 台词字数 N,说完需要 N×0.25 秒。
- **再定组时长**:使组内 shot 时长之和 **≥** 台词所需时长 + 1 秒停顿(且 ≤${MAX_VIDEO_DURATION_SEC}s)。
  台词多的组要把 shot 时长拉足(例:14s 台词 -> 组内 shot 之和为 15s)。
- **若一段剧情的台词在 ${MAX_VIDEO_DURATION_SEC}s 内说不完 -> 必须切成多个分镜组**,每组台词各自能在 ≤${MAX_VIDEO_DURATION_SEC}s 内说完。
  台词密集的对话段要拆得更细 -- **组数由台词密度决定,不再只按 ~10s 切**。
- **不要在一句台词中间切组**:单句台词必须完整落在同一组,不能把一句话劈成两半。
- 反向:一句短台词不要单独成组,跟相邻动作/反应合到同一组(组时长仍受台词预算约束)。
- **空镜组(无台词)**:不受台词预算约束,按原 ~10s 节奏切即可(台词字数=0,预算=0)。

【分镜组与 shot 数量要求】
- 一个分镜组 = 一段最长 ${MAX_VIDEO_DURATION_SEC}s 视频。组内 **1~3 个 shot**,每个 shot **2~8 秒**,整组 ≤${MAX_VIDEO_DURATION_SEC}s。
- 组时长由**台词说完所需时长**驱动:台词多的组,组内 shot 时长之和要够说完台词(≤${MAX_VIDEO_DURATION_SEC}s);
  台词超 ${MAX_VIDEO_DURATION_SEC}s 的段必须拆多组(见【第 0.5 条】)。
- 按这段剧情的节奏决定 shot 数:简单的静态段落 1 个 shot;有动作切换的 2 个;节奏密集的 3 个。
- **禁止整组只给 0 个 shot**;也禁止把整集塞进 1 组。
- 组数由剧情节奏**与台词密度共同**决定(台词密集处多拆组,不设上限);但**禁止整集只输出 1 组**。

【plotText 字段(镜头剧情描述)】
- plotText 是**该镜头对应的那段剧情的详细扩写散文**,描述该镜头中发生的一切
- 必须严格遵守剧本原文的逻辑,**只做扩写,不能改动/新增剧情**:
  • 原剧本没说的人物心理 → 不能写
  • 原剧本没出现的台词 → 不能编造
  • 原剧本的事件顺序 → 不能调整
- 扩写时按下面 5 要素铺开该镜头对应的那段剧本(每要素都要写到):
  1) 人物状态:镜头开始时人物处于什么情绪/姿势/状态(原剧本提到的)
  2) 环境:场景在哪、什么时间、光线/氛围/可见的关键道具
  3) 动作:该镜头中人物做了什么(细化到具体动作,例如"陆深推开教室门,
     把书包甩到桌上,坐下时椅子嘎吱响")
  4) 台词:**必须完整引用该镜头中出现的所有台词,一句都不能省略、不能缩写**。
     带角色名,例如 陆深:“我没事。” 语气/表情/动作配合写在台词前后
  5) 承接:该镜头结束后接下来发生了什么(原剧本的逻辑承接,不要剧透到下一个镜头之外)
- **空镜例外**:若该镜头是空镜(见下方【空镜 / 环境镜头】规则;原剧本该段无人物无台词),
  跳过 1)3)4) 人物要素,只写 2)环境 与 5)承接;plotText 不得出现任何人物。
- 字数要求:**≥ 100 字**,中等镜头 200~300 字,信息量大的镜头可 500 字
- 输出格式:连贯的中文散文段落,允许用 
 分自然段(不超过 2~3 段);
  **不要**用"镜头 1: ..."这种结构化前缀,**不要**写景别/机位(那些是 shots.camera)
- 示例片段:
  "傍晚的教室只剩窗外最后一缕橘红,陆深一个人坐在第三排,膝上摊着没翻动的物理课本。
  门被猛地推开,小明气喘吁吁冲进来,手里还攥着没合上的笔记本。

  小明:『老师找你!』他的声音又急又冲,带着没缓过来的喘息。陆深抬起头,合上书本,
  低声反问:『什么事?』随即从座位上起身,把椅子推回原位。"

【镜头字段要求】
- action 用中文描述该镜头"什么人做什么",1~2 句
- camera 用中文描述机位/焦段/角度,必须准确专业,杜绝错误:
  • camera 字段**只描述摄像机的位置/焦段/角度**,不要重复 shotType
  • 正确:"低角度仰拍,广角24mm,机位在教室门口地面"
  • 正确:"平视,中焦50mm,机位在讲台左侧"
  • 错误:"特写镜头" (shotType 已经是特写了,camera 不应该重复)
- cameraMovement 用中文描述摄像机本身的移动方式(推/拉/摇/移/跟/升/降/固定),
  必须包含方向/幅度,不能只写一个词:
  • 正确:"从全景缓慢推到角色面部特写(推镜,正面→正面近)"
  • 正确:"从左向右横摇扫过教室(摇镜,80°左→右)"
  • 正确:"固定机位,无运镜"
  • 错误:"推" (太简略,缺方向和幅度)
  • 错误:"运动镜头" (太模糊)
  • **没动就写"固定机位,无运镜",严禁无中生有编造运镜**(故事板俯视图会按这个画运镜线,编造会导致分镜与图不符)
  • 连续分镜之间的运镜必须逻辑连贯,禁止跳轴(180° rule):
    - 上一分镜结束的机位 ≈ 下一分镜开始的机位(空间连续性)
- characterBlocking 用中文描述本镜头中人物的走位/动线路径,
  写清楚"谁从哪移动到哪":
  • 正确:"林夏从门口(画面左侧)走向窗边座位(画面右侧)"
  • 正确:"两人原地对话,无走位"
  • 错误:"走位" (太简略,缺人物和路径)
  • **人物没动就写"人物静止,无走位",严禁无中生有编造动线**
- startSec / endSec 必填:该镜头在当集时间轴上的区间(秒)
  - 必须在 group 的 startSec~endSec 范围内
  - 组内连续 shot 的时间区间要无缝衔接(shot N 的 endSec == shot N+1 的 startSec)
  - **每个 shot 时长 2~8 秒**;组内所有 shot 时长之和 = 组的 endSec - startSec,整组 ≤${MAX_VIDEO_DURATION_SEC}s
- shotType 必填,5 个里选

【空镜 / 环境镜头(重要,务必遵守)】
当原剧本某段是**纯环境 / 风景 / 氛围描写**,没有人物活动、没有台词时
(例如"晨光穿透浓密的树冠,在铺满落叶与青苔的湿地上投下斑驳光影"),
这是一个**空镜(establishing shot / 环境镜头)**,必须按以下处理:
- characterIds 必须为空数组 [] -- **严禁凭空分配角色**(这是最常见错误!即便角色列表里有角色,原剧本该段没让该角色出现,就不能塞进 characterIds)
- plotText 只扩写环境、光线、氛围、可见道具,**不得编造任何人物、动作、台词、心理**
- shotType 优先 WS 远景(环境镜头常用远景展示空间感)
- action 字段描述环境/氛围(如"晨光透过树冠洒在湿地,光斑落在青苔上"),不写人物
- 禁止把空镜改成"主角走进森林""角色站在树下"之类有人物的镜头

【其他】
1. **剧情覆盖完整性(最重要)**：严格按剧本顺序切分,**必须覆盖整集全部剧情**,不得遗漏任何段落。
   开头 / 发展 / 高潮 / 结尾都要有对应的分镜组。输出前请逐段对照原剧本自查。
2. **分镜组与 shot 数**：每组 = 一段最长 ${MAX_VIDEO_DURATION_SEC}s 视频,组内 1~3 个 shot(每个 2~8s,整组 ≤${MAX_VIDEO_DURATION_SEC}s);禁止整集只输出 1 组。
3. 景别在 [WS 远景 / MS 中景 / CU 近景 / ECU 特写 / OTS 过肩] 中选择,按剧情需要混合使用,**不要所有分镜用同一个景别**。
4. 时间用秒(startSec / endSec):每个 shot 2~8s,组内 shot 时长之和 ≤${MAX_VIDEO_DURATION_SEC}s;组之间时间区间无缝衔接(组 N 末 shot 的 endSec == 组 N+1 首 shot 的 startSec)。
    **组内 shot 时长之和 ≥ 该组 spoken 台词字数 × 0.25s + 1s 停顿**(够说完台词),且 ≤${MAX_VIDEO_DURATION_SEC}s;台词超 ${MAX_VIDEO_DURATION_SEC}s 的段必须拆多组(见【第 0.5 条】)。
5. 角色 ID 必须是传入的角色列表中的 id,场景 ID 必须是传入的场景列表中的 id。
6. 只输出 JSON,不要任何解释、Markdown 包裹、代码块标记。`;

    const userPrompt = `请把下面第 ${data.episodeIndex} 集剧本切成若干个**分镜组**,输出 JSON。
**每个分镜组 = 一段最长 ${MAX_VIDEO_DURATION_SEC}s 的视频**，先按台词预算确定组时长，再按剧情节奏生成 **1~3 个 shot**(每个 2~8s,整组 ≤${MAX_VIDEO_DURATION_SEC}s)。

【分镜组与 shot 要求】
- 一个分镜组 = 一段最长 ${MAX_VIDEO_DURATION_SEC}s 视频。按这段剧情的节奏决定组内 shot 数:
  • 简单静态段落 → 1 个 shot(2~8s)
  • 有动作/反应切换 → 2 个 shot
  • 节奏密集(多句台词+动作) → 3 个 shot
- 每个 shot **2~8 秒**,组内 shot 时长之和 ≤${MAX_VIDEO_DURATION_SEC}s。
- 按剧情把整集切成若干段，**不要按固定 10 秒估算组数**；对话密集处自然生成更长的 12~15s 组或更多短组。
- **禁止整集只输出 1 组**;也禁止把台词时长加 1 秒停顿后超过 ${MAX_VIDEO_DURATION_SEC}s 的剧情塞进一组。
- 输出 JSON 前请确认:每一段剧情都被分配到了某个分镜组的 plotText 中,没有遗漏。

===== 角色列表 =====
${charList}

===== 场景列表 =====
${sceneList}

===== 项目视觉风格 =====
${styleSpec.label} —— ${styleSpec.positive}

${
  data.previousEpisodesText
    ? `===== 前面集数上下文 =====
${data.previousEpisodesText}
`
    : ""
}===== 第 ${data.episodeIndex} 集剧本 =====
${data.episodeText}

===== 输出前强制自检(必须执行,否则输出无效) =====
在脑中逐段过一遍原剧本，先按每段台词的可朗读时长标出来:
  剧本开头(第 1 段): _____ → 组[0] 的 plotText 覆盖了吗? ✓/✗
  剧本中间(第 2 段): _____ → 组[1] 覆盖了吗? ✓/✗
  剧本中间(第 3 段): _____ → 组[2] 覆盖了吗? ✓/✗
  ...(继续,直到剧本最后一段)
  剧本结尾(最后一段): _____ → 组[N-1] 覆盖了吗? ✓/✗
如果任何一行是 ✗ → 必须补一个组,不能跳过。输出前再检查一遍。

===== 输出前强制自检(续):台词可说完性(见【第 0.5 条】) =====
对每个分镜组,数一下 plotText 里引号内"说出口"的台词字数 N,算 N×0.25 秒:
  组[0]: 台词 N=__ 字 → 需 __s | 组内 shot 时长之和 __s → 够说完吗? ✓/✗
  组[1]: 台词 N=__ 字 → 需 __s | 组内 shot 时长之和 __s → ✓/✗
  ...(每组都要查,含结尾组)
  组[N-1]: 台词 N=__ 字 → 需 __s | 组内 shot 时长之和 __s → ✓/✗
规则:
  - 组内 shot 时长之和必须 ≥ 台词所需时长 + 1 秒停顿,且 ≤${MAX_VIDEO_DURATION_SEC}s。
  - 任何一组 ✗(台词在 ${MAX_VIDEO_DURATION_SEC}s 内说不完) → **必须拆成更多组**,直到每组台词都能在 ≤${MAX_VIDEO_DURATION_SEC}s 内说完。
  - 单句台词不能被拆到两个组(保持完整落在同一组)。
  - 空镜组(无台词,N=0)跳过此项。

===== 输出 JSON Schema(每组 1~3 个 shot;示例三组分别用了 1/2/3 个 shot,并混合景别) =====
{
  "groups": [
    {
      "id": "grp-1",
      "plotText": "该组(约 5s)对应的剧情详细扩写(≥ 100 字散文,严格遵循剧本逻辑,涵盖:人物状态 / 环境 / 动作 / 完整引用台词 / 承接)",
      "startSec": 0,
      "endSec": 5,
      "sceneId": "sc-xxx (必须从上面场景列表里挑一个最接近的,没有就 null)",
      "characterIds": ["ch-xxx"],
      "shots": [
        { "shotType": "WS", "action": "什么人做什么,1~2 句", "camera": "机位/焦段/角度(中文简短,只描述摄像机位置,不重复 shotType)", "cameraMovement": "固定机位,无运镜", "characterBlocking": "人物静止,无走位", "startSec": 0, "endSec": 5 }
      ]
    },
    {
      "id": "grp-2",
      "plotText": "该组(约 7s)对应的剧情扩写...",
      "startSec": 5,
      "endSec": 12,
      "sceneId": "sc-xxx",
      "characterIds": ["ch-xxx", "ch-yyy"],
      "shots": [
        { "shotType": "CU", "action": "什么人做什么", "camera": "...", "cameraMovement": "从全景缓慢推到角色面部特写", "characterBlocking": "林夏从门口走向窗边座位", "startSec": 5, "endSec": 8 },
        { "shotType": "OTS", "action": "什么人做什么", "camera": "...", "cameraMovement": "固定机位,无运镜", "characterBlocking": "两人原地对话,无走位", "startSec": 8, "endSec": 12 }
      ]
    },
    {
      "id": "grp-3",
      "plotText": "该组(约 10s)对应的剧情扩写...",
      "startSec": 12,
      "endSec": 22,
      "sceneId": "sc-xxx",
      "characterIds": ["ch-xxx"],
      "shots": [
        { "shotType": "MS", "action": "什么人做什么", "camera": "...", "cameraMovement": "...", "characterBlocking": "...", "startSec": 12, "endSec": 15 },
        { "shotType": "ECU", "action": "什么人做什么", "camera": "...", "cameraMovement": "...", "characterBlocking": "...", "startSec": 15, "endSec": 19 },
        { "shotType": "WS", "action": "什么人做什么", "camera": "...", "cameraMovement": "...", "characterBlocking": "...", "startSec": 19, "endSec": 22 }
      ]
    }
  ]
}

注意:
- **剧情覆盖检查(最重要)**：输出 JSON 后请逐段对照原剧本自查 -- 开头、中间每一段、结尾是否都有对应的分镜组。**严禁遗漏任何一段剧情**。
- **每组 1~3 个 shot**：每组 = 一段最长 ${MAX_VIDEO_DURATION_SEC}s 视频,组内 1~3 个 shot(每个 2~8s,整组 ≤${MAX_VIDEO_DURATION_SEC}s);禁止整集只输出 1 组。
- 组内 shot 时长之和 = 组 endSec - startSec(≤${MAX_VIDEO_DURATION_SEC}s);组之间首尾 shot 的 endSec/startSec 无缝衔接。
- 没有运镜就写「固定机位,无运镜」;人物没动就写「人物静止,无走位」。**严禁无中生有编造动线**。
- 严格按照剧本的剧情顺序排分镜组(不要乱序)
- 所有分镜组的 plotText 按顺序拼接起来,必须完整覆盖原剧本全部内容
- sceneId 必须在传入的场景列表里;不确定时给最接近的
- characterIds 必须在传入的角色列表里;没有明确角色时给空数组 [](纯环境/风景描写 = 空镜,必须给 [],严禁分配角色)
- 镜头组合要有变化,不要所有 shot 都是 MS 中景 -- 按剧情需要混合使用 WS/CU/ECU/OTS
- 整集时长应合理。组数由剧情内容量**与台词密度共同**决定(台词密集处多拆组,不设上限)。
- **台词可说完性**:每组引号内 spoken 台词字数 × 0.25s + 1s 停顿 ≤ 组内 shot 时长之和(≤${MAX_VIDEO_DURATION_SEC}s);超了就拆组。台词多的对话段拆细,不要硬塞进一组。`;

    // ---- 调文本模型 (SSE 流式) ----
    // 2026/07:ARK DeepSeek V4 Pro 为主,Qwen 兜底;key 复用 ARK_API_KEY / Qwen。
    const arkKey = arkTextApiKey();
    const qwenKey = qwenApiKey();

    const DASHSCOPE_CHAT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
    // 2026/07:由 DashScope Qwen 改为「ARK DeepSeek V4 Pro 为主、Qwen 兜底」。
    // 尝试序列:系统默认 ARK DeepSeek -> Qwen flash -> plus -> max。
    // 分镜拆分可能很长，不人为中止模型的流式输出；仅在用户请求的组数已满足时中止。
    // data.model 显式指定时覆盖首项(粗判 provider)。
    type SbAttempt = { provider: "ark" | "qwen"; model: string };
    const attempts: SbAttempt[] = [];
    if (data.model) {
      const isArk =
        data.model === ARK_TEXT_MODEL ||
        data.model.startsWith("ark:") ||
        data.model.startsWith("deepseek:");
      attempts.push({
        provider: isArk ? "ark" : "qwen",
        model: data.model.replace(/^(ark:|deepseek:)/, ""),
      });
    } else if (arkKey) {
      attempts.push({ provider: "ark", model: ARK_TEXT_MODEL });
    }
    if (qwenKey) {
      attempts.push({ provider: "qwen", model: "qwen3.6-flash" });
      attempts.push({ provider: "qwen", model: "qwen3.6-plus" });
      attempts.push({ provider: "qwen", model: "qwen3.7-max" });
    }
    if (attempts.length === 0) {
      yield {
        kind: "error",
        message: "文本模型 API key 未配置(请设置 ARK_API_KEY 或 Qwen/DASHSCOPE_API_KEY)",
      };
      return;
    }
    const FALLBACK_RETRYABLE = new Set([403, 404, 429, 500, 502, 503]);

    yield { kind: "progress", message: "正在加载分镜工作流…" };

    let lastError = "";
    for (const attempt of attempts) {
      const controller = new AbortController();
      // 单模型尝试期间是否已成功 yield 过 group。已经 yield 出去的 group
      // 是不可撤回的(客户端已经展示了),后续即便流出错也不能切换模型重头来。
      let yieldedAny = false;
      let modelSucceeded = false;
      const isArk = attempt.provider === "ark";
      const attemptKey = isArk ? arkKey : qwenKey;
      if (!attemptKey) {
        lastError = `[${attempt.model}] API key missing`;
        continue;
      }
      const endpoint = isArk ? arkTextEndpoint() : DASHSCOPE_CHAT;
      try {
        yield { kind: "progress", message: `已提交 ${attempt.model},等待 AI 输出第一组…` };
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${attemptKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: attempt.model,
            stream: true,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            // Qwen 支持 response_format 强制 JSON;ARK DeepSeek 不传(靠 prompt + extractor 兜底,避免 400)
            ...(!isArk ? { response_format: { type: "json_object" } } : {}),
            // ARK DeepSeek V4 Pro:关闭深度思考,走通用对话快模式
            ...(isArk ? { thinking: ARK_TEXT_THINKING_DISABLED } : {}),
            temperature: 0.6,
            // plotText 详细扩写 + 强制覆盖完整性,12000 给 prose + shots + 完整覆盖留足空间。
            max_tokens: 12000,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          lastError = `[${attempt.model}] ${res.status}: ${text.slice(0, 200)}`;
          // ark(主)任何失败都回退下一个 attempt(qwen);qwen 仅可重试状态继续
          if (isArk || FALLBACK_RETRYABLE.has(res.status)) {
            continue;
          }
          yield { kind: "error", message: lastError };
          return;
        }
        if (!res.body) {
          lastError = `[${attempt.model}] 上游无响应体`;
          continue;
        }
        // SSE 流式消费 + StreamingGroupExtractor:每个 group `{...}` 闭合一份
        // 就立刻 normalize 并 yield 给客户端。
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";
        const extractor = new StreamingGroupExtractor();
        let groupIndex = 0;
        let groupCount = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
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
              if (!delta) continue;
              fullText += delta;
              const completed = extractor.feed(delta);
              for (const groupJson of completed) {
                try {
                  const raw = JSON.parse(groupJson);
                  const g = normalizeGroup(raw, groupIndex, data);
                  groupIndex++;
                  if (!g) continue;
                  yield { kind: "group", group: g };
                  yieldedAny = true;
                  groupCount++;
                  if (data.groupCount > 0 && groupCount >= data.groupCount) {
                    // 已达请求数量,主动中止上游 stream 节省 token
                    try {
                      controller.abort();
                    } catch {
                      /* noop */
                    }
                    break;
                  }
                } catch {
                  // 单组 JSON 解析失败,跳过(下一组可能 OK)
                }
              }
              if (data.groupCount > 0 && groupCount >= data.groupCount) break;
            } catch {
              // SSE 心跳/非 JSON 行,忽略
            }
          }
          if (data.groupCount > 0 && groupCount >= data.groupCount) break;
        }
        if (groupCount > 0) {
          yield { kind: "done", model: attempt.model, count: groupCount };
          modelSucceeded = true;
          return;
        }
        // 流结束但一组都没拿到 — 兜底:尝试整体解析 fullText
        const jsonText = extractJsonBlock(fullText);
        if (jsonText) {
          try {
            const parsed = JSON.parse(jsonText) as { groups?: any[] };
            if (Array.isArray(parsed.groups) && parsed.groups.length > 0) {
              for (const g of parsed.groups.slice(0, data.groupCount)) {
                const normalized = normalizeGroup(g, groupIndex, data);
                groupIndex++;
                if (!normalized) continue;
                yield { kind: "group", group: normalized };
                yieldedAny = true;
                groupCount++;
              }
              if (groupCount > 0) {
                yield { kind: "done", model: attempt.model, count: groupCount };
                modelSucceeded = true;
                return;
              }
            }
          } catch {
            // fall through to model fallback
          }
        }
        lastError = `[${attempt.model}] 流结束但未解析到任何分镜组 (raw: ${fullText.slice(0, 200)})`;
      } catch (e) {
        lastError =
          `[${attempt.model}] ${e instanceof Error ? e.message : "network error"}`;
      }
      // 关键:已经 yield 过 group 的模型不能 fallback 重试 —— 客户端那边
      // 已经展示了部分组,换模型重新来一遍会重复。
      if (yieldedAny && !modelSucceeded) {
        // 部分组成功 + 流中断:按"已达本次能拿到的"结束,客户端拿到 done 也好告知用户。
        yield { kind: "done", model: attempt.model, count: 0 /* 客户端用累计计数 */ };
        return;
      }
    }
    yield { kind: "error", message: lastError || "分镜生成失败" };
  });

// --------------------------------------------------------------------
// StreamingGroupExtractor
//   - 输入:AI delta 文本,内含一个大 JSON `{"groups":[ {...}, {...}, ... ]}`
//   - 任务:边收 delta 边吐出"已闭合的 group `{...}` 子串",拿到一份就吐一份
//   - 状态机:
//       waiting_array:  在找到 `"groups"` 后的第一个 `[` 之前,所有字符进 buf
//       inside_array:   逐字符走,top-level `{` 开始累 current,depth 回 0 时
//                       一组就绪 → 推到 completed,继续等下一个 `{` 或 `]`
//   - 字符串/转义处理:在 string 内的 `{` `}` 不计 depth(`"a{b}c"` 不算嵌套)
// --------------------------------------------------------------------
class StreamingGroupExtractor {
  private buf = "";
  private state: "waiting_array" | "inside_array" = "waiting_array";
  private depth = 0;
  private inString = false;
  private escape = false;
  private current = "";

  feed(delta: string): string[] {
    const completed: string[] = [];
    for (let i = 0; i < delta.length; i++) {
      const ch = delta[i];
      if (this.state === "waiting_array") {
        this.buf += ch;
        // 等待 "groups" 之后(可能跨多个 delta)的第一个 `[`
        if (ch === "[" && this.buf.includes('"groups"')) {
          this.state = "inside_array";
          this.buf = "";
        }
        continue;
      }
      // inside_array
      if (this.depth === 0) {
        // 跳过 array 里的空白 / 逗号 / 关闭括号
        if (ch === "{") {
          this.depth = 1;
          this.current = "{";
        } else if (ch === "]") {
          // 整个 groups 数组结束;后面字符直接吞掉
          this.state = "waiting_array";
          this.buf = "";
        }
        // 其他(空白、`,`)忽略
        continue;
      }
      // depth > 0
      this.current += ch;
      if (this.escape) {
        this.escape = false;
        continue;
      }
      if (this.inString) {
        if (ch === "\\") this.escape = true;
        else if (ch === '"') this.inString = false;
        continue;
      }
      if (ch === '"') this.inString = true;
      else if (ch === "{") this.depth++;
      else if (ch === "}") {
        this.depth--;
        if (this.depth === 0) {
          completed.push(this.current);
          this.current = "";
        }
      }
    }
    return completed;
  }
}

// 兜底:把 AI 返回的 loose group 强制规整成可用的 StoryboardGroup
function normalizeGroup(
  g: any,
  index: number,
  data: GenerateStoryboardFromPlotInput,
): {
  id: string;
  index: number;
  plotText: string;
  startSec: number;
  endSec: number;
  sceneId?: string;
  characterIds: string[];
  /** 2026/07:该组 spoken 台词估算说完秒数(4字/秒)。 */
  estDialogueSec?: number;
  /** 台词超出单视频 15s 硬上限的秒数(>0 表示该组台词一个视频说不完,需拆组/精简)。 */
  dialogueOverloadSec?: number;
  shots: Array<{
    id: string;
    shotType: "WS" | "MS" | "CU" | "ECU" | "OTS";
    shotTypeLabel: string;
    action: string;
    camera: string;
    cameraMovement?: string;
    characterBlocking?: string;
    startSec?: number;
    endSec?: number;
  }>;
} | null {
  if (!g || typeof g !== "object") return null;
  const plotText =
    typeof g.plotText === "string" && g.plotText.trim() ? g.plotText.trim().slice(0, 2000) : "";
  if (!plotText) return null;
  const startSec = Number.isFinite(g.startSec) ? Math.max(0, Number(g.startSec)) : index * 10;
  const endSec = Number.isFinite(g.endSec)
    ? Math.max(startSec + 1, Number(g.endSec))
    : startSec + 10;
  const validSceneIds = new Set(data.sceneSummaries.map((s) => s.id));
  const sceneId =
    typeof g.sceneId === "string" && validSceneIds.has(g.sceneId) ? g.sceneId : undefined;
  const validCharIds = new Set(data.characterSummaries.map((c) => c.id));
  const characterIds: string[] = Array.isArray(g.characterIds)
    ? g.characterIds.filter((x: any) => typeof x === "string" && validCharIds.has(x))
    : [];
  const rawShots: any[] = Array.isArray(g.shots) ? g.shots : [];
  // 2026/06:之前这里有 .slice(0, 3) 把 shots 硬截到 3 个 —— 用户诉求改成
  // **不设上限**,AI 给几个就保几个。normalizeShot 内部还是会做单条字段
  // 校验(没 action 会丢),所以"多了也不会污染数据"这一点是安全的。
  const shots = rawShots
    .map((s: any, i: number, arr: any[]) => normalizeShot(s, index, i, startSec, endSec, arr))
    .filter((s): s is NonNullable<ReturnType<typeof normalizeShot>> => s !== null);
  if (!shots.length) return null;
  // 2026/07:台词可说完性兜底 —— 估算该组 spoken 台词说完需要多少秒。
  // 若超 15s 硬上限 -> dialogueOverloadSec 标记,后续 UI 展示警告;≤15s 的
  // 情况由 workspace route 的 groupVideoDurationSec 兜底拉长(见改动 3)。
  const estDialogueSec = estimateDialogueSpeechSec(plotText);
  const dialogueOverloadSec =
    estDialogueSec + 1 > MAX_VIDEO_DURATION_SEC
      ? Math.ceil(estDialogueSec + 1) - MAX_VIDEO_DURATION_SEC
      : undefined;
  return {
    id: `grp-${index + 1}-${Date.now().toString(36)}`,
    index: index + 1,
    plotText,
    startSec,
    endSec,
    sceneId,
    estDialogueSec: estDialogueSec || undefined,
    dialogueOverloadSec,
    characterIds,
    shots,
  };
}

const SHOT_TYPES = new Set(["WS", "MS", "CU", "ECU", "OTS"]);
const SHOT_LABEL_CN: Record<string, string> = {
  WS: "远景",
  MS: "中景",
  CU: "近景",
  ECU: "特写",
  OTS: "过肩",
};

function normalizeShot(
  s: any,
  groupIndex: number,
  shotIndex: number,
  groupStartSec: number,
  groupEndSec: number,
  allShots: any[],
): {
  id: string;
  shotType: "WS" | "MS" | "CU" | "ECU" | "OTS";
  shotTypeLabel: string;
  action: string;
  camera: string;
  cameraMovement?: string;
  characterBlocking?: string;
  startSec?: number;
  endSec?: number;
} | null {
  if (!s || typeof s !== "object") return null;
  const shotType = SHOT_TYPES.has(s.shotType) ? s.shotType : "MS";
  const action =
    typeof s.action === "string" && s.action.trim() ? s.action.trim().slice(0, 200) : "";
  const camera =
    typeof s.camera === "string" && s.camera.trim() ? s.camera.trim().slice(0, 100) : "";
  const cameraMovement =
    typeof s.cameraMovement === "string" && s.cameraMovement.trim()
      ? s.cameraMovement.trim().slice(0, 200)
      : undefined;
  const characterBlocking =
    typeof s.characterBlocking === "string" && s.characterBlocking.trim()
      ? s.characterBlocking.trim().slice(0, 300)
      : undefined;
  if (!action) return null;

  // 2026/06:每个 shot 自己的时间范围(秒,绝对值,在当集时间轴上)
  // 优先用 AI 给的 startSec / endSec;否则按 group 区间 + shot 个数均分(兜底)
  let shotStart = Number.isFinite(s.startSec) ? Math.max(groupStartSec, Number(s.startSec)) : null;
  let shotEnd = Number.isFinite(s.endSec) ? Number(s.endSec) : null;
  if (shotStart !== null && shotEnd !== null) {
    shotEnd = Math.max(shotStart + 1, Math.min(groupEndSec, shotEnd));
  } else {
    // 兜底:均分 group 区间
    const validShots = allShots.filter((x) => x && typeof x === "object");
    const totalCount = Math.max(1, validShots.length);
    const span = groupEndSec - groupStartSec;
    const slice = span / totalCount;
    shotStart = groupStartSec + slice * shotIndex;
    shotEnd = groupStartSec + slice * (shotIndex + 1);
  }

  return {
    id: `grp-${groupIndex + 1}-shot-${shotIndex + 1}`,
    shotType: shotType as any,
    shotTypeLabel: SHOT_LABEL_CN[shotType],
    action,
    camera,
    cameraMovement,
    characterBlocking,
    startSec: shotStart,
    endSec: shotEnd,
  };
}

/** 从模型输出中尽量提取 JSON 块(容忍 ```json ... ``` 包裹) */
function extractJsonBlock(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return "";
}

// --------------------------------------------------------------------
// 2) generateStoryboardShotImage —— 多图融合(I2I)
//
//    2026 重构:实际调用搬到 seedream.functions.ts,这里只保留 Zod schema
//    和委托入口。提示词 builder 集中在 seedream.functions.ts:buildShotInstruction。
//    Seedream 的 image 字段接受 string[],对应 N 张参考图。
// --------------------------------------------------------------------

const ShotInput = z.object({
  // 上下文(用于 prompt)
  plotText: z.string().min(1).max(2000),
  shotType: z.enum(["WS", "MS", "CU", "ECU", "OTS"]),
  shotTypeLabel: z.string().min(1).max(20),
  action: z.string().min(1).max(400),
  camera: z.string().max(200).default(""),
  cameraMovement: z.string().max(300).optional(),
  characterBlocking: z.string().max(400).optional(),
  // 2026/06:每 shot 自带时间范围(秒,绝对值,在当集时间轴上)
  startSec: z.number().min(0).max(3600).optional(),
  endSec: z.number().min(0).max(3600).optional(),
  durationSec: z.number().min(1).max(10).optional(),
  // 参考图 —— 客户端会先限好:有场景图时 ≤ 7 角色图,无场景图时 ≤ 8 角色图,
  // 总数 (角色 + 场景) ≤ 8。schema 这里再守一道 .max(8),防止意外传超。
  // 2026/07:按用户要求从 3 拉到 8(Seedream 经验 ≤4 稳定,超过易掉质量/超时,风险自负)。
  characterImageUrls: z.array(z.string().url()).max(8).default([]),
  characterNames: z.array(z.string().max(50)).max(8).default([]),
  sceneImageUrl: z.string().url().optional(),
  sceneLocation: z.string().max(200).default(""),
  sceneTimeOfDay: z.string().max(50).default(""),
  // 视觉风格
  projectStyle: z.string().max(50).optional(),
  // 模型(默认 doubao-seedream-5-0-260128,由 seedream 模块解析)
  model: z.string().max(100).optional(),
  // 2026/06:查看提示词模式
  previewOnly: z.boolean().default(false),
});

export type GenerateStoryboardShotInput = z.infer<typeof ShotInput>;

export const generateStoryboardShotImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ShotInput.parse(d))
  .handler(async ({ data }) => {
    // 动态 import 避免循环引用
    const { generateStoryboardShotImage: seedreamImpl } = await import("./seedream.functions");
    return seedreamImpl({ data } as any);
  });

// --------------------------------------------------------------------
// 3) regenerateStoryboardShot —— 按修改意见重生分镜图
//
//    2026 重构:同 2),委托给 seedream.functions.ts:regenerateStoryboardShot。
//    关键差别:图 1 永远是 referenceImageUrl(当前镜头),Seedream 端通过
//    seedream.functions.ts 内部处理。
// --------------------------------------------------------------------

const RegenShotInput = z.object({
  // 当前的镜头图(要被改的那张)
  referenceImageUrl: z.string().url(),
  // 用户输入的修改意见
  userInstruction: z.string().min(1).max(500),
  // 上下文(跟 generateStoryboardShotImage 一样)
  plotText: z.string().min(1).max(2000),
  shotType: z.enum(["WS", "MS", "CU", "ECU", "OTS"]),
  shotTypeLabel: z.string().min(1).max(20),
  action: z.string().min(1).max(400),
  camera: z.string().max(200).default(""),
  cameraMovement: z.string().max(300).optional(),
  characterBlocking: z.string().max(400).optional(),
  characterImageUrls: z.array(z.string().url()).max(8).default([]),
  characterNames: z.array(z.string().max(50)).max(8).default([]),
  sceneImageUrl: z.string().url().optional(),
  sceneLocation: z.string().max(200).default(""),
  sceneTimeOfDay: z.string().max(50).default(""),
  projectStyle: z.string().max(50).optional(),
  model: z.string().max(100).optional(),
  // 2026/06:查看提示词模式
  previewOnly: z.boolean().default(false),
});

export type RegenerateStoryboardShotInput = z.infer<typeof RegenShotInput>;

export const regenerateStoryboardShot = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => RegenShotInput.parse(d))
  .handler(async ({ data }) => {
    // 动态 import 避免循环引用
    const { regenerateStoryboardShot: seedreamImpl } = await import("./seedream.functions");
    return seedreamImpl({ data } as any);
  });

// --------------------------------------------------------------------
// 4) regenerateStoryboardPitchDeck —— 故事板图按意见重生(2026/06 新增)
//
//    委托入口。实际实现(Seedream I2I,referenceImageUrl 作 image 1)在
//    seedream.functions.ts:regenerateStoryboardPitchDeck。
// --------------------------------------------------------------------

const RegenPitchDeckInput = z.object({
  projectStyle: z.string().max(50).optional(),
  groupLabel: z.string().max(200).optional(),
  plotText: z.string().min(1).max(2000),
  scene: z
    .object({
      slug: z.string().max(200).optional(),
      location: z.string().max(200).optional(),
      timeOfDay: z.string().max(50).optional(),
      profile: z.string().max(2000).optional(),
    })
    .optional(),
  characters: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        roleLabel: z.string().max(200).optional(),
        age: z.number().int().min(0).max(200).optional(),
        faceDescription: z.string().max(2000).optional(),
        bodyDescription: z.string().max(2000).optional(),
        clothingDescription: z.string().max(2000).optional(),
        palette: z.array(z.string()).max(8).optional(),
      }),
    )
    .max(8)
    .default([]),
  shots: z
    .array(
      z.object({
        shotType: z.enum(["WS", "MS", "CU", "ECU", "OTS"]),
        shotTypeLabel: z.string().min(1).max(20),
        action: z.string().min(1).max(400),
        camera: z.string().max(200).default(""),
        durationSec: z.number().optional(),
        startSec: z.number().optional(),
        endSec: z.number().optional(),
      }),
    )
    .max(20)
    .default([]),
  referenceImages: z.array(z.string().url()).max(10).default([]),
  referenceImageLabels: z.array(z.string().max(120)).max(10).default([]),
  characterImageUrl: z.string().url().optional(),
  sceneImageUrl: z.string().url().optional(),
  model: z.string().max(100).optional(),
  previewOnly: z.boolean().default(false),
  referenceImageUrl: z.string().url(),
  userInstruction: z.string().min(1).max(500),
});

export type RegenerateStoryboardPitchDeckInput = z.infer<typeof RegenPitchDeckInput>;

export const regenerateStoryboardPitchDeck = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => RegenPitchDeckInput.parse(d))
  .handler(async ({ data }) => {
    const { regenerateStoryboardPitchDeck: seedreamImpl } = await import("./seedream.functions");
    return seedreamImpl({ data } as any);
  });
