// Character mastery (ARCHITECTURE §10.6). Every run gives the character you played mastery XP
// (tuning.mastery: a point a minute survived plus some for each boss killed). Ranks 1 to 11 come
// at META.masteryRanks, and every rank opens something: a skill point at ranks 1, 3, 5, 7, 9, 10,
// and 11 (ruling 15: data/skills.js, the character's skill tree, in place of the mastery perks),
// a starting kit at 2 and 4 (KITS), a piece of gear at the Smithy at 6 (data/gear.js
// 'mastery:<id>:6'), and a set run of their own at 8 (data/challenges.js), which opens one skill
// of their tree when it is won. The perks' ids and prices are kept in meta/skills.js
// (RETIRED_PERKS) for the saves that trained them.

export const KITS = [
  { id: 'lamplighter_orb', character: 'lamplighter', rank: 4, name: 'Orb Kit', start: 'lantern_orb', desc: 'Start with the Lantern Orb instead of the Flare Gun.' },
  { id: 'harpooner_bell', character: 'harpooner', rank: 4, name: 'Bell Kit', start: 'tide_bell', desc: 'Start with the Tide Bell instead of the Anchor Chain.' },
  { id: 'punter_picks', character: 'punter', rank: 4, name: 'Pick Kit', start: 'ice_picks', desc: 'Start with the Ice Picks instead of the Glass Caltrops.' },
  { id: 'bog_warden_brine', character: 'bog_warden', rank: 4, name: 'Brine Kit', start: 'brine_spring', desc: 'Start with the Brine Spring instead of the Eel Pot.' },
  // 0.9.0 (W5): mastery rank 2 opens a second kit for each character.
  { id: 'lamplighter_mirror', character: 'lamplighter', rank: 2, name: 'Mirror Kit', start: 'signal_mirror', desc: 'Start with the Signal Mirror instead of the Flare Gun.' },
  { id: 'harpooner_rod', character: 'harpooner', rank: 2, name: 'Rod Kit', start: 'lightning_rod', desc: 'Start with the Lightning Rod instead of the Anchor Chain.' },
  { id: 'punter_anchor', character: 'punter', rank: 2, name: 'Anchor Kit', start: 'anchor_chain', desc: 'Start with the Anchor Chain instead of the Glass Caltrops.' },
  { id: 'bog_warden_candles', character: 'bog_warden', rank: 2, name: 'Candle Kit', start: 'corpse_candles', desc: 'Start with the Corpse Candles instead of the Eel Pot.' },
  // 0.9.0 (W2): the two new characters' kits (rank 2 and rank 4).
  { id: 'drowned_man_flask', character: 'drowned_man', rank: 2, name: 'Ice Kit', start: 'ice_picks', desc: 'Start with the Ice Picks instead of the Oil Flask.' },
  { id: 'drowned_man_glass', character: 'drowned_man', rank: 4, name: 'Fog Horn Kit', start: 'fog_horn', desc: 'Start with the Fog Horn instead of the Oil Flask.' },
  { id: 'tide_priest_spring', character: 'tide_priest', rank: 2, name: 'Eel Kit', start: 'eel_pot', desc: 'Start with the Eel Pot instead of the Corpse Candles.' },
  { id: 'tide_priest_rod', character: 'tide_priest', rank: 4, name: 'Storm Kit', start: 'lightning_rod', desc: 'Start with the Lightning Rod instead of the Corpse Candles.' },
  // The weapon orders (data/feats.js group 'weapon'): each opens its weapon as a starting kit for
  // every character (character '*').
  ...[['flare_gun', 'Flare Gun'], ['lantern_orb', 'Lantern Orb'], ['harpoon_chain', 'Harpoon Chain'], ['tide_bell', 'Tide Bell'],
    ['signal_mirror', 'Signal Mirror'], ['oil_flask', 'Oil Flask'], ['lightning_rod', 'Lightning Rod'], ['corpse_candles', 'Corpse Candles'],
    ['brine_spring', 'Brine Spring'], ['ice_picks', 'Ice Picks'], ['fog_horn', 'Fog Horn'], ['eel_pot', 'Eel Pot'],
    ['anchor_chain', 'Anchor Chain'], ['glass_caltrops', 'Glass Caltrops']]
    .map(([w, n]) => ({ id: `any_${w}`, character: '*', name: `${n} Kit`, start: w, desc: `Any character can start with the ${n}.`, unlock: `feat:kit_${w}` })),
];
