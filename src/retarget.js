// Mixamo モーション → Meshy 骨格 ライブ・リターゲット (ワールド空間方式)
// 毎フレーム source(mixamorig) の各骨のワールド回転を、バインド時の差(bindAlign)で
// 補正して target(Meshy) のワールド回転に変換し、target親のワールドで割って local 化する。
//
//   bindAlign = tBindWorld · inv(sBindWorld)         (バインド時に1回算出)
//   target_local = inv(target親World) · (bindAlign · sWorld)   (毎フレーム, 親→子順)
//
// ローカル回転コピー方式と違い、親骨の向きが両リグで異なっても破綻しない(脚も正しく出る)。

import * as THREE from 'three';

const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

// target(Meshy 骨名) → source(mixamorig 骨名)
export const MIXAMO_MAP = {
  Hips: 'mixamorig:Hips',
  Spine: 'mixamorig:Spine',
  Spine01: 'mixamorig:Spine1',
  Spine02: 'mixamorig:Spine2',
  Head: 'mixamorig:Head',
  LeftShoulder: 'mixamorig:LeftShoulder',
  LeftArm: 'mixamorig:LeftArm',
  LeftForeArm: 'mixamorig:LeftForeArm',
  LeftHand: 'mixamorig:LeftHand',
  RightShoulder: 'mixamorig:RightShoulder',
  RightArm: 'mixamorig:RightArm',
  RightForeArm: 'mixamorig:RightForeArm',
  RightHand: 'mixamorig:RightHand',
  LeftUpLeg: 'mixamorig:LeftUpLeg',
  LeftLeg: 'mixamorig:LeftLeg',
  LeftFoot: 'mixamorig:LeftFoot',
  LeftToeBase: 'mixamorig:LeftToeBase',
  RightUpLeg: 'mixamorig:RightUpLeg',
  RightLeg: 'mixamorig:RightLeg',
  RightFoot: 'mixamorig:RightFoot',
  RightToeBase: 'mixamorig:RightToeBase',
};

export class Retargeter {
  constructor() {
    this.pairs = [];
    this.mixer = null;
    this.ready = false;
    this.info = {};
  }

  // targetBones: {Meshy骨名: Bone} (バインドT字の状態で渡すこと)
  // sourceRoot : FBXLoader が返した Object3D (.animations を持つ、再生前=バインド)
  setup(targetBones, sourceRoot, opts = {}) {
    const map = opts.map || MIXAMO_MAP;
    const clipIndex = opts.clipIndex || 0;

    // source の「実際にアニメが動かす骨」を取る。
    // このFBXは SkinnedMesh が2つ&同名ボーンが二重に存在し、traverse も skeleton.bones も
    // 静止側のハズレを掴む。mixer と同じ解決法 = PropertyBinding.findNode で引けば、
    // クリップが実際にバインドする可動ノードthat が確実に得られる。
    // FBXLoader はノード名を sanitizeNodeName(記号除去) 済みなので map値も同様に整形して照合。
    const sanitize = (s) => THREE.PropertyBinding.sanitizeNodeName(s);

    // ペア構築。ワールド空間リターゲット用に「バインド時のワールド回転の差」を控える:
    //   bindAlign = tBindWorld · inv(sBindWorld)
    // 実行時: 目標ワールド回転 = bindAlign · sWorld を、target親のワールドで割って local 化。
    //   → 親骨の向きが両リグで違っても正しく再構成できる(ローカルコピーの脚破綻を解消)。
    // バインドは mixer 再生「前」に読む。getWorldQuaternion は親まで更新して正しい値を返す。
    this.pairs = [];
    let matched = 0; const missTarget = [], missSource = [];
    const qs = new THREE.Quaternion(), qt = new THREE.Quaternion();
    for (const tName in map) {
      const sName = map[tName];
      const tBone = targetBones[tName];
      const sBone = THREE.PropertyBinding.findNode(sourceRoot, sanitize(sName));
      if (!tBone) { missTarget.push(tName); continue; }
      if (!sBone) { missSource.push(sName); continue; }
      const sBindWorld = sBone.getWorldQuaternion(new THREE.Quaternion());
      const tBindWorld = tBone.getWorldQuaternion(new THREE.Quaternion());
      const bindAlign = tBindWorld.clone().multiply(sBindWorld.clone().invert());
      // 親→子 の順で処理するため depth(祖先数) を記録
      let depth = 0; for (let n = tBone.parent; n; n = n.parent) depth++;
      this.pairs.push({ tBone, sBone, bindAlign, depth });
      matched++;
    }
    // 親が先に確定するよう depth 昇順に並べる
    this.pairs.sort((a, b) => a.depth - b.depth);

    // source にミキサーを張ってクリップ再生
    const clip = (sourceRoot.animations || [])[clipIndex];
    if (!clip) throw new Error('source に AnimationClip がありません');
    this.mixer = new THREE.AnimationMixer(sourceRoot);
    this.action = this.mixer.clipAction(clip);
    this.action.play();
    this.mixer.update(0);

    let sb = 0; sourceRoot.traverse((o) => { if (o.isBone) sb++; });
    this.info = {
      matched, missTarget, missSource,
      clip: clip.name, duration: +clip.duration.toFixed(2),
      sourceBones: sb,
    };
    this.ready = true;
    return this.info;
  }

  // 毎フレーム: source を進め、target 骨へワールド空間で写す(親→子順)
  update(dt) {
    if (!this.ready) return;
    this.mixer.update(dt);
    const sWorld = _q1, parentWorld = _q2, desired = _q3;
    for (const p of this.pairs) {
      // source の現在ワールド回転 (getWorldQuaternion が親まで再計算)
      p.sBone.getWorldQuaternion(sWorld);
      // 目標ワールド回転 = bindAlign · sWorld
      desired.copy(p.bindAlign).multiply(sWorld);
      // target ローカル = inv(親ワールド) · desired (親は既に確定済み=depth順)
      if (p.tBone.parent) p.tBone.parent.getWorldQuaternion(parentWorld);
      else parentWorld.identity();
      p.tBone.quaternion.copy(parentWorld.invert()).multiply(desired);
    }
  }

  setTimeScale(s) { if (this.mixer) this.mixer.timeScale = s; }
}
