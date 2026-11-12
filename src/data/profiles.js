// =====================================================================
// NOVA CLASH — アーキタイプ profile（得意間合いの個性）。SPEC §3.1b。
// registry.json の各キャラが archetype を指定 → ここから戦闘プロファイルを引く。
// 「得意な間合い」で遊び方が変わる（ゾーナー↔ラッシャー）。
// =====================================================================

// stats: maxHp, weight(ノックバック耐性 1=標準), walkMul/backMul/sideMul(速度倍率)
// specials: slot→special id（specials.js）。super: super id。
// autoComboP/K: オートコンボ始動技（既定は moves.AUTO_COMBO）。
export const PROFILES = {
  balance: {
    archetype: 'balance', label: 'バランス（カポエイラ）',
    desc: '標準。サイドステップが強く、近遠どちらもこなす。入門向け。',
    stats: { maxHp: 280, weight: 1.0, walkMul: 1.0, backMul: 1.0, sideMul: 1.25 },
    specials: { S: 'fireball', upS: 'rising_kick', downS: 'dash_punch' },
    super: 'super_beam',
    range: 'mid',
  },
  rusher: {
    archetype: 'rusher', label: 'ラッシャー（ボクサー）',
    desc: '手数とラッシュ。弾をかわして一気に詰める接近型。',
    stats: { maxHp: 260, weight: 0.95, walkMul: 1.18, backMul: 1.05, sideMul: 1.0 },
    specials: { S: 'dash_punch', upS: 'rising_kick', downS: 'flying_knee' },
    super: 'super_beam',
    range: 'close',
  },
  zoner: {
    archetype: 'zoner', label: 'ゾーナー',
    desc: '遠距離で飛び道具を撒いて牽制・崩す。接近を嫌う。',
    stats: { maxHp: 250, weight: 0.9, walkMul: 0.92, backMul: 1.15, sideMul: 1.05 },
    specials: { S: 'fireball', upS: 'beam', downS: 'shock' },
    super: 'super_beam',
    range: 'far',
  },
  grappler: {
    archetype: 'grappler', label: 'グラップラー',
    desc: '投げと接近戦。体力高め・発生遅め・アーマー気味。',
    stats: { maxHp: 320, weight: 1.25, walkMul: 0.9, backMul: 0.85, sideMul: 0.9 },
    specials: { S: 'command_grab', upS: 'rising_kick', downS: 'dash_punch' },
    super: 'super_beam',
    range: 'close',
  },
  technical: {
    archetype: 'technical', label: 'テクニカル',
    desc: '中下段の崩しと特殊軌道。器用なミックスアップ。',
    stats: { maxHp: 270, weight: 0.95, walkMul: 1.05, backMul: 1.05, sideMul: 1.15 },
    specials: { S: 'knife', upS: 'beam', downS: 'command_grab' },
    super: 'super_beam',
    range: 'mid',
  },
};

export function getProfile(archetype) {
  return PROFILES[archetype] || PROFILES.balance;
}
