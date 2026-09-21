export class AudioDirector {
  enabled = true;
  private context?: AudioContext;
  private music = new Audio();
  private musicUrl: string | null = null;
  private wantsMusic = false;
  musicName = '';
  musicVolume = .22;
  get musicPlaying() { return this.wantsMusic && !this.music.paused; }
  constructor() {
    this.music.loop = true; this.music.volume = this.musicVolume; this.music.preload = 'auto';
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.music.pause();
      else if (this.wantsMusic && this.enabled) void this.music.play().catch(() => {});
    });
  }
  unlock() { this.context ??= new AudioContext(); void this.context.resume().catch(() => {}); if (this.wantsMusic && this.enabled) void this.music.play().catch(() => {}); }
  async loadMusic(file: File) {
    if (file.size > 30 * 1024 * 1024 || (!file.type.startsWith('audio/') && !/\.(mp3|m4a|wav|ogg)$/i.test(file.name))) throw new Error('Choose an audio file under 30 MB.');
    this.removeMusic(); this.musicUrl = URL.createObjectURL(file); this.music.src = this.musicUrl; this.musicName = file.name; this.wantsMusic = true;
    this.music.muted = !this.enabled;
    try { await this.music.play(); }
    catch { this.removeMusic(); throw new Error('This browser couldn’t play that file. Try an MP3 or M4A.'); }
  }
  toggleMusic() { this.wantsMusic = !this.wantsMusic; if (this.wantsMusic) { this.music.muted = !this.enabled; void this.music.play().catch(() => { this.wantsMusic = false; }); } else this.music.pause(); }
  setMusicVolume(value: number) { this.musicVolume = Math.max(0, Math.min(1, value)); this.music.volume = this.musicVolume; }
  removeMusic() { this.music.pause(); this.music.removeAttribute('src'); this.music.load(); if (this.musicUrl) URL.revokeObjectURL(this.musicUrl); this.musicUrl = null; this.musicName = ''; this.wantsMusic = false; }
  tone(frequency = 160, duration = .15, type: OscillatorType = 'sine', volume = .1) {
    if (!this.enabled || !this.context) return;
    const c = this.context, oscillator = c.createOscillator(), gain = c.createGain();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, c.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, frequency / 3), c.currentTime + duration);
    gain.gain.setValueAtTime(volume, c.currentTime); gain.gain.exponentialRampToValueAtTime(.001, c.currentTime + duration);
    oscillator.connect(gain).connect(c.destination); oscillator.start(); oscillator.stop(c.currentTime + duration);
  }
  hit() { this.tone(90, .65, 'sawtooth', .16); this.tone(650, .14, 'triangle', .15); }
  say(text: string) {
    if (!this.enabled || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel(); const line = new SpeechSynthesisUtterance(text); line.rate = .9; line.pitch = .65; line.volume = .75; speechSynthesis.speak(line);
  }
  toggle() { this.enabled = !this.enabled; this.music.muted = !this.enabled; if (!this.enabled && 'speechSynthesis' in window) speechSynthesis.cancel(); if (this.enabled && this.wantsMusic) void this.music.play().catch(() => {}); return this.enabled; }
}
