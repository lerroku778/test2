// Правила Liar's Deck: колода 20 карт (6 K, 6 Q, 6 A, 2 джокера), по 5 карт,
// стол королей/дам/тузов, 1–3 карты за ход, «Лжец!» — и вместо револьвера
// бутылка «Чеколейтора»: шесть глотков, один отравлен.

export const TABLES = ['K', 'Q', 'A'];
export const RANK_MANY = { K: 'королей', Q: 'дам', A: 'тузов', J: 'джокеров' };
export const RANK_TABLE = { K: 'Стол королей', Q: 'Стол дам', A: 'Стол тузов' };
export const RANK_ONE = { K: 'король', Q: 'дама', A: 'туз', J: 'джокер' };
export const SHOTS = 6;

export const CHARS = [
  { key: 'metal', name: 'Шеим', tag: 'Рокер в кожанке' },
  { key: 'doll', name: 'Няшкакоджладка', tag: 'Рюши, бантики, холод' },
  { key: 'alien', name: 'Инопришленец юпитерский', tag: 'Прилетел за пивом' },
  { key: 'priest', name: 'Коджлад', tag: 'Всё видел, всё знает' },
  { key: 'boss', name: 'Мишаня', tag: 'Всё решено заранее' },
];
export const CHAR_KEYS = CHARS.map((c) => c.key);
export const charInfo = (k) => CHARS.find((c) => c.key === k) || CHARS[0];
export const TABLE_SPOTS = ['center', 'counter', 'ropes'];
export const WEATHERS = ['clear', 'rain'];
const freeChar = (st, pref) => {
  const used = new Set(st.seats.map((s) => s.ch).filter(Boolean));
  return pref && CHAR_KEYS.includes(pref) && !used.has(pref) ? pref : CHAR_KEYS.find((k) => !used.has(k));
};

export const TODS = ['day', 'evening', 'night'];

export const TIMES = { deal: 2600, turn: 45000, reveal: 4200, drink: 7600 };

const rid = () => Math.random().toString(36).slice(2, 10);

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function emptySeat() {
  return { pid: null, nm: '', bot: false, alive: true, hand: [], shots: 0, psn: 1, smk: 0, ch: null, empty: false };
}

export function newLobby() {
  return {
    gid: rid(), seq: 1, ph: 'lobby', seats: [0, 1, 2, 3].map(emptySeat),
    round: 0, table: 'K', turn: -1, last: null, pile: 0, rev: null, dr: null,
    win: -1, now: Date.now(), dl: 0, ev: null, people: [], tod: 'evening', tbl: 'center', wx: 'clear',
  };
}

export const aliveIdx = (st) => st.seats.map((_, i) => i).filter((i) => st.seats[i].alive);

export function nextAlive(st, from, pred) {
  for (let k = 1; k <= 4; k++) {
    const i = (from + k) % 4;
    const s = st.seats[i];
    if (s.alive && (!pred || pred(s, i))) return i;
  }
  return -1;
}

function setPhase(st, ph) {
  st.ph = ph;
  st.now = Date.now();
  st.dl = TIMES[ph] ? st.now + TIMES[ph] : 0;
}

export function sit(st, pid, nm, seat, pref) {
  if (st.ph !== 'lobby' && st.ph !== 'over') return false;
  if (!(seat >= 0 && seat < 4)) return false;
  const s = st.seats[seat];
  if (s.pid && s.pid !== pid) return false;
  const mine = st.seats.find((o) => o.pid === pid);
  const keep = mine ? mine.ch : null;
  stand(st, pid);
  Object.assign(s, emptySeat(), { pid, nm, bot: false });
  s.ch = freeChar(st, keep || pref);
  return true;
}

// Сменить персонажа: каждый персонаж за столом только у одного игрока
export function setChar(st, pid, k) {
  if (st.ph !== 'lobby' && st.ph !== 'over') return false;
  const s = st.seats.find((o) => o.pid === pid);
  if (!s || !CHAR_KEYS.includes(k) || st.seats.some((o) => o !== s && o.ch === k)) return false;
  s.ch = k;
  return true;
}

export function stand(st, pid) {
  if (st.ph !== 'lobby' && st.ph !== 'over') return false;
  st.seats.forEach((s, i) => { if (s.pid === pid) st.seats[i] = emptySeat(); });
  return true;
}

// bots: одиночная игра добивает стол ботами; в мультиплеере играют только люди (от двух)
export function startGame(st, bots = true) {
  if (st.ph !== 'lobby' && st.ph !== 'over') return false;
  const humans = st.seats.filter((s) => s.pid).length;
  if (humans < (bots ? 1 : 2)) return false;
  st.seats.forEach((s) => {
    if (!s.pid && bots) { s.bot = true; s.empty = false; s.ch = freeChar(st, s.ch); s.nm = charInfo(s.ch).name; } else if (!s.pid) { s.bot = false; s.empty = true; s.ch = null; s.nm = ''; } else { s.bot = false; s.empty = false; }
    s.alive = !s.empty; s.shots = 0; s.hand = []; s.smk = 0;
    s.psn = 1 + Math.floor(Math.random() * SHOTS);
  });
  st.round = 0; st.win = -1; st.gid = rid();
  const al = aliveIdx(st);
  dealRound(st, al[Math.floor(Math.random() * al.length)]);
  return true;
}

export function backToLobby(st) {
  st.seats.forEach((s, i) => {
    if (s.bot || !s.pid) st.seats[i] = emptySeat();
    else Object.assign(s, { alive: true, hand: [], shots: 0, smk: 0 });
  });
  st.round = 0; st.last = null; st.pile = 0; st.rev = null; st.dr = null; st.win = -1; st.turn = -1;
  setPhase(st, 'lobby');
  st.ev = { k: 'lobby' };
}

export function dealRound(st, starter) {
  const deck = shuffle([...'KKKKKKQQQQQQAAAAAAJJ']);
  st.seats.forEach((s) => { s.hand = s.alive ? deck.splice(0, 5) : []; });
  st.table = TABLES[Math.floor(Math.random() * 3)];
  st.round++;
  st.last = null; st.pile = 0; st.rev = null; st.dr = null;
  st.turn = starter;
  setPhase(st, 'deal');
  st.ev = { k: 'deal', r: st.round };
}

export function canCall(st, s) {
  return st.ph === 'turn' && st.turn === s && !!st.last && st.last.s !== s;
}

export function play(st, s, idxs) {
  if (st.ph !== 'turn' || st.turn !== s) return false;
  const seat = st.seats[s];
  idxs = [...new Set(idxs)].filter((i) => Number.isInteger(i) && i >= 0 && i < seat.hand.length);
  if (idxs.length < 1 || idxs.length > 3) return false;
  const cards = idxs.map((i) => seat.hand[i]);
  seat.hand = seat.hand.filter((_, i) => !idxs.includes(i));
  st.last = { s, c: cards };
  st.pile += cards.length;
  st.ev = { k: 'play', s, n: cards.length, id: rid() };
  const nxt = nextAlive(st, s, (o, i) => i !== s && o.hand.length > 0);
  if (nxt === -1) {
    // Карты остались только у одного — следующий живой обязан вскрыть.
    const caller = nextAlive(st, s, (o, i) => i !== s);
    return liar(st, caller, true);
  }
  st.turn = nxt;
  setPhase(st, 'turn');
  return true;
}

export function liar(st, s, forced = false) {
  if (!forced && !canCall(st, s)) return false;
  const lied = st.last.c.some((c) => c !== st.table && c !== 'J');
  st.rev = { by: s, on: st.last.s, c: st.last.c, lied, f: !!forced };
  st.turn = s;
  st.ev = { k: 'liar', s, t: st.last.s, id: rid() };
  setPhase(st, 'reveal');
  return true;
}

function toDrink(st) {
  const tgt = st.rev.lied ? st.rev.on : st.rev.by;
  const seat = st.seats[tgt];
  seat.shots++;
  const dead = seat.shots >= seat.psn;
  st.dr = { s: tgt, n: seat.shots, dead };
  if (dead) { seat.alive = false; seat.hand = []; }
  setPhase(st, 'drink');
  st.ev = { k: 'drink', s: tgt, id: rid() };
}

function afterDrink(st) {
  const al = aliveIdx(st);
  if (al.length <= 1) {
    st.win = al.length ? al[0] : -1;
    setPhase(st, 'over');
    st.ev = { k: 'over', w: st.win };
    return;
  }
  const t = st.dr.s;
  dealRound(st, st.seats[t].alive ? t : nextAlive(st, t));
}

// Таймеры фаз. Возвращает true, если состояние изменилось.
export function tick(st, now) {
  if (!st.dl || now < st.dl) return false;
  if (st.ph === 'deal') { setPhase(st, 'turn'); st.ev = { k: 'turn' }; return true; }
  if (st.ph === 'reveal') { toDrink(st); return true; }
  if (st.ph === 'drink') { afterDrink(st); return true; }
  if (st.ph === 'turn') { botAct(st, st.turn, true); return true; }
  return false;
}

// ---------- боты ----------
export function botDecide(st, s) {
  const me = st.seats[s];
  const T = st.table;
  const good = me.hand.filter((c) => c === T || c === 'J');
  const bad = me.hand.filter((c) => c !== T && c !== 'J');
  if (canCall(st, s)) {
    const n = st.last.c.length;
    const outside = 8 - good.length; // правдивых карт вне моей руки
    let p = 0.12 + 0.13 * (n - 1) + (st.pile / Math.max(1, outside)) * 0.35;
    if (st.pile > outside) p = 1;
    if (me.hand.length === 0) p = 1;
    const others = st.seats.filter((o, i) => i !== s && o.alive && o.hand.length > 0).length;
    if (others <= 1 && st.seats[st.last.s].hand.length === 0) p += 0.2;
    if (bad.length === me.hand.length) p += 0.15; // врать придётся — лучше вскрыть
    if (Math.random() < Math.min(0.95, p)) return { t: 'liar' };
  }
  const idx = (c, used) => me.hand.findIndex((x, i) => x === c && !used.includes(i));
  const pick = [];
  const take = (arr, k) => {
    for (const c of arr.slice(0, k)) { const i = idx(c, pick); if (i >= 0) pick.push(i); }
  };
  if (good.length) {
    const k = Math.min(good.length, good.length === me.hand.length ? 3 : 1 + Math.floor(Math.random() * 2));
    take(good, k);
    if (bad.length && pick.length < 3 && Math.random() < 0.18) take(bad, 1);
  } else {
    take(bad, Math.random() < 0.7 ? 1 : 2);
  }
  if (!pick.length) pick.push(0);
  return { t: 'play', a: pick.slice(0, 3) };
}

export function botAct(st, s) {
  const d = botDecide(st, s);
  if (d.t === 'liar' && liar(st, s)) return true;
  return play(st, s, d.a);
}

// Что видит конкретный игрок: чужие руки и номер отравленного глотка скрыты.
export function viewFor(st, pid) {
  const v = JSON.parse(JSON.stringify(st));
  v.seats.forEach((s) => {
    s.n = s.hand.length;
    if (s.pid !== pid || !pid) s.hand = [];
    delete s.psn;
  });
  if (v.last && !(v.ph === 'reveal' || v.ph === 'drink')) v.last = { s: v.last.s, n: v.last.c.length };
  else if (v.last) v.last.n = v.last.c.length;
  return v;
}
