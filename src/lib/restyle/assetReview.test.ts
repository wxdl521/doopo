import { describe, expect, it } from "vitest";
import {
  buildAssetReviewContext,
  extractAssetReviewJson,
  parseAssetReviewPayload,
} from "./assetReview";

describe("parseAssetReviewPayload（mock AI 返回）", () => {
  it("解析标准 verdict + issues", () => {
    const raw = extractAssetReviewJson(
      `\`\`\`json
      {
        "verdict": "fail",
        "issues": [
          {
            "assetId": "asset-1",
            "field": "sourceName",
            "severity": "high",
            "message": "角色是群体而非具体个体",
            "suggestion": "改为具体人物名"
          },
          {
            "assetId": "rel-1",
            "field": "relation",
            "severity": "medium",
            "message": "关系文案与原片定位矛盾",
            "suggestion": ""
          }
        ]
      }
      \`\`\``,
    );
    expect(parseAssetReviewPayload(raw)).toEqual({
      verdict: "fail",
      issues: [
        {
          assetId: "asset-1",
          field: "sourceName",
          severity: "high",
          message: "角色是群体而非具体个体",
          suggestion: "改为具体人物名",
        },
        {
          assetId: "rel-1",
          field: "relation",
          severity: "medium",
          message: "关系文案与原片定位矛盾",
          suggestion: "",
        },
      ],
    });
  });

  it("坏行丢弃而不是整体失败，verdict 缺失时按 issues 推断", () => {
    const result = parseAssetReviewPayload({
      issues: [
        { assetId: "asset-1", field: "targetName", severity: "low", message: "缺目标名" },
        { field: "sourceName" }, // 缺 assetId / message / severity，整条丢弃
        "not-an-object",
      ],
    });
    expect(result.verdict).toBe("pass_with_notes");
    expect(result.issues).toEqual([
      { assetId: "asset-1", field: "targetName", severity: "low", message: "缺目标名", suggestion: "" },
    ]);
  });

  it("干净结果：无 issues 时 verdict 推断为 pass", () => {
    expect(parseAssetReviewPayload({ issues: [] })).toEqual({ verdict: "pass", issues: [] });
    expect(parseAssetReviewPayload(null)).toEqual({ verdict: "pass", issues: [] });
  });

  it("模型输出带杂讯时 extractAssetReviewJson 仍能提取 JSON", () => {
    expect(extractAssetReviewJson("前置说明 {\"verdict\":\"pass\",\"issues\":[]} 后置")).toEqual({
      verdict: "pass",
      issues: [],
    });
    expect(() => extractAssetReviewJson("没有 JSON")).toThrow();
  });
});

describe("buildAssetReviewContext", () => {
  it("关系 from/to 由资产 id 还原为角色名", () => {
    const context = JSON.parse(
      buildAssetReviewContext({
        assets: [
          {
            id: "asset-1",
            kind: "character",
            sourceName: "林夏",
            sourceDescription: "女主",
            targetName: "Lin",
            targetDescription: " heroine",
            importance: "required",
            shouldRestyle: true,
          },
          {
            id: "asset-2",
            kind: "character",
            sourceName: "院长",
            sourceDescription: "医院院长",
            targetName: "Hall",
            targetDescription: "director",
            importance: "optional",
            shouldRestyle: true,
          },
        ],
        relations: [{ id: "rel-1", from: "asset-1", to: "asset-2", relation: "下属", note: "EP01" }],
      }),
    ) as { relations: Array<{ from: string; to: string }> };
    expect(context.relations[0]).toMatchObject({ from: "林夏", to: "院长" });
  });
});
