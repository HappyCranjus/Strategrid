/**
 * StrategemSystem - Manages persistent strategem entities and their effects.
 *
 * Heal Burst, Wind, Necromancy, Ruin, Blast, Chain Lightning, Gravity Field,
 * Lesser Teleport, Greater Teleport. Plus the internal `burningPatch` spawned
 * by Lava Mortar (never deck-exposed).
 *
 * Per-strategem-type cooldown is centralized here: createStrategem refuses if
 * the owner's timer for that key is > 0, and arms the timer on success. The
 * timer table lives on gameState.strategemCooldowns so it survives snapshot
 * round-trips.
 *
 * @class
 */

// Heal Burst: instant +15 HP on cast, then +5 HP at each of these ages.
const HEAL_PULSE_AGES = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5];

class StrategemSystem {
  constructor(gameState, gameLogic) {
    this.gameState = gameState;
    this.gameLogic = gameLogic;
  }

  update(deltaTime) {
    const gs = this.gameState;
    if (!gs || gs.gameOver) return;

    this._tickCooldowns(deltaTime);
    this._tickHeroAbilityCooldowns(deltaTime);

    const defs = this.gameLogic.strategemTypes || (window.strategemTypes || {});

    for (let i = gs.strategems.length - 1; i >= 0; i--) {
      const s = gs.strategems[i];
      const prevAge = s.age;
      s.age += deltaTime;

      const def = defs[s.type];
      if (def) {
        switch (s.type) {
          case "heal":            this._updateHeal(s, def, deltaTime, prevAge); break;
          case "wind":            this._updateWind(s, def, deltaTime); break;
          case "necromancy":      this._updateNecromancy(s, def, deltaTime); break;
          case "ruin":            this._updateRuin(s, def, deltaTime, prevAge); break;
          case "blast":           /* instant on cast; entity is a 0.5s flash */ break;
          case "chainLightning":  this._updateChainLightning(s, def, deltaTime); break;
          case "gravityField":    this._updateGravityField(s, def, deltaTime); break;
          case "lesserTeleport":  this._updateTeleport(s, def, deltaTime, prevAge, 0); break;
          case "greaterTeleport": this._updateTeleport(s, def, deltaTime, prevAge, def.zoneRadius || 1); break;
          case "chronoHaste":     this._updateChronoHaste(s, def, deltaTime); break;
          case "chronoSlow":      this._updateChronoSlow(s, def, deltaTime); break;
          case "chronoStop":      this._updateChronoStop(s, def, deltaTime, prevAge); break;
          case "burningPatch":    this._updateBurningPatch(s, def, deltaTime); break;
        }
      }

      if (s.age >= s.duration) {
        if ((s.type === "lesserTeleport" || s.type === "greaterTeleport") && s.phase !== "done") {
          const zr = s.type === "greaterTeleport" ? ((def && def.zoneRadius) || 1) : 0;
          this._forceTeleportDrop(s, zr);
        }
        gs.strategems.splice(i, 1);
      }
    }
  }

  /** Decrement every active per-owner per-type cooldown timer; floor at 0. */
  _tickCooldowns(dt) {
    const cds = this.gameState && this.gameState.strategemCooldowns;
    if (!cds) return;
    for (const owner of ["player1", "player2"]) {
      const map = cds[owner];
      if (!map) continue;
      for (const k in map) {
        if (map[k] > 0) map[k] = Math.max(0, map[k] - dt);
      }
    }
  }

  /** Convenience: true iff the owner currently can cast `type`. */
  isReady(owner, type) {
    const cds = this.gameState && this.gameState.strategemCooldowns;
    if (!cds || !owner || !type) return true;
    return ((cds[owner] && cds[owner][type]) || 0) <= 0;
  }

  /** Mirror of _tickCooldowns for the hero-ability table. */
  _tickHeroAbilityCooldowns(dt) {
    const cds = this.gameState && this.gameState.heroAbilityCooldowns;
    if (!cds) return;
    for (const owner of ["player1", "player2"]) {
      const map = cds[owner];
      if (!map) continue;
      for (const k in map) {
        if (map[k] > 0) map[k] = Math.max(0, map[k] - dt);
      }
    }
  }

  /** True iff the owner's hero ability is off cooldown. */
  isHeroAbilityReady(owner, heroType) {
    const cds = this.gameState && this.gameState.heroAbilityCooldowns;
    if (!cds || !owner || !heroType) return true;
    return ((cds[owner] && cds[owner][heroType]) || 0) <= 0;
  }

  /**
   * Attempt to activate the owner's hero ability. Gates on hero alive, TP,
   * and per-hero cooldown. On success, deducts TP, arms cooldown, dispatches
   * to the hero-specific cast. Returns true on cast, false on any gate fail.
   */
  tryActivateHeroAbility(owner) {
    const gs = this.gameState;
    if (!gs || gs.gameOver) return false;
    const hero = (owner === "player1") ? gs.hero1 : gs.hero2;
    if (!hero || hero.hp <= 0) return false;
    const def = this.gameLogic.getHeroAbility && this.gameLogic.getHeroAbility(hero.type);
    if (!def) return false;
    if (!this.isHeroAbilityReady(owner, hero.type)) return false;
    if ((gs.currentTP[owner] || 0) < def.tpCost) return false;

    gs.currentTP[owner] = Math.max(0, gs.currentTP[owner] - def.tpCost);
    if (!gs.heroAbilityCooldowns) gs.heroAbilityCooldowns = { player1: {}, player2: {} };
    if (!gs.heroAbilityCooldowns[owner]) gs.heroAbilityCooldowns[owner] = {};
    gs.heroAbilityCooldowns[owner][hero.type] = def.cooldown;

    switch (hero.type) {
      case "brickMcStick": this._castSummoningStrike(hero, def); break;
      case "strategia":    this._castAmbush(hero, def); break;
    }
    return true;
  }

  /**
   * Summoning Strike: 3x3 AoE damage + knockback around Brick's tile, spawns
   * 3 friendly Swordsmen on his tile, heals Brick up to maxHP. Buildings are
   * untouched; the ability is troop-focused.
   */
  _castSummoningStrike(hero, def) {
    const gs = this.gameState;
    const hc = Math.floor(hero.col);
    const hr = Math.floor(hero.row);
    const r = def.radius != null ? def.radius : 1;
    for (const t of gs.troops) {
      if (t.owner === hero.owner) continue;
      if (t.invisible || t.garrisonedIn) continue;
      const tc = Math.floor(t.col);
      const tr = Math.floor(t.row);
      if (Math.abs(tc - hc) > r || Math.abs(tr - hr) > r) continue;
      window.applyDamage(t, def.damage || 0);
      if (window.applyKnockback) window.applyKnockback(t, hero.col, hero.row, def.knockback || 0);
    }
    const sCount = def.summonCount || 0;
    for (let i = 0; i < sCount; i++) {
      const troop = this.gameLogic.createTroop(def.summonType, hero.row, hero.col, hero.owner);
      if (troop) {
        troop.active = true;
        troop.activationTime = 0;
        troop.activationDuration = 0;
        gs.troops.push(troop);
      }
    }
    const heal = def.healAmount || 0;
    hero.hp = Math.min(hero.maxHP, hero.hp + heal);
    gs.strategems.push({
      type: "_heroBurst", col: hero.col, row: hero.row, owner: hero.owner,
      age: 0, duration: 0.4, color: def.color || "#ffb050", radius: r,
    });
    const am = window.gameSetupResult && window.gameSetupResult.audioManager;
    if (am) am.playSound("boltStormActivation");
  }

  /**
   * Ambush: Strategia gains `invisible + cloakActive` for the duration —
   * untargetable and undamageable but the main troop loop still updates her
   * via the `!cloakActive` guard. Haste fields refresh for the duration.
   * Spawns 1 Archer + 1 Militia on her tile at cast moment.
   */
  _castAmbush(hero, def) {
    const gs = this.gameState;
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    const dur = def.duration || 3;
    hero.invisible = true;
    hero.cloakActive = true;
    hero.cloakedUntil = now + dur;
    hero.hasteUntil = now + dur;
    hero.hasteFactor = def.hasteFactor != null ? def.hasteFactor : 1.5;
    hero.hasteAttackFactor = def.hasteAttackFactor != null ? def.hasteAttackFactor : 1.5;
    hero.target = null;
    const spec = def.summonSpec || [];
    for (const item of spec) {
      for (let i = 0; i < (item.count || 0); i++) {
        const troop = this.gameLogic.createTroop(item.type, hero.row, hero.col, hero.owner);
        if (troop) {
          troop.active = true;
          troop.activationTime = 0;
          troop.activationDuration = 0;
          gs.troops.push(troop);
        }
      }
    }
    gs.strategems.push({
      type: "_heroBurst", col: hero.col, row: hero.row, owner: hero.owner,
      age: 0, duration: 0.4, color: def.color || "#c060ff", radius: 1,
    });
    const am = window.gameSetupResult && window.gameSetupResult.audioManager;
    if (am) am.playSound("divineWind");
  }

  /**
   * Create + register a persistent strategem entity. Returns null if the
   * caster is on cooldown for this type, or if entity creation fails. For
   * instant strategems (Blast), the effect is applied immediately. On success
   * the per-type cooldown is armed from `def.cooldown`.
   */
  createStrategem(type, params) {
    const def = (this.gameLogic.strategemTypes || {})[type];
    if (!def) return null;

    const gs = this.gameState;
    const owner = params && params.owner;

    if (def.cooldown != null && owner && !this.isReady(owner, type)) return null;

    const entity = this.gameLogic.createStrategem(type, params);
    if (!entity) return null;

    if (type === "blast") this._applyBlast(entity, def);

    gs.strategems.push(entity);

    if (def.cooldown != null && owner) {
      if (!gs.strategemCooldowns) gs.strategemCooldowns = { player1: {}, player2: {} };
      if (!gs.strategemCooldowns[owner]) gs.strategemCooldowns[owner] = {};
      gs.strategemCooldowns[owner][type] = def.cooldown;
    }

    const am = window.gameSetupResult && window.gameSetupResult.audioManager;
    if (am) {
      if (type === "heal")       am.playSound("healSound");
      else if (type === "wind")  am.playSound("divineWind");
      else if (type === "blast") am.playSound("boltStormActivation");
    }

    return entity;
  }

  /**
   * Heal Burst: immediate +initialHeal on cast, then +pulseHeal at each age
   * in HEAL_PULSE_AGES. Friendly troops only; ignores invisible (teleporting)
   * units so a teleported troop can't be healed while out of phase.
   */
  _updateHeal(s, def, dt, prevAge) {
    if (!s.firedInitial) {
      s.firedInitial = true;
      this._healInRadius(s, def, def.initialHeal != null ? def.initialHeal : 15);
    }
    for (const pa of HEAL_PULSE_AGES) {
      if (prevAge < pa && s.age >= pa) {
        this._healInRadius(s, def, def.pulseHeal != null ? def.pulseHeal : 5);
      }
    }
  }

  _healInRadius(s, def, amount) {
    for (const t of this.gameState.troops) {
      if (t.owner !== s.owner) continue;
      if (t.invisible || t.garrisonedIn) continue;
      const dx = t.col - s.col;
      const dy = t.row - s.row;
      if (Math.sqrt(dx * dx + dy * dy) > def.radius) continue;
      t.hp = Math.min(t.maxHP, t.hp + amount);
    }
  }

  /** Wind: rotated rectangle DOT + per-frame push velocity (legacy Divine Wind). */
  _updateWind(s, def, dt) {
    const halfLen = def.length / 2;
    const halfWid = def.width / 2;
    const px = -s.dirRow;
    const py = s.dirCol;
    for (const t of this.gameState.troops) {
      if (t.invisible || t.garrisonedIn) continue;
      const rx = t.col - s.col;
      const ry = t.row - s.row;
      const along = rx * s.dirCol + ry * s.dirRow;
      const across = rx * px + ry * py;
      if (Math.abs(along) > halfLen || Math.abs(across) > halfWid) continue;
      if (def.dps) window.applyDamage(t, def.dps * dt);
      const inv = 1 / (t.mass || 1);
      t.pushVx = s.dirCol * def.pushSpeed * inv;
      t.pushVy = s.dirRow * def.pushSpeed * inv;
    }
  }

  /**
   * Necromancy: low DOT in radius, plus a delayed undead spawn at the
   * tombstone (s.col, s.row) for each enemy death that occurred inside the
   * radius this frame. Cycle is 4 skeletons then 1 zombie, repeating.
   * Heroes are not raised.
   */
  _updateNecromancy(s, def, dt) {
    const gs = this.gameState;
    const radius = def.radius || 6;

    for (const t of gs.troops) {
      if (t.owner === s.owner) continue;
      if (t.invisible || t.garrisonedIn) continue;
      const dx = t.col - s.col;
      const dy = t.row - s.row;
      if (Math.sqrt(dx * dx + dy * dy) > radius) continue;
      window.applyDamage(t, (def.dps || 0) * dt);
    }

    if (gs.deathsThisFrame && gs.deathsThisFrame.length) {
      for (const dead of gs.deathsThisFrame) {
        if (!dead || dead.owner === s.owner || dead.isHero) continue;
        const dx = dead.col - s.col;
        const dy = dead.row - s.row;
        if (Math.sqrt(dx * dx + dy * dy) > radius) continue;
        const spawnType = s.spawnCycleIndex < 4 ? "skeleton" : "zombie";
        s.spawnCycleIndex = (s.spawnCycleIndex + 1) % 5;
        s.pendingSpawns.push({
          age: s.age + (def.spawnDelay != null ? def.spawnDelay : 0.3),
          type: spawnType,
        });
      }
    }

    for (let i = s.pendingSpawns.length - 1; i >= 0; i--) {
      const p = s.pendingSpawns[i];
      if (p.age <= s.age) {
        const troop = this.gameLogic.createTroop(p.type, s.row, s.col, s.owner);
        if (troop) {
          troop.active = true;
          troop.activationTime = 0;
          troop.activationDuration = 0;
          gs.troops.push(troop);
        }
        s.pendingSpawns.splice(i, 1);
      }
    }
  }

  /**
   * Ruin: telegraphed. At t == activationTime, deal heavy damage to enemy
   * buildings (Tower Turret clamped to a low value), light damage to enemy
   * heroes. Friendly anything ignored. Troops untouched.
   */
  _updateRuin(s, def, dt, prevAge) {
    const at = def.activationTime != null ? def.activationTime : 4;
    if (!(prevAge < at && s.age >= at)) return;
    const gs = this.gameState;
    const radius = def.radius || 1.5;

    for (const b of gs.buildings) {
      if (b.owner === s.owner) continue;
      const bcx = b.col + (b.width || 1) / 2;
      const bcy = b.row + (b.height || 1) / 2;
      const dx = bcx - s.col;
      const dy = bcy - s.row;
      if (Math.sqrt(dx * dx + dy * dy) > radius) continue;
      const dmg = b.type === "towerTurret"
        ? (def.towerTurretDamage != null ? def.towerTurretDamage : 25)
        : (def.buildingDamage != null ? def.buildingDamage : 250);
      window.applyDamage(b, dmg);
    }

    for (const t of gs.troops) {
      if (t.owner === s.owner) continue;
      if (!t.isHero) continue;
      if (t.invisible || t.garrisonedIn) continue;
      const dx = t.col - s.col;
      const dy = t.row - s.row;
      if (Math.sqrt(dx * dx + dy * dy) > radius) continue;
      window.applyDamage(t, def.heroDamage != null ? def.heroDamage : 25);
    }
  }

  /**
   * Chain Lightning: 3s arming, then a strike every 2s for 6 total strikes
   * (over the 15s duration). Each strike picks the nearest enemy entity
   * within chainReach of the cast center, then chains to the nearest unvisited
   * enemy within chainReach of the previous victim, up to maxChainHits.
   * Per-target damage: troops 42, buildings 6, heroes 12 (from def).
   */
  _updateChainLightning(s, def, dt) {
    s.lastHitsAge = (s.lastHitsAge || 0) + dt;
    const at = def.activationTime != null ? def.activationTime : 3;
    const interval = def.strikeInterval || 2;
    const total = def.totalStrikes || 6;
    while (s.strikesFired < total) {
      const nextAge = at + s.strikesFired * interval;
      if (s.age < nextAge) break;
      this._chainLightningStrike(s, def);
      s.strikesFired++;
    }
  }

  _chainLightningStrike(s, def) {
    const gs = this.gameState;
    const reach = def.chainReach || 2.25;
    const maxHits = def.maxChainHits || 6;
    const enemyOwner = s.owner === "player1" ? "player2" : "player1";

    const findNearest = (fromCol, fromRow, hitSet) => {
      let best = null;
      let bestD = Infinity;
      for (const t of gs.troops) {
        if (t.owner !== enemyOwner) continue;
        if (t.invisible || t.garrisonedIn) continue;
        if (hitSet.has(t)) continue;
        const dx = t.col - fromCol;
        const dy = t.row - fromRow;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= reach && d < bestD) { best = t; bestD = d; }
      }
      for (const b of gs.buildings) {
        if (b.owner !== enemyOwner) continue;
        if (hitSet.has(b)) continue;
        const bcx = b.col + (b.width || 1) / 2;
        const bcy = b.row + (b.height || 1) / 2;
        const dx = bcx - fromCol;
        const dy = bcy - fromRow;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= reach && d < bestD) { best = b; bestD = d; }
      }
      return best;
    };

    const damageOf = (target) => {
      if (target.width != null) return def.buildingDamage != null ? def.buildingDamage : 6;
      if (target.isHero) return def.heroDamage != null ? def.heroDamage : 12;
      return def.troopDamage != null ? def.troopDamage : 42;
    };

    const hits = [];
    const hitSet = new Set();
    const seed = findNearest(s.col, s.row, hitSet);
    if (!seed) {
      s.lastHits = [];
      s.lastHitsAge = 0;
      return;
    }
    hits.push(seed); hitSet.add(seed);
    window.applyDamage(seed, damageOf(seed));

    for (let i = 1; i < maxHits; i++) {
      const prev = hits[i - 1];
      const pc = prev.width != null ? prev.col + (prev.width || 1) / 2 : prev.col;
      const pr = prev.width != null ? prev.row + (prev.height || 1) / 2 : prev.row;
      const next = findNearest(pc, pr, hitSet);
      if (!next) break;
      hits.push(next); hitSet.add(next);
      window.applyDamage(next, damageOf(next));
    }

    s.lastHits = hits.map((h) => {
      const c = h.width != null ? h.col + (h.width || 1) / 2 : h.col;
      const r = h.width != null ? h.row + (h.height || 1) / 2 : h.row;
      return [c, r];
    });
    s.lastHitsAge = 0;
  }

  /**
   * Gravity Field: pulls enemy troops toward center each frame (position-level
   * translation scaled by 1/mass) and damages them on a fixed tick rate, with
   * damage scaling linearly from 0 at the edge to maxDps at the center.
   * Friendly troops and heroes are untouched (heroes are still pulled if the
   * caller flips that, but the default keeps them inert).
   */
  _updateGravityField(s, def, dt) {
    const gs = this.gameState;
    const radius = def.radius || 4;
    const pullSpeed = def.pullSpeed != null ? def.pullSpeed : 1.5;
    const maxDps = def.maxDps != null ? def.maxDps : 6;
    const tickRate = def.damageTickRate || 3;
    const tickInterval = 1 / tickRate;
    const enemyOwner = s.owner === "player1" ? "player2" : "player1";

    s.damageTickTimer = (s.damageTickTimer || 0) + dt;
    const fireTick = s.damageTickTimer >= tickInterval;
    if (fireTick) s.damageTickTimer -= tickInterval;

    for (const t of gs.troops) {
      if (t.owner !== enemyOwner) continue;
      if (t.invisible || t.garrisonedIn) continue;
      const dx = t.col - s.col;
      const dy = t.row - s.row;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= radius) continue;

      if (d > 0.05) {
        const wanted = (pullSpeed / (t.mass || 1)) * dt;
        const step = Math.min(wanted, d - 0.02);
        if (step > 0) {
          t.col -= (dx / d) * step;
          t.row -= (dy / d) * step;
        }
      }

      if (fireTick) {
        const tickDmg = maxDps * (1 - d / radius) / tickRate;
        if (tickDmg > 0) window.applyDamage(t, tickDmg);
      }
    }
  }

  /**
   * Lesser / Greater Teleport: at activationTime, collect every friendly
   * non-hero troop standing on the start tile (or 3×3 zone for Greater) and
   * mark them invisible. At activationTime + appearDelay, drop them at the
   * end position (single tile center for Lesser, distributed across the 3×3
   * end zone for Greater, with overflow stacking on center).
   */
  _updateTeleport(s, def, dt, prevAge, zoneRadius) {
    const gs = this.gameState;
    const at = def.activationTime != null ? def.activationTime : 4;
    const appear = at + (def.appearDelay != null ? def.appearDelay : 0.5);

    if (s.phase === "arming" && prevAge < at && s.age >= at) {
      s.cargo = [];
      for (const t of gs.troops) {
        if (t.owner !== s.owner) continue;
        if (t.isHero) continue;
        if (t.invisible || t.garrisonedIn) continue;
        const tc = Math.floor(t.col);
        const tr = Math.floor(t.row);
        if (Math.abs(tc - s.startCol) > zoneRadius) continue;
        if (Math.abs(tr - s.startRow) > zoneRadius) continue;
        s.cargo.push(t);
        t.invisible = true;
        t.target = null;
        t.attackTimer = 0;
        t.pushVx = 0;
        t.pushVy = 0;
      }
      s.phase = "transit";
    }

    if (s.phase === "transit" && prevAge < appear && s.age >= appear) {
      this._forceTeleportDrop(s, zoneRadius);
    }
  }

  /**
   * Drop every cargo troop at the destination and clear `invisible`. Called
   * from `_updateTeleport`'s threshold-crossing block, and also as a splice-
   * time safety net so cargo can never be stranded invisible if the drop
   * crossing somehow doesn't fire on a given frame.
   */
  _forceTeleportDrop(s, zoneRadius) {
    if (!s.cargo || s.cargo.length === 0) { s.phase = "done"; return; }
    const gs = this.gameState;
    const cols = gs.cols, rows = gs.rows;
    const clamp = (c, r) => ({
      c: Math.max(0.5, Math.min(cols - 0.5, c)),
      r: Math.max(0.5, Math.min(rows - 0.5, r)),
    });
    if (zoneRadius === 0) {
      const dest = clamp(s.endCol + 0.5, s.endRow + 0.5);
      for (const t of s.cargo) {
        t.col = dest.c;
        t.row = dest.r;
        t.invisible = false;
        t.target = null;
        t.attackTimer = 0;
      }
    } else {
      const tiles = [];
      for (let dr = -zoneRadius; dr <= zoneRadius; dr++) {
        for (let dc = -zoneRadius; dc <= zoneRadius; dc++) {
          tiles.push([s.endCol + dc + 0.5, s.endRow + dr + 0.5]);
        }
      }
      const centerIdx = Math.floor(tiles.length / 2);
      for (let i = 0; i < s.cargo.length; i++) {
        const t = s.cargo[i];
        const tile = i < tiles.length ? tiles[i] : tiles[centerIdx];
        const dest = clamp(tile[0], tile[1]);
        t.col = dest.c;
        t.row = dest.r;
        t.invisible = false;
        t.target = null;
        t.attackTimer = 0;
      }
    }
    s.phase = "done";
  }

  /**
   * Chronomancy: Haste. Persistent friendly buff zone. Each frame, refresh
   * hasteUntil + multipliers on every friendly troop inside the radius.
   * Effect lingers `tailDuration` seconds after leaving the zone (default 0.5s).
   * Heroes get muted multipliers via def.heroSpeed/heroAttack.
   */
  _updateChronoHaste(s, def, dt) {
    const gs = this.gameState;
    const radius = def.radius || 2;
    const tail = def.tailDuration != null ? def.tailDuration : 0.5;
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    for (const t of gs.troops) {
      if (t.owner !== s.owner) continue;
      if (t.invisible || t.garrisonedIn) continue;
      const dx = t.col - s.col;
      const dy = t.row - s.row;
      if (Math.sqrt(dx * dx + dy * dy) > radius) continue;
      t.hasteUntil = now + tail;
      if (t.isHero) {
        t.hasteFactor       = def.heroSpeed  != null ? def.heroSpeed  : 1.5;
        t.hasteAttackFactor = def.heroAttack != null ? def.heroAttack : 1.25;
      } else {
        t.hasteFactor       = def.troopSpeed  != null ? def.troopSpeed  : 2.0;
        t.hasteAttackFactor = def.troopAttack != null ? def.troopAttack : 1.5;
      }
    }
  }

  /**
   * Chronomancy: Slow. Persistent enemy debuff zone. Each frame, refresh
   * slowUntil + multipliers on every enemy troop inside the radius. Affects
   * both movement (slowFactor) and attack rate (slowAttackFactor — a new
   * field consumed by troopSystem's updated formula). Heroes get muted
   * multipliers via def.heroSpeed/heroAttack.
   */
  _updateChronoSlow(s, def, dt) {
    const gs = this.gameState;
    const radius = def.radius || 3;
    const tail = def.tailDuration != null ? def.tailDuration : 0.5;
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    const enemyOwner = s.owner === "player1" ? "player2" : "player1";
    for (const t of gs.troops) {
      if (t.owner !== enemyOwner) continue;
      if (t.invisible || t.garrisonedIn) continue;
      const dx = t.col - s.col;
      const dy = t.row - s.row;
      if (Math.sqrt(dx * dx + dy * dy) > radius) continue;
      t.slowUntil = now + tail;
      if (t.isHero) {
        t.slowFactor       = def.heroSpeed  != null ? def.heroSpeed  : 0.7;
        t.slowAttackFactor = def.heroAttack != null ? def.heroAttack : 0.8;
      } else {
        t.slowFactor       = def.troopSpeed  != null ? def.troopSpeed  : 0.4;
        t.slowAttackFactor = def.troopAttack != null ? def.troopAttack : 0.6;
      }
    }
  }

  /**
   * Chronomancy: Stop. Pulses a stun every pulseInterval seconds on enemy
   * troops in the radius. Non-heroes are refreshed every frame to give 100%
   * uptime (their stun duration exceeds the pulse gap). Heroes are stunned
   * only on pulse moments and for a shorter duration, giving them visible
   * action windows.
   */
  _updateChronoStop(s, def, dt, prevAge) {
    const gs = this.gameState;
    const radius = def.radius || 1.5;
    const pulse = def.pulseInterval || 0.5;
    const troopDur = def.troopStunDuration != null ? def.troopStunDuration : 0.5;
    const heroDur  = def.heroStunDuration  != null ? def.heroStunDuration  : 0.25;
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    const enemyOwner = s.owner === "player1" ? "player2" : "player1";
    const isPulseFrame = Math.floor(s.age / pulse) > Math.floor(prevAge / pulse);

    for (const t of gs.troops) {
      if (t.owner !== enemyOwner) continue;
      if (t.invisible || t.garrisonedIn) continue;
      const dx = t.col - s.col;
      const dy = t.row - s.row;
      if (Math.sqrt(dx * dx + dy * dy) > radius) continue;
      if (t.isHero) {
        if (isPulseFrame) t.stunUntil = Math.max(t.stunUntil || 0, now + heroDur);
      } else {
        t.stunUntil = Math.max(t.stunUntil || 0, now + troopDur);
      }
    }
  }

  /**
   * Burning Patch: per-frame DoT on enemy troops inside the radius. Spawned by
   * Lava Mortar, not player-cast. Reads radius/dps off the entity (set at
   * spawn time from the mortar's def) so each mortar can tune its own patch;
   * falls back to the strategem def if a caller didn't override.
   */
  _updateBurningPatch(s, def, dt) {
    const radius = s.radius != null ? s.radius : def.radius;
    const dps    = s.dps    != null ? s.dps    : def.dps;
    for (const t of this.gameState.troops) {
      if (t.owner === s.owner) continue;
      if (t.invisible || t.garrisonedIn) continue;
      const dx = t.col - s.col;
      const dy = t.row - s.row;
      if (Math.sqrt(dx * dx + dy * dy) > radius) continue;
      window.applyDamage(t, dps * dt);
    }
  }

  /** Blast: apply center damage + stun + adjacent damage + radial knockback once. */
  _applyBlast(s, def) {
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    const centerCol = s.col;
    const centerRow = s.row;
    for (const t of this.gameState.troops) {
      if (t.owner === s.owner) continue;
      if (t.invisible || t.garrisonedIn) continue;
      const tc = Math.floor(t.col);
      const tr = Math.floor(t.row);
      if (tc === centerCol && tr === centerRow) {
        window.applyDamage(t, def.centerDamage);
        t.stunUntil = now + def.centerStun;
      } else if (Math.abs(tc - centerCol) <= 1 && Math.abs(tr - centerRow) <= 1) {
        window.applyDamage(t, def.adjacentDamage);
        if (window.applyKnockback) {
          window.applyKnockback(t, centerCol + 0.5, centerRow + 0.5, def.adjacentKnockback);
        }
      }
    }
    for (const b of this.gameState.buildings) {
      if (b.owner === s.owner) continue;
      const bc0 = Math.floor(b.col);
      const br0 = Math.floor(b.row);
      const bw = Math.max(1, b.width || 1);
      const bh = Math.max(1, b.height || 1);
      let onCenter = false;
      let inBox = false;
      for (let dx = 0; dx < bw && !onCenter; dx++) {
        for (let dy = 0; dy < bh && !onCenter; dy++) {
          const tc = bc0 + dx;
          const tr = br0 + dy;
          if (tc === centerCol && tr === centerRow) { onCenter = true; inBox = true; }
          else if (Math.abs(tc - centerCol) <= 1 && Math.abs(tr - centerRow) <= 1) { inBox = true; }
        }
      }
      if (!inBox) continue;
      window.applyDamage(b, onCenter ? def.centerDamage : def.adjacentDamage);
    }
  }
}

window.StrategemSystem = StrategemSystem;
