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

      if (!gameOver) {
        // Order matters: phase first (resource reads gs.phase), influence next
        // (resource reads tile owners), then resource, then AI (so it spends
        // current-frame RP/TP), then hero input (so hero positions are current
        // before troop combat), then movement/combat.
        if (phaseSystem) phaseSystem.update(deltaTime);
        if (influenceSystem) influenceSystem.update(deltaTime);
        if (resourceSystem) resourceSystem.update(deltaTime);
        if (aiController) aiController.update(deltaTime);
        if (heroInput) heroInput.update(deltaTime);
        if (troopSystem) troopSystem.update(deltaTime);
        if (buildingSystem) buildingSystem.update(deltaTime);
        if (strategemSystem) strategemSystem.update(deltaTime);
      }
      if (renderer) renderer.render();
    }

    this.animationFrameId = requestAnimationFrame(() => this.loop());
  }
}

// Export for browser
window.GameLoop = GameLoop;
