/**
 * Three.js scene aligned with MediaPipe's virtual camera: origin at the camera,
 * −Z forward, vertical FOV 63°, mm units. The canvas is transparent and sits over
 * the <video>; the whole stage is mirrored by CSS.
 */
import * as THREE from 'three';
import type { FitOutput } from '../../core/types';
import { FaceOccluder } from './faceOccluder';
import { HeadOccluder } from './headOccluder';
import { GlassesRig } from './glasses';

export interface RenderOptions {
  faceOccluder: boolean;
  headOccluder: boolean;
  debugOccluder: boolean;
}

export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly glasses = new GlassesRig();
  readonly faceOccluder = new FaceOccluder();
  readonly headOccluder = new HeadOccluder();
  private debug = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.camera = new THREE.PerspectiveCamera(63, 16 / 9, 10, 100000);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x556677, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(200, 400, 800);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-500, 100, 300);
    this.scene.add(fill);
    this.scene.add(this.faceOccluder.mesh, this.headOccluder.group, this.glasses.group);
    void this.headOccluder.load();
  }

  /** Match the tracker's image size and FOV so projections line up with the video. */
  setVideoSize(width: number, height: number, fovYDeg: number): void {
    this.camera.fov = fovYDeg;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** CSS size of the stage; the drawing buffer follows the device pixel ratio (capped at 2). */
  setDisplaySize(cssWidth: number, cssHeight: number): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(Math.max(1, Math.round(cssWidth)), Math.max(1, Math.round(cssHeight)), false);
  }

  render(out: FitOutput | null, opts: RenderOptions): void {
    if (opts.debugOccluder !== this.debug) {
      this.debug = opts.debugOccluder;
      this.faceOccluder.setDebug(this.debug);
      this.headOccluder.setDebug(this.debug);
    }
    if (out && out.faceMetricPoints && out.faceMatrix && out.alpha > 0) {
      this.faceOccluder.update(out.faceMetricPoints);
      this.faceOccluder.visible = opts.faceOccluder;
      this.headOccluder.update(out, this.glasses.hingeInfo);
      this.headOccluder.visible = opts.headOccluder;
    } else {
      this.faceOccluder.visible = false;
      this.headOccluder.visible = false;
    }
    if (out) this.glasses.update(out);
    else this.glasses.group.visible = false;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
