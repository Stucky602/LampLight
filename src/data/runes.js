// Runes (ARCHITECTURE §5.8): patches on a weapon's pipeline that change behavior, not numbers.
// Each weapon has 2 sockets. validOn lists the emitters a rune works with; invalid pairs are
// never offered.
//
// patch keys:
//   onHitAppend: effects added to the weapon's on-hit list
//   emit / motion: replace the emitter or motion ("orbits you instead of firing")
//   mirror: true fires a second copy of every shot straight backward ("fires backward too")
//   base: weapon numbers the new behavior needs (set, not added: an orbit needs a hit cooldown)

export const RUNES = [
  {
    id: 'splitting', name: 'Splitting', desc: 'Shots split in 2 on hit.', icon: 'rune_splitting', rarity: 2, unlock: 'starter', weight: 100,
    validOn: { emit: ['nearest', 'facing', 'radial', 'strike'] },
    patch: { onHitAppend: [{ type: 'split', count: 2, damageMul: 0.5, spread: 50 }] },
  },
  {
    id: 'burning_ground', name: 'Burning Ground', desc: 'Hits leave burning ground.', icon: 'rune_burning', rarity: 2, unlock: 'starter', weight: 100,
    validOn: { emit: ['nearest', 'facing', 'radial', 'orbit', 'strike', 'drop', 'wave', 'beam', 'summon'] },
    patch: { onHitAppend: [{ type: 'zone', radius: 14, duration: 2.5, damage: 3, interval: 0.4, every: 0.3, status: { status: 'burn', dps: 3, duration: 1.2 } }] },
  },
  {
    id: 'orbiting', name: 'Orbiting', desc: 'Shots orbit you instead of flying off.', icon: 'rune_orbiting', rarity: 3, unlock: 'research:rune_stones', weight: 80,
    validOn: { emit: ['nearest', 'facing', 'radial'] },
    patch: {
      emit: { type: 'orbit', radius: 44 },
      motion: { type: 'orbit', angularSpeed: 3 },
      base: { hitCooldown: 0.5, pierce: -1, duration: 2.5 },
    },
  },
  {
    id: 'backfire', name: 'Backfire', desc: 'Fires backward too.', icon: 'rune_backfire', rarity: 1, unlock: 'research:reversed_runes', weight: 100,
    validOn: { emit: ['nearest', 'facing', 'radial'] },
    patch: { mirror: true },
  },
  {
    id: 'chain_link', name: 'Chain Link', desc: 'Hits chain to 3 nearby enemies.', icon: 'rune_chain', rarity: 2, unlock: 'research:rune_stones', weight: 100,
    validOn: { emit: ['nearest', 'facing', 'radial', 'orbit', 'beam', 'summon'] }, // not strike: Lightning Rod already jumps
    patch: { onHitAppend: [{ type: 'chain', hops: 3, range: 90, damageMul: 0.7 }] },
  },
];
