/** Per-video-frame callback loop (requestVideoFrameCallback with rAF fallback). */
export interface FrameMeta {
  nowMs: number;
  /** Capture timestamp when the browser provides it, else nowMs. */
  captureMs: number;
  mediaTimeMs: number;
  width: number;
  height: number;
}

export class FrameLoop {
  private handle = 0;
  private useRvfc: boolean;
  private active = false;

  constructor(private video: HTMLVideoElement, private onFrame: (meta: FrameMeta) => void) {
    this.useRvfc = typeof video.requestVideoFrameCallback === 'function';
  }

  get running(): boolean {
    return this.active;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.schedule();
  }

  stop(): void {
    this.active = false;
    if (this.useRvfc) this.video.cancelVideoFrameCallback?.(this.handle);
    else cancelAnimationFrame(this.handle);
  }

  private schedule(): void {
    if (!this.active) return;
    if (this.useRvfc) {
      this.handle = this.video.requestVideoFrameCallback((now, meta) => {
        this.onFrame({
          nowMs: now,
          captureMs: meta.captureTime ?? now,
          mediaTimeMs: meta.mediaTime * 1000,
          width: meta.width,
          height: meta.height,
        });
        this.schedule();
      });
    } else {
      this.handle = requestAnimationFrame((now) => {
        if (this.video.readyState >= 2) {
          this.onFrame({ nowMs: now, captureMs: now, mediaTimeMs: this.video.currentTime * 1000, width: this.video.videoWidth, height: this.video.videoHeight });
        }
        this.schedule();
      });
    }
  }
}
