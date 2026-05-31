/**
 * StrategemSystem - Manages persistent strategem entities and their effects
 * @class
 */

// Heal pulse schedule within the 8s duration (2s cycle: 1s on / 1s off; 2 pulses per "on" second).
const HEAL_PULSE_AGES = [0.0, 0.5, 2.0, 2.5, 4.0, 4.5, 6.0, 6.5];
const HEAL_PULSE_AMOUNT = 5;

class StrategemSystem {
  constructor(gameState, gameLogic) {
    this.gameState = gameState;
    this.gameLogic = gameLogic;
  }

  update(deltaTime) {
    const gs = this.gameState;
    if (!gs || gs.gameOver) return;
    const defs = this.gameLogic.strategemTypes || (window.strategemTypes || {});

    for (let i = gs.strategems.length - 1; i >= 0; i--) {
      const s = gs.strategems[i];
      const prevAge = s.age;
      s.age += deltaTime;

      if (s.age >= s.duration) {
        gs.strategems.splice(i, 1);
        continue;
      }

      const def = defs[s.type];
      if (!def) continue;

      switch (s.type) {
        case "heal":       this._updateHeal(s, def, deltaTime, prevAge); break;
        case "divineWind": this._updateDivineWind(s, def, deltaTime); break;
        case "blizzard":   this._updateBlizzard(s, def, deltaTime); break;
        case "blast":      /* visual flash only; effect was applied on cast */ break;
      }
    }
  }

  /**
   * Create + register a persistent strategem entity. For instant strategems
   * (Blast), this both applies the effect immediately and adds a brief visual
   * flash entity. Returns the entity, or null for unknown types.
   */
  createStrategem(type, params) {
    const def = (this.gameLogic.strategemTypes || {})[type];
    if (!def) return null;

    const entity = this.gameLogic.createStrategem(type, params);
    if (!entity) return null;

    if (type === "blast") {
      this._applyBlast(entity, def);
    }

    this.gameState.strategems.push(entity);

    const am = window.gameSetupResult && window.gameSetupResult.audioManager;
    if (am) {
      if (type === "heal")            am.playSound("healSound");
      else if (type === "divineWind") am.playSound("divineWind");
      else if (type === "blast")      am.playSound("boltStormActivation");
    }

    return entity;
  }

  /** Heal: pulse-heal friendly troops in radius on the documented age schedule. */
  _updateHeal(s, def, dt, prevAge) {
    for (const pa of HEAL_PULSE_AGES) {
      if (prevAge <= pa && s.age > pa) {
        for (const t of this.gameState.troops) {
          if (t.owner !== s.owner) continue;
          const dx = t.col - s.col;
          const dy = t.row - s.row;
          if (Math.sqrt(dx * dx + dy * dy) > def.radius) continue;
          t.hp = Math.min(t.maxHP, t.hp + HEAL_PULSE_AMOUNT);
        }
      }
    }
  }

  /** Divine Wind: rotated rectangle, applies DOT + push velocity to ALL troops inside. */
  _updateDivineWind(s, def, dt) {
    const halfLen = def.length / 2;
    const halfWid = def.width / 2;
    const px = -s.dirRow;
    const py = s.dirCol;

    for (const t of this.gameState.troops) {
      const rx = t.col - s.col;
      const ry = t.row - s.row;
      const along = rx * s.dirCol + ry * s.dirRow;
      const across = rx * px + ry * py;
      if (Math.abs(along) > halfLen || Math.abs(across) > halfWid) continue;
      window.applyDamage(t, def.dps * dt);
      // Wind speed scales by 1/mass — heavier troops drift slower in the wind.
      const inv = 1 / (t.mass || 1);
      t.pushVx = s.dirCol * def.pushSpeed * inv;
      t.pushVy = s.dirRow * def.pushSpeed * inv;
    }
  }

  /** Blizzard: refresh slow + DOT on enemy troops while they're inside the AoE. */
  _updateBlizzard(s, def, dt) {
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    for (const t of this.gameState.troops) {
      if (t.owner === s.owner) continue;
      const dx = t.col - s.col;
      const dy = t.row - s.row;
      if (Math.sqrt(dx * dx + dy * dy) > def.radius) continue;
      t.slowFactor = def.slowFactor;
      t.slowUntil = now + 0.5;
      t.burnDps = def.dps;
      t.burnUntil = now + 0.5;
    }
  }

  /** Blast: apply center damage + stun + adjacent damage + radial knockback once. */
  _applyBlast(s, def) {
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    const centerCol = s.col;
    const centerRow = s.row;
    for (const t of this.gameState.troops) {
      if (t.owner === s.owner) continue;
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
  }
}

window.StrategemSystem = StrategemSystem;
