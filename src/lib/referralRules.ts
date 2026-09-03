/** 邀请码字母表：去掉 0/O/1/I，避免口播和手打混淆。 */
export const INVITE_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const INVITE_CODE_LENGTH = 8;
export const INVITE_CODE_RE = /^[2-9A-HJ-NP-Z]{8}$/;
export const INVITE_REF_STORAGE_KEY = "doopoo_invite_ref";

export const SIGNUP_BONUS_CREDITS = 50;
export const REFERRAL_RATE = 0.05;

export const QUALIFYING_INBOUND_TYPES = ["admin_grant", "recharge"] as const;
export type QualifyingInboundType = (typeof QUALIFYING_INBOUND_TYPES)[number];

export type BindRejectReason = "invalid_code" | "self" | "already_bound" | "has_ledger";

export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return INVITE_CODE_RE.test(code) ? code : null;
}

export function referralRewardAmount(sourceAmount: number): number {
  if (!Number.isFinite(sourceAmount) || sourceAmount <= 0) return 0;
  return Math.floor(sourceAmount * REFERRAL_RATE);
}

export function isQualifyingInboundType(type: string): boolean {
  return type === "admin_grant" || type === "recharge";
}

export function canBindReferral(opts: {
  inviterId: string | null | undefined;
  inviteeId: string;
  alreadyBound: boolean;
  hasLedger: boolean;
}): { ok: true } | { ok: false; reason: BindRejectReason } {
  if (!opts.inviterId) return { ok: false, reason: "invalid_code" };
  if (opts.inviterId === opts.inviteeId) return { ok: false, reason: "self" };
  if (opts.alreadyBound) return { ok: false, reason: "already_bound" };
  if (opts.hasLedger) return { ok: false, reason: "has_ledger" };
  return { ok: true };
}

export function maskEmail(email: string | null | undefined): string {
  if (!email || !email.includes("@")) return "—";
  const at = email.indexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain) return "—";
  const head = local.charAt(0) || "*";
  return `${head}***@${domain}`;
}

export function persistInviteRef(code: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(INVITE_REF_STORAGE_KEY, code);
  } catch {
    /* private mode / storage blocked */
  }
}

export function readInviteRef(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return normalizeInviteCode(localStorage.getItem(INVITE_REF_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearInviteRef(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(INVITE_REF_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** 任意落地页 `?ref=` 写入 localStorage，注册页再读取。 */
export function captureInviteRefFromSearch(search: string | URLSearchParams): string | null {
  const params = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search) : search;
  const code = normalizeInviteCode(params.get("ref"));
  if (code) persistInviteRef(code);
  return code;
}
