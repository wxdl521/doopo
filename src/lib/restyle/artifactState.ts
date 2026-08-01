// ====================================================================
//  转绘 v2 产物确认中枢 —— 纯函数状态机
//
//  不依赖 supabase，可单测。restyle_artifacts 表的一行对应一个
//  ArtifactState；restyleArtifacts.functions.ts 负责读写表并调用
//  transitionArtifact 推进状态。
//
//  核心不变量（需求文档第五节）：
//  - content 是 AI 产出，approve 永不覆写它；用户改写只进 userContent。
//  - 上游变更导致 scopeHash 变化时状态回落 draft，但保留旧 userContent
//    供差异对照（重生成不覆盖人工改写）。
//  - 下游只读 user_approved 状态的 userContent ?? content。
// ====================================================================

export type ArtifactStatus = "draft" | "ai_checked" | "user_approved" | "rejected";

/**
 * JSONB 可序列化值。产物 content/userContent/issues 落 jsonb 列，
 * 且 createServerFn 返回值受 TanStack Start 的 ValidateSerializable
 * 检查约束，不能用 unknown。
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface ArtifactState {
  status: ArtifactStatus;
  /** AI 产出的内容（JSON）。只有 ai_write 能改它。 */
  content: JsonValue;
  /** 用户改写；null 表示未改，下游读取时回落到 content。 */
  userContent: JsonValue;
  /** 上游输入指纹；变化即需重新确认。 */
  scopeHash: string;
  /** 每次 approve +1。 */
  revision: number;
  /** 最近一次 AI 自检结论（ai-output-review 契约）。 */
  verdict: string | null;
  issues: JsonValue[];
}

export type ArtifactAction =
  | { type: "ai_write"; content: JsonValue; scopeHash: string }
  | { type: "ai_check"; verdict: string; issues: JsonValue[] }
  | { type: "approve"; userContent?: JsonValue }
  | { type: "reject" }
  | { type: "upstream_changed"; newScopeHash: string };

/** 新产物的初始状态（revision 与表默认值一致，从 1 开始）。 */
export function createInitialArtifact(content: JsonValue, scopeHash: string): ArtifactState {
  return {
    status: "draft",
    content,
    userContent: null,
    scopeHash,
    revision: 1,
    verdict: null,
    issues: [],
  };
}

export function transitionArtifact(state: ArtifactState, action: ArtifactAction): ArtifactState {
  switch (action.type) {
    case "ai_write":
      // AI 重生成：回到 draft 等待复检与人工确认。
      // 保留旧 userContent —— 重生成不覆盖人工改写。
      return {
        ...state,
        status: "draft",
        content: action.content,
        scopeHash: action.scopeHash,
        verdict: null,
        issues: [],
      };
    case "ai_check":
      // AI 自检结论；已人工通过的产物不被复检降级。
      return {
        ...state,
        status: state.status === "user_approved" ? "user_approved" : "ai_checked",
        verdict: action.verdict,
        issues: action.issues,
      };
    case "approve":
      // 只改 userContent/status/revision+1，永不覆写 content。
      return {
        ...state,
        status: "user_approved",
        userContent: action.userContent !== undefined ? action.userContent : state.userContent,
        revision: state.revision + 1,
      };
    case "reject":
      return { ...state, status: "rejected" };
    case "upstream_changed":
      if (action.newScopeHash === state.scopeHash) return state;
      // 状态回落 draft，保留旧 userContent 供差异对照。
      return { ...state, status: "draft", scopeHash: action.newScopeHash };
  }
}

/** 递归按键名排序的稳定序列化，保证字段顺序无关。 */
function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
    case "boolean":
      return JSON.stringify(value) ?? "null";
    case "undefined":
      return "undefined";
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const body = Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
        .join(",");
      return `{${body}}`;
    }
    default:
      // function / symbol / bigint 等不参与产物内容，统一塌缩。
      return "null";
  }
}

/** djb2 散列，输出 8 位十六进制；无第三方依赖。 */
function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * 计算上游输入的 scope 指纹：稳定序列化 + djb2。
 * 同一输入（与对象字段顺序无关）恒得同一 hash。
 */
export function computeScopeHash(input: unknown): string {
  return djb2(stableSerialize(input));
}
