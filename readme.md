# Strategrid

A real-time online-PvP strategy game. Two players, 5.5-minute matches with three escalating phases (Opening → Assault → Endgame) and intermission drafts between them. Tile influence drives resource generation; deck composition drives strategy.

## Status

The codebase is being rebuilt onto a stronger foundation. See `plans/let-s-talk-about-the-composed-milner.md` for the design and the work-in-progress phases. Current state: Phase A complete (cruft removed, roster trimmed). Phases B–E (new core systems, host-authoritative networking, UI rebuild, tests) are next.

## Run locally

```bash
# any static server works; the included script uses python3
./start-server.sh     # or start-server.bat on Windows
```

Then open `http://localhost:8000/index.html` in two browser tabs — one hosts, the other joins via the 4-digit room code.

## Game design constants

All match tunables (phase durations, RP/TP formulas, influence rates) live in `src/constants.js` (added in Phase B). Roster data tables live in `src/gameLogic.js`. To add a new troop, building, or strategem, edit the corresponding data table and rebuild the deck-builder UI — no system code needs to change.
