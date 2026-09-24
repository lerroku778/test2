// Персонажи: стилизованные «виниловые» фигуры с лицевой анимацией и IK-руками.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as T from './textures.js';
import { mat, seatPos, seatYaw } from './world.js';
import { rigidSkin, referenced } from './merge.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0), DOWN = V(0, -1, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);

const L1 = 0.27, L2 = 0.26;
const HIPS_Y = 0.48;

function limb(a, b, r, m, parent) {
  const len = a.distanceTo(b);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 0.5), 6, 14);
  const me = new THREE.Mesh(g, m);
  me.position.copy(a).add(b).multiplyScalar(0.5);
  me.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  parent.add(me);
  return me;
}

function sph(r, m, x, y, z, parent, sx = 1, sy = 1, sz = 1, ws = 24, hs = 18) {
  const me = new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m);
  me.position.set(x, y, z);
  me.scale.set(sx, sy, sz);
  parent.add(me);
  return me;
}

function bx(w, h, d, m, x, y, z, parent, rad = 0) {
  const me = new THREE.Mesh(rad ? new RoundedBoxGeometry(w, h, d, 2, rad) : new THREE.BoxGeometry(w, h, d), m);
  me.position.set(x, y, z);
  parent.add(me);
  return me;
}

// Кудри: инстансы сфер вокруг головы, опционально длинные локоны до плеч.
function curls(parent, c, color, { n = 90, long = 0, longN = 0, seed = 1, size = 1, faceOpen = 0.36, top = 0.0, rough = 0.62 }) {
  const r = T.rng(seed);
  const m = mat({ color, roughness: rough, sheen: 0.6, sheenColor: new THREE.Color(color).multiplyScalar(1.6), sheenRoughness: 0.5 });
  const geo = new THREE.IcosahedronGeometry(0.05 * size, 2);
  const total = n + longN;
  const inst = new THREE.InstancedMesh(geo, m, total);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = V();
  let k = 0;
  let guard = 0;
  while (k < n && guard++ < 5000) {
    const u = r() * 2 - 1, a = r() * Math.PI * 2;
    const d = V(Math.sqrt(1 - u * u) * Math.cos(a), u, Math.sqrt(1 - u * u) * Math.sin(a));
    if (d.y < -0.35 + top) continue;
    if (d.z > faceOpen && d.y < 0.5) continue; // лицо открыто
    if (d.z > 0.1 && d.y < -0.1) continue;
    const p = c.clone().add(d.multiplyScalar(0.148 + r() * 0.03));
    q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
    const sc = 0.75 + r() * 0.55;
    s.set(sc, sc, sc);
    m4.compose(p, q, s);
    inst.setMatrixAt(k++, m4);
  }
  for (let i = 0; i < longN; i++) {
    const a = Math.PI * (0.1 + r() * 0.8); // сзади и по бокам
    const side = r() < 0.5 ? -1 : 1;
    const ang = side * a;
    const drop = r() * long;
    const rad = 0.14 + drop * 0.25 + r() * 0.03;
    const p = V(Math.sin(ang) * rad, c.y - 0.02 - drop, c.z - Math.abs(Math.cos(ang)) * rad * 0.8 - 0.01);
    if (Math.cos(ang) < -0.2) p.z = c.z + Math.cos(ang) * rad * 0.2 - 0.05;
    q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
    const sc = 0.8 + r() * 0.6;
    s.set(sc, sc * 1.2, sc);
    m4.compose(p, q, s);
    inst.setMatrixAt(k++, m4);
  }
  inst.count = k;
  inst.castShadow = true;
  parent.add(inst);
  return inst;
}


// ---------- кисти: ладонь, 4 пальца по 3 фаланги, большой палец ----------
export const POSES = {
  rest: { c: [0.32, 0.36, 0.42, 0.5], t: 0.25, sp: 0.06 },
  hold: { c: [0.85, 0.95, 1.05, 1.15], t: 0.55, sp: 0.02 },
  grip: { c: [1.25, 1.3, 1.35, 1.4], t: 0.95, sp: 0.0 },
  point: { c: [0.02, 1.45, 1.55, 1.6], t: 0.95, sp: 0.02 },
  cig: { c: [0.12, 0.16, 1.3, 1.45], t: 0.55, sp: 0.1 },
  limp: { c: [0.18, 0.2, 0.25, 0.3], t: 0.1, sp: 0.12 },
  fist: { c: [1.55, 1.6, 1.65, 1.7], t: 1.0, sp: 0.0 },
};
const FINGERS = [
  { x: 0.024, l: [0.029, 0.02, 0.017], r: 0.0088 }, // указательный (ближе к большому)
  { x: 0.008, l: [0.032, 0.022, 0.018], r: 0.009 },
  { x: -0.008, l: [0.03, 0.02, 0.017], r: 0.0086 },
  { x: -0.023, l: [0.023, 0.016, 0.014], r: 0.0076 },
];
const segGeo = new Map();
function capsule(r, len) {
  const k = `${r}|${len}`;
  if (!segGeo.has(k)) segGeo.set(k, new THREE.CapsuleGeometry(r, len, 4, 10));
  return segGeo.get(k);
}

function buildHand(hand, thumbSide, handMat, tipMat, key) {
  // пальцы смотрят в −Y, ладонь — в +Z; большой палец со стороны thumbSide по X
  const palm = new THREE.Mesh(new RoundedBoxGeometry(0.066, 0.074, 0.03, 3, 0.012), handMat);
  palm.position.set(0, -0.04, 0.002);
  hand.add(palm);
  const heel = sph(0.022, handMat, thumbSide * 0.016, -0.018, 0.01, hand, 1.1, 1, 0.8, 14, 10);
  heel.userData.handPart = true;
  const joints = [];
  FINGERS.forEach((f, i) => {
    const chain = [];
    let parent = hand;
    let y = -0.074;
    f.l.forEach((len, k) => {
      const j = new THREE.Object3D();
      j.position.set(k === 0 ? f.x * thumbSide : 0, k === 0 ? y : -f.l[k - 1], k === 0 ? 0.003 : 0);
      parent.add(j);
      const glove = key === 'metal' && k === 0;
      const m = new THREE.Mesh(capsule(f.r * (1 - k * 0.07), len - f.r), glove ? handMat : tipMat === handMat ? handMat : (key === 'metal' ? tipMat : handMat));
      m.position.y = -len / 2;
      j.add(m);
      if (k === 0) sph(f.r * 1.08, glove ? handMat : handMat, 0, 0, 0, j, 1, 1, 1, 10, 8);
      chain.push(j);
      parent = j;
    });
    // ноготь
    if (key !== 'metal' || true) {
      const nail = new THREE.Mesh(new THREE.SphereGeometry(f.r * 0.75, 10, 8), NAIL[key] || NAIL.base);
      nail.scale.set(1, 1.2, 0.4);
      nail.position.set(0, -f.l[2] * 0.72, -f.r * 0.62);
      chain[2].add(nail);
    }
    joints.push(chain);
  });
  // большой палец
  const tb = new THREE.Object3D();
  tb.position.set(thumbSide * 0.03, -0.02, 0.012);
  tb.rotation.set(0.2, 0, thumbSide * 0.85);
  hand.add(tb);
  const t0 = new THREE.Mesh(capsule(0.0105, 0.018), handMat); t0.position.y = -0.016; tb.add(t0);
  const t1j = new THREE.Object3D(); t1j.position.y = -0.03; tb.add(t1j);
  const t1 = new THREE.Mesh(capsule(0.0098, 0.014), key === 'metal' ? tipMat : handMat); t1.position.y = -0.013; t1j.add(t1);
  const tnail = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 10, 8), NAIL[key] || NAIL.base);
  tnail.scale.set(1, 1.2, 0.4); tnail.position.set(0, -0.018, -0.006); t1j.add(tnail);
  return { joints, tb, t1j, thumbSide };
}
const NAIL = {
  base: new THREE.MeshStandardMaterial({ color: '#f3d2c2', roughness: 0.3 }),
  doll: new THREE.MeshStandardMaterial({ color: '#f07aa0', roughness: 0.2 }),
  metal: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.2 }),
  alien: new THREE.MeshStandardMaterial({ color: '#c9ccd4', roughness: 0.3 }),
};

function applyHandPose(f, p) {
  f.joints.forEach((chain, i) => {
    const c = p.c[i];
    chain[0].rotation.set(-c, 0, (i - 1.5) * p.sp * -f.thumbSide);
    chain[1].rotation.x = -c * 1.12;
    chain[2].rotation.x = -c * 0.8;
  });
  f.tb.rotation.x = 0.2 - p.t * 0.7;
  f.tb.rotation.y = -f.thumbSide * p.t * 0.5;
  f.t1j.rotation.x = -p.t * 0.9;
}

export const SKIN = { metal: '#efcfb5', doll: '#f5d9cc', alien: '#e3e4e8', priest: '#e9c3a0' };

export class Character {
  constructor(key, seat, fx) {
    this.key = key;
    this.seat = seat;
    this.fx = fx;
    this.root = new THREE.Group();
    const p = seatPos(seat);
    this.root.position.copy(p);
    this.root.rotation.y = seatYaw(seat);
    this.skinMats = [];
    this.headOnly = [];
    this.face = {};
    this.s = {
      lean: 0, leanT: 0, yaw: 0, pitch: 0, roll: 0, yawT: 0, pitchT: 0, rollT: 0,
      mouth: 0, mouthT: 0, brow: 0, browT: 0, sick: 0, sickT: 0, eye: 1, eyeT: 1,
      blinkAt: 2 + Math.random() * 3, blink: 0, breath: Math.random() * 6,
    };
    this.hands = { L: V(-0.17, 0.83, 0.42), R: V(0.17, 0.83, 0.42) };
    this.handT = { L: this.hands.L.clone(), R: this.hands.R.clone() };
    this.action = null;
    this.dead = false;
    this.cards = 0;
    this.lookAt = null;
    this.fp = null; // вид от первого лица: { yaw, pitch } напрямую от мыши
    this.smoking = null;
    this.baseMouth = 0;
    this.baseBrow = 0;
    this.build();
    this.root.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    // неподвижные друг относительно друга детали сливаем; анимируемые (лицо, пальцы) не трогаем
    rigidSkin(this.root, { skip: referenced(this, ['headOnly', 'skinMats', 'M', 'fx']), keep: ['headOnly'] });
    this.headOnly = [];
    this.root.traverse((c) => { if (c.isMesh && c.userData.headOnly) this.headOnly.push(c); });
  }

  skin(extra = {}) {
    const m = mat({ color: SKIN[this.key], roughness: 0.55, sheen: 0.3, sheenColor: new THREE.Color('#ffd9c4'), sheenRoughness: 0.6, ...extra });
    m.userData.base = m.color.clone();
    this.skinMats.push(m);
    return m;
  }

  build() {
    const key = this.key;
    const R = this.root;
    const scale = { metal: 1.0, doll: 0.94, alien: 0.97, priest: 1.05 }[key];
    this.body = new THREE.Group();
    this.body.scale.setScalar(scale);
    R.add(this.body);
    const B = this.body;
    const skin = this.skin();

    // ---- материалы одежды ----
    const M = {};
    if (key === 'metal') {
      const lt = T.toTex(T.leatherCanvas(8), { repeat: [2, 2] });
      M.top = mat({ color: '#1a1716', map: lt, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.35, bumpMap: T.toTex(T.bumpFrom(T.leatherCanvas(9)), { srgb: false, repeat: [2, 2] }), bumpScale: 1.2 });
      M.sleeve = M.top;
      M.legs = mat({ color: '#141212', map: lt, roughness: 0.5, clearcoat: 0.35 });
      M.shoe = mat({ color: '#0d0d0d', roughness: 0.3, clearcoat: 0.8 });
      M.sole = mat({ color: '#1c1c1c', roughness: 0.8 });
      M.metal = mat({ color: '#d4d6da', metalness: 1, roughness: 0.22, envMapIntensity: 1.2 });
      M.tee = mat({ color: '#f1efe9', roughness: 0.85 });
      M.glove = mat({ color: '#101010', roughness: 0.5, clearcoat: 0.3 });
    } else if (key === 'doll') {
      const ft = T.toTex(T.floralCanvas(), { repeat: [2, 2] });
      M.top = mat({ map: ft, roughness: 0.8, sheen: 1, sheenColor: new THREE.Color('#ffd0e0'), sheenRoughness: 0.4 });
      M.sleeve = M.top;
      M.legs = mat({ color: '#fbf7f6', roughness: 0.45, sheen: 1, sheenColor: new THREE.Color('#ffffff') });
      M.shoe = mat({ color: '#f4b3c8', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });
      M.sole = M.shoe;
      M.satin = mat({ color: '#f29bb6', roughness: 0.3, sheen: 1, sheenColor: new THREE.Color('#ffe0ea'), clearcoat: 0.4 });
      M.lace = mat({ color: '#fff8f0', roughness: 0.9 });
    } else if (key === 'alien') {
      M.top = mat({ map: T.toTex(T.knitCanvas('#5e5e60'), { repeat: [2, 2] }), roughness: 0.95, sheen: 0.5, sheenColor: new THREE.Color('#999') });
      M.sleeve = M.top;
      M.legs = mat({ map: T.toTex(T.denimCanvas('#b8bcc3'), { repeat: [3, 3] }), roughness: 0.95 });
      M.shoe = mat({ color: '#f2f2f0', roughness: 0.5 });
      M.sole = mat({ color: '#ffffff', roughness: 0.6 });
    } else {
      M.top = mat({ color: '#121213', roughness: 0.9, sheen: 0.6, sheenColor: new THREE.Color('#3a3a44'), sheenRoughness: 0.5 });
      M.sleeve = M.top;
      M.legs = M.top;
      M.shoe = mat({ color: '#0e0e0e', roughness: 0.28, clearcoat: 0.7 });
      M.sole = M.shoe;
    }
    this.M = M;

    // ---- ноги (сидя) ----
    for (const s of [-1, 1]) {
      const hip = V(s * 0.1, HIPS_Y + 0.03, 0.02), knee = V(s * 0.11, HIPS_Y + 0.05, 0.42), ankle = V(s * 0.12, 0.09, 0.47);
      limb(hip, knee, key === 'alien' ? 0.075 : 0.068, M.legs, B);
      limb(knee, ankle, key === 'alien' ? 0.068 : 0.056, key === 'doll' ? M.legs : M.legs, B);
      if (key === 'metal') {
        bx(0.15, 0.2, 0.26, M.shoe, s * 0.12, 0.12, 0.52, B, 0.04);
        bx(0.16, 0.06, 0.28, M.sole, s * 0.12, 0.03, 0.52, B, 0.02);
        bx(0.155, 0.02, 0.04, M.metal, s * 0.12, 0.16, 0.6, B);
        bx(0.155, 0.02, 0.04, M.metal, s * 0.12, 0.1, 0.63, B);
      } else if (key === 'doll') {
        bx(0.09, 0.07, 0.18, M.shoe, s * 0.12, 0.05, 0.53, B, 0.03);
        bx(0.095, 0.03, 0.05, M.shoe, s * 0.12, 0.015, 0.47, B, 0.01);
        sph(0.018, M.satin, s * 0.12, 0.085, 0.6, B, 1.6, 0.8, 1);
      } else {
        bx(0.11, 0.09, 0.24, M.shoe, s * 0.12, 0.05, 0.53, B, 0.035);
        if (key === 'alien') bx(0.115, 0.03, 0.25, M.sole, s * 0.12, 0.015, 0.53, B, 0.012);
      }
    }
    // таз
    sph(0.17, key === 'priest' ? M.top : M.legs, 0, HIPS_Y + 0.05, 0.03, B, 1.15, 0.55, 0.95);

    // ---- торс ----
    this.torso = new THREE.Group();
    this.torso.position.set(0, HIPS_Y, 0);
    B.add(this.torso);
    const Tq = this.torso;
    const tw = key === 'alien' ? 1.28 : key === 'doll' ? 0.92 : 1.08;
    const torsoMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.25, 8, 24), M.top);
    torsoMesh.scale.set(tw, 1, key === 'alien' ? 0.82 : 0.72);
    torsoMesh.position.set(0, 0.27, 0);
    Tq.add(torsoMesh);
    // шея
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.12, 16), skin);
    neck.position.set(0, 0.54, 0.005);
    Tq.add(neck);

    // ---- плечи и руки ----
    this.arm = {};
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? -1 : 1;
      const sh = new THREE.Object3D();
      sh.position.set(s * (key === 'alien' ? 0.21 : 0.19), 0.47, 0);
      Tq.add(sh);
      const el = new THREE.Object3D();
      el.position.set(0, -L1, 0);
      sh.add(el);
      const hand = new THREE.Object3D();
      hand.position.set(0, -L2 + 0.012, 0);
      el.add(hand);
      // верх руки
      const up = new THREE.Mesh(new THREE.CapsuleGeometry(key === 'alien' ? 0.05 : 0.052, L1 - 0.06, 6, 14), key === 'doll' ? skin : M.sleeve);
      up.position.y = -L1 / 2;
      sh.add(up);
      const fr = new THREE.Mesh(new THREE.CapsuleGeometry(0.046, L2 - 0.07, 6, 14), (key === 'doll' || key === 'alien') ? skin : M.sleeve);
      fr.position.y = -L2 / 2;
      el.add(fr);
      // кисть
      const fingers = buildHand(hand, side === 'R' ? 1 : -1, key === 'metal' ? M.glove : skin, skin, key);
      if (key === 'metal') {
        // ремешки на рукавах
        bx(0.11, 0.022, 0.11, M.top, 0, -L2 + 0.07, 0, el);
        bx(0.018, 0.012, 0.022, M.metal, s * 0.055, -L2 + 0.07, 0.03, el);
        const strap = bx(0.022, 0.12, 0.006, M.top, s * 0.05, -0.1, 0.03, el);
        strap.rotation.z = s * 0.2;
      }
      if (key === 'doll') {
        sph(0.085, M.top, 0, -0.03, 0, sh, 1, 0.9, 1); // фонарик
        const tr = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.012, 8, 20), M.lace);
        tr.rotation.x = Math.PI / 2; tr.position.y = -0.1; sh.add(tr);
      }
      if (key === 'alien') {
        const slv = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.24, 18), M.top);
        slv.position.y = -0.12; sh.add(slv);
        sph(0.09, M.top, 0, -0.01, 0, sh, 1, 0.8, 1);
      }
      if (key === 'priest') {
        const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.068, 0.16, 18, 1, true), M.top);
        cuff.material.side = THREE.DoubleSide;
        cuff.position.y = -L2 + 0.08; el.add(cuff);
      }
      if (key === 'metal') sph(0.075, M.top, 0, 0, 0, sh, 1, 0.85, 1);
      this.arm[side] = { sh, el, hand, s, fingers, pose: { ...POSES.rest }, poseT: 'rest', palm: V(0, -1, 0) };
    }

    // ---- детали торса ----
    if (key === 'metal') {
      const tee = bx(0.12, 0.34, 0.03, M.tee, 0, 0.3, 0.1, Tq, 0.01);
      tee.scale.z = 1;
      for (const s of [-1, 1]) {
        const lap = bx(0.07, 0.22, 0.02, M.top, s * 0.085, 0.38, 0.115, Tq, 0.005);
        lap.rotation.set(-0.15, s * 0.35, s * -0.25);
        const zip = bx(0.008, 0.16, 0.008, M.metal, s * 0.12, 0.26, 0.112, Tq);
        zip.rotation.z = s * 0.35;
        const ep = bx(0.07, 0.02, 0.12, M.top, s * 0.19, 0.5, 0, Tq, 0.006);
        for (let k = 0; k < 3; k++) sph(0.009, M.metal, s * 0.19, 0.515, -0.04 + k * 0.04, Tq, 1, 1, 1, 10, 8);
        for (let k = 0; k < 4; k++) sph(0.007, M.metal, s * (0.1 + k * 0.012), 0.46 - k * 0.03, 0.125, Tq, 1, 1, 1, 8, 6);
      }
      // цепь и череп
      const chain = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.004, 6, 40, Math.PI), M.metal);
      chain.position.set(0, 0.52, 0.06); chain.rotation.set(-0.9, 0, Math.PI); Tq.add(chain);
      const skull = sph(0.02, M.metal, 0, 0.4, 0.125, Tq, 1, 1.1, 0.8);
      sph(0.005, mat({ color: '#111' }), -0.007, 0.402, 0.141, Tq);
      sph(0.005, mat({ color: '#111' }), 0.007, 0.402, 0.141, Tq);
      this.skull = skull;
      // ремень
      bx(0.36, 0.05, 0.25, M.top, 0, 0.06, 0.02, Tq, 0.02);
      bx(0.05, 0.04, 0.01, M.metal, 0, 0.06, 0.15, Tq);
    }
    if (key === 'doll') {
      const neckline = sph(0.12, skin, 0, 0.44, 0.03, Tq, 1.05, 0.55, 0.85);
      const trim = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.01, 8, 30, Math.PI), M.lace);
      trim.position.set(0, 0.405, 0.05); trim.rotation.set(-1.25, 0, Math.PI); Tq.add(trim);
      sph(0.012, M.satin, 0, 0.37, 0.12, Tq, 1.8, 0.8, 0.6);
      // сборка на талии
      for (let k = 0; k < 5; k++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.006, 6, 30), M.top); t.rotation.x = Math.PI / 2; t.scale.set(1, 0.75, 1); t.position.y = 0.14 + k * 0.025; Tq.add(t); }
      // юбка-ярусы
      for (let k = 0; k < 3; k++) {
        const sk = new THREE.Mesh(new THREE.CylinderGeometry(0.17 + k * 0.05, 0.25 + k * 0.06, 0.13, 32, 1, true), M.top);
        sk.material.side = THREE.DoubleSide;
        sk.position.set(0, HIPS_Y + 0.08 - k * 0.07, 0.12 + k * 0.05);
        sk.rotation.x = 0.55;
        sk.scale.set(1, 1, 1.3);
        B.add(sk);
        const lace = new THREE.Mesh(new THREE.TorusGeometry(0.25 + k * 0.06, 0.012, 6, 40), M.lace);
        lace.position.set(0, HIPS_Y + 0.08 - k * 0.07 - 0.055, 0.12 + k * 0.05 + 0.035);
        lace.rotation.x = Math.PI / 2 + 0.55;
        lace.scale.set(1, 1.3, 1);
        B.add(lace);
      }
    }
    if (key === 'priest') {
      // подрясник: драпировка от колен до пола
      const drape = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.33, 0.44, 28, 1, true), M.top);
      drape.material.side = THREE.DoubleSide;
      drape.position.set(0, 0.26, 0.38); drape.scale.set(1, 1, 0.55);
      B.add(drape);
      const lap = bx(0.3, 0.06, 0.46, M.top, 0, HIPS_Y + 0.09, 0.22, B, 0.03);
      lap.rotation.x = -0.05;
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.068, 0.06, 20), M.top);
      collar.position.set(0, 0.55, 0.005); Tq.add(collar);
      const plack = bx(0.02, 0.44, 0.012, mat({ color: '#1e1e21', roughness: 0.7 }), 0, 0.28, 0.118, Tq);
      for (let k = 0; k < 7; k++) sph(0.006, mat({ color: '#050505', roughness: 0.3 }), 0.0, 0.5 - k * 0.065, 0.126, Tq, 1, 1, 0.6, 8, 6);
      plack.castShadow = false;
    }
    if (key === 'alien') {
      const hem = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 8, 30), M.top);
      hem.rotation.x = Math.PI / 2; hem.scale.set(1.25, 0.82, 1); hem.position.y = 0.04; Tq.add(hem);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.012, 8, 24), M.top);
      collar.rotation.x = Math.PI / 2 - 0.2; collar.position.set(0, 0.5, 0.01); Tq.add(collar);
    }

    // ---- голова ----
    this.head = new THREE.Group();
    this.head.position.set(0, 0.58, 0.005);
    Tq.add(this.head);
    const H = this.head;
    const c = V(0, 0.13, 0.01);
    this.headC = c;
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 48, 36), skin);
    headMesh.position.copy(c);
    headMesh.scale.set(key === 'alien' ? 0.88 : 0.95, key === 'alien' ? 1.17 : 1.07, key === 'alien' ? 0.94 : 1.0);
    H.add(headMesh);
    this.headOnly.push(headMesh);
    if (key === 'alien') this.headOnly.push(sph(0.1, skin, 0, c.y - 0.1, c.z + 0.035, H, 0.8, 0.8, 0.9));
    else this.headOnly.push(sph(0.1, skin, 0, c.y - 0.075, c.z + 0.04, H, 0.95, 0.75, 0.95));
    // уши
    if (key !== 'alien') for (const s of [-1, 1]) this.headOnly.push(sph(0.03, skin, s * 0.142, c.y, c.z - 0.005, H, 0.5, 1, 0.8));

    this.buildFace(c, skin);
    this.buildHair(c);
    this.headOnly.forEach((m) => { m.userData.headOnly = true; });

    // сигарета
    this.cig = buildCig();
    this.cig.visible = false;
  }

  buildFace(c, skin) {
    const key = this.key;
    const H = this.head;
    const F = this.face;
    const white = mat({ color: '#f8f6f2', roughness: 0.25, clearcoat: 1 });
    const irisCol = { metal: '#4d6a7a', doll: '#6f9fd1', priest: '#4a3222' }[key];
    F.eyes = [];
    if (key === 'alien') {
      const black = mat({ color: '#050507', roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.15, envMapIntensity: 0.25 });
      for (const s of [-1, 1]) {
        const g = new THREE.Group();
        g.position.set(c.x + s * 0.058, c.y + 0.01, c.z + 0.108);
        g.rotation.set(0, s * 0.35, s * -0.42);
        H.add(g);
        const e = sph(0.052, black, 0, 0, 0, g, 1.3, 0.74, 0.55, 32, 24);
        const hl = sph(0.007, new THREE.MeshBasicMaterial({ color: '#ffffff' }), 0.018, 0.012, 0.028, g);
        F.eyes.push({ g, e, hl });
        this.headOnly.push(e, hl);
      }
      // ноздри и рот
      for (const s of [-1, 1]) this.headOnly.push(sph(0.004, mat({ color: '#8a8a90' }), s * 0.008, c.y - 0.04, c.z + 0.138, H));
      F.mouth = sph(0.016, mat({ color: '#6e6b72', roughness: 0.4 }), 0, c.y - 0.085, c.z + 0.12, H, 1.4, 0.35, 0.5);
      F.mouthBase = 0.35;
      this.headOnly.push(F.mouth);
      return;
    }
    const iris = mat({ color: irisCol, roughness: 0.2, clearcoat: 1 });
    const pupil = mat({ color: '#070707', roughness: 0.1, clearcoat: 1 });
    const eyeR = key === 'priest' ? 0.031 : key === 'doll' ? 0.03 : 0.028;
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(c.x + s * 0.054, c.y + 0.018, c.z + 0.118);
      H.add(g);
      const e = sph(eyeR, white, 0, 0, 0, g, 1, 1, 0.75);
      const ir = sph(eyeR * (key === 'priest' ? 0.42 : 0.58), iris, 0, 0, eyeR * 0.62, g, 1, 1, 0.5);
      const pu = sph(eyeR * (key === 'priest' ? 0.2 : 0.3), pupil, 0, 0, eyeR * 0.72, g, 1, 1, 0.4);
      const hl = sph(0.004, new THREE.MeshBasicMaterial({ color: '#ffffff' }), 0.008, 0.008, eyeR * 0.82, g);
      F.eyes.push({ g, e, ir, pu, hl });
      this.headOnly.push(e, ir, pu, hl);
      // бровь
      const bcol = { metal: '#2a1c14', doll: '#8a5a3a', priest: '#3b2415' }[key];
      const brow = bx(0.05, 0.011, 0.014, mat({ color: bcol, roughness: 0.8 }), c.x + s * 0.056, c.y + 0.068, c.z + 0.132, H, 0.005);
      brow.userData.side = s;
      F.brows = F.brows || [];
      F.brows.push(brow);
      this.headOnly.push(brow);
      if (key === 'doll') {
        const lash = bx(0.042, 0.006, 0.01, mat({ color: '#221612' }), 0, eyeR * 0.72, eyeR * 0.4, g);
        lash.rotation.z = s * -0.15;
        this.headOnly.push(lash);
        const blush = sph(0.026, mat({ color: '#f39aa6', transparent: true, opacity: 0.45, roughness: 0.9 }), c.x + s * 0.085, c.y - 0.03, c.z + 0.11, H, 1.2, 0.7, 0.4);
        this.headOnly.push(blush);
      }
    }
    // нос
    this.headOnly.push(sph(0.02, skin, 0, c.y - 0.02, c.z + 0.145, H, key === 'priest' ? 1 : 0.85, 1.25, 1));
    // рот
    const mouthM = mat({ color: key === 'doll' ? '#d9607e' : '#3a0f10', roughness: 0.35 });
    F.mouth = sph(0.028, mouthM, 0, c.y - 0.072, c.z + 0.125, H, 1.25, 0.3, 0.55);
    F.mouthBase = 0.3;
    this.headOnly.push(F.mouth);
    if (key === 'metal') {
      F.teeth = bx(0.045, 0.01, 0.01, mat({ color: '#fbfaf2', roughness: 0.3 }), 0, c.y - 0.058, c.z + 0.138, H, 0.003);
      F.tongue = sph(0.016, mat({ color: '#d0606a', roughness: 0.4 }), 0, c.y - 0.085, c.z + 0.132, H, 1.3, 0.5, 0.6);
      this.headOnly.push(F.teeth, F.tongue);
      this.baseMouth = 0.85;
      this.baseBrow = 0.6;
      // очки
      const frameM = mat({ color: '#0b0b0c', roughness: 0.25, clearcoat: 1 });
      const lensM = mat({ color: '#ffffff', transmission: 1, roughness: 0.02, thickness: 0.002, transparent: true, opacity: 0.25 });
      for (const s of [-1, 1]) {
        const sh = new THREE.Shape();
        roundedRect(sh, -0.036, -0.026, 0.072, 0.052, 0.008);
        const hole = new THREE.Path();
        roundedRect(hole, -0.03, -0.02, 0.06, 0.04, 0.006);
        sh.holes.push(hole);
        const fr = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: false }), frameM);
        fr.position.set(s * 0.056, c.y + 0.018, c.z + 0.148);
        H.add(fr);
        const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.04), lensM);
        lens.position.set(s * 0.056, c.y + 0.018, c.z + 0.151);
        H.add(lens);
        const temple = bx(0.004, 0.006, 0.13, frameM, s * 0.095, c.y + 0.03, c.z + 0.085, H);
        this.headOnly.push(fr, lens, temple);
      }
      this.headOnly.push(bx(0.02, 0.005, 0.005, frameM, 0, c.y + 0.03, c.z + 0.153, H));
    }
    if (key === 'priest') {
      this.baseBrow = 1;
      this.baseMouth = 0.15;
      F.mouth.scale.set(0.8, 0.8, 0.6);
      F.o = true;
      F.brows.forEach((b) => { b.rotation.z = b.userData.side * -0.25; });
    }
    if (key === 'doll') { this.baseBrow = -0.1; this.lid = 0.8; }
  }

  buildHair(c) {
    const H = this.head;
    const key = this.key;
    let hair;
    if (key === 'metal') hair = curls(H, c, '#2b1c14', { n: 300, longN: 260, long: 0.36, seed: 3, size: 0.78, faceOpen: 0.42 });
    else if (key === 'doll') {
      hair = curls(H, c, '#a8633a', { n: 320, longN: 170, long: 0.2, seed: 7, size: 0.74, faceOpen: 0.38 });
      // бант
      const g = new THREE.Group();
      g.position.set(c.x + 0.1, c.y + 0.12, c.z + 0.02);
      g.rotation.set(0.3, 0.4, -0.5);
      H.add(g);
      const sat = this.M.satin;
      for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 16), sat); w.rotation.z = s * Math.PI / 2; w.position.x = s * 0.03; w.scale.z = 0.4; g.add(w); }
      sph(0.014, sat, 0, 0, 0, g);
      for (const s of [-1, 1]) { const t = bx(0.012, 0.05, 0.004, sat, s * 0.012, -0.03, 0, g); t.rotation.z = s * 0.3; }
      this.headOnly.push(...g.children);
      // чокер с сердечком
      const ch = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.007, 8, 32), sat);
      ch.rotation.x = Math.PI / 2; ch.position.set(0, 0.53, 0.005); this.torso.add(ch);
      const heart = new THREE.Group();
      heart.position.set(0, 0.505, 0.057); this.torso.add(heart);
      const hm = mat({ color: '#f7b8c9', metalness: 0.9, roughness: 0.2 });
      sph(0.008, hm, -0.006, 0.004, 0, heart); sph(0.008, hm, 0.006, 0.004, 0, heart);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0105, 0.016, 12), hm); tip.rotation.z = Math.PI; tip.position.y = -0.006; heart.add(tip);
    } else if (key === 'priest') hair = curls(H, c, '#4a2e1c', { n: 330, longN: 50, long: 0.06, seed: 11, size: 0.82, faceOpen: 0.45, top: 0.2 });
    else {
      const hm = mat({ color: '#d8cfb8', roughness: 0.45, sheen: 1, sheenColor: new THREE.Color('#fff6dd'), sheenRoughness: 0.3 });
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.158, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.52), hm);
      cap.position.copy(c).add(V(0, 0.015, -0.01));
      cap.scale.set(0.93, 1.2, 1.0);
      cap.rotation.x = -0.25;
      H.add(cap);
      this.headOnly.push(cap);
      // гладкое каре до плеч: оболочка вращения с вырезом под лицо
      const prof = [];
      for (let k = 0; k <= 14; k++) {
        const a = (k / 14) * Math.PI * 0.62;
        prof.push(new THREE.Vector2(Math.sin(a) * 0.168 + (k > 8 ? (k - 8) * 0.004 : 0), Math.cos(a) * 0.19));
      }
      for (let k = 1; k <= 8; k++) prof.push(new THREE.Vector2(0.172 + k * 0.006 + Math.sin(k) * 0.002, prof[14].y - k * 0.04));
      prof.push(new THREE.Vector2(0.21, prof[prof.length - 1].y - 0.01));
      prof.push(new THREE.Vector2(0.16, prof[prof.length - 1].y + 0.005));
      const bob = new THREE.Mesh(new THREE.LatheGeometry(prof, 48, 0.95, Math.PI * 2 - 1.9), hm);
      bob.material.side = THREE.DoubleSide;
      bob.position.copy(c).add(V(0, 0.02, -0.012));
      bob.scale.set(0.95, 1, 1.02);
      H.add(bob);
      this.headOnly.push(bob);
      // пробор и пряди у лица
      for (const sd of [-1, 1]) {
        const strand = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.26, 4, 10), hm);
        strand.position.set(c.x + sd * 0.128, c.y - 0.1, c.z + 0.075);
        strand.rotation.z = sd * 0.08;
        strand.scale.set(1, 1, 0.7);
        H.add(strand);
        this.headOnly.push(strand);
      }
    }
    if (hair) this.headOnly.push(hair);
  }

  hideHead(v) { this.headOnly.forEach((m) => { m.visible = !v; }); }

  // ---------- действия ----------
  play(name, opts = {}) {
    this.action = { name, t: 0, opts, dur: { throw: 0.9, point: 2.4, drink: 3.6, survive: 2.4, poison: 4.4, react: 1.6 }[name] || 1 };
    if (name === 'drink') this.drinkLevelDone = false;
  }

  startSmoke(dur = 12) {
    this.smoking = { t: 0, dur };
    this.cig.visible = true;
    this.cigBurn = 1;
  }

  setDead(v, instant = false) {
    this.dead = v;
    if (v) { this.s.sickT = 1; if (instant) this.s.sick = 1; this.smoking = null; this.cig.visible = false; }
    else { this.s.sickT = 0; this.s.sick = 0; }
  }

  mouthWorld(out = V()) {
    return this.head.localToWorld(out.set(0, this.headC.y - 0.07, this.headC.z + 0.14));
  }
  eyeWorld(out = V()) { return this.head.localToWorld(out.set(0, this.headC.y + 0.02, this.headC.z + 0.06)); }

  // ---------- кадр ----------
  update(dt, time, env) {
    const s = this.s;
    const k = 1 - Math.pow(0.0015, dt);
    const kf = 1 - Math.pow(0.00002, dt);
    // по умолчанию
    s.leanT = 0; s.pitchT = 0.08; s.rollT = 0; s.mouthT = this.baseMouth; s.browT = this.baseBrow; s.eyeT = this.lid || 1;
    const holding = this.cards > 0 && !this.dead;
    // свои карты держим выше и дальше от груди — их видно внизу экрана
    const restL = holding ? (this.isMe ? V(-0.095, 0.885, 0.4) : V(-0.075, 0.93, 0.33)) : V(-0.19, 0.812, 0.36);
    const restR = holding ? (this.isMe ? V(0.1, 0.885, 0.4) : V(0.08, 0.93, 0.33)) : V(0.2, 0.812, 0.35);
    this.handT.L.copy(restL); this.handT.R.copy(restR);
    const P = (side, pose, palm) => { this.arm[side].poseT = pose; this.arm[side].palmL = palm; };
    P('L', holding ? 'hold' : 'rest', holding ? V(0.75, 0.2, -0.6) : V(0.2, -1, 0.05));
    P('R', holding ? 'hold' : 'rest', holding ? V(-0.75, 0.2, -0.6) : V(-0.2, -1, 0.05));

    // взгляд
    let yawT = 0, pitchLook = 0.08;
    if (this.fp) { yawT = this.fp.yaw; pitchLook = this.fp.pitch; }
    else if (this.lookAt) {
      const eye = this.eyeWorld();
      const d = this.lookAt.clone().sub(eye);
      const inv = this.root.quaternion.clone().invert();
      d.applyQuaternion(inv);
      yawT = clamp(Math.atan2(d.x, d.z), -1.2, 1.2);
      pitchLook = clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.5, 0.6);
    }
    s.yawT = yawT; s.pitchT = pitchLook;

    const bottle = env.bottle;
    let bottleHeld = false;

    // курение (левая рука)
    if (this.smoking && !this.dead) {
      const sm = this.smoking;
      sm.t += dt;
      const cyc = (sm.t % 4.2) / 4.2;
      const up = sm.t > 0.8 && sm.t < sm.dur - 1 ? (cyc < 0.15 ? ease(cyc / 0.15) : cyc < 0.42 ? 1 : cyc < 0.58 ? 1 - ease((cyc - 0.42) / 0.16) : 0) : 0;
      const qc = this.root.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.15 - up * 0.2, 0.5 - up * 0.3, 0)));
      const mouth = this.mouthWorld();
      const atMouth = mouth.clone().add(V(0, 0, 0.012).applyQuaternion(qc)).add(V(0, -0.012, 0));
      const off = this.cigOff || V(0, -0.08, 0);
      const restW = this.root.localToWorld(V(-0.2, 0.86, 0.33));
      const hw = restW.clone().lerp(atMouth.clone().sub(off), up);
      this.handT.L.copy(this.root.worldToLocal(hw.clone()));
      P('L', 'cig', V(0.35, -1, 0.1).lerp(V(0.25, 0.1, -1), up));
      this.cigPose = { qc, up, cyc };
      if (up > 0.95) this.cigGlow = Math.min(1, (this.cigGlow || 0) + dt * 3); else this.cigGlow = Math.max(0.25, (this.cigGlow || 0) - dt * 1.2);
      // выдох после затяжки
      if (cyc > 0.6 && cyc < 0.85 && sm.t > 0.8 && Math.random() < dt * 40) {
        const dir = V(0, 0.02, 0.35).applyQuaternion(this.head.getWorldQuaternion(new THREE.Quaternion()));
        const from = this.mouthWorld().add(V(0, this.isMe ? -0.02 : 0, this.isMe ? 0.32 : 0).applyQuaternion(this.root.quaternion));
        this.fx.smoke(from, dir.add(V((Math.random() - 0.5) * 0.08, 0.05, 0)), 0.04, 2.6, this.isMe ? 0.1 : 0.2);
      }
      if (sm.t > sm.dur) { this.smoking = null; this.cig.visible = false; env.onButt && env.onButt(this); }
    }

    // одиночные действия
    const a = this.action;
    if (a) {
      a.t += dt;
      const t = a.t;
      if (a.name === 'throw') {
        const e = Math.sin(clamp(t / a.dur, 0, 1) * Math.PI);
        this.handT.R.lerp(V(0.03, 0.88, 0.72), e);
        s.leanT = 0.28 * e;
        if (t > a.dur * 0.45) P('R', 'rest', V(0, -1, 0.2));
      } else if (a.name === 'point') {
        const e = t < 0.25 ? ease(t / 0.25) : t > a.dur - 0.5 ? 1 - ease((t - a.dur + 0.5) / 0.5) : 1;
        if (a.opts.target) {
          const sh = this.arm.R.sh.getWorldPosition(V());
          const dir = a.opts.target.clone().sub(sh).normalize();
          const p = sh.add(dir.multiplyScalar(0.56));
          this.handT.R.lerp(this.root.worldToLocal(p), e);
        }
        if (e > 0.3) P('R', 'point', V(-0.3, -1, 0));
        s.leanT = 0.22 * e; s.mouthT = lerp(s.mouthT, 1, e); s.browT = lerp(s.browT, -1, e);
      } else if (a.name === 'drink' && bottle) {
        bottleHeld = true;
        const grip = V(0, 0.08, 0);
        const home = bottle.home;
        const pReach = ease(seg(t, 0, 0.5));
        const pLift = ease(seg(t, 0.5, 1.3));
        const pBack = ease(seg(t, 2.7, 3.4));
        const tilt = lerp(0, -1.85, pLift * (1 - pBack)) + Math.sin(t * 9) * 0.03 * seg(t, 1.3, 2.6);
        const qb = this.root.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, 0)));
        const homeC = home.pos.clone().add(grip);
        const mouth = this.mouthWorld();
        const drinkC = mouth.clone().sub(V(0, 0.25 - 0.08, 0).applyQuaternion(qb));
        const center = homeC.clone().lerp(drinkC, pLift * (1 - pBack));
        const wristOff = V(0.052, -0.004, -0.05);
        const homeWrist = homeC.clone().add(wristOff.clone().applyQuaternion(this.root.quaternion));
        let hw;
        if (t < 0.5) hw = this.root.localToWorld(restR.clone()).lerp(homeWrist, pReach);
        else if (t > 3.4) hw = homeWrist.clone().lerp(this.root.localToWorld(restR.clone()), ease(seg(t, 3.4, 3.6)));
        else hw = center.clone().add(wristOff.clone().applyQuaternion(qb));
        this.handT.R.copy(this.root.worldToLocal(hw.clone()));
        if (t > 0.5 && t < 3.4) this.hands.R.copy(this.handT.R);
        P('R', t > 0.38 && t < 3.45 ? 'grip' : 'rest', t > 0.3 && t < 3.45 ? V(-1, 0, 0.1).applyAxisAngle(V(1, 0, 0), tilt) : V(-0.2, -1, 0));
        s.pitchT = lerp(s.pitchT, -0.55, ease(seg(t, 1.1, 1.6)) * (1 - ease(seg(t, 2.5, 2.9))));
        s.yawT *= 0.2;
        s.mouthT = 0.4;
        if (t > 0.5 && t < 3.4) {
          bottle.group.quaternion.copy(qb);
          bottle.group.position.copy(center.clone().sub(grip.clone().applyQuaternion(qb)));
        } else {
          bottle.group.position.copy(home.pos); bottle.group.quaternion.copy(home.quat);
        }
        if (t > 1.6 && t < 2.6 && Math.random() < dt * 3) env.onGulp && env.onGulp(this);
        if (!this.drinkLevelDone && t > 2.0) { this.drinkLevelDone = true; env.onSip && env.onSip(this); }
      } else if (a.name === 'survive') {
        const e = Math.sin(clamp(t / a.dur, 0, 1) * Math.PI);
        s.yawT += Math.sin(t * 10) * 0.25 * e;
        s.browT = 1; s.mouthT = 0.55; s.leanT = -0.12 * e;
        if (t < 0.9 && Math.random() < dt * 20) this.fx.smoke(this.mouthWorld().add(V(0, 0, this.isMe ? 0.3 : 0.02).applyQuaternion(this.root.quaternion)), V(0, 0.08, 0.2).applyQuaternion(this.root.quaternion), 0.03, 1.2, this.isMe ? 0.06 : 0.18);
      } else if (a.name === 'poison') {
        const conv = seg(t, 0.5, 3.4);
        s.sickT = Math.min(1, t / 1.5);
        s.browT = 1; s.eyeT = 1.3;
        s.mouthT = t > 0.8 ? 1.15 : 0.6;
        s.pitchT = t > 0.8 ? 0.55 : -0.1;
        s.leanT = t > 0.8 ? 0.35 + Math.sin(t * 22) * 0.07 * (1 - seg(t, 2.8, 3.4)) : 0.05;
        s.rollT = Math.sin(t * 13) * 0.08 * conv;
        this.handT.R.copy(V(0.2, 0.83, 0.34)); this.handT.L.copy(V(-0.2, 0.83, 0.34));
        P('L', t < 2.8 ? 'fist' : 'limp', V(0, -1, 0)); P('R', t < 2.8 ? 'fist' : 'limp', V(0, -1, 0));
        if (t > 0.8 && t < 3.3) {
          const gush = Math.sin(t * 6) > -0.2;
          if (gush) {
            const q = this.head.getWorldQuaternion(new THREE.Quaternion());
            const dir = V(0, -0.35, 1).applyQuaternion(q).normalize();
            env.vomit && env.vomit(this.mouthWorld(), dir, dt);
          }
        }
        if (t > a.dur - 0.05) { this.setDead(true); }
      } else if (a.name === 'react') {
        const e = Math.sin(clamp(t / a.dur, 0, 1) * Math.PI);
        s.browT = lerp(s.browT, a.opts.brow ?? 1, e); s.mouthT = lerp(s.mouthT, a.opts.mouth ?? 0.6, e);
        s.leanT = (a.opts.lean ?? -0.08) * e;
      }
      if (a.t >= a.dur) this.action = null;
    }
    if (!bottleHeld && bottle && !(this.action && this.action.name === 'drink')) {
      bottle.group.position.lerp(bottle.home.pos, 0.3);
      bottle.group.quaternion.slerp(bottle.home.quat, 0.3);
    }

    if (this.dead && !(a && a.name === 'poison')) {
      s.leanT = 0.95; s.pitchT = 0.3; s.yawT = 0.9; s.rollT = 0.5; s.mouthT = 0.7; s.eyeT = 0.05; s.browT = 0; s.sickT = 1;
      this.handT.L.set(-0.34, 0.8, 0.55); this.handT.R.set(0.36, 0.8, 0.5);
      P('L', 'limp', V(0, -1, 0)); P('R', 'limp', V(0, -1, 0));
    }

    // сглаживание
    s.lean = lerp(s.lean, s.leanT, k);
    if (this.fp) {
      // мышь — без задержки; плавно только то, что добавляет анимация (глоток, судороги)
      s.fpY = lerp(s.fpY || 0, s.yawT - this.fp.yaw, k);
      s.fpP = lerp(s.fpP || 0, s.pitchT - this.fp.pitch, k);
      s.yaw = this.fp.yaw + s.fpY;
      s.pitch = this.fp.pitch + s.fpP;
    } else {
      s.fpY = s.fpP = 0;
      s.yaw = lerp(s.yaw, s.yawT, k);
      s.pitch = lerp(s.pitch, s.pitchT, k);
    }
    s.roll = lerp(s.roll, s.rollT, k);
    s.mouth = lerp(s.mouth, s.mouthT, kf);
    s.brow = lerp(s.brow, s.browT, k);
    s.sick = lerp(s.sick, s.sickT, 1 - Math.pow(0.2, dt));
    s.eye = lerp(s.eye, s.eyeT, k);

    // дыхание и покачивание
    s.breath += dt * (this.dead ? 0 : 1.6);
    const br = Math.sin(s.breath) * (this.isMe ? 0 : 1); // свой прицел не качается
    this.torso.rotation.x = s.lean + br * 0.012;
    this.torso.rotation.z = Math.sin(time * 0.4 + this.seat) * 0.015 * (this.dead || this.isMe ? 0 : 1);
    this.torso.scale.y = 1 + br * 0.008;
    this.head.rotation.set(s.pitch, s.yaw, s.roll, 'YXZ');

    // моргание
    s.blinkAt -= dt;
    if (s.blinkAt < 0) { s.blink = 0.14; s.blinkAt = 2 + Math.random() * 4; }
    s.blink = Math.max(0, s.blink - dt);
    const lid = (s.blink > 0 ? 0.1 : 1) * s.eye;
    const F = this.face;
    F.eyes.forEach((e) => { e.g.scale.y = clamp(lid, 0.05, 1.4); });
    if (F.brows) F.brows.forEach((b) => { b.position.y = this.headC.y + 0.068 + s.brow * 0.014; b.rotation.z = b.userData.side * (-0.12 * s.brow) + (this.key === 'priest' ? b.userData.side * -0.2 : 0); });
    const mo = clamp(s.mouth, 0, 1.3);
    if (F.o) F.mouth.scale.set(0.7 + mo * 0.4, 0.7 + mo * 0.6, 0.6);
    else F.mouth.scale.set(1.25 - mo * 0.15, F.mouthBase + mo * 0.9, 0.55);
    if (F.tongue) F.tongue.position.y = this.headC.y - 0.075 - mo * 0.012;
    // зрачки следят
    F.eyes.forEach((e) => { if (e.ir) { e.ir.position.x = clamp(s.yawT - s.yaw, -0.3, 0.3) * 0.01; } });

    // болезненная зелень
    const sick = s.sick;
    this.skinMats.forEach((m) => { m.color.copy(m.userData.base).lerp(SICK, sick * 0.65); });

    // руки: сглаживание целей и IK
    const kp = 1 - Math.pow(0.0005, dt);
    for (const side of ['L', 'R']) {
      const arm = this.arm[side];
      this.hands[side].lerp(this.handT[side], 1 - Math.pow(0.0004, dt));
      arm.palm.lerp(arm.palmL, kp).normalize();
      this.solveArm(side, this.root.localToWorld(this.hands[side].clone()), arm.palm.clone().applyQuaternion(this.root.quaternion));
      const tp = POSES[arm.poseT] || POSES.rest;
      for (let i = 0; i < 4; i++) arm.pose.c[i] = lerp(arm.pose.c[i], tp.c[i], kp);
      arm.pose.c = arm.pose.c.slice();
      arm.pose.t = lerp(arm.pose.t, tp.t, kp);
      arm.pose.sp = lerp(arm.pose.sp, tp.sp, kp);
      applyHandPose(arm.fingers, arm.pose);
    }

    // веер карт всегда в ладонях: ставим его между кистями
    if (this.fanGroup) {
      const pl = this.arm.L.hand.localToWorld(V(0, -0.05, 0.025));
      const pr = this.arm.R.hand.localToWorld(V(0, -0.05, 0.025));
      // одна рука занята (сигарета, бутылка, бросок) — веер остаётся в другой
      const an = a && a.name;
      const busyL = !!this.smoking;
      const busyR = an === 'drink' || an === 'throw' || an === 'point';
      // свой веер — чуть выше и дальше кистей: руки держат его снизу и не закрывают карты
      const mid = this.isMe ? this.root.localToWorld(V(0, 0.95, 0.43))
        : busyL && !busyR ? pr.add(V(-0.085, 0, 0).applyQuaternion(this.root.quaternion))
          : busyR && !busyL ? pl.add(V(0.085, 0, 0).applyQuaternion(this.root.quaternion))
            : pl.add(pr).multiplyScalar(0.5);
      this.torso.updateMatrixWorld(true);
      const loc = this.torso.worldToLocal(mid);
      loc.y -= 0.012;
      if (this.fanSnap || this.fanGroup.position.distanceTo(loc) > 0.25) this.fanGroup.position.copy(loc);
      else this.fanGroup.position.lerp(loc, 1 - Math.pow(0.00001, dt));
      this.fanSnap = false;
    }

    // сигарета в руке
    if (this.cig.visible && this.cigPose) {
      const hnd = this.arm.L.hand;
      hnd.updateMatrixWorld(true);
      const ts = this.arm.L.fingers.thumbSide;
      const pinch = hnd.localToWorld(V(0.016 * ts, -0.088, 0.004));
      this.cigOff = pinch.clone().sub(hnd.getWorldPosition(V()));
      const qc = this.cigPose.qc;
      this.cig.quaternion.copy(qc);
      this.cig.position.copy(pinch.sub(V(0, 0, 0.012).applyQuaternion(qc)));
      const glow = this.cigGlow || 0.3;
      this.cig.userData.ember.material.emissiveIntensity = 2 + glow * 10;
      if (Math.random() < dt * 14) {
        const tip = this.cig.localToWorld(V(0, 0, 0.085));
        this.fx.smoke(tip, V((Math.random() - 0.5) * 0.02, 0.09, 0), 0.012, 2.6, 0.12);
      }
    }
  }

  solveArm(side, target, palmW) {
    const { sh, el, s } = this.arm[side];
    const parent = sh.parent;
    parent.updateWorldMatrix(true, false);
    const S = sh.position.clone().applyMatrix4(parent.matrixWorld);
    const sc = this.body.scale.x;
    const l1 = L1 * sc, l2 = L2 * sc;
    const d = target.clone().sub(S);
    let dist = d.length();
    const dir = d.normalize();
    dist = clamp(dist, 0.05, (l1 + l2) * 0.999);
    const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
    const A = Math.acos(cosA);
    // полюс: локти вниз и наружу
    const poleW = this.root.localToWorld(V(s * 0.75, 0.2, -0.05)).sub(S);
    const pp = poleW.sub(dir.clone().multiplyScalar(poleW.dot(dir)));
    if (pp.lengthSq() < 1e-6) pp.set(0, -1, 0);
    pp.normalize();
    const upperDir = dir.clone().multiplyScalar(Math.cos(A)).add(pp.multiplyScalar(Math.sin(A))).normalize();
    const E = S.clone().add(upperDir.clone().multiplyScalar(l1));
    const endP = S.clone().add(dir.clone().multiplyScalar(dist));
    const foreDir = endP.sub(E).normalize();
    const pq = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const uL = upperDir.applyQuaternion(pq);
    sh.quaternion.setFromUnitVectors(DOWN, uL);
    const fL = foreDir.applyQuaternion(pq).applyQuaternion(sh.quaternion.clone().invert());
    el.quaternion.setFromUnitVectors(DOWN, fL);
    // поворот предплечья вокруг своей оси: ладонь смотрит куда нужно
    if (palmW) {
      const qE = parent.getWorldQuaternion(new THREE.Quaternion()).multiply(sh.quaternion).multiply(el.quaternion);
      const fw = DOWN.clone().applyQuaternion(qE);
      const zw = V(0, 0, 1).applyQuaternion(qE);
      const n = palmW.clone().sub(fw.clone().multiplyScalar(palmW.dot(fw)));
      const zp = zw.sub(fw.clone().multiplyScalar(zw.dot(fw)));
      if (n.lengthSq() > 1e-6 && zp.lengthSq() > 1e-6) {
        n.normalize(); zp.normalize();
        const ang = Math.atan2(fw.dot(zp.clone().cross(n)), zp.dot(n));
        el.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(DOWN, ang));
      }
    }
    sh.updateMatrixWorld(true);
  }
}

const SICK = new THREE.Color('#8fae62');

function roundedRect(sh, x, y, w, h, r) {
  sh.moveTo(x + r, y);
  sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r);
  sh.lineTo(x + w, y + h - r); sh.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  sh.lineTo(x + r, y + h); sh.quadraticCurveTo(x, y + h, x, y + h - r);
  sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y);
}

function buildCig() {
  const g = new THREE.Group();
  const filter = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.024, 12), mat({ color: '#c9793a', roughness: 0.7 }));
  filter.rotation.x = Math.PI / 2; filter.position.z = 0.012; g.add(filter);
  const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.058, 12), mat({ color: '#f6f3ee', roughness: 0.8 }));
  paper.rotation.x = Math.PI / 2; paper.position.z = 0.053; g.add(paper);
  const ember = new THREE.Mesh(new THREE.CylinderGeometry(0.0043, 0.0043, 0.005, 12), new THREE.MeshStandardMaterial({ color: '#ff5a1a', emissive: '#ff3a00', emissiveIntensity: 4 }));
  ember.rotation.x = Math.PI / 2; ember.position.z = 0.084; g.add(ember);
  g.userData = { ember };
  return g;
}
