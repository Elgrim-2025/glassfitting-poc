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
  anchorLocal: Vec3 | null;          // 얼굴 로컬 프레임의 코 착지점
  templeSplay: { left; right };      // rad
  bridgeAnchor: { point: Vec3; screen: { x; y } } | null;
  pd: PdEstimate; confidence: number; filterStrength: number;
}
```

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
10. `composeGlassesMatrix`.
11. `solveTempleSplay` — 힌지(에셋 anchor 또는 스펙)와 127/356·234/454로 벌림 각(≤ 15°), One-Euro(0.5 Hz).
12. `PdEstimator.update` — 홍채 지름 px(수평·수직 평균, 양안 평균) → mm/px → 근용 PD, 단안 PD(168→197 중심선 수선 거리), 거리 = f_px·11.7/iris_px. 게이팅: |yaw|,|pitch| ≤ 5°, blink < 0.2, gaze < 0.5, iris ≥ 12 px, 중심 이탈 ≤ 0.2. 30~60 샘플 중앙값·IQR·CI. `pd_far = pd_near·(d+13)/d`.

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

## 4. 골든 벡터

```json
{ "version": 1, "name": "…", "config": {부분 설정}, "spec": {프레임 스펙 | null},
  "tolerance": { "translationMm": 0.5, "rotationDeg": 0.2, "scale": 0.01, "angleDeg": 0.2, "widthScale": 0.01, "pdMm": 0.2, "alpha": 0.02 },
  "frames": [FrameInput…], "expected": [{ "state", "alpha", "glassesMatrix", "angles", "widthScale", "pdNear" }…] }
```

- `tests/golden/synthetic-v1.json`: 합성 시퀀스 40프레임(정지 → yaw 스윕 → 5프레임 소실 → 복귀). `npm test`가 검증한다.
- 실기기 녹화 골든: 앱 HUD "골든 벡터 JSON"으로 내보낸다(녹화 또는 재생 중인 세션 기준).
- Kotlin 검증 러너는 `runGolden`과 같은 비교를 수행한다: 상태 일치, alpha, glassesMatrix의 이동·회전·스케일, 각도, widthScale, pd_near.
