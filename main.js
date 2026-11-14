/* =========================================================
   Max Yuan · portfolio behaviour
   Shared by index.html and every project page.
   ========================================================= */

(() => {
  'use strict';

  const BASE = document.documentElement.dataset.root || '';   // "../" on project pages
  const isHome = !document.documentElement.dataset.root;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const EMAIL = 'maxyuan081205@gmail.com';

  /* ---------- toast, copy email ---------- */

  const toastEl = $('#toast');
  let toastTimer = 0;
  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  $$('[data-copy]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(EMAIL);
      toast('Email copied');
    } catch (e) {
      window.location.href = `mailto:${EMAIL}`;
    }
  }));

  /* ---------- nav border once the page scrolls ---------- */

  const nav = $('#nav');
  const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- project clips: loop like a GIF while on screen ---------- */

  const loops = $$('video[data-loop]');
  if (loops.length && !reduceMotion.matches && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(({ target: v, isIntersecting }) => {
        if (isIntersecting) {
          if (v.preload === 'none') v.preload = 'auto';
          const p = v.play();
          if (p && p.catch) p.catch(() => {});
        } else {
          v.pause();
        }
      });
    }, { rootMargin: '120px 0px' });
    loops.forEach(v => io.observe(v));
  }

  /* ---------- touch screens: the card in the middle of the screen comes into colour ---------- */

  if (window.matchMedia('(hover: none)').matches && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => e.target.classList.toggle('is-live', e.isIntersecting));
    }, { rootMargin: '-44% 0px -44% 0px' });
    $$('.proj').forEach(p => io.observe(p));
  }

  /* ---------- hero: a field of imagined rollouts ----------
     From the photo (the present, o_t) the "model" keeps sampling a fan
     of noisy trajectories towards a goal: your pointer, or a slowly
     wandering point when the pointer is elsewhere. One rollout is
     chosen and drawn bright; the rest stay faint and dashed. Every
     plan grows, holds, fades and is resampled. */

  const field = $('.hero-field');
  if (field) {
    const hero = field.parentElement;
    const photo = $('.hero-photo .shot', hero);
    const ctx = field.getContext('2d');
    const rand = (a, b) => a + Math.random() * (b - a);
    let W = 0;
    let H = 0;
    let pointer = null;
    let plan = null;
    let visible = true;
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = hero.clientWidth;
      H = hero.clientHeight;
      field.width = Math.round(W * dpr);
      field.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const origin = () => {
      const h = hero.getBoundingClientRect();
      const r = photo ? photo.getBoundingClientRect() : null;
      if (!r || !r.width) return { x: W * 0.8, y: H * 0.5 };
      return W < 700 ? { x: r.left - h.left + r.width / 2, y: r.bottom - h.top + 6 }
        : { x: r.left - h.left - 6, y: r.top - h.top + r.height * 0.5 };
    };
    const wander = t => (W < 700
      ? { x: W * (0.5 + 0.32 * Math.sin(t / 2300)), y: H * (0.78 + 0.1 * Math.sin(t / 1700)) }
      : { x: W * (0.32 + 0.2 * Math.sin(t / 2600)), y: H * (0.5 + 0.3 * Math.sin(t / 1900 + 1)) });

    const sample = (from, to, now) => {
      const K = 14;
      const pick = Math.floor(rand(0, K));
      const steps = 56;
      const paths = Array.from({ length: K }, (_, k) => {
        const chosen = k === pick;
        const spread = chosen ? 0.15 : rand(-1, 1);
        let x = from.x;
        let y = from.y;
        let vx = (to.x - from.x) / 45 + spread * rand(2, 9);
        let vy = (to.y - from.y) / 45 + spread * rand(-9, 9);
        const pts = [[x, y]];
        for (let s = 1; s < steps; s += 1) {
          const t = s / steps;
          const pull = chosen ? 1 : 0.32;
          vx += (to.x - x) * 0.011 * pull + rand(-1.2, 1.2) * (1 - t * pull);
          vy += (to.y - y) * 0.011 * pull + rand(-1.2, 1.2) * (1 - t * pull);
          vx *= 0.9;
          vy *= 0.9;
          x += vx;
          y += vy;
          pts.push([x, y]);
        }
        return { pts, chosen };
      });
      return { paths, to, t0: now };
    };

    const GROW = 900;
    const HOLD = 1100;
    const FADE = 600;
    const draw = now => {
      ctx.clearRect(0, 0, W, H);
      if (!plan) return;
      const age = now - plan.t0;
      const grow = Math.min(1, age / GROW);
      const e = 1 - (1 - grow) ** 2;
      const alpha = age < GROW + HOLD ? 1 : Math.max(0, 1 - (age - GROW - HOLD) / FADE);
      plan.paths.forEach(({ pts, chosen }) => {
        const n = Math.max(2, Math.floor(pts.length * e));
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let j = 1; j < n; j += 1) ctx.lineTo(pts[j][0], pts[j][1]);
        ctx.setLineDash(chosen ? [] : [3, 5]);
        ctx.lineWidth = chosen ? 1.5 : 1;
        ctx.strokeStyle = `rgba(159,208,245,${(chosen ? 0.7 : 0.2) * alpha})`;
        if (chosen) { ctx.shadowColor = 'rgba(159,208,245,.8)'; ctx.shadowBlur = 8; }
        ctx.stroke();
        ctx.shadowBlur = 0;
        const [ex, ey] = pts[n - 1];
        ctx.fillStyle = `rgba(${chosen ? '214,237,253' : '159,208,245'},${(chosen ? 0.95 : 0.35) * alpha})`;
        ctx.fillRect(ex - 1.5, ey - 1.5, 3, 3);
      });
      ctx.setLineDash([]);
      // the goal: a small crosshair
      const g = plan.to;
      ctx.strokeStyle = `rgba(159,208,245,${0.55 * alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(g.x, g.y, 7, 0, Math.PI * 2);
      ctx.moveTo(g.x - 12, g.y); ctx.lineTo(g.x - 4, g.y);
      ctx.moveTo(g.x + 4, g.y); ctx.lineTo(g.x + 12, g.y);
      ctx.moveTo(g.x, g.y - 12); ctx.lineTo(g.x, g.y - 4);
      ctx.moveTo(g.x, g.y + 4); ctx.lineTo(g.x, g.y + 12);
      ctx.stroke();
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = `rgba(119,144,165,${alpha})`;
      ctx.fillText('goal', g.x + 12, g.y - 10);
    };

    const tick = now => {
      raf = 0;
      if (!visible || document.hidden) return;
      const age = plan ? now - plan.t0 : Infinity;
      if (age > GROW + HOLD + FADE + 150) plan = sample(origin(), pointer || wander(now), now);
      draw(now);
      raf = requestAnimationFrame(tick);
    };
    const start = () => { if (!raf && !reduceMotion.matches) raf = requestAnimationFrame(tick); };

    resize();
    if ('ResizeObserver' in window) new ResizeObserver(() => { resize(); plan = null; }).observe(hero);
    else window.addEventListener('resize', resize);

    let lastReplan = 0;
    hero.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      const h = hero.getBoundingClientRect();
      const p = { x: e.clientX - h.left, y: e.clientY - h.top };
      const now = performance.now();
      // replan when the goal has moved far enough, at most every 450 ms
      if (plan && now - lastReplan > 450 && Math.hypot(p.x - plan.to.x, p.y - plan.to.y) > 90) {
        lastReplan = now;
        plan = sample(origin(), p, now);
      }
      pointer = p;
    });
    hero.addEventListener('pointerleave', () => { pointer = null; });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }).observe(hero);
    }
    document.addEventListener('visibilitychange', start);
    if (reduceMotion.matches) {
      // one still plan, no motion
      const now = performance.now();
      plan = sample(origin(), wander(now), now - GROW);
      draw(now);
    } else {
      start();
    }
  }

  /* ---------- skills: show which projects used each one ---------- */

  const homeHref = isHome ? '' : BASE + 'index.html';
  const PROJECTS = {
    brackey: ['The Brackey Way', BASE + 'projects/brackey-way.html'],
    quad: ['Go2 locomotion (PPO)', BASE + 'projects/quadruped-ppo.html'],
    maze: ['Maze navigation', BASE + 'projects/maze-nav2.html'],
    rico: ['RICO', BASE + 'projects/rico-arm.html'],
    ftc: ['FTC 18844', BASE + 'projects/ftc-18844.html'],
    turret: ['StudyBuddy 9520', homeHref + '#studybuddy'],
    pi05: ['π₀.5 pick and place', BASE + 'projects/pi05-pick-place.html'],
  };

  $$('.skill[data-used]').forEach(chip => {
    const group = chip.closest('.skill-group');
    const out = group && $('.skill-used', group);
    if (!out) return;
    const show = () => {
      $$('.skill.is-on').forEach(c => c.classList.remove('is-on'));
      $$('.skill-used').forEach(o => { if (o !== out) o.textContent = ''; });
      chip.classList.add('is-on');
      out.textContent = '';
      const name = document.createElement('b');
      name.textContent = chip.firstChild.textContent.trim();
      out.append(name, document.createTextNode(group.dataset.prefix === 'next' ? ': next up in ' : ': used in '));
      chip.dataset.used.split(',').forEach((key, i) => {
        const p = PROJECTS[key.trim()];
        if (!p) return;
        if (i) out.append(document.createTextNode(', '));
        const a = document.createElement('a');
        a.href = p[1];
        a.textContent = p[0];
        out.append(a);
      });
    };
    chip.addEventListener('mouseenter', show);
    chip.addEventListener('focus', show);
    chip.addEventListener('click', show);
  });

  /* ---------- visitor map (MapMyVisitors), loaded when scrolled near ---------- */

  const visitors = $('#visitors');
  const mmvCode = visitors?.dataset.mmv.trim();
  if (visitors && mmvCode) {
    visitors.hidden = false;
    const loadMap = () => {
      const s = document.createElement('script');
      s.id = 'mapmyvisitors';   // the widget finds itself by this id and draws right after it
      // co = ocean, cl = land, ct = text; w=a fills the column
      s.src = 'https://mapmyvisitors.com/map.js?d=' + encodeURIComponent(mmvCode) +
        '&co=0a0f15&cl=2c4659&ct=d6edfd&w=a';
      $('.visitor-map', visitors).append(s);
    };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) { io.disconnect(); loadMap(); }
      }, { rootMargin: '400px 0px' });
      io.observe(visitors);
    } else {
      loadMap();
    }
  }

  $$('[data-year]').forEach(el => { el.textContent = String(new Date().getFullYear()); });

  // Old links from the previous site layout land in the right place.
  const OLD = { '#home': '#about', '#hello': '#about', '#work': '#projects', '#toolkit': '#skills' };
  if (isHome && OLD[location.hash]) {
    history.replaceState(null, '', OLD[location.hash]);
    $(OLD[location.hash])?.scrollIntoView();
  }
})();
