/**
 * Head occluder: a depth-only skull + ears proxy attached to the face matrix. The face
 * mesh has no ears or skull, so without it the far-side temple floats outside the head
 * silhouette and the near-side temple never disappears behind the ear.
 *
 * The proxy mesh is built in Blender (scripts/blender/head_builder.py →
 * public/models/head_occluder.glb) around the canonical face. At runtime its X scale is
 * chosen so that the skull half-width at ear level sits `ARM_INSET_MM` inside the temple
 * arms: a real head is exactly what pushes the arms apart, so this keeps the near arm
 * visible and hides the far arm without knowing the true head width. Y/Z follow the
 * user's face height. Falls back to an ellipsoid when the GLB cannot be loaded.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LM } from '../../core/landmarks';
import { CANONICAL_VERTICES_MM } from '../../core/fitting/canonical';
import { mCompose, mInvert, mMultiply, mTransformPoint, type Mat4 } from '../../core/math/mat4';
import type { FitOutput } from '../../core/types';

/** Face-local (y, z) at which the skull half-width is measured (matches head_builder.py). */
export const EAR_LEVEL: { y: number; z: number } = { y: 37, z: -40 };
/** Skull surface stays this far inside the temple arms at ear level. */
export const ARM_INSET_MM = 2;
/** Fallback ellipsoid (radii, centre) in face-local mm. */
export const FALLBACK_RADII: [number, number, number] = [77, 95, 88];
export const FALLBACK_CENTER: [number, number, number] = [0, 15, -50];

const CANON_FACE_HEIGHT = Math.abs(CANONICAL_VERTICES_MM[LM.FACE_TOP * 3 + 1] - CANONICAL_VERTICES_MM[LM.FACE_BOTTOM * 3 + 1]);

export interface HingeInfo {
  /** Hinge positions in the asset frame (mm), L = −X, R = +X. */
  left: THREE.Vector3;
  right: THREE.Vector3;
}

export class HeadOccluder {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;
  /** Skull half-width of the loaded geometry at EAR_LEVEL (mm). */
  private refHalfWidth = FALLBACK_RADII[0] * Math.sqrt(1 - ((EAR_LEVEL.y - FALLBACK_CENTER[1]) / FALLBACK_RADII[1]) ** 2 - ((EAR_LEVEL.z - FALLBACK_CENTER[2]) / FALLBACK_RADII[2]) ** 2);
  source: 'glb' | 'ellipsoid' = 'ellipsoid';
  lastScale = { x: 1, y: 1 };

  constructor() {
    this.material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
    this.mesh = new THREE.Mesh(this.fallbackGeometry(), this.material);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;
  }

  private fallbackGeometry(): THREE.BufferGeometry {
    const g = new THREE.SphereGeometry(1, 40, 28);
    g.scale(FALLBACK_RADII[0], FALLBACK_RADII[1], FALLBACK_RADII[2]);
    g.translate(FALLBACK_CENTER[0], FALLBACK_CENTER[1], FALLBACK_CENTER[2]);
    return g;
  }

  /** Loads the Blender-built proxy; keeps the ellipsoid on failure. */
  async load(url = `${import.meta.env.BASE_URL}models/head_occluder.glb`): Promise<'glb' | 'ellipsoid'> {
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      let geo: THREE.BufferGeometry | null = null;
      gltf.scene.traverse((o) => { if (!geo && o instanceof THREE.Mesh) geo = o.geometry as THREE.BufferGeometry; });
      if (!geo) throw new Error('no mesh in head occluder');
      const half = measureHalfWidth(geo);
      if (!(half > 40)) throw new Error(`implausible skull half-width ${half}`);
      this.mesh.geometry.dispose();
      this.mesh.geometry = geo;
      this.refHalfWidth = half;
      this.source = 'glb';
    } catch (err) {
      console.warn('[headOccluder] using ellipsoid fallback:', err instanceof Error ? err.message : err);
      this.source = 'ellipsoid';
    }
    return this.source;
  }

  /**
   * @param out Current fit output (face matrix, anchor, scales, splay).
   * @param hinge Hinge positions of the loaded asset (asset frame, mm).
   */
  update(out: FitOutput, hinge: HingeInfo | null): void {
    if (!out.faceMatrix || !out.anchorLocal) {
      this.group.visible = false;
      return;
    }
    const face = out.faceMatrix;
    const ws = out.widthScale * out.uniformScale;
    const us = out.uniformScale;
    // Temple arm x at ear level: hinge half-width (scaled) + outward splay over the depth from the hinge.
    let armX = 69 * ws + Math.tan(0.14) * 100;
    if (hinge) {
      const hz = out.anchorLocal[2] + ((hinge.left.z + hinge.right.z) / 2) * us;
      const depth = Math.max(10, hz - EAR_LEVEL.z);
      const xL = Math.abs(hinge.left.x) * ws + Math.tan(Math.max(0, out.templeSplay.left)) * depth;
      const xR = Math.abs(hinge.right.x) * ws + Math.tan(Math.max(0, out.templeSplay.right)) * depth;
      armX = Math.min(xL, xR);
    }
    const sx = Math.max(0.6, Math.min(1.6, (armX - ARM_INSET_MM) / this.refHalfWidth));
    // Face height ratio from the metric points (face-local y of forehead/chin).
    let sy = 1;
    if (out.faceMetricPoints) {
      const inv = mInvert(face);
      const top = mTransformPoint(inv, pointAt(out.faceMetricPoints, LM.FACE_TOP));
      const bottom = mTransformPoint(inv, pointAt(out.faceMetricPoints, LM.FACE_BOTTOM));
      sy = Math.max(0.85, Math.min(1.15, Math.abs(top[1] - bottom[1]) / CANON_FACE_HEIGHT));
    }
    this.lastScale = { x: sx, y: sy };
    const local: Mat4 = mCompose([0, 0, 0], [0, 0, 0, 1], [sx, sy, sy]);
    this.group.matrix.fromArray(mMultiply(face, local));
    this.group.visible = true;
  }

  setDebug(on: boolean): void {
    this.material.colorWrite = on;
    this.material.wireframe = on;
    this.material.transparent = on;
    this.material.opacity = on ? 0.25 : 1;
    this.material.color.set(0x3399ff);
    this.material.needsUpdate = true;
  }

  set visible(v: boolean) {
    this.group.visible = v && this.group.visible;
  }

  /** Legacy accessor for scene composition. */
  get object(): THREE.Object3D {
    return this.group;
  }
}

const pointAt = (a: Float32Array, i: number): [number, number, number] => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];

/** Max |x| of vertices near EAR_LEVEL, excluding the ear blobs (which sit further out with |x| jumps). */
export function measureHalfWidth(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position');
  const xs: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getY(i) - EAR_LEVEL.y) < 4 && Math.abs(pos.getZ(i) - EAR_LEVEL.z) < 6) xs.push(Math.abs(pos.getX(i)));
  }
  if (xs.length === 0) return NaN;
  xs.sort((a, b) => a - b);
  // The skull surface is the densest band; ear vertices are a sparse tail beyond a gap > 2 mm.
  let half = xs[0];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] > 2) break;
    half = xs[i];
  }
  return half;
}
