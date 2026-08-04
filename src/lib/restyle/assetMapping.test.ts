import { describe, expect, it } from "vitest";
import {
  buildIdentityLock,
  computeAssetScopeHash,
  mapSourceToTarget,
  normalizeLlmSuggestions,
  validateCharacterBible,
  type SourceAssetInput,
} from "./assetMapping";

function charAsset(partial: Partial<SourceAssetInput> & { sourceName: string }): SourceAssetInput {
  return {
    episodeId: "ep1",
    kind: "character",
    aliases: [],
    ...partial,
  };
}

describe("buildIdentityLock", () => {
  it("含「严格保留主图脸模」关键约束与脸型/五官比例/体型骨架/发型锚定", () => {
    const lock = buildIdentityLock("CHLOE CARTER", "女性，22岁，黑色长直发");
    expect(lock).toContain("严格保留主图脸模");
    expect(lock).toContain("脸型");
    expect(lock).toContain("五官比例");
    expect(lock).toContain("体型骨架");
    expect(lock).toContain("发型");
    expect(lock).toContain("身份特征不得漂移");
    // 源描述作为身份锚点附上
    expect(lock).toContain("女性，22岁，黑色长直发");
    expect(lock).toContain("CHLOE CARTER");
  });

  it("源描述为空时不附锚点，模板句式仍完整", () => {
    const lock = buildIdentityLock("MARA EVANS");
    expect(lock).toContain("严格保留主图脸模");
    expect(lock).not.toContain("身份锚点");
  });
});

describe("mapSourceToTarget · 跨集同角色合并", () => {
  const sourceAssets: SourceAssetInput[] = [
    charAsset({ sourceName: "陈炫雅", episodeId: "ep1", appearance: "瓜子脸", aliases: ["炫雅"] }),
    charAsset({ sourceName: "陈炫雅", episodeId: "ep2", appearance: "瓜子脸" }),
    charAsset({ sourceName: "陈炫悦", episodeId: "ep2" }),
    charAsset({ sourceName: "路人甲", episodeId: "ep2" }),
    { episodeId: "ep1", kind: "scene", sourceName: "卡特家客厅", aliases: [] },
  ];

  it("同一 sourceName 跨两集只产出一个目标角色，sourceNames 归并", () => {
    const result = mapSourceToTarget(sourceAssets, {
      characters: [
        { name: "CHLOE CARTER", sourceName: "陈炫雅", description: "女主" },
        { name: "VICTORIA CARTER", sourceName: "陈炫悦" },
      ],
      ignoredAssets: [{ kind: "character", name: "路人甲", reason: "无剧情作用" }],
      scenes: [{ name: "CARTER LIVING ROOM", sourceName: "卡特家客厅" }],
    });
    expect(result.characters).toHaveLength(2);
    const chloe = result.characters.find((c) => c.name === "CHLOE CARTER")!;
    expect(chloe.sourceNames).toContain("陈炫雅");
    expect(chloe.assetOrigin).toEqual({
      type: "source_asset_mapping",
      sourceAssetName: "陈炫雅",
      sourceAssetAliases: ["炫雅"],
    });
    // 缺省 identity_lock 由 buildIdentityLock 兜底
    expect(chloe.identityLock).toContain("严格保留主图脸模");
    // 未覆盖资产进入 unmapped
    expect(result.unmappedSourceNames).toEqual([]);
  });

  it("LLM 给的 sourceAliases 把多个原片人物合并为同一目标角色", () => {
    const result = mapSourceToTarget(sourceAssets, {
      characters: [
        { name: "HAILEY MORGAN", sourceName: "陈炫雅", sourceAliases: ["炫雅"] },
      ],
    });
    const hailey = result.characters[0];
    expect(hailey.sourceNames).toEqual(["陈炫雅", "炫雅"]);
    expect(hailey.assetOrigin.sourceAssetAliases).toEqual(["炫雅"]);
    // 只映射了一个，其余源角色未覆盖
    expect(result.unmappedSourceNames).toContain("陈炫悦");
  });

  it("同一目标名重复建议去重合并；identity_lock 优先用 LLM 版本", () => {
    const result = mapSourceToTarget(sourceAssets, {
      characters: [
        { name: "CHLOE", sourceName: "陈炫雅", identityLock: "自定义锁定句" },
        { name: "chloe", sourceName: "炫雅" },
      ],
    });
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].identityLock).toBe("自定义锁定句");
    expect(result.characters[0].sourceNames).toContain("炫雅");
  });
});

describe("validateCharacterBible · 关系表闭合", () => {
  const characters = [{ name: "A" }, { name: "B" }];

  it("缺反向边 → missing_reverse", () => {
    const issues = validateCharacterBible(characters, [
      { character: "A", related: "B", relation: "雇主" },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("missing_reverse");
    expect(issues[0].character).toBe("A");
    expect(issues[0].related).toBe("B");
  });

  it("自指 → self", () => {
    const issues = validateCharacterBible(characters, [
      { character: "A", related: "A", relation: "自己" },
    ]);
    expect(issues.map((i) => i.type)).toEqual(["self"]);
  });

  it("悬空（指向不存在角色）→ dangling", () => {
    const issues = validateCharacterBible(characters, [
      { character: "A", related: "GHOST", relation: "敌对" },
    ]);
    expect(issues.map((i) => i.type)).toEqual(["dangling"]);
  });

  it("成对闭合的关系表无问题", () => {
    const issues = validateCharacterBible(characters, [
      { character: "A", related: "B", relation: "雇主" },
      { character: "B", related: "A", relation: "雇员" },
    ]);
    expect(issues).toEqual([]);
  });
});

describe("normalizeLlmSuggestions", () => {
  it("兼容 snake_case 字段（identity_lock / source_description / asset_origin / ignored_assets）", () => {
    const suggestions = normalizeLlmSuggestions({
      characters: [
        {
          name: "CHLOE CARTER",
          asset_origin: { type: "source_asset_mapping", sourceAssetName: "陈炫雅" },
          identity_lock: "锁定句",
          source_description: "源描述",
          clothing: "套装",
        },
        { name: "缺 sourceName 的坏条目" },
      ],
      ignored_assets: [{ kind: "prop", name: "手机", reason: "功能性道具" }],
    });
    expect(suggestions.characters).toHaveLength(1);
    expect(suggestions.characters![0]).toMatchObject({
      name: "CHLOE CARTER",
      sourceName: "陈炫雅",
      identityLock: "锁定句",
      sourceDescription: "源描述",
    });
    expect(suggestions.ignoredAssets).toEqual([
      { kind: "prop", name: "手机", reason: "功能性道具" },
    ]);
  });
});

describe("computeAssetScopeHash", () => {
  it("同一输入（字段顺序无关）恒得同一 hash", () => {
    const a = computeAssetScopeHash({ projectId: "p1", assets: ["甲", "乙"] });
    const b = computeAssetScopeHash({ assets: ["甲", "乙"], projectId: "p1" });
    const c = computeAssetScopeHash({ projectId: "p1", assets: ["甲", "丙"] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });
});
