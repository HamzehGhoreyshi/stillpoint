// Every tunable number in the game lives here, so balance and feel can be
// changed without hunting through the systems.

export const PALETTE = {
  skyTop: 0x05081a,
  skyHorizon: 0x2a3a78,
  fog: 0x141c3e,
  floor: 0x46527a,
  wall: 0x55638f,
  block: 0x6a79a8,
  trim: 0x2a3252,
  dark: 0x141829,
  accent: 0x3fe8d2,
  party: [0xff2e97, 0x8a4dff, 0x22d3ff, 0x3b6bff], // dance floor, beams, dancers
  moon: 0xcfe0ff,
  ivory: 0xefe8da,
  brass: 0xb58a3a,
  playerShot: 0x8ffff0,
  enemyShot: 0xffa02a,
};

export const CONFIG = {
  arena: { half: 22, wallHeight: 8 },

  player: {
    radius: 0.38,
    height: 1.75,
    eye: 1.62,
    runSpeed: 6.4,
    creepSpeed: 2.3, // hold Shift: slow walk = slow time
    groundAccel: 58,
    airAccel: 16,
    gravity: 24,
    jumpVel: 7.8,
    stepHeight: 0.36,
    maxHealth: 5,
    mouseSens: 0.0022,
    hurtInvuln: 1.0,
  },

  // The heart of the game: how player activity maps to world speed.
  time: {
    min: 0.02, // world speed while standing still
    curve: 0.8, // <1 makes slow walking advance time a bit more generously
    airMin: 0.65, // jumping always costs time
    reloadMin: 0.5, // so does reloading
    lookMax: 0.1, // turning the camera lets a trickle of time through
    riseRate: 16, // how fast time speeds up (per second)
    fallRate: 7, // how fast it settles back to frozen
    shotPulse: 0.8, // firing pushes the world forward briefly...
    shotPulseDur: 0.26, // ...for this long (real seconds)
    actionFloor: 0.3, // weapon timers never run slower than this
  },

  // Three guns. `auto` = fires while the button is held. `zoomFov` = camera
  // field of view while holding right click. `kick` scales recoil.
  weapons: [
    {
      id: 'pistol', name: 'PISTOL', magSize: 10, cooldown: 0.26, reloadTime: 1.1,
      bulletSpeed: 70, damage: 1, auto: false, spread: 0, bloom: 0, kick: 1, pulse: 0.8, zoomFov: 60,
    },
    {
      id: 'rifle', name: 'AK', magSize: 30, cooldown: 0.1, reloadTime: 1.6,
      bulletSpeed: 85, damage: 1, auto: true, rateFloor: 0.85, spread: 0.006, bloom: 0.0035, kick: 0.5, pulse: 0.7, zoomFov: 54,
    },
    {
      id: 'sniper', name: 'SNIPER', magSize: 5, cooldown: 0.85, reloadTime: 1.9,
      bulletSpeed: 180, damage: 9, auto: false, spread: 0, bloom: 0, kick: 2, pulse: 0.9, zoomFov: 15,
      scope: true, pierce: true,
    },
  ],

  // Enemies grow stronger as you win. Every `killsPerLevel` kills raises
  // their level: new arrivals carry one more shield point (up to `maxShield`)
  // and move a little faster. Each kill also hands every survivor a shield.
  threat: { killsPerLevel: 3, maxShield: 3, speedPerLevel: 0.05, maxSpeedBonus: 0.25 },

  enemies: {
    rusher: {
      hp: 1, speed: 4.1, scale: 0.84, color: 0xff5a0a, radius: 0.32,
      windup: 0.5, recover: 0.8, reach: 1.7,
    },
    gunner: {
      hp: 2, speed: 2.8, scale: 0.9, color: 0xff8a00, radius: 0.34,
      windup: 0.8, cooldown: [2.4, 3.6], range: [7, 13], bulletSpeed: 13,
    },
    marksman: {
      hp: 1, speed: 2.2, scale: 0.98, color: 0xffb81c, radius: 0.34,
      windup: 2.1, cooldown: [3.4, 4.6], range: [14, 30], bulletSpeed: 34,
    },
  },
};
