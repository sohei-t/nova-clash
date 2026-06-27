// =====================================================================
// NOVA CLASH — コア定数（THREE 非依存・純データ）
// 全戦闘ロジックは 60fps 固定ステップ前提。1 frame = 1/60 s = DT。
// =====================================================================

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

export const CONFIG = {
  // --- ステージ（既定。ステージ定義で上書き）---
  RING_RADIUS: 6.0,
  FIGHTER_HEIGHT: 2.35,     // キャラの見た目身長(m)＝大きめ（当たり判定も SCALE で連動）
  SCALE: 1.3,              // 当たり判定/間合いの全体スケール（身長拡大に合わせる）
  GROUND_Y: 0,

  // --- 移動 ---
  WALK_SPEED: 2.8,          // m/s 前進（相手の後退1.6を上回り確実に間合いを詰められる）
  BACK_SPEED: 1.6,          // m/s 後退（AIの逃げ足もこれ＝プレイヤーが追いつける）
  SIDE_SPEED: 1.6,          // m/s 奥行き移動
  DASH_SPEED: 3.6,          // m/s ダッシュ（AI用）
  DASH_FRAMES: 12,          // ダッシュ持続(F)
  BACKDASH_SPEED: 3.2,
  BACKDASH_FRAMES: 13,
  SIDESTEP_FRAMES: 16,      // サイドステップ無敵寄り猶予の持続(F)
  TURN_RATE: 16,            // 相手への向き直り速度（描画/論理共通）
  PUSH_RADIUS: 0.46,        // 体の押し合い半径
  DOUBLE_TAP_FRAMES: 14,    // ダブルタップ受付(F)

  // --- ジャンプ ---
  JUMP_VEL: 8.6,            // 跳躍初速(m/s) 頂点≈1.85m（高く・滞空長め）
  HOP_VEL: 6.0,             // 小ジャンプ
  GRAVITY: 20,             // 重力(m/s^2)
  AIR_CONTROL: 0.55,        // 空中横移動係数

  // --- 体力・ゲーム ---
  MAX_HP: 280,              // SPEC §2.2 フル版（SP一撃を避けるため底上げ）
  ROUND_TIME: 60,           // 秒
  ROUNDS_TO_WIN: 2,         // 2本先取
  HITSTOP_HIT: 6,
  HITSTOP_BLOCK: 3,
  HITSTOP_BIG: 10,
  COUNTER_WINDOW: true,     // 相手の startup/recovery 中ヒット＝カウンター

  // --- 攻撃チャージ（時間で蓄積。P/K/必殺の使用可否とコストを管理）---
  // 10秒でMAX(10)。5以下=パンチのみ / 6〜9=パンチ+キック / 10=必殺。
  // 消費: パンチ -1 / キック -2 / 必殺 -10(全消費)。撃つほど消耗＝駆け引き。
  GAUGE_MAX: 10,
  CHARGE_REGEN: 1 / 60,     // 毎tick +1/60 = 毎秒 +1
  START_CHARGE: 6,          // ラウンド開始時のチャージ
  COST_P: 1, COST_K: 2, COST_S: 10,
  THRESH_P: 1, THRESH_K: 6, THRESH_S: 10,

  // --- SP（必殺ウルトラのゲージ。戦闘で蓄積し MAX で派手な遠距離スーパーを撃てる）---
  SP_MAX: 100,
  SP_GAIN_DEAL: 0.9,        // 与ダメージ × これだけ SP 蓄積
  SP_GAIN_TAKE: 0.5,        // 被ダメージ × これだけ SP 蓄積

  // --- 当たり判定（胴ハートボックス）---
  HURT_RADIUS: 0.40,        // 胴カプセル半径
  HURT_TOP: 1.62,           // 立ち時の上端(m)
  HURT_BOT: 0.32,           // 下端(m)
  CROUCH_TOP: 1.02,         // しゃがみ時の上端（高段が漏れる/かわせる）
  CROUCH_BOT: 0.20,

  // --- コンボ補正（プロレーション）---
  SCALING_START: 1.0,
  SCALING_MIN: 0.30,
  SCALING_STEP: 0.10,       // ヒット毎に減衰

  // --- 投げ ---
  THROW_RANGE: 1.15,        // 投げ間合い(m)
  THROW_TECH_WINDOW: 16,    // 投げ抜け受付(F)＝技スロー(MOVE_SLOW)に合わせて延長

  // --- 演出 ---
  KO_SLOW_FRAMES: 120,      // KOスロー（とどめ＝後方へ放物線で吹き飛ぶ）の長さ(F)
  KO_SLOW_SCALE: 0.4,       // スロー倍率（ゆっくり放物線を見せる）→ 実時間 約5秒
  ROUND_END_FRAMES: 300,    // 決着後の演出全体(F)：スロー＋勝者の勝利ポーズ＋カメラ回り込み

  DEBUG_BOXES: false,
};

// 攻撃の高さ（ガード方向判定の軸）
export const LEVEL = { HIGH: 'high', MID: 'mid', LOW: 'low', THROW: 'throw' };

// 立ちガードは {high,mid} をカット、しゃがみガードは {mid,low} をカット（SPEC §13）
export const GUARD_BLOCKS = {
  stand: { high: true, mid: true, low: false },
  crouch: { high: false, mid: true, low: true },
};

// Fighter の状態
export const ST = {
  IDLE: 'idle', WALK: 'walk', CROUCH: 'crouch',
  DASH: 'dash', BACKDASH: 'backdash', SIDESTEP: 'sidestep',
  JUMP: 'jump',
  ATTACK: 'attack',
  BLOCK: 'block', BLOCKSTUN: 'blockstun',
  HITSTUN: 'hitstun', LAUNCH: 'launch',
  THROW_START: 'throw_start', THROWING: 'throwing', THROWN: 'thrown',
  KNOCKDOWN: 'knockdown', GETUP: 'getup',
  SUPERFREEZE: 'superfreeze',
  KO: 'ko', WIN: 'win', INTRO: 'intro',
};
