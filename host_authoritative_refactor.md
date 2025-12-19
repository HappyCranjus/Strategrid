# Host-Authoritative PvP Refactor

## Overview

This refactor implements a **host-authoritative** networking model for PvP gameplay, eliminating desynchronization issues where two players would see different game states.

## Architecture

### Before (Peer-to-Peer Simulation)
- Both clients ran independent game simulations
- Only player actions (spawn, build, strategem) were synchronized
- Game state (troops, buildings, resources, territory) diverged over time
- Result: "Two different games" - desynchronized states

### After (Host-Authoritative)
- **Host** (player1) runs the authoritative game simulation
- **Client** (player2) sends actions to host and receives state updates
- Only host processes game logic (combat, movement, resources, territory)
- Client renders based on state received from host
- Result: Single source of truth, synchronized states

## Key Changes

### 1. Game State Serialization (`src/gameState.js`)
- Added `serialize()` method to convert game state to JSON
- Added `deserialize()` method to restore game state from JSON
- Includes: troops, buildings, strategems, grid, towers, resources, floating texts

### 2. Networking System (`src/networkingSystem.js`)
- **Host**: Sends periodic state syncs (every 200ms) to client
- **Client**: Receives state syncs and applies them to local state
- **Action Routing**:
  - Client actions → sent to host as `playerAction` messages
  - Host processes actions locally, includes in next state sync
- Added `startStateSync()`, `stopStateSync()`, `sendGameStateSync()`, `handleGameStateSync()`

### 3. Game Loop (`src/gameLoop.js`)
- Modified `updateGameSystems()` to skip simulation on client in PvP mode
- Only host runs: troop updates, building updates, strategem updates, territory control, resource generation
- Client only renders (state comes from network)

### 4. Input Handling (`src/uiState.js`)
- **Host**: Applies actions locally immediately (state sync handles network)
- **Client**: Sends actions to host, returns early (doesn't apply locally)
- Updated: `spawnTroopAt()`, `handleBuildClick()`, `handleStrategemClick()`

## Message Flow

### Client Sends Action
```
Client UI → sendSpawnTroop() → Network → Host receives playerAction
Host processes → handleRemoteSpawnTroop() → Applies to game state
Host game loop → Updates simulation → Next state sync includes new troop
Host → sendGameStateSync() → Client receives → handleGameStateSync() → Updates local state
```

### Host Sends Action
```
Host UI → spawnTroopAt() → Applies locally immediately
Host game loop → Updates simulation → Next state sync includes new troop
Host → sendGameStateSync() → Client receives → handleGameStateSync() → Updates local state
```

## State Sync Rate

- **Frequency**: Every 200ms (5 times per second)
- **Payload**: Full game state snapshot
- **Latency**: ~200ms delay between action and state update on client
- **Trade-off**: Higher bandwidth, but perfect synchronization

## Benefits

1. **Eliminates Desync**: Single source of truth (host)
2. **Deterministic**: No floating-point drift or timing differences
3. **Cheat Prevention**: Client can't modify game state directly
4. **Consistent**: Both players see identical game state

## Limitations

1. **Latency**: Client actions have ~200ms delay before appearing
2. **Bandwidth**: Full state syncs are larger than action-only messages
3. **Host Dependency**: If host disconnects, game ends (no migration)
4. **No Client Prediction**: Actions don't appear instantly on client (can be added later)

## Future Enhancements

1. **Client-Side Prediction**: Apply actions optimistically on client, correct when state sync arrives
2. **Delta Compression**: Send only changed state instead of full snapshot
3. **Interpolation**: Smooth rendering between state syncs
4. **Host Migration**: Transfer authority if host disconnects

## Testing

To test the refactor:
1. Start two browser windows/tabs
2. One as host (player1/blue), one as client (player2/red)
3. Perform actions on both sides
4. Verify both see identical game state (troops, buildings, resources, territory)
5. Check console logs for state sync messages

## Rollback

If issues occur, the old peer-to-peer system can be restored by:
1. Reverting `gameLoop.js` to always run simulation
2. Reverting `uiState.js` to apply actions locally on both sides
3. Removing state sync code from `networkingSystem.js`

