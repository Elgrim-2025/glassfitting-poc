/** Depth-only face mesh (468 points, canonical tessellation) that hides glasses parts behind the face. */
import * as THREE from 'three';
import { CANONICAL_TRIANGLES, CANONICAL_VERTEX_COUNT } from '../../core/fitting/canonical';

export class FaceOccluder {
  readonly mesh: THREE.Mesh;
  private positions: THREE.BufferAttribute;
  private material: THREE.MeshBasicMaterial;

  constructor() {
    const geo = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(CANONICAL_VERTEX_COUNT * 3), 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.positions);
    geo.setIndex(new THREE.BufferAttribute(CANONICAL_TRIANGLES, 1));
    this.material = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      side: THREE.DoubleSide,
      // Push the occluder slightly back so the nose pads / bridge do not z-fight with the skin.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 2,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = -2;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
  }

  /** @param metricPts 478×3 camera-space points (mm); only the first 468 are used. */
  update(metricPts: Float32Array): void {
    (this.positions.array as Float32Array).set(metricPts.subarray(0, CANONICAL_VERTEX_COUNT * 3));
    this.positions.needsUpdate = true;
  }

  /** Debug view: draw the occluder as a translucent green wireframe. */
  setDebug(on: boolean): void {
    this.material.colorWrite = on;
    this.material.wireframe = on;
    this.material.transparent = on;
    this.material.opacity = on ? 0.35 : 1;
    this.material.color.set(0x33ff99);
    this.material.needsUpdate = true;
  }

  set visible(v: boolean) {
    this.mesh.visible = v;
  }
}
