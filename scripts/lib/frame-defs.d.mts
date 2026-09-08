import type { AssetAnchor, FrameSpec } from '../../src/core/types';

export type FrameShape = 'square' | 'round' | 'aviator' | 'wellington';

export interface FrameBuild {
  lens_plane_mm: number;
  rim_width_mm: number;
  /** Rim width at the bottom of the lens (default = rim_width_mm); the width tapers linearly. */
  rim_width_bottom_mm?: number;
  rim_depth_mm: number;
  rim_bevel_mm: number;
  lens_center_y_mm: number;
  bridge_height_ratio: number;
  bridge_arch_mm: number;
  /** Height of the bridge bar (default = rim_width_mm). */
  bridge_bar_mm?: number;
  double_bridge_mm?: number;
  /** Wellington outline: [top_outer, top_inner, bottom_inner, bottom_outer] corner radii. */
  corner_radius_mm?: [number, number, number, number];
  inner_slant_mm?: number;
  outer_slant_mm?: number;
  hinge_y_mm: number;
  hinge_z_mm: number;
  hinge_inset_mm?: number;
  endpiece_mm: number;
  /** Decorative metal pins on the end pieces and temples. */
  rivets?: boolean;
  temple_bend_mm?: number;
  temple_drop_mm?: number;
  temple_hook_mm?: number;
  temple_section_mm: [number, number];
  temple_tip_section_mm: [number, number];
  /** Length of the translucent temple tip (mm, 0 = none). */
  temple_tip_mm?: number;
  /** Pad centre in frame mm; pad_size_mm = [width x, height y, thickness z]. */
  pad_center: [number, number, number];
  pad_size_mm: [number, number, number];
  pad_tilt_deg?: number;
  /** Splay of a fixed pad's contact face about the vertical axis (deg). */
  pad_splay_deg?: number;
}

export interface FrameDef {
  frame_id: string;
  name: string;
  shape: FrameShape;
  style: 'acetate' | 'metal';
  spec: FrameSpec;
  color: [number, number, number];
  metallic: number;
  roughness: number;
  lens_tint: [number, number, number];
  lens_alpha: number;
  build: FrameBuild;
  fit_hints: { recommended_pd_range_mm: [number, number]; shape?: FrameShape };
}

export const FRAMES_JSON: string;
export const LENS_SPHERE_R_MM: number;
export const LENS_CENTER_THICKNESS_MM: number;
export function loadFrameDefs(path?: string): FrameDef[];
export function rimBackOf(build: FrameBuild): number;
export function lensBackOf(def: FrameDef): number;
export function anchorFromDef(def: FrameDef): AssetAnchor;
