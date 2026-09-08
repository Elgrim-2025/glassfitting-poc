/** Frame-rate and capture→render latency meter. */
import { RingBuffer, mean } from '../math/stats';

export interface FpsReading {
  fps: number;
  /** Mean capture → render-complete latency (ms). */
  pipelineMs: number;
  /** Mean detector inference time (ms). */
  detectMs: number;
}

export class FpsMeter {
  private frameTimes = new RingBuffer(60);
  private pipeline = new RingBuffer(60);
  private detect = new RingBuffer(60);

  reset(): void {
    this.frameTimes.clear();
    this.pipeline.clear();
    this.detect.clear();
  }

  /** Call once per rendered frame. */
  tick(nowMs: number, captureMs?: number, detectMs?: number): void {
    this.frameTimes.push(nowMs);
    if (captureMs !== undefined) this.pipeline.push(nowMs - captureMs);
    if (detectMs !== undefined) this.detect.push(detectMs);
  }

  read(): FpsReading {
    const t = this.frameTimes.toArray();
    const fps = t.length >= 2 ? ((t.length - 1) * 1000) / (t[t.length - 1] - t[0]) : NaN;
    return {
      fps,
      pipelineMs: this.pipeline.length ? mean(this.pipeline.toArray()) : NaN,
      detectMs: this.detect.length ? mean(this.detect.toArray()) : NaN,
    };
  }
}
