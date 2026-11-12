// 武器装着ヘルパー（NOVA CLASH 武器プロトタイプ）。
// 再リグ済みキャラ(Mixamo 骨格)の「手ボーン」に武器を親子付けし、スケルトン
// アニメに自然に追従させる。武器メッシュは GLB(Blender生成) を優先し、無ければ
// 手続き生成のカタナにフォールバック＝アセットが無くても必ず表示できる。
//
// 重要(スケール): Mixamo FBX はもともと cm 単位で、キャラ root が ~0.01 倍に
// 正規化される。手ボーンの world scale もその分小さい。武器(メートル実寸)を
// そのまま手ボーンに付けると極小になるので、grip の local scale で world scale を
// 打ち消し、武器を「狙った実寸(メートル)」で表示する。
//
// 使い方:
//   import { attachWeapon } from './weapon.js?v=1794449214';
//   const w = await attachWeapon(lib.root, { url: './assets/weapons/katana.glb',
//                                            side: 'right', scale: 1, pos:[0,0,0], rot:[0,0,-90] });
//   // 以後 lib.update(dt) でアニメすると武器も手に追従する。
//   w.setTransform({ pos:[...], rot:[...], scale: 1 });   // ライブ微調整
//   w.detach();

import * as THREE from 'three';
import { GLTFLoader } from '../lib/loaders/GLTFLoader.js?v=1794449214';

const _gltf = new GLTFLoader();
const loadGLB = (url) => new Promise((res, rej) => _gltf.load(url, res, undefined, rej));
const D2R = Math.PI / 180;

// 手ボーンを探す。Mixamo: mixamorigRightHand / RightHand（コロン除去版にも対応）。
export function findHandBone(root, side = 'right') {
  const re = new RegExp(side + 'hand$', 'i');
  let bone = null;
  root.traverse((o) => { if (!bone && o.isBone && re.test(o.name)) bone = o; });
  if (!bone) {  // フォールバック: ForeArm → 末端
    const re2 = new RegExp(side + 'forearm$', 'i');
    root.traverse((o) => { if (!bone && o.isBone && re2.test(o.name)) bone = o; });
  }
  return bone;
}

// 手続き生成のカタナ（Blender 版 gen_weapon_sword.py と同寸・同配色）。刃は +Y へ伸びる。
export function buildKatana(opts = {}) {
  const g = new THREE.Group();
  g.name = 'katana_proc';
  const tint = new THREE.Color(opts.edge || 0x66d8ff);
  const steel = new THREE.MeshStandardMaterial({ color: 0xa6adba, metalness: 0.95, roughness: 0.16 });
  const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a1e, metalness: 0.9, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x101014, metalness: 0.2, roughness: 0.75 });
  const glow = new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.0 });
  const add = (geo, mat, y, rot) => {
    const m = new THREE.Mesh(geo, mat); m.position.y = y; if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.castShadow = true; g.add(m); return m;
  };
  // 柄頭 / 柄 / 柄巻き
  add(new THREE.SphereGeometry(0.02, 12, 10), dark, -0.165);
  add(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 16), dark, -0.08);
  for (const zz of [-0.13, -0.10, -0.07, -0.04]) add(new THREE.CylinderGeometry(0.0175, 0.0175, 0.012, 16), brass, zz);
  // 鍔 / ハバキ
  add(new THREE.CylinderGeometry(0.052, 0.052, 0.012, 24), brass, 0.004);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 16), steel, 0.022);
  // 刀身 + 切先
  add(new THREE.BoxGeometry(0.034, 0.82, 0.009), steel, 0.45);
  add(new THREE.ConeGeometry(0.022, 0.09, 4), steel, 0.905, [0, Math.PI / 4, 0]);
  // 発光刃文（両面）
  add(new THREE.BoxGeometry(0.0035, 0.74, 0.0102), glow, 0.44).position.x = 0.013;
  add(new THREE.BoxGeometry(0.0035, 0.74, 0.0102), glow, 0.44).position.x = -0.013;
  return g;
}

// 武器をキャラの手ボーンへ装着。戻り値で位置/回転/スケールをライブ調整・取り外しできる。
// opts: { url?, side='right', scale=1(m), pos=[x,y,z](m), rot=[x,y,z](deg), edge?, tint? }
export async function attachWeapon(root, opts = {}) {
  const side = (opts.side || 'right').toLowerCase();
  const hand = findHandBone(root, side);
  if (!hand) throw new Error('手ボーンが見つかりません: ' + side);

  // 武器メッシュ: GLB 優先、失敗時は手続きカタナ。
  let weapon = null, source = 'procedural';
  if (opts.url) {
    try { const gltf = await loadGLB(opts.url); weapon = gltf.scene; source = 'glb'; }
    catch (e) { console.warn('[weapon] GLB 読込失敗→手続き生成にフォールバック:', opts.url, e.message || e); }
  }
  if (!weapon) weapon = buildKatana(opts);
  weapon.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; if (opts.tint && o.material && o.material.color) o.material.color.lerp(new THREE.Color(opts.tint), 0.18); } });

  // grip: 手ボーンの world scale を打ち消す中間ノード（武器を実寸で出す）。
  const grip = new THREE.Group(); grip.name = 'weaponGrip';
  root.updateWorldMatrix(true, true);
  const ws = hand.getWorldScale(new THREE.Vector3());
  const baseScale = new THREE.Vector3(1 / (ws.x || 1), 1 / (ws.y || 1), 1 / (ws.z || 1));
  hand.add(grip);
  grip.add(weapon);

  const api = {
    grip, weapon, hand, source, side,
    setTransform({ pos, rot, scale } = {}) {
      const s = (scale == null ? (this._scale ?? (opts.scale ?? 1)) : scale);
      this._scale = s;
      grip.scale.set(baseScale.x * s, baseScale.y * s, baseScale.z * s);
      const p = pos || this._pos || opts.pos || [0, 0, 0]; this._pos = p;
      weapon.position.set(p[0], p[1], p[2]);                       // grip-local ≈ メートル
      const r = rot || this._rot || opts.rot || [0, 0, 0]; this._rot = r;
      weapon.rotation.set(r[0] * D2R, r[1] * D2R, r[2] * D2R);
    },
    detach() {
      if (grip.parent) grip.parent.remove(grip);
      weapon.traverse((o) => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) { if (m && m.dispose) m.dispose(); } });
    },
  };
  api.setTransform({ pos: opts.pos, rot: opts.rot, scale: opts.scale ?? 1 });
  return api;
}
