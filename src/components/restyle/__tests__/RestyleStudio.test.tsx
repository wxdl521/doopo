import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RestyleStudio from "../RestyleStudio";
import { libraryAssetsFromRows } from "../restyleAssetLibrary";
import type { DbCharacter, DbProp, DbScene } from "../../../lib/assetsStorage";
import { LanguageProvider } from "../../../i18n/LanguageContext";
import { loadRestyleProjects, saveRestyleProjects, type RestyleProject } from "../restyleStorage";

// 让工作区读到 localStorage 里预置的项目；资产库走空数据，避免真实请求。
vi.mock("../../../hooks/useAuth", () => ({
  useAuth: () => ({
    session: null,
    user: { id: "restyle-user" },
    loading: false,
    isAuthenticated: true,
    signOut: async () => {},
  }),
}));
vi.mock("../../../lib/assetsStorage", () => ({
  loadCharacters: vi.fn(async () => ({ data: [], error: null })),
  loadScenes: vi.fn(async () => ({ data: [], error: null })),
  loadProps: vi.fn(async () => ({ data: [], error: null })),
}));

beforeEach(() => {
  window.localStorage.clear();
});

const SEED_NOW = "2026-08-02T00:00:00.000Z";

function seedProject(overrides: Partial<RestyleProject> = {}): RestyleProject {
  return {
    id: "project-a",
    title: "项目 A",
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
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
    // 顶部栏不再写死「项目文件」标题（已由 Tab 承担），保留图标与按钮位。
    expect(screen.getByRole("tab", { name: "文件" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("输入你的转绘需求…")).toBeInTheDocument();
    // 右栏分段 Tab 默认停在「设置」。
    expect(screen.getByRole("tab", { name: "设置" })).toHaveAttribute("aria-selected", "true");
  });

  it("creates a local project without seeded project data", async () => {
    const user = userEvent.setup();
    renderStudio();

    expect(screen.getByText("暂无转绘项目")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新建转绘项目" }));

    expect(screen.getByTestId("restyle-workbench")).toBeInTheDocument();
    // 第 4 处项目标题在右栏「文件」Tab 的文件树头部。
    await user.click(screen.getByRole("tab", { name: "文件" }));
    expect(screen.getAllByText("未命名转绘项目 1")).toHaveLength(4);
  });

  it("uses the conversation as the only task progression surface", async () => {
    renderStudio();
    // 右栏为分段 Tab（设置/流程/文件），默认停在「设置」；任务推进仍只在对话里进行。
    expect(screen.getByRole("tab", { name: "设置" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByPlaceholderText("输入你的转绘需求…")).toBeInTheDocument();
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

    // 首条消息会被记为目标画风，显示在「过程与提示词」面板的画风编辑框里，因此共 4 处。
    // 该面板在右栏「流程」Tab 下，需先切过去。
    await user.click(screen.getByRole("tab", { name: "流程" }));
    expect(screen.getAllByText("保留庄园客厅")).toHaveLength(4);
  });

  it("keeps the analysis model next to the composer send action", async () => {
    const user = userEvent.setup();
    renderStudio();

    const model = screen.getByLabelText("选择分析模型");
    expect(model).toHaveValue("qwen:qwen3.6-plus");
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

    // 第 4 处项目标题在右栏「文件」Tab 的文件树头部。
    await user.click(screen.getByRole("tab", { name: "文件" }));
    expect(screen.getAllByText("未命名转绘项目 1")).toHaveLength(4);
  });

  it("adds a selected source file to the active conversation without advancing the stage", async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByRole("button", { name: "新建转绘项目" }));

    await user.upload(
      screen.getByTestId("restyle-file-input"),
      new File(["source"], "EP01.mp4", { type: "video/mp4" }),
    );

    // 第 2 处文件名在右栏「文件」Tab 的文件树里。
    await user.click(screen.getByRole("tab", { name: "文件" }));
    expect(screen.getAllByText("EP01.mp4")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "文件" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps uploaded videos visible after sending them into the conversation", async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByRole("button", { name: "新建转绘项目" }));

    await user.upload(
      screen.getByTestId("restyle-file-input"),
      new File(["source"], "EP01.mp4", { type: "video/mp4" }),
    );
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(screen.getByRole("button", { name: "打开附件：EP01.mp4" })).toBeInTheDocument();
  });

  it("submits video rendering from a direct confirm message before the plan stage", async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByRole("button", { name: "新建转绘项目" }));

    await user.upload(
      screen.getByTestId("restyle-file-input"),
      new File(["source"], "EP01.mp4", { type: "video/mp4" }),
    );
    await user.type(screen.getByPlaceholderText("输入你的转绘需求…"), "确认生成视频");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(screen.getByText(/已提交 .*正式视频生成/)).toBeInTheDocument();
  });

  it("opens and collapses files from the project file tree", async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByRole("button", { name: "新建转绘项目" }));

    await user.upload(
      screen.getByTestId("restyle-file-input"),
      new File(["source"], "EP01.mp4", { type: "video/mp4" }),
    );
    // 文件树在右栏「文件」Tab 下，需先切过去。
    await user.click(screen.getByRole("tab", { name: "文件" }));
    await user.click(screen.getByRole("button", { name: "预览文件：EP01.mp4" }));

    expect(screen.getByText(/本地视频/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "切换文件夹：原片" }));
    expect(screen.queryByRole("button", { name: "预览文件：EP01.mp4" })).not.toBeInTheDocument();
  });

  it("offers files and folders from the attachment menu", async () => {
    const user = userEvent.setup();
    renderStudio();

    await user.click(screen.getByRole("button", { name: "附加文件" }));

    expect(screen.getAllByRole("button", { name: "附加文件" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "附加文件夹" })).toBeInTheDocument();
  });

  it("keeps rendered final videos and review links when persisted", () => {
    const project: RestyleProject = {
      id: "project-1",
      title: "英文剧集转绘",
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
      stage: "review",
      assetIds: [],
      confirmedAssetIds: [],
      files: [
        {
          id: "source-1",
          name: "EP01.mp4",
          size: 1024,
          type: "video/mp4",
          lastModified: 0,
        },
        {
          id: "final-1",
          name: "EP01.mp4",
          size: 1024,
          type: "video/mp4",
          lastModified: 0,
          generatedKind: "final_video",
          sourceAttachmentId: "source-1",
          episode: "EP01",
          renderTaskId: "render-EP01-final",
          renderStatus: "succeeded",
          renderProgress: 100,
          resultUrl: "https://cdn.example.com/EP01.mp4",
        },
        {
          id: "clip-1",
          name: "EP01_U01.mp4",
          size: 512,
          type: "video/mp4",
          lastModified: 0,
          generatedKind: "video_clip",
          sourceAttachmentId: "source-1",
          episode: "EP01",
          segmentId: "U01",
          renderTaskId: "render-EP01-U01",
          renderStatus: "running",
          renderProgress: 75,
          resultUrl: "https://cdn.example.com/EP01_U01.mp4",
          rerunOfAttachmentId: "old-clip-1",
          feedback: "人物不像 Grace Hart",
        },
      ],
      conversations: [
        {
          id: "conversation-1",
          title: "",
          createdAt: "2026-07-21T00:00:00.000Z",
          updatedAt: "2026-07-21T00:00:00.000Z",
          messages: [
            {
              id: "message-1",
              role: "assistant",
              content: "EP01 英文剧正式生成完成。",
              createdAt: "2026-07-21T00:00:00.000Z",
              finalEpisodeLinks: ["EP01"],
            },
          ],
        },
      ],
      activeConversationId: "conversation-1",
      planNote: "",
      extractedAssets: [],
      analysisSummary: "",
      planEpisodes: [{ episode: "EP01", segments: [{ id: "U01", prompt: "prompt" }] }],
    };

    saveRestyleProjects("restyle-user", [project]);

    expect(loadRestyleProjects("restyle-user")[0]).toMatchObject({
      files: [
        expect.objectContaining({ id: "source-1" }),
        expect.objectContaining({
          generatedKind: "final_video",
          sourceAttachmentId: "source-1",
          renderStatus: "succeeded",
          resultUrl: "https://cdn.example.com/EP01.mp4",
        }),
        expect.objectContaining({
          generatedKind: "video_clip",
          segmentId: "U01",
          // 持久化的 running 状态在加载时收敛为 failed（页面刷新中断），
          // 其余字段（进度 / 返工链 / 反馈）照常往返。
          renderStatus: "failed",
          renderError: expect.stringContaining("页面刷新中断"),
          renderProgress: 75,
          rerunOfAttachmentId: "old-clip-1",
          feedback: "人物不像 Grace Hart",
        }),
      ],
    });
  });

  it("sends the composer message on Enter but not on Shift+Enter or while composing", async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByRole("button", { name: "新建转绘项目" }));

    const textarea = screen.getByPlaceholderText("输入你的转绘需求…");
    fireEvent.change(textarea, { target: { value: "保留庄园客厅" } });

    // Shift+Enter：换行，不发送。（消息气泡是 div；textarea 草稿不算已发送）
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(screen.queryByText("保留庄园客厅", { selector: "div" })).not.toBeInTheDocument();
    expect(textarea).toHaveValue("保留庄园客厅");

    // 中文输入法拼字中（isComposing）：不发送，避免选词误发。
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    expect(screen.queryByText("保留庄园客厅", { selector: "div" })).not.toBeInTheDocument();
    expect(textarea).toHaveValue("保留庄园客厅");

    // Enter：发送并清空草稿。
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(screen.getAllByText("保留庄园客厅").length).toBeGreaterThan(0);
    expect(textarea).toHaveValue("");
  });

  it("persists asset prompt overrides across storage round trips", () => {
    const project: RestyleProject = {
      id: "project-override",
      title: "提示词覆盖",
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
      extractedAssets: [
        {
          id: "asset-1",
          kind: "character",
          sourceName: "院长",
          sourceDescription: "医院院长，中年男性",
          targetName: "Director Hall",
          targetDescription: "美国郊区医院院长",
          importance: "required",
          shouldRestyle: true,
          promptOverride: "用户手工改过的提示词",
        },
        {
          id: "asset-2",
          kind: "scene",
          sourceName: "走廊",
          sourceDescription: "医院走廊",
          targetName: "Hallway",
          targetDescription: "郊区医院走廊",
          importance: "optional",
          shouldRestyle: true,
        },
      ],
      analysisSummary: "",
    };

    saveRestyleProjects("restyle-user", [project]);

    const loaded = loadRestyleProjects("restyle-user")[0];
    expect(loaded?.extractedAssets[0]?.promptOverride).toBe("用户手工改过的提示词");
    // 未覆盖（恢复自动生成）的资产不带上该字段。
    expect(loaded?.extractedAssets[1]?.promptOverride).toBeUndefined();
  });

  it("clears the inspector preview after switching projects", async () => {
    const user = userEvent.setup();
    saveRestyleProjects("restyle-user", [
      seedProject({
        id: "project-a",
        title: "项目 A",
        files: [
          { id: "video-a", name: "EP-A.mp4", size: 1024, type: "video/mp4", lastModified: 0 },
        ],
      }),
      seedProject({ id: "project-b", title: "项目 B" }),
    ]);
    renderStudio();

    // 打开 A 的视频预览：右侧检查器显示本地视频（文件树在「文件」Tab 下）。
    await user.click(screen.getByRole("tab", { name: "文件" }));
    await user.click(await screen.findByRole("button", { name: "预览文件：EP-A.mp4" }));
    expect(screen.getByText(/本地视频/)).toBeInTheDocument();

    // 切到 B：A 的预览必须清空，不能残留 A 的媒体。
    await user.selectOptions(screen.getByLabelText("选择项目"), "project-b");
    expect(screen.queryByText(/本地视频/)).not.toBeInTheDocument();
    expect(screen.queryByText("EP-A.mp4")).not.toBeInTheDocument();
  });

  it("keeps draft attachments scoped to their own project", async () => {
    const user = userEvent.setup();
    saveRestyleProjects("restyle-user", [
      seedProject({ id: "project-a", title: "项目 A" }),
      seedProject({ id: "project-b", title: "项目 B" }),
    ]);
    renderStudio();

    // 在 A 的输入框附件条里加一张图。
    await user.upload(
      screen.getByTestId("restyle-file-input"),
      new File(["cover"], "draft-cover.png", { type: "image/png" }),
    );
    expect(screen.getAllByText("draft-cover.png").length).toBeGreaterThan(0);

    // 切到 B：附件条与文件树都不出现 A 的草稿附件。
    await user.selectOptions(screen.getByLabelText("选择项目"), "project-b");
    expect(screen.queryByText("draft-cover.png")).not.toBeInTheDocument();

    // 切回 A：草稿附件还在，互不污染。
    await user.selectOptions(screen.getByLabelText("选择项目"), "project-a");
    expect(screen.getAllByText("draft-cover.png").length).toBeGreaterThan(0);
  });

  it("falls back to default models when the project has no saved model", async () => {
    const user = userEvent.setup();
    saveRestyleProjects("restyle-user", [
      seedProject({
        id: "project-a",
        title: "项目 A",
        imageModel: "revora/gpt-image-2-high",
        videoModel: "doubao-seedance-1-0-pro-250528",
      }),
      seedProject({ id: "project-b", title: "项目 B" }),
    ]);
    renderStudio();

    const imageSelect = await screen.findByLabelText("生图模型");
    const videoSelect = screen.getByLabelText("生视频模型");
    // A 设过模型：沿用项目内保存的选择。
    expect(imageSelect).toHaveValue("revora/gpt-image-2-high");
    expect(videoSelect).toHaveValue("doubao-seedance-1-0-pro-250528");

    // B 没设过模型：回落默认值，而不是沿用 A 的选择。
    await user.selectOptions(screen.getByLabelText("选择项目"), "project-b");
    // 默认生图模型 = realImageModelOptions 里第一个可见模型（Seedream 不在可见列表时）。
    expect(imageSelect).toHaveValue("tokenflash/gpt-image-2");
    expect(videoSelect).not.toHaveValue("doubao-seedance-1-0-pro-250528");
  });

  it("defaults the right rail to the setup tab and renders only the selected panel", async () => {
    const user = userEvent.setup();
    saveRestyleProjects("restyle-user", [
      seedProject({
        id: "project-a",
        title: "项目 A",
        files: [{ id: "video-a", name: "EP-A.mp4", size: 1024, type: "video/mp4", lastModified: 0 }],
      }),
    ]);
    renderStudio();

    // 默认停在「设置」：只渲染选项区，过程面板与文件树不渲染。
    expect(screen.getByRole("tab", { name: "设置" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("restyle-setup-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("restyle-process-panel")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "切换文件夹：原片" }),
    ).not.toBeInTheDocument();

    // 切到「流程」：渲染过程面板，选项区卸载。
    await user.click(screen.getByRole("tab", { name: "流程" }));
    expect(screen.queryByTestId("restyle-setup-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("restyle-process-panel")).toBeInTheDocument();

    // 切到「文件」：渲染项目文件树，过程面板卸载。
    await user.click(screen.getByRole("tab", { name: "文件" }));
    expect(screen.queryByTestId("restyle-process-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换文件夹：原片" })).toBeInTheDocument();
  });

  it("remembers the last selected rail tab per project across remounts", async () => {
    const user = userEvent.setup();
    saveRestyleProjects("restyle-user", [seedProject({ id: "project-a", title: "项目 A" })]);
    const first = renderStudio();

    await user.click(screen.getByRole("tab", { name: "文件" }));
    expect(screen.getByRole("tab", { name: "文件" })).toHaveAttribute("aria-selected", "true");

    // 模拟刷新：卸载后重新渲染，应从 localStorage 恢复「文件」Tab。
    first.unmount();
    renderStudio();
    expect(await screen.findByRole("tab", { name: "文件" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("shows the file count badge on the files tab", () => {
    saveRestyleProjects("restyle-user", [
      seedProject({
        id: "project-a",
        title: "项目 A",
        files: [{ id: "video-a", name: "EP-A.mp4", size: 1024, type: "video/mp4", lastModified: 0 }],
      }),
    ]);
    renderStudio();

    // 角标 = 文件树叶子节点数：源视频 1 个 + 分析产物 source_asset_candidates.json 1 个 = 2。
    expect(screen.getByRole("tab", { name: "文件" })).toHaveTextContent("2");
  });

  it("auto-switches to the process tab when a confirmation gate is pending", async () => {
    saveRestyleProjects("restyle-user", [
      seedProject({
        id: "project-a",
        title: "项目 A",
        conversations: [
          {
            id: "conversation-1",
            title: "",
            createdAt: SEED_NOW,
            updatedAt: SEED_NOW,
            messages: [
              {
                id: "message-1",
                role: "assistant",
                content: "资产图片已生成。确认无误后回复“继续下一步”，即可生成转绘方案。",
                createdAt: SEED_NOW,
              },
            ],
          },
        ],
        activeConversationId: "conversation-1",
      }),
    ]);
    renderStudio();

    // 待确认关卡出现：自动切到「流程」Tab 并渲染过程面板。
    expect(await screen.findByTestId("restyle-process-panel")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "流程" })).toHaveAttribute("aria-selected", "true");
  });
});
