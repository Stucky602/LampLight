// Relics (ARCHITECTURE §5.11, §5.12): rare picks that change the rules. Each names a hook in
// src/sim/hooks.js plus its parameters. They come from elite and boss chests and the rare relic
// card in the draft.

export const RELICS = [
  {
    id: 'volatile_gems', name: 'Volatile Gems', desc: 'XP gems explode when collected.', icon: 'relic_volatile_gems',
    rarity: 3, unlock: 'research:volatile_salts', weight: 100,
    hook: 'gem_explode', params: { damage: 12, radius: 26, every: 0.1 },
  },
  {
    id: 'glass_lantern', name: 'Glass Lantern', desc: 'Healing becomes a shield instead, up to 50% of Max HP.', icon: 'relic_glass_lantern',
    rarity: 2, unlock: 'building:tavern:5', weight: 100,
    hook: 'heal_to_shield', params: { capFraction: 0.5 },
  },
  {
    id: 'reapers_wake', name: "Reaper's Wake", desc: 'Kills made while dashing drop double XP.', icon: 'relic_reapers_wake',
    rarity: 2, unlock: 'building:tavern:4', weight: 100,
    hook: 'dash_double_xp', params: { mul: 2 },
  },
  {
    id: 'seventh_bell', name: 'Seventh Bell', desc: 'Every 7th level-up evolves each weapon that can evolve. No chest needed.', icon: 'relic_seventh_bell',
    rarity: 3, unlock: 'building:tavern:3', weight: 80,
    hook: 'free_evolution_every', params: { every: 7 },
  },
  {
    // Found, not bought: the cache in the Drowned Docks' wreck (data/maps.js secrets) gives it,
    // and finding it once puts it in the relic pool for good.
    id: 'wreck_lantern', name: 'Wreck Lantern', desc: 'Every 5th kill leaves burning oil on the ground.', icon: 'relic_wreck_lantern',
    rarity: 3, unlock: 'secret:wreck_cache', weight: 80,
    hook: 'kill_fire_pool', params: { every: 5, radius: 18, duration: 3, damage: 4, interval: 0.4, dps: 3, burn: 1.2 },
  },
  {
    id: 'tide_clock', name: 'Tide Clock', desc: 'Every 45s, a wave knocks back nearby enemies.', icon: 'relic_tide_clock',
    rarity: 2, unlock: 'building:tavern:2', weight: 100,
    hook: 'timed_wave', params: { every: 45, radius: 170, damage: 20, knockback: 4 },
  },
];
