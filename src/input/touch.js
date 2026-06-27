// =====================================================================
// タッチ操作（モバイル既定）。左=仮想スティック（移動）、右=P/K/S/G＋投げ＋必殺＋ジャンプ。
// SPEC §2.8 / §8.1。大きく半透明・間隔広め・マルチタッチ・誤タップ抑止。
// Controller に書き込む（キーボードと同じ経路で sim intent に合流）。
// =====================================================================

const CSS = `
#tc { position: fixed; inset: 0; z-index: 40; pointer-events: none; -webkit-user-select:none; user-select:none; touch-action:none; }
#tc .stickbase { position:absolute; left:24px; bottom:30px; width:160px; height:160px; border-radius:50%;
  background: radial-gradient(circle, rgba(120,150,200,.10), rgba(120,150,200,.16));
  border:2px solid rgba(170,200,255,.35); pointer-events:auto; touch-action:none; }
#tc .stickknob { position:absolute; left:50%; top:50%; width:70px; height:70px; margin:-35px 0 0 -35px; border-radius:50%;
  background: rgba(130,180,255,.45); border:2px solid rgba(200,225,255,.6); transition: transform .03s; }
#tc .btn { position:absolute; pointer-events:auto; touch-action:none; display:flex; align-items:center; justify-content:center;
  color:#eaf2ff; font-weight:800; font-family:-apple-system,sans-serif; border-radius:50%;
  background: rgba(120,150,200,.18); border:2px solid rgba(170,200,255,.45); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
  transition: background .05s, transform .05s; }
#tc .btn.active { background: rgba(120,180,255,.6); transform: scale(.92); }
#tc .btn.dim { opacity: .3; filter: grayscale(.5); }                 /* 使えない攻撃ボタンは暗く */
#tc .btn.rdy2 { box-shadow: 0 0 10px rgba(150,210,255,.6); border-color: rgba(170,220,255,.8); } /* 使えると点灯 */
#tc .act { position:absolute; right:12px; bottom:16px; width:230px; height:270px; }
#tc .act .btn { position:absolute; }
/* 攻撃ボタンは「大きな字=種類(P/K)＋小さな字=段(上/中/下)」を縦に重ねて表示 */
#tc .btn.atk { flex-direction:column; }
#tc .btn .big { font-size:20px; line-height:1; font-weight:900; }
#tc .btn .lvl { font-size:11px; line-height:1.1; margin-top:1px; opacity:.92; }
#tc .btn.kick { border-color: rgba(255,170,120,.5); }                /* キック列=暖色で区別 */
#tc .btn.kick .big, #tc .btn.kick .lvl { color:#ffd9bf; }
/* 3列: キック列(右端) / パンチ列(中) / ユーティリティ列(左)。位置=上が上段・下が下段。 */
#tc .b-kh { width:64px; height:64px; right:8px;   bottom:148px; }
#tc .b-km { width:64px; height:64px; right:8px;   bottom:78px; }
#tc .b-kl { width:64px; height:64px; right:8px;   bottom:8px; }
#tc .b-ph { width:64px; height:64px; right:82px;  bottom:148px; }
#tc .b-pm { width:64px; height:64px; right:82px;  bottom:78px; }
#tc .b-pl { width:64px; height:64px; right:82px;  bottom:8px; }
#tc .b-su { width:56px; height:56px; right:156px; bottom:202px; font-size:13px; color:#888; border-color:rgba(150,150,150,.4); opacity:.5; }
#tc .b-s  { width:56px; height:56px; right:156px; bottom:138px; font-size:17px; color:#ffe27a; border-color: rgba(255,210,90,.6); }
#tc .b-g  { width:56px; height:56px; right:156px; bottom:74px;  font-size:18px; }
#tc .b-j  { width:56px; height:56px; right:156px; bottom:10px;  font-size:11px; }
#tc .b-su.ready { color:#ff6; border-color:rgba(255,255,120,.9); opacity:1; box-shadow:0 0 16px rgba(255,235,90,.7); animation: supup .8s infinite alternate; }
@keyframes supup { to { box-shadow:0 0 26px rgba(255,235,90,1); } }
@media (max-width:520px){ #tc .stickbase{ width:130px;height:130px } #tc .stickknob{ width:58px;height:58px;margin:-29px 0 0 -29px } #tc .act{ transform: scale(.9); transform-origin: bottom right } }
`;

export class TouchControls {
  constructor(controller) {
    this.c = controller;
    this.root = null; this.knob = null; this.stickId = null; this.origin = { x: 0, y: 0 };
    this._pHeld = 0; this._kHeld = 0; // パンチ列/キック列の押下数（両方>0で投げ）
    this._build();
  }

  _build() {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style); this.style = style;
    const root = document.createElement('div'); root.id = 'tc'; this.root = root;

    // 左: 仮想スティック
    const base = document.createElement('div'); base.className = 'stickbase';
    const knob = document.createElement('div'); knob.className = 'stickknob'; base.appendChild(knob); this.knob = knob;
    const rad = 60;
    const setStick = (cx, cy) => {
      let dx = cx - this.origin.x, dy = cy - this.origin.y;
      const len = Math.hypot(dx, dy) || 1; const cl = Math.min(len, rad);
      dx = dx / len * cl; dy = dy / len * cl;
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      // スクリーン絶対: x=左右(接近/後退) / y=奥行き。ジャイロON時は接近/後退(x)を傾けが供給し、
      // スティックは奥行き(y)のみ担当（xはジャイロ値を保持）。
      if (this.c.gyroEnabled) this.c.setMove(this.c.move.x, -dy / rad);
      else this.c.setMove(dx / rad, -dy / rad);
    };
    base.addEventListener('pointerdown', (e) => { e.preventDefault(); this.stickId = e.pointerId; const r = base.getBoundingClientRect(); this.origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; base.setPointerCapture(e.pointerId); setStick(e.clientX, e.clientY); });
    base.addEventListener('pointermove', (e) => { if (e.pointerId !== this.stickId) return; e.preventDefault(); setStick(e.clientX, e.clientY); });
    const rel = (e) => { if (e.pointerId !== this.stickId) return; this.stickId = null; knob.style.transform = 'translate(0,0)'; this.c.setMove(this.c.gyroEnabled ? this.c.move.x : 0, 0); };
    base.addEventListener('pointerup', rel); base.addEventListener('pointercancel', rel);

    root.appendChild(base);

    // 右: 3列レイアウト。パンチ列(上中下)・キック列(上中下)・ユーティリティ列(SP/S/G/JUMP)。
    // 各攻撃ボタンは押した段を直接発火（pressAttack）。投げ＝パンチ列とキック列を同時押し。
    const act = document.createElement('div'); act.className = 'act';
    this.btns = {};
    // パンチ列
    this.btns.Ph = this._mkLevelBtn('P', 'high', 'P', '上', 'b-ph atk'); act.appendChild(this.btns.Ph);
    this.btns.Pm = this._mkLevelBtn('P', 'mid', 'P', '中', 'b-pm atk'); act.appendChild(this.btns.Pm);
    this.btns.Pl = this._mkLevelBtn('P', 'low', 'P', '下', 'b-pl atk'); act.appendChild(this.btns.Pl);
    // キック列
    this.btns.Kh = this._mkLevelBtn('K', 'high', 'K', '上', 'b-kh atk kick'); act.appendChild(this.btns.Kh);
    this.btns.Km = this._mkLevelBtn('K', 'mid', 'K', '中', 'b-km atk kick'); act.appendChild(this.btns.Km);
    this.btns.Kl = this._mkLevelBtn('K', 'low', 'K', '下', 'b-kl atk kick'); act.appendChild(this.btns.Kl);
    // ユーティリティ列（SP/S/G/JUMP）
    this.superBtn = this._mkBtn('SUPER', 'SP', 'b-su'); this.btns.SP = this.superBtn; act.appendChild(this.superBtn);
    this.btns.S = this._mkBtn('S', 'S', 'b-s'); act.appendChild(this.btns.S);
    this.btns.G = this._mkBtn('G', 'G', 'b-g'); act.appendChild(this.btns.G);
    act.appendChild(this._mkBtn('JUMP', 'JUMP', 'b-j'));
    root.appendChild(act);

    document.body.appendChild(root);
  }

  _mkBtn(name, label, cls) {
    const b = document.createElement('div'); b.className = 'btn ' + cls; b.textContent = label;
    const set = (v) => (e) => { e.preventDefault(); this.c.setBtn(name, v); b.classList.toggle('active', v); };
    b.addEventListener('pointerdown', set(true));
    b.addEventListener('pointerup', set(false));
    b.addEventListener('pointercancel', set(false));
    b.addEventListener('pointerleave', set(false));
    return b;
  }

  // 段つき攻撃ボタン: 押した瞬間にその段を発火（pressAttack(type, level)）。連打=オートコンボ。
  // パンチ列とキック列を同時押し（両列のボタンが同時に押されている）＝投げ。
  _mkLevelBtn(type, level, big, lvl, cls) {
    const b = document.createElement('div'); b.className = 'btn ' + cls;
    b.innerHTML = `<span class="big">${big}</span><span class="lvl">${lvl}</span>`;
    const down = (e) => {
      e.preventDefault(); b.classList.add('active');
      try { b.setPointerCapture(e.pointerId); } catch (_) {}
      if (type === 'P') this._pHeld++; else this._kHeld++;
      if (this._pHeld > 0 && this._kHeld > 0) this.c.pressAttack('GRAB', 'mid'); // 投げ
      else this.c.pressAttack(type, level);
    };
    const up = () => {
      b.classList.remove('active');
      if (type === 'P') this._pHeld = Math.max(0, this._pHeld - 1); else this._kHeld = Math.max(0, this._kHeld - 1);
    };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    return b;
  }

  setSuperReady(ready) { if (this.superBtn) this.superBtn.classList.toggle('ready', ready); }
  // 攻撃ボタンの点灯。P/K(6ボタン)は常時使用可＝常に点灯。S/SP のみ可否反映。
  setAvailability(av) {
    if (!this.btns) return;
    for (const k of ['Ph', 'Pm', 'Pl', 'Kh', 'Km', 'Kl']) { const b = this.btns[k]; if (b) { b.classList.remove('dim'); b.classList.add('rdy2'); } }
    const s = this.btns.S; if (s) { s.classList.toggle('dim', !av.S); s.classList.toggle('rdy2', !!av.S); }
    if (this.superBtn) this.superBtn.classList.toggle('ready', !!av.SP);
  }
  show(v) { if (this.root) this.root.style.display = v ? '' : 'none'; }
  dispose() { if (this.root) this.root.remove(); if (this.style) this.style.remove(); }
}

export function isTouchDevice() {
  return new URLSearchParams(location.search).has('touch') || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}
