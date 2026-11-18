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

  /* ---------- light / dark theme ----------
     The page's head already set data-theme (the saved choice, else
     dark) before anything was drawn. This adds the toggle
     to the header; switching opens the new theme in a circle that
     grows from the button. */

  const root = document.documentElement;
  const metaTheme = $('meta[name="theme-color"]');
  const ICONS = '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z"/></svg>'
    + '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>';

  function applyTheme(t) {
    root.dataset.theme = t;
    if (metaTheme) metaTheme.content = t === 'dark' ? '#0a0a0a' : '#ffffff';
    $$('.theme-btn').forEach(b => {
      b.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      b.setAttribute('aria-pressed', String(t === 'dark'));
    });
  }
  function toggleTheme(btn) {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('theme', next); } catch (e) { /* private mode */ }
    if (!document.startViewTransition || reduceMotion.matches) { applyTheme(next); return; }
    const r = btn.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const end = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const vt = document.startViewTransition(() => applyTheme(next));
    vt.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
        { duration: 700, easing: 'cubic-bezier(.7,0,.2,1)', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => {});
  }
  const themeSlot = $('.top-r') || $('.nav-links');
  if (themeSlot) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-btn';
    b.innerHTML = ICONS;
    b.addEventListener('click', () => toggleTheme(b));
    if (themeSlot.classList.contains('top-r')) themeSlot.prepend(b); else themeSlot.append(b);
  }
  applyTheme(root.dataset.theme === 'light' ? 'light' : 'dark');

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

  /* ---------- nav border once the page scrolls, and how far down you are (--sp, 0..1) ----------
     --sp drives the purple hairline under the header. */

  const nav = $('#nav');
  let spQueued = false;
  const onScroll = () => {
    spQueued = false;
    nav?.classList.toggle('scrolled', window.scrollY > 8);
    const max = root.scrollHeight - window.innerHeight;
    root.style.setProperty('--sp', max > 0 ? Math.min(1, window.scrollY / max).toFixed(4) : '0');
  };
  window.addEventListener('scroll', () => { if (!spQueued) { spQueued = true; requestAnimationFrame(onScroll); } }, { passive: true });
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
        (root.dataset.theme === 'dark' ? '&co=141414&cl=3a3a3a&ct=ededed' : '&co=f5f5f5&cl=cfcfcf&ct=171717') + '&w=a';
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
