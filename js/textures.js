// Процедурные текстуры: всё рисуется на canvas при загрузке, внешних картинок нет.
import * as THREE from 'three';

export let MAX_ANISO = 8;
export const setAniso = (n) => { MAX_ANISO = n; };

export function rng(seed = 1) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

export function toTex(c, { repeat = [1, 1], srgb = true, rot = 0 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  if (rot) { t.center.set(0.5, 0.5); t.rotation = rot; }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}

const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const rgba = (h, a = 1) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; };
export const shade = (h, k) => {
  const [r, g, b] = hex(h).map((v) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)))));
  return `rgb(${r},${g},${b})`;
};

// Мелкий шум поверх любого холста — убирает «компьютерную» гладкость.
export function grain(g, w, h, amt = 18, seed = 3) {
  const r = rng(seed);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

// Низкочастотные пятна (грязь, выцветание)
function blotches(g, w, h, color, count, rmin, rmax, amin, amax, r) {
  for (let i = 0; i < count; i++) {
    const x = r() * w, y = r() * h, rad = rmin + r() * (rmax - rmin);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, rgba(color, amin + r() * (amax - amin)));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

// ---------- дерево ----------
export function woodCanvas({ w = 512, h = 1024, base = '#6b4428', dark = '#2e1a0d', light = '#9a6a3f', planks = 4, seed = 1, gaps = true, knots = 0.5, scratches = 0 } = {}) {
  const [c, g] = canvas(w, h);
  const r = rng(seed);
  const pw = w / planks;
  for (let p = 0; p < planks; p++) {
    const x0 = p * pw;
    g.fillStyle = shade(base, (r() - 0.5) * 0.22);
    g.fillRect(x0, 0, pw, h);
    // волокна
    for (let k = 0; k < 90; k++) {
      const x = x0 + r() * pw, amp = 1.5 + r() * 7, f = 0.002 + r() * 0.012, ph = r() * 6.28;
      g.strokeStyle = r() < 0.62 ? rgba(dark, 0.05 + r() * 0.2) : rgba(light, 0.05 + r() * 0.14);
      g.lineWidth = 0.4 + r() * 2.2;
      g.beginPath();
      for (let y = -8; y <= h + 8; y += 6) {
        const xx = x + Math.sin(y * f + ph) * amp + Math.sin(y * f * 3.1 + ph * 2) * amp * 0.25;
        y < 0 ? g.moveTo(xx, y) : g.lineTo(xx, y);
      }
      g.stroke();
    }
    // сучки
    if (r() < knots) {
      const kx = x0 + pw * (0.25 + r() * 0.5), ky = r() * h;
      for (let q = 0; q < 9; q++) {
        g.strokeStyle = rgba(dark, 0.12 + q * 0.02);
        g.lineWidth = 1 + r();
        g.beginPath(); g.ellipse(kx, ky, 2 + q * 2.3, 6 + q * 6, 0, 0, 6.283); g.stroke();
      }
      g.fillStyle = rgba(dark, 0.7); g.beginPath(); g.ellipse(kx, ky, 3, 6, 0, 0, 6.283); g.fill();
    }
    // затенение по краям доски
    const eg = g.createLinearGradient(x0, 0, x0 + pw, 0);
    eg.addColorStop(0, 'rgba(0,0,0,0.28)'); eg.addColorStop(0.08, 'rgba(0,0,0,0)');
    eg.addColorStop(0.92, 'rgba(0,0,0,0)'); eg.addColorStop(1, 'rgba(0,0,0,0.22)');
    g.fillStyle = eg; g.fillRect(x0, 0, pw, h);
    if (gaps) { g.fillStyle = 'rgba(10,5,2,0.92)'; g.fillRect(x0, 0, 2.5, h); }
  }
  blotches(g, w, h, dark, 14, 40, 160, 0.03, 0.1, r);
  for (let i = 0; i < scratches; i++) {
    g.strokeStyle = rgba(light, 0.08 + r() * 0.18); g.lineWidth = 0.6 + r() * 0.8;
    const x = r() * w, y = r() * h, a = r() * 6.28, l = 10 + r() * 70;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (r() - 0.5) * 10, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  grain(g, w, h, 12, seed + 7);
  return c;
}

// Рельеф для дерева: светлое — выше
export function bumpFrom(src, { contrast = 1.4, invert = false } = {}) {
  const [c, g] = canvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let v = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11);
    v = (v - 128) * contrast + 128;
    if (invert) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------- брусчатка ----------
export function pavingCanvases(seed = 11) {
  const W = 1024, H = 1024;
  const [c, g] = canvas(W, H);
  const [b, bg] = canvas(W, H);
  const r = rng(seed);
  g.fillStyle = '#2d2f31'; g.fillRect(0, 0, W, H);
  bg.fillStyle = '#000'; bg.fillRect(0, 0, W, H);
  const bw = 128, bh = 64, j = 5;
  for (let row = 0; row < H / bh; row++) {
    const off = (row % 2) * bw / 2;
    for (let col = -1; col < W / bw + 1; col++) {
      const x = col * bw + off, y = row * bh;
      const tone = 0.34 + r() * 0.16;
      const hue = r() < 0.2 ? [98, 104, 112] : [92, 96, 99];
      const base = hue.map((v) => Math.round(v * tone * 1.9));
      const gr = g.createLinearGradient(x, y, x + bw, y + bh);
      gr.addColorStop(0, `rgb(${base.map((v) => v + 12).join(',')})`);
      gr.addColorStop(1, `rgb(${base.map((v) => v - 10).join(',')})`);
      g.fillStyle = gr;
      roundRect(g, x + j / 2, y + j / 2, bw - j, bh - j, 7); g.fill();
      // фаска: свет сверху-слева
      g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x + j, y + bh - j); g.lineTo(x + j, y + j); g.lineTo(x + bw - j, y + j); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.beginPath(); g.moveTo(x + bw - j, y + j); g.lineTo(x + bw - j, y + bh - j); g.lineTo(x + j, y + bh - j); g.stroke();
      // крапинки камня
      for (let k = 0; k < 70; k++) {
        g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
        g.fillRect(x + j + r() * (bw - 2 * j), y + j + r() * (bh - 2 * j), 1 + r() * 2.5, 1 + r() * 2.5);
      }
      // рельеф
      const bgr = bg.createRadialGradient(x + bw / 2, y + bh / 2, 4, x + bw / 2, y + bh / 2, bw * 0.6);
      bgr.addColorStop(0, '#f0f0f0'); bgr.addColorStop(1, '#a8a8a8');
      bg.fillStyle = bgr; roundRect(bg, x + j / 2 + 1, y + j / 2 + 1, bw - j - 2, bh - j - 2, 8); bg.fill();
      // трещины
      if (r() < 0.12) {
        g.strokeStyle = 'rgba(8,8,8,0.7)'; bg.strokeStyle = '#303030'; g.lineWidth = bg.lineWidth = 1.4;
        let px = x + j + r() * (bw - 2 * j), py = y + j;
        g.beginPath(); bg.beginPath(); g.moveTo(px, py); bg.moveTo(px, py);
        while (py < y + bh - j) { px += (r() - 0.5) * 14; py += 4 + r() * 8; g.lineTo(px, py); bg.lineTo(px, py); }
        g.stroke(); bg.stroke();
      }
    }
  }
  // мокрые тёмные пятна и грязь
  blotches(g, W, H, '#0d0f11', 26, 60, 220, 0.05, 0.22, r);
  blotches(g, W, H, '#4c5057', 10, 80, 200, 0.03, 0.1, r);
  grain(g, W, H, 14, seed);
  return { map: c, bump: b };
}

export function roundRect(g, x, y, w, h, rad) {
  g.beginPath();
  g.moveTo(x + rad, y); g.arcTo(x + w, y, x + w, y + h, rad); g.arcTo(x + w, y + h, x, y + h, rad);
  g.arcTo(x, y + h, x, y, rad); g.arcTo(x, y, x + w, y, rad); g.closePath();
}

// ---------- шиферная плитка (низкая стенка) ----------
export function slateCanvas(seed = 5) {
  const [c, g] = canvas(1024, 256);
  const r = rng(seed);
  g.fillStyle = '#3a3c3f'; g.fillRect(0, 0, 1024, 256);
  let y = 0;
  while (y < 256) {
    const hh = 10 + r() * 22;
    let x = -r() * 60;
    while (x < 1024) {
      const ww = 40 + r() * 120;
      const t = 50 + r() * 45;
      g.fillStyle = `rgb(${t},${t + 3},${t + 7})`;
      g.fillRect(x + 1, y + 1, ww - 2, hh - 2);
      g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x + 1, y + 1, ww - 2, 2);
      for (let k = 0; k < 6; k++) { g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.12})`; g.fillRect(x + r() * ww, y + r() * hh, 6 + r() * 30, 1 + r() * 2); }
      x += ww;
    }
    y += hh;
  }
  grain(g, 1024, 256, 16, seed);
  return c;
}

// ---------- бежевая блочная стена с полосами ----------
export function blockWallCanvas(seed = 21) {
  const [c, g] = canvas(1024, 1024);
  const r = rng(seed);
  g.fillStyle = '#d6c7a6'; g.fillRect(0, 0, 1024, 1024);
  const bh = 64;
  for (let row = 0; row < 16; row++) {
    const stripe = row % 4 === 1;
    for (let col = 0; col < 8; col++) {
      const x = col * 128 + (row % 2) * 64, y = row * bh;
      const t = (r() - 0.5) * 0.06;
      g.fillStyle = stripe ? shade('#c9876a', t) : shade('#dccdae', t);
      g.fillRect(x + 1.5, y + 1.5, 125, bh - 3);
      g.fillRect(x - 1024 + 1.5, y + 1.5, 125, bh - 3);
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 1.5, y + 1.5, 125, 2);
    }
  }
  blotches(g, 1024, 1024, '#7a6a52', 30, 30, 160, 0.03, 0.12, r);
  // потёки
  for (let i = 0; i < 40; i++) {
    const x = r() * 1024, y = r() * 600, l = 60 + r() * 300;
    const gr = g.createLinearGradient(0, y, 0, y + l);
    gr.addColorStop(0, 'rgba(90,75,55,0.12)'); gr.addColorStop(1, 'rgba(90,75,55,0)');
    g.fillStyle = gr; g.fillRect(x, y, 2 + r() * 5, l);
  }
  grain(g, 1024, 1024, 12, seed);
  return c;
}

// ---------- мурал: бородач в наушниках ----------
export function muralCanvas() {
  const W = 1600, H = 960;
  const [c, g] = canvas(W, H);
  const r = rng(77);
  const bgG = g.createLinearGradient(0, 0, W, H);
  bgG.addColorStop(0, '#d9467e'); bgG.addColorStop(0.45, '#c2408f'); bgG.addColorStop(1, '#7b3aa3');
  g.fillStyle = bgG; g.fillRect(0, 0, W, H);
  // большие формы
  g.fillStyle = '#e6608f'; blob(g, 180, 700, 380, r);
  g.fillStyle = '#9b4bb8'; blob(g, 1350, 260, 330, r);
  g.fillStyle = '#f07ea6'; blob(g, 1250, 780, 240, r);
  g.fillStyle = '#5d2d8c'; blob(g, 300, 150, 200, r);
  // белые волны
  g.strokeStyle = '#fbe9f1'; g.lineWidth = 9; g.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    g.beginPath();
    for (let x = 900; x < W; x += 8) { const y = 90 + k * 34 + Math.sin(x / 40) * 14; x === 900 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.stroke();
  }
  // «глаз»-солнце справа
  g.strokeStyle = '#fbe9f1'; g.lineWidth = 8;
  g.beginPath(); g.arc(1320, 560, 95, 0, 6.283); g.stroke();
  for (let i = 0; i < 14; i++) { const a = i / 14 * 6.283; g.beginPath(); g.moveTo(1320 + Math.cos(a) * 118, 560 + Math.sin(a) * 118); g.lineTo(1320 + Math.cos(a) * 165, 560 + Math.sin(a) * 165); g.stroke(); }
  g.fillStyle = '#3b1f63'; g.beginPath(); g.arc(1320, 560, 40, 0, 6.283); g.fill();
  // синие штрихи
  g.strokeStyle = '#3a6fd8'; g.lineWidth = 14;
  for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(80 + i * 60, 360 + i * 12); g.quadraticCurveTo(160 + i * 60, 300, 220 + i * 60, 380 + i * 8); g.stroke(); }

  // --- голова ---
  const ink = '#1d1230';
  g.lineJoin = 'round'; g.lineCap = 'round';
  // шея и воротник
  g.fillStyle = '#3d78d6';
  g.beginPath(); g.moveTo(560, 960); g.lineTo(610, 760); g.lineTo(930, 740); g.lineTo(1040, 960); g.closePath(); g.fill();
  g.lineWidth = 10; g.strokeStyle = ink; g.stroke();
  // лицо (профиль, смотрит вправо)
  const skin = g.createLinearGradient(600, 200, 1000, 700);
  skin.addColorStop(0, '#f4c27a'); skin.addColorStop(1, '#d9894d');
  g.fillStyle = skin;
  g.beginPath();
  g.moveTo(640, 360);
  g.bezierCurveTo(640, 200, 820, 150, 900, 210);
  g.bezierCurveTo(960, 250, 985, 330, 975, 400); // лоб
  g.lineTo(1010, 470); // нос
  g.bezierCurveTo(1015, 490, 990, 500, 975, 500);
  g.lineTo(980, 540);
  g.bezierCurveTo(960, 640, 860, 720, 760, 720);
  g.bezierCurveTo(660, 700, 620, 560, 640, 360);
  g.closePath(); g.fill(); g.stroke();
  // борода
  g.fillStyle = '#8fa6c9';
  g.beginPath();
  g.moveTo(700, 560);
  g.bezierCurveTo(760, 600, 900, 560, 975, 545);
  g.bezierCurveTo(985, 640, 930, 780, 820, 800);
  g.bezierCurveTo(740, 790, 690, 700, 700, 560);
  g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = '#dfe8f5'; g.lineWidth = 4;
  for (let i = 0; i < 18; i++) { const x = 720 + r() * 230, y = 590 + r() * 170; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 8, y + 16, x - 2, y + 30); g.stroke(); }
  // усы
  g.fillStyle = '#b5c6de'; g.strokeStyle = ink; g.lineWidth = 8;
  g.beginPath(); g.moveTo(900, 530); g.bezierCurveTo(940, 510, 985, 520, 990, 548); g.bezierCurveTo(950, 560, 920, 560, 900, 530); g.fill(); g.stroke();
  // глаз с очками
  g.lineWidth = 9;
  g.fillStyle = '#fff4e2'; g.beginPath(); g.ellipse(915, 385, 30, 18, -0.1, 0, 6.283); g.fill(); g.stroke();
  g.fillStyle = ink; g.beginPath(); g.arc(928, 386, 10, 0, 6.283); g.fill();
  g.beginPath(); g.moveTo(870, 340); g.quadraticCurveTo(920, 318, 960, 345); g.stroke(); // бровь
  // ухо
  g.fillStyle = '#e9a868'; g.beginPath(); g.ellipse(735, 430, 36, 58, 0.1, 0, 6.283); g.fill(); g.stroke();
  // наушники
  g.fillStyle = '#9aa0ab'; g.lineWidth = 11;
  g.beginPath(); g.moveTo(660, 420); g.bezierCurveTo(640, 150, 880, 110, 920, 250); g.lineTo(890, 262); g.bezierCurveTo(850, 160, 690, 190, 700, 415); g.closePath(); g.fill(); g.stroke();
  const cup = g.createLinearGradient(680, 360, 800, 520);
  cup.addColorStop(0, '#c4c9d2'); cup.addColorStop(1, '#6d7380');
  g.fillStyle = cup; g.beginPath(); g.ellipse(735, 440, 70, 92, 0.05, 0, 6.283); g.fill(); g.stroke();
  g.fillStyle = '#4c515c'; g.beginPath(); g.ellipse(735, 440, 42, 60, 0.05, 0, 6.283); g.fill(); g.stroke();
  // блики
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 6;
  g.beginPath(); g.arc(715, 415, 34, 3.6, 4.6); g.stroke();
  g.beginPath(); g.moveTo(760, 250); g.quadraticCurveTo(820, 230, 860, 245); g.stroke();
  // теги
  g.fillStyle = '#fbe9f1'; g.font = 'bold 44px "Rubik Dirt", Impact, sans-serif';
  g.save(); g.translate(120, 120); g.rotate(-0.08); g.fillText('ЖИВИ ГРОМЧЕ', 0, 0); g.restore();
  g.font = '28px "Rubik Dirt", Impact, sans-serif'; g.fillStyle = '#1d1230'; g.fillText('2019', W - 120, H - 30);
  // потёртость
  blotches(g, W, H, '#ffffff', 22, 20, 90, 0.03, 0.09, r);
  grain(g, W, H, 22, 9);
  return c;
}

function blob(g, cx, cy, rad, r) {
  g.beginPath();
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const a = i / n * 6.283, rr = rad * (0.75 + r() * 0.45);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    i === 0 ? g.moveTo(x, y) : g.quadraticCurveTo(cx + Math.cos(a - 0.3) * rr * 1.1, cy + Math.sin(a - 0.3) * rr * 1.1, x, y);
  }
  g.closePath(); g.fill();
}

// ---------- наклейки на столбах ----------
export function stickerPostCanvas(seed = 3) {
  const src = woodCanvas({ w: 256, h: 1024, base: '#3b2616', planks: 1, gaps: false, seed, knots: 0.8 });
  const g = src.getContext('2d');
  const r = rng(seed * 13);
  const cols = ['#f5f5f0', '#1b1b1b', '#e3c14a', '#3f8f5b', '#d9463e', '#4a6cd6', '#f08fb8'];
  for (let i = 0; i < 26; i++) {
    const w = 30 + r() * 60, h = 20 + r() * 50, x = r() * 220, y = 250 + r() * 600;
    g.save(); g.translate(x + w / 2, y + h / 2); g.rotate((r() - 0.5) * 0.6);
    g.fillStyle = cols[Math.floor(r() * cols.length)];
    if (r() < 0.3) { g.beginPath(); g.arc(0, 0, h / 2, 0, 6.283); g.fill(); } else g.fillRect(-w / 2, -h / 2, w, h);
    g.fillStyle = cols[Math.floor(r() * cols.length)];
    g.fillRect(-w / 3, -3, w * 0.66, 6);
    g.restore();
  }
  grain(g, 256, 1024, 10, seed);
  return src;
}

// ---------- карты ----------
export const CARD_W = 280, CARD_H = 400;
const ORN = '#b8913a', INK = '#2a1510', RED = '#8e1c1c';

function cardFrame(g, fill = '#efe3c8') {
  const gr = g.createLinearGradient(0, 0, CARD_W, CARD_H);
  gr.addColorStop(0, shade(fill, 0.05)); gr.addColorStop(1, shade(fill, -0.08));
  g.fillStyle = gr; roundRect(g, 0, 0, CARD_W, CARD_H, 22); g.fill();
  g.strokeStyle = ORN; g.lineWidth = 5; roundRect(g, 14, 14, CARD_W - 28, CARD_H - 28, 14); g.stroke();
  g.strokeStyle = INK; g.lineWidth = 1.5; roundRect(g, 22, 22, CARD_W - 44, CARD_H - 44, 10); g.stroke();
  // уголки-завитки
  g.strokeStyle = ORN; g.lineWidth = 2.5;
  for (const [x, y, sx, sy] of [[22, 22, 1, 1], [CARD_W - 22, 22, -1, 1], [22, CARD_H - 22, 1, -1], [CARD_W - 22, CARD_H - 22, -1, -1]]) {
    g.beginPath(); g.moveTo(x + sx * 4, y + sy * 44); g.quadraticCurveTo(x + sx * 4, y + sy * 4, x + sx * 44, y + sy * 4); g.stroke();
    g.beginPath(); g.arc(x + sx * 16, y + sy * 16, 5, 0, 6.283); g.stroke();
  }
}

function crown(g, cx, cy, s, col) {
  g.fillStyle = col; g.strokeStyle = INK; g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cx - 60 * s, cy + 30 * s); g.lineTo(cx - 70 * s, cy - 30 * s); g.lineTo(cx - 35 * s, cy);
  g.lineTo(cx, cy - 50 * s); g.lineTo(cx + 35 * s, cy); g.lineTo(cx + 70 * s, cy - 30 * s); g.lineTo(cx + 60 * s, cy + 30 * s);
  g.closePath(); g.fill(); g.stroke();
  g.fillRect(cx - 60 * s, cy + 34 * s, 120 * s, 14 * s); g.strokeRect(cx - 60 * s, cy + 34 * s, 120 * s, 14 * s);
  g.fillStyle = RED;
  for (const [x, y] of [[-70, -30], [0, -50], [70, -30]]) { g.beginPath(); g.arc(cx + x * s, cy + y * s - 6 * s, 8 * s, 0, 6.283); g.fill(); g.stroke(); }
}

export function cardFaceCanvas(rank) {
  const [c, g] = canvas(CARD_W, CARD_H);
  const jok = rank === 'J';
  cardFrame(g, jok ? '#e9dcc0' : '#efe3c8');
  const letter = { K: 'K', Q: 'Q', A: 'A', J: '★' }[rank];
  const col = rank === 'Q' || jok ? RED : INK;
  g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 46px "Yeseva One", Georgia, serif';
  g.fillText(letter, 48, 58);
  g.save(); g.translate(CARD_W - 48, CARD_H - 58); g.rotate(Math.PI); g.fillText(letter, 0, 0); g.restore();
  const cx = CARD_W / 2, cy = CARD_H / 2;
  // медальон
  const md = g.createRadialGradient(cx, cy - 10, 10, cx, cy, 110);
  md.addColorStop(0, 'rgba(184,145,58,0.25)'); md.addColorStop(1, 'rgba(184,145,58,0)');
  g.fillStyle = md; g.beginPath(); g.arc(cx, cy, 110, 0, 6.283); g.fill();
  g.strokeStyle = ORN; g.lineWidth = 3; g.beginPath(); g.ellipse(cx, cy, 92, 120, 0, 0, 6.283); g.stroke();
  if (rank === 'K') {
    crown(g, cx, cy - 20, 1.05, '#d8ae4a');
    g.font = 'bold 64px "Yeseva One", Georgia, serif'; g.fillStyle = INK; g.fillText('K', cx, cy + 70);
  } else if (rank === 'Q') {
    // роза
    g.fillStyle = RED; g.strokeStyle = INK; g.lineWidth = 3;
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283; g.beginPath(); g.ellipse(cx + Math.cos(a) * 26, cy - 30 + Math.sin(a) * 26, 30, 22, a, 0, 6.283); g.fill(); g.stroke(); }
    g.fillStyle = '#b8323a'; g.beginPath(); g.arc(cx, cy - 30, 24, 0, 6.283); g.fill(); g.stroke();
    g.strokeStyle = '#5a1015'; g.beginPath(); g.arc(cx, cy - 30, 12, 0.5, 5.5); g.stroke();
    g.strokeStyle = '#3c6b3a'; g.lineWidth = 6; g.beginPath(); g.moveTo(cx, cy + 2); g.quadraticCurveTo(cx - 10, cy + 40, cx, cy + 50); g.stroke();
    g.font = 'bold 64px "Yeseva One", Georgia, serif'; g.fillStyle = RED; g.fillText('Q', cx, cy + 80);
  } else if (rank === 'A') {
    g.fillStyle = INK; g.strokeStyle = ORN; g.lineWidth = 4;
    g.beginPath(); g.moveTo(cx, cy - 95); g.bezierCurveTo(cx + 80, cy - 20, cx + 60, cy + 40, cx + 10, cy + 20);
    g.lineTo(cx + 26, cy + 70); g.lineTo(cx - 26, cy + 70); g.lineTo(cx - 10, cy + 20);
    g.bezierCurveTo(cx - 60, cy + 40, cx - 80, cy - 20, cx, cy - 95); g.fill(); g.stroke();
    g.fillStyle = '#d8ae4a'; g.font = 'bold 44px "Yeseva One", Georgia, serif'; g.fillText('A', cx, cy - 10);
  } else {
    // джокер: колпак с бубенцами
    g.strokeStyle = INK; g.lineWidth = 3;
    const parts = [['#7a1d8e', -1], ['#1f6b4a', 0], ['#b8323a', 1]];
    for (const [col2, k] of parts) {
      g.fillStyle = col2; g.beginPath(); g.moveTo(cx - 55 + (k + 1) * 36, cy + 10);
      g.quadraticCurveTo(cx + k * 70, cy - 60, cx + k * 90, cy - 70 + Math.abs(k) * 40);
      g.lineTo(cx - 20 + (k + 1) * 36, cy + 10); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#d8ae4a'; g.beginPath(); g.arc(cx + k * 90, cy - 70 + Math.abs(k) * 40, 11, 0, 6.283); g.fill(); g.stroke();
    }
    g.fillStyle = '#f3e7cf'; g.beginPath(); g.arc(cx, cy + 40, 36, 0, 6.283); g.fill(); g.stroke();
    g.fillStyle = INK; g.beginPath(); g.arc(cx - 12, cy + 34, 4, 0, 6.283); g.arc(cx + 12, cy + 34, 4, 0, 6.283); g.fill();
    g.strokeStyle = RED; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy + 44, 16, 0.3, 2.84); g.stroke();
    g.fillStyle = RED; g.font = 'bold 34px "Rubik Dirt", Impact, sans-serif'; g.fillText('JOKER', cx, cy + 118);
  }
  grain(g, CARD_W, CARD_H, 10, rank.charCodeAt(0));
  return c;
}

export function cardBackCanvas() {
  const [c, g] = canvas(CARD_W, CARD_H);
  const gr = g.createLinearGradient(0, 0, CARD_W, CARD_H);
  gr.addColorStop(0, '#5c1419'); gr.addColorStop(1, '#2c080b');
  g.fillStyle = gr; roundRect(g, 0, 0, CARD_W, CARD_H, 22); g.fill();
  g.save(); roundRect(g, 18, 18, CARD_W - 36, CARD_H - 36, 12); g.clip();
  g.strokeStyle = 'rgba(216,174,74,0.35)'; g.lineWidth = 1.5;
  for (let i = -CARD_H; i < CARD_W + CARD_H; i += 22) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + CARD_H, CARD_H); g.stroke();
    g.beginPath(); g.moveTo(i, CARD_H); g.lineTo(i + CARD_H, 0); g.stroke();
  }
  g.restore();
  g.strokeStyle = '#d8ae4a'; g.lineWidth = 4; roundRect(g, 14, 14, CARD_W - 28, CARD_H - 28, 14); g.stroke();
  const cx = CARD_W / 2, cy = CARD_H / 2;
  g.fillStyle = '#2c080b'; g.beginPath(); g.ellipse(cx, cy, 78, 104, 0, 0, 6.283); g.fill();
  g.strokeStyle = '#d8ae4a'; g.lineWidth = 3; g.stroke();
  g.beginPath(); g.ellipse(cx, cy, 66, 92, 0, 0, 6.283); g.stroke();
  // бутылка-силуэт
  g.fillStyle = '#d8ae4a';
  g.fillRect(cx - 9, cy - 70, 18, 26);
  g.beginPath(); g.moveTo(cx - 12, cy - 44); g.lineTo(cx + 12, cy - 44); g.quadraticCurveTo(cx + 36, cy - 30, cx + 36, cy); g.lineTo(cx + 36, cy + 56);
  g.quadraticCurveTo(cx + 36, cy + 66, cx + 26, cy + 66); g.lineTo(cx - 26, cy + 66); g.quadraticCurveTo(cx - 36, cy + 66, cx - 36, cy + 56); g.lineTo(cx - 36, cy);
  g.quadraticCurveTo(cx - 36, cy - 30, cx - 12, cy - 44); g.fill();
  g.fillStyle = '#2c080b'; g.font = 'bold 30px "Yeseva One", Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('☠', cx, cy + 18);
  grain(g, CARD_W, CARD_H, 10, 99);
  return c;
}

// ---------- этикетка «Чеколейтор» ----------
export function labelCanvas() {
  const [c, g] = canvas(512, 640);
  const gr = g.createLinearGradient(0, 0, 0, 640);
  gr.addColorStop(0, '#4a2413'); gr.addColorStop(1, '#2e140a');
  g.fillStyle = gr; roundRect(g, 0, 0, 512, 640, 36); g.fill();
  const gold = g.createLinearGradient(0, 0, 512, 0);
  gold.addColorStop(0, '#8a6424'); gold.addColorStop(0.5, '#f1d48a'); gold.addColorStop(1, '#8a6424');
  g.strokeStyle = gold; g.lineWidth = 6; roundRect(g, 16, 16, 480, 608, 26); g.stroke();
  g.lineWidth = 2; roundRect(g, 28, 28, 456, 584, 20); g.stroke();
  // корона
  g.save(); g.translate(256, 104); g.scale(0.55, 0.55); crownGold(g, gold); g.restore();
  // лилии-завитки
  g.strokeStyle = gold; g.lineWidth = 3;
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      g.beginPath(); g.moveTo(256 + s * 30, 250 - i * 8);
      g.bezierCurveTo(256 + s * (90 + i * 20), 170 - i * 20, 256 + s * (170 + i * 10), 220, 256 + s * (200 - i * 30), 290 + i * 10); g.stroke();
    }
    g.beginPath(); g.moveTo(256 + s * 40, 420); g.bezierCurveTo(256 + s * 120, 470, 256 + s * 180, 400, 256 + s * 210, 450); g.stroke();
  }
  g.fillStyle = '#f6ead0'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 8; g.shadowOffsetY = 3;
  g.font = '64px "Yeseva One", Georgia, serif'; fitText(g, 'ЧЕКОЛЕЙТОР', 256, 348, 440);
  g.shadowBlur = 0; g.shadowOffsetY = 0;
  g.fillStyle = gold; g.fillRect(96, 392, 320, 3);
  g.font = '600 22px "Onest", Arial, sans-serif'; g.fillStyle = '#e9c979';
  g.fillText('ДИЖЕСТИВ С АРОМАТОМ', 256, 432);
  g.fillText('ШОКОЛАДА И КОФЕ', 256, 460);
  g.font = '500 18px "Onest", Arial, sans-serif'; g.fillStyle = '#c9a766';
  g.fillText('ОДИН ГЛОТОК ИЗ ШЕСТИ — ПОСЛЕДНИЙ', 256, 500);
  // нижняя плашка
  g.fillStyle = '#23100a'; roundRect(g, 60, 530, 392, 64, 12); g.fill();
  g.strokeStyle = gold; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#e9c979'; g.font = '700 22px "Onest", Arial, sans-serif';
  g.fillText('0,5 Л   ·   30% ОБ.   ·   1863', 256, 563);
  grain(g, 512, 640, 10, 42);
  return c;
}

function crownGold(g, gold) {
  g.fillStyle = gold; g.strokeStyle = '#3a1a0a'; g.lineWidth = 4;
  g.beginPath();
  g.moveTo(-80, 40); g.lineTo(-95, -40); g.lineTo(-45, 0); g.lineTo(0, -70); g.lineTo(45, 0); g.lineTo(95, -40); g.lineTo(80, 40); g.closePath();
  g.fill(); g.stroke();
  g.fillRect(-82, 46, 164, 18); g.strokeRect(-82, 46, 164, 18);
  g.beginPath(); g.arc(0, -84, 12, 0, 6.283); g.fill(); g.stroke();
}

function fitText(g, text, x, y, maxW) {
  let size = parseInt(g.font.match(/(\d+)px/)[1], 10);
  while (g.measureText(text).width > maxW && size > 10) { size -= 2; g.font = g.font.replace(/\d+px/, size + 'px'); }
  g.fillText(text, x, y);
}

// ---------- пачка Chapman Red ----------
export function packCanvas() {
  const [c, g] = canvas(512, 768);
  const gr = g.createLinearGradient(0, 0, 512, 768);
  gr.addColorStop(0, '#d0202a'); gr.addColorStop(0.55, '#a3121b'); gr.addColorStop(1, '#6e0a10');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 768);
  // крышка
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 176, 512, 4);
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 180, 512, 2);
  const gold = g.createLinearGradient(0, 0, 512, 0);
  gold.addColorStop(0, '#9c7a2e'); gold.addColorStop(0.5, '#f4dc97'); gold.addColorStop(1, '#9c7a2e');
  g.strokeStyle = gold; g.lineWidth = 5; g.strokeRect(30, 220, 452, 500);
  // герб
  g.save(); g.translate(256, 330); g.scale(0.5, 0.5); crownGold(g, gold); g.restore();
  g.fillStyle = '#fff6e6'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '86px "Yeseva One", Georgia, serif'; fitText(g, 'CHAPMAN', 256, 470, 420);
  g.fillStyle = gold; g.fillRect(120, 522, 272, 3);
  g.font = '700 58px "Onest", Arial, sans-serif'; g.fillStyle = '#f4dc97'; g.fillText('RED', 256, 580);
  g.font = '500 20px "Onest", Arial, sans-serif'; g.fillStyle = 'rgba(255,240,220,0.8)';
  g.fillText('SUPERIOR TOBACCO SINCE 1860', 256, 650);
  grain(g, 512, 768, 8, 4);
  return c;
}

// ---------- ткани ----------
export function leatherCanvas(seed = 8, base = '#141112') {
  const [c, g] = canvas(512, 512);
  const r = rng(seed);
  g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  blotches(g, 512, 512, '#3a3432', 40, 20, 90, 0.05, 0.18, r);
  for (let i = 0; i < 260; i++) {
    g.strokeStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + r() * 0.08})`;
    g.lineWidth = 0.5 + r();
    const x = r() * 512, y = r() * 512, l = 5 + r() * 30, a = r() * 6.28;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  grain(g, 512, 512, 20, seed);
  return c;
}

export function floralCanvas() {
  const [c, g] = canvas(512, 512);
  const r = rng(31);
  g.fillStyle = '#f7dcdb'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 44; i++) {
    const x = r() * 512, y = r() * 512, s = 6 + r() * 9;
    for (const [dx, dy] of [[0, 0], [512, 0], [0, 512], [-512, 0], [0, -512]]) {
      const X = x + dx, Y = y + dy;
      g.fillStyle = '#7fa26f';
      g.beginPath(); g.ellipse(X - s, Y + s * 0.6, s * 0.8, s * 0.35, 0.6, 0, 6.283); g.fill();
      g.beginPath(); g.ellipse(X + s, Y + s * 0.7, s * 0.8, s * 0.35, -0.6, 0, 6.283); g.fill();
      for (let k = 0; k < 3; k++) {
        g.fillStyle = k === 0 ? '#e690a8' : k === 1 ? '#d56b89' : '#b94a6c';
        g.beginPath(); g.arc(X + (k - 1) * s * 0.5, Y - k * 1.5, s * (0.9 - k * 0.2), 0, 6.283); g.fill();
      }
    }
  }
  for (let i = 0; i < 400; i++) { g.fillStyle = r() < 0.5 ? '#ffffff' : '#e7a3b6'; g.fillRect(r() * 512, r() * 512, 2, 2); }
  grain(g, 512, 512, 8, 2);
  return c;
}

export function denimCanvas(base = '#b9bcc2', seed = 4) {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let i = -256; i < 512; i += 3) {
    g.strokeStyle = `rgba(${r() < 0.5 ? '255,255,255' : '40,45,55'},${0.06 + r() * 0.1})`;
    g.lineWidth = 1; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 256, 256); g.stroke();
  }
  blotches(g, 256, 256, '#ffffff', 10, 20, 60, 0.04, 0.12, r);
  grain(g, 256, 256, 16, seed);
  return c;
}

export function knitCanvas(base = '#5b5b5d', seed = 6) {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 4) for (let x = 0; x < 256; x += 4) {
    g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.04 + r() * 0.06})`;
    g.fillRect(x, y, 3, 3);
  }
  grain(g, 256, 256, 10, seed);
  return c;
}

export function barkCanvas() {
  const [c, g] = canvas(256, 1024);
  const r = rng(12);
  g.fillStyle = '#4a3a2c'; g.fillRect(0, 0, 256, 1024);
  for (let i = 0; i < 70; i++) {
    const x = r() * 256; g.strokeStyle = `rgba(${r() < 0.5 ? '20,14,10' : '140,120,100'},${0.3 + r() * 0.4})`;
    g.lineWidth = 2 + r() * 8; g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y <= 1024; y += 30) g.lineTo(x + Math.sin(y * 0.01 + i) * 14 + (r() - 0.5) * 8, y);
    g.stroke();
  }
  grain(g, 256, 1024, 24, 12);
  return c;
}

// Небо под время суток: день, вечер (закат), ночь со звёздами
const SKY = {
  day: ['#4f86cc', '#8db8e6', '#d6e4ee', '#e6e8de', '#6c756b', '#34342f'],
  evening: ['#0e1326', '#27305a', '#6a4f79', '#d9855e', '#f0b477', '#2a2019', '#0c0907'],
  night: ['#02040a', '#070b1a', '#111630', '#1b1c30', '#0b0a0c', '#050404'],
  // пасмурное небо в дождь
  'day-rain': ['#59616a', '#6e757d', '#878d93', '#8b9092', '#4c5250', '#2b2d2b'],
  'evening-rain': ['#111319', '#20232c', '#363641', '#544848', '#62524c', '#211b17', '#0c0907'],
  'night-rain': ['#030407', '#080a10', '#0f1118', '#13141a', '#0a0a0b', '#050404'],
};
export function skyCanvas(tod = 'evening') {
  const [c, g] = canvas(tod === 'night' ? 1024 : 64, 1024);
  const W = c.width;
  const cols = SKY[tod] || SKY.evening;
  const stops = cols.length === 7 ? [0, 0.3, 0.44, 0.5, 0.53, 0.6, 1] : [0, 0.32, 0.47, 0.51, 0.58, 1];
  const gr = g.createLinearGradient(0, 0, 0, 1024);
  cols.forEach((col, i) => gr.addColorStop(stops[i], col));
  g.fillStyle = gr; g.fillRect(0, 0, W, 1024);
  if (tod === 'night') {
    const r = rng(17);
    for (let i = 0; i < 900; i++) {
      const y = Math.pow(r(), 1.6) * 470, a = 0.25 + r() * 0.75;
      g.fillStyle = `rgba(235,238,255,${a * (1 - y / 520)})`;
      g.fillRect(r() * W, y, r() < 0.08 ? 2 : 1, r() < 0.08 ? 2 : 1);
    }
    // луна
    const mg = g.createRadialGradient(700, 250, 2, 700, 250, 40);
    mg.addColorStop(0, 'rgba(250,248,235,1)'); mg.addColorStop(0.35, 'rgba(240,238,225,0.95)'); mg.addColorStop(0.45, 'rgba(200,210,255,0.25)'); mg.addColorStop(1, 'rgba(160,180,255,0)');
    g.fillStyle = mg; g.fillRect(640, 190, 120, 120);
  }
  return c;
}

export function smokeCanvas() {
  const [c, g] = canvas(128, 128);
  const r = rng(5);
  for (let i = 0; i < 26; i++) {
    const x = 64 + (r() - 0.5) * 50, y = 64 + (r() - 0.5) * 50, rad = 16 + r() * 34;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  return c;
}

export function glowCanvas() {
  const [c, g] = canvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,220,160,0.6)'); gr.addColorStop(1, 'rgba(255,180,100,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return c;
}
