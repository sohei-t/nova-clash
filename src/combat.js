import * as THREE from 'three';

const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();

// 点 p からカプセル線分 a-b への最近点距離
function distToSegment(p, a, b) {
  _ab.subVectors(b, a);
  _ap.subVectors(p, a);
  const t = Math.max(0, Math.min(1, _ap.dot(_ab) / (_ab.lengthSq() || 1)));
  _ab.multiplyScalar(t).add(a); // 線分上の最近点
  return p.distanceTo(_ab);
}

// 攻撃側 atk のヒットボックスと 守備側 def のハートボックスの衝突判定 → 被弾処理
// 戻り: {result:'hit'|'block'|'ko', point:Vector3} | null
export function resolvePair(atk, def, fx) {
  const hb = atk.getHitbox();
  if (!hb) return null;
  const cap = def.getHurtCapsule();
  const d = distToSegment(hb.pos, cap.a, cap.b);
  if (d > hb.radius + cap.radius) return null;

  atk.hitConfirmed = true;
  const result = def.receiveHit(hb.move, atk);
  const point = hb.pos.clone();
  if (result === 'block') fx.spawn(point, 0x66ccff, 0.8);
  else fx.spawn(point, 0xffcc33, 1.3);
  return { result, point, move: hb.move };
}

// 両者ぶんを解決し、発生したヒットストップ(フレーム)を返す
export function resolveCombat(p1, p2, fx) {
  let hitstop = 0;
  for (const [a, d] of [[p1, p2], [p2, p1]]) {
    const r = resolvePair(a, d, fx);
    if (r) hitstop = Math.max(hitstop, r.result === 'block' ? 3 : 5);
  }
  return hitstop;
}

// ---- 簡易ヒットスパーク FX ----
export class FX {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }
  spawn(pos, color, scale = 1) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.12 * scale, 10, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    m.position.copy(pos);
    this.scene.add(m);
    this.items.push({ m, life: 0, max: 0.22, scale });
    // リング
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.18 * scale, 16),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.position.copy(pos);
    ring.lookAt(pos.x, pos.y, pos.z + 1);
    this.scene.add(ring);
    this.items.push({ m: ring, life: 0, max: 0.25, scale, ring: true });
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life += dt;
      const k = it.life / it.max;
      if (k >= 1) {
        this.scene.remove(it.m);
        it.m.geometry.dispose(); it.m.material.dispose();
        this.items.splice(i, 1);
        continue;
      }
      it.m.material.opacity = (1 - k) * 0.95;
      const s = it.ring ? 1 + k * 2.5 : 1 + k * 1.5;
      it.m.scale.setScalar(s);
    }
  }
}

// ---- ダミー/簡易AI ----
// distance に応じて接近・攻撃・たまにガードする最小AI
export class DummyAI {
  constructor() { this.cool = 0; this.mode = 'idle'; }
  decide(self, opp) {
    const out = { fwd: 0, strafe: 0, punch: false, kick: false, block: false };
    if (self.state !== 'idle' && self.state !== 'walk') return out;
    const dx = opp.root.position.x - self.root.position.x;
    const dz = opp.root.position.z - self.root.position.z;
    const dist = Math.hypot(dx, dz);
    this.cool--;
    // 相手が攻撃中なら一定確率でガード
    if (opp.state === 'attack' && Math.random() < 0.08) { out.block = true; return out; }
    if (dist > 1.4) { out.fwd = 1; }          // 接近
    else if (this.cool <= 0) {                // 間合いに入ったら攻撃
      if (Math.random() < 0.5) out.punch = true; else out.kick = true;
      this.cool = 35 + Math.floor(Math.random() * 30);
    }
    return out;
  }
}
