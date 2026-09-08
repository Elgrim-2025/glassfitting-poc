// Shared access to scripts/frames.json (product definitions) for gen-frames.mjs, the fit bench
// and the tests.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rimOuterOutline } from './lens-outline.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const FRAMES_JSON = join(here, '..', 'frames.json');

/** Lens sphere radius (mm) used by the builder (4-base curve). */
export const LENS_SPHERE_R_MM = 130;
/** Lens centre thickness assumed for the vertex distance (mm). */
export const LENS_CENTER_THICKNESS_MM = 1.5;

/** @returns {import('./frame-defs').FrameDef[]} */
export function loadFrameDefs(path = FRAMES_JSON) {
  return JSON.parse(readFileSync(path, 'utf8')).frames;
}

/** Rim back-face z in frame coordinates (rim front sits 1 mm proud of the lens plane; matches frame_builder.py). */
export const rimBackOf = (build) => build.lens_plane_mm + 1 - build.rim_depth_mm;

/** Lens back-surface z at the optical centre (spherical lens, 0.8 mm behind the rim front at the edge). */
export function lensBackOf(def) {
  const edgeSag = LENS_SPHERE_R_MM - Math.sqrt(LENS_SPHERE_R_MM ** 2 - (def.spec.lens_width_mm / 2) ** 2);
  return Math.round((def.build.lens_plane_mm - 0.8 + edgeSag - LENS_CENTER_THICKNESS_MM) * 100) / 100;
}

/**
 * Asset anchor (mock API `assets.anchor`) derived from a definition. The hinge axis sits
 * `hinge_inset_mm` inside the frame's outer edge so the temple's outer face is flush with it;
 * the nose-pad contact point is the pad centre moved back by half the pad thickness; the rim
 * outline is the +X rim's outer boundary on the rim back face (48 points).
 * @param {import('./frame-defs').FrameDef} def
 * @returns {import('../../src/core/types').AssetAnchor}
 */
export function anchorFromDef(def) {
  const { frame_width_mm: fw, temple_mm: tl } = def.spec;
  const b = def.build;
  const inset = b.hinge_inset_mm ?? 0;
  const hx = fw / 2 - inset;
  const padThickness = b.pad_size_mm ? b.pad_size_mm[2] : 0;
  return {
    bridge: [0, 0, 0],
    temple_left: [-hx, b.hinge_y_mm, b.hinge_z_mm],
    temple_right: [hx, b.hinge_y_mm, b.hinge_z_mm],
    nose_pad_offset: [b.pad_center[0], b.pad_center[1], Math.round((b.pad_center[2] - padThickness / 2) * 100) / 100],
    lens_plane_mm: b.lens_plane_mm,
    lens_back_mm: lensBackOf(def),
    rim_depth_mm: b.rim_depth_mm,
    rim_width_mm: b.rim_width_mm,
    rim_back_mm: Math.round(rimBackOf(b) * 100) / 100,
    rim_outline_mm: rimOuterOutline(def),
    temple_bend_mm: b.temple_bend_mm ?? Math.round(tl * 0.68),
    temple_drop_mm: b.temple_drop_mm ?? 28,
  };
}
