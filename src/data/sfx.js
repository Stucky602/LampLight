// Sound effects (ARCHITECTURE §9): ZzFX parameter lists, rendered once at boot. Kevin tunes these
// by name ("hit_soft quieter", "bell_ring lower"); zzfx.3d2k.org (the ZzFX designer) reads and
// writes the same lists.
//
//   zzfx: [volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide,
//          deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush,
//          delay, sustainVolume, decay, tremolo, filter]
//   voices: how many copies may play at once (a thousand hits must not become white noise)
//   pitch: random pitch spread per play (0.1 = up to 10% up or down)
//   gain: loudness on top of the SFX volume setting
//   gapMs: the least time between two starts of this sound (so a warning keeps meaning something)
//
// Shapes: 0 sine, 1 triangle, 2 saw, 3 tan, 4 noise, 5 square.

export const SFX = {
  // Hits and kills
  hit_soft: { zzfx: [0.5, 0, 260, 0, 0.01, 0.05, 4, 1.4, -10, 0, 0, 0, 0, 0.6], voices: 4, pitch: 0.18, gain: 0.35 },
  hit_hard: { zzfx: [0.6, 0, 170, 0, 0.02, 0.08, 4, 2, -6, 0, 0, 0, 0, 0.8], voices: 4, pitch: 0.15, gain: 0.45 },
  kill: { zzfx: [0.4, 0, 190, 0, 0.01, 0.09, 4, 1, -3, 0, 0, 0, 0, 1.5], voices: 3, pitch: 0.2, gain: 0.3 },
  kill_big: { zzfx: [0.9, 0, 70, 0.01, 0.2, 0.6, 4, 1.2, -1, 0, 0, 0, 0, 2, 0, 0.1], voices: 2, pitch: 0.05, gain: 0.8 },

  // Weapons
  flare_fire: { zzfx: [0.4, 0, 820, 0.005, 0.02, 0.1, 2, 1.8, -14, 0, 0, 0, 0, 0.2], voices: 3, pitch: 0.1, gain: 0.3 },
  orb_spawn: { zzfx: [0.3, 0, 440, 0.02, 0.05, 0.25, 0, 1, 5], voices: 2, pitch: 0.05, gain: 0.3 },
  harpoon_throw: { zzfx: [0.5, 0, 260, 0, 0.03, 0.14, 4, 1, -5, 0, 0, 0, 0, 0.3], voices: 3, pitch: 0.1, gain: 0.35 },
  bell_ring: { zzfx: [0.6, 0, 523, 0.005, 0.06, 0.9, 0, 1, 0, 0, 0, 0, 0, 0, 2.5, 0, 0, 0.6, 0.2], voices: 2, pitch: 0.03, gain: 0.45 },
  explode_small: { zzfx: [0.7, 0, 110, 0, 0.05, 0.3, 4, 1, -2, 0, 0, 0, 0, 1.2], voices: 3, pitch: 0.12, gain: 0.45 },
  enemy_shot: { zzfx: [0.3, 0, 330, 0.02, 0.05, 0.15, 1, 1, -4], voices: 2, pitch: 0.1, gain: 0.3, gapMs: 60 },

  // The player
  player_hurt: { zzfx: [0.8, 0, 150, 0, 0.05, 0.22, 3, 1, -6, 0, 0, 0, 0, 0.5, 0, 0.2], voices: 1, pitch: 0.06, gain: 0.7 },
  dash: { zzfx: [0.4, 0, 500, 0, 0.03, 0.12, 4, 1, -10, 0, 0, 0, 0, 0.4], voices: 1, pitch: 0.05, gain: 0.35 },
  heal: { zzfx: [0.4, 0, 523, 0.01, 0.1, 0.3, 0, 1, 3, 0, 262, 0.1], voices: 1, pitch: 0, gain: 0.4 },
  revive: { zzfx: [0.8, 0, 262, 0.05, 0.4, 0.6, 0, 1, 2, 0, 131, 0.15, 0.15], voices: 1, pitch: 0, gain: 0.7 },
  level_up: { zzfx: [0.6, 0, 392, 0.01, 0.18, 0.35, 1, 1, 0, 0, 131, 0.07, 0.07], voices: 1, pitch: 0, gain: 0.6 },

  // Pickups (the gem sound climbs in pitch while you keep collecting)
  gem: { zzfx: [0.3, 0, 1047, 0, 0.01, 0.07, 0, 1.6], voices: 1, pitch: 0, gain: 0.25 },
  pickup: { zzfx: [0.5, 0, 660, 0, 0.04, 0.16, 1, 1, 0, 0, 330, 0.05], voices: 2, pitch: 0, gain: 0.45 },
  chest_open: { zzfx: [0.6, 0, 220, 0.01, 0.1, 0.3, 2, 1, 1, 0, 110, 0.06, 0.06], voices: 1, pitch: 0, gain: 0.5 },
  reel_tick: { zzfx: [0.2, 0, 1400, 0, 0, 0.02, 1], voices: 2, pitch: 0.05, gain: 0.25 },
  reel_land: { zzfx: [0.5, 0, 330, 0, 0.04, 0.18, 1, 1, 0, 0, 165, 0.04], voices: 2, pitch: 0, gain: 0.45 },
  reel_big: { zzfx: [0.7, 0, 523, 0.01, 0.25, 0.5, 1, 1, 0, 0, 262, 0.08, 0.08, 0, 0, 0, 0, 0.8], voices: 1, pitch: 0, gain: 0.6 },
  evolve: { zzfx: [0.7, 0, 262, 0.02, 0.3, 0.6, 0, 1, 1, 0, 131, 0.1, 0.1, 0, 1], voices: 1, pitch: 0, gain: 0.6 },

  // Warnings and bosses
  warn: { zzfx: [0.35, 0, 880, 0, 0.06, 0.06, 5, 0.5, 0, 0, 0, 0, 0.09], voices: 1, pitch: 0, gain: 0.3, gapMs: 400 },
  warn_big: { zzfx: [0.6, 0, 440, 0, 0.12, 0.12, 5, 0.5, 0, 0, 0, 0, 0.12], voices: 1, pitch: 0, gain: 0.5 },
  boss_spawn: { zzfx: [0.9, 0, 55, 0.2, 0.6, 0.8, 0, 2, 0, 0, 0, 0, 0.18, 0.3, 0, 0, 0, 1, 0, 0.4], voices: 1, pitch: 0, gain: 0.8 },
  boss_slam: { zzfx: [1, 0, 60, 0, 0.1, 0.5, 4, 1, -1, 0, 0, 0, 0, 2, 0, 0.1], voices: 1, pitch: 0.05, gain: 0.8 },
  swarm: { zzfx: [0.4, 0, 900, 0.1, 0.3, 0.4, 4, 1, -2, 0, 0, 0, 0, 1, 20], voices: 1, pitch: 0.1, gain: 0.3 },

  // Menus
  ui_move: { zzfx: [0.15, 0, 900, 0, 0, 0.03, 1], voices: 1, pitch: 0, gain: 0.3 },
  ui_confirm: { zzfx: [0.3, 0, 660, 0, 0.03, 0.08, 1, 1, 0, 0, 330, 0.03], voices: 1, pitch: 0, gain: 0.4 },
  ui_back: { zzfx: [0.25, 0, 440, 0, 0.02, 0.07, 1, 1, -4], voices: 1, pitch: 0, gain: 0.35 },
};

/** Across every sound: at most this many playing at once (ARCHITECTURE §9). */
export const SFX_VOICE_CAP = 24;
