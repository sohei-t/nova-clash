// =====================================================================
// NOVA CLASH — AI（効用関数ベース・難易度3段）。SPEC §3.3。
// 距離・相手状態・フレーム有利・ゲージ・アーキタイプ(得意間合い)を見て行動。
// 決定論: match.rng を使う（Math.random 不使用）。
// =====================================================================

import { ST, CONFIG } from './constants.js';
import { emptyIntent } from './sim.js';

const hypot = Math.hypot;

const PRESETS = [
  { name: 'EASY',   react: 0.18, attackGap: 30, special: 0.012, sidestep: 0.01, combo: 0.35, jump: 0.006, approach: 0.85 },
  { name: 'NORMAL', react: 0.42, attackGap: 20, special: 0.03,  sidestep: 0.03, combo: 0.6,  jump: 0.012, approach: 0.95 },
  { name: 'HARD',   react: 0.72, attackGap: 13, special: 0.06,  sidestep: 0.06, combo: 0.82, jump: 0.02,  approach: 1.0 },
];

export class FighterAI {
  constructor(difficulty = 1) {
    this.p = PRESETS[Math.max(0, Math.min(2, difficulty))];
    this.atkCd = 0;
    this.spCd = 0;
    this.decisionCd = 0;
    this.intent = emptyIntent();
  }

  decide(self, opp, match) {
    const r = match.rng;
    const I = emptyIntent();
    if (self.state === ST.KO || self.state === ST.WIN || !self || self.hp <= 0) return I;
    if (this.atkCd > 0) this.atkCd--;
    if (this.spCd > 0) this.spCd--;

    const dx = opp.x - self.x, dz = opp.z - self.z;
    const dist = hypot(dx, dz);
    const towardX = Math.sign(dx) || 1;        // 接近=相手のいる側へ（ワールドX）
    const range = self.roster.range || 'mid';
    // 間合い: 逃げ過ぎないよう控えめに（プレイヤーが接近・交戦しやすく）。
    const idealMin = range === 'far' ? 3.0 : range === 'close' ? 0.9 : 1.2;
    const idealMax = range === 'far' ? 5.0 : range === 'close' ? 1.6 : 2.0;

    const guarding = !self.actionable && self.state !== ST.JUMP;
    if (guarding) return I;

    // --- 対空: 相手が頭上に飛んできたら昇り技（チャージMAX時）---
    if (opp.airborne && dist < 2.2 && self.gauge >= CONFIG.THRESH_S && this.spCd <= 0 && r() < this.p.react) {
      I.S = true; I.up = true; this.spCd = 26; return I;
    }

    // --- ガード反応: 相手が攻撃中で間合い内なら一定確率でガード ---
    if (opp.state === ST.ATTACK && dist < 2.2 && r() < this.p.react) {
      I.guard = true;
      if (opp.move && opp.move.level === 'low') I.down = true;
      return I;
    }
    // 飛び道具が迫っていたらガード or サイドステップ
    for (const pr of match.projectiles) {
      if (pr.owner === self.index) continue;
      const toMe = (pr.x - self.x) * pr.vx + (pr.z - self.z) * pr.vz;
      const pd = hypot(pr.x - self.x, pr.z - self.z);
      if (toMe < 0 && pd < 3.0) {
        if (range !== 'close' && r() < this.p.sidestep + 0.25) { I.stepL = r() < 0.5; I.stepR = !I.stepL; return I; }
        I.guard = true; return I;
      }
    }

    // --- ゾーナー: 遠間合いを保ち飛び道具を撒く ---
    if (range === 'far') {
      if (dist > idealMax) { I.moveX = towardX; }
      else if (dist < idealMin && r() < 0.6) { I.moveX = -towardX; if (r() < 0.12) I.dashB = true; } // 逃げは控えめ・バクステ稀
      if (dist > idealMin && self.gauge >= CONFIG.THRESH_S && this.spCd <= 0 && r() < this.p.special + 0.04) {
        I.S = true; this.spCd = 30; return I;
      }
    }

    // --- 接近/間合い調整（ワールドX、奥行きも軽く合わせる）---
    if (Math.abs(dz) > 0.6 && dist > idealMin) I.moveZ = Math.sign(dz);
    if (dist > idealMax) {
      I.moveX = towardX;
      if (range === 'close' && r() < 0.02) I.dashF = true;
    } else if (dist < idealMin && range !== 'close' && r() < 0.4) {
      I.moveX = -towardX;   // 近距離でも常時は逃げない（交戦を維持）
    } else {
      // 間合い内: 攻撃・崩し
      if (this.atkCd <= 0 && r() < this.p.react) {
        const roll = r();
        if (roll < 0.12 && range === 'close') { I.grab = true; this.atkCd = this.p.attackGap; return I; }
        // P/K は常時使用可。必殺(S)のみチャージMAX(10)が必要。段は up/down で混ぜる（高/低）。
        if (roll < 0.34) { I.K = true; if (r() < 0.4) I.down = true; else if (r() < 0.2) I.up = true; }
        else if (roll < 0.58) { I.P = true; if (r() < 0.3) I.up = true; else if (r() < 0.2) I.down = true; }
        else if (self.gauge >= CONFIG.THRESH_S && this.spCd <= 0) { I.S = true; this.spCd = 28; }
        else { I.P = true; }
        this.atkCd = this.p.attackGap;
        return I;
      }
      // サイドステップで回り込み
      if (r() < this.p.sidestep) { I.stepL = r() < 0.5; I.stepR = !I.stepL; return I; }
    }

    // --- オートコンボ継続（自分が攻撃recovery中に連打）---
    if (self.state === ST.ATTACK && self.move && self.move.chain && r() < this.p.combo) {
      if (self.move.input.startsWith('K')) I.K = true; else I.P = true;
    }

    // --- ウルトラ: SP ゲージ MAX で発射（遠距離ビームなので間合い不問）---
    if (self.sp >= CONFIG.SP_MAX && r() < this.p.react * 0.45) { I.superBtn = true; return I; }

    // たまにジャンプ
    if (r() < this.p.jump && dist < 3.5) I.jump = true;

    return I;
  }
}
