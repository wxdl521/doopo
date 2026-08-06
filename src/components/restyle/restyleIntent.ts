/**
 * 转绘对话的意图识别。
 * 之前只接受一字不差的“确认”，用户说“确认资产”“可以了”“继续”都会落到兜底
 * 回复（“已理解…”）而不推进流程。这里统一放宽为口语化匹配。
 */

const CONFIRM_PATTERNS: RegExp[] = [
  /^\s*(确认|确定|ok|okay|好的|好了|可以了?|没问题|没毛病|无误)\s*[。!！~]*\s*$/i,
  /确认(资产|无误|没问题|一下)?/,
  /(都|全部)?(可以|没问题|没毛病|通过)了?/,
  /继续/,
  /下一步/,
  /(开始|进入|生成|出)(转绘)?方案/,
  /(开始|进行)转绘/,
];

/** 用户是否在表达“确认当前结果、请继续下一步”。 */
export function isConfirmIntent(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  // 明确的否定/修改诉求不算确认
  if (/(不对|不行|重做|重新|修改|调整|换成|改成|删掉|去掉)/.test(text)) return false;
  return CONFIRM_PATTERNS.some((pattern) => pattern.test(text));
}

/** 用户是否在要求开始生成视频。 */
export function isVideoRenderIntent(message: string): boolean {
  return /确认生成视频|开始生成视频|生成视频|出片|渲染视频/.test(message);
}

/**
 * 用户是否在指出结果不对并要求重新生成。
 * 之前只匹配「修改/调整/改成」，“场景图片生成不对，请重新生成”这类最常见的
 * 纠错说法会落到兜底回复，重生成根本没被触发。
 */
export function isRegenerateIntent(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (isConfirmIntent(text)) return false;
  return /(不对|不正确|错了|有误|不符合|不像|重新生成|重新出|重画|重做|再生成|再来一张|换一张|换个|重出)/.test(
    text,
  );
}

/**
 * 用户是否在要求重新分析原片、重建或补充资产表。
 * 与 isConfirmIntent / isRegenerateIntent 互斥：确认类口语与明确指向资产图片
 * （含「图片 / 图 / 生图」且未提「资产表 / 分析」）的说法都不算重分析，
 * 后者交给生图纠错分支处理。
 */
export function isReanalyzeIntent(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (isConfirmIntent(text)) return false;
  const mentionsAnalysis = /(资产表|分析|提取|识别|原片)/.test(text);
  if (/(图片|生图|图)/.test(text) && !mentionsAnalysis) return false;
  if (isRegenerateIntent(text) && !mentionsAnalysis) return false;
  return /(重新分析|再次分析|再分析|重看|重新提取|重新识别|重跑|重新跑|补充分析|漏了|遗漏|资产表(不对|不正确|错了|有误|有问题)|re-?analy\w*|re-?extract\w*)/i.test(
    text,
  );
}

/** 「片段/整集重跑」意图的解析结果。 */
export type SegmentRerunIntent = {
  /** 用户口中的集序号（1 起始，「第一集」→ 1）；未指定时为 undefined。 */
  episode?: number;
  /** 规范化后的分段编号（如 U01）；未指定表示整集重跑。 */
  segmentId?: string;
  /** 用户原话，作为返工反馈透传给 generateRenderedVideos。 */
  feedback: string;
};

// 重做词 + 视频语境同时出现才判视频重跑；资产语义（资产表/角色/场景/道具/资产图片）
// 存在时放行给生图纠错分支，避免抢走「重新生成场景图片」。
const RERUN_WORD = /(重新生成|重跑|重新跑|重出|重新出|再生成|重新渲染|重做|re-?generate|re-?run|redo|re-?render)/i;
const VIDEO_CONTEXT = /(片段|分段|成片|视频|U\s*\d|EP\s*\d|集|segment|episode|clip|video)/i;
const ASSET_SEMANTIC = /(资产表|资产图片|资产图|角色|场景|道具|asset|character|scene|prop)/i;

const CN_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 中文数字（一 ~ 九十九）转阿拉伯数字，覆盖「第一集」「第十集」「第二段」等说法。 */
function parseCnNumber(text: string): number | undefined {
  if (!text) return undefined;
  if (text === "十") return 10;
  const tenIndex = text.indexOf("十");
  if (tenIndex >= 0) {
    const tens = tenIndex === 0 ? 1 : CN_DIGITS[text[0]];
    const ones = text.length > tenIndex + 1 ? CN_DIGITS[text[tenIndex + 1]] : 0;
    if (tens === undefined || ones === undefined) return undefined;
    return tens * 10 + ones;
  }
  return text.length === 1 ? CN_DIGITS[text] : undefined;
}

/** 集序号：EP01 / 第一集 / 第1集 / 01集 / episode 2（中文数字须带「第」，避免「这一集」误判）。 */
function parseEpisodeNumber(text: string): number | undefined {
  const explicit = text.match(/EP\s*0*(\d{1,3})/i) ?? text.match(/episode\s*0*(\d{1,3})/i);
  if (explicit) return Number(explicit[1]);
  const ordinal = text.match(/第\s*(\d{1,3}|[一二两三四五六七八九十]{1,3})\s*集/);
  if (ordinal) return /^\d+$/.test(ordinal[1]) ? Number(ordinal[1]) : parseCnNumber(ordinal[1]);
  const bare = text.match(/0*(\d{1,3})\s*集/);
  if (bare) return Number(bare[1]);
  return undefined;
}

/** 分段编号：U01 / 01片段 / 片段1 / 第二段 / 第2段，统一规范成 U 开头两位编号。 */
function parseSegmentId(text: string): string | undefined {
  const normalize = (raw: string | undefined): string | undefined => {
    if (raw === undefined) return undefined;
    const value = /^\d+$/.test(raw) ? Number(raw) : parseCnNumber(raw);
    return value === undefined ? undefined : `U${String(value).padStart(2, "0")}`;
  };
  const u = text.match(/U\s*0*(\d{1,2})(?!\d)/i);
  if (u) return normalize(u[1]);
  const prefix = text.match(/0*(\d{1,2})\s*(?:片段|分段)/);
  if (prefix) return normalize(prefix[1]);
  const suffix = text.match(/片段\s*0*(\d{1,2})/);
  if (suffix) return normalize(suffix[1]);
  const ordinal = text.match(/第\s*(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*(?:段|片段|分段)/);
  if (ordinal) return normalize(ordinal[1]);
  const en = text.match(/(?:segment|clip)\s*0*(\d{1,2})/i);
  if (en) return normalize(en[1]);
  return undefined;
}

/**
 * 用户是否在要求重跑某集/某片段的转绘视频（等价于右侧「返工」按钮）。
 * 仅在重做词与视频语境同时出现、且未指向资产语义时命中；
 * 解析出的集/片段是否存在由路由层按项目 planEpisodes 校验。
 */
export function parseSegmentRerunIntent(message: string): SegmentRerunIntent | null {
  const text = message.trim();
  if (!text) return null;
  if (!RERUN_WORD.test(text)) return null;
  if (ASSET_SEMANTIC.test(text)) return null;
  if (!VIDEO_CONTEXT.test(text)) return null;
  return { episode: parseEpisodeNumber(text), segmentId: parseSegmentId(text), feedback: text };
}

/**
 * 用户是否在要求整套重做转绘方案（区别于指出某集某段的局部修改）。
 * 与 isConfirmIntent 互斥（其已有的「重新 / 修改」排除逻辑会把这些说法挡在确认之外）。
 */
export function isReplanIntent(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (isConfirmIntent(text)) return false;
  return /(方案(不对|不正确|有误|有问题)|重新出方案|重出方案|重做方案|重新做方案|重新生成方案|重新分镜|重做分镜|redo\s+(the\s+)?(plan|storyboard)|replan)/i.test(
    text,
  );
}
