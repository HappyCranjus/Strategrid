/**
 * NetworkingSystem - Multiplayer transport layer (Cloudflare DO relay).
 *
 * Both players connect to the same relay Worker via WebSocket. The relay
 * Durable Object assigns roles (host = player1, joiner = player2) and routes
 * every message between the two clients.
 *
 * Message types (all JSON):
 *   gameState       host → joiner   Full state snapshot every 500 ms (drift correction)
 *   actionBroadcast either → other  An action to apply immediately on the remote side
 *   playerAction    joiner → host   Legacy alias for actionBroadcast (kept for compat)
 *   playerDeck      joiner → host   Client's chosen deck at match start
 *   requestDeck     host → joiner   Fallback deck request if playerDeck not received
 *   deckUpdate      either → other  Updated deck after an intermission pick
 *   gameStart       host → joiner   Synchronized match start signal
 *   peer_joined     relay → host    Relay control: joiner connected
 *   peer_disconnected relay→either  Relay control: opponent disconnected
 */
class NetworkingSystem {
  constructor(
    gameState,
    uiState,
    gameLogic,
    troopSystem,
    buildingSystem,
    strategemSystem,
    audioManager
  ) {
    this.gameState = gameState;
    this.uiState = uiState;
    this.gameLogic = gameLogic;
    this.troopSystem = troopSystem;
    this.buildingSystem = buildingSystem;
    this.strategemSystem = strategemSystem;
    this.audioManager = audioManager;

    this.isHost = false;
    this.localPlayerId = "player1";
    this.remotePlayerId = "player2";
    this.connectionState = "disconnected"; // disconnected | connecting | connected

    this.relayClient = new RelayClient();
    this.stateSyncInterval = null;
    this.messageQueue = [];

    // Set by game.js; called on the joiner side when host sends gameStart.
    this.onGameStart = null;
  }

  // ─── Connection setup ────────────────────────────────────────────────────────

  /**
   * Generate a room code and connect to the relay as host.
   * Returns { roomCode } once the relay connection is open.
   * onConnectionEstablished() fires later when the joiner arrives (peer_joined).
   */
  async startAsHost(suppliedRoomCode = null) {
    this.isHost = true;
    this.localPlayerId = "player1";
    this.remotePlayerId = "player2";
    this.connectionState = "connecting";

    const roomCode = suppliedRoomCode || Math.floor(1000 + Math.random() * 9000).toString();

    this.relayClient.onMessage((msg) => this.handleMessage(msg));
    this.relayClient.onDisconnect(() => this.onConnectionLost());

    await this.relayClient.connect(roomCode, "host");
    // role === "host" — wait for peer_joined before firing onConnectionEstablished

    return { roomCode };
  }

  /**
   * Connect to an existing room as joiner (player2).
   * onConnectionEstablished() fires immediately after the relay accepts the connection.
   */
  async joinAsClient(roomCode) {
    this.isHost = false;
    this.localPlayerId = "player2";
    this.remotePlayerId = "player1";
    this.connectionState = "connecting";

    // On the joiner side, copy the locally-saved player1 deck to player2 so the
    // UI shows the right hotkey rail before the game starts.
    if (window.deckSystem) {
      const clientDeck = window.deckSystem.getPlayerDeck("player1", false);
      if (clientDeck && clientDeck.troops && clientDeck.troops.length > 0) {
        const defaultDeck = window.deckSystem.defaultDeck;
        const isDefault =
          JSON.stringify(clientDeck.troops)     === JSON.stringify(defaultDeck.troops) &&
          JSON.stringify(clientDeck.strategems) === JSON.stringify(defaultDeck.strategems) &&
          JSON.stringify(clientDeck.buildings)  === JSON.stringify(defaultDeck.buildings);
        if (!isDefault) {
          const wasProtected = window.deckSystem.player2DeckSetFromNetwork;
          window.deckSystem.player2DeckSetFromNetwork = false;
          window.deckSystem.setPlayerDeck("player2", clientDeck);
          window.deckSystem.player2DeckSetFromNetwork = wasProtected;
        }
      }
    }

    this.relayClient.onMessage((msg) => this.handleMessage(msg));
    this.relayClient.onDisconnect(() => this.onConnectionLost());

    await this.relayClient.connect(roomCode, "joiner");
    // role === "joiner" — relay is ready; host is already waiting
    this.connectionState = "connected";

    // Flush any queued messages.
    while (this.messageQueue.length > 0) {
      this.sendMessage(this.messageQueue.shift());
    }

    this.onConnectionEstablished();
    return { roomCode };
  }

  // ─── Message dispatch ─────────────────────────────────────────────────────

  handleMessage(message) {
    try {
      switch (message.type) {
        // ── Relay control ───────────────────────────────────────────────────
        case "peer_joined":
          // Host learns that the joiner has connected.
          this.connectionState = "connected";
          while (this.messageQueue.length > 0) {
            this.sendMessage(this.messageQueue.shift());
          }
          this.onConnectionEstablished();
          break;

        case "peer_disconnected":
          this.connectionState = "disconnected";
          this.onConnectionLost();
          break;

        // ── Game protocol ───────────────────────────────────────────────────
        case "tickInputs":
          // Remote peer's committed inputs for one tick — hand off to lockstep.
          if (window.lockstepSystem) {
            window.lockstepSystem.receiveRemoteTick(message.tick, message.inputs);
          }
          break;

        case "gameStart":
          // Host signals that both decks are ready and the match should begin.
          if (!this.isHost && this.onGameStart) {
            this.onGameStart();
          }
          break;

        case "playerDeck":
          if (this.isHost && window.deckSystem && message.deck) {
            const success = window.deckSystem.setPlayerDeck("player2", message.deck);
            if (success) {
              window.deckSystem.player2DeckSetFromNetwork = true;
            }
          }
          break;

        case "requestDeck":
          if (!this.isHost && window.deckSystem) {
            this.sendClientDeck(0);
          }
          break;

        case "deckUpdate":
          if (window.deckSystem && message.deck) {
            const remoteId = this.remotePlayerId;
            const wasProtected = window.deckSystem.player2DeckSetFromNetwork;
            window.deckSystem.player2DeckSetFromNetwork = false;
            window.deckSystem.setPlayerDeck(remoteId, message.deck);
            window.deckSystem.player2DeckSetFromNetwork = wasProtected;
            if (window.buildHotkeyRails) window.buildHotkeyRails(this);
          }
          break;

        default:
          console.warn("[Networking] Unknown message type:", message.type);
      }
    } catch (error) {
      console.error("[Networking] Error handling message:", error, message);
    }
  }

  // ─── Sending ──────────────────────────────────────────────────────────────

  sendMessage(message) {
    if (!this.relayClient.isConnected()) {
      this.messageQueue.push(message);
      return;
    }
    this.relayClient.send(message);
  }

  /**
   * Send this tick's committed inputs to the remote peer.
   */
  sendTickInputs(tick, inputs) {
    this.sendMessage({ type: "tickInputs", tick, inputs });
  }

  // ─── Deck exchange ────────────────────────────────────────────────────────

  sendClientDeck(retryCount = 0) {
    if (this.isHost) return;
    if (!window.deckSystem) return;

    const clientDeck = window.deckSystem.getPlayerDeck("player1", false);
    if (!clientDeck || !clientDeck.troops || clientDeck.troops.length === 0) return;

    const defaultDeck = window.deckSystem.defaultDeck;
    const isDefault =
      JSON.stringify(clientDeck.troops)     === JSON.stringify(defaultDeck.troops) &&
      JSON.stringify(clientDeck.strategems) === JSON.stringify(defaultDeck.strategems) &&
      JSON.stringify(clientDeck.buildings)  === JSON.stringify(defaultDeck.buildings);
    if (isDefault) return;

    if (this.relayClient.isConnected()) {
      this.sendMessage({ type: "playerDeck", deck: clientDeck });
    } else if (retryCount < 10) {
      setTimeout(() => this.sendClientDeck(retryCount + 1), 200);
    }
  }

  // ─── Lifecycle callbacks ──────────────────────────────────────────────────

  onConnectionEstablished() {
    // Client sends its deck to the host.
    if (!this.isHost && window.deckSystem) {
      setTimeout(() => this.sendClientDeck(0), 100);
    }

    // Host requests deck if not received within 2 s.
    if (this.isHost) {
      setTimeout(() => {
        if (!window.deckSystem) return;
        const p2Deck = window.deckSystem.getPlayerDeck("player2", false);
        const defaultDeck = window.deckSystem.defaultDeck;
        const isDefault =
          p2Deck &&
          JSON.stringify(p2Deck.troops)     === JSON.stringify(defaultDeck.troops) &&
          JSON.stringify(p2Deck.strategems) === JSON.stringify(defaultDeck.strategems) &&
          JSON.stringify(p2Deck.buildings)  === JSON.stringify(defaultDeck.buildings);
        if (isDefault) {
          this.sendMessage({ type: "requestDeck" });
        }
      }, 2000);
    }

    if (window.onMultiplayerConnected) {
      window.onMultiplayerConnected();
    }
  }

  onConnectionLost() {
    if (window.onMultiplayerDisconnected) {
      window.onMultiplayerDisconnected();
    }
  }

  // ─── Accessors ────────────────────────────────────────────────────────────

  getLocalPlayerId()  { return this.localPlayerId; }
  getRemotePlayerId() { return this.remotePlayerId; }

  disconnect() {
    this.relayClient.disconnect();
    this.connectionState = "disconnected";
  }
}

window.NetworkingSystem = NetworkingSystem;
