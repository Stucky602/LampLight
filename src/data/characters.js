// Characters (ARCHITECTURE §5.12, §11). Each has a unique mechanic (a hook in
// src/sim/hooks-characters.js), not only a different starting weapon (brief §5.4).
//
// Ruling 14 section D (C2): each character is a signature weapon that grows on its own track, a
// trade that fires on its own (where they walk and face, what they are near, a meter, a clock;
// never the dash: ruling 16), a cost that is felt, a skill tree (data/skills.js), and a starting
// dash item (data/dashes.js `character`). The fields:
//   who        one line: who they are
//   desc       one line: what they do (the gate's card leads with it)
//   gives      one line: what they do on the map (their trade)
//   costs      one line: what they give up for it
//   signature  their own weapon (data/signatures.js), in weapon slot 0 from 0:00 beside `start`
//              (their first weapon, or a kit's). It is never in the draft.
//   mechanic   their hook and its numbers
//   trade      their trade's id and numbers (sim/trades.js). Every trade carries the track's:
//              clock (s between the clock's upgrades), per (trade deeds to an upgrade), gap (s a
//              trade upgrade waits after the last one: no kill rate feeds it faster), deed (the
//              count that opens the signature's capstone axis), deedText (the card's line for it).
//              `sites` are places on a map only their trade uses ({ <map id>: [[col, row]...] }).
//   base       player stats that differ from tuning.player.stats
// noHeal: this character can't heal (the Tide Priest: her hook turns every heal to nothing). The run
// gets RunConfig.noHeal and no food drops; relics and run tools that only heal are kept from her.
// hubLine: what they say waiting on the harbor's square. find: how a character not yet arrived
// comes, for the Tavern (brief §6.5).
// No line here gives a distance in pixels: a player has no ruler.
// A number in a line is a placeholder that reads the data (data/textnum.js), filled at the end of
// this file: {m.x} the mechanic's params, {t.x} the trade's, {b.x} base stats, {s.x} the standard
// player's (tuning). Change the number, and every line that says it follows.

import { TUNING } from './tuning.js';
import { fillFields } from './textnum.js';

export const CHARACTERS = [
  {
    id: 'lamplighter', name: 'Lamplighter', sprite: 'pc_lamplighter',
    who: 'Lights the harbor\'s lamps, and carries one that burns enemies.',
    desc: 'Her Lamplight burns enemies near her. With {m.flameKills} or more enemies in it, she gains a spare flame every {m.flameGap}s, up to {m.flames}.',
    start: 'flare_gun', signature: 'lamplight',
    base: { maxHp: 100 },
    // flameKills: kills in her light to a spare flame; flames: she holds this many; lantern*: a
    // planted lantern's size and burn (shares of her own lamp's) and seconds; oilFull: s her lamp
    // holds full away from a lit lamp; oilDim: s it then takes to dim; oilLow: what it dims to (reach and burn).
    mechanic: { hook: 'lamplighter', params: { flameKills: 5, flameGap: 5, plantStill: 1, plantGap: 3, flames: 3, lanternMul: 0.6, lanternDamage: 0.6, lanternSec: 15, lanternUp: 0.1, lampLantern: 60, flameArea: 0.05, flameMoveArea: 0.15, flameMight: 0.15, darkEvery: 30, oilFull: 60, oilDim: 30, oilLow: 0.6 } },
    // touch: a lamp lights the moment she's in its ring; heldMul: a held lamp's time for her;
    // wardMul: her lamps' wards' reach; nights: Lantern Nights banked when every lamp is lit;
    // crowd: enemies close by that bring hers on; lightMul: her Lantern Night's light reach.
    // Deeds: a lamp lit is `per` (one upgrade), a lantern planted is 1.
    trade: { id: 'lamps', params: { marshFlame: 0.5, marshArea: 0.5, marshOil: 2, touch: 1, heldMul: 0.25, wardMul: 2, nights: 2, crowd: 10, lightMul: 1.3, clock: 180, lvEvery: 0, per: 3, gap: 40, span: 180, grow: 0, growMax: 3, pastCap: 0.04, pastMax: 0.4, deed: 5 }, deedText: 'Light {t.deed} lamps' },
    gives: 'Lamps light the moment she reaches them. Lighting a lamp fills her spare flames and refills her Fuel. Each spare flame gives Lamplight +{m.flameMight%} Damage, and +{m.flameMoveArea%} Area while she moves (+{m.flameArea%} while she stands). Each lamp she lights leaves a lantern by it. While her light is dimmed, she also sets down a lantern every {m.darkEvery}s. A lantern lasts {m.lampLantern}s, burns enemies in its light at {m.lanternDamage%} of Lamplight\'s damage, and gives Lamplight +{m.lanternUp%} Damage while it stands. Lighting every lamp gets her {t.nights} Lantern Nights ready. On the Salt Marsh her light has +{t.marshArea%} Area, her Fuel lasts twice as long, and spare flames fill twice as fast.',
    costs: 'Her light runs on Fuel. Away from lit lamps her Fuel lasts {m.oilFull}s, then her light dims over {m.oilDim}s, down to {m.oilLow%} Area and Damage, and her Pickup Range to {m.oilLow%}. Standing in a lit lamp\'s light refills it.',
    // The gate's card (C3, ruling 14 E): one line of what they do, one of what it costs. Kept true to `desc` and `costs`.
    card: { does: 'Her lamp burns enemies in its light.', costs: 'Her light dims when her Fuel runs out.' },
    unlock: 'starter',
  },
  {
    id: 'harpooner', name: 'Harpooner', sprite: 'pc_harpooner',
    who: 'A whaler from the harbor\'s last crew. She fights best in the middle of the crowd.',
    desc: 'Her Grapnel and chains pull enemies in and stun them, and she gains Armor for each enemy close by.',
    start: 'anchor_chain', signature: 'grapnel', noDraft: ['tide_bell'],   // (ruling 17 K1: her own, not a second haul)
    base: { maxHp: 110 },
    // daze: seconds an enemy she hits can't walk or hurt her (bosses are immune); haulDaze: the
    // Grapnel's haul; haulTo: px from her a hauled enemy stops; catchRadius: px from its last bite the hook
    // catches a living enemy when that bite killed (C2b).
    mechanic: { hook: 'harpooner', params: { armorPerNear: 0.3, nearRadius: 40, cap: 10, pull: 0.6, daze: 0.4, haulDaze: 1, haulTo: 26, crowdHurt: 0.2, bigGame: 0.5, marshMight: 0.3, catchRadius: 48 } },
    // reach: px her hook reaches; reel: px/s loot comes in; every: s between the hook's throws (it
    // throws itself the way she faces); yankTo: px from her an elite lands (90: in her weapons' reach, out of its own;
    // W2's measurements); yankDaze: s it's dazed; gaff, gaffSec: a yanked elite takes this much
    // more for this long. Deeds: an elite landed is perElite, loot or a post perLoot, of `per`.
    trade: { id: 'hook', params: { reach: 200, marshReach: 2, reel: 300, every: 6, yankTo: 90, yankDaze: 2, gaff: 0.3, gaffSec: 4, postRadius: 22, clock: 180, lvEvery: 0, per: 6, perElite: 4, perLoot: 2, haulDeed: 25, gap: 40, span: 180, grow: 0, growMax: 3, pastCap: 0.04, pastMax: 0.4, deed: 6 }, deedText: 'Pull in {t.deed} elites with her hook' },
    gives: 'Every {t.every}s her hook flies the way she faces. It pulls in an elite or a chest, or calls the Ferryman to a mooring post. Her Grapnel deals {m.bigGame%} more damage to bosses. On the Salt Marsh her hook reaches twice as far for an elite, and her Grapnel gets +{m.marshMight%} Damage.',
    costs: 'She takes {m.crowdHurt%} more damage. Her Grapnel and chains pull enemies close, so she is always in the crowd.',
    // The gate's card (C3, ruling 14 E): one line of what they do, one of what it costs. Kept true to `desc` and `costs`.
    card: { does: 'Her Grapnel and chains pull in and stun enemies.', costs: 'She takes {m.crowdHurt%} more damage.' },
    unlock: 'building:lamp_post:2',
    hubLine: 'Tide\'s turning. Say the word and I\'ll head out.',
  },
  // The Salt Marsh (0.8.0).
  {
    id: 'punter', name: 'Punter', sprite: 'pc_punter',
    who: 'A marsh boatman. He hits hardest while he keeps moving in a straight line.',
    desc: 'Running straight builds Momentum: up to +{m.steps*perStep%} Damage and +{m.steps*reachPerStep%} Punt Pole Area. At full Momentum the pole sweeps all around him every {m.sweepEvery}s.',
    start: 'glass_caltrops', signature: 'punt_pole',   // (Ruling 23 KB: glass dropped as he runs, for a man who never stops; the Lantern Orb ran away at T5)
    base: { maxHp: 95 },
    // Momentum: `steps` steps of `perStep` Damage each; it fills over `fill` s of real movement
    // (ground covered, at least `pace` of his walking pace) and empties over `drain` s; `empty`:
    // his Damage with none; hitSteps: steps a hit he takes knocks off; turnCos: a turn sharper than
    // this (the cosine) against his heading a second ago bleeds a step (the cost: hold a line); reachPerStep: each step lengthens Punt Pole's reach by this share (C2b). sweep*: at full Momentum, the pole's sweep every sweepEvery s
    // (reach in px, a share of the pole's damage, its throw).
    mechanic: { hook: 'punter', params: { steps: 4, perStep: 0.1, fill: 4, drain: 1.5, pace: 0.6, empty: -0.25, hitSteps: 2, turnCos: 0.5, reachPerStep: 0.04, glassPerStep: 0.15, sweepEvery: 3, sweepRadius: 56, sweepMul: 1.2, sweepKnock: 2.4 } },
    // water: his speed poling across water; caches: punt caches a high water (the Marsh) or an act
    // (the Docks); ring: px of a cache's ring. The punt (X4): punt: s a fresh pole lasts on the
    // water; rest: s on land until it's fresh again; tired: s left when the tiring is said; winded:
    // his speed ashore until then (1: not slowed, ruling 14). Deeds: a sweep that hits 3 or more is 1; a cache is two upgrades.
    trade: { id: 'pole', params: { marshSweep: 2, water: 1, caches: 1, marshCache: 300, ring: 14, punt: 5, rest: 3, tired: 1.5, winded: 1, clock: 180, lvEvery: 0, per: 3, gap: 40, span: 180, grow: 0, growMax: 3, pastCap: 0.04, pastMax: 0.4, deed: 150 }, deedText: 'Hit {t.deed} enemies with sweeps' },
    gives: 'Each step of Momentum gives his Glass Caltrops -{m.glassPerStep%} Cooldown. He can cross water for {t.punt}s at a time. Enemies on foot can\'t follow him there. Pushing off from the water fills his Momentum. A floating chest comes out on the water for him, {t.caches} each act. On the Salt Marsh one comes about every {t.marshCache/60} minutes of high water instead, and each sweep counts twice toward Punt Pole\'s next level.',
    costs: 'A sharp turn loses 1 step of Momentum. Taking a hit loses {m.hitSteps/m.steps%} of it. Stopping loses all of it. With no Momentum his weapons deal {-m.empty%} less damage. {b.maxHp} Max HP.',
    // The gate's card (C3, ruling 14 E): one line of what they do, one of what it costs. Kept true to `desc` and `costs`.
    card: { does: 'Straight runs build Momentum: up to +{m.steps*perStep%} Damage.', costs: 'Turns, hits, and stops lose Momentum.' },
    unlock: 'feat:first_crossing',
    hubLine: 'Water\'s low today. I can still get you up the creeks.',
  },
  {
    id: 'bog_warden', name: 'Bog Warden', sprite: 'pc_bog_warden',
    who: 'She tends the dead buried in the marsh peat.',
    desc: 'Enemies that die rotting, or in the grip of her Bog Hands, rise and fight for her. They deal more damage as Bog Hands levels up.',
    start: 'eel_pot', signature: 'bog_hands',
    base: { maxHp: 130 },
    // sec: how long a thrall stands; max: at once; biteMul: its bite, a share of a Bog Hands grasp;
    // every: s between bites; speed (px/s) and reach (px): its hunt; eliteMul: an elite thrall's
    // bite; others: her other weapons' damage share (the cost); walk*: the fresh dead she walks
    // over rise (px of her reach, s between raises, s a body stays fresh); boss*: a boss her dead
    // bite rots this long and deep, and sheds a thrall every bossEvery s while it rots.
    // guardR: px round her her dead go for first (they stand between her and the crowd); hold: s a
    // thrall's bite holds an ordinary enemy (C2b, Nov 20: her T5 deaths were contact at every Bog Hands setting).
    mechanic: { hook: 'bog_warden', params: { sec: 6, max: 6, biteMul: 0.2, every: 0.5, speed: 70, reach: 200, eliteMul: 3, others: -0.1, guardPer: 1, guardCap: 6, guardR: 90, hold: 0.4, walkRadius: 30, walkEvery: 0.5, freshSec: 5, bossRot: 3, bossAmp: 0.15, bossEvery: 5 } },
    // ring: px of a body's or crew's ring; bodySec, bodyBite: a bog body's time and bite; crewN,
    // crewSec, crewBite: a wreck crew's. Deeds: one of her dead raised is 1; a site is one upgrade.
    trade: {
      id: 'raise', params: { ring: 24, bodySec: 40, marshBody: 2.5, bodyBite: 30, crewN: 4, crewSec: 30, crewBite: 14, clock: 180, lvEvery: 0, per: 40, gap: 40, span: 180, grow: 0, growMax: 3, pastCap: 0.04, pastMax: 0.4, deed: 120 }, deedText: 'Raise {t.deed} dead',
      sites: {
        salt_marsh: [[46, 60], [150, 40], [30, 176], [96, 150], [196, 128], [140, 214]],
        drowned_docks: [[204, 46], [118, 196], [206, 190], [58, 132], [168, 60]],
      },
    },
    gives: 'Walking over an enemy within {m.freshSec}s of its death raises it as a thrall. Bog bodies and wreck crews on the map rise when she reaches them. Each thrall gives her {m.guardPer} Armor, up to {m.guardCap}. On the Salt Marsh, only she can raise the dead on the Drowned Causeway.',
    costs: 'Her weapons other than Bog Hands deal {-m.others%} less damage.',
    // The gate's card (C3, ruling 14 E): one line of what they do, one of what it costs. Kept true to `desc` and `costs`.
    card: { does: 'Enemies dying in her grip rise to fight for her.', costs: 'Her other weapons deal {-m.others%} less damage.' },
    unlock: 'feat:eel_season',
    hubLine: 'Peat keeps a body for a hundred years. I\'ve dug up older.',
  },
  // 0.9.0 (W2): the brief's six. The Drowned Man is what has washed up at Breakwater Point.
  {
    id: 'drowned_man', name: 'Drowned Man', sprite: 'pc_drowned_man',
    who: 'Drowned off the breakwater and came back. He collects pennies to raise sunken crates.',
    desc: 'His Grave Pennies finish ordinary enemies under {m.below%} HP. Each penny that lands close to him pays into his purse.',
    start: 'oil_flask', signature: 'grave_pennies',   // (ruling 17 K1: not the Harpooner's weapon)
    base: { maxHp: 85, moveSpeed: 0.85 },   // (a drowned man, heavy with the sea: the cost that stays all run, with the slot it keeps)
    // short: weapon slots fewer at the start (the cost); below: the share of health his pennies
    // finish under; pay: px from him a finish pays into the purse.
    mechanic: { hook: 'drowned_man', params: { short: 2, below: 0.15, pay: 110, payEvery: 1, finish: 0.15, bossFee: 0.4, purseMight: 0.3 } },
    // ring: px of a sunken crate's ring; purse: grave pennies a marked crate costs; mark*: a full
    // purse marks a crate between markNear and markFar px off, at most one every markGap s. Deeds: a crate is 1.
    trade: { id: 'cargo', params: { ring: 22, purse: 24, markGap: 60, markNear: 110, markFar: 320, seaEvery: 3, over: -1, seaUps: 1, clock: 180, lvEvery: 0, per: 1, gap: 40, span: 180, grow: 0, growMax: 3, pastCap: 0.04, pastMax: 0.4, deed: 5 }, deedText: 'Bring up {t.deed} crates' },
    gives: 'His pennies deal more damage the fuller his purse: +{m.purseMight%} when full. A full purse marks a sunken crate nearby, and walking to it brings it up. The map\'s sunken crates come up when he reaches them. Every {t.seaEvery#} crate is a sea chest. The first gives back {m.short+t.over} weapon slot, with a weapon in it. Later ones give Grave Pennies {t.seaUps|level}. His pennies deal {m.bossFee%} more damage to bosses.',
    costs: 'Starts with {m.short} fewer weapon slots. Sea chests give back only {m.short+t.over} of them. {b.maxHp} Max HP, -{1-b.moveSpeed%} Move Speed.',
    // The gate's card (C3, ruling 14 E): one line of what they do, one of what it costs. Kept true to `desc` and `costs`.
    card: { does: 'His pennies finish enemies under {m.below%} HP.', costs: '{m.short} fewer weapon slots, {b.maxHp} Max HP, -{1-b.moveSpeed%} Move Speed.' },
    unlock: 'secret:breakwater_point',
    find: 'Something has washed up at Breakwater Point, on the Drowned Docks after the first boss.',
    hubLine: 'Sea gave me back. Didn\'t say why.',
  },
  // The Tide Priest arrives with the Chapel's order (data/orders-characters.js tide_priest_call).
  {
    id: 'tide_priest', name: 'Tide Priest', sprite: 'pc_tide_priest',
    who: 'The Chapel\'s priest. She times the floods, and her attack goes off every {m.every}s.',
    desc: 'Every {m.every}s her King Tide floods and knocks enemies back. Halfway between floods, the ebb pulls enemies toward her.',
    start: 'corpse_candles', signature: 'king_tide', noDraft: ['tide_bell'],   // (ruling 18 KD: flames that drift after the crowd her ebb gathers; the Tide Bell, King Tide's twin, never drafted)
    // +30 Max HP in place of every heal. noHeal: the harbor never sends her out with something that
    // only heals, pays her in food, or drops any (meta/runconfig.js; the sweep, A5).
    base: { maxHp: 130 }, noHeal: true,
    // every: s of her clock (the ebb at the half, the flood at the full); first: s to her first
    // ebb; ebb*: the ebb's hit (a share of the flood's), its drag, its slow and how long; ward: the
    // Tide Ward each flood leaves (for each enemy it hit, at most wardMax), draining away by the
    // next flood; wardSec: s it drains away in; call: s before a beat a crowd can call it; crowd: enemies within her reach that
    // call it; callMul: a called beat's strength.
    mechanic: { hook: 'tide_priest', params: { every: 30, first: 8, ebbMul: 0.3, ebbPull: 5, ebbSlow: 0.3, ebbSec: 2, ward: 2, wardMin: 5, wardMax: 25, wardSec: 0, wardTide: 0.5, bareHurt: 0.15, floodRot: 4, floodAmp: 0, rotFeed: 0.5, liftPer: 0.015, liftMax: 0.75, call: 5, crowd: 12, callMul: 1.3 } },
    // again: rings a Fog Bell has in it for her after its first; crewMul: the second crew's size.
    // Deeds: a called beat that catches `catch` or more is 1; a bell rung is one upgrade. The
    // capstone's deed counts floods that catch `big` or more.
    trade: { id: 'bells', params: { again: 1, crewMul: 1.5, clock: 180, lvEvery: 0, per: 4, gap: 40, span: 180, grow: 0, growMax: 3, pastCap: 0.04, pastMax: 0.4, deed: 8, catch: 8, big: 20 }, deedText: 'Hit {t.big} or more enemies with one flood, {t.deed} times' },
    gives: 'With {m.crowd} enemies close to her in the {m.call}s before a flood or ebb, it comes early with +{m.callMul-1%} Damage. Each enemy a flood hits gives the next one +{m.liftPer%} Damage, up to +{m.liftMax%}. Her flood deals {m.rotFeed%} more damage to rotting enemies. Fog Bells ring twice for her.',
    costs: 'Can\'t heal. Each flood gives her a shield, and nothing else refills it. With no shield she takes {m.bareHurt%} more damage. +{b.maxHp-s.maxHp} Max HP.',
    // The gate's card (C3, ruling 14 E): one line of what they do, one of what it costs. Kept true to `desc` and `costs`.
    card: { does: 'Floods knock enemies back, and ebbs pull them in.', costs: 'Can\'t heal. Takes {m.bareHurt%} more damage with no shield.' },
    unlock: 'feat:tide_priest_call',
    find: 'Brother Hale at the Chapel posts a Harbor Order for her.',
    hubLine: 'Thirty seconds between floods. I count them in my sleep.',
  },
];

for (const c of CHARACTERS) {
  const scope = { m: c.mechanic.params, t: c.trade.params, b: c.base ?? {}, s: TUNING.player.stats };
  fillFields(c, ['who', 'desc', 'gives', 'costs', 'card.does', 'card.costs', 'find', 'hubLine'], scope, c.id);
  fillFields(c.trade, ['deedText'], scope, c.id);
}
