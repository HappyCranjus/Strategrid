'use strict';
/**
 * evalNetwork.js — Evaluate a trained network against RandomBot and MctsBot.
 *
 * Usage:
 *   node sim/train/evalNetwork.js [weightsFile] [numGames]
 *   node sim/train/evalNetwork.js src/model/weights.json 50
 */

const fs   = require('fs');
const path = require('path');

require('../loader');
const hg = require('../headlessGame');
const { RandomBot } = require('../randomBot');
const { MctsBot }   = require('../mctsBot');
const { Network }   = require('./network');
const { encodeState, tileToIndex, indexToTile } = require('./stateEncoder');
const { buildMask }  = require('./actionEncoder');

const WEIGHTS_FILE = process.argv[2] || path.join(__dirname, '../../src/model/weights.json');
const NUM_GAMES    = parseInt(process.argv[3]) || 50;
const MAX_TICKS    = 20_000;

// ── Load network ─────────────────────────────────────────────────────────────

if (!fs.existsSync(WEIGHTS_FILE)) {
  console.error(`Weights not found: ${WEIGHTS_FILE}\nRun trainNetwork.js first.`);
  process.exit(1);
}
const net = new Network();
net.load(JSON.parse(fs.readFileSync(WEIGHTS_FILE)));
console.log(`Loaded weights from ${WEIGHTS_FILE}`);

// ── NNBot decision function ───────────────────────────────────────────────────

function nnBotDecide(game, player, heuristicBot) {
  const { gs, gl, ds } = game;
  if (!gs || gs.gameOver) return [];

  const phase = gs.phase;
  // Intermission: use heuristic bot for drafting
  if (phase === 'intermission1' || phase === 'intermission2') {
    return heuristicBot.decide(game, player);
  }
  if (!['opening','assault','endgame'].includes(phase)) return [];

  // Encode state → forward pass → masked argmax
  const state  = encodeState(gs, player);
  const { policy } = net.forward(state);
  const mask   = buildMask(gs, player, gl, ds);

  let bestIdx = -1, bestProb = -1;
  for (let i = 0; i < 288; i++) {
    if (mask[i] && policy[i] > bestProb) { bestProb = policy[i]; bestIdx = i; }
  }

  const actions = [];
  if (bestIdx >= 0) {
    const { row, col } = indexToTile(bestIdx, player);
    // Pick the highest-cost affordable troop
    const deck = ds.getPlayerDeck(player);
    if (deck && deck.troops) {
      let best = null, bestCost = -1;
      for (const t of deck.troops) {
        const def = (gl.troopTypes || {})[t];
        if (!def) continue;
        if ((gs.currentRP[player] || 0) < (def.cost || 0)) continue;
        const e = window.gameActions.checkSpawnLegality(gs, gl, col, row, player, t);
        if (!e.zoneOK || !e.affordOK) continue;
        if ((def.cost || 0) > bestCost) { bestCost = def.cost; best = t; }
      }
      if (best) actions.push({ kind: 'spawnTroop', row, col, troopType: best });
    }
  }

  // Add heuristic non-spawn actions (ability, strategem) from base bot
  const heuristic = heuristicBot.decide(game, player);
  for (const a of heuristic) {
    if (a.kind !== 'spawnTroop') actions.push(a);
  }
  return actions;
}

// ── Eval function ─────────────────────────────────────────────────────────────

function evalVs(opponentFn, opponentLabel, numGames) {
  let nnWins = 0, oppWins = 0, draws = 0;
  for (let g = 0; g < numGames; g++) {
    const game      = hg.createGame({}, g + 1000);
    const heuristic = new RandomBot();
    const opponent  = opponentFn();
    const nnPlayer  = g % 2 === 0 ? 'player1' : 'player2';
    const opPlayer  = nnPlayer === 'player1' ? 'player2' : 'player1';
    let ticks = 0;

    while (!hg.isTerminal(game) && ticks < MAX_TICKS) {
      const nnActions  = nnBotDecide(game, nnPlayer, heuristic);
      const oppActions = opponent.decide(game, opPlayer);
      hg.step(game, { [nnPlayer]: nnActions, [opPlayer]: oppActions });
      ticks++;
    }

    const w = hg.winner(game);
    if      (w === nnPlayer)  nnWins++;
    else if (w === opPlayer)  oppWins++;
    else                      draws++;

    process.stdout.write(`\r  vs ${opponentLabel}: NN ${nnWins}W / Opp ${oppWins}W / ${draws}D  [${g+1}/${numGames}]   `);
  }
  process.stdout.write('\n');
  const total = nnWins + oppWins + draws;
  return { nnWins, oppWins, draws, winRate: (nnWins / total * 100).toFixed(1) };
}

// ── Run evaluations ───────────────────────────────────────────────────────────

console.log(`\nEvaluating: ${NUM_GAMES} games each\n`);

const vsRand = evalVs(() => new RandomBot(), 'RandomBot', NUM_GAMES);
console.log(`  RandomBot: NNBot wins ${vsRand.winRate}% (${vsRand.nnWins}/${NUM_GAMES})`);

const vsMcts = evalVs(() => new MctsBot({ budgetMs: 20 }), 'MctsBot(20ms)', Math.min(NUM_GAMES, 20));
console.log(`  MctsBot(20ms): NNBot wins ${vsMcts.winRate}% (${vsMcts.nnWins}/${Math.min(NUM_GAMES, 20)})`);

console.log('\nTarget: NNBot vs RandomBot > 60% to confirm network is learning something.');
