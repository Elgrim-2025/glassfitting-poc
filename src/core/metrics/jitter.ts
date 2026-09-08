/**
 * Jitter meter: standard deviation of the bridge anchor's screen position (px,
 * normalised to a 720 px-high image) and of yaw/pitch/roll over a rolling window
 * (default 90 frames ≈ 3 s at 30 fps). Feed it only while the head is still.
 */
import { RingBuffer, std } from '../math/stats';
import type { Angles } from '../types';

export interface JitterReading {
  positionPx: number;
  rotationDeg: number;
  samples: number;
}

export class JitterMeter {
  private x: RingBuffer;
  private y: RingBuffer;
  private yaw: RingBuffer;
  private pitch: RingBuffer;
  private roll: RingBuffer;

  constructor(window = 90) {
    this.x = new RingBuffer(window);
    this.y = new RingBuffer(window);
    this.yaw = new RingBuffer(window);
    this.pitch = new RingBuffer(window);
    this.roll = new RingBuffer(window);
  }

  reset(): void {
    for (const b of [this.x, this.y, this.yaw, this.pitch, this.roll]) b.clear();
  }

  /** @param screen bridge position in normalised image coordinates. */
  update(screen: { x: number; y: number }, imageWidth: number, imageHeight: number, angles: Angles | null): void {
    const k = 720 / imageHeight;
    this.x.push(screen.x * imageWidth * k);
    this.y.push(screen.y * imageHeight * k);
    if (angles) {
      this.yaw.push(angles.yaw);
      this.pitch.push(angles.pitch);
      this.roll.push(angles.roll);
    }
  }

  read(): JitterReading {
    const n = this.x.length;
    if (n < 2) return { positionPx: NaN, rotationDeg: NaN, samples: n };
    const sx = std(this.x.toArray());
    const sy = std(this.y.toArray());
    const rot = this.yaw.length >= 2 ? Math.max(std(this.yaw.toArray()), std(this.pitch.toArray()), std(this.roll.toArray())) : NaN;
    return { positionPx: Math.hypot(sx, sy), rotationDeg: rot, samples: n };
  }
}
