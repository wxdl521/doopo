import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RestyleProcessPanel } from "../RestyleProcessPanel";
import { zh } from "../../../i18n/zh";
import { buildAssetImagePrompt } from "../restylePrompt";
import type { RestyleExtractedAsset, RestyleProject } from "../restyleStorage";

const asset: RestyleExtractedAsset = {
  id: "asset-1",
  kind: "character",
  sourceName: "院长",
  sourceDescription: "医院院长，中年男性",
  targetName: "Director Hall",
  targetDescription: "美国郊区医院院长",
  importance: "required",
  shouldRestyle: true,
};

function makeProject(overrides: Partial<RestyleProject> = {}): RestyleProject {
  return {
    id: "project-1",
    title: "测试项目",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    stage: "assets",
    assetIds: [],
    confirmedAssetIds: [],
    files: [],
    conversations: [],
    activeConversationId: null,
    planNote: "",
    styleBrief: "日漫赛璐璐",
    extractedAssets: [asset],
    analysisSummary: "",
    ...overrides,
  };
}

function renderPanel(project: RestyleProject, handlers: Partial<typeof baseHandlers> = {}) {
  const props = { project, ...baseHandlers, ...handlers };
  render(<RestyleProcessPanel {...props} />);
  return props;
}

const baseHandlers = {
  isAnalyzing: false,
  assetRunStatus: {},
  onStyleBriefChange: vi.fn(),
  onAssetPromptChange: vi.fn(),
  onAssetPromptReset: vi.fn(),
  onRegenerateAsset: vi.fn(),
  onSegmentPromptChange: vi.fn(),
  t: zh,
};

describe("RestyleProcessPanel", () => {
  it("shows the full auto-built asset prompt and reports manual edits", () => {
    const onAssetPromptChange = vi.fn();
    renderPanel(makeProject(), { onAssetPromptChange });

    const textarea = screen.getByLabelText("Director Hall prompt");
    expect(textarea).toHaveValue(buildAssetImagePrompt(asset, "日漫赛璐璐"));

    fireEvent.change(textarea, { target: { value: "手工改过的提示词" } });
    expect(onAssetPromptChange).toHaveBeenCalledWith("asset-1", "手工改过的提示词");
  });

  it("offers restoring the auto prompt only while an override is active", () => {
    const onAssetPromptReset = vi.fn();
    renderPanel(makeProject({ extractedAssets: [{ ...asset, promptOverride: "覆盖内容" }] }), {
      onAssetPromptReset,
    });

    const textarea = screen.getByLabelText("Director Hall prompt");
    expect(textarea).toHaveValue("覆盖内容");

    fireEvent.click(screen.getByRole("button", { name: "恢复自动生成" }));
    expect(onAssetPromptReset).toHaveBeenCalledWith("asset-1");
  });

  it("edits and saves segment video prompts", () => {
    const onSegmentPromptChange = vi.fn();
    renderPanel(
      makeProject({
        stage: "plan",
        planEpisodes: [{ episode: "EP01", segments: [{ id: "U01", prompt: "原始分段提示词" }] }],
      }),
      { onSegmentPromptChange },
    );

    const textarea = screen.getByLabelText("EP01 U01 prompt");
    expect(textarea).toHaveValue("原始分段提示词");

    fireEvent.change(textarea, { target: { value: "改过的分段提示词" } });
    expect(onSegmentPromptChange).toHaveBeenCalledWith("EP01", "U01", "改过的分段提示词");
  });

  it("shows per-asset run status with failure reasons", () => {
    render(
      <RestyleProcessPanel
        project={makeProject()}
        isAnalyzing
        assetRunStatus={{ "asset-1": { status: "failed", error: "模型超时" } }}
        onStyleBriefChange={vi.fn()}
        onAssetPromptChange={vi.fn()}
        onAssetPromptReset={vi.fn()}
        onRegenerateAsset={vi.fn()}
        onSegmentPromptChange={vi.fn()}
        t={zh}
      />,
    );

    expect(screen.getAllByText(/Director Hall/).length).toBeGreaterThan(0);
    expect(screen.getByText(/失败：模型超时/)).toBeInTheDocument();
  });
});

describe("RestyleProcessPanel · skill 可见性", () => {
  it("各阶段展示对应 skill 芯片，点击展开规约全文", () => {
    renderPanel(makeProject({ stage: "analysis" }));
    // 分析阶段的两个 skill 芯片可见
    const chip = screen.getByTitle("video-analysis-extract");
    expect(chip).toBeTruthy();
    expect(screen.getByTitle("audio-transcript-align")).toBeTruthy();
    // 点击展开规约内容（md 标题出现）
    fireEvent.click(chip);
    expect(screen.getByText(/原视频视觉分析提取/)).toBeTruthy();
    // 再点收起
    fireEvent.click(chip);
    expect(screen.queryByText(/原视频视觉分析提取/)).toBeNull();
  });

  it("upload 阶段无 skill 芯片；plan 阶段含提示词契约 skill", () => {
    renderPanel(makeProject({ stage: "plan" }));
    // prompt-contract 同时挂在 plan 和 render 两个阶段
    expect(screen.getAllByTitle("restyle-prompt-contract").length).toBe(2);
    expect(screen.getByTitle("shot-to-segment")).toBeTruthy();
    expect(screen.queryByTitle("video-analysis-extract")).toBeTruthy(); // analysis 阶段芯片也在时间线上
  });
});
