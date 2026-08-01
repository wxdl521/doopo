import { describe, expect, it } from "vitest";
import {
  validateCharacterRelations,
  withCompletedReverseRelations,
  type CharacterRelationLike,
} from "./relationValidate";

const CHARACTERS = ["char-a", "char-b", "char-c"];

function edge(
  id: string,
  from: string,
  to: string,
  relation = "同事",
): CharacterRelationLike {
  return { id, from, to, relation };
}

describe("validateCharacterRelations", () => {
  it("空关系表判定为合法", () => {
    expect(validateCharacterRelations([], CHARACTERS)).toEqual([]);
  });

  it("闭合的双向关系合法", () => {
    const relations = [edge("r1", "char-a", "char-b"), edge("r2", "char-b", "char-a", "同事")];
    expect(validateCharacterRelations(relations, CHARACTERS)).toEqual([]);
  });

  it("检出缺失反向边", () => {
    const relations = [edge("r1", "char-a", "char-b", "雇主")];
    const issues = validateCharacterRelations(relations, CHARACTERS);
    expect(issues).toEqual([{ type: "missing_reverse", relationId: "r1" }]);
  });

  it("检出自指", () => {
    const relations = [edge("r1", "char-a", "char-a")];
    const issues = validateCharacterRelations(relations, CHARACTERS);
    expect(issues).toEqual([expect.objectContaining({ type: "self", relationId: "r1" })]);
  });

  it("检出悬空引用（指向不存在的角色）", () => {
    const relations = [edge("r1", "char-a", "char-ghost")];
    const issues = validateCharacterRelations(relations, CHARACTERS);
    expect(issues).toEqual([
      expect.objectContaining({ type: "dangling", relationId: "r1" }),
    ]);
  });

  it("检出重复边", () => {
    const relations = [
      edge("r1", "char-a", "char-b"),
      edge("r2", "char-b", "char-a"),
      edge("r3", "char-a", "char-b", "好友"),
    ];
    const issues = validateCharacterRelations(relations, CHARACTERS);
    expect(issues).toContainEqual(
      expect.objectContaining({ type: "duplicate", relationId: "r3", relatedRelationId: "r1" }),
    );
  });

  it("悬空/自指边不再级联报缺失反向边", () => {
    const relations = [edge("r1", "char-a", "char-ghost"), edge("r2", "char-b", "char-b")];
    const types = validateCharacterRelations(relations, CHARACTERS).map((issue) => issue.type);
    expect(types).toEqual(["dangling", "self"]);
  });
});

describe("withCompletedReverseRelations", () => {
  it("为单边补上反向边，已闭合的边不动", () => {
    const relations = [
      edge("r1", "char-a", "char-b", "雇主"),
      edge("r2", "char-c", "char-a", "朋友"),
      edge("r3", "char-a", "char-c", "朋友"),
    ];
    let seq = 0;
    const fixed = withCompletedReverseRelations(relations, CHARACTERS, () => `new-${++seq}`);
    expect(fixed).toHaveLength(4);
    const added = fixed.find((relation) => relation.id === "new-1");
    expect(added).toMatchObject({ from: "char-b", to: "char-a", relation: "雇主" });
    expect(validateCharacterRelations(fixed, CHARACTERS)).toEqual([]);
  });

  it("不为悬空或自指边补反向边", () => {
    const relations = [edge("r1", "char-a", "char-ghost"), edge("r2", "char-b", "char-b")];
    const fixed = withCompletedReverseRelations(relations, CHARACTERS, () => "new-1");
    expect(fixed).toHaveLength(2);
  });
});
