// =====================================================================
// NOVA CLASH — registry.json ローダ（SPEC §4.6）
// 起動時に fetch → ロースター構築（本体無改修）。堅牢化:
//  - registry 404 → 組込みデフォルト（GAL のみ）にフォールバック（ゲームは落ちない）
//  - 後方互換: enabled 既定 true / 未設定フィールドは安全側
//  - assetVersion → ?v= でキャッシュ回避（同名FBX差し替え可）
// =====================================================================

import { getProfile } from './profiles.js?v=1782623521';

const BUILTIN_FALLBACK = {
  version: 1, assetVersion: 'fallback',
  characters: [
    { id: 'GAL', name: 'GAL', nameJa: 'ガル', fbx: 'GAL_rigged_punch.fbx', archetype: 'balance', tint: '#55ddff', enabled: true },
  ],
};

// registry 1 エントリ → ゲームが使う roster エントリへ正規化
function normalize(entry, assetVersion) {
  const profile = getProfile(entry.archetype);
  const stats = { ...profile.stats, ...(entry.stats || {}) };
  return {
    id: entry.id,
    name: entry.name || entry.id,
    nameJa: entry.nameJa || entry.name || entry.id,
    fbx: entry.fbx || 'GAL_rigged_punch.fbx',
    thumb: entry.thumb || null,
    tint: entry.tint || profile.tint || '#88aaff',
    facingOffset: entry.facingOffset ?? 0,
    footOffset: typeof entry.footOffset === 'number' ? entry.footOffset : 0, // 接地の個別微調整(m, 下げる=負)

    archetype: profile.archetype,
    profile,
    desc: entry.desc || profile.desc,
    label: profile.label,
    range: profile.range,
    stats,
    moves: entry.moves || {},
    specials: { ...profile.specials, ...(entry.specials || {}) },
    super: entry.super || profile.super,
    enabled: entry.enabled !== false, // 後方互換: 既定 true
    assetVersion,
  };
}

export async function loadRegistry(url = './assets/registry.json') {
  let data;
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('registry HTTP ' + res.status);
    data = await res.json();
  } catch (e) {
    console.warn('[registry] 読込失敗→デフォルトロースターで継続:', e.message || e);
    data = BUILTIN_FALLBACK;
  }
  const assetVersion = data.assetVersion || '1';
  const list = (data.characters || [])
    .filter((c) => c && c.id)
    .map((c) => normalize(c, assetVersion))
    .filter((c) => c.enabled);
  if (!list.length) list.push(normalize(BUILTIN_FALLBACK.characters[0], assetVersion));
  return { version: data.version || 1, assetVersion, roster: list };
}

// テスト/Node 用: fetch なしで素データから roster を構築
export function buildRoster(data) {
  const assetVersion = data.assetVersion || '1';
  return (data.characters || []).filter((c) => c && c.id).map((c) => normalize(c, assetVersion)).filter((c) => c.enabled);
}
