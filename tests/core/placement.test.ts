import { describe, expect, it } from 'vitest';
import { CameraModel } from '../../src/core/fitting/camera';
import { CANONICAL_VERTICES_MM } from '../../src/core/fitting/canonical';
import { mpMatrixToMm } from '../../src/core/fitting/mediapipeMatrix';
import { toMetricLandmarks } from '../../src/core/fitting/metricLandmarks';
import { solveWidthScale } from '../../src/core/fitting/scaleSolver';
import { solveNoseLanding } from '../../src/core/fitting/noseLanding';
import { composeGlassesMatrix } from '../../src/core/fitting/anchorSolver';
import { estimatePoseKabsch } from '../../src/core/fitting/kabschPose';
import { DEFAULT_CONFIG } from '../../src/core/config';
import { mTransformPoint } from '../../src/core/math/mat4';
import { qAngleDeg } from '../../src/core/math/quat';
import { mDecompose } from '../../src/core/math/mat4';
import { LM } from '../../src/core/landmarks';
import { makeSyntheticFrame, poseMatrixMm } from '../helpers/synthetic';
import type { FrameSpec } from '../../src/core/types';

const cam = new CameraModel(63, 1280, 720);
const spec: FrameSpec = { lens_width_mm: 52, bridge_mm: 18, temple_mm: 140, lens_height_mm: 40, frame_width_mm: 138, nose_pad: 'fixed' };
const setup = (widthScale = 1, yawDeg = 0) => {
  const frame = makeSyntheticFrame({ t: [10, -5, -480], yawDeg, widthScale }, 0);
  const face = mpMatrixToMm(frame.matrix!);
  const metric = toMetricLandmarks(frame.landmarks!, face, cam);
  return { frame, face, metric };
};

describe('solveWidthScale', () => {
  it('recovers a 1.1× wider face as ratio ≈ 1.1 (frontal exact, rotated within 2 %)', () => {
    const frontal = setup(1.1, 0);
    const r = solveWidthScale(frontal.metric, frontal.face);
    expect(r.templeRatio).toBeCloseTo(1.1, 3);
    expect(r.eyeRatio).toBeCloseTo(1.1, 3);
    expect(r.ratio).toBeCloseTo(1.1, 3);
    const rotated = setup(1.1, 20);
    expect(Math.abs(solveWidthScale(rotated.metric, rotated.face).ratio - 1.1)).toBeLessThan(0.02);
  });
  it('clamps to the configured range', () => {
    const { face, metric } = setup(1.6);
    expect(solveWidthScale(metric, face, 0.8, 1.25).ratio).toBe(1.25);
  });
});

describe('solveNoseLanding', () => {
  const yOf = (i: number) => CANONICAL_VERTICES_MM[i * 3 + 1];
  const zOf = (i: number) => CANONICAL_VERTICES_MM[i * 3 + 2];
  it('fixed pads with an 18 mm bridge land on landmark 6 with 1 mm clearance', () => {
    const { face, metric } = setup();
    const r = solveNoseLanding(metric, face, spec, DEFAULT_CONFIG.placement);
    expect(r.landingY).toBeCloseTo(yOf(LM.BRIDGE), 3);
    expect(r.anchor[2]).toBeCloseTo(zOf(LM.BRIDGE) + 1, 3);
  });
  it('adjustable pads and a wider bridge land lower and on the ridge surface', () => {
    const { face, metric } = setup();
    const r = solveNoseLanding(metric, face, { ...spec, bridge_mm: 20, nose_pad: 'adjustable' }, DEFAULT_CONFIG.placement);
    expect(r.landingY).toBeCloseTo(yOf(LM.BRIDGE) - 3 - 1.6, 3);
    expect(r.landingY).toBeGreaterThan(yOf(197));
    // Interpolated depth lies between the neighbouring ridge points.
    const lo = Math.min(zOf(LM.BRIDGE), zOf(197)), hi = Math.max(zOf(LM.BRIDGE), zOf(197));
    expect(r.ridgeZ).toBeGreaterThanOrEqual(lo - 1e-3);
    expect(r.ridgeZ).toBeLessThanOrEqual(hi + 1e-3);
  });
});

describe('composeGlassesMatrix', () => {
  it('places the glasses origin at the anchor in camera space and scales X only', () => {
    const face = poseMatrixMm({ t: [0, 0, -500], yawDeg: 30 });
    const m = composeGlassesMatrix(face, [0, 5, 60], { uniform: 1, width: 1.1 });
    const origin = mTransformPoint(m, [0, 0, 0]);
    const expected = mTransformPoint(face, [0, 5, 60]);
    origin.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6));
    const d = mDecompose(m);
    expect(d.s[0]).toBeCloseTo(1.1, 6);
    expect(d.s[1]).toBeCloseTo(1, 6);
  });
  it('compensates a non-zero asset bridge offset', () => {
    const face = poseMatrixMm({ t: [0, 0, -500] });
    const asset = { bridge: [0, 2, -3] as [number, number, number], temple_left: [-69, 0, 0] as [number, number, number], temple_right: [69, 0, 0] as [number, number, number], nose_pad_offset: [0, 0, 0] as [number, number, number] };
    const m = composeGlassesMatrix(face, [0, 0, 60], { uniform: 1, width: 1 }, asset);
    const bridgeWorld = mTransformPoint(m, [0, 2, -3]);
    mTransformPoint(face, [0, 0, 60]).forEach((v, i) => expect(bridgeWorld[i]).toBeCloseTo(v, 6));
  });
});

describe('estimatePoseKabsch', () => {
  it('recovers the pose from noisy landmark-depth metric points', () => {
    const pose = { t: [15, -10, -520] as [number, number, number], yawDeg: 25, pitchDeg: 8, rollDeg: -5 };
    const frame = makeSyntheticFrame(pose, 0, { noisePx: 0.7 });
    const face = mpMatrixToMm(frame.matrix!);
    const metric = toMetricLandmarks(frame.landmarks!, face, cam, 'landmark');
    const k = estimatePoseKabsch(metric);
    const a = mDecompose(k.matrix), b = mDecompose(poseMatrixMm(pose));
    expect(qAngleDeg(a.q, b.q)).toBeLessThan(1);
    a.t.forEach((v, i) => expect(Math.abs(v - b.t[i])).toBeLessThan(3));
    expect(Math.abs(k.scale - 1)).toBeLessThan(0.02);
  });
});
