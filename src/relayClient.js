/**
 * RelayClient - transport layer for PvP.
 *
 * LOCAL (localhost / 127.0.0.1):
 *   Uses BroadcastChannel — two directional channels per room, entirely
 *   within the browser. No server or wrangler dev needed.
 *     sg-h2j-{code}  host → joiner
 *     sg-j2h-{code}  joiner → host
 *
 * PRODUCTION:
 *   WebSocket to the Cloudflare DO relay worker.
 *
 * Public API (same in both modes):
 *   connect(roomCode, role)  → Promise<"host"|"joiner">
 *   send(message)
 *   onMessage(callback)
 *   onDisconnect(callback)
 *   isConnected()            → boolean
 *   disconnect()
 */
class RelayClient {
  static PRODUCTION_URL = "wss://strategrid-relay.happycranjus.workers.dev/relay";

  get _isLocal() {
    const h = window.location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "";
  }

  constructor() {
    // WebSocket path
    this.ws = null;
    // BroadcastChannel path
    this._send = null;
    this._recv = null;
    this._connected = false;

    this.role = null;
    this._onMessage = null;
    this._onDisconnect = null;
  }

  /**
   * @param {string} roomCode - 4-digit room code
   * @param {string} role - "host" or "joiner" (required for local BroadcastChannel mode;
   *   ignored for WebSocket mode where the relay server assigns the role)
   */
  connect(roomCode, role) {
    return this._isLocal
      ? this._connectLocal(roomCode, role)
      : this._connectWebSocket(roomCode);
  }

  // ── BroadcastChannel (local dev) ───────────────────────────────────────────

  _connectLocal(roomCode, role) {
    console.log(`[RelayClient] BroadcastChannel mode — room ${roomCode}, role ${role}`);
    return new Promise((resolve) => {
      const h2j = `sg-h2j-${roomCode}`;
      const j2h = `sg-j2h-${roomCode}`;

      if (role === "host") {
        this._send = new BroadcastChannel(h2j);
        this._recv = new BroadcastChannel(j2h);
      } else {
        this._recv = new BroadcastChannel(h2j);
        this._send = new BroadcastChannel(j2h);
      }

      this._recv.onmessage = (e) => {
        if (this._onMessage) this._onMessage(e.data);
      };

      this.role = role;
      this._connected = true;

      if (role === "joiner") {
        // Signal host that a peer has arrived (mirrors what the relay server
        // sends in WebSocket mode).
        this._send.postMessage({ type: "peer_joined" });
      }

      resolve(role);
    });
  }

  // ── WebSocket (production) ─────────────────────────────────────────────────

  _connectWebSocket(roomCode) {
    return new Promise((resolve, reject) => {
      const url = `${RelayClient.PRODUCTION_URL}/${roomCode}`;
      console.log("[RelayClient] WebSocket connecting to", url);

      let settled = false;
      const settle = (fn, val) => {
        if (settled) return;
        settled = true;
        fn(val);
      };

      const ws = new WebSocket(url);
      this.ws = ws;

      const timeout = setTimeout(() => {
        settle(reject, new Error("Relay connection timed out"));
        ws.close();
      }, 15000);

      ws.onopen = () => {
        console.log("[RelayClient] WebSocket open, waiting for relay_ready…");
      };

      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (!settled && msg.type === "relay_ready") {
          clearTimeout(timeout);
          this.role = msg.role;
          this._connected = true;
          settle(resolve, msg.role);

          ws.onmessage = (e) => {
            if (!this._onMessage) return;
            let m;
            try { m = JSON.parse(e.data); } catch { return; }
            this._onMessage(m);
          };
        }
      };

      ws.onerror = () => {
        console.error("[RelayClient] WebSocket error");
        clearTimeout(timeout);
        settle(reject, new Error("WebSocket error — relay worker unreachable"));
      };

      ws.onclose = (evt) => {
        clearTimeout(timeout);
        settle(reject, new Error(`WebSocket closed (${evt.code})`));
        this._connected = false;
        if (this._onDisconnect) this._onDisconnect();
      };
    });
  }

  // ── Shared API ─────────────────────────────────────────────────────────────

  send(message) {
    if (this._send) {
      // BroadcastChannel: structured-clone serialisation, no stringify needed
      try { this._send.postMessage(message); } catch (e) {
        console.error("[RelayClient] BroadcastChannel send error:", e);
      }
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const seen = new WeakSet();
        const data = JSON.stringify(message, (key, value) => {
          if (typeof value === "object" && value !== null) {
            if (seen.has(value)) return undefined;
            seen.add(value);
          }
          return value;
        });
        this.ws.send(data);
      } catch (e) {
        console.error("[RelayClient] WebSocket send error:", e);
      }
    }
  }

  onMessage(callback)    { this._onMessage = callback; }
  onDisconnect(callback) { this._onDisconnect = callback; }

  isConnected() {
    if (this._send) return this._connected;
    return !!(this.ws && this.ws.readyState === WebSocket.OPEN);
  }

  disconnect() {
    if (this._recv) { this._recv.close(); this._recv = null; }
    if (this._send) { this._send.close(); this._send = null; }
    this._connected = false;

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.role = null;
  }
}

window.RelayClient = RelayClient;
