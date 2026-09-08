/** Filters a face matrix by decomposing it into translation, rotation and scale. */
import { mCompose, mDecompose, type Mat4 } from '../math/mat4';
import type { FittingConfig } from '../types';
import { OneEuroQuat, OneEuroVec3 } from './oneEuro';

export class PoseFilter {
  private pos: OneEuroVec3;
  private rot: OneEuroQuat;
  private scl: OneEuroVec3;

  constructor(private cfg: FittingConfig['filter']) {
    this.pos = new OneEuroVec3(cfg.position);
    this.rot = new OneEuroQuat(cfg.rotation);
    this.scl = new OneEuroVec3(cfg.scale);
  }

  setConfig(cfg: FittingConfig['filter']): void {
    this.cfg = cfg;
    this.pos.params = cfg.position;
    this.rot.params = cfg.rotation;
    this.scl.params = cfg.scale;
  }

  reset(): void {
    this.pos.reset();
    this.rot.reset();
    this.scl.reset();
  }

  filter(m: Mat4, tMs: number, strength = 1): Mat4 {
    if (!this.cfg.enabled) {
      this.reset();
      return m;
    }
    const { t, q, s } = mDecompose(m);
    return mCompose(this.pos.filter(t, tMs, strength), this.rot.filter(q, tMs, strength), this.scl.filter(s, tMs, strength));
  }
}
