// Локация: крытая беседка бара во дворе, как на фото.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as T from './textures.js';
import { TOON, toonFrom } from './style.js';

export const TABLE_R = 0.75;
export const TABLE_Y = 0.785;
export const SEAT_R = 1.04;

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

  // ---------- беседка ----------
  const gz = new THREE.Group();
  scene.add(gz);
  const H = 2.55, E = 3.05;
  const postTexs = [1, 2, 3, 4, 5, 6].map((s) => T.toTex(T.stickerPostCanvas(s)));
  const postPos = [[-E, -E], [E, -E], [-E, E], [E, E], [-E, 0.2], [0.4, -E]];
  postPos.forEach(([x, z], i) => {
    const m = mat({ map: postTexs[i % postTexs.length], roughness: 0.7 });
    const p = new THREE.Mesh(new RoundedBoxGeometry(0.16, H, 0.16, 2, 0.015), m);
    p.position.set(x, H / 2, z);
    gz.add(p);
  });
  // обвязка
  box(2 * E + 0.3, 0.22, 0.14, beam, 0, H - 0.05, -E, gz);
  box(2 * E + 0.3, 0.22, 0.14, beam, 0, H - 0.05, E, gz);
  box(0.14, 0.22, 2 * E + 0.3, beam, -E, H - 0.05, 0, gz);
  box(0.14, 0.22, 2 * E + 0.3, beam, E, H - 0.05, 0, gz);
  // крыша (конёк вдоль X)
  const ridgeY = 3.55, eave = E + 0.35;
  const slopeL = Math.hypot(eave, ridgeY - (H - 0.02));
  const ang = Math.atan2(ridgeY - (H - 0.02), eave);
  for (const s of [-1, 1]) {
    const pl = new THREE.Mesh(new THREE.BoxGeometry(2 * E + 0.9, 0.04, slopeL + 0.05), roofWood);
    pl.position.set(0, (ridgeY + H) / 2 + 0.05, s * eave / 2);
    pl.rotation.x = s * ang;
    gz.add(pl);
    // стропила
    for (let x = -E - 0.3; x <= E + 0.31; x += 0.62) {
      const rf = box(0.07, 0.14, slopeL, beam, x, (ridgeY + H) / 2 - 0.04, s * eave / 2, gz);
      rf.rotation.x = s * ang;
    }
    // фронтоны: треугольная ферма
    for (const xs of [-1, 1]) {
      const tb = box(0.08, 0.12, slopeL, beam, xs * (E + 0.1), (ridgeY + H) / 2 - 0.06, s * eave / 2, gz);
      tb.rotation.x = s * ang;
    }
  }
  box(2 * E + 0.9, 0.18, 0.12, beam, 0, ridgeY - 0.06, 0, gz); // конёк
  // фронтоны зашиты досками — никаких дыр под крышей
  const gShape = new THREE.Shape();
  gShape.moveTo(-eave, 0); gShape.lineTo(eave, 0); gShape.lineTo(0, ridgeY - H + 0.08); gShape.closePath();
  const gableTex = T.toTex(wallC, { repeat: [0.8, 0.6] });
  const gableM = mat({ map: gableTex, roughness: 0.75, side: THREE.DoubleSide });
  for (const xs of [-1, 1]) {
    const gm = new THREE.Mesh(new THREE.ShapeGeometry(gShape), gableM);
    gm.position.set(xs * (E + 0.14), H - 0.02, 0);
    gm.rotation.y = Math.PI / 2;
    gz.add(gm);
  }
  box(0.1, ridgeY - H, 0.1, beam, -E - 0.1, (ridgeY + H) / 2, 0, gz);
  box(0.1, ridgeY - H, 0.1, beam, E + 0.1, (ridgeY + H) / 2, 0, gz);
  box(2 * E, 0.12, 0.1, beam, 0, H + 0.12, 0, gz).rotation.x = 0; // затяжка

  // стена сзади (+Z) — деревянная, во всю высоту
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(2 * E + 0.2, H + 0.05, 0.08), wallWood);
  backWall.position.set(0, H / 2, E + 0.1);
  gz.add(backWall);
  // стена справа (+X) — деревянная, с полкой-стойкой
  const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.08, H + 0.05, 2 * E + 0.2), wallWood);
  sideWall.position.set(E + 0.1, H / 2, 0);
  gz.add(sideWall);
  const counter = new THREE.Group();
  counter.position.set(E - 0.22, 0, 0.6);
  gz.add(counter);
  box(0.42, 1.02, 3.4, wallWood, 0, 0.51, 0, counter);
  box(0.5, 0.05, 3.5, woodDark, 0, 1.045, 0, counter);
  const stoneM = mat({ color: '#9b958c', roughness: 0.85 });
  const r = T.rng(5);
  for (let i = 0; i < 16; i++) {
    const st = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(0.06 + r() * 0.07, 1), 0.04, i), stoneM);
    st.position.set((r() - 0.5) * 0.3, 1.1, -1.5 + r() * 3.0);
    st.scale.y = 0.6;
    counter.add(st);
  }
  const ivyM = mat({ color: '#4f7d33', roughness: 0.7 });
  for (let i = 0; i < 40; i++) {
    const lf = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(0.05 + r() * 0.05, 0), 0.03, i + 50), ivyM);
    lf.position.set(-0.05 + (r() - 0.5) * 0.25, 1.12 + r() * 0.3, -1.6 + r() * 0.6);
    counter.add(lf);
  }
  // колонка на стойке — из неё играет музыка бара
  W.speaker = buildSpeaker();
  W.speaker.position.set(E - 0.24, 1.07, 0.15);
  W.speaker.rotation.y = -Math.PI / 2 - 0.25;
  gz.add(W.speaker);

  // низкая стенка спереди (-Z) из сланцевой плитки со скамьёй
  const low = new THREE.Group();
  gz.add(low);
  box(4.2, 0.62, 0.3, slate, 0.95, 0.31, -E - 0.02, low);
  box(4.3, 0.06, 0.46, woodDark, 0.95, 0.65, -E + 0.02, low);
  // низкая стенка у двора (слева, частично)
  box(0.3, 0.62, 2.0, slate, -E - 0.02, 0.31, -2.1, low);
  box(0.46, 0.06, 2.1, woodDark, -E + 0.02, 0.65, -2.1, low);

  // бежевая стена за беседкой с верёвками
  const bw = new THREE.Mesh(new THREE.BoxGeometry(12, 3.4, 0.25), blockWall);
  bw.position.set(2.5, 1.7, -4.4);
  scene.add(bw);
  const ropeM = mat({ color: '#2a2622', roughness: 0.9 });
  for (let x = -0.8; x < 3.0; x += 0.16) {
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.9, 4), ropeM);
    rope.position.set(x + (r() - 0.5) * 0.04, 1.62, -E - 0.2);
    rope.rotation.z = (r() - 0.5) * 0.08;
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
  // второй столик с пивом
  const t2 = buildTable(0.46, woodDark);
  t2.position.set(1.95, 0, -1.95);
  scene.add(t2);
  [0.4, 2.2, 4.0].forEach((a, k) => {
    const ch = buildChair();
    ch.position.set(1.95 + Math.sin(a) * 0.82, 0, -1.95 + Math.cos(a) * 0.82);
    ch.rotation.y = a + Math.PI + (k - 1) * 0.2;
    scene.add(ch);
  });
  const beerCols = ['#e8a92a', '#b8232a', '#b8232a'];
  beerCols.forEach((c, k) => {
    const b = buildBeer(c);
    b.position.set(1.95 + Math.cos(k * 2.1) * 0.22, TABLE_Y, -1.95 + Math.sin(k * 2.1) * 0.22);
    scene.add(b);
  });

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
  buildYard(scene, W, { slate, woodDark, beam, dark });

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
  fill.position.set(-2.4, 2.1, 0);
  scene.add(fill);
  const back = new THREE.PointLight('#9fb0ff', 1.2, 8, 2);
  back.position.set(2, 2.2, 2.4);
  scene.add(back);
  W.lights = { hemi, sun, key, fill, back };

  // ---------- гирлянды ----------
  const lines = [
    [[-E - 0.1, H + 0.05, -E], [-E - 0.1, H + 0.05, E], 0.35],
    [[-E, H + 0.05, -E - 0.1], [E, H + 0.05, -E - 0.1], 0.3],
    [[-E - 0.1, H, -2.2], [-11.0, 3.3, -5.2], 0.7],
    [[-E - 0.1, H, 2.2], [-11.0, 3.3, 5.2], 0.7],
    [[-E - 0.1, H, 0], [-11.0, 3.3, -1.0], 0.8],
    [[-6.8, 3.3, -5.3], [-6.8, 3.3, 5.3], 0.9],
    [[-E - 0.1, H, -E], [-6.8, 3.3, -5.3], 0.4],
  ];
  buildStringLights(scene, W, lines);
  // тёплые точки двора
  for (const [x, y, z, i] of [[-5.5, 2.6, -2, 3], [-8.5, 2.8, 2, 3], [-5.5, 2.6, 3, 2.5], [-1.5, 2.4, -2.6, 1.6]]) {
    const pl = new THREE.PointLight('#ffb866', i, 8, 2);
    pl.position.set(x, y, z);
    scene.add(pl);
    W.flicker.push({ l: pl, base: i, ph: Math.random() * 10 });
  }

  shadow(gz, true, true);
  gz.traverse((c) => { if (c.isMesh && c.geometry.type === 'BoxGeometry' && c.material === roofWood) c.castShadow = true; });
  shadow(W.table, true, true);
  W.chairs.forEach((c) => shadow(c, true, true));
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

function buildBeer(color) {
  const g = new THREE.Group();
  const glassM = mat({ color: '#ffffff', transmission: 1, roughness: 0.04, thickness: 0.01, ior: 1.45, transparent: true, opacity: 1 });
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.034, 0.16, 12, 1, true), glassM);
  glass.position.y = 0.08;
  g.add(glass);
  const beer = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.031, 0.13, 12), mat({ color, roughness: 0.1, emissive: color, emissiveIntensity: 0.12, transparent: true, opacity: 0.88 }));
  beer.position.y = 0.068;
  g.add(beer);
  const foam = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.036, 0.018, 12), mat({ color: '#f4ead8', roughness: 0.9 }));
  foam.position.y = 0.142;
  g.add(foam);
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

function buildYard(scene, W, { slate, woodDark, beam, dark }) {
  const r = T.rng(71);
  // катушки-столы
  const spoolWood = mat({ map: T.toTex(T.woodCanvas({ w: 512, h: 512, base: '#5a3a24', dark: '#23140a', light: '#86603c', planks: 6, seed: 44 })), roughness: 0.8 });
  const spoolTop = mat({ color: '#d4d0c6', roughness: 0.4, metalness: 0.1 });
  for (const [x, z] of [[-5.2, -2.3], [-6.9, 1.7], [-8.6, -2.8], [-9.4, 2.9]]) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.07, 40), [spoolWood, spoolTop, spoolWood]);
    top.position.y = 0.96; g.add(top);
    const bot = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.07, 40), spoolWood);
    bot.position.y = 0.035; g.add(bot);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 24), spoolWood);
    core.position.y = 0.48; g.add(core);
    for (let i = 0; i < 8; i++) {
      const sl = box(0.09, 0.9, 0.03, spoolWood, Math.sin(i * 0.785) * 0.3, 0.48, Math.cos(i * 0.785) * 0.3, g);
      sl.rotation.y = i * 0.785;
    }
    g.position.set(x, 0, z);
    g.rotation.y = r() * 3;
    shadow(g);
    scene.add(g);
  }
  // стена с муралом
  const mural = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 3.4), mat({ map: T.toTex(T.muralCanvas()), roughness: 0.8 }));
  mural.position.set(-11.55, 2.35, -0.2);
  mural.rotation.y = Math.PI / 2;
  scene.add(mural);
  const frame = box(0.12, 3.6, 6.4, beam, -11.66, 2.35, -0.2);
  scene.add(frame);
  const plaster = mat({ map: T.toTex(T.blockWallCanvas(8), { repeat: [3, 1] }), color: '#e9e0cf', roughness: 0.95 });
  scene.add(box(0.3, 3.6, 11.6, plaster, -12.0, 1.8, 0));
  const mwall = box(0.35, 0.65, 11.2, slate, -11.7, 0.325, 0);
  scene.add(mwall);
  scene.add(box(0.5, 0.06, 11.1, woodDark, -11.6, 0.68, 0));
  shadow(mwall);

  // заборы с арочным верхом
  const fenceM = mat({ map: T.toTex(T.woodCanvas({ w: 512, h: 512, base: '#3b2a1f', dark: '#140c06', light: '#5a4232', planks: 1, gaps: false, seed: 61 })), roughness: 0.8 });
  for (const s of [-1, 1]) {
    for (let x = 3.6; x > -11.8; x -= 0.155) {
      const t = (((3.6 - x) / 15.4) * 4) % 1;
      const h = 1.9 + Math.sin(t * Math.PI) * 0.35;
      const b = box(0.14, h, 0.035, fenceM, x, h / 2, s * 5.6);
      b.castShadow = true;
      scene.add(b);
    }
    scene.add(box(15.4, 0.08, 0.06, fenceM, -4.1, 0.5, s * 5.63));
    scene.add(box(15.4, 0.08, 0.06, fenceM, -4.1, 1.5, s * 5.63));
    for (let x = 3.6; x > -11.9; x -= 2.2) scene.add(box(0.1, 2.35, 0.1, fenceM, x, 1.17, s * 5.66));
  }
  // столбы гирлянд
  for (const [x, z] of [[-11.0, -5.2], [-11.0, 5.2], [-6.8, -5.3], [-6.8, 5.3], [-11.0, -1.0]]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 3.35, 8), dark);
    p.position.set(x, 1.67, z);
    scene.add(p);
  }
  // акация с кадкой
  const trunkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.15, 1.0, 0.05), new THREE.Vector3(-0.1, 2.0, 0.1),
    new THREE.Vector3(0.2, 3.0, -0.1), new THREE.Vector3(0.1, 3.9, 0.2),
  ]);
  const barkTex = T.toTex(T.barkCanvas(), { repeat: [2, 2] });
  const bark = mat({ map: barkTex, bumpMap: T.toTex(T.bumpFrom(T.barkCanvas()), { srgb: false, repeat: [2, 2] }), bumpScale: 4, roughness: 0.95 });
  const trunk = new THREE.Mesh(new THREE.TubeGeometry(trunkCurve, 40, 0.17, 14), bark);
  const acacia = new THREE.Group();
  acacia.add(trunk);
  for (const [a, h, l] of [[0.6, 2.2, 1.2], [2.5, 2.8, 1.4], [4.2, 3.3, 1.1], [1.4, 3.6, 1.0]]) {
    const c = new THREE.CatmullRomCurve3([
      trunkCurve.getPoint(h / 4), new THREE.Vector3(Math.cos(a) * l * 0.5, h + 0.4, Math.sin(a) * l * 0.5),
      new THREE.Vector3(Math.cos(a) * l, h + 0.7, Math.sin(a) * l),
    ]);
    acacia.add(new THREE.Mesh(new THREE.TubeGeometry(c, 12, 0.06, 8), bark));
  }
  const leafMs = ['#6e9a3a', '#86b04a', '#5a8430'].map((c) => mat({ color: c, roughness: 0.75, flatShading: true }));
  for (let i = 0; i < 34; i++) {
    const lf = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(0.35 + r() * 0.45, 1), 0.25, i), leafMs[i % 3]);
    const a = r() * 6.28, d = r() * 1.6;
    lf.position.set(Math.cos(a) * d, 2.4 + r() * 2.0, Math.sin(a) * d);
    lf.scale.y = 0.7;
    acacia.add(lf);
  }
  acacia.position.set(-3.9, 0, 3.8);
  shadow(acacia);
  scene.add(acacia);
  const planter = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.45, 24, 1, true), slate);
  planter.position.set(-3.9, 0.225, 3.8);
  scene.add(planter);
  const gravel = new THREE.Mesh(new THREE.CircleGeometry(0.74, 24), mat({ color: '#4d4a46', roughness: 1 }));
  gravel.rotation.x = -Math.PI / 2; gravel.position.set(-3.9, 0.4, 3.8);
  scene.add(gravel);

  // хвойные деревья вокруг
  const pineMs = ['#1c3526', '#233f2c', '#172c20'].map((c) => mat({ color: c, roughness: 0.9, flatShading: true }));
  const pines = [[-13, -7], [-10, -7.5], [-7, -7.2], [-4.5, -7.5], [-14, -3], [-14, 2.5], [-13.5, 7], [-10, 7.6], [-6.5, 7.2], [2, -7], [5.5, -6.5], [8, -2], [7, 4], [3, 7], [-1, 7.5], [-15, -9], [-3, -9.5]];
  pines.forEach(([x, z], k) => {
    const g = new THREE.Group();
    const h = 5 + r() * 4;
    for (let i = 0; i < 6; i++) {
      const cone = new THREE.Mesh(jitter(new THREE.ConeGeometry(1.6 - i * 0.22, h * 0.34, 9, 2), 0.35, k * 10 + i), pineMs[(k + i) % 3]);
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

  // дом за забором с окнами
  const [fc, fg] = T.canvas(512, 512);
  fg.fillStyle = '#b9b2a6'; fg.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) {
    const lit = r() < 0.45;
    fg.fillStyle = lit ? '#ffc877' : '#2a2c33';
    fg.fillRect(40 + x * 120, 50 + y * 160, 70, 100);
    fg.strokeStyle = '#eee7da'; fg.lineWidth = 6; fg.strokeRect(40 + x * 120, 50 + y * 160, 70, 100);
    fg.beginPath(); fg.moveTo(75 + x * 120, 50 + y * 160); fg.lineTo(75 + x * 120, 150 + y * 160); fg.stroke();
  }
  T.grain(fg, 512, 512, 14, 3);
  const facadeTex = T.toTex(fc);
  const house = new THREE.Mesh(new THREE.BoxGeometry(10, 9, 8), mat({ map: facadeTex, emissiveMap: facadeTex, emissive: '#ffffff', emissiveIntensity: 0.25, roughness: 0.9 }));
  house.position.set(-18, 4.5, 9);
  scene.add(house);
  const house2 = house.clone();
  house2.position.set(-6, 4.5, -14);
  scene.add(house2);
  // соседний дом вплотную к беседке — за правой стеной не пустота
  const house3 = new THREE.Mesh(new THREE.BoxGeometry(6, 6.5, 11.4), house.material);
  house3.position.set(6.4, 3.25, 0);
  scene.add(house3);
}
