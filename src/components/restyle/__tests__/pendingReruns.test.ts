// ====================================================================
// pendingReruns 纯函数测试：入队去重 / FIFO 出队
// ====================================================================
import { describe, expect, it } from "vitest";
import { isPendingRerun, shiftPendingRerun, type PendingRerunLike } from "../pendingReruns";

const item = (episode: string, segmentId: string): PendingRerunLike => ({
  conversationId: "conv-1",
  rerun: { episode, segmentId },
});

describe("isPendingRerun", () => {
  it("同 episode+segmentId 判重", () => {
    const queue = [item("EP02", "U02")];
    expect(isPendingRerun(queue, { episode: "EP02", segmentId: "U02" })).toBe(true);
    expect(isPendingRerun(queue, { episode: "EP02", segmentId: "U03" })).toBe(false);
    expect(isPendingRerun(queue, { episode: "EP01", segmentId: "U02" })).toBe(false);
  });

  it("整集返工（无 segmentId）按集判重", () => {
    const queue = [{ conversationId: "c", rerun: { episode: "EP01" } }];
    expect(isPendingRerun(queue, { episode: "EP01" })).toBe(true);
    expect(isPendingRerun(queue, { episode: "EP01", segmentId: "U01" })).toBe(false);
  });

  it("空队列不判重", () => {
    expect(isPendingRerun([], { episode: "EP02", segmentId: "U02" })).toBe(false);
  });
});

describe("shiftPendingRerun", () => {
  it("FIFO 取队首并返回剩余", () => {
    const { item: first, rest } = shiftPendingRerun([item("EP01", "U01"), item("EP02", "U02")]);
    expect(first?.rerun).toEqual({ episode: "EP01", segmentId: "U01" });
    expect(rest).toHaveLength(1);
    expect(rest[0].rerun.segmentId).toBe("U02");
  });

  it("空/缺省队列安全返回", () => {
    expect(shiftPendingRerun([])).toEqual({ item: undefined, rest: [] });
    expect(shiftPendingRerun(undefined)).toEqual({ item: undefined, rest: [] });
  });
});
