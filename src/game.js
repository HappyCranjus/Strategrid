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
    window.networkingSystem = window.gameSetupResult.networkingSystem || null;

    if (window.gameSetupResult.audioManager) {
      window.gameSetupResult.audioManager.init();
      window.gameSetupResult.audioManager.playMusic("game");
    }

    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get("mode") || "pvp";
    const pvpType = urlParams.get("type") || "roomcode";

    if (mode === "sandbox") {
      startSandbox();
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
      gameLoop.start();

      // Once decks are settled (deck sync arrives shortly after connect), populate deck buttons.
      setTimeout(() => buildDeckButtons(networkingSystem), 200);
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

/**
 * Generate deck buttons in the bottom HUD from the local player's deck.
 * Replaces the old static per-player control panels and compact-controls duplication.
 */
function buildDeckButtons(networkingSystem) {
  const localPlayerId = networkingSystem
    ? networkingSystem.getLocalPlayerId()
    : "player1";

  const troopContainer    = document.getElementById("troopButtons");
  const buildingContainer = document.getElementById("buildingButtons");
  const strategemContainer = document.getElementById("strategemButtons");
  if (!troopContainer || !buildingContainer || !strategemContainer) return;

  const deck = (window.deckSystem && window.deckSystem.getPlayerDeck(localPlayerId)) || {
    troops: [], buildings: [], strategems: [],
  };

  const displayNames = {
    swordsman: "Swordsman", archer: "Archer", heavy: "Heavy", militia: "Militia",
    settler: "Settler", brute: "Brute", sentinel: "Sentinel",
    wall: "Wall", farm: "Farm", sniperOutpost: "Sniper", missileSilo: "Missile Silo",
    warCamp: "War Camp", archerTower: "Archer Tower",
    heal: "Heal", divineWind: "Divine Wind", blizzard: "Blizzard", blast: "Blast",
  };

  const costLabel = (kind, key) => {
    const gl = window.gameLogic;
    if (!gl) return "";
    const def = kind === "troop" ? gl.troopTypes[key]
              : kind === "building" ? gl.buildingTypes[key]
              : gl.strategemTypes[key];
    if (!def) return "";
    if (kind === "troop")    return `${def.cost} RP`;
    if (kind === "building") return def.tpCost ? `${def.cost} RP + ${def.tpCost} TP` : `${def.cost} RP`;
    return `${def.tpCost} TP`;
  };

  troopContainer.innerHTML = "";
  buildingContainer.innerHTML = "";
  strategemContainer.innerHTML = "";

  const ui = window.gameSetupResult && window.gameSetupResult.uiState;
  const gs = window.gameSetupResult && window.gameSetupResult.gameState;

  for (const t of deck.troops || []) {
    const btn = document.createElement("button");
    btn.textContent = `${displayNames[t] || t} (${costLabel("troop", t)})`;
    btn.dataset.troopType = t;
    btn.dataset.owner = localPlayerId;
    btn.addEventListener("click", () => {
      if (ui && gs && gs.canPlayerAct(localPlayerId)) ui.setSpawnMode(localPlayerId, t);
    });
    troopContainer.appendChild(btn);
  }
  for (const b of deck.buildings || []) {
    const btn = document.createElement("button");
    btn.textContent = `${displayNames[b] || b} (${costLabel("building", b)})`;
    btn.dataset.buildingType = b;
    btn.dataset.owner = localPlayerId;
    btn.addEventListener("click", () => {
      if (ui && gs && gs.canPlayerAct(localPlayerId)) ui.setBuildMode(localPlayerId, b);
    });
    buildingContainer.appendChild(btn);
  }
  for (const s of deck.strategems || []) {
    const btn = document.createElement("button");
    btn.textContent = `${displayNames[s] || s} (${costLabel("strategem", s)})`;
    btn.dataset.strategemType = s;
    btn.dataset.owner = localPlayerId;
    btn.addEventListener("click", () => {
      if (ui) ui.setStrategemMode(localPlayerId, s);
    });
    strategemContainer.appendChild(btn);
  }
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

  const phaseLabel = document.getElementById("phaseDisplay");
  if (phaseLabel) phaseLabel.textContent = "Sandbox — both players controllable";

  // Both decks default to the saved local deck (or default); user can swap roster
  // by going back to the menu and editing the deck before re-launching.
  if (window.deckSystem) {
    const deck = window.deckSystem.getPlayerDeck("player1");
    // Force player2 to a usable deck even if the protection logic complains
    window.deckSystem.playerDecks["player2"] = JSON.parse(JSON.stringify(deck));
  }

  buildSandboxControls();
  buildDebugPanel();

  window.gameSetupResult.gameLoop.start();
}

/**
 * Replace the single-player deck button row with two side-by-side panels
 * (Blue P1 / Red P2). Both are interactive; clicking a button arms placement
 * mode for that owner.
 */
function buildSandboxControls() {
  const container = document.getElementById("deckButtons");
  if (!container) return;

  container.innerHTML = `
    <div id="sandboxPlayers" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div data-side="player1">
        <h4 style="color:#66aaff;margin:4px 0;">Blue (P1)</h4>
        <div class="deck-section"><div id="sbTroopsP1" class="button-row"></div></div>
        <div class="deck-section"><div id="sbBuildingsP1" class="button-row"></div></div>
        <div class="deck-section"><div id="sbStrategemsP1" class="button-row"></div></div>
      </div>
      <div data-side="player2">
        <h4 style="color:#ff6666;margin:4px 0;">Red (P2)</h4>
        <div class="deck-section"><div id="sbTroopsP2" class="button-row"></div></div>
        <div class="deck-section"><div id="sbBuildingsP2" class="button-row"></div></div>
        <div class="deck-section"><div id="sbStrategemsP2" class="button-row"></div></div>
      </div>
    </div>
  `;

  renderSandboxDeck("player1", "sbTroopsP1", "sbBuildingsP1", "sbStrategemsP1");
  renderSandboxDeck("player2", "sbTroopsP2", "sbBuildingsP2", "sbStrategemsP2");
}

function renderSandboxDeck(owner, troopsId, buildingsId, strategemsId) {
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
  [trooper, builder, stratter].forEach((el) => el && (el.innerHTML = ""));

  const display = (k) => ({
    swordsman: "Sword", archer: "Archer", heavy: "Heavy", militia: "Militia",
    settler: "Settler", brute: "Brute", sentinel: "Sentinel",
    wall: "Wall", farm: "Farm", sniperOutpost: "Sniper", missileSilo: "Missile",
    warCamp: "WarCamp", archerTower: "ArchTwr",
    heal: "Heal", divineWind: "Wind", blizzard: "Blizz", blast: "Blast",
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
    stratter && stratter.appendChild(mk("strategem", s, `${def.tpCost}T`, () => ui.setStrategemMode(owner, s)));
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
          if (influenceSystem) influenceSystem.update(dt);
          if (resourceSystem) resourceSystem.update(dt);
          if (heroInput) heroInput.update(dt);
          if (troopSystem) troopSystem.update(dt);
          if (buildingSystem) buildingSystem.update(dt);
          if (strategemSystem) strategemSystem.update(dt);
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
