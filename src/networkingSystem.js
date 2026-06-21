/**
 * NetworkingSystem - Handles multiplayer networking via WebRTC
 * @class
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
    this.connectionState = "disconnected"; // disconnected, connecting, connected

    this.peer = null;
    this.dataChannel = null;
    this.signalingClient = null;

    this.stateSyncInterval = null;
    this.matchmakingTimers = null;

    // Message queue for messages sent before connection is ready
    this.messageQueue = [];
  }

  /**
   * Start as host (create room)
   */
  async startAsHost() {
    this.isHost = true;
    this.localPlayerId = "player1";
    this.remotePlayerId = "player2";
    this.connectionState = "connecting";

    try {
      // Create room with signaling
      const { peer } = await this.signalingClient.createRoom();

      // Store peer reference
      this.peer = peer;

      // Set up connection handler for when opponent joins
      peer.on("connection", (conn) => {
        console.log("[Networking] Connection received from client");
        this.dataChannel = conn;
        this.setupDataChannel();
      });

      return {
        roomCode: this.signalingClient.roomCode,
      };
    } catch (error) {
      console.error("[Networking] Error starting as host:", error);
      throw error;
    }
  }

  /**
   * Join as client (connects using short room code)
   */
  async joinAsClient(roomCode) {
    this.isHost = false;
    this.localPlayerId = "player2";
    this.remotePlayerId = "player1";
    this.connectionState = "connecting";

    // CRITICAL FIX: On client side, copy their deck from "player1" to "player2"
    // This is because both players save their deck as "player1" locally before connecting
    // When client connects as "player2", they need their deck available as "player2" for UI filtering
    // We need to do this BEFORE the game starts so setupPvPUI can find it
    if (window.deckSystem) {
      const clientDeck = window.deckSystem.getPlayerDeck("player1", false);
      console.log("[Networking] Client: Checking player1 deck to copy to player2:", clientDeck);

      if (clientDeck && clientDeck.troops && clientDeck.troops.length > 0) {
        // Verify it's not the default deck
        const defaultDeck = window.deckSystem.defaultDeck;
        const isDefault =
          JSON.stringify(clientDeck.troops) === JSON.stringify(defaultDeck.troops) &&
          JSON.stringify(clientDeck.strategems) === JSON.stringify(defaultDeck.strategems) &&
          JSON.stringify(clientDeck.buildings) === JSON.stringify(defaultDeck.buildings);

        if (!isDefault) {
          // Temporarily disable protection to allow copying own deck (this is safe on client side)
          // The protection is meant to prevent host from overwriting, not client from setting their own deck
          const wasProtected = window.deckSystem.player2DeckSetFromNetwork;
          window.deckSystem.player2DeckSetFromNetwork = false; // Temporarily disable

          // Copy their deck to player2 so it's available locally for UI setup
          const success = window.deckSystem.setPlayerDeck("player2", clientDeck);

          // Restore protection state
          window.deckSystem.player2DeckSetFromNetwork = wasProtected;

          if (success) {
            console.log("[Networking] Client: Successfully copied deck from player1 to player2 for local UI:", clientDeck);
            // Verify it was set
            const verifyDeck = window.deckSystem.getPlayerDeck("player2", false);
            console.log("[Networking] Client: Verified player2 deck after copy:", verifyDeck);
          } else {
            console.error("[Networking] Client: Failed to copy deck from player1 to player2! This will cause UI issues!");
          }
        } else {
          console.warn("[Networking] Client: player1 deck is default, not copying to player2");
        }
      } else {
        console.warn("[Networking] Client: No player1 deck found or deck is empty, cannot copy to player2");
      }
    }

    try {
      // Join room with signaling
      const { peer, connection } = await this.signalingClient.joinRoom(roomCode);

      // Store peer reference
      this.peer = peer;

      // The connection is the data channel
      if (connection) {
        this.dataChannel = connection;
        this.setupDataChannel();
      }

      return {
        roomCode: roomCode,
      };
    } catch (error) {
      console.error("[Networking] Error joining as client:", error);
      throw error;
    }
  }

  /**
   * Set up data channel handlers
   */
  setupDataChannel() {
    if (!this.dataChannel) return;

    const onOpen = () => {
      console.log("[Networking] Data connection opened");
      this.connectionState = "connected";

      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        this.sendMessage(message);
      }

      this.onConnectionEstablished();
    };

    // PeerJS `on('open')` is a one-shot event. The joiner path resolves
    // signalingClient.joinRoom() *after* open fires, so a late listener
    // would never run — fire synchronously when the channel is already open.
    if (this.dataChannel.open) {
      onOpen();
    } else {
      this.dataChannel.on("open", onOpen);
    }

    this.dataChannel.on("close", () => {
      console.log("[Networking] Data connection closed");
      this.connectionState = "disconnected";
      this.onConnectionLost();
    });

    this.dataChannel.on("error", (error) => {
      console.error("[Networking] Data channel error:", error);
    });

    this.dataChannel.on("data", (data) => {
      this.handleMessage(data);
    });
  }

  /**
   * Handle incoming message
   * @param {*} data - Message data
   */
  handleMessage(data) {
    try {
      let message;
      if (typeof data === "string") {
        console.log("[Networking] Raw data received:", data, "Type:", typeof data);
        message = JSON.parse(data);
        console.log("[Networking] Parsed message:", message);
      } else {
        message = data;
      }

      console.log("[Networking] Received message:", message.type, message);

      switch (message.type) {
        case "gameState":
          // Host sends game state to client
          if (!this.isHost && this.gameState) {
            this.gameState.applyNetworkState(message.state);
          }
          break;

        case "playerAction":
          // Client sends actions to host
          if (this.isHost && this.gameState) {
            this.gameState.applyPlayerAction(message.action, this.remotePlayerId);
          }
          break;

        case "playerDeck":
          // Host receives client's deck and sets it for player2
          if (this.isHost && window.deckSystem && message.deck) {
            console.log("[Networking] Host received client deck, setting for player2:", message.deck);
            const success = window.deckSystem.setPlayerDeck("player2", message.deck);
            if (success) {
              // Mark that player2's deck has been set from network - this prevents future overwrites
              window.deckSystem.player2DeckSetFromNetwork = true;
              console.log("[Networking] Successfully set player2 deck from network:", message.deck);
              // Verify it was set
              const verifyDeck = window.deckSystem.getPlayerDeck("player2", false);
              console.log("[Networking] Verified player2 deck after setting:", verifyDeck);
              console.log("[Networking] Player2 deck protection flag set - future overwrites will be blocked");
            } else {
              console.error("[Networking] Failed to set player2 deck - validation failed or blocked");
            }
          } else {
            console.warn("[Networking] Received playerDeck but conditions not met:", {
              isHost: this.isHost,
              hasDeckSystem: !!window.deckSystem,
              hasDeck: !!message.deck,
            });
          }
          break;

        case "requestDeck":
          // Client receives request from host to send deck
          if (!this.isHost && window.deckSystem) {
            console.log("[Networking] Client received deck request from host, sending deck");
            this.sendClientDeck(0);
          }
          break;

        default:
          console.warn("[Networking] Unknown message type:", message.type);
      }
    } catch (error) {
      console.error("[Networking] Error handling message:", error, data);
    }
  }

  /**
   * Send message to remote peer
   * @param {Object} message - Message object
   */
  sendMessage(message) {
    if (!this.dataChannel || !this.dataChannel.open) {
      // Queue message if connection not ready
      this.messageQueue.push(message);
      return;
    }

    try {
      const seen = new WeakSet();
      const data = JSON.stringify(message, (key, value) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return undefined;
          seen.add(value);
        }
        return value;
      });
      this.dataChannel.send(data);
    } catch (error) {
      console.error("[Networking] Error sending message:", error);
    }
  }

  /**
   * Send client deck to host
   * @param {number} retryCount - Current retry attempt
   */
  sendClientDeck(retryCount = 0) {
    if (this.isHost) {
      console.warn("[Networking] sendClientDeck called on host - this should not happen");
      return;
    }

    if (!window.deckSystem) {
      console.error("[Networking] No deckSystem available to send deck");
      return;
    }

    // Get player1's deck (client's local deck)
    const clientDeck = window.deckSystem.getPlayerDeck("player1", false);
    if (!clientDeck || !clientDeck.troops || clientDeck.troops.length === 0) {
      console.error("[Networking] Client has no deck to send");
      return;
    }

    // Verify it's not default deck
    const defaultDeck = window.deckSystem.defaultDeck;
    const isDefault =
      JSON.stringify(clientDeck.troops) === JSON.stringify(defaultDeck.troops) &&
      JSON.stringify(clientDeck.strategems) === JSON.stringify(defaultDeck.strategems) &&
      JSON.stringify(clientDeck.buildings) === JSON.stringify(defaultDeck.buildings);

    if (isDefault) {
      console.warn("[Networking] Client deck is default, not sending");
      return;
    }

    const message = {
      type: "playerDeck",
      deck: clientDeck,
    };

    if (this.dataChannel && this.dataChannel.open) {
      console.log("[Networking] Sending client deck to host:", clientDeck);
      this.sendMessage(message);
    } else {
      // Retry if connection not ready
      if (retryCount < 10) {
        console.log(`[Networking] Connection not ready, retrying in 200ms (attempt ${retryCount + 1})`);
        setTimeout(() => {
          this.sendClientDeck(retryCount + 1);
        }, 200);
      } else {
        console.error("[Networking] Failed to send client deck after 10 retries");
      }
    }
  }

  /**
   * Callback when connection is established
   */
  onConnectionEstablished() {
    // Override this in game.js
    console.log("[Networking] onConnectionEstablished called, checking for callback...");

    // Send deck to host if client (with retry logic)
    if (!this.isHost && window.deckSystem) {
      // Try sending immediately, then retry if needed
      setTimeout(() => {
        this.sendClientDeck(0);
      }, 100); // Small initial delay to ensure data channel is ready
    }

    // Start state sync if host — called from doStart() in game.js AFTER
    // gameState.initialize() so the first sync never carries an empty grid.
    if (this.isHost) {
      // Request deck from client if not received within 2 seconds
      setTimeout(() => {
        if (window.deckSystem) {
          const player2Deck = window.deckSystem.getPlayerDeck("player2", false);
          // Check if player2 deck is still default (not set by client)
          const defaultDeck = window.deckSystem.defaultDeck;
          const isDefault =
            player2Deck &&
            JSON.stringify(player2Deck.troops) === JSON.stringify(defaultDeck.troops) &&
            JSON.stringify(player2Deck.strategems) === JSON.stringify(defaultDeck.strategems) &&
            JSON.stringify(player2Deck.buildings) === JSON.stringify(defaultDeck.buildings);

          if (isDefault) {
            console.warn("[Networking] Host: Player2 deck still default, requesting from client");
            this.sendMessage({
              type: "requestDeck",
            });
          }
        }
      }, 2000);
    }

    if (window.onMultiplayerConnected) {
      console.log("[Networking] Calling window.onMultiplayerConnected");
      window.onMultiplayerConnected();
    } else {
      console.warn("[Networking] window.onMultiplayerConnected not found!");
    }
  }

  /**
   * Start periodic state sync (host only)
   */
  startStateSync() {
    if (!this.isHost) return;

    // Sync state every 100ms
    this.stateSyncInterval = setInterval(() => {
      if (this.gameState && this.dataChannel && this.dataChannel.open) {
        const state = this.gameState.getNetworkState();
        this.sendMessage({
          type: "gameState",
          state: state,
        });
      }
    }, 100);
  }

  /**
   * Stop state sync
   */
  stopStateSync() {
    if (this.stateSyncInterval) {
      clearInterval(this.stateSyncInterval);
      this.stateSyncInterval = null;
    }
  }

  /**
   * Callback when connection is lost
   */
  onConnectionLost() {
    this.stopStateSync();
    if (window.onMultiplayerDisconnected) {
      window.onMultiplayerDisconnected();
    }
  }

  /**
   * Get local player ID
   * @returns {string} Local player ID
   */
  getLocalPlayerId() {
    return this.localPlayerId;
  }

  /**
   * Get remote player ID
   * @returns {string} Remote player ID
   */
  getRemotePlayerId() {
    return this.remotePlayerId;
  }

  /**
   * Set up networking as the host side of a matchmaking pair.
   * The caller has already created the PeerJS peer and registered its ID
   * with the matchmaking server; we just need to wait for the joiner to connect.
   * @param {Peer} peer - Open PeerJS peer instance
   */
  startAsMatchmakingHost(peer) {
    this.isHost = true;
    this.localPlayerId = "player1";
    this.remotePlayerId = "player2";
    this.connectionState = "connecting";
    this.peer = peer;
    peer.on("connection", (conn) => {
      this.dataChannel = conn;
      this.setupDataChannel();
    });
  }

  /**
   * Set up networking as the joiner side of a matchmaking pair.
   * The caller has the host's peer ID from the matchmaking server.
   * @param {Peer} peer - Open PeerJS peer instance (created before matchmaker call)
   * @param {string} hostPeerId - The host's PeerJS peer ID from the matchmaker
   */
  startAsMatchmakingJoiner(peer, hostPeerId) {
    this.isHost = false;
    this.localPlayerId = "player2";
    this.remotePlayerId = "player1";
    this.connectionState = "connecting";
    this.peer = peer;
    const conn = peer.connect(hostPeerId);
    this.dataChannel = conn;
    this.setupDataChannel();
  }

  /**
   * Disconnect from multiplayer
   */
  disconnect() {
    this.stopStateSync();
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.connectionState = "disconnected";
  }
}

// Export for browser
window.NetworkingSystem = NetworkingSystem;

