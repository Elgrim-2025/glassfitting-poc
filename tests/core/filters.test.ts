import { describe, expect, it } from 'vitest';
import { OneEuroQuat, OneEuroScalar } from '../../src/core/filters/oneEuro';
import { PoseFilter } from '../../src/core/filters/poseFilter';
import { mCompose, mDecompose } from '../../src/core/math/mat4';
import { qAngleDeg, qFromAxisAngle } from '../../src/core/math/quat';
import { std } from '../../src/core/math/stats';
import { makeRng } from '../helpers/synthetic';

const P = { minCutoff: 1, beta: 0.02, dCutoff: 1 };

describe('OneEuroScalar', () => {
  it('passes a constant signal through unchanged', () => {
    const f = new OneEuroScalar(P);
    for (let i = 0; i < 20; i++) expect(f.filter(5, i * 33)).toBe(5);
  });
  it('reduces noise variance when still', () => {
    const rng = makeRng(3);
    const f = new OneEuroScalar(P);
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 300; i++) {
      const v = 100 + (rng() - 0.5) * 4;
      raw.push(v);
      out.push(f.filter(v, i * 33));
    }
    expect(std(out.slice(50))).toBeLessThan(std(raw.slice(50)) * 0.5);
  });
  it('follows a step faster with a larger beta', () => {
    const slow = new OneEuroScalar({ minCutoff: 1, beta: 0, dCutoff: 1 });
    const fast = new OneEuroScalar({ minCutoff: 1, beta: 1, dCutoff: 1 });
    slow.filter(0, 0); fast.filter(0, 0);
    let s = 0, q = 0;
    for (let i = 1; i <= 5; i++) { s = slow.filter(100, i * 33); q = fast.filter(100, i * 33); }
    expect(q).toBeGreaterThan(s);
    expect(q).toBeLessThanOrEqual(100);
  });
  it('strength > 1 smooths harder', () => {
    const a = new OneEuroScalar(P); const b = new OneEuroScalar(P);
    a.filter(0, 0); b.filter(0, 0);
    expect(b.filter(10, 33, 3)).toBeLessThan(a.filter(10, 33, 1));
  });
});

describe('OneEuroQuat', () => {
  it('stays normalized and handles sign-flipped quaternions', () => {
    const f = new OneEuroQuat({ minCutoff: 1, beta: 0.5, dCutoff: 1 });
    const q = qFromAxisAngle([0, 1, 0], 0.4);
    f.filter(q, 0);
    const neg: [number, number, number, number] = [-q[0], -q[1], -q[2], -q[3]];
    const out = f.filter(neg, 33);
    expect(Math.hypot(...out)).toBeCloseTo(1, 9);
    expect(qAngleDeg(out, q)).toBeLessThan(1e-6);
  });
});

describe('PoseFilter', () => {
  it('leaves the matrix untouched when disabled and converges when enabled', () => {
    const m = mCompose([10, 20, -400], qFromAxisAngle([1, 0, 0], 0.2), [1, 1, 1]);
    const off = new PoseFilter({ enabled: false, position: P, rotation: P, scale: P });
    expect(off.filter(m, 0)).toEqual(m);
    const on = new PoseFilter({ enabled: true, position: P, rotation: P, scale: P });
    let out = m;
    for (let i = 0; i < 60; i++) out = on.filter(m, i * 33);
    const d = mDecompose(out);
    d.t.forEach((v, i) => expect(v).toBeCloseTo([10, 20, -400][i], 6));
  });
});
