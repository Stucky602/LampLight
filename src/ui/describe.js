// The text on cards and chest items (pure, data only; tested), worded as the genre words it
// (docs/WRITING.md §3): a stat line is its sign, its number, and the stat's name ("+1 Pierce",
// "-0.15s Cooldown", "+12% Damage (fire)"). The level-up screen shows what a card does at the
// level it offers (a weapon's: its rolled upgrade as the weapon's number now and after, and its
// rarity: ruling 14), the tags it carries with how many the build already has (§5.10), and a
// weapon's Form line: the Form the level opens, the next one's level, or its Final Form goal.

/** The name of each stat on a card (docs/WRITING.md §3). */
export const STAT_NAME = {
  might: 'Damage', damage: 'Damage', area: 'Area', speed: 'Projectile Speed', duration: 'Duration', amount: 'Projectile',
  cooldown: 'Cooldown', pierce: 'Pierce', knockback: 'Knockback', crit: 'Crit Chance', critMult: 'Crit Damage',
  moveSpeed: 'Move Speed', maxHp: 'Max HP', regen: 'HP Regen', armor: 'Armor', magnet: 'Pickup Range',
  luck: 'Luck', growth: 'XP Gain', greed: 'Materials', density: 'Enemies', revival: 'Revival',
  reroll: 'Reroll', banish: 'Banish', skip: 'Skip', dashCooldown: 'Dash Cooldown',
  hitCooldown: 'Hit Delay', interval: 'Volley Delay', radius: 'Size', hops: 'Chain',
};
// A flat amount of these is counted, so it takes a plural.
const PLURAL = { hops: 'Chains', amount: 'Projectiles', revival: 'Revivals', reroll: 'Rerolls', banish: 'Banishes', skip: 'Skips' };
// A flat amount of these is in seconds.
const SECONDS = new Set(['cooldown', 'duration', 'hitCooldown', 'interval', 'dashCooldown']);
// A weapon level's own number for these is a share of the base (0.2 = 20%).
const SHARE = new Set(['area', 'speed', 'crit']);

/** A tag as the player reads it: "fire" is "Fire" (on a card's chips and in a stat line's scope). */
export function tagName(tag) { return tag.charAt(0).toUpperCase() + tag.slice(1); }

function sign(v) { return v >= 0 ? '+' : '-'; }
function fmt(v) { const a = Math.abs(v); return Number.isInteger(a) ? String(a) : String(Math.round(a * 100) / 100); }
function pct(v) { return `${Math.round(Math.abs(v) * 100)}%`; }

/** One flat amount of a stat: "+1 Projectile", "+2 Pierce", "-0.15s Cooldown". */
function flat(stat, v) {
  const name = Math.abs(v) !== 1 && PLURAL[stat] ? PLURAL[stat] : (STAT_NAME[stat] || stat);
  return `${sign(v)}${fmt(v)}${SECONDS.has(stat) ? 's' : ''} ${name}`;
}

/** How each axis of a weapon's Forms reads (data/ascensions.js FORM_AXES). */
export const AXIS_LABEL = Object.freeze({ delivery: 'First Form', flight: 'Second Form', payoff: 'Final Form' });   // (RULING-L1: Capstone is the Final Form)

/** A weapon number as a card shows it: damage to one decimal under 100, seconds to two, a share as a percent. */
function numText(stat, v) {
  if (stat === 'cooldown' || stat === 'duration' || stat === 'hitCooldown') return `${(Math.round(v * 100) / 100).toFixed(2)}s`;
  if (stat === 'area' || stat === 'crit') return `${Math.round(v * 100)}%`;
  if (stat === 'damage') return v < 100 ? String(Math.round(v * 10) / 10) : String(Math.round(v));
  return String(Math.round(v));
}

/** What one of a weapon's Amount is called: "Flare" and "Flares" (its data's unit; else Projectile). */
function unitOf(def, plural) {
  return plural ? (def?.units ?? 'Projectiles') : (def?.unit ?? 'Projectile');
}

/**
 * One rolled weapon upgrade as its card line (ruling 14; work/cw/C1-CONTRACT.md 7.1). A number
 * shows the weapon's real number now and after: "Damage 24 to 29", "Cooldown 1.10s to 0.97s",
 * "Flares 2 to 3", "Crit Chance 0% to 12%" (the menus' typeface has no arrow, so the word). A line
 * or a special is its name and sentence: "Backblast: Also fires a flare straight behind you.".
 * Without the weapon's numbers (a chest's item, a record of what was taken) a number is its size:
 * "+20% Damage", "-8% Cooldown", "+1 Flare".
 * up: { up, value, now?, after?, line?, special? } (a card, a chest item, or a slot's taken upgrade).
 */
export function upgradeText(data, def, up) {
  if (!up || !up.up) return def?.desc ?? '';
  if (up.up === 'line') { const l = (def?.lines || []).find((x) => x.id === up.line); return l ? `${l.name}: ${l.desc}` : 'One of its traits'; }
  if (up.up === 'special') { const x = (def?.specials || []).find((y) => y.id === up.special) ?? def?.specials?.[0]; return x ? `${x.name}: ${x.desc}` : 'Its Legendary trait'; }
  const t = (data.weaponUps || []).find((x) => x.id === up.up);
  const stat = t?.stat ?? up.up;
  const v = Number(up.value) || 0;
  const name = stat === 'amount' ? unitOf(def, true) : (t?.name ?? STAT_NAME[stat] ?? stat);
  if (Number.isFinite(up.now) && Number.isFinite(up.after)) {
    if (stat === 'pierce' && up.now < 0) return 'Pierce: all';
    return `${name} ${numText(stat, up.now)} → ${numText(stat, up.after)}`;
  }
  if (t?.whole) return `+${v} ${stat === 'amount' ? unitOf(def, v !== 1) : (v === 1 ? t.name : (t.plural ?? t.name))}`;
  return `${t?.sign < 0 ? '-' : '+'}${pct(v)} ${t?.name ?? STAT_NAME[stat] ?? stat}`;
}

/** A dash card's line, now and after: "Dash Distance 52 to 60", "Dash Recharge 2.50s to 2.20s", "Dash Charges 1 to 2". */
export function dashUpText(card) {
  const name = { dash_distance: 'Dash Distance', dash_recharge: 'Dash Recharge', dash_charges: 'Dash Charges' }[card.up] ?? 'Dash';
  const f = (v) => (card.up === 'dash_recharge' ? `${(Math.round(v * 100) / 100).toFixed(2)}s` : String(Math.round(v)));
  return Number.isFinite(card.now) && Number.isFinite(card.after) ? `${name} ${f(card.now)} → ${f(card.after)}` : name;
}


/** 2 -> 'second' ... (a card's plain count). */

/** A rarity id as { id, name } (data/rarity.js), or null. */
export function rarityOf(data, id) {
  const r = (data.rarities || []).find((x) => x.id === id);
  return r ? { id: r.id, name: r.name } : null;
}

/**
 * A weapon's Final Form goal as its card line (RULING-L1: Capstone and deed are the Final Form and its
 * goal): "Final Form goal: Kill 60 enemies from far off with it (41/60)", locked: "Final Form locked:
 * needs Orbwright's Notes (Library)", done: "Final Form ready".
 */
export function deedLine(data, deed) {
  if (!deed) return null;
  if (deed.locked) return `Final Form locked: needs ${lockedName(data, deed.locked)}`;
  if (deed.done) return 'Final Form ready';
  return `Final Form goal: ${deed.text} (${Math.floor(deed.have)}/${deed.need})`;
}

/** What a locked Final Form needs, short: "Orbwright's Notes (Library)", else where it comes from. */
function lockedName(data, unlock) {
  const [kind, id] = String(unlock).split(':');
  const r = kind === 'research' ? data.research?.find((x) => x.id === id) : null;
  return r ? `${r.name} (${data.buildings?.find((b) => b.id === 'library')?.name ?? 'Library'})` : whereFrom(data, unlock);
}

/**
 * A weapon card's Form line (work/cw/C1-CONTRACT.md 7.1), from the card: "Opens: How it fires" when
 * taking it opens an axis, "How it fires in 2 upgrades" while one is ahead, else its capstone's
 * deed (deedLine). null for a card with none.
 */
export function formLine(data, card) {
  if (!card) return null;
  // One count for a weapon, its level (RULING-L1): its nth upgrade is its level n + 1.
  if (card.opens) return 'New Form at this level';
  if (card.next) return `New Form at Lv ${card.next.at + 1} (${card.next.left} to go)`;
  return deedLine(data, card.deed);
}

/** What reaching `level` adds to a level-table weapon (a synthetic one; drawable weapons roll instead). */
export function weaponLevelText(def, level) {
  const delta = def.levels?.[level - 1];
  if (!delta) return def.desc;
  return Object.entries(delta).map(([k, v]) => (SHARE.has(k) ? `${sign(v)}${pct(v)} ${STAT_NAME[k]}` : k === 'critMult' ? `${sign(v)}${fmt(v)}x ${STAT_NAME[k]}` : flat(k, v))).join(', ');
}

/** One modifier as a stat line: "+12% Damage (Fire)", "+1 Pierce (Steel)", "-6% Cooldown". */
export function modifierText(m) {
  const name = STAT_NAME[m.stat] || m.stat;
  // A "more" multiplies: "x1.2 Damage".
  const amount = m.op === 'add' ? flat(m.stat, m.value) : m.op === 'pct' ? `${sign(m.value)}${pct(m.value)} ${name}` : `x${fmt(1 + m.value)} ${name}`;
  return m.tags?.length ? `${amount} (${m.tags.map(tagName).join(', ')})` : amount;
}

/** What reaching `level` adds to a passive, as stat lines. */
export function passiveLevelText(def, level) {
  const mods = def.levels?.[level - 1];
  if (!mods || !mods.length) return def.desc;
  return mods.map(modifierText).join(', ');
}

/**
 * Ruling 23 PC: which carried weapons a passive's level boosts, by its tag ("Boosts the Flare Gun and Corpse
 * Candles"), or that none carried has it yet ("No Fire weapon carried yet"). Null for a passive with no tag.
 */
function boostsLine(data, def, build) {
  const tags = [...new Set((def.levels || []).flat().flatMap((m) => m.tags || []))];
  if (!tags.length) return null;
  const hit = data.weapons.filter((w) => (build.weapons || []).includes(w.id) && (w.tags || []).some((t) => tags.includes(t))).map((w) => w.name);
  if (!hit.length) return `No ${tags.map(tagName).join(' or ')} weapon carried yet`;
  const names = hit.length > 3 ? [...hit.slice(0, 2), `${hit.length - 2} more`] : hit;
  return `Boosts ${names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`}`;
}

/**
 * A level card's total (ruling 19 PE): a level that adds one percent stat says what the passive
 * gives in all ("+36% Damage (Fire) in all"), so a third card reads as a third step, not the first again.
 */
function passiveTotal(def, level) {
  const mods = def.levels?.[level - 1];
  if (level < 2 || !mods || mods.length !== 1 || mods[0].op !== 'pct') return null;
  const m = mods[0], same = (x) => x.stat === m.stat && x.op === m.op && String(x.tags || '') === String(m.tags || '');
  const total = (def.levels || []).slice(0, level).flat().filter(same).reduce((a, x) => a + x.value, 0);
  return total > m.value ? `${modifierText({ ...m, value: total })} in all` : null;   // (a stat line, sign first: the voice rule)
}

/**
 * Everything a draft card or chest item shows.
 * @param {{kind,id,level,isNew}} card
 * @param {object} data the content bundle
 * @param {{ tags: Record<string, number>, weapons: string[], passives: string[] }} build what the
 *   player has now (tag counts across weapons and passives; owned ids), and `pool`: the passive ids
 *   the run can still offer (optional)
 */
/**
 * A weapon's capstone (ruling 14: its third axis, opened by a deed done with the weapon; its partner
 * passive makes it hit harder): { forms, passive, deed, unlock }, or null. Read from the data, as
 * sim/ascend.js capstoneOf does (the screens never import the sim).
 */
export function capstoneFor(data, weaponId) {
  const line = (data.ascensions || []).find((l) => (l.weapons || []).includes(weaponId));
  const forms = (line?.options || []).filter((x) => x.capstone);
  if (!forms.length) return null;
  const def = data.weapons.find((w) => w.id === weaponId);
  return { forms, form: forms[0], passive: data.passives.find((p) => p.id === def?.partner) ?? null, deed: def?.deed ?? null, unlock: line.capstoneUnlock ?? null };
}

/**
 * A new weapon's capstone line: what opens it, truthfully. "Capstone: Kill 60 enemies from far off
 * with it", or, when this run can't open it (`build.forms`: the capstones the profile has, as
 * RunConfig.forms), "Capstone: opens with Orbwright's Notes (Library research)".
 */
function capstoneNote(data, weaponId, build) {
  const c = capstoneFor(data, weaponId);
  if (!c) return null;
  // Not before the player has seen a Form screen (RULING-L1: a goal three Forms away is noise on a
  // first card). Then short: a locked one names the project that opens it; an open one, its goal.
  if (!build.formSeen) return null;
  // (Ruling 25 WA: locked only while none of its Final Form options is open, as sim/ascend.js capstoneShut says; Tether has a later project of its own.)
  if (c.unlock && Array.isArray(build.forms) && !c.forms.some((f) => build.forms.includes(f.id))) return `Final Form locked: needs ${lockedName(data, c.unlock)}`;
  return c.deed ? `Final Form goal: ${c.deed.text}` : null;
}

/** Where a thing with this `unlock` comes from, as a label: "Library research", "Tavern Lv 2", "the Glass Underfoot order at the Tavern". */
export function whereFrom(data, unlock) {
  const [kind, id, lv] = String(unlock).split(':');
  const bname = (b) => data.buildings?.find((x) => x.id === b)?.name ?? b;
  if (kind === 'research') return `${bname('library')} research`;
  if (kind === 'building') return `${bname(id)} Lv ${lv}`;
  if (kind === 'feat') { const o = data.feats?.find((f) => f.id === id); return o ? `the ${o.name} order at the ${bname('tavern')}` : `an order at the ${bname('tavern')}`; }
  if (kind === 'secret') return 'a secret';
  return 'the harbor';
}

export function cardInfo(card, data, build = { tags: {}, weapons: [], passives: [] }) {
  const tagsOf = (list) => (list || []).map((t) => ({ tag: t, have: build.tags[t] || 0 }));
  switch (card.kind) {
    case 'weapon': {
      const def = data.weapons.find((w) => w.id === card.id);
      if (!def) throw new Error(`cardInfo: unknown weapon ${card.id}`);
      // A weapon you carry: one rolled upgrade at a rarity, and its Form line. A new weapon: what opens its capstone.
      const up = !card.isNew && card.up;
      return {
        title: def.name, icon: card.icon ?? def.icon,
        sub: card.isNew ? 'New weapon' : `Lv ${card.level}`,
        desc: card.isNew ? def.desc : up ? upgradeText(data, def, card) : weaponLevelText(def, card.level),
        tags: tagsOf(def.tags),
        note: card.isNew ? capstoneNote(data, def.id, build) : up === 'damage' && card.shrink > 0 ? 'Repeat Damage cards add less' : null,   // (Ruling 25 PA: the shrink on the card, short; the number is the glossary's Damage entry)   // (round 2, the director's call: the shared-trait and repeat-Damage lines are the glossary's, not the card's)
        // The tag bonus, where the tag chips are (RULING-L1: "Tag bonus: +16% Damage (2 others share a tag)").
        // A late step (the Harpoon Chain's 10th and 20th): what this upgrade also gives.
        step: up && card.step ? `This level also gives ${[card.step.pierce ? `+${card.step.pierce} Pierce` : null, card.step.amount ? `+${card.step.amount} ${card.step.amount === 1 ? def.unit : def.units}` : null, card.step.damageMul !== 1 ? `+${Math.round((card.step.damageMul - 1) * 100)}% Damage` : null].filter(Boolean).join(' and ')}` : null,
        kin: card.kin > 0 ? `Tag bonus: +${Math.round(Math.min(card.kin, data.tuning?.weaponUps?.kindred?.max ?? 5) * (data.tuning?.weaponUps?.kindred?.per ?? 0.08) * 100)}% Damage` : null,   // (round 2: the chips show the counts)
        rarity: up ? rarityOf(data, card.rarity) : null,
        // Ruling 23 PA: a trait other weapons can also roll carries a short "Shared" tag; the rule is the glossary's (Trait).
        shared: up === 'line' && (def.lines || []).some((l) => l.id === card.line && l.shared) ? 'Shared' : null,
        form: up ? formLine(data, card) : null,
        // A Legendary special is an event (its own sound and a held beat: the screens'); a milestone says so.
        event: up && card.up === 'special' ? 'legendary' : null,
        milestone: up && card.milestone === true,
      };
    }
    case 'passive': {
      const def = data.passives.find((p) => p.id === card.id);
      if (!def) throw new Error(`cardInfo: unknown passive ${card.id}`);
      // The weapons it is the partner of (their capstone hits harder for each level): the ones
      // carried; with none carried, nothing (a first card needn't speak in the system's words).
      // Its last level adds a rule (`keystone`): a new passive's card says what, and the card for
      // that level says it as its own line.
      const owned = data.weapons.filter((w) => w.partner === def.id && build.weapons.includes(w.id));
      const per = Math.round((data.tuning?.forms?.partnerPer ?? 0) * 100);
      const last = card.level >= def.maxLevel;
      const between = card.isNew === false && card.level >= 2 && card.level < def.maxLevel;   // (Ruling 23 PC: levels 2 to 4)
      return {
        title: def.name, icon: def.icon,
        sub: card.isNew ? 'New passive' : `Lv ${card.level}${last ? ' MAX' : ''}`,
        desc: card.isNew ? def.desc : [passiveLevelText(def, card.level), passiveTotal(def, card.level)].filter(Boolean).join(', '),
        tags: tagsOf(def.tags),
        // Its last level's rule: on a new card, on the levels between (ruling 19 PE: what the levels
        // lead to), and as the last level's own line.
        // (Ruling 23 PC: on the levels between, the rule says how far off it is, and a line says which carried weapons the level boosts.)
        rule: def.keystone ? `Lv ${def.maxLevel} bonus${between ? ` (${def.maxLevel - card.level} to go)` : ''}: ${def.keystone.desc}` : null,   // (RULING-L1, L2: one name for it)
        step: between ? boostsLine(data, def, build) : null,
        note: owned.length ? `${owned.map((w) => w.name).join(' and ')} Final Form${owned.length > 1 ? 's' : ''}: +${per}% Damage per level` : null,
      };
    }
    case 'relic': {
      const def = data.relics.find((r) => r.id === card.id);
      if (!def) throw new Error(`cardInfo: unknown relic ${card.id}`);
      return { title: def.name, icon: def.icon, sub: 'Relic', desc: def.desc, tags: [], note: null };
    }
    case 'dash': {
      // The Dash slot (ruling 16): another item takes the held one's place; a card goes on the one held.
      const def = (data.dashes || []).find((d) => d.id === card.id);
      if (!def) throw new Error(`cardInfo: unknown dash item ${card.id}`);
      return {
        title: def.name, icon: def.icon, sub: card.isNew ? 'New dash' : 'Dash',
        desc: card.isNew ? def.desc : dashUpText(card), tags: [],
        note: card.isNew ? 'Replaces the dash you hold' : null,
      };
    }
    case 'heal':
      return { title: 'Food', icon: null, sub: 'Item', desc: card.amount ? `Heals ${card.amount} HP.` : 'Heals HP.', tags: [], note: null };
    case 'coin':
      return { title: 'Coin', icon: 'mat_coin', sub: 'Item', desc: card.amount ? `+${card.amount} Coin` : 'Coin for the harbor.', tags: [], note: null };
    default:
      throw new Error(`cardInfo: unknown card kind ${card.kind}`);
  }
}
