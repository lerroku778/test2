import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { StylePass } from './post.js';
import { STYLE, TOON } from './style.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as T from './textures.js';
import { buildWorld, TABLE_Y, TABLE_R } from './world.js';
import { Character } from './characters.js';
import { Cards, Particles, Rain, addButt, makeButt } from './fx.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { CHARS, charInfo, RANK_TABLE, RANK_MANY, RANK_ONE, SHOTS, canCall } from './engine.js';

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
// телефон или планшет: основной ввод — палец (у ноутбука с сенсорным экраном основной ввод — мышь)
const isMobile = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);
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
camera.position.set(4, 1.8, -5);

// Не все мобильные GPU умеют рисовать в half float: там кадр идёт в обычные 8 бит и без bloom
// (его цели тоже half float) — иначе был бы чёрный экран.
const halfOK = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
const rt = new THREE.WebGLRenderTarget(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio(), { type: halfOK ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: Q.samples });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.45, 2.2);
bloom.enabled = halfOK;
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new StylePass(scene, camera, STYLE);
composer.addPass(grade);
grade.setSize(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());

// ---------- сцена ----------
const audio = new Audio();
const clock = new THREE.Clock();
let world, chars = [], pool = [], cards, particles, rain;
const cardImg = {};
const portraits = [];

const LOOK0 = { yaw: 0, pitch: 0.3 }; // по умолчанию взгляд на стол, карты видны внизу
const G = {
  st: null, pid: null, mySeat: -1, code: '', solo: false, recvAt: 0,
  screen: 'loading', timers: [], sel: new Set(), handKey: '',
  visualShots: [0, 0, 0, 0], visualDead: [false, false, false, false],
  look: { ...LOOK0 }, mouse: { x: 0.5, y: 0.5 }, shake: 0, flash: 0, poison: 0, drunk: 0,
  spectate: false, lastSmoke: 0, camMode: 'orbit', fade: 1, dealing: false,
  locked: false, zoom: false, aim: null, hover: -1, pendingPlay: null,
  sens: clamp(+store.get('sens', '1') || 1, 0.25, 3),
  menuTod: store.get('tod', 'evening'), menuTbl: store.get('tbl', 'center'), menuWx: store.get('wx', 'clear'), myChar: store.get('char', ''), specSpot: 0,
};
if (isMobile) document.body.classList.add('touch');

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
  world.setTime(G.menuTod);
  world.setLayout(G.menuTbl);
  syncTodButtons(G.menuTod);
  syncTblButtons(G.menuTbl);
  rain = new Rain(scene);
  grade.hide.push(rain.mesh);
  applyWeather(G.menuWx);
  setP(45, 'Рассаживаем гостей…');
  await nextFrame();
  particles = new Particles(scene);
  grade.hide.push(particles.smokeGroup);
  grade.soft.push(particles.smokeGroup);
  cards = new Cards(scene);
  // все персонажи строятся заранее; за столом те, кого выбрали игроки
  CHARS.forEach((c, k) => {
    const ch = new Character(c.key, k % 4, particles);
    scene.add(ch.root);
    scene.add(ch.cig);
    pool.push(ch);
  });
  for (let i = 0; i < 4; i++) { chars.push(pool[i]); cards.attachFan(pool[i], i); }
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
  const glowW = new THREE.Mesh(cards.glowGeo, cards.glowSel); warm.add(glowW);
  pool.forEach((c) => { c.cig.visible = true; c.root.visible = true; });
  particles.smoke(V(0, TABLE_Y + 0.3, 0), V(), 0.01, 0.05, 0);
  particles.update(0.001);
  particles.v.visible = true; // капли рвоты прячутся, пока их нет, — шейдер собираем заранее
  renderer.compile(scene, camera);
  composer.render(0.016);
  particles.v.visible = false;
  scene.remove(warm);
  pool.forEach((c) => { c.cig.visible = false; });
  setP(88, 'Зажигаем гирлянды…');
  await nextFrame();
  renderPortraits();
  assignChars(null);
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
  for (let i = 0; i < pool.length; i++) {
    const ch = pool[i];
    // портрет каждого персонажа снимаем на месте 0, остальных на это время прячем
    pool.forEach((o) => { o.root.visible = o === ch; });
    ch.setSeat(0);
    pc.position.copy(ch.root.localToWorld(V(0.02, 1.22, 0.95)));
    pc.lookAt(ch.root.localToWorld(V(0, 1.12, 0)));
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    renderer.render(scene, pc);
    g.clearRect(0, 0, out.width, out.height);
    g.drawImage(canvas, 0, canvas.height - h * pr, w * pr, h * pr, 0, 0, out.width, out.height);
    portraits[ch.key] = out.toDataURL('image/jpeg', 0.88);
  }
  pool.forEach((o, k) => { if (k < 4) o.setSeat(k); });
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
}

// ---------- экраны ----------
function showScreen(s) {
  G.screen = s;
  for (const id of ['menu', 'lobby', 'hud']) $(id).classList.toggle('hidden', id !== s);
  if (s !== 'hud') { $('over').classList.add('hidden'); unlock(); }
  if (s === 'menu') { G.camMode = 'orbit'; $('nameIn').value = $('nameIn').value || store.get('name', ''); }
  if (s !== 'hud') G.touchPause = false;
  if (s === 'hud' && isMobile && !G.touchHint) {
    G.touchHint = true;
    const portrait = innerHeight > innerWidth;
    toast(`Тяни пальцем — смотреть · тап по карте — взять · тап по столу или «Выложить» — сходить${portrait ? ' · удобнее держать телефон горизонтально' : ''}`, 6500);
  }
  updatePause();
}

// ---------- захват мыши (вид от первого лица) ----------
function lock() {
  if (isMobile || G.locked || G.screen !== 'hud') return;
  try {
    const p = canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => { try { const q = canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch { /* браузер не дал */ } });
  } catch { try { canvas.requestPointerLock(); } catch { /* браузер не дал */ } }
}
function unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
document.addEventListener('pointerlockchange', () => {
  G.locked = document.pointerLockElement === canvas;
  document.body.classList.toggle('locked', G.locked);
  if (!G.locked) G.zoom = false;
  updatePause();
});
document.addEventListener('pointerlockerror', () => updatePause());

function updatePause() {
  // на телефоне захвата мыши нет: пауза — это экран настроек, его открывает шестерёнка
  const show = G.screen === 'hud' && (isMobile ? !!G.touchPause : !G.locked) && $('over').classList.contains('hidden') && $('rules').classList.contains('hidden');
  const el = $('pause');
  if (show && isMobile) {
    $('pauseLabel').textContent = 'Настройки';
    $('pauseTitle').textContent = 'Пауза';
    $('pauseSub').textContent = 'Партия идёт без остановки.';
    $('resumeBtn').textContent = 'Вернуться за стол';
  } else if (show && el.classList.contains('hidden')) {
    const first = !G.wasLocked;
    $('pauseLabel').textContent = first ? 'Партия началась' : 'Пауза';
    $('pauseTitle').textContent = first ? 'Садись за стол' : 'Ты отошёл от стола';
    $('pauseSub').textContent = first ? 'Мышь управляет взглядом, курсора в игре нет. Карты — у тебя в руках: наведи на карту и жми ЛКМ.' : 'Партия идёт без остановки. Кликни, чтобы вернуться.';
    $('resumeBtn').textContent = first ? 'Сесть за стол' : 'Вернуться за стол';
  }
  if (G.locked) G.wasLocked = true;
  el.classList.toggle('hidden', !show);
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
  if (!f) return; // ленты действий больше нет: всё видно по штампам и статусу
  const d = document.createElement('div');
  d.textContent = text;
  f.prepend(d);
  while (f.children.length > 5) f.lastChild.remove();
}

const seatChar = (i) => charInfo(G.st && G.st.seats[i] && G.st.seats[i].ch);
const nm = (i) => (i === G.mySeat ? 'Ты' : nmFull(i));
const who = (i) => (i === G.mySeat ? 'Ты' : nmFull(i));
const say = (i, you, verb) => (i === G.mySeat ? you : `${nmFull(i)} ${verb}`);
const nmFull = (i) => (G.st && G.st.seats[i] && G.st.seats[i].nm) || seatChar(i).name;
const occupied = (s) => !!(s && (s.pid || s.bot));

// Кто где сидит: у каждого места свой выбранный персонаж, пустые места без никого.
function assignChars(st) {
  const want = st ? st.seats.map((s) => (occupied(s) ? s.ch || null : null)) : CHARS.slice(0, 4).map((c) => c.key);
  const next = [null, null, null, null];
  const used = new Set();
  want.forEach((k, i) => { const c = k && pool.find((p) => p.key === k); if (c && !used.has(c)) { next[i] = c; used.add(c); } });
  next.forEach((c, i) => { if (!c) { next[i] = pool.find((p) => !used.has(p)); used.add(next[i]); } });
  pool.forEach((c) => { if (!next.includes(c)) { c.root.visible = false; c.cig.visible = false; c.smoking = null; c.isMe = false; c.fp = null; c.hideHead(false); } });
  next.forEach((c, i) => {
    if (chars[i] !== c || c.seat !== i || c.fanGroup !== (cards.fans[i] && cards.fans[i].g)) {
      c.setSeat(i); cards.attachFan(c, i); c.action = null; c.smoking = null; c.cig.visible = false; c.setDead(false, true);
    }
    const occ = !!want[i] && (!st || occupied(st.seats[i]));
    c.root.visible = occ;
    world.bottles[i].group.visible = occ;
  });
  chars.splice(0, 4, ...next);
}

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
    const m = await net.connect(myName(), { create, code, tod: G.menuTod, tbl: G.menuTbl, wx: G.menuWx, ch: G.myChar });
    G.pid = m.pid; G.code = m.code; G.solo = false;
    history.replaceState(null, '', `${location.pathname}?room=${m.code}`);
  } catch (e) {
    $('menuErr').textContent = e.message || 'Не получилось подключиться.';
  } finally { btn.disabled = false; }
}

function goSolo() {
  audio.init();
  G.pid = 'me'; G.code = 'СОЛО'; G.solo = true;
  net.playLocal(myName(), { tod: G.menuTod, tbl: G.menuTbl, wx: G.menuWx, ch: G.myChar });
}

function leave() {
  unlock();
  net.close();
  clearTimers();
  G.st = null; G.mySeat = -1; G.spectate = false;
  resetVisuals(true);
  history.replaceState(null, '', location.pathname);
  world.setTime(G.menuTod);
  world.setLayout(G.menuTbl);
  syncTodButtons(G.menuTod);
  syncTblButtons(G.menuTbl);
  applyWeather(G.menuWx);
  G.spkSet = false;
  assignChars(null);
  showScreen('menu');
}

// ---------- сообщения ----------
function onMsg(m) {
  if (m.t === 'st') onState(m.st);
  else if (m.t === 'closed') { if (G.screen !== 'menu') { toast('Связь с сервером потеряна'); leave(); } }
  else if (m.t === 'err') $('menuErr').textContent = m.e;
  else if (m.t === 'look' && chars[m.s] && m.s !== G.mySeat) chars[m.s].netLook = { yaw: m.y, pitch: m.p, t: performance.now() };
}

function onState(st) {
  const prev = G.st;
  G.st = st;
  G.recvAt = Date.now();
  G.mySeat = st.seats.findIndex((s) => s.pid === G.pid);
  if (st.tod && st.tod !== world.tod) { world.setTime(st.tod); syncTodButtons(st.tod); }
  if (st.tbl && st.tbl !== world.layout) { world.setLayout(st.tbl); syncTblButtons(st.tbl); G.spkSet = false; }
  if ((st.wx || 'clear') !== world.wx) applyWeather(st.wx || 'clear');
  assignChars(st);
  const inGame = st.ph !== 'lobby';
  const fresh = !prev || prev.gid !== st.gid;

  if (!inGame) {
    if (G.screen !== 'lobby') { resetVisuals(true); showScreen('lobby'); }
    renderLobby();
    syncStatic(st);
  } else {
    if (G.screen !== 'hud') { G.wasLocked = false; showScreen('hud'); }
    if (fresh) { clearTimers(); resetVisuals(prev && prev.ph !== 'lobby' && prev.ph !== 'over'); G.look = { ...LOOK0 }; syncAll(st); }
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
  // смерть, которую не успела отметить анимация, — по состоянию сервера (кроме самой фазы «пьёт»,
  // где отравление ещё проигрывается)
  if (inGame && st.ph !== 'drink') st.seats.forEach((s, i) => { if (!s.alive && !G.visualDead[i]) markDead(i); });
  G.spectate = G.mySeat < 0 || (G.visualDead[G.mySeat] && inGame);
  renderHud();
}

// Выбывший игрок: дальше он только наблюдает. Вызывается по таймеру в конце анимации отравления,
// а если таймер не успел (фаза «пьёт» короче анимации, и новая раздача сбрасывает таймеры) —
// по состоянию сервера, иначе своя камера так и оставалась в осевшей под стол голове.
function markDead(i) {
  if (G.visualDead[i]) return;
  G.visualDead[i] = true;
  const ch = chars[i];
  if (!ch.dead && !(ch.action && ch.action.name === 'poison')) ch.setDead(true, true);
  audio.death();
  if (i === G.mySeat) { G.spectate = true; toast(`Ты вне игры. ${isMobile ? 'Тап' : 'ЛКМ'} — сменить точку обзора.`, 4000); }
}

function resetVisuals(clearMess) {
  cards.reset();
  if (clearMess) particles.clearMess();
  world.bottles.forEach((b) => b.reset());
  chars.forEach((c, i) => { c.setDead(false); c.action = null; cards.setFan(i, 0); });
  G.sel.clear(); G.pendingPlay = null; G.handKey = '';
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
    syncFan(i, st);
  });
  if ((st.ph === 'reveal' || st.ph === 'drink') && st.rev) {
    cards.setPile(st.pile);
    cards.reveal(st.rev.c);
  }
  if (st.ph === 'over') later(300, showOver);
  G.handKey = '';
}

// свои карты — настоящие, в руках; у остальных — рубашкой к нам
function syncFan(i, st) {
  const s = st.seats[i];
  if (i === G.mySeat && s.alive) cards.setHand(i, s.hand);
  else cards.setFan(i, s.alive ? s.n : 0);
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
      st.seats.forEach((s, i) => { cards.setFan(i, 0); if (s.alive) seats.push({ seat: i }); });
      const cnt = [0, 0, 0, 0];
      G.dealing = true;
      G.sel.clear();
      const myHand = me >= 0 ? st.seats[me].hand.slice() : [];
      cards.deal(seats, (i) => { cnt[i]++; if (i === me) cards.setHand(i, myHand.slice(0, cnt[i])); else cards.setFan(i, cnt[i]); audio.card(); });
      later(1600, () => { G.dealing = false; syncCounts(G.st, false); });
      stamp(RANK_TABLE[st.table].toUpperCase(), `Раунд ${st.round}`, '', 1500);
      feed(`Раунд ${st.round}: ${RANK_TABLE[st.table].toLowerCase()}. ${say(st.turn, 'Ты начинаешь', 'начинает')}.`);
      audio.glass();
      break;
    }
    case 'play': {
      const s = e.s, n = e.n;
      chars[s].play('throw');
      throwFrom(s, n, prev.pile, (i) => { audio.cardSlap(); if (i === n - 1) cards.setPile(st.pile); });
      syncFan(s, st);
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
        throwFrom(r.on, n, prev.pile, () => { audio.cardSlap(); cards.setPile(st.pile); });
        syncFan(r.on, st);
        feed(`${nm(r.on)}: «${n} ${n === 1 ? RANK_ONE[st.table] : RANK_MANY[st.table]}», последние карты.`);
        delay = 800;
      }
      later(delay, () => {
        cards.setPile(st.pile);
        const tgt = chars[r.on].head.getWorldPosition(V()).add(V(0, 0.1, 0));
        chars[r.by].play('point', { target: tgt });
        chars.forEach((c, i) => { c.lookAt = i === r.by ? tgt : chars[r.by].head.getWorldPosition(V()); });
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
          // сразу после смерти — вид наблюдателя сбоку, а не из осевшей на стол головы
          later(4400, () => { markDead(s); renderHud(); });
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
    if (!(skipFanFor && st.ev && st.ev.s === i)) syncFan(i, st);
  });
}

// Свои выбранные карты вылетают прямо из руки; чужие (и ход по таймауту) — из веера.
function throwFrom(s, n, pileStart, onEach) {
  const pend = G.pendingPlay;
  G.pendingPlay = null;
  if (s === G.mySeat && pend && pend.length === n) cards.throwFromHand(s, pend, pileStart, onEach);
  else cards.throwCards(s, n, pileStart, onEach);
}

function showOver() {
  const st = G.st;
  if (!st || st.ph !== 'over') return;
  const w = st.win;
  $('overTitle').textContent = w === G.mySeat ? 'Бар твой' : w >= 0 ? `Победа: ${nmFull(w)}` : 'Живых не осталось';
  $('overSub').textContent = w === G.mySeat ? 'Все остальные выбыли. Чеколейтор тебя пощадил.' : 'Чеколейтор сегодня был не на твоей стороне.';
  $('againBtn').disabled = G.mySeat < 0;
  $('over').classList.remove('hidden');
  unlock();
  updatePause();
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

// ---------- лобби ----------
function renderLobby() {
  const st = G.st;
  $('roomCode').textContent = G.code;
  $('copyBtn').classList.toggle('hidden', G.solo);
  // места
  const seats = $('seats');
  if (!seats.children.length) {
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('button');
      b.className = 'char';
      b.innerHTML = '<img alt=""><span class="seatno"></span><div class="info"><div class="nm"></div><div class="who"></div></div>';
      b.querySelector('.seatno').textContent = `Место ${i + 1}`;
      b.addEventListener('click', () => {
        audio.init(); audio.select();
        const s = G.st && G.st.seats[i];
        if (!s) return;
        if (s.pid === G.pid) net.send({ t: 'stand' });
        else if (!s.pid) net.send({ t: 'sit', seat: i });
        else toast('Место занято');
      });
      seats.appendChild(b);
    }
  }
  [...seats.children].forEach((b, i) => {
    const s = st.seats[i];
    const mine = s.pid === G.pid;
    b.classList.toggle('mine', mine);
    b.classList.toggle('taken', !!s.pid && !mine);
    b.classList.toggle('empty', !s.pid);
    const img = b.querySelector('img');
    const src = portraits[s.pid ? s.ch : ''] || portraits[CHARS[i].key] || '';
    if (img.getAttribute('src') !== src) img.src = src;
    b.querySelector('.nm').textContent = s.pid ? charInfo(s.ch).name : 'Свободно';
    b.querySelector('.who').textContent = mine ? 'Ты здесь · кликни, чтобы встать' : s.pid ? s.nm : G.solo ? 'Сядет бот' : 'Никого';
  });
  // персонажи
  const box = $('chars');
  if (!box.children.length) {
    CHARS.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'char';
      b.innerHTML = '<img alt=""><div class="info"><div class="nm"></div><div class="tg"></div><div class="who"></div></div>';
      b.querySelector('img').src = portraits[c.key] || '';
      b.querySelector('.nm').textContent = c.name;
      b.querySelector('.tg').textContent = c.tag;
      b.addEventListener('click', () => {
        audio.init(); audio.select();
        const owner = G.st && G.st.seats.find((s) => s.ch === c.key && s.pid);
        if (owner && owner.pid !== G.pid) { toast(`${c.name} уже за столом у игрока ${owner.nm}`); return; }
        G.myChar = c.key; store.set('char', c.key);
        net.send({ t: 'char', k: c.key });
        renderLobby();
      });
      box.appendChild(b);
    });
  }
  const mySeat = G.mySeat >= 0 ? st.seats[G.mySeat] : null;
  const myKey = mySeat ? mySeat.ch : G.myChar;
  [...box.children].forEach((b, k) => {
    const c = CHARS[k];
    const owner = st.seats.find((s) => s.ch === c.key && s.pid);
    const mine = myKey === c.key && (!owner || owner.pid === G.pid);
    b.classList.toggle('mine', mine);
    b.classList.toggle('taken', !!owner && owner.pid !== G.pid);
    b.querySelector('.who').textContent = mine ? 'Твой' : owner ? owner.nm : '';
  });
  const pp = $('people');
  pp.innerHTML = '';
  const lab = document.createElement('span'); lab.textContent = G.solo ? 'Одиночная игра' : 'В комнате:'; pp.appendChild(lab);
  if (!G.solo) (st.people || []).forEach((p) => { const c = document.createElement('span'); c.className = 'chip' + (p.pid === G.pid ? ' me' : ''); c.textContent = p.nm; pp.appendChild(c); });
  const humans = st.seats.filter((s) => s.pid).length;
  $('lobbyHint').textContent = G.solo ? 'Свободные места займут боты. Персонажа можно поменять в любой момент до начала.' : 'Играют только люди, без ботов: пустые места так и останутся пустыми. Нужно хотя бы двое за столом.';
  const need = !G.solo && humans < 2;
  $('startBtn').disabled = G.mySeat < 0 || need;
  $('startBtn').textContent = G.mySeat < 0 ? 'Сначала сядь за стол' : need ? 'Ждём второго игрока' : 'Начать партию';
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
    n.textContent = s.nm || seatChar(i).name;
    el.dataset.gone = occupied(s) ? '' : '1';
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
    const a = document.createElement('div'); a.className = 'nm'; a.textContent = seatChar(G.mySeat).name; mp.appendChild(a);
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
  const me = G.mySeat;
  const hand = me >= 0 ? st.seats[me].hand : [];
  const key = `${st.round}|${hand.join('')}`;
  if (key !== G.handKey) { G.handKey = key; G.sel.clear(); }
  if (me >= 0 && !G.dealing && !G.visualDead[me]) cards.setHand(me, hand);
  const myTurn = st.ph === 'turn' && st.turn === me && me >= 0;
  const alive = me >= 0 && !G.visualDead[me];
  const canPlay = myTurn && G.sel.size >= 1 && G.sel.size <= 3;
  const canLiar = me >= 0 && canCall(st, me);
  $('playBtn').disabled = !canPlay;
  $('playBtn').textContent = G.sel.size ? `Выложить ${G.sel.size}` : 'Выложить';
  $('liarBtn').disabled = !canLiar;
  $('playBtn').parentElement.classList.toggle('hidden', !alive);
  // подсказки клавиш
  $('keys').classList.toggle('hidden', !alive);
  $('kPick').classList.toggle('off', !hand.length);
  $('kPlay').classList.toggle('off', !canPlay);
  $('kPlay').classList.toggle('go', canPlay);
  $('kPlayT').textContent = G.sel.size ? `Выложить ${G.sel.size}` : myTurn ? 'Выбери 1–3 карты' : 'Выложить';
  $('kLiar').classList.toggle('off', !canLiar);
  $('kLiar').classList.toggle('go', canLiar);
  G.aimKey = ''; // подсказка у прицела зависит от выбора — пересчитать
  updateSmokeBtn();
}

function toggleCard(i) {
  const st = G.st;
  if (!st || G.mySeat < 0 || G.visualDead[G.mySeat] || G.dealing) return;
  const hand = st.seats[G.mySeat].hand;
  if (i >= hand.length) return;
  audio.init();
  if (G.sel.has(i)) G.sel.delete(i);
  else if (G.sel.size < 3) G.sel.add(i);
  else { toast('Не больше трёх карт за ход'); return; }
  audio.select();
  renderHand();
}

function clearSel() {
  if (!G.sel.size) return;
  G.sel.clear();
  audio.select();
  renderHand();
}

function playSelected() {
  if ($('playBtn').disabled) return;
  G.pendingPlay = [...G.sel];
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
  const t = left > 0 ? `Куришь… ${left} с` : 'Chapman Red';
  $('smokeSub').textContent = t;
  $('smokeSubT').textContent = t;
  $('kSmoke').classList.toggle('off', !can);
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
    const p = chars[i].head.localToWorld(tmpV.set(0, 0.42, 0)).project(camera);
    const vis = el.dataset.me !== '1' && el.dataset.gone !== '1' && p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2;
    const op = vis ? '1' : '0';
    if (el._op !== op) { el._op = op; el.style.opacity = op; }
    if (!vis) return;
    // только transform: без перерасчёта раскладки страницы каждый кадр
    // поля сверху и снизу — под HUD; на низком экране (телефон горизонтально) они пропорционально меньше,
    // на телефоне верхний HUD компактный — табличке хватает места сразу под статусом и таймером
    const top = isMobile ? 150 : Math.min(190, h * 0.3);
    const x = Math.round(clamp((p.x * 0.5 + 0.5) * w, 90, w - 90)), y = Math.round(clamp((-p.y * 0.5 + 0.5) * h, top, Math.max(top, h - Math.min(250, h * 0.3))));
    const tr = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
    if (el._tr !== tr) { el._tr = tr; el.style.transform = tr; }
  });
  // таймер хода
  const st = G.st;
  const tm = $('timer');
  if (st.ph === 'turn' && st.dl) {
    const total = st.dl - st.now;
    const left = total - (Date.now() - G.recvAt);
    tm.classList.remove('hidden');
    $('timerBar').style.transform = `scaleX(${clamp(left / 45000, 0, 1).toFixed(3)})`;
    const bg = left < 10000 ? 'var(--ember)' : 'var(--amber)';
    if (tm._bg !== bg) { tm._bg = bg; $('timerBar').style.background = bg; }
  } else tm.classList.add('hidden');
}

// ---------- кадр ----------
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
const tmpM = new THREE.Matrix4();
const flipY = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI);
const UPV = V(0, 1, 0);
const ray = new THREE.Raycaster();
const CENTER = new THREE.Vector2(0, 0);
const tablePlane = new THREE.Plane(V(0, 1, 0), -TABLE_Y);
const YAW_MAX = 1.9, PITCH_MIN = -0.95, PITCH_MAX = 1.25;
let idleLookAt = 0;
// сила опьянения по числу выпитых глотков: сначала чуть-чуть, к пятому — сильно
const DRUNK = [0, 0.14, 0.3, 0.5, 0.74, 1];
// лимит кадров: 0 — без лимита (по умолчанию), иначе 1…1000 в секунду
let fpsCap = clamp(Math.round(+store.get('fps', '0') || 0), 0, 1000);
let frameDue = 0;

function stepChars(dt, time) {
  for (let i = 0; i < 4; i++) {
    const ch = chars[i];
    if (!ch.root.visible) continue; // пустое место
    ch.update(dt, time, {
      bottle: world.bottles[i],
      vomit: (p, d, ddt) => particles.vomit(p, d, ddt),
      onGulp: () => audio.gulp(),
      onSip: () => { G.visualShots[i] = Math.min(SHOTS, G.visualShots[i] + 1); world.bottles[i].setLevel((SHOTS - G.visualShots[i]) / SHOTS); renderHud(); },
      onButt: () => addButt(world.ashtray),
    });
  }
}

// Что под прицелом: карта в руке, стол (выложить) или игрок, которого можно вскрыть.
const headS = new THREE.Sphere(V(), 0.2), torsoS = new THREE.Sphere(V(), 0.26);
function updateAim(ndc = CENTER) {
  const st = G.st, me = G.mySeat;
  let aim = null;
  if (st && me >= 0 && !G.visualDead[me] && !G.dealing) {
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(cards.handMeshes(me), false)[0];
    if (hit) aim = { t: 'card', i: hit.object.userData.handIdx };
    else {
      if (canCall(st, me)) {
        const ch = chars[st.last.s];
        ch.head.localToWorld(headS.center.set(0, ch.headC.y, 0));
        ch.root.localToWorld(torsoS.center.set(0, 0.82, 0.05));
        if (ray.ray.intersectsSphere(headS) || ray.ray.intersectsSphere(torsoS)) aim = { t: 'liar' };
      }
      if (!aim && G.sel.size && st.ph === 'turn' && st.turn === me) {
        const p = ray.ray.intersectPlane(tablePlane, tmpV);
        if (p && Math.hypot(p.x, p.z) < TABLE_R * 0.85) aim = { t: 'table' };
      }
    }
  }
  G.hover = aim && aim.t === 'card' ? aim.i : -1;
  const key = aim ? `${aim.t}${aim.i ?? ''}:${G.sel.size}:${aim.i !== undefined && G.sel.has(aim.i) ? 's' : ''}` : '';
  G.aim = aim;
  if (key !== G.aimKey) { G.aimKey = key; renderAim(); }
  return aim;
}

function renderAim() {
  const el = $('aim'), aim = G.aim;
  let html = '', red = false;
  const k = isMobile ? '' : '<kbd>ЛКМ</kbd>';
  if (aim && aim.t === 'card') {
    if (G.sel.has(aim.i)) html = `${k}Вернуть в руку`;
    else if (G.sel.size >= 3) html = 'Больше трёх нельзя';
    else html = `${k}Взять карту`;
  } else if (aim && aim.t === 'table') html = `${k}Выложить ${G.sel.size}`;
  else if (aim && aim.t === 'liar') { html = `${k}ЛЖЕЦ!`; red = true; }
  el.innerHTML = html;
  el.classList.toggle('red', red);
  $('cross').classList.toggle('hot', !!aim);
}

function primaryAction(aim = G.aim) {
  if (!aim) return;
  if (aim.t === 'card') toggleCard(aim.i);
  else if (aim.t === 'table') playSelected();
  else if (aim.t === 'liar') callLiar();
}

function loop(now) {
  requestAnimationFrame(loop);
  if (fpsCap > 0) {
    // кадр пропускаем, пока не подошло его время; запас в 1 мс — чтобы не терять кадры из-за дрожания таймера
    if (now + 1 < frameDue) return;
    frameDue = Math.max(frameDue + 1000 / fpsCap, now);
  }
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

  // взгляд: мышь поворачивает голову напрямую, без сглаживания
  chars.forEach((c) => { c.fp = null; });
  if (G.camMode === 'fp') {
    const me = chars[G.mySeat];
    if (G.screen === 'hud') me.fp = G.look;
    else me.fp = { yaw: -(G.mouse.x - 0.5) * 0.9, pitch: 0.2 + (G.mouse.y - 0.5) * 0.5 }; // лобби: курсор свободен
  }

  stepChars(dt, time);
  cards.update(dt);
  particles.update(dt);
  rain.update(time, camera, world.roofRect());

  // камера
  const zoomK = 1 - Math.pow(0.000001, dt);
  if (G.camMode === 'fp') {
    const me = chars[G.mySeat];
    // позиция — глаза персонажа, поворот — ровно туда, куда смотрит мышь (+ то, что добавила анимация)
    me.head.updateWorldMatrix(true, false);
    me.head.localToWorld(camera.position.set(0, me.headC.y + 0.03, me.headC.z + 0.075));
    tmpE.set(me.s.pitch + me.s.lean * 0.35, me.s.yaw, me.s.roll);
    camera.quaternion.copy(me.root.quaternion).multiply(tmpQ.setFromEuler(tmpE)).multiply(flipY);
    if (G.drunk > 0.001) {
      // пьяного покачивает: голова плавно гуляет и заваливается набок
      const d = G.drunk;
      tmpE.set(Math.sin(time * 0.53) * 0.025 * d, Math.sin(time * 0.37 + 1.3) * 0.035 * d, Math.sin(time * 0.61 + 0.4) * 0.06 * d);
      camera.quaternion.multiply(tmpQ.setFromEuler(tmpE));
    }
    const fov = G.zoom && G.screen === 'hud' ? 30 : 57;
    camera.fov = snap ? fov : camera.fov + (fov - camera.fov) * zoomK;
  } else if (G.camMode === 'spect') {
    // наблюдатель стоит сбоку от стола (между местами) и свободно смотрит мышью;
    // ЛКМ / Пробел — перейти на соседнюю точку
    if (snap) { G.specSpot = 0; G.look = { ...LOOK0 }; }
    const a = (G.mySeat >= 0 ? G.mySeat : 0) * Math.PI / 2 + Math.PI / 4 + G.specSpot * Math.PI / 2;
    camera.position.set(Math.sin(a) * 1.75, 1.72, Math.cos(a) * 1.75);
    const basePitch = -Math.atan2(1.72 - TABLE_Y - 0.1, 1.75);
    tmpE.set(clamp(basePitch - (G.look.pitch - LOOK0.pitch), -1.3, 1.0), a + G.look.yaw, 0);
    camera.quaternion.setFromEuler(tmpE);
    camera.fov = 60;
  } else {
    const t = time;
    // меню и лобби: вид со двора на навес (катушки за спиной, дерево слева)
    const p = tmpV.set(0.2 + Math.sin(t * 0.09) * 0.45, 1.6 + Math.sin(t * 0.13) * 0.08, -4.7 + Math.sin(t * 0.07) * 0.25);
    if (G.screen === 'lobby') p.set(2.3 + Math.sin(t * 0.1) * 0.3, 1.8, -3.3 + Math.sin(t * 0.08) * 0.2);
    p.add(world.env.position); // точка съёмки привязана к навесу, где бы ни стоял игровой стол
    camera.position.lerp(p, snap ? 1 : Math.min(1, dt * 0.8)); // медленный облёт меню — это съёмка, а не управление
    const look = G.screen === 'lobby' ? V(0.1, 1.0, 0.1) : V(0.9, 1.05, 0.4).add(world.env.position);
    look.x -= (G.mouse.x - 0.5) * 1.2; look.y -= (G.mouse.y - 0.5) * 0.6;
    tmpM.lookAt(camera.position, look, UPV);
    camera.quaternion.setFromRotationMatrix(tmpM);
    camera.fov += (50 - camera.fov) * (snap ? 1 : Math.min(1, dt * 2));
  }
  if (G.shake > 0) {
    G.shake = Math.max(0, G.shake - dt * 1.4);
    camera.position.add(V((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02, 0).multiplyScalar(G.shake));
  }
  // узкий экран (телефон вертикально): расширяем вертикальный угол, чтобы по горизонтали
  // влезали стол и карты в руке; на обычных экранах ничего не меняется
  const fovSet = camera.fov;
  if (camera.aspect < 1.25) camera.fov = Math.min(95, 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(fovSet) / 2) * 1.25 / camera.aspect)));
  camera.updateProjectionMatrix();
  camera.fov = fovSet;
  camera.updateMatrixWorld();

  // куда смотрю — остальным игрокам (не чаще ~8 раз в секунду и только если голова повернулась)
  if (net.online && G.camMode === 'fp' && G.screen === 'hud' && time - (G.lookSentAt || 0) > 0.12) {
    const y = +G.look.yaw.toFixed(3), p = +G.look.pitch.toFixed(3);
    if (Math.abs(y - (G.lookY ?? 99)) > 0.015 || Math.abs(p - (G.lookP ?? 99)) > 0.015 || time - G.lookSentAt > 2) {
      net.send({ t: 'look', y, p });
      G.lookY = y; G.lookP = p; G.lookSentAt = time;
    }
  }

  // карты в руке и то, на что смотрит прицел
  const fpPlay = G.camMode === 'fp' && G.screen === 'hud' && G.mySeat >= 0;
  if (G.mySeat >= 0) cards.updateHand(G.mySeat, dt, camera.position, fpPlay ? G.hover : -1, G.sel);
  // прицел по центру экрана — только с мышью; на сенсорном экране цель — точка касания
  if (fpPlay && !isMobile) updateAim(); else if (G.aim || G.hover >= 0) { G.aim = null; G.aimKey = ''; G.hover = -1; renderAim(); }

  // свет: мерцание гирлянд
  world.flicker.forEach((f) => { f.l.intensity = f.base * (0.92 + Math.sin(time * 3 + f.ph) * 0.04 + Math.sin(time * 11.3 + f.ph * 2) * 0.03); });

  // постобработка
  const expT = (G.screen === 'hud' ? 1 : 1.45) * (TOON ? 1.05 : 1.2) * (world.exposure || 1);
  renderer.toneMappingExposure += (expT - renderer.toneMappingExposure) * Math.min(1, dt * 2);
  G.flash = Math.max(0, G.flash - dt * 2.2);
  G.poison = Math.max(0, G.poison - dt * 0.08);
  // опьянение: после каждого пережитого глотка сильнее; плавно нарастает, пока пьёшь.
  // Выбыл (наблюдаешь) или партия ещё не идёт — трезвый взгляд.
  const shots = G.mySeat >= 0 && G.screen === 'hud' && !G.spectate ? G.visualShots[G.mySeat] : 0;
  const drunkT = DRUNK[Math.min(shots, DRUNK.length - 1)];
  G.drunk += (drunkT - G.drunk) * Math.min(1, dt * (drunkT > G.drunk ? 0.6 : 2));
  G.fade = Math.max(0, G.fade - Math.min(0.2, realDt) * 0.9);
  grade.uniforms.time.value = time;
  grade.uniforms.poison.value = G.poison;
  grade.uniforms.drunk.value = G.drunk;
  grade.uniforms.flash.value = G.flash;
  grade.uniforms.fade.value = G.fade;

  updatePlates();
  // музыка бара из колонки: слушатель — камера
  if (audio.ctx) {
    audio.setInGame(G.screen === 'hud');
    const f = V(0, 0, -1).applyQuaternion(camera.quaternion), u = V(0, 1, 0).applyQuaternion(camera.quaternion);
    audio.setListener(camera.position, f, u);
    if (!G.spkSet) {
      G.spkSet = true;
      world.speaker.updateMatrixWorld(true);
      audio.setSpeaker(world.speaker.localToWorld(V(0, 0.18, 0.12)), V(0, 0, 1).applyQuaternion(world.speaker.getWorldQuaternion(new THREE.Quaternion())));
    }
    const lvl = audio.speakerLevel();
    const u2 = world.speaker.userData;
    const push = 1 + lvl * 0.9;
    u2.cone.position.z = 0.1 + lvl * 0.012; u2.cap.position.z = 0.103 + lvl * 0.014;
    u2.led.material.emissiveIntensity = 2 + push * 3;
  }
  if (G.screen === 'hud' && Math.floor(time * 2) !== Math.floor((time - dt) * 2)) updateSmokeBtn();
  if (G.camMode === 'spect' && G.screen === 'hud' && G.aimKey !== 'spect') { G.aimKey = 'spect'; G.aim = null; $('aim').innerHTML = `${isMobile ? '' : '<kbd>ЛКМ</kbd>'}Другая точка обзора`; $('aim').classList.remove('red'); }
  const crossOn = fpPlay && G.locked && !G.visualDead[G.mySeat];
  if (crossOn !== G.crossOn) { G.crossOn = crossOn; $('cross').classList.toggle('hidden', !crossOn); }
  composer.render(dt);
}

// ---------- ввод ----------
// Мышь захвачена: движение крутит взгляд напрямую, без инерции. Курсора в игре нет.
const inHud = () => G.screen === 'hud' && $('over').classList.contains('hidden') && $('rules').classList.contains('hidden');
document.addEventListener('mousemove', (e) => {
  if (G.locked) {
    const k = 0.0022 * G.sens * (G.zoom ? 0.55 : 1);
    const dx = clamp(e.movementX, -400, 400), dy = clamp(e.movementY, -400, 400); // срезаем редкие скачки драйвера
    G.look.yaw = clamp(G.look.yaw - dx * k, -YAW_MAX, YAW_MAX);
    G.look.pitch = clamp(G.look.pitch + dy * k, PITCH_MIN, PITCH_MAX);
  } else if (!isMobile) {
    G.mouse.x = e.clientX / innerWidth;
    G.mouse.y = e.clientY / innerHeight;
  }
});
canvas.addEventListener('mousedown', (e) => {
  if (isMobile || !inHud()) return;
  if (!G.locked) { if (e.button === 0) lock(); return; }
  if (e.button === 0 && G.camMode === 'spect') nextSpot();
  else if (e.button === 0) primaryAction();
  else if (e.button === 2) G.zoom = true;
});
document.addEventListener('mouseup', (e) => { if (e.button === 2) G.zoom = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Сенсорный экран: тянешь — смотришь, тап — действие с тем, что под пальцем,
// второй палец — приглядеться (зум, пока держишь).
let touch = null;
const fingers = new Set();
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  audio.init();
  fingers.add(e.pointerId);
  if (fingers.size >= 2) { G.zoom = true; if (touch) touch.moved = true; return; }
  touch = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, id: e.pointerId, moved: false, t: performance.now() };
  try { canvas.setPointerCapture(e.pointerId); } catch { /* не критично */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (!touch || e.pointerId !== touch.id) return;
  const k = 0.005 * G.sens * (G.zoom ? 0.55 : 1);
  G.look.yaw = clamp(G.look.yaw - (e.clientX - touch.x) * k, -YAW_MAX, YAW_MAX);
  G.look.pitch = clamp(G.look.pitch + (e.clientY - touch.y) * k, PITCH_MIN, PITCH_MAX);
  touch.x = e.clientX; touch.y = e.clientY;
  if (Math.hypot(e.clientX - touch.sx, e.clientY - touch.sy) > 12) touch.moved = true;
});
const endTouch = (e) => {
  fingers.delete(e.pointerId);
  if (fingers.size < 2) G.zoom = false;
  if (!touch || e.pointerId !== touch.id) return;
  const tap = !touch.moved && performance.now() - touch.t < 600;
  if (tap && inHud() && G.camMode === 'spect') nextSpot();
  else if (tap && inHud() && G.camMode === 'fp') {
    primaryAction(updateAim(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)));
    // подсказка у прицела на телефоне не нужна: цель — там, куда ткнул
    G.aim = null; G.aimKey = ''; G.hover = -1; renderAim();
  }
  touch = null;
};
canvas.addEventListener('pointerup', endTouch);
canvas.addEventListener('pointercancel', (e) => { fingers.delete(e.pointerId); if (fingers.size < 2) G.zoom = false; if (touch && touch.id === e.pointerId) touch = null; });

function nextSpot() { G.specSpot = (G.specSpot + 1) % 4; G.look = { ...LOOK0 }; }

// время суток: в меню выбирается для новой комнаты, в лобби — для текущей
// погода: ясно или дождь (капли, пасмурное небо, мокрая брусчатка, шум)
function applyWeather(wx) {
  world.setWeather(wx);
  rain.mesh.visible = world.wx === 'rain';
  audio.setRain(world.wx === 'rain');
  for (const id of ['wxMenu', 'wxLobby']) [...$(id).children].forEach((b) => b.classList.toggle('on', b.dataset.wx === world.wx));
}
$('wxMenu').addEventListener('click', (e) => {
  const wx = e.target.dataset && e.target.dataset.wx;
  if (!wx) return;
  G.menuWx = wx; store.set('wx', wx);
  if (world) applyWeather(wx);
});
$('wxLobby').addEventListener('click', (e) => {
  const wx = e.target.dataset && e.target.dataset.wx;
  if (!wx) return;
  G.menuWx = wx; store.set('wx', wx);
  net.send({ t: 'wx', v: wx });
});

function syncTblButtons(tbl) {
  for (const id of ['tblMenu', 'tblLobby']) [...$(id).children].forEach((b) => b.classList.toggle('on', b.dataset.tbl === tbl));
}
$('tblMenu').addEventListener('click', (e) => {
  const tbl = e.target.dataset && e.target.dataset.tbl;
  if (!tbl) return;
  G.menuTbl = tbl; store.set('tbl', tbl);
  if (world) { world.setLayout(tbl); G.spkSet = false; }
  syncTblButtons(tbl);
});
$('tblLobby').addEventListener('click', (e) => {
  const tbl = e.target.dataset && e.target.dataset.tbl;
  if (!tbl) return;
  G.menuTbl = tbl; store.set('tbl', tbl);
  net.send({ t: 'tbl', v: tbl });
});

function syncTodButtons(tod) {
  for (const id of ['todMenu', 'todLobby']) [...$(id).children].forEach((b) => b.classList.toggle('on', b.dataset.tod === tod));
}
$('todMenu').addEventListener('click', (e) => {
  const tod = e.target.dataset && e.target.dataset.tod;
  if (!tod) return;
  G.menuTod = tod; store.set('tod', tod);
  if (world) world.setTime(tod);
  syncTodButtons(tod);
});
$('todLobby').addEventListener('click', (e) => {
  const tod = e.target.dataset && e.target.dataset.tod;
  if (!tod) return;
  G.menuTod = tod; store.set('tod', tod);
  net.send({ t: 'tod', v: tod });
});

function toggleSound() { audio.init(); audio.setMuted(!audio.muted); syncAudioBtns(); }
function toggleMusic() { audio.init(); audio.setMusic(!audio.music); syncAudioBtns(); }
function toggleFs() {
  if (document.fullscreenElement) { document.exitFullscreen(); return; }
  const p = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
  // на телефоне во весь экран заодно фиксируем горизонтальную ориентацию (где браузер это умеет)
  if (p) p.then(() => { if (isMobile) screen.orientation?.lock?.('landscape').catch(() => {}); }).catch(() => {});
}
// на iPhone полноэкранного режима для страниц нет — кнопки не показываем
if (!document.fullscreenEnabled) for (const id of ['fsBtn', 'pFs']) $(id).classList.add('hidden');
// Телефон: во весь экран сразу, с первого касания (браузер разрешает это только по жесту пользователя),
// ещё в главном меню. Если из полноэкранного вышли (жест «назад»), следующее касание вернёт его.
// Касание поля ввода не считается: там открывается клавиатура.
if (isMobile && document.fullscreenEnabled) {
  addEventListener('pointerup', (e) => {
    if (document.fullscreenElement || e.target.closest?.('input, textarea')) return;
    if (e.target.closest?.('#fsBtn, #pFs')) return; // эти кнопки сами переключают режим
    toggleFs();
  }, true);
}
if (isMobile) $('sensLabel').textContent = 'Чувствительность';
function syncAudioBtns() {
  $('sndBtn').classList.toggle('off', audio.muted);
  $('musBtn').classList.toggle('off', !audio.music);
  $('pSnd').textContent = `Звук: ${audio.muted ? 'выкл' : 'вкл'}`;
  $('pMus').textContent = `Музыка: ${audio.music ? 'вкл' : 'выкл'}`;
}
function openRules() { unlock(); $('rules').classList.remove('hidden'); updatePause(); }
function closeRules() { $('rules').classList.add('hidden'); updatePause(); lock(); }

// Бинды по физическим клавишам (e.code): работают и в русской раскладке.
addEventListener('keydown', (e) => {
  const tg = e.target;
  if (tg.tagName === 'INPUT' && tg.type !== 'range') { if (e.key === 'Enter') { tg.id === 'codeIn' ? goOnline(false) : goOnline(true); } return; }
  if (!$('rules').classList.contains('hidden')) { if (e.code === 'Escape' || e.code === 'KeyH' || e.code === 'Enter') closeRules(); return; }
  if (G.screen !== 'hud') return;
  if (!$('over').classList.contains('hidden')) { if (e.code === 'Enter' && !$('againBtn').disabled) $('againBtn').click(); return; }
  if (e.repeat) return;
  const c = e.code;
  if (/^(Digit|Numpad)[1-5]$/.test(c)) toggleCard(+c.slice(-1) - 1);
  else if (c === 'Space' || c === 'Enter' || c === 'NumpadEnter') { e.preventDefault(); if (G.camMode === 'spect') nextSpot(); else playSelected(); }
  else if (c === 'KeyQ' || c === 'KeyL') callLiar();
  else if (c === 'KeyE') smoke();
  else if (c === 'KeyX' || c === 'Backspace') clearSel();
  else if (c === 'KeyC') { G.look.yaw = LOOK0.yaw; G.look.pitch = LOOK0.pitch; }
  else if (c === 'KeyM') toggleMusic();
  else if (c === 'KeyN') toggleSound();
  else if (c === 'KeyF') toggleFs();
  else if (c === 'KeyH' || c === 'F1') { e.preventDefault(); openRules(); }
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
$('menuBtn2').addEventListener('click', leave);
$('startBtn').addEventListener('click', () => { audio.init(); net.send({ t: 'start' }); });
$('againBtn').addEventListener('click', () => { net.send({ t: 'again' }); $('over').classList.add('hidden'); updatePause(); lock(); });
$('playBtn').addEventListener('click', playSelected);
$('liarBtn').addEventListener('click', callLiar);
$('smokeBtn').addEventListener('click', smoke);
$('rulesBtn').addEventListener('click', openRules);
$('helpBtn').addEventListener('click', openRules);
$('rulesClose').addEventListener('click', closeRules);
$('rules').addEventListener('click', (e) => { if (e.target.id === 'rules') closeRules(); });
const resume = () => { if (isMobile) { G.touchPause = false; updatePause(); } else lock(); };
$('resumeBtn').addEventListener('click', resume);
$('pause').addEventListener('click', (e) => { if (e.target.id === 'pause') resume(); });
$('setBtn').addEventListener('click', () => { G.touchPause = true; updatePause(); });
$('pSnd').addEventListener('click', toggleSound);
$('pMus').addEventListener('click', toggleMusic);
$('pFs').addEventListener('click', toggleFs);
$('pRules').addEventListener('click', openRules);
$('pExit').addEventListener('click', leave);
const showSens = () => { $('sensIn').value = G.sens; $('sensVal').textContent = G.sens.toFixed(2); };
showSens();
$('sensIn').addEventListener('input', () => { G.sens = clamp(+$('sensIn').value || 1, 0.25, 3); store.set('sens', G.sens); showSens(); });
// лимит FPS: одно значение на меню и паузу, пусто или 0 — без лимита
const fpsIns = [...document.querySelectorAll('.fpsIn')];
const showFps = () => fpsIns.forEach((el) => { if (document.activeElement !== el) el.value = fpsCap ? String(fpsCap) : ''; });
showFps();
fpsIns.forEach((el) => {
  el.addEventListener('input', () => {
    const v = el.value.trim() === '' ? 0 : clamp(Math.round(+el.value || 0), 0, 1000);
    fpsCap = v; frameDue = 0;
    store.set('fps', String(v));
    fpsIns.forEach((o) => { if (o !== el) o.value = v ? String(v) : ''; });
  });
  el.addEventListener('change', showFps);
  el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') el.blur(); }); // цифры и Enter в поле — не команды игры
});
$('copyBtn').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${G.code}`;
  try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована — кидай друзьям'); } catch { toast(url, 6000); }
});
$('sndBtn').addEventListener('click', toggleSound);
$('musBtn').addEventListener('click', toggleMusic);
$('fsBtn').addEventListener('click', toggleFs);
syncAudioBtns();
const gfxNames = { high: 'высокая', mid: 'средняя', low: 'низкая' };
$('gfxBtn').textContent = `Графика: ${gfxNames[quality] || 'средняя'}`;
$('gfxBtn').addEventListener('click', () => {
  const order = ['high', 'mid', 'low'];
  const nq = order[(order.indexOf(quality) + 1) % 3];
  store.set('gfx', nq);
  location.reload();
});
$('nameIn').addEventListener('change', () => { if (G.st) net.send({ t: 'name', nm: myName() }); });

const qs = new URLSearchParams(location.search);
if (qs.get('room')) $('codeIn').value = qs.get('room').toUpperCase().slice(0, 6);

window.addEventListener('error', (e) => { console.error(e.error || e.message); });
boot().catch((e) => { console.error(e); $('loadMsg').textContent = 'Не удалось запустить 3D: ' + (e.message || e); });
if (qs.has('debug')) Object.assign(window, { __G: G, __net: net, __chars: chars, __cam: camera, __THREE: THREE, __audio: audio, __renderer: renderer, __scene: scene, __composer: composer, __world: () => world });
if (qs.has('debug')) window.__advance = (sec) => { for (let t = 0; t < sec; t += 1 / 30) { stepChars(1 / 30, clock.elapsedTime + t); cards.update(1 / 30); particles.update(1 / 30, camera); } };
