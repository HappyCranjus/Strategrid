/**
 * All building type definitions
 */
const buildingTypes = {
  wall: {
    cost: 1,
    hp: 150,
    activationTime: 0,
    width: 1,
    height: 1,
    color: "#888888",
  },
  farm: {
    cost: 2.5,
    hp: 50,
    activationTime: 3,
    width: 2,
    height: 2,
    color: "#6b8e23",
    rpBonus: 0.5,
    bonusInterval: 15,
  },
  archerTower: {
    cost: 8,
    hp: 80,
    activationTime: 5,
    width: 2,
    height: 2,
    color: "#8a2be2",
    damage: 4,
    range: 6,
    attackCooldown: 1.0,
  },
  sniperOutpost: {
    cost: 3,
    hp: 60,
    activationTime: 4,
    width: 1,
    height: 1,
    color: "#4169e1",
    damage: 25,
    range: 10,
    attackCooldown: 6,
  },
  towerTurret: {
    cost: 0,
    hp: 200,
    activationTime: 0,
    width: 1,
    height: 1,
    color: "#5a6578",
    damage: 6,
    range: 7,
    attackCooldown: 1.0,
    hpRegen: 1.5,
    damageReduction: 0.3,
  },
  warCamp: {
    cost: 5,
    hp: 60,
    activationTime: 2,
    width: 2,
    height: 2,
    color: "#8b4513",
    influenceRadius: 3.5,
    buff: {
      moveSpeedMultiplier: 1.4,
      attackSpeedMultiplier: 1.4,
      healRate: 0.5,
      armorRegenRate: 3,
    },
  },
  missileSilo: {
    cost: 4,
    hp: 80,
    activationTime: 5,
    width: 2,
    height: 2,
    color: "#cc3300",
    damage: 20,
    range: 8,
    attackCooldown: 8,
    splashRadius: 1.5,
  },
};

/**
 * All strategem type definitions
 */
const strategemTypes = {
  heal: {
    tpCost: 2,
    targeting: "tile",
    duration: 8,
    radius: 3,
    color: "#7cff7c",
  },
  divineWind: {
    tpCost: 2,
    targeting: "twoClick",
    duration: 6,
    length: 8,
    width: 4,
    dps: 0,
    pushSpeed: 0.35,
    color: "#a0e0ff",
  },
  blizzard: {
    tpCost: 1.5,
    targeting: "tile",
    duration: 5,
    radius: 3.5,
    slowFactor: 0.3,
    dps: 3,
    color: "#a0d8ff",
  },
  blast: {
    tpCost: 2.5,
    targeting: "tile",
    duration: 0.5,
    instant: true,
    centerDamage: 40,
    centerStun: 0.5,
    adjacentDamage: 15,
    adjacentKnockback: 1,
    color: "#ffd060",
  },
};

/**
 * All troop type definitions
 */
const troopTypes = {
  swordsman: {
    cost: 1.0,
    hp: 45,
    damage: 23,
    attackSpeed: 1.2,
    range: 0.5,
    vision: 5,
    speed: 0.55,
    mass: 1.0,
    radius: 0.25,
  },
  archer: {
    cost: 1.5,
    hp: 22,
    damage: 10,
    attackSpeed: 1.0,
    range: 5.5,
    vision: 6.0,
    speed: 0.35,
    mass: 1.0,
    radius: 0.2,
  },
  heavy: {
    cost: 3.0,
    hp: 350,
    damage: 20,
    attackSpeed: 0.8,
    range: 1.0,
    vision: 5.0,
    speed: 0.1,
    mass: 2.5,
    radius: 0.35,
  },
  militia: {
    cost: 0.5,
    hp: 25,
    damage: 12,
    attackSpeed: 1.8,
    range: 0.6,
    vision: 5.0,
    speed: 0.75,
    mass: 0.75,
    radius: 0.2,
  },
  settler: {
    cost: 1.5,
    hp: 20,
    damage: 0,
    attackSpeed: 0,
    range: 0,
    vision: 0,
    speed: 2.5,
    mass: 1.0,
    radius: 0.2,
  },
  brute: {
    cost: 3.0,
    hp: 185,
    damage: 25,
    attackSpeed: 0.5,
    range: 0.75,
    vision: 5.5,
    speed: 1.25,
    mass: 1.5,
    radius: 0.3,
  },
  sentinel: {
    cost: 2.5,
    hp: 60,
    damage: 3,
    attackSpeed: 4.0,
    range: 4.5,
    vision: 5.5,
    speed: 0.3,
    mass: 1,
    radius: 0.25,
  },
  brickMcStick: {
    cost: 0,
    hp: 500,
    damage: 25,
    attackSpeed: 1.0,
    range: 1.5,
    vision: 5,
    speed: 2,
    mass: 3.0,
    radius: 0.42,
    isHero: true,
    hpRegen: 4,
    damageReduction: 0.5,
  },
  strategia: {
    cost: 0,
    hp: 300,
    damage: 13,
    attackSpeed: 1.5,
    range: 7,
    vision: 7,
    speed: 1.25,
    mass: 2.5,
    radius: 0.35,
    isHero: true,
    hpRegen: 2,
    damageReduction: 0.5,
  },
};

/**
 * GameLogic - 1Core game logic and entity creation
 * @class
 */
class GameLogic {
  constructor() {
    this.buildingTypes = buildingTypes;
    this.troopTypes = troopTypes;
    this.strategemTypes = strategemTypes;
  }

  createTroop(type, row, col, owner) {
    const def = troopTypes[type];
    if (!def) {
      console.warn(`[GameLogic] Unknown troop type: ${type}`);
      return null;
    }
    return {
      type,
      owner,
      row,
      col,
      hp: def.hp,
      maxHP: def.hp,
      damage: def.damage,
      attackSpeed: def.attackSpeed,
      range: def.range,
      vision: def.vision != null ? def.vision : def.range,
      speed: def.speed,
      cost: def.cost,
      mass: def.mass != null ? def.mass : 1.0,
      radius: def.radius != null ? def.radius : 0.25,
      isHero: !!def.isHero,
      hpRegen: def.hpRegen || 0,
      damageReduction: def.damageReduction || 0,
      attackTimer: 0,
      moveTimer: 0,
    };
  }

  createBuilding(type, row, col, owner) {
    const def = buildingTypes[type];
    if (!def) {
      console.warn(`[GameLogic] Unknown building type: ${type}`);
      return null;
    }

    const building = {
      type,
      owner,
      row,
      col,
      width: def.width,
      height: def.height,
      hp: def.hp,
      maxHP: def.hp,
      cost: def.cost,
      activationTime: def.activationTime,
      active: def.activationTime <= 0,
      hpRegen: def.hpRegen || 0,
      damageReduction: def.damageReduction || 0,
    };

    if (type === "farm") building.bonusTimer = 0;
    if (
      type === "archerTower" ||
      type === "sniperOutpost" ||
      type === "missileSilo" ||
      type === "towerTurret"
    ) {
      building.attackTimer = 0;
    }

    return building;
  }

  /**
   * Create a persistent strategem entity. Per-type fields (dirCol/dirRow for
   * Divine Wind) are read from params. Returns null for unknown types.
   */
  createStrategem(type, params) {
    const def = strategemTypes[type];
    if (!def) {
      console.warn(`[GameLogic] Unknown strategem type: ${type}`);
      return null;
    }
    const s = {
      type,
      owner: params.owner,
      row: params.row,
      col: params.col,
      age: 0,
      duration: def.duration || 0,
    };
    if (type === "divineWind") {
      s.dirCol = params.dirCol || (params.owner === "player1" ? 1 : -1);
      s.dirRow = params.dirRow || 0;
      const mag = Math.sqrt(s.dirCol * s.dirCol + s.dirRow * s.dirRow) || 1;
      s.dirCol /= mag;
      s.dirRow /= mag;
    }
    // heal: pulse schedule handled by strategemSystem reading s.age
    // blizzard: per-frame application; no extra state
    // blast: instant effect applied by caller; entity is a 0.5s flash
    return s;
  }
}

// Export for browser
window.GameLogic = GameLogic;
window.buildingTypes = buildingTypes;
window.troopTypes = troopTypes;
window.strategemTypes = strategemTypes;
