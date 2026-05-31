/**
 * PhaseSystem - advance the match clock and stamp the current phase name.
 *
 * Schedule (5.5 min total): opening 100s -> intermission1 15s -> assault 100s
 * -> intermission2 15s -> endgame 100s. After 330s the match resolves by tile
 * count; ties default to player1 (placeholder until tower-destruction wins).
 *
 * @class
 */
const PHASE_SCHEDULE = [
  { name: "opening",       duration: 100 },
  { name: "intermission1", duration: 15  },
  { name: "assault",       duration: 100 },
  { name: "intermission2", duration: 15  },
  { name: "endgame",       duration: 100 },
];

class PhaseSystem {
  constructor(gameState) {
    this.gameState = gameState;
  }

  update(deltaTime) {
    const gs = this.gameState;
    if (!gs || gs.gameOver) return;

    gs.matchTime = (gs.matchTime || 0) + deltaTime;

    let acc = 0;
    for (const p of PHASE_SCHEDULE) {
      acc += p.duration;
      if (gs.matchTime < acc) {
        gs.phase = p.name;
        return;
      }
    }

    // Match clock has elapsed. Resolve by tile count.
    let p1 = 0;
    let p2 = 0;
    for (let r = 0; r < gs.rows; r++) {
      for (let c = 0; c < gs.cols; c++) {
        const o = gs.grid[r][c].owner;
        if (o === "player1") p1++;
        else if (o === "player2") p2++;
      }
    }
    gs.setGameOver(p1 >= p2 ? "player1" : "player2");
  }
}

window.PhaseSystem = PhaseSystem;
