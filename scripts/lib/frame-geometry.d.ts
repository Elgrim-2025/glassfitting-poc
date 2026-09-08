import type { BufferGeometry, Shape } from 'three';
import type { FrameSpec } from '../../src/core/types';

export type FrameShape = 'square' | 'round' | 'aviator';
export interface FrameGeometryDef { shape: FrameShape; spec: FrameSpec }
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
  anchors: { bridge: number[]; temple_left: number[]; temple_right: number[]; nose_pad_offset: number[] };
}
export const RIM_RADIUS: number;
export const TEMPLE_RADIUS: number;
export function lensShape(kind: FrameShape, w: number, h: number): Shape;
export function buildFrameGeometry(def: FrameGeometryDef): FrameGeometry;
