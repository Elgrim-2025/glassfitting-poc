import { describe, expect, it } from 'vitest';
import { mCompose, mDecompose, mInvert, mMultiply, mIdentity, mTransformPoint, mTranspose, mGet } from '../../src/core/math/mat4';
import { qFromAxisAngle, qMultiply, qSlerp, qAngleDeg, qNormalize, qRotate } from '../../src/core/math/quat';
import { crossCorrelationLag, iqrFilter, median, std, RingBuffer } from '../../src/core/math/stats';

const close = (a: number[], b: number[], eps = 1e-6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], Math.round(-Math.log10(eps))));

describe('mat4', () => {
  it('compose/decompose round-trips translation, rotation and scale', () => {
    const q = qFromAxisAngle([0, 1, 0], 0.7);
    const m = mCompose([1, 2, 3], q, [1.2, 1, 1]);
    const d = mDecompose(m);
    close(d.t, [1, 2, 3]);
    close(d.s, [1.2, 1, 1]);
    expect(qAngleDeg(d.q, q)).toBeLessThan(1e-4);
  });
  it('multiply and invert give identity', () => {
    const m = mCompose([5, -3, 2], qFromAxisAngle([1, 0, 0], 0.3), [1, 1, 1]);
    close(mMultiply(m, mInvert(m)), mIdentity(), 1e-9);
  });
  it('column-major element access: translation is at indices 12..14', () => {
    const m = mCompose([7, 8, 9], [0, 0, 0, 1], [1, 1, 1]);
    expect(mGet(m, 0, 3)).toBe(7);
    expect(mGet(m, 2, 3)).toBe(9);
    const t = mTranspose(m);
    expect(t[3]).toBe(7);
  });
  it('transforms points', () => {
    const m = mCompose([10, 0, 0], qFromAxisAngle([0, 0, 1], Math.PI / 2), [1, 1, 1]);
    close(mTransformPoint(m, [1, 0, 0]), [10, 1, 0]);
  });
});

describe('quat', () => {
  it('slerp takes the shortest path and stays normalized', () => {
    const a = qFromAxisAngle([0, 1, 0], 0.1);
    const b = qFromAxisAngle([0, 1, 0], 0.5);
    const negB: [number, number, number, number] = [-b[0], -b[1], -b[2], -b[3]];
    const mid = qSlerp(a, negB, 0.5);
    expect(qAngleDeg(mid, qFromAxisAngle([0, 1, 0], 0.3))).toBeLessThan(1e-4);
    expect(Math.hypot(...mid)).toBeCloseTo(1, 9);
  });
  it('multiply composes rotations', () => {
    const a = qFromAxisAngle([0, 0, 1], Math.PI / 2);
    const ab = qMultiply(a, a);
    close(qRotate(qNormalize(ab), [1, 0, 0]), [-1, 0, 0]);
  });
});

describe('stats', () => {
  it('median / iqr / std', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(iqrFilter([1, 2, 3, 4, 5, 100])).toEqual([1, 2, 3, 4, 5]);
    expect(std([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 9);
  });
  it('cross-correlation lag recovers a 3-sample delay', () => {
    const raw = Array.from({ length: 60 }, (_, i) => Math.sin(i * 0.3) + 0.1 * Math.cos(i * 1.7));
    const filtered = raw.map((_, i) => (i >= 3 ? raw[i - 3] : raw[0]));
    expect(crossCorrelationLag(raw, filtered, 10)).toBe(3);
  });
  it('ring buffer keeps the newest values in order', () => {
    const r = new RingBuffer(3);
    [1, 2, 3, 4].forEach((v) => r.push(v));
    expect(r.toArray()).toEqual([2, 3, 4]);
  });
});
