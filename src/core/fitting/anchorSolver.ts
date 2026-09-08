/**
 * Composes the final glasses node matrix:
 *   face · T(anchor) · Rx(tilt) · S(scale) · T(−assetBridge)
 * The pantoscopic tilt is a rotation about +X through the bridge origin; a positive
 * angle tips the lens top toward +Z (the camera) and the temple tips upward.
 */
import { mFromScale, mFromTranslation, mMultiply, type Mat4 } from '../math/mat4';
import type { Vec3 } from '../math/vec3';
import type { AssetAnchor } from '../types';

export interface GlassesScale {
  /** Uniform scale (real-size mode: world/true ratio). */
  uniform: number;
  /** Extra X-only scale (proportional fit). */
  width: number;
}

/** Rotation about +X by `rad` (column-major): y' = y·cos − z·sin, z' = y·sin + z·cos. */
export const mFromRotationX = (rad: number): Mat4 => {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
};

export function composeGlassesMatrix(
  faceMatrixMm: Mat4,
  anchorLocal: Vec3,
  scale: GlassesScale,
  asset?: AssetAnchor | null,
  tiltDeg = 0,
): Mat4 {
  let m = mMultiply(faceMatrixMm, mFromTranslation(anchorLocal));
  if (tiltDeg) m = mMultiply(m, mFromRotationX((tiltDeg * Math.PI) / 180));
  m = mMultiply(m, mFromScale([scale.uniform * scale.width, scale.uniform, scale.uniform]));
  if (asset && (asset.bridge[0] || asset.bridge[1] || asset.bridge[2])) {
    m = mMultiply(m, mFromTranslation([-asset.bridge[0], -asset.bridge[1], -asset.bridge[2]]));
  }
  return m;
}
