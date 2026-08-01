import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AssetEditDialog } from "../AssetEditDialog";
import { zh } from "../../../i18n/zh";
import type { RestyleExtractedAsset } from "../restyleStorage";

const existingAsset: RestyleExtractedAsset = {
  id: "asset-1",
  kind: "character",
  sourceName: "林夏",
  sourceDescription: "女主，冷静",
  targetName: "Iris",
  targetDescription: "Lead, calm",
  importance: "required",
  shouldRestyle: true,
};

function renderAddDialog(onSubmit = vi.fn()) {
  const onClose = vi.fn();
  render(
    <AssetEditDialog open initialValue={null} onSubmit={onSubmit} onClose={onClose} t={zh} />,
  );
  return { onSubmit, onClose };
}

describe("AssetEditDialog", () => {
  it("open=false 时不渲染", () => {
    render(
      <AssetEditDialog
        open={false}
        initialValue={null}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
        t={zh}
      />,
    );
    expect(screen.queryByText("新增资产")).not.toBeInTheDocument();
  });

  it("新增模式渲染标题与分段类型按钮，默认选中场景", () => {
    renderAddDialog();
    expect(screen.getByText("新增资产")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "场景" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "角色" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "道具" })).toHaveAttribute("aria-pressed", "false");
  });

  it("原片名称为空时确定按钮禁用并提示，填写后可用", () => {
    renderAddDialog();
    const submit = screen.getByRole("button", { name: "确认" });
    expect(submit).toBeDisabled();
    expect(screen.getByText("请填写原片名称")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("原片名称"), { target: { value: "林夏" } });
    expect(submit).toBeEnabled();
  });

  it("目标名称 / 目标设定留空时自动同步原片名称 / 原片定位", () => {
    const { onSubmit } = renderAddDialog();
    fireEvent.change(screen.getByLabelText("原片名称"), { target: { value: "林夏" } });
    fireEvent.change(screen.getByLabelText("原片定位"), { target: { value: "女主，冷静" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const asset = onSubmit.mock.calls[0][0] as RestyleExtractedAsset;
    expect(asset.sourceName).toBe("林夏");
    expect(asset.targetName).toBe("林夏");
    expect(asset.targetDescription).toBe("女主，冷静");
    expect(asset.kind).toBe("scene");
  });

  it("分段按钮直接映射 character / scene / prop", () => {
    const { onSubmit } = renderAddDialog();
    fireEvent.change(screen.getByLabelText("原片名称"), { target: { value: "老式座钟" } });
    fireEvent.click(screen.getByRole("button", { name: "道具" }));
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect((onSubmit.mock.calls[0][0] as RestyleExtractedAsset).kind).toBe("prop");

    fireEvent.click(screen.getByRole("button", { name: "角色" }));
    fireEvent.change(screen.getByLabelText("原片名称"), { target: { value: "林夏" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect((onSubmit.mock.calls[1][0] as RestyleExtractedAsset).kind).toBe("character");
  });

  it("编辑模式预填字段、保留 id，标题为编辑资产", () => {
    const onSubmit = vi.fn();
    render(
      <AssetEditDialog
        open
        initialValue={existingAsset}
        onSubmit={onSubmit}
        onClose={vi.fn()}
        t={zh}
      />,
    );
    expect(screen.getByText("编辑资产")).toBeInTheDocument();
    expect(screen.getByLabelText("原片名称")).toHaveValue("林夏");
    expect(screen.getByLabelText("目标名称")).toHaveValue("Iris");
    expect(screen.getByRole("button", { name: "角色" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.change(screen.getByLabelText("目标名称"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    const asset = onSubmit.mock.calls[0][0] as RestyleExtractedAsset;
    expect(asset.id).toBe("asset-1");
    // 编辑时清空目标名称同样自动回填原片名称。
    expect(asset.targetName).toBe("林夏");
    expect(asset.importance).toBe("required");
  });

  it("遮罩点击与 Esc 触发 onClose", () => {
    const { onClose } = renderAddDialog();
    const overlay = screen.getByRole("dialog");
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
