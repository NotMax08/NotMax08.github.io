/* =========================================================
   Max Yuan · portfolio behaviour
   Shared by index.html and every project page. No dependencies.
   ========================================================= */

(() => {
  'use strict';

  const doc = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  // Jump without the CSS smooth-scroll (used when swapping pages).
  function jumpTo(y) {
    const prev = doc.style.scrollBehavior;
    doc.style.scrollBehavior = 'auto';
    window.scrollTo(0, y);
    doc.style.scrollBehavior = prev;
  }

  /* ---------- theme ---------- */

  const themeBtn = $('#themeToggle');
  const metaTheme = $('meta[name="theme-color"]');

  function paintTheme(theme) {
    doc.dataset.theme = theme;
    themeBtn?.setAttribute('aria-pressed', String(theme === 'dark'));
    themeBtn?.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    if (metaTheme) metaTheme.content = theme === 'dark' ? '#0D0B1C' : '#F8F7FF';
  }
  paintTheme(doc.dataset.theme === 'dark' ? 'dark' : 'light');

  themeBtn?.addEventListener('click', () => {
    const next = doc.dataset.theme === 'dark' ? 'light' : 'dark';
    store.set('theme', next);
    if (!document.startViewTransition || reduceMotion.matches) {
      paintTheme(next);                     // CSS transitions give a soft fade
      return;
    }
    // Circular reveal that grows out of the toggle button.
    const r = themeBtn.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    doc.classList.add('no-trans');
    const vt = document.startViewTransition(() => paintTheme(next));
    vt.ready.then(() => {
      doc.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 600, easing: 'cubic-bezier(.2,.7,.2,1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(() => {});
    vt.finished.finally(() => doc.classList.remove('no-trans'));
  });

  /* ---------- nav: mobile menu + border once scrolled ---------- */

  const nav = $('#nav');
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

  const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- cursor-follow shine inside glow buttons ---------- */

  if (finePointer.matches) {
    let lastEvent = null;
    let frame = 0;
    document.addEventListener('pointermove', e => {
      lastEvent = e;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const t = lastEvent.target;
        const btn = t instanceof Element ? t.closest('.btn') : null;
        if (!btn) return;
        const r = btn.getBoundingClientRect();
        btn.style.setProperty('--mx', `${lastEvent.clientX - r.left}px`);
        btn.style.setProperty('--my', `${lastEvent.clientY - r.top}px`);
      });
    }, { passive: true });
  }

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
    if (i > 0) el.style.setProperty('--d', `${Math.min(i, 5) * 0.06}s`);
  });

  function initReveal(scope = document) {
    $$('.reveal:not(.in)', scope).forEach(el => (revealIO ? revealIO.observe(el) : el.classList.add('in')));
  }

  /* ---------- stats count up once ---------- */

  function countUp(el) {
    const end = parseFloat(el.dataset.count);
    if (Number.isNaN(end)) return;
    const t0 = performance.now();
    const step = now => {
      const p = Math.min(1, (now - t0) / 1200);
      el.textContent = String(Math.round(end * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const stats = $('.stats');
  if (stats && 'IntersectionObserver' in window && !reduceMotion.matches) {
    const nums = $$('[data-count]', stats);
    nums.forEach(el => { el.textContent = '0'; });
    new IntersectionObserver((entries, io) => {
      if (!entries.some(e => e.isIntersecting)) return;
      io.disconnect();
      nums.forEach(countUp);
    }, { threshold: 0.4 }).observe(stats);
  }

  /* ---------- carousels ---------- */

  $$('[data-carousel]').forEach(car => {
    const track = $('.car-track', car);
    const slides = track ? $$('.car-slide', track) : [];
    if (slides.length < 2) { car.classList.add('single'); return; }

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

  /* ---------- demo clips play only while hovered ---------- */

  if (finePointer.matches && !reduceMotion.matches) {
    $$('video[data-hover-play]').forEach(video => {
      const scope = video.closest('.work, .pcard') || video;
      scope.addEventListener('pointerenter', () => {
        const p = video.play();
        if (p && p.catch) p.catch(() => {});
      });
      scope.addEventListener('pointerleave', () => video.pause());
    });
  }

  /* ---------- copy email ---------- */

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
    const text = btn.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
      toast('Email copied ✓');
    } catch (e) {
      window.location.href = `mailto:${text}`;
    }
  }));

  $$('[data-year]').forEach(el => { el.textContent = String(new Date().getFullYear()); });

  /* ---------- home: hash router with page transitions ---------- */

  const pages = $$('.page[data-page]');
  if (!pages.length) {
    initReveal();
    return;
  }

  const order = pages.map(p => p.dataset.page);
  const aliases = { '': 'home', work: 'projects', toolkit: 'skills' };   // old anchors still land somewhere sensible
  const baseTitle = document.title;
  let leaveTimer = 0;

  const pageFor = hash => {
    const id = decodeURIComponent(hash.replace(/^#/, ''));
    if (id in aliases) return { name: aliases[id], target: null };
    if (order.includes(id)) return { name: id, target: null };
    const target = id ? document.getElementById(id) : null;
    const owner = target && target.closest('.page[data-page]');
    if (owner) return { name: owner.dataset.page, target };
    return target ? null : { name: 'home', target: null };   // e.g. #main: let the browser handle it
  };

  const activate = (next, target, initial) => {
    pages.forEach(p => p.classList.remove('active', 'leaving'));
    next.classList.add('active');
    if (target) target.scrollIntoView({ block: 'start' });
    else jumpTo(0);
    const name = next.dataset.page;
    $$('[data-nav]').forEach(a => {
      if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
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

  const show = initial => {
    const route = pageFor(location.hash);
    if (!route) return;
    const next = pages.find(p => p.dataset.page === route.name);
    const prev = pages.find(p => p.classList.contains('active'));
    clearTimeout(leaveTimer);
    if (prev === next) {
      if (route.target) route.target.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    }
  });
})();
