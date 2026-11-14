/* =========================================================
   Max Yuan · "imagining the future"
   Opening a project plays a small world-action-model act:

     1. the card you clicked grows to fill the screen and dissolves
        into noise (the forward process: the present, encoded)
     2. a fan of imagined trajectories grows from your cursor
     3. in the dark, the model samples a few rollouts and denoises
        each one's next frames together, coarse to fine. They all
        start from the same present; the wrong ones drift towards
        other projects, the right one towards the page you asked for
     4. the rollouts are scored; the losers fade, the winner replays
     5. its last frame grows to fill the screen and sharpens, and the
        real page comes into focus underneath it

   Neutral greys and one blue, the same as the rest of the site.
   Click, Esc or Enter skips. Reduced motion goes straight there.
   Shared by every page. window.wamImagine(href, opts) starts it.
   ========================================================= */

(() => {
  'use strict';

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ROOT = document.documentElement.dataset.root || '';
  const KEY = 'wam-arrive';
  const BLUE = '#6ea8ff';
  const blueA = a => `rgba(110,168,255,${a})`;

  // where each project lives, and the frame its future resolves to
  const FUTURES = {
    'pi05-pick-place': { title: 'π₀.5 pick and place', key: 'pi05' },
    'brackey-way': { title: 'The Brackey Way', key: 'brackey' },
    'quadruped-ppo': { title: 'Go2 locomotion', key: 'quad' },
    'maze-nav2': { title: 'Maze navigation', key: 'nav' },
    'rico-arm': { title: 'RICO', key: 'rico' },
    'ftc-18844': { title: 'FTC team 18844', key: 'ftc' },
  };
  const posterOf = key => new URL(`${ROOT}assets/loops/${key}.jpg`, location.href).href;
  const ALL_KEYS = Object.values(FUTURES).map(f => f.key);

  function futureOf(href) {
    let url;
    try { url = new URL(href, location.href); } catch (e) { return null; }
    if (url.origin !== location.origin) return null;
    const m = url.pathname.match(/projects\/([\w-]+)\.html$/);
    if (!m || !FUTURES[m[1]]) return null;
    if (url.pathname === location.pathname) return null;
    const f = FUTURES[m[1]];
    return { href: url.href, title: f.title, key: f.key, poster: posterOf(f.key) };
  }

  /* ---------- styles (kept here so every page gets them) ---------- */

  const style = document.createElement('style');
  style.textContent = `
  .wam{position:fixed;inset:0;z-index:2147483000;pointer-events:auto;cursor:progress;
    font-family:"Geist","Geist Fallback",system-ui,sans-serif;color:#fafafa;-webkit-font-smoothing:antialiased}
  .wam canvas{display:block}
  .wam-bg{position:fixed;overflow:hidden;background:#0a0a0a;border-radius:16px;
    transition:left .7s cubic-bezier(.7,0,.2,1),top .7s cubic-bezier(.7,0,.2,1),width .7s cubic-bezier(.7,0,.2,1),height .7s cubic-bezier(.7,0,.2,1),border-radius .7s cubic-bezier(.7,0,.2,1)}
  .wam-bg::after{content:"";position:absolute;inset:-20%;opacity:0;transition:opacity 1s ease;
    background:radial-gradient(45% 40% at 50% 46%,rgba(47,111,228,.16),transparent 70%),radial-gradient(30% 30% at 70% 70%,rgba(110,168,255,.07),transparent 70%);
    animation:wam-drift 9s ease-in-out infinite alternate}
  .wam.is-dark .wam-bg::after{opacity:1}
  .wam-enc{position:absolute;inset:0;width:100%;height:100%;transition:opacity .5s ease}
  .wam-trace{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
  .wam-panel{position:absolute;left:50%;top:50%;width:min(980px,calc(100vw - 32px));transform:translate(-50%,-48%);opacity:0;transition:opacity .45s ease,transform .6s cubic-bezier(.2,.7,.2,1)}
  .wam.is-dark .wam-panel{opacity:1;transform:translate(-50%,-50%)}
  .wam-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:28px;align-items:end;margin-bottom:20px}
  .wam-title{margin:0 0 12px;font-size:clamp(24px,3.6vw,36px);font-weight:500;line-height:1.1;letter-spacing:-.025em;color:#fafafa}
  .wam-title i{font-style:normal;display:inline-block;color:${BLUE};animation:wam-dot 1.2s ease-in-out infinite}
  .wam-title i:nth-child(2){animation-delay:.15s}
  .wam-title i:nth-child(3){animation-delay:.3s}
  .wam-log{margin:0;min-height:8em;font:12px/1.6 "Geist Mono",ui-monospace,monospace;color:#8a8a8a;white-space:pre-wrap}
  .wam-log b{font-weight:500;color:${BLUE}}
  .wam-z{display:grid;grid-template-columns:repeat(16,6px);gap:4px}
  .wam-z i{width:6px;height:6px;border-radius:50%;background:#222;transition:background-color .25s,box-shadow .25s}
  .wam-z i.h{background:#3a3a3d}
  .wam-z i.on{background:${BLUE};box-shadow:0 0 6px ${blueA(0.7)}}
  .wam-cap{margin:8px 0 0;font:10px/1.4 "Geist Mono",ui-monospace,monospace;color:#525252;text-align:right}
  .wam-prog{display:flex;align-items:center;gap:14px;margin:0 0 14px;font:11px/1 "Geist Mono",ui-monospace,monospace;color:#737373}
  .wam-prog-bar{flex:1;height:2px;border-radius:2px;background:#1f1f1f;overflow:hidden}
  .wam-prog-bar i{display:block;height:100%;width:0;border-radius:2px;background:linear-gradient(90deg,#2f6fe4,${BLUE});box-shadow:0 0 10px ${blueA(0.7)}}
  .wam-prog-txt{min-width:10em;text-align:right}
  .wam-row{display:grid;grid-template-columns:72px repeat(var(--F),minmax(0,1fr)) 92px;gap:8px;align-items:center;margin-bottom:8px;transition:opacity .5s ease,filter .5s ease}
  .wam-row>label{font:11px/1 "Geist Mono",ui-monospace,monospace;color:#737373}
  .wam-cell canvas{width:100%;height:auto;aspect-ratio:16/10;border-radius:6px;background:#141414;opacity:0;transform:scale(.94);
    transition:opacity .25s ease,transform .35s cubic-bezier(.2,.7,.2,1),box-shadow .3s ease}
  .wam-cell.on canvas{opacity:1;transform:none}
  .wam-score{display:flex;align-items:center;justify-content:flex-end;gap:8px;font:11px/1 "Geist Mono",ui-monospace,monospace;color:#737373}
  .wam-meter{width:38px;height:3px;border-radius:2px;background:#222;overflow:hidden}
  .wam-meter i{display:block;height:100%;width:0;background:#8a8a8a;border-radius:2px}
  .wam-row.lose{opacity:.26;filter:grayscale(1)}
  .wam-row.win>label,.wam-row.win .wam-score{color:#fafafa}
  .wam-row.win .wam-meter i{background:${BLUE};box-shadow:0 0 8px ${blueA(0.8)}}
  .wam-row.win .wam-cell canvas{box-shadow:0 0 0 1px ${blueA(0.45)}}
  .wam-row.win .wam-cell.play canvas{transform:scale(1.07);box-shadow:0 0 0 1.5px ${BLUE},0 0 26px ${blueA(0.45)}}
  .wam-axis{margin:4px 0 0}
  .wam-axis span{font:10px/1 "Geist Mono",ui-monospace,monospace;color:#525252;text-align:center}
  .wam-grow{position:fixed;z-index:3;border-radius:6px;background:#141414;box-shadow:0 0 0 1.5px ${BLUE},0 0 40px ${blueA(0.4)};
    transition:left .65s cubic-bezier(.7,0,.2,1),top .65s cubic-bezier(.7,0,.2,1),width .65s cubic-bezier(.7,0,.2,1),height .65s cubic-bezier(.7,0,.2,1),border-radius .65s ease,box-shadow .65s ease}
  .wam-skip{position:absolute;right:18px;bottom:16px;margin:0;font:11px/1 "Geist Mono",ui-monospace,monospace;color:#525252;opacity:0;transition:opacity .3s}
  .wam.is-dark .wam-skip{opacity:1}
  .wam-tag{position:absolute;left:18px;top:16px;z-index:4;margin:0;display:flex;align-items:center;gap:8px;font:11px/1 "Geist Mono",ui-monospace,monospace;color:#fafafa;text-shadow:0 1px 6px rgba(0,0,0,.6)}
  .wam-tag::before{content:"";width:6px;height:6px;border-radius:50%;background:${BLUE};box-shadow:0 0 8px ${BLUE}}
  @keyframes wam-dot{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-3px)}}
  @keyframes wam-drift{from{transform:translate(-3%,-2%)}to{transform:translate(3%,2%)}}
  @media (max-width:640px){
    .wam-head{grid-template-columns:minmax(0,1fr)}
    .wam-zbox{display:none}
    .wam-log{font-size:10.5px;min-height:9em}
    .wam-row{grid-template-columns:24px repeat(var(--F),minmax(0,1fr)) 34px;gap:5px}
    .wam-meter{display:none}
  }
  html.wam-arriving,html.wam-arriving body{background:#0a0a0a!important}
  html.wam-arriving body>*:not(.wam){visibility:hidden}
  html.wam-focus body>*:not(.wam){filter:blur(14px);opacity:0}
  html.wam-focusing body>*:not(.wam){transition:filter .9s cubic-bezier(.2,.7,.2,1),opacity .7s ease}
  `;
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
  const gauss = () => {
    const u = Math.random() || 1e-6;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2831853 * Math.random());
  };

  function cropOf(img, fr, view) {
    let sw = img.width;
    let sh = img.height;
    if (img.width / img.height > fr) sw = img.height * fr; else sh = img.width / fr;
    sw /= view.z;
    sh /= view.z;
    const sx = Math.max(0, Math.min(img.width - sw, view.cx * img.width - sw / 2));
    const sy = Math.max(0, Math.min(img.height - sh, view.cy * img.height - sh / 2));
    return [sx, sy, sw, sh];
  }
  const FULL = { cx: 0.5, cy: 0.5, z: 1 };

  // a tile of fine grain, laid over noisy frames so they shimmer
  const grain = document.createElement('canvas');
  grain.width = grain.height = 128;
  (() => {
    const c = grain.getContext('2d');
    const d = c.createImageData(128, 128);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = Math.max(0, Math.min(255, 128 + gauss() * 70));
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = 255;
    }
    c.putImageData(d, 0, 0);
  })();

  /* ---------- one frame of a diffusion sample ----------
     level 0 is pure noise, 1 is the picture. The picture is drawn
     small and scaled up (so it comes back coarse to fine), mixed with
     Gaussian noise as in the forward process with a cosine schedule,
     and drifts towards a cool grey while it is noisy.            */

  const scratch = document.createElement('canvas');
  const sctx = scratch.getContext('2d', { willReadFrequently: true });

  function paint(canvas, o) {
    const { W, H } = o;
    const level = Math.max(0, Math.min(1, o.level));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext('2d');
    const t = 1 - level;
    const scale = Math.max(0.035, level ** 2.3);
    const w = Math.max(3, Math.round(W * scale));
    const h = Math.max(2, Math.round(H * scale));
    scratch.width = w;
    scratch.height = h;
    sctx.globalAlpha = 1;
    sctx.fillStyle = '#26272b';
    sctx.fillRect(0, 0, w, h);
    sctx.imageSmoothingQuality = 'high';
    if (o.img) sctx.drawImage(o.img, ...cropOf(o.img, W / H, o.view || FULL), 0, 0, w, h);
    if (o.alt && o.mix > 0) {
      sctx.globalAlpha = o.mix;
      sctx.drawImage(o.alt, ...cropOf(o.alt, W / H, o.altView || FULL), 0, 0, w, h);
      sctx.globalAlpha = 1;
    }
    if (t > 0.001) {
      const a = Math.cos(t * Math.PI / 2) ** 2;
      const sa = Math.sqrt(a);
      const sn = Math.sqrt(1 - a) * 0.5;
      const data = sctx.getImageData(0, 0, w, h);
      const d = data.data;
      const grey = Math.min(0.85, t * 0.8);
      for (let i = 0; i < d.length; i += 4) {
        const e = gauss();
        let r = sa * (d[i] / 127.5 - 1) + sn * (e + gauss() * 0.1);
        let g = sa * (d[i + 1] / 127.5 - 1) + sn * (e + gauss() * 0.1);
        let b = sa * (d[i + 2] / 127.5 - 1) + sn * (e + gauss() * 0.1);
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        r += (l * 0.95 - r) * grey;
        g += (l * 0.99 - g) * grey;
        b += (l * 1.06 - b) * grey;
        d[i] = (r + 1) * 127.5;
        d[i + 1] = (g + 1) * 127.5;
        d[i + 2] = (b + 1) * 127.5;
      }
      sctx.putImageData(data, 0, 0);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(scratch, 0, 0, W, H);
    if (t > 0.04) {
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = Math.min(0.55, t * 0.7);
      const ox = Math.floor(Math.random() * 128);
      const oy = Math.floor(Math.random() * 128);
      for (let y = -oy; y < H; y += 128) for (let x = -ox; x < W; x += 128) ctx.drawImage(grain, x, y);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  // imagined trajectories: a fan of smooth noisy paths from the cursor towards the goal
  function drawTraces(canvas, from, to, dur, K = 14) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const pick = Math.floor(K / 2);
    const paths = Array.from({ length: K }, (_, k) => {
      const pts = [];
      const spread = k === pick ? 0 : rand(-1, 1);
      let x = from.x;
      let y = from.y;
      let vx = (to.x - from.x) / 40 + spread * rand(2, 10);
      let vy = (to.y - from.y) / 40 + spread * rand(-9, 9);
      for (let s = 0; s < 54; s += 1) {
        const tt = s / 53;
        const pull = k === pick ? 1 : 0.3;
        vx += ((to.x - x) * 0.012 * pull) + rand(-1.1, 1.1) * (1 - tt * pull);
        vy += ((to.y - y) * 0.012 * pull) + rand(-1.1, 1.1) * (1 - tt * pull);
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
        const e = 1 - (1 - k) ** 3;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        paths.forEach((pts, i) => {
          const n = Math.max(2, Math.floor(pts.length * e));
          const chosen = i === pick;
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          for (let j = 0; j < n; j += 1) ctx.lineTo(pts[j][0], pts[j][1]);
          ctx.strokeStyle = chosen ? '#ffffff' : blueA(0.38);
          ctx.lineWidth = chosen ? 2 : 1.2;
          ctx.shadowColor = chosen ? blueA(1) : blueA(0.5);
          ctx.shadowBlur = chosen ? 14 : 6;
          ctx.stroke();
          ctx.shadowBlur = 0;
          const [ex, ey] = pts[n - 1];
          ctx.fillStyle = chosen ? '#ffffff' : blueA(0.7);
          ctx.beginPath();
          ctx.arc(ex, ey, chosen ? 3 : 2, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.strokeStyle = blueA(0.9);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(from.x, from.y, 6 + 10 * e, 0, Math.PI * 2);
        ctx.globalAlpha = 1 - e;
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (k < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  function typeLine(el, html, perChar = 9) {
    const line = document.createElement('span');
    el.append(line, '\n');
    const tmp = document.createElement('span');
    tmp.innerHTML = html;                 // type the text, then swap in the markup
    const text = tmp.textContent;
    return (async () => {
      for (let i = 1; i <= text.length; i += 2) {
        line.textContent = text.slice(0, i);
        await sleep(perChar);
      }
      line.innerHTML = html;
      return line;
    })();
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
    // the wrong rollouts drift towards the other projects
    const others = ALL_KEYS.filter(k => k !== fut.key).sort(() => Math.random() - 0.5);
    const altP = Promise.all(others.map(k => getImage(posterOf(k))));
    const VW = window.innerWidth;
    const VH = window.innerHeight;
    const from = opts.from || { x: VW / 2, y: VH / 2 };
    const src = opts.rect || { left: from.x - 4, top: from.y - 4, width: 8, height: 8 };

    const narrow = VW < 640;
    const F = narrow ? 4 : 8;                          // frames per rollout
    const R = narrow || VH < 640 ? 3 : 4;             // rollouts
    const STEPS = 4;                                   // denoising steps per frame
    const win = Math.floor(Math.random() * R);

    const root = document.createElement('div');
    root.className = 'wam';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'assertive');
    const cells = Array.from({ length: F }, () => '<span class="wam-cell"><canvas></canvas></span>').join('');
    root.innerHTML = `
      <div class="wam-bg" aria-hidden="true"><canvas class="wam-enc"></canvas></div>
      <canvas class="wam-trace" aria-hidden="true"></canvas>
      <div class="wam-panel">
        <div class="wam-head">
          <div>
            <p class="wam-title">Imagining the future<i>.</i><i>.</i><i>.</i></p>
            <pre class="wam-log"></pre>
          </div>
          <div class="wam-zbox" aria-hidden="true"><div class="wam-z">${'<i></i>'.repeat(96)}</div><p class="wam-cap">z_t · 96 tokens</p></div>
        </div>
        <div class="wam-prog" aria-hidden="true"><span class="wam-prog-bar"><i></i></span><span class="wam-prog-txt">denoising 0/${F * STEPS}</span></div>
        <div class="wam-grid" aria-hidden="true">
          ${Array.from({ length: R }, (_, r) => `<div class="wam-row" style="--F:${F}"><label>${narrow ? '' : 'rollout '}${r + 1}</label>${cells}<span class="wam-score"><span class="wam-meter"><i></i></span><span class="num">—</span></span></div>`).join('')}
          <div class="wam-row wam-axis" style="--F:${F}"><span></span>${Array.from({ length: F }, (_, f) => `<span>t+${f + 1}</span>`).join('')}<span></span></div>
        </div>
      </div>
      <p class="wam-skip">click to skip</p>`;
    document.body.append(root);

    let skipped = false;
    const go = () => {
      try { sessionStorage.setItem(KEY, JSON.stringify({ poster: fut.poster, title, t: Date.now() })); } catch (e) { /* private mode */ }
      location.href = fut.href;
    };
    const skip = () => { if (skipped) return; skipped = true; go(); };
    root.addEventListener('click', skip);
    const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') skip(); };
    window.addEventListener('keydown', onKey);

    const bg = root.querySelector('.wam-bg');
    const enc = root.querySelector('.wam-enc');
    const traceCanvas = root.querySelector('.wam-trace');
    const logEl = root.querySelector('.wam-log');
    const rows = [...root.querySelectorAll('.wam-row:not(.wam-axis)')];
    const grid = rows.map(row => [...row.querySelectorAll('.wam-cell')]);
    const progBar = root.querySelector('.wam-prog-bar i');
    const progTxt = root.querySelector('.wam-prog-txt');
    const name = title.replace(/</g, '&lt;');

    // 1. the clicked card grows to fill the screen, and the present dissolves into noise
    Object.assign(bg.style, { left: `${src.left}px`, top: `${src.top}px`, width: `${src.width}px`, height: `${src.height}px` });
    const img = await Promise.race([imgP, sleep(250).then(() => null)]) || null;
    const encode = (async () => {
      if (!img || src.width < 40) { enc.style.opacity = '0'; return; }
      const EW = Math.ceil(VW / 3);
      const EH = Math.ceil(VH / 3);
      for (const level of [1, 0.9, 0.78, 0.64, 0.5, 0.38, 0.26, 0.16]) {
        paint(enc, { W: EW, H: EH, img, level });
        await sleep(70);
      }
      enc.style.opacity = '0';
    })();
    bg.getBoundingClientRect();
    Object.assign(bg.style, { left: '0px', top: '0px', width: `${VW}px`, height: `${VH}px`, borderRadius: '0px' });

    // 2. a few futures, sampled from where the visitor acted
    if (!opts.skipTraces) await drawTraces(traceCanvas, from, { x: VW * 0.5, y: VH * 0.58 }, 900);
    else await sleep(700);
    await encode;
    if (skipped) return;

    // 3. the latent space: encode, then sample
    root.classList.add('is-dark');
    traceCanvas.style.transition = 'opacity .8s';
    traceCanvas.style.opacity = '0.18';
    await typeLine(logEl, `&gt; imagine(action: <b>open "${name}"</b>)`);
    const tokens = [...root.querySelectorAll('.wam-z i')].sort(() => Math.random() - 0.5);
    const tok = (async () => {
      for (let i = 0; i < tokens.length; i += 4) {
        tokens.slice(i, i + 4).forEach(t => t.classList.add('h'));
        if (i >= 8) tokens.slice(i - 8, i - 4).forEach(t => t.classList.add(Math.random() < 0.55 ? 'on' : 'h'));
        await sleep(18);
      }
    })();
    await typeLine(logEl, '&gt; encode o_t → z_t ............ 96 tokens');
    await tok;
    if (skipped) return;
    await typeLine(logEl, `&gt; sample ${R} rollouts · ${F} frames · ${F * STEPS} denoising steps`);
    const [image, alts] = await Promise.all([imgP, Promise.race([altP, sleep(900).then(() => [])])]);
    if (skipped) return;

    const v0 = { cx: rand(0.3, 0.7), cy: rand(0.35, 0.65), z: rand(1.9, 2.5) };    // the shared present
    const plans = rows.map((_, r) => {
      if (r === win) return { end: FULL, alt: null, top: 1 };
      return {
        end: { cx: rand(0.15, 0.85), cy: rand(0.2, 0.8), z: rand(1.3, 2.3) },
        alt: alts[r % Math.max(1, alts.length)] || null,
        altView: { cx: rand(0.3, 0.7), cy: rand(0.3, 0.7), z: rand(1, 1.5) },
        top: rand(0.62, 0.8),
      };
    });
    const total = F * STEPS;
    for (let f = 0; f < F; f += 1) {
      const u = F > 1 ? f / (F - 1) : 1;
      for (let s = 1; s <= STEPS; s += 1) {
        if (skipped) return;
        rows.forEach((row, r) => {
          const p = plans[r];
          const e = u ** 1.2;
          const view = {
            cx: v0.cx + (p.end.cx - v0.cx) * e,
            cy: v0.cy + (p.end.cy - v0.cy) * e,
            z: v0.z + (p.end.z - v0.z) * e,
          };
          const level = (0.32 + (p.top - 0.32) * u) * (0.45 + 0.55 * (s / STEPS));
          const cell = grid[r][f];
          cell.classList.add('on');
          paint(cell.querySelector('canvas'), {
            W: 192, H: 120, img: image, view, level,
            alt: p.alt, altView: p.altView, mix: p.alt ? 0.85 * u ** 1.4 : 0,
          });
        });
        const done = f * STEPS + s;
        progBar.style.width = `${(done / total) * 100}%`;
        progTxt.textContent = `denoising ${done}/${total}`;
        await sleep(46);
      }
    }
    if (skipped) return;

    // 4. score the rollouts against the goal; the losers fade, the winner replays
    await typeLine(logEl, '&gt; score p(goal | rollout) ......... done');
    const scores = plans.map((p, r) => (r === win ? 0.97 : rand(0.05, 0.46)));
    const nums = rows.map(row => row.querySelector('.num'));
    const bars = rows.map(row => row.querySelector('.wam-meter i'));
    const t0 = performance.now();
    while (!skipped) {
      const k = Math.min(1, (performance.now() - t0) / 520);
      const e = 1 - (1 - k) ** 3;
      nums.forEach((el, r) => { el.textContent = (scores[r] * e).toFixed(2); });
      bars.forEach((el, r) => { el.style.width = `${scores[r] * e * 100}%`; });
      if (k >= 1) break;
      await sleep(30);
    }
    if (skipped) return;
    rows.forEach((row, r) => row.classList.add(r === win ? 'win' : 'lose'));
    await typeLine(logEl, `&gt; rollout ${win + 1} · p(goal) 0.97 · <b>chosen</b>`);
    for (let f = 0; f < F; f += 1) {
      if (skipped) return;
      grid[win].forEach((c, i) => c.classList.toggle('play', i === f));
      await sleep(narrow ? 120 : 85);
    }
    if (skipped) return;

    // 5. the last predicted frame becomes the page: it grows, then sharpens
    const lastCanvas = grid[win][F - 1].querySelector('canvas');
    const rect = lastCanvas.getBoundingClientRect();
    const big = document.createElement('canvas');
    big.className = 'wam-grow';
    big.width = lastCanvas.width;
    big.height = lastCanvas.height;
    big.getContext('2d').drawImage(lastCanvas, 0, 0);
    Object.assign(big.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    root.append(big);
    big.getBoundingClientRect();
    Object.assign(big.style, { left: '0px', top: '0px', width: `${VW}px`, height: `${VH}px`, borderRadius: '0px', boxShadow: 'none' });
    root.querySelector('.wam-panel').style.opacity = '0';
    await sleep(660);
    if (skipped) return;
    const tag = document.createElement('p');
    tag.className = 'wam-tag';
    tag.textContent = `t+${F} · denoising`;
    root.append(tag);
    const W = Math.ceil(VW / 2);
    const H = Math.ceil(VH / 2);
    for (const level of [0.62, 0.72, 0.8, 0.87, 0.92, 0.96, 0.985]) {
      if (skipped) return;
      paint(big, { W, H, img: image, level });
      await sleep(80);
    }
    if (image) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      big.width = Math.round(VW * dpr);
      big.height = Math.round(VH * dpr);
      big.getContext('2d').drawImage(image, ...cropOf(image, big.width / big.height, FULL), 0, 0, big.width, big.height);
    }
    tag.textContent = `t+${F} · future reached`;
    await sleep(220);
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
    // grow from the card if a card was clicked
    const box = a.matches('.proj-card') ? a : a.closest('.proj-card');
    const r = box ? box.getBoundingClientRect() : null;
    imagine(a.href, {
      from: { x: e.clientX || window.innerWidth / 2, y: e.clientY || window.innerHeight / 2 },
      rect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null,
    });
  });
  // warm every poster once the pointer heads for a project
  let warmed = false;
  document.addEventListener('pointerover', e => {
    if (warmed) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (a && futureOf(a.href)) { warmed = true; ALL_KEYS.forEach(k => getImage(posterOf(k))); }
  }, { passive: true });

  /* ---------- arriving: the predicted frame fades and the real page comes into focus ---------- */

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
    root.innerHTML = '<canvas aria-hidden="true"></canvas><p class="wam-tag">future reached · observing</p>';
    document.body.append(root);
    const canvas = root.querySelector('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    html.classList.add('wam-focus');
    html.classList.remove('wam-arriving');
    getImage(data.poster).then(img => {
      if (img) ctx.drawImage(img, ...cropOf(img, canvas.width / canvas.height, FULL), 0, 0, canvas.width, canvas.height);
      setTimeout(() => {
        html.classList.add('wam-focusing');
        requestAnimationFrame(() => html.classList.remove('wam-focus'));
        root.style.transition = 'opacity 1s ease, filter 1s ease, transform 1.1s cubic-bezier(.2,.7,.2,1)';
        root.style.opacity = '0';
        root.style.filter = 'blur(18px)';
        root.style.transform = 'scale(1.04)';
        setTimeout(() => { root.remove(); html.classList.remove('wam-focusing'); }, 1150);
      }, 380);
    });
  }
  arrive();

  // coming back with the back button: drop any leftover overlay
  window.addEventListener('pageshow', e => {
    if (e.persisted) {
      document.querySelectorAll('.wam').forEach(n => n.remove());
      document.documentElement.classList.remove('wam-focus', 'wam-focusing');
      busy = false;
    }
  });
})();
