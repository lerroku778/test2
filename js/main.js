import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { StylePass } from './post.js';
import { STYLE, STYLES, STYLE_NAMES, TOON } from './style.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as T from './textures.js';
import { buildWorld, TABLE_Y } from './world.js';
import { Character } from './characters.js';
import { Cards, Particles, addButt, makeButt } from './fx.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { CHARS, RANK_TABLE, RANK_MANY, RANK_ONE, SHOTS, canCall } from './engine.js';

const $ = (id) => document.getElementById(id);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const esc = (s) => String(s ?? '');

// ---------- рендер ----------
const isMobile = matchMedia('(pointer: coarse)').matches;
let quality = store.get('gfx', isMobile ? 'mid' : 'high');
const Q = { high: { pr: 1.75, samples: 4, shadow: 2048 }, mid: { pr: 1.25, samples: 0, shadow: 1024 }, low: { pr: 0.9, samples: 0, shadow: 512 } }[quality] || { pr: 1.25, samples: 0, shadow: 1024 };

const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pr));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = TOON ? 1.05 : 1.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
T.setAniso(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0c0907');
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.02, 200);
camera.position.set(-5, 2.2, 0);

const rt = new THREE.WebGLRenderTarget(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: Q.samples });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.45, 2.2);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new StylePass(scene, camera, STYLE);
composer.addPass(grade);
grade.setSize(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());

// ---------- сцена ----------
const audio = new Audio();
const clock = new THREE.Clock();
let world, chars = [], cards, particles;
const cardImg = {};
const portraits = [];

const G = {
  st: null, pid: null, mySeat: -1, code: '', solo: false, recvAt: 0,
  screen: 'loading', timers: [], sel: new Set(), handKey: '',
  visualShots: [0, 0, 0, 0], visualDead: [false, false, false, false],
  look: { x: 0, y: 0, tx: 0, ty: 0 }, attn: null, shake: 0, flash: 0, poison: 0,
  spectate: false, lastSmoke: 0, camMode: 'orbit', fade: 1, dealing: false,
};

const net = new Net(onMsg);

function later(ms, fn) { const id = setTimeout(fn, ms); G.timers.push(id); return id; }
function clearTimers() { G.timers.forEach(clearTimeout); G.timers = []; }

// ---------- загрузка ----------
async function boot() {
  const setP = (p, msg) => { $('loadBar').style.width = `${p}%`; if (msg) $('loadMsg').textContent = msg; };
  setP(5, 'Протираем стаканы…');
  try {
    await Promise.race([
      Promise.all(['400 40px "Rubik Dirt"', '400 40px "Yeseva One"', '600 20px "Onest"', '700 20px "JetBrains Mono"'].map((f) => document.fonts.load(f, 'АБВ ABC'))),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch { /* без шрифтов тоже играем */ }
  await nextFrame();
  setP(15, 'Раскладываем брусчатку…');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  await nextFrame();
  world = buildWorld(scene);
  world.lights.sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  setP(45, 'Рассаживаем гостей…');
  await nextFrame();
  particles = new Particles(scene);
  grade.hide.push(particles.smokeGroup);
  cards = new Cards(scene);
  for (let i = 0; i < 4; i++) {
    const ch = new Character(CHARS[i].key, i, particles);
    scene.add(ch.root);
    scene.add(ch.cig);
    cards.attachFan(ch);
    chars.push(ch);
  }
  particles.onSplat = (() => { let last = 0; return () => { const t = performance.now(); if (t - last > 90) { last = t; audio.splat(); } }; })();
  for (const k of ['K', 'Q', 'A', 'J', 'back']) cardImg[k] = cards.canvases[k].toDataURL('image/png');
  $('packImg').src = T.packCanvas().toDataURL('image/jpeg', 0.85);
  setP(70, 'Наливаем Чеколейтор…');
  await nextFrame();
  for (let i = 0; i < 10; i++) stepChars(1 / 30, i / 30);
  // прогрев: всё, что появляется посреди партии, компилируется сейчас, а не во время игры
  const warm = new THREE.Group();
  for (const r of ['K', 'Q', 'A', 'J']) warm.add(cards.make(r));
  warm.add(makeButt());
  const pud = new THREE.Mesh(particles.puddleGeo, particles.puddleM); warm.add(pud);
  warm.position.set(0, TABLE_Y + 0.05, 0);
  scene.add(warm);
  chars.forEach((c) => { c.cig.visible = true; });
  particles.smokes[0].visible = true;
  renderer.compile(scene, camera);
  composer.render(0.016);
  scene.remove(warm);
  chars.forEach((c) => { c.cig.visible = false; });
  particles.smokes[0].visible = false;
  setP(88, 'Зажигаем гирлянды…');
  await nextFrame();
  renderPortraits();
  setP(100, 'Готово');
  await nextFrame();
  $('loader').style.opacity = '0';
  setTimeout(() => $('loader').remove(), 900);
  G.fade = 1;
  showScreen('menu');
  requestAnimationFrame(loop);
}

function renderPortraits() {
  const w = 240, h = 300;
  const pr = renderer.getPixelRatio();
  const pc = new THREE.PerspectiveCamera(30, w / h, 0.05, 30);
  const out = document.createElement('canvas');
  out.width = w * 2; out.height = h * 2;
  const g = out.getContext('2d');
  renderer.setScissorTest(true);
  for (let i = 0; i < 4; i++) {
    const ch = chars[i];
    pc.position.copy(ch.root.localToWorld(V(0.02, 1.22, 0.95)));
    pc.lookAt(ch.root.localToWorld(V(0, 1.12, 0)));
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    renderer.render(scene, pc);
    g.clearRect(0, 0, out.width, out.height);
    g.drawImage(canvas, 0, canvas.height - h * pr, w * pr, h * pr, 0, 0, out.width, out.height);
    portraits[i] = out.toDataURL('image/jpeg', 0.88);
  }
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
}

// ---------- экраны ----------
function showScreen(s) {
  G.screen = s;
  for (const id of ['menu', 'lobby', 'hud']) $(id).classList.toggle('hidden', id !== s);
  if (s !== 'hud') $('over').classList.add('hidden');
  if (s === 'menu') { G.camMode = 'orbit'; $('nameIn').value = $('nameIn').value || store.get('name', ''); }
}

function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hide');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hide'), ms);
}

function stamp(big, small = '', cls = '', ms = 1700) {
  const el = $('stamp');
  el.innerHTML = '';
  const s = document.createElement('div');
  s.className = 's';
  const b = document.createElement('div'); b.className = `big ${cls}`; b.textContent = big;
  s.appendChild(b);
  if (small) { const sm = document.createElement('div'); sm.className = 'small'; sm.textContent = small; s.appendChild(sm); }
  el.appendChild(s);
  clearTimeout(el._h);
  el._h = setTimeout(() => { s.classList.add('out'); setTimeout(() => s.remove(), 450); }, ms);
}

function feed(text) {
  const f = $('feed');
  const d = document.createElement('div');
  d.textContent = text;
  f.prepend(d);
  while (f.children.length > 5) f.lastChild.remove();
}

const nm = (i) => (G.st && G.st.seats[i] ? (i === G.mySeat ? 'Ты' : G.st.seats[i].nm || CHARS[i].name) : CHARS[i].name);
const who = (i) => (i === G.mySeat ? 'Ты' : nmFull(i));
const say = (i, you, verb) => (i === G.mySeat ? you : `${nmFull(i)} ${verb}`);
const nmFull = (i) => (G.st && G.st.seats[i] ? G.st.seats[i].nm || CHARS[i].name : CHARS[i].name);

// ---------- меню ----------
function myName() {
  const v = $('nameIn').value.trim().slice(0, 16);
  if (v) store.set('name', v);
  return v || 'Игрок';
}

async function goOnline(create) {
  audio.init();
  $('menuErr').textContent = '';
  const code = $('codeIn').value.trim().toUpperCase();
  if (!create && !code) { $('menuErr').textContent = 'Введи код комнаты — его показывает тот, кто её создал.'; return; }
  const btn = create ? $('createBtn') : $('joinBtn');
  btn.disabled = true;
  try {
    const m = await net.connect(myName(), { create, code });
    G.pid = m.pid; G.code = m.code; G.solo = false;
    history.replaceState(null, '', `${location.pathname}?room=${m.code}`);
  } catch (e) {
    $('menuErr').textContent = e.message || 'Не получилось подключиться.';
  } finally { btn.disabled = false; }
}

function goSolo() {
  audio.init();
  G.pid = 'me'; G.code = 'СОЛО'; G.solo = true;
  net.playLocal(myName());
}

function leave() {
  net.close();
  clearTimers();
  G.st = null; G.mySeat = -1; G.spectate = false;
  resetVisuals(true);
  history.replaceState(null, '', location.pathname);
  showScreen('menu');
}

// ---------- сообщения ----------
function onMsg(m) {
  if (m.t === 'st') onState(m.st);
  else if (m.t === 'closed') { if (G.screen !== 'menu') { toast('Связь с сервером потеряна'); leave(); } }
  else if (m.t === 'err') $('menuErr').textContent = m.e;
}

function onState(st) {
  const prev = G.st;
  G.st = st;
  G.recvAt = Date.now();
  G.mySeat = st.seats.findIndex((s) => s.pid === G.pid);
  const inGame = st.ph !== 'lobby';
  const fresh = !prev || prev.gid !== st.gid;

  if (!inGame) {
    if (G.screen !== 'lobby') { resetVisuals(true); showScreen('lobby'); }
    renderLobby();
    syncStatic(st);
  } else {
    if (G.screen !== 'hud') { showScreen('hud'); }
    if (fresh) { clearTimers(); resetVisuals(prev && prev.ph !== 'lobby' && prev.ph !== 'over'); syncAll(st); }
    else handleEvent(prev, st);
  }
  // сигареты
  st.seats.forEach((s, i) => {
    const was = prev ? prev.seats[i].smk : s.smk;
    if (s.smk && s.smk !== was && !G.visualDead[i]) {
      chars[i].startSmoke(12);
      if (i === G.mySeat) { audio.lighter(); later(900, () => audio.inhale()); }
    }
  });
  G.spectate = G.mySeat < 0 || (G.visualDead[G.mySeat] && inGame);
  renderHud();
}

function resetVisuals(clearMess) {
  cards.reset();
  if (clearMess) particles.clearMess();
  world.bottles.forEach((b) => b.reset());
  chars.forEach((c, i) => { c.setDead(false); c.action = null; cards.setFan(i, 0); });
  G.visualShots = [0, 0, 0, 0];
  G.visualDead = [false, false, false, false];
  G.poison = 0;
  $('splat').style.opacity = '0';
  $('over').classList.add('hidden');
}

function syncStatic(st) {
  chars.forEach((c, i) => { c.hideHead(i === G.mySeat && !G.spectate); });
}

function syncAll(st) {
  cards.setPile(st.pile);
  st.seats.forEach((s, i) => {
    G.visualShots[i] = s.shots;
    G.visualDead[i] = !s.alive;
    world.bottles[i].setLevel((SHOTS - s.shots) / SHOTS);
    if (!s.alive) world.bottles[i].poison();
    chars[i].setDead(!s.alive, true);
    cards.setFan(i, i === G.mySeat ? 0 : s.n);
  });
  if ((st.ph === 'reveal' || st.ph === 'drink') && st.rev) {
    cards.setPile(st.pile);
    cards.reveal(st.rev.c);
  }
  if (st.ph === 'over') later(300, showOver);
  G.handKey = '';
}

function evKey(e) { return e ? `${e.k}:${e.id || ''}:${e.r || ''}:${e.s ?? ''}` : ''; }

function handleEvent(prev, st) {
  const e = st.ev;
  if (evKey(e) === evKey(prev.ev)) { // только обновление (сигарета, имена)
    syncCounts(st, true);
    return;
  }
  const me = G.mySeat;
  switch (e.k) {
    case 'deal': {
      clearTimers();
      cards.clearRevealed();
      cards.setPile(0);
      chars.forEach((c) => { c.lookAt = null; });
      const seats = [];
      st.seats.forEach((s, i) => { cards.setFan(i, 0); if (s.alive) seats.push({ seat: i, to: i === me ? camFront(0.5) : null }); });
      const cnt = [0, 0, 0, 0];
      G.dealing = true;
      cards.deal(seats, (i) => { cnt[i]++; if (i !== me) cards.setFan(i, cnt[i]); audio.card(); });
      later(1600, () => { G.dealing = false; syncCounts(G.st, false); });
      stamp(RANK_TABLE[st.table].toUpperCase(), `Раунд ${st.round}`, '', 1500);
      feed(`Раунд ${st.round}: ${RANK_TABLE[st.table].toLowerCase()}. ${say(st.turn, 'Ты начинаешь', 'начинает')}.`);
      audio.glass();
      break;
    }
    case 'play': {
      const s = e.s, n = e.n;
      chars[s].play('throw');
      cards.setFan(s, s === me ? 0 : st.seats[s].n);
      cards.throwCards(s, n, prev.pile, (i) => { audio.cardSlap(); if (i === n - 1) cards.setPile(st.pile); });
      for (let i = 0; i < n; i++) later(i * 80, () => audio.card());
      const claim = `${n} ${n === 1 ? RANK_ONE[st.table] : RANK_MANY[st.table]}`;
      feed(`${nm(s)}: «${claim}»`);
      chars.forEach((c, i) => { if (i !== s) c.lookAt = chars[s].head.getWorldPosition(V()); });
      break;
    }
    case 'liar': {
      const r = st.rev;
      let delay = 0;
      if (st.pile > prev.pile) {
        const n = st.pile - prev.pile;
        chars[r.on].play('throw');
        cards.setFan(r.on, r.on === me ? 0 : st.seats[r.on].n);
        cards.throwCards(r.on, n, prev.pile, () => { audio.cardSlap(); cards.setPile(st.pile); });
        feed(`${nm(r.on)}: «${n} ${n === 1 ? RANK_ONE[st.table] : RANK_MANY[st.table]}», последние карты.`);
        delay = 800;
      }
      later(delay, () => {
        cards.setPile(st.pile);
        const tgt = chars[r.on].head.getWorldPosition(V()).add(V(0, 0.1, 0));
        chars[r.by].play('point', { target: tgt });
        chars.forEach((c, i) => { c.lookAt = i === r.by ? tgt : chars[r.by].head.getWorldPosition(V()); });
        G.attn = { p: chars[r.on].head.getWorldPosition(V()), until: performance.now() + 3500, w: 0.55 };
        stamp('ЛЖЕЦ!', `${who(r.by)} → ${who(r.on)}${r.f ? ' · карты остались только у одного' : ''}`, 'red', 1500);
        audio.liar();
        G.shake = 0.5; G.flash = 1;
        feed(`«Лжец!» ${who(r.by)} → ${who(r.on)}`);
      });
      later(delay + 1100, () => cards.reveal(r.c, () => audio.flip()));
      later(delay + 2500, () => {
        const drinker = r.lied ? r.on : r.by;
        if (r.lied) { stamp('ВРАЛ!', `${drinker === me ? 'Тебе' : nmFull(drinker)} пить`, 'red', 1400); audio.lie(); chars[r.on].play('react', { brow: -1, mouth: 0.9, lean: 0.1 }); }
        else { stamp('ЧЕСТНО', `${drinker === me ? 'Тебе' : nmFull(drinker)} пить`, 'bone', 1400); audio.truth(); chars[r.by].play('react', { brow: 1, mouth: 0.9 }); }
        feed(r.lied ? `Ложь! ${say(r.on, 'Ты пьёшь', 'пьёт')}.` : `Правда. ${say(r.by, 'Ты пьёшь', 'пьёт')}.`);
      });
      break;
    }
    case 'drink': {
      const d = st.dr, s = d.s;
      const ch = chars[s];
      ch.play('drink');
      chars.forEach((c, i) => { c.lookAt = i === s ? null : ch.head.getWorldPosition(V()); });
      G.attn = { p: ch.head.getWorldPosition(V()), until: performance.now() + 7000, w: 0.6 };
      audio.heartbeat(5, 0.7);
      later(400, () => audio.glass());
      const shotsBefore = d.n - 1;
      feed(`${say(s, 'Ты пьёшь', 'пьёт')}. Шанс отравиться: 1/${SHOTS - shotsBefore}.`);
      later(3700, () => {
        if (d.dead) {
          ch.play('poison');
          world.bottles[s].poison();
          audio.retch();
          stamp('ОТРАВЛЕН', s === me ? 'Ты выбываешь' : `${nmFull(s)} выбывает`, 'green', 2200);
          if (s === me) { G.poison = 1; paintSplat(); G.shake = 0.8; }
          later(4400, () => { G.visualDead[s] = true; audio.death(); renderHud(); if (s === me) later(1800, () => { G.spectate = true; toast('Ты вне игры. Смотри, чем кончится.'); }); });
          feed(`${say(s, 'Ты выбываешь', 'выбывает')}: яд.`);
        } else {
          ch.play('survive');
          audio.exhale(); later(300, () => audio.relief());
          const left = SHOTS - d.n;
          stamp('ПРОНЕСЛО', `Следующий глоток: шанс 1/${left}`, '', 1600);
          feed(`${say(s, 'Ты живёшь', 'живёт')} дальше. Осталось глотков: ${left}.`);
        }
      });
      break;
    }
    case 'over': {
      later(1200, () => {
        const w = st.win;
        stamp(w === me ? 'ТВОЙ БАР' : 'КОНЕЦ', w >= 0 ? `Последний за столом: ${w === me ? 'ты' : nmFull(w)}` : '', '', 2400);
        audio.win();
      });
      later(3400, showOver);
      break;
    }
    case 'turn': break;
  }
  if (e.k !== 'deal') syncCounts(st, e.k === 'play');
}

function syncCounts(st, skipFanFor) {
  if (G.dealing) return;
  st.seats.forEach((s, i) => {
    if (!(skipFanFor && st.ev && st.ev.s === i)) cards.setFan(i, i === G.mySeat ? 0 : s.n);
  });
}

function showOver() {
  const st = G.st;
  if (!st || st.ph !== 'over') return;
  const w = st.win;
  $('overTitle').textContent = w === G.mySeat ? 'Бар твой' : w >= 0 ? `Победа: ${nmFull(w)}` : 'Живых не осталось';
  $('overSub').textContent = w === G.mySeat ? 'Все остальные выбыли. Чеколейтор тебя пощадил.' : 'Чеколейтор сегодня был не на твоей стороне.';
  $('againBtn').disabled = G.mySeat < 0;
  $('over').classList.remove('hidden');
}

function paintSplat() {
  const c = $('splat');
  c.width = innerWidth; c.height = innerHeight;
  const g = c.getContext('2d');
  const r = T.rng(Date.now() % 1000);
  for (let i = 0; i < 26; i++) {
    const x = r() * c.width, y = c.height * (0.3 + r() * 0.8), rad = 30 + r() * 140;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(150,175,60,0.85)'); gr.addColorStop(0.7, 'rgba(120,140,40,0.55)'); gr.addColorStop(1, 'rgba(100,120,30,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 6.283); g.fill();
    for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(200,190,90,0.7)'; g.beginPath(); g.arc(x + (r() - 0.5) * rad, y + (r() - 0.5) * rad, 3 + r() * 9, 0, 6.283); g.fill(); }
  }
  c.style.transition = 'none'; c.style.opacity = '1';
  setTimeout(() => { c.style.transition = 'opacity 6s ease'; c.style.opacity = '0'; }, 1500);
}

function camFront(dist) {
  return camera.localToWorld(V(0, -0.25, -dist));
}

// ---------- лобби ----------
function renderLobby() {
  const st = G.st;
  $('roomCode').textContent = G.code;
  $('copyBtn').classList.toggle('hidden', G.solo);
  const box = $('chars');
  if (!box.children.length) {
    CHARS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'char';
      b.innerHTML = '<img alt=""><div class="info"><div class="nm"></div><div class="tg"></div><div class="who"></div></div>';
      b.querySelector('img').src = portraits[i] || '';
      b.querySelector('.nm').textContent = c.name;
      b.querySelector('.tg').textContent = c.tag;
      b.addEventListener('click', () => {
        audio.init(); audio.select();
        const s = G.st && G.st.seats[i];
        if (!s) return;
        if (s.pid === G.pid) net.send({ t: 'stand' });
        else if (!s.pid) net.send({ t: 'sit', seat: i });
        else toast('Место занято');
      });
      box.appendChild(b);
    });
  }
  [...box.children].forEach((b, i) => {
    const s = st.seats[i];
    b.classList.toggle('mine', s.pid === G.pid);
    b.classList.toggle('taken', !!s.pid);
    b.querySelector('.who').textContent = s.pid === G.pid ? 'Ты за этим местом' : s.pid ? s.nm : 'Свободно';
  });
  const pp = $('people');
  pp.innerHTML = '';
  const lab = document.createElement('span'); lab.textContent = G.solo ? 'Одиночная игра' : 'В комнате:'; pp.appendChild(lab);
  if (!G.solo) (st.people || []).forEach((p) => { const c = document.createElement('span'); c.className = 'chip' + (p.pid === G.pid ? ' me' : ''); c.textContent = p.nm; pp.appendChild(c); });
  $('startBtn').disabled = G.mySeat < 0;
  $('startBtn').textContent = G.mySeat < 0 ? 'Сначала сядь за стол' : 'Начать партию';
}

// ---------- HUD ----------
const plateEls = [];
function renderHud() {
  const st = G.st;
  if (!st || G.screen !== 'hud') return;
  $('roomTag').innerHTML = '';
  const rt1 = document.createElement('span'); rt1.textContent = G.solo ? 'Против ботов' : 'Комната ';
  $('roomTag').appendChild(rt1);
  if (!G.solo) { const b = document.createElement('b'); b.textContent = G.code; $('roomTag').appendChild(b); }
  $('tableImg').src = cardImg[st.table];
  $('tableName').textContent = RANK_TABLE[st.table];
  $('roundName').textContent = `Раунд ${st.round}`;

  // таблички
  const box = $('plates');
  st.seats.forEach((s, i) => {
    let el = plateEls[i];
    if (!el) {
      el = document.createElement('div'); el.className = 'plate';
      el.innerHTML = '<div class="nm"></div><div class="meta"><div class="cnt"></div><div class="pips"></div><span class="risk"></span></div>';
      box.appendChild(el); plateEls[i] = el;
    }
    const n = el.querySelector('.nm');
    n.textContent = s.nm || CHARS[i].name;
    if (s.bot) { const b = document.createElement('span'); b.className = 'bot'; b.textContent = 'БОТ'; n.appendChild(b); }
    el.classList.toggle('turn', st.ph === 'turn' && st.turn === i);
    el.classList.toggle('dead', G.visualDead[i]);
    el.querySelector('.cnt').innerHTML = '<i></i>'.repeat(G.visualDead[i] ? 0 : s.n);
    el.querySelector('.pips').innerHTML = pipsHtml(i);
    el.querySelector('.risk').textContent = G.visualDead[i] ? '☠' : `1/${SHOTS - G.visualShots[i]}`;
    el.dataset.me = i === G.mySeat && !G.spectate ? '1' : '';
  });

  // моя панель
  const mp = $('mePanel');
  if (G.mySeat >= 0) {
    mp.classList.remove('hidden');
    mp.innerHTML = '';
    const a = document.createElement('div'); a.className = 'nm'; a.textContent = CHARS[G.mySeat].name; mp.appendChild(a);
    const l = document.createElement('div'); l.className = 'label'; l.textContent = 'Глотков выпито'; mp.appendChild(l);
    const p = document.createElement('div'); p.className = 'pips'; p.innerHTML = pipsHtml(G.mySeat); mp.appendChild(p);
    const r = document.createElement('div'); r.className = 'risk';
    r.textContent = G.visualDead[G.mySeat] ? 'Отравлен' : `Риск следующего глотка: 1/${SHOTS - G.visualShots[G.mySeat]}`;
    mp.appendChild(r);
  } else mp.classList.add('hidden');

  renderHand();
  renderStatus();
}

function pipsHtml(i) {
  let h = '';
  for (let k = 0; k < SHOTS; k++) h += `<i class="${k < G.visualShots[i] ? (G.visualDead[i] && k === G.visualShots[i] - 1 ? 'dead' : 'on') : ''}"></i>`;
  return h;
}

function renderHand() {
  const st = G.st;
  const hand = G.mySeat >= 0 ? st.seats[G.mySeat].hand : [];
  const key = `${st.round}|${hand.join('')}`;
  const box = $('hand');
  if (key !== G.handKey) {
    const dealt = st.ev && st.ev.k === 'deal' && !G.handKey.startsWith(`${st.round}|`);
    G.handKey = key;
    G.sel.clear();
    box.innerHTML = '';
    hand.forEach((c, i) => {
      const el = document.createElement('button');
      el.className = 'card' + (dealt ? ' deal-in' : '');
      el.style.backgroundImage = `url(${cardImg[c]})`;
      const r = (i - (hand.length - 1) / 2) * 5;
      el.style.setProperty('--r', `${r}deg`);
      el.style.transform = `rotate(${r}deg) translateY(${Math.abs(r) * 0.8}px)`;
      if (dealt) el.style.animationDelay = `${0.35 + i * 0.12}s`;
      el.setAttribute('aria-label', RANK_ONE[c]);
      const k = document.createElement('span'); k.className = 'k'; k.textContent = i + 1; el.appendChild(k);
      el.addEventListener('click', () => toggleCard(i));
      box.appendChild(el);
    });
  }
  [...box.children].forEach((el, i) => el.classList.toggle('sel', G.sel.has(i)));
  const myTurn = st.ph === 'turn' && st.turn === G.mySeat && G.mySeat >= 0;
  $('playBtn').disabled = !myTurn || G.sel.size < 1 || G.sel.size > 3;
  $('playBtn').textContent = G.sel.size ? `Выложить ${G.sel.size}` : 'Выложить';
  $('liarBtn').disabled = !(G.mySeat >= 0 && canCall(st, G.mySeat));
  const alive = G.mySeat >= 0 && !G.visualDead[G.mySeat];
  $('playBtn').parentElement.classList.toggle('hidden', !alive);
  box.classList.toggle('hidden', !alive);
  updateSmokeBtn();
}

function toggleCard(i) {
  const st = G.st;
  if (!st || G.mySeat < 0) return;
  const hand = st.seats[G.mySeat].hand;
  if (i >= hand.length) return;
  audio.init();
  if (G.sel.has(i)) G.sel.delete(i);
  else if (G.sel.size < 3) G.sel.add(i);
  else { toast('Не больше трёх карт за ход'); return; }
  audio.select();
  renderHand();
}

function playSelected() {
  if ($('playBtn').disabled) return;
  net.send({ t: 'play', a: [...G.sel] });
  G.sel.clear();
}

function callLiar() {
  if ($('liarBtn').disabled) return;
  net.send({ t: 'liar' });
}

function smoke() {
  if ($('smokeBtn').disabled) return;
  audio.init();
  G.lastSmoke = Date.now();
  net.send({ t: 'smoke' });
  updateSmokeBtn();
}

function updateSmokeBtn() {
  const st = G.st;
  const left = Math.ceil((13000 - (Date.now() - G.lastSmoke)) / 1000);
  const can = st && G.mySeat >= 0 && !G.visualDead[G.mySeat] && left <= 0;
  $('smokeBtn').disabled = !can;
  $('smokeSub').textContent = left > 0 ? `Куришь… ${left} с` : 'Chapman Red';
}

function renderStatus() {
  const st = G.st;
  const el = $('status');
  let txt = '', you = false;
  const me = G.mySeat;
  const table = RANK_MANY[st.table];
  if (st.ph === 'deal') txt = `Раздача. ${RANK_TABLE[st.table]}.`;
  else if (st.ph === 'turn') {
    if (st.turn === me) {
      you = true;
      txt = st.last ? `${nmFull(st.last.s)}: «${st.last.n} ${st.last.n === 1 ? RANK_ONE[st.table] : table}». Ходи или жми «Лжец!»` : `Твой ход: выложи 1–3 карты как ${table}`;
    } else txt = st.last ? `Ходит ${nmFull(st.turn)} · ${who(st.last.s)}: «${st.last.n} ${st.last.n === 1 ? RANK_ONE[st.table] : table}»` : `Ходит ${nmFull(st.turn)}`;
  } else if (st.ph === 'reveal') txt = `Вскрытие: ${who(st.rev.by)} → ${who(st.rev.on)}`;
  else if (st.ph === 'drink') txt = `${say(st.dr.s, 'Ты пьёшь', 'пьёт')} Чеколейтор…`;
  else if (st.ph === 'over') txt = 'Партия окончена';
  if (G.spectate && me >= 0 && G.visualDead[me] && st.ph !== 'over') txt = `Ты вне игры · ${txt}`;
  el.textContent = txt;
  el.classList.toggle('you', you);
}

function updatePlates() {
  if (!G.st || G.screen !== 'hud') return;
  const w = innerWidth, h = innerHeight;
  plateEls.forEach((el, i) => {
    if (!el) return;
    if (el.dataset.me === '1') { el.style.opacity = '0'; return; }
    const p = chars[i].head.localToWorld(V(0, 0.42, 0)).project(camera);
    const vis = p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2;
    el.style.opacity = vis ? '1' : '0';
    el.style.left = `${clamp((p.x * 0.5 + 0.5) * w, 90, w - 90)}px`;
    el.style.top = `${clamp((-p.y * 0.5 + 0.5) * h, 190, h - 250)}px`;
  });
  // таймер хода
  const st = G.st;
  const tm = $('timer');
  if (st.ph === 'turn' && st.dl) {
    const total = st.dl - st.now;
    const left = total - (Date.now() - G.recvAt);
    tm.classList.remove('hidden');
    $('timerBar').style.width = `${clamp(left / 45000, 0, 1) * 100}%`;
    $('timerBar').style.background = left < 10000 ? 'var(--ember)' : 'var(--amber)';
  } else tm.classList.add('hidden');
}

// ---------- кадр ----------
const tmpQ = new THREE.Quaternion();
const flipY = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI);
let idleLookAt = 0;

function stepChars(dt, time) {
  for (let i = 0; i < 4; i++) {
    const ch = chars[i];
    ch.update(dt, time, {
      bottle: world.bottles[i],
      vomit: (p, d, ddt) => particles.vomit(p, d, ddt),
      onGulp: () => audio.gulp(),
      onSip: () => { G.visualShots[i] = Math.min(SHOTS, G.visualShots[i] + 1); world.bottles[i].setLevel((SHOTS - G.visualShots[i]) / SHOTS); renderHud(); },
      onButt: () => addButt(world.ashtray),
    });
  }
}

function loop() {
  requestAnimationFrame(loop);
  const realDt = clock.getDelta();
  const dt = Math.min(0.05, realDt);
  const time = clock.elapsedTime;

  // оживление: персонажи переглядываются
  idleLookAt -= dt;
  if (idleLookAt < 0) {
    idleLookAt = 2.5 + Math.random() * 3;
    chars.forEach((c, i) => {
      if (i === G.mySeat && G.camMode === 'fp') return;
      if (Math.random() < 0.5) {
        const j = (i + 1 + Math.floor(Math.random() * 3)) % 4;
        c.lookAt = chars[j].head.getWorldPosition(V());
      } else if (Math.random() < 0.5) c.lookAt = V(0, TABLE_Y, 0);
    });
  }

  // режим камеры
  const st = G.st;
  const seated = G.mySeat >= 0 && (G.screen === 'hud' || G.screen === 'lobby');
  if (G.screen === 'menu') G.camMode = 'orbit';
  else if (seated && !G.spectate) G.camMode = 'fp';
  else G.camMode = G.screen === 'hud' ? 'spect' : 'orbit';
  chars.forEach((c, i) => { c.isMe = G.camMode === 'fp' && i === G.mySeat; c.hideHead(c.isMe); });
  const snap = G.camMode !== G.prevCam;
  G.prevCam = G.camMode;

  // взгляд мышью
  G.look.x += (G.look.tx - G.look.x) * Math.min(1, dt * 6);
  G.look.y += (G.look.ty - G.look.y) * Math.min(1, dt * 6);
  if (G.camMode === 'fp') {
    const me = chars[G.mySeat];
    const yaw = G.look.x * 1.05;
    let target = me.root.localToWorld(V(Math.sin(yaw) * 1.4, 0.86 - G.look.y * 0.95, Math.cos(yaw) * 1.4));
    if (G.attn && performance.now() < G.attn.until) target = target.lerp(G.attn.p, G.attn.w);
    me.lookAt = target;
  }

  stepChars(dt, time);
  cards.update(dt);
  particles.update(dt, camera);

  // камера
  if (G.camMode === 'fp') {
    const me = chars[G.mySeat];
    const eye = me.head.localToWorld(V(0, me.headC.y + 0.03, me.headC.z + 0.075));
    camera.position.lerp(eye, snap ? 1 : 1 - Math.pow(0.0001, dt));
    me.head.getWorldQuaternion(tmpQ).multiply(flipY);
    camera.quaternion.slerp(tmpQ, snap ? 1 : 1 - Math.pow(0.0005, dt));
    camera.fov += (57 - camera.fov) * (snap ? 1 : dt * 3);
  } else if (G.camMode === 'spect') {
    const a = time * 0.07;
    const p = V(Math.sin(a) * 2.1, 2.05, Math.cos(a) * 2.1);
    camera.position.lerp(p, dt * 1.5);
    camera.lookAt(0, TABLE_Y + 0.15, 0);
    camera.fov += (55 - camera.fov) * dt * 2;
  } else {
    const t = time;
    const p = V(-3.75 + Math.sin(t * 0.09) * 0.35, 1.5 + Math.sin(t * 0.13) * 0.08, 1.25 + Math.sin(t * 0.07) * 0.5);
    if (G.screen === 'lobby') p.set(-2.6 + Math.sin(t * 0.1) * 0.4, 1.75, 1.6 + Math.sin(t * 0.08) * 0.3);
    camera.position.lerp(p, snap ? 1 : Math.min(1, dt * 0.8));
    const look = G.screen === 'lobby' ? V(0.2, 1.0, 0) : V(0.35, 0.98, -0.25);
    look.x -= G.look.x * 0.6; look.y -= G.look.y * 0.3;
    const m = new THREE.Matrix4().lookAt(camera.position, look, V(0, 1, 0));
    tmpQ.setFromRotationMatrix(m);
    camera.quaternion.slerp(tmpQ, snap ? 1 : Math.min(1, dt * 2));
    camera.fov += (50 - camera.fov) * (snap ? 1 : dt * 2);
  }
  if (G.shake > 0) {
    G.shake = Math.max(0, G.shake - dt * 1.4);
    camera.position.add(V((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02, 0).multiplyScalar(G.shake));
  }
  camera.updateProjectionMatrix();

  // свет: мерцание гирлянд
  world.flicker.forEach((f) => { f.l.intensity = f.base * (0.92 + Math.sin(time * 3 + f.ph) * 0.04 + Math.sin(time * 11.3 + f.ph * 2) * 0.03); });

  // постобработка
  const expT = (G.screen === 'hud' ? 1 : 1.45) * (TOON ? 1.05 : 1.2);
  renderer.toneMappingExposure += (expT - renderer.toneMappingExposure) * Math.min(1, dt * 2);
  G.flash = Math.max(0, G.flash - dt * 2.2);
  G.poison = Math.max(0, G.poison - dt * 0.08);
  G.fade = Math.max(0, G.fade - Math.min(0.2, realDt) * 0.9);
  grade.uniforms.time.value = time;
  grade.uniforms.poison.value = G.poison;
  grade.uniforms.flash.value = G.flash;
  grade.uniforms.fade.value = G.fade;

  updatePlates();
  if (G.screen === 'hud' && Math.floor(time * 2) !== Math.floor((time - dt) * 2)) updateSmokeBtn();
  composer.render(dt);
}

// ---------- ввод ----------
// Осмотр: зажми кнопку мыши (или палец) и тяни. Тянешь вправо — смотришь вправо.
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, lx: G.look.tx, ly: G.look.ty, id: e.pointerId };
  try { canvas.setPointerCapture(e.pointerId); } catch { /* не критично */ }
  canvas.classList.add('dragging');
});
const endDrag = () => { drag = null; canvas.classList.remove('dragging'); };
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  G.look.tx = clamp(drag.lx - (e.clientX - drag.x) / innerWidth * 2.4, -1, 1);
  G.look.ty = clamp(drag.ly + (e.clientY - drag.y) / innerHeight * 2.4, -1, 0.45);
});

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') { if (e.key === 'Enter') { e.target.id === 'codeIn' ? goOnline(false) : goOnline(true); } return; }
  if (G.screen !== 'hud') return;
  if (e.key >= '1' && e.key <= '5') toggleCard(+e.key - 1);
  else if (e.key === 'Enter') playSelected();
  else if (e.key.toLowerCase() === 'l' || e.key.toLowerCase() === 'д') callLiar();
  else if (e.key.toLowerCase() === 's' || e.key.toLowerCase() === 'ы') smoke();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
  grade.setSize(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());
});

$('createBtn').addEventListener('click', () => goOnline(true));
$('joinBtn').addEventListener('click', () => goOnline(false));
$('soloBtn').addEventListener('click', goSolo);
$('leaveBtn').addEventListener('click', leave);
$('exitBtn').addEventListener('click', leave);
$('menuBtn2').addEventListener('click', leave);
$('startBtn').addEventListener('click', () => { audio.init(); net.send({ t: 'start' }); });
$('againBtn').addEventListener('click', () => net.send({ t: 'again' }));
$('playBtn').addEventListener('click', playSelected);
$('liarBtn').addEventListener('click', callLiar);
$('smokeBtn').addEventListener('click', smoke);
$('rulesBtn').addEventListener('click', () => $('rules').classList.remove('hidden'));
$('helpBtn').addEventListener('click', () => $('rules').classList.remove('hidden'));
$('rulesClose').addEventListener('click', () => $('rules').classList.add('hidden'));
$('rules').addEventListener('click', (e) => { if (e.target.id === 'rules') $('rules').classList.add('hidden'); });
$('copyBtn').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${G.code}`;
  try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована — кидай друзьям'); } catch { toast(url, 6000); }
});
$('sndBtn').addEventListener('click', () => { audio.init(); audio.setMuted(!audio.muted); $('sndBtn').classList.toggle('off', audio.muted); });
$('musBtn').addEventListener('click', () => { audio.init(); audio.setMusic(!audio.music); $('musBtn').classList.toggle('off', !audio.music); });
$('fsBtn').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); });
const gfxNames = { high: 'высокая', mid: 'средняя', low: 'низкая' };
$('gfxBtn').textContent = `Графика: ${gfxNames[quality] || 'средняя'}`;
$('gfxBtn').addEventListener('click', () => {
  const order = ['high', 'mid', 'low'];
  const nq = order[(order.indexOf(quality) + 1) % 3];
  store.set('gfx', nq);
  location.reload();
});
$('styleBtn').textContent = `Стиль: ${STYLE_NAMES[STYLE]}`;
$('styleBtn').addEventListener('click', () => {
  store.set('style', STYLES[(STYLES.indexOf(STYLE) + 1) % STYLES.length]);
  location.reload();
});
$('nameIn').addEventListener('change', () => { if (G.st) net.send({ t: 'name', nm: myName() }); });

const qs = new URLSearchParams(location.search);
if (qs.get('room')) $('codeIn').value = qs.get('room').toUpperCase().slice(0, 6);

window.addEventListener('error', (e) => { console.error(e.error || e.message); });
boot().catch((e) => { console.error(e); $('loadMsg').textContent = 'Не удалось запустить 3D: ' + (e.message || e); });
if (qs.has('debug')) Object.assign(window, { __G: G, __net: net, __chars: chars, __cam: camera, __THREE: THREE });
if (qs.has('debug')) window.__advance = (sec) => { for (let t = 0; t < sec; t += 1 / 30) { stepChars(1 / 30, clock.elapsedTime + t); cards.update(1 / 30); particles.update(1 / 30, camera); } };
