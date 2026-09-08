# 공용 코어 인터페이스 정의 (TypeScript ↔ Kotlin 매핑)

`src/core`는 DOM·WebGL·Three.js에 의존하지 않는 순수 TypeScript다. 안드로이드 본 개발에서는 같은 구조를 Kotlin으로 이식하고, 골든 벡터(`tests/golden/*.json` 및 앱에서 내보낸 파일)를 허용 오차 내로 재현해야 통과한다.

## 1. 입력·출력

```ts
interface FrameInput {
  timestampMs: number;
  imageWidth: number; imageHeight: number;
  landmarks: { x: number; y: number; z: number }[] | null;   // 478, 정규화 좌표
  matrix: number[] | null;                                  // 16, column-major, cm (MediaPipe 원본)
  blendshapes: Record<string, number> | null;               // 52 카테고리
}

interface FitOutput {
  state: 'Tracking' | 'Degraded' | 'Lost';
  alpha: number;                     // 0..1 표시 강도(소실 후 페이드)
  rawFaceMatrix: number[] | null;    // mm, column-major
  faceMatrix: number[] | null;       // 필터 적용 후
  glassesMatrix: number[] | null;    // face · T(anchorLocal) · S(uniform·width, uniform, uniform) · T(−assetBridge)
  faceMetricPoints: Float32Array | null; // 478×3 카메라 공간 mm (오클루더용)
  angles: { yaw; pitch; roll } | null;   // deg
  widthScale: number; uniformScale: number; realSizeActive: boolean;
  anchorLocal: Vec3 | null;          // 얼굴 로컬 프레임의 코 착지점(전방 보정 포함)
  templeSplay: { left; right };      // rad, One-Euro 필터 적용
  clearance: ClearanceResult | null; // 클리어런스 솔브(스펙 없음·포즈 유지 시 null)
  bridgeAnchor: { point: Vec3; screen: { x; y } } | null;
  pd: PdEstimate; confidence: number; filterStrength: number;
}

interface ClearanceResult {
  splay: { left: number; right: number }; // rad, 필터 전 솔버 출력
  forwardMm: number;                      // 앵커 z에 더한 전방 보정 (−maxForwardMm..maxForwardMm; 음수 = 정점 상한이 뒤로 당김)
  penetration: { temple: number; brow: number; cheek: number; nose: number };
  // 보정 후 남은 관통량(mm, 양수 = 관통). 안전 여유(templeMm/rimMm/bridgeMm)는 빼고, 허용 침하(padSinkMm, noseSinkMm)를 넘는 만큼만.
  // 정상이면 모두 ≤ 0. 프로브가 닿지 않는 영역은 -Infinity (JSON에서는 null).
  vertexMm: number;                       // 렌즈 뒷면(lens_back_mm) – 각막(눈꺼풀 159/145/386/374 평균 z + 1.5) 거리
  padGapMm: number;                       // 패드 접촉면 – 코 옆면 간격(+ = 떠 있음, − = 가라앉음; 두 패드 중 최소)
}

interface AssetAnchor {
  bridge: Vec3; temple_left: Vec3; temple_right: Vec3;
  nose_pad_offset: Vec3;    // +X 패드 접촉점 (x = 패드 중심 |x|, 0이면 스펙에서 유도; y; z = 접촉면 깊이)
  lens_plane_mm?: number;   // 렌즈 평면 z (기본 4)
  lens_back_mm?: number;    // 렌즈 광학 중심 뒷면 z (기본 lens_plane_mm − 1)
  rim_depth_mm?: number;    // 렌즈 평면에서 림 뒷면까지 (기본 4)
  rim_back_mm?: number;     // 림 뒷면 z (기본 lens_plane_mm − rim_depth_mm)
  rim_width_mm?: number;    // 렌즈 가장자리에서 림 바깥면까지 (기본 4)
  rim_outline_mm?: [number, number][]; // +X 림 바깥 경계 폐곡선(프레임 mm). 없으면 둥근 사각형 기본 외곽선
  temple_bend_mm?: number;  // 힌지에서 귀 굽힘 시작까지 (기본 0.68·temple_mm)
  temple_drop_mm?: number;  // 굽힘 이후 끝까지 내려가는 높이 (기본 28)
}
```

설정(`config.placement`): `pantoscopicTiltDeg: 8`, `bridgeClearanceMm: 1`(브릿지 바–콧대 여유; 패드 정보가 없을 때의 능선 폴백 오프셋), `clearance: { templeMm: 2.5, rimMm: 1.0, padSinkMm: 1.0, noseSinkMm: 2.0, maxForwardMm: 15, maxSplayDeg: 15, vertexMinMm: 10, vertexMaxMm: 23 }`, `depthSource: 'hybrid' | 'canonical' | 'landmark'`(메트릭 점의 깊이 출처 — 하이브리드(기본): 정규 모델 깊이 + 코 영역만 랜드마크 z를 눈 기준으로 정렬해 블렌드(`NOSE_DEPTH_WEIGHTS`, 상자 |x| ≤ 18, y ∈ [−22, 36], z ≥ 48 + 6 mm 가우시안 스커트); 정규 모델 깊이 전체; 랜드마크 z 전체).

출력 추가(`FitOutput.tiltDeg`): 프런트에 적용한 팬토스코픽 틸트(°). 다리는 수평을 유지해야 하므로 렌더러가 힌지 기준으로 `Rx(−tilt)`를 다리 노드에 곱한다(`glasses.ts applySplay`, Blender 벤치 `fit_bench.py place()` 동일).

## 2. 처리 순서 (`FittingCore.process`)

1. `mpMatrixToMm` — 이동 성분 ×10 (cm → mm), 옵션 전치.
2. `toMetricLandmarks` — 정규화 x,y를 깊이 출처(하이브리드/정규/랜드마크)로 역투영. 하이브리드는 눈 기준점 8개(눈꺼풀·눈꼬리)에서 `posed_z − (tz − lm.z·widthMm)`의 평균을 오프셋으로 잡고 코 가중치만큼 랜드마크 깊이를 섞는다. 홍채 10점은 눈 윤곽 깊이 평균.
3. `anglesFromMatrix` — R = Ry(yaw)·Rx(pitch)·Rz(roll).
4. 신뢰도 = min(1, 0.6·관자놀이 폭 px / minFaceWidthPx), 행렬 tz가 −100~−2000 mm 밖이면 ≤ 0.5.
5. `TrackingStateMachine.update` — Tracking/Degraded/Lost, 유지 12프레임, 페이드 300 ms, 재획득 3프레임.
6. `PoseFilter.filter` — T/Q/S 분해 → One-Euro(위치 1.0/0.02, 회전 1.0/0.5, 스케일 0.5/0) → 합성. Degraded 시 strength 2.
7. `solveWidthScale` — 관자놀이(127↔356)·눈 외각(33↔263) 폭의 정규 모델 대비 비율(0.6/0.4 가중), 0.8~1.25 클램프, One-Euro(0.3 Hz).
8. 실치수 모드: PD 준비 시 `uniform = 홍채 깊이(world) / 홍채 거리(mm)`, 0.7~1.4 클램프.
9. `solveNoseLanding` — 능선 168→6→197→195→5, 착지 y = y(6) + 코패드 프리셋(fixed 0 / adjustable −5) − (adjustable만) 0.8·max(0, bridge − 18). 깊이: 에셋 패드 접촉점(±x, y, z; 틸트·스케일 적용)을 코 삼각형 높이장(`faceSurface.NOSE_TRIS`, |x| < 24, y ∈ [−20, 40], z > 44)에 얹어 z0 = z_face − padSinkMm − dz(두 패드 중 앞쪽). 패드 정보가 없거나 높이장 밖이면 능선 보간 z + bridgeClearanceMm(폴백).
10. `solveClearance` — 메트릭 점을 `inv(rawFace)`로 얼굴 로컬로 옮긴 뒤:
    - 영역: 다리는 정점 집합 SIDE_L/R(|x| > 50, y ∈ [−5, 65]); 림·바·패드는 삼각형 집합(`faceSurface.ts`: 정규 삼각분할 중 세 정점이 조건을 만족하는 것) NOSE_TRIS, BROW_TRIS(|x| < 62, y ∈ [32, 66], z > 36), CHEEK_L/R_TRIS(16 < |x| < 68, y ∈ [−34, 18], z > 22)에서 `surfaceZ`(무게중심 보간, 가장 앞 삼각형; 없으면 null). L = −X(이미지 왼쪽).
    - 전방 보정: 림 프로브 = 에셋 `rim_outline_mm`(+X 림 바깥 경계, 24점으로 재표본; −X는 거울상)를 z = rim_back_mm에 두고 T(anchor)·Rx(tilt)·S·T(−bridge)로 옮긴 것(외곽선이 없으면 렌즈 박스를 rim_width만큼 키운 둥근 사각형); 브릿지 바 프로브 5점(y = −3 + 0.3·lens_height, z = rim_back); 패드 프로브 = 접촉점. push = max(림 vs 눈썹·볼: gap + rimMm, 림 vs 코: gap + rimMm − noseSinkMm, 바 vs 코: gap + bridgeMm, 패드 vs 코: gap − padSinkMm), gap = z_face − z_probe.
    - 정점 클램프: cornea = 눈꺼풀 4점 평균 z + 1.5; 렌즈 뒷면 오프셋 = (−3·sin tilt + lens_back·cos tilt)·uniform; forward = clamp(min(max(push, zMin − a0z), zMax − a0z), −maxForwardMm, maxForwardMm), zMin/zMax = cornea + vertexMin/Max − 오프셋 → 앵커 z에 더함. `vertexMm`, `padGapMm`는 보정 후 값.
    - 다리 벌림: 보정된 앵커 기준 힌지(에셋 temple_left/right, 없으면 스펙 추정) 주위로, SIDE 정점 중 다리 높이 창(|p.y − armY(p.z)| ≤ 15 mm, 힌지보다 ≥ 3 mm 뒤)에 대해 tan θ ≥ (sign·(p.x − hingeX) + templeMm)/(hingeZ − p.z), 0 ≤ θ ≤ maxSplayDeg. armY(z)는 힌지 높이를 temple_bend_mm까지 유지하고 이후 temple_drop_mm 만큼 선형 하강하는 3점 폴리라인(틸트 적용 후).
    - penetration은 보정 후, 여유 없이·허용 침하를 넘는 만큼 측정(다리: 정점 − 다리 중심선, 눈썹·볼: z_face − z_rim, 코: max(림 − noseSinkMm, 바, 패드 − padSinkMm)).
11. `composeGlassesMatrix(face, anchor, scale, asset, pantoscopicTiltDeg)` — face · T(anchor) · Rx(tilt) · S · T(−bridge). 양의 틸트는 렌즈 상단을 +Z(카메라)로 기울인다(다리 끝은 위로).
12. 다리 벌림 One-Euro(0.5 Hz) → `templeSplay`. `clearance.splay`는 필터 전 값.
13. `PdEstimator.update` — 홍채 지름 px(수평·수직 평균, 양안 평균) → mm/px → 근용 PD, 단안 PD(168→197 중심선 수선 거리), 거리 = f_px·11.7/iris_px. 게이팅: |yaw|,|pitch| ≤ 5°, blink < 0.2, gaze < 0.5, iris ≥ 12 px, 중심 이탈 ≤ 0.2. 30~60 샘플 중앙값·IQR·CI. `pd_far = pd_near·(d+13)/d`.

## 3. Kotlin 매핑표

| TypeScript | Kotlin (제안) | 비고 |
|---|---|---|
| `number[16]` column-major | `FloatArray(16)` column-major | Android `android.opengl.Matrix`와 동일 레이아웃. MediaPipe Tasks Android `FaceLandmarkerResult.facialTransformationMatrixes()[0]`도 column-major |
| `Vec3 = [x,y,z]` | `FloatArray(3)` 또는 `data class Vec3` | |
| `Quat = [x,y,z,w]` | `data class Quat(x,y,z,w)` | 순서 주의 |
| `Landmark {x,y,z}` | `NormalizedLandmark` (Tasks Android) | 그대로 |
| `blendshapes: Record<string, number>` | `Map<String, Float>` from `faceBlendshapes().get(0).categories()` | |
| `OneEuroScalar/Vec3/Quat` | 동일 클래스 | dt 단위 초, 수식 동일 |
| `TrackingStateMachine` | 동일 | 프레임 카운트 기반이므로 fps 차이에 유의(holdFrames는 시간 기반으로 바꿔도 됨) |
| `CANONICAL_VERTICES_MM` | `FloatArray` 리소스(같은 스크립트로 생성) | 468×3 |
| `Float32Array` 메트릭 포인트 | `FloatArray(478*3)` | 오클루더 메시 갱신 |
| `PdEstimator` | 동일 | 통계 함수(median, quantile, IQR) 동일 구현 |
| `FittingConfig` | `data class` + 기본값 동일 | `DEFAULT_CONFIG` 참조 |
| `AssetAnchor` 선택 메타(`lens_plane_mm`, `rim_depth_mm`, `rim_width_mm`, `temple_bend_mm`, `temple_drop_mm`) | `Float?` 필드 + `clearance.ts`의 `DEFAULT_*` 기본값 | mock API `assets.anchor`에서 옴 |
| `ClearanceConfig` / `ClearanceResult` | `data class` | `penetration`의 −Infinity는 `Float.NEGATIVE_INFINITY`(JSON null) |
| `SIDE_L/R` (`IntArray`), `NOSE_TRIS/BROW_TRIS/CHEEK_*_TRIS` (`ShortArray`, 삼각형 인덱스) | 앱 시작 시 같은 기하 조건으로 `CANONICAL_VERTICES_MM`/`CANONICAL_TRIANGLES`에서 계산 | 인덱스 하드코딩 금지 — 정규 모델 갱신 시 자동 추종 |
| `surfaceZ`, `solveNoseLanding`(패드 접촉), `solveClearance`, `rimProbes`, `padProbes`, `templeArm`, `corneaZ` | 동일 순수 함수 | 프레임당 ~55 프로브 × ~150 삼각형 무게중심 판정, 할당 없이 구현 가능 |
| `NOSE_DEPTH_WEIGHTS`, `HYBRID_REFERENCE` | `FloatArray(468)` 상수 + 기준 인덱스 | 하이브리드 깊이 출처(`toMetricLandmarks`) |
| `composeGlassesMatrix(..., tiltDeg)` | `Matrix.rotateM(…, tilt, 1, 0, 0)` 위치 주의(T(anchor) 뒤, S 앞) | |

## 4. 골든 벡터

```json
{ "version": 1, "name": "…", "config": {부분 설정}, "spec": {프레임 스펙 | null},
  "tolerance": { "translationMm": 0.5, "rotationDeg": 0.2, "scale": 0.01, "angleDeg": 0.2, "widthScale": 0.01, "pdMm": 0.2, "alpha": 0.02 },
  "frames": [FrameInput…], "expected": [{ "state", "alpha", "glassesMatrix", "angles", "widthScale", "pdNear" }…] }
```

- `tests/golden/synthetic-v1.json`: 합성 시퀀스 40프레임(정지 → yaw 스윕 → 5프레임 소실 → 복귀). `npm test`가 검증한다.
- 실기기 녹화 골든: 앱 HUD "골든 벡터 JSON"으로 내보낸다(녹화 또는 재생 중인 세션 기준).
- Kotlin 검증 러너는 `runGolden`과 같은 비교를 수행한다: 상태 일치, alpha, glassesMatrix의 이동·회전·스케일, 각도, widthScale, pd_near.
