/**
 * randomBot.js - Faithful headless port of AIController.
 *
 * decide(game, player) -> Action[]
 *
 * Same campaign-spawn + strategem-spam + intermission-draft behavior as the
 * live-game AIController, but calling no browser APIs — only reads game state.
 */

require('./loader');

const DT = LockstepSystem.TICK_DELTA;
const TWO_CLICK = new Set(['wind', 'lesserTeleport', 'greaterTeleport']);
const ACTIVE_PHASES = new Set(['opening', 'assault', 'endgame']);

class RandomBot {
  constructor(rng = Math.random.bind(Math)) {
    this.rng      = rng;
    this.campaign = null; // { troopType, rate, remainingDur, accum }
  }

  _randInt(lo, hi) { return lo + Math.floor(this.rng() * (hi - lo + 1)); }

  decide(game, player) {
    const { gs, gl, ds } = game;
    if (!gs || gs.gameOver) return [];

    const phase = gs.phase;
    if (phase === 'intermission1' || phase === 'intermission2') {
      return this._pickDraft(ds, player);
    }
    if (!ACTIVE_PHASES.has(phase)) return [];

    const actions = [];
    this._tickCampaign(gs, gl, ds, player, actions);
    this._tickStrategems(gs, gl, ds, game.systems.strategemSystem, player, actions);
    actions.push({ kind: 'heroAbility' });
    return actions;
  }

  // ---- Intermission: draft 1 troop + 1 strategem (same as _aiPickIntermission) --

  _pickDraft(ds, player) {
    const deck     = ds.getPlayerDeck(player) || { troops: [], strategems: [] };
    const troopPool = ds.getAvailableTroops().filter(t => !deck.troops.includes(t));
    const stratPool = ds.getAvailableStrategems().filter(s => !deck.strategems.includes(s));
    const actions = [];
    if (troopPool.length)
      actions.push({ kind: 'draftTroop', troopType: troopPool[Math.floor(this.rng() * troopPool.length)] });
    if (stratPool.length)
      actions.push({ kind: 'draftStrategem', strategemType: stratPool[Math.floor(this.rng() * stratPool.length)] });
    return actions;
  }

  // ---- Spawn campaign (mirrors _tickSpawnCampaign) ---------------------------

  _tickCampaign(gs, gl, ds, player, out) {
    const deck = ds.getPlayerDeck(player);
    if (!deck?.troops?.length) return;

    if (!this.campaign || this.campaign.remainingDur <= 0) {
      const slot = this._randInt(1, deck.troops.length);
      this.campaign = {
        troopType:    deck.troops[slot - 1],
        rate:         this._randInt(1, 4),
        remainingDur: this._randInt(1, 4),
        accum:        0,
      };
    }

    const c = this.campaign;
    c.accum += DT;
    const interval = 1 / c.rate;
    while (c.accum >= interval) {
      const a = this._spawnAction(gs, gl, player, c.troopType);
      if (a) out.push(a);
      c.accum -= interval;
    }
    c.remainingDur -= DT;
  }

  _spawnAction(gs, gl, player, troopType) {
    const def = (gl.troopTypes || {})[troopType];
    if (!def) return null;
    if ((gs.currentRP[player] ?? 0) < (def.cost    || 0)) return null;
    if ((gs.currentTP[player] ?? 0) < (def.tpCost  || 0)) return null;

    if (troopType === 'ninja') {
      const col = player === 'player1' ? gs.cols - 1 : 0;
      return { kind: 'spawnTroop', row: Math.floor(this.rng() * gs.rows), col, troopType };
    }

    const owned = this._randomOwnedTile(gs, player);
    if (!owned) return null;
    return { kind: 'spawnTroop', row: owned.row, col: owned.col, troopType };
  }

  _randomOwnedTile(gs, player) {
    const tiles = [];
    for (let r = 0; r < gs.rows; r++)
      for (let c = 0; c < gs.cols; c++)
        if (gs.grid[r][c].owner === player) tiles.push({ row: r, col: c });
    return tiles.length ? tiles[Math.floor(this.rng() * tiles.length)] : null;
  }

  _randomEnemyTile(gs, player) {
    const opp = player === 'player1' ? 'player2' : 'player1';
    const tiles = [];
    for (let r = 0; r < gs.rows; r++)
      for (let c = 0; c < gs.cols; c++)
        if (gs.grid[r][c].owner === opp) tiles.push({ row: r, col: c });
    return tiles.length ? tiles[Math.floor(this.rng() * tiles.length)] : null;
  }

  // ---- Strategem spam (mirrors _tickStrategems) -----------------------------

  _tickStrategems(gs, gl, ds, ss, player, out) {
    const deck = ds.getPlayerDeck(player);
    if (!deck?.strategems) return;

    for (const type of deck.strategems) {
      const def = (gl.strategemTypes || {})[type];
      if (!def) continue;
      if ((gs.currentTP[player] ?? 0) < (def.tpCost || 0)) continue;
      if (def.cooldown != null && (gs.strategemCooldowns[player][type] ?? 0) > 0) continue;

      const params = this._buildCastParams(gs, type, def, player);
      if (params) out.push({ kind: 'placeStrategem', strategemType: type, params });
    }
  }

  _buildCastParams(gs, type, def, player) {
    const start = this._randomOwnedTile(gs, player);
    if (!start) return null;

    if (def.targeting === 'twoClick' || TWO_CLICK.has(type)) {
      const end = this._randomEnemyTile(gs, player) || {
        row: start.row,
        col: player === 'player2' ? 0 : gs.cols - 1,
      };
      const dirCol = end.col - start.col;
      const dirRow = end.row - start.row;
      return {
        owner: player,
        row: start.row, col: start.col,
        dirCol: dirCol || (player === 'player2' ? -1 : 1),
        dirRow,
        endCol: end.col, endRow: end.row,
      };
    }

    if (def.targeting === 'tile_ownHalf') {
      const midCol = Math.floor(gs.cols / 2);
      const inHalf = player === 'player1' ? start.col < midCol : start.col >= midCol;
      if (!inHalf) return null;
    }

    return { owner: player, row: start.row, col: start.col };
  }
}

module.exports = { RandomBot };
