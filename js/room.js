// Комната: одна партия, её люди и боты. Работает и на сервере (Node),
// и в браузере для одиночной игры — код один и тот же.
import * as E from './engine.js';

const clean = (s, n = 16) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);

export class Room {
  constructor(code, send, { tod, tbl, wx, bots = false } = {}) {
    this.code = code;
    this.send = send; // (pid, msg) => void
    this.bots = bots; // боты только в одиночной игре
    this.st = E.newLobby();
    if (E.TODS.includes(tod)) this.st.tod = tod;
    if (E.TABLE_SPOTS.includes(tbl)) this.st.tbl = tbl;
    if (E.WEATHERS.includes(wx)) this.st.wx = wx;
    this.people = new Map(); // pid -> { nm }
    this.botAt = 0;
    this.botSeq = -1;
    this.emptySince = 0;
  }

  get size() { return this.people.size; }

  join(pid, nm) {
    this.people.set(pid, { nm: clean(nm) || 'Игрок' });
    this.emptySince = 0;
    this.send(pid, { t: 'joined', code: this.code, pid });
    this.push();
  }

  leave(pid) {
    this.people.delete(pid);
    const st = this.st;
    if (st.ph === 'lobby' || st.ph === 'over') E.stand(st, pid);
    else st.seats.forEach((s) => { if (s.pid === pid) { s.pid = null; s.bot = true; s.nm = s.nm + ' (бот)'; } });
    if (!this.people.size) this.emptySince = Date.now();
    this.push();
  }

  handle(pid, m) {
    if (!m || typeof m !== 'object' || !this.people.has(pid)) return;
    const st = this.st;
    const seat = st.seats.findIndex((s) => s.pid === pid);
    let ok = false;
    switch (m.t) {
      case 'name': {
        const nm = clean(m.nm);
        if (nm) { this.people.get(pid).nm = nm; if (seat >= 0 && (st.ph === 'lobby' || st.ph === 'over')) st.seats[seat].nm = nm; ok = true; }
        break;
      }
      case 'sit': ok = E.sit(st, pid, this.people.get(pid).nm, m.seat | 0, this.people.get(pid).ch); break;
      case 'char':
        if (E.CHAR_KEYS.includes(m.k)) { this.people.get(pid).ch = m.k; ok = seat >= 0 ? E.setChar(st, pid, m.k) : true; }
        break;
      case 'wx':
        if ((st.ph === 'lobby' || st.ph === 'over') && E.WEATHERS.includes(m.v)) { st.wx = m.v; ok = true; }
        break;
      case 'tbl':
        if ((st.ph === 'lobby' || st.ph === 'over') && E.TABLE_SPOTS.includes(m.v)) { st.tbl = m.v; ok = true; }
        break;
      case 'look': // куда смотрит игрок — только пересылаем остальным, состояние не трогаем
        if (seat >= 0 && Number.isFinite(m.y) && Number.isFinite(m.p)) {
          const msg = { t: 'look', s: seat, y: Math.max(-2, Math.min(2, m.y)), p: Math.max(-1.5, Math.min(1.5, m.p)) };
          for (const other of this.people.keys()) if (other !== pid) this.send(other, msg);
        }
        break;
      case 'stand': ok = E.stand(st, pid); break;
      case 'tod': // время суток меняется только до начала партии
        if ((st.ph === 'lobby' || st.ph === 'over') && E.TODS.includes(m.v)) { st.tod = m.v; ok = true; }
        break;
      case 'start': ok = seat >= 0 && E.startGame(st, this.bots); break;
      case 'again': if (st.ph === 'over') { E.backToLobby(st); ok = true; } break;
      case 'play': ok = seat >= 0 && Array.isArray(m.a) && E.play(st, seat, m.a.slice(0, 3).map((x) => x | 0)); break;
      case 'liar': ok = seat >= 0 && E.liar(st, seat); break;
      case 'smoke':
        if (seat >= 0 && st.seats[seat].alive && Date.now() - st.seats[seat].smk > 13000) { st.seats[seat].smk = Date.now(); ok = true; }
        break;
      case 'emote':
        if (seat >= 0 && typeof m.e === 'number') { this.broadcast({ t: 'emote', s: seat, e: m.e | 0 }); }
        break;
    }
    if (ok) this.push();
  }

  tick(now = Date.now()) {
    const st = this.st;
    let changed = E.tick(st, now);
    if (st.ph === 'turn' && st.seats[st.turn]?.bot) {
      if (this.botSeq !== st.seq) { this.botSeq = st.seq; this.botAt = now + 1600 + Math.random() * 2600; }
      else if (now >= this.botAt) { E.botAct(st, st.turn); changed = true; }
    }
    // Боты иногда курят.
    if (st.ph !== 'lobby' && st.ph !== 'over' && Math.random() < 0.0016) {
      const i = Math.floor(Math.random() * 4);
      const s = st.seats[i];
      if (s.bot && s.alive && now - s.smk > 30000) { s.smk = now; changed = true; }
    }
    if (changed) this.push();
  }

  broadcast(msg) { for (const pid of this.people.keys()) this.send(pid, msg); }

  push() {
    const st = this.st;
    st.seq++;
    st.now = Date.now();
    st.people = [...this.people].map(([pid, p]) => ({ pid, nm: p.nm }));
    for (const pid of this.people.keys()) this.send(pid, { t: 'st', st: E.viewFor(st, pid) });
  }
}
