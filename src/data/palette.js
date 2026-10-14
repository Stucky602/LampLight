// The game palette (ARCHITECTURE §16.3, §16.4). Every color on screen comes from here: sprites,
// effects, the HUD, and the menus (src/ui/ui.css mirrors the names it uses; a test keeps the two
// in step). Phase 4 remaps the art packs into this palette.
//
// Readability rules: the player is warm and brightest; enemies are cool and desaturated; XP
// gems are bright cyan; projectiles are warm and light; hazards are red-orange; the ground is
// darker and lower-contrast than every actor.

export const PALETTE = Object.freeze({
  // Night: the ground, panels, outlines.
  'night-0': '#07080d', 'night-1': '#0d1018', 'night-2': '#141925', 'night-3': '#1c2331',
  'night-4': '#262f42', 'night-5': '#34405a',
  // Fog: enemies, steel, text.
  'fog-1': '#4a5670', 'fog-2': '#6b7892', 'fog-3': '#95a3b9', 'fog-4': '#bcc6d4', 'fog-5': '#e2e8ef',
  // Lamp: the player, projectiles, light.
  'lamp-1': '#3a1d10', 'lamp-2': '#6b3413', 'lamp-3': '#da8229', 'lamp-4': '#f3b049', 'lamp-5': '#ffd98a',
  'lamp-6': '#fff4d2',
  // Sea: drowned things, tide weapons.
  'sea-1': '#0f2a33', 'sea-2': '#17424d', 'sea-3': '#1f6068', 'sea-4': '#2f8a86', 'sea-5': '#58b8a8',
  'sea-6': '#9fe0cf',
  // Rot (the red family, not the Rot tag): hazards, damage, health (the heart, the HP bar), the
  // Harpooner's coat.
  'rot-1': '#3b1414', 'rot-2': '#a8322a', 'rot-3': '#dc5638', 'rot-4': '#f08a5d',
  // Gem: experience.
  'gem-1': '#1d5d7a', 'gem-2': '#2fa3c9', 'gem-3': '#6fe0ff', 'gem-4': '#d4fbff',
  // Moss: healing numbers, herbs, and the Rot tag's color.
  'moss-1': '#26331f', 'moss-2': '#3f5a2c', 'moss-3': '#6c8f3c', 'moss-4': '#a7c957',
  // Violet: relics, runes, the echo tag, lantern eaters.
  'violet-1': '#2b1f3f', 'violet-2': '#4d3474', 'violet-3': '#7d5bb0', 'violet-4': '#b79be0',
  // Skin: faces and hands (the characters, and the hub's townsfolk).
  'skin-1': '#9b5b3e', 'skin-2': '#dd9a6a', 'skin-3': '#f5c690',
  // Wood: props, shafts, hair, chests, and (in the hub) buildings.
  'wood-1': '#2a1a12', 'wood-2': '#4a2f1f', 'wood-3': '#70482e', 'wood-4': '#9c6c44',
  white: '#ffffff',
});

/** Tag colors, for card borders and icon frames. */
export const TAG_COLORS = Object.freeze({
  light: 'lamp-5', fire: 'lamp-3', tide: 'sea-5', steel: 'fog-4', echo: 'violet-4', frost: 'gem-3', rot: 'moss-3',
});

/** '#rrggbb' to 0xrrggbb. */
export function hexToInt(hex) {
  return parseInt(String(hex).slice(1), 16);
}

/** A palette name to 0xrrggbb; throws on a name the palette doesn't have. */
export function color(name) {
  const hex = PALETTE[name];
  if (!hex) throw new Error(`No palette color "${name}"`);
  return hexToInt(hex);
}
