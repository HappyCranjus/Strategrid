/**
 * UIState - Manages UI state and user interactions
 * @class
 */
class UIState {
  constructor(
    canvas,
    gameState,
    gameLogic,
    troopSystem,
    buildingSystem,
    strategemSystem,
    audioManager,
    renderer,
    deckSystem = null,
    networkingSystem = null
  ) {
    this.canvas = canvas;
    this.gameState = gameState;
    this.gameLogic = gameLogic;
    this.troopSystem = troopSystem;
    this.buildingSystem = buildingSystem;
    this.strategemSystem = strategemSystem;
    this.audioManager = audioManager;
    this.renderer = renderer;
    this.deckSystem = deckSystem;
    this.networkingSystem = networkingSystem;

    this.spawnMode = null;
    this.buildMode = null;
    this.strategemMode = null;
    this.selectedPlayer = null;

    // Two-click strategem placement state (Divine Wind: 1st click = center, 2nd = direction)
    this.pendingStrategem = null;

    // Cursor tile (updated on mousemove) — used by the renderer for ghost previews
    this.cursorCol = null;
    this.cursorRow = null;

    this.updateUIForDeck();
    this._setupCanvasClickHandler();
    this._setupCanvasMoveHandler();
  }

  /** Cursor tracking so renderer can draw a ghost preview of the active mode */
  _setupCanvasMoveHandler() {
    this.canvas.addEventListener("mousemove", (e) => {
      const { col, row } = this._eventToTile(e);
      this.cursorCol = col;
      this.cursorRow = row;
    });
    this.canvas.addEventListener("mouseleave", () => {
      this.cursorCol = null;
      this.cursorRow = null;
    });
  }

  _eventToTile(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const pixelX = (e.clientX - rect.left) * scaleX;
    const pixelY = (e.clientY - rect.top) * scaleY;
    const ts = this.gameState.tileSize;
    return { col: Math.floor(pixelX / ts), row: Math.floor(pixelY / ts) };
  }

  /**
   * Wire up canvas click → spawn / build / strategem based on active mode
   */
  _setupCanvasClickHandler() {
    this.canvas.addEventListener("click", (e) => {
      const { col, row } = this._eventToTile(e);

      if (row < 0 || row >= this.gameState.rows || col < 0 || col >= this.gameState.cols) return;

      if (this.spawnMode) {
        this._trySpawnTroop(row, col, this.spawnMode.owner, this.spawnMode.troopType);
      } else if (this.buildMode) {
        this._tryPlaceBuilding(row, col, this.buildMode.owner, this.buildMode.buildingType);
      } else if (this.strategemMode) {
        this._tryPlaceStrategem(row, col, this.strategemMode.owner, this.strategemMode.strategemType);
      }
    });
  }

  _trySpawnTroop(row, col, owner, troopType) {
    const gs = this.gameState;
    const elig = this.getSpawnEligibility(col, row, owner, troopType);
    if (!elig.zoneOK || !elig.affordOK) return;

    const troop = this.gameLogic.createTroop(troopType, row, col, owner);
    if (!troop) return;

    // Forward-of-turret spawns take 1.2s to activate; behind/at-turret spawns
    // are immediate. Troop ignores movement/combat while !active (see troopSystem).
    if (elig.instant) {
      troop.active = true;
      troop.activationTime = 0;
      troop.activationDuration = 0;
    } else {
      troop.active = false;
      troop.activationTime = 1.2;
      troop.activationDuration = 1.2;
    }

    gs.currentRP[owner] -= (troop.cost || 0);
    gs.troops.push(troop);
    const am = window.gameSetupResult && window.gameSetupResult.audioManager;
    if (am) am.playTroopSpawn(troop);
    this.spawnMode = null;
  }

  /**
   * Spawn rule check, shared by _trySpawnTroop and the renderer's cursor preview.
   * Returns { zoneOK, affordOK, instant, frontier }:
   *   zoneOK   - tile is owned by `owner` via influence
   *   affordOK - player has at least troop.cost RP
   *   instant  - spawn is behind or on the owner's forward-most tower turret line
   *   frontier - the col of the forward-most owned towerTurret (null if none alive)
   */
  getSpawnEligibility(col, row, owner, troopType) {
    const gs = this.gameState;
    const inBounds =
      Number.isInteger(col) && Number.isInteger(row) &&
      col >= 0 && col < gs.cols && row >= 0 && row < gs.rows;
    const tileOwner = inBounds ? gs.grid[row][col].owner : null;
    const zoneOK = inBounds && tileOwner === owner;

    const def = (this.gameLogic.troopTypes || {})[troopType] || {};
    const cost = def.cost || 0;
    const affordOK = (gs.currentRP[owner] || 0) >= cost;

    const frontier = this._turretFrontierCol(owner);
    const instant = frontier !== null && (
      owner === "player1" ? col <= frontier : col >= frontier
    );

    return { zoneOK, affordOK, instant, frontier };
  }

  /** Forward-most surviving towerTurret col for the given owner (null if none). */
  _turretFrontierCol(owner) {
    const gs = this.gameState;
    let frontier = null;
    for (const b of gs.buildings) {
      if (b.type !== "towerTurret" || b.owner !== owner) continue;
      if (frontier === null) frontier = b.col;
      else if (owner === "player1") frontier = Math.max(frontier, b.col);
      else frontier = Math.min(frontier, b.col);
    }
    return frontier;
  }

  _tryPlaceBuilding(row, col, owner, buildingType) {
    const gs = this.gameState;
    // Enforce placement zones: player1 on left half, player2 on right half.
    // Sandbox waives the restriction so the dev can place anywhere.
    const midCol = Math.floor(gs.cols / 2);
    if (gs.gameMode !== "sandbox") {
      if (owner === "player1" && (col < 1 || col >= midCol)) return;
      if (owner === "player2" && (col < midCol || col > gs.cols - 2)) return;
    }

    const building = this.gameLogic.createBuilding(buildingType, row, col, owner);
    if (!building) return;

    const def = this.gameLogic.buildingTypes[buildingType] || {};
    const rpCost = building.cost || 0;
    const tpCost = def.tpCost || 0;
    if ((gs.currentRP[owner] || 0) < rpCost) return;
    if ((gs.currentTP[owner] || 0) < tpCost) return;

    // Check that all tiles in the footprint are empty
    for (let r = row; r < row + building.height; r++) {
      for (let c = col; c < col + building.width; c++) {
        if (r >= gs.rows || c >= gs.cols) return;
        const occupied = gs.buildings.some(
          (b) => c >= b.col && c < b.col + b.width && r >= b.row && r < b.row + b.height
        );
        if (occupied) return;
      }
    }

    gs.currentRP[owner] -= rpCost;
    if (tpCost) gs.currentTP[owner] -= tpCost;
    gs.buildings.push(building);
    this.buildMode = null;
  }

  /**
   * Place a strategem at (row, col) for owner. Handles tile / column /
   * tile_ownHalf / twoClick targeting from `strategemTypes`.
   */
  _tryPlaceStrategem(row, col, owner, strategemType) {
    const gs = this.gameState;
    const def = (this.gameLogic.strategemTypes || {})[strategemType];
    if (!def) return;

    const tpCost = def.tpCost || 0;
    if ((gs.currentTP[owner] || 0) < tpCost) return;

    const midCol = Math.floor(gs.cols / 2);
    const inOwnHalf =
      (owner === "player1" && col >= 0 && col < midCol) ||
      (owner === "player2" && col >= midCol && col <= gs.cols - 1);

    if (def.targeting === "tile_ownHalf" && !inOwnHalf) return;

    let entity = null;
    if (def.targeting === "twoClick") {
      // 1st click: set pending center; 2nd click: commit with direction
      if (!this.pendingStrategem) {
        this.pendingStrategem = { strategemType, owner, row, col };
        return;
      }
      const center = this.pendingStrategem;
      const dirCol = col - center.col;
      const dirRow = row - center.row;
      const ss = this.strategemSystem;
      entity = ss.createStrategem(strategemType, {
        owner,
        row: center.row,
        col: center.col,
        dirCol: dirCol || (owner === "player1" ? 1 : -1),
        dirRow: dirRow,
      });
      this.pendingStrategem = null;
    } else {
      const ss = this.strategemSystem;
      entity = ss.createStrategem(strategemType, { owner, row, col });
    }

    if (!entity) return;
    gs.currentTP[owner] = Math.max(0, (gs.currentTP[owner] || 0) - tpCost);
    this.strategemMode = null;
  }

  /**
   * Set spawn mode for a player
   * @param {string} owner - Player ID
   * @param {string} troopType - Troop type
   */
  setSpawnMode(owner, troopType) {
    this.spawnMode = { owner, troopType };
    this.buildMode = null;
    this.strategemMode = null;
    this.pendingStrategem = null;
  }

  /**
   * Set build mode for a player
   * @param {string} owner - Player ID
   * @param {string} buildingType - Building type
   */
  setBuildMode(owner, buildingType) {
    this.buildMode = { owner, buildingType };
    this.spawnMode = null;
    this.strategemMode = null;
    this.pendingStrategem = null;
  }

  /**
   * Set strategem mode for a player
   * @param {string} owner - Player ID
   * @param {string} strategemType - Strategem type
   */
  setStrategemMode(owner, strategemType) {
    this.strategemMode = { owner, strategemType };
    this.spawnMode = null;
    this.buildMode = null;
    this.pendingStrategem = null;
  }

  /**
   * Clear all modes
   */
  clearModes() {
    this.spawnMode = null;
    this.buildMode = null;
    this.strategemMode = null;
    this.pendingStrategem = null;
  }

  /**
   * Update UI to show/hide buttons based on deck
   */
  updateUIForDeck() {
    // Get current player (default to player1 for UI)
    const currentPlayer = this.gameState.getCurrentPlanningPlayer() || "player1";

    // In PvP mode, only update UI for the local player to avoid interfering with opponent's deck
    const isPvPMode = this.gameState.gameMode === "pvp";
    const localPlayerId = this.networkingSystem ? this.networkingSystem.getLocalPlayerId() : currentPlayer;

    // Hide/lock unavailable items based on deck
    const troopButtons = document.querySelectorAll("[data-troop-type]");
    troopButtons.forEach((button) => {
      const type = button.getAttribute("data-troop-type");
      const owner = button.getAttribute("data-owner") || currentPlayer;

      // In PvP mode, only check deck for local player's buttons
      if (isPvPMode && owner !== localPlayerId) {
        // Don't check opponent's deck - just show/hide based on whether it's the local player
        if (owner === localPlayerId) {
          button.style.display = "";
        }
        return;
      }

      if (this.deckSystem && !this.deckSystem.isTroopInDeck(owner, type)) {
        button.style.display = "none";
      } else {
        button.style.display = "";
        button.style.opacity = "1";
        button.style.cursor = "pointer";
        button.title = "";
      }
    });

    const buildingButtons = document.querySelectorAll("[data-building-type]");
    buildingButtons.forEach((button) => {
      const type = button.getAttribute("data-building-type");
      const owner = button.getAttribute("data-owner") || currentPlayer;

      // In PvP mode, only check deck for local player's buttons
      if (isPvPMode && owner !== localPlayerId) {
        // Don't check opponent's deck - just show/hide based on whether it's the local player
        if (owner === localPlayerId) {
          button.style.display = "";
        }
        return;
      }

      if (this.deckSystem && !this.deckSystem.isBuildingInDeck(owner, type)) {
        button.style.display = "none";
      } else {
        button.style.display = "";
        button.style.opacity = "1";
        button.style.cursor = "pointer";
        button.title = "";
      }
    });

    const strategemButtons = document.querySelectorAll("[data-strategem-type]");
    strategemButtons.forEach((button) => {
      const type = button.getAttribute("data-strategem-type");
      const owner = button.getAttribute("data-owner") || currentPlayer;

      // In PvP mode, only check deck for local player's buttons
      if (isPvPMode && owner !== localPlayerId) {
        // Don't check opponent's deck - just show/hide based on whether it's the local player
        if (owner === localPlayerId) {
          button.style.display = "";
        }
        return;
      }

      if (this.deckSystem && !this.deckSystem.isStrategemInDeck(owner, type)) {
        button.style.display = "none";
      } else {
        button.style.display = "";
        button.style.opacity = "1";
        button.style.cursor = "pointer";
        button.title = "";
      }
    });
  }
}

// Export for browser
window.UIState = UIState;

