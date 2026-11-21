# Lamplight: Writing

How every word the player reads is written: menus, cards, the HUD, the harbor's panels, the
results, notices, and errors. `tests/voice.test.js` enforces the parts a machine can check. Read
this before adding or changing any text.

Two sources. The first is the writing section of Kevin's `CQV_PROJECT_HANDBOOK.md` (cqvhelp.com),
which is the house voice for everything he builds. The second is how games in this genre actually
word their screens (Vampire Survivors, Brotato, Halls of Torment, Hades), quoting the games' own
strings, not wiki prose. Where the two meet, the game convention wins on a game screen: a card says
`+1 Pierce`, not a sentence about piercing.

Kevin's rule (Nov 18): check a source for AI-written text before learning from it. A game's Steam
page has an "AI Generated Content Disclosure" section when its developer declares AI content; check
for it, and for developer statements. Never learn from Fandom's AI "Quick Answers" boxes. A wiki is
only for finding a game string; check the string against the game or a screenshot.

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

## 2. What sounds like a machine (0.5.0), and what sounds like a spec sheet (0.7.0)

The 0.5.0 text read as AI for four reasons. Each one is now a rule.

1. **Explaining a number instead of showing it.** "Every weapon does 5% more damage." A stat, a
   count, or a status is a label: `+5% Damage`, `2/5`, `In progress: 2 runs left`. (This rule
   is for numbers. 0.7.0 stretched it to whole systems, and section 2.5 undoes that.)
2. **The writerly fragment.** "Drowned pages, dried and read." "Where sailors come back to, and
   where new faces arrive by boat." A comma, an "and", a little cadence: that rhythm on every
   menu is the tell. Flavor text is allowed in exactly one place per thing (see 5) and it is one
   plain line.
3. **Narrating the player.** "You held out for 7:11." "You came back after 7:11." "Your longest
   run yet." A results screen shows `Survived 7:11`, `New best time: 12:40 (was 9:05)`.
4. **Soft full sentences where a stat goes.** "Goes through 1 more." "Fires 0.15 s sooner."
   "Every weapon does 5% more damage." The genre writes `+1 Pierce`, `-0.15s Cooldown`,
   `+5% Damage`.

### 2.5 What was wrong in 0.7.0

Kevin, on the Docks panel: "Who the heck is Ned? 'Ferryman sails into runs from here.' No one
talks like this, and this does not at all explain what it even does." The 0.7.0 text had pushed
the label rule onto everything, so systems were named and never explained. Four rules came out of
it.

1. **Say what a thing does, the first time the player meets it.** A building's description, the
   first level that opens a system, a notice that asks for something, and a screen's first line
   are plain sentences: what it is and what it gets the player. The Docks' first level: `The
   Ferryman appears in runs. Stand by his boat to buy relics, food, and more with Pearls`.
   Later lines can be short (`The Ferryman's prices drop 20%`), because the first one
   explained him.
2. **People come with what they do.** A keeper is `Ned, the dockhand` on the panel and the
   prompt (`Talk to Ned, the dockhand`). The name alone is fine after that, and in their own
   speech bubble.
3. **Articles the way people say them.** In a sentence: `the Lamp Post`, `the Ferryman`,
   `Ready at the Smithy`, `Enter the Library`. A bare name is for a title or a label: a panel's
   heading, `Lamp Post Lv 2`, `Opens at Chapel Lv 3`.
4. **No word the game never explained.** "Kindled" was a buff with a name and no description;
   the notice now says `Lamp 2 of 5 lit: +6% XP and Area`. A term the game keeps (Ember, Form,
   Tide, curse, Heirloom, run tool) is explained on the screen that first shows it.

A refusal says what to do, in the player's words: `Restore the Smithy first`, `Needs the Smithy
at Lv 3`, `Kill 1,000 first (500 so far)`, `The Library can only run 2 projects at once`.

## 3. Stats

Sign, number, stat name, in that order, the stat in title case: `+5 Damage`, `+1 Projectile`,
`+20% Area`, `-0.15s Cooldown`, `+1 Pierce`, `+15 Max HP`, `+8% Move Speed`. Several on one card
are joined with commas. A stat line built for a card (a level-up) has no trailing period. A
description in the data is a sentence and ends with one, even when it is mostly a stat:
`+12% Damage (Fire) per level.` A drawback line (a Form's or a relic's price) is a stat line, so it
has no period either: `+10% Cooldown`, `-25% Range`, `No orbs behind you`.

The stat names, and only these:

| Stat | Name |
|---|---|
| might | Damage |
| amount | Projectile / Projectiles |
| area | Area |
| cooldown | Cooldown (lower is better: `-6% Cooldown`) |
| speed | Projectile Speed |
| (how far a weapon reaches) | Range: how far a shot or hook flies, or how far out it swings (Area is how big each hit is) |
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
| growth | XP Gain |
| greed | Materials |
| revival | Revival |

A tag-scoped bonus puts the tag in parentheses after the stat, the tag capitalized as a name:
`+12% Damage (Fire)`. A card's tag chips read the same way, with the count the build already
has: `Fire (2)`.

Numbers are digits (`3 targets`, not "three"). Seconds are `45s`, clock times `7:11`, levels
`Lv 3`, ranks `2/5` (`Brighter Flame 2/5`), percentages `15%` (a setting too: a deadzone is
`15%`, not `0.15`).

## 4. Labels, buttons, and headings

- A heading is a noun: `Upgrades`, `Research`, `Materials`, `Levels`, `Next up`. A heading can
  have one plain line under it that says what the list is for (`Pick one at the gate before a
  run. The run uses it up.`).
- A button is a verb or the plain name of where it goes: `Resume`, `Restore`, `Start run`,
  `Continue`, `Quit run`, `Quit game`, `Discard`, `Back`. Never a sentence. One action has one
  name on every screen: a run is started with `Start run` from the harbor menu, the gate, and
  the results alike; a building is restored with `Restore` at every level (the Lamp Post's
  `Upgrades` are a different thing).
- A prompt over something in reach is a verb and a name: `Enter the Library`, `Talk to Silas,
  the librarian`, `Start run`.
- Status words are single words or a short phrase: `All ranks bought`, `Complete`,
  `In progress: 2 runs left`, `Need 10 Coin, 5 Timber`, `Already at max level`. A refusal says
  what to do (2.5): `Needs the Library at Lv 2`, `Finish Carved Stones first`.
- Anything new names its kind, because names overlap (Tide Clock, Tide Bell, Tide Charts):
  `New weapon: Tide Bell`, `New relic: Tide Clock`, `New character: Harpooner`, and on the
  results `Discovered: Flare Gun` for the first time a thing is seen.
- Forms (0.9.0; evolutions are gone; round 2 of the language pass): a weapon's three are `First
  Form`, `Second Form`, and `Final Form`, on the cards, the Form screen, the stats, and the codex. A
  card counts by level: `New Form at Lv 6 (4 to go)`. The stats list a weapon's traits as `Traits:
  Arc, Moth Draw`. A passive that goes with a weapon says what it gives: `Flare Gun Final Form: +6%
  Damage per level`.
- Settings use the labels every PC game uses: `Fullscreen`, `Borderless`, `Windowed`,
  `Master volume`, `Reduce flashing`.
- A name in the data has no "The": `Lamp Post`, `Library`, `Tavern`, `Drowned Docks`,
  `Lamplighter`, `Harpooner`. A sentence adds it the way a person would (2.5). Bosses keep theirs
  in the data (`The Harbor Maw`) as a title, and a sentence lowercases it (`Kill the Harbor
  Maw.`).
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
- Trait: `Hits chain to 3 nearby enemies.`

## 7. Errors and notices

Say what happened, then what to do, in two short sentences at most. `Save failed. Progress is
kept while the game is open and saves with the next change.` No apology, no "something went
wrong" padding when the real reason is known. A crash says `The run stopped because of an error.
Save a bug report, then reload.` The game's own screens never name Claude (reports still come to
Claude; Kevin sends them); the credits do.

## 7.5 One thing, one name, one description (the sweep, X1)

- A term is described in one place: its entry in `src/data/glossary.js` (`desc`, and a `short` line
  for where there's no room). The codex for a map, a first sighting, a building's level line, a row at
  the gate, and the results read that entry (`termShort`, `termLine`); none writes its own copy.
- A number in an entry is read from the data it describes, never typed. A list in an entry (the
  tags, what orders open, the gear slots) is built from the data's list.
- No two things share a name, and no content is named with a glossary term's words. Rename the
  newer or lesser one; ids stay, so saves do. Gear has rarities, never tiers.
- `tests/sweep-x1.test.js` and `tests/glossary.test.js` fail on each of these.

## 7.6 The game's words (RULING-L1, Nov 19)

A mechanic every bullet heaven has takes the genre's word. A mechanic only Lamplight has may have
its own word, named for what it does and explained where the player first meets it, with a
glossary entry. The words this game uses, and the ones it doesn't:

| Use | Not |
|---|---|
| Stunned, stuns | dazed, daze, pinned |
| Hooked (with its number on the card) | gaff, gaffed |
| Tag bonus: +16% Damage (2 others share a tag) | Kindred |
| Boss chest | Spoils |
| Starting weapon | starting kit |
| Challenge run | set run |
| Elite powers | elite affixes |
| Boss phases | phase gates |
| Chain | hop, jump |
| ready, earn | banked, banks |
| XP Gain (the stat) | XP (as a stat) |
| shield, Tide Shield, Shielded | ward, Tide Ward, Warded |
| the lamp's light | the lamp's ward |
| Signature weapon; the action in plain words ("Levels up every 3:00, and as she lights lamps") | own weapon, own track, trade, the wait |
| Final Form, and its goal ("Final Form goal: ...") | capstone, deed |
| New Form at Lv 6 (4 to go) | How it fires in 4 upgrades |
| trait, Legendary trait | line, special |
| Drawback (a character's, a Form's) | Cost, Price |
| Fuel (the Lamplighter's meter) | Oil (Oil is the material) |
| rarity names for relics (Common, Uncommon, Rare) | Trinket, Charm, Relic as tiers |
| small secret | find |
| a weapon's level | its upgrades (a Harbor upgrade is the Lamp Post's) |
| enemies, an enemy | what (as the target: "burns what stands in it") |
| 50%, 25%, 20%, 33% | half again, a quarter, a fifth, a third |
| takes 25% more damage | takes more from everything, hits harder, burns hotter, cuts deeper |
| +140% Damage, deals 50% more damage | hits 2.4 times as hard, twice as hot, hurts (with no number) |
| a lasting bonus: +N% Damage; one special hit: 2x, 3x, 10x damage | double damage, triple damage, 6 times its damage, +900% Damage for one hit |
| A sentence, then its stat on its own: `The jab stuns enemies it hits for 0.8s. +50% Damage.` | the tail `..., with +50% Damage.` |
| knocks back | throws back, shoves, pushes |
| pulls | hauls, drags, reels, yanks, lands (an elite) |
| HP | health |
| First Form, Second Form, Final Form | How it fires, How its shots travel, Capstone |
| Traits: (the stats screen) | Holds: |
| Harbor upgrades (the Lamp Post's) | Upgrades, upgrades (for a weapon level) |
| Lamplighter's lantern, set down | planted, plants |
| one rarity higher (relics) | a tier better |
| Area, where a number changes Area; Range, where it changes how far a weapon reaches | reach (as a stat) |
| wave (every Tide Bell attack) | ring, toll |
| knocks back; No Knockback | throws back, throws nothing back |
| last (thralls) | stand |
| dims (her light, out of Fuel) | shrinks, in the dark |
| Chest, Boss chest, Floating chest (the Punter's), Sunken crate, Sea chest, Reliquary: six names for a box of loot | cache, Secret cache, Punt cache, Dawn chest |
| Secret (a small one is a small secret, in its entry) | Find, Small secret as its own term |
| Harbor Orders (a Hunt is one) | Hunt as its own term |
| (no act number on a notice: "5 new lamps are out") | Act 2: as a label |
| Won, Died (a result) | Won: you saw the dawn, Fell in it |
| a ring on the ground shows where | warned |

- Tide is the difficulty, and the Tide Priest's own kit. Nothing else is named Tide (Salt Pools, Sea
  Forging, The Rat Swarm), with one exception: the Tide Bell, a weapon, keeps its name. Its attack is a
  wave in every line.
- A map event's notice says what it is and what to do: `The Market Rats: 50 Bilge Rats come out at the
  Fish Market. Kill them for food and materials`, never the bare name.
- A name never shares a word with a glossary term from another system (Linked Pools, not Fuel Line),
  and never sits beside a near-twin (Gleaner's Sack, not Lodestar beside Lodestone).
- A research project needs no shelf or tier: a locked one says what opens it.
- A status says its number on every card that applies it: "it takes 25% more damage for 4s".
- A designer's note is not player text: "Other weapons can also roll Arc", not "Arc is shared:
  other weapons can have it too"; the repeat Damage rule said once, with no multiplier.
- The sea, the bog, and the tide are not people. A rule is stated as a rule.
- A glossary entry is 40 words or fewer and stands alone: it never explains one made-up word with
  another. Detail past that goes under `more`.

## 8. Checked by the gate

`tests/voice.test.js` reads every name, description, and line in `src/data`, every string the
text builders produce for the shipped content (cards, level effects, panels, results, refusals,
prompts), and the string literals in the screen code, and fails on: the banned words and
constructions in 1, an exclamation mark, an em dash, a "The" in a building, map, or character's
name, a building or the Ferryman named mid-sentence without "the" (`at Smithy`), a keeper's
panel line without their role, a prompt that isn't a verb and a name, "your" in a pick's
description, a stat line that doesn't lead with its sign (or that ends in a period), a tag in
lowercase, "Claude" anywhere but the credits, a line that narrates the player ("You held out"),
and a heading or button longer than four words.
`tests/ui.test.js` pins the card text word for word, and `tests/harbor.test.js` the harbor's.

## Sources

- Kevin's `CQV_PROJECT_HANDBOOK.md`, writing section (the house voice).
- Vampire Survivors, the game's own level-up text for a weapon: "Fires 1 more projectiles.", "Base
  Damage up by 10." (read in the game; no wiki link, since wiki prose is never a model).
- Vampire Survivors, the game's own PowerUp shop: its stat names, as the shop prints them (Might,
  Area, Cooldown, Amount, Growth, Greed, Magnet, Revival).
- Vampire Survivors wiki, Evolution: an evolution needs the weapon fully leveled, its counterpart
  item, and a chest (why a weapon card names both halves). https://vampire.survivors.wiki/w/Evolution
- Brotato wiki, Upgrades: `+[number] [Stat Name]` ("+3 Max HP", "+5 Damage").
  https://brotato.wiki.spellsandguns.com/Upgrades
- GOV.UK content design guide: plain English, short sentences, the words people use.
  https://www.gov.uk/guidance/content-design/writing-for-gov-uk
- Dropped (Nov 19): the Grafana Writers' Toolkit. It is a software-docs guide, and in Sep 2026 it
  added an "AI quick reference" so AI agents write in its style.
- Source check (RULING-L1, the language judges' table, Nov 18): Vampire Survivors, Brotato, Halls
  of Torment, and Hades declare no AI content on Steam (Supergiant states it used none in Hades II).
  Their wikis' own prose is never a model; Fandom adds AI "Quick Answers" boxes beside articles.
  Genre words also checked against Deep Rock Galactic: Survivor (its Mid-dive Upgrades page:
  weapon levels and rarities) and HoloCure (its Level Up page), which declare no AI content either.
