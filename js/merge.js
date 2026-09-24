// Склейка статичной геометрии: меши с общим материалом и общим родителем
// сливаются в один. Картинка та же, а вызовов отрисовки в разы меньше —
// это касается и основного прохода, и контуров, и обеих карт теней.
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _v = new THREE.Vector3();

function signature(g) {
  return Object.keys(g.attributes).filter((k) => ['position', 'normal', 'uv'].includes(k)).sort().join(',');
}

function mergeable(o, skip) {
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return false;
  if (Array.isArray(o.material) || o.children.length || skip.has(o)) return false;
  if (o.morphTargetInfluences || o.userData.noMerge) return false;
  const g = o.geometry;
  return !!(g.attributes.position && g.attributes.normal && !g.morphAttributes.position);
}

// Сливает геометрии; matOf(o) — матрица, которой запекается каждый меш,
// boneOf(o) — номер кости (для жёсткого скиннинга) или undefined.
function bake(list, matOf, boneOf) {
  let vCount = 0, iCount = 0;
  const hasUv = list.every((o) => o.geometry.attributes.uv);
  for (const o of list) {
    const g = o.geometry;
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = hasUv ? new Float32Array(vCount * 2) : null;
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  const si = boneOf ? new Uint16Array(vCount * 4) : null, sw = boneOf ? new Float32Array(vCount * 4) : null;
  let vo = 0, io = 0;
  for (const o of list) {
    const g = o.geometry;
    _m.copy(matOf(o));
    if (si) { const b = boneOf(o); for (let i = 0; i < g.attributes.position.count; i++) { si[(vo + i) * 4] = b; sw[(vo + i) * 4] = 1; } }
    _n.getNormalMatrix(_m);
    const flip = _m.determinant() < 0;
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(_m);
      pos[(vo + i) * 3] = _v.x; pos[(vo + i) * 3 + 1] = _v.y; pos[(vo + i) * 3 + 2] = _v.z;
      _v.fromBufferAttribute(N, i).applyMatrix3(_n).normalize();
      nor[(vo + i) * 3] = _v.x; nor[(vo + i) * 3 + 1] = _v.y; nor[(vo + i) * 3 + 2] = _v.z;
      if (uv) { uv[(vo + i) * 2] = U.getX(i); uv[(vo + i) * 2 + 1] = U.getY(i); }
    }
    const n = g.index ? g.index.count : P.count;
    for (let i = 0; i < n; i += 3) {
      const a = g.index ? g.index.getX(i) : i, b = g.index ? g.index.getX(i + 1) : i + 1, c = g.index ? g.index.getX(i + 2) : i + 2;
      idx[io++] = vo + a;
      idx[io++] = vo + (flip ? c : b);
      idx[io++] = vo + (flip ? b : c);
    }
    vo += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (si) { out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4)); }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// Сливает меши внутри `root`, группируя по (родитель, материал, тени, атрибуты).
// `skip` — меши, которые двигаются или прячутся по отдельности.
// `flatten` — сливать всё в пространство root (для полностью неподвижных объектов).
export function mergeStatic(root, { skip = new Set(), skipTrees = [], flatten = false, keep = [], cell = 0 } = {}) {
  root.updateMatrixWorld(true);
  const banned = new Set(skip);
  for (const t of skipTrees) t.traverse((o) => banned.add(o));
  const groups = new Map();
  root.traverse((o) => {
    if (!mergeable(o, banned)) return;
    const parent = flatten ? root : o.parent;
    const flags = keep.map((k) => o.userData[k] ? 1 : 0).join('');
    // ячейка сетки: слитые куски остаются компактными, и отсечение по камере/теням работает
    let cellKey = '';
    if (cell) {
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      _v.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld);
      cellKey = `${Math.floor(_v.x / cell)},${Math.floor(_v.y / (cell * 2))},${Math.floor(_v.z / cell)}`;
    }
    const key = `${parent.uuid}|${o.material.uuid}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.visible ? 1 : 0}|${o.renderOrder}|${o.frustumCulled ? 1 : 0}|${flags}|${cellKey}|${signature(o.geometry)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { parent, list: [] });
    g.list.push(o);
  });
  const made = [];
  let removed = 0;
  for (const { parent, list } of groups.values()) {
    if (list.length < 2) continue;
    const space = new THREE.Matrix4().copy(parent.matrixWorld).invert();
    const src = list[0];
    const tmp = new THREE.Matrix4();
    const mesh = new THREE.Mesh(bake(list, (o) => tmp.multiplyMatrices(space, o.matrixWorld)), src.material);
    mesh.castShadow = src.castShadow;
    mesh.receiveShadow = src.receiveShadow;
    mesh.renderOrder = src.renderOrder;
    mesh.frustumCulled = src.frustumCulled;
    for (const k of keep) if (src.userData[k]) mesh.userData[k] = src.userData[k];
    mesh.userData.merged = list.length;
    parent.add(mesh);
    for (const o of list) {
      o.parent.remove(o);
      // геометрию не освобождаем: её могут делить другие меши
    }
    removed += list.length;
    made.push(mesh);
  }
  return { made, removed };
}

// Жёсткий скиннинг для персонажа: все неподвижные относительно своего родителя
// детали с общим материалом становятся одним SkinnedMesh, где каждая вершина
// привязана к своему узлу (торс, голова, фаланга пальца…). Узлы анимируются как
// раньше, а рисуется всё это за один вызов вместо десятков.
const IDENT = new THREE.Matrix4();
export function rigidSkin(root, { skip = new Set(), keep = [] } = {}) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  root.traverse((o) => {
    if (!mergeable(o, skip) || !o.visible) return;
    const flags = keep.map((k) => o.userData[k] ? 1 : 0).join('');
    const key = `${o.material.uuid}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${flags}|${signature(o.geometry)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, g = []);
    g.push(o);
  });
  const made = [];
  let removed = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const bones = [];
    const bi = new Map();
    for (const o of list) if (!bi.has(o.parent)) { bi.set(o.parent, bones.length); bones.push(o.parent); }
    const src = list[0];
    const geo = bake(list, (o) => o.matrix, (o) => bi.get(o.parent));
    const mesh = new THREE.SkinnedMesh(geo, src.material);
    mesh.castShadow = src.castShadow;
    mesh.receiveShadow = src.receiveShadow;
    mesh.frustumCulled = false;
    for (const k of keep) if (src.userData[k]) mesh.userData[k] = src.userData[k];
    mesh.userData.merged = list.length;
    root.add(mesh);
    mesh.bind(new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4())), IDENT);
    made.push(mesh);
    for (const o of list) o.parent.remove(o);
    removed += list.length;
  }
  return { made, removed };
}

// Все Object3D, на которые ссылается объект (поля, массивы, вложенные объекты),
// кроме перечисленных полей. Эти меши анимируются по отдельности — их не трогаем.
export function referenced(obj, ignore = []) {
  const out = new Set();
  const seen = new Set();
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || seen.has(v) || depth > 6) return;
    seen.add(v);
    if (v.isObject3D) { out.add(v); return; }
    if (v.isMaterial || v.isTexture || v.isBufferGeometry || v.isVector3 || v.isColor || v.isQuaternion) return;
    for (const k of Object.keys(v)) if (!(depth === 0 && ignore.includes(k))) walk(v[k], depth + 1);
  };
  walk(obj, 0);
  return out;
}
