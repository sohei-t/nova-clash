// =====================================================================
// 入力: Controller（プレイヤ1人ぶんの抽象状態）＋ Keyboard バインド＋
//       raw → sim intent 変換（段の方向修飾・ダブルタップ ダッシュ/サイドステップ・
//       P+K 投げ・必殺/スーパー）。タッチ/ジャイロも Controller に書き込む。
// =====================================================================

import { emptyIntent } from '../core/sim.js?v=1782623521';
import { CONFIG } from '../core/constants.js?v=1782623521';

const BTNS = ['P', 'K', 'S', 'G', 'JUMP', 'SUPER', 'GRAB'];

export class Controller {
  constructor() {
    this.move = { x: 0, y: 0 };       // x=接近/後退 y=奥行き(画面準拠)
    this.gyroEnabled = false;          // true のとき x(接近/後退)はジャイロが供給
    this.held = {}; this._prev = {};
    for (const b of BTNS) { this.held[b] = false; this._prev[b] = false; }
    this._atk = null;                  // フリック由来の攻撃latch {btn:'P'|'K'|'GRAB', dir:'high'|'mid'|'low'}
    // scheme 状態（ダブルタップ・S長押し）
    this.s = { lastF: { up: -99, dn: -99, lf: -99, rt: -99 }, prevDir: { x: 0, y: 0 }, frame: 0, sHold: 0 };
  }
  setBtn(name, down) { if (name in this.held) this.held[name] = !!down; }
  setMove(x, y) { this.move.x = x; this.move.y = y; }
  // タッチのフリック/タップで段付き攻撃を1回要求（buildIntent が1フレームで消費）。
  pressAttack(btn, dir) { this._atk = { btn, dir }; }
  pressed(b) { return this.held[b] && !this._prev[b]; }
  endFrame() { for (const b of BTNS) this._prev[b] = this.held[b]; }
}

export class Keyboard {
  // keymap: { up,down,left,right, P,K,S,G,JUMP,SUPER } -> KeyboardEvent.code
  constructor(controller, keymap) {
    this.c = controller; this.map = keymap; this.down = new Set();
    this._kd = (e) => { if (this._uses(e.code)) { if (e.code === 'Space') e.preventDefault(); this.down.add(e.code); this._apply(); } };
    this._ku = (e) => { if (this.down.delete(e.code)) this._apply(); };
    this._bl = () => { this.down.clear(); this._apply(); };
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    window.addEventListener('blur', this._bl);
  }
  _uses(code) { return Object.values(this.map).includes(code); }
  _apply() {
    const m = this.map, d = this.down;
    const x = (d.has(m.right) ? 1 : 0) - (d.has(m.left) ? 1 : 0);
    const y = (d.has(m.up) ? 1 : 0) - (d.has(m.down) ? 1 : 0);
    this.c.setMove(x, y);
    this.c.setBtn('P', d.has(m.P)); this.c.setBtn('K', d.has(m.K));
    this.c.setBtn('S', d.has(m.S)); this.c.setBtn('G', d.has(m.G));
    this.c.setBtn('JUMP', d.has(m.JUMP)); this.c.setBtn('SUPER', d.has(m.SUPER));
  }
  dispose() { window.removeEventListener('keydown', this._kd); window.removeEventListener('keyup', this._ku); window.removeEventListener('blur', this._bl); }
}

export const KEYMAP_P1 = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', P: 'KeyJ', K: 'KeyK', S: 'KeyU', G: 'KeyL', JUMP: 'Space', SUPER: 'KeyI' };
export const KEYMAP_P2 = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', P: 'Numpad1', K: 'Numpad2', S: 'Numpad3', G: 'Numpad0', JUMP: 'NumpadEnter', SUPER: 'Numpad4' };

// Controller → sim intent（1描画フレームに1回）。
export function buildIntent(c) {
  const I = emptyIntent();
  const s = c.s; s.frame++;
  const W = CONFIG.DOUBLE_TAP_FRAMES;

  // 方向の digital 化（画面準拠: dx=左右, dy=上下）。リング内を自由に動ける。
  // 回避はジャンプ＋ガード＋自由移動に集約（専用のダッシュ/サイドステップは廃止）。
  const DZ = 0.28; // デッドゾーン（小さめ＝軽い倒しでも反応＝接近しやすく）
  const dx = c.move.x > DZ ? 1 : c.move.x < -DZ ? -1 : 0;
  const dy = c.move.y > DZ ? 1 : c.move.y < -DZ ? -1 : 0;
  I.moveX = dx;        // 左右 = 接近/後退（ワールドX）
  I.moveZ = -dy;       // 上 = 奥(-Z) / 下 = 手前(+Z)
  I.up = dy > 0; I.down = dy < 0; // 段の修飾（▲上段 / ▼下段）・しゃがみガード(G+下)
  void W; void s.prevDir;

  // ボタン
  I.guard = c.held.G;
  // 攻撃: タッチ=フリックlatch（段を明示）/ キーボード=エッジ＋スティック方向で段を導出。
  const a = c._atk; c._atk = null;          // latch は1フレームで消費
  const pP = c.pressed('P'), pK = c.pressed('K');
  if ((pP && pK) || c.pressed('GRAB') || (a && a.btn === 'GRAB')) {
    I.grab = true;                          // 投げ = P+K 同時（キーボード）or タッチの同時押しlatch
  } else if (a) {
    if (a.btn === 'P') I.P = true; else if (a.btn === 'K') I.K = true;
    I.atkLevel = a.dir;                     // 'high'|'mid'|'low'（フリック由来＝移動と独立）
  } else {
    if (pP) I.P = true;                     // キーボード: 段は up/down から sim 側で導出
    if (pK) I.K = true;
  }
  if (c.pressed('S')) I.S = true;
  if (c.pressed('JUMP')) I.jump = true;
  if (c.pressed('SUPER')) I.superBtn = true;

  return I;
}

// 描画 dt 内で複数 tick を回すとき、2tick目以降は「保持入力のみ（エッジ除去）」を使う
export function heldOnly(intent) {
  return { ...intent, P: false, K: false, S: false, jump: false, grab: false, superBtn: false,
    atkLevel: null, dashF: false, dashB: false, stepL: false, stepR: false, dashX: 0, stepZ: 0 };
}
