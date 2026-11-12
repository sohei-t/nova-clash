// =====================================================================
// NOVA CLASH — メタ進行システム（コイン経済・デイリーミッション・実績・
// ガチャ・称号・コレクション）。THREE/DOM 非依存の純ロジック＝Node でテスト可能。
// 永続化は storage（localStorage 互換 {getItem,setItem}）を注入。
// ガチャ/日替わりの乱数・日付も注入可能（テスト用）。
// 設計方針: すべて「見た目・称号」のコスメティック＝ゲームバランス/オンライン決定論に影響しない。
// =====================================================================

const SAVE_KEY = 'nova_meta_v1';

// レアリティ定義（排出率・表示色）。天井: SR_PITY 連続でSR以上が出なければ次は SR 以上確定。
export const RARITY = {
  N:  { p: 0.60, color: '#9ab0c8', label: 'NORMAL' },
  R:  { p: 0.30, color: '#4da6ff', label: 'RARE' },
  SR: { p: 0.09, color: '#c77dff', label: 'SUPER RARE' },
  UR: { p: 0.01, color: '#ffd24a', label: 'ULTRA RARE' },
};
export const GACHA_COST = 100;
export const GACHA_10_COST = 900;       // 10連は1割引＋R以上1枠確定
export const SR_PITY = 50;              // 天井
export const DUPE_REFUND = { N: 20, R: 60, SR: 200, UR: 500 };

// ガチャ排出プール（コスメティックのみ）
export const GACHA_POOL = [
  // --- 称号 ---
  { id: 't_rookie',     kind: 'title', rar: 'N',  name: '駆け出しファイター' },
  { id: 't_brawler',    kind: 'title', rar: 'N',  name: '喧嘩屋' },
  { id: 't_steel',      kind: 'title', rar: 'N',  name: '鋼のガード' },
  { id: 't_sonic',      kind: 'title', rar: 'N',  name: '音速の拳' },
  { id: 't_wild',       kind: 'title', rar: 'N',  name: '荒くれ者' },
  { id: 't_meteor',     kind: 'title', rar: 'R',  name: '流星の蹴撃' },
  { id: 't_hurricane',  kind: 'title', rar: 'R',  name: '疾風怒濤' },
  { id: 't_invincible', kind: 'title', rar: 'SR', name: '無敵街道' },
  { id: 't_nova',       kind: 'title', rar: 'UR', name: '超新星 -NOVA-' },
  // --- ヒットスパークテーマ（fx の色替え）---
  { id: 's_gold',    kind: 'spark', rar: 'R',  name: 'ゴールドラッシュ',       theme: { p1: 0xffd24a, p2: 0xffa020, crit: 0xffffff } },
  { id: 's_neon',    kind: 'spark', rar: 'R',  name: 'ネオンパルス',           theme: { p1: 0x39ff14, p2: 0xff2079, crit: 0x00ffff } },
  { id: 's_ice',     kind: 'spark', rar: 'R',  name: 'アイスエッジ',           theme: { p1: 0x9fdcff, p2: 0x4488ff, crit: 0xffffff } },
  { id: 's_flame',   kind: 'spark', rar: 'R',  name: 'フレイムバースト',       theme: { p1: 0xff9a3a, p2: 0xff3a2a, crit: 0xffe08a } },
  { id: 's_violet',  kind: 'spark', rar: 'SR', name: 'バイオレットストーム',   theme: { p1: 0xc77dff, p2: 0x7a2bff, crit: 0xffd2ff } },
  { id: 's_shadow',  kind: 'spark', rar: 'SR', name: 'シャドウテンペスト',     theme: { p1: 0x8899bb, p2: 0x334466, crit: 0xffffff } },
  { id: 's_prism',   kind: 'spark', rar: 'UR', name: 'プリズムレイン',         theme: { p1: 0xff5a8a, p2: 0x4ad2ff, crit: 0xfff45a } },
  // --- 紙吹雪テーマ（勝利/エンディング演出の色）---
  { id: 'c_sakura',  kind: 'confetti', rar: 'N', name: '桜吹雪',       colors: ['#ffc0d5', '#ff8fb3', '#fff0f5', '#ffb7c5'] },
  { id: 'c_ocean',   kind: 'confetti', rar: 'N', name: 'オーシャン',   colors: ['#7fdfff', '#4aa8ff', '#b0f0ff', '#2a78d0'] },
  { id: 'c_gold',    kind: 'confetti', rar: 'R', name: 'ゴールドシャワー', colors: ['#ffd24a', '#ffe08a', '#d4a017', '#fff8dc'] },
  { id: 'c_aurora',  kind: 'confetti', rar: 'R', name: 'オーロラ',     colors: ['#7fffd4', '#87cefa', '#dda0dd', '#98fb98'] },
  // --- ステージスキン（テーマ色の差し替え）---
  { id: 'st_nova_sunset',    kind: 'stageskin', rar: 'R',  stage: 'nova_ring',  name: 'ノヴァ・サンセット',
    theme: { ground: 0x4a2a35, edge: 0xff8a5a, edgeEmissive: 0xaa3311, bg: 0x1a0b14, fog: [20, 46], accent: 0xff8a5a } },
  { id: 'st_colosseum_moon', kind: 'stageskin', rar: 'R',  stage: 'colosseum',  name: '月夜のコロシアム',
    theme: { ground: 0x1e2a44, edge: 0x9fdcff, edgeEmissive: 0x224488, bg: 0x060a18, fog: [22, 50], accent: 0x9fdcff } },
  { id: 'st_deck_cyber',     kind: 'stageskin', rar: 'SR', stage: 'night_deck', name: 'サイバーデッキ',
    theme: { ground: 0x0e0a22, edge: 0xff2079, edgeEmissive: 0x880033, bg: 0x02010a, fog: [18, 40], accent: 0xff2079 } },
  { id: 'st_dojo_sakura',    kind: 'stageskin', rar: 'SR', stage: 'dojo',       name: '桜花の道場',
    theme: { ground: 0x4a3040, edge: 0xffb7c5, edgeEmissive: 0x884455, bg: 0x140a10, fog: [24, 52], accent: 0xffb7c5 } },
  { id: 'st_nova_gold',      kind: 'stageskin', rar: 'UR', stage: 'nova_ring',  name: '黄金のアリーナ',
    theme: { ground: 0x3a2f10, edge: 0xffd24a, edgeEmissive: 0xaa7711, bg: 0x140f02, fog: [20, 46], accent: 0xffd24a } },
  // --- 魔法（消耗品・オフライン専用の切り札。1回引くと+3チャージ、かぶりもチャージ加算）---
  { id: 'sp_thunder', kind: 'spell', rar: 'R',  name: '⚡ サンダーボルト', spell: 'thunder', grant: 3,
    desc: '予兆の後に落雷。範囲内なら大ダメージ＆ダウン' },
  { id: 'sp_flame',   kind: 'spell', rar: 'R',  name: '🔥 フレイムウェーブ', spell: 'flame', grant: 3,
    desc: '地を這う炎の波（下段＝しゃがみガード必須）' },
  { id: 'sp_freeze',  kind: 'spell', rar: 'SR', name: '❄ フリーズランス', spell: 'freeze', grant: 3,
    desc: '氷の槍。当たった相手を長時間凍結させる' },
  // --- コイン束（かぶり無し扱いのハズレ緩和枠）---
  { id: 'coin_s', kind: 'coins', rar: 'N', name: 'コイン +30', amount: 30 },
  { id: 'coin_m', kind: 'coins', rar: 'N', name: 'コイン +60', amount: 60 },
];

// デイリーミッション候補（毎日3件を日付シードで選出）
export const MISSION_POOL = [
  { id: 'win1',    label: '1勝する',                    stat: 'win',       target: 1, reward: 60 },
  { id: 'win3',    label: '3勝する',                    stat: 'win',       target: 3, reward: 120 },
  { id: 'ko2',     label: 'KO を2回とる',               stat: 'ko',        target: 2, reward: 80 },
  { id: 'crit3',   label: 'クリティカルを3回当てる',    stat: 'crit',      target: 3, reward: 80 },
  { id: 'counter3', label: 'カウンターを3回とる',       stat: 'counter',   target: 3, reward: 90 },
  { id: 'throw2',  label: '投げを2回決める',            stat: 'throw',     target: 2, reward: 80 },
  { id: 'combo4',  label: '4コンボ以上を決める（オートコンボ完走）', stat: 'combo', target: 4, reward: 100, mode: 'max' },
  { id: 'play3',   label: '3試合プレイする',            stat: 'play',      target: 3, reward: 70 },
  { id: 'survive3', label: 'サバイバルで3人抜きする',   stat: 'survival',  target: 3, reward: 120, mode: 'max' },
];

// 実績（生涯累計・達成でコイン）
export const ACHIEVEMENTS = [
  { id: 'a_first',     label: '初勝利',                    stat: 'win',        target: 1,   reward: 100 },
  { id: 'a_win10',     label: '通算10勝',                  stat: 'win',        target: 10,  reward: 200 },
  { id: 'a_win50',     label: '通算50勝',                  stat: 'win',        target: 50,  reward: 500 },
  { id: 'a_arcade',    label: 'アーケードクリア',          stat: 'arcadeClear', target: 1,  reward: 300 },
  { id: 'a_survival5', label: 'サバイバル5人抜き',         stat: 'survivalBest', target: 5, reward: 300, mode: 'max' },
  { id: 'a_survival10', label: 'サバイバル10人抜き',       stat: 'survivalBest', target: 10, reward: 600, mode: 'max' },
  { id: 'a_crit50',    label: 'クリティカル通算50回',      stat: 'crit',       target: 50,  reward: 250 },
  { id: 'a_throw20',   label: '投げ通算20回',              stat: 'throw',      target: 20,  reward: 200 },
  { id: 'a_gacha10',   label: 'ガチャを10回引く',          stat: 'gacha',      target: 10,  reward: 150 },
  { id: 'a_combo5',    label: '5コンボ達成（打ち上げ追撃）', stat: 'comboBest', target: 5,   reward: 300, mode: 'max' },
  { id: 'a_spell10',   label: '魔法を10回使う',            stat: 'spell',      target: 10,  reward: 250 },
];

export function getPoolItem(id) { return GACHA_POOL.find((x) => x.id === id) || null; }

// 日付文字列（ローカル）YYYY-MM-DD
function dateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// 文字列→32bit ハッシュ（日替わりミッションのシード）
function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function seededRng(seed) { let s = seed || 1; return () => { s = (Math.imul(s, 48271) % 2147483647 + 2147483647) % 2147483647 || 1; return s / 2147483647; }; }

export class MetaGame {
  // storage: {getItem(k),setItem(k,v)}（localStorage 互換）。now: () => Date。rng: () => [0,1)
  constructor(storage = null, now = null, rng = null) {
    this.storage = storage || (typeof localStorage !== 'undefined' ? localStorage : _memStorage());
    this.now = now || (() => new Date());
    this.rng = rng || Math.random;
    this.load();
    this.loginBonus = this._rolloverDaily();   // {coins, streak} | null（UI がトースト表示に使う）
  }

  // ---------- 永続化 ----------
  _default() {
    return {
      coins: 150,                       // 初期コイン（すぐ1回ガチャを試せる＝オンボーディング）
      owned: ['c_sakura'],              // 初期所持（紙吹雪1種＝コレクション画面が空にならない）
      equipped: { title: null, spark: null, confetti: null, spell: null, stage: {} },
      spellCharges: {},                 // 魔法の残チャージ {thunder: n, flame: n, freeze: n}
      stats: {},                        // 生涯累計 {win,play,ko,crit,counter,throw,comboBest,survivalBest,arcadeClear,gacha,...}
      daily: { date: '', missions: [], progress: {}, claimed: [] },
      claimedAchievements: [],
      pity: 0,                          // SR天井カウンタ
      login: { last: '', streak: 0 },
    };
  }
  load() {
    let d = null;
    try { d = JSON.parse(this.storage.getItem(SAVE_KEY) || 'null'); } catch (e) { d = null; }
    this.d = Object.assign(this._default(), d || {});
    // ネストは浅マージで欠けを補完
    this.d.equipped = Object.assign({ title: null, spark: null, confetti: null, spell: null, stage: {} }, this.d.equipped);
    this.d.daily = Object.assign({ date: '', missions: [], progress: {}, claimed: [] }, this.d.daily);
    this.d.login = Object.assign({ last: '', streak: 0 }, this.d.login);
    this.d.spellCharges = this.d.spellCharges || {};
  }
  save() { try { this.storage.setItem(SAVE_KEY, JSON.stringify(this.d)); } catch (e) { /* private mode 等 */ } }
  // 高頻度呼び出し（試合中の track）用: 250ms デバウンスで書き込み＝フレームヒッチ回避
  saveSoon() {
    if (this._saveT) return;
    const t = typeof setTimeout !== 'undefined' ? setTimeout : null;
    if (!t) { this.save(); return; }
    this._saveT = t(() => { this._saveT = null; this.save(); }, 250);
  }

  // ---------- 日次ロールオーバー（ログインボーナス＋ミッション再抽選）----------
  _rolloverDaily() {
    const today = dateStr(this.now());
    let bonus = null;
    if (this.d.login.last !== today) {
      // ログインボーナス（連続日数でアップ・最大+50）
      const yesterday = dateStr(new Date(this.now().getTime() - 86400000));
      this.d.login.streak = this.d.login.last === yesterday ? this.d.login.streak + 1 : 1;
      const coins = 50 + 10 * Math.min(this.d.login.streak - 1, 5);
      this.d.coins += coins;
      this.d.login.last = today;
      bonus = { coins, streak: this.d.login.streak };
    }
    if (this.d.daily.date !== today) {
      // 日付シードで3件選出（全員同じ日は同じミッション＝分かち合える）
      const r = seededRng(strHash(today));
      const pool = MISSION_POOL.slice();
      const picks = [];
      while (picks.length < 3 && pool.length) picks.push(pool.splice((r() * pool.length) | 0, 1)[0].id);
      this.d.daily = { date: today, missions: picks, progress: {}, claimed: [] };
    }
    this.save();
    return bonus;
  }

  // ---------- コイン ----------
  get coins() { return this.d.coins; }
  addCoins(n) { this.d.coins += Math.max(0, Math.round(n)); this.save(); }
  spend(n) { if (this.d.coins < n) return false; this.d.coins -= n; this.save(); return true; }

  // ---------- 統計トラッキング（ミッション/実績の進捗も同時更新）----------
  // stat: 'win'|'play'|'ko'|'crit'|'counter'|'throw'|'combo'|'survival'|'arcadeClear'|'gacha'
  track(stat, n = 1) {
    const s = this.d.stats;
    // 生涯: combo/survival は最大値、他は累計
    if (stat === 'combo') s.comboBest = Math.max(s.comboBest || 0, n);
    else if (stat === 'survival') s.survivalBest = Math.max(s.survivalBest || 0, n);
    else s[stat] = (s[stat] || 0) + n;
    // デイリー進捗
    const p = this.d.daily.progress;
    for (const mid of this.d.daily.missions) {
      const m = MISSION_POOL.find((x) => x.id === mid);
      if (!m || m.stat !== stat) continue;
      if (m.mode === 'max') p[mid] = Math.max(p[mid] || 0, n);
      else p[mid] = (p[mid] || 0) + n;
    }
    this.saveSoon();   // 試合中の毎ヒット同期書き込みを避ける（250msデバウンス）
  }

  // ---------- ミッション / 実績 ----------
  missions() {
    // 保存済み id がプール改定で消えても落ちないよう filter（将来のミッション追加/削除に耐性）
    return this.d.daily.missions
      .map((mid) => MISSION_POOL.find((x) => x.id === mid))
      .filter(Boolean)
      .map((m) => {
        const prog = Math.min(this.d.daily.progress[m.id] || 0, m.target);
        return { ...m, progress: prog, done: prog >= m.target, claimed: this.d.daily.claimed.includes(m.id) };
      });
  }
  claimMission(mid) {
    const m = this.missions().find((x) => x.id === mid);
    if (!m || !m.done || m.claimed) return 0;
    this.d.daily.claimed.push(mid);
    this.d.coins += m.reward;
    this.save();
    return m.reward;
  }
  achievements() {
    const s = this.d.stats;
    return ACHIEVEMENTS.map((a) => {
      const cur = a.stat === 'survivalBest' ? (s.survivalBest || 0) : a.stat === 'comboBest' ? (s.comboBest || 0) : (s[a.stat] || 0);
      const prog = Math.min(cur, a.target);
      return { ...a, progress: prog, done: prog >= a.target, claimed: this.d.claimedAchievements.includes(a.id) };
    });
  }
  claimAchievement(aid) {
    const a = this.achievements().find((x) => x.id === aid);
    if (!a || !a.done || a.claimed) return 0;
    this.d.claimedAchievements.push(aid);
    this.d.coins += a.reward;
    this.save();
    return a.reward;
  }
  // 受取可能な件数（メニューバッジ表示用）
  claimableCount() {
    return this.missions().filter((m) => m.done && !m.claimed).length +
      this.achievements().filter((a) => a.done && !a.claimed).length;
  }

  // ---------- 試合報酬 ----------
  // 試合終了時に一度呼ぶ。{coins, breakdown:[{label,amount}]} を返す（リザルト演出用）。
  onMatchEnd({ mode, won, perfect = false, roundsLost = 0 }) {
    const br = [];
    if (won) br.push({ label: '勝利', amount: 40 });
    else br.push({ label: 'ファイト', amount: 10 });
    if (won && mode === 'arcade') br.push({ label: 'アーケード進行', amount: 15 });
    if (perfect) br.push({ label: 'パーフェクト', amount: 30 });
    if (won && roundsLost === 0 && !perfect) br.push({ label: 'ストレート勝ち', amount: 10 });
    const total = br.reduce((a, b) => a + b.amount, 0);
    this.d.coins += total;
    this.track('play');
    if (won) this.track('win');
    this.save();   // 試合終了は即時保存（track の遅延に依存しない）
    return { coins: total, breakdown: br };
  }
  // サバイバル終了時（kills 人抜き）
  onSurvivalEnd(kills) {
    const total = kills * 25;
    this.d.coins += total;
    this.track('survival', kills);
    this.save();
    return { coins: total };
  }

  // ---------- ガチャ ----------
  _rollRarity(r) {
    const x = r();
    if (x < RARITY.UR.p) return 'UR';
    if (x < RARITY.UR.p + RARITY.SR.p) return 'SR';
    if (x < RARITY.UR.p + RARITY.SR.p + RARITY.R.p) return 'R';
    return 'N';
  }
  _pickItem(rar, r) {
    const cands = GACHA_POOL.filter((x) => x.rar === rar);
    return cands[(r() * cands.length) | 0];
  }
  // count=1|10。コインを消費し結果配列を返す。失敗（コイン不足）は null。
  // 返り値: [{item, rar, isNew, refund, coins}]（coins=コイン束の額 / refund=かぶり返金）
  gachaPull(count = 1) {
    const cost = count === 10 ? GACHA_10_COST : GACHA_COST * count;
    if (!this.spend(cost)) return null;
    const r = this.rng;
    const results = [];
    for (let i = 0; i < count; i++) {
      let rar = this._rollRarity(r);
      if (this.d.pity >= SR_PITY - 1 && rar !== 'SR' && rar !== 'UR') rar = 'SR';        // 天井
      if (count === 10 && i === count - 1 && rar === 'N' && !results.some((x) => x.rar !== 'N')) rar = 'R'; // 10連R以上確定
      this.d.pity = (rar === 'SR' || rar === 'UR') ? 0 : this.d.pity + 1;
      const item = this._pickItem(rar, r);
      let isNew = false, refund = 0, coins = 0, charges = 0;
      if (item.kind === 'coins') {
        coins = item.amount; this.d.coins += coins;
      } else if (item.kind === 'spell') {
        // 魔法＝消耗品: かぶりでも常にチャージ加算（ハズレ感なし）
        charges = item.grant || 3;
        this.d.spellCharges[item.spell] = (this.d.spellCharges[item.spell] || 0) + charges;
        if (!this.d.owned.includes(item.id)) { isNew = true; this.d.owned.push(item.id); this._autoEquip(item); }
      } else if (this.d.owned.includes(item.id)) {
        refund = DUPE_REFUND[rar]; this.d.coins += refund;
      } else {
        isNew = true; this.d.owned.push(item.id);
        this._autoEquip(item);                       // 新規は自動装備（すぐ体感できる）
      }
      results.push({ item, rar, isNew, refund, coins, charges });
    }
    this.track('gacha', count);
    this.save();
    return results;
  }
  _autoEquip(item) {
    if (item.kind === 'title') this.d.equipped.title = item.id;
    else if (item.kind === 'spark') this.d.equipped.spark = item.id;
    else if (item.kind === 'confetti') this.d.equipped.confetti = item.id;
    else if (item.kind === 'spell') this.d.equipped.spell = item.id;
    else if (item.kind === 'stageskin') this.d.equipped.stage[item.stage] = item.id;
  }

  // ---------- コレクション / 装備 ----------
  owned() { return this.d.owned.map(getPoolItem).filter(Boolean); }
  isOwned(id) { return this.d.owned.includes(id); }
  // kind: 'title'|'spark'|'confetti' → id|null。stageskin は equipStage で。
  equip(kind, id) {
    if (id !== null && !this.isOwned(id)) return false;
    this.d.equipped[kind] = id; this.save(); return true;
  }
  equipStage(stageId, id) {
    if (id !== null && !this.isOwned(id)) return false;
    this.d.equipped.stage[stageId] = id; this.save(); return true;
  }
  get equipped() { return this.d.equipped; }

  // ---------- ゲームへの適用（描画層が読む）----------
  titleText() { const t = getPoolItem(this.d.equipped.title); return t ? t.name : null; }
  sparkTheme() { const s = getPoolItem(this.d.equipped.spark); return s ? s.theme : null; }
  confettiColors() { const c = getPoolItem(this.d.equipped.confetti); return c ? c.colors : null; }
  // 装備中の魔法と残チャージ（試合開始時に Match opts.spells へ注入する。無し/0なら null）
  spellLoadout() {
    const it = getPoolItem(this.d.equipped.spell);
    if (!it || it.kind !== 'spell') return null;
    const ch = this.d.spellCharges[it.spell] || 0;
    return ch > 0 ? { type: it.spell, charges: ch } : null;
  }
  spellCharges(type) { return this.d.spellCharges[type] || 0; }
  // 試合後に残数を書き戻す
  setSpellCharges(type, n) {
    this.d.spellCharges[type] = Math.max(0, n | 0);
    this.save();
  }
  // ステージにスキンを適用した複製を返す（未所持/未装備なら原本のまま）
  applyStageSkin(stage) {
    const sid = this.d.equipped.stage[stage.id];
    const skin = sid ? getPoolItem(sid) : null;
    if (!skin || skin.stage !== stage.id) return stage;
    return { ...stage, theme: { ...skin.theme }, skinName: skin.name };
  }
  stats() { return { ...this.d.stats }; }
}

function _memStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; }
