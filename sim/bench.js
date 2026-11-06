/**
 * bench.js - Benchmark: how many ticks/second can the headless sim do?
 * Usage: node sim/bench.js [N=50]
 *
 * Reports ticks/sec and ×realtime factor.
 * Target: ≥1000× realtime (a 330s game simulated in <330ms).
 */

require('./loader');
const { createGame, step, isTerminal } = require('./headlessGame');
const { RandomBot } = require('./randomBot');

const MAX_TICKS   = 20000;
const REAL_TICKS  = 9900; // 330 s × 30 Hz — a full match worth of ticks

function runMatch(seed) {
  const b1 = new RandomBot(createRng(seed * 2));
  const b2 = new RandomBot(createRng(seed * 2 + 1));
  const game = createGame({}, seed);
  let ticks = 0;
  while (!isTerminal(game) && ticks < MAX_TICKS) {
    step(game, { player1: b1.decide(game, 'player1'), player2: b2.decide(game, 'player2') });
    ticks++;
  }
  return ticks;
}

const N = parseInt(process.argv[2], 10) || 50;

// Warmup
runMatch(0);

const t0 = process.hrtime.bigint();
let totalTicks = 0;
for (let i = 0; i < N; i++) totalTicks += runMatch(i + 1);
const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
const wallS  = wallMs / 1000;

const ticksPerSec = totalTicks / wallS;
const avgTicks    = totalTicks / N;
const realTimeS   = avgTicks / 30;           // seconds of game time per match
const xRealtime   = realTimeS / (wallS / N); // how many × faster than real

console.log(`\nBenchmark (N=${N} matches, 1 warmup):`);
console.log(`  Wall time:      ${wallS.toFixed(3)}s`);
console.log(`  Avg ticks/game: ${Math.round(avgTicks)}`);
console.log(`  Avg game time:  ${realTimeS.toFixed(1)}s`);
console.log(`  Ticks/sec:      ${Math.round(ticksPerSec).toLocaleString()}`);
console.log(`  ×Realtime:      ${Math.round(xRealtime)}×  (target ≥1000×)`);
