// =====================================================================
// NOVA CLASH — 共通通常技テーブル（フレームデータ・データ駆動）
// すべて 60fps 固定。1技=1レコード。SPEC §2.6 / §2.8。
//   level   : high|mid|low（ガード方向判定。SPEC §13）
//   startup/active/recovery : 発生/持続/硬直(F)
//   reach   : ヒットボックス半径(m)  offF: 体前方オフセット(m)  offH: 高さ(m)
//   lunge   : active 中の前進量(m)
//   chain   : オートコンボの次技 id（同ボタン連打で繋ぐ・SPEC §2.8-2）
//   cancelInto : 手動キャンセル先 id 群（必殺等へ・上級者向け）
//   anim    : AnimLibrary のクリップ名（manifest.json と対応）
//   launch  : >0 で打ち上げ（ジャグル始動）
// =====================================================================

import { LEVEL } from '../core/constants.js';

// フレーム有利の自動算出（first-active ヒット基準の近似）
const adv = (m) => ({
  onHit: m.onHit ?? (m.hitstun - m.recovery),
  onBlock: m.onBlock ?? (m.blockstun - m.recovery),
});

// 通常技モーションスロー: パンチ/キックを視認できる速度に。発生/持続/硬直/硬直時間を
// 一律スケール＝フレーム有利の関係は保たれたまま全体がゆっくりに（SPEC §2.6 体感調整）。
export const MOVE_SLOW = 2.6;
const TIMING_KEYS = ['startup', 'active', 'recovery', 'hitstun', 'blockstun'];

function def(m) {
  const base = {
    type: 'normal', level: LEVEL.MID,
    knockback: 0.2, pushback: 0.12, launch: 0, reach: 0.5, offF: 0.55, offH: 1.1,
    lunge: 0.25, hitstop: 6, gauge: 5, counterBonus: 1.3, chargeCost: 1, // 既定=パンチ1
    cancelInto: [], chain: null, crouchOk: false, airOk: false,
    fx: 'spark_mid', sfx: 'hit',
    ...m,
  };
  for (const k of TIMING_KEYS) if (typeof base[k] === 'number') base[k] = Math.round(base[k] * MOVE_SLOW);
  return { ...base, ...adv(base) };
}

export const MOVES = {
  // ---------------- パンチ系オートコンボ列（P連打）----------------
  jab: def({
    id: 'jab', name: 'Jab', input: 'P',
    startup: 4, active: 4, recovery: 9,
    damage: 9, hitstun: 14, blockstun: 9, knockback: 0.14,
    reach: 0.46, offF: 0.58, offH: 1.25, lunge: 0.18, hitstop: 5, gauge: 4,
    level: LEVEL.MID, anim: 'punch_jab',
    chain: 'straight', cancelInto: ['fireball', 'beam', 'knife', 'dash_punch', 'command_grab'],
  }),
  straight: def({
    id: 'straight', name: 'Straight', input: 'P~P',
    startup: 7, active: 4, recovery: 13,
    damage: 12, hitstun: 16, blockstun: 10, knockback: 0.22,
    reach: 0.52, offF: 0.7, offH: 1.22, lunge: 0.35, hitstop: 6, gauge: 5,
    level: LEVEL.MID, anim: 'punch_straight',
    chain: 'hook', cancelInto: ['fireball', 'beam', 'knife', 'dash_punch'],
  }),
  hook: def({
    id: 'hook', name: 'Hook', input: 'P~P~P',
    startup: 10, active: 4, recovery: 16,
    damage: 15, hitstun: 19, blockstun: 11, knockback: 0.3,
    reach: 0.5, offF: 0.66, offH: 1.2, lunge: 0.3, hitstop: 7, gauge: 6,
    level: LEVEL.MID, anim: 'punch_hook',
    chain: 'uppercut', cancelInto: ['fireball', 'beam', 'dash_punch'],
  }),
  uppercut: def({
    id: 'uppercut', name: 'Uppercut Finish', input: 'P~P~P~P',
    startup: 12, active: 5, recovery: 24,
    damage: 20, hitstun: 26, blockstun: 12, knockback: 0.2, launch: 5.2,
    reach: 0.52, offF: 0.6, offH: 1.35, lunge: 0.25, hitstop: 9, gauge: 8,
    level: LEVEL.MID, anim: 'punch_finish',
    cancelInto: ['super'],
  }),

  // ---------------- キック系オートコンボ列（K連打）----------------
  low_kick: def({
    id: 'low_kick', name: 'Low Kick', input: 'K',
    startup: 6, active: 4, recovery: 12,
    damage: 10, hitstun: 14, blockstun: 8, knockback: 0.16,
    reach: 0.55, offF: 0.62, offH: 0.35, lunge: 0.2, hitstop: 5, gauge: 4,
    level: LEVEL.LOW, anim: 'kick_low', chargeCost: 2,
    chain: 'mid_kick', cancelInto: ['fireball', 'beam', 'dash_punch'],
  }),
  mid_kick: def({
    id: 'mid_kick', name: 'Mid Kick', input: 'K~K',
    startup: 9, active: 5, recovery: 16,
    damage: 14, hitstun: 18, blockstun: 11, knockback: 0.34,
    reach: 0.62, offF: 0.78, offH: 1.0, lunge: 0.4, hitstop: 6, gauge: 6,
    level: LEVEL.MID, anim: 'kick_mid', chargeCost: 2,
    chain: 'spin_kick', cancelInto: ['fireball', 'beam'],
  }),
  spin_kick: def({
    id: 'spin_kick', name: 'Spin Kick Finish', input: 'K~K~K',
    startup: 13, active: 6, recovery: 26,
    damage: 19, hitstun: 24, blockstun: 12, knockback: 0.9,
    reach: 0.66, offF: 0.72, offH: 1.05, lunge: 0.35, hitstop: 9, gauge: 8,
    level: LEVEL.MID, anim: 'kick_spin', knockdownOnHit: true, chargeCost: 2,
    cancelInto: ['super'],
  }),

  // ---------------- 段の崩し（方向＋ボタン）----------------
  overhead: def({
    id: 'overhead', name: 'Overhead', input: '8P',
    startup: 16, active: 4, recovery: 20,
    damage: 14, hitstun: 20, blockstun: 10, knockback: 0.25,
    reach: 0.5, offF: 0.6, offH: 1.5, lunge: 0.3, hitstop: 7, gauge: 6,
    level: LEVEL.HIGH, anim: 'punch_high',
    cancelInto: ['fireball', 'beam', 'super'],
  }),
  sweep: def({
    id: 'sweep', name: 'Sweep', input: '2K',
    startup: 11, active: 5, recovery: 22,
    damage: 13, hitstun: 18, blockstun: 9, knockback: 0.3,
    reach: 0.66, offF: 0.78, offH: 0.22, lunge: 0.45, hitstop: 7, gauge: 6,
    level: LEVEL.LOW, anim: 'sweep', knockdownOnHit: true, chargeCost: 2,
    cancelInto: ['super'],
  }),

  // ---------------- 空中攻撃（飛び込み）----------------
  air_punch: def({
    id: 'air_punch', name: 'Air Punch', input: 'j.P',
    startup: 6, active: 8, recovery: 8,
    damage: 12, hitstun: 16, blockstun: 9, knockback: 0.2,
    reach: 0.5, offF: 0.45, offH: -0.2, lunge: 0, hitstop: 6, gauge: 5,
    level: LEVEL.HIGH, anim: 'air_punch', airOk: true, landCancel: true,
  }),
  air_kick: def({
    id: 'air_kick', name: 'Air Kick', input: 'j.K',
    startup: 7, active: 10, recovery: 10,
    damage: 15, hitstun: 18, blockstun: 10, knockback: 0.3,
    reach: 0.58, offF: 0.55, offH: -0.35, lunge: 0, hitstop: 7, gauge: 6,
    level: LEVEL.HIGH, anim: 'air_kick', airOk: true, landCancel: true, chargeCost: 2,
  }),

  // ---------------- 投げ ----------------
  throw: def({
    id: 'throw', name: 'Throw', input: 'P+K',
    type: 'throw', startup: 5, active: 3, recovery: 22,
    damage: 28, hitstun: 0, blockstun: 0, knockback: 0,
    reach: 0.6, offF: 0.5, offH: 1.0, lunge: 0.1, hitstop: 8, gauge: 10,
    level: LEVEL.THROW, anim: 'throw', knockdownOnHit: true, chargeCost: 0,
  }),
};

// オートコンボの開始技（P列 / K列）。タップ(中段)で始動し、連打で chain を辿る。SPEC §2.8-6。
export const AUTO_COMBO = {
  P: 'jab',      // → straight → hook → uppercut（中段の主力コンボ）
  K: 'mid_kick', // → spin_kick（中段キックコンボ）
};

// 段の決定（フリック由来の level: 'high'|'mid'|'low'）。
//   タップ(mid) = オートコンボ始動（null を返し呼び出し側が AUTO_COMBO 参照）
//   上フリック(high)=顔面/上段（立ガード必須） / 下フリック(low)=足元/下段（しゃがみガード必須）
// P/K はチャージ不要・常時使用可（段はフリックで撃ち分け、連打でコンボ）。
export function resolveAttackMove(button, level, airborne) {
  if (airborne) return button === 'P' ? 'air_punch' : 'air_kick';
  if (button === 'P') {
    if (level === 'high') return 'overhead';   // 顔面パンチ（上段）
    if (level === 'low') return 'low_punch';   // 足元パンチ（下段）
    return null;                                // mid → AUTO_COMBO.P（jab）
  }
  if (button === 'K') {
    if (level === 'high') return 'high_kick';  // 上段キック
    if (level === 'low') return 'sweep';       // 足払い（下段・ダウン）
    return null;                                // mid → AUTO_COMBO.K（mid_kick）
  }
  return null;
}

// しゃがみP（下+P）= 速い中段差し込み（オートコンボには乗らない単発）
MOVES.lowP = def({
  id: 'lowP', name: 'Crouch Jab', input: '2P',
  startup: 5, active: 3, recovery: 10,
  damage: 7, hitstun: 13, blockstun: 8, knockback: 0.1,
  reach: 0.48, offF: 0.58, offH: 0.7, lunge: 0.12, hitstop: 5, gauge: 3,
  level: LEVEL.MID, anim: 'punch_low', crouchOk: true,
  cancelInto: ['fireball', 'beam', 'sweep'],
});

// 下フリックP = 足元パンチ（下段・しゃがみガード必須）。単発・素早い差し込み。
MOVES.low_punch = def({
  id: 'low_punch', name: 'Low Punch', input: 'v.P',
  startup: 7, active: 4, recovery: 12,
  damage: 10, hitstun: 14, blockstun: 8, knockback: 0.14,
  reach: 0.5, offF: 0.6, offH: 0.42, lunge: 0.18, hitstop: 5, gauge: 4,
  level: LEVEL.LOW, anim: 'punch_low',
  cancelInto: ['fireball', 'beam', 'super'],
});

// 上フリックK = 上段キック（顔面・立ガード必須）。リーチ長め・やや発生遅い。
MOVES.high_kick = def({
  id: 'high_kick', name: 'High Kick', input: '^.K',
  startup: 11, active: 5, recovery: 18,
  damage: 15, hitstun: 18, blockstun: 10, knockback: 0.3,
  reach: 0.62, offF: 0.74, offH: 1.55, lunge: 0.3, hitstop: 7, gauge: 6,
  level: LEVEL.HIGH, anim: 'kick_high', chargeCost: 2,
  cancelInto: ['fireball', 'beam', 'super'],
});

export function getMove(id) { return MOVES[id]; }
