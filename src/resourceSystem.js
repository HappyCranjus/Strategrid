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

    // Phase-keyed caps grow with the game; phase-keyed RP rates unchanged.
    // Intermissions hold the prior phase's cap so the bar doesn't jump mid-draft.
    // Sandbox sets its own 50/20 caps at startup — defer to the gs value there
    // instead of overwriting every frame.
    const isSandbox = gs.gameMode === "sandbox";
    const caps = ResourceSystem.PHASE_CAPS[gs.phase] || { rp: 10, tp: 5 };
    const maxRP = isSandbox ? (gs.maxRP.player1 || caps.rp) : caps.rp;
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
    for (const player of ["player1", "player2"]) {
      const rate = base + scale * tileCounts[player];
      rates[player] = rate;
      gs.currentRP[player] = Math.min((gs.currentRP[player] || 0) + rate * deltaTime, maxRP);

      const initCount = (gs.initialTileCount && gs.initialTileCount[player]) || 1;
      const tpBonus = TP_BASE * (lostCounts[player] / initCount);
      const tpRate = TP_BASE + tpBonus;
      tpRates[player] = tpRate;
      gs.currentTP[player] = Math.min((gs.currentTP[player] || 0) + tpRate * deltaTime, maxTP);
    }

    // Keep gs.maxRP/maxTP in sync so building production caps (buildingSystem
    // reads gs.maxRP[owner]) and any other readers see the phase-aware ceiling.
    // Skip in sandbox so its dev-mode 50/20 caps aren't clobbered.
    if (!isSandbox) {
      gs.maxRP.player1 = gs.maxRP.player2 = maxRP;
      gs.maxTP.player1 = gs.maxTP.player2 = maxTP;
    }

    // Update HTML resource bars. The local-vs-opponent mapping is wired in Phase C
    // once networkingSystem reports who the local player is. For Phase A we assume
    // the local side is "player1" so the bars at least populate during single-window tests.
    const localId = (window.networkingSystem && window.networkingSystem.getLocalPlayerId &&
                     window.networkingSystem.getLocalPlayerId()) || "player1";
    const oppId = localId === "player1" ? "player2" : "player1";

    this._updateBar("rpBarPlayer",   gs.currentRP[localId], maxRP);
    this._updateBar("tpBarPlayer",   gs.currentTP[localId], maxTP);
    this._updateBar("rpBarOpponent", gs.currentRP[oppId],   maxRP);
    this._updateBar("tpBarOpponent", gs.currentTP[oppId],   maxTP);

    this._setText("rpValuePlayer",   gs.currentRP[localId].toFixed(1));
    this._setText("rpValueOpponent", gs.currentRP[oppId].toFixed(1));
    this._setText("rpRatePlayer",   "+" + rates[localId].toFixed(2));
    this._setText("rpRateOpponent", "+" + rates[oppId].toFixed(2));
    this._setText("tpValuePlayer",   gs.currentTP[localId].toFixed(1));
    this._setText("tpValueOpponent", gs.currentTP[oppId].toFixed(1));
    this._setText("tilesPlayer",   tileCounts[localId]);
    this._setText("tilesOpponent", tileCounts[oppId]);
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
  opening:       [0.70,  0.0021],
  assault:       [0.875, 0.0035],
  endgame:       [1.40,  0.0049],
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

