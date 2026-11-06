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

      const ls = window.lockstepSystem;

      if (this.spawnMode) {
        if (ls) {
          ls.queueInput({ kind: "spawnTroop", row, col, troopType: this.spawnMode.troopType });
        } else {
          this._trySpawnTroop(row, col, this.spawnMode.owner, this.spawnMode.troopType);
        }
      } else if (this.buildMode) {
        if (ls) {
          ls.queueInput({ kind: "placeBuilding", row, col, buildingType: this.buildMode.buildingType });
        } else {
          this._tryPlaceBuilding(row, col, this.buildMode.owner, this.buildMode.buildingType);
        }
      } else if (this.strategemMode) {
        // Two-click strategems: manage pending state locally, queue only the final commit.
        this._tryPlaceStrategemLockstep(row, col, this.strategemMode.owner, this.strategemMode.strategemType, ls);
      }
    });
  }

  /**
   * Strategem placement that is lockstep-aware. Single-click strategems queue
   * directly; two-click strategems (twoClick targeting) manage pendingStrategem
   * state locally and queue the resolved params on the second click.
   */
  _tryPlaceStrategemLockstep(row, col, owner, strategemType, ls) {
    if (!ls) {
      this._tryPlaceStrategem(row, col, owner, strategemType);
      return;
    }

    const gs = this.gameState;
    const def = (this.gameLogic.strategemTypes || {})[strategemType];
    if (!def) return;

    if (def.targeting === "twoClick") {
      if (!this.pendingStrategem) {
        this.pendingStrategem = { strategemType, owner, row, col };
        return;
      }
      const start = this.pendingStrategem;
      const dirCol = col - start.col;
      const dirRow = row - start.row;
      const params = {
        owner,
        row: start.row,
        col: start.col,
        dirCol: dirCol || (owner === "player1" ? 1 : -1),
        dirRow,
        endCol: col,
        endRow: row,
      };
      this.pendingStrategem = null;
      ls.queueInput({ kind: "placeStrategem", strategemType, params });
      this.strategemMode = null;
    } else {
      const midCol = Math.floor(gs.cols / 2);
      const inOwnHalf =
        (owner === "player1" && col >= 0 && col < midCol) ||
        (owner === "player2" && col >= midCol && col <= gs.cols - 1);
      if (def.targeting === "tile_ownHalf" && !inOwnHalf) return;

      ls.queueInput({ kind: "placeStrategem", strategemType, params: { owner, row, col } });
      this.strategemMode = null;
    }
  }

  _trySpawnTroop(row, col, owner, troopType) {
    if (this._isRemoteClient()) {
      this._sendAction({ kind: "spawnTroop", row, col, troopType });
    }
    const ok = window.gameActions.spawnTroop(this.gameState, this.gameLogic, row, col, owner, troopType);
    if (ok) {
      const am = window.gameSetupResult?.audioManager;
      if (am) am.playTroopSpawn({ type: troopType });
    }
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
    return window.gameActions.checkSpawnLegality(this.gameState, this.gameLogic, col, row, owner, troopType);
  }

  _tryPlaceBuilding(row, col, owner, buildingType) {
    if (this._isRemoteClient()) {
      this._sendAction({ kind: "placeBuilding", row, col, buildingType });
    }
    const ok = window.gameActions.placeBuilding(this.gameState, this.gameLogic, row, col, owner, buildingType);
    if (ok) this.buildMode = null;
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
    window.gameActions.commitStrategem(this.gameState, this.gameLogic, this.strategemSystem, owner, strategemType, params);
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

