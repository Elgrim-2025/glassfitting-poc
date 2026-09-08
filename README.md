# 웹 기반 AI 가상 안경 피팅 — PoC

MediaPipe Face Landmarker + Three.js로 구현한 브라우저 가상 피팅 검증 프로덕트. 세 가지 핵심 기술(① 자연스러운 위치, ② 부착·추종, ③ 간이 PD)을 수치로 검증하기 위한 코드·HUD·녹화/재생·골든 벡터를 포함한다. 설계 명세: [docs/superpowers/specs/2026-09-08-virtual-glasses-fitting-poc-design.md](docs/superpowers/specs/2026-09-08-virtual-glasses-fitting-poc-design.md).

## 빠른 시작

```bash
npm install          # postinstall: MediaPipe WASM, Draco 디코더를 public/으로 복사
npm run setup        # 모델(.task, 정규 얼굴 OBJ) 다운로드 → canonical.ts 생성 → 제품 GLB(1종) + 머리 오클루더 + mock API 생성 (Blender 있으면 Blender 모델링, 없으면 절차적 폴백)
npm run dev          # http://localhost:5173 (카메라는 localhost 또는 HTTPS에서만 동작)
npm test             # 코어 단위 테스트 + 골든 벡터 + 에셋 검수 (vitest)
npm run typecheck
npm run build        # dist/ 정적 배포물 (HTTPS 호스팅)
npm run bench:fit    # 얼굴 변형 14종 × 포즈 5종 × 제품 프레임 피팅 벤치 → bench/fit-bench.json (DEPTH=canonical|landmark 로 깊이 출처 변경)
npm run bench:replay # 브라우저 재생용 합성 세션 → bench/replays/<variant>-<pose>.json (?replay=/bench/replays/flat-yaw30.json)
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/fit_bench.py -- --bench bench/fit-bench.json   # Blender 실메시 관통 판정 + 렌더(bench/renders)
```

제품 프레임은 **한 종**(검정 아세테이트 웰링턴 148 · 52□21 · 41 · 145 mm, `scripts/frames.json`)이며 머리 오클루더와 함께 Blender(5.x)로 생성한다(`scripts/blender/`, 규격은 [docs/assets/glb-spec.md](docs/assets/glb-spec.md)). Blender가 없으면 `NO_BLENDER=1 npm run setup:frames`로 절차적 폴백을 만든다(외관 평가용 아님). 프레임 단독 렌더는 `Blender -b --python scripts/blender/render_frame.py`.

`npm run dev`/`npm run build`는 시작 전에 `scripts/ensure-runtime-assets.mjs`로 git에 없는 런타임 파일(`public/wasm`, `public/draco`, `public/models/face_landmarker.task`)을 채운다. 새 클론이나 **git worktree**에서 이 파일이 없으면 트래커가 `vision_wasm_internal.js … 404`, `GPU delegate failed`로 실패하므로, 그 경우 `npm run setup` 또는 `node scripts/ensure-runtime-assets.mjs`를 실행한다(HUD에도 누락 파일 경로가 표시된다).

모바일 실기기 테스트는 HTTPS가 필요하다. 로컬 인증서(mkcert 등)를 만든 뒤 `vite.config.ts`의 `server.https`에 지정하거나, 빌드 결과를 HTTPS 정적 호스팅에 올린다. iOS Safari는 사용자 탭으로만 카메라를 시작한다(화면의 "카메라 시작" 버튼).

카메라 없이 확인하려면 HUD의 **데모 시퀀스 로드**(합성 얼굴 40프레임 재생) 또는 녹화 JSON 파일 로드를 사용한다.

## 구조

```
src/core/            공용 코어(순수 TS, DOM/Three 의존 없음) — 안드로이드 Kotlin 이식 대상
  fittingCore.ts       FittingCore.process(FrameInput) → FitOutput
  fitting/             camera(63° 핀홀), mediapipeMatrix(cm→mm), metricLandmarks(역투영·깊이 출처: 정규/랜드마크/하이브리드), scaleSolver,
                       faceSurface(영역 삼각형 높이장), noseLanding(코 패드 접촉 착지), clearance(다리 벌림·전방 보정·정점 클램프·관통 잔여),
                       anchorSolver(틸트 포함), kabschPose(대안 경로), canonical(생성 데이터)
  filters/             One-Euro(scalar/vec3/quat), PoseFilter(T·Q·S 분해)
  tracking/            angles(yaw/pitch/roll), stateMachine(Tracking/Degraded/Lost)
  pd/                  PdEstimator(홍채 스케일·게이팅·통계·근용→원용)
  metrics/             jitter, latency(상호상관), fps, trackingStats
  golden.ts            골든 벡터 생성·검증
src/platform/        웹 플랫폼 계층
  camera.ts, tracker.ts(FaceLandmarker 래퍼·프로파일 벤치마크), frameLoop.ts(requestVideoFrameCallback)
  render/              scene(카메라 정합), faceOccluder(깊이 전용 468점 메시), headOccluder(Blender 두개골+귀 프록시, 다리 폭에 맞춰 스케일), glasses(GLB 리그·검수), proceduralGlasses
  hud/                 overlay(랜드마크·앵커·카드 측정), panel(계기·튜닝·PD·녹화·내보내기)
  session/recorder.ts  녹화·재생(rAF 타임스탬프 구동)·CSV/골든 내보내기
  product/adapter.ts   제품 마스터 API 클라이언트(mock: public/api/v1)
scripts/             canonical-to-ts, gen-frames(Blender 실행·GLB 검수·mock API), fit-bench(얼굴 변형 벤치), bench-replay, fetch-models, copy-wasm
  frames.json          제품 정의(스펙·형상 파라미터) — GLB·mock API·벤치의 단일 출처
  lib/                 lens-outline(렌즈·림 외곽선, JS↔Blender 공통), frame-defs(정의 → assets.anchor), frame-geometry(절차적 폴백)
  blender/             frame_builder(안경 모델링), head_builder(머리 오클루더), fit_bench(실메시 관통 판정·렌더), render_frame(프레임 단독 렌더)
tests/               vitest (core 단위, 골든, 에셋, 클리어런스 회귀), helpers/synthetic.ts(합성 얼굴), helpers/faceVariants.ts(얼굴 변형 14종)
docs/                api/openapi.yaml, assets/glb-spec.md, core-interface.md(TS↔Kotlin), superpowers/specs·plans
```

## 좌표계 요약

- 씬 단위 mm, 카메라 원점, +X 우, +Y 상, −Z 전방. MediaPipe 행렬은 cm이므로 이동 성분만 ×10.
- Three.js `PerspectiveCamera(63°, 영상 비율, 10, 100000)`; 비디오·오버레이·WebGL 캔버스를 한 컨테이너에 두고 CSS `scaleX(-1)`로만 미러링(텍스트 HUD는 밖).
- 행렬은 column-major로 가정. HUD "행렬 전치(디버그)" 토글과 `tz` 계기(−200~−1200 mm 정상)로 W1에 실측 확정.
- 얼굴 오클루더는 정규화 랜드마크의 화면 x,y를 그대로 쓰고 깊이만 강체 정규 모델에서 가져와 실루엣이 정확히 맞는다.

## 검증 절차 (지표 → HUD/CSV)

| 지표 | 절차 |
|---|---|
| ① 브릿지 착지·힌지 오차 | 실착용 사진(정면·yaw 30°)과 같은 포즈에서 스크린샷, 오버레이 비교. mm 환산은 PD 거리(`pd.distance_mm`)와 홍채 px 스케일 사용. 앵커 오버레이(빨간 십자)가 브릿지 원점 |
| ① 프레임 폭 비율 | 실치수 모드에서 HUD `폭 스케일/균일 스케일`, 에셋 검수 폭과 얼굴 폭(관자놀이 마젠타 점) 비교 |
| ① 코 관통·부유, 오클루전 오류 | HUD `정점간 거리 / 패드 간격 (mm)`(렌즈 뒷면–각막 12~20, 패드–코 0~3이면 자연스러움; 상한 23에 닿으면 노란색), `관통 잔여 (mm) 다리/눈썹/볼/코`(보정 후 남은 관통, 모두 ≤ 0이면 OK), `전방 보정 (mm)`. "오클루더 표시(디버그)"로 얼굴 메시·머리 프록시 확인, 정면/yaw ±30°/옆모습 육안 판정(브릿지·패드가 콧대에 붙어야 하고 먼 쪽 다리가 실루엣 밖에 보이면 안 됨). `얼굴 깊이 출처`(하이브리드/정규/랜드마크 z)·브릿지 여유·틸트로 튜닝. 오프라인: `npm run bench:fit` + Blender `fit_bench.py`로 얼굴 변형 14종 관통 판정 |
| ② 정지 지터 | 정지 3초 후 HUD `정지 지터 raw → filtered` (px @720p 환산 / °). "계기 리셋" 후 측정 |
| ② 모션 지연 | 고개를 좌우로 흔든 뒤 HUD `모션 지연` (raw yaw 대비 filtered yaw 상호상관, ms) |
| ② 추적 유지율·재획득 | yaw/pitch/roll 스윕 중 `추적 유지율`, 손 가림 해제 후 `재획득 ms` |
| ② FPS·파이프라인 지연 | HUD `FPS / 검출 ms / 파이프라인 ms`(캡처→렌더, `captureTime` 지원 브라우저). "기기 벤치마크"로 프로파일 자동 선택 |
| ③ PD | 정면·눈 뜸·화면 중앙 유지 → 30샘플 후 `ready`. `원용 PD ± CI`, 근용, 단안. 기준값과 CSV 비교(MAE, Bland-Altman). 반복성은 "PD 리셋" 5회 |
| ③ 카드 캘리브레이션 | "카드 캘리브레이션" → 이마에 댄 ISO ID-1 카드의 긴 변을 드래그 → 개인 홍채 지름 적용(깊이 차 미보정, 본 개발 항목) |
| 공통 | "녹화 시작/정지 → 녹화 저장" 후 동일 입력으로 재생하며 필터 파라미터 회귀 비교. "지표 CSV"(프레임별), "골든 벡터 JSON" |

지터 계기는 최근 90프레임 표준편차이므로 움직이는 동안의 값은 의미가 없다. 정지 후 3초가 지난 값을 읽는다.

## 기획서 대비 결정·편차

- 홍채 최소 크기 게이트 12 px(기획서 20 px): 720p·63° 가상 카메라에서 11.7 mm 홍채는 50 cm에서 약 15 px. 1080p 입력이면 같은 거리에서 약 22 px.
- 카드 기준 스케일은 OpenCV.js 자동 검출 대신 드래그 수동 측정으로 축소 구현(본 개발에서 자동화).
- MediaPipe Tasks JS는 얼굴 단위 confidence를 주지 않아 관자놀이 폭 px·행렬 타당성으로 근사한다.
- Web Worker 검출 분리는 인터페이스만 고려(`FaceTracker.detect`가 순수 함수 형태)하고 메인 스레드로 구현.
- 다리 벌림(temple splay) 솔버를 추가했다. 정규 모델 관자놀이 폭(155 mm)이 프레임 폭(138 mm)보다 넓어 다리가 머리를 관통하지 않으려면 힌지 회전이 필요하다. 실착용 테스트 후 옆면 랜드마크 띠 전체(다리 높이 ±15 mm)를 보는 클리어런스 솔버로 확장했고, 림·코 패드의 눈썹·볼·코 관통은 전방 보정으로 해소한다(설계: `docs/superpowers/specs/2026-09-08-glasses-quality-and-clearance-design.md`).
- 제품 안경은 Blender 파라메트릭 모델(납작한 테이퍼 림·새들 브릿지·리벳 엔드피스·귀 뒤로 굽는 다리와 투명 팁·일체형 코 패드) 한 종이고, 머리 오클루더는 타원체 대신 두개골+귀 프록시 메시를 쓴다. 팬토스코픽 틸트 8°를 기본 적용한다(다리는 수평 유지).
- 착지 깊이는 콧대 능선이 아니라 **코 패드 접촉**으로 정하고, 림 프로브는 제품 마스터의 실제 림 외곽선을 쓰며, 렌즈 뒷면–각막 **정점간 거리를 10~23 mm로 클램프**한다. 두 번째 실착용에서 안경이 얼굴 앞에 떠 보인 원인(능선 착지 + 정규 모델의 넓은 콧등에 맞춘 10 mm 전방 보정 → 정점간 거리 35 mm)과 수정 결과: `docs/verification/2026-09-08-float-fix.md`.
- 메트릭 얼굴 깊이의 기본은 **하이브리드**다: 눈·눈썹·볼·옆면은 정규 모델 깊이(안정), 코 영역만 MediaPipe 랜드마크 z(눈 기준 정렬)로 개인 코 높이를 반영한다. HUD `얼굴 깊이 출처`로 정규 모델 / 랜드마크 z 전체와 비교할 수 있다. 첫 검증 결과: `docs/verification/2026-09-08-fit-bench.md`.

## Go/No-Go 기록 양식

`docs/`에 검증 보고서를 추가할 때 다음 표를 채운다(기획서 6장 기준).

| 항목 | Go 기준 | 측정값(기기/조건) | 판정 |
|---|---|---|---|
| ① 브릿지 착지 오차 | ≤ 2 mm | | |
| ① 프레임 폭 비율 오차 | ≤ 3 % | | |
| ② 정지 지터 | ≤ 0.5 px / 0.3° | | |
| ② 모션 지연 | ≤ 50 ms | | |
| ② 추적 유지율(yaw ±45°) | ≥ 95 % | | |
| ② 렌더 FPS(중급 안드로이드) | ≥ 24 | | |
| ③ PD MAE | ≤ 2.0 mm | | |
| ③ 반복성 | ≤ 1.0 mm | | |

## 라이선스·출처

- MediaPipe Face Landmarker 모델·정규 얼굴 모델: Apache-2.0 (Google).
- Three.js: MIT.
