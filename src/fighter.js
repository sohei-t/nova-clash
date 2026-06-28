import * as THREE from 'three';
import { GLTFLoader } from '../lib/loaders/GLTFLoader.js?v=1782623521';
import { CONFIG, MOVES, DT, blockPose, hitPose } from './config.js?v=1782623521';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const loader = new GLTFLoader();

// ボーンに「アニメ姿勢の上から」ローカル回転を加算する
function addLocal(bone, r) {
  if (!bone || !r) return;
  _e.set(r.x || 0, r.y || 0, r.z || 0, 'XYZ');
  _q.setFromEuler(_e);
  bone.quaternion.multiply(_q);
}

// 制御対象ボーン名 (Meshyリグ準拠)
const BONE_NAMES = [
  'Hips', 'Spine', 'Spine01', 'Spine02', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot',
  'RightUpLeg', 'RightLeg', 'RightFoot',
];

export class Fighter {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.color = opts.color || '#7ad';
    this.facingOffset = opts.facingOffset ?? 0; // モデル前方の補正(実機で調整)
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.hp = CONFIG.MAX_HP;
    this.yaw = opts.yaw ?? 0;
    this.bones = {};
    this.ready = false;

    // 状態
    this.state = 'idle';     // idle|walk|attack|block|hitstun|ko
    this.move = null;        // 現在の技
    this.frame = 0;          // 状態内フレーム
    this.hitConfirmed = false;
    this.stunFrames = 0;

    // 縦方向(ジャンプ)
    this.y = 0;
    this.vy = 0;
    this.airborne = false;

    this._buildDebug();
  }

  async load(url) {
    const gltf = await loader.loadAsync(url);
    const g = gltf.scene;
    this.root.add(g);

    // --- スケール正規化 (Meshyリグは Armature scale 0.01 で極小) ---
    const box = new THREE.Box3().setFromObject(g);
    const size = box.getSize(_v);
    const h = size.y || 1;
    const s = CONFIG.FIGHTER_HEIGHT / h;
    g.scale.multiplyScalar(s);
    // 足元を y=0 に、xz中心を原点に
    const box2 = new THREE.Box3().setFromObject(g);
    const c = box2.getCenter(_v);
    const min = box2.min;
    g.position.x -= c.x;
    g.position.z -= c.z;
    g.position.y -= min.y;

    g.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; }
      if (o.isBone && BONE_NAMES.includes(o.name)) this.bones[o.name] = o;
    });

    // --- アニメーション (walk クリップ) ---
    this.mixer = new THREE.AnimationMixer(g);
    if (gltf.animations && gltf.animations.length) {
      this.walkAction = this.mixer.clipAction(gltf.animations[0]);
      this.walkAction.play();
      this.mixer.update(0);
    }
    this.ready = true;
    return this;
  }

  _buildDebug() {
    this.dbg = new THREE.Group();
    this.dbg.visible = CONFIG.DEBUG_BOXES;
    this.scene.add(this.dbg);
    // ハートボックス(胴カプセル)
    const cap = new THREE.Mesh(
      new THREE.CapsuleGeometry(CONFIG.HURT_RADIUS, CONFIG.FIGHTER_HEIGHT * 0.5, 4, 8),
      new THREE.MeshBasicMaterial({ color: 0x44ff88, wireframe: true })
    );
    this.dbgHurt = cap; this.dbg.add(cap);
    // ヒットボックス(攻撃)
    const hb = new THREE.Mesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff4444, wireframe: true })
    );
    hb.visible = false; this.dbgHit = hb; this.dbg.add(hb);
  }

  // ------- 入力 → 状態遷移 (1tick=1/60s) -------
  // intents: {fwd, strafe, punch, kick, block, jump}  punch/kick/jump はエッジ(押した瞬間)
  tick(opponent, intents) {
    if (!this.ready) return;
    this.frame++;

    // 縦方向(重力/着地)は常に適用 (KO中も落下する)
    this._applyVertical();

    // KO 後は一切動かさない (向きも固定 — 密着時に向きが暴れて回転するのを防ぐ)
    if (this.state === 'ko') return;

    // 相手の方を向く (常に対面)
    this._faceOpponent(opponent);

    // 硬直中(hitstun/blockstun)は行動不可
    if (this.state === 'hitstun' || this.state === 'block') {
      this.stunFrames--;
      if (this.state === 'block' && !intents.block) { this.state = 'idle'; this.frame = 0; }
      if (this.state === 'hitstun' && this.stunFrames <= 0) { this.state = 'idle'; this.frame = 0; }
    }

    if (this.state === 'attack') {
      this._advanceAttack(opponent);
      return; // 攻撃中は移動不可
    }

    // --- 行動可能 (idle/walk) ---
    if (this.state === 'idle' || this.state === 'walk') {
      // ジャンプ (接地時のみ)
      if (intents.jump && !this.airborne) { this.vy = CONFIG.JUMP_VEL; this.airborne = true; }
      // 地上アクション (空中では攻撃/ガード不可)
      if (!this.airborne) {
        if (intents.block) { this.state = 'block'; return; }
        if (intents.punch) { this._startAttack('punch'); return; }
        if (intents.kick) { this._startAttack('kick'); return; }
      }
      // 移動 (空中は横移動のみ=空中制御)
      this._move(intents, opponent);
    }
  }

  // 重力・着地
  _applyVertical() {
    if (!this.airborne && this.vy === 0 && this.y === 0) return;
    this.vy -= CONFIG.GRAVITY * DT;
    this.y += this.vy * DT;
    if (this.y <= 0) { this.y = 0; this.vy = 0; this.airborne = false; }
    this.root.position.y = this.y;
  }

  _move(intents, opponent) {
    const fwd = intents.fwd, strafe = intents.strafe;
    if (fwd === 0 && strafe === 0) { if (!this.airborne) this.state = 'idle'; return; }
    if (!this.airborne) this.state = 'walk';
    const ac = this.airborne ? CONFIG.AIR_CONTROL : 1; // 空中は移動を弱める
    // 対面ベクトル
    const toOpp = _v.set(opponent.root.position.x - this.root.position.x, 0,
                         opponent.root.position.z - this.root.position.z);
    const dist = toOpp.length() || 1; toOpp.multiplyScalar(1 / dist);
    const side = _v2.set(-toOpp.z, 0, toOpp.x); // 右手系の横
    const sp = (fwd > 0 ? CONFIG.WALK_SPEED : CONFIG.BACK_SPEED) * DT * ac;
    const ss = CONFIG.WALK_SPEED * DT * ac;
    this.root.position.x += toOpp.x * fwd * sp + side.x * strafe * ss;
    this.root.position.z += toOpp.z * fwd * sp + side.z * strafe * ss;
    this._resolvePush(opponent);
    this._clampRing();
  }

  _startAttack(key) {
    this.state = 'attack';
    this.move = MOVES[key];
    this.frame = 0;
    this.hitConfirmed = false;
  }

  _advanceAttack(opponent) {
    const m = this.move;
    const total = m.startup + m.active + m.recovery;
    const f = this.frame;
    // active 中は前進(lunge)
    if (f > m.startup && f <= m.startup + m.active) {
      const toOpp = _v.set(opponent.root.position.x - this.root.position.x, 0,
                           opponent.root.position.z - this.root.position.z).normalize();
      const step = (m.lunge / m.active);
      this.root.position.x += toOpp.x * step;
      this.root.position.z += toOpp.z * step;
      this._resolvePush(opponent);
      this._clampRing();
    }
    if (f >= total) { this.state = 'idle'; this.move = null; this.frame = 0; }
  }

  attackPhase() {
    if (this.state !== 'attack') return null;
    const m = this.move, f = this.frame;
    if (f <= m.startup) return { phase: 'startup', t: f / m.startup };
    if (f <= m.startup + m.active) return { phase: 'active', t: (f - m.startup) / m.active };
    return { phase: 'recovery', t: (f - m.startup - m.active) / m.recovery };
  }

  // active フレーム中だけ有効なヒットボックスを返す
  getHitbox() {
    if (this.state !== 'attack' || this.hitConfirmed) return null;
    const m = this.move, f = this.frame;
    if (f <= m.startup || f > m.startup + m.active) return null;
    const bone = this.bones[m.bone];
    if (!bone) return null;
    bone.getWorldPosition(_v);
    return { pos: _v.clone(), radius: m.reach, move: m };
  }

  // 胴ハートボックス(カプセルの2端点+半径) — ジャンプ高さ this.y を反映
  getHurtCapsule() {
    const p = this.root.position;
    const top = new THREE.Vector3(p.x, this.y + CONFIG.FIGHTER_HEIGHT * 0.82, p.z);
    const bot = new THREE.Vector3(p.x, this.y + CONFIG.FIGHTER_HEIGHT * 0.30, p.z);
    return { a: top, b: bot, radius: CONFIG.HURT_RADIUS };
  }

  // 被弾処理: ガード成立なら 'block'、通常ヒットなら 'hit'
  receiveHit(move, attacker) {
    if (this.state === 'ko') return null;
    const blocking = this.state === 'block';
    const dir = _v.set(this.root.position.x - attacker.root.position.x, 0,
                       this.root.position.z - attacker.root.position.z).normalize();
    if (blocking) {
      this.stunFrames = move.blockstun;
      this.root.position.x += dir.x * move.knockback * 0.4;
      this.root.position.z += dir.z * move.knockback * 0.4;
      this._clampRing();
      return 'block';
    }
    this.hp = Math.max(0, this.hp - move.damage);
    this.root.position.x += dir.x * move.knockback;
    this.root.position.z += dir.z * move.knockback;
    this._clampRing();
    if (this.hp <= 0) { this.state = 'ko'; this.frame = 0; return 'ko'; }
    this.state = 'hitstun';
    this.stunFrames = move.hitstun;
    this.frame = 0;
    return 'hit';
  }

  _faceOpponent(opponent) {
    const dx = opponent.root.position.x - this.root.position.x;
    const dz = opponent.root.position.z - this.root.position.z;
    const target = Math.atan2(dx, dz) + this.facingOffset;
    // なめらかに向き直る
    let d = target - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, CONFIG.TURN_RATE * DT);
    this.root.rotation.y = this.yaw;
  }

  _resolvePush(opponent) {
    const dx = this.root.position.x - opponent.root.position.x;
    const dz = this.root.position.z - opponent.root.position.z;
    const d = Math.hypot(dx, dz);
    const minD = CONFIG.PUSH_RADIUS * 2;
    if (d > 0 && d < minD) {
      const push = (minD - d) / 2;
      const nx = dx / d, nz = dz / d;
      this.root.position.x += nx * push;
      this.root.position.z += nz * push;
      opponent.root.position.x -= nx * push;
      opponent.root.position.z -= nz * push;
    }
  }

  _clampRing() {
    const p = this.root.position;
    const d = Math.hypot(p.x, p.z);
    const R = CONFIG.RING_RADIUS - 0.2;
    if (d > R) { p.x *= R / d; p.z *= R / d; }
  }

  // ------- 描画更新 (可変dtでOK: 見た目のみ) -------
  render(dt) {
    if (!this.ready) return;
    // ベースのロコモーション
    let ts = 0.12; // idle 微動
    if (this.state === 'walk') ts = 1.0;
    if (this.state === 'ko') ts = 0;
    this.mixer.timeScale = ts;
    this.mixer.update(dt);

    // --- procedural ポーズ重畳 (mixer の後) ---
    if (this.state === 'attack') {
      const ph = this.attackPhase();
      const pose = this.move.pose(ph.t, ph.phase);
      for (const k in pose) addLocal(this.bones[k], pose[k]);
    } else if (this.state === 'block') {
      const pose = blockPose();
      for (const k in pose) addLocal(this.bones[k], pose[k]);
    } else if (this.state === 'hitstun') {
      const t = 1 - this.stunFrames / (this.move?.hitstun || 14);
      const pose = hitPose(t);
      for (const k in pose) addLocal(this.bones[k], pose[k]);
    } else if (this.state === 'ko') {
      // 0.6秒かけて後方に崩れ落ちる (回転せず固定)
      const t = Math.min(1, this.frame / 36);
      addLocal(this.bones['Spine'], { x: -1.4 * t });
      addLocal(this.bones['Spine01'], { x: -0.9 * t });
      addLocal(this.bones['Head'], { x: -0.5 * t });
      addLocal(this.bones['LeftUpLeg'], { x: 0.5 * t });
      addLocal(this.bones['RightUpLeg'], { x: 0.4 * t });
    } else if (this.airborne) {
      // 空中: 膝を引き上げ腕を広げる (地上アクション中以外)
      addLocal(this.bones['LeftUpLeg'], { x: 0.7 });
      addLocal(this.bones['LeftLeg'], { x: -0.9 });
      addLocal(this.bones['RightUpLeg'], { x: 0.5 });
      addLocal(this.bones['RightLeg'], { x: -0.7 });
      addLocal(this.bones['LeftArm'], { x: 0.3, z: -0.5 });
      addLocal(this.bones['RightArm'], { x: 0.3, z: 0.5 });
    }

    this._updateDebug();
  }

  _updateDebug() {
    this.dbg.visible = CONFIG.DEBUG_BOXES;
    if (!CONFIG.DEBUG_BOXES) return;
    const cap = this.getHurtCapsule();
    this.dbgHurt.position.set(cap.a.x, (cap.a.y + cap.b.y) / 2, cap.a.z);
    const hb = this.getHitbox();
    if (hb) { this.dbgHit.visible = true; this.dbgHit.position.copy(hb.pos); this.dbgHit.scale.setScalar(hb.radius); }
    else this.dbgHit.visible = false;
  }
}
