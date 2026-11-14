/* =========================================================
   Max Yuan · URDF loading and inverse kinematics for the playground
   - loadURDF: revolute, continuous, prismatic and fixed joints,
     <mimic> joints, mesh visuals (GLB), inline or named colours
   - makeArm: damped least squares IK on any chain, with a tool point
     found from the finger meshes, plus a gripper and a joint timeline
   ========================================================= */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const clamp = THREE.MathUtils.clamp;
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
        if (geo.getAttribute('normal')) geo.deleteAttribute('normal');
        geo = toCreasedNormals(geo, THREE.MathUtils.degToRad(34));
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

/**
 * @param {string} url  URDF location; mesh paths resolve against it
 * @param {(link:string, material:string|null, rgba:number[]|null) => THREE.Material} materialFor
 */
export async function loadURDF(url, materialFor) {
  const text = await fetch(url).then(r => {
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.text();
  });
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  const robot = xml.querySelector('robot');
  if (!robot) throw new Error(`${url}: no <robot>`);

  const named = {};
  kids(robot, 'material').forEach(m => {
    const c = kids(m, 'color')[0];
    if (c) named[m.getAttribute('name')] = nums(c.getAttribute('rgba'), null);
  });

  const links = {};
  kids(robot, 'link').forEach(l => {
    const obj = new THREE.Group();
    obj.name = l.getAttribute('name');
    links[obj.name] = { el: l, obj, meshes: [] };
  });

  const joints = {};
  const children = new Set();
  const tq = new THREE.Quaternion();
  kids(robot, 'joint').forEach(j => {
    const name = j.getAttribute('name');
    const type = j.getAttribute('type');
    const parent = links[kids(j, 'parent')[0].getAttribute('link')];
    const child = links[kids(j, 'child')[0].getAttribute('link')];
    if (!parent || !child) return;
    const { xyz, rpy } = originOf(j);
    const axisEl = kids(j, 'axis')[0];
    const axis = new THREE.Vector3(...nums(axisEl && axisEl.getAttribute('xyz'), [1, 0, 0]));
    if (axis.lengthSq() < 1e-9) axis.set(1, 0, 0);
    axis.normalize();
    const lim = kids(j, 'limit')[0];
    const lower = type === 'continuous' || !lim ? -Infinity : Number(lim.getAttribute('lower') || 0);
    const upper = type === 'continuous' || !lim ? Infinity : Number(lim.getAttribute('upper') || 0);
    const obj = new THREE.Group();
    obj.name = `joint:${name}`;
    const p0 = new THREE.Vector3(...xyz);
    const q0 = quatRPY(rpy);
    obj.position.copy(p0);
    obj.quaternion.copy(q0);
    parent.obj.add(obj);
    obj.add(child.obj);
    children.add(child.obj.name);
    const slide = axis.clone().applyQuaternion(q0);   // a prismatic joint moves along its axis, in the parent frame
    const mimicEl = kids(j, 'mimic')[0];
    joints[name] = {
      name, type, lower, upper, axis, obj, value: 0, mimics: [],
      mimic: mimicEl ? {
        joint: mimicEl.getAttribute('joint'),
        k: Number(mimicEl.getAttribute('multiplier') ?? 1),
        c: Number(mimicEl.getAttribute('offset') ?? 0),
      } : null,
      set(v) {
        if (type === 'fixed') return;
        this.value = clamp(v, lower, upper);
        if (type === 'prismatic') {
          obj.position.copy(p0).addScaledVector(slide, this.value);
        } else {
          obj.quaternion.copy(q0).multiply(tq.setFromAxisAngle(axis, this.value));
        }
        this.mimics.forEach(m => m.set(this.value * m.mimic.k + m.mimic.c));
      },
    };
  });
  Object.values(joints).forEach(j => {
    if (j.mimic && joints[j.mimic.joint]) joints[j.mimic.joint].mimics.push(j);
  });

  const pending = [];
  Object.values(links).forEach(link => {
    kids(link.el, 'visual').forEach(v => {
      const mesh = v.querySelector('geometry > mesh');
      if (!mesh) return;
      const { xyz, rpy } = originOf(v);
      const holder = new THREE.Group();
      holder.position.set(...xyz);
      holder.quaternion.copy(quatRPY(rpy));
      holder.scale.set(...nums(mesh.getAttribute('scale'), [1, 1, 1]));
      link.obj.add(holder);
      const matEl = kids(v, 'material')[0];
      const matName = matEl ? matEl.getAttribute('name') : null;
      const colorEl = matEl && kids(matEl, 'color')[0];
      const rgba = colorEl ? nums(colorEl.getAttribute('rgba'), null) : (matName && named[matName]) || null;
      const material = materialFor(link.obj.name, matName, rgba);
      pending.push(loadMesh(new URL(mesh.getAttribute('filename'), url).href).then(parts => {
        parts.forEach(geo => {
          const m = new THREE.Mesh(geo, material);
          m.castShadow = true;
          m.receiveShadow = true;
          holder.add(m);
          link.meshes.push(m);
        });
      }));
    });
  });
  await Promise.all(pending);

  const rootName = Object.keys(links).find(n => !children.has(n));
  const root = links[rootName].obj;
  // ROS is z-up, three.js is y-up. `base` is what callers place and turn in the world.
  const base = new THREE.Group();
  root.rotation.x = -Math.PI / 2;
  base.add(root);
  return { base, root, links, joints };
}

/* ---------------------------------------------------------
   Arms: IK, gripper, timeline
   --------------------------------------------------------- */

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

const easeInOut = t => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));

/**
 * Wrap a loaded URDF chain as an arm.
 * opts.joints   joint names the IK may move, base to tip
 * opts.hand     link the fingers hang from
 * opts.fingers  finger link names; the tool point is the middle of their tips
 * opts.grip     (open 0..1) => void, drives the finger joints
 * opts.reach    extra distance past the finger middle, along the approach (m)
 */
export function makeArm(robot, opts) {
  const js = opts.joints.map(n => {
    if (!robot.joints[n]) throw new Error(`no joint ${n}`);
    return robot.joints[n];
  });
  const hand = robot.links[opts.hand].obj;

  opts.grip(1);
  robot.base.updateMatrixWorld(true);
  const tcp = new THREE.Object3D();
  if (opts.tcpLink) {
    // the URDF has a tool frame: use it, approach along its axis
    robot.links[opts.tcpLink].obj.add(tcp);
    tcp.position.set(...(opts.tcpOffset || [0, 0, 0]));
    tcp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...(opts.tcpAxis || [0, 0, 1])));
  } else {
    placeTool();
  }

  // Tool point: centre of the finger meshes' far ends, found with the gripper open.
  function placeTool() {
    const handInv = hand.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    opts.fingers.forEach(f => robot.links[f].meshes.forEach(m => {
      m.geometry.computeBoundingBox();
      tmp.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld).applyMatrix4(handInv);
      box.union(tmp);
    }));
    const handBox = new THREE.Box3();
    robot.links[opts.hand].meshes.forEach(m => {
      m.geometry.computeBoundingBox();
      tmp.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld).applyMatrix4(handInv);
      handBox.union(tmp);
    });
    const fingerMid = box.getCenter(new THREE.Vector3());
    const palm = handBox.getCenter(new THREE.Vector3());
    const approach = fingerMid.clone().sub(palm).normalize();      // in the hand frame
    // the tip: from the finger middle, out along the approach to the end of the box
    let far = 0;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      far = Math.max(far, new THREE.Vector3(x, y, z).sub(fingerMid).dot(approach));
    }
    const tcpLocal = fingerMid.clone().addScaledVector(approach, far * 0.55 + (opts.reach || 0));
    tcp.position.copy(tcpLocal);
    hand.add(tcp);
    // a frame whose +z is the approach direction, for attaching held objects
    tcp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), approach);
  }

  const n = js.length;
  const p = new THREE.Vector3();
  const z = new THREE.Vector3();
  const e0 = new Float64Array(6);
  const e1 = new Float64Array(6);
  const Jm = Array.from({ length: 6 }, () => new Float64Array(n));
  const aw = opts.dirWeight ?? 0.12;
  // spare starting points spread over the joint ranges (same every load)
  let rs = 12345;
  const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
  const randomSeeds = Array.from({ length: 10 }, () => js.map(j => {
    const lo = Number.isFinite(j.lower) ? j.lower : -Math.PI;
    const hi = Number.isFinite(j.upper) ? j.upper : Math.PI;
    return lo + (hi - lo) * (0.15 + 0.7 * rnd());
  }));

  function error(q, target, dir, out, w) {
    js.forEach((j, i) => j.set(q[i]));
    // getWorldPosition walks up from the tool to the scene root, so only the chain is recomputed
    tcp.getWorldPosition(p);
    z.setFromMatrixColumn(tcp.matrixWorld, 2).normalize();
    out[0] = target.x - p.x; out[1] = target.y - p.y; out[2] = target.z - p.z;
    if (dir) { out[3] = w * (dir.x - z.x); out[4] = w * (dir.y - z.y); out[5] = w * (dir.z - z.z); } else { out[3] = out[4] = out[5] = 0; }
  }

  const arm = {
    robot, joints: js, hand, tcp,
    q: js.map(j => j.value),
    gripValue: 1,
    tweens: [],
    /** Solve for a tool point (world) with the approach roughly along dir (world, or null).
        Tries the seed, then the arm's spare seeds, then random ones; a solution that is close
        is refined with position first (the approach direction is only a preference). */
    solve(target, dir, seed = arm.q) {
      let best = { err: Infinity };
      const tryFrom = s => {
        let q = arm.solveFrom(target, dir, s);
        if (q.err > 0.003 && dir) {
          const r = arm.solveFrom(target, dir, q, 80, aw * 0.12);
          if (r.err < q.err) q = r;
        }
        if (q.err < best.err - 1e-5) best = q;
        return best.err < 0.003;
      };
      if (!tryFrom(seed)) {
        for (const s of [...(opts.seeds || []), ...randomSeeds]) if (tryFrom(s)) break;
      }
      if (best.err > 0.01 && window.__ikDebug) console.warn(`IK miss ${opts.name || ''}: ${(best.err * 100).toFixed(1)} cm`, target.toArray().map(v => +v.toFixed(3)));
      return best;
    },
    solveFrom(target, dir, seed, iters = 120, w = aw) {
      const saved = js.map(j => j.value);
      const q = seed.slice();
      const lam2 = 0.03 * 0.03;
      let err = Infinity;
      for (let it = 0; it < iters; it += 1) {
        error(q, target, dir, e0, w);
        err = Math.hypot(e0[0], e0[1], e0[2]);
        let n0 = 0;
        for (let i = 0; i < 6; i += 1) n0 += e0[i] * e0[i];
        if (n0 < 1e-10) break;
        for (let k = 0; k < n; k += 1) {
          const qq = q.slice();
          qq[k] += 1e-4;
          error(qq, target, dir, e1, w);
          for (let i = 0; i < 6; i += 1) Jm[i][k] = (e0[i] - e1[i]) / 1e-4;
        }
        const A = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => {
          let s = r === c ? lam2 : 0;
          for (let i = 0; i < 6; i += 1) s += Jm[i][r] * Jm[i][c];
          return s;
        }));
        const b = Array.from({ length: n }, (_, r) => {
          let s = 0;
          for (let i = 0; i < 6; i += 1) s += Jm[i][r] * e0[i];
          return s;
        });
        const dq = solveSmall(A, b);
        const norm = Math.hypot(...dq);
        const k = norm > 0.25 ? 0.25 / norm : 1;
        for (let i = 0; i < n; i += 1) q[i] = clamp(q[i] + dq[i] * k, js[i].lower, js[i].upper);
      }
      js.forEach((j, i) => j.set(saved[i]));
      robot.base.updateMatrixWorld(true);
      q.err = err;
      return q;
    },
    set(q) {
      arm.q = q.slice();
      js.forEach((j, i) => j.set(q[i]));
    },
    grip(v) {
      arm.gripValue = v;
      opts.grip(v);
    },
    /** Ease the joints to q over dur seconds; resolves when done. */
    move(q, dur = 1, gripTo = null) {
      return new Promise(resolve => {
        arm.tweens.push({ from: arm.q.slice(), to: q.slice(), g0: arm.gripValue, g1: gripTo, t: 0, dur, resolve });
      });
    },
    gripTo(v, dur = 0.4) { return arm.move(arm.q, dur, v); },
    busy() { return arm.tweens.length > 0; },
    update(dt) {
      const tw = arm.tweens[0];
      if (!tw) return;
      tw.t += dt / Math.max(tw.dur, 1e-3);
      const k = easeInOut(tw.t);
      arm.set(tw.from.map((a, i) => a + (tw.to[i] - a) * k));
      if (tw.g1 !== null) arm.grip(tw.g0 + (tw.g1 - tw.g0) * k);
      if (tw.t >= 1) {
        arm.tweens.shift();
        tw.resolve();
      }
    },
  };
  opts.grip(arm.gripValue);
  return arm;
}
