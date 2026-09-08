// Lens outlines and 2-D polygon helpers shared by the mock API (scripts/lib/frame-defs.mjs →
// assets.anchor.rim_outline_mm), the procedural fallback (frame-geometry.mjs) and, as a
// reference for scripts/blender/frame_builder.py which ports the same functions.
//
// All outlines are for the +X lens in its own centred coordinates (mm, +x outward toward the
// temple, +y up), closed, counter-clockwise, and boxed exactly to width × height.

/** Removes consecutive duplicates (and a duplicated closing point). */
export function dedupe(pts, eps = 1e-6) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(p[0] - last[0]) > eps || Math.abs(p[1] - last[1]) > eps) out.push([p[0], p[1]]);
  }
  if (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < eps && Math.abs(out[0][1] - out[out.length - 1][1]) < eps) out.pop();
  return out;
}

/** Signed area (> 0 for counter-clockwise). */
export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/**
 * Rounds the corners of a convex polygon: each corner is replaced by a circular arc of the
 * given radius tangent to both adjacent edges (radius reduced when the edges are too short).
 */
export function filletPolygon(corners, radii, nCorner = 8) {
  const n = corners.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const P = corners[i], A = corners[(i + n - 1) % n], B = corners[(i + 1) % n];
    const ua = [A[0] - P[0], A[1] - P[1]], ub = [B[0] - P[0], B[1] - P[1]];
    const la = Math.hypot(ua[0], ua[1]), lb = Math.hypot(ub[0], ub[1]);
    const u = [ua[0] / la, ua[1] / la], v = [ub[0] / lb, ub[1] / lb];
    const r = radii[i] ?? 0;
    if (r <= 1e-6) { pts.push([P[0], P[1]]); continue; }
    const theta = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
    const d = Math.min(r / Math.tan(theta / 2), la * 0.5, lb * 0.5);
    const rEff = d * Math.tan(theta / 2);
    const T1 = [P[0] + u[0] * d, P[1] + u[1] * d], T2 = [P[0] + v[0] * d, P[1] + v[1] * d];
    const bx = u[0] + v[0], by = u[1] + v[1], bl = Math.hypot(bx, by);
    const C = [P[0] + (bx / bl) * (rEff / Math.sin(theta / 2)), P[1] + (by / bl) * (rEff / Math.sin(theta / 2))];
    const a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
    let da = Math.atan2(T2[1] - C[1], T2[0] - C[0]) - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let k = 0; k <= nCorner; k++) {
      const a = a1 + (da * k) / nCorner;
      pts.push([C[0] + rEff * Math.cos(a), C[1] + rEff * Math.sin(a)]);
    }
  }
  return dedupe(pts);
}

/** Scales/centres a closed outline so its bounding box is exactly w × h around the origin. */
export function normalizeBox(pts, w, h) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const sx = w / (maxX - minX), sy = h / (maxY - minY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return pts.map(([x, y]) => [(x - cx) * sx, (y - cy) * sy]);
}

/** Offsets a closed CCW outline outward; `dist` is a number or a function (x, y) → mm. */
export function offsetClosed(pts, dist) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[(i + n - 1) % n], [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    const l0 = Math.hypot(x1 - x0, y1 - y0) || 1, l1 = Math.hypot(x2 - x1, y2 - y1) || 1;
    // Outward normals of a CCW polygon: (dy, −dx).
    const n0 = [(y1 - y0) / l0, -(x1 - x0) / l0], n1 = [(y2 - y1) / l1, -(x2 - x1) / l1];
    let bx = n0[0] + n1[0], by = n0[1] + n1[1];
    let bl = Math.hypot(bx, by);
    if (bl < 1e-6) { bx = n1[0]; by = n1[1]; bl = 1; }
    bx /= bl; by /= bl;
    const cosHalf = Math.max(0.3, bx * n1[0] + by * n1[1]);
    const d = typeof dist === 'function' ? dist(x1, y1) : dist;
    out.push([x1 + (bx * d) / cosHalf, y1 + (by * d) / cosHalf]);
  }
  return out;
}

/** `n` points spaced evenly along a closed polyline. */
export function resampleClosed(pts, n) {
  const m = pts.length;
  const seg = [];
  let total = 0;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % m];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg.push(d);
    total += d;
  }
  const out = [];
  let i = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (k * total) / n;
    while (acc + seg[i] < target - 1e-9) { acc += seg[i]; i = (i + 1) % m; }
    const t = seg[i] === 0 ? 0 : (target - acc) / seg[i];
    const a = pts[i], b = pts[(i + 1) % m];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

const bezier = (p0, p1, p2, p3, n) => {
  const out = [];
  for (let k = 0; k < n; k++) {
    const t = k / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
};

/**
 * Lens outline for a shape. `build` may carry, for 'wellington':
 *   corner_radius_mm [top_outer, top_inner, bottom_inner, bottom_outer] (default [4, 6, 11, 9])
 *   inner_slant_mm   how far the nasal edge moves outward from top to bottom (default 3.5)
 *   outer_slant_mm   how far the temporal edge moves inward from top to bottom (default 1.5)
 * @param {'square'|'round'|'aviator'|'wellington'} shape
 * @returns {[number, number][]} closed CCW outline centred on the lens box
 */
export function lensOutline(shape, w, h, build = {}) {
  const hw = w / 2, hh = h / 2;
  if (shape === 'round') {
    const n = 96;
    return Array.from({ length: n }, (_, k) => [hw * Math.cos((2 * Math.PI * k) / n), hh * Math.sin((2 * Math.PI * k) / n)]);
  }
  if (shape === 'aviator') {
    const n = 28;
    let pts = [
      ...bezier([-hw, hh * 0.55], [-hw, hh], [-hw * 0.3, hh], [0, hh], n),
      ...bezier([0, hh], [hw * 0.6, hh], [hw, hh * 0.7], [hw, hh * 0.2], n),
      ...bezier([hw, hh * 0.2], [hw, -hh * 0.5], [hw * 0.55, -hh], [0, -hh], n),
      ...bezier([0, -hh], [-hw * 0.7, -hh], [-hw, -hh * 0.4], [-hw, hh * 0.55], n),
    ];
    pts = dedupe(pts);
    return normalizeBox(signedArea(pts) > 0 ? pts : pts.reverse(), w, h);
  }
  if (shape === 'wellington') {
    const [rTO, rTI, rBI, rBO] = build.corner_radius_mm ?? [4, 6, 11, 9];
    const sIn = build.inner_slant_mm ?? 3.5, sOut = build.outer_slant_mm ?? 1.5;
    // CCW: top-outer → top-inner → bottom-inner → bottom-outer.
    const corners = [[hw, hh], [-hw, hh], [-hw + sIn, -hh], [hw - sOut, -hh]];
    return normalizeBox(filletPolygon(corners, [rTO, rTI, rBI, rBO], 8), w, h);
  }
  // square: rounded rectangle, larger radius at the bottom.
  const r = Math.min(9, w * 0.17), rb = Math.min(12, w * 0.22);
  return normalizeBox(filletPolygon([[hw, hh], [-hw, hh], [-hw, -hh], [hw, -hh]], [r, r, rb, rb], 6), w, h);
}

/** Rim width at lens-local height y: linear from the bottom width to the top width. */
export const rimWidthAt = (y, hh, top, bottom = top) => bottom + (top - bottom) * ((y + hh) / (2 * hh));

/**
 * Outer boundary of the +X rim in frame coordinates (mm): the lens outline offset by the
 * (height-dependent) rim width, translated to the lens centre, resampled to `n` points.
 */
export function rimOuterOutline(def, n = 48) {
  const { lens_width_mm: lw, bridge_mm: b, lens_height_mm: lh } = def.spec;
  const build = def.build ?? {};
  const top = build.rim_width_mm ?? 4, bottom = build.rim_width_bottom_mm ?? top;
  const hh = lh / 2;
  const cx = b / 2 + lw / 2, cy = build.lens_center_y_mm ?? -3;
  const outline = lensOutline(def.shape, lw, lh, build);
  const outer = offsetClosed(outline, (_x, y) => rimWidthAt(y, hh, top, bottom));
  return resampleClosed(outer, n).map(([x, y]) => [Math.round((x + cx) * 100) / 100, Math.round((y + cy) * 100) / 100]);
}
