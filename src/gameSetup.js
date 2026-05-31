/**
 * GameSetup - Handles game initialization and setup
 * @class
 */
class GameSetup {
  static async initialize(canvas) {
    const gameState = new GameState();
    gameState.tileSize = Math.floor(
      Math.min(canvas.width / gameState.cols, canvas.height / gameState.rows)
    );
    const gameLogic = new GameLogic();
    const deckSystem = window.deckSystem || new DeckSystem();

    const troopSystem      = new TroopSystem(gameState, gameLogic);
    const buildingSystem   = new BuildingSystem(gameState, gameLogic);
    const strategemSystem  = new StrategemSystem(gameState, gameLogic);
    const influenceSystem  = new InfluenceSystem(gameState);
    const phaseSystem      = new PhaseSystem(gameState);
    const resourceSystem   = new ResourceSystem(gameState);
    const audioManager     = new AudioManager();
    const renderer         = new Renderer(canvas);
    const gameLoop         = new GameLoop();
    const heroInput        = new HeroInput(gameState);

    // Networking is constructed even outside PvP so uiState can pass a reference; it
    // becomes active only after a hello/join handshake.
    const signalingClient  = new SignalingClient();
    const networkingSystem = new NetworkingSystem(
      gameState, null, gameLogic, troopSystem, buildingSystem, strategemSystem, audioManager
    );
    networkingSystem.signalingClient = signalingClient;

    const uiState = new UIState(
      canvas, gameState, gameLogic,
      troopSystem, buildingSystem, strategemSystem,
      audioManager, renderer, deckSystem, networkingSystem
    );
    networkingSystem.uiState = uiState;

    return {
      gameState, gameLogic, deckSystem,
      troopSystem, buildingSystem, strategemSystem,
      influenceSystem, phaseSystem,
      resourceSystem, audioManager, renderer, uiState, gameLoop,
      networkingSystem, signalingClient, heroInput,
    };
  }
}

window.GameSetup = GameSetup;
