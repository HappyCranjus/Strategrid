/**
 * All building type definitions
 */
const buildingTypes = {
  wall: {
    cost: 0.5,
    hp: 100,
    activationTime: 0,
    width: 1,
    height: 1,
    color: "#888888",
  },
  farm: {
    cost: 2,
    hp: 40,
    activationTime: 2,
    width: 1,
    height: 1,
    color: "#6b8e23",
    rpBonus: 0.1,
    bonusInterval: 5,
  },
  cannon: {
    cost: 5,
    hp: 105,
    activationTime: 4,
    width: 0.5,
    height: 0.5,
    color: "#5a3a2a",
    damage: 50,
    range: 7,
    attackCooldown: 2.5,
  },
  bunker: {
    cost: 4,
    hp: 400,
    activationTime: 0,
    width: 1,
    height: 2,
    color: "#4a4a4a",
    damageReduction: 0.4,
    // Garrison: ranged friendly troops (range >= garrisonRangeThreshold) enter
    // on contact and fire from inside. A third arrival pushes the oldest out
    // the front (FIFO). The Bunker absorbs (1 - damageShieldRatio) of incoming
    // damage; the rest is split evenly among occupants. All tuning is here so
    // the whole identity is one block.
    garrisonSlots: 2,
    garrisonRangeThreshold: 2.0,
    damageShieldRatio: 0.3,
  },
  supplyDepot: {
    cost: 2,
    hp: 40,
    activationTime: 3,
    width: 1,
    height: 1,
    color: "#c08040",
    tpBonus: 0.1,
    bonusInterval: 8,
  },
  warBonesFactory: {
    cost: 6,
    hp: 100,
    activationTime: 5,
    width: 1,
    height: 1,
    color: "#dcdcdc",
    spawnInterval: 3.5,
    deathSpawnCount: 3,
  },
  chillTurret: {
    cost: 4,
    hp: 60,
    activationTime: 4,
    width: 0.25,
    height: 0.25,
    color: "#a0d8ff",
    damage: 1,
    range: 7.5,
    attackCooldown: 0.2,
    chillStacksPerHit: 2,
  },
  lavaMortar: {
    cost: 6,
    hp: 80,
    activationTime: 5,
    width: 0.25,
    height: 0.25,
    color: "#cc3300",
    damage: 15,
    range: 7.5,
    attackCooldown: 5,
    splashRadius: 1.25,
    blindSpot: 1.5,
    // Lingering burning patch left on impact. All patch tuning lives here so
    // the Lava Mortar's whole damage profile (impact + DoT) is one block.
    patchDuration: 3, // seconds the patch lingers
    patchRadius: 1.25, // tiles affected
    patchDps: 6, // HP/sec to enemies standing in the patch
  },
  towerTurret: {
    cost: 0,
    hp: 200,
    activationTime: 0,
    width: 1,
    height: 1,
    color: "#5a6578",
    damage: 8,
    range: 7,
    attackCooldown: 0.5,
    hpRegen: 0.2,
    damageReduction: 0.3,
  },
  reaperTurret: {
    cost: 8,
    hp: 150,
    activationTime: 3,
    width: 1,
    height: 1,
    color: "#3a0010",
    damage: 6,
    range: 7,
    attackCooldown: 0.333,
    damagePerReaper: 30,
  },
};

/**
 * All strategem type definitions. The deck-visible roster (heal..greaterTeleport)
 * each carry a `cooldown` (seconds, starts at cast) and a `tpCost`. `burningPatch`
 * is spawned by the Lava Mortar and never exposed to the deck builder.
 */
const strategemTypes = {
  heal: {
    tpCost: 1.0,
    cooldown: 5,
    targeting: "tile",
    duration: 3.5,
    radius: 3,
    initialHeal: 15,
    pulseHeal: 5,
    color: "#7cff7c",
  },
  wind: {
    tpCost: 1.0,
    cooldown: 5,
    targeting: "twoClick",
    duration: 6,
    length: 8,
    width: 4,
    dps: 0,
    pushSpeed: 0.35,
    color: "#a0e0ff",
  },
  necromancy: {
    tpCost: 2,
    cooldown: 5,
    targeting: "tile",
    duration: 18,
    radius: 6,
    dps: 1,
    spawnDelay: 0.3,
    color: "#7d4ea0",
  },
  ruin: {
    tpCost: 2.5,
    cooldown: 5,
    targeting: "tile",
    duration: 4,
    radius: 2,
    activationTime: 4,
    buildingDamage: 250,
    towerTurretDamage: 25,
    heroDamage: 25,
    color: "#b08060",
  },
  blast: {
    tpCost: 1.5,
    cooldown: 5,
    targeting: "tile",
    duration: 0.5,
    instant: true,
    centerDamage: 40,
    centerStun: 0.5,
    adjacentDamage: 15,
    adjacentKnockback: 1,
    color: "#ffd060",
  },
  chainLightning: {
    tpCost: 2.5,
    cooldown: 5,
    targeting: "tile",
    duration: 15,
    activationTime: 3,
    strikeInterval: 2,
    totalStrikes: 6,
    chainReach: 2.25,
    maxChainHits: 6,
    troopDamage: 42,
    buildingDamage: 6,
    heroDamage: 12,
    color: "#ff40c0",
  },
  gravityField: {
    tpCost: 2.0,
    cooldown: 5,
    targeting: "tile",
    duration: 4,
    radius: 4,
    pullSpeed: 1.5,
    color: "#3050a0",
  },
  lesserTeleport: {
    tpCost: 2.5,
    cooldown: 5,
    targeting: "twoClick",
    duration: 4.5,
    activationTime: 4,
    appearDelay: 0.5,
    zoneRadius: 0,
    color: "#a060ff",
  },
  greaterTeleport: {
    tpCost: 3.5,
    cooldown: 5,
    targeting: "twoClick",
    duration: 8.5,
    activationTime: 8,
    appearDelay: 0.5,
    zoneRadius: 1,
    color: "#c060ff",
  },
  // Chronomancy trio: persistent tile-AoE buffs/debuffs. Effect is refreshed
  // per frame on troops inside the zone; a `tailDuration` of ~0.5s lets the
  // effect linger briefly after a troop leaves. Heroes get muted multipliers.
  chronoHaste: {
    tpCost: 2,
    cooldown: 5,
    targeting: "tile",
    duration: 5,
    radius: 2,
    troopSpeed: 2.0,
    troopAttack: 1.5,
    heroSpeed: 1.5,
    heroAttack: 1.25,
    tailDuration: 0.5,
    color: "#ffd95a",
  },
  chronoSlow: {
    tpCost: 2.5,
    cooldown: 5,
    targeting: "tile",
    duration: 8,
    radius: 3,
    troopSpeed: 0.4,
    troopAttack: 0.6,
    heroSpeed: 0.7,
    heroAttack: 0.8,
    tailDuration: 0.5,
    color: "#60c0ff",
  },
  chronoStop: {
    tpCost: 3,
    cooldown: 5,
    targeting: "tile",
    duration: 4,
    radius: 1.5,
    pulseInterval: 0.5,
    troopStunDuration: 0.5,
    heroStunDuration: 0.25,
    color: "#c060ff",
  },
  // Internal-only: spawned by Lava Mortar, never exposed to deck builder.
  burningPatch: {
    tpCost: 0,
    targeting: "internal",
    duration: 4.5,
    radius: 2,
    dps: 5,
    color: "#ff6022",
  },
};

/**
 * Hero ability definitions. Bound to a specific hero via `heroType`.
 * Activated by SPACEBAR (P1) or ENTER (sandbox P2). Mirrors the strategem
 * tpCost/cooldown contract so the same gating + UI overlay code applies.
 */
const heroAbilityTypes = {
  summoningStrike: {
    heroType: "brickMcStick",
    tpCost: 1.5,
    cooldown: 10,
    radius: 1, // 3x3 box: |dCol|<=1 && |dRow|<=1
    damage: 60,
    knockback: 1.5,
    summonType: "swordsman",
    summonCount: 3,
    healAmount: 50,
    color: "#ffb050",
  },
  ambush: {
    heroType: "strategia",
    tpCost: 1.5,
    cooldown: 10,
    duration: 3,
    hasteFactor: 1.5,
    hasteAttackFactor: 1.5,
    summonSpec: [
      { type: "archer", count: 1 },
      { type: "militia", count: 1 },
    ],
    color: "#c060ff",
  },
};

/**
 * All troop type definitions
 */
const troopTypes = {
  swordsman: {
    cost: 1.5,
    hp: 45,
    damage: 17,
    attackSpeed: 1.2,
    range: 1,
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
    hp: 450,
    damage: 20,
    attackSpeed: 0.8,
    range: 1.0,
    vision: 5.0,
    speed: 0.1,
    mass: 1.5,
    radius: 0.35,
  },
  militia: {
    cost: 0.5,
    hp: 25,
    damage: 12,
    attackSpeed: 1.8,
    range: 1,
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
    hp: 220,
    damage: 30,
    attackSpeed: 1,
    range: 1,
    vision: 5.5,
    speed: 0.6,
    mass: 1.25,
    radius: 0.3,
    berserkerHeal: 20,
    berserkerDuration: 2,
    berserkerSpeedFactor: 5.0,
    berserkerAttackFactor: 3.0,
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
  bannerman: {
    cost: 4.0,
    hp: 400,
    damage: 0,
    attackSpeed: 0,
    range: 0,
    vision: 0,
    speed: 0.1,
    mass: 2.0,
    radius: 0.35,
    inspireBackCols: 7,
    inspireSideRows: 2,
    inspireSpeedFactor: 1.2,
    inspireAttackFactor: 1.2,
    inspireRegen: 1.0,
  },
  gustKnight: {
    cost: 2.5,
    hp: 120,
    damage: 22,
    attackSpeed: 1,
    range: 1.8,
    vision: 5.0,
    speed: 0.55,
    mass: 1.15,
    radius: 0.3,
    gustKnockback: 1.25,
    gustLength: 3,
    gustWidth: 2,
    splashDamage: 11,
  },
  grenadier: {
    cost: 3,
    hp: 55,
    damage: 25,
    attackSpeed: 0.5,
    range: 3.5,
    vision: 5.0,
    speed: 0.5,
    mass: 1.0,
    radius: 0.3,
    splashRadius: 1.5,
    splashDamage: 25,
  },
  invisiWitch: {
    cost: 4,
    hp: 40,
    damage: 5,
    attackSpeed: 0.8,
    range: 4.0,
    vision: 5.0,
    speed: 0.3,
    mass: 1.0,
    radius: 0.3,
    cloakRadius: 2.0,
    cloakCycleDuration: 4.5,
    cloakActiveDuration: 2.0,
  },
  ninja: {
    cost: 4,
    hp: 55,
    damage: 8,
    attackSpeed: 1.5,
    range: 4.0,
    meleeDamage: 20,
    meleeAttackSpeed: 1.5,
    meleeRange: 1.2,
    vision: 5.5,
    speed: 2,
    mass: 0.9,
    radius: 0.3,
    spawnCloakDuration: 5.0,
  },
  ogre: {
    cost: 7,
    hp: 350,
    damage: 25,
    attackSpeed: 0.6,
    range: 1.2,
    vision: 5.5,
    speed: 0.25,
    mass: 2.5,
    radius: 0.45,
    displaySize: 2.0,
    throwRange: 5.5,
    throwBlindSpot: 1.5,
    throwCooldown: 3.5,
    grabDuration: 0.25,
    flightDuration: 0.4,
    flightArcHeight: 2.5,
    impactDamage: 30,
    splashRadius: 1.0,
    splashDamage: 20,
  },
  warMachine: {
    cost: 10,
    tpCost: 0,
    hp: 700,
    // PRIMARY: Machine Gun — sentinel-style, closest target
    damage: 3,
    attackSpeed: 4.0,
    range: 3.0,
    // SECONDARY: Cannon — slow heavy hit, highest-HP target (handled by _updateWarMachineCannons)
    cannonDamage: 50,
    cannonAttackCooldown: 2.5,
    cannonRange: 5.0,
    vision: 5.5,
    speed: 0.2,
    mass: 3.0,
    radius: 0.5,
    displaySize: 1.8,
    commandoSpawnInterval: 7,
  },
  commando: {
    cost: 0,
    hp: 80,
    damage: 3,
    attackSpeed: 0.5,
    range: 3.5,
    vision: 5.0,
    speed: 0.45,
    mass: 1.0,
    radius: 0.3,
    splashRadius: 1.5,
    splashDamage: 3,
  },
  skeleton: {
    cost: 0,
    hp: 15,
    damage: 5,
    attackSpeed: 2,
    range: 1,
    vision: 5,
    speed: 0.55,
    mass: 0.8,
    radius: 0.2,
  },
  reaper: {
    cost: 0,
    hp: 40,
    damage: 18,
    attackSpeed: 1.5,
    range: 0.8,
    vision: 99,
    speed: 4.5,
    mass: 0.8,
    radius: 0.25,
    targetHeroOnly: true,
    color: "#800040",
  },
  zombie: {
    cost: 0,
    hp: 250,
    damage: 25,
    attackSpeed: 1,
    range: 1.0,
    vision: 5.5,
    speed: 0.1,
    mass: 1.3,
    radius: 0.3,
  },
  brickMcStick: {
    cost: 0,
    hp: 400,
    damage: 20,
    attackSpeed: 1.2,
    range: 1.5,
    vision: 5,
    speed: 2.25,
    mass: 2.0,
    radius: 0.42,
    isHero: true,
    hpRegen: 1.75,
    damageReduction: 0.5,
  },
  strategia: {
    cost: 0,
    hp: 245,
    damage: 13,
    attackSpeed: 1.5,
    range: 4.5,
    vision: 4.5,
    speed: 1.75,
    mass: 1.25,
    radius: 0.35,
    isHero: true,
    hpRegen: 1,
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
    this.heroAbilityTypes = heroAbilityTypes;
  }

  /**
   * Resolve the ability def bound to a given hero type. Returns null when
   * the hero has no ability registered.
   */
  getHeroAbility(heroType) {
    for (const key in heroAbilityTypes) {
      if (heroAbilityTypes[key].heroType === heroType) {
        return Object.assign({ key }, heroAbilityTypes[key]);
      }
    }
    return null;
  }

  createTroop(type, row, col, owner) {
    const def = troopTypes[type];
    if (!def) {
      console.warn(`[GameLogic] Unknown troop type: ${type}`);
      return null;
    }
    // Rows are 0..15 in the standard 16-row grid; mid-row (8) decides which
    // way Settler zig-zag and Sentinel patrol head on their first leg, so a
    // troop deployed in the top half initially moves down, and vice versa.
    const startDir = row < 8 ? +1 : -1;
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
      deployedRow: row,
      deployedCol: col,
      zigDir: startDir,
      zigPhase: "vertical",
      zigTargetCol: col,
      patrolDir: startDir,
      patrolBroken: false,
      garrisonedIn: null,
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

    if (type === "farm" || type === "supplyDepot") building.bonusTimer = 0;
    if (type === "warBonesFactory") building.spawnTimer = 0;
    if (type === "bunker") building.occupants = [];
    if (
      type === "cannon" ||
      type === "chillTurret" ||
      type === "lavaMortar" ||
      type === "towerTurret" ||
      type === "reaperTurret"
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
      duration: params.duration != null ? params.duration : def.duration || 0,
    };
    if (type === "burningPatch") {
      // Per-instance overrides so the caller (e.g. Lava Mortar) owns the tuning.
      s.radius = params.radius != null ? params.radius : def.radius;
      s.dps = params.dps != null ? params.dps : def.dps;
    }
    if (type === "wind") {
      s.dirCol = params.dirCol || (params.owner === "player1" ? 1 : -1);
      s.dirRow = params.dirRow || 0;
      const mag = Math.sqrt(s.dirCol * s.dirCol + s.dirRow * s.dirRow) || 1;
      s.dirCol /= mag;
      s.dirRow /= mag;
    }
    if (type === "heal") {
      // Track which pulse ages have already fired so the renderer / updater
      // doesn't double-pulse on a long frame.
      s.firedInitial = false;
    }
    if (type === "necromancy") {
      // Spawn cycle: 4 skeletons then 1 zombie, repeating. pendingSpawns are
      // queued on enemy deaths inside the zone and fire `spawnDelay` later.
      s.spawnCycleIndex = 0;
      s.pendingSpawns = [];
    }
    if (type === "chainLightning") {
      // strikesFired counts off the 6 strikes scheduled at activationTime,
      // activationTime + strikeInterval, ... lastHits / lastHitsAge feed the
      // transient polyline renderer.
      s.strikesFired = 0;
      s.lastHits = [];
      s.lastHitsAge = 0;
    }
    if (type === "lesserTeleport" || type === "greaterTeleport") {
      s.startCol = params.col;
      s.startRow = params.row;
      s.endCol = params.endCol != null ? params.endCol : params.col;
      s.endRow = params.endRow != null ? params.endRow : params.row;
      s.phase = "arming";
      s.cargo = [];
    }
    // blast: instant effect applied by caller; entity is a 0.5s flash
    // ruin: damage applied once at activationTime
    // burningPatch: per-frame DOT applied by strategemSystem
    return s;
  }
}

// Export for browser
window.GameLogic = GameLogic;
window.buildingTypes = buildingTypes;
window.troopTypes = troopTypes;
window.strategemTypes = strategemTypes;
window.heroAbilityTypes = heroAbilityTypes;
