/** Tracking retention ratio and re-acquisition time. */
import type { TrackingState } from '../types';

export interface TrackingStatsReading {
  trackingRatio: number;
  frames: number;
  /** Last measured Lost → Tracking re-acquisition time (ms), NaN if none yet. */
  lastReacquireMs: number;
}

export class TrackingStats {
  private frames = 0;
  private tracking = 0;
  private lostAtMs: number | null = null;
  private detectedAtMs: number | null = null;
  private lastReacquireMs = NaN;
  private prev: TrackingState = 'Lost';

  reset(): void {
    this.frames = 0;
    this.tracking = 0;
    this.lostAtMs = null;
    this.detectedAtMs = null;
    this.lastReacquireMs = NaN;
    this.prev = 'Lost';
  }

  update(state: TrackingState, timestampMs: number): void {
    this.frames++;
    if (state === 'Tracking') this.tracking++;
    if (state === 'Lost' && this.prev !== 'Lost') this.lostAtMs = timestampMs;
    if (this.prev === 'Lost' && state !== 'Lost') this.detectedAtMs = timestampMs;
    if (state === 'Tracking' && this.prev !== 'Tracking' && this.detectedAtMs !== null && this.lostAtMs !== null) {
      this.lastReacquireMs = timestampMs - this.detectedAtMs;
      this.lostAtMs = null;
      this.detectedAtMs = null;
    }
    this.prev = state;
  }

  read(): TrackingStatsReading {
    return { trackingRatio: this.frames ? this.tracking / this.frames : NaN, frames: this.frames, lastReacquireMs: this.lastReacquireMs };
  }
}
