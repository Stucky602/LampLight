# Phase 8a: The Salt Marsh (map 2), design list for Kevin's approval

Status: **proposed** (Oct 16 2026). Nothing here is built. Phase 8b builds it after Kevin approves
or changes it. Phase 8c builds the new sim parts it needs.

How it was made: Kevin's generator method. Seven generators each produced about 25 ideas and kept
10: events and regret (what your playtests said), tags and archetypes, place first (the marsh as a
real place), benchmark steal (one mechanic from each game you own), out of scope (your evenings,
the TV, motion sickness), time (the 20-minute run and the 100-hour arc), and borrowed domain
(validation and the kitchen). A portfolio pass judged the pool as a whole, merged the ideas that
several generators reached on their own, resolved the conflicts, and assembled this list. The
brief's numbers for a content pass: 1 map, 2 characters, 6 weapons and 4 evolutions, 5 passives, 7
relics, 4 runes, 2 bosses, an elite event, and a secret.

## The idea in one line

The Docks push and pull the horde (knockback, the Harpooner's reel). **The Marsh holds it still**:
high water that closes the creeks, mud that slows enemies, frost, salt, nets. Five generators reached
"hold" on their own, and it fills the Frost tag, which has no weapon today.

## Rules for the whole pass (from your notes, except where a rule says it's a recommendation)

1. **Two warning shapes only:** a ring means something lands here, a line means something travels
   this way. Every new enemy, the storm, and both bosses use one of them, warned at least 0.8 s.
2. **Nothing moves the whole screen.** No shake, no screen-wide flash or tint, water that doesn't
   scroll, reeds that don't sway together, no enemy sweep across the full screen. A test holds it.
3. **Terrain never slows you.** Mud slows enemies only. *Recommended (decision 3):* high water is
   a wall to everyone except things that swim.
4. **Dark-room colors.** The salt flats are pale grey, never white; "salt" is a cracked pattern,
   not brightness. Lightning is a bolt and a scorch mark, never a sky flash, and it follows Reduce
   flashing. Every Marsh floor is checked for contrast against every enemy and the warning color.
5. **The first time anything new appears in a run, one plain notice says what it is.** The pause
   menu keeps a field guide of everything seen, one line each.
6. **Short runs get the same beats** on the halved clock (two high waters, 1:30 to 4:00 and 6:30 to
   9:00, each with its storm). Warnings and the water's creep are in seconds and never squeezed.
7. *Recommended (decision 2):* **new weapons ship without Form lines.** Embers go to Docks
   weapons or are kept. Eighteen new Forms would be the biggest single job here and would push
   against the 0.7.2 tone-down. It changes §20 call 69 ("every drafted weapon has a line") to
   "every Docks weapon has a line" for this pass.
8. **The flood never closes around you.** Every dry tile you can stand on keeps a dry path back to
   the landing at every water level: a tile doesn't flood while flooding it would cut you off.
   Standing in a creek, on a causeway, or on the far island, the tiles you need stay mud until
   you're back. You're never moved and never stranded, and the horde can follow you on the same
   tiles, so no corner becomes a safe room. The content test floods each map through its whole
   water timeline with you placed on every standable tile and checks the path.

## The map

| Part | What it is |
|---|---|
| Layout | Wide pale salt flats, 4 to 6 fixed creeks 3 to 4 tiles wide with 2 or 3 causeways or footbridges across each, peat islands, low reeds drawn under the bodies. 5 Wayside Lamps at causeway ends, 3 Fog Bells on the flats, the Ferryman at the landing. |
| High and low water | (Called "water" and "the flood", never "the tide", because Tide is already the difficulty and a weapon tag.) Creek tiles are mud at low water (open; enemies walk 40% slower on it, you don't) and water at high water (a wall, except to swimmers). The water creeps in from the creek mouth over about 10 s, with a warning on the HUD 15 s before. An enemy on a flooding tile is moved to the nearest bank. The flood never closes around you (rule 8). Low water is 0:00 to 3:00, 8:00 to 13:00, and 18:00 to the end of the run; overtime's flood never goes out. |
| The storm | During the two storm windows at high water (5:30 to 8:00, 15:30 to 18:00) and all through overtime, bursts of 3 to 6 rings land on the thickest crowd standing on salt, about every 40 s. Each warns 1.2 s, hits enemies hard and you lightly. One strike in three leaves Salt Glass. |
| Herb beds | Marsh Herbs grow on the creek mud. Walk over them to pick them. At high water they're under the water, and they're still there at the next low water: nothing is lost to the clock. |
| It wakes up over visits | The water and the roster from the first run. The storm after you first kill Old Grey. The elite event after your first clear. The secret at Tide 2 or the Cartographer's level 5. New enemies arrive one a minute on your first runs. Counts runs, never real time. |

**A Marsh run (standard 20:00)**

| Time | What happens |
|---|---|
| 0:00 | Land at low water. The Ferryman is at the landing. |
| 0:00 to 3:00 | Open map, herbs on the mud. |
| 3:00 | High water comes in and closes the creeks. The map becomes islands joined by causeways. |
| 5:00 | High water. |
| 5:30 to 8:00 | The storm over the flats. |
| 8:00 | The ebb: low water until 13:00, herbs again, and the causeway is dry. |
| 10:00 | **Old Grey**, on the drained mud. |
| 13:00 | High water again. |
| 15:00 | **The Salt Well** (the elite event). |
| 15:30 to 18:00 | The storm, harder. |
| 18:00 | The ebb: low water to the end of the run. |
| 19:00 to 19:45 | **The Eye**, its own event (not the storm, which needs high water): spawns stop, warned rings fall on the leftover horde, and gems and Glass cover the flats. Earned quiet before the last boss. |
| 20:00 | **The Salt Widow**, on the drained flats. |
| Overtime | The flood comes in and doesn't go out: more ground floods each minute (at least 35% stays dry, and rule 8 holds), the storm never stops, and Glass comes more often. |

## Characters (2)

| Name | Mechanic | Starts with |
|---|---|---|
| **The Punter** | A marsh boatman. His damage rises with his Move Speed stat above his base (from passives, relics, and upgrades, worked out when the build changes, not each step), up to +40%. His dash recharges 30% faster, and he has less health. The pure-speed glass cannon the brief asks for, which no character covers. | Glass Caltrops |
| **The Bog Warden** | Enemies that die while rotting get up and fight for her for 6 s (at most 6 at once). The summoner, which has one weapon today. Allies need a rule §16.4 doesn't have yet (enemies cool, you warm and never tinted): a thrall keeps its own sprite, darkened, with a small pip above it in her color, a marker no enemy uses (the elite's gold line means a chest), and never takes your color, so it reads as neither you nor a threat; the contrast test covers it. | Eel Pot |

## Weapons (6), 4 with evolutions

| Weapon | Tags | What it does | Evolves into (partner) |
|---|---|---|---|
| **Brine Spring** | Frost, Tide | Every 3 s a spout of brine bursts under the thickest crowd, freezes it for 1 s, and leaves a slowing puddle. Enemies where two puddles overlap freeze. A thawed enemy can't be frozen again for 2 s. | **Salt Pan** (Hoarfrost): puddles last 8 s, and frozen kills shatter into 3 ice shards. |
| **Ice Picks** | Frost, Steel | Picks fly out at the nearest enemy and come back, slowing what they hit both ways. | None this pass. |
| **Fulgurite** | Light, Echo | A bolt of glass hits the nearest enemy and hops to 3 more. | **Storm Glass** (Copper Wire): each hop leaves a glass spike that beams the nearest enemy every 1 s for 4 s. |
| **Eel Pot** | Tide, Rot | Eels lunge out of a pot at enemies in short, fast runs. Their bites rot. | **Conger Pot** (Grave Moss): bites also daze for 0.5 s. |
| **Anchor Chain** | Steel, Tide | One heavy anchor swings slowly around you, hits hard, and throws enemies far. The orbit tank's second weapon. | **Sea Anchor** (Thick Coat): +3 damage per point of Armor. |
| **Glass Caltrops** | Steel, Light | Leaves sharp glass where you walk. Enemies that step on it are hurt. Each piece lasts 4 s. | None this pass. |

After this pass: 14 base weapons and 8 evolutions (v0.5 wants 20 and 12; map 3 adds the rest,
including evolutions for the Signal Mirror, Oil Flask, Lightning Rod, and Corpse Candles).

## Passives (5)

| Passive | Per level |
|---|---|
| **Hoarfrost** | +Damage and +Duration on Frost weapons. Partner for Brine Spring. |
| **Copper Wire** | +1 hop for anything that chains, every other level (Fulgurite, the Lightning Rod, the Chain Link rune). Partner for Fulgurite. |
| **Grave Moss** | Rot lasts longer and hurts more. Partner for the Eel Pot. |
| **Bittern's Call** | +Area and +Amount on Echo weapons (the Tide Bell, the Signal Mirror, Fulgurite). |
| **Waders** | Shorter dash cooldown and a little more move speed. |

After this pass every tag has something that scales it: Rot, Echo, and Frost get their first.

## Relics (7)

| Relic | Tier | The rule |
|---|---|---|
| **Brine Vat** | Relic | Slows add together, up to 80%. An enemy held at that for 1 s turns to salt for 4 s: it can't move or hurt you, the crowd piles up behind it, then it crumbles. |
| **Quench Bucket** | Charm | A Tide or Frost hit on a burning enemy puts the fire out, and all the burn it had left lands at once, on it and on everything touching it. |
| **Cold Iron** | Charm | A Steel kill on a slowed or frozen enemy shatters it into 4 shards that slow what they hit. |
| **Watchman's Rattle** | Charm | When 30 or more enemies have been close for 2 s, every weapon fires at once. It won't sound again until the crowd near you drops under 15. |
| **Sea Urchin** | Trinket | Enemies that hit you take 6 times your Armor in damage. |
| **Try-Pot** | Charm | After a skip, the next level-up offers only things you own, and the one you pick gains 2 levels. (A skip still uses its charge.) |
| **Bog Torc** | the secret's | Once a run, instead of dying you sink into the peat: 4 s untouchable and still, enemies touching you rot, then you rise at 40% health. |

## Runes (4)

| Rune | What it changes |
|---|---|
| **Familiar** | Shots become small spirits that hunt for 3 s. |
| **Spillway** | Damage left over when a hit kills carries on to the nearest enemy, and on again until it runs out. |
| **Marsh Fever** | What this weapon puts on enemies (burn, rot, slow) spreads to an enemy they bump into, once each, at half the time left. |
| **Tarred** | Hits coat enemies in tar for 4 s. A hit from any other weapon sets the tar off. |

## Bosses (2)

**Old Grey (10:00).** A giant heron, built from pack sprites. It stabs along a line; it leaps,
can't be hit in the air, and lands where a shadow ring warned 1.2 s before; it calls in toads and
eels. If it lands on mud, it sticks for 3 s and takes double damage: you make it miss into the
mud. Three generators reached a heron at 10:00 on their own.

**The Salt Widow (20:00).** A tall figure crusted in salt who brings the storm. Lightning marches
toward you as a line of rings; where it strikes salt, a glass pillar rises for 8 s (at most 6,
never within 3 tiles of you, so they wall in the horde, not you). After each march she kneels for
2 s and takes double damage. Under half health she throws slow fans of salt shards; each fan's lines show for 0.8 s before it flies (rule 1).

## Enemies: 5 new, 1 elite captain

| Enemy | What it does |
|---|---|
| **Midge Cloud** | Small, quick clumps of midges that drift at you. The fodder the density curve needs. (Not walls across the screen: rule 2.) |
| **Salted Dead** | Crusted drowned that take half damage until a Frost, Tide, or Steel hit cracks the crust. A soft reason a Fire build might prefer the Docks. |
| **Mire Toad** | Hops toward you. A ring shows where it will land. |
| **Creek Eel** | Waits in the creeks at high water and lunges out along a warned line as you pass. |
| **Leech** | Swims. Latches on instead of biting and drains 1 health every 2 s, at most 3 at once. A dash throws them all off; a daze or a freeze stops them. Never slows you. |
| **The Well Warden** | The elite captain of the Salt Well, with a crew of Salted Dead. |

The Fog Wisp and the Gull carry over as coast-wide enemies, the Gull as single birds and small flocks. The Marsh's timeline has no `wall` events (rule 2); the Docks keep their gull wall until you say otherwise.

## Where each new thing comes from

Everything new starts locked, so a fresh profile's pools hold 12 of 57 weapons, passives, relics,
and runes (21%; the brief wants 30% or less, and today it's 34%). Research marked *Marsh* counts
only runs on the Salt Marsh; *Docks* counts only runs on the Docks and costs Salt Glass, so the
Marsh points back at the Docks.

| What | Comes from |
|---|---|
| The Punter, Glass Caltrops, Waders | Feat: reach 5:00 on the Salt Marsh (the first crossing). He arrives by boat. Feats count only once the Tavern keeps the list (§20 call 85), so the Marsh opens after the Tavern's level 1 as well as the Docks'. |
| The Bog Warden, Familiar | Feat on the Docks: kill the Tidecaller with the Eel Pot at level 8 (the Eel Pot comes from research, below). |
| Brine Spring, Hoarfrost | Research, tier 2, *Marsh*: Brine Notes. |
| Ice Picks, Tarred | Research, tier 2, *Marsh*: the Ice House Ledger. |
| Eel Pot, Grave Moss | Research, tier 2, *Marsh*: the Eel Trapper's Notes. |
| Bittern's Call, Try-Pot | Research, tier 2: the Fowler's Calls. |
| Fulgurite, Copper Wire | Research, tier 3, *Marsh*: Fulgurite. |
| Anchor Chain, Cold Iron | Research, tier 3, *Docks* (costs Salt Glass): Anchor Smithing. |
| Spillway, Brine Vat | Research, tier 3, *Docks* (costs Salt Glass): the Salting Ledger. |
| Quench Bucket | Feat: put out 50 burning enemies with Tide or Frost hits. |
| Watchman's Rattle | Feat: stand among 40 enemies for 10 s on the Salt Marsh. |
| Marsh Fever | Feat: clear the Salt Marsh. |
| Sea Urchin | A Docks challenge's reward (a new one: the Harpooner at Tide 3 with Brittle). |
| Bog Torc | The Drowned Causeway (the secret). |

Each new character gets 5 mastery perks and a second starting weapon at rank 4 (the Punter: Ice
Picks; the Bog Warden: Brine Spring), written in 8b in the style of the first two characters'.

## The elite event and the secret

**The Salt Well (15:00).** The Well Warden walks in with a ring of crew (the muster you know from
the Bosun). He drops his chest as usual. Killing him also opens a well where he fell, and it stays
open for the rest of the run, no timer: stand at it to give up one relic you carry. You lose it for this run, and from then on the Ferryman offers it in
a Well slot on every visit, on every map. Ignoring the well costs nothing. From Halls of Torment.

**The Drowned Causeway (secret).** A stone causeway to a peat island in one corner, above water
only at low water (0:00 to 3:00, 8:00 to 13:00, and 18:00 until overtime's flood). A bog body lies
on the island; reach it for the Bog Torc. You see the causeway rise out of the water mid-run and
decide whether the walk is worth it. If the water comes back while you're across, the causeway
stays mud under you until you're back (rule 8), for the horde too. The Cartographer's hint mentions
the water.

## Materials and the harbor

| Material | Where it comes from |
|---|---|
| **Marsh Herbs** | Early in a run: common drops and the herb beds at low water. A short Marsh run is a herb run. |
| **Salt Glass** | The Marsh's rare material (as Iron is the Docks'). Late in a run: storm strikes, elites, Old Grey (3 to 5), the Salt Widow (8 to 12), and the Eye. |
| Coin, Oil, Map Scraps | As on every map. |
| Timber, Rope, Pages, Rum, Iron | Docks only. That's the pull between the two maps. |

- **How the Marsh opens:** the Docks' level 1 repairs the boat, and the boatman sails once the
  Harbor Maw has been killed and the Tavern keeps the feat list (its level 1), so skill and the Tavern
  open it, not a pile of Coin. The gate gets a map card: what each
  map drops, and which of your next three things it moves. The first Marsh run to reach 5:00
  brings the Punter home on the boat. The Bog Warden comes from a Docks feat that needs Marsh
  tools: kill the Tidecaller with the Eel Pot at level 8.
- **Costs that move, by level, never level 1:** the Apothecary takes Herbs from level 2; the Docks
  a pinch of Herbs at levels 3 to 5; the Smithy Iron and Glass from level 3. The MVP harbor (the
  Lamp Post, the Library, the Tavern) stays on the Docks' materials alone, as the content test
  requires, so it never waits on a second map. Every Smithy and Apothecary level keeps one Docks material beside the Marsh one, so
  neither map is ever finished.
- **Sinks that never run out:** rune stones cost Iron, Glass, Pages, and Coin; a gear reroll costs
  Iron and Glass per tier; gear tiers 4 and 5 need Glass; some consumables need Herbs.
- **Research that points at a map:** about a third of the new research only counts runs on the
  Marsh ("2 more runs on the Salt Marsh"), and the Docks-bound projects cost Glass. With 2 or 3
  slots, any run moves something along.
- **Pacing:** a first cleared Marsh run should buy about what a first cleared Docks run buys in
  0.7.2 (the Lamp Post's first two levels and the Library's first, or their Marsh equivalents);
  the pacing tool measuring each map checks it.

## New sim parts this needs (Phase 8c)

| Part | What depends on it |
|---|---|
| **Changing ground**: tiles that switch between open and wall mid-run, the flow field rebuilt at most 4 times a second, bodies moved off closing tiles, a per-tile enemy speed, and swimmers. Plus the Marsh layout builder. | High water, mud, herb beds, the Creek Eel, the Leech, Old Grey's mud, the Widow's pillars, the causeway, the overtime flood (11 things) |
| **The storm**: warned rings at the thickest crowd on salt | The storm, Salt Glass, the Eye, the overtime storm, the Widow's lightning (5) |
| **Leap and weak window** | Old Grey (twice), the Mire Toad, the Widow's kneel (4) |
| **Hold statuses**: freezing where puddles overlap, the 2 s after a thaw, slows that add up, the salt state | Brine Spring, Salt Pan, Brine Vat, Marsh Fever (4) |
| Four small on-hit types: spill, tar, spread, daze | Spillway, Tarred, Marsh Fever, Conger Pot |
| Small stats and calls: hops, damage from Armor, a boomerang's second pass, "every weapon fires now", the owned-only draft, sinking instead of dying | Copper Wire, Sea Anchor, Ice Picks, the Rattle, Try-Pot, Bog Torc |
| The crust flag; the latch; thralls | The Salted Dead; the Leech; the Bog Warden |

Also in the sim: a director event that stops spawns for the Eye, and the swimmer flow field.

Outside the sim (meta, UI, saves, tests):
- map layers (what's on for this run, from the profile, into the run config);
- research that counts runs on one map (`runsOn`), shown on the Library's panel and in the next three;
- Tides counted per map, if you choose that (decision 6), with a save migration;
- the Well slot in the profile, with a save migration, and the Well screen;
- first-sight notices and the field guide in the pause menu;
- the map card at the gate, and the gate's map choice;
- the content test's rules per built map (every cost from a built map's drops; the MVP harbor on map 1 alone, as now), and the flood check (rule 8);
- the pacing tool measuring runs on each map.

## Decisions that are yours

Eight; each has a recommendation, and 8b can start on any you leave as recommended.


1. **The second character: the Bog Warden or the Herbwife?** The Herbwife's Embers never become
   Forms; each one evolves her best maxed weapon on the spot, no chest. She needs nothing new in
   the sim. *Recommended: the Bog Warden* (summoner is the missing archetype), and the Herbwife for
   map 3, once the toned-down Forms have been played.
2. **New weapons without Forms this pass?** *Recommended: yes* (rule 7). An Ember then goes to a
   Docks weapon you carry or is kept; a build of only Marsh weapons keeps its Embers, and the
   Ferryman doesn't offer one to a build that can't use it.
3. **High water a wall to you too?** If you could wade while the horde can't follow, every creek
   becomes a safe room; wading slowly is the terrain slow your notes rule out. *Recommended: yes.*
4. **The Salt Well's relic offered by the Ferryman on every map from then on?** *Recommended: yes*,
   with the Warden's chest kept, so the well is a choice and ignoring it costs nothing.
5. **The storm, the elite event, and the secret held back until first kills and clears?**
   *Recommended: yes*: the first runs teach the water and the roster before the storm stacks on top.
6. **Tides counted per map?** Today a Tide opens by clearing at the one below, on any map, so the
   ladder could be climbed on the easier map. *Recommended: per map*, so the Marsh has its own
   ladder (Tide 1 opens on the Marsh by clearing it at none).

7. **The causeway open only at low water?** It's a window on the run clock (0:00 to 3:00, 8:00
   to 13:00, and 18:00 until overtime's flood), the kind of timing your ruling on tasks removed
   ("no countdown"). The difference: it's the map's own state, which you can see coming (the
   water's warning), not a timer on something you started. *Recommended: keep it*, with the
   Cartographer's hint naming the low water. The alternative: the causeway is always dry, and the
   bog body surfaces once Old Grey has been killed in that run.
8. **Rename the Tide weapon tag?** The Marsh adds three more Tide weapons (Brine Spring, the Eel
   Pot, the Anchor Chain), so "Kills by Tide weapons" next to "Tide 4" gets more common. It's the
   question already open from 0.7.1. *Recommended: rename the tag to Sea* (the difficulty keeps
   Tide); a one-line data change before 8b.

## Art from the packs

Candidate tiles from the Kenney 1-Bit Pack, checked at full size against the manifest's indexing
(the wisp 419 and the sailor 471 line up), to be confirmed in 8b: the Creek Eel 420, the Mire Toad
a frog from the creature rows, Old Grey's neck squiggles 697, beak shaft 179, wings 1061 mirrored,
and legs 160 and 161, the Salt Widow's hooded cloak 87 scaled up and crystal 523, glass pillars
1023, reeds 98, and water 253 with its edges. Drawn in code, because no tile fits: the Leech (266
is a flat slab), Old Grey's head (368 is a whole duck), the Widow's crown (995 is a pencil), the
Midge Cloud's dots, and the salt flats' cracked pattern on a pale grey floor (834 is a checkerboard,
which rule 4 rules out). Effects (the storm, puddles, glass spikes, the flood's edge) are drawn in
code too.

The two characters come from Tiny Dungeon. Its two women are already the Lamplighter and the
Harpooner (§20 call 53), so the Bog Warden is a recolor of one of them with a hood drawn over it in
code; the Punter uses one of its men in his own colors.

## What I'd cut first if the pass has to shrink

1. The Bog Warden for the Herbwife (drops the thralls).
2. The Salt Well's well (a plain muster; drops its screen and the Ferryman slot).
3. The Leech (drops the latch).
4. Tarred and Marsh Fever (two on-hit types).
5. The Eye and the overtime flood.
6. Old Grey's leap (the Mire Toad becomes a charger with a ring).

Never the changing ground or the storm: without them the Marsh is the Docks with a new floor.

## Considered and left out

- **The Eel Run** (an elite that leaves if you don't chase it), the **Lantern Procession** (a moving
  chest): both punish looking away, and the eel walls sweep the whole screen.
- **The Long Eel** as the last boss: needs segmented bodies; saved for the Reef.
- **Reed fires, Smoker's Tally, Marsh Gas**: fire payoffs, and burning-ground is already the
  strongest build.
- **The Mudlark** (crit while moving, lost when you stop): punishes drifting twice; the Punter
  covers speed.
- **Marsh Lights** (VS's light sources): good, but a third errand on top of lamps and bells.
- **Fusion evolutions** (Ball x Pit: two weapons merge and free a slot): strong, but merging runes
  and Forms is a big job; a candidate for map 3.
- **The Change Ringer, the Skipper, Answering**: need new hook points (weapons firing in turn, a
  follower that fires); candidates for later passes.
- **Hands-off pause, "What hit you", the HUD water clock**: worth building, but they're global
  features, not this map's.
