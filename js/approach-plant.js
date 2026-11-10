/* Newaz Clinical Consulting, How We Work Together. Round 5.
   A pinned, scroll-driven stage. A plant grows with the scroll (three.js r160, vendored, through the import map),
   keeping the character Shai liked in round 4: one stem, leaves. It is drawn in the site's line-and-light
   language: dark bodies, glowing outlines, midribs and veins, a rim of sky light, gold where it matters, bloom.

   Four milestones. As the growth front reaches each one, a leaf opens (the last time, the bud at the tip opens
   into a blossom), a wave of gold light runs from its base to its tip, it glows, and that step takes the stage:
   its numeral, its verb set very large, the rest of its line beneath. The camera rises and eases around the
   plant as it grows, so it reads as a living, dimensional thing. The plant frames itself into the free part of
   the stage (beside the text on desktop, above it on phones).

   Modes, chosen here and expressed as classes on the section:
   - .is-pinned  the stage (default when WebGL works and motion is allowed)
   - .is-still   reduced motion: one still frame of the grown plant beside all four steps
   - neither     no WebGL or this module failed: the four steps in order, as plain text
   Text: the step copy is split by text-reveal.js; this module only says which step is on stage
   (window.NCCText.reveal / .hide), through data-reveal-owner on the list.
   This file does not import from, or touch, the hero (hero-tree.js, tree-gen.js).
   ?plant-debug exposes window.__nccPlant.seek(progress 0..1) and .fps(). */
// @ts-check
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const root = document.documentElement;
const section = /** @type {HTMLElement | null} */ (document.querySelector('[data-approach]'));
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const debug = /[?&]plant-debug\b/.test(location.search);

/** @param {number} v @param {number} a @param {number} b */
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
/** @param {number} a @param {number} b @param {number} x */
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** @param {number} a @param {number} b @param {number} t */
const lerp = (a, b, t) => a + (b - a) * t;
/** @param {number} seed */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ---------- Colors, from the CSS tokens ---------- */
/** @param {string} name @param {string} fallback */
function token(name, fallback) {
  const v = getComputedStyle(root).getPropertyValue(name).trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}
const HEX = {
  gold: token('--c-saif', '#F8C426'),
  sky: token('--c-biscuit', '#6BCCE0'),
  white: token('--c-white', '#FFFFFF'),
  ayanna: token('--c-ayanna', '#2D2E8B'),
  kaia: token('--c-kaia', '#121237')
};
/** sRGB hex to a linear THREE.Color @param {string} hex */
const col = (hex) => new THREE.Color(hex);
/** mix two hex colors in sRGB @param {string} a @param {string} b @param {number} t */
function mixHex(a, b, t) {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const ch = (/** @type {number} */ s) => Math.round(((x >> s) & 255) + ((((y >> s) & 255) - ((x >> s) & 255)) * t));
  return '#' + [16, 8, 0].map((s) => ('0' + ch(s).toString(16)).slice(-2)).join('');
}

/* ---------- The plant's plan ---------- */
const HEIGHT = 10;
// the stem: a gentle S, a little depth so the turn of the camera shows it
const STEM_PTS = [
  [0, 0, 0], [0.22, 1.4, 0.12], [-0.12, 2.9, -0.18], [-0.28, 4.3, 0.02], [0.05, 5.8, 0.2],
  [0.3, 7.2, 0.02], [0.08, 8.6, -0.16], [-0.04, HEIGHT, 0]
].map((p) => new THREE.Vector3(p[0], p[1], p[2]));
// the three milestone leaves, then the bud at the tip; u is the place on the stem, 0 base to 1 tip
const GOLDEN = 2.39996;
const MILESTONES = [
  { u: 0.27, az: 0.35, size: 1.45 },
  { u: 0.5, az: 0.35 + GOLDEN * 1.5, size: 1.38 },
  { u: 0.73, az: 0.35 + GOLDEN * 3, size: 1.28 }
];
// small leaves in between, for a fuller plant
const SMALL = [
  { u: 0.1, az: 2.6, size: 0.66 }, { u: 0.17, az: 5.4, size: 0.5 }, { u: 0.36, az: 4.9, size: 0.8 },
  { u: 0.42, az: 2.0, size: 0.55 }, { u: 0.6, az: 1.4, size: 0.78 }, { u: 0.66, az: 4.3, size: 0.52 },
  { u: 0.84, az: 3.9, size: 0.64 }, { u: 0.91, az: 0.6, size: 0.48 }
];
// growth front at which each step is "reached" (its leaf fully open), and the tip
const OPEN_AT = [0.36, 0.59, 0.82, 1];

/* ---------- Shaders ---------- */
const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// stem: dark body, sky rim light, a gold growth front, and small lights rising like sap
const STEM_FRAG = /* glsl */ `
uniform float uGrow;
uniform float uTime;
uniform vec3 uBody;
uniform vec3 uRim;
uniform vec3 uGold;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  float u = vUv.x;
  if (u > uGrow) discard;
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float fr = pow(1.0 - abs(dot(n, normalize(vV))), 2.4);
  vec3 c = uBody * (0.55 + 0.45 * (1.0 - fr)) + uRim * fr * 1.25;
  // a fine light along the stem's length, the line in the line art
  float seam = exp(-pow((vUv.y - 0.25) * 22.0, 2.0)) + exp(-pow((vUv.y - 0.75) * 22.0, 2.0));
  c += uRim * seam * 0.22;
  float front = exp(-pow((uGrow - u) * 34.0, 2.0));
  c += uGold * front * 2.6;
  float sap = exp(-pow((fract(u * 2.2 - uTime * 0.11) - 0.5) * 26.0, 2.0)) * smoothstep(0.02, 0.12, uGrow - u);
  c += mix(uRim, uGold, 0.5) * sap * (0.35 + fr);
  gl_FragColor = vec4(c, 1.0);
}`;

// leaf and petal: glowing outline, midrib and veins over a dark blade; turns gold when it is the step on stage
const LEAF_FRAG = /* glsl */ `
uniform vec3 uBody;
uniform vec3 uLine;
uniform vec3 uGold;
uniform float uOpen;
uniform float uGlow;
uniform float uWave;
uniform float uTime;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  float s = vUv.x;
  float t = vUv.y;
  float at = abs(t);
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float fr = pow(1.0 - abs(dot(n, normalize(vV))), 2.0);
  float aa = fwidth(t) * 1.5;
  float edge = smoothstep(1.0 - aa - 0.05, 1.0 - aa * 0.3, at);
  float rib = (1.0 - smoothstep(0.0, aa + 0.035, at)) * smoothstep(0.0, 0.04, s) * (1.0 - smoothstep(0.86, 1.0, s));
  float vf = abs(fract(s * 6.5 - at * 1.7) - 0.5);
  float vein = (1.0 - smoothstep(0.0, fwidth(s * 6.5 - at * 1.7) * 1.4 + 0.012, vf - 0.0)) ;
  vein *= smoothstep(0.08, 0.3, at) * (1.0 - smoothstep(0.82, 0.96, at)) * smoothstep(0.05, 0.2, s) * (1.0 - smoothstep(0.85, 0.98, s));
  vec3 line = mix(uLine, uGold, uGlow);
  float lines = edge * 1.25 + rib * 1.1 + vein * 0.5;
  vec3 c = uBody * (0.62 + 0.38 * fr) + line * lines * (0.45 + 0.55 * uOpen) + line * fr * 0.28;
  // a wave of light from base to tip, once, as the step arrives
  float w = exp(-pow((s - uWave) * 6.0, 2.0)) * step(-0.2, uWave) * (1.0 - step(1.25, uWave));
  c += uGold * w * (0.35 + lines * 1.6);
  c += uGold * uGlow * (0.1 + 0.08 * sin(uTime * 1.6));
  gl_FragColor = vec4(c, 1.0);
}`;

// drifting motes, the site's one particle: a white core in a colored point
const MOTE_VERT = /* glsl */ `
attribute float aSeed;
attribute vec3 aColor;
uniform float uTime;
uniform float uTop;
uniform float uPx;
varying vec3 vColor;
varying float vA;
void main() {
  vec3 p = position;
  float speed = 0.12 + fract(aSeed * 7.13) * 0.22;
  p.y = mod(p.y + uTime * speed, ${(HEIGHT + 2.5).toFixed(1)}) - 0.6;
  float a = uTime * (0.15 + fract(aSeed * 3.7) * 0.2) + aSeed * 6.28;
  p.x += sin(a) * 0.35;
  p.z += cos(a * 0.8) * 0.35;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.55 + 0.45 * sin(uTime * (1.2 + fract(aSeed * 5.1) * 1.6) + aSeed * 40.0);
  vA = tw * (1.0 - smoothstep(uTop + 0.5, uTop + 2.4, p.y)) * smoothstep(-0.6, 0.6, p.y);
  vColor = aColor;
  gl_PointSize = uPx * (0.6 + fract(aSeed * 11.0) * 0.9) / -mv.z;
}`;
const MOTE_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vA;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = dot(q, q);
  if (d > 1.0) discard;
  float core = exp(-d * 18.0);
  float halo = exp(-d * 3.5) * 0.45;
  gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.8) * (core + halo) * vA, 1.0);
}`;

/* ---------- Geometry ---------- */
/** A tapered tube along a curve. uv.x runs base to tip, uv.y around.
    @param {THREE.Curve<THREE.Vector3>} curve @param {number} segs @param {number} radial @param {number} r0 @param {number} r1 */
function taperedTube(curve, segs, radial, r0, r1) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], uv = [], idx = [];
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    curve.getPointAt(u, P);
    const r = lerp(r0, r1, Math.pow(u, 0.7));
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2;
      N.copy(frames.normals[i]).multiplyScalar(-Math.cos(v)).addScaledVector(frames.binormals[i], Math.sin(v)).normalize();
      pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r);
      nor.push(N.x, N.y, N.z);
      uv.push(u, j / radial);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = (i + 1) * (radial + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** A leaf blade along +Y. Width along Z, folded along its midrib, its tip drooping toward +X (down and out
    once the leaf tilts). uv.x runs base to tip, uv.y across, -1 to 1.
    @param {{len: number, wid: number, fold: number, droop: number, segL?: number, segW?: number}} o */
function leafGeometry(o) {
  const segL = o.segL || 36, segW = o.segW || 14;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segL; i++) {
    const s = i / segL;
    const hw = o.wid * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.78)), 0.9) * (1 - 0.18 * s);
    for (let j = 0; j <= segW; j++) {
      const t = (j / segW) * 2 - 1;
      const x = -o.fold * Math.abs(t) * hw + o.droop * s * s * o.len;
      pos.push(x, s * o.len, t * hw);
      uv.push(s, t);
    }
  }
  for (let i = 0; i < segL; i++) {
    for (let j = 0; j < segW; j++) {
      const a = i * (segW + 1) + j, b = (i + 1) * (segW + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------- Boot ---------- */
/* Vera fixes: probe WebGL once, before any renderer exists, and share the answer with hero-tree.js
   (window.__nccWebGL). Without it three.js logs "A WebGL context could not be created" for each renderer it tries.
   The probe context is released at once, so it never counts against the browser's context limit. */
function hasWebGL() {
  const g = /** @type {{__nccWebGL?: boolean}} */ (/** @type {unknown} */ (window));
  if (typeof g.__nccWebGL === 'boolean') return g.__nccWebGL;
  let ok = false;
  try {
    const c = document.createElement('canvas');
    const ctx = /** @type {WebGLRenderingContext | null} */ (c.getContext('webgl2') || c.getContext('webgl'));
    ok = !!ctx;
    const lose = ctx && ctx.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch (e) { ok = false; }
  g.__nccWebGL = ok;
  return ok;
}

if (section && !root.classList.contains('no-gl') && hasWebGL()) {
  try { boot(section); } catch (err) {
    section.classList.remove('is-pinned', 'is-still');
    console.warn('How We Work Together: falling back to the plain steps.', err);
  }
}

/** @param {HTMLElement} sec */
function boot(sec) {
  const stageEl = /** @type {HTMLElement} */ (sec.querySelector('[data-approach-stage], .approach__stage'));
  const list = /** @type {HTMLElement} */ (sec.querySelector('[data-steps]'));
  const steps = /** @type {HTMLElement[]} */ (Array.from(sec.querySelectorAll('[data-step]')));
  const ticks = /** @type {HTMLElement[]} */ (Array.from(sec.querySelectorAll('[data-approach-ticks] li, .approach__ticks li')));
  const track = /** @type {HTMLElement} */ (sec.querySelector('[data-approach-track], .approach__track'));
  const titleEl = /** @type {HTMLElement} */ (sec.querySelector('[data-approach-title], .approach__title'));
  /** @type {{reveal: (el: Element) => void, hide: (el: Element) => void, split?: (el: Element) => boolean} | undefined} */
  const T = /** @type {any} */ (window).NCCText;
  const still = reduce;
  const small = () => window.innerWidth < 960;

  sec.classList.add(still ? 'is-still' : 'is-pinned');
  if (!still) list.setAttribute('data-reveal-owner', '');

  /* renderer */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  // r160 clears the composer's (linear) render target with the color converted to the OUTPUT space, so the
  // clear color is decoded once more here; OutputPass's single encode then lands exactly on --c-kaia.
  const ground = col(HEX.kaia).convertSRGBToLinear();
  renderer.setClearColor(ground, 1);
  stageEl.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);

  /* stem */
  const curve = new THREE.CatmullRomCurve3(STEM_PTS, false, 'centripetal');
  const stemU = {
    uGrow: { value: 0 }, uTime: { value: 0 },
    uBody: { value: col(mixHex(HEX.ayanna, HEX.kaia, 0.35)) },
    uRim: { value: col(HEX.sky) }, uGold: { value: col(HEX.gold) }
  };
  const stem = new THREE.Mesh(taperedTube(curve, 260, 14, 0.17, 0.035), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: STEM_FRAG, uniforms: stemU, side: THREE.DoubleSide }));
  scene.add(stem);

  /* leaves */
  const bodyLeaf = col(mixHex(HEX.ayanna, HEX.kaia, 0.5));
  /** @typedef {{pivot: THREE.Object3D, tilt: THREE.Object3D, u: THREE.IUniform<number>[], uni: Record<string, THREE.IUniform<any>>, at: number, open: number, glow: number, glowTo: number, waveAt: number, closed: number, opened: number}} Leaf */
  /** @type {Leaf[]} */
  const leaves = [];
  /** @param {{u: number, az: number, size: number}} d @param {boolean} big */
  function addLeaf(d, big) {
    const geo = leafGeometry({ len: 2.05 * d.size, wid: 0.56 * d.size, fold: 0.38, droop: big ? 0.16 : 0.12 });
    const uni = {
      uBody: { value: bodyLeaf }, uLine: { value: col(HEX.sky) }, uGold: { value: col(HEX.gold) },
      uOpen: { value: 0 }, uGlow: { value: 0 }, uWave: { value: -1 }, uTime: stemU.uTime
    };
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: LEAF_FRAG, uniforms: uni, side: THREE.DoubleSide, extensions: { derivatives: true } }));
    const pivot = new THREE.Object3D();
    const tilt = new THREE.Object3D();
    pivot.position.copy(curve.getPointAt(d.u));
    pivot.rotation.y = d.az;
    tilt.add(mesh);
    pivot.add(tilt);
    pivot.scale.setScalar(0.001);
    scene.add(pivot);
    const leaf = { pivot, tilt, u: [], uni, at: d.u, open: 0, glow: 0, glowTo: 0, waveAt: -1, closed: 0.1, opened: big ? 0.98 : 1.06 };
    leaves.push(leaf);
    return leaf;
  }
  const milestoneLeaves = MILESTONES.map((d) => addLeaf(d, true));
  SMALL.forEach((d) => addLeaf(d, false));

  /* the bud at the tip: six petals that open into a blossom for the last step */
  const tip = curve.getPointAt(1);
  const tipDir = curve.getTangentAt(1);
  const bud = new THREE.Object3D();
  bud.position.copy(tip);
  bud.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tipDir);
  scene.add(bud);
  const budUni = {
    uBody: { value: col(mixHex(HEX.ayanna, HEX.kaia, 0.3)) }, uLine: { value: col(HEX.sky) }, uGold: { value: col(HEX.gold) },
    uOpen: { value: 0 }, uGlow: { value: 0 }, uWave: { value: -1 }, uTime: stemU.uTime
  };
  const petalGeo = leafGeometry({ len: 0.95, wid: 0.36, fold: 0.5, droop: -0.05, segL: 24, segW: 10 });
  const petalMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: LEAF_FRAG, uniforms: budUni, side: THREE.DoubleSide, extensions: { derivatives: true } });
  /** @type {THREE.Object3D[]} */
  const petals = [];
  for (let k = 0; k < 6; k++) {
    const p = new THREE.Object3D();
    p.rotation.y = (k / 6) * Math.PI * 2 + 0.3;
    const t = new THREE.Object3D();
    t.add(new THREE.Mesh(petalGeo, petalMat));
    p.add(t);
    bud.add(p);
    petals.push(t);
  }
  bud.scale.setScalar(0.001);

  /* light: a gold core in the blossom, and the growth front */
  const spriteTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(255,255,255,0.7)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const glowMat = (/** @type {string} */ hex) => new THREE.SpriteMaterial({ map: spriteTex, color: col(hex), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
  const core = new THREE.Sprite(glowMat(HEX.gold));
  core.position.copy(tip).addScaledVector(tipDir, 0.18);
  scene.add(core);
  const front = new THREE.Sprite(glowMat(HEX.gold));
  scene.add(front);
  const seed = new THREE.Sprite(glowMat(HEX.sky));
  seed.position.set(0, 0.02, 0);
  seed.scale.setScalar(2.2);
  scene.add(seed);

  /* ground: three fine rings of light where the plant stands */
  const ringGroup = new THREE.Group();
  [0.9, 1.7, 2.7].forEach((r, i) => {
    const pts = [];
    for (let k = 0; k <= 128; k++) { const a = (k / 128) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col(HEX.sky), transparent: true, opacity: [0.5, 0.26, 0.12][i], blending: THREE.AdditiveBlending, depthWrite: false }));
    ringGroup.add(line);
  });
  scene.add(ringGroup);

  /* motes */
  const MOTES = small() ? 70 : 150;
  const r = rng(53);
  const mp = new Float32Array(MOTES * 3), ms = new Float32Array(MOTES), mc = new Float32Array(MOTES * 3);
  const sky = col(HEX.sky), gold = col(HEX.gold);
  for (let i = 0; i < MOTES; i++) {
    const a = r() * Math.PI * 2, rad = 0.6 + Math.pow(r(), 0.7) * 3.4;
    mp[i * 3] = Math.cos(a) * rad; mp[i * 3 + 1] = r() * (HEIGHT + 2.5); mp[i * 3 + 2] = Math.sin(a) * rad;
    ms[i] = r();
    const c = r() < 0.28 ? gold : sky;
    mc[i * 3] = c.r; mc[i * 3 + 1] = c.g; mc[i * 3 + 2] = c.b;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(ms, 1));
  moteGeo.setAttribute('aColor', new THREE.BufferAttribute(mc, 3));
  const moteU = { uTime: stemU.uTime, uTop: { value: 0 }, uPx: { value: 60 } };
  const motes = new THREE.Points(moteGeo, new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: moteU, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  motes.frustumCulled = false;
  scene.add(motes);

  /* post: bloom, the hero's glow */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // the still frame is a small canvas, where a full-strength bloom would lift the whole ground
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), still ? 0.45 : 0.85, 0.55, still ? 0.42 : 0.32);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* ---------- Layout: the plant frames itself into the free part of the stage ---------- */
  const L = { W: 1, H: 1, cx: 0.5, cy: 0.5, aw: 1, ah: 1 };
  function layout() {
    const rect = stageEl.getBoundingClientRect();
    L.W = Math.max(1, Math.round(rect.width));
    L.H = Math.max(1, Math.round(rect.height));
    const dprCap = small() ? 1.5 : 1.6;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    renderer.setPixelRatio(dpr);
    renderer.setSize(L.W, L.H, false);
    composer.setPixelRatio(dpr);
    composer.setSize(L.W, L.H);
    // the free area for the plant, in stage pixels
    if (still) {
      L.cx = L.W / 2; L.cy = L.H / 2; L.aw = L.W; L.ah = L.H;
    } else if (!small()) {
      // between the step text and the container's right edge (plus a little of the gutter)
      const lr = list.getBoundingClientRect();
      const gridEl = /** @type {HTMLElement} */ (sec.querySelector('[data-approach-grid], .approach__grid'));
      const gr = gridEl.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(gridEl).paddingRight) || 0;
      const left = Math.min(lr.left + lr.width * 0.72, gr.left + gr.width * 0.5) - rect.left;
      const right = Math.min(L.W, gr.right - pad * 0.4 - rect.left);
      L.aw = right - left; L.cx = left + L.aw * 0.55;
      const top = (titleEl.getBoundingClientRect().bottom - rect.top) + 8;
      L.ah = L.H - top - L.H * 0.04; L.cy = top + L.ah / 2;
    } else {
      const top = titleEl.getBoundingClientRect().bottom - rect.top + 6;
      const bottom = list.getBoundingClientRect().top - rect.top - 6;
      L.aw = L.W; L.cx = L.W / 2;
      L.ah = Math.max(120, bottom - top); L.cy = top + L.ah / 2;
    }
    camera.aspect = L.W / L.H;
    camera.setViewOffset(L.W, L.H, L.W / 2 - L.cx, L.H / 2 - L.cy, L.W, L.H);
    camera.updateProjectionMatrix();
    moteU.uPx.value = (small() ? 70 : 90) * dpr;
    dirty = true;
  }

  /* ---------- State ---------- */
  let progress = 0;   // scroll, 0..1 through the track
  let gTarget = 0.03, gShown = still ? 1 : 0.03;
  let active = -1, shownActive = -1;
  let time = 0, last = performance.now();
  let visible = false, raf = 0, dirty = true;
  let frames = 0, slow = 0;
  const camState = { y: 2, d: 18, az: -0.5 };

  /** progress → growth target and the step on stage. Each of the four beats grows for its first 48%
      to that step's milestone, then holds while the step is read. @param {number} p */
  function plan(p) {
    const beat = clamp(p, 0, 0.9999) * 4;
    const i = Math.floor(beat), f = beat - i;
    const from = i === 0 ? 0.03 : OPEN_AT[i - 1];
    const to = OPEN_AT[i];
    gTarget = lerp(from, to, smooth(0, 0.48, f));
    // the step takes the stage as its leaf begins to open
    active = i === 0 ? 0 : (f > 0.22 ? i : i - 1);
  }

  function setActive() {
    if (active === shownActive) return;
    const prev = shownActive;
    shownActive = active;
    // Vera fixes: a step's text settles to plain flowing text once it has risen (text-reveal.js, WCAG 1.4.12). Split
    // it again before is-past moves its lines out, or there would be nothing to animate.
    if (T && T.split) steps.forEach((s) => s.querySelectorAll('[data-split]').forEach((el) => { T.split && T.split(el); }));
    steps.forEach((s, i) => {
      const verb = s.querySelector('[data-step-verb], .step__verb'), rest = s.querySelector('[data-step-rest], .step__rest');
      s.classList.toggle('is-active', i === active);
      s.classList.toggle('is-past', i < active);
      if (i <= active) { if (verb && T) T.reveal(verb); if (rest && T) T.reveal(rest); }
      else { if (verb && T) T.hide(verb); if (rest && T) T.hide(rest); }
    });
    ticks.forEach((t, i) => { t.classList.toggle('is-on', i < active); t.classList.toggle('is-now', i === active); });
    // a wave of gold light runs up the new step's leaf (or through the blossom), once
    if (active > prev) {
      if (active < 3) milestoneLeaves[active].waveAt = time;
      else budWaveAt = time;
    }
  }
  let budWaveAt = -10;

  function readScroll() {
    const rect = track.getBoundingClientRect();
    const vh = window.innerHeight;
    progress = clamp(-rect.top / Math.max(1, rect.height - vh), 0, 1);
    plan(progress);
    if (rect.top < vh * 0.6) setActive();
  }

  /* ---------- Frame ---------- */
  /** @param {number} dt */
  function step(dt) {
    const k = 1 - Math.exp(-dt * (still ? 100 : 4.2));
    gShown += (gTarget - gShown) * k;
    const g = gShown;
    stemU.uGrow.value = g;
    stemU.uTime.value = time;

    // leaves open as the growth front passes them
    leaves.forEach((lf, i) => {
      const o = smooth(lf.at + 0.005, lf.at + 0.085, g);
      lf.open = o;
      const s = Math.max(0.001, Math.pow(o, 0.8));
      lf.pivot.scale.setScalar(s);
      // swing out from along the stem, with a soft overshoot as it settles
      const sw = o < 1 ? o + Math.sin(o * Math.PI) * 0.12 : 1;
      lf.tilt.rotation.z = -lerp(lf.closed, lf.opened, sw) - Math.sin(time * 0.7 + i * 1.3) * 0.025 * o;
      lf.uni.uOpen.value = o;
      const mi = milestoneLeaves.indexOf(lf);
      lf.glowTo = mi < 0 ? 0 : (mi === shownActive ? 1 : (mi < shownActive ? 0.28 : 0));
      lf.glow += (lf.glowTo - lf.glow) * (1 - Math.exp(-dt * 2.4));
      lf.uni.uGlow.value = still ? (mi < 0 ? 0 : 0.5) : lf.glow;
      lf.uni.uWave.value = lf.waveAt >= 0 ? (time - lf.waveAt) * 0.95 - 0.15 : -1;
    });

    // the bud forms near the tip, then opens into a blossom for the last step
    const budIn = smooth(0.9, 0.985, g);
    const bloomOpen = still ? 1 : smooth(0.985, 1, g) * (shownActive >= 3 ? 1 : 0.15);
    bud.scale.setScalar(Math.max(0.001, budIn * 0.95));
    budOpen += (bloomOpen - budOpen) * (1 - Math.exp(-dt * 2.2));
    petals.forEach((p, k) => { p.rotation.z = -lerp(0.12, 1.05 + (k % 2) * 0.1, budOpen) - Math.sin(time * 0.9 + k) * 0.02 * budOpen; });
    budUni.uOpen.value = budIn;
    budUni.uGlow.value = still ? 0.8 : budOpen;
    budUni.uWave.value = (time - budWaveAt) * 1.1 - 0.15;
    core.material.opacity = 0.95 * budOpen;
    core.scale.setScalar(0.6 + 1.6 * budOpen + 0.1 * Math.sin(time * 1.8) * budOpen);

    // the growth front: a small gold light that climbs with the stem
    const fp = curve.getPointAt(clamp(g, 0, 1));
    front.position.copy(fp);
    front.material.opacity = still ? 0 : (1 - smooth(0.97, 1, g)) * 0.9;
    front.scale.setScalar(0.55 + 0.08 * Math.sin(time * 3));
    seed.material.opacity = 0.35 + 0.1 * Math.sin(time * 1.2);

    moteU.uTop.value = fp.y;

    // camera: rises with the plant, frames what has grown, and turns slowly around it
    const top = fp.y;
    const hFrame = Math.max(5.2, top + 2.4);
    const yC = hFrame / 2 - 0.55;
    const fovV = THREE.MathUtils.degToRad(camera.fov);
    const needH = (hFrame * (L.H / L.ah)) / 2 / Math.tan(fovV / 2);
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);
    const needW = (6.2 * (L.W / L.aw)) / 2 / Math.tan(fovH / 2);
    const dGoal = Math.max(needH, needW) * 1.04;
    const ck = still ? 1 : 1 - Math.exp(-dt * 3.2);
    camState.y += (yC - camState.y) * ck;
    camState.d += (dGoal - camState.d) * ck;
    camState.az = -0.55 + g * 1.5 + (still ? 0 : Math.sin(time * 0.21) * 0.06);
    const elev = 0.16;
    camera.position.set(Math.sin(camState.az) * camState.d, camState.y + camState.d * elev, Math.cos(camState.az) * camState.d);
    camera.lookAt(0, camState.y, 0);
  }
  let budOpen = 0;

  function render() { composer.render(); }

  /** @param {number} now */
  function loop(now) {
    raf = 0;
    if (!visible || document.hidden) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    if (dt > 0.0205) slow++;
    last = now;
    time += dt;
    step(dt);
    render();
    frames++;
    raf = requestAnimationFrame(loop);
  }
  function sync() {
    const run = visible && !document.hidden && !still;
    if (run && !raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    else if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  /* ---------- Wire up ---------- */
  if (still) {
    // one still frame, fully grown, all four steps already readable
    gShown = gTarget = 1; shownActive = 3;
    steps.forEach((s) => s.classList.add('is-active'));
    const paint = () => { layout(); time = 2; step(1); render(); };
    if ('ResizeObserver' in window) new ResizeObserver(paint).observe(stageEl); else window.addEventListener('resize', paint);
    paint();
    return;
  }

  let rq = false;
  const onScroll = () => { if (!rq) { rq = true; requestAnimationFrame(() => { rq = false; readScroll(); }); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  let lastW = window.innerWidth;
  const onResize = () => { layout(); readScroll(); lastW = window.innerWidth; };
  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(stageEl); else window.addEventListener('resize', onResize);
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; sync(); }, { rootMargin: '10% 0px 10% 0px' }).observe(sec);
  document.addEventListener('visibilitychange', sync);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layout(); });
  layout();
  readScroll();
  if (shownActive < 0) { active = 0; setActive(); }

  if (debug) {
    Object.assign(window, {
      __nccPlant: {
        /** @param {number} p */
        seek(p) { plan(p); gShown = gTarget; setActive(); for (let i = 0; i < 90; i++) { time += 1 / 60; step(1 / 60); } render(); },
        fps() { return { frames, slow }; }
      }
    });
  }
}
