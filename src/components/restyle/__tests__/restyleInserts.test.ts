import { describe, expect, it, vi } from "vitest";
import type { DirectionShot } from "../../../lib/restyle/cameraDirection";
import {
  mergeInsertClips,
  planInsertJobs,
  runInsertJobs,
  segmentIdAtMs,
  type InsertJob,
  type InsertRunnerDeps,
} from "../restyleInserts";

const shot = (overrides: Partial<DirectionShot>): DirectionShot => ({
  shotNo: "SC001",
  startMs: 0,
  endMs: 10_000,
  scene: "病房",
  shotType: "中景",
  emotion: "舒缓",
  ...overrides,
});

// 触发布局：SC001 中景震惊（A 类触发）；SC002→SC003 场景切换（B 类触发）
const TRIGGER_SHOTS: DirectionShot[] = [
  shot({ shotNo: "SC001", startMs: 0, endMs: 10_000, scene: "病房", shotType: "中景", emotion: "震惊" }),
  shot({ shotNo: "SC002", startMs: 10_000, endMs: 20_000, scene: "病房", shotType: "近景", emotion: "舒缓" }),
  shot({ shotNo: "SC003", startMs: 20_000, endMs: 30_000, scene: "天台", shotType: "全景", emotion: "紧张" }),
];

describe("planInsertJobs", () => {
  it("smartInsert=false 返回空（保守转绘，不新增镜头）", () => {
    expect(
      planInsertJobs({ shots: TRIGGER_SHOTS, smartInsert: false, market: "kr" }),
    ).toEqual([]);
    expect(planInsertJobs({ shots: TRIGGER_SHOTS, market: "kr" })).toEqual([]);
    expect(planInsertJobs({ shots: [], smartInsert: true, market: "kr" })).toEqual([]);
  });

  it("A 类：情绪高点（震惊/落泪）落在非特写景别 → 补 0.5s 大特写，插在该镜之后", () => {
    const jobs = planInsertJobs({
      shots: TRIGGER_SHOTS,
      smartInsert: true,
      market: "kr",
      characterReferenceImages: ["https://cdn.example.com/char-a.png"],
    });
    const closeup = jobs.find((job) => job.kind === "closeup");
    expect(closeup).toBeDefined();
    expect(closeup?.anchorShotNo).toBe("SC001");
    expect(closeup?.position).toBe("after");
    expect(closeup?.durationSec).toBe(0.5);
    expect(closeup?.insertAtMs).toBe(9_999);
    expect(closeup?.anchorSegmentId).toBe("U01");
    expect(closeup?.boostLighting).toBe(true);
    expect(closeup?.referenceImages).toEqual(["https://cdn.example.com/char-a.png"]);
    // 调度块四段照常 + 大特写强制景别 + 面部锚定软引导（不强锁）
    expect(closeup?.prompt).toContain("景别：大特写");
    expect(closeup?.prompt).toContain("【运镜调度】");
    expect(closeup?.prompt).toContain("【转场指令】");
    expect(closeup?.prompt).toContain("【光线语言】");
    expect(closeup?.prompt).toContain("【服装引导】");
    expect(closeup?.prompt).toContain("不锁定服装编号");
    expect(closeup?.prompt).toContain("不做强锁");
    expect(closeup?.prompt).toContain("不做轴线冲突检测");
  });

  it("A 类：+20% 光照破格写进 prompt（光比数值上调 + 背景光晕增强 20%）", () => {
    const jobs = planInsertJobs({ shots: TRIGGER_SHOTS, smartInsert: true, market: "kr" });
    const closeup = jobs.find((job) => job.kind === "closeup");
    // kr 预设光比 30，震惊无情绪微调 → 30 × 1.2 = 36
    expect(closeup?.prompt).toContain("光比+36");
    expect(closeup?.prompt).toContain("背景光晕增强 20%");
    expect(closeup?.prompt).toContain("光照强度短暂提升 20%");
  });

  it("B 类：场景硬切 → 补 1s 空镜，插在新场景首镜之前，无人物、不加 20% 破格", () => {
    const jobs = planInsertJobs({ shots: TRIGGER_SHOTS, smartInsert: true, market: "kr" });
    const establishing = jobs.find((job) => job.kind === "establishing");
    expect(establishing).toBeDefined();
    expect(establishing?.anchorShotNo).toBe("SC003");
    expect(establishing?.position).toBe("before");
    expect(establishing?.durationSec).toBe(1);
    expect(establishing?.insertAtMs).toBe(20_000);
    expect(establishing?.anchorSegmentId).toBe("U02");
    expect(establishing?.boostLighting).toBe(false);
    expect(establishing?.referenceImages).toEqual([]);
    expect(establishing?.prompt).toContain("场景「病房」与「天台」之间");
    expect(establishing?.prompt).toContain("无人");
    expect(establishing?.prompt).not.toContain("背景光晕增强 20%");
  });

  it("已是特写景别的情绪高点不触发 A 类；同场景不触发 B 类", () => {
    const tightShots: DirectionShot[] = [
      shot({ shotNo: "SC001", emotion: "落泪", shotType: "特写" }),
      shot({ shotNo: "SC002", startMs: 10_000, endMs: 20_000, emotion: "舒缓" }),
    ];
    expect(planInsertJobs({ shots: tightShots, smartInsert: true, market: "us" })).toEqual([]);
  });

  it("自定义光照风格优先于地域预设，+20% 破格在自定义风格上同样生效", () => {
    const customLighting = {
      name: "霓虹夜",
      params: {
        contrastRatio: 50,
        tempTint: -10,
        palette: { shadows: "死黑", midtones: "青橙强反差", highlights: "霓虹洋红溢出" },
        textureRollOff: "暗部死黑，高光霓虹光晕柔化",
        skinToneOffset: "中性偏暖，防霓虹杂光染绿",
      },
    };
    const jobs = planInsertJobs({
      shots: TRIGGER_SHOTS,
      smartInsert: true,
      market: "kr",
      customLighting,
    });
    // A 类：SC001 震惊无情绪微调 → 自定义光比 50 × 1.2 = 60（非 kr 预设的 36）
    const closeup = jobs.find((job) => job.kind === "closeup");
    expect(closeup?.prompt).toContain("光比+60");
    expect(closeup?.prompt).toContain("霓虹洋红溢出，背景光晕增强 20%");
    expect(closeup?.prompt).toContain("自定义风格：霓虹夜");
    expect(closeup?.prompt).not.toContain("光比+36");
    // B 类：自定义参数但不破格
    const establishing = jobs.find((job) => job.kind === "establishing");
    expect(establishing?.prompt).toContain("自定义风格：霓虹夜");
    expect(establishing?.prompt).not.toContain("背景光晕增强 20%");
  });
});

describe("segmentIdAtMs", () => {
  it("按 15s 分段窗换算分段 id", () => {
    expect(segmentIdAtMs(0)).toBe("U01");
    expect(segmentIdAtMs(14_999)).toBe("U01");
    expect(segmentIdAtMs(15_000)).toBe("U02");
    expect(segmentIdAtMs(30_000)).toBe("U03");
  });
});

describe("mergeInsertClips", () => {
  const base: Array<{ id: string; segmentId?: string; url: string }> = [
    { id: "c1", segmentId: "U01", url: "https://cdn/u01.mp4" },
    { id: "c2", segmentId: "U02", url: "https://cdn/u02.mp4" },
    { id: "c3", segmentId: "U03", url: "https://cdn/u03.mp4" },
  ];

  it("按锚点插入：after 插在该分段后，before 插在该分段前", () => {
    const merged = mergeInsertClips(base, [
      {
        anchorSegmentId: "U01",
        position: "after",
        item: { id: "ins-a", url: "https://cdn/ins-a.mp4" },
      },
      {
        anchorSegmentId: "U03",
        position: "before",
        item: { id: "ins-b", url: "https://cdn/ins-b.mp4" },
      },
    ]);
    expect(merged.map((clip) => clip.id)).toEqual(["c1", "ins-a", "c2", "ins-b", "c3"]);
  });

  it("原片序列不变：过滤补镜后等于原序列；同一锚点多条按传入顺序", () => {
    const merged = mergeInsertClips(base, [
      { anchorSegmentId: "U02", position: "after", item: { id: "ins-1", url: "u" } },
      { anchorSegmentId: "U02", position: "after", item: { id: "ins-2", url: "u" } },
    ]);
    expect(merged.map((clip) => clip.id)).toEqual(["c1", "c2", "ins-1", "ins-2", "c3"]);
    expect(merged.filter((clip) => clip.id.startsWith("c"))).toEqual(base);
  });

  it("锚点分段不存在时补镜丢弃，不改变原片序列；无补镜时返回原序列副本", () => {
    const merged = mergeInsertClips(base, [
      { anchorSegmentId: "U99", position: "after", item: { id: "ins-x", url: "u" } },
    ]);
    expect(merged.map((clip) => clip.id)).toEqual(["c1", "c2", "c3"]);
    const untouched = mergeInsertClips(base, []);
    expect(untouched).toEqual(base);
    expect(untouched).not.toBe(base);
  });
});

describe("runInsertJobs（mock 生图/视频通道）", () => {
  const jobs = planInsertJobs({
    shots: TRIGGER_SHOTS,
    smartInsert: true,
    market: "kr",
    characterReferenceImages: ["https://cdn.example.com/char-a.png"],
  });

  function makeDeps(overrides: Partial<InsertRunnerDeps> = {}) {
    const generateImage = vi.fn(async (_input: { prompt: string }) => ({
      url: "https://cdn/still-b.png",
      error: null,
    }));
    const generateImageWithReferences = vi.fn(
      async (_input: { prompt: string; referenceImages: string[] }) => ({
        url: "https://cdn/still-a.png",
        error: null,
      }),
    );
    const stillToVideo = vi.fn(
      async (_input: { job: InsertJob; stillUrl: string; durationSec: number }) => ({
        ok: true,
        url: "https://cdn/insert.mp4",
      }),
    );
    const deps: InsertRunnerDeps = {
      generateImage,
      generateImageWithReferences,
      stillToVideo,
      ...overrides,
    };
    return { deps, generateImage, generateImageWithReferences, stillToVideo };
  }

  it("A 类走参考图 I2I（含角色参考图与 +20% 光晕描述），B 类走文生图", async () => {
    const { deps, generateImage, generateImageWithReferences, stillToVideo } = makeDeps();
    const results = await runInsertJobs(jobs, deps);

    expect(results).toHaveLength(2);
    // A 类：角色参考图 + prompt 内含 +20% 光晕描述
    expect(generateImageWithReferences).toHaveBeenCalledTimes(1);
    const i2iInput = generateImageWithReferences.mock.calls[0][0];
    expect(i2iInput.referenceImages).toEqual(["https://cdn.example.com/char-a.png"]);
    expect(i2iInput.prompt).toContain("背景光晕增强 20%");
    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(generateImage.mock.calls[0][0].prompt).toContain("无人");
    // 静帧 → 首帧模式短视频：duration 取档内最小值（0.5s 特写按 1s 提交）
    expect(stillToVideo).toHaveBeenCalledTimes(2);
    const durations = stillToVideo.mock.calls.map((call) => call[0].durationSec);
    expect(durations).toEqual([1, 1]);
    expect(stillToVideo.mock.calls[0][0].stillUrl).toBe("https://cdn/still-a.png");
    expect(results.map((item) => item.kind)).toEqual(["closeup", "establishing"]);
  });

  it("失败降级：单条生图/视频失败只记跳过原因，不抛错、不影响其它补镜", async () => {
    const onJobSkipped = vi.fn();
    const { deps } = makeDeps({
      generateImageWithReferences: vi.fn(async () => ({ url: "", error: "I2I 风控拒绝" })),
      stillToVideo: vi.fn(async () => ({ ok: false, error: "视频模型超时" })),
      onJobSkipped,
    });
    const results = await runInsertJobs(jobs, deps);

    expect(results).toEqual([]);
    expect(onJobSkipped).toHaveBeenCalledTimes(2);
    expect(onJobSkipped.mock.calls[0][1]).toBe("I2I 风控拒绝");
    expect(onJobSkipped.mock.calls[1][1]).toBe("视频模型超时");
  });

  it("通道抛异常同样降级跳过，不向上抛", async () => {
    const onJobSkipped = vi.fn();
    const { deps } = makeDeps({
      generateImageWithReferences: vi.fn(async () => {
        throw new Error("network down");
      }),
      onJobSkipped,
    });
    const results = await runInsertJobs(jobs.slice(0, 1), deps);
    expect(results).toEqual([]);
    expect(onJobSkipped).toHaveBeenCalledWith(expect.objectContaining({ kind: "closeup" }), "network down");
  });

  it("isAborted 中断后续作业", async () => {
    let calls = 0;
    const { deps, stillToVideo } = makeDeps({
      isAborted: () => {
        calls += 1;
        // 第 1 条作业完整跑完（循环入口 + 静帧后各查一次），第 2 条入口即中断。
        return calls > 2;
      },
    });
    const results = await runInsertJobs(jobs, deps);
    expect(results.length).toBeLessThan(2);
    expect(stillToVideo).toHaveBeenCalledTimes(1);
  });

  it("无角色参考图时 A 类退化为文生图", async () => {
    const noRefJobs: InsertJob[] = planInsertJobs({
      shots: TRIGGER_SHOTS,
      smartInsert: true,
      market: "kr",
    });
    const { deps, generateImage, generateImageWithReferences } = makeDeps();
    const results = await runInsertJobs(noRefJobs, deps);
    expect(results).toHaveLength(2);
    expect(generateImageWithReferences).not.toHaveBeenCalled();
    expect(generateImage).toHaveBeenCalledTimes(2);
  });
});
