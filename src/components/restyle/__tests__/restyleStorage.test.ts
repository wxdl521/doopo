import { beforeEach, describe, expect, it } from "vitest";
import { loadRestyleProjects, saveRestyleProjects } from "../restyleStorage";

function makePersistedProject(files: Array<Record<string, unknown>>) {
  return {
    id: "p1",
    title: "测试项目",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    stage: "render",
    assetIds: [],
    confirmedAssetIds: [],
    files,
    conversations: [],
    activeConversationId: null,
    planNote: "",
    extractedAssets: [],
    analysisSummary: "",
  };
}

describe("restyleStorage · 加载时收敛中断的渲染状态", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("持久化的 queued / running 一律落为 failed 并附注「页面刷新中断」", () => {
    window.localStorage.setItem(
      "doopoo:restyle-projects:u1",
      JSON.stringify([
        makePersistedProject([
          {
            id: "f-queued",
            name: "a_U01.mp4",
            size: 1,
            type: "video/mp4",
            lastModified: 1,
            generatedKind: "video_clip",
            renderStatus: "queued",
            renderProgress: 0,
          },
          {
            id: "f-running",
            name: "a_U02.mp4",
            size: 1,
            type: "video/mp4",
            lastModified: 1,
            generatedKind: "video_clip",
            renderStatus: "running",
            renderProgress: 65,
          },
        ]),
      ]),
    );
    const [project] = loadRestyleProjects("u1");
    const queued = project!.files.find((file) => file.id === "f-queued")!;
    const running = project!.files.find((file) => file.id === "f-running")!;
    expect(queued.renderStatus).toBe("failed");
    expect(queued.renderError).toContain("页面刷新中断");
    expect(running.renderStatus).toBe("failed");
    expect(running.renderError).toContain("页面刷新中断");
  });

  it("已带错误信息的 running 保留原错误；succeeded / failed 不受影响", () => {
    window.localStorage.setItem(
      "doopoo:restyle-projects:u1",
      JSON.stringify([
        makePersistedProject([
          {
            id: "f-err",
            name: "b_U01.mp4",
            size: 1,
            type: "video/mp4",
            lastModified: 1,
            generatedKind: "video_clip",
            renderStatus: "running",
            renderError: "模型风控拒绝",
          },
          {
            id: "f-ok",
            name: "b_U02.mp4",
            size: 1,
            type: "video/mp4",
            lastModified: 1,
            generatedKind: "video_clip",
            renderStatus: "succeeded",
            resultUrl: "https://cdn.example.com/b.mp4",
          },
          {
            id: "f-failed",
            name: "b_U03.mp4",
            size: 1,
            type: "video/mp4",
            lastModified: 1,
            generatedKind: "video_clip",
            renderStatus: "failed",
            renderError: "原始失败原因",
          },
        ]),
      ]),
    );
    const [project] = loadRestyleProjects("u1");
    const withError = project!.files.find((file) => file.id === "f-err")!;
    const succeeded = project!.files.find((file) => file.id === "f-ok")!;
    const failed = project!.files.find((file) => file.id === "f-failed")!;
    expect(withError.renderStatus).toBe("failed");
    expect(withError.renderError).toBe("模型风控拒绝");
    expect(succeeded.renderStatus).toBe("succeeded");
    expect(succeeded.renderError).toBeUndefined();
    expect(failed.renderStatus).toBe("failed");
    expect(failed.renderError).toBe("原始失败原因");
  });

  it("save → load 往返同样收敛中断状态", () => {
    const [project] = [
      makePersistedProject([
        {
          id: "f-run",
          name: "c_U01.mp4",
          size: 1,
          type: "video/mp4",
          lastModified: 1,
          generatedKind: "video_clip" as const,
          renderStatus: "running" as const,
          renderProgress: 40,
        },
      ]),
    ];
    saveRestyleProjects("u1", [project as never]);
    const [loaded] = loadRestyleProjects("u1");
    expect(loaded!.files[0]!.renderStatus).toBe("failed");
    expect(loaded!.files[0]!.renderError).toContain("页面刷新中断");
  });
});
