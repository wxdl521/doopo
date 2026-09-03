import { describe, expect, it } from "vitest";
import { assembleT, createStarMap, mulberry32 } from "../landingStarMap";

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

describe("createStarMap", () => {
  it("has a dense star field", () => {
    const { nodes } = createStarMap(mulberry32(3));
    expect(nodes.length).toBeGreaterThanOrEqual(160);
  });

  it("is a 3D cloud like the first constellation, not a flat spiral disk", () => {
    const { nodes } = createStarMap(mulberry32(7));
    const ys = nodes.map((n) => Math.abs(n.y));
    const xz = nodes.map((n) => Math.hypot(n.x, n.z));
    expect(median(ys)).toBeGreaterThan(median(xz) * 0.35);
  });

  it("connects nearby stars with a degree cap", () => {
    const { nodes, edges } = createStarMap(mulberry32(11));
    const deg = new Array(nodes.length).fill(0);
    let sum = 0;
    for (const edge of edges) {
      deg[edge.a]++;
      deg[edge.b]++;
      const a = nodes[edge.a];
      const b = nodes[edge.b];
      if (!a || !b) continue;
      sum += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    }
    expect(sum / edges.length).toBeLessThan(0.85);
    expect(Math.max(...deg)).toBeLessThanOrEqual(3);
  });
});

describe("assembleT", () => {
  it("keeps later particles still scattered while early ones have started flying in", () => {
    expect(assembleT(0, 0, 10)).toBe(0);
    expect(assembleT(0.25, 0, 10)).toBeGreaterThan(assembleT(0.25, 9, 10));
    expect(assembleT(8, 9, 10)).toBe(1);
  });
});
