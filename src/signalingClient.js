/**
 * SignalingClient - Handles WebRTC signaling via PeerJS
 * @class
 */
class SignalingClient {
  constructor() {
    this.peer = null;
    this.roomCode = null;
    this.peerId = null;
  }

  /**
   * Create a room as host
   * @returns {Promise<{peer: Peer}>}
   */
  async createRoom() {
    return new Promise((resolve, reject) => {
      // Load PeerJS if not available
      if (typeof Peer === "undefined") {
        const script = document.createElement("script");
        script.src = "https://unpkg.com/peerjs@1.4.7/dist/peerjs.min.js";
        script.onload = () => this.createRoom().then(resolve).catch(reject);
        script.onerror = () => reject(new Error("Failed to load PeerJS"));
        document.head.appendChild(script);
        return;
      }

      // Generate room code
      this.roomCode = this.generateRoomCode();
      this.peerId = this.roomCode;

      // Create peer with room code as ID
      this.peer = new Peer(this.peerId, {
        host: "0.peerjs.com",
        port: 443,
        path: "/",
        secure: true,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
        },
      });

      this.peer.on("open", (id) => {
        console.log("[Signaling] Peer opened with ID:", id);
        this.peerId = id;
        resolve({ peer: this.peer });
      });

      this.peer.on("error", (error) => {
        console.error("[Signaling] Peer error:", error);
        reject(error);
      });
    });
  }

  /**
   * Join a room as client
   * @param {string} roomCode - Room code to join
   * @returns {Promise<{peer: Peer, connection: DataConnection}>}
   */
  async joinRoom(roomCode) {
    return new Promise((resolve, reject) => {
      // Load PeerJS if not available
      if (typeof Peer === "undefined") {
        const script = document.createElement("script");
        script.src = "https://unpkg.com/peerjs@1.4.7/dist/peerjs.min.js";
        script.onload = () => this.joinRoom(roomCode).then(resolve).catch(reject);
        script.onerror = () => reject(new Error("Failed to load PeerJS"));
        document.head.appendChild(script);
        return;
      }

      this.roomCode = roomCode;

      // Create peer with random ID
      this.peer = new Peer(undefined, {
        host: "0.peerjs.com",
        port: 443,
        path: "/",
        secure: true,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
        },
      });

      this.peer.on("open", (id) => {
        console.log("[Signaling] Peer opened with ID:", id);
        this.peerId = id;

        // Connect to host
        const connection = this.peer.connect(roomCode);
        connection.on("open", () => {
          console.log("[Signaling] Connected to host");
          resolve({ peer: this.peer, connection });
        });

        connection.on("error", (error) => {
          console.error("[Signaling] Connection error:", error);
          reject(error);
        });
      });

      this.peer.on("error", (error) => {
        console.error("[Signaling] Peer error:", error);
        reject(error);
      });
    });
  }

  /**
   * Create a PeerJS peer with a PeerJS-assigned random ID. Used by the
   * matchmaking flow where the server (not the client) determines the room code.
   * @returns {Promise<{peer: Peer, peerId: string}>}
   */
  async createPeer() {
    return new Promise((resolve, reject) => {
      if (typeof Peer === "undefined") {
        const script = document.createElement("script");
        script.src = "https://unpkg.com/peerjs@1.4.7/dist/peerjs.min.js";
        script.onload = () => this.createPeer().then(resolve).catch(reject);
        script.onerror = () => reject(new Error("Failed to load PeerJS"));
        document.head.appendChild(script);
        return;
      }
      const peer = new Peer(undefined, {
        host: "0.peerjs.com",
        port: 443,
        path: "/",
        secure: true,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
        },
      });
      peer.on("open", (id) => resolve({ peer, peerId: id }));
      peer.on("error", reject);
    });
  }

  /**
   * Generate a random room code
   * @returns {string} 4-digit room code
   */
  generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }
}

// Export for browser
window.SignalingClient = SignalingClient;

