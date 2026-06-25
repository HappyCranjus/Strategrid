/**
 * AudioManager - Manages game audio (SFX only)
 * @class
 */

// Per-troop activation/attack sound names (loaded in init()). Troops not listed
// fall back to generic spawn + melee/ranged sounds chosen by attack range.
const troopSounds = {
  swordsman:  { activate: "swordsmanActivation", attack: "swordsmanAttack" },
  archer:     { activate: "archerActivation",    attack: "archerAttack" },
  heavy:      { activate: "heavyActivation",     attack: "heavyAttack" },
  militia:    { activate: "militiaActivation",   attack: "militiaAttack" },
  brute:      { activate: "bruteActivation",     attack: "bruteAttack" },
  sentinel:   { activate: "sentinelActivation",  attack: "sentinelAttack" },
  settler:    { activate: "settlerActivation",   attack: null },
  gustKnight: { attack: "gustKnightAttack" },
  commando:   { attack: "grenadeThrow" },
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
      // ── Troop activation / attack ───────────────────────────────────────────
      swordsmanActivation:  "sounds/swordsmanActivation.mp3",
      swordsmanAttack:      "sounds/swordsmanAttack.mp3",
      archerActivation:     "sounds/archerActivation.mp3",
      archerAttack:         "sounds/archerShoot_sound.wav",
      heavyActivation:      "sounds/heavyActivation.mp3",
      heavyAttack:          "sounds/heavyMelee.wav",
      militiaActivation:    "sounds/militiaActivation.mp3",
      militiaAttack:        "sounds/militiaAttack.mp3",
      bruteActivation:      "sounds/bruteActivation.wav",
      bruteAttack:          "sounds/bruteAttack.wav",
      bruteRage:            "sounds/BruteRage_sound.wav",
      sentinelActivation:   "sounds/sentinelActivation.wav",
      sentinelAttack:       "sounds/gun_sound.wav",
      settlerActivation:    "sounds/settlerActivation.mp3",
      gustKnightAttack:     "sounds/gustKnightMelee_wind_sound.wav",
      grenadeThrow:         "sounds/grenade_throw_sound.wav",
      // ── Generic fallbacks ───────────────────────────────────────────────────
      spawnSound:           "sounds/spawnSound.mp3",
      spawnSkeleton:        "sounds/spawn_skeleton_sound.wav",
      deathSound:           "sounds/death_sound.wav",
      meleeAttack:          "sounds/smallMelee.wav",
      rangedAttack:         "sounds/rangedAttackSound.mp3",
      // ── Strategems ──────────────────────────────────────────────────────────
      healSound:            "sounds/healSound.mp3",
      healTick:             "sounds/heal_tick_sound.wav",
      boltStormActivation:  "sounds/boltStormActivation.mp3",
      divineWind:           "sounds/divineWind.mp3",
      ruinActivate:         "sounds/ruin_activate_sound.wav",
      chainLightning:       "sounds/chain_lightning_hit_sound.wav",
      lesserTeleport:       "sounds/lesser_teleport_sound.wav",
      greaterTeleport:      "sounds/greater_teleport_sound.wav",
      chronoHaste:          "sounds/haste_sound.wav",
      chronoStop:           "sounds/chrono_stop_sound.wav",
      // ── Buildings ───────────────────────────────────────────────────────────
      cannonFire:           "sounds/cannon_fire_sound.wav",
      turretBlaster:        "sounds/blaster_sound.wav",
      turretFire:           "sounds/turret_fire_sound.wav",
      lavaMortarFire:       "sounds/lava_mortar_fire_sound.wav",
      // ── Resource milestones ─────────────────────────────────────────────────
      fullRP:               "sounds/full_RP_sound.wav",
      rpMilestone:          "sounds/RP_hits_multiple_of_5_sound.wav",
      fullTP:               "sounds/full_TP_sound.wav",
      tpGain:               "sounds/TP_gain_by_1_sound.wav",
      // ── Settler ─────────────────────────────────────────────────────────────
      settlerYoink:         "sounds/settler_yoink_tile_sound.wav",
      // ── Future units (registered now, wired when coded) ─────────────────────
      cloakUp:              "sounds/cloak_up_sound.wav",
      cloakDown:            "sounds/cloak_down_sound.wav",
      ninjaShuiken:         "sounds/ninja_shuriken_sound.wav",
      ogreGrab:             "sounds/ogre_grab_sound.wav",
      ogreThrow:            "sounds/ogre_throw_sound.wav",
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
