// ====================================================================
// voiceCasting 纯函数测试（同一角色跨分镜音色一致修复）
// ====================================================================
import { describe, expect, it } from "vitest";
import {
  ageToVoiceAgeGroup,
  attributeShotSpeaker,
  buildVoiceCastingBlock,
  matchVoiceStyle,
  normalizeGender,
  pickDefaultVoiceCandidate,
  voiceStyleByAudioUrl,
} from "../voiceCasting";

describe("pickDefaultVoiceCandidate（确认卡默认锁定）", () => {
  const candidates = [
    { characterId: "a", characterName: "林晚", audioUrl: "https://u/a.mp3" },
    { characterId: "b", characterName: "陆深", audioUrl: "https://u/b.mp3" },
  ];

  it("无候选 → undefined；单候选 → 直接锁定", () => {
    expect(pickDefaultVoiceCandidate([], [])).toBeUndefined();
    expect(pickDefaultVoiceCandidate([candidates[0]], [])).toBe(candidates[0]);
  });

  it("多候选选台词量最多者（按其出现的带台词 shot 字数累计）", () => {
    const shots = [
      { characterIds: ["a"], dialogue: "短句。" },
      { characterIds: ["b"], dialogue: "这是一段明显更长的台词，包含更多字数。" },
      { characterIds: ["a", "b"], dialogue: "同台。" },
    ];
    expect(pickDefaultVoiceCandidate(candidates, shots)?.characterId).toBe("b");
  });

  it("台词量并列 → 候选顺序靠前者；无台词 shot 不计入", () => {
    const shots = [
      { characterIds: ["a"], dialogue: "四个字台词" },
      { characterIds: ["b"], dialogue: "也是四个字" },
      { characterIds: ["b"], dialogue: "" },
    ];
    expect(pickDefaultVoiceCandidate(candidates, shots)?.characterId).toBe("a");
  });
});

describe("attributeShotSpeaker（逐镜台词归属）", () => {
  const characters = [
    { id: "a", name: "林晚" },
    { id: "b", name: "陆深" },
  ];

  it("台词文本点名角色 → 该角色", () => {
    expect(
      attributeShotSpeaker(
        { characterIds: ["a", "b"], dialogue: "陆深：你终于来了。" },
        characters,
        "a",
      ),
    ).toBe("b");
  });

  it("单角色 shot → 该角色；多角色未点名 → 兜底主角色", () => {
    expect(attributeShotSpeaker({ characterIds: ["a"], dialogue: "你好。" }, characters, "b")).toBe(
      "a",
    );
    expect(
      attributeShotSpeaker({ characterIds: ["a", "b"], dialogue: "你好。" }, characters, "a"),
    ).toBe("a");
  });

  it("无台词 → undefined", () => {
    expect(attributeShotSpeaker({ characterIds: ["a"], dialogue: "  " }, characters, "a")).toBeUndefined();
    expect(attributeShotSpeaker({ characterIds: ["a"] }, characters, "a")).toBeUndefined();
  });
});

describe("buildVoiceCastingBlock", () => {
  it("逐说话角色给年龄/性别/描述/参考音色,并含一致性硬要求", () => {
    const block = buildVoiceCastingBlock([
      {
        characterId: "n",
        name: "旁白·苍老声音",
        age: 65,
        gender: "男",
        roleLabel: "沉稳苍老的男性叙述者",
        voiceStyleName: "浑厚男声",
      },
    ]);
    expect(block).toContain("[VOICE CASTING — KEEP CONSISTENT]");
    expect(block).toContain("旁白·苍老声音：65岁，男，沉稳苍老的男性叙述者；参考音色「浑厚男声」");
    expect(block).toContain("same voice, pacing and tone");
  });

  it("无说话角色 → 空串（调用方不拼该块）", () => {
    expect(buildVoiceCastingBlock([])).toBe("");
  });
});

describe("matchVoiceStyle（未绑定音色的自动匹配）", () => {
  it("年龄段边界", () => {
    expect(ageToVoiceAgeGroup(10)).toBe("junior");
    expect(ageToVoiceAgeGroup(20)).toBe("young");
    expect(ageToVoiceAgeGroup(40)).toBe("adult");
    expect(ageToVoiceAgeGroup(65)).toBe("senior");
    expect(ageToVoiceAgeGroup(undefined)).toBe("adult");
  });

  it("性别归一", () => {
    expect(normalizeGender("女")).toBe("female");
    expect(normalizeGender("male")).toBe("male");
    expect(normalizeGender("")).toBeUndefined();
  });

  it("老年男性 → 浑厚男声（senior male）；年轻女性 → 活泼少女", () => {
    expect(matchVoiceStyle({ age: 65, gender: "男" }).id).toBe("yunjian");
    expect(matchVoiceStyle({ age: 19, gender: "女" }).id).toBe("xiaoyi");
  });

  it("性别优先于年龄贴近（成年女性不会配到男声）", () => {
    const style = matchVoiceStyle({ age: 40, gender: "female" });
    expect(style.gender).toBe("female");
    expect(style.id).toBe("xiaoxiao");
  });

  it("性别未知按年龄段取最近", () => {
    expect(matchVoiceStyle({ age: 12 }).ageGroup).toBe("junior");
    expect(matchVoiceStyle({ age: 60 }).ageGroup).toBe("senior");
  });
});

describe("voiceStyleByAudioUrl", () => {
  it("按绑定 URL 反查预设音色名", () => {
    expect(voiceStyleByAudioUrl("/voice-styles/yunyang.mp3")?.name).toBe("专业男声");
    expect(voiceStyleByAudioUrl("https://signed.example.com/custom.mp3")).toBeUndefined();
    expect(voiceStyleByAudioUrl(undefined)).toBeUndefined();
  });
});
