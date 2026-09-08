/**
 * Face clearance solver (spec §4.3). Keeps the temples, rims, bridge bar and nose pads
 * out of the user's face with two degrees of freedom — an outward temple splay about
 * each hinge and a forward (+Z) push of the whole frame — and reports the residual
 * penetration per region, the resulting vertex distance and the pad gap so the HUD and
 * the bench can see what is left.
 *
 * Everything is in the face-local frame (mm): +X = image-right (the "R" side; "L" is
 * −X as everywhere in the core), +Y up, +Z toward the camera; temples run toward −Z.
 *
 * Face surfaces are the region height fields of `faceSurface.ts` (canonical triangles
 * over the user's points), so a wider, taller or flatter face moves the probes to where
 * the real face is.
 *
 * Temple: over the side band at arm height (|p.y − armY(p.z)| ≤ 15 mm, at least 3 mm
 * behind the hinge) the arm centreline must clear each vertex by templeMm:
 *   tan θ ≥ (sign·(p.x − hingeX) + templeMm) / (hingeZ − p.z),   0 ≤ θ ≤ maxSplayDeg.
 * The arm height follows the temple profile: hinge height until temple_bend_mm, then a
 * linear drop of temple_drop_mm to the tip at temple_mm — evaluated after the tilt.
 *
 * Forward push: probes on the rim back face (the product's rim outline, 24 points per
 * lens, or a rounded rectangle grown by the rim width when the asset has no outline),
 * on the bridge bar and at the pad contact faces are compared with the brow, cheek and
 * nose height fields:
 *   rims vs brow/cheek: push ≥ z_face − z_probe + rimMm
 *   rims vs nose:       push ≥ z_face − z_probe + rimMm − noseSinkMm   (the inner rim may sink a little)
 *   bridge bar vs nose: push ≥ z_face − z_probe + bridgeMm
 *   pads vs nose:       push ≥ z_face − z_probe − padSinkMm
 * The push is then clamped so that the vertex distance (lens back → corneal apex, from
 * the eyelid landmarks) stays within [vertexMinMm, vertexMaxMm] and |push| ≤ maxForwardMm.
 * `penetration` is measured after the correction, beyond the allowances (padSinkMm,
 * noseSinkMm) and without the safety margins: positive means a part is still inside the
 * face surface. A healthy fit has all four ≤ 0; a region with no probe in reach reports −Infinity.
 */
import type { GlassesScale } from './anchorSolver';
import { BROW_TRIS, CHEEK_L_TRIS, CHEEK_R_TRIS, NOSE_TRIS, surfaceZ } from './faceSurface';
import { CANONICAL_VERTEX_COUNT, CANONICAL_VERTICES_MM } from './canonical';
import { padContactPoint } from './noseLanding';
import type { Vec3 } from '../math/vec3';
import type { AssetAnchor, ClearanceConfig, ClearanceResult, FrameSpec } from '../types';

export { ADJUSTABLE_PAD_MIN_X_MM, padHalfSpacing } from './noseLanding';

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
  /** Required gap between the bridge bar and the nose ridge (mm, default 1). */
  bridgeMm?: number;
  cfg: ClearanceConfig;
}

// ---- asset metadata defaults (spec §4.3) ------------------------------------
export const DEFAULT_LENS_PLANE_MM = 4;
export const DEFAULT_RIM_DEPTH_MM = 4;
export const DEFAULT_RIM_WIDTH_MM = 4;
export const DEFAULT_TEMPLE_BEND_RATIO = 0.68;
export const DEFAULT_TEMPLE_DROP_MM = 28;
export const DEFAULT_NOSE_PAD_OFFSET: Vec3 = [0, -4, -2];
/** Lens back surface sits this far behind the lens plane by default (mm). */
export const DEFAULT_LENS_THICKNESS_MM = 1;

// ---- solver constants ---------------------------------------------------------
/** Half-height of the band around the arm in which side vertices constrain the splay (mm). */
export const TEMPLE_WINDOW_MM = 15;
/** Vertices closer than this to the hinge plane do not constrain the splay (mm). */
export const MIN_HINGE_DEPTH_MM = 3;
export const RIM_PROBES_PER_LENS = 24;
/** Lens centre height below the bridge origin (mm), matching the frame builder. */
export const LENS_CENTER_Y_MM = -3;
/** Lens corner radius as a fraction of the lens height (default outline only). */
export const LENS_CORNER_RATIO = 0.25;
/** A probe farther than this (xy) from the nearest region vertex is not over that region (heightAt only). */
export const REGION_REACH_MM = 12;
/** Corneal apex sits this far in front of the eyelid landmarks (mm). */
export const CORNEA_BULGE_MM = 1.5;
/** Eyelid landmarks whose mean depth locates the eye surface. */
export const EYELIDS: readonly number[] = [159, 145, 386, 374];

// ---- regions (vertex sets, computed once from the canonical geometry) --------------
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

/** `n` points spaced evenly along a closed polyline. */
export function resampleClosed(pts: readonly [number, number][], n: number): [number, number][] {
  const m = pts.length;
  if (m === 0) return [];
  const seg: number[] = [];
  let total = 0;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % m];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg.push(d);
    total += d;
  }
  if (total === 0) return Array.from({ length: n }, () => [pts[0][0], pts[0][1]]);
  const out: [number, number][] = [];
  let i = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (k * total) / n;
    while (acc + seg[i] < target - 1e-9) {
      acc += seg[i];
      i = (i + 1) % m;
    }
    const t = seg[i] === 0 ? 0 : (target - acc) / seg[i];
    const a = pts[i], b = pts[(i + 1) % m];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** Rim back-face z in frame coordinates (mm). */
export const rimBackZ = (asset: AssetAnchor | null | undefined): number =>
  asset?.rim_back_mm ?? (asset?.lens_plane_mm ?? DEFAULT_LENS_PLANE_MM) - (asset?.rim_depth_mm ?? DEFAULT_RIM_DEPTH_MM);

/** Lens back-surface z in frame coordinates (mm). */
export const lensBackZ = (asset: AssetAnchor | null | undefined): number =>
  asset?.lens_back_mm ?? (asset?.lens_plane_mm ?? DEFAULT_LENS_PLANE_MM) - DEFAULT_LENS_THICKNESS_MM;

/**
 * Rim back-face probes in face-local mm: the product's rim outline (+X lens, mirrored for
 * −X) when the asset carries one, otherwise the rounded-rectangle outline of each lens
 * (centre x = ±(bridge/2 + lens_width/2), y = LENS_CENTER_Y_MM, corner radius
 * 0.25·lens_height) grown outward by the rim width; at the rim back z, then tilted,
 * scaled and anchored.
 */
export function rimProbes(spec: FrameSpec, asset: AssetAnchor | null | undefined, anchorLocal: Vec3, scale: GlassesScale, tiltDeg: number): Vec3[] {
  const pl = placementOf(asset, scale, tiltDeg, anchorLocal);
  const zr = rimBackZ(asset);
  let outline: [number, number][];
  if (asset?.rim_outline_mm && asset.rim_outline_mm.length >= 3) {
    outline = resampleClosed(asset.rim_outline_mm, RIM_PROBES_PER_LENS);
  } else {
    const rw = asset?.rim_width_mm ?? DEFAULT_RIM_WIDTH_MM;
    const hw = spec.lens_width_mm / 2 + rw, hh = spec.lens_height_mm / 2 + rw;
    const cx = spec.bridge_mm / 2 + spec.lens_width_mm / 2;
    outline = roundedRectOutline(cx, LENS_CENTER_Y_MM, hw, hh, LENS_CORNER_RATIO * spec.lens_height_mm + rw, RIM_PROBES_PER_LENS);
  }
  const out: Vec3[] = [];
  for (const sign of [-1, 1]) for (const [x, y] of outline) out.push(toFaceLocal(pl, [sign * x, y, zr]));
  return out;
}

/** Bridge-bar probes: 5 points between the lenses at 30 % of the lens height, on the rim back face. */
export function bridgeProbes(spec: FrameSpec, asset: AssetAnchor | null | undefined, anchorLocal: Vec3, scale: GlassesScale, tiltDeg: number): Vec3[] {
  const pl = placementOf(asset, scale, tiltDeg, anchorLocal);
  const y = LENS_CENTER_Y_MM + 0.3 * spec.lens_height_mm;
  const z = rimBackZ(asset);
  const half = spec.bridge_mm / 2;
  const out: Vec3[] = [];
  for (let k = 0; k < 5; k++) out.push(toFaceLocal(pl, [-half + (2 * half * k) / 4, y, z]));
  return out;
}

/** Nose-pad contact probes in face-local mm (x = ±pad contact x). */
export function padProbes(spec: FrameSpec, asset: AssetAnchor | null | undefined, anchorLocal: Vec3, scale: GlassesScale, tiltDeg: number): Vec3[] {
  const pl = placementOf(asset, scale, tiltDeg, anchorLocal);
  const pad = padContactPoint(spec, asset);
  return [toFaceLocal(pl, [-pad[0], pad[1], pad[2]]), toFaceLocal(pl, [pad[0], pad[1], pad[2]])];
}

/**
 * Temple arm centreline (splay 0) as a 3-point polyline in face-local mm: hinge,
 * bend start, tip. The arm keeps the hinge height until temple_bend_mm and then drops
 * temple_drop_mm linearly to the tip.
 *
 * The pantoscopic tilt only moves the hinge: the arms themselves stay level along −Z
 * (the tilt is the angle between the front and the temples, as on a real frame). The
 * renderer counter-rotates the temple nodes by −tilt about the hinge to match.
 */
export function templeArm(sign: -1 | 1, spec: FrameSpec, hinge: HingeGeometry, asset: AssetAnchor | null | undefined, anchorLocal: Vec3, scale: GlassesScale, tiltDeg: number): [Vec3, Vec3, Vec3] {
  const pl = placementOf(asset, scale, tiltDeg, anchorLocal);
  const tl = spec.temple_mm;
  const bend = Math.min(tl, asset?.temple_bend_mm ?? DEFAULT_TEMPLE_BEND_RATIO * tl);
  const drop = asset?.temple_drop_mm ?? DEFAULT_TEMPLE_DROP_MM;
  const h = toFaceLocal(pl, [sign * hinge.halfWidth, hinge.y, hinge.z]);
  const s = pl.sy;
  return [h, [h[0], h[1], h[2] - bend * s], [h[0], h[1] - drop * s, h[2] - tl * s]];
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
 * weighted), or null when the nearest vertex is farther than `reach`. Kept for tools and
 * tests; the solver uses the triangle height fields of faceSurface.ts.
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

/** Corneal apex depth (face-local z) from the eyelid landmarks. */
export function corneaZ(V: ArrayLike<number>): number {
  let s = 0;
  for (const i of EYELIDS) s += V[i * 3 + 2];
  return s / EYELIDS.length + CORNEA_BULGE_MM;
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
  const bridgeMm = input.bridgeMm ?? 1;
  const anchor0 = input.anchorLocal;

  // 1. Forward push from the rim back face, the bridge bar and the pad contact faces.
  //    `gap` = how far the probe sits inside the face surface (mm), beyond its allowance.
  const brow: number[] = [], cheek: number[] = [], nose: number[] = [];
  let push = 0;
  for (const p of rimProbes(spec, asset, anchor0, scale, tiltDeg)) {
    const cheekTris = p[0] < 0 ? CHEEK_L_TRIS : CHEEK_R_TRIS;
    const zb = surfaceZ(V, BROW_TRIS, p[0], p[1]);
    if (zb !== null) { const g = zb - p[2]; brow.push(g); push = Math.max(push, g + cfg.rimMm); }
    const zc = surfaceZ(V, cheekTris, p[0], p[1]);
    if (zc !== null) { const g = zc - p[2]; cheek.push(g); push = Math.max(push, g + cfg.rimMm); }
    const zn = surfaceZ(V, NOSE_TRIS, p[0], p[1]);
    if (zn !== null) { const g = zn - p[2] - cfg.noseSinkMm; nose.push(g); push = Math.max(push, g + cfg.rimMm); }
  }
  for (const p of bridgeProbes(spec, asset, anchor0, scale, tiltDeg)) {
    const zn = surfaceZ(V, NOSE_TRIS, p[0], p[1]);
    if (zn !== null) { const g = zn - p[2]; nose.push(g); push = Math.max(push, g + bridgeMm); }
  }
  const pads = padProbes(spec, asset, anchor0, scale, tiltDeg);
  const padSurface: (number | null)[] = pads.map((p) => surfaceZ(V, NOSE_TRIS, p[0], p[1]));
  pads.forEach((p, k) => {
    const zf = padSurface[k];
    if (zf === null) return;
    const g = zf - p[2] - cfg.padSinkMm;
    nose.push(g);
    push = Math.max(push, g);
  });

  // 2. Vertex-distance clamp: lens back (tilted, scaled) → corneal apex within [min, max].
  const pl = placementOf(asset, scale, tiltDeg, anchor0);
  const lensBackOffset = LENS_CENTER_Y_MM * pl.sy * pl.sin + lensBackZ(asset) * pl.sy * pl.cos;
  const cornea = corneaZ(V);
  const zMin = cornea + cfg.vertexMinMm - lensBackOffset;
  const zMax = cornea + cfg.vertexMaxMm - lensBackOffset;
  let forward = Math.max(push, zMin - anchor0[2]);
  forward = Math.min(forward, zMax - anchor0[2]);
  forward = clamp(forward, -cfg.maxForwardMm, cfg.maxForwardMm);
  const residual = (gaps: number[]) => gaps.reduce((m, g) => Math.max(m, g - forward), -Infinity);
  const vertexMm = anchor0[2] + forward + lensBackOffset - cornea;
  let padGap = Infinity;
  pads.forEach((p, k) => {
    const zf = padSurface[k];
    if (zf !== null) padGap = Math.min(padGap, p[2] + forward - zf);
  });

  // 3. Temple splay about the pushed hinge position.
  const anchor: Vec3 = [anchor0[0], anchor0[1], anchor0[2] + forward];
  const left = solveSide(sideConstraints(V, SIDE_L, templeArm(-1, spec, hinge, asset, anchor, scale, tiltDeg)), cfg);
  const right = solveSide(sideConstraints(V, SIDE_R, templeArm(1, spec, hinge, asset, anchor, scale, tiltDeg)), cfg);

  return {
    splay: { left: left.splay, right: right.splay },
    forwardMm: forward,
    penetration: {
      temple: Math.max(left.penetration, right.penetration),
      brow: residual(brow),
      cheek: residual(cheek),
      nose: residual(nose),
    },
    vertexMm,
    padGapMm: padGap,
  };
}
