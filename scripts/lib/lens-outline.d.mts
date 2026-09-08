import type { FrameBuild, FrameDef, FrameShape } from './frame-defs';

export type Point2 = [number, number];
export function dedupe(pts: Point2[], eps?: number): Point2[];
export function signedArea(pts: Point2[]): number;
export function filletPolygon(corners: Point2[], radii: number[], nCorner?: number): Point2[];
export function normalizeBox(pts: Point2[], w: number, h: number): Point2[];
export function offsetClosed(pts: Point2[], dist: number | ((x: number, y: number) => number)): Point2[];
export function resampleClosed(pts: Point2[], n: number): Point2[];
export function lensOutline(shape: FrameShape, w: number, h: number, build?: Partial<FrameBuild>): Point2[];
export function rimWidthAt(y: number, hh: number, top: number, bottom?: number): number;
export function rimOuterOutline(def: Pick<FrameDef, 'spec' | 'shape'> & { build?: Partial<FrameBuild> }, n?: number): Point2[];
