import type { GestureRecognizer } from '@mediapipe/tasks-vision';
import type { Move } from './game';

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
const HOLD_MS = 850;
const gestureMoves: Record<string, Move | undefined> = {
  Closed_Fist: 'rock',
  Open_Palm: 'paper',
  Victory: 'scissors',
};
const labels: Record<Move, string> = { rock: 'ROCK ✊', paper: 'PAPER ✋', scissors: 'SCISSORS ✌' };

export class GestureCamera {
  active = false;
  loading = false;
  private stream: MediaStream | null = null;
  private recognizer: GestureRecognizer | null = null;
  private video: HTMLVideoElement | null = null;
  private frame = 0;
  private lastVideoTime = -1;
  private candidate: Move | null = null;
  private candidateSince = 0;
  private submitted = false;
  private roundKey = '';
  private canChoose = false;

  constructor(private submit: (move: Move) => void, private refresh: () => void, private notify: (message: string) => void) {}

  render() {
    if (this.loading) return '<div class="gesture-launch loading"><span class="camera-dot"></span><b>WARMING UP CAMERA…</b><small>Loading hand recognition on this device.</small></div>';
    if (!this.active) return '<button class="gesture-launch" data-room="camera"><span>◉</span><b>PLAY WITH HAND GESTURES</b><small>Camera stays on this device · buttons remain available</small></button>';
    return `<div class="gesture-camera" style="--gesture-progress:0%"><video id="gesture-video" muted playsinline aria-label="Your mirrored camera preview"></video><div class="gesture-frame"></div><div class="gesture-readout"><small>CAMERA MODE</small><strong id="gesture-status">SHOW YOUR HAND</strong><span id="gesture-help">✊ ROCK · ✋ PAPER · ✌ SCISSORS</span></div><i class="gesture-progress"></i><button data-room="camera" aria-label="Turn off camera">×</button></div>`;
  }

  async toggle() { if (this.active || this.loading) this.stop(); else await this.start(); }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) { this.notify('Camera gestures are not supported in this browser. Use the move buttons.'); return; }
    this.loading = true; this.refresh();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (!this.recognizer) {
        const { FilesetResolver, GestureRecognizer } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
        const options = {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' as const }, runningMode: 'VIDEO' as const, numHands: 1,
          minHandDetectionConfidence: .55, minHandPresenceConfidence: .55, minTrackingConfidence: .55,
          cannedGesturesClassifierOptions: { scoreThreshold: .65, categoryAllowlist: Object.keys(gestureMoves) },
        };
        try { this.recognizer = await GestureRecognizer.createFromOptions(vision, options); }
        catch { this.recognizer = await GestureRecognizer.createFromOptions(vision, { ...options, baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' } }); }
      }
      this.active = true; this.loading = false; this.notify('Camera mode ready. Hold your hand sign steady to lock it.'); this.refresh();
    } catch (error) {
      this.loading = false; this.releaseStream(); this.refresh();
      const denied = error instanceof DOMException && ['NotAllowedError', 'PermissionDeniedError'].includes(error.name);
      this.notify(denied ? 'Camera permission was not granted. You can still use the move buttons.' : 'Could not start camera mode. You can still use the move buttons.');
    }
  }

  mount(canChoose: boolean, roundKey: string) {
    this.canChoose = canChoose;
    if (roundKey !== this.roundKey) { this.roundKey = roundKey; this.submitted = false; this.resetCandidate(); }
    if (!this.active) return;
    const video = document.querySelector<HTMLVideoElement>('#gesture-video');
    if (!video) return;
    if (video !== this.video) {
      this.video = video; video.srcObject = this.stream; void video.play().catch(() => {});
    }
    if (!this.frame) this.frame = requestAnimationFrame(time => this.detect(time));
  }

  private detect(time: number) {
    this.frame = 0;
    if (!this.active) return;
    const video = this.video;
    if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== this.lastVideoTime && this.recognizer) {
      this.lastVideoTime = video.currentTime;
      try {
        const result = this.recognizer.recognizeForVideo(video, time);
        const category = result.gestures[0]?.[0];
        const move = category && category.score >= .65 ? gestureMoves[category.categoryName] ?? null : null;
        this.track(move, time);
      } catch { this.update('KEEP YOUR HAND IN FRAME', 'Try moving into brighter light.', 0); }
    }
    this.frame = requestAnimationFrame(next => this.detect(next));
  }

  private track(move: Move | null, now: number) {
    if (!this.canChoose || this.submitted) { this.resetCandidate(); this.update(this.submitted ? 'CHOICE LOCKED' : 'WAIT FOR THE ROUND', 'Camera is ready.', 0); return; }
    if (!move) { this.resetCandidate(); this.update('SHOW YOUR HAND', '✊ ROCK · ✋ PAPER · ✌ SCISSORS', 0); return; }
    if (move !== this.candidate) { this.candidate = move; this.candidateSince = now; }
    const progress = Math.min(1, (now - this.candidateSince) / HOLD_MS);
    this.update(`${labels[move]} DETECTED`, progress < 1 ? 'Hold it steady…' : 'Locked!', progress);
    if (progress >= 1) { this.submitted = true; this.resetCandidate(); navigator.vibrate?.(35); this.submit(move); }
  }

  private update(status: string, help: string, progress: number) {
    const panel = document.querySelector<HTMLElement>('.gesture-camera');
    const statusEl = document.querySelector('#gesture-status'), helpEl = document.querySelector('#gesture-help');
    if (panel) panel.style.setProperty('--gesture-progress', `${Math.round(progress * 100)}%`);
    if (statusEl) statusEl.textContent = status;
    if (helpEl) helpEl.textContent = help;
  }
  private resetCandidate() { this.candidate = null; this.candidateSince = 0; }
  private releaseStream() { this.stream?.getTracks().forEach(track => track.stop()); this.stream = null; }
  stop() {
    this.active = false; this.loading = false; this.canChoose = false; this.submitted = false; this.resetCandidate();
    if (this.frame) cancelAnimationFrame(this.frame); this.frame = 0; this.video = null; this.releaseStream(); this.refresh();
  }
  destroy() { this.stop(); this.recognizer?.close(); this.recognizer = null; }
}
