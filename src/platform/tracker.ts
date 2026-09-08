/**
 * MediaPipe FaceLandmarker wrapper producing core FrameInput objects, plus a simple
 * device benchmark that picks the fastest profile meeting a per-frame budget.
 */
import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import type { FrameInput } from '../core/types';

export interface TrackerProfile {
  id: string;
  label: string;
  delegate: 'GPU' | 'CPU';
  blendshapes: boolean;
  /** Input downscale factor applied before detection (1 = camera resolution). */
  inputScale: number;
}

export const TRACKER_PROFILES: TrackerProfile[] = [
  { id: 'gpu-full', label: 'GPU · 전체 해상도 · blendshapes', delegate: 'GPU', blendshapes: true, inputScale: 1 },
  { id: 'gpu-half', label: 'GPU · 1/2 해상도 · blendshapes', delegate: 'GPU', blendshapes: true, inputScale: 0.5 },
  { id: 'gpu-half-lite', label: 'GPU · 1/2 해상도 · blendshapes off', delegate: 'GPU', blendshapes: false, inputScale: 0.5 },
  { id: 'cpu-half-lite', label: 'CPU · 1/2 해상도 · blendshapes off', delegate: 'CPU', blendshapes: false, inputScale: 0.5 },
];

export interface TrackerPaths {
  wasm: string;
  model: string;
}

export const DEFAULT_TRACKER_PATHS: TrackerPaths = {
  wasm: `${import.meta.env.BASE_URL}wasm`,
  model: `${import.meta.env.BASE_URL}models/face_landmarker.task`,
};

let filesetPromise: Promise<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>> | null = null;
const fileset = (wasm: string) => (filesetPromise ??= FilesetResolver.forVisionTasks(wasm));

export class FaceTracker {
  lastDetectMs = 0;
  private lastTs = -1;
  private scaled: HTMLCanvasElement | null = null;

  private constructor(
    private landmarker: FaceLandmarker,
    readonly profile: TrackerProfile,
    readonly effectiveDelegate: 'GPU' | 'CPU',
  ) {}

  static async create(profile: TrackerProfile, paths: TrackerPaths = DEFAULT_TRACKER_PATHS): Promise<FaceTracker> {
    const fs = await fileset(paths.wasm);
    const make = (delegate: 'GPU' | 'CPU') =>
      FaceLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: paths.model, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: profile.blendshapes,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    try {
      return new FaceTracker(await make(profile.delegate), profile, profile.delegate);
    } catch (err) {
      if (profile.delegate === 'GPU') {
        console.warn('[tracker] GPU delegate failed, falling back to CPU', err);
        return new FaceTracker(await make('CPU'), profile, 'CPU');
      }
      throw err;
    }
  }

  /** Runs detection on the current video frame and converts the result to FrameInput. */
  detect(video: HTMLVideoElement, timestampMs: number): FrameInput {
    const w = video.videoWidth, h = video.videoHeight;
    let source: HTMLVideoElement | HTMLCanvasElement = video;
    if (this.profile.inputScale < 1) {
      const sw = Math.round(w * this.profile.inputScale), sh = Math.round(h * this.profile.inputScale);
      if (!this.scaled || this.scaled.width !== sw || this.scaled.height !== sh) {
        this.scaled = document.createElement('canvas');
        this.scaled.width = sw;
        this.scaled.height = sh;
      }
      this.scaled.getContext('2d', { willReadFrequently: false })!.drawImage(video, 0, 0, sw, sh);
      source = this.scaled;
    }
    // MediaPipe requires strictly increasing timestamps.
    let ts = timestampMs;
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    const t0 = performance.now();
    const result = this.landmarker.detectForVideo(source, ts);
    this.lastDetectMs = performance.now() - t0;
    return toFrameInput(result, timestampMs, w, h);
  }

  close(): void {
    this.landmarker.close();
  }
}

export function toFrameInput(result: FaceLandmarkerResult, timestampMs: number, imageWidth: number, imageHeight: number): FrameInput {
  const face = result.faceLandmarks?.[0];
  const matrix = result.facialTransformationMatrixes?.[0]?.data;
  const bs = result.faceBlendshapes?.[0]?.categories;
  return {
    timestampMs,
    imageWidth,
    imageHeight,
    landmarks: face ? face.map((l) => ({ x: l.x, y: l.y, z: l.z })) : null,
    matrix: matrix ? Array.from(matrix) : null,
    blendshapes: bs ? Object.fromEntries(bs.map((c) => [c.categoryName, c.score])) : null,
  };
}

export interface BenchmarkResult {
  profile: TrackerProfile;
  meanMs: number;
}

/** Measures mean inference time per profile (in order) and returns the first one under budget. */
export async function benchmarkProfiles(
  video: HTMLVideoElement,
  profiles: TrackerProfile[],
  framesPerProfile = 20,
  budgetMs = 28,
  onProgress?: (r: BenchmarkResult) => void,
): Promise<{ chosen: TrackerProfile; results: BenchmarkResult[] }> {
  const results: BenchmarkResult[] = [];
  let chosen: TrackerProfile | null = null;
  for (const profile of profiles) {
    const tracker = await FaceTracker.create(profile);
    const times: number[] = [];
    for (let i = 0; i < framesPerProfile + 3; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      tracker.detect(video, performance.now());
      if (i >= 3) times.push(tracker.lastDetectMs); // skip warm-up
    }
    tracker.close();
    const r = { profile, meanMs: times.reduce((a, b) => a + b, 0) / times.length };
    results.push(r);
    onProgress?.(r);
    if (r.meanMs <= budgetMs) { chosen = profile; break; }
  }
  return { chosen: chosen ?? profiles[profiles.length - 1], results };
}
