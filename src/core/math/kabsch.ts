/**
 * Weighted absolute orientation (Horn 1987, closed-form quaternion solution) with an
 * optional uniform scale: finds s, R, t minimising Σ w_i |s·R·src_i + t − dst_i|².
 * Used as the fallback pose estimator (landmarks ↔ canonical model).
 */
import { jacobiEigenSymmetric } from './eigen';
import { mCompose, type Mat4 } from './mat4';
import { qNormalize, type Quat } from './quat';
import type { Vec3 } from './vec3';

export interface AbsoluteOrientation {
  q: Quat;
  t: Vec3;
  s: number;
  matrix: Mat4;
  /** Weighted RMS residual (same units as the input). */
  rms: number;
}

export function absoluteOrientation(
  src: ArrayLike<number>,
  dst: ArrayLike<number>,
  weights?: ArrayLike<number>,
  estimateScale = true,
): AbsoluteOrientation {
  const n = Math.min(src.length, dst.length) / 3;
  let wSum = 0;
  const cs: Vec3 = [0, 0, 0];
  const cd: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1;
    wSum += w;
    for (let k = 0; k < 3; k++) {
      cs[k] += w * src[i * 3 + k];
      cd[k] += w * dst[i * 3 + k];
    }
  }
  for (let k = 0; k < 3; k++) {
    cs[k] /= wSum;
    cd[k] /= wSum;
  }
  let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
  let normS = 0, normD = 0;
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1;
    const sx = src[i * 3] - cs[0], sy = src[i * 3 + 1] - cs[1], sz = src[i * 3 + 2] - cs[2];
    const dx = dst[i * 3] - cd[0], dy = dst[i * 3 + 1] - cd[1], dz = dst[i * 3 + 2] - cd[2];
    Sxx += w * sx * dx; Sxy += w * sx * dy; Sxz += w * sx * dz;
    Syx += w * sy * dx; Syy += w * sy * dy; Syz += w * sy * dz;
    Szx += w * sz * dx; Szy += w * sz * dy; Szz += w * sz * dz;
    normS += w * (sx * sx + sy * sy + sz * sz);
    normD += w * (dx * dx + dy * dy + dz * dz);
  }
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const { values, vectors } = jacobiEigenSymmetric(N);
  let best = 0;
  for (let i = 1; i < 4; i++) if (values[i] > values[best]) best = i;
  const e = vectors[best]; // (w, x, y, z)
  const q = qNormalize([e[1], e[2], e[3], e[0]]);
  const s = estimateScale && normS > 0 ? Math.sqrt(normD / normS) : 1;
  const rot = mCompose([0, 0, 0], q, [s, s, s]);
  const rcs: Vec3 = [
    rot[0] * cs[0] + rot[4] * cs[1] + rot[8] * cs[2],
    rot[1] * cs[0] + rot[5] * cs[1] + rot[9] * cs[2],
    rot[2] * cs[0] + rot[6] * cs[1] + rot[10] * cs[2],
  ];
  const t: Vec3 = [cd[0] - rcs[0], cd[1] - rcs[1], cd[2] - rcs[2]];
  const matrix = mCompose(t, q, [s, s, s]);
  let res = 0;
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1;
    const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
    const px = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] - dst[i * 3];
    const py = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] - dst[i * 3 + 1];
    const pz = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] - dst[i * 3 + 2];
    res += w * (px * px + py * py + pz * pz);
  }
  return { q, t, s, matrix, rms: Math.sqrt(res / wSum) };
}
