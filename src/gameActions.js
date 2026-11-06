/**
 * gameActions - Pure game-logic functions for spawn/build/strategem.
 *
 * No DOM, no audio, no canvas. Called directly by gameState.applyPlayerAction
 * and by the headless simulator. uiState wraps these functions and adds audio.
 */

/** Forward-most surviving towerTurret column for owner (null if none). */
function _turretFrontierCol(gs, owner) {
  let frontier = null;
  for (const b of gs.buildings) {
    if (b.type !== "towerTurret" || b.owner !== owner) continue;
    if (frontier === null) frontier = b.col;
    else if (owner === "player1") frontier = Math.max(frontier, b.col);
    else frontier = Math.min(frontier, b.col);
  }
  return frontier;
}

/**
 * Checks whether a troop spawn at (col, row) is legal for owner.
 * Returns { zoneOK, affordOK, instant, frontier }.
 * Mirrors UIState.getSpawnEligibility — keep in sync.
 */
function checkSpawnLegality(gs, gl, col, row, owner, troopType) {
  const inBounds =
    Number.isInteger(col) && Number.isInteger(row) &&
    col >= 0 && col < gs.cols && row >= 0 && row < gs.rows;
  const tileOwner = inBounds ? gs.grid[row][col].owner : null;

  let zoneOK;
  if (troopType === "ninja") {
    const enemyBackCol = (owner === "player1") ? gs.cols - 1 : 0;
    zoneOK = inBounds && col === enemyBackCol;
  } else {
    zoneOK = inBounds && tileOwner === owner;
    if (zoneOK) {
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of dirs) {
        const nr = row + dr, nc = col + dc;
        if (nr < 0 || nr >= gs.rows || nc < 0 || nc >= gs.cols) { zoneOK = false; break; }
        if (gs.grid[nr][nc].owner !== owner) { zoneOK = false; break; }
      }
    }
  }

  const def = (gl.troopTypes || {})[troopType] || {};
  const cost   = def.cost   || 0;
  const tpCost = def.tpCost || 0;
  const affordOK = (gs.currentRP[owner] || 0) >= cost
                && (gs.currentTP[owner] || 0) >= tpCost;

  const frontier = _turretFrontierCol(gs, owner);
  const instant  = frontier !== null && (
    owner === "player1" ? col <= frontier : col >= frontier
  );

  return { zoneOK, affordOK, instant, frontier };
}

/**
 * Spawns a troop at (row, col) for owner. Returns true on success.
 * Mirrors UIState._trySpawnTroop — keep in sync.
 */
function spawnTroop(gs, gl, row, col, owner, troopType) {
  const elig = checkSpawnLegality(gs, gl, col, row, owner, troopType);
  if (!elig.zoneOK || !elig.affordOK) return false;

  const troop = gl.createTroop(troopType, row, col, owner);
  if (!troop) return false;

  if (elig.instant) {
    troop.active = true;
    troop.activationTime = 0;
    troop.activationDuration = 0;
  } else {
    troop.active = false;
    troop.activationTime = 1.2;
    troop.activationDuration = 1.2;
  }
  // Settlers always use their full activation window regardless of spawn position.
  if (troopType === "settler") {
    troop.active = false;
    troop.activationTime = 3.5;
    troop.activationDuration = 3.5;
  }
  if (troopType === "ninja") {
    const def = (gl.troopTypes || {}).ninja || {};
    const now = gs.matchTime || 0;
    troop.invisible         = true;
    troop.cloakActive       = true;
    troop.cloakedUntil      = now + (def.spawnCloakDuration || 5.0);
    troop.firstAttackPending = true;
  }

  const rpCostTroop = troop.cost || 0;
  const tpCost = ((gl.troopTypes || {})[troopType] || {}).tpCost || 0;
  gs.currentRP[owner] -= rpCostTroop;
  if (tpCost > 0) gs.currentTP[owner] -= tpCost;
  gs.troops.push(troop);
  if (gs.matchStats) {
    gs.matchStats[owner].troopsSpawned++;
    gs.matchStats[owner].rpSpent += rpCostTroop;
    gs.matchStats[owner].tpSpent += tpCost;
  }
  return true;
}

/**
 * Places a building at (row, col) for owner. Returns true on success.
 * Mirrors UIState._tryPlaceBuilding — keep in sync.
 */
function placeBuilding(gs, gl, row, col, owner, buildingType) {
  const midCol = Math.floor(gs.cols / 2);
  if (gs.gameMode !== "sandbox") {
    if (owner === "player1" && (col < 1 || col >= midCol)) return false;
    if (owner === "player2" && (col < midCol || col > gs.cols - 2)) return false;
  }

  const building = gl.createBuilding(buildingType, row, col, owner);
  if (!building) return false;

  const def    = (gl.buildingTypes || {})[buildingType] || {};
  const rpCost = building.cost || 0;
  const tpCost = def.tpCost    || 0;
  if ((gs.currentRP[owner] || 0) < rpCost) return false;
  if ((gs.currentTP[owner] || 0) < tpCost) return false;

  for (let r = row; r < row + building.height; r++) {
    for (let c = col; c < col + building.width; c++) {
      if (r >= gs.rows || c >= gs.cols) return false;
      const occupied = gs.buildings.some(
        (b) => c >= b.col && c < b.col + b.width && r >= b.row && r < b.row + b.height
      );
      if (occupied) return false;
    }
  }

  gs.currentRP[owner] -= rpCost;
  if (tpCost) gs.currentTP[owner] -= tpCost;
  gs.buildings.push(building);
  if (gs.matchStats) {
    gs.matchStats[owner].buildingsPlaced++;
    gs.matchStats[owner].rpSpent += rpCost;
    if (tpCost) gs.matchStats[owner].tpSpent += tpCost;
  }
  return true;
}

/**
 * Commits a strategem for owner. Returns true on success.
 * Mirrors UIState._commitStrategem — keep in sync.
 * params shape: { owner, row, col } or { owner, row, col, dirCol, dirRow, endCol, endRow }
 */
function commitStrategem(gs, gl, ss, owner, strategemType, params) {
  const def    = (gl.strategemTypes || {})[strategemType] || {};
  const tpCost = def.tpCost || 0;
  if ((gs.currentTP[owner] || 0) < tpCost) return false;
  if (def.cooldown != null && ss && !ss.isReady(owner, strategemType)) return false;
  if (!ss) return false;
  const entity = ss.createStrategem(strategemType, params);
  if (!entity) return false;
  gs.currentTP[owner] = Math.max(0, (gs.currentTP[owner] || 0) - tpCost);
  if (gs.matchStats && tpCost) gs.matchStats[owner].tpSpent += tpCost;
  return true;
}

window.gameActions = { checkSpawnLegality, spawnTroop, placeBuilding, commitStrategem };
