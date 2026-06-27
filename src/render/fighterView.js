// =====================================================================
// FighterView — sim の Fighter 状態を AnimLibrary 再生＋トランスフォームに反映。
// 描画は sim を読むだけ（決定論コアには触れない）。技は lib.play(技anim) で再生し、
// duration をフレームデータ(startup+active+recovery)に同期（SPEC §4.1b）。
// =====================================================================

import * as THREE from 'three';
import { AnimLibrary } from '../anim_library.js';
import { ST, DT, CONFIG } from '../core/constants.js';

const _v = new THREE.Vector3();

// 接地を「足ボーン最下点を床へ」毎フレーム追従させる直立系の状態（KO/ダウン/空中は除外）。
const PLANTED = new Set([
  ST.IDLE, ST.WALK, ST.CROUCH, ST.BLOCK, ST.BLOCKSTUN, ST.HITSTUN,
  ST.ATTACK, ST.THROW_START, ST.THROWING, ST.DASH, ST.BACKDASH, ST.SIDESTEP,
  ST.SUPERFREEZE, ST.GETUP, ST.INTRO,
]);

// 状態→ループ系アニメ名
function loopAnim(f) {
  switch (f.state) {
    case ST.WALK: return 'walk';
    case ST.CROUCH: return 'crouch';
    case ST.BLOCK: return 'guard';
    case ST.DASH: return 'walk';
    case ST.BACKDASH: return 'walk';
    case ST.SIDESTEP: return 'dodge';
    case ST.JUMP: return 'jump';
    case ST.IDLE:
    case ST.INTRO:
    default: return 'idle';
  }
}

export class FighterView {
  constructor(scene, fighter, opts = {}) {
    this.scene = scene;
    this.f = fighter;
    this.facingOffset = opts.facingOffset || 0;
    this.lib = new AnimLibrary({ assetVersion: opts.assetVersion, targetHeight: CONFIG.FIGHTER_HEIGHT });
    this.yaw = 0;
    this.yOffset = 0;          // 初期/非直立状態の固定接地オフセット（_measureFoot）
    this._groundY = null;      // 直立中の追従接地オフセット（毎フレーム更新）
    this._footTune = 0;        // registry footOffset による個別微調整
    this._warp = null;         // 攻撃アニメの time-warp 情報（映像の接触を判定に合わせる）
    this.ready = false;
    this._prevMove = null;
    this._prevState = null;
    this._lastFlash = 0;
    this._prevKD = 0;
    this._t = 0;
    this.victoryClip = null;     // 勝利ポーズ（複数パターン）
    this._px = 0; this._pz = 0; this._movingBack = false;
    this.sideColor = opts.sideColor != null ? opts.sideColor : 0x66aaff; // 自分=青/相手=赤の識別色
    this._buildDebug();
    this._buildMarker();
  }

  // 頭上の短い識別ライン（自分=青 / 相手=赤）。本体の色には一切触れない＝元色のまま。
  _buildMarker() {
    this.marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.09, 0.09),
      new THREE.MeshBasicMaterial({ color: this.sideColor }));
    this.scene.add(this.marker);
  }

  async load(manifest, rosterEntry) {
    this.lib.manifest = manifest;
    this._rosterEntry = rosterEntry || {};   // footOffset 等の個別微調整を参照
    // tint:null＝色味を一切変えない（オリジナルの Meshy 色のまま）。識別は頭上ラインで。
    await this.lib.loadCharacterDef({ ...rosterEntry, tint: null }, { assetVersion: rosterEntry.assetVersion });
    this.scene.add(this.lib.root);
    await this.lib.loadClips();
    this.lib.onFinished((name) => this._onFinished(name));
    this.lib.play('idle');
    this.lib.update(0);
    this._footTune = (rosterEntry && typeof rosterEntry.footOffset === 'number') ? rosterEntry.footOffset : 0;
    this._measureFoot();
    this.ready = true;
    return this;
  }

  _measureFoot() {
    // 接地補正（idle 姿勢で1回測って固定オフセット）。
    // Mixamo の足/つま先ボーン（mixamorig:LeftFoot/LeftToeBase 等）を名前で特定して足元を測る。
    // メッシュの余分な底面ジオメトリや、足裏より下にある無関係ボーンに惑わされず接地できる。
    this.lib.root.position.set(0, 0, 0);
    this.lib.root.updateMatrixWorld(true);
    let footY = Infinity, found = false, anyBone = Infinity;
    this.lib.root.traverse((o) => {
      if (!o.isBone) return;
      o.getWorldPosition(_v);
      if (_v.y < anyBone) anyBone = _v.y;
      if (/(foot|toe|ankle)/i.test(o.name)) { found = true; if (_v.y < footY) footY = _v.y; }
    });
    let base;
    if (found) base = -footY;                 // 足ボーン基準（最優先・最も確実）
    else if (Number.isFinite(anyBone)) base = -anyBone; // フォールバック: 全ボーン最下点
    else {                                    // 最終: メッシュ最下点
      const box = new THREE.Box3().setFromObject(this.lib.root);
      base = (box && box.min && Number.isFinite(box.min.y)) ? -box.min.y : 0;
    }
    this.yOffset = base;                       // 個別微調整(_footTune)は render で加算
  }

  // 攻撃アニメの time-warp: クリップ内で接触する位置(contact)を、フレームデータ上で判定が出る
  // 位置(hitFrac)に一致させる。予備動作の長短に依らず「映像が当たった瞬間＝判定/エフェクト」になる。
  // sim は一切変えない（決定論維持）。再生timeを毎フレーム直接セット（actionは timeScale=0 で停止済み）。
  _applyMoveWarp() {
    const w = this._warp; if (!w) return;
    const f = this.f;
    if (f.move !== w.move || (f.state !== ST.ATTACK && f.state !== ST.SUPERFREEZE)) return;
    const act = this.lib.current; if (!act) return;
    const m = f.move;
    const total = (m.startup + m.active + m.recovery) || 1;
    // 判定（飛び道具は発射）が出る瞬間の、技進行に対する割合
    const impactF = m.spawn ? m.spawn.frame : (m.startup + m.active * 0.5);
    const hitFrac = Math.max(0.08, Math.min(0.92, impactF / total));
    // クリップ内で実際に接触する割合。Studioで動作スロット別に設定した manifest 値を最優先、
    // 次に moves.js の move.contact、無ければ既定0.5。
    const meta = this.lib.meta && this.lib.meta[m.anim];
    const cRaw = (meta && typeof meta.contact === 'number') ? meta.contact
      : (typeof m.contact === 'number') ? m.contact : 0.5;
    const cFrac = Math.max(0.05, Math.min(0.95, cRaw));
    const p = Math.max(0, Math.min(1, f.moveFrame / total));
    const cf = (p <= hitFrac) ? (p / hitFrac) * cFrac
      : cFrac + ((p - hitFrac) / (1 - hitFrac)) * (1 - cFrac);
    act.time = cf * w.dur;
  }

  // 現在の姿勢での足/つま先ボーン最下点（ワールドY）。接地の追従に使う。
  _lowestFootY() {
    let y = Infinity;
    this.lib.root.traverse((o) => {
      if (o.isBone && /(foot|toe|ankle)/i.test(o.name)) { o.getWorldPosition(_v); if (_v.y < y) y = _v.y; }
    });
    return Number.isFinite(y) ? y : null;
  }

  _onFinished(name) {
    // 単発アニメ終了 → idle へ（state がまだ idle 等なら）。sim 側が状態管理するので軽く戻すだけ。
    const f = this.f;
    if (f.state === ST.IDLE || f.state === ST.WALK) this.lib.play('idle');
  }

  // 状態遷移を見て1発アニメをトリガ
  _syncAnim() {
    const f = this.f;
    const committed = (f.state === ST.ATTACK || f.state === ST.THROW_START || f.state === ST.THROWING || f.state === ST.SUPERFREEZE);

    // 技の発動（move オブジェクトの切替で検知＝オートコンボの各段も拾う）
    if (committed && f.move && f.move !== this._prevMove) {
      const anim = f.move.type === 'super' ? 'super' : (f.move.anim || 'punch_jab');
      // 打撃/必殺は time-warp（再生timeを手動駆動して映像の接触を判定の瞬間に合わせる）。投げは従来どおり。
      const warpable = f.move.type !== 'throw' && (f.state === ST.ATTACK || f.state === ST.SUPERFREEZE);
      if (warpable) {
        this.lib.play(anim, { fade: 0.06, restart: true });
        const act = this.lib.current;
        if (act && act.getClip) { act.setEffectiveTimeScale(0); const clip = act.getClip(); this._warp = { move: f.move, dur: (clip && clip.duration) || 1 }; }
        else this._warp = null;
      } else {
        const total = (f.move.startup + f.move.active + f.move.recovery) / 60;
        this.lib.play(anim, { duration: Math.max(0.2, total), fade: 0.06, restart: true });
        this._warp = null;
      }
      this._prevMove = f.move;
      this._prevState = f.state;
      return;
    }
    if (!committed) { this._prevMove = null; this._warp = null; }

    // 被弾・ダウン系（hitFlash の立ち上がり or 状態遷移で）
    if (f.hitFlash > this._lastFlash) {
      const lvl = f.lastHitLevel;
      const clip = f.state === ST.LAUNCH ? 'launch'
        : f.state === ST.THROWN ? 'thrown'
        : f.state === ST.KNOCKDOWN ? 'knockdown'
        : f.state === ST.KO ? 'ko'
        : (lvl === 'high' ? 'hit_high' : lvl === 'low' ? 'hit_low' : 'hit_mid');
      this.lib.play(clip, { fade: 0.05, restart: true });
      this._lastFlash = f.hitFlash;
      this._prevState = f.state;
      this._lastFlash = f.hitFlash;
    }
    this._lastFlash = f.hitFlash;

    // 状態遷移（1発系）
    if (f.state !== this._prevState) {
      if (f.state === ST.KNOCKDOWN) this.lib.play('knockdown', { fade: 0.06, restart: true });
      else if (f.state === ST.GETUP) this.lib.play('getup', { fade: 0.08, restart: true });
      else if (f.state === ST.KO) this.lib.play('ko', { fade: 0.06, restart: true });
      else if (f.state === ST.WIN) this.lib.play(this.victoryClip || 'win', { fade: 0.2, timeScale: 0.9, restart: true });
      else if (f.state === ST.THROWN) this.lib.play('thrown', { fade: 0.05, restart: true });
      else if (f.state === ST.LAUNCH) this.lib.play('launch', { fade: 0.05, restart: true });
      else if (f.state === ST.JUMP) this.lib.play('jump', { fade: 0.05, restart: true });
      else if (!committed) {
        this.lib.play(this._locoName(f), { fade: 0.12 });
      }
      this._prevState = f.state;
    } else if (!committed && (f.state === ST.IDLE || f.state === ST.WALK || f.state === ST.BLOCK || f.state === ST.CROUCH)) {
      // 継続ループ（idle/walk/guard/crouch）を維持。play() が同一ループを dedup。
      const la = this._locoName(f);
      if (this.lib.currentName !== la) this.lib.play(la, { fade: 0.12 });
    }
  }

  // ロコモーション名: 後退中は前傾の歩行ではなく上体を起こした退き(idle)に
  _locoName(f) {
    if (f.state === ST.WALK && this._movingBack) return this.lib.has('walk_back') ? 'walk_back' : 'idle';
    return loopAnim(f);
  }

  setVictory(clip) { this.victoryClip = clip; }

  // 毎描画フレーム。dt=可変（見た目のみ）。timeScale=演出スロー用。
  render(dt, timeScale = 1) {
    if (!this.ready) return;
    const f = this.f;
    // 進行方向（前進=相手方向 / 後退）を速度から判定し、後退は別モーションに
    const ddx = f.x - this._px, ddz = f.z - this._pz;
    this._movingBack = (ddx * f.fx + ddz * f.fz) < -0.0008;
    this._px = f.x; this._pz = f.z;
    this._syncAnim();

    // 向き（相手方向へ滑らかに）。committed 中は固定向きを尊重しつつ滑らかに。
    let target = f.facing + this.facingOffset;
    let d = target - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, CONFIG.TURN_RATE * dt);
    this.lib.root.rotation.y = this.yaw;

    // 攻撃中は再生timeを判定に合わせて手動セット（time-warp）→ その姿勢へ更新
    this._applyMoveWarp();
    this.lib.update(dt * timeScale);

    // 接地: 直立系かつ地上は、足ボーン最下点を毎フレーム床(y=0)へ合わせる＝姿勢に関わらず確実に接地。
    // 空中(ジャンプ/打上げ)・ダウン/KO の寝姿勢は固定オフセット(this.yOffset)を使う。
    this.lib.root.position.set(f.x, 0, f.z);
    this.lib.root.updateMatrixWorld(true);
    if (!f.airborne && Math.abs(f.y) < 0.02 && PLANTED.has(f.state)) {
      const fy = this._lowestFootY();
      if (fy != null) this._groundY = -fy;
    }
    const gy = (this._groundY != null ? this._groundY : this.yOffset) + this._footTune;
    this.lib.root.position.y = f.y + gy;

    // 頭上の識別ライン（頭の少し上）
    this._t += dt;
    if (this.marker) this.marker.position.set(f.x, (f.y || 0) + 2.65, f.z);

    this._updateDebug();
  }

  // ---- デバッグ box ----
  _buildDebug() {
    this.dbg = new THREE.Group(); this.dbg.visible = CONFIG.DEBUG_BOXES; this.scene.add(this.dbg);
    this.dbgHurt = new THREE.Mesh(
      new THREE.CapsuleGeometry(CONFIG.HURT_RADIUS, CONFIG.HURT_TOP - CONFIG.HURT_BOT, 4, 10),
      new THREE.MeshBasicMaterial({ color: 0x44ff88, wireframe: true }));
    this.dbg.add(this.dbgHurt);
    this.dbgHit = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff4444, wireframe: true }));
    this.dbgHit.visible = false; this.dbg.add(this.dbgHit);
  }

  _updateDebug() {
    this.dbg.visible = CONFIG.DEBUG_BOXES;
    if (!CONFIG.DEBUG_BOXES) return;
    const hurt = this.f.getHurt();
    this.dbgHurt.position.set(hurt.x, (hurt.top + hurt.bot) / 2, hurt.z);
    this.dbgHurt.scale.set(1, (hurt.top - hurt.bot) / (CONFIG.HURT_TOP - CONFIG.HURT_BOT) || 1, 1);
    const hb = this.f.getHitbox();
    if (hb) { this.dbgHit.visible = true; this.dbgHit.position.set(hb.x, hb.y, hb.z); this.dbgHit.scale.setScalar(hb.r); }
    else this.dbgHit.visible = false;
  }

  dispose() {
    this.lib.dispose();
    if (this.dbg.parent) this.dbg.parent.remove(this.dbg);
    if (this.marker && this.marker.parent) this.marker.parent.remove(this.marker);
  }
}
