/**
 * LockstepSystem - Deterministic fixed-tick multiplayer synchronization.
 *
 * Both players run identical simulations. Instead of syncing state, only
 * inputs are exchanged each tick. With the same inputs and the same fixed
 * TICK_DELTA, both simulations stay bit-identical with no rubber-banding.
 *
 * Tick rate  : 30 Hz (TICK_DELTA = 1/30 s)
 * Input delay: 2 ticks (66 ms fixed latency for all players)
 *
 * Startup prefill: ticks 0..(INPUT_DELAY-1) are prefilled with empty inputs
 * on both sides so the first two ticks simulate immediately at game start.
 */

const TICK_DELTA   = 1 / 30;
const INPUT_DELAY  = 2;

class LockstepSystem {
  constructor(gameSetupResult, networkingSystem) {
    const { gameState, phaseSystem, influenceSystem, resourceSystem,
            troopSystem, buildingSystem, strategemSystem, heroInput } = gameSetupResult;

    this.gameState        = gameState;
    this.networkingSystem = networkingSystem;
    this.heroInput        = heroInput;
    this.systems = { phaseSystem, influenceSystem, resourceSystem,
                     troopSystem, buildingSystem, strategemSystem };

    this.isHost       = networkingSystem.isHost;
    this.localPlayer  = networkingSystem.getLocalPlayerId();

    // Tick counters
    this.simulationTick = 0;
    this.localInputTick = INPUT_DELAY; // first real commit targets tick INPUT_DELAY

    // Input buffers: Map<tick → input[]>
    this.localInputBuffer  = new Map();
    this.remoteInputBuffer = new Map();

    // Prefill the first INPUT_DELAY ticks as empty on both sides
    for (let t = 0; t < INPUT_DELAY; t++) {
      this.localInputBuffer.set(t, []);
      this.remoteInputBuffer.set(t, []);
    }

    // Inputs queued by the local player since the last commitLocalTick()
    this.pendingInputs = [];
  }

  /**
   * Queue a local input (spawn troop, place building, hero ability, etc.)
   * to be included in the next committed tick.
   */
  queueInput(input) {
    this.pendingInputs.push(input);
  }

  /**
   * Called by the game loop via rAF accumulator each time ≥ TICK_DELTA has
   * elapsed. Snapshots the hero direction, finalises the local input array
   * for localInputTick, sends it to the opponent, and advances localInputTick.
   */
  commitLocalTick() {
    const inputs = [...this.pendingInputs];

    // Snapshot held-key hero direction for this tick
    const dir = this.heroInput.getHeroDirection(this.localPlayer);
    if (dir.dx !== 0 || dir.dy !== 0) {
      inputs.push({ kind: "heroMove", dx: dir.dx, dy: dir.dy });
    }

    this.localInputBuffer.set(this.localInputTick, inputs);
    this.networkingSystem.sendTickInputs(this.localInputTick, inputs);

    this.pendingInputs = [];
    this.localInputTick++;
  }

  /**
   * Called by networkingSystem when the remote peer's tick packet arrives.
   */
  receiveRemoteTick(tick, inputs) {
    this.remoteInputBuffer.set(tick, inputs);
  }

  /**
   * Called each rAF frame. Advances simulation for every tick where both
   * sides' inputs are available.
   */
  tryAdvance() {
    while (
      this.localInputBuffer.has(this.simulationTick) &&
      this.remoteInputBuffer.has(this.simulationTick)
    ) {
      this._simulateTick(this.simulationTick);
      this.simulationTick++;
    }
  }

  _simulateTick(tick) {
    const local  = this.localInputBuffer.get(tick);
    const remote = this.remoteInputBuffer.get(tick);

    // Host is player1, joiner is player2
    const p1Inputs = this.isHost ? local  : remote;
    const p2Inputs = this.isHost ? remote : local;

    const gs = this.gameState;

    // Apply inputs first so spawned entities are simulated this tick
    for (const a of p1Inputs) gs.applyPlayerAction(a, "player1");
    for (const a of p2Inputs) gs.applyPlayerAction(a, "player2");

    const { phaseSystem, influenceSystem, resourceSystem,
            troopSystem, buildingSystem, strategemSystem } = this.systems;

    const inIntermission =
      gs.phase === "intermission1" || gs.phase === "intermission2";

    // Always advance time (phaseSystem updates matchTime)
    if (phaseSystem) phaseSystem.update(TICK_DELTA);

    if (!inIntermission && !gs.gameOver) {
      if (influenceSystem) influenceSystem.update(TICK_DELTA);
      if (resourceSystem)  resourceSystem.update(TICK_DELTA);
      if (troopSystem)     troopSystem.update(TICK_DELTA);
      if (buildingSystem)  buildingSystem.update(TICK_DELTA);
      if (strategemSystem) strategemSystem.update(TICK_DELTA);
    }

    // Free consumed buffer entries
    this.localInputBuffer.delete(tick);
    this.remoteInputBuffer.delete(tick);
  }
}

// Export constants so other modules can reference them
LockstepSystem.TICK_DELTA  = TICK_DELTA;
LockstepSystem.INPUT_DELAY = INPUT_DELAY;

window.LockstepSystem = LockstepSystem;
