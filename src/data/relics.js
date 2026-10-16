// Relics (ARCHITECTURE §5.11, §5.12, §10.8): what you carry through a run besides weapons and
// passives. You keep every one you find (there are no slots) and they never come from level-ups
// or chests: a Reliquary (a rare drop from ordinary enemies) offers three to pick from, so does
// the vault Lantern Night opens, and the Ferryman sells them for Sea Glass. A map's secret cache
// holds its own.
//
// tier: 1 Trinket (small and steady), 2 Charm (changes a habit), 3 Relic (changes the run). What
// a Reliquary offers leans on the run's time (data/tuning.js relics.tierWeights): Trinkets early,
// Relics late, so a run can end strong without starting there.
//
// Each names a hook in src/sim/hooks.js plus its parameters, or `mods` (stat modifiers, as a
// passive's), or both. Actives hang off something you do: a dash, a hit taken, a kill streak.

export const RELIC_TIERS = Object.freeze({ 1: 'Trinket', 2: 'Charm', 3: 'Relic' });

export const RELICS = [
  // ---------------------------------------------------------------- Trinkets
  {
    id: 'gull_feather', name: 'Gull Feather', desc: '-12% Dash Cooldown.', icon: 'relic_gull_feather',
    tier: 1, unlock: 'starter', weight: 100,
    mods: [{ stat: 'dashCooldown', op: 'pct', value: -0.12 }],
  },
  {
    id: 'brass_button', name: 'Brass Button', desc: '+6% Damage.', icon: 'relic_brass_button',
    tier: 1, unlock: 'starter', weight: 100,
    mods: [{ stat: 'might', op: 'pct', value: 0.06 }],
  },
  {
    id: 'spark_flint', name: 'Spark Flint', desc: 'Starting a dash sets off a burst of sparks where you stood.', icon: 'relic_spark_flint',
    tier: 1, unlock: 'research:drowned_charms', weight: 100,
    hook: 'dash_burst', params: { damage: 18, radius: 30, knockback: 1.2 },
  },
  // ---------------------------------------------------------------- Charms
  {
    id: 'tide_clock', name: 'Tide Clock', desc: 'Every 45s, a wave knocks back nearby enemies.', icon: 'relic_tide_clock',
    tier: 2, unlock: 'building:tavern:2', weight: 100,
    hook: 'timed_wave', params: { every: 45, radius: 170, damage: 20, knockback: 4 },
  },
  {
    id: 'reapers_wake', name: "Reaper's Wake", desc: 'Kills made while dashing drop double XP.', icon: 'relic_reapers_wake',
    tier: 2, unlock: 'building:tavern:4', weight: 100,
    hook: 'dash_double_xp', params: { mul: 2 },
  },
  {
    id: 'glass_lantern', name: 'Glass Lantern', desc: 'Healing becomes a shield instead, up to 50% of Max HP.', icon: 'relic_glass_lantern',
    tier: 2, unlock: 'building:tavern:5', weight: 100,
    hook: 'heal_to_shield', params: { capFraction: 0.5 },
  },
  {
    id: 'barnacle_shell', name: 'Barnacle Shell', desc: 'Taking a hit sends out a wave that throws enemies back. Once every 6s.', icon: 'relic_barnacle_shell',
    tier: 2, unlock: 'research:deep_salvage', weight: 100,
    hook: 'hurt_wave', params: { radius: 110, damage: 25, knockback: 5, cooldown: 6 },
  },
  {
    id: 'bloodied_hook', name: 'Bloodied Hook', desc: '40 kills within 8s gives +30% Damage for 6s.', icon: 'relic_bloodied_hook',
    tier: 2, unlock: 'feat:bell_ringer', weight: 100,
    hook: 'streak_fury', params: { kills: 40, within: 8, damage: 0.3, duration: 6 },
  },
  // ---------------------------------------------------------------- Relics
  {
    id: 'seventh_bell', name: 'Seventh Bell', desc: 'Every 7th level-up evolves each weapon that can evolve. No chest needed.', icon: 'relic_seventh_bell',
    tier: 3, unlock: 'building:tavern:3', weight: 80,
    hook: 'free_evolution_every', params: { every: 7 },
  },
  {
    id: 'volatile_gems', name: 'Volatile Gems', desc: 'XP gems explode when collected.', icon: 'relic_volatile_gems',
    tier: 3, unlock: 'research:volatile_salts', weight: 100,
    hook: 'gem_explode', params: { damage: 12, radius: 26, every: 0.1 },
  },
  {
    // Found, not bought: the cache in the Drowned Docks' wreck (data/maps.js secrets) gives it,
    // and finding it once puts it in the relic pool for good.
    id: 'wreck_lantern', name: 'Wreck Lantern', desc: 'Every 5th kill leaves burning oil on the ground.', icon: 'relic_wreck_lantern',
    tier: 3, unlock: 'secret:wreck_cache', weight: 80,
    hook: 'kill_fire_pool', params: { every: 5, radius: 18, duration: 3, damage: 4, interval: 0.4, dps: 3, burn: 1.2 },
  },
  {
    id: 'drowned_bell', name: 'Drowned Bell', desc: 'Every 30 kills, the bell tolls and hits everything near you for 40 damage.', icon: 'relic_drowned_bell',
    tier: 3, unlock: 'research:lantern_lore', weight: 90,
    hook: 'kill_toll', params: { every: 30, radius: 200, damage: 40, knockback: 2 },
  },
];
