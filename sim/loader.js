/**
 * loader.js - Node.js shim + ordered eval of src game files.
 *
 * Sets up global.window = global (so all window.X = ... assignments work),
 * then evals only the simulation-relevant src files in dependency order.
 * Browser-only files (uiState, renderer, audioManager, etc.) are intentionally
 * excluded — they would throw on missing DOM.
 *
 * Call require('./loader') once at the top of any sim script.
 */

if (!global._simLoaded) {
  global.window   = global;
  global.document = null;
  global.performance = { now: () => Number(process.hrtime.bigint()) / 1e6 };
  global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

  const fs   = require('fs');
  const path = require('path');
  const SRC  = path.join(__dirname, '..', 'src');

  const ORDER = [
    'seededRandom.js',
    'gameLogic.js',
    'gameActions.js',
    'gameState.js',
    'deckSystem.js',
    'influenceSystem.js',
    'phaseSystem.js',
    'resourceSystem.js',
    'troopSystem.js',
    'buildingSystem.js',
    'strategemSystem.js',
    'lockstepSystem.js',
  ];

  for (const f of ORDER) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    // eslint-disable-next-line no-eval
    eval(code);
  }

  global._simLoaded = true;
}
