import type { FittingConfig } from './types';

export const DEFAULT_CONFIG: FittingConfig = {
  camera: { fovYDeg: 63 },
  transposeMatrix: false,
  filter: {
    enabled: true,
    position: { minCutoff: 1.0, beta: 0.02, dCutoff: 1.0 },
    rotation: { minCutoff: 1.0, beta: 0.5, dCutoff: 1.0 },
    scale: { minCutoff: 0.5, beta: 0, dCutoff: 1.0 },
  },
  tracking: {
    maxYawDeg: 45,
    maxPitchDeg: 30,
    maxRollDeg: 30,
    minFaceWidthPx: 60,
    holdFrames: 12,
    fadeMs: 300,
    reacquireFrames: 3,
  },
  placement: {
    widthScaleEnabled: true,
    realSizeMode: false,
    widthScaleMin: 0.8,
    widthScaleMax: 1.25,
    bridgeClearanceMm: 1.0,
    nosePadDropMm: { fixed: 0, adjustable: -5 },
    useKabschPose: true,
    depthSource: 'hybrid',
    pantoscopicTiltDeg: 8,
    clearance: { templeMm: 2.5, rimMm: 1.0, padSinkMm: 1.0, noseSinkMm: 2.0, maxForwardMm: 15, maxSplayDeg: 15, vertexMinMm: 10, vertexMaxMm: 23 },
  },
  pd: {
    irisDiameterMm: 11.7,
    maxYawDeg: 5,
    maxPitchDeg: 5,
    maxBlink: 0.2,
    maxGaze: 0.5,
    minIrisPx: 12,
    maxCenterOffset: 0.2,
    minSamples: 30,
    maxSamples: 60,
    eyeRotationCenterMm: 13,
  },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type FittingConfigPatch = DeepPartial<FittingConfig>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep-merges a patch onto a config (arrays and primitives are replaced). */
export function mergeConfig<T extends object>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return structuredClone(base);
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    const b = out[k];
    out[k] = isObj(v) && isObj(b) ? mergeConfig(b, v as DeepPartial<object>) : v;
  }
  return out as T;
}
