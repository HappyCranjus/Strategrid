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
    const maxRP = 10;
    const maxTP = 5;

    // Phase-keyed [base, scalePerTile]. Intermissions pause RP generation while
    // players pick from the roster; flip to opening/assault rates to carry over.
    const [base, scale] = ResourceSystem.PHASE_RATES[gs.phase] || [0, 0];

    // Tally tile ownership across the 16x18 grid (288 cells; cheap per frame).
    let p1Tiles = 0;
    let p2Tiles = 0;
    for (let r = 0; r < gs.rows; r++) {
      for (let c = 0; c < gs.cols; c++) {
        const o = gs.grid[r][c].owner;
        if (o === "player1") p1Tiles++;
        else if (o === "player2") p2Tiles++;
      }
    }
    const tileCounts = { player1: p1Tiles, player2: p2Tiles };

    const rates = {};
    for (const player of ["player1", "player2"]) {
      const rate = base + scale * tileCounts[player];
      rates[player] = rate;
      gs.currentRP[player] = Math.min((gs.currentRP[player] || 0) + rate * deltaTime, maxRP);
      gs.currentTP[player] = Math.min((gs.currentTP[player] || 0) + 0.05 * deltaTime, maxTP);
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
  opening:       [1.0,  0.01],
  assault:       [1.25, 0.015],
  endgame:       [2.0,  0.02],
  intermission1: [0,    0],
  intermission2: [0,    0],
};

// Export for browser
window.ResourceSystem = ResourceSystem;

