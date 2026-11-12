// =====================================================================
// VirtuaFighter_ddd — プロトタイプ設定 / フレームデータ
// すべての戦闘ロジックは 60fps 固定ステップ前提 (1 frame = 1/60 s)。
// 技は「発生(startup)/持続(active)/硬直(recovery)」フレームで定義する
// (バーチャファイター流のフレームデータ)。
// =====================================================================

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

export const CONFIG = {
  // --- ステージ ---
  RING_RADIUS: 6.0,          // 円形リング半径 (これを超えるとリングアウト)
  FIGHTER_HEIGHT: 1.8,       // 正規化身長 (m)
  GROUND_Y: 0,

  // --- 移動 ---
  WALK_SPEED: 2.6,           // m/s 前後歩行
  BACK_SPEED: 2.0,
  TURN_RATE: 14,             // 相手への向き直り速度
  PUSH_RADIUS: 0.55,         // 体同士の押し合い半径 (重なり防止)

  // --- ジャンプ ---
  JUMP_VEL: 4.8,             // 跳躍初速(m/s) 頂点≈0.64m
  GRAVITY: 18,               // 重力(m/s^2) 滞空≈0.53s
  AIR_CONTROL: 0.7,          // 空中の横移動係数

  // --- 体力・ゲーム ---
  MAX_HP: 100,
  HITSTOP_HIT: 5,            // ヒット時の止め (フレーム) — 爽快感
  HITSTOP_BLOCK: 3,

  // --- 当たり判定 ---
  HURT_RADIUS: 0.42,         // ハートボックス(胴)カプセル半径
  DEBUG_BOXES: false,        // 当たり判定の可視化 (Hキー)
};

// 攻撃の「高さ」: 立ちガードで防げる = mid/high。lowはしゃがみ防御用(将来)。
export const HEIGHT = { HIGH: 'high', MID: 'mid', LOW: 'low' };

// =====================================================================
// 技テーブル (フレームデータ)
//   startup : 発生まで(F)。この間は無防備な予備動作。
//   active  : 攻撃判定が出ているフレーム数。
//   recovery: 攻撃後の硬直(F)。この間は次の行動・ガード不可。
//   damage  : ヒット時ダメージ。
//   hitstun : ヒット時に相手が硬直するフレーム。
//   blockstun: ガード時に相手が硬直するフレーム。
//   knockback: ヒット時の後退量(m)。
//   bone    : 攻撃判定を出すボーン名 (Meshyリグ準拠)。
//   reach   : ボーン位置からの攻撃判定半径(m)。
//   lunge   : active 中に前進する量(m) — procedural時の到達補助。
//   height  : ガード方向判定用。
//   pose    : 進行度 t(0..1) を受けてボーン回転を返す procedural ポーズ。
// =====================================================================

// procedural ポーズ補助: イーズ
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export const MOVES = {
  punch: {
    name: 'Jab',
    input: 'P',
    startup: 5, active: 5, recovery: 11,
    damage: 7, hitstun: 14, blockstun: 8,
    knockback: 0.18, bone: 'RightHand', reach: 0.65, lunge: 0.55,
    height: HEIGHT.MID,
    // 右腕を前へ突き出す + 体をわずかに踏み込む。phase: 0=構え→1=伸長→戻り
    pose(t, phase) {
      const ext = phase === 'active' ? 1 : phase === 'startup' ? ease(t) : 1 - ease(t);
      return {
        RightArm:     { x: -ext * 1.35, y: 0, z: -ext * 0.15 },
        RightForeArm: { x: -ext * 0.25, y: ext * 0.1, z: 0 },
        Spine02:      { x: 0, y: -ext * 0.35, z: 0 },
        LeftArm:      { x: ext * 0.5, y: 0, z: 0 },
      };
    },
  },

  kick: {
    name: 'Mid Kick',
    input: 'K',
    startup: 9, active: 5, recovery: 17,
    damage: 14, hitstun: 20, blockstun: 12,
    knockback: 0.45, bone: 'RightFoot', reach: 0.44, lunge: 0.35,
    height: HEIGHT.MID,
    pose(t, phase) {
      const ext = phase === 'active' ? 1 : phase === 'startup' ? ease(t) : 1 - ease(t);
      return {
        RightUpLeg:   { x: -ext * 1.5, y: 0, z: 0 },
        RightLeg:     { x: ext * 0.9, y: 0, z: 0 },
        Spine01:      { x: ext * 0.25, y: 0, z: 0 },
        LeftArm:      { x: ext * 0.3, y: 0, z: -ext * 0.4 },
        RightArm:     { x: ext * 0.3, y: 0, z: ext * 0.4 },
      };
    },
  },
};

// ガード(防御)ポーズ — 両腕を上げて構える
export function blockPose() {
  return {
    LeftArm:      { x: -0.9, y: 0.2, z: 0.5 },
    LeftForeArm:  { x: -1.4, y: 0, z: 0 },
    RightArm:     { x: -0.9, y: -0.2, z: -0.5 },
    RightForeArm: { x: -1.4, y: 0, z: 0 },
    Spine02:      { x: 0.1, y: 0, z: 0 },
  };
}

// 被弾けぞりポーズ — 上体を後ろへ
export function hitPose(t) {
  const k = Math.sin(Math.min(1, t) * Math.PI); // 0→1→0 の山
  return {
    Spine01: { x: -k * 0.4, y: 0, z: 0 },
    Spine02: { x: -k * 0.3, y: 0, z: 0 },
    Head:    { x: -k * 0.3, y: 0, z: 0 },
  };
}
