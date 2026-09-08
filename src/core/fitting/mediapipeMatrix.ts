/** Conversion of MediaPipe's facialTransformationMatrix (cm) into the core's mm matrix. */
import { mTranspose, type Mat4 } from '../math/mat4';

export const CM_TO_MM = 10;

/**
 * @param data 16 numbers from `FaceLandmarkerResult.facialTransformationMatrixes[i].data`.
 * @param transpose Set when the runtime is found to deliver row-major data (debug toggle).
 */
export function mpMatrixToMm(data: ArrayLike<number>, transpose = false): Mat4 {
  let m: Mat4 = Array.from(data);
  if (m.length !== 16) throw new Error(`face matrix must have 16 elements, got ${m.length}`);
  if (transpose) m = mTranspose(m);
  m[12] *= CM_TO_MM;
  m[13] *= CM_TO_MM;
  m[14] *= CM_TO_MM;
  return m;
}

/** A plausible face sits 100 mm .. 2 000 mm in front of the camera (z negative). */
export function isPlausibleFaceMatrix(m: Mat4): boolean {
  const z = m[14];
  return Number.isFinite(z) && z < -100 && z > -2000;
}
