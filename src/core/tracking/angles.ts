/**
 * Euler angles of a face matrix. The canonical face looks along +Z (toward the camera).
 * Convention: R = Ry(yaw) · Rx(pitch) · Rz(roll), angles in degrees.
 */
import type { Mat4 } from '../math/mat4';
import type { Angles } from '../types';

const r2d = 180 / Math.PI;

export function anglesFromMatrix(m: Mat4): Angles {
  // Remove scale from the columns used.
  const sx = Math.hypot(m[0], m[1], m[2]) || 1;
  const sy = Math.hypot(m[4], m[5], m[6]) || 1;
  const sz = Math.hypot(m[8], m[9], m[10]) || 1;
  const r02 = m[8] / sz, r12 = m[9] / sz, r22 = m[10] / sz;
  const r10 = m[1] / sx, r11 = m[5] / sy;
  const pitch = Math.asin(Math.max(-1, Math.min(1, -r12)));
  const yaw = Math.atan2(r02, r22);
  const roll = Math.atan2(r10, r11);
  return { yaw: yaw * r2d, pitch: pitch * r2d, roll: roll * r2d };
}

export const withinRange = (a: Angles, maxYaw: number, maxPitch: number, maxRoll: number): boolean =>
  Math.abs(a.yaw) <= maxYaw && Math.abs(a.pitch) <= maxPitch && Math.abs(a.roll) <= maxRoll;
