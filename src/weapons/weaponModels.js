import * as THREE from 'three';
import { PALETTE } from '../config.js';

// The three gun models. Each builder fills a group and returns the handful
// of things the Weapon class animates:
//   slide     - the part that snaps back on every shot (slide / bolt handle)
//   mag       - the magazine, dropped and replaced during a reload
//   muzzle    - where the flash appears
//   hold      - where the gun sits on screen
//
// Models are drawn as side-view outlines (x = toward the muzzle, y = up),
// extruded to a thickness, then turned so the muzzle points forward (-Z).

const MAT = {
  ivory: new THREE.MeshStandardMaterial({ color: PALETTE.ivory, roughness: 0.36, metalness: 0.05, flatShading: true }),
  brass: new THREE.MeshStandardMaterial({ color: PALETTE.brass, roughness: 0.28, metalness: 0.95, flatShading: true }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1a1e30, roughness: 0.55, metalness: 0.3, flatShading: true }),
  wood: new THREE.MeshStandardMaterial({ color: 0x9a5524, roughness: 0.6, metalness: 0, flatShading: true }),
  accent: new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent).multiplyScalar(1.6) }),
  lens: new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent).multiplyScalar(0.22) }),
};

function profile(points, width, bevel = 0.003) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1,
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

// Small helpers that place parts using side-view coordinates.
function kit(model) {
  const solid = (points, width, mat, parent = model) => {
    const m = new THREE.Mesh(profile(points, width), mat);
    parent.add(m);
    return m;
  };
  const box = (len, h, w, x, y, mat, parent = model) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), mat);
    m.position.set(0, y, -x);
    parent.add(m);
    return m;
  };
  const tube = (r, len, x, y, mat, parent = model, sides = 8) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, sides), mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(0, y, -x);
    parent.add(m);
    return m;
  };
  const group = (parent = model) => {
    const g = new THREE.Group();
    parent.add(g);
    return g;
  };
  return { solid, box, tube, group };
}

export function buildPistol(model) {
  const { solid, box, tube, group } = kit(model);
  const slide = group();
  solid([[0, 0.002], [0.31, 0.002], [0.31, 0.036], [0.292, 0.06], [0.03, 0.06], [0, 0.042]], 0.052, MAT.ivory, slide);
  for (let i = 0; i < 5; i++) box(0.004, 0.034, 0.054, 0.028 + i * 0.011, 0.032, MAT.dark, slide);
  box(0.15, 0.004, 0.0545, 0.19, 0.03, MAT.accent, slide);
  box(0.012, 0.01, 0.006, 0.292, 0.064, MAT.accent, slide);
  box(0.01, 0.01, 0.008, 0.02, 0.064, MAT.dark, slide).position.x = -0.013;
  box(0.01, 0.01, 0.008, 0.02, 0.064, MAT.dark, slide).position.x = 0.013;

  solid([[0.005, 0], [0.305, 0], [0.305, -0.02], [0.27, -0.034], [0.1, -0.034], [0.062, -0.168], [-0.028, -0.152], [0, -0.04]], 0.046, MAT.ivory);
  box(0.05, 0.085, 0.049, 0.035, -0.098, MAT.dark).rotation.x = -0.27;
  box(0.075, 0.007, 0.018, 0.142, -0.086, MAT.brass);
  box(0.007, 0.052, 0.018, 0.178, -0.06, MAT.brass);
  box(0.008, 0.034, 0.01, 0.128, -0.054, MAT.brass).rotation.x = 0.3;
  tube(0.012, 0.03, 0.318, 0.03, MAT.brass);

  const mag = group();
  mag.rotation.x = -0.27;
  mag.position.set(0, -0.1, -0.03);
  box(0.04, 0.14, 0.03, 0, 0, MAT.brass, mag);
  box(0.05, 0.012, 0.036, 0, -0.076, MAT.dark, mag);

  model.position.set(0, 0.09, 0.02);
  return {
    slide, mag, slideTravel: 0.036, slideTime: 0.11, locksOpen: true,
    magDrop: [0, -0.24, 0.066], muzzle: [0, 0.03, -0.34],
    hold: [0.118, -0.255, -0.47], scale: 0.86, flashSize: 1,
  };
}

// An AK-pattern automatic rifle: curved magazine, wooden furniture.
export function buildRifle(model) {
  const { solid, box, tube, group } = kit(model);
  box(0.27, 0.062, 0.044, 0.135, 0, MAT.ivory); // receiver
  solid([[0, 0.031], [0.25, 0.031], [0.25, 0.05], [0.22, 0.058], [0.03, 0.058], [0, 0.045]], 0.04, MAT.ivory); // top cover
  box(0.03, 0.02, 0.03, 0.262, 0.05, MAT.dark); // rear sight
  box(0.13, 0.004, 0.0455, 0.11, 0.004, MAT.accent); // glowing seam
  box(0.2, 0.042, 0.05, 0.37, -0.004, MAT.wood); // handguard
  box(0.17, 0.026, 0.04, 0.36, 0.04, MAT.wood); // gas tube cover
  tube(0.0095, 0.32, 0.62, 0.006, MAT.dark); // barrel
  tube(0.008, 0.1, 0.5, 0.04, MAT.dark); // gas tube
  box(0.03, 0.058, 0.03, 0.485, 0.022, MAT.dark); // gas block
  box(0.018, 0.07, 0.012, 0.71, 0.036, MAT.dark); // front sight post
  box(0.006, 0.012, 0.005, 0.71, 0.076, MAT.accent);
  tube(0.014, 0.05, 0.8, 0.006, MAT.brass); // muzzle brake
  solid([[0.03, -0.031], [0.085, -0.031], [0.06, -0.15], [0, -0.14]], 0.036, MAT.wood); // grip
  box(0.075, 0.006, 0.016, 0.125, -0.075, MAT.dark); // trigger guard
  box(0.007, 0.03, 0.01, 0.115, -0.05, MAT.brass).rotation.x = 0.3;
  solid([[0, 0.03], [0, -0.031], [-0.05, -0.04], [-0.3, -0.095], [-0.33, -0.09], [-0.33, 0], [-0.3, 0.012], [-0.05, 0.03]], 0.036, MAT.wood); // stock

  const slide = group(); // charging handle on the right side
  box(0.03, 0.012, 0.03, 0.17, 0.03, MAT.brass, slide).position.x = 0.032;

  const mag = group(); // the curved "banana" magazine
  solid([[0.15, -0.03], [0.215, -0.03], [0.25, -0.12], [0.295, -0.2], [0.235, -0.228], [0.19, -0.135]], 0.03, MAT.dark, mag);
  solid([[0.238, -0.208], [0.292, -0.188], [0.3, -0.204], [0.24, -0.232]], 0.034, MAT.brass, mag);

  model.position.set(0, 0.05, 0.02);
  return {
    slide, mag, slideTravel: 0.055, slideTime: 0.07, locksOpen: false,
    magDrop: [0, -0.22, 0.1], muzzle: [0, 0.006, -0.84],
    hold: [0.118, -0.2, -0.4], scale: 0.7, flashSize: 1.25,
  };
}

// A long bolt-action rifle with a scope (right click to look through it).
export function buildSniper(model) {
  const { solid, box, tube, group } = kit(model);
  solid([[0, 0.03], [0.42, 0.03], [0.42, -0.012], [0.3, -0.032], [0, -0.032]], 0.046, MAT.ivory); // body
  box(0.2, 0.004, 0.0475, 0.2, 0.004, MAT.accent);
  box(0.22, 0.03, 0.04, 0.5, -0.008, MAT.ivory); // fore-end
  tube(0.011, 0.52, 0.68, 0.012, MAT.dark); // barrel
  box(0.07, 0.032, 0.038, 0.96, 0.012, MAT.brass); // muzzle brake
  box(0.012, 0.04, 0.03, 0.945, 0.012, MAT.dark);

  // scope
  tube(0.023, 0.26, 0.2, 0.088, MAT.dark, model, 10);
  tube(0.032, 0.06, 0.05, 0.088, MAT.dark, model, 10);
  tube(0.035, 0.08, 0.35, 0.088, MAT.dark, model, 10);
  box(0.02, 0.034, 0.02, 0.13, 0.052, MAT.brass);
  box(0.02, 0.034, 0.02, 0.27, 0.052, MAT.brass);
  box(0.024, 0.022, 0.024, 0.2, 0.118, MAT.brass);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.027, 12), MAT.lens);
  lens.position.set(0, 0.088, -0.019);
  model.add(lens);

  solid([[0, 0.03], [0, -0.032], [-0.08, -0.05], [-0.3, -0.09], [-0.34, -0.085], [-0.34, 0.02], [-0.12, 0.036]], 0.04, MAT.ivory); // stock
  box(0.14, 0.02, 0.036, -0.2, 0.034, MAT.dark); // cheek rest
  solid([[0.03, -0.032], [0.085, -0.032], [0.06, -0.15], [0, -0.14]], 0.036, MAT.dark); // grip
  box(0.075, 0.006, 0.016, 0.125, -0.075, MAT.dark);

  const slide = group(); // bolt handle
  box(0.014, 0.012, 0.05, 0.1, 0.014, MAT.dark, slide).position.x = 0.04;
  const knob = new THREE.Mesh(new THREE.OctahedronGeometry(0.014, 0), MAT.brass);
  knob.position.set(0.068, 0.014, -0.1);
  slide.add(knob);

  const mag = group();
  box(0.075, 0.07, 0.03, 0.21, -0.062, MAT.dark, mag);

  model.position.set(0, 0.04, 0.02);
  return {
    slide, mag, slideTravel: 0.06, slideTime: 0.4, locksOpen: false,
    magDrop: [0, -0.2, 0], muzzle: [0, 0.012, -1.0],
    hold: [0.118, -0.2, -0.42], scale: 0.68, flashSize: 1.6,
  };
}

export const BUILDERS = { pistol: buildPistol, rifle: buildRifle, sniper: buildSniper };
