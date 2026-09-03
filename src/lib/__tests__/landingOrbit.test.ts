import { describe, expect, it } from "vitest";
import {
  LANDING_RENDER_SCALE,
  applyOrbitDrag,
  capDrawRadius,
  constellationProjectionScale,
  isDrawableDepth,
  projectedDepth,
  stepIdleYaw,
} from "../landingOrbit";

describe("applyOrbitDrag", () => {
  it("drags left so the graph turns left (same direction as the pointer)", () => {
    const next = applyOrbitDrag({ yaw: 0, pitch: 0.18 }, { dx: -20, dy: 0 });
    expect(next.yaw).toBeGreaterThan(0);
    expect(next.pitch).toBeCloseTo(0.18);
  });

  it("drags right so the graph turns right", () => {
    const next = applyOrbitDrag({ yaw: 0, pitch: 0.18 }, { dx: 20, dy: 0 });
    expect(next.yaw).toBeLessThan(0);
  });

  it("clamps pitch so the camera cannot flip over", () => {
    const next = applyOrbitDrag({ yaw: 0, pitch: 0.8 }, { dx: 0, dy: -400 });
    expect(next.pitch).toBeLessThanOrEqual(0.85);
    expect(next.pitch).toBeGreaterThanOrEqual(-0.85);
  });
});

describe("constellationProjectionScale", () => {
  it("is larger than the original min-side scale, but not full-bleed huge", () => {
    const wide = constellationProjectionScale(1920, 1080);
    const original = Math.min(1920, 1080) * 0.92;
    const previousHuge = Math.max(1920, 1080) * 0.88;
    expect(wide).toBeGreaterThan(original);
    expect(wide).toBeLessThan(previousHuge);
  });
});

describe("LANDING_RENDER_SCALE", () => {
  it("renders below native resolution so glow can be upscaled instead of painting huge gradients", () => {
    expect(LANDING_RENDER_SCALE).toBeGreaterThan(0.45);
    expect(LANDING_RENDER_SCALE).toBeLessThan(0.7);
  });
});

describe("capDrawRadius", () => {
  it("clamps near-camera blowups so intro particles cannot paint huge gradients", () => {
    expect(capDrawRadius(120, 8)).toBe(8);
    expect(capDrawRadius(3, 8)).toBe(3);
    expect(capDrawRadius(Number.POSITIVE_INFINITY, 8)).toBe(0);
  });
});

describe("projectedDepth", () => {
  it("keeps points behind the camera from being drawn (avoids NaN poisoning the canvas)", () => {
    expect(isDrawableDepth(projectedDepth(-2.6))).toBe(false);
    expect(isDrawableDepth(projectedDepth(0))).toBe(true);
    expect(isDrawableDepth(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isDrawableDepth(Number.NaN)).toBe(false);
  });
});

describe("stepIdleYaw", () => {
  it("advances slowly while idle", () => {
    expect(stepIdleYaw(0, 1, false)).toBeGreaterThan(0);
  });

  it("pauses while dragging", () => {
    expect(stepIdleYaw(1.2, 1, true)).toBe(1.2);
  });
});
