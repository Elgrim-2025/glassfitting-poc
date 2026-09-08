/** Small statistics helpers used by the PD estimator and QA meters. */

export const mean = (xs: ArrayLike<number>): number => {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
};

/** Population standard deviation. */
export const std = (xs: ArrayLike<number>): number => {
  if (xs.length === 0) return NaN;
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i] - m) ** 2;
  return Math.sqrt(s / xs.length);
};

export const quantile = (xs: ArrayLike<number>, q: number): number => {
  if (xs.length === 0) return NaN;
  const sorted = Array.from(xs).sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

export const median = (xs: ArrayLike<number>): number => quantile(xs, 0.5);

/** Keeps values inside [Q1 − k·IQR, Q3 + k·IQR]. */
export const iqrFilter = (xs: ArrayLike<number>, k = 1.5): number[] => {
  if (xs.length < 4) return Array.from(xs);
  const q1 = quantile(xs, 0.25);
  const q3 = quantile(xs, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - k * iqr;
  const hi = q3 + k * iqr;
  return Array.from(xs).filter((v) => v >= lo && v <= hi);
};

/** Half-width of a ~95 % confidence interval of the median (1.253·σ/√n · 1.96). */
export const medianCiHalfWidth = (xs: ArrayLike<number>): number => {
  if (xs.length < 2) return NaN;
  return (1.96 * 1.253 * std(xs)) / Math.sqrt(xs.length);
};

/**
 * Lag (in samples, ≥ 0) by which `filtered` trails `raw`, found by maximizing the
 * normalized cross-correlation of the mean-removed signals over 0..maxLag.
 */
export const crossCorrelationLag = (raw: ArrayLike<number>, filtered: ArrayLike<number>, maxLag: number): number => {
  const n = Math.min(raw.length, filtered.length);
  if (n < 4) return 0;
  const mr = mean(Array.from(raw).slice(0, n));
  const mf = mean(Array.from(filtered).slice(0, n));
  let bestLag = 0;
  let best = -Infinity;
  for (let lag = 0; lag <= Math.min(maxLag, n - 2); lag++) {
    let num = 0, dr = 0, df = 0;
    for (let i = 0; i + lag < n; i++) {
      const a = raw[i] - mr;
      const b = filtered[i + lag] - mf;
      num += a * b; dr += a * a; df += b * b;
    }
    const denom = Math.sqrt(dr * df);
    const c = denom > 0 ? num / denom : 0;
    if (c > best + 1e-9) { best = c; bestLag = lag; }
  }
  return bestLag;
};

/** Fixed-capacity ring buffer of numbers. */
export class RingBuffer {
  private buf: Float64Array;
  private head = 0;
  private count = 0;
  constructor(public readonly capacity: number) {
    this.buf = new Float64Array(capacity);
  }
  push(v: number): void {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }
  get length(): number { return this.count; }
  clear(): void { this.head = 0; this.count = 0; }
  toArray(): number[] {
    const out = new Array<number>(this.count);
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) out[i] = this.buf[(start + i) % this.capacity];
    return out;
  }
}
