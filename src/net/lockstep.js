// =====================================================================
// NOVA CLASH — 決定論ロックステップのコア（THREE / WebRTC 非依存・純ロジック）
// ---------------------------------------------------------------------
// 決定論シム Match.step(i0,i1) は「同一 seed + 同一 intent 列」で同一状態を再現する。
// よってオンラインは “状態同期” 不要で、各ピアが自分の intent だけを相手へ送り、
// 両者が同じフレームを同じ (i0,i1) で進めれば画面が一致する（GGPO型 delay lockstep）。
//
// 入力遅延 D: 「今読んだ入力」は D フレーム後に適用する。先頭 D フレームは中立入力。
//   送信側は sendFrame=D から自分の入力を 1F=1個 送る（先頭Dは送らず両者ローカルで中立）。
//   進行側は simFrame の自他 intent が揃ったら step、揃わなければ待つ（stall）。
//
// このファイルはトランスポート(WebRTC)もループ(rAF)も知らない純粋なバッファ管理。
// → tests/net.mjs が「遅延・順序入替を伴う2セッションが完全同期する」ことを検証する。
// =====================================================================
import { emptyIntent } from '../core/sim.js';

export class LockstepSession {
  // localPlayer: 自分が操作するファイター index（0 or 1）
  // inputDelay : 入力遅延フレーム（2-3 推奨。大きいほどラグに強いが反応が鈍る）
  // neutral    : 中立 intent を返す factory（既定 emptyIntent）
  constructor({ localPlayer, inputDelay = 2, neutral = emptyIntent } = {}) {
    if (localPlayer !== 0 && localPlayer !== 1) throw new Error('localPlayer must be 0 or 1');
    this.local = localPlayer;
    this.remote = 1 - localPlayer;
    this.delay = inputDelay | 0;
    this.neutral = neutral;
    this.simFrame = 0;                 // 次に進めるフレーム
    this.sendFrame = this.delay;       // 次に送るローカル入力のフレーム（先頭Dは中立）
    this.localInputs = new Map();      // frame -> intent（自分）
    this.remoteInputs = new Map();     // frame -> intent（相手）
    this.lastRemoteFrame = this.delay - 1; // 相手から受領済みの最大フレーム（先行度の指標）
    for (let f = 0; f < this.delay; f++) {
      this.localInputs.set(f, this._n());
      this.remoteInputs.set(f, this._n());   // 相手の先頭Dフレームも中立（送受不要）
    }
  }

  _n() { return typeof this.neutral === 'function' ? this.neutral() : this.neutral; }

  // 1フレーム分のローカル入力を確定し、相手へ送るパケットを返す。
  // intent は emptyIntent() 形のオブジェクト。戻り値 {frame, intent} を DataChannel で送る。
  sendLocal(intent) {
    const frame = this.sendFrame++;
    this.localInputs.set(frame, intent);
    return { frame, intent };
  }

  // 相手から受領した入力を登録（順不同・重複は上書きで冪等）。
  receiveRemote(frame, intent) {
    if (frame < this.simFrame) return;        // 既に消費済みは無視
    this.remoteInputs.set(frame, intent);
    if (frame > this.lastRemoteFrame) this.lastRemoteFrame = frame;
  }

  // 現在の simFrame を進められるか（自他の intent が揃っているか）。
  canStep() {
    return this.localInputs.has(this.simFrame) && this.remoteInputs.has(this.simFrame);
  }

  // simFrame を消費し [i0, i1]（index 順）を返して 1 つ進む。canStep() が true の時のみ呼ぶ。
  consume() {
    const f = this.simFrame;
    const li = this.localInputs.get(f);
    const ri = this.remoteInputs.get(f);
    const intents = [];
    intents[this.local] = li;
    intents[this.remote] = ri;
    this.localInputs.delete(f);
    this.remoteInputs.delete(f);
    this.simFrame++;
    return intents;
  }

  // 相手入力の先行フレーム数（自分の進行に対してどれだけ届いているか）。
  // 大きいほど余裕、0 以下は枯渇＝stall 寸前。同期ペース調整やUI表示に使う。
  remoteLead() { return this.lastRemoteFrame - this.simFrame; }

  // 進行が相手待ちで止まっているか（描画は続けるが sim は止める判断に使う）。
  isStalled() { return !this.canStep(); }
}

// ---------------------------------------------------------------------
// 状態チェックサム（desync 検知用）。Match の観測可能な状態を uint32 に畳む。
// 同一コードで同一 intent 列を食えば両ピアで一致するはず。一致しなければ desync。
// 注意: RNG 内部状態はクロージャに隠れていて読めないが、観測状態の一致で十分に検知できる。
// ---------------------------------------------------------------------
function strHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export function matchChecksum(m) {
  let h = 0x811c9dc5;
  const mix = (v) => { h ^= (v >>> 0); h = Math.imul(h, 0x01000193) >>> 0; };
  const mixF = (f) => mix((Math.round((f || 0) * 1000)) | 0);   // 浮動小数は量子化
  const mixS = (s) => mix(strHash(String(s)));

  mixS(m.phase); mix(m.phaseFrame | 0); mix(m.timer | 0);
  mix(m.hitstop | 0); mix(m.superFreeze | 0); mix(m.koSlow | 0);
  mix(m.round | 0); mix(m.wins[0] | 0); mix(m.wins[1] | 0);
  mix(m.roundWinner | 0); mix(m.matchWinner | 0);

  for (const f of m.fighters) {
    mixF(f.x); mixF(f.z); mixF(f.y); mixF(f.vy);
    mix(f.hp | 0); mixF(f.gauge); mixF(f.sp);
    mixS(f.state); mix(f.stateFrame | 0); mix(f.moveFrame | 0);
    mix(f.comboCount | 0); mix(f.stun | 0); mix(f.airborne ? 1 : 0);
    mix(f.facingDir | 0);
    mixS(f.move ? (f.move.input || f.move.anim || 'm') : '');
  }

  mix(m.projectiles.length | 0);
  for (const p of m.projectiles) { mixF(p.x); mixF(p.z); mixF(p.y); mix(p.owner | 0); }
  return h >>> 0;
}
