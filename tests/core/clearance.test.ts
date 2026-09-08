import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/core/config';
import { CANONICAL_VERTICES_MM } from '../../src/core/fitting/canonical';
import {
  BROW, CHEEK_L, CHEEK_R, NOSE_L, NOSE_R, SIDE_L, SIDE_R,
  rimProbes, solveClearance, type HingeGeometry,
} from '../../src/core/fitting/clearance';
import { FittingCore } from '../../src/core/fittingCore';
import { LM } from '../../src/core/landmarks';
import type { AssetAnchor, FrameSpec } from '../../src/core/types';
import { anchorFromDef, loadFrameDefs } from '../../scripts/lib/frame-defs.mjs';
import { deformCanonical, FACE_VARIANTS } from '../helpers/faceVariants';
import { makeSyntheticFrame, type SyntheticPose } from '../helpers/synthetic';

const d2r = Math.PI / 180;
const CFG = DEFAULT_CONFIG.placement.clearance;
const SPEC_138: FrameSpec = { lens_width_mm: 52, bridge_mm: 18, temple_mm: 140, lens_height_mm: 40, frame_width_mm: 138, nose_pad: 'fixed' };
/** FR-0001-like asset (hinge 1.5 mm inside the outer edge, acetate rim). */
const ASSET_138: AssetAnchor = {
  bridge: [0, 0, 0], temple_left: [-67.5, 13, 2], temple_right: [67.5, 13, 2], nose_pad_offset: [0, -4, -2],
  lens_plane_mm: 3, rim_depth_mm: 4, temple_bend_mm: 95, temple_drop_mm: 28,
};
const hingeOf = (a: AssetAnchor): HingeGeometry => ({ halfWidth: (Math.abs(a.temple_left[0]) + Math.abs(a.temple_right[0])) / 2, y: (a.temple_left[1] + a.temple_right[1]) / 2, z: (a.temple_left[2] + a.temple_right[2]) / 2 });
/** Bridge landing on landmark 6 with 1 mm clearance (what solveNoseLanding yields for fixed pads). */
const ANCHOR: [number, number, number] = [0, CANONICAL_VERTICES_MM[LM.BRIDGE * 3 + 1], CANONICAL_VERTICES_MM[LM.BRIDGE * 3 + 2] + 1];

const solve = (vertices: ArrayLike<number>, overrides: Partial<Parameters<typeof solveClearance>[0]> = {}) =>
  solveClearance({ verticesLocal: vertices, anchorLocal: ANCHOR, spec: SPEC_138, hinge: hingeOf(ASSET_138), asset: ASSET_138, scale: { uniform: 1, width: 1 }, tiltDeg: 0, cfg: CFG, ...overrides });

describe('clearance regions', () => {
  const P = (i: number) => [CANONICAL_VERTICES_MM[i * 3], CANONICAL_VERTICES_MM[i * 3 + 1], CANONICAL_VERTICES_MM[i * 3 + 2]];
  const mirrorOf = (left: readonly number[], right: readonly number[]) => {
    expect(left.length).toBe(right.length);
    for (const i of left) {
      const [x, y, z] = P(i);
      const j = right.find((k) => Math.abs(P(k)[0] + x) < 1e-3 && Math.abs(P(k)[1] - y) < 1e-3 && Math.abs(P(k)[2] - z) < 1e-3);
      expect(j, `mirror of vertex ${i}`).toBeDefined();
    }
  };
  it('are non-empty, computed from the canonical geometry, and mirror-symmetric', () => {
    for (const r of [SIDE_L, SIDE_R, NOSE_L, NOSE_R, BROW, CHEEK_L, CHEEK_R]) expect(r.length).toBeGreaterThan(10);
    mirrorOf(SIDE_L, SIDE_R);
    mirrorOf(NOSE_L, NOSE_R);
    mirrorOf(CHEEK_L, CHEEK_R);
    // Left = −X (image-left) as everywhere else in the core.
    for (const i of SIDE_L) expect(P(i)[0]).toBeLessThan(-50);
    for (const i of SIDE_R) expect(P(i)[0]).toBeGreaterThan(50);
    // The side band holds the widest vertex at hinge height (162/389), the temples and the ear fronts.
    expect(SIDE_L).toEqual(expect.arrayContaining([162, LM.TEMPLE_L, LM.EAR_L]));
    expect(SIDE_R).toEqual(expect.arrayContaining([389, LM.TEMPLE_R, LM.EAR_R]));
    // Brow is one region across the midline and symmetric within itself.
    const browMirror = BROW.filter((i) => P(i)[0] < -1e-3), browRight = BROW.filter((i) => P(i)[0] > 1e-3);
    mirrorOf(browMirror, browRight);
  });
});

describe('rim probes', () => {
  it('trace a rounded rectangle around each lens on the rim back face, tilted, scaled and anchored', () => {
    const pts = rimProbes(SPEC_138, ASSET_138, ANCHOR, { uniform: 1, width: 1 }, 0);
    expect(pts.length).toBe(48);
    const right = pts.filter((p) => p[0] > 0), left = pts.filter((p) => p[0] < 0);
    expect(right.length).toBe(24);
    expect(left.length).toBe(24);
    const cx = 18 / 2 + 52 / 2;
    for (const p of right) {
      expect(Math.abs(p[0] - cx)).toBeLessThanOrEqual(26 + 1e-6);
      expect(Math.abs(p[1] - (ANCHOR[1] - 3))).toBeLessThanOrEqual(20 + 1e-6);
      expect(p[2]).toBeCloseTo(ANCHOR[2] + 3 - 4, 6);
    }
    expect(Math.min(...right.map((p) => p[0]))).toBeCloseTo(9, 6);
    expect(Math.max(...right.map((p) => p[0]))).toBeCloseTo(61, 6);
    // Positive tilt lifts the top probes toward +Z and pushes the bottom ones back.
    const tilted = rimProbes(SPEC_138, ASSET_138, ANCHOR, { uniform: 1, width: 1 }, 8);
    const top = tilted.reduce((a, b) => (b[1] > a[1] ? b : a));
    const bottom = tilted.reduce((a, b) => (b[1] < a[1] ? b : a));
    expect(top[2]).toBeGreaterThan(ANCHOR[2] - 1);
    expect(bottom[2]).toBeLessThan(ANCHOR[2] - 1);
    // Width scale stretches X only.
    const wide = rimProbes(SPEC_138, ASSET_138, ANCHOR, { uniform: 1, width: 1.2 }, 0);
    expect(Math.max(...wide.map((p) => p[0]))).toBeCloseTo(61 * 1.2, 6);
  });
});

describe('solveClearance — temple splay', () => {
  it('splays the arms outward ≈ 7–10° for the canonical face with a 138 mm frame', () => {
    const r = solve(CANONICAL_VERTICES_MM);
    expect(r.splay.left).toBeGreaterThan(7 * d2r);
    expect(r.splay.left).toBeLessThan(10 * d2r);
    expect(r.splay.left).toBeCloseTo(r.splay.right, 6);
    expect(r.penetration.temple).toBeLessThanOrEqual(0);
  });
  it('needs no splay for a 180 mm frame', () => {
    const wideAsset: AssetAnchor = { ...ASSET_138, temple_left: [-88.5, 13, 2], temple_right: [88.5, 13, 2] };
    const r = solve(CANONICAL_VERTICES_MM, { spec: { ...SPEC_138, frame_width_mm: 180 }, asset: wideAsset, hinge: hingeOf(wideAsset) });
    expect(r.splay.left).toBe(0);
    expect(r.splay.right).toBe(0);
  });
  it('caps the splay at maxSplayDeg and then reports the residual temple penetration', () => {
    const r = solve(CANONICAL_VERTICES_MM, { cfg: { ...CFG, maxSplayDeg: 4 } });
    expect(r.splay.left).toBeCloseTo(4 * d2r, 9);
    expect(r.splay.right).toBeCloseTo(4 * d2r, 9);
    expect(r.penetration.temple).toBeGreaterThan(0);
  });
  it('splays more for a wider skull', () => {
    const wide = solve(deformCanonical({ templeWidth: 6 }));
    const base = solve(CANONICAL_VERTICES_MM);
    expect(wide.splay.left).toBeGreaterThan(base.splay.left + 2 * d2r);
  });
});

describe('solveClearance — forward push', () => {
  // Frame raised to the top of the ridge with a shallow metal rim so the canonical face is clear
  // everywhere and the rim top sits just in front of the brow.
  const highAnchor: [number, number, number] = [0, 32, 53.5];
  const metal: AssetAnchor = { ...ASSET_138, lens_plane_mm: 5, rim_depth_mm: 2.2 };
  it('is 0 for the canonical face and > 0 when the brow moves 6 mm forward', () => {
    const base = solve(CANONICAL_VERTICES_MM, { anchorLocal: highAnchor, asset: metal });
    expect(base.forwardMm).toBe(0);
    expect(base.penetration.brow).toBeLessThan(0);
    const heavy = solve(deformCanonical({ brow: 6 }), { anchorLocal: highAnchor, asset: metal });
    expect(heavy.forwardMm).toBeGreaterThan(0);
    expect(heavy.forwardMm).toBeLessThanOrEqual(CFG.maxForwardMm);
    for (const v of Object.values(heavy.penetration)) expect(v).toBeLessThanOrEqual(0);
  });
  it('pushes the frame forward when a nose pad would sink deeper than padSinkMm', () => {
    // Pads 12 mm behind the bridge origin dig into the nose sides (the surface is ≈5 mm behind the pad at −2).
    const deepPads: AssetAnchor = { ...ASSET_138, nose_pad_offset: [0, -4, -12] };
    const r = solve(CANONICAL_VERTICES_MM, { asset: deepPads });
    const base = solve(CANONICAL_VERTICES_MM);
    expect(r.forwardMm).toBeGreaterThan(base.forwardMm);
    expect(r.penetration.nose).toBeLessThanOrEqual(0);
  });
  it('clamps the push at maxForwardMm and keeps reporting the residual', () => {
    const r = solve(CANONICAL_VERTICES_MM, { asset: { ...ASSET_138, nose_pad_offset: [0, -4, -30] }, cfg: { ...CFG, maxForwardMm: 3 } });
    expect(r.forwardMm).toBe(3);
    expect(r.penetration.nose).toBeGreaterThan(0);
  });
  it('leaves no residual penetration after the correction for the canonical face and the sample frames', () => {
    for (const tilt of [0, 8]) {
      const r = solve(CANONICAL_VERTICES_MM, { tiltDeg: tilt });
      for (const v of Object.values(r.penetration)) expect(v).toBeLessThanOrEqual(0);
      expect(r.forwardMm).toBeGreaterThanOrEqual(0);
      expect(r.forwardMm).toBeLessThanOrEqual(CFG.maxForwardMm);
    }
  });
});

describe('FittingCore integration', () => {
  it('reports the clearance solve and the filtered splay when a spec is set', () => {
    const core = new FittingCore();
    core.setFrameSpec(SPEC_138, ASSET_138);
    let out = core.process(makeSyntheticFrame({ t: [0, 0, -500] }, 0));
    for (let i = 1; i < 10; i++) out = core.process(makeSyntheticFrame({ t: [0, 0, -500] }, i * 33));
    expect(out.clearance).not.toBeNull();
    expect(out.templeSplay.left).toBeGreaterThan(5 * d2r);
    expect(out.templeSplay.left).toBeCloseTo(out.clearance!.splay.left, 3);
    expect(out.clearance!.forwardMm).toBeGreaterThanOrEqual(0);
    for (const v of Object.values(out.clearance!.penetration)) expect(v).toBeLessThanOrEqual(0);
    // The forward push is applied to the anchor.
    expect(out.anchorLocal![2]).toBeCloseTo(ANCHOR[2] + out.clearance!.forwardMm, 2);
  });
  it('yields no clearance without a spec', () => {
    const core = new FittingCore();
    const out = core.process(makeSyntheticFrame({ t: [0, 0, -500] }, 0));
    expect(out.clearance).toBeNull();
    expect(out.templeSplay).toEqual({ left: 0, right: 0 });
  });
});

describe('face-variant regression (14 variants × 5 poses × 3 frames)', () => {
  const defs = loadFrameDefs();
  const POSES: Partial<SyntheticPose>[] = [{}, { yawDeg: 30 }, { yawDeg: -30 }, { pitchDeg: 15 }, { pitchDeg: -15 }];
  const WARMUP = 20;
  const MAX_RESIDUAL_MM = 0.5;
  it('covers the spec matrix', () => {
    expect(FACE_VARIANTS.length).toBe(14);
    expect(defs.length).toBe(3);
  });
  for (const variant of FACE_VARIANTS) {
    it(`${variant.name}: residual penetration ≤ ${MAX_RESIDUAL_MM} mm and push ≤ maxForwardMm after ${WARMUP} frames`, () => {
      const vertices = deformCanonical(variant.params);
      for (const pose of POSES) {
        const frame = makeSyntheticFrame({ t: [0, 0, -500], ...pose }, 0, { vertices });
        for (const def of defs) {
          const tag = `${variant.name} yaw ${pose.yawDeg ?? 0} pitch ${pose.pitchDeg ?? 0} ${def.frame_id}`;
          const core = new FittingCore();
          core.setFrameSpec(def.spec, anchorFromDef(def));
          let out = core.process(frame);
          for (let i = 1; i <= WARMUP; i++) out = core.process({ ...frame, timestampMs: i * 33 });
          expect(out.state, tag).toBe('Tracking');
          const c = out.clearance!;
          expect(c, tag).not.toBeNull();
          for (const [k, v] of Object.entries(c.penetration)) expect(v, `${tag} ${k}`).toBeLessThanOrEqual(MAX_RESIDUAL_MM);
          expect(c.forwardMm, tag).toBeLessThanOrEqual(CFG.maxForwardMm);
          expect(c.splay.left, tag).toBeLessThanOrEqual(CFG.maxSplayDeg * d2r + 1e-9);
          expect(c.splay.right, tag).toBeLessThanOrEqual(CFG.maxSplayDeg * d2r + 1e-9);
        }
      }
    });
  }
});
