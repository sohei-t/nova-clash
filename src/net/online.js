// =====================================================================
// NOVA CLASH — オンライン対戦オーケストレータ（1v1・決定論ロックステップ）
// ---------------------------------------------------------------------
// NetHub(WebRTC+Firebaseシグナリング) + LockstepSession(入力遅延) + wire(符号化) を束ね、
//   1) 部屋作成/参加 → 接続
//   2) 各自キャラ選択 → host が seed/両者キャラ/ステージを確定し config を配布
//   3) 双方が同一 Match を構築 → pump() で「ローカル入力送信 + 揃ったらstep」を毎フレーム実行
//   4) 数十フレームごとに checksum を交換し desync を検知
// を提供する。描画/UI は main.js 側。host=player0 / guest=player1。
// =====================================================================
import { DT } from '../core/constants.js';
import { NetHub } from './hub.js';
import { LockstepSession, matchChecksum } from './lockstep.js';
import { encodeIntent, decodeIntent } from './wire.js';

const SEND_AHEAD_CAP = 12;     // ローカル入力を相手より何フレーム先まで先行生成してよいか
const SUM_EVERY = 30;          // desync 用 checksum 送信間隔（フレーム）
const MAX_GEN = 8;             // 1描画フレームで生成するローカル入力の上限
const MAX_STEP = 10;           // 1描画フレームで進める sim の上限（再開時の追いつき）

export class NetGame {
  constructor({ inputDelay = 3 } = {}) {
    this.hub = new NetHub();
    this.delay = inputDelay;
    this.session = null;
    this.match = null;
    this.peerId = null;            // host視点=ゲストid / guest視点='host'
    this.isHost = false;
    this.localPlayer = 0;
    this.connected = false;

    // キャラ選択の確定待ち
    this.localPick = null;
    this.remotePick = null;
    this.stageId = null;

    // 受信したが session 未生成のうちに来た intent を退避
    this._pendingRemote = [];
    // ローカル checksum 履歴（frame→hash）。desync 照合用
    this._sums = new Map();
    this._acc = 0;
    this.stalledFrames = 0;
    this.desynced = false;

    // UI 連携コールバック（main.js が差し替える）
    this.onLobby = () => {};
    this.onConnected = () => {};
    this.onReady = () => {};        // (config) 双方で試合開始準備が整った
    this.onClosed = () => {};
    this.onError = () => {};
    this.onDesync = () => {};

    this._wire();
  }

  _wire() {
    this.hub
      .on('lobby', (s) => this.onLobby(s))
      .on('open', (id) => {
        this.peerId = id;
        this.isHost = this.hub.isHost;
        this.localPlayer = this.isHost ? 0 : 1;
        this.connected = true;
        this.onConnected({ peerId: id, isHost: this.isHost, localPlayer: this.localPlayer });
      })
      .on('data', (id, m) => this._onData(id, m))
      .on('close', (id) => { this.connected = false; this.onClosed(id); })
      .on('error', (where, e) => this.onError(where, e));
  }

  // ---- ロビー操作（薄いラッパ） ----
  async host(name) { return this.hub.createRoom(name); }
  async join(code, name) { return this.hub.joinRoom(code, name); }
  setReady(v) { return this.hub.setReady(v); }
  async leave() { try { await this.hub.leave(); } catch (e) {} }

  // ---- キャラ確定（各自が自分の選択を送る。host はステージも指定） ----
  submitPick(charId, stageId) {
    this.localPick = charId;
    if (this.isHost && stageId) this.stageId = stageId;
    this.hub.send(this.peerId, { t: 'pick', c: charId });
    this._tryFinalize();
  }

  _onData(id, m) {
    if (!m || !m.t) return;
    switch (m.t) {
      case 'i': {                                   // 相手の入力
        const intent = decodeIntent(m.i);
        if (this.session) this.session.receiveRemote(m.f, intent);
        else this._pendingRemote.push([m.f, intent]);
        break;
      }
      case 'pick':                                  // 相手のキャラ選択
        this.remotePick = m.c;
        this._tryFinalize();
        break;
      case 'cfg':                                   // host からの試合設定（guest が受信）
        this._begin(m.c);
        break;
      case 'sum':                                   // 相手の checksum（desync照合）
        this._checkSum(m.f, m.h);
        break;
    }
  }

  // host: 両者のキャラが揃ったら config を確定・配布して開始
  _tryFinalize() {
    if (!this.isHost) return;
    if (!this.localPick || !this.remotePick) return;
    const seed = (Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    const config = { seed, aId: this.localPick, bId: this.remotePick, stageId: this.stageId };
    this.hub.send(this.peerId, { t: 'cfg', c: config });
    this._begin(config);
  }

  // 双方: session を作って試合開始準備完了を通知（match は main.js が config から構築）
  _begin(config) {
    if (this.session) return;                       // 二重開始ガード
    this.session = new LockstepSession({ localPlayer: this.localPlayer, inputDelay: this.delay });
    for (const [f, intent] of this._pendingRemote) this.session.receiveRemote(f, intent);
    this._pendingRemote = [];
    this._acc = 0; this.stalledFrames = 0; this.desynced = false; this._sums.clear();
    this.onReady(config);
  }

  // main.js が構築した Match を渡す（pump の対象）
  attachMatch(match) { this.match = match; }

  // ---- 毎描画フレーム: ローカル入力を 60Hz で生成・送信し、揃った分だけ sim を進める ----
  // localAgent: { beginFrame(), tick() }（HumanAgent 互換）。
  // afterStep(match, frame): 1フレーム step するたびに（checksum後に）呼ぶフック。
  //   ラウンド自動進行など「両者が同一フレームで行うべき out-of-band 操作」をここで決定論的に行う。
  pump(localAgent, dt, afterStep) {
    const s = this.session, match = this.match;
    if (!s || !match) return { steps: 0, stalled: false, lead: 0, events: [] };

    this._acc = Math.min(this._acc + dt, 0.25);
    localAgent.beginFrame();

    // 1) ローカル入力生成（60Hz ペース・相手より先行しすぎない）
    let gen = 0;
    while (this._acc >= DT && gen < MAX_GEN) {
      if (s.sendFrame - s.simFrame >= this.delay + SEND_AHEAD_CAP) break;  // バッファ満杯→待つ（acc は減らさない）
      this._acc -= DT;
      const intent = localAgent.tick();
      const pkt = s.sendLocal(intent);
      this.hub.send(this.peerId, { t: 'i', f: pkt.frame, i: encodeIntent(intent) });
      gen++;
    }

    // 2) 自他の入力が揃ったフレームを進める（再開時は複数まとめて追いつく）
    let steps = 0;
    const events = [];
    while (s.canStep() && steps < MAX_STEP) {
      const [i0, i1] = s.consume();
      match.step(i0, i1);
      for (const e of match.events) events.push(e);   // step ごとに events はクリアされるので都度回収
      steps++;
      const f = s.simFrame;
      const h = matchChecksum(match);
      this._sums.set(f, h);
      if (f % SUM_EVERY === 0) this.hub.send(this.peerId, { t: 'sum', f, h });
      if (afterStep) afterStep(match, f);             // 決定論的 out-of-band（ラウンド自動進行など）
    }
    // 履歴を間引き（直近のみ保持）
    if (this._sums.size > 240) { const cut = s.simFrame - 200; for (const k of this._sums.keys()) if (k < cut) this._sums.delete(k); }

    const stalled = !s.canStep() && s.localInputs.has(s.simFrame);
    this.stalledFrames = stalled ? this.stalledFrames + 1 : 0;
    return { steps, stalled, lead: s.remoteLead(), frame: s.simFrame, events };
  }

  _checkSum(frame, remoteHash) {
    const local = this._sums.get(frame);
    if (local === undefined) return;                // まだその frame を踏んでいない/間引き済み
    if (local !== remoteHash && !this.desynced) {
      this.desynced = true;
      this.onDesync({ frame, local, remote: remoteHash });
    }
  }
}
