/**
 * matchRunner.js - Runs N headless bot-vs-bot games and prints win rates.
 * Usage: node sim/matchRunner.js [N=100]
 */

require('./loader');
const { createGame, step, isTerminal, winner } = require('./headlessGame');
const { RandomBot } = require('./randomBot');

const MAX_TICKS = 20000; // hard cap (~11 min of game time at 30 Hz)

function runMatch(seed) {
  const b1 = new RandomBot(createRng(seed * 2));
  const b2 = new RandomBot(createRng(seed * 2 + 1));
  const game = createGame({}, seed);

  let ticks = 0;
  while (!isTerminal(game) && ticks < MAX_TICKS) {
    const p1 = b1.decide(game, 'player1');
    const p2 = b2.decide(game, 'player2');
    step(game, { player1: p1, player2: p2 });
    ticks++;
  }

  return { w: winner(game), ticks };
}

function runMatches(N = 100) {
  let p1Wins = 0, p2Wins = 0, draws = 0, totalTicks = 0;
  const t0 = process.hrtime.bigint();

  for (let i = 0; i < N; i++) {
    const { w, ticks } = runMatch(i + 1);
    if (w === 'player1') p1Wins++;
    else if (w === 'player2') p2Wins++;
    else draws++;
    totalTicks += ticks;
  }

  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const wallS  = wallMs / 1000;
  const ticksPerSec = Math.round(totalTicks / wallS);

  console.log(`\nResults (N=${N}):`);
  console.log(`  P1 wins: ${p1Wins}  (${(p1Wins/N*100).toFixed(1)}%)`);
  console.log(`  P2 wins: ${p2Wins}  (${(p2Wins/N*100).toFixed(1)}%)`);
  console.log(`  Draws:   ${draws}`);
  console.log(`  Time:    ${wallS.toFixed(2)}s`);
  console.log(`  Ticks/s: ${ticksPerSec.toLocaleString()}`);
}

const N = parseInt(process.argv[2], 10) || 100;
runMatches(N);
