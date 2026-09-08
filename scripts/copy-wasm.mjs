// Copies runtime assets that must be self-hosted next to the app:
//  - MediaPipe tasks-vision WASM runtime → public/wasm
//  - three.js Draco decoder (for Draco-compressed GLB) → public/draco
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const jobs = [
  [join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'), join(root, 'public', 'wasm')],
  [join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf'), join(root, 'public', 'draco')],
];
for (const [src, dst] of jobs) {
  if (!existsSync(src)) {
    console.warn('[copy-assets] missing', src, '— skipping');
    continue;
  }
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log('[copy-assets]', src, '->', dst);
}
