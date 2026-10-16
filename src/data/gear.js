// Gear (ARCHITECTURE §10.6, brief §6.3): made at the Smithy, worn into every run. Recipes are
// opened by research (brief §6.4: "equipment needs materials plus research"), a challenge, or a
// feat, and there is no random drop grinding: you make an item, raise its tier, and re-roll an
// affix you don't want by choosing one of three replacements.
//
// An item is { uid, id (its recipe), tier 1..5, affixes: [affix ids] }: the recipe's own affix
// first, then one more at tier 1, a third from tier 3. The brief wants affixes that change builds,
// not flat stats, so every recipe's own affix is one of those, and the rolled ones may be:
//   build   a number a tag's weapons fire with ("+1 Projectile (Fire)"), fixed at every tier
//   hook    a rule of the run with its own code (sim/hooks.js), its `grow` params times the tier's
//           multiplier ("Dash leaves burning oil")
//   rule    a RunConfig number the run is built with (`config`), once however many items carry it
//   stat    a stat modifier, as a passive's, its value times the tier's multiplier (TIER_MUL)
//
// Slots open with the Smithy's levels (data/buildings.js gearSlots): the brief's four (Lantern,
// Coat, Boots, Charm), then the Ring at level 3 and the Pendant at level 5.

export const GEAR_SLOTS = Object.freeze(['lantern', 'coat', 'boots', 'charm', 'ring', 'pendant']);
export const SLOT_NAMES = Object.freeze({ lantern: 'Lantern', coat: 'Coat', boots: 'Boots', charm: 'Charm', ring: 'Ring', pendant: 'Pendant' });
export const GEAR_TIERS = 5;
export const TIER_MUL = Object.freeze([1, 1.5, 2, 2.5, 3]);
/** At this tier an item gains its third affix. */
export const THIRD_AFFIX_TIER = 3;
/** Slots a rule affix can roll on (the small things you carry). */
export const RULE_SLOTS = Object.freeze(['charm', 'ring', 'pendant']);

export const AFFIXES = [
  // Stats.
  { id: 'might', kind: 'stat', name: 'Damage', mod: { stat: 'might', op: 'pct' }, value: 0.02 },
  { id: 'vigor', kind: 'stat', name: 'Max HP', mod: { stat: 'maxHp', op: 'add' }, value: 5 },
  { id: 'swift', kind: 'stat', name: 'Move Speed', mod: { stat: 'moveSpeed', op: 'pct' }, value: 0.015 },
  { id: 'reach', kind: 'stat', name: 'Pickup Range', mod: { stat: 'magnet', op: 'pct' }, value: 0.05 },
  { id: 'haste', kind: 'stat', name: 'Cooldown', mod: { stat: 'cooldown', op: 'pct' }, value: -0.015 },
  { id: 'breadth', kind: 'stat', name: 'Area', mod: { stat: 'area', op: 'pct' }, value: 0.02 },
  { id: 'insight', kind: 'stat', name: 'XP', mod: { stat: 'growth', op: 'pct' }, value: 0.02 },
  { id: 'greed', kind: 'stat', name: 'Materials', mod: { stat: 'greed', op: 'pct' }, value: 0.03 },
  { id: 'fortune', kind: 'stat', name: 'Luck', mod: { stat: 'luck', op: 'pct' }, value: 0.03 },
  { id: 'mend', kind: 'stat', name: 'HP Regen', mod: { stat: 'regen', op: 'add' }, value: 0.1 },
  { id: 'fire_might', kind: 'stat', name: 'Damage (Fire)', mod: { stat: 'might', op: 'pct', tags: ['fire'] }, value: 0.04 },
  { id: 'tide_might', kind: 'stat', name: 'Damage (Tide)', mod: { stat: 'might', op: 'pct', tags: ['tide'] }, value: 0.04 },
  { id: 'light_might', kind: 'stat', name: 'Damage (Light)', mod: { stat: 'might', op: 'pct', tags: ['light'] }, value: 0.04 },
  { id: 'steel_might', kind: 'stat', name: 'Damage (Steel)', mod: { stat: 'might', op: 'pct', tags: ['steel'] }, value: 0.04 },
  // What a tag's weapons fire with: the same at every tier.
  { id: 'fire_volley', kind: 'build', name: 'Projectile (Fire)', mod: { stat: 'amount', op: 'add', tags: ['fire'] }, value: 1 },
  { id: 'tide_volley', kind: 'build', name: 'Projectile (Tide)', mod: { stat: 'amount', op: 'add', tags: ['tide'] }, value: 1 },
  { id: 'light_pierce', kind: 'build', name: 'Pierce (Light)', mod: { stat: 'pierce', op: 'add', tags: ['light'] }, value: 1 },
  { id: 'steel_pierce', kind: 'build', name: 'Pierce (Steel)', mod: { stat: 'pierce', op: 'add', tags: ['steel'] }, value: 1 },
  { id: 'echo_reach', kind: 'build', name: 'Area (Echo)', mod: { stat: 'area', op: 'pct', tags: ['echo'] }, value: 0.15 },
  // Rules with their own code; the `grow` params rise with the tier.
  {
    id: 'oil_wake', kind: 'hook', name: 'Dash leaves burning oil', hook: 'dash_trail', grow: ['damage', 'dps'],
    params: { radius: 14, duration: 2.5, damage: 6, interval: 0.5, dps: 4, burn: 2, every: 4 },
  },
  {
    id: 'tide_pulse', kind: 'hook', name: 'Level-ups send out a wave', hook: 'level_pulse', grow: ['damage'],
    params: { radius: 70, damage: 30, knockback: 2 },
  },
  // Rules the run is built with.
  { id: 'kinship', kind: 'rule', name: 'Evolutions need 1 less passive level', config: { evolutionPassiveReduction: 1 } },
  { id: 'fourth_card', kind: 'rule', name: 'Level-ups offer 4 cards', config: { draftCards: 1 } },
];

const STATS = ['might', 'vigor', 'swift', 'reach', 'haste', 'breadth', 'insight', 'greed', 'fortune', 'mend'];
const TAGGED = ['fire_might', 'tide_might', 'light_might', 'steel_might'];
const BUILD = ['fire_volley', 'tide_volley', 'light_pierce', 'steel_pierce', 'echo_reach'];
const HOOKED = ['oil_wake', 'tide_pulse'];
const RULES = ['kinship', 'fourth_card'];

/**
 * base: the recipe's own affix (always first, and one that changes the build). pool: what its
 * other affixes are drawn from (never the base, never twice on one item). cost: tier 1's price;
 * a tier up costs the next tier times it.
 */
export const RECIPES = ([
  { id: 'storm_lantern', name: 'Storm Lantern', slot: 'lantern', icon: 'gear_lantern', base: 'fire_volley', pool: [...STATS, ...TAGGED, ...BUILD], cost: { iron: 2, oil: 16, coin: 40 }, unlock: 'research:smiths_ledger' },
  { id: 'harbor_coat', name: 'Harbor Coat', slot: 'coat', icon: 'gear_coat', base: 'tide_volley', pool: [...STATS, ...TAGGED, ...BUILD], cost: { iron: 2, timber: 10, coin: 45 }, unlock: 'research:smiths_ledger' },
  { id: 'sea_boots', name: 'Sea Boots', slot: 'boots', icon: 'gear_boots', base: 'oil_wake', pool: [...STATS, ...TAGGED, ...BUILD], cost: { iron: 2, rope: 8, coin: 40 }, unlock: 'research:smiths_ledger' },
  { id: 'brass_compass', name: 'Brass Compass', slot: 'charm', icon: 'gear_compass', base: 'kinship', pool: [...STATS, ...HOOKED, 'fourth_card'], cost: { iron: 4, drowned_pages: 10, coin: 60 }, unlock: 'research:compass_rose' },
  { id: 'salt_ring', name: 'Salt Ring', slot: 'ring', icon: 'gear_ring', base: 'fourth_card', pool: [...STATS, ...TAGGED, ...BUILD, 'kinship'], cost: { iron: 5, rum: 4, coin: 70 }, unlock: 'research:compass_rose' },
  { id: 'pier_lamp', name: 'Pier Lamp', slot: 'lantern', icon: 'gear_pier_lamp', base: 'light_pierce', pool: [...STATS, ...TAGGED, ...BUILD], cost: { iron: 4, oil: 20, coin: 60 }, unlock: 'research:tide_forging' },
  { id: 'tide_charm', name: 'Tide Charm', slot: 'charm', icon: 'gear_charm', base: 'tide_pulse', pool: [...STATS, ...TAGGED, ...RULES, 'oil_wake'], cost: { iron: 5, rope: 12, coin: 70 }, unlock: 'research:tide_forging' },
  { id: 'bell_pendant', name: 'Bell Pendant', slot: 'pendant', icon: 'gear_pendant', base: 'echo_reach', pool: [...STATS, ...TAGGED, ...BUILD, ...RULES], cost: { iron: 6, drowned_pages: 14, coin: 80 }, unlock: 'research:tide_forging' },
  { id: 'bosun_coat', name: "Bosun's Coat", slot: 'coat', icon: 'gear_bosun', base: 'steel_pierce', pool: [...STATS, ...TAGGED, ...BUILD], cost: { iron: 6, rope: 10, coin: 80 }, unlock: 'challenge:bare_hands' },
]).map((r) => ({ ...r, pool: r.pool.filter((id) => id !== r.base) }));   // never its own affix twice

/** What a rune stone costs to cut at the Smithy (any rune you've found). */
export const RUNE_STONE_COST = Object.freeze({ iron: 3, drowned_pages: 10, coin: 60 });
/** What re-rolling one affix costs, times the item's tier. */
export const REROLL_COST = Object.freeze({ iron: 1, coin: 30 });
