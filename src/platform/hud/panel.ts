/** Debug / QA panel: readouts, filter tuning, toggles, PD, recording and export controls. */
import type { Angles, ClearanceResult, FittingConfig, PdEstimate, TrackingState } from '../../core/types';
import type { FittingConfigPatch } from '../../core/config';
import type { ProductFrame } from '../product/adapter';
import type { TrackerProfile } from '../tracker';
import type { AssetCheck } from '../render/glasses';
import type { RenderOptions } from '../render/scene';
import type { OverlayOptions } from './overlay';
import type { CameraProfile } from '../camera';

export interface PanelStats {
  mode: 'idle' | 'live' | 'replay';
  fps: number;
  detectMs: number;
  pipelineMs: number;
  state: TrackingState;
  alpha: number;
  confidence: number;
  angles: Angles | null;
  anglesFiltered: Angles | null;
  widthScale: number;
  uniformScale: number;
  realSizeActive: boolean;
  splayDeg: { left: number; right: number };
  clearance: ClearanceResult | null;
  jitterRaw: { positionPx: number; rotationDeg: number };
  jitterFiltered: { positionPx: number; rotationDeg: number };
  latencyMs: number;
  trackingRatio: number;
  reacquireMs: number;
  matrixTz: number;
  pd: PdEstimate;
  assetCheck: AssetCheck | null;
  recording: boolean;
  recordedFrames: number;
  replayIndex: number;
  replayLength: number;
  replayName: string;
  trackerLabel: string;
}

export interface PanelCallbacks {
  onStartCamera: () => void;
  onStopCamera: () => void;
  onCameraProfile: (p: CameraProfile) => void;
  onFrameSelect: (id: string) => void;
  onTrackerProfile: (id: string) => void;
  onBenchmark: () => void;
  onConfigPatch: (patch: FittingConfigPatch) => void;
  onMirror: (on: boolean) => void;
  onOverlay: (opts: OverlayOptions) => void;
  onRender: (opts: RenderOptions) => void;
  onPdReset: () => void;
  onCardMeasure: () => void;
  onPostFitSession: () => void;
  onRecordToggle: () => void;
  onDownloadRecording: () => void;
  onLoadFile: (file: File) => void;
  onLoadDemo: () => void;
  onReplayToggle: () => void;
  onReplayStop: () => void;
  onExportCsv: () => void;
  onExportGolden: () => void;
  onResetMeters: () => void;
}

const fmt = (v: number, d = 1, suffix = '') => (Number.isFinite(v) ? v.toFixed(d) + suffix : '—');
const REJECT_KO: Record<string, string> = {
  'no-face': '얼굴 없음', 'no-pose': '자세 없음', yaw: '고개 좌우 회전', pitch: '고개 상하 회전', blink: '눈 감음',
  gaze: '시선 이탈', 'too-far': '너무 멂 (홍채 작음)', 'off-center': '화면 중앙 이탈',
};

export class Panel {
  private readouts = new Map<string, HTMLElement>();
  private frameSelect!: HTMLSelectElement;
  private trackerSelect!: HTMLSelectElement;
  private cameraSelect!: HTMLSelectElement;
  private recordBtn!: HTMLButtonElement;
  private replayBtn!: HTMLButtonElement;
  private message!: HTMLElement;
  private render: RenderOptions = { faceOccluder: true, headOccluder: true, debugOccluder: false };
  private overlay: OverlayOptions = { landmarks: false, anchors: true };
  private controls = new Map<string, HTMLInputElement>();

  constructor(private root: HTMLElement, private cb: PanelCallbacks, cfg: FittingConfig, cameraProfiles: CameraProfile[]) {
    root.innerHTML = '';
    this.build(cfg, cameraProfiles);
  }

  // ---- DOM helpers -------------------------------------------------------
  private section(title: string): HTMLElement {
    const s = document.createElement('section');
    const h = document.createElement('h3');
    h.textContent = title;
    s.appendChild(h);
    this.root.appendChild(s);
    return s;
  }
  private readout(parent: HTMLElement, key: string, label: string): void {
    const row = document.createElement('div');
    row.className = 'row';
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'val';
    v.textContent = '—';
    row.append(l, v);
    parent.appendChild(row);
    this.readouts.set(key, v);
  }
  private set(key: string, text: string, cls?: string): void {
    const el = this.readouts.get(key);
    if (!el) return;
    if (el.textContent !== text) el.textContent = text;
    el.className = 'val' + (cls ? ' ' + cls : '');
  }
  private button(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', onClick);
    parent.appendChild(b);
    return b;
  }
  private checkbox(parent: HTMLElement, key: string, label: string, initial: boolean, onChange: (v: boolean) => void): void {
    const l = document.createElement('label');
    l.className = 'check';
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.checked = initial;
    i.addEventListener('change', () => onChange(i.checked));
    l.append(i, document.createTextNode(label));
    parent.appendChild(l);
    this.controls.set(key, i);
  }
  private slider(parent: HTMLElement, key: string, label: string, min: number, max: number, step: number, initial: number, onChange: (v: number) => void): void {
    const row = document.createElement('div');
    row.className = 'row slider';
    const l = document.createElement('span');
    l.textContent = label;
    const i = document.createElement('input');
    i.type = 'range';
    i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(initial);
    const v = document.createElement('span');
    v.className = 'val';
    v.textContent = String(initial);
    i.addEventListener('input', () => { v.textContent = i.value; onChange(Number(i.value)); });
    row.append(l, i, v);
    parent.appendChild(row);
    this.controls.set(key, i);
  }
  private number(parent: HTMLElement, key: string, label: string, initial: number, step: number, onChange: (v: number) => void): void {
    const row = document.createElement('div');
    row.className = 'row';
    const l = document.createElement('span');
    l.textContent = label;
    const i = document.createElement('input');
    i.type = 'number';
    i.step = String(step);
    i.value = String(initial);
    i.addEventListener('change', () => onChange(Number(i.value)));
    row.append(l, i);
    parent.appendChild(row);
    this.controls.set(key, i);
  }
  private select(parent: HTMLElement, label: string, onChange: (v: string) => void): HTMLSelectElement {
    const row = document.createElement('div');
    row.className = 'row';
    const l = document.createElement('span');
    l.textContent = label;
    const s = document.createElement('select');
    s.addEventListener('change', () => onChange(s.value));
    row.append(l, s);
    parent.appendChild(row);
    return s;
  }

  // ---- layout ------------------------------------------------------------
  private build(cfg: FittingConfig, cameraProfiles: CameraProfile[]): void {
    const cb = this.cb;
    const s0 = this.section('세션');
    this.message = document.createElement('div');
    this.message.className = 'message';
    s0.appendChild(this.message);
    const bar = document.createElement('div');
    bar.className = 'buttons';
    this.button(bar, '카메라 시작', cb.onStartCamera);
    this.button(bar, '카메라 정지', cb.onStopCamera);
    s0.appendChild(bar);
    this.cameraSelect = this.select(s0, '카메라 해상도', (v) => cb.onCameraProfile(cameraProfiles[Number(v)]));
    cameraProfiles.forEach((p, i) => this.cameraSelect.add(new Option(p.label, String(i))));
    this.trackerSelect = this.select(s0, '추적 프로파일', cb.onTrackerProfile);
    const bar0 = document.createElement('div');
    bar0.className = 'buttons';
    this.button(bar0, '기기 벤치마크(자동 선택)', cb.onBenchmark);
    s0.appendChild(bar0);
    this.frameSelect = this.select(s0, '프레임', cb.onFrameSelect);
    this.readout(s0, 'asset', '에셋 검수');
    this.checkbox(s0, 'mirror', '미러링(전면 카메라)', true, cb.onMirror);

    const s1 = this.section('성능 · 추종');
    this.readout(s1, 'fps', 'FPS / 검출 ms / 파이프라인 ms');
    this.readout(s1, 'state', '상태 / alpha / 신뢰도');
    this.readout(s1, 'angles', 'yaw / pitch / roll (raw)');
    this.readout(s1, 'anglesF', 'yaw / pitch / roll (filtered)');
    this.readout(s1, 'jitter', '정지 지터 raw → filtered (px @720p / °)');
    this.readout(s1, 'latency', '모션 지연 (ms)');
    this.readout(s1, 'tracking', '추적 유지율 / 재획득 ms');
    this.readout(s1, 'tz', '행렬 tz (mm, −200~−1200 정상)');
    const bar1 = document.createElement('div');
    bar1.className = 'buttons';
    this.button(bar1, '계기 리셋', cb.onResetMeters);
    s1.appendChild(bar1);

    const s2 = this.section('필터 (One-Euro)');
    this.checkbox(s2, 'filter', '필터 사용', cfg.filter.enabled, (v) => cb.onConfigPatch({ filter: { enabled: v } }));
    this.slider(s2, 'posMin', '위치 minCutoff', 0.1, 5, 0.1, cfg.filter.position.minCutoff, (v) => cb.onConfigPatch({ filter: { position: { minCutoff: v } } }));
    this.slider(s2, 'posBeta', '위치 beta', 0, 0.2, 0.005, cfg.filter.position.beta, (v) => cb.onConfigPatch({ filter: { position: { beta: v } } }));
    this.slider(s2, 'rotMin', '회전 minCutoff', 0.1, 5, 0.1, cfg.filter.rotation.minCutoff, (v) => cb.onConfigPatch({ filter: { rotation: { minCutoff: v } } }));
    this.slider(s2, 'rotBeta', '회전 beta', 0, 2, 0.05, cfg.filter.rotation.beta, (v) => cb.onConfigPatch({ filter: { rotation: { beta: v } } }));

    const s3 = this.section('위치 · 렌더');
    this.readout(s3, 'scale', '폭 스케일 / 균일 스케일');
    this.readout(s3, 'splay', '다리 벌림 L / R (°)');
    this.readout(s3, 'pen', '관통 잔여 (mm) 다리/눈썹/볼/코');
    this.readout(s3, 'forward', '전방 보정 (mm)');
    this.checkbox(s3, 'widthScale', '폭 비율 보정', cfg.placement.widthScaleEnabled, (v) => cb.onConfigPatch({ placement: { widthScaleEnabled: v } }));
    this.checkbox(s3, 'realSize', '실치수 모드 (PD 준비 시)', cfg.placement.realSizeMode, (v) => cb.onConfigPatch({ placement: { realSizeMode: v } }));
    this.slider(s3, 'clearance', '브릿지 클리어런스 (mm)', -3, 6, 0.5, cfg.placement.bridgeClearanceMm, (v) => cb.onConfigPatch({ placement: { bridgeClearanceMm: v } }));
    this.slider(s3, 'tilt', '팬토스코픽 틸트 (°)', -5, 15, 0.5, cfg.placement.pantoscopicTiltDeg, (v) => cb.onConfigPatch({ placement: { pantoscopicTiltDeg: v } }));
    this.checkbox(s3, 'kabsch', '대안 경로: Kabsch 포즈', cfg.placement.useKabschPose, (v) => cb.onConfigPatch({ placement: { useKabschPose: v } }));
    this.checkbox(s3, 'depthLm', '깊이: 랜드마크 z 사용 (정규 모델 대신 — 실기기에서 비교)', cfg.placement.depthSource === 'landmark', (v) => cb.onConfigPatch({ placement: { depthSource: v ? 'landmark' : 'canonical' } }));
    this.checkbox(s3, 'transpose', '행렬 전치(디버그)', cfg.transposeMatrix, (v) => cb.onConfigPatch({ transposeMatrix: v }));
    this.checkbox(s3, 'faceOcc', '얼굴 오클루더', this.render.faceOccluder, (v) => { this.render = { ...this.render, faceOccluder: v }; cb.onRender(this.render); });
    this.checkbox(s3, 'headOcc', '머리 오클루더', this.render.headOccluder, (v) => { this.render = { ...this.render, headOccluder: v }; cb.onRender(this.render); });
    this.checkbox(s3, 'debugOcc', '오클루더 표시(디버그)', this.render.debugOccluder, (v) => { this.render = { ...this.render, debugOccluder: v }; cb.onRender(this.render); });
    this.checkbox(s3, 'landmarks', '랜드마크 오버레이', this.overlay.landmarks, (v) => { this.overlay = { ...this.overlay, landmarks: v }; cb.onOverlay(this.overlay); });
    this.checkbox(s3, 'anchors', '앵커 오버레이', this.overlay.anchors, (v) => { this.overlay = { ...this.overlay, anchors: v }; cb.onOverlay(this.overlay); });

    const s4 = this.section('간이 PD (참고용 — 검안·조제용 아님)');
    this.readout(s4, 'pdStatus', '상태 / 샘플 / 거부 사유');
    this.readout(s4, 'pdFar', '원용 PD');
    this.readout(s4, 'pdNear', '근용 PD');
    this.readout(s4, 'pdMono', '단안 PD L / R');
    this.readout(s4, 'pdDist', '거리 / 홍채 px / 신뢰도');
    this.number(s4, 'irisMm', '홍채 지름 (mm)', cfg.pd.irisDiameterMm, 0.1, (v) => { cb.onConfigPatch({ pd: { irisDiameterMm: v } }); cb.onPdReset(); });
    const bar4 = document.createElement('div');
    bar4.className = 'buttons';
    this.button(bar4, 'PD 리셋', cb.onPdReset);
    this.button(bar4, '카드 캘리브레이션', cb.onCardMeasure);
    this.button(bar4, '결과 전송(mock)', cb.onPostFitSession);
    s4.appendChild(bar4);

    const s5 = this.section('녹화 · 재생 · 내보내기');
    this.readout(s5, 'rec', '녹화 / 재생');
    const bar5 = document.createElement('div');
    bar5.className = 'buttons';
    this.recordBtn = this.button(bar5, '녹화 시작', cb.onRecordToggle);
    this.button(bar5, '녹화 저장(JSON)', cb.onDownloadRecording);
    s5.appendChild(bar5);
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.addEventListener('change', () => { if (file.files?.[0]) cb.onLoadFile(file.files[0]); file.value = ''; });
    s5.appendChild(file);
    const bar6 = document.createElement('div');
    bar6.className = 'buttons';
    this.button(bar6, '데모 시퀀스 로드', cb.onLoadDemo);
    this.replayBtn = this.button(bar6, '재생', cb.onReplayToggle);
    this.button(bar6, '재생 정지', cb.onReplayStop);
    s5.appendChild(bar6);
    const bar7 = document.createElement('div');
    bar7.className = 'buttons';
    this.button(bar7, '지표 CSV', cb.onExportCsv);
    this.button(bar7, '골든 벡터 JSON', cb.onExportGolden);
    s5.appendChild(bar7);
  }

  setFrames(items: ProductFrame[], selectedId: string | null): void {
    this.frameSelect.innerHTML = '';
    for (const it of items) this.frameSelect.add(new Option(`${it.name} (${it.spec.lens_width_mm}□${it.spec.bridge_mm} ${it.spec.temple_mm})`, it.frame_id));
    if (selectedId) this.frameSelect.value = selectedId;
  }

  setTrackerProfiles(profiles: TrackerProfile[], selectedId: string): void {
    this.trackerSelect.innerHTML = '';
    for (const p of profiles) this.trackerSelect.add(new Option(p.label, p.id));
    this.trackerSelect.value = selectedId;
  }

  setMessage(text: string, cls = ''): void {
    this.message.textContent = text;
    this.message.className = 'message ' + cls;
  }

  get renderOptions(): RenderOptions { return this.render; }
  get overlayOptions(): OverlayOptions { return this.overlay; }

  update(s: PanelStats): void {
    this.set('fps', `${fmt(s.fps, 1)} / ${fmt(s.detectMs, 1)} / ${fmt(s.pipelineMs, 1)}`, s.fps < 24 ? 'warn' : '');
    this.set('state', `${s.state} / ${fmt(s.alpha, 2)} / ${fmt(s.confidence, 2)}`, s.state === 'Tracking' ? 'ok' : s.state === 'Lost' ? 'bad' : 'warn');
    const a = s.angles, f = s.anglesFiltered;
    this.set('angles', a ? `${fmt(a.yaw)} / ${fmt(a.pitch)} / ${fmt(a.roll)}` : '—');
    this.set('anglesF', f ? `${fmt(f.yaw)} / ${fmt(f.pitch)} / ${fmt(f.roll)}` : '—');
    this.set('jitter', `${fmt(s.jitterRaw.positionPx, 2)} → ${fmt(s.jitterFiltered.positionPx, 2)} px · ${fmt(s.jitterRaw.rotationDeg, 2)} → ${fmt(s.jitterFiltered.rotationDeg, 2)}°`,
      s.jitterFiltered.positionPx <= 0.5 && s.jitterFiltered.rotationDeg <= 0.3 ? 'ok' : 'warn');
    this.set('latency', fmt(s.latencyMs, 0), s.latencyMs <= 50 ? 'ok' : 'warn');
    this.set('tracking', `${fmt(s.trackingRatio * 100, 1, ' %')} / ${fmt(s.reacquireMs, 0)}`);
    this.set('tz', fmt(s.matrixTz, 0), s.matrixTz < -100 && s.matrixTz > -2000 ? 'ok' : 'bad');
    this.set('scale', `${fmt(s.widthScale, 3)} / ${fmt(s.uniformScale, 3)}${s.realSizeActive ? ' (실치수)' : ''}`);
    this.set('splay', `${fmt(s.splayDeg.left, 1)} / ${fmt(s.splayDeg.right, 1)}`);
    const c = s.clearance;
    if (c) {
      const p = c.penetration;
      // −Infinity (no probe near that region) renders as '—' and counts as clear.
      const clear = p.temple <= 0 && p.brow <= 0 && p.cheek <= 0 && p.nose <= 0;
      this.set('pen', `${fmt(p.temple, 1)} / ${fmt(p.brow, 1)} / ${fmt(p.cheek, 1)} / ${fmt(p.nose, 1)}`, clear ? 'ok' : 'bad');
      this.set('forward', fmt(c.forwardMm, 1));
    } else {
      this.set('pen', '—');
      this.set('forward', '—');
    }
    const pd = s.pd;
    const reject = pd.last_reject ? REJECT_KO[pd.last_reject] ?? pd.last_reject : '채택';
    this.set('pdStatus', `${pd.status} / ${pd.sample_count} / ${reject}`, pd.status === 'ready' ? 'ok' : '');
    this.set('pdFar', Number.isFinite(pd.pd_far) ? `${pd.pd_far.toFixed(1)} mm ± ${fmt(pd.ci_mm, 1)}` : '—');
    this.set('pdNear', Number.isFinite(pd.pd_near) ? `${pd.pd_near.toFixed(1)} mm` : '—');
    this.set('pdMono', `${fmt(pd.pd_mono_left, 1)} / ${fmt(pd.pd_mono_right, 1)} mm`);
    this.set('pdDist', `${fmt(pd.distance_mm, 0, ' mm')} / ${fmt(pd.iris_diameter_px, 1)} / ${fmt(pd.confidence, 2)}`);
    const ac = s.assetCheck;
    this.set('asset', ac ? `${ac.source} · 폭 ${fmt(ac.measuredWidthMm, 1)}/${ac.specWidthMm} mm · ${ac.triangles.toFixed(0)} tris${ac.missingNodes.length ? ' · 노드 누락: ' + ac.missingNodes.join(',') : ''}` : '—', ac ? (ac.ok ? 'ok' : 'warn') : '');
    this.set('rec', `${s.recording ? '● 녹화 중 ' : ''}${s.recordedFrames} 프레임 / ${s.mode === 'replay' ? `${s.replayName} ${s.replayIndex}/${s.replayLength}` : '—'} · ${s.trackerLabel}`);
    this.recordBtn.textContent = s.recording ? '녹화 정지' : '녹화 시작';
    this.replayBtn.textContent = s.mode === 'replay' ? '일시정지' : '재생';
  }
}
