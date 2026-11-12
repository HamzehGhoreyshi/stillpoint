import * as THREE from 'three';
import { CONFIG, PALETTE } from '../config.js';
import { radialTexture } from './textures.js';

// Everything that makes the arena a party: the light-up dance floor, sweeping
// light beams, a mirror ball with its drifting dots, pumping speakers and two
// coloured lights. All of it is driven by one number - the music's beat -
// and it runs on real time: the party does not freeze when the world does.

const COLORS = PALETTE.party.map((c) => new THREE.Color(c));
const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

export class Party {
  constructor(scene, arena) {
    this.scene = scene;
    this.arena = arena;
    this.t = 0;
    this.buildFloor();
    this.buildBeams();
    this.buildMirrorBall();
    this.buildSpeakers(arena.stage.speakers);
    this.buildCeiling();
    this.lights = [0, 1].map((i) => {
      const l = new THREE.PointLight(COLORS[i], 0, 20, 1.5);
      l.position.set(i ? 3.6 : -3.6, 3.2, i ? -3.6 : 3.6);
      scene.add(l);
      return l;
    });
  }

  // 6 x 6 glowing tiles on the central platform (the middle four sit under
  // the monolith's step, so they are skipped).
  buildFloor() {
    this.tiles = [];
    for (let j = 0; j < 6; j++) {
      for (let i = 0; i < 6; i++) {
        if ((i === 2 || i === 3) && (j === 2 || j === 3)) continue;
        this.tiles.push({ i, j, x: -3.75 + i * 1.5, z: -3.75 + j * 1.5 });
      }
    }
    const geo = new THREE.PlaneGeometry(1.38, 1.38);
    geo.rotateX(-Math.PI / 2);
    this.floor = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), this.tiles.length);
    this.tiles.forEach((t, n) => {
      this.floor.setMatrixAt(n, _m.makeTranslation(t.x, 0.306, t.z));
      this.floor.setColorAt(n, _c.set(0x000000));
    });
    this.scene.add(this.floor);

    // coloured light spilling off the platform onto the surrounding floor
    const sg = new THREE.PlaneGeometry(1, 1);
    sg.rotateX(-Math.PI / 2);
    this.spill = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({
      map: radialTexture(), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.spill.scale.setScalar(26);
    this.spill.position.y = 0.025;
    this.spill.renderOrder = 2;
    this.scene.add(this.spill);
  }

  // Moving-head beams hanging from the frame: a see-through cone each, plus
  // the pool of light where it lands.
  buildBeams() {
    const geo = new THREE.CylinderGeometry(0.05, 1.15, 1, 14, 1, true);
    geo.translate(0, -0.5, 0); // tip at the fixture, opening downward
    const spots = [[-9, -9], [9, -9], [-9, 9], [9, 9], [0, -9], [0, 9]];
    this.beams = spots.map(([x, z], n) => {
      const color = COLORS[n % COLORS.length];
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uColor: { value: color.clone() }, uPower: { value: 0.2 } },
        vertexShader: /* glsl */ `
          varying float vK;
          void main() { vK = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uPower; varying float vK;
          void main() { gl_FragColor = vec4(uColor, uPower * (0.25 + vK * 0.75)); }`,
      });
      const cone = new THREE.Mesh(geo, mat);
      cone.position.set(x, 6.95, z);
      cone.frustumCulled = false;
      this.scene.add(cone);
      const pg = new THREE.PlaneGeometry(1, 1);
      pg.rotateX(-Math.PI / 2);
      const pool = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({
        map: radialTexture(), color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      pool.renderOrder = 3;
      this.scene.add(pool);
      return { cone, pool, mat, n, x, z, color: color.clone() };
    });
  }

  buildMirrorBall() {
    this.ball = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55, 1),
      new THREE.MeshStandardMaterial({ color: 0xdfe6ff, metalness: 1, roughness: 0.12, flatShading: true, emissive: 0x39406a, emissiveIntensity: 0.6 })
    );
    this.ball.position.set(0, 6.75, 0);
    this.scene.add(this.ball);

    // the scattered dots a mirror ball throws across the floor
    const geo = new THREE.PlaneGeometry(1, 1);
    this.dots = [];
    for (let n = 0; n < 70; n++) {
      this.dots.push({ a: Math.random() * Math.PI * 2, r: 3 + Math.random() * 18, size: 0.25 + Math.random() * 0.3, tw: Math.random() * 6 });
    }
    this.dotMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
      map: radialTexture(), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
    }), this.dots.length);
    this.dotMesh.frustumCulled = false;
    this.dotMesh.renderOrder = 3;
    this.dots.forEach((d, n) => this.dotMesh.setColorAt(n, _c.set(0xffffff)));
    this.scene.add(this.dotMesh);
  }

  // A grid of glowing panels on the ceiling, like a club's LED roof.
  buildCeiling() {
    const H = CONFIG.arena.wallHeight;
    this.panels = [];
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) this.panels.push({ i, j, x: -17.5 + i * 5, z: -17.5 + j * 5 });
    }
    const geo = new THREE.PlaneGeometry(3.4, 3.4);
    geo.rotateX(Math.PI / 2); // faces down
    this.ceiling = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), this.panels.length);
    this.panels.forEach((p, n) => {
      this.ceiling.setMatrixAt(n, _m.makeTranslation(p.x, H - 0.03, p.z));
      this.ceiling.setColorAt(n, _c.set(0x000000));
    });
    this.scene.add(this.ceiling);
  }

  buildSpeakers(list) {
    const ring = new THREE.RingGeometry(0.3, 0.42, 20);
    const cone = new THREE.CircleGeometry(0.3, 20);
    this.speakerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const dark = new THREE.MeshBasicMaterial({ color: 0x0b0d1c });
    this.speakers = list.map((s) => {
      const g = new THREE.Group();
      g.position.set(s.x, s.y, s.z);
      g.add(new THREE.Mesh(ring, this.speakerMat), new THREE.Mesh(cone, dark));
      this.scene.add(g);
      return g;
    });
  }

  // beat = beats since the music started (fractional)
  update(dt, beat) {
    this.t += dt;
    const t = this.t;
    const k = Math.floor(beat);
    const frac = beat - k;
    const kick = Math.exp(-5 * frac); // 1 on the beat, fading until the next
    const bars = Math.floor(k / 8);

    // dance floor: two patterns that swap every 8 beats
    this.tiles.forEach((tile, n) => {
      let idx, lit;
      if (bars % 2 === 0) {
        idx = (tile.i + tile.j + k) % 4;
        lit = (tile.i + tile.j + k) % 2 === 0;
      } else {
        const ring = Math.max(Math.abs(tile.i - 2.5), Math.abs(tile.j - 2.5)) | 0;
        idx = (ring + k) % 4;
        lit = (ring + k) % 2 === 0;
      }
      _c.copy(COLORS[idx]).multiplyScalar(lit ? 0.45 + 0.75 * kick : 0.16);
      this.floor.setColorAt(n, _c);
    });
    this.floor.instanceColor.needsUpdate = true;
    this.spill.material.color.copy(COLORS[k % 4]).lerp(COLORS[(k + 1) % 4], frac);
    this.spill.material.opacity = 0.22 + 0.2 * kick;

    // beams sweep in slow figure-eights and land on the floor
    for (const b of this.beams) {
      const ph = b.n * 1.7;
      const ax = Math.sin(t * 0.55 + ph) * 0.55 - Math.sign(b.z) * 0.35;
      const az = Math.cos(t * 0.4 + ph * 1.3) * 0.55 + Math.sign(b.x) * 0.35;
      b.cone.rotation.set(ax, 0, az);
      _d.set(0, -1, 0).applyEuler(b.cone.rotation);
      const len = Math.min(6.95 / -_d.y, 16);
      b.cone.scale.set(1 + len * 0.06, len, 1 + len * 0.06);
      b.pool.position.set(b.x + _d.x * len, 0.03, b.z + _d.z * len);
      b.pool.scale.setScalar(3.2 + len * 0.1);
      b.mat.uniforms.uColor.value.copy(COLORS[(b.n + (k >> 2)) % 4]);
      b.pool.material.color.copy(b.mat.uniforms.uColor.value);
      b.mat.uniforms.uPower.value = 0.1 + 0.1 * kick;
      b.pool.material.opacity = 0.3 + 0.3 * kick;
    }

    // mirror ball
    this.ball.rotation.y = t * 0.5;
    this.dots.forEach((d, n) => {
      const a = d.a + t * 0.16;
      const tw = 0.6 + 0.4 * Math.sin(t * 2 + d.tw);
      _m.compose(_p.set(Math.cos(a) * d.r, 0.035, Math.sin(a) * d.r), FLAT, _s.setScalar(d.size * tw));
      this.dotMesh.setMatrixAt(n, _m);
    });
    this.dotMesh.instanceMatrix.needsUpdate = true;

    // ceiling panels: a diagonal wave of colour that steps on every beat
    this.panels.forEach((p, n) => {
      const idx = (p.i + p.j * 3 + k) % 4;
      const wave = (p.i + p.j + k) % 4 === 0;
      _c.copy(COLORS[idx]).multiplyScalar(wave ? 0.35 + 0.6 * kick : 0.07);
      this.ceiling.setColorAt(n, _c);
    });
    this.ceiling.instanceColor.needsUpdate = true;

    // speakers thump, room lights breathe
    this.speakerMat.color.copy(COLORS[k % 4]).multiplyScalar(0.5 + kick);
    for (const s of this.speakers) s.scale.setScalar(1 + 0.16 * kick);
    this.lights.forEach((l, i) => {
      l.color.copy(COLORS[(k + i * 2) % 4]);
      l.intensity = 18 + 46 * kick;
    });

    // the wall trim drifts through the party colours
    this.arena.mat.accent.color.copy(COLORS[2]).lerp(COLORS[0], 0.5 + 0.5 * Math.sin(t * 0.25)).multiplyScalar(1.5);
  }
}
