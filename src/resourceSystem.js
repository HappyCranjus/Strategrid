/**
 * ResourceSystem - Manages resource generation
 * @class
 */
class ResourceSystem {
  constructor(gameState) {
    this.gameState = gameState;
  }

  /**
   * Update resource generation
   * @param {number} deltaTime - Delta time in seconds
   */
  update(deltaTime) {
    if (!this.gameState) return;
    const gs = this.gameState;

    const isSandbox = gs.gameMode === "sandbox";
    const caps = ResourceSystem.PHASE_CAPS[gs.phase] || { rp: 10, tp: 5 };
    const maxTP = isSandbox ? (gs.maxTP.player1 || caps.tp) : caps.tp;
    const [base, scale] = ResourceSystem.PHASE_RATES[gs.phase] || [0, 0];

    // Single pass over the grid: tally current ownership AND count each
    // player's lost initial tiles (initial owner != current owner).
    let p1Tiles = 0, p2Tiles = 0;
    let p1Lost = 0,  p2Lost = 0;
    const initOwners = gs.initialTileOwner || {};
    for (let r = 0; r < gs.rows; r++) {
      for (let c = 0; c < gs.cols; c++) {
        const o = gs.grid[r][c].owner;
        if (o === "player1") p1Tiles++;
        else if (o === "player2") p2Tiles++;

        const initOwner = initOwners[r + "," + c];
        if (initOwner && initOwner !== o) {
          if (initOwner === "player1") p1Lost++;
          else if (initOwner === "player2") p2Lost++;
        }
      }
    }
    const tileCounts = { player1: p1Tiles, player2: p2Tiles };
    const lostCounts = { player1: p1Lost, player2: p2Lost };

    // TP: base 0.125/s (1 TP per 8s). Comeback bonus scales linearly with
    // lost-initial-tile fraction up to +100% at full overrun → 0.25/s cap.
    const TP_BASE = 0.125;
    const rates = {};
    const tpRates = {};

    const am = window.gameSetupResult && window.gameSetupResult.audioManager;
    const localId = (window.networkingSystem && window.networkingSystem.getLocalPlayerId &&
                     window.networkingSystem.getLocalPlayerId()) || "player1";
    const prevRP = gs.currentRP[localId] || 0;
    const prevTP = gs.currentTP[localId] || 0;
    const prevMaxRP = gs.maxRP[localId] || 10;

    for (const player of ["player1", "player2"]) {
      const rate = base;
      rates[player] = rate;
      if (!gs.maxRP[player]) gs.maxRP[player] = 10;
      const rpCap = gs.maxRP[player];
      const newRPVal = (gs.currentRP[player] || 0) + rate * deltaTime;
      if (newRPVal > rpCap) {
        gs.maxRP[player] = rpCap + (newRPVal - rpCap) * 0.40;
        gs.currentRP[player] = gs.maxRP[player];
      } else {
        gs.currentRP[player] = newRPVal;
      }

      const initCount = (gs.initialTileCount && gs.initialTileCount[player]) || 1;
      const tpBonus = TP_BASE * (lostCounts[player] / initCount);
      const tpRate = TP_BASE + tpBonus;
      tpRates[player] = tpRate;
      gs.currentTP[player] = Math.min((gs.currentTP[player] || 0) + tpRate * deltaTime, maxTP);
    }

    if (gs.matchStats) {
      for (const player of ["player1", "player2"]) {
        gs.matchStats[player].rpGenerated += (rates[player]   || 0) * deltaTime;
        gs.matchStats[player].tpGenerated += (tpRates[player] || 0) * deltaTime;
      }
    }

    if (am) {
      const newRP = gs.currentRP[localId];
      const newTP = gs.currentTP[localId];
      if (prevRP < prevMaxRP && newRP >= prevMaxRP)                              am.playSound("fullRP");
      else if (Math.floor(newRP / 5) > Math.floor(prevRP / 5))                  am.playThrottled("rpMilestone", 500);
      if (prevTP < maxTP && newTP >= maxTP)                                      am.playSound("fullTP");
      else if (Math.floor(newTP) > Math.floor(prevTP))                           am.playThrottled("tpGain", 500);
    }

    // Keep gs.maxRP/maxTP in sync so building production caps (buildingSystem
    // reads gs.maxRP[owner]) and any other readers see the phase-aware ceiling.
    // Skip in sandbox so its dev-mode 50/20 caps aren't clobbered.
    if (!isSandbox) {
      gs.maxTP.player1 = gs.maxTP.player2 = maxTP;
    }

    this.renderHUD();
  }

  renderHUD() {
    if (!document) return;
    const gs = this.gameState;
    if (!gs) return;

    let p1Tiles = 0, p2Tiles = 0;
    for (let r = 0; r < gs.rows; r++) {
      for (let c = 0; c < gs.cols; c++) {
        const o = gs.grid[r][c].owner;
        if (o === "player1") p1Tiles++;
        else if (o === "player2") p2Tiles++;
      }
    }
    const tileCounts = { player1: p1Tiles, player2: p2Tiles };

    const isSandbox = gs.gameMode === "sandbox";
    const caps = ResourceSystem.PHASE_CAPS[gs.phase] || { rp: 10, tp: 5 };
    const maxTP = isSandbox ? (gs.maxTP.player1 || caps.tp) : caps.tp;
    const [base, scale] = ResourceSystem.PHASE_RATES[gs.phase] || [0, 0];

    const localId = (window.networkingSystem && window.networkingSystem.getLocalPlayerId &&
                     window.networkingSystem.getLocalPlayerId()) || "player1";
    const oppId = localId === "player1" ? "player2" : "player1";

    const maxRPPlayer = gs.maxRP[localId] || 10;
    const maxRPOpp    = gs.maxRP[oppId]   || 10;

    this._updateBar("rpBarPlayer",   gs.currentRP[localId], maxRPPlayer);
    this._updateBar("tpBarPlayer",   gs.currentTP[localId], maxTP);
    this._updateBar("rpBarOpponent", gs.currentRP[oppId],   maxRPOpp);
    this._updateBar("tpBarOpponent", gs.currentTP[oppId],   maxTP);

    this._setText("rpValuePlayer",   (gs.currentRP[localId] || 0).toFixed(1));
    this._setText("rpValueOpponent", (gs.currentRP[oppId]   || 0).toFixed(1));
    this._setText("rpRatePlayer",   "+" + base.toFixed(2));
    this._setText("rpRateOpponent", "+" + base.toFixed(2));
    this._setText("tpValuePlayer",   (gs.currentTP[localId] || 0).toFixed(1));
    this._setText("tpValueOpponent", (gs.currentTP[oppId]   || 0).toFixed(1));
    this._setText("tilesPlayer",   tileCounts[localId]);
    this._setText("tilesOpponent", tileCounts[oppId]);
    this._setText("scorePlayer",   tileCounts[localId]);
    this._setText("scoreOpponent", tileCounts[oppId]);
  }

  _updateBar(barId, value, max) {
    const bar = document.getElementById(barId);
    if (bar) bar.style.width = ((value / max) * 100).toFixed(1) + "%";
  }

  _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(text);
  }
}

ResourceSystem.PHASE_RATES = {
  opening:       [0.50,  0.0021],
  assault:       [0.75,  0.0035],
  endgame:       [1.00,  0.0049],
  intermission1: [0,     0],
  intermission2: [0,     0],
};

// Caps grow with the game so RP feels less "always full" and TP can be
// stockpiled for combos late. Intermissions inherit the prior phase's cap.
ResourceSystem.PHASE_CAPS = {
  opening:       { rp: 10, tp: 5   },
  intermission1: { rp: 10, tp: 5   },
  assault:       { rp: 15, tp: 7.5 },
  intermission2: { rp: 15, tp: 7.5 },
  endgame:       { rp: 20, tp: 10  },
};

// Export for browser
window.ResourceSystem = ResourceSystem;

