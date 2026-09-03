import { beforeEach, describe, expect, it } from "vitest";
import {
  INVITE_REF_STORAGE_KEY,
  canBindReferral,
  captureInviteRefFromSearch,
  clearInviteRef,
  isQualifyingInboundType,
  maskEmail,
  normalizeInviteCode,
  persistInviteRef,
  readInviteRef,
  referralRewardAmount,
} from "../referralRules";

describe("normalizeInviteCode", () => {
  it("accepts 8-char crockford-like codes and uppercases them", () => {
    expect(normalizeInviteCode("ab3k7q2m")).toBe("AB3K7Q2M");
  });

  it("rejects wrong length, ambiguous chars, and junk", () => {
    expect(normalizeInviteCode("AB3K7Q2")).toBeNull();
    expect(normalizeInviteCode("AB3K7Q2MO")).toBeNull();
    expect(normalizeInviteCode("AB0K7Q2M")).toBeNull();
    expect(normalizeInviteCode("not a code")).toBeNull();
    expect(normalizeInviteCode(null)).toBeNull();
  });
});

describe("referralRewardAmount", () => {
  it("floors 5% and returns 0 below 1 credit", () => {
    expect(referralRewardAmount(1000)).toBe(50);
    expect(referralRewardAmount(20)).toBe(1);
    expect(referralRewardAmount(19)).toBe(0);
    expect(referralRewardAmount(50)).toBe(2);
    expect(referralRewardAmount(0)).toBe(0);
    expect(referralRewardAmount(-10)).toBe(0);
  });
});

describe("isQualifyingInboundType", () => {
  it("only treats admin_grant and recharge as first-arrival cashback", () => {
    expect(isQualifyingInboundType("admin_grant")).toBe(true);
    expect(isQualifyingInboundType("recharge")).toBe(true);
    expect(isQualifyingInboundType("signup_bonus")).toBe(false);
    expect(isQualifyingInboundType("referral_reward")).toBe(false);
    expect(isQualifyingInboundType("team_allocate")).toBe(false);
    expect(isQualifyingInboundType("refund")).toBe(false);
    expect(isQualifyingInboundType("consume")).toBe(false);
  });
});

describe("canBindReferral", () => {
  const base = { inviterId: "inviter", inviteeId: "invitee", alreadyBound: false, hasLedger: false };

  it("allows a fresh invitee with a valid inviter", () => {
    expect(canBindReferral(base)).toEqual({ ok: true });
  });

  it("rejects missing code, self-invite, already bound, and existing ledger", () => {
    expect(canBindReferral({ ...base, inviterId: null })).toEqual({
      ok: false,
      reason: "invalid_code",
    });
    expect(canBindReferral({ ...base, inviteeId: "inviter" })).toEqual({
      ok: false,
      reason: "self",
    });
    expect(canBindReferral({ ...base, alreadyBound: true })).toEqual({
      ok: false,
      reason: "already_bound",
    });
    expect(canBindReferral({ ...base, hasLedger: true })).toEqual({
      ok: false,
      reason: "has_ledger",
    });
  });
});

describe("maskEmail", () => {
  it("keeps first local char and domain", () => {
    expect(maskEmail("alice@example.com")).toBe("a***@example.com");
    expect(maskEmail("a@x.co")).toBe("a***@x.co");
    expect(maskEmail(null)).toBe("—");
    expect(maskEmail("nope")).toBe("—");
  });
});

describe("invite ref storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists a valid ref from query string and ignores junk", () => {
    expect(captureInviteRefFromSearch("?ref=ab3k7q2m")).toBe("AB3K7Q2M");
    expect(localStorage.getItem(INVITE_REF_STORAGE_KEY)).toBe("AB3K7Q2M");
    expect(readInviteRef()).toBe("AB3K7Q2M");
    expect(captureInviteRefFromSearch("ref=nope")).toBeNull();
    persistInviteRef("ZZZZZZZZ");
    expect(readInviteRef()).toBe("ZZZZZZZZ");
    clearInviteRef();
    expect(readInviteRef()).toBeNull();
  });
});
