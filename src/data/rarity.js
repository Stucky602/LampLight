// The five rarities (ruling 10, Kevin, Nov 8): one vocabulary for the game. A weapon's rolled
// upgrade (W1b) and a Smithy gear tier (1 to 5, data/gear.js) are named and colored from here.
// `color` is a palette name (data/palette.js). The color is a frame only: every screen shows the
// word too, so the color never carries the meaning alone.

export const RARITIES = Object.freeze([
  Object.freeze({ id: 'common', name: 'Common', color: 'fog-4' }),
  Object.freeze({ id: 'uncommon', name: 'Uncommon', color: 'moss-3' }),
  Object.freeze({ id: 'rare', name: 'Rare', color: 'sea-4' }),
  Object.freeze({ id: 'epic', name: 'Epic', color: 'violet-3' }),
  Object.freeze({ id: 'legendary', name: 'Legendary', color: 'lamp-4' }),
]);

/** A gear tier's rarity (tier 1 is Common, tier 5 Legendary). */
export function rarityOfTier(tier) {
  return RARITIES[Math.max(1, Math.min(RARITIES.length, Math.floor(Number(tier) || 1))) - 1];
}
