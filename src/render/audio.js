// =====================================================================
// Audio — WebAudio による合成 SE / BGM（外部アセット不要・完全オフライン）。
// ブラウザのオートプレイ制限のため、最初のユーザ操作で resume() する。
// =====================================================================

export class AudioKit {
  constructor() {
    this.ctx = null; this.master = null; this.musicGain = null; this.sfxGain = null;
    this.muted = false; this._musicTimer = null; this._step = 0;
  }

  _ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.9; this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.22; this.musicGain.connect(this.master);
  }

  resume() { this._ensure(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.7; }

  _tone(freq, dur, type = 'sine', gain = 0.3, slideTo = null, dest = null) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(dest || this.sfxGain); o.start(t); o.stop(t + dur + 0.02);
  }

  // 指定時刻に鳴らす（メロディのスケジュール用）
  _toneAt(freq, when, dur, type = 'square', gain = 0.2) {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    o.connect(g); g.connect(this.sfxGain); o.start(when); o.stop(when + dur + 0.02);
  }

  _noise(dur, gain = 0.3, hp = 800) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime; const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.sfxGain); src.start(t);
  }

  // ---- SE ----
  hit(level = 'mid', big = false) { this._ensure(); this._tone(big ? 150 : 220, big ? 0.18 : 0.1, 'square', 0.3, big ? 60 : 110); this._noise(big ? 0.12 : 0.07, big ? 0.35 : 0.22, 900); }
  block() { this._ensure(); this._tone(900, 0.07, 'square', 0.18, 1400); this._noise(0.05, 0.12, 2000); }
  throwSfx() { this._ensure(); this._tone(180, 0.22, 'sawtooth', 0.28, 70); this._noise(0.1, 0.25, 600); }
  fire(kind = 'fireball') { this._ensure(); const f = kind === 'beam' ? 700 : kind === 'knife' ? 1200 : 320; this._tone(f, 0.22, 'sawtooth', 0.22, f * 0.4); }
  clash() { this._ensure(); this._tone(1200, 0.16, 'square', 0.3, 300); this._noise(0.1, 0.3, 1500); }
  jump() { this._ensure(); this._tone(300, 0.16, 'sine', 0.2, 700); }
  superSfx() { this._ensure(); this._tone(200, 0.5, 'sawtooth', 0.32, 900); this._noise(0.4, 0.2, 500); }
  ko() { this._ensure(); this._tone(160, 0.7, 'sawtooth', 0.4, 40); this._noise(0.5, 0.3, 300); }
  menuMove() { this._ensure(); this._tone(520, 0.05, 'square', 0.12); }
  menuSelect() { this._ensure(); this._tone(680, 0.08, 'square', 0.16, 980); }
  // 勝利の軽快なジングル（KO/決着時。勝者のダンスに合わせて鳴る）
  victory() {
    this._ensure(); if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const lead = [523, 659, 784, 1047, 988, 1047, 1319]; // C5 E5 G5 C6 … 明るい上昇
    lead.forEach((f, i) => this._toneAt(f, t + 0.12 + i * 0.14, 0.16, 'square', 0.16));
    const bass = [262, 330, 392, 523];                   // C E G C
    bass.forEach((f, i) => this._toneAt(f, t + 0.12 + i * 0.245, 0.26, 'triangle', 0.2));
    this._toneAt(1568, t + 0.12 + 7 * 0.14, 0.5, 'square', 0.14); // 締めの高音
  }

  // ---- BGM（簡易シーケンス）----
  startMusic(tempo = 132) {
    this._ensure(); if (!this.ctx || this._musicTimer) return;
    const beat = 60 / tempo;
    const bass = [55, 55, 73.4, 65.4]; // A1 A1 D2 C2
    const lead = [220, 0, 330, 294, 261, 0, 220, 196];
    const tick = () => {
      if (this.muted) { this._step++; return; }
      const s = this._step;
      if (s % 2 === 0) this._tone(bass[(s / 2) % bass.length], beat * 0.9, 'triangle', 0.18, null, this.musicGain);
      const l = lead[s % lead.length]; if (l) this._tone(l, beat * 0.5, 'square', 0.06, null, this.musicGain);
      if (s % 4 === 2) this._noise(0.04, 0.06, 4000); // hat
      this._step++;
    };
    this._musicTimer = setInterval(tick, beat * 500); // 8分音符
  }
  stopMusic() { if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; } }
}
