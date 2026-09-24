// Карты на столе, частицы дыма и блевоты, лужи, окурки.
import * as THREE from 'three';
import * as T from './textures.js';
import { mat, TABLE_Y, TABLE_R } from './world.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

export const CARD = { w: 0.074, h: 0.104, t: 0.0016 };

export class Cards {
  constructor(scene) {
    this.scene = scene;
    const face = {};
    this.canvases = {};
    for (const r of ['K', 'Q', 'A', 'J']) {
      const c = T.cardFaceCanvas(r);
      this.canvases[r] = c;
      face[r] = mat({ map: T.toTex(c), roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 });
      face[r].map.wrapS = face[r].map.wrapT = THREE.ClampToEdgeWrapping;
    }
    const bc = T.cardBackCanvas();
    this.canvases.back = bc;
    this.back = mat({ map: T.toTex(bc), roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 });
    this.back.map.wrapS = this.back.map.wrapT = THREE.ClampToEdgeWrapping;
    this.edge = mat({ color: '#e8dcc2', roughness: 0.8 });
    this.face = face;
    this.geo = new THREE.BoxGeometry(CARD.w, CARD.t, CARD.h);
    // подсветка карт в руке: рамка за картой (выбрана — янтарная, под прицелом — светлая)
    this.glowGeo = new THREE.PlaneGeometry(CARD.w + 0.009, CARD.h + 0.009);
    this.glowSel = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.55, 0.42), fog: false });
    this.glowHov = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.88, 0.74), fog: false });
    this.pile = [];
    this.flights = [];
    this.fans = [];
    this.revealed = [];
    this.scatter = [];
    const r = T.rng(9);
    for (let i = 0; i < 24; i++) this.scatter.push({ a: r() * 6.283, d: 0.02 + r() * 0.12, rot: r() * 6.283 });
  }

  make(rank = null) {
    // +Y — рубашка, −Y — лицо (карта лежит рубашкой вверх)
    const m = [this.edge, this.edge, this.back, rank ? this.face[rank] : this.back, this.edge, this.edge];
    const me = new THREE.Mesh(this.geo, m);
    me.castShadow = true;
    me.receiveShadow = true;
    return me;
  }

  setFace(mesh, rank) { mesh.material = [this.edge, this.edge, this.back, this.face[rank] || this.back, this.edge, this.edge]; }

  pilePose(i) {
    const s = this.scatter[i % this.scatter.length];
    return {
      pos: V(Math.cos(s.a) * s.d + 0.12, TABLE_Y + 0.0012 + i * 0.0017, Math.sin(s.a) * s.d - 0.06),
      quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.rot, 0)),
    };
  }

  setPile(n) {
    while (this.pile.length > n) this.scene.remove(this.pile.pop());
    while (this.pile.length < n) {
      const c = this.make();
      const p = this.pilePose(this.pile.length);
      c.position.copy(p.pos); c.quaternion.copy(p.quat);
      this.scene.add(c);
      this.pile.push(c);
    }
  }

  // Веер карт в руках персонажа (рубашкой к остальным)
  attachFan(ch) {
    const g = new THREE.Group();
    g.position.set(0, 0.5, 0.36);
    g.rotation.x = -0.45;
    ch.torso.add(g);
    this.fans[ch.seat] = { g, ch, cards: [] };
    ch.fanGroup = g;
  }

  clearFan(f) {
    while (f.cards.length) f.g.remove(f.cards.pop().pivot);
    if (f.mine) { f.mine = false; f.handKey = ''; f.g.rotation.set(-0.45, 0, 0); }
  }

  setFan(seat, n) {
    const f = this.fans[seat];
    if (!f) return;
    if (f.mine) this.clearFan(f);
    f.ch.cards = n;
    while (f.cards.length > n) f.g.remove(f.cards.pop().pivot);
    while (f.cards.length < n) {
      const pivot = new THREE.Object3D();
      const c = this.make();
      c.rotation.x = Math.PI / 2;
      c.position.y = 0.05;
      pivot.add(c);
      f.g.add(pivot);
      f.cards.push({ pivot, c });
    }
    f.cards.forEach((o, i) => {
      o.pivot.rotation.z = (i - (n - 1) / 2) * -0.2;
      o.pivot.position.set((i - (n - 1) / 2) * 0.006, 0, i * -0.0025);
    });
  }

  // Своя рука: настоящие карты лицом к себе, их выбирают взглядом
  setHand(seat, ranks) {
    const f = this.fans[seat];
    if (!f) return;
    f.ch.cards = ranks.length;
    const key = ranks.join('');
    if (f.mine && f.handKey === key) return;
    this.clearFan(f);
    f.mine = true;
    f.handKey = key;
    const m = (ranks.length - 1) / 2;
    ranks.forEach((r, i) => {
      const pivot = new THREE.Object3D();
      const c = this.make(r);
      c.rotation.x = Math.PI / 2;
      c.position.y = 0.05;
      c.userData.handIdx = i;
      const glow = new THREE.Mesh(this.glowGeo, this.glowSel);
      glow.rotation.y = Math.PI;
      glow.position.set(0, 0.05, 0.0016);
      glow.visible = false;
      pivot.add(c, glow);
      pivot.position.set((i - m) * 0.042, -Math.abs(i - m) * 0.004, -i * 0.0018);
      pivot.rotation.z = (i - m) * -0.11;
      f.g.add(pivot);
      f.cards.push({ pivot, c, glow, hov: 0, sel: 0 });
    });
  }

  handMeshes(seat) {
    const f = this.fans[seat];
    return f && f.mine ? f.cards.map((o) => o.c) : [];
  }

  // Раскладка своей руки: веер смотрит в глаза, карта под прицелом подрастает,
  // выбранные приподняты и светятся.
  updateHand(seat, dt, eye, hover, sel) {
    const f = this.fans[seat];
    if (!f || !f.mine) return;
    const gp = f.g.getWorldPosition(this._v1 || (this._v1 = V()));
    f.g.lookAt(this._v2 = (this._v2 || V()).copy(gp).multiplyScalar(2).sub(eye));
    const n = f.cards.length, m = (n - 1) / 2;
    const k = 1 - Math.pow(0.00002, dt);
    f.cards.forEach((o, i) => {
      o.hov += ((i === hover ? 1 : 0) - o.hov) * k;
      o.sel += ((sel.has(i) ? 1 : 0) - o.sel) * k;
      const d = i - m;
      o.pivot.position.set(d * 0.042, -Math.abs(d) * 0.004 + o.sel * 0.034 + o.hov * 0.012, -i * 0.0018 - o.hov * 0.03 - o.sel * 0.006);
      o.pivot.rotation.z = d * -0.11 * (1 - o.hov * 0.5);
      o.pivot.scale.setScalar(1 + o.hov * 0.16);
      o.glow.visible = o.sel > 0.5 || o.hov > 0.5;
      o.glow.material = o.sel > 0.5 ? this.glowSel : this.glowHov;
    });
    f.g.updateMatrixWorld(true);
  }

  // выбранные карты вылетают прямо из руки в кучу
  throwFromHand(seat, idxs, pileStart, onEach) {
    const f = this.fans[seat];
    idxs.forEach((idx, k) => {
      const o = f && f.mine ? f.cards[idx] : null;
      if (!o) return;
      const c = o.c;
      this.scene.attach(c);
      c.scale.setScalar(1);
      o.glow.visible = false;
      const p = this.pilePose(pileStart + k);
      this.fly(c, p.pos, p.quat, 0.55, k * 0.08, () => { this.scene.remove(c); onEach && onEach(k); }, 0.14);
    });
  }

  fanWorld(seat) {
    const f = this.fans[seat];
    if (!f) return V(0, TABLE_Y, 0);
    return f.g.localToWorld(V(0, 0.05, 0));
  }

  fly(mesh, to, qTo, dur, delay = 0, onDone, arc = 0.18) {
    this.flights.push({ mesh, from: mesh.position.clone(), qFrom: mesh.quaternion.clone(), to, qTo, dur, t: -delay, onDone, arc });
  }

  // n карт летят из руки seat в кучу
  throwCards(seat, n, pileStart, onEach) {
    const src = this.fanWorld(seat);
    for (let i = 0; i < n; i++) {
      const c = this.make();
      c.position.copy(src);
      c.quaternion.setFromEuler(new THREE.Euler(-1.2, 0, 0));
      this.scene.add(c);
      const p = this.pilePose(pileStart + i);
      this.fly(c, p.pos, p.quat, 0.55, i * 0.08, () => { this.scene.remove(c); onEach && onEach(i); }, 0.14);
    }
  }

  // раздача: карты летят к веерам
  deal(seats, onArrive) {
    let k = 0;
    for (let round = 0; round < 5; round++) {
      for (const s of seats) {
        const c = this.make();
        c.position.set(0, TABLE_Y + 0.02, 0);
        this.scene.add(c);
        const to = s.to || this.fanWorld(s.seat);
        this.fly(c, to, new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.1, 0, 0)), 0.42, k * 0.045, () => { this.scene.remove(c); onArrive && onArrive(s.seat); }, 0.12);
        k++;
      }
    }
  }

  // вскрытие: последние n карт кучи переворачиваются в ряд
  reveal(ranks, onFlip) {
    this.clearRevealed();
    const n = ranks.length;
    const top = this.pile.splice(this.pile.length - n, n);
    top.forEach((c, i) => {
      this.setFace(c, ranks[i]);
      const to = V((i - (n - 1) / 2) * 0.1, TABLE_Y + 0.002, 0.0);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI));
      this.fly(c, to, q, 0.7, 0.25 + i * 0.22, () => onFlip && onFlip(i), 0.28);
      this.revealed.push(c);
    });
  }

  clearRevealed() { this.revealed.forEach((c) => this.scene.remove(c)); this.revealed = []; }

  update(dt) {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt;
      if (f.t < 0) continue;
      const k = Math.min(1, f.t / f.dur);
      const e = ease(k);
      f.mesh.position.lerpVectors(f.from, f.to, e);
      f.mesh.position.y += Math.sin(k * Math.PI) * f.arc;
      f.mesh.quaternion.slerpQuaternions(f.qFrom, f.qTo, e);
      if (k >= 1) { this.flights.splice(i, 1); f.onDone && f.onDone(); }
    }
  }

  reset() {
    this.flights.forEach((f) => { if (!f.mesh.parent || f.mesh.parent === this.scene) this.scene.remove(f.mesh); });
    this.flights = [];
    this.clearRevealed();
    this.setPile(0);
  }
}

export class Particles {
  constructor(scene) {
    this.scene = scene;
    // дым: все клубы — один меш с инстансами (раньше 260 отдельных спрайтов и столько же вызовов отрисовки)
    this.smokeTex = T.toTex(T.smokeCanvas());
    this.smokeTex.wrapS = this.smokeTex.wrapT = THREE.ClampToEdgeWrapping;
    this.SN = 260;
    this.smokes = [];
    for (let i = 0; i < this.SN; i++) this.smokes.push({ alive: false, pos: V(), age: 0, life: 1, vel: V(), size: 0.05, op: 0.3, rot: 0, ang: 0, scale: 0.05, opacity: 0 });
    const sg = new THREE.InstancedBufferGeometry();
    const pl = new THREE.PlaneGeometry(1, 1);
    sg.index = pl.index;
    sg.setAttribute('position', pl.attributes.position);
    sg.setAttribute('uv', pl.attributes.uv);
    this.sPos = new THREE.InstancedBufferAttribute(new Float32Array(this.SN * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.sDat = new THREE.InstancedBufferAttribute(new Float32Array(this.SN * 3), 3).setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('iPos', this.sPos);
    sg.setAttribute('iDat', this.sDat);
    sg.instanceCount = 0;
    const sm = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, color: { value: new THREE.Color('#c9c4bd') } }]),
      vertexShader: /* glsl */`
        attribute vec3 iPos; attribute vec3 iDat; // размер, прозрачность, поворот
        varying vec2 vUv; varying float vOp;
        #include <common>
        #include <fog_pars_vertex>
        void main() {
          vUv = uv; vOp = iDat.y;
          vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
          vec2 p = position.xy * iDat.x;
          float c = cos(iDat.z), s = sin(iDat.z);
          mvPosition.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform vec3 color;
        varying vec2 vUv; varying float vOp;
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          vec4 t = texture2D(map, vUv);
          gl_FragColor = vec4(color * t.rgb, t.a * vOp);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      transparent: true, depthWrite: false, fog: true,
    });
    sm.uniforms.map.value = this.smokeTex;
    this.smokeGroup = new THREE.Mesh(sg, sm);
    this.smokeGroup.frustumCulled = false;
    this.smokeGroup.visible = false;
    scene.add(this.smokeGroup);
    this.si = 0;
    // рвота
    this.N = 900;
    const geo = new THREE.IcosahedronGeometry(0.014, 1);
    const vm = mat({ color: '#ffffff', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.1, keep: true });
    this.v = new THREE.InstancedMesh(geo, vm, this.N);
    this.v.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.v.frustumCulled = false;
    const cols = ['#9bb33a', '#b7a33c', '#7f8f2a', '#c9b660', '#6e5a22', '#a8c24a'].map((c) => new THREE.Color(c));
    this.vp = [];
    for (let i = 0; i < this.N; i++) {
      this.v.setColorAt(i, cols[i % cols.length]);
      this.vp.push({ p: V(0, -10, 0), vel: V(), alive: false, stuck: false, s: 1 });
    }
    this.v.instanceColor.needsUpdate = true;
    this.v.castShadow = true;
    scene.add(this.v);
    this.vi = 0;
    this.vDirty = true;
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.puddles = [];
    this.puddleM = mat({ keep: true, color: '#7d8a2c', roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -2 });
    this.puddleGeo = new THREE.CircleGeometry(1, 20);
    this.onSplat = null;
  }

  smoke(pos, vel, size = 0.04, life = 3, op = 0.28) {
    const s = this.smokes[this.si++ % this.SN];
    s.alive = true;
    s.pos.copy(pos);
    s.vel.copy(vel);
    s.age = 0; s.life = life * (0.8 + Math.random() * 0.4); s.size = size; s.op = op;
    s.rot = (Math.random() - 0.5) * 0.8;
    s.ang = Math.random() * 6.28;
    s.scale = size; s.opacity = 0;
  }

  vomit(pos, dir, dt) {
    const n = Math.ceil(dt * 260);
    for (let i = 0; i < n; i++) {
      const o = this.vp[this.vi++ % this.N];
      o.alive = true; o.stuck = false;
      o.p.copy(pos).add(V((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.01, (Math.random() - 0.5) * 0.02));
      const sp = 1.3 + Math.random() * 1.1;
      o.vel.copy(dir).multiplyScalar(sp).add(V((Math.random() - 0.5) * 0.45, Math.random() * 0.4, (Math.random() - 0.5) * 0.45));
      o.s = 0.6 + Math.random() * 1.4;
    }
    this.vDirty = true;
  }

  addPuddle(p, onTable) {
    let near = this.puddles.find((q) => q.position.distanceTo(p) < q.scale.x * 0.8 && q.userData.table === onTable);
    if (near) { near.userData.target = Math.min(onTable ? 0.16 : 0.34, near.userData.target + 0.006); return; }
    if (this.puddles.length > 40) return;
    const m = new THREE.Mesh(this.puddleGeo, this.puddleM);
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, (onTable ? TABLE_Y : 0) + 0.0015, p.z);
    m.scale.set(0.001, 0.001 * (0.7 + Math.random() * 0.5), 1);
    m.userData = { target: 0.03 + Math.random() * 0.03, table: onTable, asp: 0.7 + Math.random() * 0.5 };
    m.receiveShadow = true;
    this.scene.add(m);
    this.puddles.push(m);
  }

  clearMess() {
    this.puddles.forEach((p) => this.scene.remove(p));
    this.puddles = [];
    this.vp.forEach((o) => { o.alive = false; o.stuck = false; o.p.set(0, -10, 0); });
    this.vDirty = true;
  }

  update(dt) {
    let n = 0;
    const P = this.sPos.array, D = this.sDat.array;
    for (let i = 0; i < this.SN; i++) {
      const u = this.smokes[i];
      if (!u.alive) continue;
      u.age += dt;
      if (u.age >= u.life) { u.alive = false; continue; }
      const k = u.age / u.life;
      u.vel.y += 0.03 * dt;
      u.vel.multiplyScalar(1 - dt * 0.6);
      u.vel.x += Math.sin(u.age * 2 + i) * 0.01 * dt;
      u.pos.addScaledVector(u.vel, dt);
      u.ang += u.rot * dt;
      P[n * 3] = u.pos.x; P[n * 3 + 1] = u.pos.y; P[n * 3 + 2] = u.pos.z;
      D[n * 3] = u.size + k * 0.3;
      D[n * 3 + 1] = u.op * Math.min(1, u.age * 6) * (1 - k) * (1 - k * 0.4);
      D[n * 3 + 2] = u.ang;
      n++;
    }
    this.smokeGroup.geometry.instanceCount = n;
    this.smokeGroup.visible = n > 0;
    if (n) { this.sPos.needsUpdate = true; this.sDat.needsUpdate = true; }

    // рвота: матрицы пересчитываем, только пока что-то летит
    const g = -9.8;
    let splat = 0, moving = false;
    const sv = this._sv || (this._sv = V());
    for (let i = 0; i < this.N; i++) {
      const o = this.vp[i];
      if (!o.alive || (o.stuck && !this.vDirty)) continue;
      if (!o.stuck) {
        moving = true;
        const py = o.p.y;
        o.vel.y += g * dt;
        o.p.addScaledVector(o.vel, dt);
        const r = Math.hypot(o.p.x, o.p.z);
        if (py >= TABLE_Y && o.p.y <= TABLE_Y + 0.004 && r < TABLE_R) {
          o.p.y = TABLE_Y + 0.004; o.stuck = true; splat++;
          if (Math.random() < 0.18) this.addPuddle(o.p, true);
        } else if (o.p.y <= 0.004) {
          o.p.y = 0.004; o.stuck = true; splat++;
          if (Math.random() < 0.18) this.addPuddle(o.p, false);
        }
      }
      const sc = o.stuck ? o.s * 0.8 : o.s;
      this.m4.compose(o.p, this.q, sv.set(sc, o.stuck ? sc * 0.35 : sc, sc));
      this.v.setMatrixAt(i, this.m4);
    }
    if (moving || splat || this.vDirty) {
      if (this.vDirty) for (let i = 0; i < this.N; i++) if (!this.vp[i].alive) { this.m4.makeTranslation(0, -10, 0); this.v.setMatrixAt(i, this.m4); }
      this.v.instanceMatrix.needsUpdate = true;
      this.vDirty = false;
    }
    if (splat && this.onSplat) this.onSplat(splat);
    for (const p of this.puddles) {
      const t = p.userData.target;
      const s = p.scale.x + (t - p.scale.x) * Math.min(1, dt * 3);
      p.scale.set(s, s * p.userData.asp, 1);
    }
  }
}

let buttRes;
export function makeButt() {
  buttRes = buttRes || {
    fg: new THREE.CylinderGeometry(0.0042, 0.0042, 0.022, 10), pg: new THREE.CylinderGeometry(0.0042, 0.0042, 0.01, 10),
    fm: mat({ color: '#c9793a', roughness: 0.7 }), pm: mat({ color: '#6a6560', roughness: 0.9 }),
  };
  const g = new THREE.Group();
  const f = new THREE.Mesh(buttRes.fg, buttRes.fm);
  f.rotation.z = Math.PI / 2; g.add(f);
  const p = new THREE.Mesh(buttRes.pg, buttRes.pm);
  p.rotation.z = Math.PI / 2; p.position.x = 0.016; g.add(p);
  return g;
}

export function addButt(ashtray) {
  const g = makeButt();
  const n = ashtray.userData.butts.length;
  const a = n * 2.1 + Math.random(), d = 0.02 + Math.random() * 0.03;
  g.position.set(Math.cos(a) * d, 0.012 + (n % 5) * 0.002, Math.sin(a) * d);
  g.rotation.y = Math.random() * 6.28;
  g.rotation.z = 0.2;
  ashtray.add(g);
  ashtray.userData.butts.push(g);
  if (ashtray.userData.butts.length > 18) ashtray.remove(ashtray.userData.butts.shift());
}
