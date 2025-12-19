# Troops and Tactics (Strategrid)

A real-time strategy game where players build armies, manage resources, and engage in tactical combat.

## ⚠️ Important: Migration in Progress

**The codebase is currently undergoing a migration from a monolithic `game.js` (3,369 lines) to a modular system in `src/`.**

- **Active System**: `game.js` (still functional, marked as deprecated)
- **New System**: `src/` directory (in progress)
- **Status**: See `MIGRATION_STATUS.md` and `ACTIVE_CODEBASE.md` for details

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Open `index.html` in a web browser (or use a local server)
4. The game currently uses `game.js` - migration to modular system is in progress

## Game Systems

### Core Systems

#### Game Loop

The game follows a three-phase loop:

1. Build Phase: Place buildings and troops
2. Strategem Phase: Deploy special abilities
3. Battle Phase: Troops engage in combat

#### Resource System

- Resource Points (RP): Used for building and training
- Tactics Points (TP): Used for strategems
- Territory Control: Affects resource generation

### API Documentation

#### GameState

```javascript
class GameState {
  // Properties
  troops: Array<Troop>
  buildings: Array<Building>
  strategems: Array<Strategem>
  currentRP: { player1: number, player2: number }
  currentTP: { player1: number, player2: number }

  // Methods
  initialize(): void
  update(deltaTime: number): void
  addTroop(troop: Troop): void
  addBuilding(building: Building): void
  addStrategem(strategem: Strategem): void
}
```

#### BattlePhase

```javascript
class BattlePhase {
  // Properties
  active: boolean
  troops: Array<Troop>
  strategems: Array<Strategem>

  // Methods
  start(): void
  update(): void
  end(): void
  checkBattleEnd(): boolean
}
```

#### Renderer

```javascript
class Renderer {
  // Properties
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  viewport: { x: number, y: number, width: number, height: number }

  // Methods
  setViewport(x: number, y: number, width: number, height: number): void
  render(gameState: GameState): void
  drawGrid(grid: Grid): void
  drawTroops(troops: Array<Troop>): void
  drawBuildings(buildings: Array<Building>): void
  drawStrategems(strategems: Array<Strategem>): void
}
```

## Performance Optimizations

### Spatial Grid

- Divides game world into cells for efficient entity lookup
- Reduces collision detection complexity from O(n²) to O(n)
- Optimizes nearest-neighbor queries

### Rendering

- Dirty rectangle system for minimal redraws
- Viewport culling to only render visible objects
- Throttled updates to maintain frame rate
- Batch processing for troop updates

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - See LICENSE file for details
