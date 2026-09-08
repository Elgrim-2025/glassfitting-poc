/**
 * Pinhole camera matching MediaPipe's face geometry frustum: origin at the camera,
 * +X right, +Y up, −Z forward. Default vertical FOV 63°.
 */
import type { Vec3 } from '../math/vec3';

export class CameraModel {
  readonly tanHalfFovY: number;
  constructor(
    public readonly fovYDeg: number,
    public readonly imageWidth: number,
    public readonly imageHeight: number,
  ) {
    this.tanHalfFovY = Math.tan((fovYDeg * Math.PI) / 360);
  }

  get aspect(): number {
    return this.imageWidth / this.imageHeight;
  }

  /** Focal length in pixels (vertical). */
  get focalPx(): number {
    return this.imageHeight / 2 / this.tanHalfFovY;
  }

  /** Visible scene width (mm) at a given positive depth (mm). */
  widthAtDepth(depthMm: number): number {
    return 2 * depthMm * this.tanHalfFovY * this.aspect;
  }

  /** Projects a camera-space point (z < 0) to normalized image coordinates (y down). */
  project(p: Vec3): { x: number; y: number } {
    const d = -p[2] || 1e-6;
    const xn = p[0] / (d * this.tanHalfFovY * this.aspect);
    const yn = p[1] / (d * this.tanHalfFovY);
    return { x: (xn + 1) / 2, y: (1 - yn) / 2 };
  }

  /** Projects to pixel coordinates. */
  projectPx(p: Vec3): { x: number; y: number } {
    const n = this.project(p);
    return { x: n.x * this.imageWidth, y: n.y * this.imageHeight };
  }

  /** Unprojects normalized image coordinates at camera depth zCam (negative, mm). */
  unprojectNormalized(x: number, y: number, zCam: number): Vec3 {
    const d = -zCam;
    const xn = x * 2 - 1;
    const yn = 1 - y * 2;
    return [xn * d * this.tanHalfFovY * this.aspect, yn * d * this.tanHalfFovY, zCam];
  }
}
