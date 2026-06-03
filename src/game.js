/**
 * Main game entry — initializes systems and wires up online PvP.
 * The vs-CPU / local-PvP / RL training modes were removed during Phase A
 * of the simplification; see plans/let-s-talk-about-the-composed-milner.md.
 */

window.gameSetupResult = null;
window.deckSystem = null;

document.addEventListener("DOMContentLoaded", async () => {
  const canvas = document.getElementById("gameCanvas");
  if (!canvas) {
    console.error("Game canvas not found!");
    return;
  }

  try {
    window.deckSystem = new DeckSystem();

    window.gameSetupResult = await GameSetup.initialize(canvas);
    window.gameState = window.gameSetupResult.gameState;
    window.gameLogic = window.gameSetupResult.gameLogic;
    window.strategemSystem = window.gameSetupResult.strategemSystem;
    window.networkingSystem = window.gameSetupResult.networkingSystem || null;

    if (window.gameSetupResult.audioManager) {
      window.gameSetupResult.audioManager.init();
    }

    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get("mode") || "pvp";
    const pvpType = urlParams.get("type") || "roomcode";

    if (mode === "sandbox") {
      startSandbox();
    } else if (mode === "pvc") {
      startPvC();
    } else {
      window.gameState.setGameMode("pvp");
      setupMultiplayer(
        window.gameSetupResult.networkingSystem,
        window.gameState,
        window.gameSetupResult.gameLoop,
        pvpType
      );
    }

    console.log("Game initialized successfully!");
  } catch (error) {
    console.error("Failed to initialize game:", error);
  }
});

/**
 * Show the multiplayer connection overlay and wire its buttons.
 * onMultiplayerConnected fires from the networking layer when the data channel opens.
 */
function setupMultiplayer(networkingSystem, gameState, gameLoop, pvpType) {
  const overlay = document.getElementById("multiplayerOverlay");
  const statusText = document.getElementById("multiplayerStatusText");
  if (!overlay || !statusText) {
    console.error("[Multiplayer] Overlay or status text not found");
    return;
  }
  overlay.style.display = "flex";

  window.onMultiplayerConnected = () => {
    console.log("[Multiplayer] Connected — starting game");
    statusText.textContent = "Connected! Starting game…";

    if (networkingSystem.matchmakingTimers) {
      const t = networkingSystem.matchmakingTimers;
      if (t.timerInterval)    { clearInterval(t.timerInterval);    t.timerInterval = null; }
      if (t.roomCodeInterval) { clearInterval(t.roomCodeInterval); t.roomCodeInterval = null; }
    }

    setTimeout(() => {
      overlay.style.display = "none";
      gameState.paused = false;
      gameState.initialize();
      window.gameSetupResult.buildingSystem.placeInitialTurrets();
      installPhaseTimerHUD();
      gameLoop.start();

      // Once decks are settled (deck sync arrives shortly after connect), populate deck buttons.
      setTimeout(() => buildHotkeyRails(networkingSystem), 200);
    }, 800);
  };

  window.onMultiplayerDisconnected = () => {
    statusText.textContent = "Connection lost. Please try again.";
    overlay.style.display = "flex";
  };

  wireConnectionButtons(networkingSystem, statusText);

  if (pvpType === "matchmaking") {
    startMatchmaking(networkingSystem, statusText);
  }
}

/**
 * Wire the host/join/copy/cancel buttons in the multiplayer overlay to the
 * networking system. Originally lived in scattered inline scripts; centralized here.
 */
function wireConnectionButtons(networkingSystem, statusText) {
  const choiceSection = document.getElementById("choiceSection");
  const hostSection   = document.getElementById("hostSection");
  const joinSection   = document.getElementById("joinSection");
  const hostOfferCode = document.getElementById("hostOfferCode");
  const joinInput     = document.getElementById("joinOfferInput");

  const hostBtn = document.getElementById("hostGameBtn");
  if (hostBtn) {
    hostBtn.addEventListener("click", async () => {
      if (statusText) statusText.textContent = "Creating room…";
      try {
        const { roomCode } = await networkingSystem.startAsHost();
        if (hostOfferCode) hostOfferCode.textContent = roomCode;
        if (choiceSection) choiceSection.style.display = "none";
        if (joinSection)   joinSection.style.display = "none";
        if (hostSection)   hostSection.style.display = "block";
        if (statusText)    statusText.textContent = "Waiting for opponent…";
      } catch (err) {
        if (statusText) statusText.textContent = "Failed to create room: " + (err && err.message || err);
      }
    });
  }

  const joinBtn = document.getElementById("joinGameBtn");
  if (joinBtn) {
    joinBtn.addEventListener("click", () => {
      if (choiceSection) choiceSection.style.display = "none";
      if (hostSection)   hostSection.style.display = "none";
      if (joinSection)   joinSection.style.display = "block";
    });
  }

  const joinConnectBtn = document.getElementById("joinConnectBtn");
  if (joinConnectBtn) {
    joinConnectBtn.addEventListener("click", async () => {
      const code = (joinInput && joinInput.value || "").trim();
      if (!/^[0-9]{4}$/.test(code)) {
        if (statusText) statusText.textContent = "Enter a 4-digit room code.";
        return;
      }
      if (statusText) statusText.textContent = "Connecting…";
      try {
        await networkingSystem.joinAsClient(code);
      } catch (err) {
        if (statusText) statusText.textContent = "Failed to join: " + (err && err.message || err);
      }
    });
  }

  const copyBtn = document.getElementById("copyOfferBtn");
  if (copyBtn && hostOfferCode) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(hostOfferCode.textContent || "");
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
      } catch {}
    });
  }

  const cancelBtn = document.getElementById("cancelMultiplayerBtn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      networkingSystem.disconnect();
      window.location.href = "menu.html";
    });
  }
}

/**
 * Stub for open matchmaking (re-enabled in Phase C). For now, only room-code PvP is supported.
 */
async function startMatchmaking(networkingSystem, statusText) {
  console.warn("[Matchmaking] Open matchmaking is not implemented yet — use Room Code mode");
  if (statusText) statusText.textContent = "Open matchmaking not yet implemented — use Room Code mode.";
}

// Display labels keyed by troop / building / strategem / hero-ability identifier.
// Used by both rails. Anything missing falls back to the raw camelCase key.
const DECK_DISPLAY_NAMES = {
  swordsman: "Swordsman", archer: "Archer", heavy: "Heavy", militia: "Militia",
  settler: "Settler", brute: "Brute", sentinel: "Sentinel",
  bannerman: "Bannerman", gustKnight: "Gust Knight", grenadier: "Grenadier",
  invisiWitch: "Invisi Witch", ninja: "Ninja", ogre: "Ogre",
  warMachine: "War Machine", commando: "Commando",
  skeleton: "Skeleton", zombie: "Zombie",
  wall: "Wall", farm: "Farm", cannon: "Cannon", bunker: "Bunker",
  supplyDepot: "Supply Depot", warBonesFactory: "War Bones Factory",
  chillTurret: "Chill Turret", lavaMortar: "Lava Mortar",
  heal: "Heal Burst", wind: "Wind", necromancy: "Necromancy", ruin: "Ruin",
  blast: "Blast", chainLightning: "Chain Lightning", gravityField: "Gravity Field",
  lesserTeleport: "Lesser Teleport", greaterTeleport: "Greater Teleport",
  chronoHaste: "Chrono: Haste", chronoSlow: "Chrono: Slow", chronoStop: "Chrono: Stop",
  summoningStrike: "Summoning Strike", ambush: "Ambush",
};

// Hotkey + kind for each of the 12 fixed rail positions, top → bottom.
// Order matches the user-facing keyboard layout: troops, strategems, buildings.
const RAIL_POSITIONS = [
  { key: "1", kind: "troop",     deckIndex: 0 },
  { key: "2", kind: "troop",     deckIndex: 1 },
  { key: "3", kind: "troop",     deckIndex: 2 },
  { key: "4", kind: "troop",     deckIndex: 3 },
  { key: "5", kind: "troop",     deckIndex: 4 },
  { key: "6", kind: "troop",     deckIndex: 5 },
  { key: "7", kind: "strategem", deckIndex: 0 },
  { key: "8", kind: "strategem", deckIndex: 1 },
  { key: "9", kind: "strategem", deckIndex: 2 },
  { key: "0", kind: "strategem", deckIndex: 3 },
  { key: "<", kind: "building",  deckIndex: 0 },
  { key: ">", kind: "building",  deckIndex: 1 },
];

function _railCostLabel(kind, key) {
  const gl = window.gameLogic;
  if (!gl) return "";
  const def = kind === "troop"    ? gl.troopTypes[key]
            : kind === "building" ? gl.buildingTypes[key]
            :                       gl.strategemTypes[key];
  if (!def) return "";
  if (kind === "troop")    return `${def.cost} RP`;
  if (kind === "building") return def.tpCost ? `${def.cost} RP + ${def.tpCost} TP` : `${def.cost} RP`;
  return `${def.tpCost} TP`;
}

// Render a non-troop slot icon as a colored letter-glyph circle. Distinct
// palettes for buildings vs strategems make the row strips visually
// separable even before custom icons arrive.
function _railGlyphHTML(kind, key) {
  const label = (DECK_DISPLAY_NAMES[key] || key).replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase() || "?";
  const bg = kind === "building" ? "#8a6d3b" : kind === "strategem" ? "#6a4cb8" : "#555";
  return `<span class="glyph" style="background:${bg}">${label}</span>`;
}

function _railIconHTML(kind, key, owner) {
  if (kind === "troop") {
    const sprites = window.troopSpriteFiles && window.troopSpriteFiles[key];
    const file = sprites && sprites[owner];
    if (file) return `<img src="images/${file}" alt="${DECK_DISPLAY_NAMES[key] || key}">`;
  }
  return _railGlyphHTML(kind, key);
}

function _buildSlot(pos, item, owner, interactive) {
  const slot = document.createElement("div");
  slot.className = "hotkey-slot";
  slot.dataset.owner = owner;

  if (!item) {
    slot.classList.add("empty");
    slot.innerHTML = `<span class="slot-key">${pos.key}</span><div class="slot-icon"></div><div class="slot-name">—</div><div class="slot-cost"></div>`;
    return slot;
  }

  if (pos.kind === "troop")          slot.dataset.troopType = item;
  else if (pos.kind === "building")  slot.dataset.buildingType = item;
  else                               slot.dataset.strategemType = item;

  const name = DECK_DISPLAY_NAMES[item] || item;
  const cost = _railCostLabel(pos.kind, item);
  slot.innerHTML =
    `<span class="slot-key">${pos.key}</span>` +
    `<div class="slot-icon">${_railIconHTML(pos.kind, item, owner)}</div>` +
    `<div class="slot-name">${name}</div>` +
    `<div class="slot-cost">${cost}</div>`;

  if (interactive) {
    slot.addEventListener("click", () => {
      const ui = window.gameSetupResult && window.gameSetupResult.uiState;
      const gs = window.gameSetupResult && window.gameSetupResult.gameState;
      if (!ui || !gs) return;
      if (pos.kind === "troop"     && gs.canPlayerAct(owner)) ui.toggleSpawnMode(owner, item);
      else if (pos.kind === "building" && gs.canPlayerAct(owner)) ui.toggleBuildMode(owner, item);
      else if (pos.kind === "strategem") ui.toggleStrategemMode(owner, item);
    });
  }
  return slot;
}

function _appendHeroAbilityTile(rail, owner) {
  const gs = window.gameSetupResult && window.gameSetupResult.gameState;
  const gl = window.gameLogic;
  if (!gs || !gl || !gl.getHeroAbility) return;
  const hero = owner === "player1" ? gs.hero1 : gs.hero2;
  if (!hero) return;
  const def = gl.getHeroAbility(hero.type);
  if (!def) return;

  const tile = document.createElement("div");
  tile.className = "hotkey-slot hero-ability-tile";
  tile.dataset.owner = owner;
  tile.dataset.heroAbilityKey = def.key;
  tile.dataset.heroType = hero.type;
  const name = DECK_DISPLAY_NAMES[def.key] || def.key;
  tile.innerHTML =
    `<span class="slot-key">␣</span>` +
    `<div class="slot-icon">${_railGlyphHTML("strategem", def.key)}</div>` +
    `<div class="slot-name">${name}</div>` +
    `<div class="slot-cost">${def.tpCost} TP</div>`;
  tile.addEventListener("click", () => {
    if (window.strategemSystem) window.strategemSystem.tryActivateHeroAbility(owner);
  });
  rail.appendChild(tile);
}

function _populateRail(rail, owner, interactive) {
  const deck = (window.deckSystem && window.deckSystem.getPlayerDeck(owner)) || {
    troops: [], buildings: [], strategems: [],
  };
  rail.innerHTML = "";
  for (const pos of RAIL_POSITIONS) {
    const arr = pos.kind === "troop" ? deck.troops
              : pos.kind === "building" ? deck.buildings
              : deck.strategems;
    const item = arr ? arr[pos.deckIndex] : null;
    rail.appendChild(_buildSlot(pos, item, owner, interactive));
  }
  if (interactive) _appendHeroAbilityTile(rail, owner);
}

/**
 * Render the two side rails (P1 left, P2 right). Each rail has 12 fixed slots
 * top-to-bottom in order 1,2,3,4,5,6,7,8,9,0,<,>. The opponent rail is dimmed
 * and non-interactive outside sandbox so you can still glance at their kit +
 * strategem cooldowns. Click handlers + cooldown overlays + hotkey highlights
 * all key off the same data-* attributes the old #deckButtons buttons used,
 * so renderer._drawStrategemCooldowns + uiState._setupDeckHotkeys keep working.
 */
function buildHotkeyRails(networkingSystem) {
  const localPlayerId = networkingSystem ? networkingSystem.getLocalPlayerId() : "player1";
  const gs = window.gameSetupResult && window.gameSetupResult.gameState;
  const isSandbox = gs && gs.gameMode === "sandbox";

  for (const owner of ["player1", "player2"]) {
    const railId = owner === "player1" ? "hotkeyRailLeft" : "hotkeyRailRight";
    const rail = document.getElementById(railId);
    if (!rail) continue;
    const interactive = isSandbox || owner === localPlayerId;
    rail.classList.toggle("dimmed", !interactive);
    _populateRail(rail, owner, interactive);
  }
}


// ─── PvC (Player vs Computer) mode ───────────────────────────────────────────
// Bypasses networking. Player1 = human (saved deck, normal HUD). Player2 = AI
// driven by AIController with a random deck. Intermissions show a pick modal
// to the human and silently grow the AI's deck. Intended for end-to-end
// testing of deckbuilding, intermissions, and resource-pace escalation
// without needing two browsers.

function startPvC() {
  const gs = window.gameState;
  gs.setGameMode("pvc");
  gs.initialize();
  window.gameSetupResult.buildingSystem.placeInitialTurrets();

  // Player2 gets a random deck per match. Direct assignment bypasses
  // setPlayerDeck's PvP-network protection (which is gated on gameMode==="pvp"
  // anyway, but assigning directly mirrors the sandbox pattern).
  if (window.deckSystem) {
    window.deckSystem.playerDecks["player2"] = window.deckSystem.randomDeck();
  }

  const ai = new AIController(
    gs,
    window.gameLogic,
    window.deckSystem,
    window.gameSetupResult.strategemSystem,
    window.gameSetupResult.uiState
  );
  window.gameSetupResult.aiController = ai;

  buildHotkeyRails(null);

  installIntermissionOverlay();
  installPhaseTimerHUD();

  window.gameSetupResult.gameLoop.start();
}

const PVC_DISPLAY_NAMES = {
  swordsman: "Swordsman", archer: "Archer", heavy: "Heavy", militia: "Militia",
  settler: "Settler", brute: "Brute", sentinel: "Sentinel",
  wall: "Wall", farm: "Farm", cannon: "Cannon", bunker: "Bunker",
  supplyDepot: "Supply Depot", warBonesFactory: "War Bones Factory",
  chillTurret: "Chill Turret", lavaMortar: "Lava Mortar",
  heal: "Heal Burst", wind: "Wind", necromancy: "Necromancy", ruin: "Ruin",
  blast: "Blast", chainLightning: "Chain Lightning", gravityField: "Gravity Field",
  lesserTeleport: "Lesser Teleport", greaterTeleport: "Greater Teleport",
  chronoHaste: "Chrono: Haste", chronoSlow: "Chrono: Slow", chronoStop: "Chrono: Stop",
};

/**
 * Watch the phase clock; on entry to intermission1/2, show a modal letting the
 * human pick one new troop + one new strategem. On exit, auto-pick if the user
 * didn't confirm so the test always exercises deck growth. Re-renders the deck
 * button row after a pick (human or auto) so the new entries become usable.
 */
function installIntermissionOverlay() {
  const gs = window.gameState;
  const ds = window.deckSystem;
  if (!gs || !ds) return;

  const INTERMISSION_PHASES = new Set(["intermission1", "intermission2"]);
  let lastPhase = null;
  let confirmedThisRound = false;

  setInterval(() => {
    if (gs.gameOver) return;
    const phase = gs.phase;
    if (phase === lastPhase) return;

    if (INTERMISSION_PHASES.has(phase)) {
      confirmedThisRound = false;
      showIntermissionModal(ds, () => { confirmedThisRound = true; });
    } else if (INTERMISSION_PHASES.has(lastPhase)) {
      if (!confirmedThisRound) autoPickIntermission(ds, "player1");
      hideIntermissionModal();
      buildHotkeyRails(null);
    }

    lastPhase = phase;
  }, 200);
}

function showIntermissionModal(ds, onConfirm) {
  hideIntermissionModal();

  const deck = ds.getPlayerDeck("player1");
  const remainingTroops = ds.getAvailableTroops().filter((t) => !deck.troops.includes(t));
  const remainingStrats = ds.getAvailableStrategems().filter((s) => !deck.strategems.includes(s));

  const o = document.createElement("div");
  o.id = "intermissionOverlay";
  o.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.78);display:flex;align-items:center;" +
    "justify-content:center;z-index:10000;color:#eee;font-family:sans-serif;";
  o.innerHTML =
    "<div style=\"background:#222;padding:20px 24px;border-radius:8px;min-width:480px;max-width:640px;\">" +
      "<h2 style=\"margin:0 0 8px 0;\">Reinforcements</h2>" +
      "<p style=\"color:#bbb;margin:0 0 16px 0;\">Pick one new troop and one new strategem. Intermission lasts 15s.</p>" +
      "<div style=\"display:grid;grid-template-columns:1fr 1fr;gap:16px;\">" +
        "<div><h4 style=\"color:#ccc;margin:0 0 8px 0;\">Troop</h4>" +
        "<div id=\"intermTroopChoices\" style=\"display:flex;flex-wrap:wrap;gap:6px;\"></div></div>" +
        "<div><h4 style=\"color:#ccc;margin:0 0 8px 0;\">Strategem</h4>" +
        "<div id=\"intermStratChoices\" style=\"display:flex;flex-wrap:wrap;gap:6px;\"></div></div>" +
      "</div>" +
      "<div style=\"margin-top:16px;display:flex;justify-content:space-between;align-items:center;\">" +
        "<span style=\"color:#888;font-size:12px;\">No pick → auto-chosen at the end of intermission.</span>" +
        "<button id=\"intermConfirmBtn\" disabled style=\"padding:8px 16px;\">Confirm</button>" +
      "</div>" +
    "</div>";

  document.body.appendChild(o);

  const tBox = o.querySelector("#intermTroopChoices");
  const sBox = o.querySelector("#intermStratChoices");
  const confirmBtn = o.querySelector("#intermConfirmBtn");
  let chosenTroop = null;
  let chosenStrat = null;

  const mkChoiceButton = (key, kind, container) => {
    const b = document.createElement("button");
    b.textContent = PVC_DISPLAY_NAMES[key] || key;
    b.style.cssText =
      "padding:6px 10px;background:#444;color:#eee;border:1px solid #555;" +
      "border-radius:4px;cursor:pointer;font-family:inherit;";
    b.dataset.key = key;
    b.addEventListener("click", () => {
      container.querySelectorAll("button").forEach((x) => (x.style.background = "#444"));
      b.style.background = "#3a5";
      if (kind === "troop") chosenTroop = key;
      else chosenStrat = key;
      confirmBtn.disabled = !(chosenTroop && chosenStrat);
    });
    container.appendChild(b);
  };

  for (const t of remainingTroops) mkChoiceButton(t, "troop", tBox);
  for (const s of remainingStrats) mkChoiceButton(s, "strat", sBox);

  confirmBtn.addEventListener("click", () => {
    if (!(chosenTroop && chosenStrat)) return;
    ds.addTroop("player1", chosenTroop);
    ds.addStrategem("player1", chosenStrat);
    hideIntermissionModal();
    buildHotkeyRails(null);
    if (typeof onConfirm === "function") onConfirm();
  });
}

function hideIntermissionModal() {
  const o = document.getElementById("intermissionOverlay");
  if (o && o.parentNode) o.parentNode.removeChild(o);
}

function autoPickIntermission(ds, player) {
  const deck = ds.getPlayerDeck(player);
  const remTroops = ds.getAvailableTroops().filter((t) => !deck.troops.includes(t));
  const remStrats = ds.getAvailableStrategems().filter((s) => !deck.strategems.includes(s));
  if (remTroops.length) ds.addTroop(player, remTroops[Math.floor(Math.random() * remTroops.length)]);
  if (remStrats.length) ds.addStrategem(player, remStrats[Math.floor(Math.random() * remStrats.length)]);
}

// ─── Sandbox (dev) mode ──────────────────────────────────────────────────────
// Bypasses networking, gives both players' decks side-by-side, and exposes a
// debug panel for resources / pause / time-scale / restart. Used to play-test
// match feel without setting up two browsers.

function startSandbox() {
  const gs = window.gameState;
  gs.setGameMode("sandbox");
  // canPlayerAct returns true for both players in sandbox (see gameState.js).
  gs.initialize();
  window.gameSetupResult.buildingSystem.placeInitialTurrets();

  // Generous starting resources for fast testing.
  gs.maxRP.player1 = gs.maxRP.player2 = 50;
  gs.maxTP.player1 = gs.maxTP.player2 = 20;
  gs.currentRP.player1 = gs.currentRP.player2 = 20;
  gs.currentTP.player1 = gs.currentTP.player2 = 10;

  // Both decks default to the saved local deck (or default); user can swap roster
  // by going back to the menu and editing the deck before re-launching.
  if (window.deckSystem) {
    const deck = window.deckSystem.getPlayerDeck("player1");
    // Force player2 to a usable deck even if the protection logic complains
    window.deckSystem.playerDecks["player2"] = JSON.parse(JSON.stringify(deck));
  }

  buildSandboxControls();
  buildDebugPanel();
  installPhaseTimerHUD();

  window.gameSetupResult.gameLoop.start();
}

/**
 * Replace the single-player deck button row with two side-by-side panels
 * (Blue P1 / Red P2). Both are interactive; clicking a button arms placement
 * mode for that owner.
 */
function buildSandboxControls() {
  // The shared deck-button container was removed from game.html when the
  // side hotkey rails took over normal play modes. Sandbox is the only mode
  // that still needs a full per-player roster panel, so create one on demand
  // and mount it under #hud-bottom.
  let container = document.getElementById("deckButtons");
  if (!container) {
    container = document.createElement("div");
    container.id = "deckButtons";
    const hud = document.getElementById("hud-bottom");
    if (hud && hud.parentNode) hud.parentNode.insertBefore(container, hud.nextSibling);
    else document.body.appendChild(container);
  }

  container.innerHTML = `
    <div id="sandboxPlayers" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div data-side="player1">
        <h4 style="color:#66aaff;margin:4px 0;">Blue (P1)</h4>
        <div class="deck-section"><div id="sbTroopsP1" class="button-row"></div></div>
        <div class="deck-section"><div id="sbBuildingsP1" class="button-row"></div></div>
        <div class="deck-section"><div id="sbStrategemsP1" class="button-row"></div></div>
        <div class="deck-section"><div id="sbAbilitiesP1" class="button-row"></div></div>
      </div>
      <div data-side="player2">
        <h4 style="color:#ff6666;margin:4px 0;">Red (P2)</h4>
        <div class="deck-section"><div id="sbTroopsP2" class="button-row"></div></div>
        <div class="deck-section"><div id="sbBuildingsP2" class="button-row"></div></div>
        <div class="deck-section"><div id="sbStrategemsP2" class="button-row"></div></div>
        <div class="deck-section"><div id="sbAbilitiesP2" class="button-row"></div></div>
      </div>
    </div>
  `;

  renderSandboxDeck("player1", "sbTroopsP1", "sbBuildingsP1", "sbStrategemsP1", "sbAbilitiesP1");
  renderSandboxDeck("player2", "sbTroopsP2", "sbBuildingsP2", "sbStrategemsP2", "sbAbilitiesP2");
}

function renderSandboxDeck(owner, troopsId, buildingsId, strategemsId, abilitiesId) {
  const ui = window.gameSetupResult && window.gameSetupResult.uiState;
  const gs = window.gameSetupResult && window.gameSetupResult.gameState;
  const gl = window.gameLogic;
  const ds = window.deckSystem;
  if (!ui || !gs || !gl || !ds) return;

  // In sandbox: expose the full roster for testing, not just the saved deck.
  const deck = {
    troops: ds.getAvailableTroops(),
    buildings: ds.getAvailableBuildings(),
    strategems: ds.getAvailableStrategems(),
  };
  const trooper = document.getElementById(troopsId);
  const builder = document.getElementById(buildingsId);
  const stratter = document.getElementById(strategemsId);
  const abler = abilitiesId ? document.getElementById(abilitiesId) : null;
  [trooper, builder, stratter, abler].forEach((el) => el && (el.innerHTML = ""));

  const display = (k) => ({
    swordsman: "Sword", archer: "Archer", heavy: "Heavy", militia: "Militia",
    settler: "Settler", brute: "Brute", sentinel: "Sentinel",
    wall: "Wall", farm: "Farm", cannon: "Cannon", bunker: "Bunker",
    supplyDepot: "Depot", warBonesFactory: "Bones",
    chillTurret: "Chill", lavaMortar: "Mortar",
    heal: "Heal", wind: "Wind", necromancy: "Necro", ruin: "Ruin",
    blast: "Blast", chainLightning: "Chain", gravityField: "Gravity",
    lesserTeleport: "L.Tele", greaterTeleport: "G.Tele",
    chronoHaste: "Haste", chronoSlow: "Slow", chronoStop: "Stop",
    summoningStrike: "Sum.Strike", ambush: "Ambush",
  }[k] || k);

  const mk = (kind, key, cost, onClick) => {
    const b = document.createElement("button");
    b.textContent = `${display(key)} ${cost}`;
    b.style.fontSize = "11px";
    b.style.padding = "4px 6px";
    b.addEventListener("click", onClick);
    return b;
  };

  for (const t of deck.troops || []) {
    const def = gl.troopTypes[t]; if (!def) continue;
    trooper && trooper.appendChild(mk("troop", t, `${def.cost}R`, () => ui.setSpawnMode(owner, t)));
  }
  for (const bld of deck.buildings || []) {
    const def = gl.buildingTypes[bld]; if (!def) continue;
    const cost = def.tpCost ? `${def.cost}R+${def.tpCost}T` : `${def.cost}R`;
    builder && builder.appendChild(mk("building", bld, cost, () => ui.setBuildMode(owner, bld)));
  }
  for (const s of deck.strategems || []) {
    const def = gl.strategemTypes[s]; if (!def) continue;
    const b = mk("strategem", s, `${def.tpCost}T`, () => ui.setStrategemMode(owner, s));
    b.dataset.strategemType = s;
    b.dataset.owner = owner;
    stratter && stratter.appendChild(b);
  }

  // Hero ability button for this side's hero. Cooldown overlay attaches via
  // [data-hero-ability-key] (see renderer._drawStrategemCooldowns).
  const hero = (owner === "player1") ? gs.hero1 : gs.hero2;
  if (abler && hero && gl.getHeroAbility) {
    const def = gl.getHeroAbility(hero.type);
    if (def) {
      const keyLabel = (owner === "player1") ? "Space" : "Enter";
      const b = mk("ability", def.key, `${def.tpCost}T`, () => {
        if (window.strategemSystem) window.strategemSystem.tryActivateHeroAbility(owner);
      });
      b.textContent = `[${keyLabel}] ${display(def.key)} ${def.tpCost}T`;
      b.dataset.heroAbilityKey = def.key;
      b.dataset.heroType = hero.type;
      b.dataset.owner = owner;
      abler.appendChild(b);
    }
  }
}

/**
 * Floating debug panel: pause/play, time-scale, +RP/+TP per player, restart, kill.
 * Lives bottom-right; collapsible via header click.
 */
function buildDebugPanel() {
  if (document.getElementById("debugPanel")) return;
  const gs = window.gameState;
  const loop = window.gameSetupResult.gameLoop;
  const buildingSystem = window.gameSetupResult.buildingSystem;

  const panel = document.createElement("div");
  panel.id = "debugPanel";
  panel.style.cssText = `
    position: fixed; bottom: 8px; right: 8px; z-index: 9000;
    background: rgba(20,20,20,0.95); color: #eee; border: 1px solid #555;
    border-radius: 6px; padding: 8px 10px; font-family: monospace; font-size: 11px;
    min-width: 220px; box-shadow: 0 2px 8px rgba(0,0,0,0.6);
  `;
  panel.innerHTML = `
    <div id="debugHeader" style="cursor:pointer;font-weight:bold;color:#4caf50;display:flex;justify-content:space-between;">
      <span>Sandbox Debug</span><span id="debugToggle">▾</span>
    </div>
    <div id="debugBody" style="margin-top:6px;">
      <div style="margin:4px 0;">
        <button id="dbgPause">Pause</button>
        <button id="dbgRestart">Restart</button>
      </div>
      <div style="margin:4px 0;">
        Speed:
        <button data-speed="0.25">0.25x</button>
        <button data-speed="1">1x</button>
        <button data-speed="2">2x</button>
        <button data-speed="4">4x</button>
      </div>
      <div style="margin:6px 0;border-top:1px solid #333;padding-top:4px;">
        <div style="color:#66aaff;">Blue (P1)</div>
        <button data-give="rp" data-owner="player1">+5 RP</button>
        <button data-give="tp" data-owner="player1">+1 TP</button>
        <button data-kill="player1">Kill troops</button>
      </div>
      <div style="margin:6px 0;border-top:1px solid #333;padding-top:4px;">
        <div style="color:#ff6666;">Red (P2)</div>
        <button data-give="rp" data-owner="player2">+5 RP</button>
        <button data-give="tp" data-owner="player2">+1 TP</button>
        <button data-kill="player2">Kill troops</button>
      </div>
      <div id="debugStats" style="margin-top:6px;border-top:1px solid #333;padding-top:4px;color:#aaa;"></div>
    </div>
  `;
  document.body.appendChild(panel);

  // Compact button styling
  panel.querySelectorAll("button").forEach((b) => {
    b.style.cssText = "background:#333;color:#eee;border:1px solid #555;padding:3px 6px;margin:2px;font-size:11px;font-family:monospace;cursor:pointer;border-radius:3px;";
  });

  // Collapse toggle
  const body = panel.querySelector("#debugBody");
  const toggle = panel.querySelector("#debugToggle");
  panel.querySelector("#debugHeader").addEventListener("click", () => {
    if (body.style.display === "none") { body.style.display = ""; toggle.textContent = "▾"; }
    else { body.style.display = "none"; toggle.textContent = "▸"; }
  });

  // Pause
  const pauseBtn = panel.querySelector("#dbgPause");
  pauseBtn.addEventListener("click", () => {
    if (loop.isPaused) { loop.resume(); pauseBtn.textContent = "Pause"; }
    else { loop.pause(); pauseBtn.textContent = "Resume"; }
  });

  // Restart
  panel.querySelector("#dbgRestart").addEventListener("click", () => {
    gs.initialize();
    buildingSystem.placeInitialTurrets();
  });

  // Time-scale: wrap the GameLoop.loop with a multiplier on deltaTime
  if (!loop._origLoop) {
    loop._timeScale = 1;
    const origLoop = loop.loop.bind(loop);
    loop._origLoop = origLoop;
    loop.loop = function () {
      if (!this.isRunning) return;
      const now = performance.now();
      const dt = this.isPaused ? 0 : ((now - this.lastFrameTime) / 1000) * (this._timeScale || 1);
      this.lastFrameTime = now;
      if (!this.isPaused && window.gameSetupResult) {
        const {
          phaseSystem, influenceSystem,
          troopSystem, buildingSystem, strategemSystem,
          renderer, resourceSystem, gameState, heroInput,
        } = window.gameSetupResult;
        const over = gameState && gameState.gameOver;
        if (!over) {
          if (phaseSystem) phaseSystem.update(dt);
          const inIntermission = gameState &&
            (gameState.phase === "intermission1" || gameState.phase === "intermission2");
          if (!inIntermission) {
            if (influenceSystem) influenceSystem.update(dt);
            if (resourceSystem) resourceSystem.update(dt);
            if (heroInput) heroInput.update(dt);
            if (troopSystem) troopSystem.update(dt);
            if (buildingSystem) buildingSystem.update(dt);
            if (strategemSystem) strategemSystem.update(dt);
          }
        }
        if (renderer) renderer.render();
      }
      this.animationFrameId = requestAnimationFrame(() => this.loop());
    };
  }
  panel.querySelectorAll("[data-speed]").forEach((b) => {
    b.addEventListener("click", () => {
      loop._timeScale = parseFloat(b.dataset.speed);
      panel.querySelectorAll("[data-speed]").forEach((x) => (x.style.background = "#333"));
      b.style.background = "#4caf50";
    });
  });

  // Give resources
  panel.querySelectorAll("[data-give]").forEach((b) => {
    b.addEventListener("click", () => {
      const owner = b.dataset.owner;
      if (b.dataset.give === "rp") gs.addRP(owner, 5);
      else gs.addTP(owner, 1);
    });
  });

  // Kill all troops for a player
  panel.querySelectorAll("[data-kill]").forEach((b) => {
    b.addEventListener("click", () => {
      const owner = b.dataset.kill;
      for (let i = gs.troops.length - 1; i >= 0; i--) {
        if (gs.troops[i].owner === owner) gs.troops.splice(i, 1);
      }
    });
  });

  // Stats tick
  const stats = panel.querySelector("#debugStats");
  setInterval(() => {
    if (!stats) return;
    let p1Tiles = 0, p2Tiles = 0;
    for (let r = 0; r < gs.rows; r++) {
      for (let c = 0; c < gs.cols; c++) {
        const o = gs.grid[r][c].owner;
        if (o === "player1") p1Tiles++;
        else if (o === "player2") p2Tiles++;
      }
    }
    stats.innerHTML =
      `Phase: <b>${gs.phase}</b> &nbsp; T=${(gs.matchTime || 0).toFixed(1)}s<br>` +
      `Tiles: <span style="color:#66aaff;">P1=${p1Tiles}</span> ` +
      `<span style="color:#ff6666;">P2=${p2Tiles}</span><br>` +
      `Troops: P1=${gs.troops.filter((t) => t.owner === "player1").length} ` +
      `P2=${gs.troops.filter((t) => t.owner === "player2").length}<br>` +
      `Buildings: P1=${gs.buildings.filter((b) => b.owner === "player1").length} ` +
      `P2=${gs.buildings.filter((b) => b.owner === "player2").length}<br>` +
      `Hero HP: P1=${gs.hero1 ? gs.hero1.hp.toFixed(0) : "—"} P2=${gs.hero2 ? gs.hero2.hp.toFixed(0) : "—"}`;
  }, 500);
}

// ─── Phase timer HUD ─────────────────────────────────────────────────────────
// Drives #phaseDisplay + #phaseProgressBar from gs.phase / phaseDuration /
// phaseTimeRemaining (stamped by phaseSystem each frame). 10Hz is smooth enough
// for an m:ss countdown without burning frames.

const PHASE_LABEL_INTERMISSION = new Set(["intermission1", "intermission2"]);

function installPhaseTimerHUD() {
  if (window._phaseTimerHUDInstalled) return;
  window._phaseTimerHUDInstalled = true;
  setInterval(updatePhaseHUD, 100);
}

function updatePhaseHUD() {
  const gs = window.gameState;
  if (!gs || gs.gameOver) return;
  const label = document.getElementById("phaseDisplay");
  const bar = document.getElementById("phaseProgressBar");
  if (!label) return;

  const duration = gs.phaseDuration || 0;
  const remaining = gs.phaseTimeRemaining || 0;
  const secs = Math.max(0, Math.ceil(remaining));
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, "0");
  const timeStr = `${mm}:${ss}`;

  let title;
  if (PHASE_LABEL_INTERMISSION.has(gs.phase)) {
    title = `Intermission — ${timeStr}`;
    label.classList.add("intermission-active");
  } else if (gs.phase === "endgame") {
    title = `Endgame — ${timeStr}`;
    label.classList.remove("intermission-active");
  } else {
    title = `Countdown to Intermission — ${timeStr}`;
    label.classList.remove("intermission-active");
  }
  label.textContent = title;

  if (bar && duration > 0) {
    const elapsed = duration - remaining;
    const pct = Math.max(0, Math.min(100, (elapsed / duration) * 100));
    bar.style.width = `${pct}%`;
  }
}
