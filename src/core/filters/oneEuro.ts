/**
 * One-Euro filter (Casiez et al. 2012) for scalars, 3-vectors and quaternions.
 * Strong smoothing when still (minCutoff), weak smoothing when moving fast (beta).
 * `strength` > 1 lowers both cutoffs to smooth harder (used in the Degraded state).
 */
import type { OneEuroParams } from '../types';
import { qAngleDeg, qNormalize, qSlerp, type Quat } from '../math/quat';
import type { Vec3 } from '../math/vec3';

const TWO_PI = 2 * Math.PI;

const smoothingFactor = (dtSec: number, cutoffHz: number): number => {
  const tau = 1 / (TWO_PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
};

export class OneEuroScalar {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;
  constructor(public params: OneEuroParams) {}

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  filter(x: number, tMs: number, strength = 1): number {
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = x;
      this.tPrev = tMs;
      return x;
    }
    const dt = Math.max((tMs - this.tPrev) / 1000, 1e-4);
    this.tPrev = tMs;
    const minCutoff = this.params.minCutoff / strength;
    const beta = this.params.beta / strength;
    const dx = (x - this.xPrev) / dt;
    const aD = smoothingFactor(dt, this.params.dCutoff);
    const edx = aD * dx + (1 - aD) * this.dxPrev;
    this.dxPrev = edx;
    const cutoff = minCutoff + beta * Math.abs(edx);
    const a = smoothingFactor(dt, cutoff);
    const out = a * x + (1 - a) * this.xPrev;
    this.xPrev = out;
    return out;
  }
}

export class OneEuroVec3 {
  private f: [OneEuroScalar, OneEuroScalar, OneEuroScalar];
  constructor(params: OneEuroParams) {
    this.f = [new OneEuroScalar(params), new OneEuroScalar(params), new OneEuroScalar(params)];
  }
  set params(p: OneEuroParams) {
    for (const s of this.f) s.params = p;
  }
  reset(): void {
    for (const s of this.f) s.reset();
  }
  filter(v: Vec3, tMs: number, strength = 1): Vec3 {
    return [this.f[0].filter(v[0], tMs, strength), this.f[1].filter(v[1], tMs, strength), this.f[2].filter(v[2], tMs, strength)];
  }
}

/** Quaternion One-Euro: the derivative is the angular speed, smoothing is a slerp toward the new sample. */
export class OneEuroQuat {
  private qPrev: Quat | null = null;
  private dPrev = 0;
  private tPrev: number | null = null;
  constructor(public params: OneEuroParams) {}

  reset(): void {
    this.qPrev = null;
    this.dPrev = 0;
    this.tPrev = null;
  }

  filter(q: Quat, tMs: number, strength = 1): Quat {
    const qn = qNormalize(q);
    if (this.qPrev === null || this.tPrev === null) {
      this.qPrev = qn;
      this.tPrev = tMs;
      return qn;
    }
    const dt = Math.max((tMs - this.tPrev) / 1000, 1e-4);
    this.tPrev = tMs;
    const minCutoff = this.params.minCutoff / strength;
    const beta = this.params.beta / strength;
    // Angular speed in rad/s.
    const speed = (qAngleDeg(this.qPrev, qn) * Math.PI) / 180 / dt;
    const aD = smoothingFactor(dt, this.params.dCutoff);
    const ed = aD * speed + (1 - aD) * this.dPrev;
    this.dPrev = ed;
    const cutoff = minCutoff + beta * Math.abs(ed);
    const a = smoothingFactor(dt, cutoff);
    const out = qSlerp(this.qPrev, qn, a);
    this.qPrev = out;
    return out;
  }
}
