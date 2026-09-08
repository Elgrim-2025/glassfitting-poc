# 안경 3D 품질 · 얼굴 관통 방지 — 설계 명세

> 실착용 테스트에서 보고된 두 문제(① 안경 모델 품질·다리 끊김, ② 안경이 얼굴을 뚫고 들어감)의 원인 분석과 해결 설계. PoC 설계 명세(`2026-09-08-virtual-glasses-fitting-poc-design.md`) §3.2 "자연스러운 위치"의 후속 작업이다.

## 1. 원인 분석 (Blender 재현)

정규 얼굴 모델 + 현재 GLB(FR-0001)를 Blender에 런타임과 같은 배치(브릿지 앵커 = 랜드마크 6 + 1 mm, 다리 벌림 8.0°)로 올려 측정·렌더한 결과.

| 증상 | 원인 | 근거 |
|---|---|---|
| 모델 품질 저하, 실제 안경과 다름 | 절차적 지오메트리가 림·브릿지·다리를 모두 지름 2~3 mm **원형 튜브**로 만든다. 아세테이트 프레임의 납작한 림(폭 4~5 mm), 엔드피스 블록, 힌지, 납작한 다리, 코 패드 형태가 없다 | `scripts/lib/frame-geometry.mjs` TubeGeometry, Blender 정면 렌더 |
| 다리가 중간에 끊어져 보임 (1) | **반대편(먼 쪽) 다리**: yaw 20~35°에서 힌지~귀 앞 구간은 얼굴 메시 뒤로 숨지만, 귀 뒤 구간(힌지에서 77 mm 이후)은 얼굴 메시(귀·두개골 없음)와 머리 타원체(반폭 68 mm < 다리 x 79~83 mm) 둘 다 가리지 못해 **실루엣 밖에 떠서 보인다** | 투영 계산: yaw 20°, −X 다리 s=20~60 실루엣 안, s≥77 실루엣 밖 |
| 다리가 중간에 끊어져 보임 (2) | **가까운 쪽 다리**: 다리 벌림 솔버가 127/234 두 점만 보고 3 mm 여유를 두지만, 다리 높이(힌지 y ≈ 37.7)에서 가장 넓은 정점은 162(−75.6, 41.1, −9.9)여서 실제 여유는 1 mm 미만(정규 모델에서 −0.98 mm 관통). 얼굴 폭이 조금만 달라도 다리가 볼·관자놀이 메시 안팎을 드나들며 끊긴다 | Blender BVH 최소 부호 거리, 투영 계산 s=77~105 안/밖 반복 |
| 다리 형태 부자연스러움 | 다리가 힌지에서 55 %(77 mm) 지점부터 내려가기 시작해 귀(귀 앞 234는 힌지에서 85 mm, 귓바퀴 상단은 ~100 mm)보다 앞에서 처진다. 실제 다리는 ~95~105 mm까지 직선 후 귀 뒤로 굽는다 | Blender 측면 렌더 |
| 얼굴 관통 | 림 뒷면이 눈썹·볼에, 코 패드가 코 옆면에 들어가는 상황을 검사하지 않는다. 얼굴 깊이는 정규 모델 깊이를 쓰고 화면 x·y만 실제 랜드마크이므로, 실제 얼굴이 정규 모델보다 옆으로 넓거나(관자놀이·광대) 코가 낮으면 다리·림이 오클루더 안으로 들어가 사라진다 | 코 패드 −2.3 mm, 프레임 −1.5 mm 관통(정규 모델) |

## 2. 목표

1. 스펙(mm)에 맞는 **실물형 안경 3종 GLB**를 Blender로 생성한다(납작한 림, 브릿지, 엔드피스, 힌지, 귀 뒤로 굽는 다리, 코 패드, PBR 재질). 생성은 스크립트로 재현 가능해야 한다.
2. **두개골 + 귀 오클루더 메시**를 Blender로 만들어 타원체를 대체한다. 먼 쪽 다리는 숨기고 가까운 쪽 다리는 보이게 한다.
3. 코어에 **클리어런스 솔버**를 추가해 다리·림·코 패드가 얼굴 메시를 관통하지 않도록 다리 벌림·전방 보정을 계산하고, 남은 관통량(mm)을 지표로 낸다.
4. **다양한 얼굴형**(폭·길이·코 높이·광대·눈썹·관자놀이 폭 조합 14종 × 5 포즈)에서 관통 0을 자동 검증하고(vitest), Blender에서 실제 GLB 메시로 재검증·렌더한다.

범위 밖: 렌즈 굴절·반사 재질, 상용 에셋 파이프라인, 안드로이드 이식.

## 3. 접근 비교

| 안 | 내용 | 판단 |
|---|---|---|
| A. 절차적 three.js 지오메트리 개선 | TubeGeometry → ExtrudeGeometry로 단면 변경 | 베벨·부드러운 법선·복합 형태(엔드피스·힌지·패드암)가 어렵고, 사용자가 요구한 Blender 검증 루프와 분리된다 |
| B. 외부 에셋(Sketchfab/Poly Pizza/생성 AI) | 다운로드 또는 text-to-3D | 스펙 치수(52□18 140)를 1 mm 오차로 맞출 수 없고 라이선스·API 키 의존 |
| **C. Blender 파라메트릭 모델링(채택)** | 스펙 JSON → bmesh로 림·브릿지·엔드피스·다리·패드 생성, 베벨·스무스, glTF 내보내기 | 치수 정확·재현 가능·외관 제어 가능. 헤드리스(`Blender -b -P`)로 `npm run setup:frames`에 통합, Blender가 없으면 기존 절차적 생성으로 폴백 |

관통 방지도 세 안을 비교했다. (a) 오클루더를 안쪽으로 밀어 넣기(관통을 숨김 — 원인 미해결), (b) 전체 얼굴 메시 대비 SDF 충돌 해석(정확하나 이식·성능 부담), **(c) 영역별 높이장(heightfield) 프로브 검사(채택)**: 다리는 옆면 x(y,z), 림·패드는 정면 z(x,y) 높이장으로 관통량을 구해 힌지 회전·전방 이동 두 자유도로 해소한다. 프로브 ~70개 × 영역 정점 ~60개로 프레임당 0.1 ms 이하, Kotlin 이식이 쉽다.

## 4. 설계

### 4.1 에셋 파이프라인

```
scripts/frames.json                제품 정의(스펙 mm + 스타일 + 다리/림 메타) — 단일 출처
scripts/blender/frame_builder.py   Blender 파라메트릭 모델링 + GLB/썸네일 내보내기 (헤드리스·MCP 공용)
scripts/blender/head_builder.py    두개골+귀 오클루더 GLB 생성
scripts/gen-frames.mjs             Blender 실행(가능 시) → GLB 후처리·검수 → mock API JSON. Blender 없으면 절차적 폴백
public/assets/frames/FR-000x.glb   커밋된 결과물 (+ .png 썸네일)
public/models/head_occluder.glb    커밋된 오클루더
```

**좌표 규약**은 `docs/assets/glb-spec.md` 그대로(mm, +Y 위, +Z 카메라, 원점 = 브릿지 코 접점, 다리는 −Z). Blender 내부는 Z-up이므로 Blender (x, y, z) = glTF (x, −z, y)로 모델링하고 기본 내보내기(+Y up)를 쓴다.

**형상 규칙** (스펙: 렌즈 폭 `lw`, 브릿지 `b`, 다리 `tl`, 렌즈 높이 `lh`, 전체 폭 `fw`):

| 부위 | 아세테이트(FR-0001) | 메탈(FR-0002, FR-0003) |
|---|---|---|
| 림 단면 | 폭 4.5 × 깊이 4.0 mm, 베벨 0.8 | 폭 1.8 × 깊이 2.2 mm |
| 렌즈 | 외곽선 채움, 4베이스(반경 130 mm) 구면 처짐, 림 안쪽 1 mm | 동일 |
| 브릿지 | 림 단면과 같은 바, 렌즈 높이 30 % 위치, 위로 2.5 mm 아치 | 1.8 mm 원형 바, 보잉은 6 mm 위 이중 브릿지 |
| 엔드피스 | 6 × 6 mm 블록이 림 바깥 위 모서리에서 힌지(x = ±fw/2)로 이어지며 −Z로 꺾임 | 4 × 5 × 3 mm 힌지 블록 |
| 다리 | 4 × 2.5 mm 납작 바, 끝에서 3 × 2 mm로 테이퍼 | 1.8 mm 와이어, 마지막 40 mm는 3.5 × 3 mm 아세테이트 팁 |
| 다리 경로 | 힌지에서 −Z 직선 `bend = 0.68·tl`까지, 이후 남은 길이 동안 `drop = 28 mm` 아래로 굽고 안쪽으로 2 mm 훅 | 동일 |
| 코 패드 | 림 안쪽 아래에 8 × 5 mm 일체형 범프, 중심 (±(b/2−1), −4, −2) | 1 mm 패드암 + 14 × 8 mm 타원 패드, 중심 (±(b/2+1), −4, −3), 20° 기울임 |
| 렌즈 평면 z | +3 | +5 |

이 표의 `lens_plane_mm`, `rim_depth_mm`, `temple_bend_mm`, `temple_drop_mm`, `pad_center`는 `frames.json`에 적고 mock API `assets.anchor`에 함께 내보낸다(아래 4.3).

**재질**: Principled BSDF → glTF PBR. 아세테이트 roughness 0.3·metallic 0, 메탈 metallic 0.9·roughness 0.3, 렌즈 alpha 0.15·roughness 0.05(BLEND), 패드 alpha 0.6. 삼각형 ≤ 50 k, 파일 ≤ 2 MB.

**노드**: 기존 필수 노드 유지(`frame_front`, `lens_L/R`, `temple_L/R`, `nose_pads`, `anchor_bridge`, `anchor_temple_L/R`). 이름 충돌을 피하려고 프레임마다 새 씬에서 생성 → 내보내기 → 삭제.

**후처리·검수**(`gen-frames.mjs`): glTF JSON 청크에 `asset.extras.units = "mm"` 기록, 필수 노드·`frame_front` 폭 오차 ≤ 1 mm·삼각형 수 검사, 실패 시 빌드 중단.

### 4.2 머리 오클루더 (`head_occluder.glb`)

- 정규 얼굴 뒤에 놓이는 볼록한 두개골(타원체 계열, 기준 반폭 80 mm @ 귀 높이) + 양쪽 귓바퀴 블록(x로 10 mm 돌출, y 0~35, z −30~−58). 얼굴 메시 앞으로 튀어나오지 않도록 Blender에서 정점별로 검증한다(정면 방향 레이가 얼굴 메시에 맞으면 두개골 정점은 그보다 ≥ 1 mm 뒤).
- 런타임(`headOccluder.ts`): 깊이 전용 재질로 얼굴 행렬에 부착. **x 스케일은 안경 다리에 맞춘다**: 귀 높이(z = −40)에서 다리 x(= 힌지 반폭 × 폭 스케일 + tan(벌림)·깊이) − 2 mm가 두개골 반폭이 되도록. 실제 머리는 정확히 다리 안쪽에 있으므로 이 규칙이 실측 없이도 가까운 쪽 다리는 보이고 먼 쪽 다리는 숨겨지는 조건을 만족한다. y·z 스케일은 얼굴 높이 비율(10↔152 대 정규)로 맞춘다.
- GLB 로드 실패 시 기존 타원체(같은 스케일 규칙)로 폴백.

### 4.3 코어: 에셋 메타·클리어런스 솔버

**타입 확장** (`src/core/types.ts`, 모두 선택 필드·기본값 있음):

```ts
export interface AssetAnchor {
  bridge: Vec3; temple_left: Vec3; temple_right: Vec3; nose_pad_offset: Vec3;
  lens_plane_mm?: number;   // 렌즈 평면 z (기본 4)
  rim_depth_mm?: number;    // 렌즈 평면에서 림 뒷면까지 (기본 4)
  temple_bend_mm?: number;  // 힌지에서 귀 굽힘 시작까지 (기본 0.68·temple_mm)
  temple_drop_mm?: number;  // 굽힘 이후 끝까지 내려가는 높이 (기본 28)
}
```

**설정** (`config.placement`): `pantoscopicTiltDeg: 8`, `clearance: { templeMm: 2.5, rimMm: 1.5, padSinkMm: 1.0, maxForwardMm: 8, maxSplayDeg: 15 }`.

**모듈 `src/core/fitting/clearance.ts`**

- 영역 정점 집합은 `CANONICAL_VERTICES_MM`에서 기하 조건으로 모듈 로드 시 계산한다(인덱스 하드코딩 없음): SIDE_L/R (|x| > 50, y ∈ [−5, 65]), NOSE_L/R (2 < |x| < 22, z > 45, y ∈ [−15, 35]), BROW (|x| < 60, y ∈ [35, 62], z > 40), CHEEK_L/R (18 < |x| < 66, y ∈ [−30, 15], z > 25).
- 입력: 얼굴 로컬 좌표(mm)의 메트릭 정점(478×3, 카메라 공간 → `inv(faceMatrix)`), 코 착지 앵커, 스펙, 에셋 앵커(메타 포함), 폭·균일 스케일, 설정.
- **다리 벌림**: 각 측 SIDE 정점 중 다리 높이 창(|p.y − 다리 y(z)| ≤ 15 mm, 힌지보다 3 mm 이상 뒤)에 대해 `tan θ ≥ (sign·(p.x − hingeX) + templeMm) / (hingeZ − p.z)`의 최대값. 0 ≤ θ ≤ maxSplayDeg.
- **전방 보정**: 림 뒷면 프로브(렌즈 바운딩 박스 기반 둥근 사각형 24점/렌즈, z = lens_plane − rim_depth, 틸트 적용)와 코 패드 프로브(패드 중심)를 BROW·CHEEK·NOSE 높이장 z(x, y)(xy 최근접 3점 역거리 가중)와 비교해 `push = max(z_face − z_probe + margin)`(패드는 margin = −padSinkMm), 0 ≤ push ≤ maxForwardMm를 앵커 z에 더한다.
- 출력 `ClearanceResult { splay: {left, right}, forwardMm, penetration: { temple, brow, cheek, nose } }` — penetration은 보정 **후** 남은 관통량(mm, 양수 = 관통). 정상이면 모두 ≤ 0.

**`FittingCore.process`** 순서: 코 착지 → 클리어런스(전방 보정 반영) → `composeGlassesMatrix`(틸트 포함: face · T(anchor) · Rx(tilt) · S · T(−bridge)) → 다리 벌림 필터. `FitOutput.clearance: ClearanceResult | null` 추가. 기존 `solveTempleSplay`는 새 솔버로 대체하고 테스트를 옮긴다.

**앵커 조합** (`anchorSolver.ts`): `composeGlassesMatrix(face, anchor, scale, asset, tiltDeg = 0)`. 틸트는 +X축 회전, 양수일 때 렌즈 상단이 +Z(카메라)로 기운다.

### 4.4 얼굴 변형 벤치

**`tests/helpers/faceVariants.ts`**: 정규 정점(468×3, mm)에 파라미터 변형을 적용한다.

| 파라미터 | 적용 | 범위 |
|---|---|---|
| `width` | x 스케일 전체 | 0.85~1.15 |
| `height` | y 스케일 전체 | 0.9~1.1 |
| `depth` | z 스케일 전체(납작한 얼굴) | 0.9~1.1 |
| `noseBridge` | 코 능선 영역(|x| < 25, y ∈ [−20, 45]) z 이동, 능선 거리 가우시안 감쇠 | −4~+4 mm |
| `cheekbone` | 광대 영역(30 < |x| < 70, y ∈ [−15, 25]) 바깥·앞으로 이동 | 0~+5 mm |
| `brow` | 눈썹 영역(y ∈ [35, 60], z > 35) z 이동 | −2~+3 mm |
| `templeWidth` | |x| > 55 정점 x 이동(두개골 폭) | −6~+6 mm |

변형 14종: canonical, narrow, wide, long, short, flat(depth 0.92·noseBridge −4·cheekbone +3 — 동아시아형), high_nose(+4), high_cheek(+5), heavy_brow(+3), wide_temples(+6), narrow_temples(−6), wide_flat, narrow_high, extreme(wide·flat·high_cheek·wide_temples). 포즈 5종: 정면, yaw ±30°, pitch ±15°.

`makeSyntheticFrame`에 `vertices?: Float32Array` 옵션을 추가하고, 변형 얼굴의 행렬은 MediaPipe처럼 **정규 모델을 변형 얼굴에 강체 정합(Kabsch, 가중치)**한 결과로 만든다(실제 파이프라인의 깊이 불일치를 재현).

**`scripts/fit-bench.ts`** (`npm run bench:fit`, rolldown으로 번들 후 실행): 변형 × 포즈 × 프레임 3종을 코어에 통과시켜 `bench/fit-bench.json`을 쓴다.

```json
{ "version": 1,
  "frames": [{ "frame_id", "glb", "spec", "anchor" }],
  "variants": [{ "name", "params", "vertices": [468*3],
     "cases": [{ "pose": {"yawDeg","pitchDeg"}, "frame_id",
                 "glassesLocal": [16, column-major, 실제 얼굴 로컬 프레임],
                 "splay": [l, r], "forwardMm", "penetration": {…},
                 "metricLocal": [468*3, 오클루더에 쓰이는 메트릭 메시(실제 얼굴 로컬)] }] }] }
```

**`scripts/blender/fit_bench.py`**: JSON을 읽어 변형 얼굴 메시·GLB를 놓고 BVH 최소 부호 거리(다리 ≥ −0.5, 림 ≥ 0, 패드 ≥ −1.5 mm)를 부위별로 판정, 변형별 정면·yaw 30° 렌더를 `bench/renders/`에 저장하고 요약표를 출력한다. MCP와 헤드리스 모두에서 실행 가능.

**`tests/core/clearance.test.ts`**: 솔버 단위 테스트 + 모든 변형·포즈·프레임에서 `penetration` 각 항목 ≤ 0.5 mm 회귀 테스트.

### 4.5 HUD · 지표 · 문서

- 패널 "위치 · 렌더": `관통 잔여 (mm) 다리/눈썹/볼/코`, `전방 보정 (mm)` 판독값, 틸트 슬라이더(−5~15°).
- CSV 열: `forward_mm`, `pen_temple`, `pen_brow`, `pen_cheek`, `pen_nose`.
- 골든 벡터 `synthetic-v1.json` 재생성(틸트·클리어런스로 행렬이 바뀜).
- `docs/assets/glb-spec.md`(Blender 파이프라인·메타 필드·오클루더), `docs/api/openapi.yaml`(Anchor 선택 필드), README(스크립트·검증 절차), `docs/verification/2026-09-08-fit-bench.md`(전/후 렌더와 벤치 표).

## 5. 검증 계획

1. `npm test`: 기존 테스트 + 클리어런스 단위·변형 회귀 + GLB 검수(노드·폭·삼각형).
2. Blender 벤치: 14 변형 × 5 포즈 × 3 프레임 관통 판정 전부 PASS, 렌더 contact sheet 육안 확인.
3. 브라우저(dev 서버): 데모 시퀀스 재생에서 새 GLB·오클루더가 로드되고 HUD 관통 잔여가 0 이하, yaw 30° 프레임에서 먼 쪽 다리가 실루엣 밖에 보이지 않음(스크린샷).
4. 실기기 재검(사용자): 정면·yaw ±30°에서 다리 끊김·관통 소실 여부. 남는 오차는 HUD 관통 지표와 틸트/클리어런스 슬라이더로 튜닝.
