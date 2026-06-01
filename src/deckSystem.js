/**
 * DeckSystem - Manages deck selection and validation
 * @class
 */
class DeckSystem {
  constructor() {
    // Trimmed core roster — see plan let-s-talk-about-the-composed-milner.md
    this.availableTroops = [
      "swordsman",
      "archer",
      "heavy",
      "militia",
      "settler",
      "brute",
      "sentinel",
    ];

    this.availableBuildings = [
      "wall",
      "farm",
      "cannon",
      "bunker",
      "supplyDepot",
      "warBonesFactory",
      "chillTurret",
      "lavaMortar",
    ];

    this.availableStrategems = [
      "heal",
      "wind",
      "necromancy",
      "ruin",
      "blast",
      "chainLightning",
      "gravityField",
      "lesserTeleport",
      "greaterTeleport",
      "chronoHaste",
      "chronoSlow",
      "chronoStop",
    ];

    // Default deck (4 troops, 2 buildings, 2 strategems)
    this.defaultDeck = {
      troops: ["swordsman", "archer", "heavy", "militia"],
      strategems: ["heal", "blast"],
      buildings: ["farm", "cannon"],
    };

    // Player decks storage
    this.playerDecks = {
      player1: JSON.parse(JSON.stringify(this.defaultDeck)),
      player2: JSON.parse(JSON.stringify(this.defaultDeck)),
    };

    // Flag to track if player2's deck was set from network (prevents overwrites in PvP)
    this.player2DeckSetFromNetwork = false;

    // Load saved decks from localStorage
    this.loadDecks();
  }

  /**
   * Set a deck for a player
   * @param {string} player - Player ID ("player1" or "player2")
   * @param {Object} deck - Deck object with troops, strategems, buildings arrays
   * @returns {boolean} - Success status
   */
  setPlayerDeck(player, deck) {
    if (!this.validateDeck(deck)) {
      console.error(`[DeckSystem] Invalid deck for ${player}`);
      return false;
    }

    // In PvP mode, protect player2's deck from being overwritten by player1's deck
    if (window.gameState && window.gameState.gameMode === "pvp") {
      if (player === "player2") {
        // STRICT PROTECTION: If player2's deck was already set from network, only allow identical decks
        if (this.player2DeckSetFromNetwork) {
          const existingDeck = this.playerDecks[player];
          if (existingDeck) {
            const isSameAsExisting =
              JSON.stringify(deck.troops) === JSON.stringify(existingDeck.troops) &&
              JSON.stringify(deck.strategems) === JSON.stringify(existingDeck.strategems) &&
              JSON.stringify(deck.buildings) === JSON.stringify(existingDeck.buildings);

            if (!isSameAsExisting) {
              console.error(`[DeckSystem] BLOCKED: Attempted to overwrite player2's network-set deck in PvP mode`);
              console.error(`[DeckSystem] Existing (network) deck:`, existingDeck);
              console.error(`[DeckSystem] Attempted deck:`, deck);

              // Check if it matches player1's deck (the main problem)
              if (this.playerDecks["player1"]) {
                const player1Deck = this.playerDecks["player1"];
                const isPlayer1Deck =
                  JSON.stringify(deck.troops) === JSON.stringify(player1Deck.troops) &&
                  JSON.stringify(deck.strategems) === JSON.stringify(player1Deck.strategems) &&
                  JSON.stringify(deck.buildings) === JSON.stringify(player1Deck.buildings);

                if (isPlayer1Deck) {
                  console.error(`[DeckSystem] BLOCKED: This is player1's deck - preventing overwrite of player2's deck!`);
                }
              }

              return false;
            } else {
              console.log(`[DeckSystem] Player2 deck already set correctly, skipping redundant set`);
              return true;
            }
          }
        }

        // If player2's deck hasn't been set from network yet, allow setting it
        // BUT: Check if we're trying to set player1's deck for player2
        const existingDeck = this.playerDecks[player];
        const defaultDeck = this.defaultDeck;
        const isExistingDefault = existingDeck
          ? JSON.stringify(existingDeck.troops) === JSON.stringify(defaultDeck.troops) &&
            JSON.stringify(existingDeck.strategems) === JSON.stringify(defaultDeck.strategems) &&
            JSON.stringify(existingDeck.buildings) === JSON.stringify(defaultDeck.buildings)
          : true;

        // Only check for player1 deck match if player2's deck is NOT default (i.e., already set)
        if (!isExistingDefault && this.playerDecks["player1"]) {
          const player1Deck = this.playerDecks["player1"];
          const isPlayer1Deck =
            JSON.stringify(deck.troops) === JSON.stringify(player1Deck.troops) &&
            JSON.stringify(deck.strategems) === JSON.stringify(player1Deck.strategems) &&
            JSON.stringify(deck.buildings) === JSON.stringify(player1Deck.buildings);

          if (isPlayer1Deck) {
            // Block only if we're the host (host shouldn't set player2's deck to match player1's)
            // Client is allowed to copy their own deck from player1 to player2
            if (window.networkingSystem && window.networkingSystem.isHost) {
              console.error(`[DeckSystem] BLOCKED: Host attempted to overwrite player2's custom deck with player1's deck`);
              console.error(`[DeckSystem] Player1 deck:`, player1Deck);
              console.error(`[DeckSystem] Existing player2 deck:`, existingDeck);
              console.error(`[DeckSystem] Attempted player2 deck:`, deck);
              return false;
            }
            // On client side: allow this - client is copying their own deck to player2
            console.log(`[DeckSystem] Client: Allowing copy of player1 deck to player2 (client setting their own deck)`);
          }
        }

        // If this is a new deck (not player1's), allow setting it and mark as network-set if from network
        // (The networkingSystem will set the flag after calling this)
      }
    }

    console.log(`[DeckSystem] Setting deck for ${player}:`, deck);
    this.playerDecks[player] = {
      troops: [...deck.troops],
      strategems: [...deck.strategems],
      buildings: [...deck.buildings],
    };

    this.saveDecks();
    return true;
  }

  /**
   * Validate a deck
   * @param {Object} deck - Deck object to validate
   * @returns {boolean} - Valid status
   */
  validateDeck(deck) {
    if (!deck || !deck.troops || !deck.strategems || !deck.buildings) {
      return false;
    }

    // Must have exactly 4 troops
    if (deck.troops.length !== 4) {
      return false;
    }

    // Must have exactly 2 strategems
    if (deck.strategems.length !== 2) {
      return false;
    }

    // Must have exactly 2 buildings
    if (deck.buildings.length !== 2) {
      return false;
    }

    // All troops must be valid
    for (const troop of deck.troops) {
      if (!this.availableTroops.includes(troop)) {
        return false;
      }
    }

    // All strategems must be valid
    for (const strategem of deck.strategems) {
      if (!this.availableStrategems.includes(strategem)) {
        return false;
      }
    }

    // All buildings must be valid
    for (const building of deck.buildings) {
      if (!this.availableBuildings.includes(building)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get a player's deck
   * @param {string} player - Player ID
   * @param {boolean} useDefaultIfEmpty - Return default deck if player has no deck
   * @returns {Object} - Deck object
   */
  getPlayerDeck(player, useDefaultIfEmpty = true) {
    if (this.playerDecks[player]) {
      return JSON.parse(JSON.stringify(this.playerDecks[player]));
    }
    // Only return default deck if explicitly requested (for game start)
    if (useDefaultIfEmpty) {
      return JSON.parse(JSON.stringify(this.defaultDeck));
    }
    // Return empty deck for deck builder UI
    return {
      troops: [],
      strategems: [],
      buildings: [],
    };
  }

  /**
   * Check if a troop is in a player's deck
   * @param {string} player - Player ID
   * @param {string} troopType - Troop type to check
   * @returns {boolean}
   */
  isTroopInDeck(player, troopType) {
    const deck = this.getPlayerDeck(player);
    return deck.troops.includes(troopType);
  }

  /**
   * Check if a building is in a player's deck
   * @param {string} player - Player ID
   * @param {string} buildingType - Building type to check
   * @returns {boolean}
   */
  isBuildingInDeck(player, buildingType) {
    const deck = this.getPlayerDeck(player);
    return deck.buildings.includes(buildingType);
  }

  /**
   * Check if a strategem is in a player's deck
   * @param {string} player - Player ID
   * @param {string} strategemType - Strategem type to check
   * @returns {boolean}
   */
  isStrategemInDeck(player, strategemType) {
    const deck = this.getPlayerDeck(player);
    return deck.strategems.includes(strategemType);
  }

  /**
   * Get all available troops
   * @returns {Array<string>}
   */
  getAvailableTroops() {
    return [...this.availableTroops];
  }

  /**
   * Get all available buildings
   * @returns {Array<string>}
   */
  getAvailableBuildings() {
    return [...this.availableBuildings];
  }

  /**
   * Get all available strategems
   * @returns {Array<string>}
   */
  getAvailableStrategems() {
    return [...this.availableStrategems];
  }

  /**
   * Save decks to localStorage
   */
  saveDecks() {
    try {
      // In PvP mode, only save the local player's deck to avoid cross-player persistence issues
      if (window.gameState && window.gameState.gameMode === "pvp") {
        const localPlayerId = window.networkingSystem
          ? window.networkingSystem.getLocalPlayerId()
          : "player1";

        // Only save the local player's deck
        const decksToSave = {
          [localPlayerId]: this.playerDecks[localPlayerId],
        };

        localStorage.setItem("playerDecks", JSON.stringify(decksToSave));
      } else {
        // In single-player modes, save both decks
        localStorage.setItem("playerDecks", JSON.stringify(this.playerDecks));
      }
    } catch (error) {
      console.error("Failed to save decks:", error);
    }
  }

  /**
   * Load decks from localStorage
   */
  loadDecks() {
    try {
      const saved = localStorage.getItem("playerDecks");
      if (saved) {
        const loaded = JSON.parse(saved);
        // Validate loaded decks
        for (const player in loaded) {
          if (this.validateDeck(loaded[player])) {
            // In PvP mode, don't overwrite player2's deck if it's already been set (e.g., from network)
            // This prevents localStorage from overwriting player2's deck that was received from the client
            if (
              player === "player2" &&
              window.gameState &&
              window.gameState.gameMode === "pvp"
            ) {
              const existingDeck = this.playerDecks[player];
              if (existingDeck) {
                const defaultDeck = this.defaultDeck;
                const isExistingDefault =
                  JSON.stringify(existingDeck.troops) === JSON.stringify(defaultDeck.troops) &&
                  JSON.stringify(existingDeck.strategems) === JSON.stringify(defaultDeck.strategems) &&
                  JSON.stringify(existingDeck.buildings) === JSON.stringify(defaultDeck.buildings);

                // Only overwrite if current deck is still default (allows initial load, but not overwriting network deck)
                if (!isExistingDefault) {
                  console.log(
                    `[DeckSystem] Skipping load of player2 deck from localStorage in PvP mode (deck already set from network)`
                  );
                  continue;
                }
              }
            }
            this.playerDecks[player] = loaded[player];
          }
        }
      }
    } catch (error) {
      console.error("Failed to load decks:", error);
    }
  }
}

// Export for browser
window.DeckSystem = DeckSystem;

