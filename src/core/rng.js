// seed 付き決定論 PRNG（mulberry32）。AI のゆらぎ等に使用。
// 同一 seed → 同一系列 = 決定論を保つ（SPEC §13）。
export function makeRng(seed = 0x9e3779b9) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
