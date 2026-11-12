import * as THREE from 'three';
import { PALETTE } from '../config.js';
import { radialTexture } from '../world/textures.js';
import { BUILDERS } from './weaponModels.js';

// One first-person gun: ammo, cooldown, reload and all of its animation.
// The numbers come from a spec in config.js, the shape from weaponModels.js,
// so pistol, rifle and sniper all share this one class.
// It does not create bullets itself - Game asks `canFire`, calls `fire()`,
// and hands the shot to the ProjectileSystem.

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

export class Weapon {
  constructor(scene, spec) {
    this.spec = spec;
    this.root = new THREE.Group(); // animated: sway, bob, recoil, reload
    this.root.visible = false;
    scene.add(this.root);
    this.model = new THREE.Group();
    this.root.add(this.model);
    Object.assign(this, BUILDERS[spec.id](this.model));
    this.root.scale.setScalar(this.scale);
    this.magBase = this.mag.position.clone();
    this.onEvent = null; // (name) => void, used for sound

    // muzzle flash: a glow + a faceted spike, visible for a few frames
    this.flash = new THREE.Group();
    this.flash.position.fromArray(this.muzzle);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTexture(), color: new THREE.Color(PALETTE.playerShot).multiplyScalar(2.2),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    glow.scale.setScalar(0.28);
    const coneGeo = new THREE.ConeGeometry(0.035, 0.2, 5, 1, true);
    coneGeo.rotateX(-Math.PI / 2);
    coneGeo.translate(0, 0, -0.09);
    const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xffffff).multiplyScalar(2.5), blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.flash.add(glow, cone);
    this.flash.visible = false;
    this.model.add(this.flash);

    this.reset();
  }

  reset() {
    this.ammo = this.spec.magSize;
    this.cooldown = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.reloadStage = 0;
    this.kickZ = 0; this.kickZv = 0;
    this.kickR = 0; this.kickRv = 0;
    this.slideT = 0;
    this.flashT = 0;
    this.swayX = 0; this.swayY = 0;
    this.dipY = 0; this.dipV = 0;
    this.lower = 1; // 1 = below the screen, 0 = raised
    this.aim = 0; // 0 = hip, 1 = zoomed
    this.heat = 0; // builds with sustained fire, widens the spread
    this.time = 0;
    this.mag.visible = true;
  }

  get canFire() {
    return this.ammo > 0 && this.cooldown <= 0 && !this.reloading && this.lower < 0.3;
  }

  // 0 = just fired, 1 = ready. Drives the crosshair.
  get readiness() {
    if (this.reloading) return this.reloadT;
    return 1 - Math.min(Math.max(this.cooldown / this.spec.cooldown, 0), 1);
  }

  // Current cone of inaccuracy, in radians.
  get spread() {
    return this.spec.spread + this.heat * this.spec.bloom;
  }

  fire() {
    const k = this.spec.kick * (1 - this.aim * 0.4);
    this.ammo--;
    this.cooldown = this.spec.cooldown;
    this.kickZv += 1.7 * k;
    this.kickRv += 5.2 * k;
    this.slideT = 1;
    this.flashT = 0.055;
    this.heat = Math.min(this.heat + 1, 8);
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar(this.flashSize * (0.8 + Math.random() * 0.5));
  }

  startReload() {
    if (this.reloading || this.ammo === this.spec.magSize) return false;
    this.reloading = true;
    this.reloadT = 0;
    this.reloadStage = 0;
    this.onEvent?.('reloadStart');
    return true;
  }

  cancelReload() {
    this.reloading = false;
    this.reloadT = 0;
  }

  land(impact) { this.dipV -= 0.9 * impact; }

  // dt = real time (animation feel), actionDt = slowed weapon time
  // (cooldown and reload obey the time mechanic, with a floor so the gun
  // never feels stuck).
  update(dt, actionDt, s) {
    this.time += dt;
    // automatic weapons keep their rhythm: their cooldown has a higher floor
    if (this.cooldown > 0) this.cooldown -= Math.max(actionDt, dt * (this.spec.rateFloor ?? 0));
    this.heat = Math.max(this.heat - actionDt * 7, 0);

    if (this.reloading) {
      this.reloadT += actionDt / this.spec.reloadTime;
      if (this.reloadStage === 0 && this.reloadT > 0.2) { this.reloadStage = 1; this.onEvent?.('magOut'); }
      if (this.reloadStage === 1 && this.reloadT > 0.6) { this.reloadStage = 2; this.onEvent?.('magIn'); }
      if (this.reloadStage === 2 && this.reloadT > 0.86) { this.reloadStage = 3; this.slideT = 1; this.onEvent?.('rack'); }
      if (this.reloadT >= 1) {
        this.reloading = false;
        this.ammo = this.spec.magSize;
        this.onEvent?.('reloadDone');
      }
    }

    // springs
    this.kickZv += (-210 * this.kickZ - 24 * this.kickZv) * dt; this.kickZ += this.kickZv * dt;
    this.kickRv += (-190 * this.kickR - 22 * this.kickRv) * dt; this.kickR += this.kickRv * dt;
    this.dipV += (-150 * this.dipY - 18 * this.dipV) * dt; this.dipY += this.dipV * dt;
    this.slideT = Math.max(this.slideT - dt / this.slideTime, 0);
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;

    // sway: the gun lags slightly behind the camera
    const k = 1 - Math.exp(-10 * dt);
    this.swayX += (Math.max(Math.min(-s.lookDX * 0.0009, 0.05), -0.05) - this.swayX) * k;
    this.swayY += (Math.max(Math.min(s.lookDY * 0.0009, 0.05), -0.05) - this.swayY) * k;

    const lowerTarget = s.raised ? 0 : 1;
    this.lower += (lowerTarget - this.lower) * (1 - Math.exp(-(s.raised ? 11 : 13) * dt));
    const aimTarget = s.aiming && s.raised && !this.reloading ? 1 : 0;
    this.aim += (aimTarget - this.aim) * (1 - Math.exp(-13 * dt));

    // reload pose
    let rTilt = 0, rDrop = 0, magDrop = 0;
    if (this.reloading) {
      const t = this.reloadT;
      const inOut = smooth(0, 0.18, t) * (1 - smooth(0.84, 1, t));
      rTilt = inOut;
      rDrop = inOut * 0.05;
      magDrop = smooth(0.18, 0.36, t) * (1 - smooth(0.46, 0.64, t));
      this.mag.visible = !(t > 0.36 && t < 0.46);
    } else {
      this.mag.visible = true;
    }
    this.mag.position.set(
      this.magBase.x + this.magDrop[0] * magDrop,
      this.magBase.y + this.magDrop[1] * magDrop,
      this.magBase.z + this.magDrop[2] * magDrop
    );
    const open = this.locksOpen && this.ammo === 0 && !this.reloading ? 0.03 : 0;
    this.slide.position.z = Math.sin(Math.min(this.slideT, 1) * Math.PI) * this.slideTravel + open;

    // bob while walking, breathing while still
    const calm = 1 - this.aim * 0.7;
    const bob = (s.onGround ? s.speedFactor : 0) * calm;
    const bobX = Math.cos(s.bobPhase) * 0.008 * bob;
    const bobY = -Math.abs(Math.sin(s.bobPhase)) * 0.009 * bob + Math.sin(this.time * 1.6) * 0.0016;

    // zooming pulls the gun toward the centre of the view
    const h = this.hold;
    const baseX = Math.min(Math.max(h[0] * s.aspect, 0.09), h[0] * 1.85) * (1 - this.aim * 0.82);
    const baseY = h[1] + this.aim * 0.055;
    this.root.position.set(
      baseX + bobX + this.swayX * 0.5 * calm - rTilt * 0.05,
      baseY + bobY + this.dipY - rDrop - this.lower * 0.5 + this.swayY * 0.4 * calm,
      h[2] + this.kickZ + this.aim * 0.04
    );
    this.root.rotation.set(
      0.02 + this.kickR * 0.9 + this.swayY * calm - this.lower * 0.9 + rTilt * 0.5,
      0.075 * (1 - this.aim) + this.swayX * calm + rTilt * 0.35,
      -0.03 * (1 - this.aim) - this.swayX * 0.8 * calm - rTilt * 0.75
    );
  }
}
