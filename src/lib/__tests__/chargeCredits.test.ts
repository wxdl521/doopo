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

describe("chargeCredits 项目维度（2026/08 project_name）", () => {
  it("传 projectId/projectName → 新签名 RPC 参数下传", async () => {
    const { supabase, rpc } = mockSupabase({ lookup: { data: [], error: null } });
    const r = await chargeCredits(supabase, "u1", {
      ...PARAMS,
      projectId: "proj-1",
      projectName: "未命名转绘项目 3",
    });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "deduct_user_credits",
      expect.objectContaining({
        p_project_id: "proj-1",
        p_project_name: "未命名转绘项目 3",
      }),
    );
  });

  it("不传项目参数 → p_project_* 为 null（列存在时写入 NULL,无兼容问题）", async () => {
    const { supabase, rpc } = mockSupabase({ lookup: { data: [], error: null } });
    await chargeCredits(supabase, "u1", PARAMS);
    expect(rpc).toHaveBeenCalledWith(
      "deduct_user_credits",
      expect.objectContaining({ p_project_id: null, p_project_name: null }),
    );
  });

  it("SQL 未执行（PGRST204 参数缺失）→ 回退旧 6 参签名重试一次", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: "PGRST204: Could not find the 'p_project_id' parameter" },
      })
      .mockResolvedValueOnce({ data: [{ ok: true, balance_after: 88 }], error: null });
    const supabase = { rpc } as never;
    const r = await chargeCredits(supabase, "u1", { ...PARAMS, projectName: "剧集A" });
    expect(r).toEqual({ ok: true, balanceAfter: 88, deduped: false });
    expect(rpc).toHaveBeenCalledTimes(2);
    // 回退调用不带项目参数
    expect(rpc.mock.calls[1][1]).not.toHaveProperty("p_project_name");
  });

  it("非兼容性错误（如余额约束 23514）不回退,直接报错", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "23514 check violation" } }));
    const supabase = { rpc } as never;
    const r = await chargeCredits(supabase, "u1", { ...PARAMS, projectName: "剧集A" });
    expect(r.ok).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
