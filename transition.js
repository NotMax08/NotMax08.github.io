/* =========================================================
   Max Yuan · "imagining the future" (flow matching)
   Opening a project plays one continuous flow-matching sample:

     1. the card you clicked breaks into particles that scatter into
        a Gaussian cloud: the present, pushed back to noise
     2. each particle travels a straight line from its noise sample to
        its pixel in the page you asked for, x_t = (1 - t) x_0 + t x_1,
        the way π₀ samples its actions (rectified flow)
     3. the sample sharpens into the real frame, and the page comes
        into focus underneath it

   Drawn with WebGL points. Neutral greys and one pastel purple.
   Click, Esc or Enter skips. Reduced motion goes straight there.
   Shared by every page. window.wamImagine(href, opts) starts it.
   ========================================================= */

(() => {
  'use strict';

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ROOT = document.documentElement.dataset.root || '';
  const KEY = 'wam-arrive';
  const ACCENT = '#c3b1fa';

  // where each project lives, and the frame its future resolves to
  const FUTURES = {
    'pi05-pick-place': { title: 'π₀.5 pick and place', key: 'pi05' },
    'brackey-way': { title: 'The Brackey Way', key: 'brackey' },
    'quadruped-ppo': { title: 'Go2 locomotion', key: 'quad' },
    'maze-nav2': { title: 'Maze navigation', key: 'nav' },
    'rico-arm': { title: 'RICO', key: 'rico' },
    'ftc-18844': { title: 'FTC team 18844', key: 'ftc' },
  };
  // full-resolution first frames of the clips (assets/hero); the maze clip only has its small poster
  const posterOf = key => new URL(`${ROOT}assets/${key === 'nav' ? 'loops' : 'hero'}/${key}.jpg`, location.href).href;
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
  .wam canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
  .wam-final{opacity:0;transition:opacity .22s ease}
  .wam-final.on{opacity:1}
  .wam-tag{position:absolute;left:18px;top:16px;z-index:4;margin:0;display:flex;align-items:center;gap:8px;font:11px/1 "Geist Mono",ui-monospace,monospace;color:#fafafa;text-shadow:0 1px 6px rgba(0,0,0,.6);font-variant-numeric:tabular-nums;opacity:0;transition:opacity .3s ease}
  .wam-tag.on{opacity:1}
  .wam-tag::before{content:"";width:6px;height:6px;border-radius:50%;background:${ACCENT}}
  .wam-skip{position:absolute;right:18px;bottom:16px;margin:0;font:11px/1 "Geist Mono",ui-monospace,monospace;color:#525252;opacity:0;transition:opacity .3s}
  .wam-skip.on{opacity:1}
  html.wam-arriving,html.wam-arriving body{background:#0a0a0a!important}
  html.wam-arriving body>*:not(.wam){visibility:hidden}
  html.wam-focus body>*:not(.wam){filter:blur(14px);opacity:0}
  html.wam-focusing body>*:not(.wam){transition:filter .65s cubic-bezier(.2,.7,.2,1),opacity .5s ease}
  `;
  document.head.append(style);

  /* ---------- helpers ---------- */

  const sleep = ms => new Promise(r => setTimeout(r, ms));
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

  // the part of img that covers a box of aspect fr, like object-fit: cover
  function cropOf(img, fr) {
    let sw = img.width;
    let sh = img.height;
    if (img.width / img.height > fr) sw = img.height * fr; else sh = img.width / fr;
    return [(img.width - sw) / 2, (img.height - sh) / 2, sw, sh];
  }

  // the image's colours on a cols x rows grid, cropped to aspect fr
  function sample(img, cols, rows, fr) {
    const c = document.createElement('canvas');
    c.width = cols;
    c.height = rows;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, ...cropOf(img, fr), 0, 0, cols, rows);
    return ctx.getImageData(0, 0, cols, rows).data;
  }

  /* ---------- the particle renderer ---------- */

  const VS = `
  attribute vec2 aSrc;
  attribute vec2 aNoise;
  attribute vec2 aDst;
  attribute vec3 aCol0;
  attribute vec3 aCol1;
  attribute vec2 aSeed;
  uniform vec2 uRes;
  uniform float uA;      // 0..1: the present scatters into noise
  uniform float uB;      // 0..1: the flow from noise to the future
  uniform float uCell;   // grid cell, in device pixels
  varying vec3 vCol;
  varying float vAlpha;
  varying float vShape;
  void main(){
    float eA = 1.0 - pow(1.0 - uA, 3.0);
    // every particle runs the same straight path, a little early or late
    float t = clamp(uB * 1.3 - aSeed.x * 0.3, 0.0, 1.0);
    float eB = t * t * (3.0 - 2.0 * t);
    vec2 x0 = mix(aSrc, aNoise, eA);
    vec2 p = mix(x0, aDst, eB);
    // noise: grey with a faint lilac, its own brightness per particle
    vec3 nz = vec3(0.50, 0.48, 0.58) + (aSeed.y - 0.5) * 0.5;
    vec3 col = mix(mix(aCol0, nz, eA), aCol1, pow(eB, 1.4));
    vCol = col;
    vAlpha = mix(mix(1.0, 0.55, eA), 1.0, eB);
    vShape = eB * eB;
    float size = uCell * mix(mix(1.15, 1.9, eA), 1.25, eB);
    gl_PointSize = size;
    vec2 clip = p / uRes * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  }`;
  const FS = `
  precision mediump float;
  varying vec3 vCol;
  varying float vAlpha;
  varying float vShape;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float d = mix(length(c), max(abs(c.x), abs(c.y)), vShape) * 2.0;
    float a = (1.0 - smoothstep(mix(0.15, 0.85, vShape), 1.0, d)) * vAlpha;
    gl_FragColor = vec4(vCol * a, a);
  }`;

  function makeGL(canvas) {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) return null;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const vs = sh(gl.VERTEX_SHADER, VS);
    const fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return { gl, prog };
  }

  /* ---------- the act ---------- */

  let busy = false;

  async function imagine(href, opts = {}) {
    const fut = futureOf(href);
    if (!fut || busy) { if (!busy) location.href = href; return; }
    if (reduce) { location.href = fut.href; return; }
    busy = true;
    const title = opts.title || fut.title;
    const VW = window.innerWidth;
    const VH = window.innerHeight;
    const from = opts.from || { x: VW / 2, y: VH / 2 };
    const card = opts.rect && opts.rect.width > 40 ? opts.rect : null;

    const go = () => {
      try { sessionStorage.setItem(KEY, JSON.stringify({ poster: fut.poster, title, t: Date.now() })); } catch (e) { /* private mode */ }
      location.href = fut.href;
    };

    const img = await Promise.race([getImage(fut.poster), sleep(600).then(() => null)]);
    if (!img) { go(); return; }

    const root = document.createElement('div');
    root.className = 'wam';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'assertive');
    root.innerHTML = `
      <canvas class="wam-flow" aria-hidden="true"></canvas>
      <canvas class="wam-final" aria-hidden="true"></canvas>
      <p class="wam-tag">flow matching · t 0.00</p>
      <p class="wam-skip">click to skip</p>`;
    const canvas = root.querySelector('.wam-flow');
    const finalC = root.querySelector('.wam-final');
    const tag = root.querySelector('.wam-tag');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = finalC.width = Math.round(VW * dpr);
    canvas.height = finalC.height = Math.round(VH * dpr);
    const G = makeGL(canvas);
    if (!G) { go(); return; }
    document.body.append(root);
    document.documentElement.classList.add('wam-on');   // the home page's hero stops drawing underneath

    let skipped = false;
    const skip = () => { if (skipped) return; skipped = true; go(); };
    root.addEventListener('click', skip);
    const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') skip(); };
    window.addEventListener('keydown', onKey);

    // the grid: about 40k particles on a big screen, fewer on a phone
    const cell = Math.max(4, Math.sqrt((VW * VH) / 40000));
    const cols = Math.ceil(VW / cell);
    const rows = Math.ceil(VH / cell);
    const N = cols * rows;
    const dst = sample(img, cols, rows, VW / VH);
    const srcCols = card ? sample(img, cols, rows, card.width / card.height) : null;

    const aSrc = new Float32Array(N * 2);
    const aNoise = new Float32Array(N * 2);
    const aDst = new Float32Array(N * 2);
    const aCol0 = new Float32Array(N * 3);
    const aCol1 = new Float32Array(N * 3);
    const aSeed = new Float32Array(N * 2);
    const sx = VW * 0.26;
    const sy = VH * 0.26;
    const L = [0.76, 0.69, 0.98];   // the lilac a plain link starts from
    for (let j = 0, i = 0; j < rows; j += 1) {
      for (let c = 0; c < cols; c += 1, i += 1) {
        const u = (c + 0.5) / cols;
        const v = (j + 0.5) / rows;
        aDst[i * 2] = u * VW;
        aDst[i * 2 + 1] = v * VH;
        if (card) {
          aSrc[i * 2] = card.left + u * card.width;
          aSrc[i * 2 + 1] = card.top + v * card.height;
        } else {
          aSrc[i * 2] = from.x + gauss() * 3;
          aSrc[i * 2 + 1] = from.y + gauss() * 3;
        }
        aNoise[i * 2] = VW / 2 + gauss() * sx;
        aNoise[i * 2 + 1] = VH / 2 + gauss() * sy;
        for (let k = 0; k < 3; k += 1) {
          aCol1[i * 3 + k] = dst[i * 4 + k] / 255;
          aCol0[i * 3 + k] = srcCols ? srcCols[i * 4 + k] / 255 : L[k];
        }
        aSeed[i * 2] = Math.random();
        aSeed[i * 2 + 1] = Math.random();
      }
    }
    const { gl, prog } = G;
    const bind = (name, data, size) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    bind('aSrc', aSrc, 2);
    bind('aNoise', aNoise, 2);
    bind('aDst', aDst, 2);
    bind('aCol0', aCol0, 3);
    bind('aCol1', aCol1, 3);
    bind('aSeed', aSeed, 2);
    const U = name => gl.getUniformLocation(prog, name);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U('uRes'), VW, VH);
    gl.uniform1f(U('uCell'), cell * dpr);
    const uA = U('uA');
    const uB = U('uB');

    const fctx = finalC.getContext('2d');
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(img, ...cropOf(img, finalC.width / finalC.height), 0, 0, finalC.width, finalC.height);

    // timings: scatter, flow, settle
    const TA = 380;
    const TB = 1050;
    const t0 = performance.now();
    await new Promise(resolve => {
      const frame = now => {
        if (skipped) { resolve(); return; }
        const e = now - t0;
        const a = Math.min(1, e / TA);
        const b = Math.max(0, Math.min(1, (e - TA * 0.7) / TB));
        const bg = Math.min(1, e / (TA * 0.8));
        gl.clearColor(0.039 * bg, 0.039 * bg, 0.039 * bg, bg);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform1f(uA, a);
        gl.uniform1f(uB, b);
        gl.drawArrays(gl.POINTS, 0, N);
        if (e > 120) { tag.classList.add('on'); root.querySelector('.wam-skip').classList.add('on'); }
        tag.textContent = b < 1 ? `flow matching · t ${b.toFixed(2)}` : `t 1.00 · ${title}`;
        if (b >= 1) resolve(); else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    if (skipped) return;

    // the sample sharpens into the real frame
    finalC.classList.add('on');
    await sleep(240);
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
    // start from the card if a card was clicked
    const box = a.closest('.proj-card, .ht');
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
    root.innerHTML = '<canvas aria-hidden="true"></canvas><p class="wam-tag on">t 1.00 · observing</p>';
    document.body.append(root);
    const canvas = root.querySelector('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    html.classList.add('wam-focus');
    html.classList.remove('wam-arriving');
    getImage(data.poster).then(img => {
      if (img) ctx.drawImage(img, ...cropOf(img, canvas.width / canvas.height), 0, 0, canvas.width, canvas.height);
      setTimeout(() => {
        html.classList.add('wam-focusing');
        requestAnimationFrame(() => html.classList.remove('wam-focus'));
        root.style.transition = 'opacity .7s ease, filter .7s ease, transform .8s cubic-bezier(.2,.7,.2,1)';
        root.style.opacity = '0';
        root.style.filter = 'blur(18px)';
        root.style.transform = 'scale(1.04)';
        setTimeout(() => { root.remove(); html.classList.remove('wam-focusing'); }, 850);
      }, 180);
    });
  }
  arrive();

  // coming back with the back button: drop any leftover overlay
  window.addEventListener('pageshow', e => {
    if (e.persisted) {
      document.querySelectorAll('.wam').forEach(n => n.remove());
      document.documentElement.classList.remove('wam-focus', 'wam-focusing', 'wam-on');
      busy = false;
    }
  });
})();
