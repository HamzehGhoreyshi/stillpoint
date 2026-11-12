import * as THREE from 'three';
import { CONFIG, PALETTE } from '../config.js';
import { CollisionWorld } from './Collision.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tileTexture, panelTexture, spillTexture } from './textures.js';

// Environment generation. Everything is built from scaled boxes, and every
// solid box is registered twice: once as a mesh you see, once as a collider
// in CollisionWorld that the player, enemies and bullets test against.

const BOX = new THREE.BoxGeometry(1, 1, 1);

export class Arena {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.collision = new CollisionWorld();
    this.spawnPoints = [];
    this.contacts = []; // contact shadows, collected and built as one mesh
    this.half = CONFIG.arena.half;

    const panel = panelTexture();
    const std = (color, extra = {}) =>
      new THREE.MeshStandardMaterial({ color, map: panel, roughness: 0.82, metalness: 0, ...extra });
    this.mat = {
      wall: std(PALETTE.wall),
      block: std(PALETTE.block),
      trim: std(PALETTE.trim),
      van: std(0x8591be, { roughness: 0.5 }),
      dark: new THREE.MeshStandardMaterial({ color: PALETTE.dark, roughness: 0.35, metalness: 0.2 }),
      accent: new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent).multiplyScalar(1.7) }),
      amber: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a0a).multiplyScalar(1.1) }),
    };

    this.buildFloor();
    this.buildPerimeter();
    this.buildCentre();
    this.buildCover();
    this.buildVehicles();
    this.buildCrates();
    this.buildStage();
    this.buildRoof();

    this.buildContacts();
    this.mergeStatic();
  }

  // The arena is built from ~250 separate boxes, which would mean ~250
  // separate draw commands every frame (and again for shadows) - the main
  // cost on a weak phone. Nothing here ever moves, so all pieces that share a
  // material are fused into one mesh: the whole building draws in about ten.
  mergeStatic() {
    this.group.updateMatrixWorld(true);
    const buckets = new Map();
    const pieces = [];
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${o.renderOrder}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { mesh: o, geos: [] }));
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      b.geos.push(g.applyMatrix4(o.matrixWorld)); // bake its place into the shape
      pieces.push(o);
    });
    for (const o of pieces) o.removeFromParent();
    this.group.clear();
    for (const { mesh, geos } of buckets.values()) {
      const merged = new THREE.Mesh(mergeGeometries(geos), mesh.material);
      merged.castShadow = mesh.castShadow;
      merged.receiveShadow = mesh.receiveShadow;
      merged.renderOrder = mesh.renderOrder;
      merged.matrixAutoUpdate = false;
      this.group.add(merged);
      for (const g of geos) g.dispose();
    }
    this.group.updateMatrixWorld(true);
  }

  // One solid block: mesh + collider + soft contact shadow on the floor.
  block(cx, cz, sx, sy, sz, opt = {}) {
    const y = opt.y ?? 0;
    const mesh = new THREE.Mesh(BOX, opt.mat ?? this.mat.block);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(cx, y + sy / 2, cz);
    mesh.castShadow = opt.cast ?? true;
    mesh.receiveShadow = true;
    (opt.parent ?? this.group).add(mesh);
    if (opt.collide ?? true) this.collision.addBox(cx, y + sy / 2, cz, sx, sy, sz);
    if (opt.contact ?? (opt.collide ?? true)) this.contact(cx, y, cz, sx, sz);
    return mesh;
  }

  // Fake ambient occlusion: a dark, soft-edged patch under an object.
  contact(cx, y, cz, sx, sz, strength = 0.5) {
    this.contacts.push({ cx, y, cz, sx, sz, strength });
  }

  // All contact shadows share one material; each quad carries its own box
  // size as per-corner data, so they can be drawn together in one go.
  buildContacts() {
    const pad = 0.8;
    const geos = this.contacts.map(({ cx, y, cz, sx, sz, strength }) => {
      const g = new THREE.PlaneGeometry(sx + pad * 2, sz + pad * 2).toNonIndexed();
      g.rotateX(-Math.PI / 2);
      const n = g.attributes.position.count;
      const local = new Float32Array(n * 2), box = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        local[i * 2] = g.attributes.position.getX(i);
        local[i * 2 + 1] = g.attributes.position.getZ(i);
        box[i * 3] = sx / 2; box[i * 3 + 1] = sz / 2; box[i * 3 + 2] = strength;
      }
      g.setAttribute('aLocal', new THREE.BufferAttribute(local, 2));
      g.setAttribute('aBox', new THREE.BufferAttribute(box, 3));
      g.translate(cx, y + 0.012, cz);
      return g;
    });
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uPad: { value: pad } },
      vertexShader: /* glsl */ `
        attribute vec2 aLocal; attribute vec3 aBox;
        varying vec2 vP; varying vec3 vBox;
        void main() { vP = aLocal; vBox = aBox; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uPad;
        varying vec2 vP; varying vec3 vBox;
        void main() {
          float d = length(max(abs(vP) - vBox.xy, 0.0));
          float a = 1.0 - smoothstep(0.0, uPad, d);
          gl_FragColor = vec4(0.012, 0.02, 0.06, a * a * vBox.z);
        }`,
    });
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.renderOrder = 1;
    this.group.add(m);
    for (const g of geos) g.dispose();
  }

  // The club ceiling: a dark slab with a lighting truss hung under it.
  // It does not cast a shadow, so the big slanted key light still reaches
  // the floor like a stage wash. (The glowing ceiling panels are in Party.js.)
  buildRoof() {
    const H = CONFIG.arena.wallHeight, size = this.half * 2 + 4, m = this.mat;
    const geo = new THREE.PlaneGeometry(size, size);
    geo.rotateX(Math.PI / 2); // faces down
    const roof = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x0c0f22, roughness: 0.9 }));
    roof.position.y = H;
    this.group.add(roof);
    this.collision.addBox(0, H + 0.5, 0, size, 1, size); // stops bullets and the camera

    const truss = { y: H - 0.5, mat: m.trim, collide: false, contact: false, cast: false };
    for (const t of [-15, -5, 5, 15]) {
      this.block(0, t, this.half * 2, 0.28, 0.28, truss);
      this.block(t, 0, 0.28, 0.28, this.half * 2, truss);
    }
    // the rod the mirror ball hangs from
    this.block(0, 0, 0.06, H - 7.3, 0.06, { y: 7.3, mat: m.dark, collide: false, contact: false, cast: false });
  }

  buildFloor() {
    const size = this.half * 2 + 4;
    const tex = tileTexture();
    tex.repeat.set(size / 8, size / 8); // one texture = 4 tiles = 8 m
    const mat = new THREE.MeshStandardMaterial({
      color: PALETTE.floor, map: tex, roughness: 0.38, metalness: 0.05, envMapIntensity: 0.9,
    });
    const geo = new THREE.PlaneGeometry(size, size);
    geo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(geo, mat);
    floor.receiveShadow = true;
    this.group.add(floor);
  }

  buildPerimeter() {
    const h = this.half, H = CONFIG.arena.wallHeight, m = this.mat;
    // four walls (inner faces sit exactly on the arena edge)
    this.block(0, -h - 1, h * 2 + 4, H, 2, { mat: m.wall });
    this.block(0, h + 1, h * 2 + 4, H, 2, { mat: m.wall });
    this.block(-h - 1, 0, 2, H, h * 2 + 4, { mat: m.wall });
    this.block(h + 1, 0, 2, H, h * 2 + 4, { mat: m.wall });

    const spill = new THREE.MeshBasicMaterial({
      map: spillTexture(), color: PALETTE.accent, transparent: true, opacity: 0.2,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    // sides: [axis the wall runs along, sign, rotation of the light spill]
    const sides = [
      { along: 'x', sign: -1, rot: 0 },
      { along: 'x', sign: 1, rot: Math.PI },
      { along: 'z', sign: -1, rot: Math.PI / 2 },
      { along: 'z', sign: 1, rot: -Math.PI / 2 },
    ];
    for (const s of sides) {
      const place = (t, inset, st, sy, depth, opt) => {
        // t = position along the wall, inset = distance in from the wall face
        const w = s.sign * (h - inset);
        return s.along === 'x'
          ? this.block(t, w, st, sy, depth, opt)
          : this.block(w, t, depth, sy, st, opt);
      };
      // structural ribs
      for (let i = -3; i <= 3; i++) place(i * 6.2, 0.2, 1.2, H, 0.4, { mat: m.wall });
      // cap band and a thin light line near the top
      place(0, 0.3, h * 2, 0.5, 0.6, { y: H - 0.5, mat: m.trim, collide: false });
      place(0, 0.04, h * 2, 0.07, 0.08, { y: H - 0.75, mat: m.accent, collide: false, cast: false });
      // glowing skirting line + its spill on the floor
      place(0, 0.03, h * 2, 0.06, 0.06, { y: 0.1, mat: m.accent, collide: false, cast: false });
      const sg = new THREE.PlaneGeometry(h * 2, 3.2);
      sg.rotateX(-Math.PI / 2);
      const sm = new THREE.Mesh(sg, spill);
      sm.rotation.y = s.rot;
      const off = s.sign * (h - 1.6);
      sm.position.set(s.along === 'x' ? 0 : off, 0.02, s.along === 'x' ? off : 0);
      sm.renderOrder = 2;
      this.group.add(sm);

      // two doorways per wall: enemies enter here
      for (const t of [-9.3, 9.3]) {
        place(t, 0.06, 2.3, 3.3, 0.12, { mat: m.dark, collide: false, contact: false, cast: false });
        place(t - 1.2, 0.1, 0.1, 3.4, 0.2, { mat: m.amber, collide: false, contact: false, cast: false });
        place(t + 1.2, 0.1, 0.1, 3.4, 0.2, { mat: m.amber, collide: false, contact: false, cast: false });
        place(t, 0.1, 2.5, 0.1, 0.2, { y: 3.3, mat: m.amber, collide: false, contact: false, cast: false });
        const w = s.sign * (h - 1.7);
        this.spawnPoints.push(
          s.along === 'x' ? new THREE.Vector3(t, 0, w) : new THREE.Vector3(w, 0, t)
        );
      }
    }
  }

  buildCentre() {
    const m = this.mat;
    // two shallow steps and a monolith with glowing seams
    this.block(0, 0, 9, 0.3, 9, { mat: m.trim });
    this.block(0, 0, 3.4, 0.3, 3.4, { y: 0.3, mat: m.trim });
    this.block(0, 0, 1.3, 5.4, 1.3, { y: 0.6, mat: m.wall });
    for (const [dx, dz] of [[0.66, 0], [-0.66, 0], [0, 0.66], [0, -0.66]]) {
      this.block(dx, dz, dx ? 0.03 : 0.09, 4.4, dz ? 0.03 : 0.09, {
        y: 1.1, mat: m.accent, collide: false, contact: false, cast: false,
      });
    }

    // four pillars carrying a square frame of beams: long moon shadows
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.block(sx * 9, sz * 9, 1.8, 8, 1.8, { mat: m.wall });
        this.block(sx * 9, sz * 9, 1.86, 0.07, 1.86, {
          y: 2.3, mat: m.accent, collide: false, contact: false, cast: false,
        });
      }
    }
    this.block(0, -9, 19.8, 0.6, 1.0, { y: 7.0, mat: m.trim, contact: false });
    this.block(0, 9, 19.8, 0.6, 1.0, { y: 7.0, mat: m.trim, contact: false });
    this.block(-9, 0, 1.0, 0.6, 17, { y: 7.0, mat: m.trim, contact: false });
    this.block(9, 0, 1.0, 0.6, 17, { y: 7.0, mat: m.trim, contact: false });
  }

  buildCover() {
    const m = this.mat;
    const low = (cx, cz, sx, sz) => this.block(cx, cz, sx, 1.0, sz);
    // waist-high cover: blocks bullets, can be jumped onto
    low(-5.6, 6.6, 4.2, 0.55);
    low(5.6, -6.6, 4.2, 0.55);
    low(-6.6, -5.6, 0.55, 4.2);
    low(6.6, 5.6, 0.55, 4.2);
    low(0, -15, 5, 0.55);
    low(-15.5, 1.5, 0.55, 4.5);
    low(15.5, -1.5, 0.55, 4.5);

    // tall fins that break sight lines and form side corridors
    const tall = (cx, cz, sx, sz) => {
      this.block(cx, cz, sx, 3.4, sz, { mat: m.wall });
      this.block(cx, cz, sx + 0.04, 0.06, sz + 0.04, {
        y: 3.0, mat: m.accent, collide: false, contact: false, cast: false,
      });
    };
    tall(-17.6, -6, 8, 0.7);
    tall(17.6, 6, 8, 0.7);
    tall(10, 15.6, 0.7, 6);
    tall(-10, -15.6, 0.7, 6);
  }

  // A boxy cargo van. `alongX` picks its orientation.
  van(cx, cz, alongX, flip = false) {
    const m = this.mat;
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = (alongX ? 0 : Math.PI / 2) + (flip ? Math.PI : 0);
    this.group.add(g);
    const part = (x, y, z, sx, sy, sz, mat, cast = true) => {
      const mesh = new THREE.Mesh(BOX, mat);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, y, z);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    part(0, 1.02, 0, 4.7, 1.25, 2.0, m.van); // body
    part(-0.75, 2.0, 0, 3.1, 0.72, 1.96, m.van); // cargo box
    part(0, 0.36, 0, 4.5, 0.12, 1.9, m.trim); // sill

    // cabin with a raked windscreen
    const shape = new THREE.Shape();
    shape.moveTo(0.8, 1.64); shape.lineTo(2.3, 1.64); shape.lineTo(1.75, 2.36); shape.lineTo(0.8, 2.36);
    shape.closePath();
    const cab = new THREE.ExtrudeGeometry(shape, { depth: 1.9, bevelEnabled: false });
    cab.translate(0, 0, -0.95);
    const cabin = new THREE.Mesh(cab, m.van);
    cabin.castShadow = cabin.receiveShadow = true;
    g.add(cabin);
    const glass = part(2.04, 2.0, 0, 0.04, 0.82, 1.7, m.dark, false);
    glass.rotation.z = 0.652;
    part(1.3, 2.02, 0, 0.75, 0.46, 1.94, m.dark, false); // side windows

    part(2.36, 0.95, 0.7, 0.04, 0.09, 0.42, m.accent, false); // headlights
    part(2.36, 0.95, -0.7, 0.04, 0.09, 0.42, m.accent, false);
    part(-2.36, 1.2, 0, 0.04, 0.07, 1.7, m.amber, false); // tail light bar
    part(2.4, 0.5, 0, 0.14, 0.22, 2.04, m.trim); // bumpers
    part(-2.4, 0.5, 0, 0.14, 0.22, 2.04, m.trim);

    const wheel = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14);
    wheel.rotateX(Math.PI / 2);
    for (const x of [-1.5, 1.5]) {
      for (const z of [-0.92, 0.92]) {
        const w = new THREE.Mesh(wheel, m.dark);
        w.position.set(x, 0.42, z);
        w.castShadow = true;
        g.add(w);
      }
    }

    const sx = alongX ? 4.9 : 2.1, sz = alongX ? 2.1 : 4.9;
    this.collision.addBox(cx, 1.2, cz, sx, 2.4, sz);
    this.contact(cx, 0, cz, sx, sz, 0.62);
  }

  buildVehicles() {
    this.van(-13, 14.5, true);
    this.van(14, -14, false, true);
  }

  // DJ booth and speaker stacks on the north side of the dance floor.
  // (The moving parts - lights, speaker cones, the DJ - live in Party.js.)
  buildStage() {
    const m = this.mat;
    this.block(0, -11.6, 4.4, 1.1, 1.0, { mat: m.trim });
    this.block(0, -11.08, 4.4, 0.06, 0.04, { y: 0.8, mat: m.accent, collide: false, contact: false, cast: false });
    this.block(0, -11.7, 1.6, 0.12, 0.6, { y: 1.1, mat: m.dark, collide: false, contact: false });
    this.stage = { dj: { x: 0, z: -12.75 }, speakers: [] };
    for (const sx of [-1, 1]) {
      this.block(sx * 3.5, -11.9, 1.4, 2.7, 1.2, { mat: m.dark });
      this.stage.speakers.push({ x: sx * 3.5, y: 0.75, z: -11.29 }, { x: sx * 3.5, y: 1.95, z: -11.29 });
    }
  }

  buildCrates() {
    const crate = (cx, cz, y = 0, s = 1.0) =>
      this.block(cx, cz, s, s, s, { y, contact: y === 0 });
    crate(13.4, 12.8); crate(14.55, 13.0); crate(13.8, 14.0); crate(13.95, 12.9, 1.0, 0.9);
    crate(-13.4, -12.6); crate(-14.5, -12.9); crate(-13.7, -11.5); crate(-13.9, -12.7, 1.0, 0.9);
    crate(3.6, 13.2); crate(-6.2, -13.8);
    crate(-17, 6.5); crate(17, -6.5);
  }
}
