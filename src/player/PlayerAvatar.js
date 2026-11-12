import * as THREE from 'three';
import { CONFIG, PALETTE } from '../config.js';
import { BUILDERS } from '../weapons/weaponModels.js';

// The hero you see in third-person view: an original muscle-bound green ogre
// (horns, tusks, brass belt), built from faceted shapes and animated in code.
// It is only a costume: movement and collision live in PlayerController,
// this class just poses the body to match (walk cycle, aim, jump, fall).
// It also carries world-sized copies of the three guns, and reports where
// the muzzle is so bullets leave from the gun in its hand.

const limb = (len, r0, r1, sides = 6) => {
  const g = new THREE.CylinderGeometry(r0, r1, len, sides, 1);
  g.translate(0, -len / 2, 0); // hangs from its joint
  return g;
};
const HALF_PI = Math.PI / 2;

export class PlayerAvatar {
  constructor(scene) {
    const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true, ...extra });
    const skin = flat(0x6fb02a, { emissive: 0x2f5a0c, emissiveIntensity: 0.4 });
    const skinDark = flat(0x558f1f, { emissive: 0x24480a, emissiveIntensity: 0.35 });
    const jacket = flat(PALETTE.ivory, { roughness: 0.5 });
    const trousers = flat(0x2f3960);
    const boot = flat(0x161a2c, { roughness: 0.5 });
    const brass = flat(PALETTE.brass, { roughness: 0.3, metalness: 0.9 });

    const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
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

    const root = (this.root = new THREE.Group());
    root.rotation.order = 'YXZ';
    scene.add(root);

    // --- lower body
    this.hips = joint(root, 0, 0.92, 0);
    mesh(new THREE.CylinderGeometry(0.38, 0.31, 0.3, 7), trousers, this.hips, 0, 0.02, 0);
    const leg = (side) => {
      const hip = joint(this.hips, side * 0.2, 0, 0);
      mesh(limb(0.44, 0.17, 0.13), trousers, hip);
      const knee = joint(hip, 0, -0.44, 0);
      mesh(limb(0.38, 0.13, 0.11), trousers, knee);
      mesh(new THREE.BoxGeometry(0.22, 0.13, 0.38), boot, knee, 0, -0.41, 0.07);
      return { hip, knee };
    };
    this.legL = leg(1);
    this.legR = leg(-1);

    // --- torso: a huge V - wide chest, narrow waist, slabs of muscle
    this.torso = joint(this.hips, 0, 0.12, 0);
    mesh((() => { const g = new THREE.CylinderGeometry(0.56, 0.33, 0.76, 7); g.translate(0, 0.38, 0); return g; })(), skin, this.torso);
    for (const sd of [-1, 1]) {
      mesh((() => { const g = new THREE.IcosahedronGeometry(0.23, 0); g.scale(1.1, 0.8, 0.6); return g; })(), skinDark, this.torso, sd * 0.21, 0.55, 0.3); // chest
      mesh(new THREE.BoxGeometry(0.15, 0.09, 0.06), skinDark, this.torso, sd * 0.09, 0.3, 0.33); // abs
      mesh(new THREE.BoxGeometry(0.15, 0.09, 0.06), skinDark, this.torso, sd * 0.09, 0.18, 0.31);
    }
    mesh(new THREE.CylinderGeometry(0.345, 0.345, 0.09, 7), brass, this.torso, 0, 0.03, 0); // belt
    mesh(new THREE.CylinderGeometry(0.2, 0.52, 0.2, 7), skin, this.torso, 0, 0.85, -0.02); // neck and traps
    const strap = mesh(new THREE.BoxGeometry(0.1, 0.95, 0.035), jacket, this.torso, 0, 0.42, 0.37); // chest strap
    strap.rotation.z = 0.72;
    strap.rotation.x = -0.12;

    // --- head: heavy jaw, small horns, swept ears, tusks
    this.head = joint(this.torso, 0, 0.97, 0.05);
    mesh((() => { const g = new THREE.IcosahedronGeometry(0.3, 0); g.scale(1.08, 0.95, 1); return g; })(), skin, this.head, 0, 0.22, 0);
    mesh(new THREE.BoxGeometry(0.42, 0.17, 0.36), skin, this.head, 0, 0.05, 0.06);
    mesh(new THREE.BoxGeometry(0.44, 0.07, 0.12), skinDark, this.head, 0, 0.32, 0.24);
    for (const s of [-1, 1]) {
      const horn = mesh(new THREE.ConeGeometry(0.055, 0.2, 5), jacket, this.head, s * 0.17, 0.53, 0.02);
      horn.rotation.z = -s * 0.35;
      const ear = mesh(new THREE.ConeGeometry(0.07, 0.24, 4), skinDark, this.head, s * 0.36, 0.26, -0.05);
      ear.rotation.set(-0.5, 0, -s * (HALF_PI + 0.35));
      const tusk = mesh(new THREE.ConeGeometry(0.032, 0.12, 4), jacket, this.head, s * 0.13, 0.16, 0.24);
      tusk.rotation.x = 0.15;
    }

    // --- arms: boulder shoulders, tree-trunk upper arms, banded wrists
    const arm = (side) => {
      const shoulder = joint(this.torso, side * 0.64, 0.74, 0);
      mesh(new THREE.IcosahedronGeometry(0.22, 0), skin, shoulder, 0, 0.02, 0);
      mesh(limb(0.42, 0.19, 0.14), skin, shoulder);
      mesh((() => { const g = new THREE.IcosahedronGeometry(0.15, 0); g.scale(0.9, 1.3, 0.9); return g; })(), skinDark, shoulder, 0, -0.18, 0.08); // bicep
      const elbow = joint(shoulder, 0, -0.42, 0);
      mesh(limb(0.34, 0.16, 0.12), skin, elbow);
      mesh(new THREE.CylinderGeometry(0.13, 0.125, 0.1, 6), jacket, elbow, 0, -0.27, 0);
      mesh(new THREE.IcosahedronGeometry(0.14, 0), skin, elbow, 0, -0.39, 0);
      return { shoulder, elbow };
    };
    this.armL = arm(1);
    this.armR = arm(-1); // the character faces +Z, so its right hand is at -X

    // --- guns in the right hand. The gun models point down -Z; this mount
    // turns them to point along the forearm with their top facing up.
    const mount = joint(this.armR.elbow, 0, -0.41, 0);
    mount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)
    ));
    this.guns = CONFIG.weapons.map((spec) => {
      const wrap = new THREE.Group();
      const model = new THREE.Group();
      wrap.add(model);
      const parts = BUILDERS[spec.id](model);
      const muzzle = new THREE.Object3D();
      muzzle.position.fromArray(parts.muzzle);
      model.add(muzzle);
      wrap.scale.setScalar(1.5);
      // slide the model so its grip sits in the fist
      model.position.set(0, 0.11, 0.04);
      wrap.visible = false;
      wrap.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      mount.add(wrap);
      return { wrap, muzzle };
    });

    this.walkPhase = 0;
    this.cryT = 0; // counts down while he sits and cries
    this.sit = 0; // 0 standing .. 1 sitting, eased
    this.fall = 0;
    this.time = 0;
    this._v = new THREE.Vector3();
  }

  // After a kill he sits down and cries. Moving or shooting gets him up.
  cry() { this.cryT = 2.8; }
  cancelCry() { this.cryT = 0; }
  get crying() { return this.sit > 0.6; }

  // Where the tears come from.
  getFace(out) {
    this.root.updateMatrixWorld(true);
    return this.head.getWorldPosition(out);
  }

  // World position bullets leave from.
  getMuzzle(index, out) {
    this.root.updateMatrixWorld(true);
    return this.guns[index].muzzle.getWorldPosition(out);
  }

  // s: { pos, viewY, yaw, pitch, groundSpeed, speedFactor, onGround,
  //      weaponIndex, twoHanded, kick, reload (0..1 tilt), alive, visible }
  update(dt, s) {
    this.root.visible = s.visible;
    this.time += dt;
    this.guns.forEach((g, i) => (g.wrap.visible = i === s.weaponIndex));

    // feet
    if (s.onGround) this.walkPhase += s.groundSpeed * dt * 1.75;
    const ph = this.walkPhase;
    const sw = s.onGround ? s.speedFactor : 0;
    const air = s.onGround ? 0 : 1;
    this.legL.hip.rotation.x = Math.sin(ph) * 0.75 * sw - air * 0.55;
    this.legR.hip.rotation.x = -Math.sin(ph) * 0.75 * sw + air * 0.2;
    this.legL.knee.rotation.x = Math.max(0, Math.sin(ph - 1.1)) * 1.0 * sw + 0.05 + air * 0.9;
    this.legR.knee.rotation.x = Math.max(0, Math.sin(ph - 1.1 + Math.PI)) * 1.0 * sw + 0.05 + air * 0.5;
    this.hips.position.y = 0.92 - 0.02 + Math.abs(Math.cos(ph)) * 0.06 * sw + Math.sin(this.time * 1.8) * 0.008;

    // body leans with the aim, shoulders roll with each step
    const pitch = s.pitch;
    this.torso.rotation.x = -pitch * 0.3 + 0.07 * sw;
    this.torso.rotation.y = Math.sin(ph) * 0.1 * sw;
    this.torso.rotation.z = Math.sin(ph) * 0.03 * sw;
    this.head.rotation.x = -pitch * 0.35;

    // gun arm points where the camera looks; recoil lifts it
    const lift = -HALF_PI - pitch * 0.7 - s.kick * 0.55 + s.reload * 0.75;
    this.armR.shoulder.rotation.set(lift, 0, 0.06);
    this.armR.elbow.rotation.x = -s.reload * 0.5;
    if (s.twoHanded) {
      // off hand reaches across to hold the fore-end
      this.armL.shoulder.rotation.set(lift + 0.3, 0, -0.8);
      this.armL.elbow.rotation.x = -0.35;
    } else {
      this.armL.shoulder.rotation.set(-Math.sin(ph) * 0.5 * sw + air * -0.6, 0, 0.12 + air * 0.3);
      this.armL.elbow.rotation.x = -0.3 - sw * 0.4;
    }

    // sit and cry: fold down onto the floor, head in hand, shoulders shaking
    this.cryT = Math.max(this.cryT - dt, 0);
    const sitTarget = this.cryT > 0 && s.alive && s.onGround ? 1 : 0;
    this.sit += (sitTarget - this.sit) * (1 - Math.exp(-(sitTarget ? 7 : 12) * dt));
    const k = this.sit;
    if (k > 0.002) {
      const sob = Math.sin(this.time * 13) * k;
      const mix = (cur, to) => cur + (to - cur) * k;
      this.hips.position.y = mix(this.hips.position.y, 0.2);
      for (const leg of [this.legL, this.legR]) {
        leg.hip.rotation.x = mix(leg.hip.rotation.x, -1.5); // legs out in front
        leg.knee.rotation.x = mix(leg.knee.rotation.x, 0.22);
      }
      this.legL.hip.rotation.z = 0.2 * k;
      this.legR.hip.rotation.z = -0.2 * k;
      this.torso.rotation.x = mix(this.torso.rotation.x, 0.42) + sob * 0.035;
      this.torso.rotation.y *= 1 - k;
      this.torso.position.y = 0.12 + sob * 0.012;
      this.head.rotation.x = mix(this.head.rotation.x, 0.5) + sob * 0.05;
      this.head.rotation.z = Math.sin(this.time * 2.1) * 0.12 * k;
      // gun rests on the lap, free hand covers the face
      const r = this.armR.shoulder.rotation;
      r.set(mix(r.x, -0.75), 0, mix(r.z, 0.25));
      this.armR.elbow.rotation.x = mix(this.armR.elbow.rotation.x, -0.5);
      const l = this.armL.shoulder.rotation;
      l.set(mix(l.x, -1.15) + sob * 0.03, 0, mix(l.z, -0.5));
      this.armL.elbow.rotation.x = mix(this.armL.elbow.rotation.x, -2.05);
    } else {
      this.legL.hip.rotation.z = this.legR.hip.rotation.z = 0;
      this.torso.position.y = 0.12;
      this.head.rotation.z = 0;
    }

    // defeat: topple backward
    this.fall += ((s.alive ? 0 : 1) - this.fall) * (1 - Math.exp(-5 * dt));
    this.root.position.set(s.pos.x, s.viewY + this.fall * 0.3, s.pos.z);
    this.root.rotation.set(-this.fall * 1.45, s.yaw + Math.PI, 0);
  }
}
