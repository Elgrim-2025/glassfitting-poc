// Runs before `npm run dev` / `npm run build`: makes sure the git-ignored runtime files the
// browser loads exist in this checkout (a fresh clone or a git worktree has none of them).
//  - public/wasm/*            MediaPipe tasks-vision runtime (copied from node_modules)
//  - public/draco/*           three.js Draco decoder (copied from node_modules)
//  - public/models/face_landmarker.task   downloaded once (≈3.7 MB), or copied from a sibling checkout
//  - public/models/canonical_face_model.obj
// Without these the tracker fails with 404s ("vision_wasm_internal.js … 404", "GPU delegate failed").
import { copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const need = [
  join(root, 'public', 'wasm', 'vision_wasm_internal.js'),
  join(root, 'public', 'wasm', 'vision_wasm_internal.wasm'),
  join(root, 'public', 'draco', 'draco_decoder.js'),
];
if (need.some((p) => !existsSync(p))) {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'copy-wasm.mjs')], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const model = join(root, 'public', 'models', 'face_landmarker.task');
const obj = join(root, 'public', 'models', 'canonical_face_model.obj');
if (!existsSync(model) || !existsSync(obj)) {
  // A git worktree lives under <repo>/.claude/worktrees/<name>: reuse the main checkout's files.
  const siblings = [resolve(root, '..', '..', '..'), resolve(root, '..')];
  let copied = false;
  for (const base of siblings) {
    const src = join(base, 'public', 'models', 'face_landmarker.task');
    if (src !== model && existsSync(src) && !existsSync(model)) {
      copyFileSync(src, model);
      console.log(`[ensure-assets] copied face_landmarker.task from ${base}`);
      copied = true;
      break;
    }
  }
  if (!copied || !existsSync(obj)) {
    const r = spawnSync(process.execPath, [join(root, 'scripts', 'fetch-models.mjs')], { stdio: 'inherit' });
    if (r.status !== 0) {
      console.error('[ensure-assets] model download failed — run `npm run setup:models` with network access');
      process.exit(r.status ?? 1);
    }
  }
}
console.log('[ensure-assets] runtime assets present');
