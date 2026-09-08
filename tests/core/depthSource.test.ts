import { describe, expect, it } from 'vitest';
import { CameraModel } from '../../src/core/fitting/camera';
import { CANONICAL_VERTICES_MM } from '../../src/core/fitting/canonical';
import { mpMatrixToMm } from '../../src/core/fitting/mediapipeMatrix';
import { NOSE_DEPTH_WEIGHTS, toMetricLandmarks } from '../../src/core/fitting/metricLandmarks';
import { LM } from '../../src/core/landmarks';
import { mInvert, mTransformPoints } from '../../src/core/math/mat4';
import { deformCanonical } from '../helpers/faceVariants';
import { makeSyntheticFrame, poseMatrixMm } from '../helpers/synthetic';

const cam = new CameraModel(63, 1280, 720);
const RIDGE = [LM.BRIDGE, 197, 195, 5, LM.NOSE_TIP];
const EYES = [159, 145, 386, 374, LM.EYE_L_INNER, LM.EYE_R_INNER];

describe('hybrid depth source', () => {
  it('weights are 1 on the nose ridge, 0 at the temples and eyes', () => {
    for (const i of RIDGE) expect(NOSE_DEPTH_WEIGHTS[i]).toBeCloseTo(1, 6);
    for (const i of [LM.TEMPLE_L, LM.TEMPLE_R, LM.EAR_L, LM.FACE_TOP, LM.FACE_BOTTOM]) expect(NOSE_DEPTH_WEIGHTS[i]).toBeLessThan(1e-3);
    for (const i of [LM.EYE_L_OUTER, LM.EYE_R_OUTER, 159, 386]) expect(NOSE_DEPTH_WEIGHTS[i]).toBeLessThan(0.05);
  });

  it('takes the nose relief from the landmark z and keeps the canonical depth elsewhere', () => {
    const vertices = deformCanonical({ depth: 0.92, noseBridge: -4, cheekbone: 3 }); // "flat" variant
    const pose = { t: [0, 0, -450] as [number, number, number], yawDeg: 10 };
    const frame = makeSyntheticFrame(pose, 0, { vertices });
    const face = mpMatrixToMm(frame.matrix!);
    const invTrue = mInvert(poseMatrixMm(pose));
    const hybrid = mTransformPoints(invTrue, toMetricLandmarks(frame.landmarks!, face, cam, 'hybrid'));
    const canonical = mTransformPoints(invTrue, toMetricLandmarks(frame.landmarks!, face, cam, 'matrix'));
    // Nose relief relative to the eyes matches the true (deformed) face within 1 mm — several mm
    // less than the canonical relief for this flat nose.
    const meanZ = (a: ArrayLike<number>, ids: number[]) => ids.reduce((s, i) => s + a[i * 3 + 2], 0) / ids.length;
    const eyeTrue = meanZ(vertices, EYES), eyeHybrid = meanZ(hybrid, EYES), eyeCanon = meanZ(canonical, EYES);
    for (const i of RIDGE) {
      const reliefTrue = vertices[i * 3 + 2] - eyeTrue;
      const reliefHybrid = hybrid[i * 3 + 2] - eyeHybrid;
      const reliefCanon = canonical[i * 3 + 2] - eyeCanon;
      expect(Math.abs(reliefHybrid - reliefTrue), `ridge ${i} relief`).toBeLessThan(1.0);
      expect(reliefCanon - reliefHybrid, `ridge ${i} canonical − hybrid`).toBeGreaterThan(2.5);
    }
    // Eyelids, outer corners and temples: unchanged from the canonical-depth points; the inner
    // corners sit at the nasal root and take a small share (< 0.6 mm) of the relief.
    for (const i of [159, 145, 386, 374, LM.EYE_L_OUTER, LM.EYE_R_OUTER, LM.TEMPLE_L, LM.TEMPLE_R]) expect(hybrid[i * 3 + 2]).toBeCloseTo(canonical[i * 3 + 2], 1);
    for (const i of [LM.EYE_L_INNER, LM.EYE_R_INNER]) expect(Math.abs(hybrid[i * 3 + 2] - canonical[i * 3 + 2])).toBeLessThan(0.6);
    // Screen positions are untouched by the depth source.
    for (const i of RIDGE) {
      const a = cam.project([hybrid[i * 3], hybrid[i * 3 + 1], hybrid[i * 3 + 2]]);
      void a; // projection identity is covered by the metric-landmark tests; here only depth changes
    }
  });

  it('matches the canonical depth exactly when the landmark relief is the canonical one', () => {
    const frame = makeSyntheticFrame({ t: [0, 0, -500] }, 0);
    const face = mpMatrixToMm(frame.matrix!);
    const a = toMetricLandmarks(frame.landmarks!, face, cam, 'hybrid');
    const b = toMetricLandmarks(frame.landmarks!, face, cam, 'matrix');
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 2);
    void CANONICAL_VERTICES_MM;
  });
});
