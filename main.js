/* =========================================================
   Max Yuan · portfolio behaviour
   Shared by index.html and every project page. No dependencies.
   ========================================================= */

(() => {
  'use strict';

  const doc = document.documentElement;
  const BASE = doc.dataset.root || '';          // "../" on project pages
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const isHome = !!$('.page[data-page]');
  const homeHref = isHome ? '' : BASE + 'index.html';
  const EMAIL = 'maxyuan081205@gmail.com';

  // Jump without the CSS smooth-scroll (used when swapping pages).
  function jumpTo(y) {
    const prev = doc.style.scrollBehavior;
    doc.style.scrollBehavior = 'auto';
    window.scrollTo(0, y);
    doc.style.scrollBehavior = prev;
  }

  /* ---------- toast ---------- */

  const toastEl = $('#toast');
  let toastTimer = 0;
  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(EMAIL);
      toast('email copied ✓');
      return true;
    } catch (e) {
      window.location.href = `mailto:${EMAIL}`;
      return false;
    }
  }

  /* ---------- nav: mobile menu ---------- */

  const burger = $('#navBurger');
  const navLinks = $('#navLinks');

  function setMenu(open) {
    if (!burger || !navLinks) return;
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    navLinks.classList.toggle('open', open);
  }
  burger?.addEventListener('click', () => setMenu(burger.getAttribute('aria-expanded') !== 'true'));
  navLinks?.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
  document.addEventListener('click', e => {
    if (navLinks?.classList.contains('open') && !e.target.closest('#navLinks, #navBurger')) setMenu(false);
  });

  /* ---------- scroll: nav border, back-to-top ---------- */

  const nav = $('#nav');
  const toTop = $('#toTop');
  let scrollQueued = false;

  function onScroll() {
    scrollQueued = false;
    const y = window.scrollY;
    nav?.classList.toggle('scrolled', y > 8);
    toTop?.classList.toggle('show', y > window.innerHeight * 0.8);
  }
  const queueScroll = () => { if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(onScroll); } };
  window.addEventListener('scroll', queueScroll, { passive: true });
  window.addEventListener('resize', queueScroll, { passive: true });
  onScroll();

  toTop?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  });

  /* ---------- scroll reveal ---------- */

  const revealIO = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries, io) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 })
    : null;

  // Siblings that reveal together get a small stagger.
  $$('.reveal').forEach(el => {
    const sibs = el.parentElement ? $$(':scope > .reveal', el.parentElement) : [el];
    const i = sibs.indexOf(el);
    if (i > 0) el.style.setProperty('--d', `${Math.min(i, 6) * 0.06}s`);
  });

  function initReveal(scope = document) {
    $$('.reveal:not(.in)', scope).forEach(el => (revealIO ? revealIO.observe(el) : el.classList.add('in')));
  }

  /* ---------- carousels ---------- */

  $$('[data-carousel]').forEach(car => {
    const track = $('.car-track', car);
    const slides = track ? $$('.car-slide', track) : [];
    const count = $('.car-count', car);
    if (slides.length < 2) { car.classList.add('single'); count?.remove(); return; }

    let index = -1;
    const go = i => {
      const n = slides.length;
      const target = slides[((i % n) + n) % n];
      track.scrollTo({ left: target.offsetLeft, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    };

    const dots = document.createElement('div');
    dots.className = 'car-dots';
    const dotButtons = slides.map((_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'car-dot';
      b.setAttribute('aria-label', `Show slide ${i + 1} of ${slides.length}`);
      b.addEventListener('click', () => go(i));
      dots.append(b);
      return b;
    });
    car.append(dots);

    const sync = () => {
      const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      if (i === index) return;
      index = i;
      dotButtons.forEach((b, j) => b.setAttribute('aria-current', String(j === i)));
      if (count) count.textContent = `${i + 1} / ${slides.length}`;
    };
    let frame = 0;
    track.addEventListener('scroll', () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; sync(); });
    }, { passive: true });

    $('.car-prev', car)?.addEventListener('click', () => go(index - 1));
    $('.car-next', car)?.addEventListener('click', () => go(index + 1));
    track.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
    });
    sync();
  });

  /* ---------- autoplay videos only while they're on screen ---------- */

  const autoVideos = $$('video[data-autoplay]');
  if (reduceMotion.matches || !('IntersectionObserver' in window)) {
    // No motion: keep the poster. Videos outside links get controls so they can still be played.
    autoVideos.forEach(v => { if (!v.closest('a')) v.controls = true; });
  } else {
    const videoIO = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const v = entry.target;
        if (entry.isIntersecting) {
          const p = v.play();
          if (p && p.catch) p.catch(() => {});
        } else {
          v.pause();
        }
      });
    }, { threshold: 0.25 });
    autoVideos.forEach(v => videoIO.observe(v));
  }

  /* ---------- expandable "details" panels ---------- */

  $$('.expand-btn').forEach(btn => {
    const panel = document.getElementById(btn.getAttribute('aria-controls'));
    if (!panel) return;
    panel.inert = true;
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      panel.classList.toggle('open', open);
      panel.inert = !open;
    });
  });

  /* ---------- project filters ---------- */

  const filterButtons = $$('.filters [data-filter]');
  const filterStatus = $('#filterStatus');
  filterButtons.forEach(btn => btn.addEventListener('click', () => {
    const f = btn.dataset.filter;
    filterButtons.forEach(b => {
      const on = b === btn;
      b.classList.toggle('btn-primary', on);
      b.classList.toggle('btn-ghost', !on);
      b.setAttribute('aria-pressed', String(on));
    });
    let shown = 0;
    $$('.pcard').forEach(card => {
      const match = f === 'all' || (card.dataset.cats || '').split(' ').includes(f);
      if (match) {
        shown += 1;
        if (card.classList.contains('is-hidden')) {
          card.classList.remove('is-hidden', 'is-entering');
          void card.offsetWidth;            // restart the entrance animation
          card.classList.add('is-entering', 'in');
        }
      } else {
        card.classList.add('is-hidden');
      }
    });
    if (filterStatus) filterStatus.textContent = `Showing ${shown} project${shown === 1 ? '' : 's'}`;
  }));

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
    const box = chip.closest('.skill-box');
    const out = box && $('.skill-used', box);
    if (!out) return;
    const show = () => {
      $$('.skill.is-on', box).forEach(c => c.classList.remove('is-on'));
      chip.classList.add('is-on');
      out.textContent = '';
      const name = document.createElement('b');
      name.textContent = chip.firstChild.textContent.trim();
      out.append(name, document.createTextNode(box.dataset.prefix === 'next' ? ' → next up in ' : ' → used in '));
      chip.dataset.used.split(',').forEach((key, i) => {
        const p = PROJECTS[key.trim()];
        if (!p) return;
        if (i) out.append(document.createTextNode(' · '));
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

  /* ---------- copy email ---------- */

  $$('[data-copy]').forEach(btn => btn.addEventListener('click', copyEmail));

  /* ---------- YouTube: a poster until clicked, so nothing loads from YouTube up front ---------- */

  $$('[data-yt]').forEach(btn => btn.addEventListener('click', () => {
    const frame = document.createElement('iframe');
    frame.className = 'yt-frame';
    frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(btn.dataset.yt)}?autoplay=1&rel=0`;
    frame.title = btn.dataset.title || 'YouTube video';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    btn.replaceWith(frame);
    frame.focus();
  }));

  $$('[data-year]').forEach(el => { el.textContent = String(new Date().getFullYear()); });

  /* ---------- home: hash router with page transitions ---------- */

  if (isHome) {
    const app = $('.app');
    const pages = $$('.page[data-page]');
    const order = pages.map(p => p.dataset.page);
    const aliases = { '': 'home', work: 'projects', toolkit: 'skills', intro: 'home' };   // old anchors still land somewhere sensible
    const baseTitle = document.title;
    let leaveTimer = 0;

    const pageFor = hash => {
      let id = decodeURIComponent(hash.replace(/^#/, ''));
      if (id in aliases) id = aliases[id];
      if (order.includes(id)) return { name: id, target: null };
      const target = id ? document.getElementById(id) : null;
      const owner = target && target.closest('.page[data-page]');
      if (owner) return { name: owner.dataset.page, target };
      return target ? null : { name: 'home', target: null };   // e.g. #main: let the browser handle it
    };

    // Highlight the nav link for the page, or for a section of it that has its own link (#skills on home).
    const markNav = (name, target) => {
      const section = target && target.id;
      const current = section && $(`[data-nav="${section}"]`) ? section : name;
      $$('[data-nav]').forEach(a => {
        if (a.dataset.nav === current) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
    };

    const activate = (next, target, initial) => {
      pages.forEach(p => p.classList.remove('active', 'leaving'));
      next.classList.add('active');
      if (target) target.scrollIntoView({ block: 'start' });
      else jumpTo(0);
      const name = next.dataset.page;
      markNav(name, target);
      document.title = next.dataset.title ? `${next.dataset.title} · Max Yuan` : baseTitle;
      if (!initial) {
        const heading = $('.ph-title, .hero-name', next);
        if (heading) {
          heading.setAttribute('tabindex', '-1');
          heading.focus({ preventScroll: true });
        }
      }
      initReveal(next);
      onScroll();
    };

    const show = (initial) => {
      const route = pageFor(location.hash);
      if (!route) return;
      const next = pages.find(p => p.dataset.page === route.name);
      const prev = pages.find(p => p.classList.contains('active'));
      clearTimeout(leaveTimer);
      if (prev === next) {
        markNav(next.dataset.page, route.target);
        if (route.target) route.target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
        return;
      }
      if (prev && !initial && !reduceMotion.matches) {
        pages.forEach(p => p.classList.remove('leaving'));
        prev.classList.remove('active');
        prev.classList.add('leaving');
        leaveTimer = setTimeout(() => activate(next, route.target, false), 170);
      } else {
        activate(next, route.target, initial);
      }
    };

    window.addEventListener('hashchange', () => show(false));
    show(true);

    // Clicking the link for the page you're already on scrolls back to its top.
    document.addEventListener('click', e => {
      const a = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
      if (!a) return;
      const id = a.getAttribute('href').slice(1);
      const name = id in aliases ? aliases[id] : id;
      const current = $('.page.active');
      if (current && order.includes(name) && current.dataset.page === name) {
        const here = pageFor(location.hash);
        if (here && here.target) return;        // on a section of this page (#skills): let the hash change
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      }
    });
  } else {
    initReveal();
  }
})();
