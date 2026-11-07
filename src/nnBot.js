/**
 * nnBot.js — In-browser neural network inference for the PvC AI.
 *
 * Loads weights from src/model/weights.json (created by sim/train/trainNetwork.js).
 * Exposes window.nnBot.pickSpawnTile(gs, player, gl, ds) → {row, col} | null
 *
 * Falls back gracefully when weights aren't available.
 */

// ── Inline matrix math (no imports in browser) ─────────────────────────────

function _matvec(W, x, rows, cols, b, out) {
  for (let i = 0; i < rows; i++) {
    let s = b[i], base = i * cols;
    for (let j = 0; j < cols; j++) s += W[base + j] * x[j];
    out[i] = s;
  }
}
function _relu(x) { for (let i = 0; i < x.length; i++) if (x[i] < 0) x[i] = 0; }
function _softmax(logits, probs) {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  let sum = 0;
  for (let i = 0; i < logits.length; i++) { probs[i] = Math.exp(logits[i] - max); sum += probs[i]; }
  for (let i = 0; i < logits.length; i++) probs[i] /= sum;
}

// ── State encoding (mirrors sim/train/stateEncoder.js) ─────────────────────

const _ROWS = 16, _COLS = 18, _STATE_SIZE = 672;
const _TROOP_TYPES = [
  'swordsman','archer','heavy','militia','settler','brute',
  'sentinel','bannerman','gustKnight','grenadier','invisiWitch',
  'ninja','ogre','warMachine','commando','skeleton','reaper','zombie',
  'brickMcStick','strategia',
];
const _NUM_TYPES = _TROOP_TYPES.length;
const _TROOP_ID  = {};
_TROOP_TYPES.forEach((t, i) => { _TROOP_ID[t] = i; });
const _PHASES = ['opening','intermission1','assault','intermission2','endgame'];

function _encodeState(gs, player) {
  const out  = new Float32Array(_STATE_SIZE);
  const flip = player === 'player2';
  const me = player, opp = flip ? 'player1' : 'player2';
  let i = 0;

  for (let r = 0; r < _ROWS; r++)
    for (let c = 0; c < _COLS; c++) {
      const col   = flip ? (_COLS - 1 - c) : c;
      const owner = gs.grid[r] && gs.grid[r][col] && gs.grid[r][col].owner;
      out[i++] = owner === me  ? 1 : 0;
      out[i++] = owner === opp ? 1 : 0;
    }

  for (const owner of [me, opp]) {
    const troops = gs.troops.filter(t => t && t.hp > 0 && t.owner === owner && !t.isHero);
    troops.sort((a, b) => owner === me
      ? (flip ? a.col - b.col : b.col - a.col)
      : (flip ? b.col - a.col : a.col - b.col));
    for (let k = 0; k < 10; k++) {
      const t = troops[k];
      const col = t ? (flip ? (_COLS - 1 - t.col) : t.col) : 0;
      out[i++] = t ? col / _COLS : 0;
      out[i++] = t ? t.row / _ROWS : 0;
      out[i++] = t ? t.hp / (t.maxHP || t.hp || 1) : 0;
      out[i++] = t ? (_TROOP_ID[t.type] || 0) / _NUM_TYPES : 0;
    }
  }

  for (const h of [me === 'player1' ? gs.hero1 : gs.hero2,
                   opp === 'player1' ? gs.hero1 : gs.hero2]) {
    const col = h ? (flip ? (_COLS - 1 - h.col) : h.col) : 0;
    out[i++] = h ? col / _COLS : 0;
    out[i++] = h ? h.row / _ROWS : 0;
    out[i++] = h ? h.hp / (h.maxHP || h.hp || 1) : 0;
  }

  out[i++] = (gs.currentRP[me]  || 0) / (gs.maxRP[me]  || 20);
  out[i++] = (gs.currentTP[me]  || 0) / (gs.maxTP[me]  || 10);
  out[i++] = (gs.currentRP[opp] || 0) / (gs.maxRP[opp] || 20);
  out[i++] = (gs.currentTP[opp] || 0) / (gs.maxTP[opp] || 10);
  for (const p of _PHASES) out[i++] = gs.phase === p ? 1 : 0;
  out[i++] = Math.min((gs.matchTime || 0) / 330, 1);
  return out;
}

function _indexToTile(idx, player) {
  const row = Math.floor(idx / _COLS);
  const c   = idx % _COLS;
  const col = player === 'player2' ? (_COLS - 1 - c) : c;
  return { row, col };
}

// ── NNBot class ───────────────────────────────────────────────────────────────

class NNBot {
  constructor() {
    this._loaded = false;
    this._W1 = this._b1 = this._W2 = this._b2 = null;
    this._Wp = this._bp = this._Wv = this._bv = null;
    // Pre-alloc buffers
    this._h1 = new Float32Array(128);
    this._h2 = new Float32Array(64);
    this._logits = new Float32Array(288);
    this._policy = new Float32Array(288);
  }

  async load(url) {
    url = url || (typeof location !== 'undefined'
      ? new URL('src/model/weights.json', location.origin).href
      : 'src/model/weights.json');
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const w = await resp.json();
      this._W1 = new Float32Array(w.W1); this._b1 = new Float32Array(w.b1);
      this._W2 = new Float32Array(w.W2); this._b2 = new Float32Array(w.b2);
      this._Wp = new Float32Array(w.Wp); this._bp = new Float32Array(w.bp);
      this._Wv = new Float32Array(w.Wv); this._bv = new Float32Array(w.bv);
      this._loaded = true;
      const params = w.W1.length + w.b1.length + w.W2.length + w.b2.length
                   + w.Wp.length + w.bp.length + w.Wv.length + w.bv.length;
      console.log(`NNBot loaded (${(params/1000).toFixed(0)}K params from ${url})`);
    } catch (e) {
      console.info('NNBot: no weights found, falling back to heuristic AI.', e.message);
    }
  }

  /**
   * Returns {row, col} of the best spawn tile according to the network,
   * or null if the network isn't loaded or no valid tile exists.
   */
  pickSpawnTile(gs, player, gl, ds) {
    if (!this._loaded) return null;

    const state = _encodeState(gs, player);
    _matvec(this._W1, state, 128, _STATE_SIZE, this._b1, this._h1); _relu(this._h1);
    _matvec(this._W2, this._h1, 64, 128, this._b2, this._h2);       _relu(this._h2);
    _matvec(this._Wp, this._h2, 288, 64, this._bp, this._logits);
    _softmax(this._logits, this._policy);

    // Build mask: valid spawn tiles for any affordable troop
    const deck = ds && ds.getPlayerDeck && ds.getPlayerDeck(player);
    if (!deck || !deck.troops) return null;
    const rp = gs.currentRP[player] || 0, tp = gs.currentTP[player] || 0;

    let bestIdx = -1, bestProb = -1;
    for (let idx = 0; idx < 288; idx++) {
      if (this._policy[idx] <= bestProb) continue;
      const row = Math.floor(idx / _COLS);
      const c   = idx % _COLS;
      const col = player === 'player2' ? (_COLS - 1 - c) : c;
      let valid = false;
      for (const t of deck.troops) {
        const def = (gl.troopTypes || {})[t];
        if (!def || rp < (def.cost || 0) || tp < (def.tpCost || 0)) continue;
        const e = window.gameActions.checkSpawnLegality(gs, gl, col, row, player, t);
        if (e.zoneOK && e.affordOK) { valid = true; break; }
      }
      if (valid) { bestIdx = idx; bestProb = this._policy[idx]; }
    }

    if (bestIdx < 0) return null;
    return _indexToTile(bestIdx, player);
  }
}

window.nnBot = new NNBot();
// Auto-load weights if available (non-blocking; silently skips if not found)
window.nnBot.load();
