// =====================================================================
// NOVA CLASH — intent のワイヤ符号化（DataChannel 用・コンパクト）
// buildIntent() が生成するフィールドだけを短いキーで送り、decode で emptyIntent に戻す。
// dash*/step* は buildIntent では使われない（既定 0/false のまま）ので送らない。
// =====================================================================
import { emptyIntent } from '../core/sim.js?v=1782623521';

const LV = { high: 1, mid: 2, low: 3 };
const LV_R = { 1: 'high', 2: 'mid', 3: 'low' };

// intent → 最小オブジェクト（false/0/null は省略してバイト数を抑える）
export function encodeIntent(i) {
  const o = {};
  if (i.moveX) o.x = i.moveX;            // -1 / 1（0は省略）
  if (i.moveZ) o.z = i.moveZ;
  if (i.up) o.u = 1;
  if (i.down) o.d = 1;
  if (i.guard) o.g = 1;
  if (i.P) o.P = 1;
  if (i.K) o.K = 1;
  if (i.S) o.S = 1;
  if (i.jump) o.j = 1;
  if (i.grab) o.G = 1;
  if (i.superBtn) o.U = 1;
  if (i.atkLevel && LV[i.atkLevel]) o.a = LV[i.atkLevel];
  return o;
}

// 最小オブジェクト → 完全な intent（未指定は emptyIntent の既定）
export function decodeIntent(o) {
  const i = emptyIntent();
  if (!o) return i;
  if (o.x) i.moveX = o.x;
  if (o.z) i.moveZ = o.z;
  i.up = !!o.u;
  i.down = !!o.d;
  i.guard = !!o.g;
  i.P = !!o.P;
  i.K = !!o.K;
  i.S = !!o.S;
  i.jump = !!o.j;
  i.grab = !!o.G;
  i.superBtn = !!o.U;
  i.atkLevel = o.a ? (LV_R[o.a] || null) : null;
  return i;
}
