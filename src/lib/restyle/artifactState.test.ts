import { describe, expect, it } from "vitest";
import {
  computeScopeHash,
  createInitialArtifact,
  transitionArtifact,
  type ArtifactState,
} from "./artifactState";

const V1_CONTENT = { groups: [{ group: ["EP01_SC01"], total_seconds: 5 }] };

function approvedState(): ArtifactState {
  let state = createInitialArtifact(V1_CONTENT, "hash-v1");
  state = transitionArtifact(state, { type: "ai_check", verdict: "pass", issues: [] });
  return state;
}

describe("transitionArtifact · 完整 approve 路径", () => {
  it("draft → ai_checked → user_approved，revision 递增", () => {
    let state = createInitialArtifact(V1_CONTENT, "hash-v1");
    expect(state.status).toBe("draft");
    expect(state.revision).toBe(1);
    expect(state.userContent).toBeNull();

    state = transitionArtifact(state, {
      type: "ai_check",
      verdict: "warn",
      issues: [{ severity: "minor", type: "other" }],
    });
    expect(state.status).toBe("ai_checked");
    expect(state.verdict).toBe("warn");
    expect(state.issues).toHaveLength(1);

    const userEdit = { groups: [{ group: ["EP01_SC01"], total_seconds: 6 }] };
    state = transitionArtifact(state, { type: "approve", userContent: userEdit });
    expect(state.status).toBe("user_approved");
    expect(state.userContent).toEqual(userEdit);
    expect(state.revision).toBe(2);

    // 再次 approve（采纳 AI 版本，不带改写）：revision 继续递增，userContent 保留
    state = transitionArtifact(state, { type: "approve" });
    expect(state.status).toBe("user_approved");
    expect(state.userContent).toEqual(userEdit);
    expect(state.revision).toBe(3);
  });

  it("已 user_approved 的产物不被 ai_check 降级", () => {
    const approved = transitionArtifact(approvedState(), { type: "approve" });
    const state = transitionArtifact(approved, {
      type: "ai_check",
      verdict: "fail",
      issues: [],
    });
    expect(state.status).toBe("user_approved");
    expect(state.verdict).toBe("fail");
  });
});

describe("transitionArtifact · approve 不覆写 content", () => {
  it("approve 之后 content 保持 AI 原版", () => {
    const before = approvedState();
    const after = transitionArtifact(before, {
      type: "approve",
      userContent: { groups: [] },
    });
    expect(after.content).toEqual(V1_CONTENT);
    expect(after.content).toBe(before.content);
  });
});

describe("transitionArtifact · upstream_changed", () => {
  it("scopeHash 不同 → 回落 draft 且保留旧 userContent", () => {
    let state = approvedState();
    const userEdit = { groups: [{ group: ["EP01_SC01"], total_seconds: 7 }] };
    state = transitionArtifact(state, { type: "approve", userContent: userEdit });

    state = transitionArtifact(state, { type: "upstream_changed", newScopeHash: "hash-v2" });
    expect(state.status).toBe("draft");
    expect(state.scopeHash).toBe("hash-v2");
    expect(state.userContent).toEqual(userEdit);
    expect(state.content).toEqual(V1_CONTENT);
  });

  it("scopeHash 相同 → 状态不变", () => {
    let state = approvedState();
    state = transitionArtifact(state, { type: "approve" });
    const after = transitionArtifact(state, { type: "upstream_changed", newScopeHash: "hash-v1" });
    expect(after).toBe(state);
    expect(after.status).toBe("user_approved");
  });
});

describe("transitionArtifact · reject 回 draft", () => {
  it("reject 置 rejected，ai_write 重生成后回到 draft 且保留 userContent", () => {
    let state = approvedState();
    state = transitionArtifact(state, { type: "approve", userContent: { note: "人工版" } });
    state = transitionArtifact(state, { type: "reject" });
    expect(state.status).toBe("rejected");

    state = transitionArtifact(state, {
      type: "ai_write",
      content: { groups: [{ group: ["EP01_SC02"], total_seconds: 4 }] },
      scopeHash: "hash-v2",
    });
    expect(state.status).toBe("draft");
    expect(state.content).toEqual({ groups: [{ group: ["EP01_SC02"], total_seconds: 4 }] });
    expect(state.scopeHash).toBe("hash-v2");
    // 重生成不覆盖人工改写
    expect(state.userContent).toEqual({ note: "人工版" });
    expect(state.verdict).toBeNull();
    expect(state.issues).toEqual([]);
  });
});

describe("computeScopeHash", () => {
  it("同输入同 hash", () => {
    const input = { episode: "EP01", shots: [{ no: "SC01", duration: 2.5 }] };
    expect(computeScopeHash(input)).toBe(computeScopeHash(input));
  });

  it("对象字段顺序无关", () => {
    const a = { stage: "grouping", episode: "EP01", shots: ["SC01", "SC02"] };
    const b = { shots: ["SC01", "SC02"], episode: "EP01", stage: "grouping" };
    expect(computeScopeHash(a)).toBe(computeScopeHash(b));
  });

  it("嵌套对象字段顺序无关，数组顺序敏感", () => {
    expect(computeScopeHash({ a: { x: 1, y: 2 } })).toBe(computeScopeHash({ a: { y: 2, x: 1 } }));
    expect(computeScopeHash({ shots: ["SC01", "SC02"] })).not.toBe(
      computeScopeHash({ shots: ["SC02", "SC01"] }),
    );
  });

  it("内容不同 hash 不同，且输出为 8 位十六进制", () => {
    const h1 = computeScopeHash({ v: 1 });
    const h2 = computeScopeHash({ v: 2 });
    expect(h1).not.toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{8}$/);
  });
});
