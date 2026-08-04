// ====================================================================
//  restyleGrouping.core 测试：
//   - 闸门拦截：image_gen 阶段产物未 user_approved 时 STAGE_NOT_APPROVED
//     （不调导演模型、不扣费）
//   - 生成成功路径：AI 方案通过校验 → 整表替换 restyle_groups（
//     needs_confirmation + scope_hash）→ 产物确认记录（groupCount /
//     totalDurationSeconds / scopeHash）→ 连贯性核对进 issues →
//     幂等键 grouping:{projectId}:{episodeId}:{scopeHash} 扣 1 分
//   - AI 方案未通过校验 → packShotsIntoGroups 兜底修正
//   - updateGroupingCore：INVALID_GROUPS / SCOPE_STALE / 成功回落 draft
//  supabase / callChat / ensureCredits / chargeCredits 全部注入 mock。
// ====================================================================

import { describe, expect, it, vi } from "vitest";
import {
  generateGroupingCore,
  updateGroupingCore,
  type GroupingDeps,
} from "./restyleGrouping.core";
import { groupingScopeHash, type GroupingShot } from "./grouping";

vi.mock("../errorLogs.server", () => ({ logGenerationError: () => {} }));

type Op = { m: string; a: unknown[] };
type Resp = { data?: unknown; error?: { message: string } | null };
type Responder = (table: string, ops: Op[], opts: { single: boolean }) => Resp;

/** 链式 supabase mock（与 restyleImageGen.core.test.ts 同款）。 */
function createMockSupabase(respond: Responder) {
  class MockQuery {
    constructor(
      private table: string,
      private ops: Op[] = [],
    ) {}
    private push(m: string, a: unknown[]) {
      return new MockQuery(this.table, [...this.ops, { m, a }]);
    }
    select(...a: unknown[]) { return this.push("select", a); }
    eq(...a: unknown[]) { return this.push("eq", a); }
    in(...a: unknown[]) { return this.push("in", a); }
    order(...a: unknown[]) { return this.push("order", a); }
    insert(a: unknown) { return this.push("insert", [a]); }
    update(a: unknown) { return this.push("update", [a]); }
    delete() { return this.push("delete", []); }
    private exec(single: boolean): Promise<Resp> {
      return Promise.resolve(respond(this.table, this.ops, { single }));
    }
    async maybeSingle() {
      const resp = await this.exec(true);
      const data = Array.isArray(resp.data) ? (resp.data[0] ?? null) : (resp.data ?? null);
      return { data, error: resp.error ?? null };
    }
    async single() {
      return this.maybeSingle();
    }
    then<TResult1 = Resp, TResult2 = never>(
      onfulfilled?: ((value: Resp) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return this.exec(false).then(onfulfilled, onrejected);
    }
  }
  return { from: (table: string) => new MockQuery(table) };
}

// --------------------------------------------------------------------
// 固定数据：一集 6 镜 × 2s（共 12s）
// --------------------------------------------------------------------

const SHOT_ROWS = Array.from({ length: 6 }, (_, i) => ({
  id: `s${i + 1}`,
  shot_no: `SC${String(i + 1).padStart(2, "0")}`,
  start_ms: i * 2000,
  end_ms: (i + 1) * 2000,
  scene_type: "内景·办公室",
  characters: ["MARA"],
  props: [],
  dialogue: i === 0 ? "你必须签字。" : null,
  emotion: "压抑",
  end_state_action: "MARA 低头沉默",
}));

const SCOPE_SHOTS: GroupingShot[] = SHOT_ROWS.map((row) => ({
  id: row.id,
  shotNo: row.shot_no,
  startMs: row.start_ms,
  endMs: row.end_ms,
  sceneType: row.scene_type,
  characters: row.characters,
  dialogue: row.dialogue,
  endStateAction: row.end_state_action,
}));

const SCOPE_LOOKS = [
  { characterId: "c1", name: "造型 1", fromShot: "EP01_SC01", toShot: "EP01_SC06" },
];

const EPISODE = { id: "ep1", episode_no: 1, project_id: "p1" };

function artifactRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "art_1",
    status: "draft",
    content: {},
    user_content: null,
    scope_hash: groupingScopeHash("ep1", SCOPE_SHOTS, SCOPE_LOOKS),
    revision: 1,
    verdict: null,
    issues: [],
    ...overrides,
  };
}

interface Captured {
  groupInserts: Array<Record<string, unknown>>;
  groupDeletes: number;
  artifactInserts: Array<Record<string, unknown>>;
  artifactUpdates: Array<Record<string, unknown>>;
}

/** 默认 responder：闸门放行、集/分镜/角色/换装齐全、产物不存在（插入路径）。 */
function createGroupingSupabase(captured: Captured, artifact: Record<string, unknown> | null = null) {
  return createMockSupabase((table, ops, { single }) => {
    const write = ops.find((op) => op.m === "insert" || op.m === "update" || op.m === "delete");
    if (table === "restyle_groups") {
      if (write?.m === "delete") captured.groupDeletes += 1;
      if (write?.m === "insert") captured.groupInserts.push(write.a[0] as Record<string, unknown>);
      return { data: null };
    }
    if (table === "restyle_artifacts") {
      if (write?.m === "insert") {
        captured.artifactInserts.push(write.a[0] as Record<string, unknown>);
        return { data: null };
      }
      if (write?.m === "update") {
        captured.artifactUpdates.push(write.a[0] as Record<string, unknown>);
        return { data: null };
      }
      if (single) return { data: artifact };
      // 阶段闸门：image_gen 两个节点均已确认。
      return {
        data: [
          { node_key: "looks", status: "user_approved" },
          { node_key: "prompts", status: "user_approved" },
        ],
      };
    }
    if (table === "restyle_episodes") return { data: EPISODE };
    if (table === "restyle_shots") return { data: SHOT_ROWS };
    if (table === "restyle_characters") return { data: [{ id: "c1", name: "MARA" }] };
    if (table === "restyle_character_looks") {
      return {
        data: [
          { id: "l1", character_id: "c1", name: "造型 1", from_shot: "EP01_SC01", to_shot: "EP01_SC06" },
        ],
      };
    }
    return { data: null };
  });
}

function newCaptured(): Captured {
  return { groupInserts: [], groupDeletes: 0, artifactInserts: [], artifactUpdates: [] };
}

const okEnsure: NonNullable<GroupingDeps["ensureCredits"]> = async () => ({ ok: true });

function makeCallChat(groupingText: string, reviewText = '{"verdict":"pass","issues":[]}') {
  const fn = vi.fn();
  fn.mockResolvedValueOnce({ ok: true, text: groupingText, model: "openai/gpt-5.6-sol" });
  fn.mockResolvedValueOnce({ ok: true, text: reviewText, model: "openai/gpt-5.6-sol" });
  return fn as unknown as NonNullable<GroupingDeps["callChat"]> & ReturnType<typeof vi.fn>;
}

// --------------------------------------------------------------------
// 闸门拦截
// --------------------------------------------------------------------

describe("generateGroupingCore 闸门", () => {
  it("image_gen 阶段产物未全部 user_approved 时拦截（不调模型、不扣费）", async () => {
    const supabase = createMockSupabase((table) =>
      table === "restyle_artifacts"
        ? { data: [{ node_key: "looks", status: "user_approved" }, { node_key: "prompts", status: "draft" }] }
        : { data: null },
    );
    const callChat = makeCallChat("{}");
    const charge = vi.fn();
    const result = await generateGroupingCore(
      { projectId: "p1", episodeId: "ep1" },
      { supabase, userId: "u1", callChat, ensureCredits: okEnsure, chargeCredits: charge },
    );
    expect(result).toEqual({ ok: false, code: "STAGE_NOT_APPROVED", pending: ["prompts"] });
    expect(callChat).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });

  it("积分不足时拦截", async () => {
    const result = await generateGroupingCore(
      { projectId: "p1", episodeId: "ep1" },
      {
        supabase: createMockSupabase(() => ({ data: null })),
        userId: "u1",
        ensureCredits: async () => ({ ok: false, error: "余额不足", balance: 0, required: 1 }),
      },
    );
    expect(result).toMatchObject({ ok: false, code: "INSUFFICIENT_CREDITS" });
  });
});

// --------------------------------------------------------------------
// 生成成功路径
// --------------------------------------------------------------------

describe("generateGroupingCore 成功路径", () => {
  it("AI 方案通过校验：整表替换 + 确认记录 + 连贯性核对 + 幂等扣费", async () => {
    const captured = newCaptured();
    const supabase = createGroupingSupabase(captured);
    const groupingText = JSON.stringify({
      groups: [
        { group: ["EP01_SC01", "EP01_SC02", "EP01_SC03"], reason: "开场压迫段" },
        { group: ["EP01_SC04", "EP01_SC05", "EP01_SC06"], reason: "冲突升级段" },
      ],
    });
    const callChat = makeCallChat(
      groupingText,
      '{"verdict":"warn","issues":[{"severity":"major","type":"continuity_risk","description":"MARA 服装跨组不一致"}]}',
    );
    const charge = vi.fn().mockResolvedValue({ ok: true, balanceAfter: 9 });

    const result = await generateGroupingCore(
      { projectId: "p1", episodeId: "ep1" },
      { supabase, userId: "u1", callChat, ensureCredits: okEnsure, chargeCredits: charge },
    );

    expect(result).toMatchObject({
      ok: true,
      groupCount: 2,
      totalDurationSeconds: 12,
      usedPackerFallback: false,
      verdict: "warn",
    });

    // 整表按集替换：先删后插，两行各 6s、needs_confirmation、带 scope_hash。
    expect(captured.groupDeletes).toBe(1);
    expect(captured.groupInserts).toHaveLength(1);
    const rows = captured.groupInserts[0] as unknown as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      group_no: 1,
      shot_ids: ["s1", "s2", "s3"],
      reason: "开场压迫段",
      total_seconds: 6,
      status: "needs_confirmation",
    });
    expect(typeof rows[0].scope_hash).toBe("string");

    // 分组确认记录：stage=grouping、node_key=episodeId、含统计与 scopeHash。
    expect(captured.artifactInserts).toHaveLength(1);
    const artifact = captured.artifactInserts[0];
    expect(artifact).toMatchObject({ stage: "grouping", node_key: "ep1", status: "ai_checked" });
    const content = artifact.content as Record<string, unknown>;
    expect(content).toMatchObject({
      status: "needs_confirmation",
      groupCount: 2,
      totalDurationSeconds: 12,
      writer: "doopoo/restyleGrouping.functions",
    });
    expect(typeof content.scopeHash).toBe("string");
    // 连贯性核对 issues 进产物。
    const issues = artifact.issues as Array<{ type: string }>;
    expect(issues.some((issue) => issue.type === "continuity_risk")).toBe(true);

    // 幂等扣费 1 分。
    expect(charge).toHaveBeenCalledTimes(1);
    const chargeArgs = charge.mock.calls[0][0] as { amount: number; idempotencyKey: string };
    expect(chargeArgs.amount).toBe(1);
    expect(chargeArgs.idempotencyKey).toBe(
      `grouping:p1:ep1:${groupingScopeHash("ep1", SCOPE_SHOTS, SCOPE_LOOKS)}`,
    );
  });

  it("AI 方案引用未知分镜 → packShotsIntoGroups 兜底修正", async () => {
    const captured = newCaptured();
    const supabase = createGroupingSupabase(captured);
    const callChat = makeCallChat('{"groups":[{"group":["EP01_SC99"],"reason":"幻觉分镜"}]}');
    const result = await generateGroupingCore(
      { projectId: "p1", episodeId: "ep1" },
      {
        supabase,
        userId: "u1",
        callChat,
        ensureCredits: okEnsure,
        chargeCredits: vi.fn().mockResolvedValue({ ok: true, balanceAfter: 9 }),
      },
    );
    expect(result).toMatchObject({ ok: true, usedPackerFallback: true, groupCount: 1 });
    const rows = captured.groupInserts[0] as unknown as Array<Record<string, unknown>>;
    expect(rows[0].shot_ids).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
    expect(rows[0].total_seconds).toBe(12);
    if (result.ok) {
      expect(result.issues.some((issue) => issue.type === "ai_plan_fallback")).toBe(true);
    }
  });
});

// --------------------------------------------------------------------
// 手动调整保存
// --------------------------------------------------------------------

describe("updateGroupingCore", () => {
  const validGroups = [
    { shotIds: ["s1", "s2", "s3"], reason: "前半" },
    { shotIds: ["s4", "s5", "s6"], reason: "后半" },
  ];

  it("覆盖不全 → INVALID_GROUPS（不进库）", async () => {
    const captured = newCaptured();
    const supabase = createGroupingSupabase(captured, artifactRow());
    const result = await updateGroupingCore(
      {
        projectId: "p1",
        episodeId: "ep1",
        groups: [{ shotIds: ["s1", "s2", "s3"], reason: "只有前半" }],
      },
      { supabase, userId: "u1" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_GROUPS");
      expect(result.errors?.some((e) => e.type === "uncovered_shot" && e.shotId === "s4")).toBe(true);
    }
    expect(captured.groupInserts).toHaveLength(0);
  });

  it("scope_hash 失效 → SCOPE_STALE（需重新生成）", async () => {
    const captured = newCaptured();
    const supabase = createGroupingSupabase(captured, artifactRow({ scope_hash: "stale-hash" }));
    const result = await updateGroupingCore(
      { projectId: "p1", episodeId: "ep1", groups: validGroups },
      { supabase, userId: "u1" },
    );
    expect(result).toMatchObject({ ok: false, code: "SCOPE_STALE" });
    expect(captured.groupInserts).toHaveLength(0);
  });

  it("校验通过 → 整表替换 + 产物 user_content 记录人工版本并回落 draft", async () => {
    const captured = newCaptured();
    const supabase = createGroupingSupabase(
      captured,
      artifactRow({ status: "user_approved" }),
    );
    const result = await updateGroupingCore(
      { projectId: "p1", episodeId: "ep1", groups: validGroups },
      { supabase, userId: "u1" },
    );
    expect(result).toMatchObject({ ok: true, groupCount: 2, totalDurationSeconds: 12 });

    const rows = captured.groupInserts[0] as unknown as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ group_no: 1, shot_ids: ["s1", "s2", "s3"], total_seconds: 6 });

    expect(captured.artifactUpdates).toHaveLength(1);
    const update = captured.artifactUpdates[0];
    expect(update.status).toBe("draft");
    expect(update.approved_by).toBeNull();
    const userContent = update.user_content as Record<string, unknown>;
    expect(userContent).toMatchObject({
      writer: "user",
      groupCount: 2,
      totalDurationSeconds: 12,
      status: "needs_confirmation",
    });
  });
});
