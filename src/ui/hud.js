// =====================================================================
// HUD — 試合中の表示（SPEC §7）。視認性優先でコンパクト化。
// 体力／攻撃チャージ（色で状態表示）／SP／タイマー／ラウンド／コンボ／
// バナー／被弾ヴィネット／「次へ」プロンプト。冗長なテキストは排し中央を広く。
// =====================================================================

import { CONFIG } from '../core/constants.js';

const CSS = `
#hud { position:fixed; inset:0; pointer-events:none; z-index:20; font-family:-apple-system,"Hiragino Kaku Gothic ProN",sans-serif; color:#eaf2ff; }
#hud .top { position:absolute; top:max(8px,env(safe-area-inset-top)); left:0; right:0; display:flex; justify-content:space-between; padding:0 2.4vw; gap:14px; }
#hud .side { flex:1; max-width:40%; }
#hud .side.r { text-align:right; }
#hud .nrow { display:flex; align-items:center; gap:6px; font-weight:800; letter-spacing:.5px; font-size:13px; margin-bottom:3px; opacity:.92; text-shadow:0 1px 4px #000; }
#hud .side.r .nrow { flex-direction:row-reverse; }
#hud .lamps { display:flex; gap:4px; }
#hud .lamp { width:9px; height:9px; border-radius:50%; background:#33405e; border:1px solid #5a6c93; }
#hud .lamp.on { background:#ffd24a; box-shadow:0 0 6px #ffd24a; }
#hud .hpwrap { height:15px; background:#141d33cc; border:1.5px solid #44557a; border-radius:4px; overflow:hidden; position:relative; }
#hud .hpdmg { position:absolute; inset:0; background:rgba(255,255,255,.4); width:100%; transition:width .35s ease .1s; }
#hud .hpbar { position:absolute; inset:0; width:100%; transition:width .12s linear; }
#hud .side.l .hpwrap { transform:scaleX(-1); }
#hud .l .hpbar { background:linear-gradient(90deg,#2bd,#7fe); }
#hud .r .hpbar { background:linear-gradient(90deg,#f55,#fb6); }
#hud .ewrap { position:relative; height:6px; margin-top:3px; background:#141d33aa; border:1px solid #3a4a6e; border-radius:3px; overflow:hidden; }
#hud .ewrap.g::before { content:''; position:absolute; left:60%; top:0; bottom:0; width:1.5px; background:rgba(255,255,255,.4); z-index:2; }
#hud .ebar { position:absolute; inset:0; width:0%; transition:width .12s; }
#hud .gbar { background:linear-gradient(90deg,#e0563a,#ff8a6a); }
#hud .gbar.k { background:linear-gradient(90deg,#ffb33a,#ffe27a); }
#hud .gbar.s { background:linear-gradient(90deg,#3ad17a,#9affc0); }
#hud .spbar { background:linear-gradient(90deg,#7a3aff,#c98aff); }
#hud .spbar.full { background:linear-gradient(90deg,#ff4dd2,#ffd24a); animation:pulse .6s infinite alternate; }
#hud .side.l .ewrap { transform:scaleX(-1); }
@keyframes pulse { to { filter:brightness(1.5); } }
#hud .timer { position:absolute; top:max(6px,env(safe-area-inset-top)); left:50%; transform:translateX(-50%); font-size:28px; font-weight:900; text-shadow:0 2px 8px #000; min-width:54px; text-align:center; }
#hud .combo { position:absolute; top:26%; left:50%; transform:translateX(-50%); font-weight:900; text-align:center; opacity:0; transition:opacity .1s; text-shadow:0 2px 10px #000; }
#hud .combo .n { font-size:44px; color:#ffe27a; } #hud .combo .t { font-size:15px; letter-spacing:2px; }
#hud .combo.show { opacity:1; animation:pop .18s; }
@keyframes pop { from { transform:translateX(-50%) scale(1.4);} to { transform:translateX(-50%) scale(1);} }
#hud .banner { position:absolute; top:40%; left:50%; transform:translate(-50%,-50%); text-align:center; opacity:0; transition:opacity .25s; }
#hud .banner.show { opacity:1; }
#hud .banner .big { font-size:clamp(40px,8vw,58px); font-weight:900; letter-spacing:3px; text-shadow:0 3px 16px #000,0 0 30px currentColor; }
#hud .banner .sub { font-size:17px; opacity:.85; margin-top:6px; }
#hud .mname { position:absolute; bottom:30%; left:50%; transform:translateX(-50%); font-size:13px; font-weight:700; background:rgba(8,12,24,.5); padding:3px 10px; border-radius:8px; opacity:0; transition:opacity .15s; }
#hud .mname.show { opacity:1; }
#hud .vig { position:absolute; inset:0; opacity:0; transition:opacity .12s; }
#hud .vig.l { box-shadow:inset 60px 0 120px -20px rgba(120,220,255,.55); }
#hud .vig.r { box-shadow:inset -60px 0 120px -20px rgba(255,90,90,.55); }
#hud .vig.show { opacity:1; }
#hud .cont { position:absolute; bottom:18%; left:50%; transform:translateX(-50%); text-align:center; opacity:0; transition:opacity .3s; }
#hud .cont.show { opacity:1; }
#hud .cont .b { font-size:20px; font-weight:800; letter-spacing:2px; text-shadow:0 2px 10px #000; animation:blink 1.1s infinite; }
#hud .cont .s { font-size:12px; opacity:.7; margin-top:3px; }
@keyframes blink { 50% { opacity:.3; } }
#hud .info { position:absolute; bottom:max(6px,env(safe-area-inset-bottom)); left:50%; transform:translateX(-50%); font-size:10px; opacity:.5; pointer-events:none; transition:opacity 1s; white-space:nowrap; }
#hud .info.hide { opacity:0; }
@media (max-width:520px){ #hud .timer{ font-size:23px } #hud .nrow{ font-size:12px } }
`;

export class HUD {
  constructor() {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style); this.style = style;
    const el = document.createElement('div'); el.id = 'hud'; this.el = el;
    el.innerHTML = `
      <div class="top">
        <div class="side l">
          <div class="nrow"><span id="nm1">P1</span><span class="lamps" id="lp1"></span></div>
          <div class="hpwrap"><div class="hpdmg" id="hd1"></div><div class="hpbar" id="hp1"></div></div>
          <div class="ewrap g"><div class="ebar gbar" id="gg1"></div></div>
          <div class="ewrap"><div class="ebar spbar" id="sp1"></div></div>
        </div>
        <div class="side r">
          <div class="nrow"><span id="nm2">P2</span><span class="lamps" id="lp2"></span></div>
          <div class="hpwrap"><div class="hpdmg" id="hd2"></div><div class="hpbar" id="hp2"></div></div>
          <div class="ewrap g"><div class="ebar gbar" id="gg2"></div></div>
          <div class="ewrap"><div class="ebar spbar" id="sp2"></div></div>
        </div>
      </div>
      <div class="timer" id="timer">60</div>
      <div class="combo" id="combo"><div class="n">2</div><div class="t">HITS</div></div>
      <div class="banner" id="banner"><div class="big"></div><div class="sub"></div></div>
      <div class="mname" id="mname"></div>
      <div class="vig" id="vig"></div>
      <div class="cont" id="cont"><div class="b">▶ タップ / ボタンで次へ</div><div class="s">勝利！</div></div>
      <div class="info" id="hinfo"></div>`;
    document.body.appendChild(el);
    this.$ = (id) => el.querySelector('#' + id);
    this._comboT = 0; this._vigT = 0; this._bannerT = 0; this._mnameT = 0; this._hintT = 0;
  }

  setup(match, names, archetypes, roundsToWin, info = '') {
    this.match = match; this.roundsToWin = roundsToWin;
    this.$('nm1').textContent = names[0]; this.$('nm2').textContent = names[1];
    this.$('hinfo').textContent = info; this.$('hinfo').classList.remove('hide'); this._hintT = 6.5;
    for (const side of [1, 2]) {
      const lp = this.$('lp' + side); lp.innerHTML = '';
      for (let i = 0; i < roundsToWin; i++) { const d = document.createElement('span'); d.className = 'lamp'; lp.appendChild(d); }
    }
    this._dmgW = [100, 100];
  }

  showBanner(big, sub = '', color = '#fff', dur = 1.4) {
    const b = this.$('banner'); b.querySelector('.big').textContent = big; b.querySelector('.big').style.color = color;
    b.querySelector('.sub').textContent = sub; b.classList.add('show'); this._bannerT = dur;
  }
  hideBanner() { this.$('banner').classList.remove('show'); }
  showContinue(isMatch) {
    const c = this.$('cont');
    c.querySelector('.b').textContent = '▶ タップ / ボタンで ' + (isMatch ? '結果へ' : '次のラウンドへ');
    c.classList.add('show');
  }
  hideContinue() { this.$('cont').classList.remove('show'); }
  showMoveName(n) { const m = this.$('mname'); m.textContent = n; m.classList.add('show'); this._mnameT = 1.0; }
  flashVignette(side) { const v = this.$('vig'); v.className = 'vig ' + (side === 0 ? 'l' : 'r') + ' show'; this._vigT = 0.18; }
  popCombo(n) { const c = this.$('combo'); c.querySelector('.n').textContent = n; c.classList.remove('show'); void c.offsetWidth; c.classList.add('show'); this._comboT = 1.1; }

  update(dt) {
    const m = this.match; if (!m) return;
    const [a, b] = m.fighters;
    const w1 = Math.max(0, a.hp / a.maxHp * 100), w2 = Math.max(0, b.hp / b.maxHp * 100);
    this.$('hp1').style.width = w1 + '%'; this.$('hp2').style.width = w2 + '%';
    this._dmgW[0] += (w1 - this._dmgW[0]) * Math.min(1, dt * 4); this._dmgW[1] += (w2 - this._dmgW[1]) * Math.min(1, dt * 4);
    this.$('hd1').style.width = Math.max(w1, this._dmgW[0]) + '%'; this.$('hd2').style.width = Math.max(w2, this._dmgW[1]) + '%';
    // 攻撃チャージ（色で状態：赤=Pのみ / 黄=P+K / 緑=必殺可）
    const gmax = CONFIG.GAUGE_MAX;
    this.$('gg1').style.width = (a.gauge / gmax * 100) + '%'; this.$('gg2').style.width = (b.gauge / gmax * 100) + '%';
    this._chargeClass('gg1', a.gauge); this._chargeClass('gg2', b.gauge);
    // SP
    const sm = CONFIG.SP_MAX;
    this.$('sp1').style.width = (a.sp / sm * 100) + '%'; this.$('sp2').style.width = (b.sp / sm * 100) + '%';
    this.$('sp1').classList.toggle('full', a.sp >= sm); this.$('sp2').classList.toggle('full', b.sp >= sm);
    // タイマー（NaNガード）
    const t = Math.ceil(m.timer / 60);
    this.$('timer').textContent = Number.isFinite(t) ? Math.max(0, t) : '';
    // ラウンドランプ
    for (const [side] of [[1], [2]]) {
      const lamps = this.$('lp' + side).children; const wins = m.wins[side - 1];
      for (let i = 0; i < lamps.length; i++) lamps[i].classList.toggle('on', i < wins);
    }
    // 各種タイマー
    if (this._bannerT > 0 && (this._bannerT -= dt) <= 0) this.hideBanner();
    if (this._mnameT > 0 && (this._mnameT -= dt) <= 0) this.$('mname').classList.remove('show');
    if (this._vigT > 0 && (this._vigT -= dt) <= 0) this.$('vig').classList.remove('show');
    if (this._comboT > 0 && (this._comboT -= dt) <= 0) this.$('combo').classList.remove('show');
    if (this._hintT > 0 && (this._hintT -= dt) <= 0) this.$('hinfo').classList.add('hide'); // 操作ヒントは数秒で自動で消す
  }

  _chargeClass(id, g) {
    // チャージは S(必殺) 専用ゲージに意味変更（P/K は常時可）。MAX で緑＝必殺可。
    const bar = this.$(id);
    bar.classList.remove('k');
    bar.classList.toggle('s', g >= CONFIG.THRESH_S);
  }

  dispose() { if (this.el) this.el.remove(); if (this.style) this.style.remove(); }
}
