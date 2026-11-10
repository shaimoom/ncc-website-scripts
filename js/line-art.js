/* Newaz Clinical Consulting, line art. Round 4, round 5 (no dust), round 6 (square cards, set in CSS), round 7 (the map has no frame).
   One small 2D canvas system for every drawn illustration below the hero:
   the three value panels. (The proof line and the closing curve were retired in round 5.)

   Everything shares one look, the look of the clarity strip and the hero's glow:
   - fine lines: LINE (1.25 CSS px) for a drawn line, HAIR (0.75) for structure, each with one soft halo
   - points of light: spark() is the only particle, glow() the only bloom, both from one sprite per color
   - colors: read from the CSS tokens; sky-blue Biscuit lines, gold Saif highlights,
     white cores, and --signal-stop for the dead-end glow only
   - easing: the CSS motion tokens (--ease-organic, --ease-out, --ease-settle), parsed, so CSS and canvas move alike
   - no backgrounds drawn here: since round 6 each canvas sits inside a square card (CSS), with no dust or stars

   A stage draws only while it is on screen and the tab is visible, and starts its clock
   when it becomes active. Under reduced motion each stage draws one still, final frame.
   ?art-debug exposes window.__nccArt.seek(name, seconds) for filmstrips.

   Round 11 (Shai's iPhone: "the solution illustrations are still not loading"; his screenshot showed no card at all):
   the card's height no longer depends on aspect-ratio (a .journey__sizer gives it, see the CSS). Here, each panel is
   hardened so its area is never blank: a panel that cannot start (no 2D context, an error while drawing, a canvas
   with no size) draws its final still frame, or, when even that fails, shows the still image in the card
   (.journey__still, not displayed while the canvas draws). Sizes come from the element box (not transformed rects), the
   backing store is capped at DPR 2 and 4 megapixels, no newer canvas API is required (getTransform is optional), and
   a scroll check backs up the IntersectionObserver start. */
// @ts-check
(function () {
  'use strict';

  /**
   * @typedef {{x: number, y: number}} Pt
   * @typedef {{x: number, y: number, a: number}} PathPoint  a: tangent angle, radians
   * @typedef {Object} View
   * @property {number} W     canvas width, CSS px
   * @property {number} H     canvas height, CSS px
   * @property {number} s     CSS px per design unit
   * @property {number} ox    design origin, CSS px
   * @property {number} oy
   * @property {boolean} still  reduced motion: draw the final frame
   * @property {number[]} m     the drawing transform (a, b, c, d, e, f), device px, for offscreen layers
   * @typedef {Object} Scene
   * @property {[number, number] | null} design   design space; null means CSS px
   * @property {number} stillAt                   the time drawn under reduced motion
   * @property {(v: View) => void} [layout]
   * @property {(ctx: CanvasRenderingContext2D, t: number, v: View) => void} draw
   */

  var doc = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var debug = /[?&]art-debug\b/.test(location.search);
  var css = getComputedStyle(doc);
  /** @param {string} n */
  function tok(n) { return css.getPropertyValue(n).trim(); }

  /* ---------- Palette, from the tokens ---------- */
  var C = {
    gold: tok('--c-saif') || '#F8C426',
    sky: tok('--c-biscuit') || '#6BCCE0',
    white: tok('--c-white') || '#FFFFFF',
    stop: tok('--signal-stop') || '#D9776C',
    ayanna: tok('--c-ayanna') || '#2D2E8B',
    kaia: tok('--c-kaia') || '#121237'
  };
  /** @param {string} hex @returns {[number, number, number]} */
  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  /** @param {string} a @param {string} b @param {number} t */
  function mix(a, b, t) {
    var x = rgb(a), y = rgb(b);
    return '#' + [0, 1, 2].map(function (i) { return ('0' + Math.round(x[i] + (y[i] - x[i]) * t).toString(16)).slice(-2); }).join('');
  }
  /* the folded map's paper: a shade lighter than the panel ground, opaque so folds hide what is behind */
  var PAPER = mix(mix(C.kaia, C.ayanna, 0.42), C.sky, 0.05);
  var PAPER_BACK = mix(mix(C.kaia, C.ayanna, 0.28), C.sky, 0.03);

  /* ---------- Shared measures ---------- */
  var LINE = 1.25;   // a drawn line, CSS px
  var HAIR = 0.75;   // structure: grid, contours, creases, idle network
  var HALO = 5;      // halo width as a multiple of the line width
  var HALO_A = 0.11; // halo strength

  /* ---------- Easing, from the motion tokens ---------- */
  /** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @returns {(x: number) => number} */
  function bezier(x1, y1, x2, y2) {
    /** @param {number} t @param {number} a @param {number} b */
    function f(t, a, b) { var u = 1 - t; return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t; }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var lo = 0, hi = 1, t = x;
      for (var i = 0; i < 22; i++) { var v = f(t, x1, x2); if (Math.abs(v - x) < 1e-5) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; }
      return f(t, y1, y2);
    };
  }
  /** @param {string} name @param {number[]} fallback */
  function easeToken(name, fallback) {
    var m = tok(name).match(/cubic-bezier\(([^)]+)\)/);
    var p = m ? m[1].split(',').map(parseFloat) : fallback;
    return bezier(p[0], p[1], p[2], p[3]);
  }
  var E = {
    organic: easeToken('--ease-organic', [0.3, 0.7, 0.1, 1]),
    out: easeToken('--ease-out', [0.22, 0.8, 0.24, 1]),
    settle: easeToken('--ease-settle', [0.45, 0, 0.2, 1]),
    /** @param {number} t */ inSine: function (t) { return 1 - Math.cos(clamp01(t) * Math.PI / 2); },
    /** @param {number} t */ outSine: function (t) { return Math.sin(clamp01(t) * Math.PI / 2); }
  };

  /** @param {number} v */
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  /** progress of t through [a, a + d], clamped @param {number} t @param {number} a @param {number} d */
  function seg(t, a, d) { return clamp01((t - a) / d); }
  /** @param {number} a @param {number} b @param {number} t */
  function lerp(a, b, t) { return a + (b - a) * t; }
  /** deterministic random @param {number} seed */
  function rng(seed) {
    var a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /* ---------- Paths: polylines with arc length ---------- */
  /** @param {Pt[]} pts @param {boolean} [closed] */
  function Path(pts, closed) {
    if (closed) pts = pts.concat([pts[0]]);
    this.pts = pts;
    this.cum = [0];
    for (var i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    this.len = this.cum[this.cum.length - 1];
    this.closed = !!closed;
  }
  /** @param {number} s @returns {number} index of the segment holding s */
  Path.prototype.find = function (s) {
    var lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    return lo;
  };
  /** @param {number} s @returns {PathPoint} */
  Path.prototype.at = function (s) {
    if (this.closed) s = ((s % this.len) + this.len) % this.len;
    else s = Math.min(Math.max(s, 0), this.len);
    var i = this.find(s), p = this.pts[i], q = this.pts[Math.min(i + 1, this.pts.length - 1)];
    var d = this.cum[i + 1] - this.cum[i] || 1, k = (s - this.cum[i]) / d;
    return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, a: Math.atan2(q.y - p.y, q.x - p.x) };
  };
  /** add the stretch s0..s1 to the current canvas path @param {CanvasRenderingContext2D} ctx @param {number} s0 @param {number} s1 */
  Path.prototype.trace = function (ctx, s0, s1) {
    if (this.closed && (s0 < 0 || s1 > this.len)) {
      var L = this.len;
      var a = ((s0 % L) + L) % L, b = a + (s1 - s0);
      if (b <= L) { this.trace(ctx, a, b); return; }
      this.trace(ctx, a, L); this.trace(ctx, 0, b - L); return;
    }
    s0 = Math.max(0, s0); s1 = Math.min(this.len, s1);
    if (s1 <= s0) return;
    var p = this.at(s0);
    ctx.moveTo(p.x, p.y);
    for (var i = this.find(s0) + 1; i < this.pts.length && this.cum[i] < s1; i++) ctx.lineTo(this.pts[i].x, this.pts[i].y);
    var e = this.at(s1);
    ctx.lineTo(e.x, e.y);
  };
  /** the arc length at the point nearest to pt @param {Pt} pt */
  Path.prototype.sOf = function (pt) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < this.pts.length; i++) { var d = Math.hypot(this.pts[i].x - pt.x, this.pts[i].y - pt.y); if (d < bd) { bd = d; best = this.cum[i]; } }
    return best;
  };

  /** Catmull-Rom through points @param {Pt[]} p @param {number} [n] */
  function spline(p, n) {
    n = n || 18;
    var out = [];
    for (var i = 0; i < p.length - 1; i++) {
      var a = p[Math.max(i - 1, 0)], b = p[i], c = p[i + 1], d = p[Math.min(i + 2, p.length - 1)];
      for (var k = 0; k < n; k++) {
        var t = k / n, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5 * (2 * b.x + (-a.x + c.x) * t + (2 * a.x - 5 * b.x + 4 * c.x - d.x) * t2 + (-a.x + 3 * b.x - 3 * c.x + d.x) * t3),
          y: 0.5 * (2 * b.y + (-a.y + c.y) * t + (2 * a.y - 5 * b.y + 4 * c.y - d.y) * t2 + (-a.y + 3 * b.y - 3 * c.y + d.y) * t3)
        });
      }
    }
    out.push(p[p.length - 1]);
    return out;
  }
  /** cubic bezier points @param {Pt} a @param {Pt} b @param {Pt} c @param {Pt} d @param {number} n */
  function cubic(a, b, c, d, n) {
    var out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, u = 1 - t;
      out.push({ x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x, y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y });
    }
    return out;
  }
  /** A closed loop through vertices, each corner rounded by its radius (0 keeps a sharp corner).
      Arc length 0 sits at the start of vertex 1's corner. @param {Pt[]} v @param {number[]} r */
  function roundedLoop(v, r) {
    var n = v.length, out = [];
    for (var i = 1; i <= n; i++) {
      var p = v[(i - 1 + n) % n], c = v[i % n], q = v[(i + 1) % n], rad = r[i % n];
      if (!rad) { out.push({ x: c.x, y: c.y }); continue; }
      var d1 = Math.hypot(c.x - p.x, c.y - p.y), d2 = Math.hypot(q.x - c.x, q.y - c.y);
      var a = { x: c.x + (p.x - c.x) / d1 * rad, y: c.y + (p.y - c.y) / d1 * rad };
      var b = { x: c.x + (q.x - c.x) / d2 * rad, y: c.y + (q.y - c.y) / d2 * rad };
      for (var k = 0; k <= 8; k++) {
        var t = k / 8, u = 1 - t;
        out.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
      }
    }
    return new Path(out, true);
  }

  /* ---------- Drawing primitives, the shared look ---------- */
  /** @type {Record<string, HTMLCanvasElement | null>} */
  var sprites = {};
  /** one soft bloom per color, the canvas twin of the hero's bloom @param {string} color */
  function sprite(color) {
    if (color in sprites) return sprites[color];
    var c = document.createElement('canvas'); c.width = c.height = 96;
    var g = c.getContext('2d');
    if (!g) return null;
    var v = rgb(color.charAt(0) === '#' ? color : '#ffffff'), s = v.join(',');
    var gr = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    gr.addColorStop(0, 'rgba(' + s + ',1)');
    gr.addColorStop(0.1, 'rgba(' + s + ',0.62)');
    gr.addColorStop(0.3, 'rgba(' + s + ',0.2)');
    gr.addColorStop(0.62, 'rgba(' + s + ',0.05)');
    gr.addColorStop(1, 'rgba(' + s + ',0)');
    g.fillStyle = gr; g.fillRect(0, 0, 96, 96);
    sprites[color] = c;
    return c;
  }
  /** @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y @param {number} r design units @param {string} color @param {number} a */
  function glow(ctx, x, y, r, color, a) {
    if (a <= 0.003 || r <= 0) return;
    var img = sprite(color);
    if (!img) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(a, 1);
    ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  /** a filled dot, radius in CSS px @param {CanvasRenderingContext2D} ctx @param {View} v @param {number} x @param {number} y @param {number} r @param {string} color @param {number} a */
  function dot(ctx, v, x, y, r, color, a) {
    if (a <= 0.003) return;
    ctx.globalAlpha = Math.min(a, 1);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r / v.s, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  /** a hairline ring, radius in CSS px @param {CanvasRenderingContext2D} ctx @param {View} v @param {number} x @param {number} y @param {number} r @param {string} color @param {number} a @param {number} [w] */
  function ring(ctx, v, x, y, r, color, a, w) {
    if (a <= 0.003) return;
    ctx.globalAlpha = Math.min(a, 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = (w || HAIR) / v.s;
    ctx.beginPath(); ctx.arc(x, y, r / v.s, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  /** The one particle: a white core in a colored point, in a soft bloom. size 1 is the standard spark.
      @param {CanvasRenderingContext2D} ctx @param {View} v @param {number} x @param {number} y @param {string} color @param {number} a @param {number} [size] */
  function spark(ctx, v, x, y, color, a, size) {
    var k = size || 1;
    glow(ctx, x, y, 22 * k / v.s, color, 0.55 * a);
    dot(ctx, v, x, y, 2.3 * k, color, a);
    dot(ctx, v, x, y, 1.1 * k, C.white, 0.9 * a);
  }
  /** Stroke whatever build() traces, in the shared line style: a crisp line over one soft halo.
      @param {CanvasRenderingContext2D} ctx @param {View} v @param {(ctx: CanvasRenderingContext2D) => void} build
      @param {string} color @param {number} a @param {number} [w] CSS px @param {number[] | null} [dash] CSS px
      @param {boolean} [butt] square ends, for a line drawn in chunks so the joins do not bead */
  function stroke(ctx, v, build, color, a, w, dash, butt) {
    if (a <= 0.003) return;
    var lw = (w || LINE) / v.s;
    ctx.lineCap = butt ? 'butt' : 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.beginPath(); build(ctx);
    if (!dash) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(a * HALO_A, 1);
      ctx.lineWidth = lw * HALO;
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = Math.min(a, 1);
    ctx.lineWidth = lw;
    if (dash) ctx.setLineDash(dash.map(function (d) { return d / v.s; }));
    ctx.stroke();
    if (dash) ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /** Round 7: an offscreen layer the size of ctx's canvas, cleared, with the view's drawing transform, one per canvas.
      Round 11: the transform comes from the view (v.m), not ctx.getTransform(), which older Safari lacks.
      Null when the browser will not give another 2D context (iOS canvas memory): the caller draws without the layer.
      @type {WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>} */
  var layers = new WeakMap();
  /** @param {CanvasRenderingContext2D} ctx @param {View} v @returns {CanvasRenderingContext2D | null} */
  function layer(ctx, v) {
    var lc = layers.get(ctx.canvas);
    if (!lc) {
      var lctx = document.createElement('canvas').getContext('2d');
      if (!lctx) return null;
      lc = lctx;
      layers.set(ctx.canvas, lc);
    }
    if (lc.canvas.width !== ctx.canvas.width || lc.canvas.height !== ctx.canvas.height) {
      lc.canvas.width = ctx.canvas.width; lc.canvas.height = ctx.canvas.height;
    }
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalAlpha = 1; lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, lc.canvas.width, lc.canvas.height);
    lc.setTransform(v.m[0], v.m[1], v.m[2], v.m[3], v.m[4], v.m[5]);
    return lc;
  }
  /** Fade a layer out toward the rim of an ellipse: solid in the middle, gone at the rim (design units).
      @param {CanvasRenderingContext2D} lc @param {number} x @param {number} y @param {number} rx @param {number} ry */
  function vignette(lc, x, y, rx, ry) {
    lc.save();
    lc.globalCompositeOperation = 'destination-in';
    lc.translate(x, y); lc.scale(rx, ry);
    var gr = lc.createRadialGradient(0, 0, 0, 0, 0, 1);
    gr.addColorStop(0, 'rgba(0,0,0,1)');
    gr.addColorStop(0.58, 'rgba(0,0,0,1)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    lc.fillStyle = gr;
    lc.fillRect(-4, -4, 8, 8);
    lc.restore();
  }

  /* =====================================================================
     Panel 1, A Clear Roadmap
     A folded map in technical line art opens, panel by panel, then its lower half
     drops open, and its paper fades into the card (round 7: no frame). Grid and contours draw in, fading at
     their edges, a gold route traces from A to B,
     B glows and radiates, then holds with a gentle pulse while a small light
     travels the route now and then.
     ===================================================================== */
  /** @returns {Scene} */
  function Roadmap() {
    var PW = 116, PH = 150, COLS = 4;
    var cx = 280, cy = 300;
    var MW = PW * COLS, MH = PH * 2;
    var X0 = cx - MW / 2, Y0 = cy - MH / 2;
    // timeline, seconds
    var T = { swing0: 0.55, swingGap: 0.4, swingDur: 0.62, dropAt: 1.95, dropDur: 0.7, gridAt: 2.55, contourAt: 2.65, aAt: 3.3, routeAt: 3.7, routeDur: 2.5, rings: 0.36, hold: 6.2 };
    var arrive = T.routeAt + T.routeDur;

    // contours: two hills, irregular rings, clipped to the open map
    var r = rng(7);
    /** @type {Path[]} */
    var contours = [];
    [{ x: cx - 78, y: cy + 34, n: 4 }, { x: cx + 96, y: cy - 44, n: 4 }].forEach(function (hill) {
      var p1 = r() * 6, p2 = r() * 6;
      for (var k = 1; k <= hill.n; k++) {
        var rad = 20 + k * 24, pts = [];
        for (var i = 0; i < 96; i++) {
          var th = i / 96 * Math.PI * 2;
          var rr = rad * (1 + 0.13 * Math.sin(3 * th + p1 + k * 0.35) + 0.07 * Math.sin(5 * th + p2 - k * 0.2));
          pts.push({ x: hill.x + Math.cos(th) * rr * 1.18, y: hill.y + Math.sin(th) * rr * 0.82 });
        }
        contours.push(new Path(pts, true));
      }
    });
    var A = { x: X0 + 46, y: Y0 + MH - 40 };
    var B = { x: X0 + MW - 54, y: Y0 + 50 };
    var route = new Path(spline([A, { x: A.x + 52, y: A.y - 6 }, { x: cx - 40, y: cy + 36 }, { x: cx - 8, y: cy - 22 }, { x: cx + 40, y: cy - 34 }, { x: B.x - 56, y: B.y + 30 }, B], 22));

    /** @param {number} t @returns {{u: number[], drop: number}} */
    function fold(t) {
      var u = [1];
      for (var k = 1; k < COLS; k++) u.push(E.organic(seg(t, T.swing0 + (k - 1) * T.swingGap, T.swingDur)));
      return { u: u, drop: E.organic(seg(t, T.dropAt, T.dropDur)) };
    }

    return {
      design: [560, 600],
      stillAt: 60,
      draw: function (ctx, t, v) {
        var appear = E.out(seg(t, 0, 0.5));
        var f = fold(t);
        // a z-fold: each crease folds the opposite way to the last, so the absolute angle
        // of panel k is the alternating sum of the crease angles before it
        var alpha = [0], k;
        for (k = 1; k < COLS; k++) alpha.push(alpha[k - 1] + (k % 2 ? 1 : -1) * Math.PI * (1 - f.u[k]));
        // the open width: hinge chain extent
        var hx = 0, lo = 0, hi = PW;
        for (k = 1; k < COLS; k++) { hx += PW * (k === 1 ? 1 : Math.cos(alpha[k - 1])); var fx = hx + PW * Math.cos(alpha[k]); lo = Math.min(lo, hx, fx); hi = Math.max(hi, hx, fx); }
        var w = hi - lo;
        var psi = Math.PI * (1 - f.drop);
        var h = PH + PH * Math.max(0, Math.cos(psi));
        var x0 = cx - w / 2 - lo, y0 = cy - h / 2;
        var open = f.drop >= 1;
        var lift = (1 - appear) * 14;

        ctx.save();
        ctx.translate(0, lift);
        ctx.globalAlpha = 1;
        // panels of the top row: hinge chain, each free edge leans toward the viewer as it swings
        var quads = [], hinge = x0, hs = 1;
        for (k = 0; k < COLS; k++) {
          var phi = alpha[k];
          var free = hinge + PW * Math.cos(phi);
          var fs = 1 + 0.2 * Math.abs(Math.sin(phi));
          quads.push({ k: k, phi: phi, x1: hinge, s1: hs, x2: free, s2: fs });
          hinge = free; hs = fs;
        }
        var rowC = y0 + PH / 2;
        /** @param {{phi: number, x1: number, s1: number, x2: number, s2: number}} q */
        function quad(q) {
          ctx.moveTo(q.x1, rowC - PH * q.s1 / 2); ctx.lineTo(q.x2, rowC - PH * q.s2 / 2);
          ctx.lineTo(q.x2, rowC + PH * q.s2 / 2); ctx.lineTo(q.x1, rowC + PH * q.s1 / 2); ctx.closePath();
        }
        var edgeA = open ? 1 - seg(t, T.dropAt + T.dropDur, 0.4) : 1;
        // round 7: once open, the paper itself fades into the card, so no rectangle is left around the map
        var paperA = open ? 1 - E.settle(seg(t, T.dropAt + T.dropDur + 0.1, 1.1)) : 1;
        // back to front: a folded panel lies behind the one it is folded against
        if (paperA > 0.003) quads.slice().reverse().forEach(function (q) {
          var turned = Math.abs(Math.sin(q.phi));
          ctx.globalAlpha = appear * paperA;
          ctx.fillStyle = Math.cos(q.phi) < 0 ? PAPER_BACK : PAPER;
          ctx.beginPath(); quad(q); ctx.fill();
          // a little light on a panel while it turns
          if (turned > 0.02) { ctx.globalAlpha = 0.06 * turned * appear; ctx.fillStyle = C.sky; ctx.beginPath(); quad(q); ctx.fill(); }
          stroke(ctx, v, function (c) { quad(q); }, C.sky, 0.62 * appear * edgeA, HAIR + 0.25);
        });
        // the lower row drops open from behind the upper row
        if (f.drop > 0 && psi < Math.PI / 2 && paperA > 0.003) {
          var hy = y0 + PH, by = hy + PH * Math.cos(psi), bs = 1 + 0.16 * Math.sin(psi);
          var bx0 = cx - (w / 2) * bs, bx1 = cx + (w / 2) * bs;
          /** @param {CanvasRenderingContext2D} c */
          var drop = function (c) { c.moveTo(x0, hy); c.lineTo(x0 + w, hy); c.lineTo(bx1, by); c.lineTo(bx0, by); c.closePath(); };
          ctx.globalAlpha = paperA; ctx.fillStyle = PAPER; ctx.beginPath(); drop(ctx); ctx.fill();
          ctx.globalAlpha = 0.05 * Math.sin(psi); ctx.fillStyle = C.sky; ctx.beginPath(); drop(ctx); ctx.fill();
          stroke(ctx, v, drop, C.sky, 0.62 * edgeA, HAIR + 0.25);
          // the column creases continue down the dropping half
          stroke(ctx, v, function (c) { for (var j = 1; j < COLS; j++) { var fx = x0 + PW * j, bx = cx + (fx - cx) * bs; c.moveTo(fx, hy); c.lineTo(bx, by); } }, C.sky, 0.4 * edgeA, HAIR);
        }
        ctx.restore();

        if (t < T.dropAt + T.dropDur) return;
        // ---- the open map: dashed creases, grid, contours ----
        // Round 7 (Shai: "remove the bounding box of the map, it looks and feels constricting"): no outline and no
        // rectangular clip. The creases, the grid and the contours are drawn on their own layer, which fades out
        // toward the map's edges in a soft ellipse, so the map dissolves into the card instead of ending in a frame.
        var settle = seg(t, T.dropAt + T.dropDur, 0.4);
        // round 11: without a layer (no second context), the open map draws straight onto the card, unfaded
        var lc = layer(ctx, v) || ctx;
        stroke(lc, v, function (c) {
          for (var j = 1; j < COLS; j++) { c.moveTo(X0 + PW * j, Y0); c.lineTo(X0 + PW * j, Y0 + MH); }
          c.moveTo(X0, Y0 + PH); c.lineTo(X0 + MW, Y0 + PH);
        }, C.sky, 0.36 * settle, HAIR, [3, 4]);
        var g = E.out(seg(t, T.gridAt, 0.8));
        stroke(lc, v, function (c) {
          for (var gx = X0 + 24; gx < X0 + MW; gx += 24) { c.moveTo(gx, Y0); c.lineTo(gx, Y0 + MH); }
          for (var gy = Y0 + 22; gy < Y0 + MH; gy += 22) { c.moveTo(X0, gy); c.lineTo(X0 + MW, gy); }
        }, C.sky, 0.07 * g, 0.6, [1, 3]);
        contours.forEach(function (p, i) {
          var c0 = E.settle(seg(t, T.contourAt + (i % 4) * 0.12 + (i >= 4 ? 0.18 : 0), 1.1));
          if (c0 <= 0) return;
          stroke(lc, v, function (c) { p.trace(c, 0, p.len * c0); }, C.sky, 0.26 + (i % 4 === 0 ? 0.08 : 0), HAIR);
        });
        if (lc !== ctx) {
          vignette(lc, cx, cy, MW * 0.56, MH * 0.6);
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 1;
          ctx.drawImage(lc.canvas, 0, 0);
          ctx.restore();
        }

        // ---- A, the route, B ----
        var aIn = E.organic(seg(t, T.aAt, 0.6));
        if (aIn > 0) {
          ring(ctx, v, A.x, A.y, 7 * aIn, C.sky, 0.9 * aIn, LINE);
          dot(ctx, v, A.x, A.y, 2.4 * aIn, C.white, aIn);
          glow(ctx, A.x, A.y, 18 / v.s, C.sky, 0.35 * aIn);
        }
        var bIn = E.organic(seg(t, T.aAt + 0.2, 0.6));
        var lit = seg(t, arrive - 0.05, 0.35);
        if (bIn > 0) {
          // round 8 (Shai: "double the size, just the main yellow glowing dot"): B's dot is twice round 7's, its ring wider to match
          ring(ctx, v, B.x, B.y, 13 * bIn, lit > 0 ? mix(C.sky, C.gold, lit) : C.sky, 0.85 * bIn, LINE);
        }
        var rp = E.settle(seg(t, T.routeAt, T.routeDur));
        if (rp <= 0 && bIn > 0) {
          // before the route: the waypoints wait as open rings
          [0.36, 0.67].forEach(function (f) { var wp = route.at(route.len * f); ring(ctx, v, wp.x, wp.y, 4.5, C.sky, 0.5 * bIn, HAIR + 0.25); });
        }
        if (rp > 0) {
          stroke(ctx, v, function (c) { route.trace(c, 0, route.len * rp); }, C.gold, 0.92, 1.5);
          // two waypoints, the phases of the plan, light as the route reaches them
          [0.36, 0.67].forEach(function (f) {
            var wp = route.at(route.len * f), on = seg(rp, f - 0.01, 0.06);
            ring(ctx, v, wp.x, wp.y, 4.5, on > 0 ? C.gold : C.sky, 0.5 + 0.4 * on, HAIR + 0.25);
            if (on > 0) { dot(ctx, v, wp.x, wp.y, 1.6, C.gold, on); glow(ctx, wp.x, wp.y, 14 / v.s, C.gold, 0.3 * on); }
          });
          if (rp < 1) { var hp = route.at(route.len * rp); spark(ctx, v, hp.x, hp.y, C.gold, 1, 1.1); }
        }
        if (lit > 0) {
          var hold = Math.max(0, t - arrive);
          var pulse = 0.5 + 0.5 * Math.sin(hold * Math.PI * 2 / 3.2 - Math.PI / 2);
          glow(ctx, B.x, B.y, (56 + 12 * pulse) / v.s, C.gold, (0.5 + 0.18 * pulse) * lit);
          dot(ctx, v, B.x, B.y, 7.2, C.gold, lit);
          dot(ctx, v, B.x, B.y, 3.2, C.white, 0.95 * lit);
          // three rings radiate on arrival
          for (var i = 0; i < 3; i++) {
            var rr = seg(t, arrive + i * T.rings, 1.7);
            if (rr > 0 && rr < 1) ring(ctx, v, B.x, B.y, 14 + 78 * E.out(rr), C.gold, 0.7 * Math.pow(1 - rr, 1.6), LINE);
          }
          // the hold: a small light walks the route every few seconds and B answers with one soft ring
          if (t > T.hold + 1) {
            var P = 5.2, q = ((t - T.hold - 1) % P) / P * (P / 3.1);
            if (q < 1) { var wp = route.at(route.len * E.settle(q)); spark(ctx, v, wp.x, wp.y, C.sky, 0.75 * Math.sin(Math.PI * q), 0.8); }
            var rq = ((t - T.hold - 1) % P - 3.1) / 1.8;
            if (rq > 0 && rq < 1) ring(ctx, v, B.x, B.y, 14 + 54 * E.out(rq), C.gold, 0.35 * Math.pow(1 - rq, 1.6), HAIR + 0.25);
          }
        }
      }
    };
  }

  /* =====================================================================
     Panel 2, The Right Team Around You
     A glowing center. Six satellites travel out from it one at a time, the
     spokes and the ring draw, then the constellation turns slowly in place,
     with small lights traveling its lines.
     ===================================================================== */
  /** @returns {Scene} */
  function Team() {
    var cx = 280, cy = 300, R = 166, N = 6;
    var T = { core: 0, first: 0.75, gap: 0.42, travel: 0.8, spokes: 3.75, ring: 4.45, turn: 5.5 };
    var OMEGA = Math.PI * 2 / 70;   // one turn in 70 s
    var TILT = 0.84;                // the plane leans back a little as it starts to turn

    /** angle travelled by t: eases in from rest over 2 s, then constant @param {number} t */
    function turn(t) {
      var x = t - T.turn;
      if (x <= 0) return 0;
      var ramp = 2;
      return x < ramp ? OMEGA * x * x / (2 * ramp) : OMEGA * (x - ramp / 2);
    }

    return {
      design: [560, 600],
      stillAt: 9,
      draw: function (ctx, t, v) {
        var coreIn = E.organic(seg(t, T.core, 0.9));
        var rot = turn(t);
        var tilt = lerp(1, TILT, E.settle(seg(t, T.turn, 3)));
        /** @type {{x: number, y: number, z: number, out: number}[]} */
        var nodes = [];
        for (var i = 0; i < N; i++) {
          var th = -Math.PI / 2 + i * Math.PI * 2 / N + rot;
          var out = E.organic(seg(t, T.first + i * T.gap, T.travel));
          var x = cx + Math.cos(th) * R * out, y = cy + Math.sin(th) * R * out * tilt;
          nodes.push({ x: x, y: y, z: Math.sin(th) * (1 - tilt) * 4, out: out });
        }
        // a faint orbit
        var orbitIn = E.settle(seg(t, T.ring, 1.4));
        if (orbitIn > 0) stroke(ctx, v, function (c) { c.ellipse(cx, cy, R, R * tilt, 0, -Math.PI / 2 + rot, -Math.PI / 2 + rot + Math.PI * 2 * orbitIn); }, C.sky, 0.12, HAIR);
        // outer echo ring, very faint, for depth
        if (orbitIn > 0) stroke(ctx, v, function (c) { c.ellipse(cx, cy, R * 1.32, R * 1.32 * tilt, 0, 0, Math.PI * 2); }, C.sky, 0.05 * orbitIn, HAIR, [1, 5]);

        // trails while a satellite travels out, then the spoke draws over it
        nodes.forEach(function (n, i) {
          if (n.out <= 0) return;
          var sp = E.settle(seg(t, T.spokes + i * 0.09, 0.6));
          var trail = 0.22 * (1 - sp);
          if (trail > 0.004) stroke(ctx, v, function (c) { c.moveTo(cx, cy); c.lineTo(n.x, n.y); }, C.sky, trail, HAIR);
          if (sp > 0) stroke(ctx, v, function (c) { c.moveTo(cx, cy); c.lineTo(lerp(cx, n.x, sp), lerp(cy, n.y, sp)); }, C.sky, 0.55, LINE * 0.85);
        });
        // ring edges draw around in turn
        for (var e = 0; e < N; e++) {
          var a = nodes[e], b = nodes[(e + 1) % N];
          var rp = E.settle(seg(t, T.ring + e * 0.15, 0.55));
          if (rp > 0) stroke(ctx, v, function (c) { c.moveTo(a.x, a.y); c.lineTo(lerp(a.x, b.x, rp), lerp(a.y, b.y, rp)); }, C.sky, 0.42, HAIR + 0.2);
        }
        // lights on the lines: gold from the center out, sky around the ring
        if (t > T.ring + 1.2) {
          var live = seg(t, T.ring + 1.2, 1);
          for (var s = 0; s < N; s++) {
            var n = nodes[s];
            var q = ((t * 0.36 + s * 0.37) % 1);
            spark(ctx, v, lerp(cx, n.x, E.settle(q)), lerp(cy, n.y, E.settle(q)), C.gold, live * Math.sin(Math.PI * q) * 0.85, 0.72);
            var q2 = ((t * 0.27 + s * 0.53) % 1), b2 = nodes[(s + 1) % N];
            spark(ctx, v, lerp(n.x, b2.x, q2), lerp(n.y, b2.y, q2), C.sky, live * Math.sin(Math.PI * q2) * 0.6, 0.6);
          }
        }
        // satellites, the nearer ones a touch larger
        nodes.forEach(function (n, i) {
          if (n.out <= 0) return;
          var k = 1 + n.z * 0.03;
          var arrived = seg(t, T.first + i * T.gap + T.travel * 0.7, 0.5);
          var land = arrived > 0 && arrived < 1 ? Math.sin(Math.PI * arrived) : 0;
          glow(ctx, n.x, n.y, (20 + 14 * land) * k / v.s, C.sky, 0.32 + 0.3 * land);
          ring(ctx, v, n.x, n.y, 7.5 * k * Math.min(1, n.out * 1.6), C.sky, 0.9, LINE);
          dot(ctx, v, n.x, n.y, 2.6 * k, C.white, 0.95);
        });
        // the center
        if (coreIn > 0) {
          var breath = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 3.6);
          // round 8: the center's dot twice round 7's size, its ring and bloom grown to match
          glow(ctx, cx, cy, (82 + 14 * breath) * coreIn / v.s, C.gold, 0.5 * coreIn);
          ring(ctx, v, cx, cy, 18 * coreIn, C.gold, 0.85 * coreIn, LINE);
          dot(ctx, v, cx, cy, 8.8 * coreIn, C.gold, coreIn);
          dot(ctx, v, cx, cy, 4, C.white, coreIn);
        }
      }
    };
  }

  /* =====================================================================
     Panel 3, Options When There's No Clear Answer
     A light travels up a route and runs into a block that glows a soft red.
     It stops, looks left, looks right, two options light up, it takes one,
     meets the next block, and so on, until its route brings it back to the
     start. The loop is seamless: there is always another path.
     ===================================================================== */
  /** @returns {Scene} */
  function Options() {
    var X = -50; // centers the network
    /** @param {number} x @param {number} y @returns {Pt} */
    function P(x, y) { return { x: x + X, y: y }; }
    var S = P(280, 500), J1 = P(280, 380), C1 = P(380, 380), J2 = P(380, 250), C2 = P(280, 250), J3 = P(280, 130), C3 = P(180, 130), C4 = P(180, 500);
    // the loop the light keeps: corners rounded except at the three junctions, where it stops
    // listed from C4 so arc length 0 falls on the corner at S
    var loop = roundedLoop([C4, S, J1, C1, J2, C2, J3, C3], [22, 22, 0, 22, 0, 22, 0, 22]);
    var BLOCK = 30; // how far beyond a junction its block sits
    var blocks = [J1, J2, J3].map(function (j) { return { j: j, bar: { x: j.x, y: j.y - BLOCK } }; });
    // each junction offers a left and a right; the chosen one is part of the loop
    var opts = [
      { j: J1, l: P(180, 380), r: C1, take: 'r' },
      { j: J2, l: C2, r: P(480, 250), take: 'l' },
      { j: J3, l: C3, r: P(380, 130), take: 'l' }
    ];
    var sJ = [J1, J2, J3].map(function (j) { return loop.sOf(j); });
    var sS = loop.sOf({ x: S.x, y: S.y - 22 }); // just past the corner at S, heading up

    var V = 128;      // travel speed, design units per second
    var PROBE = BLOCK - 9; // the light runs up to just short of the bar
    var ACC = 44;     // distance over which the light gathers speed from a stop
    /** @typedef {{kind: string, dur: number, i?: number, s0?: number, s1?: number, acc?: number}} Move */
    /** @type {Move[]} */
    var moves = [];
    /** travel along the loop, from rest (acc > 0) or already at speed (acc 0), arriving at speed V
        @param {number} s0 @param {number} s1 @param {number} acc */
    function travel(s0, s1, acc) { moves.push({ kind: 'travel', s0: s0, s1: s1, acc: acc, dur: acc / V * Math.PI / 2 + (s1 - s0 - acc) / V }); }
    /** the stop at junction i: run on into the block slowing, glow, back off, look, options, go @param {number} i */
    function stop(i) {
      moves.push({ kind: 'probe', i: i, dur: PROBE / V * Math.PI / 2 });
      moves.push({ kind: 'hit', i: i, dur: 0.35 });
      moves.push({ kind: 'back', i: i, dur: 0.6 });
      moves.push({ kind: 'look', i: i, dur: 1.25 });
      moves.push({ kind: 'offer', i: i, dur: 0.45 });
    }
    // the light passes S at speed, so the loop has no seam
    travel(sS, sJ[0], 0);
    stop(0);
    travel(sJ[0], sJ[1], ACC);
    stop(1);
    travel(sJ[1], sJ[2], ACC);
    stop(2);
    travel(sJ[2], loop.len + sS, ACC);
    var starts = [], total = 0;
    moves.forEach(function (m) { starts.push(total); total += m.dur; });
    /** when each stop's events happen, for the glows */
    var hitAt = [0, 0, 0], offerAt = [0, 0, 0], leaveAt = [0, 0, 0];
    moves.forEach(function (m, k) {
      if (m.kind === 'hit') hitAt[/** @type {number} */ (m.i)] = starts[k];
      if (m.kind === 'look') offerAt[/** @type {number} */ (m.i)] = starts[k] + 0.55;
      if (m.kind === 'offer') leaveAt[/** @type {number} */ (m.i)] = starts[k] + m.dur;
    });

    /** where the light is at loop time u @param {number} u @returns {{x: number, y: number, s: number, look: number}} */
    function where(u) {
      var k = 0;
      while (k < moves.length - 1 && starts[k + 1] <= u) k++;
      var m = moves[k], x = (u - starts[k]) / m.dur;
      if (m.kind === 'travel') {
        var acc = /** @type {number} */ (m.acc), ta = acc / V * Math.PI / 2, tau = u - starts[k];
        var s = /** @type {number} */ (m.s0) + (tau < ta ? acc * E.inSine(tau / ta) : acc + V * (tau - ta));
        var p = loop.at(s);
        return { x: p.x, y: p.y, s: s, look: 0 };
      }
      var j = blocks[/** @type {number} */ (m.i)].j, sj = sJ[/** @type {number} */ (m.i)];
      if (m.kind === 'probe') return { x: j.x, y: j.y - PROBE * E.outSine(x), s: sj, look: 0 };
      if (m.kind === 'hit') return { x: j.x, y: j.y - PROBE, s: sj, look: 0 };
      if (m.kind === 'back') return { x: j.x, y: j.y - PROBE * (1 - E.settle(x)), s: sj, look: 0 };
      if (m.kind === 'look') {
        // left, then right, then center: a small, unhurried search
        var lk = x < 0.4 ? -Math.sin(Math.PI * x / 0.4) : x < 0.85 ? Math.sin(Math.PI * (x - 0.4) / 0.45) : 0;
        return { x: j.x + lk * 7, y: j.y, s: sj, look: lk };
      }
      return { x: j.x, y: j.y, s: sj, look: 0 };
    }

    /** a quiet structure: the whole loop, the stubs to each block, and every option @param {CanvasRenderingContext2D} c */
    function network(c) {
      loop.trace(c, 0, loop.len);
      blocks.forEach(function (b) { c.moveTo(b.j.x, b.j.y); c.lineTo(b.bar.x, b.bar.y); });
      opts.forEach(function (o) { c.moveTo(o.j.x, o.j.y); c.lineTo(o.l.x, o.l.y); c.moveTo(o.j.x, o.j.y); c.lineTo(o.r.x, o.r.y); });
    }

    return {
      design: [560, 600],
      stillAt: 60,
      draw: function (ctx, t, v) {
        var appear = E.out(seg(t, 0, 0.6));
        stroke(ctx, v, network, C.sky, 0.14 * appear, HAIR);
        // stations, as on a transit map: each junction and the far end of each option
        opts.forEach(function (o) { [o.j, o.l, o.r].forEach(function (q) { ring(ctx, v, q.x, q.y, 3.2, C.sky, 0.28 * appear, HAIR); }); });
        var st = loop.at(sS);
        ring(ctx, v, st.x, st.y, 5, C.gold, 0.45 * appear, HAIR + 0.25);
        var i, b;
        // blocks: a short bar across the way, a soft red that wakes when the light meets it
        for (i = 0; i < 3; i++) {
          b = blocks[i];
          var since = v.still ? 2 : ((t - hitAt[i]) % total + total) % total;
          var red = v.still ? 0.35 : (since < 0.15 ? since / 0.15 : Math.exp(-(since - 0.15) / 1.6));
          if (t < hitAt[i] && !v.still) red = 0;
          var bx = b.bar.x, by = b.bar.y;
          stroke(ctx, v, function (c) { c.moveTo(bx - 15, by); c.lineTo(bx + 15, by); }, C.stop, (0.45 + 0.55 * red) * appear, LINE + 0.5);
          glow(ctx, bx, by, (30 + 34 * red) / v.s, C.stop, (0.12 + 0.6 * red) * appear);
          if (red > 0.02) glow(ctx, bx, by, 12 / v.s, C.stop, 0.5 * red);
        }
        if (v.still) {
          // the still frame: the route that always comes home, the options it found, the light at the start
          stroke(ctx, v, function (c) { loop.trace(c, 0, loop.len); }, C.sky, 0.6, LINE);
          opts.forEach(function (o) { var other = o.take === 'l' ? o.r : o.l; stroke(ctx, v, function (c) { c.moveTo(o.j.x, o.j.y); c.lineTo(other.x, other.y); }, C.sky, 0.3, HAIR + 0.25); });
          var p0 = loop.at(sS);
          spark(ctx, v, p0.x, p0.y, C.gold, 1, 2.5);
          return;
        }
        var u = ((t % total) + total) % total;
        var me = where(u);
        // options: both light up from the junction outward, the unchosen one fades after
        for (i = 0; i < 3; i++) {
          var o = opts[i];
          var cycles = [u - offerAt[i], u - offerAt[i] + total];
          for (var cI = 0; cI < 2; cI++) {
            var dt = cycles[cI];
            if (dt < 0 || dt > 4.2 || (cI === 1 && t < total)) continue;
            var grow = E.organic(seg(dt, 0, 0.55));
            var after = Math.max(0, dt - (leaveAt[i] - offerAt[i]));
            [o.l, o.r].forEach(function (end, side) {
              var chosen = (side === 0 ? 'l' : 'r') === o.take;
              var a = chosen ? 0.8 * (1 - seg(after, 0, 0.6) * 0.6) : 0.8 * (1 - seg(after, 0.1, 1.4));
              if (a <= 0) return;
              var ex = lerp(o.j.x, end.x, grow), ey = lerp(o.j.y, end.y, grow);
              stroke(ctx, v, function (c) { c.moveTo(o.j.x, o.j.y); c.lineTo(ex, ey); }, C.sky, a, LINE);
              spark(ctx, v, ex, ey, C.sky, a * 0.7, 0.6);
            });
          }
        }
        // the trail behind the light, along the loop, fading
        var TRAIL = 230, STEPS = 14;
        for (var k = 0; k < STEPS; k++) {
          var s0 = me.s - TRAIL * (k + 1) / STEPS, s1 = me.s - TRAIL * k / STEPS;
          if (t < total && s1 < 0) continue;
          stroke(ctx, v, function (c) { loop.trace(c, s0, s1); }, C.sky, 0.78 * Math.pow(1 - k / STEPS, 1.4), LINE + 0.25, null, true);
        }
        // the stub it probes, lit while it is on it
        // the light
        spark(ctx, v, me.x, me.y, C.gold, appear, 2.3);   // round 8: the searching light, twice round 7's size
        if (me.look !== 0) glow(ctx, me.x + me.look * 12, me.y, 16 / v.s, C.sky, 0.25 * Math.abs(me.look));
      }
    };
  }

  /* ---------- A stage: sizing, the clock, visibility, reduced motion ---------- */
  var MAX_DPR = 2;          // iOS caps canvas area and total canvas memory; DPR 3 buys nothing on a line drawing
  var MAX_PIXELS = 4e6;     // backing store cap per canvas (2000 x 2000)
  /** @type {Record<string, {seek: (t: number) => void, frames: () => number, state: () => string}>} */
  var registry = {};
  /** Round 11: the card's still image, shown when the canvas cannot draw. @param {HTMLCanvasElement} canvas @param {boolean} on */
  function showStill(canvas, on) {
    var panel = canvas.parentElement;
    if (panel) panel.classList.toggle('is-fallback', on);
    var img = panel && panel.querySelector('.journey__still');
    if (img) /** @type {HTMLElement} */ (img).style.display = on ? 'block' : 'none';
  }
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Scene} scene
   * @param {{name: string, activeAt?: number, trigger?: Element | null, triggerAt?: number}} opts
   */
  function stage(canvas, scene, opts) {
    var ctx = canvas.getContext('2d');
    if (!ctx) { showStill(canvas, true); registry[opts.name] = dead('no-context'); return; }
    var g = ctx;
    /** @type {View} */
    var v = { W: 0, H: 0, s: 1, ox: 0, oy: 0, still: reduce, m: [1, 0, 0, 1, 0, 0] };
    var dpr = 1, t = 0, last = 0, raf = 0, frames = 0;
    var visible = false, started = false, paused = false, broken = '';
    // the canvas draws now: its still image stays in the card, hidden, for a later failure
    showStill(canvas, false);

    /** the element's own layout box: unaffected by transforms, and the card's box when the canvas reads 0 */
    function box() {
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) { var p = canvas.parentElement; if (p) { w = w || p.clientWidth; h = h || p.clientHeight || w; } }
      return { w: w, h: h };
    }
    function fit() {
      var b = box();
      if (!b.w || !b.h) return;   // not laid out yet (hidden, collapsed): the observers call again once it is
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      if (b.w * b.h * dpr * dpr > MAX_PIXELS) dpr = Math.sqrt(MAX_PIXELS / (b.w * b.h));
      var cw = Math.max(1, Math.round(b.w * dpr)), ch = Math.max(1, Math.round(b.h * dpr));
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
      v.W = b.w; v.H = b.h;
      if (scene.design) {
        var dw = scene.design[0], dh = scene.design[1];
        v.s = Math.min(v.W / dw, v.H / dh);
        v.ox = (v.W - dw * v.s) / 2; v.oy = (v.H - dh * v.s) / 2;
      } else { v.s = 1; v.ox = 0; v.oy = 0; }
      v.m = [dpr * v.s, 0, 0, dpr * v.s, dpr * v.ox, dpr * v.oy];
      if (scene.layout) scene.layout(v);
      paint();
    }
    /** @param {number} [at] */
    function draw(at) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, v.W, v.H);
      g.setTransform(v.m[0], v.m[1], v.m[2], v.m[3], v.m[4], v.m[5]);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      scene.draw(g, at == null ? t : at, v);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    function paint() {
      if (!v.W) return;
      if (broken) { still(); return; }
      try {
        if (!started && !v.still) { g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, v.W, v.H); return; }
        draw(v.still ? scene.stillAt : t);
      } catch (err) { fail('draw: ' + (err && err.message)); }
    }
    /** a panel that cannot animate: its final still frame on the canvas, else the still image @param {string} why */
    function fail(why) {
      if (broken) return;
      broken = why;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      still();
      if (window.console) console.warn('[line-art] ' + opts.name + ': ' + why);
    }
    /** the final still frame, as under reduced motion; the still image when the canvas cannot draw it */
    function still() {
      if (!v.W) { showStill(canvas, true); return; }
      var wasStill = v.still;
      v.still = true;
      try { draw(scene.stillAt); } catch (e) { showStill(canvas, true); }
      v.still = wasStill;
    }
    /** @param {number} now */
    function loop(now) {
      raf = 0;
      if (!running()) return;
      t += Math.max(0, Math.min((now - last) / 1000, 0.05));
      last = now;
      paint();
      frames++;
      if (!broken) raf = requestAnimationFrame(loop);
    }
    function running() { return !broken && visible && started && !paused && !v.still && !document.hidden; }
    function sync() {
      if (running() && !raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
      else if (!running() && raf) { cancelAnimationFrame(raf); raf = 0; }
    }
    function start() {
      if (started) return;
      started = true;
      if (!v.W) fit();
      if (!v.W) { fail('no size'); return; }
      if (v.still) paint();
      sync();
      // a frame clock that never ticks (a throttled or stalled page): settle on the still frame instead of a blank card
      var f0 = frames;
      window.setTimeout(function () { if (started && running() && frames === f0) fail('no frames'); }, 2500);
    }

    if ('ResizeObserver' in window) {
      try { new ResizeObserver(function () { fit(); }).observe(canvas); } catch (e) { window.addEventListener('resize', fit, { passive: true }); }
    } else window.addEventListener('resize', fit, { passive: true });
    window.addEventListener('orientationchange', fit);
    fit();

    var trig = opts.trigger || canvas;
    var at = opts.triggerAt != null ? opts.triggerAt : (opts.activeAt || 0.45);
    /** @param {Element} el @param {number} need share of el in view, or el already scrolled past */
    function shown(el, need) {
      var r = el.getBoundingClientRect(), vh = window.innerHeight || document.documentElement.clientHeight;
      if (r.bottom < 0) return true;
      if (!r.height) return false;
      return (Math.min(r.bottom, vh) - Math.max(r.top, 0)) / r.height >= need - 0.02;
    }
    /** the start condition: the trigger far enough in view, or scrolled past. Round 11: a panel with its own trigger
        (the first one, on the intro's last line) also starts once the card itself is 45% in view; on a tall phone the
        intro can sit partly above the screen while the card is in full view, and the card stayed blank. */
    function due() { return shown(trig, at) || (trig !== canvas && shown(canvas, 0.45)); }
    function inView() { var r = canvas.getBoundingClientRect(); return r.bottom > 0 && r.top < (window.innerHeight || 0) && r.height > 0; }
    // round 11: a scroll check backs up the observers (an observer that never reports leaves the card blank)
    var pend = 0;
    function check() {
      pend = 0;
      if (!visible && inView()) { visible = true; sync(); }
      if (!started && due()) start();
      if (started) window.removeEventListener('scroll', onScroll);
    }
    // a timer, not a frame: this backup must work when frames do not
    function onScroll() { if (!pend) pend = window.setTimeout(check, 90); }
    window.addEventListener('scroll', onScroll, { passive: true });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { visible = es[es.length - 1].isIntersecting; sync(); }, { threshold: 0 }).observe(canvas);
      // in view far enough, or already scrolled past (a jump link, a fast fling); due() reads the geometry itself
      var tio = new IntersectionObserver(function () {
        if (due()) { tio.disconnect(); start(); }
      }, { threshold: [0, 0.43, 0.45, at - 0.02, at] });
      var watch = function () { tio.observe(trig); if (trig !== canvas) tio.observe(canvas); };
      watch();
      // round 8, replay: once the section is out of view below (main.js), the intro waits to play again from its start;
      // the idle loop that follows it is unchanged
      var scope = canvas.closest('section');
      if (scope && !v.still) scope.addEventListener('ncc:reset', function () {
        if (broken) return;
        started = false; t = 0; sync(); paint();
        watch();
        window.addEventListener('scroll', onScroll, { passive: true });
      });
    } else { visible = true; start(); }
    document.addEventListener('visibilitychange', sync);
    if (v.still) { started = true; paint(); }
    check();

    registry[opts.name] = {
      /** @param {number} at */
      seek: function (at) { paused = true; started = true; sync(); t = at; paint(); },
      frames: function () { return frames; },
      state: function () { return broken ? 'still: ' + broken : started ? (v.still ? 'still' : 'running') : 'waiting'; }
    };
  }
  /** @param {string} why */
  function dead(why) { return { seek: function () {}, frames: function () { return 0; }, state: function () { return 'image: ' + why; } }; }

  /* ---------- Boot ---------- */
  function boot() {
    /** @type {Record<string, () => Scene>} */
    var panels = { roadmap: Roadmap, team: Team, options: Options };
    Array.prototype.forEach.call(document.querySelectorAll('canvas[data-panel]'), function (/** @type {HTMLCanvasElement} */ c) {
      var name = c.getAttribute('data-panel') || '';
      if (!panels[name]) return;
      // data-trigger: start this panel when that element is fully in view instead (round 6: the first panel
      // starts as soon as the value intro's last line is on screen)
      var sel = c.getAttribute('data-trigger');
      var trig = sel ? document.querySelector(sel) : null;
      // round 11: one panel's failure never stops the others, and leaves its own card on the still image
      try { stage(c, panels[name](), trig ? { name: name, trigger: trig, triggerAt: 1 } : { name: name, activeAt: 0.45 }); }
      catch (err) { showStill(c, true); registry[name] = dead('boot: ' + (err && /** @type {Error} */ (err).message)); }
    });
    /** @type {any} */ (window).__nccArtBooted = true;
    if (debug) Object.assign(window, { __nccArt: { /** @param {string} n @param {number} t */ seek: function (n, t) { if (registry[n]) registry[n].seek(t); }, frames: function () { var o = {}; Object.keys(registry).forEach(function (k) { o[k] = registry[k].frames(); }); return o; }, state: function () { var o = {}; Object.keys(registry).forEach(function (k) { o[k] = registry[k].state(); }); return o; } } });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
