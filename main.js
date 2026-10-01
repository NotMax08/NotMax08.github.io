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
  const attempt = (fn, fallback = null) => { try { return fn(); } catch (e) { return fallback; } };
  const session = { get: k => attempt(() => sessionStorage.getItem(k)), set: (k, v) => attempt(() => sessionStorage.setItem(k, v)) };
  const isHome = !!$('.page[data-page]');
  const homeHref = isHome ? '' : BASE + 'index.html';
  const SECTIONS = ['about', 'projects', 'experience', 'awards', 'skills', 'contact'];
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

  /* ---------- home: terminal intro ---------- */

  function initTerminal() {
    const term = $('#term');
    const body = $('#termBody');
    if (!body || !term) return;
    const hints = $('#termHints');
    const instant = doc.classList.contains('seen');
    const history = [];
    let histIndex = 0;
    let booting = true;
    let skip = false;
    let busy = false;
    let input = null;
    let inputLine = null;

    const live = document.createElement('p');      // announces command output to screen readers
    live.className = 'visually-hidden';
    live.setAttribute('role', 'status');
    term.after(live);

    const sleep = ms => new Promise(res => setTimeout(res, skip ? 0 : ms));
    const scrollDown = () => { body.scrollTop = body.scrollHeight; };

    // A line is a list of [className, text] parts, or a plain string.
    function line(parts, cls = '') {
      const p = document.createElement('p');
      p.className = `term-line ${cls}`.trim();
      (typeof parts === 'string' ? [['', parts]] : parts).forEach(([c, text, onClick]) => {
        const s = document.createElement('span');
        if (c) s.className = c;
        s.textContent = text;
        if (onClick) {
          s.classList.add('t-link');
          s.setAttribute('role', 'button');
          s.tabIndex = 0;
          s.addEventListener('click', onClick);
          s.addEventListener('keydown', e => { if (e.key === 'Enter') onClick(); });
        }
        p.append(s);
      });
      if (inputLine && inputLine.isConnected) body.insertBefore(p, inputLine);
      else body.append(p);
      scrollDown();
      return p;
    }

    const prompt = () => [['t-user', 'max@portfolio'], ['', ' '], ['t-path', '~'], ['', ' '], ['t-sym', '%'], ['', ' ']];

    async function typeCommand(cmd) {
      const p = line(prompt());
      const c = document.createElement('span');
      c.className = 't-cmd';
      const cursor = document.createElement('span');
      cursor.className = 'term-cursor';
      p.append(c, cursor);
      for (const ch of cmd) {
        if (skip) { c.textContent = cmd; break; }
        c.textContent += ch;
        scrollDown();
        await sleep(28 + Math.random() * 38);
      }
      await sleep(220);
      cursor.remove();
    }

    const go = key => { location.hash = `#${key}`; };
    const openTab = url => { window.open(url, '_blank', 'noopener'); };

    const NOW = [
      [['t-tag', '→ '], ['', 'humanoid RL + autonomy on WATonomous']],
      [['t-tag', '→ '], ['', 'training a Unitree Go2 to walk with PPO in Isaac Lab']],
      [['t-tag', '→ '], ['', 'getting into VLAs (π₀ / π₀.5) and sim digital twins']],
    ];

    const lastLogin = () => {
      const d = new Date();
      const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
      const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      return `Last login: ${day} ${time} on ttys000`;
    };

    // ls output: the folders and the résumé are clickable
    const lsParts = () => {
      const parts = [];
      SECTIONS.forEach(s => { parts.push(['t-tag', `${s}/`, () => go(s)], ['', '  ']); });
      parts.push(['', 'now.txt  skills.txt  '], ['t-cmd', 'resume.pdf', () => openTab('resume.pdf')]);
      return parts;
    };

    const BOOT = [
      { out: [[['t-dim', lastLogin()]]] },
      { cmd: 'whoami', out: [[['t-cmd', 'Max Yuan · Mechatronics Engineering @ UWaterloo']]] },
      { cmd: 'cat now.txt', out: NOW },
      { cmd: 'ls', out: [lsParts(), [['t-info', 'click a folder, scroll down, or type '], ['t-cmd', 'help']]] },
    ];

    async function boot() {
      body.textContent = '';
      if (instant) skip = true;
      else await sleep(900);
      for (const step of BOOT) {
        if (step.cmd) await typeCommand(step.cmd);
        for (const out of step.out) {
          line(out);
          await sleep(step.gap || 60);
        }
        await sleep(step.cmd ? 320 : 380);
      }
      booting = false;
      skip = false;
      session.set('booted', '1');
      makeInput();
      hints?.classList.add('show');
    }

    function makeInput() {
      inputLine = document.createElement('div');
      inputLine.className = 'term-line term-input-line';
      const pr = document.createElement('span');
      pr.className = 't-prompt';
      prompt().forEach(([c, text]) => {
        const s = document.createElement('span');
        if (c) s.className = c;
        s.textContent = text;
        pr.append(s);
      });
      const wrap = document.createElement('span');
      wrap.className = 'term-input-wrap';
      input = document.createElement('input');
      input.className = 'term-input';
      input.type = 'text';
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.setAttribute('autocapitalize', 'off');
      input.setAttribute('aria-label', 'Terminal: type a command, like help');
      input.setAttribute('enterkeyhint', 'send');
      const cursor = document.createElement('span');
      cursor.className = 'term-cursor';
      cursor.setAttribute('aria-hidden', 'true');
      const mirror = document.createElement('span');     // measures text width so the block cursor can follow the caret
      mirror.setAttribute('aria-hidden', 'true');
      mirror.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit';
      wrap.append(input, cursor, mirror);
      inputLine.append(pr, wrap);
      body.append(inputLine);
      scrollDown();

      const place = () => {
        mirror.textContent = input.value.slice(0, input.selectionStart ?? input.value.length);
        cursor.style.transform = `translateX(${mirror.offsetWidth}px)`;
      };
      ['input', 'keyup', 'click', 'focus'].forEach(ev => input.addEventListener(ev, place));
      input.addEventListener('focus', () => wrap.classList.add('focused'));
      input.addEventListener('blur', () => wrap.classList.remove('focused'));
      input.addEventListener('keydown', onKey);
      input._place = place;
    }

    function complete() {
      const v = input.value;
      const commands = ['help', 'ls', 'cd', 'cat', 'open', 'whoami', 'clear', 'history', 'email', 'pwd', 'echo', 'date'];
      const args = { cd: SECTIONS, cat: ['now.txt', 'skills.txt', 'README.md'], open: ['resume.pdf', 'github', 'linkedin'] };
      let pre = '';
      let word = v;
      let list = commands;
      const m = v.match(/^(cd|cat|open)\s+(\S*)$/);
      if (m) {
        pre = v.slice(0, v.length - m[2].length);
        word = m[2];
        list = args[m[1]];
      } else if (/\s/.test(v)) {
        return;
      }
      const hits = list.filter(w => w.startsWith(word));
      if (hits.length === 1) input.value = pre + hits[0] + (list === commands ? ' ' : '');
      else if (hits.length > 1) {
        echo(v);
        line(hits.map(h => ['t-info', `${h}   `]));
      }
      input._place();
    }

    function onKey(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = input.value;
        input.value = '';
        input._place();
        run(v);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!history.length) return;
        histIndex = Math.max(0, histIndex - 1);
        input.value = history[histIndex] || '';
        requestAnimationFrame(() => { input.setSelectionRange(input.value.length, input.value.length); input._place(); });
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        histIndex = Math.min(history.length, histIndex + 1);
        input.value = history[histIndex] || '';
        input._place();
      } else if (e.key === 'Tab') {
        if (!input.value) return;               // let Tab move focus when there's nothing to complete
        e.preventDefault();
        complete();
      } else if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        run('clear', true);
      } else if (e.key === 'c' && e.ctrlKey && !window.getSelection().toString()) {
        echo(`${input.value}^C`);
        input.value = '';
        input._place();
      }
    }

    function echo(cmd) {
      line([...prompt(), ['t-cmd', cmd]]);
    }

    function say(text) { live.textContent = text; }

    const COMMANDS = {
      help() {
        const rows = [
          ['ls', 'list what\'s here'],
          ['cd <section>', 'open a section, e.g. cd projects'],
          ['cat now.txt', 'what I\'m working on'],
          ['cat skills.txt', 'skills at a glance'],
          ['open resume.pdf', 'also: open github, open linkedin'],
          ['email', 'copy my email'],
          ['whoami · clear · history', ''],
        ];
        rows.forEach(([c, d]) => line([['t-cmd', c.padEnd(26)], ['t-info', d]]));
        say('Commands: ls, cd section, cat now.txt, cat skills.txt, open resume.pdf, email, whoami, clear, history.');
      },
      ls(args) {
        if (/^projects\/?$/.test(args[0] || '')) {
          [
            ['brackey-way', 'projects/brackey-way.html'],
            ['quadruped-ppo', 'projects/quadruped-ppo.html'],
            ['maze-nav2', 'projects/maze-nav2.html'],
            ['rico-arm', 'projects/rico-arm.html'],
            ['ftc-18844', 'projects/ftc-18844.html'],
            ['studybuddy-9520', '#studybuddy'],
          ].forEach(([name, href]) => line([['t-tag', '  '], ['', name, () => { location.href = href; }]]));
          say('brackey-way, quadruped-ppo, maze-nav2, rico-arm, ftc-18844, studybuddy-9520');
          return;
        }
        line(lsParts());
        say(`${SECTIONS.join(', ')}, now.txt, skills.txt, resume.pdf`);
      },
      cd(args) {
        const key = (args[0] || '~').replace(/^~\/?/, '').replace(/\/$/, '').toLowerCase();
        if (!key || key === '.') { line([['t-info', 'you\'re already home']]); return; }
        if (key === '..' || key === '/') { line([['t-info', 'this is as far up as it goes']]); return; }
        if (!SECTIONS.includes(key)) { line([['t-err', `cd: no such directory: ${args[0]}`]]); return; }
        line([['t-info', 'opening '], ['t-tag', `~/${key}`], ['t-info', ' …']]);
        say(`Opening ${key}`);
        setTimeout(() => go(key), reduceMotion.matches ? 0 : 380);
      },
      cat(args) {
        const f = (args[0] || '').toLowerCase();
        if (f === 'now.txt') { NOW.forEach(l => line(l)); return; }
        if (f === 'skills.txt') {
          [
            ['languages ', 'Python · C++ · Java'],
            ['robotics  ', 'ROS2 · Nav2 · slam_toolbox · AMCL · PID · IK · odometry'],
            ['sim/vision', 'Isaac Sim · Isaac Lab · OpenCV · YOLOv8'],
            ['learning  ', 'PPO · imitation learning · SFT · π₀ VLA · rsl_rl · PyTorch'],
          ].forEach(([k, v]) => line([['t-tag', `${k}  `], ['', v]]));
          line([['t-info', 'full list with projects: '], ['t-cmd', 'cd skills', () => go('skills')]]);
          say('Skills: Python, C++, Java; ROS2, Nav2, SLAM, PID, IK; Isaac Sim, Isaac Lab, OpenCV, YOLOv8; PPO, imitation learning, pi zero VLA, PyTorch.');
          return;
        }
        if (f === 'readme.md') {
          line('I like robots that have to deal with the real world: legged locomotion,');
          line('mobile autonomy, and manipulation that mixes learned policies with classical control.');
          line([['t-info', 'more: '], ['t-cmd', 'cd about', () => go('about')]]);
          return;
        }
        line([['t-err', `cat: ${args[0] || ''}: no such file`], ['t-info', '  (try now.txt or skills.txt)']]);
      },
      open(args) {
        const f = (args[0] || '').toLowerCase();
        const targets = {
          'resume.pdf': 'resume.pdf', resume: 'resume.pdf',
          github: 'https://github.com/NotMax08',
          linkedin: 'https://linkedin.com/in/max-yuan-a0b34b36b',
        };
        if (!targets[f]) { line([['t-err', `open: ${args[0] || '(nothing)'}: not found`], ['t-info', '  (resume.pdf, github, linkedin)']]); return; }
        line([['t-info', `opening ${f} in a new tab`]]);
        openTab(targets[f]);
      },
      whoami() { line([['t-cmd', 'Max Yuan · Mechatronics Engineering @ UWaterloo']]); },
      pwd() { line('/home/max'); },
      date() { line(new Date().toString()); },
      echo(args, rawArgs) { line(rawArgs); },
      email() {
        copyEmail().then(ok => line(ok ? [['t-ok', '✓ '], ['', `${EMAIL} copied to clipboard`]] : [['t-info', 'opening your mail app']]));
      },
      history() { history.forEach((h, i) => line([['t-dim', `${String(i + 1).padStart(4)}  `], ['', h]])); },
      clear() { $$('.term-line:not(.term-input-line)', body).forEach(l => l.remove()); },
      sudo(args) {
        if (args.join(' ').toLowerCase() === 'hire max') {
          line([['t-dim', '[sudo] password for recruiter: ********']]);
          line([['t-ok', 'access granted ✓'], ['t-info', ' opening '], ['t-tag', '~/contact'], ['t-info', ' …']]);
          setTimeout(() => go('contact'), reduceMotion.matches ? 0 : 700);
          return;
        }
        line([['t-err', 'sudo: permission denied'], ['t-info', '  (try: sudo hire max)']]);
      },
    };
    COMMANDS.resume = () => COMMANDS.open(['resume.pdf']);
    COMMANDS.contact = () => COMMANDS.cd(['contact']);

    function run(raw, silent) {
      const v = raw.trim();
      if (!silent) echo(raw);
      if (!v) return;
      history.push(v);
      histIndex = history.length;
      const [name, ...args] = v.split(/\s+/);
      const fn = COMMANDS[name.toLowerCase()];
      if (!fn) {
        const section = SECTIONS.find(s => s === name.toLowerCase());
        if (section) { COMMANDS.cd([section]); return; }
        line([['t-err', `zsh: command not found: ${name}`], ['t-info', '  (try help)']]);
        say(`Command not found: ${name}. Try help.`);
        return;
      }
      fn(args, v.slice(name.length).trim());
    }

    // hint chips type their command in, then run it
    $$('[data-cmd]', hints || document).forEach(btn => btn.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      if (booting) { skip = true; while (booting) await new Promise(r => setTimeout(r, 20)); }
      const cmd = btn.dataset.cmd;
      if (reduceMotion.matches) input.value = cmd;
      else {
        input.value = '';
        for (const ch of cmd) { input.value += ch; input._place(); await new Promise(r => setTimeout(r, 22)); }
      }
      await new Promise(r => setTimeout(r, 120));
      input.value = '';
      input._place();
      run(cmd);
      busy = false;
    }));

    // clicking the terminal skips the intro, or focuses the prompt
    body.addEventListener('click', e => {
      if (booting) { skip = true; return; }
      if (e.target.closest('.t-link') || window.getSelection().toString()) return;
      input?.focus({ preventScroll: true });
    });

    boot();
  }

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

    initTerminal();
  } else {
    initReveal();
  }
})();
