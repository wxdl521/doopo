import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function isMissingRpc(message: string | undefined): boolean {
  return /PGRST202|PGRST204|42883|does not exist|could not find/i.test(message ?? "");
}

export type ReferralInvitee = {
  emailMasked: string;
  boundAt: string;
  rewardStatus: "pending" | "rewarded" | "skipped" | string;
  sourceAmount: number | null;
  rewardAmount: number | null;
  rewardedAt: string | null;
};

export type ReferralOverview = {
  unavailable: boolean;
  code: string | null;
  invitedCount: number;
  pendingCount: number;
  rewardedCount: number;
  skippedCount: number;
  myRewardTotal: number;
  invitees: ReferralInvitee[];
};

function emptyOverview(unavailable: boolean): ReferralOverview {
  return {
    unavailable,
    code: null,
    invitedCount: 0,
    pendingCount: 0,
    rewardedCount: 0,
    skippedCount: 0,
    myRewardTotal: 0,
    invitees: [],
  };
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseInvitees(raw: unknown): ReferralInvitee[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      emailMasked: typeof r.emailMasked === "string" ? r.emailMasked : "—",
      boundAt: typeof r.boundAt === "string" ? r.boundAt : "",
      rewardStatus: typeof r.rewardStatus === "string" ? r.rewardStatus : "pending",
      sourceAmount: r.sourceAmount == null ? null : asNumber(r.sourceAmount),
      rewardAmount: r.rewardAmount == null ? null : asNumber(r.rewardAmount),
      rewardedAt: typeof r.rewardedAt === "string" ? r.rewardedAt : null,
    };
  });
}

function parseOverview(data: unknown): ReferralOverview {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row || typeof row !== "object") return emptyOverview(false);
  return {
    unavailable: false,
    code: typeof row.code === "string" ? row.code : null,
    invitedCount: asNumber(row.invitedCount),
    pendingCount: asNumber(row.pendingCount),
    rewardedCount: asNumber(row.rewardedCount),
    skippedCount: asNumber(row.skippedCount),
    myRewardTotal: asNumber(row.myRewardTotal),
    invitees: parseInvitees(row.invitees),
  };
}

export const getMyReferralOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("get_my_referral_overview");
    if (error) {
      if (!isMissingRpc(error.message)) {
        console.error("[getMyReferralOverview]", error);
      }
      return emptyOverview(true);
    }
    return parseOverview(data);
  });
