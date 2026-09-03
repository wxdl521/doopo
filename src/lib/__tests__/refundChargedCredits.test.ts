import { describe, expect, it, vi } from "vitest";
import { executeRefundChargedCredits, readOrInitWalletBalance } from "../userCredits.functions";

function rpcMissing() {
  return {
    data: null,
    error: { message: "Could not find the function public.refund_user_credits_by_key" },
  };
}

describe("executeRefundChargedCredits", () => {
  it("优先走 RPC，金额由服务端决定", async () => {
    const supabase = {
      rpc: vi.fn(async () => ({
        data: [{ ok: true, refunded: true, reason: "refunded", amount: 12, balance_after: 88 }],
        error: null,
      })),
    };
    const supabaseAdmin = { from: vi.fn() };
    const r = await executeRefundChargedCredits({
      supabase,
      supabaseAdmin,
      userId: "u1",
      chargeIdempotencyKey: "win-1",
      description: "退款",
    });
    expect(r).toEqual({ ok: true, refunded: true, reason: "refunded" });
    expect(supabase.rpc).toHaveBeenCalledWith("refund_user_credits_by_key", {
      p_charge_idempotency_key: "win-1",
      p_description: "退款",
    });
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("RPC 返回 no_charge / deduped", async () => {
    const supabase = {
      rpc: vi.fn(async () => ({
        data: [{ ok: true, refunded: false, reason: "no_charge", amount: 0, balance_after: null }],
        error: null,
      })),
    };
    const r = await executeRefundChargedCredits({
      supabase,
      supabaseAdmin: { from: vi.fn() },
      userId: "u1",
      chargeIdempotencyKey: "missing",
      description: "退款",
    });
    expect(r).toEqual({ ok: true, refunded: false, reason: "no_charge" });
  });

  it("RPC 未落地时降级：退款额取 consume 流水绝对值，忽略调用方金额", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const upsert = vi.fn(async () => ({ error: null }));
    const maybeSingleCharge = vi.fn(async () => ({
      data: { id: "tx1", amount: -12.5 },
      error: null,
    }));
    const maybeSingleWallet = vi.fn(async () => ({
      data: { credits_balance: 10 },
      error: null,
    }));

    let fromCalls = 0;
    const supabaseAdmin = {
      from: vi.fn(() => {
        fromCalls += 1;
        if (fromCalls === 1) {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({ maybeSingle: maybeSingleCharge }),
                }),
              }),
            }),
          };
        }
        if (fromCalls === 2) {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: maybeSingleWallet }),
            }),
          };
        }
        return { insert, upsert };
      }),
    };

    const r = await executeRefundChargedCredits({
      supabase: { rpc: vi.fn(async () => rpcMissing()) },
      supabaseAdmin,
      userId: "u1",
      chargeIdempotencyKey: "win-1",
      description: "分窗退款",
    });
    expect(r).toEqual({ ok: true, refunded: true, reason: "refunded" });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 12.5,
        type: "refund",
        idempotency_key: "refund:win-1",
        balance_after: 22.5,
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", credits_balance: 22.5 }),
      { onConflict: "user_id" },
    );
  });

  it("降级路径无 consume 记录 → no_charge，不改钱包", async () => {
    const supabaseAdmin = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: vi.fn(async () => ({ data: null, error: null })),
              }),
            }),
          }),
        }),
        insert: vi.fn(),
        upsert: vi.fn(),
      })),
    };
    const r = await executeRefundChargedCredits({
      supabase: { rpc: vi.fn(async () => rpcMissing()) },
      supabaseAdmin,
      userId: "u1",
      chargeIdempotencyKey: "win-x",
      description: "退款",
    });
    expect(r).toEqual({ ok: true, refunded: false, reason: "no_charge" });
  });
});

describe("readOrInitWalletBalance", () => {
  it("RPC 成功则直接返回余额，不 insert", async () => {
    const supabase = {
      rpc: vi.fn(async () => ({ data: 42, error: null })),
      from: vi.fn(),
    };
    await expect(readOrInitWalletBalance(supabase, "u1")).resolves.toBe(42);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
