// =====================================================================
// NOVA CLASH — エントリ / オーケストレーション。
// 決定論コア(sim) を固定60fpsで回し、描画(three)・UI・入力・AI を統合する。
// モード: アーケード / 対CPU / ローカル2P / トレーニング。
// =====================================================================

import * as THREE from 'three';
import { DT, CONFIG, ST } from './core/constants.js';
import { Match, emptyIntent } from './core/sim.js';
import { FighterAI } from './core/ai.js';
import { loadRegistry } from './data/registry.js';
import { STAGES, getStage } from './data/stages.js';
import { FighterView } from './render/fighterView.js';
import { GameCamera } from './render/camera.js';
import { StageView } from './render/stageView.js';
import { FX } from './render/fx.js';
import { AudioKit } from './render/audio.js';
import { HUD } from './ui/hud.js';
import { GameUI } from './ui/menus.js';
import { Controller, Keyboard, KEYMAP_P1, KEYMAP_P2, buildIntent, heldOnly } from './input/controls.js';
import { TouchControls, isTouchDevice } from './input/touch.js';
import { GyroControls } from './input/gyro.js';
import { NetGame } from './net/online.js';
import { AnimLibrary } from './anim_library.js';

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

    // --- UI / 音 ---
    this.ui = new GameUI();
    this.audio = new AudioKit();
    this.hud = new HUD(); this.hud.el.style.display = 'none';

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
    this._mainFlow();
  }

  async _mainFlow() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await this.ui.title();
      this.audio.resume(); this.audio.startMusic();
      let back = false;
      while (!back) {
        const mode = await this.ui.mainMenu();
        if (mode === 'options') { await this.ui.options(this.audio, (d) => { CONFIG.DEBUG_BOXES = d; }); continue; }
        if (mode === 'online') { await this._runOnline(); continue; }
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
    if (r.aborted) return;          // 「メニューに戻る」で中断 → リザルトを出さず戻る
    if (mode === 'training') return;
    const won = r.winner === 0;
    const action = await this.ui.result(
      mode === 'local2p' ? (won ? '1P WIN' : '2P WIN') : (won ? 'YOU WIN' : 'YOU LOSE'),
      won ? '#7fe' : '#f86',
      [`${a.name} vs ${b.name}`, setup.stage.nameJa],
      [{ id: 'rematch', label: '再戦' }, { id: 'menu', label: 'メニューへ' }]);
    if (action === 'rematch') return this._runMode(mode, setup);
  }

  async _runArcade(setup) {
    const player = setup.p1;
    const pool = this.roster.filter((c) => c.id !== player.id);
    const order = []; const rng = (() => { let s = 7; return () => (s = (s * 9301 + 49297) % 233280) / 233280; })();
    const shuffled = pool.slice().sort(() => rng() - 0.5);
    for (const c of shuffled) order.push(c);
    let stage = setup.stage; let beaten = 0;
    for (let i = 0; i < order.length; i++) {
      const opp = order[i];
      const diff = Math.min(2, setup.difficulty + (i >= order.length - 1 ? 1 : 0)); // 最終戦=ボス強化
      const isBoss = i === order.length - 1;
      const r = await this._playMatch(player, opp, stage, new HumanAgent(this.c1), new AIAgent(diff), { mode: 'arcade', boss: isBoss, bannerSub: `戦 ${i + 1}/${order.length}` });
      if (r.aborted) return;         // 「メニューに戻る」で中断
      if (r.winner !== 0) {
        const act = await this.ui.result('YOU LOSE', '#f86', [`${beaten} 人撃破`, `${order.length} 人中`], [{ id: 'rematch', label: 'コンティニュー' }, { id: 'menu', label: 'メニューへ' }]);
        if (act === 'rematch') { i--; continue; } else return;
      }
      beaten++;
      stage = STAGES[(STAGES.indexOf(stage) + 1) % STAGES.length]; // 次戦は別ステージ
    }
    await this.ui.result('ARCADE CLEAR!', '#ffd24a', [`全 ${order.length} 人撃破`, '🏆'], [{ id: 'menu', label: 'メニューへ' }]);
  }

  // ================= 1試合 =================
  async _playMatch(rA, rB, stage, agent0, agent1, opts = {}) {
    const ld = this.ui.loading('ファイター読込');
    this._training = !!opts.training;
    // sim（トレーニングは実質エンドレス）
    this.match = new Match(rA, rB, stage, opts.training
      ? { seed: 20260622, roundTime: 999, roundsToWin: 99 }
      : { seed: 20260622, roundTime: CONFIG.ROUND_TIME });
    // 描画リソース
    this._teardownArena();
    this.cam.endVictory();
    this.stageView = new StageView(this.scene, stage, { lowSpec: this.coarse });
    this.fx = new FX(this.scene, this.cam);
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
    const tag1 = p2Human ? '（1P）' : '（あなた）';
    const tag2 = p2Human ? '（2P）' : '（CPU）';
    this.hud.setup(this.match, [rA.nameJa + ' ' + tag1, rB.nameJa + ' ' + tag2], [rA.label, rB.label], CONFIG.ROUNDS_TO_WIN,
      opts.training ? 'TRAINING ・ 左右=移動 上=奥へ回避 下=しゃがみ ・ H:判定 P:ポーズ'
        : '左右=移動  上=奥へ回避  下=しゃがみ  ・  P/Esc:ポーズ  H:判定');
    this.hud.showBanner('ROUND ' + this.match.round, opts.bannerSub || (rA.nameJa + ' vs ' + rB.nameJa), '#fff', 1.6);

    // 入力表示
    if (this.touch) this.touch.show(true);
    this.agents = [agent0, agent1];
    this.ui.hide();

    // ループ実行（Promise が match 終了で解決）
    const winner = await this._loopUntilMatchEnd(opts);
    this._disarmContinue();
    if (this.touch) this.touch.show(false);
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
          // KO演出後はダンスを流し続け、入力があるまで次へ進まない
          if (this.match.canProceed) this._armContinue();

          // 描画 timeScale（ヒットストップ/スローで止め感）
          const rts = this.match.hitstop > 0 || this.match.superFreeze > 0 ? 0.04 : slow;
          for (const v of this.views) v.render(dt, rts);
          this.fx.syncProjectiles(this.match.projectiles);
          this.fx.update(dt);
          this.cam.update(dt, this.match.fighters[0], this.match.fighters[1]);
          this.hud.update(dt);
          if (this.touch) {
            const f = this.match.fighters[0];
            this.touch.setAvailability({
              P: true, K: true,                       // P/K は常時使用可（段はフリックで撃ち分け）
              S: f.gauge >= CONFIG.THRESH_S, SP: f.sp >= CONFIG.SP_MAX,
            });
          }
          this.c1.endFrame(); this.c2.endFrame();
        }
        this.renderer.render(this.scene, this.cam.cam);

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
      onHit: (e) => { this.audio.hit(e.level, (e.dmg || 0) >= 16); if (e.who !== undefined) this.hud.flashVignette(e.who); if (e.combo >= 2) this.hud.popCombo(e.combo); if (navigator.vibrate && e.who === 0) navigator.vibrate(e.dmg >= 16 ? 30 : 12); },
      onBlock: () => this.audio.block(),
      onClash: () => this.audio.clash(),
      onFire: (e) => this.audio.fire(e.kind),
      onKO: () => this.audio.ko(),     // とどめの衝撃音（勝利ジングルは演出が確定する 'victory' で）
    });
    for (const e of events) {
      if (e.type === 'round_start') { this.hud.showBanner('FIGHT!', '', '#ffd24a', 0.9); this.cam.endVictory(); }
      if (e.type === 'throw') this.audio.throwSfx();
      if (e.type === 'victory') {
        // 勝者の勝利ポーズ（複数パターンをラウンドで変える）＋勝利カメラ＋軽快な音楽
        const w = this.match.fighters[e.winner];
        const pose = VICTORY_POSES[(this.match.round + e.winner) % VICTORY_POSES.length];
        if (this.views[e.winner]) this.views[e.winner].setVictory(pose);
        this.cam.startVictory(w);
        this.audio.victory();
        this.hud.showBanner('WIN!', w.roster.nameJa, '#ffd24a', 2.4);
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
        else if (act === 'rematch') { this.paused = false; this.ui.hide(); this.match._placeStart(); for (const f of this.match.fighters) { f.hp = f.maxHp; f.gauge = 0; } this.match.wins = [0, 0]; this.match.round = 1; this.match.timer = this.match.roundTimeMax; this.match.phase = ST.INTRO; this.match.phaseFrame = 0; this._last = performance.now(); }
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

    // 5) リザルト
    if (winner >= 0) {
      const youWon = winner === net.localPlayer;
      await ui.result(youWon ? 'YOU WIN' : 'YOU LOSE', youWon ? '#ffd24a' : '#f86', ['オンライン対戦'], [{ id: 'menu', label: 'メニューへ' }]);
    }
    ui.hide();
  }

  async _playOnlineMatch(net, cfg) {
    const ui = this.ui;
    const rA = this.roster.find((c) => c.id === cfg.aId) || this.roster[0];
    const rB = this.roster.find((c) => c.id === cfg.bId) || this.roster[1];
    const stage = getStage(cfg.stageId) || STAGES[0];
    const youIdx = net.localPlayer;

    const ld = ui.loading('対戦相手と同期');
    // 決定論シム（共有 seed）。両ピアで完全一致する。
    this.match = new Match(rA, rB, stage, { seed: cfg.seed, roundTime: CONFIG.ROUND_TIME });
    net.attachMatch(this.match);

    this._teardownArena();
    this.cam.endVictory();
    this.stageView = new StageView(this.scene, stage, { lowSpec: this.coarse });
    this.fx = new FX(this.scene, this.cam);
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
        this.renderer.render(this.scene, this.cam.cam);

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

    // 全身を腰（中央高さ）中心で収めるフレーミング。縦/横どちらでも全身が入るよう aspect を見て
    // 「縦フィット距離」と「横フィット距離」の大きい方に合わせる。リサイズ/回転でも追従。
    let frameInfo = null;   // { H, W }
    const reframe = () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setSize(w, h);
      pcam.aspect = w / h;
      if (frameInfo) {
        const cy = frameInfo.H * 0.5;                       // 腰 ≈ 中央高さ を注視
        const vfov = pcam.fov * Math.PI / 180;
        // 高さフィット（全身が必ず縦に収まる）。idle は立ち姿勢で常に縦長なので横クリップしない。
        const dist = (frameInfo.H / 2) / Math.tan(vfov / 2) * 1.16;
        pcam.position.set(0, cy, dist);
        pcam.lookAt(0, cy, 0);
      }
      pcam.updateProjectionMatrix();
    };
    reframe();
    window.addEventListener('resize', reframe);

    let rotY = Math.PI * 0.08, dragging = false, lastX = 0;
    const hintEl = el.querySelector('[data-hint]');
    const onDown = (e) => { if (e.target.closest('[data-back],[data-confirm]')) return; dragging = true; lastX = e.clientX; if (hintEl) hintEl.style.display = 'none'; };
    const onMove = (e) => { if (dragging) { rotY += (e.clientX - lastX) * 0.012; lastX = e.clientX; } };
    const onUp = () => { dragging = false; };
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);

    let raf = 0, last = performance.now(), running = true, libRef = null, model = null;
    const loop = () => {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!dragging) rotY += dt * 0.35;            // ゆっくり自動回転
      if (model) { libRef.update(dt); model.rotation.y = rotY; }
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
        pscene.add(lib.root);
        lib.play('idle'); lib.update(0); lib.root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(lib.root);
        const ctr = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
        lib.root.position.x -= ctr.x; lib.root.position.z -= ctr.z; lib.root.position.y -= box.min.y;
        frameInfo = { H: sz.y || 1.8, W: Math.max(sz.x, sz.z) || 0.6 };
        libRef = lib; model = lib.root;
        reframe();
        if (hintEl) hintEl.textContent = '⟲ ドラッグで360°回転';
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
    el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
    el.remove();
    if (libRef) { try { if (libRef.root) pscene.remove(libRef.root); libRef.dispose(); } catch (e) {} }
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

  _onResize() {
    this.cam.setAspect(window.innerWidth / window.innerHeight);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

// 起動
const game = new Game();
game.boot();
window.NOVA = game; // デバッグ用
