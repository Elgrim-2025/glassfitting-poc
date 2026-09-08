import { describe, expect, it } from 'vitest';
import { JitterMeter } from '../../src/core/metrics/jitter';
import { LatencyMeter } from '../../src/core/metrics/latency';
import { FpsMeter } from '../../src/core/metrics/fps';
import { TrackingStats } from '../../src/core/metrics/trackingStats';
import { makeRng } from '../helpers/synthetic';

describe('JitterMeter', () => {
  it('reports px std at 720p scale and rotation std', () => {
    const j = new JitterMeter(90);
    const rng = makeRng(2);
    for (let i = 0; i < 90; i++) {
      j.update({ x: 0.5 + ((rng() - 0.5) * 2) / 1440, y: 0.5 }, 1440, 1080, { yaw: (rng() - 0.5) * 0.2, pitch: 0, roll: 0 });
    }
    const r = j.read();
    expect(r.samples).toBe(90);
    expect(r.positionPx).toBeGreaterThan(0.1);
    expect(r.positionPx).toBeLessThan(0.6);
    expect(r.rotationDeg).toBeLessThan(0.1);
  });
});

describe('LatencyMeter', () => {
  it('measures a 2-frame lag as ~66 ms at 30 fps', () => {
    const l = new LatencyMeter(120, 10);
    const raw: number[] = [];
    for (let i = 0; i < 100; i++) {
      raw.push(Math.sin(i * 0.2) * 20);
      l.update(raw[i], i >= 2 ? raw[i - 2] : raw[0], i * 33.33);
    }
    const r = l.read();
    expect(r.lagFrames).toBe(2);
    expect(r.lagMs).toBeCloseTo(66.7, 0);
  });
});

describe('FpsMeter / TrackingStats', () => {
  it('computes fps and pipeline latency', () => {
    const f = new FpsMeter();
    for (let i = 0; i < 31; i++) f.tick(i * 33.333, i * 33.333 - 40, 12);
    const r = f.read();
    expect(r.fps).toBeCloseTo(30, 0);
    expect(r.pipelineMs).toBeCloseTo(40, 6);
    expect(r.detectMs).toBe(12);
  });
  it('tracks retention ratio and re-acquisition time', () => {
    const s = new TrackingStats();
    s.update('Tracking', 0); s.update('Tracking', 33); s.update('Lost', 66); s.update('Degraded', 500); s.update('Tracking', 600);
    const r = s.read();
    expect(r.frames).toBe(5);
    expect(r.trackingRatio).toBeCloseTo(0.6, 9);
    expect(r.lastReacquireMs).toBe(100);
  });
});
