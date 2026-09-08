import { describe, expect, it } from 'vitest';
import { CANONICAL_TRIANGLES, CANONICAL_VERTICES_MM } from '../../src/core/fitting/canonical';
import { CameraModel } from '../../src/core/fitting/camera';
import { mpMatrixToMm, isPlausibleFaceMatrix } from '../../src/core/fitting/mediapipeMatrix';
import { toMetricLandmarks } from '../../src/core/fitting/metricLandmarks';
import { mTransformPoints } from '../../src/core/math/mat4';
import { LM } from '../../src/core/landmarks';
import { makeSyntheticFrame, poseMatrixMm } from '../helpers/synthetic';

describe('canonical face model', () => {
  it('has 468 vertices and 898 triangles with valid indices', () => {
    expect(CANONICAL_VERTICES_MM.length).toBe(468 * 3);
    expect(CANONICAL_TRIANGLES.length).toBe(898 * 3);
    for (const i of CANONICAL_TRIANGLES) expect(i).toBeLessThan(468);
  });
  it('is oriented +Y up and +Z toward the camera, in mm', () => {
    const z = (i: number) => CANONICAL_VERTICES_MM[i * 3 + 2];
    const y = (i: number) => CANONICAL_VERTICES_MM[i * 3 + 1];
    expect(z(LM.NOSE_TIP)).toBeGreaterThan(z(LM.TEMPLE_L));
    expect(y(LM.FACE_TOP)).toBeGreaterThan(y(LM.FACE_BOTTOM));
    const templeWidth = Math.abs(CANONICAL_VERTICES_MM[LM.TEMPLE_L * 3] - CANONICAL_VERTICES_MM[LM.TEMPLE_R * 3]);
    expect(templeWidth).toBeGreaterThan(120);
    expect(templeWidth).toBeLessThan(160);
  });
});

describe('camera model', () => {
  const cam = new CameraModel(63, 1280, 720);
  it('project/unproject round-trip', () => {
    const p: [number, number, number] = [30, -20, -450];
    const n = cam.project(p);
    const back = cam.unprojectNormalized(n.x, n.y, -450);
    back.forEach((v, i) => expect(v).toBeCloseTo(p[i], 6));
  });
  it('centre of the image maps to the optical axis', () => {
    expect(cam.project([0, 0, -500])).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('mediapipe matrix conversion', () => {
  it('scales translation from cm to mm and keeps rotation', () => {
    const cm = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1.5, -2, -45, 1];
    const mm = mpMatrixToMm(cm);
    expect(mm[12]).toBe(15);
    expect(mm[14]).toBe(-450);
    expect(mm[0]).toBe(1);
    expect(isPlausibleFaceMatrix(mm)).toBe(true);
    expect(isPlausibleFaceMatrix(mpMatrixToMm([1,0,0,0,0,1,0,0,0,0,1,0,0,0,5,1]))).toBe(false);
  });
});

describe('metric landmark reconstruction', () => {
  it('recovers posed canonical points from projected landmarks (matrix depth)', () => {
    const pose = { t: [20, -10, -480] as [number, number, number], yawDeg: 25, pitchDeg: -10, rollDeg: 5 };
    const frame = makeSyntheticFrame(pose, 0);
    const faceMm = mpMatrixToMm(frame.matrix!);
    const cam = new CameraModel(63, frame.imageWidth, frame.imageHeight);
    const metric = toMetricLandmarks(frame.landmarks!, faceMm, cam, 'matrix');
    const expected = mTransformPoints(poseMatrixMm(pose), CANONICAL_VERTICES_MM);
    let maxErr = 0;
    for (let i = 0; i < 468 * 3; i++) maxErr = Math.max(maxErr, Math.abs(metric[i] - expected[i]));
    expect(maxErr).toBeLessThan(1e-3);
    expect(metric.length).toBe(478 * 3);
  });
  it('landmark-depth mode reproduces depth within a few mm', () => {
    const pose = { t: [0, 0, -500] as [number, number, number], yawDeg: 15 };
    const frame = makeSyntheticFrame(pose, 0);
    const faceMm = mpMatrixToMm(frame.matrix!);
    const cam = new CameraModel(63, frame.imageWidth, frame.imageHeight);
    const metric = toMetricLandmarks(frame.landmarks!, faceMm, cam, 'landmark');
    const expected = mTransformPoints(poseMatrixMm(pose), CANONICAL_VERTICES_MM);
    expect(Math.abs(metric[LM.NOSE_TIP * 3 + 2] - expected[LM.NOSE_TIP * 3 + 2])).toBeLessThan(0.5);
  });
});
