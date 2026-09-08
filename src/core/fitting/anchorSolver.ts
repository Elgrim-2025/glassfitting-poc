/** Composes the final glasses node matrix: face · T(anchor) · S(scale) · T(−assetBridge). */
import { mFromScale, mFromTranslation, mMultiply, type Mat4 } from '../math/mat4';
import type { Vec3 } from '../math/vec3';
import type { AssetAnchor } from '../types';

export interface GlassesScale {
  /** Uniform scale (real-size mode: world/true ratio). */
  uniform: number;
  /** Extra X-only scale (proportional fit). */
  width: number;
}

export function composeGlassesMatrix(faceMatrixMm: Mat4, anchorLocal: Vec3, scale: GlassesScale, asset?: AssetAnchor | null): Mat4 {
  let m = mMultiply(faceMatrixMm, mFromTranslation(anchorLocal));
  m = mMultiply(m, mFromScale([scale.uniform * scale.width, scale.uniform, scale.uniform]));
  if (asset && (asset.bridge[0] || asset.bridge[1] || asset.bridge[2])) {
    m = mMultiply(m, mFromTranslation([-asset.bridge[0], -asset.bridge[1], -asset.bridge[2]]));
  }
  return m;
}
