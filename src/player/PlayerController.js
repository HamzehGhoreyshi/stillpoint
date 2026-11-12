import * as THREE from 'three';
import { CONFIG } from '../config.js';

// The player's body: movement, jumping, collision and health.
// It always runs on REAL time. How fast it is actually moving
// (`speedFactor`) is what drives the TimeSystem.

export class PlayerController {
  constructor(collision) {
    this.collision = collision;
    this.pos = new THREE.Vector3(); // feet position
    this.vel = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.pos.set(0, 0, 17);
    this.vel.set(0, 0, 0);
    this.viewY = 0; // smoothed feet height, so steps do not jolt the camera
    this.onGround = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.health = CONFIG.player.maxHealth;
    this.alive = true;
    this.speedFactor = 0;
    this.groundSpeed = 0;
    this.justLanded = false;
    this.justJumped = false;
    this.landImpact = 0;
  }

  update(dt, input, yaw) {
    const c = CONFIG.player;
    const pos = this.pos, vel = this.vel;
    this.justLanded = false;
    this.justJumped = false;

    // --- intent: WASD relative to where the camera faces
    const ax = input.axis();
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    let wx = cos * ax.x - sin * ax.z;
    let wz = -sin * ax.x - cos * ax.z;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const creep = input.down.has('ShiftLeft') || input.down.has('ShiftRight');
    // keys are all-or-nothing; a joystick pushed halfway walks at half speed
    const maxSpeed = (creep ? c.creepSpeed : c.runSpeed) * Math.min(wl, 1);

    // --- accelerate toward the wanted velocity (snappy on ground, loose in air)
    const tx = wx * maxSpeed, tz = wz * maxSpeed;
    let dvx = tx - vel.x, dvz = tz - vel.z;
    const dv = Math.hypot(dvx, dvz);
    const accel = (this.onGround ? c.groundAccel : wl > 0 ? c.airAccel : 2) * dt;
    if (dv > accel) { dvx *= accel / dv; dvz *= accel / dv; }
    vel.x += dvx;
    vel.z += dvz;

    // --- jump (small buffers make it forgiving)
    if (input.justPressed.has('Space')) this.jumpBuffer = 0.12;
    this.jumpBuffer -= dt;
    this.coyote = this.onGround ? 0.1 : this.coyote - dt;
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      vel.y = c.jumpVel;
      this.onGround = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.justJumped = true;
    }

    // --- horizontal move + wall collision
    const px = pos.x, pz = pos.z;
    pos.x += vel.x * dt;
    pos.z += vel.z * dt;
    const yMin = pos.y + c.stepHeight + 0.01, yMax = pos.y + c.height;
    this.collision.resolveCircle(pos, c.radius, yMin, yMax);
    this.collision.resolveCircle(pos, c.radius, yMin, yMax);

    // real distance covered this frame (walking into a wall does not count)
    const moved = Math.hypot(pos.x - px, pos.z - pz);
    this.groundSpeed = dt > 0 ? moved / dt : 0;
    this.speedFactor = Math.min(this.groundSpeed / c.runSpeed, 1);

    // --- vertical move + ground
    const prevY = pos.y;
    const fallSpeed = -vel.y;
    if (!this.onGround) {
      vel.y -= c.gravity * dt;
      pos.y += vel.y * dt;
    }
    const foot = c.radius * 0.7;
    if (this.onGround) {
      const g = this.collision.groundHeight(pos.x, pos.z, foot, pos.y, c.stepHeight);
      if (pos.y - g > c.stepHeight + 0.05) {
        this.onGround = false; // walked off a ledge
      } else {
        pos.y = g;
        vel.y = 0;
      }
    } else if (vel.y <= 0) {
      const g = this.collision.groundHeight(pos.x, pos.z, foot, prevY, 0.1);
      if (pos.y <= g) {
        pos.y = g;
        vel.y = 0;
        this.onGround = true;
        this.justLanded = true;
        this.landImpact = Math.min(Math.max(fallSpeed, 0) / 11, 1);
      }
    }

    const rate = this.onGround ? 16 : 40;
    this.viewY += (pos.y - this.viewY) * (1 - Math.exp(-rate * dt));
  }
}
