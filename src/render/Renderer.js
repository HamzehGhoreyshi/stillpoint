import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PALETTE } from '../config.js';
import { createSky } from '../world/Sky.js';

// Draws the weapon on top of the world with its own camera, so the gun never
// clips into walls and keeps a fixed shape whatever the world FOV does.
class OverlayPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
  }
  render(renderer, writeBuffer, readBuffer) {
    const old = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = old;
  }
}

// Final colour treatment. `uFlow` is how fast time is moving: when the world
// freezes the image cools, loses colour and closes in at the edges.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uFlow: { value: 0 },
    uDamage: { value: 0 },
    uPulse: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uFlow, uDamage, uPulse;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float still = 1.0 - uFlow;
      float ca = 0.0012 + still * 0.0022 + uPulse * 0.006 + uDamage * 0.008;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ca).b;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // vivid things (enemies, dancers, party lights) keep their colour
      float sat = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
      float warm = max(smoothstep(0.02, 0.22, col.r - col.b), smoothstep(0.16, 0.45, sat));
      col = mix(col, vec3(l) * vec3(0.82, 0.96, 1.16), still * 0.5 * (1.0 - warm));
      float r = length(c * vec2(1.0, 0.85));
      float vig = smoothstep(0.86 - still * 0.14, 0.28, r);
      col *= mix(0.42, 1.0, vig);
      col += vec3(1.0, 0.42, 0.08) * uDamage * (1.0 - vig) * 1.4;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Renderer {
  constructor(canvas) {
    this.lite = matchMedia('(pointer: coarse)').matches; // phone / tablet
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.25;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(PALETTE.fog, 0.013);
    this.camera = new THREE.PerspectiveCamera(76, 1, 0.08, 600);
    this.camera.rotation.order = 'YXZ';

    // the gun lives in its own tiny scene
    this.weaponScene = new THREE.Scene();
    this.weaponCamera = new THREE.PerspectiveCamera(52, 1, 0.01, 10);

    this.setupLights();

    const target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.weaponPass = new OverlayPass(this.weaponScene, this.weaponCamera);
    this.composer.addPass(this.weaponPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.42, 0.7, 0.85);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setupLights() {
    // Strong, low moonlight is the only shadow-casting light.
    const moonDir = new THREE.Vector3(-0.52, 0.6, 0.6).normalize();
    this.moonDir = moonDir;
    const moon = new THREE.DirectionalLight(PALETTE.moon, 3.4);
    moon.position.copy(moonDir).multiplyScalar(70);
    moon.castShadow = true;
    const mapSize = this.lite ? 2048 : 4096;
    moon.shadow.mapSize.set(mapSize, mapSize);
    const sc = moon.shadow.camera;
    sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 10; sc.far = 140;
    moon.shadow.bias = -0.0004;
    moon.shadow.normalBias = 0.04;
    moon.shadow.radius = 2.5;
    this.scene.add(moon);
    this.scene.add(new THREE.HemisphereLight(0x6f8fe6, 0x1c1838, 1.15));

    this.sky = createSky(moonDir);
    this.scene.add(this.sky);

    // Reflections: bake the sky into an environment map once.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(createSky(moonDir));
    const env = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.7;
    pmrem.dispose();

    // the weapon gets its own flattering light rig
    this.weaponScene.environment = env;
    this.weaponScene.environmentIntensity = 1.0;
    const key = new THREE.DirectionalLight(0xdfe8ff, 2.6);
    key.position.set(-1.2, 1.6, 0.6);
    this.weaponScene.add(key);
    const rim = new THREE.DirectionalLight(PALETTE.accent, 0.9);
    rim.position.set(1.5, 0.2, -1);
    this.weaponScene.add(rim);
    this.weaponScene.add(new THREE.HemisphereLight(0x8fa6ee, 0x232042, 1.3));
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const pr = Math.min(devicePixelRatio || 1, this.lite ? 1.25 : 1.5);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.weaponCamera.aspect = w / h;
    this.weaponCamera.updateProjectionMatrix();
  }

  setGrade(flow, damage, pulse) {
    const u = this.grade.uniforms;
    u.uFlow.value = flow;
    u.uDamage.value = damage;
    u.uPulse.value = pulse;
  }

  render() {
    this.sky.position.copy(this.camera.position);
    this.composer.render();
  }
}
