// Every feel value and curve in one place (ARCHITECTURE §6.3, §15). Kevin tunes by name
// ("dash cooldown 2.5"); the tuning panel (Phase 3) edits these live, and "Copy tuning" gives
// back the changed ones to fold in here. Distances are in world pixels (the view is 640 x 360),
// times in seconds, speeds in pixels per second.

export const TUNING = {
  player: {
    speed: 80,                 // px/s at moveSpeed 1
    radius: 5,                 // body for contact damage and walls
    pickupRadius: 10,          // gems and pickups touching this are collected
    contactIframes: 0.5,       // after a hit, no more contact damage for this long
    shoveMax: 0.15,            // px a tick the crowd can shove you (9 px/s): jostled, never bulldozed
    reviveIframes: 2,          // after a revival
    reviveHpFraction: 0.5,
    reviveClearRadius: 96,     // enemies this close are pushed away on revival
    dash: {
      distance: 52,            // px covered by one dash
      time: 0.16,              // s the dash lasts (invulnerable throughout)
      cooldown: 2.5,           // s, times the dashCooldown stat
      iframesAfter: 0.1,       // extra invulnerability once it ends
    },
    // Stat defaults under every character (a character's base overrides these).
    stats: {
      moveSpeed: 1, maxHp: 100, regen: 0, armor: 0, magnet: 1, luck: 1, growth: 1, greed: 1,
      density: 1, revival: 0, reroll: 2, banish: 1, skip: 2, dashCooldown: 1,
    },
    minDamageTaken: 1,         // armor can't reduce a hit below this
  },

  caps: {
    player: {
      moveSpeed: [0.4, 2.5], maxHp: [1, 9999], regen: [0, 50], armor: [0, 30], magnet: [0.5, 10],
      luck: [0.1, 10], growth: [0.1, 10], greed: [0.1, 10], density: [0.25, 5], revival: [0, 9],
      reroll: [0, 99], banish: [0, 99], skip: [0, 99], dashCooldown: [0.3, 3],
    },
    weapon: {
      minCooldownFraction: 0.1,   // cooldown can't drop below 10% of the weapon's own
      minCooldown: 0.05,
      maxExtraAmount: 10,
      maxPierce: 8,              // a shot hits at most this many enemies (its hit memory; sim HIT_RING)
      area: [0.25, 4],           // x the weapon's own area
      speed: [0.25, 4],          // x the weapon's own speed
      duration: [0.1, 10],       // seconds (duration is a time, not a multiplier)
    },
  },

  xp: {
    // XP needed to go from level L to L+1: first + perLevel x (L - 1), plus a step at the
    // listed levels (these slow the run down a little past its peaks).
    first: 5,
    perLevel: 10,
    lateFrom: 20,
    latePerLevel: 13,
    steps: { 20: 600, 40: 2400 },
    gemMergeAt: 1500,          // gems on the field before new gems merge into one big gem
    magnetRadius: 32,          // px at magnet 1
    magnetPop: 70,             // px/s a pulled gem first hops away from you before it flies in
    magnetAccel: 900,          // px/s² a pulled gem speeds up by
    magnetMaxSpeed: 520,
    magnetItemPull: 2,         // s the magnet pickup keeps pulling every gem on the map
  },

  enemies: {
    knockbackScale: 1,         // global multiplier on every weapon's knockback
    knockbackDecay: 0.82,      // velocity kept per tick
    knockbackMax: 360,         // px/s cap on knockback speed
    separation: 0.35,          // how hard crowds push apart (0 = stack, 1 = rigid)
    separationRange: 1.0,      // push when closer than this x the sum of two radii
    separationFar: 480,        // px: enemies farther than this (well off screen) skip crowd pushing
    teleportDistance: 960,     // px behind the player (1.5 screens) before an enemy jumps ahead
    spawnRing: 400,            // px from the player: just outside the view on every side
    spawnJitter: 48,
    bossCatchupDistance: 480,  // a boss this far away moves faster
    bossCatchupSpeed: 2,
    flashTicks: 6,             // hit flash length (render reads it)
    eliteHp: 12,               // x HP for the elite modifier
    eliteSize: 1.6,
    eliteContact: 1.5,
    eliteXp: 10,
    eliteMass: 3,              // x mass for the elite modifier (knockback moves it less)
    bossKnockback: 0.1,        // bosses feel this fraction of any knockback
    chargerRecoverSpeed: 0.3,  // x speed while a charger recovers after its dash
    rangedBackOff: 0.75,       // a ranged enemy closer than this x its range backs away...
    rangedDrift: 0.25,         // ...and inside its range it only drifts, at this x speed
    freezeBossFactor: 0.25,    // bosses feel freeze for a quarter as long
    telegraphMin: 0.8,         // s: every attack that can hurt the player warns this long first
    swarmDespawnDistance: 900, // swarm walls vanish once this far away
    playerBlock: 0.5,          // how much a crowd you walk into shoves you back (0 = walk through)
  },

  status: {
    burnTick: 0.25,            // s between burn damage ticks
  },

  director: {
    maxSpawnPerTick: 6,
    densityMul: 1,             // global multiplier on every map's density curve
    bossDensityMul: 0.6,       // density while a boss is alive
    hpPerMinute: 0.12,         // enemy HP grows this fraction of base per minute
    contactPerMinute: 0.03,
    maxEnemies: 3000,          // hard ceiling, whatever the density says
  },

  draft: {
    cards: 3,
    ownedWeight: 1.4,          // weight multiplier for level-ups of owned items
    relicChance: 0.03,         // chance per offer of a relic card, times luck
    earlyWeaponUntil: 2,       // until you own this many weapons, one card is a new weapon when possible
    fallbackHeal: 30,
    fallbackCoin: 10,
  },

  chests: {
    // Boss chests roll 1, 3, or 5 items; luck shifts weight toward more.
    bossItems: [[1, 60], [3, 30], [5, 10]],
    relicChance: 0.12,         // chance per chest item of a relic, times luck (when one is available)
    runeChance: 0.35,          // chance per chest item of a rune (when a socket is open)
    fallbackHeal: 40,          // with everything maxed, an item is this much healing...
    fallbackCoin: 25,          // ...or this much coin (even odds)
  },

  run: {
    shortTimeScale: 0.5,       // short run mode compresses the timeline to 10:00
    shortRewardMul: 0.4,
    shortBossHp: 0.6,          // x boss health in short run mode
    overtimeChoiceAfterBoss: true,
  },

  bosses: {
    minionCap: 60,             // summon waves stop when this many minions are alive
    attackRange: 420,          // px: a boss starts its next attack only this close to you
    recover: 0.35,             // s a boss pauses after each attack
  },

  // What you see and hear, not what happens: the renderer and audio read these, the sim never
  // does (ARCHITECTURE §6.3). Times in milliseconds unless the name says otherwise.
  feel: {
    hitStop: {                 // the sim holds this long; rendering carries on (§5.1)
      playerHurt: 70,
      eliteKill: 60,
      bossKill: 220,
      bossSlam: 90,            // a boss attack landing on you
    },
    shake: {                   // trauma added (0 to 1); shake = trauma², decaying
      playerHurt: 0.35,
      bossSlam: 0.55,
      explode: 0.06,
      eliteKill: 0.3,
      bossKill: 0.9,
      bossSpawn: 0.4,
      decayPerSec: 1.8,
      maxOffset: 7,            // px at trauma 1
    },
    flash: {
      playerHurtMs: 120,       // red edge on the screen
      levelUpMs: 260,          // the light burst behind the level-up cards
    },
    numbers: {                 // damage numbers (switchable off in Settings)
      max: 150,                // on screen at once (at most 400)
      groupMs: 130,            // hits on one enemy this close together add into one number
      lifeMs: 620,
      rise: 16,                // px they float up
      minShown: 1,             // hits below this aren't numbered
    },
    particles: {
      kill: 5,                 // sparks per ordinary kill
      bigKill: 28,             // elites and bosses
      hit: 1,                  // sparks per hit...
      busyAt: 2500,            // ...unless this many sparks are already flying
      gem: 3,                  // sparkles as a gem is collected
      levelUp: 40,             // the burst around you on a level-up
      chest: 30,               // a chest opening
      boon: 36,                // an evolution, relic, or rune arriving
    },
    decalMs: 6000,             // scorch marks and splats fade over this long
    squash: {
      hit: 0.22,               // how much an enemy flattens when hit
      spawn: 0.4,
      ms: 110,
    },
    deathMs: 170,              // an enemy's pop and shrink after it dies...
    deathBigMul: 2.5,          // ...times this for elites and bosses
    bob: {
      px: 1,                   // enemies bob this many pixels...
      perSec: 5,               // ...this fast
      lean: 0.14,              // radians they lean into their movement
      bossPx: 1.5,             // bosses bob this much, slower
      bossBreathe: 0.03,       // and swell by this fraction as they breathe
      stepsPerSec: 8,          // the player hops a pixel every other step while walking
    },
    vacuum: {
      trail: 1,                // 1 = gems pulled in leave a sparkle trail...
      trailEvery: 6,           // ...from one gem in this many each frame
      pitchStepMs: 350,        // collect gems within this of each other and the pitch keeps rising
      pitchSteps: 12,
    },
    light: {
      player: 150,             // px radius of your lamp
      playerLevelGrowth: 0.6,  // px more per level (the Lamplighter's lamp grows)
      flare: 26,
      gem: 10,
      maxLights: 220,          // light sprites per frame, in this order: your lamp, a boss's own light, shots, flashes, chests, ground, gems
      ambientBoost: 0,         // added to the map's darkness (0 = as the map says)
    },
    fog: {
      density: 0.55,           // how thick the fog is where there is no light
      drift: 5,                // px per second it drifts
      lightCut: 1.0,           // how strongly light pushes the fog back
    },
    telegraph: {
      pulsePerSec: 3,          // warning shapes pulse this fast
      fanLength: 90,           // px: the lines that show a boss's shot fan
      lineWidth: 12,           // px: the width of a charge warning
    },
  },
};

/**
 * The harbor's feel (ARCHITECTURE §10.4), apart from the run's TUNING: the harbor's own tuning
 * panel lists it (under "hub."), the run's doesn't. timing: the set pieces and walking (seconds,
 * px, px/s), read by hub/world.js; look: the night, the fog, and the town's small motions, read by
 * render/hubview.js. Every number is on the panel, held to its range (HUB_TUNING_RANGE, below);
 * the colors (a palette name, or '#rrggbb' for a light's tint) and the one list are changed here.
 */
export const HUB_TUNING = Object.freeze({
  timing: Object.freeze({
    panIn: 0.7,        // the camera moves to the building (or the boat)...
    build: 1.4,        // ...the new stage goes up...
    fogPeel: 2.0,      // ...the fog peels back from its streets (starts with the build)...
    hold: 0.5,         // ...a moment to look...
    panOut: 0.7,       // ...and back to you.
    boatSpeed: 70,     // px/s along the route
    walkSpeed: 34,     // px/s: people strolling (the keepers' walks)
    arriveSpeed: 56,   // px/s: a newcomer walking up from the pier
    keeperPause: 1.6,  // s a keeper stops at each corner of their walk
    dashCooldown: 0.9, // the dash's distance and time are the run's (TUNING.player.dash)
    reach: 14,         // px from a door, the gate, or a person to use it
  }),
  look: Object.freeze({
    ambient: Object.freeze([0.36, 0.38, 0.52]), // the light map where no lamp reaches: a blue dark (red, green, blue)
    ambientBoost: 0,             // added to all three (0 = as ambient says), as in a run
    lampColor: '#ffc873',        // the town lamp's light, and every lantern's
    lampReach: 72,               // px: the town lamp's light before its first level...
    lampReachPerLevel: 26,       // ...and this much more a level
    lampDim: 0.7,                // how bright the town lamp's light is before its first level (1 after)
    lampCoreReach: 26,           // px: the white middle of the town lamp's light...
    lampCoreLight: 0.5,          // ...and how bright it is
    windowColor: '#ffb45a',      // a lit window's light
    windowLight: 0.8,            // how bright a lit window's (and a door lantern's) light is
    windowReach: 26,             // px
    doorReach: 34,               // px, a door lantern's
    smallLampReach: 58,          // px: the gate's and the pier's lamps...
    smallLampLight: 0.9,         // ...and how bright they are
    lanternReach: 88,            // px: your lantern...
    lanternLight: 0.9,           // ...and how bright it is
    flicker: 0.025,              // how much the lamps' light wavers (a share of its reach), in two waves:
    flickerSlowMs: 173,          // ...a slow one (a longer period is slower)...
    flickerFastMs: 71,           // ...and a quick one...
    flickerSlowShare: 0.6,       // ...the slow one this much of it
    fogColor: 'night-2',
    fogDensity: 0.95,            // how thick the fog is where a tile is all fog (a tile shows its density times this)
    fogFray: 0.5,                // a fog tile beside clearer ground thins toward it by up to this...
    fogCreep: 0.3,               // ...and a clear tile beside the fog takes up to this much of it
    wisps: 0.3,                  // the drifting noise over the fog
    wispColor: 'night-5',
    wispDriftX: 3,               // how fast the wisps drift east...
    wispDriftY: 1.2,             // ...and south (half-size px a second; below 0 is west and north)
    boatInFog: 0.5,              // a boat out in the fog, drawn over it, is this much darker at full fog...
    boatNight: 0.7,              // ...and never brighter than this there (where the fog is clear, it's lit as the light map lights the water)
    boatLanternReach: 46,        // px: the boat's stern lantern...
    boatLanternLight: 0.85,      // ...and how bright it is
    boatGlow: 0.3,               // its halo over the fog...
    boatGlowInFog: 0.4,          // ...plus this much more at full fog...
    boatHaloReach: 35,           // ...out to this many px
    stepOffFade: 10,             // px a newcomer walks clear of her boat while her figure over it fades out
    boatBob: 1,                  // px a boat rises and falls on the swell...
    boatBobMs: 420,              // ...slowly (a longer period is slower)
    waterFrameMs: 420,           // the sea's swell: a new frame every this...
    waterDriftMs: 250,           // ...drifting east a pixel every this
    cameraLift: 8,               // px the camera sits above what it follows (you stand a little below the middle)
    hopStepsPerSec: 6,           // people's walking hop
    popSec: 0.35,                // a prop or a keeper appearing...
    popOvershoot: 1.7,           // ...a prop swelling past its size before it settles (0 for none)
    scaffoldDrop: 18,            // px the scaffold rises from as a first level goes up
    dust: Object.freeze({        // along a rising stage
      perSec: 40,                // puffs a second...
      life: 0.7,                 // ...each lasting this (s)...
      size: 2,                   // ...this big (px)...
      spread: 12,                // ...drifting sideways up to half this (px/s)...
      rise: 8,                   // ...and rising this fast (px/s)...
      riseJitter: 10,            // ...plus up to this
      color: 'fog-3',
    }),
    smoke: Object.freeze({       // from a finished building's chimney
      every: 0.5,                // s between puffs...
      jitter: 0.4,               // ...plus up to this
      life: 2.6,                 // s each lasts
      size: 3,                   // px
      drift: 4,                  // px/s east (below 0 is west)...
      driftJitter: 3,            // ...plus up to this
      rise: 10,                  // px/s up...
      riseJitter: 4,             // ...plus up to this
      color: 'fog-2',
    }),
    puffs: Object.freeze({       // dust and smoke alike
      alpha: 0.55,               // how solid a new puff is (it fades out over its life)
      grow: 2,                   // px it grows a second
      max: 160,                  // at most this many at once
    }),
  }),
});

/**
 * What each harbor tuning number may be, in HUB_TUNING's own shape (hub/tuning.js holds the panel
 * to it, and tests/content.test.js the defaults): 'above0' for what the harbor divides by (a time,
 * a speed, a period), 'unit' for a brightness, a thickness, or a share (0 to 1), 'any' for what may
 * go either way (a boost, a drift, an offset), 'min0' for the rest (0 or more). Every number in
 * HUB_TUNING has one (the content test checks), so a new number is placed on purpose.
 */
export const HUB_TUNING_RANGE = Object.freeze({
  timing: Object.freeze({
    panIn: 'above0', build: 'above0', fogPeel: 'above0', hold: 'min0', panOut: 'above0',
    boatSpeed: 'above0', walkSpeed: 'above0', arriveSpeed: 'above0', keeperPause: 'min0', dashCooldown: 'min0', reach: 'min0',
  }),
  look: Object.freeze({
    ambientBoost: 'any',
    lampReach: 'min0', lampReachPerLevel: 'min0', lampDim: 'unit', lampCoreReach: 'min0', lampCoreLight: 'unit',
    windowLight: 'unit', windowReach: 'min0', doorReach: 'min0', smallLampReach: 'min0', smallLampLight: 'unit',
    lanternReach: 'min0', lanternLight: 'unit',
    flicker: 'unit', flickerSlowMs: 'above0', flickerFastMs: 'above0', flickerSlowShare: 'unit',
    fogDensity: 'unit', fogFray: 'unit', fogCreep: 'unit', wisps: 'unit', wispDriftX: 'any', wispDriftY: 'any',
    boatInFog: 'unit', boatNight: 'unit', boatLanternReach: 'min0', boatLanternLight: 'unit',
    boatGlow: 'unit', boatGlowInFog: 'unit', boatHaloReach: 'min0', stepOffFade: 'min0', boatBob: 'min0', boatBobMs: 'above0',
    waterFrameMs: 'above0', waterDriftMs: 'above0', cameraLift: 'any',
    hopStepsPerSec: 'above0', popSec: 'above0', popOvershoot: 'min0', scaffoldDrop: 'min0',
    dust: Object.freeze({ perSec: 'min0', life: 'min0', size: 'min0', spread: 'min0', rise: 'any', riseJitter: 'min0' }),
    smoke: Object.freeze({ every: 'min0', jitter: 'min0', life: 'min0', size: 'min0', drift: 'any', driftJitter: 'min0', rise: 'any', riseJitter: 'min0' }),
    puffs: Object.freeze({ alpha: 'unit', grow: 'min0', max: 'min0' }),
  }),
});
