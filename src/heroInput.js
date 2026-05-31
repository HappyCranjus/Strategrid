/**
 * HeroInput - Translates held keyboard keys into per-tick hero movement.
 *
 * Sandbox / single / training: WASD drives player1's hero (Brick McStick),
 * arrow keys drive player2's hero (Strategia). PvP: only the local player's
 * hero responds, and either WASD or arrow keys works (the player picks).
 *
 * Movement is purely client-side. Combat (auto-attack) is resolved by
 * TroopSystem in the same tick, so manual movement and auto-attack compose.
 * @class
 */
class HeroInput {
  constructor(gameState) {
    this.gameState = gameState;
    this.keys = new Set();

    // Keys we own — preventDefault on these so arrow keys don't scroll the page.
    const owned = new Set([
      "w", "a", "s", "d",
      "arrowup", "arrowleft", "arrowdown", "arrowright",
    ]);

    const onDown = (e) => {
      const k = (e.key || "").toLowerCase();
      if (!owned.has(k)) return;
      // Don't steal keys from text inputs (e.g. PvP room-code field).
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      this.keys.add(k);
      if (e.preventDefault) e.preventDefault();
    };
    const onUp = (e) => {
      const k = (e.key || "").toLowerCase();
      this.keys.delete(k);
    };
    const onBlur = () => this.keys.clear();

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup",   onUp);
    window.addEventListener("blur",    onBlur);
  }

  update(deltaTime) {
    const gs = this.gameState;
    if (!gs || gs.gameOver) return;

    const mode = gs.gameMode;
    const localId = (window.networkingSystem && window.networkingSystem.getLocalPlayerId
      && window.networkingSystem.getLocalPlayerId()) || "player1";

    if (mode === "pvp") {
      // PvP: only your own hero moves. Accept WASD OR arrows so the player
      // can pick whichever set fits their hand.
      const vec = this._combine(this._readWASD(), this._readArrows());
      this._driveHero(localId, vec, deltaTime);
    } else {
      // Sandbox / single / training: each keyset drives its own hero.
      this._driveHero("player1", this._readWASD(),   deltaTime);
      this._driveHero("player2", this._readArrows(), deltaTime);
    }
  }

  _readWASD() {
    let dx = 0, dy = 0;
    if (this.keys.has("a")) dx -= 1;
    if (this.keys.has("d")) dx += 1;
    if (this.keys.has("w")) dy -= 1;
    if (this.keys.has("s")) dy += 1;
    return this._normalize(dx, dy);
  }

  _readArrows() {
    let dx = 0, dy = 0;
    if (this.keys.has("arrowleft"))  dx -= 1;
    if (this.keys.has("arrowright")) dx += 1;
    if (this.keys.has("arrowup"))    dy -= 1;
    if (this.keys.has("arrowdown"))  dy += 1;
    return this._normalize(dx, dy);
  }

  _normalize(dx, dy) {
    const mag = Math.sqrt(dx * dx + dy * dy);
    if (mag === 0) return { dx: 0, dy: 0 };
    return { dx: dx / mag, dy: dy / mag };
  }

  _combine(a, b) {
    // If WASD is active, use it; otherwise fall back to arrows.
    if (a.dx !== 0 || a.dy !== 0) return a;
    return b;
  }

  _driveHero(owner, vec, dt) {
    if (vec.dx === 0 && vec.dy === 0) return;
    const gs = this.gameState;
    // Prefer the cached ref. If it was never set (e.g. spawn timing or a
    // network re-resolve missed it), recover by scanning gs.troops.
    let hero = owner === "player1" ? gs.hero1 : gs.hero2;
    if (!hero) {
      hero = gs.troops && gs.troops.find((t) => t.isHero && t.owner === owner);
      if (hero) {
        if (owner === "player1") gs.hero1 = hero; else gs.hero2 = hero;
      }
    }
    if (!hero || hero.hp <= 0) return;
    const step = (hero.speed || 0) * dt;
    // Hero sprites are 2 tiles wide (boxSize = 2*ts in drawTroops), so the
    // sprite half-extent is 1 tile. With the renderer convention
    //   cx = (col + 0.5) * ts
    // sprite-flush LEFT  is col = 0.5         (sprite left edge at canvas x=0)
    // sprite-flush RIGHT is col = cols - 1.5  (sprite right edge at canvas x=cols*ts)
    // Symmetric vertically. These bounds keep the sprite fully on-canvas
    // while letting the hero hug any of the four walls.
    hero.col = Math.max(0.5, Math.min(gs.cols - 1.5, hero.col + vec.dx * step));
    hero.row = Math.max(0.5, Math.min(gs.rows - 1.5, hero.row + vec.dy * step));
    // Manual movement breaks auto-pursuit so the hero can disengage.
    // Targeting re-acquires next tick via TroopSystem._findTarget.
    hero.target = null;
  }
}

window.HeroInput = HeroInput;
