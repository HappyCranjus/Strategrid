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

    this._setupCanvasClickHandler();
    this._setupCanvasMoveHandler();
    this._setupDeckHotkeys();
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

  _isRemoteClient() {
    const ns = this.networkingSystem;
    return !!(ns && ns.connectionState === "connected" && !ns.isHost);
  }

  _sendAction(action) {
    if (this.networkingSystem) {
      this.networkingSystem.sendMessage({ type: "playerAction", action });
    }
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
    if (this._isRemoteClient()) {
      this._sendAction({ kind: "spawnTroop", row, col, troopType });
    }
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

    if (troopType === "ninja") {
      const def = (this.gameLogic.troopTypes || {}).ninja || {};
      const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
      troop.invisible    = true;
      troop.cloakActive  = true;
      troop.cloakedUntil = now + (def.spawnCloakDuration || 5.0);
      // First attack MUST be a katana — suppress shurikens until she closes
      // to melee and lands the opener. The opener also gets a +50% bonus
      // (applied in troopSystem when the attack fires).
      troop.firstAttackPending = true;
    }

    gs.currentRP[owner] -= (troop.cost || 0);
    const tpCost = ((this.gameLogic.troopTypes || {})[troopType] || {}).tpCost || 0;
    if (tpCost > 0) gs.currentTP[owner] -= tpCost;
    gs.troops.push(troop);
    const am = window.gameSetupResult && window.gameSetupResult.audioManager;
    if (am) am.playTroopSpawn(troop);
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
    // The Ninja's zone rule is inverted: she infiltrates the enemy's back
    // column (col 0 for player2's rear, gs.cols-1 for player1's rear). All
    // other troops deploy on tiles their owner controls via influence.
    let zoneOK;
    if (troopType === "ninja") {
      const enemyBackCol = (owner === "player1") ? gs.cols - 1 : 0;
      zoneOK = inBounds && col === enemyBackCol;
    } else {
      zoneOK = inBounds && tileOwner === owner;
    }

    const def = (this.gameLogic.troopTypes || {})[troopType] || {};
    const cost = def.cost || 0;
    const tpCost = def.tpCost || 0;
    const affordOK = (gs.currentRP[owner] || 0) >= cost
                  && (gs.currentTP[owner] || 0) >= tpCost;

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
    if (this._isRemoteClient()) {
      this._sendAction({ kind: "placeBuilding", row, col, buildingType });
    }
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
   * tile_ownHalf / twoClick targeting from `strategemTypes`. The twoClick
   * UX state (pendingStrategem) stays client-side; only the committed
   * action — with resolved start/end/dir — crosses the wire.
   */
  _tryPlaceStrategem(row, col, owner, strategemType) {
    const gs = this.gameState;
    const def = (this.gameLogic.strategemTypes || {})[strategemType];
    if (!def) return;

    const tpCost = def.tpCost || 0;
    if ((gs.currentTP[owner] || 0) < tpCost) return;

    if (def.cooldown != null && this.strategemSystem && !this.strategemSystem.isReady(owner, strategemType)) {
      return;
    }

    const midCol = Math.floor(gs.cols / 2);
    const inOwnHalf =
      (owner === "player1" && col >= 0 && col < midCol) ||
      (owner === "player2" && col >= midCol && col <= gs.cols - 1);

    if (def.targeting === "tile_ownHalf" && !inOwnHalf) return;

    let params;
    if (def.targeting === "twoClick") {
      if (!this.pendingStrategem) {
        this.pendingStrategem = { strategemType, owner, row, col };
        return;
      }
      const start = this.pendingStrategem;
      const dirCol = col - start.col;
      const dirRow = row - start.row;
      params = {
        owner,
        row: start.row,
        col: start.col,
        dirCol: dirCol || (owner === "player1" ? 1 : -1),
        dirRow: dirRow,
        endCol: col,
        endRow: row,
      };
      this.pendingStrategem = null;
    } else {
      params = { owner, row, col };
    }

    if (this._isRemoteClient()) {
      this._sendAction({ kind: "placeStrategem", strategemType, params });
    }

    this._commitStrategem(owner, strategemType, params);
    this.strategemMode = null;
  }

  /**
   * Final commit step shared by local input and network-applied actions.
   * Re-validates TP/cooldown so a client cannot bypass costs by spoofing
   * the action shape.
   */
  _commitStrategem(owner, strategemType, params) {
    const gs = this.gameState;
    const def = (this.gameLogic.strategemTypes || {})[strategemType] || {};
    const tpCost = def.tpCost || 0;
    if ((gs.currentTP[owner] || 0) < tpCost) return;
    if (def.cooldown != null && this.strategemSystem && !this.strategemSystem.isReady(owner, strategemType)) return;
    const entity = this.strategemSystem.createStrategem(strategemType, params);
    if (!entity) return;
    gs.currentTP[owner] = Math.max(0, (gs.currentTP[owner] || 0) - tpCost);
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
    this._refreshDeckButtonHighlight();
  }

  /**
   * Toggle spawn mode: pressing the same troop deselects; a different troop switches.
   * Shared by keyboard hotkeys 1–4 and the deck button's click handler so mouse
   * and keyboard behave identically.
   */
  toggleSpawnMode(owner, troopType) {
    if (this.spawnMode &&
        this.spawnMode.owner === owner &&
        this.spawnMode.troopType === troopType) {
      this.spawnMode = null;
      this._refreshDeckButtonHighlight();
    } else {
      this.setSpawnMode(owner, troopType);
    }
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
    this._refreshDeckButtonHighlight();
  }

  /**
   * Toggle build mode: pressing the same building deselects; a different one
   * switches. Mirrors toggleSpawnMode so hotkey/mouse behavior stays consistent.
   */
  toggleBuildMode(owner, buildingType) {
    if (this.buildMode &&
        this.buildMode.owner === owner &&
        this.buildMode.buildingType === buildingType) {
      this.buildMode = null;
      this._refreshDeckButtonHighlight();
    } else {
      this.setBuildMode(owner, buildingType);
    }
  }

  /**
   * Set strategem mode for a player. Refused (silent) if the strategem is on
   * cooldown — the user can re-click once the radial sweep clears.
   * @param {string} owner - Player ID
   * @param {string} strategemType - Strategem type
   */
  setStrategemMode(owner, strategemType) {
    const def = (this.gameLogic.strategemTypes || {})[strategemType];
    if (def && def.cooldown != null && this.strategemSystem
        && !this.strategemSystem.isReady(owner, strategemType)) {
      return;
    }
    this.strategemMode = { owner, strategemType };
    this.spawnMode = null;
    this.buildMode = null;
    this.pendingStrategem = null;
    this._refreshDeckButtonHighlight();
  }

  /**
   * Toggle strategem mode: pressing the same strategem deselects; a different
   * one switches. Cooldown gate lives inside setStrategemMode so re-press while
   * cooling is a no-op (not a disarm).
   */
  toggleStrategemMode(owner, strategemType) {
    if (this.strategemMode &&
        this.strategemMode.owner === owner &&
        this.strategemMode.strategemType === strategemType) {
      this.strategemMode = null;
      this._refreshDeckButtonHighlight();
    } else {
      this.setStrategemMode(owner, strategemType);
    }
  }

  /**
   * Clear all modes
   */
  clearModes() {
    this.spawnMode = null;
    this.buildMode = null;
    this.strategemMode = null;
    this.pendingStrategem = null;
    this._refreshDeckButtonHighlight();
  }

  _refreshDeckButtonHighlight() {
    // Owner-scoped so sandbox (both players interactive) doesn't bleed one
    // player's active selection onto the other rail's matching slot.
    const sp = this.spawnMode;       // { owner, troopType } | null
    const bu = this.buildMode;       // { owner, buildingType } | null
    const st = this.strategemMode;   // { owner, strategemType } | null

    document.querySelectorAll(".hotkey-slot").forEach((slot) => {
      const owner = slot.dataset.owner;
      const active =
        (sp && owner === sp.owner && slot.dataset.troopType    === sp.troopType)    ||
        (bu && owner === bu.owner && slot.dataset.buildingType === bu.buildingType) ||
        (st && owner === st.owner && slot.dataset.strategemType === st.strategemType);
      slot.classList.toggle("active", !!active);
    });
  }

  /**
   * Single key handler that fans out across the local player's full deck:
   *   1-6 → troops (4 starting + 1 per intermission, max 6)
   *   7-0 → strategems (2 starting + 1 per intermission, max 4)
   *   < / , → building 1, > / . → building 2 (deck size fixed at 2)
   * Shifted and unshifted punctuation both bind so no Shift is required.
   */
  _setupDeckHotkeys() {
    // Map: keyboard key -> { kind, slot } where slot is the 0-based index into
    // the corresponding deck array.
    const map = {
      "1": { kind: "troop", slot: 0 },
      "2": { kind: "troop", slot: 1 },
      "3": { kind: "troop", slot: 2 },
      "4": { kind: "troop", slot: 3 },
      "5": { kind: "troop", slot: 4 },
      "6": { kind: "troop", slot: 5 },
      "7": { kind: "strategem", slot: 0 },
      "8": { kind: "strategem", slot: 1 },
      "9": { kind: "strategem", slot: 2 },
      "0": { kind: "strategem", slot: 3 },
      ",": { kind: "building", slot: 0 },
      "<": { kind: "building", slot: 0 },
      ".": { kind: "building", slot: 1 },
      ">": { kind: "building", slot: 1 },
    };

    window.addEventListener("keydown", (e) => {
      const entry = map[e.key];
      if (!entry) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

      const gs = this.gameState;
      if (!gs || gs.gameOver) return;

      const localId = (window.networkingSystem && window.networkingSystem.getLocalPlayerId
        && window.networkingSystem.getLocalPlayerId()) || "player1";
      if (!gs.canPlayerAct(localId)) return;

      const ds = window.deckSystem;
      const deck = ds && ds.getPlayerDeck && ds.getPlayerDeck(localId);
      if (!deck) return;

      const arrayKey = entry.kind === "troop" ? "troops"
                     : entry.kind === "building" ? "buildings"
                     : "strategems";
      const item = deck[arrayKey] && deck[arrayKey][entry.slot];
      if (!item) return;

      e.preventDefault();
      if (entry.kind === "troop") this.toggleSpawnMode(localId, item);
      else if (entry.kind === "building") this.toggleBuildMode(localId, item);
      else this.toggleStrategemMode(localId, item);
    });
  }

}

// Export for browser
window.UIState = UIState;

