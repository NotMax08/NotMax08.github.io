/* =========================================================
   Max Yuan · intro scene and page transitions
   Two SO-101 arms, loaded from the real URDF, sort a cube into
   four bins, one per page. On the home page the camera circles
   the table while the arms work. Changing page cuts to the
   robot's head camera: the nearer arm drops the cube into that
   page's bin and the camera follows it in.
   Imported on demand by main.js. Motion is scripted with IK.
   ========================================================= */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const BG = '#0B0E0F';
const CYAN = '#13CBFF';
// In an arc in front of the robot; from the intro camera, which faces the robot, they read left to right.
const BINS = [
  { key: 'projects', label: 'Projects', x: 0.27, z: -0.1 },
  { key: 'experience', label: 'Experience', x: 0.09, z: -0.15 },
  { key: 'skills', label: 'Skills', x: -0.09, z: -0.15 },
  { key: 'about', label: 'About', x: -0.27, z: -0.1 },
];
const CUBE = 0.032;
const SPAWN = new THREE.Vector3(0, CUBE / 2, 0);
const BIN_W = 0.1;
const BIN_H = 0.04;
const HEAD = new THREE.Vector3(0, 0.5, 0.4);        // the robot's head camera, on a mast behind the arms
const LOOK = new THREE.Vector3(0, 0, -0.1);         // where it looks by default
const EYE = HEAD.clone().addScaledVector(LOOK.clone().sub(HEAD).normalize(), 0.04);   // just in front of the lenses
const ORBIT = { target: new THREE.Vector3(0, 0.06, -0.03), r: 1.3, el: 0.5, az: Math.PI - 0.42, swing: 0.3 };   // in front of the robot, swinging slowly

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const ease = t => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
const easeIn = t => clamp(t, 0, 1) ** 2;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/* ---------------------------------------------------------
   Materials: the robot in one cyan, white jaws, dark props
   --------------------------------------------------------- */

// Double-sided: mesh decimation flips the odd triangle, and culling those would leave holes.
const mat = (color, roughness = 0.62) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, side: THREE.DoubleSide });
const MAT = {
  body: mat(CYAN),
  servo: mat('#0A6386', 0.5),
  jaw: mat('#EAF4F7', 0.55),
  bin: mat('#151D20', 0.9),
  cube: mat('#F2F6F7', 0.5),
  lens: mat('#05080A', 0.3),
  mast: mat('#1C272B', 0.8),
};
// The head camera and its mast fade out as the camera gets near them (it's the robot's own head).
const RIG = [MAT.lens, MAT.mast, mat(CYAN)];
RIG.forEach(m => { m.transparent = true; });
const RIG_BODY = RIG[2];

/* ---------------------------------------------------------
   URDF loader (revolute and fixed joints, mesh visuals).
   Meshes are GLB files decimated from the original STLs.
   --------------------------------------------------------- */

const gltf = new GLTFLoader();
const meshCache = new Map();

function loadMesh(url) {
  if (!meshCache.has(url)) {
    meshCache.set(url, gltf.loadAsync(url).then(g => {
      const parts = [];
      g.scene.updateMatrixWorld(true);
      g.scene.traverse(o => {
        if (!o.isMesh) return;
        let geo = o.geometry.clone();
        geo.applyMatrix4(o.matrixWorld);
        geo.deleteAttribute('normal');
        geo = toCreasedNormals(geo, THREE.MathUtils.degToRad(32));
        parts.push(geo);
      });
      return parts;
    }));
  }
  return meshCache.get(url);
}

const kids = (el, tag) => Array.from(el.children).filter(c => c.tagName === tag);
const nums = (s, fallback) => (s ? s.trim().split(/\s+/).map(Number) : fallback);
const originOf = el => {
  const o = el && kids(el, 'origin')[0];
  return { xyz: nums(o && o.getAttribute('xyz'), [0, 0, 0]), rpy: nums(o && o.getAttribute('rpy'), [0, 0, 0]) };
};
// URDF rpy is fixed-axis roll, pitch, yaw: R = Rz(y) Ry(p) Rx(r)
const quatRPY = ([r, p, y]) => new THREE.Quaternion().setFromEuler(new THREE.Euler(r, p, y, 'ZYX'));

async function loadURDF(xmlText, baseUrl, materialFor) {
  const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
  const robot = xml.querySelector('robot');
  if (!robot) throw new Error('URDF: no <robot>');

  const links = {};
  kids(robot, 'link').forEach(l => {
    const obj = new THREE.Group();
    obj.name = l.getAttribute('name');
    links[obj.name] = { el: l, obj };
  });

  const joints = {};
  const children = new Set();
  const tq = new THREE.Quaternion();
  kids(robot, 'joint').forEach(j => {
    const name = j.getAttribute('name');
    const parent = links[kids(j, 'parent')[0].getAttribute('link')];
    const child = links[kids(j, 'child')[0].getAttribute('link')];
    const { xyz, rpy } = originOf(j);
    const axisEl = kids(j, 'axis')[0];
    const axis = new THREE.Vector3(...nums(axisEl && axisEl.getAttribute('xyz'), [1, 0, 0]));
    if (axis.lengthSq() < 1e-9) axis.set(1, 0, 0);
    axis.normalize();
    const lim = kids(j, 'limit')[0];
    const lower = lim ? Number(lim.getAttribute('lower') || 0) : -Infinity;
    const upper = lim ? Number(lim.getAttribute('upper') || 0) : Infinity;
    const obj = new THREE.Group();
    obj.position.set(...xyz);
    const q0 = quatRPY(rpy);
    obj.quaternion.copy(q0);
    parent.obj.add(obj);
    obj.add(child.obj);
    children.add(child.obj.name);
    const revolute = j.getAttribute('type') === 'revolute';
    joints[name] = {
      lower, upper, value: 0,
      set(v) {
        if (!revolute) return;
        this.value = clamp(v, lower, upper);
        obj.quaternion.copy(q0).multiply(tq.setFromAxisAngle(axis, this.value));
      },
    };
  });

  const pending = [];
  Object.values(links).forEach(({ el, obj }) => {
    kids(el, 'visual').forEach(v => {
      const mesh = v.querySelector('geometry > mesh');
      if (!mesh) return;
      const { xyz, rpy } = originOf(v);
      const holder = new THREE.Group();
      holder.position.set(...xyz);
      holder.quaternion.copy(quatRPY(rpy));
      holder.scale.set(...nums(mesh.getAttribute('scale'), [1, 1, 1]));
      obj.add(holder);
      const matEl = kids(v, 'material')[0];
      const material = materialFor(obj.name, matEl && matEl.getAttribute('name'));
      pending.push(loadMesh(new URL(mesh.getAttribute('filename'), baseUrl).href).then(parts => {
        parts.forEach(geo => holder.add(new THREE.Mesh(geo, material)));
      }));
    });
  });
  await Promise.all(pending);

  const rootName = Object.keys(links).find(n => !children.has(n));
  return { root: links[rootName].obj, links, joints };
}

/* ---------------------------------------------------------
   IK: damped least squares on [pan, lift, elbow, wrist_flex],
   reaching a point with the gripper tilted toward it
   --------------------------------------------------------- */

const ARM_JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
const IK_JOINTS = 4;
const APPROACH_TILT = 0.45;   // rad from vertical: the SO-101 wrist can't point straight down at height
const GRIP_OPEN = 1.0;
const GRIP_SHUT = 0.12;

function solveSmall(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c += 1) {
    let piv = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = c + 1; r < n; r += 1) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k += 1) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let s = b[r];
    for (let k = r + 1; k < n; k += 1) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

function makeIK(arm) {
  const tcp = arm.links.gripper_frame_link.obj;
  const js = ARM_JOINTS.slice(0, IK_JOINTS).map(n => arm.joints[n]);
  const p = new THREE.Vector3();
  const z = new THREE.Vector3();
  const e0 = new Float64Array(6);
  const e1 = new Float64Array(6);
  const Jm = Array.from({ length: 6 }, () => new Float64Array(IK_JOINTS));
  const W = 0.08;

  function error(q, target, dir, out) {
    js.forEach((j, i) => j.set(q[i]));
    arm.root.updateMatrixWorld(true);
    tcp.getWorldPosition(p);
    z.setFromMatrixColumn(tcp.matrixWorld, 2).normalize();
    out[0] = target.x - p.x; out[1] = target.y - p.y; out[2] = target.z - p.z;
    out[3] = W * (dir.x - z.x); out[4] = W * (dir.y - z.y); out[5] = W * (dir.z - z.z);
  }

  return function ik(target, dir, seed) {
    const saved = js.map(j => j.value);
    const q = seed.slice(0, IK_JOINTS);
    const lam2 = 0.02 * 0.02;
    for (let it = 0; it < 90; it += 1) {
      error(q, target, dir, e0);
      let n0 = 0;
      for (let i = 0; i < 6; i += 1) n0 += e0[i] * e0[i];
      if (n0 < 1e-9) break;
      for (let k = 0; k < IK_JOINTS; k += 1) {
        const qq = q.slice();
        qq[k] += 1e-4;
        error(qq, target, dir, e1);
        for (let i = 0; i < 6; i += 1) Jm[i][k] = (e0[i] - e1[i]) / 1e-4;
      }
      const A = Array.from({ length: IK_JOINTS }, (_, r) => Array.from({ length: IK_JOINTS }, (_, c) => {
        let s = r === c ? lam2 : 0;
        for (let i = 0; i < 6; i += 1) s += Jm[i][r] * Jm[i][c];
        return s;
      }));
      const b = Array.from({ length: IK_JOINTS }, (_, r) => {
        let s = 0;
        for (let i = 0; i < 6; i += 1) s += Jm[i][r] * e0[i];
        return s;
      });
      const dq = solveSmall(A, b);
      const norm = Math.hypot(...dq);
      const k = norm > 0.3 ? 0.3 / norm : 1;
      for (let i = 0; i < IK_JOINTS; i += 1) q[i] = clamp(q[i] + dq[i] * k, js[i].lower, js[i].upper);
    }
    js.forEach((j, i) => j.set(saved[i]));
    arm.root.updateMatrixWorld(true);
    return q;
  };
}

/* ---------------------------------------------------------
   Props: floor, bins, the head camera on its mast
   --------------------------------------------------------- */

// A faint grid on a soft disc that fades into the background.
function makeFloor() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uLine: { value: new THREE.Color('#22323A') },
      uDisc: { value: new THREE.Color('#10171A') },
    },
    vertexShader: `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform vec3 uLine;
      uniform vec3 uDisc;
      varying vec3 vW;
      float line(vec2 p, float s) {
        vec2 c = p / s;
        vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main() {
        float d = length(vW.xz - vec2(0.0, 0.02));
        float disc = 1.0 - smoothstep(0.18, 0.85, d);
        float grid = max(line(vW.xz, 0.05) * 0.35, line(vW.xz, 0.25) * 0.8) * (1.0 - smoothstep(0.3, 0.75, d));
        vec3 col = mix(uDisc, uLine, grid);
        float a = max(disc * 0.95, grid);
        if (a < 0.003) discard;
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2), mat);
  mesh.renderOrder = -1;
  return mesh;
}

function makeBin(def) {
  const g = new THREE.Group();
  const t = 0.004;
  const parts = [
    [BIN_W, t, BIN_W, 0, t / 2, 0],
    [BIN_W, BIN_H, t, 0, BIN_H / 2, BIN_W / 2 - t / 2],
    [BIN_W, BIN_H, t, 0, BIN_H / 2, -BIN_W / 2 + t / 2],
    [t, BIN_H, BIN_W, BIN_W / 2 - t / 2, BIN_H / 2, 0],
    [t, BIN_H, BIN_W, -BIN_W / 2 + t / 2, BIN_H / 2, 0],
  ];
  parts.forEach(([w, h, d, x, y, z]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MAT.bin);
    m.position.set(x, y, z);
    m.userData.key = def.key;
    g.add(m);
  });
  const s = BIN_W / 2;
  const rimGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-s, BIN_H, -s), new THREE.Vector3(s, BIN_H, -s),
    new THREE.Vector3(s, BIN_H, -s), new THREE.Vector3(s, BIN_H, s),
    new THREE.Vector3(s, BIN_H, s), new THREE.Vector3(-s, BIN_H, s),
    new THREE.Vector3(-s, BIN_H, s), new THREE.Vector3(-s, BIN_H, -s),
  ]);
  const rimMat = new THREE.LineBasicMaterial({ color: '#33454C', transparent: true });
  g.add(new THREE.LineSegments(rimGeo, rimMat));
  g.position.set(def.x, 0, def.z);
  return { group: g, rimMat };
}

function makeHead() {
  const g = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.016, HEAD.y, 0.016), MAT.mast);
  mast.position.set(HEAD.x, HEAD.y / 2, HEAD.z + 0.03);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.006, 32), MAT.mast);
  foot.position.set(HEAD.x, 0.003, HEAD.z + 0.03);
  g.add(mast, foot);

  // a pill-shaped stereo camera, pitched to look at the table
  const head = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.075, 8, 24).rotateZ(Math.PI / 2), RIG_BODY);
  head.add(shell);
  [-0.032, 0.032].forEach(x => {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.004, 24).rotateX(Math.PI / 2), MAT.lens);
    lens.position.set(x, 0, -0.018);
    head.add(lens);
  });
  head.position.copy(HEAD);
  head.lookAt(LOOK.x, LOOK.y, LOOK.z);
  head.rotateY(Math.PI);                          // lookAt points +z at the target; the lenses face -z
  g.add(head);
  return { group: g, head };
}

/* ---------------------------------------------------------
   Grain: a fixed dither over the frame, like a print
   --------------------------------------------------------- */

const GrainShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 0.035 } },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb += (hash(gl_FragCoord.xy) - 0.5) * uAmount;
      gl_FragColor = c;
    }`,
};

/* ---------------------------------------------------------
   The scene
   --------------------------------------------------------- */

export async function createRobot({ canvas, labels, base = '', reduceMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.add(new THREE.HemisphereLight(0xe6f7ff, 0x0b0e0f, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(0.6, 1.4, 0.9);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fe6ff, 0.9);
  rim.position.set(-0.8, 0.6, -1.0);
  scene.add(rim);

  scene.add(makeFloor());
  const rig = makeHead();
  scene.add(rig.group);

  const bins = {};
  const binMeshes = [];
  BINS.forEach(def => {
    const b = makeBin(def);
    scene.add(b.group);
    b.group.traverse(o => { if (o.isMesh) binMeshes.push(o); });
    bins[def.key] = {
      ...def, ...b,
      center: new THREE.Vector3(def.x, 0, def.z),
      anchor: new THREE.Vector3(def.x, 0, def.z - BIN_W / 2 - 0.018),
      cubes: [],
    };
  });

  /* ---------- arms ---------- */

  const urdfUrl = new URL(`${base}assets/robots/so101/so101.urdf`, document.baseURI);
  const urdfText = await fetch(urdfUrl).then(r => {
    if (!r.ok) throw new Error(`so101.urdf: ${r.status}`);
    return r.text();
  });
  const materialFor = (link, material) => {
    if (material === 'sts3215') return MAT.servo;
    if (link === 'gripper_link' || link === 'moving_jaw_so101_v1_link') return MAT.jaw;
    return MAT.body;
  };

  const armDefs = [
    { side: 'L', base: new THREE.Vector3(-0.17, 0, 0.1) },
    { side: 'R', base: new THREE.Vector3(0.17, 0, 0.1) },
  ];
  const arms = await Promise.all(armDefs.map(async def => {
    const urdf = await loadURDF(urdfText, urdfUrl, materialFor);
    const carrier = new THREE.Group();
    urdf.root.rotation.x = -Math.PI / 2;           // ROS z-up → three y-up
    carrier.add(urdf.root);
    carrier.position.copy(def.base);
    carrier.rotation.y = Math.PI / 2;               // the arm's +x (forward) points at the bins (-z)
    scene.add(carrier);
    carrier.updateMatrixWorld(true);
    const arm = { ...def, ...urdf, root: carrier, queue: [], seg: null, t: 0 };
    arm.ik = makeIK(arm);
    arm.gripper = urdf.links.gripper_link.obj;
    return arm;
  }));
  const [armL, armR] = arms;
  BINS.forEach(def => { bins[def.key].arm = def.x < 0 ? armL : armR; });

  const dirFor = (arm, p) => {
    const h = new THREE.Vector3(p.x - arm.base.x, 0, p.z - arm.base.z).normalize();
    return new THREE.Vector3(0, -Math.cos(APPROACH_TILT), 0).addScaledVector(h, Math.sin(APPROACH_TILT));
  };
  const SEED = [0, -0.2, 0.6, 0.8];
  const solveAt = (arm, p, seed = SEED) => {
    const s = seed.slice();
    const local = arm.root.worldToLocal(p.clone());   // x forward, z = the arm's right
    s[0] = Math.atan2(local.z, local.x);
    return arm.ik(p, dirFor(arm, p), s);
  };
  const ahead = (arm, fwd, side, up) => arm.root.localToWorld(new THREE.Vector3(fwd, up, side));

  // Every pose the arms need, solved once.
  arms.forEach(arm => {
    const ready = solveAt(arm, ahead(arm, 0.12, 0, 0.09));
    const pre = solveAt(arm, SPAWN.clone().setY(0.08), ready);
    const grasp = solveAt(arm, SPAWN.clone().setY(0.013), pre);
    const lift = solveAt(arm, SPAWN.clone().setY(0.11), grasp);
    arm.Q = { ready, pre, grasp, lift, over: {} };
    BINS.forEach(def => {
      if (bins[def.key].arm === arm) arm.Q.over[def.key] = solveAt(arm, new THREE.Vector3(def.x, BIN_H + 0.055, def.z), lift);
    });
    arm.q = [...ready, 0, GRIP_SHUT];
    arm.apply = () => ARM_JOINTS.forEach((n, i) => arm.joints[n].set(arm.q[i]));
    arm.apply();
  });
  const pose = (q, grip) => [...q, 0, grip];

  // A tiny timeline per arm: segments that ease between joint vectors, then run a callback.
  function plan(arm, segs) {
    arm.queue = segs;
    arm.seg = null;
  }
  function stepArm(arm, dt) {
    if (!arm.seg && arm.queue.length) {
      arm.seg = arm.queue.shift();
      arm.seg.from = arm.q.slice();
      arm.t = 0;
    }
    const seg = arm.seg;
    if (seg) {
      arm.t += dt / seg.dur;
      const k = ease(arm.t);
      arm.q = seg.from.map((a, i) => a + (seg.to[i] - a) * k);
      if (arm.t >= 1) {
        arm.q = seg.to.slice();
        arm.seg = null;
        seg.end && seg.end();
      }
    }
    arm.apply();
  }
  const busy = arm => !!arm.seg || arm.queue.length > 0;

  /* ---------- cubes ---------- */

  const cubeGeo = new THREE.BoxGeometry(CUBE, CUBE, CUBE);
  let cube = null;                 // the cube waiting at the spawn point, or held
  const loose = [];                // cubes falling, or shrinking away

  function spawnCube(arm) {
    if (cube) return cube;
    const mesh = new THREE.Mesh(cubeGeo, MAT.cube);
    mesh.position.copy(SPAWN);
    mesh.scale.setScalar(reduceMotion ? 1 : 0.001);
    scene.add(mesh);
    cube = { mesh, grow: reduceMotion ? 1 : 0 };
    faceArm(arm);
    return cube;
  }
  // square the cube to the arm that will pick it, so the jaws meet its faces
  function faceArm(arm) {
    if (cube && !cube.held) cube.mesh.rotation.set(0, Math.atan2(SPAWN.x - arm.base.x, SPAWN.z - arm.base.z), 0);
  }
  function grab(arm) {
    if (!cube) return;
    arm.gripper.attach(cube.mesh);
    cube.held = arm;
  }
  function landing(bin) {
    const n = bin.cubes.length;
    const slot = [[-1, -1], [1, 1], [1, -1], [-1, 1]][n % 4];
    const off = 0.021;
    return new THREE.Vector3(
      bin.x + slot[0] * off + (Math.random() - 0.5) * 0.006,
      0.004 + CUBE / 2 + Math.floor(n / 4) * CUBE,
      bin.z + slot[1] * off + (Math.random() - 0.5) * 0.006,
    );
  }
  function release(bin) {
    if (!cube) return;
    const c = cube;
    cube = null;
    scene.attach(c.mesh);
    c.held = null;
    const yaw = new THREE.Euler().setFromQuaternion(c.mesh.quaternion, 'YXZ').y + (Math.random() - 0.5) * 0.8;
    c.fall = {
      from: c.mesh.position.clone(), to: landing(bin), vy: 0, t: 0,
      q0: c.mesh.quaternion.clone(), q1: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
    };
    bin.cubes.push(c);
    loose.push(c);
    if (bin.cubes.length > 6) {
      const old = bin.cubes.shift();
      old.shrink = 1;
      if (!loose.includes(old)) loose.push(old);
    }
  }
  // place a cube in a bin with no animation (skip, reduced motion)
  function settle(c) {
    if (!c.fall) return;
    c.mesh.position.copy(c.fall.to);
    c.mesh.quaternion.copy(c.fall.q1);
    c.fall = null;
  }
  function discardCube() {
    if (!cube) return;
    const c = cube;
    cube = null;
    scene.attach(c.mesh);
    c.held = null;
    c.shrink = 1;
    loose.push(c);
  }

  function stepCubes(dt) {
    if (cube && cube.grow < 1) {
      cube.grow = Math.min(1, cube.grow + dt / 0.22);
      cube.mesh.scale.setScalar(Math.max(0.001, ease(cube.grow)));
    }
    for (let i = loose.length - 1; i >= 0; i -= 1) {
      const c = loose[i];
      if (c.fall) {
        const f = c.fall;
        f.t += dt;
        f.vy -= 9.8 * dt;
        const p = c.mesh.position;
        p.y += f.vy * dt;
        const k = Math.min(1, f.t / 0.14);
        p.x = lerp(f.from.x, f.to.x, k);
        p.z = lerp(f.from.z, f.to.z, k);
        c.mesh.quaternion.slerpQuaternions(f.q0, f.q1, ease(k));
        if (p.y <= f.to.y) {
          p.y = f.to.y;
          if (f.vy < -0.35) f.vy = -f.vy * 0.25;
          else settle(c);
        }
      }
      if (c.shrink !== undefined) {
        c.shrink -= dt / 0.3;
        c.mesh.scale.setScalar(Math.max(0.001, c.shrink));
        if (c.shrink <= 0) {
          scene.remove(c.mesh);
          loose.splice(i, 1);
          continue;
        }
      }
      if (!c.fall && c.shrink === undefined) loose.splice(i, 1);
    }
  }

  /* ---------- camera: a slow orbit, or the head camera ---------- */

  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 10);
  const view = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 34 };
  const cam = {
    mode: 'orbit',                 // 'orbit' | 'pov'
    clock: 0,
    fly: null,                     // { from, t, dur }
    dive: null,                    // { bin, t, dur }
    focus: LOOK.clone(),
    focusTo: LOOK.clone(),
  };
  let aspect = 1;

  const sph = new THREE.Spherical();
  const tmp = new THREE.Vector3();

  // Keep the scene's width on screen on narrow, tall viewports: widen the lens, then back away.
  function fit(state, halfWidth, maxFov = 72, maxBack = 2.2) {
    const halfH = THREE.MathUtils.degToRad(state.fov / 2);
    const needed = Math.atan(Math.tan(halfWidth) / aspect);
    const maxHalf = THREE.MathUtils.degToRad(maxFov / 2);
    if (needed > halfH) {
      const half = Math.min(needed, maxHalf);
      state.fov = THREE.MathUtils.radToDeg(half * 2);
      if (needed > maxHalf) {
        tmp.subVectors(state.pos, state.look).multiplyScalar(Math.min(maxBack, Math.tan(needed) / Math.tan(maxHalf)));
        state.pos.copy(state.look).add(tmp);
      }
    }
    return state;
  }

  function orbitState(out) {
    const az = ORBIT.az + (reduceMotion ? 0 : ORBIT.swing * Math.sin(cam.clock * 0.11));
    sph.set(ORBIT.r, Math.PI / 2 - ORBIT.el, az);
    out.look.copy(ORBIT.target);
    out.pos.setFromSpherical(sph).add(ORBIT.target);
    out.fov = 34;
    return fit(out, 0.34);
  }

  function povState(out) {
    out.pos.copy(EYE);
    out.look.copy(LOOK).lerp(cam.focus, 0.35);
    out.fov = 55;
    return fit(out, 0.6, 80, 1.3);   // on a phone, let the outer bins crop rather than back out of the head
  }

  // Fly between two views around their look points, so the camera swings round instead of cutting through.
  const a = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 0 };
  const sA = new THREE.Spherical();
  const sB = new THREE.Spherical();
  function blend(from, to, k, out) {
    sA.setFromVector3(tmp.subVectors(from.pos, from.look));
    sB.setFromVector3(tmp.subVectors(to.pos, to.look));
    const theta = sA.theta + wrap(sB.theta - sA.theta) * k;
    const phi = lerp(sA.phi, sB.phi, k) - Math.sin(Math.PI * k) * 0.3;   // rise over the arms on the way
    const r = lerp(sA.radius, sB.radius, k);
    out.look.lerpVectors(from.look, to.look, k);
    out.pos.setFromSpherical(sph.set(r, phi, theta)).add(out.look);
    out.fov = lerp(from.fov, to.fov, k);
    return out;
  }

  function stepCamera(dt) {
    cam.clock += dt;
    cam.focus.lerp(cam.focusTo, 1 - Math.exp(-dt * 5));
    if (cam.mode === 'orbit') orbitState(view);
    else povState(view);

    // into the bin: turn to it, lean in a little and zoom
    if (cam.dive) {
      const d = cam.dive;
      d.t = Math.min(1, d.t + dt / d.dur);
      const k = easeIn(d.t);
      view.look.lerp(d.bin.center, Math.min(1, ease(d.t * 1.6)));
      view.pos.lerp(tmp.copy(d.bin.center).setY(0.3), k * 0.3);
      view.fov = lerp(view.fov, 22, k);
    }
    if (cam.fly) {
      const f = cam.fly;
      f.t = Math.min(1, f.t + dt / f.dur);
      blend(f.from, view, ease(f.t), a);
      view.pos.copy(a.pos);
      view.look.copy(a.look);
      view.fov = a.fov;
      if (f.t >= 1) cam.fly = null;
    }
    camera.position.copy(view.pos);
    camera.lookAt(view.look);
    const fade = cam.mode === 'pov' && !cam.fly ? 0 : clamp((view.pos.distanceTo(HEAD) - 0.2) / 0.35, 0, 1);
    RIG.forEach(m => { m.opacity = fade; });
    rig.group.visible = fade > 0.01;
    if (camera.fov !== view.fov) {
      camera.fov = view.fov;
      camera.updateProjectionMatrix();
    }
  }

  function flyTo(mode, dur) {
    const from = { pos: view.pos.clone(), look: view.look.clone(), fov: view.fov };
    cam.mode = mode;
    cam.dive = null;
    cam.fly = dur > 0 ? { from, t: 0, dur } : null;
  }

  /* ---------- post-processing: motion trails, then grain ---------- */

  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(dpr);
  composer.addPass(new RenderPass(scene, camera));
  const trails = new AfterimagePass(0.8);
  // Fade the whole trail together. The stock shader drops each channel below 0.1, which turns cyan trails blue.
  trails.compFsMaterial.fragmentShader = `
    uniform float damp;
    uniform sampler2D tOld;
    uniform sampler2D tNew;
    varying vec2 vUv;
    void main() {
      gl_FragColor = max(texture2D(tNew, vUv), texture2D(tOld, vUv) * damp);
    }`;
  trails.compFsMaterial.needsUpdate = true;
  trails.enabled = !reduceMotion;
  composer.addPass(trails);
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass(GrainShader));

  /* ---------- bin labels (HTML, so the text stays crisp) ---------- */

  const labelEls = {};
  BINS.forEach(def => {
    const el = document.createElement('a');
    el.className = 'bin-label';
    el.href = `#${def.key}`;
    el.tabIndex = -1;                               // the nav has the same links for keyboards
    el.textContent = def.label;
    el.addEventListener('mouseenter', () => setHover(def.key));
    el.addEventListener('mouseleave', () => setHover(null));
    labels.append(el);
    labelEls[def.key] = el;
  });
  let hoverKey = null;
  let activeKey = null;
  const rimIdle = new THREE.Color('#33454C');
  const rimHot = new THREE.Color(CYAN);
  function paint() {
    BINS.forEach(({ key: k }) => {
      const on = k === activeKey || k === hoverKey;
      bins[k].rimMat.color.copy(on ? rimHot : rimIdle);
      labelEls[k].classList.toggle('hot', on);
    });
    if (reduceMotion) render(0);
  }
  function setHover(k) {
    if (k === hoverKey) return;
    hoverKey = k;
    canvas.style.cursor = k ? 'pointer' : '';
    paint();
  }

  const ndc = new THREE.Vector3();
  let vw = 1;
  let vh = 1;
  function placeLabels() {
    BINS.forEach(({ key: k }) => {
      ndc.copy(bins[k].anchor).project(camera);
      const el = labelEls[k];
      if (ndc.z > 1) { el.style.visibility = 'hidden'; return; }
      el.style.visibility = '';
      el.style.transform = `translate(${((ndc.x + 1) / 2 * vw).toFixed(1)}px, ${((1 - ndc.y) / 2 * vh).toFixed(1)}px) translate(-50%, -100%)`;
    });
  }

  // Clicking a bin in the scene works like its label.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const binAt = e => {
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(binMeshes, false)[0];
    return hit ? hit.object.userData.key : null;
  };
  canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && cam.mode === 'orbit') setHover(binAt(e)); });
  canvas.addEventListener('pointerleave', () => setHover(null));
  canvas.addEventListener('click', e => {
    if (cam.mode !== 'orbit') return;
    const k = binAt(e);
    if (k) location.hash = k;
  });

  /* ---------- idle: the arms take turns sorting cubes ---------- */

  let idleTimer = 0;
  let idleTurn = 1;
  let lastBin = null;

  // Callbacks only run if no newer transition (or the way home) has started since.
  let epoch = 0;
  const current = fn => {
    const mine = epoch;
    return () => { if (fn && mine === epoch) fn(); };
  };

  function pickAndDrop(arm, bin, { slow = 1, reach = 0.5, onCarry, onRelease } = {}) {
    const Q = arm.Q;
    onCarry = current(onCarry);
    onRelease = current(onRelease);
    spawnCube(arm);
    faceArm(arm);
    plan(arm, [
      { to: pose(Q.pre, GRIP_OPEN), dur: reach * slow },
      { to: pose(Q.grasp, GRIP_OPEN), dur: 0.2 * slow },
      { to: pose(Q.grasp, GRIP_SHUT), dur: 0.12 * slow, end: () => grab(arm) },
      { to: pose(Q.lift, GRIP_SHUT), dur: 0.18 * slow, end: onCarry },
      { to: pose(Q.over[bin.key], GRIP_SHUT), dur: 0.42 * slow },
      { to: pose(Q.over[bin.key], GRIP_OPEN), dur: 0.1 * slow, end: () => { release(bin); onRelease && onRelease(); } },
      { to: pose(Q.ready, GRIP_SHUT), dur: 0.55 * slow },
    ]);
  }

  function idleStep() {
    idleTimer = 0;
    if (cam.mode !== 'orbit' || reduceMotion || !running) return;
    if (arms.some(busy)) { idleTimer = setTimeout(idleStep, 400); return; }
    const arm = arms[idleTurn % 2];
    idleTurn += 1;
    const choices = BINS.filter(d => bins[d.key].arm === arm && d.key !== lastBin);
    const bin = bins[choices[Math.floor(Math.random() * choices.length)].key];
    lastBin = bin.key;
    pickAndDrop(arm, bin, {
      slow: 1.9,
      onRelease: () => { idleTimer = setTimeout(idleStep, 1700); },
    });
  }
  function stopIdle() {
    clearTimeout(idleTimer);
    idleTimer = 0;
  }
  function startIdle(delay = 900) {
    stopIdle();
    if (!reduceMotion) idleTimer = setTimeout(idleStep, delay);
  }

  /* ---------- page transitions ---------- */

  let pending = null;              // { resolve } for the transition in progress
  let diveTimer = 0;

  function finishPending() {
    clearTimeout(diveTimer);
    const p = pending;
    pending = null;
    if (p) p.resolve();
  }

  // First person: the nearer arm drops the cube into the bin for `pageKey`.
  // Resolves as the cube lands, while the camera starts moving into the bin.
  function transition(pageKey) {
    const bin = bins[pageKey];
    finishPending();
    stopIdle();
    epoch += 1;
    if (!bin) return Promise.resolve();
    activeKey = pageKey;
    hoverKey = null;
    paint();

    const fromOrbit = cam.mode === 'orbit' && !cam.dive;
    if (fromOrbit) flyTo('pov', 0.8);
    else { flyTo('pov', 0); cam.focus.copy(LOOK); }

    const arm = bin.arm;
    const other = arm === armL ? armR : armL;
    if (cube && cube.held) discardCube();
    loose.forEach(settle);
    plan(other, [{ to: pose(other.Q.ready, GRIP_SHUT), dur: 0.45 }]);
    cam.focusTo.copy(SPAWN);

    return new Promise(resolve => {
      pending = { resolve };
      pickAndDrop(arm, bin, {
        reach: fromOrbit ? 0.75 : 0.45,
        onCarry: () => cam.focusTo.copy(bin.center),       // the head turns to the bin
        onRelease: () => {
          diveTimer = setTimeout(() => {
            cam.dive = { bin, t: 0, dur: 0.6 };
            finishPending();
          }, 140);
        },
      });
    });
  }

  // Jump to the end of a transition (a click or key press during it).
  function skip() {
    if (!pending) return;
    const bin = bins[activeKey];
    arms.forEach(arm => {
      plan(arm, []);
      arm.q = pose(arm.Q.ready, GRIP_SHUT);
      arm.apply();
    });
    if (cube) {
      if (!cube.held) grab(bin.arm);
      release(bin);
    }
    loose.forEach(settle);
    cam.dive = { bin, t: 0.5, dur: 0.6 };
    finishPending();
  }

  // Back to the third-person view on the home page.
  function home() {
    finishPending();
    epoch += 1;
    activeKey = null;
    paint();
    if (cam.mode !== 'orbit' || cam.dive) {
      if (cam.dive) { cam.dive = null; cam.mode = 'pov'; cam.focus.copy(LOOK); cam.focusTo.copy(LOOK); stepCamera(0); }
      flyTo('orbit', reduceMotion ? 0 : 1.1);
    }
    arms.forEach(arm => { if (!busy(arm)) plan(arm, [{ to: pose(arm.Q.ready, GRIP_SHUT), dur: 0.5 }]); });
    if (!cube) spawnCube(armR);
    startIdle(1400);
    if (reduceMotion && running) render(0);
  }

  /* ---------- loop ---------- */

  let running = false;
  let wantRun = false;
  let last = 0;

  function render(dt) {
    arms.forEach(arm => stepArm(arm, dt));
    stepCubes(dt);
    stepCamera(dt);
    if (trails.enabled) trails.damp = Math.pow(cam.mode === 'orbit' && !cam.fly ? 0.8 : 0.62, Math.max(dt, 1 / 120) * 60);
    composer.render(dt);
    placeLabels();
  }

  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    render(dt);
  }

  function setRunning() {
    const run = wantRun && !document.hidden;
    if (run === running) return;
    running = run;
    last = performance.now();
    renderer.setAnimationLoop(run && !reduceMotion ? tick : null);
    if (run && reduceMotion) render(0);
    if (run && cam.mode === 'orbit' && !arms.some(busy)) startIdle();
    if (!run) stopIdle();
  }
  document.addEventListener('visibilitychange', setRunning);

  function resize() {
    vw = window.innerWidth;
    vh = window.innerHeight;
    aspect = vw / vh;
    renderer.setSize(vw, vh, false);
    composer.setSize(vw, vh);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    if (reduceMotion && running) render(0);
  }
  window.addEventListener('resize', resize);
  resize();

  spawnCube(armR);
  stepCamera(0);

  return {
    transition,
    home,
    skip,
    get busy() { return !!pending; },
    // Run the loop only while the scene is on screen.
    setVisible(on) {
      wantRun = on;
      setRunning();
    },
    hover: setHover,
  };
}
