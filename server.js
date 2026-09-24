// Сервер «Ублюдского бара»: раздаёт статику и держит комнаты по WebSocket.
// Запуск: npm install && node server.js   (порт — переменная PORT, по умолчанию 8080)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { Room } from './js/room.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_ROOMS = +process.env.MAX_ROOMS || 200;
const MAX_PER_ROOM = 12;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8',
};
const PUBLIC = ['index.html', 'js/', 'vendor/', 'assets/'];

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/' || p === '') p = '/index.html';
    if (p === '/health') { res.writeHead(200).end('ok'); return; }
    const rel = normalize(p).replace(/^[/\\]+/, '');
    if (rel.includes('..') || !PUBLIC.some((x) => rel === x || rel.startsWith(x))) { res.writeHead(404).end('Not found'); return; }
    const file = join(ROOT, rel);
    const s = await stat(file);
    if (!s.isFile()) throw new Error('nf');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': rel.startsWith('vendor/') ? 'public, max-age=604800' : 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

const rooms = new Map(); // code -> Room
const sockets = new Map(); // pid -> ws
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => { let c; do { c = [...randomBytes(4)].map((b) => ALPHA[b % ALPHA.length]).join(''); } while (rooms.has(c)); return c; };
const send = (pid, msg) => { const ws = sockets.get(pid); if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws) => {
  const pid = randomBytes(6).toString('hex');
  sockets.set(pid, ws);
  let room = null;
  let bucket = 20; // простой лимит сообщений
  const refill = setInterval(() => { bucket = Math.min(20, bucket + 5); }, 1000);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    if (--bucket < 0) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      if (room) return;
      let code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (m.create || !code) {
        if (rooms.size >= MAX_ROOMS) { send(pid, { t: 'err', e: 'Сервер заполнен, попробуй позже' }); return; }
        code = newCode();
        rooms.set(code, new Room(code, send));
      }
      room = rooms.get(code);
      if (!room) { send(pid, { t: 'err', e: 'Комната ' + code + ' не найдена' }); return; }
      if (room.size >= MAX_PER_ROOM) { room = null; send(pid, { t: 'err', e: 'В комнате нет мест' }); return; }
      room.join(pid, m.nm);
      return;
    }
    if (room) room.handle(pid, m);
  });

  ws.on('close', () => {
    clearInterval(refill);
    sockets.delete(pid);
    if (room) room.leave(pid);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (!r.size && r.emptySince && now - r.emptySince > 60_000) rooms.delete(code);
    else r.tick(now);
  }
}, 200);

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 20_000);

server.listen(PORT, HOST, () => console.log(`Ублюдский бар: http://${HOST}:${PORT}`));
