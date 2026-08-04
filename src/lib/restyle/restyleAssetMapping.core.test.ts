// ====================================================================
//  restyleAssetMapping.core 测试：阶段闸门（未过不调模型/不扣费）与
//  幂等键扣费（asset-mapping:{projectId}:{scopeHash}，重跑同键去重）。
//  supabase / callChat / ensureCredits / chargeCredits 全部注入 mock。
// ====================================================================

import { describe, expect, it, vi } from "vitest";
import {
  generateAssetMappingCore,
  type AssetMappingDeps,
} from "./restyleAssetMapping.core";

vi.mock("../errorLogs.server", () => ({ logGenerationError: () => {} }));

type CallChat = NonNullable<AssetMappingDeps["callChat"]>;
type Charge = NonNullable<AssetMappingDeps["chargeCredits"]>;
type Ensure = NonNullable<AssetMappingDeps["ensureCredits"]>;

type Op = { m: string; a: unknown[] };
type Resp = { data?: unknown; error?: { message: string } | null };
type Responder = (table: string, ops: Op[], opts: { single: boolean }) => Resp;

/** 链式 supabase mock：select/eq/in/order/insert/update/delete 可任意串联，await 或 .maybeSingle() 终结。 */
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
    lt(...a: unknown[]) { return this.push("lt", a); }
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

const APPROVED_GATE = [{ node_key: "ep1", status: "user_approved" }];

function happyPathResponder(table: string, ops: Op[], opts: { single: boolean }): Resp {
  switch (table) {
    case "restyle_artifacts":
      // 闸门查询（非 single）放行；产物 upsert 查询（single）按不存在处理 → 走 insert
      return opts.single ? { data: null, error: null } : { data: APPROVED_GATE, error: null };
    case "restyle_projects":
      return { data: { id: "proj1", style_brief: "欧美真人短剧" }, error: null };
    case "restyle_episodes":
      return { data: [{ id: "ep1", episode_no: 1 }], error: null };
    case "restyle_source_assets":
      return {
        data: [
          {
            episode_id: "ep1",
            kind: "character",
            source_name: "陈炫雅",
            aliases: ["炫雅"],
            appearance: "瓜子脸",
            wardrobe: "职业装",
            description: "女主",
            uncertainty: [],
          },
        ],
        error: null,
      };
    default:
      // characters/relations/scenes/props/ignored 的 select 一律空集，mutation 一律成功
      void ops;
      return { data: [], error: null };
  }
}

const LLM_OUTPUT = JSON.stringify({
  characters: [
    {
      name: "CHLOE CARTER",
      asset_origin: { type: "source_asset_mapping", sourceAssetName: "陈炫雅" },
      description: "女主",
      clothing: "套装",
      source_description: "瓜子脸",
    },
  ],
  relations: [],
  scenes: [],
  props: [],
  ignored_assets: [],
});

const ensureOk: Ensure = async () => ({ ok: true });

function makeDeps(overrides?: { callChat?: CallChat; chargeCredits?: Charge }) {
  return {
    supabase: createMockSupabase(happyPathResponder),
    userId: "u1",
    ensureCredits: ensureOk,
    callChat:
      overrides?.callChat ??
      vi.fn<CallChat>(async () => ({
        ok: true,
        text: LLM_OUTPUT,
        model: "openai/gpt-5.6-sol",
      })),
    chargeCredits:
      overrides?.chargeCredits ?? vi.fn<Charge>(async () => ({ ok: true, balanceAfter: 9 })),
  };
}

describe("generateAssetMappingCore · 阶段闸门", () => {
  it("analysis 产物未全部 user_approved → STAGE_NOT_APPROVED，不调模型不扣费", async () => {
    const callChat = vi.fn<CallChat>();
    const chargeCredits = vi.fn<Charge>();
    const supabase = createMockSupabase((table) =>
      table === "restyle_artifacts"
        ? { data: [{ node_key: "ep1", status: "draft" }], error: null }
        : { data: [], error: null },
    );
    const result = await generateAssetMappingCore(
      { projectId: "proj1" },
      { supabase, userId: "u1", ensureCredits: ensureOk, callChat, chargeCredits },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("STAGE_NOT_APPROVED");
      expect(result.pending).toEqual(["ep1"]);
    }
    expect(callChat).not.toHaveBeenCalled();
    expect(chargeCredits).not.toHaveBeenCalled();
  });

  it("analysis 无任何产物 → 闸门同样不放行", async () => {
    const callChat = vi.fn<CallChat>();
    const supabase = createMockSupabase(() => ({ data: [], error: null }));
    const result = await generateAssetMappingCore(
      { projectId: "proj1" },
      { supabase, userId: "u1", ensureCredits: ensureOk, callChat },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("STAGE_NOT_APPROVED");
    expect(callChat).not.toHaveBeenCalled();
  });
});

describe("generateAssetMappingCore · 成功路径与幂等扣费", () => {
  it("闸门通过后调导演模型、写表、扣 1 分且幂等键为 asset-mapping:{projectId}:{scopeHash}", async () => {
    const callChat = vi.fn<CallChat>(async () => ({
      ok: true,
      text: LLM_OUTPUT,
      model: "openai/gpt-5.6-sol",
    }));
    const chargeCredits = vi.fn<Charge>(async () => ({ ok: true, balanceAfter: 9 }));
    const result = await generateAssetMappingCore(
      { projectId: "proj1" },
      makeDeps({ callChat, chargeCredits }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.counts.characters).toBe(1);
    expect(callChat).toHaveBeenCalledTimes(1);
    expect(callChat.mock.calls[0]?.[0].model).toBe("openai/gpt-5.6-sol");
    expect(chargeCredits).toHaveBeenCalledTimes(1);
    const charge = chargeCredits.mock.calls[0]?.[0];
    expect(charge?.amount).toBe(1);
    expect(charge?.idempotencyKey).toBe(`asset-mapping:proj1:${result.scopeHash}`);
    expect(charge?.idempotencyKey).toMatch(/^asset-mapping:proj1:[0-9a-f]{8}$/);
  });

  it("相同上游输入重跑 → scopeHash 相同，幂等键一致（RPC 唯一索引去重防重复扣费）", async () => {
    const first = await generateAssetMappingCore({ projectId: "proj1" }, makeDeps());
    const second = await generateAssetMappingCore({ projectId: "proj1" }, makeDeps());
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.scopeHash).toBe(second.scopeHash);
    }
  });
});
