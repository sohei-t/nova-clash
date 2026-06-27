/**
 * NOVA CLASH - P2P ネットワーク基盤（1v1・ホスト/ゲスト）
 *   ROBO BATTLE v8 の NetHub を流用し、1v1・信頼チャネルに最小改変したもの。
 *
 * 構成:
 *   - Firebase Realtime Database でシグナリング(部屋コード/Offer/Answer/ICE 交換のみ)
 *   - WebRTC DataChannel(信頼・順序保証) で「入力(intent)」を交換 → 決定論ロックステップ
 *   - ホスト=player0 / ゲスト=player1。実ゲーム同期はサーバを介さず P2P 直結。
 *   - 部屋は `rooms/nc-<code>` に作成（同一 Firebase を使う ROBO の `rooms/<code>` と衝突しない）。
 *
 * Firebase の関数は firebase-config.js が window.firebase* / window.initFirebase に出す。
 *
 * 使い方(概略):
 *   const net = new NetHub();
 *   net.on('lobby', s=>...).on('open', id=>...).on('data', (id,m)=>...).on('close', id=>...);
 *   const code = await net.createRoom('HOST名');   // ホスト → 6桁コード
 *   await net.joinRoom(code, 'ゲスト名');           // ゲスト
 *   net.send('host'|gid, {...})  // 相手へ送信（toHost / broadcast も可）
 */

const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
export const MAX_PLAYERS = 2; // NOVA CLASH は 1v1（ホスト + ゲスト1）

const digits = (n) => { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10); return s; };
const uid = () => Math.random().toString(36).slice(2, 10);

// Firebase ショートカット(firebase-config.js が window に出す)
const FB = {
  ref: (p) => window.firebaseRef(window.firebaseDB, p),
  set: (p, v) => window.firebaseSet(FB.ref(p), v),
  get: (p) => window.firebaseGet(FB.ref(p)),
  upd: (p, v) => window.firebaseUpdate(FB.ref(p), v),
  rm: (p) => window.firebaseRemove(FB.ref(p)),
  push: (p, v) => window.firebasePush(FB.ref(p), v),
  on: (p, cb) => { const r = FB.ref(p); const u = window.firebaseOnValue(r, cb); return () => window.firebaseOff(r); },
};

export class NetHub {
  constructor() {
    this.code = null;
    this.isHost = false;
    this.selfId = uid();
    this.name = 'P';
    this.peers = new Map();   // peerId -> { pc, dc, open, name }
    this.unsub = [];          // 解除関数
    this.handlers = { lobby() {}, open() {}, data() {}, close() {}, error() {} };
  }

  on(ev, fn) { if (ev in this.handlers) this.handlers[ev] = fn; return this; }

  // ---- 部屋作成(ホスト) ----
  async createRoom(name) {
    if (!(await window.initFirebase())) throw new Error('Firebase 初期化に失敗しました');
    this.name = name || 'HOST';
    this.isHost = true;
    this.code = digits(6);
    await FB.set(`rooms/nc-${this.code}`, {
      state: 'lobby', createdAt: Date.now(),
      host: { id: this.selfId, name: this.name, ready: false },
      players: {},
    });
    this._hostListen();
    return this.code;
  }

  // ---- 部屋参加(ゲスト) ----
  async joinRoom(code, name) {
    if (!(await window.initFirebase())) throw new Error('Firebase 初期化に失敗しました');
    this.name = name || 'GUEST';
    this.isHost = false;
    this.code = String(code).trim();
    const snap = await FB.get(`rooms/nc-${this.code}`);
    if (!snap.exists()) throw new Error('部屋が見つかりません');
    const room = snap.val();
    if (room.state !== 'lobby') throw new Error('対戦はすでに開始しています');
    if (1 + Object.keys(room.players || {}).length >= MAX_PLAYERS) throw new Error('満員です');
    await FB.upd(`rooms/nc-${this.code}/players/${this.selfId}`, { name: this.name, ready: false, joinedAt: Date.now() });
    this._guestListen();
  }

  // ================= ホスト側 =================
  _hostListen() {
    // players の増減を監視し、ゲストごとに 1 本接続を張る
    this.unsub.push(FB.on(`rooms/nc-${this.code}/players`, (snap) => {
      const players = snap.val() || {};
      for (const gid of Object.keys(players)) if (!this.peers.has(gid)) this._hostConnectTo(gid, players[gid]);
      for (const gid of [...this.peers.keys()]) if (!players[gid]) this._dropPeer(gid);
      this._emitLobby(players);
    }));
    // 部屋メタ(state など)も監視
    this.unsub.push(FB.on(`rooms/nc-${this.code}`, (s) => { const r = s.val(); if (r) this._room = r; }));
  }

  async _hostConnectTo(gid, info) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    // ロックステップは入力を1つでも落とすと永久 stall するため「信頼・順序保証」チャネル
    // （v8 のスナップショット同期は ordered:false / maxRetransmits:0 の非信頼だったが NOVA は逆）。
    const dc = pc.createDataChannel('game', { ordered: true });
    const peer = { pc, dc, open: false, name: (info && info.name) || '?' };
    this.peers.set(gid, peer);
    this._wireChannel(gid, dc);
    this._wirePC(gid, pc);

    const base = `rooms/nc-${this.code}/sig/${gid}`;
    pc.onicecandidate = (e) => { if (e.candidate) FB.push(`${base}/hostCand`, e.candidate.toJSON()); };
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await FB.upd(base, { offer: { type: offer.type, sdp: offer.sdp } });
    } catch (e) { this.handlers.error('offer', e); }

    // ゲストの answer / ICE を受信
    this.unsub.push(FB.on(`${base}/answer`, async (s) => {
      const a = s.val();
      if (a && !pc.currentRemoteDescription) {
        try { await pc.setRemoteDescription(new RTCSessionDescription(a)); } catch (e) { /* 二重適用は無視 */ }
      }
    }));
    const seen = new Set();
    this.unsub.push(FB.on(`${base}/guestCand`, (s) => {
      const c = s.val() || {};
      for (const k of Object.keys(c)) if (!seen.has(k)) { seen.add(k); pc.addIceCandidate(new RTCIceCandidate(c[k])).catch(() => {}); }
    }));
  }

  // ================= ゲスト側 =================
  _guestListen() {
    const base = `rooms/nc-${this.code}/sig/${this.selfId}`;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer = { pc, dc: null, open: false, name: 'host' };
    this.peers.set('host', peer);
    this._wirePC('host', pc);
    pc.ondatachannel = (e) => { peer.dc = e.channel; this._wireChannel('host', e.channel); };
    pc.onicecandidate = (e) => { if (e.candidate) FB.push(`${base}/guestCand`, e.candidate.toJSON()); };

    let answered = false;
    this.unsub.push(FB.on(`${base}/offer`, async (s) => {
      const o = s.val();
      if (o && !answered) {
        answered = true;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(o));
          const ans = await pc.createAnswer();
          await pc.setLocalDescription(ans);
          await FB.upd(base, { answer: { type: ans.type, sdp: ans.sdp } });
        } catch (e) { this.handlers.error('answer', e); }
      }
    }));
    const seen = new Set();
    this.unsub.push(FB.on(`${base}/hostCand`, (s) => {
      const c = s.val() || {};
      for (const k of Object.keys(c)) if (!seen.has(k)) { seen.add(k); pc.addIceCandidate(new RTCIceCandidate(c[k])).catch(() => {}); }
    }));
    // 部屋(ロビー/開始)監視
    this.unsub.push(FB.on(`rooms/nc-${this.code}`, (s) => {
      const room = s.val();
      if (!room) { this.handlers.close('room'); return; }
      this._room = room;
      this._emitLobby(room.players || {}, room);
    }));
  }

  // ---- 共通配線 ----
  _wirePC(peerId, pc) {
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'failed' || st === 'disconnected' || st === 'closed') this._dropPeer(peerId);
    };
  }
  _wireChannel(peerId, dc) {
    const peer = this.peers.get(peerId); if (peer) peer.dc = dc;
    dc.onopen = () => { if (peer) peer.open = true; this.handlers.open(peerId); };
    dc.onclose = () => { if (peer) peer.open = false; };
    dc.onmessage = (e) => { try { this.handlers.data(peerId, JSON.parse(e.data)); } catch (err) { /* 破損は無視 */ } };
  }
  _dropPeer(peerId) {
    const p = this.peers.get(peerId); if (!p) return;
    try { p.dc && p.dc.close(); } catch (e) {}
    try { p.pc && p.pc.close(); } catch (e) {}
    this.peers.delete(peerId);
    this.handlers.close(peerId);
  }

  // ---- 送受信 ----
  send(peerId, msg) { const p = this.peers.get(peerId); if (p && p.dc && p.dc.readyState === 'open') p.dc.send(JSON.stringify(msg)); }
  broadcast(msg) { for (const id of this.peers.keys()) this.send(id, msg); }   // ホスト→全ゲスト
  toHost(msg) { this.send('host', msg); }                                       // ゲスト→ホスト
  openCount() { let n = 0; for (const p of this.peers.values()) if (p.open) n++; return n; }

  // ---- ロビー/開始 ----
  _emitLobby(players, room) { this.handlers.lobby({ code: this.code, isHost: this.isHost, selfId: this.selfId, players, room: room || this._room }); }
  async setReady(v) {
    const val = v !== false;
    const path = this.isHost ? `rooms/nc-${this.code}/host` : `rooms/nc-${this.code}/players/${this.selfId}`;
    await FB.upd(path, { ready: val });
  }
  async startMatch() { if (this.isHost) await FB.upd(`rooms/nc-${this.code}`, { state: 'playing' }); }

  async leave() {
    for (const u of this.unsub) { try { u(); } catch (e) {} }
    this.unsub = [];
    for (const id of [...this.peers.keys()]) this._dropPeer(id);
    if (this.code) {
      try {
        if (this.isHost) await FB.rm(`rooms/nc-${this.code}`);
        else await FB.rm(`rooms/nc-${this.code}/players/${this.selfId}`);
      } catch (e) {}
    }
    this.code = null;
  }
}
