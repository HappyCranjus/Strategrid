'use strict';
/**
 * actionEncoder.js — Maps game actions to/from canonical tile indices,
 * and builds the legality mask for the policy head.
 *
 * Policy head output: 288 logits, one per tile in the 16×18 grid.
 * Invalid tiles (not owned, out of zone, can't afford) are masked to -Infinity.
 */

const { ROWS, COLS, tileToIndex, indexToTile } = require('./stateEncoder');
const NUM_TILES = ROWS * COLS; // 288

/**
 * Build a Uint8Array(288) mask where mask[i] = 1 iff tile i is a valid
 * spawn position for at least one affordable troop type in the player's deck.
 */
function buildMask(gs, player, gl, ds) {
  const mask = new Uint8Array(NUM_TILES);
  const deck = ds && ds.getPlayerDeck && ds.getPlayerDeck(player);
  if (!deck || !deck.troops || !deck.troops.length) return mask;

  const rp = gs.currentRP[player] || 0;
  const tp = gs.currentTP[player] || 0;

  for (const troopType of deck.troops) {
    const def = (gl.troopTypes || {})[troopType];
    if (!def) continue;
    if (rp < (def.cost || 0)) continue;
    if (tp < (def.tpCost || 0)) continue;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const tileIdx = tileToIndex(r, c, player);
        if (mask[tileIdx]) continue; // already valid
        const e = window.gameActions.checkSpawnLegality(gs, gl, c, r, player, troopType);
        if (e.zoneOK && e.affordOK) mask[tileIdx] = 1;
      }
    }
  }
  return mask;
}

/**
 * Given a policy probability vector and a mask, return the best valid tile
 * and the troop type the AI should spawn there (most expensive affordable one).
 *
 * Returns null if no valid spawn exists.
 */
function pickSpawn(policy, mask, gs, player, gl, ds) {
  let bestIdx = -1, bestProb = -1;
  for (let i = 0; i < NUM_TILES; i++) {
    if (mask[i] && policy[i] > bestProb) { bestProb = policy[i]; bestIdx = i; }
  }
  if (bestIdx < 0) return null;

  const { row, col } = indexToTile(bestIdx, player);

  // Pick troop type: prefer highest-cost affordable troop (more impactful)
  const deck = ds && ds.getPlayerDeck && ds.getPlayerDeck(player);
  if (!deck || !deck.troops) return null;
  const rp = gs.currentRP[player] || 0;
  const tp = gs.currentTP[player] || 0;
  let best = null, bestCost = -1;
  for (const t of deck.troops) {
    const def = (gl.troopTypes || {})[t];
    if (!def) continue;
    if (rp < (def.cost || 0) || tp < (def.tpCost || 0)) continue;
    const e = window.gameActions.checkSpawnLegality(gs, gl, col, row, player, t);
    if (!e.zoneOK || !e.affordOK) continue;
    if ((def.cost || 0) > bestCost) { bestCost = def.cost; best = t; }
  }
  if (!best) return null;
  return { kind: 'spawnTroop', row, col, troopType: best };
}

module.exports = { buildMask, pickSpawn, NUM_TILES };
