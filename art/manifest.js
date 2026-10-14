// The sprite manifest (ARCHITECTURE §16.3): every frame in the atlas, where it comes from, and
// how it is colored. tools/atlas/build.mjs reads this with the art packs and writes
// src/assets/atlas.png and atlas.json. The packs themselves are never committed (they stay in
// Claude's workspace; Kevin re-attaches them if it's wiped).
//
// Kevin's ruling (Sep 27 2026): the Kenney 1-Bit Pack for everything in runs (enemies, props,
// the run map), and Kenney Tiny Dungeon + Tiny Town for the player, every playable character,
// the hub's buildings, and its townsfolk. Everything is remapped into src/data/palette.js.
//
// Sources:
//   { pack, tile }   a 16 x 16 tile from a pack's packed sheet (row-major index, as in the
//                    contact sheets: 1-Bit Pack 49 across, Tiny Dungeon and Tiny Town 12 across)
//   { draw }         a function in art/draw/ (masks colored like the 1-Bit Pack, or full color)
// Kinds (what the builder makes of an entry):
//   player   full-color pack sprite remapped with `colors`, on a 22 x 22 frame, plus `hold` (what
//            she carries, drawn by art/draw/ at `at`); a flash
//   enemy    one-color sprite in `ramp`; a flash, an elite (twice the size, gold line), its flash;
//            `frames` > 1 with `fps` makes an animation (frame k is "<id>@<k>")
//   part     a boss part (layers); a flash
//   icon     picture in its ramp on an 18 x 18 dark square, the border in its tag's color
//   item     a one-color sprite in `ramp`, cropped to its pixels, outlined (pickups, materials)
//   ground   a floor tile drawn in code (`draw` with its `variant`), taken as drawn
//   block    an obstacle tile: a floor tile with the obstacle drawn over it
//   fx       full-color frames from art/draw/ as they are
//   town     the harbor's pack B tiles and props (Tiny Town, Tiny Dungeon), remapped with
//            TOWN_COLORS and the entry's `colors`; `layout` (rows of tiles) composes several
//            into one frame
//   building a building's `layout` at one stage (art/draw/hub.js): 'ruin', 'roof' (boarded
//            windows), 'lit', 'keeper' (a sign and a lantern by the door), 'alive' (window boxes)
//   npc      a townsperson (Tiny Dungeon), remapped, on the characters' 22 x 22 frame

// `title` must appear in the credits (src/data/credits.js) once any sprite uses the pack.
export const PACKS = Object.freeze({
  onebit: { file: 'kenney_1-bit-pack/Tilesheet/monochrome-transparent_packed.png', cols: 49, title: '1-Bit Pack' },
  dungeon: { file: 'kenney_tiny-dungeon/Tilemap/tilemap_packed.png', cols: 12, title: 'Tiny Dungeon' },
  town: { file: 'kenney_tiny-town/Tilemap/tilemap_packed.png', cols: 12, title: 'Tiny Town' },
});

// Ramps for one-color sprites: light (top and left edges), body, shade (bottom and right),
// hole (enclosed holes such as eyes; null leaves them see-through), outline (default night-0).
// Enemies are cool and desaturated and dimmer than any character (§16.4).
const r = (light, body, shade, hole = 'night-1') => Object.freeze({ light, body, shade, hole });
export const RAMPS = Object.freeze({
  // Enemies.
  // Grey-blues told apart by value: the wisp mid, the crab (bigger, a charger) paler, the rat a
  // dark body under a pale rim (its rim lifted a step so it keeps 2:1 against the floor with room).
  wisp: r('fog-2', 'fog-1', 'night-5', 'night-0'),
  drowned: r('sea-4', 'sea-3', 'sea-2'),
  gull: r('fog-2', 'fog-2', 'fog-1'),
  crab: r('fog-3', 'fog-2', 'fog-1'),
  bloater: r('sea-4', 'sea-3', 'sea-2', 'sea-1'),
  rat: r('fog-2', 'night-5', 'night-4', 'night-0'),
  moth: r('violet-4', 'violet-3', 'violet-2', 'violet-1'),
  // Boss parts.
  maw_hide: r('sea-4', 'sea-3', 'sea-2', null),
  maw_lip: r('sea-5', 'sea-4', 'sea-3', null),
  maw_gum: r('rot-2', 'rot-1', 'rot-1', null),
  maw_eye: r('sea-6', 'sea-6', 'sea-6', null),
  maw_barnacle: r('fog-2', 'fog-2', 'fog-2', null),
  teeth: r('fog-5', 'fog-4', 'fog-3', null),
  dark: r('night-0', 'night-0', 'night-0', null),
  mouth: r('night-0', 'night-0', 'night-0', null),
  throat: r('violet-1', 'violet-1', 'violet-1', null),
  lure: r('lamp-6', 'lamp-5', 'lamp-4', null),
  stalk: r('sea-4', 'sea-3', 'sea-2', null),
  robe: r('violet-3', 'violet-2', 'violet-1', null),
  bronze: r('sea-5', 'sea-4', 'sea-3', null),
  staff: r('fog-2', 'fog-1', 'night-5', null),
  tentacle: r('sea-4', 'sea-3', 'sea-2', null),
  // Icons, by tag (the border shows the tag too), and for relics and runes. Every key of
  // TAG_COLORS (src/data/palette.js) needs one here (tests/atlas.test.js checks).
  fire: r('lamp-5', 'lamp-4', 'lamp-3'),
  light: r('lamp-6', 'lamp-5', 'lamp-4'),
  tide: r('sea-6', 'sea-5', 'sea-4'),
  steel: r('fog-5', 'fog-4', 'fog-3'),
  echo: r('violet-4', 'violet-3', 'violet-2'),
  relic: r('violet-4', 'violet-3', 'violet-2'),
  relic_lit: r('violet-4', 'violet-3', 'violet-2', 'lamp-5'),     // a relic with a light inside
  frost: r('gem-4', 'gem-3', 'gem-2'),
  rot: r('moss-4', 'moss-3', 'moss-2'),
  rune: r('violet-3', 'violet-2', 'violet-1', 'lamp-5'),
  none: r('fog-5', 'fog-4', 'fog-3'),                              // an item with no tag
  // Pickups and materials.
  heart: r('rot-4', 'rot-3', 'rot-2'),
  magnet: r('rot-4', 'rot-3', 'rot-2'),
  gold: r('lamp-6', 'lamp-5', 'lamp-3', 'lamp-2'),
  chest: r('wood-4', 'wood-3', 'wood-2', 'lamp-4'),
  wood: r('wood-4', 'wood-3', 'wood-2'),
  rope: r('lamp-4', 'lamp-3', 'lamp-2'),
  paper: r('fog-5', 'fog-4', 'fog-3'),
  parchment: r('skin-3', 'skin-2', 'skin-1'),
  bottle: r('rot-4', 'rot-3', 'rot-2', 'lamp-5'),
  iron: r('fog-3', 'fog-2', 'fog-1'),
  herb: r('moss-4', 'moss-3', 'moss-2'),
  glass: r('white', 'fog-5', 'fog-4'),
  bone: r('lamp-6', 'skin-3', 'skin-2'),
  candle: r('lamp-6', 'lamp-5', 'lamp-4'),
  oil: r('lamp-5', 'lamp-4', 'lamp-3', 'lamp-6'),
  // Obstacles: darker than any actor, lighter than the ground (§16.4).
  crate: r('wood-3', 'wood-2', 'wood-1', 'night-1'),
});

const ob = (tile) => ({ pack: 'onebit', tile });

/**
 * Pack B's colors in the harbor (Tiny Town, and Tiny Dungeon's townsfolk). Every color a harbor
 * sprite uses is listed (the build refuses a color it doesn't know), in the palette's middle
 * values: the hub view's light map makes the night, so a lamp's pool shows these as they are and
 * the rest of the town dims to a blue dark.
 */
export const TOWN_COLORS = Object.freeze({
  '#3f2631': 'night-0', '#3d212d': 'night-0', '#262b44': 'night-1',
  // Wood.
  '#763b36': 'wood-2', '#773833': 'wood-2', '#bd6c4a': 'wood-3', '#be6c49': 'wood-3', '#eaa56c': 'wood-4', '#eba66c': 'wood-4',
  // Stone and slate.
  '#52607c': 'night-5', '#51607d': 'night-5', '#5a6988': 'fog-1', '#8b9bb4': 'fog-2', '#8c9cb5': 'fog-2', '#aab7cc': 'fog-3', '#c0cbdc': 'fog-3', '#c1ccdd': 'fog-3',
  // Roof tiles.
  '#c34b35': 'rot-2', '#f28462': 'rot-3', '#fcbc8f': 'rot-4',
  // Grass and leaves.
  '#479f4a': 'moss-1', '#65a556': 'moss-1', '#84c669': 'moss-2', '#8bd87d': 'moss-3',
  // Dirt's specks; flowers.
  '#cf8254': 'wood-2', '#fec99c': 'wood-4', '#fdbe53': 'lamp-4', '#e38628': 'lamp-3', '#e84537': 'rot-3', '#e94334': 'rot-3', '#ff706d': 'rot-4', '#ffffff': 'fog-5',
  // Water in a well or a tub.
  '#009adc': 'sea-3', '#76e4ff': 'sea-5',
  // Faces (Tiny Dungeon), and a robe the librarian's entry recolors.
  '#e19a65': 'skin-2', '#f7c282': 'skin-3', '#9b4ca3': 'violet-2', '#d176d0': 'violet-3',
});
/** The dirt paths, a step darker than the planks the same pack colors make on a wall. */
const DIRT = Object.freeze({ '#eaa56c': 'wood-3', '#cf8254': 'wood-2', '#fec99c': 'wood-3' });

/**
 * The buildings, as rows of Tiny Town tiles: two rows of roof (a chimney or a dormer on the ridge,
 * the gable in front), then the walls, windows up and down, the door at the bottom in the middle
 * (under the plot's door tile, data/hub.js). A cell can recolor its own tile (a stone gable where
 * the pack's is timber, and the other way round).
 */
const STONE_GABLE = { t: 63, colors: { '#eaa56c': 'fog-3', '#bd6c4a': 'fog-2' } };
const TIMBER_GABLE = { t: 67, colors: { '#c0cbdc': 'wood-4', '#8b9bb4': 'wood-3', '#5a6988': 'wood-2' } };
export const BUILDINGS_LAYOUT = Object.freeze({
  library: [[48, 49, 51, 49, 50], [60, 61, STONE_GABLE, 61, 62], [76, 88, 77, 88, 79], [76, 88, 89, 88, 79]],
  tavern: [[52, 53, 55, 53, 54], [64, 65, TIMBER_GABLE, 65, 66], [72, 84, 73, 84, 75], [72, 84, 85, 84, 75]],
  chapel: [[48, 49, 49, 49, 50], [60, 61, STONE_GABLE, 61, 62], [76, 88, 77, 88, 79], [76, 77, 89, 77, 79]],
  smithy: [[52, 53, 55, 53, 54], [64, 65, TIMBER_GABLE, 65, 66], [76, 88, 77, 77, 79], [76, 77, 78, 77, 79]],
  market: [[52, 53, 53, 53, 54], [64, 65, TIMBER_GABLE, 65, 66], [72, 84, 73, 84, 75], [72, 85, 73, 74, 75]],
  apothecary: [[48, 49, 51, 49, 50], [60, 61, 63, 61, 62], [72, 84, 73, 84, 75], [72, 73, 85, 73, 75]],
  cartographer: [[52, 53, 53, 53, 54], [64, 65, TIMBER_GABLE, 65, 66], [76, 88, 77, 88, 79], [76, 88, 89, 88, 79]],
  docks: [[48, 49, 49, 49, 50], [60, 61, 61, 61, 62], [72, 73, 73, 73, 75], [72, 74, 73, 74, 75]],
  lighthouse: [[48, 51, 50], [60, STONE_GABLE, 62], [76, 88, 79], [76, 89, 79]],
});

export const SPRITES = Object.freeze([
  // ------------------------------------------------------------ characters (Tiny Dungeon)
  {
    id: 'pc_lamplighter', kind: 'player', pack: 'dungeon', tile: 99,
    hold: { what: 'lantern', at: [16, 15] },       // at her right hand, in the 22 x 22 frame
    // An amber dress and auburn hair; skin warm; the pack's plum outline becomes night-0.
    colors: {
      '#3f2631': 'night-0', '#262b44': 'night-0', '#763b36': 'rot-2', '#bd6c4a': 'rot-3',
      '#9b4ca3': 'lamp-3', '#d176d0': 'lamp-4', '#e19a65': 'skin-2', '#eaa56c': 'skin-2', '#f7c282': 'skin-3',
    },
  },
  {
    id: 'pc_harpooner', kind: 'player', pack: 'dungeon', tile: 100,
    hold: { what: 'harpoon', at: [17, 1, 20] },    // the shaft's x, its top and bottom
    // White hair, a red coat (rot), leather in dark wood.
    colors: {
      '#3f2631': 'night-0', '#262b44': 'night-0', '#8b9bb4': 'lamp-6', '#c0cbdc': 'white',
      '#763b36': 'wood-2', '#bd6c4a': 'rot-2', '#e19a65': 'skin-2', '#f7c282': 'skin-3',
    },
  },

  // ------------------------------------------------------------ enemies (1-Bit Pack)
  { id: 'en_fog_wisp', kind: 'enemy', ...ob(419), ramp: 'wisp' },
  { id: 'en_sailor', kind: 'enemy', ...ob(471), ramp: 'drowned' },
  { id: 'en_gull', kind: 'enemy', draw: 'gull', ramp: 'gull', frames: 2, fps: 7 },
  { id: 'en_crab', kind: 'enemy', draw: 'crab', ramp: 'crab', frames: 2, fps: 6 },
  { id: 'en_bloater', kind: 'enemy', ...ob(367), ramp: 'bloater' },
  { id: 'en_rat', kind: 'enemy', ...ob(423), ramp: 'rat' },
  { id: 'en_lantern_eater', kind: 'enemy', ...ob(271), ramp: 'moth' },
  { id: 'en_gunner', kind: 'enemy', ...ob(74), ramp: 'drowned' },
  { id: 'en_bosun', kind: 'enemy', ...ob(466), ramp: 'drowned' },

  // ------------------------------------------------------------ bosses (code rigs, src/render/rigs.js)
  { id: 'boss_maw:body', kind: 'part', draw: 'mawBody' },
  { id: 'boss_maw:jaw', kind: 'part', draw: 'mawJaw' },
  { id: 'boss_maw:mouth', kind: 'part', draw: 'mawMouth' },
  { id: 'boss_maw:stalk', kind: 'part', draw: 'mawStalk', ramp: 'stalk' },
  { id: 'boss_maw:bulb', kind: 'part', draw: 'mawBulb', ramp: 'lure' },
  { id: 'boss_maw:fin', kind: 'part', draw: 'mawFin', ramp: 'maw_hide' },
  { id: 'boss_tidecaller:robe', kind: 'part', draw: 'tidecallerRobe' },
  { id: 'boss_tidecaller:staff', kind: 'part', draw: 'tidecallerStaff', ramp: 'staff' },
  { id: 'boss_tidecaller:bell', kind: 'part', draw: 'tidecallerBell', ramp: 'bronze' },
  { id: 'boss_tidecaller:tentacle', kind: 'part', draw: 'tidecallerTentacle', ramp: 'tentacle' },
  { id: 'boss_tidecaller:hand', kind: 'part', draw: 'tidecallerHand', ramp: 'teeth' },

  // ------------------------------------------------------------ pickups
  { id: 'pk_heal', kind: 'item', ...ob(529), ramp: 'heart' },
  { id: 'pk_magnet', kind: 'item', draw: 'magnet' },
  { id: 'chest_elite', kind: 'item', ...ob(302), ramp: 'chest' },
  { id: 'chest_boss', kind: 'item', ...ob(303), ramp: 'gold' },

  // ------------------------------------------------------------ materials (on the ground and in the HUD)
  { id: 'mat_coin', kind: 'item', ...ob(218), ramp: 'gold' },
  { id: 'mat_oil', kind: 'item', ...ob(670), ramp: 'oil' },
  { id: 'mat_timber', kind: 'item', ...ob(306), ramp: 'wood' },
  { id: 'mat_rope', kind: 'item', ...ob(697), ramp: 'rope' },
  { id: 'mat_pages', kind: 'item', ...ob(769), ramp: 'paper' },
  { id: 'mat_rum', kind: 'item', ...ob(964), ramp: 'bottle' },
  { id: 'mat_iron', kind: 'item', ...ob(237), ramp: 'iron' },
  { id: 'mat_scraps', kind: 'item', ...ob(341), ramp: 'parchment' },
  { id: 'mat_herbs', kind: 'item', ...ob(1013), ramp: 'herb' },
  { id: 'mat_saltglass', kind: 'item', draw: 'crystal', ramp: 'glass' },
  { id: 'mat_bone', kind: 'item', ...ob(620), ramp: 'bone' },
  { id: 'mat_candles', kind: 'item', ...ob(740), ramp: 'candle' },

  // ------------------------------------------------------------ icons (weapons, passives, relics, runes)
  // The ramp defaults to the item's first tag (relic and rune for those); `ramp` overrides it.
  { id: 'icon_flare_gun', kind: 'icon', ...ob(479) },
  { id: 'icon_flare_barrage', kind: 'icon', ...ob(1063) },
  { id: 'icon_lantern_orb', kind: 'icon', draw: 'orb' },
  { id: 'icon_lighthouse_lens', kind: 'icon', ...ob(136) },
  { id: 'icon_harpoon_chain', kind: 'icon', ...ob(289) },
  { id: 'icon_kraken_line', kind: 'icon', ...ob(417) },
  { id: 'icon_tide_bell', kind: 'icon', draw: 'bell' },
  { id: 'icon_storm_bell', kind: 'icon', draw: 'stormBell' },
  { id: 'icon_lamplight', kind: 'icon', ...ob(651) },
  { id: 'icon_wick_oil', kind: 'icon', ...ob(193) },
  { id: 'icon_lamp_glass', kind: 'icon', ...ob(603) },
  { id: 'icon_ballast', kind: 'icon', draw: 'anchor' },
  { id: 'icon_undertow', kind: 'icon', draw: 'wave' },
  { id: 'icon_sea_legs', kind: 'icon', ...ob(89) },
  { id: 'icon_thick_coat', kind: 'icon', ...ob(86) },
  { id: 'icon_lodestone', kind: 'icon', draw: 'magnet' },
  { id: 'icon_tallow_candle', kind: 'icon', ...ob(738) },
  { id: 'icon_almanac', kind: 'icon', ...ob(290) },
  { id: 'icon_lucky_knot', kind: 'icon', ...ob(1021) },
  { id: 'relic_volatile_gems', kind: 'icon', draw: 'burstGem' },
  { id: 'relic_glass_lantern', kind: 'icon', draw: 'hurricaneLamp' },   // layers: the lit globe and the handle
  { id: 'relic_reapers_wake', kind: 'icon', ...ob(134) },
  { id: 'relic_seventh_bell', kind: 'icon', draw: 'bell' },
  { id: 'relic_tide_clock', kind: 'icon', ...ob(629) },
  { id: 'rune_splitting', kind: 'icon', draw: 'rune' },
  { id: 'rune_burning', kind: 'icon', draw: 'rune' },
  { id: 'rune_orbiting', kind: 'icon', draw: 'rune' },
  { id: 'rune_backfire', kind: 'icon', draw: 'rune' },
  { id: 'rune_chain', kind: 'icon', draw: 'rune' },

  // ------------------------------------------------------------ props
  { id: 'prop_lamppost', kind: 'item', draw: 'lampPost' },

  // ------------------------------------------------------------ the run map (the Drowned Docks)
  // Wet boards, some worn to the grain; crates, barrels, and wreckage block the way.
  { id: 'tile_floor_0', kind: 'ground', draw: 'planks', variant: 0 },
  { id: 'tile_floor_1', kind: 'ground', draw: 'planks', variant: 1 },
  { id: 'tile_floor_2', kind: 'ground', draw: 'planks', variant: 2 },
  { id: 'tile_floor_3', kind: 'ground', draw: 'planks', variant: 3 },
  { id: 'tile_block_0', kind: 'block', ...ob(261), ramp: 'crate', floor: 0 },
  { id: 'tile_block_1', kind: 'block', ...ob(650), ramp: 'crate', floor: 1 },
  { id: 'tile_block_2', kind: 'block', ...ob(260), ramp: 'crate', floor: 2 },

  // ------------------------------------------------------------ the harbor (Phase 5; pack B, ARCHITECTURE §10.4)
  // The ground: grass, the dirt paths (edges and inside corners, picked by the hub view from its
  // neighbors, render/hubtiles.js), and the fences. (The square's setts are drawn in code.)
  { id: 'hub_grass_0', kind: 'town', pack: 'town', tile: 0 },
  { id: 'hub_grass_1', kind: 'town', pack: 'town', tile: 1 },
  { id: 'hub_flowers', kind: 'town', pack: 'town', tile: 2 },
  ...[['nw', 12], ['n', 13], ['ne', 14], ['w', 24], ['c', 25], ['e', 26], ['sw', 36], ['s', 37], ['se', 38], ['in_nw', 39], ['in_ne', 40], ['in_se', 41], ['in_sw', 42]]
    .map(([k, tile]) => ({ id: `hub_path_${k}`, kind: 'town', pack: 'town', tile, colors: DIRT })),
  { id: 'hub_fence_l', kind: 'town', pack: 'town', tile: 44 },
  { id: 'hub_fence_m', kind: 'town', pack: 'town', tile: 45 },
  { id: 'hub_fence_r', kind: 'town', pack: 'town', tile: 46 },
  { id: 'hub_fence_post', kind: 'town', pack: 'town', tile: 47 },
  // Trees and bushes (the forest's edge), and the props the square gains as the town comes back.
  { id: 'hub_tree_round', kind: 'town', pack: 'town', tile: 16 },
  { id: 'hub_tree_pine', kind: 'town', pack: 'town', tile: 28 },
  { id: 'hub_tree_small', kind: 'town', pack: 'town', tile: 4 },
  { id: 'hub_bush', kind: 'town', pack: 'town', tile: 5 },
  { id: 'hub_well', kind: 'town', pack: 'town', tile: 104 },
  { id: 'hub_tub', kind: 'town', pack: 'town', tile: 130 },
  { id: 'hub_barrel', kind: 'town', pack: 'dungeon', tile: 82 },
  { id: 'hub_cart', kind: 'town', pack: 'town', tile: 57 },
  { id: 'hub_signpost', kind: 'town', pack: 'town', tile: 83 },
  // The buildings, one frame per stage (a level's stage: meta/state.js buildingStage).
  ...['ruin', 'roof', 'lit', 'keeper', 'alive'].map((stage) => ({ id: `bld_library_${stage}`, kind: 'building', pack: 'town', layout: BUILDINGS_LAYOUT.library, stage, sign: 'library' })),
  ...['ruin', 'roof', 'lit', 'keeper', 'alive'].map((stage) => ({ id: `bld_tavern_${stage}`, kind: 'building', pack: 'town', layout: BUILDINGS_LAYOUT.tavern, stage, sign: 'tavern' })),
  // The plots of the buildings to come (Phase 7, and the Lighthouse in Phase 10): ruins for now.
  ...['chapel', 'smithy', 'market', 'apothecary', 'cartographer', 'docks', 'lighthouse']
    .map((id) => ({ id: `bld_${id}_ruin`, kind: 'building', pack: 'town', layout: BUILDINGS_LAYOUT[id], stage: 'ruin' })),
  // The townsfolk (Tiny Dungeon): Old Wick, Silas, and Bram.
  { id: 'npc_lamp_keeper', kind: 'npc', pack: 'dungeon', tile: 86, colors: { '#bd6c4a': 'fog-2', '#763b36': 'wood-2', '#c0cbdc': 'fog-4', '#8b9bb4': 'fog-3' } },
  // Silas: the townsman in a long ink-violet coat (the pack's wizard, with his hat, read as a wizard).
  { id: 'npc_librarian', kind: 'npc', pack: 'dungeon', tile: 85, colors: { '#c0cbdc': 'violet-3', '#8b9bb4': 'violet-2', '#bd6c4a': 'wood-2', '#763b36': 'wood-1' } },
  // Bram: the pack's bearded man with a headband, in a green tunic (tile 88 read as bare-chested).
  { id: 'npc_innkeeper', kind: 'npc', pack: 'dungeon', tile: 112, colors: { '#25956a': 'moss-2', '#43e1b3': 'moss-3' } },
  // Drawn in code in the pack's style (art/draw/hub.js): the sea, the pier, the quay and its wall,
  // the boat, the scaffold, signs, lanterns, and window boxes.
  { id: 'hub_drawn', kind: 'fx', draw: 'hub' },

  // ------------------------------------------------------------ effects, particles, font (art/draw/effects.js)
  { id: 'shots', kind: 'fx', draw: 'shots' },
  { id: 'gems', kind: 'fx', draw: 'gems' },
  { id: 'particles', kind: 'fx', draw: 'particles' },
  { id: 'font', kind: 'fx', draw: 'font' },
]);
