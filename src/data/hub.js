// The harbor: the hub's hand-authored map (ARCHITECTURE §10.4; brief §4, §6.1). The town sits
// between the forest and the sea, around the square where the one lamp still burns. Everything
// here is data: the ground, the building plots, the fog's regions and what reveals each, where
// people stand and walk, the pier the boats come in to, and the gate you set out from.
//
// Coordinates are tiles (16 px), x across from the left, y down from the top.

/**
 * The ground, one character per tile. Walkable: . grass, , flowers, : path, o cobbles, q quay,
 * = pier. Solid: T tree, t bush, f fence, # rock, w sea wall, ~ water. Buildings stand on their
 * plots (below), which are solid too.
 */
export const HUB_TERRAIN = Object.freeze({
  '.': { walk: true, name: 'grass' },
  ',': { walk: true, name: 'flowers' },
  ':': { walk: true, name: 'path' },
  'o': { walk: true, name: 'cobbles' },
  'q': { walk: true, name: 'quay' },
  '=': { walk: true, name: 'pier' },
  'T': { walk: false, name: 'tree' },
  't': { walk: false, name: 'bush' },
  'f': { walk: false, name: 'fence' },
  '#': { walk: false, name: 'rock' },
  'w': { walk: false, name: 'sea wall' },
  '~': { walk: false, name: 'water' },
});

export const HUB = {
  id: 'harbor', name: 'Harbor',
  map: [
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTT.TT.TT.TT.TT.TT.TT.TT.TT.TT.TT.TT.TT.TT.TT.TT.TT.TT.TTTT',
    'TT........................................................TT',
    'TT......T............T...,...........T...........T........TT',
    'TT...T..................................T.................TT',
    'TT...............................,.............,..........TT',
    'TT...........................::...........................TT',
    'TT.....,..............T......::.....................T.....TT',
    'TT........................t..::...t.......................TT',
    'TT............:....,.........::.......t...................TT',
    'TT.........fff:fff...........::........................T..TT',
    'TT............::::::::::ooooooooooooo.......:.............TT',
    'TT............::::::::::ooooooooooooo::::::::.............TT',
    'TT........t.............ooooooooooooo::::::::...........,.TT',
    'TT..................t...ooooooooooooo...........t.........TT',
    'TT.::.::::::::::::::::::ooooooooooooo.....................TT',
    'TT.::.::::::::::::::::::ooooooooooooo:::::::::::::........TT',
    'TT.::...................ooooooooooooo:::::::::::::........TT',
    'TT.::.......,...........ooooooooooooo.....................TT',
    'TT.::...................ooooooooooooo.........,.....########',
    'TT.::................T.......::..................T..########',
    'TT.::.............T..........::.....................########',
    'TT.::.....T.............T....::......T..............########',
    'TT.::........................::.....................########',
    'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
    'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
    'wwwwwwwwwwwwwwwwwwwwwwwwwwwww==wwwwwwwwwwwwwwwwwwwwwwwwwwwww',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~==~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~==~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~==~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~==~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~==~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~==~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  ],

  /** Where you stand when you come home, and who you walk as (the others wait on the square). */
  spawn: [30, 18],
  avatar: 'lamplighter',

  /**
   * Building plots: the building's frame covers x..x+w-1, y..y+h-1 (all solid); `door` is the
   * tile you walk up to (just below the frame) to go in. The Lamp Post is a lamp on the square:
   * one solid tile you can use from any side (`anySide`); its `door` is where its prompt sits.
   * `openAt`: the milestone that clears the fog in front of it ('start' when it's clear from the
   * beginning): until then it's a ruin in the fog you can't walk up to (the Lamp Post's levels push
   * the fog back to the Chapel, then the Smithy and the Apothecary, then the Cartographer and the
   * Market).
   */
  plots: [
    { building: 'lamp_post', x: 30, y: 15, w: 1, h: 1, door: [30, 16], anySide: true },
    // `windows`: where the building's windows are (tiles within the plot), for their light once
    // it's lit; the art's layout has them in the same places (tests/content.test.js).
    { building: 'library', x: 12, y: 6, w: 5, h: 4, door: [14, 10], windows: [[1, 2], [3, 2], [1, 3], [3, 3]] },
    { building: 'tavern', x: 42, y: 8, w: 5, h: 4, door: [44, 12], windows: [[1, 2], [3, 2], [1, 3], [3, 3]] },
    // Phase 7's six, where their ruins stood.
    { building: 'docks', x: 33, y: 21, w: 5, h: 4, door: [35, 25], windows: [[1, 2], [3, 2]], openAt: 'start' },
    { building: 'chapel', x: 27, y: 3, w: 5, h: 4, door: [29, 7], windows: [[1, 2], [3, 2]], openAt: 'lamp_post:3' },
    { building: 'smithy', x: 5, y: 11, w: 5, h: 4, door: [7, 15], windows: [[1, 2]], openAt: 'lamp_post:4' },
    { building: 'apothecary', x: 9, y: 19, w: 5, h: 4, door: [11, 23], windows: [[1, 2], [3, 2]], openAt: 'lamp_post:4' },
    { building: 'cartographer', x: 41, y: 19, w: 5, h: 4, door: [43, 23], windows: [[1, 2], [3, 2], [1, 3], [3, 3]], openAt: 'lamp_post:5' },
    { building: 'market', x: 48, y: 14, w: 5, h: 4, door: [50, 18], windows: [[1, 2], [3, 2]], openAt: 'lamp_post:5' },
    // 0.9.0: the Lighthouse, on the point east of the Market (it was a ruin in the fog for Phase 10).
    { building: 'lighthouse', x: 55, y: 14, w: 3, h: 4, door: [56, 18], windows: [], openAt: 'lamp_post:5' },
  ],

  /** Ruins with no building yet (0.9.0: none; the Lighthouse's plot is a building now). */
  ruins: [],

  /**
   * The fog's regions (tile rectangles [x, y, w, h]). A region clears when `revealedBy` is reached:
   * 'start', or '<building>:<level>'. A tile is clear when any region covering it is clear;
   * a tile no region covers stays in the fog. You can't walk into the fog.
   *
   * A building comes out of the fog all at once (§20 call 54): at every mix of levels, a plot or
   * ruin is either clear with a clear tile all round it, or fogged with a fogged tile all round it
   * (the fog's soft edge is a tile wide, so that tile keeps the edge off the building). The
   * content test checks every mix.
   */
  fog: [
    // Clear from the start: the square and the ruined Docks below it, the ruined Library and
    // Tavern, the quay west to the gate, and the pier.
    { id: 'square', revealedBy: 'start', rects: [[22, 10, 17, 15], [11, 5, 11, 10], [38, 6, 11, 7], [0, 24, 39, 4], [26, 28, 8, 8]] },
    // Each Lamp Post level pushes the fog back further from the square: the Chapel's ruin comes
    // out at level 3, the Smithy's and the Apothecary's at 4, the Cartographer's at 5.
    { id: 'lamp_1', revealedBy: 'lamp_post:1', rects: [[18, 8, 22, 17]] },
    { id: 'lamp_2', revealedBy: 'lamp_post:2', rects: [[34, 24, 18, 4], [18, 28, 26, 8]] },
    { id: 'lamp_3', revealedBy: 'lamp_post:3', rects: [[22, 2, 18, 9]] },
    { id: 'lamp_4', revealedBy: 'lamp_post:4', rects: [[2, 10, 20, 15]] },
    { id: 'lamp_5', revealedBy: 'lamp_post:5', rects: [[38, 12, 16, 12], [44, 23, 8, 5], [0, 28, 60, 8], [54, 13, 5, 7]] },
    // The Library's and the Tavern's streets clear as they come back. (The Lighthouse's point
    // clears with the Lamp Post's last level, in lamp_5.)
    { id: 'library_1', revealedBy: 'library:1', rects: [[11, 3, 11, 8]] },
    { id: 'library_3', revealedBy: 'library:3', rects: [[2, 3, 9, 7]] },
    { id: 'library_5', revealedBy: 'library:5', rects: [[2, 2, 22, 2]] },
    { id: 'tavern_1', revealedBy: 'tavern:1', rects: [[36, 3, 14, 9]] },
    { id: 'tavern_3', revealedBy: 'tavern:3', rects: [[48, 3, 10, 9]] },
    { id: 'tavern_5', revealedBy: 'tavern:5', rects: [[36, 2, 22, 2]] },
  ],

  /**
   * Things that appear as the town comes back, each on its own tile (solid once it's there):
   * `from` is the milestone that brings it ('start', '<building>:<level>', or 'runs:<n>', the
   * profile's runs), `sprite` its frame. `light`: it carries a lamp ('small', lit like the gate's).
   * `strung`: bunting runs from its lamp back to the lamp on that tile (the gate's).
   *
   * A prop stands where its building's own levels have cleared the fog (or where it's clear from
   * the start), out of everyone's way (tests/content.test.js).
   */
  props: [
    // The gate, from the start: its signpost, a bollard at the quay's edge and a coil of rope by it.
    // Then, as the town comes back: the Chapel's notice board, the Apothecary's supplies for the
    // road, a ship's bell from the Docks, a second lamp with bunting strung back to the gate's from
    // the Lamp Post's last level, and from the tenth run a townswoman waving you off.
    { id: 'gate_sign', sprite: 'hub_signpost', at: [2, 24], from: 'start' },
    { id: 'gate_bollard', sprite: 'hub_bollard', at: [4, 26], from: 'start' },
    { id: 'gate_rope', sprite: 'hub_rope_coil', at: [5, 26], from: 'start' },
    { id: 'gate_notice', sprite: 'hub_notice_board', at: [6, 24], from: 'chapel:1' },
    { id: 'gate_supplies', sprite: 'hub_supplies', at: [7, 24], from: 'apothecary:2' },
    { id: 'gate_bell', sprite: 'hub_ship_bell', at: [8, 24], from: 'docks:3' },
    { id: 'gate_lamp_2', sprite: 'hub_quay_lamp', at: [8, 26], from: 'lamp_post:5', light: 'small', strung: [2, 27] },
    { id: 'gate_waving', sprite: 'hub_townswoman_waving', at: [5, 24], from: 'runs:10' },
    // The square.
    { id: 'square_well', sprite: 'hub_well', at: [35, 13], from: 'lamp_post:2' },
    { id: 'square_tub', sprite: 'hub_tub', at: [24, 20], from: 'lamp_post:3' },
    { id: 'square_cart', sprite: 'hub_cart', at: [36, 19], from: 'lamp_post:4' },
    // Each building's own, by its levels (each where its streets are clear from the start).
    { id: 'library_cart', sprite: 'hub_cart', at: [17, 9], from: 'library:2' },
    { id: 'tavern_barrel', sprite: 'hub_barrel', at: [47, 11], from: 'tavern:2' },
    { id: 'tavern_table', sprite: 'hub_tavern_table', at: [47, 9], from: 'tavern:3' },
    { id: 'tavern_barrel_2', sprite: 'hub_barrel', at: [41, 11], from: 'tavern:4' },
    { id: 'docks_pots', sprite: 'hub_lobster_pots', at: [32, 22], from: 'docks:2' },
    { id: 'docks_oars', sprite: 'hub_oar_rack', at: [32, 24], from: 'docks:4' },
    { id: 'smithy_anvil', sprite: 'hub_anvil', at: [11, 14], from: 'smithy:2' },
    { id: 'smithy_grindstone', sprite: 'hub_grindstone', at: [11, 12], from: 'smithy:4' },
    { id: 'chapel_bench', sprite: 'hub_bench', at: [26, 10], from: 'chapel:2' },
    { id: 'chapel_graves', sprite: 'hub_graves', at: [33, 10], from: 'chapel:4' },
    { id: 'apothecary_herbs', sprite: 'hub_herb_pots', at: [9, 24], from: 'apothecary:3' },
    { id: 'cartographer_scope', sprite: 'hub_telescope', at: [38, 23], from: 'cartographer:3' },
    // The Market's stall goods at the square's east edge, out of every walk (the keepers' and an
    // arrival's), and its barrow beside them: a wheelbarrow, not a second cart.
    { id: 'market_crates', sprite: 'hub_market_crates', at: [37, 20], from: 'market:1' },
    { id: 'market_barrow', sprite: 'hub_wheelbarrow', at: [38, 21], from: 'market:3' },
    // 0.9.0 (W5): what Harbor Orders put in the harbor (`unlock`: the order; `name`: what the
    // board and the results call it). Each on ground clear from the start, out of every walk.
    // The sweep (D1): a hard order (tier 3 or more) opens something real, never only a prop, and a
    // merged order opens one thing. Those orders' props still come out once the order is done
    // (`from: 'feat:<id>'`), as town dressing: they have no `unlock` and no name, and aren't a reward.
    // The Lighthouse's later stages show on its point: a lamp on its path (6), a bench (7), its
    // salvage barrels (8), and a spyglass on the rocks (9); the beam is the view's (10).
    { id: 'lighthouse_lamp', sprite: 'hub_quay_lamp', at: [54, 15], from: 'lighthouse:6', light: 'small' },
    { id: 'lighthouse_bench', sprite: 'hub_bench', at: [54, 17], from: 'lighthouse:7' },
    { id: 'lighthouse_barrels', sprite: 'hub_barrel', at: [53, 15], from: 'lighthouse:8' },
    { id: 'lighthouse_scope', sprite: 'hub_telescope', at: [54, 13], from: 'lighthouse:9' },
    { id: 'order_lamp_west', sprite: 'hub_quay_lamp', at: [22, 11], from: 'feat:dawn', light: 'small' },
    { id: 'order_tally', name: 'Tally board', sprite: 'hub_notice_board', at: [37, 11], from: 'start', unlock: 'feat:ten_thousand' },
    { id: 'order_pots', name: 'Lobster pots', sprite: 'hub_lobster_pots', at: [20, 24], from: 'start', unlock: 'feat:gull_season' },
    { id: 'order_bell', name: "Bosun's bell", sprite: 'hub_ship_bell', at: [31, 22], from: 'start', unlock: 'feat:bosun_muster' },
    { id: 'order_barrels', name: 'Barrels', sprite: 'hub_barrel', at: [24, 21], from: 'start', unlock: 'feat:rat_catcher' },
    { id: 'order_lamp_east', sprite: 'hub_quay_lamp', at: [38, 15], from: 'feat:lamp_runner', light: 'small' },
    { id: 'order_bollard', name: 'Bollard', sprite: 'hub_bollard', at: [18, 24], from: 'start', unlock: 'feat:regular' },
    { id: 'order_crates', name: 'Salvage crates', sprite: 'hub_market_crates', at: [23, 23], from: 'start', unlock: 'feat:relic_hunter' },
    { id: 'order_bench', name: 'Quay bench', sprite: 'hub_bench', at: [22, 24], from: 'start', unlock: 'feat:long_night' },
    { id: 'order_rope', name: 'Rope coil', sprite: 'hub_rope_coil', at: [16, 24], from: 'start', unlock: 'feat:quick_trip' },
    { id: 'order_spyglass', sprite: 'hub_telescope', at: [27, 22], from: 'feat:warden_causeway' },
    { id: 'order_herbs', name: 'Herb pots', sprite: 'hub_herb_pots', at: [23, 19], from: 'start', unlock: 'feat:offering' },
    { id: 'order_graves', sprite: 'hub_graves', at: [22, 14], from: 'feat:cursed' },
    { id: 'order_supplies', name: 'Supplies', sprite: 'hub_supplies', at: [23, 15], from: 'start', unlock: 'feat:arcanist' },
    { id: 'order_tub', sprite: 'hub_tub', at: [22, 21], from: 'feat:level_100' },
    { id: 'order_cart', name: 'Oil cart', sprite: 'hub_cart', at: [36, 10], from: 'start', unlock: 'feat:long_wick' },
    { id: 'order_oars', sprite: 'hub_oar_rack', at: [31, 24], from: 'feat:pole_star' },
    { id: 'order_barrow', sprite: 'hub_wheelbarrow', at: [25, 10], from: 'feat:bog_host' },
  ],

  /**
   * Life about the town that's in nobody's way (0.7.3): townsfolk out walking, boats at their
   * moorings, and animals, each from a milestone ('start' or '<building>:<level>'). Drawn only:
   * none is solid, and nobody talks to them (render/hubtiles.js ambientLook).
   *   walk   walks `loop` (tiles, straight runs, round to the start) at `speed` px a second
   *   stand  stands on `at`, facing `facing` (1 east, -1 west); `perch` px up from the tile's foot
   *   moor   a boat riding at `at` (a tile of water), rising and falling on the swell
   */
  ambient: [
    { id: 'gulls_west', kind: 'stand', sprite: 'hub_gull_perched', at: [14, 27], facing: 1, perch: 12, from: 'docks:1' },
    { id: 'gulls_east', kind: 'stand', sprite: 'hub_gull_perched', at: [37, 27], facing: -1, perch: 12, from: 'docks:2' },
    { id: 'rowboat_west', kind: 'moor', sprite: 'hub_rowboat', at: [27, 30], from: 'docks:1' },
    { id: 'fisher', kind: 'walk', sprite: 'npc_fisher', loop: [[12, 26], [26, 26]], speed: 14, from: 'docks:2' },
    { id: 'dog', kind: 'walk', sprite: 'hub_dog', loop: [[13, 25], [27, 25]], speed: 20, from: 'docks:3' },
    { id: 'rowboat_east', kind: 'moor', sprite: 'hub_rowboat', at: [32, 29], from: 'docks:3' },
    { id: 'sailor', kind: 'walk', sprite: 'npc_sailor', loop: [[30, 26], [30, 32]], speed: 12, from: 'docks:4' },
    { id: 'sloop', kind: 'moor', sprite: 'hub_boat', at: [41, 31], from: 'docks:5' },
    { id: 'cat', kind: 'stand', sprite: 'hub_cat', at: [39, 12], facing: 1, from: 'tavern:3' },
    { id: 'shopper', kind: 'walk', sprite: 'npc_shopper', loop: [[37, 17], [46, 17], [46, 13], [37, 13]], speed: 13, from: 'market:2' },
  ],

  /** Where you set out for a run: walk up to this tile (the quay's west end, by the signpost and the lamp on the wall). */
  gate: { at: [2, 25], name: 'Drowned Docks', lamp: [2, 27] },

  /**
   * The pier: arrivals sail in along `boatRoute` (tiles, starting off the map, all on water), tie up
   * beside the pier, and step onto it at `landing`. Then they walk `walkUp` (straight runs) to the
   * square, and on to their waiting spot along the column and then the row (hub/map.js arrivalPath).
   * The route's last point is half a tile short of the pier, so the bow stops at its edge.
   * `aboard` and `deck`: where a newcomer stands in the boat, px ahead of its middle (in the bow,
   * clear of the jib) and below it (her feet on the deck, under the gunwale); she steps off from
   * there, so the walk starts where she was drawn (the view's numbers for the boat agree:
   * tests/harbor.test.js).
   */
  harbor: {
    boatRoute: [[-3, 32], [8, 33], [20, 33], [27.5, 33]],
    aboard: 16,
    deck: 4,
    landing: [29, 33],
    walkUp: [[29, 33], [29, 21]],
    lamp: [30, 33],            // a lamp at the pier's end, on its east half (solid, like any post)
  },

  /**
   * Where each keeper stands by their door (from their building's level 4) and the loop they walk
   * (from level 5): tiles, walked in order and back to the start, in straight runs along open
   * ground their own building's levels have cleared. The Lamp Keeper walks the square; the other
   * two walk around their buildings.
   */
  keepers: {
    lamp_keeper: { post: [31, 16], loop: [[31, 16], [34, 16], [34, 19], [26, 19], [26, 13], [31, 13]] },
    librarian: { post: [15, 10], loop: [[15, 10], [18, 10], [18, 4], [11, 4], [11, 10]] },
    innkeeper: { post: [45, 12], loop: [[45, 12], [48, 12], [48, 6], [40, 6], [40, 12]] },
    // Phase 7's six pace the street in front of their doors.
    dockhand: { post: [36, 25], loop: [[36, 25], [38, 25], [38, 26], [32, 26], [32, 25]] },
    smith: { post: [8, 15], loop: [[8, 15], [10, 15], [10, 16], [4, 16], [4, 15]] },
    warden: { post: [30, 7], loop: [[30, 7], [32, 7], [32, 8], [26, 8], [26, 7]] },
    apothecary: { post: [12, 23], loop: [[12, 23], [15, 23], [15, 24], [11, 24], [11, 23]] },
    cartographer: { post: [44, 23], loop: [[44, 23], [46, 23], [46, 24], [40, 24], [40, 23]] },
    trader: { post: [51, 18], loop: [[51, 18], [53, 18], [53, 19], [47, 19], [47, 18]] },
    lighthouse_keeper: { post: [57, 18], loop: [[57, 18], [57, 19], [54, 19], [54, 18]] },
  },

  /** Where characters you've unlocked wait around the square. */
  // 0.9.0: six, for the brief's six characters (W2 brings two more).
  waiting: [[27, 14], [33, 14], [27, 18], [33, 18], [27, 20], [33, 20]],
};
