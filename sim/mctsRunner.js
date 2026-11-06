/**
 * mctsRunner.js - MctsBot vs RandomBot match suite.
 *
 * Usage:
 *   node sim/mctsRunner.js [numMatches] [budgetMs]
 *
 *   node sim/mctsRunner.js 20 100     # 20 matches, 100ms per MCTS decision
 *   node sim/mctsRunner.js 10 500     # 10 matches, hard difficulty
 */

const { createGame, step, isTerminal, winner } = require('./headlessGame');
const { RandomBot } = require('./randomBot');
const { MctsBot }   = require('./mctsBot');

const N         = parseInt(process.argv[2]) || 20;
const BUDGET_MS = parseInt(process.argv[3]) || 100;
const MAX_TICKS = 20_000;

console.log(`MctsBot (${BUDGET_MS}ms) vs RandomBot — ${N} matches\n`);

let mctsWins = 0, randWins = 0, draws = 0;
let totalWallMs = 0;

for (let i = 0; i < N; i++) {
  const game    = createGame({}, i + 1);
  const mctsBot = new MctsBot({ budgetMs: BUDGET_MS, rolloutDepth: 5 });
  const randBot = new RandomBot();

  // Alternate sides each match so board asymmetry averages out.
  const mctsPlayer = i % 2 === 0 ? 'player1' : 'player2';
  const randPlayer = mctsPlayer === 'player1' ? 'player2' : 'player1';

  const t0 = Date.now();
  let ticks = 0;

  while (!isTerminal(game) && ticks < MAX_TICKS) {
    const mctsActions = mctsBot.decide(game, mctsPlayer);
    const randActions = randBot.decide(game, randPlayer);
    step(game, { [mctsPlayer]: mctsActions, [randPlayer]: randActions });
    ticks++;
  }

  const elapsed = Date.now() - t0;
  totalWallMs += elapsed;

  const w = winner(game);
  if      (w === mctsPlayer) mctsWins++;
  else if (w === randPlayer) randWins++;
  else                       draws++;

  const side = mctsPlayer === 'player1' ? 'Blue' : 'Red';
  process.stdout.write(
    `\rMatch ${i + 1}/${N}  MCTS(${side}) ${mctsWins}W  Rand ${randWins}W  ${draws}D  ` +
    `[${ticks} ticks, ${elapsed}ms]   `
  );
}

const total = N;
console.log('\n');
console.log('='.repeat(45));
console.log(`MCTS   win rate : ${(mctsWins / total * 100).toFixed(1)}%  (${mctsWins}/${total})`);
console.log(`Random win rate : ${(randWins / total * 100).toFixed(1)}%  (${randWins}/${total})`);
console.log(`Draws           : ${(draws    / total * 100).toFixed(1)}%  (${draws}/${total})`);
console.log('='.repeat(45));
console.log(`Total wall time : ${(totalWallMs / 1000).toFixed(1)}s`);
console.log(`Avg time/match  : ${(totalWallMs / N).toFixed(0)}ms`);
