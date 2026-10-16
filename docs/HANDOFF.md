# Lamplight: Handoff

Updated Oct 16 2026. Version 0.7.0: 0.6.2 (Kevin's notes on 0.6.1: Forms) and Phase 7 (every building's system). The six Phase 7 buildings come out of the fog as the Lamp Post rises. Runs have Wayside Lamps, Fog Bells, Sea Glass, the Ferryman, and relics in three tiers that come from Reliquaries instead of level-ups and chests. Next is the **gate on all of it**: Kevin plays it and says what's fun and what isn't.

## Where things stand
- **Phases 1 to 7 are done** (see `SCORECARD.md`).
- **0.6.2, Kevin's notes on 0.6.1:**
  - **Forms replace ascensions.** Each weapon has three Forms, one for each part of how it works: how it fires, how its shots fly, and what a hit leaves. All three stack on one weapon, and the evolution keeps them.
  - **An Ember is two steps:** pick a weapon, then its Form.
  - **Stats shows each weapon's DPS and Total Damage** (no more "dealt this run").
  - **Materials are off the run HUD.** They're in the pause menu and Stats.
- **Phase 7, in a run (Kevin's design):**
  - **Wayside Lamps** (5 on the Docks). Stand by one until it's lit. There's no timer: it waits when you walk off, and costs more and pays more the later you start it. Each lit lamp gives Kindled (+6% XP and Area for the run), uncovers the minimap around it, and gives Sea Glass.
  - **Lantern Night.** Light all five and it falls for 40 s: the fog lifts, your light burns everything in it, and a vault opens with a pick of 3 relics, a tier better.
  - **Fog Bells** (3). Walk into the ring to wake one. Every kill inside the ring counts from then on, wherever you are: 20 kills plus 4 a minute. It pays Sea Glass and a chest.
  - **Sea Glass** is the run's own money. It comes from tasks, elites, and bosses, and is spent with the **Ferryman**. Stand still by his skiff near the start to trade. He sells relics, food, a reroll, and a pricey Ember, and his stock gets better every 5 minutes. What's left at the end is lost, unless the Market buys it.
  - **Relics** come in three tiers: Trinket, Charm, and Relic. You carry every one you find, and they never come from level-ups or chests. They come from Reliquaries (a rare drop, at least 2.5 minutes apart, certain after 1,800 kills), the vault, and the Ferryman. Early offers are Trinkets; Relics come late. 12 relics in all, with actives on a dash (Spark Flint), a hit taken (Barnacle Shell), a kill streak (Bloodied Hook), and every 30th kill (Drowned Bell).
- **Phase 7, in the harbor:**
  - **Docks** (from the start): the Ferryman, better each level.
  - **Smithy:** gear in six slots, the brief's Lantern, Coat, Boots, and Charm, plus a Ring and a Pendant. Every piece's own affix changes the build: +1 Projectile on Fire weapons, dash leaves burning oil, level-ups offer 4 cards, and so on. You raise an item's tier, and re-roll an affix by choosing one of three. Rune stones put a rune of your choice in your first weapon at 0:00.
  - **Chapel:** Tides 1 to 10 (clear the map at your highest to open the next) and 5 curses, each paying more materials.
  - **Market:** trades at a poor rate and buys leftover Sea Glass.
  - **Apothecary:** consumables you take into a run (a revival, XP, rerolls, banishes, skips, starting Sea Glass).
  - **Cartographer:** tasks on the minimap from the start, bestiary rewards, challenge runs, short runs, and the secrets on the minimap.
  - **Tavern:** the feat list (9 feats, some hidden until found), and mastery. A character's runs rank them up; perks are trained here, and rank 4 opens a second starting kit.
  - **The gate:** once any of this is open, picking a character leads to a second step that lists only what's open. A line under it says what the focused choice does.
- **Judged:** 0.6.2 Forms 91 and its screens 94; Phase 7's run side 95, meta side 95, and harbor screens 91 (two rounds; see `SCORECARD.md`).
- **Gate:** 645 tests in about 73 s. The web build and `wrangler deploy --dry-run` pass. The whole loop plays through the real screens and saves in the browser. The desktop smoke test passes on the packaged build, and Electron reproduced the golden run hash (db237aa0, new in 0.7.0: the sim changed).
- **Soaks:** the Harpooner's 30-minute soak passes (p99 1.9, 3.6, and 6.0 ms by crowd size, against 2, 4, and 6). The Lamplighter's sits just over the lines (2.0 to 2.1 ms and 7.1 to 7.2 ms). This machine is slower again: the 0.6.1 code you already have, run here back to back, fails the same lines (2.05, 4.1, and 7.2 to 7.4 ms), so the new code isn't the cause. Your frame rate in a busy run (F3) is the real check.
- **Pacing** (`node tools/pacing/pacing.mjs`): the MVP harbor in 9.4 hours (6.8 to 10.8), now that the simulated player also spends on the six new buildings. The whole harbor of nine takes about 13.5 hours, with the Chapel last. A fresh profile's pools hold 12 of the 35 weapons, passives, relics, and runes (34%).

## What Kevin needs to do
1. **Upload to GitHub, then let Cloudflare build.** Upload the zip parts in the order the delivery message gives, into the same `lamplight` repo. Each part only adds and replaces files. The build after an early part may fail; the build after the last part is the one that counts.
2. **Play it.** Use the web build with the DualSense, then the .exe. The .exe comes as split pieces (`Lamplight-win-x64-v0.7.0.zip` plus `.z01`, `.z02`, ...).
   - Put all the pieces in one folder, right-click the `.zip`, choose 7-Zip, then "Extract Here". On Windows 11 the 7-Zip entry may be under "Show more options".
   - Then run `Lamplight-win32-x64\Lamplight.exe`. If SmartScreen appears, choose "More info", then "Run anyway".
   - Your save carries over: it moves to the new version on its own, and nothing is lost.
3. Tell Claude what feels or looks wrong, in plain words, with the time in the run or the place in the harbor.
   - For numbers: open the tuning panel (hold Create for 1 second, or F1), change them live, press "Copy tuning", and paste the text into the chat.
   - If something breaks: pause, choose "Save bug report", and attach the file.
4. Read ARCHITECTURE.md §10.6 and §10.8 (Phase 7 as built), §20 calls 74 to 88, and DECISIONS.md, and overturn anything you don't like.

## Questions for this gate
1. The tasks: are the lamps worth walking to, and the bells worth fighting in? Does "no timer, but later costs more" read, or does it feel like nothing happens?
2. Lantern Night: does it feel like a payoff?
3. The Ferryman: is standing still by the skiff a natural way to open his trade? Are his prices right? (Ember 70, a Relic 50, a Charm 28, a Trinket 14; `ferry` on the run's tuning panel.)
4. Relics: too rare, or too common? (A Reliquary is a 0.06% chance a kill, at least 150 s apart, certain after 1,800 kills: `relics` on the run's tuning panel.) Do the late Relics feel overpowered in the good way?
5. Gear: do the affixes change how you build? Any you'd never take?
6. The six new buildings use the pack's house with their own sign and keeper. Do they read as different places, or do you want them drawn apart?
7. Tides and curses: is each Tide a fair step up for its materials?
8. The gate's second step: too many rows once everything's open?
9. Still open from the MVP gate: is a 20-minute run fun, where does it drag, and are the Forms right?

## Kevin's Harpooner idea: what was tried, and what shipped
Kevin suggested buffs for standing still, to offset her pulling enemies onto herself, and said to drop it if it didn't work in practice or fought the reasons to move. It was built and tested with bots: 12 runs of up to 24 minutes for each version of her kit, on the same seeds. "Holding her ground" means she stands in the crowd she reels in, takes its bites, and steps only for a warned attack, a shot, a pool, or when her health drops below 40%. "Standing still only when nothing is near" means she stops whenever no enemy is within 36 px and nothing is warning. `node tools/bots/harpooner-trials.mjs` plays all of it again and prints this table.

| Her kit, how she's played | Average time alive | Died | Damage taken per minute |
|---|---|---|---|
| As in Phase 3, kiting | 14.5 min | 9 of 12 | 36 |
| Holding her ground, no bonus | 10.5 min | 9 of 12 | 40 |
| Holding her ground, +4 armor while still | 11.9 min | 11 of 12 | 34 |
| Holding her ground, +8 armor while still | 12.3 min | 9 of 12 | 31 |
| Holding her ground, +1 HP a second while still | 11.7 min | 8 of 12 | 43 |
| Holding her ground, +30% damage while still | 10.2 min | 9 of 12 | 39 |
| Standing still only when nothing is near, no bonus | 11.0 min | 11 of 12 | 25 |
| Standing still only when nothing is near, +30% damage while still | 13.2 min | 10 of 12 | 30 |
| Kiting, twice the armor per nearby enemy | 13.6 min | 9 of 12 | 28 |
| **Kiting, what she hits is dazed 0.4 s (shipped)** | **21.3 min** | **3 of 12** | **19** |

No standing-still version beat plain kiting, so it was scrapped. What shipped answers the fault itself: what her weapons reel in arrives dazed for 0.4 s. It can't walk or hurt her, and it reels (a quick sway). Bosses are immune, and so is anything in the middle of a warned attack, so an attack never lands after its warning has gone.

## Open minors (none block anything)
- Sound: a boss's charge line and hazard pools share the ordinary rate-limited warning beep, so one can be silent if an ordinary charger beeped in the 0.4 s before.
- The run view: some effect sizes (explosion and revive spark counts, flash-light radii) are still in code rather than in `tuning.feel`.
- Elites are drawn at 2x while their body is 1.6x, so the drawing overhangs its body a little (a deliberate trade for square pixels, §20 call 40).
- The pause menu shows an item's base description, not what its levels added (the stats screen shows each weapon's numbers).
- Replays are about 100 KB for a 20-minute run. Harmless.
- The minimap and the materials fade by your position on the tick, not the drawn position between ticks, so for a frame at the edge they can stay solid over the top pixel of your head.
- The Stats screen's weapon list scrolls (the d-pad moves through it) but nothing shows there's more below; with three or more weapons the Items are below the fold.
- Words: the enemy, material, and research descriptions (the flavor lines) show nowhere yet; a codex screen is where they'll appear. A cost in the harbor names its materials only on a mouse hover over the icon, so a controller player learns them from the "Need 10 Drowned Pages" line.
- Phase 7: the guide's goal box and the materials bar can touch when counts reach four digits (the guide shows only before the Lamp Post is restored, when counts are small). The Docks' "sells 2 relics" is written in, not read from the sim's stock rule. The pacing model doesn't spend on gear, perks, or consumables. The Cartographer's hints are on the minimap until there's a map select.
- The harbor: the pacing model replays a measured run's haul times its greed, so a percent of greed from the upgrades slightly overstates what the game gives (it multiplies the greed the bot found in the run too). The Lighthouse's plot is 3 tiles wide and the scaffold is drawn for 5 x 4 plots; Phase 10 draws its own.

## Next
- **Kevin's gate on 0.7.0.** Then **Phase 8a** (ARCHITECTURE §18): the design list for map 2, the Salt Marsh (its roster, materials, boss, and new weapons, relics, and runes), for Kevin to approve before it's built. With map 2, the Docks get their first boat, and the Phase 7 buildings' costs move onto the Marsh's materials (§20 calls 79 and 80).
- The atlas is rebuilt with `node tools/atlas/build.mjs` (needs the packs); `--check` says whether the committed one is current. `node tools/atlas/hub-preview.mjs` draws the harbor at any building levels, by day or night, with `--boat` for an arrival.
- `node tools/pacing/pacing.mjs` prints the pacing report from the committed yields in a few seconds; `--remeasure` plays the bots again (minutes).

## Confirmed in Phase 1
- Workers static assets honor `_headers` when the file sits in the assets folder (ours: `public/_headers`, copied to `dist/`).
- A failed build can't replace the live version: the deploy command stops before `wrangler deploy` if the tests or the build fail.
- Electron packaging works in the workspace (Electron 44 via @electron/packager), and the .exe icon is written without Wine.
- Files sent in the chat are capped at 30 MB (found in Phase 3). The .exe zip is about 150 MB, so it goes as a split zip in 25 MB pieces. The workspace checks it with 7-Zip before sending.

## Open questions for Kevin (none block work)
1. The brief disagrees with itself on characters: §5.4 says "8 at launch, 16+ by v1.0", while the §7 table says MVP 2, v0.5 6, v1.0 16. The plan follows the table. Is "launch" something else, like a public release between v0.5 and v1.0?
2. The builder's calls in ARCHITECTURE.md §20, especially 16 (building the art and hub before the feel gate), 44 (the Harpooner's daze instead of a standing-still bonus), and 59 and 60 (the first costs and the fresh profile's share).
