import * as THREE from 'three';

// All textures are drawn in code on a canvas, so the game ships no image files.

export function seededRandom(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

// Large floor tiles: 4 x 4 tiles per texture, slight tone variation, dark grout.
export function tileTexture() {
  const size = 1024;
  const [c, g] = canvas(size);
  const rand = seededRandom(11);
  const n = 4, cell = size / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = 200 + Math.floor(rand() * 34);
      g.fillStyle = `rgb(${v - 6},${v},${v + 8})`;
      g.fillRect(i * cell, j * cell, cell, cell);
    }
  }
  for (let k = 0; k < 9000; k++) {
    g.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,20,0.05)';
    g.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
  for (let i = 0; i <= n; i++) {
    const p = i * cell;
    g.fillStyle = 'rgba(14,18,40,0.92)';
    g.fillRect(p - 3, 0, 6, size);
    g.fillRect(0, p - 3, size, 6);
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.fillRect(p + 3, 0, 2, size);
    g.fillRect(0, p + 3, size, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Applied to every face of every block: darker toward the base (cheap ambient
// occlusion where blocks meet the floor) and a faint light edge on top.
export function panelTexture() {
  const size = 256;
  const [c, g] = canvas(size);
  const grad = g.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.72, '#f1f1f6');
  grad.addColorStop(1, '#a9abc2');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Soft round glow, used for sparks, floor glows and impact marks.
let _radial = null;
export function radialTexture() {
  if (_radial) return _radial;
  const size = 128;
  const [c, g] = canvas(size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  _radial = new THREE.CanvasTexture(c);
  return _radial;
}

// Fades from bright at one edge to nothing: light spilling across the floor.
export function spillTexture() {
  const [c, g] = canvas(64);
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
