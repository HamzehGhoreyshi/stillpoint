// The soundtrack: an original club track generated live, note by note.
// A small sequencer schedules sixteenth notes slightly ahead of time on the
// audio clock (kick, hats, clap, rolling bass, arpeggio, pad).
//
// The whole mix runs through one low-pass filter tied to the time mechanic:
// stand still and the music sinks to a muffled thump, like hearing the party
// through a wall; move and it opens up to full brightness.

const BPM = 122;
const STEP = 60 / BPM / 4; // one sixteenth note, in seconds

// four bars: A minor, A minor, F, G
const BASS = [55, 55, 43.65, 49];
const CHORDS = [
  [220, 261.63, 329.63, 440, 523.25, 659.25],
  [220, 261.63, 329.63, 440, 523.25, 659.25],
  [174.61, 220, 261.63, 349.23, 440, 523.25],
  [196, 246.94, 293.66, 392, 493.88, 587.33],
];
const ARP = [0, 2, 3, 2, 1, 3, 4, 3, 2, 4, 5, 4, 3, 2, 1, 2];

export class Music {
  constructor(ctx, dest, noiseBuf) {
    this.ctx = ctx;
    this.noiseBuf = noiseBuf;

    // instruments -> bus -> compressor -> time filter -> volume -> out
    this.bus = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.16;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 300;
    this.filter.Q.value = 0.8;
    this.volume = ctx.createGain();
    this.volume.gain.value = 0;
    this.bus.connect(comp).connect(this.filter).connect(this.volume).connect(dest);

    // echo for the arpeggio
    this.arpBus = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    this.arpBus.connect(this.bus);
    this.arpBus.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(this.bus);

    this.muted = false;
    this.startTime = ctx.currentTime + 0.12;
    this.nextTime = this.startTime;
    this.step = 0;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  // Beats since the track started (fractional). Drives the lights and dancers.
  get beat() {
    return Math.max((this.ctx.currentTime - this.startTime) / (STEP * 4), 0);
  }

  schedule() {
    const now = this.ctx.currentTime;
    if (this.nextTime < now) {
      // fell behind (tab was asleep): skip ahead but stay on the grid
      const missed = Math.ceil((now - this.nextTime) / STEP);
      this.nextTime += missed * STEP;
      this.step += missed;
    }
    while (this.nextTime < now + 0.14) {
      this.play(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step++;
    }
  }

  // flow 0..1 from the TimeSystem; active = a run is being played
  setFlow(flow, active) {
    const t = this.ctx.currentTime;
    const open = Math.pow(flow, 0.6);
    this.filter.frequency.setTargetAtTime(240 * Math.pow(80, open), t, 0.07);
    this.volume.gain.setTargetAtTime(this.muted ? 0 : active ? 0.5 + flow * 0.22 : 0.36, t, 0.12);
  }

  env(gainNode, t, peak, attack, decay) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(peak, t + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  osc(type, freq, t, dur, dest) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  noise(t, dur, type, freq, q, peak, dest = this.bus) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.002, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  play(step, t) {
    const ctx = this.ctx;
    const s = step % 16; // position in the bar
    const bar = Math.floor(step / 16);
    const chord = bar % 4;
    const section = Math.floor(bar / 4); // every 4 bars the arrangement shifts
    const breakdown = section % 4 === 3 && bar % 4 < 2; // drums drop out briefly
    const full = section > 0;

    // kick: four on the floor
    if (s % 4 === 0 && !breakdown) {
      const g = ctx.createGain();
      this.env(g, t, 0.95, 0.002, 0.2);
      g.connect(this.bus);
      const o = this.osc('sine', 150, t, 0.22, g);
      o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
      this.noise(t, 0.012, 'highpass', 3000, 0.7, 0.2);
    }
    // hats
    if (s % 2 === 1) this.noise(t, 0.03, 'highpass', 8000, 0.8, s % 4 === 3 ? 0.07 : 0.045);
    if (s % 4 === 2) this.noise(t, 0.09, 'highpass', 7000, 0.8, breakdown ? 0.05 : 0.11);
    // clap on beats 2 and 4
    if (full && !breakdown && (s === 4 || s === 12)) {
      this.noise(t, 0.13, 'bandpass', 1500, 0.9, 0.3);
      this.noise(t + 0.012, 0.1, 'bandpass', 2300, 1.2, 0.18);
    }
    // rolling bass: the three sixteenths between kicks
    if (s % 4 !== 0) {
      const f = BASS[chord] * (s % 8 === 7 ? 2 : 1);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 5;
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(160, t + 0.1);
      const g = ctx.createGain();
      this.env(g, t, 0.34, 0.004, 0.11);
      lp.connect(g).connect(this.bus);
      this.osc('sawtooth', f, t, 0.13, lp);
      this.osc('square', f, t, 0.13, lp).detune.value = 9;
    }
    // arpeggio
    if (full) {
      const f = CHORDS[chord][ARP[s]];
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 3;
      lp.frequency.setValueAtTime(breakdown ? 3400 : 2200, t);
      lp.frequency.exponentialRampToValueAtTime(500, t + 0.12);
      const g = ctx.createGain();
      this.env(g, t, breakdown ? 0.085 : 0.06, 0.003, 0.13);
      lp.connect(g).connect(this.arpBus);
      this.osc('sawtooth', f, t, 0.15, lp);
    }
    // pad: one soft chord per bar
    if (s === 0) {
      const len = STEP * 16;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.035, t + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      lp.connect(g).connect(this.bus);
      const c = CHORDS[chord];
      for (const f of [c[0], c[2], c[3]]) {
        this.osc('sawtooth', f, t, len, lp).detune.value = -7;
        this.osc('sawtooth', f, t, len, lp).detune.value = 7;
      }
    }
  }
}

export const MUSIC_BPM = BPM;
