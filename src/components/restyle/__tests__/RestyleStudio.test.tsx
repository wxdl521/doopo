import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RestyleStudio from "../RestyleStudio";
import { libraryAssetsFromRows } from "../restyleAssetLibrary";
import type { DbCharacter, DbProp, DbScene } from "../../../lib/assetsStorage";
import { LanguageProvider } from "../../../i18n/LanguageContext";

function renderStudio() {
  return render(
    <LanguageProvider>
      <RestyleStudio />
    </LanguageProvider>,
  );
}

describe("RestyleStudio prototype", () => {
  it("maps the current asset library into restyle assets", () => {
    const assets = libraryAssetsFromRows(
      [
        {
          id: "char-1",
          name: "林夏",
          role: "lead",
          role_label: "女主",
          look: "短发，深色风衣",
          personality: "冷静",
          gradient: "from-slate-500 to-slate-950",
          cover_url: "https://example.com/linxia.jpg",
          images: null,
        } as DbCharacter,
      ],
      [
        {
          id: "scene-1",
          name: "医院走廊",
          location: "市立医院",
          action: "深夜对峙",
          time_of_day: "NIGHT",
          cover_url: null,
          images: [{ url: "https://example.com/hospital.jpg", label: "主图" }],
        } as unknown as DbScene,
      ],
      [
        {
          id: "prop-1",
          name: "怀表",
          description: "祖传怀表",
          movement_description: null,
          cover_url: null,
          images: null,
        } as DbProp,
      ],
    );

    expect(assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "character:char-1",
          imageUrl: "https://example.com/linxia.jpg",
        }),
        expect.objectContaining({
          id: "scene:scene-1",
          imageUrl: "https://example.com/hospital.jpg",
        }),
        expect.objectContaining({ id: "prop:prop-1" }),
      ]),
    );
  });

  it("opens directly into the three-column restyle workbench", () => {
    renderStudio();

    expect(screen.getByTestId("restyle-workbench")).toBeInTheDocument();
    expect(screen.getByText("项目文件")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "上传原片" })).toHaveAttribute("aria-selected", "true");
  });

  it("creates a local project without seeded project data", async () => {
    const user = userEvent.setup();
    renderStudio();

    expect(screen.getByText("暂无转绘项目")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新建转绘项目" }));

    expect(screen.getByTestId("restyle-workbench")).toBeInTheDocument();
    expect(screen.getAllByText("未命名转绘项目 1")).toHaveLength(3);
  });

  it("switches stages and exposes the review state", async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByRole("button", { name: "新建转绘项目" }));
    await user.click(screen.getByRole("tab", { name: "视频生成" }));
    expect(screen.getByText("确认方案后将在这里展示生成任务。")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "验收完成" }));
    expect(screen.getByText("生成完成后将在这里展示验收结果。")).toBeInTheDocument();
  });

  it("opens the canvas and returns to the workbench", async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getAllByRole("button", { name: "打开画布" })[0]!);

    expect(screen.getByTestId("restyle-canvas")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "转绘工作台" }));
    expect(screen.getByTestId("restyle-workbench")).toBeInTheDocument();
  });

  it("keeps the assistant composer as local prototype interaction", async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByRole("button", { name: "新建转绘项目" }));

    await user.type(screen.getByPlaceholderText("输入你的转绘需求…"), "保留庄园客厅");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(screen.getAllByText("保留庄园客厅")).toHaveLength(3);
  });

  it("keeps the analysis model next to the composer send action", async () => {
    const user = userEvent.setup();
    renderStudio();

    const model = screen.getByLabelText("选择分析模型");
    expect(model).toHaveValue("ark:deepseek-v4-pro-260425");
    await user.selectOptions(model, "qwen:qwen3.6-plus");
    expect(model).toHaveValue("qwen:qwen3.6-plus");
  });

  it("creates multiple conversations under the active project", async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByRole("button", { name: "新建转绘项目" }));
    await user.click(screen.getByRole("button", { name: "新建对话" }));

    expect(screen.getAllByRole("button", { name: "新对话" })).toHaveLength(2);
  });

  it("creates a project from the composer project selector", async () => {
    const user = userEvent.setup();
    renderStudio();

    await user.selectOptions(screen.getByLabelText("选择项目"), "__create__");

    expect(screen.getAllByText("未命名转绘项目 1")).toHaveLength(3);
  });

  it("adds a selected source file to the active conversation without advancing the stage", async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByRole("button", { name: "新建转绘项目" }));

    await user.upload(
      screen.getByTestId("restyle-file-input"),
      new File(["source"], "EP01.mp4", { type: "video/mp4" }),
    );

    expect(screen.getAllByText("EP01.mp4")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "上传原片" })).toHaveAttribute("aria-selected", "true");
  });

  it("offers files and folders from the attachment menu", async () => {
    const user = userEvent.setup();
    renderStudio();

    await user.click(screen.getAllByRole("button", { name: "附加文件" })[1]!);

    expect(screen.getAllByRole("button", { name: "附加文件" })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "附加文件夹" })).toBeInTheDocument();
  });
});
