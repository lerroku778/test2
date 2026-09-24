// Весь звук синтезируется: без файлов.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.music = true;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0.8;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.amb = c.createGain(); this.amb.gain.value = 0.5; this.amb.connect(this.master);
    this.mus = c.createGain(); this.mus.gain.value = 0.22; this.mus.connect(this.master);
    // реверб
    this.verb = c.createConvolver();
    const len = c.sampleRate * 1.8, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    this.verb.buffer = ir;
    const vg = c.createGain(); vg.gain.value = 0.25;
    this.verb.connect(vg); vg.connect(this.master);
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < nd.length; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; nd[i] = w; }
    this.brownBuf = c.createBuffer(1, c.sampleRate * 4, c.sampleRate);
    const bd = this.brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
    this.startAmbience();
    this.startMusic();
    this.loadTrack('assets/bar-track.mp3');
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.8; }
  setMusic(on) { this.music = on; this.applyMusic(); }

  // ---------- трек из колонки в баре ----------
  async loadTrack(url) {
    if (this.trackLoading) return;
    this.trackLoading = true;
    try {
      const r = await fetch(url);
      this.trackBuf = await this.ctx.decodeAudioData(await r.arrayBuffer());
      this.applyMusic();
    } catch (e) { console.warn('Музыка бара не загрузилась', e); }
  }

  // В игре — колонка, в меню — тихая гитара.
  setInGame(v) { if (this.inGame !== v) { this.inGame = v; this.applyMusic(); } }

  applyMusic() {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime;
    this.mus.gain.cancelScheduledValues(t);
    this.mus.gain.setTargetAtTime(this.music && !this.inGame ? 0.22 : 0, t, 0.6);
    if (this.inGame && this.music && this.trackBuf) this.speakerOn();
    else this.speakerOff();
  }

  speakerOn() {
    const c = this.ctx;
    if (this.spk) return;
    if (!this.spkChain) {
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000;
      const mid = c.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1700; mid.gain.value = 4; mid.Q.value = 0.8;
      const sh = c.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6); }
      sh.curve = curve;
      const panner = c.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1.3;
      panner.rolloffFactor = 1.2;
      panner.maxDistance = 40;
      panner.coneInnerAngle = 140; panner.coneOuterAngle = 280; panner.coneOuterGain = 0.5;
      const out = c.createGain(); out.gain.value = 0;
      const send = c.createGain(); send.gain.value = 0.35;
      const an = c.createAnalyser(); an.fftSize = 256;
      hp.connect(mid); mid.connect(sh); sh.connect(lp); lp.connect(an); lp.connect(panner); panner.connect(out); out.connect(this.master);
      lp.connect(send); send.connect(this.verb);
      this.spkChain = { input: hp, panner, out, an, data: new Uint8Array(an.frequencyBinCount) };
      if (this.spkPos) this.setSpeaker(this.spkPos.p, this.spkPos.d);
    }
    const src = c.createBufferSource();
    src.buffer = this.trackBuf; src.loop = true;
    src.connect(this.spkChain.input);
    const off = (this.spkOffset || 0) % this.trackBuf.duration;
    src.start(0, off);
    this.spk = { src, startedAt: c.currentTime - off };
    this.spkChain.out.gain.setTargetAtTime(0.9, c.currentTime, 0.8);
  }

  speakerOff() {
    if (!this.spk) return;
    const c = this.ctx, s = this.spk;
    this.spkOffset = c.currentTime - s.startedAt;
    this.spkChain.out.gain.setTargetAtTime(0, c.currentTime, 0.3);
    try { s.src.stop(c.currentTime + 1.2); } catch { /* уже остановлен */ }
    this.spk = null;
  }

  setSpeaker(p, d) {
    this.spkPos = { p, d };
    if (!this.spkChain) return;
    const pn = this.spkChain.panner;
    if (pn.positionX) { pn.positionX.value = p.x; pn.positionY.value = p.y; pn.positionZ.value = p.z; pn.orientationX.value = d.x; pn.orientationY.value = d.y; pn.orientationZ.value = d.z; }
    else { pn.setPosition(p.x, p.y, p.z); pn.setOrientation(d.x, d.y, d.z); }
  }

  setListener(p, f, u) {
    const l = this.ctx && this.ctx.listener; if (!l) return;
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z;
      l.upX.value = u.x; l.upY.value = u.y; l.upZ.value = u.z;
    } else { l.setPosition(p.x, p.y, p.z); l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  }

  // громкость низов для качания динамика
  speakerLevel() {
    if (!this.spk || !this.spkChain) return 0;
    const { an, data } = this.spkChain;
    an.getByteFrequencyData(data);
    let s = 0; for (let i = 1; i < 8; i++) s += data[i];
    return s / (7 * 255);
  }

  noise(dur, { type = 'bandpass', f = 1000, q = 1, f2, gain = 0.5, attack = 0.005, dest, brown = false, when = 0 } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when;
    const src = c.createBufferSource(); src.buffer = brown ? this.brownBuf : this.noiseBuf;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl); fl.connect(g); g.connect(dest || this.sfx);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
    return g;
  }

  tone(freq, dur, { type = 'sine', gain = 0.3, f2, attack = 0.005, when = 0, dest, verb = false } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfx);
    if (verb) g.connect(this.verb);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------- эффекты ----------
  card() { this.noise(0.12, { f: 3200, f2: 1400, q: 0.8, gain: 0.25 }); this.noise(0.05, { type: 'highpass', f: 5000, gain: 0.12, when: 0.02 }); }
  cardSlap() { this.noise(0.09, { f: 900, q: 1.2, gain: 0.5 }); this.tone(140, 0.08, { gain: 0.25, f2: 70 }); }
  flip() { this.noise(0.08, { f: 2600, q: 2, gain: 0.3 }); }
  click() { this.tone(1800, 0.03, { type: 'triangle', gain: 0.06 }); }
  select() { this.tone(900, 0.05, { type: 'triangle', gain: 0.08, f2: 1300 }); }
  liar() {
    this.tone(55, 1.2, { type: 'sawtooth', gain: 0.35, f2: 38, verb: true });
    this.noise(1.4, { type: 'highpass', f: 3000, gain: 0.25, attack: 0.002, dest: this.verb });
    this.noise(0.3, { type: 'lowpass', f: 300, gain: 0.8, brown: true });
    [220, 261, 311].forEach((f, i) => this.tone(f, 0.9, { type: 'square', gain: 0.05, when: 0.02 * i, verb: true }));
  }
  truth() { [392, 494, 587].forEach((f, i) => this.tone(f, 0.6, { type: 'triangle', gain: 0.12, when: i * 0.07, verb: true })); }
  lie() { [311, 294, 233].forEach((f, i) => this.tone(f, 0.7, { type: 'sawtooth', gain: 0.06, when: i * 0.12, verb: true })); }
  pour() { for (let i = 0; i < 10; i++) this.noise(0.12, { f: 600 + Math.random() * 900, q: 8, gain: 0.18, when: i * 0.07 }); }
  gulp() { this.tone(180 + Math.random() * 60, 0.12, { gain: 0.35, f2: 90 }); this.noise(0.08, { type: 'lowpass', f: 500, gain: 0.2 }); }
  glass() { this.tone(2600, 0.5, { gain: 0.08, verb: true }); this.tone(3900, 0.35, { gain: 0.05 }); this.noise(0.03, { type: 'highpass', f: 6000, gain: 0.2 }); }
  heartbeat(n = 4, gap = 0.75) { for (let i = 0; i < n; i++) { this.tone(60, 0.18, { gain: 0.6, when: i * gap, f2: 40 }); this.tone(55, 0.15, { gain: 0.4, when: i * gap + 0.22, f2: 38 }); } }
  exhale() { this.noise(0.9, { type: 'bandpass', f: 900, q: 0.6, gain: 0.12, attack: 0.15 }); }
  relief() { [262, 330, 392, 523].forEach((f, i) => this.tone(f, 1.2, { type: 'triangle', gain: 0.07, when: i * 0.06, verb: true })); }
  retch() {
    const c = this.ctx; if (!c) return;
    for (let k = 0; k < 3; k++) {
      const w = 0.2 + k * 0.8;
      const g = this.noise(0.55, { type: 'bandpass', f: 400, f2: 180, q: 3, gain: 0.55, attack: 0.08, when: w, brown: true });
      this.tone(110 - k * 10, 0.5, { type: 'sawtooth', gain: 0.12, f2: 70, when: w });
      this.noise(0.4, { type: 'lowpass', f: 700, gain: 0.35, when: w + 0.35 });
    }
  }
  splat() { this.noise(0.1, { type: 'lowpass', f: 500 + Math.random() * 400, gain: 0.25 }); }
  death() { this.tone(98, 2.5, { type: 'sawtooth', gain: 0.18, f2: 49, verb: true }); this.tone(147, 2.5, { type: 'sine', gain: 0.12, f2: 73, verb: true }); }
  lighter() { this.noise(0.03, { type: 'highpass', f: 4000, gain: 0.5 }); this.noise(0.4, { f: 1200, q: 0.8, gain: 0.1, when: 0.06, attack: 0.05 }); }
  inhale() { this.noise(1.1, { f: 1600, q: 0.6, gain: 0.05, attack: 0.4 }); this.noise(1.0, { type: 'highpass', f: 5000, gain: 0.02, attack: 0.3 }); }
  win() { [262, 330, 392, 523, 659].forEach((f, i) => this.tone(f, 1.6, { type: 'triangle', gain: 0.1, when: i * 0.12, verb: true })); }
  tick() { this.tone(2400, 0.02, { type: 'square', gain: 0.03 }); }

  startAmbience() {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.brownBuf; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = c.createGain(); g.gain.value = 0.18;
    src.connect(lp); lp.connect(g); g.connect(this.amb); src.start();
    // сверчки
    const chirp = () => {
      if (!this.ctx) return;
      const t = c.currentTime;
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const o = c.createOscillator(); o.frequency.value = 4300 + Math.random() * 300;
        const gg = c.createGain(); gg.gain.setValueAtTime(0.0001, t + i * 0.09); gg.gain.exponentialRampToValueAtTime(0.012, t + i * 0.09 + 0.01); gg.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.05);
        const pan = c.createStereoPanner ? c.createStereoPanner() : null;
        if (pan) { pan.pan.value = Math.random() * 2 - 1; o.connect(gg); gg.connect(pan); pan.connect(this.amb); } else { o.connect(gg); gg.connect(this.amb); }
        o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.06);
      }
      setTimeout(chirp, 700 + Math.random() * 2600);
    };
    chirp();
  }

  // гитара Карплус—Стронг, медленный минорный перебор
  pluckBuf(freq) {
    const c = this.ctx;
    this.pbuf = this.pbuf || {};
    if (this.pbuf[freq]) return this.pbuf[freq];
    const sr = c.sampleRate, len = Math.floor(sr * 2.6);
    const b = c.createBuffer(1, len, sr), d = b.getChannelData(0);
    const P = Math.round(sr / freq);
    const ring = new Float32Array(P);
    for (let i = 0; i < P; i++) ring[i] = Math.random() * 2 - 1;
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const nx = (idx + 1) % P;
      const v = ring[idx];
      ring[idx] = 0.4985 * (v + ring[nx]);
      d[i] = v * (i < 40 ? i / 40 : 1);
      idx = nx;
    }
    return (this.pbuf[freq] = b);
  }

  startMusic() {
    const c = this.ctx;
    const N = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const prog = [
      [45, 52, 57, 60, 64, 60, 57, 52], // Am
      [41, 48, 53, 57, 60, 57, 53, 48], // F
      [43, 50, 55, 59, 62, 59, 55, 50], // G
      [40, 47, 52, 56, 59, 56, 52, 47], // E
    ];
    let bar = 0, step = 0;
    const beat = 0.34;
    let next = c.currentTime + 0.5;
    const sched = () => {
      if (!this.ctx) return;
      while (next < c.currentTime + 0.6) {
        const notes = prog[bar % prog.length];
        const m = notes[step];
        const src = c.createBufferSource(); src.buffer = this.pluckBuf(N(m));
        const g = c.createGain(); g.gain.value = step === 0 ? 0.5 : 0.28 + Math.random() * 0.08;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
        src.connect(lp); lp.connect(g); g.connect(this.mus); g.connect(this.verb);
        src.start(next + (Math.random() - 0.5) * 0.015);
        next += beat * (step % 2 ? 0.95 : 1.05);
        step++;
        if (step >= notes.length) { step = 0; bar++; }
      }
      setTimeout(sched, 200);
    };
    sched();
  }
}
