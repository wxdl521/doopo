import { describe, expect, it, vi } from "vitest";
import { cachedAnalysisFrames, resolveSourceVideoFile } from "../RestyleStudio";
import type { RestyleAttachment } from "../restyleStorage";

// 与 RestyleStudio.test.tsx 相同：阻断 auth / 资产库模块的副作用，只测模块级纯函数。
vi.mock("../../../hooks/useAuth", () => ({
  useAuth: () => ({
    session: null,
    user: { id: "restyle-user" },
    loading: false,
    isAuthenticated: true,
    signOut: async () => {},
  }),
}));
vi.mock("../../../lib/assetsStorage", () => ({
  loadCharacters: vi.fn(async () => ({ data: [], error: null })),
  loadScenes: vi.fn(async () => ({ data: [], error: null })),
  loadProps: vi.fn(async () => ({ data: [], error: null })),
}));

function videoAttachment(overrides: Partial<RestyleAttachment> = {}): RestyleAttachment {
  return {
    id: "video-1",
    name: "EP01.mp4",
    size: 1024,
    type: "video/mp4",
    lastModified: 0,
    ...overrides,
  };
}

describe("resolveSourceVideoFile（素材回退链）", () => {
  it("内存映射命中时直接用本地 File，不触发取回", async () => {
    const local = new File(["local"], "EP01.mp4", { type: "video/mp4" });
    const fileObjects: Record<string, File | undefined> = { "video-1": local };
    const ensureUrl = vi.fn();
    const fetchImpl = vi.fn();

    const result = await resolveSourceVideoFile(
      videoAttachment(),
      fileObjects,
      ensureUrl,
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual({ ok: true, file: local, restored: false });
    expect(ensureUrl).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("内存未命中时经持久 URL fetch 回 Blob 重建 File 并回填缓存", async () => {
    const fileObjects: Record<string, File | undefined> = {};
    const ensureUrl = vi.fn(async () => ({ ok: true as const, url: "https://cdn.example.com/EP01.mp4" }));
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(["bytes"], { type: "video/mp4" }),
    }));

    const result = await resolveSourceVideoFile(
      videoAttachment({ url: "https://cdn.example.com/EP01.mp4" }),
      fileObjects,
      ensureUrl,
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.restored).toBe(true);
      expect(result.file.name).toBe("EP01.mp4");
      expect(result.file.type).toBe("video/mp4");
      expect(result.file.size).toBe(5);
    }
    expect(ensureUrl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith("https://cdn.example.com/EP01.mp4");
    // 回填后同一附件再次解析直接命中内存。
    expect(fileObjects["video-1"]).toBeInstanceOf(File);
  });

  it("持久 URL 不可用时返回失败且不发起 fetch", async () => {
    const ensureUrl = vi.fn(async () => ({ ok: false as const, error: "上传失效" }));
    const fetchImpl = vi.fn();

    const result = await resolveSourceVideoFile(
      videoAttachment(),
      {},
      ensureUrl,
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual({ ok: false, error: "上传失效" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetch 返回非 2xx 或抛错时返回失败", async () => {
    const ensureUrl = vi.fn(async () => ({ ok: true as const, url: "https://cdn.example.com/EP01.mp4" }));
    const httpError = await resolveSourceVideoFile(
      videoAttachment(),
      {},
      ensureUrl,
      vi.fn(async () => ({ ok: false, status: 403 })) as unknown as typeof fetch,
    );
    expect(httpError.ok).toBe(false);
    if (!httpError.ok) expect(httpError.error).toContain("403");

    const thrown = await resolveSourceVideoFile(
      videoAttachment(),
      {},
      ensureUrl,
      vi.fn(async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    );
    expect(thrown).toEqual({ ok: false, error: "network down" });
  });
});

describe("cachedAnalysisFrames（三级回退：复用首轮关键帧附件）", () => {
  const frame = (id: string, episode: string, url?: string): RestyleAttachment => ({
    id,
    name: `${id}.jpg`,
    size: 100,
    type: "image/jpeg",
    lastModified: 0,
    url,
    analysisFrame: true,
    analysisEpisode: episode,
  });

  it("按源视频 episode 收集 analysisFrame 附件 url", () => {
    const files = [
      frame("f1", "EP01", "data:image/jpeg;base64,a"),
      frame("f2", "EP01", "data:image/jpeg;base64,b"),
      frame("f3", "EP02", "data:image/jpeg;base64,c"),
      // 非 analysisFrame 附件与缺 url 的附件都要排除。
      videoAttachment({ id: "video-1", episode: "EP01" }),
      frame("f4", "EP01", undefined),
    ];

    expect(cachedAnalysisFrames(files, ["EP01"])).toEqual([
      "data:image/jpeg;base64,a",
      "data:image/jpeg;base64,b",
    ]);
    expect(cachedAnalysisFrames(files, ["EP02"])).toEqual(["data:image/jpeg;base64,c"]);
    expect(cachedAnalysisFrames(files, ["EP03"])).toEqual([]);
  });

  it("最多返回 8 帧，与分析主链路口径一致", () => {
    const files = Array.from({ length: 12 }, (_, index) =>
      frame(`f${index}`, "EP01", `data:image/jpeg;base64,${index}`),
    );
    expect(cachedAnalysisFrames(files, ["EP01"])).toHaveLength(8);
  });
});
