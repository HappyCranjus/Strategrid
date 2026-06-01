/**
 * AudioManager - Manages game audio (SFX only)
 * @class
 */

// Per-troop activation/attack sound names (loaded in init()). Troops not listed
// fall back to generic spawn + melee/ranged sounds chosen by attack range.
const troopSounds = {
  swordsman: { activate: "swordsmanActivation", attack: "swordsmanAttack" },
  archer:    { activate: "archerActivation",    attack: "archerAttack" },
  heavy:     { activate: "heavyActivation",     attack: "heavyAttack" },
  militia:   { activate: "militiaActivation",   attack: "militiaAttack" },
  brute:     { activate: "bruteActivation",     attack: "bruteAttack" },
  sentinel:  { activate: "sentinelActivation",  attack: "sentinelAttack" },
  settler:   { activate: "settlerActivation",   attack: null },
};

class AudioManager {
  constructor() {
    this.sounds = {};
    this.soundEnabled = true;
    this.volume = 1.0;
    this._lastPlayed = {};
  }

  /** Load the full SFX set. Call once after construction. */
  init() {
    const sfx = {
      swordsmanActivation: "sounds/swordsmanActivation.mp3",
      swordsmanAttack: "sounds/swordsmanAttack.mp3",
      archerActivation: "sounds/archerActivation.mp3",
      archerAttack: "sounds/archerAttack.mp3",
      heavyActivation: "sounds/heavyActivation.mp3",
      heavyAttack: "sounds/heavyAttack.mp3",
      militiaActivation: "sounds/militiaActivation.mp3",
      militiaAttack: "sounds/militiaAttack.mp3",
      bruteActivation: "sounds/bruteActivation.wav",
      bruteAttack: "sounds/bruteAttack.wav",
      sentinelActivation: "sounds/sentinelActivation.wav",
      sentinelAttack: "sounds/sentinelAttackSound.wav",
      settlerActivation: "sounds/settlerActivation.mp3",
      spawnSound: "sounds/spawnSound.mp3",
      deathSound: "sounds/deathSound.mp3",
      meleeAttack: "sounds/meleeAttackSound.mp3",
      rangedAttack: "sounds/rangedAttackSound.mp3",
      healSound: "sounds/healSound.mp3",
      boltStormActivation: "sounds/boltStormActivation.mp3",
      divineWind: "sounds/divineWind.mp3",
    };
    for (const name in sfx) this.loadSound(name, sfx[name]);
  }

  /**
   * Play a sound effect
   * @param {string} soundName - Name of the sound
   */
  playSound(soundName) {
    if (!this.soundEnabled) return;

    if (this.sounds[soundName]) {
      const sound = this.sounds[soundName];
      sound.currentTime = 0;
      sound.volume = this.volume;
      sound.play().catch((error) => {
        console.warn("Error playing sound:", error);
      });
    }
  }

  /**
   * Play a sound, but no more than once per minIntervalMs. Prevents SFX from
   * machine-gunning when many troops attack/die on the same frame.
   * @param {string} soundName
   * @param {number} minIntervalMs
   */
  playThrottled(soundName, minIntervalMs = 90) {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - (this._lastPlayed[soundName] || 0) < minIntervalMs) return;
    this._lastPlayed[soundName] = now;
    this.playSound(soundName);
  }

  /**
   * Load a sound
   * @param {string} soundName - Name of the sound
   * @param {string} path - Path to sound file
   */
  loadSound(soundName, path) {
    const audio = new Audio(path);
    this.sounds[soundName] = audio;
  }

  /** Play a troop's activation sound (or generic spawn for troops without one). */
  playTroopSpawn(troop) {
    const m = troopSounds[troop.type];
    this.playSound(m && m.activate ? m.activate : "spawnSound");
  }

  /** Play a troop's attack sound (or generic melee/ranged by range). Throttled. */
  playTroopAttack(troop) {
    const m = troopSounds[troop.type];
    if (m && m.attack) this.playThrottled(m.attack);
    else this.playThrottled(troop.range > 1.5 ? "rangedAttack" : "meleeAttack");
  }

  playTroopDeath() {
    this.playThrottled("deathSound", 60);
  }

  /** Mute/unmute SFX. */
  setMuted(muted) {
    this.soundEnabled = !muted;
  }
}

// Export for browser
window.AudioManager = AudioManager;
