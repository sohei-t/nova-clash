// =====================================================================
// GameUI — 画面遷移（SPEC §7）。タイトル→モード→キャラ選択→ステージ選択→
// 試合→リザルト。ポーズ/オプション/ローディングも。各画面は Promise を返す。
// frontend-design 志向の見た目（グラデ/グロー/NOVA CLASH ブランディング）。
// ガチャ/ミッション画面（meta.js 連携）を含む。
// =====================================================================

import { RARITY, GACHA_COST, GACHA_10_COST, SR_PITY, getPoolItem } from '../meta.js?v=1794449214';

const KIND_LABEL = { title: '称号', spark: 'ヒットエフェクト', confetti: '紙吹雪', stageskin: 'ステージスキン', spell: '魔法（消耗品）' };
const KIND_ICON = { title: '🏷', spark: '✨', confetti: '🎊', stageskin: '🏟', coins: '🪙', spell: '🪄' };
const RAR_ORDER = { N: 0, R: 1, SR: 2, UR: 3 };

const CSS = `
#ov { position:fixed; inset:0; z-index:60; display:flex; align-items:safe center; justify-content:center;
  font-family:-apple-system,"Hiragino Kaku Gothic ProN",sans-serif; color:#eaf2ff;
  background:radial-gradient(120% 90% at 50% 0%, #15233f 0%, #0b1020 55%, #05070e 100%);
  -webkit-user-select:none; user-select:none; overflow-y:auto; overflow-x:hidden;
  touch-action:pan-y; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; }
#ov.hidden { display:none; }
/* タイトルでは背景を半透明化＝背後の3Dキャラ showcase を見せる */
#ov.glass { background:radial-gradient(120% 90% at 50% 0%, rgba(21,35,63,.42) 0%, rgba(11,16,32,.30) 55%, rgba(5,7,14,.66) 100%); }
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
#ov .help { max-width:560px; margin:0 auto 18px; text-align:left; }
#ov .help .hsec { font-weight:900; letter-spacing:1px; color:#ffcf4a; font-size:13px; margin:16px 0 6px; padding-bottom:4px; border-bottom:1px solid rgba(255,207,74,.25); }
#ov .help .hsec:first-child { margin-top:0; }
#ov .help .hrow { display:flex; gap:12px; padding:7px 2px; border-bottom:1px solid rgba(255,255,255,.07); }
#ov .help .hk { flex:0 0 116px; font-weight:800; font-size:13px; color:#cfe0ff; }
#ov .help .hv { flex:1; font-size:13px; line-height:1.5; opacity:.92; }
#ov .help .hv b { color:#fff; font-weight:800; }
/* --- コイン残高・バッジ --- */
#ov .coinbar { position:absolute; top:16px; right:16px; display:flex; align-items:center; gap:8px;
  background:rgba(12,20,38,.85); border:1px solid rgba(255,210,74,.4); border-radius:22px; padding:7px 16px;
  font-weight:900; font-size:15px; color:#ffd24a; letter-spacing:.5px; box-shadow:0 2px 12px rgba(0,0,0,.35); }
#ov .coinbar .ttl { font-size:11px; color:#cfe0ff; font-weight:700; opacity:.85; letter-spacing:0; }
#ov .mbtn .nbadge { display:inline-block; min-width:20px; height:20px; line-height:20px; margin-left:8px;
  background:#ff4a5a; color:#fff; border-radius:11px; font-size:12px; font-weight:900; padding:0 6px; vertical-align:2px;
  box-shadow:0 0 10px rgba(255,74,90,.6); }
/* --- ガチャ --- */
#ov .gwrap { max-width:640px; margin:0 auto; }
#ov .gpulls { display:flex; gap:14px; justify-content:center; margin:18px 0 8px; }
#ov .gpull { flex:1; max-width:230px; padding:16px 12px; border-radius:14px; border:2px solid #6cf; cursor:pointer;
  background:linear-gradient(180deg,rgba(60,120,220,.4),rgba(30,60,130,.35)); font-weight:900; font-size:16px; pointer-events:auto;
  transition:transform .07s; }
#ov .gpull:hover { transform:translateY(-2px); }
#ov .gpull.ten { border-color:#ffd24a; background:linear-gradient(180deg,rgba(255,190,60,.35),rgba(200,120,20,.28)); }
#ov .gpull small { display:block; font-weight:700; font-size:12px; opacity:.8; margin-top:4px; }
#ov .gpull.off { opacity:.4; pointer-events:none; }
#ov .pity { font-size:12px; opacity:.6; margin-bottom:14px; }
#ov .gcap { width:110px; height:110px; margin:26px auto 10px; position:relative; animation:gdrop .55s ease-out, gshake .5s ease-in-out .6s 2; }
#ov .gcap .top { position:absolute; inset:0 0 50% 0; border-radius:55px 55px 0 0; background:linear-gradient(180deg,#ff6a7a,#d02a4a); box-shadow:inset 0 6px 14px rgba(255,255,255,.35); }
#ov .gcap .bot { position:absolute; inset:50% 0 0 0; border-radius:0 0 55px 55px; background:linear-gradient(180deg,#f0f4fa,#b8c4d8); }
#ov .gcap.open .top { animation:gopen-t .45s ease-in forwards; }
#ov .gcap.open .bot { animation:gopen-b .45s ease-in forwards; }
@keyframes gdrop { 0% { transform:translateY(-46vh) rotate(-18deg); } 70% { transform:translateY(0) rotate(0); } 84% { transform:translateY(-22px); } 100% { transform:translateY(0); } }
@keyframes gshake { 0%,100% { transform:rotate(0); } 25% { transform:rotate(-9deg); } 75% { transform:rotate(9deg); } }
@keyframes gopen-t { to { transform:translateY(-70px) rotate(-24deg); opacity:0; } }
@keyframes gopen-b { to { transform:translateY(70px) rotate(20deg); opacity:0; } }
#ov .gcards { display:flex; gap:10px; flex-wrap:wrap; justify-content:center; margin-top:14px; }
#ov .gcard { width:112px; border-radius:12px; padding:12px 8px 10px; background:#101a32; border:2px solid #345;
  opacity:0; transform:translateY(14px) scale(.92); animation:gin .38s ease-out forwards; }
@keyframes gin { to { opacity:1; transform:none; } }
#ov .gcard .rar { font-size:10px; font-weight:900; letter-spacing:1px; margin-bottom:5px; }
#ov .gcard .gic { font-size:30px; line-height:1.25; }
#ov .gcard .gnm { font-size:12px; font-weight:800; margin-top:5px; line-height:1.3; min-height:31px; }
#ov .gcard .gsub { font-size:10px; opacity:.65; margin-top:3px; }
#ov .gcard.rar-R  { border-color:#4da6ff; box-shadow:0 0 14px rgba(77,166,255,.35); }
#ov .gcard.rar-SR { border-color:#c77dff; box-shadow:0 0 20px rgba(199,125,255,.55); }
#ov .gcard.rar-UR { border-color:#ffd24a; box-shadow:0 0 26px rgba(255,210,74,.75); animation:gin .38s ease-out forwards, urglow 1.6s ease-in-out infinite .4s; }
@keyframes urglow { 50% { box-shadow:0 0 44px rgba(255,210,74,1); } }
#ov .gnewtag { display:inline-block; background:#ff4a5a; color:#fff; font-size:9px; font-weight:900; border-radius:8px; padding:1px 7px; margin-left:4px; vertical-align:2px; }
/* --- コレクション / ミッション --- */
#ov .colsec { text-align:left; max-width:640px; margin:20px auto 0; }
#ov .colsec h3 { font-size:13px; letter-spacing:2px; color:#9cf; border-bottom:1px solid rgba(150,200,255,.25); padding-bottom:5px; margin:16px 0 8px; }
#ov .colgrid { display:flex; gap:8px; flex-wrap:wrap; }
#ov .colitem { border-radius:10px; padding:8px 12px; background:#101a32; border:1.5px solid #345; cursor:pointer; pointer-events:auto;
  font-size:12px; font-weight:700; transition:transform .07s; }
#ov .colitem:hover { transform:translateY(-1px); }
#ov .colitem.on { border-color:#7fe; box-shadow:0 0 10px rgba(127,255,238,.4); }
#ov .colitem .cr { font-size:9px; font-weight:900; letter-spacing:1px; margin-right:6px; }
#ov .mrow { display:flex; align-items:center; gap:12px; background:#0e1730; border:1px solid #2a3a5e; border-radius:12px; padding:12px 14px; margin-bottom:9px; text-align:left; }
#ov .mrow .ml { flex:1; }
#ov .mrow .mt { font-weight:800; font-size:14px; }
#ov .mrow .bar2 { height:7px; background:#16203a; border-radius:5px; overflow:hidden; margin-top:7px; border:1px solid #33405e; }
#ov .mrow .bar2>div { height:100%; background:linear-gradient(90deg,#2b7fff,#7fe); }
#ov .mrow .mp { font-size:11px; opacity:.65; margin-top:4px; }
#ov .mclaim { padding:9px 16px; border-radius:10px; font-weight:900; font-size:13px; cursor:pointer; pointer-events:auto; white-space:nowrap;
  border:2px solid #ffd24a; background:linear-gradient(180deg,rgba(255,200,80,.4),rgba(255,140,40,.3)); color:#ffe8b0; }
#ov .mclaim.off { border-color:#445; background:#141c30; color:#678; pointer-events:none; }
#ov .mclaim.done { border-color:#3a5; background:#12240e; color:#7c6; pointer-events:none; }
/* --- リザルト拡張（ランク・コイン獲得）--- */
#ov .rank { font-size:clamp(60px,14vw,110px); font-weight:900; line-height:1;
  text-shadow:0 0 44px currentColor; animation:rankin .5s cubic-bezier(.2,2.4,.4,1) both; }
@keyframes rankin { 0% { transform:scale(2.6); opacity:0; } 100% { transform:scale(1); opacity:1; } }
#ov .coinget { margin-top:16px; font-size:15px; }
#ov .coinget .cnum { font-size:26px; font-weight:900; color:#ffd24a; }
#ov .coinget .cbr { font-size:12px; opacity:.7; margin-top:5px; }
`;

export class GameUI {
  constructor() {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style); this.style = style;
    const ov = document.createElement('div'); ov.id = 'ov'; this.ov = ov; document.body.appendChild(ov);
    this.settings = { gyro: false, muted: false, intensity: 1, difficulty: 1, debug: false }; // gyro既定OFF（左スティックで移動）
  }

  show() { this.ov.classList.remove('hidden'); }
  hide() { this.ov.classList.add('hidden'); }
  _set(html) { this.ov.classList.remove('hidden'); this.ov.classList.remove('glass'); this.ov.innerHTML = `<div class="wrap">${html}</div>`; return this.ov.querySelector('.wrap'); }

  title() {
    const w = this._set(`
      <div class="logo">NOVA&nbsp;CLA<span class="x">S</span>H</div>
      <div class="tag">3D ACTION FIGHTING — モバイル特化ハイブリッド格闘</div>
      <div class="blink">PRESS / TAP TO START</div>`);
    this.ov.classList.add('glass');   // 背後の3Dキャラ showcase を透かして見せる
    return new Promise((res) => {
      const go = () => { cleanup(); res(); };
      const cleanup = () => { this.ov.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
      this.ov.addEventListener('pointerdown', go); window.addEventListener('keydown', go);
    });
  }

  mainMenu() {
    const meta = this.meta;
    const coins = meta ? meta.coins : 0;
    const badge = meta ? meta.claimableCount() : 0;
    const title = meta ? meta.titleText() : null;
    this._set(`
      <div class="coinbar">🪙 <b>${coins}</b>${title ? `<span class="ttl">「${title}」</span>` : ''}</div>
      <h2>モード選択</h2><div class="sub">MODE SELECT</div>
      <div class="btns">
        <div class="mbtn feat" data-m="online">🌐 オンライン対戦<small>部屋コードでフレンドと P2P 1v1 ・ おすすめ</small></div>
        <div class="mbtn" data-m="arcade">アーケード<small>連戦で勝ち抜く ・ 敵は少しずつ強くなる</small></div>
        <div class="mbtn" data-m="survival">🔥 サバイバル<small>HP持ち越しのエンドレス連戦 ・ 何人抜ける？</small></div>
        <div class="mbtn" data-m="vscpu">対CPU（1戦）<small>キャラ・難易度を選んで1試合</small></div>
        <div class="mbtn" data-m="gacha">🎰 ガチャ<small>コインで称号・エフェクト・ステージスキンを入手</small></div>
        <div class="mbtn" data-m="missions">📜 ミッション${badge ? `<span class="nbadge">${badge}</span>` : ''}<small>デイリー/実績をクリアしてコインを稼ぐ</small></div>
        <div class="mbtn" data-m="local2p">ローカル2P<small>同一PCで2人対戦（キーボード）</small></div>
        <div class="mbtn" data-m="training">トレーニング<small>サンドバッグ・判定/フレーム表示</small></div>
        <div class="mbtn" data-m="demo">👀 観戦モード<small>CPU同士の対戦をながめる（自動連戦）</small></div>
        <div class="mbtn" data-m="help">📖 遊び方<small>操作・コンボ・投げ・カウンターの解説</small></div>
        <div class="mbtn" data-m="options">オプション<small>ジャイロ/音/演出/操作</small></div>
      </div>`);
    return this._pick('[data-m]', (el) => el.dataset.m);
  }

  // 遊び方（操作・コンボ・投げ・カウンターの解説）。← 戻る で閉じる。
  help() {
    const row = (k, v) => `<div class="hrow"><div class="hk">${k}</div><div class="hv">${v}</div></div>`;
    this._set(`
      <h2>遊び方</h2><div class="sub">HOW TO PLAY</div>
      <div class="help">
        <div class="hsec">基本操作</div>
        ${row('移動', '左スティック（前後左右）。<b>ジャンプ</b>ボタンで跳躍。')}
        ${row('パンチ / キック', '<b>P</b>（パンチ）/ <b>K</b>（キック）。それぞれ <b>上・中・下段</b>の3ボタン。')}
        ${row('段の読み合い', '上段＝立ちガード / 下段＝しゃがみガード（下＋G）。段をズラして崩す。')}
        <div class="hsec">コンボ・崩し</div>
        ${row('オートコンボ', '同じボタンを<b>連打</b>で自動で繋がる。中Pを連打＝ジャブ→ストレート→フック→<b>フィニッシュ(アッパー打上げ)</b>。')}
        ${row('投げ', '<b>投ボタン</b>（または P＋K 同時）。<b>ガード不能</b>。接近戦の崩しに。')}
        ${row('ガード', '<b>G</b>を押しっぱなしで防御。相手の段に合わせて立ち/しゃがみ。')}
        <div class="hsec">必殺・ウルトラ</div>
        ${row('必殺技 (S)', '<b>S</b>ボタン。飛び道具・突進など（ゲージを消費）。')}
        ${row('ウルトラ (SUPER)', 'ゲージMAXで<b>SUPER</b>が点灯→大ダメージの一発逆転技。')}
        <div class="hsec">駆け引きのコツ</div>
        ${row('カウンター', '相手の技の<b>出かかり</b>に攻撃を当てると<b>カウンターヒット＝1.3倍ダメージ</b>。')}
        ${row('クリティカル', '打撃は<b>8%でクリティカル＝1.5倍</b>。金色の炸裂が出たら大チャンス。')}
        ${row('リスクとリターン', '弱攻撃＝速い/低ダメ/安全。強攻撃＝遅い/高ダメだが<b>スカると大反撃</b>。状況で使い分け。')}
        <div class="hsec">やり込み・ごほうび</div>
        ${row('コイン', '試合・ミッション・ログインで貯まる。<b>🎰 ガチャ</b>で称号/エフェクト/ステージスキン/魔法を入手。')}
        ${row('魔法（ガチャ）', 'ガチャで当てた魔法（⚡🔥❄）を装備すると、試合中に<b>✨ボタン（キーボード O）</b>で発動。<b>1試合2回まで・1発で残数-1</b>。オフラインモード専用。')}
        ${row('デイリーミッション', '毎日3件更新。<b>📜 ミッション</b>から受取を忘れずに。')}
        ${row('サバイバル', 'HP持ち越しのエンドレス連戦。勝つたび<b>25%回復</b>、敵はどんどん強くなる。')}
        ${row('アーケード', '連戦で勝ち抜き。敵は1戦ごとに強化され、<b>全員倒すとエンディング</b>。')}
        <div class="hsec">キーボード（PC）</div>
        ${row('操作', '移動=WASD / P=J / K=K / 必殺=U / ガード=L / ジャンプ=Space / ウルトラ=I / 投げ=J＋K同時。')}
      </div>
      <div class="btns"><div class="mbtn" data-m="back">← 戻る</div></div>`);
    return this._pick('[data-m]', () => 'back');
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
        <div class="opt"><span>グロー効果（Bloom・高画質）</span><div class="toggle ${s.bloom ? 'on' : ''}" data-k="bloom">${s.bloom ? 'ON' : 'OFF'}</div></div>
        <div class="opt"><span>当たり判定表示（H）</span><div class="toggle ${s.debug ? 'on' : ''}" data-k="debug">${s.debug ? 'ON' : 'OFF'}</div></div>
      </div>
      <div class="row"><div class="mbtn" data-back2 style="min-width:200px">閉じる</div></div>`);
    return new Promise((res) => {
      w.querySelectorAll('.toggle').forEach((t) => t.addEventListener('pointerdown', (e) => {
        e.preventDefault(); const k = t.dataset.k;
        if (k === 'sound') { s.muted = !s.muted; audio && audio.setMuted(s.muted); t.classList.toggle('on', !s.muted); t.textContent = !s.muted ? 'ON' : 'OFF'; }
        else if (k === 'gyro') { s.gyro = !s.gyro; t.classList.toggle('on', s.gyro); t.textContent = s.gyro ? 'ON' : 'OFF'; if (this.onGyroToggle) this.onGyroToggle(s.gyro); }
        else if (k === 'intensity') { s.intensity = s.intensity >= 1.5 ? 0.6 : s.intensity >= 1 ? 1.5 : 1; t.textContent = intensityLabel(s.intensity); if (this.onIntensity) this.onIntensity(s.intensity); }
        else if (k === 'bloom') { s.bloom = !s.bloom; t.classList.toggle('on', s.bloom); t.textContent = s.bloom ? 'ON' : 'OFF'; }
        else if (k === 'debug') { s.debug = !s.debug; t.classList.toggle('on', s.debug); t.textContent = s.debug ? 'ON' : 'OFF'; onDebug && onDebug(s.debug); }
      }));
      const back = () => res();
      w.querySelector('[data-back]').addEventListener('pointerdown', (e) => { e.preventDefault(); back(); });
      w.querySelector('[data-back2]').addEventListener('pointerdown', (e) => { e.preventDefault(); back(); });
    });
  }

  // ---- ガチャ画面（ホーム→抽選演出→結果、コレクション装備）----
  async gachaScreen(meta, audio) {
    for (;;) {
      const owned = meta.owned();
      const colHtml = ['spell', 'title', 'spark', 'confetti', 'stageskin'].map((kind) => {
        const items = owned.filter((i) => i.kind === kind);
        if (!items.length) return '';
        return `<h3>${KIND_LABEL[kind]}</h3><div class="colgrid">` + items.map((i) => {
          const eq = kind === 'stageskin' ? meta.equipped.stage[i.stage] === i.id : meta.equipped[kind] === i.id;
          const ch = kind === 'spell' ? `　残 <b>${meta.spellCharges(i.spell)}</b>` : '';
          return `<div class="colitem ${eq ? 'on' : ''}" data-eq="${i.id}"><span class="cr" style="color:${RARITY[i.rar].color}">${i.rar}</span>${i.name}${ch}${eq ? ' ✓' : ''}</div>`;
        }).join('') + '</div>' +
        (kind === 'spell' ? '<div style="opacity:.55;font-size:11px;margin:4px 0 2px">装備した魔法は試合中に ✨ボタン（キーボード O）で発動。1試合2回まで・1発動で残数-1。オフラインモード（アーケード/サバイバル/対CPU/トレーニング）専用。</div>' : '');
      }).join('');
      this._set(`<button class="back" data-back>← 戻る</button>
        <div class="coinbar">🪙 <b>${meta.coins}</b></div>
        <h2>🎰 ガチャ</h2><div class="sub">GACHA ・ 称号 / エフェクト / ステージスキン</div>
        <div class="gwrap">
          <div class="gpulls">
            <div class="gpull ${meta.coins >= GACHA_COST ? '' : 'off'}" data-g="1">単発を引く<small>🪙 ${GACHA_COST}</small></div>
            <div class="gpull ten ${meta.coins >= GACHA_10_COST ? '' : 'off'}" data-g="10">10連を引く<small>🪙 ${GACHA_10_COST} ・ R以上1枠確定</small></div>
          </div>
          <div class="pity">SR以上確定（天井）まで あと <b>${SR_PITY - meta.d.pity}</b> 回 ・ コインは試合やミッションで貯まります</div>
          <div class="colsec">${colHtml}<div style="opacity:.5;font-size:11px;margin-top:12px">アイテムをタップで装備/解除。新しく当てたアイテムは自動で装備されます。</div></div>
        </div>`);
      const act = await this._pick('[data-g],[data-back],[data-eq]', (el) => {
        if (el.dataset.back !== undefined) return '__back';
        if (el.dataset.eq) return { eq: el.dataset.eq };
        return parseInt(el.dataset.g, 10);
      });
      if (act === '__back') return;
      if (act && act.eq) {
        // 装備トグル
        const item = getPoolItem(act.eq);
        if (item) {
          if (item.kind === 'stageskin') meta.equipStage(item.stage, meta.equipped.stage[item.stage] === item.id ? null : item.id);
          else meta.equip(item.kind, meta.equipped[item.kind] === item.id ? null : item.id);
          audio && audio.menuSelect();
        }
        continue;
      }
      const res = meta.gachaPull(act);
      if (!res) { this.toast('コインが足りません（試合やミッションで貯めよう）'); continue; }
      audio && audio.menuSelect();
      await this._gachaReveal(res, audio);
    }
  }

  // 抽選演出: カプセルが落ちて震えて開く → カードが順に舞い込む。SR/UR はファンファーレ。
  _gachaReveal(results, audio) {
    const best = results.reduce((a, b) => (RAR_ORDER[b.rar] > RAR_ORDER[a.rar] ? b : a));
    const w = this._set(`<h2>GACHA</h2><div class="sub">お楽しみ抽選中…</div>
      <div class="gcap" id="gcap"><div class="top"></div><div class="bot"></div></div>
      <div class="gcards" id="gcards" style="display:none"></div>
      <div class="row" id="gok" style="display:none"><div class="mbtn" data-gok style="min-width:200px">OK</div></div>`);
    return new Promise((res) => {
      const cap = w.querySelector('#gcap');
      setTimeout(() => { if (cap.isConnected) { cap.classList.add('open'); audio && audio.superSfx && audio.superSfx(); } }, 1500);
      setTimeout(() => {
        if (!cap.isConnected) return;
        cap.style.display = 'none';
        const cards = w.querySelector('#gcards'); cards.style.display = '';
        cards.innerHTML = results.map((r, i) => {
          const it = r.item;
          const sub = r.coins ? `+${r.coins} 🪙`
            : r.charges ? `+${r.charges} チャージ`
            : r.refund ? `かぶり → +${r.refund} 🪙`
            : (it.kind === 'stageskin' ? 'ステージスキン' : KIND_LABEL[it.kind] || '');
          return `<div class="gcard rar-${r.rar}" style="animation-delay:${i * 0.12}s">
            <div class="rar" style="color:${RARITY[r.rar].color}">${r.rar}${r.isNew ? '<span class="gnewtag">NEW</span>' : ''}</div>
            <div class="gic">${KIND_ICON[it.kind] || '🎁'}</div>
            <div class="gnm">${it.name}</div>
            <div class="gsub">${sub}</div></div>`;
        }).join('');
        w.querySelector('#gok').style.display = '';
        if ((best.rar === 'SR' || best.rar === 'UR') && audio && audio.victory) audio.victory();
      }, 2000);
      const onUp = (e) => {
        const el = e.target.closest('[data-gok]');
        if (!el) return;
        e.preventDefault();
        this.ov.removeEventListener('pointerup', onUp);
        res();
      };
      this.ov.addEventListener('pointerup', onUp);
    });
  }

  // ---- ミッション/実績/戦績画面 ----
  async missionsScreen(meta, audio) {
    for (;;) {
      const ms = meta.missions(); const as = meta.achievements(); const st = meta.stats();
      const row = (m, key) => {
        const pct = Math.round(100 * m.progress / m.target);
        const btn = m.claimed ? '<div class="mclaim done">受取済 ✓</div>'
          : m.done ? `<div class="mclaim" data-claim="${key}:${m.id}">🪙 ${m.reward} 受取</div>`
          : `<div class="mclaim off">🪙 ${m.reward}</div>`;
        return `<div class="mrow"><div class="ml"><div class="mt">${m.label}</div>
          <div class="bar2"><div style="width:${pct}%"></div></div>
          <div class="mp">${m.progress} / ${m.target}</div></div>${btn}</div>`;
      };
      this._set(`<button class="back" data-back>← 戻る</button>
        <div class="coinbar">🪙 <b>${meta.coins}</b></div>
        <h2>📜 ミッション</h2><div class="sub">DAILY & ACHIEVEMENTS</div>
        <div class="colsec" style="margin-top:4px">
          <h3>デイリーミッション（毎日更新）</h3>${ms.map((m) => row(m, 'd')).join('')}
          <h3>実績</h3>${as.map((a) => row(a, 'a')).join('')}
          <h3>戦績</h3>
          <div class="mrow"><div class="ml" style="font-size:13px;line-height:2">
            通算勝利 <b>${st.win || 0}</b> ・ 試合数 <b>${st.play || 0}</b> ・ KO <b>${st.ko || 0}</b><br>
            クリティカル <b>${st.crit || 0}</b> ・ カウンター <b>${st.counter || 0}</b> ・ 投げ <b>${st.throw || 0}</b><br>
            最大コンボ <b>${st.comboBest || 0}</b> ・ サバイバル最高 <b>${st.survivalBest || 0}人抜き</b> ・ アーケードクリア <b>${st.arcadeClear || 0}回</b>
          </div></div>
        </div>`);
      const act = await this._pick('[data-claim],[data-back]', (el) => (el.dataset.back !== undefined ? '__back' : el.dataset.claim));
      if (act === '__back') return;
      const sep = act.indexOf(':');
      const got = act.slice(0, sep) === 'd' ? meta.claimMission(act.slice(sep + 1)) : meta.claimAchievement(act.slice(sep + 1));
      if (got > 0) { audio && audio.victory && audio.victory(); this.toast(`🪙 +${got} コイン獲得！`); }
    }
  }

  // extra = { rank, rankColor, coins, breakdown:[{label,amount}] }（省略可）。
  // rank はバウンド演出、coins は 0→総額のカウントアップ演出で「稼いだ感」を出す。
  result(winText, color, lines = [], buttons = [{ id: 'rematch', label: '再戦' }, { id: 'menu', label: 'メニューへ' }], extra = null) {
    const btns = buttons.map((b) => `<div class="mbtn" data-r="${b.id}" style="min-width:160px">${b.label}</div>`).join('');
    const rankHtml = extra && extra.rank
      ? `<div class="rank" style="color:${extra.rankColor || '#ffd24a'}">${extra.rank}</div>` : '';
    const coinHtml = extra && extra.coins
      ? `<div class="coinget">🪙 <span class="cnum" id="rcoin">0</span> 獲得
           ${extra.breakdown ? `<div class="cbr">${extra.breakdown.map((b) => `${b.label} +${b.amount}`).join(' ・ ')}</div>` : ''}</div>` : '';
    this._set(`<div class="result">
      ${rankHtml}
      <div class="big" style="color:${color}">${winText}</div>
      <div class="sub" style="margin-top:14px">${lines.join(' · ')}</div>
      ${coinHtml}
      <div class="row">${btns}</div></div>`);
    if (extra && extra.coins) {
      const el = this.ov.querySelector('#rcoin');
      const t0 = performance.now(); const dur = 900;
      const tick = (t) => {
        if (!el || !el.isConnected) return;
        const k = Math.min(1, (t - t0) / dur);
        el.textContent = Math.round(extra.coins * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
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
