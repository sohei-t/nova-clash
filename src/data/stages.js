// =====================================================================
// NOVA CLASH — ステージ定義（SPEC §5）。リングアウト有/無の両タイプ。
// shape: circle|square。ringOut: 外周超で即敗北。walls: 壁で押し返し。
// =====================================================================

// 全ステージ リングアウト無し・壁あり（広く自由に動き回れる）。SPEC §5 を本作の方針で更新。
export const STAGES = [
  {
    id: 'nova_ring', name: 'Nova Arena', nameJa: 'ノヴァ・アリーナ',
    shape: 'circle', radius: 9.0, ringOut: false, walls: true,
    theme: { ground: 0x2a3350, edge: 0x55ddff, edgeEmissive: 0x1166aa, bg: 0x0b1020, fog: [20, 46], accent: 0x55ddff },
    desc: '広い円形アリーナ。壁あり＝場外なし。縦横無尽に動いて差し合う。',
  },
  {
    id: 'colosseum', name: 'Colosseum', nameJa: 'コロシアム',
    shape: 'circle', radius: 9.6, ringOut: false, walls: true,
    theme: { ground: 0x3a2f28, edge: 0xffaa55, edgeEmissive: 0x553311, bg: 0x140d08, fog: [22, 50], accent: 0xffaa55 },
    desc: '壁ありの大闘技場。純粋な殴り合い。画面端の攻防。',
  },
  {
    id: 'night_deck', name: 'Night Deck', nameJa: 'ナイト・デッキ',
    shape: 'square', radius: 8.5, ringOut: false, walls: true,
    theme: { ground: 0x1a2438, edge: 0x66ffcc, edgeEmissive: 0x115544, bg: 0x05080f, fog: [18, 40], accent: 0x66ffcc },
    desc: '夜景の方形リング。四方を光壁で囲まれた広いフロア。',
  },
  {
    id: 'dojo', name: 'Sky Dojo', nameJa: 'スカイ道場',
    shape: 'circle', radius: 10.0, ringOut: false, walls: true,
    theme: { ground: 0x40384a, edge: 0xcc88ff, edgeEmissive: 0x442266, bg: 0x0a0814, fog: [24, 52], accent: 0xcc88ff },
    desc: '最も広い壁あり道場。ゾーナーが弾を撒きやすい遠間合いステージ。',
  },
];

export function getStage(id) { return STAGES.find((s) => s.id === id) || STAGES[0]; }
