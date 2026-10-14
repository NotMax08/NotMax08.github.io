/* =========================================================
   Max Yuan · portfolio behaviour
   Shared by index.html and every project page. On the home page
   it also runs the hash router, and loads the robot scene
   (robot.js, three.js) that plays between pages.
   ========================================================= */

(() => {
  'use strict';

  const doc = document.documentElement;
  const BASE = doc.dataset.root || '';          // "../" on project pages
  const VERSION = (document.currentScript && document.currentScript.dataset.version) || '';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const isHome = !!$('.page[data-page]');
  const homeHref = isHome ? '' : BASE + 'index.html';
  const EMAIL = 'maxyuan081205@gmail.com';
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // Jump without the CSS smooth-scroll (used when swapping pages).
  function jumpTo(y) {
    const prev = doc.style.scrollBehavior;
    doc.style.scrollBehavior = 'auto';
    window.scrollTo(0, y);
    doc.style.scrollBehavior = prev;
  }

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

  /* ---------- nav background once the page scrolls ---------- */

  const nav = $('#nav');
  let scrollQueued = false;
  function onScroll() {
    scrollQueued = false;
    nav?.classList.toggle('scrolled', window.scrollY > 8);
  }
  window.addEventListener('scroll', () => {
    if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();

  /* ---------- project cards: play the clip on hover ---------- */

  if (!reduceMotion.matches) {
    $$('video[data-hover]').forEach(v => {
      const card = v.closest('a') || v.parentElement;
      const play = () => {
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      };
      const stop = () => {
        v.pause();
        v.classList.remove('playing');
      };
      v.addEventListener('playing', () => v.classList.add('playing'));
      card.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') play(); });
      card.addEventListener('pointerleave', stop);
      card.addEventListener('focus', play);
      card.addEventListener('blur', stop);
    });
  }

  /* ---------- skills: show which projects used each one ---------- */

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

  if (!isHome) return;

  /* =========================================================
     Home: hash router. With the robot loaded, changing page plays
     a first-person pick-and-place into that page's bin.
     ========================================================= */

  const pages = $$('.page[data-page]');
  const order = pages.map(p => p.dataset.page);
  const aliases = { '': 'home', work: 'projects', toolkit: 'skills', intro: 'home' };   // old anchors still land somewhere sensible
  const baseTitle = document.title;
  const stage = $('#stage');
  const intro = $('.intro');
  let robot = null;
  let current = null;              // the page on screen
  let heading = null;              // the page on screen, or the one a transition is heading to
  let navToken = 0;
  let introInView = true;
  let hideTimer = 0;

  const pageFor = hash => {
    let id = decodeURIComponent(hash.replace(/^#/, ''));
    if (id in aliases) id = aliases[id];
    if (order.includes(id)) return { name: id, target: null };
    const target = id ? document.getElementById(id) : null;
    const owner = target && target.closest('.page[data-page]');
    if (owner) return { name: owner.dataset.page, target };
    return target ? null : { name: 'home', target: null };   // e.g. #main: let the browser handle it
  };

  const markNav = name => {
    $$('[data-nav]').forEach(a => {
      if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  };

  // Run the robot only while it can be seen: the home intro, or a transition.
  function syncRobot() {
    if (!robot) return;
    const moving = doc.classList.contains('robot-moving');
    robot.setVisible(moving || (doc.dataset.view === 'home' && introInView));
  }

  function activate(next, target, focus) {
    pages.forEach(p => p.classList.toggle('active', p === next));
    current = next;
    const name = next.dataset.page;
    doc.dataset.view = name;
    if (target) target.scrollIntoView({ block: 'start' });
    else jumpTo(0);
    markNav(name);
    document.title = next.dataset.title ? `${next.dataset.title} · Max Yuan` : baseTitle;
    if (focus) {
      const title = $('.ph-title, .intro-name', next);
      if (title) {
        title.setAttribute('tabindex', '-1');
        title.focus({ preventScroll: true });
      }
    }
    onScroll();
    syncRobot();
  }

  async function go(initial) {
    const route = pageFor(location.hash);
    if (!route) return;
    const next = pages.find(p => p.dataset.page === route.name);
    if (next === current && next === heading) {
      markNav(next.dataset.page);
      if (route.target) route.target.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
      else window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      return;
    }

    heading = next;
    const token = ++navToken;
    clearTimeout(hideTimer);
    if (initial || !robot || reduceMotion.matches) {
      doc.classList.remove('robot-moving', 'robot-leaving');
      activate(next, route.target, !initial);
      return;
    }

    // Fade the page out and bring the robot up in front of it.
    doc.classList.remove('robot-leaving');
    doc.classList.add('robot-moving');
    markNav(next.dataset.page);
    syncRobot();

    if (next.dataset.page === 'home') {
      robot.home();
      await wait(260);
      if (token !== navToken) return;
      activate(next, route.target, true);
      doc.classList.remove('robot-moving');
      syncRobot();
      return;
    }

    await Promise.race([robot.transition(next.dataset.page), wait(6000)]);
    if (token !== navToken) return;
    // The cube is in the bin: fade the robot out while the camera leans in, and the page in.
    doc.classList.add('robot-leaving');
    activate(next, route.target, true);
    await wait(300);
    if (token !== navToken) return;
    doc.classList.remove('robot-moving');
    hideTimer = setTimeout(() => {
      doc.classList.remove('robot-leaving');
      syncRobot();
    }, 500);
  }

  window.addEventListener('hashchange', () => go(false));
  go(true);

  // Clicking the link for the page you're already on scrolls back to its top.
  document.addEventListener('click', e => {
    const a = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    const id = a.getAttribute('href').slice(1);
    const name = id in aliases ? aliases[id] : id;
    if (current && order.includes(name) && current.dataset.page === name && location.hash.slice(1) === id) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    }
  });

  // A click or a key during a transition skips to the end of it.
  const skip = e => {
    if (!robot || !robot.busy || !doc.classList.contains('robot-moving')) return;
    if (e.type === 'keydown' && !['Escape', 'Enter', ' '].includes(e.key)) return;
    if (e.type === 'pointerdown' && e.target instanceof Element && e.target.closest('a, button')) return;
    robot.skip();
  };
  document.addEventListener('pointerdown', skip);
  document.addEventListener('keydown', skip);

  if (intro && 'IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      introInView = entries.some(en => en.isIntersecting);
      syncRobot();
    }).observe(intro);
  }

  /* ---------- load the robot (three.js from a CDN, the arm meshes from assets/) ---------- */

  async function loadRobot() {
    const canvas = $('#stageCanvas');
    const labels = $('#binLabels');
    if (!stage || !canvas || !labels) return;
    try {
      const mod = await import(new URL(`robot.js?v=${VERSION}`, document.baseURI).href);
      robot = await mod.createRobot({ canvas, labels, base: BASE, reduceMotion: reduceMotion.matches });
      stage.classList.add('ready');
      syncRobot();
    } catch (err) {
      // No WebGL, or the CDN is blocked: the site works the same, just without the robot.
      robot = null;
      console.warn('Robot intro unavailable:', err);
    }
  }
  loadRobot();
})();
