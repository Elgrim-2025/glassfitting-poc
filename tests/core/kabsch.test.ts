import { describe, expect, it } from 'vitest';
import { absoluteOrientation } from '../../src/core/math/kabsch';
import { jacobiEigenSymmetric } from '../../src/core/math/eigen';
import { CANONICAL_VERTICES_MM } from '../../src/core/fitting/canonical';
import { mCompose, mTransformPoints } from '../../src/core/math/mat4';
import { qAngleDeg, qFromAxisAngle, qMultiply } from '../../src/core/math/quat';
import { KABSCH_WEIGHTS } from '../../src/core/landmarks';
import { makeRng } from '../helpers/synthetic';

describe('jacobiEigenSymmetric', () => {
  it('finds eigenvalues of a diagonalizable symmetric matrix', () => {
    const { values, vectors } = jacobiEigenSymmetric([[2, 1], [1, 2]]);
    const sorted = values.slice().sort((a, b) => a - b);
    expect(sorted[0]).toBeCloseTo(1, 9);
    expect(sorted[1]).toBeCloseTo(3, 9);
    const i = values.indexOf(Math.max(...values));
    expect(Math.abs(vectors[i][0])).toBeCloseTo(Math.abs(vectors[i][1]), 9);
  });
});

describe('absoluteOrientation', () => {
  it('recovers rotation, translation and scale from noisy weighted points', () => {
    const q = qMultiply(qFromAxisAngle([0, 1, 0], 0.5), qFromAxisAngle([1, 0, 0], -0.2));
    const t: [number, number, number] = [12, -8, -450];
    const s = 1.08;
    const m = mCompose(t, q, [s, s, s]);
    const dst = mTransformPoints(m, CANONICAL_VERTICES_MM);
    const rng = makeRng(11);
    for (let i = 0; i < dst.length; i++) dst[i] += (rng() - 0.5) * 1.0;
    const r = absoluteOrientation(CANONICAL_VERTICES_MM, dst, KABSCH_WEIGHTS, true);
    expect(qAngleDeg(r.q, q)).toBeLessThan(0.2);
    r.t.forEach((v, i) => expect(Math.abs(v - t[i])).toBeLessThan(0.5));
    expect(Math.abs(r.s - s)).toBeLessThan(0.005);
    expect(r.rms).toBeLessThan(1);
  });
});
