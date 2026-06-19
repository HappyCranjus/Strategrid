/**
 * BuildingSystem - Manages building entities and their behaviors
 * @class
 */

/**
 * Add chill stacks to a target troop/hero. Capped at 80; reaching the cap
 * triggers a 1-second freeze and drops stacks back to 25. Exposed on window
 * so any building-fired hit can call it without holding a system reference.
 * Buildings are NOT chillable per design — the caller is responsible for
 * passing in troop/hero targets only.
 */
function applyChillStacks(target, n) {
  if (!target || n <= 0) return;
  target.chillStacks = (target.chillStacks || 0) + n;
  if (target.chillStacks >= 80) {
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    target.frozenUntil = now + 1;
    target.chillStacks = 25;
  }
  if (target.chillDecayTimer == null) target.chillDecayTimer = 0.4;
}
window.applyChillStacks = applyChillStacks;

class BuildingSystem {
  constructor(gameState, gameLogic) {
    this.gameState = gameState;
    this.gameLogic = gameLogic;
  }

  update(deltaTime) {
    const gs = this.gameState;
    const defs = this.gameLogic.buildingTypes;

    for (let i = gs.buildings.length - 1; i >= 0; i--) {
      const b = gs.buildings[i];

      // Passive HP regen (tower turrets have this; others default to 0).
      if (b.hpRegen && b.hp > 0 && b.hp < b.maxHP) {
        b.hp = Math.min(b.maxHP, b.hp + b.hpRegen * deltaTime);
      }

      if (b.hp <= 0) {
        this._onBuildingDestroyed(b);
        gs.buildings.splice(i, 1);
        continue;
      }

      // Tick activation countdown
      if (!b.active) {
        b.activationTime -= deltaTime;
        if (b.activationTime <= 0) {
          b.activationTime = 0;
          b.active = true;
        }
        continue;
      }

      const def = defs[b.type];
      if (!def) continue;

      switch (b.type) {
        case "farm":
          this._updateFarm(b, def, deltaTime);
          break;
        case "supplyDepot":
          this._updateSupplyDepot(b, def, deltaTime);
          break;
        case "cannon":
          this._updateCannon(b, def, deltaTime);
          break;
        case "chillTurret":
          this._updateChillTurret(b, def, deltaTime);
          break;
        case "lavaMortar":
          this._updateLavaMortar(b, def, deltaTime);
          break;
        case "warBonesFactory":
          this._updateWarBonesFactory(b, def, deltaTime);
          break;
        case "towerTurret":
          this._updateRangedTower(b, def, deltaTime);
          break;
        case "reaperTurret":
          this._updateReaperTurret(b, def, deltaTime);
          break;
      }
    }
  }

  /** Farm: generate RP for owner on a timer */
  _updateFarm(b, def, dt) {
    b.bonusTimer = (b.bonusTimer || 0) + dt;
    if (b.bonusTimer >= def.bonusInterval) {
      b.bonusTimer -= def.bonusInterval;
      const gs = this.gameState;
      gs.currentRP[b.owner] = Math.min(
        (gs.currentRP[b.owner] || 0) + def.rpBonus,
        gs.maxRP[b.owner] || 10
      );
    }
  }

  /** Supply Depot: generate TP for owner on a timer (TP analog of Farm). */
  _updateSupplyDepot(b, def, dt) {
    b.bonusTimer = (b.bonusTimer || 0) + dt;
    if (b.bonusTimer >= def.bonusInterval) {
      b.bonusTimer -= def.bonusInterval;
      const gs = this.gameState;
      gs.currentTP[b.owner] = Math.min(
        (gs.currentTP[b.owner] || 0) + def.tpBonus,
        gs.maxTP[b.owner] || 5
      );
    }
  }

  /**
   * Cannon: fire at the highest-current-HP enemy in range each cooldown.
   * Scans both troops and buildings. Used to focus down beefy targets
   * (Heavy, Bunker) instead of chipping at the nearest cheap unit.
   */
  _updateCannon(b, def, dt) {
    b.attackTimer = (b.attackTimer || 0) + dt;
    const target = this._highestHpEnemyInRange(b, def.range);
    b.lastTarget = target;
    if (!target) return;
    if (b.attackTimer < def.attackCooldown) return;

    b.attackTimer = 0;
    window.applyDamage(target, def.damage);
    b.attackFlashTarget = target;
    b.attackFlashUntil = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000 + 0.15;
  }

  /**
   * Chill Turret: rapid-fire low-damage hits on closest enemy troop/hero
   * (NOT buildings), applying chill stacks on each hit. The stack system
   * lives on the troop side; we just deliver damage + call applyChillStacks.
   */
  _updateChillTurret(b, def, dt) {
    b.attackTimer = (b.attackTimer || 0) + dt;
    const target = this._nearestEnemy(b, def.range);
    b.lastTarget = target;
    if (!target) return;
    if (b.attackTimer < def.attackCooldown) return;

    b.attackTimer = 0;
    window.applyDamage(target, def.damage);
    applyChillStacks(target, def.chillStacksPerHit || 2);
    b.attackFlashTarget = target;
    b.attackFlashUntil = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000 + 0.15;
  }

  /**
   * Lava Mortar: long-range artillery. Closest target in range, but ignores
   * anything inside the blind-spot radius (1.5 tiles). Splash damage on
   * impact and spawns a lingering burning patch as an internal strategem
   * entity, so the existing strategemSystem handles its lifetime + DoT tick.
   */
  _updateLavaMortar(b, def, dt) {
    b.attackTimer = (b.attackTimer || 0) + dt;

    // Acquire closest target outside the blind spot.
    const target = this._nearestEnemyOutsideBlindSpot(b, def.range, def.blindSpot || 0);
    b.lastTarget = target;
    if (!target) return;
    if (b.attackTimer < def.attackCooldown) return;

    b.attackTimer = 0;

    // Splash on impact. Ninja cloak is NOT phase-shifted — splash hits and
    // reveals her (cloak-break is in applyDamage); other invisible units
    // (Ambush, Teleport) remain protected.
    for (const t of this.gameState.troops) {
      if (t.owner === b.owner) continue;
      if ((t.invisible && t.type !== "ninja") || t.inFlight) continue;
      const dx = t.col - target.col;
      const dy = t.row - target.row;
      if (Math.sqrt(dx * dx + dy * dy) <= def.splashRadius) {
        window.applyDamage(t, def.damage);
      }
    }

    // Spawn the burning patch via strategemSystem so its lifetime + DoT tick
    // reuse the existing persistent-entity pipeline. Patch tuning lives on
    // the Lava Mortar def (patchDuration/patchRadius/patchDps) so all of the
    // mortar's damage profile is adjustable from one block.
    const ss = window.gameSetupResult && window.gameSetupResult.strategemSystem;
    if (ss) {
      ss.createStrategem("burningPatch", {
        owner: b.owner,
        row: target.row,
        col: target.col,
        duration: def.patchDuration,
        radius: def.patchRadius,
        dps: def.patchDps,
      });
    }

    b.attackFlashTarget = target;
    b.attackFlashUntil = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000 + 0.15;
  }

  /**
   * War Bones Factory: every `spawnInterval` seconds, spawn one skeleton at
   * the edge facing the enemy. The death payload (2 skeletons) is handled
   * in _onBuildingDestroyed, fired before the building is spliced out.
   */
  _updateWarBonesFactory(b, def, dt) {
    b.spawnTimer = (b.spawnTimer || 0) + dt;
    if (b.spawnTimer >= def.spawnInterval) {
      b.spawnTimer -= def.spawnInterval;
      this._spawnSkeletonAt(b, this._frontEdgeOf(b));
    }
  }

  /** Tower Turret: existing behavior, kept verbatim from the old roster. */
  _updateRangedTower(b, def, dt) {
    b.attackTimer = (b.attackTimer || 0) + dt;
    // Always re-acquire so the renderer can draw the tracking line even between shots.
    const target = this._nearestEnemy(b, def.range);
    b.lastTarget = target;
    if (!target) return;
    if (b.attackTimer < def.attackCooldown) return;

    b.attackTimer = 0;
    window.applyDamage(target, def.damage);
    b.attackFlashTarget = target;
    b.attackFlashUntil = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000 + 0.15;
  }

  /**
   * Death payload dispatch. Called BEFORE gs.buildings.splice so the building
   * still has owner/row/col/width/height available.
   */
  _onBuildingDestroyed(b) {
    if (b.type === "warBonesFactory") {
      const def = this.gameLogic.buildingTypes[b.type];
      const n = (def && def.deathSpawnCount) || 2;
      // Scatter the death-burst skeletons around the factory center.
      const cx = b.col + (b.width || 1) / 2;
      const cy = b.row + (b.height || 1) / 2;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const col = cx + Math.cos(a) * 0.6;
        const row = cy + Math.sin(a) * 0.6;
        this._spawnSkeletonAt(b, { row, col });
      }
    }

    // Bunker collapse: dump surviving occupants at the back edge (owner's
    // side) with retained HP. They resume marching from there. Staggered by
    // row across the 1x2 footprint so they don't overlap on spawn.
    if (b.type === "bunker" && b.occupants && b.occupants.length > 0) {
      const gs = this.gameState;
      const cols = gs.cols, rows = gs.rows;
      const colTarget = b.owner === "player1"
        ? b.col - 0.25
        : b.col + (b.width || 1) + 0.25;
      for (let i = 0; i < b.occupants.length; i++) {
        const t = b.occupants[i];
        if (!t) continue;
        const rowTarget = b.row + 0.5 + i; // 0.5, 1.5 for a 1x2 footprint
        t.col = Math.max(0.5, Math.min(cols - 0.5, colTarget));
        t.row = Math.max(0.5, Math.min(rows - 0.5, rowTarget));
        t.garrisonedIn = null;
        t.target = null;
        t.attackTimer = 0;
      }
      b.occupants.length = 0;
    }
  }

  createBuilding(type, row, col, owner) {
    const building = this.gameLogic.createBuilding(type, row, col, owner);
    if (building && this.gameState) {
      this.gameState.buildings.push(building);
    }
    return building;
  }

  /** Place the 4 fixed defensive turrets — 2 per player. Called once after gameState.initialize(). */
  placeInitialTurrets() {
    const positions = [
      { row: 4,  col: 3,  owner: "player1" },
      { row: 11, col: 3,  owner: "player1" },
      { row: 4,  col: 14, owner: "player2" },
      { row: 11, col: 14, owner: "player2" },
    ];
    for (const p of positions) {
      this.createBuilding("towerTurret", p.row, p.col, p.owner);
    }
  }

  /** Find nearest enemy troop within range (tile units) from building center */
  _nearestEnemy(building, range) {
    const cx = building.col + building.width / 2;
    const cy = building.row + building.height / 2;
    let best = null;
    let bestDist = Infinity;

    for (const t of this.gameState.troops) {
      if (t.owner === building.owner) continue;
      if (t.invisible) continue;
      const dx = t.col - cx;
      const dy = t.row - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= range && dist < bestDist) {
        bestDist = dist;
        best = t;
      }
    }
    return best;
  }

  /**
   * Nearest enemy troop within `range` but outside `blindSpot`. Lava Mortar
   * uses this so it can't shoot point-blank.
   */
  _nearestEnemyOutsideBlindSpot(building, range, blindSpot) {
    const cx = building.col + building.width / 2;
    const cy = building.row + building.height / 2;
    let best = null;
    let bestDist = Infinity;

    for (const t of this.gameState.troops) {
      if (t.owner === building.owner) continue;
      if (t.invisible) continue;
      const dx = t.col - cx;
      const dy = t.row - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < blindSpot) continue;
      if (dist <= range && dist < bestDist) {
        bestDist = dist;
        best = t;
      }
    }
    return best;
  }

  /**
   * Cannon targeting: highest current HP enemy in range, scanning both
   * troops and buildings. Tiebreak: closer one wins (deterministic).
   */
  _highestHpEnemyInRange(building, range) {
    const cx = building.col + building.width / 2;
    const cy = building.row + building.height / 2;
    let best = null;
    let bestHp = -Infinity;
    let bestDist = Infinity;

    const consider = (entity, ecx, ecy) => {
      const dx = ecx - cx;
      const dy = ecy - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > range) return;
      const hp = entity.hp;
      if (hp > bestHp || (hp === bestHp && dist < bestDist)) {
        best = entity;
        bestHp = hp;
        bestDist = dist;
      }
    };

    for (const t of this.gameState.troops) {
      if (t.owner === building.owner) continue;
      if (t.invisible) continue;
      consider(t, t.col, t.row);
    }
    for (const e of this.gameState.buildings) {
      if (e === building) continue;
      if (e.owner === building.owner) continue;
      consider(e, e.col + (e.width || 1) / 2, e.row + (e.height || 1) / 2);
    }
    return best;
  }

  /** Tile-coords just outside the factory on the side facing the enemy. */
  _frontEdgeOf(building) {
    const cy = building.row + (building.height || 1) / 2;
    if (building.owner === "player1") {
      return { row: cy, col: building.col + (building.width || 1) + 0.25 };
    }
    return { row: cy, col: building.col - 0.25 };
  }

  _spawnSkeletonAt(building, pos) {
    const gs = this.gameState;
    if (!gs) return;
    const cols = gs.cols, rows = gs.rows;
    const col = Math.max(0.5, Math.min(cols - 0.5, pos.col));
    const row = Math.max(0.5, Math.min(rows - 0.5, pos.row));
    const skel = this.gameLogic.createTroop("skeleton", row, col, building.owner);
    if (skel) gs.troops.push(skel);
  }

  /** Reaper Turret: fires heavy slugs at the enemy hero only; spawns a Reaper every 100 raw damage dealt. */
  _updateReaperTurret(b, def, dt) {
    const gs = this.gameState;
    const hero = b.owner === "player1" ? gs.hero2 : gs.hero1;
    if (!hero || hero.hp <= 0 || hero.invisible) return;

    const cx = b.col + (b.width || 1) / 2;
    const cy = b.row + (b.height || 1) / 2;
    const dx = hero.col - cx, dy = hero.row - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > (def.range || 7)) return;

    b.lastTarget = hero;
    b.attackTimer = (b.attackTimer || 0) + dt;
    if (b.attackTimer < def.attackCooldown) return;

    b.attackTimer = 0;
    window.applyDamage(hero, def.damage);
    b.attackFlashTarget = hero;
    b.attackFlashUntil = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000 + 0.15;

    b.damageAccumulator = (b.damageAccumulator || 0) + def.damage;
    const threshold = def.damagePerReaper || 100;
    while (b.damageAccumulator >= threshold) {
      b.damageAccumulator -= threshold;
      this._spawnReaperAt(b);
    }
  }

  _spawnReaperAt(b) {
    const gs = this.gameState;
    if (!gs) return;
    const row = b.row + (b.height || 1) / 2;
    const col = b.col + (b.width || 1) / 2;
    const reaper = this.gameLogic.createTroop("reaper", row, col, b.owner);
    if (reaper) {
      reaper.active = true;
      reaper.activationTime = 0;
      gs.troops.push(reaper);
    }
  }
}

window.BuildingSystem = BuildingSystem;
