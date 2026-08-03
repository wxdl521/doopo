// ====================================================================
// CustomLightingPanel 测试：路径 B 滑块写入 / 重置 / 清除回落 +
// customLighting 持久化解析（5 维校验、±100 钳制）
// ====================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CustomLightingPanel } from "../CustomLightingPanel";
import type { RestyleSetupPatch } from "../RestyleSetupPanel";
import { zh } from "../../../i18n/zh";
import { LIGHTING_PRESETS } from "../../../lib/restyle/cameraDirection";
import {
  loadRestyleProjects,
  saveRestyleProjects,
  type RestyleProject,
} from "../restyleStorage";

const USER_ID = "restyle-custom-lighting-user";

function makeProject(overrides: Partial<RestyleProject> = {}): RestyleProject {
  const now = "2026-08-03T00:00:00.000Z";
  return {
    id: "project-1",
    title: "自定义光照测试项目",
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
  render(<CustomLightingPanel project={project} onPatch={onPatch} t={zh} />);
  return onPatch;
}

describe("CustomLightingPanel 路径 B 调色台", () => {
  it("无自定义时状态行提示使用地域预设，滑块回显 kr 预设值", () => {
    renderPanel(makeProject());
    expect(screen.getByTestId("custom-lighting-status")).toHaveTextContent(
      "未设置自定义风格，当前使用目标市场地域预设",
    );
    expect(screen.getByTestId("custom-lighting-contrastRatio-value")).toHaveTextContent("+30");
    expect(screen.getByTestId("custom-lighting-tempTint-value")).toHaveTextContent("+20");
  });

  it("拖动光比滑块即写 customLighting（source: manual，其余维沿用当前基准）", () => {
    const onPatch = renderPanel(makeProject());
    fireEvent.change(screen.getByRole("slider", { name: "光比" }), { target: { value: "55" } });
    expect(onPatch).toHaveBeenCalledWith({
      customLighting: {
        name: "我的风格",
        params: { ...LIGHTING_PRESETS.kr.params, contrastRatio: 55 },
        source: "manual",
      },
    } satisfies RestyleSetupPatch);
  });

  it("质感衰减档位选择写入对应影调描述", () => {
    const onPatch = renderPanel(makeProject());
    fireEvent.change(screen.getByTestId("custom-lighting-texture"), {
      target: { value: "暗部死黑保留质感，高光锐化不溢出" },
    });
    expect(onPatch).toHaveBeenCalledWith({
      customLighting: {
        name: "我的风格",
        params: {
          ...LIGHTING_PRESETS.kr.params,
          textureRollOff: "暗部死黑保留质感，高光锐化不溢出",
        },
        source: "manual",
      },
    } satisfies RestyleSetupPatch);
  });

  it("已有参考图提取的自定义时，微调保留风格名但 source 转为 manual", () => {
    const customLighting = {
      name: "冷调都市",
      params: {
        contrastRatio: -60,
        tempTint: -80,
        palette: { shadows: "深青蓝", midtones: "冷灰低饱和", highlights: "阴冷白收敛" },
        textureRollOff: "整体低反差平滑，数字感干净",
        skinToneOffset: "偏冷白，去饱和防红润",
      },
      source: "reference" as const,
    };
    const onPatch = renderPanel(makeProject({ customLighting }));
    expect(screen.getByTestId("custom-lighting-status")).toHaveTextContent("冷调都市");
    expect(screen.getByTestId("custom-lighting-status")).toHaveTextContent("参考图提取");

    fireEvent.change(screen.getByRole("slider", { name: "色温偏移" }), { target: { value: "-70" } });
    expect(onPatch).toHaveBeenCalledWith({
      customLighting: {
        name: "冷调都市",
        params: { ...customLighting.params, tempTint: -70 },
        source: "manual",
      },
    } satisfies RestyleSetupPatch);
  });

  it("「重置到地域预设」把参数重置为当前市场预设（仍为自定义、source manual）", () => {
    const onPatch = renderPanel(
      makeProject({
        targetMarket: "us",
        customLighting: {
          name: "我的风格",
          params: { ...LIGHTING_PRESETS.kr.params, contrastRatio: 99 },
          source: "manual",
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /重置到地域预设/ }));
    expect(onPatch).toHaveBeenCalledWith({
      customLighting: {
        name: "我的风格",
        params: LIGHTING_PRESETS.us.params,
        source: "manual",
      },
    } satisfies RestyleSetupPatch);
  });

  it("「清除自定义」回写 undefined，清除后状态行回落地域预设", () => {
    const onPatch = renderPanel(
      makeProject({
        customLighting: {
          name: "我的风格",
          params: LIGHTING_PRESETS.kr.params,
          source: "manual",
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /清除自定义/ }));
    expect(onPatch).toHaveBeenCalledWith({ customLighting: undefined } satisfies RestyleSetupPatch);

    renderPanel(makeProject());
    expect(screen.getAllByTestId("custom-lighting-status")[1]).toHaveTextContent(
      "未设置自定义风格，当前使用目标市场地域预设",
    );
  });
});

describe("customLighting 持久化解析", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("合法自定义风格随项目持久化回读", () => {
    const customLighting = {
      name: "冷调都市",
      params: {
        contrastRatio: -60,
        tempTint: -80,
        palette: { shadows: "深青蓝", midtones: "冷灰低饱和", highlights: "阴冷白收敛" },
        textureRollOff: "整体低反差平滑，数字感干净",
        skinToneOffset: "偏冷白，去饱和防红润",
      },
      source: "reference" as const,
    };
    saveRestyleProjects(USER_ID, [makeProject({ customLighting })]);
    const [loaded] = loadRestyleProjects(USER_ID);
    expect(loaded.customLighting).toEqual(customLighting);
  });

  it("数值维钳 ±100、非法 source 归 manual、文本维缺失给兜底", () => {
    window.localStorage.setItem(
      `doopoo:restyle-projects:${USER_ID}`,
      JSON.stringify([
        {
          ...makeProject(),
          customLighting: {
            name: "",
            source: "weird",
            params: {
              contrastRatio: 250,
              tempTint: "-999",
              palette: { shadows: "深青蓝" },
            },
          },
        },
      ]),
    );
    const [loaded] = loadRestyleProjects(USER_ID);
    expect(loaded.customLighting?.name).toBe("自定义风格");
    expect(loaded.customLighting?.source).toBe("manual");
    expect(loaded.customLighting?.params.contrastRatio).toBe(100);
    expect(loaded.customLighting?.params.tempTint).toBe(-100);
    expect(loaded.customLighting?.params.palette).toEqual({
      shadows: "深青蓝",
      midtones: "自然过渡",
      highlights: "保留细节不溢出",
    });
    expect(loaded.customLighting?.params.textureRollOff).toBe("高光柔化，暗部不死黑");
  });

  it("params 整体缺失/非对象时丢弃 customLighting（回落地域预设）", () => {
    window.localStorage.setItem(
      `doopoo:restyle-projects:${USER_ID}`,
      JSON.stringify([
        { ...makeProject({ id: "p1" }), customLighting: { name: "x" } },
        { ...makeProject({ id: "p2" }), customLighting: "not-an-object" },
      ]),
    );
    const [p1, p2] = loadRestyleProjects(USER_ID);
    expect(p1.customLighting).toBeUndefined();
    expect(p2.customLighting).toBeUndefined();
  });

  it("旧项目没有 customLighting 字段时按 undefined 解析", () => {
    saveRestyleProjects(USER_ID, [makeProject()]);
    const [loaded] = loadRestyleProjects(USER_ID);
    expect(loaded.customLighting).toBeUndefined();
  });
});
