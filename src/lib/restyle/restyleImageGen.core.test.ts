// ====================================================================
//  restyleImageGen.core 测试：
//   - normalizeLookPlan 解析（兼容竞品样本 character_wardrobe / snake_case）
//   - 提示词组装含 identity_lock 与 styleBrief；复用 look 不生图
//   - 音色重要度排序（分镜数 → 分组数，阈值判重点）
//   - 确认闸门：提示词产物未 user_approved 时禁止真实生图（不调生图/不扣费）
//   - 生图成功按张扣费，幂等键 img:{projectId}:{characterId}:{lookId}:{scopeHash}
//  supabase / generateImage / ensureCredits / chargeCredits 全部注入 mock。
// ====================================================================

import { describe, expect, it, vi } from "vitest";
import {
  buildCharacterMainPrompt,
  buildImagePromptPlan,
  fillLookNames,
  generateCharacterImagesCore,
  imageIdempotencyKey,
  normalizeLookPlan,
  planImagePromptsCore,
  rankCharacterImportance,
  type ImageGenDeps,
  type ImagePromptItem,
} from "./restyleImageGen.core";

vi.mock("../errorLogs.server", () => ({ logGenerationError: () => {} }));

type Charge = NonNullable<ImageGenDeps["chargeCredits"]>;
type Ensure = NonNullable<ImageGenDeps["ensureCredits"]>;
type GenerateImage = NonNullable<ImageGenDeps["generateImage"]>;

type Op = { m: string; a: unknown[] };
type Resp = { data?: unknown; error?: { message: string } | null };
type Responder = (table: string, ops: Op[], opts: { single: boolean }) => Resp;

/** 链式 supabase mock（与 restyleAssetMapping.core.test.ts 同款）。 */
function createMockSupabase(respond: Responder) {
  class MockQuery {
    constructor(
      private table: string,
      private ops: Op[] = [],
    ) {}
    private push(m: string, a: unknown[]) {
      return new MockQuery(this.table, [...this.ops, { m, a }]);
    }
    select(...a: unknown[]) { return this.push("select", a); }
    eq(...a: unknown[]) { return this.push("eq", a); }
    in(...a: unknown[]) { return this.push("in", a); }
    order(...a: unknown[]) { return this.push("order", a); }
    insert(a: unknown) { return this.push("insert", [a]); }
    update(a: unknown) { return this.push("update", [a]); }
    delete() { return this.push("delete", []); }
    private exec(single: boolean): Promise<Resp> {
      return Promise.resolve(respond(this.table, this.ops, { single }));
    }
    async maybeSingle() {
      const resp = await this.exec(true);
      const data = Array.isArray(resp.data) ? (resp.data[0] ?? null) : (resp.data ?? null);
      return { data, error: resp.error ?? null };
    }
    async single() {
      return this.maybeSingle();
    }
    then<TResult1 = Resp, TResult2 = never>(
      onfulfilled?: ((value: Resp) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return this.exec(false).then(onfulfilled, onrejected);
    }
  }
  return { from: (table: string) => new MockQuery(table) };
}

function artifactRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "art_1",
    status: "user_approved",
    content: null,
    user_content: null,
    scope_hash: "deadbeef",
    revision: 1,
    verdict: null,
    issues: [],
    ...overrides,
  };
}

const okEnsure: Ensure = async () => ({ ok: true });

// --------------------------------------------------------------------
// 纯函数
// --------------------------------------------------------------------

describe("normalizeLookPlan", () => {
  it("解析竞品样本形态（character_wardrobe + snake_case + name 即角色名）", () => {
    const sample = {
      character_wardrobe: [
        {
          name: "MARA EVANS",
          from_sc: "EP01_SC01",
          to_sc: "EP01_SC29",
          redesign_reason: "现实线需要职业装",
          reuse_existing: false,
          reuse_source: "",
          full_body_front: "浅蓝色修身女式西装外套",
          full_body_back: "背面剪裁贴身",
          full_body_side: "侧面保持职场轮廓",
        },
      ],
    };
    const entries = fillLookNames(normalizeLookPlan(sample));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      character: "MARA EVANS",
      name: "造型 1",
      fromShot: "EP01_SC01",
      toShot: "EP01_SC29",
      redesignReason: "现实线需要职业装",
      reuseExisting: false,
      fullBodyFront: "浅蓝色修身女式西装外套",
      fullBodyBack: "背面剪裁贴身",
      fullBodySide: "侧面保持职场轮廓",
    });
  });

  it("解析 { looks: [...] } camelCase 形态并丢弃缺角色条目", () => {
    const entries = normalizeLookPlan({
      looks: [
        {
          character: "VICTORIA CARTER",
          look: "校服",
          fromShot: "EP01_SC30",
          toShot: "EP01_SC42",
          redesignReason: "回忆线",
          reuseExisting: true,
          reuseSource: "EP03_SC13-EP03_SC35",
        },
        { name: "缺角色" },
      ],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      character: "VICTORIA CARTER",
      name: "校服",
      reuseExisting: true,
      reuseSource: "EP03_SC13-EP03_SC35",
    });
  });
});

describe("prompt 组装", () => {
  const character = {
    id: "char1",
    name: "MARA EVANS",
    identityLock: "浅棕色中分长直发、苍白肤色、单薄纤细体型，严格保留主图脸模",
    description: "年轻职场女性",
    clothing: "浅蓝职业装",
  };
  const styleBrief = "日系赛璐璐、线条干净";

  it("主图提示词包含 identity_lock 与 styleBrief", () => {
    const prompt = buildCharacterMainPrompt(character, styleBrief);
    expect(prompt).toContain(character.identityLock);
    expect(prompt).toContain(styleBrief);
    expect(prompt).toContain("【身份锁定·不得改变】");
    expect(prompt).toContain("【目标画风·必须严格遵守】");
  });

  it("提示词列表：每角色主图+三视图，非复用 look 主图+正/背/侧，复用 look 跳过", () => {
    const items = buildImagePromptPlan(
      [character],
      [
        {
          id: "look1",
          characterId: "char1",
          character: "MARA EVANS",
          name: "职业装",
          fromShot: "EP01_SC01",
          toShot: "EP01_SC29",
          redesignReason: "现实线",
          reuseExisting: false,
          reuseSource: "",
          fullBodyFront: "正面职业装",
          fullBodyBack: "背面职业装",
          fullBodySide: "侧面职业装",
          identityNote: "发型体型不变",
        },
        {
          id: "look2",
          characterId: "char1",
          character: "MARA EVANS",
          name: "职业装复用",
          fromShot: "EP01_SC45",
          toShot: "EP01_SC49",
          redesignReason: "承接现实线",
          reuseExisting: true,
          reuseSource: "EP01_SC01-EP01_SC29",
          fullBodyFront: "",
          fullBodyBack: "",
          fullBodySide: "",
          identityNote: "",
        },
      ],
      styleBrief,
    );
    // 2（角色主图+三视图）+ 4（look1 主图/正/背/侧），look2 复用不生图
    expect(items).toHaveLength(6);
    expect(items.filter((item) => item.lookId === "look2")).toHaveLength(0);
    const lookBack = items.find((item) => item.scope === "look_back");
    expect(lookBack?.prompt).toContain("背面职业装");
    expect(lookBack?.prompt).toContain(character.identityLock);
    expect(lookBack?.prompt).toContain(styleBrief);
  });
});

describe("rankCharacterImportance", () => {
  it("按分镜数 → 分组数 → 名称排序，分镜数 ≥ 10 判重点", () => {
    const ranked = rankCharacterImportance([
      { characterId: "a", name: "ALPHA", shotCount: 7, groupCount: 3 },
      { characterId: "b", name: "BETA", shotCount: 170, groupCount: 64 },
      { characterId: "c", name: "GAMMA", shotCount: 10, groupCount: 4 },
      { characterId: "d", name: "DELTA", shotCount: 10, groupCount: 2 },
    ]);
    expect(ranked.map((r) => r.name)).toEqual(["BETA", "GAMMA", "DELTA", "ALPHA"]);
    expect(ranked.map((r) => r.importanceRank)).toEqual([1, 2, 3, 4]);
    expect(ranked.map((r) => r.tier)).toEqual(["重点", "重点", "重点", "次要"]);
  });
});

// --------------------------------------------------------------------
// 确认闸门与扣费
// --------------------------------------------------------------------

function makeGenerateDeps(overrides: {
  promptsRow: Record<string, unknown> | null;
  generateImage?: GenerateImage;
  chargeCredits?: Charge;
  updates?: Array<{ table: string; payload: Record<string, unknown>; id: unknown }>;
}): ImageGenDeps {
  const updates = overrides.updates ?? [];
  const supabase = createMockSupabase((table, ops, { single }) => {
    if (table === "restyle_artifacts" && !single) {
      // 阶段闸门：asset_mapping 全部已确认
      return { data: [{ node_key: "project", status: "user_approved" }] };
    }
    if (table === "restyle_artifacts" && single) {
      return { data: overrides.promptsRow };
    }
    if (
      (table === "restyle_characters" || table === "restyle_character_looks") &&
      ops.some((op) => op.m === "update")
    ) {
      const updateOp = ops.find((op) => op.m === "update")!;
      const eqOp = ops.find((op) => op.m === "eq")!;
      updates.push({ table, payload: updateOp.a[0] as Record<string, unknown>, id: eqOp.a[1] });
      return { data: null };
    }
    return { data: null };
  });
  return {
    supabase,
    userId: "user1",
    ensureCredits: okEnsure,
    generateImage: overrides.generateImage,
    chargeCredits: overrides.chargeCredits,
    imageCostFn: () => 3,
  };
}

const PROMPT_ITEMS: ImagePromptItem[] = [
  {
    scope: "character_main",
    characterId: "char1",
    characterName: "MARA EVANS",
    lookId: null,
    lookName: null,
    prompt: "主图提示词",
  },
  {
    scope: "look_main",
    characterId: "char1",
    characterName: "MARA EVANS",
    lookId: "look1",
    lookName: "职业装",
    prompt: "造型主图提示词",
  },
];

describe("generateCharacterImagesCore 确认闸门", () => {
  it("提示词产物未 user_approved：STAGE_NOT_APPROVED，不调生图、不扣费", async () => {
    const generateImage = vi.fn<GenerateImage>();
    const chargeCredits = vi.fn<Charge>();
    const deps = makeGenerateDeps({
      promptsRow: artifactRow({ status: "draft", content: { items: PROMPT_ITEMS } }),
      generateImage,
      chargeCredits,
    });
    const result = await generateCharacterImagesCore({ projectId: "proj1" }, deps);
    expect(result).toMatchObject({ ok: false, code: "STAGE_NOT_APPROVED" });
    expect(generateImage).not.toHaveBeenCalled();
    expect(chargeCredits).not.toHaveBeenCalled();
  });

  it("提示词产物不存在：同样拦截", async () => {
    const generateImage = vi.fn<GenerateImage>();
    const deps = makeGenerateDeps({ promptsRow: null, generateImage });
    const result = await generateCharacterImagesCore({ projectId: "proj1" }, deps);
    expect(result).toMatchObject({ ok: false, code: "STAGE_NOT_APPROVED" });
    expect(generateImage).not.toHaveBeenCalled();
  });
});

describe("generateCharacterImagesCore 成功路径", () => {
  it("按确认的提示词逐张生图、写库、按张扣费（幂等键格式）", async () => {
    const generateImage = vi.fn<GenerateImage>(async () => ({
      url: "https://img.example/1.png",
      error: null,
      model: "doubao-seedream-5-0-260128",
    }));
    const chargeCredits = vi.fn<Charge>(async () => ({ ok: true, balanceAfter: 97 }));
    const updates: Array<{ table: string; payload: Record<string, unknown>; id: unknown }> = [];
    const deps = makeGenerateDeps({
      promptsRow: artifactRow({ content: { version: 1, items: PROMPT_ITEMS } }),
      generateImage,
      chargeCredits,
      updates,
    });
    const result = await generateCharacterImagesCore({ projectId: "proj1" }, deps);
    expect(result).toMatchObject({ ok: true, total: 2, generated: 2, chargedCredits: 6 });
    expect(generateImage).toHaveBeenCalledTimes(2);

    // 写库：角色主图 → characters.main_image_url；造型主图 → looks.image_url
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({
      table: "restyle_characters",
      id: "char1",
      payload: { main_image_url: "https://img.example/1.png" },
    });
    expect(updates[1]).toMatchObject({
      table: "restyle_character_looks",
      id: "look1",
      payload: { image_url: "https://img.example/1.png" },
    });

    // 扣费：img:{projectId}:{characterId}:{lookId}:{scopeHash}
    expect(chargeCredits).toHaveBeenCalledTimes(2);
    const keys = chargeCredits.mock.calls.map((call) => call[0].idempotencyKey ?? "");
    expect(keys[0]).toMatch(/^img:proj1:char1:character:[0-9a-f]{8}$/);
    expect(keys[1]).toMatch(/^img:proj1:char1:look1:[0-9a-f]{8}$/);
    expect(chargeCredits.mock.calls[0][0].amount).toBe(3);
    // 与 imageIdempotencyKey 纯函数口径一致
    expect(keys[0]).toBe(
      imageIdempotencyKey("proj1", "char1", null, keys[0]!.split(":").pop()!),
    );
  });

  it("生图失败写 failures 并继续后续张，失败张不扣费", async () => {
    let call = 0;
    const generateImage = vi.fn<GenerateImage>(async () => {
      call += 1;
      return call === 1
        ? { url: "", error: "网关超时", model: "doubao-seedream-5-0-260128" }
        : { url: "https://img.example/2.png", error: null, model: "doubao-seedream-5-0-260128" };
    });
    const chargeCredits = vi.fn<Charge>(async () => ({ ok: true, balanceAfter: 97 }));
    const deps = makeGenerateDeps({
      promptsRow: artifactRow({ content: { version: 1, items: PROMPT_ITEMS } }),
      generateImage,
      chargeCredits,
    });
    const result = await generateCharacterImagesCore({ projectId: "proj1" }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.generated).toBe(1);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toMatchObject({ scope: "character_main", error: "网关超时" });
    }
    expect(chargeCredits).toHaveBeenCalledTimes(1);
  });
});

describe("planImagePromptsCore 闸门", () => {
  it("换装方案未确认：STAGE_NOT_APPROVED，不产出提示词产物", async () => {
    const inserted: unknown[] = [];
    const supabase = createMockSupabase((table, ops, { single }) => {
      if (table === "restyle_artifacts" && single) {
        return { data: artifactRow({ status: "draft" }) };
      }
      if (table === "restyle_artifacts" && ops.some((op) => op.m === "insert")) {
        inserted.push(ops.find((op) => op.m === "insert")!.a[0]);
        return { data: null };
      }
      return { data: null };
    });
    const result = await planImagePromptsCore(
      { projectId: "proj1" },
      { supabase, userId: "user1" },
    );
    expect(result).toMatchObject({ ok: false, code: "STAGE_NOT_APPROVED" });
    expect(inserted).toHaveLength(0);
  });
});
