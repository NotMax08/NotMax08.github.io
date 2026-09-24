/* =========================================================
   Max Yuan · portfolio behaviour
   Shared by index.html and every project page. No dependencies.
   ========================================================= */

(() => {
  'use strict';

  const doc = document.documentElement;
  const BASE = doc.dataset.root || '';          // "../" on project pages
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const attempt = (fn, fallback = null) => { try { return fn(); } catch (e) { return fallback; } };
  const local = { get: k => attempt(() => localStorage.getItem(k)), set: (k, v) => attempt(() => localStorage.setItem(k, v)) };
  const session = { get: k => attempt(() => sessionStorage.getItem(k)), set: (k, v) => attempt(() => sessionStorage.setItem(k, v)) };
  const isHome = !!$('.page[data-page]');
  const homeHref = isHome ? '' : BASE + 'index.html';

  // Jump without the CSS smooth-scroll (used when swapping pages).
  function jumpTo(y) {
    const prev = doc.style.scrollBehavior;
    doc.style.scrollBehavior = 'auto';
    window.scrollTo(0, y);
    doc.style.scrollBehavior = prev;
  }

  /* ---------- first-visit loader ---------- */

  const readyQueue = [];
  let ready = false;
  const whenReady = fn => (ready ? fn() : readyQueue.push(fn));
  function markReady() {
    if (ready) return;
    ready = true;
    readyQueue.splice(0).forEach(fn => fn());
  }

  const loader = $('#loader');
  if (loader && !doc.classList.contains('seen')) {
    const t0 = performance.now();
    let hidden = false;
    const hide = () => {
      if (hidden) return;
      hidden = true;
      loader.classList.add('done');
      session.set('seen', '1');
      setTimeout(() => loader.remove(), 700);
      markReady();
    };
    window.addEventListener('load', () => setTimeout(hide, Math.max(0, 1000 - (performance.now() - t0))));
    setTimeout(hide, 2600);
  } else {
    loader?.remove();
    session.set('seen', '1');
    markReady();
  }

  /* ---------- theme ---------- */

  const themeBtn = $('#themeToggle');
  const metaTheme = $('meta[name="theme-color"]');

  function paintTheme(theme) {
    doc.dataset.theme = theme;
    themeBtn?.setAttribute('aria-pressed', String(theme === 'dark'));
    themeBtn?.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    if (metaTheme) metaTheme.content = theme === 'dark' ? '#0D0B1C' : '#F7F5FF';
  }
  paintTheme(doc.dataset.theme === 'dark' ? 'dark' : 'light');

  function toggleTheme() {
    const next = doc.dataset.theme === 'dark' ? 'light' : 'dark';
    local.set('theme', next);
    if (!document.startViewTransition || reduceMotion.matches || !themeBtn) {
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
        { duration: 650, easing: 'cubic-bezier(.2,.7,.2,1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(() => {});
    vt.finished.finally(() => doc.classList.remove('no-trans'));
  }
  themeBtn?.addEventListener('click', toggleTheme);

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

  /* ---------- scroll: progress bar, nav shadow, back-to-top ---------- */

  const progress = $('#progress');
  const nav = $('#nav');
  const toTop = $('#toTop');
  let scrollQueued = false;

  function onScroll() {
    scrollQueued = false;
    const y = window.scrollY;
    const max = doc.scrollHeight - window.innerHeight;
    progress?.style.setProperty('--p', max > 0 ? Math.min(1, y / max).toFixed(4) : '0');
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

  /* ---------- cursor-follow glow on cards and buttons ---------- */

  if (finePointer.matches) {
    let lastEvent = null;
    let frame = 0;
    document.addEventListener('pointermove', e => {
      lastEvent = e;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const t = lastEvent.target;
        const el = t instanceof Element ? t.closest('.glow-card, .btn') : null;
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${lastEvent.clientX - r.left}px`);
        el.style.setProperty('--my', `${lastEvent.clientY - r.top}px`);
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
    if (i > 0) el.style.setProperty('--d', `${Math.min(i, 6) * 0.07}s`);
  });

  function initReveal(scope = document) {
    $$('.reveal:not(.in)', scope).forEach(el => (revealIO ? revealIO.observe(el) : el.classList.add('in')));
  }

  /* ---------- stats: count-up + scramble ---------- */

  function countUp(el) {
    const end = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    if (reduceMotion.matches || Number.isNaN(end)) { el.textContent = end + suffix; return; }
    const t0 = performance.now();
    const dur = 1400;
    const step = now => {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function scramble(el) {
    const word = el.dataset.scramble;
    if (reduceMotion.matches) { el.textContent = word; return; }
    const glyphs = 'ABCDEFGHJKLMNOPQRSTUVWXYZ0123456789#<>/+*';
    const total = 30;
    let frame = 0;
    const tick = () => {
      const settled = Math.floor((frame / total) * word.length);
      el.textContent = word.split('').map((c, i) => (i < settled ? c : glyphs[(Math.random() * glyphs.length) | 0])).join('');
      frame += 1;
      if (frame <= total) setTimeout(tick, 40);
      else el.textContent = word;
    };
    tick();
  }

  const stats = $('.stats');
  if (stats && 'IntersectionObserver' in window && !reduceMotion.matches) {
    $$('[data-count]', stats).forEach(el => { el.textContent = '0'; });
    const statIO = new IntersectionObserver((entries, io) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        $$('[data-count]', entry.target).forEach(countUp);
        $$('[data-scramble]', entry.target).forEach(scramble);
      });
    }, { threshold: 0.4 });
    whenReady(() => statIO.observe(stats));
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
      b.classList.toggle('btn-glow', on);
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
    wato: ['WATonomous', homeHref + '#experience'],
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

  $$('[data-jump]').forEach(btn => btn.addEventListener('click', () => {
    const target = document.getElementById(btn.dataset.jump);
    if (!target) return;
    target.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
  }));

  /* ---------- copy email + toast ---------- */

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

  if (isHome) {
    const app = $('.app');
    const pages = $$('.page[data-page]');
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
      whenReady(() => initReveal(next));
      onScroll();
    };

    const show = (initial) => {
      const route = pageFor(location.hash);
      if (!route) return;
      const next = pages.find(p => p.dataset.page === route.name);
      const prev = pages.find(p => p.classList.contains('active'));
      clearTimeout(leaveTimer);
      if (prev === next) {
        if (route.target) route.target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const delta = order.indexOf(route.name) - (prev ? order.indexOf(prev.dataset.page) : 0);
      app.dataset.dir = prev ? (delta > 0 ? 'fwd' : 'back') : '';
      if (prev && !initial && !reduceMotion.matches) {
        pages.forEach(p => p.classList.remove('leaving'));
        prev.classList.remove('active');
        prev.classList.add('leaving');
        leaveTimer = setTimeout(() => activate(next, route.target, false), 190);
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
  } else {
    whenReady(() => initReveal());
  }

  /* ---------- mascot: a tiny Go2 that knows a few facts ---------- */

  function initMascot() {
    if (session.get('dog') === 'napping') return;

    const quips = [
      { text: "Hi! I'm a tiny Go2. My big sibling is learning to walk with PPO in Isaac Lab. 🐾", label: 'Watch it walk', href: BASE + 'projects/quadruped-ppo.html' },
      { text: 'Early walking policies learned to crawl instead. A height reward fixed that.', label: 'See the reward tuning', href: BASE + 'projects/quadruped-ppo.html' },
      { text: 'A robot pulled toast out of a toaster by itself and won 1st place at BOTS. 🥪', label: 'See the sandwich bot', href: BASE + 'projects/brackey-way.html' },
      { text: '100+ teleoperated demos went into that π₀ fine-tune.', label: 'How it was trained', href: BASE + 'projects/brackey-way.html' },
      { text: "The maze robot's SLAM map came out warped until the LiDAR scan rate went up to 20 Hz.", label: 'Read the debug story', href: BASE + 'projects/maze-nav2.html' },
      { text: 'RICO fetches tools when you ask for them. Built in one hackathon weekend.', label: 'Meet RICO', href: BASE + 'projects/rico-arm.html' },
      { text: 'Max is looking for a robotics or ML co-op. 👀', label: 'Say hi', href: homeHref + '#contact' },
      { text: 'Psst: the moon button up top turns on lab mode. 🌙', label: 'Try it', run: () => themeBtn?.click() },
      { text: 'Need more room to read? I can take a nap. 💤', label: 'Nap time', run: () => nap() },
    ];

    const wrap = document.createElement('div');
    wrap.className = 'mascot';
    wrap.innerHTML = `
      <button class="mascot-btn" type="button" aria-label="Robot dog: tap for a fun fact" aria-controls="dogBubble" aria-expanded="false">
        <svg viewBox="0 0 96 80" aria-hidden="true">
          <defs><linearGradient id="dogFur" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#DCCFFF"/><stop offset="1" stop-color="#A9CEFF"/></linearGradient></defs>
          <ellipse cx="47" cy="75" rx="27" ry="3.4" fill="rgba(60,40,160,.2)"/>
          <g class="dog">
            <g class="leg leg-b"><path d="M58 45 L54 57 L58 69" fill="none" class="ink-2" stroke="#7069AE" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g>
            <g class="leg leg-a"><path d="M26 45 L22 57 L26 69" fill="none" class="ink-2" stroke="#7069AE" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g>
            <path d="M23 31 L17 19" class="ink" stroke="#2B2650" stroke-width="2.2" stroke-linecap="round"/>
            <circle class="antenna-tip" cx="16.5" cy="18" r="3" fill="#93C5FD"/>
            <rect x="19" y="29" width="52" height="19" rx="9.5" fill="url(#dogFur)" class="ink" stroke="#2B2650" stroke-width="2.2"/>
            <path d="M44 30 V47" stroke="#2B2650" stroke-width="1.4" opacity=".35"/>
            <circle cx="31" cy="38.5" r="2.2" fill="#8B6CF6"/>
            <rect x="62" y="21" width="26" height="20" rx="8" fill="#F5F2FF" class="ink" stroke="#2B2650" stroke-width="2.2"/>
            <rect x="68" y="25.5" width="16.5" height="10.5" rx="5.2" fill="#1B1838"/>
            <ellipse class="eye" cx="73.5" cy="30.8" rx="2.2" ry="2.4" fill="#9FD6FF"/>
            <ellipse class="eye" cx="79.8" cy="30.8" rx="2.2" ry="2.4" fill="#9FD6FF"/>
            <g class="leg leg-a"><path d="M64 45 L59 57 L64 69" fill="none" class="ink" stroke="#2B2650" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/></g>
            <g class="leg leg-b"><path d="M33 45 L28 57 L33 69" fill="none" class="ink" stroke="#2B2650" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/></g>
          </g>
        </svg>
      </button>
      <div class="bubble" id="dogBubble" role="status" aria-live="polite">
        <p class="bubble-text"></p>
        <div class="bubble-action"></div>
        <button class="bubble-close" type="button" aria-label="Close"><svg class="i" aria-hidden="true"><use href="#i-close"/></svg></button>
      </div>`;
    document.body.append(wrap);
    document.body.classList.add('has-dog');

    const dogBtn = $('.mascot-btn', wrap);
    const bubble = $('.bubble', wrap);
    const textEl = $('.bubble-text', wrap);
    const actionEl = $('.bubble-action', wrap);
    let idx = session.get('dogHi') ? Math.floor(Math.random() * quips.length) : 0;
    let hideTimer = 0;

    function say(q, ms = 9000) {
      textEl.textContent = q.text;
      actionEl.textContent = '';
      const cta = document.createElement(q.href ? 'a' : 'button');
      cta.className = 'bubble-cta';
      cta.textContent = `${q.label} →`;
      if (q.href) cta.href = q.href;
      else { cta.type = 'button'; cta.addEventListener('click', q.run); }
      actionEl.append(cta);
      bubble.classList.add('show');
      dogBtn.setAttribute('aria-expanded', 'true');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(close, ms);
    }
    function close() {
      bubble.classList.remove('show');
      dogBtn.setAttribute('aria-expanded', 'false');
    }
    function hop() {
      wrap.classList.remove('hop');
      void wrap.offsetWidth;
      wrap.classList.add('hop');
    }
    function nap() {
      session.set('dog', 'napping');
      close();
      wrap.style.transition = 'opacity .4s ease, transform .4s ease';
      wrap.style.opacity = '0';
      wrap.style.transform = 'translateY(20px)';
      setTimeout(() => { wrap.remove(); document.body.classList.remove('has-dog'); }, 450);
      toast('The robot dog is napping 💤');
    }

    dogBtn.addEventListener('click', () => {
      hop();
      say(quips[idx % quips.length]);
      idx += 1;
    });
    $('.bubble-close', wrap).addEventListener('click', close);
    bubble.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    bubble.addEventListener('mouseleave', () => { hideTimer = setTimeout(close, 4000); });

    // Say hello once per visit.
    if (!session.get('dogHi')) {
      whenReady(() => setTimeout(() => {
        session.set('dogHi', '1');
        hop();
        say(quips[0], 7000);
        idx = 1;
      }, 3200));
    }
  }
  initMascot();
})();
