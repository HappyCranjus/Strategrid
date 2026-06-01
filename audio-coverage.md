# Audio Coverage

Snapshot of which game events currently have audio and which are silent.
Generic fallbacks count as ✗ (no per-type sound). "—" means N/A.

## Troops & Heroes

| Unit | Activation | Death | Attack | Notes |
|---|:---:|:---:|:---:|---|
| swordsman | ✓ | ✗ (generic `deathSound`) | ✓ | |
| archer | ✓ | ✗ generic | ✓ | |
| heavy | ✓ | ✗ generic | ✓ | |
| militia | ✓ | ✗ generic | ✓ | |
| brute | ✓ | ✗ generic | ✓ | |
| sentinel | ✓ | ✗ generic | ✓ | |
| settler | ✓ | ✗ generic | — | can't attack |
| skeleton (Necro summon) | ✗ generic `spawnSound` | ✗ generic | ✗ generic `meleeAttack` | |
| zombie (Necro summon) | ✗ generic `spawnSound` | ✗ generic | ✗ generic `meleeAttack` | |
| **brickMcStick** (hero) | ✗ generic `spawnSound` | ✗ generic | ✗ generic `meleeAttack` | needs hero-specific |
| **strategia** (hero) | ✗ generic `spawnSound` | ✗ generic | ✗ generic `rangedAttack` | needs hero-specific |

## Hero abilities

| Ability | Cast sound | Notes |
|---|:---:|---|
| Brick — Summoning Strike | ⚠ borrows `boltStormActivation` | shares with Blast strategem |
| Strategia — Ambush | ⚠ borrows `divineWind` | shares with Wind strategem |

## Strategems (deck-visible)

| Strategem | Activation (cast) | Occurrence (ongoing) |
|---|:---:|:---:|
| heal | ✓ | ✗ (no pulse sound) |
| wind | ✓ | ✗ |
| necromancy | ✗ | ✗ (raises silently) |
| ruin | ✗ | ✗ |
| blast | ✓ | — (instant) |
| chainLightning | ✗ | ✗ |
| gravityField | ✗ | ✗ |
| lesserTeleport | ✗ | ✗ |
| greaterTeleport | ✗ | ✗ |
| chronoHaste | ✗ | ✗ |
| chronoSlow | ✗ | ✗ |
| chronoStop | ✗ | ✗ |

Internal: `burningPatch` (Lava Mortar residue) — silent.

## Buildings

| Building | Activation (online) | Destruction | Action | Action type |
|---|:---:|:---:|:---:|---|
| wall | ✗ | ✗ | — | passive |
| farm | ✗ | ✗ | ✗ | RP pulse (orphan `farmActivation.mp3` could be wired) |
| cannon | ✗ | ✗ | ✗ | shot |
| bunker | ✗ | ✗ | ✗ | garrison enter/exit |
| supplyDepot | ✗ | ✗ | ✗ | TP pulse |
| warBonesFactory | ✗ | ✗ | ✗ | skeleton spawn |
| chillTurret | ✗ | ✗ | ✗ | chill zap |
| lavaMortar | ✗ | ✗ | ✗ | mortar fire + impact |
| towerTurret | ✗ | ✗ | ✗ | tower shot |

All 9 buildings are fully silent.

## Resource / Phase / UI

| Event | Status | Notes |
|---|:---:|---|
| RP bar fills (hits cap) | ✗ | |
| TP +1 gained (each tick) | ✗ | |
| TP bar fills (hits cap) | ✗ | |
| Intermission begins | ✗ | |
| Intermission ends (back to combat) | ✗ | |
| Final-5s tick — opening | ✗ | |
| Final-5s tick — intermission 1 | ✗ | |
| Final-5s tick — assault | ✗ | |
| Final-5s tick — intermission 2 | ✗ | |
| Final-5s tick — endgame | ✗ | |
| Game over | ✗ | |

## Cohesion gaps (beyond the original spec)

Events that fit the "audio = information channel" goal but weren't on the
original list:

1. **Insufficient TP/RP rejection** — clicking a spawn/strategem you can't
   afford gives no feedback. `womp.mp3` is on disk and unwired.
2. **Spawn-mode / build-mode / strategem-targeting toggle** — silent. A short
   click sound would confirm "you armed something."
3. **Two-click strategem first-click confirm** — wind/teleport need a second
   click for direction; a tick on the first click would signal "waiting for
   second click."
4. **Hero ability ready** — cooldown finishing is a key tactical moment. A
   faint chime when an ability comes off cooldown would help.
5. **Strategem ready** — same logic; cooldowns finishing currently have no
   audio cue.
6. **Influence flip / tile captured** — territory mechanic is core but silent.
7. **Building under attack** — buildings die without warning audio.
8. **Hero HP critical** — heroes are key pieces; a heartbeat at low HP is
   standard.
9. **Game-start / phase-start fanfare** — opening "FIGHT" cue.
10. **Intermission pick confirmed** — selecting a new troop/strategem
    mid-intermission gives no audio confirmation.

## Coverage summary

- **Troops**: 6/11 have activation, 7/11 have attack, **0/11 have a dedicated
  death sound** (all share one).
- **Strategems**: 3/12 deck-visible have a cast sound, **0/12 have an
  occurrence sound**.
- **Buildings**: **0/9 have any audio at all**.
- **Heroes**: **0/2 have dedicated attack sounds**; both abilities use
  borrowed strategem sounds.
- **Resources**: **0/3 events covered** (RP-full, TP-full, TP-gain).
- **Phase/UI**: **0/11 transition or warning sounds covered**.

Overall: ~16 of ~75 audio slots populated (~21% coverage).

## Orphan audio files (on disk, unloaded)

- **Duplicate variants**: `archerActivationSound.mp3`,
  `heavyActivationSound.mp3`, `heavyAttackSound.mp3`,
  `sentinelActivationSound.wav`, `sentinelAttackSound2.mp3`
- **Unused, could be wired**: `boltStormPlaced.wav`,
  `dasherActivationSound.mp3` (no dasher unit exists), `farmActivation.mp3`,
  `troopSelectSound.flac`, `womp.mp3`
- **Music remnants** (left after music removal): `menuMusic.wav`,
  `defaultGameMusic.wav`
