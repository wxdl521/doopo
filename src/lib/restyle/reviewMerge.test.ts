import { describe, expect, it, vi } from "vitest";
import {
  checkShotDialogueFit,
  dialogueDurationSec,
  mergeIssues,
  validateReviewPayload,
  SPEECH_RATE_CPS,
  type ReviewIssue,
} from "./reviewMerge";
import {
  runAiSelfReviewCore,
  REVIEW_DOC_KINDS,
} from "./restyleReview.core";
import {
  INTERNAL_DIRECTOR_FALLBACK_MODEL,
  INTERNAL_DIRECTOR_MODEL,
} from "./lovableGateway";

// --------------------------------------------------------------------
// validateReviewPayload · 宽容解析
// --------------------------------------------------------------------

describe("validateReviewPayload", () => {
  it("合法 payload 原样通过", () => {
    const result = validateReviewPayload({
      verdict: "pass_with_notes",
      issues: [
        {
          issueType: "character_missing",
          severity: "high",
          description: "人物甲未在人设表",
          suggestion: "补充人设",
          shotNo: "SC001",
          assetName: "甲",
        },
      ],
      patched: { characters: [] },
    });
    expect(result.verdict).toBe("pass_with_notes");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      issueType: "character_missing",
      severity: "high",
      shotNo: "SC001",
      assetName: "甲",
    });
    expect(result.patched).toEqual({ characters: [] });
  });

  it("脏输入不炸：null / 数字 / 数组 / 非 JSON 字符串均回落默认", () => {
    for (const raw of [null, undefined, 42, [1, 2], "not json at all", true]) {
      const result = validateReviewPayload(raw);
      expect(result.verdict).toBe("pass");
      expect(result.issues).toEqual([]);
      expect(result.patched).toBeUndefined();
    }
  });

  it("接受带围栏的 JSON 字符串", () => {
    const raw = "前言杂散\n```json\n{\"verdict\":\"fail\",\"issues\":[]}\n```\n后记";
    const result = validateReviewPayload(raw);
    expect(result.verdict).toBe("fail");
    expect(result.issues).toEqual([]);
  });

  it("缺字段补默认：空对象、非对象 issue 被丢弃", () => {
    const result = validateReviewPayload({ issues: [{}, "junk", null, { description: "x" }] });
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toMatchObject({ issueType: "other", severity: "low", description: "" });
    expect(result.issues[1]).toMatchObject({ description: "x" });
    // 非法 verdict 缺失 → 有 issue 但无 high → pass_with_notes
    expect(result.verdict).toBe("pass_with_notes");
  });

  it("非法枚举降级 + 旧口径别名归一", () => {
    const result = validateReviewPayload({
      verdict: "warn",
      issues: [
        { type: "relation_open", severity: "blocker", description: "a" },
        { issueType: "x", severity: "major", description: "b" },
        { issueType: "y", severity: "minor", description: "c" },
        { issueType: "z", severity: "critical", description: "d" },
      ],
    });
    expect(result.verdict).toBe("pass_with_notes");
    expect(result.issues.map((i) => i.severity)).toEqual(["high", "medium", "low", "low"]);
    expect(result.issues[0].issueType).toBe("relation_open");
  });

  it("shot_no / asset_name 蛇形字段兼容", () => {
    const result = validateReviewPayload({
      verdict: "pass",
      issues: [{ issueType: "t", severity: "low", description: "d", shot_no: "SC002", asset_name: "乙" }],
    });
    expect(result.issues[0].shotNo).toBe("SC002");
    expect(result.issues[0].assetName).toBe("乙");
  });

  it("verdict 缺失时按 issues 推断：含 high → fail", () => {
    const result = validateReviewPayload({
      issues: [{ issueType: "t", severity: "high", description: "d" }],
    });
    expect(result.verdict).toBe("fail");
  });
});

// --------------------------------------------------------------------
// mergeIssues · 归并与 severity 取高
// --------------------------------------------------------------------

describe("mergeIssues", () => {
  const base: ReviewIssue = {
    issueType: "dialogue_overrun",
    severity: "low",
    description: "SC001 台词超标",
    suggestion: "精简",
  };

  it("同 issueType+description 去重，severity 取最高", () => {
    const merged = mergeIssues([
      [base],
      [{ ...base, severity: "medium" }],
      [{ ...base, severity: "high" }],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].severity).toBe("high");
  });

  it("medium 不会被后来的 low 降级", () => {
    const merged = mergeIssues([
      [{ ...base, severity: "medium" }],
      [{ ...base, severity: "low" }],
    ]);
    expect(merged[0].severity).toBe("medium");
  });

  it("不同 description / issueType 不归并", () => {
    const merged = mergeIssues([
      [base, { ...base, description: "SC002 台词超标" }],
      [{ ...base, issueType: "timeline_gap" }],
    ]);
    expect(merged).toHaveLength(3);
  });

  it("定位字段空缺由后出现的重复项补齐", () => {
    const merged = mergeIssues([[base], [{ ...base, shotNo: "SC001" }]]);
    expect(merged[0].shotNo).toBe("SC001");
  });
});

// --------------------------------------------------------------------
// dialogueDurationSec · 中英混排
// --------------------------------------------------------------------

describe("dialogueDurationSec", () => {
  it("纯中文按 cps 计费", () => {
    expect(dialogueDurationSec("你好世界")).toBeCloseTo(4 / SPEECH_RATE_CPS);
  });

  it("纯英文按 2.5 词/秒计费", () => {
    expect(dialogueDurationSec("hello world")).toBeCloseTo(2 / 2.5);
  });

  it("中英混排分开计费后相加", () => {
    // 2 个中文字 / 4 + 1 个英文词 / 2.5 = 0.5 + 0.4
    expect(dialogueDurationSec("你好 world")).toBeCloseTo(0.9);
  });

  it("标点与空白不计时", () => {
    expect(dialogueDurationSec("你好，世界！")).toBeCloseTo(1);
    expect(dialogueDurationSec("")).toBe(0);
  });

  it("支持自定义语速", () => {
    expect(dialogueDurationSec("你好世界", 2)).toBeCloseTo(2);
  });
});

// --------------------------------------------------------------------
// checkShotDialogueFit · 超标与边界
// --------------------------------------------------------------------

describe("checkShotDialogueFit", () => {
  it("朗读时长 > shot 时长 − 0.5s 产出 medium issue", () => {
    // 8 字 / 4cps = 2.0s，shot 2s − 0.5 = 1.5s → 超标
    const issues = checkShotDialogueFit([
      { shotNo: "SC001", durationSec: 2, dialogue: "一二三四五六七八" },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      issueType: "dialogue_overrun",
      severity: "medium",
      shotNo: "SC001",
    });
    expect(issues[0].suggestion).toBeTruthy();
  });

  it("恰好等于边界（speech == duration − 0.5）视为达标", () => {
    // 8 字 / 4cps = 2.0s，shot 2.5s − 0.5 = 2.0s → 恰好达标，不标红
    const issues = checkShotDialogueFit([
      { shotNo: "SC001", durationSec: 2.5, dialogue: "一二三四五六七八" },
    ]);
    expect(issues).toEqual([]);
  });

  it("无台词的分镜跳过", () => {
    const issues = checkShotDialogueFit([
      { shotNo: "SC001", durationSec: 1 },
      { shotNo: "SC002", durationSec: 1, dialogue: "   " },
    ]);
    expect(issues).toEqual([]);
  });
});

// --------------------------------------------------------------------
// runAiSelfReviewCore · 闸门与 AI 调用
// --------------------------------------------------------------------

type FakeTableConfig = {
  /** select 非 maybeSingle 返回的行（可按 select 列名区分同表多次查询）。 */
  rowsByColumns?: Record<string, unknown[]>;
  /** maybeSingle 返回的行。 */
  maybeSingleRow?: unknown;
  error?: { message: string } | null;
};

function makeFakeSupabase(tables: Record<string, FakeTableConfig>) {
  const log: Array<{ table: string; method: string; payload?: unknown }> = [];

  const resolve = (state: {
    table: string;
    method: string;
    columns?: string;
    maybeSingle: boolean;
  }) => {
    const config = tables[state.table];
    if (!config) return { data: null, error: { message: `no fake for ${state.table}` } };
    if (state.method === "select") {
      if (state.maybeSingle) {
        return { data: config.maybeSingleRow ?? null, error: config.error ?? null };
      }
      const rows = config.rowsByColumns?.[state.columns ?? ""] ?? [];
      return { data: rows, error: config.error ?? null };
    }
    return { data: null, error: config.error ?? null };
  };

  const makeQuery = (table: string) => {
    const state = { table, method: "select", columns: undefined as string | undefined, maybeSingle: false };
    const q: Record<string, unknown> = {};
    const chain = (name: string, fn: (...args: unknown[]) => void) => {
      q[name] = (...args: unknown[]) => {
        fn(...args);
        return q;
      };
    };
    chain("select", (cols) => {
      state.method = "select";
      state.columns = typeof cols === "string" ? cols : "";
    });
    for (const m of ["eq", "in", "is", "order", "lt", "gte"]) chain(m, () => {});
    chain("delete", () => {
      state.method = "delete";
      log.push({ table, method: "delete" });
    });
    chain("insert", (payload) => {
      state.method = "insert";
      log.push({ table, method: "insert", payload });
    });
    chain("update", (payload) => {
      state.method = "update";
      log.push({ table, method: "update", payload });
    });
    q.maybeSingle = async () => {
      state.maybeSingle = true;
      return resolve(state);
    };
    q.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(resolve(state)).then(onF, onR);
    return q;
  };

  return {
    log,
    supabase: { from: (table: string) => makeQuery(table) },
  };
}

const APPROVED_ANALYSIS_ROWS = [{ node_key: "ep1", status: "user_approved" }];

function approvedDb(overrides: Record<string, FakeTableConfig> = {}) {
  return makeFakeSupabase({
    restyle_artifacts: {
      rowsByColumns: { "node_key, status": APPROVED_ANALYSIS_ROWS },
      maybeSingleRow: null,
    },
    restyle_episodes: {
      rowsByColumns: {
        "id, episode_no, analysis_json": [
          { id: "ep1", episode_no: 1, analysis_json: { overview: "整片理解" } },
        ],
      },
    },
    restyle_shots: {
      rowsByColumns: {
        "episode_id, shot_no, start_ms, end_ms, characters, dialogue, voice_type, scene_type": [
          {
            episode_id: "ep1",
            shot_no: "SC001",
            start_ms: 0,
            end_ms: 2500,
            characters: ["甲"],
            dialogue: "一二三四五六七八",
            voice_type: "张嘴说话",
            scene_type: "对白场面",
          },
        ],
      },
    },
    restyle_transcripts: { rowsByColumns: { "episode_id, begin_ms, end_ms, text, speaker": [] } },
    restyle_source_assets: {
      rowsByColumns: {
        "episode_id, kind, source_name, aliases, appearance, wardrobe, description, relationships":
          [],
      },
    },
    restyle_reviews: {},
    ...overrides,
  });
}

const AI_RESPONSE = JSON.stringify({
  verdict: "pass_with_notes",
  issues: [
    {
      issueType: "character_missing",
      severity: "high",
      description: "人物甲未在人设表",
      suggestion: "补充人设",
    },
  ],
  issue_list: [
    {
      episode: "EP01",
      issue_type: "人设冲突",
      current: "甲人设缺失",
      risk: "生图不一致",
      suggestion: "补充人设",
      severity: "blocker",
    },
  ],
  shot_comparison: [
    {
      episode: "EP01",
      shot_no: "SC001",
      source_summary: "甲说话",
      target_summary: "甲说话",
      characters_match: true,
      dialogue_match: true,
      notes: "",
    },
  ],
  duration_dialogue_audit: [{ episode: "EP01", shot_no: "SC001", fits: true }],
});

type FakeChatResult =
  | { ok: true; text: string; model: string }
  | { ok: false; error: string };

function makeDeps(
  db: ReturnType<typeof approvedDb>,
  callChatImpl?: (opts: { model: string }) => FakeChatResult,
) {
  const callChat = vi.fn(async (opts: { model: string }): Promise<FakeChatResult> => {
    if (callChatImpl) return callChatImpl(opts);
    return { ok: true, text: AI_RESPONSE, model: opts.model };
  });
  return {
    callChat,
    deps: {
      supabase: db.supabase,
      userId: "user-1",
      callChat,
      ensureCredits: async () => ({ ok: true as const }),
    },
  };
}

describe("runAiSelfReviewCore · 阶段闸门", () => {
  it("analysis 未全部 user_approved → STAGE_NOT_APPROVED，不调 AI", async () => {
    const db = approvedDb({
      restyle_artifacts: {
        rowsByColumns: {
          "node_key, status": [
            { node_key: "ep1", status: "user_approved" },
            { node_key: "ep2", status: "draft" },
          ],
        },
      },
    });
    const { callChat, deps } = makeDeps(db);
    const result = await runAiSelfReviewCore({ projectId: "p1" }, deps);
    expect(result).toMatchObject({ ok: false, code: "STAGE_NOT_APPROVED", pending: ["ep2"] });
    expect(callChat).not.toHaveBeenCalled();
  });

  it("analysis 无任何产物 → 闸门不放行", async () => {
    const db = approvedDb({
      restyle_artifacts: { rowsByColumns: { "node_key, status": [] } },
    });
    const { callChat, deps } = makeDeps(db);
    const result = await runAiSelfReviewCore({ projectId: "p1" }, deps);
    expect(result).toMatchObject({ ok: false, code: "STAGE_NOT_APPROVED" });
    expect(callChat).not.toHaveBeenCalled();
  });

  it("积分不足 → INSUFFICIENT_CREDITS，闸门之前就拦截", async () => {
    const db = approvedDb();
    const { callChat, deps } = makeDeps(db);
    const result = await runAiSelfReviewCore(
      { projectId: "p1" },
      {
        ...deps,
        ensureCredits: async () => ({
          ok: false as const,
          error: "积分余额不足",
          balance: -1,
          required: 2,
        }),
      },
    );
    expect(result).toMatchObject({ ok: false, code: "INSUFFICIENT_CREDITS" });
    expect(callChat).not.toHaveBeenCalled();
    expect(db.log).toHaveLength(0);
  });
});

describe("runAiSelfReviewCore · AI 调用与落库", () => {
  it("闸门通过后调主模型，写三表并推进产物到 ai_checked", async () => {
    const db = approvedDb();
    const { callChat, deps } = makeDeps(db);
    const result = await runAiSelfReviewCore({ projectId: "p1", episodeId: "ep1" }, deps);

    expect(result).toMatchObject({
      ok: true,
      verdict: "pass_with_notes",
      model: INTERNAL_DIRECTOR_MODEL,
      usedFallback: false,
    });

    // AI 调用参数：主模型 + 双 skill 规约 + 上下文
    expect(callChat).toHaveBeenCalledTimes(1);
    const call = callChat.mock.calls[0][0] as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      jsonMode?: boolean;
    };
    expect(call.model).toBe(INTERNAL_DIRECTOR_MODEL);
    expect(call.jsonMode).toBe(true);
    const system = call.messages[0].content;
    expect(system).toContain("统一输出契约"); // ai-output-review 规约
    expect(system).toContain("叙事一致性问题清单"); // narrative-consistency-audit 规约
    expect(system).toContain("[CONTEXT]");
    expect(system).toContain("整片理解");

    // 三表写入 restyle_reviews：narrative 2 行（表一 + verdict issue）+ shot_mapping 1 行
    const reviewInserts = db.log.filter((l) => l.table === "restyle_reviews" && l.method === "insert");
    expect(reviewInserts).toHaveLength(1);
    const rows = reviewInserts[0].payload as Array<{ doc_kind: string }>;
    const kinds = rows.map((r) => r.doc_kind);
    expect(kinds.filter((k) => k === "narrative_issues")).toHaveLength(2);
    expect(kinds.filter((k) => k === "shot_mapping")).toHaveLength(1);
    expect(kinds.every((k) => (REVIEW_DOC_KINDS as readonly string[]).includes(k))).toBe(true);
    if (result.ok) {
      expect(result.docCounts).toEqual({ narrative_issues: 2, shot_mapping: 1, dialogue_fit: 0 });
    }

    // 产物 upsert：新建行，node_key=episodeId，ai_check 推进到 ai_checked
    const artifactInserts = db.log.filter(
      (l) => l.table === "restyle_artifacts" && l.method === "insert",
    );
    expect(artifactInserts).toHaveLength(1);
    expect(artifactInserts[0].payload).toMatchObject({
      project_id: "p1",
      stage: "review",
      node_key: "ep1",
      status: "ai_checked",
      verdict: "pass_with_notes",
    });
  });

  it("主模型失败回退到 fallback 模型重试一次", async () => {
    const db = approvedDb();
    const { callChat, deps } = makeDeps(db, (opts) =>
      opts.model === INTERNAL_DIRECTOR_MODEL
        ? { ok: false, error: "网关 HTTP 500" }
        : { ok: true, text: AI_RESPONSE, model: opts.model },
    );
    const result = await runAiSelfReviewCore({ projectId: "p1" }, deps);
    expect(result).toMatchObject({ ok: true, usedFallback: true, model: INTERNAL_DIRECTOR_FALLBACK_MODEL });
    expect(callChat).toHaveBeenCalledTimes(2);
    expect((callChat.mock.calls[1][0] as { model: string }).model).toBe(
      INTERNAL_DIRECTOR_FALLBACK_MODEL,
    );
    // 全项目审核：node_key 为 "project"
    const artifactInsert = db.log.find((l) => l.table === "restyle_artifacts" && l.method === "insert");
    expect(artifactInsert?.payload).toMatchObject({ node_key: "project" });
  });

  it("主备模型都失败 → AI_CALL_FAILED，不落库", async () => {
    const db = approvedDb();
    const { deps } = makeDeps(db, () => ({ ok: false, error: "网关超时" }));
    const result = await runAiSelfReviewCore({ projectId: "p1" }, deps);
    expect(result).toMatchObject({ ok: false, code: "AI_CALL_FAILED" });
    expect(db.log.filter((l) => l.method === "insert")).toHaveLength(0);
  });

  it("本地台词超标与 AI 复核归并后写入 dialogue_fit 表", async () => {
    const db = approvedDb({
      restyle_shots: {
        rowsByColumns: {
          "episode_id, shot_no, start_ms, end_ms, characters, dialogue, voice_type, scene_type": [
            {
              episode_id: "ep1",
              shot_no: "SC001",
              start_ms: 0,
              end_ms: 2000, // 2s，8 字朗读 2s > 1.5s → 本地超标
              characters: [],
              dialogue: "一二三四五六七八",
              voice_type: null,
              scene_type: null,
            },
          ],
        },
      },
    });
    const { deps } = makeDeps(db);
    const result = await runAiSelfReviewCore({ projectId: "p1", episodeId: "ep1" }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.docCounts.dialogue_fit).toBe(1);
    const reviewInsert = db.log.find((l) => l.table === "restyle_reviews" && l.method === "insert");
    const rows = reviewInsert?.payload as Array<{ doc_kind: string; issue_type: string }>;
    expect(rows.filter((r) => r.doc_kind === "dialogue_fit")).toHaveLength(1);
    expect(rows.find((r) => r.doc_kind === "dialogue_fit")?.issue_type).toBe("dialogue_overrun");
  });
});
