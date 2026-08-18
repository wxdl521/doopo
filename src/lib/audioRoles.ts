// ====================================================================
// audioRoles —— 画外音独立为「音频角色」:识别/迁移纯函数（可单测）
//
// 背景（2026-08）：系统只有一套视觉角色模型 GenCharacter,旁白/画外音被
// 当成普通人物提取并生成人物图;分镜 characterIds 双用途（画面角色 +
// 参考音频候选）,把旁白加进去模型就把老头画进荒原。修复:音频角色独立
// 成 GenAudioRole（只发声、永不入镜）,本模块负责旧数据迁移——识别
// 「旁白/画外音/讲述者/OS」类旧视觉角色迁移为音频角色,保留已绑定的
// referenceAudioUrl,并从视觉角色列表与分镜画面角色引用中移除。
// 技术约束:不删除用户旧数据的音频绑定;迁移只改分类与下游引用。
// ====================================================================

import type {
  GenAudioRole,
  GenCharacter,
  StoryboardGroup,
} from "../data/workspaceGenerators";

/**
 * 「声音-only」名称/定位特征。含:旁白、画外音(画外)、讲述者、解说、旁述、
 * OS/VO、内心独白、心声、独白、narrator/voice-over/narration。
 * 「旁白·苍老声音」这类命名由「旁白」关键词命中;仅含「声音」二字不判。
 */
const NARRATION_NAME_PATTERN =
  /旁白|画外音|画外|讲述者|解说|旁述|内心独白|心声|独白|\bOS\b|\bVO\b|narrat|voice[\s-]?over/i;

/** 名称或定位含画外音特征 → 应归为音频角色。 */
export function isNarrationLikeCharacter(c: { name: string; roleLabel?: string }): boolean {
  return NARRATION_NAME_PATTERN.test(c.name) || NARRATION_NAME_PATTERN.test(c.roleLabel ?? "");
}

/** 从名称/定位推断音频角色类型：内心独白 > 画外音 > 旁白（缺省）。 */
export function inferAudioRoleKind(c: {
  name: string;
  roleLabel?: string;
}): GenAudioRole["kind"] {
  const text = `${c.name} ${c.roleLabel ?? ""}`;
  if (/内心独白|心声|独白|inner/i.test(text)) return "inner_monologue";
  if (/画外音|画外|\bVO\b|voice[\s-]?over/i.test(text)) return "voiceover";
  return "narrator";
}

/** 旧视觉角色 → 音频角色（保留 referenceAudioUrl/年龄/性别/集数;id 加 audio- 前缀）。 */
export function audioRoleFromCharacter(c: GenCharacter): GenAudioRole {
  return {
    id: `audio-${c.id}`,
    name: c.name,
    kind: inferAudioRoleKind(c),
    age: c.age,
    gender: c.gender,
    voiceDescription: c.roleLabel || c.personality || undefined,
    referenceAudioUrl: c.referenceAudioUrl,
    episodes: c.episodes ?? [],
  };
}

/** 提取结果（无 id/集数）→ 音频角色：id 由名称派生（稳定、跨集同名复用）。 */
export function normalizeExtractedAudioRole(
  raw: {
    name?: string;
    kind?: string;
    age?: number;
    gender?: string;
    voiceDescription?: string;
  },
  epIndex: number,
): GenAudioRole | null {
  const name = (raw.name ?? "").trim();
  if (!name) return null;
  const kind =
    raw.kind === "voiceover" || raw.kind === "inner_monologue" ? raw.kind : "narrator";
  return {
    id: `audio-${name.replace(/\s+/g, "-")}`,
    name,
    kind,
    age: typeof raw.age === "number" ? raw.age : undefined,
    gender: raw.gender,
    voiceDescription: raw.voiceDescription?.trim() || undefined,
    episodes: [epIndex],
  };
}

/**
 * character-extract / character 阶段 payload 的 audioRoles 批量归一化
 * （tryAi 与 aiPatch 组装的唯一入口——689a418 的 P0 就是归一化分支只返回
 * characters 把 audioRoles 丢了;回归测试锁定此函数输出不为空）。
 */
export function normalizeExtractedAudioRoles(raw: unknown, epIndex: number): GenAudioRole[] {
  return (Array.isArray(raw) ? raw : [])
    .map((r) => normalizeExtractedAudioRole(r, epIndex))
    .filter((r): r is GenAudioRole => r !== null);
}

/** 合并音频角色：按 id（同名同 id）去重;已存在的条目合并出现集数、保留既有音频绑定。 */
export function mergeAudioRoles(
  existing: readonly GenAudioRole[],
  incoming: readonly GenAudioRole[],
): GenAudioRole[] {
  const merged = [...existing];
  for (const role of incoming) {
    const index = merged.findIndex((x) => x.id === role.id);
    if (index < 0) {
      merged.push(role);
      continue;
    }
    const prev = merged[index];
    merged[index] = {
      ...prev,
      ...Object.fromEntries(
        Object.entries(role).filter(([, value]) => value !== undefined && value !== ""),
      ),
      // 已绑定的音频/预设音色不被空值覆盖
      referenceAudioUrl: prev.referenceAudioUrl ?? role.referenceAudioUrl,
      voiceStyleId: prev.voiceStyleId ?? role.voiceStyleId,
      episodes: [...new Set([...prev.episodes, ...role.episodes])].sort((a, b) => a - b),
    };
  }
  return merged;
}

export interface AudioRoleMigrationResult {
  characters: GenCharacter[];
  audioRoles: GenAudioRole[];
  storyboardGroups: StoryboardGroup[];
  /** 是否有迁移发生（无画外音类视觉角色时 false,调用方无需写回） */
  changed: boolean;
}

/**
 * 旧项目迁移：名称/定位含画外音特征的视觉角色 → 音频角色。
 * - 保留已绑定音频（referenceAudioUrl 原样带到音频角色）;
 * - 从视觉角色列表移除（不再生成/引用其人物图）;
 * - 从分镜 group.characterIds 与 shot.characterIds 中剔除被迁移 id
 *   （它们本就不该入镜;speakerAudioRoleId 由后续归属逻辑按台词文本重新解析）;
 * - 与既有 audioRoles 按 id 去重（幂等,重复执行无副作用）。
 */
export function migrateNarrationToAudioRoles(input: {
  characters: GenCharacter[];
  audioRoles?: GenAudioRole[];
  storyboardGroups?: StoryboardGroup[];
}): AudioRoleMigrationResult {
  const existing = input.audioRoles ?? [];
  const groups = input.storyboardGroups ?? [];
  const migratedCharIds = new Set<string>();
  const migrated: GenAudioRole[] = [];
  for (const c of input.characters) {
    if (!isNarrationLikeCharacter(c)) continue;
    migratedCharIds.add(c.id);
    migrated.push(audioRoleFromCharacter(c));
  }
  if (!migrated.length) {
    return {
      characters: input.characters,
      audioRoles: existing,
      storyboardGroups: groups,
      changed: false,
    };
  }
  const audioRoles = [...existing];
  for (const role of migrated) {
    if (!audioRoles.some((x) => x.id === role.id)) audioRoles.push(role);
  }
  const characters = input.characters.filter((c) => !migratedCharIds.has(c.id));
  const storyboardGroups = groups.map((g) => ({
    ...g,
    characterIds: g.characterIds.filter((id) => !migratedCharIds.has(id)),
    shots: g.shots.map((s) =>
      s.characterIds
        ? { ...s, characterIds: s.characterIds.filter((id) => !migratedCharIds.has(id)) }
        : s,
    ),
  }));
  return { characters, audioRoles, storyboardGroups, changed: true };
}
