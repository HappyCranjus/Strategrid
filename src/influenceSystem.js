/**
 * InfluenceSystem - per-frame tile-control accumulation.
 *
 * Each troop adds influence to its occupied tile (0.5/sec) and to the 4
 * cardinal-adjacent tiles (0.1/sec). Influence is a signed scalar in [-1, +1]:
 * positive = player1, negative = player2. Opposing troops on the same tile
 * cancel naturally (their per-frame deltas have opposite signs).
 *
 * A tile is "claimed" when |influence| >= 0.5; its `owner` is derived each
 * frame. Influence does not decay — claim sticks until an enemy overwrites it.
 *
 * @class
 */
class InfluenceSystem {
  constructor(gameState) {
    this.gameState = gameState;
  }

  update(deltaTime) {
    const gs = this.gameState;
    if (!gs || gs.gameOver) return;

    const ADJ = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    // Tuned slow: 10s to claim an occupied tile, 50s for a single adjacency.
    // A marching swordsman (2s/tile) leaves +0.1 per tile -- well under the 0.5
    // claim threshold -- so solo marching no longer auto-claims territory.
    const occupiedDelta = 0.05 * deltaTime;
    const adjacentDelta = 0.01 * deltaTime;

    for (const t of gs.troops) {
      const sign = t.owner === "player1" ? +1 : -1;
      const r = Math.floor(t.row);
      const c = Math.floor(t.col);
      this._apply(r, c, sign * occupiedDelta);
      for (const [dr, dc] of ADJ) {
        this._apply(r + dr, c + dc, sign * adjacentDelta);
      }
    }

    this._heartbeat(deltaTime);
  }

  /** Once per game-second, log a one-line tile-count summary. Heartbeat to confirm
   *  the system is alive during sandbox playtests; safe to remove later. */
  _heartbeat(deltaTime) {
    this._logAccum = (this._logAccum || 0) + deltaTime;
    if (this._logAccum < 1) return;
    this._logAccum = 0;
    const gs = this.gameState;
    let p1 = 0, p2 = 0;
    for (let r = 0; r < gs.rows; r++) {
      for (let c = 0; c < gs.cols; c++) {
        const o = gs.grid[r][c].owner;
        if (o === "player1") p1++;
        else if (o === "player2") p2++;
      }
    }
    console.log(`[Influence] p1Tiles=${p1} p2Tiles=${p2} troops=${gs.troops.length} phase=${gs.phase}`);
  }

  _apply(r, c, delta) {
    const gs = this.gameState;
    if (r < 0 || r >= gs.rows || c < 0 || c >= gs.cols) return;
    const tile = gs.grid[r][c];
    let inf = tile.influence + delta;
    if (inf > 1) inf = 1;
    else if (inf < -1) inf = -1;
    tile.influence = inf;
    tile.owner = inf >= 0.5 ? "player1"
              : inf <= -0.5 ? "player2"
              : null;
  }
}

window.InfluenceSystem = InfluenceSystem;
