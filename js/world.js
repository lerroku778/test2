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
// вход во двор — калитка в дальнем левом (северо-западном) углу; каменный цоколь с будкой — слева
// Размеры сняты с фото 1: калитка ≈ в 6,5–7 м от глаз игрока (≈3,5 м за столбом),
// слева за каменной стенкой — лестница вниз в бар.
const GATE = { x0: -2.65, x1: -1.8 };
const FENCE_Z = -5.6;
const STAIR = { x0: -5.3, x1: -3.9, z0: -3.4, z1: 1.9 }; // проём лестницы в подвал
const PLAT = { x0: -7.0, x1: -5.3, z0: -3.7, z1: 2.4 }; // цоколь будки за лестницей
const PBY = 0.34; // высота гравия в клумбе (дерево растёт из неё)
// Где стоит игровой стол (в координатах навеса) и какие столики стоят вокруг
export const TABLES = ['center', 'counter', 'ropes'];
export const TABLE_NAMES = { center: 'Центральный', counter: 'У стойки', ropes: 'У верёвок' };
const LAYOUT = {
  center: { at: [0, 0], decor: [[2.45, 0.55, 0.46, [0.4, 1.75, 3.3, 4.85]], [3.95, -0.85, 0.43, [0.9, 2.5, 4.0, 5.6]]] },
  counter: { at: [2.6, 0.45], decor: [[0.1, 0.15, 0.46, [0.3, 1.9, 3.5, 5.0]], [4.1, -1.1, 0.4, [2.4, 3.9, 5.4]]] },
  ropes: { at: [3.55, -0.6], decor: [[0.0, 0.0, 0.46, [0.3, 1.9, 3.5, 5.0]], [1.3, 1.2, 0.42, [0.8, 2.3, 3.9, 5.4]]] },
};

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

export function buildWorld(root) {
  const W = { bulbs: [], flicker: [], bottles: [], lights: {} };
  // Окружение (навес, двор, соседние столики) — отдельная группа: при выборе другого
  // столика она сдвигается так, чтобы игровой стол всегда стоял в начале координат.
  const scene = new THREE.Group();
  root.add(scene);
  W.env = scene;
  const game = new THREE.Group(); // игровой стол, стулья, реквизит
  root.add(game);

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
  root.add(sky);
  W.sky = sky;
  root.fog = new THREE.FogExp2('#1f1814', 0.018);

  // ---------- пол: брусчатка с проёмом под лестницу в подвальный бар ----------
  const fs = new THREE.Shape();
  fs.moveTo(-30, -30); fs.lineTo(30, -30); fs.lineTo(30, 30); fs.lineTo(-30, 30); fs.closePath();
  const hole = new THREE.Path();
  // форма лежит в XY, после поворота на −90° по X ось Y формы смотрит в −Z мира
  hole.moveTo(STAIR.x0, -STAIR.z1); hole.lineTo(STAIR.x0, -STAIR.z0); hole.lineTo(STAIR.x1, -STAIR.z0); hole.lineTo(STAIR.x1, -STAIR.z1); hole.closePath();
  fs.holes.push(hole);
  floorMat.map.repeat.set(25 / 60, 25 / 60); floorMat.bumpMap.repeat.set(25 / 60, 25 / 60);
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(fs), floorMat);
  W.floorMat = floorMat;
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
  [[X0, ZN], [1.6, ZN], [X1, ZN], [X0, ZS - 0.08], [X1, ZS - 0.08]].forEach(([x, z], i) => {
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
  // слева (запад) навес открыт на клумбу с деревом; у юго-западного угла — кусок
  // деревянной стены, чтобы за клумбой не было видно пустого двора
  const halfW = new THREE.Mesh(new THREE.BoxGeometry(0.08, H + 0.1, ZS - 0.55), wallWood);
  halfW.position.set(X0 - 0.04, (H + 0.1) / 2, (ZS + 0.55) / 2);
  gz.add(halfW);

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

  // ---------- игровой стол и стулья (всегда в начале координат) ----------
  W.table = buildTable(TABLE_R, woodDark);
  game.add(W.table);
  W.chairs = [];
  for (let i = 0; i < 4; i++) {
    const ch = buildChair();
    const p = seatPos(i);
    ch.position.set(p.x * 1.02, 0, p.z * 1.02);
    ch.rotation.y = seatYaw(i);
    game.add(ch);
    W.chairs.push(ch);
  }
  // соседние столики с венскими стульями: свой набор для каждого выбора игрового стола
  W.decor = {};
  for (const [name, L] of Object.entries(LAYOUT)) {
    const g = new THREE.Group();
    g.visible = false;
    scene.add(g);
    W.decor[name] = g;
    for (const [tx, tz, tr, chs] of L.decor) {
      const t = buildTable(tr, woodDark);
      t.position.set(tx, 0, tz);
      g.add(t);
      chs.forEach((a) => {
        const ch = buildChair();
        ch.position.set(tx + Math.sin(a) * (tr + 0.36), 0, tz + Math.cos(a) * (tr + 0.36));
        ch.rotation.y = a + Math.PI;
        g.add(ch);
      });
    }
    shadow(g, true, true);
  }
  // ---------- реквизит на игровом столе ----------
  W.ashtray = buildAshtray();
  W.ashtray.position.set(-0.12, TABLE_Y, 0.1);
  game.add(W.ashtray);
  W.pack = buildPack();
  W.pack.position.set(0.2, TABLE_Y + 0.011, -0.16);
  W.pack.rotation.y = 0.5;
  game.add(W.pack);
  const lighter = new THREE.Mesh(new RoundedBoxGeometry(0.025, 0.012, 0.075, 2, 0.005), mat({ color: '#f0b400', roughness: 0.3 }));
  lighter.position.set(0.3, TABLE_Y + 0.006, -0.05);
  lighter.rotation.y = -0.3;
  game.add(lighter);

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
    game.add(b.group);
    W.bottles.push(b);
  }

  // ---------- двор ----------
  buildYard(scene, W, { slate, woodDark, beam, dark, blockWall });

  // ---------- свет ----------
  const hemi = new THREE.HemisphereLight('#9aa2cf', '#4a3522', TOON ? 1.25 : 0.9);
  root.add(hemi);
  const sun = new THREE.DirectionalLight('#ffb27a', 2.1);
  sun.position.set(-14, 6.5, -6);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 10, bottom: -6, near: 1, far: 40 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  root.add(sun, sun.target);
  const key = new THREE.SpotLight('#ffd49a', 5.5, 6, 1.0, 0.9, 2);
  key.position.set(0, 2.42, 0.05);
  key.target.position.set(0, TABLE_Y, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 4;
  root.add(key, key.target);
  const fill = new THREE.PointLight('#ff9d5c', 2.2, 7, 2);
  fill.position.set(-1.0, 2.1, 0.6);
  scene.add(fill);
  const back = new THREE.PointLight('#9fb0ff', 1.2, 8, 2);
  back.position.set(2.8, 2.2, 0.9);
  scene.add(back);
  W.lights = { hemi, sun, key, fill, back };
  W.setTime = (tod) => setTime(W, root, tod);
  W.setWeather = (wx) => { W.wx = wx === 'rain' ? 'rain' : 'clear'; setTime(W, root, W.tod); };
  // где крыша навеса (в мировых координатах) — под ней дождь не идёт
  W.roofRect = () => ({ x0: GZ.x0 - 0.45 + scene.position.x, x1: GZ.x1 + 0.45 + scene.position.x, z0: GZ.zN - 0.45 + scene.position.z, z1: GZ.zS + 0.2 + scene.position.z });
  W.setLayout = (name) => {
    const L = LAYOUT[name] ? name : 'center';
    W.layout = L;
    scene.position.set(-LAYOUT[L].at[0], 0, -LAYOUT[L].at[1]);
    for (const [k, g] of Object.entries(W.decor)) g.visible = k === L;
    scene.updateMatrixWorld(true);
  };

  // ---------- гирлянды: от северного свеса беседки во двор (фото 2) ----------
  const eaveZ = ZN - 0.38;
  const lines = [
    [[X0, H + 0.02, eaveZ], [X1, H + 0.02, eaveZ], 0.18],
    [[0.2, H + 0.02, eaveZ], [0.9, 3.1, FENCE_Z + 0.5], 0.45],
    [[2.4, H + 0.02, eaveZ], [3.6, 3.1, FENCE_Z + 0.5], 0.45],
    [[X1, H + 0.02, eaveZ], [5.15, 3.1, FENCE_Z + 0.9], 0.35],
    [[0.9, 3.1, FENCE_Z + 0.5], [3.6, 3.1, FENCE_Z + 0.5], 0.35],
    [[X0, H + 0.02, eaveZ], [-2.6, 3.4, -3.2], 0.3],
  ];
  buildStringLights(scene, W, lines);
  // тёплые точки двора
  for (const [x, y, z, i] of [[1.8, 2.7, -3.8, 2.4], [4.2, 2.6, -4.2, 2], [-2.9, 2.9, -2.6, 2], [-4.6, 2.9, -1.0, 2.2]]) {
    const pl = new THREE.PointLight('#ffb866', i, 8, 2);
    pl.position.set(x, y, z);
    scene.add(pl);
    W.flicker.push({ l: pl, base: i, base0: i, ph: Math.random() * 10 });
  }
  shadow(gz, true, true);
  gz.traverse((c) => { if (c.isMesh && c.material === roofWood) { c.castShadow = true; c.receiveShadow = false; } });
  shadow(W.table, true, true);
  W.chairs.forEach((c) => shadow(c, true, true));
  W.setTime('evening');
  // всё неподвижное сливаем по материалам: сотни вызовов отрисовки превращаются в десятки
  const decor = Object.values(W.decor);
  W.merge = mergeStatic(scene, { flatten: true, cell: 3, skipTrees: [W.speaker, ...decor] });
  decor.forEach((g) => mergeStatic(g, { flatten: true }));
  mergeStatic(game, { flatten: true, skipTrees: W.bottles.map((b) => b.group) });
  W.setLayout('center');
  // бутылки и колонка двигаются целиком — внутри них тоже склеиваем всё, кроме анимируемых деталей
  W.bottles.forEach((b) => mergeStatic(b.group, { skip: new Set([b.liquid]) }));
  const su = W.speaker.userData;
  mergeStatic(W.speaker, { skip: new Set([su.cone, su.cap, su.led]) });
  return W;
}

// ---------- время суток ----------
export const TODS = ['day', 'evening', 'night'];
export const TOD_NAMES = { day: 'День', evening: 'Вечер', night: 'Ночь' };
const TOD = {
  day: {
    bg: '#9fb8cc', fog: ['#b9c3c9', 0.011], hemi: ['#cfe0ff', '#7a6650', 1.6, 1.15], sun: ['#fff1dc', 3.2, [-9, 16, -7]],
    key: 2.6, fill: 0.7, back: 0.7, bulbs: 1.0, flicker: 0.12, windows: 0, exposure: 0.92,
  },
  evening: {
    bg: '#0c0907', fog: ['#1f1814', 0.018], hemi: ['#9aa2cf', '#4a3522', 1.25, 0.9], sun: ['#ffb27a', 2.1, [-14, 6.5, -6]],
    key: 5.5, fill: 2.2, back: 1.2, bulbs: 6, flicker: 1, windows: 0.25, exposure: 1,
  },
  night: {
    bg: '#05060a', fog: ['#07090e', 0.05], hemi: ['#3a4670', '#1a120b', 0.42, 0.32], sun: ['#9db2ff', 0.35, [8, 14, -10]],
    key: 7, fill: 3, back: 0.7, bulbs: 9, flicker: 0.9, windows: 0.08, exposure: 1.1,
  },
};
const skyTex = {};
const RAIN_GREY = new THREE.Color('#6b7079');
function setTime(W, scene, tod) {
  const P = TOD[tod] || TOD.evening;
  W.tod = TOD[tod] ? tod : 'evening';
  const rain = W.wx === 'rain';
  W.exposure = P.exposure * (rain ? 0.95 : 1);
  const sk = rain ? `${W.tod}-rain` : W.tod;
  if (!skyTex[sk]) skyTex[sk] = T.toTex(T.skyCanvas(sk));
  W.sky.material.map = skyTex[sk];
  scene.background.set(P.bg);
  // дождь: пасмурно, туман гуще и серее, солнце почти не пробивается, брусчатка мокрая и тёмная
  scene.fog.color.set(P.fog[0]);
  if (rain) { scene.fog.color.lerp(RAIN_GREY, W.tod === 'night' ? 0.15 : 0.45); scene.background.lerp(RAIN_GREY, W.tod === 'night' ? 0.1 : 0.4); }
  scene.fog.density = P.fog[1] * (rain ? 1.7 : 1) + (rain ? 0.008 : 0);
  if (W.floorMat) {
    W.floorMat.color.set(rain ? '#9aa0a8' : '#d8dce2');
    if (W.floorMat.roughness !== undefined) W.floorMat.roughness = rain ? 0.2 : 0.62;
  }
  const L = W.lights;
  L.hemi.color.set(P.hemi[0]); L.hemi.groundColor.set(P.hemi[1]); L.hemi.intensity = (TOON ? P.hemi[2] : P.hemi[3]) * (rain ? 0.85 : 1);
  if (rain) L.hemi.color.lerp(RAIN_GREY, 0.5);
  L.sun.color.set(P.sun[0]); L.sun.intensity = P.sun[1] * (rain ? 0.3 : 1); L.sun.position.set(...P.sun[2]);
  L.key.intensity = P.key; L.fill.intensity = P.fill; L.back.intensity = P.back;
  if (W.bulbM) W.bulbM.emissiveIntensity = P.bulbs;
  W.flicker.forEach((f) => { f.base = f.base0 * P.flicker; });
  if (W.houseM) W.houseM.emissiveIntensity = P.windows;
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
    // без лака и с приглушённым отражением: раньше блики на стекле выбивались в засветы
    color: '#fff3e6', transmission: 1, roughness: 0.12, thickness: 0.05, ior: 1.45, specularIntensity: 0.45,
    attenuationColor: '#e39a55', attenuationDistance: 0.4, envMapIntensity: 0.45,
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
  const liqM = mat({ keep: true, color: '#7a3510', roughness: 0.25, emissive: '#5a2206', emissiveIntensity: 0.08 });
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
  const FZ = FENCE_Z; // северная граница двора (заборы)

  // ---------- бежевая соседская стена (восток): видна за верёвками и во дворе, на ней мурал ----------
  const neighbour = new THREE.Mesh(new THREE.BoxGeometry(6, 6.5, 15.6), mat({ map: T.toTex(T.blockWallCanvas(), { repeat: [7, 7] }), roughness: 0.92 }));
  neighbour.position.set(X1 + 0.45 + 3, 3.25, -0.2);
  scene.add(neighbour);
  // мурал: бородач в наушниках, в раме, над низкой сланцевой стенкой
  const mz = FZ + 1.85;
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
  // стенка начинается чуть правее калитки, чтобы не загораживать вход
  const lx0 = GATE.x1 + 0.9, lx1 = X1 + 0.45;
  const lowN = box(lx1 - lx0, 0.52, 0.3, slate, (lx0 + lx1) / 2, 0.26, FZ + 0.32);
  scene.add(lowN, box(lx1 - lx0, 0.05, 0.42, capM, (lx0 + lx1) / 2, 0.545, FZ + 0.35));
  const eL = (ZN - 0.4) - (FZ + 0.47), eC = (ZN - 0.4 + FZ + 0.47) / 2;
  const lowE = box(0.3, 0.52, eL, slate, X1 + 0.28, 0.26, eC);
  scene.add(lowE, box(0.42, 0.05, eL, capM, X1 + 0.25, 0.545, eC));
  shadow(lowN); shadow(lowE);

  // ---------- тёмный забор с арочным верхом (север, правее проезда) ----------
  const fenceM = mat({ map: T.toTex(T.woodCanvas({ w: 512, h: 512, base: '#2f2622', dark: '#110b08', light: '#4a3b33', planks: 1, gaps: false, seed: 61 })), roughness: 0.8 });
  const fx0 = GATE.x1, fx1 = X1 + 0.45, span = 1.75;
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

  // ---------- вход: серая калитка в дальнем левом углу двора, рыжий забор уходит от неё к будке ----------
  // тёмная металлическая калитка с арочным верхом, открыта во двор (фото 3)
  const gateM = mat({ color: '#34373c', roughness: 0.5, metalness: 0.4 });
  const gw = GATE.x1 - GATE.x0;
  const ty = 0; // калитка стоит прямо на брусчатке
  const leaf = new THREE.Group();
  leaf.position.set(GATE.x1, 0, FZ);
  for (let x = 0.05; x < gw - 0.02; x += 0.1) {
    const h = 2.05 + Math.sin((x / gw) * Math.PI) * 0.22;
    box(0.08, h, 0.03, gateM, -x, h / 2, 0, leaf);
  }
  box(gw, 0.06, 0.05, gateM, -gw / 2, 0.3, 0.03, leaf);
  box(gw, 0.06, 0.05, gateM, -gw / 2, 1.9, 0.03, leaf);
  leaf.rotation.y = 1.15;
  scene.add(leaf);
  for (const x of [GATE.x0, GATE.x1]) scene.add(box(0.1, 2.4, 0.1, gateM, x, 1.2, FZ + 0.04));
  // рыжий забор: из угла у калитки по диагонали к каменному цоколю будки (за деревом)
  const redM = mat({ map: T.toTex(T.woodCanvas({ w: 512, h: 512, base: '#7a3e2a', dark: '#3a1a10', light: '#a5623f', planks: 1, gaps: false, seed: 63 })), roughness: 0.8 });
  const ra = V3(GATE.x0, 0, FZ), rb = V3(STAIR.x1 + 0.25, 0, STAIR.z0 - 0.25); // до угла каменной стенки лестницы
  const rlen = ra.distanceTo(rb), rang = Math.atan2(rb.x - ra.x, rb.z - ra.z);
  const red = new THREE.Group();
  red.position.copy(ra);
  red.rotation.y = rang;
  for (let d = 0.07; d < rlen; d += 0.14) {
    const h = 1.95 + Math.sin((d / rlen) * Math.PI) * 0.3; // арочный верх, как на фото
    const b = box(0.13, h, 0.03, redM, 0, h / 2, d, red);
    b.rotation.y = Math.PI / 2;
    b.castShadow = true;
  }
  for (const y of [0.5, 1.55]) box(0.05, 0.07, rlen, redM, 0.03, y, rlen / 2, red);
  scene.add(red);
  // за калиткой — улица
  const street = new THREE.Mesh(new THREE.PlaneGeometry(40, 10), mat({ color: '#3b3b3d', roughness: 0.95 }));
  street.rotation.x = -Math.PI / 2;
  street.position.set(-2, 0.004, FZ - 5.2);
  street.receiveShadow = true;
  scene.add(street);

  // ---------- катушки-столы во дворе (три, фото 2; одна видна и на фото 1) ----------
  const spoolWood = mat({ map: T.toTex(T.woodCanvas({ w: 512, h: 512, base: '#5f5a55', dark: '#2a2622', light: '#8a837b', planks: 6, seed: 44 })), roughness: 0.85 });
  const spoolTop = mat({ color: '#d4d0c6', roughness: 0.4, metalness: 0.1 });
  for (const [x, z] of [[0.9, -4.45], [2.9, -3.5], [4.05, -2.75]]) {
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

  // ---------- запад: клумба-скамейка с деревом (фото 3) ----------
  // Отдельной скамейки нет: это сама клумба. Со стороны стола и с юга — каменные бортики
  // с деревянной крышкой, со стороны столба — низкий деревянный бортик, внутри гравий,
  // из него растёт дерево; у каменной стенки — груда камней, куда уходит водосток.
  const PX = STAIR.x1 + 0.25; // наружная грань каменной стенки лестницы
  const PB = { e: -2.0, s: 0.9, nE: -1.95, nW: -2.75, y: PBY }; // гравий почти вровень с бортиками
  const gShape2 = new THREE.Shape();
  gShape2.moveTo(PX, -PB.s); gShape2.lineTo(PB.e - 0.1, -PB.s); gShape2.lineTo(PB.e - 0.1, -PB.nE); gShape2.lineTo(PX, -PB.nW); gShape2.closePath();
  const gravelTex = T.toTex(gravelCanvas(), { repeat: [0.9, 0.9] });
  const gravel = new THREE.Mesh(new THREE.ShapeGeometry(gShape2), mat({ map: gravelTex, roughness: 1 }));
  gravel.rotation.x = -Math.PI / 2;
  gravel.position.y = PB.y;
  gravel.receiveShadow = true;
  scene.add(gravel);
  const benchE = box(0.36, 0.44, PB.s - PB.nE + 0.18, slate, PB.e, 0.22, (PB.s + PB.nE) / 2);
  const benchS = box(PB.e - PX + 0.18, 0.44, 0.36, slate, (PB.e + PX) / 2, 0.22, PB.s);
  scene.add(benchE, benchS);
  scene.add(box(0.48, 0.06, PB.s - PB.nE + 0.3, woodDark, PB.e, 0.47, (PB.s + PB.nE) / 2));
  scene.add(box(PB.e - PX + 0.3, 0.06, 0.48, woodDark, (PB.e + PX) / 2, 0.47, PB.s));
  shadow(benchE); shadow(benchS);
  // низкий деревянный бортик к столбу навеса
  const cA = V3(PB.e, 0, PB.nE), cB = V3(PX, 0, PB.nW);
  const curb = box(0.16, 0.4, cA.distanceTo(cB) + 0.1, woodDark, (cA.x + cB.x) / 2, 0.2, (cA.z + cB.z) / 2);
  curb.rotation.y = Math.atan2(cB.x - cA.x, cB.z - cA.z);
  shadow(curb);
  scene.add(curb);
  // груда светлых камней у каменной стенки, под водостоком
  const rockMs = ['#6d665c', '#5f584f', '#77706a'].map((c) => mat({ color: c, roughness: 0.95 }));
  for (let i = 0; i < 14; i++) {
    const rk = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(0.07 + r() * 0.09, 1), 0.06, i + 90), rockMs[i % 3]);
    rk.position.set(-3.3 + (r() - 0.5) * 0.45, PB.y + 0.05 + r() * 0.16, -0.45 + (r() - 0.5) * 0.5);
    rk.scale.y = 0.7;
    shadow(rk);
    scene.add(rk);
  }
  // чёрные мусорные мешки слева от клумбы
  const bagM = mat({ color: '#0b0b0d', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.2 });
  for (const [x, z, sc] of [[-3.25, 1.3, 1.0], [-2.75, 1.4, 0.85], [-3.5, 1.7, 0.9], [-2.3, 1.35, 0.8]]) {
    const bag = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(0.27 * sc, 2), 0.1 * sc, x * 10), bagM);
    bag.position.set(x, 0.2 * sc, z);
    bag.scale.set(1, 0.85, 1.1);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.05 * sc, 0.12 * sc, 8), bagM);
    knot.position.set(x + 0.03, 0.43 * sc, z);
    shadow(bag); shadow(knot);
    scene.add(bag, knot);
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
  // ветки растут в сторону от навеса (на запад и север), чтобы не протыкать крышу
  for (const [a, h, l] of [[2.2, 3.0, 1.5], [3.0, 3.6, 1.3], [3.8, 3.2, 1.4], [4.6, 3.6, 1.6], [1.6, 4.1, 1.0]]) {
    const c = new THREE.CatmullRomCurve3([
      trunkCurve.getPoint(h / 4.6), V3(Math.cos(a) * l * 0.5, h + 0.45, Math.sin(a) * l * 0.5), V3(Math.cos(a) * l, h + 0.6, Math.sin(a) * l),
    ]);
    tree.add(new THREE.Mesh(new THREE.TubeGeometry(c, 12, 0.07, 8), bark));
    // перистые листья свисают гроздьями
    for (let i = 0; i < 7; i++) {
      const p = c.getPoint(0.35 + r() * 0.65);
      const lf = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(0.28 + r() * 0.3, 1), 0.2, i + a * 10), leafMs[i % 3]);
      lf.position.set(p.x + (r() - 0.5) * 0.6, p.y - 0.1 - r() * 0.5, p.z + (r() - 0.5) * 0.6);
      // крыша навеса начинается в ~1 м к востоку от ствола: листва туда не заходит
      lf.position.x = Math.min(lf.position.x, 0.55);
      // и не лезет в крышу павильона над лестницей
      const wx = lf.position.x - 2.95;
      if (wx < -3.1) lf.position.y = Math.max(lf.position.y, pavilionRoofY(wx) + 0.45 - PBY);
      lf.scale.set(1, 0.6 + r() * 0.5, 1);
      tree.add(lf);
    }
  }
  tree.position.set(-2.95, PB.y, -1.2);
  shadow(tree);
  scene.add(tree);

  // ---------- запад дальше: каменный цоколь, будка с X-дверью, балка в стикерах ----------
  // ---------- лестница вниз в подвальный бар (за каменной стенкой, фото 1 слева) ----------
  const S = STAIR, SD = 2.7, SW = S.x1 - S.x0, PH = 0.95;
  const sLen = S.z1 - S.z0, sCz = (S.z0 + S.z1) / 2;
  // каменная стенка-парапет со стороны клумбы и с севера, дальше вниз — стенки колодца
  const parE = box(0.25, SD + PH, sLen + 0.25, slate, S.x1 + 0.125, (PH - SD) / 2, sCz - 0.125);
  const parN = box(SW + 0.25, SD + PH, 0.25, slate, (S.x0 + S.x1 + 0.25) / 2, (PH - SD) / 2, S.z0 - 0.125);
  const wallS = box(SW, SD, 0.2, slate, (S.x0 + S.x1) / 2, -SD / 2, S.z1 + 0.1);
  const wallW = box(0.2, SD, sLen, slate, S.x0 - 0.1, -SD / 2, sCz);
  [parE, parN, wallS, wallW].forEach((w) => { shadow(w); scene.add(w); });
  // ступени: сверху у южного конца вниз к двери на севере
  const stepM = mat({ color: '#7d7a74', roughness: 0.85 });
  const rise = 0.19, run = 0.3, N = 13;
  for (let i = 0; i < N; i++) {
    const top = -(i + 1) * rise, z = S.z1 - run * (i + 0.5);
    scene.add(box(SW, SD + top, run, stepM, (S.x0 + S.x1) / 2, (top - SD) / 2, z));
  }
  const landZ0 = S.z1 - run * N;
  scene.add(box(SW, SD - N * rise, landZ0 - S.z0, stepM, (S.x0 + S.x1) / 2, (-N * rise - SD) / 2, (landZ0 + S.z0) / 2));
  // дверь бара внизу и вывеска
  const doorM = mat({ color: '#2a1810', roughness: 0.6 });
  scene.add(box(0.95, 2.05, 0.06, doorM, (S.x0 + S.x1) / 2, -N * rise + 1.02, S.z0 + 0.03));
  const [sc, sg] = T.canvas(256, 96);
  sg.fillStyle = '#140c08'; sg.fillRect(0, 0, 256, 96);
  sg.fillStyle = '#ffcf7a'; sg.font = 'bold 60px "Rubik Dirt", Impact, sans-serif'; sg.textAlign = 'center'; sg.textBaseline = 'middle'; sg.fillText('БАР', 128, 52);
  const signTex = T.toTex(sc);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), new THREE.MeshStandardMaterial({ map: signTex, emissiveMap: signTex, emissive: '#ffffff', emissiveIntensity: 2.2, roughness: 0.5 }));
  sign.position.set((S.x0 + S.x1) / 2, -N * rise + 2.35, S.z0 + 0.07);
  scene.add(sign);
  // ---------- павильон над спуском в подвальный бар (фото 3–4) ----------
  // Объёмная постройка: четыре колонны из светлого кирпича (передние стоят на каменной
  // стенке, задние — на цоколе), двускатная крыша из черепицы с желобом спереди, под
  // крышей поперечные балки в стикерах уходят вглубь, в глубине — задняя стенка с X.
  const PW = PLAT.x1 - PLAT.x0, PD = PLAT.z1 - PLAT.z0, PCz = (PLAT.z0 + PLAT.z1) / 2;
  const plat = box(PW, 1.05, PD, slate, (PLAT.x0 + PLAT.x1) / 2, 0.525, PCz);
  scene.add(plat);
  shadow(plat);
  const fx = S.x1 + 0.12, bxw = PLAT.x1 - 0.15; // передняя и задняя линии колонн
  const zA = S.z1 - 0.15, zB = S.z0 - 0.05; // южный и северный края
  const cY = 2.95; // низ балок потолка
  const brickM = mat({ map: T.toTex(T.blockWallCanvas(8), { repeat: [0.35, 1.2] }), color: '#e6d39c', roughness: 0.95 });
  for (const [x, z, y0, w] of [[fx, zA, PH, 0.5], [fx, zB, PH, 0.42], [bxw, zA, 1.05, 0.42], [bxw, zB, 1.05, 0.42]]) {
    const col = box(w, cY + 0.3 - y0, w, brickM, x, (cY + 0.3 + y0) / 2, z); // до самого потолка
    shadow(col);
    scene.add(col);
  }
  // задняя стенка с X-распоркой
  const boothWood = mat({ map: T.toTex(T.woodCanvas({ w: 1024, h: 1024, base: '#8a6a44', dark: '#3a2814', light: '#b08a5a', planks: 9, seed: 71 }), { rot: Math.PI / 2, repeat: [1.5, 1] }), roughness: 0.75 });
  const bL = zA - zB - 0.42, bzc = (zA + zB) / 2, bH = cY - 1.05;
  scene.add(box(0.1, bH, bL, boothWood, bxw - 0.05, 1.05 + bH / 2, bzc));
  const xM = mat({ color: '#2e2418', roughness: 0.8 });
  const xang = Math.atan2(bH - 0.5, bL - 0.7);
  for (const s of [-1, 1]) {
    const d = box(0.04, 0.05, Math.hypot(bH - 0.5, bL - 0.7), xM, bxw + 0.02, 1.05 + bH / 2, bzc);
    d.rotation.x = s * xang;
    scene.add(d);
  }
  // потолок: балки в стикерах поперёк, от переднего края вглубь
  const stickerBeam = mat({ map: T.toTex(T.stickerPostCanvas(9), { rot: Math.PI / 2, repeat: [1, 3] }), roughness: 0.7 });
  for (let k = 0; k < 4; k++) {
    const x = fx - 0.05 - k * (fx - bxw) / 3.6;
    const bm = box(0.12, 0.16, zA - zB + 0.5, stickerBeam, x, cY + 0.08 + k * 0.05, bzc);
    shadow(bm);
    scene.add(bm);
  }
  scene.add(box(fx - bxw + 0.9, 0.03, zA - zB + 0.9, woodDark, (fx + bxw) / 2, cY + 0.315, bzc)); // дощатый потолок до свесов
  // обвязка поверх колонн: на неё опираются потолок и крыша
  for (const x of [fx, bxw]) { const pl = box(0.5, 0.22, zA - zB + 0.5, beam, x, cY + 0.19, bzc); shadow(pl); scene.add(pl); }
  for (const z of [zA, zB]) { const pl = box(fx - bxw + 0.5, 0.22, 0.42, beam, (fx + bxw) / 2, cY + 0.19, z); shadow(pl); scene.add(pl); }
  // двускатная крыша (конёк вдоль стенки), черепица
  const shingleM = mat({ map: T.toTex(shingleCanvas(), { repeat: [3, 1] }), roughness: 0.9, side: THREE.DoubleSide });
  const eaveF = fx + 0.45, eaveB = bxw - 0.45, ridgeX = (eaveF + eaveB) / 2, rY0 = cY + 0.3, rY1 = rY0 + 0.6;
  const half2 = (eaveF - eaveB) / 2, slope = Math.hypot(half2, rY1 - rY0), rAng = Math.atan2(rY1 - rY0, half2);
  for (const sd of [1, -1]) {
    const pl = box(slope + 0.05, 0.05, zA - zB + 0.9, shingleM, ridgeX + sd * half2 / 2, (rY0 + rY1) / 2 + 0.03, bzc);
    pl.rotation.z = -sd * rAng;
    shadow(pl);
    scene.add(pl);
  }
  // подшивка свесов спереди и сзади: между потолком и черепицей нет щели
  for (const x of [eaveF, eaveB]) scene.add(box(0.04, 0.12, zA - zB + 0.9, woodDark, x, rY0 + 0.03, bzc));
  // фронтоны из досок
  const gs = new THREE.Shape();
  gs.moveTo(-half2, 0); gs.lineTo(half2, 0); gs.lineTo(0, rY1 - rY0); gs.closePath();
  const gM = mat({ color: '#3b2716', roughness: 0.8, side: THREE.DoubleSide });
  for (const z of [zA + 0.25, zB - 0.25]) {
    const gm = new THREE.Mesh(new THREE.ShapeGeometry(gs), gM);
    gm.position.set(ridgeX, rY0, z);
    scene.add(gm);
  }
  // коричневый желоб по переднему скату и водосток: вниз по передней левой колонне,
  // затем наискосок по каменной стенке в груду камней
  const gutterM2 = mat({ color: '#5a3a28', roughness: 0.5 });
  const gut = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, zA - zB + 0.9, 12, 1, true, 0, Math.PI), gutterM2);
  gut.rotation.x = Math.PI / 2;
  gut.rotation.y = Math.PI;
  gut.position.set(eaveF + 0.04, rY0 - 0.02, bzc);
  gut.material.side = THREE.DoubleSide;
  scene.add(gut);
  const px = S.x1 + 0.3;
  const pipeC = new THREE.CatmullRomCurve3([
    V3(eaveF + 0.04, rY0 - 0.05, zA + 0.4), V3(fx + 0.3, rY0 - 0.4, zA + 0.32), V3(fx + 0.3, 1.45, zA + 0.32),
    V3(px, 1.2, zA - 0.2), V3(px, 0.72, -0.28), V3(px + 0.12, 0.62, -0.42), V3(px + 0.2, 0.3, -0.45),
  ], false, 'catmullrom', 0.1);
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(pipeC, 70, 0.04, 8), gutterM2));
  // красный стаканчик на каменной стенке
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.08, 14), mat({ color: '#c8231e', roughness: 0.4 }));
  cup.position.set(S.x1 + 0.12, PH + 0.04, zB + 0.7);
  scene.add(cup);
  // столбы для гирлянд во дворе
  for (const [x, z] of [[0.9, FZ + 0.5], [3.6, FZ + 0.5], [5.15, FZ + 0.9]]) scene.add(box(0.07, 3.15, 0.07, dark, x, 1.575, z));
  // западная граница: высокая оштукатуренная стена
  const plaster = mat({ map: T.toTex(T.blockWallCanvas(8), { repeat: [3, 1] }), color: '#e9e0cf', roughness: 0.95 });
  scene.add(box(0.3, 3.8, 11, plaster, PLAT.x0 - 0.15, 1.9, -1.5));
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
  thuja.position.set(GATE.x1 + 0.9, 1.3, FZ - 1.1);
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
  const houseM = W.houseM = mat({ map: facadeTex, emissiveMap: facadeTex, emissive: '#ffffff', emissiveIntensity: 0.25, roughness: 0.9 });
  const house = new THREE.Mesh(new THREE.BoxGeometry(9, 7.5, 7), houseM);
  house.position.set(-3.5, 3.75, FZ - 12);
  scene.add(house);
  const house2 = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 7), houseM);
  house2.position.set(-14, 4, -8);
  scene.add(house2);
}

function V3(x, y, z) { return new THREE.Vector3(x, y, z); }

// высота крыши павильона над лестницей в точке x (для листвы дерева)
function pavilionRoofY(x) {
  const eaveF = STAIR.x1 + 0.12 + 0.45, eaveB = PLAT.x1 - 0.15 - 0.45, half = (eaveF - eaveB) / 2, rx = (eaveF + eaveB) / 2;
  const y0 = 3.25, y1 = 3.85;
  if (x > eaveF || x < eaveB) return 0;
  return y0 + (y1 - y0) * (1 - Math.abs(x - rx) / half);
}

function shingleCanvas() {
  const [c, g] = T.canvas(256, 256);
  const r = T.rng(41);
  g.fillStyle = '#3d3632'; g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 8; row++) for (let col = 0; col < 9; col++) {
    const v = 50 + r() * 22;
    g.fillStyle = `rgb(${v + 8},${v},${v - 4})`;
    g.fillRect(col * 32 - (row % 2) * 16 + 1, row * 32 + 1, 30, 29);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(col * 32 - (row % 2) * 16, row * 32 + 27, 32, 4);
  }
  return c;
}

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
