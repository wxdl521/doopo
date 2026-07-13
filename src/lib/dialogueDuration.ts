// ====================================================================
//  台词时长估算(2026/07 新增)
//
//  背景:AI 切分一集剧情 -> 若干分镜组,每组 = 一段 ≤15s 的视频。视频生成时
//  会把 plotText 里的台词"说出来"(配音)。如果一组塞的台词太多、15s 说不完,
//  视频模型就会漏台词 / 语序发音乱。这里提供按"字数 × 语速"估算台词说完
//  所需秒数的工具,给两处用:
//    1) storyboard.functions.ts 切分时:给 prompt 里的"台词可说完性"预算提供
//       口径,并在 normalizeGroup 里给超 15s 的组打 dialogueOverloadSec 标记。
//    2) workspace route 的 groupVideoDurationSec:按台词字数兜底拉长视频时长
//       (≤15s),保证台词能在视频时长内说完。
//
//  纯函数,server + client 共用,无副作用,不依赖任何运行时环境。
// ====================================================================

/**
 * 中文 spoken 台词语速(字/秒):正常稍快、含句间停顿、能清楚说完。
 *
 * 取 4 字/秒的依据:
 *  - CCTV 新闻播音 ~5 字/秒(偏快、无停顿);
 *  - 日常对话 ~3.3~4.2 字/秒;
 *  - 4 字/秒 = 正常稍快 + 句间停顿余量,确保"能清楚说完",不会抢词/乱。
 *  即每字 ≈ 0.25 秒。15s 视频约可容纳 56 字台词(预留 1 秒停顿)。
 */
export const SPEECH_RATE_CPS = 4;

/** Doubao Seedance 2.0 单段视频时长上限(秒)。 */
export const MAX_VIDEO_DURATION_SEC = 15;

/**
 * 引号字符配对表(open -> close)。覆盖中文/全角引号 + ASCII 双引号。
 * ASCII 单引号 ' 不计入(歧义大,中文剧本台词基本不用它做分隔)。
 */
const QUOTE_PAIRS: Record<string, string> = {
  "「": "」", // 「」
  "『": "』", // 『』
  "“": "”", // ""
  "‘": "’", // ''
  '"': '"', // ASCII 双引号(toggle:开闭同字符)
};

/** 是否是引号开字符 */
function isOpenQuote(ch: string): boolean {
  return ch in QUOTE_PAIRS;
}

/**
 * 从剧情文本里提取"说出口的台词":拼接所有引号对内的内容。
 *
 * - 中文/全角引号(「」『』"")按开闭配对,引号内为台词。
 * - ASCII 双引号 " 按出现次数成对 toggle(第 1 个开、第 2 个闭、第 3 个开...)。
 * - 引号外的角色名标签(如 `陆深:`)、动作描写、心理、旁白叙述一律不计。
 * - 未闭合的引号(到文本末尾仍开着):把余下内容当作台词(估算场景下更安全)。
 *
 * 不做语义分析,纯靠引号配对。台词密集的剧本几乎都用引号包裹台词,口径足够稳。
 */
export function extractDialogue(text: string): string {
  if (!text) return "";
  let out = "";
  let inQuote = false;
  let openCh = ""; // 当前打开的引号字符
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inQuote) {
      if (isOpenQuote(ch)) {
        inQuote = true;
        openCh = ch;
      }
      // 引号外的字符跳过(不计入台词)
    } else {
      // 在引号内,收集字符
      const closeCh = QUOTE_PAIRS[openCh];
      if (ch === closeCh) {
        inQuote = false;
        openCh = "";
        // 闭合引号本身不收集
      } else {
        out += ch;
      }
    }
  }
  // 未闭合引号:out 已包含到末尾的内容(收集一直进行),符合预期
  return out;
}

/** 说出口字符的正则:CJK 表意字 + (ASCII | 全角)字母数字。标点/空白/符号不计。 */
const SPEAKABLE_RE = /[一-鿿㐀-䶿豈-﫿A-Za-z0-9Ａ-Ｚａ-ｚ０-９]/g;

/**
 * 统计"说出口的字数":CJK 汉字 + 拉丁字母/数字(含全角)。
 * 排除标点、空白、speaker 标签、动作符号。这是真正要被念出来的字符量。
 */
export function countSpeakableChars(text: string): number {
  if (!text) return 0;
  const m = text.match(SPEAKABLE_RE);
  return m ? m.length : 0;
}

/**
 * 估算把 text 里的台词用正常稍快语速说完需要多少秒(向上取整,最小 0)。
 *
 *   sec = ceil(countSpeakableChars(extractDialogue(text)) / rateCps)
 *
 * 向上取整:零头也要留足 1 秒,宁可多给时间,不留抢词风险。
 * 无台词(空镜 / 纯动作) -> 0。
 *
 * @param text 剧情文本(含引号包裹的台词)
 * @param rateCps 语速(字/秒),默认 SPEECH_RATE_CPS=4
 */
export function estimateDialogueSpeechSec(text: string, rateCps?: number): number {
  const rate = rateCps && rateCps > 0 ? rateCps : SPEECH_RATE_CPS;
  const chars = countSpeakableChars(extractDialogue(text));
  if (chars <= 0) return 0;
  return Math.ceil(chars / rate);
}
