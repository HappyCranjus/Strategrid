/**
 * GameState - Manages game state
 * @class
 */
class GameState {
  constructor() {
    this.troops = [];
    this.buildings = [];
    this.strategems = [];
    // Per-strategem-type cooldown timers (seconds remaining), keyed by owner.
    // Decremented each frame by strategemSystem; cast attempts gate on > 0.
    this.strategemCooldowns = { player1: {}, player2: {} };
    // Per-hero-type ability cooldown timers (seconds remaining), keyed by owner.
    // Same shape and lifecycle as strategemCooldowns; ticked by strategemSystem.
    this.heroAbilityCooldowns = { player1: {}, player2: {} };
    // Troops that died this frame — populated by troopSystem at the death
    // sweep, read by strategemSystem (Necromancy raises on enemy deaths inside
    // its zone). Cleared at the start of each troopSystem.update().
    this.deathsThisFrame = [];
    // Floating damage popups: { col, row, dmg, spawnTime } — spawned by
    // applyDamage when a hero or tower turret is hit, GC'd by troopSystem.
    this.damagePopups = [];
    this.grid = [];
    this.rows = 16;
    this.cols = 18;
    this.tileSize = 37; // default; recomputed from canvas in GameSetup.initialize

    this.currentRP = { player1: 5, player2: 5 };
    this.currentTP = { player1: 3, player2: 3 };
    this.maxRP    = { player1: 10, player2: 10 };
    this.maxTP    = { player1: 5,  player2: 5 };

    this.gameMode = "single"; // single, pvp, training
    this.paused = false;
    this.phase = "opening"; // opening, intermission1, assault, intermission2, endgame
    this.matchTime = 0;

    // Hero refs — populated by initialize() once GameLogic is available.
    // hero1 is Brick McStick (player1); hero2 is Strategia (player2). Both
    // live inside this.troops; these fields are just O(1) lookup handles.
    this.hero1 = null;
    this.hero2 = null;

    this.currentPlayer = "player1";
    this.gameOver = false;
    this.winner = null;
  }

  /**
   * Initialize game state
   */
  initialize() {
    this.troops = [];
    this.buildings = [];
    this.strategems = [];
    this.strategemCooldowns = { player1: {}, player2: {} };
    this.heroAbilityCooldowns = { player1: {}, player2: {} };
    this.deathsThisFrame = [];
    this.damagePopups = [];
    this.currentRP = { player1: 5, player2: 5 };
    this.currentTP = { player1: 3, player2: 3 };
    this.maxRP    = { player1: 10, player2: 10 };
    this.maxTP    = { player1: 5,  player2: 5 };
    this.phase = "opening";
    this.matchTime = 0;
    this.paused = false;
    this.currentPlayer = "player1";
    this.gameOver = false;
    this.winner = null;

    // Initialize grid with neutral tiles.
    this.grid = [];
    for (let row = 0; row < this.rows; row++) {
      this.grid[row] = [];
      for (let col = 0; col < this.cols; col++) {
        this.grid[row][col] = { type: "empty", influence: 0, owner: null };
      }
    }
    this._applyStartingLayout();
    this._spawnHeroes();
  }

  /**
   * Spawn each player's Hero where their tower used to stand. Heroes are
   * normal troops with isHero=true, so they get auto-attack, collision, and
   * sprite rendering for free. Cached on hero1/hero2 for O(1) access.
   */
  _spawnHeroes() {
    const logic = (window.gameSetupResult && window.gameSetupResult.gameLogic)
      || new GameLogic();
    const midRow = Math.floor(this.rows / 2);
    // Troop coordinate convention: renderer draws sprite center at
    // (col + 0.5) * tileSize, so col=0.5 puts a 2-tile-wide hero sprite
    // flush against the LEFT wall and col=cols-1.5 puts it flush RIGHT.
    // These spawn values give each hero a sprite-flush back-wall start.
    this.hero1 = logic.createTroop("brickMcStick", midRow, 0.5,             "player1");
    this.hero2 = logic.createTroop("strategia",    midRow, this.cols - 1.5, "player2");
    if (this.hero1) { this.hero1.active = true; this.troops.push(this.hero1); }
    if (this.hero2) { this.hero2.active = true; this.troops.push(this.hero2); }
  }

  /**
   * Seed the board: each player owns 3 back columns fully (+/-1.0 influence) and
   * 2 cols ahead of that at half claim (+/-0.5). Middle 8 columns start neutral.
   */
  _applyStartingLayout() {
    const layout = [
      { cols: [0, 1, 2],   influence: +1.0, owner: "player1" },
      { cols: [3, 4],      influence: +0.5, owner: "player1" },
      { cols: [13, 14],    influence: -0.5, owner: "player2" },
      { cols: [15, 16, 17], influence: -1.0, owner: "player2" },
    ];
    for (const band of layout) {
      for (const c of band.cols) {
        if (c < 0 || c >= this.cols) continue;
        for (let r = 0; r < this.rows; r++) {
          this.grid[r][c].influence = band.influence;
          this.grid[r][c].owner = band.owner;
        }
      }
    }
  }

  /**
   * Trigger game over
   * @param {string} winner - "player1" or "player2"
   */
  setGameOver(winner) {
    this.gameOver = true;
    this.winner = winner;
    const overlay = document.getElementById("gameOverOverlay");
    if (overlay) {
      const msg = document.getElementById("gameOverMessage");
      if (msg) {
        if (this.gameMode === "sandbox") {
          msg.textContent = winner === "player1" ? "Blue Wins!" : "Red Wins!";
        } else if (window.networkingSystem) {
          const local = window.networkingSystem.getLocalPlayerId();
          msg.textContent = winner === local ? "You Win!" : "Opponent Wins!";
        } else {
          msg.textContent = winner === "player1" ? "Blue Wins!" : "Red Wins!";
        }
      }
      overlay.style.display = "flex";
    }
  }

  /**
   * Set game mode
   * @param {string} mode - Game mode (single, pvp, training)
   */
  setGameMode(mode) {
    this.gameMode = mode;
  }

  /**
   * Get current planning player
   * @returns {string} Current player
   */
  getCurrentPlanningPlayer() {
    return this.currentPlayer;
  }

  /**
   * Check if player can act
   * @param {string} player - Player ID
   * @returns {boolean}
   */
  canPlayerAct(player) {
    if (this.gameMode === "sandbox") return true; // dev mode: control both sides
    if (this.gameMode === "pvp") {
      if (window.networkingSystem) {
        return window.networkingSystem.getLocalPlayerId() === player;
      }
    }
    return this.currentPlayer === player;
  }

  /**
   * Add resource points
   * @param {string} player - Player ID
   * @param {number} amount - Amount to add
   */
  addRP(player, amount) {
    this.currentRP[player] = (this.currentRP[player] || 0) + amount;
    this.currentRP[player] = Math.max(0, this.currentRP[player]);
  }

  /**
   * Add tactics points
   * @param {string} player - Player ID
   * @param {number} amount - Amount to add
   */
  addTP(player, amount) {
    this.currentTP[player] = (this.currentTP[player] || 0) + amount;
    this.currentTP[player] = Math.max(0, this.currentTP[player]);
  }

  /**
   * Get network state for synchronization
   * @returns {Object} Network state
   */
  getNetworkState() {
    return {
      troops: this.troops,
      buildings: this.buildings,
      strategems: this.strategems,
      strategemCooldowns: this.strategemCooldowns,
      heroAbilityCooldowns: this.heroAbilityCooldowns,
      currentRP: this.currentRP,
      currentTP: this.currentTP,
      maxRP: this.maxRP,
      maxTP: this.maxTP,
      phase: this.phase,
      matchTime: this.matchTime,
      grid: this.grid,
    };
  }

  /**
   * Apply network state (client side)
   * @param {Object} state - Network state
   */
  applyNetworkState(state) {
    // Remember the local hero's pre-snapshot position so we can restore it
    // after merging — the local side owns its own hero's col/row to avoid
    // rubber-banding while moving. HP/target propagate normally.
    const localId = (window.networkingSystem && window.networkingSystem.getLocalPlayerId
      && window.networkingSystem.getLocalPlayerId()) || null;
    let localHeroPos = null;
    if (localId && state.troops) {
      const oldHero = localId === "player1" ? this.hero1 : this.hero2;
      if (oldHero) localHeroPos = { col: oldHero.col, row: oldHero.row };
    }

    if (state.troops) this.troops = state.troops;
    if (state.buildings) this.buildings = state.buildings;
    if (state.strategems) this.strategems = state.strategems;
    if (state.strategemCooldowns) this.strategemCooldowns = state.strategemCooldowns;
    if (state.heroAbilityCooldowns) this.heroAbilityCooldowns = state.heroAbilityCooldowns;
    if (state.currentRP) this.currentRP = state.currentRP;
    if (state.currentTP) this.currentTP = state.currentTP;
    if (state.maxRP) this.maxRP = state.maxRP;
    if (state.maxTP) this.maxTP = state.maxTP;
    if (state.phase) this.phase = state.phase;
    if (typeof state.matchTime === "number") this.matchTime = state.matchTime;
    if (state.grid) this.grid = state.grid;

    // Re-resolve hero refs through the freshly-installed troops array.
    this.hero1 = this.troops.find((t) => t.isHero && t.owner === "player1") || null;
    this.hero2 = this.troops.find((t) => t.isHero && t.owner === "player2") || null;

    // Restore the local hero's position so the snapshot does not snap us
    // backward in the middle of a keypress.
    if (localId && localHeroPos) {
      const myHero = localId === "player1" ? this.hero1 : this.hero2;
      if (myHero) { myHero.col = localHeroPos.col; myHero.row = localHeroPos.row; }
    }
  }

  /**
   * Apply player action (host side)
   * @param {Object} action - Player action
   * @param {string} player - Player ID
   */
  applyPlayerAction(action, player) {
    // Handle player actions (spawn troop, place building, etc.)
    // This will be implemented by the game systems
    console.log("[GameState] Applying player action:", action, "for", player);
  }
}

// Export for browser
window.GameState = GameState;

