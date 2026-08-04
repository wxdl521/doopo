// ====================================================================
// ExtractedAssetTable 防抖 merge 回归：300ms 防抖窗口内收到外部 assets
// 变更（如「采纳建议」）时，未提交击键不丢、外部对未编辑字段的变更不被
// 旧快照覆盖；外部删除的行提交时不复活。
// ====================================================================

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtractedAssetTable } from "../ExtractedAssetTable";
import { zh } from "../../../i18n/zh";
import type { RestyleExtractedAsset } from "../restyleStorage";

function makeAsset(overrides: Partial<RestyleExtractedAsset>): RestyleExtractedAsset {
  return {
    id: "asset-1",
    kind: "character",
    sourceName: "林夏",
    sourceDescription: "女主，冷静",
    targetName: "Iris",
    targetDescription: "Lead, calm",
    importance: "required",
    shouldRestyle: true,
    ...overrides,
  };
}

function renderTable(assets: RestyleExtractedAsset[], onChange = vi.fn()) {
  const utils = render(<ExtractedAssetTable assets={assets} t={zh} onChange={onChange} />);
  return {
    ...utils,
    onChange,
    rerenderWith(next: RestyleExtractedAsset[]) {
      utils.rerender(<ExtractedAssetTable assets={next} t={zh} onChange={onChange} />);
    },
  };
}

describe("ExtractedAssetTable 防抖 merge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("防抖窗口内外部改了未编辑字段：提交时 merge，双方变更都保留", () => {
    const base = [makeAsset({ id: "a1" })];
    const { rerenderWith, onChange } = renderTable(base);

    // 用户开始编辑 sourceName（进入 300ms 防抖窗口）。
    fireEvent.change(screen.getByLabelText(`${zh.restyle_asset_source_name}：a1`), {
      target: { value: "林夏改" },
    });
    // 防抖未到期时外部写入 targetDescription（如「采纳建议」）。
    rerenderWith([{ ...base[0], targetDescription: "外部更新" }]);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const merged = onChange.mock.calls[0][0] as RestyleExtractedAsset[];
    expect(merged).toHaveLength(1);
    // 用户击键未丢。
    expect(merged[0].sourceName).toBe("林夏改");
    // 外部对未编辑字段的变更不被旧快照覆盖。
    expect(merged[0].targetDescription).toBe("外部更新");
  });

  it("收到外部 assets 时本地行保留未提交击键，其余字段跟随外部", () => {
    const base = [makeAsset({ id: "a1" })];
    const { rerenderWith } = renderTable(base);

    const nameInput = screen.getByLabelText(
      `${zh.restyle_asset_source_name}：a1`,
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "林夏Y" } });
    rerenderWith([{ ...base[0], sourceDescription: "外部描述" }]);

    // 未提交击键不被外部快照冲掉。
    expect(nameInput.value).toBe("林夏Y");
    // 未编辑字段立即跟随外部变更。
    const descInput = screen.getByLabelText(
      `${zh.restyle_asset_source_description}：a1`,
    ) as HTMLTextAreaElement;
    expect(descInput.value).toBe("外部描述");
  });

  it("防抖窗口内外部删除的行提交时不复活", () => {
    const base = [makeAsset({ id: "a1" }), makeAsset({ id: "a2", sourceName: "老周" })];
    const { rerenderWith, onChange } = renderTable(base);

    fireEvent.change(screen.getByLabelText(`${zh.restyle_asset_source_name}：a1`), {
      target: { value: "林夏改" },
    });
    // 外部删掉了 a1（如父级 deleteAsset）。
    rerenderWith([base[1]]);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const merged = onChange.mock.calls[0][0] as RestyleExtractedAsset[];
    expect(merged.map((asset) => asset.id)).toEqual(["a2"]);
  });

  it("无外部变更时防抖提交照常回调整张表", () => {
    const base = [makeAsset({ id: "a1" })];
    const { onChange } = renderTable(base);

    fireEvent.change(screen.getByLabelText(`${zh.restyle_asset_target_name}：a1`), {
      target: { value: "Iris2" },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const merged = onChange.mock.calls[0][0] as RestyleExtractedAsset[];
    expect(merged[0]).toEqual({ ...base[0], targetName: "Iris2" });
  });
});
