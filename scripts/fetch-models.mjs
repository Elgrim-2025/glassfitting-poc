// Downloads the MediaPipe Face Landmarker model and the canonical face model OBJ into public/models.
// Skips files that already exist. Re-run with FORCE=1 to overwrite.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, 'public', 'models');
mkdirSync(dir, { recursive: true });

const FILES = [
  {
    name: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  },
  {
    name: 'canonical_face_model.obj',
    url: 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj',
  },
];

for (const f of FILES) {
  const dst = join(dir, f.name);
  if (existsSync(dst) && !process.env.FORCE) {
    console.log(`[fetch-models] ${f.name} exists, skipping`);
    continue;
  }
  console.log(`[fetch-models] downloading ${f.url}`);
  const res = await fetch(f.url);
  if (!res.ok) throw new Error(`${f.url}: HTTP ${res.status}`);
  writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
  console.log(`[fetch-models] wrote ${dst}`);
}
