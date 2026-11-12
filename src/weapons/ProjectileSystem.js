import * as THREE from 'three';
import { PALETTE } from '../config.js';

// Every bullet in the game, the player's and the enemies'.
// Bullets are real travelling objects (not instant hits) and they move on
// WORLD time: stand still and they hang in the air with their trails.
// Each step tests the short line a bullet just covered against walls,
// enemies and the player, and reports the first thing it touched.

const MAX = 72;

function trailMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: /* glsl */ `
      varying float vK;
      void main() { vK = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying float vK;
      void main() { gl_FragColor = vec4(uColor * (0.25 + vK * 1.3), vK * vK * 0.85); }`,
  });
}

export class ProjectileSystem {
  constructor(scene) {
    this.scene = scene;
    // head: a stretched diamond pointing along +Z
    const headGeo = new THREE.OctahedronGeometry(1, 0);
    headGeo.scale(0.045, 0.045, 0.22);
    // trail: a cone from the head (z = 0) tapering back to z = -1
    const trailGeo = new THREE.CylinderGeometry(1, 0, 1, 6, 1, true);
    trailGeo.rotateX(Math.PI / 2);
    trailGeo.translate(0, 0, -0.5);

    this.mats = {
      player: {
        head: new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.playerShot).multiplyScalar(3) }),
        trail: trailMaterial(PALETTE.playerShot),
      },
      enemy: {
        head: new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.enemyShot).multiplyScalar(3.2) }),
        trail: trailMaterial(PALETTE.enemyShot),
      },
    };

    this.pool = [];
    for (let i = 0; i < MAX; i++) {
      const group = new THREE.Group();
      const head = new THREE.Mesh(headGeo, this.mats.player.head);
      const trail = new THREE.Mesh(trailGeo, this.mats.player.trail);
      group.add(head, trail);
      group.visible = false;
      scene.add(group);
      this.pool.push({
        alive: false, group, head, trail,
        pos: new THREE.Vector3(), dir: new THREE.Vector3(),
        speed: 0, owner: null, travel: 0, trailLen: 6, width: 0.03, whooshed: false,
        damage: 1, pierce: false, lastHit: null,
      });
    }
    this._hit = { nx: 0, ny: 0, nz: 0 };
    this._look = new THREE.Vector3();
  }

  // owner: 'player' or the Enemy that fired. opt: { damage, pierce, heavy }
  spawn(origin, dir, speed, owner, opt = {}) {
    const b = this.pool.find((p) => !p.alive);
    if (!b) return null;
    const mine = owner === 'player';
    b.alive = true;
    b.pos.copy(origin);
    b.dir.copy(dir).normalize();
    b.speed = speed;
    b.owner = owner;
    b.travel = 0;
    b.whooshed = false;
    b.damage = opt.damage ?? 1;
    b.pierce = !!opt.pierce;
    b.lastHit = null;
    b.trailLen = opt.heavy ? 26 : mine ? 9 : 5.5;
    b.width = opt.heavy ? 0.03 : mine ? 0.016 : 0.024;
    const m = mine ? this.mats.player : this.mats.enemy;
    b.head.material = m.head;
    b.trail.material = m.trail;
    b.head.scale.setScalar(opt.heavy ? 1.5 : mine ? 0.8 : 1.25);
    b.group.position.copy(b.pos);
    b.group.lookAt(this._look.copy(b.pos).add(b.dir));
    b.trail.scale.set(b.width, b.width, 0.001);
    b.group.visible = true;
    return b;
  }

  // ctx: { collision, enemies, player, onWorldHit, onEnemyHit, onPlayerHit, onNearMiss }
  update(wdt, ctx) {
    const hit = this._hit;
    const player = ctx.player;
    for (const b of this.pool) {
      if (!b.alive) continue;
      const step = b.speed * wdt;
      if (step <= 0) continue;
      const p = b.pos, d = b.dir;

      // 1. walls / floor
      let t = ctx.collision.raycast(p.x, p.y, p.z, d.x, d.y, d.z, step, hit);
      let kind = t < Infinity ? 'world' : null;
      let limit = t < Infinity ? t : step;

      // 2. enemies (also hit by each other's stray shots)
      const eh = ctx.enemies.hitTest(p, d, limit, b.owner === 'player' ? b.lastHit : b.owner);
      if (eh) { kind = 'enemy'; limit = eh.t; }

      // 3. the player
      if (b.owner !== 'player' && player.alive) {
        const pt = segmentVsCapsuleY(p, d, limit, player.pos.x, player.pos.z, player.pos.y + 0.25, player.pos.y + 1.6, 0.34);
        if (pt >= 0) { kind = 'player'; limit = pt; }
        else if (!b.whooshed) {
          // near miss: bullet passes close to the head
          const ex = player.pos.x - p.x, ey = player.pos.y + 1.6 - p.y, ez = player.pos.z - p.z;
          const along = ex * d.x + ey * d.y + ez * d.z;
          if (along > 0 && along < step) {
            const cx = ex - d.x * along, cy = ey - d.y * along, cz = ez - d.z * along;
            if (cx * cx + cy * cy + cz * cz < 1.4) { b.whooshed = true; ctx.onNearMiss?.(); }
          }
        }
      }

      p.x += d.x * limit; p.y += d.y * limit; p.z += d.z * limit;
      b.travel += limit;

      if (kind === 'world') ctx.onWorldHit(b, p, hit);
      else if (kind === 'enemy') ctx.onEnemyHit(b, eh, p);
      else if (kind === 'player') ctx.onPlayerHit(b, p);

      // a piercing round keeps flying through whatever it hit
      if (kind === 'enemy' && b.pierce) { b.lastHit = eh.enemy; kind = null; }

      if (kind || b.travel > 140) {
        b.alive = false;
        b.group.visible = false;
        continue;
      }
      b.group.position.copy(p);
      b.trail.scale.set(b.width, b.width, Math.max(Math.min(b.travel, b.trailLen), 0.001));
    }
  }

  clear() {
    for (const b of this.pool) { b.alive = false; b.group.visible = false; }
  }
}

// Closest approach between a bullet segment and a vertical capsule.
// Returns the distance along the bullet where it enters, or -1.
export function segmentVsCapsuleY(p, d, len, cx, cz, y0, y1, r) {
  // segment 1: p + d*s*len (s in 0..1); segment 2: (cx, y0..y1, cz)
  const d1x = d.x * len, d1y = d.y * len, d1z = d.z * len;
  const d2y = y1 - y0;
  const rx = p.x - cx, ry = p.y - y0, rz = p.z - cz;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2y * d2y;
  const f = d2y * ry;
  if (a < 1e-10) return rx * rx + rz * rz + (ry < 0 ? ry * ry : ry > d2y ? (ry - d2y) ** 2 : 0) < r * r ? 0 : -1;
  const c = d1x * rx + d1y * ry + d1z * rz;
  const bb = d1y * d2y;
  const denom = a * e - bb * bb;
  let s = denom > 1e-10 ? Math.min(Math.max((bb * f - c * e) / denom, 0), 1) : 0;
  let t = (bb * s + f) / e;
  if (t < 0) { t = 0; s = Math.min(Math.max(-c / a, 0), 1); }
  else if (t > 1) { t = 1; s = Math.min(Math.max((bb - c) / a, 0), 1); }
  const qx = rx + d1x * s, qy = ry + d1y * s - d2y * t, qz = rz + d1z * s;
  const dist2 = qx * qx + qy * qy + qz * qz;
  if (dist2 > r * r) return -1;
  return Math.max(s * len - Math.sqrt(r * r - dist2), 0);
}

// Distance along a ray to a sphere, or -1.
export function segmentVsSphere(p, d, len, cx, cy, cz, r) {
  const ox = p.x - cx, oy = p.y - cy, oz = p.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  if (c <= 0) return 0;
  const disc = b * b - c;
  if (disc < 0 || b > 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t <= len ? t : -1;
}
