import type { AssetAnchor, FrameSpec } from '../../src/core/types';

export interface FrameBuild {
  lens_plane_mm: number;
  rim_width_mm: number;
  rim_depth_mm: number;
  rim_bevel_mm: number;
  lens_center_y_mm: number;
  bridge_height_ratio: number;
  bridge_arch_mm: number;
  double_bridge_mm?: number;
  hinge_y_mm: number;
  hinge_z_mm: number;
  hinge_inset_mm?: number;
  endpiece_mm: number;
  temple_bend_mm?: number;
  temple_drop_mm?: number;
  temple_hook_mm?: number;
  temple_section_mm: [number, number];
  temple_tip_section_mm: [number, number];
  pad_center: [number, number, number];
  pad_size_mm: [number, number, number];
  pad_tilt_deg?: number;
}

export interface FrameDef {
  frame_id: string;
  name: string;
  shape: 'square' | 'round' | 'aviator';
  style: 'acetate' | 'metal';
  spec: FrameSpec;
  color: [number, number, number];
  metallic: number;
  roughness: number;
  lens_tint: [number, number, number];
  lens_alpha: number;
  build: FrameBuild;
  fit_hints: { recommended_pd_range_mm: [number, number]; shape?: 'square' | 'round' | 'aviator' };
}

export const FRAMES_JSON: string;
export function loadFrameDefs(path?: string): FrameDef[];
export function anchorFromDef(def: FrameDef): AssetAnchor;
