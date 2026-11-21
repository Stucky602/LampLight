// The harbor's people (ARCHITECTURE §10.4). Each keeper stands at their building's door from its
// level 4, and walks the streets from level 5. They say short lines, keyed to milestones: when you
// walk up to them, the last line in the list whose milestone is reached ('<building>:<level>', or
// 'start'), so the list runs from what comes first to what comes last, and a keeper's own last
// level goes at the end (tests/content.test.js checks every line can be heard once its keeper is
// out, at the home's level 4). Plain speech; a little dry.
// 0.9.0 (W5; the veteran round: "townsfolk never react to your runs"): a line can key to a run's
// milestone too: an order done ('feat:<id>'), a boss killed ('boss:<id>'), a secret found
// ('secret:<id>'), a map's Tide ('tide:<map>:<n>'), the runs played ('runs:<n>'), or the
// Lighthouse's stages. Lines run in the order they usually happen, so the newest one shows.
//
// role: what they do, said with their name wherever the player meets it ('Ned, the dockhand'),
// since a name alone means nothing to a new player. sprite: an atlas frame (art/manifest.js).
// home: the building they keep.

export const NPCS = [
  {
    id: 'lamp_keeper', name: 'Old Wick', role: 'lamp keeper', desc: 'Lit the harbor\'s lamps for 40 years, until the fog came.', sprite: 'npc_lamp_keeper', home: 'lamp_post',
    lines: [
      { when: 'lamp_post:4', text: 'Forty years I lit these streets. Nice to have help.' },
      { when: 'docks:2', text: 'Boats at the pier again. I keep counting them.' },
      { when: 'library:5', text: 'Silas says you read everything twice. Good habit.' },
      { when: 'lamp_post:5', text: 'The fog backs off from a steady flame. Keep it fed.' },
      { when: 'tide:drowned_docks:5', text: 'Tide 5 on the docks. I lit those lamps in worse, but not by much.' },
      { when: 'lighthouse:5', text: 'Somebody lit the keeper\'s room on the point. First time in years.' },
      { when: 'lighthouse:10', text: 'The lighthouse is lit. I\'ll stick to the streets.' },
    ],
  },
  {
    id: 'librarian', name: 'Silas', role: 'librarian', desc: 'Runs the Library.', sprite: 'npc_librarian', home: 'library',
    lines: [
      { when: 'library:4', text: 'Half these pages are too wet to read. The rest are worth drying.' },
      { when: 'cartographer:2', text: 'Pell keeps a tally of what you kill. I keep a tally of Pell.' },
      { when: 'library:5', text: 'Bring me more Drowned Pages. The wettest ones have the best stories.' },
      { when: 'secret:wreck_cache', text: 'You found what was in the wreck\'s hold. Pell will say he told you.' },
      { when: 'secret:drowned_causeway', text: 'The causeway goes somewhere after all. I owe Pell a drink.' },
      { when: 'runs:100', text: 'A hundred runs. The codex is twice as thick as when you started.' },
    ],
  },
  {
    id: 'innkeeper', name: 'Bram', role: 'innkeeper', desc: 'Runs the Tavern.', sprite: 'npc_innkeeper', home: 'tavern',
    lines: [
      { when: 'tavern:4', text: 'Sit anywhere. Most of the chairs have legs now.' },
      { when: 'apothecary:3', text: 'Moss sends people here after her salves. I send them back.' },
      { when: 'tavern:5', text: 'Sailors started coming back once the lamps were lit.' },
      { when: 'feat:dawn', text: 'The Tidecaller\'s bell has stopped. Drinks are on you.' },
      { when: 'boss:salt_widow', text: 'The Salt Widow\'s dead. Half the bar claims they saw it.' },
      { when: 'runs:50', text: 'Fifty runs. The board out back is your fault, you know.' },
    ],
  },
  {
    id: 'dockhand', name: 'Ned', role: 'dockhand', desc: 'Keeps the Docks.', sprite: 'npc_dockhand', home: 'docks',
    lines: [
      { when: 'docks:4', text: 'The Ferryman pays in favors. I take them.' },
      { when: 'market:2', text: 'Fenn buys the Pearls you bring back. Don\'t tell the Ferryman.' },
      { when: 'docks:5', text: 'Every hull here floats now. I patched three this week.' },
      { when: 'secret:breakwater_point', text: 'The drowned fellow sleeps in the boathouse. He drips on everything.' },
      { when: 'feat:regular', text: 'The Ferryman asked after you. He never asks after anyone.' },
      { when: 'tide:salt_marsh:5', text: 'Tide 5 on the marsh. I\'d have rowed the other way.' },
    ],
  },
  {
    id: 'smith', name: 'Hob', role: 'smith', desc: 'Runs the Smithy.', sprite: 'npc_smith', home: 'smithy',
    lines: [
      { when: 'smithy:4', text: 'Bring iron. I can make most things out of most things.' },
      { when: 'chapel:3', text: 'Hale asked me for a bell. I made him a louder one.' },
      { when: 'smithy:5', text: 'Six slots. Wear them all or the work was for nothing.' },
      { when: 'feat:three_forms', text: 'Three Forms on one weapon. Show me, but don\'t point it at the forge.' },
      { when: 'lighthouse:7', text: 'I cut the lens frame for the lighthouse. Fit on the first try.' },
    ],
  },
  {
    id: 'warden', name: 'Brother Hale', role: 'chapel keeper', desc: 'Keeps the Chapel.', sprite: 'npc_warden', home: 'chapel',
    lines: [
      { when: 'chapel:4', text: 'The tide comes higher every time you ask it to.' },
      { when: 'feat:tide_priest_call', text: 'The Tide Priest came by boat. She won\'t take food. Says she fasts on flood days.' },
      { when: 'lamp_post:5', text: 'The big lamp burns all night now. I sleep worse and pray less.' },
      { when: 'chapel:5', text: 'Tide 10 is the last one the chapel can call.' },
      { when: 'tide:drowned_docks:10', text: 'Tide 10 cleared. I rang the chapel bell for it.' },
      { when: 'tide:salt_marsh:10', text: 'Both maps at Tide 10. There\'s no Tide 11, so don\'t ask.' },
    ],
  },
  {
    id: 'trader', name: 'Fenn', role: 'trader', desc: 'Runs the Market.', sprite: 'npc_trader', home: 'market',
    lines: [
      { when: 'market:4', text: 'A bad trade beats no trade when you\'re short of Timber.' },
      { when: 'smithy:5', text: 'Hob wants iron and pays in iron. I\'m working on it.' },
      { when: 'market:5', text: 'Pearls are no use to me. I buy them anyway, for Coin.' },
      { when: 'feat:glass_hoard', text: 'Three hundred Pearls at once. Next time bring them here.' },
      { when: 'lighthouse:9', text: 'The light ate a whole year\'s oil. I sold it the oil.' },
    ],
  },
  {
    id: 'apothecary', name: 'Old Moss', role: 'apothecary', desc: 'Runs the Apothecary.', sprite: 'npc_apothecary', home: 'apothecary',
    lines: [
      { when: 'apothecary:4', text: 'Drink it before you go out. Not after.' },
      { when: 'cartographer:3', text: 'Bring me a rat\'s tail and I\'ll stop asking where you got it.' },
      { when: 'apothecary:5', text: 'Three bottles a run. More and you rattle.' },
      { when: 'feat:marsh_dawn', text: 'You crossed the whole marsh. Sit down and let me see your feet.' },
      { when: 'boss:old_grey', text: 'The Old Grey\'s gone quiet. The frogs are louder now.' },
    ],
  },
  {
    id: 'cartographer', name: 'Pell', role: 'mapmaker', desc: 'Keeps the charts.', sprite: 'npc_cartographer', home: 'cartographer',
    lines: [
      { when: 'cartographer:4', text: 'The docks are bigger than they look. Check the corners.' },
      { when: 'library:4', text: 'Silas copies my charts and gets the coast wrong. On purpose, I think.' },
      { when: 'cartographer:5', text: 'I marked the wreck. Don\'t say I gave it away.' },
      { when: 'secret:drowned_causeway', text: 'The causeway was on my chart the whole time. I drew it in the wrong place.' },
      { when: 'runs:100', text: 'A hundred runs, and my charts still have blank bits. Keep looking.' },
    ],
  },
  {
    id: 'lighthouse_keeper', name: 'Maren', role: 'lighthouse keeper', desc: 'Kept the light on the point before the fog.', sprite: 'npc_lighthouse_keeper', home: 'lighthouse',
    lines: [
      { when: 'lighthouse:4', text: 'Glass in the lantern room again. I keep cleaning it anyway.' },
      { when: 'lighthouse:6', text: 'The gallery holds. I walked it twice to be sure.' },
      { when: 'lighthouse:8', text: 'Rang the fog bell at noon. Half the town came to look.' },
      { when: 'lighthouse:10', text: 'She\'s lit. Ships could find us now, if there were any.' },
    ],
  },
];

/**
 * What each character says waiting on the square, when you walk up to them (0.7.3: every
 * character has one, those arriving later too; a character's own `hubLine` in data/characters.js
 * comes first). The one you walk as (data/hub.js avatar) never waits, but has a line for the day
 * someone else walks the harbor. One person each, not a template.
 */
export const WAITING_LINES = Object.freeze({
  lamplighter: 'Lamps are out on the docks again. Say when.',
  harpooner: 'Tide\'s turning. Say the word and I\'ll head out.',
  punter: 'Good water for poling today.',
});
