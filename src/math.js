export function wrapAngle(value) {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

export function approachAngle(current, target, blend) {
  return current + wrapAngle(target - current) * blend;
}

export function clampTarget(x, z, radius = 8) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('Invalid target');
  const scale = Math.min(1, radius / Math.max(Math.hypot(x, z), 1e-9));
  return { x: x * scale, z: z * scale };
}

export function usableFrame(frame) {
  return frame?.status === 'ready' &&
    Array.isArray(frame.body) && frame.body.length === 4 &&
    frame.body.every(Number.isFinite) &&
    Array.isArray(frame.target) && frame.target.length === 2 &&
    frame.target.every(Number.isFinite);
}
