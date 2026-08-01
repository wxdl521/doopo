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
