// ====================================================================
// voiceCasting —— 同一角色跨分镜音色一致（纯函数，可单测）
//
// 线上问题（2026-08）：参考音频要靠用户在确认卡手选（默认「不使用」），
// 提示词也无「谁在说、什么音色」约束，同一角色跨片段音色随机漂移。
// 本模块提供四条修复的判定/组装逻辑：
//   1. pickDefaultVoiceCandidate  —— 确认卡默认锁定（台词量最多者优先）；
//   2. attributeShotSpeaker       —— 逐镜台词的说话人归属；
//   3. buildVoiceCastingBlock     —— [VOICE CASTING] 提示词块；
//   4. matchVoiceStyle            —— 未绑定音色角色按年龄/性别自动匹配预设。
// ====================================================================

import { VOICE_STYLES, type VoiceStyle } from "../data/voiceStyles";

/** 参考音频候选（确认卡音频区条目）的最小形状。 */
export interface VoiceCandidate {
  characterId: string;
  characterName: string;
  audioUrl: string;
}

/** 逐镜台词归属所需的 shot 最小形状（characterIds 需调用方先按组兜底解析）。 */
export interface DialogueShotShape {
  characterIds?: string[];
  dialogue?: string;
  /** 2026/08:说话音频角色 id（画外音/旁白）——存在时优先于一切视觉归属推断 */
  speakerAudioRoleId?: string;
}

/**
 * 确认卡默认锁定的参考音频：只有一个候选直接锁定；多候选时选「本组台词量
 * 最多」的角色（台词字数按其出现的带台词 shot 累计；并列取候选顺序靠前者）。
 * 无候选返回 undefined（确认卡保持「不使用」）。
 */
export function pickDefaultVoiceCandidate<T extends VoiceCandidate>(
  candidates: readonly T[],
  shots: readonly DialogueShotShape[],
): T | undefined {
  if (!candidates.length) return undefined;
  if (candidates.length === 1) return candidates[0];
  const dialogueCharsOf = (characterId: string): number =>
    shots
      .filter(
        (shot) => shot.dialogue?.trim() && (shot.characterIds ?? []).includes(characterId),
      )
      .reduce((sum, shot) => sum + (shot.dialogue ?? "").trim().length, 0);
  let best: T = candidates[0];
  let bestChars = dialogueCharsOf(best.characterId);
  for (const candidate of candidates.slice(1)) {
    const chars = dialogueCharsOf(candidate.characterId);
    if (chars > bestChars) {
      best = candidate;
      bestChars = chars;
    }
  }
  return best;
}

/**
 * 逐镜台词的说话人归属：
 * 0. shot 带 speakerAudioRoleId（画外音/旁白）→ 直接返回它（2026/08：明确
 *    的声音角色 id 优先,不再靠「镜头里有哪些人物」猜说话人）;
 * 1. 台词文本里点名了角色名（「角色名：…」或文中出现角色名）→ 该角色；
 * 2. 该 shot 只有一个角色 → 该角色；
 * 3. 都取不到 → 兜底角色（组内首个角色,调用方传入）。
 * 返回角色 id；无台词或无法归属返回 undefined。
 */
export function attributeShotSpeaker(
  shot: DialogueShotShape,
  characters: readonly { id: string; name: string }[],
  fallbackCharacterId?: string,
): string | undefined {
  const dialogue = shot.dialogue?.trim();
  if (!dialogue) return undefined;
  if (shot.speakerAudioRoleId) return shot.speakerAudioRoleId;
  const ids = shot.characterIds ?? [];
  // 名字匹配只在该 shot 出现的角色里找（他集角色同名彩蛋不误判）
  const inShot = characters.filter((c) => ids.includes(c.id));
  const named = inShot.find((c) => c.name.trim() && dialogue.includes(c.name.trim()));
  if (named) return named.id;
  if (inShot.length === 1) return inShot[0].id;
  return fallbackCharacterId;
}

/** VOICE CASTING 块里单个说话角色的描述行输入。 */
export interface VoiceSpeakerInfo {
  characterId: string;
  name: string;
  age?: number;
  gender?: string;
  roleLabel?: string;
  personality?: string;
  /** 已绑定/自动分配的预设音色显示名（VOICE_STYLES.name） */
  voiceStyleName?: string;
}

/**
 * [VOICE CASTING — KEEP CONSISTENT] 提示词块：逐说话角色给出
 * 「角色名 + 年龄/性别/音色描述」,并要求同一角色全片同一音色语速语气。
 * 无说话角色返回空串（调用方不拼该块）。
 */
export function buildVoiceCastingBlock(speakers: readonly VoiceSpeakerInfo[]): string {
  if (!speakers.length) return "";
  const lines = speakers.map((speaker) => {
    const traits = [
      speaker.age != null ? `${speaker.age}岁` : undefined,
      speaker.gender?.trim() || undefined,
      speaker.roleLabel?.trim() || speaker.personality?.trim() || undefined,
    ]
      .filter(Boolean)
      .join("，");
    const voice = speaker.voiceStyleName ? `；参考音色「${speaker.voiceStyleName}」` : "";
    return `- ${speaker.name}：${traits || "特征见角色设定"}${voice}`;
  });
  return [
    "[VOICE CASTING — KEEP CONSISTENT]",
    ...lines,
    "The same character MUST use the same voice, pacing and tone in every shot and every clip. Never change a character's voice mid-video.",
  ].join("\n");
}

/** 年龄 → 年龄段（junior ≤14 / young ≤25 / adult ≤55 / senior >55；缺省按 adult）。 */
export function ageToVoiceAgeGroup(
  age: number | undefined,
): VoiceStyle["ageGroup"] {
  if (age == null || !Number.isFinite(age)) return "adult";
  if (age <= 14) return "junior";
  if (age <= 25) return "young";
  if (age <= 55) return "adult";
  return "senior";
}

/** 角色卡 gender 字段（男/女/male/female 等写法）归一；识别不了返回 undefined。 */
export function normalizeGender(gender: string | undefined): "male" | "female" | undefined {
  const g = (gender ?? "").trim().toLowerCase();
  if (!g) return undefined;
  if (/女|female|^f$/.test(g)) return "female";
  if (/男|male|^m$/.test(g)) return "male";
  return undefined;
}

const AGE_GROUP_ORDER: VoiceStyle["ageGroup"][] = ["junior", "young", "adult", "senior"];

/**
 * 未绑定音色的角色按年龄/性别匹配最接近的预设音色：
 * 性别不一致罚 100（实质排除，除非全库无同性别条目才退而求其次）；
 * 同性别按年龄段距离取最近；并列取库内顺序靠前者。
 */
export function matchVoiceStyle(input: { age?: number; gender?: string }): VoiceStyle {
  const gender = normalizeGender(input.gender);
  const group = ageToVoiceAgeGroup(input.age);
  const targetIndex = AGE_GROUP_ORDER.indexOf(group);
  let best: VoiceStyle = VOICE_STYLES[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const style of VOICE_STYLES) {
    const genderPenalty = gender && style.gender !== gender ? 100 : 0;
    const score =
      genderPenalty + Math.abs(AGE_GROUP_ORDER.indexOf(style.ageGroup) - targetIndex);
    if (score < bestScore) {
      best = style;
      bestScore = score;
    }
  }
  return best;
}

/** 按 referenceAudioUrl 反查预设音色（用户手绑预设/自动分配的 URL 都是库内相对路径）。 */
export function voiceStyleByAudioUrl(audioUrl: string | undefined): VoiceStyle | undefined {
  if (!audioUrl) return undefined;
  return VOICE_STYLES.find((style) => style.audioUrl === audioUrl);
}

/**
 * 画外音硬约束提示词块（第二道保险；第一道是结构化数据与参考素材隔离——
 * 音频角色不进 characterIds、没有任何人物图进入模型输入）。
 * 含画外音说话角色的请求都必须拼上这段。
 */
export function buildOffscreenVoiceConstraint(roleNames: readonly string[]): string {
  if (!roleNames.length) return "";
  return [
    "[OFF-SCREEN VOICE — NEVER ON SCREEN]",
    `These speakers are OFF-SCREEN VOICE ONLY: ${roleNames.join(" / ")}. They MUST NEVER APPEAR VISUALLY in any frame — do not draw, render or imply their person, face, silhouette, hands or belongings. The picture only shows what the script visibly specifies (environment, props, on-screen characters), even while the voice is speaking.`,
  ].join("\n");
}
