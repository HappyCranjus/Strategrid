/**
 * BuildingSystem - Manages building entities and their behaviors
 * @class
 */
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
        case "warCamp":
          this._updateWarCamp(b, def, deltaTime);
          break;
        case "archerTower":
        case "sniperOutpost":
        case "towerTurret":
          this._updateRangedTower(b, def, deltaTime);
          break;
        case "missileSilo":
          this._updateMissileSilo(b, def, deltaTime);
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

  /** War Camp: buff nearby friendly troops each frame */
  _updateWarCamp(b, def, dt) {
    const cx = b.col + b.width / 2;
    const cy = b.row + b.height / 2;
    for (const t of this.gameState.troops) {
      if (t.owner !== b.owner) continue;
      const dx = t.col - cx;
      const dy = t.row - cy;
      if (Math.sqrt(dx * dx + dy * dy) > def.influenceRadius) continue;

      t.hp = Math.min(t.hp + def.buff.healRate * dt, t.maxHP);
      t._warCampBuff = {
        moveSpeedMultiplier: def.buff.moveSpeedMultiplier,
        attackSpeedMultiplier: def.buff.attackSpeedMultiplier,
      };
    }
  }

  /** Archer Tower / Sniper Outpost / Tower Turret: fire at nearest enemy on cooldown */
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

  /** Missile Silo: fire AOE at nearest enemy cluster on cooldown */
  _updateMissileSilo(b, def, dt) {
    b.attackTimer = (b.attackTimer || 0) + dt;
    if (b.attackTimer < def.attackCooldown) return;

    const target = this._nearestEnemy(b, def.range);
    if (!target) return;

    b.attackTimer = 0;

    for (const t of this.gameState.troops) {
      if (t.owner === b.owner) continue;
      const dx = t.col - target.col;
      const dy = t.row - target.row;
      if (Math.sqrt(dx * dx + dy * dy) <= def.splashRadius) {
        window.applyDamage(t, def.damage);
      }
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
}

window.BuildingSystem = BuildingSystem;
