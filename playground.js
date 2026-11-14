/* =========================================================
   Max Yuan · robot playground
   A small world of robot stations, one per project. You drive a
   BracketBot (click the floor, click a station, or use the arrow
   keys); when it parks at a station, that station's robot does a
   short task from the project and the project card opens.
   Robots load from their real URDFs; motion is scripted with IK.
   ========================================================= */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { loadURDF, makeArm } from './urdf.js?v=2026-11-14';   // bump with playground.html's ?v=

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = sel => document.querySelector(sel);
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const ease = t => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DOWN = V(0, -1, 0);
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

// Dream Labs playground palette
const C = {
  bg: '#fbfaf7', floor: '#f3efe6', top: '#fbf8f2', ink: '#1c1c1c',
  sky: '#8bc7fc', skyTint: '#d6ebfd', skyDeep: '#3b86d1',
  grass: '#7de290', grassTint: '#d3f5da',
  lavender: '#af98ef', lavTint: '#e3dafa',
  sunshine: '#ffe885', sunTint: '#fdf3c4',
  sherbert: '#fc9ea0', sherbTint: '#ffd5d6',
  creamsicle: '#ffb06c', creamTint: '#ffe3cb',
  butter: '#f7cb7e', clayPeach: '#f8d3a9',
};

const status = $('#status');
const setStatus = (text, done = false) => {
  status.textContent = text;
  status.classList.toggle('is-done', done);
};

/* ---------------------------------------------------------
   Renderer, scene, light
   --------------------------------------------------------- */

const canvas = $('#world');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  setStatus('This browser could not start WebGL. The home page lists every project.');
  status.innerHTML = 'This browser could not start WebGL. The <a href="index.html">home page</a> lists every project.';
  throw e;
}
const isSmall = () => window.innerWidth < 640;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isSmall() ? 1.75 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(C.bg);
scene.fog = new THREE.Fog(C.bg, 13, 30);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;

scene.add(new THREE.HemisphereLight('#ffffff', '#ece6da', 1.0));
const sun = new THREE.DirectionalLight('#ffffff', 2.6);
sun.position.set(3.5, 8, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 20 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 4;
sun.shadow.blurSamples = 12;
scene.add(sun);

const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);

/* ---------------------------------------------------------
   Materials and small builders
   --------------------------------------------------------- */

const matCache = new Map();
const cached = (key, make) => {
  if (!matCache.has(key)) matCache.set(key, make());
  return matCache.get(key);
};
// glossy toy plastic, like the Dream Labs robots and props
const robotMat = hex => cached(`r${hex}`, () => new THREE.MeshPhysicalMaterial({
  color: hex, roughness: 0.45, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.3,
}));
const propMat = hex => cached(`p${hex}`, () => new THREE.MeshPhysicalMaterial({
  color: hex, roughness: 0.38, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.2,
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
function rug(w, d, color, r = 0.16) {
  const g = new THREE.ShapeGeometry(roundedRect(w, d, r), 8);
  g.rotateX(-Math.PI / 2);
  const m = mesh(g, matte(color), { shadow: false });
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
   Floor
   --------------------------------------------------------- */

const floor = mesh(new THREE.CircleGeometry(40, 96), matte(C.floor), { shadow: false });
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
// a pale plaza in the middle, where the BracketBot starts
const plaza = mesh(new THREE.CircleGeometry(1.15, 72), matte('#f7f3ea'), { shadow: false });
plaza.rotation.x = -Math.PI / 2;
plaza.position.y = 0.001;
scene.add(plaza);

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
function showCard(st) {
  card.style.setProperty('--tint', st.tint);
  card.querySelector('.card-robot').textContent = st.robot;
  card.querySelector('.card-title').textContent = st.title;
  card.querySelector('.card-line').textContent = st.line;
  const tags = card.querySelector('.card-tags');
  tags.replaceChildren(...st.tags.map(t => Object.assign(document.createElement('li'), { textContent: t })));
  const go = card.querySelector('.card-go');
  go.href = st.href;
  go.textContent = st.external ? 'Open on Devpost ↗' : 'Open project →';
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
card.querySelector('.card-close').addEventListener('click', () => {
  card.hidden = true;
  camFocus = null;
});

/* ---------------------------------------------------------
   Labels, station buttons, speech bubbles
   --------------------------------------------------------- */

const labelsEl = $('#labels');
const stationsEl = $('#stations');
STATIONS.forEach(st => {
  const label = document.createElement('button');
  label.className = 'label';
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
  el.className = 'bubble';
  el.textContent = text;
  labelsEl.append(el);
  const b = { el, where, life: dur };
  bubbles.push(b);
  requestAnimationFrame(() => el.classList.add('is-on'));
}

const proj = V();
function placeOverlay(el, world, dy = 0) {
  proj.copy(world).project(camera);
  const behind = proj.z > 1;
  const x = (proj.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-proj.y * 0.5 + 0.5) * window.innerHeight + dy;
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  return !behind;
}
function stepOverlays(dt) {
  STATIONS.forEach(st => {
    const ok = placeOverlay(st.label, st.at(0, st.anchorY, 0));
    const far = !ok || !!camFocus;      // the card names the station in focus
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
function hideHint() { hint.classList.add('is-gone'); }

/* ---------------------------------------------------------
   Camera: an overview that follows the robot a little, and
   closes in on a station when the robot parks there
   --------------------------------------------------------- */

let camFocus = null;
const cam = { target: V(0, 0.3, 0.2), r: 10, el: 0.62, az: 0 };
const user = { az: 0, el: 0, zoom: 1 };

function overview() {
  const aspect = window.innerWidth / window.innerHeight;
  if (aspect < 0.9) {
    // a phone held upright can't fit the whole ring: look down from higher, follow the robot more,
    // and leave the edges to dragging and the station buttons
    return { target: V(bot.x * 0.55, 0.2, 0.5 + bot.z * 0.4), r: 15.5, el: 0.92, az: 0 };
  }
  const fit = aspect < 1.2 ? 1.2 / aspect : 1;
  return { target: V(bot.x * 0.2, 0.2, 0.75 + bot.z * 0.15), r: 12.6 * Math.min(fit, 1.6), el: 0.62, az: 0 };
}
function focusView(st) {
  const fwd = V(0, 0, 1).applyQuaternion(st.group.quaternion);
  const az = Math.atan2(fwd.x, fwd.z) + (st.camTurn ?? 0.95);
  const aspect = window.innerWidth / window.innerHeight;
  const fit = aspect < 1 ? 1.35 / aspect : 1;
  const mid = st.at(0, 0.45, st.dock * 0.2);
  return { target: mid, r: (st.camR ?? 2.9) * Math.min(fit, 2.2), el: st.camEl ?? 0.55, az };
}
function stepCamera(dt) {
  const want = camFocus ? focusView(camFocus) : overview();
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
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]) / user.zoom;
  }
  drag.on = true;
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.moved = 0;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
});
canvas.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch0 > 0) user.zoom = clamp(d / pinch0, 0.45, 1.6);
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
      user.el = clamp(user.el + dy * 0.003, -0.4, 0.55);
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
  if (drag.moved <= 6 && e.type === 'pointerup') {
    const p = pick(e);
    if (!p) return;
    hideHint();
    if (p.station) goToStation(p.station);
    else driveTo(p.point.x, p.point.z);
  }
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  user.zoom = clamp(user.zoom * Math.exp(e.deltaY * 0.0012), 0.45, 1.6);
}, { passive: false });

const DRIVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd']);
window.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input, textarea')) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (DRIVE_KEYS.has(k) && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (k.startsWith('Arrow') && document.activeElement && document.activeElement.closest('.stations')) return;
    keys.add(k);
    hideHint();
    e.preventDefault();
  }
  if (k === 'Escape') {
    card.hidden = true;
    camFocus = null;
  }
});
window.addEventListener('keyup', e => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
window.addEventListener('blur', () => keys.clear());

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < 640 ? 38 : 30;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/* ---------------------------------------------------------
   Start
   --------------------------------------------------------- */

let last = performance.now();
let paused = false;
function frame(now = performance.now()) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (!paused) tick(dt);
  stepCamera(dt);
  stepOverlays(dt);
  renderer.render(scene, camera);
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
  status.innerHTML = 'The robots could not load. The <a href="index.html">home page</a> lists every project.';
});

// for testing from the console
window.__pg = {
  bot, STATIONS, byId, goToStation, driveTo, arrive, camera, scene, cam, user,
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
