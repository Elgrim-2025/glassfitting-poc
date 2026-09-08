/**
 * Face-surface height fields z(x, y) in the face-local frame, evaluated on the
 * *user's* metric points over the canonical triangulation. Regions are triangle sets
 * chosen once from the canonical geometry (a triangle belongs to a region when all
 * three of its vertices satisfy the region predicate), so the same code reads the
 * canonical depth, the MediaPipe landmark depth or the hybrid without change.
 *
 * Coordinates: mm, +X image-right, +Y up, +Z toward the camera. A probe ray runs along
 * −Z and the frontmost hit is returned.
 */
import { CANONICAL_TRIANGLES, CANONICAL_VERTICES_MM } from './canonical';

export type RegionPredicate = (x: number, y: number, z: number) => boolean;

/** Flat (a, b, c, a, b, c, …) triangle indices of the canonical mesh satisfying `pred` at all vertices. */
export function regionTriangles(pred: RegionPredicate): Uint16Array {
  const ok = new Uint8Array(CANONICAL_VERTICES_MM.length / 3);
  for (let i = 0; i < ok.length; i++) {
    ok[i] = pred(CANONICAL_VERTICES_MM[i * 3], CANONICAL_VERTICES_MM[i * 3 + 1], CANONICAL_VERTICES_MM[i * 3 + 2]) ? 1 : 0;
  }
  const out: number[] = [];
  for (let t = 0; t < CANONICAL_TRIANGLES.length; t += 3) {
    const a = CANONICAL_TRIANGLES[t], b = CANONICAL_TRIANGLES[t + 1], c = CANONICAL_TRIANGLES[t + 2];
    if (ok[a] && ok[b] && ok[c]) out.push(a, b, c);
  }
  return Uint16Array.from(out);
}

/** Whole nose incl. the ridge and the alar base (|x| < 24, y ∈ [−20, 40], z > 44). */
export const NOSE_TRIS = regionTriangles((x, y, z) => Math.abs(x) < 24 && y >= -20 && y <= 40 && z > 44);
/** Brow across the midline (|x| < 62, y ∈ [32, 66], z > 36). */
export const BROW_TRIS = regionTriangles((x, y, z) => Math.abs(x) < 62 && y >= 32 && y <= 66 && z > 36);
/** Cheeks (16 < |x| < 68, y ∈ [−34, 18], z > 22). */
export const CHEEK_L_TRIS = regionTriangles((x, y, z) => x < -16 && x > -68 && y >= -34 && y <= 18 && z > 22);
export const CHEEK_R_TRIS = regionTriangles((x, y, z) => x > 16 && x < 68 && y >= -34 && y <= 18 && z > 22);

/**
 * Surface z at (x, y): barycentric interpolation of the frontmost region triangle that
 * contains (x, y) in projection, or null when no triangle covers the point.
 * @param V ≥ 468 × 3 face-local points (mm) — the user's metric points.
 */
export function surfaceZ(V: ArrayLike<number>, tris: ArrayLike<number>, x: number, y: number): number | null {
  let best: number | null = null;
  const eps = -1e-6;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ax = V[a], ay = V[a + 1], bx = V[b], by = V[b + 1], cx = V[c], cy = V[c + 1];
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
    if (l1 < eps) continue;
    const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
    if (l2 < eps) continue;
    const l3 = 1 - l1 - l2;
    if (l3 < eps) continue;
    const z = l1 * V[a + 2] + l2 * V[b + 2] + l3 * V[c + 2];
    if (best === null || z > best) best = z;
  }
  return best;
}
