/* =========================================================================
   CHALET — scroll engine
   Zero dependencies. Every animation is driven by scroll position.

   IMPORTANT: nothing auto-plays. The hero "video" is an image sequence
   decoded from the source clip; a frame is only ever painted in response to
   a scroll position. There is no timer, no <video autoplay>, no playback
   loop. Stop scrolling and the build freezes exactly where you left it.
   ========================================================================= */
(function () {
  'use strict';

  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var vh = window.innerHeight;
  var vw = window.innerWidth;

  /* ---------------------------------------------------------------------
     1 · SCROLL DRIVER — one rAF loop, one layout read per frame
     --------------------------------------------------------------------- */
  var tasks = [];
  var onScroll = function (fn) { tasks.push(fn); };
  var lastY = window.pageYOffset;
  var velocity = 0;
  var running = false;

  function tick() {
    var y = window.pageYOffset;
    var dy = y - lastY;
    lastY = y;
    velocity = lerp(velocity, dy, 0.28);
    for (var i = 0; i < tasks.length; i++) tasks[i](y, dy, velocity);
    requestAnimationFrame(tick);
  }
  function start() { if (!running) { running = true; requestAnimationFrame(tick); } }

  window.addEventListener('resize', function () {
    vh = window.innerHeight; vw = window.innerWidth;
    if (scrubber) scrubber.resize();
    if (hgal) hgal.measure();
  }, { passive: true });

  /* progress of an element's "track" through the viewport (0 → 1) */
  function trackProgress(el) {
    var r = el.getBoundingClientRect();
    var total = r.height - vh;
    if (total <= 0) return clamp(-r.top / Math.max(r.height, 1), 0, 1);
    return clamp(-r.top / total, 0, 1);
  }

  /* ---------------------------------------------------------------------
     2 · HERO FRAME SCRUBBER
     --------------------------------------------------------------------- */
  var FRAME_COUNT = 80;
  var framePath = function (i) {
    return 'assets/frames/f' + String(i + 1).padStart(3, '0') + '.webp';
  };

  function Scrubber(canvas) {
    var ctx = canvas.getContext('2d', { alpha: false });
    var frames = new Array(FRAME_COUNT);
    var ready = new Array(FRAME_COUNT).fill(false);
    var loadedCount = 0;
    var current = -1;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var self = this;

    this.onProgress = null;

    /* Priority order: a coarse pass first so the scrub is usable early,
       then progressively fill in the in-between frames. */
    function order() {
      var seen = {}, out = [];
      [8, 4, 2, 1].forEach(function (step) {
        for (var i = 0; i < FRAME_COUNT; i += step) {
          if (!seen[i]) { seen[i] = 1; out.push(i); }
        }
      });
      return out;
    }

    var queue = order();
    var qi = 0;
    var CONCURRENCY = 6;

    function pump() {
      while (qi < queue.length && inflight < CONCURRENCY) load(queue[qi++]);
    }
    var inflight = 0;
    function load(i) {
      if (frames[i]) return;
      inflight++;
      var img = new Image();
      img.decoding = 'async';
      frames[i] = img;
      img.onload = img.onerror = function () {
        inflight--;
        if (img.naturalWidth) { ready[i] = true; loadedCount++; }
        if (self.onProgress) self.onProgress(loadedCount / FRAME_COUNT, loadedCount);
        if (current === -1) self.draw(0);
        pump();
      };
      img.src = framePath(i);
    }
    pump();

    /* nearest already-decoded frame, so scrubbing never shows a blank */
    function nearest(i) {
      if (ready[i]) return i;
      for (var d = 1; d < FRAME_COUNT; d++) {
        if (i - d >= 0 && ready[i - d]) return i - d;
        if (i + d < FRAME_COUNT && ready[i + d]) return i + d;
      }
      return -1;
    }

    this.resize = function () {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.offsetWidth * dpr);
      canvas.height = Math.round(canvas.offsetHeight * dpr);
      var c = current; current = -1;
      this.draw(c < 0 ? 0 : c);
    };

    /* object-fit: cover, drawn by hand */
    this.draw = function (i) {
      var n = nearest(i);
      if (n < 0 || n === current) return;
      var img = frames[n];
      if (!img || !img.naturalWidth) return;
      current = n;
      var cw = canvas.width, ch = canvas.height;
      var s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      var w = img.naturalWidth * s, h = img.naturalHeight * s;
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
    };

    this.seek = function (p) {
      this.draw(Math.round(clamp(p, 0, 1) * (FRAME_COUNT - 1)));
    };
    this.loaded = function () { return loadedCount; };
    this.resize();
  }

  var scrubber = null;
  var canvas = document.getElementById('heroCanvas');
  var heroTrack = document.querySelector('.hero__track');

  if (canvas && canvas.getContext) {
    scrubber = new Scrubber(canvas);
  } else {
    document.documentElement.classList.add('no-canvas');
  }

  /* --- hero choreography ------------------------------------------------ */
  var STAGES = [
    [0.00, '01', 'BLUEPRINT'],
    [0.22, '02', 'STRUCTURE'],
    [0.45, '03', 'STONE & LARCH'],
    [0.68, '04', 'GLASS & WARMTH'],
    [0.88, '05', 'HOME']
  ];
  var elStageNum = document.getElementById('stageNum');
  var elStageName = document.getElementById('stageName');
  var elHeroRail = document.getElementById('heroRail');
  var elCue = document.getElementById('heroCue');
  var w1 = document.querySelector('[data-hero="w1"]');
  var w2 = document.querySelector('[data-hero="w2"]');
  var scr = document.querySelector('[data-hero="script"]');
  var eyeb = document.querySelector('[data-hero="eyebrow"]');
  var panel = document.querySelector('[data-hero="panel"]');
  var lastStage = -1;

  if (heroTrack) {
    onScroll(function () {
      var r = heroTrack.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh) return;   // off-screen: skip work
      var p = trackProgress(heroTrack);

      /* Reduced motion: the villa is shown finished, never scrubbed. */
      if (scrubber && !REDUCED) scrubber.seek(p);

      /* stage read-out */
      var s = REDUCED ? STAGES.length - 1 : 0;
      if (!REDUCED) for (var i = 0; i < STAGES.length; i++) if (p >= STAGES[i][0]) s = i;
      if (s !== lastStage) {
        lastStage = s;
        if (elStageNum) elStageNum.textContent = STAGES[s][1];
        if (elStageName) elStageName.textContent = STAGES[s][2];
      }
      if (elHeroRail && !REDUCED) elHeroRail.style.width = (p * 100).toFixed(2) + '%';
      if (elCue) elCue.classList.toggle('is-gone', p > 0.04);

      if (REDUCED) return;

      /* type drifts apart and clears the frame as the villa resolves */
      var t = clamp(p / 0.72, 0, 1);
      var ease = t * t;
      if (w1) w1.style.transform = 'translate3d(' + (-ease * 16) + 'vw,' + (-ease * 26) + 'vh,0)';
      if (w2) w2.style.transform = 'translate3d(' + (ease * 18) + 'vw,' + (-ease * 22) + 'vh,0)';
      if (scr) {
        scr.style.transform = 'translate3d(0,' + (-ease * 24) + 'vh,0)';
        scr.style.opacity = String(clamp(1 - t * 1.4, 0, 1));
      }
      if (eyeb) eyeb.style.opacity = String(clamp(1 - p / 0.18, 0, 1));

      var pp = clamp((p - 0.06) / 0.42, 0, 1);
      if (panel) {
        panel.style.transform = 'translate3d(0,' + (pp * 34) + 'px,0)';
        panel.style.opacity = String(1 - pp);
        panel.style.pointerEvents = pp > 0.6 ? 'none' : 'auto';
      }
    });
  }

  /* ---------------------------------------------------------------------
     3 · PRELOADER — hold until the scrub is genuinely usable
     --------------------------------------------------------------------- */
  var loader = document.getElementById('loader');
  var lBar = document.getElementById('loaderBar');
  var lPct = document.getElementById('loaderPct');
  var dismissed = false;

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    if (lBar) lBar.style.width = '100%';
    if (lPct) lPct.textContent = '100';
    setTimeout(function () {
      if (loader) loader.classList.add('is-done');
      document.body.classList.remove('is-locked');
      document.documentElement.classList.add('is-ready');
    }, 260);
  }

  document.body.classList.add('is-locked');
  if (scrubber) {
    scrubber.onProgress = function (frac, n) {
      var shown = Math.min(99, Math.round(frac * 100));
      if (lBar) lBar.style.width = shown + '%';
      if (lPct) lPct.textContent = String(shown);
      if (n >= 24) dismiss();            // coarse pass in hand → let them scroll
    };
  }
  window.addEventListener('load', function () { setTimeout(dismiss, 400); });
  setTimeout(dismiss, 7000);             // never trap anyone behind a slow network

  /* ---------------------------------------------------------------------
     4 · SPLIT TEXT — walks text nodes, keeps inline markup intact
     --------------------------------------------------------------------- */
  function splitWords(root, stagger) {
    var n = 0;
    (function walk(node) {
      var kids = Array.prototype.slice.call(node.childNodes);
      kids.forEach(function (child) {
        if (child.nodeType === 3) {
          var parts = child.nodeValue.split(/(\s+)/);
          if (!child.nodeValue.trim()) return;
          var frag = document.createDocumentFragment();
          parts.forEach(function (part) {
            if (!part) return;
            if (!part.trim()) { frag.appendChild(document.createTextNode(part)); return; }
            var outer = document.createElement('span');
            outer.className = 'sp-word';
            var inner = document.createElement('i');
            inner.textContent = part;
            inner.style.setProperty('--d', (n++ * stagger) + 'ms');
            outer.appendChild(inner);
            frag.appendChild(outer);
          });
          node.replaceChild(frag, child);
        } else if (child.nodeType === 1 && child.tagName !== 'BR') {
          walk(child);
        }
      });
    })(root);
  }

  if (!REDUCED) {
    document.querySelectorAll('[data-split]').forEach(function (el) {
      splitWords(el, el.getAttribute('data-split') === 'line' ? 26 : 34);
    });
  }

  /* ---------------------------------------------------------------------
     5 · REVEALS + COUNTERS
     --------------------------------------------------------------------- */
  document.querySelectorAll('[data-delay]').forEach(function (el) {
    el.style.setProperty('--d', el.getAttribute('data-delay') + 'ms');
  });

  function countUp(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    var suffix = el.getAttribute('data-suffix') || '';
    var dur = 1500, t0 = performance.now();
    (function step(now) {
      var t = clamp((now - t0) / dur, 0, 1);
      var e = 1 - Math.pow(1 - t, 3);
      var v = Math.round(target * e);
      el.textContent = (v >= 1000 ? v.toLocaleString('en-US').replace(/,/g, ' ') : v) + suffix;
      if (t < 1) requestAnimationFrame(step);
    })(t0);
  }

  function markIn(el) {
    el.classList.add('is-in');
    el.querySelectorAll('[data-count]').forEach(countUp);
    if (el.hasAttribute('data-count')) countUp(el);
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var t = e.target;
      /* a clip-group stands in for children that clip themselves to nothing */
      if (t.hasAttribute('data-clip-group')) {
        t.querySelectorAll('[data-reveal="clip"]').forEach(markIn);
      }
      if (t.hasAttribute('data-reveal') || t.hasAttribute('data-split')) markIn(t);
      io.unobserve(t);
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });

  /* An element with `clip-path: inset(0 0 100% 0)` reports an empty
     intersection rectangle, so IntersectionObserver would never fire for it.
     Watch its parent instead and let the parent release the whole row. */
  var clipGroups = [];
  document.querySelectorAll('[data-reveal],[data-split]').forEach(function (el) {
    if (el.getAttribute('data-reveal') === 'clip' && el.parentElement) {
      var g = el.parentElement;
      if (!g.hasAttribute('data-clip-group')) {
        g.setAttribute('data-clip-group', '');
        clipGroups.push(g);
      }
      return;
    }
    io.observe(el);
  });
  clipGroups.forEach(function (g) { io.observe(g); });

  /* ---------------------------------------------------------------------
     6 · PARALLAX
     --------------------------------------------------------------------- */
  var parallax = Array.prototype.slice.call(document.querySelectorAll('[data-parallax]'));
  if (parallax.length && !REDUCED) {
    onScroll(function () {
      for (var i = 0; i < parallax.length; i++) {
        var el = parallax[i];
        var r = el.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) continue;
        var amt = parseFloat(el.getAttribute('data-parallax')) || 0.1;
        var off = (r.top + r.height / 2 - vh / 2) * -amt;
        el.style.transform = 'translate3d(0,' + off.toFixed(2) + 'px,0)';
      }
    });
  }

  /* ---------------------------------------------------------------------
     7 · TICKER — moves only with the scroll, and reverses with it
     --------------------------------------------------------------------- */
  var tickerRow = document.querySelector('[data-ticker]');
  if (tickerRow && !REDUCED) {
    var tx = 0, half = 0;
    var measure = function () { half = tickerRow.scrollWidth / 2; };
    measure();
    window.addEventListener('resize', measure, { passive: true });
    onScroll(function (y, dy, v) {
      if (!half) measure();
      tx -= v * 0.9;
      if (tx <= -half) tx += half;
      if (tx > 0) tx -= half;
      tickerRow.style.transform = 'translate3d(' + tx.toFixed(2) + 'px,0,0)';
    });
  }

  /* ---------------------------------------------------------------------
     8 · STICKY STACK — each card is pressed down by the one behind it
     --------------------------------------------------------------------- */
  var cards = Array.prototype.slice.call(document.querySelectorAll('.stack__card'));
  cards.forEach(function (c, i) { c.style.setProperty('--i', String(i)); });
  if (cards.length && !REDUCED) {
    onScroll(function () {
      for (var i = 0; i < cards.length - 1; i++) {
        var card = cards[i], next = cards[i + 1];
        var cr = card.getBoundingClientRect();
        if (cr.bottom < -100 || cr.top > vh + 100) continue;
        var nr = next.getBoundingClientRect();
        var overlap = clamp(1 - (nr.top - cr.top) / Math.max(cr.height, 1), 0, 1);
        var e = overlap * overlap;
        card.style.transform = 'translate3d(0,' + (-e * 20) + 'px,0) scale(' + (1 - e * 0.07) + ')';
        card.style.filter = 'brightness(' + (1 - e * 0.42) + ')';
      }
    });
  }

  /* ---------------------------------------------------------------------
     9 · HORIZONTAL GALLERY
     --------------------------------------------------------------------- */
  var hgal = null;
  var hTrack = document.querySelector('.hgal__track');
  var hRow = document.getElementById('hgalRow');
  var hRail = document.getElementById('hgalRail');

  if (hTrack && hRow) {
    hgal = {
      max: 0,
      measure: function () {
        this.max = Math.max(0, hRow.scrollWidth - vw + Math.max(22, vw * 0.045));
        if (hRail) {
          var w = clamp((vw / Math.max(hRow.scrollWidth, 1)) * 100, 10, 90);
          hRail.style.width = w + '%';
          hRail.dataset.w = String(w);
        }
      }
    };
    hgal.measure();
    window.addEventListener('load', function () { hgal.measure(); });

    onScroll(function () {
      var r = hTrack.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) return;
      var p = trackProgress(hTrack);
      if (!hgal.max) hgal.measure();
      hRow.style.transform = 'translate3d(' + (-p * hgal.max).toFixed(2) + 'px,0,0)';
      if (hRail) {
        var w = parseFloat(hRail.dataset.w || '20');
        hRail.style.transform = 'translate3d(' + (p * (100 - w) / w * 100).toFixed(2) + '%,0,0)';
      }
    });
  }

  /* ---------------------------------------------------------------------
     10 · RIDGE LINE — drawn as the section scrolls through
     --------------------------------------------------------------------- */
  var ridge = document.getElementById('ridge');
  if (ridge) {
    var ridgeLine = ridge.querySelector('.ridge__line');
    var LEN = 2600;
    onScroll(function () {
      var r = ridge.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) return;
      var p = clamp((vh - r.top) / (vh * 0.85 + r.height * 0.4), 0, 1);
      if (ridgeLine) ridgeLine.style.strokeDashoffset = String(LEN * (1 - p));
    });
  }

  /* ---------------------------------------------------------------------
     11 · TOP PROGRESS RAIL
     --------------------------------------------------------------------- */
  var rail = document.getElementById('scrollRail');
  if (rail) {
    onScroll(function (y) {
      var max = document.documentElement.scrollHeight - vh;
      rail.style.width = (clamp(y / Math.max(max, 1), 0, 1) * 100).toFixed(2) + '%';
    });
  }

  /* ---------------------------------------------------------------------
     12 · NAV
     --------------------------------------------------------------------- */
  var nav = document.getElementById('nav');
  var burger = document.getElementById('burger');
  var drawer = document.getElementById('drawer');
  if (nav) {
    var prev = 0;
    onScroll(function (y) {
      nav.classList.toggle('is-stuck', y > 40);
      var open = drawer && drawer.classList.contains('is-open');
      nav.classList.toggle('is-hidden', !open && y > prev && y > vh * 0.9);
      prev = y;
    });
  }
  if (burger && drawer) {
    burger.addEventListener('click', function () {
      var open = drawer.classList.toggle('is-open');
      burger.setAttribute('aria-expanded', String(open));
      drawer.setAttribute('aria-hidden', String(!open));
    });
    drawer.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        drawer.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------------------------------------------------------------------
     13 · FORM (demo only — nothing leaves the browser)
     --------------------------------------------------------------------- */
  var form = document.getElementById('ctaForm');
  var note = document.getElementById('formNote');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.querySelector('#f-name');
      var mail = form.querySelector('#f-mail');
      if (!name.value.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail.value)) {
        note.textContent = 'A name and a valid email, and we will write back.';
        note.classList.remove('is-ok');
        (!name.value.trim() ? name : mail).focus();
        return;
      }
      note.textContent = 'Thank you, ' + name.value.trim().split(' ')[0] + ' — demo form, nothing was sent.';
      note.classList.add('is-ok');
      form.reset();
    });
  }

  /* ---------------------------------------------------------------------
     14 · REDUCED MOTION — resolve the villa, skip the scrub
     --------------------------------------------------------------------- */
  if (REDUCED) {
    var last = STAGES[STAGES.length - 1];
    if (elStageNum) elStageNum.textContent = last[1];
    if (elStageName) elStageName.textContent = last[2];
    if (elHeroRail) elHeroRail.style.width = '100%';
    if (elCue) elCue.classList.add('is-gone');
    lastStage = STAGES.length - 1;
  }
  if (REDUCED && scrubber) {
    var settle = setInterval(function () {
      scrubber.draw(FRAME_COUNT - 1);
      if (scrubber.loaded() >= FRAME_COUNT) clearInterval(settle);
    }, 500);
    setTimeout(function () { clearInterval(settle); }, 15000);
  }

  start();
})();
