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
      density: 1, revival: 0, reroll: 2, banish: 2, skip: 2, dashCooldown: 1, // banish 1 before 0.9.0
    },
    minDamageTaken: 1,         // armor can't reduce a hit below this
    // What slows you (0.9.0, W3): a midge's bite adds `sting` for stingSec (each bite restarts the
    // time; at most `stings` of them); a Brine elite's touch `brine` for brineSec; never past `max`.
    slow: { sting: 0.1, stings: 3, stingSec: 3, brine: 0.3, brineSec: 2, max: 0.5 },
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
      zoneHits: { wave: 40, beam: 40, tether: 30, ground: 24 },   // hits a wave, a beam, or a tether makes over its life, and a pool a pulse, at most (its pierce; C1 Nov 17)
    },
  },

  xp: {
    // XP needed to go from level L to L+1: first + perLevel x (L - 1) (latePerLevel from lateFrom;
    // bumps, if any, [level, XP, width] spread as a triangle), and past growthFrom each level costs
    // `growth` times more again, compounding. Ruling 14 (C1): fitted to the XP a cleared run
    // gathers so a 20:00 run ends near level 38 (about 11 at 5:00, 21 at 10:00, 30 at 15:00), where
    // it was 72 to 104; with draftGap no two level-ups come inside 20 s.
    first: 5,
    perLevel: 30,
    lateFrom: 20,
    latePerLevel: 40,
    bumps: [],
    growthFrom: 8,
    growth: 1.1,
    draftGap: 20,              // s: never two level-ups inside this (a level earned sooner waits; its XP is kept)
    gemMergeAt: 1500,          // gems on the field before new gems merge into one big gem
    magnetRadius: 44,          // px at magnet 1 (ruling 20 R20a: 32 made Lodestone decide 5 careful clears of 24)
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
    tellFullMax: 4,            // ordinary warnings drawn at full strength at once, at most (the rest are short, dim tells: sim/attacks.js)
    swarmDespawnDistance: 900, // swarm walls vanish once this far away
    eelSinkDistance: 560,      // px: a creek eel this far from you sinks back into the mud (past the spawn ring)
    leechMax: 3,               // leeches latched on at once, at most
    leechThrow: 2.5,           // knockback a leech thrown off flies with
    playerBlock: 0.5,          // how much a crowd you walk into shoves you back (0 = walk through)
  },

  status: {
    gaff: { amp: 0.25, sec: 4 },   // gaffed (the Anchor Chain's hit on a dazed enemy, ruling 19 RE): takes amp more from everything for sec
    burnTick: 0.25,            // s between burn damage ticks
    // The Salt Marsh's holds (0.8.0, sim/enemies.js, sim/holds.js).
    thaw: 2,                   // s after a freeze ends that it can't be frozen again
    crust: 0.5,                // what a Salted Dead's crust lets through, until a Frost, Sea, or Steel hit cracks it
    feverTaken: 0.1,           // Marsh Fever: this much more damage taken
    tarRadius: 30,             // Tarred: the blast when tar goes off (its own radius, whatever the weapon's area)
    tarEndShare: 0.5,          // tar left alone burns off at its end for this share
    puddleEvery: 0.25,         // s between brine puddles' pulses (every puddle on the same tick)
  },

  director: {
    maxSpawnPerTick: 6,
    densityMul: 1,             // global multiplier on every map's density curve
    bossDensityMul: 0.6,       // density while a boss is alive
    floorTide: 0.5,            // a band's floor rises by this share of a Tide's (or a curse's) density step (0.9.0)
    bossTideExp: 0.5,          // a Tide's health reaches bosses to this power (0.9.0: Tide 7's x2.25 is x1.5 on a boss)
    hpPerMinute: 0.12,         // enemy HP grows this fraction of base per minute
    contactPerMinute: 0.03,
    musterWarn: 5,             // s an overtime muster is announced ahead (MUSTER_SOON)
  },

  // The combat's pace (0.8.1, Kevin: "fewer slower but stronger enemies than the madness we have
  // going on now"). Each is a dial on the tuning panel; every one at 1 (and maxAlive 3000) is the
  // 0.8.0 fight (the kill-counted content was set again for these values: ARCHITECTURE §5.6).
  // Measured with tools/bots/pace.mjs.
  pace: {
    density: 0.35,             // x every band's density and every scripted crowd (rings, walls, flocks, a muster's crew, overtime's repeats)
    maxAlive: 450,             // enemies alive at most: the band's spawning stops at this many (a map's rings, walls, and musters still come)
    speed: 0.8,                // x how fast enemies walk and charge (warnings keep their length, and a charge its reach)
    hp: 2.5,                   // x the health of every enemy but elites and bosses (they keep their own rules: eliteHp, minFight)
    contact: 1.3,              // x the damage an enemy's touch does (a toad's landing too; not a boss's, a shot's, or a pool's)
    xp: 3.5,                   // x the XP an ordinary enemy drops, so a minute earns about what it did
    drops: 3.5,                // x an ordinary enemy's chance of dropping materials, food, or the magnet, likewise
    events: 1,                 // x the size of walls, rings, flocks, and a muster's crew (0.9.0, ruling 7: set pieces stay big; they may pass maxAlive while they run)
  },

  // Threat that follows your power (0.9.0, sim/threat.js): your damage a second over the last
  // `span` s against what a run is expected to deal at that minute (`ref`: [minute, damage a
  // second], the kite bots' on 0.8.2 at Tide 0), raised to `exp`, held from 1 to `max`, multiplies
  // enemy touches and new elites' health from minute `from` (the opening is the bands' and the
  // Tide's: a harbor's upgrades aren't taken back at 0:00). A weak build is never eased; a strong one meets more.
  threat: {
    span: 30,
    from: 4,
    exp: 0.4,
    max: 1.4,
    ref: [[0, 25], [2, 50], [4, 120], [6, 250], [8, 450], [10, 650], [12, 950], [14, 1250], [16, 1700], [18, 2200], [20, 2600]],
  },

  // Elite affixes (0.9.0, sim/affixes.js; data/enemies.js ELITE_AFFIXES): how many an elite gets
  // (perElite; two from Tide twoFromTide), and each one's numbers.
  affixes: {
    perElite: 1,
    twoFromTide: 2,
    wardHits: 3,               // Warded: hits that break the ward...
    wardGap: 0.15,             // ...each at least this long after the last (s: an aura can't strip it in a frame)
    herald: 6,                 // Herald: how many of its kind come with it
    links: 2,                  // Tethered: how many it's linked to
    molten: { every: 1.2, radius: 14, warn: 0.8, last: 2.5, damage: 6 },   // Molten: a patch of fire every this (s), its size, warning, life, and damage (times the minute's touch growth)
  },

  // Champions (0.9.0, sim/champions.js): a muster's named captain has this many times an elite's health.
  champions: { hpMul: 2 },

  draft: {
    cards: 3,
    ownedWeight: 1.4,          // weight multiplier for level-ups of owned items
    earlyWeaponUntil: 2,       // until you carry this many weapons beside the character's own, one card is a new weapon when possible
    fallbackHeal: 30,
    fallbackCoin: 10,
    // A level-up with nothing left to level is paid without stopping the run (sim/draft.js
    // levelGift): Food (fallbackHeal) below autoHealBelow of max health, else autoGlass Pearls
    // while the Ferryman is in the run, else Coin (fallbackCoin); and every autoEmberEvery-th such
    // level an Ember, kept for the pause menu, while a weapon can still take a Form.
    autoFallback: true,
    autoHealBelow: 0.5,
    autoGlass: 3,
    autoEmberEvery: 8,
    // A skip pays what a dry level pays (0.9.0: the draft's tools; it paid nothing before, except
    // with the Try-Pot), and its level counts toward the Embers above.
    skipPays: true,
    // Ruling 17 (W6, W8): new passives are offered at this share of their weight, and at most one a
    // draft; from lateFrom (s) a draft is never three plain numbers (one card becomes a line, a
    // Legendary, a new piece, or a dash card). A dash item is sure to be offered on the draft of
    // each level in dashAt (a real dash choice in most runs; the random weights are lower).
    newPassiveMul: 0.6,
    lateFrom: 900,
    dashAt: [6, 16],
  },

  chests: {
    // Boss chests roll 1, 3, or 5 items; luck shifts weight toward more.
    bossItems: [[1, 60], [3, 30], [5, 10]],
    rareChance: 0.35,          // chance per chest item that it is a weapon upgrade at Rare or better (where a rune was)
    fallbackHeal: 40,          // with everything maxed, an item is this much healing...
    fallbackCoin: 25,          // ...or this much coin (even odds)
  },

  run: {
    // x every material a run brings home (the pace of the whole harbor: tools/pacing --skilled
    // sets it against a practiced player, ARCHITECTURE §10.3). Feats, challenges, the bestiary,
    // and the Market pay their own amounts.
    materialMul: 1.3,          // 0.9.0 release: 1.2 measured 10.1 to 10.5 h for players who leave at the last boss; 1.3 brings them inside 6 to 10 h
    shortTimeScale: 0.5,       // short run mode compresses the timeline to 10:00
    shortRewardMul: 0.4,
    shortBossHp: 0.6,          // x boss health in short run mode
    overtimeChoiceAfterBoss: true,
    crowd: { count: 20, radius: 56 }, // the result's crowdSec: seconds with this many enemies this close (the Watchman feat; 40 before the 0.8.1 pace)
  },

  // The Salt Well (sim/well.js): its ring (px) fills while you're inside it, moving allowed, and
  // opens the well's choice at openSec (s); once, until you leave the ring and come back.
  well: { radius: 22, openSec: 0.6 },

  // Glass pillars (sim/storm.js): seconds standing, at most this many at once, never this many tiles from you.
  storm: { pillar: { sec: 8, max: 6, near: 3 } },

  // Embers (sim/ascend.js): an elite drops one this often (bosses and a muster's captain always do).
  embers: { eliteChance: 0.15 },

  // The axes of a weapon's Forms (ruling 14, C1): the weapon's upgrade count that opens "how it
  // fires" and "how its shots travel" (the capstone opens by its deed: sim/deeds.js); partnerPer:
  // a capstone held does this much more damage for each level of the weapon's partner passive.
  forms: { at: [5, 10], partnerPer: 0.06, sigCapstoneAt: 15, killburstEvery: 0.2 },   // killburstEvery: s between one weapon's kill bursts (ruling 18 WB: at 3 ticks a burst's kills fed the next)

  // The Dash slot (ruling 16; sim/dash.js, data/dashes.js): what the draft offers for it and how
  // far its plain cards go. A new dash item weighs newWeight against a new weapon's 100, from the
  // fromLevel-th level-up; a card for the one held upWeight, at most maxUps cards an item. caps:
  // distance at most x its base, recharge at least x its base, charges at most (an item that starts
  // with more keeps its own). minCooldown: s, the floor under any recharge, whatever lowers it.
  dashes: {
    newWeight: 12, upWeight: 18, maxUps: 4, fromLevel: 4,
    ups: { dash_distance: 0.15, dash_recharge: 0.12, dash_charges: 1 },
    caps: { distance: 1.6, recharge: 0.6, charges: 3 },
    minCooldown: 1.2,
  },

  // Rolled weapon upgrades (ruling 14, C1; data/weaponups.js says what each type is;
  // work/cw/C1-CONTRACT.md section 3).
  weaponUps: {
    odds: [55, 27, 12, 5, 1],          // Common, Uncommon, Rare, Epic, Legendary (weights)
    mul: [1, 1.5, 2.2, 3, 4],          // a rarity's number, x a Common
    luckPow: 0.5,                      // Luck shifts the odds up: weight r x luck^(r x luckPow)
    // How often each type comes up, against the others its rarity allows.
    weight: { damage: 4, cooldown: 2, area: 1.5, duration: 1, amount: 3, pierce: 1.5, crit: 1.5, hit_cooldown: 1.5, line: 8, special: 8 },
    // A Common's value (a type above Common: its value at its own lowest rarity). Damage, cooldown,
    // duration, and hit delay multiply what the weapon has now.
    value: { damage: 0.2, cooldown: 0.08, area: 0.15, duration: 0.25, amount: 1, pierce: 1, crit: 0.1, hit_cooldown: 0.12 },
    cooldownMax: 0.3,                  // the most one card takes off a cooldown or a hit delay
    floor: 0.08,                       // no card changes its weapon's output by less than this
    milestone: 3,                      // every 3rd upgrade of a weapon is Rare or better
    legendary: 10,                     // every 10th is a Legendary, unless one was offered since the last
    legendaryFrom: 6,                  // a Legendary rolled by luck before a weapon's 6th upgrade is an Epic
    damageDecay: 0.84,                 // each damage card a weapon has taken makes its next one x this (never under the floor; C1 Nov 17: the late runaway)
    kindred: { per: 0.08, max: 3 },    // each other weapon or passive held sharing a tag: +8% damage, up to 3 (Kindred, C1 Nov 17; ruling 19 RA: 3, not 5)
    lineWorth: 0.3, specialWorth: 0.6, axisWorth: 0.3,   // what "Pick for me" and the bots count a line, a special, and opening an axis as
    baseDamage: 1.3,                   // (C1 Nov 17: 1 to 1.3 with the late caps) x every weapon's own base damage (the calibration's one knob for the whole pool)
    sigEvery: 0,                       // s: the interim signature clock (0: off; C2's track covers all six characters)
    // Where a type leaves the pool (the weapon's own numbers, before passives and relics).
    caps: {
      cooldown: 0.4,                   // x its base cooldown, at least
      area: 3,                         // at most
      duration: 3,                     // x its base, at most
      amountExtra: 4,                  // its base amount + this, at most (C1 Nov 17: 6 to 4, the late runaway)
      crit: 0.6,                       // crit chance at most
      hitCooldown: 0.4,                // x its base hit cooldown, at least
    },                                 // pierce: caps.weapon.maxPierce; damage never caps
  },

  // Relics (ARCHITECTURE §10.8): what a Reliquary, the vault, and the Ferryman offer.
  relics: {
    offer: 3,                  // a Reliquary or the vault offers this many to pick from
    // Each row: [from minute, Trinket, Charm, Relic weights]; the last row whose minute has passed.
    tierWeights: [[0, 100, 12, 0], [5, 70, 45, 5], [10, 35, 60, 25], [15, 15, 50, 55]],
    reliquaryChance: 0.0021,   // per ordinary kill, times luck (after the gap; 0.0006 before the 0.8.1 pace, with 3.6 times the kills)
    reliquaryGap: 150,         // seconds at least between Reliquaries
    reliquaryPity: 500,        // ordinary kills since the last one that make the next certain (after the gap; 1,800 before 0.8.1)
    // The gap grows to spread the relics still to find over what's left of the run (sim/relics.js
    // maybeReliquary): at least the time to the map's last boss over the relics left plus one.
    // With none left to find, no Reliquary drops at all (and the run says so once).
    pullFrom: 200,             // px: a Reliquary from a kill farther from you than this...
    pullTo: 120,               // ...lands this far from you instead, toward the kill
  },

  // Run tasks (ARCHITECTURE §5.18, sim/tasks.js). No timers: progress only while you're there.
  // What one asks and gives grows with the minute you start it.
  tasks: {
    lamp: {
      radius: 30,              // px: stay this close to light it (moving is fine)
      baseSec: 3, perMinSec: 0.3,   // seconds inside it takes: base + per minute of the run
      glass: [4, 0.6],         // Pearls: base + per minute
      reveal: 20,              // tiles of the minimap it uncovers around itself
    },
    // A lit lamp is a ward (0.8.2, idea 1): a pool of light that burns every enemy standing in it.
    // 0.9.0 (ruling 6): it stays lit for the rest of the run.
    ward: {
      radius: 80,              // px: the pool of light
      killSec: 5,              // an ordinary enemy standing in it dies in about this long (its share of its own health a pulse)
      eliteShare: 0.1,         // elites and bosses burn at this share of that rate
      every: 0.5,              // seconds between pulses
    },
    // The run's three acts (0.9.0, W4, ruling 6; sim/acts.js): where an act's tasks are drawn.
    acts: {
      lampAway: 34,            // tiles: an act's lamps are drawn at least this far from you...
      bellAway: 30,            // ...a waking bell this far...
      apart: 30,               // ...and an act's lamps this far from each other (while sites allow)
      cacheAway: 40,           // tiles: a cache or a trail's end at least this far from you
      guardWake: 460,          // px: a cache's guard rises when you come this close (just past the view)
      guardRadius: 70,         // px round the cache it rises in
      trailFrom: 120,          // px: a trail's first gem this far from you
      trailGem: 4,             // XP a trail's gem is worth
      dawnSec: 8,              // seconds from the dawn to the run's end
    },
    // A held lamp (an act's twist): it takes heldMul times as long; while you light it, every
    // `every` s a crowd of `count` gathers round it (gatherSec, like a bell's crew) and walks in.
    held: { mul: 2.5, every: 5, count: 8, radius: 200, pearlsMul: 2 },
    // The Drowned Docks' cranes (sim/acts.js workStep): a ring filling while you're in it, then
    // `loads` loads, one every `gap` s, each on the thickest crowd within `reach` of the crane.
    // damage: times the pace dial's health and the minute's growth (as enemy health grows).
    crane: { ring: 26, openSec: 1, loads: 3, gap: 1.6, reach: 340, radius: 46, warn: 1.2, damage: 140, glass: [6, 0.6] },
    // The Salt Marsh's cairns: the storm works the ground round the cairn for `sec` s, a burst of
    // `burst` strikes every `every` s on the thickest crowds within `reach`.
    cairn: { ring: 26, openSec: 1, sec: 20, every: 2, burst: 2, reach: 300, radius: 30, warn: 1.2, damage: 70, glass: [6, 0.6] },
    bell: {
      radius: 84,              // px: the ring kills must fall inside
      baseKills: 10, perMinKills: 2,   // kills it takes: base + per minute of the run (20 and 4 before the 0.8.1 pace)
      glass: [8, 1],
      // The bell calls its crowd (0.8.2, idea 2): its small ring tolls it, a crew as big as the
      // kills it needs gathers in the fog round it, then walks in.
      startRadius: 20,         // px: the ring at its foot that tolls it...
      openSec: 0.6,            // ...filling this long while you're inside, moving allowed
      gatherSec: 1.2,          // seconds the crew gathers before it walks in
      crewRadius: 220,         // px from the bell the crew gathers (at the screen's edge, in the fog)
      dazeSec: 0.4,            // rung: what's inside the ring is dazed this long
      levels: 2,               // its chest's pick: the weapon or passive chosen gains this many levels
    },
    night: {
      sec: 40,                 // Lantern Night's length
      burn: 8,                 // damage a pulse to every enemy in your light, times the pace dial's health (pace.hp)
      every: 0.5,              // seconds between pulses
      light: 220,              // px: how far the light reaches
      burnPerMin: 0.12,        // the burn grows this share a minute of the run when it falls (as enemy health does)
      // Banked (0.8.2, idea 4): every lamp lit, it waits until this many enemies are this close to
      // you, or a muster or a boss arrives.
      crowd: 15,
      crowdRadius: 160,        // px
      vaultAhead: 60,          // px: the vault drops this far ahead of you...
      vaultDelay: 1,           // ...this many seconds after the night ends
    },
  },

  // Pearls (the run's own money, spent with the Ferryman; lost at the end unless the Market buys
  // them). Named Sea Glass before 0.8.2; the ids still say glass. None drop without the Ferryman.
  glass: { elite: [3, 5], boss: 15 },

  // The Ferryman (the Docks; 0.8.2, idea 6): he isn't there at 0:00. He rows in at firstCall, then
  // every callEvery (the map's clock: a short run's are halved), and ties up at the map's mooring
  // nearest you that's at least minAway from you, with new stock each call, a little better each
  // time. His ring fills while you're inside it, moving allowed, and opens the trade at openSec.
  ferry: {
    radius: 28,                // px round the boards he ties up at
    openSec: 0.6,              // the ring opens the trade this long after you step in
    firstCall: 180,            // s: his first call (3:00)...
    callEvery: 300,            // ...then every this (8:00, 13:00, 18:00, and on)
    rowSec: 4,                 // s he takes to row in and tie up (the trade opens once he has)
    minAway: 250,              // px: the mooring he ties up at is at least this far from you
    prices: { trinket: 14, charm: 28, relic: 50, food: 8, reroll: 10, ember: 70 },
    emberPerForm: 30,          // the Ember costs this much more for each Form the weapon it's bought for already holds
    foodHeal: 40,
    discount: 0.2,             // at the Docks' level 3 (level 2: a second relic; level 4: a third)
  },

  // Character mastery (data/mastery.js): XP a run gives the character you played, and the ranks.
  mastery: { perMinute: 1, perBoss: 5, ranks: [8, 25, 50, 90, 140, 200] },

  bosses: {
    minionCap: 60,             // summon waves stop when this many minions are alive
    attackRange: 420,          // px: a boss starts its next attack only this close to you
    recover: 0.35,             // s a boss pauses after each attack
    // A boss's health is set from your level when it arrives: its listed health is for the level
    // in data/bosses.js (`level`), and each level above or below adds or takes this share, held
    // between hpLevelMin and hpLevelMax of it. Its minFight (data/bosses.js) stays a floor on the
    // fight's length whatever the damage.
    hpPerLevel: 0.05,
    hpLevelMin: 0.6,
    hpLevelMax: 3,
    gateMaxHold: 20,           // s: a phase gate opens anyway after holding this long (ruling 5's safety: a signature that can't find its moment)
  },

  // What you see and hear, not what happens: the renderer and audio read these, the sim never
  // does (ARCHITECTURE §6.3). Times in milliseconds unless the name says otherwise.
  feel: {
    firstRunTipsSec: 40,       // s a first run's how-to-play card stays (ui/menus.js runTips)
    hitStop: {                 // the sim holds this long; rendering carries on (§5.1)
      playerHurt: 70,
      eliteKill: 60,
      bossKill: 220,
      bossSlam: 90,            // a boss attack landing on you
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
      ambientBoost: 0.2,       // added to the map's darkness (0 = as the map says); 0.9.0 lifted the run ground (V5: too dark to read)
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
    walkOff: 0.15,     // s of pushing west at the quay's end, by the gate, before it sets out
  }),
  look: Object.freeze({
    ambient: Object.freeze([0.28, 0.3, 0.44]), // the light map where no lamp reaches: night, dark enough that lit windows and lamp pools show, every cleared street still readable (red, green, blue; 0.9.0, was a dusk at 0.5, 0.52, 0.66)
    ambientBoost: 0,             // added to all three (0 = as ambient says), as in a run
    lampColor: '#ffc873',        // the town lamp's light, and every lantern's
    lampReach: 72,               // px: the town lamp's light before its first level...
    lampReachPerLevel: 14,       // ...and this much more a level (0.9.0: was 26, which lit the whole square and showed no pool)
    lampDim: 0.7,                // how bright the town lamp's light is before its first level (1 after)
    lampCoreReach: 26,           // px: the white middle of the town lamp's light...
    lampCoreLight: 0.5,          // ...and how bright it is
    windowColor: '#ffb45a',      // a lit window's light
    windowLight: 0.8,            // how bright a lit window's (and a door lantern's) light is
    windowReach: 26,             // px
    doorReach: 34,               // px, a door lantern's
    smallLampReach: 58,          // px: the gate's and the pier's lamps...
    smallLampLight: 0.9,         // ...and how bright they are
    lighthouseGlowReach: 40,     // px: the Lighthouse's lantern room once relit (its stage 3, 0.9.0)...
    lighthouseGlowLight: 0.8,    // ...and how bright it is
    lighthouseBeamReach: 170,    // px: the lit Lighthouse (its last stage), a still pool of light over the point...
    lighthouseBeamLight: 0.75,   // ...and how bright it is
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
    boatSpeed: 'above0', walkSpeed: 'above0', arriveSpeed: 'above0', keeperPause: 'min0', dashCooldown: 'min0', reach: 'min0', walkOff: 'above0',
  }),
  look: Object.freeze({
    ambientBoost: 'any',
    lampReach: 'min0', lampReachPerLevel: 'min0', lampDim: 'unit', lampCoreReach: 'min0', lampCoreLight: 'unit',
    windowLight: 'unit', windowReach: 'min0', doorReach: 'min0', smallLampReach: 'min0', smallLampLight: 'unit',
    lanternReach: 'min0', lanternLight: 'unit',
    lighthouseGlowReach: 'min0', lighthouseGlowLight: 'unit', lighthouseBeamReach: 'min0', lighthouseBeamLight: 'unit',
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

// A run's slots (0.9.0, the lead's rulings 3 and 4), grown by the harbor (meta/state.js slotsFor;
// the sim takes them as RunConfig.weaponSlots, passiveSlots, relicSlots): `base`, plus one for each
// level of `building` listed in `at` that's been reached. (Apart from TUNING, whose every value is
// a number the tuning panel can step.)
export const SLOTS = Object.freeze({
  weapons: Object.freeze({ base: 4, building: 'lamp_post', at: Object.freeze([3, 5]) }),
  passives: Object.freeze({ base: 4, building: 'smithy', at: Object.freeze([2, 4]) }),
  relics: Object.freeze({ base: 3, building: 'docks', at: Object.freeze([3, 4, 5]) }),
});
