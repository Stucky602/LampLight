// Relics (ARCHITECTURE §5.11, §5.12, §10.8): what you carry through a run besides weapons and
// passives. They take relic slots (0.9.0, ruling 4: 3, plus 1 for each Docks level past 2, to 6;
// world.build.relicSlots), and a pick with the slots full gives one up for it, which goes back to
// the Ferryman's stock (sim/relics.js). They never come from level-ups or chests: a Reliquary (a rare drop from ordinary enemies) offers three to pick from, so does
// the vault Lantern Night opens, and the Ferryman sells them for Pearls. A map's secret cache
// holds its own. A fresh profile's pool holds four (0.8.2: two Trinkets and two plain Charms'
// worth: Gull Feather, Brass Button, Spark Flint, Tide Clock), so its first Reliquaries have
// something to offer and the pool lasts past the first minutes.
//
// tier: 1 Trinket (small and steady), 2 Charm (changes a habit), 3 Relic (changes the run). What
// a Reliquary offers leans on the run's time (data/tuning.js relics.tierWeights): Trinkets early,
// Relics late, so a run can end strong without starting there.
//
// Each names a hook in src/sim/hooks.js plus its parameters, or `mods` (stat modifiers, as a
// passive's), or both. Actives hang off something you do: walking, standing still, a hit taken, a
// kill streak, or a clock. Never the dash (ruling 16: the dash is an escape and nothing else).
// Some Relics carry a price (0.9.0, ruling 4): `downside` is that part of the description, as a
// stat line, for a card to show on its own line; the price itself is in `mods`.

export const RELIC_TIERS = Object.freeze({ 1: 'Trinket', 2: 'Charm', 3: 'Relic' });

export const RELICS = [
  // ---------------------------------------------------------------- Trinkets
  {
    id: 'gull_feather', name: 'Gull Feather', desc: '+8% Move Speed.', icon: 'relic_gull_feather',
    tier: 1, unlock: 'starter', weight: 100,
    mods: [{ stat: 'moveSpeed', op: 'pct', value: 0.08 }],
  },
  {
    id: 'brass_button', name: 'Brass Button', desc: '+6% Damage.', icon: 'relic_brass_button',
    tier: 1, unlock: 'starter', weight: 100,
    mods: [{ stat: 'might', op: 'pct', value: 0.06 }],
  },
  {
    id: 'spark_flint', name: 'Spark Flint', desc: 'Every 4s while moving, a burst of sparks goes off underfoot.', icon: 'relic_spark_flint',
    tier: 1, unlock: 'starter', weight: 100,
    hook: 'walk_burst', params: { damage: 18, radius: 30, knockback: 1.2, every: 4 },
  },
  // ---------------------------------------------------------------- Charms
  {
    id: 'tide_clock', name: 'Ship\'s Clock', desc: 'Every 45s, a wave knocks back nearby enemies.', icon: 'relic_tide_clock',
    tier: 2, unlock: 'starter', weight: 100,
    hook: 'timed_wave', params: { every: 45, radius: 170, damage: 20, knockback: 4 },
  },
  {
    id: 'reapers_wake', name: "Dead Calm", desc: 'Kills made while standing still drop double XP.', icon: 'relic_reapers_wake',
    tier: 2, unlock: 'building:tavern:4', weight: 100,
    hook: 'still_double_xp', params: { mul: 2 },
  },
  {
    id: 'glass_lantern', name: 'Glass Lantern', desc: 'Healing becomes a shield instead, up to 50% of Max HP.', icon: 'relic_glass_lantern',
    tier: 2, unlock: 'building:tavern:5', weight: 100,
    hook: 'heal_to_shield', params: { capFraction: 0.5 },
  },
  {
    id: 'barnacle_shell', name: 'Barnacle Shell', desc: 'Taking a hit sends out a wave that knocks enemies back. Once every 6s.', icon: 'relic_barnacle_shell',
    tier: 2, unlock: 'research:deep_salvage', weight: 100,
    hook: 'hurt_wave', params: { radius: 110, damage: 25, knockback: 5, cooldown: 6 },
  },
  {
    id: 'bloodied_hook', name: 'Bloodied Hook', desc: 'While 15 or more enemies are close, +30% Damage.', icon: 'relic_bloodied_hook',
    tier: 2, unlock: 'feat:bell_ringer', weight: 100,
    hook: 'crowd_fury', params: { count: 15, radius: 90, damage: 0.3 },
  },
  // ---------------------------------------------------------------- Relics
  {
    id: 'seventh_bell', name: 'Seventh Bell', desc: 'Every 7th level-up gives an Ember. -10% XP Gain.', icon: 'relic_seventh_bell',
    tier: 3, unlock: 'building:tavern:3', weight: 80, downside: '-10% XP Gain',
    hook: 'ember_every', params: { every: 7 }, mods: [{ stat: 'growth', op: 'pct', value: -0.1 }],
  },
  {
    id: 'volatile_gems', name: 'Volatile Gems', desc: 'XP gems explode when collected. -25% Pickup Range.', icon: 'relic_volatile_gems',
    tier: 3, unlock: 'research:volatile_salts', weight: 100, downside: '-25% Pickup Range', mods: [{ stat: 'magnet', op: 'pct', value: -0.25 }],
    hook: 'gem_explode', params: { damage: 12, radius: 26, every: 0.1 },
  },
  {
    // Found, not bought: the cache in the Drowned Docks' wreck (data/maps.js secrets) gives it,
    // and finding it once puts it in the relic pool for good.
    id: 'wreck_lantern', name: 'Wreck Lantern', desc: 'Every 2s, burning oil spills under the nearest enemy.', icon: 'relic_wreck_lantern',
    tier: 3, unlock: 'secret:wreck_cache', weight: 80,
    hook: 'timed_pool', params: { every: 2, radius: 18, duration: 3, damage: 4, interval: 0.4, dps: 3, burn: 1.2, reach: 220 },
  },
  {
    id: 'drowned_bell', name: 'Drowned Bell', desc: 'Every 6s, the bell tolls and hits enemies near you for 40 damage. -10% Move Speed.', icon: 'relic_drowned_bell',
    tier: 3, unlock: 'research:lantern_lore', weight: 90, downside: '-10% Move Speed', mods: [{ stat: 'moveSpeed', op: 'pct', value: -0.1 }],
    hook: 'timed_wave', params: { every: 6, radius: 200, damage: 40, knockback: 2 },
  },

  // ---------------------------------------------------------------- the Salt Marsh (0.8.0)
  // Each one's hook takes back what it did if it's given to
  // the Salt Well (sim/hooks.js undo).
  {
    id: 'sea_urchin', name: 'Sea Urchin', desc: 'Enemies that hit you take damage: 6 for each point of Armor.', icon: 'relic_sea_urchin',
    tier: 1, unlock: 'feat:brittle_tide', weight: 100,
    hook: 'sea_urchin', params: { mul: 6 },
  },
  {
    id: 'quench_bucket', name: 'Quench Bucket', desc: 'A Sea or Frost hit on a burning enemy puts the fire out. The rest of the burn hits at once, on it and the enemies touching it.', icon: 'relic_quench_bucket',
    tier: 2, unlock: 'feat:quencher', weight: 100,
    hook: 'quench_bucket', params: { mul: 1, reach: 10 },
  },
  {
    id: 'cold_iron', name: 'Cold Iron', desc: 'A Steel kill on a slowed or frozen enemy shatters it into 4 shards that slow enemies they hit.', icon: 'relic_cold_iron',
    tier: 2, unlock: 'research:anchor_smithing', weight: 100,
    hook: 'cold_iron', params: { count: 4, damage: 12, slow: 0.4 },
  },
  {
    id: 'watchmans_rattle', name: "Watchman's Rattle", desc: 'When 15 or more enemies have been close for 2s, every weapon fires at once. Again once the crowd drops under 8.', icon: 'relic_watchmans_rattle',
    tier: 2, unlock: 'feat:watchman', weight: 100,
    hook: 'watchmans_rattle', params: { count: 15, sec: 2, reset: 8, radius: 60 },
  },
  {
    id: 'try_pot', name: 'Try-Pot', desc: 'After a skip, the next level-up offers only things you own, and the one you pick gains 2 levels.', icon: 'relic_try_pot',
    tier: 2, unlock: 'research:fowlers_calls', weight: 100,
    hook: 'try_pot', params: { levels: 2 },
  },
  {
    id: 'brine_vat', name: 'Brine Vat', desc: 'Slows add together, up to 80%. An enemy slowed 80% for 1s turns to salt for 4s, then dies (not bosses or captains). -15 Max HP.', icon: 'relic_brine_vat',
    tier: 3, unlock: 'research:salting_ledger', weight: 90, downside: '-15 Max HP', mods: [{ stat: 'maxHp', op: 'add', value: -15 }],
    hook: 'brine_vat', params: { cap: 0.8, holdSec: 1, saltSec: 4 },
  },
  {
    // Found, not bought: the bog body on the Drowned Causeway's island (the Salt Marsh's secret).
    id: 'bog_torc', name: 'Bog Torc', desc: 'Once a run, instead of dying: for 4s nothing can hurt you and enemies that touch you rot. Then you get up at 40% HP.', icon: 'relic_bog_torc',
    tier: 3, unlock: 'secret:drowned_causeway', weight: 80,
    hook: 'bog_torc', params: { sinkSec: 4, riseHp: 0.4, rotSec: 3, rotAmp: 0.3, radius: 24 },
  },
  // ---------------------------------------------------------------- once arcana (the sweep, ruling 11)
  // Arcana were relics picked at the gate. These five had code of their own and are relics now; the
  // other nine were a relic's rule with bigger numbers, and went (meta/retired.js maps each to its
  // relic for a save). Their unlock keys are the ones the arcana had, so what a profile opened stays open.
  {
    id: 'moon_pull', name: 'Moon Pull', desc: 'Every 60s, every gem on the map flies to you.', icon: 'arcana_high_water',
    tier: 2, unlock: 'research:moon_tables', weight: 100,
    hook: 'gem_vacuum', params: { every: 60 },
  },
  {
    id: 'brine', name: 'Sea Rite', desc: 'Kills by Sea weapons heal you 1 HP, up to 3 a second.', icon: 'arcana_brine',
    tier: 2, unlock: 'research:brine_rites', weight: 100,
    hook: 'sea_heal', params: { heal: 1, perSecond: 3 },
  },
  {
    id: 'kindling', name: 'Kindling', desc: 'Elites drop an Ember twice as often, and bosses drop 2.', icon: 'arcana_kindling',
    tier: 3, unlock: 'feat:lamp_only', weight: 80,
    hook: 'ember_luck', params: { eliteMul: 2, bossExtra: 1 },
  },
  {
    id: 'glassblower', name: 'Glassblower', desc: 'Relics are offered one rarity higher. -15% Max HP.', icon: 'arcana_glassblower',
    tier: 3, unlock: 'feat:lantern_night', weight: 80, downside: '-15% Max HP', mods: [{ stat: 'maxHp', op: 'pct', value: -0.15 }],
    hook: 'relic_tier', params: { tiers: 1 },
  },
  {
    id: 'long_beam', name: 'Gleaner\'s Sack', desc: 'Every 30s, every gem on the map flies to you. -10% Damage.', icon: 'arcana_high_water',
    tier: 3, unlock: 'building:lighthouse:3', weight: 80, downside: '-10% Damage', mods: [{ stat: 'might', op: 'pct', value: -0.1 }],
    hook: 'gem_vacuum', params: { every: 30 },
  },
  // What the runes became (ruling 14: Rare and better is behavior, and runes are gone). The two
  // status runes fit every weapon, which is what a relic is; the other four keys that opened a rune
  // open a relic about the new growth: milestones, deeds, rerolls, and where you stand.
  // `rule`: a rule the whole build carries while the relic is held (world.rules, sim/build.js).
  {
    id: 'tarred', name: 'Tarred', desc: 'Hits coat enemies in tar for 4s. A hit from another weapon bursts the tar, for 50% of the hit that put it there.', icon: 'rune_tarred',
    tier: 2, unlock: 'research:ice_house', weight: 100, rule: 'tarred',
  },
  {
    id: 'marsh_fever', name: 'Marsh Fever', desc: 'Hits give a fever for 3s: the enemy takes 10% more damage. A fevered enemy passes its burn, rot, and slow to one it bumps into.', icon: 'rune_marsh_fever',
    tier: 2, unlock: 'feat:marsh_dawn', weight: 100, rule: 'marshfever',
  },
  {
    id: 'whetstone', name: 'Whetstone', desc: 'Every 2nd level-up of a weapon is Rare or better, not every 3rd.', icon: 'rune_chain',
    tier: 2, unlock: 'research:rune_stones', weight: 100, rule: 'whetstone',
  },
  {
    id: 'stern_lantern', name: 'Stern Lantern', desc: 'Hits on enemies behind you deal 25% more damage.', icon: 'rune_backfire',
    tier: 1, unlock: 'research:reversed_runes', weight: 100, rule: 'stern',
  },
  {
    id: 'stray_light', name: 'Stray Light', desc: 'Final Form goals count double.', icon: 'rune_familiar',
    tier: 2, unlock: 'feat:lost_lights', weight: 100, rule: 'lostlight',
  },
  {
    id: 'salt_ledger', name: 'Salt Ledger', desc: 'Every chest from an elite or a boss also gives a Reroll.', icon: 'rune_spillway',
    tier: 1, unlock: 'research:salting_ledger', weight: 100, rule: 'saltledger',
  },
];
