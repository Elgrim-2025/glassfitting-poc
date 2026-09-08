/**
 * Synthetic face frames for tests and golden vectors: poses the canonical model (or a
 * deformed copy of it), projects it through the camera model and emits
 * MediaPipe-shaped FrameInput.
 *
 * With `vertices` (a deformed face) the emitted matrix is not the true pose but the
 * rigid Kabsch fit of the canonical model onto the posed vertices — what MediaPipe
 * reports for a real face — so the depth mismatch of the real pipeline (screen-exact
 * xy, canonical depth) is reproduced.
 */
import { CANONICAL_VERTEX_COUNT, CANONICAL_VERTICES_MM } from '../../src/core/fitting/canonical';
import { CameraModel } from '../../src/core/fitting/camera';
import { absoluteOrientation } from '../../src/core/math/kabsch';
import { mCompose, mTransformPoints, type Mat4 } from '../../src/core/math/mat4';
import { qFromAxisAngle, qMultiply, type Quat } from '../../src/core/math/quat';
import { KABSCH_WEIGHTS, LM } from '../../src/core/landmarks';
import type { FrameInput, Landmark } from '../../src/core/types';

export interface SyntheticPose {
  /** Face origin in camera space (mm). */
  t: [number, number, number];
  yawDeg?: number;
  pitchDeg?: number;
  rollDeg?: number;
  /** Extra X scale applied to the canonical face (user width ratio). */
  widthScale?: number;
}

export interface SyntheticOptions {
  cam?: CameraModel;
  /** Uniform Gaussian pixel noise added to landmarks. */
  noisePx?: number;
  irisDiameterMm?: number;
  pdMm?: number;
  blink?: number;
  rng?: () => number;
  /**
   * Face-local vertices (468 × 3, mm) replacing the canonical model. The frame's matrix
   * becomes the weighted rigid Kabsch fit (scale 1) of the canonical model onto the posed
   * vertices, as a tracker would estimate it.
   */
  vertices?: Float32Array;
}

const d2r = Math.PI / 180;

export function poseQuat(p: SyntheticPose): Quat {
  const qy = qFromAxisAngle([0, 1, 0], (p.yawDeg ?? 0) * d2r);
  const qx = qFromAxisAngle([1, 0, 0], (p.pitchDeg ?? 0) * d2r);
  const qz = qFromAxisAngle([0, 0, 1], (p.rollDeg ?? 0) * d2r);
  return qMultiply(qy, qMultiply(qx, qz));
}

/** True face matrix in mm for a pose (rotation + translation, unit scale). */
export function poseMatrixMm(p: SyntheticPose): Mat4 {
  return mCompose(p.t, poseQuat(p), [1, 1, 1]);
}

/** Rigid (scale 1) weighted Kabsch fit of the canonical model onto posed camera-space points. */
export function fitCanonicalPose(posedMm: ArrayLike<number>): Mat4 {
  return absoluteOrientation(CANONICAL_VERTICES_MM, posedMm, KABSCH_WEIGHTS, false).matrix;
}

/** Deterministic LCG uniform sampler. */
export function makeRng(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const gauss = (rng: () => number) => {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

export function makeSyntheticFrame(pose: SyntheticPose, timestampMs: number, opts: SyntheticOptions = {}): FrameInput {
  const cam = opts.cam ?? new CameraModel(63, 1280, 720);
  const rng = opts.rng ?? makeRng(7);
  const noisePx = opts.noisePx ?? 0;
  const irisMm = opts.irisDiameterMm ?? 11.7;
  const pdMm = opts.pdMm ?? 63;
  const ws = pose.widthScale ?? 1;

  const truePose = poseMatrixMm(pose);
  const local = new Float32Array(opts.vertices ?? CANONICAL_VERTICES_MM);
  for (let i = 0; i < CANONICAL_VERTEX_COUNT; i++) local[i * 3] *= ws;
  const posed = mTransformPoints(truePose, local);
  // Deformed faces report the tracker-style fitted matrix; the canonical face reports its true pose.
  const faceMm = opts.vertices ? fitCanonicalPose(posed) : truePose;
  const faceDepth = -faceMm[14];
  const widthMm = cam.widthAtDepth(faceDepth);

  const landmarks: Landmark[] = [];
  const push = (x: number, y: number, z: number) => {
    const n = cam.project([x, y, z]);
    const nx = noisePx ? (gauss(rng) * noisePx) / cam.imageWidth : 0;
    const ny = noisePx ? (gauss(rng) * noisePx) / cam.imageHeight : 0;
    landmarks.push({ x: n.x + nx, y: n.y + ny, z: (faceMm[14] - z) / widthMm });
  };
  for (let i = 0; i < CANONICAL_VERTEX_COUNT; i++) push(posed[i * 3], posed[i * 3 + 1], posed[i * 3 + 2]);

  // Irises: on the eye plane (local frame) at ±PD/2, with the requested diameter, then posed.
  const eyeCenterLocal = (outer: number, inner: number, sign: number): [number, number, number] => {
    const oy = local[outer * 3 + 1], oz = local[outer * 3 + 2];
    const iy = local[inner * 3 + 1], iz = local[inner * 3 + 2];
    return [sign * (pdMm / 2), (oy + iy) / 2, Math.max(oz, iz) + 1];
  };
  const eyes: [number, number, number][] = [
    eyeCenterLocal(LM.EYE_L_OUTER, LM.EYE_L_INNER, -1),
    eyeCenterLocal(LM.EYE_R_INNER, LM.EYE_R_OUTER, 1),
  ];
  const r = irisMm / 2;
  for (const c of eyes) {
    const pts: [number, number, number][] = [
      c,
      [c[0] + r, c[1], c[2]],
      [c[0], c[1] + r, c[2]],
      [c[0] - r, c[1], c[2]],
      [c[0], c[1] - r, c[2]],
    ];
    const p = mTransformPoints(truePose, new Float32Array(pts.flat()));
    for (let i = 0; i < 5; i++) push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  }

  const matrixCm = faceMm.slice();
  matrixCm[12] /= 10; matrixCm[13] /= 10; matrixCm[14] /= 10;

  const blink = opts.blink ?? 0.05;
  return {
    timestampMs,
    imageWidth: cam.imageWidth,
    imageHeight: cam.imageHeight,
    landmarks,
    matrix: matrixCm,
    blendshapes: {
      eyeBlinkLeft: blink, eyeBlinkRight: blink,
      eyeLookInLeft: 0.1, eyeLookOutLeft: 0.1, eyeLookUpLeft: 0.1, eyeLookDownLeft: 0.1,
      eyeLookInRight: 0.1, eyeLookOutRight: 0.1, eyeLookUpRight: 0.1, eyeLookDownRight: 0.1,
    },
  };
}

export const emptyFrame = (timestampMs: number, w = 1280, h = 720): FrameInput => ({
  timestampMs, imageWidth: w, imageHeight: h, landmarks: null, matrix: null, blendshapes: null,
});
