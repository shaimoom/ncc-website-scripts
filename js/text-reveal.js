/* Newaz Clinical Consulting, shared text reveal. Round 5.
   One system for every heading and key line on the page.

   Markup: [data-split] splits into lines (default); [data-split="chars"] splits into letters, for single display words.
   Optional style="--d: n" delays the start by n steps of --stagger, the same delay scale as [data-reveal].

   How it works
   - The element's own content moves, untouched, into a visually hidden twin (.sr-only). Screen readers read that
     twin once, with its real markup (an <em> stays an <em>). The animated copy is aria-hidden. No aria-label, so
     paragraphs and spans stay valid, and the accessible text is never fragmented.
   - The animated copy is built from the laid-out text: every word is measured, words are grouped into the lines the
     browser actually set, and each line becomes a mask (overflow hidden) whose inner row rises into place.
     Line height and wrapping are the browser's own, so nothing shifts.
   - Progressive enhancement: the head script hides split text only while html.tr-pending is set, and a 2.4 s timer
     removes it even if this file never runs. Reduced motion: nothing is split, nothing moves.
   - Splits wait for the fonts, and re-split when the width changes or late fonts land.
   - A section that drives its own choreography sets data-reveal-owner; its text is then revealed by that owner
     through window.NCCText.reveal(el) / .hide(el) instead of on entering the viewport.
   - Round 8, replay: window.NCCText.reset(scope) hides every split element in a scope again (main.js calls it once the
     scope is out of view below), so its lines rise again on the next entry. Owner-driven text is left alone.
   - Vera fixes, WCAG 1.4.12 text spacing: the split lines are nowrap masks, so they cannot reflow when a visitor raises
     letter, word or line spacing. Once an element's reveal has finished (its last line's transform transitionend, with a
     timer as the backstop), its ORIGINAL markup is put back: plain flowing text, no masks, no twin. Text spacing, a
     narrower window, copy and paste, and browser translation then all behave like normal HTML, and the letter-split
     verbs keep their kerning (PREPARE no longer reads "PREP ARE"). Before anything animates it again, it is split again
     from the laid-out text: on replay (reset), on hide(), and on window.NCCText.split(el), which a choreography owner
     calls before it moves a step out (approach-plant.js). The look of the reveal does not change.
   - Before a reveal starts, lines measured under other spacing or fonts (wider than their box) are re-measured. */
// @ts-check
(function () {
  'use strict';

  var doc = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** @type {{reveal: (el: Element) => void, hide: (el: Element) => void, split: (el: Element) => boolean, reset: (scope: Element) => void, refresh: () => void, ready: Promise<void>}} */
  var api;
  /** @type {() => void} */
  var resolveReady = function () {};
  var ready = new Promise(function (res) { resolveReady = function () { res(undefined); }; });

  function release() { doc.classList.remove('tr-pending'); resolveReady(); }

  /** @param {Element} el */
  function reveal(el) { el.classList.add('is-in'); }
  /** @param {Element} el */
  function hide(el) { el.classList.remove('is-in'); }
  // (the split path below replaces both with versions that know about the restored text)

  if (reduce || !('IntersectionObserver' in window)) {
    api = { reveal: reveal, hide: hide, split: function () { return false; }, reset: function () {}, refresh: function () {}, ready: ready };
    Object.assign(window, { NCCText: api });
    document.querySelectorAll('[data-split]').forEach(function (el) { el.classList.add('is-in'); });
    release();
    return;
  }

  /** flat: the reveal has finished and the original markup is back (Vera fixes); timer: the settle backstop
      @typedef {{el: HTMLElement, mode: string, html: string, width: number, size: string, vis: HTMLElement | null, flat: boolean, timer: number}} Item */
  /** @type {Item[]} */
  var items = [];

  /** Wrap every word of a subtree in span.tr-w, in place. @param {Node} root @returns {HTMLElement[]} */
  function wrapWords(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    /** @type {Text[]} */
    var texts = [];
    while (walker.nextNode()) texts.push(/** @type {Text} */ (walker.currentNode));
    /** @type {HTMLElement[]} */
    var words = [];
    texts.forEach(function (t) {
      var parts = (t.nodeValue || '').split(/(\s+)/);
      var frag = document.createDocumentFragment();
      parts.forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
        var w = document.createElement('span');
        w.className = 'tr-w';
        w.textContent = part;
        frag.appendChild(w);
        words.push(w);
      });
      if (t.parentNode) t.parentNode.replaceChild(frag, t);
    });
    return words;
  }

  /** Clone a word together with its inline ancestors (an <em>, say) up to the copy root.
      @param {HTMLElement} word @param {HTMLElement} stop @returns {Node} */
  function withAncestors(word, stop) {
    /** @type {Node} */
    var node = word.cloneNode(true);
    var p = word.parentNode;
    while (p && p !== stop) {
      var c = p.cloneNode(false);
      c.appendChild(node);
      node = c;
      p = p.parentNode;
    }
    return node;
  }

  /** @param {Item} it */
  function build(it) {
    var el = it.el;
    el.innerHTML = '';
    var sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.innerHTML = it.html;
    var vis = document.createElement('span');
    vis.className = 'tr';
    vis.setAttribute('aria-hidden', 'true');
    vis.innerHTML = it.html;
    el.appendChild(sr);
    el.appendChild(vis);
    var words = wrapWords(vis);
    var delay = parseFloat(getComputedStyle(el).getPropertyValue('--d')) || 0;
    el.style.setProperty('--tr-d', String(delay));

    if (it.mode === 'chars') {
      // letters: each in its own mask, so the word rises letter by letter
      var n = 0;
      words.forEach(function (w) {
        var text = w.textContent || '';
        w.textContent = '';
        Array.prototype.forEach.call(text, function (ch) {
          var m = document.createElement('span'); m.className = 'tr-cm';
          var c = document.createElement('span'); c.className = 'tr-c'; c.textContent = ch;
          c.style.setProperty('--i', String(n++));
          m.appendChild(c); w.appendChild(m);
        });
      });
      el.style.setProperty('--tr-n', String(n));
      vis.classList.add('tr--chars');
      it.vis = vis;
      return;
    }

    // lines: group the words by where the browser set them.
    // Round 9: by each word's vertical CENTER, and a new line only when it moves by half a line or more. Grouping by top
    // edge (3px) split one line in two whenever two faces on it had different ascents: with the italic still loading,
    // its fallback sat a few px higher, so "How We Work Together" became "How We Work" over "Together" (Shai's note).
    var cs = getComputedStyle(el);
    var half = (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2 || 16) / 2;
    /** @type {HTMLElement[][]} */
    var lines = [];
    var lastMid = -1e9;
    words.forEach(function (w) {
      var mid = w.offsetTop + w.offsetHeight / 2;
      if (Math.abs(mid - lastMid) >= half) { lines.push([]); lastMid = mid; }
      lines[lines.length - 1].push(w);
    });
    var out = document.createElement('span');
    out.className = 'tr tr--lines';
    out.setAttribute('aria-hidden', 'true');
    lines.forEach(function (line, i) {
      var mask = document.createElement('span'); mask.className = 'tr-l';
      var row = document.createElement('span'); row.className = 'tr-li';
      row.style.setProperty('--i', String(i));
      line.forEach(function (w, k) {
        row.appendChild(withAncestors(w, vis));
        if (k < line.length - 1) row.appendChild(document.createTextNode(' '));
      });
      mask.appendChild(row);
      out.appendChild(mask);
    });
    el.replaceChild(out, vis);
    el.style.setProperty('--tr-n', String(lines.length));
    it.vis = out;
  }

  /* ---------- Vera fixes: settle to flowing text, split again before the next animation ---------- */
  /** @param {Element} el @returns {Item | null} */
  function find(el) {
    for (var i = 0; i < items.length; i++) if (items[i].el === el) return items[i];
    return null;
  }
  /** the animated rows, in order (lines, or letters) @param {Item} it @returns {HTMLElement[]} */
  function rows(it) {
    return it.vis ? Array.prototype.slice.call(it.vis.querySelectorAll(it.mode === 'chars' ? '.tr-c' : '.tr-li')) : [];
  }
  /** every row has landed: revealed, at rest, fully opaque (not mid-rise, not held by the loader, not a step that left)
      @param {Item} it */
  function landed(it) {
    var r = rows(it);
    if (!r.length || !it.el.classList.contains('is-in')) return false;
    var cs = getComputedStyle(r[r.length - 1]);
    return cs.opacity === '1' && (cs.transform === 'none' || cs.transform === 'matrix(1, 0, 0, 1, 0, 0)');
  }
  /** the original markup, with each hyphenated word kept whole (span.nowrap), as the split lines keep it: a split word
      never breaks at its hyphen, so without this "high-stakes" would jump to "high-" / "stakes" as the text settles
      @param {string} html @returns {string} */
  function flowHtml(html) {
    var t = document.createElement('template');
    t.innerHTML = html;
    var walker = document.createTreeWalker(t.content, NodeFilter.SHOW_TEXT);
    /** @type {Text[]} */
    var texts = [];
    while (walker.nextNode()) texts.push(/** @type {Text} */ (walker.currentNode));
    texts.forEach(function (node) {
      var parts = (node.nodeValue || '').split(/(\S+[-\u2010]\S+)/);
      if (parts.length < 2) return;
      var frag = document.createDocumentFragment();
      parts.forEach(function (part, i) {
        if (!part) return;
        if (i % 2) { var k = document.createElement('span'); k.className = 'nowrap'; k.textContent = part; frag.appendChild(k); }
        else frag.appendChild(document.createTextNode(part));
      });
      if (node.parentNode) node.parentNode.replaceChild(frag, node);
    });
    return t.innerHTML;
  }
  /** the words of the element's text, grouped into the lines the browser set (by each word's vertical center)
      @param {HTMLElement} el @returns {string[]} */
  function flowLines(el) {
    var half = (parseFloat(getComputedStyle(el).lineHeight) || 16) / 2;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var range = document.createRange();
    /** @type {string[][]} */
    var lines = [];
    var lastMid = -1e9;
    while (walker.nextNode()) {
      var node = /** @type {Text} */ (walker.currentNode);
      var text = node.nodeValue || '';
      var re = /\S+/g, m;
      while ((m = re.exec(text))) {
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        var r = range.getClientRects()[0];
        if (!r) continue;
        var mid = r.top + r.height / 2;
        if (Math.abs(mid - lastMid) >= half || !lines.length) { lines.push([]); lastMid = mid; }
        lines[lines.length - 1].push(m[0]);
      }
    }
    return lines.map(function (l) { return l.join(''); }); // compared without spaces: a word may span an inline tag
  }
  /** put the original markup back, with the split's own line breaks
      @param {Item} it */
  function flatten(it) {
    clearTimeout(it.timer);
    if (it.flat || !it.vis || !landed(it)) return;
    var want = it.mode === 'chars' ? null : rows(it).map(function (row) { return (row.textContent || '').replace(/\s+/g, ''); }).join('|');
    // 1. the original markup. 2. if a break moved (a paragraph breaking at a hyphen the split kept whole), the same
    //    markup with each hyphenated word kept whole. Chrome's text-wrap: balance stops balancing around such a span,
    //    so the balanced headings need 1. If neither keeps the split's lines, the original markup stays.
    it.el.innerHTML = it.html;
    if (want !== null && flowLines(it.el).join('|') !== want) {
      var kept = flowHtml(it.html);
      if (kept !== it.html) {
        it.el.innerHTML = kept;
        if (flowLines(it.el).join('|') !== want) it.el.innerHTML = it.html;
      }
    }
    it.vis = null;
    it.flat = true;
  }
  /** after a reveal starts: settle when the last row lands; the timer covers a missed transitionend @param {Item} it */
  function settleLater(it) {
    clearTimeout(it.timer);
    var r = rows(it);
    if (!r.length) return;
    var cs = getComputedStyle(r[r.length - 1]);
    var sec = function (/** @type {string} */ v) { return Math.max.apply(null, v.split(',').map(function (x) { return (parseFloat(x) || 0) * (/ms/.test(x) ? 1 : 1000); })); };
    it.timer = window.setTimeout(function () { flatten(it); }, sec(cs.transitionDelay) + sec(cs.transitionDuration) + 150);
  }
  /** split again from the flowing text, keeping the current state; true if it rebuilt @param {Item} it */
  function resplit(it) {
    if (!it.flat) return false;
    clearTimeout(it.timer);
    it.flat = false;
    it.width = it.el.clientWidth;
    it.size = getComputedStyle(it.el).fontSize;
    build(it);
    return true;
  }
  /** a line wider than its box: it was measured under other spacing, fonts or width @param {Item} it */
  function stale(it) {
    if (it.mode === 'chars' || !it.vis) return false;
    var box = it.el.getBoundingClientRect();
    return rows(it).some(function (row) {
      var w = row.lastElementChild, f = row.firstElementChild;
      if (!w || !f) return false;
      return w.getBoundingClientRect().right > box.right + 2 || f.getBoundingClientRect().left < box.left - 2;
    });
  }
  /** @param {Element} el */
  reveal = function (el) {
    var it = find(el);
    if (!it) { el.classList.add('is-in'); return; }
    if (it.flat || el.classList.contains('is-in')) return;
    if (stale(it)) {
      it.width = it.el.clientWidth;
      it.size = getComputedStyle(it.el).fontSize;
      build(it);
      void it.el.offsetWidth; // commit the hidden rows, so they rise rather than appear
    }
    el.classList.add('is-in');
    settleLater(it);
  };
  /** @param {Element} el */
  hide = function (el) {
    var it = find(el);
    if (it && resplit(it)) void it.el.offsetWidth; // commit the shown rows, so they can leave
    if (it) clearTimeout(it.timer);
    el.classList.remove('is-in');
  };
  /** for a choreography owner: split now, before it changes a class that moves the rows (commits the state itself)
      @param {Element} el */
  function split(el) {
    var it = find(el);
    if (!it || !resplit(it)) return false;
    void it.el.offsetWidth;
    return true;
  }

  /** the reading line: a split element reveals once its top passes 92% of the viewport */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!(e.isIntersecting || e.boundingClientRect.top < 0)) return;
      var el = /** @type {HTMLElement} */ (e.target);
      if (el.closest('[data-reveal-owner]')) return;
      reveal(el);
      io.unobserve(el);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });

  function splitAll() {
    var wasPending = doc.classList.contains('tr-pending');
    var vh = window.innerHeight;
    items.forEach(function (it) {
      if (it.flat) return; // settled: plain text reflows on its own
      // Round 7: the type is fluid, so a block that has reached its max-width keeps its width while its font keeps
      // growing with the viewport. Re-split when either changes; a width-only check left stale lines that ran past
      // their masks (the closing paragraph Shai saw cut off on the right).
      var w = it.el.clientWidth;
      var size = getComputedStyle(it.el).fontSize;
      if (it.vis && w === it.width && size === it.size) return;
      it.width = w;
      it.size = size;
      var first = !it.vis;
      build(it);
      // revealed before it was ever split (an owner can reveal early: WebKit runs approach-plant.js first): settle it too
      if (it.el.classList.contains('is-in')) settleLater(it);
      if (first) {
        // If the safety timer already showed this text and it sits in view, do not hide it again.
        var r = it.el.getBoundingClientRect();
        if (!wasPending && r.top < vh && r.bottom > 0 && !it.el.closest('[data-reveal-owner]')) {
          it.el.classList.add('tr-instant');
          reveal(it.el);
        } else {
          io.observe(it.el);
        }
      }
    });
    release();
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-split]'), function (/** @type {HTMLElement} */ el) {
      items.push({ el: el, mode: el.getAttribute('data-split') === 'chars' ? 'chars' : 'lines', html: el.innerHTML, width: -1, size: '', vis: null, flat: false, timer: 0 });
    });
    // settle each element the moment its last row lands
    items.forEach(function (it) {
      it.el.addEventListener('transitionend', function (e) {
        if (e.propertyName !== 'transform' || it.flat || !it.vis) return;
        var r = rows(it);
        if (e.target === r[r.length - 1]) flatten(it);
      });
    });
    var fonts = document.fonts;
    /** @type {Promise<unknown>} */
    var loaded = fonts
      ? Promise.all([
          fonts.load('400 1em "Libertinus Serif"'),
          fonts.load('italic 400 1em "Libertinus Serif"'),
          fonts.load('400 1em "DM Sans"'),
          fonts.load('600 1em "DM Sans"')
        ]).then(function () { return fonts.ready; })
      : Promise.resolve();
    var timeout = new Promise(function (res) { setTimeout(res, 1600); });
    Promise.race([loaded, timeout]).then(splitAll, splitAll);
    if (fonts && 'onloadingdone' in fonts) fonts.addEventListener('loadingdone', function () { items.forEach(function (it) { it.width = -1; }); splitAll(); });

    // Re-split whenever a split element's own width changes: a window resize, or a layout class added later
    // (How We Work Together switches to its pinned layout after this runs). Every window resize also re-checks,
    // because a fluid font size can change while the width does not (splitAll skips anything unchanged).
    var t = 0;
    function soon() { clearTimeout(t); t = window.setTimeout(splitAll, 120); }
    window.addEventListener('resize', soon, { passive: true });
    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var el = entries[i].target;
          for (var k = 0; k < items.length; k++) {
            if (items[k].el === el && items[k].vis && el.clientWidth !== items[k].width) { soon(); return; }
          }
        }
      });
      items.forEach(function (it) { ro.observe(it.el); });
    }
  }

  /** @param {Element} scope */
  function reset(scope) {
    items.forEach(function (it) {
      if (!scope.contains(it.el) || it.el.closest('[data-reveal-owner]')) return;
      resplit(it); // a settled element goes back to its lines (the scope is in its no-transition reset state)
      if (!it.vis) return;
      clearTimeout(it.timer);
      it.el.classList.remove('is-in', 'tr-instant');
      io.observe(it.el);
    });
  }

  api = { reveal: function (el) { reveal(el); }, hide: function (el) { hide(el); }, split: split, reset: reset, refresh: function () { items.forEach(function (it) { it.width = -1; }); splitAll(); }, ready: ready };
  Object.assign(window, { NCCText: api });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
