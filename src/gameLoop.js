/**
 * GameLoop - Manages the game loop
 * @class
 */
class GameLoop {
  constructor() {
    this.isRunning = false;
    this.isPaused = false;
    this.lastFrameTime = 0;
    this.animationFrameId = null;
  }

  /**
   * Start the game loop
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.loop();
  }

  /**
   * Stop the game loop
   */
  stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Pause the game loop
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * Resume the game loop
   */
  resume() {
    this.isPaused = false;
    this.lastFrameTime = performance.now();
  }

  /**
   * Main game loop
   */
  loop() {
    if (!this.isRunning) return;

    const currentTime = performance.now();
    const deltaTime = this.isPaused ? 0 : (currentTime - this.lastFrameTime) / 1000;
    this.lastFrameTime = currentTime;

    if (!this.isPaused && window.gameSetupResult) {
      const {
        phaseSystem, influenceSystem,
        troopSystem, buildingSystem, strategemSystem,
        renderer, resourceSystem, gameState, heroInput,
        aiController,
      } = window.gameSetupResult;
      const gameOver = gameState && gameState.gameOver;
      const ls = window.lockstepSystem;

      try {
        if (!gameOver) {
          if (ls) {
            // ── PvP lockstep ──────────────────────────────────────────────
            // Drive tick commitment at 30 Hz via rAF accumulator.
            this._tickAccum = (this._tickAccum || 0) + deltaTime;
            while (this._tickAccum >= LockstepSystem.TICK_DELTA) {
              ls.commitLocalTick();
              this._tickAccum -= LockstepSystem.TICK_DELTA;
            }
            // Advance simulation for every tick whose inputs have arrived.
            ls.tryAdvance();
          } else {
            // ── Sandbox / PvC: direct variable-delta simulation ───────────
            if (phaseSystem) phaseSystem.update(deltaTime);

            const inIntermission = gameState &&
              (gameState.phase === "intermission1" || gameState.phase === "intermission2");

            if (!inIntermission) {
              if (influenceSystem) influenceSystem.update(deltaTime);
              if (resourceSystem)  resourceSystem.update(deltaTime);
              if (aiController)    aiController.update(deltaTime);
              if (troopSystem)     troopSystem.update(deltaTime);
              if (buildingSystem)  buildingSystem.update(deltaTime);
              if (strategemSystem) strategemSystem.update(deltaTime);
            }
            // Hero movement only in non-lockstep modes (lockstep reads direction per-tick)
            if (heroInput) heroInput.update(deltaTime);
          }
        }
      } catch (e) {
        console.error("[GameLoop] System update error:", e);
      }
      if (renderer) renderer.render();
    }

    this.animationFrameId = requestAnimationFrame(() => this.loop());
  }
}

// Export for browser
window.GameLoop = GameLoop;
