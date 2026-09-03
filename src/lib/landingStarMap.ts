const TAU = Math.PI * 2;

export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type StarNode = {
  x: number;
  y: number;
  z: number;
  hue: number;
  size: number;
  anchor: boolean;
  pulse: number;
};

export type StarEdge = {
  a: number;
  b: number;
  px: number;
  py: number;
  pz: number;
};

function wobbleAxis(a: StarNode, b: StarNode) {
  const ax = b.y * a.z - b.z * a.y;
  const ay = b.z * a.x - b.x * a.z;
  const az = b.x * a.y - b.y * a.x;
  const al = Math.hypot(ax, ay, az) || 1;
  return { px: ax / al, py: ay / al, pz: az / al };
}

function link(nodes: StarNode[], edges: StarEdge[], a: number, b: number) {
  if (a === b || a < 0 || b < 0 || a >= nodes.length || b >= nodes.length) return;
  const from = nodes[a];
  const to = nodes[b];
  if (!from || !to) return;
  edges.push({ a, b, ...wobbleAxis(from, to) });
}

export const ASSEMBLE_STAGGER = 0.85;
export const ASSEMBLE_DURATION = 1.85;

export function easeOutCubic(t: number) {
  const u = Math.min(1, Math.max(0, t));
  return 1 - (1 - u) ** 3;
}

export function assembleT(elapsed: number, index: number, count: number) {
  const delay = (index / Math.max(1, count - 1)) * ASSEMBLE_STAGGER;
  return easeOutCubic((elapsed - delay) / ASSEMBLE_DURATION);
}

export function scatterStart(x: number, y: number, z: number, rng: () => number = Math.random) {
  const u = rng() * TAU;
  const v = Math.acos(rng() * 2 - 1);
  const dist = 1.55 + rng() * 1.15;
  return {
    x: x + Math.sin(v) * Math.cos(u) * dist,
    y: y + Math.cos(v) * dist,
    z: z + Math.sin(v) * Math.sin(u) * dist,
  };
}

/** First-version 3D cloud with nearby links (degree-capped). */
export function createStarMap(rng: () => number = Math.random) {
  const nodes: StarNode[] = [];
  const nodeCount = 140;
  const fieldCount = 50;
  const anchors = 10;
  const maxDist = 0.62;
  const maxDeg = 3;

  for (let i = 0; i < nodeCount; i++) {
    const u = rng() * TAU;
    const v = Math.acos(rng() * 1.84 - 0.92);
    const r = Math.pow(rng(), 0.55) * 1.08;
    nodes.push({
      x: r * Math.sin(v) * Math.cos(u),
      y: r * Math.cos(v) * 0.82,
      z: r * Math.sin(v) * Math.sin(u),
      hue: rng(),
      size: 0.95 + rng() * 0.75,
      anchor: false,
      pulse: rng() * TAU,
    });
  }
  for (let i = 0; i < anchors; i++) {
    const n = nodes[i];
    if (!n) continue;
    n.anchor = true;
    n.size = 1.45 + rng() * 0.35;
    n.hue = i / anchors;
  }

  const deg = new Array(nodes.length).fill(0);
  const edges: StarEdge[] = [];
  const pairs: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (!a || !b) continue;
      pairs.push({
        i,
        j,
        d: Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
      });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  for (const p of pairs) {
    if (p.d > maxDist) break;
    if ((deg[p.i] ?? 0) >= maxDeg || (deg[p.j] ?? 0) >= maxDeg) continue;
    deg[p.i]++;
    deg[p.j]++;
    link(nodes, edges, p.i, p.j);
  }

  for (let i = 0; i < fieldCount; i++) {
    const u = rng() * TAU;
    const v = Math.acos(rng() * 1.84 - 0.92);
    const r = Math.pow(rng(), 0.4) * 1.15;
    nodes.push({
      x: r * Math.sin(v) * Math.cos(u),
      y: r * Math.cos(v) * 0.82,
      z: r * Math.sin(v) * Math.sin(u),
      hue: rng(),
      size: 0.45 + rng() * 0.4,
      anchor: false,
      pulse: rng() * TAU,
    });
  }

  return { nodes, edges };
}
