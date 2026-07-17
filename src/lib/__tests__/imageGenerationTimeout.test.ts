import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("图片生成总超时", () => {
  const seedream = readFileSync(resolve(__dirname, "../seedream.functions.ts"), "utf8");
  const legacy = readFileSync(resolve(__dirname, "../openrouterImage.functions.ts"), "utf8");

  it("Seedream 将重试和退避限制在同一个六分钟 AbortController 内", () => {
    const helperStart = seedream.indexOf("async function callSeedreamImages");
    const helperEnd = seedream.indexOf(
      "// ====================================================================\n// 1)",
      helperStart,
    );
    const helper = seedream.slice(helperStart, helperEnd);

    expect(seedream).toMatch(/IMAGE_GENERATION_TIMEOUT_MS\s*=\s*600_000/);
    expect(seedream).toContain('IMAGE_GENERATION_TIMEOUT_ERROR = "生成超时（超过 6 分钟）"');
    expect(helper).toMatch(/const controller = new AbortController\(\);[\s\S]*for \(let attempt/);
    expect(helper).not.toMatch(
      /for \(let attempt[\s\S]*const controller = new AbortController\(\)/,
    );
  });

  it("旧模型的同步、异步和图生图请求同样使用六分钟上限", () => {
    expect(legacy).toMatch(/IMAGE_GENERATION_TIMEOUT_MS\s*=\s*600_000/);
    expect(legacy).not.toMatch(/controller\.abort\(\), (?:50_000|180_000)/);
    expect(legacy).toContain("生成超时（超过 6 分钟）");
  });
});
