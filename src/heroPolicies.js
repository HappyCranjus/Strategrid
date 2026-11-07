/**
 * heroPolicies.js — Named hero movement policies.
 *
 * Each policy is a pure function: (gs, player, hero) → { targetCol, targetRow } | null
 * Returning null means "don't move this tick" (stayStill, or target not found).
 *
 * Used by both trainBot (bandit selection) and aiController (rule-based dispatch).
 */

const HeroPolicies = {

  /** Chase the living opponent hero. */
  targetHero(gs, player, hero) {
    const opp = player === "player1" ? gs.hero2 : gs.hero1;
    if (!opp || opp.hp <= 0) return null;
    return { targetCol: opp.col, targetRow: opp.row };
  },

  /** Move toward the enemy tower/turret/cannon with the lowest HP fraction. */
  targetWeakestTower(gs, player, hero) {
    const oppOwner = player === "player1" ? "player2" : "player1";
    let weakest = null, worstFrac = Infinity;
    for (const b of gs.buildings) {
      if (!b || b.hp <= 0 || b.owner !== oppOwner) continue;
      if (!/turret|cannon|mortar/i.test(b.type)) continue;
      const frac = b.hp / (b.maxHp || 1);
      if (frac < worstFrac) { worstFrac = frac; weakest = b; }
    }
    if (weakest) return { targetCol: weakest.col, targetRow: weakest.row };
    // Fallback: nearest enemy building of any type.
    let nearest = null, nearestD = Infinity;
    for (const b of gs.buildings) {
      if (!b || b.owner !== oppOwner) continue;
      const dx = b.col - hero.col, dy = b.row - hero.row;
      const d2 = dx * dx + dy * dy;
      if (d2 < nearestD) { nearestD = d2; nearest = b; }
    }
    return nearest ? { targetCol: nearest.col, targetRow: nearest.row } : null;
  },

  /** Rally to the centroid of nearby friendly troops; stay still if none within 5 tiles. */
  defendTroops(gs, player, hero) {
    let sumCol = 0, sumRow = 0, count = 0;
    for (const t of gs.troops) {
      if (!t || t.hp <= 0 || t.owner !== player || t.isHero) continue;
      const dx = t.col - hero.col, dy = t.row - hero.row;
      if (dx * dx + dy * dy <= 25) { // within 5 tiles
        sumCol += t.col; sumRow += t.row; count++;
      }
    }
    if (count) return { targetCol: sumCol / count, targetRow: sumRow / count };
    // No nearby friendlies — move to the most forward cluster instead.
    let fwdCol = 0, fwdRow = hero.row, fwdCount = 0;
    for (const t of gs.troops) {
      if (!t || t.hp <= 0 || t.owner !== player || t.isHero) continue;
      fwdCol += t.col; fwdRow += t.row; fwdCount++;
    }
    if (fwdCount) return { targetCol: fwdCol / fwdCount, targetRow: fwdRow / fwdCount };
    return null;
  },

  /** Stand next to the most forward surviving friendly tower/turret. */
  defendTower(gs, player, hero) {
    let best = null;
    for (const b of gs.buildings) {
      if (!b || b.hp <= 0 || b.owner !== player) continue;
      if (!/turret|cannon|mortar/i.test(b.type)) continue;
      if (!best) { best = b; continue; }
      const isBetter = player === "player1" ? b.col > best.col : b.col < best.col;
      if (isBetter) best = b;
    }
    return best ? { targetCol: best.col, targetRow: best.row } : null;
  },

  /** Retreat to own back column. */
  retreat(gs, player, hero) {
    const safeCol = player === "player1" ? 1.5 : gs.cols - 2.5;
    return { targetCol: safeCol, targetRow: hero.row };
  },

  /** Hero does not move. */
  stayStill() { return null; },

};

/** Human-readable labels for the UI. */
HeroPolicies.LABELS = {
  targetHero:        "Target Hero",
  targetWeakestTower:"Target Weak Tower",
  defendTroops:      "Defend Troops",
  defendTower:       "Defend Tower",
  retreat:           "Retreat",
  stayStill:         "Stay Still",
};

/** Ordered list of policy keys for indexing. */
HeroPolicies.KEYS = [
  "targetHero",
  "targetWeakestTower",
  "defendTroops",
  "defendTower",
  "retreat",
  "stayStill",
];

window.HeroPolicies = HeroPolicies;
