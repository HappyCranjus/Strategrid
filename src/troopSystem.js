/**
 * TroopSystem - Manages troop entities
 * @class
 */

/**
 * Radial knockback helper. Pushes a troop away from a center point by `dist`
 * tiles, scaled by 1/mass (so heavier troops move less), clamped to map bounds.
 * Exposed on window so the blast strategem can reuse it.
 */
function applyKnockback(troop, fromCol, fromRow, dist) {
  const gs = window.gameSetupResult && window.gameSetupResult.gameState;
  if (!gs) return;
  const effDist = dist / (troop.mass || 1);
  let dx = troop.col + 0.5 - fromCol;
  let dy = troop.row + 0.5 - fromRow;
  const mag = Math.sqrt(dx * dx + dy * dy) || 1;
  dx = (dx / mag) * effDist;
  dy = (dy / mag) * effDist;
  troop.col = Math.max(0.5, Math.min(gs.cols - 0.5, troop.col + dx));
  troop.row = Math.max(0.5, Math.min(gs.rows - 0.5, troop.row + dy));
}
window.applyKnockback = applyKnockback;

/**
 * Apply damage to a target (troop or building), respecting its damageReduction
 * (0 = no reduction, 0.3 = 30% reduction, etc.). Centralized so every damage
 * source — melee, tower fire, splash, DOT, strategem AoE — gets the same
 * treatment without each caller having to re-implement the math.
 */
function applyDamage(target, raw) {
  if (!target || raw <= 0) return;
  // Ninja cloak uses the same invisible flag for targeting but is NOT phase-
  // shifted — AoE damage reveals her. Break the cloak first so the hit lands
  // on a now-visible target (and subsequent ticks see a normal unit).
  if (target.type === "ninja" && target.invisible) {
    target.invisible    = false;
    target.cloakActive  = false;
    target.cloakedUntil = 0;
  }
  // Teleporting / Ambush-cloaked troops are out of phase with the battlefield
  // — nothing reaches them while they're invisible.
  if (target.invisible) return;

  // Bunker garrison damage shield: occupants absorb a share of the incoming
  // damage; the bunker absorbs the rest. The recursive applyDamage call lets
  // each occupant's own damageReduction apply to its share, and the bunker's
  // DR still applies to its 70% via the path below.
  if (target.type === "bunker" && target.occupants && target.occupants.length > 0) {
    const def = (window.buildingTypes || {}).bunker;
    const occShare = def && def.damageShieldRatio != null ? def.damageShieldRatio : 0.3;
    const perOccupant = (raw * occShare) / target.occupants.length;
    for (const occ of target.occupants.slice()) applyDamage(occ, perOccupant);
    raw = raw * (1 - occShare);
    if (raw <= 0) return;
  }

  const dr = target.damageReduction || 0;
  const dealt = raw * (1 - dr);
  target.hp -= dealt;

  // Floating popup feedback for consequential units (heroes + tower turrets).
  if (target.isHero || target.type === "towerTurret") {
    const gs = window.gameSetupResult && window.gameSetupResult.gameState;
    if (gs && gs.damagePopups) {
      const col = target.col + ((target.width || 0) / 2);
      const row = target.row + ((target.height || 0) / 2);
      const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
      gs.damagePopups.push({ col, row, dmg: dealt, spawnTime: now });
    }
  }
}
window.applyDamage = applyDamage;

class TroopSystem {
  constructor(gameState, gameLogic) {
    this.gameState = gameState;
    this.gameLogic = gameLogic;
  }

  update(deltaTime) {
    const gs = this.gameState;
    if (!gs || gs.gameOver) return;
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

    // GC floating damage popups (TTL = 1s).
    if (gs.damagePopups) {
      for (let i = gs.damagePopups.length - 1; i >= 0; i--) {
        if (now - gs.damagePopups[i].spawnTime > 1.0) gs.damagePopups.splice(i, 1);
      }
    }

    // Reset the per-frame death log; strategemSystem (Necromancy) reads this
    // later in the frame.
    if (gs.deathsThisFrame) gs.deathsThisFrame.length = 0;
    else gs.deathsThisFrame = [];

    // Stamp inspire buff fields on friendlies in each Bannerman's aura zone
    // before the main loop reads them for regen / speed / attack multipliers.
    this._applyInspirationZones(now);

    // Refresh the cloak on friendlies inside any Invisi-witch's ACTIVE aura.
    // Runs before the main loop so the cloakedUntil expiry block sees this
    // frame's refreshed timestamps for troops still in the aura.
    this._applyInvisiWitchCloak(now, deltaTime);

    // Ogre grab/throw state machine: cooldown tick, grab init, release,
    // and in-flight position interpolation. Runs before the main loop so
    // frozenUntil / inFlight flags are set before targeting/movement reads them.
    this._updateOgreThrows(now, deltaTime);

    // War Machine spawner: every commandoSpawnInterval seconds, emit a
    // Commando troop at the WM's tile. New units enter on this frame so
    // they get full normal-loop processing immediately.
    this._updateWarMachineSpawns(now, deltaTime);

    // War Machine secondary weapon: independent cannon firing alongside the
    // MG (handled by the standard per-troop attack block via the WM's range
    // and attackSpeed). The cannon picks the highest-HP target in cannonRange.
    this._updateWarMachineCannons(now, deltaTime);

    for (let i = gs.troops.length - 1; i >= 0; i--) {
      const troop = gs.troops[i];

      // Ambush cloak expiry: clear `invisible` + `cloakActive` together.
      if (troop.cloakedUntil && troop.cloakedUntil <= now) {
        troop.invisible = false;
        troop.cloakActive = false;
        troop.cloakedUntil = 0;
      }

      // Teleport in transit — frozen out of the world for this frame. Cloaked
      // (Strategia's Ambush) is also `invisible: true` BUT keeps updating so
      // she can move/attack while untargetable — the `cloakActive` flag
      // distinguishes the two.
      if (troop.invisible && !troop.cloakActive) continue;
      // In-flight troops are being moved + interpolated by _updateOgreThrows;
      // skip the normal per-troop update so they don't try to walk/attack mid-arc.
      if (troop.inFlight) continue;

      // Bannerman "Inspired" aura — set by _applyInspirationZones earlier this
      // frame. Read once here so regen and the movement/attack blocks below
      // share the same flag.
      const inspired = troop.inspiredUntil && troop.inspiredUntil > now;

      // Passive HP regen (heroes have this; normal troops have hpRegen=0).
      // Applied before damage-this-frame so a unit at full HP doesn't briefly
      // overshoot maxHP, and so death-by-DOT this tick still wins. Inspired
      // troops get an additive regen boost while in a Bannerman zone.
      const baseRegen = troop.hpRegen || 0;
      const inspireReg = inspired ? (troop.inspireRegen || 0) : 0;
      const totalRegen = baseRegen + inspireReg;
      if (totalRegen > 0 && troop.hp > 0 && troop.hp < troop.maxHP) {
        troop.hp = Math.min(troop.maxHP, troop.hp + totalRegen * deltaTime);
      }

      // Burn DOT (applied before death check so it can kill). Garrisoned
      // troops are sheltered — environmental DOTs don't reach them; only the
      // bunker's 70/30 redistribution path delivers damage while inside.
      if (!troop.garrisonedIn && troop.burnUntil && troop.burnUntil > now && troop.burnDps) {
        applyDamage(troop, troop.burnDps * deltaTime);
      }

      // Chill stack decay: 1 stack per 0.4s, independent of fresh applications.
      if (troop.chillStacks && troop.chillStacks > 0) {
        troop.chillDecayTimer = (troop.chillDecayTimer != null ? troop.chillDecayTimer : 0.4) - deltaTime;
        if (troop.chillDecayTimer <= 0) {
          troop.chillStacks = Math.max(0, troop.chillStacks - 1);
          troop.chillDecayTimer = 0.4;
        }
      }

      if (troop.hp <= 0) {
        const am = window.gameSetupResult && window.gameSetupResult.audioManager;
        if (am) am.playTroopDeath();
        if (troop.isHero) {
          // Hero death ends the match immediately. Leave the corpse in the
          // array so the renderer can still draw it under the overlay.
          const winner = troop.owner === "player1" ? "player2" : "player1";
          gs.setGameOver(winner);
          return;
        }
        // Free the bunker slot if this troop was garrisoned.
        if (troop.garrisonedIn && troop.garrisonedIn.occupants) {
          const idx = troop.garrisonedIn.occupants.indexOf(troop);
          if (idx >= 0) troop.garrisonedIn.occupants.splice(idx, 1);
        }
        // Log the death so strategemSystem.Necromancy can react this frame.
        if (gs.deathsThisFrame) gs.deathsThisFrame.push(troop);
        gs.troops.splice(i, 1);
        continue;
      }

      // Activation: forward-spawned troops cook for activationDuration seconds
      // before they can move or attack. Influence still accrues (handled by
      // InfluenceSystem reading t.row/col regardless of active flag) so a
      // forward-deployed troop starts clawing back contested ground even while
      // booting up.
      if (troop.active === false) {
        troop.activationTime = Math.max(0, (troop.activationTime || 0) - deltaTime);
        if (troop.activationTime <= 0) troop.active = true;
        else continue;
      }

      if (troop.stunUntil && troop.stunUntil > now) continue;
      // Frozen (chill stacks capped this troop): no movement, no attack for 1s.
      if (troop.frozenUntil && troop.frozenUntil > now) continue;

      // ── Sticky targeting ──
      // Keep the current target until it dies, leaves vision, or we get hit by a
      // different troop (handled at attack-application time, see below).
      if (troop.target && !this._targetValid(troop, troop.target)) {
        troop.target = null;
      }
      if (!troop.target) {
        troop.target = this._findTarget(troop);
      }
      // Back-rank fallback: a troop that's walked all the way to the enemy
      // back rank without ever sighting anything locks onto the globally
      // nearest enemy troop and pursues, regardless of vision. Settlers are
      // pure influence carriers and stay in zig-zag mode forever.
      if (
        !troop.target &&
        !troop.isHero &&
        troop.type !== "settler" &&
        this._atEnemyBackRank(troop)
      ) {
        troop.target = this._findNearestEnemyTroopGlobal(troop);
      }
      // Grenadier / Commando: re-pick the best impact anchor every tick —
      // clusters drift, so a stale aim would waste throws. If nothing's in
      // throw range we keep the standard target so pursuit logic still walks
      // us forward. Commando shares the splash-cluster picker logic.
      if (troop.type === "grenadier" || troop.type === "commando") {
        const impact = this._findGrenadierImpact(troop);
        if (impact) troop.target = impact;
      }
      const target = troop.target;
      troop.lastTarget = target; // renderer reads this for targeting lines

      const slowed = troop.slowUntil && troop.slowUntil > now;
      const hasted = troop.hasteUntil && troop.hasteUntil > now;
      const slowMove  = slowed ? (troop.slowFactor       || 1) : 1;
      const slowAtk   = slowed ? (troop.slowAttackFactor || 1) : 1;
      const hasteMove = hasted ? (troop.hasteFactor       || 1) : 1;
      const hasteAtk  = hasted ? (troop.hasteAttackFactor || 1) : 1;
      // Chill multiplier: 1% per stack of movement/attack debuff, capped at 80%.
      const chillMul = Math.max(0.2, 1 - 0.01 * (troop.chillStacks || 0));
      // Inspire multipliers (Bannerman aura) — stack independently with haste.
      const inspireMove = inspired ? (troop.inspireSpeedFactor  || 1) : 1;
      const inspireAtk  = inspired ? (troop.inspireAttackFactor || 1) : 1;
      // Berserker proc (Brute kill reward) — stacks multiplicatively with everything else.
      const berserk     = troop.berserkerUntil && troop.berserkerUntil > now;
      const berserkMove = berserk ? (troop.berserkerSpeedFactor  || 1) : 1;
      const berserkAtk  = berserk ? (troop.berserkerAttackFactor || 1) : 1;
      const effSpeed = troop.speed * slowMove * hasteMove * chillMul * inspireMove * berserkMove;

      const dist = this._distanceTo(troop, target);
      // Ninja's opener MUST be a katana — until firstAttackPending clears, her
      // effective range collapses to meleeRange so she pursues into melee
      // instead of throwing shurikens from afar.
      let effectiveRange = troop.range;
      if (troop.type === "ninja" && troop.firstAttackPending) {
        const ndef = window.troopTypes ? window.troopTypes.ninja : null;
        effectiveRange = (ndef && ndef.meleeRange) || troop.range;
      }
      const inAttackRange = target && dist <= effectiveRange;

      if (inAttackRange) {
        // Ninja dual-attack: katana inside meleeRange (slow + heavy), shuriken
        // beyond it (fast + weak). Resolved at fire time so the attacker can
        // snap between modes as the target closes / flees.
        let ninjaMelee = false;
        if (troop.type === "ninja") {
          const ndef = window.troopTypes ? window.troopTypes.ninja : null;
          const meleeR = (ndef && ndef.meleeRange) || 0;
          if (dist <= meleeR) ninjaMelee = true;
        }
        troop.attackTimer = (troop.attackTimer || 0) + deltaTime;
        let baseAtkSpeed = troop.attackSpeed;
        if (ninjaMelee) {
          const ndef = window.troopTypes ? window.troopTypes.ninja : null;
          baseAtkSpeed = (ndef && ndef.meleeAttackSpeed) || troop.attackSpeed;
        }
        const attackInterval = baseAtkSpeed > 0
          ? 1 / (baseAtkSpeed * slowAtk * hasteAtk * chillMul * inspireAtk * berserkAtk)
          : Infinity;
        if (troop.attackTimer >= attackInterval) {
          troop.attackTimer -= attackInterval;
          const wasAlive = target.hp > 0;
          // First swing breaks the spawn cloak (before damage so the hit lands
          // on a target that already sees the popup of a revealed assassin).
          if (troop.type === "ninja" && troop.cloakActive) {
            troop.invisible    = false;
            troop.cloakActive  = false;
            troop.cloakedUntil = 0;
          }
          if (troop.type === "grenadier" || troop.type === "commando") {
            // Grenadier / Commando lobs a grenade at the target's center (the
            // target was chosen by _findGrenadierImpact to maximize enemies
            // inside the splash radius). Splash IS the damage — no separate
            // single-target hit on the anchor, since the anchor is itself
            // inside its own splash radius and would otherwise be hit twice.
            const gdef = window.troopTypes ? window.troopTypes[troop.type] : null;
            const splashR = (gdef && gdef.splashRadius) || 1.5;
            const splash  = (gdef && gdef.splashDamage) || 25;
            const enemyOwner = troop.owner === "player1" ? "player2" : "player1";
            const impactCol = target.col + ((target.width || 0) / 2);
            const impactRow = target.row + ((target.height || 0) / 2);
            for (const t of gs.troops) {
              if (t.owner !== enemyOwner) continue;
              // Ninjas in cloak are NOT phase-shifted — splash hits and reveals them.
              if (t.hp <= 0 || (t.invisible && t.type !== "ninja") || t.garrisonedIn || t.inFlight) continue;
              const dx = t.col - impactCol;
              const dy = t.row - impactRow;
              if (Math.sqrt(dx * dx + dy * dy) <= splashR) applyDamage(t, splash);
            }
            for (const b of gs.buildings) {
              if (b.owner !== enemyOwner) continue;
              if (b.hp <= 0) continue;
              const bcx = b.col + (b.width || 1) / 2;
              const bcy = b.row + (b.height || 1) / 2;
              const dx = bcx - impactCol;
              const dy = bcy - impactRow;
              if (Math.sqrt(dx * dx + dy * dy) <= splashR) applyDamage(b, splash);
            }
            if (gs.damagePopups) {
              gs.damagePopups.push({
                col: impactCol,
                row: impactRow,
                spawnTime: now,
                label: "BOOM!",
                color: "#ffb060",
                dmg: 0,
              });
            }
          } else if (troop.type === "ninja") {
            const ndef = window.troopTypes ? window.troopTypes.ninja : null;
            let dmg;
            if (ninjaMelee) {
              dmg = (ndef && ndef.meleeDamage) || troop.damage;
              // First-katana opener gets a +50% bonus; subsequent katanas are normal.
              if (troop.firstAttackPending) {
                dmg *= 1.5;
                troop.firstAttackPending = false;
              }
            } else {
              dmg = troop.damage; // shuriken
            }
            // Assassin identity: deadly to squishy support, weak against
            // durable structures and champions — 80% damage resist on heroes
            // and ALL buildings. Stacks multiplicatively with target.damageReduction.
            const isResistant = target.isHero || (gs.buildings && gs.buildings.indexOf(target) !== -1);
            if (isResistant) dmg *= 0.2;
            applyDamage(target, dmg);
          } else {
            applyDamage(target, troop.damage);
          }
          if (troop.type === "brute" && wasAlive && target.hp <= 0) {
            const bdef = window.troopTypes ? window.troopTypes.brute : null;
            const heal = (bdef && bdef.berserkerHeal) || 10;
            const dur  = (bdef && bdef.berserkerDuration) || 1.25;
            troop.hp = Math.min(troop.maxHP, troop.hp + heal);
            troop.berserkerUntil        = now + dur;
            troop.berserkerSpeedFactor  = (bdef && bdef.berserkerSpeedFactor)  || 2.0;
            troop.berserkerAttackFactor = (bdef && bdef.berserkerAttackFactor) || 2.0;
            if (gs.damagePopups) {
              gs.damagePopups.push({
                col: troop.col,
                row: troop.row,
                spawnTime: now,
                label: "BERSERK!",
                color: "#ff6020",
                dmg: 0,
              });
            }
          }
          // Gust Knight: every swing emits a forward gust — a rectangle of
          // gustLength tiles deep along the attack axis, gustWidth tiles wide
          // perpendicular. Every enemy troop inside gets shoved away from the
          // Gust Knight and takes splashDamage. Buildings sit in a separate
          // array and are naturally unaffected. Mass scaling lives inside
          // applyKnockback. The focused target already took focused damage
          // above; the splash here stacks on top of that.
          if (troop.type === "gustKnight") {
            const gdef = window.troopTypes ? window.troopTypes.gustKnight : null;
            const dist  = (gdef && gdef.gustKnockback) || 0.6;
            const len   = (gdef && gdef.gustLength)    || 3;
            const halfW = ((gdef && gdef.gustWidth)    || 2) / 2;
            const splash = (gdef && gdef.splashDamage) || 0;
            let dx = target.col - troop.col;
            let dy = target.row - troop.row;
            const mag = Math.sqrt(dx * dx + dy * dy) || 1;
            dx /= mag; dy /= mag;
            const px = -dy, py = dx;
            const ox = troop.col + 0.5, oy = troop.row + 0.5;
            for (const t of gs.troops) {
              if (t === troop || t.owner === troop.owner) continue;
              if (t.hp <= 0 || (t.invisible && t.type !== "ninja") || t.garrisonedIn || t.inFlight) continue;
              const rx = t.col - troop.col;
              const ry = t.row - troop.row;
              const along  = rx * dx + ry * dy;
              const across = rx * px + ry * py;
              if (along < 0 || along > len) continue;
              if (Math.abs(across) > halfW) continue;
              applyKnockback(t, ox, oy, dist);
              if (splash > 0) applyDamage(t, splash);
            }
            if (gs.damagePopups) {
              gs.damagePopups.push({
                col: troop.col + dx * (len / 2),
                row: troop.row + dy * (len / 2),
                spawnTime: now,
                label: "GUST!",
                color: "#9ad8ff",
                dmg: 0,
              });
            }
          }
          // If the victim isn't already engaged with someone, pull them onto us
          // so they respond to the threat. Troops mid-fight keep their target —
          // this prevents ranged attackers from pulling enemies across the map.
          if (!target.target) target.target = troop;
          troop.attackFlashTarget = target;
          troop.attackFlashUntil = now + 0.15;

          const am = window.gameSetupResult && window.gameSetupResult.audioManager;
          if (am) am.playTroopAttack(troop);

        }
      } else if (!troop.isHero && !troop.garrisonedIn) {
        // Heroes are manual-only — keyboard input is the sole mover. Garrisoned
        // troops are pinned inside their bunker. Targeting and auto-attack still
        // run above for both; we just skip the AI movement branches here.
        if (target) {
          // Pursue: aim at the nearest point on the target (matters for multi-tile buildings)
          const np = this._nearestPointOn(target, troop.col, troop.row);
          this._stepToward(troop, np.x, np.y, effSpeed, deltaTime);
        } else if (troop.type === "settler") {
          this._stepSettler(troop, effSpeed, deltaTime);
        } else if (troop.type === "sentinel" && this._sentinelShouldPatrol(troop)) {
          this._stepSentinelPatrol(troop, effSpeed, deltaTime);
        } else {
          // Default: walk forward along the deployed row toward the enemy back rank.
          this._stepForward(troop, effSpeed, deltaTime);
        }
      }

      // Divine-Wind push velocity (per-frame, consumed each tick). Garrisoned
      // troops are pinned inside the bunker; the push has nowhere to go.
      if (!troop.garrisonedIn && (troop.pushVx || troop.pushVy)) {
        troop.col = this._clampCol(troop, troop.col + troop.pushVx * deltaTime);
        troop.row = this._clampRow(troop, troop.row + troop.pushVy * deltaTime);
        troop.pushVx = 0;
        troop.pushVy = 0;
      }
    }

    // Garrison entries: any eligible non-garrisoned troop now overlapping a
    // friendly Bunker enters it (FIFO push if full). Runs after movement so
    // the troop has moved this frame, but before collision resolution so the
    // arrival is correctly removed from collision consideration.
    this._processBunkerEntries();

    // Resolve overlaps after all troops have moved
    this._resolveCollisions();
  }

  /**
   * Stamp the Bannerman "Inspired" buff onto every friendly troop standing in
   * a 7-col × 5-row zone trailing behind each living Bannerman. Buff is set
   * (not stacked) — overlapping Bannermen write the same fields with the same
   * values. A 0.5s tail (matching chronoHaste's linger) keeps inspired troops
   * from flickering between buffed/unbuffed at the zone edge. Tile-discrete
   * via Math.floor, matching the user's spec preview.
   */
  _applyInspirationZones(now) {
    const gs = this.gameState;
    const tail = 0.5;
    for (const banner of gs.troops) {
      if (banner.type !== "bannerman") continue;
      if (banner.hp <= 0 || banner.active === false) continue;
      if (banner.invisible) continue;
      const backDir = banner.owner === "player1" ? -1 : +1;
      const depth = banner.inspireBackCols || 7;
      const half = banner.inspireSideRows || 2;
      const bc = Math.floor(banner.col);
      const br = Math.floor(banner.row);
      const cMin = backDir === -1 ? bc - (depth - 1) : bc;
      const cMax = backDir === -1 ? bc                : bc + (depth - 1);
      const rMin = br - half;
      const rMax = br + half;
      for (const t of gs.troops) {
        if (t === banner) continue;
        if (t.owner !== banner.owner) continue;
        if (t.hp <= 0) continue;
        const tc = Math.floor(t.col);
        const tr = Math.floor(t.row);
        if (tc < cMin || tc > cMax || tr < rMin || tr > rMax) continue;
        t.inspiredUntil       = now + tail;
        t.inspireSpeedFactor  = banner.inspireSpeedFactor  || 1.2;
        t.inspireAttackFactor = banner.inspireAttackFactor || 1.2;
        t.inspireRegen        = banner.inspireRegen        || 1.0;
      }
    }
  }

  /**
   * Invisi-witch cloak aura. Each witch runs her own cycle:
   * cloakActiveDuration seconds ON, then (cloakCycleDuration - active) OFF.
   * During the ON phase, every friendly troop within cloakRadius gets the
   * same `invisible: true, cloakActive: true` pair used by Teleport — visible
   * as a 35%-alpha silhouette but skipped by targeting. Other invisi-witches
   * are excluded from the buff loop (no chaining); the source witch IS
   * included, so she cloaks herself.
   *
   * Implementation: a one-frame TTL refreshed every tick. When the witch flips
   * to OFF, or a friendly leaves the radius, the refresh stops and the shared
   * cloakedUntil expiry block at the top of update() clears the flags one
   * frame later — yielding crisp phase boundaries without per-source tracking.
   */
  _applyInvisiWitchCloak(now, deltaTime) {
    const gs = this.gameState;
    const TTL = 0.05;
    for (const witch of gs.troops) {
      if (witch.type !== "invisiWitch") continue;
      if (witch.hp <= 0 || witch.active === false) continue;
      witch.invisPhaseTimer = (witch.invisPhaseTimer || 0) + deltaTime;
      const cycle = witch.cloakCycleDuration || 4.5;
      if (witch.invisPhaseTimer >= cycle) witch.invisPhaseTimer -= cycle;
      const activeDur = witch.cloakActiveDuration || 2.0;
      witch.invisActive = witch.invisPhaseTimer < activeDur;
      if (!witch.invisActive) continue;
      const r = witch.cloakRadius || 2.0;
      for (const t of gs.troops) {
        if (t.owner !== witch.owner) continue;
        if (t.hp <= 0) continue;
        if (t.type === "invisiWitch" && t !== witch) continue;
        const dx = t.col - witch.col;
        const dy = t.row - witch.row;
        if (Math.sqrt(dx * dx + dy * dy) > r) continue;
        t.invisible    = true;
        t.cloakActive  = true;
        t.cloakedUntil = now + TTL;
      }
    }
  }

  /**
   * Ogre grab-and-throw. Three concerns, all in one method so the whole
   * ability lives in one place:
   *   A) Tick each Ogre's throwTimer. When ready AND an enemy is in throwRange,
   *      start a grab: freeze both Ogre and target for grabDuration.
   *   B) When grabDuration expires, release the throw — pick the FARTHEST
   *      other enemy in throwRange as the impact destination (or straight
   *      backwards if none exists). Stamp flight state on the thrown troop.
   *   C) Advance every in-flight troop's position along its lerp + arc; on
   *      arrival, apply impact damage, stun, splash, and a popup.
   *
   * Heroes are valid grab targets (per user decision). Invisible/garrisoned/
   * in-flight troops are NOT eligible (can't reach them).
   */
  _updateOgreThrows(now, deltaTime) {
    const gs = this.gameState;
    if (!gs || !gs.troops) return;

    // (C) Advance in-flight troops first so an Ogre that lands an enemy this
    // frame can immediately start a new grab next frame.
    for (const t of gs.troops) {
      if (!t.inFlight) continue;
      const span = (t.thrownEndT - t.thrownStartT) || 0.4;
      const u = Math.min(1, Math.max(0, (now - t.thrownStartT) / span));
      t.col = t.thrownStart.col + (t.thrownEnd.col - t.thrownStart.col) * u;
      t.row = t.thrownStart.row + (t.thrownEnd.row - t.thrownStart.row) * u;
      t.thrownArcLift = (t.thrownArcMax || 0) * 4 * u * (1 - u);

      if (u >= 1) {
        t.col = t.thrownEnd.col;
        t.row = t.thrownEnd.row;
        t.inFlight = false;
        t.thrownArcLift = 0;
        // Clear the "invisible-while-flying" flags BEFORE applyDamage so the
        // landing damage actually lands (applyDamage early-returns on invisible
        // for non-ninja targets, and the ninja path would otherwise break cloak).
        t.invisible = false;
        t.cloakActive = false;
        const thrownBy = t.thrownBy;
        const odef = window.troopTypes ? window.troopTypes.ogre : null;
        const impactDmg = (odef && odef.impactDamage) || 30;
        const splashR   = (odef && odef.splashRadius) || 1.0;
        const splashDmg = (odef && odef.splashDamage) || 20;

        applyDamage(t, impactDmg);
        t.stunUntil = Math.max(t.stunUntil || 0, now + 0.25);

        if (thrownBy) {
          const enemyOwner = thrownBy.owner === "player1" ? "player2" : "player1";
          for (const v of gs.troops) {
            if (v === t) continue;
            if (v.owner !== enemyOwner) continue;
            if (v.hp <= 0) continue;
            if ((v.invisible && v.type !== "ninja") || v.garrisonedIn || v.inFlight) continue;
            const dx = v.col - t.col;
            const dy = v.row - t.row;
            if (Math.sqrt(dx * dx + dy * dy) <= splashR) applyDamage(v, splashDmg);
          }
        }

        if (gs.damagePopups) {
          gs.damagePopups.push({
            col: t.col, row: t.row, spawnTime: now,
            label: "THROWN!", color: "#ff8060", dmg: 0,
          });
        }
        t.thrownBy      = null;
        t.thrownStart   = null;
        t.thrownEnd     = null;
      }
    }

    // (A + B) Per-Ogre cooldown tick and grab/release.
    for (const ogre of gs.troops) {
      if (ogre.type !== "ogre") continue;
      if (ogre.hp <= 0 || ogre.active === false) continue;

      const odef = window.troopTypes ? window.troopTypes.ogre : null;
      const throwCD     = (odef && odef.throwCooldown)   || 3.5;
      const throwRange  = (odef && odef.throwRange)      || 5.0;
      const throwBlind  = (odef && odef.throwBlindSpot)  || 0;
      const grabDur     = (odef && odef.grabDuration)    || 0.25;
      const flightDur   = (odef && odef.flightDuration)  || 0.4;
      const flightArc   = (odef && odef.flightArcHeight) || 2.5;

      // (B) Release a pending grab when the grab timer lapses.
      if (ogre.grabTarget && ogre.grabUntil <= now) {
        const tgt = ogre.grabTarget;
        ogre.grabTarget = null;

        // Grab target may have died during grab phase — graceful no-op.
        if (tgt.hp > 0) {
          // Find farthest OTHER enemy in throwRange from the Ogre.
          const enemyOwner = ogre.owner === "player1" ? "player2" : "player1";
          let farthest = null;
          let bestD = -1;
          for (const v of gs.troops) {
            if (v === tgt) continue;
            if (v.owner !== enemyOwner) continue;
            if (v.hp <= 0) continue;
            if ((v.invisible && v.type !== "ninja") || v.garrisonedIn || v.inFlight) continue;
            const dx = v.col - ogre.col;
            const dy = v.row - ogre.row;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > throwRange) continue;
            if (d < throwBlind) continue; // too close — point-blank yeet would land on top of the Ogre
            if (d > bestD) { bestD = d; farthest = v; }
          }

          let impactCol, impactRow;
          if (farthest) {
            impactCol = farthest.col;
            impactRow = farthest.row;
          } else {
            // No eligible target (none in range, or all inside the blind spot)
            // — yeet FORWARD into the enemy's backline so we're always
            // advancing pressure, never handing the grabbed unit back home.
            const forwardDir = ogre.owner === "player1" ? +1 : -1;
            impactCol = ogre.col + forwardDir * throwRange;
            impactRow = ogre.row;
          }
          impactCol = Math.max(0.5, Math.min(gs.cols - 0.5, impactCol));
          impactRow = Math.max(0.5, Math.min(gs.rows - 0.5, impactRow));

          tgt.inFlight      = true;
          // Piggyback on the existing invisible+cloakActive triplet so all
          // existing targeting/AoE/building/collision filters that already
          // skip `t.invisible` naturally skip in-flight troops too. Renderer
          // overrides alpha back to 1.0 when t.inFlight is set (see below).
          tgt.invisible     = true;
          tgt.cloakActive   = true;
          tgt.frozenUntil   = Math.max(tgt.frozenUntil || 0, now + flightDur);
          tgt.thrownStart   = { col: tgt.col, row: tgt.row };
          tgt.thrownEnd     = { col: impactCol, row: impactRow };
          tgt.thrownStartT  = now;
          tgt.thrownEndT    = now + flightDur;
          tgt.thrownArcLift = 0;
          tgt.thrownArcMax  = flightArc;
          tgt.thrownBy      = ogre;
        }
        ogre.throwTimer = 0;
      }

      // (A) Tick cooldown and look for a new grab. Timer starts AT throwCD
      // so the Ogre's first throw fires as soon as she finds a target.
      if (ogre.throwTimer === undefined) ogre.throwTimer = throwCD;
      else ogre.throwTimer = Math.min(throwCD, ogre.throwTimer + deltaTime);
      if (ogre.grabUntil && ogre.grabUntil > now) continue; // still grabbing
      if (ogre.throwTimer < throwCD) continue;

      // Pick closest eligible enemy within MELEE range (grab requires contact,
      // not throw range — keeps the Ogre from siphoning targets across the map).
      const grabRing = ogre.range;
      const enemyOwner = ogre.owner === "player1" ? "player2" : "player1";
      let nearest = null;
      let bestD = Infinity;
      for (const v of gs.troops) {
        if (v.owner !== enemyOwner) continue;
        if (v.hp <= 0) continue;
        if ((v.invisible && v.type !== "ninja") || v.garrisonedIn || v.inFlight) continue;
        const dx = v.col - ogre.col;
        const dy = v.row - ogre.row;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > grabRing) continue;
        if (d < bestD) { bestD = d; nearest = v; }
      }
      if (!nearest) continue;

      ogre.grabTarget    = nearest;
      ogre.grabUntil     = now + grabDur;
      ogre.frozenUntil   = Math.max(ogre.frozenUntil || 0, now + grabDur);
      nearest.frozenUntil = Math.max(nearest.frozenUntil || 0, now + grabDur);
    }
  }

  /**
   * War Machine commando spawner. Each WM has a per-instance accumulator
   * (commandoSpawnTimer). Every commandoSpawnInterval seconds, emit one
   * Commando at the WM's tile (immediately active — no 1.2s activation
   * since this is a friendly emit, not an enemy frontline drop). Mirrors
   * the warBonesFactory's spawnInterval pattern at the building level.
   */
  _updateWarMachineSpawns(now, deltaTime) {
    const gs = this.gameState;
    if (!gs || !gs.troops) return;
    const def = window.troopTypes ? window.troopTypes.warMachine : null;
    const interval = (def && def.commandoSpawnInterval) || 7;

    // Iterate a snapshot length so newly-pushed commandos don't loop back in
    // this same tick (they're War Machines that we'd skip anyway via the type
    // check, but iterating a snapshot keeps the contract explicit).
    const snapshotLen = gs.troops.length;
    for (let i = 0; i < snapshotLen; i++) {
      const wm = gs.troops[i];
      if (!wm) continue;
      if (wm.type !== "warMachine") continue;
      if (wm.hp <= 0 || wm.active === false) continue;

      wm.commandoSpawnTimer = (wm.commandoSpawnTimer || 0) + deltaTime;
      if (wm.commandoSpawnTimer < interval) continue;
      wm.commandoSpawnTimer -= interval;

      const c = this.gameLogic.createTroop("commando", wm.row, wm.col, wm.owner);
      if (!c) continue;
      c.active = true;
      c.activationTime = 0;
      c.activationDuration = 0;
      gs.troops.push(c);

      if (gs.damagePopups) {
        gs.damagePopups.push({
          col: wm.col, row: wm.row, spawnTime: now,
          label: "COMMANDO!", color: "#a0d060", dmg: 0,
        });
      }
    }
  }

  /**
   * War Machine secondary weapon: an independent Cannon firing on its own
   * cooldown alongside the primary MG (which is handled by the standard
   * per-troop attack block via the WM's range/damage/attackSpeed). Targets
   * the highest-HP enemy entity (troop or building) in cannonRange. Heavy
   * single-shot hit, slow cadence. Both weapons share stun/freeze gating.
   */
  _updateWarMachineCannons(now, deltaTime) {
    const gs = this.gameState;
    if (!gs || !gs.troops) return;
    const def = window.troopTypes ? window.troopTypes.warMachine : null;
    const cd  = (def && def.cannonAttackCooldown) || 2.5;
    const rng = (def && def.cannonRange)          || 5.0;
    const dmg = (def && def.cannonDamage)         || 50;

    for (const wm of gs.troops) {
      if (wm.type !== "warMachine") continue;
      if (wm.hp <= 0 || wm.active === false) continue;
      if (wm.stunUntil && wm.stunUntil > now) continue;
      if (wm.frozenUntil && wm.frozenUntil > now) continue;

      // Cap accumulator at cd so an idle WM doesn't burst-fire when a target
      // finally enters range.
      wm.cannonTimer = Math.min(cd, (wm.cannonTimer || 0) + deltaTime);
      if (wm.cannonTimer < cd) continue;

      const target = this._highestHpEnemyInRange(wm, rng);
      if (!target) continue; // hold the timer at cd until something appears
      wm.cannonTimer = 0;
      applyDamage(target, dmg);

      if (gs.damagePopups) {
        gs.damagePopups.push({
          col: wm.col, row: wm.row, spawnTime: now,
          label: "BOOM!", color: "#ffb060", dmg: 0,
        });
      }
    }
  }

  /**
   * Walk all friendly Bunkers and admit any eligible non-garrisoned troop
   * currently overlapping one. Eligibility: ranged unit (range >= threshold),
   * not a hero, attack-capable, active. FIFO push if the bunker is full.
   */
  _processBunkerEntries() {
    const gs = this.gameState;
    if (!gs || !gs.troops || !gs.buildings) return;
    for (const t of gs.troops) {
      if (t.garrisonedIn) continue;
      if (t.active === false) continue;
      if (!this._isGarrisonEligible(t)) continue;
      const b = this._findOverlappingFriendlyBunker(t);
      if (b) this._enterBunker(t, b);
    }
  }

  _isGarrisonEligible(t) {
    if (t.isHero) return false;
    if (!t.attackSpeed || t.attackSpeed <= 0) return false;
    const def = (this.gameLogic.buildingTypes || {}).bunker;
    const threshold = def && def.garrisonRangeThreshold != null ? def.garrisonRangeThreshold : 2.0;
    return (t.range || 0) >= threshold;
  }

  _findOverlappingFriendlyBunker(t) {
    for (const b of this.gameState.buildings) {
      if (b.type !== "bunker") continue;
      if (b.owner !== t.owner) continue;
      if (!b.active) continue;
      if (this._troopOverlapsBuilding(t, b)) return b;
    }
    return null;
  }

  // AABB-vs-circle: troop center inside a small inflation of the building rect.
  _troopOverlapsBuilding(t, b) {
    const left = b.col, right = b.col + (b.width || 1);
    const top  = b.row, bottom = b.row + (b.height || 1);
    const r = t.radius || 0.25;
    const nx = Math.max(left, Math.min(t.col, right));
    const ny = Math.max(top,  Math.min(t.row, bottom));
    const dx = t.col - nx;
    const dy = t.row - ny;
    return Math.sqrt(dx * dx + dy * dy) < r;
  }

  /**
   * Admit a troop into a Bunker. If full, FIFO-eject the oldest occupant out
   * the bunker's front edge (toward enemy) before appending the arrival.
   * Pinning position to the bunker center means existing target/range/vision
   * math automatically treats the bunker as the firing origin.
   */
  _enterBunker(troop, b) {
    const def = (this.gameLogic.buildingTypes || {}).bunker;
    const slots = def && def.garrisonSlots != null ? def.garrisonSlots : 2;
    if (!b.occupants) b.occupants = [];

    if (b.occupants.length >= slots) {
      const old = b.occupants.shift();
      if (old) this._ejectOccupantForward(b, old);
    }

    b.occupants.push(troop);
    troop.garrisonedIn = b;
    troop.col = b.col + (b.width || 1) / 2;
    troop.row = b.row + (b.height || 1) / 2;
    troop.target = null;
    troop.pushVx = 0;
    troop.pushVy = 0;
  }

  // Eject to the front edge (toward enemy), so a "pushed" troop resumes the
  // march one tile closer to its objective.
  _ejectOccupantForward(b, t) {
    const gs = this.gameState;
    const colTarget = b.owner === "player1"
      ? b.col + (b.width || 1) + 0.25
      : b.col - 0.25;
    const rowTarget = b.row + (b.height || 1) / 2;
    t.col = Math.max(0.5, Math.min(gs.cols - 0.5, colTarget));
    t.row = Math.max(0.5, Math.min(gs.rows - 0.5, rowTarget));
    t.garrisonedIn = null;
    t.target = null;
    t.attackTimer = 0;
  }

  /**
   * Hero-aware on-map clamp. Heroes use the tighter sprite-flush bound
   * `cols - 1.5` / `rows - 1.5` (matches heroInput) so collision pushback
   * can't deposit them past where the input clamp would accept — otherwise
   * the position "snaps" on the next keypress.
   */
  _clampCol(t, c) {
    const hi = t.isHero ? this.gameState.cols - 1.5 : this.gameState.cols - 0.5;
    return Math.max(0.5, Math.min(hi, c));
  }
  _clampRow(t, r) {
    const hi = t.isHero ? this.gameState.rows - 1.5 : this.gameState.rows - 0.5;
    return Math.max(0.5, Math.min(hi, r));
  }

  /**
   * Push apart overlapping troops (mass-weighted) and push troops out of enemy
   * building footprints (building has infinite mass; friendly buildings are
   * pass-through). One pass per tick — settles tight scrums within a few frames.
   */
  _resolveCollisions() {
    const gs = this.gameState;
    const troops = gs.troops;

    // ── Troop vs troop (mass-weighted) ──
    for (let i = 0; i < troops.length; i++) {
      const a = troops[i];
      if (a.garrisonedIn || a.invisible) continue; // pinned inside a bunker / out of phase; no collision
      const ar = a.radius || 0.25;
      const am = a.mass   || 1.0;
      for (let j = i + 1; j < troops.length; j++) {
        const b = troops[j];
        if (b.garrisonedIn || b.invisible) continue;
        const br = b.radius || 0.25;
        const bm = b.mass   || 1.0;
        const minDist = ar + br;

        let dx = b.col - a.col;
        let dy = b.row - a.row;
        let d  = Math.sqrt(dx * dx + dy * dy);
        if (d >= minDist) continue;

        if (d < 1e-4) {
          // Exact overlap (e.g. spawn-stack): deterministic nudge from pair indices
          const ang = (i * 0.7283 + j * 1.3137) % (Math.PI * 2);
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d  = 1;
        }

        const overlap = minDist - d;
        const nx = dx / d;
        const ny = dy / d;
        const total = am + bm;
        const aShare = bm / total; // lighter unit moves more
        const bShare = am / total;

        a.col = this._clampCol(a, a.col - nx * overlap * aShare);
        a.row = this._clampRow(a, a.row - ny * overlap * aShare);
        b.col = this._clampCol(b, b.col + nx * overlap * bShare);
        b.row = this._clampRow(b, b.row + ny * overlap * bShare);
      }
    }

    // ── Troop vs enemy building (infinite mass; friendly = pass-through) ──
    for (const t of troops) {
      if (t.garrisonedIn || t.invisible) continue;
      const r = t.radius || 0.25;
      for (const b of gs.buildings) {
        if (b.owner === t.owner) continue; // friendly = walkable
        const left   = b.col;
        const right  = b.col + (b.width  || 1);
        const top    = b.row;
        const bottom = b.row + (b.height || 1);
        const nx = Math.max(left, Math.min(t.col, right));
        const ny = Math.max(top,  Math.min(t.row, bottom));
        const dx = t.col - nx;
        const dy = t.row - ny;
        const d  = Math.sqrt(dx * dx + dy * dy);

        if (d >= r) continue;

        if (d < 1e-4) {
          // Troop center inside the rect: pop out the nearest face
          const dl = t.col - left;
          const dr = right - t.col;
          const dt = t.row - top;
          const db = bottom - t.row;
          const min = Math.min(dl, dr, dt, db);
          if      (min === dl) t.col = this._clampCol(t, left   - r);
          else if (min === dr) t.col = this._clampCol(t, right  + r);
          else if (min === dt) t.row = this._clampRow(t, top    - r);
          else                 t.row = this._clampRow(t, bottom + r);
          continue;
        }

        const overlap = r - d;
        t.col = this._clampCol(t, t.col + (dx / d) * overlap);
        t.row = this._clampRow(t, t.row + (dy / d) * overlap);
      }
    }
  }

  /**
   * Find nearest enemy troop, building, or tower within vision.
   * Used only to acquire a NEW target when the troop has none.
   */
  _findTarget(troop) {
    const gs = this.gameState;
    const enemy = troop.owner === "player1" ? "player2" : "player1";
    const sight = troop.vision != null ? troop.vision : troop.range;
    if (sight <= 0) return null;

    let best = null;
    let bestDist = Infinity;

    // Enemy troops
    for (const t of gs.troops) {
      if (t.owner !== enemy) continue;
      if (t.invisible) continue;
      const dx = t.col - troop.col;
      const dy = t.row - troop.row;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= sight && d < bestDist) { best = t; bestDist = d; }
    }

    // Enemy buildings (walls, farms, towers, etc.)
    for (const b of gs.buildings) {
      if (b.owner !== enemy) continue;
      const bcx = b.col + (b.width || 1) / 2;
      const bcy = b.row + (b.height || 1) / 2;
      const dx = bcx - troop.col;
      const dy = bcy - troop.row;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= sight && d < bestDist) { best = b; bestDist = d; }
    }

    // The enemy hero is a normal troop already considered by the loop above;
    // no separate fallback is needed now that towers are gone.
    return best;
  }

  /**
   * Pick the enemy entity (troop or building) with the highest current HP
   * within `range`. Used by the War Machine's cannon weapon system (see
   * `_updateWarMachineCannons`). Mirrors the building Cannon's picker at
   * `buildingSystem.js:_highestHpEnemyInRange` — closer wins on tie, honors
   * the same invisibility/garrison/in-flight filters that `_findTarget` does.
   */
  _highestHpEnemyInRange(troop, range) {
    const gs = this.gameState;
    const enemy = troop.owner === "player1" ? "player2" : "player1";
    let best = null;
    let bestHp = -Infinity;
    let bestDist = Infinity;

    for (const t of gs.troops) {
      if (t.owner !== enemy) continue;
      if (t.invisible || t.garrisonedIn || t.inFlight) continue;
      const dx = t.col - troop.col;
      const dy = t.row - troop.row;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > range) continue;
      if (t.hp > bestHp || (t.hp === bestHp && d < bestDist)) {
        best = t; bestHp = t.hp; bestDist = d;
      }
    }
    for (const b of gs.buildings) {
      if (b.owner !== enemy) continue;
      if (b.hp <= 0) continue;
      const bcx = b.col + (b.width || 1) / 2;
      const bcy = b.row + (b.height || 1) / 2;
      const dx = bcx - troop.col;
      const dy = bcy - troop.row;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > range) continue;
      if (b.hp > bestHp || (b.hp === bestHp && d < bestDist)) {
        best = b; bestHp = b.hp; bestDist = d;
      }
    }
    return best;
  }

  /**
   * Grenadier-specific target picker. Instead of "nearest enemy," scan every
   * enemy entity (troop or building) within throw range and pick the one whose
   * splash radius would catch the most enemies. The returned entity is used
   * purely as the impact anchor — the splash loop in the attack tick damages
   * everything in radius, not just the anchor. Ties break to the closer anchor
   * so the Grenadier prefers nearer of equal-value clusters. Returns null when
   * no enemy is in throw range, in which case the caller falls back to the
   * standard target (pursuit logic walks the Grenadier forward).
   */
  _findGrenadierImpact(troop) {
    const gs = this.gameState;
    const enemy = troop.owner === "player1" ? "player2" : "player1";
    const range = troop.range;
    // Read splash radius from the actual troop type so commandos read commando
    // stats, grenadiers read grenadier stats, etc.
    const gdef = window.troopTypes ? window.troopTypes[troop.type] : null;
    const splashR = (gdef && gdef.splashRadius) || 1.5;

    const candidates = [];
    for (const t of gs.troops) {
      if (t.owner !== enemy) continue;
      if (t.hp <= 0 || t.invisible || t.garrisonedIn) continue;
      const dx = t.col - troop.col;
      const dy = t.row - troop.row;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= range) candidates.push({ entity: t, cx: t.col, cy: t.row, dist: d });
    }
    for (const b of gs.buildings) {
      if (b.owner !== enemy) continue;
      if (b.hp <= 0) continue;
      const bcx = b.col + (b.width || 1) / 2;
      const bcy = b.row + (b.height || 1) / 2;
      const dx = bcx - troop.col;
      const dy = bcy - troop.row;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= range) candidates.push({ entity: b, cx: bcx, cy: bcy, dist: d });
    }
    if (candidates.length === 0) return null;

    let best = null;
    let bestCount = -1;
    let bestDist = Infinity;
    for (const c of candidates) {
      let count = 0;
      for (const t of gs.troops) {
        if (t.owner !== enemy) continue;
        if (t.hp <= 0 || t.invisible || t.garrisonedIn) continue;
        const dx = t.col - c.cx;
        const dy = t.row - c.cy;
        if (Math.sqrt(dx * dx + dy * dy) <= splashR) count++;
      }
      for (const b of gs.buildings) {
        if (b.owner !== enemy) continue;
        if (b.hp <= 0) continue;
        const bcx = b.col + (b.width || 1) / 2;
        const bcy = b.row + (b.height || 1) / 2;
        const dx = bcx - c.cx;
        const dy = bcy - c.cy;
        if (Math.sqrt(dx * dx + dy * dy) <= splashR) count++;
      }
      if (count > bestCount || (count === bestCount && c.dist < bestDist)) {
        best = c.entity;
        bestCount = count;
        bestDist = c.dist;
      }
    }
    return best;
  }

  /**
   * True iff the troop's current target is still in the world and within vision.
   * Caller is responsible for nulling the target if this returns false.
   */
  _targetValid(troop, target) {
    if (!target || target.hp <= 0) return false;
    const gs = this.gameState;
    const sight = troop.vision != null ? troop.vision : troop.range;
    if (sight <= 0) return false;

    if (gs.troops.includes(target)) {
      const dx = target.col - troop.col;
      const dy = target.row - troop.row;
      return Math.sqrt(dx * dx + dy * dy) <= sight;
    }
    if (gs.buildings.includes(target)) {
      const bcx = target.col + (target.width || 1) / 2;
      const bcy = target.row + (target.height || 1) / 2;
      const dx = bcx - troop.col;
      const dy = bcy - troop.row;
      return Math.sqrt(dx * dx + dy * dy) <= sight;
    }
    return false; // unknown / despawned
  }

  /**
   * Distance from troop center to the nearest point on the target's footprint.
   * For multi-tile buildings this is what melee range should be measured against
   * (center-to-center is too far inside the footprint).
   */
  _distanceTo(troop, target) {
    if (!target) return Infinity;
    if (target.width != null) {
      const left = target.col, right = target.col + target.width;
      const top  = target.row, bottom = target.row + target.height;
      const dx = Math.max(left - troop.col, 0, troop.col - right);
      const dy = Math.max(top  - troop.row, 0, troop.row - bottom);
      return Math.sqrt(dx * dx + dy * dy);
    }
    const dx = target.col - troop.col;
    const dy = target.row - troop.row;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Nearest point on the target to (fromCol, fromRow). Used by the pursue branch
   * so troops walk up to the EDGE of a multi-tile target, not its center.
   */
  _nearestPointOn(target, fromCol, fromRow) {
    if (target.width != null) {
      const left = target.col, right = target.col + target.width;
      const top  = target.row, bottom = target.row + target.height;
      return {
        x: Math.max(left, Math.min(fromCol, right)),
        y: Math.max(top,  Math.min(fromRow, bottom)),
      };
    }
    return { x: target.col, y: target.row };
  }

  // Unit-vector step toward (aimCol, aimRow), clamped to map bounds. Shared
  // primitive for pursue / forward-march / settler-zigzag / sentinel-patrol so
  // they all use identical clamping and step math.
  _stepToward(troop, aimCol, aimRow, speed, dt) {
    const gs = this.gameState;
    const dx = aimCol - troop.col;
    const dy = aimRow - troop.row;
    const mag = Math.sqrt(dx * dx + dy * dy) || 1;
    const step = speed * dt;
    troop.col = Math.max(0.5, Math.min(gs.cols - 0.5, troop.col + (dx / mag) * step));
    troop.row = Math.max(0.5, Math.min(gs.rows - 0.5, troop.row + (dy / mag) * step));
  }

  // Column the troop is trying to reach: the far wall on the enemy's side.
  _enemyBackRankCol(troop) {
    return troop.owner === "player1" ? this.gameState.cols - 0.5 : 0.5;
  }

  // True once the troop has effectively walked to the enemy back-rank column.
  _atEnemyBackRank(troop) {
    const cols = this.gameState.cols;
    return troop.owner === "player1" ? troop.col >= cols - 1.0 : troop.col <= 1.0;
  }

  // Default forward walk: aim at the enemy back rank on the troop's deployed
  // row. Bumps and collisions can drift the troop off-row, which is fine —
  // it keeps marching straight ahead from wherever it currently is.
  _stepForward(troop, speed, dt) {
    this._stepToward(troop, this._enemyBackRankCol(troop), troop.deployedRow, speed, dt);
  }

  // Settler snake: strictly orthogonal legs — vertical to an apex (deployedRow
  // ± 2), then a single-tile forward step, then vertical to the opposite apex,
  // and so on. Pure diagonal motion would flatten into a near-straight dash;
  // orthogonal legs are what produce the visible snake and let the settler
  // touch more tiles per column of advance.
  _stepSettler(troop, speed, dt) {
    const gs = this.gameState;
    const dirCol = troop.owner === "player1" ? +1 : -1;
    if (!troop.zigPhase) troop.zigPhase = "vertical";

    if (troop.zigPhase === "advancing") {
      const aimCol = Math.max(0.5, Math.min(gs.cols - 0.5, troop.zigTargetCol));
      this._stepToward(troop, aimCol, troop.row, speed, dt);
      if (Math.abs(troop.col - aimCol) < 0.15) {
        troop.zigPhase = "vertical";
      }
    } else {
      const aimRow = Math.max(
        0.5,
        Math.min(gs.rows - 0.5, troop.deployedRow + 2 * troop.zigDir)
      );
      this._stepToward(troop, troop.col, aimRow, speed, dt);
      if (Math.abs(troop.row - aimRow) < 0.15) {
        troop.zigDir = -troop.zigDir;
        troop.zigPhase = "advancing";
        troop.zigTargetCol = troop.col + dirCol;
      }
    }
  }

  // Sentinel patrol: walk up and down a ±3 row band centered on the deployed
  // row, always returning to the deployed column. Flip patrolDir when the
  // current row gets within 0.15 of the band edge.
  _stepSentinelPatrol(troop, speed, dt) {
    const gs = this.gameState;
    const bandTop    = Math.max(0.5,            troop.deployedRow - 3);
    const bandBottom = Math.min(gs.rows - 0.5, troop.deployedRow + 3);
    const aimRow = troop.patrolDir > 0 ? bandBottom : bandTop;
    this._stepToward(troop, troop.deployedCol, aimRow, speed, dt);
    if (Math.abs(troop.row - aimRow) < 0.15) {
      troop.patrolDir = -troop.patrolDir;
    }
  }

  // Sentinel patrols by default. The first time it acquires a target it
  // commits forever — patrolBroken is one-way. After that the sentinel
  // either pursues (if it has a target) or walks straight forward like
  // a regular troop, never going back to patrol even if the bait dies.
  _sentinelShouldPatrol(troop) {
    if (troop.patrolBroken) return false;
    if (troop.target) {
      troop.patrolBroken = true;
      return false;
    }
    return true;
  }

  // Globally-nearest enemy troop, ignoring vision. Used as the back-rank
  // fallback so a unit that walked the whole map without sighting anything
  // still finds something to fight.
  _findNearestEnemyTroopGlobal(troop) {
    const gs = this.gameState;
    const enemy = troop.owner === "player1" ? "player2" : "player1";
    let best = null;
    let bestDist = Infinity;
    for (const t of gs.troops) {
      if (t.owner !== enemy) continue;
      if (t.invisible) continue;
      const dx = t.col - troop.col;
      const dy = t.row - troop.row;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) { best = t; bestDist = d; }
    }
    return best;
  }

  createTroop(type, row, col, owner) {
    const troop = this.gameLogic.createTroop(type, row, col, owner);
    if (troop && this.gameState) {
      this.gameState.troops.push(troop);
      const am = window.gameSetupResult && window.gameSetupResult.audioManager;
      if (am) am.playTroopSpawn(troop);
    }
    return troop;
  }
}

window.TroopSystem = TroopSystem;
