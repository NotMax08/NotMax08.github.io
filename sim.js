/* =========================================================
   Robot sim on the home page.
   Loads real URDFs (Unitree Go2, SO-101) with three.js and uses
   the robots to navigate the site: the Go2 walks to a waypoint,
   or the arms pick up a labelled block and drop it in the tray.
   Imported on demand by main.js.

   Motion is scripted: a trot gait with analytic leg IK for the
   Go2, and damped-least-squares IK for the arms. No policy runs.
   ========================================================= */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const SECTIONS = ['about', 'projects', 'experience', 'awards', 'skills', 'contact'];
const BG = new THREE.Color('#0C0E11');
const ACCENT = new THREE.Color('#B7C9E2');
const clamp = THREE.MathUtils.clamp;
const smooth = t => t * t * (3 - 2 * t);
const ease = t => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

// Double-sided: decimation flips the odd triangle, and culling those would leave holes.
const robotMat = (color, roughness, metalness) => new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
const MAT = {
  shell: robotMat('#949EAB', 0.55, 0.12),
  panel: robotMat('#C3CCD7', 0.6, 0.04),
  dark: robotMat('#1A1C1F', 0.6, 0.1),
  printed: robotMat('#A3B6D0', 0.68, 0.02),
  servo: robotMat('#1C2024', 0.5, 0.15),
};

/* ---------------------------------------------------------
   URDF loader: links, joints (revolute / continuous / prismatic /
   fixed), visuals with origins, mesh + primitive geometry.
   Meshes are GLB files decimated from the originals.
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
        parts.push({ geometry: geo, color: o.material && o.material.color ? o.material.color.clone() : null });
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

async function loadURDF(url, { materialFor, onMesh }) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const xml = new DOMParser().parseFromString(await res.text(), 'application/xml');
  const robot = xml.querySelector('robot');
  if (!robot) throw new Error(`${url}: no <robot>`);
  const baseUrl = new URL('.', new URL(url, location.href));

  const colors = {};
  kids(robot, 'material').forEach(m => {
    const c = kids(m, 'color')[0];
    if (c) colors[m.getAttribute('name')] = nums(c.getAttribute('rgba'), [1, 1, 1, 1]);
  });

  const links = {};
  kids(robot, 'link').forEach(l => {
    const obj = new THREE.Group();
    obj.name = l.getAttribute('name');
    links[obj.name] = { el: l, obj };
  });

  const joints = {};
  const children = new Set();
  const tq = new THREE.Quaternion();
  const tv = new THREE.Vector3();
  kids(robot, 'joint').forEach(j => {
    const name = j.getAttribute('name');
    const type = j.getAttribute('type');
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
    obj.name = name;
    obj.position.set(...xyz);
    const q0 = quatRPY(rpy);
    obj.quaternion.copy(q0);
    parent.obj.add(obj);
    obj.add(child.obj);
    children.add(child.obj.name);
    joints[name] = {
      name, type, obj, axis, lower, upper, value: 0,
      set(v) {
        if (type === 'revolute' || type === 'prismatic') v = clamp(v, lower, upper);
        this.value = v;
        if (type === 'revolute' || type === 'continuous') {
          obj.quaternion.copy(q0).multiply(tq.setFromAxisAngle(axis, v));
        } else if (type === 'prismatic') {
          obj.position.set(...xyz).add(tv.copy(axis).multiplyScalar(v).applyQuaternion(q0));
        }
      },
    };
  });

  const pending = [];
  Object.values(links).forEach(({ el, obj }) => {
    kids(el, 'visual').forEach(v => {
      const { xyz, rpy } = originOf(v);
      const holder = new THREE.Group();
      holder.position.set(...xyz);
      holder.quaternion.copy(quatRPY(rpy));
      obj.add(holder);
      const geomEl = kids(v, 'geometry')[0];
      const matEl = kids(v, 'material')[0];
      const matName = matEl && matEl.getAttribute('name');
      const inline = matEl && kids(matEl, 'color')[0];
      const rgba = inline ? nums(inline.getAttribute('rgba')) : colors[matName];
      const g = geomEl && geomEl.firstElementChild;
      if (!g) return;
      const addMesh = (geometry, color) => {
        const m = new THREE.Mesh(geometry, materialFor({ link: obj.name, material: matName, rgba, color }));
        m.castShadow = true;
        m.receiveShadow = true;
        holder.add(m);
      };
      if (g.tagName === 'mesh') {
        const scale = nums(g.getAttribute('scale'), [1, 1, 1]);
        holder.scale.set(...scale);
        pending.push(loadMesh(new URL(g.getAttribute('filename'), baseUrl).href).then(parts => {
          parts.forEach(p => addMesh(p.geometry, p.color));
          onMesh && onMesh();
        }));
      } else if (g.tagName === 'box') {
        addMesh(new THREE.BoxGeometry(...nums(g.getAttribute('size'))));
      } else if (g.tagName === 'cylinder') {
        const r = Number(g.getAttribute('radius'));
        const geo = new THREE.CylinderGeometry(r, r, Number(g.getAttribute('length')), 24);
        geo.rotateX(Math.PI / 2);                  // URDF cylinders run along z
        addMesh(geo);
      } else if (g.tagName === 'sphere') {
        addMesh(new THREE.SphereGeometry(Number(g.getAttribute('radius')), 20, 14));
      }
    });
  });
  const meshCount = pending.length;
  await Promise.all(pending);

  const rootName = Object.keys(links).find(n => !children.has(n));
  return { root: links[rootName].obj, links, joints, meshCount };
}

function countMeshes(text) {
  return (text.match(/<mesh\b/g) || []).length;
}

/* ---------------------------------------------------------
   Shared stage: fog, lights, shadows
   --------------------------------------------------------- */

let envMap = null;   // soft studio reflections, built once per renderer

function makeStage({ fog, shadow }) {
  const scene = new THREE.Scene();
  scene.background = BG.clone();
  scene.environment = envMap;
  scene.environmentIntensity = 0.35;
  scene.fog = new THREE.Fog(BG, fog[0], fog[1]);
  scene.add(new THREE.HemisphereLight(0xcfd9e8, 0x0a0c0f, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(shadow * 0.7, shadow * 1.6, shadow * 1.0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const c = key.shadow.camera;
  c.left = -shadow; c.right = shadow; c.top = shadow; c.bottom = -shadow;
  c.near = 0.01; c.far = shadow * 6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = shadow * 0.006;
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xb7c9e2, 1.2);
  rim.position.set(-shadow, shadow * 0.8, -shadow * 1.4);
  scene.add(rim);
  return scene;
}

// Anti-aliased floor grid (screen-space derivatives), drawn over a shadow-catching floor.
function gridPlane(w, d, { step, major, color, fade }) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uStep: { value: new THREE.Vector2(step, major) },
      uFade: { value: new THREE.Vector2(fade[0], fade[1]) },
    },
    vertexShader: `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec2 uStep;
      uniform vec2 uFade;
      varying vec3 vW;
      float line(vec2 p, float s) {
        vec2 c = p / s;
        vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main() {
        float a = max(line(vW.xz, uStep.x) * 0.45, line(vW.xz, uStep.y) * 0.9);
        a *= 1.0 - smoothstep(uFade.x, uFade.y, length(vW - cameraPosition));
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat);
  mesh.renderOrder = 1;
  return mesh;
}

/* ---------------------------------------------------------
   Unitree Go2: trot gait + planar goal following
   --------------------------------------------------------- */

const L1 = 0.213;           // thigh
const L2 = 0.213;           // calf
const HIP_OFF = 0.0955;     // hip joint → thigh joint, sideways
const FOOT_R = 0.022;       // foot sphere below the foot frame
const STAND_H = 0.29;       // thigh joint → foot frame, standing
const SWING_H = 0.065;
const GAIT_HZ = 2.0;
const V_MAX = 0.85;
const W_MAX = 1.9;
const PAD_R = 1.55;

const LEGS = [
  { name: 'FL', hip: [0.1934, 0.0465], side: 1, phase: 0, xoff: -0.01 },
  { name: 'FR', hip: [0.1934, -0.0465], side: -1, phase: Math.PI, xoff: -0.01 },
  { name: 'RL', hip: [-0.1934, 0.0465], side: 1, phase: Math.PI, xoff: -0.04 },
  { name: 'RR', hip: [-0.1934, -0.0465], side: -1, phase: 0, xoff: -0.04 },
];

// Foot target relative to the hip joint (ROS base frame): dx forward, dy sideways
// beyond the nominal hip offset, h below. Returns [hip, thigh, calf].
function legIK(dx, dy, h, side) {
  const yt = side * HIP_OFF + dy;
  const hp = Math.sqrt(Math.max(1e-6, yt * yt + h * h - HIP_OFF * HIP_OFF));
  const qh = Math.atan2(yt, h) - Math.atan2(side * HIP_OFF, hp);
  const d = Math.min(Math.hypot(dx, hp), L1 + L2 - 1e-4);
  const qc = -Math.acos(clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1));
  const qt = Math.atan2(-dx, hp) - Math.atan2(L2 * Math.sin(qc), L1 + L2 * Math.cos(qc));
  return [qh, qt, qc];
}

async function buildGo2(ctx) {
  const scene = makeStage({ fog: [4.5, 11], shadow: 3.2 });

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: '#0D1013', roughness: 0.95, metalness: 0, envMapIntensity: 0.15 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = gridPlane(24, 24, { step: 0.25, major: 1, color: '#2B333D', fade: [2.5, 8.5] });
  grid.position.y = 0.001;
  scene.add(grid);

  // waypoints on a hexagon, in reading order
  const hex = [[-0.5, -0.866], [0.5, -0.866], [1, 0], [0.5, 0.866], [-0.5, 0.866], [-1, 0]];
  const padGeo = new THREE.CircleGeometry(0.34, 48).rotateX(-Math.PI / 2);
  const ringGeo = new THREE.RingGeometry(0.335, 0.35, 64).rotateX(-Math.PI / 2);
  const targets = SECTIONS.map((key, i) => {
    const x = hex[i][0] * PAD_R;
    const z = hex[i][1] * PAD_R;
    const disc = new THREE.Mesh(padGeo, new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.05, depthWrite: false }));
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.4, depthWrite: false }));
    disc.position.set(x, 0.003, z);
    ring.position.set(x, 0.004, z);
    disc.userData.key = key;
    scene.add(disc, ring);
    return {
      key, x, z, pick: disc,
      anchor: new THREE.Vector3(x, 0, z - 0.38),
      paint(state) {
        disc.material.opacity = { idle: 0.05, hover: 0.12, active: 0.16 }[state];
        ring.material.opacity = { idle: 0.4, hover: 0.85, active: 1 }[state];
      },
    };
  });

  // planned path + goal marker
  const pathGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const path = new THREE.Line(pathGeo, new THREE.LineDashedMaterial({ color: ACCENT, dashSize: 0.07, gapSize: 0.06, transparent: true, opacity: 0.75 }));
  path.visible = false;
  path.frustumCulled = false;
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.09, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9, depthWrite: false }));
  marker.visible = false;
  scene.add(path, marker);

  const urdfUrl = `${ctx.base}assets/robots/go2/go2.urdf`;
  const urdf = await loadURDF(urdfUrl, {
    onMesh: ctx.onMesh,
    materialFor: ({ color }) => {
      if (!color) return MAT.shell;
      const lo = Math.min(color.r, color.g, color.b);
      const hi = Math.max(color.r, color.g, color.b);
      if (hi < 0.12) return MAT.dark;
      if (lo > 0.82) return MAT.panel;
      return MAT.shell;
    },
  });
  const carrier = new THREE.Group();
  urdf.root.rotation.x = -Math.PI / 2;           // ROS z-up → three y-up
  carrier.add(urdf.root);
  scene.add(carrier);

  const J = urdf.joints;
  const jointOrder = LEGS.flatMap(l => ['hip', 'thigh', 'calf'].map(p => J[`${l.name}_${p}_joint`]));

  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 60);
  camera.position.set(0.3, 2.75, 4.3);
  const target = new THREE.Vector3(0, 0.08, 0.12);

  // state (three's x-z plane; yaw rotates +x toward -z)
  const st = { x: 0, z: 0, yaw: -0.55, v: 0, w: 0, amp: 0, phase: 0, goal: null, arriveTimer: 0, t: 0 };
  let goalKey = null;
  let onArrive = null;

  function pose(dt) {
    st.t += dt;
    const moving = Math.min(1, Math.abs(st.v) / 0.18 + Math.abs(st.w) / 0.5);
    st.amp += (moving - st.amp) * (1 - Math.exp(-dt * 7));
    if (st.amp > 0.02) st.phase = (st.phase + dt * 2 * Math.PI * GAIT_HZ) % (2 * Math.PI);
    const ts = 0.5 / GAIT_HZ;
    for (const leg of LEGS) {
      const fy = leg.hip[1] + leg.side * HIP_OFF;
      // foot velocity in the base frame (ROS: x forward, y left); three's yaw rate w is ROS yaw rate
      const sx = (st.v - st.w * fy) * ts;
      const sy = (st.w * leg.hip[0]) * ts;
      const ph = (st.phase + leg.phase) % (2 * Math.PI);
      let ox; let oy; let lift = 0;
      if (ph < Math.PI) {
        const u = smooth(ph / Math.PI);
        ox = -sx / 2 + sx * u;
        oy = -sy / 2 + sy * u;
        lift = SWING_H * Math.sin(ph) * st.amp;
      } else {
        const u = (ph - Math.PI) / Math.PI;
        ox = sx / 2 - sx * u;
        oy = sy / 2 - sy * u;
      }
      const [qh, qt, qc] = legIK(leg.xoff + ox, oy, STAND_H - lift, leg.side);
      J[`${leg.name}_hip_joint`].set(qh);
      J[`${leg.name}_thigh_joint`].set(qt);
      J[`${leg.name}_calf_joint`].set(qc);
    }
    const breathe = ctx.reduceMotion ? 0 : 0.003 * Math.sin(st.t * 1.7) * (1 - st.amp);
    const bob = -0.006 * st.amp * Math.abs(Math.sin(2 * st.phase));
    urdf.root.position.y = STAND_H + FOOT_R + breathe + bob;
    carrier.position.set(st.x, 0, st.z);
    carrier.rotation.y = st.yaw;
  }

  function update(dt) {
    let vCmd = 0;
    let wCmd = 0;
    if (st.goal) {
      const dx = st.goal.x - st.x;
      const dz = st.goal.z - st.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.045) {
        const cb = onArrive;
        st.goal = null;
        onArrive = null;
        path.visible = false;
        marker.visible = false;
        cb && cb();
      } else {
        const err = wrapAngle(Math.atan2(-dz, dx) - st.yaw);
        wCmd = clamp(err * 2.8, -W_MAX, W_MAX);
        vCmd = V_MAX * Math.pow(Math.max(0, Math.cos(err)), 3) * clamp(dist / 0.5, 0.18, 1);
        pathGeo.attributes.position.setXYZ(0, st.x, 0.012, st.z);
        pathGeo.attributes.position.setXYZ(1, st.goal.x, 0.012, st.goal.z);
        pathGeo.attributes.position.needsUpdate = true;
        path.computeLineDistances();
      }
    }
    st.v += (vCmd - st.v) * (1 - Math.exp(-dt * 5));
    st.w += (wCmd - st.w) * (1 - Math.exp(-dt * 7));
    st.yaw = wrapAngle(st.yaw + st.w * dt);
    st.x += st.v * Math.cos(st.yaw) * dt;
    st.z -= st.v * Math.sin(st.yaw) * dt;
    marker.rotation.y += dt * 0.8;
    pose(dt);
  }

  function goTo(point, key, done) {
    goalKey = key;
    st.goal = { x: point.x, z: point.z };
    onArrive = done;
    path.visible = true;
    marker.visible = !key;
    marker.position.set(point.x, 0.006, point.z);
    if (ctx.reduceMotion) {
      st.x = point.x; st.z = point.z;
      st.yaw = Math.atan2(-(point.z), point.x) || st.yaw;
    }
  }

  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  pose(0);
  return {
    name: 'go2',
    scene, camera, target,
    orbit: { minDistance: 3, maxDistance: 7, minPolar: 0.35, maxPolar: 1.25 },
    baseDistance: camera.position.distanceTo(target),
    targets,
    update,
    joints: jointOrder,
    help: 'drag to orbit · click the floor to set a nav goal',
    hud() {
      const g = st.goal;
      const dist = g ? Math.hypot(g.x - st.x, g.z - st.z) : 0;
      return [
        ['robot', 'unitree_go2 · 12 dof'],
        ['gait', st.amp > 0.05 ? `trot · ${GAIT_HZ.toFixed(1)} Hz` : 'standing'],
        ['goal', g ? `${goalKey || `(${g.x.toFixed(2)}, ${(-g.z).toFixed(2)})`} · ${dist.toFixed(2)} m` : '—'],
        ['cmd_vel', `${st.v.toFixed(2)} m/s · ${st.w.toFixed(2)} rad/s`],
      ];
    },
    busy: () => !!st.goal,
    go(key, done) {
      const t = targets.find(p => p.key === key);
      const dist = Math.hypot(t.x - st.x, t.z - st.z);
      goTo(t, key, done);
      return { dist };
    },
    floorClick(ray, done) {
      if (!ray.intersectPlane(floorPlane, hit)) return null;
      if (Math.hypot(hit.x, hit.z) > PAD_R + 0.9) return null;
      goTo(hit.clone(), null, done);
      return { x: hit.x, y: -hit.z };
    },
  };
}

/* ---------------------------------------------------------
   SO-101 × 2: pick a block, drop it in the tray
   --------------------------------------------------------- */

const ARM_JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
const IK_JOINTS = 4;
const APPROACH_TILT = 0.45;   // rad from vertical: the SO-101 wrist can't point straight down at height
const BLOCK = 0.032;
const GRIP_OPEN = 1.0;
const GRIP_SHUT = 0.12;

function makeIK(arm) {
  const tcp = arm.links.gripper_frame_link.obj;
  const names = ARM_JOINTS.slice(0, IK_JOINTS);
  const js = names.map(n => arm.joints[n]);
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

  // Solve A x = b for a small dense system (Gaussian elimination, partial pivoting).
  function solve(A, b) {
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

  // Damped least squares on [pan, lift, elbow, wrist_flex]: reach `target`
  // with the gripper's approach axis (its z) along `dir`.
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
      const dq = solve(A, b);
      const norm = Math.hypot(...dq);
      const k = norm > 0.3 ? 0.3 / norm : 1;
      for (let i = 0; i < IK_JOINTS; i += 1) q[i] = clamp(q[i] + dq[i] * k, js[i].lower, js[i].upper);
    }
    js.forEach((j, i) => j.set(saved[i]));
    arm.root.updateMatrixWorld(true);
    return q;
  };
}

async function buildArms(ctx) {
  const scene = makeStage({ fog: [1.6, 4.2], shadow: 0.75 });

  // table
  const TW = 1.25;
  const TD = 0.74;
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(TW, 0.04, TD),
    new THREE.MeshStandardMaterial({ color: '#121519', roughness: 0.92, metalness: 0, envMapIntensity: 0.2 }),
  );
  table.position.y = -0.02;
  table.receiveShadow = true;
  scene.add(table);
  const tg = gridPlane(TW, TD, { step: 0.05, major: 0.25, color: '#2B333D', fade: [1.2, 3] });
  tg.position.y = 0.0006;
  scene.add(tg);
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(TW, 0.04, TD)),
    new THREE.LineBasicMaterial({ color: 0x2a323b, transparent: true, opacity: 0.8 }),
  );
  edge.position.y = -0.02;
  scene.add(edge);

  // tray
  const TRAY = new THREE.Vector3(0, 0, -0.03);
  const trayMat = new THREE.MeshStandardMaterial({ color: '#1C2126', roughness: 0.7, metalness: 0.1 });
  const tray = new THREE.Group();
  const tb = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.004, 0.11), trayMat);
  tb.position.y = 0.002;
  tray.add(tb);
  [[0, 0.053, 0.11, 0.004], [0, -0.053, 0.11, 0.004], [0.053, 0, 0.004, 0.11], [-0.053, 0, 0.004, 0.11]].forEach(([x, z, w, d]) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.018, d), trayMat);
    wall.position.set(x, 0.009, z);
    tray.add(wall);
  });
  tray.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
  const trayRim = new THREE.Mesh(new THREE.RingGeometry(0.074, 0.078, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.35, depthWrite: false }));
  trayRim.position.y = 0.001;
  tray.add(trayRim);
  tray.position.copy(TRAY);
  scene.add(tray);

  // arms
  // ALOHA-style: the two arms face each other across the tray
  const armDefs = [
    { side: 'L', base: new THREE.Vector3(-0.3, 0, -0.03), yaw: 0 },
    { side: 'R', base: new THREE.Vector3(0.3, 0, -0.03), yaw: Math.PI },
  ];
  const urdfUrl = `${ctx.base}assets/robots/so101/so101.urdf`;
  const materialFor = ({ material }) => (material === 'sts3215' ? MAT.servo : MAT.printed);
  const arms = [];
  for (const def of armDefs) {
    const urdf = await loadURDF(urdfUrl, { materialFor, onMesh: ctx.onMesh });
    const carrier = new THREE.Group();
    urdf.root.rotation.x = -Math.PI / 2;
    carrier.add(urdf.root);
    carrier.position.copy(def.base);
    carrier.rotation.y = def.yaw;                // arm's +x is its forward
    scene.add(carrier);
    carrier.updateMatrixWorld(true);
    const arm = { ...def, ...urdf, root: carrier, holding: null, task: 'idle' };
    arm.ik = makeIK(arm);
    arms.push(arm);
  }

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

  arms.forEach(arm => {
    arm.ready = solveAt(arm, ahead(arm, 0.17, 0, 0.13));
    arm.q = [...arm.ready, 0, GRIP_SHUT];
    arm.apply = () => ARM_JOINTS.forEach((n, i) => arm.joints[n].set(arm.q[i]));
    arm.apply();
  });

  // blocks, three per arm, fanned out in front of each arm (angle from its forward axis, toward the camera)
  const fan = [[-0.95, 0.2], [0.05, 0.19], [1.0, 0.2]];
  const blockGeo = new THREE.BoxGeometry(BLOCK, BLOCK, BLOCK);
  const targets = SECTIONS.map((key, i) => {
    const arm = arms[i < 3 ? 0 : 1];
    const [ang, r] = i < 3 ? fan[i] : fan[5 - i];
    const toCamera = arm.side === 'L' ? 1 : -1;       // local +z is the camera side for the left arm
    const home = ahead(arm, Math.cos(ang) * r, toCamera * Math.sin(ang) * r, 0).setY(BLOCK / 2);
    const mat = new THREE.MeshStandardMaterial({ color: '#C3CDD9', roughness: 0.55, metalness: 0.05, emissive: ACCENT, emissiveIntensity: 0 });
    const mesh = new THREE.Mesh(blockGeo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(home);
    mesh.userData.key = key;
    // square the block to the arm, so its faces meet the jaws head-on
    mesh.rotation.y = Math.atan2(home.x - arm.base.x, home.z - arm.base.z);
    scene.add(mesh);
    return {
      key, arm, home, mesh, pick: mesh,
      anchor: new THREE.Vector3(),
      x: home.x, z: home.z,
      paint(state) { mat.emissiveIntensity = { idle: 0, hover: 0.18, active: 0.32 }[state]; },
    };
  });

  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 20);
  camera.position.set(0.05, 0.5, 0.9);
  const target = new THREE.Vector3(0, 0.07, -0.03);

  // a tiny timeline per arm: segments that interpolate joints, then run a callback
  let queue = [];
  let seg = null;
  let active = null;
  let t = 0;

  function plan(arm, block, done) {
    const grasp = block.home.clone().setY(0.012);
    const pre = grasp.clone().setY(0.085);
    const lift = grasp.clone().setY(0.11);
    const over = TRAY.clone().setY(0.1);
    const place = TRAY.clone().setY(0.042);
    const qPre = solveAt(arm, pre);
    const qGrasp = solveAt(arm, grasp, qPre);
    const qLift = solveAt(arm, lift, qGrasp);
    const qOver = solveAt(arm, over, qLift);
    const qPlace = solveAt(arm, place, qOver);
    const with_ = (q, g) => [...q, 0, g];
    return [
      { to: with_(qPre, GRIP_OPEN), dur: 0.7, label: 'reach' },
      { to: with_(qGrasp, GRIP_OPEN), dur: 0.4, label: 'descend' },
      { to: with_(qGrasp, GRIP_SHUT), dur: 0.22, label: 'grasp', end: () => { arm.links.gripper_link.obj.attach(block.mesh); arm.holding = block; } },
      { to: with_(qLift, GRIP_SHUT), dur: 0.35, label: 'lift' },
      { to: with_(qOver, GRIP_SHUT), dur: 0.6, label: 'carry' },
      { to: with_(qPlace, GRIP_SHUT), dur: 0.32, label: 'place' },
      {
        to: with_(qPlace, GRIP_OPEN), dur: 0.18, label: 'release',
        end: () => {
          scene.attach(block.mesh);
          const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(block.mesh.quaternion);
          block.mesh.rotation.set(0, Math.atan2(fwd.x, fwd.z), 0);
          block.mesh.position.y = BLOCK / 2 + 0.004;
          arm.holding = null;
          block.inTray = true;
          done && done();
        },
      },
      { to: with_(arm.ready, GRIP_SHUT), dur: 0.7, label: 'return' },
    ];
  }

  function resetBlocks(except) {
    targets.forEach(b => {
      if (b === except || !b.inTray) return;
      b.inTray = false;
      b.returning = 0;
      b.from = b.mesh.position.clone();
    });
  }

  function update(dt) {
    if (!seg && queue.length) {
      seg = queue.shift();
      seg.from = active.q.slice();
      t = 0;
    }
    if (seg) {
      t += dt / seg.dur;
      const k = ease(t);
      active.q = seg.from.map((a, i) => a + (seg.to[i] - a) * k);
      active.task = seg.label;
      if (t >= 1) {
        active.q = seg.to.slice();
        const end = seg.end;
        seg = null;
        end && end();
        if (!queue.length) { active.task = 'idle'; active = null; }
      }
    }
    arms.forEach(a => a.apply());
    targets.forEach(b => {
      if (b.returning === undefined) return;
      b.returning = Math.min(1, b.returning + dt / 0.5);
      const k = ease(b.returning);
      b.mesh.position.lerpVectors(b.from, b.home, k);
      b.mesh.position.y = BLOCK / 2 + Math.sin(Math.PI * k) * 0.05;
      if (b.returning >= 1) { b.mesh.position.copy(b.home); delete b.returning; }
    });
    targets.forEach(b => { b.mesh.getWorldPosition(b.anchor); b.anchor.y -= BLOCK / 2; b.anchor.z += BLOCK * 0.7; });
  }

  return {
    name: 'arms',
    labelsBelow: true,
    scene, camera, target,
    orbit: { minDistance: 0.8, maxDistance: 1.8, minPolar: 0.3, maxPolar: 1.3 },
    baseDistance: camera.position.distanceTo(target),
    targets,
    update,
    joints: arms.flatMap(a => ARM_JOINTS.map(n => a.joints[n])),
    help: 'drag to orbit · click a block to pick it',
    hud() {
      const a = active;
      return [
        ['robot', 'so101 × 2 · 12 dof'],
        ['solver', 'dls ik · 4 joints'],
        ['task', a ? `${a.side === 'L' ? 'left' : 'right'} arm · ${a.task}` : 'idle'],
        ['gripper', arms.map(x => `${x.side} ${x.joints.gripper.value > 0.5 ? 'open' : 'shut'}`).join(' · ')],
      ];
    },
    busy: () => !!active,
    go(key, done) {
      const block = targets.find(b => b.key === key);
      if (block.inTray) { done && done(); return { arm: block.arm.side === 'L' ? 'left' : 'right' }; }
      resetBlocks(block);
      if (ctx.reduceMotion) {
        // no animation: the block just appears in the tray
        block.mesh.position.set(TRAY.x, BLOCK / 2 + 0.004, TRAY.z);
        block.inTray = true;
        done && done();
      } else {
        active = block.arm;
        queue = plan(block.arm, block, done);
      }
      return { arm: block.arm.side === 'L' ? 'left' : 'right' };
    },
    floorClick: () => null,
  };
}

/* ---------------------------------------------------------
   Mount: renderer, labels, input, HUD, loop
   --------------------------------------------------------- */

export async function mountSim(root, opts) {
  const view = root.querySelector('#simView');
  const labelsEl = root.querySelector('#simLabels');
  const hudEl = root.querySelector('#simHud');
  const helpEl = root.querySelector('#simHelp');
  const statusEl = root.querySelector('#simStatus');
  const loadingEl = root.querySelector('#simLoading');
  const loadingText = root.querySelector('#simLoadingText');
  const bars = Array.from(root.querySelectorAll('#simJoints i'));
  const goals = Array.from(root.querySelectorAll('.sim-goal'));
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const base = opts.base || '';

  const setStatus = (text, state) => {
    if (statusEl) statusEl.textContent = text;
    root.dataset.state = state;
  };
  const setLoad = (text, frac) => {
    if (loadingText && text) loadingText.textContent = text;
    if (frac != null) loadingEl?.style.setProperty('--load', String(frac));
  };

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const pmrem = new THREE.PMREMGenerator(renderer);
  envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  view.prepend(canvas);

  // one set of orbit controls, re-pointed at whichever world is showing
  const camHolder = new THREE.PerspectiveCamera();
  const controls = new OrbitControls(camHolder, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = false;              // keep the mouse wheel for page scrolling
  controls.rotateSpeed = 0.6;
  controls.enabled = fine;
  if (!fine) canvas.style.touchAction = 'pan-y';

  const worlds = {};
  let world = null;
  let pendingKey = null;
  let navTimer = 0;
  let safetyTimer = 0;
  let hoverKey = null;
  let activeKey = null;

  // labels over the waypoints / blocks
  const labelEls = {};
  SECTIONS.forEach((key, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sim-label';
    b.tabIndex = -1;
    b.innerHTML = `<b>0${i + 1}</b>`;
    b.append(key);
    b.addEventListener('click', () => api.goTo(key, { source: 'label' }));
    b.addEventListener('mouseenter', () => setHover(key));
    b.addEventListener('mouseleave', () => setHover(null));
    labelsEl.append(b);
    labelEls[key] = b;
  });

  function paintTargets() {
    if (!world) return;
    world.targets.forEach(t => t.paint(t.key === activeKey ? 'active' : t.key === hoverKey ? 'hover' : 'idle'));
    SECTIONS.forEach(k => {
      labelEls[k].classList.toggle('active', k === activeKey);
      labelEls[k].classList.toggle('hot', k === hoverKey);
    });
    goals.forEach(g => {
      g.classList.toggle('active', g.dataset.goal === activeKey);
      g.classList.toggle('hot', g.dataset.goal === hoverKey);
    });
  }
  function setHover(key) {
    hoverKey = key;
    paintTargets();
  }

  function resize() {
    const w = view.clientWidth;
    const h = view.clientHeight;
    if (!w || !h || !world) return;
    renderer.setSize(w, h, false);
    world.camera.aspect = w / h;
    // pull back on narrow screens so every waypoint stays in frame
    const k = Math.max(1, 1.55 / world.camera.aspect);
    const dist = world.baseDistance * k;
    controls.minDistance = world.orbit.minDistance * k;
    controls.maxDistance = Math.max(world.orbit.maxDistance * k, dist);
    world.camera.position.sub(world.target).setLength(dist).add(world.target);
    world.camera.updateProjectionMatrix();
  }

  function useWorld(w) {
    world = w;
    controls.object = w.camera;
    controls.target.copy(w.target);
    controls.minPolarAngle = w.orbit.minPolar;
    controls.maxPolarAngle = w.orbit.maxPolar;
    controls.update();
    if (helpEl) helpEl.textContent = fine ? w.help : 'tap a waypoint';
    resize();
    paintTargets();
  }

  const vec = new THREE.Vector3();
  function placeLabels() {
    const w = view.clientWidth;
    const h = view.clientHeight;
    world.targets.forEach(t => {
      vec.copy(t.anchor).project(world.camera);
      const el = labelEls[t.key];
      if (vec.z > 1) { el.style.visibility = 'hidden'; return; }
      el.style.visibility = '';
      const lift = world.labelsBelow ? '6px' : '-100%';
      el.style.transform = `translate(${((vec.x + 1) / 2 * w).toFixed(1)}px, ${((1 - vec.y) / 2 * h).toFixed(1)}px) translate(-50%, ${lift})`;
    });
  }

  let hudClock = 0;
  function paintHud(dt) {
    hudClock += dt;
    if (hudClock < 0.12) return;
    hudClock = 0;
    if (hudEl) {
      hudEl.textContent = '';
      world.hud().forEach(([k, v]) => {
        const dt_ = document.createElement('dt');
        dt_.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        hudEl.append(dt_, dd);
      });
    }
    world.joints.forEach((j, i) => {
      const bar = bars[i];
      if (!bar) return;
      const span = j.upper - j.lower;
      bar.style.setProperty('--q', Number.isFinite(span) && span > 0 ? ((j.value - j.lower) / span).toFixed(3) : '0.5');
    });
    if (!world.busy() && root.dataset.state === 'moving') setStatus('ready', 'ready');
  }

  // input: click (not drag) to pick a target or set a floor goal
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  function rayAt(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, world.camera);
    return raycaster;
  }
  function pickKey(e) {
    const hits = rayAt(e).intersectObjects(world.targets.map(t => t.pick), false);
    return hits.length ? hits[0].object.userData.key : null;
  }
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; if (fine) view.classList.add('grabbing'); });
  window.addEventListener('pointerup', () => view.classList.remove('grabbing'));
  canvas.addEventListener('pointerup', e => {
    if (!down || !world) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 6) return;
    const key = pickKey(e);
    if (key) { api.goTo(key, { source: 'click' }); return; }
    const goal = world.floorClick(rayAt(e).ray, () => {
      opts.setLog([['ok', '✓ goal reached']]);
      setStatus('ready', 'ready');
    });
    if (goal) {
      clearTimeout(navTimer);
      pendingKey = null;
      activeKey = null;
      paintTargets();
      opts.setLog([['go', `nav2 goal → (${goal.x.toFixed(2)}, ${goal.y.toFixed(2)})`], ['', ' · no page here, just walking']]);
      setStatus('walking', 'moving');
    }
  });
  if (fine) {
    canvas.addEventListener('pointermove', e => {
      if (!world || e.buttons) return;
      const key = pickKey(e);
      if (key !== hoverKey) setHover(key);
      canvas.style.cursor = key ? 'pointer' : 'grab';
    });
    canvas.addEventListener('pointerleave', () => setHover(null));
  }

  // render only while visible
  let visible = false;
  let last = performance.now();
  let orbiting = false;
  controls.addEventListener('start', () => { orbiting = true; });
  controls.addEventListener('end', () => { setTimeout(() => { orbiting = false; }, 600); });
  function tick(now) {
    // nothing moving: ~30 fps is plenty for the idle sway
    if (!world.busy() && !orbiting && now - last < 30) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    world.update(dt);
    controls.update();
    renderer.render(world.scene, world.camera);
    placeLabels();
    paintHud(dt);
  }
  function setRunning() {
    const run = visible && !document.hidden && world;
    renderer.setAnimationLoop(run ? tick : null);
    last = performance.now();
  }
  new IntersectionObserver(entries => {
    visible = entries.some(e => e.isIntersecting);
    setRunning();
  }).observe(view);
  document.addEventListener('visibilitychange', setRunning);
  new ResizeObserver(resize).observe(view);

  // loading
  let meshTotal = 0;
  let meshDone = 0;
  async function load(name) {
    if (worlds[name]) return worlds[name];
    const file = name === 'go2' ? 'go2/go2.urdf' : 'so101/so101.urdf';
    const text = await fetch(`${base}assets/robots/${file}`).then(r => r.text());
    meshTotal = countMeshes(text) * (name === 'arms' ? 2 : 1);
    meshDone = 0;
    const onMesh = () => {
      meshDone += 1;
      setLoad(null, meshDone / meshTotal);
    };
    const ctx = { base, reduceMotion: opts.reduceMotion, onMesh };
    worlds[name] = (name === 'go2' ? buildGo2 : buildArms)(ctx);
    return worlds[name];
  }

  async function show(name) {
    const loaded = worlds[name] && await worlds[name];
    if (!loaded) {
      loadingEl?.classList.remove('done');
      setLoad(name === 'go2' ? 'loading go2.urdf …' : 'loading so101.urdf × 2 …', 0);
      setStatus('loading', 'loading');
    }
    const w = await load(name);
    if (currentName !== name) return;           // user switched tabs while this loaded
    clearTimeout(navTimer);
    pendingKey = null;
    activeKey = null;
    useWorld(w);
    loadingEl?.classList.add('done');
    setStatus('ready', 'ready');
    setRunning();
  }

  let currentName = opts.robot || 'go2';

  const api = {
    async setRobot(name) {
      if (name === currentName && world && world.name === name) return;
      currentName = name;
      opts.setLog([['', name === 'go2' ? 'go2: click a waypoint, or type an instruction.' : 'so101 × 2: pick a block and the arm drops it in the tray.']]);
      await show(name);
    },
    hover(key) { setHover(key); },
    goTo(key, info = {}) {
      if (!world) { opts.navigate(key); return; }
      if (world.name === 'arms' && world.busy()) {
        opts.setLog([['', 'arm is busy, one sec …']]);
        return;
      }
      clearTimeout(navTimer);
      clearTimeout(safetyTimer);
      activeKey = key;
      pendingKey = key;
      paintTargets();
      // the sim only runs while it's on screen, so bring it into view (e.g. a waypoint tapped below it on a phone)
      const r = view.getBoundingClientRect();
      if (r.bottom < 90 || r.top > window.innerHeight - 90) {
        view.scrollIntoView({ behavior: opts.reduceMotion ? 'auto' : 'smooth', block: 'center' });
      }
      // and never leave someone waiting if the animation stalls
      safetyTimer = setTimeout(() => { if (pendingKey === key) { pendingKey = null; opts.navigate(key); } }, 12000);
      const quote = info.text ? [['q', `“${info.text}”`], ['', ' → ']] : [];
      const arrive = () => {
        clearTimeout(safetyTimer);
        if (pendingKey !== key) return;
        opts.setLog([['ok', world.name === 'go2' ? `✓ reached ${key}` : `✓ placed “${key}” in the tray`], ['', ' → opening '], ['go', `~/${key}`]]);
        setStatus('arrived', 'ready');
        navTimer = setTimeout(() => {
          if (pendingKey !== key) return;
          pendingKey = null;
          activeKey = null;
          paintTargets();
          opts.navigate(key);
        }, opts.reduceMotion ? 150 : 550);
      };
      const res = world.go(key, arrive);
      if (world.name === 'go2') {
        opts.setLog([...quote, ['go', `nav goal: ${key}`], ['', ` · ${res.dist.toFixed(1)} m · trotting`]]);
        setStatus('walking', 'moving');
      } else {
        opts.setLog([...quote, ['go', `pick “${key}”`], ['', ` · ${res.arm} arm → tray`]]);
        setStatus('picking', 'moving');
      }
    },
  };

  await show(currentName);
  // warm the other robot in the background so switching tabs is instant
  const other = currentName === 'go2' ? 'arms' : 'go2';
  (window.requestIdleCallback || (fn => setTimeout(fn, 1500)))(() => { load(other).catch(() => {}); });

  return api;
}
