// =====================================================================
// NOVA CLASH — 必殺・スーパー・飛び道具（SPEC §2.8-3 / §2.8-7）
// ゾーナー↔ラッシャーの対立軸を作る固有アビリティ。
// slot: 'S'(専用ボタン) / 'upS'(▲+S) / 'downS'(▼+S) / 'super'。
// コスト: cooldown(F) = 弱い牽制 / gauge = 強い必殺・スーパー（乱射防止）。
// =====================================================================

import { LEVEL } from '../core/constants.js';

// 飛び道具プロトタイプ（弾エンティティの初期値）。SPEC §2.8-7。
//   speed(m/s) damage hitstun blockstun chip radius life(F) level height strength(相殺強度)
export const PROJECTILES = {
  // height/radius は「ジャンプで余裕を持って飛び越せる」低さに調整（ジャンプ頂点≈1.85m）。
  fireball: { kind: 'fireball', speed: 7.5, damage: 14, hitstun: 20, blockstun: 12, chip: 2, radius: 0.26, life: 150, level: LEVEL.MID, height: 0.5, strength: 1, color: 0xff7722 },
  beam:     { kind: 'beam', speed: 16, damage: 18, hitstun: 22, blockstun: 14, chip: 3, radius: 0.28, life: 90, level: LEVEL.HIGH, height: 1.25, strength: 2, color: 0x66ddff },
  knife:    { kind: 'knife', speed: 12, damage: 7, hitstun: 14, blockstun: 7, chip: 1, radius: 0.2, life: 110, level: LEVEL.MID, height: 0.6, strength: 0, color: 0xdddddd },
  shock:    { kind: 'shock', speed: 4.5, damage: 20, hitstun: 26, blockstun: 16, chip: 4, radius: 0.5, life: 130, level: LEVEL.LOW, height: 0.35, strength: 3, color: 0xaa66ff },
  exfire:   { kind: 'fireball', speed: 9, damage: 22, hitstun: 26, blockstun: 16, chip: 4, radius: 0.36, life: 160, level: LEVEL.MID, height: 0.46, strength: 3, color: 0xffcc33 },
};

const sdef = (m) => ({
  type: 'special', level: LEVEL.MID, knockback: 0.4, pushback: 0.2,
  reach: 0.55, offF: 0.7, offH: 1.0, lunge: 0.3, hitstop: 8, gauge: 0,
  cooldown: 0, cost: 0, launch: 0, cancelInto: [], counterBonus: 1.2,
  fx: 'spark_special', sfx: 'special', ...m,
});

// 個々の必殺技ライブラリ。キャラ profile が id を slot に割り当てる。
export const SPECIALS = {
  // ----- 飛び道具（ゾーナー）-----
  fireball: sdef({
    id: 'fireball', name: 'Fireball', anim: 'special_cast',
    startup: 13, active: 1, recovery: 28, cooldown: 36, cost: 0,
    spawn: { proto: 'fireball', frame: 13, offF: 0.6, gaugeOnFire: 4 },
  }),
  beam: sdef({
    id: 'beam', name: 'Ion Beam', anim: 'special_cast',
    startup: 16, active: 1, recovery: 30, cost: 25,
    spawn: { proto: 'beam', frame: 16, offF: 0.7 },
  }),
  knife: sdef({
    id: 'knife', name: 'Throwing Knife', anim: 'special_cast',
    startup: 8, active: 1, recovery: 16, cooldown: 18, cost: 0,
    spawn: { proto: 'knife', frame: 8, offF: 0.55 },
  }),
  shock: sdef({
    id: 'shock', name: 'Ground Shock', anim: 'special_cast',
    startup: 18, active: 1, recovery: 32, cost: 30,
    spawn: { proto: 'shock', frame: 18, offF: 0.5 },
  }),
  exfire: sdef({
    id: 'exfire', name: 'EX Fireball', anim: 'special_cast',
    startup: 11, active: 1, recovery: 24, cost: 50,
    spawn: { proto: 'exfire', frame: 11, offF: 0.6 },
  }),

  // ----- 突進（ラッシャー）-----
  dash_punch: sdef({
    id: 'dash_punch', name: 'Dash Punch', anim: 'special_dash',
    startup: 11, active: 6, recovery: 22, cost: 0, cooldown: 30,
    damage: 16, hitstun: 22, blockstun: 12, knockback: 0.6, reach: 0.55, offF: 0.7, offH: 1.1,
    lunge: 2.4, level: LEVEL.MID,
  }),
  rising_kick: sdef({
    id: 'rising_kick', name: 'Rising Kick', anim: 'kick_high',
    startup: 7, active: 6, recovery: 28, cost: 25,
    damage: 16, hitstun: 24, blockstun: 10, knockback: 0.2, launch: 5.5, reach: 0.6, offF: 0.5, offH: 1.3,
    lunge: 0.6, level: LEVEL.MID, antiAir: true,
  }),
  flying_knee: sdef({
    id: 'flying_knee', name: 'Flying Knee', anim: 'special_dash',
    startup: 10, active: 8, recovery: 20, cost: 0, cooldown: 34,
    damage: 15, hitstun: 22, blockstun: 11, knockback: 0.5, reach: 0.55, offF: 0.6, offH: 1.0,
    lunge: 2.0, level: LEVEL.HIGH,
  }),

  // ----- 投げ（グラップラー）-----
  command_grab: sdef({
    id: 'command_grab', name: 'Command Grab', anim: 'throw',
    type: 'throw', startup: 8, active: 3, recovery: 26, cost: 0, cooldown: 40,
    damage: 32, knockback: 0, reach: 0.85, offF: 0.4, offH: 1.0, lunge: 0.6, level: LEVEL.THROW,
    knockdownOnHit: true, throwTechable: false,
  }),
};

// スーパー（ゲージ MAX 消費・大ダメージ＋演出）。SPEC §2.8-3。
const supdef = (m) => ({ type: 'super', cost: 100, freeze: 36, level: LEVEL.MID, hitstop: 12, gauge: 0, cancelInto: [], counterBonus: 1, ...m });
export const SUPERS = {
  super_rush: supdef({
    id: 'super_rush', name: 'Nova Rush', anim: 'super',
    startup: 8, active: 10, recovery: 34,
    damage: 55, hitstun: 30, blockstun: 18, knockback: 1.2, reach: 0.7, offF: 0.7, offH: 1.1, lunge: 1.5,
  }),
  super_beam: supdef({
    id: 'super_beam', name: 'NOVA CANNON', anim: 'super',
    startup: 14, active: 1, recovery: 42, freeze: 44,
    spawn: { proto: 'beam', frame: 14, offF: 0.8, big: 2.7, damage: 90 }, // 画面横断の極太ビーム・大ダメージ
    damage: 0,
  }),
};

export function getSpecial(id) { return SPECIALS[id] || SUPERS[id]; }
