// キーボード入力 (プロトタイプ: ローカル1P操作 + デバッグ)
// 移動 A/D=左右(相手基準で前後), W/S=前進/後退, J=パンチ, K=キック, L=ガード
// H=当たり判定表示, R=リセット

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set(); // このフレームで押された瞬間
    this._prev = new Set();
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  // 毎フレーム末に呼ぶ: edge(押した瞬間)を更新
  endFrame() {
    this.pressed.clear();
    for (const c of this.down) if (!this._prev.has(c)) this.pressed.add(c);
    this._prev = new Set(this.down);
  }

  held(code) { return this.down.has(code); }
  justPressed(code) { return this.pressed.has(code); }

  // 画面ボタン等の仮想入力 (キーコードに合流させる)
  setVirtual(code, isDown) {
    if (isDown) this.down.add(code); else this.down.delete(code);
  }
}
