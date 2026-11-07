/**
 * headlessGame.js - Headless simulator interface.
 *
 * API:
 *   createGame(config, seed) -> game
 *   step(game, { player1: Action[], player2: Action[] })
 *   legalActions(game, player) -> Action[]
 *   clone(game) -> game
 *   isTerminal(game) -> boolean
 *   winner(game) -> "player1" | "player2" | null
 *   evaluate(game, player) -> number  [-1, 1]
 */

require('./loader');

const DT = LockstepSystem.TICK_DELTA; // 1/30 s

// ---------------------------------------------------------------------------
// createGame
// ---------------------------------------------------------------------------

function createGame(config = {}, seed = 1) {
  const rng = createRng(seed);

  const gs = new GameState();
  const gl = new GameLogic();
  const ds = new DeckSystem();

  // Inject globals that gameState.initialize() and applyPlayerAction need
  window.deckSystem = ds;

  const phaseSystem    = new PhaseSystem(gs);
  const influenceSystem = new InfluenceSystem(gs);
  const resourceSystem = new ResourceSystem(gs);
  const troopSystem    = new TroopSystem(gs, gl);
  const buildingSystem = new BuildingSystem(gs, gl);
  const strategemSystem = new StrategemSystem(gs, gl);

  // Minimum gameSetupResult that applyPlayerAction references
  const _gsr = { gameLogic: gl, strategemSystem };
  window.gameSetupResult = _gsr;

  // Assign random decks before initialize() so _spawnHeroes picks hero from deck
  ds.playerDecks.player1 = ds.randomDeck(rng);
  ds.playerDecks.player2 = ds.randomDeck(rng);

  gs.setGameMode(config.gameMode || 'pvc');
  gs.initialize();
  buildingSystem.placeInitialTurrets(); // matches game.js startPvC() / startSandbox()

  return {
    gs, gl, ds, rng, _gsr,
    systems: { phaseSystem, influenceSystem, resourceSystem, troopSystem, buildingSystem, strategemSystem },
  };
}

// ---------------------------------------------------------------------------
// step
// ---------------------------------------------------------------------------

function _applyAction(game, action, player) {
  if (!action || action.kind === 'noOp') return;
  if (action.kind === 'draftTroop')     { game.ds.addTroop(player, action.troopType); return; }
  if (action.kind === 'draftStrategem') { game.ds.addStrategem(player, action.strategemType); return; }
  game.gs.applyPlayerAction(action, player);
}

function step(game, { player1: p1Actions = [], player2: p2Actions = [] } = {}) {
  const { gs, systems: { phaseSystem, influenceSystem, resourceSystem, troopSystem, buildingSystem, strategemSystem } } = game;
  if (gs.gameOver) return;

  // Ensure globals point at this game (createGame sets them; re-set if running multiple games)
  if (window.gameSetupResult !== game._gsr) {
    game._gsr = window.gameSetupResult = { gameLogic: game.gl, strategemSystem };
    window.deckSystem = game.ds;
  }

  for (const a of p1Actions) _applyAction(game, a, 'player1');
  for (const a of p2Actions) _applyAction(game, a, 'player2');

  const inIntermission = gs.phase === 'intermission1' || gs.phase === 'intermission2';
  phaseSystem.update(DT);
  if (!inIntermission && !gs.gameOver) {
    influenceSystem.update(DT);
    resourceSystem.update(DT);
    troopSystem.update(DT);
    buildingSystem.update(DT);
    strategemSystem.update(DT);
  }
}

// ---------------------------------------------------------------------------
// legalActions
// ---------------------------------------------------------------------------

function legalActions(game, player) {
  const { gs, gl, ds } = game;
  const deck   = ds.getPlayerDeck(player) || {};
  const troops = deck.troops    || [];
  const strats = deck.strategems || [];
  const actions = [{ kind: 'noOp' }];

  // ---- Troop spawns -------------------------------------------------------
  for (const troopType of troops) {
    for (let r = 0; r < gs.rows; r++) {
      for (let c = 0; c < gs.cols; c++) {
        const e = gameActions.checkSpawnLegality(gs, gl, c, r, player, troopType);
        if (e.zoneOK && e.affordOK) {
          actions.push({ kind: 'spawnTroop', row: r, col: c, troopType });
        }
      }
    }
  }

  // ---- Hero ability -------------------------------------------------------
  const hero = player === 'player1' ? gs.hero1 : gs.hero2;
  if (hero && hero.hp > 0) {
    actions.push({ kind: 'heroAbility' });
  }

  // ---- Hero movement (8 discrete directions) ------------------------------
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
    actions.push({ kind: 'heroMove', dx, dy });
  }

  // ---- Strategem casts (1 heuristic action per ready+affordable slot) ------
  const { strategemSystem } = game.systems;
  for (const st of strats) {
    const def = (gl.strategemTypes || {})[st];
    if (!def) continue;
    if ((gs.currentTP[player] ?? 0) < (def.tpCost || 0)) continue;
    if (def.cooldown != null && (gs.strategemCooldowns[player][st] ?? 0) > 0) continue;
    const params = _heuristicStratTarget(gs, st, def, player);
    if (params) actions.push({ kind: 'placeStrategem', strategemType: st, params });
  }

  // ---- Intermission draft -------------------------------------------------
  if (gs.phase === 'intermission1' || gs.phase === 'intermission2') {
    const deck = ds.getPlayerDeck(player) || { troops: [], strategems: [] };
    for (const t of ds.getAvailableTroops().filter(t => !deck.troops.includes(t))) {
      actions.push({ kind: 'draftTroop', troopType: t });
    }
    for (const s of ds.getAvailableStrategems().filter(s => !deck.strategems.includes(s))) {
      actions.push({ kind: 'draftStrategem', strategemType: s });
    }
  }

  return actions;
}

// Picks a heuristic target for a strategem — mirrors AIController._buildCastParams.
function _heuristicStratTarget(gs, type, def, player) {
  const owned = _randomTileOf(gs, player, Math.random);
  if (!owned) return null;

  const TWO_CLICK = new Set(['wind', 'lesserTeleport', 'greaterTeleport']);
  if (def.targeting === 'twoClick' || TWO_CLICK.has(type)) {
    const opp = player === 'player1' ? 'player2' : 'player1';
    const end = _randomTileOf(gs, opp, Math.random) || {
      row: owned.row,
      col: player === 'player2' ? 0 : gs.cols - 1,
    };
    const dirCol = end.col - owned.col;
    const dirRow = end.row - owned.row;
    return {
      owner: player,
      row: owned.row, col: owned.col,
      dirCol: dirCol || (player === 'player2' ? -1 : 1),
      dirRow,
      endCol: end.col, endRow: end.row,
    };
  }

  if (def.targeting === 'tile_ownHalf') {
    const midCol = Math.floor(gs.cols / 2);
    const inHalf = player === 'player1' ? owned.col < midCol : owned.col >= midCol;
    if (!inHalf) return null;
  }

  return { owner: player, row: owned.row, col: owned.col };
}

function _randomTileOf(gs, owner, rng) {
  const tiles = [];
  for (let r = 0; r < gs.rows; r++)
    for (let c = 0; c < gs.cols; c++)
      if (gs.grid[r][c].owner === owner) tiles.push({ row: r, col: c });
  if (!tiles.length) return null;
  return tiles[Math.floor(rng() * tiles.length)];
}

// ---------------------------------------------------------------------------
// clone
// ---------------------------------------------------------------------------

// troop.target is a circular ref to another troop object; strip it before
// serializing. The troop system recalculates targeting next update anyway.
// Fields stripped regardless of cycle detection:
//   - target / lastTarget / attackFlashTarget / grabTarget: troop→troop refs that
//     cause incorrect combat if left as stale copies (troopSystem recalculates them)
//   - garrisonedIn: troop→building ref; losing it un-garrisoned troops in the
//     clone (acceptable for rollouts; avoids pulling building into troop subtree)
const _STRIP_KEYS = new Set([
  'target', 'lastTarget', 'attackFlashTarget', 'grabTarget', 'garrisonedIn',
]);

// Cycle-safe serializer using an ancestor-stack instead of a seen-set.
// A seen-set turns ANY shared object reference into null, causing null slots in
// gs.troops. The ancestor-stack only suppresses TRUE cycles (A→B→…→A) while
// letting shared refs serialize as independent copies. Cross-ref fields that
// would cause stale-object behavior are stripped via _STRIP_KEYS instead.
function safeStringify(obj) {
  const ancestors = [];
  return JSON.stringify(obj, function(key, value) {
    if (_STRIP_KEYS.has(key)) return undefined;
    if (typeof value === 'object' && value !== null) {
      // When 'this' (the parent) changes, we've backtracked in the tree —
      // pop ancestor entries that are no longer on the current path.
      while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
        ancestors.pop();
      }
      if (ancestors.includes(value)) return undefined; // true cycle — skip
      ancestors.push(value);
    }
    return value;
  });
}

function clone(game) {
  // Restore the GameState prototype so instance methods (applyPlayerAction etc.)
  // survive the JSON round-trip.
  const gsData  = JSON.parse(safeStringify(game.gs));
  const gsClone = Object.assign(Object.create(GameState.prototype), gsData);
  // Re-link hero refs — they point into troops[] but JSON breaks that
  gsClone.hero1 = gsClone.troops.find(t => t.isHero && t.owner === 'player1') ?? null;
  gsClone.hero2 = gsClone.troops.find(t => t.isHero && t.owner === 'player2') ?? null;

  // Fresh system instances pointing at gsClone — required so step() updates the
  // right game state. The original systems all hold this.gameState = game.gs,
  // so sharing them would corrupt the original on every rollout step.
  const gl = game.gl;
  const phaseSystem     = new PhaseSystem(gsClone);
  const influenceSystem = new InfluenceSystem(gsClone);
  const resourceSystem  = new ResourceSystem(gsClone);
  const troopSystem     = new TroopSystem(gsClone, gl);
  const buildingSystem  = new BuildingSystem(gsClone, gl);
  const strategemSystem = new StrategemSystem(gsClone, gl);
  const _gsr = { gameLogic: gl, strategemSystem };

  // Restore DeckSystem prototype so draft methods work; deep-clone playerDecks
  // so intermission draft actions in the clone don't bleed into the original.
  const dsClone = Object.assign(Object.create(Object.getPrototypeOf(game.ds)), game.ds);
  dsClone.playerDecks = JSON.parse(JSON.stringify(game.ds.playerDecks));

  return {
    ...game,
    gs: gsClone,
    ds: dsClone,
    _gsr,
    systems: { phaseSystem, influenceSystem, resourceSystem, troopSystem, buildingSystem, strategemSystem },
  };
}

// ---------------------------------------------------------------------------
// terminal / winner / evaluate
// ---------------------------------------------------------------------------

function isTerminal(game) { return game.gs.gameOver; }
function winner(game)     { return game.gs.winner; }

function evaluate(game, player) {
  const gs  = game.gs;
  const opp = player === 'player1' ? 'player2' : 'player1';

  const myHero  = player === 'player1' ? gs.hero1 : gs.hero2;
  const oppHero = player === 'player1' ? gs.hero2 : gs.hero1;
  const myHpFrac  = (myHero  && myHero.maxHp)  ? myHero.hp  / myHero.maxHp  : 0;
  const oppHpFrac = (oppHero && oppHero.maxHp) ? oppHero.hp / oppHero.maxHp : 0;

  let myTiles = 0, oppTiles = 0;
  for (let r = 0; r < gs.rows; r++)
    for (let c = 0; c < gs.cols; c++) {
      const o = gs.grid[r][c].owner;
      if (o === player) myTiles++;
      else if (o === opp) oppTiles++;
    }
  const totalTiles = gs.rows * gs.cols;

  const myRes  = (gs.currentRP[player] ?? 0) + (gs.currentTP[player] ?? 0);
  const oppRes = (gs.currentRP[opp]    ?? 0) + (gs.currentTP[opp]    ?? 0);
  const maxRes = (gs.maxRP[player]     ?? 20) + (gs.maxTP[player]     ?? 10);

  // Troop mass + frontline position: both react immediately to spawns.
  // myFront measures average normalised column depth toward the enemy.
  let myMass = 0, oppMass = 0;
  let myFrontSum = 0, myFrontCt = 0, oppFrontSum = 0, oppFrontCt = 0;
  for (const t of gs.troops) {
    if (!t || t.hp <= 0 || t.isHero) continue;
    const hpFrac = t.maxHp ? t.hp / t.maxHp : 0.5;
    // Depth toward enemy: player1 wants high col, player2 wants low col
    const depth = player === 'player1' ? t.col / (gs.cols - 1) : 1 - t.col / (gs.cols - 1);
    if (t.owner === player) {
      myMass += hpFrac; myFrontSum += depth; myFrontCt++;
    } else if (t.owner === opp) {
      oppMass += hpFrac; oppFrontSum += depth; oppFrontCt++;
    }
  }
  const maxMass  = Math.max(myMass + oppMass, 1);
  const myFront  = myFrontCt  ? myFrontSum  / myFrontCt  : 0.5;
  const oppFront = oppFrontCt ? oppFrontSum / oppFrontCt : 0.5;

  return 0.25 * (myHpFrac - oppHpFrac)
       + 0.30 * (myTiles - oppTiles) / totalTiles
       + 0.10 * (myRes - oppRes) / (maxRes || 1)
       + 0.20 * (myMass - oppMass) / maxMass
       + 0.15 * (myFront - oppFront);
}

module.exports = { createGame, step, legalActions, clone, isTerminal, winner, evaluate, safeStringify };
