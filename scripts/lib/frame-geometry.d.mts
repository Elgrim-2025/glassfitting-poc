import type { BufferGeometry, Shape } from 'three';
import type { AssetAnchor, FrameSpec } from '../../src/core/types';
import type { FrameBuild } from './frame-defs';

export type FrameShape = 'square' | 'round' | 'aviator' | 'wellington';
export interface FrameGeometryDef { shape: FrameShape; spec: FrameSpec; build?: Partial<FrameBuild> }
export interface FrameGeometry {
  frontZ: number;
  hingeY: number;
  hingeZ: number;
  front: BufferGeometry;
  pads: BufferGeometry;
  lensL: BufferGeometry;
  lensR: BufferGeometry;
  templeL: BufferGeometry;
  templeR: BufferGeometry;
  anchors: AssetAnchor;
}
export const RIM_RADIUS: number;
export const TEMPLE_RADIUS: number;
export function lensShape(kind: FrameShape, w: number, h: number, build?: Partial<FrameBuild>): Shape;
export function buildFrameGeometry(def: FrameGeometryDef): FrameGeometry;
