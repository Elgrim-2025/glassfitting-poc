/**
 * FittingCore — the platform-independent facade. Feed one FrameInput per tracker
 * frame and render whatever FitOutput says. No DOM, no WebGL, no Three.js.
 */
import { DEFAULT_CONFIG, mergeConfig, type FittingConfigPatch } from './config';
import { PoseFilter } from './filters/poseFilter';
import { OneEuroScalar } from './filters/oneEuro';
import { CameraModel } from './fitting/camera';
import { composeGlassesMatrix } from './fitting/anchorSolver';
import { estimatePoseKabsch } from './fitting/kabschPose';
import { isPlausibleFaceMatrix, mpMatrixToMm } from './fitting/mediapipeMatrix';
import { toMetricLandmarks } from './fitting/metricLandmarks';
import { solveNoseLanding } from './fitting/noseLanding';
import { solveWidthScale } from './fitting/scaleSolver';
import { solveTempleSplay, type HingeGeometry } from './fitting/templeSplay';
import { LM, TOTAL_LANDMARK_COUNT } from './landmarks';
import { mTransformPoint, type Mat4 } from './math/mat4';
import type { Vec3 } from './math/vec3';
import { IDLE_ESTIMATE, PdEstimator } from './pd/pdEstimator';
import { anglesFromMatrix } from './tracking/angles';
import { TrackingStateMachine } from './tracking/stateMachine';
import type { Angles, AssetAnchor, FitOutput, FittingConfig, FrameInput, FrameSpec } from './types';

export const REAL_SIZE_SCALE_MIN = 0.7;
export const REAL_SIZE_SCALE_MAX = 1.4;

export class FittingCore {
  config: FittingConfig;
  private poseFilter: PoseFilter;
  private sm: TrackingStateMachine;
  private pd: PdEstimator;
  private widthFilter = new OneEuroScalar({ minCutoff: 0.3, beta: 0, dCutoff: 1 });
  private splayL = new OneEuroScalar({ minCutoff: 0.5, beta: 0, dCutoff: 1 });
  private splayR = new OneEuroScalar({ minCutoff: 0.5, beta: 0, dCutoff: 1 });
  private cam: CameraModel | null = null;
  private spec: FrameSpec | null = null;
  private asset: AssetAnchor | null = null;
  private metricBuf = new Float32Array(TOTAL_LANDMARK_COUNT * 3);
  private last: FitOutput | null = null;

  constructor(patch?: FittingConfigPatch) {
    this.config = mergeConfig(DEFAULT_CONFIG, patch);
    this.poseFilter = new PoseFilter(this.config.filter);
    this.sm = new TrackingStateMachine(this.config.tracking);
    this.pd = new PdEstimator(this.config.pd);
  }

  setConfig(patch: FittingConfigPatch): void {
    this.config = mergeConfig(this.config, patch);
    this.poseFilter.setConfig(this.config.filter);
    this.sm.setConfig(this.config.tracking);
    this.pd.setConfig(this.config.pd);
    this.cam = null;
  }

  setFrameSpec(spec: FrameSpec | null, asset: AssetAnchor | null = null): void {
    this.spec = spec;
    this.asset = asset;
  }

  get frameSpec(): FrameSpec | null {
    return this.spec;
  }

  resetPd(): void {
    this.pd.reset();
  }

  reset(): void {
    this.poseFilter.reset();
    this.sm.reset();
    this.pd.reset();
    this.widthFilter.reset();
    this.splayL.reset();
    this.splayR.reset();
    this.last = null;
  }

  /** Hinge geometry from the asset anchor, or an estimate from the spec. */
  hingeGeometry(): HingeGeometry | null {
    if (this.asset) {
      const l = this.asset.temple_left, r = this.asset.temple_right;
      return { halfWidth: (Math.abs(l[0]) + Math.abs(r[0])) / 2, y: (l[1] + r[1]) / 2, z: (l[2] + r[2]) / 2 };
    }
    if (this.spec) return { halfWidth: this.spec.frame_width_mm / 2, y: this.spec.lens_height_mm * 0.2, z: 3 };
    return null;
  }

  camera(frame: FrameInput): CameraModel {
    if (!this.cam || this.cam.imageWidth !== frame.imageWidth || this.cam.imageHeight !== frame.imageHeight || this.cam.fovYDeg !== this.config.camera.fovYDeg) {
      this.cam = new CameraModel(this.config.camera.fovYDeg, frame.imageWidth, frame.imageHeight);
    }
    return this.cam;
  }

  process(frame: FrameInput): FitOutput {
    const cam = this.camera(frame);
    const cfg = this.config;
    const hasLandmarks = !!frame.landmarks && frame.landmarks.length >= TOTAL_LANDMARK_COUNT;
    const hasMatrix = !!frame.matrix && frame.matrix.length === 16;

    let rawFace: Mat4 | null = null;
    let metric: Float32Array | null = null;
    let angles: Angles | null = null;
    let confidence = 0;
    let plausible = true;

    if (hasLandmarks && (hasMatrix || cfg.placement.useKabschPose)) {
      const lm = frame.landmarks!;
      if (hasMatrix) {
        rawFace = mpMatrixToMm(frame.matrix!, cfg.transposeMatrix);
        plausible = isPlausibleFaceMatrix(rawFace);
      }
      if (cfg.placement.useKabschPose) {
        // Depth from landmark z (independent of the matrix), then fit the canonical model.
        const seed = rawFace ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -500, 1];
        const pts = toMetricLandmarks(lm, seed, cam, 'landmark', this.metricBuf);
        rawFace = estimatePoseKabsch(pts).matrix;
        plausible = isPlausibleFaceMatrix(rawFace);
      }
      metric = toMetricLandmarks(lm, rawFace!, cam, 'matrix', this.metricBuf);
      angles = anglesFromMatrix(rawFace!);
      const faceWidthPx = Math.hypot(
        (lm[LM.TEMPLE_L].x - lm[LM.TEMPLE_R].x) * frame.imageWidth,
        (lm[LM.TEMPLE_L].y - lm[LM.TEMPLE_R].y) * frame.imageHeight,
      );
      confidence = Math.min(1, (0.6 * faceWidthPx) / cfg.tracking.minFaceWidthPx);
      if (!plausible) confidence = Math.min(confidence, 0.5);
    }

    const detected = rawFace !== null;
    const st = this.sm.update({ timestampMs: frame.timestampMs, detected, confidence, angles });
    const pd = hasLandmarks ? this.pd.update(frame, angles, cam) : this.pd.current.status === 'idle' ? IDLE_ESTIMATE : this.pd.current;

    let faceMatrix: Mat4 | null = null;
    let glassesMatrix: Mat4 | null = null;
    let widthScale = 1;
    let uniformScale = 1;
    let realSizeActive = false;
    let anchorLocal: Vec3 | null = null;
    let templeSplay = { left: 0, right: 0 };

    if (detected && !st.holdPose) {
      faceMatrix = this.poseFilter.filter(rawFace!, frame.timestampMs, st.filterStrength);

      const ws = solveWidthScale(metric!, rawFace!, cfg.placement.widthScaleMin, cfg.placement.widthScaleMax);
      const smoothWidth = this.widthFilter.filter(ws.ratio, frame.timestampMs);
      if (cfg.placement.realSizeMode && pd.status === 'ready' && Number.isFinite(pd.distance_mm)) {
        const eyeDepthWorld = -metric![LM.IRIS_L_CENTER * 3 + 2];
        uniformScale = Math.min(REAL_SIZE_SCALE_MAX, Math.max(REAL_SIZE_SCALE_MIN, eyeDepthWorld / pd.distance_mm));
        realSizeActive = true;
        widthScale = 1;
      } else {
        widthScale = cfg.placement.widthScaleEnabled ? smoothWidth : 1;
      }

      anchorLocal = solveNoseLanding(metric!, rawFace!, this.spec, cfg.placement).anchor;
      glassesMatrix = composeGlassesMatrix(faceMatrix, anchorLocal, { uniform: uniformScale, width: widthScale }, this.asset);
      const hinge = this.hingeGeometry();
      if (hinge) {
        const scaledHinge = { ...hinge, halfWidth: hinge.halfWidth * widthScale * uniformScale };
        const s = solveTempleSplay(metric!, rawFace!, anchorLocal, scaledHinge);
        templeSplay = { left: this.splayL.filter(s.left, frame.timestampMs), right: this.splayR.filter(s.right, frame.timestampMs) };
      }
    } else if (st.holdPose && this.last) {
      faceMatrix = this.last.faceMatrix;
      glassesMatrix = this.last.glassesMatrix;
      metric = this.last.faceMetricPoints;
      angles = this.last.angles;
      widthScale = this.last.widthScale;
      uniformScale = this.last.uniformScale;
      realSizeActive = this.last.realSizeActive;
      anchorLocal = this.last.anchorLocal;
      templeSplay = this.last.templeSplay;
    } else {
      this.poseFilter.reset();
      this.widthFilter.reset();
      this.splayL.reset();
      this.splayR.reset();
    }

    let bridgeAnchor: FitOutput['bridgeAnchor'] = null;
    if (glassesMatrix) {
      const point = mTransformPoint(glassesMatrix, [0, 0, 0]);
      bridgeAnchor = { point, screen: cam.project(point) };
    }

    const out: FitOutput = {
      timestampMs: frame.timestampMs,
      state: st.state,
      alpha: st.alpha,
      detected,
      rawFaceMatrix: rawFace,
      faceMatrix,
      glassesMatrix,
      faceMetricPoints: metric,
      angles,
      widthScale,
      uniformScale,
      realSizeActive,
      anchorLocal,
      templeSplay,
      bridgeAnchor,
      pd,
      confidence,
      filterStrength: st.filterStrength,
    };
    this.last = out;
    return out;
  }
}
