// Shared access to scripts/frames.json (product definitions) for gen-frames.mjs and the fit bench.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const FRAMES_JSON = join(here, '..', 'frames.json');

/** @returns {import('./frame-defs').FrameDef[]} */
export function loadFrameDefs(path = FRAMES_JSON) {
  return JSON.parse(readFileSync(path, 'utf8')).frames;
}

/**
 * Asset anchor (mock API `assets.anchor`) derived from a definition. The hinge axis sits
 * `hinge_inset_mm` inside the frame's outer edge so the temple's outer face is flush with it.
 * @param {import('./frame-defs').FrameDef} def
 */
export function anchorFromDef(def) {
  const { frame_width_mm: fw, temple_mm: tl } = def.spec;
  const b = def.build;
  const inset = b.hinge_inset_mm ?? 0;
  const hx = fw / 2 - inset;
  return {
    bridge: [0, 0, 0],
    temple_left: [-hx, b.hinge_y_mm, b.hinge_z_mm],
    temple_right: [hx, b.hinge_y_mm, b.hinge_z_mm],
    nose_pad_offset: [0, b.pad_center[1], b.pad_center[2]],
    lens_plane_mm: b.lens_plane_mm,
    rim_depth_mm: b.rim_depth_mm,
    temple_bend_mm: b.temple_bend_mm ?? Math.round(tl * 0.68),
    temple_drop_mm: b.temple_drop_mm ?? 28,
  };
}
