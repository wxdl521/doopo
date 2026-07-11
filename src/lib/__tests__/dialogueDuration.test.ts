import { describe, it, expect } from "vitest";
import {
  extractDialogue,
  countSpeakableChars,
  estimateDialogueSpeechSec,
  SPEECH_RATE_CPS,
} from "../dialogueDuration";

describe("extractDialogue", () => {
  it("空字符串 / 无引号 -> 空串(纯空镜/动作描写)", () => {
    expect(extractDialogue("")).toBe("");
    expect(extractDialogue("晨光穿透树冠,光斑落在青苔上。")).toBe("");
    expect(extractDialogue("陆深推开门,坐下,椅子嘎吱响。")).toBe("");
  });

  it("单句 「」 引号 -> 只取引号内", () => {
    expect(extractDialogue("陆深:「我没事。」")).toBe("我没事。");
  });

  it("『』 引号", () => {
    expect(extractDialogue("小明:『老师找你!』")).toBe("老师找你!");
  });

  it("ASCII 双引号 toggle(成对开闭)", () => {
    expect(extractDialogue('陆深:"我没事。"')).toBe("我没事。");
    expect(extractDialogue('甲:"你来啦。" 乙:"嗯。"')).toBe("你来啦。嗯。");
  });

  it("全角引号配对(“”)", () => {
    expect(extractDialogue("陆深:“我没事。”")).toBe("我没事。");
  });

  it("多句 + 角色名标签 + 动作描写 -> 只拼引号内", () => {
    const text = "门被推开,小明冲进来。小明:「老师找你!」陆深合上书本:「什么事?」随即起身。";
    expect(extractDialogue(text)).toBe("老师找你!什么事?");
  });

  it("未闭合引号 -> 余下内容计入(估算更安全)", () => {
    expect(extractDialogue("陆深:「我没事。")).toBe("我没事。");
  });

  it("ASCII 单引号 ' 不做分隔(避免 it's 误判)", () => {
    // 单引号被忽略,整体无引号 -> 空
    expect(extractDialogue("it's a test")).toBe("");
  });
});

describe("countSpeakableChars", () => {
  it("只数汉字 + 字母数字,排除标点/空白", () => {
    expect(countSpeakableChars("我没事。")).toBe(3); // 我没事
    expect(countSpeakableChars("OK, 我来!")).toBe(4); // O K 我 来
    expect(countSpeakableChars("老师找你!")).toBe(4);
  });

  it("全角字母数字也计数", () => {
    expect(countSpeakableChars("ＡＢ１２")).toBe(4);
  });

  it("标点/空白/符号不计", () => {
    expect(countSpeakableChars("，。！？…— ()[]")).toBe(0);
  });

  it("空串 -> 0", () => {
    expect(countSpeakableChars("")).toBe(0);
  });
});

describe("estimateDialogueSpeechSec", () => {
  it("无台词(空镜) -> 0", () => {
    expect(estimateDialogueSpeechSec("晨光穿透树冠,光斑落在青苔上。")).toBe(0);
    expect(estimateDialogueSpeechSec("")).toBe(0);
  });

  it("4 字台词 -> 1s(4 字/秒)", () => {
    // 我没事 = 3 字 -> ceil(3/4) = 1
    expect(estimateDialogueSpeechSec("陆深:「我没事。」")).toBe(1);
    // 老师找你 = 4 字 -> ceil(4/4) = 1
    expect(estimateDialogueSpeechSec("小明:『老师找你!』")).toBe(1);
  });

  it("向上取整:5 字 -> 2s", () => {
    // 等很久了吗 = 5 字 -> ceil(5/4) = 2
    expect(estimateDialogueSpeechSec('乙:"等很久了吗?"')).toBe(2);
  });

  it("40 字 -> 10s(单视频上限)", () => {
    const line = "一二三四五六七八九十".repeat(4); // 40 字
    expect(line.length).toBe(40);
    expect(estimateDialogueSpeechSec(`甲:"${line}"`)).toBe(10);
  });

  it("41 字 -> 11s(超 10s,应触发拆组)", () => {
    const line = "一二三四五六七八九十".repeat(4) + "一"; // 41 字
    expect(estimateDialogueSpeechSec(`甲:"${line}"`)).toBe(11);
  });

  it("只统计引号内:动作描写不算字数", () => {
    // 引号内 4 字,引号外一长串动作不算
    const text = "陆深推开门把书包甩到桌上坐下椅子嘎吱响,然后说:「我没事。」";
    expect(estimateDialogueSpeechSec(text)).toBe(1);
  });

  it("自定义语速", () => {
    // 8 字,默认 4 字/秒 -> 2s;用 8 字/秒 -> 1s
    expect(estimateDialogueSpeechSec('甲:"一二三四五六七八"')).toBe(2);
    expect(estimateDialogueSpeechSec('甲:"一二三四五六七八"', 8)).toBe(1);
  });

  it("SPEECH_RATE_CPS = 4", () => {
    expect(SPEECH_RATE_CPS).toBe(4);
  });
});
