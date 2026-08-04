import { describe, expect, it } from "vitest";
import {
  assertContentLengthWithin,
  assertPublicHttpsUrl,
  isPrivateHostname,
} from "./ssrfGuard";

describe("ssrfGuard · assertPublicHttpsUrl", () => {
  it("放行 https 公网地址", () => {
    expect(assertPublicHttpsUrl("https://cdn.example.com/video.mp4").hostname).toBe(
      "cdn.example.com",
    );
    expect(assertPublicHttpsUrl("https://8.8.8.8/a.mp4").hostname).toBe("8.8.8.8");
  });

  it("拒绝非 https 协议", () => {
    expect(() => assertPublicHttpsUrl("http://cdn.example.com/v.mp4")).toThrow(/https/);
    expect(() => assertPublicHttpsUrl("ftp://cdn.example.com/v.mp4")).toThrow(/https/);
  });

  it("拒绝内网 / 环回 / 保留段地址", () => {
    for (const url of [
      "https://127.0.0.1/v.mp4",
      "https://127.10.20.30/v.mp4",
      "https://10.0.0.5/v.mp4",
      "https://192.168.1.1/v.mp4",
      "https://169.254.169.254/latest/meta-data",
      "https://0.0.0.0/v.mp4",
      "https://localhost/v.mp4",
      "https://foo.localhost/v.mp4",
      "https://nas.local/v.mp4",
      "https://172.16.0.1/v.mp4",
      "https://[::1]/v.mp4",
    ]) {
      expect(() => assertPublicHttpsUrl(url), url).toThrow(/内网|本机/);
    }
  });

  it("拒绝非法 URL", () => {
    expect(() => assertPublicHttpsUrl("not-a-url")).toThrow(/合法 URL/);
  });

  it("isPrivateHostname 边界：172.15/172.32 不算私网", () => {
    expect(isPrivateHostname("172.15.0.1")).toBe(false);
    expect(isPrivateHostname("172.32.0.1")).toBe(false);
    expect(isPrivateHostname("172.31.255.255")).toBe(true);
  });
});

describe("ssrfGuard · assertContentLengthWithin", () => {
  const MB = 1024 * 1024;

  it("Content-Length 超限直接抛错（不进入下载）", () => {
    const res = new Response(null, {
      headers: { "content-length": String(501 * MB) },
    });
    expect(() => assertContentLengthWithin(res, 500 * MB)).toThrow(/上限/);
  });

  it("未超限或无 Content-Length 时放行", () => {
    const under = new Response(null, { headers: { "content-length": String(10 * MB) } });
    expect(() => assertContentLengthWithin(under, 500 * MB)).not.toThrow();
    const missing = new Response(null);
    expect(() => assertContentLengthWithin(missing, 500 * MB)).not.toThrow();
  });
});
