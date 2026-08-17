// ====================================================================
// characterAttributes 纯函数测试（角色属性直接修改 + 年龄解析 bug 回归）
// ====================================================================
import { describe, expect, it } from "vitest";
import {
  alignPromptAge,
  parseAgeDraftInput,
  parseCharacterAge,
  replacePromptFieldLine,
} from "../characterAttributes";

describe("parseCharacterAge（2026-08 正则字面量 \\s/\\d 永不命中 bug 修复）", () => {
  it("「年龄：30」与「年龄: 30」命中", () => {
    expect(parseCharacterAge("角色：林晚\n年龄：30\n面部特征：温和")).toBe(30);
    expect(parseCharacterAge("年龄: 30")).toBe(30);
  });

  it("「age 30」与「（群体角色, age 35）」命中", () => {
    expect(parseCharacterAge("age 30")).toBe(30);
    expect(parseCharacterAge("角色：xxx（群体角色, age 35）")).toBe(35);
    expect(parseCharacterAge("角色：林晚（女主角, age 25，医生）")).toBe(25);
  });

  it("0-200 校验保留；无年龄字段/非法值返回 undefined", () => {
    expect(parseCharacterAge("年龄：0")).toBe(0);
    expect(parseCharacterAge("年龄：200")).toBe(200);
    expect(parseCharacterAge("年龄：201")).toBeUndefined();
    expect(parseCharacterAge("年龄：abc")).toBeUndefined();
    expect(parseCharacterAge("面部特征：温和")).toBeUndefined();
  });
});

describe("alignPromptAge（重新生成前以属性为准覆盖提示词年龄）", () => {
  it("覆盖后无旧年龄残留（两种写法）", () => {
    const zh = alignPromptAge("角色：林晚\n年龄：30\n面部特征：温和", 41);
    expect(zh).toContain("年龄：41");
    expect(zh).not.toContain("30");
    const en = alignPromptAge("角色：xxx（群体角色, age 35）", 41);
    expect(en).toContain("age 41");
    expect(en).not.toContain("35");
  });

  it("没有年龄字段时原样返回", () => {
    const input = "角色：林晚\n面部特征：温和";
    expect(alignPromptAge(input, 41)).toBe(input);
  });
});

describe("replacePromptFieldLine（属性编辑同步提示词行）", () => {
  it("替换已有行（整行覆盖,其余行不动）", () => {
    const input = "风格：写实\n面部特征：旧脸\n身材体型：旧身材";
    const next = replacePromptFieldLine(input, "面部特征", "新脸");
    expect(next).toBe("风格：写实\n面部特征：新脸\n身材体型：旧身材");
  });

  it("没有该行时末尾追加", () => {
    const next = replacePromptFieldLine("风格：写实", "服装配饰", "白大褂");
    expect(next).toBe("风格：写实\n服装配饰：白大褂");
  });
});

describe("parseAgeDraftInput（内联编辑输入校验）", () => {
  it("合法 0-200 整数", () => {
    expect(parseAgeDraftInput("30")).toBe(30);
    expect(parseAgeDraftInput(" 0 ")).toBe(0);
    expect(parseAgeDraftInput("200")).toBe(200);
  });

  it("非法输入返回 null", () => {
    expect(parseAgeDraftInput("201")).toBeNull();
    expect(parseAgeDraftInput("-5")).toBeNull();
    expect(parseAgeDraftInput("3.5")).toBeNull();
    expect(parseAgeDraftInput("")).toBeNull();
    expect(parseAgeDraftInput("三十")).toBeNull();
  });
});
