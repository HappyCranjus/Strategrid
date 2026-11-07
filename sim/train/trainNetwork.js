'use strict';
/**
 * trainNetwork.js — Train the policy + value network via behavioral cloning.
 *
 * Usage:
 *   node sim/train/trainNetwork.js [dataFile] [outputWeights] [epochs] [lr]
 *   node sim/train/trainNetwork.js sim/train/data.bin src/model/weights.json 50 0.001
 */

const fs   = require('fs');
const path = require('path');

require('../loader'); // set up window global for gameActions
const { Network }  = require('./network');
const { STATE_SIZE } = require('./stateEncoder');

const DATA_FILE = process.argv[2] || path.join(__dirname, 'data.bin');
const OUT_FILE  = process.argv[3] || path.join(__dirname, '../../src/model/weights.json');
const EPOCHS    = parseInt(process.argv[4]) || 50;
const LR        = parseFloat(process.argv[5]) || 0.001;

// ── Load binary data ──────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_FILE)) {
  console.error(`Data file not found: ${DATA_FILE}`);
  console.error('Run generateData.js first.');
  process.exit(1);
}

const buf = fs.readFileSync(DATA_FILE);
const magic = buf.readUInt32LE(0);
if (magic !== 0x4E4E4441) { console.error('Invalid data file magic number'); process.exit(1); }
const N = buf.readUInt32LE(4);

const EX_BYTES = STATE_SIZE * 4 + 4 + 4;
console.log(`Loaded ${N} examples from ${DATA_FILE}`);

function getExample(i) {
  const offset = 8 + i * EX_BYTES;
  const state  = new Float32Array(STATE_SIZE);
  for (let j = 0; j < STATE_SIZE; j++) state[j] = buf.readFloatLE(offset + j * 4);
  const tileIdx = buf.readInt32LE(offset + STATE_SIZE * 4);
  const outcome = buf.readFloatLE(offset + STATE_SIZE * 4 + 4);
  return { state, tileIdx, outcome };
}

// ── Shuffle index array for each epoch ───────────────────────────────────────

const idx = Array.from({ length: N }, (_, i) => i);
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ── Train ─────────────────────────────────────────────────────────────────────

const net = new Network();
console.log(`Network: ${STATE_SIZE} → ${net.H1} → ${net.H2} → [288 policy, 1 value]`);
console.log(`Epochs: ${EPOCHS}, LR: ${LR}, Examples: ${N}\n`);

const t0 = Date.now();
for (let epoch = 1; epoch <= EPOCHS; epoch++) {
  shuffle(idx);
  let totalLoss = 0;
  let posCount = 0, negCount = 0;

  for (let i = 0; i < N; i++) {
    const { state, tileIdx, outcome } = getExample(idx[i]);
    const { value, dtanh } = net.forward(state);
    const policyLoss = -Math.log(Math.max(net._policy[tileIdx], 1e-9));
    totalLoss += policyLoss + 0.5 * (value - outcome) ** 2;
    net.backward(state, tileIdx, outcome, value, dtanh, LR);
    if (outcome > 0) posCount++; else negCount++;
  }

  const avgLoss = totalLoss / N;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  if (epoch % 5 === 0 || epoch === 1) {
    console.log(`Epoch ${String(epoch).padStart(3)}/${EPOCHS}  loss=${avgLoss.toFixed(4)}  pos=${posCount} neg=${negCount}  t=${elapsed}s`);
  }
}

// ── Save weights ───────────────────────────────────────────────────────────────

const outDir = path.dirname(OUT_FILE);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const weights = net.save();
fs.writeFileSync(OUT_FILE, JSON.stringify(weights));
const kb = (fs.statSync(OUT_FILE).size / 1000).toFixed(0);
console.log(`\nWeights saved to ${OUT_FILE} (${kb} KB)`);
console.log(`Total training time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('\nNext: node sim/train/evalNetwork.js');
