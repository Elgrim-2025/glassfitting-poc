/** Motion-latency meter: cross-correlation lag between the raw and filtered yaw signals. */
import { crossCorrelationLag, RingBuffer } from '../math/stats';

export interface LatencyReading {
  lagFrames: number;
  lagMs: number;
  samples: number;
}

export class LatencyMeter {
  private raw: RingBuffer;
  private filtered: RingBuffer;
  private times: RingBuffer;

  constructor(window = 120, private maxLag = 15) {
    this.raw = new RingBuffer(window);
    this.filtered = new RingBuffer(window);
    this.times = new RingBuffer(window);
  }

  reset(): void {
    this.raw.clear();
    this.filtered.clear();
    this.times.clear();
  }

  update(rawValue: number, filteredValue: number, timestampMs: number): void {
    this.raw.push(rawValue);
    this.filtered.push(filteredValue);
    this.times.push(timestampMs);
  }

  read(): LatencyReading {
    const n = this.raw.length;
    if (n < 10) return { lagFrames: NaN, lagMs: NaN, samples: n };
    const t = this.times.toArray();
    const dt = (t[t.length - 1] - t[0]) / (t.length - 1);
    const lag = crossCorrelationLag(this.raw.toArray(), this.filtered.toArray(), this.maxLag);
    return { lagFrames: lag, lagMs: lag * dt, samples: n };
  }
}
