/**
 * trainBot.js — Self-play learning bot for the training dashboard.
 *
 * Uses a per-tile Q-value bandit to learn which spawn positions correlate
 * with wins. UCB1 exploration ensures the bot tries all positions, then
 * gradually concentrates on the ones that led to wins.
 *
 * Also performs hill-climbing on the 5 evaluation-function weights every
 * 10 episodes, so the displayed weight bars visibly shift as the AI learns
 * which game aspects (hero HP, tiles, etc.) matter most.
 */

const TWO_CLICK_STRATS = new Set(["wind", "lesserTeleport", "greaterTeleport"]);

class TrainBot {
  constructor(player) {
    this.player   = player;
    this.opponent = player === "player1" ? "player2" : "player1";

    // 5-component evaluation weights — these evolve via hill-climbing.
    this.weights = { heroHp: 0.25, tiles: 0.30, resources: 0.10, mass: 0.20, front: 0.15 };

    // Per-tile Q-value table (lazy-init when first game state is seen).
    this._qTable   = null; // Float32Array[row][col]
    this._visits   = null; // Uint32Array[row][col]
    this._totalVis = 0;

    // Spawn positions chosen this episode, used for Q-value update.
    this._episodeSpawns = [];

    // Rolling win history for weight evolution.
    this._recentOutcomes = []; // 1 = win, 0 = loss
    this._episodeCount   = 0;

    // Last computed heatmap exposed for the overlay.
    this.lastHeatmap = [];
    this.lastBest    = null;
  }

  // ── Initialization ────────────────────────────────────────────────────────

  _initTables(rows, cols) {
    if (this._qTable) return;
    this._qTable  = Array.from({ length: rows }, () => new Float32Array(cols).fill(0));
    this._visits  = Array.from({ length: rows }, () => new Uint32Array(cols).fill(0));
  }

  // ── Core evaluation (mirrors headlessGame.js evaluate()) ─────────────────

  _evaluate(gs) {
    const p = this.player, opp = this.opponent, w = this.weights;

    const myHero  = p === "player1" ? gs.hero1 : gs.hero2;
    const oppHero = p === "player1" ? gs.hero2 : gs.hero1;
    const myHpF   = (myHero  && myHero.maxHp)  ? myHero.hp  / myHero.maxHp  : 0;
    const oppHpF  = (oppHero && oppHero.maxHp) ? oppHero.hp / oppHero.maxHp : 0;

    let myTiles = 0, oppTiles = 0;
    for (let r = 0; r < gs.rows; r++)
      for (let c = 0; c < gs.cols; c++) {
        const o = gs.grid[r][c].owner;
        if (o === p) myTiles++; else if (o === opp) oppTiles++;
      }

    const myRes  = (gs.currentRP[p]   || 0) + (gs.currentTP[p]   || 0);
    const oppRes = (gs.currentRP[opp] || 0) + (gs.currentTP[opp] || 0);
    const maxRes = (gs.maxRP[p] || 20) + (gs.maxTP[p] || 10);

    let myMass = 0, oppMass = 0, myFS = 0, myFC = 0, oppFS = 0, oppFC = 0;
    for (const t of gs.troops) {
      if (!t || t.hp <= 0 || t.isHero) continue;
      const hf    = t.maxHp ? t.hp / t.maxHp : 0.5;
      const depth = p === "player1" ? t.col / (gs.cols - 1) : 1 - t.col / (gs.cols - 1);
      if (t.owner === p)   { myMass  += hf; myFS  += depth; myFC++;  }
      else if (t.owner === opp) { oppMass += hf; oppFS += depth; oppFC++; }
    }
    const maxMass = Math.max(myMass + oppMass, 1);
    const myFront  = myFC  ? myFS  / myFC  : 0.5;
    const oppFront = oppFC ? oppFS / oppFC : 0.5;

    return w.heroHp    * (myHpF  - oppHpF)
         + w.tiles     * (myTiles - oppTiles) / (gs.rows * gs.cols)
         + w.resources * (myRes - oppRes)   / (maxRes || 1)
         + w.mass      * (myMass - oppMass) / maxMass
         + w.front     * (myFront - oppFront);
  }

  // ── Candidate scoring (UCB1 bandit on tile positions) ────────────────────

  _pickSpawn(gs, gl, ds) {
    this._initTables(gs.rows, gs.cols);
    const deck = ds && ds.getPlayerDeck(this.player);
    if (!deck || !deck.troops || !deck.troops.length) return { candidates: [], chosen: null };

    // Pick a random deck slot each call for variety, but bias affordable troops.
    const affordable = deck.troops.filter(type => {
      const def = gl.troopTypes && gl.troopTypes[type];
      return def && (gs.currentRP[this.player] || 0) >= (def.cost || 0)
                 && (gs.currentTP[this.player] || 0) >= (def.tpCost || 0);
    });
    if (!affordable.length) return { candidates: [], chosen: null };
    const troopType = affordable[Math.floor(Math.random() * affordable.length)];

    const C = 1.4;
    const logTotal = Math.log(this._totalVis + 1);
    const candidates = [];

    for (let r = 0; r < gs.rows; r++) {
      for (let c = 0; c < gs.cols; c++) {
        if (gs.grid[r][c].owner !== this.player) continue;
        const elig = window.gameActions.checkSpawnLegality(gs, gl, c, r, this.player, troopType);
        if (!elig.zoneOK || !elig.affordOK) continue;

        const q   = this._qTable[r][c];
        const n   = this._visits[r][c];
        const ucb = q + C * Math.sqrt(logTotal / (n + 1));
        candidates.push({ row: r, col: c, troopType, q, ucb });
      }
    }

    if (!candidates.length) return { candidates: [], chosen: null };

    // Sort by UCB1 descending; pick the best as chosen action.
    candidates.sort((a, b) => b.ucb - a.ucb);
    const chosen = candidates[0];
    return { candidates, chosen };
  }

  // ── Main decide method ────────────────────────────────────────────────────

  decide(gs, gl, ds, ss, dt) {
    this._initTables(gs.rows, gs.cols);

    // Troop spawn
    const { candidates, chosen } = this._pickSpawn(gs, gl, ds);
    if (chosen) {
      const ok = window.gameActions.spawnTroop(gs, gl, chosen.row, chosen.col, this.player, chosen.troopType);
      if (ok) {
        this._episodeSpawns.push({ row: chosen.row, col: chosen.col });
        this._visits[chosen.row][chosen.col]++;
        this._totalVis++;
      }
    }

    // Hero movement toward opponent hero
    this._moveHero(gs, dt || 1 / 30);

    // Hero ability
    if (ss) ss.tryActivateHeroAbility(this.player);

    // Strategems
    this._tickStrategems(gs, gl, ds, ss);

    // Build heatmap from Q-values (top candidates for overlay)
    this.lastHeatmap = candidates.slice(0, 50).map(c => ({
      row: c.row, col: c.col,
      q: c.q,
      isBest: chosen && c.row === chosen.row && c.col === chosen.col,
    }));
    this.lastBest = chosen;

    return this.lastHeatmap;
  }

  // ── Learning update (called after each episode) ───────────────────────────

  onGameOver(winner) {
    const won    = winner === this.player;
    const reward = won ? 1 : -1;
    const lr     = 0.12; // learning rate

    for (const { row, col } of this._episodeSpawns) {
      this._qTable[row][col] = this._qTable[row][col] * (1 - lr) + reward * lr;
    }
    this._episodeSpawns = [];

    this._recentOutcomes.push(won ? 1 : 0);
    if (this._recentOutcomes.length > 20) this._recentOutcomes.shift();

    this._episodeCount++;
    if (this._episodeCount % 10 === 0) this._evolveWeights();
  }

  // ── Weight hill-climbing ──────────────────────────────────────────────────

  _evolveWeights() {
    const wr = this._recentOutcomes.length
      ? this._recentOutcomes.reduce((s, x) => s + x, 0) / this._recentOutcomes.length
      : 0.5;

    // Only mutate if win rate is below 60% — above that the bot is doing well.
    if (wr >= 0.60) return;

    const keys = Object.keys(this.weights);
    const key  = keys[Math.floor(Math.random() * keys.length)];
    this.weights[key] = Math.max(0.03, Math.min(0.55, this.weights[key] + (Math.random() - 0.5) * 0.06));

    // Renormalize so weights sum to 1.
    const total = Object.values(this.weights).reduce((s, v) => s + v, 0);
    for (const k of keys) this.weights[k] /= total;
  }

  // ── Hero movement ─────────────────────────────────────────────────────────

  _moveHero(gs, dt) {
    const hero    = this.player === "player1" ? gs.hero1 : gs.hero2;
    const oppHero = this.player === "player1" ? gs.hero2 : gs.hero1;
    if (!hero || hero.hp <= 0) return;

    const targetCol = (oppHero && oppHero.hp > 0) ? oppHero.col : (this.player === "player1" ? gs.cols - 1 : 0);
    const targetRow = (oppHero && oppHero.hp > 0) ? oppHero.row : hero.row;
    const dxR = targetCol - hero.col, dyR = targetRow - hero.row;
    const len = Math.sqrt(dxR * dxR + dyR * dyR);
    if (len < 0.5) return;
    const step = (hero.speed || 0) * dt;
    hero.col = Math.max(0.5, Math.min(gs.cols - 1.5, hero.col + (dxR / len) * step));
    hero.row = Math.max(0.5, Math.min(gs.rows - 1.5, hero.row + (dyR / len) * step));
    hero.target = null;
  }

  // ── Strategem spam ────────────────────────────────────────────────────────

  _tickStrategems(gs, gl, ds, ss) {
    if (!ss) return;
    const deck = ds && ds.getPlayerDeck(this.player);
    if (!deck || !deck.strategems) return;

    for (const type of deck.strategems) {
      const def = (gl.strategemTypes || {})[type];
      if (!def) continue;
      if (def.cooldown != null && !ss.isReady(this.player, type)) continue;
      const tpCost = def.tpCost || 0;
      if ((gs.currentTP[this.player] || 0) < tpCost) continue;
      const params = this._buildCastParams(gs, type, def);
      if (!params) continue;
      const entity = ss.createStrategem(type, params);
      if (entity) gs.currentTP[this.player] = Math.max(0, (gs.currentTP[this.player] || 0) - tpCost);
    }
  }

  _buildCastParams(gs, type, def) {
    const start = this._randomOwnedTile(gs);
    if (!start) return null;

    if (def.targeting === "twoClick" || TWO_CLICK_STRATS.has(type)) {
      const end = this._randomEnemyTile(gs) || {
        row: start.row,
        col: this.player === "player2" ? 0 : gs.cols - 1,
      };
      return {
        owner: this.player,
        row: start.row, col: start.col,
        dirCol: (end.col - start.col) || (this.player === "player2" ? -1 : 1),
        dirRow: end.row - start.row,
        endCol: end.col, endRow: end.row,
      };
    }
    if (def.targeting === "tile_ownHalf") {
      const mid = Math.floor(gs.cols / 2);
      const inHalf = this.player === "player1" ? start.col < mid : start.col >= mid;
      if (!inHalf) return null;
    }
    return { owner: this.player, row: start.row, col: start.col };
  }

  _randomOwnedTile(gs) {
    const tiles = [];
    for (let r = 0; r < gs.rows; r++)
      for (let c = 0; c < gs.cols; c++)
        if (gs.grid[r][c].owner === this.player) tiles.push({ row: r, col: c });
    return tiles.length ? tiles[Math.floor(Math.random() * tiles.length)] : null;
  }

  _randomEnemyTile(gs) {
    const tiles = [];
    for (let r = 0; r < gs.rows; r++)
      for (let c = 0; c < gs.cols; c++)
        if (gs.grid[r][c].owner === this.opponent) tiles.push({ row: r, col: c });
    return tiles.length ? tiles[Math.floor(Math.random() * tiles.length)] : null;
  }

  // ── Accessors for the UI ──────────────────────────────────────────────────

  get winRate() {
    if (!this._recentOutcomes.length) return null;
    return this._recentOutcomes.reduce((s, x) => s + x, 0) / this._recentOutcomes.length;
  }
}

window.TrainBot = TrainBot;
