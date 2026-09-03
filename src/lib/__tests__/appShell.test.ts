import { describe, expect, it } from "vitest";
import { appShellMode } from "../appShell";

describe("appShellMode", () => {
  it("uses a chrome-free landing shell on /", () => {
    expect(appShellMode("/")).toBe("landing");
  });

  it("keeps the product chrome on /home", () => {
    expect(appShellMode("/home")).toBe("app");
  });

  it("keeps workspace and restyle shells unchanged", () => {
    expect(appShellMode("/workspace/abc")).toBe("workspace");
    expect(appShellMode("/restyle")).toBe("restyle");
  });
});
