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

    for (let i = gs.troops.length - 1; i >= 0; i--) {
      const troop = gs.troops[i];

      // Passive HP regen (heroes have this; normal troops have hpRegen=0).
      // Applied before damage-this-frame so a unit at full HP doesn't briefly
      // overshoot maxHP, and so death-by-DOT this tick still wins.
      if (troop.hpRegen && troop.hp > 0 && troop.hp < troop.maxHP) {
        troop.hp = Math.min(troop.maxHP, troop.hp + troop.hpRegen * deltaTime);
      }

      // Burn DOT (applied before death check so it can kill)
      if (troop.burnUntil && troop.burnUntil > now && troop.burnDps) {
        applyDamage(troop, troop.burnDps * deltaTime);
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

      // ── Sticky targeting ──
      // Keep the current target until it dies, leaves vision, or we get hit by a
      // different troop (handled at attack-application time, see below).
      if (troop.target && !this._targetValid(troop, troop.target)) {
        troop.target = null;
      }
      if (!troop.target) {
        troop.target = this._findTarget(troop);
      }
      const target = troop.target;
      troop.lastTarget = target; // renderer reads this for targeting lines

      const slowed = troop.slowUntil && troop.slowUntil > now;
      const slowFactor = slowed ? (troop.slowFactor || 1) : 1;
      const effSpeed = troop.speed * slowFactor;

      const dist = this._distanceTo(troop, target);
      const inAttackRange = target && dist <= troop.range;

      if (inAttackRange) {
        troop.attackTimer = (troop.attackTimer || 0) + deltaTime;
        const attackInterval = troop.attackSpeed > 0 ? 1 / troop.attackSpeed : Infinity;
        if (troop.attackTimer >= attackInterval) {
          troop.attackTimer -= attackInterval;
          applyDamage(target, troop.damage);
          // Retarget the victim onto us. Buildings/towers don't read .target so
          // this only matters for troop victims, which is what we want.
          target.target = troop;
          troop.attackFlashTarget = target;
          troop.attackFlashUntil = now + 0.15;

          const am = window.gameSetupResult && window.gameSetupResult.audioManager;
          if (am) am.playTroopAttack(troop);

        }
      } else if (!troop.isHero) {
        // Heroes are manual-only — keyboard input is the sole mover. Targeting
        // and auto-attack still run above; we just skip the AI movement branches.
        if (target) {
          // Pursue: aim at the nearest point on the target (matters for multi-tile buildings)
          const np = this._nearestPointOn(target, troop.col, troop.row);
          const dx = np.x - troop.col;
          const dy = np.y - troop.row;
          const mag = Math.sqrt(dx * dx + dy * dy) || 1;
          const step = effSpeed * deltaTime;
          troop.col = Math.max(0.5, Math.min(gs.cols - 0.5, troop.col + (dx / mag) * step));
          troop.row = Math.max(0.5, Math.min(gs.rows - 0.5, troop.row + (dy / mag) * step));
        } else {
          // Nothing visible: march toward the enemy hero's current position
          // until something enters vision.
          const enemyHero = troop.owner === "player1" ? gs.hero2 : gs.hero1;
          if (enemyHero) {
            const dx = enemyHero.col - troop.col;
            const dy = enemyHero.row - troop.row;
            const mag = Math.sqrt(dx * dx + dy * dy) || 1;
            const step = effSpeed * deltaTime;
            troop.col = Math.max(0.5, Math.min(gs.cols - 0.5, troop.col + (dx / mag) * step));
            troop.row = Math.max(0.5, Math.min(gs.rows - 0.5, troop.row + (dy / mag) * step));
          }
        }
      }

      // Divine-Wind push velocity (per-frame, consumed each tick)
      if (troop.pushVx || troop.pushVy) {
        troop.col = this._clampCol(troop, troop.col + troop.pushVx * deltaTime);
        troop.row = this._clampRow(troop, troop.row + troop.pushVy * deltaTime);
        troop.pushVx = 0;
        troop.pushVy = 0;
      }
    }

    // Resolve overlaps after all troops have moved
    this._resolveCollisions();
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
      const ar = a.radius || 0.25;
      const am = a.mass   || 1.0;
      for (let j = i + 1; j < troops.length; j++) {
        const b = troops[j];
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
