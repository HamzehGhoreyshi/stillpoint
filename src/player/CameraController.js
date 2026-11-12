import * as THREE from 'three';
import { CONFIG } from '../config.js';

// The camera. In third-person it rides on a "boom": an invisible arm that
// starts above the hero's head and reaches back over the right shoulder.
// Shortening the boom to zero puts the camera in the hero's eyes, which is
// how first-person view and the sniper scope work - same code, shorter arm.
// It also owns every bit of camera feel: recoil, landing dip, shake, zoom.

class Spring {
  constructor(stiffness, damping) {
    this.k = stiffness; this.d = damping; this.x = 0; this.v = 0;
  }
  update(dt) {
    this.v += (-this.k * this.x - this.d * this.v) * dt;
    this.x += this.v * dt;
  }
}

const BOOM = 3.5; // metres behind the hero
const _off = new THREE.Vector3();

export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this.kick = new Spring(220, 24); // recoil pitch
    this.dip = new Spring(160, 20); // landing
    this.baseFov = 76;
    this.reset();
  }

  reset() {
    this.yaw = 0;
    this.pitch = 0;
    this.lookSpeed = 0;
    this.bobPhase = 0;
    this.trauma = 0;
    this.deadT = 0;
    this.fov = this.baseFov;
    this.boom = 0;
    this.camDist = 0; // actual distance from the hero's head to the camera
    this.kick.x = this.kick.v = 0;
    this.dip.x = this.dip.v = 0;
    this.shakeT = 0;
  }

  // sensScale < 1 slows the mouse while zoomed in
  look(dx, dy, dt, sensScale = 1) {
    const s = CONFIG.player.mouseSens * sensScale;
    this.yaw -= dx * s;
    this.pitch = Math.min(Math.max(this.pitch - dy * s, -1.35), 1.35);
    // how fast the view is turning, 0..1 (feeds a trickle of time)
    const speed = dt > 0 ? (Math.hypot(dx, dy) * s) / dt : 0;
    const target = Math.min(speed / 5, 1);
    this.lookSpeed += (target - this.lookSpeed) * (1 - Math.exp(-12 * dt));
  }

  fireKick(k = 1) { this.kick.v += 0.5 * k; this.trauma = Math.min(this.trauma + 0.12 * k, 1); }
  land(impact) { this.dip.v -= 1.6 * impact; }
  shake(amount) { this.trauma = Math.min(this.trauma + amount, 1); }

  // o: { zoomFov, aim (0..1), third (bool), scope (bool), collision }
  update(dt, player, flow, o) {
    const cam = this.camera;
    const aim = o.aim;
    this.kick.update(dt);
    this.dip.update(dt);
    this.trauma = Math.max(this.trauma - dt * 1.8, 0);
    this.shakeT += dt * 38;

    // how long should the boom be right now?
    let targetBoom = 0;
    if (o.third) targetBoom = o.scope ? BOOM * (1 - aim) : BOOM - 1.5 * aim;
    if (!player.alive) {
      this.deadT = Math.min(this.deadT + dt * 1.4, 1);
      if (o.third) targetBoom = BOOM + 2;
    }
    this.boom += (targetBoom - this.boom) * (1 - Math.exp(-(aim > 0.01 ? 22 : 9) * dt));
    const f = Math.min(this.boom / BOOM, 1); // 0 = in the eyes, 1 = fully behind

    if (player.onGround) this.bobPhase += player.groundSpeed * dt * 1.55;
    const bobAmt = (player.onGround ? player.speedFactor : 0) * (1 - aim * 0.8) * (1 - f);
    const bobY = Math.sin(this.bobPhase * 2) * 0.03 * bobAmt;
    const bobRoll = Math.cos(this.bobPhase) * 0.004 * bobAmt;

    const sh = this.trauma * this.trauma;
    const shX = Math.sin(this.shakeT * 1.3) * Math.cos(this.shakeT * 0.7) * 0.02 * sh;
    const shY = Math.sin(this.shakeT * 1.1 + 2) * 0.02 * sh;

    let eye = CONFIG.player.eye + (2.0 - CONFIG.player.eye) * f;
    let roll = bobRoll + shX * 0.6;
    if (!player.alive && f < 0.05) {
      // first-person death: the view drops and tips over
      const k = 1 - Math.pow(1 - this.deadT, 3);
      eye -= 1.25 * k;
      roll += 0.75 * k;
    }

    const wide = this.baseFov + flow * 4;
    const targetFov = wide + (o.zoomFov - wide) * aim;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-(aim > 0.01 ? 30 : 8) * dt));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }

    const deadTilt = !player.alive && f > 0.05 ? -0.35 * this.deadT : 0;
    cam.rotation.set(this.pitch + this.kick.x * (1 - f * 0.5) + shY + deadTilt, this.yaw + shX, roll, 'YXZ');

    // pivot above the head, then reach back along the boom
    const px = player.pos.x, py = player.viewY + eye + bobY + this.dip.x * (1 - f * 0.6), pz = player.pos.z;
    _off.set(1.05 * f, 0.1 * f, this.boom).applyQuaternion(cam.quaternion);
    let len = _off.length();
    if (len > 0.05) {
      // never let a wall come between the camera and the hero
      const dx = _off.x / len, dy = _off.y / len, dz = _off.z / len;
      const hit = o.collision.raycast(px, py, pz, dx, dy, dz, len + 0.3);
      const clear = hit === Infinity ? len : Math.max(hit - 0.3, 0.12);
      cam.position.set(px + dx * clear, py + dy * clear, pz + dz * clear);
      len = clear;
    } else {
      cam.position.set(px, py, pz);
    }
    this.camDist = len;
    cam.updateMatrixWorld();
  }
}
