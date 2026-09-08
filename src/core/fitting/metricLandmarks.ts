/**
 * Reconstructs camera-space (mm) positions for all 478 landmarks.
 * Screen x/y come straight from the normalized landmarks (silhouette-exact);
 * depth comes from the rigidly posed canonical model (default) or from the
 * landmark's own relative z scaled to mm at the face depth.
 */
import { CANONICAL_VERTICES_MM, CANONICAL_VERTEX_COUNT } from './canonical';
import { mTransformPoints, type Mat4 } from '../math/mat4';
import { EYE_L_RING, EYE_R_RING, LM, TOTAL_LANDMARK_COUNT } from '../landmarks';
import type { CameraModel } from './camera';
import type { Landmark } from '../types';

export type DepthSource = 'matrix' | 'landmark';

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

  const depthOf = (i: number): number => {
    if (depthSource === 'landmark') {
      // z is in image-width units; smaller = closer to the camera (= larger camera z).
      return faceMatrixMm[14] - landmarks[i].z * widthMm;
    }
    if (i < CANONICAL_VERTEX_COUNT) return posed[i * 3 + 2];
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
