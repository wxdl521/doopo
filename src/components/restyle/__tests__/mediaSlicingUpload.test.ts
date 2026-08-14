// ====================================================================
// mediaSlicing.prepareEpisodeMedia 单元内上传并发测试（deps 全注入,不触网）
// ====================================================================
import { describe, expect, it, vi } from "vitest";
import { prepareEpisodeMedia } from "../v2/mediaSlicing";

describe("prepareEpisodeMedia 单元内上传并发", () => {
  it("同一单元的 4 帧并发上传（不互相等待），frameUrls 保序", async () => {
    const started: string[] = [];
    const release: Array<() => void> = [];
    const upload = vi.fn(
      (input: { base64: string; id: string; kind: string }) =>
        new Promise<{ ok: boolean; url?: string }>((resolve) => {
          started.push(input.id);
          release.push(() => resolve({ ok: true, url: `https://u.example.com/${input.id}` }));
        }),
    );
    const promise = prepareEpisodeMedia(new File(["x"], "ep1.mp4", { type: "video/mp4" }), {
      episodeId: "ep1",
      upload,
      createUploadUrl: async () => ({ ok: true, uploadUrl: "https://up", path: "p/ep1.mp4" }),
      signReadUrl: async () => ({ ok: true, url: "https://read/ep1.mp4" }),
      deps: {
        probe: async () => 60,
        decodeAudio: async () => null,
        openSession: async () => ({}) as never,
        captureFrames: async () => ["f1", "f2", "f3", "f4"],
        putBinary: async () => {},
      },
    });
    // 等 4 帧上传全部启动（串行实现下 f2 不会先于 f1 完成启动）
    await vi.waitFor(() => expect(started).toHaveLength(4));
    expect(started).toEqual([
      "ep1-part-001-f1",
      "ep1-part-001-f2",
      "ep1-part-001-f3",
      "ep1-part-001-f4",
    ]);
    // 乱序完成,URL 仍按帧序归位
    for (const done of release.reverse()) done();
    const prepared = await promise;
    expect(prepared.units).toHaveLength(1);
    expect(prepared.units[0].frameUrls).toEqual([
      "https://u.example.com/ep1-part-001-f1",
      "https://u.example.com/ep1-part-001-f2",
      "https://u.example.com/ep1-part-001-f3",
      "https://u.example.com/ep1-part-001-f4",
    ]);
  });
});
