/**
 * AIController - Drives player2 in PvC mode.
 *
 * Per-frame ticks three loops:
 *   1. Phase-transition watcher: on entry to intermission1 / intermission2,
 *      pick a random new troop and strategem and append to player2's deck via
 *      deckSystem.addTroop / addStrategem.
 *   2. Spawn campaigns (active only during opening / assault / endgame):
 *      re-roll a {slot 1-4, rate 1-4/sec, duration 1-4s} triple whenever the
 *      previous campaign expires, then attempt N spawns per second of the
 *      chosen deck-slot troop on a uniformly-random player2-owned tile.
 *   3. Strategem casts: each frame, attempt every deck strategem that's off
 *      cooldown and affordable, picking random params per targeting type.
 *   4. Hero ability: spam tryActivateHeroAbility — the system gates internally.
 *
 * All gameplay calls go through the same headless-safe APIs the human UI uses
 * (uiState._trySpawnTroop, strategemSystem.createStrategem,
 * strategemSystem.tryActivateHeroAbility), so resource decrement and cooldown
 * arming happen exactly once per action.
 *
 * @class
 */

const ACTIVE_PHASES = new Set(["opening", "assault", "endgame"]);
const INTERMISSION_PHASES = new Set(["intermission1", "intermission2"]);
const TWO_CLICK_STRATEGEMS = new Set(["wind", "lesserTeleport", "greaterTeleport"]);

const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

class AIController {
  constructor(gameState, gameLogic, deckSystem, strategemSystem, uiState) {
    this.gameState = gameState;
    this.gameLogic = gameLogic;
    this.deckSystem = deckSystem;
    this.strategemSystem = strategemSystem;
    this.uiState = uiState;

    this.owner = "player2";
    this.lastPhase = null;
    this.campaign = null; // { troopType, rate, remainingDur, accum }
  }

  update(dt) {
    const gs = this.gameState;
    if (!gs || gs.gameOver) return;

    this._watchPhase();

    if (ACTIVE_PHASES.has(gs.phase)) {
      this._tickSpawnCampaign(dt);
      this._tickStrategems();
      this._tickHeroAbility();
    }
  }

  _watchPhase() {
    const gs = this.gameState;
    const phase = gs.phase;
    if (phase === this.lastPhase) return;
    if (INTERMISSION_PHASES.has(phase)) {
      this._aiPickIntermission();
      this.campaign = null; // re-roll fresh on next active phase
    }
    this.lastPhase = phase;
  }

  /**
   * Pick one un-owned troop and one un-owned strategem, append to player2's
   * deck. Silently skips if no candidates remain (unlikely for 7 troops / 12
   * strategems vs. starting 4 / 2).
   */
  _aiPickIntermission() {
    const ds = this.deckSystem;
    if (!ds) return;
    const deck = ds.getPlayerDeck(this.owner);
    if (!deck) return;

    const troopPool = ds.getAvailableTroops().filter((t) => !deck.troops.includes(t));
    const stratPool = ds.getAvailableStrategems().filter((s) => !deck.strategems.includes(s));
    if (troopPool.length) {
      ds.addTroop(this.owner, troopPool[Math.floor(Math.random() * troopPool.length)]);
    }
    if (stratPool.length) {
      ds.addStrategem(this.owner, stratPool[Math.floor(Math.random() * stratPool.length)]);
    }
  }

  _tickSpawnCampaign(dt) {
    const deck = this.deckSystem && this.deckSystem.getPlayerDeck(this.owner);
    if (!deck || !deck.troops || deck.troops.length === 0) return;

    if (!this.campaign || this.campaign.remainingDur <= 0) {
      // Random deck slot. Bound by current deck size so post-intermission picks
      // (deck grows 4 → 5 → 6) get rolled into the AI's repertoire.
      const slot = randInt(1, deck.troops.length);
      this.campaign = {
        troopType: deck.troops[slot - 1],
        rate: randInt(1, 4),
        remainingDur: randInt(1, 4),
        accum: 0,
      };
    }

    const c = this.campaign;
    c.accum += dt;
    const interval = 1 / c.rate;
    while (c.accum >= interval) {
      this._attemptSpawn(c.troopType);
      c.accum -= interval;
    }
    c.remainingDur -= dt;
  }

  _attemptSpawn(troopType) {
    const gs = this.gameState;
    const def = (this.gameLogic.troopTypes || {})[troopType];
    if (!def) return;
    if ((gs.currentRP[this.owner] || 0) < (def.cost || 0)) return;
    if ((gs.currentTP[this.owner] || 0) < (def.tpCost || 0)) return;

    // Ninjas deploy in the enemy's back column (inverted zone) — the standard
    // _randomOwnedTile picker would never produce a legal tile for them.
    const tile = (troopType === "ninja")
      ? this._randomEnemyBackColTile()
      : this._randomOwnedTile();
    if (!tile) return;

    this.uiState._trySpawnTroop(tile.row, tile.col, this.owner, troopType);
  }

  _randomEnemyBackColTile() {
    const gs = this.gameState;
    const col = (this.owner === "player1") ? gs.cols - 1 : 0;
    const row = Math.floor(Math.random() * gs.rows);
    return { row, col };
  }

  _randomOwnedTile() {
    const gs = this.gameState;
    const tiles = [];
    for (let r = 0; r < gs.rows; r++) {
      for (let c = 0; c < gs.cols; c++) {
        if (gs.grid[r][c].owner === this.owner) tiles.push({ row: r, col: c });
      }
    }
    if (tiles.length === 0) return null;
    return tiles[Math.floor(Math.random() * tiles.length)];
  }

  _randomEnemyTile() {
    const gs = this.gameState;
    const enemy = this.owner === "player1" ? "player2" : "player1";
    const tiles = [];
    for (let r = 0; r < gs.rows; r++) {
      for (let c = 0; c < gs.cols; c++) {
        if (gs.grid[r][c].owner === enemy) tiles.push({ row: r, col: c });
      }
    }
    if (tiles.length === 0) return null;
    return tiles[Math.floor(Math.random() * tiles.length)];
  }

  _tickStrategems() {
    const gs = this.gameState;
    const ss = this.strategemSystem;
    if (!ss) return;
    const deck = this.deckSystem && this.deckSystem.getPlayerDeck(this.owner);
    if (!deck || !deck.strategems) return;

    for (const type of deck.strategems) {
      const def = (this.gameLogic.strategemTypes || {})[type];
      if (!def) continue;
      if (def.cooldown != null && !ss.isReady(this.owner, type)) continue;
      const tpCost = def.tpCost || 0;
      if ((gs.currentTP[this.owner] || 0) < tpCost) continue;

      const params = this._buildCastParams(type, def);
      if (!params) continue;

      const entity = ss.createStrategem(type, params);
      if (entity) {
        gs.currentTP[this.owner] = Math.max(0, (gs.currentTP[this.owner] || 0) - tpCost);
      }
    }
  }

  _buildCastParams(type, def) {
    const start = this._randomOwnedTile();
    if (!start) return null;

    if (def.targeting === "twoClick" || TWO_CLICK_STRATEGEMS.has(type)) {
      // Aim toward a random enemy tile if any exist, else toward map center
      // in the enemy's direction. Direction vector is the displacement, not
      // normalized — _tryPlaceStrategem feeds it raw and the systems handle it.
      const end = this._randomEnemyTile() || {
        row: start.row,
        col: this.owner === "player2" ? 0 : this.gameState.cols - 1,
      };
      const dirCol = end.col - start.col;
      const dirRow = end.row - start.row;
      return {
        owner: this.owner,
        row: start.row,
        col: start.col,
        dirCol: dirCol || (this.owner === "player2" ? -1 : 1),
        dirRow: dirRow,
        endCol: end.col,
        endRow: end.row,
      };
    }

    return { owner: this.owner, row: start.row, col: start.col };
  }

  _tickHeroAbility() {
    if (!this.strategemSystem) return;
    this.strategemSystem.tryActivateHeroAbility(this.owner);
  }
}

window.AIController = AIController;
