import { CONFIG } from '../config.js';
import { Enemy } from './Enemy.js';
import { segmentVsCapsuleY, segmentVsSphere } from '../weapons/ProjectileSystem.js';

// Owns the list of living enemies and the wave logic (what spawns, where,
// and when the next wave starts).

const WAVES = [
  ['gunner'],
  ['rusher', 'gunner'],
  ['gunner', 'gunner', 'rusher'],
  ['rusher', 'gunner', 'gunner', 'rusher'],
  ['gunner', 'rusher', 'marksman', 'gunner', 'rusher'],
];

export class EnemyManager {
  constructor(scene, spawnPoints) {
    this.scene = scene;
    this.spawnPoints = spawnPoints;
    this.list = [];
    this.onWave = null; // (number) => void
    this.onSpawn = null; // (enemy) => void
    this.reset();
  }

  reset() {
    for (const e of this.list) {
      if (e.alive) e.dispose();
      e.material.dispose();
    }
    this.list.length = 0;
    this.wave = 0;
    this.threat = 1; // enemy level, raised by the player's kills
    this.queue = [];
    this.timer = 1.0; // until the first wave
    this.spawnTimer = 0;
    this.lastPoint = -1;
  }

  get aliveCount() {
    return this.list.length;
  }

  compose(wave) {
    if (wave <= WAVES.length) return [...WAVES[wave - 1]];
    const count = Math.min(1 + wave, 12);
    const out = [];
    for (let i = 0; i < count; i++) {
      const r = Math.random();
      out.push(r < 0.42 ? 'rusher' : r < 0.86 ? 'gunner' : 'marksman');
    }
    return out;
  }

  spawnNext(player) {
    // pick a doorway far from the player, never the same twice running
    const pts = this.spawnPoints
      .map((p, i) => ({ p, i, d: Math.hypot(p.x - player.pos.x, p.z - player.pos.z) }))
      .filter((o) => o.i !== this.lastPoint && o.d > 12)
      .sort((a, b) => b.d - a.d);
    const pick = pts[Math.floor(Math.random() * Math.min(4, pts.length))] ?? { p: this.spawnPoints[0], i: 0 };
    this.lastPoint = pick.i;
    const e = new Enemy(this.queue.shift(), this.scene);
    e.spawn(pick.p.x, pick.p.z, player.pos.x, player.pos.z);
    const T = CONFIG.threat;
    e.setShield(Math.min(this.threat - 1, T.maxShield));
    e.speedMul = 1 + Math.min((this.threat - 1) * T.speedPerLevel, T.maxSpeedBonus);
    this.list.push(e);
    this.onSpawn?.(e);
  }

  // Called after every kill by the player. Returns true if the level rose.
  // Every survivor gains a shield point on the spot.
  onPlayerKill(kills, effects) {
    const T = CONFIG.threat;
    const level = 1 + Math.floor(kills / T.killsPerLevel);
    const rose = level > this.threat;
    this.threat = level;
    const cap = Math.min(level, T.maxShield);
    for (const e of this.list) {
      if (!e.alive || e.shield >= cap) continue;
      e.setShield(e.shield + 1);
      effects.ring(e.pos.x, e.pos.y, e.pos.z, 0x35d6ff, 1.8, 0.4);
    }
    return rose;
  }

  // slowDt: timers here use slowed time with a floor, so waves keep coming
  // (slowly) even if the player refuses to move.
  update(wdt, slowDt, ctx) {
    if (this.queue.length === 0 && this.list.length === 0) {
      this.timer -= slowDt;
      if (this.timer <= 0) {
        if (this.wave > 0) this.onWaveCleared?.(this.wave);
        this.wave++;
        this.queue = this.compose(this.wave);
        this.spawnTimer = 0;
        this.timer = 2.4;
        this.onWave?.(this.wave);
      }
    } else if (this.queue.length) {
      this.spawnTimer -= slowDt;
      const maxAlive = Math.min(2 + Math.floor(this.wave / 3), 5);
      if (this.spawnTimer <= 0 && this.list.length < maxAlive) {
        this.spawnNext(ctx.player);
        this.spawnTimer = 1.8;
      }
    }

    ctx.list = this.list;
    for (const e of this.list) if (e.alive) e.update(wdt, ctx);
    for (let i = this.list.length - 1; i >= 0; i--) if (!this.list[i].alive) this.list.splice(i, 1);
  }

  // First enemy hit along a ray. `ignore` = the enemy that fired the shot.
  hitTest(p, d, len, ignore) {
    let best = null;
    for (const e of this.list) {
      if (!e.alive || e === ignore) continue;
      // cheap reject: is the enemy anywhere near this stretch of the ray?
      const ex = e.pos.x - p.x, ey = e.pos.y + 1 - p.y, ez = e.pos.z - p.z;
      const along = ex * d.x + ey * d.y + ez * d.z;
      if (along < -1.5 || along > len + 1.5) continue;
      const cx = ex - d.x * along, cy = ey - d.y * along, cz = ez - d.z * along;
      if (cx * cx + cy * cy + cz * cz > 2.6) continue;
      const h = e.hitTest(p, d, len, segmentVsSphere, segmentVsCapsuleY);
      if (h && (!best || h.t < best.t)) { best = h; best.enemy = e; }
    }
    return best;
  }
}
