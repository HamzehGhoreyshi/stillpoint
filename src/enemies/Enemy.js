import * as THREE from 'three';
import { CONFIG, PALETTE } from '../config.js';
import { radialTexture } from '../world/textures.js';

// One enemy: a faceted amber figure built from a handful of shared shapes,
// animated in code (no animation files), with a small state machine for AI.
// Everything in update() is driven by WORLD time, so the whole enemy -
// thinking, walking, aiming - freezes and flows with the player.
//
// Three behaviours:
//   rusher   - sprints at you and strikes up close
//   gunner   - keeps mid range, strafes, fires slow dodgeable shots
//   marksman - hangs back, tracks you with a visible beam, fires a fast shot

const limb = (len, r0, r1) => {
  const g = new THREE.CylinderGeometry(r0, r1, len, 4, 1);
  g.translate(0, -len / 2, 0); // pivot at the top: it hangs from its joint
  return g;
};
const GEO = {
  torso: (() => { const g = new THREE.CylinderGeometry(0.27, 0.13, 0.62, 5, 1); g.translate(0, 0.31, 0); return g; })(),
  pelvis: (() => { const g = new THREE.OctahedronGeometry(0.16, 0); g.scale(1.15, 0.7, 0.85); return g; })(),
  head: (() => { const g = new THREE.OctahedronGeometry(0.17, 0); g.scale(0.85, 1.25, 0.95); return g; })(),
  upperArm: limb(0.36, 0.07, 0.048),
  foreArm: limb(0.4, 0.055, 0.012),
  blade: (() => { const g = limb(0.66, 0.07, 0.004); g.scale(0.45, 1, 1.3); return g; })(),
  thigh: limb(0.47, 0.1, 0.062),
  shin: limb(0.5, 0.07, 0.012),
  pistol: new THREE.BoxGeometry(0.06, 0.3, 0.09),
  rifle: new THREE.BoxGeometry(0.055, 0.95, 0.08),
  shield: (() => { const g = new THREE.IcosahedronGeometry(1, 1); g.scale(0.74, 1.14, 0.74); return g; })(),
  beam: (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true); g.rotateX(Math.PI / 2); g.translate(0, 0, 0.5); return g; })(),
  glow: (() => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; })(),
};
const SHIELD_COLORS = [0x35d6ff, 0x8a6bff, 0xff4fb0]; // 1, 2, 3 points left
const GUN_MAT = new THREE.MeshStandardMaterial({ color: PALETTE.dark, roughness: 0.5, metalness: 0.4, flatShading: true });

const rand = (a, b) => a + Math.random() * (b - a);
const _dir = { x: 0, z: 0 };
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function angleLerp(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export class Enemy {
  constructor(type, scene) {
    this.type = type;
    this.cfg = CONFIG.enemies[type];
    this.scene = scene;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.aimPoint = new THREE.Vector3();
    this.alive = true;
    this.hp = this.cfg.hp;
    this.scale = this.cfg.scale;
    this.seed = Math.random() * 100;
    this.build();
  }

  build() {
    const cfg = this.cfg;
    this.baseEmissive = 0.34;
    const mat = (this.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(cfg.color).multiplyScalar(0.8), emissive: cfg.color,
      emissiveIntensity: this.baseEmissive, roughness: 0.5, metalness: 0, flatShading: true,
    }));
    this.parts = [];
    const mesh = (geo, parent, x = 0, y = 0, z = 0, m = mat) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      parent.add(o);
      this.parts.push(o);
      return o;
    };
    const joint = (parent, x, y, z) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      parent.add(g);
      return g;
    };

    const root = (this.root = new THREE.Group());
    const hips = (this.hips = joint(root, 0, 0.97, 0));
    mesh(GEO.pelvis, hips, 0, 0.02, 0);
    this.torso = joint(hips, 0, 0.04, 0);
    mesh(GEO.torso, this.torso);
    this.head = mesh(GEO.head, this.torso, 0, 0.86, 0); // floats just above the body

    // arms: shoulder joint -> upper arm -> elbow joint -> forearm
    const arm = (side) => {
      const shoulder = joint(this.torso, side * 0.31, 0.56, 0);
      mesh(GEO.upperArm, shoulder);
      const elbow = joint(shoulder, 0, -0.36, 0);
      const fore = mesh(this.type === 'rusher' ? GEO.blade : GEO.foreArm, elbow);
      return { shoulder, elbow, fore };
    };
    this.armL = arm(1);
    this.armR = arm(-1);
    if (this.type === 'gunner') mesh(GEO.pistol, this.armR.elbow, 0, -0.46, 0.03, GUN_MAT);
    if (this.type === 'marksman') mesh(GEO.rifle, this.armR.elbow, 0, -0.5, 0.04, GUN_MAT);

    const leg = (side) => {
      const hip = joint(hips, side * 0.12, 0, 0);
      mesh(GEO.thigh, hip);
      const knee = joint(hip, 0, -0.47, 0);
      mesh(GEO.shin, knee);
      return { hip, knee };
    };
    this.legL = leg(1);
    this.legR = leg(-1);

    this.scene.add(root);

    // soft pool of light on the floor: makes the figure read as a lantern
    this.glow = new THREE.Mesh(GEO.glow, new THREE.MeshBasicMaterial({
      map: radialTexture(), color: cfg.color, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.glow.scale.setScalar(3.4);
    this.glow.renderOrder = 3;
    this.scene.add(this.glow);

    // energy shield: a faceted bubble, shown only while shield points remain
    const sm = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    this.shieldFill = new THREE.Mesh(GEO.shield, new THREE.MeshBasicMaterial({ ...sm, opacity: 0.13 }));
    this.shieldWire = new THREE.Mesh(GEO.shield, new THREE.MeshBasicMaterial({ ...sm, opacity: 0.5, wireframe: true }));
    this.shieldMesh = new THREE.Group();
    this.shieldMesh.add(this.shieldFill, this.shieldWire);
    this.shieldMesh.visible = false;
    this.scene.add(this.shieldMesh);
    this.shield = 0;
    this.shieldFlash = 0;
    this.speedMul = 1;

    if (this.type === 'marksman') {
      this.beam = new THREE.Mesh(GEO.beam, new THREE.MeshBasicMaterial({
        color: new THREE.Color(PALETTE.enemyShot).multiplyScalar(2), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.beam.visible = false;
      this.scene.add(this.beam);
    }
  }

  spawn(x, z, faceX, faceZ) {
    this.pos.set(x, 0, z);
    this.yaw = Math.atan2(faceX - x, faceZ - z);
    this.state = 'spawn';
    this.t = 0;
    this.cooldown = rand(0.5, 1.4);
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = rand(1, 2.5);
    this.dodgeT = 0;
    this.dodgeCd = rand(0.3, 1.2);
    this.dodgeDir = 1;
    this.losT = 0;
    this.hasLOS = false;
    this.walkPhase = this.seed;
    this.flash = 0;
    this.aim = 0; // 0 relaxed .. 1 arm raised
    this.strike = 0;
    this.lean = 0;
    this.age = 0;
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.root.scale.setScalar(0.001);
  }

  // Shield points: each one absorbs one point of damage before the body can
  // be hurt. The bubble's colour shows how many are left.
  setShield(n) {
    this.shield = Math.max(n, 0);
    if (this.shield > 0) {
      const c = SHIELD_COLORS[Math.min(this.shield, SHIELD_COLORS.length) - 1];
      this.shieldFill.material.color.set(c);
      this.shieldWire.material.color.set(c).multiplyScalar(1.6);
    }
    this.shieldFlash = 1;
  }

  updateShield(wdt) {
    const on = this.shield > 0 && this.state !== 'spawn';
    this.shieldMesh.visible = on;
    this.shieldFlash = Math.max(this.shieldFlash - wdt * 4, 0);
    if (!on) return;
    const s = this.scale * (1 + this.shieldFlash * 0.14 + Math.sin(this.age * 3) * 0.015);
    this.shieldMesh.position.set(this.pos.x, this.pos.y + 1.02 * this.scale, this.pos.z);
    this.shieldMesh.scale.setScalar(s);
    this.shieldMesh.rotation.y = this.age * 0.7;
    this.shieldFill.material.opacity = 0.12 + this.shieldFlash * 0.4;
    this.shieldWire.material.opacity = 0.45 + this.shieldFlash * 0.5;
  }

  // World-space point the shots leave from.
  muzzle(out) {
    const s = this.scale, sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const lx = -0.31 * s, lz = 0.8 * s;
    return out.set(this.pos.x + lx * cos + lz * sin, this.pos.y + 1.5 * s, this.pos.z - lx * sin + lz * cos);
  }

  update(wdt, ctx) {
    const cfg = this.cfg, pos = this.pos, player = ctx.player;
    this.age += wdt;
    this.flash = Math.max(this.flash - wdt * 5, 0);

    if (this.state === 'spawn') {
      this.t += wdt;
      const k = Math.min(this.t / 0.7, 1);
      const e = 1 - Math.pow(1 - k, 3);
      this.root.scale.set(this.scale * (0.4 + 0.6 * e), this.scale * e, this.scale * (0.4 + 0.6 * e));
      this.material.emissiveIntensity = this.baseEmissive + (1 - k) * 3;
      this.glow.position.set(pos.x, 0.03, pos.z);
      if (k >= 1) this.state = 'move';
      return;
    }

    const dx = player.pos.x - pos.x, dz = player.pos.z - pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const nx = dx / dist, nz = dz / dist;
    const eyeY = pos.y + 1.55 * this.scale;
    const targetY = player.pos.y + 1.25;

    // line of sight, checked a few times per (world) second
    this.losT -= wdt;
    if (this.losT <= 0) {
      this.losT = 0.1;
      this.hasLOS = player.alive && ctx.collision.segmentClear(pos.x, eyeY, pos.z, player.pos.x, targetY, player.pos.z);
    }

    // reaction: sidestep when the player is aiming straight at us
    this.dodgeCd -= wdt;
    this.dodgeT -= wdt;
    if (this.type === 'gunner' && this.state === 'move' && this.dodgeCd <= 0 && dist < 26 && this.hasLOS) {
      const a = ctx.aim;
      const ex = pos.x - a.ox, ey = pos.y + 1.1 - a.oy, ez = pos.z - a.oz;
      const along = ex * a.dx + ey * a.dy + ez * a.dz;
      if (along > 0) {
        const cx = ex - a.dx * along, cy = ey - a.dy * along, cz = ez - a.dz * along;
        if (cx * cx + cy * cy + cz * cz < 0.45) {
          this.dodgeT = 0.26;
          this.dodgeCd = rand(2.6, 4.2);
          // step away from the line of fire
          this.dodgeDir = cx * -nz + cz * nx >= 0 ? 1 : -1;
          if (Math.random() < 0.25) this.dodgeDir *= -1;
        }
      }
    }

    let wantX = 0, wantZ = 0, speed = cfg.speed * this.speedMul, faceX = nx, faceZ = nz, facePlayer = this.hasLOS;
    let aimTarget = 0;

    if (this.state === 'stagger') {
      this.t -= wdt;
      speed = 0;
      if (this.t <= 0) { this.state = 'move'; this.cooldown = Math.max(this.cooldown, 0.5); }
    } else if (this.type === 'rusher') {
      if (this.state === 'windup') {
        this.t -= wdt;
        speed = 0;
        this.strike = 1 - this.t / cfg.windup;
        if (this.t <= 0) {
          if (dist < cfg.reach + 0.5 && Math.abs(player.pos.y - pos.y) < 1.7 && player.alive) ctx.onMelee(this);
          this.state = 'recover';
          this.t = cfg.recover;
          // lunge
          this.vel.x += nx * 5; this.vel.z += nz * 5;
        }
      } else if (this.state === 'recover') {
        this.t -= wdt;
        speed = 0;
        this.strike = Math.max(this.t / cfg.recover - 0.5, 0) * 2 * -1;
        if (this.t <= 0) { this.state = 'move'; this.strike = 0; }
      } else {
        if (dist < 4.5 && this.hasLOS) { wantX = nx; wantZ = nz; }
        else if (ctx.nav.direction(pos.x, pos.z, _dir)) { wantX = _dir.x; wantZ = _dir.z; }
        // weave so it is not a straight-line target
        if (dist > 4) {
          const w = Math.sin(this.age * 3.2 + this.seed) * 0.45;
          const lx = -wantZ * w, lz = wantX * w;
          wantX += lx; wantZ += lz;
        }
        facePlayer = dist < 6 && this.hasLOS;
        if (dist < cfg.reach && player.alive) { this.state = 'windup'; this.t = cfg.windup; }
      }
    } else {
      // gunner + marksman share the "find a firing position, then shoot" loop
      const [near, far] = cfg.range;
      if (this.state === 'windup') {
        this.t -= wdt;
        speed = 0;
        aimTarget = 1;
        const k = 1 - this.t / cfg.windup;
        if (this.type === 'marksman') {
          // the beam chases the player with a lag: keep moving to break it
          const follow = 1 - Math.exp(-(2.2 + k * 2.2) * wdt);
          this.aimPoint.x += (player.pos.x - this.aimPoint.x) * follow;
          this.aimPoint.y += (targetY - this.aimPoint.y) * follow;
          this.aimPoint.z += (player.pos.z - this.aimPoint.z) * follow;
          this.updateBeam(k);
        }
        if (!this.hasLOS && this.t > cfg.windup * 0.4) {
          this.state = 'move'; this.cooldown = 0.4; // lost the target: abort
        } else if (this.t <= 0) {
          this.shoot(ctx, dist);
          this.state = 'move';
          this.cooldown = rand(cfg.cooldown[0], cfg.cooldown[1]);
        }
      } else {
        this.strafeT -= wdt;
        if (this.strafeT <= 0) { this.strafeT = rand(1.2, 3); this.strafeDir *= -1; }
        if (!this.hasLOS || dist > far) {
          if (ctx.nav.direction(pos.x, pos.z, _dir)) { wantX = _dir.x; wantZ = _dir.z; }
        } else if (dist < near) {
          wantX = -nx * 0.8 - nz * this.strafeDir * 0.6;
          wantZ = -nz * 0.8 + nx * this.strafeDir * 0.6;
        } else if (this.type === 'gunner') {
          wantX = -nz * this.strafeDir; wantZ = nx * this.strafeDir;
          speed *= 0.6;
        }
        this.cooldown -= wdt;
        if (this.cooldown <= 0 && this.hasLOS && dist < 34) {
          this.state = 'windup';
          this.t = cfg.windup;
          this.aimPoint.set(player.pos.x + rand(-2.2, 2.2), targetY + rand(-0.4, 1), player.pos.z + rand(-2.2, 2.2));
        }
      }
    }
    if (this.state !== 'windup' && this.beam) this.beam.visible = false;

    if (this.dodgeT > 0 && this.state === 'move') {
      wantX = -nz * this.dodgeDir; wantZ = nx * this.dodgeDir;
      speed = cfg.speed * 1.5;
    }

    // --- move
    const wl = Math.hypot(wantX, wantZ);
    const tvx = wl > 0 ? (wantX / wl) * speed : 0;
    const tvz = wl > 0 ? (wantZ / wl) * speed : 0;
    const acc = 1 - Math.exp(-9 * wdt);
    this.vel.x += (tvx - this.vel.x) * acc;
    this.vel.z += (tvz - this.vel.z) * acc;
    pos.x += this.vel.x * wdt;
    pos.z += this.vel.z * wdt;

    // keep apart from other enemies
    for (const o of ctx.list) {
      if (o === this || !o.alive) continue;
      const ox = pos.x - o.pos.x, oz = pos.z - o.pos.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < 0.81 && d2 > 1e-6) {
        const d = Math.sqrt(d2), push = (0.9 - d) * 0.5;
        pos.x += (ox / d) * push; pos.z += (oz / d) * push;
      }
    }
    // and from the player's body
    if (dist < 0.75) { pos.x -= nx * (0.75 - dist); pos.z -= nz * (0.75 - dist); }

    ctx.collision.resolveCircle(pos, cfg.radius, pos.y + 0.5, pos.y + 1.7);
    const lim = CONFIG.arena.half - cfg.radius;
    pos.x = Math.min(Math.max(pos.x, -lim), lim);
    pos.z = Math.min(Math.max(pos.z, -lim), lim);
    const g = ctx.collision.groundHeight(pos.x, pos.z, 0.12, pos.y, 0.45);
    pos.y += (g - pos.y) * (1 - Math.exp(-14 * wdt));

    // --- face
    const sp = Math.hypot(this.vel.x, this.vel.z);
    let targetYaw = this.yaw;
    if (facePlayer || this.state === 'windup') targetYaw = Math.atan2(faceX, faceZ);
    else if (sp > 0.3) targetYaw = Math.atan2(this.vel.x, this.vel.z);
    this.yaw = angleLerp(this.yaw, targetYaw, 1 - Math.exp(-10 * wdt));

    this.animate(wdt, sp, aimTarget, dist, targetY);
  }

  updateBeam(k) {
    const m = this.muzzle(_v);
    const b = this.beam;
    b.visible = true;
    b.position.copy(m);
    b.lookAt(this.aimPoint);
    const len = m.distanceTo(this.aimPoint) + 2;
    const w = 0.012 + k * 0.014;
    b.scale.set(w, w, len);
    b.material.opacity = 0.15 + k * 0.7 * (k > 0.8 ? 0.6 + 0.4 * Math.sin(this.age * 60) : 1);
  }

  shoot(ctx, dist) {
    const cfg = this.cfg, player = ctx.player;
    const m = this.muzzle(_v);
    if (this.type === 'marksman') {
      _v2.copy(this.aimPoint);
    } else {
      // lead the target by a random fraction, plus some spread:
      // a player who keeps changing direction is hard to hit
      const lead = (dist / cfg.bulletSpeed) * rand(0.25, 1);
      const err = 0.3 + dist * 0.035;
      _v2.set(
        player.pos.x + ctx.playerVel.x * lead + rand(-err, err),
        player.pos.y + 1.25 + rand(-err, err) * 0.6,
        player.pos.z + ctx.playerVel.z * lead + rand(-err, err)
      );
    }
    _v2.sub(m).normalize();
    ctx.onEnemyShoot(this, m, _v2, cfg.bulletSpeed);
    this.flash = 0.6;
    this.lean = -0.25;
  }

  animate(wdt, sp, aimTarget, dist, targetY) {
    const s = this.scale;
    this.walkPhase += (sp * wdt * 2.7) / s;
    const ph = this.walkPhase;
    const sw = Math.min(sp / 2.6, 1);
    const k = 1 - Math.exp(-12 * wdt);
    this.aim += (aimTarget - this.aim) * k;
    this.lean += (0 - this.lean) * (1 - Math.exp(-5 * wdt));

    this.legL.hip.rotation.x = Math.sin(ph) * 0.8 * sw;
    this.legR.hip.rotation.x = -Math.sin(ph) * 0.8 * sw;
    this.legL.knee.rotation.x = Math.max(0, Math.sin(ph - 1.1)) * 1.1 * sw + 0.06;
    this.legR.knee.rotation.x = Math.max(0, Math.sin(ph - 1.1 + Math.PI)) * 1.1 * sw + 0.06;
    this.hips.position.y = 0.97 - 0.02 + Math.abs(Math.cos(ph)) * 0.05 * sw;

    const stagger = this.state === 'stagger' ? Math.min(this.t / 0.2, 1) : 0;
    const run = this.type === 'rusher' ? 0.34 : 0.12;
    this.torso.rotation.x = run * sw + this.lean - stagger * 0.5;
    this.torso.rotation.y = Math.sin(ph) * 0.12 * sw;
    this.head.position.y = 0.86 + Math.sin(this.age * 2.2 + this.seed) * 0.018;
    this.head.rotation.y = this.age * 0.6 + this.seed;

    const pitch = Math.atan2(targetY - (this.pos.y + 1.5 * s), dist);
    if (this.type === 'rusher') {
      // blades swept back while running, raised then slashed down to strike
      const st = this.strike;
      const raise = st > 0 ? st : 0;
      const slash = st < 0 ? -st : 0;
      this.armL.shoulder.rotation.x = 0.95 - raise * 3.2 - slash * 1.75 + Math.sin(ph) * 0.15 * sw;
      this.armR.shoulder.rotation.x = 0.95 - raise * 3.2 - slash * 1.75 - Math.sin(ph) * 0.15 * sw;
      this.armL.shoulder.rotation.z = 0.25;
      this.armR.shoulder.rotation.z = -0.25;
      this.armL.elbow.rotation.x = -0.2;
      this.armR.elbow.rotation.x = -0.2;
    } else {
      const a = this.aim;
      const swing = Math.sin(ph) * 0.55 * sw;
      this.armL.shoulder.rotation.x = -swing * (1 - a) + (this.type === 'marksman' ? a * (-1.2 - pitch) : 0);
      this.armL.shoulder.rotation.z = this.type === 'marksman' ? -a * 0.55 : 0.08;
      this.armL.elbow.rotation.x = -0.35 - (this.type === 'marksman' ? a * 0.5 : 0);
      this.armR.shoulder.rotation.x = swing * (1 - a) + a * (-Math.PI / 2 - pitch);
      this.armR.elbow.rotation.x = -0.35 * (1 - a);
    }

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.root.scale.setScalar(s);
    const tele = this.state === 'windup' ? 0.45 * (this.type === 'rusher' ? this.strike : this.aim) : 0;
    this.material.emissiveIntensity = this.baseEmissive + tele + this.flash * 2.2;
    this.glow.position.set(this.pos.x, this.pos.y + 0.03, this.pos.z);
    this.glow.material.opacity = 0.3 + tele * 0.2;
    this.updateShield(wdt);
  }

  // Bullet test against a head sphere and a body capsule.
  // Returns { t, head } or null.
  hitTest(p, d, len, sphereFn, capsuleFn) {
    const s = this.scale, pos = this.pos;
    if (this.shield > 0) {
      // shielded: the whole bubble is the target, and there are no headshots
      const t = capsuleFn(p, d, len, pos.x, pos.z, pos.y + 0.55 * s, pos.y + 1.5 * s, 0.7 * s);
      return t < 0 ? null : { t, head: false };
    }
    const head = sphereFn(p, d, len, pos.x, pos.y + 1.83 * s, pos.z, 0.26 * s);
    const body = capsuleFn(p, d, len, pos.x, pos.z, pos.y + 0.3 * s, pos.y + 1.42 * s, 0.37 * s);
    if (head < 0 && body < 0) return null;
    if (head >= 0 && (body < 0 || head <= body)) return { t: head, head: true };
    return { t: body, head: false };
  }

  // Returns what happened: 'kill', 'hit' (hurt but alive), 'shield'
  // (absorbed), 'break' (the shield just shattered) or 'none'.
  damage(amount, hitPoint, dir, headshot, effects) {
    if (!this.alive) return 'none';
    if (this.shield > 0) {
      const c = SHIELD_COLORS[Math.min(this.shield, SHIELD_COLORS.length) - 1];
      const left = this.shield - amount;
      effects.flash(hitPoint.x, hitPoint.y, hitPoint.z, c, 0.2, 1.2, 0.12, 2.2);
      if (left > 0) {
        this.setShield(left);
        effects.burst(hitPoint.x, hitPoint.y, hitPoint.z, -dir.x, 0.3, -dir.z, 8, c, { speed: 4, spread: 0.8, size: 0.04, life: 0.7 });
        return 'shield';
      }
      // shattered
      this.setShield(0);
      const cy = this.pos.y + 1.02 * this.scale;
      effects.burst(this.pos.x, cy, this.pos.z, 0, 0.3, 0, 30, c, { speed: 6.5, spread: 1, size: 0.06, life: 1.1 });
      effects.ring(this.pos.x, this.pos.y, this.pos.z, c, 2.2, 0.4);
      if (left === 0) return 'break';
      amount = -left; // a heavy round carries on into the body
      headshot = false;
    }
    this.hp -= headshot ? 99 : amount;
    this.flash = 1;
    if (this.hp <= 0) {
      this.die(hitPoint, dir, effects);
      return 'kill';
    }
    // survived: flinch, get knocked back, lose the shot being lined up
    this.state = 'stagger';
    this.t = 0.5;
    this.vel.x += dir.x * 5; this.vel.z += dir.z * 5;
    if (this.beam) this.beam.visible = false;
    effects.burst(hitPoint.x, hitPoint.y, hitPoint.z, dir.x, dir.y, dir.z, 12, this.cfg.color, { speed: 5, spread: 0.7, size: 0.05 });
    effects.flash(hitPoint.x, hitPoint.y, hitPoint.z, this.cfg.color, 0.2, 1.1, 0.14);
    return 'hit';
  }

  // The figure comes apart: every body part becomes a tumbling ember.
  die(hitPoint, dir, effects) {
    this.alive = false;
    const color = this.cfg.color;
    const parts = [];
    this.root.updateMatrixWorld(true);
    for (const p of this.parts) {
      if (p.material !== this.material) continue; // guns just vanish
      this.scene.attach(p); // keeps its place in the world, leaves the skeleton
      const ox = p.position.x - hitPoint.x, oy = p.position.y - hitPoint.y, oz = p.position.z - hitPoint.z;
      const ol = Math.hypot(ox, oy, oz) || 1;
      const out = 2.4 / (0.5 + ol);
      p.userData = {
        vx: dir.x * rand(2.5, 6.5) + (ox / ol) * out + rand(-1, 1),
        vy: dir.y * 3 + (oy / ol) * out + rand(1.5, 4.2),
        vz: dir.z * rand(2.5, 6.5) + (oz / ol) * out + rand(-1, 1),
        sx: rand(-9, 9), sy: rand(-9, 9), sz: rand(-9, 9),
        rest: 0.06, scale: p.scale.x,
      };
      parts.push(p);
    }
    effects.addDebris(parts, this.material);
    effects.burst(hitPoint.x, hitPoint.y, hitPoint.z, dir.x, dir.y * 0.5, dir.z, 34, color, { speed: 8, spread: 0.75, size: 0.055, life: 1.5 });
    effects.burst(this.pos.x, this.pos.y + 1, this.pos.z, 0, 0.6, 0, 16, 0xfff1c9, { speed: 4, spread: 1, size: 0.03, life: 0.9, bright: 2.4 });
    effects.flash(hitPoint.x, hitPoint.y, hitPoint.z, color, 0.4, 2.6, 0.2, 2.4);
    effects.ring(this.pos.x, this.pos.y, this.pos.z, color);
    this.dispose();
  }

  dispose() {
    this.scene.remove(this.root);
    this.scene.remove(this.glow);
    this.scene.remove(this.shieldMesh);
    this.shieldFill.material.dispose();
    this.shieldWire.material.dispose();
    this.glow.material.dispose();
    if (this.beam) { this.scene.remove(this.beam); this.beam.material.dispose(); }
  }
}
