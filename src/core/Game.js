import * as THREE from 'three';
import { CONFIG, PALETTE, QUALITY, QUALITY_ORDER, pickQuality } from '../config.js';
import { Input } from './Input.js';
import { TimeSystem } from './TimeSystem.js';
import { AudioSystem } from './AudioSystem.js';
import { Renderer } from '../render/Renderer.js';
import { Arena } from '../world/Arena.js';
import { NavGrid } from '../world/NavGrid.js';
import { Party } from '../world/Party.js';
import { PlayerController } from '../player/PlayerController.js';
import { CameraController } from '../player/CameraController.js';
import { PlayerAvatar } from '../player/PlayerAvatar.js';
import { TouchControls, wantsTouchControls } from '../ui/TouchControls.js';
import { Weapon } from '../weapons/Weapon.js';
import { ProjectileSystem } from '../weapons/ProjectileSystem.js';
import { EnemyManager } from '../enemies/EnemyManager.js';
import { DanceCrew } from '../party/Dancers.js';
import { Effects } from '../fx/Effects.js';
import { HUD } from '../ui/HUD.js';

// Game state management. This class owns every system and runs the frame:
//
//   input -> player (real time) -> TimeSystem decides world speed
//         -> enemies, bullets, effects advance by that scaled time -> render
//
// The party (music, lights, dancers) sits outside that: it always runs on
// real time, to the beat.
//
// States: menu -> playing <-> paused -> dead -> playing ...

const _fwd = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _eye = new THREE.Vector3();
const SOBS = ['WAAAH!', 'SNIFF...', 'BOO-HOO!', 'WHY?!', 'SO SORRY!', 'WAAAAH!'];

export class Game {
  constructor(canvas) {
    this.state = 'menu';
    this.tier = pickQuality();
    this.renderer = new Renderer(canvas, this.tier);
    this.scene = this.renderer.scene;
    this.input = new Input(canvas);
    this.time = new TimeSystem();
    this.audio = new AudioSystem();
    this.arena = new Arena(this.scene);
    this.nav = new NavGrid(this.arena.collision, CONFIG.arena.half);
    this.party = new Party(this.scene, this.arena);
    this.player = new PlayerController(this.arena.collision);
    this.cam = new CameraController(this.renderer.camera);
    this.avatar = new PlayerAvatar(this.scene);
    // first-person unless the player has chosen third-person (V switches)
    this.thirdPerson = localStorage.getItem('stillpoint.viewMode') === 'third';
    this.cryCooldown = 0;
    this.tearT = 0;
    this.avatarVisible = false;
    this.effects = new Effects(this.scene);
    this.projectiles = new ProjectileSystem(this.scene);
    this.enemies = new EnemyManager(this.scene, this.arena.spawnPoints);
    this.dancers = new DanceCrew(this.scene, this.arena.collision);
    this.hud = new HUD();

    // the three guns; only the one in hand is visible
    this.weapons = CONFIG.weapons.map((spec) => new Weapon(this.renderer.weaponScene, spec));
    this.weaponIndex = 0;
    this.pendingWeapon = -1;
    this.weapons[0].root.visible = true;
    for (const w of this.weapons) {
      w.onEvent = (name) => {
        if (name === 'magOut') this.audio.click(0.8);
        else if (name === 'magIn') this.audio.click(1.1);
        else if (name === 'rack') { this.audio.click(1.5); this.audio.click(0.7); }
      };
    }

    this.kills = 0;
    this.best = Number(localStorage.getItem('stillpoint.best') || 0);
    this.invuln = 0;
    this.damageFx = 0;
    this.pulseFx = 0;
    this.fireBuffer = 0;
    this.firedThisFrame = false;
    this.deadT = 0;
    this.menuT = 0;

    // Shared context handed to enemies and bullets each frame.
    this.ctx = {
      player: this.player,
      playerVel: this.player.vel,
      collision: this.arena.collision,
      nav: this.nav,
      enemies: this.enemies,
      list: this.enemies.list,
      aim: { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: -1 },
      onMelee: (e) => this.hurtPlayer(1, e.pos),
      onEnemyShoot: (e, origin, dir, speed) => {
        this.projectiles.spawn(origin, dir, speed, e);
        this.effects.flash(origin.x, origin.y, origin.z, PALETTE.enemyShot, 0.2, 1.3, 0.1, 2.4);
        this.audio.enemyShoot(origin.distanceTo(this.player.pos));
      },
      onWorldHit: (b, p, n) => {
        this.effects.impact(p.x, p.y, p.z, n.nx, n.ny, n.nz, b.owner === 'player' ? PALETTE.playerShot : PALETTE.enemyShot);
        if (p.distanceTo(this.player.pos) < 22) this.audio.impact();
      },
      onEnemyHit: (b, hit, p) => {
        const e = hit.enemy;
        const result = e.damage(b.damage, p, b.dir, hit.head, this.effects);
        if (result === 'shield' || result === 'break') {
          this.audio.shieldHit(result === 'break');
          if (b.owner === 'player') this.hud.hitmarker(false);
        } else if (result === 'kill') {
          this.audio.kill();
          // every kill invites one more dancer onto that spot
          this.dancers.add(e.pos.x, e.pos.z, this.player.pos.x, this.player.pos.z);
          if (b.owner === 'player') {
            this.kills++;
            // the survivors learn from it: shields now, a higher level later
            if (this.enemies.onPlayerKill(this.kills, this.effects)) {
              this.hud.banner(`ENEMIES LEVEL ${this.enemies.threat}`);
            }
            this.mourn();
            this.hud.hitmarker(true);
            this.pulseFx = Math.max(this.pulseFx, 0.6);
          }
        } else {
          this.audio.enemyHit();
          if (b.owner === 'player') this.hud.hitmarker(false);
        }
      },
      onPlayerHit: (b, p) => {
        _aim.copy(p).addScaledVector(b.dir, -6);
        this.hurtPlayer(1, _aim);
      },
      onNearMiss: () => {
        this.audio.whoosh();
        this.cam.shake(0.18);
      },
    };

    this.enemies.onWave = (n) => {
      this.hud.banner(`WAVE ${String(n).padStart(2, '0')}`);
      this.audio.wave();
    };
    this.enemies.onWaveCleared = () => {
      // a cleared wave gives one health back
      if (this.player.alive) this.player.health = Math.min(this.player.health + 1, CONFIG.player.maxHealth);
    };
    this.enemies.onSpawn = (e) => {
      this.effects.ring(e.pos.x, 0, e.pos.z, e.cfg.color, 2, 0.6);
      this.audio.spawn();
    };
    this.dancers.onArrive = (x, y, z, color) => {
      this.effects.confetti(x, y + 1.3, z);
      this.effects.ring(x, y, z, color, 2.6, 0.5);
      this.effects.flash(x, y + 1, z, color, 0.4, 2.4, 0.22, 1.6);
      this.audio.cheer();
    };
    const dj = this.arena.stage.dj;
    this.dancers.addResident(dj.x, dj.z, 0, 0);

    // --- flow between states
    this.input.onLockChange = (locked) => {
      if (locked) {
        if (this.state === 'menu' || this.state === 'dead') this.begin();
        else if (this.state === 'paused') this.setState('playing');
      } else if (this.state === 'playing') {
        this.setState('paused');
      }
    };
    const go = () => { this.audio.init(); this.input.lock(); };
    document.getElementById('btn-start').addEventListener('click', go);
    document.getElementById('btn-resume').addEventListener('click', go);
    document.getElementById('btn-restart').addEventListener('click', go);
    addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && this.state === 'dead' && this.deadT > 0.9) go();
      if (e.code === 'KeyM') this.audio.toggleMusic();
      if (e.code === 'KeyV') this.toggleView();
      if (e.code === 'KeyQ') this.cycleQuality();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.input.unlock();
    });

    // on-screen controls for phones and narrow windows
    this.touch = new TouchControls(
      this.input,
      () => { if (this.state === 'playing') this.setState('paused'); },
      () => this.toggleView()
    );
    document.getElementById('view-toggle').addEventListener('click', (e) => { e.stopPropagation(); this.toggleView(); });
    this.showView();
    this.fitScreen();
    addEventListener('resize', () => this.fitScreen());

    this.applyQuality();
    this.perfT = 0;
    this.perfN = 0;
    this.perfHold = 1;

    this.hud.show('start');
    this.hud.setWeapon(0);
  }

  // Tells every system which graphics tier is in force.
  applyQuality() {
    const q = QUALITY[this.tier];
    this.party.setQuality(q);
    this.dancers.max = q.dancers;
    document.getElementById('hint-quality').textContent = `Graphics: ${this.tier}`;
    this.effects.muzzleLight.visible = q.partyLights;
  }

  // Q: change graphics quality by hand (high -> medium -> low -> high).
  cycleQuality() {
    this.tier = QUALITY_ORDER[(QUALITY_ORDER.indexOf(this.tier) + 1) % QUALITY_ORDER.length];
    this.renderer.resScale = 1;
    this.renderer.setQuality(this.tier);
    this.applyQuality();
    this.perfHold = 1;
    this.hud.banner(`GRAPHICS: ${this.tier.toUpperCase()}`);
  }

  // Keeps the game smooth. Every 1.5 s of play it looks at the real frame
  // rate; if that is under 50 fps it drops one graphics tier, and once on the
  // lowest tier it starts lowering the resolution instead. It only ever steps
  // down by itself, so the picture never flickers between settings.
  watchPerformance(dt) {
    if (this.state !== 'playing' || dt > 0.25 || document.hidden) { this.perfT = 0; this.perfN = 0; return; }
    this.perfT += dt;
    this.perfN++;
    if (this.perfT < 1.5) return;
    const fps = this.perfN / this.perfT;
    this.perfT = 0;
    this.perfN = 0;
    if (this.perfHold-- > 0 || fps >= 50) return; // skip the first window after any change
    this.perfHold = 1;
    const i = QUALITY_ORDER.indexOf(this.tier);
    if (i < QUALITY_ORDER.length - 1) {
      this.tier = QUALITY_ORDER[i + 1];
      this.renderer.setQuality(this.tier);
      this.applyQuality();
    } else if (this.renderer.resScale > 0.6) {
      this.renderer.resScale -= 0.15;
      this.renderer.resize();
    }
  }

  // Picks touch or mouse controls, and a wider view for tall screens.
  fitScreen() {
    const touch = wantsTouchControls();
    this.input.touchMode = touch;
    document.body.classList.toggle('touch', touch);
    const aspect = innerWidth / innerHeight;
    this.cam.baseFov = aspect < 0.8 ? 94 : aspect < 1.2 ? 84 : 76;
  }

  // Third-person (see the hero) or first-person (see through his eyes).
  toggleView() {
    this.thirdPerson = !this.thirdPerson;
    localStorage.setItem('stillpoint.viewMode', this.thirdPerson ? 'third' : 'first');
    this.showView();
  }

  showView() {
    const name = this.thirdPerson ? 'Third person' : 'First person';
    document.getElementById('view-toggle').textContent = `View: ${name}`;
    const hint = document.getElementById('hint-view');
    hint.textContent = name;
    hint.parentElement.classList.remove('flash');
    void hint.offsetWidth; // restart the highlight
    hint.parentElement.classList.add('flash');
  }

  // After a kill the hero sits down and cries (sound, tears, a word on
  // screen). It is only a costume: you can move or shoot straight away,
  // and doing so gets him back on his feet.
  mourn() {
    if (this.cryCooldown > 0) return;
    this.cryCooldown = 1.6;
    this.avatar.cry();
    this.audio.sob();
    this.hud.shout(SOBS[Math.floor(Math.random() * SOBS.length)]);
  }

  get weapon() {
    return this.weapons[this.weaponIndex];
  }

  setState(s) {
    this.state = s;
    document.body.classList.toggle('playing', s === 'playing');
    this.hud.show(s === 'menu' ? 'start' : s === 'paused' ? 'pause' : null);
  }

  // Start (or restart) a run.
  begin() {
    this.player.reset();
    this.cam.reset();
    this.time.reset();
    this.weapons.forEach((w, i) => { w.reset(); w.root.visible = i === 0; });
    this.weaponIndex = 0;
    this.pendingWeapon = -1;
    this.enemies.reset();
    this.projectiles.clear();
    this.effects.clear();
    this.dancers.clear();
    this.nav.lastCell = -1;
    this.kills = 0;
    this.invuln = 0;
    this.damageFx = 0;
    this.deadT = 0;
    this.fireBuffer = 0;
    this.input.fireJust = false; // the click that started the run is not a shot
    this.input.fireHeld = false;
    this.hud.setPrompt('');
    this.hud.setWeapon(0);
    this.hud.setScope(false);
    this.setState('playing');
  }

  start() {
    let last = performance.now();
    const frame = (now) => {
      const real = (now - last) / 1000;
      const dt = Math.min(real, 0.05);
      last = now;
      this.watchPerformance(real);
      this.tick(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  tick(dt) {
    if (this.state !== 'paused') {
      const beat = this.audio.beat;
      this.party.update(dt, beat);
      this.dancers.update(dt, beat);
    }
    if (this.state === 'menu') this.updateMenu(dt);
    else if (this.state === 'playing') this.updatePlaying(dt);
    else if (this.state === 'dead') this.updateDead(dt);
    if (this.state !== 'paused') this.renderer.render();
    this.input.endFrame();
  }

  // Title screen: a slow orbit around the arena.
  updateMenu(dt) {
    this.menuT += dt;
    const a = this.menuT * 0.07 + 0.6;
    const cam = this.renderer.camera;
    cam.position.set(Math.sin(a) * 19, 4.2 + Math.sin(this.menuT * 0.2) * 0.6, Math.cos(a) * 19);
    cam.lookAt(0, 2.2, 0);
    this.weapon.update(dt, dt, this.weaponState(false, false));
    this.poseAvatar(dt, true);
    this.renderer.weaponPass.enabled = false;
    this.renderer.setGrade(0.6, 0, 0);
    this.audio.setFlow(0.25, false);
  }

  // Dresses the hero for this frame and decides which gun you see:
  // the one in his hand (third-person) or the close-up one (first-person).
  poseAvatar(dt, visible) {
    const p = this.player, w = this.weapon;
    this.avatarVisible = visible;
    this.avatar.update(dt, {
      pos: p.pos, viewY: p.viewY, yaw: this.cam.yaw, pitch: this.cam.pitch,
      groundSpeed: p.groundSpeed, speedFactor: p.speedFactor, onGround: p.onGround,
      weaponIndex: this.weaponIndex, twoHanded: w.spec.id !== 'pistol',
      kick: w.kickR * 4, reload: w.reloading ? Math.sin(Math.min(w.reloadT, 1) * Math.PI) : w.lower,
      alive: p.alive, visible,
    });
    this.renderer.weaponPass.enabled = !visible;
  }

  weaponState(raised, aiming) {
    return {
      lookDX: this.input.look.x, lookDY: this.input.look.y,
      speedFactor: this.player.speedFactor, onGround: this.player.onGround,
      bobPhase: this.cam.bobPhase, aspect: this.renderer.camera.aspect, raised, aiming,
    };
  }

  // Number keys or the mouse wheel. The gun in hand drops, the next one rises.
  handleWeaponSwitch() {
    const input = this.input;
    let want = -1;
    for (let i = 0; i < this.weapons.length; i++) if (input.justPressed.has(`Digit${i + 1}`)) want = i;
    if (input.wheel !== 0) {
      const from = this.pendingWeapon >= 0 ? this.pendingWeapon : this.weaponIndex;
      want = (from + (input.wheel > 0 ? 1 : -1) + this.weapons.length) % this.weapons.length;
    }
    if (want >= 0 && want !== this.weaponIndex) {
      this.pendingWeapon = want;
      this.weapon.cancelReload();
      this.fireBuffer = 0;
    } else if (want === this.weaponIndex) {
      this.pendingWeapon = -1;
    }
    if (this.pendingWeapon >= 0 && this.weapon.lower > 0.9) {
      this.weapon.root.visible = false;
      this.weaponIndex = this.pendingWeapon;
      this.pendingWeapon = -1;
      this.weapon.lower = 1;
      this.weapon.root.visible = true;
      this.hud.setWeapon(this.weaponIndex);
      this.audio.click(1.3);
    }
  }

  updatePlaying(dt) {
    const { input, player, cam, time, audio } = this;

    this.handleWeaponSwitch();
    const weapon = this.weapon;
    const spec = weapon.spec;

    // 1. the player acts in real time (the mouse slows down when zoomed in)
    const zoomRatio = Math.tan((spec.zoomFov * Math.PI) / 360) / Math.tan((cam.baseFov * Math.PI) / 360);
    cam.look(input.look.x, input.look.y, dt, 1 + (zoomRatio - 1) * weapon.aim);
    player.update(dt, input, cam.yaw);
    if (player.justLanded) { cam.land(player.landImpact); weapon.land(player.landImpact); audio.land(player.landImpact); }
    if (player.justJumped) audio.jump();

    // 2. that activity sets the speed of the world
    time.update(dt, {
      move: player.speedFactor,
      look: cam.lookSpeed,
      airborne: !player.onGround,
      busy: weapon.reloading,
    });
    const wdt = time.worldDt;
    const slowDt = dt * Math.max(time.scale, CONFIG.time.actionFloor);
    cam.update(dt, player, time.flow, {
      zoomFov: spec.zoomFov, aim: weapon.aim, third: this.thirdPerson, scope: !!spec.scope, collision: this.arena.collision,
    });
    this.poseAvatar(dt, cam.camDist > 1.0);

    // 3. weapon
    const switching = this.pendingWeapon >= 0;
    if (input.justPressed.has('KeyR') && !switching && weapon.startReload()) this.fireBuffer = 0;
    if (input.fireJust) this.fireBuffer = 0.25;
    weapon.update(dt, slowDt, this.weaponState(!switching, input.aimHeld));
    const scoped = !!spec.scope && weapon.aim > 0.8;
    weapon.root.visible = !scoped;
    this.hud.setScope(scoped);

    this.firedThisFrame = false;
    const wantFire = spec.auto ? input.fireHeld : this.fireBuffer > 0;
    this.fireBuffer -= dt;
    if (wantFire && !switching) {
      if (weapon.canFire) {
        this.fire();
        this.fireBuffer = 0;
      } else if (weapon.ammo === 0 && !weapon.reloading) {
        audio.dry();
        weapon.startReload();
        this.fireBuffer = 0;
      }
    }

    // 4. the world advances by scaled time
    const camera = this.renderer.camera;
    camera.getWorldDirection(_fwd);
    const a = this.ctx.aim;
    a.ox = camera.position.x; a.oy = camera.position.y; a.oz = camera.position.z;
    a.dx = _fwd.x; a.dy = _fwd.y; a.dz = _fwd.z;

    this.nav.update(dt, player.pos.x, player.pos.z);
    this.enemies.update(wdt, slowDt, this.ctx);
    this.projectiles.update(wdt, this.ctx);
    this.effects.update(wdt, dt);

    // 5. feedback
    this.invuln -= dt;
    this.cryCooldown -= dt;
    // getting up: any real movement, a jump or a shot ends the crying
    if (player.speedFactor > 0.2 || !player.onGround || this.firedThisFrame) this.avatar.cancelCry();
    if (this.avatar.crying && this.avatarVisible) {
      this.tearT -= dt;
      if (this.tearT <= 0) {
        this.tearT = 0.09;
        const f = this.avatar.getFace(_eye);
        this.effects.burst(f.x, f.y + 0.2, f.z, 0, 0.2, 0, 2, 0x6fd0ff, { speed: 1.6, spread: 1, size: 0.035, life: 0.9, up: 0.7, grav: 9, bright: 1.6 });
      }
    }
    this.damageFx = Math.max(this.damageFx - dt * 1.6, 0);
    this.pulseFx = Math.max(this.pulseFx - dt * 4, 0);
    this.renderer.setGrade(time.flow, this.damageFx, this.pulseFx);
    audio.setFlow(time.flow, true);

    const hud = this.hud;
    hud.setHealth(player.health);
    hud.setAmmo(weapon.ammo, weapon.reloading);
    hud.setWave(this.enemies.wave, this.kills, this.enemies.threat);
    hud.setPrompt(weapon.reloading ? 'RELOADING' : weapon.ammo === 0 ? 'R  RELOAD' : '');
    hud.update(dt, time.flow, weapon.readiness, this.firedThisFrame);
    this.touch.sync(spec.name, input.aimHeld);
  }

  fire() {
    const camera = this.renderer.camera;
    const col = this.arena.collision;
    const weapon = this.weapon;
    const spec = weapon.spec;
    camera.getWorldDirection(_fwd);

    // Where is the crosshair actually pointing? The bullet leaves the gun
    // but must land on that exact spot. In third-person the search starts
    // level with the hero, so nothing behind him can be picked.
    const third = this.avatarVisible;
    const o = _eye.copy(camera.position);
    if (third) o.addScaledVector(_fwd, this.cam.camDist);
    let dist = col.raycast(o.x, o.y, o.z, _fwd.x, _fwd.y, _fwd.z, 200);
    if (dist === Infinity) dist = 200;
    const eh = this.enemies.hitTest(o, _fwd, dist, null);
    if (eh) dist = eh.t + 0.15;
    _aim.copy(o).addScaledVector(_fwd, Math.max(dist, 3));

    const scoped = !!spec.scope && weapon.aim > 0.8;
    const p = this.player.pos;
    if (third) {
      // the shot leaves the gun in the hero's hand
      this.avatar.getMuzzle(this.weaponIndex, _muzzle);
      if (!col.segmentClear(p.x, p.y + 1.4, p.z, _muzzle.x, _muzzle.y, _muzzle.z)) _muzzle.set(p.x, p.y + 1.4, p.z);
      this.effects.flash(_muzzle.x, _muzzle.y, _muzzle.z, PALETTE.playerShot, 0.25, 1.1, 0.07, 2.6);
    } else {
      // first-person: from the eye when scoped, otherwise low and to the right
      if (scoped) _muzzle.copy(o).addScaledVector(_fwd, 0.4);
      else _muzzle.set(0.17 * (1 - weapon.aim * 0.8), -0.13, -0.7).applyMatrix4(camera.matrixWorld);
      if (!col.segmentClear(o.x, o.y, o.z, _muzzle.x, _muzzle.y, _muzzle.z)) _muzzle.copy(o);
    }
    _dir.copy(_aim).sub(_muzzle).normalize();

    // spread: automatic fire wanders, and a sniper fired from the hip is wild
    const spread = weapon.spread + (spec.scope && !scoped ? 0.035 : 0);
    if (spread > 0) {
      _right.crossVectors(_dir, camera.up).normalize();
      _up.crossVectors(_right, _dir);
      const ang = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      _dir.addScaledVector(_right, Math.cos(ang) * r).addScaledVector(_up, Math.sin(ang) * r).normalize();
    }

    weapon.fire();
    this.projectiles.spawn(_muzzle, _dir, spec.bulletSpeed, 'player', {
      damage: spec.damage, pierce: spec.pierce, heavy: spec.id === 'sniper',
    });
    this.time.addPulse(spec.pulse, CONFIG.time.shotPulseDur);
    this.cam.fireKick(spec.kick);
    this.effects.muzzle(_muzzle.x, _muzzle.y, _muzzle.z);
    if (spec.id === 'rifle') this.audio.rifleShot();
    else if (spec.id === 'sniper') this.audio.sniperShot();
    else this.audio.shoot();
    this.pulseFx = Math.min(spec.kick, 1);
    this.firedThisFrame = true;
  }

  hurtPlayer(amount, from) {
    const p = this.player;
    if (!p.alive || this.invuln > 0) return;
    p.health -= amount;
    this.invuln = CONFIG.player.hurtInvuln;
    this.damageFx = 1;
    this.cam.shake(0.75);
    this.audio.hurt();

    // which way did it come from, relative to where we look?
    const vx = from.x - p.pos.x, vz = from.z - p.pos.z;
    const sin = Math.sin(this.cam.yaw), cos = Math.cos(this.cam.yaw);
    const fwd = vx * -sin + vz * -cos;
    const right = vx * cos + vz * -sin;
    this.hud.damageFrom(Math.atan2(right, fwd));
    this.hud.setHealth(Math.max(p.health, 0));

    if (p.health <= 0) this.die();
  }

  die() {
    this.player.alive = false;
    this.deadT = 0;
    this.state = 'dead';
    this.time.override = 0.12;
    this.audio.death();
    this.hud.setScope(false);
    this.weapon.root.visible = true;
    document.body.classList.remove('playing');
    const isBest = this.kills > this.best;
    if (isBest) {
      this.best = this.kills;
      localStorage.setItem('stillpoint.best', String(this.best));
    }
    this.hud.gameOver(this.enemies.wave, this.kills, this.best, isBest);
    this.hud.setPrompt('');
  }

  // After death the world keeps drifting in slow motion behind the screen.
  updateDead(dt) {
    this.deadT += dt;
    this.time.update(dt, { move: 0, look: 0, airborne: false, busy: false });
    const wdt = this.time.worldDt;
    this.cam.update(dt, this.player, 0, {
      zoomFov: this.cam.baseFov, aim: 0, third: this.thirdPerson, scope: false, collision: this.arena.collision,
    });
    this.weapon.update(dt, dt, this.weaponState(false, false));
    this.poseAvatar(dt, this.cam.camDist > 1.0);
    this.enemies.update(wdt, 0, this.ctx);
    this.projectiles.update(wdt, this.ctx);
    this.effects.update(wdt, dt);
    this.damageFx = Math.max(this.damageFx - dt * 0.5, 0.25);
    this.renderer.setGrade(0, this.damageFx, 0);
    this.audio.setFlow(0, false);
    this.hud.update(dt, 0, 1, false);
    if (this.deadT > 0.9 && this.hud.el.over.classList.contains('hidden')) {
      this.hud.show('over');
      this.input.unlock();
    }
  }
}
