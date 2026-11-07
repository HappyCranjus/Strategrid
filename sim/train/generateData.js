'use strict';
/**
 * generateData.js — Run self-play games and collect training examples.
 *
 * Usage:
 *   node sim/train/generateData.js [numGames] [outputFile]
 *   node sim/train/generateData.js 200 sim/train/data.bin
 *
 * Output: binary file, layout per example:
 *   672 × float32 (state)   = 2688 bytes
 *   1   × int32   (tileIdx) = 4 bytes
 *   1   × float32 (outcome) = 4 bytes
 *   total per example: 2696 bytes
 *
 * Header (8 bytes):
 *   uint32 magic = 0x4E4E4441 ("NNDA")
 *   uint32 numExamples
 */

const fs   = require('fs');
const path = require('path');

require('../loader');
const hg = require('../headlessGame');
const { RandomBot } = require('../randomBot');
const { encodeState, tileToIndex, STATE_SIZE, ROWS, COLS } = require('./stateEncoder');

const NUM_GAMES  = parseInt(process.argv[2]) || 200;
const OUT_FILE   = process.argv[3] || path.join(__dirname, 'data.bin');
const MAX_TICKS  = 20_000;

// ── Run games ────────────────────────────────────────────────────────────────

const examples = []; // {state: Float32Array, tileIdx: int, player: string}[]
let totalGames = 0, noWinner = 0;

process.stdout.write(`Generating data: ${NUM_GAMES} games\n`);
const t0 = Date.now();

for (let g = 0; g < NUM_GAMES; g++) {
  const game = hg.createGame({}, g + 1);
  const bot1 = new RandomBot();
  const bot2 = new RandomBot();

  // Per-game spawn log: record (state, tileIdx, player) before each step
  const spawns = [];
  let ticks = 0;

  while (!hg.isTerminal(game) && ticks < MAX_TICKS) {
    const gs = game.gs;

    const p1actions = bot1.decide(game, 'player1');
    const p2actions = bot2.decide(game, 'player2');

    // Record spawn decisions BEFORE they're applied
    for (const a of p1actions) {
      if (a.kind !== 'spawnTroop') continue;
      const state = encodeState(gs, 'player1');
      const tileIdx = tileToIndex(a.row, a.col, 'player1');
      spawns.push({ state, tileIdx, player: 'player1' });
    }
    for (const a of p2actions) {
      if (a.kind !== 'spawnTroop') continue;
      const state = encodeState(gs, 'player2');
      const tileIdx = tileToIndex(a.row, a.col, 'player2');
      spawns.push({ state, tileIdx, player: 'player2' });
    }

    hg.step(game, { player1: p1actions, player2: p2actions });
    ticks++;
  }

  const winner = hg.winner(game);
  if (!winner) { noWinner++; continue; }

  // Label each spawn: +1 if winner, -1 if loser
  for (const { state, tileIdx, player } of spawns) {
    examples.push({ state, tileIdx, outcome: player === winner ? 1 : -1 });
  }

  totalGames++;
  if ((g + 1) % 10 === 0) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    process.stdout.write(`\r  ${g + 1}/${NUM_GAMES} games, ${examples.length} examples, ${elapsed}s elapsed   `);
  }
}

process.stdout.write(`\n  Done. ${totalGames} games with winner, ${noWinner} no-winner. ${examples.length} total examples.\n`);

// ── Write binary file ─────────────────────────────────────────────────────────

const N = examples.length;
const EX_BYTES = STATE_SIZE * 4 + 4 + 4; // 2696
const bufSize  = 8 + N * EX_BYTES;
const buf      = Buffer.alloc(bufSize);

buf.writeUInt32LE(0x4E4E4441, 0); // magic "NNDA"
buf.writeUInt32LE(N,          4);

for (let i = 0; i < N; i++) {
  const offset = 8 + i * EX_BYTES;
  const { state, tileIdx, outcome } = examples[i];
  // Write state floats
  for (let j = 0; j < STATE_SIZE; j++) {
    buf.writeFloatLE(state[j], offset + j * 4);
  }
  buf.writeInt32LE(tileIdx,  offset + STATE_SIZE * 4);
  buf.writeFloatLE(outcome,  offset + STATE_SIZE * 4 + 4);
}

fs.writeFileSync(OUT_FILE, buf);
const mb = (bufSize / 1_000_000).toFixed(1);
process.stdout.write(`  Wrote ${N} examples to ${OUT_FILE} (${mb} MB)\n`);
process.stdout.write(`  Time: ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
