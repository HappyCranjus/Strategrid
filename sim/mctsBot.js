/**
 * mctsBot.js - Flat Monte Carlo bot.
 *
 * decide(game, player) -> Action[]
 *
 * Samples K candidate spawn/move actions, evaluates each with RandomBot
 * rollouts, returns the best action combined with heuristic ability/strategem
 * actions. Significantly stronger than RandomBot — especially at positioning
 * troops and moving the hero — while requiring no training data.
 *
 * Difficulty is controlled by budgetMs (wall-clock time per decision):
 *   easy:   20ms
 *   medium: 100ms  (default)
 *   hard:   500ms
 */

require('./loader');
const hg = require('./headlessGame');
const { RandomBot } = require('./randomBot');

const ACTIVE_PHASES = new Set(['opening', 'assault', 'endgame']);

class MctsBot {
  constructor({ budgetMs = 50, kActions = 12, rolloutDepth = 5 } = {}) {
    this.budgetMs     = budgetMs;
    this.kActions     = kActions;
    this.rolloutDepth = rolloutDepth;
    // Reuse rollout bots across decisions — their campaign state bleeds
    // slightly between rollouts, which is acceptable for rollout signal quality.
    this._rb1 = new RandomBot();
    this._rb2 = new RandomBot();
  }

  decide(game, player) {
    if (hg.isTerminal(game)) return [];

    const phase = game.gs.phase;

    // During intermissions fall back to RandomBot draft logic (not worth searching).
    if (phase === 'intermission1' || phase === 'intermission2') {
      return player === 'player1'
        ? this._rb1.decide(game, player)
        : this._rb2.decide(game, player);
    }

    if (!ACTIVE_PHASES.has(phase)) return [];

    const opponent  = player === 'player1' ? 'player2' : 'player1';
    const candidates = this._candidates(game, player);

    // Pre-compute heuristic actions once from the original game — avoids calling
    // legalActions() inside the eval loop (most expensive part of each iteration).
    const heuristic = this._heuristicActions(game, player);

    if (candidates.length === 0) return heuristic;

    // Round-robin evaluation: cycle through candidates, accumulate scores.
    const scores = new Array(candidates.length).fill(0);
    const counts = new Array(candidates.length).fill(0);
    const start  = Date.now();
    let iter = 0;

    while (Date.now() - start < this.budgetMs) {
      const idx = iter % candidates.length;
      iter++;

      const g = hg.clone(game);

      const myActions   = candidates[idx].kind !== 'noOp'
        ? [candidates[idx], ...heuristic]
        : heuristic;
      const oppActions  = player === 'player1'
        ? this._rb2.decide(g, opponent)
        : this._rb1.decide(g, opponent);

      hg.step(g, { [player]: myActions, [opponent]: oppActions });
      scores[idx] += this._rollout(g, player);
      counts[idx]++;
    }

    // Pick highest-average candidate.
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < candidates.length; i++) {
      if (counts[i] === 0) continue;
      const avg = scores[i] / counts[i];
      if (avg > bestScore) { bestScore = avg; bestIdx = i; }
    }

    const best = candidates[bestIdx];
    return best.kind !== 'noOp' ? [best, ...heuristic] : heuristic;
  }

  // Returns candidates focused on high-value decisions:
  //   - kActions spawn positions biased toward frontline tiles
  //   - 1 hero move (toward enemy hero) instead of all 8 directions
  //   - noOp baseline
  _candidates(game, player) {
    const { gs, gl } = game;
    const legal  = hg.legalActions(game, player);
    const spawns = legal.filter(a => a.kind === 'spawnTroop');

    // Bias spawn sampling toward frontline (high col for P1, low for P2).
    const sorted = spawns.slice().sort((a, b) =>
      player === 'player1' ? b.col - a.col : a.col - b.col
    );
    const front  = sorted.slice(0, Math.ceil(sorted.length * 0.3));  // top 30% by depth
    const rest   = sorted.slice(front.length);
    // 70% of slots from frontline, 30% from rest for diversity
    const nFront = Math.ceil(this.kActions * 0.7);
    const nRest  = this.kActions - nFront;
    const sampled = [..._sample(front, nFront), ..._sample(rest, nRest)];

    // Single smart hero move: toward the enemy hero (or pure forward if no enemy hero)
    const heroMove = this._heroMoveTowardEnemy(game, player);

    return [{ kind: 'noOp' }, ...sampled, ...(heroMove ? [heroMove] : [])];
  }

  // Returns the heroMove action that most reduces distance to the enemy hero.
  _heroMoveTowardEnemy(game, player) {
    const { gs } = game;
    const myHero  = player === 'player1' ? gs.hero1 : gs.hero2;
    const oppHero = player === 'player1' ? gs.hero2 : gs.hero1;
    if (!myHero || myHero.hp <= 0) return null;

    const targetCol = oppHero ? oppHero.col : (player === 'player1' ? gs.cols - 1 : 0);
    const targetRow = oppHero ? oppHero.row : myHero.row;

    const dxRaw = targetCol - myHero.col;
    const dyRaw = targetRow - myHero.row;
    const dx = dxRaw === 0 ? 0 : (dxRaw > 0 ? 1 : -1);
    const dy = dyRaw === 0 ? 0 : (dyRaw > 0 ? 1 : -1);
    if (dx === 0 && dy === 0) return null;
    return { kind: 'heroMove', dx, dy };
  }

  // Ability + strategems handled by rules, not search (always fire when ready).
  _heuristicActions(game, player) {
    const legal = hg.legalActions(game, player);
    return legal.filter(a => a.kind === 'heroAbility' || a.kind === 'placeStrategem');
  }

  // game is already a clone — step it forward in-place, no extra clone needed.
  _rollout(game, player) {
    for (let i = 0; i < this.rolloutDepth; i++) {
      if (hg.isTerminal(game)) break;
      const p1 = this._rb1.decide(game, 'player1');
      const p2 = this._rb2.decide(game, 'player2');
      hg.step(game, { player1: p1, player2: p2 });
    }
    if (hg.isTerminal(game)) {
      const w = hg.winner(game);
      return w === player ? 1 : w === null ? 0 : -1;
    }
    return hg.evaluate(game, player);
  }
}

function _sample(arr, k) {
  if (arr.length <= k) return arr.slice();
  const copy = arr.slice();
  const out  = [];
  for (let i = 0; i < k; i++) {
    const j = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(j, 1)[0]);
  }
  return out;
}

module.exports = { MctsBot };
