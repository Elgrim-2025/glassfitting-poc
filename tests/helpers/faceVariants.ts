/**
 * Face-shape variants for the clearance regression bench (spec §4.4): smooth,
 * parametric deformations of the canonical model in face-local mm.
 *
 * Local features (nose ridge, cheekbones, brow, temple width) are applied on the
 * canonical coordinates with a soft-box weight — 1 inside the region and a Gaussian
 * skirt outside it (σ = 8 mm) — so no crease appears at the region border. The global
 * width/height/depth scales are applied last, about the canonical origin.
 */
import { CANONICAL_VERTEX_COUNT, CANONICAL_VERTICES_MM } from '../../src/core/fitting/canonical';

export interface FaceDeformParams {
  /** Whole-face X scale (0.85..1.15). */
  width?: number;
  /** Whole-face Y scale (0.9..1.1). */
  height?: number;
  /** Whole-face Z scale (0.9..1.1); < 1 flattens the face. */
  depth?: number;
  /** Nose-ridge Z shift in mm (−4..+4), Gaussian across the ridge. */
  noseBridge?: number;
  /** Cheekbone outward (X) and forward (Z) shift in mm (0..+5). */
  cheekbone?: number;
  /** Brow Z shift in mm (−2..+3). */
  brow?: number;
  /** Skull width: X shift of the |x| > 55 band in mm (−6..+6). */
  templeWidth?: number;
}

export interface FaceVariant {
  name: string;
  params: FaceDeformParams;
}

const FLAT: FaceDeformParams = { depth: 0.92, noseBridge: -4, cheekbone: 3 };

/** The 14 named variants of spec §4.4. */
export const FACE_VARIANTS: FaceVariant[] = [
  { name: 'canonical', params: {} },
  { name: 'narrow', params: { width: 0.85 } },
  { name: 'wide', params: { width: 1.15 } },
  { name: 'long', params: { height: 1.1 } },
  { name: 'short', params: { height: 0.9 } },
  { name: 'flat', params: { ...FLAT } },
  { name: 'high_nose', params: { noseBridge: 4 } },
  { name: 'high_cheek', params: { cheekbone: 5 } },
  { name: 'heavy_brow', params: { brow: 3 } },
  { name: 'wide_temples', params: { templeWidth: 6 } },
  { name: 'narrow_temples', params: { templeWidth: -6 } },
  { name: 'wide_flat', params: { width: 1.15, ...FLAT } },
  { name: 'narrow_high', params: { width: 0.85, noseBridge: 4 } },
  { name: 'extreme', params: { width: 1.15, depth: 0.92, noseBridge: -4, cheekbone: 5, templeWidth: 6 } },
];

/** Gaussian skirt width outside a region (mm). */
export const SKIRT_SIGMA_MM = 8;

/** Distance from `v` to the interval [lo, hi] (0 inside). */
const gap = (v: number, lo: number, hi: number): number => (v < lo ? lo - v : v > hi ? v - hi : 0);

/** 1 inside the box, exp(−d²/2σ²) outside, where d is the distance to the box. */
const softBox = (dx: number, dy: number, dz: number, sigma = SKIRT_SIGMA_MM): number =>
  Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * sigma * sigma));

/** Applies the deformation to the canonical model; returns 468×3 face-local mm. */
export function deformCanonical(params: FaceDeformParams): Float32Array {
  const out = new Float32Array(CANONICAL_VERTICES_MM);
  const noseBridge = params.noseBridge ?? 0;
  const cheekbone = params.cheekbone ?? 0;
  const brow = params.brow ?? 0;
  const templeWidth = params.templeWidth ?? 0;
  const width = params.width ?? 1;
  const height = params.height ?? 1;
  const depth = params.depth ?? 1;

  for (let i = 0; i < CANONICAL_VERTEX_COUNT; i++) {
    const x = out[i * 3], y = out[i * 3 + 1], z = out[i * 3 + 2];
    const ax = Math.abs(x);
    const sign = x < 0 ? -1 : 1;
    let dx = 0, dy = 0, dz = 0;

    if (noseBridge) {
      // Ridge region |x| < 25, y ∈ [−20, 45]; falls off with the distance from the ridge line.
      const w = softBox(gap(ax, 0, 25), gap(y, -20, 45), 0) * Math.exp(-(x * x) / (2 * 10 * 10));
      dz += noseBridge * w;
    }
    if (cheekbone) {
      // Cheekbone region 30 < |x| < 70, y ∈ [−15, 25]: outward and forward.
      const w = softBox(gap(ax, 30, 70), gap(y, -15, 25), 0);
      dx += sign * cheekbone * w;
      dz += cheekbone * w;
    }
    if (brow) {
      // Brow region y ∈ [35, 60], z > 35.
      const w = softBox(0, gap(y, 35, 60), gap(z, 35, Infinity));
      dz += brow * w;
    }
    if (templeWidth) {
      // Skull band |x| > 55.
      const w = softBox(gap(ax, 55, Infinity), 0, 0);
      dx += sign * templeWidth * w;
    }

    out[i * 3] = (x + dx) * width;
    out[i * 3 + 1] = (y + dy) * height;
    out[i * 3 + 2] = (z + dz) * depth;
  }
  return out;
}
