// =====================================================================
// GameUI — 画面遷移（SPEC §7）。タイトル→モード→キャラ選択→ステージ選択→
// 試合→リザルト。ポーズ/オプション/ローディングも。各画面は Promise を返す。
// frontend-design 志向の見た目（グラデ/グロー/NOVA CLASH ブランディング）。
// =====================================================================

const CSS = `
#ov { position:fixed; inset:0; z-index:60; display:flex; align-items:safe center; justify-content:center;
  font-family:-apple-system,"Hiragino Kaku Gothic ProN",sans-serif; color:#eaf2ff;
  background:radial-gradient(120% 90% at 50% 0%, #15233f 0%, #0b1020 55%, #05070e 100%);
  -webkit-user-select:none; user-select:none; overflow-y:auto; overflow-x:hidden;
  touch-action:pan-y; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; }
#ov.hidden { display:none; }
#ov .wrap { width:min(960px,94vw); padding:24px; text-align:center; }
#ov .logo { font-size:clamp(40px,9vw,86px); font-weight:900; letter-spacing:6px; line-height:1;
  background:linear-gradient(180deg,#bfe9ff,#56b8ff 55%,#2b7fff); -webkit-background-clip:text; background-clip:text; color:transparent;
  text-shadow:0 0 36px rgba(80,170,255,.5); filter:drop-shadow(0 4px 16px rgba(0,0,0,.6)); }
#ov .logo .x { color:#ffcf4a; -webkit-text-fill-color:#ffcf4a; }
#ov .tag { margin-top:10px; font-size:14px; opacity:.75; letter-spacing:3px; }
#ov .blink { margin-top:42px; font-size:20px; font-weight:700; animation:bl 1.1s infinite; letter-spacing:2px; }
@keyframes bl { 50%{opacity:.25} }
#ov h2 { font-size:24px; font-weight:800; letter-spacing:2px; margin-bottom:6px; }
#ov .sub { opacity:.6; font-size:13px; margin-bottom:22px; }
#ov .btns { display:flex; flex-direction:column; gap:12px; max-width:360px; margin:0 auto; }
#ov .mbtn { padding:15px 18px; border-radius:13px; border:2px solid rgba(120,170,255,.4);
  background:linear-gradient(180deg,rgba(60,100,170,.25),rgba(40,60,110,.25)); color:#eaf2ff; font-size:17px; font-weight:800;
  cursor:pointer; transition:transform .07s, background .12s, border-color .12s; pointer-events:auto; letter-spacing:1px; }
#ov .mbtn small { display:block; font-weight:500; opacity:.65; font-size:12px; margin-top:3px; letter-spacing:0; }
#ov .mbtn:hover { background:linear-gradient(180deg,rgba(80,140,230,.45),rgba(50,80,150,.4)); border-color:#6cf; transform:translateY(-2px); }
#ov .mbtn:active { transform:scale(.97); }
#ov .mbtn.feat { border-color:#ffcf4a; background:linear-gradient(180deg,rgba(255,180,60,.32),rgba(255,120,30,.22));
  box-shadow:0 0 0 1px rgba(255,207,74,.5), 0 0 26px rgba(255,180,60,.35); animation:featpulse 2.2s ease-in-out infinite; }
#ov .mbtn.feat:hover { background:linear-gradient(180deg,rgba(255,200,80,.5),rgba(255,140,40,.4)); border-color:#ffe08a; }
#ov .mbtn.feat small { opacity:.9; color:#ffe6b0; }
@keyframes featpulse { 50% { box-shadow:0 0 0 1px rgba(255,207,74,.75), 0 0 38px rgba(255,180,60,.55); } }
#ov .grid { display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); }
#ov .card { position:relative; border-radius:14px; overflow:hidden; cursor:pointer; border:2px solid rgba(255,255,255,.12);
  background:#0e1730; padding:0; transition:transform .08s, border-color .12s, box-shadow .12s; pointer-events:auto; min-height:212px; }
#ov .card:hover { transform:translateY(-3px); }
#ov .card .swatch { height:150px; display:flex; align-items:center; justify-content:center; font-size:52px; font-weight:900; color:#0008; }
#ov .card img { width:100%; height:150px; object-fit:cover; object-position:center 32%; display:block; }
#ov .card .meta { padding:9px 11px; text-align:left; }
#ov .card .nm { font-weight:800; font-size:16px; letter-spacing:1px; }
#ov .card .ar { font-size:11px; opacity:.7; margin-top:2px; }
#ov .card .rg { position:absolute; top:8px; right:8px; font-size:10px; font-weight:800; padding:2px 7px; border-radius:20px; background:#000a; }
#ov .card.sel { box-shadow:0 0 0 3px #ffcf4a, 0 6px 24px rgba(0,0,0,.5); border-color:#ffcf4a; }
#ov .stagecard { min-height:120px; }
#ov .stagecard .swatch { height:80px; flex-direction:column; gap:4px; font-size:15px; color:#eaf2ff; text-shadow:0 1px 4px #000; }
#ov .row { display:flex; gap:12px; justify-content:center; flex-wrap:wrap; margin-top:22px; }
#ov .row .mbtn { min-width:150px; }
#ov .back { position:absolute; top:18px; left:18px; padding:9px 16px; border-radius:10px; border:1px solid rgba(170,200,255,.35);
  background:rgba(20,30,55,.6); cursor:pointer; pointer-events:auto; font-weight:700; }
#ov .opts { max-width:420px; margin:0 auto; text-align:left; }
#ov .opt { display:flex; justify-content:space-between; align-items:center; padding:12px 4px; border-bottom:1px solid rgba(255,255,255,.08); }
#ov .toggle { padding:7px 16px; border-radius:20px; border:2px solid #5a6c93; background:#1a2440; cursor:pointer; pointer-events:auto; font-weight:800; min-width:74px; text-align:center; }
#ov .toggle.on { background:#2b7fff; border-color:#6cf; }
#ov .result .big { font-size:clamp(40px,10vw,80px); font-weight:900; letter-spacing:4px; text-shadow:0 0 40px currentColor; }
#ov .load { width:min(420px,80vw); }
#ov .bar { height:12px; background:#16203a; border-radius:8px; overflow:hidden; border:1px solid #33405e; margin-top:14px; }
#ov .bar > div { height:100%; width:0%; background:linear-gradient(90deg,#2b7fff,#7fe); transition:width .2s; }
`;

export class GameUI {
  constructor() {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style); this.style = style;
    const ov = document.createElement('div'); ov.id = 'ov'; this.ov = ov; document.body.appendChild(ov);
    this.settings = { gyro: false, muted: false, intensity: 1, difficulty: 1, debug: false }; // gyro既定OFF（左スティックで移動）
  }

  show() { this.ov.classList.remove('hidden'); }
  hide() { this.ov.classList.add('hidden'); }
  _set(html) { this.ov.classList.remove('hidden'); this.ov.innerHTML = `<div class="wrap">${html}</div>`; return this.ov.querySelector('.wrap'); }

  title() {
    const w = this._set(`
      <div class="logo">NOVA&nbsp;CLA<span class="x">S</span>H</div>
      <div class="tag">3D ACTION FIGHTING — モバイル特化ハイブリッド格闘</div>
      <div class="blink">PRESS / TAP TO START</div>`);
    return new Promise((res) => {
      const go = () => { cleanup(); res(); };
      const cleanup = () => { this.ov.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
      this.ov.addEventListener('pointerdown', go); window.addEventListener('keydown', go);
    });
  }

  mainMenu() {
    this._set(`
      <h2>モード選択</h2><div class="sub">MODE SELECT</div>
      <div class="btns">
        <div class="mbtn feat" data-m="online">🌐 オンライン対戦<small>部屋コードでフレンドと P2P 1v1 ・ おすすめ</small></div>
        <div class="mbtn" data-m="arcade">アーケード<small>CPUを連戦して勝ち抜く</small></div>
        <div class="mbtn" data-m="vscpu">対CPU（1戦）<small>キャラ・難易度を選んで1試合</small></div>
        <div class="mbtn" data-m="local2p">ローカル2P<small>同一PCで2人対戦（キーボード）</small></div>
        <div class="mbtn" data-m="training">トレーニング<small>サンドバッグ・判定/フレーム表示</small></div>
        <div class="mbtn" data-m="options">オプション<small>ジャイロ/音/演出/操作</small></div>
      </div>`);
    return this._pick('[data-m]', (el) => el.dataset.m);
  }

  selectDifficulty() {
    this._set(`<button class="back" data-back>← 戻る</button>
      <h2>難易度</h2><div class="sub">DIFFICULTY</div>
      <div class="btns">
        <div class="mbtn" data-d="0">EASY<small>ゆっくり・反応控えめ</small></div>
        <div class="mbtn" data-d="1">NORMAL<small>標準的な手応え</small></div>
        <div class="mbtn" data-d="2">HARD<small>反応・コンボ・崩しが厳しい</small></div>
      </div>`);
    return this._pick('[data-d],[data-back]', (el) => el.dataset.back !== undefined ? '__back' : parseInt(el.dataset.d, 10));
  }

  selectCharacter(roster, opts = {}) {
    const cards = roster.map((c) => {
      const tint = c.tint || '#88aaff';
      // assetVersion を ?v= で付与＝Studioで撮り直したサムネが即反映（キャッシュ回避）
      const thumbUrl = c.thumb ? c.thumb + (c.thumb.includes('?') ? '&' : '?') + 'v=' + (c.assetVersion || '') : '';
      const inner = c.thumb
        ? `<img src="${thumbUrl}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'swatch',style:'background:${tint}',textContent:'${c.name[0]}'}))">`
        : `<div class="swatch" style="background:${tint}">${c.name[0]}</div>`;
      return `<div class="card" data-id="${c.id}">
        <span class="rg" style="color:${tint}">${(c.range || '').toUpperCase()}</span>
        ${inner}
        <div class="meta"><div class="nm">${c.nameJa || c.name}</div><div class="ar">${c.label || c.archetype}</div></div>
      </div>`;
    }).join('');
    this._set(`<button class="back" data-back>← 戻る</button>
      <h2>${opts.title || 'キャラクター選択'}</h2>
      <div class="sub" style="color:${opts.accent || '#9cf'}">${opts.sub || 'CHARACTER SELECT'}</div>
      <div class="grid">${cards}</div>`);
    return this._pick('[data-id],[data-back]', (el) => el.dataset.back !== undefined ? '__back' : roster.find((c) => c.id === el.dataset.id));
  }

  selectStage(stages) {
    const cards = stages.map((s) => {
      const th = s.theme;
      return `<div class="card stagecard" data-id="${s.id}">
        <div class="swatch" style="background:linear-gradient(160deg,${cssHex(th.bg)},${cssHex(th.ground)})">
          <span style="color:${cssHex(th.accent)};font-weight:900">${s.nameJa}</span>
          <span style="font-size:10px;opacity:.85">${s.ringOut ? 'リングアウト有' : '壁あり'}</span>
        </div>
        <div class="meta"><div class="nm" style="font-size:14px">${s.name}</div><div class="ar">${s.desc}</div></div>
      </div>`;
    }).join('');
    this._set(`<button class="back" data-back>← 戻る</button>
      <h2>ステージ選択</h2><div class="sub">STAGE SELECT</div>
      <div class="grid">${cards}</div>`);
    return this._pick('[data-id],[data-back]', (el) => el.dataset.back !== undefined ? '__back' : stages.find((s) => s.id === el.dataset.id));
  }

  trainingOptions() {
    this._set(`<button class="back" data-back>← 戻る</button>
      <h2>トレーニング設定</h2><div class="sub">DUMMY BEHAVIOR</div>
      <div class="btns">
        <div class="mbtn" data-t="stand">棒立ち</div>
        <div class="mbtn" data-t="guard">ガード</div>
        <div class="mbtn" data-t="cpu">反撃CPU</div>
      </div>`);
    return this._pick('[data-t],[data-back]', (el) => el.dataset.back !== undefined ? '__back' : el.dataset.t);
  }

  options(audio, onDebug) {
    const s = this.settings;
    const w = this._set(`<button class="back" data-back>← 戻る</button>
      <h2>オプション</h2><div class="sub">OPTIONS</div>
      <div class="opts">
        <div class="opt"><span>サウンド</span><div class="toggle ${!s.muted ? 'on' : ''}" data-k="sound">${!s.muted ? 'ON' : 'OFF'}</div></div>
        <div class="opt"><span>ジャイロ操作（前後傾け・任意）</span><div class="toggle ${s.gyro ? 'on' : ''}" data-k="gyro">${s.gyro ? 'ON' : 'OFF'}</div></div>
        <div class="opt"><span>演出強度</span><div class="toggle" data-k="intensity">${intensityLabel(s.intensity)}</div></div>
        <div class="opt"><span>当たり判定表示（H）</span><div class="toggle ${s.debug ? 'on' : ''}" data-k="debug">${s.debug ? 'ON' : 'OFF'}</div></div>
      </div>
      <div class="row"><div class="mbtn" data-back2 style="min-width:200px">閉じる</div></div>`);
    return new Promise((res) => {
      w.querySelectorAll('.toggle').forEach((t) => t.addEventListener('pointerdown', (e) => {
        e.preventDefault(); const k = t.dataset.k;
        if (k === 'sound') { s.muted = !s.muted; audio && audio.setMuted(s.muted); t.classList.toggle('on', !s.muted); t.textContent = !s.muted ? 'ON' : 'OFF'; }
        else if (k === 'gyro') { s.gyro = !s.gyro; t.classList.toggle('on', s.gyro); t.textContent = s.gyro ? 'ON' : 'OFF'; if (this.onGyroToggle) this.onGyroToggle(s.gyro); }
        else if (k === 'intensity') { s.intensity = s.intensity >= 1.5 ? 0.6 : s.intensity >= 1 ? 1.5 : 1; t.textContent = intensityLabel(s.intensity); if (this.onIntensity) this.onIntensity(s.intensity); }
        else if (k === 'debug') { s.debug = !s.debug; t.classList.toggle('on', s.debug); t.textContent = s.debug ? 'ON' : 'OFF'; onDebug && onDebug(s.debug); }
      }));
      const back = () => res();
      w.querySelector('[data-back]').addEventListener('pointerdown', (e) => { e.preventDefault(); back(); });
      w.querySelector('[data-back2]').addEventListener('pointerdown', (e) => { e.preventDefault(); back(); });
    });
  }

  result(winText, color, lines = [], buttons = [{ id: 'rematch', label: '再戦' }, { id: 'menu', label: 'メニューへ' }]) {
    const btns = buttons.map((b) => `<div class="mbtn" data-r="${b.id}" style="min-width:160px">${b.label}</div>`).join('');
    this._set(`<div class="result">
      <div class="big" style="color:${color}">${winText}</div>
      <div class="sub" style="margin-top:14px">${lines.join(' · ')}</div>
      <div class="row">${btns}</div></div>`);
    return this._pick('[data-r]', (el) => el.dataset.r);
  }

  pause() {
    this._set(`<h2>PAUSE</h2><div class="sub">一時停止</div>
      <div class="btns">
        <div class="mbtn" data-p="resume">再開</div>
        <div class="mbtn" data-p="rematch">仕切り直し</div>
        <div class="mbtn" data-p="options">オプション</div>
        <div class="mbtn" data-p="menu">メニューへ戻る</div>
      </div>`);
    return this._pick('[data-p]', (el) => el.dataset.p);
  }

  loading(label = 'LOADING') {
    const w = this._set(`<div class="load"><div class="logo" style="font-size:40px">NOVA&nbsp;CLA<span class="x">S</span>H</div>
      <div class="sub" id="ldlbl" style="margin-top:18px">${label}…</div>
      <div class="bar"><div id="ldbar"></div></div></div>`);
    return { set: (p, txt) => { const b = w.querySelector('#ldbar'); if (b) b.style.width = Math.round(p * 100) + '%'; if (txt) w.querySelector('#ldlbl').textContent = txt; } };
  }

  toast(text, ms = 1300) {
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:120px;left:50%;transform:translateX(-50%);z-index:70;max-width:92vw;text-align:center;background:rgba(10,16,30,.9);color:#eaf2ff;padding:10px 18px;border-radius:10px;font-weight:700;font-size:13px;pointer-events:none;border:1px solid rgba(170,200,255,.35)';
    t.textContent = text; document.body.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, ms);
  }

  // ---- オンライン対戦のロビー ----
  onlineHome() {
    this._set(`<button class="back" data-back>← 戻る</button>
      <h2>オンライン対戦</h2><div class="sub">ONLINE 1v1 ・ P2P（部屋コード）</div>
      <div class="btns">
        <div class="mbtn" data-o="create">部屋を作る<small>コードを発行して相手の参加を待つ</small></div>
        <div class="mbtn" data-o="join">コードで参加<small>相手の6桁コードを入力して接続</small></div>
      </div>
      <div class="sub" style="margin-top:18px;opacity:.5">同じ部屋コードを共有した2人で対戦できます</div>`);
    return this._pick('[data-o],[data-back]', (el) => (el.dataset.back !== undefined ? '__back' : el.dataset.o));
  }

  onlineJoin() {
    const w = this._set(`<button class="back" data-back>← 戻る</button>
      <h2>コードで参加</h2><div class="sub">ENTER ROOM CODE</div>
      <div class="btns" style="max-width:320px">
        <input id="rcode" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="000000"
          style="padding:14px;font-size:28px;text-align:center;letter-spacing:10px;border-radius:12px;border:2px solid rgba(120,170,255,.5);background:#0e1730;color:#eaf2ff;font-weight:800;width:100%">
        <div class="mbtn" data-join>参加する</div>
      </div>`);
    return new Promise((res) => {
      const input = w.querySelector('#rcode');
      setTimeout(() => input && input.focus(), 60);
      const submit = () => { const v = (input.value || '').replace(/\D/g, '').slice(0, 6); if (v.length === 6) res(v); else this.toast('6桁の数字コードを入力してください'); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      w.querySelector('[data-join]').addEventListener('pointerdown', (e) => { e.preventDefault(); submit(); });
      w.querySelector('[data-back]').addEventListener('pointerdown', (e) => { e.preventDefault(); res('__back'); });
    });
  }

  // 待機/接続中の表示。キャンセル押下で resolve('__cancel')。コード未指定なら非表示。
  netInfo(title, sub, code) {
    this._set(`<h2>${title}</h2>
      ${code ? `<div style="font-size:46px;font-weight:900;letter-spacing:12px;color:#ffd24a;margin:14px 0 4px;text-shadow:0 0 26px rgba(255,210,74,.5)">${code}</div>` : ''}
      <div class="sub" style="margin-top:10px">${sub}</div>
      <div class="row"><div class="mbtn" data-cancel style="min-width:180px">キャンセル</div></div>`);
    return this._pick('[data-cancel]', () => '__cancel');
  }

  // タップ/ドラッグ判別つき選択: pointerdown した要素の上で「ほぼ動かさず」離した時だけ確定。
  // → スクロールのスワイプ（12px超の移動）では選択されない（誤遷移を防ぐ）。
  _pick(sel, map) {
    return new Promise((res) => {
      let downEl = null, sx = 0, sy = 0, moved = false;
      const onDown = (e) => { downEl = e.target.closest(sel); sx = e.clientX; sy = e.clientY; moved = false; };
      const onMove = (e) => { if (downEl && (Math.abs(e.clientX - sx) > 12 || Math.abs(e.clientY - sy) > 12)) moved = true; };
      const onUp = (e) => {
        const el = e.target.closest(sel);
        const hit = downEl && el === downEl && !moved;
        downEl = null;
        if (!hit) return;
        e.preventDefault();
        this.ov.removeEventListener('pointerdown', onDown);
        this.ov.removeEventListener('pointermove', onMove);
        this.ov.removeEventListener('pointerup', onUp);
        res(map(el));
      };
      this.ov.addEventListener('pointerdown', onDown);
      this.ov.addEventListener('pointermove', onMove);
      this.ov.addEventListener('pointerup', onUp);
    });
  }
}

function intensityLabel(v) { return v >= 1.5 ? '派手' : v >= 1 ? '標準' : '軽'; }
function cssHex(n) { return '#' + ('000000' + (n >>> 0).toString(16)).slice(-6); }
