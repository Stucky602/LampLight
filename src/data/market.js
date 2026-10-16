// The Market's trades (ARCHITECTURE §10.6): a fixed table, deliberately poor, so it fills a gap
// rather than replacing a run. Common materials trade among themselves `common` for 1; it takes
// `toRare` commons for 1 rare; a rare gives `fromRare` commons. The rates improve with the
// Market's level (data/buildings.js market). Later maps' materials join the lists with their maps.

export const MARKET = Object.freeze({
  common: Object.freeze(['coin', 'oil', 'timber', 'rope', 'drowned_pages', 'rum']),
  rare: Object.freeze(['iron', 'map_scraps']),
  rates: Object.freeze({
    1: Object.freeze({ common: 5, toRare: 30, fromRare: 3 }),
    2: Object.freeze({ common: 4, toRare: 24, fromRare: 4 }),
    3: Object.freeze({ common: 3, toRare: 18, fromRare: 5 }),
  }),
});
