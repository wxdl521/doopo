import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ====================================================================
// getUserBalance — 获取当前用户个人积分余额（不存在则自动创建钱包）
// ====================================================================

export const getUserBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: wallet } = await supabase
      .from("user_wallets")
      .select("credits_balance")
      .eq("user_id", userId)
      .maybeSingle();

    if (wallet) {
      return { balance: wallet.credits_balance };
    }

    // 钱包不存在 → 创建（余额 0）
    const { error: insertErr } = await supabase
      .from("user_wallets")
      .insert({ user_id: userId, credits_balance: 0 });

    if (insertErr) {
      // 并发创建导致的唯一冲突 → 重新查询
      if (insertErr.code === "23505") {
        const { data: retry } = await supabase
          .from("user_wallets")
          .select("credits_balance")
          .eq("user_id", userId)
          .maybeSingle();
        return { balance: retry?.credits_balance ?? 0 };
      }
      console.error("[getUserBalance] insert wallet failed:", insertErr);
      return { balance: 0 };
    }

    return { balance: 0 };
  });

// ====================================================================
// rechargeCredits — 充值积分（调用 SECURITY DEFINER RPC 安全加余额）
// ====================================================================

export const rechargeCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const parsed = z.object({ amount: z.number().int().positive() }).safeParse(input);
    if (!parsed.success) throw new Error("Invalid amount");
    return parsed.data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { error } = await supabase.rpc("add_user_credits", {
      p_amount: data.amount,
    });

    if (error) {
      console.error("[rechargeCredits] RPC failed:", error);
      return { ok: false as const, error: error.message };
    }

    const { data: wallet } = await supabase
      .from("user_wallets")
      .select("credits_balance")
      .eq("user_id", userId)
      .maybeSingle();

    return { ok: true as const, balance: wallet?.credits_balance ?? 0 };
  });
