# Virtual Glasses Fitting PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the web PoC described in `docs/superpowers/specs/2026-09-08-virtual-glasses-fitting-poc-design.md`: a browser app that tracks a face with MediaPipe Face Landmarker, drives a real-size (mm) glasses model with a filtered face transform, measures a reference PD from iris landmarks, and exposes a QA HUD with recording/replay and metric export.

**Architecture:** A platform-independent **fitting core** (`src/core`, pure TypeScript, no DOM/Three.js) consumes `FrameInput` (478 landmarks + 4×4 matrix + blendshapes) and returns `FitOutput` (filtered glasses matrix, tracking state, metric face points, width scale, PD). A **web platform layer** (`src/platform`) wraps camera, MediaPipe, Three.js rendering (face/head occluders, GLB glasses), HUD, recorder/replay, and the mock product API. Node scripts generate the canonical model data module and three sample GLB frames.

**Tech Stack:** TypeScript 5.9, Vite 8, Vitest 5, `@mediapipe/tasks-vision` 1.0, Three.js r185.

---

## File structure

| Path | Responsibility |
|---|---|
| `src/core/types.ts` | `FrameInput`, `FitOutput`, `PdEstimate`, `TrackingState`, config types |
| `src/core/landmarks.ts` | Landmark index constants (spec Appendix A) |
| `src/core/math/vec3.ts`, `quat.ts`, `mat4.ts` | Minimal linear algebra, column-major `number[16]` |
| `src/core/math/eigen.ts` | Jacobi eigen-decomposition for symmetric 4×4 (Horn's method) |
| `src/core/math/kabsch.ts` | Weighted absolute orientation (rotation, translation, uniform scale) |
| `src/core/math/stats.ts` | median, IQR filter, std, mean, CI, cross-correlation lag |
| `src/core/filters/oneEuro.ts` | One-Euro filter for scalar / vec3 / quaternion |
| `src/core/filters/poseFilter.ts` | Matrix → TRS → One-Euro → matrix, with strength multiplier |
| `src/core/tracking/angles.ts` | yaw/pitch/roll (deg) from a rotation matrix |
| `src/core/tracking/stateMachine.ts` | Tracking/Degraded/Lost with hysteresis, hold and fade |
| `src/core/fitting/canonical.ts` | **Generated** canonical face vertices (mm) + triangles |
| `src/core/fitting/camera.ts` | Pinhole model matching MediaPipe (fovY 63°): project/unproject |
| `src/core/fitting/mediapipeMatrix.ts` | MediaPipe matrix (cm) → mm matrix; optional transpose |
| `src/core/fitting/metricLandmarks.ts` | Normalized landmarks → camera-space mm points |
| `src/core/fitting/scaleSolver.ts` | User width scale from temple width vs canonical |
| `src/core/fitting/noseLanding.ts` | Bridge landing offset from nose ridge depth and bridge width |
| `src/core/fitting/anchorSolver.ts` | Compose glasses matrix = face · T(anchor) · S(scale) |
| `src/core/fitting/kabschPose.ts` | Alternative pose estimate from metric landmarks |
| `src/core/pd/pdEstimator.ts` | Iris scale, gating, accumulation, statistics, near→far |
| `src/core/metrics/jitter.ts`, `latency.ts`, `fps.ts` | QA meters |
| `src/core/fittingCore.ts` | `FittingCore.process(frame)` facade |
| `src/core/golden.ts` | Golden vector format + comparison runner |
| `src/platform/camera.ts` | getUserMedia + `<video>` |
| `src/platform/tracker.ts` | FaceLandmarker wrapper, performance profiles |
| `src/platform/frameLoop.ts` | `requestVideoFrameCallback` loop with rAF fallback |
| `src/platform/render/scene.ts` | Three.js scene, camera alignment, layering |
| `src/platform/render/faceOccluder.ts` | Depth-only face mesh from metric points |
| `src/platform/render/headOccluder.ts` | Ellipsoid head occluder attached to face matrix |
| `src/platform/render/glasses.ts` | GLB loader, anchor nodes, dimension check, procedural fallback |
| `src/platform/render/proceduralGlasses.ts` | Spec-driven procedural frame geometry |
| `src/platform/hud/overlay.ts` | Landmark overlay canvas (mirrored with video) |
| `src/platform/hud/panel.ts` | Stats + controls (filter sliders, toggles, PD, export) |
| `src/platform/session/recorder.ts` | Record `FrameInput[]`, replay, CSV/golden export |
| `src/platform/product/adapter.ts` | Mock product master API client |
| `src/platform/app.ts`, `src/main.ts`, `index.html`, `src/style.css` | Wiring |
| `scripts/canonical-to-ts.mjs` | OBJ → `canonical.ts` |
| `scripts/gen-frames.mjs` | Three sample GLB frames + `public/api/v1/frames.json` |
| `scripts/fetch-models.mjs` | Download `.task` model + canonical OBJ |
| `docs/api/openapi.yaml`, `docs/assets/glb-spec.md`, `docs/core-interface.md`, `README.md` | Deliverable docs |

## Tasks

### Task 1: Core math (vec3, quat, mat4) — TDD
- Tests: compose/decompose round trip, multiply, invert, slerp shortest path, quaternion↔matrix.
- Commit: `feat(core): minimal linear algebra`.

### Task 2: Canonical face model generation
- `scripts/canonical-to-ts.mjs` parses `public/models/canonical_face_model.obj` (468 `v`, 898 `f`), emits `src/core/fitting/canonical.ts` with `CANONICAL_VERTICES_MM: Float32Array` (cm×10) and `CANONICAL_TRIANGLES: Uint16Array`.
- Test: vertex count 468, triangle count 898, indices < 468, nose tip (index 1) z is the maximum z among ridge points.

### Task 3: Camera model + MediaPipe matrix conversion + metric landmarks
- `CameraModel(fovYDeg, aspect, imageWidth, imageHeight)` with `project(p: Vec3): {x,y}` (normalized 0..1) and `unprojectNormalized(x, y, zCam): Vec3`.
- `mpMatrixToMm(data: number[], transpose = false): Mat4`.
- `toMetricLandmarks(landmarks, faceMatrixMm, cam): Float32Array` — screen xy exact, depth = tz − z_rel·widthAtDepth.
- Tests: projecting canonical vertices transformed by a synthetic matrix and unprojecting returns the same points; translation index sanity.

### Task 4: One-Euro filters + pose filter — TDD
- Tests: constant input → identical output; step input converges; strong smoothing reduces noise variance; quaternion filter stays normalized and handles sign flips.

### Task 5: Angles + state machine — TDD
- `anglesFromMatrix(m): {yaw,pitch,roll}` degrees using canonical face convention (+Z toward camera).
- `TrackingStateMachine.update({detected, confidence, angles}) → {state, alpha, filterStrength}`.
- Tests: detection loss holds 12 frames then fades to 0 over 300 ms; re-acquire needs 3 consecutive good frames; out-of-range yaw → Degraded.

### Task 6: Kabsch/Horn absolute orientation — TDD
- Tests: recover known rotation/translation/scale from transformed canonical points with weights and noise.

### Task 7: Scale solver + nose landing + anchor solver — TDD
- `solveWidthScale(metricPts, faceMatrixMm)`: ratio of user temple width (127↔356) to canonical width in the face frame; clamped 0.8..1.25.
- `solveNoseLanding(metricPts, faceMatrixMm, spec, preset)`: bridge point = midpoint(168, 6) in canonical frame; Z offset from ridge depth (6,197,195) ensures bridge does not intersect the nose; Y offset per nose pad preset.
- `composeGlassesMatrix(faceMatrixMm, anchor, widthScale, realSize)`.

### Task 8: PD estimator — TDD
- Tests: synthetic landmarks with known iris px diameter and pupil distance produce expected mm; gating rejects blink/yaw; statistics median/IQR/CI; near→far conversion monotonic.

### Task 9: Metrics (jitter, latency, fps) — TDD
- Cross-correlation lag test: filtered = raw delayed by 3 frames → lag 3.

### Task 10: FittingCore facade + golden vectors
- `FittingCore.process(frame)`; synthetic sequence test → generate `tests/golden/synthetic-v1.json`; runner compares within tolerance.

### Task 11: Sample GLB frames + mock API
- `scripts/gen-frames.mjs` writes minimal GLB (JSON + BIN) for three frames (square/round/aviator) with node names `anchor_bridge`, `anchor_temple_L`, `anchor_temple_R`, `lens_L`, `lens_R`, `frame_front`, `temple_L`, `temple_R`, mm units, origin at bridge; and `public/api/v1/frames.json` + `public/api/v1/frames/FR-000N.json`.
- Test: parse the GLB header/JSON, check node names and vertex count.

### Task 12: Web platform — camera, tracker, frame loop, renderer, occluders, glasses rig
- Three.js `PerspectiveCamera(63, aspect, 10, 100000)`; transparent WebGL canvas above mirrored video; face occluder (`colorWrite=false`, renderOrder −1); head ellipsoid; glasses group with `matrixAutoUpdate=false`.

### Task 13: HUD, recorder/replay, product adapter, app wiring
- Panel: FPS, pipeline ms, state, yaw/pitch/roll, jitter px/deg, latency ms, width scale, PD readout with "참고용" notice; toggles: filter, occluder, landmarks, real-size mode, transpose matrix, mirror; sliders: minCutoff, beta; buttons: record start/stop, save JSON, load & replay, export CSV, export golden.

### Task 14: Docs
- `docs/api/openapi.yaml`, `docs/assets/glb-spec.md`, `docs/core-interface.md` (TS↔Kotlin mapping), `README.md` (setup, run, verification procedure, metric definitions, Go/No-Go table).

### Task 15: Verification
- `npm run typecheck`, `npm test`, `npm run build`; smoke-test the page in the browser with replay of the synthetic golden sequence (no camera needed).
