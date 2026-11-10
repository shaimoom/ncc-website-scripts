/* Newaz Clinical Consulting, the loader. Round 9 (Shai: "please add a loader screen for the Vercel site and local").

   Once per browser session, on the hero's own ground, the NCC symbol draws in solid Saif gold, piece by piece, by the
   closing lockup's two-brush reveal (same paths, same masks, center outward). The pieces are the progress: four draw on
   time alone, the other six only as the page gets ready. Ready means:
     1. the hero's faces are loaded (the same four text-reveal.js waits for), then document.fonts.ready
     2. the headings are split (window.NCCText.ready), so the headline can rise the moment the loader leaves
     3. the hero tree has booted and drawn its first frame (hero-tree.js: 'ncc:hero-ready'), or, without WebGL,
        the still image has loaded
   It stays at least MIN_MS, so it never flashes, and starts to leave by MAX_MS (from navigation start) whatever is
   still pending, so it never traps the visitor. Leaving: the symbol scales up a touch and fades, and the ground lifts
   away. A third of the way into the lift (most of the ground is already gone), html.is-loading comes off and 'ncc:loaded' fires: the hero headline rises
   (CSS) and the hero tree starts its clock, so the first seed drops in view, never behind the loader.

   The head script decides (html.has-loader: JS on, no reduced motion, first visit this session, or ?loader) and holds a
   4.5 s failsafe that frees the page even if this file never runs. Without JS the loader is display: none.
   Accessibility: while it is up, everything else in the body is inert (no focus, no clicks) and wheel, touch and key
   scrolling are held, so the visitor cannot land mid-page under it. Vera fixes: the loader is role="status" with
   visually hidden text, "Loading Newaz Clinical Consulting" (its drawing is aria-hidden), <main> is aria-busy, and both
   clear at the release, so a screen reader never meets an empty, silent document. In a browser without inert (Safari
   before 15.5), Tab is held too, so focus cannot reach the links under the loader.
   ?loader-debug exposes window.__nccLoader (the timeline marks, ms from navigation start). */
// @ts-check
(function () {
  'use strict';

  var doc = document.documentElement;
  var el = /** @type {HTMLElement | null} */ (document.querySelector('[data-loader]'));
  if (!el) return;
  if (!doc.classList.contains('has-loader')) { el.remove(); return; }
  var loader = el;

  var STEP_MS = 55;          // between piece starts when everything is ready
  var FREE_PIECES = 4;       // pieces that draw on time alone; the other six wait for readiness
  var HOLD_MS = 120;         // the finished symbol rests this long before it leaves
  var MIN_MS = 800;          // never leave before this (ms from navigation start)
  var FORCE_DRAW_MS = 2400;  // draw whatever is left from here on
  var MAX_MS = 3000;         // start to leave by here, ready or not
  var RELEASE_AT = 0.35;     // fraction of the lift when the hero starts (the lift is front-loaded: most of the ground is gone)

  /** @param {string} name @param {number} fallback */
  function ms(name, fallback) {
    var v = parseFloat(getComputedStyle(doc).getPropertyValue(name));
    return isFinite(v) ? v : fallback;
  }
  var PIECE_MS = ms('--dur-loader-piece', 520);
  var LIFT_MS = ms('--dur-loader-lift', 760);
  var LIFT_DELAY_MS = ms('--loader-lift-delay', 120);

  /** @type {Record<string, number>} */
  var marks = { script: Math.round(performance.now()) };
  /** @param {string} k */
  function mark(k) { if (!(k in marks)) marks[k] = Math.round(performance.now()); }
  if (/[?&]loader-debug\b/.test(location.search)) Object.assign(window, { __nccLoader: marks });

  /* ---------- Hold the page underneath ---------- */
  /** @type {HTMLElement[]} */
  var held = Array.prototype.filter.call(document.body.children, function (/** @type {Element} */ n) {
    return n !== loader && n.tagName !== 'SCRIPT';
  });
  held.forEach(function (n) { n.setAttribute('inert', ''); });
  var main = document.getElementById('main');
  if (main) main.setAttribute('aria-busy', 'true');
  var status = loader.querySelector('[data-loader-status]');
  var noInert = !('inert' in HTMLElement.prototype);
  var SCROLL_KEYS = { ' ': 1, PageDown: 1, PageUp: 1, Home: 1, End: 1, ArrowDown: 1, ArrowUp: 1, ArrowLeft: 1, ArrowRight: 1 };
  /** @param {Event} e */
  function stop(e) {
    var key = e.type === 'keydown' ? /** @type {KeyboardEvent} */ (e).key : '';
    if (e.type === 'keydown' && !(key in SCROLL_KEYS) && !(noInert && key === 'Tab')) return;
    e.preventDefault();
  }
  ['wheel', 'touchmove', 'keydown'].forEach(function (t) { window.addEventListener(t, stop, { passive: false }); });

  /* ---------- Readiness ---------- */
  var tasks = 3;
  var done = 0;
  /** @param {string} name @returns {() => void} */
  function settle(name) {
    var once = false;
    return function () { if (once) return; once = true; done++; mark(name); };
  }

  // 1. fonts
  var fontsDone = settle('fonts');
  var fonts = document.fonts;
  if (fonts) {
    Promise.all([
      fonts.load('400 1em "Libertinus Serif"'),
      fonts.load('italic 400 1em "Libertinus Serif"'),
      fonts.load('400 1em "DM Sans"'),
      fonts.load('600 1em "DM Sans"')
    ]).then(function () { return fonts.ready; }).then(fontsDone, fontsDone);
  } else fontsDone();

  // 2 and 3 need text-reveal.js and hero-tree.js, which run after this file (both are deferred, so both have run by
  // DOMContentLoaded). The hero may also report later, or have reported already.
  var splitDone = settle('split');
  var heroDone = settle('hero');
  document.addEventListener('ncc:hero-ready', heroDone);
  /** the globals text-reveal.js and hero-tree.js set */
  var globals = /** @type {{NCCText?: {ready?: Promise<void>}, __nccHeroReady?: boolean}} */ (/** @type {unknown} */ (window));
  function afterScripts() {
    var api = globals.NCCText;
    if (api && api.ready) api.ready.then(splitDone, splitDone); else splitDone();
    if (globals.__nccHeroReady) heroDone();
    if (doc.classList.contains('no-gl')) {
      // no WebGL: the hero shows a still frame; wait for that image (the same one the CSS picks)
      var img = new Image();
      img.onload = img.onerror = heroDone;
      img.src = 'assets/img/' + (window.matchMedia('(max-width: 59.99em)').matches ? 'hero-tree-still-tall.png' : 'hero-tree-still-wide.png');
    }
  }
  // Deferred scripts run while readyState is already 'interactive' but before DOMContentLoaded, so wait for the event.
  if (document.readyState === 'complete') afterScripts();
  else document.addEventListener('DOMContentLoaded', afterScripts);

  /* ---------- The symbol draws, center outward ---------- */
  var pieces = Array.prototype.slice.call(loader.querySelectorAll('.loader__piece'));
  var order = pieces.map(function (/** @type {SVGGElement} */ g, i) {
    var b = g.getBBox();
    return { i: i, x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  var cx = 0, cy = 0;
  order.forEach(function (o) { cx += o.x / order.length; cy += o.y / order.length; });
  order.sort(function (p, q) {
    var dp = Math.hypot(p.x - cx, p.y - cy), dq = Math.hypot(q.x - cx, q.y - cy);
    return (dp - dq) || (Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx));
  });

  var drawn = 0;
  var lastStart = 0;
  var drawStart = performance.now();
  var leaving = false;
  mark('drawStart');

  function tick() {
    if (leaving) return;
    var now = performance.now();
    var byTime = Math.floor((now - drawStart) / STEP_MS) + 1;
    var allowed = now >= FORCE_DRAW_MS ? order.length : FREE_PIECES + Math.round((order.length - FREE_PIECES) * done / tasks);
    var n = Math.min(order.length, byTime, allowed);
    while (drawn < n) {
      var m = loader.querySelector('#ld-m' + order[drawn].i);
      if (m) m.classList.add('is-drawn');
      lastStart = now;
      drawn++;
    }
    var finished = drawn === order.length && now >= lastStart + PIECE_MS + HOLD_MS;
    if ((finished && now >= MIN_MS) || now >= MAX_MS) leave();
    else requestAnimationFrame(tick);
  }

  /* ---------- Leave, then hand over to the hero ---------- */
  function release() {
    mark('release');
    held.forEach(function (n) { n.removeAttribute('inert'); });
    if (main) main.removeAttribute('aria-busy');
    if (status) status.textContent = '';
    ['wheel', 'touchmove', 'keydown'].forEach(function (t) { window.removeEventListener(t, stop); });
    if (doc.classList.contains('is-loading')) {
      doc.classList.remove('is-loading');
      document.dispatchEvent(new CustomEvent('ncc:loaded'));
    }
  }
  function leave() {
    if (leaving) return;
    leaving = true;
    mark('leave');
    loader.classList.add('is-leaving');
    setTimeout(release, LIFT_DELAY_MS + LIFT_MS * RELEASE_AT);
    setTimeout(function () {
      mark('gone');
      doc.classList.remove('has-loader');
      loader.remove();
    }, LIFT_DELAY_MS + LIFT_MS + 60);
  }

  // Commit the undrawn state for one frame, so the first brushes transition rather than appear.
  requestAnimationFrame(function () { requestAnimationFrame(tick); });
  // The cap holds even when frames are throttled (a background tab runs timers, not frames).
  setTimeout(leave, Math.max(0, MAX_MS - performance.now()));
})();
