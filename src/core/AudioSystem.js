import { Music, MUSIC_BPM } from './Music.js';

// All sound is synthesised live with the Web Audio API (no audio files).
// This class holds the one-shot effects (shots, hits, clicks); the
// soundtrack lives in Music.js.

export class AudioSystem {
  constructor() {
    this.ctx = null;
  }

  // Browsers only allow audio after a user gesture, so this runs on first click.
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.music = new Music(ctx, this.master, this.noiseBuf);
    this.loadCrySample();
  }

  // Beats since the music started. Before the first click (no audio yet) a
  // plain clock stands in, so the lights still pulse on the title screen.
  get beat() {
    const live = this.music && this.ctx.state === 'running';
    return live ? this.music.beat : (performance.now() / 1000) * (MUSIC_BPM / 60);
  }

  setFlow(flow, active) {
    this.music?.setFlow(flow, active);
  }

  toggleMusic() {
    if (!this.music) return;
    this.music.muted = !this.music.muted;
  }

  noise(dur, freq, q, gain, type = 'bandpass', delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loopStart = Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.02);
  }

  tone(f0, f1, dur, gain, type = 'sine', delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  shoot() {
    this.noise(0.14, 1800, 0.6, 0.55, 'highpass');
    this.noise(0.22, 420, 0.8, 0.5);
    this.tone(210, 46, 0.16, 0.7);
    this.tone(1400, 500, 0.05, 0.12, 'square');
  }
  rifleShot() {
    this.noise(0.09, 2400, 0.7, 0.4, 'highpass');
    this.noise(0.14, 700, 0.9, 0.42);
    this.tone(260, 60, 0.1, 0.5);
  }
  sniperShot() {
    this.noise(0.3, 1200, 0.5, 0.7, 'highpass');
    this.noise(0.6, 260, 0.7, 0.7, 'lowpass');
    this.tone(180, 30, 0.4, 0.9);
    this.tone(2400, 300, 0.12, 0.14, 'sawtooth');
  }
  // --- crying -----------------------------------------------------------
  // If a real recording exists at public/sounds/cry.mp3 it is used.
  // Otherwise the cry is built as a voice: a buzzing "vocal cord" source
  // plus breath noise, pushed through three vowel filters (the resonances
  // that make a mouth sound like a mouth), with a pitch that climbs and
  // breaks the way a sob does.
  async loadCrySample() {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sounds/cry.mp3`);
      if (!res.ok || !(res.headers.get('content-type') || '').startsWith('audio')) return;
      this.crySample = await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch { /* no recording: the synthesised voice is used */ }
  }

  // One voiced sound. f = [start, peak, end] pitch in Hz, vowel = 3 formants.
  voice(t, dur, f, vowel, gain, breath = 0.25) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.07, dur * 0.3));
    out.gain.setValueAtTime(gain, t + dur * 0.6);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    out.connect(this.master);

    const mouth = ctx.createGain(); // everything below is shaped by the vowel
    vowel.forEach((freq, i) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 7 + i * 2;
      const g = ctx.createGain();
      g.gain.value = [1, 0.55, 0.22][i];
      mouth.connect(bp).connect(g).connect(out);
    });

    // vocal cords: a softened buzz whose pitch rises, then falls and breaks
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass'; soft.frequency.value = 2600;
    soft.connect(mouth);
    const jitter = 0.97 + Math.random() * 0.06;
    for (const detune of [0, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = detune;
      o.frequency.setValueAtTime(f[0] * jitter, t);
      o.frequency.linearRampToValueAtTime(f[1] * jitter, t + dur * 0.3);
      o.frequency.exponentialRampToValueAtTime(f[2] * jitter, t + dur);
      // tremble: fast shallow wobble that deepens as the breath runs out
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 6.5 + Math.random() * 2;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(3, t);
      depth.gain.linearRampToValueAtTime(16, t + dur);
      lfo.connect(depth).connect(o.frequency);
      o.connect(soft);
      o.start(t); o.stop(t + dur + 0.03);
      lfo.start(t); lfo.stop(t + dur + 0.03);
    }
    // breath in the voice
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const ng = ctx.createGain();
    ng.gain.value = breath;
    n.connect(ng).connect(mouth);
    n.start(t, Math.random() * 0.4, dur + 0.03);
  }

  // A sharp breath in between sobs.
  gasp(delay, dur = 0.16) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t, Math.random() * 0.4, dur + 0.03);
  }

  // The whole cry: gasp, long wail, gasp, three broken sobs, gasp, wail.
  sob() {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.crySample) {
      const src = ctx.createBufferSource();
      src.buffer = this.crySample;
      const g = ctx.createGain();
      g.gain.value = 0.9;
      src.connect(g).connect(this.master);
      src.start(0, 0, 3);
      return;
    }
    const t = ctx.currentTime;
    const AH = [780, 1250, 2600], UH = [620, 1050, 2400], EH = [560, 1700, 2500];
    this.gasp(0);
    this.voice(t + 0.18, 0.78, [205, 300, 170], AH, 0.5);
    this.gasp(1.0, 0.13);
    this.voice(t + 1.16, 0.17, [255, 270, 200], UH, 0.42, 0.35);
    this.voice(t + 1.38, 0.17, [245, 258, 190], UH, 0.4, 0.35);
    this.voice(t + 1.6, 0.2, [232, 245, 172], EH, 0.38, 0.4);
    this.gasp(1.86, 0.15);
    this.voice(t + 2.04, 0.66, [215, 272, 150], AH, 0.46, 0.3);
  }
  // a little crowd "woo" when a dancer arrives
  cheer() {
    for (let i = 0; i < 4; i++) {
      const f = 500 + Math.random() * 500;
      this.tone(f, f * 1.9, 0.32, 0.05, 'triangle', i * 0.04);
    }
    this.noise(0.5, 1800, 0.6, 0.12, 'bandpass', 0.05);
  }
  // a shield soaking up a shot (glassy ping) or shattering
  shieldHit(broke) {
    if (broke) {
      for (let i = 0; i < 6; i++) this.tone(1800 + Math.random() * 2600, 900, 0.22, 0.1, 'triangle', i * 0.02);
      this.noise(0.28, 5200, 0.8, 0.3, 'highpass');
      this.tone(300, 80, 0.2, 0.3);
    } else {
      this.tone(2300, 1900, 0.16, 0.2, 'sine');
      this.tone(3450, 3000, 0.1, 0.1, 'sine');
    }
  }
  enemyShoot(dist) {
    const v = Math.max(1 - dist / 45, 0.15);
    this.noise(0.18, 700, 0.9, 0.4 * v);
    this.tone(150, 40, 0.2, 0.45 * v, 'triangle');
  }
  impact() { this.noise(0.06, 2600, 1.5, 0.16); }
  enemyHit() {
    this.tone(1500 + Math.random() * 500, 900, 0.09, 0.2, 'triangle');
    this.noise(0.08, 3000, 1, 0.2, 'highpass');
  }
  kill() {
    for (let i = 0; i < 5; i++) {
      const f = 900 + Math.random() * 2200;
      this.tone(f, f * 0.7, 0.16 + Math.random() * 0.2, 0.11, 'sine', i * 0.025);
    }
    this.noise(0.3, 4200, 0.7, 0.28, 'highpass');
    this.tone(120, 38, 0.28, 0.5);
  }
  hurt() {
    this.tone(160, 42, 0.45, 0.6, 'sawtooth');
    this.noise(0.3, 300, 0.7, 0.6, 'lowpass');
  }
  dry() { this.tone(900, 700, 0.03, 0.14, 'square'); this.noise(0.03, 4000, 2, 0.1); }
  click(pitch = 1) { this.noise(0.04, 2400 * pitch, 3, 0.26); this.tone(320 * pitch, 180 * pitch, 0.04, 0.16, 'square'); }
  land(impact) { this.tone(90, 38, 0.14, 0.3 + impact * 0.4); this.noise(0.1, 240, 0.8, 0.2 + impact * 0.3, 'lowpass'); }
  jump() { this.noise(0.09, 500, 0.8, 0.1); }
  whoosh() { this.noise(0.22, 900, 2.2, 0.32); this.noise(0.18, 1800, 3, 0.14, 'bandpass', 0.03); }
  spawn() { this.tone(180, 520, 0.4, 0.12, 'triangle'); }
  wave() { this.tone(392, 392, 0.3, 0.14, 'triangle'); this.tone(587, 587, 0.5, 0.14, 'triangle', 0.14); }
  death() { this.tone(220, 28, 1.4, 0.55, 'sawtooth'); this.noise(1.1, 200, 0.6, 0.5, 'lowpass'); }
}
