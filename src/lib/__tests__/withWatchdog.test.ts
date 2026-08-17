// ====================================================================
// withWatchdog 测试（工作区保存互斥标志挂死复位的兜底回归）
// ====================================================================
import { describe, expect, it } from "vitest";
import { withWatchdog } from "../withWatchdog";

describe("withWatchdog", () => {
  it("按时 settle 的 promise 原样返回", async () => {
    await expect(withWatchdog(Promise.resolve("ok"), 50)).resolves.toBe("ok");
    await expect(
      withWatchdog(new Promise((r) => setTimeout(() => r("slow-ok"), 10)), 100),
    ).resolves.toBe("slow-ok");
  });

  it("挂死（永不 settle）的 promise 超时 reject——调用方 finally 必然执行", async () => {
    let finallyRan = false;
    try {
      await withWatchdog(new Promise(() => {}), 20, "save watchdog");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("save watchdog");
    } finally {
      // 关键契约:挂死也会走到这里,互斥标志得以复位
      finallyRan = true;
    }
    expect(finallyRan).toBe(true);
  });

  it("超时后原 promise 继续后台 settle,不影响已返回的超时结果", async () => {
    let settled = "";
    const slow = new Promise<string>((r) => setTimeout(() => r("late"), 30));
    void slow.then((v) => {
      settled = v;
    });
    await expect(withWatchdog(slow, 10)).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe("late");
  });

  it("原 promise 业务 reject 优先于看门狗透传", async () => {
    await expect(withWatchdog(Promise.reject(new Error("boom")), 100)).rejects.toThrow("boom");
  });
});
