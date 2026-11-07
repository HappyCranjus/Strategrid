'use strict';
/**
 * matrix.js — Pure Float32Array math for the neural network.
 * No dependencies. All ops work on pre-allocated typed arrays.
 *
 * Conventions:
 *   Matrices are row-major Float32Arrays: W[i*cols + j] = row i, col j.
 *   Vectors are plain Float32Arrays.
 */

/** W (rows×cols) @ x (cols) + b (rows) → out (rows) */
function matvec(W, x, rows, cols, b, out) {
  for (let i = 0; i < rows; i++) {
    let s = b[i];
    const base = i * cols;
    for (let j = 0; j < cols; j++) s += W[base + j] * x[j];
    out[i] = s;
  }
}

/** W.T (cols×rows) @ v (rows) → out (cols)   (transpose matmul) */
function tmatvec(W, v, rows, cols, out) {
  out.fill(0);
  for (let i = 0; i < rows; i++) {
    const vi = v[i];
    if (vi === 0) continue;
    const base = i * cols;
    for (let j = 0; j < cols; j++) out[j] += W[base + j] * vi;
  }
}

/** grad (rows×cols) += a (rows) ⊗ b (cols)   (outer product, accumulate) */
function outerAdd(a, b, rows, cols, grad) {
  for (let i = 0; i < rows; i++) {
    const ai = a[i];
    if (ai === 0) continue;
    const base = i * cols;
    for (let j = 0; j < cols; j++) grad[base + j] += ai * b[j];
  }
}

/** ReLU in-place */
function relu(x) {
  for (let i = 0; i < x.length; i++) if (x[i] < 0) x[i] = 0;
}

/**
 * Backprop through ReLU: multiply gradient by indicator (x_pre > 0).
 * preact = pre-activation values; grad is updated in-place.
 */
function reluBack(grad, preact) {
  for (let i = 0; i < grad.length; i++) if (preact[i] <= 0) grad[i] = 0;
}

/** Softmax of logits → probs (both length n), numerically stable. */
function softmax(logits, probs) {
  const n = logits.length;
  let max = -Infinity;
  for (let i = 0; i < n; i++) if (logits[i] > max) max = logits[i];
  let sum = 0;
  for (let i = 0; i < n; i++) { probs[i] = Math.exp(logits[i] - max); sum += probs[i]; }
  for (let i = 0; i < n; i++) probs[i] /= sum;
}

/** tanh scalar, returns [value, 1-value^2] for backprop */
function tanhFwd(x) {
  const v = Math.tanh(x);
  return { v, dv: 1 - v * v };
}

/**
 * Xavier-uniform init for a weight matrix (rows×cols).
 * scale = sqrt(6 / (fans_in + fans_out))
 */
function xavierInit(rows, cols) {
  const w = new Float32Array(rows * cols);
  const scale = Math.sqrt(6 / (rows + cols));
  for (let i = 0; i < w.length; i++) w[i] = (Math.random() * 2 - 1) * scale;
  return w;
}

/** Adam in-place update: applies gradient g to param w, using moment state. */
function adamUpdate(w, g, m, v, t, lr = 0.001, b1 = 0.9, b2 = 0.999, eps = 1e-8) {
  const bc1 = 1 - Math.pow(b1, t);
  const bc2 = 1 - Math.pow(b2, t);
  for (let i = 0; i < w.length; i++) {
    m[i] = b1 * m[i] + (1 - b1) * g[i];
    v[i] = b2 * v[i] + (1 - b2) * g[i] * g[i];
    w[i] -= lr * (m[i] / bc1) / (Math.sqrt(v[i] / bc2) + eps);
  }
}

/** Zero-fill a Float32Array and return it */
function zeros(n) { return new Float32Array(n); }

module.exports = { matvec, tmatvec, outerAdd, relu, reluBack, softmax, tanhFwd, xavierInit, adamUpdate, zeros };
