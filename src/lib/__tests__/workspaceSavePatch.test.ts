// ====================================================================
// workspaceSavePatch（字段级合并 patch 语义）+ withLoadRetry 测试
// ====================================================================
import { describe, expect, it } from "vitest";
import { withLoadRetry } from "../withWatchdog";
import { buildWorkspaceDataPatch, STORYBOARD_STRUCTURE_KEYS } from "../workspaceSavePatch";

describe("buildWorkspaceDataPatch", () => {
  const full = {
    outline: { logline: "x" },
    characters: [{ id: "c1" }],
    storyboard: [{ id: "p1" }],
    storyboardGroups: [{ id: "g1" }],
    props: [],
  };

  it("分镜未 ready：storyboard/storyboardGroups 不进 patch,其余键正常提交", () => {
    const patch = buildWorkspaceDataPatch({
      workspaceData: full,
      storyboardStructureReady: false,
    });
    expect(patch.storyboard).toBeUndefined();
    expect(patch.storyboardGroups).toBeUndefined();
    expect(patch.characters).toEqual([{ id: "c1" }]);
    expect(patch.outline).toEqual({ logline: "x" });
  });

  it("ready：全量提交;显式空数组（用户真实清空）允许覆盖不剔除", () => {
    const patch = buildWorkspaceDataPatch({
      workspaceData: { ...full, storyboard: [], storyboardGroups: [] },
      storyboardStructureReady: true,
    });
    expect(patch.storyboard).toEqual([]);
    expect(patch.storyboardGroups).toEqual([]);
    expect(Object.keys(patch)).toEqual(Object.keys(full));
  });

  it("undefined 键不进 patch（防御）", () => {
    const patch = buildWorkspaceDataPatch({
      workspaceData: { characters: [], storyboard: undefined } as Record<string, unknown>,
      storyboardStructureReady: true,
    });
    expect("storyboard" in patch).toBe(false);
    expect(patch.characters).toEqual([]);
  });

  it("STORYBOARD_STRUCTURE_KEYS 与规格口径一致", () => {
    expect(STORYBOARD_STRUCTURE_KEYS).toEqual(["storyboard", "storyboardGroups"]);
  });
});

describe("withLoadRetry（分镜结构/媒体加载的偶发超时自动重试）", () => {
  const noSleep = () => Promise.resolve();

  it("首次成功不重试", async () => {
    let calls = 0;
    const result = await withLoadRetry(async () => {
      calls += 1;
      return { workspaceData: { ok: 1 } };
    }, noSleep);
    expect(result.workspaceData).toEqual({ ok: 1 });
    expect(calls).toBe(1);
  });

  it("首次失败（无 workspaceData）→ 延迟重试一次;重试成功返回成功结果", async () => {
    let calls = 0;
    const result = await withLoadRetry(async () => {
      calls += 1;
      return calls === 1
        ? { workspaceData: null, error: "statement timeout" }
        : { workspaceData: { ok: 2 } };
    }, noSleep);
    expect(result.workspaceData).toEqual({ ok: 2 });
    expect(calls).toBe(2);
  });

  it("两次都失败 → 返回失败结果（最多重试一次,不循环）", async () => {
    let calls = 0;
    const result = await withLoadRetry(async () => {
      calls += 1;
      return { workspaceData: null, error: "boom" };
    }, noSleep);
    expect(result.workspaceData).toBeNull();
    expect(calls).toBe(2);
  });
});
