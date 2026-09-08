# 3D 안경 에셋(GLB) 규격 및 리깅 절차

기획서 부록 C를 구현 기준으로 확정한 문서. 제품 프레임(1종, `scripts/frames.json`)은 `npm run setup:frames`(`scripts/gen-frames.mjs`)가 **Blender로 모델링**해 이 규격대로 생성한다(§6).

## 1. 좌표계·단위

| 항목 | 규격 |
|---|---|
| 단위 | **mm** (glTF `asset.extras.units = "mm"`, 후처리에서 기록) |
| 축 | +Y 위, **+Z 얼굴 정면(카메라 쪽)**, +X 착용자 기준 왼쪽(= 정면에서 볼 때 화면 오른쪽). MediaPipe 정규 얼굴 모델과 같은 방향이다. 다리는 −Z 방향으로 뻗는다 |
| 원점 | **코 패드 접촉면**의 중심 높이(x = 0, 패드 접촉면 z = 0). 렌즈 평면은 원점보다 +Z 쪽(5~7 mm 앞)에 있다 |
| 스케일 | 1 glTF 단위 = 1 mm. 루트 노드에 스케일을 넣지 않는다 |

런타임은 패드 접촉점(`assets.anchor.nose_pad_offset`)이 사용자 코 옆면에 닿도록 원점 깊이를 정하고(`solveNoseLanding`), 얼굴 행렬로 구동한다. 따라서 원점·패드 접촉점 정의가 틀리면 착지 오차로 바로 나타난다.

## 2. 노드 구성

| 노드 이름 | 필수 | 내용 |
|---|---|---|
| `frame_front` | 권장 | 림·브릿지·엔드피스·힌지 블록 메시. 폭 검수에 사용 |
| `lens_L`, `lens_R` | 필수 | 렌즈 메시(투명 재질 분리). L = −X, R = +X |
| `temple_L`, `temple_R` | 필수 | 다리 메시. 힌지 회전(다리 벌림)을 위해 별도 노드. 정점은 루트 공간 좌표 |
| `anchor_bridge` | 필수 | 빈 노드, 원점(0,0,0) |
| `anchor_temple_L`, `anchor_temple_R` | 필수 | 빈 노드, 힌지 축. `temple_*`는 이 점을 축으로 Y축 회전한다. 힌지는 프레임 바깥면(±frame_width/2)에서 1~2 mm 안쪽(다리 두께 절반)에 둔다 |
| `nose_pads` | 선택 | 코 패드 메시 |

L/R은 **모델 공간의 −X/+X** 라벨이다(랜드마크 127 = TEMPLE_L = −X와 동일 규약). 착용자의 좌/우와는 반대이므로 이름에 착용자 기준을 쓰지 않는다.

## 3. 제한·재질

| 항목 | 규격 |
|---|---|
| 삼각형 | ≤ 50 000 (샘플 ≈ 25 000) |
| 텍스처 | ≤ 2048², 총 ≤ 4장 |
| 재질 | PBR metallic-roughness. 렌즈는 `alphaMode: BLEND`, 투명도 0.1~0.3, 별도 재질. 렌즈는 단면(더블사이드) 메시가 알파 블렌딩 정렬 문제를 피한다 |
| 압축 | Draco 권장(런타임에 `/draco/` 디코더 포함) |
| 용량 | ≤ 2 MB 권장 (샘플 ≈ 0.5 MB) |

## 4. 제품 마스터 앵커 메타 (`assets.anchor`)

런타임 클리어런스 솔버(`src/core/fitting/clearance.ts`)가 다리·림·패드의 얼굴 관통을 검사하려면 형상 요약값이 필요하다. 모두 mm.

| 필드 | 필수 | 의미 | 기본값 |
|---|---|---|---|
| `bridge` | 필수 | 원점 (0,0,0) | — |
| `temple_left`, `temple_right` | 필수 | 힌지 축 위치 (= `anchor_temple_*`) | — |
| `nose_pad_offset` | 필수 | +X 코 패드의 **접촉점** (x = 패드 중심 \|x\|, y = 패드 중심 높이, z = 접촉면 깊이 = 패드 중심 z − 두께/2). x = 0이면 런타임이 스펙(bridge/2 − 1)에서 유도 | — |
| `lens_plane_mm` | 선택 | 렌즈 평면 z | 4 |
| `lens_back_mm` | 선택 | 렌즈 광학 중심 뒷면 z(정점간 거리 기준; 구면 렌즈 중심 표면 − 1.5) | lens_plane − 1 |
| `rim_depth_mm` | 선택 | 렌즈 평면에서 림 뒷면까지 깊이 | 4 |
| `rim_back_mm` | 선택 | 림 뒷면 z(림 앞면은 렌즈 평면보다 1 mm 앞) | lens_plane − rim_depth |
| `rim_width_mm` | 선택 | 렌즈 가장자리에서 림 바깥면까지 폭(상단 기준) | 4 |
| `rim_outline_mm` | 선택 | +X 림 바깥 경계 폐곡선 [x, y] 48점(프레임 mm). 클리어런스 솔버의 림 뒷면 프로브. `scripts/lib/lens-outline.mjs`가 정의에서 계산하고 Blender 메시와 0.6 mm 이내 일치를 `gen-frames`가 검사 | 둥근 사각형 |
| `temple_bend_mm` | 선택 | 힌지에서 귀 굽힘 시작까지 길이 | 0.68 × temple_mm |
| `temple_drop_mm` | 선택 | 굽힘 이후 다리 끝까지 내려가는 높이 | 28 |

샘플의 값은 `scripts/frames.json`의 `build` 항목에서 `scripts/lib/frame-defs.mjs`가 파생한다.

## 5. 검수 (≤ 1 mm)

`scripts/gen-frames.mjs` 후처리와 런타임 `GlassesRig.load()`(HUD "에셋 검수")가 확인한다.

1. 필수 노드 존재 여부
2. `frame_front` 바운딩 박스 X 폭 vs `spec.frame_width_mm` — 오차 ≤ 1 mm (엔드피스 바깥면이 ±frame_width/2)
3. `lens_L` 폭 vs `lens_width_mm` — 오차 ≤ 1 mm
4. `anchor_temple_R` 위치 = 제품 마스터 `temple_right`
5. 삼각형 수 ≤ 50 000
6. (Blender 생성 시) 림 바깥 외곽선·림 뒷면·렌즈 뒷면·패드 접촉점이 제품 마스터 `assets.anchor`와 일치(외곽선 ≤ 0.6 mm)

`tests/assets.test.ts`가 커밋된 GLB에 같은 검사를 한다.

## 6. 샘플 생성 파이프라인 (Blender)

```
scripts/frames.json                 제품 정의(스펙·스타일·형상 파라미터) — 단일 출처
scripts/blender/frame_builder.py    Blender 파라메트릭 모델링 → GLB
scripts/blender/head_builder.py     두개골 + 귀 오클루더 → public/models/head_occluder.glb
scripts/gen-frames.mjs              Blender 헤드리스 실행 → 후처리(extras·검수) → mock API JSON·썸네일
```

- `npm run setup:frames`는 `/Applications/Blender.app`(또는 `BLENDER=/path`)을 찾으면 Blender로 생성하고, 없으면 `NO_BLENDER=1`과 같이 절차적(three.js 튜브) 폴백을 쓴다. 폴백은 검증 지표 산출용이며 외관 평가에는 쓰지 않는다.
- Blender 내부는 Z-up이므로 glTF (x, y, z)를 Blender (x, −z, y)로 모델링하고 기본 내보내기(+Y up)를 쓴다. 프레임마다 새로 생성 → 내보내기 → 삭제해 노드 이름 충돌을 피한다.
- 형상 규칙(`frames.json build`): 렌즈 외곽선은 `shape`(wellington: 모서리 반경 `corner_radius_mm` [상단 바깥, 상단 안쪽, 하단 안쪽, 하단 바깥], 안쪽 변 `inner_slant_mm`·바깥 변 `outer_slant_mm` 경사, 박스 치수는 정확히 A × B / square / round / aviator). 림 단면(아세테이트 `rim_width_mm` × `rim_depth_mm`, 폭은 상단 → 하단 `rim_width_bottom_mm`으로 테이퍼; 메탈 1.8 × 2.2 mm)을 외곽선을 따라 스윕, 20° 이상 모서리는 분할 법선. 렌즈는 4베이스(R 130 mm) 구면, 브릿지는 렌즈 높이 `bridge_height_ratio` 위치의 `bridge_bar_mm` 높이 바(아치 `bridge_arch_mm`), 엔드피스는 바깥면이 ±frame_width/2인 블록(+ `rivets` 리벳 2개, 다리에도 2개), 다리는 `temple_bend_mm`까지 직선 후 `temple_drop_mm` 만큼 귀 뒤로 굽으며 끝에서 2 mm 안쪽 훅, 마지막 `temple_tip_mm`는 반투명 팁 재질, 코 패드는 일체형 범프(고정, `pad_size_mm` = [폭 x, 높이 y, 두께 z], 접촉면이 `pad_splay_deg` 만큼 벌어짐) 또는 패드암 + 타원 패드(조절).
- Blender MCP에서 대화식으로 쓰려면 `FRAME_BUILDER_NO_MAIN = True`를 두고 파일을 exec한 뒤 `build_all(defs, out_dir, keep=True)`를 부른다.

## 7. 머리 오클루더 (`public/models/head_occluder.glb`)

얼굴 메시(468점)에는 두개골·귀가 없어 먼 쪽 다리가 실루엣 밖에 떠 보인다. `head_builder.py`가 정규 얼굴 뒤에 놓이는 두개골(타원체 반지름 80·95·88, 중심 (0, 15, −50))과 양쪽 귀(반지름 7·20·14, 두개골 표면에서 3 mm 밖)를 하나의 메시로 만든다. 생성 시 모든 정점이 정규 얼굴 표면보다 ≥ 1 mm 뒤에 있는지 레이 검사한다(현재 최소 2.6 mm).

런타임(`src/platform/render/headOccluder.ts`)은 깊이 전용으로 그리고, 귀 높이(y 37, z −40)의 두개골 반폭이 **안경 다리 x − 2 mm**가 되도록 X 스케일을 매 프레임 맞춘다(실제 머리는 정확히 다리 안쪽에 있으므로 실측 없이도 가까운 쪽 다리는 보이고 먼 쪽은 숨는다). Y·Z는 얼굴 높이(10↔152) 비율로 맞춘다. 로드 실패 시 같은 규칙의 타원체로 폴백한다.

## 8. 리깅 절차 (제품 GLB 제작 시)

1. 실물 스펙(예: 52□21 145, 렌즈 높이 41, 전체 폭 148)을 mm 그대로 모델링한다.
2. 코 패드 접촉면을 원점 평면(z = 0)에 맞춘다. 렌즈 기하 중심은 원점보다 약 2.5~3 mm 아래(동공선이 렌즈 중심보다 살짝 위), 브릿지 바는 렌즈 높이의 약 27~30 % 위치.
3. 정규 얼굴 모델(`public/models/canonical_face_model.obj`, cm → ×10) 위에 올려 확인한다. 브릿지 착지 기준점은 랜드마크 6 (0, 24.7, 57.9) mm, 관자놀이 127/356 (±77.4, 23.6, −20.1), 귀 앞 234/454 (±76.6, 6.7, −24.4). 다리 높이(힌지 y ≈ 37.7)에서 가장 넓은 정점은 162/389 (±75.6, 41.1, −9.9)이다.
4. 힌지 빈 노드(`anchor_temple_L/R`)를 힌지 축에 둔다. 런타임이 옆면 랜드마크 띠로 다리 벌림 각을 계산해 이 축으로 회전시킨다(최대 15°).
5. 제품 마스터 `assets.anchor`에 §4의 값을 기록한다.
6. `npm run dev` → HUD 에셋 검수 OK, 정점간 거리 12~20 mm·패드 간격 0~3 mm·관통 잔여 ≤ 0 확인 → 정면·yaw 30°·옆모습 실착용 사진과 오버레이 비교.
7. `npm run bench:fit` 후 `Blender -b --python scripts/blender/fit_bench.py -- --bench bench/fit-bench.json`으로 14종 얼굴 변형에서 관통 판정과 렌더를 확인한다. 프레임 단독 외관은 `scripts/blender/render_frame.py`.
