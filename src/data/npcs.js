// The harbor's people (ARCHITECTURE §10.4). Each keeper stands at their building's door from its
// level 4, and walks the streets from level 5. They say short lines, keyed to milestones: when you
// walk up to them, the last line in the list whose milestone is reached ('<building>:<level>', or
// 'start'), so the list runs from what comes first to what comes last, and a keeper's own last
// level goes at the end (tests/content.test.js checks every line can be heard once its keeper is
// out, at the home's level 4). Plain speech; a little dry.
//
// sprite: an atlas frame (art/manifest.js). home: the building they keep.

export const NPCS = [
  {
    id: 'lamp_keeper', name: 'Old Wick', desc: 'Lamplighter for 40 years, until the fog came.', sprite: 'npc_lamp_keeper', home: 'lamp_post',
    lines: [
      { when: 'lamp_post:4', text: 'Forty years I lit these streets. Nice to have help.' },
      { when: 'library:5', text: 'Silas says you read everything twice. Good habit.' },
      { when: 'lamp_post:5', text: 'The fog backs off from a steady flame. Keep it fed.' },
    ],
  },
  {
    id: 'librarian', name: 'Silas', desc: 'Runs the Library.', sprite: 'npc_librarian', home: 'library',
    lines: [
      { when: 'library:4', text: 'Half these pages are soup. The other half are worth it.' },
      { when: 'library:5', text: 'Bring me more drowned pages. The sea keeps the good stories.' },
    ],
  },
  {
    id: 'innkeeper', name: 'Bram', desc: 'Runs the Tavern.', sprite: 'npc_innkeeper', home: 'tavern',
    lines: [
      { when: 'tavern:4', text: 'Sit anywhere. Most of the chairs have legs now.' },
      { when: 'tavern:5', text: 'Sailors come back when the lamps do. Funny, that.' },
    ],
  },
];
