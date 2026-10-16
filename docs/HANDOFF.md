# Lamplight: Handoff

Updated Oct 14 2026. Version 0.6.1: Kevin's notes on 0.6.0. The fog is back in the harbor, first-timers get a guide, walking off the quay starts a run, the Lodestone is a U, runs have a minimap and a stats screen, and weapons can ascend with Embers. Next is still the **MVP gate**: Kevin plays it and says whether it's fun.

## Where things stand
- **Phases 1 to 6 are done** (see `SCORECARD.md`).
- **0.6.1, Kevin's notes:**
  - **The fog is back**, as it was in 0.5.1: the Lamp Post peels it back level by level, you can't walk into it, and the boat comes in through it. The night is a little lighter than 0.5.1's (a blue dusk; every cleared street reads).
  - **A guide for first-timers.** Until the first run, a line at the top says "Go to the gate at the bottom left of town to start a run", and when the gate is off screen an arrow at the screen's edge points to it. Off screen the arrow follows the streets to it, not a straight line through the fog. After the first run the line says to restore the Lamp Post and points at its door (or, if you came home with too little, to go back out); once it's restored the guide is gone. The first run shows a "How to play" card for 40 seconds (move, dash, your weapons fire on their own, blue gems level you up, survive until 20:00).
  - **Walking off the quay starts a run.** Push left against the town's west edge on the gate's row (or the row below) for 0.15 seconds and it's the same as using the gate.
  - **The Lodestone is a U**: straight arms, a round bend, steel tips.
  - **A minimap in runs**, top right, with the materials moved below it. It shows the ground you've seen, you, elites, bosses, and every drop except XP gems: materials, food, magnets, chests, and Embers. Plain enemies aren't on it. It fades while you stand under it. Settings has Minimap (Nearby, Whole map, Off) and Minimap size (Small, Large).
  - **A stats screen**: pause, then Stats. Your character's numbers (health, regen, armor, speed, pickup range, luck, XP, materials, the dash, revivals, rerolls, and the bonuses every weapon gets), then each weapon's damage, cooldown, projectiles, area, pierce, duration, crit chance, and what it has dealt this run.
  - **Embers and ascensions**, after Nordic Ashes' ascension crystals. An Ember is a rare drop: every boss drops one, the Bosun at the muster always does, and an elite now and then (15%). Pick one up and a screen opens: choose one of three ascensions for any weapon you carry, or keep the Ember for later (pause then shows "Ascend (1)"). Each of the 8 weapons has its own three, and they change how it works, not just its numbers: the Flare Gun's flares can burst, fire backward too, or set enemies burning; the Harpoon can jump between enemies, drag them in, or hit far harder. With more Embers you take more, and they stack: a weapon can take all three of its line (each once), or spread them across weapons. An evolved weapon keeps its ascensions. An ascension is never offered where a rune would cancel part of it, and a rune isn't offered where it would cancel an ascension (no Backfire on Signal Pair). Ascended weapons show violet pips on the HUD.
  - **Costs went up again**, to 1.5 times Phase 5's after each building's first level (0.6.0 had 1.15): with ascensions the bots kill and bring home more late in a run, and this puts the MVP harbor back at about 8 hours.
- **Judged:** the guide and walk-off 92, the minimap 93, Embers and Stats 92 (four rounds; see `SCORECARD.md`).
- Gate: 587 tests in about 56 s. Web build and `wrangler deploy --dry-run` pass; the whole loop plays through the real screens and saves in the browser; the harbor probe passes; the desktop smoke test passes on the packaged build, and Electron reproduced the golden run hash (ff4638b7, unchanged).
- **The soaks: this machine is slower than Phase 6's.** 0.6.0's own code, run here, now measures 5.5 ms p99 with 2,001 or more enemies (3.2 ms in Phase 6's session). On it, the Lamplighter's 30-minute soak passes (p99 1.6, 3.4, and 5.9 ms by crowd size, against 2, 4, and 6). The Harpooner's measured 5.3 to 6.9 ms in the biggest crowds across six runs, over the 6 ms line in most. The two versions' CPU profiles are the same within 3% per tick, the runs are tick-for-tick the same with Embers off, and the same code swung from 5.3 to 6.0 between two runs, so this is the tail of a slow, noisy machine rather than new work in the sim. Your frame rate in a busy run (F3) is the real check; it's in the questions below.
- **Pacing** (`node tools/pacing/pacing.mjs`): the bots' runs average 20 minutes (5 of 12 died, 2 cleared the map, 5 lasted to 25:00); the MVP harbor in 8.3 hours (6.6 to 9.9). The shortest third of their runs (11 to 13 minutes) all died to the Harbor Maw, bringing home no Rum or Iron, so a player who never gets past the Maw never restores the Tavern; whether the Maw is too hard is a gate question. A fresh profile's pools hold 10 of the 29 weapons, passives, relics, and runes (34%).

## What Kevin needs to do
1. **Upload to GitHub, then let Cloudflare build.** Upload the repo parts in the order the delivery message gives, into the same `lamplight` repo (each part adds and replaces files). The build after an early part may fail; the build after the last part is the one that counts. If GitHub's upload page dropped `.node-version` before, that no longer matters.
2. If the Cloudflare Worker isn't set up yet: create it from the repo with deploy command `npm run build && npx wrangler deploy`. On the first deploy, check in DevTools (Network tab) that `/` and `/version.json` show `cache-control: no-store`.
3. **The MVP gate: play it and say whether it's fun.** The web build with the DualSense, then the .exe. The .exe comes as split pieces (`Lamplight-win-x64-v0.6.1.zip` plus `.z01`, `.z02`, ...). Put all the pieces in one folder, right-click the `.zip`, choose 7-Zip, then "Extract Here" (on Windows 11 the 7-Zip entry may be under "Show more options"). Then run `Lamplight-win32-x64\Lamplight.exe`. SmartScreen says "More info", then "Run anyway".
   - Tell Claude what feels or looks wrong in plain words, with the time in the run or the place in the harbor.
   - For numbers you want changed, open the tuning panel (hold Create for 1 second, or F1), change them live, then press "Copy tuning" and paste the text into the chat.
   - If something breaks, open pause and choose "Save bug report", then attach the file (web: your Downloads folder; the .exe: `%APPDATA%\Lamplight\reports\`).
4. Read ARCHITECTURE.md §20 (calls 69 to 72 are new in 0.6.1; 54 and 57 are back with the fog) and DECISIONS.md, and overturn anything you don't like.

## Questions for the MVP gate
1. Is it fun for 20 minutes? Where does it drag, and where is it too much?
2. The map: do the slips, sheds, and crates make the wharf more interesting, or just get in the way? (The layout is data: `layout` in `src/data/maps.js`.)
3. The secret: is the wreck too far, too hidden, or too easy? Does the faint violet glow give it away too much or too little?
4. The Bosun's Muster at 15:00: does it read as an event? Is a boss chest the right reward?
5. The Maw's lure: is the pull clear while you're in it? Can you see why you're sliding? The Tidecaller's tide lanes: readable while half-watching?
6. The new weapons: does each feel like its own thing? (Lightning Rod's bolts are drawn as lines from above; Corpse Candles' flames drift slowly.)
7. Light and fog in a run, shake, hit-stop, damage numbers, movement, dash, the XP vacuum, and the Harpooner's daze: all still open from the feel gate (tuning names in the panel).
8. From Phase 2: should a boss chest be able to evolve several weapons at once? Should orbiting weapons hit enemies pressed right against you?

## Questions about the harbor
1. Walking and the dash on the pad, and moving through the panels with the d-pad: anything awkward?
2. The ceremonies' pace (0.7 s to the building, 1.4 s for the stage to rise, half a second to look, 0.7 s back): too slow once you've seen a few? Their numbers are on the harbor's tuning panel under `timing`.
3. The night with the fog back: dark enough to feel dingy, light enough to see? (`look.ambient` on the harbor's tuning panel.)
4. The guide: is the line at the top and the arrow at the edge enough to find the gate? Walking off the quay: does it start too easily when you only meant to walk along the edge?
5. The pacing against the brief (§20 calls 59, 60, 67, 68):
   - A fresh profile's pools hold 34% of the run content; the brief wants 30% or less. It falls as content passes put more behind research.
   - Past run 10, something new comes every 2 runs, sooner than the brief's 3 to 4, because the MVP harbor has only so much to give.
   - The costs: tune them to your first runs, or keep the bots' 8 hours as the target?
6. The frame rate on your monitor in the harbor and in a busy run (F3 shows it).

## Questions about 0.6.1
1. Embers: too rare or too common? (One per boss, the muster's Bosun, and 15% of elites: the bots picked up 1 or 2 a run, and they don't go out of their way for drops. `embers.eliteChance` on the run's tuning panel.)
2. The ascensions: do they feel like variants of the weapon, not just bigger numbers? Any you'd never take, or always take? They're data: `src/data/ascensions.js`.
3. The minimap: the right size and place? Should it show something it doesn't, or less?
4. The stats screen: anything you looked for and didn't find?

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
- Words: the enemy, material, and research descriptions (the flavor lines) show nowhere yet; a bestiary or codex screen (Phase 7) is where they'll appear. A cost in the harbor names its materials only on a mouse hover over the icon, so a controller player learns them from the "Need 10 Drowned Pages" line.
- The harbor: the pacing model replays a measured run's haul times its greed, so a percent of greed from the upgrades slightly overstates what the game gives (it multiplies the greed the bot found in the run too). The Lighthouse's plot is 3 tiles wide and the scaffold is drawn for 5 x 4 plots; Phase 10 draws its own.

## Next
- **The MVP gate**, Kevin's. Then **Phase 7 (Systems)** on Opus 5.5 high, with whatever the gate changes.
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
