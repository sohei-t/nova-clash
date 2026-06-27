// =====================================================================
// GameCamera — 距離追従ズーム＋シネマティック・アングル（SPEC §6）。
// 基本は手前(+Z)からの安定サイドビュー（対戦軸で回り込まない＝酔わない）。
// そこへ「ゆっくり角度が動く」シネマティックドリフトと、KO/必殺の迫力アングルを重ねる。
// ドリフトは小さく保ち、画面準拠の操作（左右=画面左右）が破綻しないようにする。
// =====================================================================

import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class GameCamera {
  constructor(aspect, opts = {}) {
    this.cam = new THREE.PerspectiveCamera(46, aspect, 0.1, 200);
    this.pos = new THREE.Vector3(0, 3, 9);
    this.tgt = new THREE.Vector3(0, 1.1, 0);
    this.cam.position.copy(this.pos);
    this.intensity = opts.intensity ?? 1;   // 演出強度 0.6軽 / 1標準 / 1.5派手
    this.time = 0;
    this.azimuth = 0;
    this.shakeT = 0; this.shakeAmp = 0;
    this.zoomKick = 0;
    this.koPush = 0; this.koPushTarget = 0;
    this.dram = 0; this.dramAz = 0; this.dramHeight = 0;  // 迫力アングル（KO/必殺）
    this.victoryFocus = null; this.vicT = 0;              // 勝利カメラ（勝者を全身＋180度回り込み）
    this._want = new THREE.Vector3();
    this._mid = new THREE.Vector3();
  }

  startVictory(winner) { this.victoryFocus = winner; this.vicT = 0; }
  endVictory() { this.victoryFocus = null; }

  setAspect(a) { this.cam.aspect = a; this.cam.updateProjectionMatrix(); }
  shake(amp = 0.2, dur = 0.18) { this.shakeAmp = Math.max(this.shakeAmp, amp * this.intensity); this.shakeT = Math.max(this.shakeT, dur); }
  kick(z = 0.4) { this.zoomKick = Math.min(1.2, this.zoomKick + z * this.intensity); this.azimuth += (z > 0.3 ? 0.04 : 0.02) * this.intensity; }
  // 迫力アングル（KO/必殺）: 強さ・横角・寄りを与える。減衰する。
  cinematic(strength = 1, az = 0.5, heightDrop = 0.8) {
    this.dram = Math.max(this.dram, strength);
    this.dramAz = az; this.dramHeight = heightDrop;
  }
  koZoom(on) { this.koPushTarget = on ? 1 : 0; if (on) this.cinematic(1, 0.55, 1.0); }

  update(dt, a, b) {
    this.time += dt;
    if (this.victoryFocus) { this._victoryUpdate(dt); return; }
    const midX = (a.x + b.x) / 2, midZ = (a.z + b.z) / 2;
    const sep = Math.hypot(b.x - a.x, b.z - a.z);

    // ゆっくり角度ドリフト（自動でアングルが動いて迫力を出す。小さめ＝操作が破綻しない）
    const amp = 0.11 * this.intensity;
    const drift = Math.sin(this.time * 0.31) * amp + Math.sin(this.time * 0.12 + 1.2) * amp * 0.5;
    this.dram = Math.max(0, this.dram - dt * 0.5);
    const az = drift + this.dramAz * this.dram + this.azimuth;

    // 手前に寄せて大きく見せる（base/係数を小さく＝近い）
    let dist = sep * 0.5 + 3.2 - this.zoomKick * 0.8 - this.koPush * 1.9;
    dist = clamp(dist, 3.2, 11.0);
    const height = 1.5 + sep * 0.03 - this.koPush * 0.3 - this.dramHeight * this.dram;

    // 手前(+Z)を基準に az だけ回した安定オフセット
    this._want.set(midX + Math.sin(az) * dist, height, midZ + Math.cos(az) * dist);
    // 足元が画面下端付近に来るよう注視点Yを動的算出（距離・画角に追従＝足切れせず最大限キャラを下げる）
    const halfFov = (this.cam.fov * Math.PI / 180) / 2;
    const bFeet = Math.atan(height / dist);
    const lookY = clamp(height - dist * Math.tan(bFeet - 0.95 * halfFov), 1.4, 2.9);
    this._mid.set(midX, lookY, midZ);

    const k = Math.min(1, dt * (this.koPush > 0.5 ? 2.2 : 4.5));
    this.pos.lerp(this._want, k);
    this.tgt.lerp(this._mid, Math.min(1, dt * 6));

    // 減衰
    this.koPush += (this.koPushTarget - this.koPush) * Math.min(1, dt * 3);
    this.zoomKick *= Math.max(0, 1 - dt * 6);
    this.azimuth *= Math.max(0, 1 - dt * 1.5);     // kick の角度インパルスを戻す
    if (this.shakeT > 0) this.shakeT -= dt; else this.shakeAmp *= Math.max(0, 1 - dt * 8);

    this.cam.position.copy(this.pos);
    if (this.shakeAmp > 0.001 && this.shakeT > 0) {
      this.cam.position.x += Math.sin(this.shakeT * 130) * this.shakeAmp;
      this.cam.position.y += Math.cos(this.shakeT * 170) * this.shakeAmp * 0.7;
    }
    const wantFov = clamp(50 - sep * 0.6 + this.zoomKick * 4 + this.dram * 3, 40, 56);
    this.cam.fov += (wantFov - this.cam.fov) * Math.min(1, dt * 3);
    this.cam.updateProjectionMatrix();
    this.cam.lookAt(this.tgt);
  }

  // 勝利カメラ: 勝者の身体の周りを連続360度＋上下に自由に回り込んで全身を撮影（顔は切らない）
  _victoryUpdate(dt) {
    const w = this.victoryFocus;
    this.vicT += dt;
    const az = this.vicT * 0.85;                          // 連続360度回転
    const dist = 5.2;
    const camY = 1.7 + Math.sin(this.vicT * 0.55) * 0.6;  // 上下にも回り込む
    this._want.set(w.x + Math.sin(az) * dist, camY, w.z + Math.cos(az) * dist);
    this._mid.set(w.x, 1.55, w.z);                        // 顔〜胸を狙う（顔が切れない）
    this.pos.lerp(this._want, Math.min(1, dt * 3));
    this.tgt.lerp(this._mid, Math.min(1, dt * 3.5));
    this.cam.position.copy(this.pos);
    const wantFov = 46;
    this.cam.fov += (wantFov - this.cam.fov) * Math.min(1, dt * 2);
    this.cam.updateProjectionMatrix();
    this.cam.lookAt(this.tgt);
  }
}
