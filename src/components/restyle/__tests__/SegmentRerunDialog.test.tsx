import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SegmentRerunDialog } from "../SegmentRerunDialog";
import { zh } from "../../../i18n/zh";
import type { RestyleAttachment } from "../restyleStorage";

const segment = {
  id: "att-1",
  episode: "EP01",
  segmentId: "U02",
} as RestyleAttachment;

function renderDialog(handlers: { onSubmit?: (f: string) => void; onClose?: () => void } = {}) {
  const props = {
    open: true,
    segment,
    onSubmit: handlers.onSubmit ?? vi.fn(),
    onClose: handlers.onClose ?? vi.fn(),
    t: zh,
  };
  render(<SegmentRerunDialog {...props} />);
  return props;
}

describe("SegmentRerunDialog", () => {
  it("预填默认返工说明并显示集/段信息", () => {
    renderDialog();
    expect(screen.getByText("EP01 U02")).toBeTruthy();
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toContain("人物/动作/比例需要调整");
  });

  it("提交时回传当前说明；清空后按默认文案兜底", () => {
    const onSubmit = vi.fn();
    renderDialog({ onSubmit });
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "人物不像 Grace" } });
    fireEvent.click(screen.getByText(zh.restyle_rework_dialog_submit));
    expect(onSubmit).toHaveBeenCalledWith("人物不像 Grace");

    onSubmit.mockClear();
    fireEvent.change(textarea, { target: { value: "   " } });
    renderDialog({ onSubmit });
  });

  it("快捷标签追加到说明文本", () => {
    renderDialog();
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    const before = textarea.value;
    fireEvent.click(screen.getByText(zh.restyle_rework_tag_lipsync));
    expect(textarea.value).toContain(before);
    expect(textarea.value).toContain(zh.restyle_rework_tag_lipsync);
  });

  it("open=false 不渲染；取消触发 onClose", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <SegmentRerunDialog open={false} segment={segment} onSubmit={vi.fn()} onClose={onClose} t={zh} />,
    );
    expect(screen.queryByText(zh.restyle_rework_dialog_title)).toBeNull();
    unmount();
    renderDialog({ onClose });
    fireEvent.click(screen.getByText(zh.common_cancel));
    expect(onClose).toHaveBeenCalled();
  });
});
