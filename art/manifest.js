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

// The run's ground, lifted (0.9.0, the veteran round: runs were too dark to read the map, mean
// luminance 23 of 255 at the Docks' start). What you walk on is drawn a palette step lighter than
// its drawing's own colors, so the ground is a dark mid-value and the enemies' night-0 outline
// shows against it as a rim (Halls of Torment and Vampire Survivors keep the ground mid-value and
// the crowd dark-edged; no usable picture came back from the image search, so this goes by that
// written description). Water, deep pools, roofs, walls, and the hull stay as drawn: obstacles
// and water read darker than the ground you can stand on.
export const GROUND_LIFT = Object.freeze({
  draws: Object.freeze(['planks', 'bridge', 'deck', 'mSalt', 'mMud', 'mReeds', 'mPeat', 'mCauseway', 'mBoardwalk', 'mLanding']),
  colors: Object.freeze({ 'night-0': 'night-1', 'night-1': 'night-2', 'night-2': 'night-3', 'night-3': 'night-4' }),   // night-4 stays: the salt flats' bright crust keeps under 1.5:1
});

// Ramps for one-color sprites: light (top and left edges), body, shade (bottom and right),
// hole (enclosed holes such as eyes; null leaves them see-through), outline (default night-0).
// Enemies are cool and desaturated and dimmer than any character (§16.4).
const r = (light, body, shade, hole = 'night-1') => Object.freeze({ light, body, shade, hole });
// An enemy's ramp with its family's second tone over the top of its body (0.9.0, the veteran
// round: the crowd read as one-tint wallpaper). One tone a family, so a glance sorts the horde:
// the fog things wear the fog's pale grey, the drowned a salt-bleached grey-teal, the lantern
// eater pale violet, the marsh's own the creek's sea green.
const FAMILY_TONE = Object.freeze({ fog: 'fog-4', drowned: 'sea-6', moth: 'violet-4', marsh: 'sea-5' });
const fam = (family, ramp, toneTo = 0.4) => Object.freeze({ ...ramp, tone: FAMILY_TONE[family], toneTo });
export const RAMPS = Object.freeze({
  // Enemies. Each type its own ramp (0.7.3): on a map no two types share one, and their mean colors
  // stand at least 0.02 apart in OKLab (tests/art.test.js), so a crowd sorts itself by color as well
  // as by shape. All cool, desaturated, and dimmer than any character (§16.4).
  // The fog things in grey-blue told apart by value: the wisp a pale rim on a mid body (fog thins
  // at its edge), the gull mid, the crab (bigger, a charger) paler, the rat a dark body under a pale
  // rim (its rim lifted a step so it keeps 2:1 against the floor with room).
  wisp: fam('fog', r('fog-3', 'fog-1', 'night-5', 'night-0'), 0.2),
  gull: fam('fog', r('fog-2', 'fog-1', 'night-5'), 0.4),   // the wings' tops pale, the V's point dark
  crab: fam('fog', r('fog-3', 'fog-2', 'fog-1'), 0.25),   // the palest already: a shallower cap keeps it under the characters
  rat: fam('fog', r('fog-2', 'night-5', 'night-4', 'night-0'), 0.25),
  // The drowned in the sea's teal, told apart by depth: the sailor mid; the gunner darker, sunk
  // deeper with its gun; the bosun, the one who gives the orders, with the palest rim over the
  // deepest shade; the bloater a swollen grey with a drowned teal underside.
  drowned: fam('drowned', r('sea-4', 'sea-3', 'sea-2')),
  gunner: fam('drowned', r('sea-3', 'sea-2', 'night-4', 'night-0')),
  bosun: fam('drowned', r('sea-5', 'sea-3', 'sea-1', 'night-0')),
  bloater: fam('drowned', r('fog-2', 'night-5', 'sea-2', 'sea-1')),
  moth: fam('moth', r('violet-4', 'violet-3', 'violet-2', 'violet-1')),
  // The Salt Marsh's (0.8.0), each its own beside the coast-wide wisp and gull: the midges teal specks
  // (blue-black ones were lost under the fog on the salt); the Salted Dead a drowned grey under pale salt (salt_crust, their crust and the
  // Warden's); the Well Warden the deep blue of well water; the toad mottled grey over a pond green;
  // the leech a violet-grey; the eel the creek's teal, palest of them, its belly catching the light.
  midge: fam('marsh', r('sea-4', 'sea-3', 'sea-2')),
  salted: fam('marsh', r('fog-2', 'fog-1', 'night-5', 'night-0'), 0.2),   // the salt crust is a third tone over it
  salt_crust: r('fog-5', 'fog-4', 'fog-3', null),
  warden: r('gem-2', 'gem-1', 'sea-1', 'night-0'),   // two-tone already: the salt crust it wears
  toad: fam('marsh', r('fog-2', 'sea-3', 'sea-2', 'night-0')),
  leech: fam('marsh', r('violet-4', 'fog-1', 'violet-1', 'night-0')),
  eel: fam('marsh', r('sea-5', 'sea-4', 'sea-3', 'night-0')),
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
  // The Old Grey (a grey heron) and the Salt Widow (0.8.0).
  heron_pale: r('fog-5', 'fog-4', 'fog-3', null),
  heron_back: r('fog-2', 'fog-1', 'night-5', null),
  heron_dark: r('night-2', 'night-1', 'night-1', null),
  heron_dark_wing: r('night-5', 'night-4', 'night-3', null),
  heron_bill: r('lamp-5', 'lamp-4', 'lamp-3', null),
  heron_leg: r('wood-4', 'wood-3', 'wood-2', null),
  widow_cloak: r('fog-2', 'fog-1', 'night-5', null),
  widow_eye: r('gem-4', 'gem-4', 'gem-4', null),
  // Icons, by tag (the border shows the tag too), and for relics and runes. Every key of
  // TAG_COLORS (src/data/palette.js) needs one here (tests/atlas.test.js checks).
  fire: r('lamp-5', 'lamp-4', 'lamp-3'),
  light: r('lamp-6', 'lamp-5', 'lamp-4'),
  tide: r('sea-6', 'sea-5', 'sea-4'),   // the relic icons that name it
  sea: r('sea-6', 'sea-5', 'sea-4'),    // the Sea tag (decision 8: Tide is the difficulty)
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
  well_water: r('sea-1', 'night-0', 'night-0'),
  bog: r('skin-1', 'wood-4', 'wood-3', 'night-0'),   // bog-tanned skin: leathery red-brown, lighter than the peat he lies in
  glass: r('white', 'fog-5', 'fog-4'),
  bone: r('lamp-6', 'skin-3', 'skin-2'),
  candle: r('lamp-6', 'lamp-5', 'lamp-4'),
  oil: r('lamp-5', 'lamp-4', 'lamp-3', 'lamp-6'),
  // Phase 7: gear, consumables, arcana, Sea Glass, and the run's tasks.
  gear: r('fog-5', 'fog-4', 'fog-3'),
  item: r('moss-4', 'moss-3', 'moss-2', 'lamp-5'),
  arcana: r('lamp-6', 'lamp-5', 'lamp-4'),
  seaglass: r('sea-6', 'sea-5', 'sea-4'),
  // A Pearl (0.8.2): white where the light falls, a cream body (nacre's warm overtone), grey shade.
  pearl: r('white', 'lamp-6', 'fog-3'),
  bellmetal: r('lamp-5', 'lamp-4', 'lamp-3', 'night-1'),
  skiff: r('wood-4', 'wood-3', 'wood-2'),
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
/**
 * What rises from each building's roof once its roof is back (art/draw/harbor.js, 0.7.3), so each
 * has its own outline against the sky rather than the pack's one house shape.
 */
const OUTLINE = Object.freeze({ lighthouse: 'lanternRoom', chapel: 'bellcote', smithy: 'forgeStack', docks: 'flagstaff', market: 'weathervane', apothecary: 'chimneyPots', cartographer: 'lookout', library: 'cupola', tavern: 'innChimney' });
export const BUILDINGS_LAYOUT = Object.freeze({
  library: [[48, 49, 51, 49, 50], [60, 61, STONE_GABLE, 61, 62], [76, 88, 77, 88, 79], [76, 88, 89, 88, 79]],
  tavern: [[52, 53, 55, 53, 54], [64, 65, TIMBER_GABLE, 65, 66], [72, 84, 73, 84, 75], [72, 84, 85, 84, 75]],
  chapel: [[48, 49, 49, 49, 50], [60, 61, STONE_GABLE, 61, 62], [76, 88, 77, 88, 79], [76, 77, 89, 77, 79]],
  smithy: [[52, 53, 55, 53, 54], [64, 65, TIMBER_GABLE, 65, 66], [76, 88, 77, 77, 79], [76, 77, 78, 77, 79]],
  market: [[52, 53, 53, 53, 54], [64, 65, TIMBER_GABLE, 65, 66], [72, 84, 73, 84, 75], [72, 74, 85, 74, 75]],
  apothecary: [[48, 49, 51, 49, 50], [60, 61, 63, 61, 62], [72, 84, 73, 84, 75], [72, 73, 85, 73, 75]],
  cartographer: [[52, 53, 53, 53, 54], [64, 65, TIMBER_GABLE, 65, 66], [76, 88, 77, 88, 79], [76, 88, 89, 88, 79]],
  docks: [[48, 49, 49, 49, 50], [60, 61, 61, 61, 62], [72, 84, 73, 84, 75], [72, 74, 85, 74, 75]],
  lighthouse: [[48, 51, 50], [60, STONE_GABLE, 62], [76, 77, 79], [76, 89, 79]],
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

  // The Salt Marsh's two (0.8.0, art/draw/marshlife.js). The Punter: the pack's brown-haired man in
  // a fisherman's yellow oilskin, his punt pole in his right hand. The Bog Warden: the pack's
  // white-haired woman (the Harpooner's tile, §20 call 53) in a moss-green dress, her long hair
  // recolored into a peat-brown hood, its peak drawn over her crown.
  {
    id: 'pc_punter', kind: 'player', pack: 'dungeon', tile: 98,
    hold: { what: 'pole', at: [18, 0, 20] },
    colors: {
      '#3f2631': 'night-0', '#262b44': 'night-0', '#c0cbdc': 'lamp-4', '#8b9bb4': 'lamp-3', '#52607c': 'wood-3',
      '#bd6c4a': 'wood-4', '#763b36': 'wood-3', '#f7c282': 'skin-3', '#e19a65': 'skin-2',
    },
  },
  {
    id: 'pc_bog_warden', kind: 'player', pack: 'dungeon', tile: 100,
    hold: { what: 'hood', at: [10, 4] },
    colors: {
      '#3f2631': 'night-0', '#262b44': 'night-0', '#c0cbdc': 'wood-4', '#8b9bb4': 'wood-4',
      '#763b36': 'moss-3', '#bd6c4a': 'moss-4', '#e19a65': 'skin-2', '#f7c282': 'skin-3',
    },
  },

  // 0.9.0 (W2, ruling 2): the brief's six. The Drowned Man: the pack's bald, bearded man, washed up
  // (skin drowned grey, his beard dark and wet, weed over his crown) with pennies on his eyes, the
  // coins for the ferryman (a weathered rust coat and linen shirt, so he's as warm as the rule asks).
  // The Tide Priest: below.
  {
    id: 'pc_drowned_man', kind: 'player', pack: 'dungeon', tile: 86,
    hold: { what: 'weed', at: [11, 5] },
    colors: {
      '#3f2631': 'night-0', '#262b44': 'lamp-4', '#f7c282': 'fog-5', '#e19a65': 'fog-4',
      '#bd6c4a': 'rot-3', '#763b36': 'wood-1', '#c0cbdc': 'lamp-6', '#8b9bb4': 'lamp-3',
    },
  },
  {
    id: 'pc_tide_priest', kind: 'player', pack: 'dungeon', tile: 111,
    // (0.9.0, W2 passes 43 to 47) The pack's hooded robe, to the ground, sea-bleached pale (lamp-6,
    // shaded lamp-5 on the side away from the light) with a sea-blue stole down her front; her face
    // painted into the cowl; a wooden crook held high in her left hand, a brass bell under its hook.
    // A sea-blue robe or cowl fails the warm rule (tests/art.test.js: red above 1.3 times blue over
    // the whole sprite), so the sea is the stole. Brother Hale (npc_warden) wears the same tile in brown.
    hold: { what: 'cowl', at: [3, 3, 'sea-4', null, 'left'] },
    colors: {
      '#3f2631': 'night-0', '#bd6c4a': 'lamp-6', '#763b36': 'lamp-5', '#eaa56c': 'lamp-6', '#e84537': 'night-0',
      '#c0cbdc': 'lamp-6', '#8b9bb4': 'lamp-6', '#aab7cc': 'lamp-6', '#f7c282': 'skin-3',
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
  { id: 'en_gunner', kind: 'enemy', ...ob(74), ramp: 'gunner' },
  { id: 'en_bosun', kind: 'enemy', ...ob(466), ramp: 'bosun' },
  // The Salt Marsh's (0.8.0, art/draw/marshlife.js): the midges, the Salted Dead (the pack's figure
  // under salt), the toad and the leech drawn in code, the pack's eel, and the Well Warden.
  { id: 'en_midges', kind: 'enemy', draw: 'midgeCloud', ramp: 'midge', frames: 2, fps: 6 },
  { id: 'en_salted_dead', kind: 'enemy', draw: 'saltedDead', ramp: 'salted' },
  { id: 'en_mire_toad', kind: 'enemy', draw: 'mireToad', ramp: 'toad' },
  { id: 'en_creek_eel', kind: 'enemy', ...ob(420), ramp: 'eel' },
  { id: 'en_leech', kind: 'enemy', draw: 'leech', ramp: 'leech', frames: 2, fps: 4 },
  { id: 'en_well_warden', kind: 'enemy', draw: 'wellWarden', ramp: 'warden' },

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
  // The Salt Marsh's (art/draw/marshbosses.js).
  { id: 'boss_grey:body', kind: 'part', draw: 'greyBody' },
  { id: 'boss_grey:neck', kind: 'part', draw: 'greyNeck' },
  { id: 'boss_grey:head', kind: 'part', draw: 'greyHead' },
  { id: 'boss_grey:leg', kind: 'part', draw: 'greyLeg' },
  { id: 'boss_grey:wing', kind: 'part', draw: 'greyWing' },
  { id: 'boss_widow:cloak', kind: 'part', draw: 'widowCloak' },
  { id: 'boss_widow:crown', kind: 'part', draw: 'widowCrown', ramp: 'salt_crust' },
  { id: 'boss_widow:arm', kind: 'part', draw: 'widowArm' },

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
  { id: 'icon_signal_mirror', kind: 'icon', draw: 'signalMirror' },
  { id: 'icon_oil_flask', kind: 'icon', draw: 'oilFlask' },
  { id: 'icon_lightning_rod', kind: 'icon', draw: 'lightningRod' },
  { id: 'icon_corpse_candles', kind: 'icon', draw: 'corpseCandles' },
  { id: 'relic_volatile_gems', kind: 'icon', draw: 'burstGem' },
  { id: 'relic_wreck_lantern', kind: 'icon', draw: 'wreckLantern' },
  { id: 'relic_glass_lantern', kind: 'icon', draw: 'hurricaneLamp' },   // layers: the lit globe and the handle
  { id: 'relic_reapers_wake', kind: 'icon', ...ob(134) },
  { id: 'relic_seventh_bell', kind: 'icon', draw: 'bell' },
  { id: 'relic_tide_clock', kind: 'icon', ...ob(629) },
  // Phase 7's relics.
  { id: 'relic_gull_feather', kind: 'icon', ...ob(568) },
  { id: 'relic_brass_button', kind: 'icon', ...ob(189), ramp: 'gold' },
  { id: 'relic_spark_flint', kind: 'icon', ...ob(566), ramp: 'fire' },
  { id: 'relic_barnacle_shell', kind: 'icon', ...ob(386), ramp: 'tide' },
  { id: 'relic_bloodied_hook', kind: 'icon', ...ob(660), ramp: 'heart' },
  { id: 'relic_drowned_bell', kind: 'icon', ...ob(570), ramp: 'tide' },
  // Gear (the Smithy), consumables (the Apothecary), and arcana (the gate).
  { id: 'gear_lantern', kind: 'icon', draw: 'stormLantern' },
  { id: 'gear_coat', kind: 'icon', ...ob(86) },
  { id: 'gear_boots', kind: 'icon', ...ob(40) },
  { id: 'gear_compass', kind: 'icon', ...ob(708), ramp: 'gold' },
  { id: 'gear_ring', kind: 'icon', draw: 'saltRing', ramp: 'candle' },
  { id: 'gear_pier_lamp', kind: 'icon', ...ob(488), ramp: 'gold' },
  { id: 'gear_charm', kind: 'icon', ...ob(389), ramp: 'tide' },
  { id: 'gear_pendant', kind: 'icon', ...ob(437), ramp: 'bellmetal' },
  { id: 'gear_bosun', kind: 'icon', ...ob(87), ramp: 'steel' },
  { id: 'item_salts', kind: 'icon', ...ob(669) },
  { id: 'item_tonic', kind: 'icon', ...ob(670), ramp: 'oil' },
  { id: 'item_bone', kind: 'icon', ...ob(620), ramp: 'bone' },
  { id: 'item_pebble', kind: 'icon', ...ob(676), ramp: 'iron' },
  { id: 'item_token', kind: 'icon', ...ob(671), ramp: 'wood' },
  { id: 'item_salve', kind: 'icon', ...ob(719), ramp: 'wood' },
  { id: 'item_dust', kind: 'icon', ...ob(720), ramp: 'magnet' },
  { id: 'item_pouch', kind: 'icon', ...ob(241), ramp: 'seaglass' },
  { id: 'arcana_high_water', kind: 'icon', draw: 'wave', ramp: 'tide' },
  { id: 'arcana_brine', kind: 'icon', ...ob(579), ramp: 'tide' },
  { id: 'arcana_kindling', kind: 'icon', ...ob(567), ramp: 'fire' },
  { id: 'arcana_glassblower', kind: 'icon', ...ob(581), ramp: 'seaglass' },
  { id: 'rune_backfire', kind: 'icon', draw: 'rune' },
  { id: 'rune_chain', kind: 'icon', draw: 'rune' },
  // The Salt Marsh's (0.8.0, art/draw/marshicons.js): weapons and evolutions in their first tag's
  // colors, the passives, the relics (some in their own material, some drawn as the rune stones
  // they were before ruling 14).
  // The Dash slot's eight items (C3, art/draw/dashicons.js), each in its own material.
  { id: 'icon_dash_wick', kind: 'icon', draw: 'dashWick', ramp: 'light' },
  { id: 'icon_dash_heavy', kind: 'icon', draw: 'dashHeavy', ramp: 'iron' },
  { id: 'icon_dash_long', kind: 'icon', draw: 'dashLong', ramp: 'wood' },
  { id: 'icon_dash_mire', kind: 'icon', draw: 'dashMire', ramp: 'bog' },
  { id: 'icon_dash_sink', kind: 'icon', draw: 'dashSink', ramp: 'sea' },
  { id: 'icon_dash_swell', kind: 'icon', draw: 'dashSwell', ramp: 'tide' },
  { id: 'icon_dash_oar', kind: 'icon', draw: 'dashOar', ramp: 'wood' },
  { id: 'icon_dash_light', kind: 'icon', draw: 'dashLight', ramp: 'paper' },
  { id: 'icon_brine_spring', kind: 'icon', draw: 'brineSpring' },
  { id: 'icon_ice_picks', kind: 'icon', draw: 'icePicks' },
  { id: 'icon_fog_horn', kind: 'icon', draw: 'fogHorn' },   // (in the Fulgurite's place, ruling 18 WD)
  { id: 'icon_eel_pot', kind: 'icon', draw: 'eelPot' },
  // 0.9.0 (W2): the signature weapons' (art/draw/trades.js).
  { id: 'icon_grapnel', kind: 'icon', draw: 'grapnelIcon' },
  { id: 'icon_punt_pole', kind: 'icon', draw: 'puntPoleIcon' },
  { id: 'icon_bog_hands', kind: 'icon', draw: 'bogHandsIcon' },
  { id: 'icon_grave_pennies', kind: 'icon', draw: 'gravePenniesIcon' },
  { id: 'icon_king_tide', kind: 'icon', draw: 'kingTideIcon' },
  { id: 'icon_anchor_chain', kind: 'icon', draw: 'anchorChain' },
  { id: 'icon_glass_caltrops', kind: 'icon', draw: 'glassCaltrops' },
  { id: 'icon_salt_pan', kind: 'icon', draw: 'saltPan' },
  { id: 'icon_conger_pot', kind: 'icon', draw: 'congerPot' },
  { id: 'icon_sea_anchor', kind: 'icon', draw: 'seaAnchor' },
  { id: 'icon_hoarfrost', kind: 'icon', draw: 'hoarfrost' },
  { id: 'icon_copper_wire', kind: 'icon', draw: 'copperWire' },
  { id: 'icon_grave_moss', kind: 'icon', draw: 'graveMoss' },
  { id: 'icon_bitterns_call', kind: 'icon', draw: 'bitternsCall' },
  { id: 'icon_waders', kind: 'icon', draw: 'waders' },
  { id: 'relic_sea_urchin', kind: 'icon', draw: 'seaUrchin' },
  { id: 'relic_quench_bucket', kind: 'icon', draw: 'quenchBucket', ramp: 'wood' },
  { id: 'relic_cold_iron', kind: 'icon', draw: 'coldIron', ramp: 'iron' },
  { id: 'relic_watchmans_rattle', kind: 'icon', draw: 'watchmansRattle', ramp: 'wood' },
  { id: 'relic_try_pot', kind: 'icon', draw: 'tryPot', ramp: 'iron' },
  { id: 'relic_brine_vat', kind: 'icon', draw: 'brineVat', ramp: 'wood' },
  { id: 'relic_bog_torc', kind: 'icon', draw: 'bogTorc', ramp: 'gold' },
  { id: 'rune_familiar', kind: 'icon', draw: 'rune' },
  { id: 'rune_spillway', kind: 'icon', draw: 'rune' },
  { id: 'rune_marsh_fever', kind: 'icon', draw: 'rune' },
  { id: 'rune_tarred', kind: 'icon', draw: 'rune' },

  // ------------------------------------------------------------ props
  { id: 'prop_lamppost', kind: 'item', draw: 'lampPost' },
  // The run's tasks and what they leave (Phase 7): a Wayside Lamp is the lamppost; a Fog Bell, the
  // Ferryman's skiff, a Reliquary, the vault, and a Pearl (0.8.2: Sea Glass by its new name, the
  // shard redrawn as a pearl; its id stays).
  { id: 'task_bell', kind: 'item', draw: 'bell', ramp: 'bellmetal' },
  { id: 'ferry_skiff', kind: 'item', draw: 'skiff', ramp: 'skiff' },
  { id: 'pk_reliquary', kind: 'item', draw: 'reliquary', ramp: 'relic_lit' },
  { id: 'pk_vault', kind: 'item', draw: 'reliquary', ramp: 'gold' },
  { id: 'pk_glass', kind: 'item', draw: 'pearl', ramp: 'pearl' },

  // ------------------------------------------------------------ the run map (the Drowned Docks)
  // Wet boards, some worn to the grain; crates, barrels, and wreckage block the way.
  { id: 'tile_floor_0', kind: 'ground', draw: 'planks', variant: 0 },
  { id: 'tile_floor_1', kind: 'ground', draw: 'planks', variant: 1 },
  { id: 'tile_floor_2', kind: 'ground', draw: 'planks', variant: 2 },
  { id: 'tile_floor_3', kind: 'ground', draw: 'planks', variant: 3 },
  { id: 'tile_block_0', kind: 'block', ...ob(261), ramp: 'crate', floor: 0 },
  { id: 'tile_block_1', kind: 'block', ...ob(650), ramp: 'crate', floor: 1 },
  { id: 'tile_block_2', kind: 'block', ...ob(260), ramp: 'crate', floor: 2 },
  // The slips, their bridges, the sheds, and the wreck (art/draw/tiles.js), and the secret
  // cache aboard it: a sea chest in the relics' violet.
  { id: 'tile_water_0', kind: 'ground', draw: 'water', variant: 0 },
  { id: 'tile_water_1', kind: 'ground', draw: 'water', variant: 1 },
  ...['n', 'w', 'e', 'nw', 'ne'].map((edges) => ({ id: `tile_water_${edges}`, kind: 'ground', draw: 'water', variant: 0, edges })),
  { id: 'tile_bridge_0', kind: 'ground', draw: 'bridge', variant: 0 },
  { id: 'tile_bridge_n', kind: 'ground', draw: 'bridge', variant: 1 },
  { id: 'tile_bridge_s', kind: 'ground', draw: 'bridge', variant: 2 },
  { id: 'tile_deck_0', kind: 'ground', draw: 'deck', variant: 0 },
  { id: 'tile_deck_1', kind: 'ground', draw: 'deck', variant: 1 },
  { id: 'tile_roof_0', kind: 'ground', draw: 'roof', variant: 0 },
  { id: 'tile_roof_1', kind: 'ground', draw: 'roof', variant: 1 },
  { id: 'tile_shed_wall_0', kind: 'ground', draw: 'shedWall', variant: 0 },
  { id: 'tile_shed_wall_1', kind: 'ground', draw: 'shedWall', variant: 1 },
  { id: 'tile_hull_0', kind: 'ground', draw: 'hull', variant: 0 },
  { id: 'tile_hull_1', kind: 'ground', draw: 'hull', variant: 1 },
  { id: 'secret_cache', kind: 'item', ...ob(303), ramp: 'relic' },
  // ------------------------------------------------------------ the run map (the Salt Marsh, 0.8.0; art/draw/marsh.js)
  // The flats' crust, the creek mud (its ripples across the flow: 'h' crests left to right, 'v' top
  // to bottom), club-rush, peat, stumps, the causeway, boardwalks, the landing; and water, the
  // creek's at high water and the deep pools', with a bank on each dry side (`banks`: 1 north,
  // 2 east, 4 south, 8 west). render/viewstate.js groundFrame picks them.
  ...[0, 1, 2, 3].map((v) => ({ id: `tile_m_salt_${v}`, kind: 'ground', draw: 'mSalt', variant: v })),
  ...['h', 'v'].flatMap((dir) => [0, 1, 2, 3, 4].map((v) => ({ id: `tile_m_mud_${dir}_${v}`, kind: 'ground', draw: 'mMud', variant: v, dir }))),
  ...[0, 1, 2, 3].map((v) => ({ id: `tile_m_reeds_${v}`, kind: 'ground', draw: 'mReeds', variant: v })),
  ...[0, 1, 2].map((v) => ({ id: `tile_m_peat_${v}`, kind: 'ground', draw: 'mPeat', variant: v })),
  ...[0, 1].map((v) => ({ id: `tile_m_stump_${v}`, kind: 'ground', draw: 'mStump', variant: v })),
  ...[0, 1].map((v) => ({ id: `tile_m_causeway_${v}`, kind: 'ground', draw: 'mCauseway', variant: v })),
  ...['h', 'v'].map((dir) => ({ id: `tile_m_boardwalk_${dir}`, kind: 'ground', draw: 'mBoardwalk', dir })),
  ...['', 'e', 's'].map((end) => ({ id: `tile_m_landing_${end || 0}`, kind: 'ground', draw: 'mLanding', end })),
  ...[0, 1, 2, 3].flatMap((v) => Array.from({ length: 16 }, (_, banks) => ({ id: `tile_m_water_${v}_${banks}`, kind: 'ground', draw: 'mWater', variant: v, banks }))),
  ...Array.from({ length: 16 }, (_, banks) => ({ id: `tile_m_deep_${banks}`, kind: 'ground', draw: 'mWater', variant: 0, banks, deep: true })),

  // An Ember (sim/ascend.js): a coal with its flame, in the relics' violet (it changes a weapon).
  { id: 'pk_ember', kind: 'item', draw: 'ember', ramp: 'relic' },
  // The five elite affixes (C3; data/enemies.js ELITE_AFFIXES): over an elite in a run, and in the glossary.
  { id: 'affix_warded', kind: 'item', draw: 'affixWarded', ramp: 'steel' },
  { id: 'affix_herald', kind: 'item', draw: 'affixHerald', ramp: 'gold' },
  { id: 'affix_molten', kind: 'item', draw: 'affixMolten', ramp: 'heart' },
  { id: 'affix_tethered', kind: 'item', draw: 'affixTethered', ramp: 'relic' },
  { id: 'affix_brine', kind: 'item', draw: 'affixBrine', ramp: 'sea' },
  // The Salt Marsh's props (0.8.0, art/draw/marshlife.js): a glass pillar, a herb bed, the Salt Well,
  // and the bog body that keeps the secret.
  { id: 'marsh_pillar', kind: 'item', draw: 'pillar' },
  { id: 'marsh_herbs', kind: 'item', draw: 'herbBed', ramp: 'herb' },
  { id: 'marsh_well', kind: 'item', draw: 'saltWell' },
  { id: 'marsh_bog_body', kind: 'item', draw: 'bogBody', ramp: 'bog' },

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
  ...['ruin', 'roof', 'lit', 'keeper', 'alive'].map((stage) => ({ id: `bld_library_${stage}`, kind: 'building', pack: 'town', layout: BUILDINGS_LAYOUT.library, stage, sign: 'library', outline: OUTLINE.library })),
  ...['ruin', 'roof', 'lit', 'keeper', 'alive'].map((stage) => ({ id: `bld_tavern_${stage}`, kind: 'building', pack: 'town', layout: BUILDINGS_LAYOUT.tavern, stage, sign: 'tavern', outline: OUTLINE.tavern })),
  // Phase 7's six, each with its own sign.
  ...['docks', 'smithy', 'chapel', 'market', 'apothecary', 'cartographer'].flatMap((b) => ['ruin', 'roof', 'lit', 'keeper', 'alive']
    .map((stage) => ({ id: `bld_${b}_${stage}`, kind: 'building', pack: 'town', layout: BUILDINGS_LAYOUT[b], stage, sign: b, forge: b === 'smithy', outline: OUTLINE[b] }))),
  // The Lighthouse (0.9.0: ten stages; its frames are a building's five, the lantern room its outline).
  // C3: a tower drawn in code (art/draw/lighthouse.js), not the pack's house: `tower`.
  ...['ruin', 'roof', 'lit', 'keeper', 'alive'].map((stage) => ({ id: `bld_lighthouse_${stage}`, kind: 'building', pack: 'town', layout: BUILDINGS_LAYOUT.lighthouse, stage, sign: 'lighthouse', outline: 'lanternRoom', tower: true })),
  // The townsfolk (Tiny Dungeon): Old Wick, Silas, and Bram.
  { id: 'npc_lamp_keeper', kind: 'npc', pack: 'dungeon', tile: 86, colors: { '#bd6c4a': 'fog-2', '#763b36': 'wood-2', '#c0cbdc': 'fog-4', '#8b9bb4': 'fog-3' } },
  // Silas: the townsman in a long ink-violet coat (the pack's wizard, with his hat, read as a wizard).
  { id: 'npc_librarian', kind: 'npc', pack: 'dungeon', tile: 85, colors: { '#c0cbdc': 'violet-3', '#8b9bb4': 'violet-2', '#bd6c4a': 'wood-2', '#763b36': 'wood-1' } },
  // Bram: the pack's bearded man with a headband, in a green tunic (tile 88 read as bare-chested).
  { id: 'npc_innkeeper', kind: 'npc', pack: 'dungeon', tile: 112, colors: { '#25956a': 'moss-2', '#43e1b3': 'moss-3' } },
  // Phase 7's keepers: Ned (the pack's helmeted man, in sea blue), Hob (the bare-armed bearded man),
  // Brother Hale (the hooded man), Fenn (the brown-haired man, in a lamp-gold coat), Old Moss (the
  // pack's wizard, in a moss robe), and Pell (the townsman again, in green).
  { id: 'npc_dockhand', kind: 'npc', pack: 'dungeon', tile: 87, colors: { '#c0cbdc': 'sea-4', '#8b9bb4': 'sea-3' } },
  { id: 'npc_smith', kind: 'npc', pack: 'dungeon', tile: 88 },
  { id: 'npc_warden', kind: 'npc', pack: 'dungeon', tile: 111 },
  { id: 'npc_trader', kind: 'npc', pack: 'dungeon', tile: 98, colors: { '#c0cbdc': 'lamp-4', '#8b9bb4': 'lamp-3' } },
  { id: 'npc_apothecary', kind: 'npc', pack: 'dungeon', tile: 84, colors: { '#9b4ca3': 'moss-2', '#d176d0': 'moss-3' } },
  // Maren, the lighthouse keeper (0.9.0): the pack's townswoman in a keeper's dark sea-blue coat.
  { id: 'npc_lighthouse_keeper', kind: 'npc', pack: 'dungeon', tile: 100, colors: { '#8b9bb4': 'sea-2', '#c0cbdc': 'sea-3', '#bd6c4a': 'fog-4', '#763b36': 'fog-3' } },
  { id: 'npc_cartographer', kind: 'npc', pack: 'dungeon', tile: 85, colors: { '#c0cbdc': 'moss-3', '#8b9bb4': 'moss-2', '#bd6c4a': 'wood-2', '#763b36': 'wood-1' } },
  // Drawn in code in the pack's style (art/draw/hub.js): the sea, the pier, the quay and its wall,
  // the boat, the scaffold, signs, lanterns, and window boxes.
  { id: 'hub_drawn', kind: 'fx', draw: 'hub' },
  // The harbor coming alive (0.7.3, art/draw/harbor.js): the gate's props by milestone, each
  // building's own by its levels, the Market's crates and barrow, and the town's life.
  { id: 'hub_bollard', kind: 'fx', draw: 'bollard' },
  { id: 'hub_rope_coil', kind: 'fx', draw: 'ropeCoil' },
  { id: 'hub_notice_board', kind: 'fx', draw: 'noticeBoard' },
  { id: 'hub_supplies', kind: 'fx', draw: 'supplies' },
  { id: 'hub_ship_bell', kind: 'fx', draw: 'shipBell' },
  // The gate's second lamp: the same lamp as the gate's own (the run's lamppost), so the two match.
  { id: 'hub_quay_lamp', kind: 'item', draw: 'lampPost' },
  // The bunting from it back to the gate's lamp: drawn for the span between where it's tied on the
  // two posts (render/hubtiles.js buntingAt; tests/harbor.test.js checks the two agree).
  { id: 'hub_bunting', kind: 'fx', draw: 'bunting', span: [97, -14] },
  // From the tenth run, a townswoman waves you off: the pack's woman (the Lamplighter's tile) in a
  // sea-blue dress with brown hair, her right arm up in code, two frames of the wave.
  { id: 'hub_market_crates', kind: 'fx', draw: 'marketCrates' },
  { id: 'hub_wheelbarrow', kind: 'fx', draw: 'wheelbarrow' },
  { id: 'hub_lobster_pots', kind: 'fx', draw: 'lobsterPots' },
  { id: 'hub_anvil', kind: 'fx', draw: 'anvil' },
  { id: 'hub_grindstone', kind: 'fx', draw: 'grindstone' },
  { id: 'hub_bench', kind: 'fx', draw: 'bench' },
  { id: 'hub_graves', kind: 'fx', draw: 'graves' },
  { id: 'hub_herb_pots', kind: 'fx', draw: 'herbPots' },
  { id: 'hub_telescope', kind: 'fx', draw: 'telescope' },
  { id: 'hub_tavern_table', kind: 'fx', draw: 'tavernTable' },
  { id: 'hub_oar_rack', kind: 'fx', draw: 'oarRack' },
  // The town's life (data/hub.js ambient): animals and boats; its townsfolk are the pack's, below.
  { id: 'hub_gull_perched', kind: 'fx', draw: 'gullPerched' },
  { id: 'hub_rowboat', kind: 'fx', draw: 'rowboat' },
  { id: 'hub_dog', kind: 'fx', draw: 'dog' },
  { id: 'hub_cat', kind: 'fx', draw: 'cat' },
  // The townsfolk out walking (Tiny Dungeon, recolored so none is mistaken for a keeper): a
  // grey-haired fisherman in a grey gansey (the brown-haired man), a sailor in a white shirt (the
  // bearded man with a headband), and a woman out shopping in a violet shawl (the white-haired woman).
  { id: 'npc_fisher', kind: 'npc', pack: 'dungeon', tile: 98, colors: { '#c0cbdc': 'fog-3', '#8b9bb4': 'fog-2', '#bd6c4a': 'fog-4', '#763b36': 'fog-2' } },
  { id: 'npc_sailor', kind: 'npc', pack: 'dungeon', tile: 112, colors: { '#25956a': 'fog-3', '#43e1b3': 'fog-5' } },
  { id: 'npc_shopper', kind: 'npc', pack: 'dungeon', tile: 100, colors: { '#8b9bb4': 'wood-2', '#c0cbdc': 'wood-3', '#bd6c4a': 'violet-3', '#763b36': 'violet-2' } },
  {
    id: 'hub_townswoman_waving', kind: 'npc', pack: 'dungeon', tile: 99, pose: 'wave', frames: 2, fps: 3,
    colors: { '#9b4ca3': 'sea-3', '#d176d0': 'sea-4', '#bd6c4a': 'wood-3', '#763b36': 'wood-2', '#eaa56c': 'skin-2' },
  },

  // ------------------------------------------------------------ effects, particles, font (art/draw/effects.js)
  { id: 'shots', kind: 'fx', draw: 'shots' },
  { id: 'gems', kind: 'fx', draw: 'gems' },
  { id: 'particles', kind: 'fx', draw: 'particles' },
  { id: 'font', kind: 'fx', draw: 'font' },
]);
