// Copies the MediaPipe tasks-vision WASM runtime into public/wasm so the app
// can run fully self-hosted (no CDN dependency at runtime).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const dst = join(root, 'public', 'wasm');
if (!existsSync(src)) {
  console.warn('[copy-wasm] tasks-vision wasm directory not found, skipping');
  process.exit(0);
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log('[copy-wasm] copied', src, '->', dst);
