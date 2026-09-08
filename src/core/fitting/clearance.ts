/**
 * Face clearance solver (spec §4.3). Keeps the temples, rims and nose pads out of
 * the user's face with two degrees of freedom — an outward temple splay about each
 * hinge and a forward (+Z) push of the whole frame — and reports the residual
 * penetration per region so the HUD and the bench can see what is left.
 *
 * Everything is in the face-local frame (mm): +X = image-right (the "R" side; "L" is
 * −X as everywhere in the core), +Y up, +Z toward the camera; temples run toward −Z.
 *
 * Regions are computed from CANONICAL_VERTICES_MM at module load with geometric
 * predicates (no hand-typed index lists). The solver reads those indices out of the
 * *user's* face-local points (screen-exact xy, canonical depth), so a wider or taller
 * face moves the probes to where the real face is.
 *
 * Temple: over the side band at arm height (|p.y − armY(p.z)| ≤ 15 mm, at least 3 mm
 * behind the hinge) the arm centreline must clear each vertex by templeMm:
 *   tan θ ≥ (sign·(p.x − hingeX) + templeMm) / (hingeZ − p.z),   0 ≤ θ ≤ maxSplayDeg.
 * The arm height follows the temple profile: hinge height until temple_bend_mm, then a
 * linear drop of temple_drop_mm to the tip at temple_mm — evaluated after the tilt.
 *
 * Rims and pads: probes on the rim back face (24 points along the rounded-rectangle
 * outline of each lens at z = lens_plane − rim_depth) and at the nose-pad centres are
 * compared with the region heightfield z(x, y) (3 nearest region vertices in xy,
 * inverse-distance weighted): push = max(z_face − z_probe + margin) with margin = rimMm
 * for rims and −padSinkMm for pads, clamped to 0..maxForwardMm and added to the anchor z.
 *
 * `penetration` is measured after the correction and without the safety margins:
 * positive means the arm centreline / rim back face is inside the face surface (for
 * pads: sunk deeper than padSinkMm). A healthy fit has all four ≤ 0; a region with no
 * probe in reach reports −Infinity.
 */
import { CANONICAL_VERTEX_COUNT, CANONICAL_VERTICES_MM } from './canonical';
import type { GlassesScale } from './anchorSolver';
import type { Vec3 } from '../math/vec3';
import type { AssetAnchor, ClearanceConfig, ClearanceResult, FrameSpec } from '../types';

export interface HingeGeometry {
  /** Hinge half-width (mm) from the GLB origin, i.e. |temple_x|. */
  halfWidth: number;
  /** Hinge height and depth in GLB coordinates (mm). */
  y: number;
  z: number;
}

export interface ClearanceInput {
  /** ≥ 468 × 3 face-local points (mm). */
  verticesLocal: ArrayLike<number>;
  /** Nose-landing anchor (face-local, before the forward push). */
  anchorLocal: Vec3;
  spec: FrameSpec;
  hinge: HingeGeometry;
  asset?: AssetAnchor | null;
  scale?: GlassesScale;
  tiltDeg?: number;
  cfg: ClearanceConfig;
}

// ---- asset metadata defaults (spec §4.3) ------------------------------------
export const DEFAULT_LENS_PLANE_MM = 4;
export const DEFAULT_RIM_DEPTH_MM = 4;
export const DEFAULT_TEMPLE_BEND_RATIO = 0.68;
export const DEFAULT_TEMPLE_DROP_MM = 28;
export const DEFAULT_NOSE_PAD_OFFSET: Vec3 = [0, -4, -2];

// ---- solver constants ---------------------------------------------------------
/** Half-height of the band around the arm in which side vertices constrain the splay (mm). */
export const TEMPLE_WINDOW_MM = 15;
/** Vertices closer than this to the hinge plane do not constrain the splay (mm). */
export const MIN_HINGE_DEPTH_MM = 3;
export const RIM_PROBES_PER_LENS = 24;
/** Lens centre height below the bridge origin (mm), matching the frame builder. */
export const LENS_CENTER_Y_MM = -3;
/** Lens corner radius as a fraction of the lens height. */
export const LENS_CORNER_RATIO = 0.25;
/** A probe farther than this (xy) from the nearest region vertex is not over that region. */
export const REGION_REACH_MM = 12;
/** Extra X offset of adjustable pads beyond bridge/2 (mm). */
export const ADJUSTABLE_PAD_X_MM = 2;

// ---- regions (computed once from the canonical geometry) -----------------------
const selectVertices = (pred: (x: number, y: number, z: number) => boolean): number[] => {
  const out: number[] = [];
  for (let i = 0; i < CANONICAL_VERTEX_COUNT; i++) {
    if (pred(CANONICAL_VERTICES_MM[i * 3], CANONICAL_VERTICES_MM[i * 3 + 1], CANONICAL_VERTICES_MM[i * 3 + 2])) out.push(i);
  }
  return out;
};

/** Side of the head where the arm passes (|x| > 50, y ∈ [−5, 65]). */
export const SIDE_L: readonly number[] = selectVertices((x, y) => x < -50 && y >= -5 && y <= 65);
export const SIDE_R: readonly number[] = selectVertices((x, y) => x > 50 && y >= -5 && y <= 65);
/** Nose flanks (2 < |x| < 22, z > 45, y ∈ [−15, 35]). */
export const NOSE_L: readonly number[] = selectVertices((x, y, z) => x < -2 && x > -22 && z > 45 && y >= -15 && y <= 35);
export const NOSE_R: readonly number[] = selectVertices((x, y, z) => x > 2 && x < 22 && z > 45 && y >= -15 && y <= 35);
/** Brow (|x| < 60, y ∈ [35, 62], z > 40). */
export const BROW: readonly number[] = selectVertices((x, y, z) => Math.abs(x) < 60 && y >= 35 && y <= 62 && z > 40);
/** Cheeks (18 < |x| < 66, y ∈ [−30, 15], z > 25). */
export const CHEEK_L: readonly number[] = selectVertices((x, y, z) => x < -18 && x > -66 && y >= -30 && y <= 15 && z > 25);
export const CHEEK_R: readonly number[] = selectVertices((x, y, z) => x > 18 && x < 66 && y >= -30 && y <= 15 && z > 25);

export const CLEARANCE_REGIONS = { SIDE_L, SIDE_R, NOSE_L, NOSE_R, BROW, CHEEK_L, CHEEK_R } as const;

// ---- geometry helpers ------------------------------------------------------------
interface Placement {
  bridge: Vec3;
  sx: number;
  sy: number;
  cos: number;
  sin: number;
  anchor: Vec3;
}

const placementOf = (asset: AssetAnchor | null | undefined, scale: GlassesScale, tiltDeg: number, anchor: Vec3): Placement => {
  const rad = (tiltDeg * Math.PI) / 180;
  return { bridge: asset?.bridge ?? [0, 0, 0], sx: scale.uniform * scale.width, sy: scale.uniform, cos: Math.cos(rad), sin: Math.sin(rad), anchor };
};

/** GLB-local point → face-local: T(anchor) · Rx(tilt) · S(scale) · T(−bridge). */
const toFaceLocal = (pl: Placement, p: Vec3): Vec3 => {
  const x = (p[0] - pl.bridge[0]) * pl.sx;
  const y = (p[1] - pl.bridge[1]) * pl.sy;
  const z = (p[2] - pl.bridge[2]) * pl.sy;
  return [pl.anchor[0] + x, pl.anchor[1] + y * pl.cos - z * pl.sin, pl.anchor[2] + y * pl.sin + z * pl.cos];
};

/** `n` points spaced evenly along the outline of a rounded rectangle (centre, half extents, corner radius). */
export function roundedRectOutline(cx: number, cy: number, hw: number, hh: number, r: number, n: number): [number, number][] {
  r = Math.max(0, Math.min(r, hw, hh));
  const sw = 2 * (hw - r), sh = 2 * (hh - r), arc = (Math.PI * r) / 2;
  type Seg = { len: number; at: (t: number) => [number, number] };
  const arcSeg = (ox: number, oy: number, a0: number): Seg => ({
    len: arc,
    at: (t) => [ox + r * Math.cos(a0 + (t * Math.PI) / 2), oy + r * Math.sin(a0 + (t * Math.PI) / 2)],
  });
  const segs: Seg[] = [
    { len: sh, at: (t) => [cx + hw, cy - (hh - r) + sh * t] },
    arcSeg(cx + hw - r, cy + hh - r, 0),
    { len: sw, at: (t) => [cx + hw - r - sw * t, cy + hh] },
    arcSeg(cx - hw + r, cy + hh - r, Math.PI / 2),
    { len: sh, at: (t) => [cx - hw, cy + hh - r - sh * t] },
    arcSeg(cx - hw + r, cy - hh + r, Math.PI),
    { len: sw, at: (t) => [cx - hw + r + sw * t, cy - hh] },
    arcSeg(cx + hw - r, cy - hh + r, (3 * Math.PI) / 2),
  ];
  const total = segs.reduce((s, g) => s + g.len, 0);
  const out: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    let d = (k * total) / n;
    for (const g of segs) {
      if (d <= g.len || g === segs[segs.length - 1]) {
        out.push(g.at(g.len > 0 ? Math.min(1, d / g.len) : 0));
        break;
      }
      d -= g.len;
    }
  }
  return out;
}

/**
 * Rim back-face probes in face-local mm: the rounded-rectangle outline of each lens
 * (centre x = ±(bridge/2 + lens_width/2), y = LENS_CENTER_Y_MM, corner radius
 * 0.25·lens_height) at z = lens_plane − rim_depth, then tilted, scaled and anchored.
 */
export function rimProbes(spec: FrameSpec, asset: AssetAnchor | null | undefined, anchorLocal: Vec3, scale: GlassesScale, tiltDeg: number): Vec3[] {
  const pl = placementOf(asset, scale, tiltDeg, anchorLocal);
  const zr = (asset?.lens_plane_mm ?? DEFAULT_LENS_PLANE_MM) - (asset?.rim_depth_mm ?? DEFAULT_RIM_DEPTH_MM);
  const hw = spec.lens_width_mm / 2, hh = spec.lens_height_mm / 2;
  const cx = spec.bridge_mm / 2 + hw;
  const out: Vec3[] = [];
  for (const sign of [-1, 1]) {
    for (const [x, y] of roundedRectOutline(sign * cx, LENS_CENTER_Y_MM, hw, hh, LENS_CORNER_RATIO * spec.lens_height_mm, RIM_PROBES_PER_LENS)) {
      out.push(toFaceLocal(pl, [x, y, zr]));
    }
  }
  return out;
}

/** Nose-pad centre probes in face-local mm (x = ±bridge/2, +2 mm for adjustable pads). */
export function padProbes(spec: FrameSpec, asset: AssetAnchor | null | undefined, anchorLocal: Vec3, scale: GlassesScale, tiltDeg: number): Vec3[] {
  const pl = placementOf(asset, scale, tiltDeg, anchorLocal);
  const off = asset?.nose_pad_offset ?? DEFAULT_NOSE_PAD_OFFSET;
  const px = spec.bridge_mm / 2 + (spec.nose_pad === 'adjustable' ? ADJUSTABLE_PAD_X_MM : 0);
  return [toFaceLocal(pl, [-px, off[1], off[2]]), toFaceLocal(pl, [px, off[1], off[2]])];
}

/**
 * Temple arm centreline (splay 0) as a 3-point polyline in face-local mm: hinge,
 * bend start, tip. The arm keeps the hinge height until temple_bend_mm and then drops
 * temple_drop_mm linearly to the tip.
 */
export function templeArm(sign: -1 | 1, spec: FrameSpec, hinge: HingeGeometry, asset: AssetAnchor | null | undefined, anchorLocal: Vec3, scale: GlassesScale, tiltDeg: number): [Vec3, Vec3, Vec3] {
  const pl = placementOf(asset, scale, tiltDeg, anchorLocal);
  const tl = spec.temple_mm;
  const bend = Math.min(tl, asset?.temple_bend_mm ?? DEFAULT_TEMPLE_BEND_RATIO * tl);
  const drop = asset?.temple_drop_mm ?? DEFAULT_TEMPLE_DROP_MM;
  const x = sign * hinge.halfWidth;
  return [
    toFaceLocal(pl, [x, hinge.y, hinge.z]),
    toFaceLocal(pl, [x, hinge.y, hinge.z - bend]),
    toFaceLocal(pl, [x, hinge.y - drop, hinge.z - tl]),
  ];
}

/** Arm height at depth z along the polyline (clamped to its ends). */
export function armHeightAt(arm: readonly Vec3[], z: number): number {
  if (z >= arm[0][2]) return arm[0][1];
  for (let k = 0; k < arm.length - 1; k++) {
    const a = arm[k], b = arm[k + 1];
    if (z >= b[2]) {
      const t = a[2] === b[2] ? 0 : (a[2] - z) / (a[2] - b[2]);
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  return arm[arm.length - 1][1];
}

/**
 * Face surface height z(x, y) from the 3 nearest region vertices in xy (inverse-distance
 * weighted), or null when the nearest vertex is farther than `reach`.
 */
export function heightAt(V: ArrayLike<number>, region: readonly number[], x: number, y: number, reach = REGION_REACH_MM): number | null {
  let d0 = Infinity, d1 = Infinity, d2 = Infinity;
  let z0 = 0, z1 = 0, z2 = 0;
  for (const i of region) {
    const dx = V[i * 3] - x, dy = V[i * 3 + 1] - y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const z = V[i * 3 + 2];
    if (d < d0) { d2 = d1; z2 = z1; d1 = d0; z1 = z0; d0 = d; z0 = z; }
    else if (d < d1) { d2 = d1; z2 = z1; d1 = d; z1 = z; }
    else if (d < d2) { d2 = d; z2 = z; }
  }
  if (d0 > reach) return null;
  const eps = 1e-3;
  const w0 = 1 / (d0 + eps), w1 = Number.isFinite(d1) ? 1 / (d1 + eps) : 0, w2 = Number.isFinite(d2) ? 1 / (d2 + eps) : 0;
  return (z0 * w0 + z1 * w1 + z2 * w2) / (w0 + w1 + w2);
}

// ---- solver -----------------------------------------------------------------------
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface SideConstraint {
  /** sign·(p.x − hingeX): how far the vertex sits outside the hinge (mm). */
  lateral: number;
  /** hingeZ − p.z (mm). */
  depth: number;
}

const sideConstraints = (V: ArrayLike<number>, band: readonly number[], arm: readonly Vec3[]): SideConstraint[] => {
  const [hingeX, , hingeZ] = arm[0];
  const sign = hingeX < 0 ? -1 : 1;
  const out: SideConstraint[] = [];
  for (const i of band) {
    const x = V[i * 3], y = V[i * 3 + 1], z = V[i * 3 + 2];
    const depth = hingeZ - z;
    if (depth < MIN_HINGE_DEPTH_MM) continue;
    if (Math.abs(y - armHeightAt(arm, z)) > TEMPLE_WINDOW_MM) continue;
    out.push({ lateral: sign * (x - hingeX), depth });
  }
  return out;
};

const solveSide = (cons: SideConstraint[], cfg: ClearanceConfig): { splay: number; penetration: number } => {
  let tan = 0;
  for (const c of cons) tan = Math.max(tan, (c.lateral + cfg.templeMm) / c.depth);
  const splay = clamp(Math.atan(tan), 0, (cfg.maxSplayDeg * Math.PI) / 180);
  const t = Math.tan(splay);
  let penetration = -Infinity;
  for (const c of cons) penetration = Math.max(penetration, c.lateral - c.depth * t);
  return { splay, penetration };
};

export function solveClearance(input: ClearanceInput): ClearanceResult {
  const { verticesLocal: V, spec, hinge, cfg } = input;
  const asset = input.asset ?? null;
  const scale = input.scale ?? { uniform: 1, width: 1 };
  const tiltDeg = input.tiltDeg ?? 0;
  const anchor0 = input.anchorLocal;

  // 1. Forward push from the rim back face and the pad centres against the front heightfields.
  const rims = rimProbes(spec, asset, anchor0, scale, tiltDeg);
  const pads = padProbes(spec, asset, anchor0, scale, tiltDeg);
  type Hit = { gap: number };
  const brow: Hit[] = [], cheek: Hit[] = [], nose: Hit[] = [];
  let push = 0;
  for (const p of rims) {
    const cheekRegion = p[0] < 0 ? CHEEK_L : CHEEK_R;
    const noseRegion = p[0] < 0 ? NOSE_L : NOSE_R;
    for (const [region, hits] of [[BROW, brow], [cheekRegion, cheek], [noseRegion, nose]] as const) {
      const zf = heightAt(V, region, p[0], p[1]);
      if (zf === null) continue;
      const gap = zf - p[2];
      hits.push({ gap });
      push = Math.max(push, gap + cfg.rimMm);
    }
  }
  const padHits: Hit[] = [];
  for (const p of pads) {
    const zf = heightAt(V, p[0] < 0 ? NOSE_L : NOSE_R, p[0], p[1]);
    if (zf === null) continue;
    const gap = zf - p[2] - cfg.padSinkMm;
    padHits.push({ gap });
    push = Math.max(push, gap);
  }
  const forwardMm = clamp(push, 0, cfg.maxForwardMm);
  const residual = (hits: Hit[]) => hits.reduce((m, h) => Math.max(m, h.gap - forwardMm), -Infinity);

  // 2. Temple splay about the pushed hinge position.
  const anchor: Vec3 = [anchor0[0], anchor0[1], anchor0[2] + forwardMm];
  const left = solveSide(sideConstraints(V, SIDE_L, templeArm(-1, spec, hinge, asset, anchor, scale, tiltDeg)), cfg);
  const right = solveSide(sideConstraints(V, SIDE_R, templeArm(1, spec, hinge, asset, anchor, scale, tiltDeg)), cfg);

  return {
    splay: { left: left.splay, right: right.splay },
    forwardMm,
    penetration: {
      temple: Math.max(left.penetration, right.penetration),
      brow: residual(brow),
      cheek: residual(cheek),
      nose: Math.max(residual(nose), residual(padHits)),
    },
  };
}
