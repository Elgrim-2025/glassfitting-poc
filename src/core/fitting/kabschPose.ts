/**
 * Default pose path (spec §3.2 "대안 경로", promoted to default): fit the canonical model to the
 * reconstructed metric landmarks with Horn's method. Returns a unit-scale pose
 * matrix plus the fitted scale and residual.
 */
import { CANONICAL_VERTEX_COUNT, CANONICAL_VERTICES_MM } from './canonical';
import { KABSCH_WEIGHTS } from '../landmarks';
import { absoluteOrientation } from '../math/kabsch';
import { mCompose, type Mat4 } from '../math/mat4';

export interface KabschPose {
  matrix: Mat4;
  scale: number;
  rms: number;
}

export function estimatePoseKabsch(metricPts: Float32Array, weights: ArrayLike<number> = KABSCH_WEIGHTS): KabschPose {
  const dst = metricPts.subarray(0, CANONICAL_VERTEX_COUNT * 3);
  const r = absoluteOrientation(CANONICAL_VERTICES_MM, dst, weights, true);
  return { matrix: mCompose(r.t, r.q, [1, 1, 1]), scale: r.s, rms: r.rms };
}
