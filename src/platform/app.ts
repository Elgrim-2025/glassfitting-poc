/** Application orchestrator: camera → tracker → FittingCore → renderer/HUD, plus replay and export. */
import { FittingCore } from '../core/fittingCore';
import { generateGolden, type GoldenVector } from '../core/golden';
import { anglesFromMatrix } from '../core/tracking/angles';
import { mFromTranslation, mMultiply, mTransformPoint } from '../core/math/mat4';
import { JitterMeter } from '../core/metrics/jitter';
import { LatencyMeter } from '../core/metrics/latency';
import { FpsMeter } from '../core/metrics/fps';
import { TrackingStats } from '../core/metrics/trackingStats';
import type { FitOutput, FrameInput } from '../core/types';
import type { FittingConfigPatch } from '../core/config';
import { CameraSource, CAMERA_PROFILES, type CameraProfile } from './camera';
import { FaceTracker, TRACKER_PROFILES, benchmarkProfiles, type TrackerProfile } from './tracker';
import { FrameLoop, type FrameMeta } from './frameLoop';
import { SceneRenderer, type RenderOptions } from './render/scene';
import { LandmarkOverlay, type OverlayOptions } from './hud/overlay';
import { Panel, type PanelStats } from './hud/panel';
import { ProductAdapter, type ProductFrame } from './product/adapter';
import { SessionRecorder, SessionReplayer, downloadJson, downloadText, metricsToCsv, readJsonFile, type MetricRow } from './session/recorder';
import demoUrl from '../../tests/golden/synthetic-v1.json?url';

const CARD_WIDTH_MM = 85.6;
const MAX_METRIC_ROWS = 20000;
const PANEL_HZ = 10;

export class App {
  private stage: HTMLElement;
  private video: HTMLVideoElement;
  private glCanvas: HTMLCanvasElement;
  private overlayCanvas: HTMLCanvasElement;
  private badge: HTMLElement;
  private startBtn: HTMLButtonElement;

  private core = new FittingCore();
  readonly renderer: SceneRenderer;
  private overlay: LandmarkOverlay;
  private panel!: Panel;
  private camera: CameraSource;
  private tracker: FaceTracker | null = null;
  private loop: FrameLoop | null = null;
  private adapter = new ProductAdapter();
  private products: ProductFrame[] = [];
  private current: ProductFrame | null = null;
  private recorder = new SessionRecorder();
  private replayer = new SessionReplayer();

  private fps = new FpsMeter();
  private jitterRaw = new JitterMeter();
  private jitterFiltered = new JitterMeter();
  private latency = new LatencyMeter();
  private trackingStats = new TrackingStats();
  private rows: MetricRow[] = [];

  private mode: PanelStats['mode'] = 'idle';
  private cameraProfile: CameraProfile = CAMERA_PROFILES[0];
  private trackerProfile: TrackerProfile = TRACKER_PROFILES[0];
  private renderOpts: RenderOptions = { faceOccluder: true, headOccluder: true, debugOccluder: false };
  private overlayOpts: OverlayOptions = { landmarks: false, anchors: true };
  private lastFrame: FrameInput | null = null;
  lastOut: FitOutput | null = null;
  private lastPanelMs = 0;
  private busy = false;

  constructor(private root: HTMLElement) {
    const q = <T extends HTMLElement>(sel: string) => {
      const el = root.querySelector<T>(sel);
      if (!el) throw new Error(`${sel} not found`);
      return el;
    };
    this.stage = q('#stage');
    this.video = q<HTMLVideoElement>('#video');
    this.glCanvas = q<HTMLCanvasElement>('#gl');
    this.overlayCanvas = q<HTMLCanvasElement>('#overlay');
    this.badge = q('#badge');
    this.startBtn = q<HTMLButtonElement>('#start');
    this.renderer = new SceneRenderer(this.glCanvas);
    this.overlay = new LandmarkOverlay(this.overlayCanvas);
    this.camera = new CameraSource(this.video);
  }

  async init(): Promise<void> {
    this.panel = new Panel(this.root.querySelector('#panel')!, this.callbacks(), this.core.config, CAMERA_PROFILES);
    this.panel.setTrackerProfiles(TRACKER_PROFILES, this.trackerProfile.id);
    this.startBtn.addEventListener('click', () => this.startCamera());
    new ResizeObserver(() => this.syncDisplaySize()).observe(this.stage);
    this.setStageSize(1280, 720);
    try {
      this.products = await this.adapter.list();
      this.panel.setFrames(this.products, this.products[0]?.frame_id ?? null);
      if (this.products[0]) await this.selectFrame(this.products[0].frame_id);
    } catch (err) {
      this.panel.setMessage(`제품 목록 로드 실패: ${err instanceof Error ? err.message : err}`, 'bad');
    }
    this.renderer.render(null, this.renderOpts);
    this.panel.setMessage('카메라를 시작하거나 데모 시퀀스를 로드하세요.');
    // QA: ?replay=<url> loads a recorded/synthetic session (e.g. /bench/replays/wide_flat-yaw30.json) at start-up.
    const replayUrl = new URLSearchParams(location.search).get('replay');
    if (replayUrl) {
      try {
        const res = await fetch(replayUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.loadReplay((await res.json()) as GoldenVector);
      } catch (err) {
        this.panel.setMessage(`replay 로드 실패 (${replayUrl}): ${err instanceof Error ? err.message : err}`, 'bad');
      }
    }
  }

  // ---- stage sizing --------------------------------------------------------
  private setStageSize(width: number, height: number): void {
    this.stage.style.aspectRatio = `${width} / ${height}`;
    this.overlay.setSize(width, height);
    this.renderer.setVideoSize(width, height, this.core.config.camera.fovYDeg);
    this.syncDisplaySize();
  }

  private syncDisplaySize(): void {
    const r = this.stage.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) this.renderer.setDisplaySize(r.width, r.height);
  }

  private setMode(mode: PanelStats['mode']): void {
    this.mode = mode;
    this.badge.textContent = mode === 'live' ? 'LIVE' : mode === 'replay' ? '재생' : '대기';
    this.badge.className = `badge ${mode}`;
    this.stage.classList.toggle('replay', mode === 'replay');
    this.startBtn.hidden = mode !== 'idle';
  }

  // ---- camera / tracker ----------------------------------------------------
  private async startCamera(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.stopReplay();
      this.panel.setMessage('카메라 여는 중…');
      const { width, height } = await this.camera.start(this.cameraProfile);
      this.setStageSize(width, height);
      this.panel.setMessage('모델 로드 중…');
      await this.createTracker(this.trackerProfile);
      this.resetSession();
      this.loop = new FrameLoop(this.video, (meta) => this.onLiveFrame(meta));
      this.loop.start();
      this.setMode('live');
      this.panel.setMessage('');
    } catch (err) {
      this.panel.setMessage(`카메라 시작 실패: ${err instanceof Error ? err.message : err}`, 'bad');
      this.setMode('idle');
    } finally {
      this.busy = false;
    }
  }

  private stopCamera(): void {
    this.loop?.stop();
    this.loop = null;
    this.tracker?.close();
    this.tracker = null;
    this.camera.stop();
    if (this.mode === 'live') this.setMode('idle');
  }

  private async createTracker(profile: TrackerProfile): Promise<void> {
    this.tracker?.close();
    this.tracker = await FaceTracker.create(profile);
    this.trackerProfile = profile;
    if (this.tracker.effectiveDelegate !== profile.delegate) this.panel.setMessage(`GPU delegate 사용 불가 → CPU로 실행 중`, 'bad');
  }

  private onLiveFrame(meta: FrameMeta): void {
    if (!this.tracker || this.mode !== 'live') return;
    const frame = this.tracker.detect(this.video, meta.nowMs);
    this.recorder.push(frame);
    this.processFrame(frame, meta.captureMs, this.tracker.lastDetectMs);
  }

  // ---- core → render → meters ---------------------------------------------
  private processFrame(frame: FrameInput, captureMs: number, detectMs: number): void {
    const out = this.core.process(frame);
    this.renderer.render(out, this.renderOpts);
    this.overlay.draw(frame, out, this.overlayOpts);
    this.updateMeters(frame, out, captureMs, detectMs);
    this.lastFrame = frame;
    this.lastOut = out;
    const now = performance.now();
    if (now - this.lastPanelMs > 1000 / PANEL_HZ) {
      this.lastPanelMs = now;
      this.panel.update(this.stats(out));
      this.updateGuidance(out);
    }
  }

  private updateMeters(frame: FrameInput, out: FitOutput, captureMs: number, detectMs: number): void {
    const now = performance.now();
    this.fps.tick(now, captureMs, detectMs);
    this.trackingStats.update(out.state, frame.timestampMs);
    let rawScreen: { x: number; y: number } | null = null;
    let anglesF = out.faceMatrix ? anglesFromMatrix(out.faceMatrix) : null;
    if (out.rawFaceMatrix && out.anchorLocal) {
      const p = mTransformPoint(mMultiply(out.rawFaceMatrix, mFromTranslation(out.anchorLocal)), [0, 0, 0]);
      rawScreen = this.core.camera(frame).project(p);
      this.jitterRaw.update(rawScreen, frame.imageWidth, frame.imageHeight, out.angles);
    }
    if (out.bridgeAnchor) this.jitterFiltered.update(out.bridgeAnchor.screen, frame.imageWidth, frame.imageHeight, anglesF);
    if (out.angles && anglesF) this.latency.update(out.angles.yaw, anglesF.yaw, frame.timestampMs);
    else anglesF = null;
    const f = this.fps.read();
    const row: MetricRow = {
      t_ms: frame.timestampMs, state: out.state, alpha: out.alpha, confidence: out.confidence,
      yaw_raw: out.angles?.yaw ?? null, pitch_raw: out.angles?.pitch ?? null, roll_raw: out.angles?.roll ?? null,
      yaw_f: anglesF?.yaw ?? null, pitch_f: anglesF?.pitch ?? null, roll_f: anglesF?.roll ?? null,
      bridge_raw_x_px: rawScreen ? rawScreen.x * frame.imageWidth : null, bridge_raw_y_px: rawScreen ? rawScreen.y * frame.imageHeight : null,
      bridge_x_px: out.bridgeAnchor ? out.bridgeAnchor.screen.x * frame.imageWidth : null, bridge_y_px: out.bridgeAnchor ? out.bridgeAnchor.screen.y * frame.imageHeight : null,
      width_scale: out.widthScale, uniform_scale: out.uniformScale, splay_l_deg: (out.templeSplay.left * 180) / Math.PI, splay_r_deg: (out.templeSplay.right * 180) / Math.PI,
      forward_mm: out.clearance?.forwardMm ?? null, vertex_mm: out.clearance?.vertexMm ?? null, pad_gap_mm: out.clearance?.padGapMm ?? null,
      pen_temple: out.clearance?.penetration.temple ?? null, pen_brow: out.clearance?.penetration.brow ?? null,
      pen_cheek: out.clearance?.penetration.cheek ?? null, pen_nose: out.clearance?.penetration.nose ?? null,
      pd_near: out.pd.pd_near, pd_far: out.pd.pd_far, pd_samples: out.pd.sample_count,
      detect_ms: detectMs, pipeline_ms: now - captureMs, fps: f.fps, matrix_tz_mm: out.rawFaceMatrix?.[14] ?? null,
    };
    this.rows.push(row);
    if (this.rows.length > MAX_METRIC_ROWS) this.rows.shift();
  }

  private stats(out: FitOutput): PanelStats {
    const f = this.fps.read();
    const jr = this.jitterRaw.read(), jf = this.jitterFiltered.read();
    const ts = this.trackingStats.read();
    return {
      mode: this.mode,
      fps: f.fps, detectMs: f.detectMs, pipelineMs: f.pipelineMs,
      state: out.state, alpha: out.alpha, confidence: out.confidence,
      angles: out.angles, anglesFiltered: out.faceMatrix ? anglesFromMatrix(out.faceMatrix) : null,
      widthScale: out.widthScale, uniformScale: out.uniformScale, realSizeActive: out.realSizeActive,
      splayDeg: { left: (out.templeSplay.left * 180) / Math.PI, right: (out.templeSplay.right * 180) / Math.PI },
      clearance: out.clearance,
      jitterRaw: jr, jitterFiltered: jf,
      latencyMs: this.latency.read().lagMs,
      trackingRatio: ts.trackingRatio, reacquireMs: ts.lastReacquireMs,
      matrixTz: out.rawFaceMatrix?.[14] ?? NaN,
      pd: out.pd,
      assetCheck: this.renderer.glasses.assetCheck,
      recording: this.recorder.recording, recordedFrames: this.recorder.frames.length,
      replayIndex: this.replayer.index, replayLength: this.replayer.length, replayName: this.replayer.name,
      trackerLabel: this.tracker ? `${this.tracker.profile.id} (${this.tracker.effectiveDelegate})` : this.mode === 'replay' ? 'replay' : '—',
    };
  }

  private updateGuidance(out: FitOutput): void {
    if (this.mode === 'idle') return;
    const c = this.core.config.tracking;
    if (out.state === 'Lost') this.panel.setMessage('얼굴을 찾는 중… 카메라를 정면으로 바라봐 주세요.', 'bad');
    else if (out.state === 'Degraded' && out.angles && (Math.abs(out.angles.yaw) > c.maxYawDeg || Math.abs(out.angles.pitch) > c.maxPitchDeg || Math.abs(out.angles.roll) > c.maxRollDeg)) {
      this.panel.setMessage('지원 각도를 벗어났습니다. 정면으로 돌아와 주세요.');
    } else if (out.pd.status === 'collecting' && out.pd.last_reject && this.mode === 'live') {
      this.panel.setMessage(`PD 수집 중 (${out.pd.sample_count}/${this.core.config.pd.minSamples}) — 정면·눈 뜸·화면 중앙을 유지하세요.`);
    } else this.panel.setMessage('');
  }

  private resetSession(): void {
    this.core.reset();
    this.resetMeters();
  }

  private resetMeters(): void {
    this.fps.reset();
    this.jitterRaw.reset();
    this.jitterFiltered.reset();
    this.latency.reset();
    this.trackingStats.reset();
    this.rows = [];
  }

  // ---- products ------------------------------------------------------------
  private async selectFrame(id: string): Promise<void> {
    const item = this.products.find((p) => p.frame_id === id);
    if (!item) return;
    this.current = item;
    const check = await this.renderer.glasses.load(item);
    this.core.setFrameSpec(item.spec, this.renderer.glasses.anchor);
    if (!check.ok) this.panel.setMessage(`에셋 검수 경고: ${check.source}, 폭 ${check.measuredWidthMm.toFixed(1)} mm vs 스펙 ${check.specWidthMm} mm${check.missingNodes.length ? ', 누락 ' + check.missingNodes.join(',') : ''}`);
    if (this.lastOut) this.renderer.render(this.lastOut, this.renderOpts);
  }

  // ---- replay --------------------------------------------------------------
  private loadReplay(data: Parameters<SessionReplayer['load']>[0]): void {
    this.stopCamera();
    this.replayer.load(data);
    const f = data.frames[0];
    if (f) this.setStageSize(f.imageWidth, f.imageHeight);
    if ('config' in data && data.config) this.core.setConfig(data.config as FittingConfigPatch);
    if ('spec' in data && data.spec) this.core.setFrameSpec(data.spec, this.renderer.glasses.anchor);
    this.resetSession();
    this.setMode('replay');
    this.startReplay();
  }

  private startReplay(): void {
    if (this.replayer.length === 0) return;
    this.setMode('replay');
    this.replayer.play(
      (frame) => this.processFrame(frame, performance.now(), 0),
      () => this.core.reset(),
    );
  }

  private stopReplay(): void {
    this.replayer.stop();
    if (this.mode === 'replay') this.setMode('idle');
  }

  // ---- panel callbacks -----------------------------------------------------
  private callbacks() {
    return {
      onStartCamera: () => void this.startCamera(),
      onStopCamera: () => this.stopCamera(),
      onCameraProfile: (p: CameraProfile) => { this.cameraProfile = p; if (this.mode === 'live') void this.startCamera(); },
      onFrameSelect: (id: string) => void this.selectFrame(id),
      onTrackerProfile: (id: string) => {
        const p = TRACKER_PROFILES.find((x) => x.id === id);
        if (!p) return;
        this.trackerProfile = p;
        if (this.mode === 'live') void this.createTracker(p);
      },
      onBenchmark: async () => {
        if (this.mode !== 'live' || this.busy) { this.panel.setMessage('벤치마크는 카메라 실행 중에만 가능합니다.'); return; }
        this.busy = true;
        this.loop?.stop();
        try {
          const { chosen, results } = await benchmarkProfiles(this.video, TRACKER_PROFILES, 20, 28, (r) => this.panel.setMessage(`벤치마크: ${r.profile.id} ${r.meanMs.toFixed(1)} ms`));
          await this.createTracker(chosen);
          this.panel.setTrackerProfiles(TRACKER_PROFILES, chosen.id);
          this.panel.setMessage(`선택: ${chosen.id} · ` + results.map((r) => `${r.profile.id} ${r.meanMs.toFixed(1)}ms`).join(', '), 'ok');
        } finally {
          this.busy = false;
          this.loop?.start();
        }
      },
      onConfigPatch: (patch: FittingConfigPatch) => {
        this.core.setConfig(patch);
        if (patch.camera?.fovYDeg && this.lastFrame) this.setStageSize(this.lastFrame.imageWidth, this.lastFrame.imageHeight);
      },
      onMirror: (on: boolean) => { this.stage.classList.toggle('mirrored', on); this.overlay.setMirrored(on); },
      onOverlay: (o: OverlayOptions) => { this.overlayOpts = o; },
      onRender: (o: RenderOptions) => { this.renderOpts = o; if (this.lastOut) this.renderer.render(this.lastOut, o); },
      onPdReset: () => this.core.resetPd(),
      onCardMeasure: () => {
        const irisPx = this.lastOut?.pd.iris_diameter_px;
        if (!irisPx || !Number.isFinite(irisPx)) { this.panel.setMessage('먼저 얼굴이 추적되어야 합니다.'); return; }
        this.panel.setMessage('카드(ISO ID-1, 85.6 mm)를 이마에 대고, 화면에서 카드의 긴 변을 따라 드래그하세요.');
        this.overlay.startMeasure((cardPx) => {
          const irisMm = (irisPx * CARD_WIDTH_MM) / cardPx;
          this.core.setConfig({ pd: { irisDiameterMm: irisMm } });
          this.core.resetPd();
          this.panel.setMessage(`카드 ${cardPx.toFixed(0)} px → 개인 홍채 지름 ${irisMm.toFixed(2)} mm 적용 (카드–동공 깊이 차 미보정)`, 'ok');
        });
      },
      onPostFitSession: () => {
        const pd = this.lastOut?.pd;
        if (!pd || pd.status !== 'ready') { this.panel.setMessage('PD 측정이 완료되어야 전송할 수 있습니다.'); return; }
        void this.adapter.postFitSession({
          frame_id: this.current?.frame_id ?? null, pd_far: pd.pd_far, pd_near: pd.pd_near, pd_mono_left: pd.pd_mono_left, pd_mono_right: pd.pd_mono_right,
          confidence: pd.confidence, sample_count: pd.sample_count, device: navigator.userAgent, consent: true,
        });
        this.panel.setMessage('수치만 전송(mock) — 콘솔 확인', 'ok');
      },
      onRecordToggle: () => {
        if (this.recorder.recording) { this.recorder.stop(); this.panel.setMessage(`녹화 ${this.recorder.frames.length} 프레임`, 'ok'); }
        else if (this.mode === 'live') this.recorder.start();
        else this.panel.setMessage('녹화는 카메라 실행 중에만 가능합니다.');
      },
      onDownloadRecording: () => {
        if (this.recorder.frames.length === 0) { this.panel.setMessage('녹화된 프레임이 없습니다.'); return; }
        downloadJson(`${this.recorder.stop().name}.json`, this.recorder.stop());
      },
      onLoadFile: async (file: File) => {
        try { this.loadReplay(await readJsonFile(file)); }
        catch (err) { this.panel.setMessage(`파일 로드 실패: ${err instanceof Error ? err.message : err}`, 'bad'); }
      },
      onLoadDemo: async () => {
        try {
          const res = await fetch(demoUrl);
          this.loadReplay((await res.json()) as GoldenVector);
        } catch (err) { this.panel.setMessage(`데모 로드 실패: ${err instanceof Error ? err.message : err}`, 'bad'); }
      },
      onReplayToggle: () => {
        if (this.replayer.playing) { this.replayer.pause(); }
        else if (this.replayer.length) { this.stopCamera(); this.startReplay(); }
        else this.panel.setMessage('재생할 세션이 없습니다. 파일 또는 데모를 로드하세요.');
      },
      onReplayStop: () => this.stopReplay(),
      onExportCsv: () => {
        if (this.rows.length === 0) { this.panel.setMessage('지표가 없습니다.'); return; }
        downloadText(`metrics-${Date.now()}.csv`, metricsToCsv(this.rows), 'text/csv');
      },
      onExportGolden: () => {
        const frames = this.recorder.frames.length ? this.recorder.frames : this.replayer.frames;
        if (frames.length === 0) { this.panel.setMessage('골든 벡터를 만들 프레임이 없습니다 (녹화 또는 재생 세션 필요).'); return; }
        const golden = generateGolden(`golden-${Date.now()}`, frames, this.core.config, this.core.frameSpec);
        downloadJson(`${golden.name}.json`, golden);
        this.panel.setMessage(`골든 벡터 ${frames.length} 프레임 내보냄`, 'ok');
      },
      onResetMeters: () => this.resetMeters(),
    };
  }
}
