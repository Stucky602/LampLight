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
   */
  plots: [
    { building: 'lamp_post', x: 30, y: 15, w: 1, h: 1, door: [30, 16], anySide: true },
    // `windows`: where the building's windows are (tiles within the plot), for their light once
    // it's lit; the art's layout has them in the same places (tests/content.test.js).
    { building: 'library', x: 12, y: 6, w: 5, h: 4, door: [14, 10], windows: [[1, 2], [3, 2], [1, 3], [3, 3]] },
    { building: 'tavern', x: 42, y: 8, w: 5, h: 4, door: [44, 12], windows: [[1, 2], [3, 2], [1, 3], [3, 3]] },
  ],

  /**
   * Plots for the buildings Phase 7 builds (and the Lighthouse, Phase 10): drawn as ruins, most of
   * them in the fog (the Docks' ruin sits below the square, in view from the start), so the town
   * already has its shape.
   */
  ruins: [
    { id: 'chapel', x: 27, y: 3, w: 5, h: 4 },
    { id: 'smithy', x: 5, y: 11, w: 5, h: 4 },
    { id: 'market', x: 50, y: 13, w: 5, h: 4 },
    { id: 'apothecary', x: 9, y: 19, w: 5, h: 4 },
    { id: 'cartographer', x: 41, y: 19, w: 5, h: 4 },
    { id: 'docks', x: 33, y: 21, w: 5, h: 4 },
    { id: 'lighthouse', x: 55, y: 17, w: 3, h: 4 },
  ],

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
    { id: 'square', revealedBy: 'start', rects: [[22, 10, 17, 15], [11, 5, 11, 10], [38, 6, 11, 9], [0, 24, 39, 4], [26, 28, 8, 8]] },
    // Each Lamp Post level pushes the fog back further from the square: the Chapel's ruin comes
    // out at level 3, the Smithy's and the Apothecary's at 4, the Cartographer's at 5.
    { id: 'lamp_1', revealedBy: 'lamp_post:1', rects: [[18, 8, 22, 17]] },
    { id: 'lamp_2', revealedBy: 'lamp_post:2', rects: [[34, 24, 18, 4], [18, 28, 26, 8]] },
    { id: 'lamp_3', revealedBy: 'lamp_post:3', rects: [[22, 2, 18, 9]] },
    { id: 'lamp_4', revealedBy: 'lamp_post:4', rects: [[2, 10, 20, 15]] },
    { id: 'lamp_5', revealedBy: 'lamp_post:5', rects: [[38, 12, 11, 12], [44, 23, 8, 5], [0, 28, 60, 8]] },
    // The Library's and the Tavern's streets clear as they come back. (The Market's ruin and the
    // Lighthouse stay in the fog: Phase 7 and Phase 10 bring them out.)
    { id: 'library_1', revealedBy: 'library:1', rects: [[11, 3, 11, 8]] },
    { id: 'library_3', revealedBy: 'library:3', rects: [[2, 3, 9, 7]] },
    { id: 'library_5', revealedBy: 'library:5', rects: [[2, 2, 22, 2]] },
    { id: 'tavern_1', revealedBy: 'tavern:1', rects: [[36, 3, 14, 9]] },
    { id: 'tavern_3', revealedBy: 'tavern:3', rects: [[48, 3, 10, 9]] },
    { id: 'tavern_5', revealedBy: 'tavern:5', rects: [[36, 2, 22, 2]] },
  ],

  /**
   * Things that appear as the town comes back, each on its own tile (solid once it's there):
   * `from` is the milestone that brings it ('start', or '<building>:<level>'), `sprite` its frame.
   */
  props: [
    { id: 'gate_sign', sprite: 'hub_signpost', at: [2, 24], from: 'start' },
    { id: 'square_well', sprite: 'hub_well', at: [35, 13], from: 'lamp_post:2' },
    { id: 'square_tub', sprite: 'hub_tub', at: [24, 20], from: 'lamp_post:3' },
    { id: 'square_cart', sprite: 'hub_cart', at: [36, 19], from: 'lamp_post:4' },
    { id: 'library_cart', sprite: 'hub_cart', at: [17, 9], from: 'library:2' },
    { id: 'tavern_barrel', sprite: 'hub_barrel', at: [47, 11], from: 'tavern:2' },
    { id: 'tavern_barrel_2', sprite: 'hub_barrel', at: [41, 11], from: 'tavern:4' },
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
  },

  /** Where characters you've unlocked wait around the square. */
  waiting: [[27, 14], [33, 14], [27, 18], [33, 18]],
};
