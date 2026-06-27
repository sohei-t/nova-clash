// =====================================================================
// StageView — ステージ定義からシーンを構築（SPEC §5）。
// 円形/方形・リングアウト有/無・壁・ライティング・霧・背景。
// =====================================================================

import * as THREE from 'three';

export class StageView {
  constructor(scene, stage, opts = {}) {
    this.scene = scene;
    this.stage = stage;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.objs = [];
    this._build(opts);
  }

  _add(o) { this.group.add(o); this.objs.push(o); return o; }

  _build(opts) {
    const st = this.stage; const th = st.theme;
    this.scene.background = new THREE.Color(th.bg);
    this.scene.fog = new THREE.Fog(th.bg, th.fog[0], th.fog[1]);

    // --- ライト ---
    this._add(new THREE.HemisphereLight(0x9fbfff, 0x202030, 1.0));
    const dir = new THREE.DirectionalLight(0xffffff, 1.7);
    dir.position.set(4, 10, 6); dir.castShadow = true;
    dir.shadow.mapSize.set(opts.lowSpec ? 1024 : 2048, opts.lowSpec ? 1024 : 2048);
    const sc = dir.shadow.camera; sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 0.5; sc.far = 30;
    this._add(dir);
    const rim = new THREE.DirectionalLight(th.accent, 0.5); rim.position.set(-5, 4, -4); this._add(rim);

    // --- 床 ---
    const R = st.radius;
    let floor;
    if (st.shape === 'circle') {
      floor = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.3, 56),
        new THREE.MeshStandardMaterial({ color: th.ground, roughness: 0.92, metalness: 0.1 }));
      floor.position.y = -0.15;
    } else {
      floor = new THREE.Mesh(new THREE.BoxGeometry(R * 2, 0.3, R * 2),
        new THREE.MeshStandardMaterial({ color: th.ground, roughness: 0.92, metalness: 0.1 }));
      floor.position.y = -0.15;
    }
    floor.receiveShadow = true; this._add(floor);

    // 同心円/グリッドの装飾（奥行きの手掛かり）
    const grid = new THREE.GridHelper(R * 2, st.shape === 'circle' ? 16 : 14, th.accent, 0x223044);
    grid.position.y = 0.02; grid.material.opacity = 0.25; grid.material.transparent = true; this._add(grid);

    // --- 外周（リングアウト有=光るエッジ / 壁=立体）---
    if (st.shape === 'circle') {
      const edge = new THREE.Mesh(new THREE.TorusGeometry(R, 0.09, 8, 64),
        new THREE.MeshStandardMaterial({ color: th.edge, emissive: th.edgeEmissive, emissiveIntensity: 1.6 }));
      edge.rotation.x = Math.PI / 2; edge.position.y = 0.04; this._add(edge);
    } else {
      for (let i = 0; i < 4; i++) {
        const horiz = i % 2 === 0;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(horiz ? R * 2 : 0.16, 0.16, horiz ? 0.16 : R * 2),
          new THREE.MeshStandardMaterial({ color: th.edge, emissive: th.edgeEmissive, emissiveIntensity: 1.4 }));
        bar.position.set(horiz ? 0 : (i === 1 ? R : -R), 0.08, horiz ? (i === 0 ? R : -R) : 0);
        this._add(bar);
      }
    }
    if (st.walls) {
      const wallMat = new THREE.MeshStandardMaterial({ color: th.ground, roughness: 0.7, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
      if (st.shape === 'circle') {
        const wall = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.05, R + 0.05, 2.4, 56, 1, true), wallMat);
        wall.position.y = 1.2; this._add(wall);
      }
    }

    // 背景の浮遊リング（雰囲気）
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 3 + i * 2, 0.05, 6, 48),
        new THREE.MeshBasicMaterial({ color: th.accent, transparent: true, opacity: 0.08 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.5 + i * 0.6; this._add(ring);
    }
  }

  dispose() {
    for (const o of this.objs) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => m.dispose && m.dispose()); }
    }
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
