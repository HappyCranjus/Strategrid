'use strict';
/**
 * network.js — Policy + value network for Strategrid.
 *
 * Architecture: STATE_SIZE → H1 → H2 → [policy: NUM_TILES, value: 1]
 *   Layer 1: Dense(H1) + ReLU
 *   Layer 2: Dense(H2) + ReLU
 *   Policy:  Dense(NUM_TILES) — logits (masked softmax at inference)
 *   Value:   Dense(1) + tanh  — win probability [-1, 1]
 *
 * Loss = cross_entropy(policy, true_tile) + 0.5 * MSE(value, outcome)
 * Optimizer: Adam (lr=0.001 by default)
 */

const { matvec, tmatvec, outerAdd, relu, reluBack, softmax, tanhFwd, xavierInit, adamUpdate, zeros } = require('./matrix');
const { STATE_SIZE } = require('./stateEncoder');
const { NUM_TILES } = require('./actionEncoder');

const H1 = 256, H2 = 128;

class Network {
  constructor() {
    // Weights
    this.W1 = xavierInit(H1, STATE_SIZE);
    this.b1 = zeros(H1);
    this.W2 = xavierInit(H2, H1);
    this.b2 = zeros(H2);
    this.Wp = xavierInit(NUM_TILES, H2);
    this.bp = zeros(NUM_TILES);
    this.Wv = xavierInit(1, H2);
    this.bv = zeros(1);

    // Adam moment vectors (m = first, v = second)
    this._initAdam();

    // Pre-allocated activation buffers (avoid GC pressure in hot loop)
    this._h1pre  = zeros(H1);
    this._h1     = zeros(H1);
    this._h2pre  = zeros(H2);
    this._h2     = zeros(H2);
    this._logits = zeros(NUM_TILES);
    this._policy = zeros(NUM_TILES);
    this._vpre   = zeros(1); // value head pre-activation (keep separate from _h1pre)

    // Pre-allocated gradient buffers
    this._dh2    = zeros(H2);
    this._dh2pre = zeros(H2);
    this._dh1    = zeros(H1);
    this._dh1pre = zeros(H1);
    this._dlogits = zeros(NUM_TILES);
    this._dW1  = zeros(H1 * STATE_SIZE);
    this._dW2  = zeros(H2 * H1);
    this._dWp  = zeros(NUM_TILES * H2);
    this._dWv  = zeros(H2);   // 1×H2 stored flat

    this._t = 0; // Adam time step
  }

  _initAdam() {
    const z = (n) => zeros(n);
    this._mW1 = z(H1*STATE_SIZE); this._vW1 = z(H1*STATE_SIZE);
    this._mb1 = z(H1);            this._vb1 = z(H1);
    this._mW2 = z(H2*H1);        this._vW2 = z(H2*H1);
    this._mb2 = z(H2);            this._vb2 = z(H2);
    this._mWp = z(NUM_TILES*H2);  this._vWp = z(NUM_TILES*H2);
    this._mbp = z(NUM_TILES);     this._vbp = z(NUM_TILES);
    this._mWv = z(H2);            this._vWv = z(H2);
    this._mbv = z(1);             this._vbv = z(1);
  }

  // ── Forward pass ───────────────────────────────────────────────────────────

  /**
   * Returns { policy (NUM_TILES probs), value (scalar), logits }.
   * Modifies internal activation buffers — do not call concurrently.
   */
  forward(x) {
    matvec(this.W1, x, H1, STATE_SIZE, this.b1, this._h1pre);
    this._h1.set(this._h1pre);
    relu(this._h1);

    matvec(this.W2, this._h1, H2, H1, this.b2, this._h2pre);
    this._h2.set(this._h2pre);
    relu(this._h2);

    matvec(this.Wp, this._h2, NUM_TILES, H2, this.bp, this._logits);
    softmax(this._logits, this._policy);

    matvec(this.Wv, this._h2, 1, H2, this.bv, this._vpre);
    const { v: value, dv: dtanh } = tanhFwd(this._vpre[0]);

    return { policy: this._policy, value, logits: this._logits, dtanh };
  }

  // ── Backward + Adam update ─────────────────────────────────────────────────

  /**
   * Compute gradients and apply one Adam step.
   * @param {Float32Array} x       — input state
   * @param {number}       target  — tile index the bot chose (0-based)
   * @param {number}       outcome — +1 (win) or -1 (loss)
   * @param {number}       value   — cached value from forward pass
   * @param {number}       dtanh   — cached 1-tanh^2 from forward pass
   * @param {number}       lr      — learning rate
   */
  backward(x, target, outcome, value, dtanh, lr = 0.001) {
    this._t++;

    // ── Policy gradient: d(cross-entropy) / d(logits) = softmax - one_hot ───
    this._dlogits.set(this._policy);
    this._dlogits[target] -= 1;

    // ── Value gradient: 0.5 * d(MSE) / d(value_pre) ─────────────────────────
    const dvalue_pre = 0.5 * 2 * (value - outcome) * dtanh;

    // ── Gradient at h2 from both heads ───────────────────────────────────────
    this._dh2.fill(0);
    tmatvec(this.Wp, this._dlogits, NUM_TILES, H2, this._dh2);
    // Add value head gradient: Wv.T * dvalue_pre
    for (let j = 0; j < H2; j++) this._dh2[j] += this.Wv[j] * dvalue_pre;

    // ── Through ReLU at h2 ────────────────────────────────────────────────────
    this._dh2pre.set(this._dh2);
    reluBack(this._dh2pre, this._h2pre);

    // ── Gradient at h1 ────────────────────────────────────────────────────────
    tmatvec(this.W2, this._dh2pre, H2, H1, this._dh1);

    // ── Through ReLU at h1 ────────────────────────────────────────────────────
    this._dh1pre.set(this._dh1);
    reluBack(this._dh1pre, this._h1pre);

    // ── Compute weight gradients ──────────────────────────────────────────────
    this._dW1.fill(0);  outerAdd(this._dh1pre, x,       H1,       STATE_SIZE, this._dW1);
    this._dW2.fill(0);  outerAdd(this._dh2pre, this._h1, H2,       H1,        this._dW2);
    this._dWp.fill(0);  outerAdd(this._dlogits, this._h2, NUM_TILES, H2,       this._dWp);
    // Wv gradient: outer([dvalue_pre], h2) stored as flat H2 vector
    for (let j = 0; j < H2; j++) this._dWv[j] = dvalue_pre * this._h2[j];

    // ── Adam updates ──────────────────────────────────────────────────────────
    const t = this._t;
    adamUpdate(this.W1, this._dW1,   this._mW1, this._vW1, t, lr);
    adamUpdate(this.b1, this._dh1pre, this._mb1, this._vb1, t, lr);
    adamUpdate(this.W2, this._dW2,   this._mW2, this._vW2, t, lr);
    adamUpdate(this.b2, this._dh2pre, this._mb2, this._vb2, t, lr);
    adamUpdate(this.Wp, this._dWp,   this._mWp, this._vWp, t, lr);
    adamUpdate(this.bp, this._dlogits, this._mbp, this._vbp, t, lr);
    // Wv: dWv is (H2,) representing (1×H2); bv gradient = dvalue_pre
    adamUpdate(this.Wv, this._dWv,   this._mWv, this._vWv, t, lr);
    const dbv = new Float32Array([dvalue_pre]);
    adamUpdate(this.bv, dbv,         this._mbv, this._vbv, t, lr);
  }

  /** Compute cross-entropy + MSE loss (for logging, no gradient). */
  loss(x, target, outcome) {
    const { policy, value } = this.forward(x);
    const policyLoss = -Math.log(Math.max(policy[target], 1e-9));
    const valueLoss  = (value - outcome) ** 2;
    return policyLoss + 0.5 * valueLoss;
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  save() {
    return {
      W1: Array.from(this.W1), b1: Array.from(this.b1),
      W2: Array.from(this.W2), b2: Array.from(this.b2),
      Wp: Array.from(this.Wp), bp: Array.from(this.bp),
      Wv: Array.from(this.Wv), bv: Array.from(this.bv),
      t: this._t,
      meta: { H1, H2, stateSize: STATE_SIZE, numTiles: NUM_TILES },
    };
  }

  load(obj) {
    this.W1.set(obj.W1); this.b1.set(obj.b1);
    this.W2.set(obj.W2); this.b2.set(obj.b2);
    this.Wp.set(obj.Wp); this.bp.set(obj.bp);
    this.Wv.set(obj.Wv); this.bv.set(obj.bv);
    this._t = obj.t || 0;
  }
}

module.exports = { Network, H1, H2 };
