// Локация: крытая беседка бара во дворе, как на фото.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as T from './textures.js';
import { TOON, toonFrom } from './style.js';
import { mergeStatic } from './merge.js';

export const TABLE_R = 0.75;
export const TABLE_Y = 0.785;
export const SEAT_R = 1.04;
// навес беседки: открыт на север и запад, сзади (юг) и справа-сзади — деревянные стены
export const GZ = { x0: -1.5, x1: 5.0, zN: -1.9, zS: 2.15 };

export const seatAngle = (i) => i * Math.PI / 2;
export const seatPos = (i) => new THREE.Vector3(Math.sin(seatAngle(i)) * SEAT_R, 0, Math.cos(seatAngle(i)) * SEAT_R);
export const seatYaw = (i) => seatAngle(i) + Math.PI;

export const ENV_I = 0.45;
export function mat(p = {}) {
  const keep = p.keep; delete p.keep;
  if (TOON && !keep && p.transmission === undefined && !(p.metalness >= 0.5)) return toonFrom(p);
  const phys = p.transmission !== undefined || p.clearcoat !== undefined || p.sheen !== undefined;
  const m = phys ? new THREE.MeshPhysicalMaterial(p) : new THREE.MeshStandardMaterial(p);
  if (p.envMapIntensity === undefined) m.envMapIntensity = ENV_I;
  return m;
}

function shadow(o, cast = true, recv = true) {
  o.traverse((c) => { if (c.isMesh) { c.castShadow = cast; c.receiveShadow = recv; } });
  return o;
}

function box(w, h, d, m, x = 0, y = 0, z = 0, parent) {
  const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  me.position.set(x, y, z);
  if (parent) parent.add(me);
  return me;
}

function jitter(geo, amt, seed = 1) {
  const r = T.rng(seed);
  const p = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!map.has(k)) map.set(k, [(r() - 0.5) * amt, (r() - 0.5) * amt, (r() - 0.5) * amt]);
    const d = map.get(k);
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildWorld(scene) {
  const W = { bulbs: [], flicker: [], bottles: [], lights: {} };

  // ---------- материалы ----------
  const woodDarkC = T.woodCanvas({ base: '#4a2c18', dark: '#1d0f06', light: '#7a4d2a', planks: 5, seed: 2 });
  const woodDark = mat({ map: T.toTex(woodDarkC, { repeat: [1, 1] }), bumpMap: T.toTex(T.bumpFrom(woodDarkC), { srgb: false }), bumpScale: 1.2, roughness: 0.78 });
  const beamC = T.woodCanvas({ w: 256, h: 1024, base: '#3a2213', dark: '#140a04', light: '#6b4526', planks: 1, gaps: false, seed: 9 });
  const beam = mat({ map: T.toTex(beamC), bumpMap: T.toTex(T.bumpFrom(beamC), { srgb: false }), bumpScale: 1.5, roughness: 0.8 });
  const wallC = T.woodCanvas({ w: 1024, h: 1024, base: '#6b4526', dark: '#2a160a', light: '#9a6a3c', planks: 8, seed: 4 });
  const wallTex = T.toTex(wallC, { repeat: [1.6, 1], rot: Math.PI / 2 });
  const wallWood = mat({ map: wallTex, bumpMap: T.toTex(T.bumpFrom(wallC), { srgb: false, repeat: [1.6, 1], rot: Math.PI / 2 }), bumpScale: 1.6, roughness: 0.72 });
  const roofC = T.woodCanvas({ w: 1024, h: 1024, base: '#3f2716', dark: '#140a04', light: '#6a4526', planks: 10, seed: 6 });
  const roofWood = mat({ map: T.toTex(roofC, { repeat: [1.5, 2] }), roughness: 0.85, side: THREE.DoubleSide });
  const pav = T.pavingCanvases();
  const floorMat = mat({
    map: T.toTex(pav.map, { repeat: [25, 25] }), bumpMap: T.toTex(pav.bump, { srgb: false, repeat: [25, 25] }), bumpScale: 3.5,
    roughness: 0.62, metalness: 0.0, color: '#d8dce2',
  });
  const slate = mat({ map: T.toTex(T.slateCanvas(), { repeat: [3, 1] }), roughness: 0.55, bumpMap: T.toTex(T.bumpFrom(T.slateCanvas()), { srgb: false, repeat: [3, 1] }), bumpScale: 2 });
  const blockWall = mat({ map: T.toTex(T.blockWallCanvas(), { repeat: [4, 1.6] }), roughness: 0.92 });
  const dark = mat({ color: '#141414', roughness: 0.6 });

  // ---------- небо ----------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(80, 48, 32), new THREE.MeshBasicMaterial({ map: T.toTex(T.skyCanvas()), side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.rotation.y = Math.PI * 0.5;
  scene.add(sky);
  scene.fog = new THREE.FogExp2('#1f1814', 0.018);

  // ---------- пол ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // ---------- беседка (по фото) ----------
  // Оси: игрок за игровым столом сидит спиной к деревянной стене (юг, +Z) и смотрит на север (−Z).
  // Фото 1 — взгляд полуналево: столб, дерево в клумбе, будка с X-дверью, рыжий забор, калитка.
  // Фото 2 — взгляд полунаправо: соседние столики, стойка с камнями у стены, верёвки на фоне
  // бежевой стены, а слева — двор с катушками, арочный забор и мурал.
  const gz = new THREE.Group();
  scene.add(gz);
  const H = 2.45;
  const X0 = GZ.x0, X1 = GZ.x1, ZN = GZ.zN, ZS = GZ.zS;
  const postTexs = [1, 2, 3, 4, 5, 6].map((s) => T.toTex(T.stickerPostCanvas(s)));
  const postGeo = new RoundedBoxGeometry(0.15, H, 0.15, 2, 0.015);
  // столбы: вдоль открытой северной стороны, углы у стен
  [[X0, ZN], [1.6, ZN], [X1, ZN], [X0, ZS - 0.08], [X1, ZS - 0.08], [X0, 0.1]].forEach(([x, z], i) => {
    const p = new THREE.Mesh(postGeo, mat({ map: postTexs[i % postTexs.length], roughness: 0.7 }));
    p.position.set(x, H / 2, z);
    gz.add(p);
  });
  // обвязка поверху
  const LX = X1 - X0, LZ = ZS - ZN, CX = (X0 + X1) / 2, CZ = (ZN + ZS) / 2;
  box(LX + 0.3, 0.2, 0.14, beam, CX, H, ZN, gz);
  box(LX + 0.3, 0.2, 0.14, beam, CX, H, ZS - 0.08, gz);
  box(0.14, 0.2, LZ + 0.2, beam, X0, H, CZ, gz);
  box(0.14, 0.2, LZ + 0.2, beam, X1, H, CZ, gz);
  // двускатная крыша: конёк вдоль X, снизу видны доски и стропила
  const ridgeY = 3.35, over = 0.4;
  const half = LZ / 2 + over;
  const slopeL = Math.hypot(half, ridgeY - H);
  const ang = Math.atan2(ridgeY - H, half);
  for (const s of [-1, 1]) {
    const pl = new THREE.Mesh(new THREE.BoxGeometry(LX + 0.9, 0.04, slopeL + 0.05), roofWood);
    pl.position.set(CX, (ridgeY + H) / 2 + 0.07, CZ + s * half / 2);
    pl.rotation.x = s * ang;
    gz.add(pl);
    for (let x = X0 - 0.3; x <= X1 + 0.31; x += 0.55) {
      const rf = box(0.07, 0.13, slopeL, beam, x, (ridgeY + H) / 2 - 0.02, CZ + s * half / 2, gz);
      rf.rotation.x = s * ang;
    }
  }
  box(LX + 0.9, 0.18, 0.12, beam, CX, ridgeY - 0.05, CZ, gz); // конёк
  for (const x of [X0 + 0.9, CX, X1 - 0.9]) box(0.1, 0.12, LZ, beam, x, H + 0.1, CZ, gz); // затяжки
  // фронтоны: треугольная ферма из тёмных досок
  const gShape = new THREE.Shape();
  gShape.moveTo(-half, 0); gShape.lineTo(half, 0); gShape.lineTo(0, ridgeY - H); gShape.closePath();
  const gableM = mat({ map: T.toTex(roofC, { repeat: [0.8, 0.6] }), roughness: 0.8, side: THREE.DoubleSide });
  for (const x of [X0 - 0.4, X1 + 0.4]) {
    const gm = new THREE.Mesh(new THREE.ShapeGeometry(gShape), gableM);
    gm.position.set(x, H + 0.1, CZ);
    gm.rotation.y = Math.PI / 2;
    gz.add(gm);
    box(0.09, ridgeY - H, 0.09, beam, x, (ridgeY + H) / 2 + 0.05, CZ, gz);
  }
  // водосток вдоль северного ската
  const gutterM = mat({ color: '#8d9094', roughness: 0.5 });
  const gutter = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, LX + 0.9, 12, 1, true, 0, Math.PI), gutterM);
  gutter.rotation.z = Math.PI / 2;
  gutter.position.set(CX, H + 0.02, ZN - over + 0.02);
  gutter.material.side = THREE.DoubleSide;
  gz.add(gutter);

  // деревянная стена сзади (юг) — во всю высоту: «за оператором просто деревянная стена»
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(LX + 0.3, H + 0.1, 0.08), wallWood);
  backWall.position.set(CX, (H + 0.1) / 2, ZS);
  gz.add(backWall);
  // стена на западном торце за спиной (от угла до среднего столба)
  const westBack = new THREE.Mesh(new THREE.BoxGeometry(0.08, H + 0.1, ZS - 0.1), wallWood);
  westBack.position.set(X0 - 0.04, (H + 0.1) / 2, (ZS + 0.1) / 2);
  gz.add(westBack);

  // стойка-ящик у стены справа: сверху камни и плющ (фото 2, справа)
  const counter = new THREE.Group();
  counter.position.set(3.95, 0, ZS - 0.27);
  gz.add(counter);
  box(2.0, 1.05, 0.42, wallWood, 0, 0.525, 0, counter);
  box(2.06, 0.05, 0.5, woodDark, 0, 1.075, 0, counter);
  const stoneM = mat({ color: '#b4ab9c', roughness: 0.85 });
  const r = T.rng(5);
  for (let i = 0; i < 12; i++) {
    const st = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(0.06 + r() * 0.07, 1), 0.04, i), stoneM);
    st.position.set(-0.2 + r() * 1.15, 1.13, (r() - 0.5) * 0.28);
    st.scale.y = 0.6;
    counter.add(st);
  }
  const ivyM = mat({ color: '#4f7d33', roughness: 0.7 });
  for (let i = 0; i < 36; i++) {
    const lf = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(0.045 + r() * 0.05, 0), 0.03, i + 50), ivyM);
    lf.position.set(-0.95 + r() * 0.55, 1.12 + r() * 0.28, (r() - 0.5) * 0.3);
    counter.add(lf);
  }
  // колонка под потолком на правой стене — из неё играет музыка бара (фото 2, вверху справа)
  W.speaker = buildSpeaker();
  W.speaker.position.set(X1 - 0.45, 1.98, ZS - 0.2);
  W.speaker.rotation.set(0.25, -1.98, 0, 'YXZ'); // смотрит на игровой стол
  gz.add(W.speaker);
  box(0.3, 0.04, 0.26, dark, X1 - 0.45, 1.96, ZS - 0.16, gz); // кронштейн

  // восточный торец: низкая стенка (сланец + доски), над ней шторка из верёвок, за ней бежевая стена
  const low = new THREE.Group();
  gz.add(low);
  box(0.26, 0.42, LZ - 0.1, slate, X1 + 0.02, 0.21, CZ - 0.02, low);
  const boardM = mat({ map: T.toTex(T.woodCanvas({ w: 1024, h: 256, base: '#6a4527', dark: '#2a160a', light: '#94643a', planks: 3, seed: 12 }), { repeat: [2, 1] }), roughness: 0.75 });
  box(0.1, 0.55, LZ - 0.1, boardM, X1 - 0.02, 0.69, CZ - 0.02, low);
  box(0.3, 0.05, LZ - 0.05, woodDark, X1 - 0.02, 0.985, CZ - 0.02, low);
  const ropeM = mat({ color: '#2a2622', roughness: 0.9 });
  const ropeGeo = new THREE.CylinderGeometry(0.004, 0.004, H - 1.05, 4);
  for (let z = ZN + 0.15; z < ZS - 0.15; z += 0.15) {
    const rope = new THREE.Mesh(ropeGeo, ropeM);
    rope.position.set(X1 + 0.06, 1.0 + (H - 1.05) / 2, z + (r() - 0.5) * 0.04);
    rope.rotation.x = (r() - 0.5) * 0.06;
    gz.add(rope);
  }

  // ---------- стол и стулья ----------
  W.table = buildTable(TABLE_R, woodDark);
  scene.add(W.table);
  W.chairs = [];
  for (let i = 0; i < 4; i++) {
    const ch = buildChair();
    const p = seatPos(i);
    ch.position.set(p.x * 1.02, 0, p.z * 1.02);
    ch.rotation.y = seatYaw(i);
    scene.add(ch);
    W.chairs.push(ch);
  }
  // соседние столики под навесом (фото 2): ближний и дальний у низкой стенки, венские стулья
  for (const [tx, tz, tr, chs] of [[2.45, 0.55, 0.46, [0.4, 1.75, 3.3, 4.85]], [3.95, -0.85, 0.43, [0.9, 2.5, 4.0, 5.6]]]) {
    const t = buildTable(tr, woodDark);
    t.position.set(tx, 0, tz);
    scene.add(t);
    chs.forEach((a) => {
      const ch = buildChair();
      ch.position.set(tx + Math.sin(a) * (tr + 0.36), 0, tz + Math.cos(a) * (tr + 0.36));
      ch.rotation.y = a + Math.PI;
      scene.add(ch);
      W.chairs.push(ch);
    });
  }
  // ---------- реквизит на игровом столе ----------
  W.ashtray = buildAshtray();
  W.ashtray.position.set(-0.12, TABLE_Y, 0.1);
  scene.add(W.ashtray);
  W.pack = buildPack();
  W.pack.position.set(0.2, TABLE_Y + 0.011, -0.16);
  W.pack.rotation.y = 0.5;
  scene.add(W.pack);
  const lighter = new THREE.Mesh(new RoundedBoxGeometry(0.025, 0.012, 0.075, 2, 0.005), mat({ color: '#f0b400', roughness: 0.3 }));
  lighter.position.set(0.3, TABLE_Y + 0.006, -0.05);
  lighter.rotation.y = -0.3;
  scene.add(lighter);

  const label = T.toTex(T.labelCanvas());
  for (let i = 0; i < 4; i++) {
    const b = buildBottle(label);
    const p = seatPos(i);
    const yaw = seatYaw(i);
    // справа от игрока, ближе к нему
    const local = new THREE.Vector3(0.27, TABLE_Y, 0.38);
    local.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    b.group.position.set(p.x + local.x, TABLE_Y, p.z + local.z);
    b.group.rotation.y = yaw + Math.PI;
    b.home = { pos: b.group.position.clone(), quat: b.group.quaternion.clone() };
    scene.add(b.group);
    W.bottles.push(b);
  }

  // ---------- двор ----------
  buildYard(scene, W, { slate, woodDark, beam, dark, blockWall });

  // ---------- свет ----------
  const hemi = new THREE.HemisphereLight('#9aa2cf', '#4a3522', TOON ? 1.25 : 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffb27a', 2.1);
  sun.position.set(-14, 6.5, -6);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 10, bottom: -6, near: 1, far: 40 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const key = new THREE.SpotLight('#ffd49a', 5.5, 6, 1.0, 0.9, 2);
  key.position.set(0, 2.42, 0.05);
  key.target.position.set(0, TABLE_Y, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 4;
  scene.add(key, key.target);
  const fill = new THREE.PointLight('#ff9d5c', 2.2, 7, 2);
  fill.position.set(-1.0, 2.1, 0.6);
  scene.add(fill);
  const back = new THREE.PointLight('#9fb0ff', 1.2, 8, 2);
  back.position.set(2.8, 2.2, 0.9);
  scene.add(back);
  W.lights = { hemi, sun, key, fill, back };

  // ---------- гирлянды: от северного свеса беседки во двор (фото 2) ----------
  const eaveZ = ZN - 0.38;
  const lines = [
    [[X0, H + 0.02, eaveZ], [X1, H + 0.02, eaveZ], 0.18],
    [[0.2, H + 0.02, eaveZ], [0.9, 3.1, -6.35], 0.55],
    [[2.4, H + 0.02, eaveZ], [3.6, 3.1, -6.3], 0.55],
    [[X1, H + 0.02, eaveZ], [5.3, 3.0, -5.6], 0.45],
    [[0.9, 3.1, -6.35], [3.6, 3.1, -6.3], 0.35],
    [[X0, H + 0.02, eaveZ], [-2.6, 3.4, -3.2], 0.3],
  ];
  buildStringLights(scene, W, lines);
  // тёплые точки двора
  for (const [x, y, z, i] of [[1.8, 2.7, -4.3, 2.4], [4.2, 2.6, -4.9, 2], [-2.9, 2.9, -2.6, 2], [-5.4, 3.1, -1.0, 2.2]]) {
    const pl = new THREE.PointLight('#ffb866', i, 8, 2);
    pl.position.set(x, y, z);
    scene.add(pl);
    W.flicker.push({ l: pl, base: i, ph: Math.random() * 10 });
  }
  shadow(gz, true, true);
  gz.traverse((c) => { if (c.isMesh && c.geometry.type === 'BoxGeometry' && c.material === roofWood) c.castShadow = true; });
  shadow(W.table, true, true);
  W.chairs.forEach((c) => shadow(c, true, true));
  // всё неподвижное сливаем по материалам: сотни вызовов отрисовки превращаются в десятки
  W.merge = mergeStatic(scene, { flatten: true, cell: 3, skipTrees: [W.speaker, ...W.bottles.map((b) => b.group)] });
  // бутылки и колонка двигаются целиком — внутри них тоже склеиваем всё, кроме анимируемых деталей
  W.bottles.forEach((b) => mergeStatic(b.group, { skip: new Set([b.liquid]) }));
  const su = W.speaker.userData;
  mergeStatic(W.speaker, { skip: new Set([su.cone, su.cap, su.led]) });
  return W;
}

function buildSpeaker() {
  const g = new THREE.Group();
  const cab = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.36, 0.22, 3, 0.02), mat({ color: '#18181a', roughness: 0.7 }));
  cab.position.y = 0.18;
  g.add(cab);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.33), mat({ color: '#0e0e10', roughness: 0.9 }));
  face.position.set(0, 0.18, 0.111);
  g.add(face);
  const ringM = mat({ color: '#3a3a3e', roughness: 0.4, metalness: 0.6 });
  const woofRing = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 8, 32), ringM);
  woofRing.position.set(0, 0.13, 0.113);
  g.add(woofRing);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.072, 0.035, 32, 1, true), mat({ color: '#2b2b2f', roughness: 0.85, side: THREE.DoubleSide }));
  cone.rotation.x = -Math.PI / 2;
  cone.position.set(0, 0.13, 0.1);
  g.add(cone);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat({ color: '#1c1c1f', roughness: 0.5 }));
  cap.rotation.x = Math.PI / 2;
  cap.position.set(0, 0.13, 0.103);
  g.add(cap);
  const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.01, 20), ringM);
  tw.rotation.x = Math.PI / 2;
  tw.position.set(0, 0.28, 0.113);
  g.add(tw);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshStandardMaterial({ color: '#60ff7a', emissive: '#40ff60', emissiveIntensity: 4 }));
  led.position.set(0.085, 0.03, 0.113);
  g.add(led);
  for (const x of [-0.09, 0.09]) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 10), ringM);
    foot.position.set(x, 0.005, 0);
    g.add(foot);
  }
  g.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  g.userData = { cone, cap, led };
  return g;
}

function buildTable(R, m) {
  const g = new THREE.Group();
  const topC = T.woodCanvas({ w: 1024, h: 1024, base: '#6b3f1f', dark: '#2a1407', light: '#a26a38', planks: 6, seed: 17, scratches: 140, knots: 0.7 });
  const topM = mat({
    map: T.toTex(topC), bumpMap: T.toTex(T.bumpFrom(topC), { srgb: false }), bumpScale: 0.8,
    roughness: 0.32, clearcoat: 0.55, clearcoatRoughness: 0.28,
  });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.045, 72), [mat({ color: '#3d220f', roughness: 0.5 }), topM, topM]);
  top.position.y = TABLE_Y - 0.0225;
  g.add(top);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(R, 0.024, 12, 96), mat({ color: '#4a2a14', roughness: 0.4, clearcoat: 0.4 }));
  edge.rotation.x = Math.PI / 2;
  edge.position.y = TABLE_Y - 0.022;
  g.add(edge);
  const iron = mat({ color: '#141312', roughness: 0.5, metalness: 0.6 });
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, TABLE_Y - 0.08, 20), iron);
  col.position.y = (TABLE_Y - 0.08) / 2 + 0.03;
  g.add(col);
  for (let i = 0; i < 4; i++) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, R * 0.72), iron);
    leg.position.set(Math.sin(i * Math.PI / 2 + 0.78) * R * 0.34, 0.03, Math.cos(i * Math.PI / 2 + 0.78) * R * 0.34);
    leg.rotation.y = i * Math.PI / 2 + 0.78;
    g.add(leg);
  }
  return g;
}

// Венский стул (гнутое дерево), сидящий смотрит в +Z
let chairMat;
function buildChair() {
  chairMat = chairMat || mat({ color: '#5a371f', roughness: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.4, map: T.toTex(T.woodCanvas({ w: 256, h: 512, base: '#6a4224', dark: '#2a160a', light: '#8c5a33', planks: 1, gaps: false, seed: 33 })) });
  const m = chairMat;
  const g = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.215, 0.035, 40), m);
  seat.position.y = 0.46;
  g.add(seat);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.018, 10, 48), m);
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.435;
  g.add(rim);
  const legGeo = new THREE.CylinderGeometry(0.017, 0.013, 0.46, 10);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const leg = new THREE.Mesh(legGeo, m);
    leg.position.set(Math.sin(a) * 0.17, 0.225, Math.cos(a) * 0.17);
    leg.rotation.set(Math.cos(a) * 0.1, 0, -Math.sin(a) * 0.1);
    g.add(leg);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.01, 8, 40), m);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.17;
  g.add(ring);
  // спинка — дуга сзади
  const back = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 10, 40, Math.PI * 1.25), m);
  back.rotation.set(Math.PI / 2, 0, Math.PI * 0.875);
  back.position.set(0, 0.74, 0.01);
  g.add(back);
  for (const x of [-0.19, -0.07, 0.07, 0.19]) {
    const z = -Math.sqrt(Math.max(0, 0.22 * 0.22 - x * x));
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.28, 8), m);
    sp.position.set(x, 0.6, z);
    g.add(sp);
  }
  // подлокотники
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.22, 8), m);
    arm.position.set(s * 0.215, 0.6, 0.06);
    arm.rotation.x = -0.35;
    g.add(arm);
  }
  return g;
}

function buildAshtray() {
  const pts = [[0.0, 0.0], [0.07, 0.0], [0.078, 0.004], [0.08, 0.022], [0.074, 0.024], [0.07, 0.008], [0.0, 0.008]].map(([x, y]) => new THREE.Vector2(x, y));
  const m = mat({ color: '#b7bbc0', roughness: 0.32, metalness: 1, envMapIntensity: 0.9 });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 40), m));
  g.userData.butts = [];
  return g;
}

function buildPack() {
  const tex = T.toTex(T.packCanvas());
  const side = mat({ color: '#a3121b', roughness: 0.45, clearcoat: 0.3 });
  const face = mat({ map: tex, roughness: 0.4, clearcoat: 0.4 });
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.022, 0.086), [side, side, face, side, side, side]);
  g.add(b);
  return g;
}

export function buildBottle(labelTex) {
  const group = new THREE.Group();
  const glassM = mat({
    color: '#fff3e6', transmission: 1, roughness: 0.03, thickness: 0.05, ior: 1.5,
    attenuationColor: '#e39a55', attenuationDistance: 0.4, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2,
  });
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.155, 0.056, 5, 0.022), glassM);
  body.position.y = 0.0775;
  group.add(body);
  const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.06, 0.04, 32), glassM);
  shoulder.scale.z = 0.47;
  shoulder.position.y = 0.175;
  group.add(shoulder);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.04, 20), glassM);
  neck.position.y = 0.215;
  group.add(neck);
  const capM = mat({ color: '#5a3017', roughness: 0.35, metalness: 0.4, clearcoat: 0.6 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 24), capM);
  cap.position.y = 0.25;
  group.add(cap);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0205, 0.0205, 0.012, 24), mat({ color: '#c79a47', metalness: 1, roughness: 0.3 }));
  band.position.y = 0.232;
  group.add(band);
  // жидкость
  const liqGeo = new THREE.BoxGeometry(0.104, 0.14, 0.042);
  liqGeo.translate(0, 0.07, 0);
  const liqM = mat({ keep: true, color: '#7a3510', roughness: 0.08, emissive: '#5a2206', emissiveIntensity: 0.35, clearcoat: 1 });
  const liquid = new THREE.Mesh(liqGeo, liqM);
  liquid.position.y = 0.008;
  group.add(liquid);
  // этикетки с двух сторон
  const lm = mat({ map: labelTex, roughness: 0.5, transparent: true });
  for (const s of [1, -1]) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.094, 0.118), lm);
    l.position.set(0, 0.078, s * 0.0292);
    if (s < 0) l.rotation.y = Math.PI;
    group.add(l);
  }
  group.traverse((c) => { if (c.isMesh) c.castShadow = true; });
  return {
    group, liquid, liqM, level: 1,
    setLevel(v) { this.level = v; liquid.scale.y = Math.max(0.001, v); liquid.visible = v > 0.01; },
    poison() { liqM.color.set('#5f8f1a'); liqM.emissive.set('#3f6a0a'); },
    reset() { liqM.color.set('#7a3510'); liqM.emissive.set('#5a2206'); this.setLevel(1); },
  };
}

function buildStringLights(scene, W, lines) {
  const wireM = new THREE.MeshBasicMaterial({ color: '#0b0908' });
  const pts = [];
  for (const [a, b, sag] of lines) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const curvePts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const p = A.clone().lerp(B, t);
      p.y -= Math.sin(t * Math.PI) * sag;
      curvePts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(curvePts);
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.005, 4), wireM));
    const n = Math.round(A.distanceTo(B) / 0.45);
    for (let i = 1; i < n; i++) pts.push(curve.getPoint(i / n));
  }
  const bulbGeo = new THREE.SphereGeometry(0.034, 12, 10);
  const bulbM = new THREE.MeshStandardMaterial({ color: '#fff1d6', emissive: '#ffbf6e', emissiveIntensity: 6, roughness: 0.3 });
  const inst = new THREE.InstancedMesh(bulbGeo, bulbM, pts.length);
  const m4 = new THREE.Matrix4();
  pts.forEach((p, i) => { m4.makeTranslation(p.x, p.y - 0.05, p.z); inst.setMatrixAt(i, m4); });
  scene.add(inst);
  const sockM = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.6 });
  const sock = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.014, 0.014, 0.04, 8), sockM, pts.length);
  pts.forEach((p, i) => { m4.makeTranslation(p.x, p.y - 0.015, p.z); sock.setMatrixAt(i, m4); });
  scene.add(sock);
  W.bulbM = bulbM;
}

function buildYard(scene, W, { slate, woodDark, beam, dark, blockWall }) {
  const r = T.rng(71);
  const { x0: X0, x1: X1, zN: ZN } = GZ;
  const FZ = -6.8; // северная граница двора (заборы)

  // ---------- бежевая соседская стена (восток): видна за верёвками и во дворе, на ней мурал ----------
  const neighbour = new THREE.Mesh(new THREE.BoxGeometry(6, 6.5, 15.6), mat({ map: T.toTex(T.blockWallCanvas(), { repeat: [7, 7] }), roughness: 0.92 }));
  neighbour.position.set(X1 + 0.45 + 3, 3.25, -0.2);
  scene.add(neighbour);
  // мурал: бородач в наушниках, в раме, над низкой сланцевой стенкой
  const mz = -4.35;
  const mural = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 1.85), mat({ map: T.toTex(T.muralCanvas()), roughness: 0.8 }));
  mural.position.set(X1 + 0.43, 1.62, mz);
  mural.rotation.y = -Math.PI / 2;
  scene.add(mural);
  const frameM = mat({ color: '#e9e4da', roughness: 0.6 });
  for (const [dy, dz, h, w] of [[0.95, 0, 0.05, 3.42], [-0.95, 0, 0.05, 3.42], [0, 1.7, 1.95, 0.05], [0, -1.7, 1.95, 0.05]]) {
    scene.add(box(0.04, h, w, frameM, X1 + 0.44, 1.62 + dy, mz + dz));
  }

  // ---------- низкая сланцевая стенка с деревянным верхом вдоль забора и под муралом ----------
  const capM = woodDark;
  const lowN = box(X1 + 0.45 - 0.2, 0.52, 0.3, slate, (0.2 + X1 + 0.45) / 2, 0.26, FZ + 0.32);
  scene.add(lowN, box(X1 + 0.45 - 0.2, 0.05, 0.42, capM, (0.2 + X1 + 0.45) / 2, 0.545, FZ + 0.35));
  const eL = (ZN - 0.4) - (FZ + 0.47), eC = (ZN - 0.4 + FZ + 0.47) / 2;
  const lowE = box(0.3, 0.52, eL, slate, X1 + 0.28, 0.26, eC);
  scene.add(lowE, box(0.42, 0.05, eL, capM, X1 + 0.25, 0.545, eC));
  shadow(lowN); shadow(lowE);

  // ---------- тёмный забор с арочным верхом (север, правее проезда) ----------
  const fenceM = mat({ map: T.toTex(T.woodCanvas({ w: 512, h: 512, base: '#2f2622', dark: '#110b08', light: '#4a3b33', planks: 1, gaps: false, seed: 61 })), roughness: 0.8 });
  const fx0 = 0.2, fx1 = X1 + 0.45, span = 1.75;
  for (let x = fx0; x < fx1 - 0.05; x += 0.13) {
    const t = ((x - fx0) % span) / span;
    const h = 1.75 + Math.sin(t * Math.PI) * 0.3;
    const b = box(0.12, h, 0.03, fenceM, x + 0.065, h / 2, FZ);
    b.castShadow = true;
    scene.add(b);
  }
  scene.add(box(fx1 - fx0, 0.07, 0.05, fenceM, (fx0 + fx1) / 2, 0.55, FZ + 0.03));
  scene.add(box(fx1 - fx0, 0.07, 0.05, fenceM, (fx0 + fx1) / 2, 1.45, FZ + 0.03));
  for (let x = fx0; x <= fx1 + 0.01; x += span) scene.add(box(0.1, 2.15, 0.1, fenceM, x, 1.07, FZ + 0.05));

  // ---------- проезд, серая калитка и рыжий забор (левее, фото 1) ----------
  const gateM = mat({ color: '#6c7076', roughness: 0.55, metalness: 0.35 });
  for (let x = -2.75; x < -1.95; x += 0.1) scene.add(box(0.08, 2.1, 0.03, gateM, x + 0.05, 1.05, FZ));
  scene.add(box(0.85, 0.06, 0.05, gateM, -2.33, 0.3, FZ + 0.03), box(0.85, 0.06, 0.05, gateM, -2.33, 1.9, FZ + 0.03));
  const redM = mat({ map: T.toTex(T.woodCanvas({ w: 512, h: 512, base: '#7a3e2a', dark: '#3a1a10', light: '#a5623f', planks: 1, gaps: false, seed: 63 })), roughness: 0.8 });
  for (let x = -7.9; x < -2.8; x += 0.14) {
    const b = box(0.13, 1.95, 0.03, redM, x + 0.07, 0.975, FZ);
    b.castShadow = true;
    scene.add(b);
  }
  scene.add(box(5.1, 0.07, 0.05, redM, -5.35, 0.5, FZ + 0.03), box(5.1, 0.07, 0.05, redM, -5.35, 1.55, FZ + 0.03));
  // за проездом — улица: асфальт и светлый дом
  const street = new THREE.Mesh(new THREE.PlaneGeometry(40, 10), mat({ color: '#3b3b3d', roughness: 0.95 }));
  street.rotation.x = -Math.PI / 2;
  street.position.set(-2, 0.004, FZ - 5.2);
  street.receiveShadow = true;
  scene.add(street);

  // ---------- катушки-столы во дворе (три, фото 2; одна видна и на фото 1) ----------
  const spoolWood = mat({ map: T.toTex(T.woodCanvas({ w: 512, h: 512, base: '#5f5a55', dark: '#2a2622', light: '#8a837b', planks: 6, seed: 44 })), roughness: 0.85 });
  const spoolTop = mat({ color: '#d4d0c6', roughness: 0.4, metalness: 0.1 });
  for (const [x, z] of [[0.7, -5.3], [2.6, -5.35], [3.95, -4.0]]) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 40), [spoolWood, spoolTop, spoolWood]);
    top.position.y = 0.98; g.add(top);
    const bot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 40), spoolWood);
    bot.position.y = 0.03; g.add(bot);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.9, 24), spoolWood);
    core.position.y = 0.5; g.add(core);
    for (let i = 0; i < 10; i++) {
      const sl = box(0.08, 0.9, 0.025, spoolWood, Math.sin(i * 0.628) * 0.275, 0.5, Math.cos(i * 0.628) * 0.275, g);
      sl.rotation.y = i * 0.628;
    }
    g.position.set(x, 0, z);
    g.rotation.y = r() * 3;
    shadow(g);
    scene.add(g);
  }

  // ---------- запад: клумба с деревом, камни, каменная скамья-стенка ----------
  const gravel = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 5.2), mat({ map: T.toTex(gravelCanvas(), { repeat: [2, 4] }), roughness: 1 }));
  gravel.rotation.x = -Math.PI / 2;
  gravel.position.set(-3.15, 0.03, -0.65);
  gravel.receiveShadow = true;
  scene.add(gravel);
  // скамья-стенка из сланца с доской сверху — сразу слева от игрового стола
  const bench = box(0.36, 0.55, 3.2, slate, -2.0, 0.275, 0.3);
  scene.add(bench, box(0.5, 0.06, 3.3, woodDark, -2.0, 0.58, 0.3));
  scene.add(box(2.3, 0.3, 0.28, slate, -3.15, 0.15, -3.25)); // бортик клумбы
  shadow(bench);
  // груда светлых камней у дерева
  const rockM = mat({ color: '#a79e91', roughness: 0.9 });
  for (let i = 0; i < 9; i++) {
    const rk = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(0.12 + r() * 0.12, 1), 0.08, i + 90), rockM);
    rk.position.set(-3.35 + (r() - 0.5) * 0.6, 0.08 + r() * 0.12, -0.55 + (r() - 0.5) * 0.6);
    rk.scale.y = 0.7;
    shadow(rk);
    scene.add(rk);
  }
  // старое корявое дерево (акация/глициния): толстый витой ствол, ветки над крышей
  const barkTex = T.toTex(T.barkCanvas(), { repeat: [2, 3] });
  const bark = mat({ map: barkTex, bumpMap: T.toTex(T.bumpFrom(T.barkCanvas()), { srgb: false, repeat: [2, 3] }), bumpScale: 4, roughness: 0.95 });
  const tree = new THREE.Group();
  const trunkCurve = new THREE.CatmullRomCurve3([
    V3(0, 0, 0), V3(0.08, 0.8, 0.04), V3(-0.06, 1.7, 0.1), V3(0.12, 2.6, -0.05), V3(0.05, 3.5, 0.15), V3(-0.1, 4.4, 0.05),
  ]);
  tree.add(new THREE.Mesh(new THREE.TubeGeometry(trunkCurve, 48, 0.26, 16), bark));
  // жилы-лианы вокруг ствола
  for (let k = 0; k < 5; k++) {
    const a0 = k * 1.26;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, p = trunkCurve.getPoint(t * 0.8), a = a0 + t * 2.2;
      pts.push(V3(p.x + Math.cos(a) * 0.25, p.y, p.z + Math.sin(a) * 0.25));
    }
    tree.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.045, 6), bark));
  }
  const leafMs = ['#6e9a3a', '#86b04a', '#9cc254'].map((c) => mat({ color: c, roughness: 0.75 }));
  for (const [a, h, l] of [[0.3, 2.8, 1.9], [1.9, 3.3, 1.6], [3.4, 3.0, 1.5], [4.9, 3.6, 1.7], [0.9, 4.0, 1.2]]) {
    const c = new THREE.CatmullRomCurve3([
      trunkCurve.getPoint(h / 4.6), V3(Math.cos(a) * l * 0.5, h + 0.45, Math.sin(a) * l * 0.5), V3(Math.cos(a) * l, h + 0.6, Math.sin(a) * l),
    ]);
    tree.add(new THREE.Mesh(new THREE.TubeGeometry(c, 12, 0.07, 8), bark));
    // перистые листья свисают гроздьями
    for (let i = 0; i < 7; i++) {
      const p = c.getPoint(0.35 + r() * 0.65);
      const lf = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(0.28 + r() * 0.3, 1), 0.2, i + a * 10), leafMs[i % 3]);
      lf.position.set(p.x + (r() - 0.5) * 0.6, p.y - 0.1 - r() * 0.5, p.z + (r() - 0.5) * 0.6);
      lf.scale.set(1, 0.6 + r() * 0.5, 1);
      tree.add(lf);
    }
  }
  tree.position.set(-2.85, 0, -1.55);
  shadow(tree);
  scene.add(tree);

  // ---------- запад дальше: каменный цоколь, будка с X-дверью, балка в стикерах ----------
  const plat = box(3.4, 1.05, 7.0, slate, -6.0, 0.525, -1.1);
  scene.add(plat);
  shadow(plat);
  const pipeM = mat({ color: '#5a3a28', roughness: 0.5 });
  const pipeC = new THREE.CatmullRomCurve3([V3(-4.26, 0.98, 1.9), V3(-4.26, 0.72, 0.4), V3(-4.25, 0.62, -0.2), V3(-4.1, 0.5, -0.45), V3(-4.05, 0.05, -0.5)]);
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(pipeC, 30, 0.035, 8), pipeM));
  const boothWood = mat({ map: T.toTex(T.woodCanvas({ w: 1024, h: 1024, base: '#8a6a44', dark: '#3a2814', light: '#b08a5a', planks: 9, seed: 71 }), { rot: Math.PI / 2, repeat: [1.5, 1] }), roughness: 0.75 });
  const boothWall = box(0.1, 2.3, 4.2, boothWood, -5.3, 1.05 + 1.15, -1.3);
  scene.add(boothWall);
  // X-распорка на стене
  const xM = mat({ color: '#3a2a1a', roughness: 0.8 });
  for (const s of [-1, 1]) {
    const d = box(0.05, 0.07, Math.hypot(2.0, 3.4), xM, -5.24, 2.2, -1.3);
    d.rotation.x = s * Math.atan2(2.0, 3.4);
    scene.add(d);
  }
  for (const z of [-3.4, 0.8]) scene.add(box(0.16, 2.4, 0.16, beam, -5.25, 2.25, z));
  // свес будки: балка и доски, обклеенные стикерами
  const stickerBeam = mat({ map: T.toTex(T.stickerPostCanvas(9), { rot: Math.PI / 2 }), roughness: 0.7 });
  scene.add(box(0.2, 0.22, 4.6, stickerBeam, -4.55, 3.4, -1.3));
  const eave = box(1.2, 0.05, 4.8, beam, -4.9, 3.55, -1.3);
  eave.rotation.z = -0.12;
  scene.add(eave);
  // кирпичная тумба справа от будки (светлый кирпич)
  scene.add(box(0.55, 2.4, 0.55, mat({ map: T.toTex(T.blockWallCanvas(8), { repeat: [0.4, 1] }), color: '#d8c3a0', roughness: 0.95 }), -5.25, 2.25, 1.35));
  // западная граница: высокая оштукатуренная стена
  const plaster = mat({ map: T.toTex(T.blockWallCanvas(8), { repeat: [3, 1] }), color: '#e9e0cf', roughness: 0.95 });
  scene.add(box(0.3, 3.8, 11, plaster, -8.1, 1.9, -1.5));
  // за стеной беседки (юг) — такой же глухой забор, чтобы в щелях не было пустоты
  scene.add(box(15, 2.8, 0.2, plaster, -1, 1.4, GZ.zS + 1.6));

  // ---------- деревья за заборами ----------
  const pineMs = ['#1c3526', '#233f2c', '#2a4a30'].map((c) => mat({ color: c, roughness: 0.9 }));
  const pines = [[-6.5, -8.6], [-4.8, -9.4], [1.8, -8.4], [3.4, -9.2], [5.2, -8.5], [-0.8, -10.5], [6.8, -10.4], [-9.5, -9], [-10.5, -4]];
  pines.forEach(([x, z], k) => {
    const g = new THREE.Group();
    const h = 6 + r() * 4;
    for (let i = 0; i < 6; i++) {
      const cone = new THREE.Mesh(jitter(new THREE.ConeGeometry(1.5 - i * 0.2, h * 0.34, 9, 2), 0.35, k * 10 + i), pineMs[(k + i) % 3]);
      cone.position.y = 1.2 + i * h * 0.13;
      g.add(cone);
    }
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.4, 8), bark);
    tr.position.y = 0.7; g.add(tr);
    g.position.set(x, 0, z);
    g.scale.setScalar(0.8 + r() * 0.4);
    shadow(g, true, false);
    scene.add(g);
  });
  // туя у калитки
  const thuja = new THREE.Mesh(jitter(new THREE.SphereGeometry(0.9, 14, 10), 0.3, 5), pineMs[2]);
  thuja.scale.set(0.9, 1.6, 0.9);
  thuja.position.set(-1.2, 1.3, FZ - 1.1);
  shadow(thuja);
  scene.add(thuja);

  // ---------- светлые дома за проездом ----------
  const [fc, fg] = T.canvas(512, 512);
  fg.fillStyle = '#d9d6cf'; fg.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) {
    const lit = r() < 0.4;
    fg.fillStyle = lit ? '#ffc877' : '#3a3d45';
    fg.fillRect(40 + x * 120, 50 + y * 160, 70, 100);
    fg.strokeStyle = '#f4f1ea'; fg.lineWidth = 6; fg.strokeRect(40 + x * 120, 50 + y * 160, 70, 100);
    fg.beginPath(); fg.moveTo(75 + x * 120, 50 + y * 160); fg.lineTo(75 + x * 120, 150 + y * 160); fg.stroke();
  }
  T.grain(fg, 512, 512, 14, 3);
  const facadeTex = T.toTex(fc);
  const houseM = mat({ map: facadeTex, emissiveMap: facadeTex, emissive: '#ffffff', emissiveIntensity: 0.25, roughness: 0.9 });
  const house = new THREE.Mesh(new THREE.BoxGeometry(9, 7.5, 7), houseM);
  house.position.set(-4.5, 3.75, FZ - 13);
  scene.add(house);
  const house2 = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 7), houseM);
  house2.position.set(-14, 4, -8);
  scene.add(house2);
}

function V3(x, y, z) { return new THREE.Vector3(x, y, z); }

function gravelCanvas() {
  const [c, g] = T.canvas(256, 256);
  const r = T.rng(31);
  g.fillStyle = '#4a4744'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const v = 70 + r() * 120;
    g.fillStyle = `rgb(${v},${v - 4},${v - 8})`;
    g.beginPath(); g.ellipse(r() * 256, r() * 256, 1.5 + r() * 3.5, 1 + r() * 2.5, r() * 3, 0, 6.283); g.fill();
  }
  return c;
}
