// =====================================================================
// NOVA CLASH — エントリ / オーケストレーション。
// 決定論コア(sim) を固定60fpsで回し、描画(three)・UI・入力・AI を統合する。
// モード: アーケード / 対CPU / ローカル2P / トレーニング。
// =====================================================================

import * as THREE from 'three';
import { DT, CONFIG, ST } from './core/constants.js?v=1794449214';
import { Match, emptyIntent, SPELL_USES_PER_MATCH } from './core/sim.js?v=1794449214';
import { FighterAI } from './core/ai.js?v=1794449214';
import { loadRegistry } from './data/registry.js?v=1794449214';
import { STAGES, getStage } from './data/stages.js?v=1794449214';
import { FighterView } from './render/fighterView.js?v=1794449214';
import { GameCamera } from './render/camera.js?v=1794449214';
import { StageView } from './render/stageView.js?v=1794449214';
import { FX } from './render/fx.js?v=1794449214';
import { AudioKit } from './render/audio.js?v=1794449214';
import { HUD } from './ui/hud.js?v=1794449214';
import { GameUI } from './ui/menus.js?v=1794449214';
import { Controller, Keyboard, KEYMAP_P1, KEYMAP_P2, buildIntent, heldOnly } from './input/controls.js?v=1794449214';
import { TouchControls, isTouchDevice } from './input/touch.js?v=1794449214';
import { GyroControls } from './input/gyro.js?v=1794449214';
import { NetGame } from './net/online.js?v=1794449214';
import { AnimLibrary } from './anim_library.js?v=1794449214';
import { attachWeapon } from './weapon.js?v=1794449214';
import { MetaGame } from './meta.js?v=1794449214';
import { EffectComposer } from '../lib/postprocessing/EffectComposer.js?v=1794449214';
import { RenderPass } from '../lib/postprocessing/RenderPass.js?v=1794449214';
import { UnrealBloomPass } from '../lib/postprocessing/UnrealBloomPass.js?v=1794449214';
import { OutputPass } from '../lib/postprocessing/OutputPass.js?v=1794449214';

// 勝利ポーズの複数パターン（ダンス / カポエイラ / 派手な蹴り）。ラウンドで切替。
const VICTORY_POSES = ['win_dance', 'win_capoeira', 'win_kick'];

// ---------- エージェント（per-side の意思決定） ----------
class HumanAgent {
  constructor(c) { this.c = c; this.frameI = emptyIntent(); this.step = 0; }
  beginFrame() { this.frameI = buildIntent(this.c); this.step = 0; }
  tick() { const i = this.step === 0 ? this.frameI : heldOnly(this.frameI); this.step++; return i; }
}
class AIAgent {
  constructor(diff) { this.ai = new FighterAI(diff); }
  beginFrame() {} tick(self, opp, match) { return this.ai.decide(self, opp, match); }
}
class DummyAgent {
  constructor(mode) { this.mode = mode; this.ai = new FighterAI(0); }
  beginFrame() {}
  tick(self, opp, match) {
    if (this.mode === 'guard') return { ...emptyIntent(), guard: true };
    if (this.mode === 'cpu') return this.ai.decide(self, opp, match);
    return emptyIntent();
  }
}

class Game {
  constructor() {
    // --- レンダラ/シーン ---
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    this.renderer.setPixelRatio(Math.min(this.coarse ? 1.5 : 2, window.devicePixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(this.renderer.domElement);
    this.cam = new GameCamera(window.innerWidth / window.innerHeight);

    // ピンチ/ダブルタップ拡大抑止（iOS）
    ['gesturestart', 'gesturechange', 'gestureend'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));
    document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

    // --- UI / 音 / メタ進行（コイン・ミッション・ガチャ）---
    this.ui = new GameUI();
    this.audio = new AudioKit();
    this.hud = new HUD(); this.hud.el.style.display = 'none';
    this.meta = new MetaGame();          // localStorage 永続（コスメティックのみ＝対戦バランス非干渉）
    this.ui.meta = this.meta;

    // --- ポストプロセス（Bloom＝ネオン発光。モバイルは性能優先で既定OFF・オプションで切替）---
    this.ui.settings.bloom = !this.coarse;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.cam.cam));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.45, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // --- 入力 ---
    this.c1 = new Controller(); this.c2 = new Controller();
    this.kb1 = new Keyboard(this.c1, KEYMAP_P1);
    this.kb2 = new Keyboard(this.c2, KEYMAP_P2);
    this.touch = isTouchDevice() ? new TouchControls(this.c1) : null;
    if (this.touch) this.touch.show(false);
    this.gyro = new GyroControls(this.c1);
    this.ui.onGyroToggle = (on) => { if (on) this.gyro.enable().then((ok) => { if (!ok) this.ui.toast('ジャイロ許可が得られませんでした（スティックで操作可）'); }); else this.gyro.disable(); };
    this.ui.onIntensity = (v) => { this.cam.intensity = v; };

    // 演出/状態
    this.match = null; this.stageView = null; this.views = []; this.fx = null;
    this.agents = [null, null]; this.running = false; this.paused = false;
    this.facingOffset = 0; this.events = [];
    this._bindGlobalKeys();
    window.addEventListener('resize', () => this._onResize());

    // 最初の操作でオーディオ resume ＋ 全画面化 ＋ ジャイロ許可要求（iOSはユーザ操作内必須）
    const resume = () => {
      this.audio.resume(); this._tryFullscreen();
      // ジャイロ既定ON: 最初のタップ（ユーザ操作）の中で許可を要求＝iOSの活性化要件を満たす（タッチ端末のみ）
      if (!this._gyroArmed && this.ui.settings.gyro && this.touch) {
        this._gyroArmed = true;
        this.gyro.enable().then((ok) => { if (!ok) this.ui.toast('ジャイロ許可が得られませんでした（スティックで操作可）'); });
      }
    };
    window.addEventListener('pointerdown', resume, { once: false });
    window.addEventListener('keydown', resume, { once: false });
  }

  _tryFullscreen() {
    if (this._fsTried) return; this._fsTried = true;
    try {
      const el = document.documentElement;
      const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
      if (fn) { const r = fn.call(el); if (r && r.catch) r.catch(() => {}); }
    } catch (e) { /* iOS Safari は未対応＝ホーム画面追加で全画面 */ }
    setTimeout(() => { try { window.scrollTo(0, 1); } catch (e) {} }, 80);
  }

  // iOS のブラウザ内（非スタンドアロン）では Fullscreen API が効かないので案内を出す
  _maybeHomeScreenHint() {
    const standalone = window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    const iOS = /iP(hone|od|ad)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const touch = this.coarse || ('ontouchstart' in window);
    if (standalone || !touch || !iOS) return;
    if (sessionStorage.getItem('nc_hs_hint')) return;
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:200;background:rgba(10,16,30,.94);color:#eaf2ff;' +
      'font-size:13px;line-height:1.4;padding:10px 38px 10px 14px;text-align:center;' +
      'font-family:-apple-system,sans-serif;border-bottom:1px solid #2a3a5e;padding-top:max(10px,env(safe-area-inset-top))';
    el.innerHTML = '📲 全画面（URLバー無し）で遊ぶ: <b>共有ボタン → ホーム画面に追加</b> → ホームのアイコンから起動';
    const x = document.createElement('div');
    x.textContent = '✕';
    x.style.cssText = 'position:absolute;right:12px;top:50%;transform:translateY(-50%);cursor:pointer;opacity:.7;font-size:16px;pointer-events:auto';
    x.onclick = () => { el.remove(); sessionStorage.setItem('nc_hs_hint', '1'); };
    el.appendChild(x); document.body.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 14000);
  }

  _bindGlobalKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyH') CONFIG.DEBUG_BOXES = !CONFIG.DEBUG_BOXES;
      if (e.code === 'KeyF' && this.running) { // 向き補正の手動合わせ（新キャラ調整用）
        const steps = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
        this.facingOffset = steps[(steps.indexOf(this.facingOffset) + 1) % steps.length];
        for (const v of this.views) v.facingOffset = this.facingOffset;
        this.ui.toast('facingOffset = ' + Math.round(this.facingOffset * 180 / Math.PI) + '°');
      }
      if ((e.code === 'Escape' || e.code === 'KeyP') && this.running && !(this.match && this.match.canProceed)) this._togglePause();
    });
  }

  // KO演出後：「次へ」と「メニューに戻る」の2択を表示
  _armContinue() {
    if (this._continueArmed) return;
    this._continueArmed = true;
    const isMatch = this.match.matchWinner >= 0;
    const el = document.createElement('div');
    el.id = 'nc-continue';
    el.style.cssText = 'position:fixed;left:50%;bottom:15%;transform:translateX(-50%);z-index:65;display:flex;gap:14px;pointer-events:auto';
    const mk = (label, primary, cb) => {
      const b = document.createElement('div');
      b.textContent = label;
      b.style.cssText = 'padding:12px 22px;border-radius:12px;font-weight:800;font-size:16px;cursor:pointer;color:#fff;' +
        'border:2px solid ' + (primary ? '#6cf' : '#5a6c93') + ';background:' +
        (primary ? 'linear-gradient(180deg,#2b6fd0,#1e4f9e)' : 'rgba(18,26,46,.88)') + ';box-shadow:0 4px 16px rgba(0,0,0,.45)';
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); cb(); });
      return b;
    };
    el.appendChild(mk(isMatch ? '▶ 結果へ' : '▶ 次のラウンドへ', true, () => { this._disarmContinue(); if (this.match.proceed()) this.audio.menuSelect(); }));
    el.appendChild(mk('メニューに戻る', false, () => { this.audio.menuSelect(); this._disarmContinue(); this._returnToMenu(); }));
    document.body.appendChild(el);
    this._continueEl = el;
  }
  _disarmContinue() {
    this._continueArmed = false;
    if (this._continueEl) { this._continueEl.remove(); this._continueEl = null; }
    this.hud.hideContinue();
  }
  // 試合を中断してメニューへ（ループを解決して _playMatch を抜ける）
  _returnToMenu() {
    this._abortMatch = true;
    this.running = false;
    cancelAnimationFrame(this._raf);
    if (this._resolvePause) this._resolvePause(-1);
  }

  // 観戦モード中の常設ボタン（⏩ 次の試合へスキップ / ⏹ 観戦終了）
  _armDemoControls() {
    if (this._demoCtlEl) return;
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:max(10px,env(safe-area-inset-top));right:12px;z-index:66;display:flex;gap:8px;pointer-events:auto';
    const mk = (label, cb) => {
      const b = document.createElement('div');
      b.textContent = label;
      b.style.cssText = 'padding:8px 14px;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer;color:#eaf2ff;' +
        'border:1px solid rgba(170,200,255,.4);background:rgba(14,22,40,.82);box-shadow:0 2px 10px rgba(0,0,0,.4)';
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); cb(); });
      return b;
    };
    // ポーズ中は無効（ポーズメニューの _pick リスナーを未解決のまま孤児化させない）
    el.appendChild(mk('⏩ 次の試合', () => { if (this.paused) return; this._demoSkip = true; this.audio.menuSelect(); this._returnToMenu(); }));
    el.appendChild(mk('⏹ 終了', () => { if (this.paused) return; this.audio.menuSelect(); this._returnToMenu(); }));
    document.body.appendChild(el);
    this._demoCtlEl = el;
  }
  _disarmDemoControls() {
    if (this._demoCtlEl) { this._demoCtlEl.remove(); this._demoCtlEl = null; }
  }

  // ================= メニュー フロー =================
  async boot() {
    const ld = this.ui.loading('アセット読込');
    try {
      const reg = await loadRegistry('./assets/registry.json');
      this.roster = reg.roster; this.assetVersion = reg.assetVersion;
      ld.set(0.4, 'マニフェスト');
      const res = await fetch('./assets/anim/manifest.json'); this.manifest = await res.json();
      ld.set(1, '完了');
    } catch (e) {
      console.error(e); this.ui.toast('初期化エラー: ' + (e.message || e));
    }
    this._maybeHomeScreenHint();
    // ログインボーナス（meta が日次ロールオーバーで付与済み → 通知だけ出す）
    if (this.meta && this.meta.loginBonus) {
      const b = this.meta.loginBonus;
      this.ui.toast(`🎁 ログインボーナス +${b.coins} コイン！（${b.streak}日連続）`, 3200);
    }
    this._mainFlow();
  }

  async _mainFlow() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      this._startTitleShowcase();          // タイトル背後で3Dキャラがゆっくり回る
      await this.ui.title();
      this._stopTitleShowcase();
      this.audio.resume(); this.audio.startMusic();
      let back = false;
      while (!back) {
        // 日付が変わっていたらミッション再抽選＋ログインボーナス（長時間セッション対応）
        if (this.meta) {
          const b = this.meta._rolloverDaily();
          if (b) this.ui.toast(`🎁 ログインボーナス +${b.coins} コイン！（${b.streak}日連続）`, 3200);
        }
        const mode = await this.ui.mainMenu();
        if (mode === 'options') { await this.ui.options(this.audio, (d) => { CONFIG.DEBUG_BOXES = d; }); continue; }
        if (mode === 'help') { await this.ui.help(); continue; }
        if (mode === 'online') { await this._runOnline(); continue; }
        if (mode === 'demo') { await this._runDemo(); continue; }
        if (mode === 'gacha') { await this.ui.gachaScreen(this.meta, this.audio); continue; }
        if (mode === 'missions') { await this.ui.missionsScreen(this.meta, this.audio); continue; }
        if (mode === 'survival') { await this._runSurvival(); continue; }
        const setup = await this._configureMatch(mode);
        if (!setup) continue; // 戻る
        await this._runMode(mode, setup);
      }
    }
  }

  // モード別のキャラ/ステージ/難易度選択
  async _configureMatch(mode) {
    const pick = async (title, accent, sub) => {
      return await this._pickCharacter({ title, accent, sub });
    };
    let p1 = await pick('1P キャラクター選択', '#7cf', 'PLAYER 1');
    if (p1 === '__back') return null;
    let p2 = null, difficulty = this.ui.settings.difficulty, dummy = null;

    if (mode === 'local2p') {
      p2 = await pick('2P キャラクター選択', '#f86', 'PLAYER 2');
      if (p2 === '__back') return null;
    } else if (mode === 'vscpu') {
      p2 = await pick('対戦相手（CPU）', '#f86', 'OPPONENT');
      if (p2 === '__back') return null;
      const d = await this.ui.selectDifficulty(); if (d === '__back') return null; difficulty = d; this.ui.settings.difficulty = d;
    } else if (mode === 'training') {
      p2 = await pick('ダミー', '#aaa', 'DUMMY');
      if (p2 === '__back') return null;
      dummy = await this.ui.trainingOptions(); if (dummy === '__back') return null;
    } else if (mode === 'arcade') {
      const d = await this.ui.selectDifficulty(); if (d === '__back') return null; difficulty = d; this.ui.settings.difficulty = d;
    }
    const stage = await this.ui.selectStage(STAGES);
    if (stage === '__back') return null;
    return { p1, p2, difficulty, dummy, stage };
  }

  async _runMode(mode, setup) {
    if (mode === 'arcade') return this._runArcade(setup);
    // 単発（vscpu / local2p / training）
    const a = setup.p1, b = setup.p2;
    const agent0 = new HumanAgent(this.c1);
    let agent1;
    if (mode === 'local2p') agent1 = new HumanAgent(this.c2);
    else if (mode === 'training') agent1 = new DummyAgent(setup.dummy);
    else agent1 = new AIAgent(setup.difficulty);
    const r = await this._playMatch(a, b, setup.stage, agent0, agent1, { mode, training: mode === 'training' });
    // リザルト
    if (r.aborted) {
      // KO決着後に「メニューに戻る」を選んだ場合でも勝利報酬は取りこぼさない
      if (mode === 'vscpu' && this.meta && this.match.matchWinner === 0) {
        const rk = this._rankOf(true, 0);
        const aw = this.meta.onMatchEnd({ mode, won: true, perfect: rk.perfect, roundsLost: this.match.wins[1] });
        this.ui.toast(`🪙 +${aw.coins}`, 1800);
      }
      return;
    }
    if (mode === 'training') return;
    const won = r.winner === 0;
    // メタ報酬＋ランク評価（vscpu のみ。local2p はカウチ対戦なので成績・コイン対象外）
    let extra = null;
    if (mode === 'vscpu' && this.meta) {
      const rk = this._rankOf(won, 0);
      const award = this.meta.onMatchEnd({ mode, won, perfect: rk.perfect, roundsLost: this.match.wins[1] });
      extra = { rank: rk.rank, rankColor: rk.color, coins: award.coins, breakdown: award.breakdown };
    }
    const action = await this.ui.result(
      mode === 'local2p' ? (won ? '1P WIN' : '2P WIN') : (won ? 'YOU WIN' : 'YOU LOSE'),
      won ? '#7fe' : '#f86',
      [`${a.name} vs ${b.name}`, setup.stage.nameJa],
      [{ id: 'rematch', label: '再戦' }, { id: 'menu', label: 'メニューへ' }], extra);
    if (action === 'rematch') return this._runMode(mode, setup);
  }

  // 試合結果のランク評価（S/A/B/C/D）。pi=プレイヤー側 index。
  _rankOf(won, pi) {
    const you = this.match.fighters[pi];
    const hpr = you.hp / you.maxHp;
    const straight = this.match.wins[1 - pi] === 0;
    const perfect = won && straight && hpr >= 0.999;
    if (!won) {
      const opp = this.match.fighters[1 - pi];
      return { rank: opp.hp / opp.maxHp < 0.3 ? 'C' : 'D', color: '#8aa0b8', perfect: false };
    }
    if (perfect) return { rank: 'S', color: '#ffd24a', perfect };
    if (straight && hpr >= 0.6) return { rank: 'S', color: '#ffd24a', perfect };
    if (hpr >= 0.5) return { rank: 'A', color: '#7fe', perfect };
    if (hpr >= 0.2) return { rank: 'B', color: '#7cf', perfect };
    return { rank: 'B', color: '#7cf', perfect };
  }

  async _runArcade(setup) {
    const player = setup.p1;
    const pool = this.roster.filter((c) => c.id !== player.id);
    const order = []; const rng = (() => { let s = 7; return () => (s = (s * 9301 + 49297) % 233280) / 233280; })();
    const shuffled = pool.slice().sort(() => rng() - 0.5);
    for (const c of shuffled) order.push(c);
    const N = order.length;
    let stage = setup.stage; let beaten = 0;
    for (let i = 0; i < N; i++) {
      const opp = order[i];
      const isBoss = i === N - 1;
      // ステージ毎の敵強化: AIレベルは基礎難易度から +1.0 まで連続上昇（上限HARD）、
      // 敵の HP +5%/戦・攻撃力 +4%/戦。ボスはさらに上乗せ＝ラスボス感。
      const t = N > 1 ? i / (N - 1) : 1;
      const diff = Math.min(2, setup.difficulty + t * 1.0 + (isBoss ? 0.4 : 0));
      const hpMul = 1 + 0.05 * i + (isBoss ? 0.15 : 0);
      const dmgMul = 1 + 0.04 * i + (isBoss ? 0.10 : 0);
      const mods = [null, { hp: hpMul, dmg: dmgMul }];
      const powTag = i > 0 || isBoss ? ` ・ 敵強化 +${Math.round((hpMul - 1) * 100)}%` : '';
      const r = await this._playMatch(player, opp, stage, new HumanAgent(this.c1), new AIAgent(diff),
        { mode: 'arcade', boss: isBoss, mods, bannerSub: (isBoss ? '⚠ 最終戦 BOSS' : `戦 ${i + 1}/${N}`) + powTag });
      if (r.aborted) {
        // 勝利確定後の離脱でも報酬は付与（取りこぼし防止）
        if (this.meta && this.match.matchWinner === 0) {
          const aw = this.meta.onMatchEnd({ mode: 'arcade', won: true });
          this.ui.toast(`🪙 +${aw.coins}`, 1800);
        }
        return;
      }
      if (r.winner !== 0) {
        let extra = null;
        if (this.meta) {
          const award = this.meta.onMatchEnd({ mode: 'arcade', won: false });
          extra = { coins: award.coins, breakdown: award.breakdown };
        }
        const act = await this.ui.result('YOU LOSE', '#f86', [`${beaten} 人撃破`, `${N} 人中`],
          [{ id: 'rematch', label: 'コンティニュー' }, { id: 'menu', label: 'メニューへ' }], extra);
        if (act === 'rematch') { i--; continue; } else return;
      }
      beaten++;
      // 勝利報酬（コイン）をその場で加算＝連戦のテンポを崩さずトーストで通知
      if (this.meta) {
        const rk = this._rankOf(true, 0);
        const award = this.meta.onMatchEnd({ mode: 'arcade', won: true, perfect: rk.perfect, roundsLost: this.match.wins[1] });
        this.ui.toast(`🪙 +${award.coins}（ランク ${rk.rank}）`, 1600);
      }
      stage = STAGES[(STAGES.indexOf(stage) + 1) % STAGES.length]; // 次戦は別ステージ
    }
    // 全員撃破 → 実績記録 → 3D エンディング（カーテンコール→主役の勝利ステージ）
    if (this.meta) this.meta.track('arcadeClear');
    await this._arcadeEnding(player, order);
  }

  // ================= サバイバルモード（HP持ち越しエンドレス連戦） =================
  async _runSurvival() {
    const player = await this._pickCharacter({ title: 'サバイバル キャラクター選択', accent: '#f96', sub: 'SURVIVAL ・ HPは次の試合へ持ち越し' });
    if (player === '__back') return;
    const stage0 = await this.ui.selectStage(STAGES);
    if (stage0 === '__back') return;
    for (;;) {   // リトライループ
      let kills = 0, carriedHp = null, lastOppId = null;
      let stage = stage0;
      for (;;) { // 連戦ループ
        const pool = this.roster.filter((c) => c.id !== player.id && c.id !== lastOppId);
        const opp = pool.length ? pool[(Math.random() * pool.length) | 0] : this.roster.find((c) => c.id !== player.id);
        if (!opp) { this.ui.toast('対戦相手がいません'); return; }
        lastOppId = opp.id;
        // 敵は1人抜くごとに強くなる（AI+0.15/人、HP+4%/人、攻+3%/人）
        const diff = Math.min(2, 0.7 + kills * 0.15);
        const mods = [null, { hp: 1 + 0.04 * kills, dmg: 1 + 0.03 * kills }];
        const r = await this._playMatch(player, opp, stage, new HumanAgent(this.c1), new AIAgent(diff), {
          mode: 'survival', mods, seed: 1 + ((Math.random() * 0x7fffffff) | 0),
          roundsToWin: 1, startHp0: carriedHp,
          bannerSub: `SURVIVAL ・ ${kills + 1}人目`,
        });
        if (r.aborted) {
          // ポーズ→メニューでの中断: 獲得分を静かに確定してメニューへ（リザルトは挟まない）
          if (this.meta && kills > 0) {
            const aw = this.meta.onSurvivalEnd(kills);
            this.ui.toast(`SURVIVAL ${kills}人抜き ・ 🪙 +${aw.coins}`, 2200);
          }
          return;
        }
        if (r.winner !== 0) break;                // 敗北 → ラン終了（リザルトへ）
        kills++;
        if (this.meta) { this.meta.track('play'); this.meta.track('win'); }   // サバイバルもミッション対象
        const you = this.match.fighters[0];
        carriedHp = Math.min(you.maxHp, you.hp + Math.round(you.maxHp * 0.25));   // 勝利ボーナス回復 +25%
        stage = STAGES[(STAGES.indexOf(getStage(stage.id)) + 1) % STAGES.length];
        const cont = await this._survivalInterlude(kills, you.hp, carriedHp, you.maxHp);
        if (cont !== 'next') break;               // 「ここでやめる」→ 獲得確定してラン終了
      }
      // ラン終了 → 報酬・ベスト記録
      const prevBest = this.meta ? (this.meta.stats().survivalBest || 0) : 0;
      const award = this.meta ? this.meta.onSurvivalEnd(kills) : { coins: 0 };
      const newBest = kills > prevBest;
      const act = await this.ui.result(
        `${kills} 人抜き`, kills >= 5 ? '#ffd24a' : '#7cf',
        [newBest ? '🏆 自己ベスト更新！' : `自己ベスト ${Math.max(prevBest, kills)} 人`, 'SURVIVAL'],
        [{ id: 'retry', label: 'もう一度挑戦' }, { id: 'menu', label: 'メニューへ' }],
        kills > 0 ? { coins: award.coins, breakdown: [{ label: `${kills}人抜き × 25`, amount: award.coins }] } : null);
      if (act !== 'retry') return;
    }
  }

  // サバイバルの試合間（回復量を見せて次戦へ・5秒で自動続行）
  _survivalInterlude(kills, hpNow, hpNext, hpMax) {
    return new Promise((res) => {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;' +
        'background:radial-gradient(120% 90% at 50% 0%, #2a1a10 0%, #140b06 55%, #05070e 100%);color:#eaf2ff;' +
        'font-family:-apple-system,"Hiragino Kaku Gothic ProN",sans-serif;-webkit-user-select:none;user-select:none';
      const pct = (v) => Math.round(100 * v / hpMax);
      el.innerHTML = '<div style="text-align:center;padding:24px">' +
        '<div style="font-size:13px;letter-spacing:4px;opacity:.55;font-weight:700">SURVIVAL</div>' +
        `<div style="font-size:clamp(40px,9vw,64px);font-weight:900;color:#ff9a3a;text-shadow:0 0 34px rgba(255,150,60,.5);margin-top:8px">${kills} 人抜き！</div>` +
        `<div style="font-size:14px;opacity:.85;margin:14px 0 6px">HP ${pct(hpNow)}% → <b style="color:#7fe">${pct(hpNext)}%</b>（勝利ボーナス +25% 回復）</div>` +
        '<div style="opacity:.6;font-size:12px;margin-bottom:26px">敵はどんどん強くなる。どこまで行ける？</div>' +
        '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">' +
          '<div data-next style="min-width:200px;padding:14px 22px;border-radius:13px;border:2px solid #f96;background:linear-gradient(180deg,#d06a2b,#9e4a1e);font-size:16px;font-weight:800;cursor:pointer">⚔ 次の相手へ（<span data-cnt>5</span>）</div>' +
          '<div data-stop style="min-width:150px;padding:14px 22px;border-radius:13px;border:2px solid #5a6c93;background:rgba(18,26,46,.88);font-size:16px;font-weight:800;cursor:pointer">ここでやめる</div>' +
        '</div></div>';
      document.body.appendChild(el);
      let sec = 5;
      const done = (v) => { clearInterval(timer); el.remove(); res(v); };
      const timer = setInterval(() => {
        sec--;
        const c = el.querySelector('[data-cnt]'); if (c) c.textContent = sec;
        if (sec <= 0) done('next');
      }, 1000);
      el.querySelector('[data-next]').addEventListener('pointerdown', (e) => { e.preventDefault(); done('next'); });
      el.querySelector('[data-stop]').addEventListener('pointerdown', (e) => { e.preventDefault(); done('stop'); });
    });
  }

  // ================= 観戦モード（CPU vs CPU・自動連戦） =================
  async _runDemo() {
    for (;;) {
      if (!this.roster || this.roster.length < 2) { this.ui.toast('キャラクターが2人以上必要です'); return; }
      // ランダムマッチメイク（sim の乱数とは無関係＝決定論に影響しない）
      const pool = this.roster.slice();
      const a = pool.splice((Math.random() * pool.length) | 0, 1)[0];
      const b = pool.splice((Math.random() * pool.length) | 0, 1)[0];
      const stage = STAGES[(Math.random() * STAGES.length) | 0];
      const seed = 1 + ((Math.random() * 0x7fffffff) | 0);   // 毎試合ちがう展開に
      const r = await this._playMatch(a, b, stage, new AIAgent(2), new AIAgent(2),
        { mode: 'demo', demo: true, seed, bannerSub: 'EXHIBITION ・ 観戦モード' });
      if (r.aborted) {
        if (this._demoSkip) { this._demoSkip = false; continue; }  // ⏩ 次の試合へスキップ
        return;                                                    // ⏹ 終了 / ポーズ→メニュー
      }
      const act = await this._demoInterlude(a, b, r.winner);
      if (act !== 'next') return;
    }
  }

  // 試合間のリザルト（カウントダウンで自動的に次の試合へ）
  _demoInterlude(a, b, winner) {
    return new Promise((res) => {
      const w = winner === 0 ? a : winner === 1 ? b : null;
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;' +
        'background:radial-gradient(120% 90% at 50% 0%, #15233f 0%, #0b1020 55%, #05070e 100%);color:#eaf2ff;' +
        'font-family:-apple-system,"Hiragino Kaku Gothic ProN",sans-serif;-webkit-user-select:none;user-select:none';
      el.innerHTML = '<div style="text-align:center;padding:24px">' +
        '<div style="font-size:13px;letter-spacing:4px;opacity:.55;font-weight:700">EXHIBITION RESULT</div>' +
        '<div style="font-size:clamp(34px,8vw,58px);font-weight:900;letter-spacing:2px;color:#ffd24a;text-shadow:0 0 34px rgba(255,210,74,.45);margin-top:10px">' +
          (w ? (w.nameJa || w.name) + ' WIN!' : 'DRAW') + '</div>' +
        '<div style="opacity:.7;font-size:14px;margin:10px 0 30px">' + (a.nameJa || a.name) + ' vs ' + (b.nameJa || b.name) + '</div>' +
        '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">' +
          '<div data-next style="min-width:190px;padding:14px 22px;border-radius:13px;border:2px solid #6cf;background:linear-gradient(180deg,#2b6fd0,#1e4f9e);font-size:16px;font-weight:800;cursor:pointer">▶ 次の試合（<span data-cnt>8</span>）</div>' +
          '<div data-menu style="min-width:150px;padding:14px 22px;border-radius:13px;border:2px solid #5a6c93;background:rgba(18,26,46,.88);font-size:16px;font-weight:800;cursor:pointer">メニューへ</div>' +
        '</div></div>';
      document.body.appendChild(el);
      let sec = 8;
      const done = (v) => { clearInterval(timer); el.remove(); res(v); };
      const timer = setInterval(() => {
        sec--;
        const c = el.querySelector('[data-cnt]'); if (c) c.textContent = sec;
        if (sec <= 0) done('next');
      }, 1000);
      el.querySelector('[data-next]').addEventListener('pointerdown', (e) => { e.preventDefault(); done('next'); });
      el.querySelector('[data-menu]').addEventListener('pointerdown', (e) => { e.preventDefault(); done('menu'); });
    });
  }

  // ================= アーケードクリアの 3D エンディング =================
  // 倒した敵が一人ずつ登場するカーテンコール → 主役が勝利ポーズを踊り続けるフィナーレ（紙吹雪つき）。
  async _arcadeEnding(player, defeated) {
    this.ui.hide();
    if (this.touch) this.touch.show(false);
    this._teardownArena();   // 試合のシーンを解放（エンディングは専用シーン）

    // --- オーバーレイ（テキスト/操作） ---
    const style = document.createElement('style');
    style.textContent = '@keyframes ncfall { 0% { transform:translateY(-8vh) rotate(0deg); opacity:1 } 100% { transform:translateY(112vh) rotate(720deg); opacity:.7 } }' +
      '@keyframes ncglow { 0%,100% { text-shadow:0 0 28px rgba(255,210,74,.55) } 50% { text-shadow:0 0 60px rgba(255,210,74,.95) } }';
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:70;font-family:-apple-system,"Hiragino Kaku Gothic ProN",sans-serif;color:#eaf2ff;' +
      '-webkit-user-select:none;user-select:none;touch-action:none;overflow:hidden';
    el.innerHTML =
      '<div style="position:absolute;top:0;left:0;right:0;padding:max(16px,env(safe-area-inset-top)) 16px 26px;background:linear-gradient(180deg,rgba(5,7,14,.88),transparent);text-align:center;pointer-events:none">' +
        '<div data-toplabel style="font-size:clamp(26px,6vw,44px);font-weight:900;letter-spacing:4px;color:#ffd24a;animation:ncglow 2.4s infinite">ARCADE CLEAR</div>' +
        '<div data-topsub style="font-size:13px;opacity:.75;margin-top:6px;letter-spacing:2px">全 ' + defeated.length + ' 人撃破 ・ CURTAIN CALL</div>' +
      '</div>' +
      '<div style="position:absolute;bottom:0;left:0;right:0;padding:20px 16px max(20px,env(safe-area-inset-bottom));background:linear-gradient(0deg,rgba(5,7,14,.92),transparent);text-align:center;pointer-events:none">' +
        '<div data-name style="font-size:clamp(22px,5vw,34px);font-weight:900;letter-spacing:2px"></div>' +
        '<div data-label style="font-size:13px;opacity:.7;margin-top:4px"></div>' +
        '<div data-hint style="font-size:12px;opacity:.5;margin-top:14px">タップで次へ ▶</div>' +
        '<div data-endbtn style="display:none;pointer-events:auto;margin:16px auto 0;max-width:280px;padding:15px 24px;border-radius:13px;border:2px solid #ffd24a;' +
          'background:linear-gradient(180deg,rgba(255,200,80,.4),rgba(255,140,40,.25));font-size:17px;font-weight:900;letter-spacing:1px;cursor:pointer;' +
          'box-shadow:0 0 26px rgba(255,207,74,.4)">🏆 メニューへ</div>' +
      '</div>' +
      '<div data-skip style="position:absolute;top:max(14px,env(safe-area-inset-top));right:14px;pointer-events:auto;padding:8px 14px;border-radius:10px;' +
        'border:1px solid rgba(170,200,255,.4);background:rgba(14,22,40,.8);font-weight:800;font-size:13px;cursor:pointer">≫ スキップ</div>';
    document.body.appendChild(el);
    const $t = (sel) => el.querySelector(sel);

    // --- 専用 3D シーン（表彰台ライティング） ---
    const escene = new THREE.Scene();
    escene.background = new THREE.Color(0x070b16);
    escene.add(new THREE.HemisphereLight(0x9fbfff, 0x1a2438, 1.25));
    const key = new THREE.DirectionalLight(0xfff2d8, 1.7); key.position.set(2.5, 5.5, 3.5); escene.add(key);
    const rim = new THREE.DirectionalLight(0x6aa8ff, 0.9); rim.position.set(-3, 3, -3); escene.add(rim);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 48),
      new THREE.MeshStandardMaterial({ color: 0x121a30, roughness: 0.85, metalness: 0.1 }));
    floor.rotation.x = -Math.PI / 2; escene.add(floor);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.45, 2.6, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.012; escene.add(ring);
    const turntable = new THREE.Group(); escene.add(turntable);
    const ecam = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 100);
    const reframe = () => { this.renderer.setSize(window.innerWidth, window.innerHeight); ecam.aspect = window.innerWidth / window.innerHeight; ecam.updateProjectionMatrix(); };
    window.addEventListener('resize', reframe); reframe();

    // --- キャラ表示（1体ずつロード→中央へ・カメラ高さフィット。_characterDetail と同じ流儀） ---
    let cur = null;
    const clearChar = () => {
      if (!cur) return;
      try { if (cur.weapon) cur.weapon.detach(); } catch (e) {}
      try { turntable.remove(cur.lib.root); cur.lib.dispose(); } catch (e) {}
      cur = null;
    };
    const showChar = async (char, pose) => {
      clearChar();
      const lib = new AnimLibrary({ assetVersion: this.assetVersion });
      lib.manifest = this.manifest;
      await lib.loadCharacterDef({ ...char, tint: null }, { assetVersion: this.assetVersion });
      await lib.loadClips();
      turntable.add(lib.root);
      try { lib.play(pose); } catch (e) { try { lib.play('idle'); } catch (e2) {} }
      lib.update(0);
      if (lib.groundToFloor) lib.groundToFloor();
      lib.root.updateMatrixWorld(true);
      const box = new THREE.Box3(), v = new THREE.Vector3();
      lib.root.traverse((o) => { if (o.isBone) { v.setFromMatrixPosition(o.matrixWorld); box.expandByPoint(v); } });
      if (box.isEmpty()) box.setFromObject(lib.root);
      const c = box.getCenter(new THREE.Vector3());
      let hb = null;
      lib.root.traverse((o) => { if (o.isBone && hb === null && /hips$/i.test(o.name)) hb = o; });
      let ax = c.x, az = c.z;
      if (hb) { hb.getWorldPosition(v); ax = v.x; az = v.z; }
      lib.root.position.x -= ax; lib.root.position.z -= az;
      const H = Math.max(box.max.y + 0.25, 1.2);
      const vfov = ecam.fov * Math.PI / 180;
      const radius = (H / 2) / Math.tan(vfov / 2) * 1.22;
      ecam.position.set(0, H * 0.55, radius);
      ecam.lookAt(0, H * 0.5, 0);
      let weapon = null;
      try {
        const w = char.weapon;
        if (w && w.enabled !== false && w.id) {
          const url = './assets/weapons/' + w.id + '.glb' + (this.assetVersion ? ('?v=' + this.assetVersion) : '');
          weapon = await attachWeapon(lib.root, { url, side: w.side || 'right', pos: w.pos || [0, 0, 0], rot: w.rot || [0, 0, 0], scale: (w.scale == null ? 1 : w.scale) });
        }
      } catch (e) { /* 武器は飾り＝失敗しても続行 */ }
      turntable.rotation.y = 0;
      cur = { lib, weapon };
    };

    // --- レンダループ（ゆっくり回転） ---
    let running = true, raf = 0, last = performance.now();
    const loop = () => {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
      turntable.rotation.y += dt * 0.5;
      if (cur) { cur.lib.update(dt); if (cur.lib.groundToFloor) cur.lib.groundToFloor(); }
      this.renderer.render(escene, ecam);
    };
    raf = requestAnimationFrame(loop);

    // --- タップ待ち（時間経過でも進む） ---
    // スキップ: フラグを立てるだけ（同じタップが waitTap にも届いて即・次へ進む）
    let skipParade = false;
    $t('[data-skip]').addEventListener('pointerdown', (e) => { e.preventDefault(); skipParade = true; });
    const waitTap = (ms) => new Promise((res) => {
      let t = 0;
      const on = (e) => { if (e.target.closest('[data-endbtn]')) return; done(); };
      const done = () => { el.removeEventListener('pointerdown', on); if (t) clearTimeout(t); res(); };
      el.addEventListener('pointerdown', on);
      if (ms) t = setTimeout(done, ms);
    });

    // --- カーテンコール: 倒した敵を1人ずつ ---
    for (let i = 0; i < defeated.length && !skipParade; i++) {
      const c = defeated[i];
      $t('[data-name]').textContent = c.nameJa || c.name;
      $t('[data-label]').textContent = `第${i + 1}戦 ・ ${c.label || c.archetype || ''}`;
      try { await showChar(c, VICTORY_POSES[i % VICTORY_POSES.length]); } catch (e) { console.warn('ending load fail', c.id, e); continue; }
      if (skipParade) break;
      await waitTap(4200);
    }

    // --- フィナーレ: 主役が勝利ポーズを踊り続ける＋紙吹雪 ---
    $t('[data-toplabel]').textContent = 'CONGRATULATIONS!';
    $t('[data-topsub]').textContent = 'CHAMPION ・ 全 ' + defeated.length + ' 人撃破';
    $t('[data-name]').textContent = (player.nameJa || player.name);
    $t('[data-label]').textContent = '🏆 ' + (player.label || player.archetype || '') + ' ・ 新チャンピオン';
    $t('[data-hint]').style.display = 'none';
    $t('[data-skip]').style.display = 'none';
    this.audio.victory();
    try { await showChar(player, 'win_dance'); } catch (e) { console.warn('ending player load fail', e); }
    // 勝利ポーズを切替ながら踊り続ける
    let poseIdx = 0;
    const poseTimer = setInterval(() => {
      if (!cur) return;
      poseIdx = (poseIdx + 1) % VICTORY_POSES.length;
      try { cur.lib.play(VICTORY_POSES[poseIdx]); } catch (e) {}
    }, 3400);
    // 紙吹雪（DOM・軽量）。ガチャで当てたテーマがあればその色で舞う
    const confetti = [];
    const colors = (this.meta && this.meta.confettiColors()) || ['#ffd24a', '#7fe', '#f86', '#9f7', '#c9f', '#fff'];
    for (let i = 0; i < 70; i++) {
      const p = document.createElement('div');
      const sz = 6 + Math.random() * 8;
      p.style.cssText = `position:absolute;top:0;left:${Math.random() * 100}%;width:${sz}px;height:${sz * 0.5}px;` +
        `background:${colors[i % colors.length]};opacity:.9;pointer-events:none;border-radius:2px;` +
        `animation:ncfall ${3.2 + Math.random() * 3.4}s linear ${Math.random() * 4}s infinite`;
      el.appendChild(p); confetti.push(p);
    }
    // 終了ボタン
    const endBtn = $t('[data-endbtn]');
    endBtn.style.display = 'block';
    await new Promise((res) => endBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); res(); }));

    // --- 後片付け ---
    clearInterval(poseTimer);
    running = false; cancelAnimationFrame(raf);
    window.removeEventListener('resize', reframe);
    clearChar();
    floor.geometry.dispose(); floor.material.dispose();
    ring.geometry.dispose(); ring.material.dispose();
    el.remove(); style.remove();
    this._onResize();
  }

  // ================= 1試合 =================
  async _playMatch(rA, rB, stage, agent0, agent1, opts = {}) {
    const ld = this.ui.loading('ファイター読込');
    this._training = !!opts.training;
    this._demoMode = !!opts.demo;
    this._matchOpts = opts;   // ポーズ「仕切り直し」で startHp0 等を再適用するため保持
    // メタ統計の対象（-1=記録しない）。local2p は2人ともローカル人間＝どちらの成績でもないので対象外
    this._playerIndex = (opts.demo || opts.training || opts.mode === 'local2p') ? -1 : 0;
    // ステージスキン（ガチャ入手・装備中なら色テーマ差し替え。radius/shape等の物理は原本のまま＝sim非干渉）
    if (this.meta) stage = this.meta.applyStageSkin(stage);
    // 魔法（ガチャ消耗品）: オフラインの1P側のみ注入。オンラインは _playOnlineMatch 経由＝決して渡らない。
    // local2p/観戦は対象外（公平性/観戦は操作なし）。
    const canSpell = ['arcade', 'survival', 'vscpu', 'training'].includes(opts.mode);
    const spellLoadout = (canSpell && this.meta) ? this.meta.spellLoadout() : null;
    const spellsOpt = spellLoadout ? [spellLoadout, null] : null;
    // sim（トレーニングは実質エンドレス）。mods=敵強化補正 / seed=観戦・サバイバルのバリエーション
    this.match = new Match(rA, rB, stage, opts.training
      ? { seed: 20260622, roundTime: 999, roundsToWin: 99, spells: spellsOpt }
      : { seed: opts.seed || 20260622, roundTime: CONFIG.ROUND_TIME, mods: opts.mods || null,
          roundsToWin: opts.roundsToWin || undefined, spells: spellsOpt });
    // サバイバル: 前試合からの HP 持ち越し
    if (opts.startHp0 != null) {
      const f = this.match.fighters[0];
      f.hp = Math.max(1, Math.min(f.maxHp, Math.round(opts.startHp0)));
    }
    // 描画リソース
    this._teardownArena();
    this.cam.endVictory();
    this.stageView = new StageView(this.scene, stage, { lowSpec: this.coarse });
    this.fx = new FX(this.scene, this.cam);
    if (this.meta) this.fx.theme = this.meta.sparkTheme();      // ガチャのヒットエフェクトテーマ
    if (stage.skinName) this.ui.toast(`🏟 ステージスキン「${stage.skinName}」`, 1500);
    const p2Human = opts.mode === 'local2p';
    this.views = [
      new FighterView(this.scene, this.match.fighters[0], { facingOffset: this.facingOffset, assetVersion: this.assetVersion, sideColor: 0x3bd6ff, isPlayer: true }),
      new FighterView(this.scene, this.match.fighters[1], { facingOffset: this.facingOffset, assetVersion: this.assetVersion, sideColor: 0xff7a4a, isPlayer: p2Human }),
    ];
    ld.set(0.15, rA.nameJa + ' 読込');
    await this.views[0].load(this.manifest, rA);
    ld.set(0.6, rB.nameJa + ' 読込');
    await this.views[1].load(this.manifest, rB);
    ld.set(1, '開始');
    // モデル読込失敗（プリミティブ表示）の診断を画面に出す
    const probs = [];
    if (this.views[0].lib.primitive) probs.push(rA.nameJa + '＝' + (this.views[0].lib.loadErrors || []).join(' / '));
    if (this.views[1].lib.primitive) probs.push(rB.nameJa + '＝' + (this.views[1].lib.loadErrors || []).join(' / '));
    if (probs.length) { console.error('モデル読込失敗:', probs); this.ui.toast('⚠ モデル読込失敗→簡易表示: ' + probs.join(' ｜ '), 16000); }

    // HUD
    this.hud.el.style.display = '';
    const tag1 = opts.demo ? '（CPU）' : p2Human ? '（1P）' : '（あなた）';
    const tag2 = opts.demo ? '（CPU）' : p2Human ? '（2P）' : '（CPU）';
    this.hud.setup(this.match, [rA.nameJa + ' ' + tag1, rB.nameJa + ' ' + tag2], [rA.label, rB.label],
      Math.min(this.match.roundsToWin, CONFIG.ROUNDS_TO_WIN),   // サバイバル=1本勝負は1ランプ（トレモ99は従来通り2表示）
      opts.demo ? '観戦モード ・ ラウンドは自動進行 ・ P/Esc:ポーズ'
        : opts.training ? 'TRAINING ・ 左右=移動 上=奥へ回避 下=しゃがみ ・ H:判定 P:ポーズ' + (spellsOpt ? ' ・ O/✨:魔法' : '')
        : '左右=移動  上=奥へ回避  下=しゃがみ  ・  P/Esc:ポーズ  H:判定' + (spellsOpt ? '  O/✨:魔法' : ''));
    this.hud.showBanner('ROUND ' + this.match.round, opts.bannerSub || (rA.nameJa + ' vs ' + rB.nameJa), '#fff', 1.6);

    // 入力表示（観戦モードはタッチ操作なし＋観戦用ボタンを表示）
    if (this.touch) this.touch.show(!opts.demo);
    if (opts.demo) this._armDemoControls();
    this.agents = [agent0, agent1];
    this.ui.hide();

    // ループ実行（Promise が match 終了で解決）
    const winner = await this._loopUntilMatchEnd(opts);
    this._disarmContinue();
    this._disarmDemoControls();
    if (this.touch) { this.touch.show(false); this.touch.setMagic(0, false); }
    // 魔法の残数を書き戻し（中断でも使った分は確定）
    if (spellLoadout && this.meta) {
      const sp = this.match.spells && this.match.spells[0];
      if (sp) this.meta.setSpellCharges(sp.type, sp.charges);
    }
    this.hud.el.style.display = 'none';
    const aborted = !!this._abortMatch; this._abortMatch = false;
    return { winner, aborted };
  }

  _loopUntilMatchEnd(opts) {
    return new Promise((resolve) => {
      this.running = true; this.paused = false;
      this._acc = 0; this._last = performance.now();
      let lastRoundBannerWins = '0-0'; let lastPhase = this.match.phase;
      const loop = () => {
        if (!this.running) return;
        this._raf = requestAnimationFrame(loop);
        const now = performance.now();
        let dt = Math.min(0.05, (now - this._last) / 1000); this._last = now;

        if (!this.paused) {
          // KO スロー / フリーズで sim 進行を遅く
          const slow = this.match.koSlow > 0 ? CONFIG.KO_SLOW_SCALE : 1;
          this.agents[0].beginFrame(); this.agents[1].beginFrame();
          this._acc += dt * slow;
          let steps = 0; this.events.length = 0;
          while (this._acc >= DT && steps < 6) {
            this._acc -= DT;
            const [a, b] = this.match.fighters;
            const i0 = this.agents[0].tick(a, b, this.match);
            const i1 = this.agents[1].tick(b, a, this.match);
            this.match.step(i0, i1);
            for (const e of this.match.events) this.events.push(e);
            steps++;
          }
          // イベント → 演出/音/HUD
          this._handleEvents(this.events);
          // 必殺フリーズで迫力アングル
          if (this.match.superFreeze > 0 && !this._wasFreeze) { this.cam.cinematic(0.9, 0.45, 0.7); this.audio.superSfx(); }
          this._wasFreeze = this.match.superFreeze > 0;
          // ラウンド/マッチ進行のバナー
          this._phaseBanners(opts);
          // KO演出後はダンスを流し続け、入力があるまで次へ進まない（観戦モードは自動進行）
          if (this.match.canProceed) {
            if (this._demoMode) {
              if (this.match.phaseFrame >= CONFIG.ROUND_END_FRAMES + 150) this.match.proceed();
            } else this._armContinue();
          }

          // 描画 timeScale（ヒットストップ/スローで止め感）
          const rts = this.match.hitstop > 0 || this.match.superFreeze > 0 ? 0.04 : slow;
          for (const v of this.views) v.render(dt, rts);
          this.fx.syncProjectiles(this.match.projectiles);
          this.fx.update(dt);
          this.cam.update(dt, this.match.fighters[0], this.match.fighters[1]);
          this.hud.update(dt);
          if (this.touch && !this._demoMode) {
            const f = this.match.fighters[0];
            this.touch.setAvailability({
              P: true, K: true,                       // P/K は常時使用可（段はフリックで撃ち分け）
              S: f.gauge >= CONFIG.THRESH_S, SP: f.sp >= CONFIG.SP_MAX,
            });
            const sp = this.match.spells && this.match.spells[0];
            if (sp) this.touch.setMagic(sp.charges, sp.charges > 0 && sp.used < SPELL_USES_PER_MATCH);
          }
          this.c1.endFrame(); this.c2.endFrame();
        }
        this._renderFrame();

        if (this.match.phase === 'matchEnd') {
          this.running = false; cancelAnimationFrame(this._raf);
          resolve(this.match.matchWinner);
        }
      };
      this._resolvePause = resolve;
      this._raf = requestAnimationFrame(loop);
    });
  }

  _handleEvents(events) {
    const a = this.match.fighters[0];
    this.fx.consume(events, {
      onHit: (e) => {
        this.audio.hit(e.level, (e.dmg || 0) >= 16);
        if (e.crit) { this.audio.crit(); this.hud.popTag('CRITICAL!', '#ffe08a'); }
        if (e.who !== undefined) this.hud.flashVignette(e.who);
        if (e.combo >= 2) this.hud.popCombo(e.combo);
        if (navigator.vibrate && e.who === 0 && !this._demoMode) navigator.vibrate(e.dmg >= 16 ? 30 : 12);
      },
      onBlock: () => this.audio.block(),
      onClash: () => this.audio.clash(),
      onFire: (e) => (e.kind === 'flame' || e.kind === 'ice')
        ? this.audio.spellStrike(e.kind === 'ice' ? 'ice' : 'flame')
        : this.audio.fire(e.kind),
      onSpell: () => this.audio.spellCast(),
      onSpellStrike: (e) => this.audio.spellStrike(e.kind),
      onKO: () => this.audio.ko(),     // とどめの衝撃音（勝利ジングルは演出が確定する 'victory' で）
    });
    // メタ統計（デイリーミッション/実績の進捗）: 自分が「与えた」行動のみ数える
    const pi = this._playerIndex;
    if (this.meta && pi >= 0) {
      for (const e of events) {
        if (e.type === 'hit' && e.who === 1 - pi) {
          if (e.crit) this.meta.track('crit');
          if (e.counter) this.meta.track('counter');
          if (e.combo >= 2) this.meta.track('combo', e.combo);
        }
        if (e.type === 'throw' && e.who === 1 - pi) this.meta.track('throw');
        if (e.type === 'ko' && e.who === 1 - pi) this.meta.track('ko');
        if (e.type === 'spell_cast' && e.owner === pi) this.meta.track('spell');
      }
    }
    for (const e of events) {
      if (e.type === 'spell_cast') {
        this.hud.popTag(e.kind === 'thunder' ? '⚡ サンダーボルト' : e.kind === 'flame' ? '🔥 フレイムウェーブ' : '❄ フリーズランス', '#9fdcff');
      }
      if (e.type === 'round_start') { this.hud.showBanner('FIGHT!', '', '#ffd24a', 0.9); this.cam.endVictory(); }
      if (e.type === 'throw') this.audio.throwSfx();
      if (e.type === 'victory') {
        // 勝者の勝利ポーズ（複数パターンをラウンドで変える）＋勝利カメラ＋軽快な音楽＋紙吹雪
        const w = this.match.fighters[e.winner];
        const pose = VICTORY_POSES[(this.match.round + e.winner) % VICTORY_POSES.length];
        if (this.views[e.winner]) this.views[e.winner].setVictory(pose);
        this.cam.startVictory(w);
        this.audio.victory();
        this.hud.showBanner('WIN!', w.roster.nameJa, '#ffd24a', 2.4);
        this._confettiBurst();   // ガチャの紙吹雪テーマはここで色が変わる
      }
    }
    // 技名表示（トレモ）
    if (CONFIG.DEBUG_BOXES || this._training) {
      const f = a; if (f.state === ST.ATTACK && f.move && f.move !== this._lastShownMove) { this.hud.showMoveName(f.move.name + `  (${f.move.startup}/${f.move.active}/${f.move.recovery})`); this._lastShownMove = f.move; }
    }
  }

  _phaseBanners(opts) {
    const m = this.match;
    if (m.phase === 'roundEnd' && this._prevPhase !== 'roundEnd') {
      // とどめの瞬間に大きく表示（スロー演出の間ずっと出す）
      if (m.roundCause === 'timeover') this.hud.showBanner('TIME UP', m.roundWinner < 0 ? 'DRAW' : (this.match.fighters[m.roundWinner].roster.nameJa + ' WIN'), '#fff', 2.6);
      else this.hud.showBanner('K.O.', '', '#ff5555', 3.6);
    }
    if (m.phase === ST.INTRO && this._prevPhase === 'roundEnd' && m.round > 1) {
      this.hud.showBanner('ROUND ' + m.round, '', '#fff', 1.2);
    }
    this._prevPhase = m.phase;
  }

  _togglePause() {
    if (!this.running || this._online) return;   // オンラインは片側だけ停止すると desync するため不可
    this.paused = !this.paused;
    if (this.paused) {
      this.ui.pause().then(async (act) => {
        if (act === 'resume') { this.paused = false; this.ui.hide(); this._last = performance.now(); }
        else if (act === 'options') { await this.ui.options(this.audio, (d) => { CONFIG.DEBUG_BOXES = d; }); this.paused = false; this.ui.hide(); this._last = performance.now(); }
        else if (act === 'rematch') {
          this.paused = false; this.ui.hide(); this.match._placeStart();
          for (const f of this.match.fighters) { f.hp = f.maxHp; f.gauge = 0; }
          // サバイバルの HP 持ち越しを復元（仕切り直しでの全回復エクスプロイト防止）
          if (this._matchOpts && this._matchOpts.startHp0 != null) {
            const f0 = this.match.fighters[0];
            f0.hp = Math.max(1, Math.min(f0.maxHp, Math.round(this._matchOpts.startHp0)));
          }
          this.match.wins = [0, 0]; this.match.round = 1; this.match.timer = this.match.roundTimeMax; this.match.phase = ST.INTRO; this.match.phaseFrame = 0; this._last = performance.now();
        }
        else if (act === 'menu') { this.paused = false; this.ui.hide(); this._returnToMenu(); }
      });
    }
  }

  // ================= オンライン対戦（P2P・決定論ロックステップ） =================
  async _runOnline() {
    const ui = this.ui;
    const net = new NetGame({ inputDelay: 3 });
    this._net = net;
    net.onError = (w) => ui.toast('通信エラー: ' + w, 2200);
    const cleanup = async () => { try { await net.leave(); } catch (e) {} this._net = null; };

    // 1) ホーム（部屋を作る / コードで参加）
    const home = await ui.onlineHome();
    if (home === '__back') { await cleanup(); return; }

    // 接続待ち（onConnected / onClosed のどちらか）
    let resolveConn; const connP = new Promise((r) => { resolveConn = r; });
    net.onConnected = () => resolveConn(true);
    net.onClosed = () => resolveConn(false);

    try {
      if (home === 'create') {
        const code = await net.host('HOST');
        const cancelP = ui.netInfo('部屋を作成しました', '相手の参加と P2P 接続を待っています…', code);
        const r = await Promise.race([connP, cancelP]);
        if (r !== true) { await cleanup(); return; }
      } else {
        const code = await ui.onlineJoin();
        if (code === '__back') { await cleanup(); return; }
        const cancelP = ui.netInfo('参加中', 'ホストへ接続しています…', code);
        try { await net.join(code, 'GUEST'); }
        catch (e) { ui.toast(String((e && e.message) || e), 2800); await cleanup(); return; }
        const r = await Promise.race([connP, cancelP]);
        if (r !== true) { await cleanup(); return; }
      }
    } catch (e) { ui.toast('接続失敗: ' + ((e && e.message) || e), 2600); await cleanup(); return; }

    // 2) 接続成立 → 各自が自分のキャラを選択（ホストはステージも）
    ui.toast('接続しました！キャラクターを選択', 1600);
    const pick = await this._pickCharacter({
      title: 'あなたのキャラ', accent: net.isHost ? '#7cf' : '#f86',
      sub: net.isHost ? 'YOU = 1P（左）' : 'YOU = 2P（右）',
    });
    if (pick === '__back') { await cleanup(); return; }
    let stageId = STAGES[0].id;
    if (net.isHost) {
      const st = await ui.selectStage(STAGES);
      if (st === '__back') { await cleanup(); return; }
      stageId = st.id;
    }

    // 3) キャラ送信 → 設定確定（host が seed/両者キャラ/ステージを配布）を待つ
    const cfg = await new Promise((res) => {
      net.onReady = (config) => res(config);
      net.onClosed = () => res(null);
      ui.netInfo('準備完了', '相手とマッチ設定を同期しています…', null);
      net.submitPick(pick.id, net.isHost ? stageId : null);
    });
    if (!cfg) { ui.toast('相手が切断しました', 2400); await cleanup(); return; }

    // 4) 同一 Match を構築して対戦ループ
    let winner = -1;
    try { winner = await this._playOnlineMatch(net, cfg); }
    catch (e) { console.error('online match error', e); ui.toast('対戦エラー: ' + ((e && e.message) || e), 2800); }
    await cleanup();

    // 5) リザルト（オンラインもコイン・戦績の対象）
    if (winner >= 0) {
      const youWon = winner === net.localPlayer;
      let extra = null;
      if (this.meta && this.match) {
        const rk = this._rankOf(youWon, net.localPlayer);
        const award = this.meta.onMatchEnd({ mode: 'online', won: youWon, perfect: rk.perfect, roundsLost: this.match.wins[1 - net.localPlayer] });
        extra = { rank: rk.rank, rankColor: rk.color, coins: award.coins, breakdown: award.breakdown };
      }
      await ui.result(youWon ? 'YOU WIN' : 'YOU LOSE', youWon ? '#ffd24a' : '#f86', ['オンライン対戦'], [{ id: 'menu', label: 'メニューへ' }], extra);
    }
    ui.hide();
  }

  async _playOnlineMatch(net, cfg) {
    const ui = this.ui;
    const rA = this.roster.find((c) => c.id === cfg.aId) || this.roster[0];
    const rB = this.roster.find((c) => c.id === cfg.bId) || this.roster[1];
    let stage = getStage(cfg.stageId) || STAGES[0];
    // スキンは theme（色）だけの差し替え＝物理(radius/shape/walls)は原本と同一なので両ピアの sim は一致
    if (this.meta) stage = this.meta.applyStageSkin(stage);
    const youIdx = net.localPlayer;
    this._playerIndex = youIdx;
    this._demoMode = false; this._training = false;

    const ld = ui.loading('対戦相手と同期');
    // 決定論シム（共有 seed）。両ピアで完全一致する。
    this.match = new Match(rA, rB, stage, { seed: cfg.seed, roundTime: CONFIG.ROUND_TIME });
    net.attachMatch(this.match);

    this._teardownArena();
    this.cam.endVictory();
    this.stageView = new StageView(this.scene, stage, { lowSpec: this.coarse });
    this.fx = new FX(this.scene, this.cam);
    if (this.meta) this.fx.theme = this.meta.sparkTheme();
    this.views = [
      new FighterView(this.scene, this.match.fighters[0], { facingOffset: this.facingOffset, assetVersion: this.assetVersion, sideColor: 0x3bd6ff, isPlayer: youIdx === 0 }),
      new FighterView(this.scene, this.match.fighters[1], { facingOffset: this.facingOffset, assetVersion: this.assetVersion, sideColor: 0xff7a4a, isPlayer: youIdx === 1 }),
    ];
    ld.set(0.2, rA.nameJa + ' 読込'); await this.views[0].load(this.manifest, rA);
    ld.set(0.6, rB.nameJa + ' 読込'); await this.views[1].load(this.manifest, rB);
    ld.set(1, '開始');

    this.hud.el.style.display = '';
    const tag = (i) => (i === youIdx ? '（あなた）' : '（相手）');
    this.hud.setup(this.match, [rA.nameJa + ' ' + tag(0), rB.nameJa + ' ' + tag(1)], [rA.label, rB.label], CONFIG.ROUNDS_TO_WIN,
      'オンライン対戦 ・ 入力遅延 ' + net.delay + 'F ・ P/Esc は使用不可');
    this.hud.showBanner('ROUND ' + this.match.round, rA.nameJa + ' vs ' + rB.nameJa, '#fff', 1.6);
    if (this.touch) this.touch.show(true);
    ui.hide();

    const localAgent = new HumanAgent(this.c1);
    const ROUND_AUTO = CONFIG.ROUND_END_FRAMES + 120;   // KO後 約2秒で両者自動的に次へ（同期）
    this._online = true;
    let netClosed = false;
    net.onClosed = () => { netClosed = true; };
    net.onDesync = (info) => { console.warn('DESYNC @frame', info.frame, info); ui.toast('⚠ 同期ズレを検出（通信品質）', 3200); };

    const finish = (w) => {
      this.running = false; cancelAnimationFrame(this._raf);
      this._online = false; this._setNetStall(false);
      if (this.touch) this.touch.show(false);
      this.hud.el.style.display = 'none';
      return w;
    };

    return new Promise((resolve) => {
      this.running = true; this.paused = false; this._last = performance.now();
      const loop = () => {
        if (!this.running) return;
        this._raf = requestAnimationFrame(loop);
        const now = performance.now();
        const dt = Math.min(0.05, (now - this._last) / 1000); this._last = now;

        if (netClosed) { ui.toast('相手が切断しました', 2600); return resolve(finish(-1)); }

        // ネットプレイ進行: ローカル入力送信 + 揃った分 step（ラウンドは両者同フレームで自動進行）
        const r = net.pump(localAgent, dt, (match) => {
          if (match.canProceed && match.phaseFrame >= ROUND_AUTO) match.proceed();
        });
        if (r.events && r.events.length) this._handleEvents(r.events);
        this._phaseBanners({});
        this._setNetStall(net.noStepFrames > 24);   // 真に進行が止まった時だけ表示（正常な先行待ちでは出さない）

        // 描画
        const rts = this.match.hitstop > 0 || this.match.superFreeze > 0 ? 0.04 : 1;
        for (const v of this.views) v.render(dt, rts);
        this.fx.syncProjectiles(this.match.projectiles);
        this.fx.update(dt);
        this.cam.update(dt, this.match.fighters[0], this.match.fighters[1]);
        this.hud.update(dt);
        if (this.touch) {
          const f = this.match.fighters[youIdx];
          this.touch.setAvailability({ P: true, K: true, S: f.gauge >= CONFIG.THRESH_S, SP: f.sp >= CONFIG.SP_MAX });
        }
        this.c1.endFrame(); this.c2.endFrame();
        this._renderFrame();

        if (this.match.phase === 'matchEnd') resolve(finish(this.match.matchWinner));
      };
      this._raf = requestAnimationFrame(loop);
    });
  }

  // キャラ選択 → 詳細プレビューで確認 → 決定/戻る のループ。決定したキャラを返す（'__back' で取消）。
  async _pickCharacter(opts) {
    for (;;) {
      const c = await this.ui.selectCharacter(this.roster, opts);
      if (c === '__back') return '__back';
      const d = await this._characterDetail(c);
      if (d === 'confirm') return c;
      // 'back' → グリッドへ戻る
    }
  }

  // 1キャラの詳細画面：3Dモデルをスワイプで360°回転＋スペック確認。'confirm'|'back' を返す。
  async _characterDetail(char) {
    const ui = this.ui;
    ui.hide();                                   // メニュー背景を消して 3D キャンバスを見せる
    if (this.touch) this.touch.show(false);

    const tint = char.tint || '#88aaff';
    const badge = (char.range || '').toUpperCase() || (char.label || char.archetype || '');
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:70;touch-action:none;-webkit-user-select:none;user-select:none;font-family:-apple-system,"Hiragino Kaku Gothic ProN",sans-serif;color:#eaf2ff';
    el.innerHTML =
      '<div style="position:absolute;top:0;left:0;right:0;padding:max(12px,env(safe-area-inset-top)) 16px 18px;background:linear-gradient(180deg,rgba(5,7,14,.85),transparent);display:flex;align-items:center;gap:12px;pointer-events:none">' +
        '<div data-back style="pointer-events:auto;padding:9px 16px;border-radius:10px;border:1px solid rgba(170,200,255,.4);background:rgba(20,30,55,.7);font-weight:800;cursor:pointer">← 戻る</div>' +
        '<div style="font-size:22px;font-weight:900;letter-spacing:1px">' + (char.nameJa || char.name) + '</div>' +
        '<div style="font-size:11px;font-weight:800;color:' + tint + ';border:1px solid ' + tint + '66;border-radius:20px;padding:2px 10px">' + badge + '</div>' +
      '</div>' +
      '<div data-bg style="position:absolute;top:max(12px,env(safe-area-inset-top));right:16px;z-index:2;pointer-events:auto;padding:8px 13px;border-radius:10px;border:1px solid rgba(170,200,255,.4);background:rgba(20,30,55,.72);font-weight:800;font-size:13px;cursor:pointer">🌙 濃色</div>' +
      '<div data-hint style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);opacity:.5;font-size:13px;pointer-events:none;text-shadow:0 1px 4px #000">読み込み中…</div>' +
      '<div style="position:absolute;bottom:0;left:0;right:0;padding:18px 16px max(18px,env(safe-area-inset-bottom));background:linear-gradient(0deg,rgba(5,7,14,.92),transparent);text-align:center">' +
        '<div style="font-size:13px;opacity:.8;margin-bottom:12px">' + (char.label || char.archetype || '') + (char.name && char.name !== (char.nameJa || '') ? ' ・ ' + char.name : '') + '</div>' +
        '<div data-confirm style="display:inline-block;pointer-events:auto;min-width:220px;padding:15px 24px;border-radius:13px;border:2px solid ' + tint + ';background:linear-gradient(180deg,' + tint + '40,' + tint + '1c);font-size:17px;font-weight:900;letter-spacing:1px;cursor:pointer;box-shadow:0 0 24px ' + tint + '55">✓ このキャラで決定</div>' +
      '</div>';
    document.body.appendChild(el);

    // プレビュー用シーン/カメラ
    const pscene = new THREE.Scene();
    pscene.add(new THREE.HemisphereLight(0x9fbfff, 0x223047, 1.5));
    const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(2.5, 5, 3); pscene.add(dl);
    const dl2 = new THREE.DirectionalLight(0x88aaff, 0.5); dl2.position.set(-3, 2, -2); pscene.add(dl2);
    const pcam = new THREE.PerspectiveCamera(40, 1, 0.05, 100);

    // 横回転（ヨー）のみ。モデルは「見えるメッシュ境界の中心＝おへそ」を原点へ合わせ、その鉛直軸まわりに回す。
    // → おへそは回転軸上にあるので、横に回しても常に画面中央で固定。高さフィットで適切な大きさに収める。
    const turntable = new THREE.Group(); pscene.add(turntable);
    let frameInfo = null;   // { H }
    let radius = 3, dragging = false, lastX = 0, lastY = 0;
    const reframe = () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setSize(w, h);
      pcam.aspect = w / h;
      if (frameInfo) {
        const vfov = pcam.fov * Math.PI / 180;
        radius = (frameInfo.H / 2) / Math.tan(vfov / 2) * 1.12;   // 全身が縦に収まる高さフィット
        pcam.position.set(0, frameInfo.navelY, radius);
        pcam.lookAt(0, frameInfo.navelY, 0);                      // おへそ(ボーン中心)を注視＝横回転で固定
      }
      pcam.updateProjectionMatrix();
    };
    reframe();
    window.addEventListener('resize', reframe);
    const spin = (dYaw) => { turntable.rotation.y += dYaw; };

    const hintEl = el.querySelector('[data-hint]');

    // 背景の濃淡トグル（黒キャラが暗背景に同化するため）。Studio と同じ localStorage キーを共有。
    const bgBtn = el.querySelector('[data-bg]');
    const applyBg = () => {
      const light = localStorage.getItem('nova_preview_bg') === 'light';
      pscene.background = new THREE.Color(light ? 0xdfe6f0 : 0x0b1020);
      if (bgBtn) bgBtn.textContent = light ? '☀ 淡色' : '🌙 濃色';
    };
    applyBg();
    if (bgBtn) bgBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const light = localStorage.getItem('nova_preview_bg') === 'light';
      localStorage.setItem('nova_preview_bg', light ? 'dark' : 'light');
      applyBg();
    });

    // 回転（スワイプ）。setPointerCapture + pointercancel で確実に連続 360°（dragging の取り残しを防ぐ）。
    const onDown = (e) => {
      if (e.target.closest('[data-back],[data-confirm],[data-bg]')) return;
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      if (hintEl) hintEl.style.display = 'none';
    };
    const onMove = (e) => {
      if (!dragging || !model) return;
      spin((e.clientX - lastX) * 0.01);   // 横回転のみ（左右スワイプ）
      lastX = e.clientX; lastY = e.clientY;
    };
    const onUp = () => { dragging = false; };
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);
    window.addEventListener('pointerup', onUp);

    let raf = 0, last = performance.now(), running = true, libRef = null, model = null, detailWeapon = null;
    const loop = () => {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!dragging && model) spin(dt * 0.35);     // ゆっくり自動回転（横・モデル読込後のみ）
      if (model) { libRef.update(dt); if (libRef.groundToFloor) libRef.groundToFloor(); }   // 横回転は y を変えないので接地と干渉しない
      this.renderer.render(pscene, pcam);
    };
    raf = requestAnimationFrame(loop);

    // モデルを非同期ロード → 全身bbox（バインド姿勢＝全身が確実に入る）で水平中心化＋接地＋採寸してシーンへ。
    (async () => {
      try {
        const lib = new AnimLibrary({ assetVersion: this.assetVersion });
        lib.manifest = this.manifest;
        await lib.loadCharacterDef({ ...char, tint: null }, { assetVersion: this.assetVersion });
        if (!running) { lib.dispose(); return; }
        await lib.loadClips();
        if (!running) { lib.dispose(); return; }
        turntable.add(lib.root);
        lib.play('idle'); lib.update(0);
        if (lib.groundToFloor) lib.groundToFloor();          // 足を床(y=0)へ接地（最下ボーン基準）。以前 全身表示できていた要。
        lib.root.updateMatrixWorld(true);
        const box = new THREE.Box3(), v = new THREE.Vector3();
        lib.root.traverse((o) => { if (o.isBone) { v.setFromMatrixPosition(o.matrixWorld); box.expandByPoint(v); } });
        if (box.isEmpty()) box.setFromObject(lib.root);
        const c = box.getCenter(new THREE.Vector3());
        // 水平中心化＝回転軸を「体の芯＝Hips ボーン」へ。ALIEN は体が前後に偏り奥行きが深く、
        // bbox 中心を軸にすると体が外れて“公転”する。Hips を軸にすれば他キャラ同様に体の中心で回る
        // （他キャラは Hips≒bbox中心なので影響なし）。
        let hb = null;
        lib.root.traverse((o) => { if (o.isBone && hb === null && /hips$/i.test(o.name)) hb = o; });
        let axX = c.x, axZ = c.z;
        if (hb) { hb.getWorldPosition(v); axX = v.x; axZ = v.z; }
        lib.root.position.x -= axX; lib.root.position.z -= axZ;   // 横回転の軸＝Hips（x=z=0）
        // 接地済みなので全身高さ ≈ box.max.y。注視は「高さの52%」(≈おへそ)＝ボーン中心 c.y のズレに頑健。
        const HH = Math.max(box.max.y + 0.25, 1.2);
        frameInfo = { H: HH, navelY: HH * 0.52 };
        libRef = lib; model = lib.root;
        // 武器（registry.weapon）があれば装着＝詳細プレビューでも装備状態を確認できる
        try {
          const w = char.weapon;
          if (w && w.enabled !== false && w.id) {
            const av = this.assetVersion;
            const url = './assets/weapons/' + w.id + '.glb' + (av ? ('?v=' + av) : '');
            detailWeapon = await attachWeapon(lib.root, { url, side: w.side || 'right',
              pos: w.pos || [0, 0, 0], rot: w.rot || [0, 0, 0], scale: (w.scale == null ? 1 : w.scale) });
          }
        } catch (e) { console.warn('preview weapon attach failed', e && (e.message || e)); }
        reframe();
        if (hintEl) hintEl.textContent = '⟲ 左右スワイプで回転';
      } catch (e) {
        console.warn('character preview load failed', e);
        if (hintEl) hintEl.textContent = '⚠ モデル表示に失敗（選択は可能）';
      }
    })();

    const decision = await new Promise((res) => {
      el.querySelector('[data-back]').addEventListener('click', (e) => { e.preventDefault(); res('back'); });
      el.querySelector('[data-confirm]').addEventListener('click', (e) => { e.preventDefault(); res('confirm'); });
    });

    running = false; cancelAnimationFrame(raf);
    window.removeEventListener('resize', reframe);
    el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp); window.removeEventListener('pointerup', onUp);
    el.remove();
    if (detailWeapon) { try { detailWeapon.detach(); } catch (e) {} }
    if (libRef) { try { if (libRef.root) turntable.remove(libRef.root); libRef.dispose(); } catch (e) {} }
    pscene.remove(turntable);
    this._onResize();   // ゲーム用にレンダラ/カメラの aspect を戻す
    return decision;
  }

  _setNetStall(on) {
    if (on && !this._stallEl) {
      const e = document.createElement('div');
      e.textContent = '相手の入力待ち…';
      e.style.cssText = 'position:fixed;top:46%;left:50%;transform:translate(-50%,-50%);z-index:80;background:rgba(10,16,30,.86);color:#ffd24a;padding:11px 20px;border-radius:12px;font-weight:800;font-size:15px;pointer-events:none;border:1px solid rgba(255,210,74,.45)';
      document.body.appendChild(e); this._stallEl = e;
    } else if (!on && this._stallEl) {
      this._stallEl.remove(); this._stallEl = null;
    }
  }

  _teardownArena() {
    if (this.fx) this.fx.clear();
    for (const v of this.views) v.dispose();
    this.views = [];
    if (this.stageView) { this.stageView.dispose(); this.stageView = null; }
    // シーンに残る孤児を掃除（ライト等は stageView が保持）
  }

  // 勝利演出の紙吹雪バースト（DOM・使い捨て・数秒で自動削除）。
  // 色はガチャで装備中の紙吹雪テーマ（未装備は既定パレット）＝テーマの効果が毎勝利で見える。
  _confettiBurst(count = 60) {
    if (!this._confettiCss) {
      const st = document.createElement('style');
      st.textContent = '@keyframes ncburst { 0% { transform:translateY(-8vh) rotate(0deg); opacity:1 } 100% { transform:translateY(112vh) rotate(720deg); opacity:.65 } }';
      document.head.appendChild(st);
      this._confettiCss = st;
    }
    const colors = (this.meta && this.meta.confettiColors()) || ['#ffd24a', '#7fe', '#f86', '#9f7', '#c9f', '#fff'];
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:58;pointer-events:none;overflow:hidden';   // HUD(60台)より下
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      const sz = 6 + Math.random() * 8;
      p.style.cssText = `position:absolute;top:0;left:${Math.random() * 100}%;width:${sz}px;height:${sz * 0.5}px;` +
        `background:${colors[i % colors.length]};opacity:.9;border-radius:2px;` +
        `animation:ncburst ${2.4 + Math.random() * 1.8}s linear ${Math.random() * 0.7}s both`;
      el.appendChild(p);
    }
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5200);   // 最長アニメ(≈4.9s)後に自動削除
  }

  // 試合シーンの描画（Bloom ON なら composer 経由でネオン発光）
  _renderFrame() {
    if (this.ui.settings.bloom) this.composer.render();
    else this.renderer.render(this.scene, this.cam.cam);
  }

  // ================= タイトル画面の3Dキャラ showcase =================
  // タイトルの半透明背景の奥で、ランダムなキャラがスポットライトの中ゆっくり回る（AAA感）。
  _startTitleShowcase() {
    if (this._ts || !this.roster || !this.roster.length) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070e);
    scene.add(new THREE.HemisphereLight(0x9fbfff, 0x141c30, 1.1));
    const key = new THREE.DirectionalLight(0xfff2d8, 1.6); key.position.set(2.5, 5.5, 3.5); scene.add(key);
    const rim = new THREE.DirectionalLight(0x5a8aff, 1.1); rim.position.set(-3, 3, -3); scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.4, 48),
      new THREE.MeshStandardMaterial({ color: 0x0e1526, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const turntable = new THREE.Group(); scene.add(turntable);
    const cam = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 100);
    cam.position.set(0, 1.4, 4.2); cam.lookAt(0, 1.1, 0);
    const ts = { scene, cam, turntable, lib: null, raf: 0, running: true, floor };
    this._ts = ts;
    const onResize = () => { cam.aspect = window.innerWidth / window.innerHeight; cam.updateProjectionMatrix(); };
    window.addEventListener('resize', onResize); ts.onResize = onResize;
    let last = performance.now();
    const loop = () => {
      if (!ts.running) return;
      ts.raf = requestAnimationFrame(loop);
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
      turntable.rotation.y += dt * 0.4;
      if (ts.lib) { ts.lib.update(dt); if (ts.lib.groundToFloor) ts.lib.groundToFloor(); }
      this.renderer.render(scene, cam);
    };
    ts.raf = requestAnimationFrame(loop);
    // キャラを非同期ロード（タイトルを出したまま）。失敗しても背景グラデだけで進行。
    (async () => {
      try {
        const char = this.roster[(Math.random() * this.roster.length) | 0];
        const lib = new AnimLibrary({ assetVersion: this.assetVersion });
        lib.manifest = this.manifest;
        await lib.loadCharacterDef({ ...char, tint: null }, { assetVersion: this.assetVersion });
        if (!ts.running) { lib.dispose(); return; }
        await lib.loadClips();
        if (!ts.running) { lib.dispose(); return; }
        turntable.add(lib.root);
        try { lib.play('idle'); } catch (e) {}
        lib.update(0);
        if (lib.groundToFloor) lib.groundToFloor();
        lib.root.updateMatrixWorld(true);
        const box = new THREE.Box3(), v = new THREE.Vector3();
        lib.root.traverse((o) => { if (o.isBone) { v.setFromMatrixPosition(o.matrixWorld); box.expandByPoint(v); } });
        if (box.isEmpty()) box.setFromObject(lib.root);
        const c = box.getCenter(new THREE.Vector3());
        let hb = null;
        lib.root.traverse((o) => { if (o.isBone && hb === null && /hips$/i.test(o.name)) hb = o; });
        let ax = c.x, az = c.z;
        if (hb) { hb.getWorldPosition(v); ax = v.x; az = v.z; }
        lib.root.position.x -= ax; lib.root.position.z -= az;
        const H = Math.max(box.max.y + 0.25, 1.2);
        cam.position.set(0, H * 0.55, (H / 2) / Math.tan(cam.fov * Math.PI / 360) * 1.25);
        cam.lookAt(0, H * 0.5, 0);
        ts.lib = lib;
      } catch (e) { console.warn('title showcase load failed', e); }
    })();
  }
  _stopTitleShowcase() {
    const ts = this._ts;
    if (!ts) return;
    ts.running = false;
    cancelAnimationFrame(ts.raf);
    window.removeEventListener('resize', ts.onResize);
    if (ts.lib) { try { ts.turntable.remove(ts.lib.root); ts.lib.dispose(); } catch (e) {} }
    try { ts.floor.geometry.dispose(); ts.floor.material.dispose(); } catch (e) {}
    this._ts = null;
  }

  _onResize() {
    this.cam.setAspect(window.innerWidth / window.innerHeight);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.composer) this.composer.setSize(window.innerWidth, window.innerHeight);
  }
}

// 起動
const game = new Game();
game.boot();
window.NOVA = game; // デバッグ用
