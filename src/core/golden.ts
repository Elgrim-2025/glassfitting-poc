/**
 * Golden test vectors: recorded FrameInput sequences with the expected FittingCore
 * outputs. The Android (Kotlin) port must reproduce them within tolerance.
 */
import { FittingCore } from './fittingCore';
import type { FittingConfigPatch } from './config';
import { mDecompose } from './math/mat4';
import { qAngleDeg } from './math/quat';
import type { Angles, FitOutput, FrameInput, FrameSpec, TrackingState } from './types';

export interface GoldenExpected {
  state: TrackingState;
  alpha: number;
  glassesMatrix: number[] | null;
  angles: Angles | null;
  widthScale: number;
  pdNear: number | null;
}

export interface GoldenTolerance {
  translationMm: number;
  rotationDeg: number;
  scale: number;
  angleDeg: number;
  widthScale: number;
  pdMm: number;
  alpha: number;
}

export interface GoldenVector {
  version: 1;
  name: string;
  createdAt: string;
  config: FittingConfigPatch;
  spec: FrameSpec | null;
  tolerance: GoldenTolerance;
  frames: FrameInput[];
  expected: GoldenExpected[];
}

export interface GoldenReport {
  pass: boolean;
  frames: number;
  failures: string[];
  maxTranslationErrMm: number;
  maxRotationErrDeg: number;
  maxPdErrMm: number;
}

export const DEFAULT_TOLERANCE: GoldenTolerance = {
  translationMm: 0.5, rotationDeg: 0.2, scale: 0.01, angleDeg: 0.2, widthScale: 0.01, pdMm: 0.2, alpha: 0.02,
};

const round = (v: number, d: number) => Number(v.toFixed(d));

export function expectedFromOutput(o: FitOutput): GoldenExpected {
  return {
    state: o.state,
    alpha: round(o.alpha, 4),
    glassesMatrix: o.glassesMatrix ? o.glassesMatrix.map((v) => round(v, 5)) : null,
    angles: o.angles ? { yaw: round(o.angles.yaw, 4), pitch: round(o.angles.pitch, 4), roll: round(o.angles.roll, 4) } : null,
    widthScale: round(o.widthScale, 5),
    pdNear: Number.isFinite(o.pd.pd_near) ? round(o.pd.pd_near, 3) : null,
  };
}

/** Rounds landmark coordinates to keep golden files compact. */
export function compactFrame(f: FrameInput, decimals = 5): FrameInput {
  return {
    ...f,
    landmarks: f.landmarks ? f.landmarks.map((l) => ({ x: round(l.x, decimals), y: round(l.y, decimals), z: round(l.z, decimals) })) : null,
    matrix: f.matrix ? f.matrix.map((v) => round(v, 6)) : null,
    blendshapes: f.blendshapes ? Object.fromEntries(Object.entries(f.blendshapes).map(([k, v]) => [k, round(v, 4)])) : null,
  };
}

export function generateGolden(
  name: string,
  frames: FrameInput[],
  config: FittingConfigPatch = {},
  spec: FrameSpec | null = null,
  tolerance: GoldenTolerance = DEFAULT_TOLERANCE,
): GoldenVector {
  const compact = frames.map((f) => compactFrame(f));
  const core = new FittingCore(config);
  core.setFrameSpec(spec);
  const expected = compact.map((f) => expectedFromOutput(core.process(f)));
  return { version: 1, name, createdAt: new Date().toISOString(), config, spec, tolerance, frames: compact, expected };
}

export function runGolden(vector: GoldenVector, coreFactory: (c: FittingConfigPatch) => FittingCore = (c) => new FittingCore(c)): GoldenReport {
  const core = coreFactory(vector.config);
  core.setFrameSpec(vector.spec);
  const tol = vector.tolerance;
  const failures: string[] = [];
  let maxT = 0, maxR = 0, maxPd = 0;
  vector.frames.forEach((frame, i) => {
    const out = core.process(frame);
    const exp = vector.expected[i];
    const tag = `frame ${i}`;
    if (out.state !== exp.state) failures.push(`${tag}: state ${out.state} ≠ ${exp.state}`);
    if (Math.abs(out.alpha - exp.alpha) > tol.alpha) failures.push(`${tag}: alpha ${out.alpha} ≠ ${exp.alpha}`);
    if ((out.glassesMatrix === null) !== (exp.glassesMatrix === null)) {
      failures.push(`${tag}: glassesMatrix presence mismatch`);
    } else if (out.glassesMatrix && exp.glassesMatrix) {
      const a = mDecompose(out.glassesMatrix);
      const b = mDecompose(exp.glassesMatrix);
      const dt = Math.hypot(a.t[0] - b.t[0], a.t[1] - b.t[1], a.t[2] - b.t[2]);
      const dr = qAngleDeg(a.q, b.q);
      const ds = Math.max(...a.s.map((v, k) => Math.abs(v - b.s[k])));
      maxT = Math.max(maxT, dt);
      maxR = Math.max(maxR, dr);
      if (dt > tol.translationMm) failures.push(`${tag}: translation error ${dt.toFixed(3)} mm`);
      if (dr > tol.rotationDeg) failures.push(`${tag}: rotation error ${dr.toFixed(3)}°`);
      if (ds > tol.scale) failures.push(`${tag}: scale error ${ds.toFixed(4)}`);
    }
    if (out.angles && exp.angles) {
      const da = Math.max(Math.abs(out.angles.yaw - exp.angles.yaw), Math.abs(out.angles.pitch - exp.angles.pitch), Math.abs(out.angles.roll - exp.angles.roll));
      if (da > tol.angleDeg) failures.push(`${tag}: angle error ${da.toFixed(3)}°`);
    }
    if (Math.abs(out.widthScale - exp.widthScale) > tol.widthScale) failures.push(`${tag}: widthScale ${out.widthScale} ≠ ${exp.widthScale}`);
    if (exp.pdNear !== null && Number.isFinite(out.pd.pd_near)) {
      const dp = Math.abs(out.pd.pd_near - exp.pdNear);
      maxPd = Math.max(maxPd, dp);
      if (dp > tol.pdMm) failures.push(`${tag}: pd_near error ${dp.toFixed(3)} mm`);
    }
  });
  return { pass: failures.length === 0, frames: vector.frames.length, failures, maxTranslationErrMm: maxT, maxRotationErrDeg: maxR, maxPdErrMm: maxPd };
}
