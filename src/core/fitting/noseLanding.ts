/**
 * Bridge landing: where the frame's origin (the nose-pad contact plane, see
 * docs/assets/glb-spec.md) sits on the user's nose.
 *
 * Height: base point 6 (nose bridge at pupil level) shifted by the nose-pad preset; frames
 * on adjustable pads additionally slide lower with a wider bridge (fixed acetate pads sit
 * where their contact points are, so the preset alone applies).
 *
 * Depth: the frame rests on its nose pads. With an asset that describes the pad contact
 * points (`nose_pad_offset`, x ≠ 0 or the spec's pad spacing) the origin depth is chosen
 * so that both pad contact faces touch the nose flank surface (sinking `padSinkMm`);
 * the frame's own ridge/rim clearance is then handled by the clearance solver, which may
 * push forward again. Without pad information the depth falls back to the user's ridge
 * profile (168 → 6 → 197 → 195 → 5) plus `bridgeClearanceMm`, as before.
 */
import { LM } from '../landmarks';
import { mInvert, mTransformPoint, mTransformPoints, type Mat4 } from '../math/mat4';
import { pointAt, type Vec3 } from '../math/vec3';
import type { AssetAnchor, FittingConfig, FrameSpec } from '../types';
import type { GlassesScale } from './anchorSolver';
import { NOSE_TRIS, surfaceZ } from './faceSurface';

export const RIDGE_PROFILE = [LM.BRIDGE_TOP, LM.BRIDGE, 197, 195, 5] as const;
/** Reference bridge width (mm) at which no extra drop is applied. */
export const REFERENCE_BRIDGE_MM = 18;
/** Vertical drop per mm of bridge width beyond the reference (adjustable pads only). */
export const DROP_PER_BRIDGE_MM = 0.8;
/** Adjustable pads sit on arms behind the rims: centre |x| = max(ADJUSTABLE_PAD_MIN_X_MM, bridge/2 − 1). */
export const ADJUSTABLE_PAD_MIN_X_MM = 8;

/** Nose-pad centre |x| for a spec (fixed pads: bridge/2 − 1; adjustable: see ADJUSTABLE_PAD_MIN_X_MM). */
export const padHalfSpacing = (spec: FrameSpec): number =>
  spec.nose_pad === 'adjustable' ? Math.max(ADJUSTABLE_PAD_MIN_X_MM, spec.bridge_mm / 2 - 1) : spec.bridge_mm / 2 - 1;

/** Pad contact point of the +X pad in frame coordinates (mm): asset x when given, else the spec spacing. */
export function padContactPoint(spec: FrameSpec, asset: AssetAnchor | null | undefined): Vec3 {
  const off = asset?.nose_pad_offset ?? [0, -4, -2];
  const x = off[0] > 0 ? off[0] : padHalfSpacing(spec);
  return [x, off[1], off[2]];
}

export interface NoseLanding {
  /** Anchor position in the face-local frame (mm). */
  anchor: Vec3;
  landingY: number;
  ridgeZ: number;
  /** True when the depth comes from the pads resting on the flanks (false: ridge fallback). */
  padContact: boolean;
}

/**
 * @param metricPts 478×3 camera-space points (mm).
 * @param faceMatrixMm Pose used to move the points into the face-local frame.
 * @param asset Product anchor metadata (pad contact); null → ridge fallback.
 * @param scale Frame scale (uniform, width) — moves the pads with the width correction.
 * @param tiltDeg Pantoscopic tilt applied to the frame (moves the pad contact point).
 */
export function solveNoseLanding(
  metricPts: Float32Array,
  faceMatrixMm: Mat4,
  spec: FrameSpec | null,
  cfg: FittingConfig['placement'],
  asset: AssetAnchor | null = null,
  scale: GlassesScale = { uniform: 1, width: 1 },
  tiltDeg = 0,
): NoseLanding {
  const inv = mInvert(faceMatrixMm);
  const profile = RIDGE_PROFILE.map((i) => mTransformPoint(inv, pointAt(metricPts, i)));
  // Profile runs top → bottom (decreasing y).
  const yTop = profile[0][1];
  const yBottom = profile[profile.length - 1][1];
  const base = profile[1][1];
  const slide = spec?.nose_pad === 'adjustable' ? DROP_PER_BRIDGE_MM * Math.max(0, spec.bridge_mm - REFERENCE_BRIDGE_MM) : 0;
  const drop = spec ? cfg.nosePadDropMm[spec.nose_pad] - slide : 0;
  const landingY = Math.min(yTop, Math.max(yBottom, base + drop));

  // Interpolate x/z along the ridge profile at landingY.
  let x = profile[1][0];
  let ridgeZ = profile[1][2];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i], b = profile[i + 1];
    const hi = Math.max(a[1], b[1]), lo = Math.min(a[1], b[1]);
    if (landingY <= hi && landingY >= lo) {
      const t = hi === lo ? 0 : (a[1] - landingY) / (a[1] - b[1]);
      x = a[0] + (b[0] - a[0]) * t;
      ridgeZ = a[2] + (b[2] - a[2]) * t;
      break;
    }
  }

  // Pad contact: both pad faces touch the flank surface (sunk by padSinkMm).
  if (spec && asset) {
    const local = mTransformPoints(inv, metricPts);
    const pad = padContactPoint(spec, asset);
    const rad = (tiltDeg * Math.PI) / 180;
    const c = Math.cos(rad), s = Math.sin(rad);
    const sx = scale.uniform * scale.width, sy = scale.uniform;
    const dy = pad[1] * sy * c - pad[2] * sy * s;
    const dz = pad[1] * sy * s + pad[2] * sy * c;
    let z0: number | null = null;
    for (const sign of [-1, 1]) {
      const zf = surfaceZ(local, NOSE_TRIS, x + sign * pad[0] * sx, landingY + dy);
      if (zf === null) continue;
      const z = zf - cfg.clearance.padSinkMm - dz;
      if (z0 === null || z > z0) z0 = z;
    }
    if (z0 !== null) return { anchor: [x, landingY, z0], landingY, ridgeZ, padContact: true };
  }
  return { anchor: [x, landingY, ridgeZ + cfg.bridgeClearanceMm], landingY, ridgeZ, padContact: false };
}
