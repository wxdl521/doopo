import { describe, expect, it } from "vitest";
import { isSectionNavActive } from "../SectionSidebar";

const ACCOUNT = [
  "/account",
  "/account/subscription",
  "/account/credits",
  "/account/assets",
  "/account/posts",
  "/account/invite",
  "/account/rewards",
  "/account/notifications",
  "/account/security",
  "/account/error-logs",
];

describe("isSectionNavActive", () => {
  it("keeps overview inactive on nested account pages", () => {
    expect(isSectionNavActive("/account/rewards", "/account", ACCOUNT)).toBe(false);
    expect(isSectionNavActive("/account/rewards", "/account/rewards", ACCOUNT)).toBe(true);
    expect(isSectionNavActive("/account/invite", "/account", ACCOUNT)).toBe(false);
    expect(isSectionNavActive("/account/invite", "/account/invite", ACCOUNT)).toBe(true);
  });

  it("marks overview only on the account index", () => {
    expect(isSectionNavActive("/account", "/account", ACCOUNT)).toBe(true);
    expect(isSectionNavActive("/account", "/account/rewards", ACCOUNT)).toBe(false);
  });
});
