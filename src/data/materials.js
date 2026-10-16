// Materials: what runs bring home to rebuild the harbor (ARCHITECTURE §10.3, §10.5).
// IDs are permanent (saves reference them). `maps` lists where each drops; coin and oil drop
// on every map. `rare` materials come from elites and bosses only (the content test holds them
// to it). The Salt Marsh's and the Sunken Chapel's are here before their maps are, with no
// source yet; nothing costs them until then.

export const MATERIALS = [
  { id: 'coin', name: 'Coin', desc: 'Tarnished coins from the tide line.', icon: 'mat_coin', maps: ['*'] },
  { id: 'oil', name: 'Oil', desc: 'Lamp oil. Lamp Post burns it.', icon: 'mat_oil', maps: ['*'] },
  { id: 'timber', name: 'Timber', desc: 'Waterlogged planks, still good.', icon: 'mat_timber', maps: ['drowned_docks'] },
  { id: 'rope', name: 'Rope', desc: 'Salt-stiff rope.', icon: 'mat_rope', maps: ['drowned_docks'] },
  { id: 'drowned_pages', name: 'Drowned Pages', desc: 'Ledger pages the sea gave back.', icon: 'mat_pages', maps: ['drowned_docks'] },
  { id: 'rum', name: 'Rum', desc: 'Sealed bottles. Tavern wants them.', icon: 'mat_rum', maps: ['drowned_docks'] },
  { id: 'iron', name: 'Iron', desc: 'Salvage from wrecks.', icon: 'mat_iron', maps: ['drowned_docks'], rare: true },
  { id: 'map_scraps', name: 'Map Scraps', desc: 'Torn corners of old charts.', icon: 'mat_scraps', maps: ['*'], rare: true },
  { id: 'marsh_herbs', name: 'Marsh Herbs', desc: 'Bitter leaves from the Salt Marsh.', icon: 'mat_herbs', maps: ['salt_marsh'] },
  { id: 'salt_glass', name: 'Salt Glass', desc: 'Glass fused by lightning on the salt flats.', icon: 'mat_saltglass', maps: ['salt_marsh'] },
  { id: 'bone', name: 'Bone', desc: 'From the Sunken Chapel. Best not to ask.', icon: 'mat_bone', maps: ['sunken_chapel'] },
  { id: 'candles', name: 'Candles', desc: 'Chapel candles that still light.', icon: 'mat_candles', maps: ['sunken_chapel'] },
];
