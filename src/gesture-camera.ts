import type { GestureRecognizer } from '@mediapipe/tasks-vision';
import type { Move } from './game';

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
const HOLD_MS = 700;
const LOST_GRACE_MS = 280;
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
  private candidateLastSeen = 0;
  private submitted = false;
  private roundKey = '';
  private canChoose = false;

  constructor(private submit: (move: Move) => void, private refresh: () => void, private notify: (message: string) => void) {}

  render(scope: 'room' | 'cpu' = 'room') {
    const action = scope === 'room' ? 'data-room="camera"' : 'data-action="camera"';
    if (this.loading) return '<div class="gesture-launch loading"><span class="camera-dot"></span><b>WARMING UP CAMERA…</b><small>Loading hand recognition on this device.</small></div>';
    if (!this.active) return `<button class="gesture-launch" ${action}><span>◉</span><b>ENABLE CAMERA TO PLAY</b><small>Camera permission is required for hand-gesture controls</small></button>`;
    return '<div class="gesture-camera" style="--gesture-progress:0%"><video id="gesture-video" muted playsinline aria-label="Your mirrored camera preview"></video><div class="gesture-frame"></div><div class="gesture-readout"><small>LIVE HAND CONTROL</small><strong id="gesture-status">SHOW YOUR HAND</strong><span id="gesture-help">✊ ROCK · ✋ PAPER · ✌ SCISSORS</span></div><i class="gesture-progress"></i></div>';
  }

  async toggle() { if (this.active || this.loading) this.stop(); else await this.start(); }

  async start() {
    if (this.active || this.loading) return;
    if (!navigator.mediaDevices?.getUserMedia) { this.notify('Camera gestures are not supported in this browser. Use the move buttons.'); return; }
    this.loading = true; this.refresh();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (!this.recognizer) {
        const { FilesetResolver, GestureRecognizer } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
        const options = {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' as const }, runningMode: 'VIDEO' as const, numHands: 1,
          minHandDetectionConfidence: .45, minHandPresenceConfidence: .45, minTrackingConfidence: .45,
          cannedGesturesClassifierOptions: { scoreThreshold: .5, categoryAllowlist: Object.keys(gestureMoves) },
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
    if (roundKey !== this.roundKey) {
      this.roundKey = roundKey;
      this.submitted = false;
      this.lastVideoTime = -1;
      this.resetCandidate();
    }
    if (!this.active) return;
    const video = document.querySelector<HTMLVideoElement>('#gesture-video');
    if (!video) return;
    if (video !== this.video) {
      this.video = video; video.srcObject = this.stream; void video.play().catch(() => {});
    }
    if (!this.frame) this.frame = requestAnimationFrame(time => this.detect(time));
  }

  private detect(time: number) {
    if (!this.active) { this.frame = 0; return; }
    const video = this.video;
    if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== this.lastVideoTime && this.recognizer) {
      this.lastVideoTime = video.currentTime;
      try {
        const result = this.recognizer.recognizeForVideo(video, time);
        const category = result.gestures[0]?.[0];
        const move = category && category.score >= .5 ? gestureMoves[category.categoryName] ?? null : this.classifyLandmarks(result.landmarks[0]);
        this.track(move, time);
      } catch { this.update('KEEP YOUR HAND IN FRAME', 'Try moving into brighter light.', 0); }
    }
    this.frame = requestAnimationFrame(next => this.detect(next));
  }

  private track(move: Move | null, now: number) {
    if (!this.canChoose || this.submitted) { this.resetCandidate(); this.update(this.submitted ? 'CHOICE LOCKED' : 'WAIT FOR THE ROUND', 'Camera is ready.', 0); return; }
    if (!move) {
      if (this.candidate && now - this.candidateLastSeen < LOST_GRACE_MS) return;
      this.resetCandidate(); this.update('SHOW YOUR HAND', 'Keep one hand open and fully inside the frame.', 0); return;
    }
    if (move !== this.candidate) {
      if (this.candidate && now - this.candidateLastSeen < LOST_GRACE_MS) return;
      this.candidate = move; this.candidateSince = now;
    }
    this.candidateLastSeen = now;
    const progress = Math.min(1, (now - this.candidateSince) / HOLD_MS);
    this.update(`${labels[move]} DETECTED`, progress < 1 ? 'Hold it steady…' : 'Locked!', progress);
    if (progress >= 1) { this.submitted = true; this.resetCandidate(); navigator.vibrate?.(35); this.submit(move); }
  }
  private classifyLandmarks(hand?: Array<{ x: number; y: number }>): Move | null {
    if (!hand?.[20]) return null;
    const wrist = hand[0];
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    const extended = [[8, 6], [12, 10], [16, 14], [20, 18]].map(([tip, joint]) => distance(hand[tip], wrist) > distance(hand[joint], wrist) * 1.12);
    const count = extended.filter(Boolean).length;
    if (count === 0) return 'rock';
    if (extended[0] && extended[1] && !extended[2] && !extended[3]) return 'scissors';
    if (count >= 3) return 'paper';
    return null;
  }

  private update(status: string, help: string, progress: number) {
    const panel = document.querySelector<HTMLElement>('.gesture-camera');
    const statusEl = document.querySelector('#gesture-status'), helpEl = document.querySelector('#gesture-help');
    if (panel) panel.style.setProperty('--gesture-progress', `${Math.round(progress * 100)}%`);
    if (statusEl) statusEl.textContent = status;
    if (helpEl) helpEl.textContent = help;
  }
  private resetCandidate() { this.candidate = null; this.candidateSince = 0; this.candidateLastSeen = 0; }
  private releaseStream() { this.stream?.getTracks().forEach(track => track.stop()); this.stream = null; }
  stop(refresh = true) {
    this.active = false; this.loading = false; this.canChoose = false; this.submitted = false; this.resetCandidate();
    if (this.frame) cancelAnimationFrame(this.frame); this.frame = 0; this.video = null; this.releaseStream(); if (refresh) this.refresh();
  }
  destroy() { this.stop(); this.recognizer?.close(); this.recognizer = null; }
}
