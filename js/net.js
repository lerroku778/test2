// Связь с сервером (WebSocket) или локальная комната для игры с ботами.
import { Room } from './room.js';

export class Net {
  constructor(onMsg) {
    this.onMsg = onMsg;
    this.ws = null;
    this.local = null;
    this.pid = null;
    this.code = null;
    this.timer = null;
  }

  // Одиночная игра: та же комната, но в браузере.
  playLocal(nm) {
    this.close();
    this.pid = 'me';
    this.local = new Room('СОЛО', (pid, msg) => { if (pid === 'me') queueMicrotask(() => this.onMsg(msg)); });
    this.local.join('me', nm);
    this.timer = setInterval(() => this.local && this.local.tick(Date.now()), 150);
  }

  connect(nm, { create = false, code = '' } = {}) {
    this.close();
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(new Error('Не удалось подключиться к серверу')); return; }
      this.ws = ws;
      let opened = false;
      const to = setTimeout(() => { if (!opened) { ws.close(); reject(new Error('Сервер не отвечает')); } }, 7000);
      ws.onopen = () => { opened = true; clearTimeout(to); ws.send(JSON.stringify({ t: 'hello', nm, create, code })); };
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'joined') { this.pid = m.pid; this.code = m.code; resolve(m); }
        if (m.t === 'err') reject(new Error(m.e));
        this.onMsg(m);
      };
      ws.onerror = () => { if (!opened) { clearTimeout(to); reject(new Error('Сервер недоступен. Мультиплеер работает, когда игра запущена через node server.js')); } };
      ws.onclose = () => { if (this.ws === ws) { this.ws = null; this.onMsg({ t: 'closed' }); } };
    });
  }

  send(m) {
    if (this.local) this.local.handle('me', m);
    else if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.local = null;
    if (this.ws) { const w = this.ws; this.ws = null; try { w.close(); } catch { /* уже закрыт */ } }
  }

  get online() { return !!this.ws; }
}
