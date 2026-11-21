// Harbor Orders for the characters (W2 owns this file; work/veteran/W5-CONTRACT.md §1).
// Each entry is an order as data/feats.js describes; exactly one piece of content carries
// unlock: 'feat:<id>' for each. data/feats.js appends this list to the board.
// 0.9.0 (W2, ruling 2): the Tide Priest's arrival, and one order per character, each asking for what
// they do best. Ruling 15 (C2): each opens a skill of that character's tree (data/skills.js; their
// set run opens the other). The signature's capstone opens in the run, by the character's own deed.

const MARSH = 'salt_marsh';

export const CHARACTER_ORDERS = [
  // The Tide Priest can't heal: the order that brings her asks the same of you.
  { id: 'tide_priest_call', name: 'Untouched Tide', desc: 'Reach 15:00 in one run and take 100 damage or less all run.', group: 'character', tier: 2, by: 'warden', visibility: 'visible',
    // 100 (W2, measured): the mortal bot took 23 to 348 by 15:00 (median about 130); at 40 it met
    // this in 2 runs of 40, at 100 in 9 (the Lamplighter most often). work/veteran/W2/runs/unlock15.txt.
    when: { surviveSec: 900, damageTakenMax: 100 }, reward: { unlock: true } },
  { id: 'lamplighter_wards', name: 'Every Lamp', desc: 'Light 10 Wayside Lamps in one run as the Lamplighter.', group: 'character', tier: 2, by: 'lamp_keeper', visibility: 'visible',
    when: { character: 'lamplighter', lamps: 10 }, reward: { unlock: true } },
  { id: 'harpooner_reel', name: 'Reliquary Hook', desc: 'Open 3 Reliquaries in one run as the Harpooner.', group: 'character', tier: 2, by: 'dockhand', visibility: 'visible',
    when: { character: 'harpooner', reliquaries: 3 }, reward: { unlock: true } },
  { id: 'punter_marsh', name: 'High Water Run', desc: 'Kill the last boss on the Salt Marsh at Tide 2 as the Punter.', group: 'character', tier: 3, by: 'cartographer', visibility: 'visible',
    when: { cleared: true, map: MARSH, tide: 2, character: 'punter' }, reward: { unlock: true } },
  // (C6: Pell's order 'causeway' asked the same of everyone, and only she can raise the cache.)
  { id: 'warden_causeway', was: ['causeway'], name: 'Causeway Walk', desc: 'Find the secret on the Drowned Causeway as the Bog Warden.', group: 'character', tier: 3, by: 'warden', visibility: 'visible',
    when: { character: 'bog_warden', secret: 'drowned_causeway' }, reward: { unlock: true } },
  { id: 'drowned_man_bosses', name: 'Three Debts', desc: 'Kill 3 bosses in one run as the Drowned Man.', group: 'character', tier: 3, by: 'dockhand', visibility: 'visible',
    when: { character: 'drowned_man', bosses: 3 }, reward: { unlock: true } },
  { id: 'tide_priest_bells', name: 'Twice Rung', desc: 'Ring Fog Bells 6 times in one run as the Tide Priest. She can ring each bell twice.', group: 'character', tier: 3, by: 'warden', visibility: 'visible',
    when: { character: 'tide_priest', bells: 6 }, reward: { unlock: true } },
];
