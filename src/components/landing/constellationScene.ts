import {
  LANDING_RENDER_SCALE,
  applyOrbitDrag,
  capDrawRadius,
  constellationProjectionScale,
  isDrawableDepth,
  projectedDepth,
  stepIdleYaw,
  type Orbit,
} from "../../lib/landingOrbit";
import {
  ASSEMBLE_DURATION,
  ASSEMBLE_STAGGER,
  assembleT,
  createStarMap,
  scatterStart,
} from "../../lib/landingStarMap";

const CYAN: RGB = [89, 201, 213];
const MINT: RGB = [131, 203, 164];
const LIME: RGB = [181, 214, 132];
const TAU = Math.PI * 2;
const BG = "#0e151c";

type RGB = [number, number, number];

type Node = {
  x: number;
  y: number;
  z: number;
  hue: number;
  size: number;
  anchor: boolean;
  pulse: number;
};

type Edge = {
  a: number;
  b: number;
  px: number;
  py: number;
  pz: number;
};

type Silk = {
  e: number;
  t: number;
  v: number;
  wob: number;
  amp: number;
  hue: number;
  px: number;
  py: number;
  alive: boolean;
};

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function brand(t: number): RGB {
  const u = ((t % 1) + 1) % 1;
  return u < 0.5 ? mix(CYAN, MINT, u * 2) : mix(MINT, LIME, (u - 0.5) * 2);
}

function rgba(c: RGB, a: number) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}

function fit(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
  const scale = dpr * LANDING_RENDER_SCALE;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  canvas.width = Math.max(1, Math.floor(w * scale));
  canvas.height = Math.max(1, Math.floor(h * scale));
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (ctx) ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return { ctx, w, h };
}

function makeGlowSprite(color: RGB) {
  const size = 64;
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const g = sprite.getContext("2d");
  if (!g) return sprite;
  const mid = size / 2;
  const grd = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
  grd.addColorStop(0, "rgba(255,255,255,0.95)");
  grd.addColorStop(0.18, rgba(color, 0.72));
  grd.addColorStop(0.45, rgba(color, 0.2));
  grd.addColorStop(1, rgba(color, 0));
  g.fillStyle = grd;
  g.beginPath();
  g.arc(mid, mid, mid, 0, TAU);
  g.fill();
  return sprite;
}

function glowForHue(
  hue: number,
  cyan: HTMLCanvasElement,
  mint: HTMLCanvasElement,
  lime: HTMLCanvasElement,
) {
  const u = ((hue % 1) + 1) % 1;
  return u < 0.33 ? cyan : u < 0.66 ? mint : lime;
}

function drawGlow(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
  alpha: number,
  maxR = 18,
) {
  const r = capDrawRadius(radius, maxR);
  if (r <= 0 || alpha <= 0) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

export type ConstellationScene = {
  start: () => void;
  stop: () => void;
  resize: () => void;
  setDragging: (value: boolean) => void;
  drag: (dx: number, dy: number) => void;
  setPointer: (x: number, y: number) => void;
};

export function createConstellationScene(
  canvas: HTMLCanvasElement,
  options: { reducedMotion?: boolean } = {},
): ConstellationScene {
  const noop: ConstellationScene = {
    start() {},
    stop() {},
    resize() {},
    setDragging() {},
    drag() {},
    setPointer() {},
  };

  const reducedMotion = Boolean(options.reducedMotion);
  let view = fit(canvas);
  if (!view.ctx) return noop;
  const glowCyan = makeGlowSprite(CYAN);
  const glowMint = makeGlowSprite(MINT);
  const glowLime = makeGlowSprite(LIME);
  const g = createStarMap();
  const live = g.nodes.map((n) => {
    const start = scatterStart(n.x, n.y, n.z);
    return {
      ...n,
      tx: n.x,
      ty: n.y,
      tz: n.z,
      sx: start.x,
      sy: start.y,
      sz: start.z,
      x: start.x,
      y: start.y,
      z: start.z,
      arrive: 0,
    };
  });
  const silk: Silk[] = [];
  for (let e = 0; e < g.edges.length; e++) {
    for (let s = 0; s < 4; s++) {
      silk.push({
        e,
        t: Math.random(),
        v: rand(0.07, 0.16),
        wob: Math.random() * TAU,
        amp: rand(0.012, 0.034),
        hue: Math.random(),
        px: 0,
        py: 0,
        alive: false,
      });
    }
  }
  const dust = Array.from({ length: 260 }, () => ({
    x: rand(-1.5, 1.5),
    y: rand(-1.05, 1.05),
    z: rand(-1.5, 1.5),
    hue: Math.random(),
  }));
  const halo = Array.from({ length: 120 }, () => {
    const u = Math.random() * TAU;
    const v = Math.acos(rand(-0.92, 0.92));
    const r = rand(1.15, 1.7);
    return {
      x: r * Math.sin(v) * Math.cos(u),
      y: r * Math.cos(v) * 0.8,
      z: r * Math.sin(v) * Math.sin(u),
      hue: Math.random(),
      size: 0.4 + Math.random() * 0.5,
    };
  });
  const signals = Array.from({ length: 8 }, () => ({
    e: (Math.random() * g.edges.length) | 0,
    t: Math.random(),
    v: rand(0.16, 0.26),
  }));

  let orbit: Orbit = { yaw: 0, pitch: 0.22 };
  let autoYaw = 0;
  let dragging = false;
  let running = false;
  let frame = 0;
  let lastTs = 0;
  let originTs = 0;
  const pointer = { x: 0, y: 0, active: false };
  const sparks = Array.from({ length: 10 }, (_, i) => ({
    x: 0,
    y: 0,
    lag: 0.05 + i * 0.025,
    hue: i / 10,
    angle: (i / 10) * TAU,
  }));

  function rotProject(x: number, y: number, z: number, yaw: number, pitch: number) {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const rx = x * cy + z * sy;
    let rz = -x * sy + z * cy;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const ry = y * cp - rz * sp;
    rz = y * sp + rz * cp;
    const zc = projectedDepth(rz);
    if (!isDrawableDepth(zc)) return null;
    const sc = constellationProjectionScale(view.w, view.h) / zc;
    return { x: view.w * 0.5 + rx * sc, y: view.h * 0.5 + ry * sc, z: zc };
  }

  function along(e: Edge, t: number, wob: number, amp: number) {
    const A = live[e.a];
    const B = live[e.b];
    if (!A || !B) return { x: 0, y: 0, z: 0 };
    const s = Math.sin(t * Math.PI);
    return {
      x: A.x + (B.x - A.x) * t + e.px * Math.sin(wob) * amp * s,
      y: A.y + (B.y - A.y) * t + e.py * Math.cos(wob * 0.8) * amp * s,
      z: A.z + (B.z - A.z) * t + e.pz * Math.sin(wob * 1.3) * amp * s,
    };
  }

  function draw(ts: number) {
    if (!running || !view.ctx) return;
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    if (!originTs) originTs = ts;
    const elapsed = reducedMotion ? 99 : (ts - originTs) / 1000;
    const assembled = elapsed >= ASSEMBLE_STAGGER + ASSEMBLE_DURATION - 0.15;
    if (assembled || reducedMotion) autoYaw = stepIdleYaw(autoYaw, dt, dragging);

    for (let i = 0; i < live.length; i++) {
      const n = live[i];
      if (!n) continue;
      const t = reducedMotion ? 1 : assembleT(elapsed, i, live.length);
      n.arrive = t;
      n.x = n.sx + (n.tx - n.sx) * t;
      n.y = n.sy + (n.ty - n.sy) * t;
      n.z = n.sz + (n.tz - n.sz) * t;
    }

    const yaw = autoYaw + orbit.yaw;
    const pitch = orbit.pitch;
    const time = ts * 0.001;
    const ctx = view.ctx;
    const { w, h } = view;

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);

    const span = Math.max(w, h);
    ctx.globalCompositeOperation = "lighter";

    const np = live.map((n) => rotProject(n.x, n.y, n.z, yaw, pitch));
    const fadeIn = Math.min(1, elapsed / 0.9);

    for (const d of dust) {
      const p = rotProject(d.x, d.y, d.z, yaw * 0.55, pitch * 0.55);
      if (!p || p.x < 0 || p.x > w || p.y < 0 || p.y > h) continue;
      ctx.fillStyle = rgba(brand(d.hue), 0.3 * fadeIn);
      ctx.fillRect(p.x, p.y, 1.35, 1.35);
    }

    for (const star of halo) {
      const p = rotProject(star.x, star.y, star.z, yaw * 0.82, pitch * 0.82);
      if (!p || p.x < -16 || p.x > w + 16 || p.y < -16 || p.y > h + 16) continue;
      drawGlow(
        ctx,
        glowForHue(star.hue + time * 0.015, glowCyan, glowMint, glowLime),
        p.x,
        p.y,
        star.size * (2.4 / p.z) * 2.2,
        0.85 * fadeIn,
        12,
      );
    }

    ctx.lineCap = "round";
    ctx.lineWidth = 0.8;
    for (const e of g.edges) {
      const a = np[e.a];
      const b = np[e.b];
      const na = live[e.a];
      const nb = live[e.b];
      if (!a || !b || !na || !nb) continue;
      const formed = Math.min(na.arrive, nb.arrive);
      if (formed < 0.22) continue;
      ctx.strokeStyle = rgba(
        mix(CYAN, MINT, 0.4),
        (0.48 * formed * formed) / Math.max(0.85, (a.z + b.z) * 0.32),
      );
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (const s of silk) {
      const e = g.edges[s.e];
      const na = live[e.a];
      const nb = live[e.b];
      if (!na || !nb || Math.min(na.arrive, nb.arrive) < 0.55) continue;
      s.t += s.v * 0.016;
      s.wob += 0.035;
      if (s.t > 1) {
        s.t -= 1;
        s.alive = false;
      }
      const c3 = along(e, s.t, s.wob, s.amp);
      const p = rotProject(c3.x, c3.y, c3.z, yaw, pitch);
      if (!p) {
        s.alive = false;
        continue;
      }
      const sz = capDrawRadius(Math.max(1.15, 2.7 / p.z), 6);
      if (s.alive && !dragging) {
        const dx = p.x - s.px;
        const dy = p.y - s.py;
        if (dx * dx + dy * dy < 40) {
          ctx.strokeStyle = rgba(brand(s.hue + time * 0.03), 0.5);
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.moveTo(s.px, s.py);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
      }
      drawGlow(
        ctx,
        glowForHue(s.hue + time * 0.03, glowCyan, glowMint, glowLime),
        p.x,
        p.y,
        sz * 1.7,
        0.9,
        8,
      );

      s.px = p.x;
      s.py = p.y;
      s.alive = true;
    }

    for (const sg of signals) {
      if (!assembled) continue;
      sg.t += sg.v * 0.016;
      if (sg.t > 1) {
        sg.t = 0;
        sg.e = (Math.random() * g.edges.length) | 0;
      }
      const c3 = along(g.edges[sg.e], sg.t, time * 2, 0.008);
      const p = rotProject(c3.x, c3.y, c3.z, yaw, pitch);
      if (!p) continue;
      drawGlow(ctx, glowCyan, p.x, p.y, 1.15 * (2.3 / p.z) * 3.2, 0.85, 14);
    }

    for (let i = 0; i < live.length; i++) {
      const n = live[i];
      const p = np[i];
      if (!n) continue;
      if (!p || p.x < -24 || p.x > w + 24 || p.y < -24 || p.y > h + 24) continue;
      const pulse = 0.92 + 0.08 * Math.sin(time * 1.1 + n.pulse);
      let near = 0;
      if (pointer.active) {
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        near = Math.max(0, 1 - Math.hypot(dx, dy) / 170);
      }
      const core = n.size * (2.15 / p.z) * (n.anchor ? 1.25 : 1) * pulse * (1 + near * 0.2);
      drawGlow(
        ctx,
        glowForHue(n.hue + time * 0.02, glowCyan, glowMint, glowLime),
        p.x,
        p.y,
        core * (3.8 + near),
        1,
        n.anchor ? 24 : 20,
      );
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(240,252,255,1)";
      ctx.fillRect(p.x - 1.05, p.y - 1.05, 2.1, 2.1);
      ctx.globalAlpha = 1;
    }

    if (pointer.active) {
      ctx.globalCompositeOperation = "source-over";
      const radius = capDrawRadius(span * 0.11, 90);
      const light = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, radius);
      light.addColorStop(0, rgba(CYAN, 0.16));
      light.addColorStop(0.4, rgba(MINT, 0.07));
      light.addColorStop(1, rgba(CYAN, 0));
      ctx.fillStyle = light;
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, radius, 0, TAU);
      ctx.fill();
      for (const spark of sparks) {
        spark.angle += dt * 1.8;
        const orbitR = 12 + spark.lag * 64;
        spark.x += (pointer.x + Math.cos(spark.angle) * orbitR * 0.28 - spark.x) * spark.lag * 8;
        spark.y += (pointer.y + Math.sin(spark.angle) * orbitR * 0.28 - spark.y) * spark.lag * 8;
        ctx.fillStyle = rgba(brand(spark.hue + time * 0.05), 0.55);
        ctx.fillRect(spark.x - 1.1, spark.y - 1.1, 2.2, 2.2);
      }
    }

    frame = requestAnimationFrame(draw);
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastTs = 0;
      originTs = 0;
      frame = requestAnimationFrame(draw);
    },
    stop() {
      running = false;
      cancelAnimationFrame(frame);
    },
    resize() {
      view = fit(canvas);
    },
    setDragging(value: boolean) {
      dragging = value;
    },
    drag(dx: number, dy: number) {
      orbit = applyOrbitDrag(orbit, { dx, dy });
    },
    setPointer(x: number, y: number) {
      pointer.x = x;
      pointer.y = y;
      pointer.active = true;
    },
  };
}
