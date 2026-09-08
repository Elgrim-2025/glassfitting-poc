/**
 * Glasses rig: loads the product GLB (docs/assets/glb-spec.md), resolves anchor nodes,
 * checks dimensions against the spec, and drives the node from FitOutput
 * (matrix, presence alpha, temple splay). Falls back to procedural geometry.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import type { AssetAnchor, FitOutput } from '../../core/types';
import { inferShape, type ProductFrame } from '../product/adapter';
import { buildProceduralGlasses } from './proceduralGlasses';

export interface AssetCheck {
  source: 'glb' | 'procedural';
  measuredWidthMm: number;
  specWidthMm: number;
  /** |measured − spec| ≤ 1 mm (spec Appendix C). */
  ok: boolean;
  triangles: number;
  missingNodes: string[];
  error?: string;
}

const REQUIRED = ['anchor_bridge', 'anchor_temple_L', 'anchor_temple_R', 'lens_L', 'lens_R', 'temple_L', 'temple_R'];

export class GlassesRig {
  readonly group = new THREE.Group();
  item: ProductFrame | null = null;
  anchor: AssetAnchor | null = null;
  assetCheck: AssetCheck | null = null;
  private model: THREE.Object3D | null = null;
  private templeL: THREE.Object3D | null = null;
  private templeR: THREE.Object3D | null = null;
  private hingeL = new THREE.Vector3();
  private hingeR = new THREE.Vector3();
  /** Hinge positions in the asset frame (mm), for the head occluder's adaptive width. */
  get hingeInfo(): { left: THREE.Vector3; right: THREE.Vector3 } | null {
    return this.model ? { left: this.hingeL, right: this.hingeR } : null;
  }
  private materials: { mat: THREE.Material; baseOpacity: number; baseTransparent: boolean }[] = [];
  private lastAlpha = -1;
  private lastSplay = { left: NaN, right: NaN };
  private lastTilt = NaN;
  private loader: GLTFLoader;
  private loadToken = 0;

  constructor(dracoPath = '/draco/') {
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;
    this.loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(dracoPath);
    this.loader.setDRACOLoader(draco);
  }

  async load(item: ProductFrame): Promise<AssetCheck> {
    const token = ++this.loadToken;
    this.item = item;
    let root: THREE.Object3D;
    let source: AssetCheck['source'] = 'glb';
    let error: string | undefined;
    let anchor: AssetAnchor = item.assets.anchor;
    try {
      const gltf = await this.loader.loadAsync(item.assets.glb_url);
      root = gltf.scene;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.warn('[glasses] GLB load failed, using procedural geometry:', error);
      const p = buildProceduralGlasses(item.spec, inferShape(item), item.assets.anchor);
      root = p.root;
      anchor = p.anchor;
      source = 'procedural';
    }
    if (token !== this.loadToken) return this.assetCheck!; // superseded by a newer load
    this.attach(root, anchor);
    this.assetCheck = this.check(root, item, source, error);
    return this.assetCheck;
  }

  private attach(root: THREE.Object3D, anchor: AssetAnchor): void {
    if (this.model) {
      this.group.remove(this.model);
      this.model.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
        }
      });
    }
    this.model = root;
    this.group.add(root);
    this.anchor = anchor;
    this.materials = [];
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          this.materials.push({ mat: m, baseOpacity: m.opacity, baseTransparent: m.transparent });
        }
      }
    });
    this.templeL = root.getObjectByName('temple_L') ?? null;
    this.templeR = root.getObjectByName('temple_R') ?? null;
    const hl = root.getObjectByName('anchor_temple_L');
    const hr = root.getObjectByName('anchor_temple_R');
    if (hl) this.hingeL.copy(hl.position); else this.hingeL.set(anchor.temple_left[0], anchor.temple_left[1], anchor.temple_left[2]);
    if (hr) this.hingeR.copy(hr.position); else this.hingeR.set(anchor.temple_right[0], anchor.temple_right[1], anchor.temple_right[2]);
    for (const t of [this.templeL, this.templeR]) if (t) t.matrixAutoUpdate = false;
    this.lastAlpha = -1;
    this.lastSplay = { left: NaN, right: NaN };
  }

  private check(root: THREE.Object3D, item: ProductFrame, source: AssetCheck['source'], error?: string): AssetCheck {
    const missing = REQUIRED.filter((n) => !root.getObjectByName(n));
    const front = root.getObjectByName('frame_front');
    const box = new THREE.Box3();
    if (front) box.setFromObject(front);
    else {
      root.traverse((o) => { if (o instanceof THREE.Mesh && !o.name.startsWith('temple')) box.expandByObject(o); });
    }
    const width = box.isEmpty() ? NaN : box.max.x - box.min.x;
    let triangles = 0;
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const g = o.geometry as THREE.BufferGeometry;
        triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      }
    });
    return {
      source,
      measuredWidthMm: width,
      specWidthMm: item.spec.frame_width_mm,
      ok: Number.isFinite(width) && Math.abs(width - item.spec.frame_width_mm) <= 1 && missing.length === 0,
      triangles,
      missingNodes: missing,
      error,
    };
  }

  update(out: FitOutput): void {
    if (!out.glassesMatrix || out.alpha <= 0) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.group.matrix.fromArray(out.glassesMatrix);
    this.setAlpha(out.alpha);
    this.applySplay(out.templeSplay.left, out.templeSplay.right, (out.tiltDeg * Math.PI) / 180);
  }

  private setAlpha(alpha: number): void {
    if (alpha === this.lastAlpha) return;
    this.lastAlpha = alpha;
    for (const { mat, baseOpacity, baseTransparent } of this.materials) {
      mat.opacity = baseOpacity * alpha;
      mat.transparent = baseTransparent || alpha < 1;
      mat.needsUpdate = true;
    }
  }

  /**
   * Temple node matrix = T(hinge) · Rx(−tilt) · Ry(±splay) · T(−hinge): the front carries the
   * pantoscopic tilt, so the temples are rotated back by −tilt about the hinge to stay level
   * along the head, then splayed outward about the (level) vertical axis.
   */
  private applySplay(left: number, right: number, tiltRad = 0): void {
    if (left === this.lastSplay.left && right === this.lastSplay.right && tiltRad === this.lastTilt) return;
    this.lastSplay = { left, right };
    this.lastTilt = tiltRad;
    const pivot = (node: THREE.Object3D | null, hinge: THREE.Vector3, angle: number) => {
      if (!node) return;
      node.matrix
        .makeTranslation(hinge.x, hinge.y, hinge.z)
        .multiply(new THREE.Matrix4().makeRotationX(-tiltRad))
        .multiply(new THREE.Matrix4().makeRotationY(angle))
        .multiply(new THREE.Matrix4().makeTranslation(-hinge.x, -hinge.y, -hinge.z));
    };
    // −X temple rotates +θ about Y to move its tip toward −X; +X temple the opposite.
    pivot(this.templeL, this.hingeL, left);
    pivot(this.templeR, this.hingeR, -right);
  }
}
