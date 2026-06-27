// =====================================================================
// NOVA CLASH — 決定論シミュレーション（THREE 非依存・純ロジック）
// Match.step(intentA, intentB) を 1/60s 固定で回す。描画はこの状態を読むだけ。
// SPEC §13 の受入基準（決定論/当たり/段/フレーム/コンボ/投げ/空中/弾/リング/KO）を満たす。
// =====================================================================

import { CONFIG, DT, TICK_HZ, ST, LEVEL, GUARD_BLOCKS } from './constants.js';
import { makeRng } from './rng.js';
import { MOVES, AUTO_COMBO, resolveAttackMove } from '../data/moves.js';
import { getSpecial, PROJECTILES } from '../data/specials.js';

const START_SEP = 3.4;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hypot = Math.hypot;

// 空の intent（AI/プレイヤ未入力時）
export function emptyIntent() {
  // moveX = 画面の左右(=ワールドX, 接近/後退) / moveZ = 画面の奥行き(=ワールドZ, サイドステップ)
  // 画面絶対座標（カメラは常に +Z 側の安定サイドビュー）。
  return { moveX: 0, moveZ: 0, up: false, down: false, guard: false,
    P: false, K: false, S: false, jump: false, grab: false, superBtn: false,
    atkLevel: null, // P/K の段（'high'|'mid'|'low'）。null=未指定→up/downから導出（AI/キーボード）
    dashF: false, dashB: false, stepL: false, stepR: false, dashX: 0, stepZ: 0 };
}

// ---------------------------------------------------------------------
// Fighter（純データ）
// ---------------------------------------------------------------------
export class Fighter {
  constructor(index, roster) {
    this.index = index;
    this.roster = roster;
    const stats = roster.stats || {};
    this.maxHp = stats.maxHp || CONFIG.MAX_HP;
    this.weight = stats.weight || 1;
    this.walkSpeed = CONFIG.WALK_SPEED * (stats.walkMul || 1);
    this.backSpeed = CONFIG.BACK_SPEED * (stats.backMul || 1);
    this.sideSpeed = CONFIG.SIDE_SPEED * (stats.sideMul || 1);
    // 必殺/スーパー定義を解決
    this.specialDefs = {};
    for (const slot of ['S', 'upS', 'downS']) {
      const id = roster.specials && roster.specials[slot];
      if (id) this.specialDefs[slot] = getSpecial(id);
    }
    this.superDef = roster.super ? getSpecial(roster.super) : null;
    this.reset(0, 0, 1);
  }

  reset(x, z, dir) {
    this.x = x; this.z = z; this.y = 0; this.vy = 0; this.airborne = false;
    this.facing = dir >= 0 ? 0 : Math.PI;     // yaw（描画用）
    this.fx = dir >= 0 ? 1 : -1; this.fz = 0; // 前方単位ベクトル（相手方向）
    this.hp = this.maxHp;
    this.gauge = CONFIG.START_CHARGE;   // 攻撃チャージ（0..GAUGE_MAX）time制
    this.sp = 0;                        // SPゲージ（0..SP_MAX）戦闘で蓄積→ウルトラ
    this.state = ST.IDLE;
    this.stateFrame = 0;
    this.move = null; this.moveFrame = 0; this.hitDone = false;
    this.atkFx = this.fx; this.atkFz = this.fz; // 攻撃時に固定する前方
    this.stun = 0;
    this.crouch = false;
    this.guardStance = null;     // 'stand'|'crouch'|null
    this.comboCount = 0; this.scaling = CONFIG.SCALING_START;
    this.cooldowns = {};
    this.usedAirAttack = false;
    this.hitFlash = 0;           // 描画用
    this.lastHitLevel = null;
    this.knockdownTimer = 0;
    this.airAttackLandCancel = false;
    this.facingDir = dir >= 0 ? 1 : -1;
    this._grabBuf = 0;           // 投げ抜け入力バッファ
    this._koVx = 0; this._koVz = 0; // KO 時の後方放物線速度
  }

  get actionable() {
    return this.state === ST.IDLE || this.state === ST.WALK || this.state === ST.CROUCH ||
      this.state === ST.BLOCK || this.state === ST.DASH || this.state === ST.BACKDASH ||
      this.state === ST.SIDESTEP;
  }

  // ---- 1 tick 進行（相手・intent・rng・projectiles を受け取る） ----
  tick(opp, intent, match) {
    this.stateFrame++;
    if (this.hitFlash > 0) this.hitFlash--;
    if (this._grabBuf > 0) this._grabBuf--;
    if (intent.grab) this._grabBuf = CONFIG.THROW_TECH_WINDOW; // 投げ抜け受付
    // 攻撃チャージは時間で蓄積（10秒でMAX）。KO/勝利中は止める。
    if (this.state !== ST.KO && this.state !== ST.WIN && this.gauge < CONFIG.GAUGE_MAX) {
      this.gauge = Math.min(CONFIG.GAUGE_MAX, this.gauge + CONFIG.CHARGE_REGEN);
    }
    for (const k in this.cooldowns) if (this.cooldowns[k] > 0) this.cooldowns[k]--;

    this._vertical();

    // 対面（committed 状態でも論理上は相手を向く。ただし攻撃中は前方固定）
    this._face(opp);

    if (this.state === ST.KO || this.state === ST.WIN) { return; }

    // 硬直・特殊状態の進行
    if (this._advanceLockedStates(opp, intent, match)) return;

    if (!this.actionable) return;

    // ---- 行動可能 ----
    // ガード（地上のみ）。しゃがみガードは ガード+下。移動中はしゃがみ状態にしない（自由移動）。
    if (intent.guard && !this.airborne) {
      this.state = ST.BLOCK;
      this.guardStance = intent.down ? 'crouch' : 'stand';
    } else {
      this.guardStance = null;
      if (this.state === ST.BLOCK) { this.state = ST.IDLE; this.stateFrame = 0; }
    }

    // 攻撃・必殺・投げ要求（ガード中でも攻撃でガードキャンセル可）
    const req = this._requestedAttack(intent);
    if (req) { this._startAttack(req, opp, match); return; }

    if (this.state === ST.BLOCK) return; // ガード継続

    // ジャンプ
    if (intent.jump && !this.airborne) {
      this.vy = CONFIG.JUMP_VEL; this.airborne = true; this.usedAirAttack = false;
      this.state = ST.JUMP; this.stateFrame = 0; return;
    }
    // ダッシュ（ワールドX）/ サイドステップ（ワールドZ）。画面絶対 dashX/stepZ と
    // 相対 dashF/dashB/stepL/stepR(AI互換) の両方を受ける。
    if (!this.airborne) {
      const tgt = Math.sign(opp.x - this.x) || 1;
      let dvx = intent.dashX || 0;
      if (intent.dashF) dvx = tgt; if (intent.dashB) dvx = -tgt;
      let dvz = intent.stepZ || 0;
      if (intent.stepL) dvz = 1; if (intent.stepR) dvz = -1;
      if (dvx) { this.state = ST.DASH; this.stateFrame = 0; this._dvx = dvx; }
      else if (dvz) { this.state = ST.SIDESTEP; this.stateFrame = 0; this._dvz = dvz; }
    }

    // 移動
    this._move(intent, opp, match);
  }

  _vertical() {
    if (!this.airborne && this.vy === 0 && this.y === 0) return;
    this.vy -= CONFIG.GRAVITY * DT;
    this.y += this.vy * DT;
    if (this.y <= 0) {
      this.y = 0; this.vy = 0;
      const wasAir = this.airborne;
      this.airborne = false;
      // 着地: 空中攻撃の着地キャンセル or 通常復帰
      if (wasAir && (this.state === ST.JUMP)) { this.state = ST.IDLE; this.stateFrame = 0; }
      if (wasAir && this.state === ST.ATTACK && this.move && this.move.landCancel) {
        this.state = ST.IDLE; this.move = null; this.stateFrame = 0;
      }
      if (wasAir && this.state === ST.LAUNCH) { this._toKnockdown(); }
    }
  }

  _face(opp) {
    const committed = this.state === ST.ATTACK || this.state === ST.THROW_START ||
      this.state === ST.THROWING || this.state === ST.SUPERFREEZE;
    const dx = opp.x - this.x, dz = opp.z - this.z;
    const d = hypot(dx, dz) || 1;
    if (!committed) { this.fx = dx / d; this.fz = dz / d; this.facingDir = dx >= 0 ? 1 : -1; }
    // 描画 yaw（相手方向）
    this.facing = Math.atan2(dx, dz);
  }

  _advanceLockedStates(opp, intent, match) {
    const s = this.state;
    if (s === ST.HITSTUN || s === ST.BLOCKSTUN) {
      this.stun--;
      if (this.stun <= 0) { this.state = ST.IDLE; this.stateFrame = 0; this.comboCount = 0; this.scaling = CONFIG.SCALING_START; }
      return true;
    }
    if (s === ST.LAUNCH) {
      // 空中やられ。着地で knockdown（_vertical が処理）
      return true;
    }
    if (s === ST.SUPERFREEZE) {
      this.stun--;
      if (this.stun <= 0) { this.state = ST.ATTACK; this.stateFrame = 0; this.moveFrame = 0; }
      return true;
    }
    if (s === ST.KNOCKDOWN) {
      this.knockdownTimer--;
      if (this.knockdownTimer <= 0) { this.state = ST.GETUP; this.stateFrame = 0; }
      return true;
    }
    if (s === ST.GETUP) {
      if (this.stateFrame >= 18) { this.state = ST.IDLE; this.stateFrame = 0; }
      return true;
    }
    if (s === ST.THROWN) {
      if (this.stateFrame >= 6) { this._toKnockdown(); }
      return true;
    }
    if (s === ST.JUMP) {
      // 空中: 攻撃要求を受ける
      const req = this._requestedAttack(intent);
      if (req && req.kind === 'normal' && !this.usedAirAttack) { this._startAttack(req, opp, match); return true; }
      this._airMove(intent, opp);
      return true;
    }
    if (s === ST.ATTACK || s === ST.THROW_START || s === ST.THROWING) {
      this._advanceAttack(opp, intent, match);
      return true;
    }
    if (s === ST.DASH || s === ST.BACKDASH || s === ST.SIDESTEP) {
      this._advanceStep(opp, match);
      // ステップ中も攻撃で割り込み可
      if (this.actionable) {
        const req = this._requestedAttack(intent);
        if (req) { this._startAttack(req, opp, match); return true; }
      }
      return this.state !== ST.IDLE; // IDLE に戻ったら通常処理へ
    }
    return false;
  }

  _advanceStep(opp, match) {
    const f = this.stateFrame;
    if (this.state === ST.DASH) {
      const towardX = Math.sign(opp.x - this.x) || 1;
      const sp = (Math.sign(this._dvx) === towardX ? CONFIG.DASH_SPEED : CONFIG.BACKDASH_SPEED) * DT;
      this.x += (this._dvx || 1) * sp;
      if (f >= CONFIG.DASH_FRAMES) { this.state = ST.IDLE; this.stateFrame = 0; }
    } else if (this.state === ST.SIDESTEP) {
      this.z += (this._dvz || 1) * this.sideSpeed * 1.5 * DT;
      if (f >= CONFIG.SIDESTEP_FRAMES) { this.state = ST.IDLE; this.stateFrame = 0; }
    }
    this._resolvePush(opp); this._clampStage(match);
  }

  // 空中横移動（画面絶対）
  _airMove(intent, opp) {
    const ix = intent.moveX, iz = intent.moveZ;
    if (ix === 0 && iz === 0) return;
    const sp = this.walkSpeed * CONFIG.AIR_CONTROL * DT;
    this.x += ix * sp; this.z += iz * sp;
  }

  // ---- 移動（地上・画面絶対座標）----
  //   moveX = 左右(ワールドX, 接近/後退)  moveZ = 奥行き(ワールドZ, サイドステップ)
  _move(intent, opp, match) {
    const ix = intent.moveX, iz = intent.moveZ;   // 画面準拠の自由移動（左右=接近/後退, 上下=奥行き）
    if (ix === 0 && iz === 0) {
      if (this.state === ST.WALK) { this.state = ST.IDLE; this.stateFrame = 0; }
      return;
    }
    if (this.state !== ST.BLOCK) this.state = ST.WALK;
    const towardX = Math.sign(opp.x - this.x) || 1;
    const xsp = (Math.sign(ix) === towardX ? this.walkSpeed : this.backSpeed) * DT;
    this.x += ix * xsp;
    this.z += iz * this.sideSpeed * DT;
    this._resolvePush(opp); this._clampStage(match);
  }

  // ---- 攻撃の要求解決（チャージで使用可否を判定。SPEC §2.8-3 発展）----
  //   continuing=true はコンボ継続（しきい値ではなくコストのみ確認）
  _requestedAttack(intent, continuing = false) {
    // ウルトラ(SP)は SP ゲージ MAX が条件（攻撃チャージとは別資源）
    if (intent.superBtn && this.superDef && this.sp >= CONFIG.SP_MAX) {
      return { kind: 'super', def: this.superDef, id: this.superDef.id };
    }
    if (intent.S) {
      if (this.gauge < CONFIG.THRESH_S) return null;     // 必殺はチャージMAX必須
      const slot = intent.up ? 'upS' : intent.down ? 'downS' : 'S';
      const def = this.specialDefs[slot];
      if (def) return { kind: 'special', def, id: def.id, slot };
      return null;
    }
    if (intent.grab) {
      return { kind: 'throw', def: MOVES.throw, id: 'throw' };  // 投げはチャージ不要
    }
    if (intent.P || intent.K) {
      const btn = intent.P ? 'P' : 'K';
      // 段: フリック由来の atkLevel を優先。未指定なら up/down から導出（AI/キーボード）。
      const level = intent.atkLevel || (intent.up ? 'high' : intent.down ? 'low' : 'mid');
      let id = resolveAttackMove(btn, level, this.airborne);
      if (!id) id = AUTO_COMBO[btn];
      const def = MOVES[id];
      if (!def) return null;
      // P/K は常時使用可（チャージ不要）。段はフリックで撃ち分け、連打でコンボ。
      void continuing;
      return { kind: 'normal', def, id };
    }
    return null;
  }

  _startAttack(req, opp, match) {
    const def = req.def;
    this.atkFx = this.fx; this.atkFz = this.fz;
    this.move = def; this.moveFrame = 0; this.hitDone = false;
    if (this.airborne) this.usedAirAttack = true;

    if (req.kind === 'super') {
      this.sp = 0;                       // ウルトラは SP を全消費
      this.state = ST.SUPERFREEZE; this.stun = 2; this.stateFrame = 0;
      if (match) match.superFreeze = Math.max(match.superFreeze || 0, def.freeze || 30);
      return;
    }
    if (req.kind === 'special') {
      this.gauge = Math.max(0, this.gauge - CONFIG.COST_S);   // 必殺=全消費（チャージはS専用資源）
    }
    // 通常技(P/K)はチャージ非消費＝常時使用可
    if (req.kind === 'throw' || def.type === 'throw') {
      this.state = ST.THROW_START; this.stateFrame = 0; return;
    }
    this.state = ST.ATTACK; this.stateFrame = 0;
  }

  _advanceAttack(opp, intent, match) {
    const m = this.move;
    if (!m) { this.state = ST.IDLE; return; }
    this.moveFrame++;
    const f = this.moveFrame;
    const total = m.startup + m.active + m.recovery;
    const inActive = f > m.startup && f <= m.startup + m.active;

    // lunge（active 中前進）
    if (inActive && m.lunge) {
      const step = m.lunge * CONFIG.SCALE / m.active;
      this.x += this.atkFx * step; this.z += this.atkFz * step;
      this._resolvePush(opp); this._clampStage(match);
    }

    // 飛び道具の発射
    if (m.spawn && f === m.spawn.frame && match) {
      match.spawnProjectile(this, m, opp);
    }

    // キャンセル / オートコンボ（active 開始〜recovery 内で次入力を受付＝アクセシブル）
    if (this.state === ST.ATTACK && f > m.startup) {
      const next = this._cancelTarget(intent, m);
      if (next) { this._startAttack(next, opp, match); return; }
    }

    // 投げの成立判定
    if ((this.state === ST.THROW_START) && f > m.startup && f <= m.startup + m.active && match) {
      match.tryThrow(this, opp, m);
      if (this.state === ST.THROWING) return;
    }

    if (f >= total) {
      this.move = null; this.moveFrame = 0;
      this.state = this.airborne ? ST.JUMP : ST.IDLE;
      this.stateFrame = 0;
    }
  }

  // 次に出せるキャンセル先（オートコンボ chain or 手動 cancelInto）
  _cancelTarget(intent, m) {
    const req = this._requestedAttack(intent, true); // コンボ継続=しきい値でなくコストのみ
    if (!req) return null;
    // オートコンボ: 同種ボタンの連打で chain 技へ
    if (m.chain && req.kind === 'normal') {
      const chainMove = MOVES[m.chain];
      // P/K どちらの連打でも次へ（アクセシブル）。chain は固定列。
      if ((intent.P && m.input.startsWith('P')) || (intent.K && m.input.startsWith('K')) ||
          req.id === m.chain) {
        return { kind: 'normal', def: chainMove, id: m.chain };
      }
    }
    // 手動キャンセル（必殺・スーパー・指定技へ）
    if (m.cancelInto && m.cancelInto.includes(req.id)) {
      return req;
    }
    return null;
  }

  // ---- 攻撃ヒットボックス（active 中のみ・1技1ヒット）----
  getHitbox() {
    if (this.hitDone) return null;
    const m = this.move;
    if (!m) return null;
    const attacking = this.state === ST.ATTACK;
    if (!attacking) return null;
    const f = this.moveFrame;
    if (f <= m.startup || f > m.startup + m.active) return null;
    if (m.type === 'throw') return null;          // 投げは別系
    if (m.spawn && !m.damage) return null;         // 純飛び道具キャスト(近接判定なし)
    const S = CONFIG.SCALE;
    return {
      x: this.x + this.atkFx * m.offF * S,
      z: this.z + this.atkFz * m.offF * S,
      y: (m.offH || 1.0) * S + (this.airborne ? this.y : 0),
      r: m.reach * S,
      move: m, level: m.level, owner: this.index,
    };
  }

  // ---- 胴ハートボックス（縦カプセル）----
  getHurt() {
    const crouching = (this.state === ST.BLOCK && this.guardStance === 'crouch');
    const base = this.airborne ? this.y : 0;
    const S = CONFIG.SCALE;
    return {
      x: this.x, z: this.z,
      top: (crouching ? CONFIG.CROUCH_TOP : CONFIG.HURT_TOP) * S + base,
      bot: (crouching ? CONFIG.CROUCH_BOT : CONFIG.HURT_BOT) * S + base,
      r: CONFIG.HURT_RADIUS * S,
    };
  }

  isGuarding() { return this.state === ST.BLOCK; }
  isCounterState() {
    return this.state === ST.ATTACK || this.state === ST.THROW_START ||
      this.state === ST.DASH || this.state === ST.SIDESTEP || this.state === ST.BACKDASH ||
      this.state === ST.SUPERFREEZE;
  }

  buildGauge(amount) { this.gauge = clamp(this.gauge + amount, 0, CONFIG.GAUGE_MAX); }

  // ---- 被弾 ----
  receiveHit(move, attacker, opts = {}) {
    if (this.state === ST.KO) return null;
    const fx = this.x - attacker.x, fz = this.z - attacker.z;
    const d = hypot(fx, fz) || 1; const nx = fx / d, nz = fz / d;

    // ガード判定（投げはガード不可）
    const guarding = this.isGuarding();
    if (guarding && move.level !== LEVEL.THROW) {
      const blocks = GUARD_BLOCKS[this.guardStance] || GUARD_BLOCKS.stand;
      if (blocks[move.level]) {
        this.state = ST.BLOCKSTUN; this.stun = move.blockstun; this.stateFrame = 0;
        const kb = (move.pushback || 0.1) / this.weight;
        this.x += nx * kb; this.z += nz * kb;
        const chip = opts.chip || 0;
        if (chip) this.hp = Math.max(1, this.hp - chip);
        return { result: 'block' };
      }
    }

    // 通常ヒット
    const counter = opts.counter && this.isCounterState();
    let dmg = move.damage * (counter ? (move.counterBonus || 1.3) : 1) * attacker.scaling;
    dmg = Math.round(dmg);
    this.hp = Math.max(0, this.hp - dmg);
    this.hitFlash = 8; this.lastHitLevel = move.level;
    attacker.comboCount = (attacker.comboCount || 0) + 1;
    attacker.scaling = Math.max(CONFIG.SCALING_MIN, attacker.scaling - CONFIG.SCALING_STEP);
    // SP 蓄積（被弾でも与でも貯まる）。ウルトラ自身のヒットでは与側は貯めない(無限ループ防止)。
    this.sp = Math.min(CONFIG.SP_MAX, this.sp + dmg * CONFIG.SP_GAIN_TAKE);
    if (!move.noSp) attacker.sp = Math.min(CONFIG.SP_MAX, attacker.sp + dmg * CONFIG.SP_GAIN_DEAL);

    const kb = (move.knockback || 0.2) / this.weight;
    this.x += nx * kb; this.z += nz * kb;

    if (this.hp <= 0) {
      this.state = ST.KO; this.stateFrame = 0; this.move = null;
      // とどめ＝後方へ放物線を描いて吹き飛ぶ（スローで見せる）
      this.vy = 5.8; this.airborne = true;
      this._koVx = nx * 6.0; this._koVz = nz * 2.6;
      return { result: 'ko', dmg };
    }

    if (move.launch > 0 || (this.airborne && move.damage > 0)) {
      this.state = ST.LAUNCH; this.stateFrame = 0; this.move = null;
      this.vy = Math.max(this.vy, move.launch || 4.5); this.airborne = true;
      return { result: counter ? 'counter' : 'launch', dmg };
    }
    if (move.knockdownOnHit) {
      this._toKnockdown(); return { result: counter ? 'counter' : 'knockdown', dmg };
    }
    this.state = ST.HITSTUN; this.stun = move.hitstun + (counter ? 4 : 0); this.stateFrame = 0; this.move = null;
    return { result: counter ? 'counter' : 'hit', dmg };
  }

  receiveThrow(move, attacker) {
    if (this.state === ST.KO) return null;
    let dmg = Math.round(move.damage * attacker.scaling);
    this.hp = Math.max(0, this.hp - dmg);
    this.hitFlash = 8;
    this.sp = Math.min(CONFIG.SP_MAX, this.sp + dmg * CONFIG.SP_GAIN_TAKE);
    attacker.sp = Math.min(CONFIG.SP_MAX, attacker.sp + dmg * CONFIG.SP_GAIN_DEAL);
    if (this.hp <= 0) { this.state = ST.KO; this.stateFrame = 0; this.move = null; return { result: 'ko', dmg }; }
    this.state = ST.THROWN; this.stateFrame = 0; this.move = null;
    return { result: 'throw', dmg };
  }

  _toKnockdown() {
    this.state = ST.KNOCKDOWN; this.stateFrame = 0; this.knockdownTimer = 30;
    this.move = null; this.airborne = false; this.y = 0; this.vy = 0;
  }

  _resolvePush(opp) {
    const dx = this.x - opp.x, dz = this.z - opp.z;
    const d = hypot(dx, dz);
    const minD = CONFIG.PUSH_RADIUS * 2 * CONFIG.SCALE;
    // 空中で高度差が大きいときは押し合わない（飛び越え）
    if (Math.abs(this.y - opp.y) > 1.2) return;
    if (d > 0 && d < minD) {
      const push = (minD - d) / 2; const nx = dx / d, nz = dz / d;
      this.x += nx * push; this.z += nz * push;
      opp.x -= nx * push; opp.z -= nz * push;
    } else if (d === 0) { this.x += 0.01; }
  }

  _clampStage(match) {
    if (!match) return;
    const st = match.stage;
    if (st.shape === 'circle') {
      const d = hypot(this.x, this.z);
      if (st.walls) { const R = st.radius - 0.25; if (d > R) { this.x *= R / d; this.z *= R / d; } }
      // ringOut は Match が判定（clamp しない）
    } else { // square
      const R = st.radius;
      if (st.walls) { this.x = clamp(this.x, -R + 0.25, R - 0.25); this.z = clamp(this.z, -R + 0.25, R - 0.25); }
    }
  }

  outOfRing(match) {
    const st = match.stage;
    if (!st.ringOut) return false;
    if (st.shape === 'circle') return hypot(this.x, this.z) > st.radius;
    return Math.abs(this.x) > st.radius || Math.abs(this.z) > st.radius;
  }
}

// ---------------------------------------------------------------------
// 当たり判定ヘルパ（縦カプセル vs 点球）
// ---------------------------------------------------------------------
function overlapHurt(hb, hurt) {
  const dxz = hypot(hb.x - hurt.x, hb.z - hurt.z);
  const cy = clamp(hb.y, hurt.bot, hurt.top);
  const dy = hb.y - cy;
  const dist = hypot(dxz, dy);
  return dist <= hb.r + hurt.r;
}

// ---------------------------------------------------------------------
// Match（2 Fighter + 弾 + ラウンド/タイマー/ゲージ）
// ---------------------------------------------------------------------
export class Match {
  constructor(rosterA, rosterB, stage, opts = {}) {
    this.stage = stage;
    this.fighters = [new Fighter(0, rosterA), new Fighter(1, rosterB)];
    this.projectiles = [];
    this.rng = makeRng(opts.seed || 12345);
    this.roundsToWin = opts.roundsToWin || CONFIG.ROUNDS_TO_WIN;
    this.roundTimeMax = (opts.roundTime || CONFIG.ROUND_TIME) * TICK_HZ; // 秒→フレーム（TICK_HZ=60）
    this.wins = [0, 0];
    this.round = 1;
    this.phase = ST.INTRO;       // intro→fight→roundEnd→matchEnd
    this.phaseFrame = 0;
    this.timer = this.roundTimeMax;
    this.hitstop = 0;
    this.superFreeze = 0;
    this.koSlow = 0;
    this.roundWinner = -1;
    this.matchWinner = -1;
    this._pendingWinner = null; this._victoryStarted = false;
    this.canProceed = false;     // KO演出後、プレイヤのボタン操作で次へ進む
    this.events = [];            // 描画/SE 用（hit/block/ko/projectile/round/victory）
    this.introFrames = opts.introFrames ?? 40;
    this._placeStart();
  }

  _placeStart() {
    const sep = START_SEP * CONFIG.SCALE;
    this.fighters[0].reset(-sep / 2, 0, 1);
    this.fighters[1].reset(sep / 2, 0, -1);
  }

  emit(type, data) { this.events.push({ type, ...data }); }

  // 1 tick 進める。intents=[i0,i1]
  step(i0, i1) {
    this.events.length = 0;
    const [a, b] = this.fighters;

    // 演出停止（ヒットストップ/スーパーフリーズ/KOスロー）は論理を止める
    if (this.superFreeze > 0) { this.superFreeze--; this._tickFighterFreezeOnly(); return; }
    if (this.hitstop > 0) { this.hitstop--; return; }

    if (this.phase === ST.INTRO) {
      this.phaseFrame++;
      if (this.phaseFrame >= this.introFrames) { this.phase = ST.IDLE; this.phaseFrame = 0; this.emit('round_start', { round: this.round }); }
      return;
    }
    if (this.phase === ST.WIN || this.phase === 'roundEnd') {
      this.phaseFrame++;
      if (this.koSlow > 0) this.koSlow--;
      this._fall(a); this._fall(b);
      // KO演出(スロー)が一段落 → 勝者が勝利ポーズ開始（camera/anim 演出のトリガ）
      if (this.koSlow <= 0 && this._pendingWinner != null && !this._victoryStarted) {
        const w = this.fighters[this._pendingWinner];
        if (w.state !== ST.KO) { w.state = ST.WIN; w.stateFrame = 0; }
        this._victoryStarted = true;
        this.emit('victory', { winner: this._pendingWinner });
      }
      // 自動で次へ進まず、ダンスを流し続けて「次へ」入力を待つ
      if (this.phaseFrame >= CONFIG.ROUND_END_FRAMES && !this.canProceed) {
        this.canProceed = true; this.emit('await_continue', { winner: this.roundWinner, match: this.matchWinner >= 0 });
      }
      return;
    }
    if (this.phase === 'matchEnd') { return; }

    // --- 通常フレーム ---
    const intents = [i0 || emptyIntent(), i1 || emptyIntent()];
    a.tick(b, intents[0], this);
    b.tick(a, intents[1], this);

    // 攻撃解決（双方）
    let hs = 0;
    for (const [atk, def] of [[a, b], [b, a]]) {
      const r = this._resolveStrike(atk, def);
      if (r) hs = Math.max(hs, r.hitstop);
    }
    // 飛び道具
    this._stepProjectiles();

    if (hs > 0) this.hitstop = hs;

    // タイマー
    this.timer--;

    // 勝敗判定
    this._checkRoundEnd();
  }

  _tickFighterFreezeOnly() {
    // スーパーフリーズ中は両者静止（描画のみ）。superFreeze 演出。
  }

  _fall(f) {
    if (f.state !== ST.KO) return;
    f.vy -= CONFIG.GRAVITY * DT;
    f.y = Math.max(0, f.y + f.vy * DT);
    if (f.y === 0 && f.vy < 0) f.vy = 0;
    f.x += (f._koVx || 0) * DT; f.z += (f._koVz || 0) * DT;
    const fric = f.y > 0 ? 0.99 : 0.82;               // 空中はほぼ維持・着地で摩擦
    f._koVx = (f._koVx || 0) * fric; f._koVz = (f._koVz || 0) * fric;
    const st = this.stage; const R = (st.radius || 6) - 0.3;
    if (st.shape === 'circle') { const d = hypot(f.x, f.z); if (d > R) { f.x *= R / d; f.z *= R / d; } }
    else { f.x = clamp(f.x, -R, R); f.z = clamp(f.z, -R, R); }
  }

  _resolveStrike(atk, def) {
    const hb = atk.getHitbox();
    if (!hb) return null;
    const hurt = def.getHurt();
    if (!overlapHurt(hb, hurt)) return null;
    atk.hitDone = true;
    // 新規コンボの開始（相手が硬直外）なら補正をリセット
    const inStun = def.state === ST.HITSTUN || def.state === ST.LAUNCH || def.state === ST.BLOCKSTUN;
    if (!inStun) { atk.comboCount = 0; atk.scaling = CONFIG.SCALING_START; }
    const counter = def.isCounterState();
    const isBig = hb.move.damage >= 18 || hb.move.type === 'super';
    const r = def.receiveHit(hb.move, atk, { counter });
    if (!r) return null;
    // エフェクトは「被弾箇所」＝防御側の体表・被弾高さに出す（攻撃側ヒットボックス中心ではなく）。
    // hb.y を相手の胴体範囲にクランプ＝ハイキックは頭/下段は足元、と被弾位置に一致。
    const cy = clamp(hb.y, hurt.bot, hurt.top);
    const ddx = hb.x - def.x, ddz = hb.z - def.z, ddl = hypot(ddx, ddz) || 1;
    const pt = { x: def.x + (ddx / ddl) * hurt.r, y: cy, z: def.z + (ddz / ddl) * hurt.r };
    if (r.result === 'block') { this.emit('block', { x: pt.x, y: pt.y, z: pt.z, move: hb.move.id }); return { hitstop: CONFIG.HITSTOP_BLOCK }; }
    if (r.result === 'ko') { this.emit('ko', { who: def.index, x: pt.x, y: pt.y, z: pt.z }); this._onKO(def); return { hitstop: CONFIG.HITSTOP_BIG }; }
    this.emit('hit', { x: pt.x, y: pt.y, z: pt.z, dmg: r.dmg, level: hb.move.level, counter: r.result === 'counter', combo: atk.comboCount, who: def.index });
    return { hitstop: (hb.move.hitstop || CONFIG.HITSTOP_HIT) + (counter ? 2 : 0) };
  }

  // 投げ成立判定（attacker は THROW_START active 中）
  tryThrow(attacker, def, move) {
    const d = hypot(attacker.x - def.x, attacker.z - def.z);
    if (d > (CONFIG.THROW_RANGE * CONFIG.SCALE * (move.reach ? move.reach / 0.6 : 1))) return;
    if (def.airborne) return;
    if (def.state === ST.KNOCKDOWN || def.state === ST.GETUP || def.state === ST.KO) return;
    if (def.state === ST.HITSTUN || def.state === ST.LAUNCH) return; // 連続技中は別
    // 投げ抜け: 被投げ側が同時に grab を押していれば抜け（techable のみ）
    const techable = move.throwTechable !== false;
    if (techable && def._grabBuf > 0) {
      this.emit('throw_tech', { x: def.x, y: 1.0, z: def.z });
      const nx = (def.x - attacker.x) || 1; const s = nx > 0 ? 1 : -1;
      def.x += s * 0.5; attacker.x -= s * 0.5;
      attacker.state = ST.IDLE; attacker.move = null; attacker.stateFrame = 0;
      def.state = ST.IDLE; def.stateFrame = 0;
      return;
    }
    attacker.state = ST.THROWING; attacker.moveFrame = 0;
    const r = def.receiveThrow(move, attacker);
    if (r && r.result === 'ko') { this.emit('ko', { who: def.index, x: def.x, y: 1.0, z: def.z }); this._onKO(def); }
    else this.emit('throw', { x: def.x, y: 1.0, z: def.z, dmg: r ? r.dmg : 0, who: def.index });
  }

  spawnProjectile(owner, move, opp) {
    const proto = PROJECTILES[move.spawn.proto];
    if (!proto) return;
    const S = CONFIG.SCALE;
    const off = (move.spawn.offF || 0.6) * S;
    const big = move.spawn.big || 1;
    const p = {
      x: owner.x + owner.atkFx * off, z: owner.z + owner.atkFz * off,
      y: proto.height * S, vx: owner.atkFx * proto.speed, vz: owner.atkFz * proto.speed,
      owner: owner.index, kind: proto.kind,
      damage: (move.spawn.damage || proto.damage), hitstun: proto.hitstun, blockstun: proto.blockstun,
      chip: proto.chip, radius: proto.radius * big * S, life: proto.life, level: proto.level,
      strength: proto.strength + (big > 1 ? 2 : 0), color: proto.color, hitDone: false, big,
      isSuper: move.type === 'super',
    };
    this.projectiles.push(p);
    this.emit('projectile_spawn', { kind: p.kind, x: p.x, y: p.y, z: p.z, owner: p.owner, color: p.color, isSuper: p.isSuper });
  }

  _stepProjectiles() {
    const ps = this.projectiles;
    // 移動
    for (const p of ps) { p.x += p.vx * DT; p.z += p.vz * DT; p.life--; }
    // 相殺（owner 違いの弾同士）
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        if (a.dead || b.dead || a.owner === b.owner) continue;
        const d = hypot(a.x - b.x, a.z - b.z);
        if (d <= a.radius + b.radius + 0.1) {
          this.emit('clash', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
          if (a.strength === b.strength) { a.dead = b.dead = true; }
          else if (a.strength > b.strength) { b.dead = true; a.strength -= b.strength; }
          else { a.dead = true; b.strength -= a.strength; }
        }
      }
    }
    // 命中（相手に）
    for (const p of ps) {
      if (p.dead || p.hitDone) continue;
      const def = this.fighters[1 - p.owner];
      const hurt = def.getHurt();
      if (overlapHurt({ x: p.x, z: p.z, y: p.y, r: p.radius }, hurt)) {
        p.hitDone = true; p.dead = true;
        const move = { damage: p.damage, hitstun: p.hitstun, blockstun: p.blockstun, knockback: p.isSuper ? 1.0 : 0.35, pushback: 0.18, level: p.level, counterBonus: 1.2, hitstop: p.isSuper ? 12 : 6, noSp: p.isSuper };
        const r = def.receiveHit(move, this.fighters[p.owner], { counter: false, chip: p.chip });
        if (r && r.result === 'ko') { this.emit('ko', { who: def.index, x: p.x, y: p.y, z: p.z }); this._onKO(def); }
        else if (r && r.result === 'block') this.emit('block', { x: p.x, y: p.y, z: p.z, projectile: true });
        else this.emit('hit', { x: p.x, y: p.y, z: p.z, dmg: r ? r.dmg : 0, projectile: true, level: p.level, who: def.index });
      }
    }
    // 退場
    this.projectiles = ps.filter((p) => !p.dead && p.life > 0 && Math.abs(p.x) < 30 && Math.abs(p.z) < 30);
  }

  _onKO(loser) {
    if (this.phase === 'roundEnd' || this.phase === 'matchEnd') return;
    this.koSlow = CONFIG.KO_SLOW_FRAMES;
    this._endRound(1 - loser.index, 'ko');
  }

  _checkRoundEnd() {
    if (this.phase !== ST.IDLE) return;
    const [a, b] = this.fighters;
    // リングアウト
    if (a.outOfRing(this)) { this.emit('ringout', { who: 0 }); this._endRound(1, 'ringout'); return; }
    if (b.outOfRing(this)) { this.emit('ringout', { who: 1 }); this._endRound(0, 'ringout'); return; }
    // 時間切れ
    if (this.timer <= 0) {
      const w = a.hp === b.hp ? -1 : (a.hp > b.hp ? 0 : 1);
      this.emit('timeover', { winner: w });
      this._endRound(w, 'timeover'); return;
    }
  }

  _endRound(winner, cause) {
    this.roundWinner = winner; this.roundCause = cause;
    this.phase = 'roundEnd'; this.phaseFrame = 0;
    if (winner >= 0) {
      this.wins[winner]++;
      const w = this.fighters[winner];
      // 勝者は一旦待機（KO演出を見届けてから勝利ポーズ）
      if (w.state !== ST.KO) { w.state = ST.IDLE; w.stateFrame = 0; w.move = null; }
      this._pendingWinner = winner; this._victoryStarted = false;
    } else { this._pendingWinner = null; }
    this.emit('round_end', { winner, cause, wins: this.wins.slice() });
    if (winner >= 0 && this.wins[winner] >= this.roundsToWin) {
      this.matchWinner = winner;
    }
  }

  // KO演出後の「次へ」: プレイヤのボタン/タップで呼ぶ。次ラウンド or マッチ終了へ。
  proceed() {
    if (!this.canProceed) return false;
    this.canProceed = false;
    this._nextRound();
    return true;
  }

  _nextRound() {
    if (this.matchWinner >= 0) {
      this.phase = 'matchEnd';
      this.emit('match_end', { winner: this.matchWinner });
      return;
    }
    this.round++;
    this.timer = this.roundTimeMax;
    this.projectiles.length = 0;
    this.hitstop = 0; this.superFreeze = 0; this.koSlow = 0;
    this._pendingWinner = null; this._victoryStarted = false; this.canProceed = false;
    this._placeStart();
    this.phase = ST.INTRO; this.phaseFrame = 0;
  }

  // 決定論ハッシュ（テスト用）
  hash() {
    let h = 2166136261 >>> 0;
    const mix = (v) => { h ^= (Math.round(v * 1000) | 0); h = Math.imul(h, 16777619) >>> 0; };
    for (const f of this.fighters) { mix(f.x); mix(f.z); mix(f.y); mix(f.hp); mix(f.gauge); mix(f.stateFrame); mix(f.state.length); }
    mix(this.timer); mix(this.projectiles.length); mix(this.wins[0]); mix(this.wins[1]);
    return h >>> 0;
  }
}
