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
//           multiplier ("Walking leaves burning oil")
//   rule    a RunConfig number the run is built with (`config`), once however many items carry it
//   stat    a stat modifier, as a passive's, its value times the tier's multiplier (TIER_MUL)
//
// Slots open with the Smithy's levels (data/buildings.js gearSlots): the brief's four (Lantern,
// Coat, Boots, Keepsake), then the Ring at level 3 and the Pendant at level 5.
//
// The sweep (D1): no two recipes are the same piece. Each recipe's own affix (`base`) is its own:
// tests/content.test.js fails on a second recipe with the same slot and base, and on a rule or a
// hook that two recipes carry as their own (worn together, one of the two would do nothing).
//
// Prices (0.9.0, W5; the veteran round: "too cheap to be goals"): a share of a practiced run's
// haul at the half-harbor stage (work/veteran/W5/income.txt, prices.txt). A recipe's tier 1 is
// 0.45 of a run (the Lighthouse's 0.6); a tier up costs the recipe times the new tier, so a
// Legendary piece is about 7 runs, its tiers named by rarity (data/rarity.js). A re-roll is
// about 0.07 of a run a tier. tools: work/veteran/W5/tools/reprice.py.
// The sweep, X3 (E3): Iron ran four times longer than Timber, Rum, Drowned Pages, and Oil, which had
// nothing left to buy from about run 20. Each recipe's Iron went from 5 to 3 (7 to 4 for the
// Lighthouse's and Long Watch's), and its slot asks one of the four in its place: Oil for a Lantern
// or Pendant, Timber for a Coat or Boots, Drowned Pages for a Keepsake or Ring (Oil 200, Timber 80, Pages 60), and
// every recipe 10 Rum (times 1.3 for the dear ones). Six worn pieces to Legendary went from about
// 34 runs of Iron to 20 (work/sweep/X3/economy.mjs).
// Round 2: a Coat or Boots also asks 25 Rope (30 for the dear ones), once the Drowned Bosun's Rope drop was
// cut to a tenth: Rope had 7 runs of things to buy, now about 30.

export const GEAR_SLOTS = Object.freeze(['lantern', 'coat', 'boots', 'charm', 'ring', 'pendant']);
export const SLOT_NAMES = Object.freeze({ lantern: 'Lantern', coat: 'Coat', boots: 'Boots', charm: 'Keepsake', ring: 'Ring', pendant: 'Pendant' });   // (the sweep, B1: "Charm" is a relic tier; the slot's id stays 'charm')
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
  { id: 'insight', kind: 'stat', name: 'XP Gain', mod: { stat: 'growth', op: 'pct' }, value: 0.02 },
  { id: 'greed', kind: 'stat', name: 'Materials', mod: { stat: 'greed', op: 'pct' }, value: 0.03 },
  { id: 'fortune', kind: 'stat', name: 'Luck', mod: { stat: 'luck', op: 'pct' }, value: 0.03 },
  { id: 'mend', kind: 'stat', name: 'HP Regen', mod: { stat: 'regen', op: 'add' }, value: 0.1 },
  { id: 'fire_might', kind: 'stat', name: 'Damage (Fire)', mod: { stat: 'might', op: 'pct', tags: ['fire'] }, value: 0.04 },
  { id: 'tide_might', kind: 'stat', name: 'Damage (Sea)', mod: { stat: 'might', op: 'pct', tags: ['sea'] }, value: 0.04 },
  { id: 'light_might', kind: 'stat', name: 'Damage (Light)', mod: { stat: 'might', op: 'pct', tags: ['light'] }, value: 0.04 },
  { id: 'steel_might', kind: 'stat', name: 'Damage (Steel)', mod: { stat: 'might', op: 'pct', tags: ['steel'] }, value: 0.04 },
  { id: 'frost_might', kind: 'stat', name: 'Damage (Frost)', mod: { stat: 'might', op: 'pct', tags: ['frost'] }, value: 0.04 },
  { id: 'rot_might', kind: 'stat', name: 'Damage (Rot)', mod: { stat: 'might', op: 'pct', tags: ['rot'] }, value: 0.04 },
  { id: 'echo_might', kind: 'stat', name: 'Damage (Echo)', mod: { stat: 'might', op: 'pct', tags: ['echo'] }, value: 0.04 },
  // What a tag's weapons fire with: the same at every tier.
  { id: 'fire_volley', kind: 'build', name: 'Projectile (Fire)', mod: { stat: 'amount', op: 'add', tags: ['fire'] }, value: 1 },
  { id: 'tide_volley', kind: 'build', name: 'Projectile (Sea)', mod: { stat: 'amount', op: 'add', tags: ['sea'] }, value: 1 },
  { id: 'light_pierce', kind: 'build', name: 'Pierce (Light)', mod: { stat: 'pierce', op: 'add', tags: ['light'] }, value: 1 },
  { id: 'steel_pierce', kind: 'build', name: 'Pierce (Steel)', mod: { stat: 'pierce', op: 'add', tags: ['steel'] }, value: 1 },
  { id: 'echo_reach', kind: 'build', name: 'Area (Echo)', mod: { stat: 'area', op: 'pct', tags: ['echo'] }, value: 0.15 },
  // 0.9.0 (W5): one more for each tag, so the Harbor Orders' recipes each change a different build.
  { id: 'frost_volley', kind: 'build', name: 'Projectile (Frost)', mod: { stat: 'amount', op: 'add', tags: ['frost'] }, value: 1 },
  { id: 'rot_volley', kind: 'build', name: 'Projectile (Rot)', mod: { stat: 'amount', op: 'add', tags: ['rot'] }, value: 1 },
  { id: 'steel_volley', kind: 'build', name: 'Projectile (Steel)', mod: { stat: 'amount', op: 'add', tags: ['steel'] }, value: 1 },
  { id: 'light_volley', kind: 'build', name: 'Projectile (Light)', mod: { stat: 'amount', op: 'add', tags: ['light'] }, value: 1 },
  { id: 'echo_volley', kind: 'build', name: 'Projectile (Echo)', mod: { stat: 'amount', op: 'add', tags: ['echo'] }, value: 1 },
  { id: 'sea_pierce', kind: 'build', name: 'Pierce (Sea)', mod: { stat: 'pierce', op: 'add', tags: ['sea'] }, value: 1 },
  { id: 'frost_pierce', kind: 'build', name: 'Pierce (Frost)', mod: { stat: 'pierce', op: 'add', tags: ['frost'] }, value: 1 },
  { id: 'fire_reach', kind: 'build', name: 'Area (Fire)', mod: { stat: 'area', op: 'pct', tags: ['fire'] }, value: 0.15 },
  { id: 'rot_reach', kind: 'build', name: 'Area (Rot)', mod: { stat: 'area', op: 'pct', tags: ['rot'] }, value: 0.15 },
  { id: 'frost_reach', kind: 'build', name: 'Area (Frost)', mod: { stat: 'area', op: 'pct', tags: ['frost'] }, value: 0.15 },
  // The sweep (D1): own affixes for the pieces that were another piece over again, and for the hard
  // orders that paid only a prop. Never rolled: each is one recipe's own.
  { id: 'light_reach', kind: 'build', name: 'Area (Light)', mod: { stat: 'area', op: 'pct', tags: ['light'] }, value: 0.15 },
  { id: 'steel_reach', kind: 'build', name: 'Area (Steel)', mod: { stat: 'area', op: 'pct', tags: ['steel'] }, value: 0.15 },
  { id: 'sea_reach', kind: 'build', name: 'Area (Sea)', mod: { stat: 'area', op: 'pct', tags: ['sea'] }, value: 0.15 },
  { id: 'sea_shove', kind: 'build', name: 'Knockback (Sea)', mod: { stat: 'knockback', op: 'pct', tags: ['sea'] }, value: 0.25 },
  { id: 'sea_linger', kind: 'build', name: 'Duration (Sea)', mod: { stat: 'duration', op: 'pct', tags: ['sea'] }, value: 0.2 },
  { id: 'rot_linger', kind: 'build', name: 'Duration (Rot)', mod: { stat: 'duration', op: 'pct', tags: ['rot'] }, value: 0.2 },
  { id: 'rot_pierce', kind: 'build', name: 'Pierce (Rot)', mod: { stat: 'pierce', op: 'add', tags: ['rot'] }, value: 1 },
  // The sweep, X2 (rulings 11 to 13): own affixes for what the retired arcana's and tonics' orders and
  // the set runs open now. Never rolled: each is one recipe's own. Cooldown and Crit Chance for a tag
  // reach every weapon of that tag (`percent`: a share shown as a percent though it adds).
  ...['fire', 'sea', 'light', 'steel', 'frost', 'rot', 'echo'].map((t) => ({ id: `${t}_haste`, kind: 'build', name: `Cooldown (${t[0].toUpperCase()}${t.slice(1)})`, mod: { stat: 'cooldown', op: 'pct', tags: [t] }, value: -0.06 })),
  ...['fire', 'sea', 'light', 'steel', 'frost', 'rot', 'echo'].map((t) => ({ id: `${t}_crit`, kind: 'build', name: `Crit Chance (${t[0].toUpperCase()}${t.slice(1)})`, percent: true, mod: { stat: 'crit', op: 'add', tags: [t] }, value: 0.05 })),
  // Rules with their own code; the `grow` params rise with the tier.
  {
    id: 'oil_wake', kind: 'hook', name: 'Walking leaves burning oil', hook: 'walk_trail', grow: ['damage', 'dps'],
    params: { radius: 14, duration: 2.5, damage: 6, interval: 0.5, dps: 4, burn: 2, every: 1.5 },
  },
  {
    id: 'tide_pulse', kind: 'hook', name: 'Level-ups send out a wave', hook: 'level_pulse', grow: ['damage'],
    params: { radius: 70, damage: 30, knockback: 2 },
  },
  // The Bell Pendant's own (0.7.3: its Echo rule, a bell's echo, in place of a plain Area bonus).
  {
    id: 'echo_toll', kind: 'hook', name: 'Every 5s, a wave hits enemies around you', hook: 'timed_wave', grow: ['damage'],   // (W4, Nov 17: was every 11th kill)
    params: { every: 5, radius: 120, damage: 25, knockback: 2 },
  },
  // Rules the run is built with.
  { id: 'kinship', kind: 'rule', name: 'Final Forms get +6% Damage', config: { evolutionPassiveReduction: 1 } },
  { id: 'fourth_card', kind: 'rule', name: 'Level-ups offer 4 cards', config: { draftCards: 1 } },
  // The sweep (D1): rules of their own for the last pieces (meta/runconfig.js reads each key: a
  // charge or a Revival the run starts with, the lamps' speed, what a curse pays).
  { id: 'spare_life', kind: 'rule', name: '+1 Revival', config: { revival: 1 } },
  { id: 'second_look', kind: 'rule', name: '+1 Reroll', config: { reroll: 1 } },
  { id: 'cast_off', kind: 'rule', name: '+1 Banish', config: { banish: 1 } },
  { id: 'pass_by', kind: 'rule', name: '+1 Skip', config: { skip: 1 } },
  { id: 'lamp_hand', kind: 'rule', name: 'Wayside Lamps light 25% faster', config: { lampSpeed: 0.25 } },
  { id: 'curse_pay', kind: 'rule', name: 'Each curse pays 5% more materials', config: { cursePay: 0.05 } },
  { id: 'plate', kind: 'rule', name: '+1 Armor', config: { armor: 1 } },
  { id: 'quick_dash', kind: 'rule', name: '+5% Move Speed', config: { moveSpeed: 0.05 } },
  { id: 'start_pearls', kind: 'rule', name: 'Start each run with 15 Pearls', config: { startGlass: 15 } },
];

const STATS = ['might', 'vigor', 'swift', 'reach', 'haste', 'breadth', 'insight', 'greed', 'fortune', 'mend'];
const TAGGED = ['fire_might', 'tide_might', 'light_might', 'steel_might', 'frost_might', 'rot_might', 'echo_might'];
const BUILD = ['fire_volley', 'tide_volley', 'light_pierce', 'steel_pierce', 'echo_reach', 'frost_volley', 'rot_volley', 'steel_volley', 'light_volley', 'echo_volley', 'sea_pierce', 'frost_pierce', 'fire_reach', 'rot_reach', 'frost_reach'];
const HOOKED = ['oil_wake', 'tide_pulse'];
const RULES = ['kinship', 'fourth_card'];

/**
 * base: the recipe's own affix (always first, and one that changes the build). pool: what its
 * other affixes are drawn from (never the base, never twice on one item). cost: tier 1's price;
 * a tier up costs the next tier times it.
 */
export const RECIPES = ([
  { id: 'storm_lantern', name: 'Storm Lantern', slot: 'lantern', icon: 'gear_lantern', base: 'fire_volley', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, oil: 360, rum: 10 }, unlock: 'research:smiths_ledger' },
  { id: 'harbor_coat', name: 'Oilskin', slot: 'coat', icon: 'gear_coat', base: 'tide_volley', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, timber: 165, rope: 25, rum: 10 }, unlock: 'research:smiths_ledger' },
  { id: 'sea_boots', name: 'Sea Boots', slot: 'boots', icon: 'gear_boots', base: 'oil_wake', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, timber: 80, rope: 60, rum: 10 }, unlock: 'research:smiths_ledger' },
  { id: 'brass_compass', name: 'Brass Compass', slot: 'charm', icon: 'gear_compass', base: 'kinship', pool: [...STATS, ...HOOKED, 'fourth_card'], cost: { coin: 430, iron: 3, drowned_pages: 140, rum: 10 }, unlock: 'research:compass_rose' },
  { id: 'salt_ring', name: 'Signet Ring', slot: 'ring', icon: 'gear_ring', base: 'fourth_card', pool: [...STATS, ...TAGGED, ...BUILD, 'kinship'], cost: { coin: 430, iron: 3, drowned_pages: 60, rum: 35 }, unlock: 'research:compass_rose' },
  { id: 'pier_lamp', name: 'Pier Lamp', slot: 'lantern', icon: 'gear_pier_lamp', base: 'light_pierce', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, oil: 360, rum: 10 }, unlock: 'research:tide_forging' },
  { id: 'tide_charm', name: 'Scrimshaw Tooth', slot: 'charm', icon: 'gear_charm', base: 'tide_pulse', pool: [...STATS, ...TAGGED, ...RULES, 'oil_wake'], cost: { coin: 430, iron: 3, rope: 35, drowned_pages: 60, rum: 10 }, unlock: 'research:tide_forging' },
  { id: 'bell_pendant', name: 'Bosun\'s Whistle', slot: 'pendant', icon: 'gear_pendant', base: 'echo_toll', pool: [...STATS, ...TAGGED, ...BUILD, ...RULES], cost: { coin: 430, iron: 3, oil: 200, drowned_pages: 80, rum: 10 }, unlock: 'research:tide_forging' },
  { id: 'bosun_coat', name: "Bosun's Coat", slot: 'coat', icon: 'gear_bosun', base: 'steel_pierce', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, timber: 80, rope: 60, rum: 10 }, unlock: 'feat:bare_hands' },
  // 0.9.0 (W5): recipes the Harbor Orders open, each its own build (its base), and one for each
  // character at mastery rank 6. Icons are the slot's own drawing.
  { id: 'ice_lamp', name: 'Hurricane Lamp', slot: 'lantern', icon: 'gear_lantern', base: 'frost_volley', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, oil: 200, rum: 10, marsh_herbs: 95, salt_glass: 7 }, unlock: 'feat:frozen_hold' },
  { id: 'mire_coat', name: 'Gansey', slot: 'coat', icon: 'gear_coat', base: 'rot_volley', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, timber: 80, rope: 25, rum: 10, marsh_herbs: 95, salt_glass: 7 }, unlock: 'feat:rot_and_ruin' },
  { id: 'salt_waders', name: 'Salt Waders', slot: 'boots', icon: 'gear_boots', base: 'rot_pierce', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, timber: 80, rope: 25, rum: 10, marsh_herbs: 95, salt_glass: 7 }, unlock: 'feat:marsh_tide_2' },
  { id: 'gull_charm', name: 'Carved Gull', slot: 'charm', icon: 'gear_charm', base: 'second_look', pool: [...STATS, ...HOOKED, 'kinship'], cost: { coin: 430, iron: 3, timber: 85, drowned_pages: 60, rum: 10 }, unlock: 'feat:docks_tide_6' },
  { id: 'anchor_ring', name: 'Bosun\'s Ring', slot: 'ring', icon: 'gear_ring', base: 'steel_volley', pool: [...STATS, ...TAGGED, ...BUILD, 'kinship'], cost: { coin: 430, iron: 3, rope: 35, drowned_pages: 60, rum: 10 }, unlock: 'feat:heavy_iron' },
  { id: 'lens_pendant', name: 'Sextant', slot: 'pendant', icon: 'gear_pendant', base: 'light_volley', pool: [...STATS, ...TAGGED, ...BUILD, ...RULES], cost: { coin: 430, iron: 3, oil: 360, rum: 10 }, unlock: 'feat:bright_work' },
  { id: 'eelskin_boots', name: 'Eelskin Boots', slot: 'boots', icon: 'gear_boots', base: 'sea_linger', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, timber: 80, rope: 25, rum: 10, marsh_herbs: 95, salt_glass: 7 }, unlock: 'feat:marsh_tide_4' },
  { id: 'ember_ring', name: 'Flint Ring', slot: 'ring', icon: 'gear_ring', base: 'fire_reach', pool: [...STATS, ...TAGGED, ...BUILD, 'kinship'], cost: { coin: 430, iron: 3, oil: 160, drowned_pages: 60, rum: 10 }, unlock: 'feat:wildfire' },
  { id: 'frost_charm', name: 'Rime Stone', slot: 'charm', icon: 'gear_charm', base: 'frost_pierce', pool: [...STATS, ...HOOKED, 'fourth_card'], cost: { coin: 430, iron: 3, drowned_pages: 60, rum: 10, marsh_herbs: 95, salt_glass: 7 }, unlock: 'feat:marsh_tide_6' },
  { id: 'tide_pendant', name: 'Saint\'s Medal', slot: 'pendant', icon: 'gear_pendant', base: 'sea_pierce', pool: [...STATS, ...TAGGED, ...BUILD, ...RULES], cost: { coin: 430, iron: 3, oil: 200, timber: 85, rum: 10 }, unlock: 'feat:docks_tide_4' },
  { id: 'bell_coat', name: 'Pea Coat', slot: 'coat', icon: 'gear_coat', base: 'echo_volley', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, timber: 80, rope: 25, drowned_pages: 80, rum: 10 }, unlock: 'feat:ring_them_all' },
  { id: 'grave_lantern', name: 'Dark Lantern', slot: 'lantern', icon: 'gear_pier_lamp', base: 'rot_reach', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, oil: 200, rum: 10, marsh_herbs: 95, salt_glass: 7 }, unlock: 'feat:marsh_tide_8' },
  { id: 'glass_boots', name: 'Clogs', slot: 'boots', icon: 'gear_boots', base: 'frost_reach', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, timber: 80, rope: 25, rum: 10, marsh_herbs: 95, salt_glass: 7 }, unlock: 'feat:widow_slayer' },
  { id: 'harbor_ring', name: 'Harbormaster\'s Ring', slot: 'ring', icon: 'gear_ring', base: 'cast_off', pool: [...STATS, ...TAGGED, ...BUILD, 'fourth_card'], cost: { coin: 430, iron: 3, rope: 35, drowned_pages: 60, rum: 10 }, unlock: 'feat:docks_tide_8' },
  { id: 'storm_pendant', name: 'Locket', slot: 'pendant', icon: 'gear_pendant', base: 'echo_reach', pool: [...STATS, ...TAGGED, ...BUILD, ...RULES], cost: { coin: 430, iron: 3, oil: 200, rum: 10, marsh_herbs: 95, salt_glass: 7 }, unlock: 'feat:eye_of_the_storm' },
  { id: 'cinder_coat', name: 'Stoker\'s Jacket', slot: 'coat', icon: 'gear_bosun', base: 'fire_volley', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, oil: 160, timber: 80, rope: 25, rum: 10 }, unlock: 'feat:docks_tide_2' },
  // The sweep (D1): what the hard orders open (each paid only a prop on the square before).
  { id: 'runners_ring', name: "Copper Ring", slot: 'ring', icon: 'gear_ring', base: 'lamp_hand', pool: [...STATS, ...TAGGED, ...BUILD, 'kinship'], cost: { coin: 430, iron: 3, oil: 160, drowned_pages: 60, rum: 10 }, unlock: 'feat:lamp_runner' },
  { id: 'unlucky_penny', name: 'Unlucky Penny', slot: 'charm', icon: 'gear_charm', base: 'curse_pay', pool: [...STATS, ...HOOKED, 'fourth_card'], cost: { coin: 430, iron: 3, drowned_pages: 140, rum: 10 }, unlock: 'feat:cursed' },
  { id: 'counting_beads', name: 'Counting Beads', slot: 'pendant', icon: 'gear_pendant', base: 'pass_by', pool: [...STATS, ...TAGGED, ...BUILD, ...RULES], cost: { coin: 430, iron: 3, oil: 200, drowned_pages: 80, rum: 10 }, unlock: 'feat:level_100' },
  { id: 'bog_ring', name: 'Bone Ring', slot: 'ring', icon: 'gear_ring', base: 'rot_linger', pool: [...STATS, ...TAGGED, ...BUILD, 'kinship'], cost: { coin: 430, iron: 3, drowned_pages: 60, rum: 10, marsh_herbs: 95, salt_glass: 7 }, unlock: 'feat:bog_host' },
  { id: 'pilots_coat', name: "Pilot's Coat", slot: 'coat', icon: 'gear_coat', base: 'sea_reach', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, timber: 80, rope: 25, rum: 10, marsh_herbs: 95, salt_glass: 7 }, unlock: 'feat:pole_star' },
  // The sweep, X2: what the orders that opened an arcana or a tonic open now, and the set runs that
  // paid a tonic or only materials. Each has an affix of its own (above).
  { id: 'tidecallers_lantern', name: "Ship's Lantern", slot: 'lantern', icon: 'gear_pier_lamp', base: 'echo_haste', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, oil: 200, drowned_pages: 80, rum: 10 }, unlock: 'feat:docks_tide_10' },
  { id: 'widows_ring', name: "Widow's Ring", slot: 'ring', icon: 'gear_ring', base: 'frost_haste', pool: [...STATS, ...TAGGED, ...BUILD, 'kinship'], cost: { coin: 430, iron: 3, drowned_pages: 60, rum: 10, marsh_herbs: 95, salt_glass: 7 }, unlock: 'feat:marsh_tide_10' },
  { id: 'collectors_purse', name: "Collector's Purse", slot: 'charm', icon: 'gear_charm', base: 'start_pearls', pool: [...STATS, ...HOOKED, 'fourth_card'], cost: { coin: 430, iron: 3, rope: 35, drowned_pages: 60, rum: 10 }, unlock: 'feat:collector' },
  { id: 'hunters_ring', name: "Hunter's Ring", slot: 'ring', icon: 'gear_ring', base: 'steel_crit', pool: [...STATS, ...TAGGED, ...BUILD, 'kinship'], cost: { coin: 430, iron: 3, rope: 35, drowned_pages: 60, rum: 10 }, unlock: 'feat:elite_hunter' },
  { id: 'night_lantern', name: 'Bull\'s-eye Lantern', slot: 'lantern', icon: 'gear_lantern', base: 'fire_crit', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, oil: 360, rum: 10 }, unlock: 'feat:wildfire_night' },
  { id: 'reapers_ring', name: "Mourning Ring", slot: 'ring', icon: 'gear_ring', base: 'quick_dash', pool: [...STATS, ...TAGGED, ...BUILD, 'kinship'], cost: { coin: 430, iron: 3, rope: 35, drowned_pages: 60, rum: 10 }, unlock: 'feat:dash_killer' },
  { id: 'quiet_charm', name: 'Pocket Watch', slot: 'charm', icon: 'gear_charm', base: 'plate', pool: [...STATS, ...HOOKED, 'fourth_card'], cost: { coin: 430, iron: 3, timber: 85, drowned_pages: 60, rum: 10 }, unlock: 'feat:untouchable' },
  { id: 'ember_pendant', name: 'Tinderbox', slot: 'pendant', icon: 'gear_pendant', base: 'fire_haste', pool: [...STATS, ...TAGGED, ...BUILD, ...RULES], cost: { coin: 430, iron: 3, oil: 360, rum: 10 }, unlock: 'feat:ember_keeper' },
  { id: 'tide_ring', name: 'Sea-Glass Ring', slot: 'ring', icon: 'gear_ring', base: 'sea_haste', pool: [...STATS, ...TAGGED, ...BUILD, 'kinship'], cost: { coin: 430, iron: 3, timber: 85, drowned_pages: 60, rum: 10 }, unlock: 'feat:deep_water' },
  { id: 'ledger_pendant', name: 'Tally Stick', slot: 'pendant', icon: 'gear_pendant', base: 'light_crit', pool: [...STATS, ...TAGGED, ...BUILD, ...RULES], cost: { coin: 430, iron: 3, oil: 200, drowned_pages: 80, rum: 10 }, unlock: 'feat:full_house' },
  { id: 'soft_boots', name: 'Deck Shoes', slot: 'boots', icon: 'gear_boots', base: 'echo_crit', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, timber: 80, rope: 25, drowned_pages: 80, rum: 10 }, unlock: 'feat:untouched' },
  { id: 'forge_charm', name: 'Horseshoe', slot: 'charm', icon: 'gear_charm', base: 'steel_haste', pool: [...STATS, ...HOOKED, 'fourth_card'], cost: { coin: 430, iron: 3, rope: 35, drowned_pages: 60, rum: 10 }, unlock: 'feat:three_forms' },
  { id: 'cork_boots', name: 'Cork Boots', slot: 'boots', icon: 'gear_boots', base: 'sea_crit', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, timber: 80, rope: 25, rum: 10, marsh_herbs: 95, salt_glass: 7 }, unlock: 'feat:low_water' },
  { id: 'grave_ring', name: 'Jet Ring', slot: 'ring', icon: 'gear_ring', base: 'rot_crit', pool: [...STATS, ...TAGGED, ...BUILD, 'kinship'], cost: { coin: 430, iron: 3, drowned_pages: 60, rum: 10, marsh_herbs: 95, salt_glass: 7 }, unlock: 'feat:bog_lights' },
  { id: 'whetstone_charm', name: 'Oilstone', slot: 'charm', icon: 'gear_charm', base: 'light_haste', pool: [...STATS, ...HOOKED, 'fourth_card'], cost: { coin: 430, iron: 3, drowned_pages: 60, rum: 10, marsh_herbs: 95, salt_glass: 7 }, unlock: 'feat:salt_and_iron' },
  { id: 'frost_pendant', name: 'Snow Quartz', slot: 'pendant', icon: 'gear_pendant', base: 'frost_crit', pool: [...STATS, ...TAGGED, ...BUILD, ...RULES], cost: { coin: 430, iron: 3, oil: 200, rum: 10, marsh_herbs: 95, salt_glass: 7 }, unlock: 'feat:widow_watch' },
  { id: 'watch_lantern', name: 'Watchman\'s Lantern', slot: 'lantern', icon: 'gear_pier_lamp', base: 'rot_haste', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 580, iron: 4, oil: 470, rum: 13, salt_glass: 9 }, unlock: 'feat:long_watch' },
  // The Lighthouse's (0.9.0): stages 2, 6, and 10.
  { id: 'keepers_lantern', name: "Keeper's Lantern", slot: 'lantern', icon: 'gear_pier_lamp', base: 'light_volley', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 580, iron: 4, oil: 470, rum: 13, salt_glass: 9 }, unlock: 'building:lighthouse:2' },
  { id: 'lens_ring', name: 'Loupe', slot: 'ring', icon: 'gear_ring', base: 'light_pierce', pool: [...STATS, ...TAGGED, ...BUILD, 'kinship'], cost: { coin: 580, iron: 4, drowned_pages: 180, rum: 13, salt_glass: 9 }, unlock: 'building:lighthouse:6' },
  { id: 'lightkeepers_pendant', name: "Lightkeeper's Pendant", slot: 'pendant', icon: 'gear_pendant', base: 'spare_life', pool: [...STATS, ...TAGGED, ...BUILD, 'kinship'], cost: { coin: 580, iron: 4, oil: 260, timber: 110, rum: 13, salt_glass: 9 }, unlock: 'building:lighthouse:10' },
  // Mastery rank 6: a piece each character's own trade suits (the sweep, D1: three were another
  // piece over again; each has its own affix now, for that character's own weapon's tag).
  { id: 'wick_hood', name: 'Wick Hood', slot: 'lantern', icon: 'gear_lantern', base: 'light_reach', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, oil: 360, rum: 10 }, unlock: 'mastery:lamplighter:6' },
  { id: 'gaff_coat', name: 'Gaff Coat', slot: 'coat', icon: 'gear_bosun', base: 'steel_volley', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, timber: 80, rope: 60, rum: 10 }, unlock: 'mastery:harpooner:6' },
  { id: 'punt_boots', name: 'Wading Boots', slot: 'boots', icon: 'gear_boots', base: 'sea_shove', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, timber: 80, rope: 25, rum: 10, marsh_herbs: 95, salt_glass: 7 }, unlock: 'mastery:punter:6' },
  { id: 'peat_shawl', name: 'Peat Shawl', slot: 'coat', icon: 'gear_coat', base: 'rot_reach', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, timber: 80, rope: 25, rum: 10, marsh_herbs: 95, salt_glass: 7 }, unlock: 'mastery:bog_warden:6' },
  // 0.9.0 (W2): the two new characters'.
  { id: 'kelp_coat', name: 'Fisherman\'s Smock', slot: 'coat', icon: 'gear_bosun', base: 'steel_reach', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, timber: 80, rope: 60, rum: 10 }, unlock: 'mastery:drowned_man:6' },
  { id: 'priests_stole', name: "Priest's Stole", slot: 'charm', icon: 'gear_charm', base: 'tide_volley', pool: [...STATS, ...TAGGED, ...BUILD], cost: { coin: 430, iron: 3, timber: 85, drowned_pages: 60, rum: 10 }, unlock: 'mastery:tide_priest:6' },
]).map((r) => ({ ...r, pool: r.pool.filter((id) => id !== r.base) }));   // never its own affix twice

/** What re-rolling one affix costs, times the item's tier. 0.8.0: Iron and Salt Glass per tier. */
export const REROLL_COST = Object.freeze({ iron: 2, salt_glass: 2, coin: 120 });
/**
 * What raising an item to tiers 4 and 5 asks on top of its recipe's price (0.8.0): Salt Glass, so
 * the Smithy's top tiers point at the Salt Marsh. (meta/workshop.js upgradeCost.)
 */
export const GEAR_TIER_EXTRA = Object.freeze({ 4: Object.freeze({ salt_glass: 12 }), 5: Object.freeze({ salt_glass: 25 }) });
