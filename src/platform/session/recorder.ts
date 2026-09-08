/** Session recording (FrameInput sequences), replay, and file export helpers. */
import { compactFrame, type GoldenVector } from '../../core/golden';
import type { FrameInput } from '../../core/types';

export interface RecordedSession {
  version: 1;
  name: string;
  createdAt: string;
  userAgent: string;
  imageWidth: number;
  imageHeight: number;
  frames: FrameInput[];
}

export class SessionRecorder {
  frames: FrameInput[] = [];
  recording = false;
  private width = 0;
  private height = 0;

  start(): void {
    this.frames = [];
    this.recording = true;
  }

  push(frame: FrameInput): void {
    if (!this.recording) return;
    this.width = frame.imageWidth;
    this.height = frame.imageHeight;
    this.frames.push(compactFrame(frame));
  }

  stop(name = `session-${new Date().toISOString().replace(/[:.]/g, '-')}`): RecordedSession {
    this.recording = false;
    return {
      version: 1,
      name,
      createdAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      imageWidth: this.width,
      imageHeight: this.height,
      frames: this.frames,
    };
  }
}

export type ReplayInput = RecordedSession | GoldenVector;

export class SessionReplayer {
  frames: FrameInput[] = [];
  name = '';
  private idx = 0;
  private timer = 0;
  private active = false;
  private loops = 0;
  speed = 1;
  loop = true;

  load(data: ReplayInput): void {
    this.stop();
    this.frames = data.frames;
    this.name = data.name;
    this.idx = 0;
    this.loops = 0;
  }

  get playing(): boolean { return this.active; }
  get index(): number { return this.idx; }
  get length(): number { return this.frames.length; }

  /** Duration of one pass (ms), used to keep timestamps increasing across loops. */
  private get duration(): number {
    if (this.frames.length < 2) return 33;
    return this.frames[this.frames.length - 1].timestampMs - this.frames[0].timestampMs + 33;
  }

  /**
   * Emits frames on their recorded timestamps (× speed). A short timer with catch-up is used
   * rather than requestAnimationFrame so replay also progresses in throttled/hidden tabs
   * (where rAF pauses and timers fire at 1 Hz).
   */
  play(onFrame: (frame: FrameInput, index: number) => void, onLoop?: () => void): void {
    if (this.frames.length === 0) return;
    this.active = true;
    let wallStart = performance.now();
    let tsStart = this.frames[this.idx].timestampMs;
    const step = () => {
      if (!this.active) return;
      const now = performance.now();
      const elapsed = (now - wallStart) * this.speed;
      let emitted = 0;
      while (this.active && emitted < 60) {
        if (this.idx >= this.frames.length) {
          if (!this.loop) { this.active = false; return; }
          this.idx = 0;
          this.loops++;
          wallStart = now;
          tsStart = this.frames[0].timestampMs;
          onLoop?.();
          break;
        }
        const f = this.frames[this.idx];
        if (f.timestampMs - tsStart > elapsed) break;
        onFrame({ ...f, timestampMs: f.timestampMs + this.loops * this.duration }, this.idx);
        this.idx++;
        emitted++;
      }
      this.timer = window.setTimeout(step, 15);
    };
    step();
  }

  pause(): void {
    this.active = false;
    clearTimeout(this.timer);
  }

  stop(): void {
    this.pause();
    this.idx = 0;
    this.loops = 0;
  }
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const downloadJson = (filename: string, data: unknown): void => downloadText(filename, JSON.stringify(data));

/**
 * One per-frame metrics row (built in App.updateMeters; column order = key order). Columns:
 * t_ms, state, alpha, confidence, yaw/pitch/roll_raw, yaw/pitch/roll_f, bridge_raw_x/y_px, bridge_x/y_px,
 * width_scale, uniform_scale, splay_l_deg, splay_r_deg,
 * forward_mm, pen_temple, pen_brow, pen_cheek, pen_nose (clearance solve: forward push and residual
 *   penetration in mm; null without a frame spec, blank in CSV when no probe is near that region),
 * pd_near, pd_far, pd_samples, detect_ms, pipeline_ms, fps, matrix_tz_mm.
 */
export type MetricRow = Record<string, number | string | null>;

export function metricsToCsv(rows: MetricRow[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const fmt = (v: number | string | null) => (typeof v === 'number' ? (Number.isFinite(v) ? v.toFixed(4) : '') : v ?? '');
  return [cols.join(','), ...rows.map((r) => cols.map((c) => fmt(r[c])).join(','))].join('\n');
}

export async function readJsonFile(file: File): Promise<ReplayInput> {
  const text = await file.text();
  const data = JSON.parse(text) as ReplayInput;
  if (!Array.isArray(data.frames)) throw new Error('not a session/golden file (missing frames[])');
  return data;
}
