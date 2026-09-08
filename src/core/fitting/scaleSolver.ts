/**
 * User width-scale correction. The MediaPipe world is normalised to the canonical
 * face size, so this ratio captures the user's face *shape* (width relative to
 * overall size), which is what proportional fitting needs.
 */
import { CANONICAL_VERTICES_MM } from './canonical';
import { LM } from '../landmarks';
import { mInvert, mTransformPoint, type Mat4 } from '../math/mat4';
import { pointAt } from '../math/vec3';

const canonicalDx = (a: number, b: number): number => Math.abs(CANONICAL_VERTICES_MM[a * 3] - CANONICAL_VERTICES_MM[b * 3]);
const CANON_TEMPLE_W = canonicalDx(LM.TEMPLE_L, LM.TEMPLE_R);
const CANON_EYE_W = canonicalDx(LM.EYE_L_OUTER, LM.EYE_R_OUTER);

export interface WidthScaleResult {
  /** Combined ratio (temple 0.6, eyes 0.4), clamped. */
  ratio: number;
  templeRatio: number;
  eyeRatio: number;
  /** User temple width in face-local mm. */
  templeWidthMm: number;
}

/**
 * @param metricPts 478×3 camera-space points (mm).
 * @param faceMatrixMm Face pose used to bring the points into the face-local frame.
 */
export function solveWidthScale(metricPts: Float32Array, faceMatrixMm: Mat4, min = 0.8, max = 1.25): WidthScaleResult {
  const inv = mInvert(faceMatrixMm);
  const lx = (i: number) => mTransformPoint(inv, pointAt(metricPts, i))[0];
  const templeW = Math.abs(lx(LM.TEMPLE_L) - lx(LM.TEMPLE_R));
  const eyeW = Math.abs(lx(LM.EYE_L_OUTER) - lx(LM.EYE_R_OUTER));
  const templeRatio = templeW / CANON_TEMPLE_W;
  const eyeRatio = eyeW / CANON_EYE_W;
  const ratio = Math.min(max, Math.max(min, 0.6 * templeRatio + 0.4 * eyeRatio));
  return { ratio, templeRatio, eyeRatio, templeWidthMm: templeW };
}

export const CANONICAL_TEMPLE_WIDTH_MM = CANON_TEMPLE_W;
