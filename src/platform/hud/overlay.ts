/**
 * 2D overlay drawn in image coordinates on a canvas inside the mirrored stage.
 * No text here (it would be mirrored); numbers live in the panel.
 */
import { LM } from '../../core/landmarks';
import { RIDGE_PROFILE } from '../../core/fitting/noseLanding';
import type { FitOutput, FrameInput } from '../../core/types';

export interface OverlayOptions {
  landmarks: boolean;
  anchors: boolean;
}

export class LandmarkOverlay {
  private ctx: CanvasRenderingContext2D;
  private measuring: ((lengthPx: number) => void) | null = null;
  private dragStart: { x: number; y: number } | null = null;
  private dragEnd: { x: number; y: number } | null = null;
  private mirrored = true;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', (e) => this.onPointer(e, 'down'));
    canvas.addEventListener('pointermove', (e) => this.onPointer(e, 'move'));
    canvas.addEventListener('pointerup', (e) => this.onPointer(e, 'up'));
  }

  setSize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  setMirrored(m: boolean): void {
    this.mirrored = m;
  }

  /** Card calibration: the user drags along the card's long edge; resolves with the length in image px. */
  startMeasure(onDone: (lengthPx: number) => void): void {
    this.measuring = onDone;
    this.canvas.style.pointerEvents = 'auto';
    this.canvas.style.cursor = 'crosshair';
  }

  cancelMeasure(): void {
    this.measuring = null;
    this.dragStart = this.dragEnd = null;
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.cursor = '';
  }

  private toImage(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    let nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    if (this.mirrored) nx = 1 - nx;
    return { x: nx * this.canvas.width, y: ny * this.canvas.height };
  }

  private onPointer(e: PointerEvent, kind: 'down' | 'move' | 'up'): void {
    if (!this.measuring) return;
    e.preventDefault();
    if (kind === 'down') {
      this.dragStart = this.toImage(e);
      this.dragEnd = null;
      this.canvas.setPointerCapture(e.pointerId);
    } else if (kind === 'move' && this.dragStart) {
      this.dragEnd = this.toImage(e);
    } else if (kind === 'up' && this.dragStart) {
      this.dragEnd = this.toImage(e);
      const len = Math.hypot(this.dragEnd.x - this.dragStart.x, this.dragEnd.y - this.dragStart.y);
      const cb = this.measuring;
      this.cancelMeasure();
      if (len > 5) cb(len);
    }
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(frame: FrameInput | null, out: FitOutput | null, opts: OverlayOptions): void {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const lm = frame?.landmarks;
    if (lm && opts.landmarks) {
      ctx.fillStyle = 'rgba(80,255,120,0.75)';
      for (let i = 0; i < 468; i++) ctx.fillRect(lm[i].x * W - 1, lm[i].y * H - 1, 2, 2);
      ctx.strokeStyle = 'rgba(0,220,255,0.9)';
      ctx.lineWidth = 1.5;
      for (const [c, ring] of [[LM.IRIS_L_CENTER, LM.IRIS_L_CONTOUR], [LM.IRIS_R_CENTER, LM.IRIS_R_CONTOUR]] as const) {
        const r = Math.hypot((lm[ring[0]].x - lm[ring[2]].x) * W, (lm[ring[0]].y - lm[ring[2]].y) * H) / 2;
        ctx.beginPath();
        ctx.arc(lm[c].x * W, lm[c].y * H, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (lm && opts.anchors) {
      const dot = (i: number, color: string, size = 5) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(lm[i].x * W, lm[i].y * H, size, 0, Math.PI * 2);
        ctx.fill();
      };
      // Nose ridge profile.
      ctx.strokeStyle = 'rgba(255,220,0,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      RIDGE_PROFILE.forEach((i, k) => (k === 0 ? ctx.moveTo(lm[i].x * W, lm[i].y * H) : ctx.lineTo(lm[i].x * W, lm[i].y * H)));
      ctx.stroke();
      for (const i of RIDGE_PROFILE) dot(i, 'rgba(255,220,0,0.9)', 3);
      for (const i of [LM.TEMPLE_L, LM.TEMPLE_R]) dot(i, 'rgba(255,80,255,0.9)');
      for (const i of [LM.EAR_L, LM.EAR_R]) dot(i, 'rgba(255,140,255,0.7)', 4);
    }
    if (out?.bridgeAnchor && opts.anchors) {
      const { x, y } = out.bridgeAnchor.screen;
      ctx.strokeStyle = 'rgba(255,60,60,0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x * W - 12, y * H); ctx.lineTo(x * W + 12, y * H);
      ctx.moveTo(x * W, y * H - 12); ctx.lineTo(x * W, y * H + 12);
      ctx.stroke();
    }
    if (this.measuring && this.dragStart && this.dragEnd) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(this.dragStart.x, this.dragStart.y);
      ctx.lineTo(this.dragEnd.x, this.dragEnd.y);
      ctx.stroke();
    }
  }
}
