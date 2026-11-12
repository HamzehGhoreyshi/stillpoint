// On-screen controls for phones and narrow windows.
// They do not talk to the game directly: every control just writes into the
// same Input object the keyboard and mouse write into, so the rest of the
// game cannot tell the difference.
//
//   left thumb  - a floating joystick (push a little = walk slowly = slow time)
//   right thumb - drag anywhere to look; FIRE can be dragged to aim while shooting
//   buttons     - fire, jump, reload, zoom, next weapon, pause

const LOOK_GAIN = 2.3; // touch drags are shorter than mouse moves
const STICK_RADIUS = 52;

export function wantsTouchControls() {
  return matchMedia('(pointer: coarse)').matches || innerWidth <= 820;
}

export class TouchControls {
  constructor(input, onPause, onView) {
    this.input = input;
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.innerHTML = `
      <div id="t-look"></div>
      <div id="t-stick"><div id="t-base"><div id="t-knob"></div></div></div>
      <button id="t-pause" class="t-btn" aria-label="Pause">II</button>
      <button id="t-weapon" class="t-btn" aria-label="Next weapon">PISTOL</button>
      <button id="t-view" class="t-btn" aria-label="Switch camera">VIEW</button>
      <button id="t-reload" class="t-btn" aria-label="Reload">R</button>
      <button id="t-zoom" class="t-btn" aria-label="Zoom">ZOOM</button>
      <button id="t-jump" class="t-btn" aria-label="Jump">JUMP</button>
      <button id="t-fire" class="t-btn" aria-label="Fire">FIRE</button>`;
    document.body.appendChild(root);
    const $ = (id) => root.querySelector(id);
    this.weaponBtn = $('#t-weapon');
    this.zoomBtn = $('#t-zoom');

    // --- look: drag on any free part of the screen
    this.dragLook($('#t-look'));

    // --- joystick: appears under the thumb
    const zone = $('#t-stick'), base = $('#t-base'), knob = $('#t-knob');
    let stickId = null, ox = 0, oy = 0;
    const setStick = (x, y) => {
      input.touchAxis.x = x;
      input.touchAxis.z = y;
      knob.style.transform = `translate(${x * STICK_RADIUS}px, ${-y * STICK_RADIUS}px)`;
    };
    zone.addEventListener('pointerdown', (e) => {
      if (stickId !== null) return;
      stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      const r = zone.getBoundingClientRect();
      ox = e.clientX; oy = e.clientY;
      base.style.left = `${ox - r.left - 60}px`;
      base.style.top = `${oy - r.top - 60}px`;
      base.style.bottom = 'auto';
      base.classList.add('on');
      setStick(0, 0);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stickId) return;
      let dx = (e.clientX - ox) / STICK_RADIUS, dy = (e.clientY - oy) / STICK_RADIUS;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      setStick(dx, -dy);
    });
    const endStick = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      base.classList.remove('on');
      setStick(0, 0);
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    // --- fire: hold to shoot, and drag it to keep aiming while you do
    const fire = $('#t-fire');
    this.dragLook(fire, () => { input.fireJust = true; input.fireHeld = true; }, () => { input.fireHeld = false; });

    // --- one-tap buttons
    const tap = (id, fn) => $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
    tap('#t-jump', () => input.justPressed.add('Space'));
    tap('#t-reload', () => input.justPressed.add('KeyR'));
    tap('#t-weapon', () => { input.wheel = 1; });
    tap('#t-zoom', () => { input.aimHeld = !input.aimHeld; });
    tap('#t-pause', onPause);
    tap('#t-view', onView);

    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Makes an element steer the camera while a finger is dragged on it.
  dragLook(el, onDown, onUp) {
    const input = this.input;
    let id = null, lx = 0, ly = 0;
    el.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      e.preventDefault();
      id = e.pointerId;
      el.setPointerCapture(e.pointerId);
      lx = e.clientX; ly = e.clientY;
      el.classList.add('on');
      onDown?.();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      input.look.x += (e.clientX - lx) * LOOK_GAIN;
      input.look.y += (e.clientY - ly) * LOOK_GAIN;
      lx = e.clientX; ly = e.clientY;
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      el.classList.remove('on');
      onUp?.();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // Keeps the labels in step with the game.
  sync(weaponName, zoomed) {
    if (this.lastName !== weaponName) { this.lastName = weaponName; this.weaponBtn.textContent = weaponName; }
    if (this.lastZoom !== zoomed) { this.lastZoom = zoomed; this.zoomBtn.classList.toggle('active', zoomed); }
  }
}
