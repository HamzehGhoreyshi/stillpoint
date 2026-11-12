// Collects keyboard and mouse state. Systems read it once per frame;
// Game calls endFrame() to clear the "just happened" flags.

export class Input {
  constructor(target) {
    this.target = target;
    this.down = new Set();
    this.justPressed = new Set();
    this.look = { x: 0, y: 0 };
    this.fireJust = false;
    this.fireHeld = false; // left button down (automatic fire)
    this.aimHeld = false; // right button down (zoom)
    this.wheel = 0;
    this.touchMode = false; // on-screen controls are driving the game
    this.touchAxis = { x: 0, z: 0 }; // virtual joystick, each -1..1
    this.locked = false;
    // ?nolock lets the game run without capturing the mouse (used for testing).
    this.requireLock = !new URLSearchParams(location.search).has('nolock');
    this.onLockChange = null;

    addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      // without mouse capture the browser does not handle Esc for us
      if (e.code === 'Escape' && !this.requireLock) this.onLockChange?.(false);
      this.down.add(e.code);
      this.justPressed.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); this.fireHeld = false; this.aimHeld = false; });

    document.addEventListener('mousemove', (e) => {
      if (!this.active || this.touchMode) return;
      const mx = e.movementX || 0;
      const my = e.movementY || 0;
      if (Math.abs(mx) > 400 || Math.abs(my) > 400) return; // browser glitch spikes
      this.look.x += mx;
      this.look.y += my;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.active || this.touchMode) return;
      if (e.button === 0) { this.fireJust = true; this.fireHeld = true; }
      if (e.button === 2) this.aimHeld = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (this.touchMode) return;
      if (e.button === 0) this.fireHeld = false;
      if (e.button === 2) this.aimHeld = false;
    });
    document.addEventListener('wheel', (e) => { if (this.active) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      if (this.locked) this.requireLock = true; // a real capture arrived after all
      if (!this.locked) { this.fireHeld = false; this.aimHeld = false; }
      if (this.requireLock) this.onLockChange?.(this.locked);
    });
  }

  get active() {
    return this.locked || !this.requireLock;
  }

  lock() {
    if (this.touchMode) this.requireLock = false; // phones cannot capture a mouse
    if (!this.requireLock) {
      this.onLockChange?.(true);
      return;
    }
    const p = this.target.requestPointerLock?.();
    if (p && p.catch) p.catch(() => {});
    // Some embedded browsers refuse to capture the mouse. Rather than leave
    // the game stuck on the menu, fall back to playing without capture.
    clearTimeout(this.lockTimer);
    this.lockTimer = setTimeout(() => {
      if (this.locked) return;
      this.requireLock = false;
      this.onLockChange?.(true);
    }, 700);
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // Movement intent: x = strafe right, z = forward.
  axis() {
    const d = this.down;
    const x = (d.has('KeyD') || d.has('ArrowRight') ? 1 : 0) - (d.has('KeyA') || d.has('ArrowLeft') ? 1 : 0);
    const z = (d.has('KeyW') || d.has('ArrowUp') ? 1 : 0) - (d.has('KeyS') || d.has('ArrowDown') ? 1 : 0);
    if (x === 0 && z === 0) return { x: this.touchAxis.x, z: this.touchAxis.z };
    return { x, z };
  }

  endFrame() {
    this.justPressed.clear();
    this.look.x = 0;
    this.look.y = 0;
    this.fireJust = false;
    this.wheel = 0;
  }
}
