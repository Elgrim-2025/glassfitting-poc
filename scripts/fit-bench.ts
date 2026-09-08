/**
 * Fit bench (spec §4.4): runs every face variant × pose × sample frame through
 * FittingCore and writes bench/fit-bench.json for the Blender re-check
 * (scripts/blender/fit_bench.py), then prints a per-variant summary.
 *
 * Run with `npm run bench:fit` — the script is bundled with rolldown first because
 * Node cannot resolve the extension-less TypeScript imports of src/ and tests/.
 *
 * Output frames: `glassesLocal` is the applied glasses matrix expressed in the TRUE
 * face-local frame (inverse of the synthetic pose, not the tracker-fitted matrix);
 * `metricLocal` is the core's occluder mesh (faceMetricPoints[0..468)) in that same
 * frame, so both can be compared against `vertices` (the real deformed face).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_CONFIG } from '../src/core/config';
import { CANONICAL_VERTEX_COUNT } from '../src/core/fitting/canonical';
import { FittingCore } from '../src/core/fittingCore';
import { mInvert, mMultiply, mTransformPoints } from '../src/core/math/mat4';
import type { ClearancePenetration } from '../src/core/types';
import { deformCanonical, FACE_VARIANTS } from '../tests/helpers/faceVariants';
import { makeSyntheticFrame, poseMatrixMm, type SyntheticPose } from '../tests/helpers/synthetic';
import { anchorFromDef, loadFrameDefs } from './lib/frame-defs.mjs';

const ROOT = process.cwd();
const OUT_DIR = resolve(ROOT, 'bench');
const OUT_FILE = resolve(OUT_DIR, process.env.DEPTH === 'landmark' ? 'fit-bench-landmark.json' : process.env.DEPTH === 'canonical' ? 'fit-bench-canonical.json' : 'fit-bench.json');
const POSES: Partial<SyntheticPose>[] = [{}, { yawDeg: 30 }, { yawDeg: -30 }, { pitchDeg: 15 }, { pitchDeg: -15 }];
const WARMUP_FRAMES = 20;
/** DEPTH=landmark runs the core with per-landmark depth (the synthetic z is exact, i.e. the true deformed face). */
const DEPTH: 'canonical' | 'landmark' | 'hybrid' = process.env.DEPTH === 'landmark' ? 'landmark' : process.env.DEPTH === 'canonical' ? 'canonical' : 'hybrid';
const FACE_T: [number, number, number] = [0, 0, -500];

const r3 = (v: number) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v);
const round = (a: ArrayLike<number>) => Array.from(a, r3);
const deg = (rad: number) => (rad * 180) / Math.PI;

const defs = loadFrameDefs(resolve(ROOT, 'scripts/frames.json'));
const frames = defs.map((d) => ({ frame_id: d.frame_id, glb: `public/assets/frames/${d.frame_id}.glb`, spec: d.spec, anchor: anchorFromDef(d) }));

interface Summary { forward: number; splayMin: number; splayMax: number; pen: ClearancePenetration; worst: string; vertexMin: number; vertexMax: number; padGapMax: number }
const newSummary = (): Summary => ({ forward: -Infinity, splayMin: Infinity, splayMax: -Infinity, pen: { temple: -Infinity, brow: -Infinity, cheek: -Infinity, nose: -Infinity }, worst: '', vertexMin: Infinity, vertexMax: -Infinity, padGapMax: -Infinity });
const fold = (s: Summary, forward: number, splay: [number, number], pen: ClearancePenetration, tag: string, vertex: number, padGap: number): void => {
  if (forward > s.forward) { s.forward = forward; s.worst = tag; }
  s.splayMin = Math.min(s.splayMin, splay[0], splay[1]);
  s.splayMax = Math.max(s.splayMax, splay[0], splay[1]);
  for (const k of Object.keys(pen) as (keyof ClearancePenetration)[]) s.pen[k] = Math.max(s.pen[k], pen[k]);
  s.vertexMin = Math.min(s.vertexMin, vertex);
  s.vertexMax = Math.max(s.vertexMax, vertex);
  s.padGapMax = Math.max(s.padGapMax, padGap);
};

const overall = newSummary();
const perFrame = new Map(defs.map((d) => [d.frame_id, newSummary()]));
const variants = FACE_VARIANTS.map((variant) => {
  const vertices = deformCanonical(variant.params);
  const summary = newSummary();
  const cases = [];
  for (const pose of POSES) {
    const full: SyntheticPose = { t: FACE_T, ...pose };
    const frame = makeSyntheticFrame(full, 0, { vertices });
    const invTrue = mInvert(poseMatrixMm(full));
    for (const def of defs) {
      const core = new FittingCore({ placement: { depthSource: DEPTH } });
      core.setFrameSpec(def.spec, anchorFromDef(def));
      let out = core.process(frame);
      for (let i = 1; i <= WARMUP_FRAMES; i++) out = core.process({ ...frame, timestampMs: i * 33 });
      if (!out.glassesMatrix || !out.faceMetricPoints || !out.clearance) throw new Error(`${variant.name}/${def.frame_id}: no fit`);
      const splay: [number, number] = [out.templeSplay.left, out.templeSplay.right];
      const tag = `${variant.name} yaw ${pose.yawDeg ?? 0} pitch ${pose.pitchDeg ?? 0} ${def.frame_id}`;
      fold(summary, out.clearance.forwardMm, splay, out.clearance.penetration, tag, out.clearance.vertexMm, out.clearance.padGapMm);
      fold(overall, out.clearance.forwardMm, splay, out.clearance.penetration, tag, out.clearance.vertexMm, out.clearance.padGapMm);
      fold(perFrame.get(def.frame_id)!, out.clearance.forwardMm, splay, out.clearance.penetration, tag, out.clearance.vertexMm, out.clearance.padGapMm);
      cases.push({
        pose: { yawDeg: pose.yawDeg ?? 0, pitchDeg: pose.pitchDeg ?? 0 },
        frame_id: def.frame_id,
        glassesLocal: round(mMultiply(invTrue, out.glassesMatrix)),
        splay: [r3(splay[0]), r3(splay[1])],
        tiltRad: r3((out.tiltDeg * Math.PI) / 180),
        forwardMm: r3(out.clearance.forwardMm),
        penetration: Object.fromEntries(Object.entries(out.clearance.penetration).map(([k, v]) => [k, r3(v)])),
        vertexMm: r3(out.clearance.vertexMm),
        padGapMm: r3(out.clearance.padGapMm),
        widthScale: r3(out.widthScale),
        metricLocal: round(mTransformPoints(invTrue, out.faceMetricPoints.subarray(0, CANONICAL_VERTEX_COUNT * 3))),
      });
    }
  }
  const p = summary.pen;
  console.log(
    `${variant.name.padEnd(15)} push max ${summary.forward.toFixed(2).padStart(5)} mm  vertex ${summary.vertexMin.toFixed(1)}..${summary.vertexMax.toFixed(1)} mm  pad gap ≤ ${summary.padGapMax.toFixed(1)}  splay ${deg(summary.splayMin).toFixed(1)}..${deg(summary.splayMax).toFixed(1)}°` +
      `  residual temple ${p.temple.toFixed(2)} brow ${p.brow.toFixed(2)} cheek ${p.cheek.toFixed(2)} nose ${p.nose.toFixed(2)}  (worst push: ${summary.worst})`,
  );
  return { name: variant.name, params: variant.params, vertices: round(vertices), cases };
});

mkdirSync(OUT_DIR, { recursive: true });
const doc = {
  version: 1,
  generatedAt: new Date().toISOString(),
  config: DEFAULT_CONFIG.placement,
  poses: POSES.map((p) => ({ yawDeg: p.yawDeg ?? 0, pitchDeg: p.pitchDeg ?? 0 })),
  frames,
  variants,
};
writeFileSync(OUT_FILE, JSON.stringify(doc));
const cfg = DEFAULT_CONFIG.placement.clearance;
const p = overall.pen;
console.log(`\n${variants.length} variants × ${POSES.length} poses × ${frames.length} frames = ${variants.length * POSES.length * frames.length} cases (depth: ${DEPTH}) → ${OUT_FILE}`);
console.log(`overall: push max ${overall.forward.toFixed(2)} mm (limit ${cfg.maxForwardMm}, worst ${overall.worst}); vertex ${overall.vertexMin.toFixed(1)}..${overall.vertexMax.toFixed(1)} mm (range ${cfg.vertexMinMm}..${cfg.vertexMaxMm}); pad gap ≤ ${overall.padGapMax.toFixed(1)} mm; splay ${deg(overall.splayMin).toFixed(1)}..${deg(overall.splayMax).toFixed(1)}° (limit ${cfg.maxSplayDeg}°)`);
console.log(`overall residual penetration (mm, ≤ 0 ok): temple ${p.temple.toFixed(2)}  brow ${p.brow.toFixed(2)}  cheek ${p.cheek.toFixed(2)}  nose ${p.nose.toFixed(2)}`);
for (const [id, s] of perFrame) {
  console.log(`  ${id}: push max ${s.forward.toFixed(2)} mm (${s.worst}); vertex ${s.vertexMin.toFixed(1)}..${s.vertexMax.toFixed(1)}; splay ${deg(s.splayMin).toFixed(1)}..${deg(s.splayMax).toFixed(1)}°; residual nose ${s.pen.nose.toFixed(2)} temple ${s.pen.temple.toFixed(2)}`);
}
