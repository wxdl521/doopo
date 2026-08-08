import { describe, expect, it } from "vitest";
import { isRegenerateIntent } from "../restyleIntent";

describe("isRegenerateIntent", () => {
  it("recognises corrections", () => {
    for (const message of [
      "场景图片生成不对，请重新生成",
      "这张错了，重画一张",
      "人物不像，换一张",
    ]) {
      expect(isRegenerateIntent(message)).toBe(true);
    }
  });

  it("does not treat confirmations as corrections", () => {
    for (const message of ["确认", "继续下一步", "可以了", ""]) {
      expect(isRegenerateIntent(message)).toBe(false);
    }
  });
});
import { isConfirmIntent, isVideoRenderIntent } from "../restyleIntent";

describe("restyle intent", () => {
  it("recognises spoken confirmations", () => {
    for (const message of ["确认", "确认资产", "继续下一步", "可以了", "没问题", "OK", "生成方案"]) {
      expect(isConfirmIntent(message), message).toBe(true);
    }
  });

  it("does not treat revision requests as confirmation", () => {
    for (const message of ["这个角色不对", "请重新生成场景", "把光影调整为冷白色调"]) {
      expect(isConfirmIntent(message), message).toBe(false);
    }
  });

  it("recognises video render intent", () => {
    expect(isVideoRenderIntent("确认生成视频")).toBe(true);
    expect(isVideoRenderIntent("继续")).toBe(false);
  });
});

import { isReanalyzeIntent, isReplanIntent } from "../restyleIntent";

describe("isReanalyzeIntent", () => {
  it("recognises requests to re-analyse the source video", () => {
    for (const message of [
      "重新分析原片",
      "请再分析一遍原视频",
      "重新提取资产",
      "重新识别角色和场景",
      "重看原片",
      "资产表不对，重新分析",
      "补充分析，漏了一个角色",
      "漏了一个场景",
      "Re-analyse source",
    ]) {
      expect(isReanalyzeIntent(message), message).toBe(true);
    }
  });

  it("is mutually exclusive with confirm intent", () => {
    for (const message of ["确认", "确认资产", "继续下一步", "可以了", "OK"]) {
      expect(isReanalyzeIntent(message), message).toBe(false);
    }
  });

  it("leaves image-pointing corrections to the regenerate branch", () => {
    for (const message of [
      "场景图片生成不对，请重新生成",
      "这张错了，重画一张",
      "重新生成角色图片",
      "人物不像，换一张",
    ]) {
      expect(isReanalyzeIntent(message), message).toBe(false);
      // 这些说法仍由资产生图纠错分支接管。
      expect(isRegenerateIntent(message), message).toBe(true);
    }
  });

  it("does not fire on empty or unrelated messages", () => {
    for (const message of ["", "生成资产图片", "确认生成视频"]) {
      expect(isReanalyzeIntent(message), message).toBe(false);
    }
  });
});

describe("isReplanIntent", () => {
  it("recognises requests to redo the whole plan", () => {
    for (const message of [
      "方案不对，重新出方案",
      "重做方案",
      "重新生成方案",
      "重新分镜",
      "redo the plan",
    ]) {
      expect(isReplanIntent(message), message).toBe(true);
    }
  });

  it("is mutually exclusive with confirm intent", () => {
    for (const message of ["确认", "继续下一步", "可以了"]) {
      expect(isReplanIntent(message), message).toBe(false);
    }
  });

  it("does not catch local segment tweaks or re-analyse requests", () => {
    for (const message of [
      "请将第一个视频的 U01 光影调整为冷白色调",
      "重新分析原片",
      "",
    ]) {
      expect(isReplanIntent(message), message).toBe(false);
    }
  });
});

import { parseSegmentRerunIntent } from "../restyleIntent";

describe("parseSegmentRerunIntent", () => {
  it("parses episode and segment in various writings", () => {
    expect(parseSegmentRerunIntent("重新生成第一集01片段")).toEqual({
      episode: 1,
      episodes: [1],
      segmentId: "U01",
      segments: ["U01"],
      feedback: "重新生成第一集01片段",
    });
    expect(parseSegmentRerunIntent("重跑第二集")?.episode).toBe(2);
    expect(parseSegmentRerunIntent("重跑第二集")?.segmentId).toBeUndefined();
    expect(parseSegmentRerunIntent("重跑第二集")?.segments).toEqual([]);
    expect(parseSegmentRerunIntent("重新生成EP01的U03")).toMatchObject({
      episode: 1,
      segmentId: "U03",
    });
    expect(parseSegmentRerunIntent("重出第3集片段2")).toMatchObject({
      episode: 3,
      segmentId: "U02",
    });
    expect(parseSegmentRerunIntent("再生成01集第二段")).toMatchObject({
      episode: 1,
      segmentId: "U02",
    });
    expect(parseSegmentRerunIntent("重做第十集")?.episode).toBe(10);
    expect(parseSegmentRerunIntent("redo episode 2 segment 3")).toMatchObject({
      episode: 2,
      segmentId: "U03",
    });
  });

  it("collects every segment named in one message", () => {
    const intent = parseSegmentRerunIntent("重新生成EP01 U02片段、EP01 U03片段");
    expect(intent?.segments).toEqual(["U02", "U03"]);
    // segmentId 保留为兼容首项。
    expect(intent?.segmentId).toBe("U02");
    expect(intent?.episodes).toEqual([1]);
  });

  it("collects every episode named in one message", () => {
    const intent = parseSegmentRerunIntent("重跑第1集U02、第2集U01");
    expect(intent?.episodes).toEqual([1, 2]);
    expect(intent?.episode).toBe(1);
    expect(intent?.segments).toEqual(["U01", "U02"]);
  });

  it("parses mixed segment writings in one message", () => {
    const intent = parseSegmentRerunIntent("重新生成第1集的01片段和第二段，顺带 segment 4");
    expect(intent?.segments).toEqual(["U01", "U02", "U04"]);
    expect(intent?.episodes).toEqual([1]);
  });

  it("dedupes and sorts segments and episodes", () => {
    expect(parseSegmentRerunIntent("重做U03片段和U02片段，再生成U03")?.segments).toEqual([
      "U02",
      "U03",
    ]);
    const multiEpisode = parseSegmentRerunIntent("重跑第3集、第1集和第3集");
    expect(multiEpisode?.episodes).toEqual([1, 3]);
    expect(multiEpisode?.episode).toBe(1);
    expect(multiEpisode?.segments).toEqual([]);
  });

  it("parses segment without episode (routing falls back to unique/asked episode)", () => {
    const intent = parseSegmentRerunIntent("重新生成01片段");
    expect(intent?.segmentId).toBe("U01");
    expect(intent?.episode).toBeUndefined();
  });

  it("leaves asset-semantic regenerate requests to the image branch", () => {
    for (const message of [
      "重新生成场景图片",
      "角色不对，重新生成",
      "重新生成资产表",
      "道具图不像，重做一张",
    ]) {
      expect(parseSegmentRerunIntent(message), message).toBeNull();
      // 这些说法仍由资产生图纠错分支接管。
      expect(isRegenerateIntent(message), message).toBe(true);
    }
    // 英文资产语义同样豁免（isRegenerateIntent 只覆盖中文说法，不在此断言）。
    expect(parseSegmentRerunIntent("regenerate the character image")).toBeNull();
  });

  it("requires both a redo word and video context", () => {
    for (const message of [
      "",
      "重做",
      "重新分析原片",
      "重新生成方案",
      "确认生成视频",
      "把第一集 U01 光影调整为冷白色调",
    ]) {
      expect(parseSegmentRerunIntent(message), message).toBeNull();
    }
  });
});


// --------------------------------------------------------------------
// 收紧确认意图 + isAssetImageIntent（「继续生成资产图片」被抢跑回归）
// --------------------------------------------------------------------
import { isAssetImageIntent } from "../restyleIntent";

describe("isConfirmIntent 收紧：裸继续点名具体对象不算确认", () => {
  it("「继续生成资产图片」「继续补齐资产图」不是确认", () => {
    for (const message of ["继续生成资产图片", "继续补齐资产图"]) {
      expect(isConfirmIntent(message), message).toBe(false);
      expect(isAssetImageIntent(message), message).toBe(true);
    }
  });

  it("「继续下一步」「确认」「可以了」仍为确认", () => {
    for (const message of ["继续下一步", "确认", "可以了", "继续"]) {
      expect(isConfirmIntent(message), message).toBe(true);
    }
  });

  it("「继续重新分析原片」走重分析、「继续生成视频」走出片", () => {
    expect(isConfirmIntent("继续重新分析原片")).toBe(false);
    expect(isReanalyzeIntent("继续重新分析原片")).toBe(true);
    expect(isConfirmIntent("继续生成视频")).toBe(false);
    expect(isVideoRenderIntent("继续生成视频")).toBe(true);
  });
});

describe("isAssetImageIntent", () => {
  it("生成/补齐/重试资产图片类说法命中", () => {
    for (const message of [
      "生成资产图片",
      "继续生成资产图片",
      "补齐资产图",
      "重试生成场景图片",
      "重新生成角色图片",
    ]) {
      expect(isAssetImageIntent(message), message).toBe(true);
    }
  });

  it("出片 / 重分析 / 裸确认不命中", () => {
    for (const message of ["确认生成视频", "重新分析原片", "继续", "确认", ""]) {
      expect(isAssetImageIntent(message), message).toBe(false);
    }
  });
});


// --------------------------------------------------------------------
// busyMessageAction（忙时不吞消息回归：返工排队 vs 忙态回复）
// --------------------------------------------------------------------
import { busyMessageAction } from "../restyleIntent";

describe("busyMessageAction", () => {
  it("片段返工消息进排队机制（不给忙态回复）", () => {
    const action = busyMessageAction("重新生成第2集 U02", "生成转绘方案 第 1/5 窗");
    expect(action.kind).toBe("queue_rerun");
    if (action.kind === "queue_rerun") {
      expect(action.intent.episodes).toEqual([2]);
      expect(action.intent.segments).toEqual(["U02"]);
    }
  });

  it("整集返工同样进排队", () => {
    expect(busyMessageAction("重跑第二集", "步骤").kind).toBe("queue_rerun");
  });

  it("非返工消息给忙态回复并带当前步骤（「重做方案」「在吗」不排队）", () => {
    for (const message of ["重做方案", "在吗", "继续", "确认"]) {
      const action = busyMessageAction(message, "生成资产图片");
      expect(action.kind, message).toBe("busy_reply");
      if (action.kind === "busy_reply") {
        expect(action.content).toContain("正在执行：生成资产图片");
        expect(action.content).toContain("停止");
      }
    }
  });

  it("无步骤标签时回退「当前任务」", () => {
    const action = busyMessageAction("在吗");
    expect(action.kind).toBe("busy_reply");
    if (action.kind === "busy_reply") expect(action.content).toContain("当前任务");
  });

  it("资产语义的「重新生成」不排队（交由生图纠错，忙时也按忙态回复）", () => {
    expect(busyMessageAction("重新生成场景图片", "步骤").kind).toBe("busy_reply");
  });
});
