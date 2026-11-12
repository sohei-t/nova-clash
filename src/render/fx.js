// =====================================================================
// FX — ヒットスパーク/飛び道具ビジュアル/相殺/被弾フィードバック。
// sim の events と projectiles を読み、3D エフェクトとカメラ演出に変換。
// =====================================================================

import * as THREE from 'three';

export class FX {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera; // GameCamera（shake/kick 用）
    this.items = [];
    this.projMeshes = new Map(); // projectile obj -> mesh
  }

  // sim.events を消費して演出を生成。onShake/onHaptic: 上位(HUD/audio)へ通知。
  consume(events, hooks = {}) {
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const big = (e.dmg || 0) >= 16 || e.counter;
          // 攻撃側で色分け（被弾側 who の反対が攻撃側）。左/自分=青、右/相手=赤
          // ＝どちらの攻撃が当たったか一目で分かる。識別マーカー(青/オレンジ赤)と対応。
          // this.theme（ガチャのヒットエフェクトテーマ）があれば色を差し替え。
          const th = this.theme || null;
          const base = ((e.who != null) ? (1 - e.who) : 0) === 0
            ? ((th && th.p1) || 0x40c4ff) : ((th && th.p2) || 0xff5a44);
          if (e.crit) {
            // クリティカル: 金色の大スパーク＋衝撃リング＋強シェイク＝「入った！」を全身で伝える
            const cc = (th && th.crit) || 0xffe08a;
            this._spark(e.x, e.y, e.z, cc, 2.5);
            this._ring(e.x, e.y, e.z, cc, 1.6);
            this.camera && this.camera.shake(0.3, 0.22);
            this.camera && this.camera.kick(0.55);
          } else {
            this._spark(e.x, e.y, e.z, base, big ? 1.7 : 1.15);
            this.camera && this.camera.shake(big ? 0.22 : 0.1, 0.16);
            this.camera && this.camera.kick(big ? 0.4 : 0.15);
          }
          hooks.onHit && hooks.onHit(e);
          break;
        }
        case 'block':
          this._spark(e.x, e.y, e.z, 0x66ccff, 0.7);
          this.camera && this.camera.shake(0.05, 0.1);
          hooks.onBlock && hooks.onBlock(e);
          break;
        case 'throw': {
          const th2 = this.theme || null;
          const atk = (e.who != null) ? (1 - e.who) : 0;   // 投げも攻撃側の色（青/赤）
          this._spark(e.x, e.y, e.z, atk === 0 ? ((th2 && th2.p1) || 0x40c4ff) : ((th2 && th2.p2) || 0xff5a44), 1.4);
          this.camera && this.camera.shake(0.2, 0.2);
          hooks.onHit && hooks.onHit(e);
          break;
        }
        case 'throw_tech':
          this._spark(e.x, e.y, e.z, 0xffffff, 1.0);
          hooks.onBlock && hooks.onBlock(e);
          break;
        case 'clash':
          this._spark(e.x, e.y, e.z, 0xffffff, 1.8);
          this._ring(e.x, e.y, e.z, 0xffffff, 1.6);
          this.camera && this.camera.shake(0.12, 0.14);
          hooks.onClash && hooks.onClash(e);
          break;
        case 'projectile_spawn':
          hooks.onFire && hooks.onFire(e);
          break;
        case 'spell_cast':
          this._ring(e.x, e.y, e.z, e.kind === 'flame' ? 0xff6a2a : e.kind === 'freeze' ? 0x9fdcff : 0xffe27a, 1.6);
          hooks.onSpell && hooks.onSpell(e);
          break;
        case 'spell_mark':
          // 落雷の予兆: 地面の警告リング（発動までの時間ぶん残る＝見てかわせる）
          this._mark(e.x, e.z, 0xffe27a, (e.frames || 30) / 60);
          break;
        case 'spell_strike':
          if (e.kind === 'thunder') {
            // 落雷: 天からの光柱＋炸裂＋強シェイク
            this._bolt(e.x, e.z, 0xfff2a0);
            this._burst(e.x, 1.2, e.z, 0xffe27a);
            this.camera && this.camera.shake(0.4, 0.3);
            this.camera && this.camera.kick(0.5);
          }
          hooks.onSpellStrike && hooks.onSpellStrike(e);
          break;
        case 'ko':
          this._burst(e.x, e.y, e.z, 0xffffff);
          this.camera && this.camera.shake(0.5, 0.4);
          this.camera && this.camera.koZoom(true);
          hooks.onKO && hooks.onKO(e);
          break;
        case 'round_end':
          this.camera && this.camera.koZoom(false);
          break;
      }
    }
  }

  // 飛び道具メッシュを sim.projectiles に同期
  syncProjectiles(projectiles) {
    const alive = new Set(projectiles);
    for (const p of projectiles) {
      let m = this.projMeshes.get(p);
      if (!m) { m = this._makeProjectile(p); this.projMeshes.set(p, m); this.scene.add(m); }
      m.position.set(p.x, p.y, p.z);
      const ang = Math.atan2(p.vx, p.vz);
      m.rotation.y = ang;
      if (m.userData.spin) m.rotation.z += 0.4;
      if (m.userData.light) m.userData.light.position.set(p.x, p.y, p.z);
    }
    // 退場した弾のメッシュ削除＋着弾バースト
    for (const [p, m] of this.projMeshes) {
      if (!alive.has(p)) {
        this._burst(m.position.x, m.position.y, m.position.z, p.color || 0xffaa33);
        this._disposeMesh(m);
        this.projMeshes.delete(p);
      }
    }
  }

  _makeProjectile(p) {
    const g = new THREE.Group();
    const color = p.color || 0xff7722;
    if (p.kind === 'beam') {
      const len = Math.max(0.8, p.radius * 4);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(p.radius * 0.5, p.radius * 0.7, 1.4, 10),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      core.rotation.x = Math.PI / 2; g.add(core); g.userData.spin = false;
    } else if (p.kind === 'knife') {
      const core = new THREE.Mesh(new THREE.ConeGeometry(p.radius * 0.6, p.radius * 2.4, 8),
        new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.8, roughness: 0.2, emissive: 0x222222 }));
      core.rotation.x = Math.PI / 2; g.add(core); g.userData.spin = false;
    } else {
      const core = new THREE.Mesh(new THREE.SphereGeometry(p.radius, 14, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.add(core);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(p.radius * 1.5, 12, 10),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.add(halo); g.userData.spin = true;
    }
    const light = new THREE.PointLight(color, 1.2, 3); g.userData.light = light; this.scene.add(light);
    return g;
  }

  _spark(x, y, z, color, scale = 1) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.12 * scale, 10, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(x, y, z); this.scene.add(m);
    this.items.push({ m, life: 0, max: 0.22, ring: false });
    this._ring(x, y, z, color, scale);
  }

  _ring(x, y, z, color, scale = 1) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.04, 0.16 * scale, 18),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.set(x, y, z); ring.lookAt(x, y, z + 1); this.scene.add(ring);
    this.items.push({ m: ring, life: 0, max: 0.28, ring: true });
  }

  _burst(x, y, z, color) {
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.position.set(x, y, z); this.scene.add(m);
      const a = (i / 6) * Math.PI * 2;
      this.items.push({ m, life: 0, max: 0.35, vx: Math.cos(a) * 2.4, vy: 1.5 + Math.random() * 1.5, vz: Math.sin(a) * 2.4 });
    }
  }

  // 地面の警告リング（落雷の予兆）。dur 秒間、点滅しながら残る。半径は実当たり判定(0.8×SCALE≈1.04m)に一致。
  _mark(x, z, color, dur = 0.5) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.06, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.03, z);
    this.scene.add(ring);
    this.items.push({ m: ring, life: 0, max: dur, flat: true });
  }

  // 落雷の光柱（縦の発光シリンダーが一瞬走る）
  _bolt(x, z, color) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.34, 9, 10, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(x, 4.5, z);
    this.scene.add(m);
    this.items.push({ m, life: 0, max: 0.3, bolt: true });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life += dt; const k = it.life / it.max;
      if (k >= 1) { this._disposeMesh(it.m); this.items.splice(i, 1); continue; }
      if (it.flat) {
        // 警告リング: 点滅＋わずかに収縮（終盤ほど速く点滅＝緊迫感）
        it.m.material.opacity = 0.35 + 0.5 * Math.abs(Math.sin(it.life * (6 + k * 14)));
        it.m.scale.setScalar(1 - k * 0.15);
        continue;
      }
      if (it.bolt) {
        // 光柱: 一瞬太く→細く消える
        it.m.material.opacity = (1 - k) * 0.95;
        it.m.scale.set(1 + (1 - k) * 0.6, 1, 1 + (1 - k) * 0.6);
        continue;
      }
      it.m.material.opacity = (1 - k) * 0.95;
      if (it.vx !== undefined) {
        it.m.position.x += it.vx * dt; it.m.position.y += (it.vy -= 6 * dt) * dt; it.m.position.z += it.vz * dt;
      } else {
        const s = it.ring ? 1 + k * 2.6 : 1 + k * 1.6; it.m.scale.setScalar(s);
      }
    }
  }

  _disposeMesh(m) {
    if (m.parent) m.parent.remove(m);
    m.traverse && m.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => mm.dispose && mm.dispose()); });
    if (m.geometry) m.geometry.dispose();
    if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((mm) => mm.dispose && mm.dispose());
    if (m.userData && m.userData.light && m.userData.light.parent) m.userData.light.parent.remove(m.userData.light);
  }

  clear() {
    for (const it of this.items) this._disposeMesh(it.m);
    this.items.length = 0;
    for (const [, m] of this.projMeshes) this._disposeMesh(m);
    this.projMeshes.clear();
  }
}
