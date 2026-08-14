// ====================================================================
// analysisMerge 纯函数测试 + 双通道调用参数构造（fetch mock，不触网）
// ====================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  alignTranscript,
  mergeUnitsByOffset,
  sliceUnits,
  type UnitAnalysisPart,
} from "./analysisMerge";
import {
  analyzeEpisodeUnits,
  assembleEpisodeAnalysis,
  collectSourceAssets,
  extractJson,
  isInputAudioRejected,
  runWithConcurrency,
  type UnitMediaInput,
} from "./restyleVideoAnalysis.functions";

// --------------------------------------------------------------------
// sliceUnits
// --------------------------------------------------------------------

describe("sliceUnits", () => {
  it("整除：240s / 120s = 2 个完整单元", () => {
    const units = sliceUnits(240, 120);
    expect(units).toHaveLength(2);
    expect(units[0]).toEqual({
      unitId: "part-001",
      unitStartOffsetSec: 0,
      sourceStartSeconds: 0,
      durationSec: 120,
    });
    expect(units[1]).toEqual({
      unitId: "part-002",
      unitStartOffsetSec: 120,
      sourceStartSeconds: 120,
      durationSec: 120,
    });
  });

  it("余数：250s 切成 120 + 120 + 10，最后一单元可短", () => {
    const units = sliceUnits(250, 120);
    expect(units).toHaveLength(3);
    expect(units[2]).toMatchObject({
      unitId: "part-003",
      unitStartOffsetSec: 240,
      durationSec: 10,
    });
  });

  it("短于单元上限：80s 只切 1 个单元", () => {
    const units = sliceUnits(80, 120);
    expect(units).toHaveLength(1);
    expect(units[0].durationSec).toBe(80);
  });

  it("非正时长返回空数组", () => {
    expect(sliceUnits(0)).toEqual([]);
    expect(sliceUnits(-5)).toEqual([]);
  });

  it("默认上限 120s", () => {
    const units = sliceUnits(121);
    expect(units).toHaveLength(2);
    expect(units[1].durationSec).toBe(1);
  });
});

// --------------------------------------------------------------------
// mergeUnitsByOffset
// --------------------------------------------------------------------

function makePart(
  unitId: string,
  unitStartOffsetSec: number,
  shots: Array<{ shot_no: string; start_ms: number; end_ms: number }>,
): UnitAnalysisPart {
  return { unitId, unitStartOffsetSec, analysis: { shots } };
}

describe("mergeUnitsByOffset", () => {
  it("按 unitStartOffsetSec 偏移拼回并全局重排 shot_no", () => {
    const { shots, warnings } = mergeUnitsByOffset([
      makePart("part-002", 60, [
        { shot_no: "SC001", start_ms: 0, end_ms: 5000 },
        { shot_no: "SC002", start_ms: 5000, end_ms: 10000 },
      ]),
      makePart("part-001", 0, [
        { shot_no: "SC001", start_ms: 0, end_ms: 30000 },
        { shot_no: "SC002", start_ms: 30000, end_ms: 60000 },
      ]),
    ]);
    expect(warnings).toEqual([]);
    expect(shots.map((s) => [s.shot_no, s.start_ms, s.end_ms, s.unitId])).toEqual([
      ["SC001", 0, 30000, "part-001"],
      ["SC002", 30000, 60000, "part-001"],
      ["SC003", 60000, 65000, "part-002"],
      ["SC004", 65000, 70000, "part-002"],
    ]);
    // 原始编号保留在 source_shot_no
    expect(shots[2].source_shot_no).toBe("SC001");
  });

  it("相邻缺口 > 1s 记 warning，不改动时间码", () => {
    const { shots, warnings } = mergeUnitsByOffset([
      makePart("part-001", 0, [{ shot_no: "SC001", start_ms: 0, end_ms: 10000 }]),
      makePart("part-002", 60, [{ shot_no: "SC001", start_ms: 0, end_ms: 5000 }]),
    ]);
    // part-002 偏移到 60000，与 10000 之间缺口 50000ms
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("50000ms 缺口");
    expect(shots[0].end_ms).toBe(10000);
    expect(shots[1].start_ms).toBe(60000);
  });

  it("重叠时截断前者，缺口 <= 1s 不记 warning", () => {
    const { shots, warnings } = mergeUnitsByOffset([
      makePart("part-001", 0, [{ shot_no: "SC001", start_ms: 0, end_ms: 62000 }]),
      makePart("part-002", 60, [{ shot_no: "SC001", start_ms: 0, end_ms: 5000 }]),
    ]);
    // part-002 从 60000 开始，前者 62000 与之重叠 2000ms → 截断前者到 60000
    expect(warnings.some((w) => w.includes("重叠 2000ms"))).toBe(true);
    expect(shots[0].end_ms).toBe(60000);
    expect(shots[1].start_ms).toBe(60000);
  });

  it("小缝隙（<=1s）不记 warning", () => {
    const { warnings } = mergeUnitsByOffset([
      makePart("part-001", 0, [{ shot_no: "SC001", start_ms: 0, end_ms: 59500 }]),
      makePart("part-002", 60, [{ shot_no: "SC001", start_ms: 0, end_ms: 5000 }]),
    ]);
    expect(warnings).toEqual([]);
  });

  it("空 shots 单元不产生分镜", () => {
    const { shots } = mergeUnitsByOffset([makePart("part-001", 0, [])]);
    expect(shots).toEqual([]);
  });
});

// --------------------------------------------------------------------
// alignTranscript
// --------------------------------------------------------------------

describe("alignTranscript", () => {
  const shots = [
    { shot_no: "SC001", start_ms: 0, end_ms: 10000 },
    { shot_no: "SC002", start_ms: 10000, end_ms: 20000 },
  ];

  it("按时间区间中点归属 shot", () => {
    const { aligned, orphans } = alignTranscript(
      [
        { begin_ms: 1000, end_ms: 3000, text: "你好" }, // 中点 2000 → SC001
        { begin_ms: 8000, end_ms: 14000, text: "跨界" }, // 中点 11000 → SC002
        { begin_ms: 12000, end_ms: 13000, text: "再见" }, // 中点 12500 → SC002
      ],
      shots,
    );
    expect(orphans).toEqual([]);
    expect(aligned.map((s) => [s.text, s.shot_no])).toEqual([
      ["你好", "SC001"],
      ["跨界", "SC002"],
      ["再见", "SC002"],
    ]);
  });

  it("中点落在任何 shot 之外的进 orphans", () => {
    const { aligned, orphans } = alignTranscript(
      [
        { begin_ms: 25000, end_ms: 27000, text: "片尾后" },
        { begin_ms: 0, end_ms: 2000, text: "片头" },
      ],
      shots,
    );
    expect(aligned.map((s) => s.text)).toEqual(["片头"]);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({ text: "片尾后", shot_no: null });
  });

  it("中点恰好等于最后一个 shot 的 end_ms 时归属该 shot", () => {
    const { aligned, orphans } = alignTranscript(
      [{ begin_ms: 18000, end_ms: 22000, text: "压线" }], // 中点 20000
      shots,
    );
    expect(orphans).toEqual([]);
    expect(aligned[0].shot_no).toBe("SC002");
  });

  it("空 shots 时全部 orphan", () => {
    const { aligned, orphans } = alignTranscript(
      [{ begin_ms: 0, end_ms: 1000, text: "台词" }],
      [],
    );
    expect(aligned).toEqual([]);
    expect(orphans).toHaveLength(1);
  });
});

// --------------------------------------------------------------------
// assembleEpisodeAnalysis / collectSourceAssets
// --------------------------------------------------------------------

describe("assembleEpisodeAnalysis", () => {
  it("台词按单元偏移换算为集级毫秒并对齐到 shot", () => {
    const units = [
      { unitId: "part-001", unitStartOffsetSec: 0 },
      { unitId: "part-002", unitStartOffsetSec: 60 },
    ];
    const analysisByUnit = new Map([
      ["part-001", { overview: "甲", shots: [{ shot_no: "SC001", start_ms: 0, end_ms: 60000 }] }],
      ["part-002", { overview: "乙", shots: [{ shot_no: "SC001", start_ms: 0, end_ms: 60000 }] }],
    ]);
    const transcriptByUnit = new Map([
      ["part-001", [{ begin_ms: 1000, end_ms: 2000, text: "单元一", speaker: "A" }]],
      ["part-002", [{ begin_ms: 1000, end_ms: 2000, text: "单元二", speaker: "B" }]],
    ]);
    const result = assembleEpisodeAnalysis(units, analysisByUnit, transcriptByUnit);
    expect(result.overview).toBe("甲 / 乙");
    expect(result.shots).toHaveLength(2);
    expect(result.transcript.map((s) => [s.text, s.begin_ms, s.shot_no])).toEqual([
      ["单元一", 1000, "SC001"],
      ["单元二", 61000, "SC002"],
    ]);
    expect(result.transcript[1].unitId).toBe("part-002");
    expect(result.transcript[1].sentence_id).toBe("part-002-S001");
  });
});

describe("collectSourceAssets", () => {
  it("同名人物跨单元合并，首末出现时间换算为集级毫秒", () => {
    const parts: UnitAnalysisPart[] = [
      {
        unitId: "part-001",
        unitStartOffsetSec: 0,
        analysis: {
          characters: [
            {
              name: "陈炫雅",
              aliases: ["私生女"],
              firstSeenSeconds: 10,
              lastSeenSeconds: 50,
              appearance: "年轻女性",
              relationships: [{ relatedName: "祝晓萱", relation: "重生前后" }],
            },
          ],
          scenes: [{ name: "医院", description: "病房" }],
          props: [{ name: "手机", description: "道具" }],
        },
      },
      {
        unitId: "part-002",
        unitStartOffsetSec: 60,
        analysis: {
          characters: [
            { name: "陈炫雅", aliases: ["陈总千金"], firstSeenSeconds: 5, lastSeenSeconds: 30 },
          ],
        },
      },
    ];
    const assets = collectSourceAssets(parts);
    expect(assets).toHaveLength(3);
    const char = assets.find((a) => a.kind === "character")!;
    expect(char.source_name).toBe("陈炫雅");
    expect(char.first_seen_ms).toBe(10000);
    expect(char.last_seen_ms).toBe(90000); // 60s 偏移 + 30s
    expect(char.aliases).toEqual(["私生女", "陈总千金"]);
    expect(char.relationships).toEqual([{ relatedName: "祝晓萱", relation: "重生前后" }]);
    expect(assets.find((a) => a.kind === "scene")!.source_name).toBe("医院");
    expect(assets.find((a) => a.kind === "prop")!.source_name).toBe("手机");
  });
});

// --------------------------------------------------------------------
// 工具函数
// --------------------------------------------------------------------

describe("extractJson / isInputAudioRejected", () => {
  it("容忍 ```json 围栏", () => {
    expect(extractJson("```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
  });
  it("容忍前后杂散文本", () => {
    expect(extractJson("输出如下：{\"a\":1} 完毕")).toEqual({ a: 1 });
  });
  it("无 JSON 时抛错", () => {
    expect(() => extractJson("没有内容")).toThrow();
  });
  it("识别 input_audio 拒绝", () => {
    expect(isInputAudioRejected("网关 HTTP 400: unsupported content type input_audio")).toBe(true);
    expect(isInputAudioRejected("网关 HTTP 500: input_audio")).toBe(false);
    expect(isInputAudioRejected("网关 HTTP 400: bad request")).toBe(false);
  });
});

describe("runWithConcurrency", () => {
  it("并发不超过上限且全部完成", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 6 }, (_, i) => i);
    const results = await runWithConcurrency(items, 2, async (n) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      return n * 2;
    });
    expect(results).toEqual([0, 2, 4, 6, 8, 10]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});

// --------------------------------------------------------------------
// 双通道调用参数构造（mock 全局 fetch，不触网）
// --------------------------------------------------------------------

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

function chatResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const VISION_JSON = {
  overview: "单元概览",
  composition: "中景对称",
  camera: "固定机位",
  lighting: "顺光",
  color: "冷色调",
  rhythm: "缓",
  narrative: { act: "第一幕", events: ["开场"], causality: "" },
  characters: [{ name: "祝晓萱", firstSeenSeconds: 0, lastSeenSeconds: 8 }],
  scenes: [{ name: "办公室" }],
  props: [],
  shots: [
    {
      shot_no: "SC001",
      start_ms: 0,
      end_ms: 8000,
      shot_type: "中景",
      spatial_anchor: "平视",
      end_state_action: "人物坐下",
      scene_type: "对白场面",
      voice_type: "张嘴说话",
      emotion: "压抑",
      characters: ["祝晓萱"],
      dialogue: "无",
    },
  ],
};

const ASR_JSON = {
  sentences: [{ begin_ms: 1000, end_ms: 3000, text: "就是他拍的视频。", speaker: "祝晓萱" }],
};

/** 结构化判断 chat 请求里是否带 input_audio content part。 */
function hasInputAudioPart(body: {
  messages?: Array<{ content?: unknown }>;
}): boolean {
  return (body.messages ?? []).some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((p: { type?: string }) => p?.type === "input_audio"),
  );
}

function makeUnit(overrides: Partial<UnitMediaInput> = {}): UnitMediaInput {
  return {
    unitId: "part-001",
    videoUrl: "https://media.example.com/part-001.mp4",
    audioUrl: "https://media.example.com/part-001.wav",
    unitStartOffsetSec: 0,
    sourceStartSeconds: 0,
    durationSec: 60,
    frameUrls: ["https://media.example.com/f1.jpg", "https://media.example.com/f2.jpg"],
    ...overrides,
  };
}

describe("analyzeEpisodeUnits 双通道（fetch mock）", () => {
  const originalKey = process.env.LOVABLE_API_KEY;

  beforeEach(() => {
    process.env.LOVABLE_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.LOVABLE_API_KEY;
    else process.env.LOVABLE_API_KEY = originalKey;
  });

  it("视觉通道发 image_url parts，ASR 通道发 input_audio part", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === LOVABLE_URL) {
        const body = JSON.parse(String(init?.body));
        const hasAudio = hasInputAudioPart(body);
        return chatResponse(hasAudio ? ASR_JSON : VISION_JSON);
      }
      // 音频拉取
      return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const [result] = await analyzeEpisodeUnits([makeUnit()]);
    expect(result.ok).toBe(true);
    expect(result.degraded).toBeNull();
    expect(result.transcript).toEqual([
      { begin_ms: 1000, end_ms: 3000, text: "就是他拍的视频。", speaker: "祝晓萱" },
    ]);

    // 三次 fetch：视觉 chat、音频 GET、ASR chat
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const visionBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(visionBody.model).toBe("google/gemini-3.6-flash");
    expect(visionBody.response_format).toEqual({ type: "json_object" });
    const visionUser = visionBody.messages.find((m: { role: string }) => m.role === "user");
    const imageParts = visionUser.content.filter(
      (p: { type: string }) => p.type === "image_url",
    );
    expect(imageParts).toEqual([
      { type: "image_url", image_url: { url: "https://media.example.com/f1.jpg" } },
      { type: "image_url", image_url: { url: "https://media.example.com/f2.jpg" } },
    ]);
    const visionSystem = visionBody.messages.find((m: { role: string }) => m.role === "system");
    expect(visionSystem.content).toContain("video-analysis-extract");

    // 音频走 GET 拉取（第二次调用）
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://media.example.com/part-001.wav");

    const asrBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    const asrUser = asrBody.messages.find((m: { role: string }) => m.role === "user");
    const audioPart = asrUser.content.find((p: { type: string }) => p.type === "input_audio");
    expect(audioPart).toBeDefined();
    expect(audioPart.input_audio.format).toBe("wav");
    expect(audioPart.input_audio.data).toBe(
      Buffer.from(new Uint8Array([1, 2, 3]).buffer).toString("base64"),
    );
  });

  it("input_audio 被 HTTP 400 拒绝时降级为关键帧推断台词轨", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === LOVABLE_URL) {
        const body = JSON.parse(String(init?.body));
        if (hasInputAudioPart(body)) {
          return new Response("unsupported content part: input_audio", { status: 400 });
        }
        // 视觉通道与降级台词调用都返回各自 JSON：通过 system prompt 区分
        const system = body.messages.find((m: { role: string }) => m.role === "system");
        if (system.content.includes("input_audio_rejected")) return chatResponse(ASR_JSON);
        return chatResponse(VISION_JSON);
      }
      return new Response(new Uint8Array([1]).buffer, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const [result] = await analyzeEpisodeUnits([makeUnit()]);
    expect(result.ok).toBe(true);
    expect(result.degraded).toBe("input_audio_rejected");
    expect(result.transcript).toHaveLength(1);

    // 视觉 + 音频 GET + ASR(400) + 降级台词 = 4 次
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const degradedBody = JSON.parse(String(fetchMock.mock.calls[3][1]?.body));
    const degradedUser = degradedBody.messages.find((m: { role: string }) => m.role === "user");
    // 降级调用用关键帧而不是音频
    expect(
      degradedUser.content.some((p: { type: string }) => p.type === "image_url"),
    ).toBe(true);
    expect(
      degradedUser.content.some((p: { type: string }) => p.type === "input_audio"),
    ).toBe(false);
  });

  it("无 audioUrl 时台词要求并入视觉 prompt（dialogue_track）", async () => {
    const visionWithDialogue = {
      ...VISION_JSON,
      dialogue_track: [{ begin_ms: 500, end_ms: 1500, text: "画内台词", speaker: "unknown" }],
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      chatResponse(visionWithDialogue),
    );
    vi.stubGlobal("fetch", fetchMock);

    const [result] = await analyzeEpisodeUnits([makeUnit({ audioUrl: undefined })]);
    expect(result.ok).toBe(true);
    expect(result.degraded).toBe("no_audio");
    expect(result.transcript).toEqual([
      { begin_ms: 500, end_ms: 1500, text: "画内台词", speaker: "unknown" },
    ]);
    // 只有一次视觉调用
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const system = body.messages.find((m: { role: string }) => m.role === "system");
    expect(system.content).toContain("dialogue_track");
  });

  it("视觉通道失败 → 单元 ok:false（ASR 已并行启动,其结果被忽略）", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) => new Response("upstream boom", { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const [result] = await analyzeEpisodeUnits([makeUnit()]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("视觉通道失败");
    // 2026-08 提速:视觉/ASR 并行启动,视觉失败时 ASR 的音频拉取可能已发出,
    // 不再断言「不调用 ASR」;首个调用仍是视觉 chat。
    expect(String(fetchMock.mock.calls[0][0])).toBe(LOVABLE_URL);
  });

  it("多单元并发上限为 2", async () => {
    let active = 0;
    let maxActive = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === LOVABLE_URL) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active -= 1;
        const body = JSON.parse(String(init?.body));
        const hasAudio = hasInputAudioPart(body);
        return chatResponse(hasAudio ? ASR_JSON : VISION_JSON);
      }
      return new Response(new Uint8Array([1]).buffer, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const units = [1, 2, 3, 4].map((i) =>
      makeUnit({ unitId: `part-00${i}`, unitStartOffsetSec: (i - 1) * 60 }),
    );
    const results = await analyzeEpisodeUnits(units);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.map((r) => r.unitId)).toEqual([
      "part-001",
      "part-002",
      "part-003",
      "part-004",
    ]);
    // 2026-08 提速:每单元视觉+ASR 两路并行,单元并发上限 2 → chat 并发 <= 4
    expect(maxActive).toBeLessThanOrEqual(4);
  });
});

describe("analyzeOneUnit 视觉/ASR 并行（2026-08 提速）", () => {
  it("两路通道并发启动：任一未返回时另一路已在途", async () => {
    const started: string[] = [];
    const release: Array<() => void> = [];
    const callChat = (opts: { maxTokens?: number }) => {
      const tag = opts.maxTokens === 32_000 ? "vision" : "asr";
      started.push(tag);
      return new Promise<{ ok: true; text: string; model: string }>((resolve) => {
        release.push(() =>
          resolve({
            ok: true,
            text: JSON.stringify(tag === "vision" ? VISION_JSON : ASR_JSON),
            model: "m",
          }),
        );
      });
    };
    const fetchFn = (async () =>
      new Response(new Uint8Array([1]).buffer, { status: 200 })) as typeof fetch;
    const promise = analyzeEpisodeUnits([makeUnit()], { callChat, fetchFn });
    // 串行实现下 asr 不会在 vision 返回前启动
    await vi.waitFor(() => expect(started).toEqual(["vision", "asr"]));
    for (const done of release) done();
    const [result] = await promise;
    expect(result.ok).toBe(true);
    expect(result.transcript).toHaveLength(1);
  });

  it("视觉失败提前返回时 ASR 在途 promise 不产生未处理拒绝", async () => {
    const callChat = (opts: { maxTokens?: number }) =>
      opts.maxTokens === 32_000
        ? Promise.resolve({ ok: false as const, error: "视觉网关 500" })
        : // ASR 一路 reject(音频拉取/调用异常),不应成为 unhandled rejection
          Promise.reject(new Error("asr boom"));
    const fetchFn = (async () =>
      new Response(new Uint8Array([1]).buffer, { status: 200 })) as typeof fetch;
    const [result] = await analyzeEpisodeUnits([makeUnit()], { callChat, fetchFn });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("视觉通道失败");
  });
});
