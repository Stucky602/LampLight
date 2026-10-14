// The text on cards and chest items (pure, data only; tested), worded as the genre words it
// (docs/WRITING.md §3): a stat line is its sign, its number, and the stat's name ("+1 Pierce",
// "-0.15s Cooldown", "+12% Damage (fire)"). The level-up screen shows what a card does at the
// level it offers, the tags it carries with how many the build already has (§5.10), and whether it
// is half of an evolution.

/** The name of each stat on a card (docs/WRITING.md §3). */
export const STAT_NAME = {
  might: 'Damage', damage: 'Damage', area: 'Area', speed: 'Projectile Speed', duration: 'Duration', amount: 'Projectile',
  cooldown: 'Cooldown', pierce: 'Pierce', knockback: 'Knockback', crit: 'Crit Chance', critMult: 'Crit Damage',
  moveSpeed: 'Move Speed', maxHp: 'Max HP', regen: 'HP Regen', armor: 'Armor', magnet: 'Pickup Range',
  luck: 'Luck', growth: 'XP', greed: 'Materials', density: 'Enemies', revival: 'Revival',
  reroll: 'Reroll', banish: 'Banish', skip: 'Skip', dashCooldown: 'Dash Cooldown',
  hitCooldown: 'Hit Delay', interval: 'Volley Delay', radius: 'Size',
};
// A flat amount of these is counted, so it takes a plural.
const PLURAL = { amount: 'Projectiles', revival: 'Revivals', reroll: 'Rerolls', banish: 'Banishes', skip: 'Skips' };
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

/** What reaching `level` adds to a weapon, as stat lines ("+1 Projectile, +5 Damage"). */
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
 * Everything a draft card or chest item shows.
 * @param {{kind,id,level,isNew}} card
 * @param {object} data the content bundle
 * @param {{ tags: Record<string, number>, weapons: string[], passives: string[] }} build what the
 *   player has now (tag counts across weapons and passives; owned ids)
 */
export function cardInfo(card, data, build = { tags: {}, weapons: [], passives: [] }) {
  const tagsOf = (list) => (list || []).map((t) => ({ tag: t, have: build.tags[t] || 0 }));
  switch (card.kind) {
    case 'weapon': {
      const def = data.weapons.find((w) => w.id === card.id);
      if (!def) throw new Error(`cardInfo: unknown weapon ${card.id}`);
      const evo = def.evolution && !def.evolution.hidden ? data.passives.find((p) => p.id === def.evolution.passive) : null;
      return {
        title: def.name, icon: def.icon,
        sub: card.isNew ? 'New weapon' : `Lv ${card.level}${card.level >= def.maxLevel ? ' MAX' : ''}`,
        desc: card.isNew ? def.desc : weaponLevelText(def, card.level),
        tags: tagsOf(def.tags),
        note: evo ? `Evolution: Lv ${def.maxLevel} + ${evo.name} Lv ${def.evolution.passiveLevel}${build.passives.includes(evo.id) ? ' (owned)' : ''}` : null,
      };
    }
    case 'passive': {
      const def = data.passives.find((p) => p.id === card.id);
      if (!def) throw new Error(`cardInfo: unknown passive ${card.id}`);
      const partners = data.weapons.filter((w) => w.evolution && !w.evolution.hidden && w.evolution.passive === def.id);
      const owned = partners.filter((w) => build.weapons.includes(w.id));
      return {
        title: def.name, icon: def.icon,
        sub: card.isNew ? 'New passive' : `Lv ${card.level}${card.level >= def.maxLevel ? ' MAX' : ''}`,
        desc: card.isNew ? def.desc : passiveLevelText(def, card.level),
        tags: tagsOf(def.tags),
        note: partners.length ? `Evolves ${(owned.length ? owned : partners).map((w) => w.name).join(' or ')}${owned.length ? ' (owned)' : ''}` : null,
      };
    }
    case 'relic': {
      const def = data.relics.find((r) => r.id === card.id);
      if (!def) throw new Error(`cardInfo: unknown relic ${card.id}`);
      return { title: def.name, icon: def.icon, sub: 'Relic', desc: def.desc, tags: [], note: null };
    }
    case 'rune': {
      const def = data.runes.find((r) => r.id === card.id);
      if (!def) throw new Error(`cardInfo: unknown rune ${card.id}`);
      return { title: def.name, icon: def.icon, sub: 'Rune', desc: def.desc, tags: [], note: null };
    }
    case 'evolution': {
      const def = data.weapons.find((w) => w.id === card.id);
      if (!def) throw new Error(`cardInfo: unknown weapon ${card.id}`);
      return { title: def.name, icon: def.icon, sub: 'Evolution', desc: def.desc, tags: tagsOf(def.tags), note: null };
    }
    case 'heal':
      return { title: 'Heal', icon: null, sub: 'Item', desc: card.amount ? `Restores ${card.amount} HP.` : 'Restores HP.', tags: [], note: null };
    case 'coin':
      return { title: 'Coin', icon: 'mat_coin', sub: 'Item', desc: card.amount ? `+${card.amount} Coin` : 'Coin for the harbor.', tags: [], note: null };
    default:
      throw new Error(`cardInfo: unknown card kind ${card.kind}`);
  }
}
