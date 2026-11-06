/**
 * seededRandom - Deterministic PRNG (mulberry32).
 * createRng(seed) returns a function that behaves like Math.random()
 * but produces the same sequence for the same seed.
 */
function createRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
}

window.createRng = createRng;
