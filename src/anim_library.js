// アニメーション・ライブラリ: 再リグ済みキャラ(with skin) ＋ 共有クリップ(mixamorig) を
// 読み込み、技ID(名前)でクロスフェード再生する。リターゲット不要(同骨格に直接バインド)。
// NOVA CLASH 拡張: registry.json 駆動の loadCharacterDef / 共有クリップキャッシュ /
//                  tint / 404 フォールバック / assetVersion キャッシュ回避。
//
// 使い方(registry):
//   const lib = new AnimLibrary();
//   await lib.loadManifest('./assets/anim/manifest.json');
//   await lib.loadCharacterDef(rosterEntry, { assetVersion });  // -> scene.add(lib.root)
//   await lib.loadClips();
//   lib.onFinished((name)=>{ ... });  lib.play('idle');  // 毎フレーム lib.update(dt)

import * as THREE from 'three';
import { FBXLoader } from '../lib/loaders/FBXLoader.js';

const _loader = new FBXLoader();
const loadFBX = (url) => new Promise((res, rej) => _loader.load(url, res, undefined, rej));

// 同骨格(mixamorig)なのでクリップは全キャラで共有可能 → ファイル単位でパースをキャッシュ。
const _clipCache = new Map(); // file -> AnimationClip|null

// Hips の position の X/Z を 0 にして水平移動を除去(その場再生)。Y(上下動)は残す。
function stripRootMotion(clip) {
  for (const t of clip.tracks) {
    if (/hips\.position$/i.test(t.name)) {
      const v = t.values;
      for (let i = 0; i < v.length; i += 3) { v[i] = 0; v[i + 2] = 0; }
    }
  }
}

async function getCachedClip(url, file) {
  if (_clipCache.has(file)) return _clipCache.get(file);
  let clip = null;
  try {
    const fbx = await loadFBX(url);
    clip = (fbx.animations || [])[0] || null;
    if (clip) { clip = clip.clone(); clip.name = file; stripRootMotion(clip); }
  } catch (e) {
    console.warn('[anim] クリップ読込失敗:', file, e.message || e);
    clip = null;
  }
  _clipCache.set(file, clip);
  return clip;
}

export class AnimLibrary {
  constructor(opts = {}) {
    this.dir = opts.dir || './assets/anim/';
    this.targetHeight = opts.targetHeight || 1.8;
    this.assetVersion = opts.assetVersion || null;
    this.manifest = null;
    this.root = null;
    this.mixer = null;
    this.actions = {};
    this.meta = {};
    this.current = null;
    this._finishCb = null;
    this.defaultFade = opts.defaultFade ?? 0.1;
  }

  _url(file) { return this.dir + file + (this.assetVersion ? ('?v=' + this.assetVersion) : ''); }

  async loadManifest(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('manifest 読込失敗: ' + url);
    this.manifest = await res.json();
    return this.manifest;
  }

  // 後方互換: manifest.characters のキーから読む（デモ用）
  async loadCharacter(charId) {
    const def = this.manifest.characters[charId];
    if (!def) throw new Error('character 未定義: ' + charId);
    return this.loadCharacterDef(typeof def === 'string' ? { file: def } : def);
  }

  // registry エントリ（{fbx|file, moves, tint, ...}）から読む。404 はフォールバック。
  async loadCharacterDef(def, opts = {}) {
    if (opts.assetVersion) this.assetVersion = opts.assetVersion;
    this.charDef = { file: def.fbx || def.file, moves: def.moves || {}, tint: def.tint };
    this.charId = def.id || 'char';
    let fbx = null;
    this.loadErrors = [];                    // 診断用：失敗理由を記録
    const candidates = [this.charDef.file, 'GAL_rigged_punch.fbx'];
    for (const file of candidates) {
      if (!file) continue;
      for (const url of [this._url(file), this.dir + file]) { // ?v=付き → 無し の順で再試行
        try { fbx = await loadFBX(url); this.loadedFile = file; break; }
        catch (e) {
          this.loadErrors.push(file + ' → ' + (e && (e.message || e)));
          console.warn('[anim] FBX読込失敗:', url, e);
        }
      }
      if (fbx) break;
    }
    this.primitive = !fbx;                    // true=モデル失敗→簡易表示
    if (!fbx) { fbx = this._primitiveFighter(); } // 最終フォールバック(欠損でも落ちない)
    // スケール正規化
    const box = new THREE.Box3().setFromObject(fbx);
    const s = this.targetHeight / (box.getSize(new THREE.Vector3()).y || 1);
    fbx.scale.multiplyScalar(s);
    fbx.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.frustumCulled = false; o.castShadow = true;
        if (this.charDef.tint) this._applyTint(o, this.charDef.tint);
      }
    });
    this.root = fbx;
    this.mixer = new THREE.AnimationMixer(fbx);
    this.mixer.addEventListener('finished', (e) => { if (this._finishCb) this._finishCb(this._nameOf(e.action)); });
    return fbx;
  }

  _applyTint(mesh, hex) {
    const col = new THREE.Color(hex);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      // 元の質感を残しつつ色味を寄せる（lerp）。テクスチャが無い場合は直接着色。
      if (m.color) m.color.lerp(col, m.map ? 0.35 : 0.8);
      if ('emissive' in m && m.emissive) m.emissive.lerp(col, 0.15);
    }
  }

  _primitiveFighter() {
    // FBX 完全欠損時の代替（カプセル人型）。ゲームは継続できる。
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8899bb, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.0, 6, 12), mat);
    body.position.y = 0.9; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), mat);
    head.position.y = 1.7; head.castShadow = true; g.add(head);
    g.animations = [];
    return g;
  }

  // manifest.clips を読み込む（キャラ別 moves で見た目差し替え）。共有キャッシュ使用。
  async loadClips() {
    if (!this.mixer) throw new Error('先に loadCharacterDef() を');
    const clips = this.manifest.clips || {};
    const overrides = (this.charDef && this.charDef.moves) || {};
    const loaded = [];
    await Promise.all(Object.keys(clips).map(async (name) => {
      const c = clips[name];
      const file = overrides[name] || c.file;
      const clip = await getCachedClip(this._url(file), file);
      if (!clip) return; // 欠損は段階追加可
      const loop = c.loop !== false;
      const action = this.mixer.clipAction(clip);
      action.loop = loop ? THREE.LoopRepeat : THREE.LoopOnce;
      action.clampWhenFinished = !loop;
      this.actions[name] = action;
      // contact = クリップ内で打撃が当たる割合(0..1)。time-warp が判定の瞬間に合わせる。manifest 由来。
      this.meta[name] = { loop, file, contact: (typeof c.contact === 'number' ? c.contact : null) };
      loaded.push(name);
    }));
    return loaded;
  }

  _nameOf(action) { for (const n in this.actions) if (this.actions[n] === action) return n; return null; }
  has(name) { return !!this.actions[name]; }
  isLoop(name) { return !!(this.meta[name] && this.meta[name].loop); }
  list() { return Object.keys(this.actions); }

  // 名前で再生。opts: { fade, timeScale, duration, restart }
  play(name, opts = {}) {
    const next = this.actions[name];
    if (!next) { return false; }
    const fade = opts.fade ?? this.defaultFade;
    const prev = this.current;
    if (prev === next && this.isLoop(name) && !opts.restart) return true;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (opts.duration) next.setDuration(opts.duration);
    else next.setEffectiveTimeScale(opts.timeScale ?? 1);
    next.fadeIn(fade);
    next.play();
    if (prev && prev !== next) prev.fadeOut(fade);
    this.current = next;
    this.currentName = name;
    return true;
  }

  // 任意の stocked FBX（manifest/スロット未登録でも可）をこのキャラに即バインドして再生。
  // NOVA Studio の動作ライブラリ プレビュー用。戻り: 成否。
  async loadAndPlay(file, opts = {}) {
    if (!this.mixer) return false;
    const clip = await getCachedClip(this._url(file), file);
    if (!clip) return false;
    this._adhoc = this._adhoc || {};
    let action = this._adhoc[file];
    if (!action) { action = this.mixer.clipAction(clip); action.loop = THREE.LoopRepeat; this._adhoc[file] = action; }
    const fade = opts.fade ?? 0.15;
    action.reset(); action.enabled = true; action.setEffectiveWeight(1); action.setEffectiveTimeScale(1);
    action.fadeIn(fade); action.play();
    if (this.current && this.current !== action) this.current.fadeOut(fade);
    this.current = action; this.currentName = '(lib)' + file;
    return true;
  }

  onFinished(cb) { this._finishCb = cb; }
  update(dt) { if (this.mixer) this.mixer.update(dt); }

  groundToFloor(_v = new THREE.Vector3()) {
    if (!this.root) return;
    this.root.position.y = 0; this.root.updateMatrixWorld(true);
    let minY = Infinity;
    this.root.traverse((o) => { if (o.isBone) { o.getWorldPosition(_v); if (_v.y < minY) minY = _v.y; } });
    if (minY < Infinity) this.root.position.y = -minY;
  }

  dispose() {
    // GPU リソース（ジオメトリ/テクスチャ/マテリアル）を解放＝試合をまたいだメモリリーク防止
    if (this.root) {
      this.root.traverse((o) => {
        if (o.geometry && o.geometry.dispose) o.geometry.dispose();
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of mats) {
          if (!m) continue;
          for (const k in m) { const v = m[k]; if (v && v.isTexture && v.dispose) v.dispose(); }
          if (m.dispose) m.dispose();
        }
      });
      if (this.mixer) { this.mixer.stopAllAction(); try { this.mixer.uncacheRoot(this.root); } catch (e) {} }
      if (this.root.parent) this.root.parent.remove(this.root);
    }
    this.root = null; this.mixer = null; this.actions = {}; this.current = null;
  }
}
