import * as THREE from 'three';
import { radialTexture } from '../world/textures.js';
import { PALETTE } from '../config.js';

// All short-lived visuals: shards, flashes, shockwave rings, glowing impact
// marks and the falling body parts of destroyed enemies. Everything here is
// pooled (created once, reused) and animated on WORLD time, so debris hangs
// in the air when the player stands still.

const MAX_SHARDS = 520;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class Effects {
  constructor(scene) {
    this.scene = scene;

    // --- shards: one instanced mesh, 520 tiny tetrahedra
    this.shardMesh = new THREE.InstancedMesh(
      new THREE.TetrahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      MAX_SHARDS
    );
    this.shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shardMesh.frustumCulled = false;
    this.shards = [];
    for (let i = 0; i < MAX_SHARDS; i++) {
      this.shardMesh.setMatrixAt(i, ZERO);
      this.shardMesh.setColorAt(i, _c.set(0xffffff));
      this.shards.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, ax: 0, ay: 0, az: 0, life: 0, max: 1, size: 0.05, grav: 14 });
    }
    this.shardCursor = 0;
    scene.add(this.shardMesh);

    // --- flashes (camera-facing glows)
    const tex = radialTexture();
    this.flashes = [];
    for (let i = 0; i < 28; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      }));
      sp.visible = false;
      scene.add(sp);
      this.flashes.push({ sp, life: 0, max: 1, s0: 1, s1: 1 });
    }
    this.flashCursor = 0;

    // --- shockwave rings on the floor
    const ringGeo = new THREE.RingGeometry(0.86, 1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
      }));
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, life: 0, max: 1, size: 1 });
    }
    this.ringCursor = 0;

    // --- impact marks on surfaces
    const markGeo = new THREE.PlaneGeometry(1, 1);
    this.marks = [];
    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({
        map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
        polygonOffset: true, polygonOffsetFactor: -2,
      }));
      mesh.visible = false;
      scene.add(mesh);
      this.marks.push({ mesh, life: 0, max: 1 });
    }
    this.markCursor = 0;

    // --- muzzle light in the world
    this.muzzleLight = new THREE.PointLight(0x8ffff0, 0, 14, 1.6);
    scene.add(this.muzzleLight);

    this.debris = []; // groups of detached enemy parts
  }

  burst(x, y, z, dx, dy, dz, count, color, opt = {}) {
    const speed = opt.speed ?? 6, spread = opt.spread ?? 0.8, size = opt.size ?? 0.06;
    const life = opt.life ?? 1.1, bright = opt.bright ?? 1.6;
    for (let i = 0; i < count; i++) {
      const s = this.shards[this.shardCursor];
      const idx = this.shardCursor;
      this.shardCursor = (this.shardCursor + 1) % MAX_SHARDS;
      const v = speed * (0.25 + Math.random() * 0.9);
      s.alive = true;
      s.x = x; s.y = y; s.z = z;
      s.vx = (dx + (Math.random() * 2 - 1) * spread) * v;
      s.vy = (dy + (Math.random() * 2 - 1) * spread) * v + (opt.up ?? 1.5);
      s.vz = (dz + (Math.random() * 2 - 1) * spread) * v;
      s.rx = Math.random() * 6; s.ry = Math.random() * 6; s.rz = Math.random() * 6;
      s.ax = (Math.random() - 0.5) * 16; s.ay = (Math.random() - 0.5) * 16; s.az = (Math.random() - 0.5) * 16;
      s.max = s.life = life * (0.5 + Math.random() * 0.7);
      s.size = size * (0.5 + Math.random());
      s.grav = opt.grav ?? 14;
      _c.set(color).multiplyScalar(bright * (0.6 + Math.random() * 0.7));
      this.shardMesh.setColorAt(idx, _c);
    }
    this.shardMesh.instanceColor.needsUpdate = true;
  }

  flash(x, y, z, color, s0 = 0.3, s1 = 1.4, life = 0.14, bright = 2) {
    const f = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashes.length;
    f.sp.position.set(x, y, z);
    f.sp.material.color.set(color).multiplyScalar(bright);
    f.sp.visible = true;
    f.life = f.max = life; f.s0 = s0; f.s1 = s1;
  }

  ring(x, y, z, color, size = 2.4, life = 0.45) {
    const r = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    r.mesh.position.set(x, y + 0.03, z);
    r.mesh.material.color.set(color).multiplyScalar(1.6);
    r.mesh.visible = true;
    r.life = r.max = life; r.size = size;
  }

  mark(x, y, z, nx, ny, nz, color, size = 0.42) {
    const m = this.marks[this.markCursor];
    this.markCursor = (this.markCursor + 1) % this.marks.length;
    m.mesh.position.set(x + nx * 0.015, y + ny * 0.015, z + nz * 0.015);
    m.mesh.lookAt(x + nx, y + ny, z + nz);
    m.mesh.scale.setScalar(size);
    m.mesh.material.color.set(color).multiplyScalar(1.4);
    m.mesh.visible = true;
    m.life = m.max = 7;
  }

  // A bullet striking a wall or the floor.
  impact(x, y, z, nx, ny, nz, color) {
    this.flash(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, color, 0.15, 0.9, 0.12);
    this.burst(x, y, z, nx, ny, nz, 7, color, { speed: 3.5, spread: 0.7, size: 0.028, life: 0.6, up: 0.5 });
    this.burst(x, y, z, nx, ny, nz, 4, 0x8a97c8, { speed: 2.5, spread: 0.9, size: 0.035, life: 0.9, up: 0.5, bright: 0.5 });
    this.mark(x, y, z, nx, ny, nz, color);
  }

  // Slow, floaty, multi-coloured: the party's answer to a kill.
  confetti(x, y, z) {
    for (const c of PALETTE.party) {
      this.burst(x, y, z, 0, 0.8, 0, 10, c, { speed: 4.2, spread: 1, size: 0.05, life: 2.6, up: 3.2, grav: 5, bright: 1.5 });
    }
  }

  muzzle(x, y, z) {
    this.muzzleLight.position.set(x, y, z);
    this.muzzleLight.intensity = 60;
  }

  // Takes ownership of an enemy's detached body parts.
  addDebris(parts, material) {
    this.debris.push({ parts, material, age: 0, baseEmissive: material.emissiveIntensity });
  }

  update(wdt, dt) {
    // shards
    let any = false;
    for (let i = 0; i < MAX_SHARDS; i++) {
      const s = this.shards[i];
      if (!s.alive) continue;
      any = true;
      s.life -= wdt;
      if (s.life <= 0) { s.alive = false; this.shardMesh.setMatrixAt(i, ZERO); continue; }
      s.vy -= s.grav * wdt;
      s.x += s.vx * wdt; s.y += s.vy * wdt; s.z += s.vz * wdt;
      if (s.y < s.size * 0.5) {
        s.y = s.size * 0.5;
        s.vy = Math.abs(s.vy) * 0.35;
        s.vx *= 0.6; s.vz *= 0.6;
        s.ax *= 0.5; s.ay *= 0.5; s.az *= 0.5;
      }
      s.rx += s.ax * wdt; s.ry += s.ay * wdt; s.rz += s.az * wdt;
      const k = Math.min(s.life / (s.max * 0.35), 1);
      _q.setFromEuler(_e.set(s.rx, s.ry, s.rz));
      _m.compose(_p.set(s.x, s.y, s.z), _q, _s.setScalar(s.size * k));
      this.shardMesh.setMatrixAt(i, _m);
    }
    if (any || this._hadShards) this.shardMesh.instanceMatrix.needsUpdate = true;
    this._hadShards = any;

    // flashes and rings never fully freeze, so a glow cannot hang in your face
    const fdt = Math.max(wdt, dt * 0.4);
    for (const f of this.flashes) {
      if (!f.sp.visible) continue;
      f.life -= fdt;
      if (f.life <= 0) { f.sp.visible = false; continue; }
      const k = 1 - f.life / f.max;
      f.sp.scale.setScalar(f.s0 + (f.s1 - f.s0) * Math.sqrt(k));
      f.sp.material.opacity = 1 - k * k;
    }

    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.life -= fdt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const k = 1 - r.life / r.max;
      r.mesh.scale.setScalar(0.2 + r.size * (1 - Math.pow(1 - k, 3)));
      r.mesh.material.opacity = (1 - k) * 0.9;
    }

    for (const m of this.marks) {
      if (!m.mesh.visible) continue;
      m.life -= wdt;
      if (m.life <= 0) { m.mesh.visible = false; continue; }
      m.mesh.material.opacity = Math.min(m.life / 3, 1) * 0.9;
    }

    this.muzzleLight.intensity *= Math.exp(-26 * dt);
    if (this.muzzleLight.intensity < 0.05) this.muzzleLight.intensity = 0;

    // enemy parts: fall, tumble, cool down like embers, then shrink away
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.age += wdt;
      d.material.emissiveIntensity = d.baseEmissive * Math.max(1 - d.age / 2.2, 0.06) + Math.max(0.5 - d.age, 0) * 5;
      const shrink = d.age > 3.2 ? Math.max(1 - (d.age - 3.2) / 0.6, 0) : 1;
      for (const p of d.parts) {
        const u = p.userData;
        u.vy -= 15 * wdt;
        p.position.x += u.vx * wdt; p.position.y += u.vy * wdt; p.position.z += u.vz * wdt;
        if (p.position.y < u.rest) {
          p.position.y = u.rest;
          u.vy = Math.abs(u.vy) * 0.28;
          u.vx *= 0.55; u.vz *= 0.55;
          u.sx *= 0.4; u.sy *= 0.4; u.sz *= 0.4;
        }
        p.rotation.x += u.sx * wdt; p.rotation.y += u.sy * wdt; p.rotation.z += u.sz * wdt;
        if (shrink < 1) p.scale.setScalar(u.scale * shrink);
      }
      if (d.age > 3.8) {
        for (const p of d.parts) this.scene.remove(p);
        d.material.dispose();
        this.debris.splice(i, 1);
      }
    }
  }

  clear() {
    for (let i = 0; i < MAX_SHARDS; i++) { this.shards[i].alive = false; this.shardMesh.setMatrixAt(i, ZERO); }
    this.shardMesh.instanceMatrix.needsUpdate = true;
    for (const f of this.flashes) f.sp.visible = false;
    for (const r of this.rings) r.mesh.visible = false;
    for (const m of this.marks) m.mesh.visible = false;
    for (const d of this.debris) { for (const p of d.parts) this.scene.remove(p); d.material.dispose(); }
    this.debris.length = 0;
    this.muzzleLight.intensity = 0;
  }
}
