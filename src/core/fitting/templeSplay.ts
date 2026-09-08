/**
 * Temple splay: rotates each temple arm outward about its hinge so the arm clears
 * the user's head at the temple (127/356) and ear-front (234/454) landmarks.
 * Angles are in radians, positive = outward.
 */
import { LM } from '../landmarks';
import { mInvert, mTransformPoint, type Mat4 } from '../math/mat4';
import { pointAt, type Vec3 } from '../math/vec3';

export interface HingeGeometry {
  /** Hinge half-width (mm) from the frame origin, i.e. frame_width / 2. */
  halfWidth: number;
  /** Hinge height and depth in GLB coordinates (mm). */
  y: number;
  z: number;
}

export interface TempleSplay {
  left: number;
  right: number;
}

export const MAX_SPLAY_RAD = (15 * Math.PI) / 180;

const LEFT_POINTS = [LM.TEMPLE_L, LM.EAR_L] as const;
const RIGHT_POINTS = [LM.TEMPLE_R, LM.EAR_R] as const;

export function solveTempleSplay(
  metricPts: Float32Array,
  faceMatrixMm: Mat4,
  anchorLocal: Vec3,
  hinge: HingeGeometry,
  clearanceMm = 3,
): TempleSplay {
  const inv = mInvert(faceMatrixMm);
  const hingeZ = anchorLocal[2] + hinge.z;
  const solve = (indices: readonly number[], sign: -1 | 1): number => {
    const hingeX = anchorLocal[0] + sign * hinge.halfWidth;
    let tan = 0;
    for (const i of indices) {
      const p = mTransformPoint(inv, pointAt(metricPts, i));
      const depth = hingeZ - p[2];
      if (depth <= 1) continue;
      // Required outward offset at this depth (positive when the head is wider than the hinge).
      const needed = sign * (p[0] - hingeX) + clearanceMm;
      tan = Math.max(tan, needed / depth);
    }
    return Math.min(MAX_SPLAY_RAD, Math.atan(tan));
  };
  return { left: solve(LEFT_POINTS, -1), right: solve(RIGHT_POINTS, 1) };
}
