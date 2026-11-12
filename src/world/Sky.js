import * as THREE from 'three';
import { PALETTE } from '../config.js';

// A night sky drawn by a shader on the inside of a big sphere:
// vertical gradient, sparse stars and an oversized moon.
export function createSky(moonDir) {
  const geo = new THREE.SphereGeometry(450, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(PALETTE.skyTop) },
      uHorizon: { value: new THREE.Color(PALETTE.skyHorizon) },
      uMoonDir: { value: moonDir.clone().normalize() },
      uMoonColor: { value: new THREE.Color(PALETTE.moon) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHorizon, uMoonDir, uMoonColor;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.08, 0.7, h), 0.55));
        col += uHorizon * 0.5 * exp(-abs(h) * 8.0);

        vec2 g = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * 70.0;
        vec2 id = floor(g);
        vec2 f = fract(g) - 0.5;
        float r = hash(id);
        float star = step(0.975, r) * smoothstep(0.16, 0.0, length(f)) * smoothstep(0.02, 0.35, h);
        col += star * (0.5 + 1.5 * hash(id + 7.0));

        float m = dot(d, uMoonDir);
        float disc = smoothstep(0.9958, 0.9964, m);
        float halo = pow(max(m, 0.0), 120.0) * 0.5 + pow(max(m, 0.0), 14.0) * 0.1;
        col += uMoonColor * (disc * 2.6 + halo);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
