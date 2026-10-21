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

  $$('[data-year]').forEach(el => { el.textContent = String(new Date().getFullYear()); });

  // Old links from the previous site layout land in the right place.
  const OLD = { '#home': '#about', '#hello': '#about', '#work': '#projects', '#toolkit': '#skills' };
  if (isHome && OLD[location.hash]) {
    history.replaceState(null, '', OLD[location.hash]);
    $(OLD[location.hash])?.scrollIntoView();
  }
})();
