/** Quaternion as [x, y, z, w]. */
import type { Mat4 } from './mat4';

export type Quat = [number, number, number, number];

export const qIdentity = (): Quat => [0, 0, 0, 1];
export const qDot = (a: Quat, b: Quat): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
export const qLength = (a: Quat): number => Math.sqrt(qDot(a, a));
export const qNormalize = (a: Quat): Quat => {
  const l = qLength(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l, a[3] / l] : qIdentity();
};
export const qConjugate = (a: Quat): Quat => [-a[0], -a[1], -a[2], a[3]];

/** Hamilton product a*b (apply b first, then a). */
export const qMultiply = (a: Quat, b: Quat): Quat => {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
};

/** Rotation quaternion from axis (unit) and angle (radians). */
export const qFromAxisAngle = (axis: [number, number, number], rad: number): Quat => {
  const h = rad / 2;
  const s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
};

/** Angle between two rotations in degrees (0..180). */
export const qAngleDeg = (a: Quat, b: Quat): number => {
  const d = Math.min(1, Math.abs(qDot(qNormalize(a), qNormalize(b))));
  return (2 * Math.acos(d) * 180) / Math.PI;
};

/** Spherical interpolation along the shortest arc. */
export const qSlerp = (a: Quat, b: Quat, t: number): Quat => {
  let cos = qDot(a, b);
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  if (cos < 0) {
    cos = -cos;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  if (cos > 0.9995) {
    return qNormalize([
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ]);
  }
  const theta = Math.acos(cos);
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
};

/** Quaternion from a pure rotation matrix stored column-major in a Mat4 (scale must be removed). */
export const qFromRotationMat4 = (m: Mat4): Quat => {
  const m00 = m[0], m10 = m[1], m20 = m[2];
  const m01 = m[4], m11 = m[5], m21 = m[6];
  const m02 = m[8], m12 = m[9], m22 = m[10];
  const trace = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  return qNormalize([x, y, z, w]);
};

/** Rotates a point by the quaternion. */
export const qRotate = (q: Quat, p: [number, number, number]): [number, number, number] => {
  const [x, y, z, w] = q;
  const [px, py, pz] = p;
  // t = 2 * cross(q.xyz, p)
  const tx = 2 * (y * pz - z * py);
  const ty = 2 * (z * px - x * pz);
  const tz = 2 * (x * py - y * px);
  return [
    px + w * tx + (y * tz - z * ty),
    py + w * ty + (z * tx - x * tz),
    pz + w * tz + (x * ty - y * tx),
  ];
};
