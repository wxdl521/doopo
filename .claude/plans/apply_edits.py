# -*- coding: utf-8 -*-
import sys

path = r"src/routes/workspace.$workspaceId.tsx"
with open(path, encoding="utf-8") as f:
    content = f.read()
lines = content.split("\n")

def find(needle, start=0):
    for i in range(start, len(lines)):
        if needle in lines[i]:
            return i
    raise AssertionError(f"NOT FOUND: {needle!r}")

# --- R1: remove storyboard builder's inline shotDescriptions block ---
s = find("// 收集 shot 描述当作叙事提示")
e = find('.join(" → ");', s)
assert lines[e + 1].strip() == "", f"expected blank after join, got {lines[e+1]!r}"
del lines[s:e + 2]  # block + trailing blank line

# --- R3: remove shots builder's inline shotDescriptions block ---
s = find("// 拼整组镜头序列的 prompt")
e = find('.join(" → ");', s)
assert "// 注入项目视觉风格" in lines[e + 1], f"expected 注入项目视觉风格, got {lines[e+1]!r}"
del lines[s:e + 1]

# --- R2: storyboard parts -> single SHOT BREAKDOWN entry using effectiveShotBreakdown ---
s = find("[NARRATIVE REFERENCE")
assert "group.plotText" in lines[s + 1], lines[s + 1]
assert lines[s + 2].strip() == "{", lines[s + 2]
assert "shotDescriptions" in lines[s + 3], lines[s + 3]
assert "SHOT BREAKDOWN" in lines[s + 4], lines[s + 4]
assert lines[s + 5].strip() == ': "",', lines[s + 5]
assert lines[s + 6].strip() == "},", lines[s + 6]
new_r2 = [
    "      {",
    "        text: `[SHOT BREAKDOWN – for additional sequence hints]\\n${effectiveShotBreakdown(group)}`,",
    "      },",
]
lines[s:s + 7] = new_r2

# --- R4: shots parts -> single Shot breakdown entry using effectiveShotBreakdown ---
s = find("[Storyboard sequence:")
assert "shotDescriptions" in lines[s + 1], lines[s + 1]
lines[s:s + 2] = ['      { text: `Shot breakdown: ${effectiveShotBreakdown(group)}` },']

# --- R12: replace commitGroupPlot function (doc comment + body) ---
fs = find("function commitGroupPlot(")
cs = fs - 1
while cs >= 0 and not lines[cs].strip().startswith("/**"):
    cs -= 1
assert cs >= 0, "doc comment not found"
fe = find("setEditingGroupId((cur) => (cur === groupId ? null : cur));", fs)
assert lines[fe + 1].strip() == "}", lines[fe + 1]
new_r12 = [
    "  /**",
    "   * 2026/07:把分镜描述(groupBreakdownDraft)写回 g.shotBreakdownText。draft 与当前生效值",
    "   * 相同则 bail out。不在 useEffect 里跑(避免编辑过程中被覆盖)。",
    "   */",
    "  function commitGroupBreakdown(groupId: string) {",
    "    const draft = groupBreakdownDraft[groupId];",
    "    if (draft === undefined) {",
    "      setEditingGroupId(null);",
    "      return;",
    "    }",
    "    setData((prev) => {",
    "      if (!prev) return prev;",
    "      return {",
    "        ...prev,",
    "        storyboardGroups: prev.storyboardGroups.map((g) =>",
    "          g.id === groupId && effectiveShotBreakdown(g) !== draft",
    "            ? { ...g, shotBreakdownText: draft }",
    "            : g,",
    "        ),",
    "      };",
    "    });",
    "    setEditingGroupId((cur) => (cur === groupId ? null : cur));",
    "  }",
]
lines[cs:fe + 2] = new_r12

# --- R11: rename state declaration + update comment ---
si = find("const [groupPlotDraft, setGroupPlotDraft]")
lines[si] = lines[si].replace("groupPlotDraft", "groupBreakdownDraft").replace(
    "setGroupPlotDraft", "setGroupBreakdownDraft")
ci = find("分镜组 plotText 行内编辑")
lines[ci] = lines[ci].replace(
    "2026/06:分镜组 plotText 行内编辑",
    "2026/07:分镜组「分镜描述」行内编辑(镜头分解 + 台词/剧情")

# --- R13: reset call ---
ri = find("setGroupPlotDraft({});")
lines[ri] = lines[ri].replace("setGroupPlotDraft({});", "setGroupBreakdownDraft({});")

content = "\n".join(lines)

def rep(old, new, count=1):
    global content
    n = content.count(old)
    assert n == count, f"rep expected {count} of {old!r}, found {n}"
    content = content.replace(old, new)

# --- R14: commitGroupPlot call sites (2) ---
rep("commitGroupPlot(", "commitGroupBreakdown(", 2)
# --- remaining draft-state usages ---
rep("groupPlotDraft", "groupBreakdownDraft", 1)      # textarea value
rep("setGroupPlotDraft", "setGroupBreakdownDraft", 2)  # seed + onChange (decl & reset already done)

# --- UI: label comment + label text + edit title ---
rep("剧情 · Plot label", "分镜描述 label", 1)
rep("剧情 · Plot", "分镜描述", 1)
rep('title="编辑剧情"', 'title="编辑分镜描述"', 1)

# --- UI: container height 280 -> 420 (the panel whose header comment has look-switcher) ---
lines = content.split("\n")
done = False
for i, ln in enumerate(lines):
    if "max-h-[280px]" in ln and i > 0 and "look-switcher" in lines[i - 1]:
        lines[i] = ln.replace("max-h-[280px]", "max-h-[420px]")
        done = True
        break
assert done, "container 280px near look-switcher not found"
content = "\n".join(lines)

# --- UI: textarea value / seed / className / pre content ---
rep("groupBreakdownDraft[g.id] ?? g.plotText", "groupBreakdownDraft[g.id] ?? effectiveShotBreakdown(g)", 1)
rep("[g.id]: g.plotText }))", "[g.id]: effectiveShotBreakdown(g) }))", 1)
rep("bg-bg-elevated/40 min-h-[80px] resize-y", "bg-bg-elevated/40 min-h-[180px] resize-y", 1)
rep("{g.plotText}", "{effectiveShotBreakdown(g)}", 1)

# --- final verification ---
for bad in ["groupPlotDraft", "setGroupPlotDraft", "commitGroupPlot", "shotDescriptions"]:
    assert bad not in content, f"LEFTOVER TOKEN: {bad}"
assert content.count("effectiveShotBreakdown") >= 5, content.count("effectiveShotBreakdown")
assert content.count("shotBreakdownText") >= 2

with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("OK — effectiveShotBreakdown:", content.count("effectiveShotBreakdown"),
      "shotBreakdownText:", content.count("shotBreakdownText"))
