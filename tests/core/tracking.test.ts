import { describe, expect, it } from 'vitest';
import { anglesFromMatrix } from '../../src/core/tracking/angles';
import { TrackingStateMachine } from '../../src/core/tracking/stateMachine';
import { poseMatrixMm } from '../helpers/synthetic';

const cfg = { maxYawDeg: 45, maxPitchDeg: 30, maxRollDeg: 30, minFaceWidthPx: 60, holdFrames: 12, fadeMs: 300, reacquireFrames: 3 };

describe('anglesFromMatrix', () => {
  it('recovers yaw/pitch/roll used to build the pose', () => {
    const a = anglesFromMatrix(poseMatrixMm({ t: [0, 0, -500], yawDeg: 30, pitchDeg: -12, rollDeg: 8 }));
    expect(a.yaw).toBeCloseTo(30, 6);
    expect(a.pitch).toBeCloseTo(-12, 6);
    expect(a.roll).toBeCloseTo(8, 6);
  });
});

describe('TrackingStateMachine', () => {
  const good = (t: number, yaw = 0) => ({ timestampMs: t, detected: true, confidence: 0.9, angles: { yaw, pitch: 0, roll: 0 } });
  const miss = (t: number) => ({ timestampMs: t, detected: false, confidence: 0, angles: null });

  it('needs 3 consecutive good frames to reach Tracking, then holds 12 frames and fades over 300 ms', () => {
    const sm = new TrackingStateMachine(cfg);
    expect(sm.update(good(0)).state).toBe('Degraded');
    expect(sm.update(good(33)).state).toBe('Degraded');
    expect(sm.update(good(66)).state).toBe('Tracking');
    let t = 99;
    for (let i = 0; i < 12; i++, t += 33) {
      const o = sm.update(miss(t));
      expect(o.state).toBe('Degraded');
      expect(o.alpha).toBe(1);
      expect(o.holdPose).toBe(true);
    }
    const first = sm.update(miss(t)); t += 33;
    expect(first.state).toBe('Lost');
    expect(first.alpha).toBe(1);
    const mid = sm.update(miss(t + 117));
    expect(mid.alpha).toBeCloseTo(0.5, 6);
    const end = sm.update(miss(t + 400));
    expect(end.alpha).toBe(0);
    expect(end.holdPose).toBe(false);
  });

  it('marks extreme yaw as Degraded with stronger filtering and returns to Tracking', () => {
    const sm = new TrackingStateMachine(cfg);
    for (let i = 0; i < 3; i++) sm.update(good(i * 33));
    const o = sm.update(good(100, 60));
    expect(o.state).toBe('Degraded');
    expect(o.filterStrength).toBe(2);
    for (let i = 0; i < 3; i++) sm.update(good(200 + i * 33, 10));
    expect(sm.current).toBe('Tracking');
  });
});
