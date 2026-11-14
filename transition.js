/* =========================================================
   Max Yuan · "imagining the future"
   Opening a project plays a small world-action-model act: the page
   samples a few imagined trajectories from where you clicked, the
   screen drops into a dark latent space, and the model "predicts"
   the next frames of the page you asked for (dithered noise that
   sharpens into the project's picture). The last frame grows to
   fill the screen and the project page dissolves in from it.
   Shared by every page. window.wamImagine(href, opts) starts it.
   ========================================================= */

(() => {
  'use strict';

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ROOT = document.documentElement.dataset.root || '';
  const LIME = '#c2f04f';
  const KEY = 'wam-arrive';

  // where each project lives, and the frame its future resolves to
  const FUTURES = {
    'pi05-pick-place': { title: 'π₀.5 pick and place', key: 'pi05' },
    'brackey-way': { title: 'The Brackey Way', key: 'brackey' },
    'quadruped-ppo': { title: 'Go2 locomotion', key: 'quad' },
    'maze-nav2': { title: 'Maze navigation', key: 'nav' },
    'rico-arm': { title: 'RICO', key: 'rico' },
    'ftc-18844': { title: 'FTC team 18844', key: 'ftc' },
  };
  function futureOf(href) {
    let url;
    try { url = new URL(href, location.href); } catch (e) { return null; }
    if (url.origin !== location.origin) return null;
    const m = url.pathname.match(/projects\/([\w-]+)\.html$/);
    if (!m || !FUTURES[m[1]]) return null;
    if (url.pathname === location.pathname) return null;
    const f = FUTURES[m[1]];
    return { href: url.href, title: f.title, poster: new URL(`${ROOT}assets/loops/${f.key}.jpg`, location.href).href };
  }

  /* ---------- styles (kept here so every page, the 3D one too, gets them) ---------- */

  const css = `
  .wam{position:fixed;inset:0;z-index:2147483000;pointer-events:auto;font-family:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;color:#d9d9d2;cursor:progress}
  .wam canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
  .wam-noise{image-rendering:pixelated;opacity:0;transition:opacity .35s ease}
  .wam.is-dark .wam-noise{opacity:1}
  .wam-scan{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .35s;
    background:repeating-linear-gradient(to bottom,rgba(255,255,255,.035) 0 1px,transparent 1px 3px),
      radial-gradient(ellipse at center,transparent 45%,rgba(0,0,0,.65) 100%)}
  .wam.is-dark .wam-scan{opacity:1}
  .wam-panel{position:absolute;left:50%;top:50%;width:min(860px,calc(100vw - 40px));transform:translate(-50%,-50%);opacity:0;transition:opacity .3s ease}
  .wam.is-dark .wam-panel{opacity:1}
  .wam-title{margin:0 0 14px;font-family:"Silkscreen","JetBrains Mono",monospace;font-size:clamp(22px,4.4vw,44px);line-height:1;letter-spacing:.02em;color:#f3f3ec;
    text-shadow:2px 0 rgba(255,60,120,.55),-2px 0 rgba(60,220,255,.45)}
  .wam-title i{font-style:normal;color:${LIME};animation:wam-blink .8s steps(1) infinite}
  .wam-log{margin:0 0 22px;min-height:5.4em;font-size:12px;line-height:1.5;color:#9d9d94;white-space:pre-wrap}
  .wam-log b{font-weight:500;color:${LIME}}
  .wam-strip{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}
  .wam-frame{position:relative;margin:0}
  .wam-frame canvas{position:relative;width:100%;height:auto;aspect-ratio:16/10;image-rendering:pixelated;background:#050505;border:1px solid rgba(194,240,79,.18);opacity:0;transition:opacity .15s}
  .wam-frame.is-on canvas{opacity:1}
  .wam-frame.is-pick canvas{border-color:${LIME};box-shadow:0 0 0 1px ${LIME},0 0 24px rgba(194,240,79,.25)}
  .wam-frame figcaption{margin-top:6px;font-size:10px;color:#6f6f68;letter-spacing:.06em}
  .wam-frame.is-on figcaption{color:#a8a89e}
  .wam-frame.is-pick figcaption{color:${LIME}}
  .wam-grow{position:fixed;background:#000 center/cover no-repeat;image-rendering:auto;z-index:2;transition:all .55s cubic-bezier(.7,0,.2,1)}
  .wam-skip{position:absolute;right:18px;bottom:16px;font-size:11px;color:#6f6f68;opacity:0;transition:opacity .3s}
  .wam.is-dark .wam-skip{opacity:1}
  .wam-tag{position:absolute;left:18px;top:16px;font-size:11px;letter-spacing:.06em;color:${LIME};text-shadow:0 1px 2px rgba(0,0,0,.6)}
  @keyframes wam-blink{50%{opacity:0}}
  @media (max-width:640px){.wam-strip{grid-template-columns:repeat(3,minmax(0,1fr))}.wam-log{font-size:11px}}
  html.wam-arriving,html.wam-arriving body{background:#0b0b0c!important}
  html.wam-arriving body>*:not(.wam){visibility:hidden}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);

  /* ---------- helpers ---------- */

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const loadImage = src => new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  const imgCache = new Map();
  const getImage = src => {
    if (!imgCache.has(src)) imgCache.set(src, loadImage(src).catch(() => null));
    return imgCache.get(src);
  };
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);

  // animated static, drawn small and scaled up
  function startNoise(canvas) {
    const ctx = canvas.getContext('2d');
    let raf = 0;
    const draw = () => {
      const w = Math.ceil(window.innerWidth / 3);
      const h = Math.ceil(window.innerHeight / 3);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      const img = ctx.createImageData(w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = Math.random();
        const v = r < 0.86 ? 8 + r * 22 : 40 + Math.random() * 90;
        d[i] = v; d[i + 1] = v; d[i + 2] = v * 0.96; d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }

  // imagined trajectories: a fan of noisy paths from the click towards the strip
  function drawTraces(canvas, from, to, dur) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const K = 9;
    const pick = 4;
    const paths = Array.from({ length: K }, (_, k) => {
      const pts = [];
      const spread = k === pick ? 0 : rand(-1, 1);
      let x = from.x;
      let y = from.y;
      let vx = (to.x - from.x) / 40 + spread * rand(2, 9);
      let vy = (to.y - from.y) / 40 + spread * rand(-8, 8);
      for (let s = 0; s < 46; s += 1) {
        const t = s / 45;
        const goal = k === pick ? 1 : 0.35;      // the chosen one is pulled to the goal
        vx += ((to.x - x) * 0.012 * goal) + rand(-1.2, 1.2) * (1 - t * goal);
        vy += ((to.y - y) * 0.012 * goal) + rand(-1.2, 1.2) * (1 - t * goal);
        vx *= 0.9;
        vy *= 0.9;
        x += vx;
        y += vy;
        pts.push([x, y]);
      }
      if (k === pick) pts.push([to.x, to.y]);
      return pts;
    });
    const t0 = performance.now();
    return new Promise(resolve => {
      const step = now => {
        const k = Math.min(1, (now - t0) / dur);
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        paths.forEach((pts, i) => {
          const n = Math.max(2, Math.floor(pts.length * k));
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          for (let j = 0; j < n; j += 1) ctx.lineTo(pts[j][0], pts[j][1]);
          const chosen = i === pick;
          ctx.strokeStyle = chosen ? LIME : 'rgba(194,240,79,.38)';
          ctx.lineWidth = chosen ? 2 : 1;
          ctx.setLineDash(chosen ? [] : [3, 4]);
          ctx.stroke();
          const [ex, ey] = pts[n - 1];
          ctx.fillStyle = chosen ? LIME : 'rgba(194,240,79,.6)';
          ctx.fillRect(ex - 2, ey - 2, 4, 4);
        });
        ctx.setLineDash([]);
        ctx.fillStyle = LIME;
        ctx.beginPath();
        ctx.arc(from.x, from.y, 4, 0, Math.PI * 2);
        ctx.fill();
        if (k < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  // one predicted frame: the picture, dithered and blocky early on, clean at the end
  function renderFrame(canvas, img, level, seed) {
    const W = 160;
    const H = 100;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const block = Math.max(1, Math.round(10 * (1 - level) ** 1.6));
    const w = Math.ceil(W / block);
    const h = Math.ceil(H / block);
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const sctx = small.getContext('2d');
    if (img) {
      // cover-fit the picture
      const ir = img.width / img.height;
      const fr = W / H;
      let sw = img.width;
      let sh = img.height;
      if (ir > fr) sw = img.height * fr; else sh = img.width / fr;
      sctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h);
    }
    const data = sctx.getImageData(0, 0, w, h);
    const d = data.data;
    const noise = (1 - level) ** 1.2;
    const dither = level < 0.55;
    let s = seed;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        let r = img ? d[i] : 40;
        let g = img ? d[i + 1] : 40;
        let b = img ? d[i + 2] : 40;
        const n = (rnd() - 0.5) * 255 * noise;
        if (dither) {
          // two-tone lime on black, Bayer dithered
          const lum = (0.3 * r + 0.59 * g + 0.11 * b + n) / 255;
          const on = lum > BAYER[(y % 4) * 4 + (x % 4)];
          r = on ? 194 : 6; g = on ? 240 : 8; b = on ? 79 : 6;
        } else {
          const k = (level - 0.55) / 0.45;     // colour fades in
          const lum = 0.3 * r + 0.59 * g + 0.11 * b;
          r = lum + (r - lum) * k + n;
          g = lum + (g - lum) * k + n;
          b = lum + (b - lum) * k + n;
        }
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
      }
    }
    sctx.putImageData(data, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, w * block, h * block);
  }

  function typeLines(el, lines, perChar = 9) {
    let cancelled = false;
    const run = (async () => {
      const plain = document.createElement('span');
      for (const line of lines) {
        const span = document.createElement('span');
        el.append(span, '\n');
        plain.innerHTML = line;            // type the text, then swap in the markup
        const text = plain.textContent;
        for (let i = 1; i <= text.length && !cancelled; i += 2) {
          span.textContent = text.slice(0, i);
          await sleep(perChar);
        }
        span.innerHTML = line;
      }
    })();
    return { run, stop: () => { cancelled = true; } };
  }

  /* ---------- the act ---------- */

  let busy = false;

  async function imagine(href, opts = {}) {
    const fut = futureOf(href);
    if (!fut || busy) { if (!busy) location.href = href; return; }
    if (reduce) { location.href = fut.href; return; }
    busy = true;
    const title = opts.title || fut.title;
    const imgP = getImage(fut.poster);
    const from = opts.from || { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    const root = document.createElement('div');
    root.className = 'wam';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'assertive');
    root.innerHTML = `
      <canvas class="wam-noise" aria-hidden="true"></canvas>
      <div class="wam-scan" aria-hidden="true"></div>
      <canvas class="wam-trace" aria-hidden="true"></canvas>
      <div class="wam-panel">
        <p class="wam-title">IMAGINING THE FUTURE<i>_</i></p>
        <pre class="wam-log"></pre>
        <div class="wam-strip">${[1, 2, 3, 4, 5, 6].map(k => `<figure class="wam-frame"><canvas></canvas><figcaption>t+${k}</figcaption></figure>`).join('')}</div>
      </div>
      <p class="wam-skip">click to skip</p>`;
    document.body.append(root);
    const go = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ poster: fut.poster, title, t: Date.now() })); } catch (e) { /* private mode */ } location.href = fut.href; };
    let skipped = false;
    root.addEventListener('click', () => { skipped = true; go(); });
    const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') { skipped = true; go(); } };
    window.addEventListener('keydown', onKey);

    const traceCanvas = root.querySelector('.wam-trace');
    const strip = root.querySelector('.wam-strip');
    const frames = [...root.querySelectorAll('.wam-frame')];

    // 1. sample a few futures from where the visitor acted
    if (!opts.skipTraces) {
      const target = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.62 };
      await drawTraces(traceCanvas, from, target, 520);
    }
    if (skipped) return;
    // 2. drop into the latent space
    const stopNoise = startNoise(root.querySelector('.wam-noise'));
    root.classList.add('is-dark');
    traceCanvas.style.transition = 'opacity .5s';
    traceCanvas.style.opacity = '0.35';
    const name = title.replace(/</g, '&lt;');
    const log = typeLines(root.querySelector('.wam-log'), [
      `&gt; wam.imagine(action=<b>"open ${name}"</b>)`,
      '&gt; encoding observation .......... ok',
      '&gt; sampling 8 rollouts · horizon 6 frames',
      `&gt; rollout 5 · p(goal) 0.97 <b>← chosen</b>`,
    ]);
    const img = await imgP;
    if (skipped) return;
    // 3. predict the frames: each one starts as noise and sharpens a little more than the last
    const seed0 = Math.floor(Math.random() * 1e6) + 1;
    for (let f = 0; f < frames.length; f += 1) {
      if (skipped) return;
      const fig = frames[f];
      const canvas = fig.querySelector('canvas');
      fig.classList.add('is-on');
      const target = (f + 1) / frames.length;
      const steps = 4;
      for (let s = 1; s <= steps; s += 1) {
        renderFrame(canvas, img, target * (0.55 + 0.45 * (s / steps)), seed0 + f * 97 + s);
        await sleep(38);
      }
    }
    await log.run;
    const last = frames[frames.length - 1];
    last.classList.add('is-pick');
    await sleep(260);
    if (skipped) return;
    // 4. the chosen frame becomes the page
    const r = last.querySelector('canvas').getBoundingClientRect();
    const grow = document.createElement('div');
    grow.className = 'wam-grow';
    grow.style.backgroundImage = `url("${fut.poster}")`;
    Object.assign(grow.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    root.append(grow);
    grow.getBoundingClientRect();
    Object.assign(grow.style, { left: '0px', top: '0px', width: '100vw', height: '100vh' });
    strip.style.opacity = '0';
    await sleep(560);
    stopNoise();
    log.stop();
    window.removeEventListener('keydown', onKey);
    if (!skipped) go();
  }
  window.wamImagine = imagine;

  /* ---------- links to projects play it ---------- */

  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    if (!futureOf(a.href)) return;
    e.preventDefault();
    imagine(a.href, { from: { x: e.clientX || window.innerWidth / 2, y: e.clientY || window.innerHeight / 2 } });
  });
  // warm the picture while the pointer is on its way
  document.addEventListener('pointerover', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    const fut = a && futureOf(a.href);
    if (fut) getImage(fut.poster);
  }, { passive: true });

  /* ---------- arriving: the predicted frame dissolves into the real page ---------- */

  function arrive() {
    let data = null;
    try {
      data = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      sessionStorage.removeItem(KEY);
    } catch (e) { /* private mode */ }
    const html = document.documentElement;
    if (!data || Date.now() - data.t > 8000 || reduce) { html.classList.remove('wam-arriving'); return; }
    const root = document.createElement('div');
    root.className = 'wam';
    root.style.cursor = 'auto';
    root.innerHTML = '<canvas aria-hidden="true"></canvas><p class="wam-tag">future reached · t+6</p>';
    document.body.append(root);
    const canvas = root.querySelector('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#0b0b0c';
    ctx.fillRect(0, 0, W, H);
    html.classList.remove('wam-arriving');
    getImage(data.poster).then(img => {
      if (img) {
        const ir = img.width / img.height;
        const fr = W / H;
        let sw = img.width;
        let sh = img.height;
        if (ir > fr) sw = img.height * fr; else sh = img.width / fr;
        ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, W, H);
      }
      // dissolve in blocks, in a shuffled order
      const B = 28;
      const cols = Math.ceil(W / B);
      const rows = Math.ceil(H / B);
      const order = Array.from({ length: cols * rows }, (_, i) => i);
      for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const t0 = performance.now();
      const dur = 620;
      let done = 0;
      const step = now => {
        const k = Math.min(1, (now - t0) / dur);
        const target = Math.floor(order.length * k * k);
        for (; done < target; done += 1) {
          const c = order[done] % cols;
          const r = Math.floor(order[done] / cols);
          ctx.clearRect(c * B, r * B, B, B);
        }
        if (k < 1) requestAnimationFrame(step); else root.remove();
      };
      setTimeout(() => requestAnimationFrame(step), 160);
    });
  }
  arrive();

  // coming back with the back button: drop any leftover overlay
  window.addEventListener('pageshow', e => {
    if (e.persisted) {
      document.querySelectorAll('.wam').forEach(n => n.remove());
      busy = false;
    }
  });
})();
