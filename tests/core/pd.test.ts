import { describe, expect, it } from 'vitest';
import { CameraModel } from '../../src/core/fitting/camera';
import { DEFAULT_CONFIG } from '../../src/core/config';
import { measurePdFrame, PdEstimator } from '../../src/core/pd/pdEstimator';
import { makeSyntheticFrame, makeRng } from '../helpers/synthetic';

const cam = new CameraModel(63, 1280, 720);
const frontal = { yaw: 0, pitch: 0, roll: 0 };

describe('measurePdFrame', () => {
  it('recovers PD, monocular PD and distance from a frontal synthetic face', () => {
    const f = makeSyntheticFrame({ t: [0, 0, -500] }, 0, { pdMm: 63, irisDiameterMm: 11.7 });
    const m = measurePdFrame(f.landmarks!, cam, 11.7);
    expect(m.pdNearMm).toBeCloseTo(63, 2);
    expect(m.monoLMm + m.monoRMm).toBeCloseTo(63, 1);
    expect(m.irisPx).toBeGreaterThan(12);
    // Distance to the eye plane: eyes sit in front of the face origin (z ≈ −500 + eye z).
    expect(m.distanceMm).toBeGreaterThan(420);
    expect(m.distanceMm).toBeLessThan(500);
  });
  it('is invariant to face-camera distance', () => {
    const near = measurePdFrame(makeSyntheticFrame({ t: [0, 0, -350] }, 0).landmarks!, cam, 11.7);
    const far = measurePdFrame(makeSyntheticFrame({ t: [0, 0, -650] }, 0).landmarks!, cam, 11.7);
    expect(Math.abs(near.pdNearMm - far.pdNearMm)).toBeLessThan(0.05);
  });
});

describe('PdEstimator', () => {
  it('rejects blinking, yawed and off-centre frames with a reason', () => {
    const est = new PdEstimator(DEFAULT_CONFIG.pd);
    expect(est.update(makeSyntheticFrame({ t: [0, 0, -500] }, 0, { blink: 0.6 }), frontal, cam).last_reject).toBe('blink');
    expect(est.update(makeSyntheticFrame({ t: [0, 0, -500], yawDeg: 12 }, 33), { yaw: 12, pitch: 0, roll: 0 }, cam).last_reject).toBe('yaw');
    expect(est.update(makeSyntheticFrame({ t: [250, 0, -500] }, 66), frontal, cam).last_reject).toBe('off-center');
    expect(est.update(makeSyntheticFrame({ t: [0, 0, -1500] }, 99), frontal, cam).last_reject).toBe('too-far');
    expect(est.current.sample_count).toBe(0);
    expect(est.current.status).toBe('collecting');
  });
  it('becomes ready after minSamples with a stable median and a larger distance PD', () => {
    const est = new PdEstimator(DEFAULT_CONFIG.pd);
    const rng = makeRng(5);
    let e = est.current;
    for (let i = 0; i < 40; i++) {
      e = est.update(makeSyntheticFrame({ t: [0, 0, -500] }, i * 33, { pdMm: 63, noisePx: 0.8, rng }), frontal, cam);
    }
    expect(e.status).toBe('ready');
    expect(e.sample_count).toBe(40);
    expect(Math.abs(e.pd_near - 63)).toBeLessThan(0.5);
    expect(e.pd_far).toBeGreaterThan(e.pd_near);
    expect(e.pd_far - e.pd_near).toBeLessThan(3);
    expect(e.ci_mm).toBeLessThan(1.5);
    expect(e.confidence).toBeGreaterThan(0.5);
    est.reset();
    expect(est.current.status).toBe('idle');
  });
});
