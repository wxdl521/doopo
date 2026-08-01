import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import RestyleStudio from "../RestyleStudio";
import { CharacterRelationTable } from "../CharacterRelationTable";
import { LanguageProvider } from "../../../i18n/LanguageContext";
import { zh } from "../../../i18n/zh";
import {
  loadRestyleProjects,
  saveRestyleProjects,
  type RestyleExtractedAsset,
  type RestyleProject,
} from "../restyleStorage";

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

const EXTRACTED_ASSETS: RestyleExtractedAsset[] = [
  {
    id: "asset-1",
    kind: "character",
    sourceName: "林夏",
    sourceDescription: "女主，短发",
    targetName: "Lin Xia",
    targetDescription: "美剧版女主",
    importance: "required",
    shouldRestyle: true,
  },
  {
    id: "asset-2",
    kind: "character",
    sourceName: "院长",
    sourceDescription: "医院院长",
    targetName: "Director Hall",
    targetDescription: "郊区医院院长",
    importance: "optional",
    shouldRestyle: true,
  },
];

function seedProject(overrides: Partial<RestyleProject> = {}): RestyleProject {
  const now = "2026-08-02T00:00:00.000Z";
  return {
    id: "project-1",
    title: "关系表测试项目",
    createdAt: now,
    updatedAt: now,
    stage: "assets",
    assetIds: [],
    confirmedAssetIds: [],
    files: [],
    conversations: [
      {
        id: "conv-1",
        title: "",
        createdAt: now,
        updatedAt: now,
        messages: [
          {
            id: "msg-1",
            role: "assistant",
            content: "资产表已提取，请逐项确认。",
            createdAt: now,
            assetTable: EXTRACTED_ASSETS,
          },
        ],
      },
    ],
    activeConversationId: "conv-1",
    planNote: "",
    extractedAssets: EXTRACTED_ASSETS,
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

beforeEach(() => {
  window.localStorage.clear();
});

describe("人物关系表", () => {
  it("关系为空时整块不渲染（组件级）", () => {
    const { container } = render(
      <CharacterRelationTable
        characters={[{ id: "asset-1", name: "林夏" }]}
        relations={[]}
        issues={[]}
        onChange={() => {}}
        onFixReverse={() => {}}
        t={zh}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("项目无关系数据时工作区不出现关系表", async () => {
    saveRestyleProjects("restyle-user", [seedProject()]);
    renderStudio();
    await screen.findByLabelText("原片名称：asset-1");
    expect(screen.queryByTestId("character-relation-table")).not.toBeInTheDocument();
  });

  it("有关系数据时渲染表格，缺反向边可一键补全", async () => {
    saveRestyleProjects("restyle-user", [
      seedProject({
        characterRelations: [
          { id: "rel-1", from: "asset-1", to: "asset-2", relation: "下属", note: "EP01" },
        ],
      }),
    ]);
    renderStudio();

    const table = await screen.findByTestId("character-relation-table");
    expect(table).toBeInTheDocument();
    // 单边（缺反向边）→ 出现一键修复按钮。
    const fix = await screen.findByRole("button", { name: "补全反向关系" });
    fireEvent.click(fix);

    await waitFor(() => {
      const stored = loadRestyleProjects("restyle-user")[0];
      expect(stored?.characterRelations).toHaveLength(2);
      expect(stored?.characterRelations?.[1]).toMatchObject({
        from: "asset-2",
        to: "asset-1",
        relation: "下属",
      });
    });
  });

  it("编辑资产名称后同步回写历史消息的 assetTable", async () => {
    saveRestyleProjects("restyle-user", [seedProject()]);
    renderStudio();

    const input = await screen.findByLabelText("原片名称：asset-1");
    fireEvent.change(input, { target: { value: "林小夏" } });

    // 编辑走 300ms 防抖；落盘后 project.extractedAssets 与历史消息 assetTable 同步更新。
    await waitFor(() => {
      const stored = loadRestyleProjects("restyle-user")[0];
      expect(stored?.extractedAssets[0]?.sourceName).toBe("林小夏");
      expect(stored?.conversations[0]?.messages[0]?.assetTable?.[0]?.sourceName).toBe("林小夏");
    });
  });
});

describe("动作口令待办卡片", () => {
  function seedPendingProject(): RestyleProject {
    const project = seedProject({ extractedAssets: [] });
    project.conversations[0]!.messages = [
      {
        id: "msg-user",
        role: "user",
        content: "帮我转绘这部剧",
        createdAt: "2026-08-02T00:00:00.000Z",
      },
      {
        id: "msg-assistant",
        role: "assistant",
        content: "资产图片已生成。确认无误后回复“继续下一步”，即可生成转绘方案。",
        createdAt: "2026-08-02T00:01:00.000Z",
      },
    ];
    return project;
  }

  it("含口令的助手消息升级为待办卡片，输入框占位变为待确认", async () => {
    saveRestyleProjects("restyle-user", [seedPendingProject()]);
    renderStudio();

    expect(await screen.findByTestId("restyle-action-callout")).toBeInTheDocument();
    expect(screen.getByText("需要你确认")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("待你确认：继续下一步")).toBeInTheDocument();
  });

  it("点击口令 chip 即发送，发送后待确认状态解除", async () => {
    saveRestyleProjects("restyle-user", [seedPendingProject()]);
    renderStudio();

    fireEvent.click(await screen.findByRole("button", { name: "继续下一步" }));

    await waitFor(() => {
      const stored = loadRestyleProjects("restyle-user")[0];
      const messages = stored?.conversations[0]?.messages ?? [];
      expect(messages.at(-1)).toMatchObject({ role: "user", content: "继续下一步" });
    });
    // 用户已响应 → 占位文案恢复默认。
    await screen.findByPlaceholderText("输入你的转绘需求…");
  });
});
