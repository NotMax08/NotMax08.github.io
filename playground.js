/* =========================================================
   Max Yuan · the robot world
   A small world of robot stations, one per project, painted at
   golden hour. You drive a BracketBot (click the floor, click a
   station, or use the keys); when it parks at a station, that
   station's robot does a short task from the project and the
   project card opens. Opening a project makes the world imagine
   the future first (see transition.js).
   It runs full screen on playground.html and as the opening view
   of the home page (data-mode="home" on the host element).
   Robots load from their real URDFs; motion is scripted with IK.
   ========================================================= */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadURDF, makeArm } from './urdf.js?v=2026-11-14b';   // bump with the pages' ?v=

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = sel => document.querySelector(sel);
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const ease = t => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DOWN = V(0, -1, 0);
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const params = new URLSearchParams(location.search);

const canvas = $('#world');
const host = canvas.parentElement;
const EMBED = host.dataset.mode === 'home';      // on the home page: the page scrolls past it

// props: warm pastels that sit in golden-hour light
const C = {
  top: '#f8f1e7', ink: '#1c1c1c',
  sky: '#9cc6e6', skyTint: '#d9e8f2', skyDeep: '#3b86d1',
  grass: '#93cf86', grassTint: '#d6ecc9',
  lavender: '#b7a5e0', lavTint: '#e6ddf1',
  sunshine: '#f4d978', sunTint: '#f7ebc0',
  sherbert: '#f19c91', sherbTint: '#f8d6cd',
  creamsicle: '#f3a568', creamTint: '#f7dcc4',
  butter: '#f2c47a', clayPeach: '#f4cfa6',
  lime: '#c2f04f',
};

/* ---------------------------------------------------------
   The light follows Waterloo: day, golden hour or night,
   dimmer when it's overcast there (Open-Meteo, no key)
   --------------------------------------------------------- */

const LOOKS = {
  day: {
    sky: ['#e7e3ea', '#f0ddd2', '#eec9ae'], floor: '#e8cbb3',
    sun: '#ffe6cc', sunI: 2.3, sunPos: [5, 6.5, 2.5], hemi: ['#f3eef4', '#d6a887', 1.05], env: 0.4,
    patch: '#fff1c8', patchA: 0.62, exposure: 1.0,
  },
  golden: {
    sky: ['#e4dce6', '#f1cdb6', '#eea77f'], floor: '#e6b998',
    sun: '#ffc995', sunI: 2.7, sunPos: [6.5, 3.4, 2.2], hemi: ['#efe1e6', '#c98763', 0.9], env: 0.35,
    patch: '#ffdb98', patchA: 0.75, exposure: 1.0,
  },
  night: {
    sky: ['#191726', '#272338', '#3d3350'], floor: '#4b4357',
    sun: '#a8b6ea', sunI: 0.7, sunPos: [-4, 7, 3], hemi: ['#5d5b85', '#2a2433', 0.7], env: 0.22,
    patch: '#b8c4ff', patchA: 0.16, exposure: 1.05,
  },
};
const WATERLOO = { lat: 43.4643, lon: -80.5204, tz: 'America/Toronto' };
const lookNow = { name: 'day', overcast: 0, weather: null };

function hourIn(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date());
  const h = Number(parts.find(p => p.type === 'hour').value) % 24;
  const m = Number(parts.find(p => p.type === 'minute').value);
  return h + m / 60;
}
function pickLook(sunrise, sunset) {
  if (params.get('light') && LOOKS[params.get('light')]) return params.get('light');
  const h = hourIn(WATERLOO.tz);
  const rise = sunrise ?? 7;
  const set = sunset ?? 17.5;
  if (h < rise - 0.5 || h > set + 0.6) return 'night';
  if (Math.abs(h - rise) < 1.3 || Math.abs(h - set) < 1.5) return 'golden';
  return 'day';
}

const status = $('#status');
const setStatus = (text, done = false) => {
  status.textContent = text;
  status.classList.toggle('is-done', done);
};

/* ---------------------------------------------------------
   Renderer, scene, light
   --------------------------------------------------------- */

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  status.innerHTML = 'This browser could not start WebGL. <a href="index.html#projects">Every project is listed here.</a>';
  throw e;
}
const isSmall = () => host.clientWidth < 640;
let pixelRatio = Math.min(window.devicePixelRatio, isSmall() ? 1.5 : 1.75);
renderer.setPixelRatio(pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#eec9ae', 13, 30);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;

const hemi = new THREE.HemisphereLight('#ffffff', '#d6a887', 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffffff', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6.5, right: 6.5, top: 6.5, bottom: -6.5, near: 0.5, far: 24 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 5;
sun.shadow.blurSamples = 12;
scene.add(sun, sun.target);

const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);

// the sky: a gradient behind everything, in screen space like a painted backdrop
const skyCanvas = document.createElement('canvas');
skyCanvas.width = 4;
skyCanvas.height = 256;
const skyTex = new THREE.CanvasTexture(skyCanvas);
skyTex.colorSpace = THREE.SRGBColorSpace;
scene.background = skyTex;
function paintSky(stops) {
  const g = skyCanvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, stops[0]);
  grad.addColorStop(0.38, stops[1]);
  grad.addColorStop(0.72, stops[2]);
  grad.addColorStop(1, stops[2]);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  skyTex.needsUpdate = true;
}

/* ---------- the painted look: Kuwahara brush strokes, and the "imagining" shift ---------- */

const PaintShader = {
  uniforms: {
    tDiffuse: { value: null },
    res: { value: new THREE.Vector2(1, 1) },
    spread: { value: 1.25 },
    paint: { value: 1 },
    imagine: { value: 0 },
    time: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 res;
    uniform float spread, paint, imagine, time;
    varying vec2 vUv;
    vec3 kuwahara(vec2 uv) {
      vec2 px = spread / res;
      vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0);
      vec3 s0 = vec3(0.0), s1 = vec3(0.0), s2 = vec3(0.0), s3 = vec3(0.0);
      for (int j = 0; j <= 3; j++) {
        for (int i = 0; i <= 3; i++) {
          vec2 o = vec2(float(i), float(j)) * px;
          vec3 c;
          c = texture2D(tDiffuse, uv + vec2(-o.x, -o.y)).rgb; m0 += c; s0 += c * c;
          c = texture2D(tDiffuse, uv + vec2( o.x, -o.y)).rgb; m1 += c; s1 += c * c;
          c = texture2D(tDiffuse, uv + vec2(-o.x,  o.y)).rgb; m2 += c; s2 += c * c;
          c = texture2D(tDiffuse, uv + vec2( o.x,  o.y)).rgb; m3 += c; s3 += c * c;
        }
      }
      m0 /= 16.0; m1 /= 16.0; m2 /= 16.0; m3 /= 16.0;
      float v0 = dot(s0 / 16.0 - m0 * m0, vec3(1.0));
      float v1 = dot(s1 / 16.0 - m1 * m1, vec3(1.0));
      float v2 = dot(s2 / 16.0 - m2 * m2, vec3(1.0));
      float v3 = dot(s3 / 16.0 - m3 * m3, vec3(1.0));
      vec3 m = m0; float v = v0;
      if (v1 < v) { v = v1; m = m1; }
      if (v2 < v) { v = v2; m = m2; }
      if (v3 < v) { v = v3; m = m3; }
      return m;
    }
    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec3 col = paint > 0.5 ? kuwahara(vUv) : base;
      col *= vec3(1.025, 1.0, 0.965);                       // a warm grade
      if (imagine > 0.001) {
        // the world turns into the model's latent picture of it: blocky, lime on black, scanned
        float blk = mix(1.0, 16.0, imagine * imagine);
        vec2 b = blk / res;
        vec2 uv2 = (floor(vUv / b) + 0.5) * b;
        vec3 c2 = texture2D(tDiffuse, uv2).rgb;
        float l = dot(c2, vec3(0.3, 0.59, 0.11));
        vec3 latent = mix(vec3(0.004, 0.006, 0.004), vec3(0.54, 0.87, 0.08), smoothstep(0.12, 0.85, l));
        col = mix(col, latent, smoothstep(0.2, 1.0, imagine));
        col *= 1.0 - imagine * 0.35 * step(0.5, fract(gl_FragCoord.y * 0.5));
        col *= 1.0 - 0.55 * imagine * imagine;
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
};
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const paintPass = new ShaderPass(PaintShader);
composer.addPass(paintPass);
composer.addPass(new OutputPass());
const PAINT = paintPass.uniforms;
let usePost = true;

/* ---------------------------------------------------------
   Materials and small builders
   --------------------------------------------------------- */

const matCache = new Map();
const cached = (key, make) => {
  if (!matCache.has(key)) matCache.set(key, make());
  return matCache.get(key);
};
// soft toy plastic: a little gloss, mostly matte so the paint filter reads
const robotMat = hex => cached(`r${hex}`, () => new THREE.MeshPhysicalMaterial({
  color: hex, roughness: 0.55, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.4,
}));
const propMat = hex => cached(`p${hex}`, () => new THREE.MeshPhysicalMaterial({
  color: hex, roughness: 0.6, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.4,
}));
const matte = hex => cached(`m${hex}`, () => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.95, metalness: 0 }));

function mesh(geo, mat, { shadow = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
const box = (w, h, d, color, r = Math.min(w, h, d) * 0.2) => mesh(new RoundedBoxGeometry(w, h, d, 3, r), propMat(color));
const cyl = (rt, rb, h, color, seg = 32) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), propMat(color));

function roundedRect(w, d, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
// a faint rug under each station, half way between its colour and the floor
function rug(w, d, color, r = 0.16) {
  const g = new THREE.ShapeGeometry(roundedRect(w, d, r), 8);
  g.rotateX(-Math.PI / 2);
  const m = mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 1, transparent: true, opacity: 0.45, depthWrite: false }), { shadow: false });
  m.position.y = 0.002;
  return m;
}
// A pastel block with a pale top: the station's table. Its top surface is at height h.
function counter(w, d, h, color) {
  const g = new THREE.Group();
  const body = box(w, h - 0.02, d, color, 0.03);
  body.position.y = (h - 0.02) / 2;
  const top = box(w + 0.02, 0.03, d + 0.02, C.top, 0.012);
  top.position.y = h - 0.015;
  g.add(body, top);
  return g;
}

/* ---------------------------------------------------------
   Floor, and window light falling across it
   --------------------------------------------------------- */

const floorMat = new THREE.MeshStandardMaterial({ color: '#e8cbb3', roughness: 1, metalness: 0 });
const floor = mesh(new THREE.CircleGeometry(40, 96), floorMat, { shadow: false });
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
// a slightly paler plaza in the middle, where the BracketBot starts
const plazaMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, opacity: 0.16, depthWrite: false });
const plaza = mesh(new THREE.CircleGeometry(1.15, 72), plazaMat, { shadow: false });
plaza.rotation.x = -Math.PI / 2;
plaza.position.y = 0.001;
scene.add(plaza);

// tall window panes, slanted by a low sun, drawn soft and laid on the floor
function windowLight() {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 512;
  const g = cv.getContext('2d');
  g.filter = 'blur(7px)';
  g.fillStyle = '#fff';
  const panes = 7;
  for (let i = 0; i < panes; i += 1) {
    for (let row = 0; row < 2; row += 1) {
      const x = 70 + i * 128;
      const y = 60 + row * 210;
      const w = 104;
      const h = 180;
      const skew = 70;
      g.beginPath();
      g.moveTo(x + skew, y);
      g.lineTo(x + w + skew, y);
      g.lineTo(x + w, y + h);
      g.lineTo(x, y + h);
      g.closePath();
      g.globalAlpha = 0.75 + 0.25 * Math.sin(i * 1.7 + row);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: tex, color: '#fff3d1', transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 5.2), mat);
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = 0.32;
  m.position.set(-0.4, 0.004, 0.2);
  m.renderOrder = 1;
  scene.add(m);
  return m;
}
const patches = windowLight();

function applyLook(name, overcast = 0) {
  const L = LOOKS[name];
  lookNow.name = name;
  lookNow.overcast = overcast;
  const grey = c => new THREE.Color(c).lerp(new THREE.Color('#d2c9c6'), overcast * 0.22);
  paintSky(L.sky.map(c => `#${grey(c).getHexString()}`));
  scene.fog.color.copy(grey(L.sky[2]));
  floorMat.color.set(grey(L.floor));
  sun.color.set(L.sun);
  sun.intensity = L.sunI * (1 - 0.3 * overcast);
  sun.position.set(...L.sunPos);
  hemi.color.set(L.hemi[0]);
  hemi.groundColor.set(L.hemi[1]);
  hemi.intensity = L.hemi[2] * (1 + 0.2 * overcast);
  scene.environmentIntensity = L.env;
  patches.material.color.set(L.patch);
  patches.material.opacity = L.patchA * (1 - 0.35 * overcast);
  renderer.toneMappingExposure = L.exposure;
  plazaMat.opacity = name === 'night' ? 0.06 : 0.16;
  host.classList.toggle('is-night', name === 'night');
}
applyLook(pickLook());

/* ---------------------------------------------------------
   Tweens: a tiny promise-based timeline, advanced each frame
   --------------------------------------------------------- */

const tweens = [];
function tween(dur, fn) {
  return new Promise(resolve => tweens.push({ t: 0, dur: Math.max(dur, 1e-3), fn, resolve }));
}
const wait = s => tween(s, () => {});
function stepTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i -= 1) {
    const tw = tweens[i];
    tw.t += dt / tw.dur;
    tw.fn(clamp(tw.t, 0, 1));
    if (tw.t >= 1) {
      tweens.splice(i, 1);
      tw.resolve();
    }
  }
}

/* ---------------------------------------------------------
   Robots
   --------------------------------------------------------- */

const urdfUrl = path => new URL(path, document.baseURI).href;
// URDF colours, softened into the palette: near-black parts become charcoal
function colorFrom(rgba, fallback = '#e9e7e2') {
  if (!rgba) return fallback;
  const c = new THREE.Color().setRGB(rgba[0], rgba[1], rgba[2], THREE.SRGBColorSpace);
  const hsl = c.getHSL({});
  if (hsl.l < 0.18) return '#34343a';
  if (hsl.l > 0.86) return '#fbfbf8';
  return `#${c.getHexString(THREE.SRGBColorSpace)}`;
}

const ROBOTS = {
  bracketbot: {
    url: 'assets/robots/bracketbot/bracketbot.urdf',
    material: (link, m, rgba) => robotMat(colorFrom(rgba)),
  },
  yam: {
    url: 'assets/robots/yam/yam.urdf',
    // the real YAM is dark anodised aluminium; the fingers get a light pad colour
    material: link => robotMat(link.startsWith('tip_') ? '#e9e5dc' : link === 'base' ? '#45454c' : '#2f2f35'),
  },
  so101: {
    url: 'assets/robots/so101/so101.urdf',
    material: (link, m, rgba) => robotMat(m === 'sts3215' ? '#2f2f35' : '#ffe27a'),
  },
  piper: {
    url: 'assets/robots/piper/piper.urdf',
    material: link => robotMat(link === 'link6' || link === 'link7' || link === 'link8' ? '#3a3a40' : '#e6e7eb'),
  },
  go2: {
    url: 'assets/robots/go2/go2.urdf',
    material: (link, m, rgba) => robotMat(colorFrom(rgba) === '#34343a' ? '#2f2f35' : '#d9dbe0'),
  },
};

let loaded = 0;
async function loadRobot(key) {
  const def = ROBOTS[key];
  const r = await loadURDF(urdfUrl(def.url), def.material);
  loaded += 1;
  setStatus(`Loading robots… ${loaded}/${Object.keys(ROBOTS).length}`);
  return r;
}

/* ---------------------------------------------------------
   Stations
   Each has a local frame whose +z faces the middle of the world.
   The BracketBot parks at (0, 0, dock) in that frame, facing -z.
   --------------------------------------------------------- */

const STATIONS = [
  {
    id: 'brackey', title: 'The Brackey Way', line: 'A dual-arm robot that makes a sandwich · 1st, BOTS',
    tags: ['π₀', 'OpenCV', 'Inverse kinematics'], href: 'projects/brackey-way.html',
    robot: 'In this scene: BracketBot, the robot from the project', color: C.creamsicle, tint: C.creamTint,
    pos: [0, -2.75], dock: 0.28, camTurn: 0.75, camEl: 0.78, camR: 3.3, rug: [1.5, 1.35, 0.25],
  },
  {
    id: 'pi05', title: 'π₀.5 pick and place', line: 'A VLA fine-tuned for a humanoid arm',
    tags: ['π₀.5', 'LeRobot', 'Isaac Sim'], href: 'projects/pi05-pick-place.html',
    robot: 'In this scene: YAM arm by I2RT Robotics', color: C.lavender, tint: C.lavTint,
    pos: [-2.55, -1.75], dock: 0.56, rug: [1.3, 1.55, 0.3],
  },
  {
    id: 'rico', title: 'RICO', line: 'An arm that hands you the tool you ask for',
    tags: ['YOLOv8', 'Inverse kinematics', 'Groq LLM'], href: 'projects/rico-arm.html',
    robot: 'In this scene: SO-101 arm', color: C.sky, tint: C.skyTint,
    pos: [2.55, -1.75], dock: 0.55, rug: [1.2, 1.5, 0.3],
  },
  {
    id: 'quad', title: 'Go2 locomotion', line: 'A quadruped walking policy, trained from scratch',
    tags: ['Isaac Lab', 'PPO', 'rsl_rl'], href: 'projects/quadruped-ppo.html',
    robot: 'In this scene: Unitree Go2', color: C.grass, tint: C.grassTint,
    pos: [-3.25, 1.05], dock: 1.25, rug: null, camR: 3.6,
  },
  {
    id: 'ftc', title: 'FTC team 18844', line: 'Pathing and vision for a FIRST Worlds robot',
    tags: ['Java', 'PID control', 'OpenCV'], href: 'projects/ftc-18844.html',
    robot: 'In this scene: PiPER arm by AgileX Robotics', color: C.sherbert, tint: C.sherbTint,
    pos: [3.2, 0.95], dock: 0.56, rug: [1.35, 1.55, 0.3],
  },
  {
    id: 'maze', title: 'Maze navigation', line: 'Maps an unseen maze, then drives to the goal',
    tags: ['ROS2', 'Nav2', 'SLAM Toolbox'], href: 'projects/maze-nav2.html',
    robot: 'In this scene: a small differential-drive robot', color: C.sky, tint: C.skyTint,
    pos: [-1.6, 2.75], dock: 0.95, rug: null, camR: 3.2,
  },
  {
    id: 'studybuddy', title: 'StudyBuddy 9520', line: 'A turret that fires when you get distracted · 2nd, RythmHacks',
    tags: ['YOLOv8', 'C++', 'PID control'], href: 'https://devpost.com/software/study-buddy-9520', external: true,
    robot: 'In this scene: a pan-tilt turret', color: C.sunshine, tint: C.sunTint,
    pos: [1.75, 2.6], dock: 0.55, rug: [1.1, 1.2, 0.28],
  },
];
const byId = Object.fromEntries(STATIONS.map(s => [s.id, s]));

STATIONS.forEach(st => {
  const [x, z] = st.pos;
  st.group = new THREE.Group();
  st.group.position.set(x, 0, z);
  st.group.rotation.y = Math.atan2(-x, -z);       // local +z points at the middle
  scene.add(st.group);
  if (st.rug) {
    const [w, d, back] = st.rug;
    const r = rug(w, d, st.tint);
    r.position.z = d / 2 - back - 0.3;
    st.group.add(r);
  }
  st.obstacles = [];         // local rectangles {x, z, w, d} or circles {x, z, r}
  st.anchorY = 0.95;
  st.running = false;
  st.group.updateMatrixWorld(true);
  st.dockWorld = st.group.localToWorld(V(0, 0, st.dock));
  const fwd = V(0, 0, -1).applyQuaternion(st.group.quaternion);     // the bot faces the station
  st.dockHeading = Math.atan2(-fwd.z, fwd.x);
  st.at = (lx, ly, lz) => st.group.localToWorld(V(lx, ly, lz));
});

// put a robot's base on a station, its forward (+x) turned to face local +z
function mount(st, robot, x, y, z, yaw = -Math.PI / 2) {
  robot.base.position.set(x, y, z);
  robot.base.rotation.y = yaw;
  st.group.add(robot.base);
  st.group.updateMatrixWorld(true);
}

// pick obj (its centre at the tool) from where it is, and leave it centred at `to` (station local)
async function pickPlace(st, arm, obj, to, { lift = 0.1, grip = 0.35, speed = 1, dir = DOWN, after } = {}) {
  const from = obj.getWorldPosition(V());
  const dest = st.at(...to);
  const up = v => v.clone().add(V(0, lift, 0));
  const q1 = arm.solve(up(from), dir, arm.home);
  const q2 = arm.solve(from, dir, q1);
  const q3 = arm.solve(up(dest), dir, q1);
  const q4 = arm.solve(dest, dir, q3);
  await arm.move(q1, 0.9 / speed, 1);
  await arm.move(q2, 0.55 / speed);
  await arm.gripTo(grip, 0.3);
  arm.tcp.attach(obj);
  await arm.move(q1, 0.5 / speed);
  await arm.move(q3, 0.9 / speed);
  await arm.move(q4, 0.5 / speed);
  await arm.gripTo(1, 0.3);
  st.group.attach(obj);
  if (after) await after();
  await arm.move(q3, 0.45 / speed);
  await arm.move(arm.home, 0.9 / speed, 0.6);
}

// a small "pop" back to a starting spot, for props the robots moved
function respawn(st, obj, pos, quat = new THREE.Quaternion()) {
  st.group.attach(obj);
  obj.position.set(...pos);
  obj.quaternion.copy(quat);
  if (reduceMotion) return Promise.resolve();
  return tween(0.35, k => obj.scale.setScalar(Math.max(0.001, ease(k))));
}

/* ---------- π₀.5 pick and place: a YAM puts a cube in a tray ---------- */

async function buildPi05(st, yam) {
  const H = 0.42;
  const table = counter(0.8, 0.52, H, st.color);
  table.position.z = -0.02;
  st.group.add(table);
  st.obstacles.push({ x: 0, z: -0.02, w: 0.82, d: 0.54 });
  mount(st, yam, 0, H, -0.17);
  const tray = new THREE.Group();
  const floorT = box(0.15, 0.012, 0.15, C.sky, 0.005);
  floorT.position.y = 0.006;
  tray.add(floorT);
  [[0, 0.075, 0.15, 0.012], [0, -0.075, 0.15, 0.012], [0.075, 0, 0.012, 0.15], [-0.075, 0, 0.012, 0.15]].forEach(([x, z, w, d]) => {
    const wall = box(w, 0.035, d, C.sky, 0.005);
    wall.position.set(x, 0.0175, z);
    tray.add(wall);
  });
  tray.position.set(0.17, H, 0.1);
  st.group.add(tray);
  const cube = box(0.04, 0.04, 0.04, C.sunshine, 0.006);
  const CUBE_AT = [-0.17, H + 0.02, 0.1];
  cube.position.set(...CUBE_AT);
  st.group.add(cube);

  const J = n => yam.joints[n];
  const arm = makeArm(yam, {
    joints: ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6'],
    name: 'yam', hand: 'gripper', fingers: ['tip_left', 'tip_right'],
    grip: v => { J('joint7').set(-0.047 * v); J('joint8').set(-0.047 * v); },
    seeds: [[0, 1.2, 1.0, -0.6, 0, 0], [0, 1.8, 1.5, -0.9, 0, 0], [0.6, 1.5, 1.2, -0.8, 0, 0], [-0.6, 1.5, 1.2, -0.8, 0, 0]],
  });
  arm.home = [0, 0, 0, 0, 0, 0];
  arm.set(arm.home);
  arm.grip(0.6);
  st.arms = [arm];
  let moved = false;
  st.act = async () => {
    if (moved) await respawn(st, cube, CUBE_AT);
    await pickPlace(st, arm, cube, [0.17, H + 0.012 + 0.02, 0.1], { grip: 0.3 });
    moved = true;
  };
}

/* ---------- RICO: an SO-101 hands over the screwdriver ---------- */

async function buildRico(st, so) {
  const H = 0.42;
  const table = counter(0.7, 0.5, H, st.color);
  st.group.add(table);
  st.obstacles.push({ x: 0, z: 0, w: 0.72, d: 0.52 });
  mount(st, so, 0, H, -0.13);
  // a tool tray with a screwdriver and a wrench
  const tray = box(0.24, 0.016, 0.14, C.top, 0.006);
  tray.position.set(-0.19, H + 0.008, 0.08);
  st.group.add(tray);
  const driver = new THREE.Group();
  const handle = cyl(0.011, 0.011, 0.065, C.sherbert, 20);
  handle.rotation.z = Math.PI / 2;
  handle.position.x = -0.03;
  const shaft = cyl(0.0035, 0.0035, 0.07, '#9aa0a8', 12);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = 0.035;
  driver.add(handle, shaft);
  const DRIVER_AT = [-0.19, H + 0.027, 0.055];
  const DRIVER_Q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI / 2);
  driver.position.set(...DRIVER_AT);
  driver.quaternion.copy(DRIVER_Q);
  st.group.add(driver);
  const wrench = box(0.11, 0.008, 0.016, '#a9aeb6', 0.004);
  wrench.position.set(-0.19, H + 0.02, 0.115);
  wrench.rotation.y = 0.2;
  st.group.add(wrench);

  const arm = makeArm(so, {
    joints: ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll'],
    name: 'so101', hand: 'gripper_link', tcpLink: 'gripper_frame_link',
    grip: v => so.joints.gripper.set(0.05 + 1.25 * v),
    seeds: [[0, -0.2, 0.6, 0.8, 0], [0.5, 0, 0.4, 1, 0], [-0.5, 0, 0.4, 1, 0], [0, 0.6, -0.2, 1.2, 0]],
  });
  st.group.updateMatrixWorld(true);
  arm.home = arm.solve(st.at(0, H + 0.17, -0.02), DOWN, [0, -0.2, 0.6, 0.8, 0]);
  arm.set(arm.home);
  arm.grip(0.2);
  st.arms = [arm];
  st.act = async () => {
    say('Hand me the screwdriver.', () => bot.headWorld(), 2.2);
    await wait(0.9);
    const from = driver.getWorldPosition(V());
    const tilt = V(0, -1, 0.25).normalize();
    const q1 = arm.solve(from.clone().add(V(0, 0.08, 0)), tilt, arm.home);
    const q2 = arm.solve(from, tilt, q1);
    await arm.move(q1, 0.8, 1);
    await arm.move(q2, 0.5);
    await arm.gripTo(0.15, 0.3);
    arm.tcp.attach(driver);
    // hold it out towards the visitor's robot
    const offer = st.at(0.02, H + 0.2, 0.17);
    const q3 = arm.solve(offer, V(0, -0.2, 1).applyQuaternion(st.group.quaternion).normalize(), q1);
    await arm.move(q1, 0.45);
    await arm.move(q3, 0.9);
    await wait(1.3);
    await arm.move(q1, 0.9);
    await arm.move(q2, 0.5);
    await arm.gripTo(1, 0.25);
    st.group.attach(driver);
    driver.position.set(...DRIVER_AT);
    driver.quaternion.copy(DRIVER_Q);
    await arm.move(q1, 0.4);
    await arm.move(arm.home, 0.8, 0.2);
  };
}

/* ---------- FTC: a PiPER scores a sample in the basket ---------- */

async function buildFtc(st, piper) {
  const H = 0.42;
  const table = counter(0.84, 0.54, H, st.color);
  table.position.z = -0.02;
  st.group.add(table);
  st.obstacles.push({ x: 0, z: -0.02, w: 0.86, d: 0.56 });
  mount(st, piper, 0, H, -0.18);
  // FTC "Into the Deep" samples: yellow, red and blue bricks
  const sample = c => box(0.07, 0.03, 0.03, c, 0.006);
  const yellow = sample(C.sunshine);
  const SAMPLE_AT = [-0.2, H + 0.015, 0.09];
  yellow.position.set(...SAMPLE_AT);
  const red = sample('#f27d7f');
  red.position.set(-0.24, H + 0.015, 0.16);
  red.rotation.y = 0.5;
  const blue = sample(C.sky);
  blue.position.set(-0.13, H + 0.015, 0.17);
  blue.rotation.y = -0.3;
  st.group.add(yellow, red, blue);
  // the basket: an open box
  const basket = new THREE.Group();
  const bh = 0.12;
  [[0, 0.06, 0.13, 0.01], [0, -0.06, 0.13, 0.01], [0.06, 0, 0.01, 0.13], [-0.06, 0, 0.01, 0.13]].forEach(([x, z, w, d]) => {
    const wall = box(w, bh, d, C.grass, 0.004);
    wall.position.set(x, bh / 2, z);
    basket.add(wall);
  });
  const bottom = box(0.13, 0.01, 0.13, C.grass, 0.004);
  bottom.position.y = 0.005;
  basket.add(bottom);
  basket.position.set(0.2, H, 0.06);
  st.group.add(basket);

  const J = n => piper.joints[n];
  const arm = makeArm(piper, {
    joints: ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6'],
    name: 'piper', hand: 'gripper_base', fingers: ['link7', 'link8'],
    grip: v => { J('joint7').set(0.035 * v); J('joint8').set(-0.035 * v); },
    seeds: [[0, 1.2, -1.2, 0, 0.8, 0], [0, 1.6, -1.6, 0, 1.0, 0], [0.5, 1.4, -1.4, 0, 0.9, 0], [-0.5, 1.4, -1.4, 0, 0.9, 0],
      [0, 1.2, -1.2, 0, -0.8, 0], [0, 1.0, -1.8, 0, 0.6, 0]],
  });
  arm.home = [0, 0, 0, 0, 0, 0];
  arm.set(arm.home);
  arm.grip(0.4);
  st.arms = [arm];
  let moved = false;
  st.act = async () => {
    if (moved) await respawn(st, yellow, SAMPLE_AT);
    // grip across the brick's short side: turn the wrist with the last joint
    await pickPlace(st, arm, yellow, [0.2, H + bh + 0.07, 0.06], {
      lift: 0.12, grip: 0.2,
      after: async () => {
        // let go above the basket and let it drop in
        const p = yellow.position.clone();
        await tween(0.35, k => { yellow.position.y = lerp(p.y, H + 0.02, k * k); });
      },
    });
    moved = true;
  };
}

/* ---------- The Brackey Way: the BracketBot itself takes toast out of the toaster ---------- */

function buildBrackey(st) {
  const H = 0.5;
  const table = counter(0.9, 0.42, H, st.color);
  table.position.z = -0.05;
  st.group.add(table);
  st.obstacles.push({ x: 0, z: -0.05, w: 0.92, d: 0.44 });
  // toaster on the right of the parked robot (its right arm's side), plate in the middle
  const toaster = new THREE.Group();
  const body = box(0.13, 0.13, 0.2, C.sky, 0.03);
  body.position.y = 0.065;
  toaster.add(body);
  [-0.025, 0.025].forEach(x => {
    const slot = box(0.016, 0.006, 0.13, '#3a3a40', 0.003);
    slot.position.set(x, 0.13, 0);
    toaster.add(slot);
  });
  const lever = box(0.02, 0.012, 0.03, '#3a3a40', 0.004);
  lever.position.set(0.07, 0.09, 0);
  toaster.add(lever);
  const TX = 0.13;      // toaster, in front of the right arm
  const TZ = 0.035;
  const PX = -0.03;     // plate, between the arms
  const PZ = 0.08;
  toaster.position.set(TX, H, TZ);
  st.group.add(toaster);
  const plate = cyl(0.08, 0.066, 0.014, '#ffffff', 40);
  plate.position.set(PX, H + 0.007, PZ);
  st.group.add(plate);
  const toast = box(0.012, 0.1, 0.1, C.butter, 0.006);
  const TOAST_AT = [TX + 0.025, H + 0.11, TZ];
  toast.position.set(...TOAST_AT);
  st.group.add(toast);
  const lettuce = mesh(new THREE.CylinderGeometry(0.042, 0.047, 0.012, 9), propMat(C.grass));
  const LETTUCE_AT = [-0.19, H + 0.006, 0.07];
  lettuce.position.set(...LETTUCE_AT);
  st.group.add(lettuce);
  st.anchorY = 1.0;

  let made = false;
  st.act = async () => {
    const arm = bot.armR;
    const left = bot.armL;
    if (made) {
      await Promise.all([
        respawn(st, toast, TOAST_AT),
        respawn(st, lettuce, LETTUCE_AT),
      ]);
    }
    // lower the arms' carriage to whichever height reaches the toast best
    const tp = toast.getWorldPosition(V()).add(V(0, 0.035, 0));
    const above = tp.clone().add(V(0, 0.1, 0));
    const rj0 = bot.robot.joints.rj0;
    const was = rj0.value;
    let best = { err: Infinity, c: -0.6 };
    for (let c = -0.4; c >= -0.85; c -= 0.05) {
      rj0.set(c);
      bot.robot.base.updateWorldMatrix(true, true);
      const err = arm.solve(above, DOWN, arm.home).err + arm.solve(tp, DOWN, arm.home).err;
      if (err < best.err - 1e-4) best = { err, c };
    }
    rj0.set(was);
    await bot.carriage(best.c, 1.1);
    bot.robot.base.updateWorldMatrix(true, true);
    const q1 = arm.solve(above, DOWN, arm.home);
    const q2 = arm.solve(tp, DOWN, q1);
    await arm.move(q1, 1.0, 1);
    await arm.move(q2, 0.5);
    await arm.gripTo(0.25, 0.3);
    arm.tcp.attach(toast);
    await arm.move(arm.solve(tp.clone().add(V(0, 0.14, 0)), DOWN, q2), 0.6);
    const pl = st.at(PX, H + 0.09, PZ);
    const q3 = arm.solve(pl, DOWN, q1);
    await arm.move(q3, 0.9);
    await arm.gripTo(1, 0.25);
    st.group.attach(toast);
    // the slice tips over and lies flat on the plate
    const q0 = toast.quaternion.clone();
    const flat = new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI / 2);
    const p0 = toast.position.clone();
    const p1 = V(PX, H + 0.014 + 0.006, PZ);
    await tween(0.4, k => {
      toast.quaternion.slerpQuaternions(q0, flat, ease(k));
      toast.position.lerpVectors(p0, p1, k * k);
    });
    // the right arm goes home while the left one adds the lettuce
    const rightHome = arm.move(arm.home, 1.0, 0.3);
    const lp = lettuce.getWorldPosition(V());
    const ql1 = left.solve(lp.clone().add(V(0, 0.1, 0)), DOWN, left.home);
    const ql2 = left.solve(lp, DOWN, ql1);
    const top = st.at(PX, H + 0.04, PZ);
    const ql3 = left.solve(top.clone().add(V(0, 0.09, 0)), DOWN, ql1);
    const ql4 = left.solve(top, DOWN, ql3);
    await left.move(ql1, 1.0, 1);
    await left.move(ql2, 0.45);
    await left.gripTo(0.2, 0.25);
    left.tcp.attach(lettuce);
    await left.move(ql1, 0.4);
    await left.move(ql3, 0.8);
    await left.move(ql4, 0.35);
    await left.gripTo(1, 0.2);
    st.group.attach(lettuce);
    await left.move(ql3, 0.35);
    await Promise.all([rightHome, left.move(left.home, 1.0, 0.3)]);
    await bot.carriage(bot.restCarriage, 0.9);
    made = true;
  };
}

/* ---------- Go2: stands up, trots a lap of its pen, lies down ---------- */

const LEGS = ['FL', 'FR', 'RL', 'RR'];
const PHASE = { FL: 0, RR: 0, FR: Math.PI, RL: Math.PI };
const POSE = {
  lie: { hip: 0, thigh: 1.22, calf: -2.68, rearThigh: 1.22 },
  stand: { hip: 0, thigh: 0.78, calf: -1.5, rearThigh: 0.95 },
};

function buildQuad(st, go2) {
  const R = 0.88;
  const pen = mesh(new THREE.CircleGeometry(R, 72), matte(st.tint), { shadow: false });
  pen.rotation.x = -Math.PI / 2;
  pen.position.y = 0.002;
  st.group.add(pen);
  // a low fence with a gap facing the middle
  const posts = new THREE.Group();
  const N = 30;
  for (let i = 0; i < N; i += 1) {
    const a = (i / N) * Math.PI * 2;
    if (Math.abs(wrap(a - Math.PI / 2)) < 0.33) continue;       // the gate, at local +z
    const p = cyl(0.016, 0.018, 0.13, C.grass, 12);
    p.position.set(Math.cos(a) * R, 0.065, Math.sin(a) * R);
    posts.add(p);
  }
  const rail = mesh(new THREE.TorusGeometry(R, 0.009, 8, 120, Math.PI * 2 - 0.62), propMat(C.grass));
  rail.rotation.x = Math.PI / 2;
  rail.rotation.z = Math.PI / 2 + 0.31;
  rail.position.y = 0.11;
  st.group.add(posts, rail);
  st.obstacles.push({ x: 0, z: 0, r: R + 0.05 });
  st.anchorY = 0.75;

  go2.base.rotation.y = 0;
  st.group.add(go2.base);
  const feet = LEGS.map(l => go2.links[`${l}_foot`].obj);
  const knees = LEGS.map(l => go2.links[`${l}_calf`].obj);
  const g = { x: 0, z: 0, yaw: -Math.PI / 2, pose: 0, phase: 0, walking: 0, breath: 0 };
  const tmp = V();

  function apply(dt) {
    const stand = g.pose;   // 0 lying, 1 standing
    LEGS.forEach(l => {
      const rear = l[0] === 'R';
      const thigh0 = lerp(rear ? POSE.lie.rearThigh : POSE.lie.thigh, rear ? POSE.stand.rearThigh : POSE.stand.thigh, stand);
      const calf0 = lerp(POSE.lie.calf, POSE.stand.calf, stand);
      const ph = g.phase + PHASE[l];
      const A = 0.24 * g.walking;
      const B = 0.55 * g.walking;
      go2.joints[`${l}_hip_joint`].set(0);
      go2.joints[`${l}_thigh_joint`].set(thigh0 - A * Math.cos(ph));
      go2.joints[`${l}_calf_joint`].set(calf0 - B * Math.max(0, -Math.sin(ph)));
    });
    go2.base.position.set(g.x, 0, g.z);
    go2.base.rotation.y = g.yaw;
    go2.base.updateMatrixWorld(true);
    // keep the lowest foot (or knee, when lying) on the ground
    let low = Infinity;
    feet.forEach(f => { low = Math.min(low, st.group.worldToLocal(f.getWorldPosition(tmp)).y - 0.022); });
    knees.forEach(k => { low = Math.min(low, st.group.worldToLocal(k.getWorldPosition(tmp)).y - 0.035); });
    g.breath += dt;
    go2.base.position.y = -low + (g.pose < 0.1 ? 0.003 * Math.sin(g.breath * 2.2) : 0);
  }
  apply(0);

  const SPEED = 0.42;
  async function walk(points) {
    for (const [tx, tz] of points) {
      await new Promise(resolve => {
        st.update = dt => {
          const dx = tx - g.x;
          const dz = tz - g.z;
          const dist = Math.hypot(dx, dz);
          const want = Math.atan2(-dz, dx);         // base +x is forward; yaw about +y
          const err = wrap(want - g.yaw);
          g.yaw += clamp(err, -2.6 * dt, 2.6 * dt);
          const v = dist < 0.01 ? 0 : SPEED * Math.max(0, Math.cos(err)) ** 2;
          const stepLen = Math.min(dist, v * dt);
          if (dist > 1e-4) { g.x += (dx / dist) * stepLen; g.z += (dz / dist) * stepLen; }
          g.phase += dt * Math.PI * 2 * 2.1;
          apply(dt);
          if (dist < 0.015) resolve();
        };
      });
    }
    st.update = idle;
  }
  const idle = dt => apply(dt);
  st.update = idle;

  st.act = async () => {
    await tween(0.9, k => { g.pose = ease(k); });
    await tween(0.3, k => { g.walking = k; });
    const r = 0.42;
    const lap = [];
    for (let i = 0; i <= 28; i += 1) {
      const a = (i / 28) * Math.PI * 2;
      lap.push([Math.cos(a) * r, -Math.sin(a) * r]);
    }
    await walk([[r, 0], ...lap, [0, 0]]);
    // turn to face the visitor, then settle
    await new Promise(resolve => {
      st.update = dt => {
        const err = wrap(-Math.PI / 2 - g.yaw);
        g.yaw += clamp(err, -2.4 * dt, 2.4 * dt);
        g.phase += dt * Math.PI * 2 * 2.1;
        apply(dt);
        if (Math.abs(err) < 0.02) resolve();
      };
    });
    st.update = idle;
    await tween(0.3, k => { g.walking = 1 - k; });
    await tween(0.9, k => { g.pose = 1 - ease(k); });
  };
}

/* ---------- Maze: map it (SLAM), plan a path (Nav2), drive to the goal ---------- */

function buildMaze(st) {
  const N = 7;
  const CELL = 0.16;
  const size = N * CELL;
  const base = box(size + 0.08, 0.03, size + 0.08, C.top, 0.012);
  base.position.y = 0.015;
  st.group.add(base);
  st.obstacles.push({ x: 0, z: 0, w: size + 0.1, d: size + 0.1 });
  st.anchorY = 0.55;
  const Y = 0.03;

  // a seeded random maze (depth-first carving)
  let seed = 9520;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const walls = Array.from({ length: N * N }, () => ({ n: true, s: true, e: true, w: true }));
  const idx = (i, j) => j * N + i;
  const seen = new Set([0]);
  const stack = [[0, 0]];
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const opts = [[i, j - 1, 'n', 's'], [i, j + 1, 's', 'n'], [i + 1, j, 'e', 'w'], [i - 1, j, 'w', 'e']]
      .filter(([a, b]) => a >= 0 && b >= 0 && a < N && b < N && !seen.has(idx(a, b)));
    if (!opts.length) { stack.pop(); continue; }
    const [a, b, d1, d2] = opts[Math.floor(rand() * opts.length)];
    walls[idx(i, j)][d1] = false;
    walls[idx(a, b)][d2] = false;
    seen.add(idx(a, b));
    stack.push([a, b]);
  }
  const cx = i => -size / 2 + CELL * (i + 0.5);       // cell centre, local x
  const cz = j => -size / 2 + CELL * (j + 0.5);       // local z; row 0 is at the back
  const wallMat = propMat(C.sky);
  const wallH = 0.06;
  const addWall = (x, z, w, d) => {
    const m = mesh(new RoundedBoxGeometry(w, wallH, d, 2, 0.006), wallMat);
    m.position.set(x, Y + wallH / 2, z);
    st.group.add(m);
  };
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const c = walls[idx(i, j)];
      if (c.n) addWall(cx(i), cz(j) - CELL / 2, CELL + 0.012, 0.012);
      if (c.w) addWall(cx(i) - CELL / 2, cz(j), 0.012, CELL + 0.012);
      if (j === N - 1 && c.s) addWall(cx(i), cz(j) + CELL / 2, CELL + 0.012, 0.012);
      if (i === N - 1 && c.e) addWall(cx(i) + CELL / 2, cz(j), 0.012, CELL + 0.012);
    }
  }
  // unknown space: grey tiles that clear as the robot maps them
  const fogMat = new THREE.MeshStandardMaterial({ color: '#d9d4c9', roughness: 1, transparent: true });
  const fog = [];
  const tileGeo = new THREE.BoxGeometry(CELL - 0.014, 0.004, CELL - 0.014);
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const t = new THREE.Mesh(tileGeo, fogMat.clone());
      t.position.set(cx(i), Y + 0.002, cz(j));
      t.receiveShadow = true;
      st.group.add(t);
      fog.push(t);
    }
  }
  // start in the front-left corner (nearest the visitor), goal at the back-right
  const start = [0, N - 1];
  const goal = [N - 1, 0];
  const flag = new THREE.Group();
  const pole = cyl(0.003, 0.003, 0.12, '#3a3a40', 8);
  pole.position.y = 0.06;
  const cloth = box(0.05, 0.03, 0.004, C.sherbert, 0.002);
  cloth.position.set(0.025, 0.105, 0);
  flag.add(pole, cloth);
  flag.position.set(cx(goal[0]), Y, cz(goal[1]));
  st.group.add(flag);

  // the robot: a little differential-drive base with a lidar on top
  const puck = new THREE.Group();
  const chassis = cyl(0.045, 0.045, 0.03, '#f4f4f1', 28);
  chassis.position.y = 0.022;
  const lidar = cyl(0.018, 0.02, 0.018, '#34343a', 20);
  lidar.position.y = 0.046;
  const nose = box(0.02, 0.01, 0.03, C.sky, 0.004);
  nose.position.set(0.03, 0.04, 0);
  puck.add(chassis, lidar, nose);
  st.group.add(puck);
  const home = () => { puck.position.set(cx(start[0]), Y, cz(start[1])); puck.rotation.y = Math.PI / 2; };
  home();
  // a lidar sweep fan
  const fan = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32, -0.45, 0.9),
    new THREE.MeshBasicMaterial({ color: C.sky, transparent: true, opacity: 0, depthWrite: false }));
  fan.rotation.x = -Math.PI / 2;
  fan.position.y = 0.03;
  puck.add(fan);

  // breadth-first distances through the open passages
  function bfs(from) {
    const dist = new Map([[idx(...from), 0]]);
    const prev = new Map();
    const q = [from];
    while (q.length) {
      const [i, j] = q.shift();
      const c = walls[idx(i, j)];
      const next = [];
      if (!c.n) next.push([i, j - 1]);
      if (!c.s) next.push([i, j + 1]);
      if (!c.e) next.push([i + 1, j]);
      if (!c.w) next.push([i - 1, j]);
      next.forEach(n => {
        const k = idx(...n);
        if (dist.has(k)) return;
        dist.set(k, dist.get(idx(i, j)) + 1);
        prev.set(k, [i, j]);
        q.push(n);
      });
    }
    return { dist, prev };
  }
  const { dist, prev } = bfs(start);
  const route = [goal];
  while (route[0][0] !== start[0] || route[0][1] !== start[1]) route.unshift(prev.get(idx(...route[0])));
  st.futurePath = route.map(([i, j]) => V(cx(i), Y + 0.05, cz(j)));     // what "imagining" this station traces
  const maxD = Math.max(...dist.values());

  // the planned path, as dots
  const dotGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.004, 10);
  const dotMat = new THREE.MeshBasicMaterial({ color: C.skyDeep });
  const dots = [];
  for (let k = 0; k < route.length - 1; k += 1) {
    for (let s = 0; s < 3; s += 1) {
      const t = s / 3;
      const d = new THREE.Mesh(dotGeo, dotMat);
      d.position.set(lerp(cx(route[k][0]), cx(route[k + 1][0]), t), Y + 0.006, lerp(cz(route[k][1]), cz(route[k + 1][1]), t));
      d.visible = false;
      st.group.add(d);
      dots.push(d);
    }
  }
  let ran = false;
  st.act = async () => {
    if (ran) {
      home();
      dots.forEach(d => { d.visible = false; });
      fog.forEach(t => { t.visible = true; t.material.opacity = 1; });
      await wait(0.3);
    }
    // 1. mapping: the sweep spins while the map fills in along the corridors
    fan.material.opacity = 0.32;
    await tween(2.2, k => {
      fan.rotation.z = k * Math.PI * 6;
      const reach = k * (maxD + 2);
      fog.forEach((t, n) => {
        const d = dist.get(n) ?? 99;
        t.material.opacity = clamp(1 - (reach - d), 0, 1);
        t.visible = t.material.opacity > 0.01;
      });
    });
    fan.material.opacity = 0;
    // 2. plan
    for (let k = 0; k < dots.length; k += 1) {
      dots[k].visible = true;
      if (k % 3 === 0) await wait(0.03);
    }
    // 3. drive
    for (let k = 1; k < route.length; k += 1) {
      const from = puck.position.clone();
      const to = V(cx(route[k][0]), Y, cz(route[k][1]));
      const yaw0 = puck.rotation.y;
      const yaw1 = yaw0 + wrap(Math.atan2(-(to.z - from.z), to.x - from.x) - yaw0);
      if (Math.abs(yaw1 - yaw0) > 0.01) await tween(0.18, t => { puck.rotation.y = lerp(yaw0, yaw1, ease(t)); });
      await tween(0.24, t => { puck.position.lerpVectors(from, to, t); });
      const passed = Math.max(0, k * 3 - 2);
      for (let d = 0; d < passed; d += 1) dots[d].visible = false;
    }
    dots.forEach(d => { d.visible = false; });
    ran = true;
  };
}

/* ---------- StudyBuddy: a turret that watches you, and fires when you look away ---------- */

function buildStudyBuddy(st) {
  const H = 0.42;
  const desk = counter(0.6, 0.42, H, st.color);
  st.group.add(desk);
  st.obstacles.push({ x: 0, z: 0, w: 0.62, d: 0.44 });
  const turret = new THREE.Group();
  const foot = cyl(0.06, 0.07, 0.03, '#34343a', 28);
  foot.position.y = 0.015;
  const pan = new THREE.Group();
  pan.position.y = 0.03;
  const yoke = box(0.09, 0.05, 0.05, C.sherbert, 0.01);
  yoke.position.y = 0.035;
  const tilt = new THREE.Group();
  tilt.position.y = 0.08;
  const barrel = cyl(0.016, 0.016, 0.12, '#f4f4f1', 20);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.03;
  const cam = cyl(0.012, 0.012, 0.01, '#34343a', 16);
  cam.rotation.x = Math.PI / 2;
  cam.position.set(0, 0.03, 0.03);
  const head = box(0.07, 0.05, 0.07, C.sherbert, 0.012);
  tilt.add(head, barrel, cam);
  pan.add(yoke, tilt);
  turret.add(foot, pan);
  turret.position.set(0.06, H, -0.04);
  st.group.add(turret);
  // a few books, for the studying
  [[C.sky, 0.0], [C.grass, 0.022], [C.lavender, 0.044]].forEach(([c, y], i) => {
    const b = box(0.16, 0.02, 0.12, c, 0.004);
    b.position.set(-0.17, H + 0.01 + y, 0.05);
    b.rotation.y = 0.15 * (i - 1);
    st.group.add(b);
  });
  st.anchorY = 0.85;

  const aim = { pan: 0, tilt: 0 };
  const tmp = V();
  st.update = dt => {
    // track the BracketBot's head camera
    const t = st.group.worldToLocal(bot.headWorld(tmp));
    const o = turret.position.clone().add(V(0, 0.11, 0));
    const d = t.sub(o);
    const wantPan = Math.atan2(d.x, d.z);
    const wantTilt = -Math.atan2(d.y, Math.hypot(d.x, d.z));
    aim.pan = damp(aim.pan, wantPan, 5, dt);
    aim.tilt = damp(aim.tilt, clamp(wantTilt, -0.9, 0.5), 5, dt);
    pan.rotation.y = aim.pan;
    tilt.rotation.x = aim.tilt;
  };
  const darts = [];
  st.act = async () => {
    say('Distraction detected.', () => st.at(0.06, H + 0.16, -0.04), 1.8);
    await wait(0.6);
    for (let n = 0; n < 3; n += 1) {
      const dart = mesh(new THREE.CapsuleGeometry(0.009, 0.03, 4, 10), propMat(C.creamsicle));
      const p0 = barrel.localToWorld(V(0, 0.07, 0));
      dart.position.copy(p0);
      scene.add(dart);
      const target = bot.headWorld(V()).add(V((Math.random() - 0.5) * 0.08, (Math.random() - 0.3) * 0.08, 0));
      const T = 0.45;
      const vel = target.clone().sub(p0).divideScalar(T).add(V(0, 4.9 * T, 0));
      darts.push({ mesh: dart, vel, t: 0, T, hit: false, life: 2.4 });
      tween(0.12, k => { tilt.position.z = -0.012 * Math.sin(k * Math.PI); });
      await wait(0.38);
    }
    await wait(1.2);
  };
  st.after = dt => {
    for (let i = darts.length - 1; i >= 0; i -= 1) {
      const d = darts[i];
      d.t += dt;
      d.life -= dt;
      if (!d.hit && d.t >= d.T) {
        d.hit = true;
        d.vel.set(-d.vel.x * 0.25, 1.1, -d.vel.z * 0.25);
      }
      d.vel.y -= 9.8 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      if (d.mesh.position.y < 0.009) {
        d.mesh.position.y = 0.009;
        d.vel.multiplyScalar(0.3);
        d.vel.y = Math.abs(d.vel.y) * 0.3;
      }
      d.mesh.lookAt(d.mesh.position.clone().add(d.vel.lengthSq() > 1e-4 ? d.vel : V(1, 0, 0)));
      d.mesh.rotateX(Math.PI / 2);
      if (d.life < 0.4) d.mesh.scale.setScalar(Math.max(0.001, d.life / 0.4));
      if (d.life <= 0) {
        scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        darts.splice(i, 1);
      }
    }
  };
}

/* ---------------------------------------------------------
   The BracketBot you drive
   --------------------------------------------------------- */

const bot = {
  x: 0, z: 0.35, h: Math.PI / 2, v: 0, w: 0, lean: 0, accel: 0,
  path: [], goal: null, station: null, mode: 'idle', docked: null,
  restCarriage: -0.3,
};

async function buildBot() {
  const r = await loadRobot('bracketbot');
  bot.robot = r;
  // wheel radius, from the tyre meshes
  r.base.updateMatrixWorld(true);
  const tyre = new THREE.Box3();
  r.links.left_wheel_tire__left_wheel_tire.meshes.forEach(m => tyre.expandByObject(m));
  const R = (tyre.max.y - tyre.min.y) / 2 || 0.085;
  bot.holder = new THREE.Group();
  bot.tilt = new THREE.Group();
  bot.tilt.position.y = R;
  r.base.position.y = -R + 0.002;
  bot.tilt.add(r.base);
  bot.holder.add(bot.tilt);
  scene.add(bot.holder);
  bot.head = r.links['head__head__head__head']?.obj || r.root;
  bot.headWorld = (out = V()) => {
    bot.head.updateWorldMatrix(true, false);
    return bot.headBox ? out.copy(bot.headBox).applyMatrix4(bot.head.matrixWorld) : bot.head.getWorldPosition(out);
  };
  // the centre of the head meshes, in the head link frame
  const hb = new THREE.Box3();
  r.links['head__head__head__head']?.meshes.forEach(m => {
    m.geometry.computeBoundingBox();
    hb.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld.clone().premultiply(bot.head.matrixWorld.clone().invert())));
  });
  if (!hb.isEmpty()) bot.headBox = hb.getCenter(V());

  r.joints.rj0.set(bot.restCarriage);
  r.joints.lj0.set(bot.restCarriage);
  const J = n => r.joints[n];
  bot.place();
  const seeds = [[0, 0.6, -0.6, 0, 0.6, 0], [1.0, 0.6, -0.6, 0, 0.6, 0], [-1.0, 0.6, -0.6, 0, 0.6, 0], [0.5, 1.2, -1.0, 0.5, 0.8, 0],
      [-0.5, 1.2, -1.0, -0.5, 0.8, 0], [0, -0.6, 0.6, 0, -0.6, 0], [1.5, 0.3, 0.3, 0, 0.3, 0], [-1.5, 0.3, 0.3, 0, 0.3, 0]];
  bot.armR = makeArm(r, {
    joints: ['rj1', 'rj2', 'rj3', 'rj4', 'rj5', 'rj6'],
    name: 'bb-right', hand: 'hand__hand', fingers: ['left_finger__left_finger', 'right_finger__right_finger'],
    grip: v => { J('right_left_gripper').set(v); J('right_right_gripper').set(v); },
    seeds,
  });
  bot.armR.home = [0, 0, 0, 0, 0, 0];
  bot.armR.set(bot.armR.home);
  bot.armR.grip(0.3);
  bot.armL = makeArm(r, {
    joints: ['lj1', 'lj2', 'lj3', 'lj4', 'lj5', 'lj6'],
    name: 'bb-left', hand: 'l_hand__hand', fingers: ['l_left_finger__left_finger', 'l_right_finger__right_finger'],
    grip: v => { J('left_left_gripper').set(v); J('left_right_gripper').set(v); },
    seeds,
  });
  bot.armL.home = [0, 0, 0, 0, 0, 0];
  bot.armL.set(bot.armL.home);
  bot.armL.grip(0.3);
  bot.carriage = (to, dur) => {
    const a = r.joints.rj0.value;
    return tween(dur, k => {
      const v = lerp(a, to, ease(k));
      r.joints.rj0.set(v);
      r.joints.lj0.set(v);
    });
  };
}
bot.place = () => {
  bot.holder.position.set(bot.x, 0, bot.z);
  bot.holder.rotation.y = bot.h;
  bot.tilt.rotation.z = bot.lean;
};

/* ---------------------------------------------------------
   Navigation: an occupancy grid with inflated obstacles, A*,
   then line-of-sight smoothing (a small Nav2 of our own)
   --------------------------------------------------------- */

const GRID = { n: 140, cell: 0.08 };
GRID.half = (GRID.n * GRID.cell) / 2;
const occ = new Uint8Array(GRID.n * GRID.n);
const BOT_R = 0.3;
const WORLD_R = 5.0;
const toCell = (x, z) => [Math.floor((x + GRID.half) / GRID.cell), Math.floor((z + GRID.half) / GRID.cell)];
const cellCenter = (i, j) => [-GRID.half + (i + 0.5) * GRID.cell, -GRID.half + (j + 0.5) * GRID.cell];
const inGrid = (i, j) => i >= 0 && j >= 0 && i < GRID.n && j < GRID.n;

function blockedAt(x, z, pad = BOT_R) {
  if (Math.hypot(x, z) > WORLD_R) return true;
  if (PROP_OBSTACLES.some(o => Math.hypot(o.x - x, o.z - z) < o.r + pad)) return true;
  const p = V();
  for (const st of STATIONS) {
    p.set(x, 0, z);
    st.group.worldToLocal(p);
    for (const o of st.obstacles) {
      if (o.r) {
        if (Math.hypot(p.x - o.x, p.z - o.z) < o.r + pad) return true;
      } else if (Math.abs(p.x - o.x) < o.w / 2 + pad && Math.abs(p.z - o.z) < o.d / 2 + pad) {
        return true;
      }
    }
  }
  return false;
}
function buildGrid() {
  STATIONS.forEach(st => st.group.updateMatrixWorld(true));
  for (let j = 0; j < GRID.n; j += 1) {
    for (let i = 0; i < GRID.n; i += 1) {
      const [x, z] = cellCenter(i, j);
      occ[j * GRID.n + i] = blockedAt(x, z) ? 1 : 0;
    }
  }
}
const free = (i, j) => inGrid(i, j) && !occ[j * GRID.n + i];

function nearestFree(i, j) {
  if (free(i, j)) return [i, j];
  for (let r = 1; r < 30; r += 1) {
    let best = null;
    let bd = Infinity;
    for (let dj = -r; dj <= r; dj += 1) {
      for (let di = -r; di <= r; di += 1) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !free(i + di, j + dj)) continue;
        const d = di * di + dj * dj;
        if (d < bd) { bd = d; best = [i + di, j + dj]; }
      }
    }
    if (best) return best;
  }
  return null;
}

function astar(sx, sz, gx, gz) {
  const n = GRID.n;
  const s = nearestFree(...toCell(sx, sz));
  const g = nearestFree(...toCell(gx, gz));
  if (!s || !g) return null;
  const sk = s[1] * n + s[0];
  const gk = g[1] * n + g[0];
  const gScore = new Float32Array(n * n).fill(Infinity);
  const came = new Int32Array(n * n).fill(-1);
  const closed = new Uint8Array(n * n);
  const heap = [];
  const push = (k, f) => {
    heap.push([f, k]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  const hfn = k => {
    const dx = Math.abs((k % n) - g[0]);
    const dz = Math.abs(Math.floor(k / n) - g[1]);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  gScore[sk] = 0;
  push(sk, hfn(sk));
  const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.length) {
    const [, k] = pop();
    if (k === gk) break;
    if (closed[k]) continue;
    closed[k] = 1;
    const i = k % n;
    const j = Math.floor(k / n);
    for (const [di, dj, c] of nb) {
      const a = i + di;
      const b = j + dj;
      if (!free(a, b)) continue;
      if (di && dj && (!free(i + di, j) || !free(i, j + dj))) continue;
      const nk = b * n + a;
      const ng = gScore[k] + c;
      if (ng < gScore[nk]) {
        gScore[nk] = ng;
        came[nk] = k;
        push(nk, ng + hfn(nk));
      }
    }
  }
  if (came[gk] === -1 && gk !== sk) return null;
  const cells = [];
  for (let k = gk; k !== -1; k = came[k]) cells.unshift(k);
  const pts = cells.map(k => cellCenter(k % n, Math.floor(k / n)));
  pts[pts.length - 1] = free(...toCell(gx, gz)) ? [gx, gz] : pts[pts.length - 1];
  return smooth([[sx, sz], ...pts.slice(1)]);
}
function lineFree(a, b) {
  const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (GRID.cell * 0.5));
  for (let s = 1; s < steps; s += 1) {
    const t = s / steps;
    if (!free(...toCell(lerp(a[0], b[0], t), lerp(a[1], b[1], t)))) return false;
  }
  return true;
}
function smooth(pts) {
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !lineFree(pts[i], pts[j])) j -= 1;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

// the planned path on the floor, and a ring at the goal
const pathDots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.022, 14).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: C.skyDeep, transparent: true, opacity: 0.55, depthWrite: false }), 400);
pathDots.count = 0;
pathDots.position.y = 0.004;
pathDots.frustumCulled = false;
scene.add(pathDots);
const goalRing = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.14, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: C.skyDeep, transparent: true, opacity: 0.7, depthWrite: false }));
goalRing.position.y = 0.005;
goalRing.visible = false;
scene.add(goalRing);

function showPath(pts) {
  const m = new THREE.Matrix4();
  let c = 0;
  for (let k = 0; k < pts.length - 1 && c < 400; k += 1) {
    const [ax, az] = pts[k];
    const [bx, bz] = pts[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.floor(len / 0.12));
    for (let s = 0; s < n && c < 400; s += 1) {
      const t = s / n;
      pathDots.setMatrixAt(c, m.makeTranslation(lerp(ax, bx, t), 0, lerp(az, bz, t)));
      c += 1;
    }
  }
  pathDots.count = c;
  pathDots.instanceMatrix.needsUpdate = true;
}
// drop the dots the robot has already passed
function trimPath() {
  if (!bot.path.length) { pathDots.count = 0; return; }
  showPath([[bot.x, bot.z], ...bot.path]);
}

function driveTo(x, z, station = null) {
  let pts = astar(bot.x, bot.z, x, z);
  if (station && (!pts || pts.length < 2)) pts = [[bot.x, bot.z], [x, z]];     // already beside it
  if (!pts || pts.length < 2) return;
  bot.path = pts.slice(1);
  if (station) {
    const end = bot.path[bot.path.length - 1];
    if (Math.hypot(end[0] - x, end[1] - z) > 0.02) bot.path.push([x, z]);
  }
  bot.goal = station;
  bot.mode = 'path';
  const end = pts[pts.length - 1];
  goalRing.position.set(end[0], 0.005, end[1]);
  goalRing.visible = !station;
  showPath(pts);
  undock();
}
function goToStation(st) {
  hideHint();
  if (bot.docked === st) { arrive(st); return; }
  driveTo(st.dockWorld.x, st.dockWorld.z, st);
}

/* ---------------------------------------------------------
   Driving: pure pursuit on the path, or arrow keys
   --------------------------------------------------------- */

const keys = new Set();
const VMAX = 0.95;
const WMAX = 2.6;

function stepBot(dt) {
  let vWant = 0;
  let wWant = 0;
  const kf = (keys.has('ArrowUp') || keys.has('w')) - (keys.has('ArrowDown') || keys.has('s'));
  const kt = (keys.has('ArrowLeft') || keys.has('a')) - (keys.has('ArrowRight') || keys.has('d'));
  if (kf || kt) {
    if (bot.mode === 'path' || bot.mode === 'align') { bot.path = []; pathDots.count = 0; goalRing.visible = false; }
    bot.mode = 'teleop';
    bot.goal = null;
    vWant = kf * VMAX * 0.8;
    wWant = kt * WMAX * 0.8;
  } else if (bot.mode === 'teleop') {
    bot.mode = 'idle';
  }
  if (bot.mode === 'path') {
    // pure pursuit: aim at a point a little way along the path
    while (bot.path.length > 1 && Math.hypot(bot.path[0][0] - bot.x, bot.path[0][1] - bot.z) < 0.28) bot.path.shift();
    const [tx, tz] = bot.path[0];
    const dist = Math.hypot(tx - bot.x, tz - bot.z);
    const want = Math.atan2(-(tz - bot.z), tx - bot.x);
    const err = wrap(want - bot.h);
    const last = bot.path.length === 1;
    wWant = clamp(err * 3.2, -WMAX, WMAX);
    vWant = Math.abs(err) > 0.9 ? 0 : VMAX * Math.cos(err) * (last ? clamp(dist / 0.5, 0.18, 1) : 1);
    if (last && dist < 0.04) {
      bot.path = [];
      pathDots.count = 0;
      goalRing.visible = false;
      bot.mode = bot.goal ? 'align' : 'idle';
      vWant = 0;
    }
  }
  if (bot.mode === 'align') {
    const err = wrap(bot.goal.dockHeading - bot.h);
    wWant = clamp(err * 4, -WMAX, WMAX);
    vWant = 0;
    if (Math.abs(err) < 0.03 && Math.abs(bot.w) < 0.2) {
      const st = bot.goal;
      bot.mode = 'idle';
      bot.goal = null;
      arrive(st);
    }
  }
  // acceleration limits, then integrate
  const v0 = bot.v;
  bot.v += clamp(vWant - bot.v, -2.2 * dt, 1.6 * dt);
  bot.w += clamp(wWant - bot.w, -9 * dt, 9 * dt);
  const nx = bot.x + Math.cos(bot.h) * bot.v * dt;
  const nz = bot.z - Math.sin(bot.h) * bot.v * dt;
  if (bot.mode === 'teleop' && blockedAt(nx, nz, 0.2) && !blockedAt(bot.x, bot.z, 0.2)) {
    bot.v = 0;
  } else {
    bot.x = nx;
    bot.z = nz;
  }
  bot.h = wrap(bot.h + bot.w * dt);
  // a balancing robot leans into acceleration
  const a = (bot.v - v0) / Math.max(dt, 1e-3);
  bot.accel = damp(bot.accel, a, 6, dt);
  bot.lean = damp(bot.lean, clamp(-bot.accel * 0.035, -0.07, 0.07), 8, dt);
  bot.place();
  if (bot.mode === 'path') trimPath();

  // parked at a station by hand?
  if (bot.mode === 'idle' && !bot.docked && Math.abs(bot.v) < 0.05) {
    const st = STATIONS.find(s => Math.hypot(s.dockWorld.x - bot.x, s.dockWorld.z - bot.z) < 0.34);
    if (st) driveTo(st.dockWorld.x, st.dockWorld.z, st);
  }
  if (bot.docked && Math.hypot(bot.docked.dockWorld.x - bot.x, bot.docked.dockWorld.z - bot.z) > 0.6) undock();
}

/* ---------------------------------------------------------
   Arriving at a station: run its act, show the card
   --------------------------------------------------------- */

const card = $('#card');
let shown = null;
function showCard(st) {
  shown = st;
  card.style.setProperty('--tint', st.tint);
  card.querySelector('.w-card-robot').textContent = st.robot;
  card.querySelector('.w-card-title').textContent = st.title;
  card.querySelector('.w-card-line').textContent = st.line;
  const tags = card.querySelector('.w-card-tags');
  tags.replaceChildren(...st.tags.map(t => Object.assign(document.createElement('li'), { textContent: t })));
  const go = card.querySelector('.w-card-go');
  go.href = st.href;
  go.textContent = st.external ? 'Open on Devpost ↗' : 'Imagine it →';
  go.title = st.external ? '' : 'Opens the project page';
  if (st.external) { go.target = '_blank'; go.rel = 'noopener'; } else { go.removeAttribute('target'); go.removeAttribute('rel'); }
  card.hidden = false;
}
function arrive(st) {
  bot.docked = st;
  showCard(st);
  setCurrent(st);
  camFocus = st;
  user.az = 0;
  user.el = 0;
  if (!st.running && st.act) {
    st.running = true;
    st.act().catch(e => console.error(st.id, e)).finally(() => { st.running = false; });
  }
}
function undock() {
  if (!bot.docked) return;
  bot.docked = null;
  card.hidden = true;
  setCurrent(null);
  camFocus = null;
}
card.querySelector('.w-card-close').addEventListener('click', () => {
  card.hidden = true;
  camFocus = null;
});
card.querySelector('.w-card-go').addEventListener('click', e => {
  if (!shown || shown.external || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  imagineFromWorld(shown);
});

/* ---------------------------------------------------------
   Labels, station buttons, speech bubbles
   --------------------------------------------------------- */

const labelsEl = $('#labels');
const stationsEl = $('#stations');
STATIONS.forEach(st => {
  const label = document.createElement('button');
  label.className = 'w-label';
  label.type = 'button';
  label.tabIndex = -1;
  label.textContent = st.title;
  label.style.setProperty('--c', st.color);
  label.addEventListener('click', () => goToStation(st));
  labelsEl.append(label);
  st.label = label;
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = st.title;
  b.style.setProperty('--c', st.color);
  b.addEventListener('click', () => goToStation(st));
  stationsEl.append(b);
  st.button = b;
});
function setCurrent(st) {
  STATIONS.forEach(s => {
    s.button.setAttribute('aria-current', s === st ? 'true' : 'false');
    s.label.classList.toggle('is-here', s === st);
  });
}

const bubbles = [];
function say(text, where, dur) {
  const el = document.createElement('div');
  el.className = 'w-bubble';
  el.textContent = text;
  labelsEl.append(el);
  const b = { el, where, life: dur };
  bubbles.push(b);
  requestAnimationFrame(() => el.classList.add('is-on'));
}

// labels live in a layer the size of the world's host, so positions are host pixels
const proj = V();
function placeOverlay(el, world, dy = 0) {
  proj.copy(world).project(camera);
  const behind = proj.z > 1;
  const x = (proj.x * 0.5 + 0.5) * host.clientWidth;
  const y = (-proj.y * 0.5 + 0.5) * host.clientHeight + dy;
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  return !behind;
}
function stepOverlays(dt) {
  STATIONS.forEach(st => {
    const ok = placeOverlay(st.label, st.at(0, st.anchorY, 0));
    const far = !ok || !!camFocus || imagining;      // the card names the station in focus
    st.label.classList.toggle('is-far', far);
  });
  for (let i = bubbles.length - 1; i >= 0; i -= 1) {
    const b = bubbles[i];
    b.life -= dt;
    placeOverlay(b.el, b.where().add(V(0, 0.12, 0)));
    if (b.life < 0.3) b.el.classList.remove('is-on');
    if (b.life <= 0) {
      b.el.remove();
      bubbles.splice(i, 1);
    }
  }
}

const hint = $('#hint');
function hideHint() { hint?.classList.add('is-gone'); }

/* ---------------------------------------------------------
   Camera: an overview that follows the robot a little, and
   closes in on a station when the robot parks there
   --------------------------------------------------------- */

let camFocus = null;
const cam = { target: V(0, 0.3, 0.2), r: 10, el: 0.62, az: 0 };
const user = { az: 0, el: 0, zoom: 1 };
const aspectNow = () => host.clientWidth / Math.max(1, host.clientHeight);

function overview() {
  const aspect = aspectNow();
  if (aspect < 0.9) {
    // a phone held upright can't fit the whole ring: look down from higher, follow the robot more,
    // and leave the edges to dragging and the station buttons
    return { target: V(bot.x * 0.55, 0.2, 0.5 + bot.z * 0.4), r: 15.5, el: 0.92, az: 0 };
  }
  const fit = aspect < 1.2 ? 1.2 / aspect : 1;
  return { target: V(bot.x * 0.2, 0.0, 0.35 + bot.z * 0.15), r: 13.4 * Math.min(fit, 1.6), el: 0.47, az: 0 };
}
function focusView(st) {
  const fwd = V(0, 0, 1).applyQuaternion(st.group.quaternion);
  const az = Math.atan2(fwd.x, fwd.z) + (st.camTurn ?? 0.95);
  const aspect = aspectNow();
  const fit = aspect < 1 ? 1.35 / aspect : 1;
  const mid = st.at(0, 0.45, st.dock * 0.2);
  return { target: mid, r: (st.camR ?? 2.9) * Math.min(fit, 2.2), el: st.camEl ?? 0.55, az };
}
let camOverride = null;
function stepCamera(dt) {
  const want = camOverride || (camFocus ? focusView(camFocus) : overview());
  const k = reduceMotion ? 20 : 2.4;
  cam.target.x = damp(cam.target.x, want.target.x, k, dt);
  cam.target.y = damp(cam.target.y, want.target.y, k, dt);
  cam.target.z = damp(cam.target.z, want.target.z, k, dt);
  cam.r = damp(cam.r, want.r * user.zoom, k, dt);
  cam.el = damp(cam.el, clamp(want.el + user.el, 0.18, 1.25), k, dt);
  cam.az += wrap(want.az + user.az - cam.az) * (1 - Math.exp(-k * dt));
  const ce = Math.cos(cam.el);
  camera.position.set(
    cam.target.x + cam.r * ce * Math.sin(cam.az),
    cam.target.y + cam.r * Math.sin(cam.el),
    cam.target.z + cam.r * ce * Math.cos(cam.az),
  );
  camera.lookAt(cam.target);
  // haze only the floor beyond the world, however far the camera is
  scene.fog.near = cam.r + 4;
  scene.fog.far = cam.r + 20;
}

/* ---------------------------------------------------------
   Imagining the future: before a project opens, the world
   samples rollouts from the robot's tool, shows where each one
   ends up, then turns into the model's latent picture and hands
   over to the "imagining the future" screen (transition.js)
   --------------------------------------------------------- */

// where each station's action is heading, in station coordinates
const GOALS = {
  pi05: [0.17, 0.47, 0.1],
  rico: [0.02, 0.62, 0.17],
  ftc: [0.2, 0.62, 0.06],
  brackey: [-0.03, 0.56, 0.08],
};
let imagining = false;
let futureGroup = null;
const futureMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });

function futuresFor(st) {
  let chosen;
  if (st.futurePath) {
    chosen = st.futurePath.map(p => st.group.localToWorld(p.clone()));
  } else if (st.id === 'quad') {
    chosen = Array.from({ length: 25 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      return st.at(Math.cos(a) * 0.42, 0.32, -Math.sin(a) * 0.42);
    });
  } else {
    const tool = st.id === 'brackey' ? bot.armR?.tcp : st.arms?.[0]?.tcp;
    const from = tool ? tool.getWorldPosition(V())
      : st.id === 'studybuddy' ? st.at(0.06, 0.54, -0.04) : bot.headWorld(V());
    const to = GOALS[st.id] ? st.at(...GOALS[st.id])
      : st.id === 'studybuddy' ? bot.headWorld(V()) : st.at(0, st.anchorY * 0.6, 0);
    const mid = from.clone().lerp(to, 0.5).add(V(0, 0.12 + from.distanceTo(to) * 0.3, 0));
    chosen = [from, mid, to];
  }
  const base = new THREE.CatmullRomCurve3(chosen).getPoints(60);
  const len = new THREE.CatmullRomCurve3(chosen).getLength();
  const out = [base];
  for (let k = 1; k < 9; k += 1) {
    const ph = [Math.random() * 6, Math.random() * 6, Math.random() * 6];
    const fr = [1 + Math.random() * 2, 1 + Math.random() * 2, 1 + Math.random() * 2];
    const amp = (0.05 + Math.random() * 0.12) * Math.max(0.6, len);
    out.push(base.map((p, i) => {
      const t = i / (base.length - 1);
      const g = Math.sin(Math.PI * Math.min(1, t * 1.3)) * 0.6 + t * 0.7;   // rollouts drift apart, most at the end
      return p.clone().add(V(
        Math.sin(t * fr[0] * 3 + ph[0]) * amp * g,
        Math.sin(t * fr[1] * 3 + ph[1]) * amp * g * 0.6,
        Math.sin(t * fr[2] * 3 + ph[2]) * amp * g,
      ));
    }));
  }
  return out;
}

async function imagineFromWorld(st) {
  if (imagining) return;
  if (reduceMotion || !window.wamImagine) {
    if (window.wamImagine) window.wamImagine(st.href); else location.href = st.href;
    return;
  }
  imagining = true;
  host.classList.add('is-imagining');
  hideHint();
  card.hidden = true;
  futureGroup = new THREE.Group();
  scene.add(futureGroup);
  const paths = futuresFor(st);
  // each rollout is a thin bright core in a soft halo; the chosen one is the boldest
  const tubes = [];
  paths.forEach((pts, i) => {
    const curve = new THREE.CatmullRomCurve3(pts);
    [[i === 0 ? 0.012 : 0.0065, i === 0 ? 1 : 0.7], [i === 0 ? 0.032 : 0.018, i === 0 ? 0.28 : 0.14]].forEach(([r, a], layer) => {
      const geo = new THREE.TubeGeometry(curve, 90, r, 6, false);
      geo.setDrawRange(0, 0);
      const m = new THREE.Mesh(geo, futureMat(i === 0 ? C.lime : '#e9ffb8', a));
      m.renderOrder = 5 + layer;
      m.userData.i = i;
      futureGroup.add(m);
      tubes.push(m);
    });
  });
  // where each rollout leaves the world: small wire boxes, the predicted states
  const ends = paths.map((pts, i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05),
      new THREE.MeshBasicMaterial({ color: i === 0 ? C.lime : '#f4ffd6', wireframe: true, transparent: true, opacity: i === 0 ? 1 : 0.7, fog: false }));
    m.position.copy(pts[pts.length - 1]);
    m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    m.visible = false;
    futureGroup.add(m);
    return m;
  });
  const fx = k => {
    if (usePost) PAINT.imagine.value = k;
    else canvas.style.filter = `grayscale(${k}) brightness(${1 - 0.6 * k}) contrast(${1 + 0.4 * k})`;
  };
  await tween(0.85, k => {
    tubes.forEach(t => {
      const i = t.userData.i;
      const kk = clamp(k * 1.2 - (i ? 0.04 * i : 0), 0, 1);
      t.geometry.setDrawRange(0, Math.floor(t.geometry.index.count * ease(kk)));
    });
    ends.forEach((e, i) => { e.visible = k > 0.8 - (i ? 0 : 0.05); e.rotation.y += 0.05; });
    fx(0.22 * k);
  });
  await tween(0.5, k => {
    ends.forEach(e => { e.rotation.y += 0.08; });
    fx(0.22 + 0.78 * k * k);
  });
  const end = paths[0][paths[0].length - 1].clone().project(camera);
  const rect = canvas.getBoundingClientRect();
  window.wamImagine(st.href, {
    title: st.title, skipTraces: true,
    from: { x: rect.left + (end.x * 0.5 + 0.5) * rect.width, y: rect.top + (-end.y * 0.5 + 0.5) * rect.height },
  });
}
// back from the project with the back button: wake up from the dream
window.addEventListener('pageshow', e => {
  if (!e.persisted) return;
  imagining = false;
  host.classList.remove('is-imagining');
  PAINT.imagine.value = 0;
  canvas.style.filter = '';
  if (futureGroup) { scene.remove(futureGroup); futureGroup = null; }
  if (bot.docked) card.hidden = false;
});

/* ---------------------------------------------------------
   The garden: grass, wildflowers, cattails, a cube tree,
   and the lab's whiteboard
   --------------------------------------------------------- */

const PROP_OBSTACLES = [];     // world circles {x, z, r}
let seedG = 81205;
const rnd = () => { seedG = (seedG * 16807) % 2147483647; return seedG / 2147483647; };

function colored(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(color);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

function buildGarden() {
  const parts = [];
  const GREENS = ['#5f7a3b', '#7c9845', '#9fb35a', '#4d6934', '#86a24c', '#a9b862'];
  const pickGreen = () => GREENS[Math.floor(rnd() * GREENS.length)];
  const free = (x, z, pad) => {
    if (Math.hypot(x, z) < 1.25 || Math.hypot(x, z) > 5.6) return false;
    if (blockedAt(x, z, pad)) return false;
    if (STATIONS.some(st => Math.hypot(st.dockWorld.x - x, st.dockWorld.z - z) < 0.5)) return false;
    return !PROP_OBSTACLES.some(o => Math.hypot(o.x - x, o.z - z) < o.r + pad);
  };
  const spot = (pad, tries = 40) => {
    for (let t = 0; t < tries; t += 1) {
      const a = rnd() * Math.PI * 2;
      const r = 1.3 + Math.sqrt(rnd()) * 4.1;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (free(x, z, pad)) return [x, z];
    }
    return null;
  };
  function blade(x, z, h, color, lean = 0.5) {
    const g = new THREE.ConeGeometry(0.008 + rnd() * 0.005, h, 3, 1);
    g.translate(0, h / 2, 0);
    g.rotateZ((rnd() - 0.5) * lean);
    g.rotateX((rnd() - 0.5) * lean);
    g.rotateY(rnd() * Math.PI);
    g.translate(x, 0, z);
    parts.push(colored(g, color));
  }
  function tuft(x, z, n = 7, h = 0.16) {
    for (let i = 0; i < n; i += 1) blade(x + (rnd() - 0.5) * 0.09, z + (rnd() - 0.5) * 0.09, h * (0.55 + rnd() * 0.7), pickGreen(), 0.7);
  }
  function flower(x, z, color) {
    const h = 0.1 + rnd() * 0.1;
    blade(x, z, h, '#6c8a3e', 0.2);
    const head = new THREE.IcosahedronGeometry(0.014 + rnd() * 0.006, 0);
    head.translate(x, h, z);
    parts.push(colored(head, color));
  }
  function cattail(x, z) {
    const h = 0.3 + rnd() * 0.14;
    const stem = new THREE.CylinderGeometry(0.0025, 0.0035, h, 5);
    stem.translate(0, h / 2, 0);
    stem.rotateZ((rnd() - 0.5) * 0.2);
    stem.translate(x, 0, z);
    parts.push(colored(stem, '#6f8a42'));
    const head = new THREE.CapsuleGeometry(0.011, 0.05, 3, 6);
    head.translate(x, h - 0.04, z);
    parts.push(colored(head, '#8a5a3c'));
  }

  // the cube tree: its fruit are the cubes the robots pick
  const tree = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.03, 0.055, 0.78, 9), propMat('#7b5b45'));
  trunk.position.y = 0.39;
  const branch = mesh(new THREE.CylinderGeometry(0.016, 0.024, 0.3, 7), propMat('#7b5b45'));
  branch.position.set(0.08, 0.66, 0);
  branch.rotation.z = -0.7;
  tree.add(trunk, branch);
  const leafColors = ['#6f8d3f', '#86a24c', '#9bb456', '#5f7a3b'];
  [[0, 0.98, 0, 0.24], [0.18, 0.9, 0.06, 0.2], [-0.16, 0.9, -0.04, 0.19], [0.04, 1.14, -0.05, 0.18], [-0.05, 0.86, 0.17, 0.17], [0.08, 0.84, -0.18, 0.16]]
    .forEach(([x, y, z, r], i) => {
      const leaf = mesh(new THREE.IcosahedronGeometry(r, 1), new THREE.MeshStandardMaterial({ color: leafColors[i % 4], roughness: 0.9, flatShading: true }));
      leaf.position.set(x, y, z);
      tree.add(leaf);
    });
  const fruitColors = [C.sunshine, C.sherbert, C.sky, C.lavender, C.creamsicle];
  for (let i = 0; i < 13; i += 1) {
    const a = rnd() * Math.PI * 2;
    const y = 0.78 + rnd() * 0.3;
    const r = 0.2 + rnd() * 0.08;
    const fruit = box(0.042, 0.042, 0.042, fruitColors[i % fruitColors.length], 0.008);
    fruit.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    fruit.rotation.set(rnd(), rnd(), rnd());
    tree.add(fruit);
  }
  const mound = mesh(new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), matte('#b08466'));
  mound.scale.y = 0.25;
  tree.add(mound);
  tree.position.set(1.5, 0, 1.2);
  scene.add(tree);
  PROP_OBSTACLES.push({ x: 1.5, z: 1.2, r: 0.3 });

  // grass and flowers, scattered where nothing stands
  for (let i = 0; i < 34; i += 1) {
    const p = spot(0.16);
    if (!p) continue;
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k += 1) tuft(p[0] + (rnd() - 0.5) * 0.18, p[1] + (rnd() - 0.5) * 0.18, 8 + Math.floor(rnd() * 6), 0.2);
  }
  const FLOWERS = ['#d9473f', '#e8b83a', '#f4efe6', '#e8873a', '#c86aa0'];
  for (let i = 0; i < 16; i += 1) {
    const p = spot(0.14);
    if (!p) continue;
    const c = FLOWERS[Math.floor(rnd() * FLOWERS.length)];
    for (let k = 0; k < 4 + rnd() * 4; k += 1) flower(p[0] + (rnd() - 0.5) * 0.14, p[1] + (rnd() - 0.5) * 0.14, c);
    tuft(p[0], p[1], 4);
  }
  // cattails by the maze and around the pen
  [byId.maze, byId.quad].forEach(st => {
    for (let i = 0; i < 3; i += 1) {
      const a = rnd() * Math.PI * 2;
      const x = st.group.position.x + Math.cos(a) * (st.id === 'quad' ? 1.1 : 0.95);
      const z = st.group.position.z + Math.sin(a) * (st.id === 'quad' ? 1.1 : 0.95);
      if (!free(x, z, 0.08)) continue;
      for (let k = 0; k < 4; k += 1) cattail(x + (rnd() - 0.5) * 0.1, z + (rnd() - 0.5) * 0.1);
      tuft(x, z, 6, 0.2);
    }
  });
  // around the tree's foot
  for (let i = 0; i < 4; i += 1) tuft(1.5 + (rnd() - 0.5) * 0.4, 1.2 + (rnd() - 0.5) * 0.4, 5);

  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();
  const garden = mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
  scene.add(garden);
}

// the lab whiteboard on an easel, with today's to-do list in marker
async function buildWhiteboard() {
  try {
    await Promise.race([document.fonts.load('600 64px Caveat'), new Promise(r => setTimeout(r, 1500))]);
  } catch (e) { /* draw with the fallback hand */ }
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 704;
  const g = cv.getContext('2d');
  g.fillStyle = '#f8f6f1';
  g.fillRect(0, 0, 1024, 704);
  // ghosts of old notes, half wiped
  g.globalAlpha = 0.08;
  g.fillStyle = '#5a6a8a';
  g.font = '600 54px Caveat, "Comic Sans MS", cursive';
  g.fillText('q = J⁺ (x* − x)', 560, 640);
  g.fillText('loss ↓', 640, 120);
  g.globalAlpha = 1;
  g.fillStyle = '#2b2b30';
  g.font = '700 130px Caveat, "Comic Sans MS", cursive';
  g.fillText("max's lab", 60, 140);
  g.strokeStyle = '#d0743f';
  g.lineWidth = 11;
  g.beginPath();
  g.moveTo(60, 172);
  g.bezierCurveTo(260, 158, 420, 190, 540, 170);
  g.stroke();
  const items = [
    ['✓', 'make toast', '#3f8f4a'],
    ['✓', 'walk the Go2', '#3f8f4a'],
    ['☐', 'solve the maze', '#2b2b30'],
    ['☐', 'imagine the future', '#b14a2a'],
  ];
  g.font = '700 84px Caveat, "Comic Sans MS", cursive';
  items.forEach(([mark, text, color], i) => {
    const y = 290 + i * 104;
    g.fillStyle = color;
    g.fillText(mark, 70, y);
    g.fillStyle = '#2b2b30';
    g.fillText(text, 150, y);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const edge = propMat('#d9d5cd');
  const boardMats = [edge, edge, edge, edge, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }), edge];
  const easel = new THREE.Group();
  const board = mesh(new THREE.BoxGeometry(0.9, 0.62, 0.02), boardMats);
  board.position.set(0, 0.8, 0);
  board.rotation.x = -0.16;
  const leg = (x, z, rx, rz) => {
    const l = mesh(new THREE.CylinderGeometry(0.009, 0.011, 1.0, 6), propMat('#8a6a52'));
    l.position.set(x, 0.49, z);
    l.rotation.set(rx, 0, rz);
    easel.add(l);
  };
  leg(-0.36, 0.05, -0.16, 0.1);
  leg(0.36, 0.05, -0.16, -0.1);
  leg(0, -0.2, 0.32, 0);
  const tray = box(0.84, 0.02, 0.05, '#d9d5cd', 0.008);
  tray.position.set(0, 0.49, 0.06);
  easel.add(board, tray);
  [C.skyDeep, '#b14a2a', '#2b2b30'].forEach((c, i) => {
    const pen = cyl(0.007, 0.007, 0.1, c, 8);
    pen.rotation.z = Math.PI / 2;
    pen.position.set(-0.12 + i * 0.12, 0.507, 0.06);
    easel.add(pen);
  });
  easel.position.set(-1.3, 0, 1.25);
  easel.rotation.y = 0.35;
  scene.add(easel);
  PROP_OBSTACLES.push({ x: -1.3, z: 1.25, r: 0.38 });
}

/* ---------------------------------------------------------
   Corner notes: Waterloo's time and weather
   --------------------------------------------------------- */

const clockEl = $('#w-clock');
const weatherEl = $('#w-weather');
const clockFmt = new Intl.DateTimeFormat('en-US', { timeZone: WATERLOO.tz, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
function tickClock() {
  if (clockEl) clockEl.textContent = `${clockFmt.format(new Date()).toLowerCase()} in Waterloo`;
}
tickClock();
setInterval(tickClock, 1000);
const WEATHER = [
  [0, 'clear', '☀'], [1, 'mostly clear', '☀'], [2, 'partly cloudy', '⛅'], [3, 'overcast', '☁'],
  [48, 'fog', '☁'], [57, 'drizzle', '☂'], [67, 'rain', '☂'], [77, 'snow', '❄'], [82, 'showers', '☂'],
  [86, 'snow showers', '❄'], [99, 'thunderstorms', '☂'],
];
async function fetchWeather() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${WATERLOO.lat}&longitude=${WATERLOO.lon}`
    + '&current=temperature_2m,weather_code,cloud_cover&daily=sunrise,sunset&timezone=America%2FToronto&forecast_days=1';
  try {
    const r = await fetch(url);
    if (!r.ok) return;
    const j = await r.json();
    const hours = s => { const [h, m] = s.slice(11, 16).split(':').map(Number); return h + m / 60; };
    const code = j.current.weather_code;
    const [, word, glyph] = WEATHER.find(([max]) => code <= max) || WEATHER[3];
    const overcast = clamp((j.current.cloud_cover ?? 0) / 100, 0, 1) * (code >= 3 ? 1 : 0.6);
    const look = pickLook(hours(j.daily.sunrise[0]), hours(j.daily.sunset[0]));
    applyLook(look, params.get('light') ? 0 : overcast);
    lookNow.weather = word;
    if (weatherEl) weatherEl.textContent = `${look === 'night' && code <= 1 ? '☾' : glyph} Waterloo, ON · ${Math.round(j.current.temperature_2m)}°C · ${word}`;
  } catch (e) { /* offline: keep the default light */ }
}

/* ---------------------------------------------------------
   Input
   --------------------------------------------------------- */

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const hitBoxes = [];
const groundPlane = new THREE.Plane(V(0, 1, 0), 0);

function makeHitBoxes() {
  const mat = new THREE.MeshBasicMaterial({ visible: false });
  STATIONS.forEach(st => {
    const b = new THREE.Box3().setFromObject(st.group);
    const size = b.getSize(V());
    const hit = new THREE.Mesh(new THREE.BoxGeometry(size.x, Math.max(size.y, 0.6), size.z), mat);
    hit.position.copy(b.getCenter(V()));
    hit.userData.station = st;
    scene.add(hit);
    hitBoxes.push(hit);
  });
}
function pick(e) {
  const rect = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(hitBoxes, false)[0];
  if (hit) return { station: hit.object.userData.station };
  const p = ray.ray.intersectPlane(groundPlane, V());
  return p ? { point: p } : null;
}

const drag = { on: false, x: 0, y: 0, moved: 0, id: null };
const pointers = new Map();
let pinch0 = 0;
canvas.addEventListener('pointerdown', e => {
  if (imagining) return;
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]) / user.zoom;
  }
  drag.on = true;
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.moved = 0;
  // on the home page a touch may be the start of a scroll, so don't hold on to it
  if (!EMBED || e.pointerType === 'mouse') {
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
  }
});
canvas.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch0 > 0 && !EMBED) user.zoom = clamp(d / pinch0, 0.45, 1.6);
    drag.moved = 99;
    return;
  }
  if (drag.on) {
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.moved > 6) {
      canvas.classList.add('turning');
      user.az -= dx * 0.005;
      if (!EMBED || e.pointerType === 'mouse') user.el = clamp(user.el + dy * 0.003, -0.4, 0.55);
    }
    return;
  }
  const p = pick(e);
  const st = p && p.station;
  canvas.classList.toggle('pointing', !!st);
  STATIONS.forEach(s => s.label.classList.toggle('is-hot', s === st));
});
const endDrag = e => {
  pointers.delete(e.pointerId);
  if (!drag.on) return;
  drag.on = false;
  canvas.classList.remove('turning');
  if (drag.moved <= 6 && e.type === 'pointerup' && !imagining) {
    const p = pick(e);
    if (!p) return;
    hideHint();
    if (p.station) goToStation(p.station);
    else driveTo(p.point.x, p.point.z);
  }
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
if (!EMBED) {
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    user.zoom = clamp(user.zoom * Math.exp(e.deltaY * 0.0012), 0.45, 1.6);
  }, { passive: false });
}

// full screen: arrows and WASD; on the home page only WASD, so the arrows still scroll the page
const DRIVE_KEYS = new Set(EMBED ? ['w', 'a', 's', 'd'] : ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd']);
let onScreen = true;
window.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (!onScreen || imagining) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (DRIVE_KEYS.has(k) && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (k.startsWith('Arrow') && document.activeElement && document.activeElement.closest('.w-stations')) return;
    keys.add(k);
    hideHint();
    e.preventDefault();
  }
  if (k === 'Escape' && !card.hidden) {
    card.hidden = true;
    camFocus = null;
  }
});
window.addEventListener('keyup', e => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
window.addEventListener('blur', () => keys.clear());

function resize() {
  const w = Math.max(1, host.clientWidth);
  const h = Math.max(1, host.clientHeight);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  PAINT.res.value.set(w * pixelRatio, h * pixelRatio);
  camera.aspect = w / h;
  camera.fov = w < 640 ? 38 : 30;
  camera.updateProjectionMatrix();
}
if ('ResizeObserver' in window) new ResizeObserver(resize).observe(host);
else window.addEventListener('resize', resize);
resize();

// on the home page, stop drawing once it has scrolled away
if ('IntersectionObserver' in window) {
  new IntersectionObserver(entries => { onScreen = entries[0].isIntersecting; }, { threshold: 0.02 }).observe(host);
}

/* ---------------------------------------------------------
   Start
   --------------------------------------------------------- */

let last = performance.now();
let paused = false;
// quality: if the painted look is too slow on this machine, draw fewer pixels, then skip the paint
const perf = { n: 0, sum: 0, stage: params.get('quality') === 'high' ? 9 : 0 };
function watchPerf(dt) {
  if (perf.stage > 1) return;
  perf.n += 1;
  if (perf.n < 30) return;
  perf.sum += dt;
  if (perf.n < 120) return;
  const avg = perf.sum / 90;
  perf.n = 0;
  perf.sum = 0;
  if (avg < 1 / 40) { perf.stage = 9; return; }
  if (perf.stage === 0) {
    pixelRatio = 1;
    PAINT.spread.value = 1.0;
    resize();
    perf.stage = 1;
  } else {
    usePost = false;
    perf.stage = 2;
  }
}
function frame(now = performance.now()) {
  const raw = (now - last) / 1000;
  last = now;
  if (!onScreen && !imagining) return;
  const dt = Math.min(raw, 0.05);
  if (!paused) tick(dt);
  stepCamera(dt);
  stepOverlays(dt);
  PAINT.time.value = now / 1000;
  if (usePost) composer.render(dt); else renderer.render(scene, camera);
  watchPerf(Math.min(raw, 0.2));   // a long pause (tab hidden) is not a slow frame
}
function tick(dt) {
  stepBot(dt);
  stepTweens(dt);
  STATIONS.forEach(st => {
    st.arms?.forEach(a => a.update(dt));
    st.update?.(dt);
    st.after?.(dt);
  });
  bot.armR?.update(dt);
  bot.armL?.update(dt);
  if (goalRing.visible && !reduceMotion) goalRing.scale.setScalar(1 + 0.08 * Math.sin(performance.now() / 220));
}

async function start() {
  fetchWeather();
  const [so, yam, piper, go2] = await Promise.all([
    loadRobot('so101'), loadRobot('yam'), loadRobot('piper'), loadRobot('go2'), buildBot(),
  ]);
  await buildPi05(byId.pi05, yam);
  await buildRico(byId.rico, so);
  await buildFtc(byId.ftc, piper);
  buildBrackey(byId.brackey);
  buildQuad(byId.quad, go2);
  buildMaze(byId.maze);
  buildStudyBuddy(byId.studybuddy);
  STATIONS.forEach(st => {
    st.group.updateMatrixWorld(true);
    st.dockWorld = st.group.localToWorld(V(0, 0, st.dock));
  });
  await buildWhiteboard();
  buildGarden();
  buildGrid();
  makeHitBoxes();
  const o = overview();
  cam.target.copy(o.target);
  cam.r = o.r * 1.25;
  cam.el = 0.9;
  cam.az = -0.5;
  setStatus('', true);
  renderer.setAnimationLoop(frame);
  // deep link: playground.html#rico drives straight there
  const id = location.hash.slice(1);
  if (byId[id]) setTimeout(() => goToStation(byId[id]), 600);
}

start().catch(e => {
  console.error(e);
  status.innerHTML = 'The robots could not load. <a href="index.html#projects">Every project is listed here.</a>';
});

// for testing from the console
window.__pg = {
  bot, STATIONS, byId, goToStation, driveTo, arrive, camera, scene, cam, user, applyLook, imagineFromWorld, PAINT, perf,
  look(x, y, z, r, el, az) { camOverride = x === undefined ? null : { target: V(x, y, z), r, el, az }; },
  get usePost() { return usePost; },
  // run the world forward without drawing (tests on slow software GL)
  async ff(seconds, dt = 1 / 30) {
    paused = true;
    for (let t = 0; t < seconds; t += dt) {
      tick(dt);
      stepCamera(dt);
      await new Promise(r => setTimeout(r, 0));
    }
    paused = false;
  },
};
