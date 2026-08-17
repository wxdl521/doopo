// ====================================================================
// audioRoles 迁移/分类 + 画外音隔离 回归测试（规格 §6 逐条）
// ====================================================================
import { describe, expect, it } from "vitest";
import type { GenCharacter, StoryboardGroup } from "../../data/workspaceGenerators";
import {
  audioRoleFromCharacter,
  inferAudioRoleKind,
  isNarrationLikeCharacter,
  mergeAudioRoles,
  migrateNarrationToAudioRoles,
  normalizeExtractedAudioRole,
} from "../audioRoles";
import { sanitizeSpeakerAudioRoleId } from "../storyboard.functions";
import { attributeShotSpeaker, buildOffscreenVoiceConstraint } from "../voiceCasting";

const visualChar = (overrides: Partial<GenCharacter>): GenCharacter =>
  ({
    id: "ch-1",
    name: "林晚",
    role: "lead",
    roleLabel: "女主角",
    age: 25,
    gender: "女",
    episodes: [1],
    matchKey: "林晚-a1b",
    ...overrides,
  }) as GenCharacter;

describe("提取分类（规格 §6-1：画外音归音频角色而非视觉人物卡）", () => {
  it("「旁白/画外音/讲述者/OS」类名称识别为音频角色", () => {
    expect(isNarrationLikeCharacter({ name: "旁白·苍老声音" })).toBe(true);
    expect(isNarrationLikeCharacter({ name: "苍老男声画外音" })).toBe(true);
    expect(isNarrationLikeCharacter({ name: "讲述者" })).toBe(true);
    expect(isNarrationLikeCharacter({ name: "林晚", roleLabel: "OS 内心独白" })).toBe(true);
    expect(isNarrationLikeCharacter({ name: "林晚", roleLabel: "女主角" })).toBe(false);
  });

  it("提取结果归一化：kind 收敛 + id 由名称派生 + 集数打上", () => {
    const role = normalizeExtractedAudioRole(
      { name: "旁白·苍老声音", kind: "voiceover", age: 65, gender: "男", voiceDescription: "沉稳苍老" },
      2,
    );
    expect(role).toMatchObject({
      id: "audio-旁白·苍老声音",
      kind: "voiceover",
      episodes: [2],
    });
    // kind 非法值收敛 narrator;无名称丢弃
    expect(normalizeExtractedAudioRole({ name: "X", kind: "weird" }, 1)?.kind).toBe("narrator");
    expect(normalizeExtractedAudioRole({ name: " " }, 1)).toBeNull();
    expect(inferAudioRoleKind({ name: "内心独白" })).toBe("inner_monologue");
  });
});

describe("分镜隔离（规格 §6-2：speakerAudioRoleId 校验）", () => {
  it("仅保留有效音频角色 id；视觉角色 id / 无效值丢弃", () => {
    const valid = new Set(["audio-1"]);
    expect(sanitizeSpeakerAudioRoleId("audio-1", valid)).toBe("audio-1");
    expect(sanitizeSpeakerAudioRoleId("ch-1", valid)).toBeUndefined();
    expect(sanitizeSpeakerAudioRoleId(123, valid)).toBeUndefined();
    expect(sanitizeSpeakerAudioRoleId(undefined, valid)).toBeUndefined();
  });

  it("逐镜台词归属：speakerAudioRoleId 优先于镜头人物推断", () => {
    expect(
      attributeShotSpeaker(
        { characterIds: ["ch-1"], dialogue: "荒原上寂静无声。", speakerAudioRoleId: "audio-1" },
        [{ id: "ch-1", name: "林晚" }],
        "ch-1",
      ),
    ).toBe("audio-1");
  });
});

describe("旧项目迁移（规格 §6-5）", () => {
  const groups: StoryboardGroup[] = [
    {
      episodeIndex: 1,
      id: "g1",
      index: 1,
      plotText: "p",
      startSec: 0,
      endSec: 5,
      characterIds: ["ch-1", "ch-narr"],
      shots: [
        {
          id: "s1",
          shotType: "WS",
          shotTypeLabel: "远景",
          action: "荒原",
          camera: "固定",
          characterIds: ["ch-narr"],
          dialogue: "旁白：很久很久以前。",
        },
      ],
    } as StoryboardGroup,
  ];

  it("「旁白·苍老声音」卡迁移为音频角色并保留参考音频;视觉列表与分镜引用移除", () => {
    const narrator = visualChar({
      id: "ch-narr",
      name: "旁白·苍老声音",
      roleLabel: "旁白",
      age: 65,
      gender: "男",
      referenceAudioUrl: "/voice-styles/yunjian.mp3",
    });
    const result = migrateNarrationToAudioRoles({
      characters: [visualChar({}), narrator],
      storyboardGroups: groups,
    });
    expect(result.changed).toBe(true);
    // 视觉角色列表只剩真人
    expect(result.characters.map((c) => c.id)).toEqual(["ch-1"]);
    // 音频角色保留已绑定音频
    const role = result.audioRoles.find((r) => r.id === "audio-ch-narr");
    expect(role).toMatchObject({
      name: "旁白·苍老声音",
      kind: "narrator",
      age: 65,
      referenceAudioUrl: "/voice-styles/yunjian.mp3",
    });
    // 分镜画面引用里的旧 id 被剔除(人物图不再用于新分镜/视频)
    expect(result.storyboardGroups[0].characterIds).toEqual(["ch-1"]);
    expect(result.storyboardGroups[0].shots[0].characterIds).toEqual([]);
  });

  it("无画外音角色时 changed=false（原样返回）;重复执行幂等", () => {
    const clean = migrateNarrationToAudioRoles({ characters: [visualChar({})] });
    expect(clean.changed).toBe(false);
    const narrator = visualChar({ id: "ch-n", name: "旁白" });
    const once = migrateNarrationToAudioRoles({ characters: [narrator] });
    const twice = migrateNarrationToAudioRoles({
      characters: once.characters,
      audioRoles: once.audioRoles,
    });
    expect(twice.changed).toBe(false);
    expect(twice.audioRoles).toHaveLength(1);
  });
});

describe("音色持久化（规格 §6-4：合并不丢绑定）", () => {
  it("mergeAudioRoles：同名合并保留既有音频绑定并累计集数", () => {
    const existing = [
      {
        id: "audio-旁白",
        name: "旁白",
        kind: "narrator" as const,
        referenceAudioUrl: "/voice-styles/yunyang.mp3",
        voiceStyleId: "yunyang",
        episodes: [1],
      },
    ];
    const merged = mergeAudioRoles(existing, [
      { id: "audio-旁白", name: "旁白", kind: "narrator", episodes: [2], voiceDescription: "新描述" },
      { id: "audio-心声", name: "心声", kind: "inner_monologue", episodes: [2] },
    ]);
    expect(merged).toHaveLength(2);
    // 已有绑定不被空值覆盖;集数累计;描述可被新值刷新
    expect(merged[0]).toMatchObject({
      referenceAudioUrl: "/voice-styles/yunyang.mp3",
      voiceStyleId: "yunyang",
      episodes: [1, 2],
      voiceDescription: "新描述",
    });
  });
});

describe("提示词硬约束（规格 §6-6）", () => {
  it("含画外音的请求带「仅声音、绝不视觉出现」硬约束", () => {
    const block = buildOffscreenVoiceConstraint(["旁白·苍老声音"]);
    expect(block).toContain("[OFF-SCREEN VOICE — NEVER ON SCREEN]");
    expect(block).toContain("旁白·苍老声音");
    expect(block).toContain("MUST NEVER APPEAR VISUALLY");
    expect(buildOffscreenVoiceConstraint([])).toBe("");
  });
});

describe("audioRoleFromCharacter 类型推断", () => {
  it("旁白/画外音/内心独白分别映射 narrator/voiceover/inner_monologue", () => {
    expect(audioRoleFromCharacter(visualChar({ name: "旁白" })).kind).toBe("narrator");
    expect(audioRoleFromCharacter(visualChar({ name: "电话外画外音" })).kind).toBe("voiceover");
    expect(audioRoleFromCharacter(visualChar({ name: "林晚心声" })).kind).toBe("inner_monologue");
  });
});
