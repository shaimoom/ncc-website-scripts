/* Hero tree: a growth simulation. Pure data, no three.js.

   The tree is grown, in time, by space colonization (Runions, Lane and Prusinkiewicz, 2007):

   - The crown and the soil are envelopes that widen over the life of the tree. Points of
     open space (attractors) wake as an envelope reaches them.
   - Every frame of the simulation, each node that has open space near it puts out a new
     node one step toward that space. So tips keep extending, old wood sprouts new
     branches when new space opens beside it, and branches split when space pulls two ways.
   - Every node keeps its birth time and never moves again. Earlier structure stays put;
     new structure is added outward and upward.
   - Thickness follows the pipe model at eight moments in the life, so the trunk and the
     old limbs thicken in place as more tips come to depend on them (secondary growth).
   - Leaves are born at new nodes and fall once the branch has grown well past them, so the
     canopy stays a living shell that fills in as the tips multiply. Small twigs that stop
     growing early are shed, which is how the trunk clears as the tree rises.

   The renderer grows all of it on the GPU from two clocks (tree and roots). World units:
   the seed sits at (0, 0), y points up, the tree is about 1.5 tall at the end of its life. */

/**
 * @typedef {Object} Ribbon  interleaved per-vertex data for one ribbon mesh
 * @property {Float32Array} position  vec3 centerline
 * @property {Float32Array} prevNormal vec4 previous centerline xy, normal xy
 * @property {Float32Array} life      vec4 birth, previous birth, flow distance, death
 * @property {Float32Array} radA      vec4 radius at RAD_T[0..3]
 * @property {Float32Array} radB      vec4 radius at RAD_T[4..7]
 * @property {Float32Array} meta      vec4 side, rnd, vigor, junction weight (1 where a branch leaves its parent, 0 past its collar)
 * @property {Float32Array} joinFrame vec4 the parent's center at the joint xy, the parent's normal xy, so a joint is lit in the parent's frame
 * @property {Uint32Array} index
 */
/**
 * @typedef {Object} Leaves
 * @property {Float32Array} a  vec4 x, y, angle, length
 * @property {Float32Array} b  vec4 birth, death, flow distance, rnd
 * @property {number} count
 */
/**
 * @typedef {Object} TreeVariant
 * @property {Ribbon} tree
 * @property {Ribbon} roots
 * @property {Leaves} leaves
 * @property {{x:number, y:number, birth:number}[]} perches  living tips with leaves, where a new seed can fall from
 * @property {{nodes:number, rootNodes:number, branches:number, rootBranches:number, leaves:number, vertices:number, ms:number}} stats
 */
/**
 * @typedef {Object} Net  a grown network, nodes in birth order (a parent always precedes its children)
 * @property {number} n
 * @property {Float32Array} x
 * @property {Float32Array} y
 * @property {Float32Array} t  birth, growth time 0..1
 * @property {Int32Array} p    parent index, -1 for a start node
 */
/**
 * @typedef {Object} ColonizeOpt
 * @property {Float32Array} ax  attractor x, sorted by wake time
 * @property {Float32Array} ay
 * @property {Float32Array} act wake time 0..1
 * @property {Float32Array} exp expiry time, 9 for never
 * @property {{x:number, y:number, t:number, p:number}[]} starts  p indexes earlier starts
 * @property {number} steps  simulation frames over the life
 * @property {number} D      node spacing
 * @property {number} di     radius of influence
 * @property {number} dk     kill distance
 * @property {(x:number, y:number, dx:number, dy:number) => [number, number]} bias  tropism added to the pull
 * @property {number} maxNodes
 * @property {() => number} rnd
 * @property {number} wander  random turn per node, radians
 * @property {(y:number) => number} [column]  x of the leader's column at height y
 * @property {number} [columnTop]  where the leader gives way to the limbs
 * @property {number} [leadUp]  extra upward pull on the leader
 * @property {(anchorY:number, y:number, T:number) => boolean} [lit]  false once a node at height y, on a branch leaving the leader at anchorY, is shaded at time T
 */

/** The moments at which branch thickness is sampled. The renderer interpolates between them. */
export const RAD_T = [0.04, 0.1, 0.18, 0.28, 0.4, 0.55, 0.75, 1.0];

/** @param {number} a */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UP = Math.PI / 2;

/** @param {() => number} rnd */
function gauss(rnd) { return (rnd() + rnd() + rnd() - 1.5) * 1.414; }

/** Smooth value noise on a random lattice, 0..1. @param {() => number} rnd @param {number} freq */
function noise2(rnd, freq) {
  const N = 32;
  const g = new Float32Array(N * N);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const at = (/** @type {number} */ i, /** @type {number} */ j) => g[((i % N) + N) % N * N + ((j % N) + N) % N];
  return (/** @type {number} */ x, /** @type {number} */ y) => {
    const X = x * freq + 7.3, Y = y * freq + 3.1;
    const i = Math.floor(X), j = Math.floor(Y);
    let fx = X - i, fy = Y - j;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return a + (b - a) * fy;
  };
}

/**
 * Sample attractors in the union of a widening envelope. Each one wakes at the first moment
 * the envelope contains it.
 * @param {() => number} rnd
 * @param {(x:number, y:number, T:number) => boolean} inside
 * @param {[number, number, number, number]} box  x0, y0, x1, y1 of the envelope at T = 1 (and every earlier one)
 * @param {number} count
 * @param {(x:number, y:number) => number} density  acceptance 0..1
 * @param {{x:number, y:number, act:number}[]} extra  hand-placed guides, already timed
 */
function attractors(rnd, inside, box, count, density, extra) {
  /** @type {{x:number, y:number, act:number, exp:number}[]} */
  const out = extra.map((e) => ({ ...e, exp: 9 }));
  let guard = count * 60;
  while (out.length < count + extra.length && guard-- > 0) {
    const x = box[0] + (box[2] - box[0]) * rnd();
    const y = box[1] + (box[3] - box[1]) * rnd();
    if (rnd() > density(x, y)) continue;
    // first moment inside any envelope so far (the young ones sit lower than the mature crown): coarse scan, then bisection
    let lo = 0, hi = -1;
    for (let k = 1; k <= 60; k++) { const T = k / 60; if (inside(x, y, T)) { hi = T; lo = (k - 1) / 60; break; } }
    if (hi < 0) continue;
    for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (inside(x, y, m)) hi = m; else lo = m; }
    // light: once the envelope has passed below a point for good (the crown's underside rising), it expires
    let exp = 9;
    for (let k = Math.ceil(hi * 60) + 1; k <= 60; k++) { if (!inside(x, y, k / 60)) { let ok = true; for (let j = k + 1; j <= 60; j += 3) if (inside(x, y, j / 60)) { ok = false; break; } if (ok) { exp = k / 60; break; } } }
    out.push({ x, y, act: hi, exp });
  }
  out.sort((a, b) => a.act - b.act);
  return {
    ax: Float32Array.from(out, (o) => o.x),
    ay: Float32Array.from(out, (o) => o.y),
    act: Float32Array.from(out, (o) => o.act),
    exp: Float32Array.from(out, (o) => o.exp)
  };
}

/**
 * Space colonization in time.
 * @param {ColonizeOpt} o
 * @returns {Net}
 */
function colonize(o) {
  const { ax, ay, act, exp, D, di, dk } = o;
  const na = ax.length;
  const cap = o.maxNodes;
  const X = new Float32Array(cap), Y = new Float32Array(cap), T = new Float32Array(cap), P = new Int32Array(cap);
  // where each node's branch leaves the leader, and whether the node is on the leader itself
  const anchor = new Float32Array(cap), lead = new Uint8Array(cap);
  const lit = o.lit;
  let Tn = 0;
  /** @param {number} m */
  const ok = (m) => !lit || lead[m] === 1 || lit(anchor[m], Y[m], Tn);
  /** @type {number[][]} */
  const kids = [];
  const accX = new Float32Array(cap), accY = new Float32Array(cap), accC = new Uint16Array(cap);
  const cs = di;
  /** @param {number} cx @param {number} cy */
  const key = (cx, cy) => (cx + 4096) * 8192 + (cy + 4096);
  /** @type {Map<number, number[]>} */
  const nodeGrid = new Map();
  /** @type {Map<number, number[]>} */
  const attrGrid = new Map();
  /** @param {Map<number, number[]>} g @param {number} x @param {number} y @param {number} i */
  const put = (g, x, y, i) => { const k = key(Math.floor(x / cs), Math.floor(y / cs)); const c = g.get(k); if (c) c.push(i); else g.set(k, [i]); };
  for (let i = 0; i < na; i++) put(attrGrid, ax[i], ay[i], i);

  const near = new Int32Array(na).fill(-1);
  const nd = new Float32Array(na).fill(Infinity);
  const state = new Uint8Array(na); // 0 asleep, 1 awake, 2 reached
  let n = 0;
  /** @param {number} x @param {number} y @param {number} t @param {number} p */
  function addNode(x, y, t, p) {
    X[n] = x; Y[n] = y; T[n] = t; P[n] = p; kids.push([]);
    // the leader is the central column; a branch is anchored where its lineage leaves it
    if (p < 0) { lead[n] = 1; anchor[n] = y; }
    else if (lead[p] && o.column && o.columnTop && y < o.columnTop && Math.abs(x - o.column(y)) < 0.04 && !kids[p].some((k) => lead[k])) { lead[n] = 1; anchor[n] = y; }
    else anchor[n] = lead[p] ? Y[p] : anchor[p];
    if (p >= 0) kids[p].push(n);
    put(nodeGrid, x, y, n);
    return n++;
  }
  for (const s of o.starts) addNode(s.x, s.y, s.t, s.p);

  /** Let the attractors near node m see it. @param {number} m */
  function announce(m) {
    const cx = Math.floor(X[m] / cs), cy = Math.floor(Y[m] / cs);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const c = attrGrid.get(key(cx + i, cy + j));
      if (!c) continue;
      for (const a of c) {
        if (state[a] !== 1) continue;
        const d = Math.hypot(ax[a] - X[m], ay[a] - Y[m]);
        if (d < dk) state[a] = 2;
        else if (d < di && d < nd[a] && ok(m)) { nd[a] = d; near[a] = m; }
      }
    }
  }

  let ptr = 0;
  /** @type {number[]} */
  let awake = [];
  /** @type {number[]} */
  const touched = [];
  for (let it = 1; it <= o.steps && n < cap; it++) {
    Tn = it / o.steps;
    // wake the attractors the envelope has reached, and find their nearest node
    while (ptr < na && act[ptr] <= Tn) {
      const a = ptr++;
      state[a] = 1;
      const cx = Math.floor(ax[a] / cs), cy = Math.floor(ay[a] / cs);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const c = nodeGrid.get(key(cx + i, cy + j));
        if (!c) continue;
        for (const m of c) {
          const d = Math.hypot(ax[a] - X[m], ay[a] - Y[m]);
          if (d < nd[a] && ok(m)) { nd[a] = d; near[a] = m; }
        }
      }
      if (nd[a] < dk) state[a] = 2;
      else { if (nd[a] >= di) { nd[a] = Infinity; near[a] = -1; } awake.push(a); }
    }
    // each awake attractor pulls on its nearest node
    touched.length = 0;
    for (const a of awake) {
      if (state[a] === 1 && exp[a] <= Tn) state[a] = 2;
      if (state[a] !== 1) continue;
      // its node fell into shade: look again among the lit nodes nearby
      if (near[a] >= 0 && !ok(near[a])) {
        near[a] = -1; nd[a] = Infinity;
        const cx = Math.floor(ax[a] / cs), cy = Math.floor(ay[a] / cs);
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
          const c = nodeGrid.get(key(cx + i, cy + j));
          if (!c) continue;
          for (const m of c) { const d = Math.hypot(ax[a] - X[m], ay[a] - Y[m]); if (d < di && d < nd[a] && ok(m)) { nd[a] = d; near[a] = m; } }
        }
      }
      // open space nobody reaches yet: every few frames, look twice as far, so the front never stalls
      if (near[a] < 0 && it % 6 === 0) {
        const cx = Math.floor(ax[a] / cs), cy = Math.floor(ay[a] / cs);
        let bd = di * 2;
        for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
          const c = nodeGrid.get(key(cx + i, cy + j));
          if (!c) continue;
          for (const m of c) { const d = Math.hypot(ax[a] - X[m], ay[a] - Y[m]); if (d < bd && ok(m)) { bd = d; near[a] = m; } }
        }
        if (near[a] >= 0) nd[a] = bd;
      }
      if (near[a] < 0) continue;
      const m = near[a];
      const dx = ax[a] - X[m], dy = ay[a] - Y[m];
      const l = Math.hypot(dx, dy) || 1;
      if (accC[m] === 0) touched.push(m);
      accX[m] += dx / l; accY[m] += dy / l; accC[m]++;
    }
    // every pulled node puts out one new node
    /** @type {number[]} */
    const born = [];
    for (const m of touched) {
      let dx = accX[m], dy = accY[m];
      accX[m] = 0; accY[m] = 0; accC[m] = 0;
      let l = Math.hypot(dx, dy);
      if (l < 1e-3) continue;
      dx /= l; dy /= l;
      const b = o.bias(X[m], Y[m], dx, dy);
      dx += b[0]; dy += b[1];
      // the leader keeps its line: a trunk rises, it does not wander after every pull
      if (lead[m] && o.leadUp) { dx *= 0.5; dy += o.leadUp; }
      // one trunk: any other stem inside the leader's column is turned out into a limb
      else if (o.column && o.columnTop && Y[m] < o.columnTop) {
        const off = X[m] - o.column(Y[m]);
        if (Math.abs(off) < 0.05) dx += (off >= 0 ? 1 : -1) * 0.9;
      }
      l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      // a little wander, so a long run toward far space still reads as wood, not a ruled line
      const w = gauss(o.rnd) * o.wander, cw = Math.cos(w), sw = Math.sin(w);
      const wx = dx * cw - dy * sw; dy = dx * sw + dy * cw; dx = wx;
      let dup = false;
      for (const k of kids[m]) {
        const kx = X[k] - X[m], ky = Y[k] - Y[m];
        if ((kx * dx + ky * dy) / (Math.hypot(kx, ky) || 1) > 0.93) { dup = true; break; }
      }
      if (dup) continue;
      born.push(addNode(X[m] + dx * D, Y[m] + dy * D, Tn, m));
      if (n >= cap) break;
    }
    for (const m of born) announce(m);
    if (it % 8 === 0) awake = awake.filter((a) => state[a] === 1);
  }
  return { n, x: X.subarray(0, n), y: Y.subarray(0, n), t: T.subarray(0, n), p: P.subarray(0, n) };
}

/**
 * Turn a grown network into chains (one ribbon per branch), with smoothing, flow distance,
 * pipe-model radii in time, and the moment each small twig is shed.
 * @param {Net} net
 * @param {{rTip:number, E:number, wood:number, flare:number, flareLen:number, sign:number, dt:number, shed:boolean, shedBelow:number, sinkY:number}} o
 * @param {() => number} rnd
 */
function build(net, o, rnd) {
  const { n, x, y, t, p } = net;
  /** @type {number[][]} */
  const kids = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) if (p[i] >= 0) kids[p[i]].push(i);
  // subtree size and the last growth anywhere in the subtree
  const size = new Float32Array(n), last = new Float32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    size[i] += 1; last[i] = Math.max(last[i], t[i]);
    if (p[i] >= 0) { size[p[i]] += size[i]; last[p[i]] = Math.max(last[p[i]], last[i]); }
  }
  // the chain continues through the child with the most growth behind it
  const main = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let best = -1;
    for (const k of kids[i]) if (best < 0 || size[k] > size[best]) best = k;
    main[i] = best;
  }
  // smoothing along chains: the polyline of steps becomes a drawn curve, the start nodes stay put
  for (let pass = 0; pass < 4; pass++) {
    const nx = Float32Array.from(x), ny = Float32Array.from(y);
    for (let i = 0; i < n; i++) {
      if (p[i] < 0 || main[i] < 0) continue;
      nx[i] = (x[p[i]] + 2 * x[i] + x[main[i]]) / 4;
      ny[i] = (y[p[i]] + 2 * y[i] + y[main[i]]) / 4;
    }
    x.set(nx); y.set(ny);
  }
  // flow distance from the seed
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = p[i] < 0 ? 0 : s[p[i]] + Math.hypot(x[i] - x[p[i]], y[i] - y[p[i]]);
  // pipe model at each sample time: a tip carries 1, a length of wood a little
  const K = RAD_T.length;
  const A = new Float32Array(n * K);
  for (let i = n - 1; i >= 0; i--) {
    for (let k = 0; k < K; k++) {
      if (t[i] > RAD_T[k]) continue;
      const own = A[i * K + k] > 0 ? o.wood : 1;
      A[i * K + k] += own;
      if (p[i] >= 0) A[p[i] * K + k] += A[i * K + k];
    }
  }
  const rad = new Float32Array(n * K);
  for (let i = 0; i < n; i++) {
    const fl = 1 + o.flare * Math.exp(-s[i] / o.flareLen);
    for (let k = 0; k < K; k++) {
      const a = A[i * K + k];
      rad[i * K + k] = o.rTip * (a > 0 ? Math.pow(a, 1 / o.E) * fl : 1);
    }
  }
  // chains
  /** @type {{pts:number[], first:number, death:number, vig:number, rnd:number}[]} */
  const chains = [];
  /** @type {{attach:number, first:number}[]} */
  const stack = [];
  let totalA = 2;
  for (let i = 0; i < n; i++) if (p[i] < 0) { stack.push({ attach: -1, first: i }); totalA = Math.max(totalA, A[i * K + K - 1]); }
  /** death of a node's leaves and wood, 9 for never */
  const shedAt = new Float32Array(n).fill(9);
  while (stack.length) {
    const { attach, first } = /** @type {{attach:number, first:number}} */ (stack.pop());
    /** @type {number[]} */
    const pts = attach >= 0 ? [attach] : [];
    let c = first;
    while (c >= 0) {
      pts.push(c);
      for (const k of kids[c]) if (k !== main[c]) stack.push({ attach: c, first: k });
      c = main[c];
    }
    const finalA = A[first * K + K - 1];
    // a branch is never left floating: it goes when the wood it grows from goes
    let death = shedAt[first];
    // a small twig that stopped growing early is shed, which clears the trunk as the tree rises
    if (o.shed && attach >= 0 && y[attach] < o.shedBelow && finalA < 40 && last[first] < 0.85) death = Math.min(death, last[first] + 0.14 + rnd() * 0.12);
    if (death < 9) { const stackB = [first]; while (stackB.length) { const q = /** @type {number} */ (stackB.pop()); shedAt[q] = Math.min(shedAt[q], death); for (const k of kids[q]) stackB.push(k); } }
    chains.push({ pts, first, death, vig: Math.min(1, Math.log(finalA + 1) / Math.log(totalA + 1)), rnd: rnd() });
  }
  // thick first, so twigs draw over their limbs
  chains.sort((a, b) => b.vig - a.vig);

  let verts = 0, quads = 0;
  for (const ch of chains) { verts += ch.pts.length * 2; quads += ch.pts.length - 1; }
  const position = new Float32Array(verts * 3);
  const prevNormal = new Float32Array(verts * 4);
  const life = new Float32Array(verts * 4);
  const radA = new Float32Array(verts * 4);
  const radB = new Float32Array(verts * 4);
  const meta = new Float32Array(verts * 4);
  const joinFrame = new Float32Array(verts * 4);
  const index = new Uint32Array(quads * 6);
  let v = 0, q = 0;
  for (const ch of chains) {
    const P2 = ch.pts;
    const base = v;
    const attached = p[ch.first] >= 0 && P2[0] !== ch.first;
    /* The collar: a branch leaves its parent as one form. Its base starts nearly as wide as the
       parent, centered inside it, and sweeps down to its own radius over a short length. It is
       baked into every thickness sample, so the joint keeps its shape as both limbs thicken. */
    const pid = attached ? P2[0] : -1;
    const collarLen = attached ? Math.min(0.06, Math.max(0.01, rad[pid * K + K - 1] * 2.6)) : 0;
    let pnx = 0, pny = 0;
    if (attached) {
      const before = p[pid] >= 0 ? p[pid] : pid, after = main[pid] >= 0 ? main[pid] : pid;
      let tx = x[after] - x[before], ty = y[after] - y[before];
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      pnx = -ty; pny = tx;
    }
    let along = 0;
    for (let i = 0; i < P2.length; i++) {
      const id = P2[i];
      if (i > 0) along += Math.hypot(x[id] - x[P2[i - 1]], y[id] - y[P2[i - 1]]);
      const cu = attached ? Math.max(0, 1 - along / collarLen) : 0;
      // falls off fast at first, so the joint flares like a crotch instead of swelling into a knob
      const join = Math.pow(cu, 2.2);
      const prev = P2[Math.max(0, i - 1)];
      const pa = P2[Math.max(0, i - 1)], pb = P2[Math.min(P2.length - 1, i + 1)];
      let tx = x[pb] - x[pa], ty = y[pb] - y[pa];
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      // the attach point appears one frame before the first new node, at the parent's center
      let birth = attached && i === 0 ? t[ch.first] - o.dt : t[id];
      let pBirth = i === 0 ? birth : Math.max(attached && i === 1 ? t[ch.first] - o.dt : t[prev], birth - o.dt);
      if (pBirth > birth) pBirth = birth;
      // radius: the attach point uses the child's own radius, so it emerges from inside the parent
      const rid = attached && i === 0 ? ch.first : id;
      const sinkK = o.sign > 0 && y[id] < o.sinkY ? 0.82 + 0.18 * Math.max(0, Math.min(1, (y[id] - o.sinkY + 0.05) / 0.05)) : 1;
      for (let side = -1; side <= 1; side += 2) {
        position[v * 3] = x[id]; position[v * 3 + 1] = y[id]; position[v * 3 + 2] = 0;
        prevNormal[v * 4] = x[prev]; prevNormal[v * 4 + 1] = y[prev]; prevNormal[v * 4 + 2] = -ty; prevNormal[v * 4 + 3] = tx;
        life[v * 4] = birth; life[v * 4 + 1] = pBirth; life[v * 4 + 2] = o.sign * s[id]; life[v * 4 + 3] = ch.death;
        for (let k = 0; k < K; k++) {
          let r = rad[rid * K + k] * sinkK;
          if (join > 0) r = Math.max(r, join * 0.92 * rad[pid * K + k]);
          if (k < 4) radA[v * 4 + k] = r; else radB[v * 4 + k - 4] = r;
        }
        meta[v * 4] = side; meta[v * 4 + 1] = ch.rnd; meta[v * 4 + 2] = ch.vig; meta[v * 4 + 3] = join;
        if (attached) { joinFrame[v * 4] = x[pid]; joinFrame[v * 4 + 1] = y[pid]; joinFrame[v * 4 + 2] = pnx; joinFrame[v * 4 + 3] = pny; }
        v++;
      }
    }
    for (let i = 0; i < P2.length - 1; i++) {
      const a0 = base + i * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
      index[q++] = a0; index[q++] = b0; index[q++] = a1;
      index[q++] = a1; index[q++] = b0; index[q++] = b1;
    }
  }
  /** @type {Ribbon} */
  const ribbon = { position, prevNormal, life, radA, radB, meta, joinFrame, index };
  return { ribbon, kids, main, s, shedAt, chains: chains.length, A };
}

/** @param {number} a @param {number} b @param {number} k */
function turnToward(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/**
 * Roots as timed walks. Every node keeps its birth time; a parent always precedes its children.
 * @param {() => number} rnd
 * @param {boolean} hi
 * @returns {Net}
 */
function walkRoots(rnd, hi) {
  const R = (/** @type {number} */ a, /** @type {number} */ b) => a + (b - a) * rnd();
  const step = hi ? 0.0095 : 0.012;
  const cap = hi ? 11000 : 5000;
  const maxRoots = hi ? 420 : 220;
  /** @type {number[]} */ const X = [], Y = [], T = [], P = [];
  /** @param {number} x @param {number} y @param {number} t @param {number} p */
  const add = (x, y, t, p) => { X.push(x); Y.push(y); T.push(t); P.push(p); return X.length - 1; };
  const collar = add(0, 0.02, 0, -1);
  /** @typedef {{node:number, a:number, vig:number, t:number, len:number, main:boolean}} RootTip */
  /** @type {RootTip[]} */
  const queue = [];
  const nMain = hi ? 7 : 5;
  for (let i = 0; i < nMain; i++) {
    const v = (i / (nMain - 1)) * 2 - 1;
    const a = -UP + Math.sign(v) * Math.pow(Math.abs(v), 0.55) * 1.32 + gauss(rnd) * 0.05;
    const level = Math.abs(Math.cos(a));
    // the wide roots run to the edges of the hero; the deep ones are shorter
    queue.push({ node: collar, a, vig: 0.62 + 0.38 * level, t: R(0, 0.02), len: level > 0.55 ? 9 : R(0.3, 0.5), main: level > 0.55 });
  }
  let roots = 0;
  while (queue.length && roots < maxRoots && X.length < cap) {
    const tip = /** @type {RootTip} */ (queue.shift());
    roots++;
    let { a, t } = tip;
    let x = X[tip.node], y = Y[tip.node], node = tip.node;
    const vig = tip.vig;
    // speed in world units per unit of life; a main root crosses the hero over the whole life
    const speed = tip.main ? R(1.75, 2.05) : 0.5 + 1.1 * vig;
    const curl = gauss(rnd) * (0.6 + 1.6 * (1 - vig));
    const wig = (0.28 + 0.4 * (1 - vig)) * Math.sqrt(step);
    const dir = Math.cos(a) >= 0 ? 1 : -1;
    // each root settles toward its own shallow descent; lesser roots drop more
    const drop = tip.main ? R(0.03, 0.12) : 0.25 + 0.5 * (1 - vig) + R(0, 0.15);
    const settle = dir > 0 ? -drop : Math.PI + drop;
    const floor = tip.main ? -0.05 - R(0, 0.17) : -0.14 - 0.18 * (1 - vig) - R(0, 0.1);
    let nextLat = R(0.03, 0.07);
    let nextFork = tip.main && vig > 0.7 ? R(0.45, 0.8) : 9;
    let side = rnd() < 0.5 ? 1 : -1;
    let along = 0;
    while (along < tip.len) {
      a += curl * step * 0.6 + gauss(rnd) * wig;
      a = turnToward(a, settle, 0.03 + 0.02 * (1 - vig));
      if (y < floor) a = turnToward(a, dir > 0 ? 0.04 : Math.PI - 0.04, 0.06);
      if (y > -0.018) a = turnToward(a, -UP, 0.14);
      x += Math.cos(a) * step; y += Math.sin(a) * step;
      t += step / speed;
      along += step;
      if (t > 1 || y < -0.5 || Math.abs(x) > 2.2) break;
      node = add(x, y, t, node);
      if (X.length >= cap) break;
      // laterals behind the tip, at acute angles, fine and short
      if (along >= nextLat && vig > 0.3) {
        nextLat = along + (tip.main ? R(0.07, 0.14) : R(0.09, 0.18));
        const off = R(0.4, 0.85) * side;
        side = -side;
        const lv = vig * R(0.42, 0.58);
        queue.push({ node, a: a + off, vig: lv, t: t + R(0.01, 0.05), len: 0.08 + 0.75 * lv * R(0.6, 1.2), main: false });
      }
      // a main root splits now and then, and both halves run on
      if (along >= nextFork) {
        nextFork = vig * 0.86 > 0.7 ? along + R(0.5, 0.9) : 9;
        queue.push({ node, a: a + (rnd() < 0.5 ? 1 : -1) * R(0.18, 0.36), vig: vig * 0.86, t: t + 0.006, len: 9, main: vig * 0.86 > 0.55 });
      }
    }
    queue.sort((p, q) => q.vig - p.vig);
  }
  return { n: X.length, x: Float32Array.from(X), y: Float32Array.from(Y), t: Float32Array.from(T), p: Int32Array.from(P) };
}

/**
 * Generate one tree with its roots and leaves.
 * @param {number} seed
 * @param {{quality:number, lean:number}} opt  quality 1 on desktop, about 0.6 on small or low-power devices
 * @returns {TreeVariant}
 */
export function generateTree(seed, opt) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const rnd = mulberry32(seed);
  const q = opt.quality;
  const lean = opt.lean;
  const R = (/** @type {number} */ a, /** @type {number} */ b) => a + (b - a) * rnd();
  const hi = q >= 1;

  /* ---- Crown: an envelope that rises and widens with the life of the tree ---- */
  const HT = 1.5;
  /** @param {number} T */
  const crownTop = (T) => 0.03 + (HT - 0.03) * Math.pow(T, 0.82);
  /** @param {number} x @param {number} y @param {number} T */
  const inCrown = (x, y, T) => {
    const h = crownTop(T);
    // a young crown sits higher on its stem; the mature one reaches lower and wider
    const ry = (0.33 + 0.11 * T) * h, cy = h - ry;
    const rx = 0.03 + 0.74 * h, cx = -lean * h;
    // flatter underside, a fuller shoulder: a mother tree's dome
    const dy = (y - cy) / ry;
    const k = dy < 0 ? 1.6 : 1;
    const dx = (x - cx) / rx;
    return dx * dx + dy * dy * k < 1 && y > 0.035;
  };
  const crownNoise = noise2(rnd, 4.2);
  const fine = noise2(rnd, 11);
  // the leader: a loose column of guides that the envelope's top wakes, so the young tree rises first
  /** @type {{x:number, y:number, act:number}[]} */
  const leader = [];
  for (let yy = 0.03; yy < 0.3 * HT; yy += 0.022) {
    const x = -lean * yy * 0.5 + gauss(rnd) * 0.004;
    let T = 0;
    while (T < 1 && crownTop(T) < yy + 0.01) T += 0.002;
    leader.push({ x, y: yy, act: T });
  }
  const box = /** @type {[number, number, number, number]} */ ([-lean * HT - (0.03 + 0.74 * HT), 0.03, -lean * HT + 0.03 + 0.74 * HT, HT]);
  const crownA = attractors(rnd, inCrown, box, hi ? 4400 : 2400,
    (x, y) => 0.4 + 0.6 * Math.pow(crownNoise(x, y) * 0.75 + fine(x, y) * 0.25, 1.3), leader);

  const steps = 360;
  const dt = 1 / steps;
  const D = hi ? 0.0085 : 0.011;
  const crownNet = colonize({
    ...crownA,
    starts: [{ x: 0, y: -0.045, t: 0, p: -1 }, { x: 0, y: -0.012, t: 0, p: 0 }],
    steps, D, di: hi ? 0.09 : 0.11, dk: hi ? 0.022 : 0.028,
    // light from above, softer once the branch leans out
    bias: (x, y, dx, dy) => [Math.max(-0.12, Math.min(0.12, x * 0.16)), 0.06 + 0.05 * Math.max(0, dy)],
    column: (yy) => -lean * yy * 0.5,
    columnTop: 0.32 * HT,
    leadUp: 1.2,
    // low wood on branches that leave the trunk below the rising crown base falls into shade
    lit: (ay, yy, T) => ay > 0.15 * crownTop(T) - 0.03 || yy > 0.3 * crownTop(T),
    maxNodes: hi ? 22000 : 10000,
    rnd, wander: 0.11
  });
  const tree = build(crownNet, { rTip: hi ? 0.0017 : 0.0021, E: 2.05, wood: 0.1, flare: 0.55, flareLen: 0.06, sign: 1, dt, shed: true, shedBelow: 0.2 * HT, sinkY: 0.012 }, rnd);

  /* ---- Roots: tips that never stop. Main roots advance outward the whole life, wander, and
     fork now and then; laterals keep sprouting behind every tip at acute angles. ---- */
  const rootNet = walkRoots(rnd, hi);
  const roots = build(rootNet, { rTip: hi ? 0.0011 : 0.0014, E: 2.2, wood: 0.05, flare: 0.9, flareLen: 0.05, sign: -1, dt, shed: false, shedBelow: 0, sinkY: -9 }, rnd);

  /* ---- Leaves: born at new nodes, fall once the branch has grown well past them ---- */
  const { n, x, y, t, p } = crownNet;
  const shade = new Float32Array(n).fill(9);
  const SHADE = 0.34;
  for (let i = 0; i < n; i++) {
    let d = 0, c = i;
    while (p[c] >= 0 && d < SHADE) { const pp = p[c]; d += Math.hypot(x[c] - x[pp], y[c] - y[pp]); c = pp; }
    if (d >= SHADE && t[i] < shade[c]) shade[c] = t[i];
  }
  /** @type {number[]} */
  const la = [];
  /** @type {number[]} */
  const lb = [];
  /** @type {{x:number, y:number, birth:number}[]} */
  const perches = [];
  /** @param {number} lx @param {number} ly @param {number} ang @param {number} len @param {number} birth @param {number} death @param {number} ls */
  function leaf(lx, ly, ang, len, birth, death, ls) {
    la.push(lx, ly, ang, len);
    lb.push(birth, death, ls, rnd());
  }
  // the first pair of leaves on the bud; they fall as the sapling rises
  let bud = 1;
  for (let i = 1; i < n; i++) if (y[i] > 0.03 && x[i] * x[i] < 0.01) { bud = i; break; }
  leaf(x[bud], y[bud], UP + 0.95, 0.034, t[bud] + 0.004, 0.2, tree.s[bud]);
  leaf(x[bud], y[bud], UP - 0.95, 0.03, t[bud] + 0.008, 0.22, tree.s[bud]);
  const leafP = hi ? 0.75 : 0.62;
  for (let i = 2; i < n; i++) {
    const pp = p[i];
    if (pp < 0 || y[i] < 0.06) continue;
    const head = Math.atan2(y[i] - y[pp], x[i] - x[pp]);
    const tip = tree.kids[i].length === 0;
    const end = Math.min(tree.shedAt[i] + 0.02, shade[i] < 9 ? shade[i] + R(0.05, 0.14) : 9);
    if (rnd() < leafP) {
      const birth = t[i] + R(0.006, 0.03);
      if (end > birth + 0.04) leaf(x[i], y[i], head + (rnd() < 0.5 ? 1 : -1) * R(0.5, 1.05) + gauss(rnd) * 0.1, R(0.024, 0.034), birth, end, tree.s[i]);
    }
    if (tip) {
      const birth = t[i] + 0.012;
      const sd = rnd() < 0.5 ? 1 : -1;
      leaf(x[i], y[i], head + sd * R(0.12, 0.38), R(0.026, 0.034), birth, end, tree.s[i]);
      if (rnd() < 0.55) leaf(x[i], y[i], head - sd * R(0.5, 0.9), R(0.019, 0.026), birth + 0.01, end, tree.s[i]);
      if (end >= 9) perches.push({ x: x[i], y: y[i], birth });
    }
  }

  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return {
    tree: tree.ribbon,
    roots: roots.ribbon,
    leaves: { a: new Float32Array(la), b: new Float32Array(lb), count: la.length / 4 },
    perches,
    stats: { nodes: crownNet.n, rootNodes: rootNet.n, branches: tree.chains, rootBranches: roots.chains, leaves: la.length / 4, vertices: tree.ribbon.position.length / 3 + roots.ribbon.position.length / 3, ms: Math.round(ms) }
  };
}
