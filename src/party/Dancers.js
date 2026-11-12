import * as THREE from 'three';
import { PALETTE } from '../config.js';
import { radialTexture } from '../world/textures.js';

// The reward for a kill: a dancer arrives on that spot and joins the party.
// Dancers are faceted figures in the party colours (never amber, so they are
// not mistaken for enemies). They are pure decoration: bullets and bodies
// pass through them. Like the lights, they move to the music's beat on real
// time, so the dance floor keeps going while the fight is frozen.

const limb = (len, r0, r1) => {
  const g = new THREE.CylinderGeometry(r0, r1, len, 4, 1);
  g.translate(0, -len / 2, 0);
  return g;
};
const GEO = {
  torso: (() => { const g = new THREE.CylinderGeometry(0.19, 0.11, 0.5, 5, 1); g.translate(0, 0.25, 0); return g; })(),
  skirt: (() => { const g = new THREE.ConeGeometry(0.36, 0.4, 7, 1); g.translate(0, -0.14, 0); return g; })(),
  head: (() => { const g = new THREE.OctahedronGeometry(0.16, 0); g.scale(0.85, 1.2, 0.95); return g; })(),
  hair: limb(0.46, 0.07, 0.008),
  upperArm: limb(0.31, 0.05, 0.034),
  foreArm: limb(0.34, 0.04, 0.008),
  thigh: limb(0.46, 0.08, 0.05),
  shin: limb(0.5, 0.055, 0.01),
  glow: (() => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; })(),
};
const MAX = 12;
const SCALE = 0.9;

class Dancer {
  constructor(scene, color) {
    this.scene = scene;
    this.color = color;
    const mat = (this.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color).multiplyScalar(0.45), emissive: color, emissiveIntensity: 0.5,
      roughness: 0.45, flatShading: true,
    }));
    const mesh = (geo, parent, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(geo, mat);
      o.position.set(x, y, z);
      o.castShadow = true;
      parent.add(o);
      return o;
    };
    const joint = (parent, x, y, z) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      parent.add(g);
      return g;
    };

    this.root = new THREE.Group();
    this.hips = joint(this.root, 0, 0.96, 0);
    mesh(GEO.skirt, this.hips);
    this.torso = joint(this.hips, 0, 0.02, 0);
    mesh(GEO.torso, this.torso);
    this.head = mesh(GEO.head, this.torso, 0, 0.74, 0);
    this.hair = joint(this.torso, 0, 0.84, -0.1);
    mesh(GEO.hair, this.hair);
    const arm = (side) => {
      const shoulder = joint(this.torso, side * 0.23, 0.46, 0);
      mesh(GEO.upperArm, shoulder);
      const elbow = joint(shoulder, 0, -0.31, 0);
      mesh(GEO.foreArm, elbow);
      return { shoulder, elbow, side };
    };
    this.armL = arm(1);
    this.armR = arm(-1);
    const leg = (side) => {
      const hip = joint(this.hips, side * 0.1, 0, 0);
      mesh(GEO.thigh, hip);
      const knee = joint(hip, 0, -0.46, 0);
      mesh(GEO.shin, knee);
      return { hip, knee };
    };
    this.legL = leg(1);
    this.legR = leg(-1);
    scene.add(this.root);

    this.glow = new THREE.Mesh(GEO.glow, new THREE.MeshBasicMaterial({
      map: radialTexture(), color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.glow.scale.setScalar(3);
    this.glow.renderOrder = 3;
    scene.add(this.glow);

    this.seed = Math.random() * 100;
    this.offset = Math.floor(Math.random() * 8);
    this.age = 0;
    this.delay = 0;
    this.leaving = 0;
    this.yaw = 0;
    this.spin = 0;
    this.fixedStyle = -1;
    this.root.scale.setScalar(0.001);
  }

  place(x, y, z, yaw, delay = 0) {
    this.root.position.set(x, y, z);
    this.glow.position.set(x, y + 0.035, z);
    this.yaw = yaw;
    this.delay = delay;
    this.root.visible = delay <= 0;
    this.glow.visible = delay <= 0;
  }

  // Returns true once, on the frame the dancer actually appears.
  update(dt, beat) {
    let arrived = false;
    if (this.delay > 0) {
      this.delay -= dt;
      if (this.delay > 0) return false;
      this.root.visible = this.glow.visible = true;
      arrived = true;
    }
    this.age += dt;
    const b = beat + this.offset * 0.5;
    const s1 = Math.sin(Math.PI * b); // one swing per two beats
    const s2 = Math.sin(Math.PI * 2 * b); // one per beat
    const frac = beat - Math.floor(beat);
    const bounce = Math.exp(-4.5 * frac); // dips on the beat, rises after
    const style = this.fixedStyle >= 0 ? this.fixedStyle : Math.floor(beat / 8 + this.seed) % 3;

    // entrance: spin up out of the floor; exit: shrink away
    const inK = Math.min(this.age / 0.5, 1);
    const ease = 1 - Math.pow(1 - inK, 3);
    let scale = SCALE * (ease + Math.sin(inK * Math.PI) * 0.12);
    if (this.leaving > 0) {
      this.leaving += dt;
      scale *= Math.max(1 - this.leaving / 0.35, 0);
    }
    this.root.scale.setScalar(Math.max(scale, 0.001));

    // legs and hips: bounce on every beat
    const dip = bounce * 0.07;
    this.hips.position.y = 0.96 - dip;
    const bend = 0.18 + bounce * 0.5;
    this.legL.hip.rotation.x = -bend * 0.55; this.legR.hip.rotation.x = -bend * 0.55;
    this.legL.knee.rotation.x = bend * 1.1; this.legR.knee.rotation.x = bend * 1.1;
    this.legL.hip.rotation.z = 0.07; this.legR.hip.rotation.z = -0.07;
    this.hips.position.x = s1 * 0.07;
    this.hips.rotation.z = -s1 * 0.1;
    this.hips.rotation.y = 0;
    this.torso.rotation.z = s1 * 0.16;
    this.torso.rotation.y = s1 * 0.25;
    this.torso.rotation.x = 0.05 + bounce * 0.06;
    this.head.rotation.z = -s1 * 0.12;
    this.hair.rotation.x = 0.75 + s2 * 0.3 + bounce * 0.3;
    this.hair.rotation.z = -s1 * 0.5;

    const L = this.armL, R = this.armR;
    if (style === 0) {
      // hands in the air
      L.shoulder.rotation.set(0, 0, 2.55 + s2 * 0.22);
      R.shoulder.rotation.set(0, 0, -2.55 + s2 * 0.22);
      L.elbow.rotation.set(0, 0, 0.5 * s1 - 0.3);
      R.elbow.rotation.set(0, 0, 0.5 * s1 + 0.3);
    } else if (style === 1) {
      // side-to-side groove, elbows pumping
      L.shoulder.rotation.set(s1 * 0.7, 0, 0.35);
      R.shoulder.rotation.set(-s1 * 0.7, 0, -0.35);
      L.elbow.rotation.set(-1.4 - s2 * 0.3, 0, 0);
      R.elbow.rotation.set(-1.4 + s2 * 0.3, 0, 0);
      this.hips.rotation.y = s1 * 0.4;
    } else {
      // twirl: arms out, one reaching up on alternate beats
      this.spin += dt * 2.6;
      const up = s1 > 0 ? s1 : 0, up2 = s1 < 0 ? -s1 : 0;
      L.shoulder.rotation.set(0, 0, 1.45 + up * 1.2);
      R.shoulder.rotation.set(0, 0, -1.45 - up2 * 1.2);
      L.elbow.rotation.set(0, 0, 0.2);
      R.elbow.rotation.set(0, 0, -0.2);
    }

    this.root.rotation.y = this.yaw + this.spin + (1 - ease) * 6 + Math.sin(this.age * 0.4 + this.seed) * 0.5;
    this.material.emissiveIntensity = 0.45 + bounce * 0.25;
    this.glow.material.opacity = (0.22 + bounce * 0.2) * Math.min(scale / SCALE, 1);
    return arrived;
  }

  dispose() {
    this.scene.remove(this.root);
    this.scene.remove(this.glow);
    this.material.dispose();
    this.glow.material.dispose();
  }
}

export class DanceCrew {
  constructor(scene, collision) {
    this.scene = scene;
    this.collision = collision;
    this.list = [];
    this.max = MAX; // lowered on weak devices
    this.count = 0;
    this.onArrive = null; // (x, y, z, color) => void
  }

  // A permanent dancer (the DJ behind the booth).
  addResident(x, z, yaw, style) {
    const d = new Dancer(this.scene, PALETTE.party[2]);
    d.place(x, 0, z, yaw);
    d.fixedStyle = style;
    d.resident = true;
    this.list.push(d);
    return d;
  }

  // Called when an enemy is destroyed at (x, z).
  add(x, z, faceX, faceZ, delay = 0.45) {
    const color = PALETTE.party[this.count++ % PALETTE.party.length];
    const d = new Dancer(this.scene, color);
    const y = this.collision.groundHeight(x, z, 0.1, 0, 0.45);
    d.place(x, y, z, Math.atan2(faceX - x, faceZ - z), delay);
    this.list.push(d);
    // keep the crowd to a sensible size: the earliest guest heads off
    const guests = this.list.filter((o) => !o.resident && !o.leaving);
    if (guests.length > this.max) guests[0].leaving = 0.001;
  }

  update(dt, beat) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      if (d.update(dt, beat)) this.onArrive?.(d.root.position.x, d.root.position.y, d.root.position.z, d.color);
      if (d.leaving > 0.35) {
        d.dispose();
        this.list.splice(i, 1);
      }
    }
  }

  // New run: guests leave, the DJ stays.
  clear() {
    for (const d of this.list) if (!d.resident) d.dispose();
    this.list = this.list.filter((d) => d.resident);
    this.count = 0;
  }
}
