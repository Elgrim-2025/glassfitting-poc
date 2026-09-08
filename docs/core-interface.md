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
  forwardMm: number;                      // 앵커 z에 더한 전방 보정 (0..maxForwardMm)
  penetration: { temple: number; brow: number; cheek: number; nose: number };
  // 보정 후 남은 관통량(mm, 양수 = 관통). 안전 여유(templeMm/rimMm)는 빼고, 코 패드는 padSinkMm 만큼 가라앉은 뒤 기준.
  // 정상이면 모두 ≤ 0. 프로브가 닿지 않는 영역은 -Infinity (JSON에서는 null).
}

interface AssetAnchor {
  bridge: Vec3; temple_left: Vec3; temple_right: Vec3; nose_pad_offset: Vec3;
  lens_plane_mm?: number;   // 렌즈 평면 z (기본 4)
  rim_depth_mm?: number;    // 렌즈 평면에서 림 뒷면까지 (기본 4)
  rim_width_mm?: number;    // 렌즈 가장자리에서 림 바깥면까지 (기본 4)
  temple_bend_mm?: number;  // 힌지에서 귀 굽힘 시작까지 (기본 0.68·temple_mm)
  temple_drop_mm?: number;  // 굽힘 이후 끝까지 내려가는 높이 (기본 28)
}
```

설정 추가(`config.placement`): `pantoscopicTiltDeg: 8`, `clearance: { templeMm: 2.5, rimMm: 1.5, padSinkMm: 1.0, maxForwardMm: 15, maxSplayDeg: 15 }`, `depthSource: 'canonical' | 'landmark'`(메트릭 점의 깊이 출처 — 정규 모델 깊이(기본, 안정) 또는 MediaPipe 랜드마크 z(개인 코·볼 깊이 반영, 실기기에서 비교)).

출력 추가(`FitOutput.tiltDeg`): 프런트에 적용한 팬토스코픽 틸트(°). 다리는 수평을 유지해야 하므로 렌더러가 힌지 기준으로 `Rx(−tilt)`를 다리 노드에 곱한다(`glasses.ts applySplay`, Blender 벤치 `fit_bench.py place()` 동일).

## 2. 처리 순서 (`FittingCore.process`)

1. `mpMatrixToMm` — 이동 성분 ×10 (cm → mm), 옵션 전치.
2. `toMetricLandmarks` — 정규화 x,y를 행렬 깊이(정규 모델 강체 변환)로 역투영. 홍채 10점은 눈 윤곽 깊이 평균.
3. `anglesFromMatrix` — R = Ry(yaw)·Rx(pitch)·Rz(roll).
4. 신뢰도 = min(1, 0.6·관자놀이 폭 px / minFaceWidthPx), 행렬 tz가 −100~−2000 mm 밖이면 ≤ 0.5.
5. `TrackingStateMachine.update` — Tracking/Degraded/Lost, 유지 12프레임, 페이드 300 ms, 재획득 3프레임.
6. `PoseFilter.filter` — T/Q/S 분해 → One-Euro(위치 1.0/0.02, 회전 1.0/0.5, 스케일 0.5/0) → 합성. Degraded 시 strength 2.
7. `solveWidthScale` — 관자놀이(127↔356)·눈 외각(33↔263) 폭의 정규 모델 대비 비율(0.6/0.4 가중), 0.8~1.25 클램프, One-Euro(0.3 Hz).
8. 실치수 모드: PD 준비 시 `uniform = 홍채 깊이(world) / 홍채 거리(mm)`, 0.7~1.4 클램프.
9. `solveNoseLanding` — 능선 168→6→197→195→5, 착지 y = y(6) + 코패드 프리셋(fixed 0 / adjustable −3) − 0.8·max(0, bridge − 18), z는 능선 보간 + 클리어런스 1 mm.
10. `solveClearance` — 메트릭 점을 `inv(rawFace)`로 얼굴 로컬로 옮긴 뒤:
    - 영역 인덱스는 정규 모델에서 기하 조건으로 모듈 로드 시 계산: SIDE_L/R(|x| > 50, y ∈ [−5, 65]), NOSE_L/R(2 < |x| < 22, z > 45, y ∈ [−15, 35]), BROW(|x| < 60, y ∈ [35, 62], z > 40), CHEEK_L/R(18 < |x| < 66, y ∈ [−30, 15], z > 25). L = −X(이미지 왼쪽).
    - 전방 보정: 렌즈 바운딩 박스의 둥근 사각형(중심 x = ±(bridge/2 + lens_width/2), y = −3, 모서리 반경 0.25·lens_height, 24점/렌즈)을 z = lens_plane − rim_depth에 놓고 T(anchor)·Rx(tilt)·S·T(−bridge)로 옮긴 림 프로브(외곽선은 rim_width_mm만큼 바깥으로 키워 코 쪽 안쪽 림 면까지 포함)와 코 패드 프로브(x = ±(bridge/2 − 1), adjustable은 최소 8; y·z = nose_pad_offset)를 BROW·CHEEK·NOSE 높이장 z(x,y)(xy 최근접 3점 역거리 가중, 최근접이 12 mm 밖이면 해당 영역 없음)와 비교. push = max(z_face − z_probe + margin), margin = rimMm(림) / −padSinkMm(패드), 0 ≤ push ≤ maxForwardMm → 앵커 z에 더함.
    - 다리 벌림: 보정된 앵커 기준 힌지(에셋 temple_left/right, 없으면 스펙 추정) 주위로, SIDE 정점 중 다리 높이 창(|p.y − armY(p.z)| ≤ 15 mm, 힌지보다 ≥ 3 mm 뒤)에 대해 tan θ ≥ (sign·(p.x − hingeX) + templeMm)/(hingeZ − p.z), 0 ≤ θ ≤ maxSplayDeg. armY(z)는 힌지 높이를 temple_bend_mm까지 유지하고 이후 temple_drop_mm 만큼 선형 하강하는 3점 폴리라인(틸트 적용 후).
    - penetration은 보정 후, 여유 없이 측정(다리: 정점 − 다리 중심선, 림: z_face − z_rim, 코: max(림, 패드 − padSinkMm)).
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
| `SIDE_L/R, NOSE_L/R, BROW, CHEEK_L/R` (`IntArray`) | 앱 시작 시 같은 기하 조건으로 `CANONICAL_VERTICES_MM`에서 계산 | 인덱스 하드코딩 금지 — 정규 모델 갱신 시 자동 추종 |
| `solveClearance`, `rimProbes`, `padProbes`, `templeArm`, `heightAt` | 동일 순수 함수 | 프레임당 ~50 프로브 × ~40 정점, 할당 없이 구현 가능 |
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
