// ====================================================================
// lightingExtract 测试：路径 A 参考图提取的响应解析（合法/脏数据/钳制）
// ====================================================================
import { describe, expect, it } from "vitest";
import {
  LIGHTING_EXTRACT_PARSE_ERROR,
  parseLightingExtraction,
} from "./lightingExtract.functions";

const VALID_JSON = JSON.stringify({
  name: "冷调都市",
  contrastRatio: 45,
  tempTint: -30,
  palette: {
    shadows: "加蓝，青蓝倾向",
    midtones: "低饱和冷灰",
    highlights: "阴冷白，收敛不溢出",
  },
  textureRollOff: "整体低反差平滑，数字感干净",
  skinToneOffset: "偏冷白，去饱和防红润",
});

describe("parseLightingExtraction 合法输出", () => {
  it("合法 JSON 原样解析为 5 维参数 + 风格名", () => {
    const result = parseLightingExtraction(VALID_JSON);
    expect(result.name).toBe("冷调都市");
    expect(result.params).toEqual({
      contrastRatio: 45,
      tempTint: -30,
      palette: {
        shadows: "加蓝，青蓝倾向",
        midtones: "低饱和冷灰",
        highlights: "阴冷白，收敛不溢出",
      },
      textureRollOff: "整体低反差平滑，数字感干净",
      skinToneOffset: "偏冷白，去饱和防红润",
    });
  });

  it("容忍 ```json 围栏与前后杂散文本", () => {
    const messy = `好的，提取结果如下：\n\`\`\`json\n${VALID_JSON}\n\`\`\`\n以上。`;
    expect(parseLightingExtraction(messy).params.contrastRatio).toBe(45);
  });
});

describe("parseLightingExtraction 脏数据兜底", () => {
  it("字符串数字 / 小数被收敛为整数", () => {
    const result = parseLightingExtraction(
      JSON.stringify({ contrastRatio: "45.6", tempTint: "-30.4" }),
    );
    expect(result.params.contrastRatio).toBe(46);
    expect(result.params.tempTint).toBe(-30);
  });

  it("缺失字段给影调兜底文案，风格名兜底「自定义风格」", () => {
    const result = parseLightingExtraction(JSON.stringify({ contrastRatio: 10 }));
    expect(result.name).toBe("自定义风格");
    expect(result.params.palette).toEqual({
      shadows: "自然过渡",
      midtones: "自然过渡",
      highlights: "保留细节不溢出",
    });
    expect(result.params.textureRollOff).toBe("高光柔化，暗部不死黑");
    expect(result.params.skinToneOffset).toBe("中性，肤色防变绿变黄");
  });

  it("palette 整体非对象 / 数值维完全不是数也能兜底", () => {
    const result = parseLightingExtraction(
      JSON.stringify({ contrastRatio: "硬朗", tempTint: null, palette: "青橙色调" }),
    );
    expect(result.params.contrastRatio).toBe(0);
    expect(result.params.tempTint).toBe(0);
    expect(result.params.palette.shadows).toBe("自然过渡");
  });
});

describe("parseLightingExtraction ±100 钳制", () => {
  it("越界数值钳到 ±100", () => {
    const result = parseLightingExtraction(
      JSON.stringify({ contrastRatio: 250, tempTint: -999 }),
    );
    expect(result.params.contrastRatio).toBe(100);
    expect(result.params.tempTint).toBe(-100);
  });

  it("边界值 ±100 保持不变", () => {
    const result = parseLightingExtraction(JSON.stringify({ contrastRatio: 100, tempTint: -100 }));
    expect(result.params.contrastRatio).toBe(100);
    expect(result.params.tempTint).toBe(-100);
  });
});

describe("parseLightingExtraction 失败友好错误", () => {
  it("非 JSON / 顶层不是对象时抛友好错误", () => {
    expect(() => parseLightingExtraction("这不是 JSON")).toThrow(LIGHTING_EXTRACT_PARSE_ERROR);
    expect(() => parseLightingExtraction("[1,2,3]")).toThrow(LIGHTING_EXTRACT_PARSE_ERROR);
    expect(() => parseLightingExtraction("{ 不完整")).toThrow(LIGHTING_EXTRACT_PARSE_ERROR);
  });
});
