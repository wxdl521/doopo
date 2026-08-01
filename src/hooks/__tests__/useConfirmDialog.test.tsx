import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useConfirmDialog } from "../useConfirmDialog";
import { LanguageProvider } from "../../i18n/LanguageContext";

function Harness({
  options,
  onResult,
}: {
  options: Parameters<ReturnType<typeof useConfirmDialog>["confirm"]>[0];
  onResult: (confirmed: boolean) => void;
}) {
  const { confirm, ConfirmDialog } = useConfirmDialog();
  return (
    <>
      <button type="button" onClick={() => void confirm(options).then(onResult)}>
        trigger
      </button>
      <ConfirmDialog />
    </>
  );
}

function renderHarness(
  options: Parameters<ReturnType<typeof useConfirmDialog>["confirm"]>[0] = {
    title: "确定删除该作品？",
    danger: true,
  },
) {
  const onResult = vi.fn();
  render(
    <LanguageProvider>
      <Harness options={options} onResult={onResult} />
    </LanguageProvider>,
  );
  fireEvent.click(screen.getByText("trigger"));
  return { onResult };
}

describe("useConfirmDialog", () => {
  it("确认：Promise 解析为 true，danger 时确认按钮默认文案为「删除」", async () => {
    const { onResult } = renderHarness();
    expect(screen.getByText("确定删除该作品？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    await waitFor(() =>
      expect(screen.queryByText("确定删除该作品？")).not.toBeInTheDocument(),
    );
  });

  it("取消：Promise 解析为 false", async () => {
    const { onResult } = renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it("非 danger 时确认按钮默认文案为「确认」，可用 confirmText 覆盖", async () => {
    const { onResult } = renderHarness({ title: "继续操作？", confirmText: "继续" });
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });
});
