/**
 * Reference pupillary distance from iris landmarks (spec §3.4).
 * Scale: iris horizontal diameter ≈ 11.7 mm. Frames are gated (frontal pose, eyes open,
 * frontal gaze, iris large enough, face centred) and aggregated with median/IQR statistics.
 * Output is a reference value only — not for prescription use.
 */
import { LM } from '../landmarks';
import { iqrFilter, median, medianCiHalfWidth } from '../math/stats';
import type { CameraModel } from '../fitting/camera';
import type { Angles, FittingConfig, FrameInput, Landmark, PdEstimate } from '../types';

interface Sample {
  pdNear: number;
  monoL: number;
  monoR: number;
  distance: number;
  irisPx: number;
}

export const IDLE_ESTIMATE: PdEstimate = {
  pd_far: NaN, pd_near: NaN, pd_mono_left: NaN, pd_mono_right: NaN,
  confidence: 0, sample_count: 0, ci_mm: NaN, distance_mm: NaN, iris_diameter_px: NaN,
  status: 'idle', last_reject: null,
};

const GAZE_KEYS = [
  'eyeLookInLeft', 'eyeLookOutLeft', 'eyeLookUpLeft', 'eyeLookDownLeft',
  'eyeLookInRight', 'eyeLookOutRight', 'eyeLookUpRight', 'eyeLookDownRight',
];

export interface PdFrameMeasure {
  irisPx: number;
  pdNearPx: number;
  pdNearMm: number;
  monoLMm: number;
  monoRMm: number;
  distanceMm: number;
  mmPerPx: number;
}

/** Single-frame geometry (no gating). Exposed for tests and the HUD. */
export function measurePdFrame(lm: readonly Landmark[], cam: CameraModel, irisMm: number): PdFrameMeasure {
  const px = (i: number) => ({ x: lm[i].x * cam.imageWidth, y: lm[i].y * cam.imageHeight });
  const dist = (a: number, b: number) => Math.hypot(px(a).x - px(b).x, px(a).y - px(b).y);
  const irisDiameter = (c: readonly number[]) => (dist(c[0], c[2]) + dist(c[1], c[3])) / 2;
  const irisPx = (irisDiameter(LM.IRIS_L_CONTOUR) + irisDiameter(LM.IRIS_R_CONTOUR)) / 2;
  const mmPerPx = irisMm / irisPx;
  const pdNearPx = dist(LM.IRIS_L_CENTER, LM.IRIS_R_CENTER);

  // Nose midline through 168 → 197 (in px); monocular PD = perpendicular distance of each iris centre.
  const a = px(LM.BRIDGE_TOP), b = px(197);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const perp = (p: { x: number; y: number }) => Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
  const monoLMm = perp(px(LM.IRIS_L_CENTER)) * mmPerPx;
  const monoRMm = perp(px(LM.IRIS_R_CENTER)) * mmPerPx;
  const distanceMm = (cam.focalPx * irisMm) / irisPx;
  return { irisPx, pdNearPx, pdNearMm: pdNearPx * mmPerPx, monoLMm, monoRMm, distanceMm, mmPerPx };
}

export class PdEstimator {
  private samples: Sample[] = [];
  private lastReject: string | null = null;
  private lastMeasure: PdFrameMeasure | null = null;
  private estimate: PdEstimate = { ...IDLE_ESTIMATE };

  constructor(private cfg: FittingConfig['pd']) {}

  setConfig(cfg: FittingConfig['pd']): void {
    this.cfg = cfg;
  }

  reset(): void {
    this.samples = [];
    this.lastReject = null;
    this.lastMeasure = null;
    this.estimate = { ...IDLE_ESTIMATE };
  }

  get current(): PdEstimate {
    return this.estimate;
  }

  /** Returns the reason a frame fails gating, or null when it can be used. */
  gate(frame: FrameInput, angles: Angles | null, measure: PdFrameMeasure): string | null {
    const c = this.cfg;
    if (!angles) return 'no-pose';
    if (Math.abs(angles.yaw) > c.maxYawDeg) return 'yaw';
    if (Math.abs(angles.pitch) > c.maxPitchDeg) return 'pitch';
    const bs = frame.blendshapes;
    if (bs) {
      if (Math.max(bs.eyeBlinkLeft ?? 0, bs.eyeBlinkRight ?? 0) > c.maxBlink) return 'blink';
      let gaze = 0;
      for (const k of GAZE_KEYS) gaze = Math.max(gaze, bs[k] ?? 0);
      if (gaze > c.maxGaze) return 'gaze';
    }
    if (measure.irisPx < c.minIrisPx) return 'too-far';
    const lm = frame.landmarks!;
    const cx = lm[LM.BRIDGE_TOP].x - 0.5;
    const cy = lm[LM.BRIDGE_TOP].y - 0.5;
    if (Math.hypot(cx, cy) > c.maxCenterOffset) return 'off-center';
    return null;
  }

  update(frame: FrameInput, angles: Angles | null, cam: CameraModel): PdEstimate {
    if (!frame.landmarks || frame.landmarks.length < 478) {
      this.lastReject = 'no-face';
      return this.recompute();
    }
    const m = measurePdFrame(frame.landmarks, cam, this.cfg.irisDiameterMm);
    this.lastMeasure = m;
    const reject = this.gate(frame, angles, m);
    this.lastReject = reject;
    if (!reject) {
      this.samples.push({ pdNear: m.pdNearMm, monoL: m.monoLMm, monoR: m.monoRMm, distance: m.distanceMm, irisPx: m.irisPx });
      if (this.samples.length > this.cfg.maxSamples) this.samples.shift();
    }
    return this.recompute();
  }

  private recompute(): PdEstimate {
    const n = this.samples.length;
    if (n === 0) {
      this.estimate = { ...IDLE_ESTIMATE, status: 'collecting', last_reject: this.lastReject };
      return this.estimate;
    }
    const near = iqrFilter(this.samples.map((s) => s.pdNear));
    const pdNear = median(near);
    const distance = median(this.samples.map((s) => s.distance));
    const r = this.cfg.eyeRotationCenterMm;
    const pdFar = pdNear * ((distance + r) / distance);
    const ci = n >= 2 ? medianCiHalfWidth(near) : NaN;
    const ready = n >= this.cfg.minSamples;
    const spreadPenalty = Number.isFinite(ci) ? Math.max(0, 1 - ci / 3) : 0.5;
    this.estimate = {
      pd_far: pdFar,
      pd_near: pdNear,
      pd_mono_left: median(this.samples.map((s) => s.monoL)),
      pd_mono_right: median(this.samples.map((s) => s.monoR)),
      confidence: Math.min(1, n / this.cfg.minSamples) * spreadPenalty,
      sample_count: n,
      ci_mm: ci,
      distance_mm: distance,
      iris_diameter_px: this.lastMeasure?.irisPx ?? median(this.samples.map((s) => s.irisPx)),
      status: ready ? 'ready' : 'collecting',
      last_reject: this.lastReject,
    };
    return this.estimate;
  }
}
