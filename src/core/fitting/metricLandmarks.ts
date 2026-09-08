/**
 * Reconstructs camera-space (mm) positions for all 478 landmarks.
 * Screen x/y come straight from the normalized landmarks (silhouette-exact); depth
 * comes from one of three sources:
 *   'matrix'   — the rigidly posed canonical model (stable; the nose is the canonical nose)
 *   'landmark' — the landmark's own relative z scaled to mm at the face depth (personal relief
 *                everywhere, noisier)
 *   'hybrid'   — canonical depth everywhere except the nose, whose relief comes from the
 *                landmark z aligned to the canonical depth at the eyes (so the vertex distance
 *                stays anchored to the eyes while the bridge/pads follow the user's own nose)
 */
import { CANONICAL_VERTICES_MM, CANONICAL_VERTEX_COUNT } from './canonical';
import { mTransformPoints, type Mat4 } from '../math/mat4';
import { EYE_L_RING, EYE_R_RING, LM, TOTAL_LANDMARK_COUNT } from '../landmarks';
import type { CameraModel } from './camera';
import type { Landmark } from '../types';

export type DepthSource = 'matrix' | 'landmark' | 'hybrid';

/** Landmarks whose canonical depth anchors the landmark relief in hybrid mode (eye lids and corners). */
export const HYBRID_REFERENCE: readonly number[] = [159, 145, 386, 374, LM.EYE_L_INNER, LM.EYE_R_INNER, LM.EYE_L_OUTER, LM.EYE_R_OUTER];

/** Gaussian skirt (mm) outside the nose box in which the hybrid weight fades to 0. */
export const NOSE_DEPTH_SKIRT_MM = 6;

const gap = (v: number, lo: number, hi: number): number => (v < lo ? lo - v : v > hi ? v - hi : 0);

/**
 * Per-vertex blend weight of the landmark depth in hybrid mode: 1 inside the nose box
 * (|x| ≤ 18, y ∈ [−22, 36], z ≥ 48 in canonical mm), Gaussian skirt outside it.
 */
export const NOSE_DEPTH_WEIGHTS: Float32Array = (() => {
  const w = new Float32Array(CANONICAL_VERTEX_COUNT);
  const s2 = 2 * NOSE_DEPTH_SKIRT_MM * NOSE_DEPTH_SKIRT_MM;
  for (let i = 0; i < CANONICAL_VERTEX_COUNT; i++) {
    const x = CANONICAL_VERTICES_MM[i * 3], y = CANONICAL_VERTICES_MM[i * 3 + 1], z = CANONICAL_VERTICES_MM[i * 3 + 2];
    const dx = gap(Math.abs(x), 0, 18), dy = gap(y, -22, 36), dz = gap(z, 48, Infinity);
    const d2 = dx * dx + dy * dy + dz * dz;
    const v = Math.exp(-d2 / s2);
    w[i] = v < 1e-3 ? 0 : v;
  }
  return w;
})();

export function toMetricLandmarks(
  landmarks: readonly Landmark[],
  faceMatrixMm: Mat4,
  cam: CameraModel,
  depthSource: DepthSource = 'matrix',
  out?: Float32Array,
): Float32Array {
  const n = Math.min(landmarks.length, TOTAL_LANDMARK_COUNT);
  const res = out && out.length >= n * 3 ? out : new Float32Array(TOTAL_LANDMARK_COUNT * 3);
  const posed = mTransformPoints(faceMatrixMm, CANONICAL_VERTICES_MM);
  const faceDepth = -faceMatrixMm[14];
  const widthMm = cam.widthAtDepth(faceDepth);
  // z is in image-width units; smaller = closer to the camera (= larger camera z).
  const landmarkDepth = (i: number): number => faceMatrixMm[14] - landmarks[i].z * widthMm;

  let hybridOffset = 0;
  if (depthSource === 'hybrid') {
    let s = 0;
    for (const i of HYBRID_REFERENCE) s += posed[i * 3 + 2] - landmarkDepth(i);
    hybridOffset = s / HYBRID_REFERENCE.length;
  }

  const depthOf = (i: number): number => {
    if (depthSource === 'landmark') return landmarkDepth(i);
    if (i < CANONICAL_VERTEX_COUNT) {
      const zc = posed[i * 3 + 2];
      if (depthSource === 'hybrid') {
        const w = NOSE_DEPTH_WEIGHTS[i];
        return w > 0 ? zc + w * (landmarkDepth(i) + hybridOffset - zc) : zc;
      }
      return zc;
    }
    const ring = i < LM.IRIS_R_CENTER ? EYE_L_RING : EYE_R_RING;
    let s = 0;
    for (const j of ring) s += posed[j * 3 + 2];
    return s / ring.length;
  };

  for (let i = 0; i < n; i++) {
    const lm = landmarks[i];
    const p = cam.unprojectNormalized(lm.x, lm.y, depthOf(i));
    res[i * 3] = p[0];
    res[i * 3 + 1] = p[1];
    res[i * 3 + 2] = p[2];
  }
  return res;
}
