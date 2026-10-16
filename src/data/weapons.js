// Weapons (ARCHITECTURE §5.8, §11). Each is a pipeline: an emitter (where it fires), a motion
// (how the shot moves), and an on-hit list (what happens on contact). Runes patch the pipeline.
//
// base: damage, cooldown (s), amount (shots or bodies), area (x radius), speed (x motion speed),
//       duration (s a shot or zone lasts), pierce (hits before a shot is spent; -1 = never),
//       knockback, hitCooldown (s before this weapon can hit the same enemy again; 0 = each
//       shot hits an enemy once), radius (px at area 1: a shot's size; a wave's reach; a beam's
//       length), interval (s between shots of one volley), crit (chance), critMult.
// upright: the shot's sprite is drawn as it stands, never turned to face where it flies (a
//       flame, a flask); otherwise sprites point right and turn with the shot.
// pipeline.emit.assist (facing only): degrees. A facing volley bends onto the nearest enemy
//       within this angle of the way you face (and emit.range px, default 300), so a stick that
//       points roughly at the crowd still hits it. 0 or absent: straight ahead.
// levels[L - 1] is what reaching level L adds (levels[0] is null: level 1 is the base).
// evolution: at max level, with the partner passive at passiveLevel, a boss chest turns this
//       weapon into `into` (its own definition; evolved weapons don't level further).
// innate: a character's own weapon (never offered in drafts, doesn't use one of the 6 slots).
// weight: how often it is offered relative to others (default 100).

export const WEAPONS = [
  {
    id: 'flare_gun', name: 'Flare Gun', desc: 'Fires a flare at the nearest enemy.',
    tags: ['fire', 'light'], sprite: 'proj_flare', icon: 'icon_flare_gun', unlock: 'starter', maxLevel: 8, weight: 100,
    base: { damage: 12, cooldown: 1.1, amount: 1, duration: 1.6, pierce: 1, knockback: 0.6, radius: 3, interval: 0.1 },
    levels: [null, { amount: 1 }, { damage: 5 }, { cooldown: -0.15 }, { amount: 1 }, { damage: 6 }, { pierce: 1 }, { amount: 1, damage: 6 }],
    pipeline: {
      emit: { type: 'nearest', range: 360 },
      motion: { type: 'linear', speed: 230 },
      onHit: [{ type: 'damage' }, { type: 'knockback' }, { type: 'light', radius: 14, ms: 120 }],
    },
    runeSlots: 2,
    evolution: { passive: 'wick_oil', passiveLevel: 5, into: 'flare_barrage', hidden: false },
    sfx: { fire: 'flare_fire', hit: 'hit_soft' },
  },
  {
    id: 'lantern_orb', name: 'Lantern Orb', desc: 'Orbs of light circle you and knock enemies back.',
    tags: ['light', 'fire'], sprite: 'proj_lantern_orb', icon: 'icon_lantern_orb', unlock: 'research:orbwright', maxLevel: 8, weight: 100,
    base: { damage: 9, cooldown: 3.2, amount: 2, duration: 2.6, pierce: -1, knockback: 0.5, hitCooldown: 0.5, radius: 5 },
    levels: [null, { amount: 1 }, { damage: 4 }, { area: 0.2 }, { duration: 0.5 }, { amount: 1 }, { damage: 5 }, { cooldown: -0.5, duration: 0.5 }],
    pipeline: {
      emit: { type: 'orbit', radius: 38 },
      motion: { type: 'orbit', angularSpeed: 3.4 },
      onHit: [{ type: 'damage' }, { type: 'knockback' }, { type: 'light', radius: 18, ms: 150 }],
    },
    runeSlots: 2,
    evolution: { passive: 'lamp_glass', passiveLevel: 5, into: 'lighthouse_lens', hidden: false },
    sfx: { fire: 'orb_spawn', hit: 'hit_soft' },
  },
  {
    id: 'harpoon_chain', name: 'Harpoon Chain', desc: 'Throws a harpoon forward. Pierces enemies.',
    tags: ['steel', 'tide'], sprite: 'proj_harpoon', icon: 'icon_harpoon_chain', unlock: 'starter', maxLevel: 8, weight: 100,
    base: { damage: 16, cooldown: 1.6, amount: 1, duration: 1.2, pierce: 3, knockback: 1.2, radius: 4, interval: 0.12 },
    levels: [null, { pierce: 1 }, { damage: 6 }, { amount: 1 }, { speed: 0.2 }, { damage: 8 }, { amount: 1 }, { pierce: 2, damage: 8 }],
    pipeline: {
      emit: { type: 'facing', spread: 12, assist: 40 },
      motion: { type: 'linear', speed: 260 },
      onHit: [{ type: 'damage' }, { type: 'knockback' }],
    },
    runeSlots: 2,
    evolution: { passive: 'ballast', passiveLevel: 5, into: 'kraken_line', hidden: false },
    sfx: { fire: 'harpoon_throw', hit: 'hit_hard' },
  },
  {
    id: 'tide_bell', name: 'Tide Bell', desc: 'Sends out a wave that knocks enemies back.',
    tags: ['tide', 'echo'], sprite: 'fx_wave', icon: 'icon_tide_bell', unlock: 'research:tide_charts', maxLevel: 8, weight: 100,
    base: { damage: 10, cooldown: 3.0, amount: 1, duration: 0.7, pierce: -1, knockback: 2.2, hitCooldown: 0.8, radius: 90, interval: 0.3 },
    levels: [null, { damage: 4 }, { area: 0.15 }, { cooldown: -0.3 }, { damage: 6 }, { area: 0.15 }, { knockback: 0.8 }, { damage: 8, cooldown: -0.3 }],
    pipeline: {
      emit: { type: 'wave', thickness: 14 },
      motion: { type: 'stationary' },
      onHit: [{ type: 'damage' }, { type: 'knockback' }],
    },
    runeSlots: 2,
    evolution: { passive: 'undertow', passiveLevel: 5, into: 'storm_bell', hidden: false },
    sfx: { fire: 'bell_ring', hit: 'hit_soft' },
  },


  // Phase 6 (the MVP's other four, each behind the Library). They don't evolve yet: their
  // evolutions come with the content passes (ARCHITECTURE §18).
  {
    id: 'signal_mirror', name: 'Signal Mirror', desc: 'Flashes a beam at the nearest enemy. Hits everything in the line.',
    tags: ['light', 'echo'], sprite: 'fx_glint', icon: 'icon_signal_mirror', unlock: 'research:signal_codes', maxLevel: 8, weight: 100,
    base: { damage: 14, cooldown: 1.8, amount: 1, duration: 0.25, pierce: -1, knockback: 0.3, hitCooldown: 0.3, radius: 140, interval: 0.15 },
    levels: [null, { damage: 5 }, { amount: 1 }, { area: 0.2 }, { cooldown: -0.3 }, { damage: 7 }, { amount: 1 }, { damage: 8, area: 0.2 }],
    pipeline: {
      emit: { type: 'beam', width: 5 },
      motion: { type: 'stationary' },
      onHit: [{ type: 'damage' }, { type: 'knockback' }, { type: 'light', radius: 12, ms: 100 }],
    },
    runeSlots: 2,
    sfx: { fire: 'mirror_flash', hit: 'hit_soft' },
  },
  {
    id: 'oil_flask', name: 'Oil Flask', desc: 'Lobs a flask at the nearest enemy. It bursts into burning oil.',
    tags: ['fire'], sprite: 'proj_oil_flask', upright: true, icon: 'icon_oil_flask', unlock: 'research:oil_stores', maxLevel: 8, weight: 100,
    base: { damage: 10, cooldown: 2.6, amount: 1, duration: 3, pierce: -1, knockback: 0, hitCooldown: 0.5, radius: 16, interval: 0.3 },
    levels: [null, { damage: 4 }, { area: 0.2 }, { amount: 1 }, { cooldown: -0.4 }, { damage: 5 }, { amount: 1 }, { area: 0.2, damage: 5 }],
    pipeline: {
      emit: { type: 'nearest', range: 220 },
      motion: { type: 'arc', range: 220, flight: 0.55 },
      onHit: [
        { type: 'damage' },
        { type: 'status', status: 'burn', dps: 4, duration: 1.5 },
        { type: 'zone', radius: 22, duration: 3, damage: 4, interval: 0.4, every: 0.25, status: { status: 'burn', dps: 4, duration: 1.2 } },
        { type: 'light', radius: 24, ms: 220 },
      ],
    },
    runeSlots: 2,
    sfx: { fire: 'flask_throw', hit: 'explode_small' },
  },
  {
    id: 'lightning_rod', name: 'Lightning Rod', desc: 'Lightning strikes random enemies on screen and jumps to 2 more.',
    tags: ['light', 'steel'], sprite: 'fx_bolt', icon: 'icon_lightning_rod', unlock: 'research:storm_glass', maxLevel: 8, weight: 100,
    base: { damage: 20, cooldown: 2.2, amount: 2, duration: 0.1, pierce: -1, knockback: 0.4, hitCooldown: 0.3, radius: 10 },
    levels: [null, { amount: 1 }, { damage: 6 }, { cooldown: -0.3 }, { amount: 1 }, { damage: 8 }, { area: 0.25 }, { amount: 1, damage: 6 }],
    pipeline: {
      emit: { type: 'strike' },
      motion: { type: 'stationary' },
      onHit: [{ type: 'damage' }, { type: 'knockback' }, { type: 'chain', hops: 2, range: 80, damageMul: 0.6 }, { type: 'light', radius: 26, ms: 140 }],
    },
    runeSlots: 2,
    sfx: { fire: 'lightning', hit: 'hit_hard' },
  },
  {
    id: 'corpse_candles', name: 'Corpse Candles', desc: 'Summons candle flames that drift after enemies. Their touch rots: rotting enemies take 25% more damage.',
    tags: ['fire', 'rot'], sprite: 'proj_candle_flame', upright: true, icon: 'icon_corpse_candles', unlock: 'research:corpse_lights', maxLevel: 8, weight: 100,
    base: { damage: 7, cooldown: 4.5, amount: 2, duration: 4, pierce: -1, knockback: 0, hitCooldown: 0.6, radius: 5 },
    levels: [null, { amount: 1 }, { damage: 3 }, { duration: 1 }, { amount: 1 }, { damage: 4 }, { cooldown: -0.8 }, { amount: 1, damage: 3 }],
    pipeline: {
      emit: { type: 'summon' },
      motion: { type: 'homing', speed: 70, turn: 5, range: 220 },
      onHit: [{ type: 'damage' }, { type: 'status', status: 'rot', duration: 3, amp: 0.25 }, { type: 'light', radius: 14, ms: 120 }],
    },
    runeSlots: 2,
    sfx: { fire: 'candle_summon', hit: 'hit_soft' },
  },

  // Evolutions.
  {
    id: 'flare_barrage', name: 'Flare Barrage', desc: 'Fires 3 flares at once. Flares explode on hit.',
    tags: ['fire', 'light'], sprite: 'proj_flare_big', icon: 'icon_flare_barrage', unlock: 'evolution', maxLevel: 1, weight: 0,
    base: { damage: 26, cooldown: 0.8, amount: 3, duration: 1.6, pierce: 1, knockback: 0.8, radius: 4, interval: 0.07 },
    levels: [null],
    pipeline: {
      emit: { type: 'nearest', range: 380 },
      motion: { type: 'linear', speed: 260 },
      onHit: [{ type: 'damage' }, { type: 'explode', radius: 22, damageMul: 0.6 }, { type: 'light', radius: 24, ms: 160 }],
    },
    runeSlots: 2,
    sfx: { fire: 'flare_fire', hit: 'explode_small' },
  },
  {
    id: 'lighthouse_lens', name: 'Lighthouse Lens', desc: '5 orbs circle you without stopping. Sets enemies on fire.',
    tags: ['light', 'fire'], sprite: 'proj_lens', icon: 'icon_lighthouse_lens', unlock: 'evolution', maxLevel: 1, weight: 0,
    base: { damage: 18, cooldown: 3.0, amount: 5, duration: 3.0, pierce: -1, knockback: 0.7, hitCooldown: 0.4, radius: 6 },
    levels: [null],
    pipeline: {
      emit: { type: 'orbit', radius: 46 },
      motion: { type: 'orbit', angularSpeed: 3.8 },
      onHit: [{ type: 'damage' }, { type: 'knockback' }, { type: 'status', status: 'burn', dps: 6, duration: 2 }, { type: 'light', radius: 22, ms: 150 }],
    },
    runeSlots: 2,
    sfx: { fire: 'orb_spawn', hit: 'hit_soft' },
  },
  {
    id: 'kraken_line', name: 'Kraken Line', desc: 'Harpoons chain between enemies and pull them in.',
    tags: ['steel', 'tide'], sprite: 'proj_harpoon_big', icon: 'icon_kraken_line', unlock: 'evolution', maxLevel: 1, weight: 0,
    base: { damage: 30, cooldown: 1.2, amount: 2, duration: 1.4, pierce: 6, knockback: 0.4, radius: 5, interval: 0.1 },
    levels: [null],
    pipeline: {
      emit: { type: 'facing', spread: 14, assist: 40 },
      motion: { type: 'linear', speed: 300 },
      onHit: [{ type: 'damage' }, { type: 'pull', strength: 1.4 }, { type: 'chain', hops: 3, range: 90, damageMul: 0.7 }],
    },
    runeSlots: 2,
    sfx: { fire: 'harpoon_throw', hit: 'hit_hard' },
  },
  {
    id: 'storm_bell', name: 'Storm Bell', desc: 'Sends out 2 waves that freeze enemies.',
    tags: ['tide', 'echo', 'frost'], sprite: 'fx_wave_big', icon: 'icon_storm_bell', unlock: 'evolution', maxLevel: 1, weight: 0,
    base: { damage: 22, cooldown: 2.4, amount: 2, duration: 0.8, pierce: -1, knockback: 3, hitCooldown: 0.35, radius: 120, interval: 0.4 },
    levels: [null],
    pipeline: {
      emit: { type: 'wave', thickness: 18 },
      motion: { type: 'stationary' },
      onHit: [{ type: 'damage' }, { type: 'knockback' }, { type: 'status', status: 'freeze', duration: 0.8 }],
    },
    runeSlots: 2,
    sfx: { fire: 'bell_ring', hit: 'hit_soft' },
  },

  // Innate character weapons.
  {
    id: 'lamplight', name: 'Lamplight', desc: 'Burns nearby enemies. Grows with each level.',
    tags: ['light'], sprite: 'fx_lamplight', icon: 'icon_lamplight', unlock: 'innate', innate: true, maxLevel: 1, weight: 0,
    base: { damage: 4, cooldown: 1, amount: 1, duration: 1, pierce: -1, knockback: 0.2, hitCooldown: 0.6, radius: 26 },
    levels: [null],
    pipeline: {
      emit: { type: 'aura' },
      motion: { type: 'stationary' },
      onHit: [{ type: 'damage' }, { type: 'knockback' }],
    },
    runeSlots: 0,
    sfx: { hit: 'hit_soft' },
  },
];
