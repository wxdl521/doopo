import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { RestyleSetupPanel, RestyleSpecCard } from "@/components/restyle/RestyleSetupPanel";
import { zh } from "@/i18n/zh";
import type { RestyleProject } from "@/components/restyle/restyleStorage";

const project0 = {
  id: "p1", title: "t", createdAt: "", updatedAt: "", stage: "analysis" as const,
  assetIds: [], confirmedAssetIds: [], files: [], conversations: [],
  activeConversationId: null, planNote: "", styleBrief: "", extractedAssets: [],
  analysisSummary: "",
};

function Harness() {
  const [project, setProject] = useState<RestyleProject>(project0 as RestyleProject);
  const onPatch = (patch: Partial<RestyleProject>) =>
    setProject((p) => ({ ...p, ...patch }));
  return (
    <>
      <RestyleSetupPanel project={project} videoPricing={[]} currentVideoModel={project.videoModel ?? ""} onPatch={onPatch} t={zh} />
      <RestyleSpecCard project={project} videoPricing={[]} currentVideoModel={project.videoModel ?? ""} onPatch={onPatch} onConfirm={() => {}} t={zh} />
    </>
  );
}

describe("联动", () => {
  it("规格卡改模式 → 面板同步", () => {
    render(<Harness />);
    const spec = screen.getByTestId("restyle-spec-card");
    const autoBtn = Array.from(spec.querySelectorAll("button")).find((b) => b.textContent?.includes("极速全自动"))!;
    fireEvent.click(autoBtn);
    // 面板应显示「已应用」徽标在极速卡片上
    const panel = screen.getByTestId("restyle-setup-panel");
    const cards = Array.from(panel.querySelectorAll("button"));
    const autoCard = cards.find((b) => b.textContent?.includes("极速全自动"))!;
    expect(autoCard.textContent).toContain(zh.restyle_setup_applied ?? "已应用");
  });

  it("面板点模式卡片即生效 → 规格卡即时同步", () => {
    render(<Harness />);
    const panel = screen.getByTestId("restyle-setup-panel");
    const customCard = Array.from(panel.querySelectorAll("button")).find((b) => b.textContent?.includes("自定义干预"))!;
    fireEvent.click(customCard);
    // 规格卡的自定义干预按钮应立即处于选中态
    const spec = screen.getByTestId("restyle-spec-card");
    const customInSpec = Array.from(spec.querySelectorAll("button")).find((b) => b.textContent?.includes("自定义干预"))!;
    expect(customInSpec.getAttribute("aria-pressed")).toBe("true");
    // 面板自身也应把「已应用」徽标挂到自定义干预卡片
    expect(customCard.textContent).toContain(zh.restyle_setup_applied ?? "已应用");
  });
});
