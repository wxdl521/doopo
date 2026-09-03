export const ORBIT_YAW_SENS = 0.0055;
export const ORBIT_PITCH_SENS = 0.0042;
export const ORBIT_PITCH_MIN = -0.85;
export const ORBIT_PITCH_MAX = 0.85;
export const ORBIT_IDLE_YAW_SPEED = 0.12;
export const CONSTELLATION_SCALE_FACTOR = 0.6;
export const CAM_DIST = 2.55;
export const MIN_DRAW_Z = 0.45;
/** Backing-store scale. Upscaling adds free glow and cuts fill-rate. */
export const LANDING_RENDER_SCALE = 0.66;

/** Medium fill: bigger than the first blob, smaller than full-bleed. */
export function constellationProjectionScale(width: number, height: number) {
  return Math.max(width, height) * CONSTELLATION_SCALE_FACTOR;
}

export function projectedDepth(rz: number, camDist = CAM_DIST) {
  return rz + camDist;
}

export function isDrawableDepth(z: number, min = MIN_DRAW_Z) {
  return Number.isFinite(z) && z >= min;
}

export function capDrawRadius(radius: number, max: number) {
  if (!Number.isFinite(radius) || radius <= 0) return 0;
  return Math.min(radius, max);
}

export type Orbit = {
  yaw: number;
  pitch: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Grab-the-object orbit: pointer left → graph turns left. */
export function applyOrbitDrag(orbit: Orbit, delta: { dx: number; dy: number }): Orbit {
  return {
    yaw: orbit.yaw - delta.dx * ORBIT_YAW_SENS,
    pitch: clamp(orbit.pitch - delta.dy * ORBIT_PITCH_SENS, ORBIT_PITCH_MIN, ORBIT_PITCH_MAX),
  };
}

export function stepIdleYaw(
  yaw: number,
  dtSeconds: number,
  dragging: boolean,
  speed = ORBIT_IDLE_YAW_SPEED,
) {
  if (dragging) return yaw;
  return yaw + dtSeconds * speed;
}
