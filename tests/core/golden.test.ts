import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generateGolden, runGolden, type GoldenVector } from '../../src/core/golden';
import { emptyFrame, makeRng, makeSyntheticFrame } from '../helpers/synthetic';
import type { FrameInput } from '../../src/core/types';

const FILE = new URL('../golden/synthetic-v1.json', import.meta.url).pathname;

/** 40 frames: still → yaw sweep → 5-frame dropout → return. Deterministic. */
export function syntheticSequence(): FrameInput[] {
  const rng = makeRng(2026);
  const frames: FrameInput[] = [];
  let t = 0;
  for (let i = 0; i < 12; i++, t += 33) frames.push(makeSyntheticFrame({ t: [5, -3, -480] }, t, { rng, noisePx: 0.6 }));
  for (let i = 0; i < 15; i++, t += 33) frames.push(makeSyntheticFrame({ t: [5 + i, -3, -480], yawDeg: i * 3, pitchDeg: -i }, t, { rng, noisePx: 0.6 }));
  for (let i = 0; i < 5; i++, t += 33) frames.push(emptyFrame(t));
  for (let i = 0; i < 8; i++, t += 33) frames.push(makeSyntheticFrame({ t: [5, -3, -480], yawDeg: 10, rollDeg: 5 }, t, { rng, noisePx: 0.6 }));
  return frames;
}

describe('golden vectors', () => {
  it('synthetic-v1 reproduces within tolerance (set UPDATE_GOLDEN=1 to regenerate)', () => {
    const spec = { lens_width_mm: 52, bridge_mm: 18, temple_mm: 140, lens_height_mm: 40, frame_width_mm: 138, nose_pad: 'fixed' as const };
    if (!existsSync(FILE) || process.env.UPDATE_GOLDEN) {
      const v = generateGolden('synthetic-v1', syntheticSequence(), {}, spec);
      writeFileSync(FILE, JSON.stringify(v));
    }
    const vector = JSON.parse(readFileSync(FILE, 'utf8')) as GoldenVector;
    const report = runGolden(vector);
    expect(report.failures).toEqual([]);
    expect(report.pass).toBe(true);
    expect(report.frames).toBe(40);
  });
  it('detects a deviating implementation', () => {
    const vector = JSON.parse(readFileSync(FILE, 'utf8')) as GoldenVector;
    const report = runGolden({ ...vector, config: { filter: { enabled: false } } });
    expect(report.pass).toBe(false);
  });
});
