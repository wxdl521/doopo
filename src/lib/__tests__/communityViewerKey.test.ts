import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../authContext.server", () => ({
  getOptionalAuthCtx: vi.fn(),
}));

import { getOptionalAuthCtx } from "../authContext.server";
import { buildAnonymousViewerKey, resolveViewerKey } from "../community.functions";

const mockedCtx = vi.mocked(getOptionalAuthCtx);

afterEach(() => vi.clearAllMocks());

describe("buildAnonymousViewerKey（匿名 viewerKey 纯函数）", () => {
  it("同 IP+UA 生成相同 key（按天去重依赖稳定性）", () => {
    expect(buildAnonymousViewerKey("1.2.3.4", "Mozilla")).toBe(
      buildAnonymousViewerKey("1.2.3.4", "Mozilla"),
    );
  });

  it("带 a: 前缀且为 sha256 截断（32 hex 字符）", () => {
    expect(buildAnonymousViewerKey("1.2.3.4", "Mozilla")).toMatch(/^a:[0-9a-f]{32}$/);
  });

  it("IP 或 UA 不同 → key 不同", () => {
    const base = buildAnonymousViewerKey("1.2.3.4", "Mozilla");
    expect(buildAnonymousViewerKey("5.6.7.8", "Mozilla")).not.toBe(base);
    expect(buildAnonymousViewerKey("1.2.3.4", "curl")).not.toBe(base);
  });

  it("缺 IP/UA 也能生成确定 key", () => {
    expect(buildAnonymousViewerKey(null, null)).toBe(buildAnonymousViewerKey(undefined, undefined));
  });
});

describe("resolveViewerKey（服务端生成口径）", () => {
  it("登录用户 → u:<userId>，与 IP/UA 无关", async () => {
    mockedCtx.mockResolvedValue({ userId: "user-abc", supabase: {} } as never);
    expect(await resolveViewerKey()).toBe("u:user-abc");
  });

  it("匿名 → 退化为 a: 哈希（非请求上下文取不到 header 也不抛）", async () => {
    mockedCtx.mockResolvedValue(null);
    const key = await resolveViewerKey();
    expect(key).toMatch(/^a:[0-9a-f]{32}$/);
  });
});
