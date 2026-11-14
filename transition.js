/* =========================================================
   Max Yuan · "imagining the future"
   Opening a project plays a small world-action-model act, in the
   site's own black and pastel blue:

     1. a fan of imagined trajectories grows from where you clicked
     2. the screen drops into latent space; the click is encoded
        into a grid of tokens
     3. the model samples a few rollouts and generates each one's
        next frames, all at once, denoising step by step. Every
        rollout starts from the same present; the wrong ones drift
        towards other projects, the right one towards the page you
        asked for
     4. the rollouts are scored, the losers fade, the winner replays
     5. its last frame grows to fill the screen and sharpens into
        colour, and the real page scans in underneath it

   Click, Esc or Enter skips. Reduced motion goes straight there.
   Shared by every page. window.wamImagine(href, opts) starts it.
   ========================================================= */

(() => {
  'use strict';

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ROOT = document.documentElement.dataset.root || '';
  const KEY = 'wam-arrive';

  // the palette, shared with style.css
  const BG = [5, 7, 10];
  const BLUE = [159, 208, 245];
  const ICE = [214, 237, 253];
  const css = c => `rgb(${c.join(',')})`;
  const blueA = a => `rgba(159,208,245,${a})`;

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
    font-family:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;color:#b3c6d6}
  .wam canvas{display:block}
  .wam-noise,.wam-trace{position:absolute;inset:0;width:100%;height:100%}
  .wam-noise{image-rendering:pixelated;opacity:0;transition:opacity .35s ease}
  .wam.is-dark .wam-noise{opacity:1}
  .wam-scan{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .35s;
    background:repeating-linear-gradient(to bottom,rgba(159,208,245,.04) 0 1px,transparent 1px 3px),
      radial-gradient(ellipse at center,transparent 40%,rgba(2,3,5,.75) 100%)}
  .wam.is-dark .wam-scan{opacity:1}
  .wam-panel{position:absolute;left:50%;top:50%;width:min(1000px,calc(100vw - 32px));transform:translate(-50%,-50%);opacity:0;transition:opacity .3s ease}
  .wam.is-dark .wam-panel{opacity:1}
  .wam-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:28px;align-items:end;margin-bottom:16px}
  .wam-title{margin:0 0 12px;font-family:"Silkscreen","JetBrains Mono",monospace;font-size:clamp(22px,4.2vw,46px);line-height:1;letter-spacing:.01em;color:${css(ICE)};
    text-shadow:3px 0 rgba(79,147,201,.6),-2px 0 rgba(214,237,253,.28)}
  .wam-title i{font-style:normal;color:${css(BLUE)};animation:wam-blink .8s steps(1) infinite}
  .wam-log{margin:0;min-height:7.8em;font-family:inherit;font-size:12px;line-height:1.55;color:#7790a5;white-space:pre-wrap}
  .wam-log b{font-weight:500;color:${css(BLUE)}}
  .wam-z{display:grid;grid-template-columns:repeat(16,7px);gap:2px}
  .wam-z i{width:7px;height:7px;background:#141f2a;transition:background-color .12s}
  .wam-z i.h{background:#2c4659}
  .wam-z i.on{background:${css(BLUE)}}
  .wam-cap{margin:7px 0 0;font-size:10px;color:#48607a;text-align:right}
  .wam-prog{display:flex;align-items:center;gap:12px;margin:0 0 12px;font-size:11px;color:#48607a}
  .wam-prog-bar{flex:1;height:2px;background:#141f2a;overflow:hidden}
  .wam-prog-bar i{display:block;height:100%;width:0;background:${css(BLUE)};box-shadow:0 0 8px ${blueA(0.8)}}
  .wam-prog-txt{min-width:9.5em;text-align:right}
  .wam-row{display:grid;grid-template-columns:76px repeat(var(--F),minmax(0,1fr)) 70px;gap:6px;align-items:center;margin-bottom:7px;transition:opacity .4s ease}
  .wam-row>label{font-size:10px;color:#7790a5;letter-spacing:.04em}
  .wam-cell{position:relative}
  .wam-cell canvas{width:100%;height:auto;aspect-ratio:16/10;image-rendering:pixelated;background:#020305;border:1px solid #141f2a;opacity:0;transition:opacity .12s,border-color .2s,box-shadow .2s}
  .wam-cell.on canvas{opacity:1}
  .wam-p{font-size:11px;color:#7790a5;text-align:right;white-space:nowrap}
  .wam-row.lose{opacity:.22}
  .wam-row.win>label,.wam-row.win .wam-p{color:${css(BLUE)}}
  .wam-row.win .wam-cell canvas{border-color:${blueA(0.45)}}
  .wam-row.win .wam-cell.play canvas{border-color:${css(ICE)};box-shadow:0 0 0 1px ${css(ICE)},0 0 22px ${blueA(0.4)}}
  .wam-axis{margin:2px 0 0}
  .wam-axis span{font-size:10px;color:#48607a;text-align:center}
  .wam-grow{position:fixed;z-index:2;image-rendering:pixelated;background:#020305;transition:left .55s cubic-bezier(.7,0,.2,1),top .55s cubic-bezier(.7,0,.2,1),width .55s cubic-bezier(.7,0,.2,1),height .55s cubic-bezier(.7,0,.2,1)}
  .wam-skip{position:absolute;right:18px;bottom:16px;margin:0;font-size:11px;color:#48607a;opacity:0;transition:opacity .3s}
  .wam.is-dark .wam-skip{opacity:1}
  .wam-tag{position:absolute;left:18px;top:16px;z-index:3;margin:0;font-size:11px;letter-spacing:.06em;color:${css(ICE)};text-shadow:0 1px 3px rgba(0,0,0,.8)}
  .wam-tag b{font-weight:500;color:${css(BLUE)}}
  @keyframes wam-blink{50%{opacity:0}}
  @media (max-width:640px){
    .wam-head{grid-template-columns:minmax(0,1fr)}
    .wam-zbox{display:none}
    .wam-log{font-size:10.5px;min-height:8.6em}
    .wam-row{grid-template-columns:30px repeat(var(--F),minmax(0,1fr)) 38px;gap:4px}
    .wam-p{font-size:10px}
  }
  html.wam-arriving,html.wam-arriving body{background:#05070a!important}
  html.wam-arriving body>*:not(.wam){visibility:hidden}
  `;
  document.head.append(style);

  /* ---------- helpers ---------- */

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
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

  // blue-black static, drawn small and scaled up
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
        const v = r < 0.94 ? 4 + r * 14 : 22 + Math.random() * 46;
        d[i] = v * 0.55; d[i + 1] = v * 0.8; d[i + 2] = v; d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }

  // imagined trajectories: a fan of noisy paths from the click towards the goal
  function drawTraces(canvas, from, to, dur, K = 16) {
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
      for (let s = 0; s < 52; s += 1) {
        const t = s / 51;
        const goal = k === pick ? 1 : 0.3;      // the chosen one is pulled to the goal
        vx += ((to.x - x) * 0.012 * goal) + rand(-1.3, 1.3) * (1 - t * goal);
        vy += ((to.y - y) * 0.012 * goal) + rand(-1.3, 1.3) * (1 - t * goal);
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
        const e = 1 - (1 - k) ** 2;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        ctx.fillStyle = 'rgba(5,7,10,' + (0.35 * k) + ')';
        ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
        paths.forEach((pts, i) => {
          const n = Math.max(2, Math.floor(pts.length * e));
          const chosen = i === pick;
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          for (let j = 0; j < n; j += 1) ctx.lineTo(pts[j][0], pts[j][1]);
          ctx.strokeStyle = chosen ? css(ICE) : blueA(0.42);
          ctx.lineWidth = chosen ? 2 : 1;
          ctx.setLineDash(chosen ? [] : [3, 4]);
          ctx.shadowColor = chosen ? blueA(0.9) : 'transparent';
          ctx.shadowBlur = chosen ? 10 : 0;
          ctx.stroke();
          ctx.shadowBlur = 0;
          const [ex, ey] = pts[n - 1];
          ctx.fillStyle = chosen ? css(ICE) : blueA(0.7);
          ctx.fillRect(ex - 2, ey - 2, 4, 4);
        });
        ctx.setLineDash([]);
        ctx.strokeStyle = css(BLUE);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(from.x, from.y, 5 + 3 * Math.sin(k * Math.PI), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = css(BLUE);
        ctx.fillRect(from.x - 1.5, from.y - 1.5, 3, 3);
        if (k < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  /* ---------- one predicted frame ----------
     A crop ("view") of a poster, optionally cross-faded into a second
     poster, then denoised to `level` (0 = static, 1 = the picture):
       below .5   two-tone Bayer dither, black and pastel blue
       .5 to .88  a duotone, black to pastel blue to ice, still noisy
       above .88  colour fades in                                   */

  const scratch = document.createElement('canvas');
  const sctx = scratch.getContext('2d', { willReadFrequently: true });

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

  function paint(canvas, o) {
    const { W, H, level } = o;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext('2d');
    const block = Math.max(1, Math.round((o.maxBlock || 8) * (1 - level) ** 1.5));
    const w = Math.ceil(W / block);
    const h = Math.ceil(H / block);
    scratch.width = w;
    scratch.height = h;
    sctx.globalAlpha = 1;
    sctx.fillStyle = '#0a0f15';
    sctx.fillRect(0, 0, w, h);
    if (o.img) sctx.drawImage(o.img, ...cropOf(o.img, W / H, o.view), 0, 0, w, h);
    if (o.alt && o.mix > 0) {
      sctx.globalAlpha = o.mix;
      sctx.drawImage(o.alt, ...cropOf(o.alt, W / H, o.altView || o.view), 0, 0, w, h);
      sctx.globalAlpha = 1;
    }
    const data = sctx.getImageData(0, 0, w, h);
    const d = data.data;
    let s = (o.seed % 2147483646) + 1;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const amt = (1 - level) ** 1.2 * 255;
    const colour = level > 0.88 ? (level - 0.88) / 0.12 : 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const n = (rnd() - 0.5) * amt;
        const lum = 0.3 * r + 0.59 * g + 0.11 * b;
        if (level < 0.5) {
          const on = (lum + n) / 255 > BAYER[(y % 4) * 4 + (x % 4)];
          const c = on ? BLUE : BG;
          d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
        } else {
          const t = clamp01((lum + n * 0.6) / 255);
          let dr = BG[0] + (BLUE[0] - BG[0]) * t;
          let dg = BG[1] + (BLUE[1] - BG[1]) * t;
          let db = BG[2] + (BLUE[2] - BG[2]) * t;
          if (t > 0.82) {
            const k = (t - 0.82) / 0.18;
            dr += (ICE[0] - dr) * k; dg += (ICE[1] - dg) * k; db += (ICE[2] - db) * k;
          }
          if (colour > 0) {
            dr += (r + n * 0.3 - dr) * colour;
            dg += (g + n * 0.3 - dg) * colour;
            db += (b + n * 0.3 - db) * colour;
          }
          d[i] = dr; d[i + 1] = dg; d[i + 2] = db;
        }
        d[i + 3] = 255;
      }
    }
    sctx.putImageData(data, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scratch, 0, 0, w * block, h * block);
  }

  function typeLine(el, html, perChar = 8) {
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
    const from = opts.from || { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    const narrow = window.innerWidth < 640;
    const F = narrow ? 4 : 8;                                   // frames per rollout
    const R = narrow || window.innerHeight < 640 ? 3 : 4;      // rollouts
    const STEPS = 4;                                            // denoise steps per frame
    const win = Math.floor(Math.random() * R);

    const root = document.createElement('div');
    root.className = 'wam';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'assertive');
    const cells = `${Array.from({ length: F }, () => '<span class="wam-cell"><canvas></canvas></span>').join('')}`;
    root.innerHTML = `
      <canvas class="wam-noise" aria-hidden="true"></canvas>
      <div class="wam-scan" aria-hidden="true"></div>
      <canvas class="wam-trace" aria-hidden="true"></canvas>
      <div class="wam-panel">
        <div class="wam-head">
          <div>
            <p class="wam-title">IMAGINING THE FUTURE<i>_</i></p>
            <pre class="wam-log"></pre>
          </div>
          <div class="wam-zbox" aria-hidden="true"><div class="wam-z">${'<i></i>'.repeat(96)}</div><p class="wam-cap">z_t · 96 tokens</p></div>
        </div>
        <div class="wam-prog" aria-hidden="true"><span class="wam-prog-bar"><i></i></span><span class="wam-prog-txt">denoise 0/${F * STEPS}</span></div>
        <div class="wam-grid" aria-hidden="true">
          ${Array.from({ length: R }, (_, r) => `<div class="wam-row" style="--F:${F}"><label>${narrow ? 'r' : 'rollout '}${r + 1}</label>${cells}<span class="wam-p">p —</span></div>`).join('')}
          <div class="wam-row wam-axis" style="--F:${F}"><span></span>${Array.from({ length: F }, (_, f) => `<span>t+${f + 1}</span>`).join('')}<span></span></div>
        </div>
      </div>
      <p class="wam-skip">click or esc to skip</p>`;
    document.body.append(root);

    let skipped = false;
    let stopNoise = () => {};
    const go = () => {
      try { sessionStorage.setItem(KEY, JSON.stringify({ poster: fut.poster, title, t: Date.now() })); } catch (e) { /* private mode */ }
      location.href = fut.href;
    };
    const skip = () => { if (skipped) return; skipped = true; stopNoise(); go(); };
    root.addEventListener('click', skip);
    const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') skip(); };
    window.addEventListener('keydown', onKey);

    const traceCanvas = root.querySelector('.wam-trace');
    const logEl = root.querySelector('.wam-log');
    const rows = [...root.querySelectorAll('.wam-row:not(.wam-axis)')];
    const grid = rows.map(row => [...row.querySelectorAll('.wam-cell')]);
    const progBar = root.querySelector('.wam-prog-bar i');
    const progTxt = root.querySelector('.wam-prog-txt');
    const name = title.replace(/</g, '&lt;');

    // 1. sample a few futures from where the visitor acted
    if (!opts.skipTraces) {
      const target = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.6 };
      await drawTraces(traceCanvas, from, target, 820);
    }
    if (skipped) return;

    // 2. drop into the latent space and encode the present
    stopNoise = startNoise(root.querySelector('.wam-noise'));
    root.classList.add('is-dark');
    traceCanvas.style.transition = 'opacity .6s';
    traceCanvas.style.opacity = '0.25';
    await typeLine(logEl, `&gt; wam.imagine(action=<b>"open ${name}"</b>)`);
    const tokens = [...root.querySelectorAll('.wam-z i')].sort(() => Math.random() - 0.5);
    const encode = (async () => {
      for (let i = 0; i < tokens.length; i += 4) {
        tokens.slice(i, i + 4).forEach(t => t.classList.add('h'));
        if (i >= 8) tokens.slice(i - 8, i - 4).forEach(t => t.classList.add(Math.random() < 0.55 ? 'on' : 'h'));
        await sleep(16);
      }
    })();
    await typeLine(logEl, '&gt; encode o_t → z_t .............. 96 tokens');
    await encode;
    if (skipped) return;
    await typeLine(logEl, `&gt; sample ${R} rollouts · horizon ${F} · ${F * STEPS} denoise steps`);
    const [img, alts] = await Promise.all([imgP, Promise.race([altP, sleep(900).then(() => [])])]);
    if (skipped) return;

    // 3. generate every rollout's frames together, one denoise step at a time
    const v0 = { cx: rand(0.3, 0.7), cy: rand(0.35, 0.65), z: rand(2, 2.6) };    // the shared present
    const plans = rows.map((_, r) => {
      if (r === win) return { end: { cx: 0.5, cy: 0.5, z: 1 }, alt: null, top: 1 };
      return {
        end: { cx: rand(0.15, 0.85), cy: rand(0.2, 0.8), z: rand(1.4, 2.4) },
        alt: alts[r % Math.max(1, alts.length)] || null,
        altView: { cx: rand(0.3, 0.7), cy: rand(0.3, 0.7), z: rand(1, 1.6) },
        top: rand(0.6, 0.78),
      };
    });
    const seed0 = Math.floor(Math.random() * 1e6) + 1;
    const total = F * STEPS;
    for (let f = 0; f < F; f += 1) {
      const u = F > 1 ? f / (F - 1) : 1;
      for (let s = 1; s <= STEPS; s += 1) {
        if (skipped) return;
        rows.forEach((row, r) => {
          const p = plans[r];
          // frame 0 is the same for everyone; after that each rollout follows its own plan
          const e = u ** 1.2;
          const view = {
            cx: v0.cx + (p.end.cx - v0.cx) * e,
            cy: v0.cy + (p.end.cy - v0.cy) * e,
            z: v0.z + (p.end.z - v0.z) * e,
          };
          const level = (0.3 + (p.top - 0.3) * u) * (0.55 + 0.45 * (s / STEPS));
          const cell = grid[r][f];
          cell.classList.add('on');
          paint(cell.querySelector('canvas'), {
            W: 160, H: 100, img, view, level,
            alt: p.alt, altView: p.altView, mix: p.alt ? 0.85 * u ** 1.4 : 0,
            seed: seed0 + r * 7919 + f * 97 + s,
          });
        });
        const done = f * STEPS + s;
        progBar.style.width = `${(done / total) * 100}%`;
        progTxt.textContent = `denoise ${done}/${total}`;
        await sleep(44);
      }
    }
    if (skipped) return;

    // 4. score the rollouts against the goal; the losers fade, the winner replays
    await typeLine(logEl, '&gt; score p(goal | rollout) ........... ok');
    const scores = plans.map((p, r) => (r === win ? 0.97 : rand(0.04, 0.46)));
    const pEls = rows.map(row => row.querySelector('.wam-p'));
    const t0 = performance.now();
    while (!skipped) {
      const k = Math.min(1, (performance.now() - t0) / 480);
      pEls.forEach((el, r) => { el.textContent = `p ${(scores[r] * (1 - (1 - k) ** 3)).toFixed(2)}`; });
      if (k >= 1) break;
      await sleep(30);
    }
    if (skipped) return;
    rows.forEach((row, r) => row.classList.add(r === win ? 'win' : 'lose'));
    pEls[win].textContent = 'p 0.97 ←';
    await typeLine(logEl, `&gt; rollout ${win + 1} · p(goal) 0.97 <b>← chosen</b>`);
    for (let f = 0; f < F; f += 1) {
      if (skipped) return;
      grid[win].forEach((c, i) => c.classList.toggle('play', i === f));
      await sleep(narrow ? 110 : 75);
    }
    if (skipped) return;

    // 5. the last predicted frame becomes the page: it grows, then sharpens into colour
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
    Object.assign(big.style, { left: '0px', top: '0px', width: '100vw', height: '100vh' });
    root.querySelector('.wam-panel').style.opacity = '0';
    await sleep(580);
    if (skipped) return;
    const tag = document.createElement('p');
    tag.className = 'wam-tag';
    tag.innerHTML = `t+${F} · <b>denoising</b>`;
    root.append(tag);
    const W = Math.ceil(window.innerWidth / 2);
    const H = Math.ceil(window.innerHeight / 2);
    const full = { cx: 0.5, cy: 0.5, z: 1 };
    for (const level of [0.56, 0.68, 0.78, 0.86, 0.92, 0.97]) {
      if (skipped) return;
      paint(big, { W, H, img, view: full, level, maxBlock: 22, seed: seed0 + Math.round(level * 1000) });
      await sleep(85);
    }
    if (img) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      big.width = Math.round(window.innerWidth * dpr);
      big.height = Math.round(window.innerHeight * dpr);
      big.style.imageRendering = 'auto';
      big.getContext('2d').drawImage(img, ...cropOf(img, big.width / big.height, full), 0, 0, big.width, big.height);
    }
    tag.innerHTML = `t+${F} · <b>future reached</b>`;
    await sleep(200);
    stopNoise();
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
  // warm every poster once the pointer heads for a project
  let warmed = false;
  document.addEventListener('pointerover', e => {
    if (warmed) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (a && futureOf(a.href)) { warmed = true; ALL_KEYS.forEach(k => getImage(posterOf(k))); }
  }, { passive: true });

  /* ---------- arriving: the predicted frame scans away into the real page ---------- */

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
    root.innerHTML = '<canvas aria-hidden="true"></canvas><p class="wam-tag">future reached · <b>observing</b></p>';
    document.body.append(root);
    const canvas = root.querySelector('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = css(BG);
    ctx.fillRect(0, 0, W, H);
    html.classList.remove('wam-arriving');
    getImage(data.poster).then(img => {
      if (img) ctx.drawImage(img, ...cropOf(img, W / H, { cx: 0.5, cy: 0.5, z: 1 }), 0, 0, W, H);
      // a scan from top to bottom: each block flashes blue, then clears to the page
      const B = 24;
      const cols = Math.ceil(W / B);
      const rowsN = Math.ceil(H / B);
      const order = Array.from({ length: cols * rowsN }, (_, i) => ({ i, k: Math.floor(i / cols) + Math.random() * 7 }))
        .sort((a, b) => a.k - b.k).map(o => o.i);
      const t0 = performance.now();
      const dur = 760;
      let done = 0;
      let lit = [];
      const step = now => {
        const k = Math.min(1, (now - t0) / dur);
        lit.forEach(n => ctx.clearRect((n % cols) * B, Math.floor(n / cols) * B, B, B));
        lit = [];
        const target = Math.floor(order.length * k);
        ctx.fillStyle = blueA(0.55);
        for (; done < target; done += 1) {
          const n = order[done];
          ctx.clearRect((n % cols) * B, Math.floor(n / cols) * B, B, B);
          ctx.fillRect((n % cols) * B, Math.floor(n / cols) * B, B, B);
          lit.push(n);
        }
        if (k < 1 || lit.length) requestAnimationFrame(step); else root.remove();
      };
      setTimeout(() => requestAnimationFrame(step), 220);
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
