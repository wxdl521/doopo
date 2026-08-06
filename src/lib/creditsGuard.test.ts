import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./authContext.server", () => ({
  getOptionalAuthCtx: vi.fn(),
}));

import { getOptionalAuthCtx } from "./authContext.server";
import { ensureEnoughCredits } from "./creditsGuard";

const mockedCtx = vi.mocked(getOptionalAuthCtx);

/** 构造一个 from().select().eq().maybeSingle() 链式 mock */
function walletDb(result: { data?: { credits_balance: number } | null; error?: { message: string } | null }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: result.data ?? null, error: result.error ?? null }),
        }),
      }),
    }),
  };
}

function authed(db: unknown) {
  mockedCtx.mockResolvedValue({ userId: "u1", supabase: db } as never);
}

afterEach(() => vi.clearAllMocks());

describe("ensureEnoughCredits（积分预校验口径）", () => {
  it("required 为空或非正数 → 直接放行，不查库", async () => {
    expect(await ensureEnoughCredits(null)).toEqual({ ok: true });
    expect(await ensureEnoughCredits(0)).toEqual({ ok: true });
    expect(mockedCtx).not.toHaveBeenCalled();
  });

  it("未登录 → 放行（与既有扣分逻辑对齐）", async () => {
    mockedCtx.mockResolvedValue(null);
    expect(await ensureEnoughCredits(5)).toEqual({ ok: true });
  });

  it("余额 >= required → 放行", async () => {
    authed(walletDb({ data: { credits_balance: 10 } }));
    expect(await ensureEnoughCredits(10)).toEqual({ ok: true });
    expect(await ensureEnoughCredits(3)).toEqual({ ok: true });
  });

  it("余额 0 不再放行（balance < required 拦截）", async () => {
    authed(walletDb({ data: { credits_balance: 0 } }));
    const r = await ensureEnoughCredits(1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("余额不足");
      expect(r.balance).toBe(0);
      expect(r.required).toBe(1);
    }
  });

  it("余额不足（正数但小于 required）→ 拦截", async () => {
    authed(walletDb({ data: { credits_balance: 1 } }));
    const r = await ensureEnoughCredits(2);
    expect(r).toMatchObject({ ok: false, balance: 1, required: 2 });
  });

  it("读库失败 → fail-closed 拦截", async () => {
    authed(walletDb({ error: { message: "connection reset" } }));
    const r = await ensureEnoughCredits(1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("查询失败");
  });

  it("无钱包行 → fail-closed 拦截", async () => {
    authed(walletDb({ data: null }));
    const r = await ensureEnoughCredits(1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("未查询到积分钱包");
  });

  it("查询抛异常 → fail-closed 拦截", async () => {
    authed({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              throw new Error("boom");
            },
          }),
        }),
      }),
    });
    const r = await ensureEnoughCredits(1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("查询异常");
  });
});
