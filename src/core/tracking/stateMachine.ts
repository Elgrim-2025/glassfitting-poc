/**
 * Tracking / Degraded / Lost state with hold, fade-out and re-acquisition hysteresis.
 *
 * - Tracking: detected, confidence ≥ 0.6 and head angles inside the supported range.
 * - Degraded: detected but low confidence or extreme pose; also while holding the last
 *   pose right after a loss, and while re-acquiring. Filters smooth harder here.
 * - Lost: no detection for more than `holdFrames`; alpha fades to 0 over `fadeMs`.
 */
import type { Angles, FittingConfig, TrackingState } from '../types';
import { withinRange } from './angles';

export interface StateInput {
  timestampMs: number;
  detected: boolean;
  /** 0..1 approximate detection confidence. */
  confidence: number;
  angles: Angles | null;
}

export interface StateOutput {
  state: TrackingState;
  /** 0..1 presence of the glasses (1 = fully shown). */
  alpha: number;
  /** Smoothing multiplier for the pose filter. */
  filterStrength: number;
  /** True while the last known pose should still be displayed. */
  holdPose: boolean;
}

export const CONFIDENCE_TRACKING = 0.6;
export const CONFIDENCE_MIN = 0.3;
export const DEGRADED_FILTER_STRENGTH = 2;

export class TrackingStateMachine {
  private state: TrackingState = 'Lost';
  private missCount = 0;
  private goodStreak = 0;
  private lostSinceMs: number | null = null;
  private alpha = 0;

  constructor(private cfg: FittingConfig['tracking']) {}

  setConfig(cfg: FittingConfig['tracking']): void {
    this.cfg = cfg;
  }

  reset(): void {
    this.state = 'Lost';
    this.missCount = 0;
    this.goodStreak = 0;
    this.lostSinceMs = null;
    this.alpha = 0;
  }

  get current(): TrackingState {
    return this.state;
  }

  update(input: StateInput): StateOutput {
    const usable = input.detected && input.confidence >= CONFIDENCE_MIN;
    if (!usable) return this.onMiss(input.timestampMs);

    this.missCount = 0;
    this.lostSinceMs = null;
    const inRange = input.angles ? withinRange(input.angles, this.cfg.maxYawDeg, this.cfg.maxPitchDeg, this.cfg.maxRollDeg) : true;
    const good = input.confidence >= CONFIDENCE_TRACKING && inRange;
    this.goodStreak = good ? this.goodStreak + 1 : 0;

    if (this.state === 'Lost') {
      // Re-acquisition: show immediately, but stay Degraded until the streak is long enough.
      this.state = 'Degraded';
    }
    if (this.state === 'Degraded' && this.goodStreak >= this.cfg.reacquireFrames) this.state = 'Tracking';
    if (this.state === 'Tracking' && !good) this.state = 'Degraded';
    this.alpha = 1;
    return {
      state: this.state,
      alpha: 1,
      filterStrength: this.state === 'Tracking' ? 1 : DEGRADED_FILTER_STRENGTH,
      holdPose: false,
    };
  }

  private onMiss(tMs: number): StateOutput {
    this.missCount++;
    this.goodStreak = 0;
    if (this.missCount <= this.cfg.holdFrames && this.alpha > 0) {
      // Hold the last pose for a few frames (brief dropouts, blinks, occlusion).
      this.state = 'Degraded';
      return { state: 'Degraded', alpha: this.alpha, filterStrength: DEGRADED_FILTER_STRENGTH, holdPose: true };
    }
    this.state = 'Lost';
    if (this.lostSinceMs === null) this.lostSinceMs = tMs;
    const fade = this.cfg.fadeMs > 0 ? Math.max(0, 1 - (tMs - this.lostSinceMs) / this.cfg.fadeMs) : 0;
    this.alpha = Math.min(this.alpha, fade);
    return { state: 'Lost', alpha: this.alpha, filterStrength: DEGRADED_FILTER_STRENGTH, holdPose: this.alpha > 0 };
  }
}
