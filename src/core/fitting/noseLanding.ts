/**
 * Bridge landing: where on the nose ridge the frame's bridge (origin) sits.
 * Height: base point 6 (nose bridge) shifted by the nose-pad preset and by the
 * bridge width (wider bridges slide lower). Depth: interpolated from the user's
 * own ridge profile (168 → 6 → 197 → 195 → 5) so the bridge neither floats nor
 * penetrates the nose.
 */
import { LM } from '../landmarks';
import { mInvert, mTransformPoint, type Mat4 } from '../math/mat4';
import { pointAt, type Vec3 } from '../math/vec3';
import type { FittingConfig, FrameSpec } from '../types';

export const RIDGE_PROFILE = [LM.BRIDGE_TOP, LM.BRIDGE, 197, 195, 5] as const;
/** Reference bridge width (mm) at which no extra drop is applied. */
export const REFERENCE_BRIDGE_MM = 18;
/** Vertical drop per mm of bridge width beyond the reference. */
export const DROP_PER_BRIDGE_MM = 0.8;

export interface NoseLanding {
  /** Anchor position in the face-local frame (mm). */
  anchor: Vec3;
  landingY: number;
  ridgeZ: number;
}

/**
 * @param metricPts 478×3 camera-space points (mm).
 * @param faceMatrixMm Pose used to move the points into the face-local frame.
 */
export function solveNoseLanding(
  metricPts: Float32Array,
  faceMatrixMm: Mat4,
  spec: FrameSpec | null,
  cfg: FittingConfig['placement'],
): NoseLanding {
  const inv = mInvert(faceMatrixMm);
  const profile = RIDGE_PROFILE.map((i) => mTransformPoint(inv, pointAt(metricPts, i)));
  // Profile runs top → bottom (decreasing y).
  const yTop = profile[0][1];
  const yBottom = profile[profile.length - 1][1];
  const base = profile[1][1];
  const drop = spec ? cfg.nosePadDropMm[spec.nose_pad] - DROP_PER_BRIDGE_MM * Math.max(0, spec.bridge_mm - REFERENCE_BRIDGE_MM) : 0;
  const landingY = Math.min(yTop, Math.max(yBottom, base + drop));

  // Interpolate x/z along the profile at landingY.
  let x = profile[1][0];
  let z = profile[1][2];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i], b = profile[i + 1];
    const hi = Math.max(a[1], b[1]), lo = Math.min(a[1], b[1]);
    if (landingY <= hi && landingY >= lo) {
      const t = hi === lo ? 0 : (a[1] - landingY) / (a[1] - b[1]);
      x = a[0] + (b[0] - a[0]) * t;
      z = a[2] + (b[2] - a[2]) * t;
      break;
    }
  }
  return { anchor: [x, landingY, z + cfg.bridgeClearanceMm], landingY, ridgeZ: z };
}
