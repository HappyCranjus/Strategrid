'use strict';
/**
 * stateEncoder.js — Maps a GameState to a fixed-length Float32Array.
 *
 * Layout (total = STATE_SIZE = 672):
 *   [0..575]  Tile ownership: 16×18×2  (p1_owns, p2_owns per tile)
 *   [576..655] Top-10 troops per side: 10×2×4 floats each
 *              (col/cols, row/rows, hp/maxHp, typeId/NUM_TYPES)
 *   [656..661] Hero stats: 3 floats each (col, row, hp fraction)
 *   [662..671] Scalars: rp×2, tp×2, phase one-hot×5, matchTime
 */

const ROWS = 16, COLS = 18;
const TILE_CH = 2;             // channels per tile
const TROOP_SLOTS = 10;        // top-N troops per player
const TROOP_CH = 4;            // features per troop slot
const HERO_CH = 3;             // features per hero
const SCALAR_CH = 10;          // rp, tp × 2 sides + 5 phase + 1 time

const STATE_SIZE = ROWS * COLS * TILE_CH          // 576
                 + TROOP_SLOTS * 2 * TROOP_CH     // 80
                 + 2 * HERO_CH                    // 6
                 + SCALAR_CH;                     // 10
// = 672

// Ordered list of troop types that appear in self-play (deck-selectable + spawned)
const TROOP_TYPES = [
  'swordsman','archer','heavy','militia','settler','brute',
  'sentinel','bannerman','gustKnight','grenadier','invisiWitch',
  'ninja','ogre','warMachine','commando','skeleton','reaper','zombie',
  'brickMcStick','strategia',
];
const NUM_TYPES = TROOP_TYPES.length;
const TROOP_ID = {};
TROOP_TYPES.forEach((t, i) => { TROOP_ID[t] = i; });

const PHASES = ['opening','intermission1','assault','intermission2','endgame'];

/**
 * Encode a game state from the perspective of `player`.
 * Returns a new Float32Array of length STATE_SIZE.
 * Perspective: always encodes "my side is player1" — if player === 'player2',
 * column axis is flipped so the network always sees itself attacking rightward.
 */
function encodeState(gs, player) {
  const out = new Float32Array(STATE_SIZE);
  const flip = (player === 'player2');
  const me = player, opp = flip ? 'player1' : 'player2';
  let i = 0;

  // ── Tile ownership (576) ───────────────────────────────────────────────────
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const col = flip ? (COLS - 1 - c) : c;
      const owner = gs.grid[r][col] && gs.grid[r][col].owner;
      out[i++] = owner === me  ? 1 : 0;
      out[i++] = owner === opp ? 1 : 0;
    }
  }

  // ── Top-10 troops per player (80) ─────────────────────────────────────────
  for (const owner of [me, opp]) {
    const troops = [];
    for (const t of gs.troops) {
      if (!t || t.hp <= 0 || t.owner !== owner || t.isHero) continue;
      troops.push(t);
    }
    // Sort by frontline-first (closest to enemy start column)
    troops.sort((a, b) => owner === me
      ? (flip ? a.col - b.col : b.col - a.col)
      : (flip ? b.col - a.col : a.col - b.col));

    for (let k = 0; k < TROOP_SLOTS; k++) {
      const t = troops[k];
      const col = t ? (flip ? (COLS - 1 - t.col) : t.col) : 0;
      out[i++] = t ? col / COLS : 0;
      out[i++] = t ? t.row / ROWS : 0;
      out[i++] = t ? t.hp / (t.maxHP || t.hp || 1) : 0;
      out[i++] = t ? (TROOP_ID[t.type] || 0) / NUM_TYPES : 0;
    }
  }

  // ── Hero stats (6) ────────────────────────────────────────────────────────
  for (const h of [me === 'player1' ? gs.hero1 : gs.hero2,
                   opp === 'player1' ? gs.hero1 : gs.hero2]) {
    const col = h ? (flip ? (COLS - 1 - h.col) : h.col) : 0;
    out[i++] = h ? col / COLS : 0;
    out[i++] = h ? h.row / ROWS : 0;
    out[i++] = h ? h.hp / (h.maxHP || h.hp || 1) : 0;
  }

  // ── Scalars (10) ──────────────────────────────────────────────────────────
  out[i++] = (gs.currentRP[me]  || 0) / (gs.maxRP[me]  || 20);
  out[i++] = (gs.currentTP[me]  || 0) / (gs.maxTP[me]  || 10);
  out[i++] = (gs.currentRP[opp] || 0) / (gs.maxRP[opp] || 20);
  out[i++] = (gs.currentTP[opp] || 0) / (gs.maxTP[opp] || 10);
  for (const p of PHASES) out[i++] = gs.phase === p ? 1 : 0;
  out[i++] = Math.min((gs.matchTime || 0) / 330, 1);

  return out;
}

/**
 * Convert a (row, col) spawn position to a canonical tile index,
 * accounting for perspective flip.
 */
function tileToIndex(row, col, player) {
  const c = player === 'player2' ? (COLS - 1 - col) : col;
  return row * COLS + c;
}

/** Inverse of tileToIndex — returns {row, col} in absolute coordinates */
function indexToTile(idx, player) {
  const row = Math.floor(idx / COLS);
  const c   = idx % COLS;
  const col = player === 'player2' ? (COLS - 1 - c) : c;
  return { row, col };
}

module.exports = { encodeState, tileToIndex, indexToTile, STATE_SIZE, ROWS, COLS, TROOP_ID, NUM_TYPES };
