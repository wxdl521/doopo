import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RestyleSetupPanel, type RestyleSetupPatch } from "../RestyleSetupPanel";
import { zh } from "../../../i18n/zh";
import {
  loadRestyleProjects,
  saveRestyleProjects,
  type RestyleProject,
} from "../restyleStorage";

const USER_ID = "restyle-user";

function makeProject(overrides: Partial<RestyleProject> = {}): RestyleProject {
  const now = "2026-08-03T00:00:00.000Z";
  return {
    id: "project-1",
    title: "面板测试项目",
    createdAt: now,
    updatedAt: now,
    stage: "upload",
    assetIds: [],
    confirmedAssetIds: [],
    files: [],
    conversations: [],
    activeConversationId: null,
    planNote: "",
    extractedAssets: [],
    analysisSummary: "",
    ...overrides,
  };
}

function renderPanel(project: RestyleProject, onPatch = vi.fn()) {
  render(
    <RestyleSetupPanel
      project={project}
      videoPricing={[]}
      currentVideoModel=""
      onPatch={onPatch}
      t={zh}
    />,
  );
  return onPatch;
}

describe("RestyleSetupPanel 目标市场与智能补镜", () => {
  it("目标市场默认韩剧（kr），卡片显示对应 LUT 简述", () => {
    renderPanel(makeProject());
    expect(screen.getByRole("button", { name: "韩剧" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "美剧" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("market-lut-brief")).toHaveTextContent("阿宝色调");
  });

  it("点击美剧回写 targetMarket，回显时选中态与 LUT 简述跟随", () => {
    const onPatch = renderPanel(makeProject());
    fireEvent.click(screen.getByRole("button", { name: "美剧" }));
    expect(onPatch).toHaveBeenCalledWith({ targetMarket: "us" } satisfies RestyleSetupPatch);

    renderPanel(makeProject({ targetMarket: "us" }));
    const usButtons = screen.getAllByRole("button", { name: "美剧" });
    expect(usButtons.some((button) => button.getAttribute("aria-pressed") === "true")).toBe(true);
    expect(screen.getAllByTestId("market-lut-brief")[1]).toHaveTextContent("高对比度");
  });

  it("智能补镜默认关闭，点击回写 smartInsert 并展示说明文案", () => {
    const onPatch = renderPanel(makeProject());
    const toggle = screen.getByRole("button", { name: /智能补镜/ });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveTextContent("当前版本先记录偏好，补镜执行在下个迭代开放");

    fireEvent.click(toggle);
    expect(onPatch).toHaveBeenCalledWith({ smartInsert: true } satisfies RestyleSetupPatch);

    renderPanel(makeProject({ smartInsert: true }));
    const toggles = screen.getAllByRole("button", { name: /智能补镜/ });
    expect(toggles.some((button) => button.getAttribute("aria-pressed") === "true")).toBe(true);
  });
});

describe("restyleStorage 新字段持久化", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("targetMarket / smartInsert / shotSchedule 随项目持久化回读", () => {
    const shotSchedule = [
      { shotNo: "SC001", startMs: 0, endMs: 3000, scene: "天台", shotType: "中景" as const, emotion: "愤怒" },
    ];
    saveRestyleProjects(USER_ID, [
      makeProject({ targetMarket: "in", smartInsert: true, shotSchedule }),
    ]);
    const [loaded] = loadRestyleProjects(USER_ID);
    expect(loaded.targetMarket).toBe("in");
    expect(loaded.smartInsert).toBe(true);
    expect(loaded.shotSchedule).toEqual(shotSchedule);
  });

  it("缺省兼容：旧项目没有新字段时按 undefined 解析", () => {
    saveRestyleProjects(USER_ID, [makeProject()]);
    const [loaded] = loadRestyleProjects(USER_ID);
    expect(loaded.targetMarket).toBeUndefined();
    expect(loaded.smartInsert).toBeUndefined();
    expect(loaded.shotSchedule).toBeUndefined();
  });

  it("非法值被清洗：非法 targetMarket 丢弃，shotSchedule 非法镜头过滤", () => {
    window.localStorage.setItem(
      `doopoo:restyle-projects:${USER_ID}`,
      JSON.stringify([
        {
          ...makeProject(),
          targetMarket: "jp",
          smartInsert: true,
          shotSchedule: [
            { shotNo: "SC001", startMs: 0, endMs: 3000, scene: "天台", shotType: "中景", emotion: "愤怒" },
            { shotNo: "SC002", startMs: 3000, endMs: 2000, scene: "天台", shotType: "中景", emotion: "愤怒" },
            { shotNo: "SC003", startMs: 3000, endMs: 6000, scene: "病房", shotType: "大远景", emotion: "悲伤" },
          ],
        },
      ]),
    );
    const [loaded] = loadRestyleProjects(USER_ID);
    expect(loaded.targetMarket).toBeUndefined();
    expect(loaded.smartInsert).toBe(true);
    expect(loaded.shotSchedule?.map((shot) => shot.shotNo)).toEqual(["SC001"]);
  });
});
