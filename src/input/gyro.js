// =====================================================================
// ジャイロ操作（任意・SPEC §8.1）。前後傾け＝接近/後退の1軸のみをスティックの代わりに。
// サイドステップ/ジャンプ/しゃがみはボタンのまま。許可拒否でもスティックで100%プレイ可。
// 実証値: sens 3.5 / deadZone 3 / maxTilt 25。iOS は click/touchend 内で requestPermission。
// =====================================================================

export class GyroControls {
  constructor(controller, opts = {}) {
    this.c = controller;
    this.sens = opts.sens ?? 3.5;
    this.dead = opts.deadZone ?? 3;
    this.maxTilt = opts.maxTilt ?? 25;
    this.landscape = opts.landscape ?? true;
    this.enabled = false;
    this._h = this._onOrient.bind(this);
  }

  supported() {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  }

  // 必ず click/touchend ハンドラ内から呼ぶこと（iOS 許可の落とし穴）。
  async enable() {
    const D = window.DeviceOrientationEvent;
    if (!D) return false;
    if (typeof D.requestPermission === 'function') {
      try { const r = await D.requestPermission(); if (r !== 'granted') return false; }
      catch (e) { return false; }
    }
    window.addEventListener('deviceorientation', this._h);
    this.enabled = true; this.c.gyroEnabled = true;
    return true;
  }

  disable() {
    window.removeEventListener('deviceorientation', this._h);
    this.enabled = false; this.c.gyroEnabled = false; this.c.move.x = 0;
  }
  toggle() { return this.enabled ? (this.disable(), false) : this.enable(); }

  _onOrient(e) {
    // 横/縦で beta/gamma を入替（SPEC）。横持ちでは前後傾き ≈ gamma。
    let tilt = this.landscape ? (e.gamma || 0) : (e.beta || 0);
    if (Math.abs(tilt) < this.dead) tilt = 0;
    const v = Math.max(-1, Math.min(1, (tilt / this.maxTilt) * (this.sens / 3.5)));
    // 接近/後退はスクリーン絶対スキームでは move.x（左右＝ワールドX）。傾けでこの1軸を供給。
    this.c.move.x = v;
  }
}
