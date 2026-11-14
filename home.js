/* =========================================================
   Max Yuan · home page
   The hero is a diffusion sample of a project clip. Every pixel has
   a noise level t (0 = the clip, 1 = pure noise); the image is mixed
   with Gaussian noise the way a diffusion model's forward process
   does it, and blurred more where t is high so structure comes back
   coarse-to-fine. Your cursor denoises the area around it; behind it
   the noise slowly returns. Every few seconds the whole card is
   noised up and a different project is sampled.

   Also here: the header colour over the hero, the hero line that
   resolves letter by letter, the action log in the corner, the clock.
   ========================================================= */

(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  /* ---------- the hero line resolves letter by letter, and stays a little noisy ---------- */

  const GLYPHS = 'abcdefghijklmnopqrstuvwxyz';
  const rndGlyph = c => {
    const g = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    return c === c.toUpperCase() ? g.toUpperCase() : g;
  };
  function wrapText(el) {
    const text = el.textContent.trim();
    el.textContent = '';
    const sr = document.createElement('span');
    sr.className = 'sr';
    sr.textContent = text;
    const vis = document.createElement('span');
    vis.setAttribute('aria-hidden', 'true');
    vis.textContent = text;
    el.append(sr, vis);
    return { text, vis, sr };
  }
  function resolve(t, text, dur = 1100) {
    t.text = text;
    t.sr.textContent = text;
    if (reduce) { t.vis.textContent = text; return Promise.resolve(); }
    const settle = [...text].map((_, i) => (i / text.length) * 0.55 + Math.random() * 0.45);
    const t0 = performance.now();
    return new Promise(res => {
      const step = now => {
        const k = Math.min(1, (now - t0) / dur);
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
  const sampleLink = $('#hero-sample');
  const sampleK = $('.k', sampleLink);
  const sampleV = wrapText($('.v', sampleLink));
  resolve(line, line.text, 1500).then(() => flicker(line));

  /* ---------- the samples the hero cycles through ---------- */

  const SAMPLES = [
    { src: 'assets/brackey/card_loop.mp4', title: 'The Brackey Way', href: 'projects/brackey-way.html' },
    { src: 'assets/loops/quad.mp4', title: 'Go2 locomotion', href: 'projects/quadruped-ppo.html' },
    { src: 'assets/loops/rico.mp4', title: 'RICO', href: 'projects/rico-arm.html' },
    { src: 'assets/loops/pi05.mp4?v=2', title: 'π₀.5 pick and place', href: 'projects/pi05-pick-place.html' },
    { src: 'assets/loops/ftc.mp4', title: 'FTC team 18844', href: 'projects/ftc-18844.html' },
  ];
  const HOLD = 9000;          // ms each sample stays before the next is drawn

  const vidA = $('.hero-src', card);
  const vidB = vidA.cloneNode(false);
  vidB.removeAttribute('src');
  vidB.removeAttribute('poster');
  vidB.removeAttribute('autoplay');
  vidB.preload = 'auto';
  vidB.muted = true;
  vidA.muted = true;
  card.insertBefore(vidB, vidA.nextSibling);
  const vids = [vidA, vidB];
  let active = 0;
  let cur = 0;

  const read = $('.hero-read', card);

  /* ---------- WebGL ---------- */

  const canvas = $('.hero-gl', card);
  const gl = !reduce && canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false });
  if (!gl) {
    card.classList.add('no-gl');
    if (reduce) { vidA.pause(); vidA.removeAttribute('autoplay'); }
    return;
  }

  const VS = `#version 300 es
  in vec2 p;
  out vec2 vUv;
  void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

  const FS = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 o;
  uniform sampler2D uImg;
  uniform sampler2D uT;
  uniform vec2 uScale, uOff;
  uniform float uG, uStep, uHasImg;
  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float gauss(vec2 p){
    float u1 = max(hash(p), 1e-4);
    float u2 = hash(p + 17.17);
    return sqrt(-2.0 * log(u1)) * cos(6.2831853 * u2);
  }
  void main(){
    // noise level here: the field (0 = clean) pushed towards 1 by the global level
    float t = texture(uT, vec2(vUv.x, 1.0 - vUv.y)).r;
    t = clamp(t + uG * (1.0 - t), 0.0, 1.0);

    // coarse to fine: the noisier, the blurrier the picture under the noise
    vec2 uv = vUv * uScale + uOff;
    vec3 x0 = uHasImg > 0.5 ? textureLod(uImg, uv, t * t * 7.5).rgb : vec3(0.11, 0.12, 0.14);

    // Gaussian noise, a new draw every sampling step: soft blotches (smoothly
    // interpolated between 6 px cells) plus a finer grain with a little colour
    vec2 q = gl_FragCoord.xy / 6.0;
    vec2 qi = floor(q);
    vec2 qf = smoothstep(0.0, 1.0, fract(q));
    float sd = uStep * 1.37;
    float soft = mix(mix(gauss(qi + sd), gauss(qi + vec2(1.0, 0.0) + sd), qf.x),
                     mix(gauss(qi + vec2(0.0, 1.0) + sd), gauss(qi + vec2(1.0, 1.0) + sd), qf.x), qf.y);
    vec2 cell = floor(gl_FragCoord.xy / 2.0);
    vec3 fine = vec3(gauss(cell + uStep * 2.11), gauss(cell + uStep * 3.07 + 9.1), gauss(cell + uStep * 4.13 + 21.3));
    fine = mix(vec3(fine.r), fine, 0.35);
    vec3 eps = vec3(soft) * 0.85 + fine * 0.4;

    // the forward process with a cosine schedule: x_t = sqrt(a) x_0 + sqrt(1 - a) eps
    float a = cos(t * 1.5707963);
    a *= a;
    vec3 xt = sqrt(a) * (x0 * 2.0 - 1.0) + sqrt(1.0 - a) * eps * 0.42;
    vec3 c = clamp(xt * 0.5 + 0.5, 0.0, 1.0);

    // noisy areas drift towards a cool grey; clean areas keep their colour
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, vec3(l) * vec3(0.95, 0.99, 1.05), t * 0.5);

    // a thin blue contour where the clean patch meets the noise
    float rim = smoothstep(0.14, 0.26, t) * (1.0 - smoothstep(0.26, 0.4, t));
    c += vec3(0.30, 0.52, 1.0) * rim * 0.34;

    o = vec4(c, 1.0);
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
  ['uImg', 'uT', 'uScale', 'uOff', 'uG', 'uStep', 'uHasImg'].forEach(n => { U[n] = gl.getUniformLocation(prog, n); });

  // the picture
  const texImg = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texImg);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(U.uImg, 0);
  let hasImg = false;
  let imgW = 16;
  let imgH = 9;

  // the noise-level field, a small grid stretched over the card
  const NX = 72;
  let NY = 72;
  let field = new Float32Array(NX * NY);
  let bytes = new Uint8Array(NX * NY);
  const texT = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.uniform1i(U.uT, 1);

  const BASE = 0.5;           // how noisy the card rests
  let W = 0;
  let H = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = card.clientWidth;
    H = card.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const ny = Math.max(24, Math.round(NX * (H / Math.max(1, W))));
    if (ny !== NY) {
      NY = ny;
      field = new Float32Array(NX * NY).fill(BASE);
      bytes = new Uint8Array(NX * NY);
    }
  }
  field.fill(BASE);
  resize();
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(card);
  else window.addEventListener('resize', resize);

  function uploadVideo(v) {
    if (v.readyState < 2 || !v.videoWidth) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texImg);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    hasImg = true;
    imgW = v.videoWidth;
    imgH = v.videoHeight;
  }

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

  /* ---------- pointer ---------- */

  let pointer = null;
  let last = null;
  let lastAct = 0;
  card.addEventListener('pointermove', e => {
    const r = card.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    card.classList.add('is-pointing');
    const now = performance.now();
    if (now - lastAct > 6000) { lastAct = now; act('denoise hero'); }
  });
  card.addEventListener('pointerleave', () => { pointer = null; last = null; card.classList.remove('is-pointing'); });
  card.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') {
      const r = card.getBoundingClientRect();
      pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    }
  });
  ['pointerup', 'pointercancel'].forEach(t => card.addEventListener(t, e => { if (e.pointerType === 'touch') { pointer = null; last = null; } }));

  /* ---------- sampling a new project: noise everything, swap the clip, denoise ---------- */

  let g = 1;                  // global extra noise: starts as pure noise, the first sample is drawn on load
  let gFrom = 1;
  let gTo = 0;
  let gT0 = performance.now() + 150;
  let gDur = 1700;
  const ease = k => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
  const tweenG = (to, dur) => new Promise(res => {
    gFrom = g; gTo = to; gT0 = performance.now(); gDur = dur;
    setTimeout(res, dur);
  });
  const waitReady = (v, ms) => new Promise(res => {
    if (v.readyState >= 2) return res();
    const done = () => { v.removeEventListener('loadeddata', done); res(); };
    v.addEventListener('loadeddata', done);
    setTimeout(done, ms);
  });

  function preload(i) {
    const v = vids[1 - active];
    if (v.dataset.src !== SAMPLES[i].src) {
      v.dataset.src = SAMPLES[i].src;
      v.src = SAMPLES[i].src;
      v.load();
    }
  }
  vidA.dataset.src = SAMPLES[0].src;

  let swapping = false;
  async function next() {
    if (swapping) return;
    swapping = true;
    const n = (cur + 1) % SAMPLES.length;
    preload(n);
    await tweenG(1, 700);
    const v = vids[1 - active];
    await waitReady(v, 4000);
    try { v.currentTime = 0; } catch (e) { /* not seekable yet */ }
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
    vids[active].pause();
    active = 1 - active;
    cur = n;
    uploadVideo(v);
    sampleK.textContent = `sample ${String(n + 1).padStart(2, '0')}`;
    sampleLink.href = SAMPLES[n].href;
    resolve(sampleV, SAMPLES[n].title, 900);
    act(`sample ${String(n + 1).padStart(2, '0')}`);
    await tweenG(0, 1500);
    swapping = false;
    lastSwap = performance.now();
  }
  let lastSwap = performance.now();

  /* ---------- the loop ---------- */

  let raf = 0;
  let prev = performance.now();
  let frameDirty = true;
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const watch = v => {
      const cb = () => { if (v === vids[active]) frameDirty = true; v.requestVideoFrameCallback(cb); };
      v.requestVideoFrameCallback(cb);
    };
    vids.forEach(watch);
  }
  const hasRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

  function frame(now) {
    raf = 0;
    if (!heroOn || document.hidden) return;
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;

    // global level
    if (now >= gT0) {
      const k = Math.min(1, (now - gT0) / gDur);
      g = gFrom + (gTo - gFrom) * ease(k);
    }

    // the field: noise returns everywhere, the cursor (or a wandering point) removes it
    const relax = 1 - Math.exp(-dt / 1.7);
    for (let i = 0; i < field.length; i += 1) field[i] += (BASE - field[i]) * relax;
    const rad = Math.max(70, Math.min(W, H) * 0.15);
    if (pointer) {
      if (last) {
        const dx = pointer.x - last.x;
        const dy = pointer.y - last.y;
        const n = Math.min(12, Math.ceil(Math.hypot(dx, dy) / (rad * 0.35)));
        for (let s = 1; s <= n; s += 1) denoise(last.x + dx * s / n, last.y + dy * s / n, rad, 1 / n + 0.35, dt);
      }
      denoise(pointer.x, pointer.y, rad, 1, dt);
      last = { ...pointer };
      // the readout: noise level and step under the cursor
      const fx = Math.min(NX - 1, Math.max(0, Math.floor(pointer.x * NX / W)));
      const fy = Math.min(NY - 1, Math.max(0, Math.floor(pointer.y * NX / W)));
      const t = field[fy * NX + fx] + g * (1 - field[fy * NX + fx]);
      read.innerHTML = `<b>t</b> ${t.toFixed(2)} · step ${String(Math.round(t * 1000)).padStart(4, '0')}/1000`;
      const rx = Math.min(W - 150, pointer.x + 16);
      const ry = Math.min(H - 28, pointer.y + 16);
      read.style.transform = `translate(${rx}px,${ry}px)`;
    } else {
      // nobody is pointing: a slow wandering patch keeps the picture alive
      const s = now / 1000;
      denoise(W * (0.5 + 0.3 * Math.sin(s * 0.37)), H * (0.5 + 0.28 * Math.sin(s * 0.53 + 1.3)), rad * 1.1, 0.55, dt);
    }

    for (let i = 0; i < field.length; i += 1) bytes[i] = Math.max(0, Math.min(255, field[i] * 255));
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, NX, NY, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);

    const v = vids[active];
    if (!hasRVFC || frameDirty || !hasImg) { uploadVideo(v); frameDirty = false; }

    // cover-fit the clip
    const A = W / Math.max(1, H);
    const V = imgW / imgH;
    let sx = 1;
    let sy = 1;
    if (V > A) sx = A / V; else sy = V / A;
    gl.uniform2f(U.uScale, sx, sy);
    gl.uniform2f(U.uOff, (1 - sx) / 2, (1 - sy) / 2);
    gl.uniform1f(U.uG, g);
    gl.uniform1f(U.uStep, Math.floor(now / 83));
    gl.uniform1f(U.uHasImg, hasImg ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (!swapping && !pointer && now - lastSwap > HOLD) next();
    raf = requestAnimationFrame(frame);
  }
  const start = () => { if (!raf) { prev = performance.now(); raf = requestAnimationFrame(frame); } };

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      heroOn = e.isIntersecting;
      vids[active][heroOn ? 'play' : 'pause']();
      if (heroOn) start();
    }).observe(card);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
  const p0 = vidA.play();
  if (p0 && p0.catch) p0.catch(() => {});
  start();

  // test hook
  window.__hero = { next, get g() { return g; }, field: () => field };
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
  const hovered = new Map();
  document.querySelectorAll('.proj-card').forEach(a => {
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
