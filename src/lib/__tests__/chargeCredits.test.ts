import { describe, expect, it, vi } from "vitest";
import { chargeCredits } from "../userCredits.functions";

type TxLookup = { data: Array<{ id: string }> | null; error: { message: string } | null };

/** 构造带 from(user_credit_transactions) 查询链 + rpc 的 supabase mock */
function mockSupabase(opts: { lookup: TxLookup; rpcResult?: { data: unknown; error: unknown } }) {
  const rpc = vi.fn(async () => opts.rpcResult ?? { data: [{ ok: true, balance_after: 90 }], error: null });
  const limit = vi.fn(async () => opts.lookup);
  const eqDescription = vi.fn(() => ({ limit }));
  const eqUser = vi.fn(() => ({ eq: eqDescription }));
  const select = vi.fn(() => ({ eq: eqUser }));
  const from = vi.fn(() => ({ select }));
  return { supabase: { from, rpc } as never, from, rpc, eqDescription, limit };
}

const PARAMS = { amount: 5, model: "m1", description: "视频生成", idempotencyKey: "task-123" };

describe("chargeCredits 幂等（idempotencyKey）", () => {
  it("幂等键命中（RPC 返回 deduped）→ 视为成功且不重复扣费", async () => {
    const { supabase, rpc } = mockSupabase({
      lookup: { data: [], error: null },
      rpcResult: { data: [{ ok: false, balance_after: 90, deduped: true }], error: null },
    });
    const r = await chargeCredits(supabase, "u1", PARAMS);
    expect(r).toEqual({ ok: true, balanceAfter: 90, deduped: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("幂等键随 RPC 下传（库级唯一索引原子去重），description 不掺尾缀", async () => {
    const { supabase, rpc } = mockSupabase({ lookup: { data: [], error: null } });
    const r = await chargeCredits(supabase, "u1", PARAMS);
    expect(r).toEqual({ ok: true, balanceAfter: 90, deduped: false });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "deduct_user_credits",
      expect.objectContaining({
        p_description: "视频生成",
        p_idempotency_key: "task-123",
      }),
    );
  });

  it("不传幂等键 → p_idempotency_key 为 null，正常扣费", async () => {
    const { supabase, rpc } = mockSupabase({ lookup: { data: [], error: null } });
    const { idempotencyKey: _omit, ...noKey } = PARAMS;
    const r = await chargeCredits(supabase, "u1", noKey);
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "deduct_user_credits",
      expect.objectContaining({ p_idempotency_key: null }),
    );
  });

  it("不传 idempotencyKey → 不查流水表，description 原样", async () => {
    const { supabase, from, rpc } = mockSupabase({ lookup: { data: [], error: null } });
    const r = await chargeCredits(supabase, "u1", { amount: 1, description: "转绘语音转写" });
    expect(r.ok).toBe(true);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "deduct_user_credits",
      expect.objectContaining({ p_description: "转绘语音转写" }),
    );
  });
});
