/* Newaz Clinical Consulting, hero: the mother tree.
   three.js r160 (vendored in assets/vendor/three), WebGL, loaded through the import map.

   A gold seed falls onto an invisible plane. Roots reach down and out, a bud breaks the
   surface and a tree grows, ages and outgrows the frame. Just before it leaves, it drops
   a new seed; as that seed lands, the old tree dissolves and the cycle begins again.
   The whole time, pulses of gold and sky blue run from the root tips through the trunk
   into the leaves.

   Round 5: the tree truly grows. There is no zoom. The layout scale is fixed for the whole
   life; the tree gets bigger only by extension and branching. tree-gen.js simulates the
   growth once (space colonization in a widening crown, timed walks for the roots) and
   gives every node a birth time and its thickness at eight moments. Here, two clocks (tree
   and roots) slide each growth front along its branch, thicken the old wood in place,
   open leaves at new tips, drop them inside the crown and shed shaded twigs. Growth, aging,
   sway, the pulses and the dissolve all run on the GPU from a handful of uniforms, so a
   frame costs almost nothing on the CPU. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { generateTree, RAD_T } from './tree-gen.js';

/** @typedef {import('./tree-gen.js').TreeVariant} TreeVariant */
/** @typedef {import('./tree-gen.js').Ribbon} Ribbon */
/**
 * @typedef {Object} Phase  where one life is at local time tau (seconds from its seed landing)
 * @property {number} g      tree growth clock 0..1 (the simulation's time)
 * @property {number} rg     root growth clock 0..1
 * @property {number} dis    dissolve 0..1
 * @property {number} mat    maturity 0..1, deepens the color
 */
/**
 * @typedef {Object} Layout
 * @property {number} W   hero width, CSS px
 * @property {number} H   hero height, CSS px
 * @property {number} ox  seed x, CSS px
 * @property {number} oy  ground line, CSS px from the bottom (GL space is y up)
 * @property {number} G   ground line distance from the top, CSS px
 * @property {number} unit  CSS px per world unit, fixed for the whole life
 * @property {boolean} narrow
 */

/* Pace. The growth timeline is authored in BASE seconds (34 s, phaseAt below); warp() maps real
   seconds since the landing onto it.
   - The opening is round 4's, unchanged: a steep burst that settles, so a sapling is up about
     1 s after the landing and a young branching tree at 1.6 s (about 2.5 s after load).
   - Round 5: after the opening, growth keeps the opening's own speed at that moment instead of
     settling further, easing only a touch toward the landing. The cycle is 8 s, was 17 s. */
const CYCLE = 8;           // real seconds from one landing to the next
const BASE = 34;           // authored timeline length
const FALL = 1.7;          // a seed's fall from the old tree
const FALL_FIRST = 0.8;    // the first seed after load falls quicker
const SPROUT = 2.8;        // the bud breaks the surface (authored seconds)
const STILL_TAU = 28;      // the mature frame shown under reduced motion (authored seconds): a full crown at the top edge
const FLOW_SPEED = 0.24;   // pulse speed, world units per second
const WARP_B = 13;         // extra authored seconds spent in the opening burst
const WARP_T = 1.3;        // how fast the burst settles, real seconds
const WARP_A = (BASE - WARP_B * (1 - Math.exp(-17 / WARP_T))) / 17;  // round 4's opening, kept exactly
const OPEN_END = 1.6;      // real seconds after the landing where the opening hands over
/** The opening burst. @param {number} t */
const opening = (t) => WARP_A * t + WARP_B * (1 - Math.exp(-t / WARP_T));
const OPEN_W = opening(OPEN_END);
const OPEN_V = WARP_A + (WARP_B / WARP_T) * Math.exp(-OPEN_END / WARP_T);  // the opening's speed at the handover
const RUN = CYCLE - OPEN_END;
const EASE = (BASE - OPEN_W - OPEN_V * RUN) / (RUN * RUN);                 // a slight easing, so BASE lands on CYCLE
const END_V = OPEN_V + 2 * EASE * RUN;
/** Real seconds since landing to authored seconds. @param {number} t */
function warp(t) {
  if (t <= 0) return t * (WARP_A + WARP_B / WARP_T);
  if (t <= OPEN_END) return opening(t);
  if (t <= CYCLE) { const u = t - OPEN_END; return OPEN_W + OPEN_V * u + EASE * u * u; }
  return BASE + END_V * (t - CYCLE);
}
/** Inverse of warp, by bisection. @param {number} a */
function unwarp(a) { let lo = 0, hi = CYCLE * 2; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (warp(m) < a) lo = m; else hi = m; } return (lo + hi) / 2; }

const FIRST_START = 0.12 + FALL_FIRST; // the first landing, real seconds after boot
const root = document.documentElement;
const hero = /** @type {HTMLElement | null} */ (document.querySelector('[data-tree]'));
const stage = hero ? /** @type {HTMLElement | null} */ (hero.querySelector('[data-hero-stage], .hero__stage')) : null;
const copy = hero ? /** @type {HTMLElement | null} */ (hero.querySelector('[data-hero-copy], .hero__copy')) : null;
const header = /** @type {HTMLElement | null} */ (document.querySelector('[data-header]'));
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const debug = /[?&]tree-debug\b/.test(location.search);

/** @param {number} v @param {number} a @param {number} b */
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
/** @param {number} a @param {number} b @param {number} x */
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ---------- Brand colors, read from the CSS tokens ---------- */
/** @param {string} name */
function token(name) {
  const v = getComputedStyle(root).getPropertyValue(name).trim();
  if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error('Missing color token ' + name);
  return v;
}
/** @param {string} hex @returns {[number, number, number]} sRGB 0..1 */
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
/** Mix two hex colors in sRGB, the same way color-mix(in srgb) does. @param {string} a @param {string} b @param {number} t */
function mixSRGB(a, b, t) { const x = rgb(a), y = rgb(b); return /** @type {[number, number, number]} */ ([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t)); }
/** @param {[number, number, number]} c */
function linear(c) { return new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); }

/* ---------- Shaders ---------- */
const COMMON = /* glsl */ `
uniform float uTime;
uniform float uFlow;
uniform float uStill;
uniform vec3 uGold;
uniform vec3 uSky;
uniform vec4 uProtect;
uniform float uHeaderY;

vec2 sway(vec2 p, float amp) {
  float h = max(p.y, 0.0);
  float w = sin(uTime * 0.53 + p.x * 2.3) * 0.65 + sin(uTime * 0.91 + p.y * 3.1 + 1.7) * 0.35;
  return vec2(w * amp * h * h, -abs(w) * amp * 0.2 * h * h);
}
// 1 away from the copy, low behind it and behind the header, so the text never loses contrast
float shield(vec2 px) {
  vec2 c = (uProtect.xy + uProtect.zw) * 0.5;
  vec2 hs = (uProtect.zw - uProtect.xy) * 0.5;
  vec2 d = abs(px - c) - hs;
  float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  float k = mix(0.08, 1.0, smoothstep(-24.0, 150.0, sd));
  return k * mix(1.0, 0.3, smoothstep(uHeaderY - 60.0, uHeaderY + 6.0, px.y));
}
// Pulses travel from the root tips (negative s) through the seed point into the canopy.
vec4 flow(float s, float jit) {
  if (uStill > 0.5) {
    float base = 0.07 + 0.22 * exp(-abs(s) * 3.0);
    return vec4(mix(uGold, uSky, smoothstep(-0.1, 0.55, s)), base);
  }
  const float SP = 0.9;
  float x = (uFlow - s) / SP + jit;
  float n = floor(x);
  float q = fract(x) * SP;
  float I = smoothstep(0.0, 0.04, q) * exp(-q / 0.14);
  I *= mix(1.0, 0.45, smoothstep(0.5, 2.0, abs(s)));  // calmer toward the root tips and the twigs
  vec3 c = mod(n, 2.0) < 0.5 ? uGold : uSky;
  return vec4(c, I);
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
// The old tree returns its light from the tips back to the base: a soft retreat with a fine grain on its edge.
float dissolveKey(vec2 w, float s) {
  float grain = vnoise(w * 70.0) * 0.6 + vnoise(w * 160.0) * 0.4;
  return 0.8 * (1.0 - clamp(abs(s) / 2.1, 0.0, 1.0)) + 0.2 * grain;
}
float dissolveAlpha(float key, float d) { return smoothstep(d - 0.14, d + 0.14, key); }
float dissolveEdge(float key, float d) { return exp(-pow((key - d) / 0.05, 2.0)); }
`;

const RIBBON_VS = /* glsl */ `
${COMMON}
attribute vec4 aPrevN;  // previous centerline xy, normal xy
attribute vec4 aLife;   // birth, previous birth, flow distance, shed time
attribute vec4 aRadA;   // radius at the first four sample moments (RAD_T)
attribute vec4 aRadB;   // radius at the last four
attribute vec4 aMeta;   // side, rnd, vigor, junction weight
attribute vec4 aJoinF;  // the parent's center at the joint xy, the parent's normal xy
uniform vec4 uRW0;      // interpolation weights for the current moment
uniform vec4 uRW1;
uniform float uGrow;
uniform float uScale;
uniform vec2 uOrigin;
uniform float uThick;
uniform float uTipLen;
uniform float uSway;
varying float vAcross;
varying float vHw;
varying float vAlpha;
varying float vS;
varying float vAge;
varying float vRnd;
varying float vVig;
varying float vJoin;
varying float vR;
varying float vAp;
varying vec2 vPx;
varying vec2 vW;
void main() {
  float birth = aLife.x;
  float pb = aLife.y;
  float f = clamp((uGrow - pb) / max(birth - pb, 1e-5), 0.0, 1.0);
  vec2 c = mix(aPrevN.xy, position.xy, f);
  float age = uGrow - birth;
  // secondary growth: the wood thickens in place as more tips come to depend on it
  float r = (dot(aRadA, uRW0) + dot(aRadB, uRW1)) * uThick;
  float rJoint = r;
  // the growing tip tapers to a point
  r *= smoothstep(0.0, uTipLen, age);
  // a shaded twig thins and lets go
  float live = 1.0 - smoothstep(aLife.w, aLife.w + 0.06, uGrow);
  r *= live;
  c += sway(c, uSway);
  float hw = r * uScale;
  float alive = step(1e-7, r);
  float alpha = clamp(hw / 0.55, 0.0, 1.0) * live;
  hw = max(hw, 0.55) * alive;
  float ext = hw + 1.0 * alive;
  vec2 px = uOrigin + c * uScale + aPrevN.zw * aMeta.x * ext;
  vAcross = aMeta.x * ext;
  vHw = hw;
  vAlpha = alpha;
  vS = aLife.z;
  vAge = age;
  vRnd = aMeta.y;
  vVig = aMeta.z;
  vJoin = aMeta.w;
  vR = r;
  // where this vertex sits across the parent limb, so a joint takes the parent's light exactly
  vAp = 0.0;
  if (aMeta.w > 0.0) {
    vec2 at = aJoinF.xy + sway(aJoinF.xy, uSway);
    vec2 wpos = c + aPrevN.zw * aMeta.x * ext / uScale;
    float rP = rJoint / max(0.92 * aMeta.w, 0.05);
    vAp = dot(wpos - at, aJoinF.zw) / max(rP, 1e-4);
  }
  vPx = px;
  vW = c;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(px, 0.0, 1.0);
}
`;

const RIBBON_FS = /* glsl */ `
${COMMON}
uniform vec3 uYoung;
uniform vec3 uMature;
uniform vec3 uRim;
uniform float uMaturity;
uniform float uRipeAge;
uniform float uGlow;
uniform float uAmbient;
uniform float uDissolve;
uniform float uBaseFade;
varying float vAcross;
varying float vHw;
varying float vAlpha;
varying float vS;
varying float vAge;
varying float vRnd;
varying float vVig;
varying float vJoin;
varying float vR;
varying float vAp;
varying vec2 vPx;
varying vec2 vW;
void main() {
  float edge = clamp(vHw + 0.5 - abs(vAcross), 0.0, 1.0);
  float alpha = edge * vAlpha;
  // the buried end of the trunk melts into the root collar
  if (uBaseFade > 0.0) alpha *= smoothstep(0.004, uBaseFade, vS);
  // fresh tips arrive softly, so the growing edge of the crown never reads as spikes; a joint is always solid
  alpha *= mix(0.45 + 0.55 * smoothstep(0.0, 0.05, vAge), 1.0, vJoin);
  if (alpha < 0.002) discard;
  // across the limb: the branch's own frame, blended into the parent's frame inside a joint
  float a = clamp(mix(vAcross / max(vHw, 0.75), vAp, vJoin), -1.0, 1.0);
  // wood ripens with girth, not with its own age, so a young limb leaving old wood starts the same color
  float girth = smoothstep(0.0016, 0.0065, vR);
  // the hair-fine roots ripen with age as well (outside any joint), so the mat keeps its warm tone
  float ripe = max(girth, uRipeAge * (1.0 - vJoin) * smoothstep(0.0, 0.32, vAge)) * uMaturity;
  vec3 col = mix(uYoung, uMature, ripe);
  // a soft light from the upper left rounds each limb; inside a joint it is the parent's light
  col = mix(col, uRim, 0.34 * smoothstep(0.15, 1.0, -a) * (0.35 + 0.65 * girth));
  col *= 1.0 - 0.16 * a * a;
  // light runs as a vein inside the wood, a few pixels wide however thick the limb
  float vein = clamp(vHw * 0.42, 0.9, 3.2);
  float core = exp(-pow(vAcross / vein, 2.0)) * mix(1.0, 0.75, smoothstep(2.0, 12.0, vHw));
  float sh = shield(vPx);
  // one phase for all the wood, so a pulse runs through every joint without a step
  vec4 f = flow(vS, 0.0);
  col += f.rgb * f.a * core * uGlow * sh * 0.85;
  col += mix(uGold, uSky, smoothstep(-0.1, 0.6, vS)) * core * uAmbient * sh;
  if (uDissolve > 0.0) {
    float key = dissolveKey(vW, vS);
    float dd = uDissolve * 1.3 - 0.15;
    alpha *= dissolveAlpha(key, dd);
    col += mix(uGold, uSky, 0.4) * dissolveEdge(key, dd) * 0.35 * sh * alpha;
  }
  gl_FragColor = vec4(col, alpha);
}
`;

const LEAF_VS = /* glsl */ `
${COMMON}
attribute vec4 iA;  // x, y, angle, length
attribute vec4 iB;  // birth, death, flow distance, rnd
uniform float uGrow;
uniform float uScale;
uniform vec2 uOrigin;
uniform float uSway;
uniform float uLeafScale;
varying vec2 vUv;
varying float vS;
varying float vRnd;
varying float vLife;
varying float vYoung;
varying vec2 vPx;
varying vec2 vW;
void main() {
  float born = smoothstep(iB.x, iB.x + 0.05, uGrow);
  float gone = smoothstep(iB.y, iB.y + 0.06, uGrow);
  float life = born * (1.0 - gone);
  vec2 anchor = iA.xy + sway(iA.xy, uSway);
  float flutter = sin(uTime * (0.8 + iB.w * 0.6) + iB.w * 40.0) * 0.07;
  float ang = iA.z + flutter + (1.0 - born) * 0.6 * (iB.w - 0.5) - gone * 0.8;
  float len = iA.w * uLeafScale * mix(0.3, 1.0, born) * uScale * step(0.002, life);
  vec2 local = vec2(position.x * len, position.y * len * 0.34);
  float c = cos(ang);
  float s = sin(ang);
  vec2 px = uOrigin + anchor * uScale + vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  px.y -= gone * gone * 26.0;
  vUv = position.xy;
  vS = iB.z;
  vRnd = iB.w;
  vLife = life;
  vYoung = 1.0 - smoothstep(iB.x, iB.x + 0.22, uGrow);
  vPx = px;
  vW = iA.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(px, 0.0, 1.0);
}
`;

const LEAF_FS = /* glsl */ `
${COMMON}
uniform vec3 uLeafDeep;
uniform vec3 uLeafMid;
uniform vec3 uLeafYoung;
uniform vec3 uLeafRim;
uniform vec3 uVein;
uniform float uGlow;
uniform float uAmbient;
uniform float uDissolve;
varying vec2 vUv;
varying float vS;
varying float vRnd;
varying float vLife;
varying float vYoung;
varying vec2 vPx;
varying vec2 vW;
void main() {
  float u = clamp(vUv.x, 0.0, 1.0);
  float w = pow(sin(3.14159265 * pow(u, 0.7)), 0.85);
  float d = w - abs(vUv.y);
  float aa = fwidth(d) * 1.1 + 1e-4;
  float alpha = smoothstep(-aa, aa, d) * vLife;
  if (alpha < 0.003) discard;
  vec3 col = mix(uLeafDeep, uLeafMid, vRnd * vRnd);
  col = mix(col, uLeafYoung, vYoung * 0.9);
  float side = vUv.y / max(w, 0.05);
  col = mix(col, uLeafRim, smoothstep(0.2, 1.0, side) * 0.32);
  float rib = 1.0 - smoothstep(0.0, 0.08 + aa, abs(vUv.y));
  col = mix(col, uVein, rib * 0.5 * smoothstep(0.04, 0.12, u) * (1.0 - smoothstep(0.85, 1.0, u)));
  col *= 0.9 + 0.18 * u;
  float sh = shield(vPx);
  col *= mix(0.7, 1.0, smoothstep(0.08, 0.6, sh));
  vec4 f = flow(vS + u * 0.02, vRnd * 0.08);
  float lit = rib * 0.9 + smoothstep(0.55, 1.0, abs(side)) * 0.6 + 0.12;
  col += f.rgb * f.a * uGlow * sh * lit * mix(0.45, 1.0, vRnd);
  col += mix(uGold, uSky, 0.75) * uAmbient * sh * 0.5;
  if (uDissolve > 0.0) {
    float key = dissolveKey(vW, vS);
    float dd = uDissolve * 1.3 - 0.15;
    alpha *= dissolveAlpha(key, dd);
    col += mix(uGold, uSky, 0.4) * dissolveEdge(key, dd) * 0.35 * sh * alpha;
  }
  gl_FragColor = vec4(col, alpha * 0.96);
}
`;

const SEED_VS = /* glsl */ `
attribute float iIdx;
uniform vec4 uTrail[8];  // x, y, intensity, radius px
varying vec2 vUv;
varying float vA;
varying vec2 vPx;
void main() {
  vec4 t = uTrail[int(iIdx)];
  vec2 px = t.xy + position.xy * t.w;
  vUv = position.xy;
  vA = t.z;
  vPx = px;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(px, 0.0, 1.0);
}
`;
const SEED_FS = /* glsl */ `
${COMMON}
uniform float uCore;
varying vec2 vUv;
varying float vA;
varying vec2 vPx;
void main() {
  float r = length(vUv * vec2(1.0, 0.8));
  float core = (1.0 - smoothstep(0.05, 0.085, r)) * uCore;
  float halo = exp(-r * 8.0) * 0.55 + exp(-r * 22.0) * 0.9;
  float k = vA * (shield(vPx) * 0.6 + 0.4);
  vec3 col = uGold * (core * 3.0 + halo) * k + vec3(1.0, 0.95, 0.8) * core * 0.6 * k;
  gl_FragColor = vec4(col, 1.0);
}
`;

const RIPPLE_VS = /* glsl */ `
uniform vec2 uC;
uniform float uR;
varying vec2 vUv;
void main() {
  vUv = position.xy * 1.25;
  vec2 px = uC + position.xy * vec2(uR, uR * 0.16) * 1.25;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(px, 0.0, 1.0);
}
`;
const RIPPLE_FS = /* glsl */ `
uniform vec3 uGold;
uniform vec3 uSky;
uniform float uA;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float ring = exp(-pow((r - 1.0) / 0.05, 2.0)) + exp(-pow((r - 0.62) / 0.05, 2.0)) * 0.4;
  float floor0 = exp(-r * r * 3.0) * 0.18;
  vec3 col = mix(uGold, uSky, smoothstep(0.4, 1.0, r)) * (ring + floor0) * uA;
  gl_FragColor = vec4(col, 1.0);
}
`;

const BG_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
// Same gradient as the hero's CSS background, mixed in sRGB, then converted to linear.
const BG_FS = /* glsl */ `
uniform vec3 uSkyS;
uniform vec3 uEarthS;
uniform vec3 uAuraS;
uniform vec2 uAura;
uniform vec2 uRes;
varying vec2 vUv;
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float t = 1.0 - vUv.y;
  vec3 c = mix(uSkyS, uEarthS, smoothstep(0.0, 1.0, (t - 0.58) / 0.42));
  vec2 p = (vUv - uAura) * vec2(uRes.x / uRes.y, 1.0);
  c = mix(c, uAuraS, exp(-dot(p, p) * 4.0) * 0.07);
  c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(toLinear(c), 1.0);
}
`;

/* ---------- Geometry ---------- */
/** @param {Ribbon} r */
function ribbonGeometry(r) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(r.position, 3));
  g.setAttribute('aPrevN', new THREE.BufferAttribute(r.prevNormal, 4));
  g.setAttribute('aLife', new THREE.BufferAttribute(r.life, 4));
  g.setAttribute('aRadA', new THREE.BufferAttribute(r.radA, 4));
  g.setAttribute('aRadB', new THREE.BufferAttribute(r.radB, 4));
  g.setAttribute('aMeta', new THREE.BufferAttribute(r.meta, 4));
  g.setAttribute('aJoinF', new THREE.BufferAttribute(r.joinFrame, 4));
  g.setIndex(new THREE.BufferAttribute(r.index, 1));
  return g;
}
/** @param {TreeVariant} v */
function leafGeometry(v) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('iA', new THREE.InstancedBufferAttribute(v.leaves.a, 4));
  g.setAttribute('iB', new THREE.InstancedBufferAttribute(v.leaves.b, 4));
  g.instanceCount = v.leaves.count;
  return g;
}
function quadGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
function seedGeometry() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('iIdx', new THREE.InstancedBufferAttribute(new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]), 1));
  g.instanceCount = 8;
  return g;
}

/* ---------- Timeline ---------- */
/* No scale term: the layout unit is fixed, and size comes only from growth. The warp above
   already front-loads the opening, so the clocks run straight in authored time. The tree keeps
   growing until it dissolves, so the growth front never stops moving. */
/** @param {number} tau authored seconds since landing @returns {Phase} */
function phaseAt(tau) {
  const rg = clamp((tau - 0.2) / (BASE + 0.6), 0, 1);
  const g = clamp((tau - SPROUT) / (BASE - SPROUT + 0.4), 0, 1);
  const dis = clamp((tau - (BASE - 0.9)) / 4.4, 0, 1);
  const mat = smoothstep(0.04, 0.8, g);
  return { g, rg, dis, mat };
}

/** Weights that interpolate the eight thickness samples at growth time g. @param {number} g @param {THREE.Vector4} w0 @param {THREE.Vector4} w1 */
function radiusWeights(g, w0, w1) {
  const w = [0, 0, 0, 0, 0, 0, 0, 0];
  if (g <= RAD_T[0]) w[0] = 1;
  else if (g >= RAD_T[7]) w[7] = 1;
  else {
    let k = 0;
    while (k < 6 && g > RAD_T[k + 1]) k++;
    const f = (g - RAD_T[k]) / (RAD_T[k + 1] - RAD_T[k]);
    w[k] = 1 - f; w[k + 1] = f;
  }
  w0.set(w[0], w[1], w[2], w[3]);
  w1.set(w[4], w[5], w[6], w[7]);
}

/* ---------- Boot ---------- */
function fail(/** @type {unknown} */ err) {
  root.classList.add('no-gl');
  if (hero) hero.classList.remove('is-gl');
  if (debug) console.warn('[hero-tree]', err);
  heroReady();
}

/* Round 9, the loader (loader.js): it waits for this signal (the first frame is drawn, or the hero fell back to its
   still frame), and while html.is-loading is set the tree holds at its first frame. 'ncc:loaded' starts the clock,
   so the first seed falls after the loader has lifted, never behind it. */
function heroReady() {
  Object.assign(window, { __nccHeroReady: true });
  document.dispatchEvent(new CustomEvent('ncc:hero-ready'));
}

function boot() {
  if (!hero || !stage || !copy) { heroReady(); return; }

  const C = {
    ayanna: token('--c-ayanna'), kaia: token('--c-kaia'), saif: token('--c-saif'), biscuit: token('--c-biscuit')
  };
  const pal = {
    gold: linear(rgb(C.saif)),
    sky: linear(rgb(C.biscuit)),
    branchYoung: linear(mixSRGB(C.ayanna, C.biscuit, 0.2)),
    branchMature: linear(mixSRGB(C.kaia, C.ayanna, 0.22)),
    branchRim: linear(mixSRGB(C.ayanna, C.biscuit, 0.42)),
    rootYoung: linear(mixSRGB(C.ayanna, C.biscuit, 0.1)),
    rootMature: linear(mixSRGB(C.kaia, C.ayanna, 0.12)),
    rootRim: linear(mixSRGB(C.ayanna, C.biscuit, 0.2)),
    leafDeep: linear(mixSRGB(C.kaia, C.ayanna, 0.55)),
    leafMid: linear(mixSRGB(C.ayanna, C.biscuit, 0.22)),
    leafYoung: linear(mixSRGB(C.ayanna, C.biscuit, 0.5)),
    leafRim: linear(mixSRGB(C.ayanna, C.biscuit, 0.55)),
    vein: linear(mixSRGB(C.kaia, C.ayanna, 0.3))
  };

  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, screen.width || window.innerWidth) < 760;
  const nav = /** @type {Navigator & {deviceMemory?: number}} */ (navigator);
  const lowPower = (nav.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory || 8) <= 4;
  const quality = small || lowPower ? 0.6 : 1;
  const dprCap = small || coarse ? 1.5 : 2;
  let dpr = Math.min(window.devicePixelRatio || 1, dprCap);

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(dpr);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  stage.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);

  /** @type {Layout} */
  const L = { W: 1, H: 1, ox: 0, oy: 0, G: 1, unit: 1, narrow: false };

  const common = {
    uTime: { value: 0 },
    uFlow: { value: 0 },
    uStill: { value: 0 },
    uGold: { value: pal.gold },
    uSky: { value: pal.sky },
    uProtect: { value: new THREE.Vector4(0, 0, 0, 0) },
    uHeaderY: { value: 0 }
  };

  // Background, the same gradient as the CSS so the canvas fades in without a seam
  const bgU = {
    uSkyS: { value: new THREE.Vector3(...rgb(C.ayanna)) },
    uEarthS: { value: new THREE.Vector3(...mixSRGB(C.ayanna, C.kaia, 0.5)) },
    uAuraS: { value: new THREE.Vector3(...mixSRGB(C.ayanna, C.biscuit, 0.5)) },
    uAura: { value: new THREE.Vector2(0.7, 0.5) },
    uRes: { value: new THREE.Vector2(1, 1) }
  };
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: BG_VS, fragmentShader: BG_FS, uniforms: bgU, depthTest: false, depthWrite: false }));
  bg.frustumCulled = false;
  bg.renderOrder = -1;
  scene.add(bg);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.9, 0.6, 0.38);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* Variants: two trees generated up front, a third later when idle, used in turn */
  /** @type {{v: TreeVariant, tree: THREE.BufferGeometry, roots: THREE.BufferGeometry, leaves: THREE.InstancedBufferGeometry}[]} */
  const variants = [];
  const lean = 0.05;
  /** @param {number} seed */
  function addVariant(seed) {
    const v = generateTree(seed, { quality, lean });
    variants.push({ v, tree: ribbonGeometry(v.tree), roots: ribbonGeometry(v.roots), leaves: leafGeometry(v) });
  }
  const seeds = [20261109, 731, 4417];
  addVariant(seeds[0]);
  const seedGeo = seedGeometry();
  const quad = quadGeometry();

  let order = 0;
  let variantCursor = 0;

  /** One tree, from its seed's fall to its dissolve. */
  class Life {
    /** @param {number} vi @param {number} start @param {{x:number, y:number} | null} from @param {number} fall */
    constructor(vi, start, from, fall) {
      const pack = variants[vi];
      this.fall = fall;
      this.variant = pack.v;
      this.start = start;
      this.from = from;
      /** @type {Life | null} */
      this.next = null;
      this.base = (order++ % 1000) * 10;
      this.group = new THREE.Group();

      const own = () => ({ uGrow: { value: 0 }, uScale: { value: 1 }, uOrigin: { value: new THREE.Vector2() }, uThick: { value: 1 }, uTipLen: { value: 0.01 }, uRW0: { value: new THREE.Vector4(1, 0, 0, 0) }, uRW1: { value: new THREE.Vector4() }, uSway: { value: 0.004 }, uMaturity: { value: 0 }, uRipeAge: { value: 0 }, uGlow: { value: 1.7 }, uAmbient: { value: 0.03 }, uDissolve: { value: 0 }, uBaseFade: { value: 0 } });
      /** @param {Record<string, {value: unknown}>} u @param {string} vs @param {string} fs @param {THREE.Blending} blending */
      const mat = (u, vs, fs, blending = THREE.NormalBlending) => new THREE.ShaderMaterial({
        uniforms: { ...common, ...u }, vertexShader: vs, fragmentShader: fs,
        transparent: true, depthTest: false, depthWrite: false, blending,
        extensions: { derivatives: true }
      });

      this.rootU = { ...own(), uYoung: { value: pal.rootYoung }, uMature: { value: pal.rootMature }, uRim: { value: pal.rootRim } };
      this.rootU.uSway.value = 0;
      this.rootU.uRipeAge.value = 1;
      this.rootU.uTipLen.value = 0.012;
      this.rootU.uGlow.value = 1.05;
      this.treeU = { ...own(), uYoung: { value: pal.branchYoung }, uMature: { value: pal.branchMature }, uRim: { value: pal.branchRim } };
      this.treeU.uBaseFade.value = 0.06;
      this.leafU = { ...own(), uLeafDeep: { value: pal.leafDeep }, uLeafMid: { value: pal.leafMid }, uLeafYoung: { value: pal.leafYoung }, uLeafRim: { value: pal.leafRim }, uVein: { value: pal.vein }, uLeafScale: { value: 1 } };
      this.leafU.uGlow.value = 1.1;
      this.seedU = { uTrail: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }, uCore: { value: 1 } };
      this.rippleU = { uC: { value: new THREE.Vector2() }, uR: { value: 1 }, uA: { value: 0 }, uGold: common.uGold, uSky: common.uSky };

      this.roots = new THREE.Mesh(pack.roots, mat(this.rootU, RIBBON_VS, RIBBON_FS));
      this.tree = new THREE.Mesh(pack.tree, mat(this.treeU, RIBBON_VS, RIBBON_FS));
      this.leaves = new THREE.Mesh(pack.leaves, mat(this.leafU, LEAF_VS, LEAF_FS));
      this.seed = new THREE.Mesh(seedGeo, mat(this.seedU, SEED_VS, SEED_FS, THREE.AdditiveBlending));
      this.ripple = new THREE.Mesh(quad, new THREE.ShaderMaterial({ uniforms: this.rippleU, vertexShader: RIPPLE_VS, fragmentShader: RIPPLE_FS, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
      [this.roots, this.tree, this.leaves, this.ripple, this.seed].forEach((m, i) => {
        m.frustumCulled = false;
        m.renderOrder = this.base + i;
        this.group.add(m);
      });
      scene.add(this.group);
    }

    /** @param {number} tau */
    apply(tau) {
      const p = phaseAt(warp(tau));
      const scale = L.unit;
      const ribbons = [this.rootU, this.treeU, this.leafU];
      for (const u of ribbons) {
        u.uScale.value = scale;
        u.uOrigin.value.set(L.ox, L.oy);
        u.uDissolve.value = p.dis;
        u.uMaturity.value = p.mat;
      }
      this.rootU.uMaturity.value = smoothstep(0.0, 0.35, p.rg);
      this.rootU.uGrow.value = p.rg;
      this.treeU.uGrow.value = p.g;
      this.leafU.uGrow.value = p.g;
      radiusWeights(p.g, this.treeU.uRW0.value, this.treeU.uRW1.value);
      radiusWeights(p.rg, this.rootU.uRW0.value, this.rootU.uRW1.value);
      // a young tree's leaves read a little larger, so the first pair is legible
      this.leafU.uLeafScale.value = 1 + 0.45 * (1 - smoothstep(0.02, 0.3, p.g));
      const showTree = tau > 0 && p.dis < 1;
      this.roots.visible = showTree;
      this.tree.visible = showTree && p.g > 0;
      this.leaves.visible = showTree && p.g > 0;
      this.applySeed(tau);
    }

    /** @param {number} tau */
    applySeed(tau) {
      const trail = this.seedU.uTrail.value;
      const R = Math.max(46, Math.min(L.W, L.H) * 0.075);
      const show = tau > -this.fall && tau < 3.5;
      this.seed.visible = show;
      if (show) {
        for (let i = 0; i < 8; i++) {
          const lag = i * 0.05;
          const t = tau - lag;
          const pos = this.seedPos(t);
          let I;
          if (t < 0) I = smoothstep(-this.fall, -this.fall + 0.4, t);
          else I = 1 + 0.5 * Math.exp(-t * 5) - smoothstep(0.2, 3.2, t) * 0.97;
          const fade = i === 0 ? 1 : (1 - i / 8) * 0.22 * (t < 0 ? 1 : 0);
          trail[i].set(pos.x, pos.y, Math.max(0, I) * fade, R * (i === 0 ? 1 : 0.55));
        }
        this.seedU.uCore.value = 1 - smoothstep(0.5, 2.5, tau);
      }
      const rt = tau / 1.4;
      this.ripple.visible = rt > 0 && rt < 1;
      if (this.ripple.visible) {
        const e = 1 - Math.pow(1 - rt, 3);
        this.rippleU.uC.value.set(L.ox, L.oy);
        this.rippleU.uR.value = Math.max(60, L.G * 0.26) * (0.15 + 0.85 * e);
        this.rippleU.uA.value = Math.pow(1 - rt, 2) * 0.55;
      }
    }

    /** Screen position of the seed at local time t (seconds, negative while it falls). @param {number} t */
    seedPos(t) {
      if (t >= 0) return { x: L.ox, y: L.oy };
      const from = this.from || (L.narrow ? { x: L.ox + L.W * 0.12, y: L.oy + L.G * 0.27 } : { x: L.ox + L.W * 0.04, y: L.oy + L.G * 0.6 });
      const u = clamp(1 + t / this.fall, 0, 1);
      const e = u * u * (3 - 2 * u);
      const sway = Math.sin(u * Math.PI * 2.2) * Math.min(38, L.W * 0.03) * (1 - u);
      return { x: from.x + (L.ox - from.x) * e + sway, y: from.y + (L.oy - from.y) * (0.35 * u + 0.65 * e) };
    }

    dispose() {
      scene.remove(this.group);
      [this.roots, this.tree, this.leaves, this.seed, this.ripple].forEach((m) => /** @type {THREE.Material} */ (m.material).dispose());
    }
  }

  /** Where the new seed falls from: a leafy tip still in frame, near the trunk line, clear of the copy. @param {Life} life */
  function releasePoint(life) {
    const p = phaseAt(warp(CYCLE - FALL));
    const s = L.unit;
    const pr = common.uProtect.value;
    let best = null, bestScore = -Infinity;
    for (const c of life.variant.perches) {
      if (c.birth > p.g - 0.05) continue;
      const x = L.ox + c.x * s, y = L.oy + c.y * s;
      if (x < L.W * 0.06 || x > L.W * 0.95 || y < L.oy + L.G * (L.narrow ? 0.1 : 0.22) || y > L.H * 0.86) continue;
      if (x > pr.x - 30 && x < pr.z + 30 && y > pr.y - 40 && y < pr.w + 30) continue;
      const score = -Math.abs(x - L.ox) / L.W * 1.6 + (y - L.oy) / L.H * 0.5 + Math.random() * 0.25;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    // nothing suitable in frame: fall from just below the copy, beside the trunk
    return best || { x: L.ox + L.W * 0.08, y: Math.max(L.oy + 40, Math.min(pr.y - 40, L.oy + L.G * 0.3)) };
  }

  /** @type {Life[]} */
  let lives = [];
  let clock = 0;
  let still = reduceMotion.matches;

  function nextVariant() { variantCursor = (variantCursor + 1) % variants.length; return variantCursor; }

  /** @param {number} c */
  function update(c) {
    const cur = lives[lives.length - 1];
    if (cur && !cur.next && c - cur.start >= CYCLE - FALL) {
      const n = new Life(nextVariant(), cur.start + CYCLE, releasePoint(cur), FALL);
      cur.next = n;
      lives.push(n);
    }
    lives = lives.filter((life) => {
      if (c - life.start > unwarp(BASE + 4.6)) { life.dispose(); return false; }
      return true;
    });
    for (const life of lives) life.apply(c - life.start);
    common.uTime.value = c;
    common.uFlow.value = c * FLOW_SPEED;
  }

  function measure() {
    const r = hero.getBoundingClientRect();
    L.W = Math.max(1, Math.round(r.width));
    L.H = Math.max(1, Math.round(r.height));
    L.narrow = L.W < 960;
    L.G = L.H * (L.narrow ? 0.82 : 0.77);
    L.oy = L.H - L.G;
    L.ox = L.W * (L.narrow ? 0.62 : 0.69);
    // fixed for the whole life: the tree reaches the top edge late in the cycle by growing, never by zoom
    L.unit = L.narrow ? Math.min(L.G * 0.44, L.W * 0.8) : Math.min(L.G, L.W * 0.55) * 0.76;
    const c = copy.getBoundingClientRect();
    const pad = 18;
    common.uProtect.value.set(c.left - r.left - pad, L.H - (c.bottom - r.top) - pad, c.right - r.left + pad, L.H - (c.top - r.top) + pad);
    const hh = header ? header.getBoundingClientRect().height : 72;
    common.uHeaderY.value = L.H - hh;
    camera.left = 0; camera.right = L.W; camera.top = L.H; camera.bottom = 0;
    camera.updateProjectionMatrix();
    renderer.setSize(L.W, L.H, false);
    composer.setSize(L.W, L.H);
    bgU.uRes.value.set(L.W, L.H);
    bgU.uAura.value.set(L.ox / L.W, (L.oy + L.G * 0.55) / L.H);
  }

  /* ---------- Loop: pauses off screen and in a hidden tab ---------- */
  let running = false;
  let raf = 0;
  let last = 0;
  let inView = true;
  let paused = false;
  let held = root.classList.contains('is-loading');   // round 9: the loader is up
  const frameTimes = [];
  let lastAdapt = 0;
  let frames = 0;

  function render() { composer.render(); }

  /** @param {number} now */
  function loop(now) {
    raf = 0;
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    clock += dt;
    update(clock);
    render();
    frames++;
    adapt(dt, now);
    raf = requestAnimationFrame(loop);
  }

  /* If the device cannot hold the frame rate, lower the pixel ratio a step at a time. */
  /** @param {number} dt @param {number} now */
  function adapt(dt, now) {
    frameTimes.push(dt);
    if (frameTimes.length < 90) return;
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    frameTimes.length = 0;
    if (avg > 0.024 && dpr > 1 && now - lastAdapt > 3000) {
      lastAdapt = now;
      dpr = Math.max(1, dpr - 0.25);
      renderer.setPixelRatio(dpr);
      composer.setPixelRatio(dpr);
      composer.setSize(L.W, L.H);
    }
  }

  function sync() {
    const should = inView && !document.hidden && !still && !paused && !held;
    if (should && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(loop); }
    else if (!should && running) { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  }

  function showStill() {
    common.uStill.value = 1;
    for (const life of lives) life.dispose();
    lives = [new Life(0, 0, null, FALL)];
    clock = unwarp(STILL_TAU);
    update(clock);
    lives[0].seed.visible = false;
    lives[0].ripple.visible = false;
    render();
  }

  function startLoop() {
    common.uStill.value = 0;
    for (const life of lives) life.dispose();
    clock = 0;
    lives = [new Life(0, FIRST_START, null, FALL_FIRST)];
    update(clock);
    render();
  }

  measure();
  if (still) showStill(); else startLoop();
  hero.classList.add('is-gl');
  if (held) document.addEventListener('ncc:loaded', () => { held = false; sync(); }, { once: true });
  sync();
  heroReady();

  // The second and third trees are grown when the main thread is quiet.
  const idle = /** @type {(cb: () => void) => void} */ (window.requestIdleCallback ? (cb) => window.requestIdleCallback(cb, { timeout: 2500 }) : (cb) => setTimeout(cb, 600));
  idle(() => { addVariant(seeds[1]); idle(() => addVariant(seeds[2])); });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => { inView = entries[0].isIntersecting; sync(); }, { threshold: 0 }).observe(hero);
  }
  document.addEventListener('visibilitychange', sync);
  reduceMotion.addEventListener('change', () => { still = reduceMotion.matches; if (still) showStill(); else startLoop(); sync(); });

  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => { measure(); update(clock); if (still) lives.forEach((l) => { l.seed.visible = false; l.ripple.visible = false; }); render(); }, 120);
  };
  window.addEventListener('resize', onResize, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(onResize);

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); running = false; fail('context lost'); });

  if (debug) {
    /** QA hook, only with ?tree-debug in the URL. */
    Object.assign(window, {
      __nccTree: {
        /** @param {number} t absolute clock, seconds */
        seek(t) { paused = true; sync(); clock = t; update(clock); render(); return lives.map((l) => ({ tau: +(t - l.start).toFixed(2), ...phaseAt(warp(t - l.start)) })); },
        phaseAt, 
        play() { paused = false; sync(); },
        cycle: CYCLE, fall: FALL, firstStart: FIRST_START, warp, unwarp,
        stats: () => ({ dpr, quality, frames, running, variants: variants.map((v) => v.v.stats), lives: lives.length })
      }
    });
  }
}

/* Vera fixes: probe WebGL once, before any renderer exists, and share the answer with approach-plant.js
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

if (root.classList.contains('no-gl') || !hasWebGL()) fail(new Error('WebGL is not available'));
else { try { boot(); } catch (err) { fail(err); } }
