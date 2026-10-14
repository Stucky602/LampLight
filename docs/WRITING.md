# Lamplight: Writing

How every word the player reads is written: menus, cards, the HUD, the harbor's panels, the
results, notices, and errors. `tests/voice.test.js` enforces the parts a machine can check. Read
this before adding or changing any text.

Two sources. The first is the writing section of Kevin's `CQV_PROJECT_HANDBOOK.md` (cqvhelp.com),
which is the house voice for everything he builds. The second is how games in this genre actually
word their screens (Vampire Survivors, Brotato, Halls of Torment, Hades), checked against their
wikis. Where the two meet, the game convention wins on a game screen: a card says `+1 Pierce`,
not a sentence about piercing.

## 1. The house voice (from the CQV handbook)

- Plain sentences a person would say out loud. If you would not say it to a friend across the
  couch, do not write it.
- One concrete detail beats three adjectives: a number, a name, a time.
- Say the thing. No wind-up, no teaser, no moral at the end.
- Titles and labels are the name of the thing, not a slogan. "Library", not "Where drowned pages
  come back to life".
- Do not write: delve, leverage, robust, seamless, crucial, ensure, comprehensive, foster,
  streamline, journey, empower, pivotal, navigate (as a metaphor), harness, unlock (as a
  metaphor; the game verb "Unlocks: Tide Bell" is fine), elevate, realm, tapestry, testament,
  "it's important to note", moreover, furthermore, additionally, ultimately, "the key is",
  "not just X but Y", "not only X but also Y", "think of it as", genuinely.
- No exclamation marks. No rhetorical questions. No tidy lists of three for rhythm ("Tides,
  stars, and superstitions").
- Em dashes only where they do a job (a true separator). Never as the joiner between clauses.
- Oxford commas.

## 2. What sounds like a machine (and what was wrong in 0.5.0)

The 0.5.0 text read as AI for four reasons. Each one is now a rule.

1. **Explaining instead of labeling.** "Research can start: one project at a time." A game says
   `Research slots: 1`. Screens are scanned, not read: a label or a number beats a sentence.
2. **The writerly fragment.** "Drowned pages, dried and read." "Where sailors come back to, and
   where new faces arrive by boat." A comma, an "and", a little cadence: that rhythm on every
   menu is the tell. Flavor text is allowed in exactly one place per thing (see 5) and it is one
   plain line.
3. **Narrating the player.** "You held out for 7:11." "You came back after 7:11." "Your longest
   run yet." A results screen shows `Survived 7:11`, `New best time: 12:40 (was 9:05)`.
4. **Soft full sentences where a stat goes.** "Goes through 1 more." "Fires 0.15 s sooner."
   "Every weapon does 5% more damage." The genre writes `+1 Pierce`, `-0.15s Cooldown`,
   `+5% Damage`.

## 3. Stats

Sign, number, stat name, in that order, the stat in title case: `+5 Damage`, `+1 Projectile`,
`+20% Area`, `-0.15s Cooldown`, `+1 Pierce`, `+15 Max HP`, `+8% Move Speed`. Several on one card
are joined with commas. A stat line built for a card (a level-up) has no trailing period. A
description in the data is a sentence and ends with one, even when it is mostly a stat:
`+12% Damage (Fire) per level.`

The stat names, and only these:

| Stat | Name |
|---|---|
| might | Damage |
| amount | Projectile / Projectiles |
| area | Area |
| cooldown | Cooldown (lower is better: `-6% Cooldown`) |
| speed | Projectile Speed |
| duration | Duration |
| pierce | Pierce |
| knockback | Knockback |
| crit / critMult | Crit Chance / Crit Damage |
| moveSpeed | Move Speed |
| maxHp | Max HP |
| regen | HP Regen |
| armor | Armor |
| magnet | Pickup Range |
| luck | Luck |
| growth | XP |
| greed | Materials |
| revival | Revival |

A tag-scoped bonus puts the tag in parentheses after the stat, the tag capitalized as a name:
`+12% Damage (Fire)`. A card's tag chips read the same way, with the count the build already
has: `Fire (2)`.

Numbers are digits (`3 targets`, not "three"). Seconds are `45s`, clock times `7:11`, levels
`Lv 3`, ranks `2/5` (`Brighter Flame 2/5`), percentages `15%` (a setting too: a deadzone is
`15%`, not `0.15`).

## 4. Labels, buttons, and headings

- A heading is a noun: `Upgrades`, `Research`, `Materials`, `Unlocks`, `Next up`.
- A button is a verb or the plain name of where it goes: `Resume`, `Restore`, `Start run`,
  `Continue`, `Quit run`, `Quit game`, `Discard`, `Back`. Never a sentence. One action has one
  name on every screen: a run is started with `Start run` from the harbor menu, the gate, and
  the results alike; a building is restored with `Restore` at every level (the Lamp Post's
  `Upgrades` are a different thing).
- A prompt over something in reach is verb and name: `Enter Library`, `Talk to Silas`,
  `Start run`.
- Status words are single words or a short phrase: `MAX`, `Complete`, `In progress: 2 runs left`,
  `Requires Library Lv 2`, `Requires research: Rune Stones`, `Need 10 Coin, 5 Timber`,
  `Already at max level`, `Research slots full (1/1)`. A refusal is one of these, not a sentence.
- Anything new names its kind, because names overlap (Tide Clock, Tide Bell, Tide Charts):
  `New weapon: Tide Bell`, `New relic: Tide Clock`, `New character: Harpooner`, and on the
  results `Discovered: Flare Gun` for the first time a thing is seen.
- Evolutions: a weapon card says both halves, `Evolution: Lv 8 + Wick Oil Lv 5`; the passive's
  card says `Evolves Flare Gun`. `(owned)` when the build has the other half.
- Settings use the labels every PC game uses: `Fullscreen`, `Borderless`, `Windowed`,
  `Master volume`, `Reduce flashing`.
- Buildings, maps, and characters go by their names without "The": `Lamp Post`, `Library`,
  `Tavern`, `Drowned Docks`, `Lamplighter`, `Harpooner`. Bosses keep theirs (`The Harbor Maw`):
  that's a title, and bosses have titles.
- A confirmation's title may be a question, because it is one: `Quit run?`

## 5. Where flavor goes

One plain line, in the game's world, only where a player looks something up rather than decides
something: a material, an enemy, a keeper's line of speech. Never on a button, a heading, a
building panel's rules, a card's effect, or the results. A keeper's lines are speech and should
sound like one specific person talking (short, a little dry), not like narration.

## 6. Descriptions of things you pick

A weapon, passive, relic, or rune description says what it does, in the fewest plain words, as
Vampire Survivors does ("Fires spinning projectiles at the nearest enemy."): present tense, the
thing as the subject, one or two short sentences, numbers as digits. "You" only as the target
("Orbs circle you"); never "your", which turns a description into a sales pitch. No wind-up.

- Weapon: `Fires a flare at the nearest enemy.`
- Passive: `+12% Damage (Fire) per level.`
- Relic: `XP gems explode when collected.`
- Rune: `Hits chain to 3 nearby enemies.`

## 7. Errors and notices

Say what happened, then what to do, in two short sentences at most. `Save failed. Progress is
kept while the game is open and saves with the next change.` No apology, no "something went
wrong" padding when the real reason is known. A crash says `The run stopped because of an error.
Save a bug report, then reload.` The game's own screens never name Claude (reports still come to
Claude; Kevin sends them); the credits do.

## 8. Checked by the gate

`tests/voice.test.js` reads every name, description, and line in `src/data`, every string the
text builders produce for the shipped content (cards, level effects, panels, results, refusals,
prompts), and the string literals in the screen code, and fails on: the banned words and
constructions in 1, an exclamation mark, an em dash, a leading "The" on a building, map, or
character name, "your" in a pick's description, a stat line that doesn't lead with its
sign (or that ends in a period), a tag in lowercase, "Claude" anywhere but the credits, a line
that narrates the player ("You held out"), and a heading or button longer than four words.
`tests/ui.test.js` pins the card text word for word, and `tests/harbor.test.js` the harbor's.

## Sources

- Kevin's `CQV_PROJECT_HANDBOOK.md`, writing section (the house voice).
- Vampire Survivors wiki, Firearm: level-up lines ("Fires 1 more projectiles.", "Base Damage up
  by 10."), and the evolution note. https://vampire-survivors.fandom.com/wiki/Firearm
- Vampire Survivors wiki, PowerUp: the meta shop's stat names (Might, Area, Cooldown, Amount,
  Growth, Greed, Magnet, Revival). https://vampire-survivors.fandom.com/wiki/PowerUp
- Vampire Survivors wiki, Evolution: an evolution needs the weapon fully leveled, its counterpart
  item, and a chest (why a weapon card names both halves). https://vampire.survivors.wiki/w/Evolution
- Brotato wiki, Upgrades: `+[number] [Stat Name]` ("+3 Max HP", "+5 Damage").
  https://brotato.wiki.spellsandguns.com/Upgrades
- Grafana Writers' Toolkit, UX writing: short labels, verbs on buttons, sentence case.
  https://grafana.com/docs/writers-toolkit/write/style-guide/ux-writing/
