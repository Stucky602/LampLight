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
  mirror_flash: { zzfx: [0.35, 0, 1400, 0, 0.02, 0.12, 1, 2, -40, 0, 0, 0, 0, 0, 0, 0.05], voices: 2, pitch: 0.06, gain: 0.3 },
  flask_throw: { zzfx: [0.35, 0, 520, 0.01, 0.04, 0.12, 2, 1.2, 8, 0, 0, 0, 0, 0.4], voices: 2, pitch: 0.1, gain: 0.3 },
  lightning: { zzfx: [0.6, 0, 90, 0, 0.04, 0.25, 4, 2.5, 0, 0, 0, 0, 0, 2.5, 0, 0.2], voices: 2, pitch: 0.1, gain: 0.45 },
  candle_summon: { zzfx: [0.3, 0, 300, 0.05, 0.08, 0.3, 0, 1, 2, 0, 150, 0.08], voices: 1, pitch: 0.05, gain: 0.3 },
  // Each weapon its own fire sound (0.9.0, the veteran round: 23 weapons shared 8). WEAPON_FIRE
  // below gives these to the weapons that borrowed another's.
  // Brine Spring: a gush of water bubbling up (noise through a low filter, rising, in bubbles).
  brine_gush: { zzfx: [0.4, 0.05, 300, 0.01, 0.06, 0.18, 4, 1, 6, 0, 0, 0, 0.03, 0.8, 0, 0, 0, 0.7, 0, 0.3, 900], voices: 2, pitch: 0.08, gain: 0.3 },
  // Ice Picks: a high glassy tick, falling a little, with a short ring.
  ice_throw: { zzfx: [0.3, 0, 1800, 0, 0.01, 0.06, 1, 2, -20, 0, 0, 0, 0, 0, 0, 0, 0.02, 0.5], voices: 3, pitch: 0.1, gain: 0.3 },
  // Fog Horn: a long low blare (a sawtooth near 100 Hz, swelling in, holding, sagging a little at the
  // end, through a low filter, with a slow waver), the diaphone's two-tone groan in one note.
  fog_horn: { zzfx: [0.5, 0, 98, 0.08, 0.45, 0.35, 2, 1.4, -0.4, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0.1, 0.06, 600], voices: 2, pitch: 0.03, gain: 0.4 },
  // Eel Pot: a wet snap (a sine sliding up fast, a little noise).
  eel_snap: { zzfx: [0.4, 0, 160, 0, 0.03, 0.1, 0, 2, 18, 0, 0, 0, 0, 0.3], voices: 2, pitch: 0.12, gain: 0.35 },
  // Anchor Chain: the chain's links rattling as it swings (a square wave stuttering).
  chain_swing: { zzfx: [0.4, 0, 420, 0, 0.05, 0.15, 5, 1, -4, 0, 0, 0, 0.025, 0.6, 0, 0.2, 0, 0.6], voices: 2, pitch: 0.06, gain: 0.3 },
  // Glass Caltrops: shards scattering on boards (a few high tinks).
  caltrop_drop: { zzfx: [0.25, 0.1, 2200, 0, 0.01, 0.05, 1, 1, 0, 0, 0, 0, 0.04, 0, 0, 0, 0, 0.4], voices: 2, pitch: 0.15, gain: 0.25 },
  // The signature weapons (0.9.0, W2). Grapnel: a line whipping out and an iron clink at its end.
  grapnel_throw: { zzfx: [0.45, 0, 340, 0, 0.04, 0.16, 4, 1, -6, 0, 0, 0, 0.03, 0.4, 0, 0.1], voices: 3, pitch: 0.1, gain: 0.33 },
  // Punt Pole: a short wooden thock (a low sine dropping fast).
  pole_jab: { zzfx: [0.5, 0, 180, 0, 0.02, 0.08, 1, 1.5, -10, 0, 0, 0, 0, 0.2], voices: 3, pitch: 0.08, gain: 0.35 },
  // Bog Hands: a squelch out of the mud (low noise sliding up).
  mire_grasp: { zzfx: [0.4, 0.05, 120, 0.02, 0.06, 0.2, 4, 1, 8, 0, 0, 0, 0.05, 0.5, 0, 0, 0, 0.7], voices: 2, pitch: 0.1, gain: 0.3 },
  // Grave Pennies: a coin's ping, a step up and a short ring.
  penny_flick: { zzfx: [0.3, 0, 1500, 0, 0.01, 0.12, 0, 1, 0, 0, 600, 0.02, 0, 0, 0, 0, 0, 0.6], voices: 3, pitch: 0.12, gain: 0.25 },
  // King Tide: a long low surge of water rolling out.
  tide_roll: { zzfx: [0.7, 0.05, 90, 0.2, 0.5, 0.8, 4, 1, 1, 0, 0, 0, 0, 0.6, 0, 0, 0, 0.8], voices: 1, pitch: 0.03, gain: 0.5 },
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

  // The map's things (0.8.2, proposal idea 9): each kind its own sound, so a player half watching
  // hears what happened without looking. They borrowed the level-up, evolve, and gem sounds before.
  // A lamp catching: a soft rising sine, the flame taking (some noise in it).
  lamp_lit: { zzfx: [0.5, 0, 220, 0.03, 0.18, 0.55, 0, 1, 3, 0, 110, 0.12, 0, 0.25, 0, 0, 0, 0.7, 0.1], voices: 1, pitch: 0, gain: 0.5 },
  // The fog taking a lamp back: the same sine falling away.
  lamp_out: { zzfx: [0.4, 0, 330, 0.01, 0.08, 0.5, 0, 1, -5, 0, 0, 0, 0, 0.3], voices: 2, pitch: 0.04, gain: 0.35, gapMs: 120 },
  // The Fog Bell's toll when its ring fills: lower and longer than the ring when it's done.
  bell_toll: { zzfx: [0.65, 0, 262, 0.005, 0.1, 1.4, 0, 1, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0.6, 0.3], voices: 1, pitch: 0, gain: 0.5 },
  // Each kill the bell counts: a short strike, played higher as the count falls (app/runlogic.js pitchFor).
  bell_count: { zzfx: [0.35, 0, 523, 0.002, 0.02, 0.3, 0, 1, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0.5, 0.08], voices: 2, pitch: 0, gain: 0.32, gapMs: 45 },
  // A Reliquary landing: a high glass chime with an echo.
  reliquary_chime: { zzfx: [0.5, 0, 1175, 0.004, 0.05, 0.55, 0, 1.4, 0, 0, 392, 0.07, 0, 0, 0, 0, 0.12, 0.5], voices: 1, pitch: 0, gain: 0.5 },
  // The vault rising: a low swell that climbs.
  vault_rise: { zzfx: [0.7, 0, 98, 0.18, 0.3, 0.6, 0, 1, 5, 0, 49, 0.25, 0, 0.15], voices: 1, pitch: 0, gain: 0.6 },
  // A chest landing out of view: two knocks on wood.
  chest_knock: { zzfx: [0.6, 0, 150, 0, 0.01, 0.06, 3, 1, -6, 0, 0, 0, 0.11, 0.6], voices: 1, pitch: 0.05, gain: 0.45 },
  // A drop landing in a lit lamp's light (the lamp watched it): a soft chime.
  ward_chime: { zzfx: [0.4, 0, 784, 0.005, 0.03, 0.4, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0.08, 0.5], voices: 1, pitch: 0, gain: 0.4 },
  // The Ferryman's oar as he ties up: a slow low wash of water (noise through a low filter).
  ferry_oar: { zzfx: [0.6, 0.1, 140, 0.12, 0.18, 0.45, 4, 1, -1, 0, 0, 0, 0.32, 2.5, 0, 0, 0, 0.6, 0, 0.4, -700], voices: 1, pitch: 0, gain: 0.55 },
  // Lantern Night banked: a held note with a fifth over it, soft.
  night_banked: { zzfx: [0.5, 0, 262, 0.06, 0.3, 0.7, 0, 1, 0, 0, 131, 0.16, 0, 0, 0, 0, 0, 0.8, 0, 0.1], voices: 1, pitch: 0, gain: 0.5 },
  // Lantern Night falling on the crowd: a wide swell with a jump up.
  night_falls: { zzfx: [0.8, 0, 196, 0.1, 0.4, 0.9, 0, 1, 1, 0, 98, 0.12, 0.12, 0.3, 1], voices: 1, pitch: 0, gain: 0.65 },
  // A Pearl picked up: a short high ping with an echo (the gem's is a plain blip).
  pearl: { zzfx: [0.3, 0, 1568, 0, 0.02, 0.14, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0.05, 0.4], voices: 1, pitch: 0.03, gain: 0.3, gapMs: 60 },

  // The growth core and the characters (C3, events 81 to 95). Each its own, so the ear knows what
  // happened without a word on screen.
  // A Legendary special taken: a low bell struck, a fifth over it, a long ring with an echo.
  legendary: { zzfx: [0.8, 0, 196, 0.005, 0.25, 1.3, 0, 1, 0, 0, 98, 0.12, 0, 0, 1.5, 0, 0.1, 0.7, 0.2], voices: 1, pitch: 0, gain: 0.7 },
  // A Form option taken: a triangle note stepping up a fifth, with a short echo.
  form_pick: { zzfx: [0.6, 0, 330, 0.01, 0.12, 0.5, 1, 1, 0, 0, 165, 0.09, 0, 0, 0, 0, 0.06, 0.7], voices: 1, pitch: 0, gain: 0.55 },
  // A capstone option taken: lower and longer, the step repeated.
  capstone_pick: { zzfx: [0.75, 0, 247, 0.01, 0.2, 0.8, 1, 1, 0, 0, 123, 0.1, 0.1, 0, 0.8, 0, 0.08, 0.7, 0.15], voices: 1, pitch: 0, gain: 0.65 },
  // An axis opens (its choice comes next): two soft rising notes.
  // (C3, ruling 18 P2: it shared the sea chest's pitch and step; now higher, a triangle, and rising.)
  axis_open: { zzfx: [0.4, 0, 659, 0.01, 0.04, 0.2, 1, 1, 4, 0, 330, 0.05], voices: 1, pitch: 0, gain: 0.38 },
  // A capstone's deed done: three quick steps up.
  deed_done: { zzfx: [0.55, 0, 587, 0.005, 0.08, 0.45, 0, 1, 0, 0, 294, 0.07, 0.07, 0, 0, 0, 0.05, 0.6], voices: 1, pitch: 0, gain: 0.5 },
  // A Rare or Epic line taken: a plucked note.
  line_taken: { zzfx: [0.4, 0, 494, 0.005, 0.04, 0.3, 1, 1, 0, 0, 247, 0.05], voices: 1, pitch: 0, gain: 0.4 },
  // Something planted (a pot, a buoy, a rod): a thunk into the boards.
  plant: { zzfx: [0.5, 0, 110, 0, 0.03, 0.18, 0, 1.5, -6, 0, 0, 0, 0, 0.6], voices: 2, pitch: 0.08, gain: 0.4, gapMs: 120 },
  // A Glass Ring closed: a high shimmer.
  glass_ring: { zzfx: [0.45, 0.05, 1760, 0.01, 0.1, 0.5, 1, 1, 0, 0, 0, 0, 0.05, 0, 0, 0, 0.04, 0.5, 0, 0.4], voices: 1, pitch: 0.05, gain: 0.4 },
  // The Tide Priest's ebb: water sucked back (low noise, falling, through a low filter).
  tide_ebb: { zzfx: [0.5, 0.05, 200, 0.15, 0.2, 0.4, 4, 1, -3, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.7, 0, 0.2, 600], voices: 1, pitch: 0.03, gain: 0.45 },
  // A flood she called: a low struck note under the roll.
  tide_call: { zzfx: [0.6, 0, 131, 0.02, 0.2, 0.6, 0, 1, 0, 0, 65, 0.1, 0, 0, 1], voices: 1, pitch: 0, gain: 0.5 },
  // The Punter's Momentum: a tick per step (higher each step), and a ring when it's full.
  momentum_step: { zzfx: [0.25, 0, 700, 0, 0.01, 0.04, 1, 1], voices: 1, pitch: 0, gain: 0.22, gapMs: 90 },
  momentum_full: { zzfx: [0.35, 0, 880, 0, 0.03, 0.15, 1, 1, 0, 0, 440, 0.04], voices: 1, pitch: 0, gain: 0.3, gapMs: 400 },
  // The signature takes an upgrade on its own track: a warm rising pair.
  sig_up: { zzfx: [0.5, 0, 349, 0.01, 0.1, 0.4, 1, 1, 0, 0, 175, 0.08, 0, 0, 0, 0, 0.05, 0.6], voices: 1, pitch: 0, gain: 0.45 },
  // A lantern set down: a small flame taking.
  lantern_set: { zzfx: [0.4, 0, 294, 0.02, 0.1, 0.4, 0, 1, 2, 0, 0, 0, 0, 0.2, 0, 0, 0, 0.7], voices: 1, pitch: 0.04, gain: 0.4 },
  // A crate brought up: a slosh of water and a knock; a sea chest rings after it.
  crate_up: { zzfx: [0.55, 0.1, 160, 0.03, 0.08, 0.3, 4, 1, 4, 0, 0, 0, 0.08, 1, 0, 0, 0, 0.6, 0, 0, 800], voices: 1, pitch: 0.05, gain: 0.5 },
  sea_chest: { zzfx: [0.6, 0, 392, 0.005, 0.08, 0.6, 0, 1, 0, 0, 196, 0.08, 0.08, 0, 0, 0, 0.1, 0.6], voices: 1, pitch: 0, gain: 0.55 },
  // The Lamplighter's oil: guttering when it runs down, a soft rise when a lamp fills it.
  oil_low: { zzfx: [0.35, 0.1, 180, 0.01, 0.1, 0.35, 4, 1, -4, 0, 0, 0, 0.04, 0.4, 0, 0, 0, 0.6, 0, 0.5, 500], voices: 1, pitch: 0, gain: 0.35, gapMs: 1500 },
  oil_fill: { zzfx: [0.4, 0, 262, 0.02, 0.1, 0.3, 0, 1, 6], voices: 1, pitch: 0, gain: 0.35, gapMs: 800 },
  // The Bog Warden walks over the fresh dead: a low wet groan out of the mud.
  dead_rise: { zzfx: [0.45, 0.05, 90, 0.05, 0.12, 0.35, 2, 1, 4, 0, 0, 0, 0, 0.6, 0, 0, 0, 0.7, 0, 0.3, 400], voices: 2, pitch: 0.1, gain: 0.35, gapMs: 150 },
  // The Harpooner's hook: an elite yanked (a heavy chain clank), loot reeled (a whir), the Grapnel's own haul (a short pull).
  haul_elite: { zzfx: [0.7, 0, 100, 0, 0.08, 0.3, 5, 1, -2, 0, 0, 0, 0.03, 1, 0, 0.2, 0, 0.6], voices: 1, pitch: 0.04, gain: 0.55 },
  haul_loot: { zzfx: [0.4, 0, 600, 0, 0.04, 0.12, 1, 1, -10, 0, 0, 0, 0.02], voices: 1, pitch: 0.05, gain: 0.35 },
  haul_line: { zzfx: [0.3, 0, 240, 0, 0.02, 0.08, 4, 1, 6, 0, 0, 0, 0, 0.3], voices: 2, pitch: 0.1, gain: 0.25, gapMs: 120 },
  // A skill's own effect going off: a short soft pluck (many skills, one quiet voice).
  skill: { zzfx: [0.3, 0, 523, 0, 0.02, 0.15, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0.03, 0.5], voices: 1, pitch: 0.05, gain: 0.28, gapMs: 200 },

  // The Dash slot's items (ruling 16): each a light sound of its own, all shorter than a weapon's.
  dash_wick: { zzfx: [0.35, 0, 620, 0, 0.03, 0.12, 4, 1, -10, 0, 0, 0, 0, 0.3, 0, 0, 0, 0.6, 0, 0, 2400], voices: 1, pitch: 0.05, gain: 0.3 },
  dash_heavy: { zzfx: [0.45, 0, 220, 0, 0.02, 0.1, 4, 1, -6, 0, 0, 0, 0, 0.8, 0, 0.1], voices: 1, pitch: 0.05, gain: 0.35 },
  dash_long: { zzfx: [0.35, 0, 460, 0.01, 0.06, 0.2, 4, 1, -6, 0, 0, 0, 0, 0.3, 0, 0, 0, 0.6, 0, 0, 1600], voices: 1, pitch: 0.05, gain: 0.3 },
  dash_mire: { zzfx: [0.4, 0.05, 150, 0.01, 0.04, 0.14, 4, 1, 6, 0, 0, 0, 0.04, 0.5, 0, 0, 0, 0.6, 0, 0, 700], voices: 1, pitch: 0.06, gain: 0.32 },
  dash_sink: { zzfx: [0.4, 0, 300, 0, 0.04, 0.16, 0, 1, -16, 0, 0, 0, 0, 0.2], voices: 1, pitch: 0.05, gain: 0.3 },
  dash_swell: { zzfx: [0.4, 0.1, 260, 0.01, 0.05, 0.2, 4, 1, 2, 0, 0, 0, 0, 0.7, 0, 0, 0, 0.6, 0, 0.3, 1100], voices: 1, pitch: 0.05, gain: 0.32 },
  dash_oar: { zzfx: [0.35, 0, 340, 0.01, 0.03, 0.12, 1, 1, -4, 0, 0, 0, 0, 0.4, 0, 0, 0, 0.6, 0, 0, 1300], voices: 1, pitch: 0.05, gain: 0.3 },
  dash_quick: { zzfx: [0.3, 0, 900, 0, 0.02, 0.06, 4, 1, -14, 0, 0, 0, 0, 0.2], voices: 1, pitch: 0.05, gain: 0.28 },

  // Menus
  ui_move: { zzfx: [0.15, 0, 900, 0, 0, 0.03, 1], voices: 1, pitch: 0, gain: 0.3 },
  ui_confirm: { zzfx: [0.3, 0, 660, 0, 0.03, 0.08, 1, 1, 0, 0, 330, 0.03], voices: 1, pitch: 0, gain: 0.4 },
  ui_back: { zzfx: [0.25, 0, 440, 0, 0.02, 0.07, 1, 1, -4], voices: 1, pitch: 0, gain: 0.35 },
};

/**
 * A weapon's own fire sound where its data borrows another weapon's (0.9.0): audio/cues.js
 * fireSound reads this first, then the weapon's sfx.fire. Keyed by weapon id, so the weapons' data
 * needn't change; a new weapon with a fire sound of its own needs no entry.
 */
export const WEAPON_FIRE = Object.freeze({
  brine_spring: 'brine_gush', ice_picks: 'ice_throw', fog_horn: 'fog_horn', eel_pot: 'eel_snap',
  anchor_chain: 'chain_swing', glass_caltrops: 'caltrop_drop',
});

/**
 * Each Dash slot item's own sound (C3; data/dashes.js ids). An item not listed (a new one) plays the
 * plain `dash`.
 */
export const DASH_SOUND = Object.freeze({
  wick_step: 'dash_wick', heavy_step: 'dash_heavy', long_push: 'dash_long', mire_step: 'dash_mire',
  sink: 'dash_sink', swell: 'dash_swell', spare_oar: 'dash_oar', quick_step: 'dash_quick',
});

/** Across every sound: at most this many playing at once (ARCHITECTURE §9). */
export const SFX_VOICE_CAP = 24;

/**
 * Rumble by kind (0.8.2, proposal idea 9; app/rumble.js plays them): a short shake of the
 * controller for things that happen on the map, most of all ones out of sight. ms: how long;
 * strong and weak: the two motors, 0 to 1, before Settings' strength (half by default). The
 * controller only: Kevin rules out screen shake (0.7.1).
 */
export const RUMBLE = Object.freeze({
  reliquary: Object.freeze({ ms: 140, strong: 0.3, weak: 0.7 }),
  vault: Object.freeze({ ms: 240, strong: 0.55, weak: 0.8 }),
  ferry: Object.freeze({ ms: 200, strong: 0.25, weak: 0.6 }),
  lamp: Object.freeze({ ms: 90, strong: 0.1, weak: 0.5 }),
  bell: Object.freeze({ ms: 220, strong: 0.6, weak: 0.6 }),
  night: Object.freeze({ ms: 320, strong: 0.7, weak: 0.9 }),
  // The fight's (0.9.0, the veteran round: V1 "rumble isn't used for combat"). A hit taken and a
  // boss's or champion's attack landing are scaled by the damage against your health (render/rumble.js
  // hurtScale); the low-health pulse by how low it is.
  hurt: Object.freeze({ ms: 120, strong: 0.55, weak: 0.35 }),
  bossHit: Object.freeze({ ms: 260, strong: 0.85, weak: 0.6 }),
  eliteKill: Object.freeze({ ms: 160, strong: 0.35, weak: 0.65 }),
  bossKill: Object.freeze({ ms: 400, strong: 0.9, weak: 0.9 }),
  levelUp: Object.freeze({ ms: 140, strong: 0.1, weak: 0.55 }),
  form: Object.freeze({ ms: 220, strong: 0.35, weak: 0.8 }),
  capstone: Object.freeze({ ms: 380, strong: 0.7, weak: 0.95 }),
  lowHealth: Object.freeze({ ms: 90, strong: 0.3, weak: 0 }),
  // C3 (ruling 14 E): a Legendary taken is the biggest shake a pick gives; a capstone's deed done, a
  // sea chest brought up, an elite yanked to the Harpooner, and a tide the Tide Priest called.
  legendary: Object.freeze({ ms: 400, strong: 0.8, weak: 1 }),
  deedDone: Object.freeze({ ms: 180, strong: 0.25, weak: 0.7 }),
  seaChest: Object.freeze({ ms: 220, strong: 0.4, weak: 0.7 }),
  haul: Object.freeze({ ms: 160, strong: 0.55, weak: 0.4 }),
  tideCall: Object.freeze({ ms: 260, strong: 0.5, weak: 0.7 }),
});
