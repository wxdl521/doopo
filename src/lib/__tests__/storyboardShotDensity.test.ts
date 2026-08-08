// ====================================================================
// 台词驱动密度规则纯函数测试：
// distributeShotDurations（时长加权分配）/ checkShotDensity（密度校验）/
// countDialogueSentences（台词句数）
// ====================================================================
import { describe, expect, it } from "vitest";
import { countDialogueSentences } from "../dialogueDuration";
import { checkShotDensity, distributeShotDurations } from "../storyboard.functions";

describe("distributeShotDurations", () => {
  it("有台词的 shot 按时长权重分配,无台词 shot 按基准时长", () => {
    const ranges = distributeShotDurations(
      [
        { dialogue: "我们结婚三年了,你失业整整两个月,居然一点都不告诉我?" }, // 24 字 → 6.6 权重
        {}, // 反应镜头 → 0.9 权重
      ],
      0,
      15,
    );
    expect(ranges).toHaveLength(2);
    // 台词 shot 明显更长
    expect(ranges[0][1] - ranges[0][0]).toBeGreaterThan(ranges[1][1] - ranges[1][0]);
    // 首尾相接、总和对齐组区间
    expect(ranges[0][0]).toBe(0);
    expect(ranges[0][1]).toBe(ranges[1][0]);
    expect(ranges[1][1]).toBe(15);
  });

  it("全部无台词：退化为基准均分", () => {
    const ranges = distributeShotDurations([{}, {}, {}], 0, 9);
    expect(ranges[0][0]).toBeCloseTo(0);
    expect(ranges[0][1]).toBeCloseTo(3);
    expect(ranges[1][0]).toBeCloseTo(3);
    expect(ranges[1][1]).toBeCloseTo(6);
    expect(ranges[2][0]).toBeCloseTo(6);
    expect(ranges[2][1]).toBeCloseTo(9);
  });

  it("单 shot 拿满组区间；空输入返回空", () => {
    expect(distributeShotDurations([{ dialogue: "好。" }], 2, 10)).toEqual([[2, 10]]);
    expect(distributeShotDurations([], 0, 10)).toEqual([]);
  });

  it("长台词 shot 比短台词 shot 分得更多时长", () => {
    const ranges = distributeShotDurations(
      [
        { dialogue: "我怕你担心。" }, // 5 字
        { dialogue: "你知不知道我昨天还在跟中介看房子,打算把我们的小两居换成三居,给爸妈接过来住!" }, // 长
      ],
      0,
      12,
    );
    expect(ranges[1][1] - ranges[1][0]).toBeGreaterThan(ranges[0][1] - ranges[0][0]);
  });
});

describe("checkShotDensity", () => {
  const fiveSentences =
    "林晚:「这是什么?」陈默:「你怎么翻我东西了?」林晚:「我翻你东西?」「我们结婚三年了。」「你居然不告诉我?」";

  it("5 句台词只有 3 个 shot：给出密度警告", () => {
    const warning = checkShotDensity(fiveSentences, 3);
    expect(warning).toContain("5 句台词");
    expect(warning).toContain("3 个分镜");
    expect(warning).toContain("2~3 个 shot");
  });

  it("句数 ×2 达标：不警告", () => {
    expect(checkShotDensity(fiveSentences, 10)).toBeUndefined();
    expect(checkShotDensity(fiveSentences, 11)).toBeUndefined();
  });

  it("单句台词与纯动作组不校验", () => {
    expect(checkShotDensity("林晚:「这是什么?」", 1)).toBeUndefined();
    expect(checkShotDensity("晨光穿透浓密的树冠,在湿地上投下斑驳光影。", 1)).toBeUndefined();
  });
});

describe("countDialogueSentences", () => {
  it("按句读切分引号内台词", () => {
    expect(countDialogueSentences("「这是什么?」「你翻我东西?」「我们结婚三年了。」")).toBe(3);
    expect(countDialogueSentences("陆深:「我没事。」")).toBe(1);
    expect(countDialogueSentences("纯环境描写没有台词")).toBe(0);
  });

  it("纯标点/空白碎片不计入", () => {
    expect(countDialogueSentences("「……」「!」")).toBe(0);
  });
});
