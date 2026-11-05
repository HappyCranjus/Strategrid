/**
 * Strategrid Relay + Matchmaker Worker
 *
 * Endpoints:
 *   GET  /relay/:roomCode  WebSocket upgrade — routes two players into a game room
 *   POST /match            JSON — pairs two players with a shared room code
 *
 * LOCAL DEV  (LOCAL_DEV="true" in wrangler.jsonc vars):
 *   Module-level Maps handle state. Works in wrangler dev's single-process model.
 *
 * PRODUCTION:
 *   GameRelay  DO — one instance per room code, routes WebSocket messages
 *   MatchQueue DO — single global instance, pairs waiting players
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function corsPreflightResp() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Upgrade, Connection, Content-Type",
    },
  });
}

// ── Local dev state ───────────────────────────────────────────────────────────
// Module-level — persists across requests in wrangler dev's single-process model.

const devRooms = new Map();      // roomCode → [{ws, role}, ...]
let   devMatchQueue = null;      // {roomCode, clientId, timestamp} | null

// ── Local dev: relay ──────────────────────────────────────────────────────────

function handleLocalDev(request, roomCode) {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("WebSocket upgrade required", { status: 426 });
  }

  const room = devRooms.get(roomCode) || [];
  if (room.length >= 2) return new Response("Room full", { status: 409 });

  const role = room.length === 0 ? "host" : "joiner";
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();

  const entry = { ws: server, role };
  room.push(entry);
  devRooms.set(roomCode, room);

  server.send(JSON.stringify({ type: "relay_ready", role }));
  if (role === "joiner") {
    const host = room.find(e => e.role === "host");
    if (host) host.ws.send(JSON.stringify({ type: "peer_joined" }));
  }

  server.addEventListener("message", evt => {
    const current = devRooms.get(roomCode) || [];
    const other = current.find(e => e.ws !== server);
    if (other) { try { other.ws.send(evt.data); } catch {} }
  });

  const cleanup = () => {
    const current = devRooms.get(roomCode) || [];
    const remaining = current.filter(e => e.ws !== server);
    if (remaining.length === 0) {
      devRooms.delete(roomCode);
    } else {
      devRooms.set(roomCode, remaining);
      try { remaining[0].ws.send(JSON.stringify({ type: "peer_disconnected" })); } catch {}
    }
  };
  server.addEventListener("close", cleanup);
  server.addEventListener("error", cleanup);

  return new Response(null, { status: 101, webSocket: client });
}

// ── Local dev: matchmaker ─────────────────────────────────────────────────────

async function handleLocalMatch(request) {
  const body = await request.json().catch(() => ({}));
  const { clientId } = body;
  const now = Date.now();

  if (devMatchQueue && now - devMatchQueue.timestamp > 120_000) devMatchQueue = null;

  if (!devMatchQueue) {
    const roomCode = String(Math.floor(1000 + Math.random() * 9000));
    devMatchQueue = { roomCode, clientId, timestamp: now };
    return jsonResp({ role: "host", roomCode });
  }
  if (devMatchQueue.clientId === clientId) {
    devMatchQueue.timestamp = now; // heartbeat
    return jsonResp({ role: "host", roomCode: devMatchQueue.roomCode });
  }
  const { roomCode } = devMatchQueue;
  devMatchQueue = null;
  return jsonResp({ role: "joiner", roomCode });
}

// ── Production: GameRelay DO ──────────────────────────────────────────────────

export class GameRelay {
  constructor(ctx) {
    this.ctx = ctx;
    this.sockets = []; // [{ws, role}]
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    if (this.sockets.length >= 2) return new Response("Room full", { status: 409 });

    const role = this.sockets.length === 0 ? "host" : "joiner";
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    this.sockets.push({ ws: server, role });
    server.send(JSON.stringify({ type: "relay_ready", role }));
    if (role === "joiner") {
      const host = this.sockets.find(e => e.role === "host");
      if (host) host.ws.send(JSON.stringify({ type: "peer_joined" }));
    }

    server.addEventListener("message", evt => {
      const other = this.sockets.find(e => e.ws !== server);
      if (other) { try { other.ws.send(evt.data); } catch {} }
    });

    const cleanup = () => {
      this.sockets = this.sockets.filter(e => e.ws !== server);
      const other = this.sockets[0];
      if (other) { try { other.ws.send(JSON.stringify({ type: "peer_disconnected" })); } catch {} }
    };
    server.addEventListener("close", cleanup);
    server.addEventListener("error", cleanup);

    return new Response(null, { status: 101, webSocket: client });
  }
}

// ── Production: MatchQueue DO ─────────────────────────────────────────────────

export class MatchQueue {
  constructor(ctx) {
    this.ctx = ctx;
    this.waiting = null; // {roomCode, clientId, timestamp} | null
  }

  async fetch(request) {
    const body = await request.json().catch(() => ({}));
    const { clientId } = body;
    const now = Date.now();

    // Expire stale slot
    if (this.waiting && now - this.waiting.timestamp > 120_000) this.waiting = null;

    if (!this.waiting) {
      const roomCode = String(Math.floor(1000 + Math.random() * 9000));
      this.waiting = { roomCode, clientId, timestamp: now };
      return jsonResp({ role: "host", roomCode });
    }
    if (this.waiting.clientId === clientId) {
      this.waiting.timestamp = now; // heartbeat refresh
      return jsonResp({ role: "host", roomCode: this.waiting.roomCode });
    }
    const { roomCode } = this.waiting;
    this.waiting = null;
    return jsonResp({ role: "joiner", roomCode });
  }
}

// ── Main fetch ────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return corsPreflightResp();

    const url = new URL(request.url);

    // ── Matchmaker ────────────────────────────────────────────────────────────
    if (url.pathname === "/match") {
      if (request.method !== "POST") {
        return new Response("POST required", { status: 405 });
      }
      if (env.LOCAL_DEV === "true") return handleLocalMatch(request);
      const id   = env.MATCH_QUEUE.idFromName("global");
      const stub = env.MATCH_QUEUE.get(id);
      return stub.fetch(request);
    }

    // ── Relay ─────────────────────────────────────────────────────────────────
    const match = url.pathname.match(/^\/relay\/([0-9]{4})$/);
    if (!match) {
      return new Response("Not found — expected /relay/:4-digit-code or /match", { status: 404 });
    }

    const roomCode = match[1];
    if (env.LOCAL_DEV === "true") return handleLocalDev(request, roomCode);

    const id   = env.RELAY.idFromName(roomCode);
    const stub = env.RELAY.get(id);
    return stub.fetch(request);
  },
};
