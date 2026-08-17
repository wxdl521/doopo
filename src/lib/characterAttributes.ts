// ====================================================================
// characterAttributes —— 角色属性与可编辑提示词的解析/对齐（纯函数）
//
// 2026-08 修复：parseCharacterEditablePrompt 的年龄正则写成了
// /(?:年龄\\s*[：:]\\s*|age\\s*)(\\d{1,3})/i —— 正则字面量里 \\s/\\d 是
// 「反斜杠 + s/d」，永不命中，提示词里改年龄回写不到角色属性，
// 属性面板与提示词各说各的（属性 30 / 提示词 age 35）。
// ====================================================================

/**
 * 从可编辑提示词解析年龄：`年龄：30`、`年龄: 30`、`age 30`、
 * `（群体角色, age 35）` 都能命中；0-200 整数校验，非法/缺失返回 undefined。
 */
export function parseCharacterAge(input: string): number | undefined {
  const match = input.match(/(?:年龄\s*[：:]\s*|age\s*)(\d{1,3})/i);
  if (!match) return undefined;
  const age = Number(match[1]);
  return Number.isInteger(age) && age >= 0 && age <= 200 ? age : undefined;
}

/**
 * 把提示词文本里的年龄字段（首个命中）覆盖为指定值；没有年龄字段时原样返回。
 * 重新生成前「以角色属性为准」对齐用：调用方先比对 parseCharacterAge。
 */
export function alignPromptAge(input: string, age: number): string {
  return input.replace(/(年龄\s*[：:]\s*|age\s*)\d{1,3}/i, `$1${age}`);
}

/**
 * 把可编辑提示词里 `标签：…` 的一整行替换为新值（行首匹配，贪婪到行尾）；
 * 没有该行时在末尾追加。属性面板内联编辑 → 同步提示词文本用，
 * 避免属性与提示词再次脱节。
 */
export function replacePromptFieldLine(input: string, label: string, value: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|\\n)\\s*${escaped}\\s*[：:][^\\n]*`, "m");
  const line = `${label}：${value}`;
  return re.test(input) ? input.replace(re, `$1${line}`) : `${input.trimEnd()}\n${line}`;
}

/** 属性面板/角色卡的年龄输入校验：0-200 整数，非法返回 null。 */
export function parseAgeDraftInput(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const age = Number(trimmed);
  return Number.isInteger(age) && age >= 0 && age <= 200 ? age : null;
}
