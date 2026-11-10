/* Newaz Clinical Consulting, page behavior. Vanilla, no dependencies. */
(function () {
  'use strict';

  /* Every "Schedule a Discovery Call" button points here. Change it once (the static hrefs in index.html are the
     no-JS fallback and carry the same URL). It is an external booking page, so every button opens it in a new tab
     with rel="noopener". */
  var SCHEDULE_URL = 'https://calendly.com/tami-newazconsulting/30min';

  var doc = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasIO = 'IntersectionObserver' in window;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  /* The heavy set-ups below the fold (the clarity haze, Tami's signature plan) wait until the loader has released the
     page, then run when the browser is idle or when their element comes within one screen of view, whichever is first.
     Until then each shows its finished, no-JS state, and both are set up well before they can be seen. */
  function afterLoad(fn) {
    if (doc.classList.contains('is-loading')) document.addEventListener('ncc:loaded', fn, { once: true });
    else fn();
  }
  function idle(fn) {
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 3000 });
    else window.setTimeout(fn, 300);
  }
  function later(el, fn) {
    if (!el) return;
    var done = false, io = null;
    function go() { if (done) return; done = true; if (io) io.disconnect(); fn(); }
    afterLoad(function () {
      if (hasIO) {
        io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) go(); }, { rootMargin: '100% 0px' });
        io.observe(el);
      }
      idle(go);
    });
  }

  /* ---------- Schedule buttons ---------- */
  function initSchedule() {
    $$('[data-schedule]').forEach(function (a) {
      a.setAttribute('href', SCHEDULE_URL);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    });
  }

  /* ---------- Shared entrance: short, early, never left dim ---------- */
  var revealIO = null;
  function initReveal() {
    var items = $$('[data-reveal]');
    if (!hasIO) { items.forEach(function (el) { el.classList.add('is-in'); }); return; }
    var io = revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting || e.boundingClientRect.top < 0) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -4% 0px', threshold: 0 });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Replay ----------
     Each section (and the strip and the closing) is a scope. Once a scope has been seen and then lies entirely BELOW
     the viewport (the visitor has scrolled back up past it), its entrances are reset, out of sight and without a
     transition, so they play again on the next way down. A scope left above the viewport keeps its finished state,
     so scrolling back up never replays anything in reverse. Nothing resets while any pixel of the scope is on screen.
     Scopes run their own reset on the 'ncc:reset' event; the shared reveals and text reveals are reset here.
     Long-running loops (the hero, the panels' idle loops, the How We Work scrub) are not entrances and keep their
     own behavior. Reduced motion: never (everything is static). */
  function initReplay() {
    if (reduceMotion || !hasIO) return;
    var scopes = $$('main > section, body > footer, footer.success').filter(function (el) { return !el.matches('[data-tree], .hero'); });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var el = e.target;
        if (e.isIntersecting) { el.__nccSeen = true; return; }
        var bottom = e.rootBounds ? e.rootBounds.bottom : window.innerHeight;
        if (!el.__nccSeen || e.boundingClientRect.top < bottom) return; // never seen, or it left above: keep it finished
        el.__nccSeen = false;
        resetScope(el);
      });
    }, { threshold: 0 });
    scopes.forEach(function (el) { io.observe(el); });
  }
  function resetScope(scope) {
    scope.classList.add('is-resetting');
    $$('[data-reveal]', scope).forEach(function (el) {
      if (el.closest('[data-reveal-owner]')) return;
      el.classList.remove('is-in');
      if (revealIO) revealIO.observe(el);
    });
    if (window.NCCText && window.NCCText.reset) window.NCCText.reset(scope);
    scope.dispatchEvent(new CustomEvent('ncc:reset'));
    void scope.offsetWidth; // commit the reset state with transitions off
    requestAnimationFrame(function () { requestAnimationFrame(function () { scope.classList.remove('is-resetting'); }); });
  }

  /* ---------- Webflow: in-page links scroll the way the Vercel build does ----------
     webflow.js (its "scroll" module) catches every same-page link click on document, cancels it, and runs its own
     scroll: it stops at the header's height (ignoring scroll-padding-top and #approach's scroll-margin-top) and steps
     window.scroll() each frame, which fights html's CSS smooth scroll. Stopping the click before it reaches document
     leaves the browser's own anchor jump: CSS smooth scroll (off under reduced motion), the scroll padding below, the
     hash in the address bar, and the nav's own handlers on the link (initNav), which still run. */
  function initAnchors() {
    $$('a[href^="#"]').forEach(function (a) {
      if (a.getAttribute('href').length < 2) return;
      a.addEventListener('click', function (e) { e.stopPropagation(); });
    });
  }

  /* Webflow sets the Space and layout variable modes on body (header-h is 4rem at 767px and below), so the stylesheet's
     html { scroll-padding-top: var(--header-h) } would see the base 4.5rem and land every anchor 8px low on phones.
     Copy the value body resolves onto html. Without JS the base value stays (8px low on phones, nothing worse). */
  function initScrollPadding() {
    function sync() {
      var v = getComputedStyle(document.body).getPropertyValue('--header-h').trim();
      if (v) doc.style.scrollPaddingTop = v; else doc.style.removeProperty('scroll-padding-top');
    }
    var mq = window.matchMedia('(max-width: 767px)');
    if (mq.addEventListener) mq.addEventListener('change', sync); else if (mq.addListener) mq.addListener(sync);
    sync();
  }

  /* ---------- Header: scrolled state ---------- */
  function initHeader() {
    var header = $('[data-header]');
    var ticking = false;
    function update() { ticking = false; header.classList.toggle('is-scrolled', (window.scrollY || 0) > 8); }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  /* ---------- Header: the section links ----------
     From 60em the four links sit inline. Below it, the "Menu" toggle (a disclosure button: aria-expanded,
     aria-controls) opens them in a full-width panel under the bar; focus stays on the toggle and Tab moves into the panel.
     Escape closes it and returns focus to the toggle; so do a tap outside the header, choosing a link, or tabbing out
     of the panel. Smooth scrolling is CSS (html, off under reduced motion). The link for the section crossing a line
     just under the middle of the screen is marked aria-current="true" (underlined, CSS). */
  function initNav() {
    var nav = $('[data-nav]');
    if (!nav) return;
    var header = $('[data-header]');
    var toggle = $('[data-nav-toggle]', nav);
    var links = $$('[data-nav-link], .site-nav__link', nav);
    var narrow = window.matchMedia('(max-width: 991px)');   /* Webflow Tablet breakpoint: the Menu toggle shows at 991px and below */
    var tiny = window.matchMedia('(max-width: 23.43em)');   /* below 375px the nav is display: none (CSS) */
    function isOpen() { return toggle.getAttribute('aria-expanded') === 'true'; }
    function setOpen(open, refocus) {
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
      header.classList.toggle('is-open', open);
      if (!open && refocus) toggle.focus();
    }
    toggle.hidden = false;
    toggle.addEventListener('click', function () { setOpen(!isOpen()); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) { e.preventDefault(); setOpen(false, true); } });
    document.addEventListener('pointerdown', function (e) { if (isOpen() && !header.contains(e.target)) setOpen(false); });
    nav.addEventListener('focusout', function (e) { if (isOpen() && e.relatedTarget && !nav.contains(e.relatedTarget)) setOpen(false); });
    // WCAG 2.4.3: choosing a link in the open panel hides the panel, and the focused link with it. Focus moves
    // to the target section's heading (tabindex="-1" in the markup), after the browser has started its scroll, so the
    // screen-reader cursor and the next Tab continue from the section, not the top of the page. The desktop inline links
    // never hide, so they keep the browser's own behavior.
    $$('a', nav).forEach(function (a) {
      a.addEventListener('click', function () {
        if (!isOpen()) return;
        setOpen(false);
        var target = a.hash ? document.getElementById(a.hash.slice(1)) : null;
        var heading = target && $('h2[tabindex="-1"]', target);
        if (heading) setTimeout(function () { heading.focus({ preventScroll: true }); }, 0);
      });
    });
    var onChange = function () { if ((!narrow.matches || tiny.matches) && isOpen()) setOpen(false); };
    [narrow, tiny].forEach(function (mq) { if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange); });

    if (!hasIO) return;
    var inView = {};
    var spy = new IntersectionObserver(function (es) {
      es.forEach(function (e) { inView[e.target.id] = e.isIntersecting; });
      var cur = '';
      links.forEach(function (a) { var id = a.hash.slice(1); if (!cur && inView[id]) cur = id; });
      links.forEach(function (a) { if (a.hash.slice(1) === cur) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    }, { rootMargin: '-45% 0px -54% 0px', threshold: 0 });
    links.forEach(function (a) { var t = document.getElementById(a.hash.slice(1)); if (t) spy.observe(t); });
  }

  /* ---------- Moons ----------
     moonPath(f): the lit part of a waxing moon (lit on the right) for a lit fraction f, 0 new to 1 full.
     Below half, the terminator ellipse bites into the right half-disc; above half, it bulges left. */
  function moonPath(f) {
    f = clamp(f, 0, 1);
    if (f < 0.004) return 'M12,2Z';
    var rx = (Math.abs(1 - 2 * f) * 10).toFixed(2);
    var sweep = f < 0.5 ? 0 : 1;
    return 'M12,2A10,10 0 0 1 12,22A' + rx + ',10 0 0 ' + sweep + ' 12,2Z';
  }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  /* Success strip: three complete circles. When the strip is in view, each ring draws from the top, left to
     right, then its mark arrives: the smile draws, the center dot pops (both CSS, on .is-playing), and the third
     waxes from a thin crescent to the full gold moon (drawn here). Replays after a reset. No JS or reduced motion:
     the finished icons (the full moon is in the markup). */
  function initStripIcons() {
    var strip = $('[data-strip]');
    if (!strip || reduceMotion || !hasIO) return;
    var moon = $('[data-full-moon]', strip);
    var WAX_AT = 2 * 260 + 780, WAX = 1100;
    var raf = 0, timer = 0;
    function arm() {
      cancelAnimationFrame(raf); clearTimeout(timer);
      strip.classList.remove('is-playing');
      if (moon) moon.setAttribute('d', moonPath(0));
    }
    function play() {
      if (strip.classList.contains('is-playing')) return;
      strip.getBoundingClientRect();
      strip.classList.add('is-playing');
      if (!moon) return;
      timer = setTimeout(function () {
        var t0 = performance.now();
        (function tick(now) {
          var k = clamp((now - t0) / WAX, 0, 1);
          moon.setAttribute('d', moonPath(0.04 + 0.96 * easeInOut(k)));
          raf = k < 1 ? requestAnimationFrame(tick) : 0;
        })(t0);
      }, WAX_AT);
    }
    arm();
    var io = new IntersectionObserver(function (es) {
      var e = es[0];
      if (e.isIntersecting || e.boundingClientRect.bottom < 0) play();
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.6 });
    io.observe(strip);
    strip.addEventListener('ncc:reset', arm);
  }

  /* Header: a small moon waxes from new to full as the visitor scrolls down the page. */
  function initHeaderMoon() {
    var svg = $('[data-header-moon]');
    if (!svg) return;
    var lit = $('.lit', svg);
    if (reduceMotion) { lit.setAttribute('d', moonPath(1)); return; }
    var ticking = false, lastF = -1;
    function update() {
      ticking = false;
      var max = Math.max(1, doc.scrollHeight - window.innerHeight);
      var f = clamp((window.scrollY || 0) / max, 0, 1);
      if (Math.abs(f - lastF) < 0.002) return;
      lastF = f;
      lit.setAttribute('d', moonPath(f));
    }
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  /* ---------- Problem: clear the haze to find clarity ---------- */
  function initClarity() {
    var root = $('[data-clarity]');
    if (!root) return;
    var canvas = $('canvas', root);
    if (reduceMotion || !canvas || !canvas.getContext) {
      root.classList.add('is-clear');
      return;
    }
    var ctx = canvas.getContext('2d');
    var eraser = document.createElement('canvas');
    var ectx = eraser.getContext('2d');
    // no 2D context (iOS canvas memory): the word stays clear, as without JS
    if (!ctx || !ectx) { root.classList.add('is-clear'); return; }
    var css = getComputedStyle(doc);
    var fog = getComputedStyle(root).getPropertyValue('--clarity-fog').trim() || css.getPropertyValue('--c-night').trim();
    var palette = [
      css.getPropertyValue('--c-biscuit').trim(),
      css.getPropertyValue('--c-saif').trim(),
      css.getPropertyValue('--c-white').trim(),
      css.getPropertyValue('--grove-ground').trim() || css.getPropertyValue('--c-biscuit').trim()
    ];
    var W = 0, H = 0, dpr = 1;
    var molecules = [];
    var pointer = { x: -999, y: -999, active: false };
    var last = null;
    var fogAlpha = 1;
    var dissolving = false;
    var done = false;
    var visible = false;
    var touched = false;
    var keyboard = false;
    var ratio = 0;
    var autoTimer = 0;
    var raf = 0;
    var stamps = 0;

    root.classList.add('is-active');

    function rand(a, b) { return a + Math.random() * (b - a); }

    function build() {
      var rect = root.getBoundingClientRect();
      W = Math.round(rect.width);
      H = Math.round(rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      var oldW = eraser.width, oldH = eraser.height, keep = null;
      if (oldW && oldH) {
        keep = document.createElement('canvas');
        keep.width = oldW; keep.height = oldH;
        var kctx = keep.getContext('2d');
        if (kctx) kctx.drawImage(eraser, 0, 0); else keep = null;
      }
      eraser.width = W;
      eraser.height = H;
      if (keep) ectx.drawImage(keep, 0, 0, W, H);
      molecules = [];
      var count = Math.min(Math.round((W * H) / 120), 3200);
      for (var i = 0; i < count; i++) {
        var atoms = [];
        var n = Math.random() < 0.55 ? 1 : (Math.random() < 0.6 ? 2 : 3);
        for (var a = 0; a < n; a++) atoms.push({ dx: a === 0 ? 0 : rand(-6, 6), dy: a === 0 ? 0 : rand(-6, 6), r: rand(0.7, 2.1) });
        molecules.push({
          x: rand(0, W), y: rand(0, H), hx: 0, hy: 0,
          vx: rand(-0.08, 0.08), vy: rand(-0.06, 0.06),
          atoms: atoms,
          c: palette[Math.floor(Math.random() * palette.length)],
          a: rand(0.3, 0.9)
        });
      }
    }

    function stamp(x, y, radius) {
      var g = ectx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.85)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ectx.fillStyle = g;
      ectx.beginPath();
      ectx.arc(x, y, radius, 0, Math.PI * 2);
      ectx.fill();
      stamps++;
      if (!simulating && stamps % 12 === 0) checkCleared();
    }

    function brush(x, y, radius) {
      if (last) {
        var dx = x - last.x, dy = y - last.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var steps = Math.min(Math.ceil(dist / (radius * 0.35)), 30);
        for (var i = 1; i <= steps; i++) stamp(last.x + dx * i / steps, last.y + dy * i / steps, radius);
      } else {
        stamp(x, y, radius);
      }
      last = { x: x, y: y };
    }

    function checkCleared() {
      if (dissolving) return;
      var x0 = Math.round(W * 0.15), x1 = Math.round(W * 0.85);
      var y0 = Math.round(H * 0.2), y1 = Math.round(H * 0.8);
      var data;
      try { data = ectx.getImageData(x0, y0, x1 - x0, y1 - y0).data; } catch (e) { return; }
      var w = x1 - x0, h = y1 - y0, hits = 0, total = 0;
      for (var y = 0; y < h; y += 8) {
        for (var x = 0; x < w; x += 8) {
          total++;
          if (data[(y * w + x) * 4 + 3] > 140) hits++;
        }
      }
      if (total && hits / total > 0.6) clearNow();
    }

    function clearNow() {
      if (dissolving) return;
      dissolving = true;
      clearTimeout(autoTimer);
      root.classList.add('is-clear');
      kick();
    }

    /* Full reveal for keyboard visitors (accessibility floor): a sweep across the word, then the haze lifts. */
    function autoReveal() {
      if (dissolving || done) return;
      var t0 = performance.now(), dur = 1100, saved = last;
      last = null;
      function step(now) {
        if (dissolving) return;
        var t = clamp((now - t0) / dur, 0, 1);
        var e = easeInOut(t);
        var x = W * (0.08 + 0.84 * e);
        var y = H * (0.5 + 0.18 * Math.sin(e * Math.PI * 2));
        brush(x, y, Math.max(H * 0.42, 60));
        kick();
        if (t < 1) requestAnimationFrame(step);
        else { last = saved; clearNow(); }
      }
      requestAnimationFrame(step);
    }

    /* Pointer and touch visitors: shortly after the strip is in view, an unseen hand scrubs the middle of the
       word with the visitor's own brush. Natural, slightly irregular strokes, back and forth for about two
       seconds, clear a good part of it and leave uneven haze, so it begs to be finished. Then it waits.
       A faint ring (the cue) rides the hand, so the gesture reads as an invitation. */
    var handDone = false;
    var simulating = false;
    var cue = $('[data-clarity-cue-dot], .clarity__cue-dot', root);
    var coarse = window.matchMedia('(pointer: coarse)').matches;
    function seeded(a) { return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    function sineInOut(t) { return 0.5 - 0.5 * Math.cos(Math.PI * t); }
    function handScrub() {
      if (dissolving || done || touched || handDone) return;
      handDone = true;
      simulating = true;
      var word = $('[data-clarity-word], .clarity__word', root);
      var wr = word.getBoundingClientRect(), rr = root.getBoundingClientRect();
      var x0 = wr.left - rr.left, y0 = wr.top - rr.top, ww = wr.width, wh = wr.height;
      var radius = coarse ? 44 : 36;
      var r = seeded(20261109);
      // way points: the hand lands left of center, then sweeps right and left, the band drifting
      // up and down a little each pass, the reach a little different every time
      // a scrub, not a sweep: the hand works along the word in short up-and-down strokes spaced a little
      // wider than the brush, so wedges of haze survive at the top and bottom between strokes, then comes
      // back in a few loose strokes through the middle. The ends of the word stay hidden.
      // strokes about 0.9 brush widths apart, each reaching a different height, so the top and bottom
      // edges stay ragged and islands of haze survive between them
      // the scrubbed span leaves about two brush widths of haze at each end, so on a small screen (a big
      // touch brush, a small word) the ends of the word stay hidden too
      var span = Math.max(radius, Math.min(ww * 0.5, ww - radius * 4.4));
      var n = Math.max(3, Math.min(7, Math.round(span / (radius * 1.75))));
      var gap = span / n;
      var xs = x0 + ww * 0.5 - span / 2;
      var pts = [{ x: xs, y: y0 + wh * (0.3 + r() * 0.1) }];
      for (var i = 1; i <= n; i++) {
        var low = i % 2 === 1;
        var yy = low ? 0.64 + r() * 0.2 : 0.18 + r() * 0.22;
        pts.push({ x: xs + gap * i + (r() - 0.5) * gap * 0.25, y: y0 + wh * yy });
      }
      // a loose return through the middle, shorter than the first pass
      pts.push({ x: x0 + ww * 0.5 - span * (0.18 + r() * 0.1), y: y0 + wh * (0.48 + r() * 0.1) });
      pts.push({ x: x0 + ww * 0.5 + span * (0.12 + r() * 0.1), y: y0 + wh * (0.4 + r() * 0.1) });
      // each stroke: a gentle arc, sine-timed (slow at the turn, fast through the middle), its own pace
      var strokes = [], total = 0;
      for (var k = 0; k < pts.length - 1; k++) {
        var a = pts[k], b = pts[k + 1];
        var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
        var bow = (r() - 0.5) * wh * 0.22;
        var dur = 170 + len * 0.55 + r() * 70;
        strokes.push({ a: a, b: b, c: { x: (a.x + b.x) / 2 - dy / len * bow, y: (a.y + b.y) / 2 + dx / len * bow }, t0: total, dur: dur });
        total += dur;
      }
      var lead = 260; // the hand settles before it starts to scrub
      var t0 = performance.now();
      last = null;
      root.classList.add('is-scrubbing');
      function place(x, y, o) {
        if (!cue) return;
        cue.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
        cue.style.opacity = String(o);
      }
      function step(now) {
        if (dissolving || touched) { end(0, 0); return; }
        var el = now - t0;
        if (el < lead) {
          var f = el / lead;
          place(pts[0].x, pts[0].y - (1 - f) * 18, 0.55 * f);
          requestAnimationFrame(step);
          return;
        }
        var t = el - lead;
        var s = strokes[strokes.length - 1];
        for (var j = 0; j < strokes.length; j++) { if (t < strokes[j].t0 + strokes[j].dur) { s = strokes[j]; break; } }
        var u = sineInOut(clamp((t - s.t0) / s.dur, 0, 1));
        var iu = 1 - u;
        var x = iu * iu * s.a.x + 2 * iu * u * s.c.x + u * u * s.b.x;
        var y = iu * iu * s.a.y + 2 * iu * u * s.c.y + u * u * s.b.y;
        y += Math.sin(t * 0.031) * 2.2; // the small tremor of a real hand
        // the brush only: no molecule push, so the haze the hand misses stays put, in patches
        brush(x, y, radius);
        place(x, y, 0.55);
        kick();
        if (t < total) requestAnimationFrame(step);
        else end(x, y);
      }
      function end(x, y) {
        simulating = false;
        pointer.active = false;
        last = null;
        root.classList.remove('is-scrubbing');
        if (cue) { cue.style.transition = 'opacity 700ms ease'; cue.style.opacity = '0'; }
        // A visitor who has not used a pointer on the page at all (a screen reader's swipes, say)
        // cannot finish the erase, so after the hand's scrub the word clears on its own. Pointer visitors keep the
        // invitation to finish it themselves.
        setTimeout(function () { if (!pointerSeen && !touched) autoReveal(); }, 900);
      }
      requestAnimationFrame(step);
    }

    function scheduleAuto() {
      clearTimeout(autoTimer);
      if (touched || dissolving || handDone) return;
      autoTimer = setTimeout(handScrub, 650);
    }

    function draw() {
      raf = 0;
      if (!visible || done) return;
      if (dissolving) {
        fogAlpha -= 0.022;
        if (fogAlpha <= 0) {
          fogAlpha = 0;
          done = true;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          canvas.style.pointerEvents = 'none';
          return;
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = fogAlpha;
      ctx.fillStyle = fog;
      ctx.fillRect(0, 0, W, H);

      for (var i = 0; i < molecules.length; i++) {
        var m = molecules[i];
        m.x += m.vx; m.y += m.vy;
        var dx, dy, d2, d, f;
        if (pointer.active) {
          dx = m.x - pointer.x; dy = m.y - pointer.y; d2 = dx * dx + dy * dy;
          if (d2 < 6400 && d2 > 0.01) { d = Math.sqrt(d2); f = (80 - d) / 80 * 1.6; m.hx += dx / d * f; m.hy += dy / d * f; }
        }
        m.hx *= 0.9; m.hy *= 0.9;
        m.x += m.hx; m.y += m.hy;
        if (m.x < -8) m.x = W + 8; else if (m.x > W + 8) m.x = -8;
        if (m.y < -8) m.y = H + 8; else if (m.y > H + 8) m.y = -8;

        ctx.globalAlpha = m.a * fogAlpha;
        ctx.fillStyle = m.c;
        ctx.strokeStyle = m.c;
        var at = m.atoms;
        if (at.length > 1) {
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(m.x, m.y);
          for (var b = 1; b < at.length; b++) ctx.lineTo(m.x + at[b].dx, m.y + at[b].dy);
          ctx.stroke();
        }
        for (var k = 0; k < at.length; k++) {
          ctx.beginPath();
          ctx.arc(m.x + at[k].dx, m.y + at[k].dy, at[k].r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(eraser, 0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(draw);
    }

    function kick() { if (!raf && visible && !done) raf = requestAnimationFrame(draw); }

    function local(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function touch() {
      if (!touched) { touched = true; clearTimeout(autoTimer); if (cue) cue.style.opacity = '0'; }
    }

    canvas.addEventListener('pointerenter', function (e) {
      var p = local(e); last = null; pointer.x = p.x; pointer.y = p.y; pointer.active = true;
    });
    canvas.addEventListener('pointermove', function (e) {
      if (done) return;
      var p = local(e);
      pointer.x = p.x; pointer.y = p.y; pointer.active = true;
      touch();
      brush(p.x, p.y, e.pointerType !== 'mouse' ? 44 : 36);
      kick();
    });
    canvas.addEventListener('pointerdown', function (e) {
      if (done) return;
      var p = local(e); last = null;
      touch();
      brush(p.x, p.y, e.pointerType !== 'mouse' ? 44 : 36);
    });
    function leave() { pointer.active = false; last = null; }
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('pointercancel', leave);
    canvas.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') leave(); });

    var pointerSeen = false;
    ['pointerdown', 'pointermove'].forEach(function (t) {
      document.addEventListener(t, function () { pointerSeen = true; }, { passive: true, once: true });
    });
    // Keyboard visitors: as soon as they move the page with keys, the word reveals itself in view.
    var navKeys = { Tab: 1, ArrowDown: 1, ArrowUp: 1, PageDown: 1, PageUp: 1, Home: 1, End: 1, ' ': 1, Spacebar: 1 };
    document.addEventListener('keydown', function (e) {
      if (!navKeys[e.key]) return;
      keyboard = true;
      if (ratio > 0.5) autoReveal();
    });

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (!done) build(); }, 150);
    }, { passive: true });

    build();
    if (hasIO) {
      new IntersectionObserver(function (entries) {
        var e = entries[0];
        visible = e.isIntersecting;
        ratio = e.intersectionRatio;
        if (visible) kick();
        if (ratio >= 0.75) {
          if (keyboard) { autoReveal(); return; }
          if (!autoTimer) scheduleAuto();
        } else {
          if (!handDone) { clearTimeout(autoTimer); autoTimer = 0; }
          if (keyboard && ratio > 0.5) autoReveal();
        }
      }, { threshold: [0, 0.25, 0.5, 0.75, 0.9, 1] }).observe(root);
    } else {
      visible = true; kick(); scheduleAuto();
    }
    // Paint one frame right away so the word never flashes before the haze.
    visible = true; draw(); visible = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  /* ---------- Experience: the typewriter ----------
     When the numbers are in view, a thin text cursor blinks at the first one, then types "12+" a character at a
     time, with a hand's uneven rhythm (a beat longer before the "+", a shifted key). It moves to "45+" and types it,
     then "6", blinks twice and fades out. Each label rises in as its number completes. The real numbers stay in
     .sr-only twins, so a screen reader always hears "12+", never the characters one by one. Replays after a reset.
     No JS or reduced motion: the plain numbers (nothing is rebuilt). */
  function initTypewriter(list) {
    if (!list || reduceMotion || !hasIO) return null;
    var items = $$('[data-stat], .stat', list).map(function (li) {
      var num = $('[data-type]', li);
      var text = num.textContent.trim();
      num.textContent = '';
      var sr = document.createElement('span'); sr.className = 'sr-only'; sr.textContent = text;
      var vis = document.createElement('span'); vis.className = 'type'; vis.setAttribute('aria-hidden', 'true');
      var ghost = document.createElement('span'); ghost.className = 'type__ghost'; ghost.textContent = text;
      var line = document.createElement('span'); line.className = 'type__line';
      var typed = document.createElement('span'); typed.className = 'type__text';
      line.appendChild(typed); vis.appendChild(ghost); vis.appendChild(line);
      num.appendChild(sr); num.appendChild(vis);
      return { li: li, text: text, line: line, typed: typed };
    });
    var caret = document.createElement('span'); caret.className = 'type__caret';
    var LEAD = 640, MOVE_PAUSE = 520, SETTLE = 240, BLINK = 1060, OUT = 320;
    var timers = [];
    function at(ms, fn) { timers.push(window.setTimeout(fn, ms)); }
    function seeded(a) { return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    function blinkFrom(el) { caret.classList.remove('is-solid', 'is-leaving'); void caret.offsetWidth; if (caret.parentNode !== el) el.appendChild(caret); }
    function arm() {
      timers.forEach(clearTimeout); timers = [];
      list.classList.add('is-armed');
      items.forEach(function (it) { it.typed.textContent = ''; it.li.classList.remove('is-typed'); });
      if (caret.parentNode) caret.parentNode.removeChild(caret);
      caret.classList.remove('is-solid', 'is-leaving');
    }
    function finish() {
      arm();
      items.forEach(function (it) { it.typed.textContent = it.text; it.li.classList.add('is-typed'); });
    }
    function play() {
      arm();
      var r = seeded(20261109), t = 0;
      items.forEach(function (it, n) {
        at(t, function () { blinkFrom(it.line); });            // the cursor arrives and blinks
        t += n === 0 ? LEAD : SETTLE;
        Array.prototype.forEach.call(it.text, function (ch, k) {
          at(t, function () { caret.classList.add('is-solid'); it.typed.textContent += ch; });
          var next = it.text.charAt(k + 1);
          t += 95 + r() * 85 + (next === '+' ? 90 : 0);        // keystrokes: 95 to 180 ms, a beat more before a shifted "+"
        });
        at(t - 60, function () { it.li.classList.add('is-typed'); caret.classList.remove('is-solid'); });
        t += n < items.length - 1 ? MOVE_PAUSE : BLINK * 2;    // a pause, then the next number; after the last, two blinks
      });
      at(t, function () { caret.classList.add('is-leaving'); });
      at(t + OUT, function () { if (caret.parentNode) caret.parentNode.removeChild(caret); list.classList.remove('is-armed'); items.forEach(function (it) { it.li.classList.add('is-typed'); }); });
    }
    arm();
    var io = new IntersectionObserver(function (es) {
      var e = es[0];
      if (e.isIntersecting) { io.unobserve(list); play(); }
      else if (e.boundingClientRect.bottom < 0) { io.unobserve(list); finish(); } // already scrolled past: finished
    }, { threshold: 0.35 });
    io.observe(list);
    return { reset: function () { arm(); io.observe(list); } };
  }

  /* ---------- Experience ----------
     The three numbers are typed in (above). Phase 1 to Phase 4: a fine line draws across and each moon waxes as the
     line reaches it. The therapeutic areas arrive with a CSS glint on the shared reveal, so they need no code here. */
  function initExperience() {
    var sec = $('[data-experience]');
    if (!sec) return;
    var typer = initTypewriter($('[data-stats]', sec));

    /* Phase 1 to Phase 4: the line waits until it is well into view (its top past 55% of the viewport), then draws
       across in 3.2 s, and as it reaches each moon the moon waxes and pops in a brief gold glow (CSS, .is-popped), so
       all four pops are seen. Replays after a reset. */
    var phases = $('[data-phases]', sec);
    var moons = phases ? $$('[data-phase]', phases).map(function (el, i) {
      return { el: el, g: el.closest('.phases__moon'), f: parseFloat(el.getAttribute('data-phase')) || 1, at: (100 + i * 200 - 10) / 780, popped: false };
    }) : [];
    var debug = /[?&]phase-debug\b/.test(location.search);

    function setDraw(d, pop) {
      phases.style.setProperty('--draw', d.toFixed(4));
      moons.forEach(function (m) {
        var k = easeOut(clamp((d - m.at) / 0.1, 0, 1));
        m.el.setAttribute('d', moonPath(0.04 + (m.f - 0.04) * k));
        m.el.style.opacity = d >= m.at ? '1' : '0';
        if (pop && d >= m.at && !m.popped && m.g) {
          m.popped = true;
          m.g.classList.remove('is-popped'); void m.g.getBoundingClientRect(); m.g.classList.add('is-popped');
        }
      });
    }

    if (!phases) return;
    if (reduceMotion || !hasIO) { setDraw(1, false); return; }
    var LINE = 3200, praf = 0;
    function arm() {
      cancelAnimationFrame(praf); praf = 0;
      moons.forEach(function (m) { m.popped = false; if (m.g) m.g.classList.remove('is-popped'); });
      setDraw(0, false);
    }
    function play() {
      if (praf) return;
      var t0 = performance.now();
      (function tick(now) {
        var k = clamp((now - t0) / LINE, 0, 1);
        setDraw(0.5 - 0.5 * Math.cos(Math.PI * k), true);
        praf = k < 1 ? requestAnimationFrame(tick) : 0;
      })(t0);
    }
    arm();
    var pio = new IntersectionObserver(function (es) {
      var e = es[0];
      if (e.isIntersecting) { pio.unobserve(phases); play(); }
      else if (e.boundingClientRect.bottom < 0) { pio.unobserve(phases); setDraw(1, false); } // already past: finished
    }, { rootMargin: '0px 0px -45% 0px', threshold: 0 });
    pio.observe(phases);
    sec.addEventListener('ncc:reset', function () {
      if (typer) typer.reset();
      arm();
      pio.observe(phases);
    });
    if (debug) Object.assign(window, { __nccPhase: { seek: function (ms) { pio.unobserve(phases); arm(); var steps = 24; for (var i = 0; i <= steps; i++) { var k = clamp(ms / LINE * i / steps, 0, 1); setDraw(0.5 - 0.5 * Math.cos(Math.PI * k), true); } }, LINE: LINE } });
  }

  /* ---------- Meet Tami: she signs the page ----------
     When the signature is well in view, it is written stroke by stroke, in writing order: the T, "ami",
     the two strokes of the N and "ewaz", then the loop, a little quicker, as one flourish, then the dot of the i.
     Within each stroke the pen slows in tight turns and runs in long sweeps (speed follows the radius of the curve,
     after the two-thirds power law of handwriting), starts gently and lifts gently, and pauses between strokes.
     The loop is a filled ribbon, revealed by the brush in its mask, which follows its centerline.
     No JS, reduced motion, or already scrolled past: the finished signature. ?sig-debug exposes
     window.__nccSig.seek(ms) and .total for filmstrips. */
  function initSignature() {
    var svg = $('[data-signature]');
    if (!svg || reduceMotion || !hasIO) return;
    var debug = /[?&]sig-debug\b/.test(location.search);
    var PACE = 0.55;                       // the whole hand runs at 0.55 x the plan's time (about 2.3 s); the plan below is in unscaled ms
    var LIFT = [260, 320, 150, 70, 280];   // pen lifts after each stroke, ms
    var K = 330, VMIN = 520, VMAX = 2300; // design units per second: v = K * radius^(1/3), clamped
    var LOOP = 1.55;                       // the flourish runs this much faster
    var paths = $$('.sig__stroke', svg).concat([$('.sig__brush', svg)]);
    var dot = $('.sig__dot', svg);
    if (paths.some(function (p) { return !p || !p.getTotalLength; }) || !dot) return;

    // a time table per stroke: cumulative ms at every sample along its length
    var plan = [], clock = 0;
    paths.forEach(function (el, k) {
      var len = el.getTotalLength();
      var n = Math.max(8, Math.ceil(len / 4));
      var ds = len / n, pts = [], i;
      for (i = 0; i <= n; i++) pts.push(el.getPointAtLength(i * ds));
      var v = [];
      for (i = 0; i < n; i++) {
        var a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[Math.min(n, i + 2)];
        var t1 = Math.atan2(b.y - a.y, b.x - a.x), t2 = Math.atan2(c.y - b.y, c.x - b.x);
        var d = Math.abs(Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1)));
        var span = Math.hypot(c.x - a.x, c.y - a.y) || ds;
        var r = d > 1e-4 ? span / d : 1e4;
        v.push(clamp(K * Math.cbrt(r), VMIN, VMAX) * (k === 4 ? LOOP : 1));
      }
      // smooth the speed, then ease the pen in and out over the first and last stretch
      var sv = v.map(function (_, j) { var s = 0, c = 0; for (var q = j - 4; q <= j + 4; q++) if (q >= 0 && q < n) { s += v[q]; c++; } return s / c; });
      var times = [0], acc = 0;
      for (i = 0; i < n; i++) {
        var u = i / n, ramp = Math.min(1, 0.35 + u / 0.08 * 0.65, 0.4 + (1 - u) / 0.06 * 0.6);
        acc += ds / (sv[i] * ramp) * 1000;
        times.push(acc);
      }
      el.style.strokeDasharray = len + ' ' + (len + 10);
      plan.push({ el: el, len: len, ds: ds, times: times, start: clock, dur: acc });
      clock += acc + LIFT[k];
    });
    var dotAt = clock, total = clock + 120;
    dot.style.opacity = '0';

    function lengthAt(p, ms) {
      var T = p.times, lo = 0, hi = T.length - 1;
      while (lo < hi - 1) { var m = (lo + hi) >> 1; if (T[m] <= ms) lo = m; else hi = m; }
      var f = (ms - T[lo]) / ((T[hi] - T[lo]) || 1);
      return Math.min(p.len, (lo + f) * p.ds);
    }
    function paint(ms) {
      plan.forEach(function (p) {
        var local = ms - p.start;
        p.el.style.strokeDashoffset = String(local <= 0 ? p.len + 5 : local >= p.dur ? 0 : p.len - lengthAt(p, local));
      });
      dot.style.opacity = String(clamp((ms - dotAt) / 90, 0, 1));
    }
    paint(0);

    var raf = 0, t0 = 0, wait = 0;
    function frame(now) {
      var ms = (now - t0) / PACE;
      paint(ms);
      raf = ms < total ? requestAnimationFrame(frame) : 0;
    }
    var io = new IntersectionObserver(function (es) {
      var e = es[0];
      if (e.boundingClientRect.bottom < 0) { io.unobserve(svg); paint(total); return; } // already past: finished
      if (!e.isIntersecting || e.intersectionRatio < 0.58) return;
      io.unobserve(svg);
      wait = window.setTimeout(function () { t0 = performance.now(); raf = requestAnimationFrame(frame); }, 180);
    }, { threshold: [0, 0.6] });
    io.observe(svg);
    // replay: Tami signs again on the next way down
    var scope = svg.closest('section');
    if (scope) scope.addEventListener('ncc:reset', function () {
      clearTimeout(wait); if (raf) cancelAnimationFrame(raf); raf = 0;
      paint(0);
      io.observe(svg);
    });
    if (debug) {
      Object.assign(window, { __nccSig: {
        total: total, pace: PACE,
        plan: plan.map(function (p) { return [Math.round(p.start), Math.round(p.dur), Math.round(p.len)]; }),
        seek: function (ms) { io.disconnect(); clearTimeout(wait); if (raf) cancelAnimationFrame(raf); raf = 0; paint(ms); }
      } });
    }
  }

  /* ---------- Closing: the NCC lockup draws in ----------
     The vertical lockup, no outline. 33 pieces draw in one at a time: the symbol's 10, nearest its
     center first, then the 23 letters in reading order. Each piece is revealed solid, in its own color, by a brush
     that follows its outline (CSS, delayed by --t). Starts when the lockup is 60% in view. No JS, or reduced motion:
     the finished lockup. */
  function initLockup() {
    var lk = $('[data-lockup]');
    if (!lk || reduceMotion || !hasIO) return;
    var pieces = $$('.lockup__piece', lk);
    var SYM_STEP = 170, LETTER_STEP = 55, GAP = 160;
    var sym = [], letters = [];
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pieces.forEach(function (g, i) {
      var b = g.getBBox();
      var o = { g: g, i: i, x: b.x + b.width / 2, y: b.y + b.height / 2 };
      if (g.getAttribute('data-kind') === 'sym') {
        sym.push(o);
        x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
      } else letters.push(o);
    });
    // the symbol: center outward, from the center of its own box (it sits above the words)
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    sym.sort(function (p, q) {
      var dp = Math.hypot(p.x - cx, p.y - cy), dq = Math.hypot(q.x - cx, q.y - cy);
      return (dp - dq) || (Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx));
    });
    // the letters: line by line, left to right (already in that order in the source file)
    function arm(o, ms) {
      // two brushes per piece, one from each end of its outline
      $$('#lk-m' + o.i + ' .lockup__brush').forEach(function (brush) { brush.style.setProperty('--t', ms + 'ms'); });
    }
    sym.forEach(function (o, k) { arm(o, k * SYM_STEP); });
    var t = (sym.length - 1) * SYM_STEP + GAP;
    letters.forEach(function (o, k) { arm(o, t + k * LETTER_STEP); });
    lk.classList.add('is-armed');
    // The last piece starts here and is solid about 300 ms later (two brushes meet halfway). The footer's
    // first beam of light is timed to cross the lockup just before then (initWallpaper listens for 'ncc:lockup-draw').
    var lastStart = t + (letters.length - 1) * LETTER_STEP;
    var io = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting) return;
      io.unobserve(lk);
      lk.getBoundingClientRect(); // commit the armed state before the transitions start
      requestAnimationFrame(function () {
        lk.classList.add('is-drawing');
        lk.dispatchEvent(new CustomEvent('ncc:lockup-draw', { bubbles: true, detail: { crossAt: lastStart + 150 } }));
        unmaskLater();
      });
    }, { threshold: 0.6 });
    io.observe(lk);
    // A solid piece no longer needs its mask, so each drops it once its brushes have finished.
    // Every frame of the draw then composites only the pieces still drawing. A replay puts the masks back first.
    var PIECE_MS = parseFloat(getComputedStyle(lk).getPropertyValue('--dur-lockup-piece')) || 820;
    var unmaskTimers = [];
    var masked = pieces.map(function (g) { return $$('[mask]', g); });
    var maskRefs = masked.map(function (list) { return list.map(function (n) { return n.getAttribute('mask'); }); });
    function unmaskLater() {
      pieces.forEach(function (g, i) {
        var brush = $('#lk-m' + i + ' .lockup__brush');
        var at = brush ? parseFloat(brush.style.getPropertyValue('--t')) || 0 : 0;
        unmaskTimers.push(setTimeout(function () { masked[i].forEach(function (n) { n.removeAttribute('mask'); }); }, at + PIECE_MS + 60));
      });
    }
    function remask() {
      unmaskTimers.forEach(clearTimeout); unmaskTimers = [];
      masked.forEach(function (list, i) { list.forEach(function (n, k) { n.setAttribute('mask', maskRefs[i][k]); }); });
    }
    var scope = lk.closest('footer, section');
    if (scope) scope.addEventListener('ncc:reset', function () {
      remask();
      lk.classList.add('is-resetting');
      lk.classList.remove('is-drawing');
      lk.getBoundingClientRect();
      lk.classList.remove('is-resetting');
      io.observe(lk);
    });
  }

  /* ---------- Closing: the symbol wallpaper and its beam of light ----------
     A beam crosses the closing from right to left and shows the wallpaper inside it (CSS). The first beam is timed
     off the lockup, so its peak crosses the lockup's center about 150 ms after the last letter starts, just before that
     letter is solid; then one every 5 to 7.5 s (a new random wait each time). The beam's peak reaches the middle
     halfway through its 2.8 s (--ease-sweep is symmetric). Nothing runs while the closing is off screen or the tab is
     hidden. Reduced motion: never (the layer is also removed in CSS).
     ?wall-debug exposes window.__nccWall.sweep(). */
  function initWallpaper() {
    var el = $('[data-wallpaper]');
    if (!el || reduceMotion) return;
    var SWEEP = 2800, EVERY = 5000, JITTER = 2500;
    var footer = el.parentElement;
    var visible = false, timer = 0;
    var lockupPending = !!$('[data-lockup]', footer) && hasIO; // the first beam waits for the lockup to start drawing
    function schedule(ms) { clearTimeout(timer); timer = window.setTimeout(run, ms); }
    function sweep() {
      el.classList.remove('is-sweeping');
      void el.offsetWidth; // restart the animation
      el.classList.add('is-sweeping');
    }
    function run() {
      timer = 0;
      if (!visible || document.hidden) return;
      sweep();
      schedule(EVERY + Math.random() * JITTER);
    }
    el.addEventListener('animationend', function () { el.classList.remove('is-sweeping'); });
    function sync() {
      if (visible && !document.hidden) { if (!timer && !lockupPending) schedule(EVERY + Math.random() * JITTER); }
      else { clearTimeout(timer); timer = 0; }
    }
    footer.addEventListener('ncc:lockup-draw', function (e) {
      lockupPending = false;
      if (document.hidden) return;
      visible = true; // the lockup is 60% in view, so the closing is too
      schedule(Math.max(0, e.detail.crossAt - SWEEP / 2));
    });
    footer.addEventListener('ncc:reset', function () { lockupPending = !!$('[data-lockup]', footer); clearTimeout(timer); timer = 0; });
    if (hasIO) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; sync(); }, { threshold: 0.15 }).observe(footer);
    else { visible = true; sync(); }
    document.addEventListener('visibilitychange', sync);
    if (/[?&]wall-debug\b/.test(location.search)) Object.assign(window, { __nccWall: { sweep: sweep } });
  }

  /* ---------- Core Capabilities: each symbol draws in, then its title rises ----------
     Each row head owns its title's reveal (data-reveal-owner, set here, so without this script the title reveals on
     its own). As a row reaches the reading line, its symbol turns and grows into place (CSS: .row__mark.is-in), and its
     title rises 4 staggers later. Rows that reach the line together follow each other, 3 staggers apart. Replays with
     the section; nothing moves under reduced motion. */
  function initRowMarks() {
    var marks = $$('[data-row-mark], .row__mark');
    if (!marks.length || reduceMotion) return;
    if (!hasIO) { marks.forEach(function (m) { m.classList.add('is-in'); }); return; }
    var stagger = parseFloat(getComputedStyle(doc).getPropertyValue('--stagger')) || 70;
    var TITLE_LAG = 4 * stagger, ROW_GAP = 3 * stagger;
    var rows = marks.map(function (m) {
      var head = m.parentElement;
      head.setAttribute('data-reveal-owner', '');
      return { mark: m, head: head, title: $('[data-split]', head), timers: [] };
    });
    var free = 0; // when the next row may start
    function play(r) {
      var now = performance.now();
      var at = Math.max(now, free);
      free = at + ROW_GAP;
      r.timers.push(window.setTimeout(function () { r.mark.classList.add('is-in'); }, at - now));
      r.timers.push(window.setTimeout(function () { if (r.title && window.NCCText) window.NCCText.reveal(r.title); }, at - now + TITLE_LAG));
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!(e.isIntersecting || e.boundingClientRect.top < 0)) return;
        io.unobserve(e.target);
        rows.forEach(function (r) { if (r.head === e.target) play(r); });
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
    function watch() { rows.forEach(function (r) { io.observe(r.head); }); }
    // the titles are split once the fonts are in (text-reveal.js); start watching then, so each one rises
    if (window.NCCText && window.NCCText.ready) window.NCCText.ready.then(watch); else watch();
    var scope = rows[0].head.closest('section');
    if (scope) scope.addEventListener('ncc:reset', function () {
      free = 0;
      rows.forEach(function (r) {
        r.timers.forEach(clearTimeout); r.timers = [];
        r.mark.classList.remove('is-in');
        if (r.title && window.NCCText) window.NCCText.hide(r.title);
        io.unobserve(r.head);
        io.observe(r.head);
      });
    });
  }

  function start() {
    initSchedule();
    initAnchors();
    initScrollPadding();
    initHeader();
    initNav();
    initReveal();
    initRowMarks();
    later($('[data-clarity]'), initClarity);
    initStripIcons();
    initHeaderMoon();
    initExperience();
    later($('[data-signature]'), initSignature);
    initLockup();
    initWallpaper();
    initReplay();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
