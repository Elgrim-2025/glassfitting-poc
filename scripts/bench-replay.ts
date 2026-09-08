/**
 * Writes replay sessions (golden-vector format) for face variants and poses so the
 * browser can show a still, converged fit without a camera:
 *   npm run bench:replay            → bench/replays/<variant>-<pose>.json
 *   http://localhost:5173/?replay=/bench/replays/wide_flat-yaw30.json
 * Each file repeats the same synthetic frame for 40 frames (1.3 s) so the One-Euro
 * filters converge; the last rendered frame stays on screen when the replay ends.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateGolden } from '../src/core/golden';
import { deformCanonical, FACE_VARIANTS } from '../tests/helpers/faceVariants';
import { makeSyntheticFrame, type SyntheticPose } from '../tests/helpers/synthetic';
import type { FrameInput } from '../src/core/types';

const OUT_DIR = resolve(process.cwd(), 'bench', 'replays');
const POSES: Record<string, Partial<SyntheticPose>> = { front: {}, yaw30: { yawDeg: 30 }, 'yaw-30': { yawDeg: -30 }, pitch15: { pitchDeg: 15 } };
const VARIANTS = new Set(['canonical', 'wide_flat', 'narrow_high', 'extreme']);
const FRAMES = 40;

mkdirSync(OUT_DIR, { recursive: true });
let n = 0;
for (const v of FACE_VARIANTS) {
  if (!VARIANTS.has(v.name)) continue;
  const vertices = deformCanonical(v.params);
  for (const [poseName, pose] of Object.entries(POSES)) {
    const frames: FrameInput[] = [];
    for (let i = 0; i < FRAMES; i++) frames.push(makeSyntheticFrame({ t: [0, 0, -300], ...pose }, i * 33, { vertices }));
    const golden = generateGolden(`${v.name}-${poseName}`, frames);
    writeFileSync(resolve(OUT_DIR, `${v.name}-${poseName}.json`), JSON.stringify(golden));
    n++;
  }
}
console.log(`[bench-replay] wrote ${n} replay files to ${OUT_DIR}`);
