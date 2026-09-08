import { describe, expect, it } from 'vitest';
import { FittingCore } from '../../src/core/fittingCore';
import { mTransformPoint } from '../../src/core/math/mat4';
import { emptyFrame, makeRng, makeSyntheticFrame } from '../helpers/synthetic';

describe('FittingCore', () => {
  it('reaches Tracking, places the glasses on the bridge, holds and fades on loss', () => {
    const core = new FittingCore();
    core.setFrameSpec({ lens_width_mm: 52, bridge_mm: 18, temple_mm: 140, lens_height_mm: 40, frame_width_mm: 138, nose_pad: 'fixed' });
    const rng = makeRng(9);
    let out = core.process(makeSyntheticFrame({ t: [0, 0, -500] }, 0, { rng, noisePx: 0.5 }));
    expect(out.state).toBe('Degraded');
    for (let i = 1; i < 30; i++) out = core.process(makeSyntheticFrame({ t: [0, 0, -500] }, i * 33, { rng, noisePx: 0.5 }));
    expect(out.state).toBe('Tracking');
    expect(out.alpha).toBe(1);
    expect(out.glassesMatrix).not.toBeNull();
    // Glasses origin sits on the nose bridge: in front of the face origin, slightly above centre.
    const origin = mTransformPoint(out.glassesMatrix!, [0, 0, 0]);
    expect(origin[2]).toBeGreaterThan(-500 + 40);
    expect(Math.abs(origin[0])).toBeLessThan(2);
    expect(out.bridgeAnchor!.screen.x).toBeCloseTo(0.5, 1);
    expect(out.widthScale).toBeCloseTo(1, 1);
    expect(out.angles!.yaw).toBeCloseTo(0, 0);

    // Loss: pose held for 12 frames, then Lost with fading alpha, then re-acquired.
    let t = 30 * 33;
    for (let i = 0; i < 12; i++, t += 33) {
      out = core.process(emptyFrame(t));
      expect(out.state).toBe('Degraded');
      expect(out.glassesMatrix).not.toBeNull();
    }
    out = core.process(emptyFrame(t)); t += 33;
    expect(out.state).toBe('Lost');
    out = core.process(emptyFrame(t + 1000));
    expect(out.alpha).toBe(0);
    expect(out.glassesMatrix).toBeNull();
    for (let i = 0; i < 3; i++) out = core.process(makeSyntheticFrame({ t: [0, 0, -500] }, t + 2000 + i * 33, { rng }));
    expect(out.state).toBe('Tracking');
  });

  it('flags extreme yaw as Degraded and follows a sweep with the filter enabled', () => {
    const core = new FittingCore();
    let out = core.process(makeSyntheticFrame({ t: [0, 0, -500] }, 0));
    for (let i = 1; i <= 60; i++) out = core.process(makeSyntheticFrame({ t: [0, 0, -500], yawDeg: i }, i * 33));
    expect(out.state).toBe('Degraded');
    expect(out.angles!.yaw).toBeCloseTo(60, 3);
  });

  it('supports the Kabsch pose path without a matrix', () => {
    const core = new FittingCore({ placement: { useKabschPose: true } });
    const f = makeSyntheticFrame({ t: [0, 0, -500], yawDeg: 15 }, 0);
    const out = core.process({ ...f, matrix: null });
    expect(out.detected).toBe(true);
    expect(out.angles!.yaw).toBeCloseTo(15, 0);
  });

  it('applies real-size mode once the PD estimate is ready', () => {
    const core = new FittingCore({ placement: { realSizeMode: true } });
    let out = core.process(makeSyntheticFrame({ t: [0, 0, -500] }, 0));
    for (let i = 1; i < 45; i++) out = core.process(makeSyntheticFrame({ t: [0, 0, -500] }, i * 33));
    expect(out.pd.status).toBe('ready');
    expect(out.realSizeActive).toBe(true);
    expect(out.uniformScale).toBeCloseTo(1, 1);
    expect(out.widthScale).toBe(1);
  });
});
