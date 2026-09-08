/**
 * Ellipsoid head approximation attached to the face matrix. The face mesh has no ears or
 * skull, so the far-side temple must be hidden by this proxy when the head turns.
 * It stays behind the lens plane (front ≤ +45 mm in the face frame) and slightly inside
 * the user's temple width so the near-side arm remains visible.
 */
import * as THREE from 'three';
import { mCompose, mMultiply, type Mat4 } from '../../core/math/mat4';
import { CANONICAL_TEMPLE_WIDTH_MM } from '../../core/fitting/scaleSolver';

export const HEAD_CENTER: [number, number, number] = [0, 0, -40];
export const HEAD_RADII: [number, number, number] = [CANONICAL_TEMPLE_WIDTH_MM / 2 - 4, 100, 85];

export class HeadOccluder {
  readonly mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;

  constructor() {
    this.material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), this.material);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
  }

  update(faceMatrixMm: Mat4, widthScale: number): void {
    const local = mCompose(HEAD_CENTER, [0, 0, 0, 1], [HEAD_RADII[0] * widthScale, HEAD_RADII[1], HEAD_RADII[2]]);
    this.mesh.matrix.fromArray(mMultiply(faceMatrixMm, local));
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
    this.mesh.visible = v;
  }
}
