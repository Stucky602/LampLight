// The glossary (0.9.0, W7; Kevin, Nov 8: "I don't even know what the lamp that is being lit
// actually does now"). Every term the game's screens use gets one plain entry: what it does, then
// where it comes from. The pause menu, the harbor's menu, and the title open it, and any card,
// notice, or panel that names a term opens its entry with one button (L2, LT, or G).
//
// The rule (the sweep, X1): one thing, one name, one description. This file is the one place a
// term is described. The field guide, a first sighting, a building's level line, the gate's rows,
// and the results read an entry here (its `short`, or its `desc`); none keeps a copy of its own.
// Every number in an entry is read from the data it describes (tuning, maps, characters, ...), so
// a rule that changes changes its line, and every list inside an entry (the tags, what orders open,
// the gear slots) is built from the data's own lists. tests/glossary.test.js fails when a number
// here isn't the data's, when the field guide or a level line carries its own description, and
// when a screen uses a term this list doesn't explain.
//
// An entry: { id, name, aliases?, kind, desc, where, short? }.
//   name     the term as the screens write it ("Tide"); a heading in the glossary
//   aliases  other ways the screens write it ("Tides", "Tide 1"): the words that find this entry
//            in a line of text (ui/glossary.js termsIn), matched as whole words, ignoring case
//   kind     the group it's listed under: 'run' (in a run), 'harbor' (between runs), 'building',
//            'map' (a map's own things), 'item' (what you carry or spend)
//   desc     what it does, in plain sentences (docs/WRITING.md §2.5: say what a thing does)
//   where    where it comes from, or where you find it
//   short    one or two short sentences for the places that have room for no more: a first
//            sighting, the field guide, a building's level line, a row at the gate
//
// A building's entry takes its `desc` from data/buildings.js (the panel shows the same words), and
// an elite affix's from data/enemies.js ELITE_AFFIXES.

import { TUNING as T, SLOTS } from './tuning.js';
import { MAPS } from './maps.js';
import { CHARACTERS } from './characters.js';
import { BUILDINGS } from './buildings.js';
import { MATERIALS } from './materials.js';
import { ELITE_AFFIXES } from './enemies.js';
import { RELICS, RELIC_TIERS } from './relics.js';
import { RARITIES, rarityOfTier } from './rarity.js';
import { WEAPONS } from './weapons.js';
import { SIGNATURES } from './signatures.js';
import { PASSIVES } from './passives.js';
import { ASCENSIONS } from './ascensions.js';
import { SIGNATURE_FORMS } from './signature-forms.js';
import { RECIPES, GEAR_SLOTS, SLOT_NAMES, THIRD_AFFIX_TIER } from './gear.js';
import { CONSUMABLES } from './consumables.js';
import { TROPHIES, TROPHY_DAMAGE } from './trophies.js';
import { CHALLENGES } from './challenges.js';
import { KITS } from './mastery.js';
import { SKILLS, SKILL_RANKS } from './skills.js';
import { FEATS } from './feats.js';
import { META } from './meta.js';
import { MARKET } from './market.js';
import { TIDES } from './tide.js';
import { HUB } from './hub.js';
import { WEAPON_UPS } from './weaponups.js';

// ---------------------------------------------------------------- how the data is said

/** "A, B, and C" (Oxford comma), "A and B", or "A". */
const list = (items, and = 'and') => (items.length < 3 ? items.join(` ${and} `) : `${items.slice(0, -1).join(', ')}, ${and} ${items.at(-1)}`);
/** 180 as "3:00". */
const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
/** 0.3 as "30%". */
const pct = (v) => `${Math.round(v * 100)}%`;
/** 2 as "twice", 3 as "3 times". */
const times = (n) => (n === 2 ? 'twice' : `${n} times`);
/** 0.5 as "half", 0.4 as "40%". */
const share = (v) => (v === 0.5 ? 'half' : pct(v));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const mat = (id) => MATERIALS.find((m) => m.id === id)?.name ?? id;
const bld = (id) => BUILDINGS.find((b) => b.id === id);
const who = (id) => CHARACTERS.find((c) => c.id === id);
const map = (id) => MAPS.find((m) => m.id === id);
const DOCKS = map('drowned_docks'), MARSH = map('salt_marsh');
/** "4" when every map agrees, "4 or 5" when they don't. */
const span = (nums) => { const u = [...new Set(nums)].sort((a, b) => a - b); return u.length === 1 ? String(u[0]) : `${u[0]} or ${u.at(-1)}`; };
const eventsOf = (m, kind) => m.timeline.events.filter((e) => e.event === kind);
const bossTimes = [...new Set(MAPS.flatMap((m) => eventsOf(m, 'boss').map((e) => e.at)))].sort((a, b) => a - b);
const lastBoss = bossTimes.at(-1);
const championTimes = [...new Set(MAPS.flatMap((m) => eventsOf(m, 'muster').filter((e) => e.champion).map((e) => e.at)))].sort((a, b) => a - b);
const overtimeOf = (kind) => [...new Set(MAPS.map((m) => m.overtime.events.find((e) => e.event === kind)?.at))][0];
const P = (id) => who(id).mechanic.params, TR = (id) => who(id).trade.params;
const lv = (n) => `Lv ${n}`;
/** 5 as "5th". */
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
/** "the Docks'" and "the Library's" (round 2, L3 9: "the Docks's"). */
const poss = (name) => (/s$/.test(name) ? `${name}'` : `${name}'s`);

const ALL_WEAPONS = [...WEAPONS.filter((w) => !SIGNATURES.some((s) => s.id === w.id)), ...SIGNATURES];
/** The Hooked entry's line (RULING-L1: Gaff is Hooked): tuning's, and the Harpooner's hook's when it differs. */
function gaffText() {
  const a = T.status?.gaff;
  const hp = CHARACTERS.find((c) => c.id === 'harpooner')?.trade?.params;
  const pc = (v) => `${Math.round(v * 100)}%`;
  const base = a ? `A hooked enemy takes ${pc(a.amp)} more damage for ${a.sec}s.` : 'A hooked enemy takes more damage for a few seconds.';
  return hp && a && (hp.gaff !== a.amp || hp.gaffSec !== a.sec) ? `${base} The Harpooner's hook makes it ${pc(hp.gaff)} for ${hp.gaffSec}s.` : base;
}

const TAG_ORDER = ['light', 'fire', 'sea', 'steel', 'echo', 'frost', 'rot'];
/** Every tag a weapon or passive carries, in the cards' order. */
export const TAGS = Object.freeze([...new Set([...ALL_WEAPONS, ...PASSIVES].flatMap((x) => x.tags || []))].sort((a, b) => (TAG_ORDER.indexOf(a) + 99) % 99 - (TAG_ORDER.indexOf(b) + 99) % 99));

/** Where a kind of content comes from, as the sources' names, most first ("Harbor Orders, research, the Lighthouse, and a challenge run"). */
const SOURCE = { feat: 'Harbor Orders', research: 'the Library\'s research', building: null, mastery: 'mastery', secret: 'secrets' };
function sources(items) {
  const n = new Map();
  for (const x of items) {
    const [kind, id] = String(x.unlock).split(':');
    const name = kind === 'building' ? `the ${bld(id)?.name ?? id}` : SOURCE[kind];
    if (name) n.set(name, (n.get(name) ?? 0) + 1);
  }
  return [...n].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

/** What Harbor Orders open, by kind, most first: every list that holds something keyed 'feat:<id>'. */
const CAPSTONES = [...ASCENSIONS, ...SIGNATURE_FORMS].flatMap((l) => l.options).filter((o) => o.capstone);
export const ORDER_OPENS = Object.freeze([
  ['gear', RECIPES], ['a starting weapon', KITS], ['a run tool', CONSUMABLES], ['a trophy', TROPHIES], ['a skill', SKILLS], ['a map event', MAPS.flatMap((m) => m.deck || [])],
  ['a Final Form', CAPSTONES], ['a relic', RELICS], ['a character', CHARACTERS], ['a weapon', ALL_WEAPONS], ['a passive', PASSIVES],
  ['something in the harbor', HUB.props],
].map(([word, items]) => [word, items.filter((x) => typeof x.unlock === 'string' && x.unlock.startsWith('feat:')).length]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([word]) => word));

/** The Lighthouse's stages by what they open: [[stage, words]], from what is keyed to each and the level's own effects. */
const LIGHTHOUSE = bld('lighthouse');
const stagesWith = (key) => LIGHTHOUSE.levels.map((l, i) => (l[key] ? i + 1 : 0)).filter(Boolean);
const stageKinds = [['gear', RECIPES], ['a run tool', CONSUMABLES], ['a relic', RELICS], ['a challenge run', CHALLENGES]].filter(([, items]) => items.some((x) => String(x.unlock).startsWith('building:lighthouse:'))).map(([w]) => w);

/** A slot row of data/tuning.js SLOTS as words: the building, the levels that add one, the most. */
const slotLevels = (k) => list(SLOTS[k].at.map(lv));
const slotMax = (k) => SLOTS[k].base + SLOTS[k].at.length;

/** Mastery's ranks by what they open (data/mastery.js, data/gear.js, data/challenges.js). */
const perkRanks = [...SKILL_RANKS];
const kitRanks = [...new Set(KITS.filter((k) => k.rank !== undefined).map((k) => k.rank))].sort((a, b) => a - b);
const masteryRank = (items) => [...new Set(items.map((x) => /^mastery:[a-z_]+:(\d+)$/.exec(String(x.unlock))?.[1]).filter(Boolean).map(Number))].sort((a, b) => a - b);

const specialMin = RARITIES[WEAPON_UPS.find((u) => u.id === 'special')?.min ?? RARITIES.length - 1].name;
const D = T.draft, F = T.ferry, K = T.tasks;
const secretsBig = (m) => (m.secrets || []).filter((s) => !s.gift);
const finds = (m) => (m.secrets || []).filter((s) => s.gift);
const owned = MAPS.flatMap((m) => (m.secrets || []).filter((s) => s.only).map((s) => ({ ...s, map: m })));

/** A building's entry: what it does is the panel's own description; where is what its first level costs. */
const building = (id, extra = '', aliases = undefined) => {
  const b = bld(id);
  return { id, name: b.name, ...(aliases ? { aliases } : {}), kind: 'building', desc: b.desc, where: `Restore it with ${list(Object.keys(b.levels[0].cost).map(mat))}.${extra ? ` ${extra}` : ''}` };
};
/** "The fog clears from it at the Lamp Post's Lv 4." from the plot's own key (data/hub.js plots openAt). */
const fogLine = (id) => {
  const at = HUB.plots.find((p) => p.building === id)?.openAt;
  if (!at || at === 'start') return '';
  const [b, n] = at.split(':');
  return `The fog clears from it at the ${poss(bld(b).name)} ${lv(Number(n))}.`;
};
/** An elite affix's entry: its line is the one the enemy data keeps (data/enemies.js ELITE_AFFIXES). */
const affix = (id, entryId = id, name = null, aliases = undefined, where = 'An elite affix.') => {
  const a = ELITE_AFFIXES.find((x) => x.id === id);
  return { id: entryId, name: name ?? a.name, ...(aliases ? { aliases } : {}), kind: 'run', desc: a.desc, where };
};

// RULING-L1 (Nov 19): a Basics group first, in the order a first run meets them; every `desc` 40
// words or fewer, standing alone (no entry explains one made-up word with another); detail past
// that in `more`, under a "More" line. `only`: a character or a map the entry belongs to; the
// screen grays it until the profile has played that character or seen that map.
export const GLOSSARY_KINDS = Object.freeze([
  ['basics', 'Basics'],
  ['run', 'In a run'],
  ['map', 'On the maps'],
  ['item', 'What you carry'],
  ['stat', 'Stats'],
  ['harbor', 'Between runs'],
  ['building', 'Buildings'],
]);

const KIN = T.weaponUps.kindred;
// A weapon's stat, or one of yours (round 2, L3 9: Armor and the rest are yours, not a weapon's).
const STAT = (id, name, desc, aliases = undefined, yours = false) => ({ id, name, ...(aliases ? { aliases } : {}), kind: 'stat', desc,
  where: yours ? 'Your stats in the pause menu (Stats), passive and relic cards, gear, and Harbor upgrades.' : 'A weapon\'s stats in the pause menu, and level-up cards.' });
const TAG = (id, desc) => ({ id: `tag_${id}`, name: `${cap(id)} tag`, kind: 'run',   // (named "Light tag": the bare word is a word in a hundred lines)
  desc: `A tag. ${desc} A passive with this tag boosts only weapons with it.`, where: 'The chips on weapon and passive cards.' });

export const GLOSSARY = [
  // ---------------------------------------------------------------- basics (a first run's order)
  { id: 'run', name: 'Run', aliases: ['runs', 'Full run'], kind: 'basics',
    desc: `One trip out from the harbor, ${Math.round(lastBoss / 60)} minutes long. Bosses come at ${list(bossTimes.map(clock))}. Killing the last one clears the map. Whatever happens, what you found comes home.`,
    where: 'Start one at the gate on the quay, or with Start run from the harbor\'s menu.' },
  { id: 'xp', name: 'XP gems', aliases: ['XP', 'gems', 'blue gems', 'gem'], kind: 'basics',
    desc: 'Blue gems enemies drop. Picking them up fills the bar at the top. A full bar is a level-up.',
    where: 'Every kill drops one. Walk close and they fly to you.' },
  { id: 'levelup', name: 'Level-up', aliases: ['level-ups', 'level up'], kind: 'basics',
    desc: `The run stops and shows ${D.cards} cards: a new weapon or passive, or a level for one you carry. Pick one. Reroll draws new cards, Banish removes a card for the run, and Skip passes.`,
    where: 'Each time the XP bar fills.' },
  { id: 'weapon', name: 'Weapon', aliases: ['weapons'], kind: 'basics',
    desc: 'Fires on its own. Each level-up for it rolls a rarity: Common and Uncommon raise a number, Rare and Epic add a trait, Legendary a Legendary trait. It never runs out of levels.',
    more: 'Each weapon has tags and three Forms to choose. A run holds a few at once.',
    where: 'Every character starts with two: their signature weapon and a starting weapon. Level-ups offer more.' },
  { id: 'passive', name: 'Passive', aliases: ['passives'], kind: 'basics',
    desc: 'A stat bonus you carry, such as more Damage (Fire) each level. It never fires. Its last level adds a bonus rule, shown on its card.',
    more: `Some passives go with a weapon, and their card names it: each level gives that weapon's Final Form +${pct(T.forms.partnerPer)} Damage.`,
    where: 'Level-ups. The Library\'s research adds more to the pool.' },
  { id: 'tag', name: 'Tags', aliases: ['tag'], kind: 'basics',
    desc: `Labels on weapons and passives: ${list(TAGS.map(cap))}. A passive with a tag boosts only weapons with that tag. A card's chips show how many of each tag you carry.`,
    where: 'On every weapon and passive card.' },
  { id: 'tag_bonus', name: 'Tag bonus', aliases: ['tag bonuses', 'Kindred'], kind: 'basics',
    desc: `A weapon gets +${pct(KIN.per)} Damage for each other weapon or passive you carry that shares one of its tags, up to +${pct(KIN.per * KIN.max)}.`,
    where: 'Shown on a weapon\'s level-up card when it applies.' },
  { id: 'lamp', name: 'Wayside Lamp', aliases: ['Wayside Lamps', 'lamp', 'lamps'], kind: 'basics',
    desc: `Stand in its circle until it lights; the Lamplighter lights one the moment she reaches it. A lit lamp stays lit, and its light burns enemies in it. Light every lamp on the map for a Lantern Night.`,
    more: `An ordinary enemy in its light dies in about ${K.ward.killSec}s. A drop that lands in its light chimes. Lighting one pays Pearls once the Ferryman is in your runs.`,
    short: 'Stay in its circle to light it; the Lamplighter lights one at a touch. It stays lit for the rest of the run, and its light burns enemies.',
    where: `Each act brings ${span(MAPS.flatMap((m) => m.acts.map((a) => a.lamps)))} at new places. An arrow at the screen's edge points to the nearest.` },
  { id: 'bell', name: 'Fog Bell', aliases: ['Fog Bells', 'bell', 'bells'], kind: 'basics',
    desc: `Stand in its small circle to start it. A wave of enemies comes. Kill the number it asks, and it rings: it stuns enemies near it and leaves a chest that gives one weapon or passive +${K.bell.levels} levels.`,
    more: 'For the Tide Priest each bell rings twice: once rung, it can be started again for a bigger wave and a second chest.',
    short: 'Stand in its small circle to start it, then kill the wave that comes. It rings and leaves a chest.',
    where: `Each act brings ${span(MAPS.flatMap((m) => m.acts.map((a) => a.bells)))}, one at a time at new places. An arrow at the screen's edge points to the nearest.` },
  { id: 'chest', name: 'Chest', aliases: ['chests', 'Boss chest', 'boss chests', 'guarded chest', 'guarded chests'], kind: 'basics',
    desc: `Gives levels for a weapon or passive you carry, or Coin, or food. A boss chest gives ${list(T.chests.bossItems.map(([n]) => String(n)), 'or')} things.`,
    where: 'Elites and bosses drop them, and some map events leave one with guards (the chest arrow points to it). Walk over one to open it.' },
  { id: 'ember', name: 'Ember', aliases: ['Embers'], kind: 'basics',
    desc: 'Opens a weapon\'s next Form early, or swaps a Form it has for the other one of its pair. Use it when you pick it up, or later from the pause menu.',
    where: 'Bosses drop one, elites sometimes, and the Ferryman sells them.' },
  { id: 'material', name: 'Materials', aliases: ['material'], kind: 'basics',
    desc: 'What runs bring home to restore buildings and pay for everything in the harbor. Each map drops its own, so what you need next says where to run.',
    where: `Enemies drop them, and every minute of a run pays some. ${list(MARKET.rare.map(mat))} come mostly from elites and bosses. Salt Glass comes from the Salt Marsh's elites and its storm.` },
  { id: 'restore', name: 'Restore', aliases: ['restored', 'restoring'], kind: 'basics',
    desc: 'Pay materials to bring a harbor building back. Each level does more: new things in your runs, or new things to buy.',
    where: 'Walk up to a building in the harbor.' },

  // ---------------------------------------------------------------- in a run
  { id: 'dash', name: 'Dash', kind: 'run',
    desc: 'A quick burst of movement. Enemies can\'t hurt you during it. It has a short recharge. The Dash slot holds one dash item, which changes how the dash goes.',
    where: 'R1 or RB on a controller, Shift or Space on a keyboard. Settings, Controls changes the buttons.' },
  { id: 'trait', name: 'Trait', aliases: ['traits', 'Rare trait', 'Epic trait', 'Legendary trait', 'Legendary traits', 'can also roll', 'Shared'], kind: 'run',
    desc: 'A weapon\'s Rare, Epic, or Legendary level-up: a named change to how that weapon works, such as flares that split. Each weapon has its own, and keeps them for the run.',
    more: 'A Shared trait can be rolled by more than one weapon, under one name; its card says Shared. Taking one changes only that weapon.',
    where: 'Rare and better level-up cards for a weapon you carry.' },
  // C3 (ruling 18 P2; RULING-L1): statuses, each with its number on the cards that apply it.
  { id: 'burn', name: 'Burning', aliases: ['burn', 'burns', 'burning enemies'], kind: 'run',
    desc: `A burning enemy takes fire damage every ${T.status.burnTick}s until the fire goes out. A second fire doesn't add to the first: the stronger one stays.`,
    where: 'Fire weapons, and traits and Forms that say they set enemies burning.' },
  { id: 'slow', name: 'Slowed', aliases: ['slow', 'slows', 'slowed enemies'], kind: 'run',
    desc: 'A slowed enemy moves slower, by the percent on the card. A stronger slow replaces a weaker one; they don\'t add.',
    where: 'Frost and Sea weapons, and traits and Forms that say they slow.' },
  { id: 'freeze', name: 'Frozen', aliases: ['freeze', 'freezes', 'frozen enemies'], kind: 'run',
    desc: `A frozen enemy can't move, but still hurts you if you touch it. A boss stays frozen ${pct(T.enemies.freezeBossFactor)} as long. Once it thaws it can't be frozen again for ${T.status.thaw}s.`,
    where: 'Frost weapons, and traits and Forms that say they freeze.' },
  { id: 'rot', name: 'Rotting', aliases: ['rots', 'rotting enemies', 'rot them'], kind: 'run',
    desc: 'A rotting enemy takes more damage from every hit while the rot lasts. The card says how much and for how long.',
    more: 'Some weapons make a rotting enemy burst, or rise to fight for the Bog Warden, when it dies.',
    where: 'Rot weapons, the Bog Warden, and traits and Forms that say they rot.' },
  { id: 'daze', name: 'Stunned', aliases: ['stun', 'stuns', 'stunned enemies'], kind: 'run',
    desc: 'A stunned enemy can\'t move and can\'t hurt you by touch, for the time the card says. Bosses can\'t be stunned.',
    where: 'The Harpooner, and traits and Forms that say they stun.' },
  { id: 'gaff', name: 'Hooked', aliases: ['hooks', 'hooked enemies'], kind: 'run', desc: gaffText(),
    where: 'The Anchor Chain, the Harpooner\'s hook, and traits and skills that say they hook.' },
  { id: 'finish', name: 'Finish', aliases: ['finishes', 'finished', 'ordinary enemy', 'ordinary enemies'], kind: 'run',
    desc: 'Kills an enemy outright once its HP is under the percent on the card. Only ordinary enemies, not elites or bosses, unless the card says so.',
    where: 'The Drowned Man\'s Grave Pennies, and some Forms and traits.' },
  { id: 'lost', name: 'Lost', aliases: ['lost enemies'], kind: 'run',
    desc: 'A lost enemy walks away from you for the time the card says, then comes back.',
    where: 'The Fog Horn and its traits and Forms.' },
  { id: 'chain', name: 'Chain', aliases: ['chains', 'chain to'], kind: 'run',
    desc: 'A hit that jumps on to nearby enemies, one after another. The card says how many.',
    where: 'The Lightning Rod, the Lantern Orb\'s Arc, and traits and passives that add Chain.' },
  { id: 'pierce', name: 'Pierce', aliases: ['pierces'], kind: 'run',
    desc: 'How many more enemies a shot passes through before it is spent. With none, a shot stops at the first enemy it hits.',
    where: 'A weapon\'s stats, and its Uncommon and better cards.' },
  { id: 'crit', name: 'Crit', aliases: ['crits', 'Crit Chance', 'Crit Damage', 'critical hit'], kind: 'run',
    desc: 'Crit Chance is the chance a hit is a crit. A crit deals Crit Damage times the hit, and its number shows in gold.',
    where: 'A weapon\'s stats, and its Uncommon and better cards.' },
  { id: 'hit_delay', name: 'Hit Delay', aliases: ['hit delays'], kind: 'run',
    desc: 'How long one enemy waits before the same weapon can hit it again. It matters most for weapons that stay out: orbits, beams, and pools.',
    where: 'A weapon\'s stats, and its Uncommon and better cards.' },
  { id: 'knockback', name: 'Knockback', aliases: ['knocks back', 'knock back'], kind: 'run',
    desc: 'How far a hit pushes an enemy back.',
    where: 'A weapon\'s stats, and some traits and Forms.' },
  { id: 'form', name: 'Form', aliases: ['Forms', 'New Form', 'Final Form', 'Final Forms'], kind: 'run',
    desc: `A choice that changes how a weapon works. Each weapon picks three, one of two each time: at Lv ${T.forms.at[0] + 1}, at Lv ${T.forms.at[1] + 1}, and a Final Form when its goal is done.`,
    more: `Each Form shows its drawback. An Ember opens the next Form early, or swaps one. Some Final Forms also change how the weapon looks.`,
    where: 'Leveling the weapon, its goal, or an Ember.' },
  { id: 'deed', name: 'Final Form goal', aliases: ['Final Form goals', 'goal'], kind: 'run',
    desc: 'What opens a weapon\'s Final Form: something done with that weapon in the run, such as kills from far off. Each weapon has its own.',
    where: 'On its level-up cards and in the pause menu, and counted beside its icon in a run.' },
  { id: 'signature', name: 'Signature weapon', aliases: ['signature weapons', 'Signature'], kind: 'run',
    desc: `A character's own weapon. Nobody else can use it, and level-ups never offer it. It levels up every ${clock(TR('lamplighter').clock)}, and also from what the character does: lamps lit for the Lamplighter, sweeps for the Punter.`,
    more: `The meter under the weapons shows how close its next level is. Each lamp, sweep, or other count past what the next level needs adds +${pct(TR('lamplighter').pastCap)} Damage, up to +${pct(TR('lamplighter').pastMax)}.`,
    where: 'Every character carries one, in the first weapon slot.' },
  { id: 'drawback', name: 'Drawback', aliases: ['drawbacks'], kind: 'run',
    desc: 'The rule against a character, or the cost of a Form. A character\'s is on their card at the gate; a Form\'s is on its card.',
    where: 'The gate\'s character cards, and every Form card.' },
  { id: 'shield', name: 'Shield', aliases: ['shields'], kind: 'run',
    desc: 'Soaks up damage before your HP does. Once it is gone, hits take HP again.',
    where: 'The Tide Priest\'s floods (her Tide Shield), and some relics.' },
  { id: 'tide_ward', name: 'Tide Shield', kind: 'run', only: { character: 'tide_priest' },
    desc: `The Tide Priest can't heal. Each flood leaves her a shield that soaks up damage, refilled only by her next flood. With it gone, she takes ${pct(P('tide_priest').bareHurt)} more damage.`,
    more: `It holds ${P('tide_priest').ward} for each enemy the flood hit, at least ${P('tide_priest').wardMin} and up to ${P('tide_priest').wardMax}, and ${pct(P('tide_priest').wardTide)} more for each Tide. The thin bar over her HP bar shows it.`,
    where: 'The Tide Priest\'s runs.' },
  { id: 'elite', name: 'Elite', aliases: ['elites'], kind: 'run',
    desc: 'A bigger, tougher enemy that drops a chest. Its name, and any elite powers, show when it arrives.',
    where: 'On the map\'s timeline, and more often at higher Tides.' },
  { id: 'affix', name: 'Elite powers', aliases: ['elite power', 'affix', 'affixes'], kind: 'run',
    desc: `An extra rule an elite carries, named when it arrives: ${list(ELITE_AFFIXES.map((a) => a.name), 'or')}. Each has its own entry here.`,
    where: `${T.affixes.perElite === 1 ? 'One' : T.affixes.perElite} on every elite, two from Tide ${T.affixes.twoFromTide}. A muster's captain has none.` },
  affix('warded', 'warded', null, undefined, 'An elite power.'), affix('herald', 'herald', null, undefined, 'An elite power.'), affix('molten', 'molten', null, undefined, 'An elite power.'), affix('tethered', 'tethered', null, undefined, 'An elite power.'),
  affix('brine', 'brine_affix', 'Brine (elite)', ['Brine elite'], 'An elite power.'),
  { id: 'phase_gate', name: 'Boss phases', aliases: ['boss phase', 'notch', 'notches', 'phase', 'phases'], kind: 'run',
    desc: 'The marks on a boss\'s HP bar. A boss can\'t lose HP past a mark until it has used that phase\'s big attack once.',
    more: 'While a boss is stuck in mud or kneeling, hits land in full.',
    where: 'Every boss.' },
  { id: 'muster', name: 'Muster', aliases: ['musters', 'captain', 'crew'], kind: 'run',
    desc: 'A captain and a ring of crew that walk in together. Kill the captain for a chest. Some captains have one attack of their own, shown by a ring on the ground first.',
    more: `The ${clock(championTimes[0])} captain drops an elite's chest, the ${clock(championTimes.at(-1))} one a boss chest and an Ember. The Salt Marsh's ${clock(championTimes.at(-1))} captain comes once you have cleared the Marsh.`,
    where: `At set times on every map. In overtime they keep coming, and a line says when one is ${T.director.musterWarn}s away.` },
  { id: 'boss', name: 'Boss', aliases: ['bosses', 'last boss'], kind: 'run',
    desc: 'A big enemy with its own attacks, each shown on the ground before it lands. Each drops a boss chest and an Ember.',
    where: `At ${list(bossTimes.map(clock))} on every map.` },
  { id: 'overtime', name: 'Overtime', kind: 'run',
    desc: 'After the last boss you can stay. Enemies get stronger every minute and drop more materials. The map stays cleared whatever happens.',
    more: `New lamps and bells come out, the first boss comes back at ${clock(overtimeOf('boss'))}, and at ${clock(overtimeOf('long_night'))} the Long Night starts.`,
    where: `The question after the ${clock(lastBoss)} boss. Quit run from the pause menu ends it.` },
  { id: 'act', name: 'Act', aliases: ['acts', 'Act 1', 'Act 2', 'Act 3'], kind: 'run',
    desc: 'One of a run\'s three parts. Each act brings its own Wayside Lamps and Fog Bells at new places. Lamps you lit stay lit.',
    more: 'From Act 2 an act can bring a twist: a slow lamp, or a bell whose wave an elite leads. Act 3 is overtime.',
    where: 'Act 1 from the start, Act 2 when the first boss comes, Act 3 in overtime.' },
  { id: 'long_night', name: 'Long Night', aliases: ['the Long Night'], kind: 'run',
    desc: 'The end of overtime. The map\'s bosses come back together. Kill them all and dawn breaks. If they kill you first, the run ends (the map stays cleared).',
    where: `Overtime, ${Math.round(overtimeOf('long_night') / 60)} minutes after you stay.` },
  { id: 'dawn', name: 'Dawn', aliases: ['the dawn'], kind: 'run',
    desc: 'The Long Night is won. The last enemies fall, every chest and Ember on the ground comes to you, a boss chest opens, and the run ends.',
    where: 'Kill every boss of the Long Night.' },
  { id: 'momentum', name: 'Momentum', aliases: ['Momentum meter'], kind: 'run', only: { character: 'punter' },
    desc: `The Punter's meter. It fills while he keeps moving. A sharp turn costs a step, a hit costs ${pct(P('punter').hitSteps / P('punter').steps)} of it, and stopping empties it. Each of its ${P('punter').steps} steps adds ${pct(P('punter').perStep)} Damage, and +${pct(P('punter').reachPerStep)} Area to his Punt Pole.`,
    more: `At full Momentum his Punt Pole sweeps all around him every ${P('punter').sweepEvery}s. With none his weapons deal ${pct(-P('punter').empty)} less damage.`,
    short: 'The Punter\'s meter: it fills while he moves, and each step is more Damage.',
    where: 'The Punter\'s runs, the bar at his feet.' },
  { id: 'fuel', name: 'Fuel', aliases: ['her fuel'], kind: 'run', only: { character: 'lamplighter' },
    desc: `The Lamplighter's light runs on Fuel. Away from lit lamps it lasts ${P('lamplighter').oilFull}s, then her light dims over ${P('lamplighter').oilDim}s, down to ${pct(P('lamplighter').oilLow)} of its Area and Damage, and her Pickup Range too. A lit lamp refills it.`,
    where: 'The Lamplighter\'s runs: the Fuel bar at the top left.' },
  { id: 'spare_flame', name: 'Spare flame', aliases: ['spare flames', 'Flames'], kind: 'run', only: { character: 'lamplighter' },
    desc: `The Lamplighter holds up to ${P('lamplighter').flames}. Each gives her light +${pct(P('lamplighter').flameMight)} Damage and +${pct(P('lamplighter').flameMoveArea)} Area moving (+${pct(P('lamplighter').flameArea)} standing). She gains one every ${P('lamplighter').flameGap}s with ${P('lamplighter').flameKills} or more enemies in her light, and all at once by lighting a lamp.`,
    short: 'The Lamplighter\'s flames: each one held makes her light bigger and deal more damage.',
    where: 'The Lamplighter\'s runs: the pips beside Spare flames, top left.' },
  { id: 'lantern', name: "Lamplighter's lantern", aliases: ['lanterns she sets down', 'a lantern she sets down', 'lanterns set down'], kind: 'run', only: { character: 'lamplighter' },
    desc: `A small light the Lamplighter sets down: one by each lamp she lights, and one every ${P('lamplighter').darkEvery}s while her light is dimmed. It lasts ${P('lamplighter').lampLantern}s, burns enemies in it at ${pct(P('lamplighter').lanternDamage)} of Lamplight's damage, and gives Lamplight +${pct(P('lamplighter').lanternUp)} Damage.`,
    where: 'The Lamplighter\'s runs.' },
  { id: 'grave_penny', name: 'Grave penny', aliases: ['purse'], kind: 'run', only: { character: 'drowned_man' },
    desc: `What the Drowned Man's purse holds. A penny that lands close to him puts one in, and so do his weapons' finishing hits close by. A full purse of ${TR('drowned_man').purse} marks a sunken crate nearby.`,
    short: 'The Drowned Man\'s purse: a full one marks a sunken crate nearby.',
    where: 'The Drowned Man\'s runs.' },

  // ---------------------------------------------------------------- what you carry
  { id: 'relic', name: 'Relic', aliases: ['relics'], kind: 'item',
    desc: `Changes a rule for the rest of the run (gems that explode, a shield instead of healing). Relics come in ${Object.keys(RELIC_TIERS).length} rarities: ${list(Object.keys(RELIC_TIERS).map((t) => rarityOfTier(Number(t)).name))}. They never show on level-up cards.`,
    where: 'Reliquaries, the vault, the Ferryman, and secrets.' },
  { id: 'relic_slots', name: 'Relic slots', aliases: ['relic slot', 'swap', 'Pass'], kind: 'item',
    desc: 'How many relics a run can carry. With them full, a new relic means giving up one you carry (the Ferryman sells it again), or passing.',
    where: `A run starts with ${SLOTS.relics.base}. The ${poss(bld(SLOTS.relics.building).name)} ${slotLevels('relics')} each add one, up to ${slotMax('relics')}.` },
  { id: 'slots', name: 'Weapon and passive slots', aliases: ['weapon slot', 'weapon slots', 'passive slot', 'passive slots', 'slots'], kind: 'item',
    desc: 'How many weapons and passives a run can carry. Once they are full, level-ups offer levels for what you carry. Weapons never run out of levels.',
    where: `A run starts with ${SLOTS.weapons.base} weapon slots and ${SLOTS.passives.base} passive slots. The ${poss(bld(SLOTS.weapons.building).name)} ${slotLevels('weapons')} each add a weapon slot, up to ${slotMax('weapons')}. The ${poss(bld(SLOTS.passives.building).name)} ${slotLevels('passives')} each add a passive slot, up to ${slotMax('passives')}.` },
  { id: 'dash_item', name: 'Dash item', aliases: ['dash items', 'Dash slot'], kind: 'item',
    desc: 'Changes how the dash goes: how far, how often, how many charges, and what the ground does where you dashed. A run holds one. A level-up can offer another in its place.',
    where: 'Every character starts with one. Level-ups offer the others.' },
  { id: 'pearls', name: 'Pearls', aliases: ['Pearl'], kind: 'item',
    desc: 'Money for the Ferryman, spent in the same run. Pearls left at the end are lost, unless the Market buys them as Coin.',
    where: 'Lit lamps, rung bells, and elites pay them, once the Docks bring the Ferryman.' },
  { id: 'food', name: 'Food', kind: 'item',
    desc: 'Heals you. The Tide Priest can\'t heal, so none drops in her runs.',
    where: 'Dropped by enemies now and then, in chests, and sold by the Ferryman.' },
  { id: 'reroll', name: 'Reroll', aliases: ['Rerolls'], kind: 'item',
    desc: `Draws ${D.cards} new level-up cards. Each run has a few.`,
    where: `Every run starts with ${T.player.stats.reroll}. The Apothecary and the Ferryman sell more.` },
  { id: 'banish', name: 'Banish', aliases: ['Banishes'], kind: 'item',
    desc: 'Takes one level-up card out of the run for good. On a weapon\'s level-up, it takes that kind of level-up off that weapon.',
    where: `Every run starts with ${T.player.stats.banish}. The Apothecary sells more.` },
  { id: 'skip', name: 'Skip', aliases: ['Skips'], kind: 'item',
    desc: `Passes a level-up without taking a card. Hold it so it can't happen by accident.${D.skipPays ? ` A skip pays a little: food when you are hurt, else Pearls or Coin.` : ''}`,
    where: `Every run starts with ${T.player.stats.skip}. The Apothecary sells more.` },
  { id: 'revival', name: 'Revival', aliases: ['Revivals'], kind: 'item',
    desc: `Brings you back once at ${pct(T.player.reviveHpFraction)} HP when you would die.`,
    where: 'Smelling Salts at the Apothecary, and the Lamp Post\'s last Harbor upgrades.' },
  { id: 'rarity', name: 'Rarity', aliases: ['rarities', ...RARITIES.map((r) => r.name)], kind: 'item',
    desc: `How good something is, lowest to highest: ${list(RARITIES.map((r) => r.name))}. The word always shows with its color. A higher rarity is a bigger number, or a trait.`,
    more: `A weapon's Legendary trait comes only at ${specialMin}. Gear goes up one rarity each time the Smithy improves it, and at ${rarityOfTier(THIRD_AFFIX_TIER).name} gains one more bonus.`,
    where: 'Weapon level-ups, relics, and gear at the Smithy.' },
  { id: 'luck', name: 'Luck', kind: 'item',
    desc: 'Makes good rolls likelier: higher rarities on level-ups, more in a boss chest, Reliquaries, food, and drops.',
    where: 'Passives, relics, gear, and Harbor upgrades.' },

  // ---------------------------------------------------------------- stats (RULING-L1, L3: the stat names on cards, one line each)
  { ...STAT('stat_damage', 'Damage', 'How much each hit takes off an enemy. A +% Damage card raises it by that percent.', ['Damage card', 'Damage cards']),
    more: `Each Damage card on the same weapon adds ${pct(1 - T.weaponUps.damageDecay)} less than the last. The card's numbers already show it.` },
  STAT('stat_area', 'Area', 'How big a weapon\'s hits, rings, and pools are.'),
  STAT('stat_cooldown', 'Cooldown', 'How long a weapon waits between attacks. Lower is faster.'),
  STAT('stat_duration', 'Duration', 'How long a weapon\'s effects last: pools, beams, orbits, statuses.'),
  STAT('stat_projectiles', 'Projectiles', 'How many shots a weapon fires at once. A card may use the weapon\'s own word, such as flares.', ['Projectile']),
  STAT('stat_speed', 'Projectile Speed', 'How fast a weapon\'s shots fly.'),
  { ...STAT('stat_range', 'Range', 'How far from you a weapon reaches: how far a shot or hook flies, or how far out it swings. Area is how big each hit is.'), where: 'Some Forms and skills: Muzzle Flash, Short Hook, Long Chain, Breathing Ring, and Hand Line.' },
  STAT('stat_armor', 'Armor', 'Takes this much off every hit you take.', undefined, true),
  STAT('stat_regen', 'HP Regen', 'HP you get back each second.', undefined, true),
  STAT('stat_move', 'Move Speed', 'How fast you walk.', undefined, true),
  STAT('stat_pickup', 'Pickup Range', 'How close a gem or drop must be before it flies to you.', undefined, true),
  STAT('stat_xp', 'XP Gain', 'More XP from every gem.', undefined, true),
  // The tags one by one (RULING-L1, L3: G on a chip found nothing).
  TAG('light', 'Lamps, flares, beams, and lightning.'), TAG('fire', 'Weapons that set enemies burning.'), TAG('sea', 'Water, waves, and things from the sea.'),
  TAG('steel', 'Heavy hooks, chains, and anchors.'), TAG('echo', 'Sound: bells and horns.'), TAG('frost', 'Weapons that slow and freeze.'), TAG('rot', 'Weapons that make enemies rot.'),

  // ---------------------------------------------------------------- on the maps
  { id: 'held_lamp', name: 'Slow lamp', aliases: ['slow lamps', 'held lamp'], kind: 'map',
    desc: `A Wayside Lamp that takes longer to light, while enemies rush it. Once lit, it works like any other lamp, plus a chest and ${times(K.held.pearlsMul)} the Pearls.`,
    where: 'A twist an act can bring, from Act 2.' },
  { id: 'lantern_night', name: 'Lantern Night', aliases: ['Lantern Nights'], kind: 'map',
    desc: `The fog lifts for ${K.night.sec}s and your light burns every enemy near you. When it ends, a vault rises ahead of you. Once ready, it starts when ${K.night.crowd} enemies are near you, or a muster or boss arrives.`,
    more: `The Lamplighter earns ${TR('lamplighter').nights} at once, hers start with ${TR('lamplighter').crowd} enemies near, and her light reaches farther.`,
    where: 'Light every Wayside Lamp on the map. Each act brings new lamps, so you can earn it again.' },
  { id: 'vault', name: 'Vault', kind: 'map',
    desc: `Pick one relic of ${T.relics.offer}, one rarity higher than a Reliquary's.`,
    where: 'Rises ahead of you when Lantern Night ends.' },
  { id: 'crane', name: 'Crane', aliases: ['cranes'], kind: 'map',
    desc: `Stand in the circle at its foot until it fills. It drops ${K.crane.loads} loads on the biggest crowd near it. A ring shows where each lands, and none can hurt you. Ready again each act.`,
    where: `The Drowned Docks: ${DOCKS.cranes.length}, in the Crane Yard, on the Breakwater quay, and by the Dry Dock.` },
  { id: 'cairn', name: 'Salt Cairn', aliases: ['salt cairns', 'cairn', 'cairns'], kind: 'map', only: { map: 'salt_marsh' },
    desc: `Stand in the circle at its foot until it fills. For ${K.cairn.sec}s lightning strikes the biggest crowds near it. A ring shows where each lands, and none can hurt you. Ready again each act.`,
    where: `The Salt Marsh: ${MARSH.cairns.length} on the flats.` },
  { id: 'map_event', name: 'Map event', aliases: ['map events'], kind: 'map',
    desc: 'Something that happens on the map in an act: gulls, a ghost ship, a guarded chest, a trail of gems to a chest. Each run draws a few for each act.',
    where: 'Every map has its own. Harbor Orders open more of them.' },
  { id: 'reliquary', name: 'Reliquary', aliases: ['Reliquaries'], kind: 'map',
    desc: `Walk over it to pick one relic of ${T.relics.offer}. It lasts for the rest of the run.`,
    short: `A rare drop from a kill. Walk over it to pick one relic of ${T.relics.offer}.`,
    where: `A rare drop from kills. If ${T.relics.reliquaryPity} kills pass without one, the next kill drops one.` },
  { id: 'ferryman', name: 'Ferryman', aliases: ['the Ferryman'], kind: 'map',
    desc: 'Rows in every few minutes and ties up near you. Stand in the circle by his boat to buy relics, food, rerolls, and Embers with Pearls.',
    short: 'He rows in every few minutes and ties up near you. Stand in the circle by his boat to buy relics, food, rerolls, and Embers with Pearls.',
    where: `In every run once the Docks are restored, first at ${clock(F.firstCall)}, then every ${Math.round(F.callEvery / 60)} minutes.` },
  { id: 'well', name: 'Salt Well', aliases: ['Well', 'the Well'], kind: 'map', only: { map: 'salt_marsh' },
    desc: 'Give up one relic you carry. It\'s gone for the run, and from then on the Ferryman sells it on every map. To be asked again, stand still in its circle.',
    short: 'Give up one relic here. The Ferryman sells it on every map after.',
    where: `On the Salt Marsh after your first clear there, where the ${clock(championTimes.at(-1))} muster's captain falls.` },
  { id: 'secret', name: 'Secret', aliases: ['secrets', 'small secret', 'small secrets'], kind: 'map',   // (round 4, main: Small secret folded in)
    desc: 'A hidden place at a map\'s edge. The big one holds a relic that then joins the pool for good. Small secrets give Pearls, an Ember, an item, materials, or food once a run.',
    more: ['A small one shows only as a faint glint when you are close. Walk onto it.', ...owned.map((s) => `The ${s.map.name}'s big one is on the ${s.name}, and only the ${who(s.only).name} finds anything there.`)].join(' '),
    where: `At the edges of each map: one big one and ${span(MAPS.map((m) => finds(m).length))} small ones. The Cartographer gives hints.` },
  { id: 'district', name: 'District', aliases: ['districts', ...DOCKS.layout.districts.map((d) => DOCKS.places.find((p) => p.id === d.kind).name.replace(/^the /, ''))], kind: 'map',
    desc: `A named part of a map: the Drowned Docks have ${list([...DOCKS.layout.districts.map((d) => d.kind), 'wreck'].map((id) => DOCKS.places.find((p) => p.id === id).name))}. Notices name them.`,
    where: 'The Drowned Docks and the Salt Marsh.' },
  { id: 'high_water', name: 'High water', aliases: ['low water', 'creeks'], kind: 'map', only: { map: 'salt_marsh' },
    desc: `The Salt Marsh's creeks flood ${times(MARSH.water.high.length)} a run, and nobody can walk through them. A warning comes ${MARSH.water.warn}s ahead. The way back to the landing never floods.`,
    short: `The creeks flood ${times(MARSH.water.high.length)} a run and close. Only the Punter and enemies that swim cross them.`,
    where: `The Salt Marsh, ${list(MARSH.water.high.map(([a, b]) => `${clock(a)} to ${clock(b)}`))}.` },
  { id: 'herbs', name: 'Herb beds', aliases: ['herb bed'], kind: 'map', only: { map: 'salt_marsh' },
    desc: 'Beds of Marsh Herbs on the creek mud. Walk over one to pick it. High water covers them.',
    short: 'Marsh Herbs on the creek mud. Walk over them at low water.',
    where: 'The Salt Marsh\'s creeks, at low water.' },
  { id: 'causeway', name: 'Drowned Causeway', aliases: ['causeway'], kind: 'map', only: { map: 'salt_marsh' },
    desc: `A stone path to an island in the far southeast of the Salt Marsh, dry at low water. Only the ${who(owned.find((s) => s.id === 'drowned_causeway')?.only ?? 'bog_warden').name} can raise the dead there; for anyone else it is empty.`,
    short: `A stone path to an island in the far southeast, dry at low water. Only the ${who(owned.find((s) => s.id === 'drowned_causeway')?.only ?? 'bog_warden').name} finds anything there.`,
    where: 'The Salt Marsh, once its second Tide is open or the Cartographer is fully restored.' },
  { id: 'mooring_post', name: 'Mooring post', aliases: ['mooring posts', 'mooring'], kind: 'map', only: { character: 'harpooner' },
    desc: 'Where the Ferryman ties up. As the Harpooner, stand in a post\'s circle until it fills and he rows to that post now. Once each time he comes.',
    where: 'Along the water on every map with the Ferryman.' },
  { id: 'punt_cache', name: 'Floating chest', aliases: ['floating chests'], kind: 'map', only: { character: 'punter' },
    desc: `A chest floating on the water. Only the Punter can get to it, by crossing the water: a crossing lasts ${TR('punter').punt}s, then the water carries him to a bank, slowed for ${TR('punter').rest}s. It holds one item.`,
    where: 'The Salt Marsh: one each high water. The Drowned Docks: one in the slips each act.' },
  { id: 'bog_body', name: 'Bog body', aliases: ['bog bodies'], kind: 'map', only: { character: 'bog_warden' },
    desc: `A body kept in the marsh peat. As the Bog Warden, walk into its circle: it rises and fights for her for ${TR('bog_warden').bodySec}s. Once a run each.`,
    where: `The Salt Marsh: ${who('bog_warden').trade.sites.salt_marsh.length} in the peat.` },
  { id: 'wreck_crew', name: 'Wreck crew', aliases: ['wreck crews'], kind: 'map', only: { character: 'bog_warden' },
    desc: `A drowned crew where their boat went down. As the Bog Warden, walk into its circle: ${TR('bog_warden').crewN} of them rise and fight for her for ${TR('bog_warden').crewSec}s. Once a run each.`,
    where: `The Drowned Docks: ${who('bog_warden').trade.sites.drowned_docks.length}, by the Wreck, the Dry Dock, and on the wharf.` },
  { id: 'thrall', name: 'Thrall', aliases: ['thralls'], kind: 'map', only: { character: 'bog_warden' },
    desc: `A dead enemy that got up to fight for the Bog Warden, for ${P('bog_warden').sec}s. She can have ${P('bog_warden').max} at once. They go for the enemy nearest her, and a bite stuns an ordinary enemy for ${P('bog_warden').hold}s.`,
    short: `A dead enemy that got up to fight for the Bog Warden for ${P('bog_warden').sec}s.`,
    where: 'The Bog Warden\'s runs: enemies that die rotting, die in her Bog Hands, or that she walks over just after they die.' },
  { id: 'sunken_crate', name: 'Sunken crate', aliases: ['sunken crates', 'sunken cargo'], kind: 'map', only: { character: 'drowned_man' },
    desc: `Cargo on the sea floor. As the Drowned Man, walk into its circle and he brings it up: one item. A full purse of ${TR('drowned_man').purse} pennies marks one nearby.`,
    where: `Every map has ${span(MAPS.map((m) => m.sites.cache.length))}.` },
  { id: 'sea_chest', name: 'Sea chest', aliases: ['sea chests'], kind: 'map', only: { character: 'drowned_man' },
    desc: `Every ${ordinal(TR('drowned_man').seaEvery)} crate the Drowned Man brings up. The first gives back ${P('drowned_man').short + (TR('drowned_man').over ?? 1)} of his ${P('drowned_man').short} missing weapon slots, with a weapon in it. Later ones give Grave Pennies ${TR('drowned_man').seaUps ?? 2} ${(TR('drowned_man').seaUps ?? 2) === 1 ? 'level' : 'levels'}.`,
    where: 'The Drowned Man\'s runs.' },
  { id: 'storm', name: 'Storm', kind: 'map', only: { map: 'salt_marsh' },
    desc: `Lightning falls on the biggest crowd on the salt flats. A ring on the ground shows where first. Every ${ordinal(MARSH.storm.glassEvery)} strike leaves Salt Glass, and a strike on salt can raise a glass pillar.`,
    short: 'Lightning falls on the biggest crowd on the salt flats. A ring on the ground shows where first.',
    where: 'The Salt Marsh, once you have killed the Old Grey.' },
  { id: 'eye', name: 'Eye of the storm', aliases: ['the Eye'], kind: 'map', only: { map: 'salt_marsh' },
    desc: `For ${MARSH.eye.sec}s no enemies come, and heavier lightning falls on the ones left. It leaves gems and ${MARSH.eye.glass} Salt Glass.`,
    short: 'No enemies come for a while, and heavier lightning falls on the ones left.',
    where: `The Salt Marsh at ${clock(eventsOf(MARSH, 'eye')[0].at)}, once the storm comes.` },
  { id: 'pillar', name: 'Glass pillar', aliases: ['glass pillars'], kind: 'map', only: { map: 'salt_marsh' },
    desc: `Glass that lightning raises where it strikes salt. It stands for ${T.storm.pillar.sec}s, and nothing walks through it, you included.`,
    short: `Lightning on salt raises one for ${T.storm.pillar.sec}s. Nothing walks through it.`,
    where: 'The Salt Marsh\'s salt flats, in the storm.' },

  // ---------------------------------------------------------------- between runs
  { id: 'tide', name: 'Tide', aliases: ['Tides', 'Tide level'], kind: 'harbor',
    desc: `A harder version of a map for more materials: tougher, faster enemies, and more of them. From Tide ${TIDES.find((t) => t.rule).level} each Tide also adds a rule, and keeps the ones below it.`,
    short: 'A harder version of the map that pays more materials.',
    where: 'Kill a map\'s last boss to open its Tide 1, then clear each Tide to open the next. Pick one at the gate once the Chapel is restored.' },
  { id: 'curse', name: 'Curse', aliases: ['curses'], kind: 'harbor',
    desc: 'One rule against you for a run (less Max HP, more enemies, no food) for more materials. They stack.',
    where: 'The Chapel opens them. Pick them at the gate.' },
  { id: 'heirloom', name: 'Heirloom', aliases: ['Heirlooms'], kind: 'harbor',
    desc: 'One relic you have found before, carried from the start of a run. It takes a relic slot.',
    short: 'One relic you have found before, carried from the start of a run. It takes a relic slot.',
    where: `The Tavern opens it at level ${bld('tavern').levels.findIndex((l) => l.heirloom) + 1}. Pick it at the gate.` },
  { id: 'consumable', name: 'Run tool', aliases: ['run tools'], kind: 'harbor',
    desc: 'Something for one run: rerolls, banishes, skips, a Revival, or a head start (Pearls or an Ember). The run uses it up.',
    short: 'Something for one run: rerolls, banishes, skips, a Revival, or a head start. The run uses it up.',
    where: 'Bought at the Apothecary, picked at the gate under Run tools.' },
  { id: 'research', name: 'Research', aliases: ['project', 'projects'], kind: 'harbor',
    desc: `Pay materials to start a project. It finishes after a few runs, and what it finds can then turn up in your runs. A run counts if you survive ${clock(META.researchQualifySec)}${META.researchQualifyBoss ? ' or kill a boss' : ''}.`,
    more: 'The Library\'s levels open more projects. A project that finds things for a building needs that building restored first.',
    short: 'Pay materials to start a project, and it finishes after a few runs.',
    where: 'The Library.' },
  { id: 'upgrade', name: 'Harbor upgrades', aliases: ['Harbor upgrade'], kind: 'harbor',
    desc: 'Small bonuses for every run, such as more Damage each rank. Each has a few ranks.',
    where: 'Bought at the Lamp Post. Its levels open more.' },
  { id: 'gear', name: 'Gear', aliases: ['gear slot', 'gear slots', SLOT_NAMES.charm], kind: 'harbor',
    desc: `Pieces you wear into every run (${list(GEAR_SLOTS.map((k) => SLOT_NAMES[k].toLowerCase()))}), each with bonuses. The Smithy improves gear up to ${RARITIES.at(-1).name} and rerolls its bonuses.`,
    where: `Made at the Smithy from patterns. ${cap(list(sources(RECIPES)))} open them.` },
  { id: 'feat', name: 'Harbor Orders', aliases: ['Harbor Order', 'order', 'orders', 'Hunt', 'Hunts', 'trophy', 'trophies'], kind: 'harbor',   // (round 4, main: Hunt folded in)
    desc: 'Goals the townsfolk post: kill a boss with a certain weapon, light lamps, clear a map at a Tide. Each opens one new thing when you get home. Challenge runs and Hunts are orders too.',
    more: `What they open: ${list(ORDER_OPENS, 'or')}. A Hunt is an order to kill a set number of one enemy, counting every run; it opens +${pct(TROPHY_DAMAGE)} Damage against that enemy.`,
    short: 'Goals the townsfolk post. Each opens one new thing when you get home.',
    where: 'The board at the Tavern. Orders count from your first run; the board shows them once the Tavern is restored.' },
  { id: 'kit', name: 'Starting weapon', aliases: ['starting weapons'], kind: 'harbor',
    desc: 'The weapon a character starts a run with, beside their signature weapon. Other starting weapons can be picked at the gate.',
    where: `Mastery ranks ${list(kitRanks.map(String))} open a character's own, and weapon orders on the Harbor Orders board open one for everyone.` },
  { id: 'mastery', name: 'Mastery', aliases: ['mastery rank'], kind: 'harbor',
    desc: 'Each character earns ranks as you play them. Ranks give skill points, and open starting weapons, gear, and a challenge run of their own.',
    short: 'A character earns ranks as you play them. Ranks give skill points to spend at the Tavern, and open starting weapons, gear, and a challenge run.',
    where: `The Tavern, from its level ${bld('tavern').levels.findIndex((l) => l.mastery) + 1}.` },
  { id: 'skills', name: 'Skills', aliases: ['skill', 'skill tree', 'skill point', 'skill points', 'perk', 'perks'], kind: 'harbor',
    desc: `Each character has a tree of ${SKILLS.filter((s) => s.character === 'lamplighter').length} skills and ${perkRanks.length} points for it, from mastery ranks. A skill changes their signature weapon, what they do on the map, or their drawback.`,
    more: 'Some skills close another, some need another first, and two in each tree open with a Harbor Order. A tree can be reset for materials.',
    short: 'Each character has a skill tree. Mastery ranks give points for it, and there are never enough for the whole tree.',
    where: `The Tavern, from its level ${bld('tavern').levels.findIndex((l) => l.mastery) + 1}: the Mastery list.` },
  { id: 'codex', name: 'Codex', kind: 'harbor',
    desc: 'What you have found: every weapon, passive, relic, enemy, boss, map, and secret, with blanks for the ones not seen. An enemy\'s page counts your kills; a weapon\'s shows its Forms and traits.',
    short: 'What you have found, with blanks for what you have not. An enemy\'s page counts your kills.',
    where: 'The Library once it is restored, the harbor\'s menu, and the pause menu in a run.' },
  { id: 'completion', name: 'Completion', kind: 'harbor',
    desc: 'How much of the game you have done, as a percent: buildings, research, the codex, Harbor Orders, Tides, and mastery.',
    where: 'The title screen.' },
  { id: 'challenge', name: 'Challenge run', aliases: ['challenge runs'], kind: 'harbor',
    desc: 'A Harbor Order with its own rules: a set character, map, Tide, and curses. Start it from the board.',
    short: 'A Harbor Order with its own rules: a set character, map, Tide, and curses.',
    where: `The Cartographer posts them from its level ${bld('cartographer').levels.findIndex((l) => l.challenges) + 1}. Start one from the Harbor Orders board at the Tavern.` },
  { id: 'short_run', name: 'Short run', aliases: ['short runs'], kind: 'harbor',
    desc: `Everything comes ${times(Math.round(1 / T.run.shortTimeScale))} as fast, the last boss comes at ${clock(lastBoss * T.run.shortTimeScale)}, and the run pays ${pct(T.run.shortRewardMul)} of the materials.`,
    short: `Everything comes ${times(Math.round(1 / T.run.shortTimeScale))} as fast, the last boss comes at ${clock(lastBoss * T.run.shortTimeScale)}, and the run pays ${pct(T.run.shortRewardMul)} of the materials.`,
    where: 'The Cartographer opens it. Pick it at the gate under Map.' },
  { id: 'next_up', name: 'Next up', aliases: [], kind: 'harbor',
    desc: 'The three things in the harbor you can nearly afford, with how close each is. Ready means you can buy it now.',
    where: 'The bottom left of the harbor, and the results after a run.' },
  { id: 'save_code', name: 'Save code', kind: 'harbor',
    desc: 'Your progress as text, to keep as a backup or move to the other build of the game.',
    where: 'The title\'s menu and the harbor\'s menu.' },

  // ---------------------------------------------------------------- buildings
  building('lamp_post', 'It stands on the square.'),
  building('library'),
  building('tavern'),
  building('docks'),
  building('smithy', fogLine('smithy')),
  building('chapel', fogLine('chapel')),
  building('market'),
  building('apothecary', 'Its later levels take Marsh Herbs from the Salt Marsh.'),
  building('cartographer'),
  { id: 'lighthouse', name: 'Lighthouse', aliases: ['stage', 'stages'], kind: 'building',
    desc: `${bld('lighthouse').desc} The last stage lights the lamp.`,
    more: `A stage opens ${list([...stageKinds,
      ...(stagesWith('lampSpeedAdd').length ? [`faster Wayside Lamps (stage ${list(stagesWith('lampSpeedAdd').map(String))})`] : []),
      ...(stagesWith('consumableSlotsAdd').length ? [`one more run tool a run (stage ${list(stagesWith('consumableSlotsAdd').map(String))})`] : []),
      ...(stagesWith('bellRingAdd').length ? [`wider Fog Bell circles (stage ${list(stagesWith('bellRingAdd').map(String))})`] : []),
      ...(stagesWith('marketRaresAdd').length ? [`more ${list(MARKET.rare.map(mat))} at the Market (stage ${list(stagesWith('marketRaresAdd').map(String))})`] : [])], 'or')}.`,
    where: 'East of the Market. The fog clears from it with the Lamp Post\'s last level.' },
  { id: 'gate', name: 'Gate', kind: 'building',
    desc: 'Where runs start: choose the map, the character, and what the harbor has opened: a starting weapon, an Heirloom, run tools, and how hard (a Tide and curses).',
    where: 'The west end of the quay. Walking off the quay opens it too.' },
];

const BY_ID = new Map(GLOSSARY.map((e) => [e.id, e]));
/** One entry by id (undefined for none). */
export function term(id) { return BY_ID.get(id); }
/** An entry's short line (its `short`, else what it does). */
export function termShort(id) { const e = BY_ID.get(id); return e ? (e.short ?? e.desc) : ''; }
/**
 * A term named and said in one line, for a panel: "Harbor Orders: goals the townsfolk post. Each
 * opens one new thing when you get home" (the name, its short line with a small first letter, no
 * last period). `name`: another way to write the term there ("Rune stones", "Challenge runs").
 */
export function termLine(id, name = null) {
  const e = BY_ID.get(id);
  if (!e) return '';
  const s = (e.short ?? e.desc).replace(/\.$/, '');
  return `${name ?? e.name}: ${s.charAt(0).toLowerCase()}${s.slice(1)}`;
}

/**
 * The field guide's entry for one of the things a map shows (data/meta.js fieldGuide: a sighting's
 * name to a glossary id): { name, line, term }, the entry's own name and short line. null for a
 * sighting the field guide doesn't know.
 */
export function fieldGuideEntry(meta, key) {
  const g = meta?.fieldGuide?.[key];
  const e = g ? BY_ID.get(g.term) : null;
  return e ? { name: e.name, line: e.short ?? e.desc, term: e.id } : null;
}
