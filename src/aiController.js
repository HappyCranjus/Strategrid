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

class AIController {
  constructor(gameState, gameLogic, deckSystem, strategemSystem, uiState, rng = Math.random.bind(Math)) {
    this.gameState = gameState;
    this.gameLogic = gameLogic;
    this.deckSystem = deckSystem;
    this.strategemSystem = strategemSystem;
    this.uiState = uiState;
    this.rng = rng;

    this.owner = "player2";
    this.lastPhase = null;
    this.campaign = null; // { troopType, rate, remainingDur, accum }

    // Load trained data from localStorage (written by train.html).
    // If present, spawn decisions and hero policy use the learned Q-values.
    this._trained = this._loadTrainedData();
  }

  _loadTrainedData() {
    try {
      const raw = localStorage.getItem("strategrid_training_v1");
      if (!raw) return null;
      const save = JSON.parse(raw);
      // Training always runs player2 as Red; use bot2's save.
      return save.bot2 || null;
    } catch (e) { return null; }
  }

  _randInt(lo, hi) { return lo + Math.floor(this.rng() * (hi - lo + 1)); }

  update(dt) {
    const gs = this.gameState;
    if (!gs || gs.gameOver) return;

    this._watchPhase();

    if (ACTIVE_PHASES.has(gs.phase)) {
      this._tickSpawnCampaign(dt);
      this._tickBuildings(dt);
      this._tickStrategems();
      this._tickHeroAbility();
      this._tickHeroMovement(dt);
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
      ds.addTroop(this.owner, troopPool[Math.floor(this.rng() * troopPool.length)]);
    }
    if (stratPool.length) {
      ds.addStrategem(this.owner, stratPool[Math.floor(this.rng() * stratPool.length)]);
    }
  }

  _tickSpawnCampaign(dt) {
    const deck = this.deckSystem && this.deckSystem.getPlayerDeck(this.owner);
    if (!deck || !deck.troops || deck.troops.length === 0) return;

    if (!this.campaign || this.campaign.remainingDur <= 0) {
      // Random deck slot. Bound by current deck size so post-intermission picks
      // (deck grows 4 → 5 → 6) get rolled into the AI's repertoire.
      const slot = this._randInt(1, deck.troops.length);
      this.campaign = {
        troopType: deck.troops[slot - 1],
        rate: this._randInt(1, 4),
        remainingDur: this._randInt(1, 4),
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
    const row = Math.floor(this.rng() * gs.rows);
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
    if (!tiles.length) return null;

    // Neural network takes priority when weights are loaded.
    const nn = window.nnBot;
    if (nn && nn._loaded) {
      const tile = nn.pickSpawnTile(gs, this.owner, this.gameLogic, this.deckSystem);
      if (tile) return tile;
    }

    // Fallback: Q-value bandit from localStorage training session.
    const td = this._trained;
    if (td && td.qTable && td.rows && td.cols) {
      const { qTable, rows, cols } = td;
      tiles.sort((a, b) => {
        const qa = (a.row < rows && a.col < cols) ? (qTable[a.row * cols + a.col] || 0) : 0;
        const qb = (b.row < rows && b.col < cols) ? (qTable[b.row * cols + b.col] || 0) : 0;
        return qb - qa;
      });
      // Pick from top 3 so the AI isn't completely deterministic.
      return tiles[Math.floor(this.rng() * Math.min(3, tiles.length))];
    }

    // Untrained fallback: frontline bias.
    tiles.sort((a, b) => this.owner === "player1" ? b.col - a.col : a.col - b.col);
    if (this.rng() < 0.6) {
      const frontN = Math.max(1, Math.ceil(tiles.length * 0.3));
      return tiles[Math.floor(this.rng() * frontN)];
    }
    return tiles[Math.floor(this.rng() * tiles.length)];
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
    return tiles[Math.floor(this.rng() * tiles.length)];
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

  _tickHeroMovement(dt) {
    const gs   = this.gameState;
    const hero = this.owner === "player1" ? gs.hero1 : gs.hero2;
    if (!hero || hero.hp <= 0) return;

    const hp = window.HeroPolicies;
    if (!hp) return;

    const hpFrac = hero.maxHp ? hero.hp / hero.maxHp : 1;

    // Policy selection: use trained policy Q-values if available,
    // otherwise fall back to rule-based heuristic.
    let policyKey;
    if (hpFrac < 0.25) {
      policyKey = "retreat"; // safety override always wins
    } else {
      const td = this._trained;
      if (td && td.policyQ && td.policyQ.length > 0) {
        const keys = window.HeroPolicies.KEYS;
        let bestIdx = 0, bestQ = -Infinity;
        for (let i = 0; i < Math.min(td.policyQ.length, keys.length); i++) {
          if ((td.policyQ[i] || 0) > bestQ) { bestQ = td.policyQ[i]; bestIdx = i; }
        }
        policyKey = keys[bestIdx];
      } else {
        // Untrained heuristic: pressure towers mid-game, hunt hero in endgame.
        policyKey = gs.phase === "endgame" ? "targetHero" : "targetWeakestTower";
      }
    }

    const target = hp[policyKey](gs, this.owner, hero);
    if (!target) return;

    const dxRaw = target.targetCol - hero.col, dyRaw = target.targetRow - hero.row;
    const len   = Math.sqrt(dxRaw * dxRaw + dyRaw * dyRaw);
    if (len < 0.5) return;
    const step = (hero.speed || 0) * dt;
    hero.col = Math.max(0.5, Math.min(gs.cols - 1.5, hero.col + (dxRaw / len) * step));
    hero.row = Math.max(0.5, Math.min(gs.rows - 1.5, hero.row + (dyRaw / len) * step));
    hero.target = null;
  }

  _tickBuildings(dt) {
    const gs = this.gameState;
    this._buildTimer = (this._buildTimer || 0) - dt;
    if (this._buildTimer > 0) return;
    this._buildTimer = 7 + this.rng() * 5; // attempt every ~7-12 game seconds

    const deck = this.deckSystem && this.deckSystem.getPlayerDeck(this.owner);
    if (!deck?.buildings?.length) return;
    const gl = this.gameLogic;

    for (const type of deck.buildings) {
      const def = (gl.buildingTypes || {})[type];
      if (!def) continue;
      if ((gs.currentRP[this.owner] || 0) < (def.cost || 0)) continue;

      const tiles = this._buildingCandidates(type);
      for (const tile of tiles) {
        if (window.gameActions.placeBuilding(gs, gl, tile.row, tile.col, this.owner, type)) {
          return; // placed one; wait for next timer
        }
      }
    }
  }

  _buildingCandidates(type) {
    const gs      = this.gameState;
    const midCol  = Math.floor(gs.cols / 2);
    const isTower = /turret|cannon|mortar|mage/i.test(type);
    const tiles   = [];

    for (let r = 0; r < gs.rows; r++) {
      for (let c = 0; c < gs.cols; c++) {
        if (gs.grid[r][c].owner !== this.owner) continue;
        if (this.owner === "player1" && (c < 1 || c >= midCol)) continue;
        if (this.owner === "player2" && (c < midCol || c > gs.cols - 2)) continue;
        tiles.push({ row: r, col: c });
      }
    }

    // Towers: frontline first.  Bunkers/factories: near midline.
    tiles.sort((a, b) => {
      if (isTower) return this.owner === "player1" ? b.col - a.col : a.col - b.col;
      const dA = Math.abs(a.col - midCol), dB = Math.abs(b.col - midCol);
      return dA - dB;
    });

    return tiles.slice(0, 10);
  }
}

window.AIController = AIController;
