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
  it("流水表已有同 key 记录 → 跳过扣费，不调 RPC", async () => {
    const { supabase, rpc } = mockSupabase({ lookup: { data: [{ id: "tx1" }], error: null } });
    const r = await chargeCredits(supabase, "u1", PARAMS);
    expect(r).toEqual({ ok: true, balanceAfter: null, deduped: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("无同 key 记录 → 正常扣费，description 带幂等键尾缀", async () => {
    const { supabase, rpc, eqDescription } = mockSupabase({ lookup: { data: [], error: null } });
    const r = await chargeCredits(supabase, "u1", PARAMS);
    expect(r).toEqual({ ok: true, balanceAfter: 90 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "deduct_user_credits",
      expect.objectContaining({ p_description: "视频生成 [ref:task-123]" }),
    );
    // 查重与写入用同一 description 口径
    expect(eqDescription).toHaveBeenCalledWith("description", "视频生成 [ref:task-123]");
  });

  it("查重失败 → 继续扣费（不静默漏扣）", async () => {
    const { supabase, rpc } = mockSupabase({
      lookup: { data: null, error: { message: "rls denied" } },
    });
    const r = await chargeCredits(supabase, "u1", PARAMS);
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
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
