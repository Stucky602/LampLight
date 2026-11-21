// How a weapon's capstone shows (C3, ruling 14 C9: "every capstone has a look"). Pure data, read by
// render/runview.js. A capstone option changes what its weapon leaves behind; this gives each of
// the forty its own mark on screen, so two players who chose differently can tell from across the
// room:
//   - shots that fly (flares, harpoons, picks, pennies, eels, orbs, flames, glass) trail sparks of
//     the capstone's color and shape;
//   - a wave's ring (Tide Bell, King Tide), a light's rim (Lamplight), and a beam (Signal Mirror,
//     Punt Pole) take its color;
//   - a strike (Lightning Rod, Bog Hands) throws sparks of its color where it lands.
// The weapon's own data may also give a capstone a sprite (data/ascensions.js `look`); this adds to
// that and never replaces it. Colors are palette names; `frame` is a particle frame (DOT, SPARK,
// PLUS, RING; render/viewstate.js PF_FRAME). The two capstones of one weapon never share both.

export const CAPSTONE_LOOK = Object.freeze({
  // Flare Gun: a flare that hangs and rains white sparks, or one that leaves burning phosphor.
  hanging_flare: { color: 'lamp-6', frame: 'SPARK' }, phosphor: { color: 'lamp-4', frame: 'DOT' },
  // Lantern Orb: small lanterns (the ward's plus), or sun fire.
  wards: { color: 'lamp-5', frame: 'PLUS' }, sunfire: { color: 'lamp-4', frame: 'SPARK' },
  // Harpoon Chain: the chain's pale glint, or the dead weight's dark iron.
  tether: { color: 'fog-5', frame: 'DOT' }, dead_weight: { color: 'fog-2', frame: 'SPARK' },
  // Tide Bell: an icy wave, or a knell's violet.
  riptide: { color: 'gem-4' }, death_knell: { color: 'violet-4' },
  // Signal Mirror: a burning beam, or a dazzling white one.
  burning_glass: { color: 'lamp-4' }, dazzle: { color: 'lamp-6' },
  // Oil Flask: a fuse's sparks, or tarry drops of pitch.
  fuel_line: { color: 'lamp-4', frame: 'SPARK' }, pitch: { color: 'wood-4', frame: 'DOT' },
  // Lightning Rod: a blue static crackle, or a white clap.
  static: { color: 'gem-3', frame: 'SPARK' }, thunderclap: { color: 'lamp-6', frame: 'PLUS' },
  // Corpse Candles: a vigil's warm light, or consumption's rot.
  vigil: { color: 'lamp-5', frame: 'DOT' }, consumption: { color: 'moss-4', frame: 'DOT' },
  // Brine Spring: salt crust, or a brinicle's ice.
  salt_crust: { color: 'fog-5', frame: 'PLUS' }, brinicle: { color: 'gem-4', frame: 'SPARK' },
  // Ice Picks: rime, or shattered glass.
  rime: { color: 'gem-4', frame: 'SPARK' }, shatter: { color: 'fog-5', frame: 'PLUS' },
  // Fulgurite: glass glints, or a closed circuit's violet.
  glass_spikes: { color: 'fog-5', frame: 'SPARK' }, closed_circuit: { color: 'violet-4', frame: 'DOT' },
  // Eel Pot: the conger's sea green, or a feeding frenzy's rot green.
  conger: { color: 'sea-6', frame: 'DOT' }, feeding_frenzy: { color: 'moss-4', frame: 'SPARK' },
  // Anchor Chain: deep iron, or dredged water.
  deep_anchor: { color: 'fog-3', frame: 'PLUS' }, dredge: { color: 'sea-5', frame: 'DOT' },
  // Glass Caltrops: glass that bursts, or the violet of a hamstring's slow.
  shatterfield: { color: 'fog-5', frame: 'SPARK' }, hamstring: { color: 'violet-4', frame: 'DOT' },
  // The signatures (C2's options).
  wardlight: { color: 'lamp-6' }, dread_light: { color: 'violet-4' },
  flense: { color: 'lamp-6', frame: 'SPARK' }, keelhaul: { color: 'sea-5', frame: 'DOT' },
  bow_wave: { color: 'sea-6' }, breakwater: { color: 'gem-3' },
  bog_kin: { color: 'moss-4', frame: 'DOT' }, peat_fire: { color: 'lamp-4', frame: 'SPARK' },
  pennies_on_the_eyes: { color: 'lamp-5', frame: 'SPARK' }, weighed_down: { color: 'fog-3', frame: 'DOT' },
  high_water_mark: { color: 'gem-3' }, drowning_tide: { color: 'violet-4' },
  // Fog Horn (ruling 18 WD): its wave rolls out as grey fog, or as a wrecker's false lamp.
  fog_bank: { color: 'fog-5', frame: 'RING' }, wreckers_horn: { color: 'lamp-5', frame: 'SPARK' },
});

/** The capstone look of a slot's held options, or null: { color, frame } (palette name and PF_FRAME key). */
export function capstoneLook(ascensions) {
  if (!ascensions) return null;
  for (const a of ascensions) if (a && a.capstone && CAPSTONE_LOOK[a.id]) return CAPSTONE_LOOK[a.id];
  return null;
}
