/** getUserMedia wrapper. Camera start must be triggered by a user gesture on iOS Safari. */
export interface CameraProfile {
  label: string;
  width: number;
  height: number;
}

export const CAMERA_PROFILES: CameraProfile[] = [
  { label: '1280×720', width: 1280, height: 720 },
  { label: '640×480', width: 640, height: 480 },
  { label: '1920×1080', width: 1920, height: 1080 },
];

export class CameraSource {
  private stream: MediaStream | null = null;

  constructor(readonly video: HTMLVideoElement) {
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
  }

  get active(): boolean {
    return this.stream !== null;
  }

  async start(profile: CameraProfile, facingMode: 'user' | 'environment' = 'user'): Promise<{ width: number; height: number }> {
    this.stop();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia is not available (HTTPS required)');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode, width: { ideal: profile.width }, height: { ideal: profile.height }, frameRate: { ideal: 30 } },
    });
    this.video.srcObject = this.stream;
    await new Promise<void>((resolve, reject) => {
      const onMeta = () => { cleanup(); resolve(); };
      const onErr = () => { cleanup(); reject(new Error('video failed to load')); };
      const cleanup = () => { this.video.removeEventListener('loadedmetadata', onMeta); this.video.removeEventListener('error', onErr); };
      this.video.addEventListener('loadedmetadata', onMeta);
      this.video.addEventListener('error', onErr);
    });
    await this.video.play();
    return { width: this.video.videoWidth, height: this.video.videoHeight };
  }

  stop(): void {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
  }
}
