import { describe, expect, it } from 'vitest';
import { CameraModel } from '../../src/core/fitting/camera';
import { mpMatrixToMm } from '../../src/core/fitting/mediapipeMatrix';
import { toMetricLandmarks } from '../../src/core/fitting/metricLandmarks';
import { solveTempleSplay, MAX_SPLAY_RAD } from '../../src/core/fitting/templeSplay';
import { FittingCore } from '../../src/core/fittingCore';
import { makeSyntheticFrame } from '../helpers/synthetic';

const cam = new CameraModel(63, 1280, 720);
const hinge = { halfWidth: 69, y: 13, z: 2 };
const anchor: [number, number, number] = [0, 24.7, 59];

describe('solveTempleSplay', () => {
  it('splays the arms outward enough to clear the temple landmarks', () => {
    const frame = makeSyntheticFrame({ t: [0, 0, -500] }, 0);
    const face = mpMatrixToMm(frame.matrix!);
    const metric = toMetricLandmarks(frame.landmarks!, face, cam);
    const s = solveTempleSplay(metric, face, anchor, hinge);
    // Canonical temple half-width is 77.4 mm at z ≈ −20; hinge at x = 69, z ≈ 61 → ≈ 7.6°.
    expect(s.left).toBeGreaterThan(0.1);
    expect(s.left).toBeLessThan(0.2);
    expect(s.left).toBeCloseTo(s.right, 6);
    expect(s.left).toBeLessThanOrEqual(MAX_SPLAY_RAD);
  });
  it('needs no splay for a frame wider than the head', () => {
    const frame = makeSyntheticFrame({ t: [0, 0, -500] }, 0);
    const face = mpMatrixToMm(frame.matrix!);
    const metric = toMetricLandmarks(frame.landmarks!, face, cam);
    const s = solveTempleSplay(metric, face, anchor, { ...hinge, halfWidth: 90 });
    expect(s.left).toBe(0);
    expect(s.right).toBe(0);
  });
  it('is reported by FittingCore when a spec is set', () => {
    const core = new FittingCore();
    core.setFrameSpec({ lens_width_mm: 52, bridge_mm: 18, temple_mm: 140, lens_height_mm: 40, frame_width_mm: 138, nose_pad: 'fixed' });
    let out = core.process(makeSyntheticFrame({ t: [0, 0, -500] }, 0));
    for (let i = 1; i < 10; i++) out = core.process(makeSyntheticFrame({ t: [0, 0, -500] }, i * 33));
    expect(out.templeSplay.left).toBeGreaterThan(0.05);
  });
});
