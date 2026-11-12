import { CONFIG } from '../config.js';

// The interface layer. Plain HTML/CSS on top of the canvas: the game tells it
// what changed, it never reaches into the game.

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), crosshair: $('crosshair'), hit: $('hitmarker'),
      health: $('health'), ammoCount: $('ammo-count'), ammoPips: $('ammo-pips'),
      wave: $('wave'), kills: $('kills'), time: $('timebar-fill'),
      prompt: $('prompt'), banner: $('banner'), dmg: $('damage-dir'),
      start: $('screen-start'), pause: $('screen-pause'), over: $('screen-over'),
      overStats: $('over-stats'), overBest: $('over-best'),
      scope: $('scope'), weapons: $('weapons'), shout: $('shout'),
    };
    this.el.health.innerHTML = '<i></i>'.repeat(CONFIG.player.maxHealth);
    this.el.weapons.innerHTML = CONFIG.weapons
      .map((w, i) => `<span><b>${i + 1}</b>${w.name}</span>`).join('');
    this.last = {};
    this.bannerT = 0;
    this.hitT = 0;
    this.dmgT = 0;
  }

  show(screen) {
    this.el.start.classList.toggle('hidden', screen !== 'start');
    this.el.pause.classList.toggle('hidden', screen !== 'pause');
    this.el.over.classList.toggle('hidden', screen !== 'over');
    this.el.hud.classList.toggle('hidden', screen !== null && screen !== 'pause');
  }

  setHealth(n) {
    if (this.last.health === n) return;
    this.last.health = n;
    [...this.el.health.children].forEach((c, i) => c.classList.toggle('off', i >= n));
  }

  setAmmo(n, reloading) {
    const key = n + (reloading ? 'r' : '');
    if (this.last.ammo === key) return;
    this.last.ammo = key;
    this.el.ammoCount.textContent = reloading ? '··' : String(n).padStart(2, '0');
    [...this.el.ammoPips.children].forEach((c, i) => c.classList.toggle('off', i >= n));
    this.el.ammoPips.classList.toggle('reloading', reloading);
  }

  // Called when the player switches gun.
  setWeapon(index) {
    if (this.last.weapon === index) return;
    this.last.weapon = index;
    this.last.ammo = null;
    const spec = CONFIG.weapons[index];
    this.el.ammoPips.innerHTML = '<i></i>'.repeat(spec.magSize);
    this.el.ammoPips.classList.toggle('many', spec.magSize > 12);
    [...this.el.weapons.children].forEach((c, i) => c.classList.toggle('on', i === index));
  }

  // Sniper scope view.
  setScope(on) {
    if (this.last.scope === on) return;
    this.last.scope = on;
    this.el.scope.classList.toggle('show', on);
    this.el.crosshair.classList.toggle('hide', on);
  }

  setWave(wave, kills, threat = 1) {
    const key = wave + ':' + kills + ':' + threat;
    if (this.last.wave === key) return;
    this.last.wave = key;
    this.el.wave.textContent = wave ? `WAVE ${String(wave).padStart(2, '0')}` : '';
    this.el.kills.textContent = `${kills} DANCING`;
    $('threat').textContent = `ENEMY LV ${threat}`;
  }

  setPrompt(text) {
    if (this.last.prompt === text) return;
    this.last.prompt = text;
    this.el.prompt.textContent = text;
    this.el.prompt.classList.toggle('show', !!text);
  }

  banner(text) {
    this.el.banner.textContent = text;
    this.el.banner.classList.add('show');
    this.bannerT = 1.8;
  }

  // The hero's sob, as a word on screen.
  shout(text) {
    const el = this.el.shout;
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth; // restart the animation
    el.classList.add('show');
  }

  hitmarker(kill) {
    this.el.hit.className = kill ? 'show kill' : 'show';
    this.hitT = kill ? 0.3 : 0.16;
  }

  // angle: 0 = threat straight ahead, positive = clockwise
  damageFrom(angle) {
    this.el.dmg.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    this.el.dmg.classList.add('show');
    this.dmgT = 0.9;
  }

  gameOver(wave, kills, best, isBest) {
    this.el.overStats.textContent = `Wave ${wave} · ${kills} on the dance floor`;
    this.el.overBest.textContent = isBest ? 'New best' : `Best: ${best}`;
  }

  // Called every frame with real dt.
  update(dt, flow, readiness, fired) {
    this.el.time.style.transform = `scaleX(${(0.04 + flow * 0.96).toFixed(3)})`;
    const spread = fired ? 1 : 1 - readiness;
    this.el.crosshair.style.setProperty('--gap', `${(5 + spread * 9).toFixed(1)}px`);
    this.el.crosshair.classList.toggle('busy', readiness < 0.999);

    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.el.banner.classList.remove('show');
    if (this.hitT > 0 && (this.hitT -= dt) <= 0) this.el.hit.className = '';
    if (this.dmgT > 0 && (this.dmgT -= dt) <= 0) this.el.dmg.classList.remove('show');
  }
}
