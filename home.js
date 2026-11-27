/* =========================================================
   Max Yuan · home page
   The hero is a grid of diffusion samples, one tile per project, all
   drawn by one WebGL canvas. Every pixel has a noise level t (0 = the
   clip, 1 = pure noise); the clip is mixed with Gaussian noise the way
   a diffusion model's forward process does it, and blurred more where
   t is high so structure comes back coarse to fine. The noise carries
   a little colour, and the highlights are a pastel purple.

   Your cursor denoises a circle around it, the same circle across
   every tile; the tile you point at shows its labels. With nobody
   pointing, the tiles take turns being sampled clean. On load every
   tile starts as pure noise and they resolve one after another,
   behind a single ripple from the corner.

   Also here: the header colour over the hero, the hero line that
   resolves letter by letter, the action log in the corner, the clock.
   ========================================================= */

(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  /* ---------- action log (bottom right): what the visitor has done so far ---------- */

  const alog = $('#alog');
  const T0 = performance.now();
  const stamp = () => {
    const s = (performance.now() - T0) / 1000;
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  };
  function act(msg) {
    if (!alog || getComputedStyle(alog).display === 'none') return;
    const li = document.createElement('li');
    li.textContent = `${stamp()} > ${msg}`;
    alog.append(li);
    while (alog.children.length > 4) alog.firstElementChild.remove();
  }
  window.__act = act;
  act('session start');

  const card = $('#hero');
  if (!card) return;

  /* ---------- header: white text while it sits over the hero ---------- */

  const top = $('#top');
  let headQueued = false;
  const head = () => {
    headQueued = false;
    if (top) top.classList.toggle('on-hero', card.getBoundingClientRect().bottom > 40);
  };
  window.addEventListener('scroll', () => { if (!headQueued) { headQueued = true; requestAnimationFrame(head); } }, { passive: true });
  head();

  /* ---------- text that resolves letter by letter, and stays a little noisy ---------- */

  const GLYPHS = 'abcdefghijklmnopqrstuvwxyz';
  const rndGlyph = c => {
    const g = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    return c === c.toUpperCase() ? g.toUpperCase() : g;
  };
  function wrapText(el) {
    // keep <br> as a line break: the visible copy is drawn with white-space: pre-line
    const tmp = document.createElement('div');
    tmp.innerHTML = el.innerHTML.replace(/<br\s*\/?>/gi, '\n');
    const text = tmp.textContent.trim();
    el.textContent = '';
    const sr = document.createElement('span');
    sr.className = 'sr';
    sr.textContent = text.replace(/\n/g, '. ');
    const vis = document.createElement('span');
    vis.setAttribute('aria-hidden', 'true');
    vis.style.whiteSpace = 'pre-line';
    vis.textContent = text;
    el.append(sr, vis);
    return { text, vis, sr, run: 0 };
  }
  // wait: ms it stays fully scrambled before the letters start to settle
  function resolve(t, text, dur = 1100, wait = 0) {
    t.text = text;
    t.sr.textContent = text.replace(/\n/g, '. ');
    if (reduce) { t.vis.textContent = text; return Promise.resolve(); }
    const settle = [...text].map((_, i) => (i / text.length) * 0.55 + Math.random() * 0.45);
    const t0 = performance.now();
    const run = ++t.run;
    return new Promise(res => {
      const step = now => {
        if (run !== t.run) { res(); return; }
        const k = Math.min(1, (now - t0 - wait) / dur);
        let out = '';
        for (let i = 0; i < text.length; i += 1) {
          const c = text[i];
          out += (k >= settle[i] || !/[a-z]/i.test(c)) ? c : rndGlyph(c);
        }
        t.vis.textContent = out;
        if (k < 1) requestAnimationFrame(step); else { t.vis.textContent = text; res(); }
      };
      requestAnimationFrame(step);
    });
  }
  // after it settles, a letter now and then flickers to a wrong one, like a sample that is almost clean
  function flicker(t) {
    if (reduce) return;
    setInterval(() => {
      if (document.hidden || !heroOn) return;
      const idx = [...t.text].map((c, i) => (/[a-z]/i.test(c) ? i : -1)).filter(i => i >= 0);
      const picks = [idx[Math.floor(Math.random() * idx.length)]];
      if (Math.random() < 0.4) picks.push(idx[Math.floor(Math.random() * idx.length)]);
      const chars = [...t.text];
      picks.forEach(i => { chars[i] = rndGlyph(chars[i]); });
      t.vis.textContent = chars.join('');
      setTimeout(() => { t.vis.textContent = t.text; }, 160);
    }, 2300);
  }
  let heroOn = true;
  const line = wrapText($('#hero-line'));
  resolve(line, line.text, 1500).then(() => flicker(line));

  /* ---------- the tiles: the intro, then one per project ---------- */

  const tiles = $$('.ht', card).map(el => {
    const video = $('video', el);
    const f = (el.dataset.focus || '0.5,0.5').split(',').map(Number);
    const tEl = $('.ht-t', el);
    return {
      el,
      video,
      intro: !video,
      fx: f[0],
      fy: f[1],
      title: tEl ? tEl.textContent.trim() : 'intro',
      label: tEl ? wrapText(tEl) : null,
      x: 0, y: 0, w: 1, h: 1,     // css px inside the card
      delay: 0,                    // when its first sample starts (ms after load)
      extra: 0,                    // added noise while another tile has the focus
      clean: 0,                    // how far the focused tile is sampled
      zoom: 1,
      hasImg: false, iw: 16, ih: 9, dirty: true, lastT: -1, tex: null,
    };
  }).slice(0, 6);
  const vids = tiles.filter(t => t.video).map(t => t.video);

  /* ---------- WebGL ---------- */

  const canvas = $('.hero-gl', card);
  const gl = !reduce && canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false });
  if (!gl) {
    card.classList.add('no-gl');
    if (reduce) vids.forEach(v => { v.removeAttribute('autoplay'); v.pause(); });
    return;
  }

  const VS = `#version 300 es
  in vec2 p;
  void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

  const FS = `#version 300 es
  precision highp float;
  out vec4 o;
  uniform sampler2D uI1, uI2, uI3, uI4, uI5;
  uniform sampler2D uT;
  uniform vec2 uRes;
  uniform vec4 uRect[6];     // each tile: x, y (from the bottom), w, h in device px
  uniform vec4 uCrop[6];     // the part of its clip it shows: scale.xy, offset.xy
  uniform vec4 uTile[6];     // x: extra noise, y: how clean, z: has a picture
  uniform float uRad, uStep, uTime, uDpr;
  uniform vec4 uRip;         // a ripple: x, y, age (s), strength
  uniform vec3 uBg;

  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float gauss(vec2 p){
    float u1 = max(hash(p), 1e-4);
    float u2 = hash(p + 17.17);
    return sqrt(-2.0 * log(u1)) * cos(6.2831853 * u2);
  }
  vec3 hash3(vec2 p){ return vec3(hash(p), hash(p + 31.7), hash(p + 63.1)); }
  const vec3 LILAC = vec3(0.78, 0.75, 0.90);   // the site's pastel purple

  vec3 tap(int i, vec2 uv, float lod){
    if (i == 1) return textureLod(uI1, uv, lod).rgb;
    if (i == 2) return textureLod(uI2, uv, lod).rgb;
    if (i == 3) return textureLod(uI3, uv, lod).rgb;
    if (i == 4) return textureLod(uI4, uv, lod).rgb;
    return textureLod(uI5, uv, lod).rgb;
  }

  // the intro tile's picture: a dark field with a faint violet drift
  vec3 latent(vec2 p){
    float s = uTime * 0.07;
    float a = sin(p.x * 2.6 + s * 1.9 + sin(p.y * 2.1 - s));
    float b = sin(p.y * 3.1 - s * 1.4 + sin(p.x * 1.7 + s * 1.2));
    vec3 c = vec3(0.045, 0.042, 0.06);
    c += vec3(0.40, 0.38, 0.50) * smoothstep(-0.1, 1.0, a) * 0.08;
    c += vec3(0.58, 0.56, 0.64) * smoothstep(0.35, 1.0, b) * 0.05;
    return c;
  }

  void main(){
    vec2 fc = gl_FragCoord.xy;

    // the noise-level field (0 = clean), and the ripple running out from where a tile was entered
    float tf = texture(uT, vec2(fc.x / uRes.x, 1.0 - fc.y / uRes.y)).r;
    float rd = distance(fc, uRip.xy);
    float ring = uRip.w * exp(-pow((rd - uRip.z * 900.0 * uDpr) / (46.0 * uDpr), 2.0)) * exp(-uRip.z * 1.8);
    // the contour below only shows where the noise level changes, not on a whole tile at once
    float edgeW = smoothstep(0.0003, 0.0025, fwidth(tf + ring * 0.4));

    // which tile this pixel is in (rounded rectangles)
    int idx = -1;
    float sd = 1e4;
    vec4 R = vec4(0.0, 0.0, 1.0, 1.0);
    for (int i = 0; i < 6; i++) {
      vec4 r = uRect[i];
      vec2 hs = r.zw * 0.5;
      vec2 d = abs(fc - r.xy - hs) - (hs - uRad);
      float s = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - uRad;
      if (s < 1.0) { idx = i; sd = s; R = r; break; }
    }
    vec3 bg = uBg + LILAC * ring * 0.01;
    if (idx < 0) { o = vec4(bg, 1.0); return; }
    float m = clamp(0.5 - sd, 0.0, 1.0);
    vec4 P = uTile[idx];
    vec2 luv = (fc - R.xy) / R.zw;

    float t = tf + P.x * (1.0 - tf);
    t *= 1.0 - P.y;
    t = clamp(t + ring * 0.4, 0.0, 1.0);

    // the picture: blurrier where it is noisy (coarse to fine), and a little split into R, G and B
    vec2 ca = (luv - 0.5) * (0.001 + t * 0.004 + ring * 0.01);
    vec3 x0;
    if (idx == 0) {
      vec2 p = vec2(luv.x * R.z / R.w, luv.y);
      x0 = vec3(latent(p + ca * 3.0).r, latent(p).g, latent(p - ca * 3.0).b);
    } else if (P.z > 0.5) {
      vec4 C = uCrop[idx];
      vec2 uv = luv * C.xy + C.zw;
      vec2 cs = ca * C.xy;
      float lod = t * t * 4.5;
      x0 = vec3(tap(idx, uv + cs, lod).r, tap(idx, uv, lod).g, tap(idx, uv - cs, lod).b);
    } else {
      x0 = vec3(0.11, 0.12, 0.14);
    }
    float l = dot(x0, vec3(0.299, 0.587, 0.114));
    x0 = mix(x0, vec3(l) * vec3(1.0, 0.99, 1.02), t * 0.4);

    // Gaussian noise, a new draw every sampling step: soft 2 px blotches, a slightly
    // coarser RGB tint, per-pixel grain with some colour, and a rare lilac speck
    float st = uStep * 1.37;
    vec2 q = fc / 2.0;
    vec2 qi = floor(q);
    vec2 qf = smoothstep(0.0, 1.0, fract(q));
    float soft = mix(mix(gauss(qi + st), gauss(qi + vec2(1.0, 0.0) + st), qf.x),
                     mix(gauss(qi + vec2(0.0, 1.0) + st), gauss(qi + vec2(1.0, 1.0) + st), qf.x), qf.y);
    vec2 k = fc / 4.0;
    vec2 ki = floor(k);
    vec2 kf = smoothstep(0.0, 1.0, fract(k));
    vec3 tint = mix(mix(hash3(ki + st), hash3(ki + vec2(1.0, 0.0) + st), kf.x),
                    mix(hash3(ki + vec2(0.0, 1.0) + st), hash3(ki + vec2(1.0, 1.0) + st), kf.x), kf.y) - 0.5;
    vec2 cell = floor(fc);
    vec3 fine = vec3(gauss(cell + uStep * 2.11), gauss(cell + uStep * 3.07 + 9.1), gauss(cell + uStep * 4.13 + 21.3));
    fine = mix(vec3(fine.g), fine, 0.12);
    vec3 eps = vec3(soft) * 0.6 + tint * 0.08 + fine * 0.36;

    // the forward process with a cosine schedule: x_t = sqrt(a) x_0 + sqrt(1 - a) eps
    float a = cos(t * 1.5707963);
    a *= a;
    float amp = idx == 0 ? 0.18 : 0.26;
    vec3 xt = sqrt(a) * (x0 * 2.0 - 1.0) + sqrt(1.0 - a) * eps * amp;
    vec3 c = clamp(xt * 0.5 + 0.5, 0.0, 1.0);

    // where the clean patch meets the noise, a thin lilac contour
    float rim = smoothstep(0.12, 0.2, t) * (1.0 - smoothstep(0.24, 0.36, t));
    c += LILAC * rim * 0.035 * edgeW;

    // the ripple catches the light as it passes
    c += LILAC * ring * 0.02;

    o = vec4(mix(bg, c, m), 1.0);
  }`;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) {
    console.warn('hero shader', e);
    card.classList.add('no-gl');
    return;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const locP = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(locP);
  gl.vertexAttribPointer(locP, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  ['uI1', 'uI2', 'uI3', 'uI4', 'uI5', 'uT', 'uRes', 'uRect', 'uCrop', 'uTile', 'uRad', 'uStep', 'uTime', 'uDpr', 'uRip', 'uBg']
    .forEach(n => { U[n] = gl.getUniformLocation(prog, n); });

  const newTex = (unit, filter) => {
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };
  // the clips: tile i (1..5) on texture unit i - 1
  tiles.forEach((tile, i) => {
    if (tile.intro) return;
    tile.unit = i - 1;
    tile.tex = newTex(tile.unit, gl.LINEAR_MIPMAP_LINEAR);
    gl.uniform1i(U[`uI${i}`], tile.unit);
  });
  // the noise-level field, a small grid stretched over the card, on unit 5
  const FIELD_UNIT = 5;
  const texT = newTex(FIELD_UNIT, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.uniform1i(U.uT, FIELD_UNIT);
  gl.uniform3f(U.uBg, 10 / 255, 10 / 255, 10 / 255);

  function upload(tile, src, w, h) {
    gl.activeTexture(gl.TEXTURE0 + tile.unit);
    gl.bindTexture(gl.TEXTURE_2D, tile.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    tile.hasImg = true;
    tile.iw = w;
    tile.ih = h;
  }
  function uploadVideo(tile) {
    const v = tile.video;
    if (v.readyState < 2 || !v.videoWidth) return;
    upload(tile, v, v.videoWidth, v.videoHeight);
    tile.lastT = v.currentTime;
    tile.dirty = false;
  }
  // until a clip can play, its poster stands in
  tiles.forEach(tile => {
    if (tile.intro || !tile.video.poster) return;
    const img = new Image();
    img.onload = () => { if (!tile.hasImg) upload(tile, img, img.naturalWidth, img.naturalHeight); };
    img.src = tile.video.poster;
  });

  const NX = 72;
  let NY = 72;
  let field = new Float32Array(NX * NY);
  let bytes = new Uint8Array(NX * NY);
  const BASE = 0.42;          // how noisy the tiles rest
  field.fill(BASE);

  let W = 1;
  let H = 1;
  let dprX = 1;
  let dprY = 1;
  const rects = new Float32Array(24);
  function measure() {
    const c = card.getBoundingClientRect();
    tiles.forEach((tile, i) => {
      const r = tile.el.getBoundingClientRect();
      tile.x = r.left - c.left;
      tile.y = r.top - c.top;
      tile.w = Math.max(1, r.width);
      tile.h = Math.max(1, r.height);
      rects.set([tile.x * dprX, (H - tile.y - tile.h) * dprY, tile.w * dprX, tile.h * dprY], i * 4);
    });
  }
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, card.clientWidth);
    H = Math.max(1, card.clientHeight);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    dprX = canvas.width / W;
    dprY = canvas.height / H;
    gl.viewport(0, 0, canvas.width, canvas.height);
    const ny = Math.max(24, Math.round(NX * (H / W)));
    if (ny !== NY) {
      NY = ny;
      field = new Float32Array(NX * NY).fill(BASE);
      bytes = new Uint8Array(NX * NY);
    }
    measure();
  }
  resize();
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(card);
  else window.addEventListener('resize', resize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);

  // stamp a soft round "denoise" into the field
  function denoise(px, py, radiusPx, strength, dt) {
    const sx = NX / W;
    const cx = px * sx;
    const cy = py * sx;
    const r = radiusPx * sx;
    const k = (1 - Math.exp(-dt / 0.07)) * strength;
    const x0 = Math.max(0, Math.floor(cx - 2 * r));
    const x1 = Math.min(NX - 1, Math.ceil(cx + 2 * r));
    const y0 = Math.max(0, Math.floor(cy - 2 * r));
    const y1 = Math.min(NY - 1, Math.ceil(cy + 2 * r));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const d2 = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) / (r * r);
        if (d2 > 4) continue;
        const w = Math.exp(-d2 * 1.6);
        const i = y * NX + x;
        field[i] -= field[i] * w * k;
      }
    }
  }

  /* ---------- focus: the tile being sampled clean ---------- */

  let rip = { x: 0, y: 0, t0: -1e9, s: 0 };
  const tileAt = (x, y) => tiles.findIndex(t => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h);

  let focus = -1;
  // auto: the tile is being sampled clean (nobody is pointing); otherwise it is only pointed at
  let autoFocus = false;
  function setFocus(i, auto = false) {
    if (i === focus && auto === autoFocus) return;
    focus = i;
    autoFocus = auto;
    tiles.forEach((t, j) => t.el.classList.toggle('is-focus', j === i));
    if (i > 0 && auto && tiles[i].label) resolve(tiles[i].label, tiles[i].title, 520);
  }

  // on load: one ripple from the top-left corner, and every tile resolves as it passes
  const LOAD = performance.now() + 200;
  const SPEED = 0.9;          // css px per ms, the same as the ripple in the shader
  tiles.forEach(t => {
    t.delay = Math.hypot(t.x + t.w / 2, t.y + t.h / 2) / SPEED;
    if (t.label) resolve(t.label, t.title, 900, 200 + t.delay);
  });
  rip = { x: 0, y: 0, t0: LOAD, s: 0.9 };
  const SWEEP = 1100;
  const ease = k => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
  const sweepOf = (t, now) => 1 - ease(clamp((now - LOAD - t.delay) / SWEEP, 0, 1));
  const loaded = Math.max(...tiles.map(t => t.delay)) + SWEEP + 500;

  // with nobody pointing, the projects take turns
  const ORDER = [1, 4, 2, 5, 3].filter(i => i < tiles.length);
  let autoAt = performance.now() + 200 + loaded;
  let autoK = 0;
  const AUTO = 2600;

  /* ---------- pointer ---------- */

  let pointer = null;
  let last = null;
  let lastAct = 0;
  let lastLogged = -1;
  const read = $('.hero-read', card);
  card.addEventListener('pointermove', e => {
    const r = card.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    card.classList.add('is-pointing');
    const i = tileAt(pointer.x, pointer.y);
    setFocus(i > 0 ? i : -1);
    const now = performance.now();
    if (i > 0 && i !== lastLogged) { lastLogged = i; act(`attend ${tiles[i].title.length > 16 ? `${tiles[i].title.slice(0, 15)}…` : tiles[i].title}`); lastAct = now; }
    else if (now - lastAct > 6000) { lastAct = now; act('denoise hero'); }
  });
  const leave = () => {
    pointer = null;
    last = null;
    lastLogged = -1;
    card.classList.remove('is-pointing');
    setFocus(-1);
    autoAt = performance.now() + 1200;
  };
  card.addEventListener('pointerleave', leave);
  card.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') {
      const r = card.getBoundingClientRect();
      pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    }
  });
  ['pointerup', 'pointercancel'].forEach(t => card.addEventListener(t, e => { if (e.pointerType === 'touch') leave(); }));

  /* ---------- the loop ---------- */

  const hasRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  if (hasRVFC) {
    tiles.forEach(tile => {
      if (tile.intro) return;
      const cb = () => { tile.dirty = true; tile.video.requestVideoFrameCallback(cb); };
      tile.video.requestVideoFrameCallback(cb);
    });
  }

  const crops = new Float32Array(24);
  const params = new Float32Array(24);
  let raf = 0;
  let prev = performance.now();

  function frame(now) {
    raf = 0;
    if (!heroOn || document.hidden) return;
    // a project transition is playing over the page: stop drawing and decoding underneath it
    if (document.documentElement.classList.contains('wam-on')) { playAll(false); return; }
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;

    // nobody pointing: hand the focus to the next project
    if (!pointer && now >= autoAt) {
      setFocus(ORDER[autoK % ORDER.length], true);
      autoK += 1;
      autoAt = now + AUTO;
    }

    // the field: noise returns everywhere, the cursor removes it
    const relax = 1 - Math.exp(-dt / 1.7);
    for (let i = 0; i < field.length; i += 1) field[i] += (BASE - field[i]) * relax;
    const rad = Math.max(60, Math.min(W, H) * 0.13);
    if (pointer) {
      if (last) {
        const dx = pointer.x - last.x;
        const dy = pointer.y - last.y;
        const n = Math.min(12, Math.ceil(Math.hypot(dx, dy) / (rad * 0.35)));
        for (let s = 1; s <= n; s += 1) denoise(last.x + dx * s / n, last.y + dy * s / n, rad, 1 / n + 0.35, dt);
      }
      denoise(pointer.x, pointer.y, rad, 1, dt);
      last = { ...pointer };
      const fx = clamp(Math.floor(pointer.x * NX / W), 0, NX - 1);
      const fy = clamp(Math.floor(pointer.y * NX / W), 0, NY - 1);
      const ti = tileAt(pointer.x, pointer.y);
      let t = field[fy * NX + fx];
      if (ti >= 0) t = (t + tiles[ti].extra * (1 - t)) * (1 - tiles[ti].clean);
      read.innerHTML = `<b>t</b> ${t.toFixed(2)} · step ${String(Math.round(t * 1000)).padStart(4, '0')}/1000`;
      read.style.transform = `translate(${Math.min(W - 150, pointer.x + 16)}px,${Math.min(H - 28, pointer.y + 16)}px)`;
    }

    for (let i = 0; i < field.length; i += 1) bytes[i] = clamp(field[i] * 255, 0, 255);
    gl.activeTexture(gl.TEXTURE0 + FIELD_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, texT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, NX, NY, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);

    // per tile: the load sweep, the focus, the clip
    const kc = 1 - Math.exp(-dt / 0.22);
    const kz = 1 - Math.exp(-dt / 0.5);
    tiles.forEach((tile, i) => {
      const focused = i === focus;
      const sampled = focused && autoFocus;
      const cleanTo = tile.intro ? 0.3 : (sampled ? 0.88 : 0);
      const extraTo = !tile.intro && autoFocus && focus > 0 && !focused ? 0.12 : 0;
      tile.clean += (cleanTo - tile.clean) * kc;
      tile.extra += (extraTo - tile.extra) * kc;
      tile.zoom += ((focused ? 1.03 : 1) - tile.zoom) * kz;
      const sweep = sweepOf(tile, now);
      params.set([1 - (1 - sweep) * (1 - tile.extra), tile.clean, tile.intro || tile.hasImg ? 1 : 0, 0], i * 4);

      if (tile.intro) return;
      const v = tile.video;
      if (tile.dirty || !tile.hasImg || (!hasRVFC && v.currentTime !== tile.lastT)) uploadVideo(tile);
      // cover-fit the clip, zoomed towards its focus point
      const A = tile.w / tile.h;
      const V = tile.iw / tile.ih;
      let sx = 1;
      let sy = 1;
      if (V > A) sx = A / V; else sy = V / A;
      sx /= tile.zoom;
      sy /= tile.zoom;
      crops.set([sx, sy, clamp(tile.fx - sx / 2, 0, 1 - sx), clamp(1 - tile.fy - sy / 2, 0, 1 - sy)], i * 4);
    });

    const age = Math.max(0, (now - rip.t0) / 1000);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform4fv(U.uRect, rects);
    gl.uniform4fv(U.uCrop, crops);
    gl.uniform4fv(U.uTile, params);
    gl.uniform1f(U.uRad, 12 * dprX);
    gl.uniform1f(U.uDpr, dprX);
    gl.uniform1f(U.uStep, Math.floor(now / 140));
    gl.uniform1f(U.uTime, now / 1000);
    gl.uniform4f(U.uRip, rip.x * dprX, (H - rip.y) * dprY, age, now < rip.t0 ? 0 : rip.s);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    raf = requestAnimationFrame(frame);
  }
  const start = () => { if (!raf) { prev = performance.now(); raf = requestAnimationFrame(frame); } };
  const playAll = on => vids.forEach(v => {
    if (!on) { v.pause(); return; }
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      heroOn = e.isIntersecting;
      playAll(heroOn);
      if (heroOn) start();
    }).observe(card);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
  // back from a project (page restored from the back/forward cache)
  window.addEventListener('pageshow', e => {
    if (!e.persisted) return;
    document.documentElement.classList.remove('wam-on');
    if (heroOn) { playAll(true); start(); }
  });
  playAll(true);
  start();

  // test hook
  window.__hero = { focus: (i, auto = true) => setFocus(i, auto), get current() { return focus; }, field: () => field, tiles };
})();


/* ---------- the rest of the page: log what the visitor does, the clock ---------- */

(() => {
  'use strict';
  const act = window.__act || (() => {});

  if ('IntersectionObserver' in window) {
    const seen = new Set();
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting && !seen.has(e.target.id)) { seen.add(e.target.id); act(`observe ${e.target.id}`); }
      });
    }, { rootMargin: '-30% 0px -50% 0px' });
    document.querySelectorAll('main .sec[id]').forEach(s => io.observe(s));
  }
  // the section you are reading (the last one whose top has passed 45% of the screen): its label turns purple
  const secs = [...document.querySelectorAll('main .sec[id]')];
  let hereQueued = false;
  const markHere = () => {
    hereQueued = false;
    const line = window.innerHeight * 0.45;
    let cur = null;
    secs.forEach(s => { if (!s.hidden && s.getBoundingClientRect().top <= line) cur = s; });
    if (cur && cur.getBoundingClientRect().bottom < 0) cur = null;
    secs.forEach(s => s.classList.toggle('is-here', s === cur));
  };
  window.addEventListener('scroll', () => { if (!hereQueued) { hereQueued = true; requestAnimationFrame(markHere); } }, { passive: true });
  markHere();
  const hovered = new Map();
  document.querySelectorAll(".proj-card").forEach(a => {
    a.addEventListener('mouseenter', () => {
      const now = performance.now();
      if (now - (hovered.get(a) || -1e9) < 4000) return;
      hovered.set(a, now);
      const name = a.querySelector('b')?.textContent || 'project';
      act(`hover ${name.length > 18 ? `${name.slice(0, 17)}…` : name}`);
    });
  });
  const marks = [25, 50, 75, 100];
  window.addEventListener('scroll', () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const pct = max > 0 ? (window.scrollY / max) * 100 : 0;
    while (marks.length && pct >= marks[0] - 0.5) act(`scroll ${marks.shift()}%`);
  }, { passive: true });

  const clock = document.querySelector('[data-clock]');
  if (clock) {
    const fmt = new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
    const tick = () => { clock.textContent = fmt.format(new Date()).replace('a.m.', 'am').replace('p.m.', 'pm'); };
    tick();
    setInterval(tick, 30000);
  }
})();
