/** Runtime fallback: builds a spec-accurate frame when the GLB cannot be loaded. */
import * as THREE from 'three';
import { buildFrameGeometry, type FrameShape } from '../../../scripts/lib/frame-geometry.mjs';
import type { AssetAnchor, FrameSpec } from '../../core/types';

const FRAME_COLORS: Record<FrameShape, number> = { square: 0x141212, wellington: 0x050505, round: 0xd4b038, aviator: 0xbfbfc6 };

export function buildProceduralGlasses(spec: FrameSpec, shape: FrameShape = 'square', anchorHint?: AssetAnchor | null): { root: THREE.Group; anchor: AssetAnchor } {
  // Reuse the product-master anchor metadata so the fallback's hinges/bend match the API.
  const build = anchorHint
    ? {
        hinge_y_mm: anchorHint.temple_right[1], hinge_z_mm: anchorHint.temple_right[2],
        hinge_inset_mm: spec.frame_width_mm / 2 - Math.abs(anchorHint.temple_right[0]),
        lens_plane_mm: anchorHint.lens_plane_mm, temple_bend_mm: anchorHint.temple_bend_mm, temple_drop_mm: anchorHint.temple_drop_mm,
        pad_center: [anchorHint.nose_pad_offset[0], anchorHint.nose_pad_offset[1], anchorHint.nose_pad_offset[2]] as [number, number, number],
      }
    : undefined;
  const g = buildFrameGeometry({ shape, spec, build });
  const metal = shape !== 'square' && shape !== 'wellington';
  const frameMat = new THREE.MeshStandardMaterial({ color: FRAME_COLORS[shape], metalness: metal ? 0.9 : 0.05, roughness: metal ? 0.3 : 0.45, side: THREE.DoubleSide });
  const lensMat = new THREE.MeshStandardMaterial({ color: 0xd9e6ff, transparent: true, opacity: 0.18, metalness: 0, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false });
  const padMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.6, roughness: 0.6, side: THREE.DoubleSide });

  const root = new THREE.Group();
  root.name = 'procedural';
  const add = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    root.add(m);
    return m;
  };
  add('frame_front', g.front, frameMat);
  add('nose_pads', g.pads, padMat);
  add('lens_L', g.lensL, lensMat);
  add('lens_R', g.lensR, lensMat);
  add('temple_L', g.templeL, frameMat);
  add('temple_R', g.templeR, frameMat);
  const anchorNode = (name: string, p: number[]) => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(p[0], p[1], p[2]);
    root.add(o);
  };
  anchorNode('anchor_bridge', g.anchors.bridge);
  anchorNode('anchor_temple_L', g.anchors.temple_left);
  anchorNode('anchor_temple_R', g.anchors.temple_right);
  return { root, anchor: { ...g.anchors } };
}
