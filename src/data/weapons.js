// Weapons (ARCHITECTURE §5.8, §11; ruling 14, C1: work/cw/C1-CONTRACT.md section 2). Each is a
// pipeline: an emitter (where it fires), a motion (how the shot moves), and an on-hit list (what
// happens on contact).
//
// base: damage, cooldown (s), amount (shots or bodies), area (x radius), speed (x motion speed),
//       duration (s a shot or zone lasts), pierce (hits before a shot is spent; -1 = never),
//       knockback, hitCooldown (s before this weapon can hit the same enemy again; 0 = each
//       shot hits an enemy once), radius (px at area 1: a shot's size; a wave's reach; a beam's
//       length), interval (s between shots of one volley), crit (chance), critMult.
// unit, units: what one of its Amount is called on a card ("Flares 2 -> 3").
// upright: the shot's sprite is drawn as it stands, never turned to face where it flies.
// pipeline.emit.assist (facing only): degrees. A facing volley bends onto the nearest enemy
//       within this angle of the way you face (and emit.range px, default 300).
// numbers: its Common and Uncommon number lines (data/weaponups.js). No level table, no max level.
// lines: its Rare and Epic behavior lines, each once a run: { id, name, rarity, desc, boost }.
// specials: its Legendary specials, each once a run: { id, name, desc, moves?, boost }. `moves`: it
//       changes how you move or where you stand (at least one per weapon).
// boost: { stats, onHit, emit, motion, fx } (sim/forms.js): numbers it multiplies or adds, on-hit
//       effects joined to the weapon's own, fields set on its emitter and motion, and mechanics by
//       key. A line and a special never replace an emitter's or a motion's type; only a Form's fire
//       and travel options do (data/ascensions.js), so nothing a weapon holds cancels another.
// deed: what opens its capstone axis (sim/deeds.js): { kind, count, text, ... }.
// partner: the passive that boosts its capstone.
// caps: (optional) { amountExtra } where its count has a hard reason to stop sooner.
// innate / signature: a character's own weapon (never drafted; data/signatures.js).
// weight: how often it is offered relative to others (default 100).
// `map` says which content pass a weapon came with.

// Shared lines (ruling 17 W3): each weapon carries at most one, and each keeps ONE name everywhere
// (`shared` names it; the card says it is shared). Everything else a weapon's Rare and Epic cards
// do is its own idea.
//   Splinter: its shots split in 2 on hit. Arc: hits jump to nearby enemies. Burning Ground: hits
//   leave burning ground. Backfire: a half-strength twin at the nearest enemy behind. Encore: the
//   volley repeats a moment later at half strength. Weak Point: hits a status the weapon puts on harder.
const ground = (mul = 0.15) => ({ type: 'zone', radius: 14, duration: 2.5, damageMul: mul, interval: 0.4, every: 0.3, status: { status: 'burn', dpsMul: 1, duration: 1.2 } });
const chain = (hops = 2) => ({ type: 'chain', hops, range: 85, damageMul: 0.6 });
const split = (count = 2) => ({ type: 'split', count, damageMul: 0.5, spread: 50 });
const SPLINTER = (id, units) => ({ id, name: 'Splinter', shared: 'splinter', rarity: 'rare', desc: `Its ${units} split in 2 at their first hit.`, boost: { onHit: [split()] } });
// Weak Point (ruling 18 WC): a status the weapon puts on, then hits harder. One shared effect, one name;
// only on weapons whose idea is the status (Corpse Candles, Brine Spring, Ice Picks, Eel Pot), and it does
// only that: +40% against its weapon's status, nothing else (ruling 19 RC).
const WEAK = (id, desc, boost) => ({ id, name: 'Weak Point', shared: 'weak_point', rarity: 'epic', desc, boost });
const ARC = (id, rarity = 'rare', hops = 2) => ({ id, name: 'Arc', shared: 'arc', rarity, desc: `Hits chain to ${hops} nearby enemies.`, boost: { onHit: [{ type: 'chain', hops, range: 85, damageMul: 0.6 }] } });

export const WEAPONS = [
  {
    id: 'flare_gun', name: 'Flare Gun', desc: 'Fires a flare at the nearest enemy.',
    tags: ['fire', 'light'], sprite: 'proj_flare', icon: 'icon_flare_gun', unlock: 'starter', weight: 100,
    unit: 'Flare', units: 'Flares', partner: 'wick_oil',
    base: { damage: 12, cooldown: 1.1, amount: 1, duration: 1.6, pierce: 1, knockback: 0.6, radius: 3, interval: 0.1 },
    numbers: ['damage', 'cooldown', 'amount', 'pierce', 'crit'],
    lines: [
      SPLINTER('split_flare', 'flares'),
      { id: 'lit_ground', name: 'Lit Ground', rarity: 'rare', desc: 'Where a flare hits, the ground stays lit for 2.5s. Enemies in it take 10% more damage.', boost: { onHit: [{ type: 'zone', radius: 16, duration: 2.5, damageMul: 0.05, interval: 0.4, every: 0.3, fever: 2 }] } },
      { id: 'white_heat', name: 'Signal Flare', rarity: 'epic', desc: 'Where a flare\'s flight ends, it hangs for 3s and rains sparks on enemies under it. A new one can start at most every 0.5s.', boost: { fx: { endGround: { radius: 22, life: 3, damageMul: 0.3, interval: 0.5, style: 'FLARE', every: 0.5 } } } },
    ],
    specials: [
      { id: 'parting_shot', name: 'Parting Shot', moves: true, desc: 'Every 2s while you keep moving, a fan of 6 flares fires back the way you came.', boost: { fx: { cue: { fan: 6, spread: 70, back: true, damageMul: 1.5, every: 2 } } } },
      { id: 'magnesium', name: 'Flash Powder', moves: true, desc: 'Flares deal 80% more damage to enemies far from you.', boost: { fx: { reach: { beyond: 75, farMul: 1.8 } } } },
    ],
    deed: { kind: 'kills', far: 90, count: 90, text: 'Kill 90 enemies from far off with it' },
    pipeline: {
      emit: { type: 'nearest', range: 360 },
      motion: { type: 'linear', speed: 230 },
      onHit: [{ type: 'damage' }, { type: 'knockback' }, { type: 'light', radius: 14, ms: 120 }],
    },
    sfx: { fire: 'flare_fire', hit: 'hit_soft' },
  },
  {
    id: 'lantern_orb', name: 'Lantern Orb', desc: 'Orbs of light circle you and knock enemies back.',
    tags: ['light', 'fire'], sprite: 'proj_lantern_orb', icon: 'icon_lantern_orb', unlock: 'starter', weight: 100,
    unit: 'Orb', units: 'Orbs', partner: 'lamp_glass',
    base: { damage: 14, cooldown: 3.2, amount: 2, duration: 3.2, pierce: -1, knockback: 0.15, hitCooldown: 0.45, radius: 5 },
    numbers: ['damage', 'area', 'amount', 'crit', 'hit_cooldown'],
    caps: { amountExtra: 4 },
    lines: [
      ARC('chain_light'),
      { id: 'warm_glass', name: 'Moth Draw', rarity: 'rare', desc: 'Orbs knock enemies back 50% less, so they stay in the ring for the next orb.', boost: { stats: { knockbackMul: 0.5 } } },
      { id: 'lens_flare', name: 'Knock-On', rarity: 'epic', desc: 'An enemy an orb knocks back deals 50% of the hit to the first enemy it runs into.', boost: { onHit: [{ type: 'bump', mul: 0.5, sec: 0.5 }] } },
    ],
    specials: [
      { id: 'steady_flame', name: 'Steady Flame', moves: true, desc: 'While standing still, the orbs get +15% Area and +140% Damage.', boost: { fx: { stance: { still: { after: 0.6, damageMul: 2.4, areaMul: 1.15 } } } } },
      { id: 'twin_rings', name: 'Twin Rings', desc: 'A second ring of orbs circles the other way, twice as far out, at 60% damage.', boost: { fx: { twin: { mul: 2, damageMul: 0.6 } } } },
    ],
    deed: { kind: 'kills', near: 90, count: 300, text: 'Kill 300 enemies close beside you with it' },
    pipeline: {
      emit: { type: 'orbit', radius: 38 },
      motion: { type: 'orbit', angularSpeed: 3.4 },
      onHit: [{ type: 'damage' }, { type: 'knockback' }, { type: 'light', radius: 18, ms: 150 }],
    },
    sfx: { fire: 'orb_spawn', hit: 'hit_soft' },
  },
  {
    id: 'harpoon_chain', name: 'Harpoon Chain', desc: 'Throws a harpoon the way you face. It pierces, and its chain pulls the last enemy it hit back toward you.',
    tags: ['steel', 'sea'], sprite: 'proj_harpoon', icon: 'icon_harpoon_chain', unlock: 'starter', weight: 70,
    // (Ruling 18 WB: its late steps, and drafted less: it was in 60% of careful builds.)
    steps: [{ at: 10, pierce: 1, damageMul: 1.2 }, { at: 20, pierce: 1, damageMul: 1.2 }],
    unit: 'Harpoon', units: 'Harpoons', partner: 'ballast',
    base: { damage: 28, cooldown: 1.3, amount: 1, duration: 1.2, pierce: 4, knockback: 1.2, radius: 4, interval: 0.12 },
    numbers: ['damage', 'cooldown', 'amount', 'pierce', 'crit'],
    lines: [
      SPLINTER('splinter', 'harpoons'),
      { id: 'drag_line', name: 'Drag Line', rarity: 'rare', desc: 'Harpoons knock enemies back twice as far along their path.', boost: { stats: { knockbackMul: 2 } } },
      { id: 'harpooned', name: 'Harpooned', rarity: 'epic', desc: 'A harpoon\'s hit bursts, dealing 50% of its damage to enemies close by.', boost: { onHit: [{ type: 'explode', radius: 20, damageMul: 0.5 }] } },
    ],
    specials: [
      { id: 'broadside', name: 'Broadside', moves: true, desc: 'Harpoons fire out to both sides of you, not ahead.', boost: { fx: { sides: { damageMul: 1.1 } } } },
      { id: 'reel_in', name: 'Reel In', desc: 'Enemies a harpoon hits are pulled right up to you and stunned for 0.8s. It deals 40% more damage to stunned enemies.', boost: { fx: { yank: { strength: 3.2, all: true, daze: 0.8 }, bonus: { status: 'daze', mul: 1.4 } } } },
    ],
    deed: { kind: 'multi', n: 3, within: 0.4, count: 50, text: 'Kill 3 enemies with one throw, 50 times' },
    pipeline: {
      emit: { type: 'facing', spread: 12, assist: 60, yank: { strength: 1.4 } },
      motion: { type: 'linear', speed: 260 },
      onHit: [{ type: 'damage' }, { type: 'knockback' }],
    },
    sfx: { fire: 'harpoon_throw', hit: 'hit_hard' },
  },
  {
    id: 'tide_bell', name: 'Tide Bell', desc: 'Sends out a wave that knocks enemies back.',
    tags: ['sea', 'echo'], sprite: 'fx_wave', icon: 'icon_tide_bell', unlock: 'starter', weight: 100,
    unit: 'Wave', units: 'Waves', partner: 'undertow',
    base: { damage: 7.5, cooldown: 3.0, amount: 1, duration: 0.7, pierce: -1, knockback: 2.2, hitCooldown: 0.8, radius: 90, interval: 0.3 },   // (ruling 23 WB: 9, alone it did 1.2M to 1.7M a minute at 20:00, two to three times any other)
    numbers: ['damage', 'cooldown', 'area', 'amount', 'crit'],
    lines: [
      { id: 'second_peal', name: 'Sounds Twice', shared: 'encore', rarity: 'rare', desc: 'Each wave repeats 0.6s later at 50% damage.', boost: { fx: { echo: { delay: 0.6, mul: 0.5 } } } },
      { id: 'cold_tide', name: 'Icy Swell', rarity: 'rare', desc: 'Waves reach 15% farther. Enemies caught at the far edge of a wave are frozen for 0.8s.', boost: { fx: { crest: { from: 0.7, freeze: 0.8 } }, stats: { radiusMul: 1.15 } } },   // (ruling 23 WD: a behavior, not a slow)
      { id: 'shock', name: 'Heavy Sea', rarity: 'epic', desc: 'Waves knock enemies back 50% farther. An enemy a wave knocks back stuns the first enemy it runs into for 0.8s and deals it 30% of the hit.', boost: { onHit: [{ type: 'bump', daze: 0.8, mul: 0.3, sec: 0.6 }], stats: { knockbackMul: 1.5 } } },   // (ruling 23 WD: thrown enemies knock others down)
    ],
    specials: [
      { id: 'crowded_water', name: 'Crowded Water', moves: true, desc: 'A wave deals 4% more damage for each enemy near it as it starts, up to +60%.', boost: { fx: { crowd: { per: 0.04, max: 0.6 } } } },
      { id: 'ground_swell', name: 'Ground Swell', moves: true, desc: 'Each wave leaves standing water where it started for 3s. It slows enemies by 30% and deals 15% of the wave\'s damage every 0.5s.', boost: { fx: { swell: { life: 3, damageMul: 0.15, interval: 0.5, slow: 0.3, radiusMul: 0.8 } } } },
    ],
    // (Deeds, ruling 18 WE: counted to land at about 3:30 to 5:00 for the weapon alone (all the
    // kills its own), so 5 to 12 minutes in a run where it shares them: work/cw/C1/out/r5 b-W.jsonl.)
    deed: { kind: 'hits', count: 2200, text: 'Strike 2200 enemies with its waves' },
    pipeline: {
      emit: { type: 'wave', thickness: 14 },
      motion: { type: 'stationary' },
      onHit: [{ type: 'damage' }, { type: 'knockback' }],
    },
    sfx: { fire: 'bell_ring', hit: 'hit_soft' },
  },

  {
    id: 'signal_mirror', name: 'Signal Mirror', desc: 'Flashes a beam at the nearest enemy. Hits every enemy in the line.',
    tags: ['light', 'echo'], sprite: 'fx_glint', icon: 'icon_signal_mirror', unlock: 'starter', weight: 100,
    unit: 'Beam', units: 'Beams', partner: 'bitterns_call',
    base: { damage: 14, cooldown: 1.8, amount: 1, duration: 0.25, pierce: -1, knockback: 0.3, hitCooldown: 0.3, radius: 140, interval: 0.15 },
    // Each beam hits everything along its line, so its count stops at 4.
    numbers: ['damage', 'cooldown', 'area', 'amount', 'crit'],
    caps: { amountExtra: 3 },
    lines: [
      { id: 'back_glass', name: 'Backfire', shared: 'backfire', rarity: 'rare', desc: 'A second beam flashes at the nearest enemy behind you, at 50% damage.', boost: { emit: { mirror: true } } },
      { id: 'glare', name: 'Glare', rarity: 'rare', desc: 'The beam stuns enemies it crosses for 0.4s.', boost: { onHit: [{ type: 'daze', duration: 0.4 }] } },
      { id: 'scorching_beam', name: 'Afterimage', rarity: 'epic', desc: 'Where the beam hits, its light stays for 1s and hits enemies in it.', boost: { onHit: [{ type: 'zone', radius: 10, duration: 1, damageMul: 0.3, interval: 0.3, every: 0.3 }] } },
    ],
    specials: [
      { id: 'lighthouse', name: 'Fixed Light', moves: true, desc: 'While standing still, it flashes twice as fast and reaches 50% farther.', boost: { fx: { stance: { still: { after: 0.6, rateMul: 2, areaMul: 1.5 } } } } },
      { id: 'long_light', name: 'Long Light', moves: true, desc: 'The far half of the beam deals 70% more damage.', boost: { fx: { reach: { beyondShare: 0.5, farMul: 1.7 } } } },
    ],
    deed: { kind: 'multi', n: 3, within: 0.3, count: 150, text: 'Kill 3 enemies with one flash, 150 times' },
    pipeline: {
      emit: { type: 'beam', width: 5 },
      motion: { type: 'stationary' },
      onHit: [{ type: 'damage' }, { type: 'knockback' }, { type: 'light', radius: 12, ms: 100 }],
    },
    sfx: { fire: 'mirror_flash', hit: 'hit_soft' },
  },
  {
    id: 'oil_flask', name: 'Oil Flask', desc: 'Lobs a flask at the nearest enemy. It bursts into burning oil.',
    tags: ['fire'], sprite: 'proj_oil_flask', upright: true, icon: 'icon_oil_flask', unlock: 'starter', weight: 100,
    unit: 'Flask', units: 'Flasks', partner: 'wick_oil',
    base: { damage: 10, cooldown: 2.6, amount: 1, duration: 3, pierce: -1, knockback: 0, hitCooldown: 0.5, radius: 16, interval: 0.3 },
    numbers: ['damage', 'cooldown', 'area', 'duration', 'amount', 'crit'],
    lines: [
      SPLINTER('spatter', 'flasks'),
      { id: 'fumes', name: 'Spreading Oil', rarity: 'rare', desc: 'A pool spreads a little each time enemies walk through it, up to twice its size.', boost: { fx: { poolGrow: { per: 0.08, max: 2 } } } },
      { id: 'flashover', name: 'Flashover', rarity: 'epic', desc: 'An enemy a pool kills bursts into flame, damaging enemies near it.', boost: { fx: { killburst: { radius: 26, damageMul: 1.2, byZone: true } } } },
    ],
    specials: [
      { id: 'wake_of_fire', name: 'Wake of Fire', moves: true, desc: 'Every 3s while you keep moving, a line of burning oil spills behind you, dealing 30% more damage than a pool.', boost: { fx: { cue: { trail: true, damageMul: 1.3, radiusMul: 0.8, pools: 3, every: 3 } } } },   // (C1b, Nov 20: at +100% and 4 pools, the Drowned Man's Oil Flask held 77% of his damage at Tide 5)
      { id: 'clinging_fire', name: 'Clinging Fire', desc: 'Its pools last 60% longer, and enemies burning in them pass their fire to those they bump into.', boost: { onHit: [{ type: 'zone', fever: 3 }], stats: { durationMul: 1.6 } } },
    ],
    deed: { kind: 'kills', status: 'burn', count: 220, text: 'Kill 220 burning enemies with it' },
    pipeline: {
      emit: { type: 'nearest', range: 220 },
      motion: { type: 'arc', range: 220, flight: 0.55 },
      onHit: [
        { type: 'damage' },
        { type: 'status', status: 'burn', dps: 4, duration: 1.5 },
        { type: 'zone', radius: 22, duration: 3, damageMul: 2, interval: 0.3, every: 0.35, status: { status: 'burn', dps: 4, duration: 1.2 } },   // (C1b, Nov 20, every 0.35 (was 0.25): its Splinter halves and Firebomb's small flasks each left a pool; the Drowned Man's Oil Flask held 82% of his damage)   // (W2, Nov 17: its pools grow with its Damage, as its hit does; was a flat 20)
        { type: 'light', radius: 24, ms: 220 },
      ],
    },
    sfx: { fire: 'flask_throw', hit: 'explode_small' },
  },
  {
    id: 'lightning_rod', name: 'Lightning Rod', desc: 'Plants a rod beside you. Lightning strikes enemies near it and chains to 2 more.',
    tags: ['light', 'steel'], sprite: 'fx_bolt', icon: 'icon_lightning_rod', unlock: 'research:storm_glass', weight: 100,
    unit: 'Bolt', units: 'Bolts', partner: 'copper_wire',
    base: { damage: 28, cooldown: 2.2, amount: 2, duration: 0.1, pierce: -1, knockback: 0.4, hitCooldown: 0.3, radius: 10 },
    numbers: ['damage', 'cooldown', 'amount', 'crit'],
    lines: [
      ARC('long_arc', 'rare', 3),
      { id: 'ground_strike', name: 'Tall Rod', rarity: 'rare', desc: 'The first bolt of each volley falls on the biggest enemy in range.', boost: { emit: { rodBig: true } } },
      { id: 'static_field', name: 'Static Field', rarity: 'epic', desc: 'A strike leaves the ground charged for 1.5s. Enemies on it take damage and are slowed by 30%.', boost: { onHit: [{ type: 'zone', radius: 20, duration: 1.5, damageMul: 0.25, interval: 0.3, every: 0.3, slow: 0.3 }] } },
    ],
    specials: [
      { id: 'conductor', name: 'Lightning Wire', moves: true, desc: 'No rod: strikes fall close around you, twice as often.', boost: { emit: { rodSelf: 78 }, stats: { cooldownMul: 0.5 } } },
      // (Ruling 18 WD: the Fulgurite's idea, folded in. The id is Chain Reaction's, which it replaced, so saves keep it.)
      { id: 'chain_reaction', name: 'Fulgurite', desc: 'Where its lightning chains, the ground turns to glass: a spike that lasts 4s and fires a beam at the nearest enemy every 1s.', boost: { onHit: [{ type: 'spike', every: 1, life: 4, range: 90, damageMul: 0.5, max: 10 }] } },
    ],
    deed: { kind: 'multi', n: 3, within: 0.3, count: 150, text: 'Kill 3 enemies with one volley, 150 times' },
    pipeline: {
      emit: { type: 'strike', rod: { radius: 130, life: 12, replantAt: 220 } },
      motion: { type: 'stationary' },
      onHit: [{ type: 'damage' }, { type: 'knockback' }, { type: 'chain', hops: 2, range: 80, damageMul: 0.6 }, { type: 'light', radius: 26, ms: 140 }],
    },
    sfx: { fire: 'lightning', hit: 'hit_hard' },
  },
  {
    id: 'corpse_candles', name: 'Corpse Candles', desc: 'Summons candle flames that drift after enemies. Their touch rots: rotting enemies take 25% more damage.',
    tags: ['fire', 'rot'], sprite: 'proj_candle_flame', upright: true, icon: 'icon_corpse_candles', unlock: 'research:corpse_lights', weight: 100,
    unit: 'Flame', units: 'Flames', partner: 'tallow_candle',
    base: { damage: 20, cooldown: 3.6, amount: 2, duration: 4, pierce: -1, knockback: 0, hitCooldown: 0.6, radius: 5 },
    numbers: ['damage', 'cooldown', 'duration', 'amount', 'crit', 'hit_cooldown'],
    caps: { amountExtra: 4 },
    lines: [
      { id: 'chain_lights', name: 'Grave Mist', rarity: 'rare', desc: 'A flame that burns out leaves rotting mist for 2s where it went out.', boost: { fx: { endGround: { radius: 16, life: 2, damageMul: 0.1, interval: 0.5, effects: [{ type: 'status', status: 'rot', duration: 2, amp: 0.25 }], style: 'ROT' } } } },
      { id: 'marsh_gas', name: 'Marsh Gas', rarity: 'rare', desc: 'Flames also set enemies they touch burning for 2s.', boost: { onHit: [{ type: 'status', status: 'burn', dpsMul: 0.4, duration: 2 }] } },
      WEAK('witch_light', 'Flames deal 40% more damage to rotting enemies.', { fx: { bonus: { status: 'rot', mul: 1.4 } } }),
    ],
    specials: [
      { id: 'graveside', name: 'Graveside', moves: true, desc: 'Its flames stay close to you and deal 90% more damage.', boost: { fx: { leash: { range: 100 } }, stats: { damageMul: 1.9 } } },
      { id: 'soul_lantern', name: 'Soul Lantern', desc: 'Gains +4% Damage for each minute held, up to +50%.', boost: { fx: { ramp: { perMin: 0.04, max: 0.5 } } } },   // (C1b, Tide 5: at +6% to +100%, the Candles reached 8.5x the next weapon; every Candles run over 3x held it)
    ],
    deed: { kind: 'kills', status: 'rot', count: 30, text: 'Kill 30 rotting enemies with it' },
    pipeline: {
      emit: { type: 'summon' },
      motion: { type: 'homing', speed: 126, turn: 5, range: 220 },
      onHit: [{ type: 'status', status: 'rot', duration: 3, amp: 0.25 }, { type: 'damage' }, { type: 'light', radius: 14, ms: 120 }],   // (rot first: the touch rots, then burns; ruling 21 WF)
    },
    sfx: { fire: 'candle_summon', hit: 'hit_soft' },
  },

  // ---------------------------------------------------------------- the Salt Marsh (0.8.0)
  {
    id: 'brine_spring', name: 'Brine Spring', desc: 'Every 3s brine bursts under the thickest crowd, freezes it for 1s, and leaves a slowing puddle. An enemy in 2 puddles at once is frozen.',
    tags: ['sea', 'frost'], sprite: 'fx_wave', icon: 'icon_brine_spring', unlock: 'research:brine_notes', weight: 100, map: 'salt_marsh',
    unit: 'Spout', units: 'Spouts', partner: 'hoarfrost',
    base: { damage: 17, cooldown: 2.6, amount: 1, duration: 3, pierce: -1, knockback: 0, hitCooldown: 0.5, radius: 26, interval: 0.2 },
    numbers: ['damage', 'cooldown', 'area', 'duration', 'amount', 'crit'],
    lines: [
      { id: 'salt_spray', name: 'Geyser', rarity: 'rare', desc: 'A spout under a frozen enemy knocks it into the crowd.', boost: { onHit: [{ type: 'heave', strength: 3 }] } },
      { id: 'brine_overflow', name: 'Spillover', rarity: 'rare', desc: 'An enemy its spouts kill bursts, dealing 50% of the spout\'s damage to enemies close by.', boost: { fx: { killburst: { radius: 26, damageMul: 0.5 } } } },
      WEAK('long_thaw', 'Spouts deal 40% more damage to frozen enemies.', { fx: { bonus: { status: 'freeze', mul: 1.4 } } }),
    ],
    specials: [
      { id: 'spring_line', name: 'Spring Line', moves: true, desc: 'Its spouts burst along the path you walked 2s ago. +50% Damage.', boost: { emit: { aim: 'path' }, stats: { damageMul: 1.5 } } },
      { id: 'standing_water', name: 'Standing Water', moves: true, desc: 'Puddles last twice as long. A puddle with an enemy in it stops drying, up to 3 times its normal time.', boost: { fx: { wade: { max: 3 } }, stats: { durationMul: 2 } } },
    ],
    deed: { kind: 'kills', status: 'freeze', count: 100, text: 'Kill 100 frozen enemies with it' },
    pipeline: {
      emit: { type: 'spout', puddle: { radius: 30, slow: 0.35, freeze: 1 } },
      motion: { type: 'stationary' },
      onHit: [{ type: 'damage' }, { type: 'status', status: 'freeze', duration: 1 }],
    },
    sfx: { fire: 'bell_ring', hit: 'hit_soft' },
  },
  {
    id: 'ice_picks', name: 'Ice Picks', desc: 'Picks fly out at the nearest enemy and come back, slowing enemies they hit on the way out and back.',
    tags: ['steel', 'frost'], sprite: 'proj_ice_pick', icon: 'icon_ice_picks', unlock: 'research:ice_house', weight: 100, map: 'salt_marsh',
    unit: 'Pick', units: 'Picks', partner: 'waders',
    steps: [{ at: 10, amount: 1 }, { at: 20, damageMul: 1.3 }],   // (ruling 21 WF: it stalled after 15:00; said on those upgrade cards)
    base: { damage: 26, cooldown: 1.2, amount: 1, duration: 1.1, pierce: -1, knockback: 0.3, hitCooldown: 0.3, radius: 4, interval: 0.12 },
    numbers: ['damage', 'cooldown', 'amount', 'crit'],
    lines: [
      { id: 'splinters', name: 'Splitting Ice', rarity: 'rare', desc: 'A pick coming back breaks in 2 at the first enemy it hits, and the halves fly on.', boost: { onHit: [{ type: 'split', count: 2, damageMul: 0.5, spread: 50, onReturn: true }] } },
      WEAK('frostbite', 'Picks deal 40% more damage to slowed enemies.', { fx: { bonus: { status: 'slow', mul: 1.4 } } }),
      { id: 'deep_freeze', name: 'Deep Cold', rarity: 'epic', desc: 'Picks slow enemies they hit by 50% for 3s.', boost: { onHit: [{ type: 'status', status: 'slow', pct: 0.5, duration: 3 }] } },
    ],
    specials: [
      { id: 'cold_snap', name: 'Cold Snap', moves: true, desc: 'Standing still for 1s freezes enemies close to you for 1.2s and throws a pick at each, up to 4, again every 4s.', boost: { fx: { cue: { burst: { radius: 46, damageMul: 0.5, freeze: 1.2, picks: 4 }, after: 1, every: 4 } } } },
      { id: 'hail', name: 'Hail', desc: 'A pick that comes back flies out once more, at 50% damage.', boost: { fx: { rethrow: { mul: 0.5 } } } },
    ],
    deed: { kind: 'kills', status: 'slow', count: 60, text: 'Kill 60 slowed or frozen enemies with it' },
    pipeline: {
      emit: { type: 'nearest', range: 260 },
      motion: { type: 'boomerang', speed: 240 },
      onHit: [{ type: 'damage' }, { type: 'knockback' }, { type: 'status', status: 'slow', pct: 0.3, duration: 1.2 }],
    },
    sfx: { fire: 'harpoon_throw', hit: 'hit_hard' },
  },
  {
    // Ruling 18 WD: in the Fulgurite's place (its glass is the Lightning Rod's now, data/weapons.js
    // chain_reaction). A note that rolls out in a cone and leaves what it passes lost in the fog.
    id: 'fog_horn', name: 'Fog Horn', desc: 'Blasts a wide cone at the nearest enemy, knocking enemies back. Enemies it hits are lost: they walk away from you for 1.5s.',
    tags: ['sea', 'echo'], sprite: 'fx_wave', icon: 'icon_fog_horn', unlock: 'research:fulgurite', weight: 100, map: 'salt_marsh',
    unit: 'Note', units: 'Notes', partner: 'bitterns_call',
    base: { damage: 10, cooldown: 2.4, amount: 1, duration: 0.8, pierce: -1, knockback: 1.6, hitCooldown: 0.8, radius: 125, interval: 0.25 },
    numbers: ['damage', 'cooldown', 'area', 'amount', 'crit'],
    lines: [
      { id: 'second_note', name: 'Sounds Twice', shared: 'encore', rarity: 'rare', desc: 'Each note sounds again 0.6s later at 50% damage.', boost: { fx: { echo: { delay: 0.6, mul: 0.5 } } } },
      { id: 'thick_fog', name: 'Thick Fog', rarity: 'rare', desc: 'Lost enemies stay lost 1.5s longer.', boost: { onHit: [{ type: 'status', status: 'lost', duration: 3 }] } },
      { id: 'low_note', name: 'Low Note', rarity: 'epic', desc: 'Two lost enemies that walk into each other are both stunned for 1s.', boost: { onHit: [{ type: 'status', status: 'lost', duration: 1.5, bump: 1 }] } },
    ],
    specials: [
      { id: 'gale_note', name: 'Gale Note', moves: true, desc: 'The note sounds all round you and knocks enemies back twice as far.', boost: { emit: { cone: 180 }, stats: { knockbackMul: 2 } } },
      { id: 'rolling_fog', name: 'Rolling Fog', desc: 'The note goes twice as far, slowly, and enemies it hits stay lost 1s longer.', boost: { stats: { areaMul: 1.6, durationMul: 2 }, onHit: [{ type: 'status', status: 'lost', duration: 2.5 }] } },
    ],
    deed: { kind: 'hits', count: 1800, text: 'Strike 1800 enemies with its notes' },
    pipeline: {
      emit: { type: 'wave', thickness: 16, cone: 40 },
      motion: { type: 'stationary' },
      onHit: [{ type: 'damage' }, { type: 'knockback' }, { type: 'status', status: 'lost', duration: 1.5 }],
    },
    sfx: { fire: 'fog_horn', hit: 'hit_soft' },
  },
  {
    id: 'eel_pot', name: 'Eel Pot', desc: 'Sets a pot every 5s. Eels bite enemies near it and rot them: they take 25% more damage for 3s.',
    tags: ['sea', 'rot'], sprite: 'proj_eel', icon: 'icon_eel_pot', unlock: 'research:eel_trapper', weight: 100, map: 'salt_marsh',
    unit: 'Eel', units: 'Eels', partner: 'grave_moss',
    base: { damage: 9, cooldown: 1.8, amount: 2, duration: 0.7, pierce: 2, knockback: 0.2, radius: 5, interval: 0.12 },
    numbers: ['damage', 'cooldown', 'amount', 'pierce', 'crit'],
    lines: [
      { id: 'slime', name: 'Slime', rarity: 'rare', desc: 'Bites leave rotting ground.', boost: { onHit: [{ type: 'zone', radius: 14, duration: 2.5, damageMul: 0.12, interval: 0.4, every: 0.3, status: { status: 'rot', duration: 2, amp: 0.25 } }] } },
      { id: 'tangle', name: 'Eel Trap', rarity: 'rare', desc: 'An eel pulls the enemy it bites a little way back toward its pot.', boost: { onHit: [{ type: 'pull', strength: 1, toOrigin: 1 }] } },
      WEAK('gorge', 'Eels deal 40% more damage to rotting enemies.', { fx: { bonus: { status: 'rot', mul: 1.4 } } }),
    ],
    specials: [
      { id: 'chum', name: 'Chum the Water', moves: true, desc: 'Stopping after a walk sets a pot there, and every pot lunges at once. At most once every 3s.', boost: { fx: { cue: { pot: true, volley: true, every: 3 } } } },
      { id: 'old_conger', name: 'Old Conger', moves: true, desc: 'A great eel lives in each pot. Once every 2s it bites an enemy right next to the pot for 2x damage and stuns it.', boost: { fx: { guard: { radius: 40, damageMul: 2, daze: 1, every: 2 } } } },
    ],
    deed: { kind: 'kills', origin: 120, count: 450, text: 'Kill 450 enemies near its pot with it' },
    pipeline: {
      emit: { type: 'nearest', range: 120, pot: { every: 5, life: 11, max: 1 } },
      motion: { type: 'homing', speed: 230, turn: 9, range: 200 },
      onHit: [{ type: 'damage' }, { type: 'status', status: 'rot', duration: 3, amp: 0.25 }],
    },
    sfx: { fire: 'candle_summon', hit: 'hit_soft' },
  },
  {
    id: 'anchor_chain', name: 'Anchor Chain', desc: 'A heavy anchor swings around you with big Knockback. Stunned enemies it hits take 25% more damage for 4s.',
    tags: ['steel', 'sea'], sprite: 'proj_anchor', icon: 'icon_anchor_chain', unlock: 'research:anchor_smithing', weight: 100, map: 'salt_marsh',
    unit: 'Anchor', units: 'Anchors', partner: 'thick_coat',
    base: { damage: 30, cooldown: 4, amount: 1, duration: 4, pierce: -1, knockback: 3, hitCooldown: 0.8, radius: 9 },
    numbers: ['damage', 'area', 'crit', 'hit_cooldown'],
    lines: [
      { id: 'shock_ring', name: 'Gaff Hook', rarity: 'rare', desc: 'Every enemy the anchor hits takes 25% more damage for 4s, stunned or not.', boost: { onHit: [{ type: 'gaff', any: true }] } },
      ARC('chain_links'),
      { id: 'sunk', name: 'Heavy Iron', rarity: 'epic', desc: 'An enemy the anchor knocks back stuns the first enemy it lands on for 0.6s.', boost: { onHit: [{ type: 'bump', daze: 0.6, sec: 0.6 }] } },
    ],
    specials: [
      { id: 'weigh_anchor', name: 'Weigh Anchor', moves: true, desc: 'The longer you keep moving, the faster it swings and the more damage it deals, up to 2x each. It resets when you stop.', boost: { fx: { stance: { moving: { ramp: 3, damageMul: 2, rateMul: 2 } } } } },
      { id: 'ground_tackle', name: 'Ground Tackle', desc: 'Enemies it knocks back damage the enemies they land on.', boost: { fx: { riptide: { knockMul: 1.3, delay: 0.4, radius: 22, damageMul: 0.6, max: 16 } } } },
    ],
    deed: { kind: 'kills', near: 90, count: 300, text: 'Kill 300 enemies close beside you with it' },
    pipeline: {
      emit: { type: 'orbit', radius: 48 },
      motion: { type: 'orbit', angularSpeed: 1.6 },
      onHit: [{ type: 'gaff' }, { type: 'damage' }, { type: 'knockback' }],
    },
    sfx: { fire: 'orb_spawn', hit: 'hit_hard' },
  },
  {
    id: 'glass_caltrops', name: 'Glass Caltrops', desc: 'Drops sharp glass while moving that damages enemies who step on it. Each piece lasts 4s.',
    tags: ['steel', 'light'], sprite: 'proj_caltrop', icon: 'icon_glass_caltrops', unlock: 'feat:glass_underfoot', weight: 100, map: 'salt_marsh',
    unit: 'Caltrop', units: 'Caltrops', partner: 'sea_legs',
    base: { damage: 28, cooldown: 0.35, amount: 1, duration: 4, pierce: 3, knockback: 0, radius: 6, interval: 0.1 },
    numbers: ['damage', 'cooldown', 'area', 'duration', 'pierce', 'crit'],
    lines: [
      SPLINTER('glass_splinters', 'pieces'),
      { id: 'glint', name: 'Bottle Glass', rarity: 'rare', desc: 'Cuts set enemies burning for 2s.', boost: { onHit: [{ type: 'status', status: 'burn', dpsMul: 0.3, duration: 2 }] } },
      { id: 'shatter_glass', name: 'Glass Dust', rarity: 'epic', desc: 'A piece that breaks leaves glass dust for 2s that cuts enemies walking through it.', boost: { fx: { endGround: { radius: 12, life: 2, damageMul: 0.25, interval: 0.3 } } } },
    ],
    specials: [
      { id: 'well_trodden', name: 'Well-Trodden', moves: true, desc: 'While moving, it drops glass 40% faster. Glass walked back over deals 40% more damage each time, up to 4 times.', boost: { fx: { rearm: { per: 0.4, max: 4, within: 12 }, stance: { moving: { ramp: 1, rateMul: 1.4 } } } } },
      { id: 'field_of_glass', name: 'Field of Glass', moves: true, desc: 'Gains +2% Damage for each piece on the ground, up to +100%.', boost: { fx: { hoard: { per: 0.02, max: 1 } } } },
    ],
    deed: { kind: 'kills', moving: true, count: 800, text: 'Kill 800 enemies with it while moving' },
    pipeline: {
      emit: { type: 'drop', moving: true },
      motion: { type: 'stationary' },
      onHit: [{ type: 'damage' }],
    },
    sfx: { hit: 'hit_soft' },
  },
  // Innate character weapons.
  {
    id: 'lamplight', name: 'Lamplight', desc: 'Burns nearby enemies. Grows with each level.',
    tags: ['light'], sprite: 'fx_lamplight', icon: 'icon_lamplight', unlock: 'innate', innate: true, weight: 0,
    base: { damage: 7, cooldown: 1, amount: 1, duration: 1, pierce: -1, knockback: 0.2, hitCooldown: 0.6, radius: 26 },
    numbers: [],   // a character's own weapon never rolls
    pipeline: {
      emit: { type: 'aura' },
      motion: { type: 'stationary' },
      onHit: [{ type: 'damage' }, { type: 'knockback' }],
    },
    sfx: { hit: 'hit_soft' },
  },
];
