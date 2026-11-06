/**
 * test-determinism.js - Verifies the simulator is deterministic.
 *
 * Runs the same match twice with the same seed and bots constructed from
 * identical RNG sequences. Hashes the final game state with djb2.
 * Prints PASS if the hashes are equal, FAIL (+ diff) otherwise.
 *
 * Usage: node sim/test-determinism.js
 */

require('./loader');
const { createGame, step, isTerminal, safeStringify } = require('./headlessGame');
const { RandomBot } = require('./randomBot');

const SEED      = 42;
const MAX_TICKS = 20000;

function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h >>>= 0;
  }
  return h;
}

// Serialise state for hashing: strip circular refs (troop.target) and
// zero damage popup spawnTime which may use performance.now fallbacks.
function serializeForHash(gs) {
  const str = safeStringify(gs);
  const copy = JSON.parse(str);
  for (const p of copy.damagePopups || []) p.spawnTime = 0;
  return JSON.stringify(copy);
}

function runOnce(seed) {
  const b1 = new RandomBot(createRng(seed * 2));
  const b2 = new RandomBot(createRng(seed * 2 + 1));
  const game = createGame({}, seed);
  let ticks = 0;
  while (!isTerminal(game) && ticks < MAX_TICKS) {
    window.gameSetupResult = { gameLogic: game.gl, strategemSystem: game.systems.strategemSystem };
    window.deckSystem = game.ds;
    step(game, { player1: b1.decide(game, 'player1'), player2: b2.decide(game, 'player2') });
    ticks++;
  }
  return { gs: game.gs, ticks };
}

console.log(`Running determinism test (seed=${SEED}, max ${MAX_TICKS} ticks)…`);

const runA = runOnce(SEED);
const runB = runOnce(SEED);

const hashA = djb2(serializeForHash(runA.gs));
const hashB = djb2(serializeForHash(runB.gs));

console.log(`  Run A: ${runA.ticks} ticks, winner=${runA.gs.winner}, hash=0x${hashA.toString(16)}`);
console.log(`  Run B: ${runB.ticks} ticks, winner=${runB.gs.winner}, hash=0x${hashB.toString(16)}`);

if (hashA === hashB) {
  console.log('\n✓ PASS — both runs produced identical final state');
  process.exit(0);
} else {
  console.error('\n✗ FAIL — hashes differ (non-determinism detected)');
  // Print first difference to aid debugging
  const strA = serializeForHash(runA.gs);
  const strB = serializeForHash(runB.gs);
  for (let i = 0; i < Math.min(strA.length, strB.length); i++) {
    if (strA[i] !== strB[i]) {
      console.error(`  First diff at char ${i}: "${strA.slice(Math.max(0,i-20), i+20)}" vs "${strB.slice(Math.max(0,i-20), i+20)}"`);
      break;
    }
  }
  process.exit(1);
}
