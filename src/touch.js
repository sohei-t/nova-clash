// スマホ用 半透明オンスクリーン操作ボタン。
// 左=移動十字(WASD)、右=アクション(P/K/G/ジャンプ)。
// ボタンは Input.setVirtual() で物理キーと同じ経路に合流するので、
// 既存の readP1() ロジックをそのまま使える。
// PC でも ?touch=1 を付ければ表示してテスト可能。

const STYLE = `
#touch { position: fixed; inset: 0; pointer-events: none; z-index: 50;
  -webkit-user-select: none; user-select: none; }
#touch .tbtn { pointer-events: auto; touch-action: none; position: absolute;
  display: flex; align-items: center; justify-content: center;
  color: #eaf2ff; font-weight: 700; font-family: -apple-system, sans-serif;
  background: rgba(120,150,200,.18); border: 2px solid rgba(170,200,255,.45);
  border-radius: 50%; backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
  transition: background .05s, transform .05s; }
#touch .tbtn.active { background: rgba(120,180,255,.55); transform: scale(.92); }
/* 左: 移動十字 */
#touch .pad { position: absolute; left: 22px; bottom: 26px; width: 186px; height: 186px; }
#touch .pad .tbtn { width: 58px; height: 58px; font-size: 22px; }
#touch .pad .up    { left: 64px; top: 0; }
#touch .pad .down  { left: 64px; bottom: 0; }
#touch .pad .left  { left: 0; top: 64px; }
#touch .pad .right { right: 0; top: 64px; }
/* 右: アクション */
#touch .act { position: absolute; right: 22px; bottom: 26px; width: 196px; height: 196px; }
#touch .act .tbtn { width: 70px; height: 70px; font-size: 18px; }
#touch .act .b-p { right: 96px; bottom: 8px; }
#touch .act .b-k { right: 8px;  bottom: 60px; }
#touch .act .b-g { right: 96px; bottom: 96px; }
#touch .act .b-j { right: 8px;  bottom: 150px; width: 56px; height: 56px; font-size: 15px; }
@media (max-width: 520px) {
  #touch .pad { width: 156px; height: 156px; }
  #touch .pad .tbtn { width: 50px; height: 50px; }
  #touch .pad .up,.pad .down { left: 53px; } #touch .pad .left,.pad .right { top: 53px; }
}
`;

function makeBtn(input, label, code, cls) {
  const b = document.createElement('div');
  b.className = 'tbtn ' + cls;
  b.textContent = label;
  const set = (v) => (e) => {
    e.preventDefault();
    input.setVirtual(code, v);
    b.classList.toggle('active', v);
  };
  b.addEventListener('pointerdown', set(true));
  b.addEventListener('pointerup', set(false));
  b.addEventListener('pointercancel', set(false));
  b.addEventListener('pointerleave', set(false));
  return b;
}

export function setupTouch(input) {
  const force = new URLSearchParams(location.search).has('touch');
  const isTouch = force || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (!isTouch) return false;

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const wrap = document.createElement('div');
  wrap.id = 'touch';

  const pad = document.createElement('div');
  pad.className = 'pad';
  pad.appendChild(makeBtn(input, '▲', 'KeyW', 'up'));
  pad.appendChild(makeBtn(input, '▼', 'KeyS', 'down'));
  pad.appendChild(makeBtn(input, '◀', 'KeyA', 'left'));
  pad.appendChild(makeBtn(input, '▶', 'KeyD', 'right'));

  const act = document.createElement('div');
  act.className = 'act';
  act.appendChild(makeBtn(input, 'P', 'KeyJ', 'b-p'));   // パンチ
  act.appendChild(makeBtn(input, 'K', 'KeyK', 'b-k'));   // キック
  act.appendChild(makeBtn(input, 'G', 'KeyL', 'b-g'));   // ガード
  act.appendChild(makeBtn(input, 'JUMP', 'Space', 'b-j')); // ジャンプ

  wrap.appendChild(pad);
  wrap.appendChild(act);
  document.body.appendChild(wrap);
  return true;
}
