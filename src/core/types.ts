/** Public types of the platform-independent fitting core. */
import type { Mat4 } from './math/mat4';
import type { Vec3 } from './math/vec3';

export interface Landmark {
  /** Normalized image x (0..1, left → right). */
  x: number;
  /** Normalized image y (0..1, top → bottom). */
  y: number;
  /** Relative depth in image-width units; smaller = closer to the camera. */
  z: number;
}

/** One tracker frame. Mirrors MediaPipe FaceLandmarker output for one face. */
export interface FrameInput {
  timestampMs: number;
  imageWidth: number;
  imageHeight: number;
  /** 478 landmarks, or null when no face was detected. */
  landmarks: Landmark[] | null;
  /** Raw MediaPipe facial transformation matrix (16 numbers, column-major, cm), or null. */
  matrix: number[] | null;
  /** Blendshape scores by category name (e.g. eyeBlinkLeft), or null when disabled. */
  blendshapes: Record<string, number> | null;
}

export type TrackingState = 'Tracking' | 'Degraded' | 'Lost';

export interface Angles {
  /** Rotation about +Y (deg). Positive = face turned toward image-right. */
  yaw: number;
  /** Rotation about +X (deg). Positive = looking up. */
  pitch: number;
  /** Rotation about +Z (deg). Positive = head tilted counter-clockwise on screen. */
  roll: number;
}

export type NosePadType = 'fixed' | 'adjustable';

export interface FrameSpec {
  lens_width_mm: number;
  bridge_mm: number;
  temple_mm: number;
  lens_height_mm: number;
  frame_width_mm: number;
  nose_pad: NosePadType;
}

export interface AssetAnchor {
  bridge: Vec3;
  temple_left: Vec3;
  temple_right: Vec3;
  nose_pad_offset: Vec3;
  /** Lens plane z in GLB coordinates (mm, default 4). */
  lens_plane_mm?: number;
  /** Depth from the lens plane to the rim's back face (mm, default 4). */
  rim_depth_mm?: number;
  /** Rim width from the lens edge outward (mm), default 4; the inner rims reach this far toward the nose. */
  rim_width_mm?: number;
  /** Straight arm length from the hinge to where the ear bend starts (mm, default 0.68·temple_mm). */
  temple_bend_mm?: number;
  /** Height the arm drops from the bend to its tip (mm, default 28). */
  temple_drop_mm?: number;
}

/** Per-region residual penetration after the clearance correction (mm, positive = still penetrating). */
export interface ClearancePenetration {
  temple: number;
  brow: number;
  cheek: number;
  nose: number;
}

export interface ClearanceResult {
  /** Unfiltered outward temple rotation about each hinge (radians). */
  splay: { left: number; right: number };
  /** Forward (+Z) push applied to the nose-landing anchor (mm, 0..maxForwardMm). */
  forwardMm: number;
  penetration: ClearancePenetration;
}

export interface ClearanceConfig {
  /** Required gap between the arm centreline and the side of the head (mm). */
  templeMm: number;
  /** Required gap between the rim's back face and the brow/cheek/nose surface (mm). */
  rimMm: number;
  /** How far a nose pad may sink into the skin (mm). */
  padSinkMm: number;
  maxForwardMm: number;
  maxSplayDeg: number;
}

export interface PdEstimate {
  /** Distance PD (mm), converted from the near value. */
  pd_far: number;
  /** Near PD measured while looking at the screen (mm). */
  pd_near: number;
  pd_mono_left: number;
  pd_mono_right: number;
  /** 0..1, based on sample count, spread and gating stability. */
  confidence: number;
  sample_count: number;
  /** ± half-width (mm) of the 95 % interval of the median. */
  ci_mm: number;
  /** Estimated face–camera distance (mm) from iris size. */
  distance_mm: number;
  iris_diameter_px: number;
  status: 'collecting' | 'ready' | 'idle';
  /** Why the last frame was rejected, for the HUD. */
  last_reject: string | null;
}

export interface OneEuroParams {
  minCutoff: number;
  beta: number;
  dCutoff: number;
}

export interface FittingConfig {
  camera: { fovYDeg: number };
  /** Treat MediaPipe matrix data as row-major (debug toggle; default column-major). */
  transposeMatrix: boolean;
  filter: {
    enabled: boolean;
    position: OneEuroParams;
    rotation: OneEuroParams;
    scale: OneEuroParams;
  };
  tracking: {
    maxYawDeg: number;
    maxPitchDeg: number;
    maxRollDeg: number;
    minFaceWidthPx: number;
    holdFrames: number;
    fadeMs: number;
    reacquireFrames: number;
  };
  placement: {
    /** Apply user width-scale correction (temple width vs canonical). */
    widthScaleEnabled: boolean;
    /** Real-size mode: render the frame in true mm without width scaling. */
    realSizeMode: boolean;
    widthScaleMin: number;
    widthScaleMax: number;
    /** Extra forward offset of the bridge from the nose surface (mm). */
    bridgeClearanceMm: number;
    /** Vertical landing offset presets by nose-pad type (mm, negative = lower). */
    nosePadDropMm: Record<NosePadType, number>;
    /** Use Kabsch pose estimated from landmarks instead of the MediaPipe matrix. */
    useKabschPose: boolean;
    /** Depth of the metric face points: the posed canonical model (stable) or MediaPipe's per-landmark z (personal nose/cheek depth). */
    depthSource: 'canonical' | 'landmark';
    /** Pantoscopic tilt about +X (deg); positive tips the lens top toward the camera. */
    pantoscopicTiltDeg: number;
    clearance: ClearanceConfig;
  };
  pd: {
    irisDiameterMm: number;
    maxYawDeg: number;
    maxPitchDeg: number;
    maxBlink: number;
    maxGaze: number;
    minIrisPx: number;
    /** Face centre must be within this normalized distance from the image centre. */
    maxCenterOffset: number;
    minSamples: number;
    maxSamples: number;
    /** Eye rotation centre to corneal plane (mm), for near→far conversion. */
    eyeRotationCenterMm: number;
  };
}

export interface FitOutput {
  timestampMs: number;
  state: TrackingState;
  /** Presence alpha 0..1 (fades out after loss). */
  alpha: number;
  detected: boolean;
  /** Face matrix in mm (column-major), before filtering. Null when not detected. */
  rawFaceMatrix: Mat4 | null;
  /** Face matrix in mm after temporal filtering (or last held pose). */
  faceMatrix: Mat4 | null;
  /** Final glasses node matrix in mm (face · anchor · scale). */
  glassesMatrix: Mat4 | null;
  /** 478 × 3 camera-space points in mm (screen-exact xy), for occlusion/HUD. */
  faceMetricPoints: Float32Array | null;
  angles: Angles | null;
  /** X-only proportional width correction actually applied. */
  widthScale: number;
  /** Uniform scale actually applied (≠ 1 only in real-size mode with a PD estimate). */
  uniformScale: number;
  realSizeActive: boolean;
  /** Nose landing anchor in the face-local frame (mm). */
  anchorLocal: Vec3 | null;
  /** Outward temple rotation about each hinge (radians), temporally filtered. */
  templeSplay: { left: number; right: number };
  /** Pantoscopic tilt applied to the front (deg). Temples stay level: the rig counter-rotates them. */
  tiltDeg: number;
  /** Clearance solve of this frame (null when no spec is set or the pose is held). */
  clearance: ClearanceResult | null;
  /** Bridge anchor in camera space (mm) and its projection (normalized). */
  bridgeAnchor: { point: Vec3; screen: { x: number; y: number } } | null;
  pd: PdEstimate;
  confidence: number;
  /** Current effective filter strength multiplier (1 = base, >1 = stronger smoothing). */
  filterStrength: number;
}
