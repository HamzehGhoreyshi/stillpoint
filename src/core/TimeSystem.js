import { CONFIG } from '../config.js';

// The time manipulation system.
//
// The player always runs on real time. Everything else (enemies, bullets,
// debris) runs on "world time" = real time x scale. This class decides the
// scale from what the player is doing, and smooths it so the world eases
// between frozen and flowing instead of snapping.

export class TimeSystem {
  constructor() {
    this.reset();
  }

  reset() {
    this.scale = CONFIG.time.min;
    this.worldDt = 0;
    this.world = 0;
    this.pulseT = 0;
    this.pulseDur = 1;
    this.pulseStrength = 0;
    this.override = null; // forces a scale (death slow-motion, menu)
  }

  // A burst of time, used when firing so the shot is readable.
  addPulse(strength, duration) {
    this.pulseStrength = strength;
    this.pulseDur = duration;
    this.pulseT = duration;
  }

  // activity: { move 0..1, look 0..1, airborne, busy }
  update(dt, activity) {
    const c = CONFIG.time;
    let target = c.min + (1 - c.min) * Math.pow(activity.move, c.curve);
    if (activity.airborne) target = Math.max(target, c.airMin);
    if (activity.busy) target = Math.max(target, c.reloadMin);
    target = Math.max(target, c.min + activity.look * c.lookMax);

    if (this.pulseT > 0) {
      this.pulseT -= dt;
      const k = Math.max(this.pulseT / this.pulseDur, 0);
      target = Math.max(target, this.pulseStrength * Math.sqrt(k));
    }
    if (this.override !== null) target = this.override;

    const rate = target > this.scale ? c.riseRate : c.fallRate;
    this.scale += (target - this.scale) * (1 - Math.exp(-rate * dt));
    this.worldDt = dt * this.scale;
    this.world += this.worldDt;
  }

  // 0 = frozen, 1 = full speed. Used by visuals and audio.
  get flow() {
    const m = CONFIG.time.min;
    return Math.min(Math.max((this.scale - m) / (1 - m), 0), 1);
  }
}
